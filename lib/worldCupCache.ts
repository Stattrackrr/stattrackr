import { loadInternationalStatsByPlayerName, classifyIntlPositionString, getWorldCupDvpStats, isCompletedWorldCupFinalsMatch, type IntlPositionBucket } from '@/lib/internationalDashboard';
import { WC2026_CACHE_KEYS } from '@/lib/worldCupOpponentBreakdown';
import {
  normalizeWorldCupPlayerName,
  WORLD_CUP_PLAYER_INDEX_CACHE_KEY,
  resolveWorldCupPropsPlayerPhotoUrl,
  type WorldCupPlayerIndexEntry,
} from '@/lib/worldCupPlayerIndex';
import { resolveWorldCupFlagCode, worldCupTeamsMatch } from '@/lib/worldCupFlags';
import { AsyncLocalStorage } from 'async_hooks';
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import sharedCache from '@/lib/sharedCache';
import { FIFA_NAME_TO_CODE } from '@/lib/worldCupFlags';
import type { WorldCupPlayerOddsBook } from '@/lib/impliedProbability';
import { formatWorldCupPlayerDisplayName, getWorldCupNameAliases, resolveWorldCupAliasName } from '@/lib/worldCupPlayerAliases';

/**
 * Permanent (no-expiry) Supabase-backed cache for World Cup BDL data.
 *
 * Entries are stored in the `world_cup_cache` table and never expire — once a
 * search query or player's stats are resolved from BDL they are reused forever
 * (until explicitly re-upserted). This keeps us off the BDL API on repeat
 * searches/selections.
 */

const WORLD_CUP_CACHE_TABLE = 'world_cup_cache';
const WORLD_CUP_CACHE_WARNINGS = new Set<string>();

