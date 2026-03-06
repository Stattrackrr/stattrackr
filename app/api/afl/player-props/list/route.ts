import { NextRequest, NextResponse } from 'next/server';
import { listAflPlayerPropsFromCache, type AflListPropRow } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats } from '@/lib/aflPropStatsCache';
import { getAflPlayerTeamMap, resolveTeamAndOpponent } from '@/lib/aflPlayerTeamResolver';
import { loadDvpMaps, getDvpLookup } from '@/lib/aflDvpLookup';

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
 * Returns all cached AFL player props with L5/L10/H2H/Season/Streak from cache only (no FootyWire, no compute).
 * Cron props-stats/warm fills the stats cache; this route just reads it for a fast response.
 */
export async function GET(request: NextRequest) {
  try {
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
    const origin = request.nextUrl?.origin ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const baseUrl = origin.startsWith('http') ? origin : `https://${origin}`;

    const uniqueKeys = new Set<string>();
    for (const r of rows) {
      uniqueKeys.add(`${r.playerName}|${r.homeTeam}|${r.awayTeam}|${r.statType}|${r.line}`);
    }
    const [dvpMaps, playerTeamMap] = await Promise.all([
      loadDvpMaps(baseUrl),
      getAflPlayerTeamMap(baseUrl),
    ]);
    console.log('[AFL player-props/list] DvP maps: disposals=', dvpMaps.disposals.size, 'goals=', dvpMaps.goals.size, '| unique props=', uniqueKeys.size);
    const statsByKey = new Map<string, Awaited<ReturnType<typeof getAflPropStats>>>();
    await Promise.all(
      Array.from(uniqueKeys).map(async (rowKey) => {
        const parts = rowKey.split('|');
        if (parts.length < 5) return;
        const lineStr = parts.pop()!;
        const statType = parts.pop()!;
        const awayTeam = parts.pop()!;
        const homeTeam = parts.pop()!;
        const playerName = parts.join('|');
        const line = Number(lineStr);
        const resolved = resolveTeamAndOpponent(playerName, homeTeam, awayTeam, playerTeamMap);
        let team: string;
        let opponent: string;
        let dvp: ReturnType<typeof getDvpLookup>;
        if (resolved) {
          team = resolved.team;
          opponent = resolved.opponent;
          dvp = getDvpLookup(opponent, statType, dvpMaps);
          // Cache only: no FootyWire, no compute. Cron (props-stats/warm) fills the cache.
          const stats = await getAflPropStats(playerName, team, opponent, statType, line, baseUrl, dvp, true);
          if (stats) statsByKey.set(rowKey, stats);
          return;
        }
        dvp = getDvpLookup(awayTeam, statType, dvpMaps);
        let stats = await getAflPropStats(playerName, homeTeam, awayTeam, statType, line, baseUrl, dvp, true);
        if (!stats) {
          dvp = getDvpLookup(homeTeam, statType, dvpMaps);
          stats = await getAflPropStats(playerName, awayTeam, homeTeam, statType, line, baseUrl, dvp, true);
        }
        if (stats) statsByKey.set(rowKey, stats);
      })
    );

    const enrichedRows: (AflListPropRow & Record<string, unknown>)[] = rows.map((r) => {
      const key = `${r.playerName}|${r.homeTeam}|${r.awayTeam}|${r.statType}|${r.line}`;
      const stats = statsByKey.get(key);
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

    const withDvp = enrichedRows.filter((r) => typeof r.dvpRating === 'number' && r.dvpRating > 0).length;
    console.log('[AFL player-props/list] Enriched', enrichedRows.length, 'rows,', withDvp, 'with DvP');
    return NextResponse.json({
      success: true,
      data: enrichedRows,
      games: result.games.map((g) => ({
        gameId: g.gameId,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        commenceTime: g.commenceTime,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [], games: [] }, { status: 500 });
  }
}
