import { NextRequest, NextResponse } from 'next/server';
import { getAflOddsCache, getAflEventIdForMatchup, refreshAflOddsData } from '@/lib/refreshAflOdds';
import cache from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PLAYER_PROPS_CACHE_TTL_MINUTES = 30;
const CACHE_KEY_PREFIX = 'afl_player_props_v2';

const inFlight = new Map<string, Promise<MergedCache>>();

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const AFL_SPORT = 'aussierules_afl';

const ALL_STATS = ['disposals', 'disposals_over', 'anytime_goal_scorer', 'goals_over', 'marks_over', 'tackles_over'] as const;

/** Map our stat param to The Odds API market key (additional markets). */
const STAT_TO_MARKET: Record<string, string> = {
  disposals: 'player_disposals',
  disposals_over: 'player_disposals_over',
  anytime_goal_scorer: 'player_goal_scorer_anytime',
  goals_over: 'player_goals_scored_over',
  marks_over: 'player_marks_over',
  tackles_over: 'player_tackles_over',
};

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string;
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}

type PropItem = { bookmaker: string; line: number; overPrice?: number; underPrice?: number; yesPrice?: number; noPrice?: number };

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(playerQuery: string, outcomeName: string): boolean {
  const a = normalizeName(playerQuery);
  const b = normalizeName(outcomeName);
  if (a === b) return true;
  const aParts = a.split(/\s+/).filter(Boolean);
  const bParts = b.split(/\s+/).filter(Boolean);
  const lastA = aParts[aParts.length - 1] ?? '';
  const lastB = bParts[bParts.length - 1] ?? '';
  const firstA = aParts[0] ?? '';
  const firstB = bParts[0] ?? '';
  if (lastA && lastB && lastA === lastB && firstA && firstB && firstA === firstB) return true;
  if (b.includes(a) || a.includes(b)) return true;
  return false;
}

