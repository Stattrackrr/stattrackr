import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  arbStakes,
  bonusFlip,
  evFraction,
  middleExpected,
  middleStakes,
  middleWindow,
  saneEv,
  saneTwoWay,
  sharpFairProbs,
} from './math';

describe('tools math', () => {
  it('detects a simple arb and splits stakes', () => {
    const s = arbStakes(2.2, 2.2, 100);
    assert.ok(s);
    assert.ok(s!.roi > 0.09);
    assert.equal(s!.stakeA + s!.stakeB, 100);
  });

  it('rejects non-arb prices', () => {
    assert.equal(arbStakes(1.9, 1.9, 100), null);
  });

  it('bonus flip locks cash correctly', () => {
    // B=100, o1=2.0, o2=2.0 → H=50, cash=50
    const f = bonusFlip(100, 2, 2);
    assert.ok(f);
    assert.equal(f!.hedge, 50);
    assert.equal(f!.cashOut, 50);
    assert.equal(f!.retention, 0.5);
  });

  it('EV is fair * odds - 1', () => {
    assert.ok(Math.abs((evFraction(2.1, 0.5) ?? 0) - 0.05) < 1e-9);
  });

  it('rejects flipped-side EV (fair 1.02 with soft 19)', () => {
    const p = 1 / 1.02;
    const edge = evFraction(19, p)!;
    assert.ok(edge > 10);
    assert.equal(saneEv(19, p, edge), false);
    assert.equal(saneEv(2.1, 0.5, 0.05), true);
  });

  it('middle window needs over line below under line', () => {
    assert.deepEqual(middleWindow(224.5, 226.5), { low: 224.5, high: 226.5 });
    assert.equal(middleWindow(226.5, 224.5), null);
  });

  it('middle stakes show risk vs both-win collect on $100', () => {
    const s = middleStakes(1.9, 1.9, 100);
    assert.ok(s);
    assert.equal(s!.stakeA, 50);
    assert.equal(s!.stakeB, 50);
    assert.equal(s!.riskLoss, 5);
    assert.equal(s!.middleCollect, 90);
  });

  it('wider middle outranks tight low-risk when expected is used', () => {
    const tight = middleExpected(1, 2, 95)!;
    const wide = middleExpected(3, 12, 75)!;
    assert.ok(wide.expected > tight.expected);
    assert.ok(wide.hitProb > tight.hitProb);
  });

  it('sharp fair averages de-vigged pairs', () => {
    const fair = sharpFairProbs([
      [1.9, 1.9],
      [1.91, 1.91],
    ]);
    assert.ok(fair);
    assert.ok(Math.abs(fair![0] - 0.5) < 0.02);
  });

  it('saneTwoWay guards mismatched books', () => {
    assert.equal(saneTwoWay(5, 5), false); // inv = 0.4
    assert.equal(saneTwoWay(2.05, 1.95), true);
  });
});
