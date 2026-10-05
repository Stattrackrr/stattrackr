import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTennisAdvancedAverages } from './advancedAverages';
import type { TennisMatchRow, TennisPlayer } from './types';

function row(partial: Partial<TennisMatchRow> & Pick<TennisMatchRow, 'matchId' | 'date' | 'opponent' | 'opponentId' | 'season'>): TennisMatchRow {
  return {
    tour: 'ATP',
    tourneyId: '1',
    tourneyName: 'Test',
    tourneyLevel: 'A',
    isGrandSlam: false,
    surface: 'Hard',
    tourneyDate: partial.date,
    round: 'F',
    score: '6-4 6-4',
    bestOf: 3,
    minutes: null,
    drawSize: null,
    playerId: '1905',
    playerName: 'Novak Djokovic',
    opponentIoc: null,
    opponentRank: 5,
    opponentRankPoints: null,
    playerRank: 1,
    rankPoints: null,
    seed: null,
    entry: null,
    height: null,
    age: null,
    isWin: true,
    result: 'W',
    team: 'ATP',
    teamCode: 'ATP',
    venue: 'Hard',
    isHome: false,
    moneyline: 1,
    gamesWon: 12,
    gamesLost: 8,
    totalGames: 20,
    spread: -4,
    setsWon: 2,
    setsLost: 0,
    totalSets: 2,
    dominanceRatio: 1.2,
    aces: null,
    opponentAces: null,
    totalAces: null,
    doubleFaults: null,
    servePoints: null,
    serveGames: 10,
    firstServesIn: null,
    firstServesWon: null,
    secondServeAttempts: null,
    secondServesWon: null,
    firstServePct: null,
    firstServeWonPct: null,
    secondServeWonPct: null,
    servicePointsWonPct: 65,
    breakPointsSaved: 2,
    breakPointsFaced: 3,
    breakPointsSavedPct: 66.7,
    breakPointsConverted: 3,
    breakPointsConvertedPct: 50,
    returnPointsWon: 20,
    returnPointsWonPct: 40,
    pointsWon: 70,
    servePointsWon: 50,
    totalPoints: 120,
    hand: 'R',
    opponentHand: 'R',
    ioc: 'SRB',
    ...partial,
  };
}

test('advanced averages H2H uses career meetings, not the season window', () => {
  const players: TennisPlayer[] = [
    { playerId: '1905', name: 'Novak Djokovic', tour: 'ATP', ioc: 'SRB', rank: 1, rankPoints: null, hand: 'R', height: null, imageUrl: null },
    { playerId: '1093', name: 'Daniil Medvedev', tour: 'ATP', ioc: 'RUS', rank: 5, rankPoints: null, hand: 'R', height: null, imageUrl: null },
  ];
  const payload = buildTennisAdvancedAverages({
    playerName: 'Novak Djokovic',
    opponentName: 'Daniil Medvedev',
    playerId: '1905',
    opponentId: '1093',
    tour: 'ATP',
    window: 0,
    year: 2026,
    players,
    playerMatches: [
      row({ matchId: 'navone-2026', date: '2026-09-01', opponent: 'Mariano Navone', opponentId: '99', season: 2026 }),
      row({
        matchId: 'med-2023',
        date: '2023-09-10',
        opponent: 'Daniil Medvedev',
        opponentId: '1093',
        season: 2023,
        gamesWon: 19,
        gamesLost: 12,
        totalGames: 31,
      }),
    ],
    opponentMatches: [],
    includeBoards: false,
  });
  const h2h = payload.player.rows.find((r) => r.key === 'h2h');
  assert.equal(h2h?.matches, 1);
  assert.equal(h2h?.cells.wl.text.startsWith('1-0'), true);
  const seasonAll = payload.player.rows.find((r) => r.key === 'all');
  assert.equal(seasonAll?.matches, 1);
});
