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
