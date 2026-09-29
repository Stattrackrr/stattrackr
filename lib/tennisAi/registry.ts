import type { MarketDefinition, MarketKey } from '@/lib/tennisAi/types';

export const MARKET_REGISTRY: Record<MarketKey, MarketDefinition> = {
  MATCH_WINNER: {
    key: 'MATCH_WINNER',
    name: 'Match winner',
    description: 'Who wins the match.',
    model: 'ensemble',
    stats: ['Hold %', 'Return pts won %', 'Elo'],
  },
  SET_BETTING: {
    key: 'SET_BETTING',
    name: 'Set betting',
    description: 'Correct set score.',
    model: 'simulation',
    stats: ['Hold %', 'Return pts won %'],
  },
  FIRST_SET_WINNER: {
    key: 'FIRST_SET_WINNER',
    name: 'First set winner',
    description: 'Who takes the opening set.',
    model: 'simulation',
    stats: ['Hold %', 'First-set win %'],
  },
  TOTAL_GAMES: {
    key: 'TOTAL_GAMES',
    name: 'Total games',
    description: 'Over or under the match game total.',
    model: 'simulation',
    stats: ['Hold %', 'Return pts won %'],
  },
  GAME_HANDICAP: {
    key: 'GAME_HANDICAP',
    name: 'Game handicap',
    description: 'Covering a games spread.',
    model: 'simulation',
    stats: ['Hold %', 'Return pts won %'],
  },
  SET_HANDICAP: {
    key: 'SET_HANDICAP',
    name: 'Set handicap',
    description: 'Covering a sets spread.',
    model: 'simulation',
    stats: ['Hold %'],
  },
  PLAYER_TOTAL_GAMES: {
    key: 'PLAYER_TOTAL_GAMES',
    name: 'Player games',
    description: 'Games won by one player.',
    model: 'simulation',
    stats: ['Hold %', 'Return pts won %'],
  },
  FIRST_SET_TOTAL_GAMES: {
    key: 'FIRST_SET_TOTAL_GAMES',
    name: 'First set games',
    description: 'Games in the first set.',
    model: 'simulation',
    stats: ['Hold %'],
  },
  TIEBREAK_IN_MATCH: {
    key: 'TIEBREAK_IN_MATCH',
    name: 'Tiebreak',
    description: 'Whether any set reaches a tiebreak.',
    model: 'simulation',
    stats: ['Hold %', 'Tiebreak frequency'],
  },
  TOTAL_ACES: {
    key: 'TOTAL_ACES',
    name: 'Total aces',
    description: 'Aces by both players.',
    model: 'count',
    stats: ['Aces per service game'],
  },
  PLAYER_ACES: {
    key: 'PLAYER_ACES',
    name: 'Player aces',
    description: 'Aces by one player.',
    model: 'count',
    stats: ['Aces per service game'],
  },
  PLAYER_DOUBLE_FAULTS: {
    key: 'PLAYER_DOUBLE_FAULTS',
    name: 'Double faults',
    description: 'Double faults by one player.',
    model: 'count',
    stats: ['Double faults per service game'],
  },
  TOTAL_SETS: {
    key: 'TOTAL_SETS',
    name: 'Total sets',
    description: 'How many sets are played.',
    model: 'simulation',
    stats: ['Hold %'],
  },
  WIN_A_SET: {
    key: 'WIN_A_SET',
    name: 'To win a set',
    description: 'A player wins at least one set.',
    model: 'simulation',
    stats: ['Hold %'],
  },
  BREAKS_OF_SERVE: {
    key: 'BREAKS_OF_SERVE',
    name: 'Breaks of serve',
    description: 'Breaks in the match.',
    model: 'unmodelled',
    stats: [],
  },
};

export function marketDefinition(key: string): MarketDefinition | null {
  return Object.prototype.hasOwnProperty.call(MARKET_REGISTRY, key)
    ? MARKET_REGISTRY[key as MarketKey]
    : null;
}
