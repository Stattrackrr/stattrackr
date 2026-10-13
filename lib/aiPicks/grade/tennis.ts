import { isTennisMarket } from '@/lib/aiPicks/markets';
import { gradeTennis, type LegGrade, type TennisResult } from '@/lib/aiPicks/grade/rules';
import type { AiPickLeg } from '@/lib/aiPicks/types';
import {
  isUnplayedTennisMatch,
  parseTennisSetsFromPlayerView,
  tennisScoreIsRetired,
  withRepairedTennisTotals,
} from '@/lib/tennis/chartStats';
import { readTennisPlayerLogsCacheMany } from '@/lib/tennis/dashboardCache';
import { tennisNamesMatch } from '@/lib/tennis/oddsApi';
import type { TennisMatchRow } from '@/lib/tennis/types';

const MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Player logs refresh every 8 hours; after this long a missing match is treated as not played. */
const GIVE_UP_MS = 4 * 24 * 60 * 60 * 1000;

/** Loads every needed player's logs in one Redis round trip. */
export async function loadTennisLogs(legs: AiPickLeg[]): Promise<Map<string, TennisMatchRow[]>> {
  const ids = legs.map((l) => l.playerId).filter((id): id is string => Boolean(id));
  return readTennisPlayerLogsCacheMany(ids);
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
export function gradeTennisLeg(leg: AiPickLeg, logs: Map<string, TennisMatchRow[]>, nowMs: number): LegGrade | null {
  if (!isTennisMarket(leg.market)) return { status: 'void', value: null, note: `Unknown tennis market ${leg.market}` };
  if (!leg.playerId) return { status: 'void', value: null, note: 'No player id on the leg' };
  const row = findTennisRow(leg, logs.get(leg.playerId) ?? []);
  if (!row) {
    return nowMs - Date.parse(leg.startsAt) > GIVE_UP_MS
      ? { status: 'void', value: null, note: 'Match not found or not played' }
      : null;
  }
  const score = String(row.score || '');
  if (isUnplayedTennisMatch(score) || tennisScoreIsRetired(score) || /\bdef\b/i.test(score)) {
    return { status: 'void', value: null, note: `Match not completed (${score || 'no score'})` };
  }
  const result = tennisResultFromRow(row);
  if (!result) return { status: 'void', value: null, note: 'Score could not be read' };
  return gradeTennis(leg, result);
}
