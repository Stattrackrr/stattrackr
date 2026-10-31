import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expit, logit, makeModel, withTau } from '@/lib/tennis/model/pricing';
import { chooseShadowBet, evaluateCandidates, invertArm, matchRules, pairQuotes, sharpFairs } from './fair';
import type { QuoteRow } from './quotes';

const rules = matchRules(3, false);
/** A fair two-way pair at probability p, with a small margin split evenly. */
const priced = (p: number, margin = 0.03): [number, number] => [1 / (p + margin / 2), 1 / (1 - p + margin / 2)];

function book(name: string, fair: Record<string, number>, margin: number): QuoteRow[] {
  const rows: QuoteRow[] = [];
  const add = (market: QuoteRow['market'], line: number | null, a: string, b: string, p: number) => {
    const [pa, pb] = priced(p, margin);
    rows.push({ book: name, market, line, selection: a, price: pa }, { book: name, market, line, selection: b, price: pb });
  };
  add('match_winner', null, 'home', 'away', fair.win!);
  add('total_games', 21.5, 'over', 'under', fair['tot:21.5']!);
  add('game_handicap', -2.5, 'home', 'away', fair['hcp:-2.5']!);
  return rows;
}

test('sharp prices invert back to the serve strengths that made them', () => {
  const keys = ['win', 'tot:21.5', 'hcp:-2.5'];
  const truth = withTau(makeModel(keys), 0.2)(0.66, 0.6);
  const pairs = pairQuotes(book('pinnacle', truth, 0.025));
  const arm = invertArm(sharpFairs(pairs), 3, rules)!;
  assert.ok(Math.abs(expit(arm.theta[0]) - 0.66) < 0.01, String(expit(arm.theta[0])));
  assert.ok(Math.abs(expit(arm.theta[1]) - 0.6) < 0.01, String(expit(arm.theta[1])));
  assert.ok(arm.coherence < 1, 'consistent prices fit well');
});

test('candidates: same sharp line is sharp_direct, other lines are converted, a soft price shows up as edge', () => {
  const keys = ['win', 'tot:21.5', 'hcp:-2.5', 'tot:23.5'];
  const truth = withTau(makeModel(keys), 0.2)(0.66, 0.6);
  const sharp = book('pinnacle', truth, 0.025);
  // An Australian book: soft on the winner (home too long), and a total at 23.5, a line Pinnacle doesn't price.
  const au: QuoteRow[] = [
    { book: 'sportsbet', market: 'match_winner', line: null, selection: 'home', price: 1 / (truth.win! - 0.05) },
    { book: 'sportsbet', market: 'match_winner', line: null, selection: 'away', price: 1 / (1 - truth.win! + 0.08) },
    ...(() => {
      const [o, u] = priced(truth['tot:23.5']!, 0.05);
      return [
        { book: 'sportsbet', market: 'total_games' as const, line: 23.5, selection: 'over', price: o },
        { book: 'sportsbet', market: 'total_games' as const, line: 23.5, selection: 'under', price: u },
      ];
    })(),
  ];
  const pairs = pairQuotes([...sharp, ...au]);
  const fairs = sharpFairs(pairs);
  const arm = invertArm(fairs, 3, rules);
  const cands = evaluateCandidates(pairs, fairs, arm, 3, rules);
  const win = cands.find((c) => c.market === 'match_winner' && c.selection === 'home')!;
  assert.equal(win.fairSource, 'sharp_direct');
  assert.ok(win.edge > 0 && win.ev > 0.03, `soft winner price: edge ${win.edge}, EV ${win.ev}`);
  const over = cands.find((c) => c.market === 'total_games' && c.selection === 'over')!;
  assert.equal(over.fairSource, 'sharp_converted');
  assert.equal(over.lineDistance, 2);
  assert.ok(Math.abs(over.fair - truth['tot:23.5']!) < 0.01, `converted fair ${over.fair} vs ${truth['tot:23.5']}`);
  assert.ok(Math.abs(logit(over.fair) - logit(over.q)) < 0.05, 'a correctly priced line has about no edge');
  assert.equal(chooseShadowBet(cands, () => true)?.selection, 'home');
  assert.equal(chooseShadowBet(cands, () => false), null, 'unconfirmed prices never bet');
});
