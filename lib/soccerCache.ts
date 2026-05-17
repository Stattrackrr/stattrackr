import { createClient } from '@supabase/supabase-js';
import type { SoccerwayLineupBundle, SoccerwayMatchStats, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'soccer_api_cache';
// Bump when persistent soccer cache payload/coverage rules change.
const SOCCER_CACHE_SCHEMA = 'v3';
const SOCCER_TEAM_RESULTS_CACHE_SCHEMA = 'v4';
const SOCCER_INJURIES_CACHE_SCHEMA = 'v4';
const SOCCER_CACHE_WARNINGS = new Set<string>();
const SOCCER_CACHE_FOREVER_EXPIRES_AT = '9999-12-31T23:59:59.999Z';

let supabaseAdmin: ReturnType<typeof createClient> | null = null;

function warnSoccerCache(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${context}:${message}`;
  if (SOCCER_CACHE_WARNINGS.has(key)) return;
  SOCCER_CACHE_WARNINGS.add(key);
  console.warn(`[Soccer Cache] ${context}:`, error);
}

if (supabaseUrl && supabaseServiceKey) {
  try {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  } catch (error) {
    warnSoccerCache('Failed to initialize Supabase soccer cache client; using live fetch fallback', error);
  }
}

const HOT_CACHE_TTL_MS = 30 * 1000;
const RECENT_WRITE_TTL_MS = 2 * 60 * 1000;

type HotCacheEntry = { expiresAtMs: number; value: unknown };
type RecentWriteEntry = { expiresAtMs: number; hash: string };

const hotCache = new Map<string, HotCacheEntry>();
const inflightReads = new Map<string, Promise<unknown | null>>();
const recentWrites = new Map<string, RecentWriteEntry>();

export type SoccerCacheType =
  | 'team_results'
  | 'match_stats'
  | 'team_index'
  | 'next_fixture'
  | 'predicted_lineup'
  | 'injuries'
  | 'player_stats';

export type SoccerTeamResultsCachePayload = {
  teamHref: string;
  resultsUrl: string;
  matches: SoccerwayRecentMatch[];
  count: number;
  showMorePagesFetched: number;
  // Marks caches created after the full history pagination probe was implemented.
  historyProbeComplete?: boolean;
  competitionMetadataVersion?: number;
  source: 'soccerway';
  generatedAt: string;
};

export type SoccerMatchStatsCachePayload = {
  matchId: string;
  stats: SoccerwayMatchStats | null;
  source: 'soccerway';
  generatedAt: string;
};

export type SoccerNextFixtureCacheFixture = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  opponentName: string;
  isHome: boolean | null;
  teamLogoUrl: string | null;
  opponentLogoUrl: string | null;
  kickoffUnix: number | null;
  summaryPath: string;
  competitionName: string | null;
  competitionCountry: string | null;
  competitionStage: string | null;
};

export type SoccerNextFixtureCachePayload = {
  teamHref: string;
  fixturesUrl: string;
  fixture: SoccerNextFixtureCacheFixture | null;
  count: number;
  source: 'soccerway';
  generatedAt: string;
};

export type SoccerPredictedLineupCachePayload = {
  teamHref: string;
  summaryPath: string | null;
  lineupsPath: string | null;
  eventId: string | null;
  lineup: SoccerwayLineupBundle | null;
  source: 'soccerway';
  generatedAt: string;
};

export type SoccerInjuryRow = {
  player: string;
  status: 'injury' | 'suspension' | 'absence';
  reason: string;
  estimatedReturn: string | null;
  playerUrl: string | null;
};

export type SoccerInjuriesCachePayload = {
  teamHref: string;
  teamName: string;
  sourcePage: string;
  supported: boolean;
  source: 'soccerway';
  generatedAt: string;
  injuries: SoccerInjuryRow[];
};

export type SoccerPlayerStatsCachePayload<TMatch = unknown> = {
  teamHref: string;
  playerName: string;
  playerKey: string;
  limit: number;
  categories: string[];
  matches: TMatch[];
  source: 'soccerway';
  generatedAt: string;
};

export interface SoccerCacheEntry<T = unknown> {
  cache_key: string;
  cache_type: SoccerCacheType;
  team_href: string | null;
  match_id: string | null;
  data: T;
  fetched_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

type GetCacheOptions = {
  restTimeoutMs?: number;
  jsTimeoutMs?: number;
  disableRest?: boolean;
  quiet?: boolean;
};

function cleanObjectForHash(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cleanObjectForHash);
  const clone: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === '__cache_metadata') continue;
    clone[key] = cleanObjectForHash(inner);
  }
  return clone;
}

function stableHash(value: unknown): string {
  try {
    return JSON.stringify(cleanObjectForHash(value));
  } catch {
    return String(value);
  }
}

export function normalizeSoccerTeamHref(href: string): string {
  const value = String(href || '').trim();
  if (!value) return '';
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.replace(/\/+$/, '');
}

export function extractParticipantIdFromTeamHref(teamHref: string): string {
  return normalizeSoccerTeamHref(teamHref).split('/').filter(Boolean).at(-1) || '';
}

export function buildSoccerTeamResultsCacheKey(teamHref: string): string {
  return `soccer:team-results:${SOCCER_TEAM_RESULTS_CACHE_SCHEMA}:${normalizeSoccerTeamHref(teamHref)}`;
}

export function buildSoccerMatchStatsCacheKey(matchId: string): string {
  return `soccer:match-stats:${SOCCER_CACHE_SCHEMA}:${String(matchId || '').trim()}`;
}

export function buildSoccerNextFixtureCacheKey(teamHref: string): string {
  return `soccer:next-fixture:${SOCCER_CACHE_SCHEMA}:${normalizeSoccerTeamHref(teamHref)}`;
}

export function buildSoccerPredictedLineupCacheKey(teamHref: string): string {
  return `soccer:predicted-lineup:${SOCCER_CACHE_SCHEMA}:${normalizeSoccerTeamHref(teamHref)}`;
}

export function buildSoccerInjuriesCacheKey(teamHref: string): string {
  return `soccer:injuries:${SOCCER_INJURIES_CACHE_SCHEMA}:${normalizeSoccerTeamHref(teamHref)}`;
}

export function buildSoccerPlayerStatsCacheKey(teamHref: string, playerKey: string, limit: number, categories: string[] = []): string {
  const limitKey = limit > 0 ? `l${limit}` : 'all';
  const categoryKey = categories.length ? categories.map((category) => String(category).trim().toLowerCase()).filter(Boolean).join('-') : 'all';
  return `soccer:player-stats:${SOCCER_CACHE_SCHEMA}:${normalizeSoccerTeamHref(teamHref)}:${String(playerKey || '').trim().toLowerCase()}:${limitKey}:${categoryKey}`;
}

function attachCacheMetadata<T>(value: T, row: Record<string, unknown>): T {
  if (!value || typeof value !== 'object') return value;
  const clone = value as T & {
    __cache_metadata?: {
      fetched_at?: string;
      updated_at?: string;
      created_at?: string;
      expires_at?: string;
    };
  };
  clone.__cache_metadata = {
    fetched_at: typeof row.fetched_at === 'string' ? row.fetched_at : undefined,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : undefined,
  };
  return clone;
}

async function getSoccerCache<T = unknown>(cacheKey: string, options: GetCacheOptions = {}): Promise<T | null> {
  if (!supabaseAdmin) return null;

  const quiet = options.quiet ?? false;
  const restTimeoutMs = Math.max(100, options.restTimeoutMs ?? 5000);
  const jsTimeoutMs = Math.max(100, options.jsTimeoutMs ?? 5000);

  const hotHit = hotCache.get(cacheKey);
  if (hotHit && hotHit.expiresAtMs > Date.now()) {
    return hotHit.value as T;
  }

  const inflight = inflightReads.get(cacheKey);
  if (inflight) return (await inflight) as T | null;

  const readPromise = (async (): Promise<T | null> => {
    try {
      const restPromise: Promise<T | null> =
        !options.disableRest && supabaseUrl && supabaseServiceKey
          ? (async () => {
              try {
                const restUrl =
                  `${supabaseUrl}/rest/v1/${TABLE_NAME}` +
                  `?cache_key=eq.${encodeURIComponent(cacheKey)}` +
                  '&select=data,fetched_at,expires_at,updated_at,created_at&limit=1';
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), restTimeoutMs);

                const response = await fetch(restUrl, {
                  method: 'GET',
                  headers: {
                    apikey: supabaseServiceKey,
                    Authorization: `Bearer ${supabaseServiceKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation',
                  },
                  signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                  if (response.status === 404 || response.status === 406) return null;
                  throw new Error(`REST API error: ${response.status} ${response.statusText}`);
                }

                const rows = await response.json();
                if (!Array.isArray(rows) || rows.length === 0) return null;

                const row = rows[0] as Record<string, unknown>;
                return attachCacheMetadata(row.data as T, row);
              } catch (error) {
                if (!quiet) warnSoccerCache(`REST cache read failed for ${cacheKey}`, error);
                return null;
              }
            })()
          : Promise.resolve(null);

      const jsPromise: Promise<T | null> = (async () => {
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), jsTimeoutMs);
        });

        const queryPromise = supabaseAdmin
          .from(TABLE_NAME)
          .select('data, fetched_at, expires_at, updated_at, created_at')
          .eq('cache_key', cacheKey)
          .single();

        const result = await Promise.race([queryPromise, timeoutPromise]);
        if (result === null) {
          if (!quiet) {
            warnSoccerCache(
              `Supabase JS cache read timed out for ${cacheKey}; using cache miss`,
              new Error(`timeout after ${jsTimeoutMs}ms`)
            );
          }
          return null;
        }

        const { data, error } = result as {
          data: Record<string, unknown> | null;
          error: { code?: string; message?: string } | null;
        };

        if (error) {
          if (error.code === 'PGRST116' || error.code === 'PGRST301') return null;
          if (!quiet) warnSoccerCache(`JS cache read failed for ${cacheKey}`, error.message ?? error.code ?? 'unknown error');
          return null;
        }
        if (!data) return null;

        return attachCacheMetadata(data.data as T, data);
      })().catch((error) => {
        if (!quiet) warnSoccerCache(`Unexpected JS cache read failure for ${cacheKey}`, error);
        return null;
      });

      const [restValue, jsValue] = await Promise.all([restPromise, jsPromise]);
      const value = restValue ?? jsValue;
      if (value != null) {
        hotCache.set(cacheKey, { expiresAtMs: Date.now() + HOT_CACHE_TTL_MS, value });
      }
      return value;
    } catch (error) {
      if (!quiet) warnSoccerCache(`Unexpected cache read failure for ${cacheKey}; using live fetch fallback`, error);
      return null;
    }
  })();

  inflightReads.set(cacheKey, readPromise);
  try {
    return await readPromise;
  } finally {
    inflightReads.delete(cacheKey);
  }
}

