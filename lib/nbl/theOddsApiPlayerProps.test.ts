import assert from 'node:assert/strict';
import test from 'node:test';
import { fillMissingNblPlayerPropsFromTheOddsApi } from '@/lib/nbl/theOddsApiPlayerProps';

test('fillMissingNblPlayerPropsFromTheOddsApi is a no-op without ODDS_API_KEY', async () => {
  const prev = process.env.ODDS_API_KEY;
  delete process.env.ODDS_API_KEY;
  try {
    const existing = [
      {
        gameId: '1',
        homeTeam: 'Sydney Kings',
        awayTeam: 'Perth Wildcats',
        commenceTime: '2026-10-17T08:30:00.000Z',
        bookmakers: [],
      },
    ];
    const out = await fillMissingNblPlayerPropsFromTheOddsApi(existing);
    assert.equal(out, existing);
  } finally {
    if (prev == null) delete process.env.ODDS_API_KEY;
    else process.env.ODDS_API_KEY = prev;
  }
});
