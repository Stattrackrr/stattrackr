import { NextResponse } from 'next/server';
import { listAflPlayerPropsFromCache } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/player-props/list
 * Returns all cached AFL player props (all events) for the props page.
 * Read-only from cache; same 90-min cache as dashboard.
 */
export async function GET() {
  try {
    const result = await listAflPlayerPropsFromCache();
    if (!result) {
      return NextResponse.json({
        success: true,
        data: [],
        games: [],
        message: 'No AFL player props in cache. Run /api/afl/odds/refresh to populate.',
      });
    }
    return NextResponse.json({
      success: true,
      data: result.props,
      games: result.games.map((g) => ({
        gameId: g.gameId,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        commenceTime: g.commenceTime,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [], games: [] }, { status: 500 });
  }
}