async function setSoccerCache(
  cacheKey: string,
  cacheType: SoccerCacheType,
  data: unknown,
  ttlMinutes: number,
  extras: { teamHref?: string | null; matchId?: string | null; fetchedAt?: string | null } = {},
  quiet = false
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  try {
    const hash = stableHash(data);
    const recent = recentWrites.get(cacheKey);
    const nowMs = Date.now();
    if (recent && recent.expiresAtMs > nowMs && recent.hash === hash) {
      return true;
    }

    const fetchedAt = extras.fetchedAt ? new Date(extras.fetchedAt) : new Date();
    const expiresAt =
      Number.isFinite(ttlMinutes) && ttlMinutes > 0
        ? new Date(fetchedAt.getTime() + ttlMinutes * 60 * 1000)
        : new Date(SOCCER_CACHE_FOREVER_EXPIRES_AT);
    const cacheEntry = {
      cache_key: cacheKey,
      cache_type: cacheType,
      team_href: extras.teamHref ?? null,
      match_id: extras.matchId ?? null,
      data,
      fetched_at: fetchedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from(TABLE_NAME)
      .upsert(cacheEntry as any, { onConflict: 'cache_key' });

    if (error) {
      if (!quiet) warnSoccerCache(`Failed to persist cache key ${cacheKey}`, error);
      return false;
    }

    recentWrites.set(cacheKey, {
      expiresAtMs: nowMs + RECENT_WRITE_TTL_MS,
      hash,
    });
    hotCache.set(cacheKey, {
      expiresAtMs: nowMs + HOT_CACHE_TTL_MS,
      value: data,
    });
    return true;
  } catch (error) {
    if (!quiet) warnSoccerCache(`Unexpected cache write failure for ${cacheKey}`, error);
    return false;
  }
}

export async function getSoccerTeamResultsCache(teamHref: string, options: GetCacheOptions = {}): Promise<SoccerTeamResultsCachePayload | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return null;
  return getSoccerCache<SoccerTeamResultsCachePayload>(buildSoccerTeamResultsCacheKey(normalized), options);
}

