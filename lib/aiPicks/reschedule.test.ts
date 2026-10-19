import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rescheduledStart, reschedules, type FixtureTimes } from './reschedule';
import type { AiPick, AiPickLeg } from './types';

const leg = (over: Partial<AiPickLeg>): AiPickLeg =>
  ({
    id: 'l1',
    pickId: 'p1',
    legIndex: 0,
    sport: 'tennis',
    eventKey: '12345',
    eventLabel: 'Toby Samuel vs Zizou Bergs',
    startsAt: '2026-10-19T08:00:00.000Z',
    status: 'pending',
    ...over,
  }) as AiPickLeg;

const times: FixtureTimes = {
  tennis: new Map([
    ['12345', '2026-10-20T08:00:00.000Z'],
    ['777', '2026-10-19T08:02:00Z'],
  ]),
  nbl: [
    { homeTeam: 'Sydney Kings', awayTeam: 'Perth Wildcats', startsAt: '2026-10-23T09:30:00Z' },
    { homeTeam: 'Sydney Kings', awayTeam: 'Perth Wildcats', startsAt: '2026-11-06T09:30:00Z' },
  ],
};

test('reschedule: tennis leg follows its match id to the new day; small differences are ignored', () => {
  assert.equal(rescheduledStart(leg({}), times), '2026-10-20T08:00:00.000Z');
  assert.equal(rescheduledStart(leg({ eventKey: '777' }), times), null, 'two minutes is feed rounding');
  assert.equal(rescheduledStart(leg({ eventKey: 'gone' }), times), null, 'match not in the fixtures: leave it');
});

test('reschedule: NBL leg matches the same two teams, nearest game within two days', () => {
  const nbl = leg({ sport: 'nbl', eventKey: '2026-10-22_perth-wildcats_vs_sydney-kings', eventLabel: 'Perth Wildcats @ Sydney Kings', startsAt: '2026-10-22T09:30:00Z' });
  assert.equal(rescheduledStart(nbl, times), '2026-10-23T09:30:00.000Z');
  assert.equal(rescheduledStart({ ...nbl, startsAt: '2026-10-30T09:30:00Z' }, times), null, 'a game a week away is a different game');
});

test('reschedule: only pending legs move, and the pick gets its new first start', () => {
  const pick = {
    id: 'p1',
    legs: [leg({}), leg({ id: 'l2', eventKey: '999', startsAt: '2026-10-19T08:00:00.000Z' }), leg({ id: 'l3', eventKey: '12345', status: 'win' })],
  } as AiPick;
  const tennis = new Map([...times.tennis, ['999', '2026-10-20T07:00:00.000Z']]);
  const out = reschedules([pick], { ...times, tennis });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.legs.map((l) => l.id), ['l1', 'l2']);
  assert.equal(out[0]!.firstStartsAt, '2026-10-19T08:00:00.000Z', 'the settled leg already started');
  const open = reschedules([{ ...pick, legs: pick.legs.slice(0, 2) } as AiPick], { ...times, tennis });
  assert.equal(open[0]!.firstStartsAt, '2026-10-20T07:00:00.000Z');
  assert.deepEqual(reschedules([{ ...pick, legs: [leg({ eventKey: '777' })] } as AiPick], times), []);
});
