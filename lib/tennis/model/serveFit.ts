/**
 * Match-level serve variation from history (spec section 17), with no odds:
 *   1. a sequential baseline: each player's serve and return strength on the logit scale (plus per-surface
 *      adjustments and a tour-surface mean), updated day by day so a match only sees strengths from
 *      before its day (same-day matches wait until the day is done);
 *   2. tau and rho: a bivariate logit-normal match effect on the two players' serve-point counts around
 *      that baseline, by Gauss-Hermite maximum likelihood.
 * History tau includes baseline error, so it's an upper bound for pricing against the market.
 */

import { hermegauss, setArray, type SetRule } from './pricing';

export type HistMatch = {
  id: string;
  /** US-agnostic calendar day of the match, YYYY-MM-DD. */
  date: string;
  tour: string;
  tier: string;
  surface: string;
  bestOf: number;
  a: string;
  b: string;
  /** Serve points played and won by each player. */
  nA: number;
  kA: number;
  nB: number;
  kB: number;
};

export type BaselineOpts = {
  /** Step size for the overall serve / return strengths. */
  alpha: number;
  /** Step size for the per-surface adjustments. */
  alphaSurface: number;
  /** Extra learning for players with few matches: step = max(alpha, 1 / (matches + newcomer)). */
  newcomer: number;
};

export type Baseline = { id: string; lA: number; lB: number };

const expit = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/** Pre-match expected serve logits for every match, updated by day (no leakage within a day). */
export function sequentialBaseline(matches: HistMatch[], opts: BaselineOpts): Baseline[] {
  const serve = new Map<string, number>();
  const ret = new Map<string, number>();
  const serveS = new Map<string, number>();
  const retS = new Map<string, number>();
  const count = new Map<string, number>();
  const mean = new Map<string, { s: number; n: number }>();
  const get = (m: Map<string, number>, k: string) => m.get(k) ?? 0;
  const sorted = [...matches].sort((x, y) => x.date.localeCompare(y.date));
  const out: Baseline[] = [];
  let i = 0;
  while (i < sorted.length) {
    const day = sorted[i]!.date;
    const batch: HistMatch[] = [];
    while (i < sorted.length && sorted[i]!.date === day) batch.push(sorted[i++]!);
    const updates: Array<() => void> = [];
    for (const m of batch) {
      const g = `${m.tour}|${m.surface}`;
      const mu = mean.get(g);
      const base = mu && mu.n ? mu.s / mu.n : logit(0.62);
      const pred = (srv: string, rcv: string) => base + get(serve, srv) + get(serveS, `${srv}|${m.surface}`) - get(ret, rcv) - get(retS, `${rcv}|${m.surface}`);
      const lA = pred(m.a, m.b);
      const lB = pred(m.b, m.a);
      out.push({ id: m.id, lA, lB });
      updates.push(() => {
        for (const [srv, rcv, n, k, l] of [
          [m.a, m.b, m.nA, m.kA, lA],
          [m.b, m.a, m.nB, m.kB, lB],
        ] as const) {
          const z = logit((k + 0.5) / (n + 1)) - l;
          const step = (p: string) => Math.max(opts.alpha, 1 / (get(count, p) + opts.newcomer));
          serve.set(srv, get(serve, srv) + step(srv) * z * 0.5);
          ret.set(rcv, get(ret, rcv) - step(rcv) * z * 0.5);
          serveS.set(`${srv}|${m.surface}`, get(serveS, `${srv}|${m.surface}`) + opts.alphaSurface * z * 0.5);
          retS.set(`${rcv}|${m.surface}`, get(retS, `${rcv}|${m.surface}`) - opts.alphaSurface * z * 0.5);
          const mu2 = mean.get(g) ?? { s: 0, n: 0 };
          mu2.s += logit((k + 0.5) / (n + 1));
          mu2.n += 1;
          mean.set(g, mu2);
        }
        count.set(m.a, get(count, m.a) + 1);
        count.set(m.b, get(count, m.b) + 1);
      });
    }
    for (const u of updates) u();
  }
  return out;
}

/** Mean binomial deviance per serve point of the baseline's predictions (for choosing the step sizes). */
export function baselineDeviance(matches: HistMatch[], base: Baseline[], fromDate: string): number {
  const byId = new Map(base.map((b) => [b.id, b]));
  let dev = 0;
  let pts = 0;
  for (const m of matches) {
    if (m.date < fromDate) continue;
    const b = byId.get(m.id);
    if (!b) continue;
    for (const [n, k, l] of [
      [m.nA, m.kA, b.lA],
      [m.nB, m.kB, b.lB],
    ] as const) {
      const p = expit(l);
      dev -= k * Math.log(p) + (n - k) * Math.log(1 - p);
      pts += n;
    }
  }
  return pts ? dev / pts : Infinity;
}

export type FitObs = { nA: number; kA: number; nB: number; kB: number; lA: number; lB: number };

