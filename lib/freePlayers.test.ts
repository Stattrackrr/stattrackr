import test from 'node:test';
import assert from 'node:assert/strict';
import { freePlayerPicksFor, isFreePlayerPick, type FreePlayerPicks } from './freePlayers';

const picks: FreePlayerPicks = {
  nba: { sport: 'nba', name: 'Shai Gilgeous-Alexander', id: '175', href: '/nba/research/dashboard?name=x' },
  atp: { sport: 'atp', name: 'A. Gea', id: '2101', href: '/tennis?player=2101' },
  wta: { sport: 'wta', name: 'Iga Świątek', id: '3001', href: '/tennis?player=3001' },
};

test('matches the free player by name, ignoring case and accents', () => {
  assert.equal(isFreePlayerPick(picks, ['nba'], { name: 'shai gilgeous-alexander' }), true);
  assert.equal(isFreePlayerPick(picks, ['wta'], { name: 'Iga Swiatek' }), true);
});

test('matches an initial against a full first name, but not a different initial', () => {
  assert.equal(isFreePlayerPick(picks, ['atp'], { name: 'Arthur Gea' }), true);
  assert.equal(isFreePlayerPick(picks, ['atp'], { name: 'B. Gea' }), false);
});

test('matches by id when the names are spelled differently', () => {
  assert.equal(isFreePlayerPick(picks, ['atp'], { name: 'Gea Arthur', id: 2101 }), true);
});

test('any other player is not free', () => {
  assert.equal(isFreePlayerPick(picks, ['nba'], { name: 'LeBron James' }), false);
  assert.equal(isFreePlayerPick(picks, ['atp', 'wta'], { name: 'Jakub Mensik', id: '9' }), false);
});

test('only the sports given count', () => {
  assert.equal(isFreePlayerPick(picks, ['afl'], { name: 'Shai Gilgeous-Alexander' }), false);
  assert.equal(isFreePlayerPick({}, ['nba'], { name: 'Shai Gilgeous-Alexander' }), false);
  assert.deepEqual(
    freePlayerPicksFor(picks, ['atp', 'wta']).map((pick) => pick.sport),
    ['atp', 'wta']
  );
});
