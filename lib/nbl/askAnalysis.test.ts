import assert from 'node:assert/strict';
import test from 'node:test';
import { nblLineRead, nblStatFromQuestion } from './askAnalysis';
import type { NblGameLogRow } from './rosettaTypes';

test('combo stats are read before single stats', () => {
  assert.equal(nblStatFromQuestion('rebounds + assists over 6.5?'), 'ra');
  assert.equal(nblStatFromQuestion('points and rebounds tonight'), 'pr');
  assert.equal(nblStatFromQuestion('PRA line?'), 'pra');
  assert.equal(nblStatFromQuestion('how many threes will he hit'), 'threeMade');
  assert.equal(nblStatFromQuestion('will he get 20+ points'), 'points');
  assert.equal(nblStatFromQuestion('what would you take?'), null);
});

function game(i: number, points: number, opponentCode = 'PER'): NblGameLogRow {
  return {
    matchId: `m${i}`,
    date: `2026-09-${String(10 + i).padStart(2, '0')}T08:00:00Z`,
    season: 2026,
    opponentCode,
    minutes: 25,
    points,
    result: 'W 90-80',
  } as unknown as NblGameLogRow;
}

test('a short history is labelled by the games he actually played', () => {
  const games = [game(1, 12), game(2, 8), game(3, 14, 'SYD'), game(4, 6)];
  const read = nblLineRead(games, 'points', 9.5, 'SYD');
  assert.ok(read);
  assert.deepEqual(
    read.windows.map((w) => [w.window, w.overs, w.games]),
    [
      ['last 4 games', 2, 4],
      ['this season', 2, 4],
      ['against Sydney Kings', 1, 1],
    ]
  );
  assert.equal(read.run, null);
});

test('over/under run counts back from the newest game', () => {
  const games = [game(1, 4), game(2, 12), game(3, 13), game(4, 15)];
  assert.equal(nblLineRead(games, 'points', 9.5, null)?.run, 'over 9.5 in his last 3 in a row');
});
