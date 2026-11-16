/**
 * League tables behind the punter arm's reasons, all from data already stored: what each team allows
 * by shot zone (the shot summaries), to each position (this season's box scores) and per possession,
 * each player's scoring zones, and the games a teammate played or missed. Pure; the scan supplies the data.
 */

import { NBL_PROP_MARKETS, type NblPropMarket } from '@/lib/aiPicks/markets';
import type { NbaFinal } from '@/lib/aiPicks/model/nbaGames';
import { nblStatValue } from '@/lib/aiPicks/model/nblProps';
import type { NbaPositionGroup } from '@/lib/aiPicks/model/nbaProps';
import type { NbaShotSummary, NbaShotSummaryEntry } from '@/lib/nba/dash/shotSummary';
import type { NbaShotZoneId } from '@/lib/nba/dash/shotZonesShared';
import type { NbaGameLogRow } from '@/lib/nba/dash/types';
import { PUNTER_RULES, type PunterRank, type PunterZone, type PunterZoneGroup } from './angles';

/** A team's defence is ranked once it has this many games this season. */
export const PUNTER_MIN_TEAM_GAMES = 8;

const ZONE_GROUPS: Record<PunterZoneGroup, { zones: NbaShotZoneId[]; points: number }> = {
  paint: { zones: ['restricted', 'paint'], points: 2 },
  mid: { zones: ['midRange'], points: 2 },
  three: { zones: ['leftCorner3', 'rightCorner3', 'aboveBreak3'], points: 3 },
};
const GROUPS = Object.keys(ZONE_GROUPS) as PunterZoneGroup[];

/** Rank 1 is the lowest value (allows the least); ties break on the team code so ranks are stable. */
export function rankTeams(values: ReadonlyMap<string, number>): Map<string, PunterRank> {
  const sorted = [...values].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return new Map(sorted.map(([team, value], i) => [team, { rank: i + 1, of: sorted.length, value }]));
}

const makes = (e: NbaShotSummaryEntry, group: PunterZoneGroup) => ZONE_GROUPS[group].zones.reduce((s, z) => s + (e.z[z]?.[1] ?? 0), 0);

/** Points a game each team allows from each zone group. */
export function zoneDefenceRanks(summary: NbaShotSummary | null): Partial<Record<PunterZoneGroup, Map<string, PunterRank>>> {
  if (!summary) return {};
  const out: Partial<Record<PunterZoneGroup, Map<string, PunterRank>>> = {};
  for (const group of GROUPS) {
    const values = new Map<string, number>();
    for (const [team, e] of Object.entries(summary.defense)) {
      if (e.g >= PUNTER_MIN_TEAM_GAMES) values.set(team, (ZONE_GROUPS[group].points * makes(e, group)) / e.g);
    }
    out[group] = rankTeams(values);
  }
  return out;
}

/** The zone carrying at least half of a player's field-goal points, over his shot summaries. */
export function playerZone(entries: Array<NbaShotSummaryEntry | null | undefined>): PunterZone | null {
  const own = entries.filter((e): e is NbaShotSummaryEntry => !!e);
  const made = (group: PunterZoneGroup) => own.reduce((s, e) => s + makes(e, group), 0);
  const totalMakes = GROUPS.reduce((s, g) => s + made(g), 0);
  if (totalMakes < PUNTER_RULES.zoneMinMakes) return null;
  const points = GROUPS.map((group) => ({ group, points: ZONE_GROUPS[group].points * made(group) }));
  const total = points.reduce((s, p) => s + p.points, 0);
  const top = points.sort((a, b) => b.points - a.points)[0]!;
  const share = top.points / total;
  return share >= PUNTER_RULES.zoneShare ? { group: top.group, share: Math.round(share * 1000) / 1000 } : null;
}

/** Each stat a team has allowed to a position group, and the games it has defended. */
export type PunterPositionTable = { totals: Map<string, number>; games: Map<string, Set<string>> };

export function emptyPositionTable(): PunterPositionTable {
  return { totals: new Map(), games: new Map() };
}

const positionKey = (team: string, pos: NbaPositionGroup, stat: NblPropMarket) => `${team}|${pos}|${stat}`;

