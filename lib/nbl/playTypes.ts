/**
 * Tag NBL players into attacking play types from on-court usage + shot zones,
 * then build type × opponent boost cells (vs each player's own average).
 * Per team, the highest-usage creator is Primary BH and the next is Second BH.
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CLUBS,
  NBL_CURRENT_SEASON_YEAR,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';
import { nblUsagePct } from '@/lib/nbl/advancedRates';
import { loadNblTeamBoxes, nblTeamBoxKey } from '@/lib/nbl/teamBoxScores';
import { resolveNblSteTeamCode } from '@/lib/nbl/teamSteStatsShared';
import { nblRosettaYearStamp } from '@/lib/nbl/ladderSeason';
import { listNblUpcomingRoundGames } from '@/lib/nbl/nextGame';
import { readPlayerShotChartCache } from '@/lib/nbl/nblShotChartData';
import type { NblGameLogRow, NblLeaguePlayerStatRow } from '@/lib/nbl/rosettaTypes';
import {
  NBL_PLAY_TYPE_IDS,
  NBL_PLAY_TYPE_LABELS,
  NBL_PLAY_TYPE_STAT_LABELS,
  NBL_PLAY_TYPE_YEAR,
  normalizeNblPlayTypeStat,
  parseNblPlayTypeStat,
  type NblPlayTypeCell,
  type NblPlayTypeId,
  type NblPlayTypeMatrixRow,
  type NblPlayTypePlayerRow,
  type NblPlayTypeRoundPick,
  type NblPlayTypesPayload,
  type NblPlayTypeStatKey,
} from '@/lib/nbl/playTypesShared';

export type {
  NblPlayTypeCell,
  NblPlayTypeId,
  NblPlayTypeMatrixRow,
  NblPlayTypePlayerRow,
  NblPlayTypeRoundPick,
  NblPlayTypesPayload,
  NblPlayTypeStatKey,
} from '@/lib/nbl/playTypesShared';
export {
  NBL_PLAY_TYPE_IDS,
  NBL_PLAY_TYPE_LABELS,
  NBL_PLAY_TYPE_STAT_LABELS,
  NBL_PLAY_TYPE_YEAR,
  normalizeNblPlayTypeStat,
  parseNblPlayTypeStat,
} from '@/lib/nbl/playTypesShared';

const TAG_SCHEMA = 'v8';
const MIN_GAMES_FOR_TAG = 8;
const MIN_AVG_MINUTES_FOR_TAG = 15;
const MIN_GAME_MINUTES = 10;
const MIN_SHOTS_FOR_ZONES = 20;
/** Backup creators below this on-court usage are slashers, not Second BH. */
const MIN_SECOND_BH_USG = 13;
const SIGNIFICANT_GAMES = 10;
const SIGNIFICANT_PLAYERS = 4;
const SIGNIFICANT_MINUTES = 140;
/** Shrink 1-game matchups toward the type average so a 30-point night is not +21. */
const MATCHUP_SHRINK_K = 3;

type PosFamily = 'G' | 'F' | 'C';

type PlayerFeatures = {
  row: NblLeaguePlayerStatRow;
  games: NblGameLogRow[];
  pos: PosFamily;
  gamesUsed: number;
  minutes: number;
  pts36: number;
  ast36: number;
  astPerGame: number;
  /** Basketball-Reference usage % from box-score possessions (minutes-weighted). */
  usgPct: number | null;
  threeRate: number;
  threeMade: number;
  ftRate: number;
  twoRate: number;
  restrictedShare: number | null;
  paintShare: number | null;
  midShare: number | null;
  threeShare: number | null;
  hasZones: boolean;
};

