import assert from 'node:assert/strict';
import test from 'node:test';
import { ARMS } from '@/lib/nba/propLog/arms';
import type { FitGate } from './fitGate';
import { buildReport, type Report, type ReportBet } from './report';
import { buildScoreboard } from './scoreboard';

function report(opts: { games: number; a: number; b: number; hit: number; trigger?: string; policy?: 'main' | 'news' }): Report {
  let s = 11;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const bets: ReportBet[] = [];
  for (let g = 0; g < opts.games; g += 1) {
    const at = new Date(Date.parse('2026-11-01T00:00:00Z') + Math.floor((g / Math.max(1, opts.games)) * 60) * 86_400_000).toISOString();
    for (let i = 0; i < 2; i += 1) {
      const b = opts.b + 0.08 * normal();
      bets.push({ id: `${g}-${i}`, game: `g${g}`, at, policy: opts.policy ?? 'main', trigger: opts.trigger, side: i % 2 ? 'under' : 'over', stat: 'points', line: 20.5, price: 1.95, confirmed: true, modelProb: opts.hit, fairOver: 0.5, clv: { total: opts.a + b, a: opts.a, b, sameLine: true, k: 20, totalK08: opts.a + b, totalK125: opts.a + b, totalAllBooks: opts.a + b, closeLine: 20.5, closeFair: 0.5 }, result: g % 100 < opts.hit * 100 ? 'win' : 'loss', check: null });
    }
  }
  return buildReport({ bets, nowMs: Date.parse('2027-01-15T00:00:00Z'), gamesLeft: 800, policyVersion: 'p', modelVersion: 'm' });
}

const lift = (mean: number, lo: number) => ({ mean, lo, hi: mean + (mean - lo), games: 95 });
const fitted = (mean: number, lo: number): FitGate => ({
  status: 'fitted',
  promoteShadow: lo > 0,
  beatsMarket: lo > 0,
  beatsFittedMarket: false,
  latencySignature: null,
  lines: 6622,
  games: 95,
  dates: 15,
  liftVsMarket: lift(mean, lo),
  liftVsFittedMarket: lift(mean, lo),
  liftAtClose: null,
  coefs: ARMS[0]!.coefs,
  readings: ['reading'],
});
const collecting: FitGate = { status: 'insufficient', promoteShadow: false, lines: 120, dates: 2, needLines: 300, needDates: 10, readings: ['Need 10 ET dates'] };

const [A, B, C, D] = ARMS as unknown as [(typeof ARMS)[number], (typeof ARMS)[number], (typeof ARMS)[number], (typeof ARMS)[number]];
const key = (v: string) => `nba_model_report_v1:${v}`;

test('one row per arm, each read against the same rules, with its own report key', () => {
  const board = buildScoreboard({
    generatedAt: '2027-01-15T00:00:00.000Z',
    arms: [
      { arm: D, report: report({ games: 300, a: 0.04, b: 0, hit: 0.5 }) },
      { arm: A, report: report({ games: 300, a: 0.05, b: -0.02, hit: 0.5 }) },
      { arm: B, report: report({ games: 600, a: 0, b: 0.03, hit: 0.53 }) },
      { arm: C, report: report({ games: 0, a: 0, b: 0, hit: 0.5 }) },
    ],
    reportKey: key,
    gate: fitted(-0.0008, -0.0019),
    cleanGate: collecting,
    cleanFeatureVersions: ['inputs-v6'],
    livePostingEnabled: false,
  });
  assert.deepEqual(board.arms.map((a) => a.id), ['A', 'B', 'C', 'D']);
  assert.deepEqual(board.failed, []);
  const [a, b, c, d] = board.arms;
  assert.equal(a!.policyVersion, 'shadow-v0.1');
  assert.equal(a!.reportKey, 'nba_model_report_v1:v0-market');
  assert.equal(b!.reportKey, 'nba_model_report_v1:b-role-v1');
  assert.equal(new Set(board.arms.map((x) => x.reportKey)).size, 4);

  // B: a real (b) edge on a measured sample is the only arm clear of every rule.
  assert.equal(b!.reopen.ready, true);
  assert.deepEqual(b!.missingForLive, []);
  // A and D: positive total from the price alone does not reopen.
  for (const shopping of [a!, d!]) {
    assert.ok(shopping.clv.total.lo99 > 0);
    assert.equal(shopping.reopen.ready, false);
    assert.ok(shopping.missingForLive.includes('CLV (b) 99% lower bound is not above 0'));
  }
  // C: no bets yet reads as not measured, not as a pass or a stop.
  assert.equal(c!.counts.bets, 0);
  assert.equal(c!.reopen.ready, false);
  assert.ok(c!.missingForLive.includes('measured sample not reached'));

  // Even with an arm clear, nothing is promotable while the switch is off.
  assert.deepEqual(board.livePosting, { enabled: false, promotable: null });
});

