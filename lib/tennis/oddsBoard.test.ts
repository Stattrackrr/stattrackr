import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLiveTennisPropsCutoff,
  formatTennisStartClock,
  TENNIS_PROPS_LIVE_GRACE_MS,
  tennisCommenceTimeStillOnBoard,
  tennisFindUpcomingForListedMatch,
  tennisFixtureIsOnCourt,
  tennisFixtureStatusIsTerminal,
  tennisListedMatchupIsPlayersNextGame,
  tennisOddsMatchStillOnBoard,
  tennisPairingMatches,
  tennisScheduledTipoffStillCurrent,
  tennisStartColumnState,
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

test('live current match stays on the odds index, not the props page', () => {
  const live = {
    matchId: 'live-1',
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
    tipoff: new Date(now - 90 * 60 * 1000).toISOString(),
    live: true,
  };
  const onIndex = tennisOddsMatchStillOnBoard({
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
    matchId: 'live-1',
    commenceTime: live.tipoff,
    live: true,
    playerNextGame: live,
    nowMs: now,
  });
  const onProps = tennisOddsMatchStillOnBoard({
    homeName: 'Novak Djokovic',
    awayName: 'Jannik Sinner',
    matchId: 'live-1',
    commenceTime: live.tipoff,
    live: true,
    playerNextGame: live,
    nowMs: now,
    dropConfirmedLive: true,
  });
  assert.equal(onIndex, true);
  assert.equal(onProps, false);
  const cut = applyLiveTennisPropsCutoff(
    [
      {
        gameId: 'live-1',
        homeTeam: 'Novak Djokovic',
        awayTeam: 'Jannik Sinner',
        commenceTime: live.tipoff,
        live: true,
      },
    ],
    [
      {
        gameId: 'live-1',
        homeTeam: 'Novak Djokovic',
        awayTeam: 'Jannik Sinner',
        commenceTime: live.tipoff,
        live: true,
      },
    ],
    now
  );
  assert.equal(cut.props.length, 0);
  assert.equal(cut.games.length, 0);
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

test('Walk Over and spaced walkover labels are finished, not scheduled', () => {
  assert.equal(tennisFixtureStatusIsTerminal('Walk Over'), true);
  assert.equal(tennisFixtureStatusIsTerminal('walkover'), true);
  assert.equal(tennisFixtureStatusIsTerminal('W/O'), true);
  assert.equal(tennisFixtureStatusIsTerminal('Retired'), true);
  assert.equal(tennisFixtureStatusIsTerminal('Set 2'), false);
  assert.equal(tennisFixtureStatusIsTerminal('Not Started'), false);
});

test('days-old not-before times are not the next match; delayed starts still are', () => {
  assert.equal(tennisScheduledTipoffStillCurrent(now - 6 * 24 * hour, now), false);
  assert.equal(tennisScheduledTipoffStillCurrent(now - 2 * hour, now), true);
  assert.equal(tennisScheduledTipoffStillCurrent(now + hour, now), true);
  assert.equal(tennisScheduledTipoffStillCurrent(now - TENNIS_PROPS_LIVE_GRACE_MS - 1, now), false);
});

test('start column shows not-before clock until the match is confirmed live', () => {
  const past = now - 2 * hour;
  const upcoming = now + 3 * hour;
  assert.equal(tennisStartColumnState({ tipoffMs: past, live: false, nowMs: now }).kind, 'clock');
  assert.equal(tennisStartColumnState({ tipoffMs: upcoming, live: false, nowMs: now }).kind, 'clock');
  assert.equal(tennisStartColumnState({ tipoffMs: upcoming, live: true, nowMs: now }).kind, 'clock');
  assert.equal(tennisStartColumnState({ tipoffMs: past, live: true, nowMs: now }).kind, 'live');
  assert.equal(tennisStartColumnState({ tipoffMs: null, live: false, nowMs: now }).kind, 'none');
  const label = formatTennisStartClock(new Date(past), now, 'en-US');
  assert.match(label, /\d/);
  assert.notEqual(label, '-');
});
