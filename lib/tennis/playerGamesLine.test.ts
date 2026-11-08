import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  tennisMainLineForStat,
  tennisOuLinesForStat,
  type TennisBookRow,
} from './oddsTypes';

const emptyOu = { line: 'N/A', over: 'N/A', under: 'N/A' };

function book(partial: Partial<TennisBookRow> = {}): TennisBookRow {
  return {
    name: 'BetGoodwin',
    H2H: { home: '-150', away: '+125' },
    Spread: emptyOu,
    Total: emptyOu,
    GamesWon: emptyOu,
    GamesLost: emptyOu,
    TotalSets: emptyOu,
    SpreadLines: [],
    TotalLines: [],
    GamesWonLines: [],
    GamesLostLines: [],
    TotalSetsLines: [],
    ...partial,
  };
}

test('BetGoodwin-style junk: in-band 5.5 must not beat short-priced real 12.5+ ladder', () => {
  const row = book({
    GamesWonLines: [
      { line: '5.5', over: '-133', under: '-110' }, // ~1.75 / 1.91 — both in selector band
      { line: '12.5', over: '-200', under: '+140' }, // ~1.50 / 2.40 — over out of band
      { line: '13.5', over: '+137', under: '-188' }, // ~2.37 / 1.53 — under out of band
    ],
  });
  const lines = tennisOuLinesForStat(row, 'gamesWon');
  assert.ok(!lines.some((l) => l.line === '5.5'), 'junk 5.5 must be dropped');
  assert.deepEqual(
    lines.map((l) => l.line),
    ['12.5', '13.5'],
    'keep real short-priced match ladder after junk is stripped'
  );
  const main = tennisMainLineForStat(row, 'gamesWon');
  assert.ok(main && main.line !== '5.5');
  assert.ok(main && (main.line === '12.5' || main.line === '13.5'));
});

test('lone sub-9.5 gamesWon ladder is rejected (not a match total)', () => {
  const row = book({
    GamesWonLines: [{ line: '5.5', over: '-133', under: '-110' }],
  });
  assert.equal(tennisOuLinesForStat(row, 'gamesWon').length, 0);
  assert.equal(tennisMainLineForStat(row, 'gamesWon'), undefined);
});
