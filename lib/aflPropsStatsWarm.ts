/**
 * Shared logic for warming AFL prop stats cache (L5/L10/H2H/Season/Streak/DvP).
 * Used by /api/afl/props-stats/warm and in-process by /api/afl/odds/refresh so we never hit 401 on internal fetch.
 */

import { listAflPlayerPropsFromCache } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats, getAflPropStatsCacheKey } from '@/lib/aflPropStatsCache';
import { getAflPlayerTeamMap, getAflPlayerTeamMapFromFiles } from '@/lib/aflPlayerTeamResolver';
import { loadDvpMaps, loadDvpMapsFromFiles, getDvpLookup } from '@/lib/aflDvpLookup';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

const BATCH_SIZE = 50;
const CONCURRENT_BATCHES = 2;
const MAX_PROPS = 50000;

type PropToWarm = { playerName: string; team: string; opponent: string; statType: string; line: number };

export type RunAflPropsStatsWarmOptions = {
  useListApi?: boolean;
  cronSecret?: string;
};

export type RunAflPropsStatsWarmResult = {
  success: boolean;
  warmed: number;
  total?: number;
  skipped?: number;
  rowsFromCache?: number;
  uniqueProps?: number;
  error?: string;
};

function hasBoth(r: { overOdds?: string; underOdds?: string }): boolean {
  const o = r.overOdds != null && String(r.overOdds).trim() !== '' && String(r.overOdds) !== 'N/A';
  const u = r.underOdds != null && String(r.underOdds).trim() !== '' && String(r.underOdds) !== 'N/A';
  return o && u;
}

/**
 * Run the props-stats warm: load props (from list API or cache), then compute and cache L5/L10/Season/DvP for each.
 * Call in-process from odds/refresh to avoid internal HTTP 401; also used by GET /api/afl/props-stats/warm.
 */
export async function runAflPropsStatsWarm(
  baseUrl: string,
  options: RunAflPropsStatsWarmOptions = {}
): Promise<RunAflPropsStatsWarmResult> {
  const { useListApi = false, cronSecret = process.env.CRON_SECRET ?? '' } = options;
  const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;

  try {
    console.log('[AFL props-stats/warm] Starting... baseUrl=', url, 'useListApi=', useListApi);

    type ListRow = { playerName: string; homeTeam: string; awayTeam: string; statType: string; line: number; overOdds?: string; underOdds?: string };
    let rowsFromList: ListRow[] = [];
    let gamesCount = 0;

    if (useListApi) {
      try {
        const listUrl = `${url}/api/afl/player-props/list?enrich=false`;
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
      return { success: true, warmed: 0, skipped: 0 };
    }
    console.log('[AFL props-stats/warm] Props to consider:', result.props.length);

    let playerTeamMap = await getAflPlayerTeamMapFromFiles();
    if (playerTeamMap.size === 0) {
      playerTeamMap = await getAflPlayerTeamMap(url);
    }
    let dvpMaps = await loadDvpMapsFromFiles();
    if (dvpMaps.disposals.size === 0 && dvpMaps.goals.size === 0) {
      dvpMaps = await loadDvpMaps(url);
    }
    const teamMatches = (a: string, b: string) => {
      const x = (a ?? '').trim().toLowerCase();
      const y = (b ?? '').trim().toLowerCase();
      return (x && y) && (x === y || x.includes(y) || y.includes(x));
    };
    const getDvp = (opponent: string, statType: string, position?: string | null) => getDvpLookup(opponent, statType, dvpMaps, position);
    console.log('[AFL props-stats/warm] DvP maps loaded (disposals:', dvpMaps.disposals.size, 'goals:', dvpMaps.goals.size, '). Player team map size:', playerTeamMap.size);

    const seen = new Set<string>();
    const toWarm: PropToWarm[] = [];
    for (const r of result.props) {
      if (!hasBoth(r)) continue;
      const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      if (seen.has(key)) continue;
      seen.add(key);
      const resolvedTeam = playerTeamMap.get(normalizeAflPlayerNameForMatch(r.playerName)) ?? null;
      const playerTeam = resolvedTeam ?? r.homeTeam;
      const opponent = resolvedTeam && teamMatches(resolvedTeam, r.homeTeam) ? r.awayTeam : (resolvedTeam && teamMatches(resolvedTeam, r.awayTeam) ? r.homeTeam : r.awayTeam);
      toWarm.push({
        playerName: r.playerName,
        team: playerTeam,
        opponent,
        statType: r.statType,
        line: r.line,
      });
    }

    const toProcess = toWarm.slice(0, MAX_PROPS);
    const totalRowsFromCache = result.props.filter(hasBoth).length;
    console.log('[AFL props-stats/warm] Unique props to warm:', toProcess.length, '(skipped', Math.max(0, toWarm.length - MAX_PROPS), 'over limit). Rows with over/under:', totalRowsFromCache);

    let warmed = 0;
    const runBatch = (batch: PropToWarm[]) =>
      Promise.all(
        batch.map((p) => {
          const dvp = getDvp(p.opponent, p.statType, undefined);
          const resolvedTeam = playerTeamMap.get(normalizeAflPlayerNameForMatch(p.playerName)) ?? undefined;
          return getAflPropStats(p.playerName, p.team, p.opponent, p.statType, p.line, url, dvp, false, cronSecret, resolvedTeam).then((r) => {
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

    console.log('[AFL props-stats/warm] Done. Warmed', warmed, 'prop stats (with DvP).');
    return {
      success: true,
      warmed,
      total: toProcess.length,
      skipped: Math.max(0, toWarm.length - MAX_PROPS),
      rowsFromCache: result.props.length,
      uniqueProps: toWarm.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AFL props-stats/warm]', err);
    return { success: false, warmed: 0, error: message };
  }
}