function warnWorldCupCache(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${context}:${message}`;
  if (WORLD_CUP_CACHE_WARNINGS.has(key)) return;
  WORLD_CUP_CACHE_WARNINGS.add(key);
  console.warn(`[World Cup Cache] ${context}:`, error);
}

/** Delete all cache rows whose key starts with `prefix`. Returns rows removed. */
export async function deleteWorldCupCacheByPrefix(prefix: string): Promise<number> {
  if (!prefix) return 0;
  try {
    const { data, error } = await supabaseAdmin
      .from(WORLD_CUP_CACHE_TABLE)
      .delete()
      .like('cache_key', `${prefix}%`)
      .select('cache_key');

    if (error) {
      warnWorldCupCache(`Failed to delete cache prefix ${prefix}`, error);
      return 0;
    }
    return Array.isArray(data) ? data.length : 0;
  } catch (error) {
    warnWorldCupCache(`Failed to delete cache prefix ${prefix}`, error);
    return 0;
  }
}

/** Delete a single cache row by exact key. */
export async function deleteWorldCupCacheKey(cacheKey: string): Promise<boolean> {
  if (!cacheKey) return false;
  try {
    const { error } = await supabaseAdmin.from(WORLD_CUP_CACHE_TABLE).delete().eq('cache_key', cacheKey);
    if (error) {
      warnWorldCupCache(`Failed to delete cache key ${cacheKey}`, error);
      return false;
    }
    return true;
  } catch (error) {
    warnWorldCupCache(`Failed to delete cache key ${cacheKey}`, error);
    return false;
  }
}

function isCorruptWorldCupCacheReadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const details =
    typeof error === 'object' && error != null && 'details' in error
      ? String((error as { details?: string }).details ?? '')
      : '';
  const combined = `${msg}\n${details}`.toLowerCase();
  return (
    combined.includes('syntaxerror') ||
    combined.includes('unterminated string') ||
    combined.includes('json.parse') ||
    combined.includes('unexpected token') ||
    combined.includes('unexpected end of json')
  );
}

/** Read a cached value by key. Returns null when missing or on error. */
export async function getWorldCupCache<T = unknown>(cacheKey: string): Promise<T | null> {
  if (!cacheKey) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from(WORLD_CUP_CACHE_TABLE)
      .select('payload')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (error) {
      if (isCorruptWorldCupCacheReadError(error)) {
        console.warn(
          `[World Cup Cache] Corrupt JSON for ${cacheKey} — deleting row and treating as cache miss`
        );
        await deleteWorldCupCacheKey(cacheKey);
        if (cacheKey.startsWith('wc:bdl-dvp-supplement:')) clearWcBdlSupplementPayloadMem();
      } else {
        warnWorldCupCache(`Failed to read cache for ${cacheKey}`, error);
      }
      return null;
    }
    if (!data) return null;
    return (data as { payload: T }).payload ?? null;
  } catch (error) {
    if (isCorruptWorldCupCacheReadError(error)) {
      console.warn(
        `[World Cup Cache] Corrupt JSON for ${cacheKey} — deleting row and treating as cache miss`
      );
      await deleteWorldCupCacheKey(cacheKey);
      if (cacheKey.startsWith('wc:bdl-dvp-supplement:')) clearWcBdlSupplementPayloadMem();
    } else {
      warnWorldCupCache(`Failed to read cache for ${cacheKey}`, error);
    }
    return null;
  }
}

/**
 * Persist a value permanently (no TTL). Upserts on `cache_key` so re-running
 * the same key refreshes the stored payload. Returns true on success.
 */
export async function setWorldCupCache(cacheKey: string, payload: unknown): Promise<boolean> {
  if (!cacheKey || payload == null) return false;
  try {
    const serialized = JSON.stringify(payload);
    if (!serialized || serialized.length < 2) {
      warnWorldCupCache(`Refusing to write empty/invalid cache for ${cacheKey}`, new Error('empty payload'));
      return false;
    }
    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin.from(WORLD_CUP_CACHE_TABLE).upsert(
      {
        cache_key: cacheKey,
        payload,
        generated_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'cache_key' }
    );

    if (error) {
      warnWorldCupCache(`Failed to write cache for ${cacheKey}`, error);
      return false;
    }
    return true;
  } catch (error) {
    warnWorldCupCache(`Failed to write cache for ${cacheKey}`, error);
    return false;
  }
}

// ── Cache vs live BDL tracing (WC_CACHE_DEBUG=1 or dev mode) ─────────────────

export type WcDataSource =
  | 'supabase-cache'
  | 'cache-miss'
  | 'bdl-live'
  | 'bdl-memory'
  | 'supabase-intl'
  | 'computed'
  | 'match-detail-fallback';

export type WcCacheDebugSummary = {
  bdlLiveCount: number;
  bdlLiveCalls: string[];
  sources: Record<string, { source: WcDataSource; detail?: string }>;
  summary: string;
};

type WcCacheDebugContext = {
  sources: Record<string, { source: WcDataSource; detail?: string }>;
  bdlLiveCalls: string[];
};

const wcCacheDebugAls = new AsyncLocalStorage<WcCacheDebugContext>();

/** True when ?debug=1 or WC_CACHE_DEBUG=1 (set WC_CACHE_DEBUG=0 to silence). */
export function isWcCacheDebug(request?: NextRequest | null): boolean {
  if (process.env.WC_CACHE_DEBUG === '0') return false;
  if (process.env.WC_CACHE_DEBUG === '1') return true;
  if (request?.nextUrl.searchParams.get('debug') === '1') return true;
  return false;
}

export async function runWithWcCacheDebug<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  return wcCacheDebugAls.run({ sources: {}, bdlLiveCalls: [] }, fn);
}

export function recordWcSource(key: string, source: WcDataSource, detail?: string): void {
  const ctx = wcCacheDebugAls.getStore();
  if (!ctx) return;
  ctx.sources[key] = { source, detail };
  if (source === 'bdl-live') ctx.bdlLiveCalls.push(detail || key);
}

export function wcCacheLog(label: string, data?: Record<string, unknown>): void {
  if (!wcCacheDebugAls.getStore() && process.env.WC_CACHE_DEBUG !== '1') return;
  console.log(label, data ?? '');
}

export function getWcCacheDebugSummary(): WcCacheDebugSummary | null {
  const ctx = wcCacheDebugAls.getStore();
  if (!ctx) return null;
  const bdlLiveCount = ctx.bdlLiveCalls.length;
  const summary =
    bdlLiveCount === 0
      ? 'cache/supabase only - no live BDL'
      : bdlLiveCount === 1 && ctx.sources.featureLineups?.source === 'bdl-live'
        ? '1 intentional live BDL call (fixture lineups)'
        : `${bdlLiveCount} live BDL call(s): ${ctx.bdlLiveCalls.slice(0, 8).join(' | ')}`;
  return {
    bdlLiveCount,
    bdlLiveCalls: [...ctx.bdlLiveCalls],
    sources: { ...ctx.sources },
    summary,
  };
}

export function attachWcDebug<T extends Record<string, unknown>>(
  payload: T,
  debug: boolean
): T & { _wcDebug?: WcCacheDebugSummary } {
  if (!debug) return payload;
  const summary = getWcCacheDebugSummary();
  if (!summary) return payload;
  return { ...payload, _wcDebug: summary };
}

export function wcDebugResponseHeaders(debug: boolean): Record<string, string> {
  if (!debug) return {};
  const summary = getWcCacheDebugSummary();
  if (!summary) return { 'X-WC-Cache-Debug': '1' };
  return {
    'X-WC-Cache-Debug': '1',
    'X-WC-BDL-Live-Count': String(summary.bdlLiveCount),
    'X-WC-Cache-Summary': summary.summary.slice(0, 240),
  };
}

export function logWcCacheRequestComplete(endpoint: string, debug: boolean): WcCacheDebugSummary | null {
  if (!debug) return null;
  const summary = getWcCacheDebugSummary();
  if (!summary) return null;
  console.log(`[wc-cache] ${endpoint} | ${summary.summary}`);
  return summary;
}

type WorldCupPlayerOddsFetchResult = {
  fixtureId: number | null;
  books: WorldCupPlayerOddsBook[];
  generatedAt: string;
  source: 'cache' | 'live' | 'none';
  parserVersion?: number;
};

export type WorldCupPlayerOddsProbeHit = {
  bookmaker: string;
  betId: string | number | null;
  betName: string;
  kind: string | null;
  betScope: 'match' | 'other' | 'generic';
  value: string;
  odd: string | null;
  handicap: string | number | null;
  american: string;
};

export type WorldCupPlayerOddsProbeResult = {
  fixtureId: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  matchDate: string | null;
  playerName: string;
  parsedBooks: WorldCupPlayerOddsBook[];
  rawHits: WorldCupPlayerOddsProbeHit[];
  bareOverUnderInPlayerMarkets: Array<{
    bookmaker: string;
    betId: string | number | null;
    betName: string;
    value: string;
    odd: string | null;
    american: string;
    handicap: string | number | null;
  }>;
};

const WC_AF_ODDS_BASE = 'https://v3.football.api-sports.io';
const WC_AF_LEAGUE_ID = 1;
const WC_AF_SEASON = 2026;
const WC_AF_ODDS_CACHE_PREFIX = 'wc_af_player_odds_v9';
const WC_AF_ODDS_PARSER_VERSION = 3;
const WC_AF_ODDS_CACHE_TTL_SECONDS = 30 * 60;

export async function fetchWorldCupPlayerOdds(opts: {
  playerName: string;
  homeTeam: string;
  awayTeam: string;
  matchDate?: string | null;
}): Promise<WorldCupPlayerOddsFetchResult> {
  const empty: WorldCupPlayerOddsFetchResult = {
    fixtureId: null,
    books: [],
    generatedAt: new Date().toISOString(),
    source: 'none',
  };
  if (!opts.playerName?.trim() || !opts.homeTeam?.trim() || !opts.awayTeam?.trim()) return empty;

  const cacheKey = `${WC_AF_ODDS_CACHE_PREFIX}:${wcAfNormalizeTeam(opts.homeTeam)}:${wcAfNormalizeTeam(opts.awayTeam)}:${wcAfFixtureDateKey(opts.matchDate)}:${wcAfNormalizePlayer(opts.playerName)}`;
  const cached = await sharedCache.getJSON<WorldCupPlayerOddsFetchResult>(cacheKey);
  if (cached?.books?.length && cached.parserVersion === WC_AF_ODDS_PARSER_VERSION) {
    return { ...cached, source: 'cache' };
  }

  try {
    const fixtureId = await wcAfResolveFixtureId(opts);
    if (!fixtureId) return empty;

    const rawKey = `${WC_AF_ODDS_CACHE_PREFIX}:raw:${fixtureId}`;
    let oddsRows = await sharedCache.getJSON<Array<{ bookmakers?: Array<{ name?: string; bets?: Array<{ name?: string; values?: Array<{ value?: string; odd?: string }> }> }> }>>(rawKey);
    if (!oddsRows?.length) {
      oddsRows = await wcAfFetchOddsRows(fixtureId);
      if (oddsRows.length) await sharedCache.setJSON(rawKey, oddsRows, WC_AF_ODDS_CACHE_TTL_SECONDS);
    }

    const books = wcAfBuildPlayerOddsBooks(oddsRows ?? [], opts.playerName);
    const result: WorldCupPlayerOddsFetchResult = {
      fixtureId,
      books,
      generatedAt: new Date().toISOString(),
      source: books.length ? 'live' : 'none',
      parserVersion: WC_AF_ODDS_PARSER_VERSION,
    };
    if (books.length) await sharedCache.setJSON(cacheKey, result, WC_AF_ODDS_CACHE_TTL_SECONDS);
    return result;
  } catch (error) {
    console.warn('[wc-cache] API-Football player odds fetch failed:', error);
    return empty;
  }
}

const WC_AF_SPECIAL_LETTER_MAP: Record<string, string> = {
  '\u00f8': 'o',
  '\u0153': 'oe',
  '\u00e6': 'ae',
  '\u00e5': 'a',
  '\u00df': 'ss',
  '\u00fe': 'th',
  '\u00f0': 'd',
  '\u0111': 'd',
  '\u0142': 'l',
  '\u0131': 'i',
  '\u014b': 'n',
  '\u0138': 'k',
  '\u02bb': '',
  "'": '',
};

const WC_AF_SPECIAL_LETTER_PATTERN = new RegExp(
  '[\\u00f8\\u0153\\u00e6\\u00e5\\u00df\\u00fe\\u00f0\\u0111\\u0142\\u0131\\u014b\\u0138\\u02bb\']',
  'g'
);

function wcAfNormalizePlayer(value: string): string {
  const folded = String(value || '')
    .toLowerCase()
    .replace(WC_AF_SPECIAL_LETTER_PATTERN, (ch) => WC_AF_SPECIAL_LETTER_MAP[ch] ?? ch);
  return folded
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function wcAfExpandPlayerLabel(value: string): string {
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.includes(',')) {
    const parts = text.split(',').map((part) => part.trim());
    if (parts.length === 2 && parts[0] && parts[1]) text = `${parts[1]} ${parts[0]}`;
  }
  return text;
}

function wcAfPlayerNameKeys(query: string): Set<string> {
  const normalized = wcAfNormalizePlayer(wcAfExpandPlayerLabel(query));
  const canonical = resolveWorldCupAliasName(normalized);
  const keys = new Set<string>([normalized, canonical].filter(Boolean));
  for (const alias of getWorldCupNameAliases(canonical)) keys.add(alias);
  return keys;
}

function wcAfPlayerTokensMatch(queryKeys: Set<string>, candidate: string): boolean {
  const candidateNorm = wcAfNormalizePlayer(wcAfExpandPlayerLabel(candidate));
  if (!candidateNorm) return false;
  if (queryKeys.has(candidateNorm)) return true;

  const candidateParts = candidateNorm.split(/\s+/).filter(Boolean);
  if (candidateParts.length < 2) return false;

  for (const query of queryKeys) {
    const queryParts = query.split(/\s+/).filter(Boolean);
    if (queryParts.length < 2) continue;
    if (queryParts.at(-1) !== candidateParts.at(-1)) continue;

    const queryFirst = queryParts[0] ?? '';
    const candidateFirst = candidateParts[0] ?? '';
    if (queryFirst === candidateFirst) return true;

    const queryInitial = queryFirst.replace(/\./g, '');
    const candidateInitial = candidateFirst.replace(/\./g, '');
    if (queryInitial.length === 1 && candidateFirst.startsWith(queryInitial)) return true;
    if (candidateInitial.length === 1 && queryFirst.startsWith(candidateInitial)) return true;
  }

  return false;
}

function wcAfPlayerMatch(query: string, candidate: string): boolean {
  if (!String(candidate || '').trim()) return false;
  return wcAfPlayerTokensMatch(wcAfPlayerNameKeys(query), candidate);
}

function wcAfNormalizeTeam(value: string): string {
  const key = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return FIFA_NAME_TO_CODE[key] ? key : key;
}

function wcAfFixtureDateKey(isoDate: string | null | undefined): string {
  if (!isoDate) return 'unknown';
  const d = new Date(isoDate);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 10);
}

async function wcAfFetch<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY is not configured');
  const url = new URL(`${WC_AF_ODDS_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WC_AF_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'x-apisports-key': key },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`API-Football ${path} timed out after ${WC_AF_FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`API-Football ${path} failed: ${response.status}`);
  const json = (await response.json()) as { response?: T };
  return (json.response ?? []) as T;
}

async function wcAfFetchOddsRows(fixtureId: number) {
  const prematch = await wcAfFetch<WcAfOddsRow[]>('/odds', { fixture: fixtureId });
  if (prematch.length) return prematch;
  return wcAfFetch<WcAfOddsRow[]>('/odds/live', { fixture: fixtureId });
}

const WC_AF_TEAM_SEARCH_ALIASES: Record<string, string[]> = {
  netherlands: ['netherlands', 'holland'],
  'ivory coast': ['ivory coast', 'cote d ivoire', "cote d'ivoire", 'cote divoire', 'ivoire'],
  usa: ['usa', 'united states', 'united states of america'],
  'south korea': ['south korea', 'korea republic', 'korea'],
  iran: ['iran', 'ir iran'],
  'cape verde': ['cape verde', 'cabo verde', 'cape verde islands'],
  'cabo verde': ['cape verde', 'cabo verde', 'cape verde islands'],
};

async function wcAfSearchTeamId(teamName: string): Promise<number | null> {
  const normalized = wcAfNormalizeTeam(teamName);
  const needles = WC_AF_TEAM_SEARCH_ALIASES[normalized] ?? [teamName, normalized];
  const searchPlans: Array<Record<string, string | number>> = [];
  for (const needle of needles) {
    searchPlans.push({ search: needle, league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON });
    searchPlans.push({ search: needle });
  }

  for (const params of searchPlans) {
    const teams = await wcAfFetch<Array<{ team?: { id?: number; name?: string; national?: boolean } }>>('/teams', params);
    const nationalTeams = teams.filter((row) => row?.team?.national !== false);
    const pool = nationalTeams.length ? nationalTeams : teams;
    const team = pool.find((row) => {
      const name = String(row?.team?.name ?? '');
      return wcAfTeamMatch(name, teamName) || wcAfTeamMatch(name, String(params.search ?? ''));
    });
    const teamId = Number(team?.team?.id);
    if (Number.isFinite(teamId)) return teamId;
  }
  return null;
}

function wcAfPickFixtureForTeams<
  T extends { fixture?: { id?: number; date?: string; status?: { short?: string } }; teams?: { home?: { name?: string }; away?: { name?: string } } },
>(
  fixtures: T[],
  opts: { homeTeam: string; awayTeam: string }
): T | null {
  return (
    fixtures.find((row) => {
      const home = row.teams?.home?.name ?? '';
      const away = row.teams?.away?.name ?? '';
      return (
        (wcAfTeamMatch(home, opts.homeTeam) && wcAfTeamMatch(away, opts.awayTeam)) ||
        (wcAfTeamMatch(home, opts.awayTeam) && wcAfTeamMatch(away, opts.homeTeam))
      );
    }) ?? null
  );
}

type WcAfFixtureTeam = { name?: string; code?: string; logo?: string };
type WcAfFixtureRow = {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  teams?: { home?: WcAfFixtureTeam; away?: WcAfFixtureTeam };
};

async function wcAfListFixtures(params: Record<string, string | number>) {
  return wcAfFetch<WcAfFixtureRow[]>('/fixtures', params);
}

async function wcAfResolveFixtureId(opts: {
  homeTeam: string;
  awayTeam: string;
  matchDate?: string | null;
}): Promise<number | null> {
  const dateKey = wcAfFixtureDateKey(opts.matchDate);
  const fixtureCacheKey = `${WC_AF_ODDS_CACHE_PREFIX}:fixture:${wcAfNormalizeTeam(opts.homeTeam)}:${wcAfNormalizeTeam(opts.awayTeam)}:${dateKey}`;
  const cached = await sharedCache.getJSON<number>(fixtureCacheKey);
  if (cached && Number.isFinite(cached)) return cached;

  const todayKey = new Date().toISOString().slice(0, 10);
  const teamId = await wcAfSearchTeamId(opts.homeTeam);
  const attempts: Array<{ label: string; params: Record<string, string | number> }> = [];

  if (opts.matchDate && dateKey !== 'unknown') {
    attempts.push({
      label: 'match-date',
      params: { league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, from: dateKey, to: dateKey },
    });
  }
  if (teamId) {
    attempts.push({
      label: 'live',
      params: { team: teamId, league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, live: 'all' },
    });
    attempts.push({
      label: 'today',
      params: { team: teamId, league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, date: todayKey },
    });
  }
  attempts.push({ label: 'live-all', params: { league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, live: 'all' } });
  attempts.push({ label: 'today-all', params: { league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, date: todayKey } });
  if (!opts.matchDate) {
    attempts.push({ label: 'next', params: { league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, next: 10 } });
  }
  attempts.push({ label: 'last', params: { league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, last: 10 } });

  for (const attempt of attempts) {
    const fixtures = await wcAfListFixtures(attempt.params);
    const match = wcAfPickFixtureForTeams(fixtures, opts);
    const fixtureId = Number(match?.fixture?.id);
    if (Number.isFinite(fixtureId)) {
      await sharedCache.setJSON(fixtureCacheKey, fixtureId, WC_AF_ODDS_CACHE_TTL_SECONDS);
      return fixtureId;
    }
  }

  return null;
}

function wcAfTeamMatch(a: string, b: string): boolean {
  if (worldCupTeamsMatch(a, b)) return true;
  const na = wcAfNormalizeTeam(a);
  const nb = wcAfNormalizeTeam(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function wcAfDecimalToAmerican(decimal: number): string {
  if (!Number.isFinite(decimal) || decimal <= 1) return 'N/A';
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return String(Math.round(-100 / (decimal - 1)));
}

function wcAfFormatOdd(value: string | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'N/A';
  if (/^[+-]\d+$/.test(raw)) {
    const american = Number.parseInt(raw, 10);
    return Number.isFinite(american) ? (american > 0 ? `+${american}` : String(american)) : 'N/A';
  }
  const n = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return 'N/A';
  if (n > 1 && n < 500) return wcAfDecimalToAmerican(n);
  if (n >= 100) return `+${Math.round(n)}`;
  return 'N/A';
}

type WcAfOddsValue = { value?: string; odd?: string; handicap?: string | number | null };
type WcAfOddsBet = { id?: string | number | null; name?: string; values?: WcAfOddsValue[] };
type WcAfOddsBookmaker = { name?: string; bets?: WcAfOddsBet[] };
type WcAfOddsRow = { bookmakers?: WcAfOddsBookmaker[] };

function wcAfParseOddsLine(raw: string, handicap?: string | number | null): number | null {
  if (handicap != null && String(handicap).trim() !== '') {
    const parsed = Number.parseFloat(String(handicap).replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  const threshold = String(raw || '').match(/(\d+)\+/);
  if (threshold?.[1]) {
    const n = Number.parseInt(threshold[1]!, 10);
    if (Number.isFinite(n) && n >= 1) return n - 0.5;
  }
  const match =
    raw.match(/(?:over|under)\s+(-?\d+(?:\.\d+)?)/i) ??
    raw.match(/(-?\d+(?:\.\d+)?)\s*(?:shots?|goals?|assists?|sot)?\s*$/i);
  if (!match?.[1]) return null;
  const line = Number.parseFloat(match[1]!);
  return Number.isFinite(line) ? line : null;
}

function wcAfParseThresholdPlusLabel(label: string): { playerLabel: string; line: number } | null {
  const match = String(label || '')
    .trim()
    .match(/^(.+?)\s*[-–—:]\s*(\d+)\+\s*$/i);
  if (!match?.[2]) return null;
  const n = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return { playerLabel: match[1]!.trim(), line: n - 0.5 };
}

function wcAfParsePlayerOddsLabel(
  label: string,
  handicap?: string | number | null
): { playerLabel: string; side: 'over' | 'under' | 'yes' | null; line: number | null } {
  const raw = String(label || '').trim();
  if (!raw) return { playerLabel: '', side: null, line: null };

  const threshold = wcAfParseThresholdPlusLabel(raw);
  if (threshold) {
    return { playerLabel: threshold.playerLabel, side: 'yes', line: threshold.line };
  }

  const trailing = raw.match(/^(.+?)\s*[-–—:]\s*(over|under)\s+(-?\d+(?:\.\d+)?)\s*$/i);
  if (trailing) {
    return {
      playerLabel: trailing[1]!.trim(),
      side: trailing[2]!.toLowerCase() as 'over' | 'under',
      line: wcAfParseOddsLine(trailing[0]!, handicap ?? trailing[3]),
    };
  }

  const leading = raw.match(/^(over|under)\s+(-?\d+(?:\.\d+)?)\s*[-–—:]\s*(.+)$/i);
  if (leading) {
    return {
      playerLabel: leading[3]!.trim(),
      side: leading[1]!.toLowerCase() as 'over' | 'under',
      line: wcAfParseOddsLine(leading[0]!, handicap ?? leading[2]),
    };
  }

  if (/^(over|under)\b/i.test(raw)) {
    return {
      playerLabel: raw,
      side: /^over\b/i.test(raw) ? 'over' : 'under',
      line: wcAfParseOddsLine(raw, handicap),
    };
  }

  const embedded = raw.match(/^(.+?)\s+(over|under)\s+(-?\d+(?:\.\d+)?)\s*$/i);
  if (embedded) {
    return {
      playerLabel: embedded[1]!.trim(),
      side: embedded[2]!.toLowerCase() as 'over' | 'under',
      line: wcAfParseOddsLine(embedded[0]!, handicap ?? embedded[3]),
    };
  }

  return { playerLabel: raw, side: 'yes', line: wcAfParseOddsLine(raw, handicap) };
}

function wcAfIsBareOverUnderLabel(label: string): boolean {
  const norm = wcAfNormalizePlayer(label);
  return norm === 'over' || norm === 'under';
}

const WC_AF_MARKET_WORDS =
  /\b(player|shots on target|shot on target|sot|shots|assists|assist|goals|goal|anytime|goal scorer|to score|score anytime|over under|total|specials|fouls|committed|booked)\b/gi;

function wcAfStripMarketWords(text: string): string {
  return wcAfNormalizePlayer(String(text || '').replace(WC_AF_MARKET_WORDS, ' ').replace(/\s+/g, ' ').trim());
}

function wcAfBetNamePlayerScope(betName: string, playerKeys: Set<string>): 'match' | 'other' | 'generic' {
  const n = String(betName || '').toLowerCase();
  // Side markets (e.g. Bet365 [240] Home Player Shots) list players in values, not the bet title.
  if (/^(home|away)\s+player\s+shots\b/.test(n) && !/on target|shot on target/.test(n)) {
    return 'generic';
  }
  const stripped = wcAfStripMarketWords(betName);
  if (!stripped || stripped.length < 4) return 'generic';
  const parts = stripped.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return 'generic';
  if (wcAfPlayerTokensMatch(playerKeys, stripped)) return 'match';
  return 'other';
}

function wcAfClassifyBet(
  name: string
): 'anytime' | 'goals_ou' | 'assists' | 'shots' | 'sot' | 'fouls' | 'booked' | null {
  const n = String(name || '').toLowerCase();
  if (/match|team total|home team|away team|both teams|correct score|half time|full time|corner/.test(n)) {
    return null;
  }
  if (/total bookings|booking points|card betting|\b(red|yellow)\s+cards?\b/.test(n) && !/to be booked/.test(n)) {
    return null;
  }
  if (/first\s+goal|last\s+goal|first\s+scorer|last\s+scorer|first to score|last to score/.test(n)) {
    return null;
  }
  if (/goal method|player singles|player triples/.test(n)) {
    return null;
  }
  if (/to be booked|\bplayer to be booked\b/.test(n)) return 'booked';
  if (/player.*fouls committed|\bfouls committed\b/.test(n) && !/suffered|drawn|match|team total/.test(n)) {
    return 'fouls';
  }
  if (/\banytime\b/.test(n) && !/assist/.test(n)) return 'anytime';
  if (/player.*assist|assist.*player|\bassists\b/.test(n) && !/match|team total|home team|away team/.test(n)) {
    return 'assists';
  }
  if (/shots on target|shot on target|\bsot\b/.test(n) && !/match|team total|both teams/.test(n)) {
    return 'sot';
  }
  if (/player.*shot|player total shots|\bplayer shots\b|home player shots\b|away player shots\b/.test(n) && !/on target|match|team total/.test(n)) {
    return 'shots';
  }
  if (/player.*goal|player total goals|\bplayer goals\b/.test(n) && !/anytime|first|last|match|team/.test(n)) {
    return 'goals_ou';
  }
  return null;
}

function wcAfShouldSkipBetValue(
  betName: string,
  kind: 'anytime' | 'goals_ou' | 'assists' | 'shots' | 'sot' | 'fouls' | 'booked',
  label: string
): boolean {
  const n = betName.toLowerCase();
  if (/goal method|player singles|player triples/.test(n)) return true;
  const hasThreshold = /\d+\+/.test(label) || /^(over|under)\b/i.test(label);
  if ((kind === 'sot' || kind === 'shots' || kind === 'fouls') && !hasThreshold) return true;
  return false;
}

function wcAfBetKindPriority(
  betName: string,
  kind: 'anytime' | 'goals_ou' | 'assists' | 'shots' | 'sot' | 'fouls' | 'booked'
): number {
  const n = betName.toLowerCase().trim();
  if (kind === 'anytime') {
    if (n === 'anytime goal scorer') return 0;
    if (n.includes('anytime goal')) return 1;
    return 9;
  }
  if (kind === 'booked') {
    if (n === 'player to be booked') return 0;
    return 5;
  }
  if (kind === 'fouls') {
    if (n === 'player fouls committed') return 0;
    return 5;
  }
  if (kind === 'sot') {
    if (n === 'player shots on target') return 0;
    if (n.includes('home player shots on target')) return 1;
    if (n.includes('away player shots on target')) return 8;
    return 5;
  }
  if (kind === 'shots') {
    if (n.includes('home player shots') && !/on target/.test(n)) return 1;
    if (n.includes('away player shots') && !/on target/.test(n)) return 8;
    return 5;
  }
  if (kind === 'assists') {
    if (n === 'player assists') return 0;
    return 5;
  }
  return 5;
}

type WcAfLineOdds = { over?: string; under?: string; priority: number };

function wcAfLineMapToMarkets(map: Map<number, WcAfLineOdds>) {
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, odds]) => ({
      line: String(line),
      over: odds.over ?? 'N/A',
      under: odds.under ?? 'N/A',
    }));
}

function wcAfMergeLinesIntoMap(
  map: Map<number, WcAfLineOdds>,
  byLine: Map<number, { over?: string; under?: string }>,
  priority: number
) {
  for (const [line, odds] of byLine) {
    if (!odds.over && !odds.under) continue;
    const existing = map.get(line);
    if (!existing || priority <= existing.priority) {
      map.set(line, { over: odds.over, under: odds.under, priority });
    }
  }
}

function wcAfBuildPlayerOddsBooks(
  oddsRows: WcAfOddsRow[],
  playerName: string
): WorldCupPlayerOddsBook[] {
  const playerKeys = wcAfPlayerNameKeys(playerName);
  const books: WorldCupPlayerOddsBook[] = [];

  for (const row of oddsRows) {
    for (const bookmaker of row.bookmakers ?? []) {
      const name = String(bookmaker.name ?? '').trim();
      if (!name || !wcAfIsListBookmaker(name)) continue;
      const book: WorldCupPlayerOddsBook = { name: WC_LIST_BOOKMAKER };
      let anytimeMeta: { priority: number; betName: string } | null = null;
      let bookedMeta: { priority: number; betName: string } | null = null;
      const lineMaps: Record<
        'GoalsOver' | 'Assists' | 'Shots' | 'ShotsOnTarget' | 'FoulsCommitted',
        Map<number, WcAfLineOdds>
      > = {
        GoalsOver: new Map(),
        Assists: new Map(),
        Shots: new Map(),
        ShotsOnTarget: new Map(),
        FoulsCommitted: new Map(),
      };

      for (const bet of bookmaker.bets ?? []) {
        const betName = String(bet.name ?? '');
        const scope = wcAfBetNamePlayerScope(betName, playerKeys);
        if (scope === 'other') continue;

        const kind = wcAfClassifyBet(betName);
        if (!kind) continue;
        const values = bet.values ?? [];
        const priority = wcAfBetKindPriority(betName, kind);

        if (kind === 'anytime') {
          if (anytimeMeta && priority >= anytimeMeta.priority) continue;
          let hit = values.find((v) => wcAfPlayerTokensMatch(playerKeys, String(v.value ?? '')));
          if (!hit?.odd && scope === 'match') {
            hit =
              values.find((v) => /^yes\b/i.test(String(v.value ?? ''))) ??
              values.find((v) => v.odd) ??
              undefined;
          }
          if (hit?.odd) {
            book.AnytimeGoalScorer = { yes: wcAfFormatOdd(hit.odd), no: 'N/A' };
            anytimeMeta = { priority, betName };
          }
          continue;
        }

        if (kind === 'booked') {
          if (bookedMeta && priority >= bookedMeta.priority) continue;
          const hit = values.find((v) => wcAfPlayerTokensMatch(playerKeys, String(v.value ?? '').trim()));
          if (hit?.odd) {
            book.ToBeBooked = { yes: wcAfFormatOdd(hit.odd), no: 'N/A' };
            bookedMeta = { priority, betName };
          }
          continue;
        }

        const byLine = new Map<number, { over?: string; under?: string }>();
        for (const v of values) {
          const label = String(v.value ?? '').trim();
          if (!label || wcAfShouldSkipBetValue(betName, kind, label)) continue;

          const parsed = wcAfParsePlayerOddsLabel(label, v.handicap);
          const playerMatched =
            wcAfPlayerTokensMatch(playerKeys, parsed.playerLabel) ||
            (scope === 'match' && wcAfIsBareOverUnderLabel(parsed.playerLabel));

          if (parsed.side === 'over' || parsed.side === 'under') {
            if (!playerMatched) continue;
            if (parsed.line == null || parsed.line < 0) continue;
            const entry = byLine.get(parsed.line) ?? {};
            const american = wcAfFormatOdd(v.odd);
            if (parsed.side === 'over') entry.over = american;
            else entry.under = american;
            byLine.set(parsed.line, entry);
            continue;
          }

          if (parsed.side === 'yes' && playerMatched && !wcAfIsBareOverUnderLabel(label)) {
            const line = parsed.line ?? 0.5;
            const entry = byLine.get(line) ?? {};
            if (!entry.over) entry.over = wcAfFormatOdd(v.odd);
            byLine.set(line, entry);
          }
        }

        if (!byLine.size) continue;

        const column =
          kind === 'goals_ou'
            ? 'GoalsOver'
            : kind === 'assists'
              ? 'Assists'
              : kind === 'shots'
                ? 'Shots'
                : kind === 'fouls'
                  ? 'FoulsCommitted'
                  : 'ShotsOnTarget';
        wcAfMergeLinesIntoMap(lineMaps[column], byLine, priority);
      }

      for (const column of ['GoalsOver', 'Assists', 'Shots', 'ShotsOnTarget', 'FoulsCommitted'] as const) {
        const lines = wcAfLineMapToMarkets(lineMaps[column]);
        if (!lines.length) continue;
        if (column === 'GoalsOver') book.GoalsOverLines = lines;
        else if (column === 'Assists') book.AssistsLines = lines;
        else if (column === 'Shots') book.ShotsLines = lines;
        else if (column === 'FoulsCommitted') book.FoulsCommittedLines = lines;
        else book.ShotsOnTargetLines = lines;
        const primary = lines.find((row) => Number.parseFloat(String(row.line ?? '')) === 0.5) ?? lines[0];
        book[column] = primary;
      }

      if (
        book.AnytimeGoalScorer ||
        book.ToBeBooked ||
        book.GoalsOver ||
        book.Assists ||
        book.Shots ||
        book.ShotsOnTarget ||
        book.FoulsCommitted
      ) {
        books.push(book);
      }
    }
  }

  return books;
}

function wcAfLabelMatchesPlayer(label: string, betName: string, playerKeys: Set<string>): boolean {
  const scope = wcAfBetNamePlayerScope(betName, playerKeys);
  if (scope === 'other') return false;
  if (wcAfPlayerTokensMatch(playerKeys, label)) return true;
  if (scope === 'match' && (wcAfIsBareOverUnderLabel(label) || /^(yes|no)\b/i.test(label))) return true;
  return false;
}

export async function probeWorldCupPlayerOddsRaw(opts: {
  playerName: string;
  homeTeam: string;
  awayTeam: string;
  matchDate?: string | null;
}): Promise<WorldCupPlayerOddsProbeResult> {
  const playerName = opts.playerName?.trim() || '';
  const empty: WorldCupPlayerOddsProbeResult = {
    fixtureId: null,
    homeTeam: opts.homeTeam ?? null,
    awayTeam: opts.awayTeam ?? null,
    matchDate: opts.matchDate ?? null,
    playerName,
    parsedBooks: [],
    rawHits: [],
    bareOverUnderInPlayerMarkets: [],
  };
  if (!playerName || !opts.homeTeam?.trim() || !opts.awayTeam?.trim()) return empty;

  const fixtureId = await wcAfResolveFixtureId(opts);
  if (!fixtureId) return empty;

  const oddsRows = await wcAfFetchOddsRows(fixtureId);
  const playerKeys = wcAfPlayerNameKeys(playerName);
  const rawHits: WorldCupPlayerOddsProbeHit[] = [];
  const bareOverUnderInPlayerMarkets: WorldCupPlayerOddsProbeResult['bareOverUnderInPlayerMarkets'] = [];

  for (const row of oddsRows) {
    for (const bookmaker of row.bookmakers ?? []) {
      if (!wcAfIsListBookmaker(String(bookmaker.name ?? ''))) continue;
      for (const bet of bookmaker.bets ?? []) {
        const betName = String(bet.name ?? '');
        const betScope = wcAfBetNamePlayerScope(betName, playerKeys);
        const kind = wcAfClassifyBet(betName);
        const betNameMatches = playerNameMatchesInText(betName, playerKeys);
        for (const value of bet.values ?? []) {
          const label = String(value?.value ?? '').trim();
          if (!label) continue;
          const valueMatches = wcAfLabelMatchesPlayer(label, betName, playerKeys);
          if (!valueMatches && !betNameMatches) continue;

          rawHits.push({
            bookmaker: String(bookmaker.name ?? ''),
            betId: bet.id ?? null,
            betName,
            kind,
            betScope,
            value: label,
            odd: value?.odd ?? null,
            handicap: value?.handicap ?? null,
            american: wcAfFormatOdd(value?.odd),
          });

          if (kind && /^(over|under)\b/i.test(label)) {
            bareOverUnderInPlayerMarkets.push({
              bookmaker: String(bookmaker.name ?? ''),
              betId: bet.id ?? null,
              betName,
              value: label,
              odd: value?.odd ?? null,
              american: wcAfFormatOdd(value?.odd),
              handicap: value?.handicap ?? null,
            });
          }
        }
      }
    }
  }

  return {
    fixtureId,
    homeTeam: opts.homeTeam,
    awayTeam: opts.awayTeam,
    matchDate: opts.matchDate ?? null,
    playerName,
    parsedBooks: wcAfBuildPlayerOddsBooks(oddsRows ?? [], playerName),
    rawHits,
    bareOverUnderInPlayerMarkets,
  };
}

function playerNameMatchesInText(text: string, playerKeys: Set<string>): boolean {
  const norm = wcAfNormalizePlayer(text);
  if (!norm) return false;
  for (const key of playerKeys) {
    if (!key) continue;
    if (norm.includes(key)) return true;
    const last = key.split(/\s+/).at(-1);
    if (last && last.length >= 4 && norm.includes(last)) {
      const parts = norm.split(/\s+/).filter(Boolean);
      if (parts.includes(last)) return true;
    }
  }
  return wcAfPlayerTokensMatch(playerKeys, text);
}

export type WorldCupListGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
};

export type WorldCupWcGameLogEntry = {
  opponent: string;
  value: number;
  date?: string;
};

export type WorldCupListPropRow = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  commenceTime: string;
  playerName: string;
  statType: string;
  line: number;
  overOdds: string;
  underOdds: string;
  yesOdds?: string;
  noOdds?: string;
  bookmaker: string;
  last5Avg?: number | null;
  last10Avg?: number | null;
  h2hAvg?: number | null;
  seasonAvg?: number | null;
  streak?: number | null;
  last5HitRate?: { hits: number; total: number } | null;
  last10HitRate?: { hits: number; total: number } | null;
  h2hHitRate?: { hits: number; total: number } | null;
  seasonHitRate?: { hits: number; total: number } | null;
  dvpRating?: number | null;
  dvpStatValue?: number | null;
  headshotUrl?: string | null;
  wcPosition?: string | null;
  playerTeam?: string | null;
  playerId?: string | null;
  teamId?: string | null;
  opponentTeamId?: string | null;
  wcGamesAvg?: number | null;
  wcGamesHitRate?: { hits: number; total: number } | null;
  wcGameLog?: WorldCupWcGameLogEntry[];
};

const WC_LIST_RESPONSE_CACHE_KEY = 'wc_props_list_response_v7';
const WC_LIST_ENRICHED_RESPONSE_CACHE_KEY = 'wc_list_enriched_response_v8';
/** Props page + ingest: only this bookmaker (API-Football name). */
const WC_LIST_BOOKMAKER = 'Bet365';
/** Never expire; only replaced when cron runs (same as AFL odds / player-props cache). */
export const WC_LIST_RESPONSE_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60 * 10;
export const WC_LIST_ENRICHED_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60 * 10;
export { WC_LIST_ENRICHED_RESPONSE_CACHE_KEY };
const WC_LIST_ODDS_HORIZON_MS = 36 * 60 * 60 * 1000;
const WC_LIST_MAX_FIXTURES = 15;
const WC_LIST_FIXTURE_CONCURRENCY = 3;
const WC_PROPS_MIN_DECIMAL_ODDS = 1.6;
const WC_AF_FETCH_TIMEOUT_MS = 120_000;

function wcAfIsListBookmaker(bookmakerName: string): boolean {
  const n = String(bookmakerName ?? '').trim().toLowerCase();
  return n === 'bet365' || n.startsWith('bet365 ');
}

/** Log x/total during long loops (GitHub Actions has no live spinner). */
function wcProgressLog(tag: string, done: number, total: number, detail?: string): void {
  if (total <= 0) return;
  const step = total <= 25 ? 5 : total <= 100 ? 10 : 25;
  const suffix = detail ? ` — ${detail}` : '';
  if (done === 1 || done === total || done % step === 0) {
    console.log(`[${tag}] ${done}/${total}${suffix}`);
  }
}

function wcAfAmericanToDecimal(american: string): number | null {
  const raw = String(american ?? '').trim();
  if (!raw || raw === 'N/A') return null;
  const asFloat = Number.parseFloat(raw.replace(',', '.'));
  if (Number.isFinite(asFloat) && asFloat > 1 && asFloat < 500 && !/^[+-]/.test(raw)) return asFloat;
  const n = Number.parseInt(raw.replace('+', ''), 10);
  if (!Number.isFinite(n)) return null;
  if (n > 0) return n / 100 + 1;
  return 100 / Math.abs(n) + 1;
}

export function wcMeetsMinPropsOdds(
  overOdds: string,
  underOdds: string,
  yesOdds?: string,
  minDecimal = WC_PROPS_MIN_DECIMAL_ODDS
): boolean {
  const primary = yesOdds ?? overOdds;
  const decimal = wcAfAmericanToDecimal(primary);
  if (decimal == null) return false;
  return decimal >= minDecimal;
}

function wcAfMeetsMinPropsOdds(overOdds: string, underOdds: string, yesOdds?: string): boolean {
  return wcMeetsMinPropsOdds(overOdds, underOdds, yesOdds);
}

export function filterWorldCupListPropsByMinOdds(rows: WorldCupListPropRow[]): WorldCupListPropRow[] {
  return rows.filter((r) => wcMeetsMinPropsOdds(r.overOdds, r.underOdds, r.yesOdds));
}

/** Props page L5 / L10 / WC columns — require at least one populated category. */
export function worldCupPropHasPlayerCategoryStats(row: {
  last5Avg?: number | null;
  last10Avg?: number | null;
  wcGamesAvg?: number | null;
  wcGamesHitRate?: { hits: number; total: number } | null;
}): boolean {
  if (row.last5Avg != null) return true;
  if (row.last10Avg != null) return true;
  if (row.wcGamesAvg != null) return true;
  return (row.wcGamesHitRate?.total ?? 0) > 0;
}

export function filterWorldCupPropsWithPlayerCategoryStats(
  games: WorldCupListGame[],
  data: WorldCupListPropRow[]
): { games: WorldCupListGame[]; data: WorldCupListPropRow[] } {
  const filteredData = data.filter(worldCupPropHasPlayerCategoryStats);
  const gameIds = new Set(filteredData.map((r) => r.gameId));
  return {
    games: games.filter((g) => gameIds.has(g.gameId)),
    data: filteredData,
  };
}

function wcAfDateKeyFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function wcParseCommenceMs(commenceTime: string): number | null {
  const ms = Date.parse(String(commenceTime ?? '').trim());
  return Number.isFinite(ms) ? ms : null;
}

/** Keep only fixtures with kick-off in the next 36 hours (odds ingest window). */
export function wcFilterGamesWithinOddsHorizon(
  games: WorldCupListGame[],
  nowMs = Date.now()
): WorldCupListGame[] {
  const endMs = nowMs + WC_LIST_ODDS_HORIZON_MS;
  return games.filter((g) => {
    const kickoff = wcParseCommenceMs(g.commenceTime);
    if (kickoff == null) return false;
    return kickoff >= nowMs && kickoff <= endMs;
  });
}

function wcFilterListPayloadByOddsHorizon(payload: {
  games: WorldCupListGame[];
  data: WorldCupListPropRow[];
}): { games: WorldCupListGame[]; data: WorldCupListPropRow[] } {
  const games = wcFilterGamesWithinOddsHorizon(payload.games ?? []);
  const gameIds = new Set(games.map((g) => g.gameId));
  const data = filterWorldCupListPropsByMinOdds((payload.data ?? []).filter((r) => gameIds.has(r.gameId)));
  return { games, data };
}

function wcAfHasValidOdd(value: string | undefined): boolean {
  const v = String(value ?? '').trim();
  return v !== '' && v !== 'N/A';
}

function wcAfCollectPlayerNamesFromOddsRows(
  oddsRows: Array<{ bookmakers?: Array<{ name?: string; bets?: Array<{ name?: string; values?: WcAfOddsValue[] }> }> }>
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const addName = (raw: string) => {
    const label = String(raw || '').trim();
    if (!label || wcAfIsBareOverUnderLabel(label) || /^(yes|no)$/i.test(label)) return;
    const key = wcAfNormalizePlayer(wcAfExpandPlayerLabel(label));
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(wcAfExpandPlayerLabel(label));
  };

  for (const row of oddsRows) {
    for (const bookmaker of row.bookmakers ?? []) {
      if (!wcAfIsListBookmaker(String(bookmaker.name ?? ''))) continue;
      for (const bet of bookmaker.bets ?? []) {
        if (!wcAfClassifyBet(String(bet.name ?? ''))) continue;
        for (const value of bet.values ?? []) {
          const label = String(value.value ?? '').trim();
          if (!label) continue;
          const parsed = wcAfParsePlayerOddsLabel(label, value.handicap);
          if (!wcAfIsBareOverUnderLabel(parsed.playerLabel)) addName(parsed.playerLabel);
        }
      }
    }
  }
  return names;
}

function wcAfBooksToListRows(
  game: WorldCupListGame,
  playerName: string,
  books: WorldCupPlayerOddsBook[]
): WorldCupListPropRow[] {
  const rows: WorldCupListPropRow[] = [];
  const displayName = formatWorldCupPlayerDisplayName(playerName);

  const pushRow = (
    statType: string,
    line: number,
    bookmaker: string,
    overOdds: string,
    underOdds: string,
    yesOdds?: string,
    noOdds?: string
  ) => {
    const hasBoth = wcAfHasValidOdd(overOdds) && wcAfHasValidOdd(underOdds);
    const hasYes = wcAfHasValidOdd(yesOdds ?? overOdds) && (statType === 'goals' || statType === 'yellow_cards') && line <= 0.5;
    const hasOverOnly = wcAfHasValidOdd(overOdds) && !wcAfHasValidOdd(underOdds) && line > 0.5;
    if (!hasBoth && !hasYes && !hasOverOnly) return;
    if (!wcAfMeetsMinPropsOdds(overOdds, underOdds, yesOdds)) return;
    rows.push({
      gameId: game.gameId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeTeamCode: game.homeTeamCode ?? null,
      awayTeamCode: game.awayTeamCode ?? null,
      homeTeamLogo: game.homeTeamLogo ?? null,
      awayTeamLogo: game.awayTeamLogo ?? null,
      commenceTime: game.commenceTime,
      playerName: displayName,
      statType,
      line,
      overOdds,
      underOdds,
      yesOdds,
      noOdds,
      bookmaker,
    });
  };

  for (const book of books) {
    const bm = book.name;
    if (book.AnytimeGoalScorer) {
      pushRow(
        'goals',
        0.5,
        bm,
        book.AnytimeGoalScorer.yes ?? 'N/A',
        book.AnytimeGoalScorer.no ?? 'N/A',
        book.AnytimeGoalScorer.yes,
        book.AnytimeGoalScorer.no
      );
    }
    if (book.ToBeBooked) {
      pushRow(
        'yellow_cards',
        0.5,
        bm,
        book.ToBeBooked.yes ?? 'N/A',
        book.ToBeBooked.no ?? 'N/A',
        book.ToBeBooked.yes,
        book.ToBeBooked.no
      );
    }
    const lineGroups: Array<{
      statType: string;
      lines?: Array<{ line?: string; over?: string; under?: string }>;
    }> = [
      { statType: 'goals', lines: book.GoalsOverLines },
      { statType: 'assists', lines: book.AssistsLines },
      { statType: 'total_shots', lines: book.ShotsLines },
      { statType: 'shots_on_target', lines: book.ShotsOnTargetLines },
      { statType: 'fouls_committed', lines: book.FoulsCommittedLines },
    ];
    for (const group of lineGroups) {
      for (const entry of group.lines ?? []) {
        const lineNum = Number.parseFloat(String(entry.line ?? ''));
        if (!Number.isFinite(lineNum)) continue;
        pushRow(group.statType, lineNum, bm, entry.over ?? 'N/A', entry.under ?? 'N/A');
      }
    }
  }
  return rows;
}

async function wcAfListUpcomingFixtures(): Promise<WorldCupListGame[]> {
  const nowMs = Date.now();
  const today = wcAfDateKeyFromMs(nowMs);
  const horizonEndDate = wcAfDateKeyFromMs(nowMs + WC_LIST_ODDS_HORIZON_MS);
  const attempts: Array<Record<string, string | number>> = [
    { league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, from: today, to: horizonEndDate },
    { league: WC_AF_LEAGUE_ID, season: WC_AF_SEASON, next: 25 },
  ];
  const byId = new Map<string, WorldCupListGame>();
  const finished = new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO']);

  for (const params of attempts) {
    const fixtures = await wcAfListFixtures(params);
    for (const row of fixtures) {
      const status = String(row.fixture?.status?.short ?? '').toUpperCase();
      if (finished.has(status)) continue;
      const gameId = String(row.fixture?.id ?? '');
      if (!gameId) continue;
      byId.set(gameId, {
        gameId,
        homeTeam: String(row.teams?.home?.name ?? ''),
        awayTeam: String(row.teams?.away?.name ?? ''),
        homeTeamCode: String(row.teams?.home?.code ?? '').trim() || null,
        awayTeamCode: String(row.teams?.away?.code ?? '').trim() || null,
        homeTeamLogo: String(row.teams?.home?.logo ?? '').trim() || null,
        awayTeamLogo: String(row.teams?.away?.logo ?? '').trim() || null,
        commenceTime: String(row.fixture?.date ?? ''),
      });
    }
  }
  return wcFilterGamesWithinOddsHorizon(
    [...byId.values()].sort((a, b) => a.commenceTime.localeCompare(b.commenceTime)),
    nowMs
  );
}

type WcFixtureListCtx = { index: number; total: number };

async function wcAfProcessFixtureForList(
  game: WorldCupListGame,
  ctx?: WcFixtureListCtx
): Promise<WorldCupListPropRow[]> {
  const fixtureId = Number.parseInt(game.gameId, 10);
  if (!Number.isFinite(fixtureId)) return [];
  const matchup = `${game.homeTeam} vs ${game.awayTeam}`;
  const fixTag = ctx ? `fixture ${ctx.index}/${ctx.total}` : 'fixture';
  console.log(`[wc-odds] ${fixTag} — loading odds (${matchup})...`);

  const rawKey = `${WC_AF_ODDS_CACHE_PREFIX}:raw:${fixtureId}`;
  let oddsRows = await sharedCache.getJSON<Parameters<typeof wcAfBuildPlayerOddsBooks>[0]>(rawKey);
  if (!oddsRows?.length) {
    oddsRows = await wcAfFetchOddsRows(fixtureId);
    if (oddsRows.length) await sharedCache.setJSON(rawKey, oddsRows, WC_AF_ODDS_CACHE_TTL_SECONDS);
  }
  if (!oddsRows?.length) {
    console.log(`[wc-odds] ${fixTag} — no odds returned (${matchup})`);
    return [];
  }

  const playerNames = wcAfCollectPlayerNamesFromOddsRows(oddsRows);
  const totalPlayers = playerNames.length;
  console.log(`[wc-odds] ${fixTag} — parsing ${totalPlayers} players (${matchup})`);
  const rows: WorldCupListPropRow[] = [];
  for (let pi = 0; pi < playerNames.length; pi++) {
    const playerName = playerNames[pi]!;
    const books = wcAfBuildPlayerOddsBooks(oddsRows, playerName);
    rows.push(...wcAfBooksToListRows(game, playerName, books));
    wcProgressLog('wc-odds', pi + 1, totalPlayers, `${fixTag} players (${matchup})`);
  }
  console.log(`[wc-odds] ${fixTag} — ${rows.length} prop rows (${matchup})`);
  return rows;
}

async function wcAfMapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), Math.max(items.length, 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) break;
        out[i] = await fn(items[i]!, i);
      }
    })
  );
  return out;
}

async function readWorldCupPlayerPropsListCache(): Promise<{
  games: WorldCupListGame[];
  data: WorldCupListPropRow[];
  lastUpdated: string | null;
} | null> {
  const cached = await sharedCache.getJSON<{
    games: WorldCupListGame[];
    data: WorldCupListPropRow[];
    lastUpdated: string;
  }>(WC_LIST_RESPONSE_CACHE_KEY);
  if (!cached || (!cached.games?.length && !cached.data?.length)) return null;
  const filtered = wcFilterListPayloadByOddsHorizon({
    games: cached.games ?? [],
    data: cached.data ?? [],
  });
  return {
    games: filtered.games,
    data: filtered.data,
    lastUpdated: cached.lastUpdated ?? null,
  };
}

function wcEmptyListResult(
  ingestMessage: string,
  lastUpdated: string | null = null
): {
  games: WorldCupListGame[];
  data: WorldCupListPropRow[];
  lastUpdated: string | null;
  noWorldCupOdds: boolean;
  ingestMessage: string;
} {
  return {
    games: [],
    data: [],
    lastUpdated,
    noWorldCupOdds: true,
    ingestMessage,
  };
}

export async function buildWorldCupPlayerPropsList(opts?: {
  refresh?: boolean;
  /** When true, never call API-Football on cache miss (user-facing list path). */
  cacheOnly?: boolean;
  maxFixtures?: number;
}): Promise<{
  games: WorldCupListGame[];
  data: WorldCupListPropRow[];
  lastUpdated: string | null;
  noWorldCupOdds: boolean;
  ingestMessage: string;
}> {
  if (!opts?.refresh) {
    const cached = await readWorldCupPlayerPropsListCache();
    if (cached) {
      return {
        games: cached.games,
        data: cached.data,
        lastUpdated: cached.lastUpdated,
        noWorldCupOdds: cached.data.length === 0,
        ingestMessage: cached.data.length
          ? `Fetched ${cached.data.length} props for ${cached.games.length} games (next 36h)`
          : 'No odds available in the next 36 hours. Come back later.',
      };
    }
    if (opts?.cacheOnly) {
      return wcEmptyListResult('No odds available. Come back later.');
    }
  }

  if (opts?.cacheOnly) {
    const cached = await readWorldCupPlayerPropsListCache();
    if (cached) {
      return {
        games: cached.games,
        data: cached.data,
        lastUpdated: cached.lastUpdated,
        noWorldCupOdds: cached.data.length === 0,
        ingestMessage: cached.data.length
          ? `Fetched ${cached.data.length} props for ${cached.games.length} games (next 36h)`
          : 'No odds available in the next 36 hours. Come back later.',
      };
    }
    return wcEmptyListResult('No odds available. Come back later.');
  }

  if (!process.env.API_FOOTBALL_KEY) {
    if (opts?.refresh) {
      const cached = await readWorldCupPlayerPropsListCache();
      if (cached) {
        return {
          games: cached.games,
          data: cached.data,
          lastUpdated: cached.lastUpdated,
          noWorldCupOdds: cached.data.length === 0,
          ingestMessage: cached.data.length
            ? `Fetched ${cached.data.length} props for ${cached.games.length} games (cached)`
            : 'No odds available in the next 36 hours. Come back later.',
        };
      }
    }
    return wcEmptyListResult('API_FOOTBALL_KEY is not configured.');
  }

  try {
    console.log('[wc-odds] Fetching fixtures in next 36h (Bet365 only)...');
    const games = await wcAfListUpcomingFixtures();
    const maxFixtures = opts?.maxFixtures ?? WC_LIST_MAX_FIXTURES;
    const targetGames = games.slice(0, maxFixtures);
    console.log(`[wc-odds] ${targetGames.length} fixture(s) in 36h window (max ${maxFixtures})`);
    const chunks = await wcAfMapWithConcurrency(targetGames, WC_LIST_FIXTURE_CONCURRENCY, (game, index) =>
      wcAfProcessFixtureForList(game, { index: index + 1, total: targetGames.length })
    );
    const data = filterWorldCupListPropsByMinOdds(chunks.flat());
    console.log(`[wc-odds] ${data.length} prop rows after min-odds filter — writing cache...`);
    const lastUpdated = new Date().toISOString();
    if (data.length || targetGames.length) {
      await sharedCache.setJSON(
        WC_LIST_RESPONSE_CACHE_KEY,
        { games: targetGames, data, lastUpdated },
        WC_LIST_RESPONSE_CACHE_TTL_SECONDS
      );
    }
    return {
      games: targetGames,
      data,
      lastUpdated,
      noWorldCupOdds: data.length === 0,
      ingestMessage: data.length
        ? `Fetched ${data.length} props for ${targetGames.length} games (next 36h)`
        : targetGames.length
          ? 'Games found but no player props markets yet. Come back later.'
          : 'No World Cup fixtures with props in the next 36 hours.',
    };
  } catch (error) {
    console.warn('[wc-cache] World Cup props list build failed:', error);
    if (opts?.refresh) {
      const cached = await readWorldCupPlayerPropsListCache();
      if (cached) {
        return {
          games: cached.games,
          data: cached.data,
          lastUpdated: cached.lastUpdated,
          noWorldCupOdds: cached.data.length === 0,
          ingestMessage: cached.data.length
            ? `Fetched ${cached.data.length} props for ${cached.games.length} games (cached after refresh error)`
            : 'No odds available in the next 36 hours. Come back later.',
        };
      }
    }
    return wcEmptyListResult('No odds available. Come back later.');
  }
}

export type WorldCupPropStatsPayload = {
  last5Avg: number | null;
  last10Avg: number | null;
  h2hAvg: number | null;
  seasonAvg: number | null;
  streak: number | null;
  last5HitRate: { hits: number; total: number } | null;
  last10HitRate: { hits: number; total: number } | null;
  h2hHitRate: { hits: number; total: number } | null;
  seasonHitRate: { hits: number; total: number } | null;
  dvpRating?: number | null;
  dvpStatValue?: number | null;
  wcGamesAvg?: number | null;
  wcGamesHitRate?: { hits: number; total: number } | null;
  wcGameLog?: WorldCupWcGameLogEntry[];
};

const WC_PROP_STATS_CACHE_PREFIX = 'wc_prop_stats_v5';
/** Same as AFL prop-stats cache: replaced on warm; 24h TTL is a safety net only. */
const WC_PROP_STATS_CACHE_TTL_SECONDS = 60 * 60 * 24;
const WC_PROPS_STATS_SEASON = 2026;
/** BDL FIFA finals player stats for 2018/2022/2026 — built by `build:world-cup:bdl-cache` step 2. */
const BDL_DVP_SUPPLEMENT_CACHE_KEY = 'wc:bdl-dvp-supplement:v5';

type WcBdlSupplementPayload = {
  matches?: BdlDvpSupplementMatch[];
  statRows?: BdlDvpSupplementRow[];
};

let wcBdlSupplementPayloadMem: WcBdlSupplementPayload | null | undefined;

export function clearWcBdlSupplementPayloadMem(): void {
  wcBdlSupplementPayloadMem = undefined;
}

async function wcGetBdlSupplementPayload(): Promise<WcBdlSupplementPayload | null> {
  if (wcBdlSupplementPayloadMem !== undefined) return wcBdlSupplementPayloadMem;
  wcBdlSupplementPayloadMem = await getWorldCupCache<WcBdlSupplementPayload>(BDL_DVP_SUPPLEMENT_CACHE_KEY);
  return wcBdlSupplementPayloadMem;
}

function wcPropStatsNormalizePlayerKey(name: string): string {
  return resolveWorldCupAliasName(normalizeWorldCupPlayerName(name));
}

function wcPropStatsNormalizeOpponentKey(team: string): string {
  const code = resolveWorldCupFlagCode(team);
  const raw = String(code ?? team ?? '').trim().toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, ' ').trim();
}

function wcPropStatsGetStatValue(game: Record<string, unknown>, statType: string): number | null {
  const num = (v: unknown): number | null => {
    const parsed = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  if (statType === 'goals') return num(game.goals);
  if (statType === 'assists') return num(game.assists);
  if (statType === 'total_shots') {
    return num(game.shots_total) ?? num(game.derived_shots_total) ?? num(game.shots);
  }
  if (statType === 'shots_on_target') {
    return num(game.shots_on_target) ?? num(game.derived_shots_on_target);
  }
  if (statType === 'fouls_committed') return num(game.fouls_committed) ?? num(game.fouls);
  if (statType === 'yellow_cards') return num(game.yellow_cards);
  return null;
}

export function getWorldCupPropStatsCacheKey(
  playerName: string,
  team: string,
  opponent: string,
  statType: string,
  line: number
): string {
  const s = `${wcPropStatsNormalizePlayerKey(playerName)}|${wcPropStatsNormalizeOpponentKey(team)}|${wcPropStatsNormalizeOpponentKey(opponent)}|${statType}|${line}`;
  return `${WC_PROP_STATS_CACHE_PREFIX}:${Buffer.from(s, 'utf8').toString('base64url')}`;
}

function wcPropStatsIsWorldCupTournamentGame(g: Record<string, unknown>): boolean {
  const source = String(g.source ?? '').trim().toLowerCase();
  if (source === 'bdl') return true;
  return isCompletedWorldCupFinalsMatch({
    source,
    source_match_id: String(g.match_id ?? g.id ?? ''),
    home_team_source_id: '',
    away_team_source_id: '',
    home_team_name: String(g.opponent ?? ''),
    away_team_name: '',
    home_score: null,
    away_score: null,
    match_date: String(g.date ?? g.datetime ?? ''),
    kickoff_unix: null,
    tournament_slug: String(g.tournament_slug ?? ''),
    status: String(g.status ?? 'completed'),
    season_year: typeof g.season === 'number' ? g.season : null,
  });
}

function wcPropStatsShortOpponentLabel(team: string): string {
  const code = resolveWorldCupFlagCode(team);
  if (code && /^[A-Z]{2,3}$/.test(code)) return code;
  const trimmed = String(team ?? '').trim();
  if (trimmed.length <= 4) return trimmed.toUpperCase();
  return trimmed.slice(0, 3).toUpperCase();
}

export function computeWorldCupPropStatsFromGames(
  games: Record<string, unknown>[],
  statType: string,
  opponent: string,
  line: number,
  targetSeason = WC_PROPS_STATS_SEASON
): Omit<WorldCupPropStatsPayload, 'dvpRating' | 'dvpStatValue'> {
  const propOpponent = wcPropStatsNormalizeOpponentKey(opponent);
  const gamesWithValue: { value: number; opponent: string; season: number | null }[] = [];
  for (const g of games) {
    const v = wcPropStatsGetStatValue(g, statType);
    const opp = String(g.opponent ?? '');
    const seasonRaw = g.season;
    const seasonFromField =
      typeof seasonRaw === 'number' && Number.isFinite(seasonRaw)
        ? seasonRaw
        : typeof seasonRaw === 'string' && /^\d{4}$/.test(seasonRaw)
          ? Number(seasonRaw)
          : null;
    const dateRaw = String((g.date ?? g.datetime ?? g.match_date ?? '') as string).trim();
    const seasonFromDate = /^\d{4}/.test(dateRaw) ? Number(dateRaw.slice(0, 4)) : null;
    const season = seasonFromField ?? seasonFromDate;
    if (v !== null) gamesWithValue.push({ value: v, opponent: opp, season });
  }
  const last5 = gamesWithValue.slice(0, 5).map((x) => x.value);
  const last10 = gamesWithValue.slice(0, 10).map((x) => x.value);
  const seasonValues = gamesWithValue.filter((x) => x.season === targetSeason).map((x) => x.value);
  const h2hValues = gamesWithValue
    .filter((x) => {
      if (!propOpponent) return false;
      return wcPropStatsNormalizeOpponentKey(x.opponent) === propOpponent;
    })
    .slice(0, 6)
    .map((x) => x.value);
  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  let streak: number | null = null;
  if (Number.isFinite(line) && gamesWithValue.length > 0) {
    streak = 0;
    for (const x of gamesWithValue) {
      if (x.value > line) streak++;
      else break;
    }
  }
  const hit = (vals: number[]) => ({ hits: vals.filter((v) => v > line).length, total: vals.length });
  const seasonPool = seasonValues.length > 0 ? seasonValues : gamesWithValue.map((x) => x.value);
  const wcGameLog: WorldCupWcGameLogEntry[] = [];
  for (const g of games) {
    if (!wcPropStatsIsWorldCupTournamentGame(g)) continue;
    const v = wcPropStatsGetStatValue(g, statType);
    if (v === null) continue;
    const opp = String(g.opponent ?? '');
    const dateRaw = String((g.date ?? g.datetime ?? g.match_date ?? '') as string).trim();
    wcGameLog.push({
      opponent: wcPropStatsShortOpponentLabel(opp),
      value: v,
      date: dateRaw || undefined,
    });
  }
  const wcValues = wcGameLog.map((x) => x.value);
  return {
    last5Avg: avg(last5),
    last10Avg: avg(last10),
    h2hAvg: avg(h2hValues),
    seasonAvg: avg(seasonPool),
    streak,
    last5HitRate: last5.length ? hit(last5) : null,
    last10HitRate: last10.length ? hit(last10) : null,
    h2hHitRate: h2hValues.length ? hit(h2hValues) : null,
    seasonHitRate: seasonPool.length ? hit(seasonPool) : null,
    wcGamesAvg: avg(wcValues),
    wcGamesHitRate: wcValues.length ? hit(wcValues) : null,
    wcGameLog,
  };
}

async function wcPropStatsResolveBdlPlayerId(playerName: string): Promise<number | null> {
  const nameIndex = await getWorldCupCache<Record<string, number>>(WC2026_CACHE_KEYS.playerIdByName);
  const normalized = normalizeWorldCupPlayerName(playerName);
  const alias = resolveWorldCupAliasName(normalized);
  let playerId: number | undefined = nameIndex?.[normalized] ?? nameIndex?.[alias];
  if (!playerId) {
    const parts = normalized.split(' ').filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      if (part && part.length >= 3 && nameIndex?.[part]) {
        playerId = nameIndex[part];
        break;
      }
    }
  }
  if (playerId) return playerId;

  const playerIndex = await getWorldCupCache<WorldCupPlayerIndexEntry[]>(WORLD_CUP_PLAYER_INDEX_CACHE_KEY);
  const lookupKeys = new Set([normalized, alias]);
  for (const entry of playerIndex ?? []) {
    const entryKeys = [
      entry.normalizedName,
      normalizeWorldCupPlayerName(entry.name),
      resolveWorldCupAliasName(normalizeWorldCupPlayerName(entry.name)),
    ];
    if (!entryKeys.some((k) => lookupKeys.has(k))) continue;
    const bdl = entry.sources.find((s) => s.source === 'bdl' && s.id);
    if (!bdl?.id) continue;
    const id = Number(bdl.id);
    if (Number.isFinite(id)) return id;
  }
  return null;
}

type BdlDvpSupplementRow = {
  source?: string;
  source_match_id?: string;
  source_player_id?: string;
  source_team_id?: string;
  is_home?: boolean;
  position?: string | null;
  goals?: number | null;
  assists?: number | null;
  shots_total?: number | null;
  shots_on_target?: number | null;
  yellow_cards?: number | null;
  fouls?: number | null;
};

type BdlDvpSupplementMatch = {
  source?: string;
  source_match_id?: string;
  home_team_name?: string;
  away_team_name?: string;
  match_date?: string | null;
  tournament_slug?: string | null;
  status?: string | null;
  season_year?: number | null;
};

function wcPropStatsMapBdlSupplementStatRow(row: BdlDvpSupplementRow): Record<string, unknown> {
  return {
    match_id: row.source_match_id,
    source: 'bdl',
    tournament_slug: 'worldcup',
    player_id: row.source_player_id,
    team_id: row.source_team_id,
    is_home: row.is_home === true,
    position: row.position ?? null,
    goals: row.goals ?? null,
    assists: row.assists ?? null,
    shots_total: row.shots_total ?? null,
    shots_on_target: row.shots_on_target ?? null,
    yellow_cards: row.yellow_cards ?? null,
    fouls: row.fouls ?? null,
    fouls_committed: row.fouls ?? null,
  };
}

function wcPropStatsMapBdlSupplementMatch(row: BdlDvpSupplementMatch): Record<string, unknown> {
  return {
    id: row.source_match_id,
    datetime: row.match_date ?? null,
    status: row.status ?? 'completed',
    season: { year: row.season_year ?? null },
    home_team: { name: row.home_team_name ?? '' },
    away_team: { name: row.away_team_name ?? '' },
    tournament_slug: row.tournament_slug ?? 'worldcup',
    source: row.source ?? 'bdl',
  };
}

async function wcPropStatsLoadBdlSupplementPlayerHistory(playerName: string): Promise<{
  playerMatchStats: Record<string, unknown>[];
  matches: Record<string, unknown>[];
}> {
  const playerId = await wcPropStatsResolveBdlPlayerId(playerName);
  if (!playerId) return { playerMatchStats: [], matches: [] };

  const supplement = await wcGetBdlSupplementPayload();
  if (!supplement?.statRows?.length) return { playerMatchStats: [], matches: [] };

  const playerIdStr = String(playerId);
  const playerStats = supplement.statRows
    .filter((row) => String(row.source_player_id ?? '') === playerIdStr)
    .map(wcPropStatsMapBdlSupplementStatRow);
  if (!playerStats.length) return { playerMatchStats: [], matches: [] };

  const matchIds = new Set(playerStats.map((row) => String(row.match_id ?? '')));
  const matches = (supplement.matches ?? [])
    .filter((row) => matchIds.has(String(row.source_match_id ?? '')))
    .map(wcPropStatsMapBdlSupplementMatch);

  return { playerMatchStats: playerStats, matches };
}

async function wcPropStatsLoadBdlCachedPlayerHistory(playerName: string): Promise<{
  playerMatchStats: Record<string, unknown>[];
  matches: Record<string, unknown>[];
}> {
  const playerId = await wcPropStatsResolveBdlPlayerId(playerName);
  if (!playerId) return { playerMatchStats: [], matches: [] };
  const [cachedStats, cachedShots, cachedMatchesAll, cachedMatches2026] = await Promise.all([
    getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.playerStats(playerId)),
    getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.playerShots(playerId)),
    getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.matchesAllSeasons),
    getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.matches2026),
  ]);
  if (!cachedStats?.length) return { playerMatchStats: [], matches: [] };
  const shotsByMatch = new Map<number, number>();
  for (const shot of cachedShots ?? []) {
    const mid = Number(shot.match_id);
    if (Number.isFinite(mid)) shotsByMatch.set(mid, (shotsByMatch.get(mid) ?? 0) + 1);
  }
  const stats: Record<string, unknown>[] = cachedStats.map((row) => ({
    ...row,
    source: 'bdl',
    tournament_slug: 'worldcup',
    derived_shots_total: shotsByMatch.get(Number(row.match_id)) ?? row.derived_shots_total ?? null,
  }));
  const matchPool = (cachedMatchesAll?.length ? cachedMatchesAll : cachedMatches2026) ?? [];
  const matchIdsInStats = new Set(stats.map((s) => String(s.match_id ?? '')));
  const matches = matchPool.filter((m) => {
    const id = String((m as { id?: number }).id ?? '');
    if (!matchIdsInStats.has(id)) return false;
    const status = String((m as { status?: string }).status ?? '');
    return status === 'completed';
  });
  return { playerMatchStats: stats, matches };
}

function wcPropStatsTeamNameFromMatchSide(match: Record<string, unknown>, side: 'home' | 'away'): string {
  const nested = match[`${side}_team`] as { name?: string } | undefined;
  if (nested?.name) return String(nested.name);
  const flat = match[`${side}Label`] ?? match[`${side}_team_name`];
  return String(flat ?? '');
}

function wcPropStatsBuildGamesFromHistory(
  stats: Record<string, unknown>[],
  matches: Record<string, unknown>[]
): Record<string, unknown>[] {
  const matchById = new Map(matches.map((m) => [String(m.id ?? m.match_id ?? ''), m]));
  const games: Record<string, unknown>[] = [];
  for (const row of stats) {
    const matchId = String(row.match_id ?? '');
    const match = matchById.get(matchId);
    if (!match) continue;
    const homeName = wcPropStatsTeamNameFromMatchSide(match, 'home');
    const awayName = wcPropStatsTeamNameFromMatchSide(match, 'away');
    const isHome = row.is_home === true;
    const opponent = isHome ? awayName : homeName;
    const date = String(match.datetime ?? match.match_date ?? '');
    const seasonObj = match.season as { year?: number } | undefined;
    const season = Number(seasonObj?.year ?? match.season_year ?? (date ? date.slice(0, 4) : WC_PROPS_STATS_SEASON));
    const tournamentSlug =
      String(row.tournament_slug ?? match.tournament_slug ?? (row.source === 'bdl' ? 'worldcup' : '')).trim() || null;
    games.push({
      ...row,
      opponent,
      date,
      season,
      tournament_slug: tournamentSlug,
      status: String(match.status ?? row.status ?? 'completed'),
      source: String(row.source ?? match.source ?? ''),
    });
  }
  games.sort((a, b) => Date.parse(String(b.date ?? '0')) - Date.parse(String(a.date ?? '0')));
  return games;
}

export async function loadWorldCupPlayerGameLogs(playerName: string): Promise<Record<string, unknown>[]> {
  const [intl, bdl, bdlSupplement] = await Promise.all([
    loadInternationalStatsByPlayerName(playerName),
    wcPropStatsLoadBdlCachedPlayerHistory(playerName),
    wcPropStatsLoadBdlSupplementPlayerHistory(playerName),
  ]);
  const intlGames = wcPropStatsBuildGamesFromHistory(intl.playerMatchStats, intl.matches);
  const bdlGames = wcPropStatsBuildGamesFromHistory(bdl.playerMatchStats, bdl.matches);
  const bdlSupplementGames = wcPropStatsBuildGamesFromHistory(
    bdlSupplement.playerMatchStats,
    bdlSupplement.matches
  );
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const g of [...intlGames, ...bdlSupplementGames, ...bdlGames]) {
    const key = `${g.match_id}|${g.source ?? ''}|${g.team_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(g);
  }
  merged.sort((a, b) => Date.parse(String(b.date ?? '0')) - Date.parse(String(a.date ?? '0')));
  return merged;
}

