import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNblLineMovement, recordNblLineMoves } from '@/lib/nbl/lineMovement';
import type { NblPlayerPropSnapshot } from '@/lib/nbl/playerPropSnapshots';

type Line = { book: string; line: number; over: number | null; under: number | null; kind?: 'ou' | 'milestone'; stat?: string };

function board(gameKey: string, lines: Line[]): NblPlayerPropSnapshot {
  return {
    gameId: gameKey,
    gameKey,
    homeTeam: 'Sydney Kings',
    awayTeam: 'Melbourne United',
    commenceTime: '2099-10-20T08:30:00.000Z',
    capturedAt: '',
    closing: false,
    lines: lines.map((l) => ({
      player: 'Xavier Cooks',
      playerKey: 'xavier cooks',
      book: l.book,
      stat: l.stat ?? 'points',
      kind: l.kind ?? 'ou',
      line: l.line,
      label: '',
      over: null,
      under: null,
      overDecimal: l.over,
      underDecimal: l.under,
    })),
  } as unknown as NblPlayerPropSnapshot;
}

const opts = { player: 'Xavier Cooks', team: 'Sydney Kings', opponent: 'Melbourne United', nowMs: Date.parse('2099-10-19T00:00:00Z') };

test('records opening line and each change, skipping repeats and milestones', async () => {
  const key = '2099-10-20_sydney-kings_vs_melbourne-united';
  await recordNblLineMoves(board(key, [{ book: 'Sportsbet', line: 15.5, over: 1.87, under: 1.87 }, { book: 'Sportsbet', line: 20, over: 2.5, under: null, kind: 'milestone' }]), '2099-10-18T00:00:00Z');
  assert.equal(await recordNblLineMoves(board(key, [{ book: 'Sportsbet', line: 15.5, over: 1.87, under: 1.87 }]), '2099-10-18T00:10:00Z'), false);
  await recordNblLineMoves(board(key, [{ book: 'Sportsbet', line: 16.5, over: 1.9, under: 1.85 }]), '2099-10-18T00:20:00Z');

  const movement = await getNblLineMovement(opts);
  assert.ok(movement);
  const points = movement.stats.find((s) => s.stat === 'points');
  assert.ok(points);
  assert.equal(points.books.length, 1);
  const [book] = points.books;
  assert.equal(book.opening.line, 15.5);
  assert.equal(book.current.line, 16.5);
  assert.equal(book.points.length, 2);
  assert.equal(points.openingLine, 15.5);
  assert.equal(points.currentLine, 16.5);
});

test('uses the most balanced O/U when a book lists alternates', async () => {
  const key = '2099-10-20_sydney-kings_vs_melbourne-united';
  await recordNblLineMoves(
    board(key, [
      { book: 'TAB', line: 6.5, over: 1.9, under: 1.9, stat: 'rebounds' },
      { book: 'TAB', line: 8.5, over: 3.1, under: 1.3, stat: 'rebounds' },
    ]),
    '2099-10-18T01:00:00Z'
  );
  const movement = await getNblLineMovement(opts);
  assert.equal(movement?.stats.find((s) => s.stat === 'rebounds')?.books[0]?.current.line, 6.5);
});

test('returns every O/U stat for the player in a fixed order', async () => {
  const movement = await getNblLineMovement(opts);
  assert.deepEqual(movement?.stats.map((s) => s.stat), ['points', 'rebounds']);
});

test('a finished game is not shown', async () => {
  assert.equal(await getNblLineMovement({ ...opts, nowMs: Date.parse('2099-10-23T00:00:00Z') }), null);
});

test('unknown player or team returns nothing', async () => {
  const movement = await getNblLineMovement({ ...opts, player: 'Nobody Here' });
  assert.deepEqual(movement?.stats, []);
  const none = await getNblLineMovement({ ...opts, team: 'Perth Wildcats', opponent: null });
  assert.equal(none, null);
});
