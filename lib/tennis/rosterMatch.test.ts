import assert from 'node:assert/strict';
import test from 'node:test';
import { findTennisRosterPlayer } from './rosterMatch';

const zverev = {
  playerId: '1905',
  name: 'Alexander Zverev',
  tour: 'ATP',
  team: 'ATP',
  jersey: '3',
  rank: 3,
};
const wu = {
  playerId: '1130',
  name: 'Yibing Wu',
  tour: 'ATP',
  team: 'ATP',
  jersey: '113',
  rank: 113,
};

test('abbreviated dashboard names resolve to the roster player', () => {
  const hit = findTennisRosterPlayer([zverev, wu], {
    playerId: '1905',
    name: 'A. Zverev',
    team: 'ATP',
  });
  assert.equal(hit?.playerId, '1905');
  assert.equal(hit?.jersey, '3');
});

test('id still wins when the URL name is abbreviated', () => {
  const hit = findTennisRosterPlayer([zverev, wu], {
    playerId: '1905',
    name: 'A. Zverev',
  });
  assert.equal(hit?.name, 'Alexander Zverev');
});

test('name-only abbreviated match still finds the ranked player', () => {
  const hit = findTennisRosterPlayer([zverev, wu], { name: 'A. Zverev', team: 'ATP' });
  assert.equal(hit?.playerId, '1905');
});
