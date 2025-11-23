/**
 * NBA API Cache using Supabase
 * Persistent, shared cache that works across all Vercel instances
 * Populated by external service, read by Vercel
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Only create client if credentials are available (fail gracefully if not)
let supabaseAdmin: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseServiceKey) {
  try {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  } catch (error) {
    console.warn('[NBA Cache] Failed to initialize Supabase client:', error);
  }
} else {
  console.warn('[NBA Cache] Supabase credentials not configured - cache will use in-memory only');
}

export interface NBACacheEntry {
  cache_key: string;
  cache_type: string;
  data: any;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get cached NBA API data from Supabase
 */
export async function getNBACache<T = any>(cacheKey: string): Promise<T | null> {
  // If Supabase not configured, return null (will fallback to in-memory cache)
  if (!supabaseAdmin) {
    return null;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('nba_api_cache')
      .select('data, expires_at, updated_at, created_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    // Type guard for data
    if (!data || typeof data !== 'object' || !('expires_at' in data) || !('data' in data)) {
      return null;
    }

    // Type assertion for Supabase response
    const cacheData = data as { data: T; expires_at: string; updated_at?: string; created_at?: string };
    
    // Check if expired
    const expiresAt = new Date(cacheData.expires_at);
    if (expiresAt < new Date()) {
      // Auto-delete expired entry
      if (supabaseAdmin) {
        await supabaseAdmin
          .from('nba_api_cache')
          .delete()
          .eq('cache_key', cacheKey);
      }
      return null;
    }

    // Validate that data is not empty (for objects, check if it has any keys beyond metadata)
    const dataToReturn = cacheData.data;
    if (dataToReturn && typeof dataToReturn === 'object' && !Array.isArray(dataToReturn)) {
      // Check if object is empty or only contains metadata-like keys
      const keys = Object.keys(dataToReturn);
      if (keys.length === 0) {
        // Empty object - delete corrupted cache
        console.warn(`[NBA Cache] Found empty cache entry for ${cacheKey}, deleting...`);
        if (supabaseAdmin) {
          await supabaseAdmin
            .from('nba_api_cache')
            .delete()
            .eq('cache_key', cacheKey);
        }
        return null;
      }
      
      // Attach metadata to data for refresh checking
      (dataToReturn as any).__cache_metadata = {
        updated_at: cacheData.updated_at,
        created_at: cacheData.created_at,
        expires_at: cacheData.expires_at
      };
    }

    return dataToReturn;
  } catch (error) {
    // Fail gracefully - return null so in-memory cache can be used
    if (process.env.NODE_ENV === 'development') {
      console.warn('[NBA Cache] Error reading from Supabase (will use in-memory cache):', error);
    }
    return null;
  }
}

/**
 * Set cached NBA API data in Supabase
 */
export async function setNBACache(
  cacheKey: string,
  cacheType: string,
  data: any,
  ttlMinutes: number
): Promise<boolean> {
  // If Supabase not configured, return false (in-memory cache will still work)
  if (!supabaseAdmin) {
    return false;
  }

  try {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

    const now = new Date();
    const cacheEntry = {
      cache_key: cacheKey,
      cache_type: cacheType,
      data: data,
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
      created_at: now.toISOString() // Will be set on insert, updated on upsert
    };

    const { error } = await supabaseAdmin
      .from('nba_api_cache')
      .upsert(cacheEntry as any, {
        onConflict: 'cache_key'
      });

    if (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[NBA Cache] Error writing to Supabase (in-memory cache will still work):', error);
      }
      return false;
    }

    return true;
  } catch (error) {
    // Fail gracefully - in-memory cache will still work
    if (process.env.NODE_ENV === 'development') {
      console.warn('[NBA Cache] Error setting cache (in-memory cache will still work):', error);
    }
    return false;
  }
}

/**
 * Delete cached entry
 */
export async function deleteNBACache(cacheKey: string): Promise<boolean> {
  if (!supabaseAdmin) {
    return false;
  }

  try {
    const { error } = await supabaseAdmin
      .from('nba_api_cache')
      .delete()
      .eq('cache_key', cacheKey);

    return !error;
  } catch (error) {
    console.error('[NBA Cache] Error deleting cache:', error);
    return false;
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpiredCache(): Promise<number> {
  if (!supabaseAdmin) {
    return 0;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('cleanup_expired_nba_cache');
    if (error) {
      console.error('[NBA Cache] Error cleaning up:', error);
      return 0;
    }
    return data || 0;
  } catch (error) {
    console.error('[NBA Cache] Error cleaning up:', error);
    return 0;
  }
}