export async function setSoccerTeamResultsCache(
  teamHref: string,
  payload: SoccerTeamResultsCachePayload,
  ttlMinutes: number,
  quiet = false
): Promise<boolean> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized || !Array.isArray(payload?.matches) || payload.matches.length === 0) return false;
  return setSoccerCache(
    buildSoccerTeamResultsCacheKey(normalized),
    'team_results',
    payload,
    ttlMinutes,
    { teamHref: normalized, fetchedAt: payload.generatedAt },
    quiet
  );
}

export async function getSoccerMatchStatsCache(matchId: string, options: GetCacheOptions = {}): Promise<SoccerMatchStatsCachePayload | null> {
  const normalized = String(matchId || '').trim();
  if (!normalized) return null;
  return getSoccerCache<SoccerMatchStatsCachePayload>(buildSoccerMatchStatsCacheKey(normalized), options);
}

export async function setSoccerMatchStatsCache(
  matchId: string,
  payload: SoccerMatchStatsCachePayload,
  ttlMinutes: number,
  quiet = false
): Promise<boolean> {
  const normalized = String(matchId || '').trim();
  if (!normalized) return false;
  return setSoccerCache(
    buildSoccerMatchStatsCacheKey(normalized),
    'match_stats',
    payload,
    ttlMinutes,
    { matchId: normalized, fetchedAt: payload.generatedAt },
    quiet
  );
}

