import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY;

/**
 * Fetch all active players from BDL using pagination
 */
async function fetchAllActivePlayers(): Promise<Array<{ id: number; full: string }>> {
  const allPlayers: Array<{ id: number; full: string }> = [];
  let cursor: string | null = null;
  let hops = 0;
  const maxHops = 100; // Safety limit

  while (hops < maxHops) {
    const url = new URL(`${BDL_BASE}/players/active`);
    url.searchParams.set('per_page', '100');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const headers: Record<string, string> = {};
    if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

    const response = await fetch(url.toString(), {
      headers,
      cache: 'no-store'
    });

    if (!response.ok) {
      console.error(`[Prefetch Advanced Stats] Failed to fetch players hop ${hops + 1}: ${response.status}`);
      break;
    }

    const data = await response.json();
    const players = data.data || [];
    
    allPlayers.push(...players.map((p: any) => ({
      id: p.id,
      full: p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : p.full_name || ''
    })));

    console.log(`[Prefetch Advanced Stats] Fetched hop ${hops + 1}: ${players.length} players (total: ${allPlayers.length})`);

    const nextCursor = data.meta?.next_cursor ?? null;
    if (!nextCursor) break;

    cursor = String(nextCursor);
    hops++;
  }

  return allPlayers;
}

/**
 * Pre-fetch advanced stats for a single player with retry logic
 * This will populate the cache via the /api/advanced-stats route
 */
async function prefetchPlayerAdvancedStats(
  playerId: number, 
  season: string, 
  host: string, 
  protocol: string,
  retries: number = 3
): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Call our internal API route which will cache the result
      const url = `${protocol}://${host}/api/advanced-stats?player_ids=${playerId}&season=${season}`;
      
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          // Add auth header if available
          ...(process.env.CRON_SECRET ? { 'Authorization': `Bearer ${process.env.CRON_SECRET}` } : {}),
        },
      });

      if (response.status === 429) {
        // Rate limited - wait with exponential backoff
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds
        if (attempt < retries - 1) {
          console.log(`[Prefetch Advanced Stats] Rate limited for player ${playerId}, waiting ${waitTime}ms before retry ${attempt + 2}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }

      if (!response.ok) {
        if (attempt === retries - 1) {
          console.error(`[Prefetch Advanced Stats] Failed for player ${playerId}: ${response.status} (after ${retries} attempts)`);
        }
        return false;
      }

      return true;
    } catch (error: any) {
      if (attempt === retries - 1) {
        console.error(`[Prefetch Advanced Stats] Error prefetching player ${playerId}:`, error.message);
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
 * Pre-fetch advanced stats for all active players
 * This endpoint can be called via cron job or manually
 * 
 * Query params:
 * - season: Season year (defaults to current season)
 * - batch_size: Number of players to process in parallel (default: 3)
 * - delay_ms: Delay between batches in milliseconds (default: 3000)
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
    const batchSize = parseInt(searchParams.get('batch_size') || '3', 10); // Reduced from 10 to 3
    const delayMs = parseInt(searchParams.get('delay_ms') || '3000', 10); // Increased from 1000 to 3000
    
    // Get current season if not provided
    const { currentNbaSeason } = await import('@/lib/nbaConstants');
    const season = seasonParam || String(currentNbaSeason());
    
    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';

    console.log(`[Prefetch Advanced Stats] Starting pre-fetch for season ${season}...`);
    console.log(`[Prefetch Advanced Stats] Batch size: ${batchSize}, Delay: ${delayMs}ms`);

    // Fetch all active players
    const players = await fetchAllActivePlayers();
    console.log(`[Prefetch Advanced Stats] Found ${players.length} active players`);

    if (players.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No players found',
      }, { status: 400 });
    }

    // Process players in batches
    let successCount = 0;
    let failCount = 0;
    let rateLimitCount = 0;
    const totalBatches = Math.ceil(players.length / batchSize);
    let currentBatchSize = batchSize;
    let currentDelay = delayMs;

    for (let i = 0; i < players.length; i += currentBatchSize) {
      const batch = players.slice(i, i + currentBatchSize);
      const batchNum = Math.floor(i / currentBatchSize) + 1;

      console.log(`[Prefetch Advanced Stats] Processing batch ${batchNum}/${totalBatches} (${batch.length} players)...`);

      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(player => prefetchPlayerAdvancedStats(player.id, season, host, protocol))
      );

      // Count successes, failures, and rate limits
      let batchRateLimits = 0;
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value) {
          successCount++;
        } else {
          failCount++;
          const player = batch[idx];
          // Check if it was a rate limit (429) by checking the error
          // Since we retry internally, we'll track based on final failure
          // For now, we'll use a heuristic: if many fail in a batch, likely rate limited
        }
      });

      // Adaptive rate limiting: if we see many failures, slow down
      const failureRate = failCount / (successCount + failCount);
      if (failureRate > 0.5 && i > 0) {
        // More than 50% failures - likely rate limited
        currentBatchSize = Math.max(1, Math.floor(currentBatchSize * 0.7)); // Reduce batch size
        currentDelay = Math.min(currentDelay * 1.5, 10000); // Increase delay (max 10s)
        console.log(`[Prefetch Advanced Stats] Detected rate limiting. Reducing batch size to ${currentBatchSize}, increasing delay to ${currentDelay}ms`);
      } else if (failureRate < 0.1 && currentBatchSize < batchSize) {
        // Less than 10% failures - can speed up slightly
        currentBatchSize = Math.min(batchSize, Math.floor(currentBatchSize * 1.1));
        currentDelay = Math.max(delayMs, Math.floor(currentDelay * 0.9));
      }

      // Delay between batches to avoid rate limiting
      if (i + currentBatchSize < players.length) {
        await new Promise(resolve => setTimeout(resolve, currentDelay));
      }
    }

    console.log(`[Prefetch Advanced Stats] Complete! Success: ${successCount}, Failed: ${failCount}`);

    return NextResponse.json({
      success: true,
      message: `Pre-fetched advanced stats for ${successCount}/${players.length} players`,
      stats: {
        total: players.length,
        success: successCount,
        failed: failCount,
        season,
      },
    }, { status: 200 });

  } catch (error: any) {
    console.error('[Prefetch Advanced Stats] Error:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || 'Pre-fetch failed',
    }, { status: 500 });
  }
}

