import { tennisDominanceRatio } from '@/lib/tennis/chartStats';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import {
  ADV_AVG_COLUMNS,
  ADV_AVG_ROWS,
  type AdvAvgBestOf,
  type AdvAvgCell,
  type AdvAvgColKey,
  type AdvAvgSide,
  type AdvAvgTableRow,
  type AdvAvgTone,
  type AdvAvgVsRank,
  type AdvAvgWindow,
  type TennisAdvancedAveragesPayload,
} from '@/lib/tennis/advancedAveragesShared';
import {
  loadPlayerMatches,
  loadTennisPlayers,
  tourForPlayer,
  type TennisMatchRow,
  type TennisTour,
} from '@/lib/tennis/sackmann';

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function normName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function resolvePlayer(
  name: string,
  preferredTour: TennisTour
): { id: string | null; name: string; hand: 'R' | 'L' | null } {
  const players = loadTennisPlayers();
  const key = normName(name);
  if (!key) return { id: null, name, hand: null };
  const hit =
    players.find((p) => p.tour === preferredTour && normName(p.name) === key) ||
    players.find((p) => normName(p.name) === key);
  return {
    id: hit?.playerId ?? null,
    name: hit?.name || name,
    hand: normalizeHand(hit?.hand ?? null),
  };
}

function normalizeHand(hand: string | null | undefined): 'R' | 'L' | null {
  const key = String(hand || '').trim().toUpperCase();
  if (key === 'R' || key.startsWith('RIGHT')) return 'R';
  if (key === 'L' || key.startsWith('LEFT')) return 'L';
  return null;
}

function normalizeSurface(surface: string | null | undefined): 'hard' | 'clay' | 'grass' | null {
  const key = String(surface || '').trim().toLowerCase();
  if (key === 'hard') return 'hard';
  if (key === 'clay') return 'clay';
  if (key === 'grass') return 'grass';
  return null;
}

function matchesBestOf(row: TennisMatchRow, bestOf: AdvAvgBestOf): boolean {
  if (bestOf === 'all') return true;
  const n = Number(row.bestOf);
  if (bestOf === '5') return Number.isFinite(n) && n >= 5;
  return !Number.isFinite(n) || n < 5;
}

function matchesVsRank(row: TennisMatchRow, vsRank: AdvAvgVsRank): boolean {
  if (vsRank === 'all') return true;
  const cap = Number(vsRank);
  const rank = num(row.opponentRank);
  return rank != null && rank > 0 && rank <= cap;
}

