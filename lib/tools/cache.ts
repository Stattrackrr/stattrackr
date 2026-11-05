/**
 * In-memory tools scan cache. Invalidated when board as-of moves (see runScan),
 * with a long wall TTL only as a safety net — never hits odds-api.net.
 */

import type { ToolsBonusFlip, ToolsOpportunity, ToolsScanMeta, ToolsSport } from './types';

type CacheEntry<T> = { at: number; value: T };

/** Safety net only — real freshness is board as-of in runScan. */
const TTL_MS = 15 * 60_000;
const store = new Map<string, CacheEntry<unknown>>();

export function toolsCacheGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function toolsCacheSet<T>(key: string, value: T): void {
  store.set(key, { at: Date.now(), value });
}

export function opportunitiesCacheKey(sports: ToolsSport[]): string {
  return `opp:v27:${[...sports].sort().join(',')}`;
}

export function bonusCacheKey(sports: ToolsSport[], bonus: number, book: string, held: string[]): string {
  return `bonus:v13:${[...sports].sort().join(',')}:${bonus}:${book}:${[...held].sort().join(',')}`;
}

export type OpportunitiesPayload = {
  opportunities: ToolsOpportunity[];
  meta: ToolsScanMeta;
};

export type BonusPayload = {
  flips: ToolsBonusFlip[];
  meta: ToolsScanMeta;
};
