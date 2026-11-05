import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivationVerdict, flexibleR2, independentMoveShare, rmsWithCi, type MisfitRow } from './derivation';

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

/** Synthetic Pinnacle markets. kind: 'noise' (derived, misfit = rounding noise only), 'model' (derived by a
 * different model: systematic misfit, a smooth function of the inputs), 'independent' (own information). */
function rows(kind: 'noise' | 'model' | 'independent', n: number, sigma: number, seed: number): MisfitRow[] {
  const r = rng(seed);
  const out: MisfitRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const logitWin = 1.2 * r.n();
    const totalLine = 21 + Math.round(3 * r.n()) + 0.5;
    const hcpLine = -Math.round(2 * logitWin) - 0.5;
    const noise = 0.01 * r.n();
    const systematic = kind === 'model' ? 0.08 * logitWin * logitWin - 0.02 * (totalLine - 21) : 0;
    const info = kind === 'independent' ? sigma * r.n() : 0;
    const misfit = noise + systematic + info;
    out.push({ match: `m${i}`, tier: 'tour', z: misfit / 0.01, misfit, logitWin, totalLine, hcpLine });
  }
  return out;
}

test('noise-level misfits are called derived by the equivalence test', () => {
  const v = derivationVerdict('tour', rows('noise', 400, 0, 1), null);
  assert.equal(v.equivalent, true, `rms ${v.rms} hi ${v.rmsHi}`);
  assert.equal(v.derived, true);
});

test('a different model behind Pinnacle: misfits are large but deterministic, so the regression calls it derived', () => {
  const data = rows('model', 400, 0, 2);
  const v = derivationVerdict('tour', data, null);
  assert.equal(v.equivalent, false);
  assert.ok(v.r2 > 0.8, `R2 ${v.r2}`);
  assert.equal(v.derived, true);
});

test('independent information: neither test calls it derived, across noise levels (power)', () => {
  for (const sigma of [0.03, 0.06, 0.1]) {
    const v = derivationVerdict('tour', rows('independent', 400, sigma, 3), null);
    assert.equal(v.derived, false, `sigma ${sigma}: rms ${v.rms}, R2 ${v.r2}`);
  }
  assert.ok(flexibleR2(rows('independent', 400, 0.06, 4)) < 0.2);
});

test('event study: derivative moves alone vs with the winner or total', () => {
  const r = independentMoveShare([
    { match: 'a', pollAt: 't1', market: 'derivative' },
    { match: 'a', pollAt: 't1', market: 'winner' },
    { match: 'a', pollAt: 't2', market: 'derivative' },
    { match: 'b', pollAt: 't1', market: 'total' },
  ]);
  assert.equal(r.derivativeMoves, 2);
  assert.equal(r.share, 0.5);
  assert.ok(Number.isNaN(rmsWithCi([]).lo));
});
