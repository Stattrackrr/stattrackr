/**
 * Player vs player form + tour ranks for the tennis matchup card.
 */

import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { resolveTennisMatchBestOf } from '@/lib/tennis/chartStats';
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
  loadTennisPlayers,
  tourForPlayer,
  type TennisMatchRow,
  type TennisTour,
} from '@/lib/tennis/data';

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
  name: string,
  preferredTour: TennisTour,
  playerId?: string | null
): { id: string | null; name: string; ioc: string | null; tour: TennisTour } {
  const players = loadTennisPlayers();
  const id = String(playerId || '').trim();
  if (id) {
    const byId = players.find((p) => p.playerId === id);
    if (byId) {
      return { id: byId.playerId, name: byId.name, ioc: byId.ioc, tour: byId.tour };
    }
  }
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

export function buildTennisPlayerMatchup(opts: {
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
}): TennisPlayerMatchupPayload {
  const year =
    opts.year && Number.isFinite(opts.year) && opts.year >= 2000 ? opts.year : TENNIS_CURRENT_YEAR;
  const windowN = Math.max(0, Number(opts.window ?? 0) || 0);
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  const tour =
    opts.tour ||
    tourForPlayer(null, playerName) ||
    tourForPlayer(null, opponentName) ||
    'ATP';
  const bestOfN = Number(opts.bestOf);
  const bestOf: TennisMatchupBestOf =
    tour === 'WTA' ? 'all' : bestOfN === 5 ? 5 : bestOfN === 3 ? 3 : 'all';

  const resolvedPlayer = resolvePlayer(playerName, tour, opts.playerId);
  const resolvedOpponent = resolvePlayer(opponentName, tour, opts.opponentId);
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
    byId.set(
      id,
      loadPlayerMatches({ playerId: id, tour }).filter((row) => matchesBestOf(row, bestOf))
    );
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
