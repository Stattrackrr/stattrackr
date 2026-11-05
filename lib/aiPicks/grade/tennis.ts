import { isTennisMarket } from '@/lib/aiPicks/markets';
import { gradeTennis, gradeTennisUnfinished, type LegGrade, type TennisResult } from '@/lib/aiPicks/grade/rules';
import type { AiPickLeg } from '@/lib/aiPicks/types';
import {
  isUnplayedTennisMatch,
  parseTennisSetsFromPlayerView,
  tennisScoreIsRetired,
  withRepairedTennisTotals,
} from '@/lib/tennis/chartStats';
import { readTennisPlayerLogsCacheMany } from '@/lib/tennis/dashboardCache';
import { refreshTennisLogsForMatches } from '@/lib/tennis/ingest';
import { tennisNamesMatch } from '@/lib/tennis/oddsApi';
import type { TennisMatchRow } from '@/lib/tennis/types';

const MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Player logs refresh every 8 hours; after this long a missing match is treated as not played. */
const GIVE_UP_MS = 4 * 24 * 60 * 60 * 1000;

/** Only chase a result directly for this long after the start; older legs wait on the 8-hourly ingest. */
const DIRECT_REFRESH_MS = 2 * 24 * 60 * 60 * 1000;

/** Loads every needed player's logs in one Redis round trip. */
export async function loadTennisLogs(legs: AiPickLeg[]): Promise<Map<string, TennisMatchRow[]>> {
  const ids = legs.map((l) => l.playerId).filter((id): id is string => Boolean(id));
  return readTennisPlayerLogsCacheMany(ids);
}

export type TennisResults = {
  logs: Map<string, TennisMatchRow[]>;
  /** Match key to api-tennis status for matches that will not be played (walkover, cancelled...). */
  unplayed: Map<string, string>;
};

/**
 * Logs for posted legs, fetching just those matches from api-tennis when the result isn't in the
 * logs yet. One API call per unresolved match per grade run.
 */
export async function loadTennisLogsWithFreshResults(legs: AiPickLeg[], nowMs: number): Promise<TennisResults> {
  const tennis = legs.filter((l) => l.sport === 'tennis' && l.playerId);
  const logs = await loadTennisLogs(tennis);
  const missing = tennis.filter((leg) => {
    const age = nowMs - Date.parse(leg.startsAt);
    return age >= 0 && age <= DIRECT_REFRESH_MS && !findTennisRow(leg, logs.get(leg.playerId!) ?? []);
  });
  if (!missing.length) return { logs, unplayed: new Map() };
  const refreshed = await refreshTennisLogsForMatches(
    missing.map((leg) => ({ matchKey: leg.eventKey, startsAt: leg.startsAt }))
  ).catch((e) => {
    console.warn('[ai-picks grade] tennis match refresh failed', e);
    return null;
  });
  const unplayed = new Map(Object.entries(refreshed?.unplayed ?? {}));
  if (!refreshed || refreshed.added + refreshed.updated === 0) return { logs, unplayed };
  return { logs: await loadTennisLogs(tennis), unplayed };
}

export function findTennisRow(leg: AiPickLeg, rows: TennisMatchRow[]): TennisMatchRow | null {
  const exact = rows.find((r) => r.matchId === `${leg.eventKey}-${leg.playerId}`);
  if (exact) return exact;
  const start = Date.parse(leg.startsAt);
  return (
    rows.find((r) => {
      const t = Date.parse(String(r.date || ''));
      if (!Number.isFinite(t) || Math.abs(t - start) > MATCH_WINDOW_MS) return false;
      return leg.team ? tennisNamesMatch(r.opponent, leg.team) : false;
    }) ?? null
  );
}

export function tennisResultFromRow(row: TennisMatchRow): TennisResult | null {
  const fixed = withRepairedTennisTotals(row);
  if (fixed.gamesWon == null || fixed.gamesLost == null) return null;
  let setsWon = fixed.setsWon;
  let setsLost = fixed.setsLost;
  if (setsWon == null || setsLost == null) {
    const sets = parseTennisSetsFromPlayerView(row.score, row.isWin);
    setsWon = sets.filter((s) => s.playerGames > s.opponentGames).length;
    setsLost = sets.filter((s) => s.opponentGames > s.playerGames).length;
  }
  return {
    won: row.isWin,
    gamesWon: fixed.gamesWon,
    gamesLost: fixed.gamesLost,
    setsWon,
    setsLost,
    score: row.score,
  };
}

/** null = not gradeable yet (result not in the logs). */
export function gradeTennisLeg(
  leg: AiPickLeg,
  logs: Map<string, TennisMatchRow[]>,
  nowMs: number,
  unplayed: Map<string, string> = new Map()
): LegGrade | null {
  if (!isTennisMarket(leg.market)) return { status: 'void', value: null, note: `Unknown tennis market ${leg.market}` };
  if (!leg.playerId) return { status: 'void', value: null, note: 'No player id on the leg' };
  const row = findTennisRow(leg, logs.get(leg.playerId) ?? []);
  if (!row) {
    const status = unplayed.get(leg.eventKey);
    if (status) return { status: 'void', value: null, note: `Match not played (${status})` };
    return nowMs - Date.parse(leg.startsAt) > GIVE_UP_MS
      ? { status: 'void', value: null, note: 'Match not found or not played' }
      : null;
  }
  const score = String(row.score || '');
  if (isUnplayedTennisMatch(score)) return { status: 'void', value: null, note: `Match not played (${score || 'no score'})` };
  if (tennisScoreIsRetired(score) || /\bdef\b/i.test(score)) {
    return gradeTennisUnfinished(leg, parseTennisSetsFromPlayerView(score, row.isWin), score);
  }
  const result = tennisResultFromRow(row);
  if (!result) return { status: 'void', value: null, note: 'Score could not be read' };
  return gradeTennis(leg, result);
}
