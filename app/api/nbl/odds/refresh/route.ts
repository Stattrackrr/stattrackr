import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshNblOddsAndPropsIngest } from '@/lib/nbl/refreshNblPropsIngest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** GET /api/nbl/odds/refresh — PulseScore + The Odds API, then bake props. */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const result = await refreshNblOddsAndPropsIngest({ disk: false });
  return NextResponse.json(
    {
      success: result.success,
      gamesCount: result.gameOdds.gamesCount,
      lastUpdated: result.gameOdds.lastUpdated,
      nextUpdate: result.gameOdds.nextUpdate,
      pulseGames: result.pulseGames,
      propsCount: result.propsCount,
      combinedNbl: result.combinedNbl,
      snapshots: result.snapshots,
      error: result.error || result.gameOdds.error,
    },
    { status: result.success ? 200 : 502 }
  );
}
