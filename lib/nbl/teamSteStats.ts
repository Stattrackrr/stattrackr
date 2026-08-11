/**
 * NBL team STE stats (NBA Opponent Breakdown metrics):
 * pts / reb / ast / fg_pct / fg3_pct / stl / blk
 *
 * Built from cached player game logs:
 *   - offense  = team box totals that game
 *   - allowed  = opponent box totals in that team's games
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CLUBS,
  getNblClubByCode,
  resolveNblClubName,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';
import {
  NBL_STE_STAT_KEYS,
  type NblSteAverages,
  type NblSteMetricBlock,
  type NblSteStatKey,
  type NblSteStatsPayload,
  type NblSteTeamSlice,
  resolveNblSteTeamCode,
} from '@/lib/nbl/teamSteStatsShared';

export type {
  NblSteAverages,
  NblSteMetricBlock,
  NblSteStatKey,
  NblSteStatsPayload,
  NblSteTeamSlice,
};
export {
  NBL_STE_STAT_KEYS,
  NBL_STE_STAT_LABELS,
  nblSteMatchupSideLabels,
  resolveNblSteTeamCode,
} from '@/lib/nbl/teamSteStatsShared';

type RawTotals = {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
};

type TeamGame = RawTotals & {
  matchId: string;
  teamCode: string;
  teamName: string;
  opponentCode: string;
  opponentName: string;
  date: string;
};

type PlayerLogGame = {
  matchId?: string | null;
  date?: string | null;
  opponent?: string | null;
  opponentCode?: string | null;
  team?: string | null;
  teamCode?: string | null;
  points?: number | null;
  rebounds?: number | null;
  assists?: number | null;
  steals?: number | null;
  blocks?: number | null;
  fgMade?: number | null;
  fgAttempted?: number | null;
  threeMade?: number | null;
  threeAttempted?: number | null;
};

type PlayerLogFile = {
  games?: PlayerLogGame[];
};

const emptyTotals = (): RawTotals => ({
  pts: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  fgm: 0,
  fga: 0,
  fg3m: 0,
  fg3a: 0,
});

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function averagesFromTotals(sum: RawTotals, games: number): NblSteAverages | null {
  if (!games) return null;
  return {
    pts: sum.pts / games,
    reb: sum.reb / games,
    ast: sum.ast / games,
    stl: sum.stl / games,
    blk: sum.blk / games,
    fg_pct: sum.fga > 0 ? (sum.fgm / sum.fga) * 100 : 0,
    fg3_pct: sum.fg3a > 0 ? (sum.fg3m / sum.fg3a) * 100 : 0,
  };
}

function addTotals(target: RawTotals, src: RawTotals) {
  target.pts += src.pts;
  target.reb += src.reb;
  target.ast += src.ast;
  target.stl += src.stl;
  target.blk += src.blk;
  target.fgm += src.fgm;
  target.fga += src.fga;
  target.fg3m += src.fg3m;
  target.fg3a += src.fg3a;
}

function loadTeamGamesForYear(year: number): TeamGame[] {
  const dir = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'player-logs');
  if (!fs.existsSync(dir)) return [];

  const suffix = `-${year}.json`;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(suffix));
  const byKey = new Map<string, TeamGame>();

  for (const file of files) {
    let payload: PlayerLogFile | null = null;
    try {
      payload = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as PlayerLogFile;
    } catch {
      continue;
    }
    for (const g of payload.games || []) {
      const matchId = String(g.matchId || '').trim();
      const teamCode = resolveNblSteTeamCode(g.teamCode || g.team);
      const opponentCode = resolveNblSteTeamCode(g.opponentCode || g.opponent);
      if (!matchId || !teamCode) continue;

      const key = `${matchId}|${teamCode}`;
      const existing = byKey.get(key);
      const club = getNblClubByCode(teamCode);
      const oppClub = opponentCode ? getNblClubByCode(opponentCode) : null;
      if (!existing) {
        byKey.set(key, {
          matchId,
          teamCode,
          teamName: club?.name || resolveNblClubName(g.team) || teamCode,
          opponentCode: opponentCode || '',
          opponentName: oppClub?.name || resolveNblClubName(g.opponent) || String(g.opponent || ''),
          date: String(g.date || ''),
          ...emptyTotals(),
        });
      }
      const row = byKey.get(key)!;
      if (!row.opponentCode && opponentCode) {
        row.opponentCode = opponentCode;
        row.opponentName = oppClub?.name || resolveNblClubName(g.opponent) || row.opponentName;
      }
      row.pts += num(g.points);
      row.reb += num(g.rebounds);
      row.ast += num(g.assists);
      row.stl += num(g.steals);
      row.blk += num(g.blocks);
      row.fgm += num(g.fgMade);
      row.fga += num(g.fgAttempted);
      row.fg3m += num(g.threeMade);
      row.fg3a += num(g.threeAttempted);
    }
  }

  return [...byKey.values()];
}

function rankValues(
  values: Record<string, number>,
  higherIsBetter: boolean
): Record<string, number> {
  const entries = Object.entries(values).filter(([, v]) => Number.isFinite(v));
  entries.sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]));
  const ranks: Record<string, number> = {};
  entries.forEach(([code], idx) => {
    ranks[code] = idx + 1;
  });
  return ranks;
}

export function buildNblSteStatsPayload(options: {
  year: number;
  window?: number;
}): NblSteStatsPayload {
  const year = options.year;
  const windowN = Math.max(0, Number(options.window ?? 0) || 0);
  const allGames = loadTeamGamesForYear(year);

  const byMatch = new Map<string, Map<string, TeamGame>>();
  for (const g of allGames) {
    if (!byMatch.has(g.matchId)) byMatch.set(g.matchId, new Map());
    byMatch.get(g.matchId)!.set(g.teamCode, g);
  }

  const byTeam = new Map<string, TeamGame[]>();
  for (const g of allGames) {
    if (!byTeam.has(g.teamCode)) byTeam.set(g.teamCode, []);
    byTeam.get(g.teamCode)!.push(g);
  }

  const names: Record<string, string> = {};
  const games: Record<string, number> = {};
  const totalGames: Record<string, number> = {};
  const teams: NblSteTeamSlice[] = [];

  const offenseValues = Object.fromEntries(
    NBL_STE_STAT_KEYS.map((k) => [k, {} as Record<string, number>])
  ) as Record<NblSteStatKey, Record<string, number>>;
  const allowedValues = Object.fromEntries(
    NBL_STE_STAT_KEYS.map((k) => [k, {} as Record<string, number>])
  ) as Record<NblSteStatKey, Record<string, number>>;

  for (const club of NBL_CLUBS) {
    const rows = (byTeam.get(club.code) || []).slice().sort((a, b) =>
      String(b.date).localeCompare(String(a.date))
    );
    totalGames[club.code] = rows.length;
    names[club.code] = club.name;

    const windowRows =
      windowN > 0 ? rows.slice(0, Math.min(windowN, rows.length)) : rows;
    games[club.code] = windowRows.length;

    const offSum = emptyTotals();
    const allSum = emptyTotals();
    let allowedGames = 0;

    for (const g of windowRows) {
      addTotals(offSum, g);
      const oppCode =
        g.opponentCode ||
        [...(byMatch.get(g.matchId)?.keys() || [])].find((c) => c !== g.teamCode) ||
        '';
      const opp = oppCode ? byMatch.get(g.matchId)?.get(oppCode) : null;
      if (opp) {
        addTotals(allSum, opp);
        allowedGames += 1;
      }
    }

    const offense = averagesFromTotals(offSum, windowRows.length);
    const allowed = averagesFromTotals(allSum, allowedGames);
    if (!offense || !allowed) continue;

    teams.push({
      code: club.code,
      name: club.name,
      games: windowRows.length,
      offense,
      allowed,
    });

    for (const key of NBL_STE_STAT_KEYS) {
      offenseValues[key][club.code] = offense[key];
      allowedValues[key][club.code] = allowed[key];
    }
  }

  const forMetrics = {} as Record<NblSteStatKey, NblSteMetricBlock>;
  const metrics = {} as Record<NblSteStatKey, NblSteMetricBlock>;
  for (const key of NBL_STE_STAT_KEYS) {
    forMetrics[key] = {
      values: offenseValues[key],
      ranks: rankValues(offenseValues[key], true),
    };
    metrics[key] = {
      values: allowedValues[key],
      ranks: rankValues(allowedValues[key], false),
    };
  }

  return {
    year,
    seasonLabel: nblSeasonLabel(year),
    window: windowN,
    generatedAt: new Date().toISOString(),
    source: 'nbl-model/cache/player-logs',
    teamCount: teams.length,
    names,
    games,
    totalGames,
    metrics,
    forMetrics,
    teams,
  };
}
