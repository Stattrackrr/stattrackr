/**
 * Grading a logged selection from the match's per-set scores (spec section 13), house rule `house-v1`:
 * completed matches settle normally; on a retirement or default a selection already won stands, one that
 * can no longer win is a loss, and anything still open is void; a walkover voids everything.
 * Would-be bets settle under the posted book's rules (bookRules.ts); this house grade is the sensitivity check.
 */

import type { LogMarket } from './quotes';

export const GRADER_VERSION = 'house-v1';

export type SetScore = { home: number; away: number; tiebreak?: number | null };
export type MatchOutcome = {
  status: 'completed' | 'retired' | 'default' | 'walkover';
  sets: SetScore[];
  /** The player who progressed (on a retirement or default, the one who didn't retire). */
  winner?: 'home' | 'away' | null;
};
export type Grade = 'win' | 'loss' | 'push' | 'void';

export const setDone = (s: SetScore) => (s.home >= 6 || s.away >= 6) && (Math.abs(s.home - s.away) >= 2 || s.home === 7 || s.away === 7);

/** A selection on a completed match, from games and sets won per player. */
export function gradeCompleted(market: LogMarket, line: number | null, selection: string, t: { gH: number; gA: number; sH: number; sA: number }): Grade {
  const ou = (value: number, side: 'over' | 'under'): Grade => {
    if (line == null) return 'void';
    return value > line ? (side === 'over' ? 'win' : 'loss') : value < line ? (side === 'over' ? 'loss' : 'win') : 'push';
  };
  switch (market) {
    case 'match_winner':
      return (selection === 'home') === t.sH > t.sA ? 'win' : 'loss';
    case 'game_handicap': {
      if (line == null) return 'void';
      const margin = t.gH - t.gA + line;
      const homeSide = margin > 0 ? 'win' : margin < 0 ? 'loss' : 'push';
      if (selection === 'home') return homeSide;
      return homeSide === 'win' ? 'loss' : homeSide === 'loss' ? 'win' : 'push';
    }
    case 'total_games':
      return ou(t.gH + t.gA, selection === 'over' ? 'over' : 'under');
    case 'games_won': {
      const [who, side] = selection.split(' ') as ['home' | 'away', 'over' | 'under'];
      return ou(who === 'home' ? t.gH : t.gA, side);
    }
    case 'win_a_set': {
      const [who, yesNo] = selection.split(' ') as ['home' | 'away', 'yes' | 'no'];
      const won = (who === 'home' ? t.sH : t.sA) >= 1;
      return won === (yesNo === 'yes') ? 'win' : 'loss';
    }
  }
}

export function gradeSelection(market: LogMarket, line: number | null, selection: string, outcome: MatchOutcome): Grade {
  if (outcome.status === 'walkover' || !outcome.sets.length) return 'void';
  const done = outcome.status === 'completed' ? outcome.sets : outcome.sets.filter(setDone);
  const sH = done.filter((s) => s.home > s.away).length;
  const sA = done.filter((s) => s.away > s.home).length;
  const gH = outcome.sets.reduce((a, s) => a + s.home, 0);
  const gA = outcome.sets.reduce((a, s) => a + s.away, 0);
  if (outcome.status === 'completed') return gradeCompleted(market, line, selection, { gH, gA, sH, sA });
  // Ended early: decided only once the count is already past the line, or the set already won.
  const early = (value: number, side: 'over' | 'under'): Grade => (line != null && value > line ? (side === 'over' ? 'win' : 'loss') : 'void');
  switch (market) {
    case 'match_winner':
    case 'game_handicap':
      return 'void';
    case 'total_games':
      return early(gH + gA, selection === 'over' ? 'over' : 'under');
    case 'games_won': {
      const [who, side] = selection.split(' ') as ['home' | 'away', 'over' | 'under'];
      return early(who === 'home' ? gH : gA, side);
    }
    case 'win_a_set': {
      const [who, yesNo] = selection.split(' ') as ['home' | 'away', 'yes' | 'no'];
      return (who === 'home' ? sH : sA) >= 1 ? (yesNo === 'yes' ? 'win' : 'loss') : 'void';
    }
  }
}
