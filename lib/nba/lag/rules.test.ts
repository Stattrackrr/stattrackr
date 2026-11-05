import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auFollowed, detectUsMoves, usLines, type BdlPropRow } from './rules';

const row = (vendor: string, line: number, over: number, under: number, updated = '2026-10-31T00:00:00Z', prop = 'points'): BdlPropRow => ({
  player_id: 7,
  vendor,
  prop_type: prop,
  line_value: String(line),
  market: { type: 'over_under', over_odds: over, under_odds: under },
  updated_at: updated,
});

test('US lines: each book keeps its most balanced over/under', () => {
  const lines = usLines([row('draftkings', 24.5, -110, -110), row('draftkings', 22.5, -250, 190), row('fanduel', 24.5, -115, -105), row('betmgm', 24.5, -110, -110)]);
  const l = lines.get('7|points')!;
  assert.equal(l.books.draftkings?.line, 24.5);
  assert.equal(l.books.fanduel?.line, 24.5);
  assert.equal(Object.keys(l.books).length, 2, 'only DraftKings and FanDuel');
});

test('US move: both books moving the same way, by line or by fair price', () => {
  const before = usLines([row('draftkings', 24.5, -110, -110), row('fanduel', 24.5, -110, -110)]);
  const lineDown = usLines([row('draftkings', 23.5, -110, -110, '2026-10-31T00:01:05Z'), row('fanduel', 23.5, -110, -110, '2026-10-31T00:01:20Z')]);
  const moves = detectUsMoves(before, lineDown);
  assert.equal(moves.length, 1);
  assert.equal(moves[0]!.direction, 1, 'line down: the over is now more likely');
  assert.equal(moves[0]!.movedAt, '2026-10-31T00:01:20Z', 'the later of the two scrapes');
  const priceOnly = usLines([row('draftkings', 24.5, -140, 110), row('fanduel', 24.5, -135, 105)]);
  assert.equal(detectUsMoves(before, priceOnly)[0]?.direction, 1, 'over shortened 6+ points at both books');
  const oneBook = usLines([row('draftkings', 23.5, -110, -110), row('fanduel', 24.5, -110, -110)]);
  assert.equal(detectUsMoves(before, oneBook).length, 0, 'one book alone is not a move');
  const opposite = usLines([row('draftkings', 23.5, -110, -110), row('fanduel', 25.5, -110, -110)]);
  assert.equal(detectUsMoves(before, opposite).length, 0);
});

test('AU follow: same direction by line, or by at least a point of implied probability', () => {
  const before = { line: 24.5, over: 1.9, under: 1.9 };
  assert.equal(auFollowed(before, { line: 23.5, over: 1.9, under: 1.9 }, 1), true);
  assert.equal(auFollowed(before, { line: 25.5, over: 1.9, under: 1.9 }, 1), false, 'moved the other way');
  assert.equal(auFollowed(before, { line: 24.5, over: 1.8, under: 2.0 }, 1), true, 'over shortened');
  assert.equal(auFollowed(before, { line: 24.5, over: 1.89, under: 1.91 }, 1), false, 'too small to count');
  assert.equal(auFollowed(before, { line: 24.5, over: 2.0, under: 1.8 }, -1), true, 'under shortened for a down move');
});
