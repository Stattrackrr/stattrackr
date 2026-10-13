import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiCandidate } from '@/lib/aiPicks/candidates/types';
import type { Proposal } from '@/lib/aiPicks/decide/select';
import { bestWeight, learnSport, pickMetrics, shrinkStep, type LearnSample } from '@/lib/aiPicks/learn/learn';
import { DEFAULT_AI_PICKS_PARAMS, modelGroup, modelVersion } from '@/lib/aiPicks/params';
import type { AiPick, AiPickLeg } from '@/lib/aiPicks/types';
import { kellyStake, sizeUnits, snapUnits, trackRecords } from '@/lib/aiPicks/units';

const P = DEFAULT_AI_PICKS_PARAMS;
const NOW = Date.parse('2026-10-14T00:00:00Z');

function single(prob: number, price: number, over: Partial<AiCandidate> = {}): Proposal {
  const c = {
    key: 'k',
    sport: 'tennis',
    market: 'total_games',
    marketKind: 'main',
    pushProb: 0,
    supportScore: 0.6,
    ...over,
  } as AiCandidate;
  return { kind: 'single', key: 'k', sport: c.sport, legs: [{ c, price, book: 'Bet365' }], price, book: 'Bet365', prob, ev: prob * price - 1, reason: '' };
}

const proven = { tennis: { settled: 50, recentPicks: 10, recentRoi: 0.05 } };

test('kelly stake and the unit ladder', () => {
  assert.ok(Math.abs(kellyStake(0.6, 2) - 0.2) < 1e-9);
  assert.equal(kellyStake(0.4, 2), 0);
  assert.ok(Math.abs(kellyStake(0.5, 2, 0.2) - 0.2) < 1e-9);
  assert.equal(snapUnits(0.1), 0.5);
  assert.equal(snapUnits(1.74), 1.5);
  assert.equal(snapUnits(9), 3);
});

test('sizing: edge drives size, caps keep it honest', () => {
  assert.equal(sizeUnits(single(0.6, 2), P, proven).units, 3);
  // New sport: capped until it has a record.
  const fresh = sizeUnits(single(0.6, 2), P, {});
  assert.equal(fresh.units, 1.5);
  assert.match(fresh.why, /still proving itself/);
  // Long price.
  assert.equal(sizeUnits(single(0.45, 2.8), P, proven).units, 1.5);
  // Thin edge stays small.
  assert.equal(sizeUnits(single(0.53, 1.95), P, proven).units, 1);
  // Bad recent run.
  const cold = { tennis: { settled: 80, recentPicks: 25, recentRoi: -0.2 } };
  assert.equal(sizeUnits(single(0.6, 2), P, cold).units, 1);
  // Learned stake scale pulls it down.
  const scaled = { ...P, tennis: { ...P.tennis, stakeScale: { total_games: 0.6 } } };
  assert.equal(sizeUnits(single(0.56, 1.95), scaled, proven).units, 1.5);
  // Multis cap at 1 unit.
  const m = single(0.6, 2);
  assert.equal(sizeUnits({ ...m, kind: 'multi', legs: [...m.legs, ...m.legs] }, P, proven).units, 1);
});

test('track records count settled picks and recent ROI', () => {
  const rec = trackRecords(
    [
      { sport: 'nbl', status: 'win', units: 1, profitUnits: 0.9, postedAt: new Date(NOW - 86_400_000).toISOString() },
      { sport: 'nbl', status: 'loss', units: 2, profitUnits: -2, postedAt: new Date(NOW - 2 * 86_400_000).toISOString() },
      { sport: 'nbl', status: 'win', units: 1, profitUnits: 1, postedAt: new Date(NOW - 90 * 86_400_000).toISOString() },
      { sport: 'nbl', status: 'pending', units: 1, profitUnits: null, postedAt: new Date(NOW).toISOString() },
    ],
    NOW
  );
  assert.equal(rec.nbl!.settled, 3);
  assert.equal(rec.nbl!.recentPicks, 2);
  assert.ok(Math.abs(rec.nbl!.recentRoi! - -1.1 / 3) < 1e-9);
});

test('model groups and version labels', () => {
  assert.equal(modelGroup({ sport: 'nbl', market: 'points', marketKind: 'milestone' }), 'milestone');
  assert.equal(modelGroup({ sport: 'nbl', market: 'points', marketKind: 'main' }), 'prop');
  assert.equal(modelGroup({ sport: 'tennis', market: 'total_games', marketKind: 'main' }), 'total_games');
  assert.equal(modelVersion({ ...P, versions: { nbl: 3, tennis: 0 } }, ['tennis', 'nbl', 'nbl']), 'nbl v3 / tennis v0');
});

