import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY;

/**
 * Get today's games in US Eastern Time (NBA games are scheduled in ET)
 */
async function getTodaysGames(): Promise<Array<{ id: number; date: string }>> {
  try {
    // Get today's date in US Eastern Time
    const now = new Date();
    const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = `${easternTime.getFullYear()}-${String(easternTime.getMonth() + 1).padStart(2, '0')}-${String(easternTime.getDate()).padStart(2, '0')}`;

    const url = `${BDL_BASE}/games?dates[]=${todayStr}&per_page=100`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

    const response = await fetch(url, {
      headers,
      cache: 'no-store'
    });

    if (!response.ok) {
      console.error(`[Daily Advanced Stats] Failed to fetch games: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const games = Array.isArray(data?.data) ? data.data : [];

    return games.map((game: any) => ({
      id: game.id,
      date: game.date || todayStr,
    }));
  } catch (error: any) {
    console.error('[Daily Advanced Stats] Error fetching games:', error.message);
    return [];
  }
}

/**
 * Pre-fetch advanced stats for specific games
 * This will populate the cache via the /api/advanced-stats route
 */
async function prefetchGameAdvancedStats(
  gameIds: number[],
  season: string,
  host: string,
  protocol: string,
  retries: number = 3
): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Call our internal API route which will cache the result
      // Use game_ids instead of player_ids for more efficient per-game caching
      const gameIdsParam = gameIds.join(',');
      const url = `${protocol}://${host}/api/advanced-stats?game_ids=${gameIdsParam}&season=${season}`;
      
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.CRON_SECRET ? { 'Authorization': `Bearer ${process.env.CRON_SECRET}` } : {}),
        },
      });

      if (response.status === 429) {
        // Rate limited - wait with exponential backoff
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds
        if (attempt < retries - 1) {
          console.log(`[Daily Advanced Stats] Rate limited, waiting ${waitTime}ms before retry ${attempt + 2}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }

      if (!response.ok) {
        if (attempt === retries - 1) {
          console.error(`[Daily Advanced Stats] Failed for games ${gameIdsParam}: ${response.status} (after ${retries} attempts)`);
        }
        return false;
      }

      return true;
    } catch (error: any) {
      if (attempt === retries - 1) {
        console.error(`[Daily Advanced Stats] Error prefetching games:`, error.message);
      }
      // Wait before retry on error
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  return false;
}

/**
 * Daily cron endpoint to pre-fetch advanced stats for today's games
 * This should run once per day (e.g., at 2 AM ET) to cache new games
 * 
 * Query params:
 * - season: Season year (defaults to current season)
 * - batch_size: Number of games to process in parallel (default: 5)
 * - delay_ms: Delay between batches in milliseconds (default: 2000)
 */
export async function GET(req: NextRequest) {
  // Check authentication for cron jobs
  const authResult = authorizeCronRequest(req);
  if (!authResult.authorized) {
    return authResult.response;
  }

  try {
    const { searchParams } = new URL(req.url);
    const seasonParam = searchParams.get('season');
    const batchSize = parseInt(searchParams.get('batch_size') || '5', 10);
    const delayMs = parseInt(searchParams.get('delay_ms') || '2000', 10);
    
    // Get current season if not provided
    const { currentNbaSeason } = await import('@/lib/nbaConstants');
    const season = seasonParam || String(currentNbaSeason());
    
    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';

    console.log(`[Daily Advanced Stats] Starting daily pre-fetch for season ${season}...`);

    // Fetch today's games
    const games = await getTodaysGames();
    console.log(`[Daily Advanced Stats] Found ${games.length} games today`);

    if (games.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No games today',
        stats: {
          total: 0,
          success: 0,
          failed: 0,
          season,
        },
      }, { status: 200 });
    }

    const gameIds = games.map(g => g.id);

    // Process games in batches
    let successCount = 0;
    let failCount = 0;
    const totalBatches = Math.ceil(gameIds.length / batchSize);

    for (let i = 0; i < gameIds.length; i += batchSize) {
      const batch = gameIds.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      console.log(`[Daily Advanced Stats] Processing batch ${batchNum}/${totalBatches} (${batch.length} games)...`);

      // Process batch
      const success = await prefetchGameAdvancedStats(batch, season, host, protocol);

      if (success) {
        successCount += batch.length;
      } else {
        failCount += batch.length;
      }

      // Delay between batches to avoid rate limiting
      if (i + batchSize < gameIds.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log(`[Daily Advanced Stats] Complete! Success: ${successCount}, Failed: ${failCount}`);

    return NextResponse.json({
      success: true,
      message: `Pre-fetched advanced stats for ${successCount}/${gameIds.length} games`,
      stats: {
        total: gameIds.length,
        success: successCount,
        failed: failCount,
        season,
      },
    }, { status: 200 });

  } catch (error: any) {
    console.error('[Daily Advanced Stats] Error:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || 'Daily pre-fetch failed',
    }, { status: 500 });
  }
}











