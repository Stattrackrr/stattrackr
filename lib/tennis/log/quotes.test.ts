import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptySourceMatch } from '@/lib/tennis/extraBooks/shared';
import { partner, sourceToQuotes } from './quotes';

const src = () => {
  const s = emptySourceMatch('pinnacle', 'Fritz', 'Ruud');
  s.h2h = { home: 1.6, away: 2.4 };
  s.handicaps.push({ homeLine: -2.5, home: 1.9, away: 1.92 });
  s.totals.push({ line: 22.5, over: 1.95, under: 1.87 });
  s.homeGames.push({ line: 12.5, over: 1.8, under: 2 });
  s.setHandicaps.push({ homeLine: -1.5, home: 2.6, away: 1.5 });
  return s;
};

test('quote rows in source orientation, win a set from the set handicap in best of 3', () => {
  const q = sourceToQuotes(src(), true, 3);
  const get = (market: string, selection: string, line: number | null = null) => q.find((r) => r.market === market && r.selection === selection && r.line === line)?.price;
  assert.equal(get('match_winner', 'home'), 1.6);
  assert.equal(get('game_handicap', 'away', -2.5), 1.92);
  assert.equal(get('total_games', 'over', 22.5), 1.95);
  assert.equal(get('games_won', 'home under', 12.5), 2);
  // Home -1.5 sets is the away player's +1.5: away wins a set at 1.5, away fails to at 2.6.
  assert.equal(get('win_a_set', 'away yes'), 1.5);
  assert.equal(get('win_a_set', 'away no'), 2.6);
  assert.equal(sourceToQuotes(src(), true, 5).filter((r) => r.market === 'win_a_set').length, 0, 'best of 5: a set handicap is not win a set');
});

test('flipped to API-Tennis orientation when the book lists the players the other way round', () => {
  const q = sourceToQuotes(src(), false, 3);
  const get = (market: string, selection: string, line: number | null = null) => q.find((r) => r.market === market && r.selection === selection && r.line === line)?.price;
  assert.equal(get('match_winner', 'away'), 1.6);
  assert.equal(get('game_handicap', 'away', 2.5), 1.9, 'Fritz -2.5 becomes the away line; the home line is +2.5');
  assert.equal(get('games_won', 'away over', 12.5), 1.8);
  assert.equal(get('win_a_set', 'home yes'), 1.5);
});

test('partners pair up two-way markets', () => {
  assert.equal(partner('home'), 'away');
  assert.equal(partner('over'), 'under');
  assert.equal(partner('home over'), 'home under');
  assert.equal(partner('away yes'), 'away no');
});
