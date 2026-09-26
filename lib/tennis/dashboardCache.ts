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

const LOGS_TTL_SECONDS = 60 * 60 * 24 * 90;
const COMPUTED_TTL_SECONDS = 6 * 60 * 60;
const MARK_TTL_SECONDS = 60 * 60 * 24 * 40;
const MAX_ROSTER_PLAYERS = 2000;
/** Three seasons of a full schedule. The byte cap below still shrinks a shard that will not fit. */
const MAX_GAMES_PER_PLAYER = 400;
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
  /** Disk history was already merged, so a later read does not scan the compiled cache again. */
  historyBackfilled?: boolean;
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

const LOG_MEM_TTL_MS = 60_000;
const logMem = new Map<string, { at: number; payload: TennisPlayerLogsCache }>();

function rememberPlayerLogs(payload: TennisPlayerLogsCache | null | undefined) {
  const id = String(payload?.playerId || '').trim();
  if (!id || !payload?.games?.length) return;
  logMem.set(id, { at: Date.now(), payload });
}

function memoryPlayerLogs(playerId: string): TennisPlayerLogsCache | null {
  const hit = logMem.get(playerId);
  if (!hit || Date.now() - hit.at > LOG_MEM_TTL_MS) return null;
  return hit.payload;
}

export async function readTennisPlayerLogsCache(playerId: string): Promise<TennisPlayerLogsCache | null> {
  const id = String(playerId || '').trim();
  if (!id) return null;
  const fromMem = memoryPlayerLogs(id);
  if (fromMem) return fromMem;
  const cached = await sharedCache.getJSON<TennisPlayerLogsCache>(playerLogsKey(id));
  if (cached?.games && Array.isArray(cached.games)) {
    rememberPlayerLogs({ ...cached, playerId: id });
    return cached;
  }
  return null;
}

