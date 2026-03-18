/**
 * AFL player props cache: goals and disposals only.
 * Refreshed every 90 min with game odds; one fetch per event (4 markets). ~30 API credits per full refresh.
 */

import { getAflOddsCache, type AflGameOdds } from '@/lib/refreshAflOdds';
import sharedCache from '@/lib/sharedCache';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const AFL_SPORT = 'aussierules_afl';

export const AFL_PP_CACHE_KEY_PREFIX = 'afl_pp_v3';
/** 2.5 hours so props refresh sooner if a player is ruled out; old cache displayed until new refresh succeeds. */
/** Never expire; only replaced when cron runs (same as NBA – cache only replaced, not expired). */
export const AFL_PP_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60 * 10; // 10 years – effectively never expire, only replace on cron

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
  playerNames: string[];
  error?: string;
}> {
  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    return { success: false, eventsRefreshed: 0, playersWithProps: 0, playerNames: [], error: 'ODDS_API_KEY not set' };
  }

  let games = gamesFromCaller ?? (await getAflOddsCache())?.games ?? [];
  if (!games.length) {
    return { success: false, eventsRefreshed: 0, playersWithProps: 0, playerNames: [], error: 'No games in odds cache. Run game odds refresh first.' };
  }

  const apiKeyEnc = encodeURIComponent(apiKey);
  const marketsParam = CACHED_PP_STATS.map((s) => STAT_TO_MARKET[s] ?? s).join(',');

  const results = await Promise.all(
    games.map(async (game) => {
      try {
        const url = `${ODDS_API_BASE}/sports/${AFL_SPORT}/events/${game.gameId}/odds?regions=au&oddsFormat=american&markets=${encodeURIComponent(marketsParam)}&apiKey=${apiKeyEnc}`;
        const res = await fetch(url, { next: { revalidate: 0 } });
        if (!res.ok) return null;
        const data = (await res.json()) as { bookmakers?: OddsApiBookmaker[] };
        const bookmakers = data?.bookmakers ?? [];
        if (!bookmakers.length) return null;

        const eventCache = buildEventCacheFromBookmakers(bookmakers);
        const names = Object.keys(eventCache);
        if (names.length === 0) return null;
        const cacheKey = `${AFL_PP_CACHE_KEY_PREFIX}:${game.gameId}`;
        await sharedCache.setJSON(cacheKey, eventCache, AFL_PP_CACHE_TTL_SECONDS);
        return { events: 1, players: names.length, names: names.map((n) => toDisplayName(n)) };
      } catch {
        return null;
      }
    })
  );

  let eventsRefreshed = 0;
  let playersWithProps = 0;
  const playerNames: string[] = [];
  for (const r of results) {
    if (!r) continue;
    eventsRefreshed += r.events;
    playersWithProps += r.players;
    playerNames.push(...r.names);
  }

  if (eventsRefreshed === 0) {
    return {
      success: false,
      eventsRefreshed,
      playersWithProps,
      playerNames,
      error: 'No AFL player props were refreshed from Odds API (0 events updated)',
    };
  }

  return { success: true, eventsRefreshed, playersWithProps, playerNames };
}

/** Same set of name tokens (handles "errol gulden" vs "gulden errol" from API "Gulden, Errol"). */
function sameNameTokens(a: string, b: string): boolean {
  const ta = normalizeName(a).split(/\s+/).filter(Boolean).sort();
  const tb = normalizeName(b).split(/\s+/).filter(Boolean).sort();
  if (ta.length !== tb.length) return false;
  return ta.every((t, i) => t === tb[i]);
}

/** Find cache key for player: exact normalized first, then same tokens, then namesMatch. */
function findPlayerKeyInCache(eventCache: EventPlayerPropsCache, playerName: string): string | null {
  const exact = normalizeName(playerName);
  if (exact && eventCache[exact]) return exact;
  for (const cachedKey of Object.keys(eventCache)) {
    if (sameNameTokens(playerName, cachedKey) || namesMatch(playerName, cachedKey)) return cachedKey;
  }
  return null;
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
  const playerKey = findPlayerKeyInCache(eventCache, playerName);
  if (!playerKey) return null;
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
  const playerKey = findPlayerKeyInCache(eventCache, playerName);
  if (!playerKey) return null;
  const playerData = eventCache[playerKey];
  if (!playerData || typeof playerData !== 'object') return null;
  return playerData;
}

/** Display label for list API (normalized key -> Title Case). */
function toDisplayName(key: string): string {
  return (key || '')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Convert decimal odds to American string for props page. */
function decimalToAmerican(dec: number): string {
  if (!Number.isFinite(dec) || dec <= 1) return 'N/A';
  if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
  return `${Math.round(-100 / (dec - 1))}`;
}

export type AflListPropRow = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  playerName: string;
  statType: string;
  line: number;
  overOdds: string;
  underOdds: string;
  yesOdds?: string;
  noOdds?: string;
  bookmaker: string;
};

/**
 * List props from cache for a given list of games. Games are the single source of truth (e.g. from Odds API).
 * Use this so matchups always come from the provided games, never from a stale cache.
 */
export async function listAflPlayerPropsFromCacheWithGames(games: AflGameOdds[]): Promise<{
  props: AflListPropRow[];
  games: AflGameOdds[];
}> {
  const props: AflListPropRow[] = [];
  for (const game of games) {
    const eventCache = await sharedCache.getJSON<EventPlayerPropsCache>(
      `${AFL_PP_CACHE_KEY_PREFIX}:${game.gameId}`
    );
    if (!eventCache || typeof eventCache !== 'object') continue;

    for (const [playerKey, playerData] of Object.entries(eventCache)) {
      if (!playerData || typeof playerData !== 'object') continue;
      const playerName = toDisplayName(playerKey);

      for (const stat of CACHED_PP_STATS) {
        const items = playerData[stat];
        if (!Array.isArray(items) || !items.length) continue;

        for (const item of items) {
          const line = typeof item.line === 'number' ? item.line : 0;
          const overOdds =
            item.overPrice != null ? decimalToAmerican(item.overPrice) : 'N/A';
          const underOdds =
            item.underPrice != null ? decimalToAmerican(item.underPrice) : 'N/A';
          const yesOdds =
            item.yesPrice != null ? decimalToAmerican(item.yesPrice) : undefined;
          const noOdds =
            item.noPrice != null ? decimalToAmerican(item.noPrice) : undefined;
          props.push({
            gameId: game.gameId,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            commenceTime: game.commenceTime,
            playerName,
            statType: stat,
            line,
            overOdds,
            underOdds,
            yesOdds,
            noOdds,
            bookmaker: item.bookmaker || 'Unknown',
          });
        }
      }
    }
  }
  return { props, games };
}

/**
 * List all cached AFL player props for all events (for props page).
 * Uses odds cache for game list – prefer listAflPlayerPropsFromCacheWithGames(canonicalGames) so games come from API.
 */
export async function listAflPlayerPropsFromCache(): Promise<{
  props: AflListPropRow[];
  games: AflGameOdds[];
} | null> {
  const cache = await getAflOddsCache();
  const games = cache?.games ?? [];
  if (!games.length) return null;
  return listAflPlayerPropsFromCacheWithGames(games);
}
