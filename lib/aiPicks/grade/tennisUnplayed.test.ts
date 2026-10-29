import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiPickLeg } from '@/lib/aiPicks/types';
import { isNotPlayedTennisStatus } from '@/lib/tennis/chartStats';
import { gradeTennisLeg } from './tennis';

test('tennis statuses that void a bet: walkover, withdrawal, cancelled, abandoned; postponed waits', () => {
  for (const s of ['Walk Over', 'Walkover', 'W/O', 'wo', 'Cancelled', 'Canceled', 'Withdrawn', 'Abandoned']) {
    assert.equal(isNotPlayedTennisStatus(s), true, s);
  }
  for (const s of ['Finished', 'Retired', 'Postponed', 'Set 2', '', null]) {
    assert.equal(isNotPlayedTennisStatus(s), false, String(s));
  }
});

test('a walkover voids the leg on the next grade run instead of waiting four days', () => {
  const leg = {
    sport: 'tennis',
    eventKey: '12175298',
    playerId: '509',
    team: 'K. Siniakova',
    startsAt: '2026-10-29T05:00:00Z',
    market: 'game_handicap',
    side: 'yes',
    line: 3.5,
  } as AiPickLeg;
  const now = Date.parse('2026-10-29T14:00:00Z');
  assert.equal(gradeTennisLeg(leg, new Map(), now), null, 'no result and no status yet: wait');
  assert.deepEqual(gradeTennisLeg(leg, new Map(), now, new Map([['12175298', 'Walk Over']])), {
    status: 'void',
    value: null,
    note: 'Match not played (Walk Over)',
  });
});
