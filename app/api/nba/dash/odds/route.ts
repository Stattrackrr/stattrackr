import { NextRequest, NextResponse } from 'next/server';
import { findNbaOddsGame, getNbaOddsCache, nbaGameBooks } from '@/lib/nba/dash/odds';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nba/dash/odds?team=&opponent=
 * Reads the stored NBA odds snapshot. Refreshes happen on cron, not per request.
 */
export async function GET(request: NextRequest) {
  try {
    const cache = await getNbaOddsCache();
    const games = cache?.games ?? [];
    const lastUpdated = cache?.lastUpdated ?? '';
    const nextUpdate = cache?.nextUpdate ?? '';
    const team = request.nextUrl.searchParams.get('team');
    const opponent = request.nextUrl.searchParams.get('opponent');
    if (!team) {
      return NextResponse.json({ success: true, data: [], lastUpdated, nextUpdate });
    }
    const game = findNbaOddsGame(games, team, opponent);
    if (!game) {
      return NextResponse.json({
        success: true,
        data: [],
        lastUpdated,
        nextUpdate,
        message: 'No matching NBA game in cache',
      });
    }
    return NextResponse.json({
      success: true,
      data: nbaGameBooks(game),
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      lastUpdated,
      nextUpdate,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err), data: [] },
      { status: 500 }
    );
  }
}
