/**
 * Pure maths for the weekly tennis report: the information regression, the pilot power / MDE plan,
 * price availability rebuilt from on-change price history, and match-clustered intervals.
 */

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One graded side of a market at an arm. q: the book's de-vigged probability; edge: logit(fair) - logit(q). */
export type InfoRow = { match: string; y: 0 | 1; q: number; edge: number; price: number };

/**
 * logit P(win) = logit(q) + b0 + gamma * edge, by Newton. gamma = 0: our fair adds nothing to the book's
 * own price; gamma = 1: the whole gap is information.
 */
export function fitInformation(rows: InfoRow[]): { b0: number; gamma: number; converged: boolean } {
  let b0 = 0;
  let g = 0;
  for (let it = 0; it < 50; it += 1) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const r of rows) {
      const p = sigmoid(logit(r.q) + b0 + g * r.edge);
      const w = p * (1 - p);
      g0 += r.y - p;
      g1 += (r.y - p) * r.edge;
      h00 += w;
      h01 += w * r.edge;
      h11 += w * r.edge * r.edge;
    }
    const det = h00 * h11 - h01 * h01;
    if (!(Math.abs(det) > 1e-12)) return { b0, gamma: g, converged: false };
    const d0 = (h11 * g0 - h01 * g1) / det;
    const d1 = (h00 * g1 - h01 * g0) / det;
    b0 += d0;
    g += d1;
    if (Math.abs(d0) < 1e-9 && Math.abs(d1) < 1e-9) return { b0, gamma: g, converged: true };
  }
  return { b0, gamma: g, converged: false };
}

/** Mean EV of the would-be bets (rows with raw EV >= minEv) under the fitted model. */
function modelEv(rows: InfoRow[], fit: { b0: number; gamma: number }, minEv: number): number {
  const bets = rows.filter((r) => sigmoid(logit(r.q) + r.edge) * r.price - 1 >= minEv);
  if (!bets.length) return NaN;
  return bets.reduce((s, r) => s + sigmoid(logit(r.q) + fit.b0 + fit.gamma * r.edge) * r.price - 1, 0) / bets.length;
}

export type InfoResult = {
  matches: number;
  rows: number;
  gamma: number;
  gammaLo: number;
  gammaHi: number;
  /** Mean EV of would-be bets under the fit, and its match-bootstrap SE. */
  ev: number;
  evSe: number;
};

/** The regression with a match-clustered bootstrap for gamma and the would-be bets' EV. */
export function informationWithCi(rows: InfoRow[], minEv = 0.03, resamples = 400, seed = 11): InfoResult | null {
  const byMatch = new Map<string, InfoRow[]>();
  for (const r of rows) byMatch.set(r.match, [...(byMatch.get(r.match) ?? []), r]);
  const groups = [...byMatch.values()];
  if (groups.length < 20) return null;
  const fit = fitInformation(rows);
  const u = rng(seed);
  const gammas: number[] = [];
  const evs: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const sample = groups.map(() => groups[Math.floor(u() * groups.length)]!).flat();
    const f = fitInformation(sample);
    if (!f.converged) continue;
    gammas.push(f.gamma);
    const ev = modelEv(sample, f, minEv);
    if (Number.isFinite(ev)) evs.push(ev);
  }
  gammas.sort((a, b) => a - b);
  const q = (p: number) => gammas[Math.min(gammas.length - 1, Math.max(0, Math.floor(p * gammas.length)))] ?? NaN;
  const mean = evs.reduce((a, v) => a + v, 0) / Math.max(1, evs.length);
  const sd = Math.sqrt(evs.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, evs.length - 1));
  return { matches: groups.length, rows: rows.length, gamma: fit.gamma, gammaLo: q(0.05), gammaHi: q(0.95), ev: modelEv(rows, fit, minEv), evSe: sd };
}

/** One-sided normal quantile (Acklam's approximation, accurate to ~1e-9). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export type MdePlan = {
  matchesNow: number;
  matchesAtHorizon: number;
  /** Smallest true EV the test would detect at the horizon (one-sided alpha, power). */
  mdeAtHorizon: number;
  /** Matches needed to detect each true EV. */
  matchesFor: Record<string, number>;
};

/**
 * SE of the would-be bets' EV scales as 1 / sqrt(matches). With the pilot SE at matchesNow, the MDE at the
 * horizon is (z_{1-alpha} + z_power) * SE_now * sqrt(now / horizon). Alpha 0.05/3 is the plain split across
 * the three tests.
 */
export function mdePlan(evSeNow: number, matchesNow: number, matchesAtHorizon: number, targets = [0.04, 0.045, 0.06], alpha = 0.05 / 3, power = 0.8): MdePlan {
  const z = normInv(1 - alpha) + normInv(power);
  const matchesFor: Record<string, number> = {};
  for (const t of targets) matchesFor[t.toFixed(3)] = Math.ceil(matchesNow * ((z * evSeNow) / t) ** 2);
  return { matchesNow, matchesAtHorizon, mdeAtHorizon: z * evSeNow * Math.sqrt(matchesNow / Math.max(1, matchesAtHorizon)), matchesFor };
}

/** On-change price history for one book's selection (price 0 = withdrawn), sorted by time. */
export type PricePoint = { ms: number; price: number };

/** The price on offer at time t: the last change at or before t; null if none yet. */
export function priceAt(history: PricePoint[], t: number): number | null {
  let out: number | null = null;
  for (const h of history) {
    if (h.ms > t) break;
    out = h.price;
  }
  return out;
}

/** Executable at +minutes: the book still offered the price (or better) at that time. */
export function executableAfter(history: PricePoint[], atMs: number, price: number, minutes = 10): boolean | null {
  const later = priceAt(history, atMs + minutes * 60_000);
  if (later == null) return null;
  return later > 0 && later >= price - 1e-9;
}

/** Mean of per-row values with a match-clustered bootstrap interval. */
export function clusteredMean(rows: Array<{ match: string; v: number }>, level = 0.9, resamples = 1000, seed = 5): { mean: number; lo: number; hi: number; n: number } {
  const byMatch = new Map<string, number[]>();
  for (const r of rows) if (Number.isFinite(r.v)) byMatch.set(r.match, [...(byMatch.get(r.match) ?? []), r.v]);
  const groups = [...byMatch.values()];
  const mean = (gs: number[][]) => {
    const all = gs.flat();
    return all.reduce((a, v) => a + v, 0) / Math.max(1, all.length);
  };
  const n = groups.reduce((s, g) => s + g.length, 0);
  if (groups.length < 2) return { mean: groups.length ? mean(groups) : NaN, lo: NaN, hi: NaN, n };
  const u = rng(seed);
  const draws: number[] = [];
  for (let i = 0; i < resamples; i += 1) draws.push(mean(groups.map(() => groups[Math.floor(u() * groups.length)]!)));
  draws.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return { mean: mean(groups), lo: draws[Math.floor(tail * resamples)]!, hi: draws[Math.ceil((1 - tail) * resamples) - 1]!, n };
}
