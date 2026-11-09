/**
 * Build per-game opponent defence ranks for NBL chart Advanced filter.
 * Current season only. Tip-time STE allowed ranks (no live paste onto past games).
 */

import type { NblGameFilterDataItem } from '@/app/nbl/components/NblGameFilters';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';
import { resolveNblSteTeamCode, type NblSteStatKey } from '@/lib/nbl/teamSteStatsShared';

const STAT_TO_STE: Record<string, NblSteStatKey> = {
  points: 'pts',
  pts: 'pts',
  q1_pts: 'pts',
  q2_pts: 'pts',
  q3_pts: 'pts',
  q4_pts: 'pts',
  rebounds: 'reb',
  reb: 'reb',
  q1_reb: 'reb',
  q2_reb: 'reb',
  q3_reb: 'reb',
  q4_reb: 'reb',
  assists: 'ast',
  ast: 'ast',
  q1_ast: 'ast',
  q2_ast: 'ast',
  q3_ast: 'ast',
  q4_ast: 'ast',
  steals: 'stl',
  stl: 'stl',
  blocks: 'blk',
  blk: 'blk',
  threeMade: 'fg3_pct',
  fg3m: 'fg3_pct',
  fg_pct: 'fg_pct',
  pra: 'pts',
  pr: 'pts',
  pa: 'pts',
  ra: 'reb',
};

export function nblChartStatToSteMetric(stat: string | null | undefined): NblSteStatKey {
  const key = String(stat || '').trim();
  return STAT_TO_STE[key] || 'pts';
}

type LogLike = {
  matchId?: string | null;
  date?: string | null;
  opponent?: string | null;
  opponentCode?: string | null;
  minutes?: number | null;
  season?: number | null;
  year?: number | null;
};

type SnapshotRow = { snapshotDate: string; ranks: Record<string, number> };

function isNblSeasonLog(g: LogLike, year: number): boolean {
  if (typeof g.season === 'number' && Number.isFinite(g.season)) return g.season === year;
  if (typeof g.year === 'number' && Number.isFinite(g.year)) return g.year === year;
  const date = String(g.date || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    if (m >= 8) return y === year;
    return y - 1 === year || y === year;
  }
  return false;
}

function rankAsOf(snapshots: SnapshotRow[], gameDate: string, team: string): number | null {
  if (!snapshots.length || !team) return null;
  let chosen: SnapshotRow | null = null;
  for (const snap of snapshots) {
    if (snap.snapshotDate <= gameDate) chosen = snap;
    else break;
  }
  if (!chosen) return null;
  const rank = chosen.ranks[team];
  return typeof rank === 'number' && rank > 0 ? rank : null;
}

export async function buildNblPerGameDefenseRanks(params: {
  logs: LogLike[];
  year: number;
  metric?: NblSteStatKey;
}): Promise<NblGameFilterDataItem[]> {
  if (!params.logs.length) return [];
  const metric = params.metric || 'pts';
  const year = Number.isFinite(params.year) ? params.year : NBL_CURRENT_SEASON_YEAR;

  let snapshots: SnapshotRow[] = [];
  try {
    const res = await fetch(
      `/api/nbl/team-ste-stats/history?year=${year}&metric=${encodeURIComponent(metric)}`
    );
    const json = await res.json();
    const rows = Array.isArray(json?.snapshots) ? json.snapshots : [];
    snapshots = rows
      .map((row: { snapshotDate?: string; ranks?: Record<string, number> }) => ({
        snapshotDate: String(row?.snapshotDate || '').trim().slice(0, 10),
        ranks: row?.ranks && typeof row.ranks === 'object' ? row.ranks : {},
      }))
      .filter((row: SnapshotRow) => /^\d{4}-\d{2}-\d{2}$/.test(row.snapshotDate));
  } catch {
    snapshots = [];
  }

  return params.logs.map((g, gameIndex) => {
    const date = String(g.date || '').trim().slice(0, 10) || null;
    const code = resolveNblSteTeamCode(g.opponentCode) || resolveNblSteTeamCode(g.opponent);
    const inSeason = isNblSeasonLog(g, year);
    const rank = inSeason && date && code ? rankAsOf(snapshots, date, code) : null;
    return {
      gameIndex,
      matchId: g.matchId ?? null,
      date,
      opponentCode: code,
      opponent: String(g.opponent || code || ''),
      dvpRank: rank,
      dvpRankSource: rank != null ? 'tipoff' : null,
      opponentRank: rank,
      minutes: g.minutes ?? null,
    };
  });
}
