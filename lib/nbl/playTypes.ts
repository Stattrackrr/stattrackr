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
} from '@/lib/nbl/playTypesShared';

const MIN_GAMES_FOR_CUTS = 8;
const MIN_MINUTES_FOR_CUTS = 12;
const MIN_MATRIX_MINUTES = 8;
const MIN_SHOTS_FOR_ZONES = 20;
const SIGNIFICANT_GAMES = 6;
const SIGNIFICANT_PLAYERS = 3;

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
  usg36: number;
  threeRate: number;
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

function loadPlayerGames(playerId: string, year: number): NblGameLogRow[] {
  const file = path.join(
    process.cwd(),
    'data',
    'nbl-model',
    'cache',
    'player-logs',
    `${playerId}-${year}.json`
  );
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

function buildFeatures(row: NblLeaguePlayerStatRow, year: number): PlayerFeatures | null {
  const allPlayed = loadPlayerGames(row.playerId, year);
  if (!allPlayed.length) return null;
  const roleGames = usableGames(allPlayed, MIN_MATRIX_MINUTES);
  const games = roleGames.length >= 3 ? roleGames : allPlayed;
  const minutes = games.reduce((s, g) => s + (num(g.minutes) ?? 0), 0);
  if (minutes <= 0) return null;
  const minutesAvg = minutes / games.length;

  let fga = 0;
  let fta = 0;
  let threeA = 0;
  let twoA = 0;
  let pts = 0;
  let ast = 0;
  for (const g of games) {
    fga += num(g.fgAttempted) ?? 0;
    fta += num(g.ftAttempted) ?? 0;
    threeA += num(g.threeAttempted) ?? 0;
    twoA += num(g.twoAttempted) ?? 0;
    pts += num(g.points) ?? 0;
    ast += num(g.assists) ?? 0;
  }

  const per36 = 36 / minutes;
  const zones = zonesForYear(row.name, year) ?? undefined;
  const hasZones = Boolean(zones);

  return {
    row,
    games: roleGames.length ? roleGames : games,
    pos: positionFamily(row.position),
    gamesUsed: games.length,
    minutes: minutesAvg,
    pts36: pts * per36,
    ast36: ast * per36,
    astPerGame: ast / games.length,
    usg36: (fga + 0.44 * fta) * per36,
    threeRate: fga > 0 ? threeA / fga : 0,
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
  const interior =
    restricted != null && paint != null ? restricted + paint : p.twoRate;
  const isBig = p.pos === 'C' || p.pos === 'F';
  const canHandle = p.pos !== 'C';

  // Elite passers count as handlers even with low scoring usage (Delly).
  if (
    canHandle &&
    p.astPerGame >= 3.8 &&
    p.ast36 >= cuts.astP80 &&
    (p.usg36 >= cuts.usgP45 || p.ast36 >= cuts.astP80 + 1)
  ) {
    return 'primary_bh';
  }
  if (canHandle && p.astPerGame >= 2.6 && p.ast36 >= cuts.astP65) {
    return 'secondary_bh';
  }
  if (p.pos === 'G' && (p.threeRate >= 0.5 || (p.threeShare ?? 0) >= 0.52)) {
    return 'three_shooter';
  }
  if (isBig && (p.threeRate >= 0.3 || (p.threeShare ?? 0) >= 0.35)) {
    return 'stretch_four';
  }
  if (
    isBig &&
    threeRate < 0.16 &&
    (restricted != null ? restricted >= 0.58 : p.pos === 'C' && p.twoRate >= 0.78)
  ) {
    return 'rim_runner';
  }
  if (
    isBig &&
    threeRate < 0.28 &&
    (paint != null ? paint >= 0.18 && interior >= 0.45 : p.twoRate >= 0.58)
  ) {
    return 'post_up';
  }
  if (
    p.pos !== 'C' &&
    threeRate < 0.42 &&
    (restricted != null && paint != null
      ? restricted + paint >= 0.45
      : p.twoRate >= 0.52 || p.ftRate >= 0.28)
  ) {
    return 'slasher';
  }
  return 'perimeter';
}

function gameStatValue(game: NblGameLogRow, stat: NblPlayTypeStatKey): number | null {
  switch (stat) {
    case 'assists':
      return num(game.assists);
    case 'threeMade':
      return num(game.threeMade);
    case 'pra':
      if (game.pra != null && Number.isFinite(Number(game.pra))) return Number(game.pra);
      {
        const pts = num(game.points);
        const reb = num(game.rebounds);
        const ast = num(game.assists);
        if (pts == null || reb == null || ast == null) return null;
        return pts + reb + ast;
      }
    case 'pa':
      if (game.pa != null && Number.isFinite(Number(game.pa))) return Number(game.pa);
      {
        const pts = num(game.points);
        const ast = num(game.assists);
        if (pts == null || ast == null) return null;
        return pts + ast;
      }
    case 'fgMade':
      return num(game.fgMade);
    case 'points':
    default:
      return num(game.points);
  }
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

type TaggedPlayer = PlayerFeatures & { type: NblPlayTypeId };

const taggedByYear = new Map<number, TaggedPlayer[]>();

function isQualifiedForCuts(p: PlayerFeatures): boolean {
  return p.gamesUsed >= MIN_GAMES_FOR_CUTS && p.minutes >= MIN_MINUTES_FOR_CUTS;
}

function tagSeason(year: number): TaggedPlayer[] {
  const cached = taggedByYear.get(year);
  if (cached) return cached;
  const league = loadLeaguePlayers(year);
  const features: PlayerFeatures[] = [];
  for (const row of league) {
    const feat = buildFeatures(row, year);
    if (feat) features.push(feat);
  }
  if (!features.length) return [];

  const cutPool = features.filter(isQualifiedForCuts);
  const pool = cutPool.length ? cutPool : features;
  const asts = pool.map((p) => p.ast36).sort((a, b) => a - b);
  const usgs = pool.map((p) => p.usg36).sort((a, b) => a - b);
  const cuts = {
    astP80: percentile(asts, 0.8),
    astP65: percentile(asts, 0.65),
    usgP45: percentile(usgs, 0.45),
  };

  const tagged = features.map((p) => ({ ...p, type: classifyPlayer(p, cuts) }));
  taggedByYear.set(year, tagged);
  return tagged;
}

function emptyCell(): NblPlayTypeCell {
  return { boost: null, games: 0, players: 0, significant: false };
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
  };
}

export function buildNblPlayTypesPayload(options: {
  year?: number;
  stat?: string;
  playerId?: string | null;
}): NblPlayTypesPayload {
  const year = NBL_PLAY_TYPE_YEAR;
  const stat = normalizeNblPlayTypeStat(options.stat);
  const rosterCount = loadLeaguePlayers(year).length;
  const tagged = tagSeason(year);
  const byType = new Map<NblPlayTypeId, TaggedPlayer[]>();
  for (const id of NBL_PLAY_TYPE_IDS) byType.set(id, []);
  for (const p of tagged) byType.get(p.type)?.push(p);

  const teams = NBL_CLUBS.map((c) => ({
    code: c.code,
    name: c.name,
    shortName: c.shortName,
  }));

  const rows: NblPlayTypeMatrixRow[] = NBL_PLAY_TYPE_IDS.map((type) => {
    const group = byType.get(type) || [];
    const cells: Record<string, NblPlayTypeCell> = {};
    for (const club of NBL_CLUBS) {
      const diffs: number[] = [];
      const playerIds = new Set<string>();
      for (const p of group) {
        const ownCode = resolveNblSteTeamCode(p.row.teamCode || p.row.team);
        if (ownCode === club.code) continue;
        const seasonVals = p.games
          .map((g) => gameStatValue(g, stat))
          .filter((v): v is number => v != null);
        const avg = mean(seasonVals);
        if (avg == null) continue;
        for (const g of p.games) {
          const opp = resolveNblSteTeamCode(g.opponentCode || g.opponent);
          if (opp !== club.code) continue;
          const val = gameStatValue(g, stat);
          if (val == null) continue;
          diffs.push(val - avg);
          playerIds.add(p.row.playerId);
        }
      }
      const boost = mean(diffs);
      const games = diffs.length;
      const players = playerIds.size;
      cells[club.code] = {
        boost: boost != null ? round1(boost) : null,
        games,
        players,
        significant: games >= SIGNIFICANT_GAMES && players >= SIGNIFICANT_PLAYERS,
      };
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
    statLabel: NBL_PLAY_TYPE_STAT_LABELS[stat],
    generatedAt: new Date().toISOString(),
    rosterCount,
    taggedCount: tagged.length,
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
    players: tagged.map(toPlayerRow).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
