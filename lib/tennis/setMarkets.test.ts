import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeTennisAskOdds } from './askOdds';
import { tennisSetHandicapSide, tennisWinASetMarket } from './odds';
import {
  isTennisOuStat,
  TENNIS_DASHBOARD_LINES,
  tennisBestMoneylinePick,
  tennisBestOuPick,
  tennisMainLineForStat,
  tennisOuLineIsMain,
  tennisOuLinesForStat,
  type TennisBookRow,
} from './oddsTypes';
import { resolveAvailableMarkets } from '../tennisAi/availability';
import { winASetProb } from '../tennisAi/pack';

const emptyOu = { line: 'N/A', over: 'N/A', under: 'N/A' };

function book(over: Partial<TennisBookRow> = {}): TennisBookRow {
  return {
    name: 'bet365',
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
    ...over,
  };
}

test('set handicap side orders by price when the away labels are flipped', () => {
  const block = {
    'Asian Handicap (Sets) Away': { '+1.5': { bet365: '4.50' }, '-1.5': { bet365: '1.18' } },
  };
  const away = tennisSetHandicapSide(block, 'Away');
  assert.equal(away.winASet.bet365, '1.18');
  assert.equal(away.straightSets.bet365, '4.5');
});

test('win a set prefers the direct market and fills other books from handicaps in best of 3', () => {
  const raw = {
    'Win at least one set (Player 2)': { Yes: { bet365: '1.40' }, No: { bet365: '2.75' } },
    'Set Betting': { '2:0': {}, '2:1': {}, '0:2': {}, '1:2': {} },
    'Asian Handicap (Sets)': {
      'Asian Handicap (Sets) Home': { '+1.5': { pinnacle: '1.25' }, '-1.5': { pinnacle: '2.60' } },
      'Asian Handicap (Sets) Away': { '+1.5': { pinnacle: '1.55' }, '-1.5': { pinnacle: '3.90' } },
    },
  };
  const away = tennisWinASetMarket(raw, 'Away');
  assert.equal(away.over?.['0.5']?.bet365, '1.40');
  assert.equal(away.under?.['0.5']?.bet365, '2.75');
  assert.equal(away.over?.['0.5']?.pinnacle, '1.55');
  assert.equal(away.under?.['0.5']?.pinnacle, '2.6');
});

test('opponent straight-sets No fills win a set for books without the direct market', () => {
  const raw = {
    'Win In Straigh Sets (Player 1)': { Yes: { bet365: '3.40' }, No: { bet365: '1.30' } },
    'Set Betting': { '3:0': {}, '3:1': {}, '3:2': {} },
  };
  const away = tennisWinASetMarket(raw, 'Away');
  assert.equal(away.over?.['0.5']?.bet365, '1.30');
  assert.equal(away.under?.['0.5']?.bet365, '3.40');
  assert.equal(tennisWinASetMarket(raw, 'Home').over, null);
});

test('set handicaps are ignored outside best of 3', () => {
  const raw = {
    'Set Betting': { '3:0': {}, '3:1': {}, '3:2': {} },
    'Asian Handicap (Sets)': {
      'Asian Handicap (Sets) Home': { '+1.5': { pinnacle: '1.25' }, '-1.5': { pinnacle: '2.60' } },
      'Asian Handicap (Sets) Away': { '+1.5': { pinnacle: '1.55' }, '-1.5': { pinnacle: '3.90' } },
    },
  };
  const home = tennisWinASetMarket(raw, 'Home');
  assert.equal(home.over, null);
  assert.equal(home.under, null);
});

test('set lines blank sides under 1.30 and skip the 1.65-2.50 band', () => {
  const row = book({
    SetsWonLines: [{ line: '0.5', over: '+130', under: '-600' }],
    TotalSetsLines: [{ line: '2.5', over: '+180', under: '-250' }],
  });
  assert.deepEqual(tennisOuLinesForStat(row, 'setsWon'), [{ line: '0.5', over: '+130', under: 'N/A' }]);
  const total = tennisOuLinesForStat(row, 'totalSets');
  assert.deepEqual(total, [{ line: '2.5', over: '+180', under: '-250' }]);
});

