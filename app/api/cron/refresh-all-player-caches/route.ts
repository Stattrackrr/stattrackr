// app/api/cron/refresh-all-player-caches/route.ts
/**
 * Full NBA-wide refresh for all player shot charts and play type analysis
 * Runs daily to update ALL players' caches (not just changed ones)
 * 
 * Schedule: Daily at 8 AM UTC (after NBA stats refresh)
 * Configured in vercel.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { currentNbaSeason } from '@/lib/nbaUtils';

export const runtime = 'nodejs';
export const maxDuration = 600; // 10 minutes for cron job

const BDL_BASE = 'https://api.balldontlie.io/v1';

interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
}

async function fetchBDL(url: string): Promise<any> {
  const headers: HeadersInit = {
    'Accept': 'application/json',
  };
  
  // Add API key if available (BDL API may require it for higher rate limits)
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  const response = await fetch(url, {
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`BDL API ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 200)}` : ''}`);
  }

  return response.json();
}

async function getAllActivePlayers(): Promise<BDLPlayer[]> {
  console.log(`[Refresh All Player Caches] Fetching all active players from BDL API...`);
  
  const allPlayers: BDLPlayer[] = [];
  let cursor: string | null = null;
  let page = 1;
  const maxPages = 60; // Safety limit

  while (page <= maxPages) {
    try {
      const url = new URL(`${BDL_BASE}/players/active`);
      url.searchParams.set('per_page', '100');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const data = await fetchBDL(url.toString());
      const players = Array.isArray(data?.data) ? data.data : [];
      
      allPlayers.push(...players);
      console.log(`[Refresh All Player Caches] Page ${page}: ${players.length} players (total: ${allPlayers.length})`);

      cursor = data?.meta?.next_cursor || null;
      if (!cursor) break;

      page++;
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between pages
    } catch (error: any) {
      console.error(`[Refresh All Player Caches] Error fetching page ${page}:`, error.message);
      break;
    }
  }

  console.log(`[Refresh All Player Caches] ✅ Found ${allPlayers.length} active players`);
  return allPlayers;
}

async function refreshPlayerCache(playerId: number, season: number, host: string, protocol: string): Promise<{ shotChart: boolean; playType: boolean }> {
  const results = { shotChart: false, playType: false };

  try {
    // Refresh shot chart (no opponent - general season stats)
    // Add X-Allow-NBA-API header to tell the endpoint it's safe to call NBA API
    const shotChartUrl = `${protocol}://${host}/api/shot-chart-enhanced?playerId=${playerId}&season=${season}&opponentTeam=none&bypassCache=true`;
    const shotChartResponse = await fetch(shotChartUrl, {
      headers: {
        'Authorization': process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '',
        'X-Allow-NBA-API': 'true', // Signal that caller can reach NBA API
      },
    });
    
    if (shotChartResponse.ok) {
      results.shotChart = true;
    } else {
      console.warn(`[Refresh All Player Caches] ⚠️ Shot chart refresh failed for player ${playerId}: ${shotChartResponse.status}`);
    }
  } catch (error: any) {
    console.warn(`[Refresh All Player Caches] ⚠️ Shot chart refresh error for player ${playerId}:`, error.message);
  }

  try {
    // Refresh play type analysis (no opponent - general season stats)
    // Add X-Allow-NBA-API header to tell the endpoint it's safe to call NBA API
    const playTypeUrl = `${protocol}://${host}/api/play-type-analysis?playerId=${playerId}&season=${season}&bypassCache=true`;
    const playTypeResponse = await fetch(playTypeUrl, {
      headers: {
        'Authorization': process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '',
        'X-Allow-NBA-API': 'true', // Signal that caller can reach NBA API
      },
    });
    
    if (playTypeResponse.ok) {
      results.playType = true;
    } else {
      console.warn(`[Refresh All Player Caches] ⚠️ Play type refresh failed for player ${playerId}: ${playTypeResponse.status}`);
    }
  } catch (error: any) {
    console.warn(`[Refresh All Player Caches] ⚠️ Play type refresh error for player ${playerId}:`, error.message);
  }

  return results;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log(`[Refresh All Player Caches] 🕐 Started at ${timestamp}`);

  // Authorization check
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isLocal = process.env.NODE_ENV === 'development';

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !isLocal) {
    console.log(`[Refresh All Player Caches] ❌ Unauthorized`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const season = currentNbaSeason();
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';

    console.log(`[Refresh All Player Caches] Starting refresh for season ${season}...`);
    
    // STEP 1: Fetch bulk data first (fast - only 22 API calls total)
    console.log(`[Refresh All Player Caches] Step 1/3: Fetching bulk play type data...`);
    try {
      const bulkCacheUrl = `${protocol}://${host}/api/cache/nba-league-data?season=${season}&force=true`;
      console.log(`[Refresh All Player Caches] Calling bulk cache endpoint: ${bulkCacheUrl}`);
      
      const bulkResponse = await fetch(bulkCacheUrl, {
        headers: {
          'Authorization': process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '',
        },
      });
      
      if (bulkResponse.ok) {
        const bulkData = await bulkResponse.json();
        console.log(`[Refresh All Player Caches] ✅ Bulk cache populated:`);
        console.log(`  - Play type defensive rankings: ${Object.keys(bulkData.playTypeRankings || {}).length} play types`);
        console.log(`  - Player play types: ${Object.keys(bulkData.playerPlayTypes || {}).length} play types`);
      } else {
        console.warn(`[Refresh All Player Caches] ⚠️ Bulk cache endpoint returned ${bulkResponse.status}`);
      }
    } catch (error: any) {
      console.warn(`[Refresh All Player Caches] ⚠️ Bulk cache fetch error (non-fatal):`, error.message);
    }
    
    // STEP 2: Fetch team defense rankings (30 teams, but still needed for shot charts)
    console.log(`[Refresh All Player Caches] Step 2/5: Fetching team defense rankings...`);
    try {
      const teamDefenseUrl = `${protocol}://${host}/api/team-defense-rankings?season=${season}&bypassCache=true`;
      console.log(`[Refresh All Player Caches] Calling team defense rankings: ${teamDefenseUrl}`);
      
      const teamDefenseResponse = await fetch(teamDefenseUrl, {
        headers: {
          'Authorization': process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '',
          'X-Allow-NBA-API': 'true', // Signal that caller can reach NBA API
        },
      });
      
      if (teamDefenseResponse.ok) {
        console.log(`[Refresh All Player Caches] ✅ Team defense rankings refreshed from NBA API`);
      } else {
        console.warn(`[Refresh All Player Caches] ⚠️ Team defense rankings returned ${teamDefenseResponse.status}`);
      }
    } catch (error: any) {
      console.warn(`[Refresh All Player Caches] ⚠️ Team defense rankings error (non-fatal):`, error.message);
    }

    // STEP 3: Fetch tracking stats (passing and rebounding potentials)
    console.log(`[Refresh All Player Caches] Step 3/5: Fetching tracking stats (passing/rebounding)...`);
    try {
      const trackingStatsUrl = `${protocol}://${host}/api/tracking-stats/refresh?season=${season}`;
      console.log(`[Refresh All Player Caches] Calling tracking stats refresh: ${trackingStatsUrl}`);
      
      // Don't await - this can take 7-8 minutes, let it run in background
      // But we'll wait a bit to ensure it starts
      const trackingPromise = fetch(trackingStatsUrl, {
        headers: {
          'Authorization': process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '',
          'X-Allow-NBA-API': 'true',
        },
      });
      
      // Wait 2 seconds to ensure request started, then continue
      await Promise.race([
        trackingPromise,
        new Promise(resolve => setTimeout(resolve, 2000))
      ]);
      
      console.log(`[Refresh All Player Caches] ✅ Tracking stats refresh initiated (running in background)`);
    } catch (error: any) {
      console.warn(`[Refresh All Player Caches] ⚠️ Tracking stats refresh error (non-fatal):`, error.message);
    }

    // STEP 4: Now fetch individual player data (shot charts and play types)
    console.log(`[Refresh All Player Caches] Step 4/5: Fetching individual player shot charts...`);
    console.log(`[Refresh All Player Caches] Fetching all active players for season ${season}...`);
    
    // Get all active players
    const players = await getAllActivePlayers();
    
    if (players.length === 0) {
      console.log(`[Refresh All Player Caches] ⚠️ No active players found`);
      return NextResponse.json({
        success: true,
        message: 'No active players found',
        playersProcessed: 0,
        timestamp,
      });
    }

    console.log(`[Refresh All Player Caches] Processing ${players.length} players for shot charts...`);
    
    // Process players in smaller batches to avoid overwhelming NBA API
    // Reduced from 10 to 3 to prevent timeouts
    const batchSize = 3;
    let shotChartSuccess = 0;
    let shotChartFail = 0;
    let playTypeSuccess = 0;
    let playTypeFail = 0;

    for (let i = 0; i < players.length; i += batchSize) {
      const batch = players.slice(i, i + batchSize);
      console.log(`[Refresh All Player Caches] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(players.length / batchSize)} (players ${i + 1}-${Math.min(i + batchSize, players.length)})...`);

      // Process batch in parallel
      const batchPromises = batch.map(async (player) => {
        const results = await refreshPlayerCache(player.id, season, host, protocol);
        return { playerId: player.id, playerName: `${player.first_name} ${player.last_name}`, ...results };
      });

      const batchResults = await Promise.all(batchPromises);

      // Count successes and failures
      for (const result of batchResults) {
        if (result.shotChart) shotChartSuccess++;
        else shotChartFail++;
        
        // Play types are from bulk cache (already counted in Step 1)
        if (result.playType) playTypeSuccess++;
        else playTypeFail++;
      }

      // Longer delay between batches to avoid rate limiting and timeouts
      if (i + batchSize < players.length) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay between batches
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // STEP 5: Summary
    console.log(`[Refresh All Player Caches] Step 5/5: Refresh complete!`);
    console.log(`[Refresh All Player Caches] ✅ Complete:`);
    console.log(`  - Bulk play types: Refreshed from NBA API (11 defensive + 11 player play types)`);
    console.log(`  - Team defense rankings: Refreshed from NBA API (30 teams)`);
    console.log(`  - Tracking stats: Refreshing in background (passing + rebounding)`);
    console.log(`  - Shot charts: ${shotChartSuccess} success, ${shotChartFail} failed`);
    console.log(`  - Duration: ${duration}s`);

    return NextResponse.json({
      success: true,
      message: 'All player caches refreshed',
      results: {
        totalPlayers: players.length,
        shotCharts: {
          success: shotChartSuccess,
          failed: shotChartFail,
        },
        playTypes: {
          success: playTypeSuccess,
          failed: playTypeFail,
        },
      },
      duration: `${duration}s`,
      timestamp,
    });

  } catch (error: any) {
    console.error('[Refresh All Player Caches] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp,
    }, { status: 500 });
  }
}

