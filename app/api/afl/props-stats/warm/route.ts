import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { listAflPlayerPropsFromCache } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats, getAflPropStatsCacheKey } from '@/lib/aflPropStatsCache';
import { getAflPlayerTeamMap, getAflPlayerTeamMapFromFiles } from '@/lib/aflPlayerTeamResolver';
import { loadDvpMaps, loadDvpMapsFromFiles, getDvpLookup } from '@/lib/aflDvpLookup';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Run this many getAflPropStats calls in parallel per batch. */
const BATCH_SIZE = 50;
/** How many batches to run concurrently (BATCH_SIZE * CONCURRENT_BATCHES in flight). */
const CONCURRENT_BATCHES = 2;
/** Warm every unique prop with odds (no cap) so all teams/players get stats. */
const MAX_PROPS = 50000;

type PropToWarm = { playerName: string; team: string; opponent: string; statType: string; line: number };

/**
 * GET /api/afl/props-stats/warm
 * Warms the AFL prop stats cache by fetching game logs and computing L5/L10/H2H/Season/Streak/DvP
 * for all current props from the list cache. Call after player-props/refresh (cron or workflow).
 * Protected by CRON_SECRET in production.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const origin = request.nextUrl?.origin ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const baseUrl = origin.startsWith('http') ? origin : `https://${origin}`;

  const useListApi = request.nextUrl?.searchParams?.get('useList') === '1';

  try {
    console.log('[AFL props-stats/warm] Starting... baseUrl=', baseUrl, 'useListApi=', useListApi);

    type ListRow = { playerName: string; homeTeam: string; awayTeam: string; statType: string; line: number; overOdds?: string; underOdds?: string };
    let rowsFromList: ListRow[] = [];
    let gamesCount = 0;

    if (useListApi) {
      try {
        const listUrl = `${baseUrl}/api/afl/player-props/list?enrich=false`;
        const listRes = await fetch(listUrl, { cache: 'no-store' });
        if (listRes.ok) {
          const listData = await listRes.json();
          rowsFromList = Array.isArray(listData?.data) ? listData.data : [];
          gamesCount = Array.isArray(listData?.games) ? listData.games.length : 0;
          console.log('[AFL props-stats/warm] List API returned', rowsFromList.length, 'rows,', gamesCount, 'games');
        }
      } catch (e) {
        console.warn('[AFL props-stats/warm] List API fetch failed, falling back to cache:', e);
      }
    }

    const result = useListApi && rowsFromList.length > 0
      ? { props: rowsFromList, games: [] as { gameId: string }[] }
      : await listAflPlayerPropsFromCache();

    if (!result?.props?.length) {
      console.log('[AFL props-stats/warm] No props in cache. Run /api/afl/odds/refresh first.');
      return NextResponse.json({
        success: true,
        warmed: 0,
        skipped: 0,
        message: 'No AFL props in cache. Run /api/afl/player-props/refresh first.',
      });
    }
    console.log('[AFL props-stats/warm] Props to consider:', result.props.length);

    const hasBoth = (r: { overOdds?: string; underOdds?: string }) => {
      const o = r.overOdds != null && String(r.overOdds).trim() !== '' && String(r.overOdds) !== 'N/A';
      const u = r.underOdds != null && String(r.underOdds).trim() !== '' && String(r.underOdds) !== 'N/A';
      return o && u;
    };

    let playerTeamMap = await getAflPlayerTeamMapFromFiles();
    if (playerTeamMap.size === 0) {
      playerTeamMap = await getAflPlayerTeamMap(baseUrl);
    }
    let dvpMaps = await loadDvpMapsFromFiles();
    if (dvpMaps.disposals.size === 0 && dvpMaps.goals.size === 0) {
      dvpMaps = await loadDvpMaps(baseUrl);
    }
    const getDvp = (opponent: string, statType: string) => getDvpLookup(opponent, statType, dvpMaps);
    console.log('[AFL props-stats/warm] DvP maps loaded (disposals:', dvpMaps.disposals.size, 'goals:', dvpMaps.goals.size, '). Player team map size:', playerTeamMap.size);

    const seen = new Set<string>();
    const toWarm: PropToWarm[] = [];
    for (const r of result.props) {
      if (!hasBoth(r)) continue;
      const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      if (seen.has(key)) continue;
      seen.add(key);
      toWarm.push({
        playerName: r.playerName,
        team: r.homeTeam,
        opponent: r.awayTeam,
        statType: r.statType,
        line: r.line,
      });
    }

    const toProcess = toWarm.slice(0, MAX_PROPS);
    const totalRowsFromCache = result.props.filter(hasBoth).length;
    console.log('[AFL props-stats/warm] Unique props to warm:', toProcess.length, '(skipped', Math.max(0, toWarm.length - MAX_PROPS), 'over limit). Rows with over/under:', totalRowsFromCache);

    const cronSecret = process.env.CRON_SECRET ?? '';
    let warmed = 0;
    const runBatch = (batch: PropToWarm[]) =>
      Promise.all(
        batch.map((p) => {
          const dvp = getDvp(p.opponent, p.statType);
          const resolvedTeam = playerTeamMap.get(normalizeAflPlayerNameForMatch(p.playerName)) ?? undefined;
          return getAflPropStats(p.playerName, p.team, p.opponent, p.statType, p.line, baseUrl, dvp, false, cronSecret, resolvedTeam).then((r) => {
            if (r) warmed++;
          }).catch((err) => {
            console.warn('[AFL props-stats/warm] getAflPropStats failed:', p.playerName, p.statType, err);
          });
        })
      );
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
      const batchPromises: Promise<unknown>[] = [];
      for (let b = 0; b < CONCURRENT_BATCHES; b++) {
        const start = i + b * BATCH_SIZE;
        if (start >= toProcess.length) break;
        const batch = toProcess.slice(start, start + BATCH_SIZE);
        if (batch.length) batchPromises.push(runBatch(batch));
      }
      await Promise.all(batchPromises);
      const done = Math.min(i + BATCH_SIZE * CONCURRENT_BATCHES, toProcess.length);
      if (done % 100 === 0 || done >= toProcess.length) {
        console.log('[AFL props-stats/warm] Progress:', done, '/', toProcess.length, 'warmed:', warmed);
      }
    }

    console.log('[AFL props-stats/warm] Done. Warmed', warmed, 'prop stats (with DvP). Reload props page to see them.');
    const message =
      toProcess.length < 50
        ? 'Run /api/afl/odds/refresh first so the props cache has all games (aim for eventsRefreshed = gamesCount). Use ?useList=1 to warm the exact rows the list API returns.'
        : undefined;
    return NextResponse.json({
      success: true,
      warmed,
      total: toProcess.length,
      skipped: Math.max(0, toWarm.length - MAX_PROPS),
      rowsFromCache: result.props.length,
      uniqueProps: toWarm.length,
      ...(useListApi ? { source: 'listApi' } : {}),
      ...(message ? { message } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AFL props-stats/warm]', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
