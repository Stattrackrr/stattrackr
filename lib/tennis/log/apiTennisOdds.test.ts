import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiTennisOddsToQuotes, REFERENCE_BOOKS } from './apiTennisOdds';

const raw = {
  'Home/Away': { Home: { Pncl: '1.18', Betfair: '1.14' }, Away: { Pncl: '5.04', Betfair: '5.00' } },
  'Asian Handicap (Games)': {
    'Asian Handicap (Games) Home': { '-5.5': { Pncl: '1.84', Marathon: '1.76' } },
    'Asian Handicap (Games) Away': { '-5.5': { Pncl: '1.98', Marathon: '1.88' } },
  },
  'Over/Under by Games in Match': {
    'Over/Under by Games in Match Over': { '19.5': { Pncl: '2.00' } },
    'Over/Under by Games in Match Under': { '19.5': { Pncl: '1.81' } },
  },
  'Total - Away': { 'Total Over': { '7.5': { Pncl: '1.89' } }, 'Total Under': { '7.5': { Pncl: '1.86' } } },
  // Labels deliberately backwards on the home side: price order decides.
  'Asian Handicap (Sets)': {
    'Asian Handicap (Sets) Home': { '-1.5': { Pncl: '1.08' }, '+1.5': { Pncl: '1.62' } },
    'Asian Handicap (Sets) Away': { '-1.5': { Pncl: '2.56' }, '+1.5': { Pncl: '8.57' } },
  },
};

test('API-Tennis odds map to logged markets in home orientation', () => {
  const q = apiTennisOddsToQuotes(raw, 3);
  const find = (book: string, market: string, line: number | null, selection: string) => q.find((r) => r.book === book && r.market === market && r.line === line && r.selection === selection)?.price;
  assert.equal(find('pinnacle', 'match_winner', null, 'home'), 1.18);
  assert.equal(find('betfair sportsbook', 'match_winner', null, 'away'), 5);
  assert.equal(find('pinnacle', 'game_handicap', -5.5, 'home'), 1.84);
  assert.equal(find('pinnacle', 'game_handicap', -5.5, 'away'), 1.98);
  assert.equal(find('marathon', 'game_handicap', -5.5, 'away'), 1.88);
  assert.equal(find('pinnacle', 'total_games', 19.5, 'over'), 2);
  assert.equal(find('pinnacle', 'games_won', 7.5, 'away under'), 1.86);
  // Win a set: the shorter set-handicap price on a side; "no" is the opponent winning in straight sets.
  assert.equal(find('pinnacle', 'win_a_set', null, 'home yes'), 1.08);
  assert.equal(find('pinnacle', 'win_a_set', null, 'home no'), 8.57);
  assert.equal(find('pinnacle', 'win_a_set', null, 'away yes'), 2.56);
  assert.equal(find('pinnacle', 'win_a_set', null, 'away no'), 1.62);
});

test('impossible pairs (mislabelled sides) are dropped', () => {
  const bad = { 'Home/Away': { Home: { Pncl: '1.08' }, Away: { Pncl: '2.56' } } };
  assert.equal(apiTennisOddsToQuotes(bad, 3).length, 0);
});

test('no set-handicap win-a-set in best of 5; reference books never include Pinnacle', () => {
  assert.ok(!apiTennisOddsToQuotes(raw, 5).some((r) => r.market === 'win_a_set'));
  assert.ok(!REFERENCE_BOOKS.has('pinnacle'));
  assert.ok(REFERENCE_BOOKS.has('betfair sportsbook'));
});