function decimalFromAmerican(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

const PLAYER_PROPS_EXCLUDED_BOOKMAKERS = ['tabtouch', 'playup', 'betrivers', 'bet rivers'];

function isExcludedBookmaker(key: string | undefined, title: string | undefined): boolean {
  const k = (key ?? '').trim().toLowerCase();
  const t = (title ?? '').trim().toLowerCase();
  return PLAYER_PROPS_EXCLUDED_BOOKMAKERS.some((x) => k === x || t === x || k.includes(x) || t.includes(x));
}

function parseMarketToProps(
  player: string,
  stat: string,
  bookmakers: OddsApiBookmaker[]
): PropItem[] {
  const marketKey = STAT_TO_MARKET[stat] ?? stat;
  const props: PropItem[] = [];
  const isYesNo = stat === 'anytime_goal_scorer';
  const isOverOnly =
    stat === 'disposals_over' || stat === 'goals_over' || stat === 'marks_over' || stat === 'tackles_over';

  for (const book of bookmakers) {
    if (isExcludedBookmaker(book.key, book.title)) continue;
    const market = book.markets?.find((m) => m.key === marketKey || m.key === stat);
    if (!market?.outcomes?.length) continue;

    const outcomes = market.outcomes as OddsApiOutcome[];

    if (isYesNo) {
      const playerOutcomes = outcomes.filter(
        (o) =>
          namesMatch(player, o.name ?? '') ||
          namesMatch(player, (o as OddsApiOutcome & { description?: string }).description ?? '')
      );
      const yesOut = playerOutcomes.find((o) => /yes/i.test(o.name ?? ''));
      const noOut = playerOutcomes.find((o) => /no/i.test(o.name ?? ''));
      if (!yesOut && !noOut) {
        const anyYes = outcomes.find((o) => /yes/i.test(o.name ?? ''));
        const anyNo = outcomes.find((o) => /no/i.test(o.name ?? ''));
        if (anyYes || anyNo) {
          props.push({
            bookmaker: book.title || book.key,
            line: 0,
            yesPrice: anyYes != null ? decimalFromAmerican(anyYes.price) : undefined,
            noPrice: anyNo != null ? decimalFromAmerican(anyNo.price) : undefined,
          });
        }
      } else {
        props.push({
          bookmaker: book.title || book.key,
          line: 0,
          yesPrice: yesOut != null ? decimalFromAmerican(yesOut.price) : undefined,
          noPrice: noOut != null ? decimalFromAmerican(noOut.price) : undefined,
        });
      }
      continue;
    }

    const byLine = new Map<number, { over?: number; under?: number }>();
    for (const o of outcomes) {
      const desc = (o as OddsApiOutcome & { description?: string }).description ?? '';
      const outcomeName = (o.name ?? '').toLowerCase();
      const matchesPlayer = namesMatch(player, o.name ?? '') || namesMatch(player, desc);
      if (!matchesPlayer) continue;
      const line = typeof o.point === 'number' ? o.point : 0;
      const price = decimalFromAmerican(o.price);
      if (!byLine.has(line)) byLine.set(line, {});
      const entry = byLine.get(line)!;
      if (outcomeName.includes('over')) entry.over = price;
      else if (outcomeName.includes('under')) entry.under = price;
      else entry.over = entry.over ?? price;
    }

    const lines = Array.from(byLine.entries()).filter(
      ([_, v]) => (isOverOnly && v.over != null) || (v.over != null || v.under != null)
    );
    const best = lines.length > 1 ? lines.reduce((a, b) => (a[0] > b[0] ? a : b)) : lines[0];
    if (best) {
      const [line, { over, under }] = best;
      if (isOverOnly && over != null) {
        props.push({ bookmaker: book.title || book.key, line, overPrice: over });
      } else if (over != null || under != null) {
        props.push({
          bookmaker: book.title || book.key,
          line,
          overPrice: over,
          underPrice: under,
        });
      }
    }
  }
  return props;
}

/** One cache entry per player per event: all 6 stats merged so every request gets the same bookmaker set. */
type MergedCache = Record<string, PropItem[]>;

/**
 * GET /api/afl/player-props?player=...&stat=...&team=...&opponent=...&game_date=...
 * Fetches ALL 6 player-prop markets in one batch, caches the merged result, and returns the requested stat.
 * So refresh always gets the same full bookmaker set (Neds, Ladbrokes, PointsBet, etc.).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const player = searchParams.get('player')?.trim();
  const stat = (searchParams.get('stat') ?? 'disposals').trim().toLowerCase();
  const team = searchParams.get('team')?.trim();
  const opponent = searchParams.get('opponent')?.trim();
  const gameDate = searchParams.get('game_date')?.trim();
  const eventId = searchParams.get('event_id')?.trim();

  if (!player) {
    return NextResponse.json({ error: 'Player name required', props: [] }, { status: 400 });
  }

  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({
      props: [],
      message: 'ODDS_API_KEY not set. Add it to .env.local to use AFL player props.',
    });
  }

  let resolvedEventId = eventId ?? null;
  if (!resolvedEventId && team && opponent) {
    let aflCache = getAflOddsCache();
    if (!aflCache?.games?.length) {
      await refreshAflOddsData();
      aflCache = getAflOddsCache();
    }
    resolvedEventId = aflCache ? getAflEventIdForMatchup(team, opponent, gameDate || undefined) : null;
  }

  if (!resolvedEventId) {
    return NextResponse.json({
      props: [],
      message: 'Could not resolve game. Pass event_id or team + opponent (and ensure game odds are loaded).',
    });
  }

  const cacheKey = `${CACHE_KEY_PREFIX}:${resolvedEventId}:${normalizeName(player)}`;
  const cached = cache.get<MergedCache>(cacheKey);
  if (cached && typeof cached === 'object' && Array.isArray(cached[stat])) {
    return NextResponse.json({ props: cached[stat] });
  }

  let promise = inFlight.get(cacheKey);
  if (!promise) {
    promise = (async (): Promise<MergedCache> => {
      try {
        const apiKeyEnc = encodeURIComponent(apiKey);
        const baseUrl = `${ODDS_API_BASE}/sports/${AFL_SPORT}/events/${resolvedEventId}/odds?regions=au&oddsFormat=american&apiKey=${apiKeyEnc}`;

        const results = await Promise.all(
          ALL_STATS.map(async (s) => {
            const marketKey = STAT_TO_MARKET[s] ?? s;
            const url = `${baseUrl}&markets=${encodeURIComponent(marketKey)}`;
            const res = await fetch(url, { next: { revalidate: 0 } });
            if (!res.ok) return { stat: s, bookmakers: [] as OddsApiBookmaker[] };
            const data = (await res.json()) as { bookmakers?: OddsApiBookmaker[] };
            return { stat: s, bookmakers: data?.bookmakers ?? [] };
          })
        );

        const merged: MergedCache = {};
        for (const { stat: s, bookmakers } of results) {
          merged[s] = parseMarketToProps(player, s, bookmakers);
        }

        cache.set(cacheKey, merged, PLAYER_PROPS_CACHE_TTL_MINUTES);
        return merged;
      } finally {
        inFlight.delete(cacheKey);
      }
    })();
    inFlight.set(cacheKey, promise);
  }

  try {
    const merged = await promise;
    const props = merged[stat] ?? [];
    return NextResponse.json({ props });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AFL player-props]', message);
    return NextResponse.json({ props: [], error: message });
  }
}
