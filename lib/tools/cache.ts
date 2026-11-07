/**
 * Tools scan cache: in-memory (per instance) + sharedCache Redis so cold
 * serverless instances still open near-instant. Never hits odds-api.net.
 */

import sharedCache from '@/lib/sharedCache';
import type { ToolsBonusFlip, ToolsOpportunity, ToolsScanMeta, ToolsSport } from './types';

type CacheEntry<T> = { at: number; value: T };

/** Safety net only — real freshness is soft SWR windows below. */
const TTL_MS = 15 * 60_000;
const store = new Map<string, CacheEntry<unknown>>();

export function toolsCacheGet<T>(key: string): T | null {
  return toolsCacheGetEntry<T>(key)?.value ?? null;
}

/** Same as get, but keeps the wall-clock so callers can skip Redis on a hot hit. */
export function toolsCacheGetEntry<T>(key: string): CacheEntry<T> | null {
  const hit = store.get(key) as CacheEntry<T> | undefined;
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return hit;
}

export function toolsCacheSet<T>(key: string, value: T, at = Date.now()): void {
  store.set(key, { at, value });
}

/** Serve without re-reading boards / re-scanning. */
export const OPPORTUNITIES_HOT_MS = 90_000;
/** Redis/shared soft window — still serve, refresh in background after HOT. */
export const OPPORTUNITIES_SOFT_MS = 3 * 60_000;
const OPPORTUNITIES_REDIS_TTL_SEC = 180;

export type OpportunitiesPayload = {
  opportunities: ToolsOpportunity[];
  meta: ToolsScanMeta;
};

export type BonusPayload = {
  flips: ToolsBonusFlip[];
  meta: ToolsScanMeta;
};

export function opportunitiesCacheKey(sports: ToolsSport[]): string {
  return `opp:v32:${[...sports].sort().join(',')}`;
}

type StoredOpportunities = { at: number; payload: OpportunitiesPayload };

function redisKey(key: string): string {
  return `tools:${key}`;
}

/** Memory first, then Redis. Returns age so callers can SWR. */
export async function opportunitiesCacheRead(
  key: string
): Promise<{ payload: OpportunitiesPayload; ageMs: number } | null> {
  const mem = toolsCacheGetEntry<OpportunitiesPayload>(key);
  if (mem) return { payload: mem.value, ageMs: Date.now() - mem.at };

  try {
    const remote = await sharedCache.getJSON<StoredOpportunities>(redisKey(key));
    if (remote?.payload && Number(remote.at) > 0) {
      toolsCacheSet(key, remote.payload, remote.at);
      return { payload: remote.payload, ageMs: Date.now() - remote.at };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function opportunitiesCacheWrite(key: string, payload: OpportunitiesPayload): Promise<void> {
  const at = Date.now();
  toolsCacheSet(key, payload, at);
  try {
    await sharedCache.setJSON(redisKey(key), { at, payload } satisfies StoredOpportunities, OPPORTUNITIES_REDIS_TTL_SEC);
  } catch {
    /* memory still warm on this instance */
  }
}

/** Include warmAt so a cron refresh invalidates prior flip results immediately. */
export function bonusCacheKey(
  sports: ToolsSport[],
  bonus: number,
  book: string,
  held: string[],
  warmAt: number
): string {
  return `bonus:v14:${[...sports].sort().join(',')}:${bonus}:${book}:${[...held].sort().join(',')}:${warmAt}`;
}
