/**
 * NBL over/under line movement per player, stat and book.
 *
 * Every ingest (Vercel cron every 10 minutes, GitHub snapshot runs) appends a point when a book's
 * main O/U line or prices change. Stored in Redis so production sees moves without a data deploy;
 * GitHub runs seed a game's record from the on-disk delta history so opening lines survive.
 * Milestones (10+ and so on) are left out on purpose.
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_PLAYER_PROP_HISTORY_DIR,
  nblPropHistoryLineKey,
  type NblPlayerPropHistory,
  type NblPropHistoryLine,
} from '@/lib/nbl/oddsHistory';
import { playerKeyOf, type NblPlayerPropSnapshot } from '@/lib/nbl/playerPropSnapshots';
import { resolveNblClubName } from '@/lib/nblTeamCanonical';
import sharedCache from '@/lib/sharedCache';

const REDIS_PREFIX = 'nbl_ou_moves_v1:';
const REDIS_INDEX_KEY = 'nbl_ou_moves_index_v1';
const REDIS_TTL_SECONDS = 45 * 24 * 60 * 60;
const INDEX_KEEP = 200;

/** [epoch seconds, line, over decimal, under decimal] */
type MovePoint = [number, number, number | null, number | null];

type MovesDoc = {
  v: 1;
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  updatedAt: string;
  players: Record<string, string>;
  /** `${playerKey}|${stat}|${book}` */
  series: Record<string, MovePoint[]>;
};

type OuLine = Pick<NblPropHistoryLine, 'book' | 'player' | 'playerKey' | 'stat' | 'kind' | 'line' | 'overDecimal' | 'underDecimal'>;

export type NblLineMovePoint = { at: string; line: number; over: number | null; under: number | null };

export type NblBookLineMovement = {
  book: string;
  opening: NblLineMovePoint;
  current: NblLineMovePoint;
  /** Every recorded state, oldest first (opening first, current last). */
  points: NblLineMovePoint[];
};

export type NblStatLineMovement = {
  stat: string;
  /** Line most books opened on / are on now. */
  openingLine: number | null;
  currentLine: number | null;
  books: NblBookLineMovement[];
};

export type NblLineMovement = {
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  player: string;
  updatedAt: string;
  /** Every stat with an O/U posted for this player, in NBL_LINE_MOVEMENT_STATS order. */
  stats: NblStatLineMovement[];
};

export const NBL_LINE_MOVEMENT_STATS = ['points', 'rebounds', 'assists', 'threeMade', 'pra', 'pr', 'pa', 'ra'] as const;

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function seriesKey(playerKey: string, stat: string, book: string): string {
  return `${playerKey}|${stat}|${book}`;
}

/** A book can list more than one O/U for a player and stat; the main one is the most balanced two-way price. */
function mainOuLines(lines: Iterable<OuLine>): Map<string, OuLine> {
  const best = new Map<string, OuLine>();
  const balance = (l: OuLine) =>
    l.overDecimal != null && l.underDecimal != null ? Math.abs(l.overDecimal - l.underDecimal) : Number.POSITIVE_INFINITY;
  for (const l of lines) {
    if (l.kind !== 'ou' || (l.overDecimal == null && l.underDecimal == null)) continue;
    const key = seriesKey(l.playerKey, l.stat, l.book);
    const prev = best.get(key);
    if (!prev || balance(l) < balance(prev)) best.set(key, l);
  }
  return best;
}

