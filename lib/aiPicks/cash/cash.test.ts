import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateKey, type AiCandidate, type CandidateQuote } from '@/lib/aiPicks/candidates/types';
import { AI_CASH_TRACK } from '@/lib/aiPicks/params';
import type { AiPick } from '@/lib/aiPicks/types';
import {
  cashCandidate,
  cashDayKey,
  cashEligible,
  cashMarketEv,
  cashPostedState,
  chooseCash,
  CASH_LIMITS,
} from './decide';

const NOW = Date.parse('2026-11-16T22:00:00Z');
const H = 3_600_000;

function cand(over: Partial<AiCandidate> = {}): AiCandidate {
  const c: AiCandidate = {
    key: '',
    sport: 'nba',
    eventKey: 'g1',
    eventLabel: 'Chicago Bulls @ Cleveland Cavaliers',
    startsAt: new Date(NOW + 2 * H).toISOString(),
    market: 'points',
    marketKind: 'main',
    player: 'Jarrett Allen',
    playerId: '1',
    team: 'Cleveland Cavaliers',
    side: 'over',
    line: 13.5,
    bestPrice: 2.05,
    bestBook: 'Sportsbet',
    quotes: [
      { book: 'Sportsbet', price: 2.05 },
      { book: 'TAB', price: 1.9 },
    ],
    modelProb: 0.61,
    marketProb: 0.52,
    prob: 0.58,
    pushProb: 0,
    ev: 0.0846,
    projection: 16,
    support: [],
    supportScore: null,
    singleEligible: true,
    multiEligible: true,
    flags: [],
    context: { marketSource: 'main' },
    ...over,
  };
  return { ...c, key: over.key ?? candidateKey(c) };
}

test('cash records market chance and requires ≥3% market EV', () => {
  const c = cashCandidate(cand())!;
  assert.equal(c.prob, 0.52);
  assert.equal(c.ev, cashMarketEv(c));
  assert.ok((c.ev ?? 0) >= CASH_LIMITS.minMarketEv);
  assert.equal(cashCandidate(cand({ marketProb: null })), null);
  assert.equal(cashEligible(cashCandidate(cand({ bestPrice: 1.87, marketProb: 0.52, quotes: [{ book: 'Sportsbet', price: 1.87 }, { book: 'TAB', price: 1.8 }] }))!, NOW).ok, false, 'below 3% EV');
  assert.equal(cashEligible(c, NOW).ok, true);
});

test('Bet365 never becomes the posted cash book; quotes still keep it', () => {
  const raw = cand({
    bestBook: 'bet365_au',
    bestPrice: 2.4,
    quotes: [
      { book: 'bet365_au', price: 2.4 },
      { book: 'Sportsbet', price: 2.05 },
      { book: 'TAB', price: 1.95 },
      { book: 'PointsBet', price: 2.0 },
    ],
  });
  const c = cashCandidate(raw)!;
  assert.notEqual(c.bestBook.toLowerCase().replace(/[^a-z0-9]/g, ''), 'bet365');
  assert.notEqual(c.bestBook.toLowerCase().replace(/[^a-z0-9]/g, ''), 'bet365au');
  assert.equal(c.bestBook, 'Sportsbet');
  assert.equal(c.bestPrice, 2.05);
  assert.ok(c.quotes.some((q) => q.book === 'bet365_au'), 'Bet365 stays on the quote list');
  assert.equal(cashCandidate(cand({ quotes: [{ book: 'bet365_au', price: 2.1 }] })), null, 'Bet365-only line is not posted');
});

test('top8 chooses highest EV and respects day / player / game caps', () => {
  const day = cashDayKey(NOW);
  const state = cashPostedState([], NOW);
  assert.equal(state.dayKey, day);
  assert.equal(state.dayCount, 0);

  const q = (price: number): CandidateQuote[] => [
    { book: 'Sportsbet', price },
    { book: 'TAB', price: price - 0.05 },
    { book: 'bet365_au', price: price + 0.2 },
  ];
  const board = [
    cand({ player: 'A', eventKey: 'g1', quotes: q(2.2), marketProb: 0.5, key: 'a' }), // EV 10% at SB
    cand({ player: 'B', eventKey: 'g1', quotes: q(2.1), marketProb: 0.5, key: 'b' }), // EV 5%
    cand({ player: 'C', eventKey: 'g2', quotes: q(2.15), marketProb: 0.5, key: 'c' }),
    cand({ player: 'D', eventKey: 'g2', quotes: q(2.0), marketProb: 0.5, key: 'd' }),
    cand({ player: 'E', eventKey: 'g3', quotes: q(2.3), marketProb: 0.5, key: 'e' }),
  ].map((c) => cashCandidate(c)!);

  const picked = chooseCash(board, state, NOW);
  assert.equal(picked[0]!.player, 'E');
  assert.ok(picked.length <= CASH_LIMITS.perDay);
  assert.equal(new Set(picked.map((c) => c.player)).size, picked.length, 'one per player');
  assert.ok(picked.filter((c) => c.eventKey === 'g1').length <= CASH_LIMITS.perGame);
  assert.ok(picked.every((c) => !/^bet365/i.test(c.bestBook.replace(/[^a-z0-9]/gi, ''))));
});

test('day room shrinks after posts on the same US-East day', () => {
  const pick = {
    id: '1',
    kind: 'single' as const,
    sport: 'nba' as const,
    title: 'x',
    writeUp: '',
    units: 1,
    price: 2,
    bookmaker: 'Sportsbet',
    modelProb: 0.5,
    ev: 0.05,
    status: 'pending' as const,
    profitUnits: null,
    firstStartsAt: new Date(NOW + H).toISOString(),
    postedAt: new Date(NOW).toISOString(),
    settledAt: null,
    modelVersion: AI_CASH_TRACK,
    track: AI_CASH_TRACK,
    altBooks: [],
    legs: [
      {
        id: 'l1',
        pickId: '1',
        legIndex: 0,
        sport: 'nba' as const,
        eventKey: 'g1',
        eventLabel: 'a @ b',
        startsAt: new Date(NOW + H).toISOString(),
        market: 'points',
        marketKind: 'main' as const,
        player: 'Jarrett Allen',
        playerId: '1',
        team: 'CLE',
        side: 'over' as const,
        line: 13.5,
        price: 2,
        bookmaker: 'Sportsbet',
        modelProb: 0.5,
        status: 'pending' as const,
        resultValue: null,
        resultNote: null,
        closingLine: null,
        closingPrice: null,
        gradedAt: null,
      },
    ],
  } as AiPick;

  const state = cashPostedState([pick], NOW);
  assert.equal(state.dayCount, 1);
  const room = CASH_LIMITS.perDay - state.dayCount;
  const board = Array.from({ length: 20 }, (_, i) =>
    cashCandidate(
      cand({
        player: `P${i}`,
        eventKey: `g${i}`,
        quotes: [
          { book: 'Sportsbet', price: 2.1 },
          { book: 'TAB', price: 2.0 },
          { book: 'bet365_au', price: 2.3 },
        ],
        marketProb: 0.5,
        key: `k${i}`,
      })
    )!
  );
  const chosen = chooseCash(board, state, NOW);
  assert.ok(chosen.length <= room);
  assert.ok(chosen.length <= CASH_LIMITS.perRun);
});
