import { NextResponse } from 'next/server';
import { listAflPlayerPropsFromCache } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function hasOver(o: string) {
  return o != null && String(o).trim() !== '' && String(o) !== 'N/A';
}
function hasUnder(u: string) {
  return u != null && String(u).trim() !== '' && String(u) !== 'N/A';
}

/**
 * GET /api/afl/player-props/list
 * Reads only from the AFL props cache. No processing, no stats lookup, no DvP/team resolution.
 * Stats (L5, L10, H2H, etc.) are populated by the props-stats/warm cron and must be stored
 * in the same cache if they are to appear here; otherwise this returns raw cached props only.
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
    const rows = result.props.filter((r) => hasOver(r.overOdds) && hasUnder(r.underOdds));
    return NextResponse.json({
      success: true,
      data: rows,
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