test('with the switch on, only an arm that clears every rule is named', () => {
  const arms = [
    { arm: A, report: report({ games: 300, a: 0.05, b: -0.02, hit: 0.5 }) },
    { arm: B, report: report({ games: 600, a: 0, b: 0.03, hit: 0.53 }) },
  ];
  const base = { generatedAt: 'x', reportKey: key, gate: collecting, cleanGate: collecting, cleanFeatureVersions: ['inputs-v6'] };
  assert.equal(buildScoreboard({ ...base, arms, livePostingEnabled: true }).livePosting.promotable, 'B');
  assert.equal(buildScoreboard({ ...base, arms: arms.slice(0, 1), livePostingEnabled: true }).livePosting.promotable, null);
});

test("an arm whose report failed is listed as failed and does not hide the others", () => {
  const board = buildScoreboard({
    generatedAt: 'x',
    arms: [
      { arm: A, report: report({ games: 300, a: 0.05, b: -0.02, hit: 0.5 }) },
      { arm: C, report: null, error: 'nba_shadow_bets: timeout' },
    ],
    reportKey: key,
    gate: collecting,
    cleanGate: collecting,
    cleanFeatureVersions: ['inputs-v6'],
    livePostingEnabled: false,
  });
  assert.deepEqual(board.arms.map((a) => a.id), ['A']);
  assert.deepEqual(board.failed, [{ id: 'C', name: 'news-lag', policyVersion: 'arm-c-lag-v1', modelVersion: 'c-lag-v1', error: 'nba_shadow_bets: timeout' }]);
});

test('coefficients are promoted on the sound-inputs fit only', () => {
  const base = { generatedAt: 'x', arms: [], reportKey: key, cleanFeatureVersions: ['inputs-v6'], livePostingEnabled: false };
  // The all-lines fit (which includes lines logged with broken inputs) shows lift, the sound fit is still collecting.
  const waiting = buildScoreboard({ ...base, gate: fitted(0.002, 0.0005), cleanGate: collecting });
  assert.equal(waiting.residual.promoteShadow, false);
  assert.equal(waiting.residual.allLines.promoteShadow, true, 'the all-lines gate is still reported as it reads');
  assert.equal(waiting.residual.cleanInputs.status, 'insufficient');
  assert.ok(waiting.residual.readings.some((r) => r.includes('2 of 10 ET dates')));
  assert.ok(waiting.residual.readings.some((r) => r.includes('Wait for the sound-inputs fit')));

  const noLift = buildScoreboard({ ...base, gate: fitted(-0.0008, -0.0019), cleanGate: fitted(0.0004, -0.0006) });
  assert.equal(noLift.residual.promoteShadow, false, 'lift whose lower bound is not above zero does not promote');
  assert.deepEqual(noLift.residual.cleanInputs.liftVsMarket, lift(0.0004, -0.0006));

  const pass = buildScoreboard({ ...base, gate: fitted(-0.0008, -0.0019), cleanGate: fitted(0.002, 0.0005) });
  assert.equal(pass.residual.promoteShadow, true);
  assert.ok(pass.residual.readings[0]!.includes('new model_version'));
});
