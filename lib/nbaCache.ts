/**
 * NBA API Cache using Supabase
 * Persistent, shared cache that works across all Vercel instances
 * Populated by external service, read by Vercel
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase credentials required for NBA cache');
}

// Admin client (bypasses RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

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
  try {
    const { data, error } = await supabaseAdmin
      .from('nba_api_cache')
      .select('data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    // Check if expired
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      // Auto-delete expired entry
      await supabaseAdmin
        .from('nba_api_cache')
        .delete()
        .eq('cache_key', cacheKey);
      return null;
    }

    return data.data as T;
  } catch (error) {
    console.error('[NBA Cache] Error reading from Supabase:', error);
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
  try {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

    const { error } = await supabaseAdmin
      .from('nba_api_cache')
      .upsert({
        cache_key: cacheKey,
        cache_type: cacheType,
        data: data,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'cache_key'
      });

    if (error) {
      console.error('[NBA Cache] Error writing to Supabase:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[NBA Cache] Error setting cache:', error);
    return false;
  }
}

/**
 * Delete cached entry
 */
export async function deleteNBACache(cacheKey: string): Promise<boolean> {
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

