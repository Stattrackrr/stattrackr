import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshAflOddsData, setAflOddsCache } from '@/lib/refreshAflOdds';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';
import { runAflPropsStatsWarm } from '@/lib/aflPropsStatsWarm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AFL_DVP_BUILD_SEASON = 2025;
const AFL_DVP_BUILD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/afl/odds/refresh
 * Single cron: (1) fetches AFL game odds, (2) refreshes player props cache, (3) runs props-stats warm,
 * (4) builds AFL DvP dataset (script) so data/afl-dvp-{season}.json is up to date.
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

    // Only replace odds cache when we have data and props refresh succeeded; never overwrite with empty.
    // Write odds first so the in-process warm can read new games/props from the list API.
    if (result.cachePayload && result.gamesCount > 0 && ppResult.eventsRefreshed > 0) {
      await setAflOddsCache(result.cachePayload);
    }

    // Run props-stats warm in-process (no internal HTTP call) so we never hit 401; L5/L10/Season/DvP for current props.
    let warmResult: { warmed?: number; error?: string } = {};
    if (result.gamesCount > 0) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';
      const cronSecret = (process.env.CRON_SECRET ?? '').replace(/\r\n|\r|\n/g, '').trim();
      try {
        const warm = await runAflPropsStatsWarm(baseUrl, { useListApi: true, cronSecret });
        warmResult = { warmed: warm.warmed, error: warm.success ? undefined : warm.error };
        console.log('[AFL cron] Props-stats warm done:', warmResult.warmed ?? 0, warmResult.error ?? 'OK');
      } catch (e) {
        warmResult = { error: e instanceof Error ? e.message : String(e) };
        console.warn('[AFL cron] Props-stats warm failed:', warmResult.error);
      }
    }

    // Build AFL DvP dataset so data/afl-dvp-{season}.json is up to date (used by DvP batch API and script).
    let dvpBuildOk = false;
    try {
      const cwd = process.cwd();
      const scriptPath = path.join(cwd, 'scripts', 'build-afl-dvp.js');
      const baseUrl =
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      execSync(
        `node "${scriptPath}" --season=${AFL_DVP_BUILD_SEASON} --base-url=${baseUrl}`,
        {
          cwd,
          timeout: AFL_DVP_BUILD_TIMEOUT_MS,
          stdio: 'pipe',
          encoding: 'utf8',
        }
      );
      dvpBuildOk = true;
      console.log('[AFL cron] DvP build done (season', AFL_DVP_BUILD_SEASON + ')');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[AFL cron] DvP build failed:', msg);
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
      dvpBuildOk,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('[AFL cron] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
