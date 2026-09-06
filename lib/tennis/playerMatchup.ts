/**
 * Player vs player form + tour ranks for the tennis matchup card.
 */

import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import {
  TENNIS_MATCHUP_STATS,
  type TennisMatchupBestOf,
  type TennisMatchupRow,
  type TennisMatchupSide,
  type TennisMatchupStatKey,
  type TennisPlayerMatchupPayload,
} from '@/lib/tennis/playerMatchupShared';
import {
  loadPlayerMatches,
  loadTennisMatches,
  loadTennisPlayers,
  loadTennisRankings,
  tourForPlayer,
  type TennisMatchRow,
  type TennisTour,
} from '@/lib/tennis/sackmann';

export {
  TENNIS_MATCHUP_STATS,
  type TennisMatchupRow,
  type TennisMatchupSide,
  type TennisMatchupStatKey,
  type TennisPlayerMatchupPayload,
} from '@/lib/tennis/playerMatchupShared';

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function normName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function matchesBestOf(row: TennisMatchRow, bestOf: TennisMatchupBestOf): boolean {
  const n = Number(row.bestOf);
  if (!Number.isFinite(n)) return bestOf === 3;
  return bestOf === 5 ? n >= 5 : n < 5;
}

function windowMatches(games: TennisMatchRow[], windowN: number, year: number): TennisMatchRow[] {
  const sorted = [...games].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (windowN > 0) return sorted.slice(-windowN);
  const season = sorted.filter((g) => g.season === year);
  return season.length ? season : sorted.slice(-20);
}

function minMatchesForWindow(windowN: number): number {
  if (windowN === 5) return 3;
  if (windowN === 10) return 5;
  return 5;
}

function resolvePlayer(
  name: string,
  preferredTour: TennisTour
): { id: string | null; name: string; ioc: string | null; tour: TennisTour } {
  const players = loadTennisPlayers();
  const key = normName(name);
  if (!key) return { id: null, name, ioc: null, tour: preferredTour };
  const exactTour = players.find((p) => p.tour === preferredTour && normName(p.name) === key);
  if (exactTour) {
    return { id: exactTour.playerId, name: exactTour.name, ioc: exactTour.ioc, tour: exactTour.tour };
  }
  const exactAny = players.find((p) => normName(p.name) === key);
  if (exactAny) {
    return { id: exactAny.playerId, name: exactAny.name, ioc: exactAny.ioc, tour: exactAny.tour };
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
  return { id: null, name, ioc: null, tour: preferredTour };
}

function sideFromRows(
  resolved: { id: string | null; name: string; ioc: string | null },
  all: TennisMatchRow[],
  windowed: TennisMatchRow[]
): TennisMatchupSide {
  const last = windowed.at(-1) || all.at(-1);
  return {
    id: last?.playerId ?? resolved.id,
    name: last?.playerName || resolved.name,
    ioc: last?.ioc ?? resolved.ioc,
    matches: windowed.length,
    totalMatches: all.length,
  };
}

function statValues(rows: TennisMatchRow[], key: TennisMatchupStatKey): number[] {
  return rows.map((row) => num(row[key])).filter((v): v is number => v != null);
}

/** Recent same-format matches that actually have this stat (Sackmann often lags slam box scores). */
function recentWithStat(
  rows: TennisMatchRow[],
  key: TennisMatchupStatKey,
  limit: number
): TennisMatchRow[] {
  return [...rows]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .filter((row) => num(row[key]) != null)
    .slice(-Math.max(1, limit));
}

function meanForKey(
  windowed: TennisMatchRow[],
  allFormat: TennisMatchRow[],
  key: TennisMatchupStatKey,
  windowN: number
): number | null {
  const fromWindow = mean(statValues(windowed, key));
  if (fromWindow != null) return fromWindow;
  const need = windowN > 0 ? windowN : 8;
  return mean(statValues(recentWithStat(allFormat, key, need), key));
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

export function buildTennisPlayerMatchup(opts: {
  playerName: string;
  opponentName: string;
  tour?: TennisTour | null;
  window?: number;
  year?: number;
  bestOf?: TennisMatchupBestOf | number | null;
}): TennisPlayerMatchupPayload {
  const year =
    opts.year && Number.isFinite(opts.year) && opts.year >= 2000 ? opts.year : TENNIS_CURRENT_YEAR;
  const windowN = Math.max(0, Number(opts.window ?? 0) || 0);
  const bestOf: TennisMatchupBestOf = Number(opts.bestOf) >= 5 ? 5 : 3;
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  const tour =
    opts.tour ||
    tourForPlayer(null, playerName) ||
    tourForPlayer(null, opponentName) ||
    'ATP';

  const resolvedPlayer = resolvePlayer(playerName, tour);
  const resolvedOpponent = resolvePlayer(opponentName, tour);
  const playerAll = loadPlayerMatches({
    playerId: resolvedPlayer.id,
    playerName: resolvedPlayer.id ? null : playerName,
    tour,
  }).filter((row) => matchesBestOf(row, bestOf));
  const opponentAll = loadPlayerMatches({
    playerId: resolvedOpponent.id,
    playerName: resolvedOpponent.id ? null : opponentName,
    tour,
  }).filter((row) => matchesBestOf(row, bestOf));
  const playerWindow = windowMatches(playerAll, windowN, year);
  const opponentWindow = windowMatches(opponentAll, windowN, year);

  const player = sideFromRows(resolvedPlayer, playerAll, playerWindow);
  const opponent = sideFromRows(resolvedOpponent, opponentAll, opponentWindow);

  const minN = minMatchesForWindow(windowN);
  const tourRows = loadTennisMatches().filter(
    (row) => row.tour === tour && matchesBestOf(row, bestOf)
  );
  const byId = new Map<string, TennisMatchRow[]>();
  for (const row of tourRows) {
    const list = byId.get(row.playerId) || [];
    list.push(row);
    byId.set(row.playerId, list);
  }

  const ranked = loadTennisRankings(tour, { limit: 200 });
  const activeIds = new Set<string>();
  for (const p of ranked) {
    const sample = windowMatches(byId.get(p.playerId) || [], windowN, year);
    if (sample.length >= minN) activeIds.add(p.playerId);
  }
  if (player.id) activeIds.add(player.id);
  if (opponent.id) activeIds.add(opponent.id);

  const fieldAvgs = new Map<string, Map<TennisMatchupStatKey, number>>();
  for (const id of activeIds) {
    const sample = windowMatches(byId.get(id) || [], windowN, year);
    if (!sample.length) continue;
    const history = byId.get(id) || [];
    const avgs = new Map<TennisMatchupStatKey, number>();
    for (const stat of TENNIS_MATCHUP_STATS) {
      const playerMean = meanForKey(sample, history, stat.playerKey, windowN);
      if (playerMean != null) avgs.set(stat.playerKey, playerMean);
      const oppMean = meanForKey(sample, history, stat.opponentKey, windowN);
      if (oppMean != null) avgs.set(stat.opponentKey, oppMean);
    }
    if (avgs.size) fieldAvgs.set(id, avgs);
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
      playerValue: meanForKey(playerWindow, playerAll, stat.playerKey, windowN),
      playerRank: player.id ? playerRanks.get(player.id) ?? null : null,
      opponentValue: meanForKey(opponentWindow, opponentAll, stat.opponentKey, windowN),
      opponentRank: opponent.id ? opponentRanks.get(opponent.id) ?? null : null,
    };
  });

  return {
    tour,
    year,
    window: windowN,
    bestOf,
    fieldSize: Math.max(activeIds.size, 2),
    player,
    opponent,
    rows,
  };
}
