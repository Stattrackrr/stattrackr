/**
 * Fits match-level serve variation (tau) and its cross-player correlation (rho) from the local API-Tennis
 * history (data/tennis/api-tennis/cache.json), per spec section 17, and writes lib/tennis/model/tauRho.json:
 *   - baseline step sizes chosen on an earlier block (2024), tau and rho fitted on later data (2025+);
 *   - pooled and per tier x surface fits with profile intervals;
 *   - PIT on total games at tau, 0.7 tau and 0, by tier;
 *   - set-level checks (straight sets, tiebreak and 6-0 / 6-1 set rates, set-1 winner wins set 2).
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/fit-tennis-tau-rho.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { isUnplayedTennisMatch, parseTennisSetsFromPlayerView, tennisScoreIsRetired } from '@/lib/tennis/chartStats';
import { expit, firstSetDist, hermegauss, matchArrays, MatchDist, NORMAL } from '@/lib/tennis/model/pricing';
import { baselineDeviance, fitTauRho, sequentialBaseline, setPairProbs, type Baseline, type FitObs, type HistMatch } from '@/lib/tennis/model/serveFit';
import type { TennisMatchRow } from '@/lib/tennis/types';

const SELECT_FROM = '2024-06-01';
const SELECT_TO = '2025-01-01';
const FIT_FROM = '2025-01-01';
const GROUP_CAP = 4000;
const POOLED_CAP = 8000;
const PIT_SAMPLE = 1200;

type Hist = HistMatch & { sets: Array<{ a: number; b: number }>; total: number };

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
const sample = <T>(xs: T[], n: number, seed: number) => {
  const u = rng(seed);
  const copy = [...xs];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(u() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
};

function tierOf(r: TennisMatchRow): string {
  if (r.tourneyLevel === 'G') return 'slam';
  if (/challenger/i.test(r.tourneyName)) return 'challenger';
  if (/\b125\b|125k/i.test(r.tourneyName)) return 'wta125';
  return 'tour';
}

function loadHistory(): Hist[] {
  const file = path.join(process.cwd(), 'data', 'tennis', 'api-tennis', 'cache.json');
  const rows = (JSON.parse(fs.readFileSync(file, 'utf8')) as { matches?: TennisMatchRow[] }).matches ?? [];
  const byEvent = new Map<string, TennisMatchRow[]>();
  for (const r of rows) {
    // Rows claiming more serve points won than played are feed errors.
    if (!(r.servePoints && r.servePoints > 0) || r.servePointsWon == null || r.servePointsWon > r.servePoints || !r.date) continue;
    const base = String(r.matchId).replace(/-[^-]+$/, '');
    byEvent.set(base, [...(byEvent.get(base) ?? []), r]);
  }
  const out: Hist[] = [];
  for (const [id, pair] of byEvent) {
    if (pair.length !== 2) continue;
    const [a, b] = pair as [TennisMatchRow, TennisMatchRow];
    const score = String(a.score || '');
    if (!score || isUnplayedTennisMatch(score) || tennisScoreIsRetired(score) || /\bdef\b/i.test(score)) continue;
    if (a.servePoints! < 20 || b.servePoints! < 20) continue;
    const sets = parseTennisSetsFromPlayerView(score, a.isWin).map((s) => ({ a: s.playerGames, b: s.opponentGames }));
    if (!sets.length) continue;
    out.push({
      id,
      date: String(a.date).slice(0, 10),
      tour: a.tour,
      tier: tierOf(a),
      surface: a.surface || 'Hard',
      bestOf: a.tour === 'ATP' && a.tourneyLevel === 'G' ? 5 : 3,
      a: a.playerId,
      b: b.playerId,
      nA: a.servePoints!,
      kA: a.servePointsWon!,
      nB: b.servePoints!,
      kB: b.servePointsWon!,
      sets,
      total: sets.reduce((s, x) => s + x.a + x.b, 0),
    });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

function chooseBaseline(matches: Hist[]) {
  let best: { opts: Parameters<typeof sequentialBaseline>[1]; dev: number; base: Baseline[] } | null = null;
  for (const alpha of [0.02, 0.04, 0.07, 0.1]) {
    for (const alphaSurface of [0, 0.02, 0.05]) {
      const opts = { alpha, alphaSurface, newcomer: 3 };
      const base = sequentialBaseline(matches, opts);
      const dev = baselineDeviance(matches.filter((m) => m.date < SELECT_TO), base, SELECT_FROM);
      console.log(`  baseline alpha ${alpha} surface ${alphaSurface}: deviance ${dev.toFixed(5)}`);
      if (!best || dev < best.dev) best = { opts, dev, base };
    }
  }
  return best!;
}

/** Total-games PMF at the baseline, integrated over the match effect (tau, rho) by Gauss-Hermite order 5. */
function totalPmf(lA: number, lB: number, tau: number, rho: number, bestOf: number): number[] {
  const { x, w } = hermegauss(5);
  const c = Math.sqrt(Math.max(0, 1 - rho * rho));
  let acc: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < (tau === 0 ? 1 : 5); j += 1) {
      const wt = tau === 0 ? 1 : w[i]! * w[j]!;
      if (tau === 0 && i > 0) break;
      const pA = expit(lA + tau * x[i]!);
      const pB = expit(lB + tau * (rho * x[i]! + c * x[j]!));
      const pmf = new MatchDist(matchArrays(pA, pB, bestOf)).tot;
      if (acc.length < pmf.length) acc = [...acc, ...new Array<number>(pmf.length - acc.length).fill(0)];
      pmf.forEach((v, k) => (acc[k]! += wt * v));
    }
  }
  const s = acc.reduce((a, v) => a + v, 0);
  return acc.map((v) => v / s);
}

