export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import cache from '@/lib/cache';
import type { OddsCache } from '@/app/api/odds/refresh/route';

// Cache key for odds (matches the one in app/api/odds/route.ts)
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

// Cache key prefix for player props
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props-processed-v2';

/**
 * Get the earliest game date from odds cache in US Eastern Time
 * NBA games are scheduled in US Eastern Time, so we need to convert dates accordingly
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
  
  if (!oddsCache.games || oddsCache.games.length === 0) {
    // Fallback to today's date in US ET if no games
    return getUSEasternDateString(new Date());
  }
  
  // Get today's date in US Eastern Time
  const todayUSET = getUSEasternDateString(new Date());
  
  // Extract all unique dates from games
  const gameDates = new Set<string>();
  
  for (const game of oddsCache.games) {
    if (!game.commenceTime) continue;
    
    try {
      const commenceStr = String(game.commenceTime).trim();
      
      if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
        // Date-only string from BDL API - use it directly, no conversion needed
        gameDates.add(commenceStr);
      } else {
        // Has time component, parse and convert to US ET
        const date = new Date(commenceStr);
        const gameDateUSET = getUSEasternDateString(date);
        gameDates.add(gameDateUSET);
      }
    } catch {
      continue;
    }
  }
  
  if (gameDates.size === 0) {
    return todayUSET;
  }
  
  // PRIORITIZE TODAY: If today's date is in the game dates, use it
  // Otherwise, use the earliest date (tomorrow)
  if (gameDates.has(todayUSET)) {
    return todayUSET;
  }
  
  // No games for today, use the earliest date (should be tomorrow)
  const sortedDates = Array.from(gameDates).sort();
  return sortedDates[0];
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
 */
function getPlayerPropsCacheKey(gameDate: string, oddsLastUpdated: string, vendorCount: number): string {
  return `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}-${oddsLastUpdated}-v${vendorCount}`;
}

/**
 * Background update endpoint for player props
 * This processes player props in the background when odds change
 * Users continue seeing cached data while this runs
 * 
 * Called by cron job or when odds refresh detects changes
 */
export async function POST(request: NextRequest) {
  try {
    // Get current odds cache
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
      quiet: true,
    });
    
    if (!oddsCache) {
      const { cache: inMemoryCache } = await import('@/lib/cache');
      oddsCache = inMemoryCache.get(ODDS_CACHE_KEY);
    }
    
    if (!oddsCache || !oddsCache.lastUpdated) {
      return NextResponse.json({
        success: false,
        error: 'No odds data available',
        message: 'Cannot update player props without odds data'
      }, { status: 503 });
    }
    
    // Calculate cache key for current odds
    const gameDate = getGameDateFromOddsCache(oddsCache);
    const playerPropVendors = getPlayerPropVendors(oddsCache);
    const vendorCount = playerPropVendors.length;
    const cacheKey = getPlayerPropsCacheKey(gameDate, oddsCache.lastUpdated, vendorCount);
    
    // Check if we already have cached props for this odds version
    let existingCache = await getNBACache<any>(cacheKey, {
      restTimeoutMs: 5000,
      jsTimeoutMs: 5000,
      quiet: true,
    });
    
    if (!existingCache) {
      existingCache = cache.get<any>(cacheKey);
    }
    
    // If cache already exists and is valid, no update needed
    if (existingCache && Array.isArray(existingCache) && existingCache.length > 0) {
      console.log(`[Background Update] ✅ Cache already exists for ${cacheKey} (${existingCache.length} props) - no update needed`);
      return NextResponse.json({
        success: true,
        message: 'Cache already up to date',
        cached: true,
        propsCount: existingCache.length
      });
    }
    
    // Cache doesn't exist or is invalid - needs processing
    // Note: Processing happens client-side when users visit the page
    // This endpoint just checks if update is needed - actual processing is triggered by user visits
    // Users will see old cached data (if any) until new cache is ready
    console.log(`[Background Update] ⚠️ Cache missing for ${cacheKey} - will be populated when first user visits`);
    
    return NextResponse.json({
      success: true,
      needsUpdate: true,
      message: 'Cache needs updating - will be populated on next user visit',
      cacheKey,
      gameDate,
      vendorCount,
      lastUpdated: oddsCache.lastUpdated
    });
    
  } catch (error) {
    console.error('[Background Update] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * GET endpoint to check if background update is needed
 */
export async function GET(request: NextRequest) {
  try {
    // Get current odds cache
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
      quiet: true,
    });
    
    if (!oddsCache) {
      const { cache: inMemoryCache } = await import('@/lib/cache');
      oddsCache = inMemoryCache.get(ODDS_CACHE_KEY);
    }
    
    if (!oddsCache || !oddsCache.lastUpdated) {
      return NextResponse.json({
        success: false,
        needsUpdate: true,
        reason: 'No odds data available'
      }, { status: 503 });
    }
    
    // Calculate cache key
    const gameDate = getGameDateFromOddsCache(oddsCache);
    const playerPropVendors = getPlayerPropVendors(oddsCache);
    const vendorCount = playerPropVendors.length;
    const cacheKey = getPlayerPropsCacheKey(gameDate, oddsCache.lastUpdated, vendorCount);
    
    // Check if cache exists
    let cachedProps = await getNBACache<any>(cacheKey, {
      restTimeoutMs: 5000,
      jsTimeoutMs: 5000,
      quiet: true,
    });
    
    if (!cachedProps) {
      cachedProps = cache.get<any>(cacheKey);
    }
    
    const needsUpdate = !cachedProps || !Array.isArray(cachedProps) || cachedProps.length === 0;
    
    return NextResponse.json({
      success: true,
      needsUpdate,
      cacheKey,
      gameDate,
      vendorCount,
      lastUpdated: oddsCache.lastUpdated,
      cachedPropsCount: Array.isArray(cachedProps) ? cachedProps.length : 0
    });
    
  } catch (error) {
    console.error('[Background Update Check] Error:', error);
    return NextResponse.json({
      success: false,
      needsUpdate: true,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
