import assert from 'node:assert/strict';
import test from 'node:test';
import { countPostedOddsLines, countMoneylineBooks } from './dashboardStatLineCounts';

test('counts every posted line in the selector, even when the number repeats', () => {
  assert.equal(countPostedOddsLines(['20.5', '20.5', '20.5', 'N/A', null]), 3);
  assert.equal(countPostedOddsLines([3.5, '+3.5', 4.5]), 3);
  assert.equal(countPostedOddsLines([]), 0);
});

test('counts books that actually post a moneyline', () => {
  assert.equal(
    countMoneylineBooks([
      { H2H: { home: '+120', away: '-140' } },
      { H2H: { home: 'N/A', away: 'N/A' } },
      { H2H: { home: '-110', away: '-110' } },
    ]),
    2
  );
});
