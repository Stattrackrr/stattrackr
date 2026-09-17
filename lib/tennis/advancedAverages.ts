import { tennisDominanceRatio, tennisLastName, resolveTennisMatchBestOf } from '@/lib/tennis/chartStats';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import {
  ADV_AVG_BEST_OF,
  ADV_AVG_COLUMNS,
  ADV_AVG_ROWS,
  ADV_AVG_VS_RANKS,
  ADV_AVG_WINDOWS,
  matchTennisOppRank,
  tennisAveragesBoardKey,
  type AdvAvgBestOf,
  type AdvAvgCell,
  type AdvAvgColKey,
  type AdvAvgSide,
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
  type TennisPlayer,
  type TennisTour,
} from '@/lib/tennis/data';
import { readTennisPlayerLogsCacheMany, readTennisRosterCache } from '@/lib/tennis/dashboardCache';
import { tennisHandForName } from '@/lib/tennis/hands';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';

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
  preferredTour: TennisTour,
  players: TennisPlayer[],
  playerId?: string | null
): { id: string | null; name: string; hand: 'R' | 'L' | null } {
  const id = String(playerId || '').trim();
  const key = normName(name);
  if (id) {
    const hit = players.find((p) => p.playerId === id);
    if (
      hit &&
      (!key ||
        normName(hit.name) === key ||
        tennisIdentityMatch(hit.name, name))
    ) {
      return {
        id,
        name: hit.name || name,
        hand: normalizeHand(hit.hand ?? null) || tennisHandForName(hit.name || name),
      };
    }
  }
  if (!key) {
    return {
      id: id || null,
      name,
      hand: tennisHandForName(name),
    };
  }
  const hit =
    players.find((p) => p.tour === preferredTour && normName(p.name) === key) ||
    players.find((p) => normName(p.name) === key) ||
    players.find((p) => p.tour === preferredTour && tennisIdentityMatch(p.name, name));
  return {
    id: hit?.playerId || id || null,
    name: hit?.name || name,
    hand: normalizeHand(hit?.hand ?? null) || tennisHandForName(hit?.name || name),
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
  const actual = resolveTennisMatchBestOf(row);
  return bestOf === '5' ? actual === 5 : actual === 3;
}

function opponentRankOnMatchDay(row: TennisMatchRow): number | null {
  return num(row.opponentRank);
}

function matchesVsRank(row: TennisMatchRow, vsRank: AdvAvgVsRank): boolean {
  return matchTennisOppRank(opponentRankOnMatchDay(row), vsRank);
}

function windowRows(rows: TennisMatchRow[], windowN: AdvAvgWindow, year: number): TennisMatchRow[] {
  const sorted = [...rows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (windowN > 0) return sorted.slice(-windowN);
  const season = sorted.filter((row) => row.season === year);
  return season.length ? season : sorted.slice(-20);
}

function isH2hMatch(row: TennisMatchRow, h2hName: string, h2hId: string | null): boolean {
  if (h2hId && row.opponentId && String(row.opponentId) === String(h2hId)) return true;
  const key = normName(h2hName);
  if (key && normName(row.opponent) === key) return true;
  const last = tennisLastName(h2hName).toLowerCase();
  const rowLast = tennisLastName(row.opponent).toLowerCase();
  const init = key.replace(/[^a-z]/g, '')[0] || '';
  const rowInit = normName(row.opponent).replace(/[^a-z]/g, '')[0] || '';
  return Boolean(last && rowLast && last === rowLast && init && init === rowInit);
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

function buildSide(
  name: string,
  tour: TennisTour,
  year: number,
  windowN: AdvAvgWindow,
  bestOf: AdvAvgBestOf,
  vsRank: AdvAvgVsRank,
  h2hName: string | null,
  players: TennisPlayer[],
  matches: TennisMatchRow[],
  playerId?: string | null,
  h2hId?: string | null
): AdvAvgSide {
  const resolved = resolvePlayer(name, tour, players, playerId);
  const h2hResolved = h2hName ? resolvePlayer(h2hName, tour, players, h2hId) : null;
  const pool = matches
    .filter((row) => matchesBestOf(row, bestOf) && matchesVsRank(row, vsRank))
    .map((row) => ({
      ...row,
      hand: row.hand || tennisHandForName(row.playerName),
      opponentHand: row.opponentHand || tennisHandForName(row.opponent),
    }));
  const all = windowRows(pool, windowN, year);
  const buckets: Record<string, TennisMatchRow[]> = {
    all,
    hard: all.filter((row) => normalizeSurface(row.surface) === 'hard'),
    clay: all.filter((row) => normalizeSurface(row.surface) === 'clay'),
    grass: all.filter((row) => normalizeSurface(row.surface) === 'grass'),
    righties: all.filter((row) => normalizeHand(row.opponentHand) === 'R'),
    lefties: all.filter((row) => normalizeHand(row.opponentHand) === 'L'),
    h2h:
      h2hName
        ? all.filter((row) => isH2hMatch(row, h2hName, h2hResolved?.id ?? null))
        : [],
  };
  const rows = ADV_AVG_ROWS.map((row) => {
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
  return {
    name: resolved.name || name,
    hand: resolved.hand,
    matches: buckets.all.length,
    rows,
  };
}

export type TennisAdvancedAveragesOpts = {
  playerName: string;
  opponentName?: string | null;
  playerId?: string | null;
  opponentId?: string | null;
  tour?: TennisTour | null;
  window?: number;
  year?: number;
  bestOf?: string | null;
  vsRank?: string | null;
  players?: TennisPlayer[];
  playerMatches?: TennisMatchRow[];
  opponentMatches?: TennisMatchRow[];
  includeBoards?: boolean;
};

export function averagesPayloadHasRows(payload: {
  player?: { matches?: number | null } | null;
} | null | undefined): boolean {
  return Number(payload?.player?.matches || 0) > 0;
}

export function buildTennisAdvancedAverages(opts: TennisAdvancedAveragesOpts): TennisAdvancedAveragesPayload {
  const year =
    opts.year && Number.isFinite(opts.year) && opts.year >= 2000 ? opts.year : TENNIS_CURRENT_YEAR;
  const windowRaw = Number(opts.window);
  const windowN = ([5, 10, 15, 20, 0] as const).includes(windowRaw as AdvAvgWindow)
    ? (windowRaw as AdvAvgWindow)
    : 0;
  const vsRank: AdvAvgVsRank = ADV_AVG_VS_RANKS.some((option) => option.id === opts.vsRank)
    ? (opts.vsRank as AdvAvgVsRank)
    : 'all';
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  const players = opts.players?.length ? opts.players : loadTennisPlayers();
  const tour =
    opts.tour ||
    players.find((p) => p.playerId === String(opts.playerId || '').trim())?.tour ||
    tourForPlayer(opts.playerId || null, playerName) ||
    tourForPlayer(opts.opponentId || null, opponentName) ||
    'ATP';
  const bestOf: AdvAvgBestOf =
    tour === 'WTA'
      ? opts.bestOf === '3'
        ? '3'
        : 'all'
      : opts.bestOf === '3' || opts.bestOf === '5'
        ? opts.bestOf
        : 'all';
  const playerRes = resolvePlayer(playerName, tour, players, opts.playerId);
  const oppRes = opponentName ? resolvePlayer(opponentName, tour, players, opts.opponentId) : null;
  const playerMatches =
    opts.playerMatches ??
    loadPlayerMatches({
      playerId: playerRes.id,
      playerName: playerRes.id ? null : playerName,
      tour,
    });
  const opponentMatches = opponentName
    ? opts.opponentMatches ??
      loadPlayerMatches({
        playerId: oppRes?.id,
        playerName: oppRes?.id ? null : opponentName,
        tour,
      })
    : [];

  const opponent = opponentName
    ? buildSide(
        opponentName,
        tour,
        year,
        windowN,
        bestOf,
        vsRank,
        playerName,
        players,
        opponentMatches,
        oppRes?.id,
        playerRes.id
      )
    : null;
  const payload: TennisAdvancedAveragesPayload = {
    tour,
    year,
    window: windowN,
    bestOf,
    vsRank,
    player: buildSide(
      playerName,
      tour,
      year,
      windowN,
      bestOf,
      vsRank,
      opponentName || null,
      players,
      playerMatches,
      playerRes.id,
      oppRes?.id
    ),
    opponent,
  };
  if (opts.includeBoards) {
    const boards: NonNullable<TennisAdvancedAveragesPayload['boards']> = {};
    const bestOfOptions: AdvAvgBestOf[] =
      tour === 'WTA' ? ['all', '3'] : ['all', '3', '5'];
    for (const nextWindow of ADV_AVG_WINDOWS) {
      for (const nextBestOf of bestOfOptions) {
        for (const nextVsRank of ADV_AVG_VS_RANKS) {
          const key = tennisAveragesBoardKey(nextWindow.id, nextBestOf, nextVsRank.id);
          boards[key] = {
            player: buildSide(
              playerName,
              tour,
              year,
              nextWindow.id,
              nextBestOf,
              nextVsRank.id,
              opponentName || null,
              players,
              playerMatches,
              playerRes.id,
              oppRes?.id
            ),
            opponent: opponentName
              ? buildSide(
                  opponentName,
                  tour,
                  year,
                  nextWindow.id,
                  nextBestOf,
                  nextVsRank.id,
                  playerName,
                  players,
                  opponentMatches,
                  oppRes?.id,
                  playerRes.id
                )
              : null,
          };
        }
      }
    }
    payload.boards = boards;
  }
  return payload;
}

export async function buildTennisAdvancedAveragesCached(
  opts: TennisAdvancedAveragesOpts
): Promise<TennisAdvancedAveragesPayload> {
  const roster =
    opts.players?.length
      ? opts.players
      : (await readTennisRosterCache())?.players || [];
  const tour =
    opts.tour ||
    roster.find((p) => p.playerId === String(opts.playerId || '').trim())?.tour ||
    'ATP';
  const playerRes = resolvePlayer(opts.playerName, tour, roster, opts.playerId);
  const oppRes = opts.opponentName
    ? resolvePlayer(opts.opponentName, tour, roster, opts.opponentId)
    : null;
  const logIds = [playerRes.id, oppRes?.id].filter((id): id is string => Boolean(id));
  const logs = logIds.length ? await readTennisPlayerLogsCacheMany(logIds) : new Map();
  const playerMatches =
    opts.playerMatches ||
    (playerRes.id ? logs.get(playerRes.id) || [] : []);
  const opponentMatches =
    opts.opponentMatches ||
    (oppRes?.id ? logs.get(oppRes.id) || [] : []);
  return buildTennisAdvancedAverages({
    ...opts,
    tour,
    playerId: playerRes.id,
    opponentId: oppRes?.id,
    players: roster,
    playerMatches,
    opponentMatches,
    includeBoards: opts.includeBoards !== false,
  });
}
