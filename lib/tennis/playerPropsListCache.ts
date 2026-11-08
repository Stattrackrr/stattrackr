import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp } from '@/lib/combinedPropsSnapshotTypes';
import { tennisCommenceTimeStillOnBoard } from '@/lib/tennis/oddsBoard';

export const TENNIS_LIST_CACHE_KEY = 'tennis_player_props_list_v34';
export const TENNIS_LIST_CACHE_TTL_SECONDS = 30 * 60;
export const TENNIS_LIST_LAST_GOOD_KEY = 'tennis_player_props_list_last_good_v1';
const TENNIS_LIST_LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;
// Prefer v34. Accept v33 only while deploy rolls so the board is not empty.
const TENNIS_LIST_CACHE_READ_KEYS = [TENNIS_LIST_CACHE_KEY, 'tennis_player_props_list_v33'] as const;

export type TennisListCachePayload = {
  success?: boolean;
  data?: CombinedPlayerProp[];
  games?: CombinedAflGame[];
  lastUpdated?: string | null;
  nextUpdate?: string | null;
  ingestMessage?: string | null;
  noTennisOdds?: boolean;
};

/** Drop set/alt junk already baked into list rows (e.g. BetGoodwin Games Won 5.5). */
export function stripJunkTennisPlayerGameRows<T extends { statType?: string | null; line?: unknown }>(
  rows: T[]
): T[] {
  return rows.filter((row) => {
    const stat = String(row.statType || '');
    if (stat !== 'gamesWon' && stat !== 'gamesLost') return true;
    const n = Number.parseFloat(String(row.line ?? '').replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) && n >= 9.5;
  });
}

function sanitizeTennisListPayload(cached: TennisListCachePayload): TennisListCachePayload {
  const data = Array.isArray(cached.data) ? stripJunkTennisPlayerGameRows(cached.data) : [];
  if (data === cached.data) return cached;
  return { ...cached, data };
}

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
    if (cached && tennisListCacheStillCurrent(cached)) return sanitizeTennisListPayload(cached);
  }
  const lastGood = await sharedCache.getJSON<TennisListCachePayload>(TENNIS_LIST_LAST_GOOD_KEY);
  if (lastGood && tennisListCacheStillCurrent(lastGood)) return sanitizeTennisListPayload(lastGood);
  return null;
}

export async function writeTennisPlayerPropsListCache(payload: {
  data: unknown[];
  [key: string]: unknown;
}): Promise<void> {
  if (!Array.isArray(payload.data) || payload.data.length === 0) return;
  const data = stripJunkTennisPlayerGameRows(payload.data as Array<{ statType?: string | null; line?: unknown }>);
  if (!data.length) return;
  const clean = { ...payload, data };
  await sharedCache.setJSONMany([
    { key: TENNIS_LIST_CACHE_KEY, value: clean, ttlSeconds: TENNIS_LIST_CACHE_TTL_SECONDS },
    { key: TENNIS_LIST_LAST_GOOD_KEY, value: clean, ttlSeconds: TENNIS_LIST_LAST_GOOD_TTL_SECONDS },
  ]);
}

export async function deleteTennisPlayerPropsListCache(): Promise<void> {
  await Promise.allSettled([
    sharedCache.deleteJSON(TENNIS_LIST_CACHE_KEY),
    sharedCache.deleteJSON('tennis_player_props_list_v33'),
    sharedCache.deleteJSON('tennis_player_props_list_v32'),
    sharedCache.deleteJSON('tennis_player_props_list_v31'),
    sharedCache.deleteJSON(TENNIS_LIST_LAST_GOOD_KEY),
  ]);
}
