import { createClient } from '@supabase/supabase-js';
import type { SoccerwayMatchStats, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'soccer_api_cache';
// Bump when persistent soccer cache payload/coverage rules change.
const SOCCER_CACHE_SCHEMA = 'v3';
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

export type SoccerCacheType = 'team_results' | 'match_stats' | 'team_index' | 'next_fixture';

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
  return `soccer:team-results:${SOCCER_CACHE_SCHEMA}:${normalizeSoccerTeamHref(teamHref)}`;
}

export function buildSoccerMatchStatsCacheKey(matchId: string): string {
  return `soccer:match-stats:${SOCCER_CACHE_SCHEMA}:${String(matchId || '').trim()}`;
}

export function buildSoccerNextFixtureCacheKey(teamHref: string): string {
  return `soccer:next-fixture:${SOCCER_CACHE_SCHEMA}:${normalizeSoccerTeamHref(teamHref)}`;
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
  const restTimeoutMs = Math.max(3000, options.restTimeoutMs ?? 5000);
  const jsTimeoutMs = Math.max(3000, options.jsTimeoutMs ?? 5000);

  const hotHit = hotCache.get(cacheKey);
  if (hotHit && hotHit.expiresAtMs > Date.now()) {
    return hotHit.value as T;
  }

  const inflight = inflightReads.get(cacheKey);
  if (inflight) return (await inflight) as T | null;

  const readPromise = (async (): Promise<T | null> => {
    try {
      if (!options.disableRest && supabaseUrl && supabaseServiceKey) {
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
          const value = attachCacheMetadata(row.data as T, row);
          hotCache.set(cacheKey, { expiresAtMs: Date.now() + HOT_CACHE_TTL_MS, value });
          return value;
        } catch (error) {
          if (!quiet) {
            warnSoccerCache(`REST cache read failed for ${cacheKey}; falling back to JS client`, error);
          }
        }
      }

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
          warnSoccerCache(`Supabase JS cache read timed out for ${cacheKey}; using live fetch fallback`, new Error(`timeout after ${jsTimeoutMs}ms`));
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

      const value = attachCacheMetadata(data.data as T, data);
      hotCache.set(cacheKey, { expiresAtMs: Date.now() + HOT_CACHE_TTL_MS, value });
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
