import assert from 'node:assert/strict';
import { test } from 'node:test';
import { designationOf, diffReports, lineupGameKey, starterBasis, type ReportRow } from './contextRules';

const row = (id: number, status: string, team = 23): ReportRow => ({ player_id: id, team_id: team, status, return_date: null, description: 'ankle' });

test('status changes: new listings, changed statuses and players who drop off the report', () => {
  const prev = { '1': row(1, 'Questionable'), '2': row(2, 'Out'), '3': row(3, 'Day-To-Day') };
  const changes = diffReports(prev, [row(1, 'Out'), row(2, 'Out'), row(4, 'Doubtful')]);
  assert.deepEqual(
    changes.map((c) => [c.player_id, c.from_status, c.to_status, c.designation]),
    [
      ['1', 'Questionable', 'Out', 'out'],
      ['4', null, 'Doubtful', 'doubtful'],
      ['3', 'Day-To-Day', 'cleared', 'cleared'],
    ]
  );
  assert.deepEqual(diffReports(prev, Object.values(prev)), [], 'an unchanged report logs nothing');
});

test('designations', () => {
  assert.equal(designationOf('Out'), 'out');
  assert.equal(designationOf('Doubtful'), 'doubtful');
  assert.equal(designationOf('Questionable'), 'questionable');
  assert.equal(designationOf('Game Time Decision'), 'questionable');
  assert.equal(designationOf('Probable'), 'probable');
  assert.equal(designationOf('Day-To-Day'), 'day-to-day');
  assert.equal(designationOf(''), 'cleared');
});

test('lineup game key uses the US Eastern slate date', () => {
  assert.equal(lineupGameKey('2026-10-30T23:30:00Z', 'BOS', 'PHI'), '2026-10-30|BOS@PHI');
  assert.equal(lineupGameKey('2026-10-31T02:30:00Z', 'MEM', 'POR'), '2026-10-30|MEM@POR', 'a 10:30pm ET tip is still the 30th');
});

test('starter basis from the RotoWire version in force, fallback without one', () => {
  const roster = [
    { id: 'p1', name: 'VJ Edgecombe', teamCode: 'PHI' },
    { id: 'p2', name: 'Joel Embiid', teamCode: 'PHI' },
    { id: 'p3', name: 'Kelly Oubre Jr.', teamCode: 'PHI' },
  ];
  const lineup = { id: 'v1', gameKey: 'k', team: 'PHI', confirmed: false, starters: [{ name: 'V. Edgecombe' }], mayNotPlay: [{ name: 'Joel Embiid' }] };
  assert.equal(starterBasis(roster[0]!, lineup, roster), 'predicted:starter');
  assert.equal(starterBasis(roster[1]!, lineup, roster), 'predicted:may_not_play');
  assert.equal(starterBasis(roster[2]!, { ...lineup, confirmed: true }, roster), 'confirmed:bench');
  assert.equal(starterBasis(roster[0]!, undefined, roster), 'fallback');
});
