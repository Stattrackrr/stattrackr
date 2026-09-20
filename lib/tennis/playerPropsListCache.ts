import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp } from '@/lib/combinedPropsSnapshotTypes';

export const TENNIS_LIST_CACHE_KEY = 'tennis_player_props_list_v31';
export const TENNIS_LIST_CACHE_TTL_SECONDS = 8 * 60 * 60;
const TENNIS_LIST_LAST_GOOD_KEY = 'tennis_player_props_list_last_good_v1';
const TENNIS_LIST_LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;
const TENNIS_LIST_CACHE_READ_KEYS = [
  TENNIS_LIST_CACHE_KEY,
  'tennis_player_props_list_v32',
  TENNIS_LIST_LAST_GOOD_KEY,
] as const;

export type TennisListCachePayload = {
  success?: boolean;
  data?: CombinedPlayerProp[];
  games?: CombinedAflGame[];
  lastUpdated?: string | null;
  nextUpdate?: string | null;
  ingestMessage?: string | null;
  noTennisOdds?: boolean;
};

export async function readTennisPlayerPropsListCache(): Promise<TennisListCachePayload | null> {
  for (const key of TENNIS_LIST_CACHE_READ_KEYS) {
    const cached = await sharedCache.getJSON<TennisListCachePayload>(key);
    if (cached && Array.isArray(cached.data) && cached.data.length > 0) return cached;
  }
  return null;
}

export async function writeTennisPlayerPropsListCache(payload: {
  data: unknown[];
  [key: string]: unknown;
}): Promise<void> {
  if (!Array.isArray(payload.data) || payload.data.length === 0) return;
  await sharedCache.setJSONMany([
    { key: TENNIS_LIST_CACHE_KEY, value: payload, ttlSeconds: TENNIS_LIST_CACHE_TTL_SECONDS },
    { key: TENNIS_LIST_LAST_GOOD_KEY, value: payload, ttlSeconds: TENNIS_LIST_LAST_GOOD_TTL_SECONDS },
  ]);
}
