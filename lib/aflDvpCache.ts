/**
 * AFL DvP payload cache (Redis).
 * Cron builds DvP and stores it here when running on Vercel (read-only fs).
 * Readers try cache first, then fall back to data/afl-dvp-{season}.json.
 */

import sharedCache from '@/lib/sharedCache';

export const AFL_DVP_CACHE_KEY_PREFIX = 'afl_dvp_payload_';
export const AFL_DVP_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function getAflDvpPayloadCacheKey(season: number): string {
  return `${AFL_DVP_CACHE_KEY_PREFIX}${season}`;
}

export type AflDvpPayload = {
  generatedAt?: string;
  season?: number;
  source?: string;
  summary?: Record<string, unknown>;
  leagueBaselineByPosition?: Record<string, unknown>;
  rows: Array<{
    opponent?: string;
    position?: string;
    sampleSize?: number;
    perPlayerGame?: Record<string, number>;
    perTeamGame?: Record<string, number | null>;
    teamGames?: number;
    [key: string]: unknown;
  }>;
  missingPlayers?: Array<Record<string, unknown>>;
};

export async function getAflDvpPayloadFromCache(season: number): Promise<AflDvpPayload | null> {
  const key = getAflDvpPayloadCacheKey(season);
  return sharedCache.getJSON<AflDvpPayload>(key);
}
