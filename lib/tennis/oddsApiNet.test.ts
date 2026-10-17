import assert from 'node:assert/strict';
import test from 'node:test';
import { tennisBet365AuRowFromItems } from './oddsApiNet';

const item = (bet_type: string, line: string, odds: number, extra: Record<string, unknown> = {}) => ({
  bookmaker: 'bet365',
  bet_type,
  metric: 'games',
  period: 'full time',
  line,
  odds,
  is_available: true,
  main_line_eligible: true,
  ...extra,
});

const items = [
  item('moneyline', '', 1.5, { side: 'home', metric: 'standard' }),
  item('moneyline', '', 2.6, { side: 'away', metric: 'standard' }),
  item('moneyline', '', 1.4, { side: 'home', metric: 'standard', period: '1st set' }),
  item('handicap', '-2.5', 1.8, { side: 'home' }),
  item('handicap', '+2.5', 1.91, { side: 'away' }),
  item('total', 'over 21.5', 1.91),
  item('total', 'under 21.5', 1.8),
  item('handicap', '-4.5', 1.9, { side: 'home', period: '1st set' }),
  item('handicap', '+4.5', 1.9, { side: 'away', period: '1st set' }),
  item('total', 'over 2.5', 1.5, { metric: 'sets' }),
  item('total', 'under 2.5', 2.5, { metric: 'sets' }),
  item('handicap', '-3.5', 2.1, { side: 'home', is_available: false }),
  item('handicap', '+3.5', 1.7, { side: 'away', is_available: false }),
];

test('bet365 AU row keeps the full-match winner, single game handicap and single total', () => {
  const row = tennisBet365AuRowFromItems(items, true)!;
  assert.equal(row.name, 'bet365 au');
  assert.equal(row.region, 'au');
  assert.deepEqual(row.H2H, { home: '-200', away: '+160' });
  assert.deepEqual(row.SpreadLines, [{ line: '-2.5', over: '-125', under: '-110' }]);
  assert.deepEqual(row.TotalLines, [{ line: '21.5', over: '-110', under: '-125' }]);
  assert.equal(row.GamesWonLines.length, 0);
});

test('flips to API-Tennis home when odds-api.net lists the players the other way round', () => {
  const row = tennisBet365AuRowFromItems(items, false)!;
  assert.deepEqual(row.H2H, { home: '+160', away: '-200' });
  assert.deepEqual(row.SpreadLines, [{ line: '2.5', over: '-110', under: '-125' }]);
  assert.deepEqual(row.TotalLines, [{ line: '21.5', over: '-110', under: '-125' }]);
});

test('no full-match bet365 prices gives no row', () => {
  assert.equal(tennisBet365AuRowFromItems(items.filter((i) => i.period !== 'full time'), true), null);
});

