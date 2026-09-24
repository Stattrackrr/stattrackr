/**
 * Durable odds-api.net (Sportsbet / TAB / Bet365 / Unibet) NBL player-line snapshots.
 * Live board vanishes after tip — these files keep closing O/Us / milestones.
 */

import fs from 'fs';
import path from 'path';
import { decimalToAmerican } from '@/lib/currencyUtils';
import {
  classifyPulseNblMarket,
  isPulsePlayerName,
  pulseMarketPlayerName,
  type PulseNblGame,
} from '@/lib/nbl/pulseScore';
import sharedCache from '@/lib/sharedCache';

export const NBL_PLAYER_PROP_SNAPSHOT_DIR = path.join(
  process.cwd(),
  'data',
  'nbl-model',
  'cache',
  'player-prop-lines'
);

const REDIS_PREFIX = 'nbl_ps_lines_v1:';
const REDIS_INDEX_KEY = 'nbl_ps_lines_index_v1';
const REDIS_TTL_SECONDS = 400 * 24 * 60 * 60;
const CLOSE_GRACE_MS = 5 * 60 * 1000;

export type NblSnapStat = 'points' | 'rebounds' | 'assists' | 'threeMade';

export type NblSnapLine = {
  player: string;
  playerKey: string;
  book: string;
  stat: NblSnapStat;
  kind: 'ou' | 'milestone';
  line: number;
  label: string;
  over: string;
  under: string;
  overDecimal: number | null;
  underDecimal: number | null;
};

export type NblPlayerPropSnapshot = {
  gameId: string;
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  capturedAt: string;
  closing: boolean;
  source: 'odds-api-net' | 'pulsescore';
  books: string[];
  lineCount: number;
  lines: NblSnapLine[];
};

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function nblPlayerPropGameKey(home: string, away: string, commenceTime: string): string {
  const day = String(commenceTime || '').slice(0, 10);
  return `${day}_${slug(home)}_vs_${slug(away)}`;
}

function snapshotPath(gameKey: string): string {
  return path.join(NBL_PLAYER_PROP_SNAPSHOT_DIR, `${gameKey}.json`);
}

function stripPlayerLabel(raw: string): string {
  return String(raw || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+(over|under)\b.*$/i, '')
    .trim();
}

