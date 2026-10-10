import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  tennisRosterKeepsStored,
  type TennisRosterCache,
  tennisLogsKeepStoredGames,
  upsertTennisPlayerLogs,
  type TennisPlayerLogsCache,
  type TennisPlayerLogsStore,
} from './dashboardCache';
import type { SharedCacheCasEntry } from '../sharedCache';
import type { TennisMatchRow } from './types';

const KEY = (id: string) => `tennis_player_logs_v1:${id}`;

function game(id: string | number, date = '2025-01-01'): TennisMatchRow {
  return {
    matchId: String(id),
    date,
    playerId: '2838',
    playerName: 'Brandon Nakashima',
    opponent: `Opp ${id}`,
    tour: 'ATP',
  } as TennisMatchRow;
}

function games(n: number, from = 0): TennisMatchRow[] {
  return Array.from({ length: n }, (_, i) => game(from + i, `2025-01-${String((i % 28) + 1).padStart(2, '0')}`));
}

function payload(id: string, rows: TennisMatchRow[], extra: Partial<TennisPlayerLogsCache> = {}): TennisPlayerLogsCache {
  return { fetchedAt: '2026-10-10T08:00:00.000Z', playerId: id, playerName: 'Brandon Nakashima', tour: 'ATP', games: rows, ...extra };
}

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: SharedCacheCasEntry[] = [];
  let failReads = false;
  let beforeWrite: (() => void) | null = null;
  const store: TennisPlayerLogsStore = {
    async readRaw(keys) {
      if (failReads) throw new Error('Redis timed out');
      return keys.map((key) => data.get(key) ?? null);
    },
    async casWrite(entries) {
      if (beforeWrite) {
        const hook = beforeWrite;
        beforeWrite = null;
        hook();
      }
      return entries.map((entry) => {
        if ((data.get(entry.key) ?? null) !== entry.expectedRaw) return false;
        writes.push(entry);
        data.set(entry.key, JSON.stringify(entry.value));
        return true;
      });
    },
  };
  return {
    store,
    data,
    writes,
    failReads: () => {
      failReads = true;
    },
    onNextWrite: (fn: () => void) => {
      beforeWrite = fn;
    },
    stored: (id: string) => JSON.parse(data.get(KEY(id)) || 'null') as TennisPlayerLogsCache | null,
  };
}

test('a failed Redis read throws and writes nothing (the bug that wiped history)', async () => {
  const fake = fakeStore({ [KEY('2838')]: JSON.stringify(payload('2838', games(208))) });
  fake.failReads();
  await assert.rejects(upsertTennisPlayerLogs([payload('2838', [game('new-1', '2026-10-09')])], fake.store));
  assert.equal(fake.writes.length, 0);
  assert.equal(fake.stored('2838')?.games.length, 208);
});

test('new matches are appended onto the full stored history', async () => {
  const fake = fakeStore({ [KEY('2838')]: JSON.stringify(payload('2838', games(208), { historyBackfilled: true })) });
  const result = await upsertTennisPlayerLogs(
    [payload('2838', [game('new-1', '2026-10-08'), game('new-2', '2026-10-09')])],
    fake.store
  );
  assert.equal(result.written, 1);
  assert.equal(result.added, 2);
  assert.equal(fake.stored('2838')?.games.length, 210);
  assert.equal(fake.stored('2838')?.historyBackfilled, true);
});

test('gzip-packed stored logs are decoded and kept', async () => {
  const packed = {
    v: 1,
    encoding: 'gzip-json',
    payload: gzipSync(Buffer.from(JSON.stringify(payload('2838', games(150))))).toString('base64'),
  };
  const fake = fakeStore({ [KEY('2838')]: JSON.stringify(packed) });
  await upsertTennisPlayerLogs([payload('2838', [game('new-1', '2026-10-09')])], fake.store);
  assert.equal(fake.stored('2838')?.games.length, 151);
});

