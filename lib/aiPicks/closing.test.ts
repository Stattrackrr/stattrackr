import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateKey, legCandidateKey, type AiCandidate } from './candidates/types';
import { closingIndex, closingPrice, priceBetweenLines } from './closing';
import type { AiPickLeg } from './types';

const NOW = Date.parse('2026-10-18T03:00:00Z');
const START = new Date(NOW + 30 * 60_000).toISOString();

/** A tennis total as the scan builds it: keyed under the home player, opponent as `team`. */
function total(line: number, quotes: Array<[string, number]>, marketProb: number, startsAt = START): AiCandidate {
  const c = {
    key: '',
    sport: 'tennis' as const,
    eventKey: 'm1',
    eventLabel: 'H. Dart vs A. Ito',
    startsAt,
    market: 'total_games',
    marketKind: 'main' as const,
    player: null,
    playerId: 'p1',
    team: 'A. Ito',
    side: 'under' as const,
    line,
    bestPrice: Math.max(...quotes.map(([, p]) => p)),
    bestBook: quotes[0]![0],
    quotes: quotes.map(([book, price]) => ({ book, price })),
    modelProb: 0.5,
    marketProb,
    prob: 0.5,
    pushProb: 0,
    ev: 0,
    projection: null,
    support: [],
    supportScore: null,
    singleEligible: true,
    multiEligible: true,
    flags: [],
    context: {},
  };
  return { ...c, key: candidateKey({ ...c, player: 'H. Dart' }) };
}

const leg = (over: Partial<AiPickLeg> = {}): AiPickLeg => ({
  id: 'l1',
  pickId: 'p1',
  legIndex: 0,
  sport: 'tennis',
  eventKey: 'm1',
  eventLabel: 'H. Dart vs A. Ito',
  startsAt: START,
  market: 'total_games',
  marketKind: 'main',
  player: null,
  playerId: 'p1',
  team: 'A. Ito',
  side: 'under',
  line: 22.5,
  price: 1.9,
  bookmaker: 'Sportsbet',
  modelProb: 0.55,
  status: 'pending',
  resultValue: null,
  resultNote: null,
  closingLine: null,
  closingPrice: null,
  gradedAt: null,
  ...over,
});

test('a stored tennis total finds the key the scan gave it', () => {
  assert.equal(legCandidateKey(leg()), total(22.5, [['Sportsbet', 1.9]], 0.5).key);
  const playerLeg = leg({ market: 'player_games', player: 'A. Ito', team: 'H. Dart' });
  assert.equal(legCandidateKey(playerLeg), candidateKey(playerLeg));
});

test('closing price: the leg book at its line, else the best price', () => {
  const index = closingIndex([total(22.5, [['Bet365', 1.95], ['Sportsbet', 1.83]], 0.5)], NOW);
  assert.equal(closingPrice(leg(), index), 1.83);
  assert.equal(closingPrice(leg({ bookmaker: 'TAB' }), index), 1.95);
});

test('closing price: a moved line is read from the lines either side', () => {
  const index = closingIndex(
    [total(21.5, [['Sportsbet', 2.1]], 0.45), total(23.5, [['Sportsbet', 1.7]], 0.55), total(25.5, [['Sportsbet', 1.4]], 0.68)],
    NOW
  );
  // Fair 50% halfway between 45% and 55%, at their average payout of (2.1*0.45 + 1.7*0.55) / 2.
  assert.equal(closingPrice(leg(), index), 1.88);
  assert.equal(priceBetweenLines(22.5, [{ line: 23.5, fair: 0.55, price: 1.7 }]), null);
});

test('closing price: nothing from a match that has started', () => {
  const started = closingIndex([total(22.5, [['Sportsbet', 1.9]], 0.5, new Date(NOW - 60_000).toISOString())], NOW);
  assert.equal(closingPrice(leg(), started), null);
});
