import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const ODDS_CACHE_KEY_STAGING = 'all_nba_odds_v2_bdl_staging';

/**
 * Clear odds cache from both in-memory and Supabase
 * Useful for testing and forcing a fresh fetch
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clearPlayerProps = searchParams.get('playerProps') === '1';
    
    console.log('[Odds Clear] 🧹 Clearing odds cache...');
    
    // Clear in-memory cache
    cache.delete(ODDS_CACHE_KEY);
    cache.delete(ODDS_CACHE_KEY_STAGING);
    console.log('[Odds Clear] ✅ Cleared in-memory cache');
    
    // Clear Supabase cache
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (supabaseUrl && supabaseServiceKey) {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { autoRefreshToken: false, persistSession: false }
        });
        
        // Delete from Supabase
        const { error: error1 } = await supabaseAdmin
          .from('nba_api_cache')
          .delete()
          .eq('cache_key', ODDS_CACHE_KEY);
        
        if (error1) {
          console.warn('[Odds Clear] ⚠️ Error deleting main odds cache from Supabase:', error1);
        } else {
          console.log('[Odds Clear] ✅ Cleared main odds cache from Supabase');
        }
        
        const { error: error2 } = await supabaseAdmin
          .from('nba_api_cache')
          .delete()
          .eq('cache_key', ODDS_CACHE_KEY_STAGING);
        
        if (error2) {
          console.warn('[Odds Clear] ⚠️ Error deleting staging odds cache from Supabase:', error2);
        } else {
          console.log('[Odds Clear] ✅ Cleared staging odds cache from Supabase');
        }
      }
    } catch (error: any) {
      console.warn('[Odds Clear] ⚠️ Error clearing Supabase cache:', error.message);
    }
    
    // Optionally clear player props cache too
    if (clearPlayerProps) {
      console.log('[Odds Clear] 🧹 Also clearing player props cache...');
      
      // Get today's date to find the cache key
      const todayUSET = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date()).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      });
      
      const playerPropsCacheKey = `nba-player-props-${todayUSET}`;
      cache.delete(playerPropsCacheKey);
      
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        if (supabaseUrl && supabaseServiceKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
          });
          
          const { error } = await supabaseAdmin
            .from('nba_api_cache')
            .delete()
            .eq('cache_key', playerPropsCacheKey);
          
          if (error) {
            console.warn('[Odds Clear] ⚠️ Error deleting player props cache from Supabase:', error);
          } else {
            console.log('[Odds Clear] ✅ Cleared player props cache from Supabase');
          }
        }
      } catch (error: any) {
        console.warn('[Odds Clear] ⚠️ Error clearing player props cache:', error.message);
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'Odds cache cleared',
      cleared: {
        inMemory: true,
        supabase: true,
        playerProps: clearPlayerProps
      }
    });
    
  } catch (error: any) {
    console.error('[Odds Clear] ❌ Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to clear odds cache'
      },
      { status: 500 }
    );
  }
}

