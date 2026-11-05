import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport, designEffect, sampleSize, type ReportBet } from './report';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Synthetic would-be bets: `perGame` bets on each of `games` games over `days` days. */
function synth(opts: { games: number; perGame: number; days: number; a: number; b: number; sd: number; hit: number; seed?: number }): ReportBet[] {
  const r = rng(opts.seed ?? 1);
  const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const out: ReportBet[] = [];
  const start = Date.parse('2026-11-01T00:00:00Z');
  for (let g = 0; g < opts.games; g += 1) {
    const at = new Date(start + Math.floor((g / opts.games) * opts.days) * 86_400_000).toISOString();
    for (let i = 0; i < opts.perGame; i += 1) {
      const b = opts.b + opts.sd * normal();
      const won = r() < opts.hit;
      out.push({
        id: `${g}-${i}`,
        game: `g${g}`,
        at,
        policy: 'main',
        side: i % 2 ? 'under' : 'over',
        stat: 'points',
        line: 20.5,
        price: 1.95,
        confirmed: true,
        modelProb: opts.hit,
        fairOver: 0.5,
        clv: { total: opts.a + b, a: opts.a, b, sameLine: true, k: 20, totalK08: opts.a + b, totalK125: opts.a + b, totalAllBooks: opts.a + b, closeLine: 20.5, closeFair: 0.5 },
        result: won ? 'win' : 'loss',
        check: { p5: 1.95, p10: 1.9, p20: 1.9, vanished: i % 5 === 0 },
      });
    }
  }
  return out;
}

test('sample size matches the spec example (SD 8.5%, design effect 1.5 is about 480)', () => {
  const n = sampleSize(0.085, 1.5);
  assert.ok(n > 470 && n < 500, String(n));
});

test('design effect is 1 for independent bets and the cluster size for identical bets in a game', () => {
  const r = rng(3);
  const independent = Array.from({ length: 4000 }, (_, i) => ({ game: `g${i % 1000}`, v: r() }));
  assert.ok(Math.abs(designEffect(independent) - 1) < 0.15);
  const clustered = Array.from({ length: 4000 }, (_, i) => ({ game: `g${i % 1000}`, v: (i % 1000) / 1000 }));
  assert.ok(Math.abs(designEffect(clustered) - 4) < 0.01);
});

test('a real (b) edge with enough bets reads as ready to reopen, not futile', () => {
  const bets = synth({ games: 600, perGame: 2, days: 60, a: 0, b: 0.03, sd: 0.08, hit: 0.53 });
  const rep = buildReport({ bets, nowMs: Date.parse('2027-01-15T00:00:00Z'), gamesLeft: 800, policyVersion: 't', modelVersion: 't' });
  assert.equal(rep.measurement.status, 'fixed');
  assert.ok(rep.clv.b.lo99 > 0);
  assert.equal(rep.verdict.futility.stop, false);
  assert.equal(rep.verdict.reopen.reached, true);
  assert.equal(rep.verdict.reopen.calibrationHolds, true);
  assert.equal(rep.verdict.reopen.ready, true);
  assert.ok(Math.abs(rep.reported.vanishedShare - 0.5) < 0.01);
});

test('no edge is stopped for futility', () => {
  const bets = synth({ games: 300, perGame: 2, days: 30, a: -0.02, b: 0, sd: 0.08, hit: 0.5 });
  const rep = buildReport({ bets, nowMs: Date.parse('2026-12-15T00:00:00Z'), gamesLeft: 800, policyVersion: 't', modelVersion: 't' });
  assert.equal(rep.verdict.futility.stop, true);
  assert.equal(rep.verdict.reopen.ready, false);
});

test('CLV that comes only from the price (a) is read as line shopping', () => {
  const bets = synth({ games: 300, perGame: 2, days: 30, a: 0.04, b: 0, sd: 0.05, hit: 0.5 });
  const rep = buildReport({ bets, nowMs: Date.parse('2026-12-15T00:00:00Z'), gamesLeft: 800, policyVersion: 't', modelVersion: 't' });
  assert.ok(rep.clv.total.lo > 0);
  assert.ok(rep.verdict.readings.some((r) => r.includes('line shopping')));
  assert.equal(rep.verdict.reopen.ready, false);
});

test('miscalibrated overs block reopening even with positive CLV', () => {
  const bets = synth({ games: 600, perGame: 2, days: 60, a: 0, b: 0.03, sd: 0.08, hit: 0.53 }).map((b) => (b.side === 'over' ? { ...b, result: (Number(b.id.split('-')[0]) % 10 < 3 ? 'win' : 'loss') as 'win' | 'loss' } : b));
  const rep = buildReport({ bets, nowMs: Date.parse('2027-01-15T00:00:00Z'), gamesLeft: 800, policyVersion: 't', modelVersion: 't' });
  assert.equal(rep.verdict.reopen.calibrationHolds, false);
  assert.equal(rep.verdict.reopen.ready, false);
});

test('a slow pace against games left reads as off pace for the cap', () => {
  const bets = synth({ games: 40, perGame: 1, days: 20, a: 0, b: 0.01, sd: 0.1, hit: 0.5 });
  const rep = buildReport({ bets, nowMs: Date.parse('2026-12-15T00:00:00Z'), gamesLeft: 100, policyVersion: 't', modelVersion: 't' });
  assert.ok(rep.verdict.cap.gamesNeeded > 140);
  assert.equal(rep.verdict.cap.onPace, false);
});

test('unconfirmed would-be bets are kept out of the primary metric', () => {
  const good = synth({ games: 200, perGame: 1, days: 20, a: 0, b: 0.02, sd: 0.05, hit: 0.5 });
  const phantom = synth({ games: 200, perGame: 1, days: 20, a: 0.2, b: 0, sd: 0.01, hit: 0.5, seed: 9 }).map((b) => ({ ...b, id: `p${b.id}`, confirmed: false }));
  const rep = buildReport({ bets: [...good, ...phantom], nowMs: Date.parse('2026-12-15T00:00:00Z'), gamesLeft: 800, policyVersion: 't', modelVersion: 't' });
  assert.ok(Math.abs(rep.clv.total.mean - 0.02) < 0.01);
  assert.ok(rep.reported.unconfirmed.mean > 0.15);
  assert.equal(rep.counts.bets, 400);
  assert.equal(rep.counts.confirmed, 200);
});
