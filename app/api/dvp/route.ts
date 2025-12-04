export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import cache, { CACHE_TTL } from "@/lib/cache";
import { normalizeAbbr } from "@/lib/nbaAbbr";
import { currentNbaSeason } from "@/lib/nbaConstants";
import { checkRateLimit } from "@/lib/rateLimit";
import { fetchBettingProsData, OUR_TO_BP_ABBR, OUR_TO_BP_METRIC } from "@/lib/bettingpros-dvp";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }
  
  try {
    const { searchParams } = new URL(req.url);
    const rawTeam = searchParams.get('team') || '';
    const team = normalizeAbbr(rawTeam);
    const metric = (searchParams.get('metric') || 'pts').toLowerCase();
    const seasonParam = searchParams.get('season');
    const positionParam = searchParams.get('position') || '';
    const forceRefresh = searchParams.get('refresh') === '1';

    if (!team) {
      return NextResponse.json({ success: false, error: 'Missing team' }, { status: 400 });
    }

    const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();
    
    // Cache key
    const cacheKey = `dvp:${team}:${seasonYear}:${metric}:${positionParam || 'all'}`;
    
    // Check cache
    if (!forceRefresh) {
      const hit = cache.get<any>(cacheKey);
      if (hit) return NextResponse.json(hit);
    }

    // Fetch BettingPros data once
    const bpData = await fetchBettingProsData(forceRefresh);
    
    const teamAbbr = normalizeAbbr(team);
    const bpTeamAbbr = OUR_TO_BP_ABBR[teamAbbr] || teamAbbr;
    const bpMetric = OUR_TO_BP_METRIC[metric] || metric;
    
    const teamStats = bpData.teamStats?.[bpTeamAbbr];
    if (!teamStats) {
      return NextResponse.json({
        success: false,
        error: `Team ${team} not found in BettingPros data`,
      }, { status: 404 });
    }

    // If position is specified, get data for that position only
    if (positionParam && ['PG', 'SG', 'SF', 'PF', 'C'].includes(positionParam.toUpperCase())) {
      const pos = positionParam.toUpperCase();
      const positionData = teamStats[pos] || teamStats['ALL'];
      
      if (!positionData) {
        return NextResponse.json({
          success: false,
          error: `Position ${pos} not found for team ${team}`,
        }, { status: 404 });
      }
      
      const value = positionData[bpMetric];
      const numValue = value !== undefined ? Number(value) : null;
      
      const payload = {
        success: true,
        source: 'bettingpros',
        team,
        season: seasonYear,
        metric,
        position: pos,
        perGame: numValue,
      };
      
      cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
      return NextResponse.json(payload, { status: 200 });
    }

    // Otherwise, get data for all positions
    const result: Record<'PG'|'SG'|'SF'|'PF'|'C', number | null> = {
      PG: null,
      SG: null,
      SF: null,
      PF: null,
      C: null,
    };

    // Get data for each position
    for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
      const positionData = teamStats[pos];
      if (positionData) {
        const value = positionData[bpMetric];
        result[pos] = value !== undefined ? Number(value) : null;
      }
    }
    
    const payload = {
      success: true,
      source: 'bettingpros',
      team,
      season: seasonYear,
      metric,
      perGame: result,
      // For backwards compatibility, also include totals (same as perGame since BettingPros gives per-game averages)
      totals: result,
    };
    
    cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    console.error('[DVP API] Error:', e);
    return NextResponse.json(
      { success: false, error: e?.message || 'Failed to fetch DVP data' },
      { status: 500 }
    );
  }
}