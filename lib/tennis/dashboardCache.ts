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
const TENNIS_SHARDS_MARK_KEY = 'tennis_dashboard_shards_mark_v2';

const LOGS_TTL_SECONDS = 60 * 60 * 24 * 30;
const COMPUTED_TTL_SECONDS = 6 * 60 * 60;
const MARK_TTL_SECONDS = 60 * 60 * 24 * 40;
const MAX_ROSTER_PLAYERS = 2000;
const MAX_GAMES_PER_PLAYER = 80;
const MAX_VALUE_BYTES = 2 * 1024 * 1024;

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

export async function readTennisPlayerLogsCacheMany(
  playerIds: string[]
): Promise<Map<string, TennisMatchRow[]>> {
  const ids = [...new Set(playerIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const out = new Map<string, TennisMatchRow[]>();
  if (!ids.length) return out;
  const rows = await sharedCache.getJSONMany<TennisPlayerLogsCache>(ids.map(playerLogsKey));
  ids.forEach((id, i) => {
    const games = rows[i]?.games;
    if (games?.length) out.set(id, games);
  });
  return out;
}

export function tennisSimilarComputedKey(opts: {
  playerId?: string | null;
  playerName?: string | null;
  opponentId?: string | null;
  opponentName?: string | null;
  tour?: string | null;
}): string {
  return tennisComputedCacheKey('similar', [
    opts.playerId || opts.playerName,
    opts.opponentId || opts.opponentName,
    opts.tour,
  ]);
}

function fitPlayerLogsPayload(payload: TennisPlayerLogsCache): TennisPlayerLogsCache | null {
  const id = String(payload.playerId || '').trim();
  if (!id || !payload.games?.length) return null;
  let games = capGames(payload.games);
  let next: TennisPlayerLogsCache = { ...payload, playerId: id, games };
  while (jsonBytes(next) > MAX_VALUE_BYTES && games.length > 1) {
    const drop = Math.max(1, Math.ceil(games.length * 0.1));
    games = games.slice(drop);
    next = { ...payload, playerId: id, games };
  }
  if (!next.games.length || jsonBytes(next) > MAX_VALUE_BYTES) return null;
  return next;
}

export async function writeTennisPlayerLogsCache(payload: TennisPlayerLogsCache): Promise<void> {
  const next = fitPlayerLogsPayload(payload);
  if (!next) return;
  await sharedCache.setJSON(playerLogsKey(next.playerId), next, LOGS_TTL_SECONDS);
}

async function writeTennisPlayerLogsCacheMany(payloads: TennisPlayerLogsCache[]): Promise<number> {
  const entries = payloads
    .map((payload) => fitPlayerLogsPayload(payload))
    .filter((payload): payload is TennisPlayerLogsCache => Boolean(payload))
    .map((payload) => ({
      key: playerLogsKey(payload.playerId),
      value: payload,
      ttlSeconds: LOGS_TTL_SECONDS,
    }));
  if (!entries.length) return 0;
  await sharedCache.setJSONMany(entries);
  return entries.length;
}

type OverlayLike = {
  fetchedAt?: string;
  matches?: TennisMatchRow[];
  players?: TennisPlayer[];
  standings?: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
};

function addPlayerId(ids: Set<string>, value: string | null | undefined) {
  const id = String(value || '').trim();
  if (id) ids.add(id);
}

async function collectPriorityPlayerIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const { TENNIS_LIST_CACHE_KEY } = await import('@/lib/tennis/playerPropsList');
    const list = await sharedCache.getJSON<{
      data?: Array<{ playerId?: string | null; opponentId?: string | null }>;
    }>(TENNIS_LIST_CACHE_KEY);
    for (const row of list?.data || []) {
      addPlayerId(ids, row.playerId);
      addPlayerId(ids, row.opponentId);
    }
  } catch {
    /* props list optional */
  }
  try {
    const { listLiveTennisEventIndex } = await import('@/lib/tennis/nextGame');
    const live = await listLiveTennisEventIndex();
    for (const event of live.events || []) {
      for (const id of event.playerIds || []) addPlayerId(ids, id);
      for (const id of event.qualifyingPlayerIds || []) addPlayerId(ids, id);
    }
  } catch {
    /* live fixtures optional */
  }
  return ids;
}

