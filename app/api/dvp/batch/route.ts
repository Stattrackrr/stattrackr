export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import cache, { CACHE_TTL } from "@/lib/cache";
import { normalizeAbbr } from "@/lib/nbaAbbr";
import { currentNbaSeason } from "@/lib/nbaConstants";
import { fetchBettingProsData, OUR_TO_BP_ABBR, OUR_TO_BP_METRIC } from "@/lib/bettingpros-dvp";

/**
 * Batched DVP API endpoint
 * Fetches multiple metrics for a team in a single request
 * Optimized to fetch BettingPros data once for all metrics
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const metricsParam = searchParams.get('metrics');
    const games = searchParams.get('games') || '82';
    const seasonParam = searchParams.get('season');
    const positionParam = searchParams.get('position') || '';
    const forceRefresh = searchParams.get('refresh') === '1';

    if (!team) {
      return NextResponse.json(
        { error: 'Missing required parameter: team' },
        { status: 400 }
      );
    }

    if (!metricsParam) {
      return NextResponse.json(
        { error: 'Missing required parameter: metrics' },
        { status: 400 }
      );
    }

    const metrics = metricsParam.split(',').map(m => m.trim());
    const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();
    const teamAbbr = normalizeAbbr(team);
    const bpTeamAbbr = OUR_TO_BP_ABBR[teamAbbr] || teamAbbr;
    const pos = positionParam.toUpperCase() || 'ALL';

    // Cache key
    const cacheKey = `dvp_batch:${teamAbbr}:${seasonYear}:${metrics.join(',')}:${pos}`;
    
    // Check cache
    if (!forceRefresh) {
      const hit = cache.get<any>(cacheKey);
      if (hit) return NextResponse.json(hit);
    }

    // Fetch BettingPros data (with caching)
    const bpData = await fetchBettingProsData(forceRefresh);
    
    const teamStats = bpData.teamStats?.[bpTeamAbbr];
    if (!teamStats) {
      // Return null for all metrics if team not found
      const metricsObj: Record<string, Record<string, number | null>> = {};
      for (const metric of metrics) {
        metricsObj[metric] = {
          PG: null,
          SG: null,
          SF: null,
          PF: null,
          C: null,
        };
      }
      return NextResponse.json({
        team: teamAbbr,
        games,
        metrics: metricsObj,
        sample_games: 0,
      });
    }

    // Extract all requested metrics for all positions
    // Frontend expects: metrics.pts.PF, metrics.reb.PF, etc.
    const metricsObj: Record<string, Record<string, number | null>> = {};
    for (const metric of metrics) {
      const bpMetric = OUR_TO_BP_METRIC[metric] || metric;
      metricsObj[metric] = {};
      
      // Get value for each position (PG, SG, SF, PF, C)
      for (const position of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
        const posData = teamStats[position] || teamStats['ALL'] || {};
        const value = posData[bpMetric];
        metricsObj[metric][position] = value !== undefined ? Number(value) : null;
      }
    }

    const result = {
      team: teamAbbr,
      games,
      metrics: metricsObj,
      sample_games: bpData.avgGamesPlayed || 0,
      source: 'bettingpros',
    };

    cache.set(cacheKey, result, CACHE_TTL.ADVANCED_STATS);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in batch DVP endpoint:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}