export async function getSoccerNextFixtureCache(
  teamHref: string,
  options: GetCacheOptions = {}
): Promise<SoccerNextFixtureCachePayload | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return null;
  return getSoccerCache<SoccerNextFixtureCachePayload>(buildSoccerNextFixtureCacheKey(normalized), options);
}

export async function setSoccerNextFixtureCache(
  teamHref: string,
  payload: SoccerNextFixtureCachePayload,
  ttlMinutes: number,
  quiet = false
): Promise<boolean> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return false;
  return setSoccerCache(
    buildSoccerNextFixtureCacheKey(normalized),
    'next_fixture',
    payload,
    ttlMinutes,
    { teamHref: normalized, fetchedAt: payload.generatedAt },
    quiet
  );
}

export async function getSoccerPredictedLineupCache(
  teamHref: string,
  options: GetCacheOptions = {}
): Promise<SoccerPredictedLineupCachePayload | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return null;
  return getSoccerCache<SoccerPredictedLineupCachePayload>(buildSoccerPredictedLineupCacheKey(normalized), options);
}

export async function setSoccerPredictedLineupCache(
  teamHref: string,
  payload: SoccerPredictedLineupCachePayload,
  ttlMinutes: number,
  quiet = false
): Promise<boolean> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return false;
  return setSoccerCache(
    buildSoccerPredictedLineupCacheKey(normalized),
    'predicted_lineup',
    payload,
    ttlMinutes,
    { teamHref: normalized, fetchedAt: payload.generatedAt },
    quiet
  );
}

