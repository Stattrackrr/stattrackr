/**
 * Jeff Sackmann ATP / WTA match CSVs — cache-only tennis research feed.
 * Women → WTA files, men → ATP files. Grand Slams (tourney_level G) are
 * still split by gender in the source files; the UI labels them as slams.
 */

import fs from 'fs';
import path from 'path';
import { TENNIS_CURRENT_YEAR, TENNIS_HISTORY_YEARS } from '@/lib/tennis/constants';
import { isUnplayedTennisMatch, tennisDominanceRatio } from '@/lib/tennis/chartStats';
import {
  TENNIS_DVP_METRICS,
  TENNIS_DVP_MIN_MATCHES,
  type TennisDvpMetricKey,
} from '@/lib/tennis/dvpShared';

export type TennisTour = 'ATP' | 'WTA';
export { TENNIS_CURRENT_YEAR, TENNIS_HISTORY_YEARS };

const GRAND_SLAM_NAMES = [
  'australian open',
  'roland garros',
  'french open',
  'wimbledon',
  'us open',
];

export function tennisDataDir(): string {
  return path.join(process.cwd(), 'data', 'tennis');
}

export function tennisMatchesPath(tour: TennisTour, year: number): string {
  const prefix = tour === 'ATP' ? 'atp' : 'wta';
  return path.join(tennisDataDir(), `${prefix}_matches_${year}.csv`);
}

export function tennisRankingsPath(tour: TennisTour): string {
  const prefix = tour === 'ATP' ? 'atp' : 'wta';
  return path.join(tennisDataDir(), `${prefix}_rankings_current.csv`);
}

export type TennisMatchRow = {
  matchId: string;
  tour: TennisTour;
  season: number;
  tourneyId: string;
  tourneyName: string;
  tourneyLevel: string;
  isGrandSlam: boolean;
  surface: string;
  date: string | null;
  tourneyDate: string | null;
  round: string;
  score: string;
  bestOf: number;
  minutes: number | null;
  drawSize: number | null;
  playerId: string;
  playerName: string;
  opponentId: string;
  opponent: string;
  opponentIoc: string | null;
  opponentRank: number | null;
  opponentRankPoints: number | null;
  playerRank: number | null;
  rankPoints: number | null;
  seed: number | null;
  entry: string | null;
  height: number | null;
  age: number | null;
  isWin: boolean;
  result: string;
  team: string;
  teamCode: string;
  venue: string | null;
  isHome: boolean;
  moneyline: number;
  gamesWon: number | null;
  gamesLost: number | null;
  totalGames: number | null;
  spread: number | null;
  setsWon: number | null;
  setsLost: number | null;
  totalSets: number | null;
  dominanceRatio: number | null;
  aces: number | null;
  opponentAces: number | null;
  totalAces: number | null;
  doubleFaults: number | null;
  servePoints: number | null;
  serveGames: number | null;
  firstServesIn: number | null;
  firstServesWon: number | null;
  secondServeAttempts: number | null;
  secondServesWon: number | null;
  firstServePct: number | null;
  firstServeWonPct: number | null;
  secondServeWonPct: number | null;
  servicePointsWonPct: number | null;
  breakPointsSaved: number | null;
  breakPointsFaced: number | null;
  breakPointsSavedPct: number | null;
  breakPointsConverted: number | null;
  breakPointsConvertedPct: number | null;
  returnPointsWon: number | null;
  returnPointsWonPct: number | null;
  pointsWon: number | null;
  servePointsWon: number | null;
  totalPoints: number | null;
  hand: string | null;
  opponentHand: string | null;
  ioc: string | null;
};

export type TennisPlayer = {
  playerId: string;
  name: string;
  tour: TennisTour;
  ioc: string | null;
  hand: string | null;
  height: number | null;
  rank: number | null;
  rankPoints: number | null;
};

