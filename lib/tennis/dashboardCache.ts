/**
 * Tennis dashboard cache — AFL-style small Redis keys, written by cron.
 * Never stores the 13MB overlay in Redis or on disk.
 */

import sharedCache, { decodeSharedCacheRaw, type SharedCacheCasEntry } from '@/lib/sharedCache';
import { tennisIocFromStoredOrRoster } from '@/lib/tennis/resolveIoc';
import type { TennisMatchRow, TennisPlayer, TennisRankingRow, TennisTour } from '@/lib/tennis/types';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';

export const TENNIS_ROSTER_CACHE_KEY = 'tennis_dashboard_roster_v1';
export const TENNIS_ROSTER_CACHE_TYPE = 'tennis_roster';
const TENNIS_PLAYER_LOGS_PREFIX = 'tennis_player_logs_v1:';
const TENNIS_COMPUTED_PREFIX = 'tennis_dash_computed_v2:';
const TENNIS_SHARDS_MARK_KEY = 'tennis_dashboard_shards_mark_v2';

const LOGS_TTL_SECONDS = 60 * 60 * 24 * 90;
/** Player history outlives long injury layoffs; every successful write refreshes it. */
const PLAYER_LOGS_TTL_SECONDS = 60 * 60 * 24 * 730;
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

function withRosterCountry<T extends { playerId?: string | null; name?: string | null; ioc?: string | null }>(
  row: T
): T {
  const ioc = tennisIocFromStoredOrRoster({ playerId: row.playerId, name: row.name, stored: row.ioc });
  const stored = row.ioc ?? null;
  return ioc === stored ? row : { ...row, ioc };
}

function withLogCountry(row: TennisMatchRow): TennisMatchRow {
  const ioc = tennisIocFromStoredOrRoster({
    playerId: row.playerId,
    name: row.playerName,
    stored: row.ioc,
  });
  const opponentIoc = tennisIocFromStoredOrRoster({
    playerId: row.opponentId,
    name: row.opponent,
    stored: row.opponentIoc,
  });
  const storedIoc = row.ioc ?? null;
  const storedOpponentIoc = row.opponentIoc ?? null;
  if (ioc === storedIoc && opponentIoc === storedOpponentIoc) return row;
  return { ...row, ioc, opponentIoc };
}

function withLogPayload(payload: TennisPlayerLogsCache, playerId: string): TennisPlayerLogsCache {
  return {
    ...payload,
    playerId,
    games: payload.games.map(withLogCountry),
  };
}

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
  if (fromRedis?.players?.length) {
    return {
      ...fromRedis,
      players: fromRedis.players.map(withRosterCountry),
      standings: {
        ATP: (fromRedis.standings?.ATP || []).map(withRosterCountry),
        WTA: (fromRedis.standings?.WTA || []).map(withRosterCountry),
      },
    };
  }
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
    const payload = withLogPayload({ ...cached, playerId: id }, id);
    rememberPlayerLogs(payload);
    return payload;
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
    const payload = withLogPayload(
      {
        fetchedAt: rows[i]?.fetchedAt || new Date().toISOString(),
        playerId: id,
        playerName: rows[i]?.playerName || id,
        tour: rows[i]?.tour || null,
        games,
        historyBackfilled: rows[i]?.historyBackfilled,
      },
      id
    );
    rememberPlayerLogs(payload);
    out.set(id, payload.games);
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

export type TennisPlayerLogsStore = {
  /** Raw stored strings (null = absent). Must throw when the store cannot be read. */
  readRaw(keys: string[]): Promise<Array<string | null>>;
  /** Per-entry compare-and-set against expectedRaw. Must throw when the store cannot be written. */
  casWrite(entries: SharedCacheCasEntry[]): Promise<boolean[]>;
};

const sharedLogsStore: TennisPlayerLogsStore = {
  readRaw: (keys) => sharedCache.getRawManyStrict(keys),
  casWrite: (entries) => sharedCache.casSetMany(entries),
};

const UPSERT_CHUNK = 20;
const UPSERT_ATTEMPTS = 4;

export type TennisPlayerLogsUpsertResult = {
  written: number;
  added: number;
  updated: number;
  unchanged: number;
  /** Stored value undecodable, or the merge would have dropped stored games. Left untouched. */
  refused: number;
  /** Key kept changing under concurrent writers. Left untouched; the next run retries. */
  conflicts: number;
};

