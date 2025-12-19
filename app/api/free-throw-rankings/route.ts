// app/api/free-throw-rankings/route.ts
// Separate endpoint to test opponent free throw rankings
// Once verified, this logic will be integrated into play-type-analysis

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache } from '@/lib/nbaCache';
import { currentNbaSeason } from '@/lib/nbaUtils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    const opponentTeam = searchParams.get('opponentTeam');
    
    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    
    // Fetch opponent free throw rankings from bulk cache
    const opponentFreeThrowsCacheKey = `opponent_freethrows_rankings_${seasonStr}`;
    const opponentFreeThrowRankings = await getNBACache<Array<{ team: string; oppFtm: number }>>(opponentFreeThrowsCacheKey);
    
    if (!opponentFreeThrowRankings || !Array.isArray(opponentFreeThrowRankings)) {
      return NextResponse.json({
        success: false,
        error: 'Opponent free throw rankings not found in cache. Please run the refresh script first.',
        cacheKey: opponentFreeThrowsCacheKey,
      }, { status: 404 });
    }
    
    // If opponent team is specified, find its rank
    let opponentRank: number | null = null;
    let opponentData: { team: string; oppFtm: number } | null = null;
    
    if (opponentTeam && opponentTeam !== 'N/A') {
      const normalizedOpponent = opponentTeam.toUpperCase();
      const ranking = opponentFreeThrowRankings.findIndex(r => r.team.toUpperCase() === normalizedOpponent);
      
      if (ranking >= 0) {
        opponentRank = ranking + 1; // rank 1 = best defense (lowest OPP_FTM)
        opponentData = opponentFreeThrowRankings[ranking];
      }
    }
    
    return NextResponse.json({
      success: true,
      season: seasonStr,
      totalTeams: opponentFreeThrowRankings.length,
      opponentTeam: opponentTeam || null,
      opponentRank,
      opponentData,
      allRankings: opponentFreeThrowRankings.map((r, idx) => ({
        rank: idx + 1,
        team: r.team,
        oppFtm: r.oppFtm,
        isRequestedTeam: opponentTeam ? r.team.toUpperCase() === opponentTeam.toUpperCase() : false,
      })),
      cacheKey: opponentFreeThrowsCacheKey,
    });
    
  } catch (error: any) {
    console.error('[Free Throw Rankings] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal server error',
    }, { status: 500 });
  }
}

