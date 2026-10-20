import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nbaOddsNetEventProps } from '@/lib/nba/dash/oddsApiNet';

const item = (bookmaker: string, metric: string, line: string, odds: number, period = 'full time') => ({
  bookmaker,
  metric,
  line,
  odds,
  period,
  player_name: 'jayson tatum',
  is_available: true,
});

test('pairs over/under, turns over-only rows into N+ milestones, and skips other books and periods', () => {
  const props = nbaOddsNetEventProps([
    item('sportsbet', 'player points', 'over 26.5', 1.87),
    item('sportsbet', 'player points', 'under 26.5', 1.89),
    item('sportsbet', 'player points', 'over 29.5', 2.45),
    item('sportsbet', 'player points', 'over 19.5', 1.18),
    item('sportsbet', 'player points', 'under 30.5', 1.5),
    item('sportsbet', 'player points', 'over 10.5', 1.9, '1st quarter'),
    item('draftkings', 'player points', 'over 26.5', 1.9),
    item('dabble', 'player double doubles', 'over 0.5', 3),
    item('dabble', 'player first basket', 'over 0.5', 12),
  ]);
  assert.deepEqual(Object.keys(props), ['sportsbet', 'dabble']);
  assert.deepEqual(props.dabble['Jayson Tatum'], { DD: [{ line: '1', over: '+200', under: 'N/A', milestone: true }] });
  assert.deepEqual(props.sportsbet['Jayson Tatum'].PTS, [
    { line: '20', over: '-556', under: 'N/A', milestone: true },
    { line: '26.5', over: '-115', under: '-112' },
    { line: '30', over: '+145', under: 'N/A', milestone: true },
  ]);
});
