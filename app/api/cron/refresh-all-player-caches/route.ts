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

    console.log(`[Refresh All Player Caches] Processing ${players.length} players...`);
    
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
        
        if (result.playType) playTypeSuccess++;
        else playTypeFail++;
      }

      // Longer delay between batches to avoid rate limiting and timeouts
      if (i + batchSize < players.length) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay between batches
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[Refresh All Player Caches] ✅ Complete: ${shotChartSuccess} shot charts, ${playTypeSuccess} play types (${duration}s)`);

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

