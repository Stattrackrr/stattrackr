import type { AiPickLeg, AiPickStatus } from '@/lib/aiPicks/types';
import type { NblPropMarket } from '@/lib/aiPicks/markets';

export type LegGrade = {
  status: Exclude<AiPickStatus, 'pending'>;
  value: number | null;
  note: string;
};

/** Over/under on a stat. Landing exactly on a whole line is a push. */
export function gradeOverUnder(value: number, line: number, side: AiPickLeg['side']): LegGrade['status'] {
  if (value === line) return 'push';
  const over = value > line;
  if (side === 'over') return over ? 'win' : 'loss';
  if (side === 'under') return over ? 'loss' : 'win';
  throw new Error(`over/under leg has side ${side}`);
}

/** Handicap on a margin (selected side's score minus the other side's). */
export function gradeHandicap(margin: number, line: number): LegGrade['status'] {
  const covered = margin + line;
  if (covered === 0) return 'push';
  return covered > 0 ? 'win' : 'loss';
}

export type NblBoxValues = {
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threeMade: number | null;
};

export function nblPropValue(market: NblPropMarket, box: NblBoxValues): number | null {
  const { points, rebounds, assists } = box;
  const sum = (...xs: Array<number | null>) => (xs.every((x) => x != null) ? xs.reduce<number>((a, x) => a + x!, 0) : null);
  switch (market) {
    case 'points':
      return points;
    case 'rebounds':
      return rebounds;
    case 'assists':
      return assists;
    case 'threeMade':
      return box.threeMade;
    case 'pra':
      return sum(points, rebounds, assists);
    case 'pr':
      return sum(points, rebounds);
    case 'pa':
      return sum(points, assists);
    case 'ra':
      return sum(rebounds, assists);
  }
}

/** A player who never got on court is a DNP: the leg is void. */
export function gradeNblProp(leg: Pick<AiPickLeg, 'side' | 'line'>, market: NblPropMarket, box: NblBoxValues | null): LegGrade {
  if (!box || !box.minutes) return { status: 'void', value: null, note: 'Did not play' };
  const value = nblPropValue(market, box);
  if (value == null || leg.line == null) return { status: 'void', value: null, note: 'Stat missing from the box score' };
  return { status: gradeOverUnder(value, leg.line, leg.side), value, note: `${value} ${market}` };
}

export function gradeNblGame(
  leg: Pick<AiPickLeg, 'market' | 'side' | 'line'>,
  homeScore: number,
  awayScore: number
): LegGrade {
  const final = `${homeScore}-${awayScore}`;
  if (leg.market === 'total') {
    if (leg.line == null) return { status: 'void', value: null, note: 'No line' };
    const total = homeScore + awayScore;
    return { status: gradeOverUnder(total, leg.line, leg.side), value: total, note: `Final ${final}, total ${total}` };
  }
  if (leg.side !== 'home' && leg.side !== 'away') throw new Error(`${leg.market} leg has side ${leg.side}`);
  const margin = leg.side === 'home' ? homeScore - awayScore : awayScore - homeScore;
  if (leg.market === 'h2h') {
    return { status: margin > 0 ? 'win' : margin < 0 ? 'loss' : 'push', value: margin, note: `Final ${final}` };
  }
  if (leg.market === 'spread') {
    if (leg.line == null) return { status: 'void', value: null, note: 'No line' };
    return { status: gradeHandicap(margin, leg.line), value: margin, note: `Final ${final}, margin ${margin > 0 ? '+' : ''}${margin}` };
  }
  throw new Error(`unknown NBL game market ${leg.market}`);
}

export type TennisResult = {
  won: boolean;
  gamesWon: number;
  gamesLost: number;
  setsWon: number;
  setsLost: number;
  score: string;
};

export const TENNIS_HOUSE_RULE_NOTE = 'house rule, provisional until book rules are verified';

const setComplete = (a: number, b: number) => (a >= 6 || b >= 6) && (Math.abs(a - b) >= 2 || a === 7 || b === 7);

/**
 * A match that ended early (retirement, default, abandonment) under the house rule: a bet the play
 * had already decided stands, anything still open is void. Sets are from the leg player's view,
 * including the unfinished one.
 */
export function gradeTennisUnfinished(
  leg: Pick<AiPickLeg, 'market' | 'side' | 'line'>,
  sets: Array<{ playerGames: number; opponentGames: number }>,
  score: string
): LegGrade {
  const done = sets.filter((s) => setComplete(s.playerGames, s.opponentGames));
  const setsWon = done.filter((s) => s.playerGames > s.opponentGames).length;
  const setsStarted = done.length + (sets.length > done.length ? 1 : 0);
  const games = sets.reduce((a, s) => a + s.playerGames + s.opponentGames, 0);
  const playerGames = sets.reduce((a, s) => a + s.playerGames, 0);
  const note = `Ended early ${score} (${TENNIS_HOUSE_RULE_NOTE})`;
  const voided: LegGrade = { status: 'void', value: null, note: `Not decided before the match ended: ${score} (${TENNIS_HOUSE_RULE_NOTE})` };
  const overDecided = (value: number): LegGrade => {
    if (leg.line == null || !(value > leg.line)) return voided;
    return { status: leg.side === 'over' ? 'win' : 'loss', value, note };
  };
  switch (leg.market) {
    case 'win_a_set':
      return setsWon >= 1 ? { status: leg.side === 'yes' ? 'win' : 'loss', value: setsWon, note } : voided;
    case 'total_games':
      return overDecided(games);
    case 'player_games':
      return overDecided(playerGames);
    case 'total_sets':
      return overDecided(setsStarted);
    case 'player_sets':
      return overDecided(setsWon);
    default:
      return voided;
  }
}

export function gradeTennis(leg: Pick<AiPickLeg, 'market' | 'side' | 'line'>, r: TennisResult): LegGrade {
  const note = `${r.won ? 'Won' : 'Lost'} ${r.score}`;
  const yes = leg.side === 'yes';
  const yesNo = (hit: boolean): LegGrade['status'] => (hit === yes ? 'win' : 'loss');
  const ou = (value: number): LegGrade => {
    if (leg.line == null) return { status: 'void', value: null, note: 'No line' };
    return { status: gradeOverUnder(value, leg.line, leg.side), value, note };
  };
  switch (leg.market) {
    case 'match_winner':
      return { status: yesNo(r.won), value: r.won ? 1 : 0, note };
    case 'win_a_set':
      return { status: yesNo(r.setsWon >= 1), value: r.setsWon, note };
    case 'game_handicap': {
      if (leg.line == null) return { status: 'void', value: null, note: 'No line' };
      const margin = r.gamesWon - r.gamesLost;
      const status = gradeHandicap(margin, leg.line);
      return { status: yes ? status : status === 'win' ? 'loss' : status === 'loss' ? 'win' : status, value: margin, note };
    }
    case 'total_games':
      return ou(r.gamesWon + r.gamesLost);
    case 'player_games':
      return ou(r.gamesWon);
    case 'total_sets':
      return ou(r.setsWon + r.setsLost);
    case 'player_sets':
      return ou(r.setsWon);
  }
  throw new Error(`unknown tennis market ${leg.market}`);
}
