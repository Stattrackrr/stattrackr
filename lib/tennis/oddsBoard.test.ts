import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tennisCommenceTimeStillOnBoard,
  tennisFindUpcomingForListedMatch,
  tennisFixtureIsOnCourt,
  tennisListedMatchupIsPlayersNextGame,
  tennisOddsMatchStillOnBoard,
  tennisPairingMatches,
  tennisStatusLooksOnCourt,
} from './oddsBoard';

const hour = 60 * 60 * 1000;
const now = Date.parse('2026-10-01T12:00:00.000Z');

test('pairing matches regardless of home/away order', () => {
  assert.equal(
    tennisPairingMatches('Novak Djokovic', 'Daniil Medvedev', 'D. Medvedev', 'N. Djokovic'),
    true
  );
  assert.equal(
    tennisPairingMatches('Novak Djokovic', 'Daniil Medvedev', 'Novak Djokovic', 'Carlos Alcaraz'),
    false
  );
});

test('not-started after a not-before time is not on court', () => {
  const tip = now - 2 * hour;
  assert.equal(tennisFixtureIsOnCourt('Not Started', tip, now), false);
  assert.equal(tennisFixtureIsOnCourt('', tip, now), false);
  assert.equal(tennisFixtureIsOnCourt('scheduled', tip, now), false);
});

test('Set 2 near listed time is on court; Set 1 hours early is not', () => {
  assert.equal(tennisFixtureIsOnCourt('Set 2', now - hour, now), true);
  assert.equal(tennisFixtureIsOnCourt('Set 1', now + 5 * hour, now), false);
  assert.equal(tennisStatusLooksOnCourt('Set 3'), true);
});

test('yesterday commence times are off the board', () => {
  assert.equal(tennisCommenceTimeStillOnBoard(new Date(now - 20 * hour).toISOString(), now), false);
  assert.equal(tennisCommenceTimeStillOnBoard(new Date(now - 2 * hour).toISOString(), now), true);
  assert.equal(tennisCommenceTimeStillOnBoard(new Date(now + 4 * hour).toISOString(), now), true);
  assert.equal(tennisCommenceTimeStillOnBoard(null, now), false);
});

test('stale Medvedev odds drop when Djokovic has a new next match', () => {
  const final = {
    matchId: 'final-1',
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
    tipoff: new Date(now + hour).toISOString(),
    live: false,
  };
  assert.equal(
    tennisOddsMatchStillOnBoard({
      homeName: 'Novak Djokovic',
      awayName: 'Daniil Medvedev',
      matchId: 'odds:sf',
      commenceTime: new Date(now - 2 * hour).toISOString(),
      playerNextGame: final,
      nowMs: now,
    }),
    false
  );
  assert.equal(
    tennisOddsMatchStillOnBoard({
      homeName: 'Novak Djokovic',
      awayName: 'Jannik Sinner',
      matchId: 'final-1',
      commenceTime: final.tipoff,
      playerNextGame: final,
      nowMs: now,
    }),
    true
  );
});

test('live current match stays on the board inside the grace window', () => {
  const live = {
    matchId: 'live-1',
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
    tipoff: new Date(now - 90 * 60 * 1000).toISOString(),
    live: true,
  };
  assert.equal(
    tennisOddsMatchStillOnBoard({
      homeName: 'Novak Djokovic',
      awayName: 'Jannik Sinner',
      matchId: 'live-1',
      commenceTime: live.tipoff,
      playerNextGame: live,
      nowMs: now,
    }),
    true
  );
});

test('find upcoming prefers the same pairing, else the player\'s new match', () => {
  const upcoming = [
    {
      matchId: 'final-1',
      homeName: 'Novak Djokovic',
      awayName: 'Jannik Sinner',
      tipoff: new Date(now + hour).toISOString(),
    },
  ];
  const hit = tennisFindUpcomingForListedMatch(upcoming, {
    matchId: 'odds:sf',
    homeName: 'Novak Djokovic',
    awayName: 'Daniil Medvedev',
  });
  assert.equal(hit?.matchId, 'final-1');
  assert.equal(
    tennisListedMatchupIsPlayersNextGame(
      { homeName: 'Novak Djokovic', awayName: 'Daniil Medvedev' },
      hit
    ),
    false
  );
});
