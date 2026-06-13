import { AsyncLocalStorage } from 'async_hooks';
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Permanent (no-expiry) Supabase-backed cache for World Cup BDL data.
 *
 * Entries are stored in the `world_cup_cache` table and never expire — once a
 * search query or player's stats are resolved from BDL they are reused forever
 * (until explicitly re-upserted). This keeps us off the BDL API on repeat
 * searches/selections.
 */

const WORLD_CUP_CACHE_TABLE = 'world_cup_cache';
const WORLD_CUP_CACHE_WARNINGS = new Set<string>();

function warnWorldCupCache(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${context}:${message}`;
  if (WORLD_CUP_CACHE_WARNINGS.has(key)) return;
  WORLD_CUP_CACHE_WARNINGS.add(key);
  console.warn(`[World Cup Cache] ${context}:`, error);
}

/** Read a cached value by key. Returns null when missing or on error. */
export async function getWorldCupCache<T = unknown>(cacheKey: string): Promise<T | null> {
  if (!cacheKey) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from(WORLD_CUP_CACHE_TABLE)
      .select('payload')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (error) {
      warnWorldCupCache(`Failed to read cache for ${cacheKey}`, error);
      return null;
    }
    if (!data) return null;
    return (data as { payload: T }).payload ?? null;
  } catch (error) {
    warnWorldCupCache(`Failed to read cache for ${cacheKey}`, error);
    return null;
  }
}

/**
 * Persist a value permanently (no TTL). Upserts on `cache_key` so re-running
 * the same key refreshes the stored payload. Returns true on success.
 */
export async function setWorldCupCache(cacheKey: string, payload: unknown): Promise<boolean> {
  if (!cacheKey || payload == null) return false;
  try {
    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin.from(WORLD_CUP_CACHE_TABLE).upsert(
      {
        cache_key: cacheKey,
        payload,
        generated_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'cache_key' }
    );

    if (error) {
      warnWorldCupCache(`Failed to write cache for ${cacheKey}`, error);
      return false;
    }
    return true;
  } catch (error) {
    warnWorldCupCache(`Failed to write cache for ${cacheKey}`, error);
    return false;
  }
}

// ── Cache vs live BDL tracing (WC_CACHE_DEBUG=1 or dev mode) ─────────────────

export type WcDataSource =
  | 'supabase-cache'
  | 'cache-miss'
  | 'bdl-live'
  | 'bdl-memory'
  | 'supabase-intl'
  | 'computed';

export type WcCacheDebugSummary = {
  bdlLiveCount: number;
  bdlLiveCalls: string[];
  sources: Record<string, { source: WcDataSource; detail?: string }>;
  summary: string;
};

type WcCacheDebugContext = {
  sources: Record<string, { source: WcDataSource; detail?: string }>;
  bdlLiveCalls: string[];
};

const wcCacheDebugAls = new AsyncLocalStorage<WcCacheDebugContext>();

/** True in dev, when ?debug=1, or when WC_CACHE_DEBUG=1 (set WC_CACHE_DEBUG=0 to silence). */
export function isWcCacheDebug(request?: NextRequest | null): boolean {
  if (process.env.WC_CACHE_DEBUG === '0') return false;
  if (process.env.WC_CACHE_DEBUG === '1') return true;
  if (request?.nextUrl.searchParams.get('debug') === '1') return true;
  return process.env.NODE_ENV === 'development';
}

export async function runWithWcCacheDebug<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  return wcCacheDebugAls.run({ sources: {}, bdlLiveCalls: [] }, fn);
}

export function recordWcSource(key: string, source: WcDataSource, detail?: string): void {
  const ctx = wcCacheDebugAls.getStore();
  if (!ctx) return;
  ctx.sources[key] = { source, detail };
  if (source === 'bdl-live') ctx.bdlLiveCalls.push(detail || key);
}

export function wcCacheLog(label: string, data?: Record<string, unknown>): void {
  if (!wcCacheDebugAls.getStore() && process.env.WC_CACHE_DEBUG !== '1') return;
  console.log(label, data ?? '');
}

export function getWcCacheDebugSummary(): WcCacheDebugSummary | null {
  const ctx = wcCacheDebugAls.getStore();
  if (!ctx) return null;
  const bdlLiveCount = ctx.bdlLiveCalls.length;
  const summary =
    bdlLiveCount === 0
      ? 'cache/supabase only - no live BDL'
      : bdlLiveCount === 1 && ctx.sources.featureLineups?.source === 'bdl-live'
        ? '1 intentional live BDL call (fixture lineups)'
        : `${bdlLiveCount} live BDL call(s): ${ctx.bdlLiveCalls.slice(0, 8).join(' | ')}`;
  return {
    bdlLiveCount,
    bdlLiveCalls: [...ctx.bdlLiveCalls],
    sources: { ...ctx.sources },
    summary,
  };
}

export function attachWcDebug<T extends Record<string, unknown>>(
  payload: T,
  debug: boolean
): T & { _wcDebug?: WcCacheDebugSummary } {
  if (!debug) return payload;
  const summary = getWcCacheDebugSummary();
  if (!summary) return payload;
  return { ...payload, _wcDebug: summary };
}

export function wcDebugResponseHeaders(debug: boolean): Record<string, string> {
  if (!debug) return {};
  const summary = getWcCacheDebugSummary();
  if (!summary) return { 'X-WC-Cache-Debug': '1' };
  return {
    'X-WC-Cache-Debug': '1',
    'X-WC-BDL-Live-Count': String(summary.bdlLiveCount),
    'X-WC-Cache-Summary': summary.summary.slice(0, 240),
  };
}

export function logWcCacheRequestComplete(endpoint: string, debug: boolean): WcCacheDebugSummary | null {
  if (!debug) return null;
  const summary = getWcCacheDebugSummary();
  if (!summary) return null;
  console.log(`[wc-cache] ${endpoint} | ${summary.summary}`);
  return summary;
}
