import assert from 'node:assert/strict';
import test from 'node:test';
import type { TennisNextGame } from './nextGame';
import { pickRefreshTargets, tennisRefreshTier } from './odds';

function game(matchId: string, eventType: string | null, tournamentName: string, live = false): TennisNextGame {
  return {
    opponent: 'B',
    opponentId: null,
    opponentIoc: null,
    opponentRank: null,
    opponentLogo: null,
    tipoff: null,
    live,
    isGrandSlam: false,
    tour: 'ATP',
    tournamentName,
    tournamentKey: null,
    surface: 'Hard',
    round: null,
    matchId,
    status: null,
    playerIsHome: true,
    homeName: `A ${matchId}`,
    awayName: `B ${matchId}`,
    playerSeed: null,
    opponentSeed: null,
    topSeedName: null,
    topSeedId: null,
    eventType,
  };
}

test('tiers main tour ahead of challengers and ITFs', () => {
  assert.equal(tennisRefreshTier(game('1', 'Atp Singles', 'Shanghai')), 0);
  assert.equal(tennisRefreshTier(game('2', 'Wta Singles', 'Wuhan')), 0);
  assert.equal(tennisRefreshTier(game('3', 'Challenger Men Singles', 'Olbia')), 1);
  assert.equal(tennisRefreshTier(game('4', 'Itf Women Singles', 'W15 Islamabad')), 2);
  assert.equal(tennisRefreshTier(game('5', null, 'M15 Offenbach')), 2);
  assert.equal(tennisRefreshTier(game('6', null, 'Shanghai')), 0);
});

test('a later Shanghai match is refreshed before a full morning of ITFs', () => {
  const itfs = Array.from({ length: 100 }, (_, i) => game(`itf-${i}`, 'Itf Men Singles', 'M15 Offenbach'));
  const challenger = game('ch', 'Challenger Men Singles', 'Olbia');
  const zverev = game('12170167', 'Atp Singles', 'Shanghai');
  const live = game('live', 'Itf Women Singles', 'W35 Heraklion 2', true);
  const targets = pickRefreshTargets([...itfs, challenger, zverev, live]);
  assert.equal(targets.length, 80);
  assert.deepEqual(
    targets.slice(0, 4).map((g) => g.matchId),
    ['live', '12170167', 'ch', 'itf-0']
  );
  assert.equal(targets[79].matchId, 'itf-76');
});
