import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshAflOddsData } from '@/lib/refreshAflOdds';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/odds/refresh
 * Single cron: fetches AFL game odds then immediately refreshes player props. Writes cache only on success
 * so the old cache stays visible until new data is ready (~30 API credits per run).
 * Vercel cron runs this; old cache is shown until this run completes successfully.
 */
export async function GET(request: NextRequest) {
  console.log('[AFL cron] /api/afl/odds/refresh started');
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) {
      console.log('[AFL cron] 401 Unauthorized – check CRON_SECRET or use Vercel cron trigger');
      return auth.response;
    }
  }

  try {
    const result = await refreshAflOddsData();
    if (!result.success) {
      console.log('[AFL cron] Odds fetch failed:', result.error);
      return NextResponse.json(
        { success: false, error: result.error, gamesCount: 0, eventsRefreshed: 0, playersWithProps: 0 },
        { status: result.error?.includes('ODDS_API_KEY') ? 503 : 502 }
      );
    }

    console.log('[AFL cron] Odds OK, games:', result.gamesCount);
    const ppResult = await refreshAflPlayerPropsCache(result.games);
    console.log('[AFL cron] Props refreshed – events:', ppResult.eventsRefreshed, 'players:', ppResult.playersWithProps, ppResult.error ? `error: ${ppResult.error}` : 'OK');

    return NextResponse.json({
      success: true,
      gamesCount: result.gamesCount,
      lastUpdated: result.lastUpdated,
      nextUpdate: result.nextUpdate,
      eventsRefreshed: ppResult.eventsRefreshed,
      playersWithProps: ppResult.playersWithProps,
      playerPropsOk: ppResult.success,
      playerPropsError: ppResult.error ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('[AFL cron] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