function decodeStoredPlayerLogs(raw: string | null): TennisPlayerLogsCache | null | undefined {
  const value = decodeSharedCacheRaw<TennisPlayerLogsCache>(raw);
  if (value === null) return null;
  if (value === undefined || typeof value !== 'object' || !Array.isArray(value.games)) return undefined;
  return value;
}

function storedGameKey(row: TennisMatchRow): string {
  return row?.matchId ? `id:${row.matchId}` : `row:${JSON.stringify(row)}`;
}

/** True when next keeps every stored game, or only lost the oldest ones to the per-player cap. */
export function tennisLogsKeepStoredGames(stored: TennisMatchRow[], next: TennisMatchRow[]): boolean {
  if (next.length < stored.length) return false;
  if (next.length >= MAX_GAMES_PER_PLAYER) return true;
  const kept = new Set(next.map(storedGameKey));
  return stored.every((row) => kept.has(storedGameKey(row)));
}

function combineIncomingPayloads(payloads: TennisPlayerLogsCache[]): Map<string, TennisPlayerLogsCache> {
  const byId = new Map<string, TennisPlayerLogsCache>();
  for (const payload of payloads) {
    const id = String(payload?.playerId || '').trim();
    if (!id || !Array.isArray(payload?.games) || !payload.games.length) continue;
    const prev = byId.get(id);
    byId.set(
      id,
      prev
        ? {
            ...prev,
            ...payload,
            playerId: id,
            games: mergePlayerGames(prev.games, payload.games).games,
            historyBackfilled: Boolean(prev.historyBackfilled || payload.historyBackfilled) || undefined,
          }
        : { ...payload, playerId: id }
    );
  }
  return byId;
}

/**
 * The only path that writes tennis player logs to Redis.
 * - Reads the stored log strictly: if Redis cannot be read this throws and nothing is written.
 * - Merges incoming games on top of stored games by matchId (stored games are never dropped).
 * - Refuses any write that would hold fewer or different stored games, or overwrite an undecodable value.
 * - Writes with compare-and-set, so a concurrent writer is re-read and re-merged instead of clobbered.
 */
export async function upsertTennisPlayerLogs(
  payloads: TennisPlayerLogsCache[],
  store: TennisPlayerLogsStore = sharedLogsStore
): Promise<TennisPlayerLogsUpsertResult> {
  const result: TennisPlayerLogsUpsertResult = {
    written: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    refused: 0,
    conflicts: 0,
  };
  const incomingById = combineIncomingPayloads(payloads);
  const ids = [...incomingById.keys()];
  for (let i = 0; i < ids.length; i += UPSERT_CHUNK) {
    let pending = ids.slice(i, i + UPSERT_CHUNK);
    for (let attempt = 0; attempt < UPSERT_ATTEMPTS && pending.length; attempt += 1) {
      const raws = await store.readRaw(pending.map(playerLogsKey));
      if (!Array.isArray(raws) || raws.length !== pending.length) {
        throw new Error('[tennis logs] store returned a malformed read; refusing to write');
      }
      const entries: SharedCacheCasEntry[] = [];
      const plans: Array<{ id: string; next: TennisPlayerLogsCache; added: number; updated: number }> = [];
      pending.forEach((id, j) => {
        const incoming = incomingById.get(id)!;
        const stored = decodeStoredPlayerLogs(raws[j]);
        if (stored === undefined) {
          result.refused += 1;
          console.warn(`[tennis logs] ${id}: stored log is undecodable; left untouched`);
          return;
        }
        const storedGames = stored?.games || [];
        const merged = mergePlayerGames(storedGames, incoming.games);
        if (stored && merged.added === 0 && merged.updated === 0) {
          result.unchanged += 1;
          return;
        }
        const incomingName = String(incoming.playerName || '').trim();
        const next = fitPlayerLogsPayload({
          fetchedAt: incoming.fetchedAt || new Date().toISOString(),
          playerId: id,
          playerName: incomingName && incomingName !== id ? incomingName : stored?.playerName || incomingName || id,
          tour: incoming.tour || stored?.tour || null,
          games: merged.games,
          historyBackfilled: Boolean(stored?.historyBackfilled || incoming.historyBackfilled) || undefined,
        });
        if (!next || !tennisLogsKeepStoredGames(storedGames, next.games)) {
          result.refused += 1;
          console.warn(
            `[tennis logs] ${id}: write would drop stored games (${storedGames.length} -> ${next?.games.length ?? 0}); left untouched`
          );
          return;
        }
        entries.push({
          key: playerLogsKey(id),
          expectedRaw: raws[j],
          value: next,
          ttlSeconds: PLAYER_LOGS_TTL_SECONDS,
        });
        plans.push({ id, next, added: merged.added, updated: merged.updated });
      });
      const applied = entries.length ? await store.casWrite(entries) : [];
      if (!Array.isArray(applied) || applied.length !== entries.length) {
        throw new Error('[tennis logs] store returned a malformed write result');
      }
      const retry: string[] = [];
      plans.forEach((plan, j) => {
        if (applied[j] === true) {
          result.written += 1;
          result.added += plan.added;
          result.updated += plan.updated;
          rememberPlayerLogs(withLogPayload(plan.next, plan.id));
        } else {
          retry.push(plan.id);
        }
      });
      pending = retry;
    }
    if (pending.length) {
      result.conflicts += pending.length;
      console.warn(`[tennis logs] ${pending.length} logs kept changing during write; left for the next run`);
    }
  }
  return result;
}