function pitVariance(items: Array<{ pmf: number[]; total: number }>, seed: number): number {
  const u = rng(seed);
  const pits = items.map(({ pmf, total }) => {
    let below = 0;
    for (let k = 0; k < total && k < pmf.length; k += 1) below += pmf[k]!;
    return below + u() * (pmf[total] ?? 0);
  });
  const m = pits.reduce((a, v) => a + v, 0) / pits.length;
  return pits.reduce((a, v) => a + (v - m) ** 2, 0) / pits.length;
}

function main() {
  const t0 = Date.now();
  const hist = loadHistory();
  console.log(`matches ${hist.length} (${hist[0]?.date} .. ${hist.at(-1)?.date})`);
  const chosen = chooseBaseline(hist);
  console.log(`chosen baseline ${JSON.stringify(chosen.opts)} deviance ${chosen.dev.toFixed(5)}`);
  const baseById = new Map(chosen.base.map((b) => [b.id, b]));
  const later = hist.filter((m) => m.date >= FIT_FROM);
  const obsOf = (m: Hist): FitObs => ({ nA: m.nA, kA: m.kA, nB: m.nB, kB: m.kB, lA: baseById.get(m.id)!.lA, lB: baseById.get(m.id)!.lB });

  const pooled = fitTauRho(sample(later, POOLED_CAP, 1).map(obsOf));
  console.log(`pooled (n ${pooled.n}): tau ${pooled.tau.toFixed(3)} [${pooled.tauCi.map((v) => v.toFixed(3)).join(', ')}], rho ${pooled.rho.toFixed(2)} [${pooled.rhoCi.map((v) => v.toFixed(2)).join(', ')}]`);

  const groups: Record<string, ReturnType<typeof fitTauRho> & { matches: number }> = {};
  const keys = [...new Set(later.map((m) => `${m.tier}|${m.surface}`))];
  for (const key of keys) {
    const rows = later.filter((m) => `${m.tier}|${m.surface}` === key);
    if (rows.length < 500) continue;
    const fit = fitTauRho(sample(rows, GROUP_CAP, 2).map(obsOf));
    groups[key] = { ...fit, matches: rows.length };
    console.log(`  ${key} (${rows.length} matches, fit on ${fit.n}): tau ${fit.tau.toFixed(3)} [${fit.tauCi.map((v) => v.toFixed(3)).join(', ')}], rho ${fit.rho.toFixed(2)}`);
  }

  // PIT on total games by tier, at tau, 0.7 tau and 0 (pooled rho).
  const pit: Record<string, Record<string, number>> = {};
  const choice: Record<string, { tau: number; rho: number; scale: number }> = {};
  for (const tier of [...new Set(later.map((m) => m.tier))]) {
    const rows = sample(later.filter((m) => m.tier === tier), PIT_SAMPLE, 3);
    if (rows.length < 200) continue;
    const tierFits = Object.entries(groups).filter(([k]) => k.startsWith(`${tier}|`));
    const tau = tierFits.length ? tierFits.reduce((a, [, f]) => a + f.tau * f.matches, 0) / tierFits.reduce((a, [, f]) => a + f.matches, 0) : pooled.tau;
    const rho = pooled.rho;
    pit[tier] = {};
    let best = { scale: 1, gap: Infinity };
    for (const scale of [1, 0.7, 0]) {
      const v = pitVariance(rows.map((m) => ({ pmf: totalPmf(obsOf(m).lA, obsOf(m).lB, tau * scale, rho, m.bestOf), total: m.total })), 4);
      pit[tier][`tau x ${scale}`] = v;
      const gap = Math.abs(v - 1 / 12);
      if (gap < best.gap) best = { scale, gap };
    }
    choice[tier] = { tau: tau * best.scale, rho, scale: best.scale };
    console.log(`  PIT variance on totals, ${tier} (${rows.length}): ${Object.entries(pit[tier]).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', ')} (uniform 0.0833) -> scale ${best.scale}`);
  }

  // Set-level checks against the model at each match's baseline (match-level tau and rho only).
  const checks = sample(later.filter((m) => m.bestOf === 3), 1500, 5);
  const emp = { straight: 0, set1WinnerWinsSet2: 0, sets: 0, tiebreakSets: 0, bagelBreadstick: 0, twoPlus: 0 };
  const mod = { straight: 0, set1WinnerWinsSet2: 0, tiebreakSets: 0, bagelBreadstick: 0 };
  const { x, w } = hermegauss(5);
  const tauS = choice.tour?.tau ?? pooled.tau;
  const c = Math.sqrt(Math.max(0, 1 - pooled.rho * pooled.rho));
  for (const m of checks) {
    const o = obsOf(m);
    const won = m.sets.filter((s) => s.a > s.b).length;
    const lost = m.sets.filter((s) => s.b > s.a).length;
    if ((won === 2 && lost === 0) || (lost === 2 && won === 0)) emp.straight += 1;
    if (m.sets.length >= 2) {
      emp.twoPlus += 1;
      if ((m.sets[0]!.a > m.sets[0]!.b) === (m.sets[1]!.a > m.sets[1]!.b)) emp.set1WinnerWinsSet2 += 1;
    }
    for (const s of m.sets) {
      emp.sets += 1;
      if (s.a + s.b === 13) emp.tiebreakSets += 1;
      if ((s.a === 6 && s.b <= 1) || (s.b === 6 && s.a <= 1)) emp.bagelBreadstick += 1;
    }
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        const wt = w[i]! * w[j]!;
        const pA = expit(o.lA + tauS * x[i]!);
        const pB = expit(o.lB + tauS * (pooled.rho * x[i]! + c * x[j]!));
        const arrays = matchArrays(pA, pB, 3);
        const g = (k: string) => (arrays.get(k) ?? []).reduce((a, row) => a + row.reduce((s, v) => s + v, 0), 0);
        mod.straight += wt * (g('2,0') + g('0,2'));
        const pair = setPairProbs(pA, pB, NORMAL);
        const pairB = setPairProbs(pB, pA, NORMAL);
        mod.set1WinnerWinsSet2 += wt * (pair.winBoth + pairB.winBoth);
        const S = firstSetDist(pA, pB);
        mod.tiebreakSets += wt * ((S[7]?.[6] ?? 0) + (S[6]?.[7] ?? 0));
        mod.bagelBreadstick += wt * ((S[6]?.[0] ?? 0) + (S[6]?.[1] ?? 0) + (S[0]?.[6] ?? 0) + (S[1]?.[6] ?? 0));
      }
    }
  }
  const setChecks = {
    matches: checks.length,
    straightSets: { empirical: emp.straight / checks.length, model: mod.straight / checks.length },
    set1WinnerWinsSet2: { empirical: emp.set1WinnerWinsSet2 / emp.twoPlus, model: mod.set1WinnerWinsSet2 / checks.length },
    tiebreakSetRate: { empirical: emp.tiebreakSets / emp.sets, modelFirstSet: mod.tiebreakSets / checks.length },
    sixLoveOrOneRate: { empirical: emp.bagelBreadstick / emp.sets, modelFirstSet: mod.bagelBreadstick / checks.length },
  };
  console.log('set-level checks (best of 3):', JSON.stringify(setChecks, null, 1));

  const result = {
    fittedAt: new Date().toISOString(),
    source: 'data/tennis/api-tennis/cache.json',
    range: { from: hist[0]?.date, to: hist.at(-1)?.date, fitFrom: FIT_FROM, selectFrom: SELECT_FROM, selectTo: SELECT_TO },
    matches: hist.length,
    baseline: { ...chosen.opts, deviance: chosen.dev },
    pooled,
    groups,
    pit,
    pricing: choice,
    setChecks,
    note: 'History tau includes baseline error, so it is an upper bound for pricing against the market. pricing[tier] uses tau or 0.7 tau, whichever gives the PIT variance on totals closest to uniform.',
  };
  fs.writeFileSync(path.join(process.cwd(), 'lib', 'tennis', 'model', 'tauRho.json'), `${JSON.stringify(result, null, 1)}\n`);
  console.log(`wrote lib/tennis/model/tauRho.json in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();
