// app/api/cache/nba-league-data/route.ts
// Background job to fetch and cache all league-wide NBA API data
// This should be called by a cron job (e.g., Vercel Cron) every 24 hours

import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL } from '@/lib/cache';

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

async function fetchNBAStats(url: string, timeout = 15000, retries = 1) {
  // Timeout: 15s in dev (NBA API is slow), 8s in production
  // 1 retry in dev to handle occasional timeouts
  const isProduction = process.env.NODE_ENV === 'production';
  const actualTimeout = isProduction ? Math.min(timeout, 8000) : Math.min(timeout, 15000);
  const actualRetries = isProduction ? 0 : Math.min(retries, 1);
  
  let lastError: Error | null = null;
  
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
      throw new Error(`NBA API ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      lastError = new Error(`Request timeout after ${actualTimeout}ms`);
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
    const season = parseInt(searchParams.get('season') || '2025');
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
      const existingCache = cache.get<Record<string, Array<{ team: string; ppp: number }>>>(playTypeCacheKey);
      
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
        const data = await fetchNBAStats(url, 5000); // 5s timeout - fail fast
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

    // Cache play type rankings
    const playTypeCacheKey = `playtype_defensive_rankings_${seasonStr}`;
    cache.set(playTypeCacheKey, playTypeRankings, CACHE_TTL.TRACKING_STATS); // 24 hours
    results.playTypeRankings = playTypeRankings;
    console.log(`[NBA League Data Cache] ✅ Cached play type rankings for ${Object.keys(playTypeRankings).length} play types`);

    // 2. Fetch zone defense rankings (for shot chart)
    console.log(`[NBA League Data Cache] Fetching zone defense rankings...`);
    const zoneRankings: Record<string, Array<{ team: string; fgPct: number }>> = {};
    
    const zones = ['Restricted Area', 'Paint (Non-RA)', 'Mid-Range', 'Left Corner 3', 'Right Corner 3', 'Above the Break 3'];
    
    try {
      // Use leaguedashteamstats to get zone defense stats
      const params = new URLSearchParams({
        LeagueID: '00',
        PerMode: 'PerGame',
        MeasureType: 'Opponent',
        SeasonType: 'Regular Season',
        Season: seasonStr,
      });

      const url = `${NBA_STATS_BASE}/leaguedashteamstats?${params.toString()}`;
      const data = await fetchNBAStats(url, 30000);
      const resultSet = data?.resultSets?.[0];
      
      if (resultSet) {
        const headers = resultSet.headers || [];
        const rows = resultSet.rowSet || [];
        
        // Find column indices for zone stats
        const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
        const raFgPctIdx = headers.indexOf('OPP_RESTRICTED_AREA_FG_PCT');
        const paintFgPctIdx = headers.indexOf('OPP_PAINT_NON_RA_FG_PCT');
        const midRangeFgPctIdx = headers.indexOf('OPP_MID_RANGE_FG_PCT');
        const corner3FgPctIdx = headers.indexOf('OPP_CORNER_3_FG_PCT');
        const aboveBreak3FgPctIdx = headers.indexOf('OPP_ABOVE_THE_BREAK_3_FG_PCT');
        
        if (teamAbbrIdx >= 0) {
          const zoneMappings = [
            { key: 'Restricted Area', idx: raFgPctIdx },
            { key: 'Paint (Non-RA)', idx: paintFgPctIdx },
            { key: 'Mid-Range', idx: midRangeFgPctIdx },
            { key: 'Left Corner 3', idx: corner3FgPctIdx },
            { key: 'Right Corner 3', idx: corner3FgPctIdx }, // Same column for both corners
            { key: 'Above the Break 3', idx: aboveBreak3FgPctIdx },
          ];
          
          zoneMappings.forEach(({ key, idx }) => {
            if (idx >= 0) {
              const rankings: Array<{ team: string; fgPct: number }> = [];
              
              rows.forEach((row: any[]) => {
                const team = row[teamAbbrIdx]?.toUpperCase() || '';
                const fgPct = parseFloat(row[idx]) || 0;
                if (team) {
                  rankings.push({ team, fgPct });
                }
              });
              
              // Sort by FG% (ascending - lower FG% = better defense = rank 1)
              rankings.sort((a, b) => a.fgPct - b.fgPct);
              zoneRankings[key] = rankings;
            }
          });
          
          console.log(`[NBA League Data Cache] ✅ Zone rankings: ${Object.keys(zoneRankings).length} zones`);
        }
      }
    } catch (err: any) {
      console.error(`[NBA League Data Cache] ❌ Error fetching zone rankings:`, err.message);
      results.errors.push({ type: 'zone', error: err.message });
    }

    // Cache zone rankings
    const zoneCacheKey = `zone_defensive_rankings_${seasonStr}`;
    cache.set(zoneCacheKey, zoneRankings, CACHE_TTL.TRACKING_STATS); // 24 hours
    results.zoneRankings = zoneRankings;
    console.log(`[NBA League Data Cache] ✅ Cached zone rankings`);

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
        const data = await fetchNBAStats(url, 5000); // 5s timeout - fail fast
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
    cache.set(playerPlayTypesCacheKey, playerPlayTypesData, CACHE_TTL.TRACKING_STATS); // 24 hours
    results.playerPlayTypes = { playTypesCached: Object.keys(playerPlayTypesData).length, totalPlayers: Object.values(playerPlayTypesData).reduce((sum: number, pt: any) => sum + (pt.rows?.length || 0), 0) };
    console.log(`[NBA League Data Cache] ✅ Cached player play type data for ${Object.keys(playerPlayTypesData).length} play types`);

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

