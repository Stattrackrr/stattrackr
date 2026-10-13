import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNblPbpPoints } from './sportRadarPbp';

const competitors = [
  { name: 'Sydney Kings', code: 'SYD', entityId: 'syd', isHome: true },
  { name: 'Adelaide 36ers', code: 'ADL', entityId: 'adl', isHome: false },
];

const ev = (periodId: number, eventType: string, extra: Record<string, unknown> = {}) => ({
  periodId,
  eventType,
  name: 'Xavier Cooks',
  personId: 'cooks',
  entityId: 'syd',
  success: true,
  ...extra,
});

const q1 = [ev(1, '3pt'), ev(1, 'rebound', { eventSubType: 'defensive' })];
const q4 = [ev(4, '2pt'), ev(4, 'assist'), ev(4, 'foul', { eventSubType: 'personal' })];

function check(json: unknown) {
  const parsed = parseNblPbpPoints('fx', json);
  const cooks = parsed?.players.find((p) => p.name === 'Xavier Cooks');
  assert.ok(cooks, 'player parsed');
  assert.deepEqual([cooks.q1_pts, cooks.q2_pts, cooks.q3_pts, cooks.q4_pts], [3, 0, 0, 2]);
  assert.equal(cooks.q1_reb, 1);
  assert.equal(cooks.q4_ast, 1);
  assert.equal(cooks.fouls, 1);
}

test('old feed: events under pbp keyed by period', () => {
  check({ data: { fixture: { competitors }, pbp: { '1': { events: q1 }, '4': { events: q4 } } } });
});

test('current feed: events under periodData (games from Oct 2026 were missing quarters)', () => {
  check({ data: { fixture: { competitors }, periodData: [{ events: q1 }, { events: [] }, { events: [] }, { events: q4 }] } });
});

test('fouls count personal, offensive and technicals but never drawn', () => {
  const foul = (eventSubType: string) => ({
    eventType: 'foul',
    eventSubType,
    name: 'Josh Bannan',
    personId: 'jb',
    entityId: 'tas',
    periodId: 1,
  });
  const parsed = parseNblPbpPoints('test-fixture', {
    data: {
      fixture: {
        competitors: [
          { name: 'Tasmania JackJumpers', code: 'TAS', entityId: 'tas', isHome: true },
          { name: 'Melbourne United', code: 'MEL', entityId: 'mel', isHome: false },
        ],
      },
      pbp: {
        '1': {
          events: [
            foul('personal'),
            foul('drawn'),
            foul('offensive'),
            foul('categoryOneTechnical'),
            foul('categoryTwoTechnical'),
            { eventType: '2pt', eventSubType: 'layup', name: 'Josh Bannan', personId: 'jb', entityId: 'tas', periodId: 1, success: true },
          ],
        },
      },
    },
  });
  const bannan = parsed?.players.find((p) => p.name === 'Josh Bannan');
  assert.ok(bannan);
  assert.equal(bannan.fouls, 4);
  assert.equal(bannan.total, 2);
});