export async function getWorldCupPropStats(
  playerName: string,
  team: string,
  opponent: string,
  statType: string,
  line: number,
  cacheOnly = true
): Promise<WorldCupPropStatsPayload | null> {
  const key = getWorldCupPropStatsCacheKey(playerName, team, opponent, statType, line);
  const cached = await sharedCache.getJSON<WorldCupPropStatsPayload>(key);
  const accepted = wcAcceptCachedPropStats(cached);
  if (accepted) return accepted;
  if (cacheOnly) return null;
  const games = await loadWorldCupPlayerGameLogs(playerName);
  if (!games.length) return null;
  const stats = computeWorldCupPropStatsFromGames(games, statType, opponent, line, WC_PROPS_STATS_SEASON);
  const payload: WorldCupPropStatsPayload = { ...stats, dvpRating: null, dvpStatValue: null };
  await sharedCache.setJSON(key, payload, WC_PROP_STATS_CACHE_TTL_SECONDS);
  const reverseKey = getWorldCupPropStatsCacheKey(playerName, opponent, team, statType, line);
  if (reverseKey !== key) await sharedCache.setJSON(reverseKey, payload, WC_PROP_STATS_CACHE_TTL_SECONDS);
  return payload;
}

const wcPropStatsByKeyCache = new Map<string, WorldCupPropStatsPayload | null>();

