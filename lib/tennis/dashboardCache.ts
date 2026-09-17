/**
 * Tennis dashboard cache — AFL-style small Redis keys, written by cron.
 * Never stores the 13MB overlay in Redis or on disk.
 */

import sharedCache from '@/lib/sharedCache';
import type { TennisMatchRow, TennisPlayer, TennisRankingRow, TennisTour } from '@/lib/tennis/types';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';

export const TENNIS_ROSTER_CACHE_KEY = 'tennis_dashboard_roster_v1';
export const TENNIS_ROSTER_CACHE_TYPE = 'tennis_roster';
const TENNIS_PLAYER_LOGS_PREFIX = 'tennis_player_logs_v1:';
const TENNIS_COMPUTED_PREFIX = 'tennis_dash_computed_v1:';
const TENNIS_SHARDS_MARK_KEY = 'tennis_dashboard_shards_mark_v1';

const LOGS_TTL_SECONDS = 60 * 60 * 24 * 30;
const COMPUTED_TTL_SECONDS = 6 * 60 * 60;
const MARK_TTL_SECONDS = 60 * 60 * 24 * 40;
const PUBLISH_CONCURRENCY = 4;
const MAX_ROSTER_PLAYERS = 700;
const MAX_LOG_PLAYERS = 250;
const MAX_GAMES_PER_PLAYER = 80;
const MAX_VALUE_BYTES = 400 * 1024;

export type TennisRosterCache = {
  fetchedAt: string;
  players: TennisPlayer[];
  standings: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
};

export type TennisPlayerLogsCache = {
  fetchedAt: string;
  playerId: string;
  playerName: string;
  tour: TennisTour | null;
  games: TennisMatchRow[];
};

function playerLogsKey(playerId: string): string {
  return `${TENNIS_PLAYER_LOGS_PREFIX}${String(playerId || '').trim()}`;
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function slimPlayer(player: TennisPlayer): TennisPlayer {
  return {
    playerId: player.playerId,
    name: player.name,
    tour: player.tour,
    ioc: player.ioc ?? null,
    hand: player.hand ?? null,
    height: player.height ?? null,
    rank: player.rank ?? null,
    rankPoints: player.rankPoints ?? null,
    imageUrl: clientTennisHeadshotUrl(player.playerId, player.imageUrl),
  };
}

function capGames(games: TennisMatchRow[]): TennisMatchRow[] {
  if (games.length <= MAX_GAMES_PER_PLAYER) return games;
  return [...games]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .slice(-MAX_GAMES_PER_PLAYER);
}

export function tennisComputedCacheKey(kind: string, parts: Array<string | null | undefined>): string {
  const slug = parts
    .map((part) => String(part || '').trim().toLowerCase().replace(/\s+/g, '_'))
    .join(':');
  return `${TENNIS_COMPUTED_PREFIX}${kind}:${slug}`;
}

export async function readTennisComputedCache<T>(key: string): Promise<T | null> {
  const cached = await sharedCache.getJSON<T>(key);
  return cached && typeof cached === 'object' ? cached : null;
}

export async function writeTennisComputedCache<T>(key: string, value: T): Promise<void> {
  if (jsonBytes(value) > MAX_VALUE_BYTES) return;
  await sharedCache.setJSON(key, value, COMPUTED_TTL_SECONDS);
}

export async function readTennisRosterCache(): Promise<TennisRosterCache | null> {
  const fromRedis = await sharedCache.getJSON<TennisRosterCache>(TENNIS_ROSTER_CACHE_KEY);
  if (fromRedis?.players?.length) return fromRedis;
  return null;
}

export async function writeTennisRosterCache(roster: TennisRosterCache): Promise<void> {
  if (jsonBytes(roster) > MAX_VALUE_BYTES) return;
  await sharedCache.setJSON(TENNIS_ROSTER_CACHE_KEY, roster, LOGS_TTL_SECONDS);
}

export async function readTennisPlayerLogsCache(playerId: string): Promise<TennisPlayerLogsCache | null> {
  const id = String(playerId || '').trim();
  if (!id) return null;
  const cached = await sharedCache.getJSON<TennisPlayerLogsCache>(playerLogsKey(id));
  if (cached?.games && Array.isArray(cached.games)) return cached;
  return null;
}

export async function writeTennisPlayerLogsCache(payload: TennisPlayerLogsCache): Promise<void> {
  const id = String(payload.playerId || '').trim();
  if (!id || !payload.games?.length) return;
  const next = { ...payload, games: capGames(payload.games) };
  if (jsonBytes(next) > MAX_VALUE_BYTES) return;
  await sharedCache.setJSON(playerLogsKey(id), next, LOGS_TTL_SECONDS);
}

type OverlayLike = {
  fetchedAt?: string;
  matches?: TennisMatchRow[];
  players?: TennisPlayer[];
  standings?: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
};

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

function pickRosterPlayers(overlay: OverlayLike, extraIds: Set<string>): TennisPlayer[] {
  const ranked = new Set<string>(extraIds);
  for (const row of overlay.standings?.ATP || []) ranked.add(row.playerId);
  for (const row of overlay.standings?.WTA || []) ranked.add(row.playerId);
  const picked = (overlay.players || [])
    .filter((player) => player?.playerId && ranked.has(player.playerId))
    .map(slimPlayer)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name));
  return picked.slice(0, MAX_ROSTER_PLAYERS);
}

