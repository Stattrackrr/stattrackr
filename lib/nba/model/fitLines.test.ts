import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreOver } from '@/lib/nba/propLog/shadowRules';
import { lineVector, modelSpec, type BaseStat, type ModelLine } from './design';
import { fitLines, toModelLine } from './fitLines';
import { logit, predict } from './residual';

function makeRng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return { u, n: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}

const STATS: BaseStat[] = ['points', 'rebounds', 'assists', 'threeMade'];

/**
 * Decision-time lines where the minutes news is not yet priced, and the same lines at close where
 * the market has caught up (its fair already is the truth).
 */
function latency(n: number, seed: number): { t2h: ModelLine[]; close: ModelLine[] } {
  const r = makeRng(seed);
  const t2h: ModelLine[] = [];
  const close: ModelLine[] = [];
  for (let i = 0; i < n; i += 1) {
    const fair = 0.3 + 0.4 * r.u();
    const minutes = r.n();
    const p = 1 / (1 + Math.exp(-(logit(fair) + 0.35 * minutes)));
    const y = r.u() < p ? 1 : 0;
    const day = Math.floor(i / 150);
    const base = { y: y as 0 | 1, stat: STATS[i % 4]!, game: `g${Math.floor(i / 30)}`, subject: `p${i}`, date: `2026-${String(11 + Math.floor(day / 28)).padStart(2, '0')}-${String(1 + (day % 28)).padStart(2, '0')}`, nBooks: 8, bookDispersion: 0.02 };
    t2h.push({ ...base, fairOver: fair, features: { minutes_new_info_z: minutes, usage_shift_z: 0 } });
    close.push({ ...base, fairOver: p, features: { minutes_new_info_z: minutes, usage_shift_z: 0 } });
  }
  return { t2h, close };
}

test('too little data is reported, not fitted', () => {
  const { t2h } = latency(200, 1);
  assert.equal(fitLines(t2h).status, 'insufficient');
});

test('latency signature: lift at decision time, none at close; coefficients score the same in the shadow policy', () => {
  const { t2h, close } = latency(9000, 2);
  const fit = fitLines(t2h, close, 'v1-test');
  assert.equal(fit.status, 'fitted');
  if (fit.status !== 'fitted') return;
  assert.ok(fit.liftVsMarket.lo > 0, `decision lift ${fit.liftVsMarket.mean}`);
  assert.ok(fit.liftAtClose && fit.liftAtClose.hi < 0, `close lift ${fit.liftAtClose?.mean}`);
  assert.ok(Math.abs(fit.coefs.theta.minutes_new_info! - 0.35) < 0.08);
  const spec = modelSpec(t2h);
  const theta = spec.params.map((p) => fit.coefs.theta[p.name]!);
  for (const l of t2h.slice(0, 50)) {
    const p = scoreOver(fit.coefs, { fairOver: l.fairOver, stat: l.stat, features: l.features, nBooks: l.nBooks, bookDispersion: l.bookDispersion });
    assert.ok(Math.abs(p - predict(theta, lineVector(spec, l))) < 1e-4);
  }
});

test('logged rows map to model lines: only graded base stats with a fair', () => {
  const row = { game_id: 'g', player_id: 'p', stat: 'points', tip_at: '2026-11-02T00:30:00Z', fair_over_all: 0.52, n_books: 9, book_dispersion: 0.01, features: { minutes_new_info_z: 1.2 }, result_over: 'win' };
  const l = toModelLine(row)!;
  assert.equal(l.y, 1);
  assert.equal(l.date, '2026-11-01');
  assert.equal(l.features.minutes_new_info_z, 1.2);
  assert.equal(l.features.usage_shift_z, null);
  assert.equal(toModelLine({ ...row, result_over: 'void' }), null);
  assert.equal(toModelLine({ ...row, stat: 'pra' }), null);
  assert.equal(toModelLine({ ...row, fair_over_all: null }), null);
});
