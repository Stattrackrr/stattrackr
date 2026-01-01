export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import type { OddsCache } from '@/app/api/odds/refresh/route';

// Cache key for odds (matches the one in app/api/odds/route.ts)
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const ODDS_CACHE_KEY_STAGING = 'all_nba_odds_v2_bdl_staging';

// Cache key prefix for player props
// Simplified: Just use date, no timestamp or vendor count
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props';

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
  
  // Calculate tomorrow's date
  const todayUSETStr = getUSEasternDateString(new Date());
  const [year, month, day] = todayUSETStr.split('-').map(Number);
  const tomorrowDate = new Date(year, month - 1, day + 1);
  const tomorrowUSET = getUSEasternDateString(tomorrowDate);

  // Default: Show today's props if available, otherwise tomorrow
  if (gameDates.has(todayUSETStr)) {
    console.log(`[Player Props API] ✅ Using TODAY's date: ${todayUSETStr}`);
    return todayUSETStr;
  }
  
  if (gameDates.has(tomorrowUSET)) {
    console.log(`[Player Props API] ✅ Using TOMORROW's date: ${tomorrowUSET} (no games today)`);
    return tomorrowUSET;
  }
  
  // Fallback to tomorrow
  console.log(`[Player Props API] ⚠️ No games found for today or tomorrow, falling back to tomorrow: ${tomorrowUSET}`);
  return tomorrowUSET;
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
 * Generates a cache key for processed player props
 * Simplified: Just use game date - cache is overwritten every 2 hours by cron
 */
