import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshAflOddsData, setAflOddsCache } from '@/lib/refreshAflOdds';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/odds/refresh
 * Single cron: (1) fetches AFL game odds, (2) refreshes player props cache, (3) runs props-stats warm.
 * We only replace caches when the run is successful and we have data; if unsuccessful or empty we leave
 * old cache until TTL (e.g. 24h for stats) or next successful run.
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
    const result = await refreshAflOddsData({ skipWrite: true });
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
      const cronSecret = (process.env.CRON_SECRET ?? '').replace(/\r\n|\r|\n/g, '').trim();
      const warmUrl = new URL(`${baseUrl}/api/afl/props-stats/warm`);
      warmUrl.searchParams.set('useList', '1');
      if (cronSecret) warmUrl.searchParams.set('secret', cronSecret);
      const headers: Record<string, string> = {};
      if (cronSecret) {
        headers['Authorization'] = `Bearer ${cronSecret}`;
        headers['x-cron-secret'] = cronSecret;
      }
      try {
        const warmRes = await fetch(warmUrl.toString(), { method: 'GET', headers, cache: 'no-store' });
        const warmData = warmRes.ok ? await warmRes.json() : null;
        warmResult = { warmed: warmData?.warmed ?? warmData?.uniqueProps, error: warmRes.ok ? undefined : (warmData?.error ?? warmRes.statusText) };
        console.log('[AFL cron] Props-stats warm done:', warmResult.warmed ?? 0, warmResult.error ?? 'OK');
      } catch (e) {
        warmResult = { error: e instanceof Error ? e.message : String(e) };
        console.warn('[AFL cron] Props-stats warm failed:', warmResult.error);
      }
    }

    // Only replace odds cache when we have data and props refresh succeeded; never overwrite with empty.
    if (result.cachePayload && result.gamesCount > 0 && ppResult.eventsRefreshed > 0) {
      await setAflOddsCache(result.cachePayload);
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
