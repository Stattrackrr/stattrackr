/**
 * Dashboard loaders that prefer AFL-style Redis shards, then process overlay.
 */

import {
  readTennisPlayerLogsCache,
  readTennisRosterCache,
  writeTennisPlayerLogsCache,
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
import { readApiTennisPlayerMatches } from '@/lib/tennis/apiTennis';
import { TENNIS_HISTORY_YEARS } from '@/lib/tennis/constants';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';

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
    return opts?.currentOnly ? filterCurrent(roster.players, roster.standings) : roster.players;
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
  if (rows?.length) return rows.slice(0, limit);
  if (getHydratedTennisOverlay()?.standings) {
    return loadTennisRankings(tour, opts);
  }
  return [];
}

export async function loadPlayerMatchesCached(opts: {
  playerId?: string | null;
  playerName?: string | null;
  tour?: TennisTour | null;
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
    const needsHistory =
      !cached?.historyBackfilled && (cachedGames.length < 12 || !coversHistoryYears(cachedGames));
    if (needsHistory) {
      const fromDisk = readApiTennisPlayerMatches(playerId);
      const games = fromDisk.length ? mergeMatchRows(fromDisk, cachedGames) : cachedGames;
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
    if (cachedGames.length) {
      return opts.tour ? cachedGames.filter((row) => row.tour === opts.tour) : cachedGames;
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
    return live;
  }
  return [];
}
