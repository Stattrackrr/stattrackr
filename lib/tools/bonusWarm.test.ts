import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bonusBoardRedisBytes, limitPlayerPropsByEvent, slimBonusLive } from './bonusWarm';
import type { BonusLiveResult } from './bonusLive';

function sampleLive(): BonusLiveResult {
  const now = Date.now();
  return {
    requests: 1,
    leaguesTried: 1,
    eventsListed: 2,
    eventsSnapshotted: 2,
    sports: ['basketball'],
    snapshots: [
      {
        event: {
          sport: 'nba',
          apiSport: 'basketball',
          league: 'NBA',
          eventId: 'near',
          home: 'A',
          away: 'B',
          startMs: now + 3600_000,
        },
        asOf: { sportsbet: now },
        items: [
          {
            bookmaker: 'sportsbet',
            bet_type: 'moneyline',
            odds: 1.9,
            side: 'home',
            player_name: 'should drop',
            market_key: 'x',
          },
          {
            bookmaker: 'sportsbet',
            bet_type: 'player prop',
            odds: 1.8,
            metric: 'player points',
            line: 'over 24.5',
            player_name: 'Oso Ighodaro',
            market_key: 'prop-near',
          },
        ],
      },
      {
        event: {
          sport: 'nba',
          apiSport: 'basketball',
          league: 'NBA',
          eventId: 'far',
          home: 'C',
          away: 'D',
          startMs: now + 48 * 3600_000,
        },
        asOf: { sportsbet: now },
        items: [
          {
            bookmaker: 'sportsbet',
            bet_type: 'total',
            odds: 1.91,
            line: 'over 220.5',
          },
          {
            bookmaker: 'sportsbet',
            bet_type: 'player prop',
            odds: 1.85,
            metric: 'player points',
            line: 'over 20.5',
            player_name: 'Later Player',
          },
        ],
      },
    ],
  };
}

test('slimBonusLive keeps player props and strips unused fields', () => {
  const slim = slimBonusLive(sampleLive());
  const near = slim.snapshots[0]!.items;
  assert.equal(near.length, 2);
  assert.equal(near[0]!.bet_type, 'moneyline');
  assert.equal(near[0]!.player_name, undefined);
  assert.equal(near[0]!.market_key, undefined);
  assert.equal(near[1]!.bet_type, 'player prop');
  assert.equal(near[1]!.player_name, 'Oso Ighodaro');
  assert.ok(bonusBoardRedisBytes(slim) < bonusBoardRedisBytes(sampleLive()));
});

test('limitPlayerPropsByEvent drops props on farther tipoffs first', () => {
  const slim = slimBonusLive(sampleLive());
  const limited = limitPlayerPropsByEvent(slim, 1);
  const nearItems = limited.snapshots.find((s) => s.event.eventId === 'near')!.items;
  const farItems = limited.snapshots.find((s) => s.event.eventId === 'far')!.items;
  assert.ok(nearItems.some((it) => it.bet_type === 'player prop'));
  assert.ok(farItems.every((it) => it.bet_type !== 'player prop'));
  assert.ok(farItems.some((it) => it.bet_type === 'total'));
});
