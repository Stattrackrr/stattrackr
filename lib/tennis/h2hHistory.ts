/**
 * Career head-to-head from stored pair cache (Redis, then data/tennis/api-tennis/h2h).
 * Dashboard GETs never call API-Tennis get_H2H.
 */

import fs from 'fs';
import path from 'path';
import sharedCache from '@/lib/sharedCache';
import { apiTennisDir } from '@/lib/tennis/apiTennis';
import { loadTennisPlayers } from '@/lib/tennis/data';
import {
  mergeTennisH2hRows,
  tennisH2hPairKey,
  tennisIsH2hMatch,
  tennisResolveOpponentId,
} from '@/lib/tennis/h2hMatch';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';

const REDIS_PREFIX = 'tennis_h2h_pair_v1:';
const REDIS_TTL_SECONDS = 2 * 60 * 60;
const EMPTY_TTL_MS = 15 * 60 * 1000;
const HIT_TTL_MS = 2 * 60 * 60 * 1000;
const DISK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type H2hPairCache = {
  fetchedAt: string;
  firstId: string;
  secondId: string;
  games: TennisMatchRow[];
};

type MemEntry = { at: number; ttlMs: number; games: TennisMatchRow[] };

const mem = new Map<string, MemEntry>();
const inflight = new Map<string, Promise<TennisMatchRow[]>>();

function h2hDir(): string {
  return path.join(apiTennisDir(), 'h2h');
}

function diskPath(pairKey: string): string {
  return path.join(h2hDir(), `${pairKey.replace(/:/g, '-')}.json`);
}

function redisKey(pairKey: string): string {
  return `${REDIS_PREFIX}${pairKey}`;
}

function remember(pairKey: string, games: TennisMatchRow[], ttlMs: number) {
  mem.set(pairKey, { at: Date.now(), ttlMs, games });
}

function memoryGames(pairKey: string): TennisMatchRow[] | null {
  const hit = mem.get(pairKey);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttlMs) {
    mem.delete(pairKey);
    return null;
  }
  return hit.games;
}

function readDisk(pairKey: string): H2hPairCache | null {
  try {
    const file = diskPath(pairKey);
    if (!fs.existsSync(file)) return null;
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age > DISK_MAX_AGE_MS) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as H2hPairCache;
    if (!Array.isArray(parsed?.games)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadPairRows(playerId: string, opponentId: string): Promise<TennisMatchRow[]> {
  const pairKey = tennisH2hPairKey(playerId, opponentId);
  const cached = memoryGames(pairKey);
  if (cached) return cached;
  const pending = inflight.get(pairKey);
  if (pending) return pending;

  const job = (async () => {
    const fromRedis = await sharedCache.getJSON<H2hPairCache>(redisKey(pairKey));
    if (Array.isArray(fromRedis?.games)) {
      remember(pairKey, fromRedis.games, HIT_TTL_MS);
      return fromRedis.games;
    }
    const fromDisk = readDisk(pairKey);
    if (fromDisk?.games) {
      remember(pairKey, fromDisk.games, HIT_TTL_MS);
      void sharedCache.setJSON(redisKey(pairKey), fromDisk, REDIS_TTL_SECONDS);
      return fromDisk.games;
    }
    remember(pairKey, [], EMPTY_TTL_MS);
    return [];
  })();

  inflight.set(pairKey, job);
  try {
    return await job;
  } finally {
    inflight.delete(pairKey);
  }
}

export async function loadH2hMatchesForPlayer(
  playerId: string,
  opponentId: string
): Promise<TennisMatchRow[]> {
  const id = String(playerId || '').trim();
  const opp = String(opponentId || '').trim();
  if (!id || !opp || id === opp) return [];
  const rows = await loadPairRows(id, opp);
  return rows.filter(
    (row) => String(row.playerId) === id && tennisIsH2hMatch(row, null, opp)
  );
}

export async function mergeCareerH2h(
  games: TennisMatchRow[],
  playerId?: string | null,
  opponentId?: string | null,
  opponentName?: string | null,
  tour?: TennisTour | null
): Promise<TennisMatchRow[]> {
  const id = String(playerId || '').trim();
  const resolvedOpp =
    tennisResolveOpponentId(loadTennisPlayers(), opponentName, opponentId, tour) ||
    String(opponentId || '').trim() ||
    null;
  if (!id || !resolvedOpp) return games;
  const h2h = await loadH2hMatchesForPlayer(id, resolvedOpp);
  if (!h2h.length) return games;
  return mergeTennisH2hRows(games, h2h);
}
