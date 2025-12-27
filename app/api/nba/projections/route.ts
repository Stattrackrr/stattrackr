/**
 * Get player minutes projections for NBA games
 * 
 * Usage: /api/nba/projections?date=2025-01-15
 * 
 * Returns:
 * - playerMinutes: projected minutes for each player (from SportsLine)
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || undefined;
    
    // Fetch player minutes from SportsLine
    let playerMinutes: any[] = [];
    try {
      // Import and call SportsLine function directly (more efficient than HTTP call)
      const { fetchSportsLineProjections } = await import('./sportsline/route');
      
      console.log('[Projections] Fetching SportsLine projections...');
      playerMinutes = await fetchSportsLineProjections();
      console.log(`[Projections] Got ${playerMinutes.length} player projections from SportsLine`);
    } catch (err: any) {
      console.warn('[Projections] Error fetching SportsLine projections:', err.message);
      // Continue without player minutes
    }
    
    return NextResponse.json({
      date: date || 'today',
      playerMinutes,
      summary: {
        playersWithProjections: playerMinutes.length,
      },
    });
    
  } catch (error: any) {
    console.error('[Projections] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch projections' },
      { status: 500 }
    );
  }
}

