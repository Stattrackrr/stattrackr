export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { deleteNBACache, getNBACache } from '@/lib/nbaCache';
import { authorizeAdminRequest } from '@/lib/adminAuth';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';

// Cache keys to clear
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props';

/**
 * Clear all caches (in-memory + Supabase)
 * This endpoint clears:
 * 1. In-memory cache (all entries)
 * 2. Supabase odds cache
 * 3. Supabase player props cache (all versions)
 */
export async function DELETE(request: NextRequest) {
  try {
    // Authentication check - admin only
    const authResult = await authorizeAdminRequest(request);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const rateResult = checkRateLimit(request, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const { searchParams } = new URL(request.url);
    const clearSupabase = searchParams.get('supabase') !== 'false'; // Default: true
    const clearInMemory = searchParams.get('inmemory') !== 'false'; // Default: true
    
    const results: Record<string, any> = {
      timestamp: new Date().toISOString(),
      cleared: {}
    };

    // 1. Clear in-memory cache
    if (clearInMemory) {
      const beforeSize = cache.size;
      const cacheKeys = cache.keys();
      
      // Clear all in-memory cache
      cache.clear();
      
      results.cleared.inMemory = {
        success: true,
        entriesCleared: beforeSize,
        keysCleared: cacheKeys.length,
        sampleKeys: cacheKeys.slice(0, 10)
      };
      console.log(`[Cache Clear] 🧹 Cleared ${beforeSize} in-memory cache entries`);
    }

    // 2. Clear Supabase caches
    if (clearSupabase) {
      const supabaseResults: Record<string, any> = {
        odds: { success: false, error: null },
        playerProps: { success: false, deleted: 0, errors: [] }
      };

      // Clear odds cache
      try {
        const deleted = await deleteNBACache(ODDS_CACHE_KEY);
        supabaseResults.odds = {
          success: deleted,
          key: ODDS_CACHE_KEY
        };
        if (deleted) {
          console.log(`[Cache Clear] ✅ Cleared Supabase odds cache: ${ODDS_CACHE_KEY}`);
        } else {
          console.log(`[Cache Clear] ℹ️ Odds cache not found or already cleared: ${ODDS_CACHE_KEY}`);
        }
      } catch (error: any) {
        supabaseResults.odds.error = error?.message || String(error);
        console.error(`[Cache Clear] ❌ Error clearing odds cache:`, error);
      }

      // Clear player props cache (all versions)
      // Note: We can't easily list all keys in Supabase, so we'll try to clear
      // by attempting to delete common patterns
      // The actual clearing happens when cache is accessed with refresh=1
      try {
        // Try to get current odds cache to find the game date
        const oddsCache = await getNBACache<any>(ODDS_CACHE_KEY, {
          restTimeoutMs: 5000,
          jsTimeoutMs: 5000,
          quiet: true
        });

        if (oddsCache && oddsCache.lastUpdated) {
          // Try to delete player props cache for today and tomorrow
          const today = new Date();
          const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
          
          const getUSEasternDateString = (date: Date): string => {
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/New_York',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
            const parts = formatter.formatToParts(date);
            const year = parts.find(p => p.type === 'year')?.value;
            const month = parts.find(p => p.type === 'month')?.value;
            const day = parts.find(p => p.type === 'day')?.value;
            return `${year}-${month}-${day}`;
          };

          const todayUSET = getUSEasternDateString(today);
          const tomorrowUSET = getUSEasternDateString(tomorrow);
          
          // Try to delete player props for different vendor counts (2-8)
          let deletedCount = 0;
          const errors: string[] = [];
          
          for (const date of [todayUSET, tomorrowUSET]) {
            for (let v = 2; v <= 8; v++) {
              const testKey = `${PLAYER_PROPS_CACHE_PREFIX}-${date}-${oddsCache.lastUpdated}-v${v}`;
              try {
                const deleted = await deleteNBACache(testKey);
                if (deleted) {
                  deletedCount++;
                  console.log(`[Cache Clear] ✅ Deleted player props cache: ${testKey}`);
                }
              } catch (error: any) {
                errors.push(`${testKey}: ${error?.message || String(error)}`);
              }
            }
          }
          
          supabaseResults.playerProps = {
            success: deletedCount > 0 || errors.length === 0,
            deleted: deletedCount,
            attempted: 2, // 2 dates
            errors: errors.slice(0, 5) // Limit error messages
          };
        } else {
          // If no odds cache, try to delete with a wildcard approach
          // We can't do wildcard deletes in Supabase easily, so we'll just note it
          supabaseResults.playerProps = {
            success: true,
            note: 'No odds cache found - player props will be cleared on next refresh',
            deleted: 0
          };
        }
      } catch (error: any) {
        supabaseResults.playerProps.error = error?.message || String(error);
        console.error(`[Cache Clear] ❌ Error clearing player props cache:`, error);
      }

      results.cleared.supabase = supabaseResults;
    }

    return NextResponse.json({
      success: true,
      message: 'Cache cleared successfully',
      ...results
    });

  } catch (error) {
    console.error('[Cache Clear] Error:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        success: false,
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : (error instanceof Error ? error.message : 'Failed to clear cache'),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to show what would be cleared (dry run)
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check - admin only
    const authResult = await authorizeAdminRequest(request);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const rateResult = checkRateLimit(request, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const cacheStats = cache.getStats();
    const cacheKeys = cache.keys();
    
    // Check if odds cache exists in Supabase
    let oddsCacheExists = false;
    try {
      const oddsCache = await getNBACache<any>(ODDS_CACHE_KEY, {
        restTimeoutMs: 3000,
        jsTimeoutMs: 3000,
        quiet: true
      });
      oddsCacheExists = !!oddsCache;
    } catch {
      // Ignore errors
    }

    return NextResponse.json({
      status: 'dry-run',
      message: 'This is a dry run - no caches were cleared',
      wouldClear: {
        inMemory: {
          totalEntries: cacheStats.totalEntries,
          validEntries: cacheStats.validEntries,
          keys: cacheKeys.slice(0, 20), // Show first 20 keys
          totalKeys: cacheKeys.length
        },
        supabase: {
          oddsCache: {
            key: ODDS_CACHE_KEY,
            exists: oddsCacheExists
          },
          playerPropsCache: {
            prefix: PLAYER_PROPS_CACHE_PREFIX,
            note: 'Player props cache keys are dynamic and cannot be listed without querying Supabase'
          }
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in cache clear dry run:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : 'Failed to get cache information' 
      },
      { status: 500 }
    );
  }
}