/** Roster read for a write path: throws if Redis cannot be read, so a failed read never shrinks the roster. */
async function readTennisRosterCacheStrict(): Promise<TennisRosterCache | null> {
  const [raw] = await sharedCache.getRawManyStrict([TENNIS_ROSTER_CACHE_KEY]);
  const value = decodeSharedCacheRaw<TennisRosterCache>(raw);
  return value && Array.isArray(value.players) && value.players.length ? value : null;
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
    const id = validRosterId(player?.playerId);
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
    if (row) byId.set(storedGameKey(row), row);
  }
  let added = 0;
  let updated = 0;
  for (const row of incoming) {
    if (!row?.matchId) continue;
    const key = storedGameKey(row);
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, row);
      added += 1;
      continue;
    }
    if (matchStatCount(row) > matchStatCount(prev)) {
      byId.set(key, row);
      updated += 1;
    }
  }
  return { games: capGames([...byId.values()]), added, updated };
}

function validRosterId(value: string | null | undefined): string {
  const id = String(value || '').trim();
  return id && id !== 'undefined' && id !== 'null' ? id : '';
}

const MIN_STANDINGS_ROWS = 50;

function cleanStandings(rows: TennisRankingRow[] | null | undefined): TennisRankingRow[] {
  return (rows || []).filter(
    (row) => validRosterId(row?.playerId) && String(row?.name || '').trim() && Number(row?.pos) > 0
  );
}

/** A short or malformed standings list (an API error payload) must not replace a real one. */
export function pickStandings(
  incoming: TennisRankingRow[] | null | undefined,
  existing: TennisRankingRow[] | null | undefined
): TennisRankingRow[] {
  const next = cleanStandings(incoming);
  if (next.length >= MIN_STANDINGS_ROWS) return next;
  const prev = cleanStandings(existing);
  return prev.length >= next.length ? prev : next;
}

function mergeRosterPlayers(primary: TennisPlayer[], extra: TennisPlayer[]): TennisPlayer[] {
  const byId = new Map<string, TennisPlayer>();
  for (const player of primary) {
    const id = validRosterId(player?.playerId);
    if (id) byId.set(id, slimPlayer(player));
  }
  for (const player of extra) {
    const id = validRosterId(player?.playerId);
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
  const upserted = await upsertTennisPlayerLogs(
    playerIds.map((playerId) => {
      const incoming = incomingById.get(playerId) || [];
      return {
        fetchedAt,
        playerId,
        playerName: incoming[0]?.playerName || playerId,
        tour: incoming[0]?.tour || null,
        games: incoming,
      };
    })
  );
  const { added, updated } = upserted;
  const logs = upserted.written;

  const existingRoster = await readTennisRosterCacheStrict();
  const rosterOverlay: OverlayLike = {
    fetchedAt,
    matches: overlay.matches,
    players: mergeRosterPlayers(existingRoster?.players || [], overlay.players || []),
    standings: {
      ATP: pickStandings(overlay.standings?.ATP, existingRoster?.standings?.ATP),
      WTA: pickStandings(overlay.standings?.WTA, existingRoster?.standings?.WTA),
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
