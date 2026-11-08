import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bonusBoardRedisBytes, slimBonusLive } from './bonusWarm';
import type { BonusLiveResult } from './bonusLive';

test('slimBonusLive drops player props and unused item fields', () => {
  const live: BonusLiveResult = {
    requests: 1,
    leaguesTried: 1,
    eventsListed: 1,
    eventsSnapshotted: 1,
    sports: ['basketball'],
    snapshots: [
      {
        event: {
          sport: 'nba',
          apiSport: 'basketball',
          league: 'NBA',
          eventId: '1',
          home: 'A',
          away: 'B',
          startMs: Date.now() + 3600_000,
        },
        asOf: { sportsbet: Date.now() },
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
            player_name: 'Oso Ighodaro',
          },
        ],
      },
    ],
  };
  const slim = slimBonusLive(live);
  assert.equal(slim.snapshots[0]!.items.length, 1);
  assert.equal(slim.snapshots[0]!.items[0]!.bet_type, 'moneyline');
  assert.equal(slim.snapshots[0]!.items[0]!.player_name, undefined);
  assert.ok(bonusBoardRedisBytes(slim) < bonusBoardRedisBytes(live));
});