export type TennisRankingRow = {
  pos: number;
  playerId: string;
  name: string;
  tour: TennisTour;
  points: number | null;
  ioc: string | null;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function toNum(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(yyyymmdd: string | undefined): string | null {
  const raw = String(yyyymmdd || '').trim();
  if (!/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

type TennisScheduleKind = 'slam' | 'masters96' | 'masters56' | 'week' | 'finals' | 'team';

function tennisScheduleKind(level: string, drawSize: number | null, name: string): TennisScheduleKind {
  const lv = String(level || '').toUpperCase();
  const draw = drawSize ?? 32;
  const n = String(name || '').toLowerCase();
  if (lv === 'G' || draw >= 128) return 'slam';
  if (lv === 'D' || /davis cup|billie jean|united cup/.test(n)) return lv === 'D' ? 'team' : 'finals';
  if (lv === 'F' || /tour finals|atp finals|wta finals|next gen/.test(n)) return 'finals';
  if (draw >= 96) return 'masters96';
  if (draw >= 48) return 'masters56';
  return 'week';
}

const ROUND_DAY: Record<TennisScheduleKind, Record<string, { start: number; span: number }>> = {
  slam: {
    R128: { start: 0, span: 3 },
    R64: { start: 2, span: 3 },
    R32: { start: 4, span: 3 },
    R16: { start: 7, span: 2 },
    QF: { start: 9, span: 2 },
    SF: { start: 11, span: 2 },
    F: { start: 13, span: 1 },
    RR: { start: 0, span: 6 },
  },
  masters96: {
    R128: { start: 0, span: 2 },
    R64: { start: 1, span: 3 },
    R32: { start: 3, span: 3 },
    R16: { start: 5, span: 2 },
    QF: { start: 7, span: 2 },
    SF: { start: 9, span: 2 },
    F: { start: 11, span: 1 },
    RR: { start: 0, span: 5 },
  },
  masters56: {
    R64: { start: 0, span: 3 },
    R32: { start: 2, span: 3 },
    R16: { start: 4, span: 2 },
    QF: { start: 5, span: 2 },
    SF: { start: 6, span: 2 },
    F: { start: 7, span: 1 },
    RR: { start: 0, span: 4 },
  },
  week: {
    R64: { start: 0, span: 2 },
    R32: { start: 0, span: 2 },
    R16: { start: 2, span: 2 },
    QF: { start: 3, span: 2 },
    SF: { start: 5, span: 2 },
    F: { start: 6, span: 1 },
    RR: { start: 0, span: 4 },
  },
  finals: {
    RR: { start: 0, span: 5 },
    QF: { start: 3, span: 2 },
    SF: { start: 5, span: 1 },
    F: { start: 6, span: 1 },
  },
  team: {
    RR: { start: 0, span: 3 },
    R16: { start: 0, span: 2 },
    QF: { start: 0, span: 2 },
    SF: { start: 1, span: 2 },
    F: { start: 2, span: 1 },
  },
};

const ROUND_SORT: Record<string, number> = {
  R128: 1,
  R64: 2,
  R32: 3,
  R16: 4,
  QF: 5,
  RR: 5,
  SF: 6,
  BR: 7,
  F: 8,
};

function roundSortValue(round: string | null | undefined): number {
  return ROUND_SORT[String(round || '').toUpperCase().trim()] ?? 0;
}

function roundDaySpec(
  kind: TennisScheduleKind,
  round: string,
  tour: TennisTour
): { start: number; span: number } {
  const key = String(round || '').toUpperCase().trim();
  if (kind === 'slam' && tour === 'WTA') {
    if (key === 'QF') return { start: 8, span: 2 };
    if (key === 'SF') return { start: 10, span: 2 };
    if (key === 'F') return { start: 12, span: 1 };
  }
  return ROUND_DAY[kind][key] ?? { start: 0, span: 1 };
}

function estimateTourneyMatchDates(
  tour: TennisTour,
  headers: string[],
  rows: string[][]
): Map<string[], string | null> {
  const out = new Map<string[], string | null>();
  const byTourney = new Map<string, string[][]>();
  for (const row of rows) {
    const id = col(headers, row, 'tourney_id') || `row-${byTourney.size}`;
    const list = byTourney.get(id);
    if (list) list.push(row);
    else byTourney.set(id, [row]);
  }
  for (const tRows of byTourney.values()) {
    const tourneyDate = toDate(col(headers, tRows[0], 'tourney_date'));
    if (!tourneyDate) {
      for (const row of tRows) out.set(row, null);
      continue;
    }
    const drawSize = toNum(col(headers, tRows[0], 'draw_size'));
    const level = col(headers, tRows[0], 'tourney_level');
    const name = col(headers, tRows[0], 'tourney_name');
    const kind = tennisScheduleKind(level, drawSize, name);
    const byRound = new Map<string, string[][]>();
    for (const row of tRows) {
      const round = String(col(headers, row, 'round') || 'RR').toUpperCase();
      const list = byRound.get(round);
      if (list) list.push(row);
      else byRound.set(round, [row]);
    }
    for (const [round, rRows] of byRound) {
      rRows.sort(
        (a, b) => (toNum(col(headers, a, 'match_num')) ?? 0) - (toNum(col(headers, b, 'match_num')) ?? 0)
      );
      const spec = roundDaySpec(kind, round, tour);
      const count = rRows.length;
      rRows.forEach((row, i) => {
        const extra =
          count <= 1 || spec.span <= 1 ? 0 : Math.min(spec.span - 1, Math.floor((i * spec.span) / count));
        out.set(row, addDaysIso(tourneyDate, spec.start + extra));
      });
    }
  }
  return out;
}

export function isGrandSlam(level: string, name: string): boolean {
  if (String(level || '').toUpperCase() === 'G') return true;
  const key = String(name || '').toLowerCase();
  return GRAND_SLAM_NAMES.some((slam) => key.includes(slam));
}

export function tourLabelForMatch(tour: TennisTour, isSlam: boolean): string {
  return isSlam ? 'Grand Slam' : tour;
}

type ScoreParse = {
  gamesWon: number | null;
  gamesLost: number | null;
  totalGames: number | null;
  setsWon: number | null;
  setsLost: number | null;
};

export function parseScoreFromWinnerView(score: string): ScoreParse {
  const text = String(score || '').trim();
  if (!text || /^w\/o$/i.test(text) || /^walkover$/i.test(text)) {
    return { gamesWon: null, gamesLost: null, totalGames: null, setsWon: null, setsLost: null };
  }
  const sets = text
    .replace(/\s+(RET|RETIRED|DEF|ABD)\.?$/i, '')
    .split(/\s+/)
    .map((token) => {
      const m = token.match(/^(\d+)-(\d+)/);
      if (!m) return null;
      return { w: Number(m[1]), l: Number(m[2]) };
    })
    .filter((s): s is { w: number; l: number } => s != null);

  if (!sets.length) {
    return { gamesWon: null, gamesLost: null, totalGames: null, setsWon: null, setsLost: null };
  }

  const gamesWon = sets.reduce((sum, s) => sum + s.w, 0);
  const gamesLost = sets.reduce((sum, s) => sum + s.l, 0);
  const setsWon = sets.filter((s) => s.w > s.l).length;
  const setsLost = sets.filter((s) => s.l > s.w).length;
  return {
    gamesWon,
    gamesLost,
    totalGames: gamesWon + gamesLost,
    setsWon,
    setsLost,
  };
}

function pct(part: number | null, whole: number | null): number | null {
  if (part == null || whole == null || whole <= 0) return null;
  return (part / whole) * 100;
}

function readCsv(file: string): { headers: string[]; rows: string[][] } {
  if (!fs.existsSync(file)) return { headers: [], rows: [] };
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { headers, rows };
}

function col(headers: string[], row: string[], name: string): string {
  const idx = headers.indexOf(name);
  return idx >= 0 ? row[idx] ?? '' : '';
}

type RawMatch = {
  tour: TennisTour;
  season: number;
  headers: string[];
  row: string[];
  matchDate?: string | null;
};

function perspective(
  raw: RawMatch,
  side: 'winner' | 'loser'
): TennisMatchRow | null {
  const { headers, row, tour, season } = raw;
  const winnerName = col(headers, row, 'winner_name');
  const loserName = col(headers, row, 'loser_name');
  if (!winnerName || !loserName) return null;

  const isWin = side === 'winner';
  const p = isWin ? 'winner' : 'loser';
  const o = isWin ? 'loser' : 'winner';
  const wStats = {
    ace: toNum(col(headers, row, 'w_ace')),
    df: toNum(col(headers, row, 'w_df')),
    svpt: toNum(col(headers, row, 'w_svpt')),
    firstIn: toNum(col(headers, row, 'w_1stIn')),
    firstWon: toNum(col(headers, row, 'w_1stWon')),
    secondWon: toNum(col(headers, row, 'w_2ndWon')),
    svGms: toNum(col(headers, row, 'w_SvGms')),
    bpSaved: toNum(col(headers, row, 'w_bpSaved')),
    bpFaced: toNum(col(headers, row, 'w_bpFaced')),
  };
  const lStats = {
    ace: toNum(col(headers, row, 'l_ace')),
    df: toNum(col(headers, row, 'l_df')),
    svpt: toNum(col(headers, row, 'l_svpt')),
    firstIn: toNum(col(headers, row, 'l_1stIn')),
    firstWon: toNum(col(headers, row, 'l_1stWon')),
    secondWon: toNum(col(headers, row, 'l_2ndWon')),
    svGms: toNum(col(headers, row, 'l_SvGms')),
    bpSaved: toNum(col(headers, row, 'l_bpSaved')),
    bpFaced: toNum(col(headers, row, 'l_bpFaced')),
  };
  const mine = isWin ? wStats : lStats;
  const opp = isWin ? lStats : wStats;
  const secondServeAttempts =
    mine.svpt != null && mine.firstIn != null ? mine.svpt - mine.firstIn : null;
  const bpConverted =
    opp.bpFaced != null && opp.bpSaved != null ? opp.bpFaced - opp.bpSaved : null;
  const oppReturnPointsFaced = opp.svpt;
  const winnerScore = parseScoreFromWinnerView(col(headers, row, 'score'));
  const gamesWon = isWin ? winnerScore.gamesWon : winnerScore.gamesLost;
  const gamesLost = isWin ? winnerScore.gamesLost : winnerScore.gamesWon;
  const setsWon = isWin ? winnerScore.setsWon : winnerScore.setsLost;
  const setsLost = isWin ? winnerScore.setsLost : winnerScore.setsWon;
  const serveWon =
    mine.firstWon != null && mine.secondWon != null ? mine.firstWon + mine.secondWon : null;
  const oppServeWon =
    opp.firstWon != null && opp.secondWon != null ? opp.firstWon + opp.secondWon : null;
  const returnPointsWon =
    opp.svpt != null && oppServeWon != null ? opp.svpt - oppServeWon : null;
  const pointsWon =
    serveWon != null && returnPointsWon != null ? serveWon + returnPointsWon : null;
  const totalPoints =
    mine.svpt != null && opp.svpt != null ? mine.svpt + opp.svpt : null;
  const tourneyName = col(headers, row, 'tourney_name');
  const tourneyLevel = col(headers, row, 'tourney_level');
  const slam = isGrandSlam(tourneyLevel, tourneyName);
  const playerId = col(headers, row, `${p}_id`);
  const opponentId = col(headers, row, `${o}_id`);
  const matchNum = col(headers, row, 'match_num');
  const tourneyId = col(headers, row, 'tourney_id');

  return {
    matchId: `${tour}-${tourneyId}-${matchNum}-${playerId}`,
    tour,
    season,
    tourneyId,
    tourneyName,
    tourneyLevel,
    isGrandSlam: slam,
    surface: col(headers, row, 'surface'),
    date: raw.matchDate ?? toDate(col(headers, row, 'tourney_date')),
    tourneyDate: toDate(col(headers, row, 'tourney_date')),
    round: col(headers, row, 'round'),
    score: col(headers, row, 'score'),
    bestOf: toNum(col(headers, row, 'best_of')) ?? 3,
    minutes: toNum(col(headers, row, 'minutes')),
    drawSize: toNum(col(headers, row, 'draw_size')),
    playerId,
    playerName: col(headers, row, `${p}_name`),
    opponentId,
    opponent: col(headers, row, `${o}_name`),
    opponentIoc: col(headers, row, `${o}_ioc`) || null,
    opponentRank: toNum(col(headers, row, `${o}_rank`)),
    opponentRankPoints: toNum(col(headers, row, `${o}_rank_points`)),
    playerRank: toNum(col(headers, row, `${p}_rank`)),
    rankPoints: toNum(col(headers, row, `${p}_rank_points`)),
    seed: toNum(col(headers, row, `${p}_seed`)),
    entry: col(headers, row, `${p}_entry`) || null,
    height: toNum(col(headers, row, `${p}_ht`)),
    age: toNum(col(headers, row, `${p}_age`)),
    isWin,
    result: isWin ? 'W' : 'L',
    team: slam ? 'Grand Slam' : tour,
    teamCode: tour,
    venue: col(headers, row, 'surface') || null,
    isHome: false,
    moneyline: isWin ? 1 : 0,
    gamesWon,
    gamesLost,
    totalGames: winnerScore.totalGames,
    spread:
      gamesWon != null && gamesLost != null ? gamesLost - gamesWon : null,
    setsWon,
    setsLost,
    totalSets: setsWon != null && setsLost != null ? setsWon + setsLost : null,
    dominanceRatio: tennisDominanceRatio(
      pct(returnPointsWon, oppReturnPointsFaced),
      pct(serveWon, mine.svpt)
    ),
    aces: mine.ace,
    opponentAces: opp.ace,
    totalAces: mine.ace != null && opp.ace != null ? mine.ace + opp.ace : null,
    doubleFaults: mine.df,
    servePoints: mine.svpt,
    serveGames: mine.svGms,
    firstServesIn: mine.firstIn,
    firstServesWon: mine.firstWon,
    secondServeAttempts,
    secondServesWon: mine.secondWon,
    firstServePct: pct(mine.firstIn, mine.svpt),
    firstServeWonPct: pct(mine.firstWon, mine.firstIn),
    secondServeWonPct: pct(mine.secondWon, secondServeAttempts),
    servicePointsWonPct: pct(serveWon, mine.svpt),
    breakPointsSaved: mine.bpSaved,
    breakPointsFaced: mine.bpFaced,
    breakPointsSavedPct: pct(mine.bpSaved, mine.bpFaced),
    breakPointsConverted: bpConverted,
    breakPointsConvertedPct: pct(bpConverted, opp.bpFaced),
    returnPointsWon,
    returnPointsWonPct: pct(returnPointsWon, oppReturnPointsFaced),
    pointsWon,
    servePointsWon: serveWon,
    totalPoints,
    hand: col(headers, row, `${p}_hand`) || null,
    opponentHand: col(headers, row, `${o}_hand`) || null,
    ioc: col(headers, row, `${p}_ioc`) || null,
  };
}

let matchCache: { key: string; matches: TennisMatchRow[] } | null = null;

export function loadTennisMatches(years?: readonly number[]): TennisMatchRow[] {
  const dir = tennisDataDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /^(atp|wta)_matches_\d{4}\.csv$/i.test(f));
  const wanted = new Set(years ?? TENNIS_HISTORY_YEARS);
  const key = [...wanted].join(',') + ':' + files.join('|');
  if (matchCache?.key === key) return matchCache.matches;
  const matches: TennisMatchRow[] = [];
  for (const file of files) {
    const m = file.match(/^(atp|wta)_matches_(\d{4})\.csv$/i);
    if (!m) continue;
    const year = Number(m[2]);
    if (wanted && !wanted.has(year)) continue;
    const tour: TennisTour = m[1].toUpperCase() === 'ATP' ? 'ATP' : 'WTA';
    const { headers, rows } = readCsv(path.join(dir, file));
    if (!headers.length) continue;
    const playable = rows.filter(
      (row) =>
        !isUnplayedTennisMatch(col(headers, row, 'score')) &&
        col(headers, row, 'winner_name') &&
        col(headers, row, 'loser_name')
    );
    const matchDates = estimateTourneyMatchDates(tour, headers, playable);
    for (const row of playable) {
      const raw = { tour, season: year, headers, row, matchDate: matchDates.get(row) ?? null };
      const w = perspective(raw, 'winner');
      const l = perspective(raw, 'loser');
      if (w) matches.push(w);
      if (l) matches.push(l);
    }
  }
  matchCache = { key, matches };
  return matches;
}

function loadLatestRankingByPlayer(tour: TennisTour): Map<string, { rank: number; points: number | null }> {
  const file = tennisRankingsPath(tour);
  const out = new Map<string, { rank: number; points: number | null }>();
  if (!fs.existsSync(file)) return out;
  const { headers, rows } = readCsv(file);
  const latestDate = rows.reduce((max, row) => {
    const d = col(headers, row, 'ranking_date');
    return d > max ? d : max;
  }, '');
  if (!latestDate) return out;
  for (const row of rows) {
    if (col(headers, row, 'ranking_date') !== latestDate) continue;
    const id = col(headers, row, 'player_id') || col(headers, row, 'player');
    const rank = toNum(col(headers, row, 'ranking') || col(headers, row, 'rank'));
    if (!id || rank == null || rank <= 0) continue;
    out.set(id, {
      rank,
      points: toNum(col(headers, row, 'ranking_points') || col(headers, row, 'points')),
    });
  }
  return out;
}

export function loadTennisPlayers(opts?: { currentOnly?: boolean }): TennisPlayer[] {
  const matches = loadTennisMatches();
  const byId = new Map<string, TennisPlayer & { date: string; lastSeason: number }>();
  for (const row of matches) {
    const date = row.date || '';
    const existing = byId.get(row.playerId);
    if (existing && existing.date >= date) {
      if (row.season > existing.lastSeason) existing.lastSeason = row.season;
      continue;
    }
    byId.set(row.playerId, {
      playerId: row.playerId,
      name: row.playerName,
      tour: row.tour,
      ioc: row.ioc,
      hand: row.hand,
      height: row.height,
      rank: row.playerRank,
      rankPoints: row.rankPoints,
      date,
      lastSeason: existing ? Math.max(existing.lastSeason, row.season) : row.season,
    });
  }
  const rankedNow = new Map<string, { rank: number; points: number | null }>([
    ...loadLatestRankingByPlayer('ATP'),
    ...loadLatestRankingByPlayer('WTA'),
  ]);
  let players = [...byId.values()].map(({ date: _d, lastSeason, ...player }) => {
    const live = rankedNow.get(player.playerId);
    return {
      ...player,
      lastSeason,
      rank: live?.rank ?? player.rank,
      rankPoints: live?.points ?? player.rankPoints,
    };
  });
  if (opts?.currentOnly) {
    players = players.filter(
      (p) => p.lastSeason === TENNIS_CURRENT_YEAR || rankedNow.has(p.playerId)
    );
  }
  return players
    .map(({ lastSeason: _season, ...player }) => player)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name));
}

export function tourForPlayer(playerId: string | null, name?: string | null): TennisTour | null {
  if (!playerId && !name) return null;
  const players = loadTennisPlayers();
  if (playerId) {
    const byId = players.find((p) => p.playerId === playerId);
    if (byId) return byId.tour;
  }
  if (name) {
    const key = name.toLowerCase().trim();
    const byName = players.find((p) => p.name.toLowerCase() === key);
    if (byName) return byName.tour;
  }
  return null;
}

export function loadPlayerMatches(opts: {
  playerId?: string | null;
  playerName?: string | null;
  tour?: TennisTour | null;
}): TennisMatchRow[] {
  const matches = loadTennisMatches();
  const id = String(opts.playerId || '').trim();
  const name = String(opts.playerName || '').trim().toLowerCase();
  let rows = matches.filter((row) => {
    if (id && row.playerId === id) return true;
    if (name && row.playerName.toLowerCase() === name) return true;
    return false;
  });
  if (opts.tour) rows = rows.filter((row) => row.tour === opts.tour);
  rows.sort(
    (a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')) ||
      roundSortValue(a.round) - roundSortValue(b.round) ||
      a.matchId.localeCompare(b.matchId)
  );
  return rows;
}

export function loadTennisRankings(
  tour: TennisTour,
  opts?: { limit?: number }
): TennisRankingRow[] {
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : 50;
  const file = tennisRankingsPath(tour);
  const players = loadTennisPlayers().filter((p) => p.tour === tour);
  const byId = new Map(players.map((p) => [p.playerId, p]));
  if (fs.existsSync(file)) {
    const { headers, rows } = readCsv(file);
    const latestDate = rows.reduce((max, row) => {
      const d = col(headers, row, 'ranking_date');
      return d > max ? d : max;
    }, '');
    const ranked = rows
      .filter((row) => col(headers, row, 'ranking_date') === latestDate)
      .map((row) => {
        const playerId = col(headers, row, 'player_id') || col(headers, row, 'player');
        const player = byId.get(playerId);
        return {
          pos: toNum(col(headers, row, 'ranking') || col(headers, row, 'rank')) || 0,
          playerId,
          name: player?.name || playerId,
          tour,
          points: toNum(col(headers, row, 'ranking_points') || col(headers, row, 'points')),
          ioc: player?.ioc ?? null,
        };
      })
      .filter((row) => row.pos > 0)
      .sort((a, b) => a.pos - b.pos)
      .slice(0, limit);
    if (ranked.length) return ranked;
  }
  return players
    .filter((p) => p.rank != null)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
    .slice(0, limit)
    .map((p) => ({
      pos: p.rank || 0,
      playerId: p.playerId,
      name: p.name,
      tour,
      points: p.rankPoints,
      ioc: p.ioc,
    }));
}

export function opponentDefenseRanks(tour: TennisTour, stat: keyof TennisMatchRow): Array<{
  opponent: string;
  opponentId: string;
  value: number;
  matches: number;
}> {
  const matches = loadTennisMatches().filter((row) => row.tour === tour && !row.isWin);
  const byOpp = new Map<string, { name: string; total: number; n: number }>();
  for (const row of matches) {
    const raw = row[stat];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const cur = byOpp.get(row.opponentId) || { name: row.opponent, total: 0, n: 0 };
    cur.total += raw;
    cur.n += 1;
    byOpp.set(row.opponentId, cur);
  }
  return [...byOpp.entries()]
    .filter(([, v]) => v.n >= 3)
    .map(([opponentId, v]) => ({
      opponent: v.name,
      opponentId,
      value: v.total / v.n,
      matches: v.n,
    }))
    .sort((a, b) => a.value - b.value);
}

type DvpBucket = {
  name: string;
  ioc: string | null;
  date: string;
  matches: number;
  sums: Record<string, { sum: number; n: number }>;
};

function emptyDvpBucket(name: string, ioc: string | null, date: string): DvpBucket {
  return { name, ioc, date, matches: 0, sums: {} };
}

function addDvpValue(bucket: DvpBucket, key: string, raw: unknown) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
  const cur = bucket.sums[key] || { sum: 0, n: 0 };
  cur.sum += raw;
  cur.n += 1;
  bucket.sums[key] = cur;
}

function touchDvpBucket(
  map: Map<string, DvpBucket>,
  id: string,
  name: string,
  ioc: string | null,
  date: string
): DvpBucket {
  const cur = map.get(id) || emptyDvpBucket(name, ioc, date);
  cur.matches += 1;
  if (date >= cur.date) {
    cur.name = name;
    cur.ioc = ioc;
    cur.date = date;
  }
  map.set(id, cur);
  return cur;
}

function normDvpName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function findDvpPlayerId(
  name: string,
  buckets: Map<string, DvpBucket>,
  ranked: TennisRankingRow[]
): string | null {
  const key = normDvpName(name);
  if (!key) return null;
  const rankedHit = ranked.find((p) => normDvpName(p.name) === key);
  if (rankedHit) return rankedHit.playerId;
  for (const [id, bucket] of buckets) {
    if (normDvpName(bucket.name) === key) return id;
  }
  const last = key.split(/\s+/).filter(Boolean).pop() || '';
  if (last.length < 3) return null;
  const lastHits = ranked.filter((p) => {
    const parts = normDvpName(p.name).split(/\s+/);
    return parts[parts.length - 1] === last;
  });
  if (lastHits.length === 1) return lastHits[0].playerId;
  const bucketHits = [...buckets.entries()].filter(([, b]) => {
    const parts = normDvpName(b.name).split(/\s+/);
    return parts[parts.length - 1] === last;
  });
  if (bucketHits.length === 1) return bucketHits[0][0];
  return null;
}

function dvpMean(bucket: DvpBucket | undefined, key: string): number | null {
  const cell = bucket?.sums[key];
  if (!cell || cell.n <= 0) return null;
  return cell.sum / cell.n;
}

function dvpRanks(values: Array<{ id: string; value: number }>): Map<string, number> {
  const sorted = [...values].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));
  const out = new Map<string, number>();
  sorted.forEach((row, idx) => out.set(row.id, idx + 1));
  return out;
}

