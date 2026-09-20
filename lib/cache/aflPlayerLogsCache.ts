import { Redis } from '@upstash/redis';
// Do NOT bump casually: a new schema orphans the warmed Upstash keys and every
// unauthenticated player-game-logs request returns empty (503 cache-miss).
// New mapped fields (CBA / kick-ins) land on the next warm overwrite of the same keys.
const AFL_CACHE_SCHEMA = 'v5';
const AFL_CACHE_PREFIX = `afl:player-logs:${AFL_CACHE_SCHEMA}`;

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || '';
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useUpstash = process.env.AFL_USE_UPSTASH_CACHE === 'true';

const hasRemoteCache = !!(useUpstash && upstashUrl && upstashToken);
const redis = hasRemoteCache
  ? new Redis({
      url: upstashUrl,
      token: upstashToken,
      // Concurrent warm requests share this client. Auto-pipelining 6 duplicate
      // SETs per player blew past Upstash PAYG's 10MB request cap.
      enableAutoPipelining: false,
    })
  : null;
const UPSTASH_MAX_VALUE_BYTES = 8 * 1024 * 1024;

const memoryCache = new Map<string, { expiresAt: number; payload: unknown }>();

/** Long TTL so cache persists until the next successful warm overwrites it; stats always available. */
export const AFL_PLAYER_LOGS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const AFL_PLAYER_LOGS_NEGATIVE_CACHE_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export type AflPlayerLogsCachePayload = {
  season: number;
  source: string;
  player_name: string;
  games: Array<Record<string, unknown>>;
  game_count: number;
  height?: string;
  guernsey?: number;
  player_page?: string;
};

function nowMs(): number {
  return Date.now();
}

export function isAflPlayerLogsCacheEnabled(): boolean {
  // The process-local cache is still valuable in development and on a warm
  // serverless instance even when Upstash is not configured.
  return true;
}

function normalizeAflPlayerNameForMatchLocal(name: string): string {
  const apostropheLike = /[\u0027\u2018\u2019\u201B\u2032\u0060]/g;
  const hyphenLike = /[\u002D\u2010\u2011\u2012\u2013\u2014\u2212]/g;
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(apostropheLike, "'")
    .replace(hyphenLike, '-')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Shared slot so current-club, former-club, and empty-team requests reuse one payload. */
export const AFL_PLAYER_LOGS_CANONICAL_TEAM = 'any';

export function buildAflPlayerLogsCacheKey(params: {
  season: number;
  playerName: string;
  teamForRequest: string | null;
  includeQuarters: boolean;
}): string {
  const player = normalizeAflPlayerNameForMatchLocal(params.playerName);
  const team = (params.teamForRequest || 'none').trim().toLowerCase().replace(/\s+/g, ' ');
  const quarters = params.includeQuarters ? '1' : '0';
  return `${AFL_CACHE_PREFIX}:${params.season}:${team}:${player}:q${quarters}`;
}

function teamLookupVariants(teamForRequest: string | null): Array<string | null> {
  const requested = teamForRequest?.trim() || null;
  const variants: Array<string | null> = [];
  if (requested && requested.toLowerCase() !== AFL_PLAYER_LOGS_CANONICAL_TEAM) variants.push(requested);
  variants.push(AFL_PLAYER_LOGS_CANONICAL_TEAM);
  variants.push(null);
  const seen = new Set<string>();
  return variants.filter((team) => {
    const token = (team || 'none').toLowerCase();
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

export async function getAflPlayerLogsCacheForPlayer(params: {
  season: number;
  playerName: string;
  teamForRequest: string | null;
}): Promise<{ base: AflPlayerLogsCachePayload; quarters: AflPlayerLogsCachePayload | null } | null> {
  let best: { base: AflPlayerLogsCachePayload; quarters: AflPlayerLogsCachePayload | null; n: number } | null = null;
  for (const team of teamLookupVariants(params.teamForRequest)) {
    const key = buildAflPlayerLogsCacheKey({ ...params, teamForRequest: team, includeQuarters: false });
    const base = await getAflPlayerLogsCache(key);
    if (!base || !Array.isArray(base.games) || base.games.length === 0) continue;
    const n = base.games.length;
    if (best && n <= best.n) continue;
    const quarterKey = buildAflPlayerLogsCacheKey({ ...params, teamForRequest: team, includeQuarters: true });
    const quarters = await getAflPlayerLogsCache(quarterKey);
    best = { base, quarters, n };
  }
  return best ? { base: best.base, quarters: best.quarters } : null;
}

export async function setAflPlayerLogsCacheForPlayer(
  params: { season: number; playerName: string; teamForRequest: string | null },
  payload: AflPlayerLogsCachePayload,
  options?: { allowEmpty?: boolean; ttlSeconds?: number }
): Promise<void> {
  // One canonical key. GET still probes team aliases and falls back here.
  await setAflPlayerLogsCache(
    buildAflPlayerLogsCacheKey({
      ...params,
      teamForRequest: AFL_PLAYER_LOGS_CANONICAL_TEAM,
      includeQuarters: false,
    }),
    payload,
    options
  );
}

export async function getAflPlayerLogsCache(
  key: string
): Promise<AflPlayerLogsCachePayload | null> {
  const inMemory = memoryCache.get(key);
  if (inMemory && inMemory.expiresAt > nowMs()) {
    return inMemory.payload as AflPlayerLogsCachePayload;
  }
  if (inMemory) memoryCache.delete(key);

  if (!redis) return null;

  try {
    const cached = await redis.get<AflPlayerLogsCachePayload>(key);
    if (!cached || typeof cached !== 'object') return null;
    memoryCache.set(key, {
      expiresAt: nowMs() + AFL_PLAYER_LOGS_CACHE_TTL_SECONDS * 1000,
      payload: cached,
    });
    return cached;
  } catch {
    return null;
  }
}

/** Only write when we have a successful payload with at least one game; never overwrite with empty. */
export function isEmptyAflPlayerLogsCachePayload(
  payload: AflPlayerLogsCachePayload | null | undefined
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const games = payload.games;
  const count = payload.game_count ?? (Array.isArray(games) ? games.length : 0);
  return !Array.isArray(games) || games.length === 0 || count <= 0;
}

export async function setAflPlayerLogsCache(
  key: string,
  payload: AflPlayerLogsCachePayload,
  options?: { allowEmpty?: boolean; ttlSeconds?: number }
): Promise<void> {
  const games = payload?.games;
  const allowEmpty = options?.allowEmpty === true;
  if (!Array.isArray(games) || (!allowEmpty && games.length === 0)) return;
  const ttlSeconds = Math.max(1, Number(options?.ttlSeconds || AFL_PLAYER_LOGS_CACHE_TTL_SECONDS));

  memoryCache.set(key, {
    expiresAt: nowMs() + ttlSeconds * 1000,
    payload,
  });

  if (!redis) return;

  try {
    const encoded = JSON.stringify(payload);
    if (encoded.length > UPSTASH_MAX_VALUE_BYTES) {
      console.warn(
        `[AFL player logs] skip Redis SET ${key} (${encoded.length} bytes > ${UPSTASH_MAX_VALUE_BYTES})`
      );
      return;
    }
    await redis.set(key, payload, { ex: ttlSeconds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/max request size|request size/i.test(message)) {
      console.warn(`[AFL player logs] Upstash rejected SET ${key}:`, message);
      return;
    }
    // Ignore cache write failures and continue with source response.
  }
}

