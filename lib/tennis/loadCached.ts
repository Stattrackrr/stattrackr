/**
 * Dashboard loaders that prefer AFL-style Redis shards, then process overlay.
 */

import {
  readTennisPlayerLogsCache,
  readTennisRosterCache,
  upsertTennisPlayerLogs,
} from '@/lib/tennis/dashboardCache';
import {
  loadPlayerMatches,
  loadTennisRankings,
  type TennisMatchRow,
  type TennisPlayer,
  type TennisRankingRow,
  type TennisTour,
} from '@/lib/tennis/data';
import { getHydratedTennisOverlay } from '@/lib/tennis/ingest';
import { loadApiTennisRoster, readApiTennisPlayerMatches, listApiTennisPlayerIds } from '@/lib/tennis/apiTennis';
import { TENNIS_HISTORY_YEARS } from '@/lib/tennis/constants';
import { tennisIocFromStoredOrRoster } from '@/lib/tennis/resolveIoc';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import { mergeCareerH2h } from '@/lib/tennis/h2hHistory';

type TennisRosterStandings = {
  ATP?: TennisRankingRow[];
  WTA?: TennisRankingRow[];
};

function matchYear(row: TennisMatchRow): number {
  const season = Number(row.season);
  if (Number.isFinite(season) && season > 1900) return season;
  const fromDate = Number(String(row.date || '').slice(0, 4));
  return Number.isFinite(fromDate) ? fromDate : 0;
}

/** Redis shards are often seeded from the live ingest window, so they can be a full recent season and still omit 2024–2025. */
function coversHistoryYears(games: TennisMatchRow[]): boolean {
  const years = new Set(games.map(matchYear).filter((year) => year > 0));
  return TENNIS_HISTORY_YEARS.every((year) => years.has(year));
}

/** A short or current-season-only log still needs the compiled history, for every player. */
export function tennisLogsNeedHistory(games: readonly TennisMatchRow[] | null | undefined): boolean {
  if (!games?.length || games.length < 12) return true;
  return !coversHistoryYears(games as TennisMatchRow[]);
}

