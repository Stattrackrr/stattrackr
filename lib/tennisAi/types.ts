export type MarketKey =
  | 'MATCH_WINNER'
  | 'SET_BETTING'
  | 'FIRST_SET_WINNER'
  | 'TOTAL_GAMES'
  | 'GAME_HANDICAP'
  | 'SET_HANDICAP'
  | 'PLAYER_TOTAL_GAMES'
  | 'FIRST_SET_TOTAL_GAMES'
  | 'TIEBREAK_IN_MATCH'
  | 'TOTAL_ACES'
  | 'PLAYER_ACES'
  | 'PLAYER_DOUBLE_FAULTS'
  | 'TOTAL_SETS'
  | 'WIN_A_SET'
  | 'BREAKS_OF_SERVE';

export type MarketModel = 'simulation' | 'ensemble' | 'count' | 'unmodelled';

export type SelectionSide = 'PLAYER' | 'OPPONENT' | 'OVER' | 'UNDER' | 'YES' | 'NO' | string;

export type MarketDefinition = {
  key: MarketKey;
  name: string;
  description: string;
  model: MarketModel;
  /** Stats the answer is allowed to quote for this market. */
  stats: string[];
};

export type BookQuote = {
  book: string;
  decimalOdds: number;
  fetchedAt: string | null;
};

export type AvailableMarket = {
  key: MarketKey;
  name: string;
  selection: SelectionSide;
  /** Other side required to remove the margin. */
  opposite: SelectionSide;
  line: number | null;
  /** Set-betting label such as "2-1", when selection is a score. */
  score: string | null;
  model: MarketModel;
  priceable: boolean;
  stale: boolean;
  /** The line the tennis chart opens on. Questions may only use these. */
  featured: boolean;
  quotes: BookQuote[];
  oppositeQuotes: BookQuote[];
  best: BookQuote | null;
  bestOpposite: BookQuote | null;
};

export type ConfidenceTier = 'Strong value' | 'Lean' | 'No edge' | 'Insufficient data';

export type PricedSelection = {
  market: AvailableMarket;
  modelProb: number | null;
  low: number | null;
  high: number | null;
  pushProb: number;
  fairProb: number | null;
  impliedRaw: number | null;
  edgePct: number | null;
  evPct: number | null;
  conservativeEvPct: number | null;
  kellyPct: number | null;
  tier: ConfidenceTier;
  needsReview: boolean;
  backtestApproved: boolean;
  warnings: string[];
};

export type StatComparison = {
  stat: string;
  player: number | null;
  opponent: number | null;
  note: string;
};

export type AnswerPayload = {
  question: {
    text: string;
    market_key: MarketKey | null;
    selection: string | null;
    line: number | null;
  };
  match: {
    player: string;
    opponent: string;
    surface: string;
    format: string;
    tournament: string;
  };
  market: {
    key: MarketKey | null;
    selection: string | null;
    line: number | null;
    best_odds: number | null;
    best_book: string | null;
    opposite_odds: number | null;
    selected_odds: number | null;
  } | null;
  model: { prob: number | null; interval: [number, number] | null };
  push_prob: number;
  needs_review: boolean;
  market_fair_prob: number | null;
  edge_pct: number | null;
  ev_pct: number | null;
  conservative_ev_pct: number | null;
  confidence_tier: ConfidenceTier;
  backtest: {
    approved: boolean;
    n_bets: number;
    clv_pct: number | null;
    calibration_note: string;
  };
  stat_comparison: StatComparison[];
  form: {
    playerSurfaceWins: number;
    playerSurfaceLosses: number;
    playerSurfaceN: number;
    playerSurfaceLast10Wins: number;
    playerSurfaceLast10Losses: number;
    playerSurfaceLast10N: number;
    playerLast10Wins: number;
    playerLast10Losses: number;
    playerLast10N: number;
    opponentSurfaceWins: number;
    opponentSurfaceLosses: number;
    opponentSurfaceN: number;
    opponentSurfaceLast10Wins: number;
    opponentSurfaceLast10Losses: number;
    opponentSurfaceLast10N: number;
    opponentLast10Wins: number;
    opponentLast10Losses: number;
    opponentLast10N: number;
    h2hWins: number;
    h2hPlayed: number;
  };
  context_flags: string[];
  warnings: string[];
  stake_pct: number | null;
  footer: string;
  quoted: {
    prob_pct: number | null;
    fair_pct: number | null;
    low_pct: number | null;
    high_pct: number | null;
    odds: number | null;
    odds_label: string | null;
  };
};
