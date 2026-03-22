import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { filterAflPropsEligibleGames, refreshAflOddsData, setAflOddsCache } from '@/lib/refreshAflOdds';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';
import { runAflPropsStatsWarm } from '@/lib/aflPropsStatsWarm';
import {
  getAflDvpPayloadCacheKey,
  AFL_DVP_CACHE_TTL_SECONDS,
} from '@/lib/aflDvpCache';
import sharedCache from '@/lib/sharedCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AFL_DVP_BUILD_SEASON = 2026;
const AFL_DVP_BUILD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/afl/odds/refresh
 * Single cron: (1) fetches AFL game odds, (2) refreshes player props cache, (3) runs props-stats warm,
 * (4) builds AFL DvP dataset (script) so data/afl-dvp-{season}.json is up to date.
 * Odds cache is written only after player props refresh succeeds (including the empty-odds path, which clears props).
 * Failed runs leave prior caches in place.
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

    const propsEligibleGames = filterAflPropsEligibleGames(result.games ?? []);
    const ppResult = await refreshAflPlayerPropsCache(propsEligibleGames, {
      requireAllGames: true,
      atomicSwap: true,
    });
    console.log(
      '[AFL cron] Props refreshed – events:',
      `${ppResult.eventsRefreshed}/${ppResult.eventsAttempted}`,
      'failed:',
      ppResult.eventsFailed,
      'players:',
      ppResult.playersWithProps,
      'keysCleared:',
      ppResult.keysCleared ?? 0,
      ppResult.error ? `error: ${ppResult.error}` : 'OK',
    );

    if (!ppResult.success) {
      return NextResponse.json(
        {
          success: false,
          gamesCount: result.gamesCount,
          lastUpdated: result.lastUpdated,
          nextUpdate: result.nextUpdate,
          eventsRefreshed: ppResult.eventsRefreshed,
          eventsAttempted: ppResult.eventsAttempted,
          eventsFailed: ppResult.eventsFailed,
          failedGameIds: ppResult.failedGameIds ?? [],
          keysCleared: ppResult.keysCleared ?? 0,
          propsEligibleGames: propsEligibleGames.length,
          playersWithProps: ppResult.playersWithProps,
          playerPropsOk: false,
          playerPropsError: ppResult.error ?? 'AFL player props refresh returned no updates',
          message: 'Odds refreshed, but AFL player props full refresh did not complete for all games.',
        },
        { status: 502 }
      );
    }

    if (result.cachePayload) {
      await setAflOddsCache(result.cachePayload);
    }

    let dvpBuildOk = false;
    let statsWarmed: number | undefined;
    let statsFailed: number | undefined;
    let statsWarmError: string | undefined;

    try {
      const tmpDir = os.tmpdir();
      const tmpDvpPath = path.join(tmpDir, `afl-dvp-${AFL_DVP_BUILD_SEASON}.json`);
      try {
          const cwd = process.cwd();
          const scriptPath = path.join(cwd, 'scripts', 'build-afl-dvp.js');
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

      if (result.gamesCount > 0) {
        const warmBaseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
        const cronSecret = (process.env.CRON_SECRET ?? '').replace(/\r\n|\r|\n/g, '').trim();
        try {
          const warm = await runAflPropsStatsWarm(warmBaseUrl, { useListApi: false, cronSecret });
          statsWarmed = warm.warmed;
          statsFailed = warm.failed;
          console.log('[AFL cron] Props-stats warm done: warmed=', warm.warmed, 'failed (N/A)=', warm.failed, warm.success ? '' : warm.error ?? '');
          if (warm.error) statsWarmError = warm.error;
        } catch (e) {
          statsWarmError = e instanceof Error ? e.message : String(e);
          console.warn('[AFL cron] Props-stats warm failed:', statsWarmError);
        }
      }
    } catch (e) {
      console.warn('[AFL cron] DvP/warm error:', e instanceof Error ? e.message : String(e));
    }

    const responsePayload = {
      success: true,
      gamesCount: result.gamesCount,
      lastUpdated: result.lastUpdated,
      nextUpdate: result.nextUpdate,
      eventsRefreshed: ppResult.eventsRefreshed,
      eventsAttempted: ppResult.eventsAttempted,
      eventsFailed: ppResult.eventsFailed,
      failedGameIds: ppResult.failedGameIds ?? [],
      keysCleared: ppResult.keysCleared ?? 0,
      propsEligibleGames: propsEligibleGames.length,
      playersWithProps: ppResult.playersWithProps,
      playerNames: ppResult.playerNames ?? [],
      playerPropsOk: ppResult.success,
      playerPropsError: ppResult.error,
      dvpBuildOk,
      statsWarmed,
      statsFailed,
      statsWarmError,
      naSummaryHint: statsFailed != null && statsFailed > 0
        ? 'Call GET /api/afl/player-props/list?enrich=true&debugStats=1 for naSummary and naReasons (why props show N/A).'
        : undefined,
      message: ppResult.playerNames?.length
        ? `Odds updated. ${ppResult.playersWithProps} players, ${ppResult.eventsRefreshed} events. Stats warm: ${statsWarmed ?? '?'} warmed, ${statsFailed ?? 0} failed (N/A).`
        : 'Odds cache updated. Props refresh + DvP + stats warm completed.',
    };

    return NextResponse.json(responsePayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('[AFL cron] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
