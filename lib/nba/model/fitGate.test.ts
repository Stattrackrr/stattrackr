import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL_V0 } from '@/lib/nba/propLog/shadowRules';
import { fitGate } from './fitGate';
import type { LoggedFit } from './fitLines';

const interval = (mean: number, lo: number, hi: number, games = 40) => ({ mean, lo, hi, games });

test('insufficient fit: no promote, explains the 10-date gate', () => {
  const g = fitGate({ status: 'insufficient', lines: 200, dates: 8, needLines: 300, needDates: 10 });
  assert.equal(g.status, 'insufficient');
  assert.equal(g.promoteShadow, false);
  assert.match(g.readings[0]!, /10 ET dates/);
});

test('fitted with clear decision lift: promoteShadow true; close wipe is latency', () => {
  const fit: LoggedFit = {
    status: 'fitted',
    lines: 4000,
    games: 80,
    dates: 12,
    scale: 0.1,
    coefs: { ...MODEL_V0, version: 'v1-test' },
    liftVsMarket: interval(0.01, 0.002, 0.02),
    liftVsFittedMarket: interval(0.005, 0.001, 0.01),
    liftAtClose: interval(-0.001, -0.004, 0.001),
  };
  const g = fitGate(fit);
  assert.equal(g.status, 'fitted');
  if (g.status !== 'fitted') return;
  assert.equal(g.promoteShadow, true);
  assert.equal(g.beatsMarket, true);
  assert.equal(g.latencySignature, true);
  assert.match(g.readings.join(' '), /Latency signature/);
});

test('fitted without market lift: keep v0, no promote', () => {
  const fit: LoggedFit = {
    status: 'fitted',
    lines: 4000,
    games: 80,
    dates: 11,
    scale: 0.1,
    coefs: { ...MODEL_V0, version: 'v1-test' },
    liftVsMarket: interval(-0.001, -0.003, 0.0001),
    liftVsFittedMarket: interval(-0.0005, -0.002, 0.0002),
    liftAtClose: interval(-0.001, -0.002, 0.0004),
  };
  const g = fitGate(fit);
  assert.equal(g.promoteShadow, false);
  assert.match(g.readings.join(' '), /keep shadow on v0-market/);
});
