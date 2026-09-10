import { NextRequest, NextResponse } from 'next/server';
import { getTennisMatchOddsForPlayer } from '@/lib/tennis/odds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/tennis/odds?playerId=...
 * Cache-first API-Tennis get_odds merged with The Odds API books for the player's upcoming singles match.
 * Books are oriented so H2H.home / Spread.line are the selected player.
 */
export async function GET(request: NextRequest) {
  try {
    const playerId = request.nextUrl.searchParams.get('playerId');
    if (!String(playerId || '').trim()) {
      return NextResponse.json({ success: false, error: 'playerId is required', data: [] }, { status: 400 });
    }
    const odds = await getTennisMatchOddsForPlayer({ playerId });
    if (!odds) {
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        message: 'No upcoming match odds',
      });
    }
    return NextResponse.json({
      success: true,
      data: odds.bookmakers,
      homeTeam: odds.homeTeam,
      awayTeam: odds.awayTeam,
      matchId: odds.matchId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [] }, { status: 500 });
  }
}
