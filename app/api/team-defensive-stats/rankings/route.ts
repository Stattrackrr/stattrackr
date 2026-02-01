export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';

export const runtime = 'nodejs';

/**
 * Get defensive stats rankings in a readable format
 * Shows teams ranked 1-30 for each stat
 * Query params:
 * - stat: Which stat to show rankings for (pts, reb, ast, fg_pct, fg3_pct, stl, blk)
 * - all: If 1, returns all stats
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statParam = searchParams.get('stat');
  const getAll = searchParams.get('all') === '1';

  try {
    // Note: Basketball Reference endpoint has been removed
    return NextResponse.json(
      {
        success: false,
        error: 'This endpoint is deprecated. The Basketball Reference scraping endpoint has been removed.',
        message: 'Please use alternative data sources for team defensive rankings.'
      },
      { status: 410 } // 410 Gone
    );
    
    // Old code below (kept for reference):
    /*
    const cacheKey = 'bballref_defensive_stats_all';
    let rankingsData = cache.get<any>(cacheKey);
    
    if (!rankingsData) {
      const origin = req.headers.get('host') 
        ? `${req.headers.get('x-forwarded-proto') || 'https'}://${req.headers.get('host')}`
        : 'http://localhost:3000';
      
      const response = await fetch(`${origin}/api/team-defensive-stats/bballref?all=1`);
      if (!response.ok) {
        throw new Error('Failed to fetch rankings data');
      }
      rankingsData = await response.json();
    }

    if (!rankingsData.success || !rankingsData.rankings) {
      return NextResponse.json({ error: 'No rankings data available' }, { status: 404 });
    }

    const rankings = rankingsData.rankings;
    const teamStats = rankingsData.teamStats;

    if (getAll || !statParam) {
      // Return all stats with teams sorted by rank
      const result: Record<string, Array<{ team: string; rank: number; value: number }>> = {};
      
      const stats = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'] as const;
      
      for (const stat of stats) {
        const teams: Array<{ team: string; rank: number; value: number }> = [];
        
        for (const [team, ranks] of Object.entries(rankings)) {
          const rank = (ranks as any)[stat];
          const value = teamStats[team]?.[stat] || 0;
          if (rank) {
            teams.push({ team, rank, value });
          }
        }
        
        // Sort by rank (30 = best, 1 = worst)
        teams.sort((a, b) => b.rank - a.rank);
        result[stat] = teams;
      }
      
      return NextResponse.json({
        success: true,
        rankings: result,
        note: 'Rank 30 = best (most conceded), Rank 1 = worst (least conceded)'
      });
    }

    // Return rankings for a specific stat
    const stat = statParam as string;
    const teams: Array<{ team: string; rank: number; value: number }> = [];
    
    for (const [team, ranks] of Object.entries(rankings)) {
      const rank = (ranks as any)[stat];
      const value = teamStats[team]?.[stat] || 0;
      if (rank) {
        teams.push({ team, rank, value });
      }
    }
    
    // Sort by rank (30 = best, 1 = worst)
    teams.sort((a, b) => b.rank - a.rank);
    
    return NextResponse.json({
      success: true,
      stat,
      rankings: teams,
      note: 'Rank 30 = best (most conceded), Rank 1 = worst (least conceded)'
    });
    */
  } catch (e: any) {
    console.error('[rankings] Error:', e);
    return NextResponse.json({
      success: false,
      error: e?.message || 'Failed to get rankings'
    }, { status: 500 });
  }
}

