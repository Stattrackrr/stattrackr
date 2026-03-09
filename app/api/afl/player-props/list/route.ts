import { NextResponse } from 'next/server';
import { listAflPlayerPropsFromCache, type AflListPropRow } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats, getAflPropStatsCacheKey, type AflPropStatsDebug } from '@/lib/aflPropStatsCache';
import { getSharedCacheBackend } from '@/lib/sharedCache';
import { getAflPlayerTeamMapFromFiles } from '@/lib/aflPlayerTeamResolver';
import { getAflPlayerPositionMap, getAflPlayerTeamMapFromFantasy } from '@/lib/aflFantasyPositions';
import { loadDvpMapsFromFiles, getDvpLookup } from '@/lib/aflDvpLookup';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function hasOver(o: string) {
  return o != null && String(o).trim() !== '' && String(o) !== 'N/A';
}
function hasUnder(u: string) {
  return u != null && String(u).trim() !== '' && String(u) !== 'N/A';
}

/**
 * GET /api/afl/player-props/list
 * Reads from AFL props cache and attaches stats from stats cache. On cache miss, computes stats
 * so we never show 0 stats (L5/L10/Season/DvP etc). Stats cache is filled by the single AFL cron
 * (odds/refresh then props-stats warm). ?enrich=false returns raw rows without stats (for warm to use).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const enrich = searchParams.get('enrich') !== 'false';
    const debugStats = searchParams.get('debugStats') === '1';

    const result = await listAflPlayerPropsFromCache();
    if (!result) {
      return NextResponse.json({
        success: true,
        data: [],
        games: [],
        message: 'No AFL player props in cache. Run /api/afl/odds/refresh to populate.',
      });
    }
    const rows = result.props.filter((r) => hasOver(r.overOdds) && hasUnder(r.underOdds));
    const gamesPayload = result.games.map((g) => ({
      gameId: g.gameId,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      commenceTime: g.commenceTime,
    }));

    if (!enrich) {
      return NextResponse.json({
        success: true,
        data: rows,
        games: gamesPayload,
        _meta: { rowsFromList: rows.length, enrich: false },
      });
    }

    const baseUrl =
      typeof request.url === 'string'
        ? new URL(request.url).origin
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
    let playerTeamMap = await getAflPlayerTeamMapFromFiles();
    const seasonForTeam = new Date().getFullYear();
    const fantasyTeamMap = await getAflPlayerTeamMapFromFantasy(seasonForTeam);
    const resolvePlayerTeam = (name: string) =>
      playerTeamMap.get(normalizeAflPlayerNameForMatch(name)) ?? fantasyTeamMap.get(normalizeAflPlayerNameForMatch(name)) ?? null;
    const uniqueCacheKeys = new Set<string>();
    const paramsByCacheKey = new Map<string, { playerName: string; homeTeam: string; awayTeam: string; statType: string; line: number }>();
    for (const r of rows) {
      const ck = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      uniqueCacheKeys.add(ck);
      if (!paramsByCacheKey.has(ck)) {
        paramsByCacheKey.set(ck, { playerName: r.playerName, homeTeam: r.homeTeam, awayTeam: r.awayTeam, statType: r.statType, line: r.line });
      }
    }
    const statsByKey = new Map<string, Awaited<ReturnType<typeof getAflPropStats>>>();
    const debugByKey = debugStats ? new Map<string, AflPropStatsDebug>() : null;
    // 1) Try cache only for every unique prop
    await Promise.all(
      Array.from(uniqueCacheKeys).map(async (cacheKey) => {
        const p = paramsByCacheKey.get(cacheKey);
        if (!p) return;
        const debug = debugByKey ? ({ fromCache: false, gamesCount: 0 } as AflPropStatsDebug) : undefined;
        if (debugByKey) debugByKey.set(cacheKey, debug!);
        let stats = await getAflPropStats(p.playerName, p.homeTeam, p.awayTeam, p.statType, p.line, baseUrl, null, true, undefined, undefined, debug);
        if (!stats) {
          stats = await getAflPropStats(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line, baseUrl, null, true, undefined, undefined, debug);
        }
        if (stats) {
          statsByKey.set(cacheKey, stats);
          const keyReverse = getAflPropStatsCacheKey(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line);
          if (keyReverse !== cacheKey) statsByKey.set(keyReverse, stats);
        }
      })
    );
    // 2) On cache miss: compute so we never show 0 stats (load DvP when needed; playerTeamMap already loaded)
    const missedKeys = Array.from(uniqueCacheKeys).filter((k) => !statsByKey.has(k));
    const teamMatches = (a: string, b: string) => {
      const x = (a ?? '').trim().toLowerCase();
      const y = (b ?? '').trim().toLowerCase();
      return (x && y) && (x === y || x.includes(y) || y.includes(x));
    };
    if (missedKeys.length > 0) {
      const dvpMaps = await loadDvpMapsFromFiles();
      const season = new Date().getFullYear();
      let positionMap = await getAflPlayerPositionMap(season);
      if (positionMap.size === 0) positionMap = await getAflPlayerPositionMap(season - 1);
      const getDvp = (opponent: string, statType: string, position?: string | null) => getDvpLookup(opponent, statType, dvpMaps, position);
      await Promise.all(
        missedKeys.map(async (cacheKey) => {
          const p = paramsByCacheKey.get(cacheKey);
          if (!p) return;
          const debug = debugByKey?.get(cacheKey) ?? undefined;
          const resolvedTeam = resolvePlayerTeam(p.playerName) ?? undefined;
          const opponent = resolvedTeam && teamMatches(resolvedTeam, p.homeTeam) ? p.awayTeam : (resolvedTeam && teamMatches(resolvedTeam, p.awayTeam) ? p.homeTeam : undefined);
          const playerTeam = resolvedTeam ?? p.homeTeam;
          const position = positionMap.get(normalizeAflPlayerNameForMatch(p.playerName)) ?? undefined;
          const dvp = opponent != null ? getDvp(opponent, p.statType, position) : null;
          let stats = opponent != null
            ? await getAflPropStats(p.playerName, playerTeam, opponent, p.statType, p.line, baseUrl, dvp, false, undefined, resolvedTeam, debug)
            : null;
          if (!stats) {
            const dvpHomeAway = getDvp(p.awayTeam, p.statType, position);
            stats = await getAflPropStats(p.playerName, p.homeTeam, p.awayTeam, p.statType, p.line, baseUrl, dvpHomeAway, false, undefined, resolvedTeam, debug);
          }
          if (!stats) {
            const dvpAwayHome = getDvp(p.homeTeam, p.statType, position);
            stats = await getAflPropStats(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line, baseUrl, dvpAwayHome, false, undefined, resolvedTeam, debug);
          }
          if (stats) {
            statsByKey.set(cacheKey, stats);
            const keyReverse = getAflPropStatsCacheKey(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line);
            if (keyReverse !== cacheKey) statsByKey.set(keyReverse, stats);
          }
        })
      );
    }
    // Always override DvP from current position-aware lookup so we never show stale "everyone 6"
    const dvpMapsForOverride = await loadDvpMapsFromFiles();
    const seasonForPos = new Date().getFullYear();
    let positionMapForOverride = await getAflPlayerPositionMap(seasonForPos);
    if (positionMapForOverride.size === 0) positionMapForOverride = await getAflPlayerPositionMap(seasonForPos - 1);
    const getDvpOverride = (opponent: string, statType: string, position?: string | null) =>
      getDvpLookup(opponent, statType, dvpMapsForOverride, position);
    const teamMatchesOverride = (a: string, b: string) => {
      const x = (a ?? '').trim().toLowerCase();
      const y = (b ?? '').trim().toLowerCase();
      return (x && y) && (x === y || x.includes(y) || y.includes(x));
    };
    const enrichedRows: (AflListPropRow & Record<string, unknown>)[] = rows.map((r) => {
      const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      const keyAlt = getAflPropStatsCacheKey(r.playerName, r.awayTeam, r.homeTeam, r.statType, r.line);
      const stats = statsByKey.get(key) ?? statsByKey.get(keyAlt);
      const playerTeam = resolvePlayerTeam(r.playerName);
      const opponent =
        playerTeam && teamMatchesOverride(playerTeam, r.homeTeam)
          ? r.awayTeam
          : playerTeam && teamMatchesOverride(playerTeam, r.awayTeam)
            ? r.homeTeam
            : r.awayTeam;
      const position = positionMapForOverride.get(normalizeAflPlayerNameForMatch(r.playerName)) ?? undefined;
      const dvpLookupResult = getDvpOverride(opponent, r.statType, position);
      const dvpRating = dvpLookupResult?.rank ?? stats?.dvpRating ?? null;
      const dvpStatValue = dvpLookupResult?.value ?? stats?.dvpStatValue ?? null;
      const baseRow = {
        ...r,
        playerTeam: playerTeam ?? undefined,
        last5Avg: stats?.last5Avg,
        last10Avg: stats?.last10Avg,
        h2hAvg: stats?.h2hAvg,
        seasonAvg: stats?.seasonAvg,
        streak: stats?.streak,
        last5HitRate: stats?.last5HitRate,
        last10HitRate: stats?.last10HitRate,
        h2hHitRate: stats?.h2hHitRate,
        seasonHitRate: stats?.seasonHitRate,
        dvpRating,
        dvpStatValue,
      };
      return baseRow;
    });
    const rowsWithStats = enrichedRows.filter((r) => r.last5Avg != null || r.seasonAvg != null);
    const rowsNa = enrichedRows.filter((r) => r.last5Avg == null && r.seasonAvg == null);
    const payload: Record<string, unknown> = {
      success: true,
      data: enrichedRows,
      games: gamesPayload,
    };
    if (debugStats) {
      const cacheHits = uniqueCacheKeys.size - missedKeys.length;
      const cacheMisses = missedKeys.length;
      console.log('[AFL list debugStats]', {
        uniqueCacheKeys: uniqueCacheKeys.size,
        cacheHits,
        cacheMisses,
        rowsWithStats: rowsWithStats.length,
        rowsNa: rowsNa.length,
        totalRows: rows.length,
        cacheBackend: getSharedCacheBackend(),
      });
      const debugNa = debugByKey
        ? rowsNa.slice(0, 80).map((r) => {
            const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
            const d = debugByKey.get(key);
            const reason =
              !d
                ? 'no_debug'
                : d.fromCache && d.gamesCount === -1
                  ? 'cached_but_empty (cache had entry with null stats)'
                  : !d.fromCache && d.gamesCount === 0
                    ? 'computed_0_games (player-game-logs returned empty for both seasons)'
                    : !d.fromCache && d.gamesCount > 0
                      ? 'computed_has_games_but_nulls (bug?)'
                      : `fromCache=${d.fromCache} gamesCount=${d.gamesCount}`;
            return {
              playerName: r.playerName,
              statType: r.statType,
              line: r.line,
              homeTeam: r.homeTeam,
              awayTeam: r.awayTeam,
              fromCache: d?.fromCache ?? null,
              gamesCount: d?.gamesCount ?? null,
              reason,
            };
          })
        : [];
      payload._meta = {
        uniqueCacheKeys: uniqueCacheKeys.size,
        cacheHits,
        cacheMisses,
        rowsWithStats: rowsWithStats.length,
        rowsNa: rowsNa.length,
        totalRows: rows.length,
        cacheBackend: getSharedCacheBackend(),
        debugNa,
        hint:
          getSharedCacheBackend() === 'memory' && cacheMisses > 0
            ? 'Stats cache is in-memory (per process). Warm and list may run in different processes, so only some keys are found. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local to use Redis and share cache across all requests.'
            : undefined,
      };
    }
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [], games: [] }, { status: 500 });
  }
}
