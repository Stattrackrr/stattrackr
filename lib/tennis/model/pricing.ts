/**
 * Tennis pricing core, ported from the reviewer's reference (tennis_pricing.py) and checked against its
 * golden fixtures (golden_tennis.json): exact DP for hold, tiebreak, set and match (no Monte Carlo), the
 * joint distribution of games and sets, and every market priced from it.
 *
 * Points are i.i.d. given (pA, pB) = P(A wins a point on A's serve), P(B wins a point on B's serve).
 * Match-level strength noise is handled outside the DP by Gauss-Hermite integration over
 * logit(pA), logit(pB), which is deterministic, so this port matches the reference exactly.
 *
 * Rules are inputs, never hard-coded per tournament; the tournament-year table must come from a
 * verified source. Total-games convention for a super tiebreak varies by book (book_void_rules).
 */

export type SetRule = { kind: 'tb'; at: number; target: number } | { kind: 'adv' } | { kind: 'supertb'; target: number };

export const NORMAL: SetRule = { kind: 'tb', at: 6, target: 7 };
const PRUNE = 1e-14;
const ADV_CAP = 400;

/** The reference's tuple form: ["tb", 6, 7], ["adv"], ["supertb", 0, 10]. */
export function ruleFromTuple(t: ReadonlyArray<string | number>): SetRule {
  if (t[0] === 'tb') return { kind: 'tb', at: Number(t[1]), target: Number(t[2]) };
  if (t[0] === 'supertb') return { kind: 'supertb', target: Number(t[2]) };
  if (t[0] === 'adv') return { kind: 'adv' };
  throw new Error(`unknown set rule ${JSON.stringify(t)}`);
}

export const expit = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => Math.log(p / (1 - p));

type Grid = number[][];

const zeros = (r: number, c: number): Grid => Array.from({ length: r }, () => new Array<number>(c).fill(0));
const gridSum = (g: Grid) => g.reduce((a, row) => a + row.reduce((s, v) => s + v, 0), 0);

// ---------- game, tiebreak ----------

export function holdProb(p: number): number {
  const q = 1 - p;
  const deuce = (p * p) / (p * p + q * q);
  return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * deuce;
}

/** P(A wins a tiebreak to `target`, win by 2). Server order: the first server once, then two points each. */
export function tbWinProb(pA: number, pB: number, aFirst: boolean, target = 7): number {
  if (!aFirst) return 1 - tbWinProb(pB, pA, true, target);
  const w = pA * (1 - pB);
  const l = (1 - pA) * pB;
  const tie = w / (w + l);
  const size = target + 2;
  const memo = new Map<number, number>();
  const f = (a: number, b: number): number => {
    if (a >= target && a - b >= 2) return 1;
    if (b >= target && b - a >= 2) return 0;
    if (a === b && a >= target - 1) return tie;
    const key = a * size + b;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const n = a + b;
    const aServes = n === 0 || Math.floor((n - 1) / 2) % 2 === 1;
    const p = aServes ? pA : 1 - pB;
    const v = p * f(a + 1, b) + (1 - p) * f(a, b + 1);
    memo.set(key, v);
    return v;
  };
  return f(0, 0);
}

// ---------- set ----------

