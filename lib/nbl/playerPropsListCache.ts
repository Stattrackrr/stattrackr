/**
 * Prebuilt NBL props-page list. User/combined paths read this only.
 * Cron / snapshot refresh writes it. Redis-only so combined paint stays
 * client-safe (same as tennis).
 */

import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp } from '@/lib/combinedPropsSnapshotTypes';

export const NBL_LIST_CACHE_KEY = 'nbl_player_props_list_v1';
export const NBL_LIST_CACHE_TTL_SECONDS = 8 * 60 * 60;
const NBL_LIST_LAST_GOOD_KEY = 'nbl_player_props_list_last_good_v1';
const NBL_LIST_LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;
const NBL_LIST_CACHE_READ_KEYS = [NBL_LIST_CACHE_KEY, NBL_LIST_LAST_GOOD_KEY] as const;

export type NblListCachePayload = {
  success?: boolean;
  data?: CombinedPlayerProp[];
  games?: CombinedAflGame[];
  propsCount?: number;
  gamesCount?: number;
  lastUpdated?: string | null;
  nextUpdate?: string | null;
  ingestMessage?: string | null;
  noAflOdds?: boolean;
  noNblOdds?: boolean;
};

export async function readNblPlayerPropsListCache(): Promise<NblListCachePayload | null> {
  for (const key of NBL_LIST_CACHE_READ_KEYS) {
    const cached = await sharedCache.getJSON<NblListCachePayload>(key);
    if (cached && Array.isArray(cached.data) && cached.data.length > 0) return cached;
  }
  return null;
}

export async function writeNblPlayerPropsListCache(payload: {
  data: unknown[];
  [key: string]: unknown;
}): Promise<void> {
  if (!Array.isArray(payload.data) || payload.data.length === 0) return;
  await sharedCache.setJSONMany([
    { key: NBL_LIST_CACHE_KEY, value: payload, ttlSeconds: NBL_LIST_CACHE_TTL_SECONDS },
    { key: NBL_LIST_LAST_GOOD_KEY, value: payload, ttlSeconds: NBL_LIST_LAST_GOOD_TTL_SECONDS },
  ]);
}
