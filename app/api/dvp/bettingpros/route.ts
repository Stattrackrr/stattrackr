/**
 * Fetch DVP data from BettingPros
 * 
 * BettingPros provides Defense vs Position statistics
 * URL: https://www.bettingpros.com/nba/defense-vs-position/
 * 
 * The data is embedded in a JavaScript variable `bpDefenseVsPositionStats`
 * in the HTML page.
 */

import { NextRequest, NextResponse } from "next/server";
import { normalizeAbbr, NBA_TEAMS } from "@/lib/nbaAbbr";
import { fetchBettingProsData, OUR_TO_BP_ABBR, OUR_TO_BP_METRIC } from "@/lib/bettingpros-dvp";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Convert BettingPros data format to our DVP API format
 */
function convertBettingProsData(bpData: any, team: string, position: string, metric: string): number | null {
  const teamAbbr = normalizeAbbr(team);
  // BettingPros uses different abbreviations for some teams
  const bpTeamAbbr = OUR_TO_BP_ABBR[teamAbbr] || teamAbbr;
  
  const teamStats = bpData.teamStats?.[bpTeamAbbr];
  if (!teamStats) {
    return null;
  }

  // Position mapping
  const pos = position.toUpperCase();
  const positionData = teamStats[pos] || teamStats['ALL'];
  if (!positionData) {
    return null;
  }

  // Metric mapping
  const bpMetric = OUR_TO_BP_METRIC[metric] || metric;
  let value = positionData[bpMetric];

  // Handle percentage metrics (convert from percentage to decimal if needed)
  if (metric === 'fg_pct' || metric === 'ft_pct') {
    // BettingPros stores percentages as numbers (e.g., 46.43 for 46.43%)
    // Our API might expect decimals (0.4643) - check what format is expected
    // For now, return as-is since it's already a percentage number
    value = value;
  }

  return value !== undefined ? Number(value) : null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const position = searchParams.get('position') || 'ALL';
    const metric = searchParams.get('metric') || 'pts';
    const season = searchParams.get('season');

    // Fetch BettingPros data (with caching)
    const bpData = await fetchBettingProsData();

    // If team is specified, return data for that team
    if (team) {
      const value = convertBettingProsData(bpData, team, position, metric);
      
      return NextResponse.json({
        success: true,
        source: 'bettingpros',
        team: normalizeAbbr(team),
        position: position.toUpperCase(),
        metric,
        value,
        season: bpData.seasonParam || season,
        avgGamesPlayed: bpData.avgGamesPlayed,
      });
    }

    // Otherwise, return all teams' data for the specified position and metric
    const allTeams: Record<string, number | null> = {};
    
    // Iterate through all teams in BettingPros data
    for (const [bpAbbr, teamStats] of Object.entries(bpData.teamStats || {})) {
      // Convert BettingPros abbreviation to our format
      const ourAbbr = normalizeAbbr(bpAbbr);
      
      if (teamStats && typeof teamStats === 'object') {
        const pos = position.toUpperCase();
        const positionData = (teamStats as any)[pos] || (teamStats as any)['ALL'];
        if (positionData) {
          const bpMetric = OUR_TO_BP_METRIC[metric] || metric;
          const value = positionData[bpMetric];
          allTeams[ourAbbr] = value !== undefined ? Number(value) : null;
        } else {
          allTeams[ourAbbr] = null;
        }
      } else {
        allTeams[ourAbbr] = null;
      }
    }

    return NextResponse.json({
      success: true,
      source: 'bettingpros',
      position: position.toUpperCase(),
      metric,
      teams: allTeams,
      season: bpData.seasonParam || season,
      avgGamesPlayed: bpData.avgGamesPlayed,
    });

  } catch (error: any) {
    console.error('[DVP BettingPros] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch DVP data from BettingPros',
      },
      { status: 500 }
    );
  }
}
