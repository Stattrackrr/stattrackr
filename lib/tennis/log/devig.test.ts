import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devigTwoWay } from './devig';

test('every method sums to 1 and keeps the favourite the favourite', () => {
  for (const [a, b] of [
    [1.25, 3.9],
    [1.87, 1.95],
    [3.3, 1.33],
  ] as const) {
    const d = devigTwoWay(a, b)!;
    for (const m of ['mult', 'power', 'shin', 'logit'] as const) {
      assert.ok(Math.abs(d[m][0] + d[m][1] - 1) < 1e-9, `${m} sums to 1`);
      assert.equal(d[m][0] > d[m][1], a < b, `${m} order`);
    }
    assert.ok(d.overround > 1);
  }
});

test('a fair pair is returned unchanged by every method', () => {
  const d = devigTwoWay(2, 2)!;
  for (const m of ['mult', 'power', 'shin', 'logit'] as const) assert.ok(Math.abs(d[m][0] - 0.5) < 1e-9);
  const e = devigTwoWay(1.25, 5)!;
  for (const m of ['mult', 'power', 'shin', 'logit'] as const) assert.ok(Math.abs(e[m][0] - 0.8) < 1e-9, `${m} no margin`);
});

test('favourite-longshot: power and Shin take more margin off the longshot than multiplicative', () => {
  const d = devigTwoWay(1.12, 6.5)!;
  assert.ok(d.power[1] < d.mult[1]);
  assert.ok(d.shin[1] < d.mult[1]);
  assert.equal(devigTwoWay(1, 2), null);
});