function wcAcceptCachedPropStats(cached: WorldCupPropStatsPayload | null | undefined): WorldCupPropStatsPayload | null {
  if (!cached || typeof cached !== 'object') return null;
  const hasAnyStat = cached.last5Avg != null || cached.last10Avg != null || cached.seasonAvg != null;
  const staleSeason = cached.seasonAvg != null && !(cached.seasonHitRate?.total);
  const staleWc = cached.wcGameLog === undefined && hasAnyStat;
  if (hasAnyStat && !staleSeason && !staleWc) return cached;
  return null;
}

const WC_PROP_STATS_PREFETCH_BATCH = 200;

async function prefetchWorldCupPropStatsKeys(keys: string[]): Promise<void> {
  const unique = [...new Set(keys)].filter((k) => !wcPropStatsByKeyCache.has(k));
  for (let i = 0; i < unique.length; i += WC_PROP_STATS_PREFETCH_BATCH) {
    const batch = unique.slice(i, i + WC_PROP_STATS_PREFETCH_BATCH);
    const values = await sharedCache.getJSONMany<WorldCupPropStatsPayload>(batch);
    for (let j = 0; j < batch.length; j++) {
      wcPropStatsByKeyCache.set(batch[j]!, wcAcceptCachedPropStats(values[j] ?? null));
    }
  }
}

