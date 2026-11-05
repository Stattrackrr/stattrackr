import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HISTORY_POUT_RATES, missedBin, pOut } from './pOut';
import { absentShare, POOLED_USAGE_BETA, usageDelta, usageShiftZ } from './usage';

test('P(out): designation first (provisional), otherwise games missed in a row', () => {
  assert.equal(pOut({ missedInRow: 0, designation: 'out' }).basis, 'designation');
  assert.ok(pOut({ missedInRow: 0, designation: 'out' }).p > 0.9);
  assert.ok(pOut({ missedInRow: 0, designation: 'questionable' }).p < pOut({ missedInRow: 0, designation: 'doubtful' }).p);
  assert.equal(pOut({ missedInRow: 0 }).p, HISTORY_POUT_RATES[0]);
  assert.equal(pOut({ missedInRow: 4 }).p, HISTORY_POUT_RATES[3]);
  assert.equal(missedBin(12), 4);
  assert.ok(pOut({ missedInRow: 0, mayNotPlay: true }).p >= 0.3, "RotoWire's may-not-play tag raises it");
});

test('usage: absent share weights each teammate by his chance of sitting', () => {
  const share = absentShare(
    [
      { id: 'a', pOut: 1, statPerGame: { points: 22 } },
      { id: 'b', pOut: 0.5, statPerGame: { points: 10 } },
    ],
    110,
    'points'
  );
  assert.ok(Math.abs(share - 27 / 110) < 1e-12);
  assert.equal(absentShare([{ id: 'a', pOut: 1, statPerGame: { points: 200 } }], 110, 'points'), 0.6, 'capped');
});

test('usage: pooled shift raises points and assists, leaves rebounds and threes alone', () => {
  assert.ok(usageDelta(0.5, 30, 0.2, 'points') > 0);
  assert.ok(Math.abs(usageDelta(0.5, 30, 0.2, 'points') - 0.5 * 30 * POOLED_USAGE_BETA.points * 0.2) < 1e-12);
  assert.equal(usageDelta(0.3, 30, 0.2, 'rebounds'), 0);
  assert.equal(usageDelta(0.1, 30, 0.2, 'threeMade'), 0);
  assert.equal(usageShiftZ(1, 0), 0);
});
