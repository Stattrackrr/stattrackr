import assert from 'node:assert/strict';
import test from 'node:test';
import { bookmakerLinesFromTennisRow, dropTennisWinASetRowsWithoutPrice } from './aggregatePropsForPaint';

test('win-a-set bookmaker chips leave out books without the to-win price', () => {
  const lines = bookmakerLinesFromTennisRow({
    statType: 'setsWon',
    bookmaker: '1xBet',
    line: 0.5,
    overOdds: '-333',
    underOdds: '+208',
    bookmakerLines: [
      { bookmaker: '1xBet', line: 0.5, overOdds: '-333', underOdds: '+208' },
      { bookmaker: 'bet365', line: 0.5, overOdds: 'N/A', underOdds: '+250' },
      { bookmaker: 'Pinnacle', line: 0.5, overOdds: '-294', underOdds: '+244' },
    ],
  });
  assert.deepEqual(lines.map((line) => line.bookmaker), ['1xBet', 'Pinnacle']);
  const games = bookmakerLinesFromTennisRow({
    statType: 'gamesWon',
    bookmaker: 'bet365',
    line: 11.5,
    overOdds: 'N/A',
    underOdds: '-110',
  });
  assert.equal(games.length, 1);
});

test('stored favourite win-a-set rows with only the straight-sets price are removed', () => {
  const rows: Array<{
    playerName: string;
    statType: string;
    line: number;
    overOdds: string;
    underOdds: string;
    bookmaker?: string;
    bookmakerLines?: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }>;
  }> = [
    {
      playerName: 'Alexander Zverev',
      statType: 'setsWon',
      line: 0.5,
      overOdds: 'N/A',
      underOdds: '+435',
      bookmakerLines: [
        { bookmaker: '1xBet', line: 0.5, overOdds: 'N/A', underOdds: '+435' },
        { bookmaker: 'Bet365', line: 0.5, overOdds: 'N/A', underOdds: '+500' },
      ],
    },
    {
      playerName: 'A. Bublik',
      statType: 'setsWon',
      line: 0.5,
      overOdds: 'N/A',
      underOdds: '+300',
      bookmakerLines: [
        { bookmaker: 'Pinnacle', line: 0.5, overOdds: 'N/A', underOdds: '+300' },
        { bookmaker: 'Bet365', line: 0.5, overOdds: '-139', underOdds: '+100' },
      ],
    },
    { playerName: 'Alexander Zverev', statType: 'setsLost', line: 0.5, overOdds: 'N/A', underOdds: '-200' },
    { playerName: 'Alexander Zverev', statType: 'totalSets', line: 2.5, overOdds: 'N/A', underOdds: '-189' },
  ];
  const kept = dropTennisWinASetRowsWithoutPrice(rows);
  assert.deepEqual(
    kept.map((row) => `${row.playerName}:${row.statType}`),
    ['A. Bublik:setsWon', 'Alexander Zverev:totalSets']
  );
  const bublik = kept[0]!;
  assert.equal(bublik.bookmaker, 'Bet365');
  assert.equal(bublik.overOdds, '-139');
  assert.equal(bublik.bookmakerLines?.length, 1);
});
