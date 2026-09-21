import { NextRequest, NextResponse } from 'next/server';
import { findNblOddsGame, getNblOddsCache, refreshNblOddsData } from '@/lib/nbl/refreshNblOdds';
import { resolveNblClubName } from '@/lib/nblTeamCanonical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/nbl/odds?team=...&opponent=...
 * Cached NBL game odds (H2H, spread, total). Refreshes once if the cache is empty.
 */
export async function GET(request: NextRequest) {
  try {
    let cache = await getNblOddsCache();
    if (!cache?.games?.length) {
      const refreshed = await refreshNblOddsData();
      if (refreshed.cachePayload) cache = refreshed.cachePayload;
    }

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
