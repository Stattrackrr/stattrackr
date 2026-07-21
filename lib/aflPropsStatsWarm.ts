/**
 * Shared logic for warming AFL prop stats cache (L5/L10/H2H/Season/Streak/DvP).
 * Used by /api/afl/props-stats/warm and in-process by /api/afl/odds/refresh so we never hit 401 on internal fetch.
 */

import { listAflPlayerPropsFromCache } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats, getAflPropStatsCacheKey } from '@/lib/aflPropStatsCache';
import { getAflPlayerTeamMap, getAflPlayerTeamMapFromFiles } from '@/lib/aflPlayerTeamResolver';
import { loadDvpMaps, loadDvpMapsFromFiles, getDvpLookupTeamTotal, DVP_MATCHUP_SEASON } from '@/lib/aflDvpLookup';
import { getAflPlayerPositionMap, getAflPlayerTeamMapFromFantasy } from '@/lib/aflFantasyPositions';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { findDfsRolePlayer, loadDfsRolePlayers, normalizeFantasyPositionToDvp } from '@/lib/aflDfsRoleMap';

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
  failed: number;
  noData: number;
  total?: number;
  skipped?: number;
  rowsFromCache?: number;
  uniqueProps?: number;
  coveragePct?: number;
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
 *
 * When called from the cron (odds/refresh), use useListApi: false so we read from listAflPlayerPropsFromCache()
 * in the same process. Using useListApi: true would fetch /api/afl/player-props/list over HTTP, which can hit
 * another serverless instance with stale or empty cache (e.g. in-memory), so new games/matchups would never
 * get their stats warmed and the props page would show N/A for L5/L10/Season/Streak.
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
      return { success: true, warmed: 0, failed: 0, noData: 0, skipped: 0, coveragePct: 100 };
    }
    console.log('[AFL props-stats/warm] Props to consider:', result.props.length);

    let playerTeamMap = await getAflPlayerTeamMapFromFiles();
    if (playerTeamMap.size === 0) {
      playerTeamMap = await getAflPlayerTeamMap(url);
    }
    const season = new Date().getFullYear();
    const fantasyTeamMap = await getAflPlayerTeamMapFromFantasy(season);
    const resolvePlayerTeam = (name: string) =>
      playerTeamMap.get(normalizeAflPlayerNameForMatch(name)) ?? fantasyTeamMap.get(normalizeAflPlayerNameForMatch(name)) ?? null;
    let dvpMaps = await loadDvpMapsFromFiles(DVP_MATCHUP_SEASON);
    if (dvpMaps.disposals.size === 0 && dvpMaps.goals.size === 0) {
      dvpMaps = await loadDvpMaps(url);
    }
    let positionMap = await getAflPlayerPositionMap(season);
    if (positionMap.size === 0) positionMap = await getAflPlayerPositionMap(season - 1);
    const dfsPlayers = await loadDfsRolePlayers();
    const teamMatches = (a: string, b: string) => {
      const officialA = (a ?? '').trim() ? toOfficialAflTeamDisplayName((a ?? '').trim()) : '';
      const officialB = (b ?? '').trim() ? toOfficialAflTeamDisplayName((b ?? '').trim()) : '';
      return (officialA && officialB) && officialA === officialB;
    };
    const getDvp = (opponent: string, statType: string, preferredPosition?: string | null, fantasyPosition?: string | null) => {
      const preferred = getDvpLookupTeamTotal(opponent, statType, dvpMaps, preferredPosition);
      if (preferred) return preferred;
      if (fantasyPosition && fantasyPosition !== preferredPosition) {
        return getDvpLookupTeamTotal(opponent, statType, dvpMaps, fantasyPosition);
      }
      return null;
    };
    console.log('[AFL props-stats/warm] DvP maps loaded (disposals:', dvpMaps.disposals.size, 'goals:', dvpMaps.goals.size, '). Player team map:', playerTeamMap.size, 'position map:', positionMap.size);

    const seen = new Set<string>();
    const toWarm: PropToWarm[] = [];
    for (const r of result.props) {
      if (!hasBoth(r)) continue;
      const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      if (seen.has(key)) continue;
      seen.add(key);
      const resolvedTeam = resolvePlayerTeam(r.playerName);
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
    let failed = 0;
    let noData = 0;
    let errored = 0;
    const runBatch = (batch: PropToWarm[]) =>
      Promise.all(
        batch.map((p) => {
          const fantasyPosition = normalizeFantasyPositionToDvp(
            positionMap.get(normalizeAflPlayerNameForMatch(p.playerName)) ?? 'MID'
          );
          const dfsP = findDfsRolePlayer(dfsPlayers, p.playerName);
          const preferredPosition = dfsP?.roleBucket != null ? dfsP.roleBucket : fantasyPosition;
          const dvp = getDvp(p.opponent, p.statType, preferredPosition, fantasyPosition);
          const resolvedTeam = resolvePlayerTeam(p.playerName) ?? undefined;
          return getAflPropStats(p.playerName, p.team, p.opponent, p.statType, p.line, url, dvp, false, cronSecret, resolvedTeam).then((r) => {
            if (!r) {
              failed++;
              errored++;
              return;
            }
            const hasStats =
              r.last5Avg != null ||
              r.last10Avg != null ||
              r.h2hAvg != null ||
              r.seasonAvg != null ||
              r.streak != null ||
              r.last5HitRate != null ||
              r.last10HitRate != null ||
              r.h2hHitRate != null ||
              r.seasonHitRate != null ||
              r.dvpRating != null;
            if (hasStats) warmed++;
            else {
              failed++;
              noData++;
            }
          }).catch((err) => {
            failed++;
            errored++;
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

    const coveragePct = toProcess.length > 0 ? Math.round((warmed / toProcess.length) * 100) : 100;
    console.log(
      '[AFL props-stats/warm] Done. Warmed',
      warmed,
      '| No data:',
      noData,
      '| Errors:',
      errored,
      '| Coverage:',
      `${coveragePct}%`,
      '| Total processed:',
      toProcess.length,
    );
    return {
      success: true,
      warmed,
      failed,
      noData,
      total: toProcess.length,
      skipped: Math.max(0, toWarm.length - MAX_PROPS),
      rowsFromCache: result.props.length,
      uniqueProps: toWarm.length,
      coveragePct,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AFL props-stats/warm]', err);
    return { success: false, warmed: 0, failed: 0, noData: 0, coveragePct: 0, error: message };
  }
}
