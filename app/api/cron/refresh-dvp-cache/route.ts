/**
 * Cron job to refresh DVP cache for all teams and positions
 * Fetches BettingPros data for all combinations to warm up the cache
 * 
 * This runs daily at 6pm Sydney time (8am UTC) to ensure fresh DVP data
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchBettingProsData } from "@/lib/bettingpros-dvp";
import { NBA_TEAMS } from "@/lib/nbaAbbr";
import cache from "@/lib/cache";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// All positions we need to cache
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C', 'ALL'] as const;
// All metrics we need to cache
const METRICS = ['pts', 'reb', 'ast', 'fg3m', 'fg_pct', 'stl', 'blk', 'to'] as const;

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret if provided (skip in development for local testing)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (cronSecret && !isDevelopment && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[DVP Cache Refresh] Starting refresh for all teams and positions...');
    const startTime = Date.now();

    // Force refresh BettingPros data (this will cache it for 1 hour)
    const bpData = await fetchBettingProsData(true);
    
    if (!bpData || !bpData.teamStats) {
      throw new Error('Failed to fetch BettingPros data');
    }

    const teams = Object.keys(NBA_TEAMS);
    let errors = 0;

    // Get the origin for internal API calls
    const origin = request.headers.get('host') 
      ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('host')}`
      : 'http://localhost:3000';

    // Fetch all teams' DVP data in parallel (batched by team)
    // This will warm up the cache for all positions and metrics for each team
    const teamPromises = teams.map(async (team) => {
      try {
        const metricsStr = METRICS.join(',');
        // Call the batch API which will cache all positions for this team
        const response = await fetch(
          `${origin}/api/dvp/batch?team=${team}&metrics=${metricsStr}&games=82&refresh=1`,
          {
            headers: {
              'Authorization': cronSecret ? `Bearer ${cronSecret}` : '',
            },
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.error) {
          throw new Error(data.error);
        }

        return { team, success: true };
      } catch (error: any) {
        console.error(`[DVP Cache Refresh] Error fetching ${team}:`, error);
        errors++;
        return { team, success: false, error: error.message };
      }
    });

    const results = await Promise.all(teamPromises);
    const successful = results.filter(r => r.success).length;

    const duration = Date.now() - startTime;
    
    console.log(`[DVP Cache Refresh] Complete: ${successful} teams cached, ${errors} errors, ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: 'DVP cache refresh complete',
      teams: teams.length,
      positions: POSITIONS.length,
      metrics: METRICS.length,
      totalCombinations: teams.length * POSITIONS.length * METRICS.length,
      successful,
      errors,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[DVP Cache Refresh] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to refresh DVP cache',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

