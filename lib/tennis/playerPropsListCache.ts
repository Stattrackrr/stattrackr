import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp } from '@/lib/combinedPropsSnapshotTypes';
import { tennisCommenceTimeStillOnBoard } from '@/lib/tennis/oddsBoard';

export const TENNIS_LIST_CACHE_KEY = 'tennis_player_props_list_v33';
export const TENNIS_LIST_CACHE_TTL_SECONDS = 30 * 60;
export const TENNIS_LIST_LAST_GOOD_KEY = 'tennis_player_props_list_last_good_v1';
const TENNIS_LIST_LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;
const TENNIS_LIST_CACHE_READ_KEYS = [TENNIS_LIST_CACHE_KEY] as const;

export type TennisListCachePayload = {
  success?: boolean;
  data?: CombinedPlayerProp[];
  games?: CombinedAflGame[];
  lastUpdated?: string | null;
  nextUpdate?: string | null;
  ingestMessage?: string | null;
  noTennisOdds?: boolean;
};

function tennisListCacheStillCurrent(cached: TennisListCachePayload): boolean {
  const rows = Array.isArray(cached.data) ? cached.data : [];
  if (!rows.length) return false;
  return rows.some((row) =>
    tennisCommenceTimeStillOnBoard(
      (row as CombinedPlayerProp & { commenceTime?: string | null }).commenceTime || row.gameDate
    )
  );
}

export async function readTennisPlayerPropsListCache(): Promise<TennisListCachePayload | null> {
  for (const key of TENNIS_LIST_CACHE_READ_KEYS) {
    const cached = await sharedCache.getJSON<TennisListCachePayload>(key);
    if (cached && tennisListCacheStillCurrent(cached)) return cached;
  }
  const lastGood = await sharedCache.getJSON<TennisListCachePayload>(TENNIS_LIST_LAST_GOOD_KEY);
  if (lastGood && tennisListCacheStillCurrent(lastGood)) return lastGood;
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

export async function deleteTennisPlayerPropsListCache(): Promise<void> {
  await Promise.allSettled([
    sharedCache.deleteJSON(TENNIS_LIST_CACHE_KEY),
    sharedCache.deleteJSON('tennis_player_props_list_v31'),
    sharedCache.deleteJSON('tennis_player_props_list_v32'),
    sharedCache.deleteJSON(TENNIS_LIST_LAST_GOOD_KEY),
  ]);
}
