import assert from 'node:assert/strict';
import test from 'node:test';
import { tennisAustralianBet365, type TennisBookRow, type TennisOuLine } from './oddsTypes';

const NA: TennisOuLine = { line: 'N/A', over: 'N/A', under: 'N/A' };
const ou = (line: string, over: string, under: string): TennisOuLine => ({ line, over, under });

const row = (name: string, price: string, sets: boolean): TennisBookRow => ({
  name,
  H2H: { home: price, away: '+160' },
  Spread: ou('-3.5', price, '-110'),
  Total: ou('21.5', price, '-110'),
  GamesWon: NA,
  GamesLost: NA,
  TotalSets: sets ? ou('2.5', '+150', '-200') : NA,
  SpreadLines: [ou('-3.5', price, '-110')],
  TotalLines: [ou('21.5', price, '-110')],
  GamesWonLines: [],
  GamesLostLines: [],
  TotalSetsLines: sets ? [ou('2.5', '+150', '-200')] : [],
  ...(sets ? { SetsLost: ou('0.5', '+180', '-250'), SetsLostLines: [ou('0.5', '+180', '-250')] } : {}),
});

const sportsbet = row('Sportsbet', '-150', false);

test('AU bet365 prices winner, handicap and games; international only adds set markets', () => {
  const out = tennisAustralianBet365([row('bet365', '-250', true), sportsbet, { ...row('bet365 au', '-200', false), region: 'au' }]);
  assert.equal(out.length, 2);
  const [b365] = out;
  assert.equal(b365.name, 'bet365 au');
  assert.equal(b365.region, 'au');
  assert.equal(b365.H2H.home, '-200');
  assert.deepEqual(b365.SpreadLines, [ou('-3.5', '-200', '-110')]);
  assert.deepEqual(b365.TotalLines, [ou('21.5', '-200', '-110')]);
  assert.deepEqual(b365.TotalSetsLines, [ou('2.5', '+150', '-200')]);
  assert.deepEqual(b365.SetsLostLines, [ou('0.5', '+180', '-250')]);
  assert.equal(out[1], sportsbet);
});

test('AU set prices win over international ones', () => {
  const au = { ...row('bet365 au', '-200', true), TotalSetsLines: [ou('2.5', '+140', '-190')] };
  const [b365] = tennisAustralianBet365([row('bet365', '-250', true), au]);
  assert.deepEqual(b365.TotalSetsLines, [ou('2.5', '+140', '-190')]);
});

test('without an AU row, international bet365 keeps only its set markets', () => {
  const [b365, other] = tennisAustralianBet365([row('bet365', '-250', true), sportsbet]);
  assert.deepEqual(b365.H2H, { home: 'N/A', away: 'N/A' });
  assert.deepEqual([b365.Spread, b365.Total, b365.SpreadLines, b365.TotalLines], [NA, NA, [], []]);
  assert.deepEqual(b365.TotalSetsLines, [ou('2.5', '+150', '-200')]);
  assert.equal(other, sportsbet);
});

test('international bet365 with no set markets and no AU row drops out', () => {
  assert.deepEqual(tennisAustralianBet365([row('Bet365', '-250', false), sportsbet]), [sportsbet]);
});
