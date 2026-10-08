import assert from 'node:assert/strict';
import test from 'node:test';
import { fillTennisPlayerRanks, takeCurrentTennisRoster } from './loadCached';
import type { TennisPlayer } from './types';

const zverev: TennisPlayer = {
  playerId: '1905',
  name: 'Alexander Zverev',
  tour: 'ATP',
  ioc: 'GER',
  hand: 'R',
  height: null,
  rank: null,
  rankPoints: null,
};

test('Redis roster ranks are filled from standings pos', () => {
  const [next] = fillTennisPlayerRanks([zverev], {
    ATP: [
      {
        pos: 3,
        playerId: '1905',
        name: 'Alexander Zverev',
        tour: 'ATP',
        points: 5000,
        ioc: 'GER',
      },
    ],
  });
  assert.equal(next.rank, 3);
});

test('stub Redis standings do not wipe the current roster', () => {
  const current = takeCurrentTennisRoster([{ ...zverev, rank: 2 }], {
    ATP: [
      {
        pos: 1,
        playerId: 'missing',
        name: 'Nobody',
        tour: 'ATP',
        points: 1,
        ioc: null,
      },
    ],
    WTA: [
      {
        pos: 1,
        playerId: 'also-missing',
        name: 'Nobody',
        tour: 'WTA',
        points: 1,
        ioc: null,
      },
    ],
  });
  assert.equal(current.length, 1);
  assert.equal(current[0].playerId, '1905');
});

test('players that already have a rank are left alone', () => {
  const [next] = fillTennisPlayerRanks([{ ...zverev, rank: 2 }], {
    ATP: [
      {
        pos: 99,
        playerId: '1905',
        name: 'Alexander Zverev',
        tour: 'ATP',
        points: 1,
        ioc: 'GER',
      },
    ],
  });
  assert.equal(next.rank, 2);
});
