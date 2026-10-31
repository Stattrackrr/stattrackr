/**
 * Is Pinnacle's handicap / games-won pricing derived from its own winner and total (spec section 12)?
 * Recorded before any v0 bet is read. Three tests on logged sharp snapshots:
 *   1. TOST on the RMS of misfits standardised by measured noise: invert Pinnacle's winner + total, predict
 *      its handicap / games-won, and test whether the misfit is no bigger than price noise;
 *   2. a flexible regression of the misfit on the winner price, total line and handicap line: a high R^2
 *      means the derivative price is a deterministic function of the inputs, whatever model made it;
 *   3. an event study: how often a derivative price moves while the winner and total don't.
 */

export type MisfitRow = {
  match: string;
  tier: string;
  /** Standardised misfit: (logit Pinnacle - logit predicted) / noise SD for that market. */
  z: number;
  /** Raw logit misfit and the regressors for the flexible fit. */
  misfit: number;
  logitWin: number;
  totalLine: number;
  hcpLine: number;
};

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

/** RMS of standardised misfits with a match-clustered bootstrap interval. */
export function rmsWithCi(rows: MisfitRow[], level = 0.9, resamples = 2000, seed = 7): { rms: number; lo: number; hi: number; matches: number } {
  const byMatch = new Map<string, number[]>();
  for (const r of rows) byMatch.set(r.match, [...(byMatch.get(r.match) ?? []), r.z * r.z]);
  const groups = [...byMatch.values()];
  const stat = (gs: number[][]) => {
    const all = gs.flat();
    return Math.sqrt(all.reduce((a, v) => a + v, 0) / Math.max(1, all.length));
  };
  const rms = stat(groups);
  if (groups.length < 2) return { rms, lo: NaN, hi: NaN, matches: groups.length };
  const u = rng(seed);
  const draws: number[] = [];
  for (let i = 0; i < resamples; i += 1) draws.push(stat(groups.map(() => groups[Math.floor(u() * groups.length)]!)));
  draws.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return { rms, lo: draws[Math.floor(tail * resamples)]!, hi: draws[Math.ceil((1 - tail) * resamples) - 1]!, matches: groups.length };
}

/**
 * TOST-style equivalence: "derived" when the 90% interval of the RMS standardised misfit lies inside
 * [0, bound] (misfits no bigger than measured noise, allowing for noise mis-estimation up to `bound`).
 */
export function equivalenceDerived(rows: MisfitRow[], bound = 1.5): { derived: boolean; rms: number; hi: number } {
  const r = rmsWithCi(rows);
  return { derived: Number.isFinite(r.hi) && r.hi <= bound, rms: r.rms, hi: r.hi };
}

/** Least squares on a quadratic surface in (logit winner, total line, handicap line); returns R^2. */
export function flexibleR2(rows: MisfitRow[]): number {
  const feats = (r: MisfitRow) => {
    const a = r.logitWin;
    const b = r.totalLine - 21;
    const c = r.hcpLine;
    return [1, a, b, c, a * a, b * b, c * c, a * b, a * c, b * c];
  };
  const X = rows.map(feats);
  const y = rows.map((r) => r.misfit);
  const k = X[0]?.length ?? 0;
  if (rows.length <= k + 2) return NaN;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, row) => s + row[i]! * row[j]!, 0) + (i === j ? 1e-9 : 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, row, n) => s + row[i]! * y[n]!, 0));
  // Gaussian elimination.
  const M = XtX.map((row, i) => [...row, Xty[i]!]);
  for (let col = 0; col < k; col += 1) {
    let piv = col;
    for (let r = col + 1; r < k; r += 1) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-15) continue;
    for (let r = 0; r < k; r += 1) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      for (let c = col; c <= k; c += 1) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const beta = M.map((row, i) => (Math.abs(row[i]!) < 1e-15 ? 0 : row[k]! / row[i]!));
  const pred = X.map((row) => row.reduce((s, v, i) => s + v * beta[i]!, 0));
  const mean = y.reduce((a, v) => a + v, 0) / y.length;
  const ssTot = y.reduce((a, v) => a + (v - mean) ** 2, 0);
  const ssRes = y.reduce((a, v, i) => a + (v - pred[i]!) ** 2, 0);
  return ssTot > 0 ? 1 - ssRes / ssTot : 1;
}

export type PollChange = { match: string; pollAt: string; market: 'winner' | 'total' | 'derivative' };

/** Share of derivative price changes that happened in a poll where neither the winner nor the total moved. */
export function independentMoveShare(changes: PollChange[]): { share: number; derivativeMoves: number } {
  const byPoll = new Map<string, Set<string>>();
  for (const c of changes) {
    const key = `${c.match}|${c.pollAt}`;
    byPoll.set(key, (byPoll.get(key) ?? new Set()).add(c.market));
  }
  let moves = 0;
  let alone = 0;
  for (const markets of byPoll.values()) {
    if (!markets.has('derivative')) continue;
    moves += 1;
    if (!markets.has('winner') && !markets.has('total')) alone += 1;
  }
  return { share: moves ? alone / moves : NaN, derivativeMoves: moves };
}

export type DerivationVerdict = {
  tier: string;
  matches: number;
  rms: number;
  rmsHi: number;
  equivalent: boolean;
  r2: number;
  independentMoveShare: number | null;
  /** Derived if misfits are at noise level, or if they're a near-deterministic function of the inputs. */
  derived: boolean;
};

export function derivationVerdict(tier: string, rows: MisfitRow[], moves: PollChange[] | null, r2Bar = 0.8): DerivationVerdict {
  const eq = equivalenceDerived(rows);
  const r2 = flexibleR2(rows);
  const ev = moves ? independentMoveShare(moves) : null;
  return {
    tier,
    matches: new Set(rows.map((r) => r.match)).size,
    rms: eq.rms,
    rmsHi: eq.hi,
    equivalent: eq.derived,
    r2,
    independentMoveShare: ev ? ev.share : null,
    derived: eq.derived || (Number.isFinite(r2) && r2 >= r2Bar),
  };
}
