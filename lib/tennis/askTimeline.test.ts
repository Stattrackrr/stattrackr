import assert from 'node:assert/strict';
import test from 'node:test';
import { tennisAgo, tennisRowRetired, tennisTimelineForRows } from './matchAnalyst';
import type { TennisMatchRow } from './types';

const NOW = Date.parse('2026-10-13T10:00:00Z');

function row(date: string, isWin: boolean, score = '6-3 6-4', opponent = 'Jane Doe'): TennisMatchRow {
  return { date, isWin, score, opponent } as TennisMatchRow;
}

test('ago wording is worked out in code', () => {
  assert.equal(tennisAgo('2026-10-12', NOW)?.ago, 'yesterday');
  assert.equal(tennisAgo('2026-10-03', NOW)?.ago, '10 days ago');
  assert.equal(tennisAgo('2026-09-16', NOW)?.ago, '4 weeks ago');
  assert.equal(tennisAgo('2025-09-01', NOW)?.ago, '13 months ago');
  assert.equal(tennisAgo('2025-09-01', NOW)?.months, 13);
  assert.equal(tennisAgo('2023-05-01', NOW)?.ago, '3 years ago');
  assert.equal(tennisAgo(null, NOW), null);
});

test('retired, walkover and abandoned matches are spotted from the score', () => {
  assert.equal(tennisRowRetired({ score: '6-7(5) RET' }), true);
  assert.equal(tennisRowRetired({ score: 'W/O' }), true);
  assert.equal(tennisRowRetired({ score: '6-2 3-1 ret.' }), true);
  assert.equal(tennisRowRetired({ score: '6-0 4-6 7-6(8)' }), false);
});

test('timeline gives the current streak, last match and how far back last 15 goes', () => {
  const rows = [
    row('2026-03-01', false),
    row('2026-09-01', false),
    ...['2026-09-20', '2026-09-22', '2026-09-24', '2026-09-26', '2026-09-28', '2026-09-30', '2026-10-02'].map((d) =>
      row(d, true)
    ),
  ];
  rows[rows.length - 1]!.opponent = 'Mona Barthel';
  const timeline = tennisTimelineForRows(rows, rows, NOW);
  assert.deepEqual(timeline.streak, { result: 'won', count: 7 });
  assert.equal(timeline.lastMatch?.ago, '11 days ago');
  assert.equal(timeline.lastMatch?.opponent, 'Barthel');
  assert.equal(timeline.last15From?.ago, '7 months ago');
});