export async function publishTennisDashboardCache(
  overlay: OverlayLike | null
): Promise<{ players: number; logs: number; skipped: boolean }> {
  if (!overlay?.matches?.length && !overlay?.players?.length) {
    return { players: 0, logs: 0, skipped: true };
  }
  const fetchedAt = overlay.fetchedAt || new Date().toISOString();
  const mark = await sharedCache.getJSON<{ fetchedAt?: string }>(TENNIS_SHARDS_MARK_KEY);
  if (mark?.fetchedAt && mark.fetchedAt === fetchedAt) {
    return { players: 0, logs: 0, skipped: true };
  }

  const priorityIds = new Set<string>();
  try {
    const { TENNIS_LIST_CACHE_KEY } = await import('@/lib/tennis/playerPropsList');
    const list = await sharedCache.getJSON<{ data?: Array<{ playerId?: string | null }> }>(
      TENNIS_LIST_CACHE_KEY
    );
    for (const row of list?.data || []) {
      const id = String(row.playerId || '').trim();
      if (id) priorityIds.add(id);
    }
  } catch {
    /* props list optional */
  }

  const rosterPlayers = pickRosterPlayers(overlay, priorityIds);
  if (rosterPlayers.length) {
    await writeTennisRosterCache({
      fetchedAt,
      players: rosterPlayers,
      standings: {
        ATP: (overlay.standings?.ATP || []).slice(0, 400),
        WTA: (overlay.standings?.WTA || []).slice(0, 400),
      },
    });
  }

  const byId = new Map<string, TennisMatchRow[]>();
  const wanted = priorityIds.size ? priorityIds : new Set(rosterPlayers.slice(0, 80).map((p) => p.playerId));
  for (const row of overlay.matches || []) {
    const id = String(row?.playerId || '').trim();
    if (!id || !wanted.has(id)) continue;
    const list = byId.get(id);
    if (list) list.push(row);
    else byId.set(id, [row]);
  }
  const entries = [...byId.entries()].slice(0, MAX_LOG_PLAYERS);
  await mapPool(entries, PUBLISH_CONCURRENCY, async ([playerId, games]) => {
    await writeTennisPlayerLogsCache({
      fetchedAt,
      playerId,
      playerName: games[0]?.playerName || playerId,
      tour: games[0]?.tour || null,
      games,
    });
  });
  await sharedCache.setJSON(
    TENNIS_SHARDS_MARK_KEY,
    { fetchedAt, logs: entries.length, players: rosterPlayers.length },
    MARK_TTL_SECONDS
  );
  return { players: rosterPlayers.length, logs: entries.length, skipped: false };
}
