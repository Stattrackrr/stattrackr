import assert from 'node:assert/strict';
import test from 'node:test';
import { sportRadarShotRows, type SrShotRow } from './sportRadarShots';

const shot = (eventType: string, success: boolean): SrShotRow => ({
  eventType,
  eventSubType: 'jumpshot',
  desc: `${eventType} Jump Shot`,
  success,
  successString: success ? 'made' : 'missed',
  x: 30,
  y: 50,
});

test('old feed: shots under shotChart.shots', () => {
  const rows = sportRadarShotRows({ shotChart: { shots: [shot('3pt', true), shot('2pt', false)] } });
  assert.equal(rows.length, 2);
});

test('current feed: shots split per quarter under periodData (the missing NBL27 games)', () => {
  const rows = sportRadarShotRows({
    shotChart: {},
    periodData: [
      { shots: [shot('3pt', true), shot('3pt', true)] },
      { shots: [shot('2pt', false)] },
      { shots: null },
      { shots: [shot('3pt', false)] },
    ],
  });
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((r) => r.eventType === '3pt' && r.success).length, 2);
});

test('no shots anywhere gives an empty list', () => {
  assert.deepEqual(sportRadarShotRows({ shotChart: {} }), []);
  assert.deepEqual(sportRadarShotRows(null), []);
});
