/**
 * Tag NBA players into attacking play types from usage + shot zones, then build
 * type × opponent boost cells (what each defense allows to the type vs league average).
 * Per team, the highest-usage creator is Primary BH and the next is Second BH.
 */
import { NBA_CLUBS, nbaSeasonLabel } from './teams';
import { getNbaSeasonDataset, resolveNbaDataSeason, type NbaSeasonDataset } from './season';
import { nbaPlayerZoneShares } from './shotChart';
import { loadNbaUpcomingGames } from './server';
import { resolveNbaSteTeamCode } from './teamSteStatsShared';
import type { NbaGameLogRow, NbaLeaguePlayerStatRow } from './types';
import {
  NBA_PLAY_TYPE_IDS,
  NBA_PLAY_TYPE_LABELS,
  NBA_PLAY_TYPE_STAT_LABELS,
  parseNbaPlayTypeStat,
  type NbaPlayTypeCell,
  type NbaPlayTypeId,
  type NbaPlayTypeMatrixRow,
  type NbaPlayTypePlayerRow,
  type NbaPlayTypeRoundPick,
  type NbaPlayTypesPayload,
  type NbaPlayTypeStatKey,
} from './playTypesShared';

const MIN_GAMES_FOR_TAG = 8;
const MIN_AVG_MINUTES_FOR_TAG = 15;
const MIN_GAME_MINUTES = 10;
const MIN_SHOTS_FOR_ZONES = 40;
const MIN_SECOND_BH_USG = 18;
const SIGNIFICANT_GAMES = 15;
const SIGNIFICANT_PLAYERS = 4;
const SIGNIFICANT_MINUTES = 300;
const MATCHUP_SHRINK_K = 3;

type PosFamily = 'G' | 'F' | 'C';

type PlayerFeatures = {
  row: NbaLeaguePlayerStatRow;
  games: NbaGameLogRow[];
  pos: PosFamily;
  gamesUsed: number;
  minutes: number;
  astPerGame: number;
  usgPct: number | null;
  threeRate: number;
  threeMade: number;
  ftRate: number;
  twoRate: number;
  restrictedShare: number | null;
  paintShare: number | null;
  threeShare: number | null;
};

type TaggedPlayer = PlayerFeatures & { type: NbaPlayTypeId };

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

