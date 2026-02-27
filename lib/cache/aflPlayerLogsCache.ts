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

export const AFL_PLAYER_LOGS_CACHE_TTL_SECONDS = 60 * 60 * 2; // 2 hours

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

export function buildAflPlayerLogsCacheKey(params: {
  season: number;
  playerName: string;
  teamForRequest: string | null;
  includeQuarters: boolean;
}): string {
  const player = params.playerName.trim().toLowerCase().replace(/\s+/g, ' ');
  const team = (params.teamForRequest || 'none').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
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

export async function setAflPlayerLogsCache(
  key: string,
  payload: AflPlayerLogsCachePayload
): Promise<void> {
  memoryCache.set(key, {
    expiresAt: nowMs() + AFL_PLAYER_LOGS_CACHE_TTL_SECONDS * 1000,
    payload,
  });

  if (!redis) return;

  try {
    await redis.set(key, payload, { ex: AFL_PLAYER_LOGS_CACHE_TTL_SECONDS });
  } catch {
    // Ignore cache write failures and continue with source response.
  }
}

