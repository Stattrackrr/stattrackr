/**
 * Closing line value for the market-anchored NBA model (agreed build spec, section 5). The closing
 * fair price is converted to the bet's own line with a negative binomial of fixed size k, so a line
 * that moved between bet and close is still compared like for like. Same-line half-point bets do not
 * depend on k at all, so they are the cleanest evidence.
 */

import { countSideProbs, type SideProbs } from '@/lib/aiPicks/model/math';

/** Negative binomial size from a projection's spread: variance = mean + mean^2 / k (Poisson when not over-dispersed). */
export function sizeFromSpread(mean: number, variance: number): number {
  return variance <= mean * 1.0001 ? Number.POSITIVE_INFINITY : (mean * mean) / (variance - mean);
}

/** Over, under and push at line L for a count with this mean and size. */
export function probsAt(mean: number, k: number, line: number): SideProbs {
  const variance = Number.isFinite(k) ? mean + (mean * mean) / k : mean;
  return countSideProbs(mean, variance, line);
}

/** The mean at which the push-excluded P(over) at `line` equals `fairOver`. */
export function solveMeanForFair(fairOver: number, k: number, line: number): number {
  let lo = 0.05;
  let hi = Math.max(200, line * 4);
  for (let i = 0; i < 70; i += 1) {
    const mid = (lo + hi) / 2;
    const p = probsAt(mid, k, line);
    if (p.over / Math.max(1e-12, p.over + p.under) < fairOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A fair price quoted at one line, carried to another line. */
export function fairAtLine(fairOver: number, fromLine: number, toLine: number, k: number): SideProbs {
  if (fromLine === toLine && !Number.isInteger(toLine)) return { over: fairOver, under: 1 - fairOver, push: 0 };
  return probsAt(solveMeanForFair(fairOver, k, fromLine), k, toLine);
}

export type ClvInput = {
  side: 'over' | 'under';
  price: number;
  line: number;
  /** De-vigged consensus P(over) at decision time (bet book excluded) and its line. */
  fairNow: number;
  lineNow: number;
  /** De-vigged consensus P(over) at close (bet book excluded) and its line. */
  fairClose: number;
  lineClose: number;
  k: number;
};

/**
 * Total CLV and its two parts, which add up exactly:
 *   a: the price against the fair at decision time (line shopping and winner's curse),
 *   b: the fair moving from decision to close (information and timing).
 * A push refunds the stake.
 */
export function clvSplit(x: ClvInput): { total: number; a: number; b: number } {
  const now = fairAtLine(x.fairNow, x.lineNow, x.line, x.k);
  const close = fairAtLine(x.fairClose, x.lineClose, x.line, x.k);
  const win = (p: SideProbs) => (x.side === 'over' ? p.over : p.under);
  const a = win(now) * x.price + now.push - 1;
  const total = win(close) * x.price + close.push - 1;
  return { total, a, b: total - a };
}