/** S[a][b] = P(the set finishes a-b in games). A tiebreak counts as one game. */
export function setArray(pA: number, pB: number, aFirst: boolean, rule: SetRule): Grid {
  if (rule.kind === 'supertb') {
    const q = tbWinProb(pA, pB, aFirst, rule.target);
    const S = zeros(2, 2);
    S[1]![0] = q;
    S[0]![1] = 1 - q;
    return S;
  }
  const hA = holdProb(pA);
  const hB = holdProb(pB);
  const tbAt = rule.kind === 'tb' ? rule.at : null;
  const cap = rule.kind === 'tb' ? 2 * rule.at + 1 : ADV_CAP;
  const tbq = rule.kind === 'tb' ? tbWinProb(pA, pB, aFirst, rule.target) : 0;
  const out = new Map<string, number>();
  const add = (m: Map<string, number>, a: number, b: number, v: number) => m.set(`${a},${b}`, (m.get(`${a},${b}`) ?? 0) + v);
  let cur = new Map<string, number>([['0,0', 1]]);
  for (let k = 0; cur.size && k < cap; k += 1) {
    const aServes = (k % 2 === 0) === aFirst;
    const pw = aServes ? hA : 1 - hB;
    const nxt = new Map<string, number>();
    for (const [key, m] of cur) {
      const [ga, gb] = key.split(',').map(Number) as [number, number];
      for (const [da, pr] of [
        [1, pw],
        [0, 1 - pw],
      ] as const) {
        const mm = m * pr;
        if (mm < PRUNE) continue;
        const na = ga + da;
        const nb = gb + 1 - da;
        if (Math.max(na, nb) >= 6 && Math.abs(na - nb) >= 2) add(out, na, nb, mm);
        else if (tbAt != null && na === tbAt && nb === tbAt) {
          add(out, na + 1, nb, mm * tbq);
          add(out, na, nb + 1, mm * (1 - tbq));
        } else add(nxt, na, nb, mm);
      }
    }
    cur = nxt;
  }
  let M = 0;
  for (const key of out.keys()) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    M = Math.max(M, a, b);
  }
  M += 1;
  const S = zeros(M, M);
  for (const [key, m] of out) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    S[a]![b] = m;
  }
  const total = gridSum(S);
  return S.map((row) => row.map((v) => v / total));
}

// ---------- match ----------

/** a + b, padded with zeros to the larger shape. */
function addGrids(a: Grid, b: Grid): Grid {
  const out = zeros(Math.max(a.length, b.length), Math.max(a[0]?.length ?? 0, b[0]?.length ?? 0));
  for (const g of [a, b]) g.forEach((row, i) => row.forEach((v, j) => (out[i]![j]! += v)));
  return out;
}

function padAdd(d: Map<string, Grid>, key: string, arr: Grid): void {
  const cur = d.get(key);
  d.set(key, cur ? addGrids(cur, arr) : arr.map((row) => [...row]));
}

/** Full 2-D convolution (scipy.signal.convolve2d, mode "full"). */
function convolve2d(G: Grid, P: Grid): Grid {
  const gr = G.length;
  const gc = G[0]!.length;
  const pr = P.length;
  const pc = P[0]!.length;
  const H = zeros(gr + pr - 1, gc + pc - 1);
  for (let a = 0; a < gr; a += 1) {
    for (let b = 0; b < gc; b += 1) {
      const g = G[a]![b]!;
      if (!g) continue;
      for (let i = 0; i < pr; i += 1) {
        const row = P[i]!;
        const out = H[a + i]!;
        for (let j = 0; j < pc; j += 1) out[b + j]! += g * row[j]!;
      }
    }
  }
  return H;
}

type SetPart = { winner: 'A' | 'B'; flip: boolean; P: Grid; mass: number };

