import assert from 'node:assert/strict';
import test from 'node:test';
import { armLivePostingEnabled, armMayGoLive, selectPromotableArm, type ArmStanding } from './promote';
import { buildReport, type Bounds, type ReportBet } from './report';

const bounds = (mean: number, lo99: number): Bounds => ({ mean, lo: lo99 + 0.002, hi: mean + (mean - lo99), games: 400, lo99, hi95: mean + (mean - lo99) });

function standing(id: string, o: { total?: [number, number]; a?: [number, number]; b?: [number, number]; reached?: boolean; calibrationHolds?: boolean; stop?: boolean } = {}): ArmStanding {
  const total = bounds(...(o.total ?? [0.04, 0.02]));
  const b = bounds(...(o.b ?? [0.03, 0.012]));
  const reached = o.reached ?? true;
  const calibrationHolds = o.calibrationHolds ?? true;
  return {
    id,
    policyVersion: `policy-${id}`,
    modelVersion: `model-${id}`,
    clv: { total, a: bounds(...(o.a ?? [0.01, 0.005])), b },
    verdict: {
      reopen: { reached, ready: reached && b.lo99 > 0 && total.lo99 > 0 && calibrationHolds, bLo99: b.lo99, totalLo99: total.lo99, calibrationHolds },
      futility: { stop: o.stop ?? false, upper95: total.hi95 },
    },
  };
}

test('live posting from an arm is off unless switched on explicitly', () => {
  assert.equal(armLivePostingEnabled({}), false);
  assert.equal(armLivePostingEnabled({ NBA_ARM_LIVE_POSTING: 'true' }), false);
  assert.equal(armLivePostingEnabled({ NBA_ARM_LIVE_POSTING: '1' }), false);
  assert.equal(armLivePostingEnabled({ NBA_ARM_LIVE_POSTING: 'on' }), true);
  const ready = standing('B');
  assert.equal(armMayGoLive(ready).ok, true);
  assert.equal(selectPromotableArm([ready], { enabled: false }), null, 'a ready arm is still not selected while the switch is off');
  assert.equal(selectPromotableArm([ready], { enabled: true })!.id, 'B');
});

test('every reopen rule is needed', () => {
  const cases: Array<[string, ArmStanding, string]> = [
    ['sample', standing('B', { reached: false }), 'measured sample not reached'],
    ['(b)', standing('B', { b: [0.01, -0.001] }), 'CLV (b) 99% lower bound is not above 0'],
    ['total', standing('B', { total: [0.01, -0.002] }), 'total CLV 99% lower bound is not above 0'],
    ['calibration', standing('B', { calibrationHolds: false }), 'calibration does not hold for overs and unders'],
    ['futility', standing('B', { stop: true }), 'futility stop has fired'],
  ];
  for (const [name, arm, reason] of cases) {
    const verdict = armMayGoLive(arm);
    assert.equal(verdict.ok, false, name);
    assert.deepEqual(verdict.missing, [reason], name);
    assert.equal(selectPromotableArm([arm], { enabled: true }), null, name);
  }
});

test('positive total CLV from (a) alone is line shopping and never goes live', () => {
  const shopping = standing('D', { total: [0.045, 0.036], a: [0.068, 0.06], b: [-0.022, -0.048] });
  assert.ok(shopping.clv.total.lo99 > 0);
  assert.deepEqual(armMayGoLive(shopping).missing, ['CLV (b) 99% lower bound is not above 0']);
  assert.equal(selectPromotableArm([shopping], { enabled: true }), null);
});

test('with several arms clear, the strongest (b) lower bound wins; arms that are not clear are ignored', () => {
  const arms = [standing('A', { b: [0.02, 0.004] }), standing('B', { b: [0.035, 0.02] }), standing('C', { b: [0.08, 0.05], reached: false }), standing('D', { b: [-0.02, -0.04] })];
  assert.equal(selectPromotableArm(arms, { enabled: true })!.id, 'B');
  assert.equal(selectPromotableArm([], { enabled: true }), null);
});

test('the rule agrees with the weekly report on a real (b) edge and on a price-only edge', () => {
  // Results hit exactly the predicted rate on both sides, so calibration is not what is being tested.
  let s = 7;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const bets = (a: number, b: number, hit: number): ReportBet[] =>
    Array.from({ length: 1200 }, (_, i) => {
      const drift = b + 0.08 * normal();
      const at = new Date(Date.parse('2026-11-01T00:00:00Z') + Math.floor((Math.floor(i / 2) / 600) * 60) * 86_400_000).toISOString();
      return { id: `${i}`, game: `g${Math.floor(i / 2)}`, at, policy: 'main', side: i % 2 ? 'under' : 'over', stat: 'points', line: 20.5, price: 1.95, confirmed: true, modelProb: hit, fairOver: 0.5, clv: { total: a + drift, a, b: drift, sameLine: true, k: 20, totalK08: a + drift, totalK125: a + drift, totalAllBooks: a + drift, closeLine: 20.5, closeFair: 0.5 }, result: Math.floor(i / 2) % 100 < hit * 100 ? 'win' : 'loss', check: null } as ReportBet;
    });
  const report = (a: number, b: number, hit: number) => buildReport({ bets: bets(a, b, hit), nowMs: Date.parse('2027-01-15T00:00:00Z'), gamesLeft: 800, policyVersion: 'p', modelVersion: 'm' });
  const edge = report(0, 0.03, 0.53);
  assert.equal(edge.verdict.reopen.ready, true);
  assert.equal(armMayGoLive({ id: 'B', policyVersion: 'p', modelVersion: 'm', clv: edge.clv, verdict: edge.verdict }).ok, true);
  const price = report(0.04, 0, 0.5);
  assert.ok(price.clv.total.lo99 > 0);
  assert.equal(armMayGoLive({ id: 'D', policyVersion: 'p', modelVersion: 'm', clv: price.clv, verdict: price.verdict }).ok, false);
});
