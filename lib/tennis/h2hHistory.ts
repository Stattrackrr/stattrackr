/**
 * Career head-to-head from API-Tennis get_H2H.
 * Player logs only cover TENNIS_HISTORY_YEARS (2024–2026), so dashboard H2H
 * is empty for pairs whose meetings are older. Fetch the pair, map to rows,
 * and merge at read time.
 */

import fs from 'fs';
import path from 'path';
import sharedCache from '@/lib/sharedCache';
import {
  apiTennisDir,
  loadApiTennisPlayers,
  mapApiFixtureToRows,
  type ApiPlayerInfo,
  type ApiTennisFixture,
} from '@/lib/tennis/apiTennis';
import { loadTennisPlayers } from '@/lib/tennis/data';
import {
  mergeTennisH2hRows,
  tennisH2hPairKey,
  tennisIsH2hMatch,
  tennisResolveOpponentId,
} from '@/lib/tennis/h2hMatch';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';

const API_BASE = 'https://api.api-tennis.com/tennis/';
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

function apiKey(): string {
  return String(process.env.API_TENNIS_KEY || '').trim();
}

function h2hDir(): string {
  return path.join(apiTennisDir(), 'h2h');
}

function diskPath(pairKey: string): string {
  return path.join(h2hDir(), `${pairKey.replace(/:/g, '-')}.json`);
}

function redisKey(pairKey: string): string {
  return `${REDIS_PREFIX}${pairKey}`;
}

function playerInfoMap(): Map<string, ApiPlayerInfo> {
  const map = new Map<string, ApiPlayerInfo>();
  const players = loadApiTennisPlayers() || loadTennisPlayers();
  for (const player of players) {
    const id = String(player.playerId || '').trim();
    if (!id) continue;
    map.set(id, {
      playerId: id,
      name: player.name,
      tour: player.tour,
      ioc: player.ioc ?? null,
      rank: player.rank ?? null,
      rankPoints: player.rankPoints ?? null,
      imageUrl: null,
    });
  }
  return map;
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

function writeDisk(payload: H2hPairCache) {
  try {
    fs.mkdirSync(h2hDir(), { recursive: true });
    fs.writeFileSync(
      diskPath(tennisH2hPairKey(payload.firstId, payload.secondId)),
      JSON.stringify(payload)
    );
  } catch {
    /* ignore quota / read-only */
  }
}

async function apiTennisCall(params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ APIkey: key, ...params });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`${API_BASE}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res) {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 800));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!json?.success && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    return json;
  }
  return null;
}

function fixturesFromH2hPayload(json: any): ApiTennisFixture[] {
  const result = json?.result;
  const list = result?.H2H || result?.h2h;
  return Array.isArray(list) ? list : Array.isArray(result) ? result : [];
}

async function fetchPairRows(firstId: string, secondId: string): Promise<TennisMatchRow[]> {
  const json = await apiTennisCall({
    method: 'get_H2H',
    first_player_key: firstId,
    second_player_key: secondId,
  });
  if (!json?.success) return [];
  const fixtures = fixturesFromH2hPayload(json);
  if (!fixtures.length) return [];
  const players = playerInfoMap();
  return fixtures.flatMap((fx) => mapApiFixtureToRows(fx, players));
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
    const games = await fetchPairRows(playerId, opponentId);
    const ttlMs = games.length ? HIT_TTL_MS : EMPTY_TTL_MS;
    remember(pairKey, games, ttlMs);
    if (games.length) {
      const payload: H2hPairCache = {
        fetchedAt: new Date().toISOString(),
        firstId: playerId,
        secondId: opponentId,
        games,
      };
      writeDisk(payload);
      void sharedCache.setJSON(redisKey(pairKey), payload, REDIS_TTL_SECONDS);
    }
    return games;
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
