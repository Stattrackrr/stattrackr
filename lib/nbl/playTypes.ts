/**
 * Tag NBL players into attacking play types from season logs + shot zones,
 * then build type × opponent boost cells (vs each player's own average).
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CLUBS,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';
import { resolveNblSteTeamCode } from '@/lib/nbl/teamSteStatsShared';
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
  type NblPlayTypesPayload,
  type NblPlayTypeStatKey,
} from '@/lib/nbl/playTypesShared';

export type {
  NblPlayTypeCell,
  NblPlayTypeId,
  NblPlayTypeMatrixRow,
  NblPlayTypePlayerRow,
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

const TAG_SCHEMA = 'v5';
const MIN_GAMES_FOR_TAG = 8;
const MIN_AVG_MINUTES_FOR_TAG = 15;
const MIN_GAME_MINUTES = 10;
const MIN_SHOTS_FOR_ZONES = 20;
const SIGNIFICANT_GAMES = 10;
const SIGNIFICANT_PLAYERS = 4;
const SIGNIFICANT_MINUTES = 140;
const MIN_BASELINE_GAMES = 3;

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

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, (sortedAsc.length - 1) * p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
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
  const id = String(matchId || '').trim();
  const code = resolveNblSteTeamCode(teamCode || team);
  if (!id || !code) return null;
  return `${id}::${code}`;
}

const teamTotalsByYear = new Map<number, Map<string, TeamGameTotals>>();

function loadYearTeamTotals(year: number): Map<string, TeamGameTotals> {
  const cached = teamTotalsByYear.get(year);
  if (cached) return cached;
  const totals = new Map<string, TeamGameTotals>();
  const dir = playerLogsDir();
  if (!fs.existsSync(dir)) {
    teamTotalsByYear.set(year, totals);
    return totals;
  }
  const suffix = `-${year}.json`;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(suffix)) continue;
    const games = loadPlayerGames(file.slice(0, -suffix.length), year);
    for (const g of games) {
      const key = teamGameKey(g.matchId, g.teamCode, g.team);
      if (!key) continue;
      const prev = totals.get(key) ?? { fga: 0, fta: 0, tov: 0, minutes: 0 };
      prev.fga += num(g.fgAttempted) ?? 0;
      prev.fta += num(g.ftAttempted) ?? 0;
      prev.tov += num(g.turnovers) ?? 0;
      prev.minutes += num(g.minutes) ?? 0;
      totals.set(key, prev);
    }
  }
  teamTotalsByYear.set(year, totals);
  return totals;
}

function gameUsagePct(game: NblGameLogRow, team: TeamGameTotals | undefined): number | null {
  const mp = num(game.minutes) ?? 0;
  if (mp < MIN_GAME_MINUTES || !team || team.minutes <= 0) return null;
  const playerPoss =
    (num(game.fgAttempted) ?? 0) + 0.44 * (num(game.ftAttempted) ?? 0) + (num(game.turnovers) ?? 0);
  const teamPoss = team.fga + 0.44 * team.fta + team.tov;
  if (teamPoss <= 0) return null;
  return (100 * playerPoss * (team.minutes / 5)) / (mp * teamPoss);
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
  if ((chart.shotCount ?? 0) < MIN_SHOTS_FOR_ZONES) return null;
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
  if (games.length < 3) return null;
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

function classifyPlayer(
  p: PlayerFeatures,
  cuts: { astP80: number; astP65: number; usgP45: number }
): NblPlayTypeId {
  const threeRate = p.threeShare != null ? Math.max(p.threeRate, p.threeShare) : p.threeRate;
  const restricted = p.restrictedShare;
  const paint = p.paintShare;
  const isGuard = p.pos === 'G';
  const isCenter = p.pos === 'C';
  const isBig = p.pos === 'C' || p.pos === 'F';
  const stretchCut = isCenter ? 0.34 : 0.4;
  const usageOk = p.usgPct != null && p.usgPct >= cuts.usgP45;

  // Ball-handlers are guards. Forwards with assists are stretch/slash/interior, not BH.
  if (
    isGuard &&
    p.astPerGame >= 3.6 &&
    p.ast36 >= cuts.astP80 &&
    (usageOk || p.ast36 >= cuts.astP80 + 0.8)
  ) {
    return 'primary_bh';
  }
  if (isGuard && p.astPerGame >= 2.5 && p.ast36 >= cuts.astP65 && threeRate < 0.62) {
    return 'secondary_bh';
  }
  if (
    isGuard &&
    p.threeMade >= 1.15 &&
    (p.threeRate >= 0.47 || (p.threeShare ?? 0) >= 0.48) &&
    p.astPerGame < 4
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
  if (isGuard && p.threeMade >= 0.9 && (p.threeRate >= 0.44 || (p.threeShare ?? 0) >= 0.46)) {
    return 'three_shooter';
  }
  return isCenter ? 'post_up' : 'slasher';
}

function gameStatValue(game: NblGameLogRow, stat: NblPlayTypeStatKey): number | null {
  switch (stat) {
    case 'assists':
      return num(game.assists);
    case 'rebounds':
      return num(game.rebounds);
    case 'threeMade':
      return num(game.threeMade);
    case 'steals':
      return num(game.steals);
    case 'blocks':
      return num(game.blocks);
    case 'pra':
      if (game.pra != null && Number.isFinite(Number(game.pra))) return Number(game.pra);
      {
        const pts = num(game.points);
        const reb = num(game.rebounds);
        const ast = num(game.assists);
        if (pts == null || reb == null || ast == null) return null;
        return pts + reb + ast;
      }
    case 'pr':
      if (game.pr != null && Number.isFinite(Number(game.pr))) return Number(game.pr);
      {
        const pts = num(game.points);
        const reb = num(game.rebounds);
        if (pts == null || reb == null) return null;
        return pts + reb;
      }
    case 'pa':
      if (game.pa != null && Number.isFinite(Number(game.pa))) return Number(game.pa);
      {
        const pts = num(game.points);
        const ast = num(game.assists);
        if (pts == null || ast == null) return null;
        return pts + ast;
      }
    case 'ra':
      if (game.ra != null && Number.isFinite(Number(game.ra))) return Number(game.ra);
      {
        const reb = num(game.rebounds);
        const ast = num(game.assists);
        if (reb == null || ast == null) return null;
        return reb + ast;
      }
    case 'fgMade':
      return num(game.fgMade);
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

type TaggedPlayer = PlayerFeatures & { type: NblPlayTypeId };

const taggedByYear = new Map<string, TaggedPlayer[]>();

function isQualifiedForMatrix(p: PlayerFeatures): boolean {
  return p.gamesUsed >= MIN_GAMES_FOR_TAG && p.minutes >= MIN_AVG_MINUTES_FOR_TAG;
}

function tagSeason(year: number): TaggedPlayer[] {
  const cacheKey = `${year}:${TAG_SCHEMA}`;
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

  const cutPool = features.filter(isQualifiedForMatrix);
  const pool = cutPool.length ? cutPool : features;
  const asts = pool.map((p) => p.ast36).sort((a, b) => a - b);
  const usgs = pool
    .map((p) => p.usgPct)
    .filter((n): n is number => n != null && Number.isFinite(n))
    .sort((a, b) => a - b);
  const cuts = {
    astP80: percentile(asts, 0.8),
    astP65: percentile(asts, 0.65),
    usgP45: percentile(usgs, 0.45),
  };

  const tagged = features.map((p) => ({ ...p, type: classifyPlayer(p, cuts) }));
  taggedByYear.set(cacheKey, tagged);
  return tagged;
}

function emptyCell(): NblPlayTypeCell {
  return { boost: null, games: 0, players: 0, minutes: 0, significant: false, names: [] };
}

function toPlayerRow(p: TaggedPlayer): NblPlayTypePlayerRow {
  return {
    playerId: p.row.playerId,
    name: p.row.name,
    team: p.row.team,
    teamCode: p.row.teamCode,
    position: p.row.position,
    type: p.type,
    games: p.gamesUsed,
    minutes: round1(p.minutes),
    points: p.row.points != null ? round1(Number(p.row.points)) : null,
    assists: p.row.assists != null ? round1(Number(p.row.assists)) : null,
    threeRate: round1(p.threeRate * 100),
    usgPct: p.usgPct != null ? round1(p.usgPct) : null,
  };
}

function opponentCodeForGame(game: NblGameLogRow): string | null {
  return resolveNblSteTeamCode(game.opponentCode || game.opponent);
}

function buildCellForOpponent(
  group: TaggedPlayer[],
  clubCode: string,
  stat: NblPlayTypeStatKey
): NblPlayTypeCell {
  const weighted: Array<{ value: number; minutes: number; playerId: string; name: string }> = [];
  for (const p of group) {
    if (!isQualifiedForMatrix(p)) continue;
    const ownCode = resolveNblSteTeamCode(p.row.teamCode || p.row.team);
    if (ownCode === clubCode) continue;

    const usable = p.games
      .map((g) => {
        const value = gameStatValue(g, stat);
        const minutes = num(g.minutes) ?? 0;
        const opp = opponentCodeForGame(g);
        if (value == null || minutes < MIN_GAME_MINUTES || !opp) return null;
        return { value, minutes, opp };
      })
      .filter((row): row is { value: number; minutes: number; opp: string } => row != null);

    const vs = usable.filter((row) => row.opp === clubCode);
    if (!vs.length) continue;
    const baselineRows = usable.filter((row) => row.opp !== clubCode);
    if (baselineRows.length < MIN_BASELINE_GAMES) continue;
    const baseline = weightedMean(baselineRows);
    if (baseline == null) continue;

    for (const row of vs) {
      weighted.push({
        value: row.value - baseline,
        minutes: row.minutes,
        playerId: p.row.playerId,
        name: p.row.name,
      });
    }
  }

  if (!weighted.length) return emptyCell();

  const byPlayerMinutes = new Map<string, { name: string; minutes: number }>();
  for (const row of weighted) {
    const prev = byPlayerMinutes.get(row.playerId);
    byPlayerMinutes.set(row.playerId, {
      name: row.name,
      minutes: (prev?.minutes ?? 0) + row.minutes,
    });
  }
  const names = [...byPlayerMinutes.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3)
    .map((row) => row.name);

  const games = weighted.length;
  const players = byPlayerMinutes.size;
  const minutes = round1(weighted.reduce((sum, row) => sum + row.minutes, 0));
  const boost = weightedMean(weighted);

  return {
    boost: boost != null ? round1(boost) : null,
    games,
    players,
    minutes,
    significant: games >= SIGNIFICANT_GAMES && players >= SIGNIFICANT_PLAYERS && minutes >= SIGNIFICANT_MINUTES,
    names,
  };
}

export function buildNblPlayTypesPayload(options: {
  year?: number;
  stat?: string;
  playerId?: string | null;
}): NblPlayTypesPayload {
  const year = NBL_PLAY_TYPE_YEAR;
  const stat = parseNblPlayTypeStat(options.stat);
  const rosterCount = loadLeaguePlayers(year).length;
  const tagged = tagSeason(year);
  const matrixPlayers = tagged.filter(isQualifiedForMatrix);
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
    const cells: Record<string, NblPlayTypeCell> = {};
    for (const club of NBL_CLUBS) {
      cells[club.code] = stat ? buildCellForOpponent(group, club.code, stat) : emptyCell();
    }
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
    players: matrixPlayers.map(toPlayerRow).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
