/**
 * AFL player props cache: goals and disposals only.
 * Refreshed every 90 min with game odds; one fetch per event (4 markets) so we never spam the API.
 */

import { getAflOddsCache, type AflGameOdds } from '@/lib/refreshAflOdds';
import sharedCache from '@/lib/sharedCache';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const AFL_SPORT = 'aussierules_afl';

export const AFL_PP_CACHE_KEY_PREFIX = 'afl_pp_v3';
export const AFL_PP_CACHE_TTL_SECONDS = 90 * 60;

/** Only these stats are cached (goals + disposals); fewer API calls. */
export const CACHED_PP_STATS = ['disposals', 'disposals_over', 'anytime_goal_scorer', 'goals_over'] as const;
const STAT_TO_MARKET: Record<string, string> = {
  disposals: 'player_disposals',
  disposals_over: 'player_disposals_over',
  anytime_goal_scorer: 'player_goal_scorer_anytime',
  goals_over: 'player_goals_scored_over',
};

export type PropItem = { bookmaker: string; line: number; overPrice?: number; underPrice?: number; yesPrice?: number; noPrice?: number };

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

/** Per-event cache: normalized player name -> stat -> PropItem[] */
export type EventPlayerPropsCache = Record<string, Record<string, PropItem[]>>;

const EXCLUDED = ['tabtouch', 'playup', 'betrivers', 'bet rivers'];

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

function isExcluded(key: string | undefined, title: string | undefined): boolean {
  const k = (key ?? '').trim().toLowerCase();
  const t = (title ?? '').trim().toLowerCase();
  return EXCLUDED.some((x) => k === x || t === x || k.includes(x) || t.includes(x));
}

function parseMarketToProps(player: string, stat: string, bookmakers: OddsApiBookmaker[]): PropItem[] {
  if (!Array.isArray(bookmakers)) return [];
  const marketKey = STAT_TO_MARKET[stat] ?? stat;
  const props: PropItem[] = [];
  const isYesNo = stat === 'anytime_goal_scorer';
  const isOverOnly = stat === 'disposals_over' || stat === 'goals_over';

  for (const book of bookmakers) {
    if (isExcluded(book.key, book.title)) continue;
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

const RELEVANT_MARKET_KEYS = new Set([
  'player_disposals',
  'player_disposals_over',
  'player_goal_scorer_anytime',
  'player_goals_scored_over',
]);

/** Collect all unique player names from outcomes (description or name) in the 4 markets. */
function collectPlayerNames(bookmakers: OddsApiBookmaker[]): Set<string> {
  const names = new Set<string>();
  for (const book of bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      if (!RELEVANT_MARKET_KEYS.has(market.key)) continue;
      for (const o of market.outcomes ?? []) {
        const outcome = o as OddsApiOutcome & { description?: string };
        const desc = (outcome.description ?? '').trim();
        const name = (outcome.name ?? '').trim();
        if (desc) names.add(desc);
        if (name && !/^(over|under|yes|no)/i.test(name)) names.add(name);
      }
    }
  }
  return names;
}

/**
 * Build per-player cache for one event from raw bookmakers response (goals + disposals markets).
 */
function buildEventCacheFromBookmakers(bookmakers: OddsApiBookmaker[]): EventPlayerPropsCache {
  const players = collectPlayerNames(bookmakers);
  const cache: EventPlayerPropsCache = {};

  for (const playerName of players) {
    if (!playerName.trim()) continue;
    const key = normalizeName(playerName);
    if (!key) continue;
    cache[key] = {};
    for (const stat of CACHED_PP_STATS) {
      const props = parseMarketToProps(playerName, stat, bookmakers);
      if (props.length) cache[key][stat] = props;
    }
    if (Object.keys(cache[key]).length === 0) delete cache[key];
  }

  return cache;
}

/**
 * Refresh player props cache for all events (goals + disposals only).
 * Pass `games` from the same request's refreshAflOddsData() so we don't rely on cache read (avoids Redis/instance timing).
 * If `games` not provided, falls back to getAflOddsCache().
 */
export async function refreshAflPlayerPropsCache(gamesFromCaller?: AflGameOdds[]): Promise<{
  success: boolean;
  eventsRefreshed: number;
  playersWithProps: number;
  error?: string;
}> {
  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    return { success: false, eventsRefreshed: 0, playersWithProps: 0, error: 'ODDS_API_KEY not set' };
  }

  let games = gamesFromCaller ?? (await getAflOddsCache())?.games ?? [];
  if (!games.length) {
    return { success: false, eventsRefreshed: 0, playersWithProps: 0, error: 'No games in odds cache. Run game odds refresh first.' };
  }

  const apiKeyEnc = encodeURIComponent(apiKey);
  const marketsParam = CACHED_PP_STATS.map((s) => STAT_TO_MARKET[s] ?? s).join(',');

  let eventsRefreshed = 0;
  let playersWithProps = 0;
  for (const game of games) {
    try {
      const url = `${ODDS_API_BASE}/sports/${AFL_SPORT}/events/${game.gameId}/odds?regions=au&oddsFormat=american&markets=${encodeURIComponent(marketsParam)}&apiKey=${apiKeyEnc}`;
      const res = await fetch(url, { next: { revalidate: 0 } });
      if (!res.ok) continue;
      const data = (await res.json()) as { bookmakers?: OddsApiBookmaker[] };
      const bookmakers = data?.bookmakers ?? [];
      if (!bookmakers.length) continue;

      const eventCache = buildEventCacheFromBookmakers(bookmakers);
      const cacheKey = `${AFL_PP_CACHE_KEY_PREFIX}:${game.gameId}`;
      await sharedCache.setJSON(cacheKey, eventCache, AFL_PP_CACHE_TTL_SECONDS);
      eventsRefreshed++;
      playersWithProps += Object.keys(eventCache).length;
    } catch {
      // skip this event, continue with others
    }
  }

  return { success: true, eventsRefreshed, playersWithProps };
}

/** Read cached player props for one event+player. Returns null if not in cache. */
export async function getAflPlayerPropsFromCache(
  eventId: string,
  playerName: string,
  stat: string
): Promise<PropItem[] | null> {
  if (!CACHED_PP_STATS.includes(stat as (typeof CACHED_PP_STATS)[number])) return null;
  const key = `${AFL_PP_CACHE_KEY_PREFIX}:${eventId}`;
  const eventCache = await sharedCache.getJSON<EventPlayerPropsCache>(key);
  if (!eventCache || typeof eventCache !== 'object') return null;
  const playerKey = normalizeName(playerName);
  const playerData = eventCache[playerKey];
  if (!playerData || typeof playerData !== 'object') return null;
  const props = playerData[stat];
  return Array.isArray(props) ? props : null;
}

/** Read full cached player props for one event+player (all 4 stats). For ?all=1. */
export async function getAflPlayerPropsAllFromCache(
  eventId: string,
  playerName: string
): Promise<Record<string, PropItem[]> | null> {
  const key = `${AFL_PP_CACHE_KEY_PREFIX}:${eventId}`;
  const eventCache = await sharedCache.getJSON<EventPlayerPropsCache>(key);
  if (!eventCache || typeof eventCache !== 'object') return null;
  const playerKey = normalizeName(playerName);
  const playerData = eventCache[playerKey];
  if (!playerData || typeof playerData !== 'object') return null;
  return playerData;
}
