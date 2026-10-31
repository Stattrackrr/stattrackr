import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeSelection, type MatchOutcome } from './grade';

const done: MatchOutcome = { status: 'completed', sets: [{ home: 6, away: 4 }, { home: 3, away: 6 }, { home: 7, away: 6, tiebreak: 5 }] };
const retired: MatchOutcome = { status: 'retired', sets: [{ home: 6, away: 3 }, { home: 2, away: 1 }] };

test('completed match: every market settles', () => {
  assert.equal(gradeSelection('match_winner', null, 'home', done), 'win');
  assert.equal(gradeSelection('match_winner', null, 'away', done), 'loss');
  assert.equal(gradeSelection('game_handicap', -1.5, 'home', done), 'loss', 'won the match but games were level 16-16');
});

test('completed match: totals, games won, handicap and win a set from per-set scores', () => {
  // Games: home 6+3+7 = 16, away 4+6+6 = 16, total 32.
  assert.equal(gradeSelection('total_games', 31.5, 'over', done), 'win');
  assert.equal(gradeSelection('total_games', 32.5, 'under', done), 'win');
  assert.equal(gradeSelection('games_won', 15.5, 'away over', done), 'win');
  assert.equal(gradeSelection('game_handicap', 1.5, 'home', done), 'win');
  assert.equal(gradeSelection('game_handicap', -0.5, 'home', done), 'loss');
  assert.equal(gradeSelection('win_a_set', null, 'away yes', done), 'win');
  assert.equal(gradeSelection('win_a_set', null, 'home no', done), 'loss');
});

test('retirement, house rule: decided stands, open is void', () => {
  // Home won set 1 6-3, 2-1 in set 2. 12 games played; home 8, away 4.
  assert.equal(gradeSelection('match_winner', null, 'home', retired), 'void');
  assert.equal(gradeSelection('game_handicap', -3.5, 'home', retired), 'void');
  assert.equal(gradeSelection('total_games', 11.5, 'over', retired), 'win');
  assert.equal(gradeSelection('total_games', 11.5, 'under', retired), 'loss');
  assert.equal(gradeSelection('total_games', 20.5, 'under', retired), 'void');
  assert.equal(gradeSelection('games_won', 7.5, 'home over', retired), 'win');
  assert.equal(gradeSelection('win_a_set', null, 'home yes', retired), 'win');
  assert.equal(gradeSelection('win_a_set', null, 'home no', retired), 'loss');
  assert.equal(gradeSelection('win_a_set', null, 'away yes', retired), 'void', 'away had not won a set yet');
  assert.equal(gradeSelection('total_games', 11.5, 'over', { status: 'walkover', sets: [] }), 'void');
});
