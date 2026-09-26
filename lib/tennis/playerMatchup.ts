/**
 * Player vs player form + tour ranks for the tennis matchup card.
 */

import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { resolveTennisMatchBestOf } from '@/lib/tennis/chartStats';
import { readTennisPlayerLogsCacheMany, tennisComputedCacheKey } from '@/lib/tennis/dashboardCache';
import { loadPlayerMatchesCached, loadTennisPlayersCached, tennisLogsNeedHistory } from '@/lib/tennis/loadCached';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import {
  TENNIS_MATCHUP_STATS,
  tennisMatchupBoardKey,
  type TennisMatchupBestOf,
  type TennisMatchupRow,
  type TennisMatchupSide,
  type TennisMatchupStatKey,
  type TennisPlayerMatchupPayload,
} from '@/lib/tennis/playerMatchupShared';
import {
  loadPlayerMatches,
  loadTennisPlayers,
  tourForPlayer,
  type TennisMatchRow,
  type TennisPlayer,
  type TennisTour,
} from '@/lib/tennis/data';

export {
  TENNIS_MATCHUP_STATS,
  tennisMatchupBoardKey,
  type TennisMatchupRow,
  type TennisMatchupSide,
  type TennisMatchupStatKey,
  type TennisPlayerMatchupPayload,
} from '@/lib/tennis/playerMatchupShared';

type ResolvedMatchupPlayer = {
  id: string | null;
  name: string;
  ioc: string | null;
  tour: TennisTour;
};

type MatchupBuildOpts = {
  playerName: string;
  opponentName: string;
  playerId?: string | null;
  opponentId?: string | null;
  tour?: TennisTour | null;
  window?: number;
  year?: number;
  bestOf?: TennisMatchupBestOf | number | null;
  fieldIds?: string[] | null;
  fieldSize?: number | null;
  extraGamesById?: Map<string, TennisMatchRow[]>;
};

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function isNumericTennisId(value: string | null | undefined): boolean {
  return /^\d+$/.test(String(value || '').trim());
}

function humanTennisName(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name && !isNumericTennisId(name)) return name;
  }
  return '';
}

function normName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function matchesBestOf(row: TennisMatchRow, bestOf: TennisMatchupBestOf): boolean {
  if (bestOf === 'all') return true;
  const actual = resolveTennisMatchBestOf(row);
  return bestOf === 5 ? actual === 5 : actual === 3;
}

function windowMatches(games: TennisMatchRow[], windowN: number, year: number): TennisMatchRow[] {
  const sorted = [...games].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (windowN > 0) return sorted.slice(-windowN);
  const season = sorted.filter((g) => g.season === year);
  return season.length ? season : sorted.slice(-20);
}

function resolvePlayer(
  players: TennisPlayer[],
  name: string,
  preferredTour: TennisTour,
  playerId?: string | null
): ResolvedMatchupPlayer {
  const rawName = String(name || '').trim();
  const numeric = isNumericTennisId(rawName);
  const id = String(playerId || (numeric ? rawName : '') || '').trim();
  const human = humanTennisName(rawName);
  if (id) {
    const byId = players.find((p) => p.playerId === id);
    if (byId) {
      return {
        id: byId.playerId,
        name: humanTennisName(byId.name, human) || byId.name,
        ioc: byId.ioc,
        tour: byId.tour,
      };
    }
  }
  if (!human) return { id: id || null, name: human || rawName, ioc: null, tour: preferredTour };
  const key = normName(human);
  const exactTour = players.find((p) => p.tour === preferredTour && normName(p.name) === key);
  if (exactTour) {
    return { id: exactTour.playerId, name: exactTour.name, ioc: exactTour.ioc, tour: exactTour.tour };
  }
  const exactAny = players.find((p) => normName(p.name) === key);
  if (exactAny) {
    return { id: exactAny.playerId, name: exactAny.name, ioc: exactAny.ioc, tour: exactAny.tour };
  }
  const identity = players.filter((p) => tennisIdentityMatch(p.name, human));
  const identityTour = identity.filter((p) => p.tour === preferredTour);
  const identityHits = identityTour.length ? identityTour : identity;
  if (identityHits.length === 1) {
    return {
      id: identityHits[0].playerId,
      name: identityHits[0].name,
      ioc: identityHits[0].ioc,
      tour: identityHits[0].tour,
    };
  }
  const last = key.split(/\s+/).filter(Boolean).pop() || '';
  if (last.length >= 3) {
    const lastHits = players.filter((p) => {
      const parts = normName(p.name).split(/\s+/);
      return parts[parts.length - 1] === last && p.tour === preferredTour;
    });
    const unique = [...new Map(lastHits.map((p) => [p.playerId, p])).values()];
    if (unique.length === 1) {
      return { id: unique[0].playerId, name: unique[0].name, ioc: unique[0].ioc, tour: unique[0].tour };
    }
  }
  return { id: id || null, name: human, ioc: null, tour: preferredTour };
}

