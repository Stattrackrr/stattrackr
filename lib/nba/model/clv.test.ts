import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clvSplit, fairAtLine, probsAt, sizeFromSpread, solveMeanForFair } from './clv';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('size from spread: Poisson when not over-dispersed', () => {
  assert.equal(sizeFromSpread(5, 5), Number.POSITIVE_INFINITY);
  near(sizeFromSpread(10, 20), 10);
});

test('solving the mean reproduces the fair price at its own line', () => {
  for (const [fair, line, k] of [[0.55, 8.5, 6], [0.4, 24.5, 15], [0.62, 2.5, Infinity]] as const) {
    const mu = solveMeanForFair(fair, k, line);
    const p = probsAt(mu, k, line);
    near(p.over / (p.over + p.under), fair, 1e-6);
  }
});

test('same half-point line: CLV is fair x price - 1 and does not depend on k', () => {
  const base = { side: 'over' as const, price: 2.1, line: 8.5, fairNow: 0.5, lineNow: 8.5, fairClose: 0.52, lineClose: 8.5 };
  for (const k of [3, 10, Infinity]) {
    const r = clvSplit({ ...base, k });
    near(r.total, 0.52 * 2.1 - 1);
    near(r.a, 0.5 * 2.1 - 1);
    near(r.a + r.b, r.total);
  }
});

test('line moved: the close is carried to the bet line (over 8.5 bet, market closed 9.5 at 50/50)', () => {
  const k = 8;
  const at = fairAtLine(0.5, 9.5, 8.5, k);
  assert.ok(at.over > 0.5, 'the close at 9.5 makes over 8.5 better than a coin flip');
  near(at.over + at.under + at.push, 1);
  const r = clvSplit({ side: 'over', price: 1.9, line: 8.5, fairNow: 0.5, lineNow: 8.5, fairClose: 0.5, lineClose: 9.5, k });
  assert.ok(r.b > 0, 'the market moving up after an over bet is positive drift');
  // Sensitivity: a k far off moves the number but not the sign here.
  for (const kk of [k * 0.8, k * 1.25]) assert.ok(clvSplit({ side: 'over', price: 1.9, line: 8.5, fairNow: 0.5, lineNow: 8.5, fairClose: 0.5, lineClose: 9.5, k: kk }).b > 0);
});

test('whole line: a push refunds the stake', () => {
  const p = fairAtLine(0.5, 9.5, 9, 6);
  assert.ok(p.push > 0);
  const r = clvSplit({ side: 'under', price: 2, line: 9, fairNow: 0.5, lineNow: 9.5, fairClose: 0.5, lineClose: 9.5, k: 6 });
  near(r.total, p.under * 2 + p.push - 1);
});
