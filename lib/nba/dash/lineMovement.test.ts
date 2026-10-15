import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNbaLineMovement, recordNbaLineMoves } from '@/lib/nba/dash/lineMovement';
import { nbaPlayerPropsByStat } from '@/lib/nba/dash/odds';
import type { NbaGameOdds, NbaPropEntry } from '@/lib/nba/dash/oddsTypes';

function game(props: Record<string, Record<string, NbaPropEntry[]>>): NbaGameOdds {
  const playerProps: NbaGameOdds['playerProps'] = {};
  for (const [book, stats] of Object.entries(props)) playerProps[book] = { 'Jayson Tatum': stats };
  return {
    gameId: '1',
    homeTeam: 'Detroit Pistons',
    awayTeam: 'Boston Celtics',
    commenceTime: '2099-10-20T23:00:00.000Z',
    bookmakers: [],
    playerProps,
  };
}

const opts = { player: 'Jayson Tatum', team: 'Boston Celtics', opponent: 'Detroit Pistons', nowMs: Date.parse('2099-10-19T00:00:00Z') };

test('records opening line and each change, skipping repeats and milestones', async () => {
  await recordNbaLineMoves(
    game({ draftkings: { PTS: [{ line: '26.5', over: '-110', under: '-110' }, { line: '25', over: '-157', under: 'N/A', milestone: true }] } }),
    '2099-10-18T00:00:00Z'
  );
  assert.equal(
    await recordNbaLineMoves(game({ draftkings: { PTS: [{ line: '26.5', over: '-110', under: '-110' }] } }), '2099-10-18T00:10:00Z'),
    false
  );
  await recordNbaLineMoves(game({ draftkings: { PTS: [{ line: '27.5', over: '-105', under: '-115' }] } }), '2099-10-18T00:20:00Z');

  const movement = await getNbaLineMovement(opts);
  assert.ok(movement);
  const points = movement.stats.find((s) => s.stat === 'points');
  assert.ok(points);
  assert.equal(points.books.length, 1);
  const [book] = points.books;
  assert.equal(book.opening.line, 26.5);
  assert.equal(book.current.line, 27.5);
  assert.equal(book.points.length, 2);
  assert.equal(points.currentLine, 27.5);
});

test('uses the most balanced O/U when a book lists alternates', async () => {
  await recordNbaLineMoves(
    game({
      fanduel: {
        REB: [
          { line: '8.5', over: '-110', under: '-110' },
          { line: '10.5', over: '+210', under: '-300' },
        ],
      },
    }),
    '2099-10-18T01:00:00Z'
  );
  const movement = await getNbaLineMovement(opts);
  assert.equal(movement?.stats.find((s) => s.stat === 'rebounds')?.books[0]?.current.line, 8.5);
  assert.deepEqual(movement?.stats.map((s) => s.stat), ['points', 'rebounds']);
});

test('a finished game or another matchup is not shown', async () => {
  assert.equal(await getNbaLineMovement({ ...opts, nowMs: Date.parse('2099-10-23T00:00:00Z') }), null);
  assert.equal(await getNbaLineMovement({ ...opts, team: 'Los Angeles Lakers', opponent: null }), null);
});

test('milestones chart half a point under the threshold', () => {
  const byStat = nbaPlayerPropsByStat(
    game({ fanduel: { PTS: [{ line: '25', over: '-162', under: 'N/A', milestone: true }, { line: '26.5', over: '-114', under: '-114' }] } }),
    'Jayson Tatum'
  );
  const lines = byStat.points?.[0]?.lines ?? [];
  assert.deepEqual(
    lines.map((l) => [l.kind, l.line, l.label]),
    [
      ['milestone', '24.5', '25+'],
      ['ou', '26.5', '26.5'],
    ]
  );
});
