import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDesign, marketOnlyDesign, modelSpec, type BaseStat, type ModelLine } from './design';
import { fitResidual, fitWithCv, gameBootstrap, liftOverBaseline, logit, type Design } from './residual';

/** Seeded uniform and normal draws. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

const STATS: BaseStat[] = ['points', 'rebounds', 'assists', 'threeMade'];

/** Lines from a known truth: z = a*logit(fair) + b + c_min * minutes_z + c_use * usage_z. */
function synthetic(opts: { n: number; a: number; b: number; cMin: number; cUse: number; seed: number }): ModelLine[] {
  const r = makeRng(opts.seed);
  const out: ModelLine[] = [];
  for (let i = 0; i < opts.n; i += 1) {
    const fair = 0.3 + 0.4 * r.u();
    const minutes = r.n();
    const usage = r.n();
    const stat = STATS[i % 4]!;
    const z = opts.a * logit(fair) + opts.b + opts.cMin * minutes + (stat === 'rebounds' ? 0 : opts.cUse * usage);
    const p = 1 / (1 + Math.exp(-z));
    const day = Math.floor(i / 200);
    out.push({
      y: r.u() < p ? 1 : 0,
      fairOver: fair,
      stat,
      features: { minutes_new_info_z: minutes, usage_shift_z: usage },
      game: `g${Math.floor(i / 40)}`,
      subject: `p${i}`,
      date: `2026-11-${String(1 + (day % 28)).padStart(2, '0')}|${String(day).padStart(3, '0')}`,
      nBooks: 6 + (i % 5),
      bookDispersion: 0.01 + 0.02 * r.u(),
    });
  }
  return out;
}

const coef = (d: Design, theta: number[], name: string) => theta[d.params.findIndex((p) => p.name === name)]!;
const tiny = { a: 1e-3, b: 1e-3, bStat: 1e-3, c: 1e-3, control: 1e-3 };

test('fit recovers known coefficients (market weight, over/under bias, minutes, usage)', () => {
  const lines = synthetic({ n: 24000, a: 1, b: -0.15, cMin: 0.3, cUse: 0.2, seed: 1 });
  const d = buildDesign(lines);
  const theta = fitResidual(d, tiny);
  assert.ok(Math.abs(coef(d, theta, 'a') - 1) < 0.08, `a ${coef(d, theta, 'a')}`);
  assert.ok(Math.abs(coef(d, theta, 'b') + coef(d, theta, 'b_points') - -0.15) < 0.08, 'b for points');
  assert.ok(Math.abs(coef(d, theta, 'minutes_new_info') - 0.3) < 0.05, `minutes ${coef(d, theta, 'minutes_new_info')}`);
  assert.ok(Math.abs(coef(d, theta, 'usage_shift') - 0.2) < 0.05, `usage ${coef(d, theta, 'usage_shift')}`);
  assert.ok(Math.abs(coef(d, theta, 'usage_shift_reb')) < 0.06, 'rebounds usage has no true effect here');
});

test('sign bound: a feature whose data says "negative" stays at 0 when its direction is fixed', () => {
  const lines = synthetic({ n: 12000, a: 1, b: 0, cMin: -0.3, cUse: 0, seed: 2 });
  const d = buildDesign(lines);
  const theta = fitResidual(d, tiny);
  assert.ok(Math.abs(coef(d, theta, 'minutes_new_info')) < 1e-9, `minutes ${coef(d, theta, 'minutes_new_info')}`);
});

test('market-only truth: the fit stays on the market and features earn nothing', () => {
  const lines = synthetic({ n: 12000, a: 1, b: 0, cMin: 0, cUse: 0, seed: 3 });
  const d = buildDesign(lines);
  const fit = fitWithCv(d);
  assert.ok(Math.abs(coef(d, fit.theta, 'a') - 1) < 0.1);
  assert.ok(Math.abs(coef(d, fit.theta, 'minutes_new_info')) < 0.04);
  const base = marketOnlyDesign(lines, modelSpec(lines));
  const lift = liftOverBaseline(d, fit.oof, fitWithCv(base).oof);
  assert.ok(lift.lo <= 0, `no real feature: the lift interval must include 0 (${lift.lo}..${lift.hi})`);
});

test('real minutes effect: out-of-fold lift over market-only is clearly above 0', () => {
  const lines = synthetic({ n: 16000, a: 1, b: 0, cMin: 0.35, cUse: 0, seed: 4 });
  const spec = modelSpec(lines);
  const d = buildDesign(lines, spec);
  const fit = fitWithCv(d);
  const lift = liftOverBaseline(d, fit.oof, fitWithCv(marketOnlyDesign(lines, spec)).oof);
  assert.ok(lift.lo > 0, `lift ${lift.mean} (${lift.lo}..${lift.hi}) over ${lift.games} games`);
});

test('game bootstrap: constant per-game values give a zero-width interval', () => {
  const r = gameBootstrap([0.02, 0.02, 0.02, 0.02]);
  assert.equal(r.mean, 0.02);
  assert.equal(r.lo, 0.02);
  assert.equal(r.hi, 0.02);
});
