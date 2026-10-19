import assert from 'node:assert/strict';
import test from 'node:test';
import { nblGameBookRowsFromItems } from './oddsApiNet';

const item = (bookmaker: string, bet_type: string, side: string | undefined, line: string | undefined, odds: number, extra: object = {}) => ({
  bookmaker,
  bet_type,
  metric: 'standard',
  period: 'full time',
  side,
  line,
  odds,
  is_available: true,
  ...extra,
});

test('game lines keep the main pair and every alternate per book, home side first, with stored book names', () => {
  const rows = nblGameBookRowsFromItems([
    item('pointsbet', 'moneyline', 'home', undefined, 1.18),
    item('pointsbet', 'moneyline', 'away', undefined, 4.75),
    item('pointsbet', 'handicap', 'home', '-9.5', 1.9, { main_line_eligible: true }),
    item('pointsbet', 'handicap', 'away', '+9.5', 1.9, { main_line_eligible: true }),
    item('pointsbet', 'handicap', 'home', '-12.5', 2.3),
    item('pointsbet', 'handicap', 'away', '+12.5', 1.6),
    item('pointsbet', 'total', undefined, 'over 199.5', 1.9),
    item('pointsbet', 'total', undefined, 'under 199.5', 1.9),
    item('pointsbet', 'total', undefined, 'over 205.5', 2.4),
    item('pointsbet', 'total', undefined, 'under 205.5', 1.55),
    item('pointsbet', 'handicap', 'home', '-3.5', 1.9, { period: '1st half' }),
    item('tabtouch', 'moneyline', 'home', undefined, 1.2),
    item('bet365', 'moneyline', 'home', undefined, 1.17),
    item('bet365', 'moneyline', 'away', undefined, 5.25),
  ]);
  assert.deepEqual(rows, [
    {
      name: 'PointsBet (AU)',
      H2H: { home: '-556', away: '+375' },
      Spread: { line: '-9.5', over: '-111', under: '-111' },
      Total: { line: '199.5', over: '-111', under: '-111' },
      SpreadLines: [
        { line: '-12.5', over: '+130', under: '-167' },
        { line: '-9.5', over: '-111', under: '-111' },
      ],
      TotalLines: [
        { line: '199.5', over: '-111', under: '-111' },
        { line: '205.5', over: '+140', under: '-182' },
      ],
    },
    {
      name: 'Bet365 AU',
      H2H: { home: '-588', away: '+425' },
      Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
      Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
      SpreadLines: [],
      TotalLines: [],
    },
  ]);
});