function outcomes(prob: number, n: number, wins: number) {
  return Array.from({ length: n }, (_, i) => (i < wins ? 1 : 0) as 0 | 1).map((won) => ({ prob, won }));
}

test('best weight follows whichever source called the results', () => {
  const modelRight = [
    ...outcomes(0.7, 50, 35).map((o) => ({ model: 0.7, marketProb: 0.5, won: o.won })),
    ...outcomes(0.3, 50, 15).map((o) => ({ model: 0.3, marketProb: 0.5, won: o.won })),
  ];
  assert.equal(bestWeight(modelRight), 0.8);
  const marketRight = [
    ...outcomes(0.5, 50, 25).map((o) => ({ model: 0.7, marketProb: 0.5, won: o.won })),
    ...outcomes(0.5, 50, 25).map((o) => ({ model: 0.3, marketProb: 0.5, won: o.won })),
  ];
  assert.equal(bestWeight(marketRight), 0);
  assert.ok(Math.abs(shrinkStep(0.3, 0.8, 40, 150, 0.05) - 0.35) < 1e-9);
  assert.ok(Math.abs(shrinkStep(0.3, 0.32, 1000, 150, 0.05) - 0.3174) < 1e-3);
});

function sample(over: Partial<LearnSample>): LearnSample {
  return { group: 'total_games', market: 'total_games', side: 'over', line: 21.5, won: 1, model: 0.55, marketProb: 0.52, blended: 0.54, ...over };
}

function pick(price: number, closing: number | null, status: AiPick['status'], market = 'total_games'): AiPick {
  const leg = { sport: 'tennis', market, marketKind: 'main', price, closingPrice: closing } as AiPickLeg;
  const units = 1;
  const profitUnits = status === 'win' ? price - 1 : status === 'loss' ? -1 : 0;
  return { kind: 'single', sport: 'tennis', units, price, status, profitUnits, legs: [leg] } as AiPick;
}

test('learning: thin samples change nothing', () => {
  const r = learnSport('tennis', P.tennis, [sample({}), sample({ won: 0 })], [pick(1.9, 2, 'loss')], modelGroup);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.params, P.tennis);
});

test('learning: too many three-setters raises tennis day form one step', () => {
  const sets = outcomes(0.45, 60, 20).map((o) => sample({ group: 'total_sets', market: 'total_sets', line: 2.5, model: 0.45, won: o.won }));
  const r = learnSport('tennis', P.tennis, sets, [], modelGroup);
  assert.equal(r.params.dayForm, 0.07);
  assert.ok(r.changes.some((c) => c.startsWith('day form')));
});

test('learning: milestones landing below fair raise the margin power', () => {
  const ms = outcomes(0.5, 60, 24).map((o) => sample({ group: 'milestone', market: 'points', model: 0.55, marketProb: 0.5, won: o.won }));
  const r = learnSport('nbl', P.nbl, ms, [], modelGroup);
  assert.equal(r.params.oneWayMarginPower, 1.09);
});

test('learning: losing to the closing price tightens the edge bar and trims stakes', () => {
  const picks = Array.from({ length: 30 }, (_, i) => pick(1.9, 2, i % 2 ? 'win' : 'loss'));
  const r = learnSport('tennis', P.tennis, [], picks, modelGroup);
  assert.equal(r.params.minEvSingle, 0.035);
  assert.equal(r.params.minEvLeg, 0.025);
  assert.equal(r.params.stakeScale.total_games, 0.9);
  const m = pickMetrics(picks);
  assert.equal(m.clvN, 30);
  assert.ok(Math.abs(m.clv! - -0.05) < 1e-9);
});

test('learning: model weight moves toward the better blend, one small step', () => {
  const rows = [
    ...outcomes(0.7, 50, 35).map((o) => sample({ model: 0.7, marketProb: 0.5, won: o.won })),
    ...outcomes(0.3, 50, 15).map((o) => sample({ model: 0.3, marketProb: 0.5, won: o.won })),
  ];
  const r = learnSport('tennis', P.tennis, rows, [], modelGroup);
  assert.equal(r.params.modelWeight.total_games, 0.45);
  assert.equal(r.metrics.groups.total_games!.bestWeight, 0.8);
});
