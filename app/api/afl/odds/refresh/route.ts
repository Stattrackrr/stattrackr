import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshAflOddsData, setAflOddsCache } from '@/lib/refreshAflOdds';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';
import { runAflPropsStatsWarm } from '@/lib/aflPropsStatsWarm';
import {
  getAflDvpPayloadCacheKey,
  AFL_DVP_CACHE_TTL_SECONDS,
} from '@/lib/aflDvpCache';
import sharedCache from '@/lib/sharedCache';

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
/**
 * Query: dvpBaseUrl – override base URL for DvP build (e.g. production URL to avoid 401).
 * Example: /api/afl/odds/refresh?dvpBaseUrl=https://your-production.vercel.app
 */
export async function GET(request: NextRequest) {
  console.log('[AFL cron] /api/afl/odds/refresh started');
  const dvpBaseUrlParam = request.nextUrl.searchParams.get('dvpBaseUrl')?.trim();
  const dvpBaseUrlOverride =
    dvpBaseUrlParam && /^https?:\/\//i.test(dvpBaseUrlParam) ? dvpBaseUrlParam.replace(/\/+$/, '') : null;

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
    if (result.cachePayload && result.gamesCount > 0 && ppResult.eventsRefreshed > 0) {
      await setAflOddsCache(result.cachePayload);
    }

    // Build AFL DvP first so the props-stats warm below uses fresh DvP rankings.
    // On Vercel /tmp is writable; we write there then store in Redis.
    // Readers (batch API, props warm) use cache first, then fall back to data/ file (e.g. local dev).
    let dvpBuildOk = false;
    const tmpDir = os.tmpdir();
    const tmpDvpPath = path.join(tmpDir, `afl-dvp-${AFL_DVP_BUILD_SEASON}.json`);
    try {
      const cwd = process.cwd();
      const scriptPath = path.join(cwd, 'scripts', 'build-afl-dvp.js');
      // ?dvpBaseUrl= override, then env DVP_BUILD_BASE_URL, then VERCEL_URL (avoids 401 when production URL has no protection).
      const baseUrl =
        dvpBaseUrlOverride ||
        process.env.DVP_BUILD_BASE_URL?.trim() ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      if (dvpBaseUrlOverride) console.log('[AFL cron] DvP build using baseUrl from query:', baseUrl);
      const outputDirArg = tmpDir.replace(/\\/g, '/').replace(/"/g, '');
      const bypassSecret =
        (process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? process.env.CRON_SECRET ?? '').replace(
          /\r\n|\r|\n/g,
          ''
        ).trim();
      const env = { ...process.env };
      if (bypassSecret) env.DVP_BYPASS_SECRET = bypassSecret;
      execSync(
        `node "${scriptPath}" --season=${AFL_DVP_BUILD_SEASON} --base-url=${baseUrl} --output-dir="${outputDirArg}"`,
        {
          cwd,
          timeout: AFL_DVP_BUILD_TIMEOUT_MS,
          stdio: 'pipe',
          encoding: 'utf8',
          env,
        }
      );
      const raw = await fs.readFile(tmpDvpPath, 'utf8');
      const payload = JSON.parse(raw) as Record<string, unknown>;
      await sharedCache.setJSON(
        getAflDvpPayloadCacheKey(AFL_DVP_BUILD_SEASON),
        payload,
        AFL_DVP_CACHE_TTL_SECONDS
      );
      await fs.unlink(tmpDvpPath).catch(() => {});
      dvpBuildOk = true;
      console.log('[AFL cron] DvP build done (season', AFL_DVP_BUILD_SEASON + ', cached)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[AFL cron] DvP build failed:', msg);
      await fs.unlink(tmpDvpPath).catch(() => {});
    }

    // Run props-stats warm in-process so L5/L10/Season/DvP use the DvP we just cached.
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
