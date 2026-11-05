import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NORMAL } from './pricing';
import { baselineDeviance, fitTauRho, sequentialBaseline, setPairProbs, type FitObs, type HistMatch } from './serveFit';

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { u, n: () => Math.sqrt(-2 * Math.log(u() + 1e-300)) * Math.cos(2 * Math.PI * u()) };
}
const expit = (x: number) => 1 / (1 + Math.exp(-x));
const binom = (n: number, p: number, u: () => number) => {
  let k = 0;
  for (let i = 0; i < n; i += 1) if (u() < p) k += 1;
  return k;
};

test('tau and rho are recovered when the baseline is the truth', () => {
  const r = rng(1);
  const obs: FitObs[] = [];
  const tau = 0.25;
  const rho = 0.5;
  for (let i = 0; i < 1500; i += 1) {
    const lA = 0.4 + 0.3 * r.n();
    const lB = 0.4 + 0.3 * r.n();
    const zA = r.n();
    const uA = tau * zA;
    const uB = tau * (rho * zA + Math.sqrt(1 - rho * rho) * r.n());
    const nA = 60 + Math.floor(r.u() * 40);
    const nB = 60 + Math.floor(r.u() * 40);
    obs.push({ nA, nB, kA: binom(nA, expit(lA + uA), r.u), kB: binom(nB, expit(lB + uB), r.u), lA, lB });
  }
  const fit = fitTauRho(obs);
  assert.ok(Math.abs(fit.tau - tau) < 0.06, `tau ${fit.tau}`);
  assert.ok(Math.abs(fit.rho - rho) < 0.25, `rho ${fit.rho}`);
  assert.ok(fit.tauCi[0] <= fit.tau && fit.tau <= fit.tauCi[1]);
  const none = fitTauRho(obs.map((o) => ({ ...o, kA: binom(o.nA, expit(o.lA), r.u), kB: binom(o.nB, expit(o.lB), r.u) })));
  assert.ok(none.tau < 0.08, `no match effect: tau ${none.tau}`);
});

test('the sequential baseline learns player strengths and never uses same-day results', () => {
  const r = rng(2);
  const players = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, s: 0.3 * r.n(), t: 0.3 * r.n() }));
  const matches: HistMatch[] = [];
  for (let d = 0; d < 300; d += 1) {
    const date = `2025-${String(1 + Math.floor(d / 28)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}`;
    for (let j = 0; j < 8; j += 1) {
      const a = players[Math.floor(r.u() * 40)]!;
      let b = players[Math.floor(r.u() * 40)]!;
      if (b === a) b = players[(players.indexOf(a) + 1) % 40]!;
      const lA = 0.45 + a.s - b.t;
      const lB = 0.45 + b.s - a.t;
      matches.push({ id: `${d}-${j}`, date, tour: 'ATP', tier: 'tour', surface: 'Hard', bestOf: 3, a: a.id, b: b.id, nA: 80, kA: binom(80, expit(lA), r.u), nB: 80, kB: binom(80, expit(lB), r.u) });
    }
  }
  const learned = sequentialBaseline(matches, { alpha: 0.05, alphaSurface: 0, newcomer: 3 });
  const flat = matches.map((m) => ({ id: m.id, lA: 0.45, lB: 0.45 }));
  assert.ok(baselineDeviance(matches, learned, '2025-06-01') < baselineDeviance(matches, flat, '2025-06-01'), 'beats a flat baseline');
  // Same-day results don't leak: changing a match's outcome can't change another same-day prediction.
  const changed = matches.map((m, i) => (i === 1 ? { ...m, kA: 0 } : m));
  const again = sequentialBaseline(changed, { alpha: 0.05, alphaSurface: 0, newcomer: 3 });
  assert.equal(again[0]!.lA, learned[0]!.lA);
  const sameDay = matches.filter((m) => m.date === matches[1]!.date).map((m) => m.id);
  const byId = (rows: typeof learned) => new Map(rows.map((x) => [x.id, x.lA]));
  for (const id of sameDay) assert.equal(byId(again).get(id), byId(learned).get(id));
});

test('set pair probabilities: equal players win half the sets; winning both is less than winning one', () => {
  const even = setPairProbs(0.62, 0.62, NORMAL);
  assert.ok(Math.abs(even.winSet - 0.5) < 1e-9);
  assert.ok(even.winBoth < even.winSet && even.winBoth > 0.2);
  const strong = setPairProbs(0.7, 0.58, NORMAL);
  assert.ok(strong.winSet > 0.7);
});