function samePoint(a: MovePoint | undefined, b: MovePoint): boolean {
  return Boolean(a && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
}

function appendPoint(doc: MovesDoc, line: OuLine, epoch: number): boolean {
  const key = seriesKey(line.playerKey, line.stat, line.book);
  const point: MovePoint = [epoch, line.line, line.overDecimal, line.underDecimal];
  const series = doc.series[key] ?? (doc.series[key] = []);
  if (samePoint(series.at(-1), point)) return false;
  series.push(point);
  if (!doc.players[line.playerKey]) doc.players[line.playerKey] = line.player;
  return true;
}

/** Rebuild the O/U series from the committed delta history (GitHub runs only; files are not bundled on Vercel). */
function seedFromDiskHistory(doc: MovesDoc): void {
  const file = path.join(NBL_PLAYER_PROP_HISTORY_DIR, `${doc.gameKey}.json`);
  if (!fs.existsSync(file)) return;
  let history: NblPlayerPropHistory;
  try {
    history = JSON.parse(fs.readFileSync(file, 'utf8')) as NblPlayerPropHistory;
  } catch {
    return;
  }
  const state = new Map<string, NblPropHistoryLine>();
  for (const capture of history.captures ?? []) {
    for (const line of capture.upserts) state.set(nblPropHistoryLineKey(line), line);
    for (const key of capture.removed) state.delete(key);
    const epoch = Math.floor(Date.parse(capture.capturedAt) / 1000);
    for (const line of mainOuLines(state.values()).values()) appendPoint(doc, line, epoch);
  }
}

async function readDoc(gameKey: string): Promise<MovesDoc | null> {
  const doc = await sharedCache.getJSON<MovesDoc>(`${REDIS_PREFIX}${gameKey}`);
  return doc && doc.v === 1 && doc.series ? doc : null;
}

async function writeDoc(doc: MovesDoc): Promise<void> {
  await sharedCache.setJSON(`${REDIS_PREFIX}${doc.gameKey}`, doc, REDIS_TTL_SECONDS);
  const index = (await sharedCache.getJSON<string[]>(REDIS_INDEX_KEY)) ?? [];
  if (!index.includes(doc.gameKey)) {
    await sharedCache.setJSON(REDIS_INDEX_KEY, [...index, doc.gameKey].slice(-INDEX_KEEP), REDIS_TTL_SECONDS);
  }
}

/**
 * Record the live (pre-merge) board's O/U lines. One Redis read per game, one write only when
 * something moved. `seedFromDisk` backfills a new record from the committed history first.
 */
export async function recordNblLineMoves(
  board: NblPlayerPropSnapshot,
  capturedAt: string,
  options?: { seedFromDisk?: boolean }
): Promise<boolean> {
  const live = mainOuLines(board.lines);
  if (!live.size) return false;
  const existing = await readDoc(board.gameKey);
  const doc: MovesDoc = existing ?? {
    v: 1,
    gameKey: board.gameKey,
    homeTeam: board.homeTeam,
    awayTeam: board.awayTeam,
    commenceTime: board.commenceTime,
    updatedAt: capturedAt,
    players: {},
    series: {},
  };
  let changed = !existing;
  if (!existing && options?.seedFromDisk) seedFromDiskHistory(doc);
  const epoch = Math.floor(Date.parse(capturedAt) / 1000);
  for (const line of live.values()) {
    if (appendPoint(doc, line, epoch)) changed = true;
  }
  if (!changed) return false;
  doc.updatedAt = capturedAt;
  await writeDoc(doc);
  return true;
}

function toPoint(p: MovePoint): NblLineMovePoint {
  return { at: new Date(p[0] * 1000).toISOString(), line: p[1], over: p[2], under: p[3] };
}

/** The line most books are on (ties go to the lower line), so it is always a real posted line. */
export function consensusLine(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** Upcoming (or same-day) game for this matchup; finished games are never shown. */
function pickGameKey(keys: string[], team: string, opponent: string | null, nowMs: number): string | null {
  const teamSlug = slug(resolveNblClubName(team) || team);
  const oppSlug = opponent ? slug(resolveNblClubName(opponent) || opponent) : '';
  const matches = keys
    .filter((key) => key.includes(teamSlug) && (!oppSlug || key.includes(oppSlug)))
    .sort();
  if (!matches.length) return null;
  const today = new Date(nowMs - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return matches.find((key) => key.slice(0, 10) >= today) ?? null;
}

function findPlayerKey(doc: MovesDoc, playerName: string): string | null {
  const want = playerKeyOf(playerName);
  if (doc.players[want]) return want;
  const last = want.split(' ').at(-1) || '';
  const byLast = Object.keys(doc.players).filter((key) => key.split(' ').at(-1) === last);
  return byLast.length === 1 ? byLast[0] : null;
}

export async function getNblLineMovement(opts: {
  player: string;
  team: string;
  opponent?: string | null;
  nowMs?: number;
}): Promise<NblLineMovement | null> {
  const index = (await sharedCache.getJSON<string[]>(REDIS_INDEX_KEY)) ?? [];
  const gameKey = pickGameKey(index, opts.team, opts.opponent || null, opts.nowMs ?? Date.now());
  if (!gameKey) return null;
  const doc = await readDoc(gameKey);
  if (!doc) return null;
  const playerKey = findPlayerKey(doc, opts.player);

  const byStat = new Map<string, NblBookLineMovement[]>();
  if (playerKey) {
    for (const [key, pts] of Object.entries(doc.series)) {
      const [seriesPlayer, stat, ...bookParts] = key.split('|');
      if (seriesPlayer !== playerKey || !pts.length) continue;
      const points = [...pts].sort((a, b) => a[0] - b[0]).map(toPoint);
      const books = byStat.get(stat) ?? [];
      books.push({ book: bookParts.join('|'), opening: points[0], current: points[points.length - 1], points });
      byStat.set(stat, books);
    }
  }
  const order = (stat: string) => {
    const i = (NBL_LINE_MOVEMENT_STATS as readonly string[]).indexOf(stat);
    return i === -1 ? NBL_LINE_MOVEMENT_STATS.length : i;
  };
  const stats: NblStatLineMovement[] = [...byStat.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([stat, books]) => {
      books.sort((a, b) => b.points.length - a.points.length || a.book.localeCompare(b.book));
      return {
        stat,
        openingLine: consensusLine(books.map((b) => b.opening.line)),
        currentLine: consensusLine(books.map((b) => b.current.line)),
        books,
      };
    });

  return {
    gameKey,
    homeTeam: doc.homeTeam,
    awayTeam: doc.awayTeam,
    commenceTime: doc.commenceTime,
    player: (playerKey && doc.players[playerKey]) || opts.player,
    updatedAt: doc.updatedAt,
    stats,
  };
}
