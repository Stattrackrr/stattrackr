/**
 * Build per-game opponent defence ranks for NBA chart Advanced filter.
 * Current season only. Uses tip-time DvP snapshots (no live ranks pasted onto past games).
 */

import { normalizeAbbr } from '@/lib/nbaAbbr';
import { currentNbaSeason } from '@/lib/nbaConstants';
import { NBA_CURRENT_SEASON_YEAR } from '@/lib/nba/dash/teams';
import type { NbaGameFilterDataItem } from '@/app/nba/components/NbaGameFilters';

/** NBA season start year for a calendar date (Oct 15 cutoff). */
function nbaSeasonYearFromDate(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m > 10 || (m === 10 && d >= 15)) return y;
  return y - 1;
}

const STAT_TO_DVP: Record<string, string> = {
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
  threeMade: 'fg3m',
  fg3m: 'fg3m',
  pra: 'pts',
  pr: 'pts',
  pa: 'pts',
  ra: 'reb',
};

export function nbaChartStatToDvpMetric(stat: string | null | undefined): string {
  const key = String(stat || '').trim();
  return STAT_TO_DVP[key] || 'pts';
}

type LogLike = {
  matchId?: string | null;
  date?: string | null;
  opponent?: string | null;
  opponentCode?: string | null;
  minutes?: number | null;
  season?: number | null;
};

type SnapshotRow = { snapshotDate: string; ranks: Record<string, number> };

/** Latest snapshot on or before gameDate (snapshots must be ascending). */
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

export async function buildNbaPerGameDefenseRanks(params: {
  logs: LogLike[];
  position: string;
  metric?: string;
  /** Restrict ranks to this season start year. Defaults to current NBA season. */
  seasonYear?: number;
}): Promise<NbaGameFilterDataItem[]> {
  const position = String(params.position || '').toUpperCase();
  const metric = params.metric || 'pts';
  const seasonYear =
    typeof params.seasonYear === 'number' && Number.isFinite(params.seasonYear)
      ? params.seasonYear
      : NBA_CURRENT_SEASON_YEAR || currentNbaSeason();
  if (!params.logs.length || !['PG', 'SG', 'SF', 'PF', 'C'].includes(position)) {
    return [];
  }

  const isCurrentSeasonLog = (g: LogLike, date: string | null): boolean => {
    if (typeof g.season === 'number' && Number.isFinite(g.season)) {
      return g.season === seasonYear;
    }
    if (!date) return false;
    return nbaSeasonYearFromDate(date) === seasonYear;
  };

  let snapshots: SnapshotRow[] = [];
  try {
    const res = await fetch(
      `/api/dvp/rank/history?season=${seasonYear}&pos=${encodeURIComponent(position)}&metric=${encodeURIComponent(metric)}`
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
    const code = normalizeAbbr(String(g.opponentCode || g.opponent || ''));
    const inSeason = isCurrentSeasonLog(g, date);
    const rank =
      inSeason && date && code ? rankAsOf(snapshots, date, code) : null;
    return {
      gameIndex,
      matchId: g.matchId ?? null,
      date,
      opponentCode: code || null,
      opponent: String(g.opponent || code || ''),
      dvpRank: rank,
      dvpRankSource: rank != null ? 'tipoff' : null,
      opponentRank: rank,
      minutes: g.minutes ?? null,
    };
  });
}