test('a short-priced favourite has no win-a-set line rather than only the straight-sets side', () => {
  const row = book({
    SetsWon: { line: '0.5', over: '-2500', under: '+435' },
    SetsWonLines: [{ line: '0.5', over: '-2500', under: '+435' }],
    SetsLostLines: [{ line: '0.5', over: '+140', under: '-180' }],
  });
  assert.deepEqual(tennisOuLinesForStat(row, 'setsWon'), []);
  assert.equal(tennisMainLineForStat(row, 'setsWon'), undefined);
  assert.deepEqual(tennisOuLinesForStat(row, 'setsLost'), [{ line: '0.5', over: '+140', under: '-180' }]);
});

test('dashboard shows every set price with the match line from the moneyline', () => {
  const row = book({
    H2H: { home: '-222', away: '+184' },
    SetsWonLines: [{ line: '0.5', over: '-625', under: '+370' }],
    SetsLostLines: [{ line: '0.5', over: '-154', under: '+113' }],
    TotalSetsLines: [{ line: '2.5', over: '+180', under: '-250' }],
  });
  assert.deepEqual(tennisOuLinesForStat(row, 'setsWon'), []);
  assert.deepEqual(tennisOuLinesForStat(row, 'setsWon', TENNIS_DASHBOARD_LINES), [
    { line: '0.5', over: '-625', under: '+370' },
    { line: '1.5', over: '-222', under: '+184' },
  ]);
  assert.deepEqual(tennisOuLinesForStat(row, 'setsLost', TENNIS_DASHBOARD_LINES), [
    { line: '0.5', over: '-154', under: '+113' },
    { line: '1.5', over: '+184', under: '-222' },
  ]);
  assert.equal(tennisMainLineForStat(row, 'setsWon', TENNIS_DASHBOARD_LINES)?.line, '0.5');
  const slam = book({
    H2H: { home: '-400', away: '+300' },
    SetsWonLines: [{ line: '0.5', over: '-2000', under: '+900' }],
    TotalSetsLines: [{ line: '3.5', over: '-110', under: '-110' }],
  });
  assert.deepEqual(
    tennisOuLinesForStat(slam, 'setsWon', TENNIS_DASHBOARD_LINES).map((line) => line.line),
    ['0.5', '2.5']
  );
});

test('dashboard opens sets won on the win-a-set line even when another book only has the match line', () => {
  const matchOnly = book({ name: 'Sportsbet', H2H: { home: '-110', away: '-110' } });
  const withWinASet = book({
    name: 'TAB',
    H2H: { home: '-400', away: '+300' },
    SetsWonLines: [{ line: '0.5', over: '-2000', under: '+900' }],
  });
  const pick = tennisBestOuPick([matchOnly, withWinASet], 'setsWon', TENNIS_DASHBOARD_LINES);
  assert.equal(pick?.bookIndex, 1);
  assert.equal(pick?.line.line, '0.5');
  assert.equal(tennisOuLineIsMain(matchOnly, 'setsWon', '1.5', TENNIS_DASHBOARD_LINES), false);
  assert.equal(tennisOuLineIsMain(withWinASet, 'setsWon', '0.5', TENNIS_DASHBOARD_LINES), true);
});

test('dashboard defaults to an Australian book whenever one prices the market', () => {
  const pinnacle = book({
    name: 'Pinnacle',
    H2H: { home: '-105', away: '-105' },
    TotalLines: [{ line: '21.5', over: '-110', under: '-110' }],
  });
  const ladbrokes = book({
    name: 'Ladbrokes',
    region: 'au',
    H2H: { home: '-130', away: '+105' },
    TotalLines: [{ line: '21.5', over: '-125', under: '+100' }],
  });
  assert.equal(tennisBestMoneylinePick([pinnacle, ladbrokes]), 1);
  assert.equal(tennisBestOuPick([pinnacle, ladbrokes], 'totalGames', TENNIS_DASHBOARD_LINES)?.bookIndex, 1);
  assert.equal(tennisBestOuPick([pinnacle], 'totalGames', TENNIS_DASHBOARD_LINES)?.bookIndex, 0);
});

