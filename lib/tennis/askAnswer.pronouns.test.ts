import assert from 'node:assert/strict';
import test from 'node:test';
import { tennisReplyMisgenders } from './askAnswer';
import { sortTennisMatchesOldestFirst } from './chartStats';

test('an ATP reply that calls the player her is sent back to the AI', () => {
  assert.equal(tennisReplyMisgenders('Gea is 13/15 on hard across her last 15 best-of-3 matches.', 'ATP'), true);
  assert.equal(tennisReplyMisgenders('Gea is 13/15 on hard across his last 15 best-of-3 matches.', 'ATP'), false);
});

test('a WTA reply that calls the player he is sent back to the AI', () => {
  assert.equal(tennisReplyMisgenders('He has held 80% of service games.', 'WTA'), true);
  assert.equal(tennisReplyMisgenders('She has held 80% of her service games.', 'WTA'), false);
});

test('words that only contain a pronoun do not trigger a rewrite', () => {
  assert.equal(tennisReplyMisgenders('The other shelter held there, then herald the chess.', 'ATP'), false);
  assert.equal(tennisReplyMisgenders('The other shelter held there, then the chess.', 'WTA'), false);
});

test('stored logs are put in date order so last-N is the latest matches', () => {
  const rows = [
    { date: '2025-10-12', round: 'F', id: 'old-f' },
    { date: '2026-10-02', round: 'R32', id: 'hurkacz' },
    { date: '2024-01-03', round: 'R32', id: 'oldest' },
    { date: '2025-10-12', round: 'SF', id: 'old-sf' },
    { date: '2026-10-11', round: 'R32', id: 'shelton' },
  ];
  assert.deepEqual(
    sortTennisMatchesOldestFirst(rows).map((row) => row.id),
    ['oldest', 'old-sf', 'old-f', 'hurkacz', 'shelton']
  );
});
