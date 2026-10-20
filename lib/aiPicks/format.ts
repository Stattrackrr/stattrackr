import { isNbaAchievementMarket } from '@/lib/aiPicks/markets';
import type { AiPickLeg } from '@/lib/aiPicks/types';

export const AI_MARKET_LABELS: Record<string, string> = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  threeMade: 'threes made',
  pra: 'pts + reb + ast',
  pr: 'pts + reb',
  pa: 'pts + ast',
  ra: 'reb + ast',
  doubleDouble: 'double-double',
  tripleDouble: 'triple-double',
  h2h: 'to win',
  spread: 'line',
  total: 'total points',
  match_winner: 'to win',
  game_handicap: 'games handicap',
  total_games: 'total games',
  player_games: 'games won',
  total_sets: 'total sets',
  player_sets: 'sets won',
  win_a_set: 'to win a set',
};

type LegLike = Pick<AiPickLeg, 'sport' | 'market' | 'marketKind' | 'player' | 'team' | 'side' | 'line'>;

/** Who the selection is on. Tennis `team` is the opponent; for NBL game lines it is the side backed. */
export function legSubject(leg: LegLike): string {
  return leg.sport === 'tennis' ? leg.player || '' : leg.player || leg.team || '';
}

export function legSelection(leg: LegLike): string {
  const market = AI_MARKET_LABELS[leg.market] ?? leg.market;
  const who = legSubject(leg);
  if (isNbaAchievementMarket(leg.market)) return `${who} to record a ${market}`.trim();
  if (leg.side === 'over' || leg.side === 'under') {
    if (leg.marketKind === 'milestone' && leg.line != null) return `${who} ${Math.ceil(leg.line)}+ ${market}`.trim();
    return `${who} ${leg.side} ${leg.line ?? ''} ${market}`.replace(/\s+/g, ' ').trim();
  }
  if (leg.line != null && (leg.market === 'spread' || leg.market === 'game_handicap')) {
    return `${who} ${leg.line > 0 ? '+' : ''}${leg.line} ${market}`.trim();
  }
  if (leg.side === 'no') return `${who} not ${market}`.trim();
  return `${who} ${market}`.trim();
}

/** The bet without who it is on, e.g. "Over 9.5 games won", "+6.5 games handicap", "To win". */
export function legBet(leg: LegLike): string {
  const market = AI_MARKET_LABELS[leg.market] ?? leg.market;
  let bet: string;
  if (isNbaAchievementMarket(leg.market)) {
    bet = `to record a ${market}`;
  } else if (leg.side === 'over' || leg.side === 'under') {
    bet =
      leg.marketKind === 'milestone' && leg.line != null
        ? `${Math.ceil(leg.line)}+ ${market}`
        : `${leg.side} ${leg.line ?? ''} ${market}`;
  } else if (leg.line != null && (leg.market === 'spread' || leg.market === 'game_handicap')) {
    bet = `${leg.line > 0 ? '+' : ''}${leg.line} ${market}`;
  } else if (leg.side === 'no') {
    bet = `not ${market}`;
  } else {
    bet = market;
  }
  bet = bet.replace(/\s+/g, ' ').trim();
  return bet.charAt(0).toUpperCase() + bet.slice(1);
}

/** Selection with the match named when the bet is on the match itself (totals). */
export function legTitle(leg: LegLike & Pick<AiPickLeg, 'eventLabel'>): string {
  const sel = legSelection(leg);
  return legSubject(leg) ? sel : `${leg.eventLabel}: ${sel}`;
}

export function pickTitle(legs: Array<LegLike & Pick<AiPickLeg, 'eventLabel'>>): string {
  return legs.map(legTitle).join(' + ');
}