type TaggedPlayer = PlayerFeatures & { type: NblPlayTypeId };

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function positionFamily(pos: string | null | undefined): PosFamily {
  const raw = String(pos || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (raw.includes('C') && !raw.includes('G')) return 'C';
  if (raw.startsWith('C')) return 'C';
  if (raw.includes('F')) return 'F';
  return 'G';
}

function loadLeaguePlayers(year: number): NblLeaguePlayerStatRow[] {
  const file = path.join(process.cwd(), 'data', `nbl-league-player-stats-${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      players?: NblLeaguePlayerStatRow[];
    };
    return Array.isArray(data.players) ? data.players : [];
  } catch {
    return [];
  }
}

function playerLogsDir(): string {
  return path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'player-logs');
}

function loadPlayerGames(playerId: string, year: number): NblGameLogRow[] {
  const file = path.join(playerLogsDir(), `${playerId}-${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { games?: NblGameLogRow[] };
    const games = Array.isArray(data.games) ? data.games : [];
    return games.filter((g) => {
      const season = num(g.season);
      if (season != null && season !== year) return false;
      return (num(g.minutes) ?? 0) > 0;
    });
  } catch {
    return [];
  }
}

type TeamGameTotals = { fga: number; fta: number; tov: number; minutes: number };

function teamGameKey(matchId: string, teamCode: string | null, team: string): string | null {
  return nblTeamBoxKey(matchId, resolveNblSteTeamCode(teamCode || team));
}

function loadYearTeamTotals(year: number): Map<string, TeamGameTotals> {
  const totals = new Map<string, TeamGameTotals>();
  for (const [key, box] of loadNblTeamBoxes(year)) {
    totals.set(key, { fga: box.fga, fta: box.fta, tov: box.tov, minutes: box.minutes });
  }
  return totals;
}

function gameUsagePct(game: NblGameLogRow, team: TeamGameTotals | undefined): number | null {
  const mp = num(game.minutes) ?? 0;
  if (mp < MIN_GAME_MINUTES || !team) return null;
  return nblUsagePct({
    mp,
    fga: num(game.fgAttempted) ?? 0,
    fta: num(game.ftAttempted) ?? 0,
    tov: num(game.turnovers) ?? 0,
    teamMp: team.minutes,
    teamFga: team.fga,
    teamFta: team.fta,
    teamTov: team.tov,
  });
}

function weightedUsagePct(
  games: NblGameLogRow[],
  teamTotals: Map<string, TeamGameTotals>
): number | null {
  const rows: Array<{ value: number; minutes: number }> = [];
  for (const g of games) {
    const key = teamGameKey(g.matchId, g.teamCode, g.team);
    const usg = gameUsagePct(g, key ? teamTotals.get(key) : undefined);
    const minutes = num(g.minutes) ?? 0;
    if (usg == null || minutes <= 0) continue;
    rows.push({ value: usg, minutes });
  }
  return weightedMean(rows);
}

function zoneShare(
  zones: Array<{ zone: string; share?: number }> | undefined,
  ids: string[]
): number | null {
  if (!zones?.length) return null;
  let sum = 0;
  let found = false;
  for (const z of zones) {
    if (!ids.includes(z.zone)) continue;
    const share = num(z.share);
    if (share == null) continue;
    found = true;
    sum += share;
  }
  return found ? sum / 100 : null;
}

function usableGames(games: NblGameLogRow[], minMinutes: number): NblGameLogRow[] {
  return games.filter((g) => (num(g.minutes) ?? 0) >= minMinutes);
}

function zonesForYear(playerName: string, year: number) {
  const chart = readPlayerShotChartCache(playerName);
  if (!chart?.zones?.length) return null;
  const years = Array.isArray(chart.years) ? chart.years.map((y) => Number(y)) : [];
  if (years.length && years.some((y) => y !== year)) return null;
  const minShots = (chart.gamesUsed ?? 0) >= MIN_GAMES_FOR_TAG ? MIN_SHOTS_FOR_ZONES : 8;
  if ((chart.shotCount ?? 0) < minShots) return null;
  return chart.zones;
}

function buildFeatures(
  row: NblLeaguePlayerStatRow,
  year: number,
  teamTotals: Map<string, TeamGameTotals>
): PlayerFeatures | null {
  const allPlayed = loadPlayerGames(row.playerId, year);
  if (!allPlayed.length) return null;
  const games = usableGames(allPlayed, MIN_GAME_MINUTES);
  if (!games.length) return null;
  const minutes = games.reduce((s, g) => s + (num(g.minutes) ?? 0), 0);
  if (minutes <= 0) return null;
  const minutesAvg = minutes / games.length;

  let fga = 0;
  let fta = 0;
  let threeA = 0;
  let twoA = 0;
  let pts = 0;
  let ast = 0;
  let tpm = 0;
  for (const g of games) {
    fga += num(g.fgAttempted) ?? 0;
    fta += num(g.ftAttempted) ?? 0;
    threeA += num(g.threeAttempted) ?? 0;
    twoA += num(g.twoAttempted) ?? 0;
    pts += num(g.points) ?? 0;
    ast += num(g.assists) ?? 0;
    tpm += num(g.threeMade) ?? 0;
  }

  const per36 = 36 / minutes;
  const zones = zonesForYear(row.name, year) ?? undefined;
  const hasZones = Boolean(zones);

  return {
    row,
    games,
    pos: positionFamily(row.position),
    gamesUsed: games.length,
    minutes: minutesAvg,
    pts36: pts * per36,
    ast36: ast * per36,
    astPerGame: ast / games.length,
    usgPct: weightedUsagePct(games, teamTotals),
    threeRate: fga > 0 ? threeA / fga : 0,
    threeMade: tpm / games.length,
    ftRate: fga > 0 ? fta / fga : 0,
    twoRate: fga > 0 ? twoA / fga : 0,
    restrictedShare: zones ? zoneShare(zones, ['restricted']) : null,
    paintShare: zones ? zoneShare(zones, ['paint']) : null,
    midShare: zones ? zoneShare(zones, ['midRange']) : null,
    threeShare: zones
      ? zoneShare(zones, ['leftCorner3', 'rightCorner3', 'aboveBreak3'])
      : null,
    hasZones,
  };
}

function threeRateOf(p: PlayerFeatures): number {
  return p.threeShare != null ? Math.max(p.threeRate, p.threeShare) : p.threeRate;
}

function isInteriorOnly(p: PlayerFeatures): boolean {
  if (p.pos === 'G') return false;
  if (p.astPerGame >= 3) return false;
  if (threeRateOf(p) >= 0.33) return false;
  const restricted = p.restrictedShare;
  const paint = p.paintShare;
  if (restricted != null) {
    return restricted >= 0.42 || (paint != null && paint + restricted >= 0.48);
  }
  return p.twoRate >= 0.58;
}

/** Spot-up 3 specialists — they do not run the offense. */
function isPureThreeSpacer(p: PlayerFeatures): boolean {
  return threeRateOf(p) >= 0.55 && p.astPerGame < 4;
}

function isBallHandlerCandidate(p: PlayerFeatures): boolean {
  if (p.usgPct == null || !Number.isFinite(p.usgPct)) return false;
  if (isInteriorOnly(p)) return false;
  if (isPureThreeSpacer(p)) return false;
  if (p.pos === 'G') return true;
  return p.astPerGame >= 2.5;
}

function classifyScoringRole(p: PlayerFeatures): NblPlayTypeId {
  const threeRate = threeRateOf(p);
  const restricted = p.restrictedShare;
  const paint = p.paintShare;
  const isGuard = p.pos === 'G';
  const isCenter = p.pos === 'C';
  const isBig = p.pos === 'C' || p.pos === 'F';
  const stretchCut = isCenter ? 0.34 : 0.4;

  if (
    isGuard &&
    p.threeMade >= 0.9 &&
    (threeRate >= 0.47 || p.threeRate >= 0.5)
  ) {
    return 'three_shooter';
  }
  if (isBig && (p.threeRate >= stretchCut || (p.threeShare ?? 0) >= stretchCut + 0.02)) {
    return 'stretch_four';
  }
  if (
    isBig &&
    threeRate < 0.3 &&
    (restricted != null
      ? restricted >= 0.42 || (paint != null && paint + restricted >= 0.48)
      : p.twoRate >= 0.58)
  ) {
    return 'post_up';
  }
  if (
    !isCenter &&
    threeRate < 0.48 &&
    (restricted != null && paint != null
      ? restricted + paint >= 0.38
      : p.twoRate >= 0.48 || p.ftRate >= 0.26)
  ) {
    return 'slasher';
  }
  if (isGuard && p.threeMade >= 0.8 && threeRate >= 0.44) {
    return 'three_shooter';
  }
  return isCenter ? 'post_up' : 'slasher';
}

function teamCodeForPlayer(p: PlayerFeatures): string {
  return resolveNblSteTeamCode(p.row.teamCode || p.row.team) || '_';
}

/**
 * Per team: highest on-court USG among handlers is Primary BH, 2nd is Second BH.
 * A club that has played fewer games than the league floor still gets those two
 * roles from the games it has played. Everyone else is tagged from shot profile.
 */
function assignPlayTypes(features: PlayerFeatures[], minGames: number): TaggedPlayer[] {
  const typeById = new Map<string, NblPlayTypeId>();
  const byTeam = new Map<string, PlayerFeatures[]>();
  for (const p of features) {
    if (p.gamesUsed < 1 || p.minutes < MIN_AVG_MINUTES_FOR_TAG) continue;
    const code = teamCodeForPlayer(p);
    const list = byTeam.get(code) || [];
    list.push(p);
    byTeam.set(code, list);
  }
  for (const group of byTeam.values()) {
    const teamGames = group.reduce((max, p) => Math.max(max, p.gamesUsed), 0);
    const roleMin = Math.max(1, Math.min(minGames, teamGames));
    const handlers = group
      .filter((p) => p.gamesUsed >= roleMin && isBallHandlerCandidate(p))
      .sort((a, b) => {
        const usgA = a.usgPct ?? 0;
        const usgB = b.usgPct ?? 0;
        if (Math.abs(usgB - usgA) >= 1.5) return usgB - usgA;
        if (b.astPerGame !== a.astPerGame) return b.astPerGame - a.astPerGame;
        return usgB - usgA;
      });
    const primary = handlers[0];
    if (primary) typeById.set(primary.row.playerId, 'primary_bh');
    const secondary = handlers[1];
    if (secondary && (secondary.usgPct ?? 0) >= MIN_SECOND_BH_USG) {
      typeById.set(secondary.row.playerId, 'secondary_bh');
    }
  }
  return features.map((p) => ({
    ...p,
    type: typeById.get(p.row.playerId) ?? classifyScoringRole(p),
  }));
}

function gameStatValue(game: NblGameLogRow, stat: NblPlayTypeStatKey): number | null {
  switch (stat) {
    case 'assists':
      return num(game.assists);
    case 'rebounds':
      return num(game.rebounds);
    case 'points':
    default:
      return num(game.points);
  }
}

function weightedMean(rows: Array<{ value: number; minutes: number }>): number | null {
  const weight = rows.reduce((sum, row) => sum + row.minutes, 0);
  if (weight <= 0) return null;
  return rows.reduce((sum, row) => sum + row.value * row.minutes, 0) / weight;
}

const taggedByYear = new Map<string, TaggedPlayer[]>();

function medianInt(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Early-season floor: require as many games as a typical team has played
 * (median of team maxima), not the league max. Phoenix playing twice must
 * not drop every 1-game club (TAS) out of the matrix.
 */
function matrixMinGames(
  players: Array<{ gamesUsed: number; row: { teamCode?: string | null; team?: string | null } }>
): number {
  const byTeam = new Map<string, number>();
  for (const p of players) {
    const code = resolveNblSteTeamCode(p.row.teamCode || p.row.team);
    if (!code || p.gamesUsed <= 0) continue;
    byTeam.set(code, Math.max(byTeam.get(code) ?? 0, p.gamesUsed));
  }
  const played = [...byTeam.values()];
  if (!played.length) return MIN_GAMES_FOR_TAG;
  return Math.max(1, Math.min(MIN_GAMES_FOR_TAG, medianInt(played)));
}

function isQualifiedForMatrix(p: PlayerFeatures, minGames: number): boolean {
  return p.gamesUsed >= minGames && p.minutes >= MIN_AVG_MINUTES_FOR_TAG;
}

function tagSeason(year: number): TaggedPlayer[] {
  const cacheKey = `${year}:${TAG_SCHEMA}:${nblRosettaYearStamp(year)}`;
  const cached = taggedByYear.get(cacheKey);
  if (cached) return cached;
  const league = loadLeaguePlayers(year);
  const teamTotals = loadYearTeamTotals(year);
  const features: PlayerFeatures[] = [];
  for (const row of league) {
    const feat = buildFeatures(row, year, teamTotals);
    if (feat) features.push(feat);
  }
  if (!features.length) return [];

  const tagged = assignPlayTypes(features, matrixMinGames(features));
  taggedByYear.set(cacheKey, tagged);
  return tagged;
}

function emptyCell(): NblPlayTypeCell {
  return {
    boost: null,
    allowed: null,
    league: null,
    rank: null,
    fieldSize: NBL_CLUBS.length,
    games: 0,
    players: 0,
    minutes: 0,
    significant: false,
    names: [],
  };
}

function seasonStatValue(row: NblLeaguePlayerStatRow, stat: NblPlayTypeStatKey): number | null {
  switch (stat) {
    case 'assists':
      return num(row.assists);
    case 'rebounds':
      return num(row.rebounds);
    case 'points':
    default:
      return num(row.points);
  }
}

function toPlayerRow(p: TaggedPlayer, stat: NblPlayTypeStatKey | null): NblPlayTypePlayerRow {
  const statValue = stat ? seasonStatValue(p.row, stat) : num(p.row.points);
  return {
    playerId: p.row.playerId,
    name: p.row.name,
    team: p.row.team,
    teamCode: p.row.teamCode,
    position: p.row.position,
    imageUrl: p.row.imageUrl ?? null,
    type: p.type,
    games: p.gamesUsed,
    minutes: round1(p.minutes),
    points: p.row.points != null ? round1(Number(p.row.points)) : null,
    assists: p.row.assists != null ? round1(Number(p.row.assists)) : null,
    statValue: statValue != null ? round1(statValue) : null,
    threeRate: round1(p.threeRate * 100),
    usgPct: p.usgPct != null ? round1(p.usgPct) : null,
  };
}

function buildRoundPicks(
  matrixPlayers: TaggedPlayer[],
  rows: NblPlayTypeMatrixRow[],
  stat: NblPlayTypeStatKey | null
): NblPlayTypeRoundPick[] {
  const games = listNblUpcomingRoundGames(NBL_CURRENT_SEASON_YEAR);
  if (!games.length || !stat) return [];

  const opponentByTeam = new Map<string, { opponent: string; opponentCode: string | null }>();
  for (const game of games) {
    const homeCode = game.homeTeamCode || resolveNblSteTeamCode(game.homeTeam);
    const awayCode = game.awayTeamCode || resolveNblSteTeamCode(game.awayTeam);
    if (homeCode) {
      opponentByTeam.set(homeCode, { opponent: game.awayTeam, opponentCode: awayCode });
    }
    if (awayCode) {
      opponentByTeam.set(awayCode, { opponent: game.homeTeam, opponentCode: homeCode });
    }
  }

  const boostByTypeOpp = new Map<string, number | null>();
  for (const row of rows) {
    for (const [code, cell] of Object.entries(row.cells)) {
      boostByTypeOpp.set(`${row.type}:${code}`, cell.boost);
    }
  }

  const picks: NblPlayTypeRoundPick[] = [];
  for (const p of matrixPlayers) {
    const teamCode = resolveNblSteTeamCode(p.row.teamCode || p.row.team);
    if (!teamCode) continue;
    const matchup = opponentByTeam.get(teamCode);
    if (!matchup) continue;
    const useThreeRate = p.type === 'three_shooter' || p.type === 'stretch_four';
    const pct = useThreeRate ? round1(p.threeRate * 100) : p.usgPct != null ? round1(p.usgPct) : null;
    const statValue = seasonStatValue(p.row, stat);
    picks.push({
      playerId: p.row.playerId,
      name: p.row.name,
      team: p.row.team,
      teamCode: p.row.teamCode,
      imageUrl: p.row.imageUrl ?? null,
      type: p.type,
      typeLabel: NBL_PLAY_TYPE_LABELS[p.type],
      opponent: matchup.opponent,
      opponentCode: matchup.opponentCode,
      statValue: statValue != null ? round1(statValue) : null,
      pct,
      pctLabel: useThreeRate ? '3P%' : 'USG',
      boost: matchup.opponentCode
        ? (boostByTypeOpp.get(`${p.type}:${matchup.opponentCode}`) ?? null)
        : null,
    });
  }

  return picks.sort((a, b) => {
    const boostA = a.boost ?? -999;
    const boostB = b.boost ?? -999;
    if (boostB !== boostA) return boostB - boostA;
    return (b.statValue ?? 0) - (a.statValue ?? 0);
  });
}

function opponentCodeForGame(game: NblGameLogRow): string | null {
  return resolveNblSteTeamCode(game.opponentCode || game.opponent);
}

type UsableRow = { value: number; minutes: number; opp: string; playerId: string; name: string };

function collectTypeGames(group: TaggedPlayer[], stat: NblPlayTypeStatKey): UsableRow[] {
  const rows: UsableRow[] = [];
  for (const p of group) {
    const ownCode = resolveNblSteTeamCode(p.row.teamCode || p.row.team);
    for (const g of p.games) {
      const value = gameStatValue(g, stat);
      const minutes = num(g.minutes) ?? 0;
      const opp = opponentCodeForGame(g);
      if (value == null || minutes < MIN_GAME_MINUTES || !opp) continue;
      if (ownCode && opp === ownCode) continue;
      rows.push({ value, minutes, opp, playerId: p.row.playerId, name: p.row.name });
    }
  }
  return rows;
}

function namesFromRows(rows: UsableRow[]): string[] {
  const byPlayerMinutes = new Map<string, { name: string; minutes: number }>();
  for (const row of rows) {
    const prev = byPlayerMinutes.get(row.playerId);
    byPlayerMinutes.set(row.playerId, {
      name: row.name,
      minutes: (prev?.minutes ?? 0) + row.minutes,
    });
  }
  return [...byPlayerMinutes.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3)
    .map((row) => row.name);
}

/** Position DVP: what this team allows to the type vs the type's league average. */
function buildTypeMatchupCells(
  group: TaggedPlayer[],
  stat: NblPlayTypeStatKey
): Record<string, NblPlayTypeCell> {
  const cells: Record<string, NblPlayTypeCell> = {};
  for (const club of NBL_CLUBS) cells[club.code] = emptyCell();
  if (!group.length) return cells;

  const rows = collectTypeGames(group, stat);
  const league = weightedMean(rows);
  if (league == null) return cells;

  const allowedByCode = new Map<string, number>();
  for (const club of NBL_CLUBS) {
    const vs = rows.filter((row) => row.opp === club.code);
    const allowed = vs.length ? weightedMean(vs) : null;
    if (allowed != null) allowedByCode.set(club.code, allowed);
  }

  const ranked = [...allowedByCode.entries()].sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0])
  );
  const rankByCode = new Map<string, number>();
  ranked.forEach(([code], idx) => rankByCode.set(code, idx + 1));
  const fieldSize = ranked.length;

  for (const club of NBL_CLUBS) {
    const vs = rows.filter((row) => row.opp === club.code);
    if (!vs.length) continue;
    const allowed = allowedByCode.get(club.code);
    if (allowed == null) continue;
    const games = vs.length;
    const players = new Set(vs.map((row) => row.playerId)).size;
    const minutes = round1(vs.reduce((sum, row) => sum + row.minutes, 0));
    const shrink = games / (games + MATCHUP_SHRINK_K);
    const boost = (allowed - league) * shrink;
    cells[club.code] = {
      boost: round1(boost),
      allowed: round1(allowed),
      league: round1(league),
      rank: rankByCode.get(club.code) ?? null,
      fieldSize,
      games,
      players,
      minutes,
      significant:
        games >= SIGNIFICANT_GAMES && players >= SIGNIFICANT_PLAYERS && minutes >= SIGNIFICANT_MINUTES,
      names: namesFromRows(vs),
    };
  }
  return cells;
}