function pickRosterPlayers(
  overlay: OverlayLike,
  extraIds: Set<string>,
  gamesById: Map<string, TennisMatchRow[]>
): TennisPlayer[] {
  const byId = new Map<string, TennisPlayer>();
  for (const player of overlay.players || []) {
    const id = String(player?.playerId || '').trim();
    if (id) byId.set(id, slimPlayer(player));
  }
  const out: TennisPlayer[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    const player = byId.get(id);
    if (!player || seen.has(id)) return;
    seen.add(id);
    out.push(player);
  };
  for (const id of extraIds) {
    if (!byId.has(id)) {
      const row = gamesById.get(id)?.[0];
      if (row) {
        byId.set(
          id,
          slimPlayer({
            playerId: id,
            name: row.playerName || id,
            tour: row.tour,
            ioc: row.ioc ?? null,
            hand: row.hand ?? null,
            height: row.height ?? null,
            rank: row.playerRank ?? null,
            rankPoints: row.rankPoints ?? null,
            imageUrl: null,
          })
        );
      }
    }
    push(id);
  }
  const ranked = [...(overlay.standings?.ATP || []), ...(overlay.standings?.WTA || [])]
    .slice()
    .sort((a, b) => (a.pos || 9999) - (b.pos || 9999));
  for (const row of ranked) {
    if (out.length >= MAX_ROSTER_PLAYERS) break;
    push(row.playerId);
  }
  if (out.length < MAX_ROSTER_PLAYERS) {
    const rest = [...byId.values()].sort(
      (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name)
    );
    for (const player of rest) {
      if (out.length >= MAX_ROSTER_PLAYERS) break;
      push(player.playerId);
    }
  }
  return out;
}

function groupOverlayGames(overlay: OverlayLike): Map<string, TennisMatchRow[]> {
  const byId = new Map<string, TennisMatchRow[]>();
  for (const row of overlay.matches || []) {
    const id = String(row?.playerId || '').trim();
    if (!id) continue;
    const list = byId.get(id);
    if (list) list.push(row);
    else byId.set(id, [row]);
  }
  return byId;
}

export async function publishTennisDashboardCache(
  overlay: OverlayLike | null,
  opts?: { onlyPriority?: boolean }
): Promise<{ players: number; logs: number; skipped: boolean }> {
  if (!overlay?.matches?.length && !overlay?.players?.length) {
    return { players: 0, logs: 0, skipped: true };
  }
  const fetchedAt = overlay.fetchedAt || new Date().toISOString();
  const priorityIds = await collectPriorityPlayerIds();
  const byId = groupOverlayGames(overlay);
  const onlyPriority = opts?.onlyPriority === true;
  const entries = [...byId.entries()]
    .filter(([playerId]) => !onlyPriority || priorityIds.has(playerId))
    .sort(([a], [b]) => {
      const aPri = priorityIds.has(a) ? 0 : 1;
      const bPri = priorityIds.has(b) ? 0 : 1;
      return aPri - bPri || a.localeCompare(b);
    });

  if (!onlyPriority) {
    const mark = await sharedCache.getJSON<{ fetchedAt?: string; logs?: number }>(TENNIS_SHARDS_MARK_KEY);
    if (mark?.fetchedAt === fetchedAt && (mark.logs || 0) >= entries.length) {
      return { players: 0, logs: 0, skipped: true };
    }
  }

  const rosterPlayers = pickRosterPlayers(overlay, priorityIds, byId);
  if (rosterPlayers.length) {
    await writeTennisRosterCache({
      fetchedAt,
      players: rosterPlayers,
      standings: {
        ATP: (overlay.standings?.ATP || []).slice(0, 500),
        WTA: (overlay.standings?.WTA || []).slice(0, 500),
      },
    });
  }

  const logs = await writeTennisPlayerLogsCacheMany(
    entries.map(([playerId, games]) => ({
      fetchedAt,
      playerId,
      playerName: games[0]?.playerName || playerId,
      tour: games[0]?.tour || null,
      games,
    }))
  );

  if (!onlyPriority) {
    await sharedCache.setJSON(
      TENNIS_SHARDS_MARK_KEY,
      { fetchedAt, logs, players: rosterPlayers.length },
      MARK_TTL_SECONDS
    );
  }
  return { players: rosterPlayers.length, logs, skipped: false };
}
