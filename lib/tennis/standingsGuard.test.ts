import assert from 'node:assert/strict';
import test from 'node:test';
import { pickStandings } from './dashboardCache';
import { tennisStandingRows } from './ingest';
import type { TennisRankingRow } from './types';

function rows(n: number): TennisRankingRow[] {
  return Array.from({ length: n }, (_, i) => ({
    pos: i + 1,
    playerId: String(1000 + i),
    name: `Player ${i + 1}`,
    tour: 'ATP' as const,
    points: 1000 - i,
    ioc: null,
  }));
}

test('an API error payload yields no standings rows', () => {
  assert.deepEqual(tennisStandingRows({ success: 0, result: [{ msg: 'limit' }] }), []);
  assert.deepEqual(tennisStandingRows({ success: 1, result: [{ place: 0 }] }), []);
  assert.equal(
    tennisStandingRows({
      success: 1,
      result: [{ place: 1, player: 'Jannik Sinner', player_key: 2072, country: 'Italy', points: '11000' }],
    }).length,
    1
  );
});

test('a stub standings list never replaces the stored one', () => {
  const stub: TennisRankingRow[] = [
    { pos: 0, playerId: 'undefined', name: '', tour: 'ATP', points: null, ioc: null },
  ];
  assert.equal(pickStandings(stub, rows(500)).length, 500);
  assert.equal(pickStandings(rows(10), rows(500)).length, 500);
});

test('a full fresh list replaces the stored one, and stubs are cleaned out', () => {
  assert.equal(pickStandings(rows(400), rows(500)).length, 400);
  const stub: TennisRankingRow[] = [
    { pos: 0, playerId: 'undefined', name: '', tour: 'ATP', points: null, ioc: null },
  ];
  assert.equal(pickStandings(stub, stub).length, 0);
});
