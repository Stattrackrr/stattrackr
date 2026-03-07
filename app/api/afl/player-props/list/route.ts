import { NextResponse } from 'next/server';
import { listAflPlayerPropsFromCache, type AflListPropRow } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats, getAflPropStatsCacheKey } from '@/lib/aflPropStatsCache';
import { getSharedCacheBackend } from '@/lib/sharedCache';
import { getAflPlayerTeamMapFromFiles } from '@/lib/aflPlayerTeamResolver';
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
    // 1) Try cache only for every unique prop
    await Promise.all(
      Array.from(uniqueCacheKeys).map(async (cacheKey) => {
        const p = paramsByCacheKey.get(cacheKey);
        if (!p) return;
        let stats = await getAflPropStats(p.playerName, p.homeTeam, p.awayTeam, p.statType, p.line, baseUrl, null, true);
        if (!stats) {
          stats = await getAflPropStats(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line, baseUrl, null, true);
        }
        if (stats) {
          statsByKey.set(cacheKey, stats);
          const keyReverse = getAflPropStatsCacheKey(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line);
          if (keyReverse !== cacheKey) statsByKey.set(keyReverse, stats);
        }
      })
    );
    // 2) On cache miss: compute so we never show 0 stats (load DvP + player team only when needed)
    const missedKeys = Array.from(uniqueCacheKeys).filter((k) => !statsByKey.has(k));
    if (missedKeys.length > 0) {
      const [playerTeamMap, dvpMaps] = await Promise.all([getAflPlayerTeamMapFromFiles(), loadDvpMapsFromFiles()]);
      const getDvp = (opponent: string, statType: string) => getDvpLookup(opponent, statType, dvpMaps);
      await Promise.all(
        missedKeys.map(async (cacheKey) => {
          const p = paramsByCacheKey.get(cacheKey);
          if (!p) return;
          const resolvedTeam = playerTeamMap.get(normalizeAflPlayerNameForMatch(p.playerName)) ?? undefined;
          const dvpHomeAway = getDvp(p.awayTeam, p.statType);
          let stats = await getAflPropStats(p.playerName, p.homeTeam, p.awayTeam, p.statType, p.line, baseUrl, dvpHomeAway, false, undefined, resolvedTeam);
          if (!stats) {
            const dvpAwayHome = getDvp(p.homeTeam, p.statType);
            stats = await getAflPropStats(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line, baseUrl, dvpAwayHome, false, undefined, resolvedTeam);
          }
          if (stats) {
            statsByKey.set(cacheKey, stats);
            const keyReverse = getAflPropStatsCacheKey(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line);
            if (keyReverse !== cacheKey) statsByKey.set(keyReverse, stats);
          }
        })
      );
    }
    const enrichedRows: (AflListPropRow & Record<string, unknown>)[] = rows.map((r) => {
      const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      const keyAlt = getAflPropStatsCacheKey(r.playerName, r.awayTeam, r.homeTeam, r.statType, r.line);
      const stats = statsByKey.get(key) ?? statsByKey.get(keyAlt);
      if (!stats) return r;
      return {
        ...r,
        last5Avg: stats.last5Avg,
        last10Avg: stats.last10Avg,
        h2hAvg: stats.h2hAvg,
        seasonAvg: stats.seasonAvg,
        streak: stats.streak,
        last5HitRate: stats.last5HitRate,
        last10HitRate: stats.last10HitRate,
        h2hHitRate: stats.h2hHitRate,
        seasonHitRate: stats.seasonHitRate,
        dvpRating: stats.dvpRating,
        dvpStatValue: stats.dvpStatValue,
      };
    });
    const rowsWithStats = enrichedRows.filter((r) => r.last5Avg != null || r.seasonAvg != null);
    const payload: Record<string, unknown> = {
      success: true,
      data: enrichedRows,
      games: gamesPayload,
    };
    if (debugStats) {
      payload._meta = {
        uniqueCacheKeys: uniqueCacheKeys.size,
        cacheHits: statsByKey.size,
        rowsWithStats: rowsWithStats.length,
        totalRows: rows.length,
        cacheBackend: getSharedCacheBackend(),
        hint:
          getSharedCacheBackend() === 'memory' && statsByKey.size < uniqueCacheKeys.size
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