function mergeMatchRows(primary: TennisMatchRow[], overlay: TennisMatchRow[]): TennisMatchRow[] {
  const byId = new Map<string, TennisMatchRow>();
  const extras: TennisMatchRow[] = [];
  const take = (row: TennisMatchRow | null | undefined) => {
    if (!row) return;
    const id = String(row.matchId || '').trim();
    if (!id) {
      extras.push(row);
      return;
    }
    byId.set(id, row);
  };
  for (const row of primary) take(row);
  for (const row of overlay) take(row);
  return [...byId.values(), ...extras].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function withPlayerCountry<T extends { playerId?: string | null; name?: string | null; ioc?: string | null }>(
  row: T
): T {
  const ioc = tennisIocFromStoredOrRoster({ playerId: row.playerId, name: row.name, stored: row.ioc });
  return ioc === row.ioc ? row : { ...row, ioc };
}

function withMatchCountry(row: TennisMatchRow): TennisMatchRow {
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
  if (ioc === row.ioc && opponentIoc === row.opponentIoc) return row;
  return { ...row, ioc, opponentIoc };
}

export function fillTennisPlayerRanks(
  players: TennisPlayer[],
  standings?: TennisRosterStandings
): TennisPlayer[] {
  if (!players.length) return players;
  const posById = new Map<string, number>();
  for (const row of [...(standings?.ATP || []), ...(standings?.WTA || [])]) {
    const id = String(row.playerId || '').trim();
    const pos = Number(row.pos);
    if (id && Number.isFinite(pos) && pos > 0) posById.set(id, pos);
  }
  let missing = 0;
  const fromStandings = players.map((player) => {
    if (player.rank != null && Number(player.rank) > 0) return player;
    const pos = posById.get(player.playerId);
    if (pos) return { ...player, rank: pos };
    missing += 1;
    return player;
  });
  if (!missing) return fromStandings;
  const disk = loadApiTennisRoster({ allowCacheJson: false })?.players || [];
  if (!disk.length) return fromStandings;
  const byId = new Map(disk.map((player) => [player.playerId, player]));
  return fromStandings.map((player) => {
    if (player.rank != null && Number(player.rank) > 0) return player;
    const hit = byId.get(player.playerId);
    if (!hit) return player;
    return {
      ...player,
      name: hit.name || player.name,
      rank: hit.rank ?? player.rank,
      rankPoints: player.rankPoints ?? hit.rankPoints,
      ioc: player.ioc || hit.ioc,
    };
  });
}

function filterCurrent(players: TennisPlayer[], standings: TennisRosterStandings | undefined): TennisPlayer[] {
  const ranked = new Set<string>();
  for (const row of standings?.ATP || []) ranked.add(row.playerId);
  for (const row of standings?.WTA || []) ranked.add(row.playerId);
  if (!ranked.size) return players;
  return players.filter((player) => ranked.has(player.playerId));
}

export function takeCurrentTennisRoster(
  players: TennisPlayer[],
  standings?: TennisRosterStandings
): TennisPlayer[] {
  const standingCount = (standings?.ATP?.length || 0) + (standings?.WTA?.length || 0);
  if (standingCount >= 50) {
    const current = filterCurrent(players, standings);
    if (current.length >= 50) return current;
  }
  const ranked = players.filter((player) => player.rank != null && Number(player.rank) > 0);
  return ranked.length ? ranked : players;
}

function usableTennisRoster(players: TennisPlayer[]): TennisPlayer[] {
  return players.filter((player) => {
    const id = String(player.playerId || '').trim();
    const name = String(player.name || '').trim();
    return id && id !== 'undefined' && name && name !== 'undefined';
  });
}

export async function loadTennisPlayersCached(opts?: {
  currentOnly?: boolean;
}): Promise<TennisPlayer[]> {
  const roster = await readTennisRosterCache();
  const redisPlayers = usableTennisRoster(roster?.players || []);
  if (redisPlayers.length >= 50) {
    const players = fillTennisPlayerRanks(redisPlayers.map(withPlayerCountry), roster?.standings);
    return opts?.currentOnly ? takeCurrentTennisRoster(players, roster?.standings) : players;
  }
  // Disk roster.json only — never parse the 528MB match cache on a dashboard GET.
  const diskRoster = loadApiTennisRoster({ allowCacheJson: false });
  const disk = usableTennisRoster((diskRoster?.players || []).map(withPlayerCountry));
  if (disk.length) {
    if (!opts?.currentOnly) return disk;
    const ranked = disk.filter((player) => player.rank != null && Number(player.rank) > 0);
    return ranked.length ? ranked : disk;
  }
  const overlayPlayers = usableTennisRoster(getHydratedTennisOverlay()?.players || []);
  if (overlayPlayers.length) {
    const players = overlayPlayers.map(withPlayerCountry);
    if (!opts?.currentOnly) return players;
    const ranked = players.filter((player) => player.rank != null && Number(player.rank) > 0);
    return ranked.length ? ranked : players;
  }
  return redisPlayers;
}

export async function loadTennisRankingsCached(
  tour: TennisTour,
  opts?: { limit?: number }
): Promise<TennisRankingRow[]> {
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : 50;
  const roster = await readTennisRosterCache();
  const rows = tour === 'WTA' ? roster?.standings?.WTA : roster?.standings?.ATP;
  if (rows?.length) return rows.slice(0, limit).map(withPlayerCountry);
  if (getHydratedTennisOverlay()?.standings) {
    return loadTennisRankings(tour, opts);
  }
  return [];
}

export async function loadPlayerMatchesCached(opts: {
  playerId?: string | null;
  playerName?: string | null;
  tour?: TennisTour | null;
  opponentId?: string | null;
  opponentName?: string | null;
}): Promise<TennisMatchRow[]> {
  let playerId = String(opts.playerId || '').trim();
  if (!playerId && opts.playerName) {
    const roster = await readTennisRosterCache();
    const name = String(opts.playerName || '').trim();
    const hit =
      roster?.players.find((player) => player.name.toLowerCase() === name.toLowerCase()) ||
      roster?.players.filter((player) => tennisIdentityMatch(player.name, name));
    const resolved = Array.isArray(hit) ? (hit.length === 1 ? hit[0] : null) : hit;
    if (resolved?.playerId) playerId = resolved.playerId;
  }
  if (playerId) {
    const cached = await readTennisPlayerLogsCache(playerId);
    const cachedGames = cached?.games || [];
    // Never JSON.parse data/tennis/api-tennis/cache.json (~500MB) on a dashboard GET.
    // That blocks the event loop for seconds and stalls every other tennis request.
    // History backfill belongs to the tennis process-stats workflow.
    if (cachedGames.length) {
      let games = opts.tour ? cachedGames.filter((row) => row.tour === opts.tour) : cachedGames;
      if (getHydratedTennisOverlay()?.matches?.length) {
        const live = loadPlayerMatches({ ...opts, playerId: playerId || opts.playerId });
        if (live.length) games = mergeMatchRows(games, live);
      }
      return (
        await mergeCareerH2h(games, playerId, opts.opponentId, opts.opponentName, opts.tour)
      ).map(withMatchCountry);
    }
  }
  if (getHydratedTennisOverlay()?.matches?.length) {
    const live = loadPlayerMatches({ ...opts, playerId: playerId || opts.playerId });
    if (live.length && playerId) {
      void upsertTennisPlayerLogs([
        {
          fetchedAt: new Date().toISOString(),
          playerId,
          playerName: live[0]?.playerName || String(opts.playerName || playerId),
          tour: opts.tour || live[0]?.tour || null,
          games: live,
        },
      ]).catch((err) => console.warn('[tennis logs] overlay upsert skipped', err));
    }
    return (
      await mergeCareerH2h(live, playerId, opts.opponentId, opts.opponentName, opts.tour)
    ).map(withMatchCountry);
  }
  if (!playerId) return [];
  return mergeCareerH2h([], playerId, opts.opponentId, opts.opponentName, opts.tour);
}

/** Merge compiled disk history into every Redis player log. Never removes a stored game. */
export async function backfillAllTennisPlayerLogs(): Promise<{
  players: number;
  repaired: number;
  unchanged: number;
  refused: number;
  conflicts: number;
}> {
  const ids = listApiTennisPlayerIds();
  let repaired = 0;
  let unchanged = 0;
  let refused = 0;
  let conflicts = 0;
  const batchSize = 40;
  for (let i = 0; i < ids.length; i += batchSize) {
    const payloads = [];
    for (const id of ids.slice(i, i + batchSize)) {
      const games = readApiTennisPlayerMatches(id);
      if (!games.length) continue;
      payloads.push({
        fetchedAt: new Date().toISOString(),
        playerId: id,
        playerName: games.find((row) => row.playerName)?.playerName || id,
        tour: games.find((row) => row.tour)?.tour || null,
        games,
        historyBackfilled: true,
      });
    }
    const result = await upsertTennisPlayerLogs(payloads);
    repaired += result.written;
    unchanged += result.unchanged;
    refused += result.refused;
    conflicts += result.conflicts;
    const done = Math.min(i + batchSize, ids.length);
    if (done === ids.length || done % 400 === 0) {
      console.log(
        `[tennis history] ${done}/${ids.length} repaired=${repaired} unchanged=${unchanged} refused=${refused} conflicts=${conflicts}`
      );
    }
  }
  return { players: ids.length, repaired, unchanged, refused, conflicts };
}
