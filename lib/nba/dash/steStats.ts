/**
 * NBA team STE stats (Opponent Breakdown / Team Matchup):
 * offense = team box totals per game, allowed = opponent box totals in that team's games.
 */
import { NBA_CLUBS, nbaSeasonLabel } from './teams';
import { getNbaSeasonDataset, type NbaTeamGameTotals } from './season';
import {
  NBA_STE_STAT_KEYS,
  type NbaSteAverages,
  type NbaSteMetricBlock,
  type NbaSteStatKey,
  type NbaSteStatsPayload,
  type NbaSteTeamSlice,
} from './teamSteStatsShared';

type RawTotals = Pick<
  NbaTeamGameTotals,
  'pts' | 'reb' | 'oreb' | 'dreb' | 'ast' | 'stl' | 'blk' | 'fgm' | 'fga' | 'fg3m' | 'fg3a'
>;

const emptyTotals = (): RawTotals => ({
  pts: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0,
});

function addTotals(target: RawTotals, src: RawTotals) {
  for (const k of Object.keys(target) as Array<keyof RawTotals>) target[k] += src[k];
}

function averagesFromTotals(s: RawTotals, games: number): NbaSteAverages | null {
  if (!games) return null;
  return {
    pts: s.pts / games,
    reb: s.reb / games,
    oreb: s.oreb / games,
    dreb: s.dreb / games,
    ast: s.ast / games,
    stl: s.stl / games,
    blk: s.blk / games,
    fg_pct: s.fga > 0 ? (s.fgm / s.fga) * 100 : 0,
    fg3_pct: s.fg3a > 0 ? (s.fg3m / s.fg3a) * 100 : 0,
  };
}

function rankValues(values: Record<string, number>, higherIsBetter: boolean): Record<string, number> {
  const entries = Object.entries(values).filter(([, v]) => Number.isFinite(v));
  entries.sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]));
  const ranks: Record<string, number> = {};
  entries.forEach(([code], idx) => {
    ranks[code] = idx + 1;
  });
  return ranks;
}

export async function buildNbaSteStatsPayload(options: { year: number; window?: number }): Promise<NbaSteStatsPayload> {
  const year = options.year;
  const windowN = Math.max(0, Number(options.window ?? 0) || 0);
  const data = await getNbaSeasonDataset(year);
  const allGames = [...data.teamGames.values()].filter((g) => !g.postseason);

  const byTeam = new Map<string, NbaTeamGameTotals[]>();
  for (const g of allGames) {
    const list = byTeam.get(g.teamCode);
    if (list) list.push(g);
    else byTeam.set(g.teamCode, [g]);
  }

  const names: Record<string, string> = {};
  const games: Record<string, number> = {};
  const totalGames: Record<string, number> = {};
  const teams: NbaSteTeamSlice[] = [];
  const offenseValues = Object.fromEntries(NBA_STE_STAT_KEYS.map((k) => [k, {}])) as Record<NbaSteStatKey, Record<string, number>>;
  const allowedValues = Object.fromEntries(NBA_STE_STAT_KEYS.map((k) => [k, {}])) as Record<NbaSteStatKey, Record<string, number>>;

  for (const club of NBA_CLUBS) {
    const rows = (byTeam.get(club.code) || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    totalGames[club.code] = rows.length;
    names[club.code] = club.name;
    const windowRows = windowN > 0 ? rows.slice(0, windowN) : rows;
    games[club.code] = windowRows.length;

    const offSum = emptyTotals();
    const allSum = emptyTotals();
    let allowedGames = 0;
    for (const g of windowRows) {
      addTotals(offSum, g);
      const opp = data.teamGames.get(`${g.matchId}|${g.opponentCode}`);
      if (opp) {
        addTotals(allSum, opp);
        allowedGames += 1;
      }
    }
    const offense = averagesFromTotals(offSum, windowRows.length);
    const allowed = averagesFromTotals(allSum, allowedGames);
    if (!offense || !allowed) continue;
    teams.push({ code: club.code, name: club.name, games: windowRows.length, offense, allowed });
    for (const key of NBA_STE_STAT_KEYS) {
      offenseValues[key][club.code] = offense[key];
      allowedValues[key][club.code] = allowed[key];
    }
  }

  const forMetrics = {} as Record<NbaSteStatKey, NbaSteMetricBlock>;
  const metrics = {} as Record<NbaSteStatKey, NbaSteMetricBlock>;
  for (const key of NBA_STE_STAT_KEYS) {
    forMetrics[key] = { values: offenseValues[key], ranks: rankValues(offenseValues[key], true) };
    metrics[key] = { values: allowedValues[key], ranks: rankValues(allowedValues[key], false) };
  }

  return {
    year,
    seasonLabel: nbaSeasonLabel(year),
    window: windowN,
    generatedAt: new Date().toISOString(),
    source: 'supabase:nba_player_game_stats',
    teamCount: teams.length,
    names,
    games,
    totalGames,
    metrics,
    forMetrics,
    teams,
  };
}
