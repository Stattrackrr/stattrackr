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
  } catch (error: any) {
    // Failed to initialize - will use in-memory cache only
  }
}

export interface NBACacheEntry {
  cache_key: string;
  cache_type: string;
  data: any;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface GetCacheOptions {
  /**
   * Timeout for the REST API shortcut (ms). Defaults to 5s.
   */
  restTimeoutMs?: number;
  /**
   * Timeout for the Supabase JS client query (ms). Defaults to 5s.
   */
  jsTimeoutMs?: number;
  /**
   * Force skipping the REST API shortcut (use JS client only).
   */
  disableRest?: boolean;
  /**
   * Suppress verbose logging (only log errors). Useful for bulk operations.
   */
  quiet?: boolean;
}

/**
 * Get cached NBA API data from Supabase
 */
export async function getNBACache<T = any>(cacheKey: string, options: GetCacheOptions = {}): Promise<T | null> {
  // If Supabase not configured, return null (will fallback to in-memory cache)
  if (!supabaseAdmin) {
    return null;
  }

  const quiet = options.quiet ?? process.env.NBA_CACHE_QUIET === 'true';

  const restTimeoutMs = Math.max(3000, options.restTimeoutMs ?? 5000);
  const jsTimeoutMs = Math.max(3000, options.jsTimeoutMs ?? 5000);

  // In production, if Supabase is consistently slow, we'll skip it after first timeout
  // This prevents blocking the entire request
  try {
    // Use REST API directly in production (faster than JS client)
    // This bypasses the JS client overhead and goes straight to PostgREST
    if (!options.disableRest && process.env.NODE_ENV === 'production' && supabaseUrl && supabaseServiceKey) {
      try {
        // Use simpler query - just get data column, limit to 1 row
        const restUrl = `${supabaseUrl}/rest/v1/nba_api_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=data,expires_at&limit=1`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), restTimeoutMs);
        
        const response = await fetch(restUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          if (response.status === 404 || response.status === 406) {
            // No rows found - this is normal
            return null;
          }
          throw new Error(`REST API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // REST API returns array, not single object
        if (!data || !Array.isArray(data) || data.length === 0) {
          return null;
        }
        
        const cacheEntry = data[0];
        
    // Check if expired (skip check for very long TTLs - effectively never expire)
    const expiresAt = new Date(cacheEntry.expires_at);
    const daysUntilExpiry = (expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
    // If expiration is more than 300 days away, treat as "never expire" (persist until replaced)
    if (daysUntilExpiry < 300 && expiresAt < new Date()) {
      return null;
    }
        
        // Validate data
        if (!cacheEntry.data || (typeof cacheEntry.data === 'object' && Object.keys(cacheEntry.data).length === 0)) {
          return null;
        }
        
        // Attach metadata
        if (cacheEntry.data && typeof cacheEntry.data === 'object') {
          (cacheEntry.data as any).__cache_metadata = {
            updated_at: cacheEntry.updated_at,
            created_at: cacheEntry.created_at,
            expires_at: cacheEntry.expires_at
          };
        }
        
        return cacheEntry.data as T;
      } catch (restError: any) {
        // REST API error, fall through to JS client as fallback
      }
    }
    
    // Fallback to JS client (for dev or if REST API fails)
    // Short timeout - if Supabase is slow, just skip it and use in-memory cache
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), jsTimeoutMs);
    });

    const queryPromise = supabaseAdmin
      .from('nba_api_cache')
      .select('data, expires_at, updated_at, created_at')
      .eq('cache_key', cacheKey)
      .single();

    const result = await Promise.race([queryPromise, timeoutPromise]);

    if (result === null) {
      // Timeout - Supabase is too slow, skip it and use in-memory cache
      return null;
    }

    const { data, error } = result as any;

    if (error) {
      // No rows returned - this is normal, not an error
      if (error.code === 'PGRST116' || error.code === 'PGRST301') {
        return null;
      }
      // Only log non-normal errors
      if (error.code && !error.code.startsWith('PGRST')) {
        console.error(`[NBA Cache] Query error:`, error.message);
      }
      return null;
    }

    if (!data) {
      return null;
    }

    // Type guard for data
    if (!data || typeof data !== 'object' || !('expires_at' in data) || !('data' in data)) {
      return null;
    }

    // Type assertion for Supabase response
    const cacheData = data as { data: T; expires_at: string; updated_at?: string; created_at?: string };
    
    // Check if expired (skip check for very long TTLs - effectively never expire)
    const expiresAt = new Date(cacheData.expires_at);
    const daysUntilExpiry = (expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
    // If expiration is more than 300 days away, treat as "never expire" (persist until replaced)
    if (daysUntilExpiry < 300 && expiresAt < new Date()) {
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
  } catch (error: any) {
    // Fail gracefully - return null so in-memory cache can be used
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
  ttlMinutes: number,
  quiet?: boolean
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
      return false;
    }
    return true;
  } catch (error: any) {
    // Fail gracefully - in-memory cache will still work
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
      return 0;
    }
    return data || 0;
  } catch (error) {
    return 0;
  }
}