test('already-stored matches cause no write', async () => {
  const fake = fakeStore({ [KEY('2838')]: JSON.stringify(payload('2838', games(50))) });
  const result = await upsertTennisPlayerLogs([payload('2838', games(3))], fake.store);
  assert.equal(result.unchanged, 1);
  assert.equal(fake.writes.length, 0);
});

test('a player with no stored log gets the incoming games', async () => {
  const fake = fakeStore();
  const result = await upsertTennisPlayerLogs([payload('9999', games(2))], fake.store);
  assert.equal(result.written, 1);
  assert.equal(fake.stored('9999')?.games.length, 2);
});

test('an undecodable stored value is never overwritten', async () => {
  const fake = fakeStore({ [KEY('2838')]: '{"v":1,"encoding":"gzip-json","payload":"not-gzip"}' });
  const result = await upsertTennisPlayerLogs([payload('2838', games(2))], fake.store);
  assert.equal(result.refused, 1);
  assert.equal(fake.writes.length, 0);
});

test('a concurrent writer is re-read and merged, not clobbered', async () => {
  const fake = fakeStore({ [KEY('2838')]: JSON.stringify(payload('2838', games(100))) });
  fake.onNextWrite(() => {
    fake.data.set(KEY('2838'), JSON.stringify(payload('2838', [...games(100), game('other-writer', '2026-10-09')])));
  });
  const result = await upsertTennisPlayerLogs([payload('2838', [game('mine', '2026-10-10')])], fake.store);
  assert.equal(result.written, 1);
  const ids = new Set(fake.stored('2838')?.games.map((row) => row.matchId));
  assert.equal(ids.size, 102);
  assert.ok(ids.has('other-writer') && ids.has('mine'));
});

test('stored rows without a matchId survive a merge', async () => {
  const legacy = { ...game('x'), matchId: undefined } as unknown as TennisMatchRow;
  const fake = fakeStore({ [KEY('2838')]: JSON.stringify(payload('2838', [...games(10), legacy])) });
  await upsertTennisPlayerLogs([payload('2838', [game('new-1', '2026-10-09')])], fake.store);
  assert.equal(fake.stored('2838')?.games.length, 12);
});

test('duplicate payloads for one player in a batch are combined', async () => {
  const fake = fakeStore({ [KEY('2838')]: JSON.stringify(payload('2838', games(20))) });
  await upsertTennisPlayerLogs(
    [payload('2838', [game('a', '2026-10-01')]), payload('2838', [game('b', '2026-10-02')])],
    fake.store
  );
  assert.equal(fake.stored('2838')?.games.length, 22);
});

function roster(players: number, standings: number): TennisRosterCache {
  const row = (i: number) => ({ playerId: String(1000 + i), name: `P ${i}`, tour: 'ATP' as const, ioc: null, hand: null, height: null, rank: i + 1, rankPoints: null, imageUrl: null });
  return {
    fetchedAt: '2026-10-10T00:00:00.000Z',
    players: Array.from({ length: players }, (_, i) => row(i)),
    standings: {
      ATP: Array.from({ length: standings }, (_, i) => ({ pos: i + 1, playerId: String(1000 + i), name: `P ${i}`, tour: 'ATP' as const, points: 1, ioc: null })),
      WTA: [],
    },
  };
}

test('a roster write that would shrink the stored roster is refused (the 105-player wipe)', () => {
  assert.equal(tennisRosterKeepsStored(roster(1900, 500), roster(105, 0)), false);
  assert.equal(tennisRosterKeepsStored(roster(1900, 500), roster(1900, 0)), false);
  assert.equal(tennisRosterKeepsStored(roster(1900, 500), roster(1950, 500)), true);
  assert.equal(tennisRosterKeepsStored(null, roster(105, 0)), true);
});

test('the keep-stored-games invariant only allows the oldest games to fall off at the cap', () => {
  assert.equal(tennisLogsKeepStoredGames(games(208), games(2)), false);
  assert.equal(tennisLogsKeepStoredGames(games(10), [...games(9), game('other')]), false);
  assert.equal(tennisLogsKeepStoredGames(games(10), games(11)), true);
  assert.equal(tennisLogsKeepStoredGames(games(400), games(400, 1)), true);
});
