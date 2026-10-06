import assert from 'node:assert/strict';
import test from 'node:test';
import { tennisCommenceTimeForMatch, tennisUpcomingTipoffFor, type TennisNextGame } from './nextGame';

const hour = 60 * 60 * 1000;

function game(partial: Partial<TennisNextGame> & Pick<TennisNextGame, 'homeName' | 'awayName'>): TennisNextGame {
  return {
    opponent: partial.awayName,
    opponentId: null,
    opponentIoc: null,
    opponentRank: null,
    opponentLogo: null,
    tipoff: partial.tipoff ?? null,
    live: Boolean(partial.live),
    isGrandSlam: false,
    tour: 'ATP',
    tournamentName: 'Beijing',
    tournamentKey: null,
    surface: 'Hard',
    round: null,
    matchId: partial.matchId ?? 'final-1',
    status: partial.status ?? null,
    playerIsHome: true,
    homeName: partial.homeName,
    awayName: partial.awayName,
    playerSeed: null,
    opponentSeed: null,
    topSeedName: null,
    topSeedId: null,
  };
}

test('does not stamp a live next-game tipoff onto yesterday\'s opponent', () => {
  const finalTip = new Date(Date.now() + hour).toISOString();
  const next = game({
    matchId: 'final-1',
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
    tipoff: finalTip,
    live: true,
  });
  const byPlayerId = new Map<string, TennisNextGame>([['1905', next]]);
  const tip = tennisUpcomingTipoffFor(byPlayerId, [next], {
    playerId: '1905',
    playerName: 'Novak Djokovic',
    matchId: 'odds:sf',
    homeName: 'Novak Djokovic',
    awayName: 'Daniil Medvedev',
  });
  assert.equal(tip, null);
});

test('stamps the real tipoff when the listed match is the player\'s next game', () => {
  const finalTip = new Date(Date.now() + hour).toISOString();
  const next = game({
    matchId: 'final-1',
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
    tipoff: finalTip,
    live: true,
  });
  const byPlayerId = new Map<string, TennisNextGame>([['1905', next]]);
  const tip = tennisUpcomingTipoffFor(byPlayerId, [next], {
    playerId: '1905',
    matchId: 'final-1',
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
  });
  assert.equal(tip, finalTip);
});

test('never rewrites commence time to now for a live match', () => {
  const tipoff = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const next = game({
    matchId: 'final-1',
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
    tipoff,
    live: true,
  });
  assert.equal(tennisCommenceTimeForMatch([next], { matchId: 'final-1' }), tipoff);
  assert.notEqual(tennisCommenceTimeForMatch([next], { matchId: 'final-1' }), new Date().toISOString());
});
