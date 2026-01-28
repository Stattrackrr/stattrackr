export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeAbbr } from "@/lib/nbaAbbr";
import { currentNbaSeason } from "@/lib/nbaConstants";

export const runtime = "nodejs";

/**
 * Get historical DvP ranks for a specific date
 * Returns ranks for all teams for the given position/metric combination
 * 
 * Query params:
 * - date: Game date (YYYY-MM-DD format)
 * - season: Season year (defaults to current season)
 * - pos: Position (PG, SG, SF, PF, C)
 * - metric: Metric (pts, reb, ast, etc.)
 * 
 * Returns the rank snapshot closest to (but not after) the game date
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const seasonParam = searchParams.get('season');
    const pos = searchParams.get('pos');
    const metric = searchParams.get('metric');
    
    if (!dateParam) {
      return NextResponse.json(
        { error: 'Missing required parameter: date' },
        { status: 400 }
      );
    }
    
    if (!pos) {
      return NextResponse.json(
        { error: 'Missing required parameter: pos' },
        { status: 400 }
      );
    }
    
    if (!metric) {
      return NextResponse.json(
        { error: 'Missing required parameter: metric' },
        { status: 400 }
      );
    }
    
    const gameDate = new Date(dateParam);
    if (isNaN(gameDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }
    
    const season = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();
    const normalizedPos = pos.toUpperCase();
    const normalizedMetric = metric.toLowerCase();
    
    // Validate position
    if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(normalizedPos)) {
      return NextResponse.json(
        { error: `Invalid position: ${pos}` },
        { status: 400 }
      );
    }
    
    const supabase = await createClient();
    
    // EGRESS OPTIMIZATION: Use RPC function with DISTINCT ON to get only latest snapshot per team
    // This reduces data transfer from potentially thousands of rows to just 30 rows (one per team)
    // Instead of fetching all snapshots and filtering in JS, PostgreSQL does it efficiently
    const gameDateStr = gameDate.toISOString().split('T')[0];
    const { data, error } = await supabase.rpc('get_latest_dvp_snapshots', {
      p_season: season,
      p_position: normalizedPos,
      p_metric: normalizedMetric,
      p_game_date: gameDateStr
    });
    
    if (error) {
      console.error('[Historical DvP] Database error:', error);
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }
    
    // Group by team and take the most recent rank for each team
    // (data is already sorted by snapshot_date DESC, so first occurrence is most recent)
    const ranksByTeam: Record<string, number> = {};
    let latestSnapshotDate: string | null = null;
    
    if (data && data.length > 0) {
      // Find the latest snapshot date
      latestSnapshotDate = data.reduce((latest: string | null, row: any) => {
        if (!latest || row.snapshot_date > latest) {
          return row.snapshot_date;
        }
        return latest;
      }, null);
      
      for (const row of data) {
        const team = normalizeAbbr(row.team);
        // Data is already filtered to one row per team by the RPC function
        ranksByTeam[team] = row.rank;
      }
    }
    
    // If no historical data found, return empty object (caller can fallback to current ranks)
    if (Object.keys(ranksByTeam).length === 0) {
      return NextResponse.json({
        success: true,
        ranks: {},
        snapshot_date: null,
        note: 'No historical snapshot found for this date. Use current ranks as fallback.',
      });
    }
    
    return NextResponse.json({
      success: true,
      ranks: ranksByTeam,
      snapshot_date: latestSnapshotDate,
      game_date: gameDate.toISOString().split('T')[0],
      season,
      position: normalizedPos,
      metric: normalizedMetric,
    });
  } catch (e: any) {
    console.error('[Historical DvP] Error:', e);
    return NextResponse.json(
      { error: e?.message || 'Historical lookup failed' },
      { status: 500 }
    );
  }
}

