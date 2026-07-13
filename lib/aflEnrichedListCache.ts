/**
 * AFL enriched props list cache (props page cards with stats).
 * Invalidated when the Odds API slate changes so a new round replaces last week's list.
 */

import { deleteNBACache } from '@/lib/nbaCache';
import sharedCache from '@/lib/sharedCache';
import { filterAflPropsEligibleGames, type AflPropsGameRef } from '@/lib/combinedPropsSnapshotTypes';
import type { AflGameOdds } from '@/lib/refreshAflOdds';

export const AFL_LIST_ENRICHED_RESPONSE_CACHE_KEY = 'afl_list_enriched_response_v5';
export const AFL_LIST_ENRICHED_SUPABASE_CACHE_KEY = 'afl_props_list_enriched_v5';
export const AFL_LIST_ENRICHED_STALE_CACHE_KEY = 'afl_list_enriched_response_v3_stale';
export const AFL_LIST_ENRICHED_STALE_SUPABASE_CACHE_KEY = 'afl_props_list_enriched_v3_stale';

type EnrichedPayload = Record<string, unknown>;

let memoryCacheInvalidate: (() => void) | null = null;

/** Register list-route in-memory enriched cache invalidation (avoids circular imports). */
export function registerAflEnrichedListMemoryInvalidate(fn: () => void): void {
  memoryCacheInvalidate = fn;
}

function gameIdsFromOddsGames(games: AflGameOdds[] | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const g of games ?? []) {
    const id = typeof g?.gameId === 'string' ? g.gameId.trim() : '';
    if (id) ids.add(id);
  }
  return ids;
}

function gameIdsFromEnrichedPayload(payload: EnrichedPayload | null | undefined): Set<string> {
  const ids = new Set<string>();
  const games = Array.isArray(payload?.games) ? payload.games : [];
  for (const g of games) {
    if (!g || typeof g !== 'object') continue;
    const id = typeof (g as AflPropsGameRef).gameId === 'string' ? (g as AflPropsGameRef).gameId!.trim() : '';
    if (id) ids.add(id);
  }
  return ids;
}

/** True when Odds API returned a meaningfully different upcoming slate (new round / new event IDs). */
export function aflOddsSlateChanged(
  previous: AflGameOdds[] | null | undefined,
  next: AflGameOdds[] | null | undefined,
  nowMs = Date.now()
): boolean {
  const prevAll = gameIdsFromOddsGames(previous ?? []);
  const nextAll = gameIdsFromOddsGames(next ?? []);
  if (nextAll.size === 0) return false;
  if (prevAll.size === 0) return true;

  for (const id of nextAll) {
    if (!prevAll.has(id)) return true;
  }

  const prevEligible = filterAflPropsEligibleGames(previous ?? [], nowMs);
  const nextEligible = filterAflPropsEligibleGames(next ?? [], nowMs);
  const prevEligibleIds = new Set(prevEligible.map((g) => g.gameId).filter(Boolean));
  const nextEligibleIds = new Set(nextEligible.map((g) => g.gameId).filter(Boolean));

  if (nextEligibleIds.size === 0) return false;
  if (prevEligibleIds.size === 0) return true;

  for (const id of nextEligibleIds) {
    if (!prevEligibleIds.has(id)) return true;
  }

  return false;
}

/** Cached list must include at least one currently eligible odds game or it is last week's slate. */
export function enrichedPayloadMatchesCurrentOddsSlate(
  payload: EnrichedPayload | null | undefined,
  oddsGames: AflGameOdds[] | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const cachedIds = gameIdsFromEnrichedPayload(payload);
  if (cachedIds.size === 0) return false;

  const eligible = filterAflPropsEligibleGames(oddsGames ?? [], nowMs);
  const currentIds = new Set(eligible.map((g) => g.gameId).filter(Boolean));
  if (currentIds.size === 0) return false;

  for (const id of currentIds) {
    if (cachedIds.has(id)) return true;
  }
  return false;
}

export function enrichedPayloadSlateChanged(
  existing: EnrichedPayload | null | undefined,
  next: EnrichedPayload | null | undefined
): boolean {
  const prevIds = gameIdsFromEnrichedPayload(existing);
  const nextIds = gameIdsFromEnrichedPayload(next);
  if (nextIds.size === 0) return false;
  if (prevIds.size === 0) return true;
  for (const id of nextIds) {
    if (!prevIds.has(id)) return true;
  }
  for (const id of prevIds) {
    if (!nextIds.has(id)) return true;
  }
  return false;
}

/** Drop enriched list + stale backup so the next cron/user rebuild uses the current odds slate. */
export async function clearAflEnrichedListCaches(reason?: string): Promise<void> {
  memoryCacheInvalidate?.();
  await Promise.allSettled([
    sharedCache.deleteJSON(AFL_LIST_ENRICHED_RESPONSE_CACHE_KEY),
    sharedCache.deleteJSON(AFL_LIST_ENRICHED_STALE_CACHE_KEY),
    deleteNBACache(AFL_LIST_ENRICHED_SUPABASE_CACHE_KEY),
    deleteNBACache(AFL_LIST_ENRICHED_STALE_SUPABASE_CACHE_KEY),
  ]);
  if (reason) {
    console.log('[AFL enriched list] Cleared caches:', reason);
  }
}
