/**
 * Tunable knobs for the AI picks models. These are the starting values; the learning loop
 * stores adjusted copies per sport in ai_learning_state and the active version wins.
 */

import { isNblPropMarket } from '@/lib/aiPicks/markets';

export type AiSportParams = {
  /** Weight on our model vs the de-vigged market (0 = pure market, 1 = pure model). */
  modelWeight: Record<string, number>;
  /** Minimum EV per unit for a single. */
  minEvSingle: number;
  /** Minimum EV per unit for a multi leg. */
  minEvLeg: number;
  /** Minimum weighted hit rate on the side ("support") for a player prop. */
  minSupport: number;
  /** Model vs market gap that is treated as a data problem, not an edge. */
  maxModelMarketGap: number;
  /** EV per unit above this is almost always bad data (stale or mislabeled price). */
  maxTrustedEv: number;
  /** Games of history for the model weight to reach half its value. */
  sampleHalfLife: number;
  /** Highest price allowed as a single / as one leg of a multi. */
  maxPriceSingle: number;
  maxPriceLeg: number;
  /**
   * One-way prices (milestones) carry a bigger margin on long shots. Fair = implied^power,
   * then capped at the implied price.
   */
  oneWayMarginPower: number;
  /** A play that keeps qualifying is posted once its game is this close (earlier if the price starts shortening). */
  postWindowHours: number;
  /**
   * Normal singles per sport in any rolling 24 hours (name kept for stored learning state).
   * Standout edges may go past it up to MAX_SINGLES_CEILING. Fewer is fine; nothing is forced.
   */
  maxSinglesPerDay: number;
  /** Learned stake multiplier per market group (see modelGroup); missing means 1. */
  stakeScale: Record<string, number>;
  /**
   * How hard game-specific context moves the model (NBL: matchup, pace, teammates out, rest;
   * tennis: Elo, ranking, fatigue). 1 = as built, 0 = logs/serve stats only.
   */
  contextStrength: number;
};

export type AiStakingParams = {
  /** Share of full Kelly staked. */
  kellyFraction: number;
  /** Bankroll share one unit stands for. */
  unitShare: number;
  /** Settled picks a sport needs before it may stake above rampMaxUnits. */
  rampPicks: number;
  rampMaxUnits: number;
  multiMaxUnits: number;
  /** Recent ROI below this (over at least drawdownMinPicks) drops stakes to 1 unit. */
  drawdownRoi: number;
  drawdownMinPicks: number;
};

export type AiTennisParams = AiSportParams & {
  /**
   * Match-to-match swing in each player's serve-point rate. Independent points alone overstate
   * deciding sets and long matches; good and bad days put real three-setters near 35%.
   */
  dayForm: number;
};

export type AiPicksParams = {
  /** Active ai_learning_state version per sport; 0 = these defaults. */
  versions: { nbl: number; nba: number; tennis: number };
  nbl: AiSportParams;
  nba: AiSportParams;
  tennis: AiTennisParams;
  staking: AiStakingParams;
};

export const DEFAULT_AI_PICKS_PARAMS: AiPicksParams = {
  versions: { nbl: 0, nba: 0, tennis: 0 },
  staking: {
    kellyFraction: 0.25,
    unitShare: 0.01,
    rampPicks: 30,
    rampMaxUnits: 1.5,
    multiMaxUnits: 1,
    drawdownRoi: -0.15,
    drawdownMinPicks: 20,
  },
  nbl: {
    modelWeight: { prop: 0.45, milestone: 0.45, h2h: 0.25, spread: 0.25, total: 0.25 },
    minEvSingle: 0.03,
    minEvLeg: 0.02,
    minSupport: 0.55,
    maxModelMarketGap: 0.18,
    maxTrustedEv: 0.25,
    sampleHalfLife: 8,
    maxPriceSingle: 3.5,
    maxPriceLeg: 2.6,
    oneWayMarginPower: 1.08,
    postWindowHours: 6,
    maxSinglesPerDay: 3,
    stakeScale: {},
    contextStrength: 1,
  },
  /**
   * NBA markets are sharper than NBL's: lower model weights (game lines lowest; the ratings model
   * misses the margin by 14 points against the market's ~13), a tighter gap and EV ceiling.
   * Singles are limited per game (see MAX_NBA_SINGLES_PER_GAME), not per day.
   */
  nba: {
    modelWeight: { prop: 0.35, milestone: 0.35, h2h: 0.15, spread: 0.15, total: 0.15, doubleDouble: 0.35, tripleDouble: 0.3 },
    minEvSingle: 0.03,
    minEvLeg: 0.02,
    minSupport: 0.55,
    maxModelMarketGap: 0.15,
    maxTrustedEv: 0.2,
    sampleHalfLife: 10,
    maxPriceSingle: 3.5,
    maxPriceLeg: 2.6,
    oneWayMarginPower: 1.08,
    postWindowHours: 6,
    maxSinglesPerDay: 3,
    stakeScale: {},
    contextStrength: 1,
  },
  tennis: {
    modelWeight: {
      match_winner: 0.3,
      game_handicap: 0.35,
      total_games: 0.4,
      player_games: 0.4,
      total_sets: 0.35,
      player_sets: 0.3,
      win_a_set: 0.35,
    },
    minEvSingle: 0.03,
    minEvLeg: 0.02,
    minSupport: 0.5,
    maxModelMarketGap: 0.15,
    maxTrustedEv: 0.25,
    sampleHalfLife: 10,
    maxPriceSingle: 3.5,
    maxPriceLeg: 2.6,
    oneWayMarginPower: 1.08,
    postWindowHours: 8,
    maxSinglesPerDay: 3,
    stakeScale: {},
    contextStrength: 1,
    dayForm: 0.065,
  },
};

/** Key into modelWeight and stakeScale: basketball props split main vs milestone, everything else by market. */
export function modelGroup(c: { sport: string; market: string; marketKind: string }): string {
  if ((c.sport === 'nbl' || c.sport === 'nba') && isNblPropMarket(c.market)) return c.marketKind === 'milestone' ? 'milestone' : 'prop';
  return c.market;
}

/** The sport's params block; anything that is not NBA or tennis is NBL. */
export function paramsForSport(params: AiPicksParams, sport: string): AiSportParams {
  return sport === 'tennis' ? params.tennis : sport === 'nba' ? params.nba : params.nbl;
}

export function modelVersion(params: AiPicksParams, sports: string[]): string {
  return [...new Set(sports)]
    .sort()
    .map((s) => `${s} v${params.versions[s as keyof AiPicksParams['versions']] ?? 0}`)
    .join(' / ');
}

/** A stored sport params blob over the defaults, so fields added later still get values. */
export function mergeSportParams<T extends AiSportParams>(defaults: T, stored: unknown): T {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<T>;
  return {
    ...defaults,
    ...s,
    modelWeight: { ...defaults.modelWeight, ...(s.modelWeight ?? {}) },
    stakeScale: { ...defaults.stakeScale, ...(s.stakeScale ?? {}) },
  };
}

/** Model weight after shrinking for a thin sample: half the weight at `sampleHalfLife` games. */
export function effectiveModelWeight(base: number, sampleSize: number, halfLife: number): number {
  const n = Math.max(0, sampleSize);
  return base * (n / (n + Math.max(1, halfLife)));
}
