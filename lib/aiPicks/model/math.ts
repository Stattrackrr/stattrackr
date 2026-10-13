import { devig } from '@/lib/tennisAi/devig';

export type SideProbs = { over: number; under: number; push: number };

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function round(value: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

export function median(values: number[]): number | null {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/** Abramowitz–Stegun 7.1.26, |error| < 1.5e-7. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * P(X = 0..maxK) for a count with this mean and variance: negative binomial when
 * over-dispersed, Poisson otherwise.
 */
export function countPmf(mean: number, variance: number, maxK: number): number[] {
  const mu = Math.max(mean, 1e-6);
  const out: number[] = new Array(maxK + 1).fill(0);
  if (variance <= mu * 1.0001) {
    let p = Math.exp(-mu);
    out[0] = p;
    for (let k = 1; k <= maxK; k += 1) {
      p *= mu / k;
      out[k] = p;
    }
    return out;
  }
  const r = (mu * mu) / (variance - mu);
  const q = r / (r + mu);
  const base = logGamma(r);
  for (let k = 0; k <= maxK; k += 1) {
    out[k] = Math.exp(logGamma(k + r) - base - logGamma(k + 1) + r * Math.log(q) + k * Math.log(1 - q));
  }
  return out;
}

/** Over/under/push on a count line (whole lines can push). */
export function countSideProbs(mean: number, variance: number, line: number): SideProbs {
  const maxK = Math.max(10, Math.ceil(mean + 12 * Math.sqrt(Math.max(variance, mean, 1))), Math.ceil(line) + 5);
  const pmf = countPmf(mean, variance, maxK);
  let under = 0;
  let push = 0;
  for (let k = 0; k <= maxK; k += 1) {
    if (k < line) under += pmf[k]!;
    else if (k === line) push += pmf[k]!;
  }
  under = clamp(under, 0, 1);
  push = clamp(push, 0, 1 - under);
  return { over: Math.max(0, 1 - under - push), under, push };
}

/** Normal over/under on a continuous-ish total or margin (whole lines get a ±0.5 push band). */
export function normalSideProbs(mean: number, sd: number, line: number): SideProbs {
  const whole = Math.abs(line - Math.round(line)) < 1e-9;
  if (!whole) {
    const under = normalCdf((line - mean) / sd);
    return { over: 1 - under, under, push: 0 };
  }
  const under = normalCdf((line - 0.5 - mean) / sd);
  const over = 1 - normalCdf((line + 0.5 - mean) / sd);
  return { over, under, push: Math.max(0, 1 - over - under) };
}

/**
 * Mean for which P(over line) matches a target, holding the variance-to-mean ratio fixed.
 * Turns a market's fair price at its main line into a full market distribution.
 */
export function impliedCountMean(targetOver: number, line: number, dispersion: number): number {
  let lo = 0.05;
  let hi = Math.max(5, line * 3 + 10);
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const p = countSideProbs(mid, mid * dispersion, line);
    const overShare = p.over / Math.max(1e-9, p.over + p.under);
    if (overShare < targetOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Fair (no-margin) probability of each side from one book's two-way prices. */
export function fairTwoWay(priceA: number, priceB: number): [number, number] | null {
  if (!(priceA > 1) || !(priceB > 1)) return null;
  const [a, b] = devig([1 / priceA, 1 / priceB], 'power');
  return [a!, b!];
}

/**
 * A real two-way market's implied probabilities sum to a little over 1. Far outside that, one side
 * belongs to another market (mislabeled feed row), so neither price can be trusted.
 */
export function coherentPair(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!(a != null && a > 1 && b != null && b > 1)) return true;
  const book = 1 / a + 1 / b;
  return book >= 0.98 && book <= 1.16;
}

/** Fair probability from a one-way price: long shots lose proportionally more to the margin. */
export function fairOneWay(price: number, power: number): number | null {
  if (!(price > 1)) return null;
  const implied = 1 / price;
  return Math.min(implied, Math.pow(implied, power));
}

/** EV per unit staked. A push returns the stake. */
export function evPerUnit(winProb: number, price: number, pushProb = 0): number {
  const w = clamp(winProb, 0, 1);
  const p = clamp(pushProb, 0, 1 - w);
  return w * (price - 1) - (1 - w - p);
}

/** Share of probability that settles (not a push) won by this side. */
export function winShare(p: SideProbs, side: 'over' | 'under'): number {
  const settle = p.over + p.under;
  if (!(settle > 0)) return 0;
  return (side === 'over' ? p.over : p.under) / settle;
}
