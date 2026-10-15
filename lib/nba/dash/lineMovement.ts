/**
 * NBA over/under line movement per player, stat and book.
 *
 * Every odds ingest (Vercel cron every 10 minutes) appends a point when a book's main O/U line
 * or prices change, up to tip-off. Stored in Redis. Milestones (10+ and so on) are left out on purpose.
 */

import sharedCache from '@/lib/sharedCache';
import { normalizeNbaPropPlayerName, NBA_STAT_TO_PROP_KEY } from './odds';
import { nbaAmericanToDecimal, type NbaGameOdds } from './oddsTypes';
import { resolveNbaClubName } from './teams';
import type { NbaBookLineMovement, NbaLineMovement, NbaLineMovePoint, NbaStatLineMovement } from './types';

const REDIS_PREFIX = 'nba_ou_moves_v1:';
const REDIS_INDEX_KEY = 'nba_ou_moves_index_v1';
const REDIS_TTL_SECONDS = 45 * 24 * 60 * 60;
const INDEX_KEEP = 400;

export const NBA_LINE_MOVEMENT_STATS = ['points', 'rebounds', 'assists', 'threeMade', 'pra', 'pr', 'pa', 'ra'] as const;

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

type OuLine = {
  book: string;
  player: string;
  playerKey: string;
  stat: string;
  line: number;
  over: number | null;
  under: number | null;
};

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function nbaOddsGameKey(game: Pick<NbaGameOdds, 'homeTeam' | 'awayTeam' | 'commenceTime'>): string {
  return `${String(game.commenceTime || '').slice(0, 10)}_${slug(game.homeTeam)}_vs_${slug(game.awayTeam)}`;
}

function seriesKey(playerKey: string, stat: string, book: string): string {
  return `${playerKey}|${stat}|${book}`;
}

/** A book can list more than one O/U for a player and stat; the main one is the most balanced two-way price. */
function mainOuLines(game: NbaGameOdds): Map<string, OuLine> {
  const best = new Map<string, OuLine>();
  const balance = (l: OuLine) =>
    l.over != null && l.under != null ? Math.abs(l.over - l.under) : Number.POSITIVE_INFINITY;
  for (const [book, players] of Object.entries(game.playerProps || {})) {
    for (const [player, props] of Object.entries(players || {})) {
      const playerKey = normalizeNbaPropPlayerName(player);
      for (const stat of NBA_LINE_MOVEMENT_STATS) {
        for (const entry of props[NBA_STAT_TO_PROP_KEY[stat]] ?? []) {
          if (entry.milestone) continue;
          const line = Number(entry.line);
          const over = nbaAmericanToDecimal(entry.over);
          const under = nbaAmericanToDecimal(entry.under);
          if (!Number.isFinite(line) || over == null || under == null) continue;
          const candidate: OuLine = { book, player, playerKey, stat, line, over, under };
          const key = seriesKey(playerKey, stat, book);
          const prev = best.get(key);
          if (!prev || balance(candidate) < balance(prev)) best.set(key, candidate);
        }
      }
    }
  }
  return best;
}

const round3 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000);

function appendPoint(doc: MovesDoc, line: OuLine, epoch: number): boolean {
  const key = seriesKey(line.playerKey, line.stat, line.book);
  const point: MovePoint = [epoch, line.line, round3(line.over), round3(line.under)];
  const series = doc.series[key] ?? (doc.series[key] = []);
  const last = series.at(-1);
  if (last && last[1] === point[1] && last[2] === point[2] && last[3] === point[3]) return false;
  series.push(point);
  if (!doc.players[line.playerKey]) doc.players[line.playerKey] = line.player;
  return true;
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

/** Record a pre-tip board's O/U lines. One Redis read per game, one write only when something moved. */
export async function recordNbaLineMoves(game: NbaGameOdds, capturedAt: string): Promise<boolean> {
  const live = mainOuLines(game);
  if (!live.size) return false;
  const gameKey = nbaOddsGameKey(game);
  const existing = await readDoc(gameKey);
  const doc: MovesDoc = existing ?? {
    v: 1,
    gameKey,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: game.commenceTime,
    updatedAt: capturedAt,
    players: {},
    series: {},
  };
  let changed = !existing;
  const epoch = Math.floor(Date.parse(capturedAt) / 1000);
  for (const line of live.values()) {
    if (appendPoint(doc, line, epoch)) changed = true;
  }
  if (!changed) return false;
  doc.updatedAt = capturedAt;
  doc.commenceTime = game.commenceTime;
  await writeDoc(doc);
  return true;
}

function toPoint(p: MovePoint): NbaLineMovePoint {
  return { at: new Date(p[0] * 1000).toISOString(), line: p[1], over: p[2], under: p[3] };
}

/** The line most books are on (ties go to the lower line), so it is always a real posted line. */
function consensusLine(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** Upcoming (or same-day) game for this matchup; finished games are never shown. */
function pickGameKey(keys: string[], team: string, opponent: string | null, nowMs: number): string | null {
  const teamSlug = `_${slug(resolveNbaClubName(team) || team)}`;
  const oppSlug = opponent ? `_${slug(resolveNbaClubName(opponent) || opponent)}` : '';
  const today = new Date(nowMs - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const matches = keys
    .filter((key) => key.includes(teamSlug) && (!oppSlug || key.includes(oppSlug)))
    .filter((key) => key.slice(0, 10) >= today)
    .sort();
  return matches[0] ?? null;
}

function findPlayerKey(doc: MovesDoc, playerName: string): string | null {
  const want = normalizeNbaPropPlayerName(playerName);
  if (doc.players[want]) return want;
  const last = want.split(' ').at(-1) || '';
  const byLast = Object.keys(doc.players).filter((key) => key.split(' ').at(-1) === last);
  return byLast.length === 1 ? byLast[0] : null;
}

export async function getNbaLineMovement(opts: {
  player: string;
  team: string;
  opponent?: string | null;
  nowMs?: number;
}): Promise<NbaLineMovement | null> {
  const index = (await sharedCache.getJSON<string[]>(REDIS_INDEX_KEY)) ?? [];
  const gameKey = pickGameKey(index, opts.team, opts.opponent || null, opts.nowMs ?? Date.now());
  if (!gameKey) return null;
  const doc = await readDoc(gameKey);
  if (!doc) return null;
  const playerKey = findPlayerKey(doc, opts.player);

  const byStat = new Map<string, NbaBookLineMovement[]>();
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
    const i = (NBA_LINE_MOVEMENT_STATS as readonly string[]).indexOf(stat);
    return i === -1 ? NBA_LINE_MOVEMENT_STATS.length : i;
  };
  const stats: NbaStatLineMovement[] = [...byStat.entries()]
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
