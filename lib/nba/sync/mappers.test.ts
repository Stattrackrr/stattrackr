import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFieldGoalAttempt, mapLineup, mapPlay, mapPlayerGameStat, mapShot, parseBdlMinutes } from './mappers';

const game = { id: 1, season: 2025, game_date: '2026-01-10', home_team_id: 6, visitor_team_id: 18 };

test('minutes: plain, mm:ss and DNP', () => {
  assert.equal(parseBdlMinutes('25'), 25);
  assert.equal(parseBdlMinutes('25:30'), 25.5);
  assert.equal(parseBdlMinutes('00'), 0);
  assert.equal(parseBdlMinutes(null), null);
});

test('box score: team and opponent come from the game, not player.team_id', () => {
  const row = mapPlayerGameStat(
    {
      min: '30', pts: 12,
      player: { id: 387, team_id: 3 },
      team: { id: 18 },
      game: { id: 1, date: '2026-01-10', season: 2025, home_team_id: 6, visitor_team_id: 18 },
    },
    0
  );
  assert.equal(row.team_id, 18);
  assert.equal(row.opponent_team_id, 6);
  assert.equal(row.is_home, false);
});

test('lineup: team from the row', () => {
  const row = mapLineup({ game_id: 1, starter: true, position: 'F', player: { id: 387, team_id: 3 }, team: { id: 18 } });
  assert.equal(row.team_id, 18);
});

test('plays: placeholder coordinates on non-shots become null', () => {
  const row = mapPlay({ order: 1, type: 'Jumpball', coordinate_x: -214748340, coordinate_y: -214748365, team: { id: 6 } }, game);
  assert.equal(row.coordinate_x, null);
  assert.equal(row.coordinate_y, null);
});

test('shots: assisted make credits the assister; free throws are not attempts', () => {
  const make = {
    order: 9, type: 'Driving Layup Shot', text: 'Rudy Gobert makes driving layup (Anthony Edwards assists)',
    scoring_play: true, shooting_play: true, score_value: 2, team: { id: 18 },
    coordinate_x: 26, coordinate_y: 2, participants: [176, 3547238],
  };
  const shot = mapShot(make, game)!;
  assert.equal(shot.shooter_id, 176);
  assert.equal(shot.assister_id, 3547238);
  assert.equal(shot.opponent_team_id, 6);
  assert.equal(shot.zone, 'restricted');

  const blocked = { ...make, scoring_play: false, score_value: null, text: 'Rudy Gobert misses driving layup (Jarrett Allen blocks)' };
  assert.equal(mapShot(blocked, game)!.assister_id, null);

  assert.equal(isFieldGoalAttempt({ shooting_play: true, type: 'Free Throw - 1 of 2', participants: [1] }), false);
  assert.equal(isFieldGoalAttempt(make), true);
});

test('shots: three-pointers flagged from text on misses', () => {
  const miss = {
    order: 2, type: 'Jump Shot', text: 'Jabari Smith Jr. misses 25-foot three point jumper',
    scoring_play: false, shooting_play: true, score_value: null, team: { id: 6 },
    coordinate_x: 7, coordinate_y: 18, participants: [1],
  };
  const shot = mapShot(miss, game)!;
  assert.equal(shot.is_three, true);
  assert.equal(shot.zone, 'above_break_3');
});
