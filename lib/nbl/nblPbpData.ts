/**
 * Disk cache + overlay for NBL PBP-derived player points/rebounds/assists by quarter
 * and court-chemistry payloads. Dashboard APIs must read cache only (warm scripts fetch live).
 */

import fs from 'fs';
import path from 'path';
import { findNblScheduleMatch, loadNblScheduleGames } from '@/lib/nbl/enrichGameLogsFromSchedule';
import {
  fixtureIdOf,
  isCompletedGame,
  loadScheduleGames,
  nblShotPlayerNamesMatch,
} from '@/lib/nbl/nblShotChartData';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import {
  isNblChemCacheComplete,
  parseNblPbpChemistry,
  readCachedPbpChemistry,
  writeCachedPbpChemistry,
} from '@/lib/nbl/nblPbpChemistry';
import {
  fetchNblMatchPbpJson,
  parseNblPbpPoints,
  type NblMatchPbpPoints,
  type NblPbpPlayerPoints,
} from '@/lib/nbl/sportRadarPbp';

const PBP_CACHE_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'pbp');

function pbpCachePath(fixtureId: string): string {
  return path.join(PBP_CACHE_DIR, `${fixtureId}.json`);
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function isNblPbpCacheComplete(cached: NblMatchPbpPoints | null | undefined): boolean {
  if (!cached || !Array.isArray(cached.players)) return false;
  const sample = cached.players[0];
  if (!sample) return true;
  return typeof sample.q1_reb === 'number' && typeof sample.q1_ast === 'number';
}

export function readCachedPbpPoints(fixtureId: string): NblMatchPbpPoints | null {
  const id = String(fixtureId || '').trim();
  if (!id) return null;
  const cached = readJson<NblMatchPbpPoints>(pbpCachePath(id));
  if (!cached || !Array.isArray(cached.players)) return null;
  return cached;
}

export function writeCachedPbpPoints(payload: NblMatchPbpPoints): void {
  writeJson(pbpCachePath(payload.fixtureId), payload);
}

export async function getMatchPbpPoints(
  fixtureId: string,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<NblMatchPbpPoints | null> {
  if (!options.forceRefresh) {
    const cached = readCachedPbpPoints(fixtureId);
    const chem = readCachedPbpChemistry(fixtureId);
    if (cached && isNblPbpCacheComplete(cached) && isNblChemCacheComplete(chem)) return cached;
  }
  const json = await fetchNblMatchPbpJson(fixtureId, { signal: options.signal });
  if (json) {
    const live = parseNblPbpPoints(fixtureId, json);
    const chem = parseNblPbpChemistry(fixtureId, json);
    if (live) writeCachedPbpPoints(live);
    if (chem) writeCachedPbpChemistry(chem);
    if (live) return live;
  }
  return readCachedPbpPoints(fixtureId);
}

function toNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function quarterOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const EMPTY_QUARTER_SPLITS = {
  q1_pts: 0,
  q2_pts: 0,
  q3_pts: 0,
  q4_pts: 0,
  q1_reb: 0,
  q2_reb: 0,
  q3_reb: 0,
  q4_reb: 0,
  q1_ast: 0,
  q2_ast: 0,
  q3_ast: 0,
  q4_ast: 0,
} as const;

function matchPbpPlayer(
  players: NblPbpPlayerPoints[],
  playerName: string
): NblPbpPlayerPoints | null {
  const exact = players.filter((p) => nblShotPlayerNamesMatch(p.name, playerName));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    return [...exact].sort((a, b) => b.total - a.total)[0];
  }
  return null;
}

export function overlayNblQuarterPoints(
  games: NblGameLogRow[],
  playerName: string | null | undefined,
  year: number
): NblGameLogRow[] {
  const name = String(playerName || '').trim();
  if (!games.length || !name) return games;
  const schedule = loadNblScheduleGames(year);
  if (!schedule.length) return games;

  const pbpByFixture = new Map<string, NblMatchPbpPoints | null>();

  return games.map((game) => {
    const match = findNblScheduleMatch(game, schedule);
    const fixtureId = match ? String(match.externalId || match.id || '').trim() : '';
    if (!fixtureId) return game;

    let pbp = pbpByFixture.get(fixtureId);
    if (pbp === undefined) {
      pbp = readCachedPbpPoints(fixtureId);
      pbpByFixture.set(fixtureId, pbp);
    }
    if (!pbp) return game;

    const player = matchPbpPlayer(pbp.players, name);
    if (!player) {
      const hadBoxStats =
        (toNum(game.points) ?? 0) > 0 ||
        (toNum(game.rebounds) ?? 0) > 0 ||
        (toNum(game.assists) ?? 0) > 0;
      if (hadBoxStats) return game;
      return {
        ...game,
        ...EMPTY_QUARTER_SPLITS,
      };
    }
    return {
      ...game,
      q1_pts: player.q1_pts,
      q2_pts: player.q2_pts,
      q3_pts: player.q3_pts,
      q4_pts: player.q4_pts,
      q1_reb: quarterOrNull(player.q1_reb),
      q2_reb: quarterOrNull(player.q2_reb),
      q3_reb: quarterOrNull(player.q3_reb),
      q4_reb: quarterOrNull(player.q4_reb),
      q1_ast: quarterOrNull(player.q1_ast),
      q2_ast: quarterOrNull(player.q2_ast),
      q3_ast: quarterOrNull(player.q3_ast),
      q4_ast: quarterOrNull(player.q4_ast),
    };
  });
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export async function warmNblPbpPoints(options: {
  years: number[];
  concurrency?: number;
  forceRefresh?: boolean;
}): Promise<{
  years: number[];
  games: number;
  fixtures: number;
  fetched: number;
  cached: number;
  missing: number;
}> {
  const concurrency = options.concurrency ?? 2;
  const games = loadScheduleGames(options.years).filter(isCompletedGame);
  const fixtureIds = [...new Set(games.map((g) => fixtureIdOf(g)).filter((id): id is string => Boolean(id)))];

  let fetched = 0;
  let cached = 0;
  let missing = 0;

  await mapPool(fixtureIds, concurrency, async (fixtureId) => {
    const existing = readCachedPbpPoints(fixtureId);
    const existingChem = readCachedPbpChemistry(fixtureId);
    const had = Boolean(existing);
    const stale =
      (had && !isNblPbpCacheComplete(existing)) || !isNblChemCacheComplete(existingChem);
    if (had && !stale && !options.forceRefresh) {
      cached += 1;
      return;
    }
    const live = await getMatchPbpPoints(fixtureId, { forceRefresh: options.forceRefresh || stale });
    if (live) {
      if (had && !stale && !options.forceRefresh) cached += 1;
      else fetched += 1;
    } else {
      missing += 1;
    }
  });

  return {
    years: options.years,
    games: games.length,
    fixtures: fixtureIds.length,
    fetched,
    cached,
    missing,
  };
}
