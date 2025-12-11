export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import type { OddsCache } from '@/app/api/odds/refresh/route';

// Cache key for odds (matches the one in app/api/odds/route.ts)
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

// Cache key prefix for player props
// Version 2: Added combined stats DvP support (PRA, PA, PR, RA)
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props-processed-v2';

/**
 * Get the earliest game date from odds cache
 * This represents the date of the games we're showing props for
 */
function getGameDateFromOddsCache(oddsCache: OddsCache): string {
  if (!oddsCache.games || oddsCache.games.length === 0) {
    // Fallback to today's date if no games
    return new Date().toISOString().split('T')[0];
  }
  
  // Find the earliest commenceTime from all games
  const dates = oddsCache.games
    .map(game => game.commenceTime)
    .filter(Boolean)
    .map(time => {
      try {
        const date = new Date(time);
        return date.toISOString().split('T')[0];
      } catch {
        return null;
      }
    })
    .filter(Boolean) as string[];
  
  if (dates.length === 0) {
    return new Date().toISOString().split('T')[0];
  }
  
  // Return the earliest date (games are typically for today or tomorrow)
  return dates.sort()[0];
}

/**
 * Get unique player prop vendors from odds cache
 */
function getPlayerPropVendors(oddsCache: OddsCache): string[] {
  const vendors = new Set<string>();
  if (oddsCache.games && Array.isArray(oddsCache.games)) {
    for (const game of oddsCache.games) {
      if (game.playerPropsByBookmaker && typeof game.playerPropsByBookmaker === 'object') {
        Object.keys(game.playerPropsByBookmaker).forEach(vendor => {
          if (vendor) vendors.add(vendor);
        });
      }
    }
  }
  return Array.from(vendors).sort();
}

/**
 * Get the cache key based on game date, odds lastUpdated timestamp, and vendor count
 * This ensures cache invalidates when:
 * 1. New lines come out (lastUpdated changes)
 * 2. New day's games are available (date changes)
 * 3. New vendors become available (vendor count/list changes)
 */
