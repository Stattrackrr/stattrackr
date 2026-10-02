/**
 * Append-only, timestamped NBL odds history on disk.
 *
 * Why: the merged player-prop snapshot (`player-prop-lines/`) and the Redis
 * game-odds payload only keep the latest state, so line movement cannot be
 * reconstructed. These files record every capture whose content differs from
 * the previous capture, so open vs current and the full timeline are stored.
 *
 * Only written when the ingest runs with disk access (GitHub Actions); the
 * production API ingest runs on a read-only filesystem and skips this.
 *
 * Files:
 *   data/nbl-model/cache/player-prop-history/{gameKey}.json
 *     delta captures (upserts + removed keys) of every priced O/U and
 *     milestone line; replay captures in order to rebuild the board at any time
 *   data/nbl-model/cache/game-odds-history/{gameKey}.json
 *     full per-book H2H / Spread / Total set per capture (small, on change)
 */

import fs from 'fs';
import path from 'path';
import type { NblBookRow, NblGameOdds } from '@/lib/nbl/oddsTypes';
import type { NblPlayerPropSnapshot, NblSnapStat } from '@/lib/nbl/playerPropSnapshots';

const CACHE_ROOT = path.join(process.cwd(), 'data', 'nbl-model', 'cache');
export const NBL_PLAYER_PROP_HISTORY_DIR = path.join(CACHE_ROOT, 'player-prop-history');
export const NBL_GAME_ODDS_HISTORY_DIR = path.join(CACHE_ROOT, 'game-odds-history');

export const NBL_ODDS_HISTORY_FORMAT = 1;

export type NblPropHistoryLine = {
  book: string;
  player: string;
  playerKey: string;
  stat: NblSnapStat;
  kind: 'ou' | 'milestone';
  line: number;
  overDecimal: number | null;
  underDecimal: number | null;
};

/**
 * One board capture as a delta against the previous reconstructed state.
 * `upserts` are lines that are new or whose prices changed; `removed` are
 * line keys that were on the board last capture and are gone now.
 * The first capture of a file has every line in `upserts`.
 */
export type NblPropHistoryCapture = {
  capturedAt: string;
  /** Total lines on the board at this capture (after applying the delta). */
  boardSize: number;
  upserts: NblPropHistoryLine[];
  removed: string[];
};

export const NBL_PROP_HISTORY_KEY_FORMAT = 'book|playerKey|stat|kind|line';

export type NblPlayerPropHistory = {
  format: number;
  gameKey: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  /** Replay captures in order: apply upserts by key, then delete removed keys. */
  mode: 'delta';
  keyFormat: typeof NBL_PROP_HISTORY_KEY_FORMAT;
  firstCapturedAt: string;
  lastCapturedAt: string;
  captures: NblPropHistoryCapture[];
};

export type NblGameOddsHistoryCapture = {
  capturedAt: string;
  bookmakers: Array<Pick<NblBookRow, 'name' | 'H2H' | 'Spread' | 'Total'>>;
};

export type NblGameOddsHistory = {
  format: number;
  gameKey: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  mode: 'full-set-on-change';
  firstCapturedAt: string;
  lastCapturedAt: string;
  captures: NblGameOddsHistoryCapture[];
};

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Compact JSON: history files are append-heavy and committed to git. */
function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Same key shape as `nblPlayerPropGameKey` so both histories line up with snapshots. */
export function nblOddsHistoryGameKey(home: string, away: string, commenceTime: string): string {
  const day = String(commenceTime || '').slice(0, 10);
  return `${day}_${slug(home)}_vs_${slug(away)}`;
}

export function nblPropHistoryLineKey(l: Pick<NblPropHistoryLine, 'book' | 'playerKey' | 'stat' | 'kind' | 'line'>): string {
  return `${l.book}|${l.playerKey}|${l.stat}|${l.kind}|${l.line}`;
}

function compareLines(a: NblPropHistoryLine, b: NblPropHistoryLine): number {
  return (
    a.book.localeCompare(b.book) ||
    a.playerKey.localeCompare(b.playerKey) ||
    a.stat.localeCompare(b.stat) ||
    a.kind.localeCompare(b.kind) ||
    a.line - b.line
  );
}