export type TennisDvpOpponent = {
  id: string;
  name: string;
  ioc: string | null;
  rankPos: number | null;
};

export type TennisDvpMetricRow = {
  key: TennisDvpMetricKey;
  label: string;
  pct: boolean;
  value: number | null;
  rank: number | null;
  matches: number;
  fieldSize: number;
};

export type TennisDvpProfile = {
  tour: TennisTour;
  year: number;
  fieldSize: number;
  opponent: TennisDvpOpponent | null;
  opponents: TennisDvpOpponent[];
  metrics: TennisDvpMetricRow[];
};

/** Allowed rates vs one opponent, ranked against the active tour (current rankings + sample). */
export function tennisDvpProfile(opts: {
  tour: TennisTour;
  year: number;
  opponentName?: string | null;
}): TennisDvpProfile {
  const tour = opts.tour;
  const year = opts.year;
  const ranked = loadTennisRankings(tour, { limit: 200 });
  const rankedById = new Map(ranked.map((p) => [p.playerId, p]));
  const matches = loadTennisMatches().filter((row) => row.tour === tour && row.season === year);

  const allowed = new Map<string, DvpBucket>();
  const own = new Map<string, DvpBucket>();
  for (const row of matches) {
    const date = row.date || '';
    const vs = touchDvpBucket(allowed, row.opponentId, row.opponent, row.opponentIoc, date);
    const me = touchDvpBucket(own, row.playerId, row.playerName, row.ioc, date);
    for (const metric of TENNIS_DVP_METRICS) {
      const bucket = metric.source === 'own' ? me : vs;
      addDvpValue(bucket, metric.key, row[metric.key as keyof TennisMatchRow]);
    }
  }

  const activeIds = new Set<string>();
  for (const p of ranked) {
    const sample = allowed.get(p.playerId)?.matches || own.get(p.playerId)?.matches || 0;
    if (sample >= TENNIS_DVP_MIN_MATCHES) activeIds.add(p.playerId);
  }

  const opponentId = findDvpPlayerId(String(opts.opponentName || ''), allowed, ranked);
  if (opponentId) activeIds.add(opponentId);

  const opponents: TennisDvpOpponent[] = [...activeIds]
    .map((id) => {
      const rankedRow = rankedById.get(id);
      const bucket = allowed.get(id) || own.get(id);
      return {
        id,
        name: rankedRow?.name || bucket?.name || id,
        ioc: rankedRow?.ioc ?? bucket?.ioc ?? null,
        rankPos: rankedRow?.pos ?? null,
      };
    })
    .sort(
      (a, b) =>
        (a.rankPos ?? 9999) - (b.rankPos ?? 9999) || a.name.localeCompare(b.name)
    );

  const metrics: TennisDvpMetricRow[] = TENNIS_DVP_METRICS.map((metric) => {
    const source = metric.source === 'own' ? own : allowed;
    const values: Array<{ id: string; value: number }> = [];
    for (const id of activeIds) {
      const mean = dvpMean(source.get(id), metric.key);
      if (mean == null) continue;
      const n = source.get(id)?.sums[metric.key]?.n || 0;
      if (n < TENNIS_DVP_MIN_MATCHES && id !== opponentId) continue;
      values.push({ id, value: mean });
    }
    const ranks = dvpRanks(values);
    const selected = opponentId ? source.get(opponentId) : undefined;
    const value = opponentId ? dvpMean(selected, metric.key) : null;
    return {
      key: metric.key,
      label: metric.label,
      pct: metric.pct,
      value,
      rank: opponentId ? ranks.get(opponentId) ?? null : null,
      matches: selected?.sums[metric.key]?.n || 0,
      fieldSize: values.length,
    };
  });

  const fieldSize = opponents.length;
  const opponent = opponentId
    ? opponents.find((p) => p.id === opponentId) || {
        id: opponentId,
        name: allowed.get(opponentId)?.name || own.get(opponentId)?.name || String(opts.opponentName || ''),
        ioc: allowed.get(opponentId)?.ioc || own.get(opponentId)?.ioc || null,
        rankPos: rankedById.get(opponentId)?.pos ?? null,
      }
    : null;

  return { tour, year, fieldSize, opponent, opponents, metrics };
}
