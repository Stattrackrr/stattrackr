/**
 * Prebuilt NBA props-page list. User/combined paths read this only; the NBA odds cron writes it.
 */

import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp } from '@/lib/combinedPropsSnapshotTypes';

export const NBA_LIST_SCHEMA = 1;
const NBA_LIST_CACHE_KEY = 'nba_player_props_list_v1';
const NBA_LIST_CACHE_TTL_SECONDS = 8 * 60 * 60;
const NBA_LIST_LAST_GOOD_KEY = 'nba_player_props_list_last_good_v1';
const NBA_LIST_LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;

export type NbaListCachePayload = {
  success?: boolean;
  listSchema?: number;
  data?: CombinedPlayerProp[];
  games?: CombinedAflGame[];
  propsCount?: number;
  gamesCount?: number;
  lastUpdated?: string | null;
  nextUpdate?: string | null;
  ingestMessage?: string | null;
  noNbaOdds?: boolean;
};

export async function readNbaPlayerPropsListCache(): Promise<NbaListCachePayload | null> {
  for (const key of [NBA_LIST_CACHE_KEY, NBA_LIST_LAST_GOOD_KEY]) {
    const cached = await sharedCache.getJSON<NbaListCachePayload>(key);
    if (cached && Array.isArray(cached.data) && cached.data.length > 0) return cached;
  }
  return null;
}

export async function writeNbaPlayerPropsListCache(payload: { data: unknown[]; [key: string]: unknown }): Promise<void> {
  if (!Array.isArray(payload.data) || payload.data.length === 0) return;
  await sharedCache.setJSONMany([
    { key: NBA_LIST_CACHE_KEY, value: payload, ttlSeconds: NBA_LIST_CACHE_TTL_SECONDS },
    { key: NBA_LIST_LAST_GOOD_KEY, value: payload, ttlSeconds: NBA_LIST_LAST_GOOD_TTL_SECONDS },
  ]);
}
