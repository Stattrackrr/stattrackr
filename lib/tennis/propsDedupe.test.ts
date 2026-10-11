import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateTennisPropsForPaint, tennisPlayerIdentityKey } from './aggregatePropsForPaint';
import { collapseTennisRowsToPrimaryMarketLine } from './propsMarketCollapse';

test('API-Tennis, Odds API and accented/hyphenated names share one identity key', () => {
  const key = tennisPlayerIdentityKey('A. Davidovich Fokina');
  assert.equal(tennisPlayerIdentityKey('Alejandro Davidovich Fokina'), key);
  assert.equal(tennisPlayerIdentityKey('Alejandro Davidovich-Fokina'), key);
  assert.equal(tennisPlayerIdentityKey('P. Carreno-Busta'), tennisPlayerIdentityKey('Pablo Carreño Busta'));
  assert.equal(tennisPlayerIdentityKey('J. M. Cerundolo'), tennisPlayerIdentityKey('Juan Manuel Cerundolo'));
  assert.notEqual(tennisPlayerIdentityKey('F. Cerundolo'), tennisPlayerIdentityKey('J. M. Cerundolo'));
});

const row = (playerName: string, overrides: Record<string, unknown> = {}) => ({
  playerName,
  gameId: '12169719',
  opponent: 'F. Tiafoe',
  statType: 'spread',
  line: 0.5,
  bookmaker: '1xBet',
  overOdds: '1.81',
  underOdds: '1.93',
  ...overrides,
});

test('the same player under two name formats shows as one row per market (the Davidovich Fokina duplicate)', () => {
  const rows = [
    row('Alejandro Davidovich Fokina'),
    row('A. Davidovich Fokina', { bookmaker: 'Bet365' }),
    row('Alejandro Davidovich Fokina', { statType: 'moneyline' }),
    row('A. Davidovich Fokina', { statType: 'moneyline', bookmaker: 'Bet365' }),
  ];
  const painted = aggregateTennisPropsForPaint(rows);
  assert.equal(painted.length, 2);
  const shown = collapseTennisRowsToPrimaryMarketLine(painted);
  assert.deepEqual(shown.map((r) => r.statType).sort(), ['moneyline', 'spread']);
});

test('both players in a match keep their own rows', () => {
  const shown = collapseTennisRowsToPrimaryMarketLine([
    row('A. Davidovich Fokina'),
    row('F. Tiafoe', { opponent: 'A. Davidovich Fokina' }),
  ]);
  assert.equal(shown.length, 2);
});
