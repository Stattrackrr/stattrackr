import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseMinutes, FITTED_MINUTES_COEFS as C, minutesNewInfoZ, NEUTRAL_MINUTES_COEFS, startedShare, tonightMinutes, type MinutesGame, type MinutesTonight } from './minutes';

const bench = (n: number, minutes = 20): MinutesGame[] => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, minutes, started: false }));
const starter = (n: number, minutes = 34): MinutesGame[] => bench(n, minutes).map((g) => ({ ...g, started: true }));
const quiet: MinutesTonight = { startsTonight: null, gamesSinceReturn: null, backToBack: false, absSpread: null, teammateMinutesOut: 0 };

test('recent minutes: weighted toward the last few games', () => {
  assert.equal(baseMinutes(bench(6)), 20);
  const rising = [...bench(5, 20), ...bench(3, 32)];
  assert.ok(baseMinutes(rising)! > 26, 'the role change shows within 3 games');
  assert.equal(baseMinutes([]), null);
});

test('no new information: tonight equals his recent minutes and the feature is 0', () => {
  const est = tonightMinutes(bench(8), quiet, C)!;
  assert.equal(est.tonight, est.base);
  assert.equal(minutesNewInfoZ(est, 0.5, 5), 0);
  assert.equal(tonightMinutes(bench(8), { ...quiet, startsTonight: true }, NEUTRAL_MINUTES_COEFS)!.tonight, 20, 'neutral coefficients change nothing');
});

test('a bench player starting tonight gets more minutes; a starter moved to the bench fewer', () => {
  assert.equal(startedShare(bench(8)), 0);
  const up = tonightMinutes(bench(8), { ...quiet, startsTonight: true }, C)!;
  assert.ok(Math.abs(up.tonight - 20 * C.promoted) < 1e-9);
  assert.ok(minutesNewInfoZ(up, 0.5, 5) > 0);
  const down = tonightMinutes(starter(8), { ...quiet, startsTonight: false }, C)!;
  assert.ok(Math.abs(down.tonight - 34 * C.demoted) < 1e-9);
  assert.equal(tonightMinutes(starter(8), { ...quiet, startsTonight: true }, C)!.parts.starter, undefined, 'a regular starter starting is not news');
});

test('blowout risk only trims heavy-minute players, and only past a 6-point spread', () => {
  assert.equal(tonightMinutes(starter(8), { ...quiet, absSpread: 5 }, C)!.parts.blowout, undefined);
  assert.ok(tonightMinutes(starter(8), { ...quiet, absSpread: 14 }, C)!.tonight < 34);
  assert.equal(tonightMinutes(bench(8), { ...quiet, absSpread: 14 }, C)!.parts.blowout, undefined);
});

test('rotation teammates out add minutes in proportion to his share of team minutes', () => {
  const est = tonightMinutes(bench(8), { ...quiet, teammateMinutesOut: 30 }, C)!;
  assert.ok(Math.abs(est.tonight - (20 + C.teammate * 30 * (20 / 240))) < 1e-9);
});