export async function getSoccerInjuriesCache(
  teamHref: string,
  options: GetCacheOptions = {}
): Promise<SoccerInjuriesCachePayload | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return null;
  return getSoccerCache<SoccerInjuriesCachePayload>(buildSoccerInjuriesCacheKey(normalized), options);
}

export async function setSoccerInjuriesCache(
  teamHref: string,
  payload: SoccerInjuriesCachePayload,
  ttlMinutes: number,
  quiet = false
): Promise<boolean> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return false;
  return setSoccerCache(
    buildSoccerInjuriesCacheKey(normalized),
    'injuries',
    payload,
    ttlMinutes,
    { teamHref: normalized, fetchedAt: payload.generatedAt },
    quiet
  );
}

export async function getSoccerPlayerStatsCache<TMatch = unknown>(
  teamHref: string,
  playerKey: string,
  limit: number,
  categories: string[] = [],
  options: GetCacheOptions = {}
): Promise<SoccerPlayerStatsCachePayload<TMatch> | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  const normalizedPlayerKey = String(playerKey || '').trim().toLowerCase();
  if (!normalized || !normalizedPlayerKey) return null;
  return getSoccerCache<SoccerPlayerStatsCachePayload<TMatch>>(
    buildSoccerPlayerStatsCacheKey(normalized, normalizedPlayerKey, limit, categories),
    options
  );
}