/** "sA,sB" -> G[gA][gB]: the joint distribution of games at each final set score, averaged over who serves first. */
export function matchArrays(pA: number, pB: number, bestOf = 3, ruleN: SetRule = NORMAL, ruleF: SetRule = NORMAL): Map<string, Grid> {
  const need = Math.floor(bestOf / 2) + 1;
  const cache = new Map<string, SetPart[]>();
  const parts = (final: boolean, af: boolean): SetPart[] => {
    const key = `${final}|${af}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const S = setArray(pA, pB, af, final ? ruleF : ruleN);
    const list: SetPart[] = [];
    for (const winner of ['A', 'B'] as const) {
      for (const flip of [false, true]) {
        const P = S.map((row, i) => row.map((v, j) => ((winner === 'A' ? i > j : j > i) && ((i + j) % 2 === 1) === flip ? v : 0)));
        list.push({ winner, flip, P, mass: gridSum(P) });
      }
    }
    cache.set(key, list);
    return list;
  };

  const total = new Map<string, Grid>();
  for (const w0 of [true, false]) {
    const levels: Array<Map<string, { sA: number; sB: number; af: boolean; G: Grid }>> = Array.from({ length: bestOf + 1 }, () => new Map());
    levels[0]!.set(`0,0,${w0}`, { sA: 0, sB: 0, af: w0, G: [[0.5]] });
    for (let n = 0; n < bestOf; n += 1) {
      for (const { sA, sB, af, G } of levels[n]!.values()) {
        const final = sA === need - 1 && sB === need - 1;
        for (const { winner, flip, P, mass } of parts(final, af)) {
          if (mass < PRUNE) continue;
          const H = convolve2d(G, P);
          const nA = sA + (winner === 'A' ? 1 : 0);
          const nB = sB + (winner === 'B' ? 1 : 0);
          if (nA === need || nB === need) {
            padAdd(total, `${nA},${nB}`, H);
          } else {
            const nextAf = flip ? !af : af;
            const key = `${nA},${nB},${nextAf}`;
            const level = levels[n + 1]!;
            const prev = level.get(key);
            if (prev) prev.G = addGrids(prev.G, H);
            else level.set(key, { sA: nA, sB: nB, af: nextAf, G: H });
          }
        }
      }
    }
  }
  return total;
}

/**
 * Market keys: "win" (A wins), "tot:L" (total games over L), "hcp:h" (A's game margin + h > 0),
 * "gA:L" / "gB:L" (games won over L), "sets:L" (sets played over L), "setA" / "setB" (wins at least one set).
 */
export type PriceKey = string;

export class MatchDist {
  readonly tot: number[];
  readonly gA: number[];
  readonly gB: number[];
  readonly margin: number[];
  readonly setsTot = new Map<number, number>();
  readonly off: number;
  winA = 0;
  setA = 0;
  setB = 0;

  constructor(readonly arrays: Map<string, Grid>) {
    let n = 0;
    for (const G of arrays.values()) n = Math.max(n, G.length, G[0]!.length);
    this.off = n;
    this.tot = new Array<number>(2 * n).fill(0);
    this.gA = new Array<number>(n).fill(0);
    this.gB = new Array<number>(n).fill(0);
    this.margin = new Array<number>(2 * n + 1).fill(0);
    for (const [key, G] of arrays) {
      const [sA, sB] = key.split(',').map(Number) as [number, number];
      const m = gridSum(G);
      if (sA > sB) this.winA += m;
      if (sA >= 1) this.setA += m;
      if (sB >= 1) this.setB += m;
      this.setsTot.set(sA + sB, (this.setsTot.get(sA + sB) ?? 0) + m);
      G.forEach((row, a) => {
        this.gA[a]! += row.reduce((s, v) => s + v, 0);
        row.forEach((v, b) => {
          this.gB[b]! += v;
          this.tot[a + b]! += v;
          this.margin[a - b + n]! += v;
        });
      });
    }
  }

  private static over(pmf: number[], line: number, off = 0): number {
    let s = 0;
    pmf.forEach((v, i) => {
      if (i - off > line) s += v;
    });
    return s;
  }

  price(key: PriceKey): number {
    const [kind, raw] = key.split(':');
    const line = Number(raw);
    switch (kind) {
      case 'win':
        return this.winA;
      case 'tot':
        return MatchDist.over(this.tot, line);
      case 'hcp':
        return MatchDist.over(this.margin, -line, this.off);
      case 'gA':
        return MatchDist.over(this.gA, line);
      case 'gB':
        return MatchDist.over(this.gB, line);
      case 'sets': {
        let s = 0;
        for (const [k, v] of this.setsTot) if (k > line) s += v;
        return s;
      }
      case 'setA':
        return this.setA;
      case 'setB':
        return this.setB;
    }
    throw new Error(`unknown price key ${key}`);
  }
}

export type Prices = Record<PriceKey, number>;
export type PricingModel = (pA: number, pB: number) => Prices;

export function makeModel(keys: PriceKey[], bestOf = 3, ruleN: SetRule = NORMAL, ruleF: SetRule = NORMAL): PricingModel {
  return (pA, pB) => {
    const d = new MatchDist(matchArrays(pA, pB, bestOf, ruleN, ruleF));
    return Object.fromEntries(keys.map((k) => [k, d.price(k)]));
  };
}

// ---------- uncertainty ----------

/** Symmetric eigen-decomposition by cyclic Jacobi rotations (small matrices only). */
function jacobiEigen(A: number[][]): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const a = A.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) off += a[i]![j]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p]![q]!) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((r, i) => r[i]!), vectors: v };
}

/** Probabilists' Gauss-Hermite nodes and weights normalised to sum to 1 (numpy hermegauss, Golub-Welsch). */
export function hermegauss(order: number): { x: number[]; w: number[] } {
  const J = Array.from({ length: order }, (_, i) =>
    Array.from({ length: order }, (_, j) => (Math.abs(i - j) === 1 ? Math.sqrt(Math.max(i, j)) : 0))
  );
  const { values, vectors } = jacobiEigen(J);
  const idx = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const x = idx.map((i) => values[i]!);
  const raw = idx.map((i) => vectors[0]![i]! ** 2);
  const sum = raw.reduce((a, b) => a + b, 0);
  // Symmetric about 0: average mirrored pairs so rounding can't tilt the rule.
  const w = raw.map((v, i) => (v + raw[order - 1 - i]!) / 2 / sum);
  const xs = x.map((v, i) => (v - x[order - 1 - i]!) / 2);
  return { x: xs, w };
}

export type Cov2 = [[number, number], [number, number]];

/** E[model(expit(theta + e))], e ~ N(0, cov), by product Gauss-Hermite (deterministic). */
export function integrate(model: PricingModel, theta: [number, number], cov: Cov2, order = 5): Prices {
  if (order <= 1 || cov.every((r) => r.every((v) => v === 0))) return model(expit(theta[0]), expit(theta[1]));
  const { x, w } = hermegauss(order);
  const c00 = cov[0][0] + 1e-12;
  const c11 = cov[1][1] + 1e-12;
  const l00 = Math.sqrt(c00);
  const l10 = cov[1][0] / l00;
  const l11 = Math.sqrt(c11 - l10 * l10);
  let acc: Prices | null = null;
  for (let i = 0; i < order; i += 1) {
    for (let j = 0; j < order; j += 1) {
      const r = model(expit(theta[0] + l00 * x[i]!), expit(theta[1] + l10 * x[i]! + l11 * x[j]!));
      const wt = w[i]! * w[j]!;
      if (!acc) acc = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, wt * v]));
      else for (const [k, v] of Object.entries(r)) acc[k]! += wt * v;
    }
  }
  return acc!;
}

/** A model whose prices already include match-level serve-strength noise tau (logit SD). */
export function withTau(model: PricingModel, tau: number, order = 5): PricingModel {
  return (pA, pB) => integrate(model, [logit(pA), logit(pB)], [[tau * tau, 0], [0, tau * tau]], order);
}

/** Prices averaged over price-noise uncertainty plus match-level tau (one combined Gaussian). */
export function priceIntegrated(theta: [number, number], cov: Cov2, tau: number, model: PricingModel, order = 5): Prices {
  const t2 = tau * tau;
  return integrate(model, theta, [[cov[0][0] + t2, cov[0][1]], [cov[1][0], cov[1][1] + t2]], order);
}

// ---------- inversion ----------

const EPS_SQRT = Math.sqrt(2.220446049250313e-16);

function solve2(A: number[][], b: number[]): [number, number] {
  const det = A[0]![0]! * A[1]![1]! - A[0]![1]! * A[1]![0]!;
  return [(b[0]! * A[1]![1]! - b[1]! * A[0]![1]!) / det, (A[0]![0]! * b[1]! - A[1]![0]! * b[0]!) / det];
}

export type Inversion = { theta: [number, number]; cov: Cov2; coherence: number; iterations: number };

/**
 * Serve strengths that best reproduce the sharp prices: least squares on the logit scale, each price
 * weighted by 1/sig. `model` should be withTau(...) so the inversion prices the way the market does.
 * Returns logit serve probabilities, their price-noise covariance (inverse of J'J at the solution, J by
 * forward differences as in scipy's "2-point") and the coherence chi-square (dof = prices - 2).
 */
export function invert(prices: Prices, sig: Record<PriceKey, number>, model: PricingModel, x0: [number, number] = [0.64, 0.62]): Inversion {
  const keys = Object.keys(prices);
  const resid = (th: [number, number]) => {
    const m = model(expit(th[0]), expit(th[1]));
    return keys.map((k) => (logit(m[k]!) - logit(prices[k]!)) / sig[k]!);
  };
  const cost = (r: number[]) => r.reduce((a, v) => a + v * v, 0);
  const jac = (th: [number, number], r0: number[]) => {
    const cols = [0, 1].map((j) => {
      const step = EPS_SQRT * Math.max(1, Math.abs(th[j]!)) * (th[j]! >= 0 ? 1 : -1);
      const t = [...th] as [number, number];
      t[j] = th[j]! + step;
      const h = t[j]! - th[j]!;
      const r1 = resid(t);
      return r1.map((v, i) => (v - r0[i]!) / h);
    });
    return keys.map((_, i) => [cols[0]![i]!, cols[1]![i]!]);
  };

  let th: [number, number] = [logit(x0[0]), logit(x0[1])];
  let r = resid(th);
  let lambda = 1e-3;
  let iterations = 0;
  for (; iterations < 200; iterations += 1) {
    const J = jac(th, r);
    const A = [0, 1].map((a) => [0, 1].map((b) => J.reduce((s, row) => s + row[a]! * row[b]!, 0)));
    const g = [0, 1].map((a) => J.reduce((s, row, i) => s + row[a]! * r[i]!, 0));
    if (Math.max(Math.abs(g[0]!), Math.abs(g[1]!)) < 1e-14) break;
    let moved = false;
    for (let tries = 0; tries < 30; tries += 1) {
      const step = solve2(
        A.map((row, i) => row.map((v, j) => v + (i === j ? lambda * Math.max(A[i]![i]!, 1e-12) : 0))),
        g.map((v) => -v)
      );
      const next: [number, number] = [th[0] + step[0], th[1] + step[1]];
      const rn = resid(next);
      if (cost(rn) <= cost(r)) {
        const small = Math.abs(step[0]) < 1e-13 * (1 + Math.abs(th[0])) && Math.abs(step[1]) < 1e-13 * (1 + Math.abs(th[1]));
        const flat = cost(r) - cost(rn) <= 1e-15 * Math.max(cost(r), 1e-300);
        th = next;
        r = rn;
        lambda = Math.max(lambda / 3, 1e-12);
        moved = !(small || flat);
        break;
      }
      lambda *= 4;
    }
    if (!moved) break;
  }
  const J = jac(th, r);
  const A = [0, 1].map((a) => [0, 1].map((b) => J.reduce((s, row) => s + row[a]! * row[b]!, 0)));
  const det = A[0]![0]! * A[1]![1]! - A[0]![1]! * A[1]![0]!;
  const cov: Cov2 = [
    [A[1]![1]! / det, -A[0]![1]! / det],
    [-A[1]![0]! / det, A[0]![0]! / det],
  ];
  return { theta: th, cov, coherence: cost(r), iterations };
}
