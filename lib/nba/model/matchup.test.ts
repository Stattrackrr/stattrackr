import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probsAt, sizeFromSpread } from './clv';
import { altitudeVisitor, chancesGap, comboGapZ, fatigue, impliedMean, opponentAbsence, positionGroups, type ChanceGame } from './matchup';

test('position groups read the common spellings', () => {
  assert.deepEqual([...positionGroups('G')], ['G']);
  assert.deepEqual([...positionGroups('F-C')].sort(), ['C', 'F']);
  assert.deepEqual([...positionGroups('PG')], ['G']);
  assert.deepEqual([...positionGroups('Center')], ['C']);
  assert.equal(positionGroups(null).size, 0);
});

test('opponent absence: minutes as starters out, at his position, and the share of each stat', () => {
  const team = { points: 110, rebounds: 44, assists: 25, threeMade: 13 };
  const center = { id: 'c', pOut: 1, minutes: 32, position: 'C', statPerGame: { points: 16, rebounds: 11, assists: 2, threeMade: 0 } };
  const guard = { id: 'g', pOut: 0.5, minutes: 32, position: 'G', statPerGame: { points: 20, rebounds: 4, assists: 6, threeMade: 3 } };
  const forBig = opponentAbsence([center, guard], team, 'F-C');
  assert.equal(forBig.startersOut, 1.5);
  assert.equal(forBig.positionStartersOut, 1);
  assert.ok(Math.abs(forBig.shareOut.rebounds - 13 / 44) < 1e-9);
  assert.equal(opponentAbsence([center], team, null).positionStartersOut, null);
});

test('fatigue: rest days, games in the last 6 nights, and the road trip so far', () => {
  const past = [
    { date: '2026-11-01', home: true },
    { date: '2026-11-03', home: false },
    { date: '2026-11-05', home: false },
    { date: '2026-11-06', home: false },
  ];
  assert.deepEqual(fatigue(past, '2026-11-07', false), { restDays: 1, gamesLast6: 4, roadTrip: 4 });
  assert.deepEqual(fatigue(past, '2026-11-09', true), { restDays: 3, gamesLast6: 3, roadTrip: 0 });
  assert.deepEqual(fatigue([], '2026-11-09', null), { restDays: null, gamesLast6: 1, roadTrip: null });
  assert.equal(altitudeVisitor('DEN', 'LAL'), true);
  assert.equal(altitudeVisitor('DEN', 'DEN'), false);
});

test('chances gap: a cold rebounder with steady chances shows a positive gap', () => {
  const game = (reb: number, chances: number): ChanceGame => ({ points: 10, rebounds: reb, assists: 2, threeMade: 1, potentialRebounds: chances, passes: 30, fgAttempted: 8, ftAttempted: 2, threeAttempted: 3 });
  const games = [...Array.from({ length: 20 }, () => game(10, 16)), ...Array.from({ length: 10 }, () => game(7, 16))];
  const gap = chancesGap(games, 'rebounds')!;
  const conv = (20 * 10 + 10 * 7) / (30 * 16);
  assert.ok(Math.abs(gap - (16 * conv - 7)) < 1e-9);
  assert.ok(gap > 0);
  assert.equal(chancesGap(games.slice(0, 10), 'rebounds'), null);
});

test('combo gap: zero when the combo is priced from the same means, positive when the combo line is low', () => {
  const part = (mean: number, sd: number, line: number) => {
    const k = sizeFromSpread(mean, sd * sd);
    const p = probsAt(mean, k, line);
    return { fairOver: p.over / (p.over + p.under), line, mean, variance: sd * sd };
  };
  const pts = part(22, 6, 21.5);
  const reb = part(8, 3, 7.5);
  assert.ok(Math.abs(impliedMean(pts) - 22) < 0.01);
  const fair = part(30, 7, 29.5);
  assert.ok(Math.abs(comboGapZ(fair, [pts, reb])!) < 0.01);
  const low = part(27, 7, 29.5);
  assert.ok(comboGapZ(low, [pts, reb])! > 0.4);
});