function positionFamily(pos: string | null | undefined): PosFamily {
  const raw = String(pos || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (raw.includes('C') && !raw.includes('G')) return 'C';
  if (raw.startsWith('C')) return 'C';
  if (raw.includes('F')) return 'F';
  return 'G';
}

function weightedMean(rows: Array<{ value: number; minutes: number }>): number | null {
  const weight = rows.reduce((s, r) => s + r.minutes, 0);
  if (weight <= 0) return null;
  return rows.reduce((s, r) => s + r.value * r.minutes, 0) / weight;
}

function buildFeatures(
  row: NbaLeaguePlayerStatRow,
  data: NbaSeasonDataset,
  zones: Awaited<ReturnType<typeof nbaPlayerZoneShares>>
): PlayerFeatures | null {
  const all = (data.logsByPlayer.get(row.playerId) ?? []).filter((g) => !g.postseason);
  const games = all.filter((g) => (num(g.minutes) ?? 0) >= MIN_GAME_MINUTES);
  if (!games.length) return null;
  const minutes = games.reduce((s, g) => s + (num(g.minutes) ?? 0), 0);
  if (minutes <= 0) return null;

  let fga = 0, fta = 0, threeA = 0, twoA = 0, ast = 0, tpm = 0;
  const usg: Array<{ value: number; minutes: number }> = [];
  for (const g of games) {
    fga += num(g.fgAttempted) ?? 0;
    fta += num(g.ftAttempted) ?? 0;
    threeA += num(g.threeAttempted) ?? 0;
    twoA += num(g.twoAttempted) ?? 0;
    ast += num(g.assists) ?? 0;
    tpm += num(g.threeMade) ?? 0;
    const u = num(g.usgPct);
    if (u != null) usg.push({ value: u, minutes: num(g.minutes) ?? 0 });
  }
  const z = zones.get(row.playerId);
  const hasZones = !!z && z.shots >= MIN_SHOTS_FOR_ZONES;
  return {
    row,
    games,
    pos: positionFamily(row.position),
    gamesUsed: games.length,
    minutes: minutes / games.length,
    astPerGame: ast / games.length,
    usgPct: weightedMean(usg),
    threeRate: fga > 0 ? threeA / fga : 0,
    threeMade: tpm / games.length,
    ftRate: fga > 0 ? fta / fga : 0,
    twoRate: fga > 0 ? twoA / fga : 0,
    restrictedShare: hasZones ? z!.restricted : null,
    paintShare: hasZones ? z!.paint : null,
    threeShare: hasZones ? z!.three : null,
  };
}

const threeRateOf = (p: PlayerFeatures) => (p.threeShare != null ? Math.max(p.threeRate, p.threeShare) : p.threeRate);

function isInteriorOnly(p: PlayerFeatures): boolean {
  if (p.pos === 'G' || p.astPerGame >= 3 || threeRateOf(p) >= 0.33) return false;
  if (p.restrictedShare != null) {
    return p.restrictedShare >= 0.42 || (p.paintShare != null && p.paintShare + p.restrictedShare >= 0.55);
  }
  return p.twoRate >= 0.7;
}

const isPureThreeSpacer = (p: PlayerFeatures) => threeRateOf(p) >= 0.55 && p.astPerGame < 4;

function isBallHandlerCandidate(p: PlayerFeatures): boolean {
  if (p.usgPct == null || !Number.isFinite(p.usgPct)) return false;
  if (isInteriorOnly(p) || isPureThreeSpacer(p)) return false;
  if (p.pos === 'G') return true;
  return p.astPerGame >= 3.5;
}

function classifyScoringRole(p: PlayerFeatures): NbaPlayTypeId {
  const threeRate = threeRateOf(p);
  const restricted = p.restrictedShare;
  const paint = p.paintShare;
  const isGuard = p.pos === 'G';
  const isCenter = p.pos === 'C';
  const isBig = p.pos === 'C' || p.pos === 'F';
  const stretchCut = isCenter ? 0.34 : 0.45;

  if (isGuard && p.threeMade >= 1.5 && threeRate >= 0.5) return 'three_shooter';
  if (isBig && threeRate >= stretchCut) return 'stretch_four';
  if (
    isBig &&
    threeRate < 0.3 &&
    (restricted != null ? restricted >= 0.42 || (paint != null && paint + restricted >= 0.55) : p.twoRate >= 0.7)
  ) {
    return 'post_up';
  }
  if (
    !isCenter &&
    threeRate < 0.5 &&
    (restricted != null && paint != null ? restricted + paint >= 0.4 : p.twoRate >= 0.55 || p.ftRate >= 0.28)
  ) {
    return 'slasher';
  }
  if (!isBig && p.threeMade >= 1.2 && threeRate >= 0.45) return 'three_shooter';
  return isCenter ? 'post_up' : 'slasher';
}

function assignPlayTypes(features: PlayerFeatures[], minGames: number): TaggedPlayer[] {
  const typeById = new Map<string, NbaPlayTypeId>();
  const byTeam = new Map<string, PlayerFeatures[]>();
  for (const p of features) {
    if (p.minutes < MIN_AVG_MINUTES_FOR_TAG) continue;
    const code = resolveNbaSteTeamCode(p.row.teamCode || p.row.team) || '_';
    byTeam.set(code, [...(byTeam.get(code) ?? []), p]);
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
    if (handlers[0]) typeById.set(handlers[0].row.playerId, 'primary_bh');
    if (handlers[1] && (handlers[1].usgPct ?? 0) >= MIN_SECOND_BH_USG) {
      typeById.set(handlers[1].row.playerId, 'secondary_bh');
    }
  }
  return features.map((p) => ({ ...p, type: typeById.get(p.row.playerId) ?? classifyScoringRole(p) }));
}

const sumParts = (parts: Array<number | null>) =>
  parts.some((v) => v == null) ? null : parts.reduce<number>((s, v) => s + (v as number), 0);

function gameStatValue(g: NbaGameLogRow, stat: NbaPlayTypeStatKey): number | null {
  const p = num(g.points), r = num(g.rebounds), a = num(g.assists);
  switch (stat) {
    case 'assists': return a;
    case 'rebounds': return r;
    case 'pra': return sumParts([p, r, a]);
    case 'pr': return sumParts([p, r]);
    case 'pa': return sumParts([p, a]);
    case 'ra': return sumParts([r, a]);
    case 'points': return p;
  }
}

function seasonStatValue(row: NbaLeaguePlayerStatRow, stat: NbaPlayTypeStatKey): number | null {
  const p = num(row.points), r = num(row.rebounds), a = num(row.assists);
  switch (stat) {
    case 'assists': return a;
    case 'rebounds': return r;
    case 'pra': return sumParts([p, r, a]);
    case 'pr': return sumParts([p, r]);
    case 'pa': return sumParts([p, a]);
    case 'ra': return sumParts([r, a]);
    case 'points': return p;
  }
}

function medianInt(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

function matrixMinGames(players: PlayerFeatures[]): number {
  const byTeam = new Map<string, number>();
  for (const p of players) {
    const code = resolveNbaSteTeamCode(p.row.teamCode || p.row.team);
    if (!code || p.gamesUsed <= 0) continue;
    byTeam.set(code, Math.max(byTeam.get(code) ?? 0, p.gamesUsed));
  }
  const played = [...byTeam.values()];
  if (!played.length) return MIN_GAMES_FOR_TAG;
  return Math.max(1, Math.min(MIN_GAMES_FOR_TAG, medianInt(played)));
}

const isQualifiedForMatrix = (p: PlayerFeatures, minGames: number) =>
  p.gamesUsed >= minGames && p.minutes >= MIN_AVG_MINUTES_FOR_TAG;

const taggedCache = new Map<string, Promise<TaggedPlayer[]>>();

async function tagSeason(season: number): Promise<TaggedPlayer[]> {
  const data = await getNbaSeasonDataset(season);
  const key = `${season}:${data.loadedAt}`;
  let hit = taggedCache.get(key);
  if (!hit) {
    hit = (async () => {
      const zones = await nbaPlayerZoneShares(season);
      const features = data.league
        .map((row) => buildFeatures(row, data, zones))
        .filter((f): f is PlayerFeatures => !!f);
      return features.length ? assignPlayTypes(features, matrixMinGames(features)) : [];
    })();
    for (const k of taggedCache.keys()) if (k.startsWith(`${season}:`)) taggedCache.delete(k);
    taggedCache.set(key, hit);
  }
  return hit;
}

function emptyCell(): NbaPlayTypeCell {
  return {
    boost: null, allowed: null, league: null, rank: null, fieldSize: NBA_CLUBS.length,
    games: 0, players: 0, minutes: 0, significant: false, names: [],
  };
}

type UsableRow = { value: number; minutes: number; opp: string; playerId: string; name: string };

function collectTypeGames(group: TaggedPlayer[], stat: NbaPlayTypeStatKey): UsableRow[] {
  const rows: UsableRow[] = [];
  for (const p of group) {
    for (const g of p.games) {
      const value = gameStatValue(g, stat);
      const minutes = num(g.minutes) ?? 0;
      const opp = g.opponentCode;
      if (value == null || minutes < MIN_GAME_MINUTES || !opp) continue;
      rows.push({ value, minutes, opp, playerId: p.row.playerId, name: p.row.name });
    }
  }
  return rows;
}

function namesFromRows(rows: UsableRow[]): string[] {
  const byPlayer = new Map<string, { name: string; minutes: number }>();
  for (const r of rows) {
    const prev = byPlayer.get(r.playerId);
    byPlayer.set(r.playerId, { name: r.name, minutes: (prev?.minutes ?? 0) + r.minutes });
  }
  return [...byPlayer.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 3).map((r) => r.name);
}

function buildTypeMatchupCells(group: TaggedPlayer[], stat: NbaPlayTypeStatKey): Record<string, NbaPlayTypeCell> {
  const cells: Record<string, NbaPlayTypeCell> = {};
  for (const club of NBA_CLUBS) cells[club.code] = emptyCell();
  if (!group.length) return cells;
  const rows = collectTypeGames(group, stat);
  const league = weightedMean(rows);
  if (league == null) return cells;

  const byOpp = new Map<string, UsableRow[]>();
  for (const r of rows) byOpp.set(r.opp, [...(byOpp.get(r.opp) ?? []), r]);
  const allowedByCode = new Map<string, number>();
  for (const [code, vs] of byOpp) {
    const allowed = weightedMean(vs);
    if (allowed != null) allowedByCode.set(code, allowed);
  }
  const ranked = [...allowedByCode].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const rankByCode = new Map(ranked.map(([code], idx) => [code, idx + 1]));

  for (const club of NBA_CLUBS) {
    const vs = byOpp.get(club.code);
    const allowed = allowedByCode.get(club.code);
    if (!vs?.length || allowed == null) continue;
    const games = vs.length;
    const players = new Set(vs.map((r) => r.playerId)).size;
    const minutes = round1(vs.reduce((s, r) => s + r.minutes, 0));
    const shrink = games / (games + MATCHUP_SHRINK_K);
    cells[club.code] = {
      boost: round1((allowed - league) * shrink),
      allowed: round1(allowed),
      league: round1(league),
      rank: rankByCode.get(club.code) ?? null,
      fieldSize: ranked.length,
      games,
      players,
      minutes,
      significant: games >= SIGNIFICANT_GAMES && players >= SIGNIFICANT_PLAYERS && minutes >= SIGNIFICANT_MINUTES,
      names: namesFromRows(vs),
    };
  }
  return cells;
}

function toPlayerRow(p: TaggedPlayer, stat: NbaPlayTypeStatKey | null): NbaPlayTypePlayerRow {
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

async function buildRoundPicks(
  matrixPlayers: TaggedPlayer[],
  rows: NbaPlayTypeMatrixRow[],
  stat: NbaPlayTypeStatKey | null
): Promise<NbaPlayTypeRoundPick[]> {
  if (!stat) return [];
  const games = await loadNbaUpcomingGames(1).catch(() => []);
  if (!games.length) return [];
  const opponentByTeam = new Map<string, { opponent: string; opponentCode: string | null }>();
  for (const g of games) {
    if (g.homeTeamCode) opponentByTeam.set(g.homeTeamCode, { opponent: g.awayTeam, opponentCode: g.awayTeamCode });
    if (g.awayTeamCode) opponentByTeam.set(g.awayTeamCode, { opponent: g.homeTeam, opponentCode: g.homeTeamCode });
  }
  const boostByTypeOpp = new Map<string, number | null>();
  for (const row of rows) {
    for (const [code, cell] of Object.entries(row.cells)) boostByTypeOpp.set(`${row.type}:${code}`, cell.boost);
  }
  const picks: NbaPlayTypeRoundPick[] = [];
  for (const p of matrixPlayers) {
    const teamCode = p.row.teamCode;
    const matchup = teamCode ? opponentByTeam.get(teamCode) : null;
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
      typeLabel: NBA_PLAY_TYPE_LABELS[p.type],
      opponent: matchup.opponent,
      opponentCode: matchup.opponentCode,
      statValue: statValue != null ? round1(statValue) : null,
      pct,
      pctLabel: useThreeRate ? '3P%' : 'USG',
      boost: matchup.opponentCode ? boostByTypeOpp.get(`${p.type}:${matchup.opponentCode}`) ?? null : null,
    });
  }
  return picks.sort((a, b) => (b.boost ?? -999) - (a.boost ?? -999) || (b.statValue ?? 0) - (a.statValue ?? 0));
}

export async function lookupNbaPlayerPlayType(opts: { playerId?: string | null; playerName?: string | null }) {
  const season = await resolveNbaDataSeason();
  const tagged = await tagSeason(season);
  const id = String(opts.playerId || '').trim();
  if (id) {
    const hit = tagged.find((p) => p.row.playerId === id);
    if (hit) return hit.type;
  }
  const name = String(opts.playerName || '').trim().toLowerCase();
  if (!name) return null;
  return tagged.find((p) => p.row.name.toLowerCase() === name)?.type ?? null;
}

export async function buildNbaPlayTypesPayload(options: {
  year?: number;
  stat?: string;
  playerId?: string | null;
}): Promise<NbaPlayTypesPayload> {
  const year = await resolveNbaDataSeason(options.year);
  const stat = parseNbaPlayTypeStat(options.stat);
  const data = await getNbaSeasonDataset(year);
  const tagged = await tagSeason(year);
  const minGames = matrixMinGames(tagged);
  const matrixPlayers = tagged.filter((p) => isQualifiedForMatrix(p, minGames));
  const byType = new Map<NbaPlayTypeId, TaggedPlayer[]>(NBA_PLAY_TYPE_IDS.map((id) => [id, []]));
  for (const p of matrixPlayers) byType.get(p.type)?.push(p);

  const rows: NbaPlayTypeMatrixRow[] = NBA_PLAY_TYPE_IDS.map((type) => {
    const group = byType.get(type) || [];
    const cells = stat
      ? buildTypeMatchupCells(group, stat)
      : Object.fromEntries(NBA_CLUBS.map((c) => [c.code, emptyCell()]));
    return {
      type,
      label: NBA_PLAY_TYPE_LABELS[type],
      playerCount: group.length,
      gameCount: Object.values(cells).reduce((s, c) => s + c.games, 0),
      cells,
    };
  });

  const wantId = String(options.playerId || '').trim();
  const focus = wantId ? tagged.find((p) => p.row.playerId === wantId) : null;

  return {
    year,
    seasonLabel: nbaSeasonLabel(year),
    stat,
    statLabel: stat ? NBA_PLAY_TYPE_STAT_LABELS[stat] : null,
    statSupported: stat != null,
    generatedAt: new Date().toISOString(),
    rosterCount: data.league.length,
    taggedCount: matrixPlayers.length,
    player: focus
      ? {
          playerId: focus.row.playerId,
          name: focus.row.name,
          team: focus.row.team,
          type: focus.type,
          typeLabel: NBA_PLAY_TYPE_LABELS[focus.type],
        }
      : null,
    teams: NBA_CLUBS.map((c) => ({ code: c.code, name: c.name, shortName: c.shortName })),
    rows,
    players: matrixPlayers.map((p) => toPlayerRow(p, stat)).sort((a, b) => a.name.localeCompare(b.name)),
    roundPicks: await buildRoundPicks(matrixPlayers, rows, stat),
  };
}