const lnChoose = (() => {
  const cache: number[] = [0];
  const lf = (n: number) => {
    for (let i = cache.length; i <= n; i += 1) cache[i] = cache[i - 1]! + Math.log(i);
    return cache[n]!;
  };
  return (n: number, k: number) => lf(n) - lf(k) - lf(n - k);
})();

/** Log-likelihood of all matches at (tau, rho), integrating the 2-D match effect by Gauss-Hermite. */
export function tauRhoLogLik(obs: FitObs[], tau: number, rho: number, order = 12): number {
  const { x, w } = hermegauss(order);
  const c = Math.sqrt(Math.max(0, 1 - rho * rho));
  let total = 0;
  for (const o of obs) {
    let lik = 0;
    for (let i = 0; i < order; i += 1) {
      for (let j = 0; j < order; j += 1) {
        const uA = tau * x[i]!;
        const uB = tau * (rho * x[i]! + c * x[j]!);
        const pA = expit(o.lA + uA);
        const pB = expit(o.lB + uB);
        const ll = o.kA * Math.log(pA) + (o.nA - o.kA) * Math.log(1 - pA) + o.kB * Math.log(pB) + (o.nB - o.kB) * Math.log(1 - pB);
        lik += w[i]! * w[j]! * Math.exp(ll);
      }
    }
    total += Math.log(lik) + lnChoose(o.nA, o.kA) + lnChoose(o.nB, o.kB);
  }
  return total;
}

export type TauRhoFit = { tau: number; rho: number; logLik: number; n: number; tauCi: [number, number]; rhoCi: [number, number] };

/** Maximum likelihood tau and rho on a grid, refined, with profile-likelihood 95% intervals. */
export function fitTauRho(obs: FitObs[]): TauRhoFit {
  const taus = Array.from({ length: 31 }, (_, i) => i * 0.02);
  const rhos = Array.from({ length: 19 }, (_, i) => -0.9 + i * 0.1);
  let best = { tau: 0, rho: 0, ll: -Infinity };
  const grid = new Map<string, number>();
  for (const tau of taus) {
    for (const rho of tau === 0 ? [0] : rhos) {
      const ll = tauRhoLogLik(obs, tau, rho);
      grid.set(`${tau}|${rho}`, ll);
      if (ll > best.ll) best = { tau, rho, ll };
    }
  }
  for (let step = 0.01; step >= 0.0025; step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [dt, dr] of [
        [step, 0],
        [-step, 0],
        [0, step * 5],
        [0, -step * 5],
      ] as const) {
        const tau = Math.max(0, best.tau + dt);
        const rho = Math.max(-0.95, Math.min(0.95, best.rho + dr));
        const ll = tauRhoLogLik(obs, tau, rho);
        if (ll > best.ll + 1e-9) {
          best = { tau, rho, ll };
          moved = true;
        }
      }
    }
  }
  // Profile intervals: the range where the log-likelihood is within 1.92 of the maximum.
  const within = (tau: number, rho: number) => tauRhoLogLik(obs, tau, rho) >= best.ll - 1.92;
  const edge = (from: number, dir: number, other: (v: number) => [number, number]) => {
    let v = from;
    for (let s = 0; s < 200; s += 1) {
      const next = v + dir * 0.005;
      const [t, r] = other(next);
      if (t < 0 || r < -0.99 || r > 0.99 || !within(t, r)) break;
      v = next;
    }
    return v;
  };
  const tauCi: [number, number] = [edge(best.tau, -1, (t) => [t, best.rho]), edge(best.tau, 1, (t) => [t, best.rho])];
  const rhoCi: [number, number] = [edge(best.rho, -1, (r) => [best.tau, r]), edge(best.rho, 1, (r) => [best.tau, r])];
  void grid;
  return { tau: best.tau, rho: best.rho, logLik: best.ll, n: obs.length, tauCi, rhoCi };
}

/** P(A wins a set) and P(A wins sets 1 and 2), averaged over who serves first; set 2's server follows set 1's game count. */
export function setPairProbs(pA: number, pB: number, rule: SetRule): { winSet: number; winBoth: number } {
  let winSet = 0;
  let winBoth = 0;
  const pWin = (aFirst: boolean) => setArray(pA, pB, aFirst, rule).reduce((s, row, a) => s + row.reduce((x, v, b) => x + (a > b ? v : 0), 0), 0);
  const wTrue = pWin(true);
  const wFalse = pWin(false);
  for (const aFirst of [true, false]) {
    const S = setArray(pA, pB, aFirst, rule);
    S.forEach((row, a) =>
      row.forEach((v, b) => {
        if (a > b) {
          winSet += v / 2;
          const nextAFirst = (a + b) % 2 === 1 ? !aFirst : aFirst;
          winBoth += (v / 2) * (nextAFirst ? wTrue : wFalse);
        }
      })
    );
  }
  return { winSet, winBoth };
}
