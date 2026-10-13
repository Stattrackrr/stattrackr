import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coherentPair,
  countPmf,
  countSideProbs,
  evPerUnit,
  fairOneWay,
  fairTwoWay,
  impliedCountMean,
  normalSideProbs,
  winShare,
} from './math';
import { anchorSimulation } from './tennisAnchor';
import { effectiveModelWeight } from '../params';
import { bestQuote, eligibility } from '../candidates/types';
import { tennisSelections } from '../candidates/tennis';
import { probOverHist } from '@/lib/tennisAi/simulate';
import type { TennisBookRow } from '@/lib/tennis/oddsTypes';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('count distribution sums to one with the right mean', () => {
  for (const [mean, variance] of [[4, 4], [12, 30]] as const) {
    const pmf = countPmf(mean, variance, 80);
    near(pmf.reduce((s, p) => s + p, 0), 1, 1e-6);
    near(pmf.reduce((s, p, k) => s + p * k, 0), mean, 1e-3);
  }
});

test('whole count lines can push, half lines cannot', () => {
  const half = countSideProbs(10, 20, 9.5);
  assert.equal(half.push, 0);
  near(half.over + half.under, 1, 1e-9);
  const whole = countSideProbs(10, 20, 10);
  assert.ok(whole.push > 0.05);
  near(whole.over + whole.under + whole.push, 1, 1e-9);
  assert.ok(normalSideProbs(160, 16, 160).push > 0);
});

test('implied mean reproduces the market price at its line', () => {
  const mean = impliedCountMean(0.6, 15.5, 2);
  near(winShare(countSideProbs(mean, mean * 2, 15.5), 'over'), 0.6, 1e-3);
});

test('two-way de-vig sums to one; incoherent pairs are rejected', () => {
  const fair = fairTwoWay(1.9, 1.9)!;
  near(fair[0], 0.5, 1e-9);
  near(fair[0] + fair[1], 1, 1e-9);
  assert.ok(fairTwoWay(1.5, 2.6)![0] > 0.6);
  assert.equal(coherentPair(1.87, 1.87), true);
  assert.equal(coherentPair(1.12, 2.05), false);
  assert.equal(coherentPair(2.5, 2.5), false);
  assert.equal(coherentPair(1.9, null), true);
});

test('one-way fair strips more from long shots', () => {
  const short = fairOneWay(1.5, 1.08)!;
  const long = fairOneWay(10, 1.08)!;
  assert.ok(short < 1 / 1.5);
  assert.ok(long / 0.1 < short / (1 / 1.5));
  assert.equal(fairOneWay(1, 1.08), null);
});

test('EV per unit counts a push as stake back', () => {
  near(evPerUnit(0.5, 2.1), 0.05, 1e-9);
  near(evPerUnit(0.5, 2, 0.1), 0.1, 1e-9);
  near(evPerUnit(0.4, 2), -0.2, 1e-9);
});

test('model weight shrinks with thin samples', () => {
  near(effectiveModelWeight(0.4, 8, 8), 0.2, 1e-9);
  assert.equal(effectiveModelWeight(0.4, 0, 8), 0);
  assert.ok(effectiveModelWeight(0.4, 80, 8) > 0.36);
});

test('best price skips outliers and duplicate feeds count once', () => {
  const picked = bestQuote([
    { book: 'A', price: 2.0 },
    { book: 'B', price: 1.95 },
    { book: 'C', price: 1.9 },
    { book: 'D', price: 3.1 },
  ])!;
  assert.equal(picked.best.book, 'A');
  assert.match(picked.flags[0]!, /outlier price 3.1 at D/);

  const clones = bestQuote([
    { book: 'Ladbrokes', price: 1.88 },
    { book: 'Bet365', price: 1.87 },
    { book: 'PlayUp', price: 1.62 },
    { book: 'Betr', price: 1.62 },
    { book: 'Picklebet', price: 1.62 },
  ])!;
  assert.equal(clones.best.book, 'Ladbrokes');
  assert.equal(clones.flags.length, 0);

  assert.match(bestQuote([{ book: 'A', price: 13 }, { book: 'B', price: 3.35 }])!.flags[0]!, /far apart/);
  assert.match(bestQuote([{ book: 'A', price: 2 }])!.flags[0]!, /Only one bookmaker/);
});

test('single and multi eligibility price bands', () => {
  const caps = { maxPriceSingle: 3.5, maxPriceLeg: 2.6 };
  assert.deepEqual(eligibility(1.9, 'main', false, caps), { singleEligible: true, multiEligible: true });
  assert.deepEqual(eligibility(1.6, 'main', false, caps), { singleEligible: false, multiEligible: true });
  assert.deepEqual(eligibility(3.0, 'milestone', false, caps), { singleEligible: true, multiEligible: false });
  assert.deepEqual(eligibility(5, 'milestone', false, caps), { singleEligible: false, multiEligible: false });
  assert.deepEqual(eligibility(1.9, 'alternate', false, caps), { singleEligible: false, multiEligible: true });
  assert.deepEqual(eligibility(1.1, 'alternate', false, caps), { singleEligible: false, multiEligible: false });
  assert.deepEqual(eligibility(1.9, 'main', true, caps), { singleEligible: false, multiEligible: false });
});

test('anchored simulation hits the target win rate; day form shortens matches', () => {
  const base = { pA: 0.64, pB: 0.62, bestOf: 3 as const };
  const tight = anchorSimulation({ ...base, uncertainty: 0 }, 0.7, { sims: 6000, seed: 7 });
  near(tight.sim.matchWinA, 0.7, 0.03);
  const loose = anchorSimulation({ ...base, uncertainty: 0.07 }, 0.7, { sims: 6000, seed: 7 });
  near(loose.sim.matchWinA, 0.7, 0.03);
  assert.ok(probOverHist(loose.sim.setsPlayed, 2.5).over < probOverHist(tight.sim.setsPlayed, 2.5).over - 0.05);
});

const ou = (line: string, over: string, under: string) => ({ line, over, under });
const emptyLine = ou('N/A', '', '');

function book(name: string, extra: Partial<TennisBookRow>): TennisBookRow {
  return {
    name,
    H2H: { home: '', away: '' },
    Spread: emptyLine,
    Total: emptyLine,
    GamesWon: emptyLine,
    GamesLost: emptyLine,
    TotalSets: emptyLine,
    SpreadLines: [],
    TotalLines: [],
    GamesWonLines: [],
    GamesLostLines: [],
    TotalSetsLines: [],
    ...extra,
  };
}

test('tennis selections orient the handicap and drop mislabeled pairs', () => {
  const { selections, pairs } = tennisSelections([
    book('A', { H2H: { home: '-150', away: '+120' }, SpreadLines: [ou('-3.5', '-110', '-110')], SetsLostLines: [ou('0.5', '-800', '+450')] }),
    book('B', { H2H: { home: '-145', away: '+125' }, SetsLostLines: [ou('0.5', '-750', '-105')] }),
  ]);
  const hcp = selections.filter((s) => s.market === 'game_handicap');
  assert.deepEqual(hcp.map((s) => [s.who, s.line]).sort(), [['away', 3.5], ['home', -3.5]]);
  const no = selections.find((s) => s.market === 'win_a_set' && s.who === 'away' && s.side === 'no')!;
  assert.deepEqual(no.quotes.map((q) => q.book), ['A']);
  assert.equal(pairs.get('win_a_set|away')!.size, 1);
  assert.equal(pairs.get('match_winner')!.size, 2);
});