function playerKeyOf(s: string): string {
  return stripPlayerLabel(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function americanFromDecimal(odds: number | undefined): string {
  if (odds == null || !Number.isFinite(odds) || odds <= 1) return 'N/A';
  return decimalToAmerican(odds);
}

function sideOf(sel: { canonicalOutcome?: string; rawName?: string; name?: string }): 'over' | 'under' | null {
  const blob = `${sel.canonicalOutcome || ''} ${sel.rawName || ''} ${sel.name || ''}`.toLowerCase();
  if (/\bunder\b/.test(blob)) return 'under';
  if (/\bover\b/.test(blob)) return 'over';
  return 'over';
}

export function flattenPulseNblGame(game: PulseNblGame): NblSnapLine[] {
  const grouped = new Map<string, NblSnapLine>();
  for (const book of game.bookmakers || []) {
    for (const market of book.markets || []) {
      if (market.isActive === false) continue;
      const parsed = classifyPulseNblMarket(market);
      if (!parsed) continue;
      if (parsed.stat !== 'points' && parsed.stat !== 'rebounds' && parsed.stat !== 'assists' && parsed.stat !== 'threeMade') {
        continue;
      }
      const twoWay = parsed.kind === 'ou';
      for (const sel of market.selections || []) {
        if (sel.isActive === false) continue;
        if (
          !twoWay &&
          /\bno\b/i.test(`${sel.canonicalOutcome || ''} ${sel.rawName || ''} ${sel.name || ''}`)
        ) {
          continue;
        }
        const player = pulseMarketPlayerName(market, sel);
        if (!isPulsePlayerName(player)) continue;
        const odds = typeof sel.odds === 'number' && Number.isFinite(sel.odds) ? sel.odds : null;
        if (odds == null || odds <= 1) continue;

        let line =
          typeof sel.line === 'number' && Number.isFinite(sel.line)
            ? sel.line
            : typeof market.line === 'number' && Number.isFinite(market.line)
              ? market.line
              : null;
        let label: string;
        if (parsed.kind === 'milestone' && parsed.threshold != null) {
          line = parsed.threshold - 0.5;
          label = `${parsed.threshold}+`;
        } else if (line == null) {
          continue;
        } else {
          label = String(line);
        }
        if (parsed.stat === 'points' && line > 80) continue;

        const key = `${book.name}|${playerKeyOf(player)}|${parsed.stat}|${parsed.kind}|${line}`;
        const existing = grouped.get(key) ?? {
          player,
          playerKey: playerKeyOf(player),
          book: book.name,
          stat: parsed.stat,
          kind: parsed.kind,
          line,
          label,
          over: 'N/A',
          under: 'N/A',
          overDecimal: null,
          underDecimal: null,
        };
        const side = parsed.kind === 'milestone' ? 'over' : sideOf(sel);
        if (side === 'under') {
          existing.underDecimal = odds;
          existing.under = americanFromDecimal(odds);
        } else {
          existing.overDecimal = odds;
          existing.over = americanFromDecimal(odds);
        }
        grouped.set(key, existing);
      }
    }
  }
  return [...grouped.values()].sort((a, b) => {
    const p = a.player.localeCompare(b.player);
    if (p) return p;
    const s = a.stat.localeCompare(b.stat);
    if (s) return s;
    if (a.line !== b.line) return a.line - b.line;
    return a.book.localeCompare(b.book);
  });
}

function buildSnapshot(game: PulseNblGame, nowIso: string, closing: boolean): NblPlayerPropSnapshot | null {
  const lines = flattenPulseNblGame(game);
  if (!lines.length) return null;
  const gameKey = nblPlayerPropGameKey(game.homeTeam, game.awayTeam, game.commenceTime);
  return {
    gameId: game.gameId,
    gameKey,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: game.commenceTime,
    capturedAt: nowIso,
    closing,
    source: 'odds-api-net',
    books: [...new Set(lines.map((l) => l.book))],
    lineCount: lines.length,
    lines,
  };
}

function gameHasStarted(commenceTime: string, nowMs: number): boolean {
  const t = Date.parse(commenceTime);
  if (!Number.isFinite(t)) return false;
  return nowMs >= t + CLOSE_GRACE_MS;
}

function twoWayOuCount(snap: NblPlayerPropSnapshot): number {
  return snap.lines.filter(
    (line) => line.kind === 'ou' && line.under !== 'N/A' && line.over !== 'N/A' && isPulsePlayerName(line.player)
  ).length;
}

function betterSnapshot(prev: NblPlayerPropSnapshot | null, next: NblPlayerPropSnapshot): NblPlayerPropSnapshot {
  if (!prev) return next;
  if (prev.closing && !next.closing) return prev;
  const mergedLines = [...prev.lines];
  for (const line of next.lines) {
    const existing = mergedLines.find(
      (row) =>
        row.book === line.book &&
        row.stat === line.stat &&
        row.playerKey === line.playerKey &&
        row.kind === line.kind &&
        row.line === line.line
    );
    if (!existing) {
      mergedLines.push(line);
      continue;
    }
    if (existing.over === 'N/A' && line.over !== 'N/A') {
      existing.over = line.over;
      existing.overDecimal = line.overDecimal;
    }
    if (existing.under === 'N/A' && line.under !== 'N/A') {
      existing.under = line.under;
      existing.underDecimal = line.underDecimal;
    }
    if (line.kind === 'ou') existing.kind = 'ou';
    if (isPulsePlayerName(line.player) && !isPulsePlayerName(existing.player)) {
      existing.player = line.player;
      existing.playerKey = line.playerKey;
    }
  }
  const merged: NblPlayerPropSnapshot = {
    ...next,
    homeTeam: prev.homeTeam || next.homeTeam,
    awayTeam: prev.awayTeam || next.awayTeam,
    closing: prev.closing || next.closing,
    books: [...new Set([...prev.books, ...next.books])],
    lines: mergedLines,
    lineCount: mergedLines.length,
  };
  if (prev.closing && twoWayOuCount(prev) >= twoWayOuCount(merged)) return prev;
  return merged;
}

function readDiskSnapshot(gameKey: string): NblPlayerPropSnapshot | null {
  try {
    const file = snapshotPath(gameKey);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as NblPlayerPropSnapshot;
    if (!raw || !Array.isArray(raw.lines)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeDiskSnapshot(snap: NblPlayerPropSnapshot): void {
  fs.mkdirSync(NBL_PLAYER_PROP_SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(snapshotPath(snap.gameKey), `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
}

async function readRedisSnapshot(gameKey: string): Promise<NblPlayerPropSnapshot | null> {
  try {
    const raw = await sharedCache.getJSON<NblPlayerPropSnapshot>(`${REDIS_PREFIX}${gameKey}`);
    if (!raw || !Array.isArray(raw.lines)) return null;
    return raw;
  } catch {
    return null;
  }
}

async function writeRedisSnapshot(snap: NblPlayerPropSnapshot): Promise<void> {
  await sharedCache.setJSON(`${REDIS_PREFIX}${snap.gameKey}`, snap, REDIS_TTL_SECONDS);
  const index = (await sharedCache.getJSON<string[]>(REDIS_INDEX_KEY)) ?? [];
  if (!index.includes(snap.gameKey)) {
    index.push(snap.gameKey);
    await sharedCache.setJSON(REDIS_INDEX_KEY, index, REDIS_TTL_SECONDS);
  }
}

export async function listNblPlayerPropSnapshotsFromRedis(): Promise<NblPlayerPropSnapshot[]> {
  try {
    const keys = (await sharedCache.getJSON<string[]>(REDIS_INDEX_KEY)) ?? [];
    if (!keys.length) return [];
    const rows = await sharedCache.getJSONMany<NblPlayerPropSnapshot>(
      keys.map((key) => `${REDIS_PREFIX}${key}`)
    );
    return rows.filter((row): row is NblPlayerPropSnapshot => Boolean(row && Array.isArray(row.lines)));
  } catch {
    return [];
  }
}

export async function listNblPlayerPropSnapshots(): Promise<NblPlayerPropSnapshot[]> {
  const byKey = new Map<string, NblPlayerPropSnapshot>();
  for (const snap of [...listNblPlayerPropSnapshotsFromDisk(), ...(await listNblPlayerPropSnapshotsFromRedis())]) {
    const prev = byKey.get(snap.gameKey);
    byKey.set(snap.gameKey, prev ? betterSnapshot(prev, snap) : snap);
  }
  return [...byKey.values()];
}

export async function persistNblPlayerPropSnapshots(
  games: PulseNblGame[],
  options?: { disk?: boolean }
): Promise<{ saved: number; frozen: number; skipped: number }> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const writeDisk = options?.disk !== false;
  let saved = 0;
  let frozen = 0;
  let skipped = 0;

  for (const game of games) {
    const started = gameHasStarted(game.commenceTime, nowMs);
    const incoming = buildSnapshot(game, nowIso, started);
    const gameKey = nblPlayerPropGameKey(game.homeTeam, game.awayTeam, game.commenceTime);
    const prev = (writeDisk ? readDiskSnapshot(gameKey) : null) ?? (await readRedisSnapshot(gameKey));

    if (!incoming) {
      if (prev && !prev.closing && started) {
        const closed = { ...prev, closing: true };
        if (writeDisk) {
          try {
            writeDiskSnapshot(closed);
          } catch {
            /* Vercel FS is read-only */
          }
        }
        await writeRedisSnapshot(closed);
        frozen += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const merged = betterSnapshot(prev, incoming);
    const becameClosing = !prev?.closing && merged.closing;
    if (prev?.closing && prev.gameKey === merged.gameKey) {
      skipped += 1;
      continue;
    }
    if (writeDisk) {
      try {
        writeDiskSnapshot(merged);
      } catch {
        /* Vercel FS is read-only */
      }
    }
    await writeRedisSnapshot(merged);
    saved += 1;
    if (becameClosing) frozen += 1;
  }

  return { saved, frozen, skipped };
}

export function listNblPlayerPropSnapshotsFromDisk(): NblPlayerPropSnapshot[] {
  try {
    if (!fs.existsSync(NBL_PLAYER_PROP_SNAPSHOT_DIR)) return [];
    return fs
      .readdirSync(NBL_PLAYER_PROP_SNAPSHOT_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readDiskSnapshot(name.replace(/\.json$/i, '')))
      .filter((row): row is NblPlayerPropSnapshot => Boolean(row));
  } catch {
    return [];
  }
}

export function readNblPlayerPropSnapshotFile(
  home: string,
  away: string,
  commenceTime: string
): NblPlayerPropSnapshot | null {
  return readDiskSnapshot(nblPlayerPropGameKey(home, away, commenceTime));
}

export async function readNblPlayerPropSnapshot(
  home: string,
  away: string,
  commenceTime: string
): Promise<NblPlayerPropSnapshot | null> {
  const gameKey = nblPlayerPropGameKey(home, away, commenceTime);
  return readDiskSnapshot(gameKey) ?? (await readRedisSnapshot(gameKey));
}
