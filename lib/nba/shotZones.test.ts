import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nbaShotDistanceFt, nbaShotZone } from './shotZones';

test('shot zones: rim, paint, mid-range', () => {
  assert.equal(nbaShotZone(26, 2, false), 'restricted');
  assert.equal(nbaShotZone(30, 10, false), 'paint');
  assert.equal(nbaShotZone(40, 14, false), 'mid_range');
  assert.equal(nbaShotZone(24, 14, false), 'paint');
});

test('shot zones: corner and above-the-break threes', () => {
  assert.equal(nbaShotZone(2, 4, true), 'left_corner_3');
  assert.equal(nbaShotZone(48, 6, true), 'right_corner_3');
  assert.equal(nbaShotZone(33, 25, true), 'above_break_3');
  assert.equal(nbaShotZone(25, 60, true), 'backcourt');
});

test('shot distance matches play text within a foot', () => {
  assert.ok(Math.abs(nbaShotDistanceFt(32, 25) - 25) < 1);
  assert.ok(Math.abs(nbaShotDistanceFt(2, 4) - 23) < 1);
  assert.ok(Math.abs(nbaShotDistanceFt(24, 14) - 13) < 1);
});
