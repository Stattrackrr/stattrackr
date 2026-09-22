import { NextRequest, NextResponse } from 'next/server';
import { findNblOddsGame, getNblOddsCache } from '@/lib/nbl/refreshNblOdds';
import { resolveNblClubName } from '@/lib/nblTeamCanonical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/nbl/odds?team=...&opponent=...
 * Reads the stored odds snapshot. The Odds API is refreshed on cron, not per request.
 */
export async function GET(request: NextRequest) {
  try {
    const cache = await getNblOddsCache();

    const games = cache?.games ?? [];
    const lastUpdated = cache?.lastUpdated ?? '';
    const nextUpdate = cache?.nextUpdate ?? '';
    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const opponent = searchParams.get('opponent');

    if (!team) {
      return NextResponse.json({
        success: true,
        data: games,
        lastUpdated,
        nextUpdate,
      });
    }

    const teamNorm = resolveNblClubName(team) || team;
    const opponentNorm = opponent ? resolveNblClubName(opponent) || opponent : null;
    const game = findNblOddsGame(games, teamNorm, opponentNorm);

    if (!game) {
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        lastUpdated,
        nextUpdate,
        message: 'No matching NBL game in cache',
      });
    }

    return NextResponse.json({
      success: true,
      data: game.bookmakers ?? [],
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      lastUpdated,
      nextUpdate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [] }, { status: 500 });
  }
}
