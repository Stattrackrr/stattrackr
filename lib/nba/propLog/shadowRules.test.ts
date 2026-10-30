import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LoggedQuote } from './lines';
import { confirmationGaps, decide, fairExcluding, MODEL_V0, priceConfirmed, scoreOver } from './shadowRules';

const q = (book: string, over: number, under: number, line = 8.5, sourceTs = '2026-10-31T00:00:00.000Z'): LoggedQuote => ({ book, line, over, under, sourceTs, coherent: true });
const NOW = Date.parse('2026-10-31T00:05:00.000Z');

test('v0 scores the market as it is', () => {
  assert.ok(Math.abs(scoreOver(MODEL_V0, { fairOver: 0.55, stat: 'points', features: { minutes_new_info_z: 2 }, nBooks: 8, bookDispersion: 0.02 }) - 0.55) < 1e-9);
});

test('features move the probability only when the model gives them weight', () => {
  const fitted = { ...MODEL_V0, theta: { a: 1, minutes_new_info: 0.3, usage_shift: 0.2, b_points: -0.1 } };
  const line = { fairOver: 0.5, stat: 'points', features: { minutes_new_info_z: 1, usage_shift_z: 0 }, nBooks: 8, bookDispersion: 0 };
  const p = scoreOver(fitted, line);
  assert.ok(Math.abs(p - 1 / (1 + Math.exp(-(0.3 - 0.1)))) < 1e-9);
  assert.ok(Math.abs(scoreOver(fitted, { ...line, stat: 'pra' }) - 1 / (1 + Math.exp(-0.3))) < 1e-9, 'combos carry no per-stat bias');
});

test('fair price leaves the bet book out', () => {
  const quotes = [q('sportsbet', 2.2, 1.7), q('draftkings', 1.9, 1.9), q('fanduel', 1.92, 1.88)];
  const all = fairExcluding(quotes, 8.5, null)!;
  const without = fairExcluding(quotes, 8.5, 'sportsbet')!;
  assert.ok(without > all, "Sportsbet's generous over drags the all-books fair down");
  assert.equal(fairExcluding(quotes, 9.5, null), null, 'nobody priced 9.5');
});

test('phantom-price rule: same price seen earlier, a fresh scrape, a coherent pair', () => {
  const quote = q('sportsbet', 2.2, 1.7, 8.5, '2026-10-31T00:02:00.000Z');
  const seen = { sportsbet: { over: 2.2, under: 1.7, seenAt: '2026-10-31T00:00:00.000Z' } };
  const gaps = { minGapMs: 2 * 60_000, maxSourceAgeMs: 15 * 60_000 };
  assert.equal(priceConfirmed({ quote, side: 'over', previous: seen, nowMs: NOW, ...gaps }), true);
  assert.equal(priceConfirmed({ quote, side: 'over', previous: undefined, nowMs: NOW, ...gaps }), false, 'first sighting');
  assert.equal(priceConfirmed({ quote, side: 'over', previous: { sportsbet: { ...seen.sportsbet, over: 2.1 } }, nowMs: NOW, ...gaps }), false, 'price changed');
  assert.equal(priceConfirmed({ quote: { ...quote, sourceTs: '2026-10-30T23:00:00.000Z' }, side: 'over', previous: seen, nowMs: NOW, ...gaps }), false, 'stale scrape');
  assert.equal(priceConfirmed({ quote: { ...quote, coherent: false }, side: 'over', previous: seen, nowMs: NOW, ...gaps }), false, 'mislabelled pair');
  assert.equal(priceConfirmed({ quote, side: 'over', previous: seen, nowMs: Date.parse('2026-10-31T00:01:00.000Z'), ...gaps }), false, 'polls too close together');
  assert.deepEqual(confirmationGaps(60 * 60_000), { minGapMs: 120_000, maxSourceAgeMs: 900_000 });
});

test('decide: v0 bets the side whose best price beats the leave-one-out fair by the minimum', () => {
  const quotes = [q('sportsbet', 2.2, 1.7), q('draftkings', 1.9, 1.9), q('fanduel', 1.92, 1.88)];
  const line = { stat: 'points', features: {}, nBooks: 3, bookDispersion: 0.01, mainLine: 8.5, quotes };
  const bet = decide({ coefs: MODEL_V0, line, best: { over: { price: 2.2, book: 'sportsbet' }, under: { price: 1.7, book: 'sportsbet' } }, confirmed: () => true });
  assert.equal(bet?.side, 'over');
  assert.ok(bet!.ev >= 0.03);
  assert.equal(decide({ coefs: MODEL_V0, line, best: { over: { price: 1.9, book: 'draftkings' }, under: null }, confirmed: () => true }), null, 'no edge, no bet');
});
