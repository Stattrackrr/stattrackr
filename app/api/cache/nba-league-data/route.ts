// app/api/cache/nba-league-data/route.ts
// Background job to fetch and cache all league-wide NBA API data
// This should be called by a cron job (e.g., Vercel Cron) every 24 hours

import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL } from '@/lib/cache';
import { setNBACache } from '@/lib/nbaCache';
import { currentNbaSeason } from '@/lib/nbaUtils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/stats/',
  'Origin': 'https://www.nba.com',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not=A?Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const PLAY_TYPES = [
  { key: 'PRBallHandler', displayName: 'PNR Ball Handler' },
  { key: 'Transition', displayName: 'Transition' },
  { key: 'Spotup', displayName: 'Spot Up' },
  { key: 'OffScreen', displayName: 'Off Screen' },
  { key: 'Isolation', displayName: 'Isolation' },
  { key: 'Postup', displayName: 'Post Up' },
  { key: 'Cut', displayName: 'Cut' },
  { key: 'Handoff', displayName: 'Handoff' },
  { key: 'Misc', displayName: 'Misc' },
  { key: 'PRRollman', displayName: 'PNR Roll Man' },
  { key: 'OffRebound', displayName: 'Putbacks' },
];

async function fetchNBAStats(url: string, timeout = 15000, retries = 1, retryOn500 = false) {
  const actualTimeout = Math.max(4000, Math.min(timeout, 30000));
  const actualRetries = retryOn500 ? Math.max(0, Math.min(retries, 2)) : Math.max(0, Math.min(retries, 1));
  const maxAttempts = actualRetries + 1;
  
  let lastError: Error | null = null;
  let lastStatusCode: number | null = null;
  
  for (let attempt = 0; attempt <= actualRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

  try {
    const response = await fetch(url, {
      headers: NBA_HEADERS,
      signal: controller.signal,
      cache: 'no-store'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      lastStatusCode = response.status;
      // Retry on 500 errors if retryOn500 is true
      if (response.status >= 500 && retryOn500 && attempt < actualRetries) {
        console.log(`[NBA League Data Cache] Server error ${response.status} on attempt ${attempt + 1}/${maxAttempts}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1))); // Longer delay for 500 errors
        continue;
      }
      throw new Error(`NBA API ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      lastError = new Error(`Request timeout after ${actualTimeout}ms (attempt ${attempt + 1}/${maxAttempts})`);
      if (attempt < actualRetries) {
        console.log(`[NBA League Data Cache] Timeout on attempt ${attempt + 1}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
    
    lastError = error;
    if (attempt < actualRetries) {
      console.log(`[NBA League Data Cache] Error on attempt ${attempt + 1}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    throw error;
    }
  }
  
  throw lastError || new Error('Unknown error');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    const forceRefresh = searchParams.get('force') === 'true';
    const retry = searchParams.get('retry') === 'true';
    
    // Allow all requests - this endpoint is only called by cron jobs or manually
    // Vercel Cron will call this automatically via the cron schedule
    // For security, you can add IP whitelisting or other checks in production if needed
    console.log(`[NBA League Data Cache] Request received from: ${request.headers.get('user-agent') || 'unknown'}`);

    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    console.log(`[NBA League Data Cache] Starting background job for season ${seasonStr}... (retry=${retry})`);

    const results: any = {
      season: seasonStr,
      timestamp: new Date().toISOString(),
      playTypeRankings: {},
      zoneRankings: {},
      playerPlayTypes: {},
      errors: [],
    };

    // 1. Fetch all play type defensive rankings
    // If retry mode, only fetch missing play types from cache
    const playTypeRankings: Record<string, Array<{ team: string; ppp: number }>> = {};
    let playTypesToFetch = PLAY_TYPES;
    
    if (retry) {
      // Retry mode: check cache and only fetch missing play types
      const playTypeCacheKey = `playtype_defensive_rankings_${seasonStr}`;
      // Check Supabase cache first (persistent, shared across instances)
      const { getNBACache } = await import('@/lib/nbaCache');
      let existingCache = await getNBACache<Record<string, Array<{ team: string; ppp: number }>>>(playTypeCacheKey);
      
      // Fallback to in-memory cache
      if (!existingCache) {
        existingCache = cache.get<Record<string, Array<{ team: string; ppp: number }>>>(playTypeCacheKey);
      }
      
      if (existingCache) {
        // Only fetch play types that are missing from cache
        playTypesToFetch = PLAY_TYPES.filter(({ key }) => !existingCache[key]);
        Object.assign(playTypeRankings, existingCache); // Start with existing cache
        console.log(`[NBA League Data Cache] Retry mode: Found ${Object.keys(existingCache).length} cached play types, fetching ${playTypesToFetch.length} missing ones`);
      } else {
        console.log(`[NBA League Data Cache] Retry mode: No cache found, fetching all play types`);
      }
    }
    
    console.log(`[NBA League Data Cache] Fetching ${playTypesToFetch.length} play type defensive rankings...`);
    
    for (let i = 0; i < playTypesToFetch.length; i++) {
      const { key } = playTypesToFetch[i];
      console.log(`[NBA League Data Cache] Fetching ${key} defensive rankings (${i + 1}/${PLAY_TYPES.length})...`);
      
      try {
        const params = new URLSearchParams({
          LeagueID: '00',
          PerMode: 'PerGame',
          PlayerOrTeam: 'T',
          SeasonType: 'Regular Season',
          SeasonYear: seasonStr,
          PlayType: key,
          TypeGrouping: 'defensive',
        });

        const url = `${NBA_STATS_BASE}/synergyplaytypes?${params.toString()}`;
        // Use longer timeout with retries for defensive rankings (NBA API can be slow)
        const data = await fetchNBAStats(url, 20000, 2, true); // 20s timeout, 2 retries, retry on 500 errors
        const resultSet = data?.resultSets?.[0];
        
        if (resultSet) {
          const headers = resultSet.headers || [];
          const rows = resultSet.rowSet || [];
          
          const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
          const pppIdx = headers.indexOf('PPP');
          
          if (teamAbbrIdx >= 0 && pppIdx >= 0) {
            const rankings: Array<{ team: string; ppp: number }> = [];
            
            rows.forEach((row: any[]) => {
              const team = row[teamAbbrIdx]?.toUpperCase() || '';
              const ppp = parseFloat(row[pppIdx]) || 0;
              if (team) {
                rankings.push({ team, ppp });
              }
            });
            
            // Sort by PPP (ascending - lower PPP = better defense = rank 1)
            rankings.sort((a, b) => a.ppp - b.ppp);
            playTypeRankings[key] = rankings;
            console.log(`[NBA League Data Cache] ✅ ${key}: ${rankings.length} teams`);
          }
        }
        
        // Delay between requests to avoid rate limiting
        // Reduced to 500ms in dev (was 2s) - NBA API is slow but we can reduce delays
        if (i < playTypesToFetch.length - 1) {
          const delay = process.env.NODE_ENV === 'production' ? 2000 : 500; // 500ms in dev, 2s in prod
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (err: any) {
        console.error(`[NBA League Data Cache] ❌ Error fetching ${key}:`, err.message);
        results.errors.push({ type: 'playType', playType: key, error: err.message });
      }
    }

    // Cache play type rankings (both Supabase and in-memory)
    const playTypeCacheKey = `playtype_defensive_rankings_${seasonStr}`;
    // Store in Supabase (persistent, shared across instances)
    await setNBACache(playTypeCacheKey, 'playtype_defensive_rankings', playTypeRankings, CACHE_TTL.TRACKING_STATS);
    // Also store in-memory for faster access
    cache.set(playTypeCacheKey, playTypeRankings, CACHE_TTL.TRACKING_STATS);
    results.playTypeRankings = playTypeRankings;
    console.log(`[NBA League Data Cache] ✅ Cached play type rankings for ${Object.keys(playTypeRankings).length} play types (Supabase + in-memory)`);

    // 2. Fetch zone defense rankings (for shot chart)
    // NOTE: leaguedashteamstats does NOT provide zone-level defense stats
    // Zone defense stats must be fetched per-team using shotchartdetail endpoint
    // This is handled by /api/team-defense-rankings which fetches all teams sequentially
    console.log(`[NBA League Data Cache] Checking zone defense rankings cache...`);
    const zoneCacheKey = `zone_defensive_rankings_${seasonStr}`;
    const { getNBACache } = await import('@/lib/nbaCache');
    
    // Check if we already have zone rankings cached
    const existingZoneCache = await getNBACache<Record<string, Array<{ team: string; fgPct: number }>>>(zoneCacheKey);
    
    // Filter out metadata to check for actual zone data
    let zoneRankings: Record<string, Array<{ team: string; fgPct: number }>> = {};
    if (existingZoneCache) {
      const { __cache_metadata, ...zoneDataOnly } = existingZoneCache as any;
      const actualZones = Object.keys(zoneDataOnly).filter(key => 
        Array.isArray(zoneDataOnly[key]) && zoneDataOnly[key].length > 0
      );
      
      if (actualZones.length > 0) {
        zoneRankings = zoneDataOnly;
        console.log(`[NBA League Data Cache] ✅ Zone rankings found in cache (${actualZones.length} zones: ${actualZones.join(', ')})`);
        results.zoneRankings = zoneRankings;
      } else {
        console.log(`[NBA League Data Cache] ⚠️ Zone rankings cache exists but is empty/corrupted`);
        // Delete corrupted cache
        const { deleteNBACache } = await import('@/lib/nbaCache');
        await deleteNBACache(zoneCacheKey);
        cache.delete(zoneCacheKey);
        results.zoneRankings = {};
      }
    } else {
      console.log(`[NBA League Data Cache] ⚠️ Zone rankings not cached yet`);
      console.log(`[NBA League Data Cache] 💡 Zone rankings will be populated by /api/team-defense-rankings on first request`);
      console.log(`[NBA League Data Cache] 💡 This endpoint fetches all 30 teams sequentially using shotchartdetail API`);
      results.zoneRankings = {};
    }

    // 3. Fetch all player play type stats (bulk fetch - one call per play type gets all players)
    console.log(`[NBA League Data Cache] Fetching player play type stats (bulk)...`);
    const playerPlayTypesData: Record<string, any> = {};
    
    for (let i = 0; i < PLAY_TYPES.length; i++) {
      const { key } = PLAY_TYPES[i];
      console.log(`[NBA League Data Cache] Fetching player ${key} stats (${i + 1}/${PLAY_TYPES.length})...`);
      
      try {
        const params = new URLSearchParams({
          LeagueID: '00',
          PerMode: 'PerGame',
          PlayerOrTeam: 'P', // Players
          SeasonType: 'Regular Season',
          SeasonYear: seasonStr,
          PlayType: key,
          TypeGrouping: 'offensive',
        });

        const url = `${NBA_STATS_BASE}/synergyplaytypes?${params.toString()}`;
        // Use longer timeout with retries for defensive rankings (NBA API can be slow)
        const data = await fetchNBAStats(url, 20000, 2, true); // 20s timeout, 2 retries, retry on 500 errors
        const resultSet = data?.resultSets?.[0];
        
        if (resultSet) {
          const headers = resultSet.headers || [];
          const rows = resultSet.rowSet || [];
          
          // Store all player data for this play type
          playerPlayTypesData[key] = {
            headers,
            rows,
            fetchedAt: new Date().toISOString()
          };
          
          console.log(`[NBA League Data Cache] ✅ ${key}: ${rows.length} players`);
        }
        
        // Delay between requests to avoid rate limiting
        if (i < PLAY_TYPES.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }
      } catch (err: any) {
        console.error(`[NBA League Data Cache] ❌ Error fetching player ${key}:`, err.message);
        results.errors.push({ type: 'playerPlayType', playType: key, error: err.message });
      }
    }

    // Cache player play type data (bulk - all players for all play types)
    const playerPlayTypesCacheKey = `player_playtypes_bulk_${seasonStr}`;
    // Store in Supabase (persistent, shared across instances)
    await setNBACache(playerPlayTypesCacheKey, 'play_type_bulk', playerPlayTypesData, CACHE_TTL.TRACKING_STATS);
    // Also store in-memory for faster access
    cache.set(playerPlayTypesCacheKey, playerPlayTypesData, CACHE_TTL.TRACKING_STATS);
    results.playerPlayTypes = { playTypesCached: Object.keys(playerPlayTypesData).length, totalPlayers: Object.values(playerPlayTypesData).reduce((sum: number, pt: any) => sum + (pt.rows?.length || 0), 0) };
    console.log(`[NBA League Data Cache] ✅ Cached player play type data for ${Object.keys(playerPlayTypesData).length} play types (Supabase + in-memory)`);

    console.log(`[NBA League Data Cache] ✅ Background job completed for season ${seasonStr}`);
    
    return NextResponse.json({
      success: true,
      ...results,
      summary: {
        playTypesCached: Object.keys(playTypeRankings).length,
        zonesCached: Object.keys(zoneRankings).length,
        playerPlayTypesCached: Object.keys(results.playerPlayTypes || {}).length > 0 ? results.playerPlayTypes.playTypesCached : 0,
        totalPlayersCached: Object.keys(results.playerPlayTypes || {}).length > 0 ? results.playerPlayTypes.totalPlayers : 0,
        errors: results.errors.length,
      }
    });

  } catch (error: any) {
    console.error('[NBA League Data Cache] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

