/**
 * Dashboard loaders that prefer AFL-style Redis shards, then process overlay.
 */

import {
  readTennisPlayerLogsCache,
  readTennisPlayerLogsCacheMany,
  readTennisRosterCache,
  writeTennisPlayerLogsCache,
  writeTennisPlayerLogsCacheMany,
} from '@/lib/tennis/dashboardCache';
import {
  loadPlayerMatches,
  loadTennisPlayers,
  loadTennisRankings,
  type TennisMatchRow,
  type TennisPlayer,
  type TennisRankingRow,
  type TennisTour,
} from '@/lib/tennis/data';
import { getHydratedTennisOverlay } from '@/lib/tennis/ingest';
import { readApiTennisPlayerMatches, listApiTennisPlayerIds } from '@/lib/tennis/apiTennis';
import { TENNIS_HISTORY_YEARS } from '@/lib/tennis/constants';
import { canonicalTennisIoc } from '@/lib/tennis/nationality';
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

function redisMissingDiskHistory(redisGames: TennisMatchRow[], diskGames: TennisMatchRow[]): boolean {
  if (!diskGames.length) return false;
  if (redisGames.length < diskGames.length) return true;
  return !coversHistoryYears(redisGames) && coversHistoryYears(diskGames);
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
  const ioc = canonicalTennisIoc({ playerId: row.playerId, name: row.name, stored: row.ioc });
  return ioc === row.ioc ? row : { ...row, ioc };
}

function withMatchCountry(row: TennisMatchRow): TennisMatchRow {
  const ioc = canonicalTennisIoc({ playerId: row.playerId, name: row.playerName, stored: row.ioc });
  const opponentIoc = canonicalTennisIoc({
    playerId: row.opponentId,
    name: row.opponent,
    stored: row.opponentIoc,
  });
  if (ioc === row.ioc && opponentIoc === row.opponentIoc) return row;
  return { ...row, ioc, opponentIoc };
}

function filterCurrent(players: TennisPlayer[], standings: TennisRosterStandings | undefined): TennisPlayer[] {
  const ranked = new Set<string>();
  for (const row of standings?.ATP || []) ranked.add(row.playerId);
  for (const row of standings?.WTA || []) ranked.add(row.playerId);
  if (!ranked.size) return players;
  return players.filter((player) => ranked.has(player.playerId));
}

export async function loadTennisPlayersCached(opts?: {
  currentOnly?: boolean;
}): Promise<TennisPlayer[]> {
  const roster = await readTennisRosterCache();
  if (roster?.players?.length) {
    const players = roster.players.map(withPlayerCountry);
    return opts?.currentOnly ? filterCurrent(players, roster.standings) : players;
  }
  if (getHydratedTennisOverlay()?.players?.length) {
    return loadTennisPlayers(opts);
  }
  return [];
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
    let cachedGames = cached?.games || [];
    if (tennisLogsNeedHistory(cachedGames) || !cached?.historyBackfilled) {
      const fromDisk = readApiTennisPlayerMatches(playerId);
      if (fromDisk.length && redisMissingDiskHistory(cachedGames, fromDisk)) {
        const games = mergeMatchRows(fromDisk, cachedGames);
        const written = await writeTennisPlayerLogsCache({
          fetchedAt: new Date().toISOString(),
          playerId,
          playerName: games[0]?.playerName || cached?.playerName || String(opts.playerName || playerId),
          tour: opts.tour || games[0]?.tour || cached?.tour || null,
          games,
          historyBackfilled: true,
        });
        cachedGames = written?.games?.length ? written.games : games;
      }
    }
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
      void writeTennisPlayerLogsCache({
        fetchedAt: new Date().toISOString(),
        playerId,
        playerName: live[0]?.playerName || String(opts.playerName || playerId),
        tour: opts.tour || live[0]?.tour || null,
        games: live,
      });
    }
    return (
      await mergeCareerH2h(live, playerId, opts.opponentId, opts.opponentName, opts.tour)
    ).map(withMatchCountry);
  }
  if (!playerId) return [];
  return mergeCareerH2h([], playerId, opts.opponentId, opts.opponentName, opts.tour);
}

/** Rewrite every Redis player log that is missing compiled 2024–2026 history. */
export async function backfillAllTennisPlayerLogs(): Promise<{
  players: number;
  repaired: number;
  unchanged: number;
}> {
  const ids = listApiTennisPlayerIds();
  let repaired = 0;
  let unchanged = 0;
  const batchSize = 40;
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const existing = await readTennisPlayerLogsCacheMany(slice);
    const payloads = [];
    for (const id of slice) {
      const disk = readApiTennisPlayerMatches(id);
      const redisGames = existing.get(id) || [];
      if (!redisMissingDiskHistory(redisGames, disk)) {
        unchanged += 1;
        continue;
      }
      const games = mergeMatchRows(disk, redisGames);
      payloads.push({
        fetchedAt: new Date().toISOString(),
        playerId: id,
        playerName: games.find((row) => row.playerName)?.playerName || redisGames[0]?.playerName || id,
        tour: games.find((row) => row.tour)?.tour || redisGames[0]?.tour || null,
        games,
        historyBackfilled: true,
      });
    }
    if (payloads.length) repaired += await writeTennisPlayerLogsCacheMany(payloads);
    const done = Math.min(i + batchSize, ids.length);
    if (done === ids.length || done % 400 === 0) {
      console.log(`[tennis history] ${done}/${ids.length} repaired=${repaired} unchanged=${unchanged}`);
    }
  }
  return { players: ids.length, repaired, unchanged };
}