function windowRows(rows: TennisMatchRow[], windowN: AdvAvgWindow, year: number): TennisMatchRow[] {
  const sorted = [...rows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (windowN > 0) return sorted.slice(-windowN);
  const season = sorted.filter((row) => row.season === year);
  return season.length ? season : sorted.slice(-20);
}

function holdPct(row: TennisMatchRow): number | null {
  const games = num(row.serveGames);
  const faced = num(row.breakPointsFaced);
  const saved = num(row.breakPointsSaved);
  if (games == null || games <= 0 || faced == null || saved == null) return null;
  const broken = Math.max(0, faced - saved);
  return ((games - Math.min(games, broken)) / games) * 100;
}

function dominance(row: TennisMatchRow): number | null {
  return tennisDominanceRatio(num(row.returnPointsWonPct), num(row.servicePointsWonPct));
}

function breaksConceded(row: TennisMatchRow): number | null {
  const faced = num(row.breakPointsFaced);
  const saved = num(row.breakPointsSaved);
  if (faced == null || saved == null) return null;
  return Math.max(0, faced - saved);
}

function emptyCell(): AdvAvgCell {
  return { text: '—', tone: 'empty' };
}

function toneFromPct(value: number | null, good: number, ok: number): AdvAvgTone {
  if (value == null || !Number.isFinite(value)) return 'empty';
  if (value >= good) return 'good';
  if (value >= ok) return 'ok';
  return 'bad';
}

function toneFromDr(value: number | null): AdvAvgTone {
  if (value == null || !Number.isFinite(value)) return 'empty';
  if (value >= 1.1) return 'good';
  if (value >= 0.95) return 'ok';
  return 'bad';
}

function toneLowerBetter(value: number | null, goodMax: number, okMax: number): AdvAvgTone {
  if (value == null || !Number.isFinite(value)) return 'empty';
  if (value <= goodMax) return 'good';
  if (value <= okMax) return 'ok';
  return 'bad';
}

function fmtPct(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function summarize(rows: TennisMatchRow[]): Record<AdvAvgColKey, AdvAvgCell> {
  const empty = Object.fromEntries(ADV_AVG_COLUMNS.map((col) => [col.key, emptyCell()])) as Record<
    AdvAvgColKey,
    AdvAvgCell
  >;
  if (!rows.length) return empty;

  const wins = rows.filter((row) => row.isWin).length;
  const losses = rows.length - wins;
  const winPct = rows.length ? (wins / rows.length) * 100 : null;
  const gamesWon = mean(rows.map((row) => num(row.gamesWon)).filter((v): v is number => v != null));
  const gamesLost = mean(rows.map((row) => num(row.gamesLost)).filter((v): v is number => v != null));
  const gamesPlayed =
    gamesWon != null && gamesLost != null ? gamesWon + gamesLost : null;
  const gamesPct =
    gamesWon != null && gamesPlayed != null && gamesPlayed > 0 ? (gamesWon / gamesPlayed) * 100 : null;
  const dr = mean(rows.map(dominance).filter((v): v is number => v != null));
  const hold = mean(rows.map(holdPct).filter((v): v is number => v != null));
  const bpw = mean(rows.map((row) => num(row.breakPointsConvertedPct)).filter((v): v is number => v != null));
  const rpw = mean(rows.map((row) => num(row.returnPointsWonPct)).filter((v): v is number => v != null));
  const aces = mean(rows.map((row) => num(row.aces)).filter((v): v is number => v != null));
  const aceAll = mean(rows.map((row) => num(row.opponentAces)).filter((v): v is number => v != null));
  const df = mean(rows.map((row) => num(row.doubleFaults)).filter((v): v is number => v != null));
  const first = mean(rows.map((row) => num(row.firstServePct)).filter((v): v is number => v != null));
  const second = mean(rows.map((row) => num(row.secondServeWonPct)).filter((v): v is number => v != null));
  const bps = mean(rows.map((row) => num(row.breakPointsSavedPct)).filter((v): v is number => v != null));
  const bpgu = mean(rows.map(breaksConceded).filter((v): v is number => v != null));

  return {
    wl: {
      text: `${wins}-${losses} (${winPct == null ? '—' : `${winPct.toFixed(0)}%`})`,
      tone: toneFromPct(winPct, 60, 45),
    },
    dr: { text: fmtNum(dr, 2), tone: toneFromDr(dr) },
    games: {
      text:
        gamesWon == null || gamesPlayed == null
          ? '—'
          : `${gamesWon.toFixed(1)}/${gamesPlayed.toFixed(1)} (${gamesPct == null ? '—' : `${gamesPct.toFixed(1)}%`})`,
      tone: toneFromPct(gamesPct, 54, 50),
    },
    hold: { text: fmtPct(hold), tone: toneFromPct(hold, 80, 72) },
    bpw: { text: fmtPct(bpw), tone: toneFromPct(bpw, 42, 35) },
    rpw: { text: fmtPct(rpw), tone: toneFromPct(rpw, 40, 35) },
    aces: { text: fmtNum(aces), tone: 'neutral' },
    aceAll: { text: fmtNum(aceAll), tone: toneLowerBetter(aceAll, 5, 8) },
    df: { text: fmtNum(df), tone: toneLowerBetter(df, 2.5, 4) },
    first: { text: fmtPct(first), tone: toneFromPct(first, 63, 58) },
    second: { text: fmtPct(second), tone: toneFromPct(second, 54, 48) },
    bps: { text: fmtPct(bps), tone: toneFromPct(bps, 65, 55) },
    bpgu: { text: fmtNum(bpgu), tone: toneLowerBetter(bpgu, 2.2, 3.2) },
  };
}

function splitRows(rows: TennisMatchRow[], h2hName: string | null): AdvAvgTableRow[] {
  const h2hKey = normName(h2hName);
  const buckets: Record<string, TennisMatchRow[]> = {
    all: rows,
    hard: rows.filter((row) => normalizeSurface(row.surface) === 'hard'),
    clay: rows.filter((row) => normalizeSurface(row.surface) === 'clay'),
    grass: rows.filter((row) => normalizeSurface(row.surface) === 'grass'),
    righties: rows.filter((row) => normalizeHand(row.opponentHand) === 'R'),
    lefties: rows.filter((row) => normalizeHand(row.opponentHand) === 'L'),
    h2h: h2hKey ? rows.filter((row) => normName(row.opponent) === h2hKey) : [],
  };
  return ADV_AVG_ROWS.map((row) => {
    const sample = buckets[row.key] || [];
    const losses = sample.filter((m) => !m.isWin).length;
    const wins = sample.filter((m) => m.isWin).length;
    return {
      key: row.key,
      label: row.label,
      matches: sample.length,
      highlight: row.key === 'h2h' && sample.length > 0 && losses > wins,
      cells: summarize(sample),
    };
  });
}

function buildSide(
  name: string,
  tour: TennisTour,
  year: number,
  windowN: AdvAvgWindow,
  bestOf: AdvAvgBestOf,
  vsRank: AdvAvgVsRank,
  h2hName: string | null
): AdvAvgSide {
  const resolved = resolvePlayer(name, tour);
  const filtered = loadPlayerMatches({
    playerId: resolved.id,
    playerName: resolved.id ? null : name,
    tour,
  }).filter((row) => matchesBestOf(row, bestOf) && matchesVsRank(row, vsRank));
  const sample = windowRows(filtered, windowN, year);
  return {
    name: resolved.name || name,
    hand: resolved.hand,
    matches: sample.length,
    rows: splitRows(sample, h2hName),
  };
}

export function buildTennisAdvancedAverages(opts: {
  playerName: string;
  opponentName?: string | null;
  tour?: TennisTour | null;
  window?: number;
  year?: number;
  bestOf?: string | null;
  vsRank?: string | null;
}): TennisAdvancedAveragesPayload {
  const year =
    opts.year && Number.isFinite(opts.year) && opts.year >= 2000 ? opts.year : TENNIS_CURRENT_YEAR;
  const windowRaw = Number(opts.window);
  const windowN = ([5, 10, 15, 20, 0] as const).includes(windowRaw as AdvAvgWindow)
    ? (windowRaw as AdvAvgWindow)
    : 15;
  const bestOf: AdvAvgBestOf =
    opts.bestOf === '3' || opts.bestOf === '5' ? opts.bestOf : 'all';
  const vsRank: AdvAvgVsRank =
    opts.vsRank === '10' || opts.vsRank === '20' || opts.vsRank === '50' || opts.vsRank === '100'
      ? opts.vsRank
      : 'all';
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  const tour =
    opts.tour ||
    tourForPlayer(null, playerName) ||
    tourForPlayer(null, opponentName) ||
    'ATP';

  return {
    tour,
    year,
    window: windowN,
    bestOf,
    vsRank,
    player: buildSide(playerName, tour, year, windowN, bestOf, vsRank, opponentName || null),
    opponent: opponentName
      ? buildSide(opponentName, tour, year, windowN, bestOf, vsRank, playerName)
      : null,
  };
}
