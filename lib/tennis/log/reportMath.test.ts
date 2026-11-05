import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusteredMean, executableAfter, fitInformation, informationWithCi, mdePlan, normInv, priceAt, type InfoRow } from './reportMath';

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Synthetic sides where the truth is logit(q) + gammaTrue * edge. */
function synth(gammaTrue: number, matches: number, seed = 3): InfoRow[] {
  const u = rng(seed);
  const rows: InfoRow[] = [];
  for (let m = 0; m < matches; m += 1) {
    for (let k = 0; k < 4; k += 1) {
      const q = 0.25 + 0.5 * u();
      const edge = (u() - 0.5) * 0.4;
      const p = 1 / (1 + Math.exp(-(Math.log(q / (1 - q)) + gammaTrue * edge)));
      rows.push({ match: `m${m}`, y: u() < p ? 1 : 0, q, edge, price: 1 / (q * 1.05) });
    }
  }
  return rows;
}

test('information regression recovers gamma near 0 and near 1', () => {
  assert.ok(Math.abs(fitInformation(synth(0, 4000)).gamma) < 0.35);
  assert.ok(fitInformation(synth(1, 4000, 9)).gamma > 0.6);
});

test('information interval needs at least 20 matches', () => {
  assert.equal(informationWithCi(synth(0, 10)), null);
  const r = informationWithCi(synth(1, 300), 0.03, 100)!;
  assert.ok(r.gammaLo < r.gamma && r.gammaHi > r.gamma);
});

test('pilot MDE scales with 1/sqrt(matches)', () => {
  assert.ok(Math.abs(normInv(0.975) - 1.96) < 1e-3);
  const plan = mdePlan(0.02, 200, 800);
  assert.ok(Math.abs(plan.mdeAtHorizon - (normInv(1 - 0.05 / 3) + normInv(0.8)) * 0.02 * 0.5) < 1e-9);
  assert.ok(plan.matchesFor['0.040']! > plan.matchesFor['0.060']!);
});

test('availability reads the last change at or before t; shortened or withdrawn is not executable', () => {
  const h = [
    { ms: 0, price: 2.0 },
    { ms: 5 * 60_000, price: 1.95 },
    { ms: 8 * 60_000, price: 0 },
  ];
  assert.equal(priceAt(h, -1), null);
  assert.equal(priceAt(h, 6 * 60_000), 1.95);
  assert.equal(executableAfter(h, 0, 2.0, 4), true);
  assert.equal(executableAfter(h, 0, 2.0, 6), false);
  assert.equal(executableAfter(h, 0, 1.9, 10), false);
});

test('clustered mean gives an interval around the mean', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ match: `m${i % 20}`, v: i % 2 ? 0.1 : -0.1 }));
  const r = clusteredMean(rows);
  assert.ok(Math.abs(r.mean) < 1e-9);
  assert.ok(r.lo <= r.mean && r.hi >= r.mean);
});
