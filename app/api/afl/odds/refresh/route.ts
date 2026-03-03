import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshAflOddsData } from '@/lib/refreshAflOdds';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/odds/refresh
 * Fetches AFL game odds + player props (goals & disposals only) and writes 90-min cache.
 * Called by Vercel cron every hour; also allowed with CRON_SECRET for manual runs.
 */
export async function GET(request: NextRequest) {
  // In production require cron auth (Vercel cron or CRON_SECRET); in dev allow for easy local testing
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) {
      return auth.response;
    }
  }

  try {
    const result = await refreshAflOddsData();
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, gamesCount: 0, eventsRefreshed: 0 },
        { status: result.error?.includes('ODDS_API_KEY') ? 503 : 502 }
      );
    }

    const ppResult = await refreshAflPlayerPropsCache();

    return NextResponse.json({
      success: true,
      gamesCount: result.gamesCount,
      lastUpdated: result.lastUpdated,
      nextUpdate: result.nextUpdate,
      eventsRefreshed: ppResult.eventsRefreshed,
      playerPropsOk: ppResult.success,
      playerPropsError: ppResult.error ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
