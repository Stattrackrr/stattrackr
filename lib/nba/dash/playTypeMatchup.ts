/**
 * Play type matchup: a player's Synergy play-type scoring (BDL season averages) vs how many
 * points each defence allows from that play type.
 *
 * BDL only publishes offensive play types, so defence is estimated game by game: every
 * opponent player's points in a game x his season share of points from the play type,
 * summed per team game and averaged across the defence's games.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NBA_DASH_CACHE, nbaDashCached } from './responseCache';
import { getNbaSeasonDataset, resolveNbaDataSeason, selectAllParallel } from './season';
import { getNbaClubByCode, NBA_CLUBS, nbaSeasonLabel, resolveNbaClub } from './teams';
import {
  NBA_SYNERGY_PLAY_TYPE_LABELS,
  NBA_SYNERGY_PLAY_TYPES,
  type NbaPlayTypeMatchupPayload,
  type NbaPlayTypeMatchupRow,
  type NbaSynergyPlayType,
} from './playTypeMatchupShared';

/** Players need this many games in a play type to be ranked in it. */
const MIN_GAMES_FOR_RANK = 10;

/** [ppg, possPerGame, ppp, frequency, rank] */
type PlayerCell = [number, number, number | null, number | null, number | null];
/** [allowedPerGame, rank] */
type TeamCell = [number, number];

type LeagueTable = {
  year: number;
  players: Record<string, Partial<Record<NbaSynergyPlayType, PlayerCell>>>;
  /** Box-score points per game (regular season). */
  playerPpg: Record<string, number>;
  rankedPlayers: Partial<Record<NbaSynergyPlayType, number>>;
  teams: Partial<Record<NbaSynergyPlayType, Record<string, TeamCell>>>;
  leagueAvg: Partial<Record<NbaSynergyPlayType, number>>;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};
const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;

async function buildLeagueTable(year: number): Promise<LeagueTable> {
  const [rows, data] = await Promise.all([
    selectAllParallel(() =>
      supabaseAdmin
        .from('nba_player_season_averages')
        .select('player_id, stat_type, stats')
        .eq('season', year)
        .eq('season_type', 'regular')
        .eq('category', 'playtype')
        .in('stat_type', [...NBA_SYNERGY_PLAY_TYPES])
        .order('stat_type')
        .order('player_id')
    ),
    getNbaSeasonDataset(year),
  ]);

  const ppgById = new Map(data.league.map((p) => [p.playerId, num(p.points) ?? 0]));
  const players: LeagueTable['players'] = {};
  const sharesById = new Map<string, Partial<Record<NbaSynergyPlayType, number>>>();
  const byType = new Map<NbaSynergyPlayType, Array<{ id: string; ppg: number; gp: number }>>();

  for (const r of rows) {
    const type = r.stat_type as NbaSynergyPlayType;
    const s = (r.stats ?? {}) as Record<string, unknown>;
    const ppg = num(s.pts);
    if (ppg == null) continue;
    const id = String(r.player_id);
    const gp = num(s.gp) ?? 0;
    (players[id] ??= {})[type] = [ppg, num(s.poss) ?? 0, num(s.ppp), num(s.poss_pct), null];
    const list = byType.get(type) ?? [];
    list.push({ id, ppg, gp });
    byType.set(type, list);
    const total = ppgById.get(id) ?? 0;
    if (total > 0) {
      const shares = sharesById.get(id) ?? {};
      shares[type] = Math.min(1, ppg / total);
      sharesById.set(id, shares);
    }
  }

  const rankedPlayers: LeagueTable['rankedPlayers'] = {};
  for (const [type, list] of byType) {
    const ranked = list.filter((p) => p.gp >= MIN_GAMES_FOR_RANK).sort((a, b) => b.ppg - a.ppg);
    ranked.forEach((p, i) => {
      players[p.id]![type]![4] = i + 1;
    });
    rankedPlayers[type] = ranked.length;
  }

  // Shares can over-count when a player's play-type points exceed his box-score average (rounding, trades).
  for (const shares of sharesById.values()) {
    const total = Object.values(shares).reduce((s, v) => s + (v ?? 0), 0);
    if (total > 1) for (const k of Object.keys(shares) as NbaSynergyPlayType[]) shares[k] = shares[k]! / total;
  }

  const allowed = new Map<string, Map<NbaSynergyPlayType, number>>();
  const gamesByDefence = new Map<string, Set<string>>();
  for (const [id, logs] of data.logsByPlayer) {
    const shares = sharesById.get(id);
    for (const g of logs) {
      if (g.postseason || !g.opponentCode) continue;
      const games = gamesByDefence.get(g.opponentCode) ?? new Set<string>();
      games.add(g.matchId);
      gamesByDefence.set(g.opponentCode, games);
      const pts = num(g.points) ?? 0;
      if (!shares || pts <= 0) continue;
      const byTypeAllowed = allowed.get(g.opponentCode) ?? new Map<NbaSynergyPlayType, number>();
      for (const [type, share] of Object.entries(shares) as Array<[NbaSynergyPlayType, number]>) {
        byTypeAllowed.set(type, (byTypeAllowed.get(type) ?? 0) + pts * share);
      }
      allowed.set(g.opponentCode, byTypeAllowed);
    }
  }

  const teams: LeagueTable['teams'] = {};
  const leagueAvg: LeagueTable['leagueAvg'] = {};
  for (const type of NBA_SYNERGY_PLAY_TYPES) {
    const perGame: Array<[string, number]> = [];
    for (const club of NBA_CLUBS) {
      const games = gamesByDefence.get(club.code)?.size ?? 0;
      if (!games) continue;
      perGame.push([club.code, (allowed.get(club.code)?.get(type) ?? 0) / games]);
    }
    if (!perGame.length) continue;
    perGame.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    teams[type] = Object.fromEntries(perGame.map(([code, v], i) => [code, [round(v), i + 1] as TeamCell]));
    leagueAvg[type] = round(perGame.reduce((s, [, v]) => s + v, 0) / perGame.length);
  }

  const playerPpg = Object.fromEntries(
    Object.keys(players)
      .map((id) => [id, ppgById.get(id) ?? 0] as const)
      .filter(([, v]) => v > 0)
  );
  return { year, players, playerPpg, rankedPlayers, teams, leagueAvg };
}