function resolveFromGames(
  resolved: ResolvedMatchupPlayer,
  games: TennisMatchRow[]
): ResolvedMatchupPlayer {
  const last = games.at(-1);
  return {
    id: resolved.id || last?.playerId || null,
    name: humanTennisName(resolved.name, last?.playerName) || resolved.name,
    ioc: resolved.ioc ?? last?.ioc ?? null,
    tour: last?.tour || resolved.tour,
  };
}

function sideFromRows(
  resolved: ResolvedMatchupPlayer,
  all: TennisMatchRow[],
  windowed: TennisMatchRow[]
): TennisMatchupSide {
  const last = windowed.at(-1) || all.at(-1);
  return {
    id: last?.playerId ?? resolved.id,
    name: humanTennisName(resolved.name, last?.playerName) || resolved.name,
    ioc: last?.ioc ?? resolved.ioc,
    matches: windowed.length,
    totalMatches: all.length,
  };
}

function statValues(rows: TennisMatchRow[], key: TennisMatchupStatKey): number[] {
  return rows.map((row) => num(row[key])).filter((v): v is number => v != null);
}

function meanForKey(windowed: TennisMatchRow[], key: TennisMatchupStatKey): number | null {
  return mean(statValues(windowed, key));
}

function rankMap(
  values: Array<{ id: string; value: number }>,
  invert: boolean
): Map<string, number> {
  const sorted = [...values].sort((a, b) => {
    const delta = invert ? a.value - b.value : b.value - a.value;
    return delta || a.id.localeCompare(b.id);
  });
  const out = new Map<string, number>();
  sorted.forEach((row, idx) => out.set(row.id, idx + 1));
  return out;
}

function filterGames(
  rows: TennisMatchRow[] | undefined,
  tour: TennisTour,
  bestOf: TennisMatchupBestOf
): TennisMatchRow[] {
  const list = rows || [];
  const ofTour = list.filter((row) => row.tour === tour);
  const pool = ofTour.length ? ofTour : list;
  return pool.filter((row) => matchesBestOf(row, bestOf));
}

function overlayGames(
  id: string | null,
  name: string,
  tour: TennisTour,
  bestOf: TennisMatchupBestOf
): TennisMatchRow[] {
  return filterGames(
    loadPlayerMatches({
      playerId: id,
      playerName: id ? null : name,
      tour,
    }),
    tour,
    bestOf
  );
}