function wcPropStatsFromRowCache(row: WorldCupListPropRow): WorldCupPropStatsPayload | null {
  const primary = getWorldCupPropStatsCacheKey(row.playerName, row.homeTeam, row.awayTeam, row.statType, row.line);
  if (wcPropStatsByKeyCache.has(primary)) {
    const hit = wcPropStatsByKeyCache.get(primary);
    if (hit) return hit;
  }
  const reverse = getWorldCupPropStatsCacheKey(row.playerName, row.awayTeam, row.homeTeam, row.statType, row.line);
  if (wcPropStatsByKeyCache.has(reverse)) {
    return wcPropStatsByKeyCache.get(reverse) ?? null;
  }
  return null;
}

type WcDvpAggregateCached = {
  opponents: string[];
  samples?: Record<string, number>;
  metrics: Record<string, Record<string, number>>;
  wcTeamsWithGames?: string[];
  names?: Record<string, string>;
};

type WcDvpRankMaps = Record<string, { ranks: Record<string, number>; values: Record<string, number> }>;

/** Teams with real defensive DvP samples — not the full "has played" pool. */
function wcDvpRankableOpponentSlugs(cached: WcDvpAggregateCached): string[] {
  return cached.opponents?.length ? cached.opponents : [];
}

function wcNormalizeTeamLabel(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function wcBuildDvpRankMaps(cached: WcDvpAggregateCached): WcDvpRankMaps {
  const opponents = wcDvpRankableOpponentSlugs(cached);
  if (!opponents.length) return {};
  const out: WcDvpRankMaps = {};
  for (const [metric, rawValues] of Object.entries(cached.metrics ?? {})) {
    const values: Record<string, number> = {};
    const rankable = opponents.filter((slug) => {
      const sampleCount = cached.samples?.[slug] ?? 0;
      const value = rawValues[slug];
      if (sampleCount <= 0 || value == null || !Number.isFinite(Number(value))) return false;
      values[slug] = Number(value);
      return true;
    });
    const sorted = [...rankable].sort((a, b) => values[a] - values[b]);
    const ranks: Record<string, number> = {};
    sorted.forEach((slug, idx) => {
      ranks[slug] = idx + 1;
    });
    out[metric] = { ranks, values };
  }
  return out;
}

function wcResolveOpponentDvpSlug(opponentTeamName: string, cached: WcDvpAggregateCached): string | null {
  const opponents = wcDvpRankableOpponentSlugs(cached);
  const candidates = new Set<string>();
  const code = resolveWorldCupFlagCode(opponentTeamName);
  if (code) candidates.add(code.toLowerCase());
  candidates.add(opponentTeamName.trim().toLowerCase());
  candidates.add(wcNormalizeTeamLabel(opponentTeamName));

  for (const slug of opponents) {
    if (candidates.has(slug.toLowerCase())) return slug;
  }

  for (const slug of opponents) {
    const label = cached.names?.[slug];
    if (!label) continue;
    const labelNorm = wcNormalizeTeamLabel(label);
    const oppNorm = wcNormalizeTeamLabel(opponentTeamName);
    if (labelNorm && oppNorm && (labelNorm === oppNorm || labelNorm.includes(oppNorm) || oppNorm.includes(labelNorm))) {
      return slug;
    }
    const labelCode = resolveWorldCupFlagCode(label);
    if (labelCode && candidates.has(labelCode.toLowerCase())) return slug;
  }

  return null;
}

function wcLookupDvpRank(
  dvpByPosition: Map<IntlPositionBucket, WcDvpAggregateCached>,
  dvpRankMaps: Map<IntlPositionBucket, WcDvpRankMaps>,
  position: IntlPositionBucket,
  metric: string,
  opponentTeamName: string
): { rank: number; value: number } | null {
  const cached = dvpByPosition.get(position);
  const rankMaps = dvpRankMaps.get(position);
  if (!cached || !rankMaps) return null;
  const slug = wcResolveOpponentDvpSlug(opponentTeamName, cached);
  if (!slug) return null;
  const sampleCount = cached.samples?.[slug] ?? 0;
  if (sampleCount <= 0) return null;
  const entry = rankMaps[metric];
  if (!entry) return null;
  if (entry.values[slug] == null || !Number.isFinite(Number(entry.values[slug]))) return null;
  const rank = entry.ranks[slug];
  if (!rank) return null;
  return { rank, value: entry.values[slug] ?? 0 };
}

function wcPropStatToDvpMetric(statType: string): string | null {
  if (statType === 'goals') return 'goals';
  if (statType === 'assists') return 'assists';
  if (statType === 'total_shots') return 'shots_total';
  if (statType === 'shots_on_target') return 'shots_on_target';
  if (statType === 'yellow_cards') return 'yellow_cards';
  return null;
}

function wcNationMatchesTeam(nation: string, teamName: string): boolean {
  return worldCupTeamsMatch(nation, teamName);
}

function wcResolvePlayerCountry(entry: WorldCupPlayerIndexEntry | null): string | null {
  if (!entry) return null;
  const wcSource = entry.sources.find((s) => s.competition === 'world-cup' && s.countryName);
  if (wcSource?.countryName) return wcSource.countryName;
  const any = entry.sources.find((s) => s.countryName);
  return any?.countryName ?? null;
}

function wcResolvePlayerPosition(entry: WorldCupPlayerIndexEntry | null): IntlPositionBucket | null {
  if (!entry) return null;
  const wcSource = entry.sources.find((s) => s.competition === 'world-cup' && s.position);
  const raw = wcSource?.position ?? entry.sources.find((s) => s.position)?.position ?? null;
  return classifyIntlPositionString(raw);
}

function wcResolvePlayerBdlId(entry: WorldCupPlayerIndexEntry | null): string | null {
  if (!entry) return null;
  const wcSource = entry.sources.find((s) => s.competition === 'world-cup' && s.source === 'bdl' && s.id);
  const id = String(wcSource?.id ?? '').trim();
  return /^\d+$/.test(id) ? id : null;
}

function wcResolvePlayerTeamForRow(
  row: WorldCupListPropRow,
  entry: WorldCupPlayerIndexEntry | null
): { playerTeam: string; opponent: string } {
  const country = wcResolvePlayerCountry(entry);
  if (country) {
    if (wcNationMatchesTeam(country, row.homeTeam)) return { playerTeam: row.homeTeam, opponent: row.awayTeam };
    if (wcNationMatchesTeam(country, row.awayTeam)) return { playerTeam: row.awayTeam, opponent: row.homeTeam };
  }
  return { playerTeam: row.homeTeam, opponent: row.awayTeam };
}

type WcPropsEnrichContext = {
  indexByName: Map<string, WorldCupPlayerIndexEntry>;
  teamNameToBdlId: Map<string, number>;
  dvpByPosition: Map<IntlPositionBucket, WcDvpAggregateCached>;
  dvpRankMaps: Map<IntlPositionBucket, WcDvpRankMaps>;
};

async function loadWcPropsEnrichContext(): Promise<WcPropsEnrichContext> {
  const [playerIndex, bdlTeams, gkDvp, defDvp, midDvp, fwdDvp] = await Promise.all([
    getWorldCupCache<WorldCupPlayerIndexEntry[]>(WORLD_CUP_PLAYER_INDEX_CACHE_KEY),
    getWorldCupCache<Array<{ id: number; name: string; country_code?: string | null }>>(WC2026_CACHE_KEYS.teams),
    getWorldCupCache<WcDvpAggregateCached>(WC2026_CACHE_KEYS.dvpWc2026ForPosition('GK')),
    getWorldCupCache<WcDvpAggregateCached>(WC2026_CACHE_KEYS.dvpWc2026ForPosition('DEF')),
    getWorldCupCache<WcDvpAggregateCached>(WC2026_CACHE_KEYS.dvpWc2026ForPosition('MID')),
    getWorldCupCache<WcDvpAggregateCached>(WC2026_CACHE_KEYS.dvpWc2026ForPosition('FWD')),
  ]);

  const indexByName = new Map<string, WorldCupPlayerIndexEntry>();
  for (const entry of playerIndex ?? []) {
    indexByName.set(entry.normalizedName, entry);
    indexByName.set(normalizeWorldCupPlayerName(entry.name), entry);
    indexByName.set(resolveWorldCupAliasName(normalizeWorldCupPlayerName(entry.name)), entry);
  }

  const teamNameToBdlId = new Map<string, number>();
  for (const team of bdlTeams ?? []) {
    const id = Number(team.id);
    if (!Number.isFinite(id)) continue;
    teamNameToBdlId.set(normalizeWorldCupPlayerName(team.name), id);
    if (team.country_code) teamNameToBdlId.set(String(team.country_code).trim().toLowerCase(), id);
    const slug = resolveWorldCupFlagCode(team.name);
    if (slug) teamNameToBdlId.set(slug.toLowerCase(), id);
  }

  const dvpByPosition = new Map<IntlPositionBucket, WcDvpAggregateCached>();
  const dvpRankMaps = new Map<IntlPositionBucket, WcDvpRankMaps>();
  if (gkDvp) {
    dvpByPosition.set('GK', gkDvp);
    dvpRankMaps.set('GK', wcBuildDvpRankMaps(gkDvp));
  }
  if (defDvp) {
    dvpByPosition.set('DEF', defDvp);
    dvpRankMaps.set('DEF', wcBuildDvpRankMaps(defDvp));
  }
  if (midDvp) {
    dvpByPosition.set('MID', midDvp);
    dvpRankMaps.set('MID', wcBuildDvpRankMaps(midDvp));
  }
  if (fwdDvp) {
    dvpByPosition.set('FWD', fwdDvp);
    dvpRankMaps.set('FWD', wcBuildDvpRankMaps(fwdDvp));
  }

  return { indexByName, teamNameToBdlId, dvpByPosition, dvpRankMaps };
}

async function wcResolveBdlTeamId(
  teamName: string,
  ctx: WcPropsEnrichContext
): Promise<number | null> {
  const teamKey = normalizeWorldCupPlayerName(teamName);
  const id =
    ctx.teamNameToBdlId.get(teamKey) ??
    ctx.teamNameToBdlId.get(String(resolveWorldCupFlagCode(teamName) ?? '').toLowerCase()) ??
    null;
  return id != null && Number.isFinite(id) ? id : null;
}

async function wcEnrichRowMeta(
  row: WorldCupListPropRow,
  ctx: WcPropsEnrichContext
): Promise<
  Pick<
    WorldCupListPropRow,
    'dvpRating' | 'dvpStatValue' | 'headshotUrl' | 'wcPosition' | 'playerTeam' | 'playerId' | 'teamId' | 'opponentTeamId'
  >
> {
  const normalized = resolveWorldCupAliasName(normalizeWorldCupPlayerName(row.playerName));
  const entry = ctx.indexByName.get(normalized) ?? ctx.indexByName.get(normalizeWorldCupPlayerName(row.playerName)) ?? null;
  const position = wcResolvePlayerPosition(entry);
  const playerId = wcResolvePlayerBdlId(entry);
  const { playerTeam, opponent } = wcResolvePlayerTeamForRow(row, entry);
  const metric = wcPropStatToDvpMetric(row.statType);

  let dvpRating: number | null = null;
  let dvpStatValue: number | null = null;
  if (position && metric && getWorldCupDvpStats(position).includes(metric)) {
    const opponentCandidates = [opponent, row.awayTeam, row.homeTeam].filter(
      (name, idx, arr) => name && arr.indexOf(name) === idx
    );
    for (const opp of opponentCandidates) {
      const hit = wcLookupDvpRank(ctx.dvpByPosition, ctx.dvpRankMaps, position, metric, opp);
      if (hit) {
        dvpRating = hit.rank;
        dvpStatValue = hit.value;
        break;
      }
    }
  }

  const [playerTeamBdlId, homeBdlId, awayBdlId] = await Promise.all([
    wcResolveBdlTeamId(playerTeam, ctx),
    wcResolveBdlTeamId(row.homeTeam, ctx),
    wcResolveBdlTeamId(row.awayTeam, ctx),
  ]);
  const headshotUrl = await resolveWorldCupPropsPlayerPhotoUrl({
    playerName: row.playerName,
    bdlTeamIds: [playerTeamBdlId, homeBdlId, awayBdlId],
    indexEntry: entry,
  });
  const opponentTeamBdlId = wcNationMatchesTeam(opponent, row.homeTeam)
    ? homeBdlId
    : wcNationMatchesTeam(opponent, row.awayTeam)
      ? awayBdlId
      : null;

  return {
    dvpRating,
    dvpStatValue,
    headshotUrl,
    wcPosition: position,
    playerTeam,
    playerId,
    teamId: playerTeamBdlId != null ? String(playerTeamBdlId) : null,
    opponentTeamId: opponentTeamBdlId != null ? String(opponentTeamBdlId) : null,
  };
}

export async function diagnoseWorldCupPropsEnrichment(opts: {
  playerFilter?: string;
  limit?: number;
  statFilter?: string;
} = {}): Promise<void> {
  const limit = opts.limit ?? 20;
  const list = await buildWorldCupPlayerPropsList();
  let rows = list.data ?? [];
  if (opts.playerFilter) {
    const q = opts.playerFilter.toLowerCase();
    rows = rows.filter((r) => r.playerName.toLowerCase().includes(q));
  }
  if (opts.statFilter) {
    rows = rows.filter((r) => r.statType === opts.statFilter);
  }
  const sample = rows.slice(0, limit);

  console.log('\n=== World Cup Props DvP / WC diagnose ===\n');
  console.log(`Props list: ${list.data.length} rows, ${list.games.length} games`);
  if (list.ingestMessage) console.log(`Ingest: ${list.ingestMessage}`);

  const ctx = await loadWcPropsEnrichContext();
  console.log(`Player index keys: ${ctx.indexByName.size}`);
  console.log(`BDL team map: ${ctx.teamNameToBdlId.size}`);

  for (const position of ['GK', 'DEF', 'MID', 'FWD'] as IntlPositionBucket[]) {
    const wc2026Key = WC2026_CACHE_KEYS.dvpWc2026ForPosition(position);
    const wc2026 = await getWorldCupCache<WcDvpAggregateCached>(wc2026Key);
    const wc2026Count = wc2026?.opponents?.length ?? Object.keys(wc2026?.names ?? {}).length ?? 0;
    const loaded = ctx.dvpByPosition.has(position);
    console.log(`DvP ${position} (2026 WC only): ${wc2026Count} teams | props cache: ${loaded ? 'loaded' : 'MISSING'} (${wc2026Key})`);
    if (!loaded) console.log('  -> run: npm run build:world-cup:bdl-cache (step 6 builds wc2026 DvP)');
  }

  if (!sample.length) {
    console.log('\nNo sample rows — run npm run refresh:world-cup:odds first.');
    return;
  }

  console.log(`\n--- Sample rows (${sample.length}) ---\n`);
  for (const row of sample) {
    const normalized = resolveWorldCupAliasName(normalizeWorldCupPlayerName(row.playerName));
    const entry = ctx.indexByName.get(normalized) ?? ctx.indexByName.get(normalizeWorldCupPlayerName(row.playerName)) ?? null;
    const position = wcResolvePlayerPosition(entry);
    const { playerTeam, opponent } = wcResolvePlayerTeamForRow(row, entry);
    const metric = wcPropStatToDvpMetric(row.statType);
    const metricsForPos = position ? getWorldCupDvpStats(position) : [];
    const metricOk = Boolean(metric && metricsForPos.includes(metric));
    let slugResolved: string | null = null;
    if (position && metric && metricOk) {
      const cached = ctx.dvpByPosition.get(position);
      if (cached) slugResolved = wcResolveOpponentDvpSlug(opponent, cached);
    }
    const meta = await wcEnrichRowMeta(row, ctx);
    const games = await loadWorldCupPlayerGameLogs(row.playerName);
    const wcGames = games.filter(wcPropStatsIsWorldCupTournamentGame);
    const stats = computeWorldCupPropStatsFromGames(games, row.statType, opponent, row.line, WC_PROPS_STATS_SEASON);
    const supplement = await getWorldCupCache<{ statRows?: unknown[] }>(BDL_DVP_SUPPLEMENT_CACHE_KEY);

    console.log(`${row.playerName} | ${row.statType} @ ${row.line}`);
    console.log(`  fixture: ${row.homeTeam} vs ${row.awayTeam}`);
    console.log(`  resolved team/opponent: ${playerTeam} vs ${opponent}`);
    console.log(
      `  index: ${entry ? 'yes' : 'NO'} | position: ${position ?? 'MISSING'} | metric: ${metric ?? 'n/a'}`
    );
    console.log(`  DvP slug: ${slugResolved ?? 'unresolved'} | rank: ${meta.dvpRating ?? 'N/A'}`);
    console.log(
      `  WC finals games in log: ${wcGames.length} | wc column entries: ${stats.wcGameLog?.length ?? 0} | seasons: ${[...new Set(wcGames.map((g) => String(g.season ?? '?')))] .join(', ')} | BDL supplement rows: ${supplement?.statRows?.length ?? 0}`
    );
    if (!meta.dvpRating) {
      const reasons: string[] = [];
      if (!entry) reasons.push('player not in index (npm run build:world-cup:player-index)');
      if (!position) reasons.push('no position on index entry');
      if (!metric) reasons.push(`stat "${row.statType}" has no DvP metric (fouls are unsupported)`);
      else if (!metricOk) reasons.push(`metric "${metric}" not tracked for ${position}`);
      if (!position || !ctx.dvpByPosition.has(position)) reasons.push('2026 WC DvP cache empty (npm run build:world-cup:bdl-cache)');
      else if (!slugResolved) reasons.push(`opponent "${opponent}" not in DvP slug map`);
      console.log(`  DvP N/A because: ${reasons.join('; ')}`);
    }
    console.log('');
  }

  console.log('=== Done ===\n');
}

const WC_LIST_ENRICH_CONCURRENCY = 64;

export async function enrichWorldCupPlayerPropsList(
  rows: WorldCupListPropRow[],
  options: { cacheOnly?: boolean; skipRowMeta?: boolean } = {}
): Promise<WorldCupListPropRow[]> {
  const cacheOnly = options.cacheOnly ?? true;
  const skipRowMeta = options.skipRowMeta ?? false;
  wcPropStatsByKeyCache.clear();
  const total = rows.length;
  if (total > 0) {
    console.log(
      `[wc-odds] Enriching stats for ${total} prop row(s) (cacheOnly=${cacheOnly}, skipRowMeta=${skipRowMeta})...`
    );
  }

  const keysToFetch: string[] = [];
  for (const row of rows) {
    keysToFetch.push(getWorldCupPropStatsCacheKey(row.playerName, row.homeTeam, row.awayTeam, row.statType, row.line));
    keysToFetch.push(getWorldCupPropStatsCacheKey(row.playerName, row.awayTeam, row.homeTeam, row.statType, row.line));
  }
  await prefetchWorldCupPropStatsKeys(keysToFetch);

  const ctx = skipRowMeta ? null : await loadWcPropsEnrichContext();

  const enrichOne = async (row: WorldCupListPropRow, index: number): Promise<WorldCupListPropRow> => {
    let stats = wcPropStatsFromRowCache(row);
    if (!stats && !cacheOnly) {
      stats = await getWorldCupPropStats(row.playerName, row.homeTeam, row.awayTeam, row.statType, row.line, false);
      if (!stats) {
        stats = await getWorldCupPropStats(row.playerName, row.awayTeam, row.homeTeam, row.statType, row.line, false);
      }
    }
    const meta = ctx ? await wcEnrichRowMeta(row, ctx) : {};
    wcProgressLog('wc-odds', index + 1, total, 'props enriched');
    return {
      ...row,
      ...meta,
      ...(stats
        ? {
            last5Avg: stats.last5Avg,
            last10Avg: stats.last10Avg,
            seasonAvg: stats.seasonAvg,
            streak: stats.streak,
            last5HitRate: stats.last5HitRate,
            last10HitRate: stats.last10HitRate,
            seasonHitRate: stats.seasonHitRate,
            wcGamesAvg: stats.wcGamesAvg,
            wcGamesHitRate: stats.wcGamesHitRate,
            wcGameLog: stats.wcGameLog,
            dvpRating: meta.dvpRating ?? stats.dvpRating ?? null,
            dvpStatValue: meta.dvpStatValue ?? stats.dvpStatValue ?? null,
          }
        : {}),
    };
  };

  const enriched = skipRowMeta
    ? await Promise.all(rows.map((row, index) => enrichOne(row, index)))
    : await wcAfMapWithConcurrency(rows, WC_LIST_ENRICH_CONCURRENCY, enrichOne);

  if (total > 0) {
    console.log(`[wc-odds] Enrichment complete (${total} rows)`);
  }
  return enriched;
}

const WC_PROPS_WARM_BATCH_SIZE = 40;
const WC_PROPS_WARM_CONCURRENT_BATCHES = 4;
const WC_PROPS_WARM_MAX_PROPS = 50000;

type WcPropToWarm = { playerName: string; team: string; opponent: string; statType: string; line: number };

export type RunWorldCupPropsStatsWarmOptions = {
  useListApi?: boolean;
};

export type RunWorldCupPropsStatsWarmResult = {
  success: boolean;
  warmed: number;
  failed: number;
  noData: number;
  total?: number;
  skipped?: number;
  rowsFromCache?: number;
  uniqueProps?: number;
  coveragePct?: number;
  error?: string;
};

function wcPropsWarmHasDisplayableOdds(r: WorldCupListPropRow): boolean {
  const over = String(r.overOdds ?? '').trim();
  const under = String(r.underOdds ?? '').trim();
  const yes = String(r.yesOdds ?? '').trim();
  if (yes && yes !== 'N/A') return true;
  return over !== '' && over !== 'N/A' && ((under !== '' && under !== 'N/A') || Number(r.line) > 0.5);
}

export async function runWorldCupPropsStatsWarm(
  baseUrl: string,
  options: RunWorldCupPropsStatsWarmOptions = {}
): Promise<RunWorldCupPropsStatsWarmResult> {
  const { useListApi = false } = options;
  const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;

  try {
    console.log('[WC props-stats/warm] Starting... baseUrl=', url, 'useListApi=', useListApi);

    let rowsFromList: WorldCupListPropRow[] = [];
    if (useListApi) {
      try {
        const listUrl = `${url}/api/world-cup/dashboard?playerPropsList=1&enrich=false`;
        const listRes = await fetch(listUrl, { cache: 'no-store' });
        if (listRes.ok) {
          const listData = await listRes.json();
          rowsFromList = filterWorldCupListPropsByMinOdds(Array.isArray(listData?.data) ? listData.data : []);
          console.log('[WC props-stats/warm] List API returned', rowsFromList.length, 'rows');
        }
      } catch (e) {
        console.warn('[WC props-stats/warm] List API fetch failed, falling back to cache:', e);
      }
    }

    const listResult =
      useListApi && rowsFromList.length > 0
        ? { games: [] as { gameId: string }[], data: rowsFromList }
        : await buildWorldCupPlayerPropsList();

    const rows = listResult.data ?? [];
    if (!rows.length) {
      console.log('[WC props-stats/warm] No props in cache. Refresh World Cup props list first.');
      return { success: true, warmed: 0, failed: 0, noData: 0, skipped: 0, coveragePct: 100 };
    }
    console.log('[WC props-stats/warm] Props to consider:', rows.length);

    const seen = new Set<string>();
    const toWarm: WcPropToWarm[] = [];
    for (const r of rows) {
      if (!wcPropsWarmHasDisplayableOdds(r)) continue;
      const key = getWorldCupPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      if (seen.has(key)) continue;
      seen.add(key);
      toWarm.push({
        playerName: r.playerName,
        team: r.homeTeam,
        opponent: r.awayTeam,
        statType: r.statType,
        line: r.line,
      });
    }

    const toProcess = toWarm.slice(0, WC_PROPS_WARM_MAX_PROPS);
    console.log('[WC props-stats/warm] Unique props to warm:', toProcess.length);

    let warmed = 0;
    let failed = 0;
    let noData = 0;
    let errored = 0;

    const runBatch = (batch: WcPropToWarm[]) =>
      Promise.all(
        batch.map((p) =>
          getWorldCupPropStats(p.playerName, p.team, p.opponent, p.statType, p.line, false)
            .then((r) => {
              if (!r) {
                failed++;
                noData++;
                return;
              }
              const hasStats =
                r.last5Avg != null ||
                r.last10Avg != null ||
                r.h2hAvg != null ||
                r.seasonAvg != null ||
                r.streak != null;
              if (hasStats) warmed++;
              else {
                failed++;
                noData++;
              }
            })
            .catch((err) => {
              failed++;
              errored++;
              console.warn('[WC props-stats/warm] getWorldCupPropStats failed:', p.playerName, p.statType, err);
            })
        )
      );

    for (let i = 0; i < toProcess.length; i += WC_PROPS_WARM_BATCH_SIZE * WC_PROPS_WARM_CONCURRENT_BATCHES) {
      const batchPromises: Promise<unknown>[] = [];
      for (let b = 0; b < WC_PROPS_WARM_CONCURRENT_BATCHES; b++) {
        const start = i + b * WC_PROPS_WARM_BATCH_SIZE;
        if (start >= toProcess.length) break;
        const batch = toProcess.slice(start, start + WC_PROPS_WARM_BATCH_SIZE);
        if (batch.length) batchPromises.push(runBatch(batch));
      }
      await Promise.all(batchPromises);
      const done = Math.min(i + WC_PROPS_WARM_BATCH_SIZE * WC_PROPS_WARM_CONCURRENT_BATCHES, toProcess.length);
      wcProgressLog('wc-warm', done, toProcess.length, `warmed: ${warmed}`);
    }

    const coveragePct = toProcess.length > 0 ? Math.round((warmed / toProcess.length) * 100) : 100;
    console.log(
      '[WC props-stats/warm] Done. Warmed',
      warmed,
      '| No data:',
      noData,
      '| Errors:',
      errored,
      '| Coverage:',
      `${coveragePct}%`
    );
    return {
      success: true,
      warmed,
      failed,
      noData,
      total: toProcess.length,
      skipped: Math.max(0, toWarm.length - WC_PROPS_WARM_MAX_PROPS),
      rowsFromCache: rows.length,
      uniqueProps: toWarm.length,
      coveragePct,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[WC props-stats/warm]', err);
    return { success: false, warmed: 0, failed: 0, noData: 0, coveragePct: 0, error: message };
  }
}

export async function getWorldCupEnrichedListCache(): Promise<{
  games: WorldCupListGame[];
  data: WorldCupListPropRow[];
  lastUpdated: string;
} | null> {
  const cached = await sharedCache.getJSON<{
    games: WorldCupListGame[];
    data: WorldCupListPropRow[];
    lastUpdated: string;
  }>(WC_LIST_ENRICHED_RESPONSE_CACHE_KEY);
  if (!cached?.data?.length && !cached?.games?.length) return null;
  const filtered = wcFilterListPayloadByOddsHorizon({
    games: cached.games ?? [],
    data: cached.data ?? [],
  });
  if (!filtered.data.length && !filtered.games.length) return null;
  return {
    games: filtered.games,
    data: filtered.data,
    lastUpdated: cached.lastUpdated ?? '',
  };
}

export async function setWorldCupEnrichedListCache(payload: {
  games: WorldCupListGame[];
  data: WorldCupListPropRow[];
  lastUpdated: string;
}): Promise<void> {
  await sharedCache.setJSON(WC_LIST_ENRICHED_RESPONSE_CACHE_KEY, payload, WC_LIST_ENRICHED_CACHE_TTL_SECONDS);
}

/** Build props-page payload from odds list + warmed prop-stats caches (self-heal when enriched blob missing). */
export async function rebuildWorldCupEnrichedListFromOddsCache(options?: {
  cacheOnly?: boolean;
  skipRowMeta?: boolean;
  writeCache?: boolean;
}): Promise<{
  games: WorldCupListGame[];
  data: WorldCupListPropRow[];
  lastUpdated: string | null;
  rawOddsCount: number;
  ingestMessage: string;
}> {
  const cacheOnly = options?.cacheOnly ?? true;
  const skipRowMeta = options?.skipRowMeta ?? true;
  const writeCache = options?.writeCache ?? true;

  const result = await buildWorldCupPlayerPropsList({ cacheOnly: true });
  if (!result.data.length) {
    return {
      games: [],
      data: [],
      lastUpdated: result.lastUpdated,
      rawOddsCount: 0,
      ingestMessage: result.ingestMessage,
    };
  }

  const enriched = await enrichWorldCupPlayerPropsList(result.data, { cacheOnly, skipRowMeta });
  const filtered = filterWorldCupPropsWithPlayerCategoryStats(result.games, enriched);
  const lastUpdated = result.lastUpdated ?? new Date().toISOString();

  if (writeCache && filtered.data.length) {
    await setWorldCupEnrichedListCache({ games: filtered.games, data: filtered.data, lastUpdated });
  }

  const ingestMessage =
    filtered.data.length > 0
      ? `Fetched ${filtered.data.length} props for ${filtered.games.length} games`
      : `${result.data.length} Bet365 props in cache but none have player stats yet — re-run World Cup Process Stats.`;

  return {
    games: filtered.games,
    data: filtered.data,
    lastUpdated,
    rawOddsCount: result.data.length,
    ingestMessage,
  };
}

/** Refresh API-Football props list + enriched cache (cron / manual). */
export async function refreshWorldCupOddsCache(): Promise<{
  success: boolean;
  gamesCount: number;
  propsCount: number;
  lastUpdated: string | null;
  ingestMessage: string;
  error?: string;
}> {
  try {
    const result = await buildWorldCupPlayerPropsList({ refresh: true });
    console.log(
      `[wc-odds] List build done — ${result.games.length} games, ${result.data.length} raw props`
    );
    // Odds list cache is written by buildWorldCupPlayerPropsList above.
    // Enriched cache (odds + hit rates) is built after props-stats warm — not here.
    return {
      success: true,
      gamesCount: result.games.length,
      propsCount: result.data.length,
      lastUpdated: result.lastUpdated,
      ingestMessage: result.ingestMessage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      gamesCount: 0,
      propsCount: 0,
      lastUpdated: null,
      ingestMessage: 'World Cup odds refresh failed.',
      error: message,
    };
  }
}