export function addPositionGame(table: PunterPositionTable, row: NbaGameLogRow, pos: NbaPositionGroup): void {
  if (!row.opponentCode || !((row.minutes ?? 0) > 0)) return;
  const games = table.games.get(row.opponentCode) ?? new Set<string>();
  games.add(row.matchId);
  table.games.set(row.opponentCode, games);
  for (const stat of NBL_PROP_MARKETS) {
    const v = nblStatValue(row, stat);
    if (v == null) continue;
    const key = positionKey(row.opponentCode, pos, stat);
    table.totals.set(key, (table.totals.get(key) ?? 0) + v);
  }
}

/** The stat a game each team allows to the position. */
export function positionRanks(table: PunterPositionTable, pos: NbaPositionGroup, stat: NblPropMarket): Map<string, PunterRank> {
  const values = new Map<string, number>();
  for (const [team, games] of table.games) {
    if (games.size >= PUNTER_MIN_TEAM_GAMES) values.set(team, (table.totals.get(positionKey(team, pos, stat)) ?? 0) / games.size);
  }
  return rankTeams(values);
}

/** Points allowed per 100 possessions this regular season. */
export function defenceRanks(finals: NbaFinal[], season: number): Map<string, PunterRank> {
  const acc = new Map<string, { pts: number; poss: number; games: number }>();
  for (const g of finals) {
    if (g.season !== season || g.postseason) continue;
    for (const [team, pts, poss] of [
      [g.home, g.awayScore, g.awayPoss],
      [g.away, g.homeScore, g.homePoss],
    ] as const) {
      const row = acc.get(team) ?? { pts: 0, poss: 0, games: 0 };
      row.pts += pts;
      row.poss += poss;
      row.games += 1;
      acc.set(team, row);
    }
  }
  const values = new Map<string, number>();
  for (const [team, r] of acc) if (r.games >= PUNTER_MIN_TEAM_GAMES && r.poss > 0) values.set(team, (100 * r.pts) / r.poss);
  return rankTeams(values);
}

/**
 * The team's games a player played and missed since his first game for it (oldest first). Null when
 * he has never played for the team: there is no "with him" to compare against.
 */
export function teammateSplit(
  teamGames: Array<{ matchId: string; players: ReadonlyMap<string, number> }>,
  playerId: string
): { played: Set<string>; missed: Set<string> } | null {
  const first = teamGames.findIndex((g) => g.players.has(playerId));
  if (first < 0) return null;
  const played = new Set<string>();
  const missed = new Set<string>();
  for (const g of teamGames.slice(first)) (g.players.has(playerId) ? played : missed).add(g.matchId);
  return { played, missed };
}

export type PunterLeague = {
  zoneRanks: Partial<Record<PunterZoneGroup, Map<string, PunterRank>>>;
  defenceRanks: Map<string, PunterRank>;
  positionRanks: (pos: NbaPositionGroup | null, stat: NblPropMarket) => Map<string, PunterRank> | null;
  zoneOf: (playerId: string) => PunterZone | null;
};

export function buildPunterLeague(input: {
  season: number;
  /** This season's box scores by player. */
  logsByPlayer: ReadonlyMap<string, NbaGameLogRow[]>;
  positionOf: (playerId: string) => NbaPositionGroup | null;
  shots: NbaShotSummary | null;
  priorShots: NbaShotSummary | null;
  finals: NbaFinal[];
}): PunterLeague {
  const table = emptyPositionTable();
  for (const [id, logs] of input.logsByPlayer) {
    const pos = input.positionOf(id);
    if (pos) for (const row of logs) if (!row.postseason) addPositionGame(table, row, pos);
  }
  const byPosition = new Map<string, Map<string, PunterRank>>();
  return {
    zoneRanks: zoneDefenceRanks(input.shots),
    defenceRanks: defenceRanks(input.finals, input.season),
    positionRanks: (pos, stat) => {
      if (!pos) return null;
      const key = `${pos}|${stat}`;
      let ranks = byPosition.get(key);
      if (!ranks) byPosition.set(key, (ranks = positionRanks(table, pos, stat)));
      return ranks;
    },
    zoneOf: (id) => playerZone([input.shots?.players[id], input.priorShots?.players[id]]),
  };
}
