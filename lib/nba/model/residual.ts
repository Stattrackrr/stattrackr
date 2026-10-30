/**
 * The market-anchored residual model (agreed build spec, Part D):
 *
 *   P(over) = logistic( a * logit(fair_over) + b + b_stat + sum c_j * feature_j + d * controls )
 *
 * The market is the baseline: a is pulled toward 1 (take the market as it is), b and the per-stat b
 * toward 0, every feature coefficient toward 0, with sign bounds where the direction is known. A
 * feature only earns weight if the data shows it. Lambdas scale with the effective sample and are
 * chosen by walk-forward folds by date; lift is judged on out-of-fold predictions, game by game.
 */

export type PenaltyGroup = 'a' | 'b' | 'bStat' | 'c' | 'control';

export type Param = { name: string; center: number; group: PenaltyGroup; lower?: number };

export type DesignRow = { x: number[]; y: 0 | 1; w: number; game: string; date: string };

export type Design = { params: Param[]; rows: DesignRow[] };

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export const logit = (p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};

/** Solves A x = b for a small dense system (Gaussian elimination with partial pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      if (f) for (let c = col; c <= n; c += 1) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

export type Lambdas = Record<PenaltyGroup, number>;

function objective(theta: number[], d: Design, lam: Lambdas): number {
  let loss = 0;
  for (const r of d.rows) {
    const z = r.x.reduce((a, v, j) => a + v * theta[j]!, 0);
    loss += r.w * (r.y ? Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));
  }
  return loss + d.params.reduce((a, p, j) => a + lam[p.group] * (theta[j]! - p.center) ** 2, 0);
}

/** Penalized maximum likelihood by bounded Newton steps. Returns the coefficients in param order. */
export function fitResidual(d: Design, lam: Lambdas, maxIter = 60): number[] {
  const k = d.params.length;
  let theta = d.params.map((p) => Math.max(p.lower ?? -Infinity, p.center));
  let current = objective(theta, d, lam);
  for (let iter = 0; iter < maxIter; iter += 1) {
    const grad = d.params.map((p, j) => 2 * lam[p.group] * (theta[j]! - p.center));
    const hess = d.params.map((p, j) => d.params.map((_, l) => (j === l ? 2 * lam[p.group] : 0)));
    for (const r of d.rows) {
      const s = sigmoid(r.x.reduce((a, v, j) => a + v * theta[j]!, 0));
      const g = r.w * (s - r.y);
      const h = r.w * s * (1 - s);
      for (let j = 0; j < k; j += 1) {
        if (!r.x[j]) continue;
        grad[j]! += g * r.x[j]!;
        for (let l = 0; l < k; l += 1) if (r.x[l]) hess[j]![l]! += h * r.x[j]! * r.x[l]!;
      }
    }
    // Coefficients held at their lower bound by a gradient pushing further down stay fixed this step.
    const free = d.params.map((p, j) => !(p.lower != null && theta[j]! <= p.lower + 1e-12 && grad[j]! > 0));
    const idx = free.map((f, j) => (f ? j : -1)).filter((j) => j >= 0);
    const step = solve(idx.map((j) => idx.map((l) => hess[j]![l]!)), idx.map((j) => grad[j]!));
    let t = 1;
    let next = theta;
    let value = current;
    for (let tries = 0; tries < 30; tries += 1) {
      const cand = [...theta];
      idx.forEach((j, n) => {
        cand[j] = Math.max(d.params[j]!.lower ?? -Infinity, theta[j]! - t * step[n]!);
      });
      const v = objective(cand, d, lam);
      if (v <= current + 1e-12) {
        next = cand;
        value = v;
        break;
      }
      t /= 2;
    }
    const moved = Math.max(...next.map((v, j) => Math.abs(v - theta[j]!)));
    theta = next;
    current = value;
    if (moved < 1e-7) break;
  }
  return theta;
}

export function predict(theta: number[], x: number[]): number {
  return sigmoid(x.reduce((a, v, j) => a + v * theta[j]!, 0));
}

const logLoss = (p: number, y: 0 | 1) => {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return -(y ? Math.log(q) : Math.log(1 - q));
};