function buildSoccerPlayerStatsCacheAttempts(
  limit: number,
  categories: string[]
): Array<{ limit: number; categories: string[] }> {
  const attempts: Array<{ limit: number; categories: string[] }> = [];
  const seen = new Set<string>();
  const add = (l: number, c: string[]) => {
    const normalized = c.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    const cats = normalized.length ? normalized : ['all'];
    const sig = `${l}:${cats.join(',')}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    attempts.push({ limit: l, categories: cats });
  };
  add(limit, categories);
  add(100, categories);
  add(limit, ['all']);
  add(100, ['all']);
  add(30, ['all']);
  add(100, ['top']);
  add(5, ['top']);
  return attempts;
}

function averagePlayerStatCategoryTabs(matches: unknown[]): number {
  if (!matches.length) return 0;
  let sum = 0;
  for (const match of matches) {
    const cats = (match as { categories?: Record<string, unknown> })?.categories;
    sum += cats && typeof cats === 'object' ? Object.keys(cats).length : 0;
  }
  return sum / matches.length;
}

function wantsRichPlayerStatCategories(categories: string[]): boolean {
  const normalized = categories.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  if (!normalized.length || normalized.includes('all')) return true;
  return normalized.length > 1;
}

function scorePlayerStatsCacheHit(matches: unknown[], categories: string[]): number {
  const count = matches.length;
  if (!wantsRichPlayerStatCategories(categories)) return count;
  // When the UI asks for full Soccerway depth, prefer multi-tab payloads over a larger top-only row.
  return averagePlayerStatCategoryTabs(matches) * 1_000_000 + count;
}

/** Reads player stats, trying common limit/category cache keys (charts request l30:all; batch may store l100:top). */
export async function getSoccerPlayerStatsCacheWithFallback<TMatch = unknown>(
  teamHref: string,
  playerKey: string,
  limit: number,
  categories: string[] = [],
  options: GetCacheOptions = {}
): Promise<SoccerPlayerStatsCachePayload<TMatch> | null> {
  let best: SoccerPlayerStatsCachePayload<TMatch> | null = null;
  let bestScore = -1;
  for (const attempt of buildSoccerPlayerStatsCacheAttempts(limit, categories)) {
    const hit = await getSoccerPlayerStatsCache<TMatch>(
      teamHref,
      playerKey,
      attempt.limit,
      attempt.categories,
      options
    );
    if (!hit || !Array.isArray(hit.matches) || hit.matches.length === 0) continue;
    const score = scorePlayerStatsCacheHit(hit.matches, categories);
    if (!best || score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return best;
}

export async function setSoccerPlayerStatsCache<TMatch = unknown>(
  teamHref: string,
  playerKey: string,
  limit: number,
  categories: string[],
  payload: SoccerPlayerStatsCachePayload<TMatch>,
  ttlMinutes: number,
  quiet = false
): Promise<boolean> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  const normalizedPlayerKey = String(playerKey || '').trim().toLowerCase();
  if (!normalized || !normalizedPlayerKey || !Array.isArray(payload?.matches)) return false;
  return setSoccerCache(
    buildSoccerPlayerStatsCacheKey(normalized, normalizedPlayerKey, limit, categories),
    'player_stats',
    payload,
    ttlMinutes,
    { teamHref: normalized, fetchedAt: payload.generatedAt },
    quiet
  );
}

export type SoccerCachedPlayerIndexRow = {
  playerKey: string;
  displayName: string;
  teamHref: string;
  matchCount: number;
};

/** All players with at least one cached match row (deduped per team + playerKey). */
export async function listSoccerCachedPlayersIndex(options: { quiet?: boolean } = {}): Promise<SoccerCachedPlayerIndexRow[]> {
  if (!supabaseAdmin) return [];

  const quiet = options.quiet ?? false;
  const cacheKeyPrefix = `soccer:player-stats:${SOCCER_CACHE_SCHEMA}:`;
  const pageSize = 1000;
  const byPlayer = new Map<string, SoccerCachedPlayerIndexRow>();

  try {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabaseAdmin
        .from(TABLE_NAME)
        .select('team_href, data, cache_key')
        .eq('cache_type', 'player_stats')
        .like('cache_key', `${cacheKeyPrefix}%`)
        .range(offset, offset + pageSize - 1);

      if (error) {
        if (!quiet) warnSoccerCache('Failed to list cached player-stats index', error);
        break;
      }

      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) break;

      for (const row of rows) {
        const record = row as { team_href?: string | null; data?: unknown; cache_key?: string };
        const payload = record.data as Partial<SoccerPlayerStatsCachePayload> | null;
        const matches = Array.isArray(payload?.matches) ? payload.matches : [];
        if (matches.length === 0) continue;

        const playerKey = String(payload?.playerKey || '').trim().toLowerCase();
        const displayName = String(payload?.playerName || '').trim();
        const teamHref = normalizeSoccerTeamHref(String(payload?.teamHref || record.team_href || ''));
        if (!playerKey || !displayName || !teamHref) continue;

        const dedupeKey = `${teamHref}|${playerKey}`;
        const matchCount = matches.length;
        const cacheKey = String(record.cache_key || '');
        const prefersAllCategories = cacheKey.endsWith(':all') || cacheKey.includes(':all:');
        const existing = byPlayer.get(dedupeKey);
        if (
          !existing ||
          matchCount > existing.matchCount ||
          (matchCount === existing.matchCount && prefersAllCategories)
        ) {
          byPlayer.set(dedupeKey, { playerKey, displayName, teamHref, matchCount });
        }
      }

      if (rows.length < pageSize) break;
    }
  } catch (error) {
    if (!quiet) warnSoccerCache('Unexpected failure listing cached player-stats index', error);
  }

  return [...byPlayer.values()].sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return a.displayName.localeCompare(b.displayName);
  });
}

export async function cleanupExpiredSoccerCache(): Promise<number> {
  if (!supabaseAdmin) return 0;
  try {
    const { data, error } = await supabaseAdmin.rpc('cleanup_expired_soccer_cache');
    if (error) return 0;
    return data || 0;
  } catch {
    return 0;
  }
}