function boardLines(snapshot: NblPlayerPropSnapshot): Map<string, NblPropHistoryLine> {
  const out = new Map<string, NblPropHistoryLine>();
  for (const l of snapshot.lines) {
    if (l.overDecimal == null && l.underDecimal == null) continue;
    const row: NblPropHistoryLine = {
      book: l.book,
      player: l.player,
      playerKey: l.playerKey,
      stat: l.stat,
      kind: l.kind,
      line: l.line,
      overDecimal: l.overDecimal,
      underDecimal: l.underDecimal,
    };
    out.set(nblPropHistoryLineKey(row), row);
  }
  return out;
}

/** Replay a history file's captures into the board state after the last capture. */
export function replayNblPlayerPropHistory(history: NblPlayerPropHistory | null): Map<string, NblPropHistoryLine> {
  const state = new Map<string, NblPropHistoryLine>();
  for (const capture of history?.captures ?? []) {
    for (const line of capture.upserts) state.set(nblPropHistoryLineKey(line), line);
    for (const key of capture.removed) state.delete(key);
  }
  return state;
}

function samePrice(a: NblPropHistoryLine, b: NblPropHistoryLine): boolean {
  return a.overDecimal === b.overDecimal && a.underDecimal === b.underDecimal && a.player === b.player;
}

/**
 * Append a delta capture for a game when the live board differs from the
 * reconstructed previous state. Returns true when a capture was written.
 */
export function appendNblPlayerPropHistory(
  snapshot: NblPlayerPropSnapshot,
  capturedAt: string
): boolean {
  const board = boardLines(snapshot);
  if (!board.size) return false;

  const file = path.join(NBL_PLAYER_PROP_HISTORY_DIR, `${snapshot.gameKey}.json`);
  const prev = readJson<NblPlayerPropHistory>(file);
  const prevState = replayNblPlayerPropHistory(prev);

  const upserts: NblPropHistoryLine[] = [];
  for (const [key, line] of board) {
    const before = prevState.get(key);
    if (!before || !samePrice(before, line)) upserts.push(line);
  }
  upserts.sort(compareLines);
  const removed = [...prevState.keys()].filter((key) => !board.has(key)).sort();
  if (!upserts.length && !removed.length) return false;

  const capture: NblPropHistoryCapture = { capturedAt, boardSize: board.size, upserts, removed };
  const next: NblPlayerPropHistory = {
    format: NBL_ODDS_HISTORY_FORMAT,
    gameKey: snapshot.gameKey,
    gameId: prev?.gameId || snapshot.gameId,
    homeTeam: prev?.homeTeam || snapshot.homeTeam,
    awayTeam: prev?.awayTeam || snapshot.awayTeam,
    commenceTime: prev?.commenceTime || snapshot.commenceTime,
    mode: 'delta',
    keyFormat: NBL_PROP_HISTORY_KEY_FORMAT,
    firstCapturedAt: prev?.firstCapturedAt || capturedAt,
    lastCapturedAt: capturedAt,
    captures: [...(prev?.captures ?? []), capture],
  };
  writeJson(file, next);
  return true;
}

function sameCapture(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sortedBookRows(game: NblGameOdds): NblGameOddsHistoryCapture['bookmakers'] {
  return game.bookmakers
    .map((b) => ({ name: b.name, H2H: b.H2H, Spread: b.Spread, Total: b.Total }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Append the current per-book game lines if they differ from the last capture.
 * Returns the number of games whose history was written.
 */
export function appendNblGameOddsHistory(games: NblGameOdds[], capturedAt: string): number {
  let written = 0;
  for (const game of games) {
    const bookmakers = sortedBookRows(game);
    if (!bookmakers.length) continue;
    const gameKey = nblOddsHistoryGameKey(game.homeTeam, game.awayTeam, game.commenceTime);
    const file = path.join(NBL_GAME_ODDS_HISTORY_DIR, `${gameKey}.json`);
    const prev = readJson<NblGameOddsHistory>(file);
    const last = prev?.captures?.length ? prev.captures[prev.captures.length - 1] : null;
    if (last && sameCapture(last.bookmakers, bookmakers)) continue;

    const next: NblGameOddsHistory = {
      format: NBL_ODDS_HISTORY_FORMAT,
      gameKey,
      gameId: prev?.gameId || game.gameId,
      homeTeam: prev?.homeTeam || game.homeTeam,
      awayTeam: prev?.awayTeam || game.awayTeam,
      commenceTime: prev?.commenceTime || game.commenceTime,
      mode: 'full-set-on-change',
      firstCapturedAt: prev?.firstCapturedAt || capturedAt,
      lastCapturedAt: capturedAt,
      captures: [...(prev?.captures ?? []), { capturedAt, bookmakers }],
    };
    writeJson(file, next);
    written += 1;
  }
  return written;
}
