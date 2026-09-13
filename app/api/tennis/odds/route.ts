import { NextRequest, NextResponse } from 'next/server';
import { getTennisMatchOddsForPlayer } from '@/lib/tennis/odds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/tennis/odds?playerId=...
 * Reads the stored match snapshot. The Odds API is refreshed on cron, not per request.
 * Books are oriented so H2H.home / Spread.line are the selected player.
 */
export async function GET(request: NextRequest) {
  try {
    const playerId = request.nextUrl.searchParams.get('playerId');
    const playerName = request.nextUrl.searchParams.get('player') || request.nextUrl.searchParams.get('name');
    if (!String(playerId || '').trim() && !String(playerName || '').trim()) {
      return NextResponse.json({ success: false, error: 'playerId is required', data: [] }, { status: 400 });
    }
    const odds = await getTennisMatchOddsForPlayer({ playerId, playerName });
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