function getPlayerPropsCacheKey(gameDate: string, oddsLastUpdated: string, vendorCount: number): string {
  // Include date, lastUpdated, and vendor count in the key
  // When vendors change (e.g., from 2 to 7), the cache key changes even if lastUpdated is the same
  return `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}-${oddsLastUpdated}-v${vendorCount}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === '1';
    
    // If force refresh is requested, clear all player props caches
    if (forceRefresh) {
      console.log('[Player Props API] Force refresh requested - clearing all player props caches...');
      
      // Clear all caches that match the prefix
      const { cache: inMemoryCache } = await import('@/lib/cache');
      const cacheKeys = inMemoryCache.keys();
      for (const key of cacheKeys) {
        if (key.startsWith(PLAYER_PROPS_CACHE_PREFIX)) {
          inMemoryCache.delete(key);
          console.log(`[Player Props API] Cleared cache key: ${key}`);
        }
      }
      
      // Also try to clear from shared cache (Upstash Redis)
      try {
        const { getNBACache } = await import('@/lib/nbaCache');
        // Note: We can't easily list all keys in Upstash, so we'll clear on next cache miss
        console.log('[Player Props API] Shared cache will be cleared on next cache miss');
      } catch (e) {
        console.warn('[Player Props API] Could not clear shared cache:', e);
      }
      
      return NextResponse.json({
        success: true,
        data: [],
        cached: false,
        message: 'Cache cleared - refresh the page to reprocess player props'
      });
    }
    
    // First, get the odds cache to check lastUpdated timestamp
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
    });
    
    // Fallback to in-memory cache
    if (!oddsCache) {
      const { cache: inMemoryCache } = await import('@/lib/cache');
      oddsCache = inMemoryCache.get(ODDS_CACHE_KEY);
    }
    
    if (!oddsCache || !oddsCache.lastUpdated) {
      return NextResponse.json({
        success: false,
        error: 'No odds data available',
        data: []
      }, { status: 503 });
    }
    
    // Get the game date from odds cache (earliest game date)
    const gameDate = getGameDateFromOddsCache(oddsCache);
    
    // Get unique player prop vendors to detect vendor changes
    const playerPropVendors = getPlayerPropVendors(oddsCache);
    const vendorCount = playerPropVendors.length;
    
    // Get cache key based on game date, odds lastUpdated, and vendor count
    // This ensures cache invalidates when vendors change (e.g., from 2 to 7)
    const cacheKey = getPlayerPropsCacheKey(gameDate, oddsCache.lastUpdated, vendorCount);
    console.log(`[Player Props API] 🔑 Looking up cache with key: ${cacheKey}`);
    
    // Check if we have cached processed player props for this odds version
    // First check shared cache (Supabase) with longer timeout
    let cachedProps = await getNBACache<any>(cacheKey, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
      quiet: false, // Enable logging to debug cache issues
    });
    
    // Fallback to in-memory cache
    if (!cachedProps) {
      cachedProps = cache.get<any>(cacheKey);
      if (cachedProps) {
        console.log(`[Player Props API] Cache HIT (in-memory) for game date: ${gameDate}, odds version: ${oddsCache.lastUpdated}, vendors: ${vendorCount}`);
      }
    }
    
    // If no cache for current odds version, try to serve stale cache (from previous odds version)
    // This ensures users always get instant responses while new cache is being built
    if (!cachedProps) {
      console.log(`[Player Props API] ⚠️ No cache for current odds version - checking for stale cache...`);
      
      // Try to find any recent cache for the same game date (even if odds version or vendor count is different)
      // This allows serving stale data while new cache is being built
      try {
        // First try in-memory cache
        const inMemoryStaleKeys = cache.keys().filter(key => 
          key.startsWith(PLAYER_PROPS_CACHE_PREFIX) && key.includes(gameDate)
        );
        
        let staleCache: any = null;
        
        // Check in-memory cache first (faster)
        for (const staleKey of inMemoryStaleKeys) {
          const stale = cache.get<any>(staleKey);
          if (stale && Array.isArray(stale) && stale.length > 0) {
            staleCache = stale;
            console.log(`[Player Props API] 📦 Serving stale cache from in-memory (${stale.length} props) - new cache will be built in background`);
            break;
          }
        }
        
        // If not found in-memory, check Supabase (try up to 10 keys to find any valid cache)
        if (!staleCache && inMemoryStaleKeys.length > 0) {
          for (const staleKey of inMemoryStaleKeys.slice(0, 10)) {
            try {
              const stale = await getNBACache<any>(staleKey, {
                restTimeoutMs: 5000,
                jsTimeoutMs: 5000,
                quiet: true,
              });
              if (stale && Array.isArray(stale) && stale.length > 0) {
                staleCache = stale;
                console.log(`[Player Props API] 📦 Serving stale cache from Supabase (${stale.length} props) - key: ${staleKey}`);
                break;
              }
            } catch (e) {
              // Ignore errors when checking stale cache
            }
          }
        }
        
        // If still no cache found, try searching Supabase more broadly (any cache for this date)
        // This is a fallback if the cache key format changed
        if (!staleCache) {
          // Try a few common cache key patterns
          const commonPatterns = [
            `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}`,
            `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}-`,
          ];
          
          for (const pattern of commonPatterns) {
            // We can't easily list all Supabase keys, but we can try a few variations
            // Try with different vendor counts (2, 3, 4, 5, 6, 7, 8)
            for (let v = 2; v <= 8; v++) {
              const testKey = `${pattern}${oddsCache.lastUpdated}-v${v}`;
              try {
                const testCache = await getNBACache<any>(testKey, {
                  restTimeoutMs: 3000,
                  jsTimeoutMs: 3000,
                  quiet: true,
                });
                if (testCache && Array.isArray(testCache) && testCache.length > 0) {
                  staleCache = testCache;
                  console.log(`[Player Props API] 📦 Found stale cache with different vendor count (${testCache.length} props) - key: ${testKey}`);
                  break;
                }
              } catch (e) {
                // Ignore
              }
            }
            if (staleCache) break;
          }
        }
        
        if (staleCache) {
          // Serve stale cache but mark it as stale so client knows to update in background
          return NextResponse.json({
            success: true,
            data: staleCache,
            lastUpdated: oddsCache.lastUpdated,
            gameDate,
            cached: true,
            stale: true, // Indicates this is stale cache from previous odds version
            message: 'Serving cached data from previous odds version - new cache being built in background'
          });
        }
      } catch (staleError) {
        // Ignore errors when checking for stale cache - just proceed to cache miss
        console.log(`[Player Props API] Could not check for stale cache:`, staleError);
      }
    }
    
    if (cachedProps) {
      // Validate cached data structure
      const isValid = Array.isArray(cachedProps) && cachedProps.length > 0;
      if (!isValid) {
        console.warn(`[Player Props API] ⚠️ Cached data invalid (not array or empty), treating as cache miss`);
        // Delete invalid cache entry
        try {
          const { deleteNBACache } = await import('@/lib/nbaCache');
          await deleteNBACache(cacheKey);
        } catch (e) {
          // Ignore deletion errors
        }
      } else {
        console.log(`[Player Props API] ✅ Cache HIT for game date: ${gameDate}, odds version: ${oddsCache.lastUpdated}, vendors: ${vendorCount} (${playerPropVendors.join(', ')}), props count: ${cachedProps.length}`);
        return NextResponse.json({
          success: true,
          data: cachedProps,
          lastUpdated: oddsCache.lastUpdated,
          gameDate,
          cached: true
        });
      }
    }
    
    // Cache miss - need to process data
    // This will be handled by the client-side processing for now
    // In the future, we can move the processing logic here
    console.log(`[Player Props API] Cache MISS for game date: ${gameDate}, odds version: ${oddsCache.lastUpdated}, vendors: ${vendorCount} (${playerPropVendors.join(', ')})`);
    
    return NextResponse.json({
      success: true,
      data: [],
      lastUpdated: oddsCache.lastUpdated,
      cached: false,
      message: 'Processing required - cache will be populated after processing'
    });
    
  } catch (error) {
    console.error('[Player Props API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: []
    }, { status: 500 });
  }
}

/**
 * Store processed player props in cache
 * Called after client-side processing completes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data, oddsLastUpdated, gameDate } = body;
    
    if (!data || !oddsLastUpdated) {
      return NextResponse.json({
        success: false,
        error: 'Missing data or oddsLastUpdated'
      }, { status: 400 });
    }
    
    // Always get odds cache to calculate vendor count (ensures cache key matches GET handler)
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
      quiet: true,
    });
    
    if (!oddsCache) {
      const { cache: inMemoryCache } = await import('@/lib/cache');
      oddsCache = inMemoryCache.get(ODDS_CACHE_KEY);
    }
    
    // Get game date from body, or extract from odds cache if not provided
    let finalGameDate = gameDate;
    if (!finalGameDate) {
      if (oddsCache) {
        finalGameDate = getGameDateFromOddsCache(oddsCache);
      } else {
        // Last resort: use today's date
        finalGameDate = new Date().toISOString().split('T')[0];
      }
    }
    
    // Get unique player prop vendors from odds cache (same logic as GET handler)
    // This ensures cache keys match between GET and POST
    let vendorCount = 0;
    if (oddsCache) {
      const playerPropVendors = getPlayerPropVendors(oddsCache);
      vendorCount = playerPropVendors.length;
      console.log(`[Player Props API] Using vendor count from odds cache: ${vendorCount} (${playerPropVendors.join(', ')})`);
    } else {
      // Fallback: extract from processed data if odds cache unavailable
      const vendors = new Set<string>();
      if (data && Array.isArray(data)) {
        for (const prop of data) {
          if (prop.bookmakerLines && Array.isArray(prop.bookmakerLines)) {
            prop.bookmakerLines.forEach((line: any) => {
              if (line.bookmaker) vendors.add(line.bookmaker);
            });
          }
          if (prop.bookmaker) vendors.add(prop.bookmaker);
        }
      }
      vendorCount = vendors.size;
    }
    
    // Get cache key based on game date, odds lastUpdated, and vendor count
    const cacheKey = getPlayerPropsCacheKey(finalGameDate, oddsLastUpdated, vendorCount);
    
    // Cache for 24 hours (safety net - will naturally invalidate when odds refresh or date changes)
    // Store in both in-memory cache and shared cache (Supabase)
    cache.set(cacheKey, data, 24 * 60); // 24 hours in minutes
    
    // Also store in shared cache (Supabase)
    try {
      const cacheSuccess = await setNBACache(cacheKey, 'player-props', data, 24 * 60, false); // 24 hours in minutes, enable logging
      if (cacheSuccess) {
        console.log(`[Player Props API] ✅ Cached processed props in shared cache for game date: ${finalGameDate}, odds version: ${oddsLastUpdated}, vendors: ${vendorCount}, cache key: ${cacheKey}`);
      } else {
        console.warn(`[Player Props API] ⚠️ Failed to cache in shared cache (returned false) for game date: ${finalGameDate}, odds version: ${oddsLastUpdated}`);
      }
    } catch (e) {
      console.error('[Player Props API] ❌ Exception caching in shared cache:', e);
    }
    
    console.log(`[Player Props API] 💾 Cached processed props (in-memory + Supabase) for game date: ${finalGameDate}, odds version: ${oddsLastUpdated}, vendors: ${vendorCount}, cache key: ${cacheKey}`);
    
    return NextResponse.json({
      success: true,
      message: 'Data cached successfully',
      cacheKey
    });
    
  } catch (error) {
    console.error('[Player Props API] POST Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
