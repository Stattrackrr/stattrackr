import { NextResponse } from 'next/server';
import { listAflPlayerPropsFromCache, type AflListPropRow } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats } from '@/lib/aflPropStatsCache';

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
 * Reads from AFL props cache and attaches stats from stats cache only (no computation).
 * Stats cache is filled by props-stats/warm cron (which now uses file-based DvP/league data so cron works).
 */
export async function GET() {
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
    const baseUrl = '';
    const uniqueKeys = new Set<string>();
    for (const r of rows) {
      uniqueKeys.add(`${r.playerName}|${r.homeTeam}|${r.awayTeam}|${r.statType}|${r.line}`);
    }
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
        let stats = await getAflPropStats(playerName, homeTeam, awayTeam, statType, line, baseUrl, null, true);
        if (!stats) {
          stats = await getAflPropStats(playerName, awayTeam, homeTeam, statType, line, baseUrl, null, true);
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
