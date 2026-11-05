import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testCandidate } from './candidates';
import type { CandidateSpec, ModelLine } from './design';
import { toModelLine } from './fitLines';
import { logit } from './residual';

function makeRng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return { u, n: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}

const STATS = ['points', 'rebounds', 'assists', 'threeMade', 'pra'];

/** Lines whose outcome depends on the market and, if `effect` is set, on the candidate the market missed. */
function lines(n: number, effect: number, seed: number, missingEvery = 0): ModelLine[] {
  const r = makeRng(seed);
  return Array.from({ length: n }, (_, i) => {
    const fair = 0.3 + 0.4 * r.u();
    const x = 2 + r.n();
    const p = 1 / (1 + Math.exp(-(logit(fair) + effect * (x - 2))));
    const day = Math.floor(i / 150);
    return {
      y: (r.u() < p ? 1 : 0) as 0 | 1,
      fairOver: fair,
      stat: STATS[i % STATS.length]!,
      features: { minutes_new_info_z: 0, usage_shift_z: 0, opp_starters_out: missingEvery && i % missingEvery === 0 ? null : x, combo_gap_z: x },
      game: `g${Math.floor(i / 30)}`,
      subject: `p${i}`,
      date: `2026-${String(11 + Math.floor(day / 28)).padStart(2, '0')}-${String(1 + (day % 28)).padStart(2, '0')}`,
      nBooks: 8,
      bookDispersion: 0.02,
    };
  });
}

const OPP: CandidateSpec = { name: 'opp_starters_out', key: 'opp_starters_out', lines: 'base' };
const COMBO: CandidateSpec = { name: 'combo_gap', key: 'combo_gap_z', lines: 'combo' };

test('a stat the market misses passes, with the right direction', () => {
  const r = testCandidate(lines(12000, 0.4, 1), OPP);
  if (r.status !== 'pass') return assert.fail(r.status);
  assert.ok(r.coefPerSd > 0.25, String(r.coefPerSd));
  assert.equal(r.lines, 12000 * 0.8);
});

test('a stat the market already prices fails', () => {
  const r = testCandidate(lines(12000, 0, 2), OPP);
  assert.equal(r.status, 'fail');
});

test('lines where the stat was not logged are left out, not counted as 0', () => {
  const r = testCandidate(lines(5000, 0.4, 3, 2), OPP);
  assert.notEqual(r.status, 'insufficient');
  assert.equal(r.lines, 5000 * 0.8 / 2);
});

test('combo-only inputs are tested on combo lines; too little data is reported, not judged', () => {
  const r = testCandidate(lines(12000, 0.4, 4), COMBO);
  assert.equal(r.status, 'pass');
  assert.equal(r.lines, 12000 / 5);
  assert.equal(testCandidate(lines(600, 0.4, 5), COMBO).status, 'insufficient');
});

test('logged rows carry candidates as numbers: true/false as 1/0, DvP rank and the referee-by-player input derived', () => {
  const row = {
    game_id: 'g', player_id: 'p', stat: 'pra', tip_at: '2026-11-02T00:30:00Z', fair_over_all: 0.5, n_books: 8, book_dispersion: 0.01, result_over: 'loss',
    features: { altitude_visitor: true, bpDvp: { rank: 27 }, ref_fta_z: 0.5, fta_share: 0.3, combo_gap_z: 0.2, opp_starters_out: 'x' },
  };
  assert.equal(toModelLine(row), null);
  const l = toModelLine(row, { combos: true })!;
  assert.equal(l.features.altitude_visitor, 1);
  assert.equal(l.features.bp_dvp_rank, 27);
  assert.ok(Math.abs(l.features.ref_fta_player! - 0.15) < 1e-12);
  assert.equal(l.features.combo_gap_z, 0.2);
  assert.equal(l.features.opp_starters_out, null);
});
