import assert from 'node:assert/strict';
import test from 'node:test';
import { unibetNblOffersToRow } from './unibetGameLines';

const team = (name: string, type: string, line: number | undefined, odds: number) => ({ englishLabel: name, participant: name, type, line, odds, status: 'OPEN' });
const ou = (line: number, over: number, under: number) => ({
  criterion: { englishLabel: 'Total Points - Including Overtime' },
  outcomes: [
    { englishLabel: 'Over', type: 'OT_OVER', line, odds: over },
    { englishLabel: 'Under', type: 'OT_UNDER', line, odds: under },
  ],
});
const spread = (homeName: string, awayName: string, homeLine: number, home: number, away: number) => ({
  criterion: { englishLabel: 'Point Spread - Including Overtime' },
  outcomes: [team(homeName, 'OT_ONE', homeLine, home), team(awayName, 'OT_TWO', -homeLine, away)],
});

const offers = [
  {
    criterion: { englishLabel: 'Moneyline - Including Overtime' },
    outcomes: [team('Tasmania JackJumpers', 'OT_ONE', undefined, 1290), team('Brisbane Bullets', 'OT_TWO', undefined, 3600)],
  },
  spread('Tasmania JackJumpers', 'Brisbane Bullets', -8500, 1950, 1830),
  spread('Tasmania JackJumpers', 'Brisbane Bullets', -11500, 2430, 1540),
  ou(185500, 1880, 1920),
  ou(179500, 1500, 2600),
  { criterion: { englishLabel: 'Total Points - Quarter 1' }, outcomes: [{ englishLabel: 'Over', type: 'OT_OVER', line: 46500, odds: 1800 }, { englishLabel: 'Under', type: 'OT_UNDER', line: 46500, odds: 1890 }] },
  { criterion: { englishLabel: 'Total Points by Brisbane Bullets - Including Overtime' }, outcomes: [{ englishLabel: 'Over', type: 'OT_OVER', line: 88500, odds: 1800 }, { englishLabel: 'Under', type: 'OT_UNDER', line: 88500, odds: 1870 }] },
];

test('Unibet NBL: every full-game spread and total, main line is the most even pair', () => {
  const row = unibetNblOffersToRow(offers, { homeTeam: 'Tasmania JackJumpers', awayTeam: 'Brisbane Bullets' });
  assert.deepEqual(row, {
    name: 'Unibet',
    H2H: { home: '-345', away: '+260' },
    Spread: { line: '-8.5', over: '-105', under: '-120' },
    Total: { line: '185.5', over: '-114', under: '-109' },
    SpreadLines: [
      { line: '-11.5', over: '+143', under: '-185' },
      { line: '-8.5', over: '-105', under: '-120' },
    ],
    TotalLines: [
      { line: '179.5', over: '-200', under: '+160' },
      { line: '185.5', over: '-114', under: '-109' },
    ],
  });
});

test('Unibet NBL: flips to our home team when Unibet lists the game the other way round', () => {
  const row = unibetNblOffersToRow(offers, { homeTeam: 'Brisbane Bullets', awayTeam: 'Tasmania JackJumpers' });
  assert.deepEqual(row?.H2H, { home: '+260', away: '-345' });
  assert.deepEqual(row?.SpreadLines, [
    { line: '8.5', over: '-120', under: '-105' },
    { line: '11.5', over: '-185', under: '+143' },
  ]);
  assert.equal(row?.TotalLines?.length, 2);
});

test('Unibet NBL: a game with other teams gives no row', () => {
  assert.equal(unibetNblOffersToRow(offers.slice(0, 3), { homeTeam: 'Sydney Kings', awayTeam: 'Perth Wildcats' }), null);
});