test('sets lost carries the opponent win-a-set price for the viewed player', () => {
  const row = book({
    SetsWonLines: [{ line: '0.5', over: '-250', under: '+190' }],
    SetsLostLines: [{ line: '0.5', over: '+160', under: '-200' }],
  });
  assert.equal(isTennisOuStat('setsLost'), true);
  assert.deepEqual(tennisOuLinesForStat(row, 'setsLost'), [{ line: '0.5', over: '+160', under: '-200' }]);
  assert.deepEqual(tennisOuLinesForStat(row, 'setsWon'), [{ line: '0.5', over: '-250', under: '+190' }]);
});

test('set line is dropped when both sides are under the floor', () => {
  const row = book({ SetsWonLines: [{ line: '0.5', over: '-500', under: '-500' }] });
  assert.deepEqual(tennisOuLinesForStat(row, 'setsWon'), []);
});

test('AI offers win-a-set sides only above the floor but keeps both for pricing', () => {
  const markets = resolveAvailableMarkets({
    matchId: 'm1',
    homeTeam: 'A',
    awayTeam: 'B',
    fetchedAt: new Date().toISOString(),
    bookmakers: [
      book({
        SetsWonLines: [{ line: '0.5', over: '-400', under: '+275' }],
        SetsLostLines: [{ line: '0.5', over: '+150', under: '-185' }],
      }),
    ],
  });
  const winASet = markets.filter((market) => market.key === 'WIN_A_SET');
  const selections = winASet.map((market) => market.selection).sort();
  assert.deepEqual(selections, ['OPPONENT', 'OPPONENT_STRAIGHT_SETS', 'PLAYER_STRAIGHT_SETS']);
  const opp = winASet.find((market) => market.selection === 'OPPONENT_STRAIGHT_SETS');
  assert.equal(opp?.priceable, true);
  assert.equal(opp?.line, null);
});

test('win-a-set probability comes from simulated set scores', () => {
  const sim = { setScores: { '2-0': 0.4, '2-1': 0.2, '1-2': 0.15, '0-2': 0.25 } };
  assert.equal(winASetProb(sim, 'PLAYER')?.toFixed(2), '0.75');
  assert.equal(winASetProb(sim, 'OPPONENT')?.toFixed(2), '0.60');
  assert.equal(winASetProb(sim, 'PLAYER_STRAIGHT_SETS')?.toFixed(2), '0.40');
  assert.equal(winASetProb(sim, 'OPPONENT_STRAIGHT_SETS')?.toFixed(2), '0.25');
});

test('AI stat pack lists set prices per book with short sides removed', () => {
  const summary = summarizeTennisAskOdds(
    {
      matchId: 'm1',
      homeTeam: 'A',
      awayTeam: 'B',
      bookmakers: [
        book({
          SetsWonLines: [{ line: '0.5', over: '-400', under: '+275' }],
          SetsLostLines: [{ line: '0.5', over: '+150', under: '-185' }],
          TotalSetsLines: [{ line: '2.5', over: '+180', under: '-250' }],
        }),
      ],
    },
    3
  );
  assert.equal(summary.sets?.length, 1);
  const row = summary.sets![0]!;
  assert.equal(row.playerToWinASet, null);
  assert.equal(row.opponentStraightSets, 3.75);
  assert.equal(row.opponentToWinASet, 2.5);
  assert.equal(row.playerStraightSets, 1.54);
  assert.equal(row.totalSetsLine, 2.5);
  assert.equal(row.totalSetsOver, 2.8);
  assert.equal(row.totalSetsUnder, 1.4);
});
