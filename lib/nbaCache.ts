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
    console.log('[NBA Cache] 🔧 Initializing Supabase client...', {
      url: supabaseUrl.substring(0, 30) + '...',
      keyLength: supabaseServiceKey.length,
      namespace: process.env.NODE_ENV || 'unknown'
    });
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    console.log('[NBA Cache] ✅ Supabase client initialized successfully');
    
    // Test connectivity with a simple query (non-blocking, don't await)
    if (supabaseAdmin) {
      Promise.resolve(
        supabaseAdmin
          .from('nba_api_cache')
          .select('cache_key')
          .limit(1)
      ).then(({ error }) => {
        if (error) {
          console.error('[NBA Cache] ⚠️ Supabase connectivity test failed:', error.message);
        } else {
          console.log('[NBA Cache] ✅ Supabase connectivity test passed');
        }
      }).catch((err: any) => {
        console.error('[NBA Cache] ⚠️ Supabase connectivity test error:', err?.message || String(err));
      });
    }
  } catch (error: any) {
    console.error('[NBA Cache] ❌ Failed to initialize Supabase client:', {
      message: error?.message,
      name: error?.name,
      stack: error?.stack?.split('\n').slice(0, 3).join('\n')
    });
  }
} else {
  const missing = [];
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  console.error(`[NBA Cache] ❌ Supabase credentials not configured (missing: ${missing.join(', ')}) - cache will use in-memory only`);
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
    if (process.env.NODE_ENV === 'production') {
      console.error('[NBA Cache] ❌ Supabase client not initialized in PRODUCTION - cache will not work!');
      console.error('[NBA Cache] Check Vercel environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    } else {
      console.warn('[NBA Cache] ⚠️ Supabase client not initialized (dev mode)');
    }
    return null;
  }

  console.log(`[NBA Cache] 🔍 Querying Supabase for key: ${cacheKey.substring(0, 50)}...`);

  try {
    // Add timeout to prevent hanging in production (increased for network latency)
    const timeoutMs = process.env.NODE_ENV === 'production' ? 10000 : 5000; // 10s in prod, 5s in dev
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        console.warn(`[NBA Cache] ⏱️ Query timeout (${timeoutMs}ms) for key: ${cacheKey.substring(0, 50)}...`);
        resolve(null);
      }, timeoutMs);
    });

    const queryPromise = supabaseAdmin
      .from('nba_api_cache')
      .select('data, expires_at, updated_at, created_at')
      .eq('cache_key', cacheKey)
      .single();

    console.log(`[NBA Cache] 📡 Starting Supabase query for: ${cacheKey.substring(0, 50)}...`);
    const result = await Promise.race([queryPromise, timeoutPromise]);

    if (result === null) {
      console.warn(`[NBA Cache] ⏱️ Query timeout (5s) for key: ${cacheKey.substring(0, 50)}...`);
      return null;
    }

    const { data, error } = result as any;

    if (error) {
      // Log error in production for debugging
      if (error.code === 'PGRST116' || error.code === 'PGRST301') {
        // No rows returned - this is normal, not an error
        console.log(`[NBA Cache] ℹ️ No cache found for key: ${cacheKey.substring(0, 50)}... (PGRST116/PGRST301)`);
        return null;
      }
      console.error(`[NBA Cache] ❌ Supabase query error for ${cacheKey.substring(0, 50)}...:`, {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return null;
    }

    if (!data) {
      console.log(`[NBA Cache] ℹ️ Query returned no data for key: ${cacheKey.substring(0, 50)}...`);
      return null;
    }

    // Type guard for data
    if (!data || typeof data !== 'object' || !('expires_at' in data) || !('data' in data)) {
      console.warn(`[NBA Cache] ⚠️ Invalid data structure for key: ${cacheKey.substring(0, 50)}...`);
      return null;
    }

    // Type assertion for Supabase response
    const cacheData = data as { data: T; expires_at: string; updated_at?: string; created_at?: string };
    
    // Check if expired
    const expiresAt = new Date(cacheData.expires_at);
    if (expiresAt < new Date()) {
      console.log(`[NBA Cache] ⏰ Cache expired for key: ${cacheKey.substring(0, 50)}... (expired at ${expiresAt.toISOString()})`);
      // Auto-delete expired entry
      if (supabaseAdmin) {
        await supabaseAdmin
          .from('nba_api_cache')
          .delete()
          .eq('cache_key', cacheKey);
      }
      return null;
    }

    console.log(`[NBA Cache] ✅ Cache HIT for key: ${cacheKey.substring(0, 50)}... (expires at ${expiresAt.toISOString()})`);

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
  } catch (error: any) {
    // Fail gracefully - return null so in-memory cache can be used
    // Log in both dev and production for debugging
    const errorMsg = error?.message || String(error);
    console.error(`[NBA Cache] ❌ Exception reading from Supabase for key ${cacheKey.substring(0, 50)}...:`, {
      message: errorMsg,
      name: error?.name,
      code: error?.code,
      stack: error?.stack?.split('\n').slice(0, 3).join('\n')
    });
    if (error?.stack && process.env.NODE_ENV === 'development') {
      console.error('[NBA Cache] Stack trace:', error.stack);
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
      console.error(`[NBA Cache] Error writing to Supabase for key ${cacheKey}:`, error.message || error);
      return false;
    }

    return true;
  } catch (error: any) {
    // Fail gracefully - in-memory cache will still work
    const errorMsg = error?.message || String(error);
    console.error(`[NBA Cache] Error setting cache for key ${cacheKey}:`, errorMsg);
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

