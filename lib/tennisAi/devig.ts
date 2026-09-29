export type DevigMethod = 'shin' | 'power' | 'multiplicative';

export function impliedFromDecimal(decimalOdds: number): number | null {
  if (!(decimalOdds > 1) || !Number.isFinite(decimalOdds)) return null;
  return 1 / decimalOdds;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function multiplicativeDevig(implied: number[]): number[] {
  const total = sum(implied);
  if (!(total > 0)) throw new Error('implied probabilities must be positive');
  return implied.map((price) => price / total);
}

/** Find k such that the implied prices raised to k sum to 1. */
export function powerDevig(implied: number[]): number[] {
  const overround = sum(implied);
  if (Math.abs(overround - 1) < 1e-9) return implied.slice();
  let lo = 0.05;
  let hi = 8;
  const at = (k: number) => sum(implied.map((price) => Math.pow(price, k)));
  // Overround > 1 means we need k > 1 to shrink the prices.
  if (overround > 1) {
    lo = 1;
  } else {
    hi = 1;
  }
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(mid) > 1) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const fair = implied.map((price) => Math.pow(price, k));
  const total = sum(fair);
  return fair.map((price) => price / total);
}

/**
 * Shin margin removal. Falls back to the multiplicative method if z does not settle.
 */
export function shinDevig(implied: number[]): number[] {
  const n = implied.length;
  const fairAt = (z: number) =>
    implied.map((price) => {
      const inside = z * z + (4 * (1 - z) * price * price) / n;
      return (Math.sqrt(Math.max(inside, 0)) - z) / (2 * (1 - z));
    });
  let lo = 0;
  let hi = 0.45;
  const totalAt = (z: number) => sum(fairAt(Math.min(z, 0.449)));
  if (!Number.isFinite(totalAt(0.01))) return multiplicativeDevig(implied);
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid) > 1) lo = mid;
    else hi = mid;
  }
  const fair = fairAt((lo + hi) / 2);
  if (fair.some((price) => !Number.isFinite(price) || price <= 0)) return multiplicativeDevig(implied);
  const total = sum(fair);
  if (!(total > 0)) return multiplicativeDevig(implied);
  return fair.map((price) => price / total);
}

export function devig(implied: number[], method: DevigMethod = 'shin'): number[] {
  if (!implied.length || implied.some((price) => !(price > 0) || price >= 1)) {
    throw new Error('each implied probability must be between 0 and 1');
  }
  if (method === 'multiplicative') return multiplicativeDevig(implied);
  if (method === 'power') return powerDevig(implied);
  return shinDevig(implied);
}
