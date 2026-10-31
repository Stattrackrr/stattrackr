/**
 * Removing a book's margin from a two-way price pair, four ways (spec section 5). All four are stored;
 * the working method is chosen later by log loss on outcomes. Power is the default until then.
 */

export type TwoWay = [number, number];
export type Devig = { mult: TwoWay; power: TwoWay; shin: TwoWay; logit: TwoWay; overround: number };
export type DevigMethod = 'mult' | 'power' | 'shin' | 'logit';
export const DEFAULT_DEVIG: DevigMethod = 'power';

const expit = (x: number) => 1 / (1 + Math.exp(-x));
const logitOf = (p: number) => Math.log(p / (1 - p));

/** Solves f(x) = 0 for an f increasing on [lo, hi]. */
function bisect(f: (x: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Fair probabilities for both sides of a decimal price pair; null when the pair can't be a market. */
export function devigTwoWay(priceA: number, priceB: number): Devig | null {
  if (!(priceA > 1 && priceB > 1)) return null;
  const ia = 1 / priceA;
  const ib = 1 / priceB;
  const s = ia + ib;
  const mult: TwoWay = [ia / s, ib / s];
  // Power: ia^k + ib^k = 1. Increasing in k is decreasing in the sum, so solve on the negated sum.
  const k = bisect((x) => 1 - (ia ** x + ib ** x), 0.2, 5);
  const power: TwoWay = [ia ** k, ib ** k];
  // Logit: shift both log-odds by the same c until they sum to 1.
  const c = bisect((x) => 1 - (expit(logitOf(ia) - x) + expit(logitOf(ib) - x)), -5, 5);
  const logit: TwoWay = [expit(logitOf(ia) - c), expit(logitOf(ib) - c)];
  // Shin: the insider share z that makes the implied probabilities sum to 1. No margin, no insiders.
  let shin: TwoWay = mult;
  if (s > 1) {
    const pOf = (z: number, i: number) => (Math.sqrt(z * z + (4 * (1 - z) * i * i) / s) - z) / (2 * (1 - z));
    const z = bisect((x) => 1 - (pOf(x, ia) + pOf(x, ib)), 0, 0.5);
    shin = [pOf(z, ia), pOf(z, ib)];
  }
  return { mult, power, shin, logit, overround: s };
}
