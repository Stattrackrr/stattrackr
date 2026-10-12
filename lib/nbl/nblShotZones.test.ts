import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyNblShotZone, nblShotCourtMetres } from './nblShotZones';

test('shot spot is metres from the left sideline and out from the baseline', () => {
  const spot = nblShotCourtMetres(10, 50);
  assert.equal(spot.across, 7.5);
  assert.ok(Math.abs(spot.depth - 2.8) < 1e-9);
  assert.deepEqual(nblShotCourtMetres(0, 0), { across: 0, depth: 0 });
});

test('shots at the far end flip onto the same half court', () => {
  assert.deepEqual(nblShotCourtMetres(90, 50), nblShotCourtMetres(10, 50));
  assert.deepEqual(nblShotCourtMetres(95, 80), nblShotCourtMetres(5, 20));
});

test('a left-side spot lands in the zone chart drawn on the left', () => {
  const { across } = nblShotCourtMetres(3, 5);
  assert.ok(across < 7.5);
  assert.equal(classifyNblShotZone({ x: 3, y: 5, eventType: '3pt' }), 'leftCorner3');
});
