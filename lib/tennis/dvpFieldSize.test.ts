import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlausibleTennisDvpField, type TennisCachedDvpEvent } from './dvpLiveCache';

const event = (fieldSize: number): TennisCachedDvpEvent => ({
  tour: 'ATP',
  stage: 'main',
  tournamentKey: '1667',
  tournamentName: 'Shanghai',
  fieldSize,
  topSeed: null,
  windows: {},
});

test('a live Masters field with qualifiers (Shanghai, 132) is accepted', () => {
  assert.equal(isPlausibleTennisDvpField(event(132)), true);
});

test('a Slam main draw plus qualifying is accepted', () => {
  assert.equal(isPlausibleTennisDvpField(event(240)), true);
});

test('empty or whole-tour fields are rejected', () => {
  assert.equal(isPlausibleTennisDvpField(event(2)), false);
  assert.equal(isPlausibleTennisDvpField(event(500)), false);
  assert.equal(isPlausibleTennisDvpField(null), false);
});
