import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp } from '@/lib/combinedPropsSnapshotTypes';

export const TENNIS_LIST_CACHE_KEY = 'tennis_player_props_list_v31';
export const TENNIS_LIST_CACHE_TTL_SECONDS = 2 * 60 * 60;
const TENNIS_LIST_CACHE_READ_KEYS = [
  TENNIS_LIST_CACHE_KEY,
  'tennis_player_props_list_v32',
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
  await sharedCache.setJSON(TENNIS_LIST_CACHE_KEY, payload, TENNIS_LIST_CACHE_TTL_SECONDS);
}
