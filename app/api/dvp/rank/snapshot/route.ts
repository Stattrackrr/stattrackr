export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeAbbr, NBA_TEAMS } from "@/lib/nbaAbbr";
import { currentNbaSeason } from "@/lib/nbaConstants";
import { fetchBettingProsData, OUR_TO_BP_ABBR, OUR_TO_BP_METRIC } from "@/lib/bettingpros-dvp";

export const runtime = "nodejs";

const POS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const METRICS = ['pts', 'reb', 'ast', 'fg3m', 'fg_pct', 'stl', 'blk', 'to', 'pra', 'pr', 'pa', 'ra'] as const;

// Combined stats that need to be calculated from component stats
const COMBINED_STATS = {
  'pra': ['pts', 'reb', 'ast'],
  'pa': ['pts', 'ast'],
  'pr': ['pts', 'reb'],
  'ra': ['reb', 'ast'],
};

/**
 * Snapshot current DvP ranks to database
 * This should be called daily (via cron) to capture historical rankings
 * 
 * Query params:
 * - date: Optional date for snapshot (defaults to today)
 * - season: Optional season year (defaults to current season)
 * - position: Optional position to snapshot (defaults to all)
 * - metric: Optional metric to snapshot (defaults to all)
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const seasonParam = searchParams.get('season');
    const positionParam = searchParams.get('position');
    const metricParam = searchParams.get('metric');
    
    // Use provided date or today
    const snapshotDate = dateParam ? new Date(dateParam) : new Date();
    snapshotDate.setHours(0, 0, 0, 0); // Normalize to start of day
    
    const season = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();
    const positions = positionParam ? [positionParam.toUpperCase()] : POS;
    const metrics = metricParam ? [metricParam.toLowerCase()] : METRICS;
    
    // Validate positions
    for (const pos of positions) {
      if (!POS.includes(pos as any)) {
        return NextResponse.json(
          { error: `Invalid position: ${pos}. Must be one of: ${POS.join(', ')}` },
          { status: 400 }
        );
      }
    }
    
    // Validate metrics
    for (const metric of metrics) {
      if (!METRICS.includes(metric as any) && !COMBINED_STATS[metric as keyof typeof COMBINED_STATS]) {
        return NextResponse.json(
          { error: `Invalid metric: ${metric}` },
          { status: 400 }
        );
      }
    }
    
    // Fetch current BettingPros data
    const bpData = await fetchBettingProsData(false);
    
    if (!bpData || !bpData.teamStats) {
      return NextResponse.json(
        { error: 'No BettingPros data available' },
        { status: 500 }
      );
    }
    
    const supabase = await createClient();
    const teams = Object.keys(NBA_TEAMS);
    const snapshots: Array<{
      snapshot_date: string;
      season: number;
      position: string;
      metric: string;
      team: string;
      rank: number;
    }> = [];
    
    // Process each position/metric combination
    for (const pos of positions) {
      for (const metric of metrics) {
        const isCombinedStat = COMBINED_STATS[metric as keyof typeof COMBINED_STATS];
        const bpMetric = OUR_TO_BP_METRIC[metric] || metric;
        
        // Calculate values for all teams
        const teamValues: Array<{ team: string; value: number | null }> = [];
        
        for (const team of teams) {
          try {
            const teamAbbr = normalizeAbbr(team);
            const bpTeamAbbr = OUR_TO_BP_ABBR[teamAbbr] || teamAbbr;
            const teamStats = bpData.teamStats?.[bpTeamAbbr];
            
            if (!teamStats) {
              teamValues.push({ team: teamAbbr, value: null });
              continue;
            }
            
            const positionData = teamStats[pos] || teamStats['ALL'];
            if (!positionData) {
              teamValues.push({ team: teamAbbr, value: null });
              continue;
            }
            
            let value: number | null = null;
            
            if (isCombinedStat) {
              // Sum component stats
              const componentMetrics = isCombinedStat;
              let combinedValue: number | null = null;
              let hasAllComponents = true;
              
              for (const componentMetric of componentMetrics) {
                const bpComponentMetric = OUR_TO_BP_METRIC[componentMetric] || componentMetric;
                const componentValue = positionData[bpComponentMetric];
                
                if (componentValue === undefined || componentValue === null) {
                  hasAllComponents = false;
                  break;
                }
                
                const numValue = Number(componentValue);
                if (isNaN(numValue)) {
                  hasAllComponents = false;
                  break;
                }
                
                if (combinedValue === null) {
                  combinedValue = numValue;
                } else {
                  combinedValue += numValue;
                }
              }
              
              value = hasAllComponents ? combinedValue : null;
            } else {
              const rawValue = positionData[bpMetric];
              value = rawValue !== undefined ? Number(rawValue) : null;
            }
            
            teamValues.push({ team: teamAbbr, value });
          } catch (e: any) {
            console.error(`[DVP Snapshot] Error processing team ${team}:`, e);
            teamValues.push({ team: normalizeAbbr(team), value: null });
          }
        }
        
        // Compute ranks: lower value -> rank 1, higher value -> rank 30
        const valid = teamValues.filter(r => r.value != null) as Array<{team: string, value: number}>;
        valid.sort((a, b) => (a.value - b.value));
        
        const ranks: Record<string, number> = {};
        valid.forEach((r, idx) => {
          ranks[r.team] = idx + 1;
        });
        
        // Include nulls as rank 0
        teamValues.filter(r => r.value == null).forEach(r => {
          ranks[r.team] = 0;
        });
        
        // Add to snapshots array
        for (const [team, rank] of Object.entries(ranks)) {
          snapshots.push({
            snapshot_date: snapshotDate.toISOString().split('T')[0], // YYYY-MM-DD format
            season,
            position: pos,
            metric,
            team,
            rank,
          });
        }
      }
    }
    
    // Insert snapshots (using upsert to handle duplicates)
    if (snapshots.length > 0) {
      const { error } = await supabase
        .from('dvp_rank_snapshots')
        .upsert(snapshots, {
          onConflict: 'snapshot_date,season,position,metric,team',
        });
      
      if (error) {
        console.error('[DVP Snapshot] Database error:', error);
        return NextResponse.json(
          { error: `Database error: ${error.message}` },
          { status: 500 }
        );
      }
    }
    
    return NextResponse.json({
      success: true,
      snapshot_date: snapshotDate.toISOString().split('T')[0],
      season,
      positions_snapshot: positions.length,
      metrics_snapshot: metrics.length,
      teams_snapshot: teams.length,
      total_snapshots: snapshots.length,
    });
  } catch (e: any) {
    console.error('[DVP Snapshot] Error:', e);
    return NextResponse.json(
      { error: e?.message || 'Snapshot failed' },
      { status: 500 }
    );
  }
}







