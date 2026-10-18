import assert from 'node:assert/strict';
import test from 'node:test';
import { alternateBooks } from './books';
import { aiPickFromRow, type AiPickRow } from './rows';

const q = (book: string, price: number) => ({ book, price });

test('alternate books price every leg, skip the posted book, best combined price first', () => {
  const legA = [q('1xBet', 1.57), q('Unibet', 1.49), q('Pinnacle', 1.55), q('Ladbrokes', 1.5)];
  const legB = [q('1xBet', 1.88), q('Unibet', 1.68), q('Pinnacle', 1.8), q('Neds', 1.7)];
  assert.deepEqual(alternateBooks([legA, legB], '1xBet'), [
    { book: 'Pinnacle', price: 2.79, legs: [1.55, 1.8] },
    { book: 'Unibet', price: 2.503, legs: [1.49, 1.68] },
  ]);
});

test('a lone price far above the rest is not offered as an alternative', () => {
  const leg = [q('A', 1.8), q('B', 1.85), q('C', 1.82), q('Stale', 2.6)];
  assert.deepEqual(alternateBooks([leg], 'A').map((b) => b.book), ['B', 'C']);
});

const row = (context: AiPickRow['context']): AiPickRow => ({
  id: 'p',
  kind: 'multi',
  sport: 'tennis',
  title: 't',
  write_up: null,
  units: 1,
  price: 2.95,
  bookmaker: '1xBet',
  model_prob: null,
  ev: null,
  status: 'pending',
  profit_units: null,
  first_starts_at: '2026-10-18T14:55:00Z',
  posted_at: '2026-10-18T13:06:00Z',
  settled_at: null,
  model_version: null,
  context,
  ai_pick_legs: [{} as never, {} as never],
});

test('picks read the stored list, and older picks rebuild it from the saved quotes', () => {
  const stored = [{ book: 'Unibet', price: 2.5, legs: [1.49, 1.68] }];
  assert.deepEqual(aiPickFromRow(row({ altBooks: stored })).altBooks, stored);
  const old = aiPickFromRow(
    row({ legs: [{ quotes: [q('1xBet', 1.57), q('Unibet', 1.49)] }, { quotes: [q('1xBet', 1.88), q('Unibet', 1.68)] }] })
  );
  assert.deepEqual(old.altBooks, [{ book: 'Unibet', price: 2.503, legs: [1.49, 1.68] }]);
  assert.deepEqual(aiPickFromRow(row(null)).altBooks, []);
});
