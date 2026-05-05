import { Redis } from '@upstash/redis';
const AFL_CACHE_SCHEMA = 'v1';
const AFL_CACHE_PREFIX = `afl:player-logs:${AFL_CACHE_SCHEMA}`;

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || '';
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useUpstash = process.env.AFL_USE_UPSTASH_CACHE === 'true';

const hasRemoteCache = !!(useUpstash && upstashUrl && upstashToken);
const redis = hasRemoteCache
  ? new Redis({ url: upstashUrl, token: upstashToken })
  : null;

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
  return hasRemoteCache;
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
    await redis.set(key, payload, { ex: ttlSeconds });
  } catch {
    // Ignore cache write failures and continue with source response.
  }
}

