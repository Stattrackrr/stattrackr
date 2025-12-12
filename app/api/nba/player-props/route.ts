export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import type { OddsCache } from '@/app/api/odds/refresh/route';

// Cache key for odds (matches the one in app/api/odds/route.ts)
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const ODDS_CACHE_KEY_STAGING = 'all_nba_odds_v2_bdl_staging';

// Cache key prefix for player props
// Version 2: Added combined stats DvP support (PRA, PA, PR, RA)
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props-processed-v2';

/**
 * Get the game date from odds cache in US Eastern Time
 * This represents the date of the games we're showing props for
 * NBA games are scheduled in US Eastern Time, so we need to convert dates accordingly
 * PRIORITIZES TODAY'S GAMES over tomorrow's games
 */
function getGameDateFromOddsCache(oddsCache: OddsCache): string {
  // Helper to get US Eastern Time date string
  const getUSEasternDateString = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
      // Convert MM/DD/YYYY to YYYY-MM-DD
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    });
  };
  
  // Get today's date in US Eastern Time
  const todayUSET = getUSEasternDateString(new Date());
  
  if (!oddsCache.games || oddsCache.games.length === 0) {
    // Fallback to today's date in US ET if no games
    return todayUSET;
  }
  
  // Extract all unique dates from games, converted to US ET
  const gameDates = new Set<string>();
  const dateDetails: Array<{ commenceTime: string; parsedDate: string; gameDateUSET: string; rawDate: string }> = [];
  
  for (const game of oddsCache.games) {
    if (!game.commenceTime) continue;
    
    try {
      // If commenceTime is a date-only string (YYYY-MM-DD), use it directly as the date
      // BDL API returns dates in YYYY-MM-DD format, which is already the game date
      const commenceStr = String(game.commenceTime).trim();
      let gameDateUSET: string;
      
      if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
        // Date-only string from BDL API - this IS the game date, use it directly
        // No need to parse and convert - it's already in the correct format
        gameDateUSET = commenceStr;
        gameDates.add(gameDateUSET);
        
        dateDetails.push({
          commenceTime: commenceStr,
          parsedDate: 'N/A (date-only)',
          gameDateUSET,
          rawDate: commenceStr
        });
      } else {
        // Has time component, parse and convert to US ET
        const date = new Date(commenceStr);
        gameDateUSET = getUSEasternDateString(date);
        gameDates.add(gameDateUSET);
        
        dateDetails.push({
          commenceTime: commenceStr,
          parsedDate: date.toISOString(),
          gameDateUSET,
          rawDate: commenceStr
        });
      }
    } catch (e) {
      console.warn(`[Player Props API] Failed to parse commenceTime: ${game.commenceTime}`, e);
      continue;
    }
  }
  
  // Log date extraction details
  console.log(`[Player Props API] 📊 Extracted ${gameDates.size} unique dates from ${oddsCache.games.length} games`);
  console.log(`[Player Props API] 📊 Today (US ET): ${todayUSET}`);
  console.log(`[Player Props API] 📊 Available game dates: ${Array.from(gameDates).sort().join(', ')}`);
  if (dateDetails.length > 0) {
    console.log(`[Player Props API] 📊 Sample date details (first 3):`, dateDetails.slice(0, 3));
  }
  
  if (gameDates.size === 0) {
    console.log(`[Player Props API] ⚠️ No game dates extracted, falling back to today: ${todayUSET}`);
    return todayUSET;
  }
  
  // PRIORITIZE TODAY: If today's date is in the game dates, use it
  // Otherwise, use the earliest date (tomorrow)
  if (gameDates.has(todayUSET)) {
    console.log(`[Player Props API] ✅ Using TODAY's date: ${todayUSET} (found ${gameDates.size} unique game dates)`);
    return todayUSET;
  }
  
  // No games for today, use the earliest date (should be tomorrow)
  const sortedDates = Array.from(gameDates).sort();
  const earliestDate = sortedDates[0];
  console.log(`[Player Props API] ⚠️ No games for today (${todayUSET}), using earliest date: ${earliestDate} (found ${gameDates.size} unique game dates: ${sortedDates.join(', ')})`);
  return earliestDate;
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
    
    // refresh=1 just forces reading from Supabase (bypasses in-memory cache)
    // It doesn't clear cache or trigger processing - just reads the latest processed cache
    if (forceRefresh) {
      console.log('[Player Props API] Refresh requested - reading from Supabase cache (bypassing in-memory)...');
    }
    
    // First, get the odds cache to check lastUpdated timestamp
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 30000, // Increased from 10s to 30s
      jsTimeoutMs: 30000,   // Increased from 10s to 30s
      quiet: false,
    });
    
    // Fallback to in-memory cache
    if (!oddsCache) {
      const { cache: inMemoryCache } = await import('@/lib/cache');
      oddsCache = inMemoryCache.get(ODDS_CACHE_KEY);
      if (oddsCache) {
        console.log(`[Player Props API] ✅ Using in-memory odds cache (${oddsCache.games?.length || 0} games)`);
      }
    }
    
    // If main cache is empty, try staging cache (if a refresh is in progress)
    if (!oddsCache) {
      console.log(`[Player Props API] ⚠️ Main odds cache empty, checking staging key: ${ODDS_CACHE_KEY_STAGING}`);
      oddsCache = await getNBACache<OddsCache>(ODDS_CACHE_KEY_STAGING, {
        restTimeoutMs: 5000, // Shorter timeout for staging
        jsTimeoutMs: 5000,
        quiet: true, // Don't log verbose messages for staging fallback
      });
      if (oddsCache) {
        console.log(`[Player Props API] ✅ Using STAGING odds cache (${oddsCache.games?.length || 0} games)`);
      }
    }
    
    if (!oddsCache || !oddsCache.lastUpdated) {
      console.error(`[Player Props API] ❌ No odds data available (checked main, in-memory, and staging caches)`);
      return NextResponse.json({
        success: false,
        error: 'No odds data available - odds cache may be refreshing',
        data: []
      }, { status: 503 });
    }
    
    // Get the game date from odds cache (prioritizes today's games)
    const gameDate = getGameDateFromOddsCache(oddsCache);
    console.log(`[Player Props API] 📅 GET: Determined game date: ${gameDate} (from ${oddsCache.games?.length || 0} games)`);
    
    // Get unique player prop vendors to detect vendor changes
    const playerPropVendors = getPlayerPropVendors(oddsCache);
    const vendorCount = playerPropVendors.length;
    
    // Get cache key based on game date, odds lastUpdated, and vendor count
    // This ensures cache invalidates when vendors change (e.g., from 2 to 7)
    const cacheKey = getPlayerPropsCacheKey(gameDate, oddsCache.lastUpdated, vendorCount);
    console.log(`[Player Props API] 🔑 GET: Looking up cache with key: ${cacheKey}`);
    console.log(`[Player Props API] 📊 GET: Cache lookup details: gameDate=${gameDate}, lastUpdated=${oddsCache.lastUpdated}, vendorCount=${vendorCount} (${playerPropVendors.join(', ')})`);
    
    // Check if we have cached processed player props for this odds version
    // If refresh=1, only check Supabase (bypass in-memory cache to get latest)
    let cachedProps: any = null;
    
    if (forceRefresh) {
      // refresh=1: Only check Supabase (bypass in-memory cache to get latest)
      cachedProps = await getNBACache<any>(cacheKey, {
        restTimeoutMs: 30000,
        jsTimeoutMs: 30000,
        quiet: false,
      });
      if (cachedProps) {
        console.log(`[Player Props API] ✅ Cache HIT (Supabase, refresh=1) for key: ${cacheKey} (${Array.isArray(cachedProps) ? cachedProps.length : 'non-array'} items)`);
      } else {
        console.log(`[Player Props API] ⚠️ Cache MISS (Supabase, refresh=1) for key: ${cacheKey}`);
      }
    } else {
      // Normal flow: Check Supabase first, then in-memory cache
      cachedProps = await getNBACache<any>(cacheKey, {
        restTimeoutMs: 30000,
        jsTimeoutMs: 30000,
        quiet: false,
      });
      
      if (cachedProps) {
        console.log(`[Player Props API] ✅ Cache HIT (Supabase) for key: ${cacheKey} (${Array.isArray(cachedProps) ? cachedProps.length : 'non-array'} items)`);
      } else {
        console.log(`[Player Props API] ⚠️ Cache MISS (Supabase) for key: ${cacheKey} - checking in-memory cache...`);
        cachedProps = cache.get<any>(cacheKey);
        if (cachedProps) {
          console.log(`[Player Props API] ✅ Cache HIT (in-memory) for game date: ${gameDate}, odds version: ${oddsCache.lastUpdated}, vendors: ${vendorCount} (${Array.isArray(cachedProps) ? cachedProps.length : 'non-array'} items)`);
        } else {
          console.log(`[Player Props API] ⚠️ Cache MISS (in-memory) for key: ${cacheKey}`);
        }
      }
    }
    
    // If no cache for current odds version, try to serve stale cache (from previous odds version)
    // This ensures users always get instant responses while new cache is being built
    if (!cachedProps) {
      console.log(`[Player Props API] ⚠️ No cache for current odds version - checking for stale cache...`);
      
      // Try to find any recent cache for the same game date and vendor count
      // This allows serving stale data while new cache is being built
      // Priority: 1) Same vendor count, 2) Same date (any vendor count)
      let staleCache: any = null;
      
      try {
        // First try in-memory cache - look for same date AND vendor count
        const allCacheKeys = cache.keys();
        console.log(`[Player Props API] 🔍 Checking ${allCacheKeys.length} in-memory cache keys for stale cache...`);
        
        // Priority 1: Same date AND vendor count (most likely to match)
        const exactMatchKeys = allCacheKeys.filter(key => {
          if (!key.startsWith(PLAYER_PROPS_CACHE_PREFIX) || !key.includes(gameDate)) return false;
          // Check if vendor count matches: key format is ...-v{N}
          const vendorMatch = key.includes(`-v${vendorCount}`);
          return vendorMatch;
        });
        
        console.log(`[Player Props API] 🔍 Found ${exactMatchKeys.length} exact match keys (date + vendor count):`, exactMatchKeys);
        
        // Check exact matches first
        for (const staleKey of exactMatchKeys) {
          const stale = cache.get<any>(staleKey);
          if (stale && Array.isArray(stale) && stale.length > 0) {
            staleCache = stale;
            console.log(`[Player Props API] 📦 Serving stale cache from in-memory (exact match: ${stale.length} props) - key: ${staleKey}`);
            break;
          }
        }
        
        // Priority 2: Same date, any vendor count (if exact match not found)
        if (!staleCache) {
          const dateMatchKeys = allCacheKeys.filter(key => 
            key.startsWith(PLAYER_PROPS_CACHE_PREFIX) && key.includes(gameDate)
          );
          console.log(`[Player Props API] 🔍 Found ${dateMatchKeys.length} date match keys (any vendor count):`, dateMatchKeys);
          
          for (const staleKey of dateMatchKeys) {
            const stale = cache.get<any>(staleKey);
            if (stale && Array.isArray(stale) && stale.length > 0) {
              staleCache = stale;
              console.log(`[Player Props API] 📦 Serving stale cache from in-memory (date match: ${stale.length} props) - key: ${staleKey}`);
              break;
            }
          }
        }
        
        // If not found in-memory, try Supabase with same vendor count first
        if (!staleCache) {
          console.log(`[Player Props API] 🔍 Checking Supabase for stale cache (same vendor count: ${vendorCount})...`);
          
          // Try with current vendor count but different lastUpdated timestamps
          // We'll try a few variations by checking recent timestamps (within last 24 hours)
          // Since we can't list all keys, we'll try constructing keys with recent timestamps
          const now = new Date();
          const recentTimestamps: string[] = [];
          
          // Generate timestamps for the last 48 hours (every 5 minutes) - more aggressive
          for (let minutesAgo = 0; minutesAgo <= 48 * 60; minutesAgo += 5) {
            const timestamp = new Date(now.getTime() - minutesAgo * 60 * 1000);
            recentTimestamps.push(timestamp.toISOString());
          }
          
          // Try each recent timestamp with current vendor count (with longer timeout)
          for (const ts of recentTimestamps.slice(0, 200)) { // Try up to 200 timestamps (16+ hours)
            const testKey = `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}-${ts}-v${vendorCount}`;
            try {
              const testCache = await getNBACache<any>(testKey, {
                restTimeoutMs: 15000, // Increased timeout for stale cache lookup
                jsTimeoutMs: 15000,
                quiet: true,
              });
              if (testCache && Array.isArray(testCache) && testCache.length > 0) {
                staleCache = testCache;
                console.log(`[Player Props API] 📦 Serving stale cache from Supabase (exact vendor match: ${testCache.length} props) - key: ${testKey}`);
                break;
              }
            } catch (e) {
              // Ignore errors
            }
          }
        }
        
        // Last resort: Try any vendor count AND any timestamp for same date in Supabase
        if (!staleCache) {
          console.log(`[Player Props API] 🔍 Trying Supabase with any vendor count and any timestamp for date ${gameDate}...`);
          
          // Try vendor counts 2-10
          for (let v = 2; v <= 10; v++) {
            if (v === vendorCount) continue; // Already tried this
            
            // Try recent timestamps with this vendor count (more aggressive - every 5 minutes)
            const now = new Date();
            for (let minutesAgo = 0; minutesAgo <= 48 * 60; minutesAgo += 5) {
              const timestamp = new Date(now.getTime() - minutesAgo * 60 * 1000);
              const testKey = `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}-${timestamp.toISOString()}-v${v}`;
              try {
                const testCache = await getNBACache<any>(testKey, {
                  restTimeoutMs: 5000, // Shorter timeout for this exhaustive search
                  jsTimeoutMs: 5000,
                  quiet: true,
                });
                if (testCache && Array.isArray(testCache) && testCache.length > 0) {
                  staleCache = testCache;
                  console.log(`[Player Props API] 📦 Serving stale cache from Supabase (vendor ${v}, ${minutesAgo}min ago: ${testCache.length} props) - key: ${testKey}`);
                  break;
                }
              } catch (e) {
                // Ignore
              }
            }
            if (staleCache) break; // Found it, stop searching
          }
        }
        
        if (staleCache) {
          // Serve stale cache but mark it as stale so client knows to update in background
          console.log(`[Player Props API] ✅ GET: Serving stale cache (${staleCache.length} props) - client will update in background`);
          return NextResponse.json({
            success: true,
            data: staleCache,
            lastUpdated: oddsCache.lastUpdated,
            gameDate,
            cached: true,
            stale: true, // Indicates this is stale cache from previous odds version
            message: 'Serving cached data from previous odds version - new cache being built in background'
          });
        } else {
          console.log(`[Player Props API] ⚠️ GET: No stale cache found after extensive search`);
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
    console.log('[Player Props API] 📥 POST request received');
    const body = await request.json();
    const { data, oddsLastUpdated, gameDate } = body;
    
    console.log('[Player Props API] 📥 POST body:', {
      hasData: !!data,
      dataLength: Array.isArray(data) ? data.length : 'not array',
      oddsLastUpdated,
      gameDate
    });
    
    if (!data || !oddsLastUpdated) {
      console.warn('[Player Props API] ❌ POST: Missing data or oddsLastUpdated', {
        hasData: !!data,
        hasOddsLastUpdated: !!oddsLastUpdated
      });
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
    
    // Fallback to in-memory cache
    if (!oddsCache) {
      const { cache: inMemoryCache } = await import('@/lib/cache');
      oddsCache = inMemoryCache.get(ODDS_CACHE_KEY);
      if (oddsCache) {
        console.log(`[Player Props API] ✅ POST: Using in-memory odds cache (${oddsCache.games?.length || 0} games)`);
      }
    }
    
    // If main cache is empty, try staging cache (if a refresh is in progress)
    if (!oddsCache) {
      console.log(`[Player Props API] ⚠️ POST: Main odds cache empty, checking staging key: ${ODDS_CACHE_KEY_STAGING}`);
      oddsCache = await getNBACache<OddsCache>(ODDS_CACHE_KEY_STAGING, {
        restTimeoutMs: 5000, // Shorter timeout for staging
        jsTimeoutMs: 5000,
        quiet: true,
      });
      if (oddsCache) {
        console.log(`[Player Props API] ✅ POST: Using STAGING odds cache (${oddsCache.games?.length || 0} games)`);
      }
    }
    
    // Use the client's gameDate if provided and valid, otherwise recalculate from odds cache
    // This ensures cache key matches what the client used when saving
    let finalGameDate: string;
    if (gameDate && /^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
      // Client provided a valid date - use it to ensure cache key matches
      finalGameDate = gameDate;
      console.log(`[Player Props API] 📅 POST: Using client-provided game date: ${finalGameDate}`);
      
      // Verify it matches what we'd calculate from odds cache (for debugging)
      if (oddsCache) {
        const calculatedDate = getGameDateFromOddsCache(oddsCache);
        if (gameDate !== calculatedDate) {
          console.log(`[Player Props API] ⚠️ POST: Client date (${finalGameDate}) differs from calculated (${calculatedDate}) - using client date for cache key consistency`);
        }
      }
    } else if (oddsCache) {
      // No valid client date, recalculate from odds cache
      finalGameDate = getGameDateFromOddsCache(oddsCache);
      console.log(`[Player Props API] 📅 POST: Recalculated game date from odds cache: ${finalGameDate} (from ${oddsCache.games?.length || 0} games)`);
    } else {
      // Last resort: use today's date in US ET
      const getUSEasternDateString = (date: Date): string => {
        return new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
          return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        });
      };
      finalGameDate = getUSEasternDateString(new Date());
      console.log(`[Player Props API] ⚠️ POST: No odds cache or client date, using today's date: ${finalGameDate}`);
    }
    
    // Get unique player prop vendors from odds cache (same logic as GET handler)
    // This ensures cache keys match between GET and POST
    // IMPORTANT: Use the odds cache that matches the oddsLastUpdated timestamp
    // If the current odds cache has a different lastUpdated, we need to find the matching one
    let vendorCount = 0;
    if (oddsCache) {
      // Check if the odds cache's lastUpdated matches what the client sent
      // If not, the vendor count might be different, causing cache key mismatch
      if (oddsCache.lastUpdated !== oddsLastUpdated) {
        console.log(`[Player Props API] ⚠️ POST: Odds cache lastUpdated (${oddsCache.lastUpdated}) differs from client's (${oddsLastUpdated})`);
        console.log(`[Player Props API] ⚠️ POST: This might cause cache key mismatch - vendor count may be incorrect`);
      }
      
      const playerPropVendors = getPlayerPropVendors(oddsCache);
      vendorCount = playerPropVendors.length;
      console.log(`[Player Props API] 📊 POST: Using vendor count from odds cache: ${vendorCount} (${playerPropVendors.join(', ')})`);
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
      console.log(`[Player Props API] 📊 POST: Using vendor count from processed data: ${vendorCount}`);
    }
    
    // Get cache key based on game date, odds lastUpdated, and vendor count
    // Use the client's oddsLastUpdated to ensure cache key matches what GET will look for
    const cacheKey = getPlayerPropsCacheKey(finalGameDate, oddsLastUpdated, vendorCount);
    
    console.log(`[Player Props API] 🔑 POST: Cache key components:`, {
      gameDate: finalGameDate,
      oddsLastUpdated,
      vendorCount,
      cacheKey
    });
    
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