export async function buildNbaPlayTypeMatchup(opts: {
  playerId: string;
  opponent?: string | null;
  year?: number | null;
}): Promise<NbaPlayTypeMatchupPayload> {
  const year = await resolveNbaDataSeason(opts.year ?? null);
  const club = opts.opponent ? resolveNbaClub(opts.opponent) ?? getNbaClubByCode(opts.opponent) : null;
  return nbaDashCached('play-type-matchup-v1', [year, opts.playerId, club?.code ?? null], NBA_DASH_CACHE.league, () =>
    buildPlayerMatchup(year, opts.playerId, club)
  );
}

async function buildPlayerMatchup(
  year: number,
  playerId: string,
  club: ReturnType<typeof resolveNbaClub>
): Promise<NbaPlayTypeMatchupPayload> {
  const table = await nbaDashCached('play-type-matchup-league-v2', [year], NBA_DASH_CACHE.league, () =>
    buildLeagueTable(year)
  );
  const own = table.players[playerId] ?? {};
  const totalPpg = table.playerPpg[playerId] ?? 0;

  const rows: NbaPlayTypeMatchupRow[] = [];
  for (const type of NBA_SYNERGY_PLAY_TYPES) {
    const cell = own[type];
    if (!cell || cell[0] <= 0) continue;
    const opp = club ? table.teams[type]?.[club.code] : undefined;
    rows.push({
      type,
      label: NBA_SYNERGY_PLAY_TYPE_LABELS[type],
      ppg: cell[0],
      pointsPct: totalPpg > 0 ? Math.round(Math.min(1, cell[0] / totalPpg) * 100) : null,
      possPerGame: cell[1],
      ppp: cell[2],
      frequency: cell[3],
      rank: cell[4],
      rankedPlayers: table.rankedPlayers[type] ?? 0,
      oppAllowed: opp?.[0] ?? null,
      oppRank: opp?.[1] ?? null,
      leagueAvgAllowed: table.leagueAvg[type] ?? null,
    });
  }
  rows.sort((a, b) => b.ppg - a.ppg);

  return {
    year,
    seasonLabel: nbaSeasonLabel(year),
    playerId,
    opponentCode: club?.code ?? null,
    opponentName: club?.name ?? null,
    teamsRanked: Object.keys(table.teams.isolation ?? {}).length,
    rows,
  };
}