export async function readTennisPlayerLogsCacheMany(
  playerIds: string[]
): Promise<Map<string, TennisMatchRow[]>> {
  const ids = [...new Set(playerIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const out = new Map<string, TennisMatchRow[]>();
  if (!ids.length) return out;
  const missing: string[] = [];
  for (const id of ids) {
    const fromMem = memoryPlayerLogs(id);
    if (fromMem?.games?.length) out.set(id, fromMem.games);
    else missing.push(id);
  }
  if (!missing.length) return out;
  const rows = await sharedCache.getJSONMany<TennisPlayerLogsCache>(missing.map(playerLogsKey));
  missing.forEach((id, i) => {
    const games = rows[i]?.games;
    if (!games?.length) return;
    rememberPlayerLogs({
      fetchedAt: rows[i]?.fetchedAt || new Date().toISOString(),
      playerId: id,
      playerName: rows[i]?.playerName || id,
      tour: rows[i]?.tour || null,
      games,
      historyBackfilled: rows[i]?.historyBackfilled,
    });
    out.set(id, games);
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

export async function writeTennisPlayerLogsCache(
  payload: TennisPlayerLogsCache
): Promise<TennisPlayerLogsCache | null> {
  const next = fitPlayerLogsPayload(payload);
  if (!next) return null;
  rememberPlayerLogs(next);
  await sharedCache.setJSON(playerLogsKey(next.playerId), next, LOGS_TTL_SECONDS);
  return next;
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

function matchStatCount(row: TennisMatchRow | undefined): number {
  if (!row) return 0;
  let n = 0;
  for (const value of Object.values(row)) {
    if (value != null && value !== '') n += 1;
  }
  return n;
}

function mergePlayerGames(existing: TennisMatchRow[], incoming: TennisMatchRow[]): {
  games: TennisMatchRow[];
  added: number;
  updated: number;
} {
  const byId = new Map<string, TennisMatchRow>();
  for (const row of existing) {
    if (row?.matchId) byId.set(row.matchId, row);
  }
  let added = 0;
  let updated = 0;
  for (const row of incoming) {
    if (!row?.matchId) continue;
    const prev = byId.get(row.matchId);
    if (!prev) {
      byId.set(row.matchId, row);
      added += 1;
      continue;
    }
    if (matchStatCount(row) > matchStatCount(prev)) {
      byId.set(row.matchId, row);
      updated += 1;
    }
  }
  return { games: capGames([...byId.values()]), added, updated };
}

function mergeRosterPlayers(primary: TennisPlayer[], extra: TennisPlayer[]): TennisPlayer[] {
  const byId = new Map<string, TennisPlayer>();
  for (const player of primary) {
    const id = String(player?.playerId || '').trim();
    if (id) byId.set(id, slimPlayer(player));
  }
  for (const player of extra) {
    const id = String(player?.playerId || '').trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, slimPlayer(prev ? { ...prev, ...player, imageUrl: player.imageUrl || prev.imageUrl } : player));
  }
  return [...byId.values()];
}

/**
 * Append newly finished matches onto existing Redis player logs.
 * Players with no new games are left untouched.
 */
export async function mergeTennisPlayerLogsIncremental(
  overlay: OverlayLike | null,
  opts?: { onlyPriority?: boolean }
): Promise<{ players: number; logs: number; added: number; updated: number; skipped: boolean }> {
  if (!overlay?.matches?.length && !overlay?.players?.length) {
    return { players: 0, logs: 0, added: 0, updated: 0, skipped: true };
  }
  const fetchedAt = overlay.fetchedAt || new Date().toISOString();
  const priorityIds = await collectPriorityPlayerIds();
  const incomingById = groupOverlayGames(overlay);
  const onlyPriority = opts?.onlyPriority === true;
  const playerIds = [...incomingById.keys()].filter((id) => !onlyPriority || priorityIds.has(id));
  const existingLogs = await readTennisPlayerLogsCacheMany(playerIds);

  let added = 0;
  let updated = 0;
  const payloads: TennisPlayerLogsCache[] = [];
  for (const playerId of playerIds) {
    const incoming = incomingById.get(playerId) || [];
    const prevGames = existingLogs.get(playerId) || [];
    const merged = mergePlayerGames(prevGames, incoming);
    added += merged.added;
    updated += merged.updated;
    if (merged.added > 0 || merged.updated > 0 || !existingLogs.has(playerId)) {
      payloads.push({
        fetchedAt,
        playerId,
        playerName: incoming[0]?.playerName || prevGames[0]?.playerName || playerId,
        tour: incoming[0]?.tour || prevGames[0]?.tour || null,
        games: merged.games,
        historyBackfilled: memoryPlayerLogs(playerId)?.historyBackfilled,
      });
    }
  }
  const logs = payloads.length ? await writeTennisPlayerLogsCacheMany(payloads) : 0;

  const existingRoster = await readTennisRosterCache();
  const rosterOverlay: OverlayLike = {
    fetchedAt,
    matches: overlay.matches,
    players: mergeRosterPlayers(existingRoster?.players || [], overlay.players || []),
    standings: {
      ATP: overlay.standings?.ATP?.length ? overlay.standings.ATP : existingRoster?.standings?.ATP || [],
      WTA: overlay.standings?.WTA?.length ? overlay.standings.WTA : existingRoster?.standings?.WTA || [],
    },
  };
  const rosterPlayers = pickRosterPlayers(rosterOverlay, priorityIds, incomingById);
  if (rosterPlayers.length) {
    await writeTennisRosterCache({
      fetchedAt,
      players: rosterPlayers,
      standings: {
        ATP: (rosterOverlay.standings?.ATP || []).slice(0, 500),
        WTA: (rosterOverlay.standings?.WTA || []).slice(0, 500),
      },
    });
  }

  if (!onlyPriority) {
    await sharedCache.setJSON(
      TENNIS_SHARDS_MARK_KEY,
      { fetchedAt, logs, players: rosterPlayers.length, added, updated },
      MARK_TTL_SECONDS
    );
  }
  return { players: rosterPlayers.length, logs, added, updated, skipped: false };
}

export async function tennisLogsLookHealthy(): Promise<boolean> {
  const roster = await readTennisRosterCache();
  if (!roster?.players?.length) return false;
  const sample = roster.players.slice(0, 24).map((player) => player.playerId);
  const logs = await readTennisPlayerLogsCacheMany(sample);
  let withGames = 0;
  for (const games of logs.values()) {
    if ((games?.length || 0) >= 5) withGames += 1;
  }
  return withGames >= 5;
}

export async function publishTennisDashboardCache(
  overlay: OverlayLike | null,
  opts?: { onlyPriority?: boolean }
): Promise<{ players: number; logs: number; skipped: boolean }> {
  const result = await mergeTennisPlayerLogsIncremental(overlay, opts);
  return { players: result.players, logs: result.logs, skipped: result.skipped };
}
