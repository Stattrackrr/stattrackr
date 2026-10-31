/**
 * Grading a logged selection from the match's per-set scores (spec section 13), house rule `house-v1`:
 * completed matches settle normally; on a retirement or default a selection already won stands, one that
 * can no longer win is a loss, and anything still open is void; a walkover voids everything.
 * Every grade is `rule_unverified` until the posted book's own rules are verified (book_void_rules).
 */

import type { LogMarket } from './quotes';

export const GRADER_VERSION = 'house-v1';

export type SetScore = { home: number; away: number; tiebreak?: number | null };
export type MatchOutcome = { status: 'completed' | 'retired' | 'default' | 'walkover'; sets: SetScore[] };
export type Grade = 'win' | 'loss' | 'push' | 'void';

const setDone = (s: SetScore) => (s.home >= 6 || s.away >= 6) && (Math.abs(s.home - s.away) >= 2 || s.home === 7 || s.away === 7);

export function gradeSelection(market: LogMarket, line: number | null, selection: string, outcome: MatchOutcome): Grade {
  if (outcome.status === 'walkover' || !outcome.sets.length) return 'void';
  const done = outcome.status === 'completed' ? outcome.sets : outcome.sets.filter(setDone);
  const setsHome = done.filter((s) => s.home > s.away).length;
  const setsAway = done.filter((s) => s.away > s.home).length;
  const gHome = outcome.sets.reduce((a, s) => a + s.home, 0);
  const gAway = outcome.sets.reduce((a, s) => a + s.away, 0);
  const finished = outcome.status === 'completed';
  const ou = (value: number, side: 'over' | 'under'): Grade => {
    if (line == null) return 'void';
    if (finished) return value > line ? (side === 'over' ? 'win' : 'loss') : value < line ? (side === 'over' ? 'loss' : 'win') : 'push';
    // Ended early: decided only once the count is already past the line.
    if (value > line) return side === 'over' ? 'win' : 'loss';
    return 'void';
  };
  switch (market) {
    case 'match_winner': {
      if (!finished) return 'void';
      const homeWon = setsHome > setsAway;
      return (selection === 'home') === homeWon ? 'win' : 'loss';
    }
    case 'game_handicap': {
      if (!finished || line == null) return 'void';
      const margin = gHome - gAway + line;
      const homeSide = margin > 0 ? 'win' : margin < 0 ? 'loss' : 'push';
      if (selection === 'home') return homeSide;
      return homeSide === 'win' ? 'loss' : homeSide === 'loss' ? 'win' : 'push';
    }
    case 'total_games':
      return ou(gHome + gAway, selection === 'over' ? 'over' : 'under');
    case 'games_won': {
      const [who, side] = selection.split(' ') as ['home' | 'away', 'over' | 'under'];
      return ou(who === 'home' ? gHome : gAway, side);
    }
    case 'win_a_set': {
      const [who, yesNo] = selection.split(' ') as ['home' | 'away', 'yes' | 'no'];
      const won = (who === 'home' ? setsHome : setsAway) >= 1;
      if (won) return yesNo === 'yes' ? 'win' : 'loss';
      return finished ? (yesNo === 'yes' ? 'loss' : 'win') : 'void';
    }
  }
}
