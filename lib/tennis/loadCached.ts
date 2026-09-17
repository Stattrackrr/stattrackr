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
import { hydrateTennisOverlayLocal } from '@/lib/tennis/ingest';

type TennisRosterStandings = {
  ATP?: TennisRankingRow[];
  WTA?: TennisRankingRow[];
};

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
  await hydrateTennisOverlayLocal();
  return loadTennisPlayers(opts);
}

export async function loadTennisRankingsCached(
  tour: TennisTour,
  opts?: { limit?: number }
): Promise<TennisRankingRow[]> {
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : 50;
  const roster = await readTennisRosterCache();
  const rows = tour === 'WTA' ? roster?.standings?.WTA : roster?.standings?.ATP;
  if (rows?.length) return rows.slice(0, limit);
  await hydrateTennisOverlayLocal();
  return loadTennisRankings(tour, opts);
}

export async function loadPlayerMatchesCached(opts: {
  playerId?: string | null;
  playerName?: string | null;
  tour?: TennisTour | null;
}): Promise<TennisMatchRow[]> {
  const playerId = String(opts.playerId || '').trim();
  if (playerId) {
    const cached = await readTennisPlayerLogsCache(playerId);
    if (cached?.games?.length) {
      return opts.tour ? cached.games.filter((row) => row.tour === opts.tour) : cached.games;
    }
  }
  await hydrateTennisOverlayLocal();
  const live = loadPlayerMatches(opts);
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
