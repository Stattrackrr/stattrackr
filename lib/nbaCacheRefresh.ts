/**
 * NBA Cache Refresh System
 * Handles daily stat updates: show old stats immediately, fetch new in background,
 * update when ready, and clean up old entries
 */

import { getNBACache, setNBACache, deleteNBACache } from './nbaCache';
import { cache } from './cache';

export interface CacheRefreshResult<T> {
  data: T | null;
  isStale: boolean;
  refreshInProgress: boolean;
}

/**
 * Get cached data with automatic background refresh
 * Returns old data immediately, triggers refresh in background if stale
 */
export async function getCachedWithRefresh<T = any>(
  cacheKey: string,
  cacheType: string,
  fetchFn: () => Promise<T>,
  ttlMinutes: number,
  isStaleCheck?: (data: T) => boolean
): Promise<CacheRefreshResult<T>> {
  // Try to get cached data
  let cached: T | null = await getNBACache<T>(cacheKey);
  let cacheSource = 'supabase';
  
  // Fallback to in-memory cache
  if (!cached) {
    cached = cache.get<T>(cacheKey) as T | null;
    cacheSource = 'memory';
  }

  // If no cache, fetch immediately
  if (!cached) {
    try {
      const freshData = await fetchFn();
      await setNBACache(cacheKey, cacheType, freshData, ttlMinutes);
      cache.set(cacheKey, freshData, ttlMinutes);
      return {
        data: freshData,
        isStale: false,
        refreshInProgress: false
      };
    } catch (error) {
      console.error(`[Cache Refresh] Error fetching fresh data for ${cacheKey}:`, error);
      return {
        data: null,
        isStale: false,
        refreshInProgress: false
      };
    }
  }

  // Check if data is stale (older than 24 hours for daily updates)
  const isStale = isStaleCheck 
    ? isStaleCheck(cached)
    : false; // Default: not stale (can be overridden)

  // If stale, trigger background refresh
  if (isStale) {
    console.log(`[Cache Refresh] Data is stale for ${cacheKey}, triggering background refresh...`);
    
    // Trigger refresh in background (don't await)
    refreshCacheInBackground(cacheKey, cacheType, fetchFn, ttlMinutes).catch(err => {
      console.error(`[Cache Refresh] Background refresh failed for ${cacheKey}:`, err);
    });

    return {
      data: cached, // Return old data immediately
      isStale: true,
      refreshInProgress: true
    };
  }

  return {
    data: cached,
    isStale: false,
    refreshInProgress: false
  };
}

/**
 * Refresh cache in background
 * Fetches new data, compares with old, updates if different, deletes old
 */
async function refreshCacheInBackground<T = any>(
  cacheKey: string,
  cacheType: string,
  fetchFn: () => Promise<T>,
  ttlMinutes: number
): Promise<void> {
  try {
    // Get old data for comparison
    const oldData = await getNBACache<T>(cacheKey);
    
    // Fetch new data
    console.log(`[Cache Refresh] Fetching new data for ${cacheKey}...`);
    const newData = await fetchFn();
    
    // Compare old vs new (deep comparison)
    const hasChanged = !deepEqual(oldData, newData);
    
    if (hasChanged) {
      console.log(`[Cache Refresh] ✅ New data detected for ${cacheKey}, updating cache...`);
      
      // Update cache with new data
      await setNBACache(cacheKey, cacheType, newData, ttlMinutes);
      cache.set(cacheKey, newData, ttlMinutes);
      
      // Delete old cache entry (it's already replaced by upsert, but we can clean up related entries)
      // The upsert in setNBACache already replaces the old entry, so we don't need to delete
      console.log(`[Cache Refresh] ✅ Cache updated for ${cacheKey}`);
    } else {
      console.log(`[Cache Refresh] No changes detected for ${cacheKey}, keeping existing cache`);
      // Update TTL to extend expiration
      await setNBACache(cacheKey, cacheType, newData, ttlMinutes);
      cache.set(cacheKey, newData, ttlMinutes);
    }
  } catch (error) {
    console.error(`[Cache Refresh] Error refreshing cache for ${cacheKey}:`, error);
    throw error;
  }
}

/**
 * Deep equality check for comparing old vs new data
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  
  if (a == null || b == null) return false;
  
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  
  return true;
}

/**
 * Check if cache entry is stale (older than specified hours)
 * This can be used as the isStaleCheck function
 */
export function isCacheStaleByAge(hours: number = 24) {
  return async <T = any>(cacheKey: string): Promise<boolean> => {
    // We can't easily check age from the cache data itself
    // Instead, we'll use a separate "last_updated" field or check expires_at
    // For now, we'll rely on the TTL - if it's close to expiring, consider it stale
    const cached = await getNBACache<{ updated_at?: string; expires_at?: string }>(cacheKey);
    
    if (!cached || typeof cached !== 'object') return true;
    
    // Check if updated_at exists and is older than specified hours
    if ('updated_at' in cached && cached.updated_at) {
      const updatedAt = new Date(cached.updated_at);
      const now = new Date();
      const ageHours = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);
      return ageHours >= hours;
    }
    
    return false;
  };
}

/**
 * Clean up old cache entries for a specific cache type
 * Deletes entries older than specified days
 */
export async function cleanupOldCacheEntries(
  cacheType: string,
  olderThanDays: number = 1
): Promise<number> {
  // This would require a database query to find old entries
  // For now, we'll rely on the expires_at cleanup
  // In a full implementation, you'd query Supabase for entries with:
  // - cache_type = cacheType
  // - updated_at < (now - olderThanDays)
  console.log(`[Cache Refresh] Cleanup requested for ${cacheType} entries older than ${olderThanDays} days`);
  return 0; // Placeholder - would need Supabase RPC function
}

