import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newsDirection } from './contextRules';
import { etDay, freshestNews, gameDayEt, newsAgeLn, type NewsItem } from './featureRules';

test('a game is dated by its US Eastern day, not the UTC date of its tip', () => {
  // 7:30pm ET on 13 Nov tips at 00:30 UTC on the 14th.
  assert.equal(gameDayEt('2026-11-14T00:30:00.000Z'), '2026-11-13');
  // An afternoon game is the same day either way.
  assert.equal(gameDayEt('2026-11-14T18:00:00Z'), '2026-11-14');
  assert.equal(gameDayEt('2026-11-13'), '2026-11-13', 'a bare date is already the local day');
  assert.equal(gameDayEt(null), '');
  assert.equal(etDay('2026-11-14T03:00:00Z'), '2026-11-13');
});

test("last night's game counts as before tonight, and a back to back is one day apart", () => {
  const lastNight = gameDayEt('2026-11-14T00:30:00Z');
  const tonight = etDay('2026-11-15T00:00:00Z');
  assert.ok(lastNight < tonight, "the previous night's game is in tonight's history");
  assert.equal((Date.parse(tonight) - Date.parse(lastNight)) / 86_400_000, 1);
  // One day of rest is not a back to back.
  const twoNightsAgo = gameDayEt('2026-11-13T00:30:00Z');
  assert.equal((Date.parse(tonight) - Date.parse(twoNightsAgo)) / 86_400_000, 2);
});

test('news age is measured from the change to the snapshot', () => {
  const at = Date.parse('2026-11-14T22:00:00Z');
  assert.equal(newsAgeLn(at, at), 0, 'a change seen in this run has age zero');
  assert.ok(Math.abs(newsAgeLn(at, at + 30 * 60_000)! - Math.log(31)) < 1e-12);
  assert.equal(newsAgeLn(at + 60_000, at), null, 'news after the snapshot is not known yet');
  assert.equal(newsAgeLn(NaN, at), null);
});

test('freshest news: the latest change among the players asked about', () => {
  const items: NewsItem[] = [
    { playerId: 'star', at: '2026-11-14T20:00:00Z', dir: 1 },
    { playerId: 'sixth', at: '2026-11-14T21:30:00Z', dir: -1 },
    { playerId: 'me', at: '2026-11-14T21:45:00Z', dir: 1 },
    { playerId: 'later', at: '2026-11-14T23:00:00Z', dir: 1 },
  ];
  const captured = Date.parse('2026-11-14T22:00:00Z');
  const mate = freshestNews(items, captured, (id) => id !== 'me')!;
  assert.equal(mate.playerId, 'sixth');
  assert.equal(mate.dir, -1);
  assert.ok(Math.abs(mate.ageLn - Math.log(31)) < 1e-12);
  assert.equal(freshestNews(items, captured, (id) => id === 'me')!.playerId, 'me');
  assert.equal(freshestNews(items, captured, (id) => id === 'nobody'), null);
});

test('news direction: toward out is +1, toward available is -1', () => {
  assert.equal(newsDirection({ from_status: 'Questionable', designation: 'out' }), 1);
  assert.equal(newsDirection({ from_status: null, designation: 'questionable' }), 1);
  assert.equal(newsDirection({ from_status: 'Out', designation: 'questionable' }), -1);
  assert.equal(newsDirection({ from_status: 'Doubtful', designation: 'cleared' }), -1);
  assert.equal(newsDirection({ from_status: 'Out', designation: 'out' }), 0);
});
