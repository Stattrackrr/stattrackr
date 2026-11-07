/**
 * Pure pricing helpers for the tools board.
 * Fair probabilities reuse tennis log power de-vig (DEFAULT_DEVIG).
 */

import { DEFAULT_DEVIG, devigTwoWay } from '@/lib/tennis/log/devig';

/** Implied stake split for a $1000 two-way arb; null when not an arb. */
export function arbStakes(
  oddsA: number,
  oddsB: number,
  bankroll = 1000
): { stakeA: number; stakeB: number; profit: number; roi: number } | null {
  if (!(oddsA > 1 && oddsB > 1)) return null;
  const inv = 1 / oddsA + 1 / oddsB;
  if (!(inv > 0 && inv < 1)) return null;
  const stakeA = (bankroll * (1 / oddsA)) / inv;
  const stakeB = (bankroll * (1 / oddsB)) / inv;
  const payout = stakeA * oddsA;
  const profit = payout - bankroll;
  return {
    stakeA: round2(stakeA),
    stakeB: round2(stakeB),
    profit: round2(profit),
    roi: profit / bankroll,
  };
}

/**
 * Bonus bet at o1 (stake not returned), hedge cash at o2:
 *   H = B(o1-1)/o2
 *   locked cash = B(o1-1)(o2-1)/o2
 */
export function bonusFlip(bonus: number, bonusOdds: number, hedgeOdds: number): { hedge: number; cashOut: number; retention: number } | null {
  if (!(bonus > 0 && bonusOdds > 1 && hedgeOdds > 1)) return null;
  const hedge = (bonus * (bonusOdds - 1)) / hedgeOdds;
  const cashOut = bonus * ((bonusOdds - 1) * (hedgeOdds - 1)) / hedgeOdds;
  return { hedge: round2(hedge), cashOut: round2(cashOut), retention: cashOut / bonus };
}

/** Soft decimal vs fair probability → EV fraction (fair * odds - 1). */
export function evFraction(softOdds: number, fairProb: number): number | null {
  if (!(softOdds > 1 && fairProb > 0 && fairProb < 1)) return null;
  return fairProb * softOdds - 1;
}

/**
 * Guard against flipped sharp/soft sides (fair ~1.02 with soft 19 → thousand-% EV).
 * Soft price must be in a believable band around fair odds.
 */
export function saneEv(softOdds: number, fairProb: number, edge: number): boolean {
  if (!(softOdds > 1 && fairProb > 0 && fairProb < 1)) return false;
  if (!(edge >= 0) || edge > 0.25) return false; // >25% EV is almost always bad data
  const fairOdds = 1 / fairProb;
  // Soft longer than ~1.4× fair on a short price, or any soft >3× fair → side mismatch.
  if (softOdds > fairOdds * 1.4 + 0.05) return false;
  if (softOdds > fairOdds * 3) return false;
  return true;
}

/** Average power de-vig of sharp two-way pairs → fair probs for [sideA, sideB]. */
export function sharpFairProbs(pairs: Array<[number, number]>): [number, number] | null {
  const ps: number[] = [];
  for (const [a, b] of pairs) {
    const d = devigTwoWay(a, b);
    if (!d) continue;
    ps.push(d[DEFAULT_DEVIG][0]);
  }
  if (!ps.length) return null;
  const pA = ps.reduce((s, p) => s + p, 0) / ps.length;
  return [pA, 1 - pA];
}

/** Two totals/handicaps form a middle when the over line is strictly below the under line. */
export function middleWindow(overLine: number, underLine: number): { low: number; high: number } | null {
  if (!(Number.isFinite(overLine) && Number.isFinite(underLine))) return null;
  if (!(overLine < underLine)) return null;
  return { low: overLine, high: underLine };
}

/**
 * Equal $100 split across both middle legs.
 * One-sided outcomes usually lose a little; both winning = the collect.
 */
export function middleStakes(
  oddsA: number,
  oddsB: number,
  bankroll = 100
): { stakeA: number; stakeB: number; riskLoss: number; middleCollect: number } | null {
  if (!(oddsA > 1 && oddsB > 1 && bankroll > 0)) return null;
  const stakeA = round2(bankroll / 2);
  const stakeB = round2(bankroll - stakeA);
  const onlyA = round2(stakeA * oddsA - bankroll);
  const onlyB = round2(stakeB * oddsB - bankroll);
  const worst = Math.min(onlyA, onlyB);
  const middleCollect = round2(stakeA * oddsA + stakeB * oddsB - bankroll);
  return {
    stakeA,
    stakeB,
    riskLoss: round2(Math.max(0, -worst)),
    middleCollect,
  };
}

/**
 * Rank middles by expected $ on a $100 stake.
 * Window width proxies hit chance (tight low-risk middles are usually least likely).
 * missMass ≈ typical points landing outside the window.
 */
export function middleExpected(
  width: number,
  riskLoss: number,
  middleProfit: number,
  missMass = 5
): { hitProb: number; expected: number } | null {
  if (!(width > 0 && Number.isFinite(riskLoss) && Number.isFinite(middleProfit))) return null;
  const hitProb = width / (width + Math.max(missMass, 0.5));
  const expected = round2(hitProb * middleProfit - (1 - hitProb) * Math.max(riskLoss, 0));
  return { hitProb, expected };
}

export function isHalfLine(line: number | null | undefined): boolean {
  if (line == null || !Number.isFinite(line)) return true;
  return Math.abs((line * 2) % 2) === 1 || Math.abs(Math.abs(line % 1) - 0.5) < 1e-9;
}

/** Reject absurd cross-market pairs (stale / mismatched). */
export function saneTwoWay(oddsA: number, oddsB: number, minInv = 0.93): boolean {
  if (!(oddsA > 1 && oddsB > 1)) return false;
  const inv = 1 / oddsA + 1 / oddsB;
  return inv >= minInv && inv < 1.15;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pctLabel(fraction: number, digits = 1): string {
  const sign = fraction >= 0 ? '+' : '';
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}
