import { NextRequest, NextResponse } from 'next/server';
import { listAflPlayerPropsFromCache, type AflListPropRow } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats } from '@/lib/aflPropStatsCache';
import { getAflPlayerTeamMap, resolveTeamAndOpponent } from '@/lib/aflPlayerTeamResolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function hasOver(o: string) {
  return o != null && String(o).trim() !== '' && String(o) !== 'N/A';
}
function hasUnder(u: string) {
  return u != null && String(u).trim() !== '' && String(u) !== 'N/A';
}

async function loadDvpMaps(origin: string): Promise<{ disposals: Map<string, { rank: number; value: number }>; goals: Map<string, { rank: number; value: number }> }> {
  const season = new Date().getFullYear();
  const build = (data: { rows?: Array<{ opponent?: string; rank?: number; value?: number }> } | null) => {
    const map = new Map<string, { rank: number; value: number }>();
    if (!data?.rows) return map;
    for (const row of data.rows) {
      const key = (row.opponent || '').trim().toLowerCase();
      if (!key) continue;
      const rank = typeof row.rank === 'number' ? row.rank : 0;
      const value = typeof row.value === 'number' ? row.value : 0;
      const existing = map.get(key);
      if (!existing || rank < existing.rank) map.set(key, { rank, value });
    }
    return map;
  };
  const [disp, goals] = await Promise.all([
    fetch(`${origin}/api/afl/dvp?season=${season}&stat=disposals&order=desc&top=100`).then((r) => (r.ok ? r.json() : null)),
    fetch(`${origin}/api/afl/dvp?season=${season}&stat=goals&order=desc&top=100`).then((r) => (r.ok ? r.json() : null)),
  ]);
  return { disposals: build(disp), goals: build(goals) };
}

function getDvpLookup(
  opponent: string,
  statType: string,
  maps: { disposals: Map<string, { rank: number; value: number }>; goals: Map<string, { rank: number; value: number }> }
): { rank: number; value: number } | null {
  const opp = (opponent || '').trim().toLowerCase();
  const m = statType === 'goals_over' ? maps.goals : maps.disposals;
  const exact = m.get(opp);
  if (exact) return exact;
  const entry = Array.from(m.entries()).find(([team]) => team.includes(opp) || opp.includes(team));
  return entry ? entry[1] : null;
}

/**
 * GET /api/afl/player-props/list
 * Returns all cached AFL player props with stats from cache (read-only, no computation).
 * Same behaviour as NBA: one response, no loading on the page.
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