function getPlayerPropsCacheKey(gameDate: string): string {
  return `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}`;
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
    let gameDate = getGameDateFromOddsCache(oddsCache);
    console.log(`[Player Props API] 📅 GET: Initial game date: ${gameDate} (from ${oddsCache.games?.length || 0} games)`);
    
    // Helper to get US Eastern Time date string (duplicated from getGameDateFromOddsCache for use in GET handler)
    const getUSEasternDateStringLocal = (date: Date): string => {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      });
    };
    
    // Check if last game of today has started - if so, switch to tomorrow's props if ready
    const todayUSETStr = getUSEasternDateStringLocal(new Date());
    const todayGames = oddsCache.games?.filter((game: any) => {
      if (!game.commenceTime) return false;
      const commenceStr = String(game.commenceTime).trim();
      let gameDateUSET: string;
      if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
        gameDateUSET = commenceStr;
      } else {
        const date = new Date(commenceStr);
        gameDateUSET = getUSEasternDateStringLocal(date);
      }
      return gameDateUSET === todayUSETStr;
    }) || [];

    if (todayGames.length > 0 && gameDate === todayUSETStr) {
      // Find the latest tipoff time for today's games
      // IMPORTANT: Only use games with actual times (not date-only strings)
      // Date-only strings don't have accurate tipoff times, so we can't reliably determine when to switch
      let lastTipoff: Date | null = null;
      for (const game of todayGames) {
        if (!game.commenceTime) continue;
        const commenceStr = String(game.commenceTime).trim();
        
        // Skip date-only strings - we need actual times to determine tipoff
        if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
          console.log(`[Player Props API] ⏭️ Skipping date-only game (no time): ${commenceStr}`);
          continue;
        }
        
        // Has time component - parse it (this is the accurate time)
        const tipoffDate = new Date(commenceStr);
        if (isNaN(tipoffDate.getTime())) {
          console.warn(`[Player Props API] ⚠️ Invalid tipoff time: ${commenceStr}`);
          continue;
        }
        
        if (!lastTipoff || tipoffDate > lastTipoff) {
          lastTipoff = tipoffDate;
        }
      }
      
      // If 10 minutes have passed since last tipoff, check if tomorrow's props are ready
      if (!lastTipoff) {
        console.log(`[Player Props API] ⚠️ No games with actual tipoff times found - cannot determine when to switch to tomorrow's props`);
      } else {
        const now = new Date();
        const tenMinutesAfterTipoff = lastTipoff.getTime() + (10 * 60 * 1000);
        
        if (now.getTime() >= tenMinutesAfterTipoff) {
          const [y, m, d] = todayUSETStr.split('-').map(Number);
          const tomorrowDate = new Date(y, m - 1, d + 1);
          const tomorrowUSET = getUSEasternDateStringLocal(tomorrowDate);
          const tomorrowCacheKey = getPlayerPropsCacheKey(tomorrowUSET);
          const tomorrowProps = await getNBACache<any[]>(tomorrowCacheKey, { quiet: true });
          
          if (tomorrowProps && Array.isArray(tomorrowProps) && tomorrowProps.length > 0) {
            console.log(`[Player Props API] ✅ 10 minutes after last tipoff, switching to TOMORROW's props (${tomorrowProps.length} props ready)`);
            gameDate = tomorrowUSET;
          } else {
            console.log(`[Player Props API] ⏳ 10 minutes after tipoff, but tomorrow's props not ready yet - showing today's props`);
          }
        } else {
          // Game has started but not 10 minutes yet - still show today's props
          const minutesUntilSwitch = Math.ceil((tenMinutesAfterTipoff - now.getTime()) / (60 * 1000));
          console.log(`[Player Props API] ⏰ Last game started, but will switch to tomorrow's props in ${minutesUntilSwitch} minutes`);
        }
      }
    }
    
    // Check for split cache keys first (part1, part2, part3) - new parallel processing approach
    // If split caches exist, combine them. Otherwise fall back to unified cache key.
    const part1CacheKey = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates-part1`;
    const part2CacheKey = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates-part2`;
    const part3CacheKey = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates-part3`;
    const allDatesCacheKey = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates`; // Fallback for unified cache
    
    console.log(`[Player Props API] 🔑 GET: Checking for split cache keys (part1, part2, part3) or unified cache`);
    
    // Try to read all 3 part caches
    const cacheOptions = {
      restTimeoutMs: 30000,
      jsTimeoutMs: 30000,
      quiet: false,
    };
    
    let cachedProps: any = null;
    let part1Props: any = null;
    let part2Props: any = null;
    let part3Props: any = null;
    
    if (forceRefresh) {
      // Force refresh: only check Supabase (bypass in-memory cache)
      part1Props = await getNBACache<any>(part1CacheKey, cacheOptions);
      part2Props = await getNBACache<any>(part2CacheKey, cacheOptions);
      part3Props = await getNBACache<any>(part3CacheKey, cacheOptions);
    } else {
      // Check Supabase first, then in-memory cache
      part1Props = await getNBACache<any>(part1CacheKey, cacheOptions);
      if (!part1Props) part1Props = cache.get<any>(part1CacheKey);
      
      part2Props = await getNBACache<any>(part2CacheKey, cacheOptions);
      if (!part2Props) part2Props = cache.get<any>(part2CacheKey);
      
      part3Props = await getNBACache<any>(part3CacheKey, cacheOptions);
      if (!part3Props) part3Props = cache.get<any>(part3CacheKey);
    }
    
    // If any part cache exists, combine them (even if some are missing)
    if (part1Props || part2Props || part3Props) {
      const parts: any[] = [];
      if (part1Props && Array.isArray(part1Props)) parts.push(...part1Props);
      if (part2Props && Array.isArray(part2Props)) parts.push(...part2Props);
      if (part3Props && Array.isArray(part3Props)) parts.push(...part3Props);
      
      if (parts.length > 0) {
        // Deduplicate props (same player|stat|line)
        const propsMap = new Map<string, any>();
        for (const prop of parts) {
          if (!prop.playerName || !prop.statType || prop.line === undefined || prop.line === null) continue;
          const key = `${prop.playerName}|${prop.statType}|${Math.round(prop.line * 2) / 2}`;
          // Keep the first one we see (or could prioritize by some criteria)
          if (!propsMap.has(key)) {
            propsMap.set(key, prop);
          }
        }
        cachedProps = Array.from(propsMap.values());
        console.log(`[Player Props API] ✅ Combined split caches: part1=${part1Props?.length || 0}, part2=${part2Props?.length || 0}, part3=${part3Props?.length || 0}, total=${cachedProps.length}`);
      }
    } else {
      // No split caches found, try unified cache key (backward compatibility)
      if (forceRefresh) {
        cachedProps = await getNBACache<any>(allDatesCacheKey, cacheOptions);
      } else {
        cachedProps = await getNBACache<any>(allDatesCacheKey, cacheOptions);
        if (!cachedProps) {
          cachedProps = cache.get<any>(allDatesCacheKey);
        }
      }
      
      if (cachedProps && Array.isArray(cachedProps) && cachedProps.length > 0) {
        console.log(`[Player Props API] ✅ Using unified all-dates cache (${cachedProps.length} props from all games)`);
      } else {
        console.log(`[Player Props API] ⚠️ No cache found (checked split keys and unified key)`);
      }
    }
    
    if (cachedProps) {
      // Validate cached data structure
      const isValid = Array.isArray(cachedProps) && cachedProps.length > 0;
      if (!isValid) {
        console.warn(`[Player Props API] ⚠️ Cached data invalid (not array or empty), treating as cache miss`);
        // Delete invalid cache entry
        const cacheKeyToDelete = allDatesCacheKey;
        try {
          const { deleteNBACache } = await import('@/lib/nbaCache');
          await deleteNBACache(cacheKeyToDelete);
        } catch (e) {
          // Ignore deletion errors
        }
      } else {
        // Filter out props from games that are no longer in the current odds cache
        // This removes props from games that have started (odds removed after game starts)
        const currentGameCommenceTimes = new Set<string>();
        const currentGameDates = new Set<string>();
        
        if (oddsCache && oddsCache.games && Array.isArray(oddsCache.games)) {
          for (const game of oddsCache.games) {
            if (game.commenceTime) {
              const commenceStr = String(game.commenceTime).trim();
              currentGameCommenceTimes.add(commenceStr);
              
              // Also extract date part for matching
              const dateMatch = commenceStr.match(/^(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) {
                currentGameDates.add(dateMatch[1]);
              } else {
                // If it's a full timestamp, extract date from it
                try {
                  const date = new Date(commenceStr);
                  if (!isNaN(date.getTime())) {
                    const dateStr = getUSEasternDateStringLocal(date);
                    currentGameDates.add(dateStr);
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        }
        
        const beforeFilter = cachedProps.length;
        const filteredProps = cachedProps.filter((prop: any) => {
          // If prop has no gameDate, keep it (shouldn't happen, but be safe)
          if (!prop.gameDate) {
            return true;
          }
          
          const propGameDate = String(prop.gameDate);
          
          // Check if this prop's game is still in the current odds cache
          const isCurrentGame = currentGameCommenceTimes.has(propGameDate) || 
                               (propGameDate.match(/^(\d{4}-\d{2}-\d{2})/) && 
                                currentGameDates.has(propGameDate.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || ''));
          
          return isCurrentGame;
        });
        
        const removedCount = beforeFilter - filteredProps.length;
        if (removedCount > 0) {
          console.log(`[Player Props API] 🗑️ Removed ${removedCount} props from games no longer in odds cache (games started)`);
        }
        
        console.log(`[Player Props API] ✅ Cache HIT for game date: ${gameDate}, props count: ${filteredProps.length} (filtered from ${beforeFilter})`);
        return NextResponse.json({
          success: true,
          data: filteredProps,
          lastUpdated: oddsCache.lastUpdated,
          gameDate,
          cached: true,
          filtered: removedCount > 0 ? removedCount : undefined
        });
      }
    }
    
    // Cache miss - need to process data
    // This will be handled by the client-side processing for now
    // In the future, we can move the processing logic here
    console.log(`[Player Props API] Cache MISS for game date: ${gameDate}`);
    
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
    
    // Get cache key based on game date only (simplified)
    const cacheKey = getPlayerPropsCacheKey(finalGameDate);
    
    console.log(`[Player Props API] 🔑 POST: Cache key components:`, {
      gameDate: finalGameDate,
      cacheKey
    });
    
    // Cache for 24 hours (safety net - will naturally invalidate when odds refresh or date changes)
    // Store in both in-memory cache and shared cache (Supabase)
    cache.set(cacheKey, data, 24 * 60); // 24 hours in minutes
    
    // Also store in shared cache (Supabase)
    try {
      const cacheSuccess = await setNBACache(cacheKey, 'player-props', data, 24 * 60, false); // 24 hours in minutes, enable logging
      if (cacheSuccess) {
        console.log(`[Player Props API] ✅ Cached processed props in shared cache for game date: ${finalGameDate}, cache key: ${cacheKey}`);
      } else {
        console.warn(`[Player Props API] ⚠️ Failed to cache in shared cache (returned false) for game date: ${finalGameDate}`);
      }
    } catch (e) {
      console.error('[Player Props API] ❌ Exception caching in shared cache:', e);
    }
    
    console.log(`[Player Props API] 💾 Cached processed props (in-memory + Supabase) for game date: ${finalGameDate}, cache key: ${cacheKey}`);
    
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