export function lookupNblPlayerPlayType(opts: {
  playerId?: string | null;
  playerName?: string | null;
}): NblPlayTypeId | null {
  const tagged = tagSeason(NBL_PLAY_TYPE_YEAR);
  const id = String(opts.playerId || '').trim();
  if (id) {
    const hit = tagged.find((p) => p.row.playerId === id);
    if (hit) return hit.type;
  }
  const name = String(opts.playerName || '').trim().toLowerCase();
  if (!name) return null;
  const exact = tagged.find((p) => p.row.name.toLowerCase() === name);
  if (exact) return exact.type;
  const loose = tagged.find((p) => {
    const taggedName = p.row.name.toLowerCase();
    return taggedName.includes(name) || name.includes(taggedName);
  });
  return loose?.type ?? null;
}

export function buildNblPlayTypesPayload(options: {
  year?: number;
  stat?: string;
  playerId?: string | null;
}): NblPlayTypesPayload {
  const year = options.year ?? NBL_PLAY_TYPE_YEAR;
  const stat = parseNblPlayTypeStat(options.stat);
  const rosterCount = loadLeaguePlayers(year).length;
  const tagged = tagSeason(year);
  const matrixPlayers = tagged.filter((p) => isQualifiedForMatrix(p, matrixMinGames(tagged)));
  const byType = new Map<NblPlayTypeId, TaggedPlayer[]>();
  for (const id of NBL_PLAY_TYPE_IDS) byType.set(id, []);
  for (const p of matrixPlayers) byType.get(p.type)?.push(p);

  const teams = NBL_CLUBS.map((c) => ({
    code: c.code,
    name: c.name,
    shortName: c.shortName,
  }));

  const rows: NblPlayTypeMatrixRow[] = NBL_PLAY_TYPE_IDS.map((type) => {
    const group = byType.get(type) || [];
    const cells = stat ? buildTypeMatchupCells(group, stat) : Object.fromEntries(
      NBL_CLUBS.map((club) => [club.code, emptyCell()])
    );
    return {
      type,
      label: NBL_PLAY_TYPE_LABELS[type],
      playerCount: group.length,
      gameCount: Object.values(cells).reduce((sum, cell) => sum + cell.games, 0),
      cells,
    };
  });

  const wantId = String(options.playerId || '').trim();
  const focus = wantId ? tagged.find((p) => p.row.playerId === wantId) : null;

  return {
    year,
    seasonLabel: nblSeasonLabel(year),
    stat,
    statLabel: stat ? NBL_PLAY_TYPE_STAT_LABELS[stat] : null,
    statSupported: stat != null,
    generatedAt: new Date().toISOString(),
    rosterCount,
    taggedCount: matrixPlayers.length,
    player: focus
      ? {
          playerId: focus.row.playerId,
          name: focus.row.name,
          team: focus.row.team,
          type: focus.type,
          typeLabel: NBL_PLAY_TYPE_LABELS[focus.type],
        }
      : null,
    teams,
    rows,
    players: matrixPlayers.map((p) => toPlayerRow(p, stat)).sort((a, b) => a.name.localeCompare(b.name)),
    roundPicks: buildRoundPicks(matrixPlayers, rows, stat),
  };
}