function assembleTennisPlayerMatchup(
  opts: MatchupBuildOpts,
  players: TennisPlayer[],
  gamesFor: (id: string | null, name: string) => TennisMatchRow[]
): TennisPlayerMatchupPayload {
  const year =
    opts.year && Number.isFinite(opts.year) && opts.year >= 2000 ? opts.year : TENNIS_CURRENT_YEAR;
  const windowN = Math.max(0, Number(opts.window ?? 0) || 0);
  const playerName = humanTennisName(opts.playerName) || String(opts.playerName || '').trim();
  const opponentName = humanTennisName(opts.opponentName) || String(opts.opponentName || '').trim();
  const tour =
    opts.tour ||
    players.find((p) => p.playerId === String(opts.playerId || '').trim())?.tour ||
    players.find((p) => tennisIdentityMatch(p.name, playerName))?.tour ||
    'ATP';
  const bestOfN = Number(opts.bestOf);
  const bestOf: TennisMatchupBestOf =
    tour === 'WTA' ? 'all' : bestOfN === 5 ? 5 : bestOfN === 3 ? 3 : 'all';

  let resolvedPlayer = resolvePlayer(players, playerName, tour, opts.playerId);
  let resolvedOpponent = resolvePlayer(players, opponentName, tour, opts.opponentId);
  const playerAll = gamesFor(resolvedPlayer.id, resolvedPlayer.name || playerName);
  const opponentAll = gamesFor(resolvedOpponent.id, resolvedOpponent.name || opponentName);
  resolvedPlayer = resolveFromGames(resolvedPlayer, playerAll);
  resolvedOpponent = resolveFromGames(resolvedOpponent, opponentAll);
  const playerWindow = windowMatches(playerAll, windowN, year);
  const opponentWindow = windowMatches(opponentAll, windowN, year);

  const player = sideFromRows(resolvedPlayer, playerAll, playerWindow);
  const opponent = sideFromRows(resolvedOpponent, opponentAll, opponentWindow);

  const fieldIds = [...new Set((opts.fieldIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const rankingIds = new Set(fieldIds);
  if (rankingIds.size) {
    if (player.id) rankingIds.add(player.id);
    if (opponent.id) rankingIds.add(opponent.id);
  }
  const byId = new Map<string, TennisMatchRow[]>();
  if (player.id) byId.set(player.id, playerAll);
  if (opponent.id) byId.set(opponent.id, opponentAll);
  for (const id of rankingIds) {
    if (byId.has(id)) continue;
    byId.set(id, gamesFor(id, ''));
  }

  const fieldAvgs = new Map<string, Map<TennisMatchupStatKey, number>>();
  if (rankingIds.size) {
    for (const id of rankingIds) {
      const history = byId.get(id) || [];
      const sample = windowMatches(history, windowN, year);
      if (!sample.length) continue;
      const avgs = new Map<TennisMatchupStatKey, number>();
      for (const stat of TENNIS_MATCHUP_STATS) {
        const playerMean = meanForKey(sample, stat.playerKey);
        if (playerMean != null) avgs.set(stat.playerKey, playerMean);
        const oppMean = meanForKey(sample, stat.opponentKey);
        if (oppMean != null) avgs.set(stat.opponentKey, oppMean);
      }
      if (avgs.size) fieldAvgs.set(id, avgs);
    }
  }

  function ranksFor(key: TennisMatchupStatKey, invert: boolean): Map<string, number> {
    const values: Array<{ id: string; value: number }> = [];
    for (const [id, avgs] of fieldAvgs) {
      const value = avgs.get(key);
      if (value == null) continue;
      values.push({ id, value });
    }
    return rankMap(values, invert);
  }

  const rows: TennisMatchupRow[] = TENNIS_MATCHUP_STATS.map((stat) => {
    const playerRanks = ranksFor(stat.playerKey, stat.playerInvert);
    const opponentRanks = ranksFor(stat.opponentKey, stat.opponentInvert);
    return {
      key: stat.key,
      label: stat.label,
      playerSideLabel: stat.playerSideLabel,
      opponentSideLabel: stat.opponentSideLabel,
      pct: stat.pct,
      playerValue: meanForKey(playerWindow, stat.playerKey),
      playerRank: player.id ? playerRanks.get(player.id) ?? null : null,
      opponentValue: meanForKey(opponentWindow, stat.opponentKey),
      opponentRank: opponent.id ? opponentRanks.get(opponent.id) ?? null : null,
    };
  });

  const fieldSize = Math.max(
    Number.isFinite(Number(opts.fieldSize)) ? Math.round(Number(opts.fieldSize)) : 0,
    rankingIds.size,
    fieldIds.length
  );

  return {
    tour,
    year,
    window: windowN,
    bestOf,
    fieldSize,
    player,
    opponent,
    rows,
  };
}

export function tennisMatchupComputedKey(opts: {
  playerId?: string | null;
  playerName?: string | null;
  opponentId?: string | null;
  opponentName?: string | null;
  tour?: string | null;
  window?: number | null;
  year?: number | null;
  bestOf?: string | number | null;
  tournamentKey?: string | null;
  tournamentName?: string | null;
  stage?: string | null;
  boards?: boolean;
}): string {
  return tennisComputedCacheKey(opts.boards ? 'matchup_boards_v2' : 'matchup_v2', [
    opts.playerId || opts.playerName,
    opts.opponentId || opts.opponentName,
    opts.tour,
    opts.boards ? 'all' : String(opts.window ?? 0),
    String(opts.year || ''),
    opts.boards ? 'boards' : String(opts.bestOf || 'all'),
    opts.tournamentKey || opts.tournamentName,
    opts.stage,
  ]);
}

export function tennisMatchupPayloadUsable(
  payload: (Partial<TennisPlayerMatchupPayload> & { success?: boolean }) | null | undefined,
  opts?: { window?: number; year?: number; bestOf?: string | number | null; expectField?: boolean }
): payload is TennisPlayerMatchupPayload & { success?: boolean } {
  const boardKey =
    opts?.window != null || opts?.bestOf != null
      ? tennisMatchupBoardKey(opts.bestOf, opts.window)
      : '';
  const selected =
    boardKey && payload?.boards?.[boardKey] ? payload.boards[boardKey] : payload;
  if (!selected?.player || !selected.opponent || !Array.isArray(selected.rows)) return false;
  if (payload?.success === false) return false;
  if (!humanTennisName(selected.player.name) || !humanTennisName(selected.opponent.name)) return false;
  if (!payload?.boards) {
    if (opts?.window != null && Number(selected.window) !== Number(opts.window)) return false;
    if (opts?.bestOf != null && String(selected.bestOf || 'all') !== String(opts.bestOf || 'all')) return false;
  }
  if (opts?.year != null && Number(selected.year) !== Number(opts.year)) return false;
  const hasValues = selected.rows.some((row) => row.playerValue != null || row.opponentValue != null);
  if (!hasValues) return false;
  if (opts?.expectField) {
    const hasRanks = selected.rows.some((row) => row.playerRank != null || row.opponentRank != null);
    if (!hasRanks) return false;
  }
  return true;
}

export function buildTennisPlayerMatchup(opts: MatchupBuildOpts): TennisPlayerMatchupPayload {
  const players = loadTennisPlayers();
  const extra = opts.extraGamesById;
  const yearTour =
    opts.tour ||
    tourForPlayer(null, String(opts.playerName || '')) ||
    tourForPlayer(null, String(opts.opponentName || '')) ||
    'ATP';
  const bestOfN = Number(opts.bestOf);
  const bestOf: TennisMatchupBestOf =
    yearTour === 'WTA' ? 'all' : bestOfN === 5 ? 5 : bestOfN === 3 ? 3 : 'all';
  return assembleTennisPlayerMatchup(opts, players, (id, name) => {
    const cached = id && extra?.get(id)?.length ? filterGames(extra.get(id), yearTour, bestOf) : [];
    return cached.length ? cached : overlayGames(id, name, yearTour, bestOf);
  });
}

export async function buildTennisPlayerMatchupAsync(
  opts: MatchupBuildOpts
): Promise<TennisPlayerMatchupPayload> {
  const players = await loadTennisPlayersCached();
  const tour =
    opts.tour ||
    players.find((p) => p.playerId === String(opts.playerId || '').trim())?.tour ||
    'ATP';
  const bestOfN = Number(opts.bestOf);
  const selectedBestOf: TennisMatchupBestOf =
    tour === 'WTA' ? 'all' : bestOfN === 5 ? 5 : bestOfN === 3 ? 3 : 'all';
  const resolvedPlayer = resolvePlayer(players, String(opts.playerName || ''), tour, opts.playerId);
  const resolvedOpponent = resolvePlayer(players, String(opts.opponentName || ''), tour, opts.opponentId);
  const fieldIds = [...new Set((opts.fieldIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const ids = [
    ...fieldIds,
    String(resolvedPlayer.id || '').trim(),
    String(resolvedOpponent.id || '').trim(),
  ].filter(Boolean);
  const logsById = await readTennisPlayerLogsCacheMany(ids);
  const thinIds = [resolvedPlayer.id, resolvedOpponent.id]
    .map((id) => String(id || '').trim())
    .filter((id) => id && tennisLogsNeedHistory(logsById.get(id)));
  if (thinIds.length) {
    const filled = await Promise.all(
      thinIds.map((id) => loadPlayerMatchesCached({ playerId: id, tour }))
    );
    thinIds.forEach((id, index) => {
      if (filled[index]?.length) logsById.set(id, filled[index]);
    });
  }
  const extra = opts.extraGamesById;
  const rawById = new Map<string, TennisMatchRow[]>();

  const rawGamesFor = (id: string | null, name: string): TennisMatchRow[] => {
    const key = String(id || '').trim();
    if (key && rawById.has(key)) return rawById.get(key) || [];
    const redis = key ? filterGames(logsById.get(key), tour, 'all') : [];
    const extraRows = key && extra?.get(key)?.length ? filterGames(extra.get(key), tour, 'all') : [];
    const rows = redis.length ? redis : extraRows;
    if (key) rawById.set(key, rows);
    return rows;
  };

  let probe = assembleTennisPlayerMatchup({ ...opts, bestOf: selectedBestOf }, players, (id, name) =>
    filterGames(rawGamesFor(id, name), tour, selectedBestOf)
  );
  if (!probe.player.totalMatches && !probe.opponent.totalMatches) {
    const [playerLive, opponentLive] = await Promise.all([
      loadPlayerMatchesCached({
        playerId: probe.player.id || resolvedPlayer.id,
        playerName: probe.player.name || opts.playerName,
        tour,
      }),
      loadPlayerMatchesCached({
        playerId: probe.opponent.id || resolvedOpponent.id,
        playerName: probe.opponent.name || opts.opponentName,
        tour,
      }),
    ]);
    const playerId = String(probe.player.id || resolvedPlayer.id || '').trim();
    const opponentId = String(probe.opponent.id || resolvedOpponent.id || '').trim();
    if (playerId && playerLive.length) rawById.set(playerId, filterGames(playerLive, tour, 'all'));
    if (opponentId && opponentLive.length) rawById.set(opponentId, filterGames(opponentLive, tour, 'all'));
    probe = assembleTennisPlayerMatchup({ ...opts, bestOf: selectedBestOf }, players, (id, name) =>
      filterGames(rawGamesFor(id, name), tour, selectedBestOf)
    );
  }

  const bestOfs: TennisMatchupBestOf[] = tour === 'WTA' ? ['all'] : ['all', 3, 5];
  const windowNs = [0, 5, 10];
  const boards: Record<string, TennisPlayerMatchupPayload> = {};
  for (const bestOf of bestOfs) {
    const gamesFor = (id: string | null, name: string) => filterGames(rawGamesFor(id, name), tour, bestOf);
    for (const window of windowNs) {
      const board = assembleTennisPlayerMatchup({ ...opts, bestOf, window }, players, gamesFor);
      const { boards: _ignored, ...plain } = board;
      boards[tennisMatchupBoardKey(bestOf, window)] = plain;
    }
  }
  const selected =
    boards[tennisMatchupBoardKey(selectedBestOf, Math.max(0, Number(opts.window ?? 0) || 0))] || probe;
  return { ...selected, boards };
}