/** Penalty strength = effective sample (sum of weights) x scale, the same scale for every group. */
export function lambdasFor(d: Design, scale: number): Lambdas {
  const nEff = d.rows.reduce((a, r) => a + r.w, 0);
  const v = nEff * scale;
  return { a: v, b: v, bStat: v, c: v, control: v };
}

export const LAMBDA_SCALES = [1e-3, 1e-2, 1e-1] as const;

/** Date blocks for walk-forward folds: fold i trains on every block before it and predicts block i. */
function dateBlocks(rows: DesignRow[], folds: number): string[][] {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const size = Math.ceil(dates.length / folds);
  const out: string[][] = [];
  for (let i = 0; i < dates.length; i += size) out.push(dates.slice(i, i + size));
  return out;
}

/** Out-of-fold predictions (walk-forward by date) at one penalty scale; rows in the first block get none. */
export function walkForward(d: Design, scale: number, folds = 5): Array<number | null> {
  const blocks = dateBlocks(d.rows, folds);
  const out: Array<number | null> = d.rows.map(() => null);
  for (let b = 1; b < blocks.length; b += 1) {
    const train = new Set(blocks.slice(0, b).flat());
    const test = new Set(blocks[b]);
    const trainDesign = { params: d.params, rows: d.rows.filter((r) => train.has(r.date)) };
    if (!trainDesign.rows.length) continue;
    const theta = fitResidual(trainDesign, lambdasFor(trainDesign, scale));
    d.rows.forEach((r, i) => {
      if (test.has(r.date)) out[i] = predict(theta, r.x);
    });
  }
  return out;
}

export type ResidualFit = { theta: number[]; scale: number; oof: Array<number | null>; oofLogLoss: number };

/** Chooses the penalty scale by out-of-fold log loss, then fits on everything at that scale. */
export function fitWithCv(d: Design, folds = 5): ResidualFit {
  let best: { scale: number; oof: Array<number | null>; loss: number } | null = null;
  for (const scale of LAMBDA_SCALES) {
    const oof = walkForward(d, scale, folds);
    let loss = 0;
    let w = 0;
    d.rows.forEach((r, i) => {
      const p = oof[i];
      if (p == null) return;
      loss += r.w * logLoss(p, r.y);
      w += r.w;
    });
    const avg = w ? loss / w : Infinity;
    if (!best || avg < best.loss) best = { scale, oof, loss: avg };
  }
  return { theta: fitResidual(d, lambdasFor(d, best!.scale)), scale: best!.scale, oof: best!.oof, oofLogLoss: best!.loss };
}

/** Seeded generator, so bootstrap intervals are reproducible. */
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

export type Interval = { mean: number; lo: number; hi: number; games: number };

/** Mean of per-game values with a game bootstrap interval (resampling games, not lines). */
export function gameBootstrap(perGame: number[], level = 0.95, resamples = 2000, seed = 7): Interval {
  const n = perGame.length;
  const mean = n ? perGame.reduce((a, b) => a + b, 0) / n : NaN;
  if (n < 2) return { mean, lo: NaN, hi: NaN, games: n };
  const draw = rng(seed);
  const means: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    let s = 0;
    for (let j = 0; j < n; j += 1) s += perGame[Math.floor(draw() * n)]!;
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return { mean, lo: means[Math.floor(tail * resamples)]!, hi: means[Math.min(resamples - 1, Math.ceil((1 - tail) * resamples) - 1)]!, games: n };
}

/**
 * Log-loss improvement of the model over a baseline (positive = model better), from out-of-fold
 * predictions, averaged per game and bootstrapped over games. No refitting inside the bootstrap.
 */
export function liftOverBaseline(d: Design, model: Array<number | null>, baseline: Array<number | null>, level = 0.95): Interval {
  const byGame = new Map<string, { diff: number; w: number }>();
  d.rows.forEach((r, i) => {
    const m = model[i];
    const b = baseline[i];
    if (m == null || b == null) return;
    const g = byGame.get(r.game) ?? { diff: 0, w: 0 };
    g.diff += r.w * (logLoss(b, r.y) - logLoss(m, r.y));
    g.w += r.w;
    byGame.set(r.game, g);
  });
  return gameBootstrap([...byGame.values()].map((g) => g.diff / g.w), level);
}
