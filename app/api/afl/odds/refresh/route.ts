import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshAflOddsData } from '@/lib/refreshAflOdds';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/odds/refresh
 * Single cron: (1) fetches AFL game odds and refreshes player props cache, (2) runs props-stats warm
 * so L5/L10/Season/DvP etc are populated for current props in the same run. No separate warm cron.
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

    // Run props-stats warm immediately so L5/L10/Season etc are populated for current props (same cron run)
    let warmResult: { warmed?: number; error?: string } = {};
    if (result.gamesCount > 0) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';
      const warmUrl = `${baseUrl}/api/afl/props-stats/warm?useList=1`;
      const headers: Record<string, string> = {};
      const cronSecret = process.env.CRON_SECRET;
      if (cronSecret) headers['Authorization'] = `Bearer ${cronSecret}`;
      try {
        const warmRes = await fetch(warmUrl, { method: 'GET', headers, cache: 'no-store' });
        const warmData = warmRes.ok ? await warmRes.json() : null;
        warmResult = { warmed: warmData?.warmed ?? warmData?.uniqueProps, error: warmRes.ok ? undefined : (warmData?.error ?? warmRes.statusText) };
        console.log('[AFL cron] Props-stats warm done:', warmResult.warmed ?? 0, warmResult.error ?? 'OK');
      } catch (e) {
        warmResult = { error: e instanceof Error ? e.message : String(e) };
        console.warn('[AFL cron] Props-stats warm failed:', warmResult.error);
      }
    }

    return NextResponse.json({
      success: true,
      gamesCount: result.gamesCount,
      lastUpdated: result.lastUpdated,
      nextUpdate: result.nextUpdate,
      eventsRefreshed: ppResult.eventsRefreshed,
      playersWithProps: ppResult.playersWithProps,
      playerPropsOk: ppResult.success,
      playerPropsError: ppResult.error ?? undefined,
      statsWarmed: warmResult.warmed,
      statsWarmError: warmResult.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('[AFL cron] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
