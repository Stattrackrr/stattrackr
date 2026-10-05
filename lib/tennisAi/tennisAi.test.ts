import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAvailableMarkets } from './availability';
import { composeAnswer, validateAnswer } from './answers';
import { evaluateMarket, sameReport, walkForward } from './backtest';
import { devig } from './devig';
import { expectedValue, kellyFraction, priceTwoWay, quarterKelly, round1 } from './ev';
import type { AvailableMarket } from './types';
import { buildMatchupFeatures, rowsBefore, type HistoryMatch } from './features';
import { answerPayload, buildMatchPack, simAgreesWithSets } from './pack';
import { generateQuestions } from './questions';
import { simulateMatch } from './simulate';
import type { TennisBookRow, TennisMatchOdds } from '../tennis/oddsTypes';

const emptyOu = { line: 'N/A', over: 'N/A', under: 'N/A' };

function book(over: Partial<TennisBookRow> = {}): TennisBookRow {
  return {
    name: 'bet365',
    H2H: { home: '1.80', away: '2.05' },
    Spread: emptyOu,
    Total: { line: '22.5', over: '1.91', under: '1.91' },
    GamesWon: emptyOu,
    GamesLost: emptyOu,
    TotalSets: emptyOu,
    SpreadLines: [],
    TotalLines: [],
    GamesWonLines: [],
    GamesLostLines: [],
    TotalSetsLines: [],
    ...over,
  };
}

function odds(rows: TennisBookRow[], fetchedAt = new Date().toISOString()): TennisMatchOdds {
  return { matchId: 'm1', homeTeam: 'Medvedev', awayTeam: 'Rublev', bookmakers: rows, fetchedAt };
}

function row(date: string, playerId: string, extra: Partial<HistoryMatch> = {}): HistoryMatch {
  return {
    date,
    tour: 'ATP',
    surface: 'Hard',
    playerId,
    opponentId: playerId === 'a' ? 'b' : 'a',
    isWin: true,
    servicePointsWonPct: 0.64,
    returnPointsWonPct: 0.38,
    holdPct: 0.82,
    aces: 6,
    doubleFaults: 2,
    serveGames: 10,
    serveGamesPlayed: 10,
    minutes: 90,
    setsPlayed: 2,
    tiebreak: false,
    wonTiebreak: null,
    firstSetWin: true,
    wonAfterLosingFirst: false,
    rank: 10,
    opponentRank: 20,
    hand: 'R',
    opponentHand: 'R',
    ...extra,
  };
}

test('de-vig methods turn a symmetric market into 50/50', () => {
  const implied = [0.55, 0.55];
  for (const method of ['multiplicative', 'power', 'shin'] as const) {
    const fair = devig(implied, method);
    assert.equal(fair.length, 2);
    assert.ok(Math.abs(fair[0] - 0.5) < 0.01, method);
    assert.ok(Math.abs(fair[1] - 0.5) < 0.01, method);
    assert.ok(Math.abs(fair[0] + fair[1] - 1) < 1e-6, method);
  }
});

test('EV and Kelly match the hand calculation, including pushes', () => {
  assert.ok(Math.abs(expectedValue(0.6, 2) - 0.2) < 1e-12);
  assert.ok(Math.abs(kellyFraction(0.6, 2) - 0.2) < 1e-12);
  assert.equal(quarterKelly(0.6, 2), 0.02);
  const pushed = expectedValue(0.4, 2, 0.2);
  assert.ok(Math.abs(pushed - 0) < 1e-12);
  assert.ok(Math.abs(kellyFraction(0.4, 2, 0.2)) < 1e-12);
  assert.equal(round1(expectedValue(0.348, 1.76, 0) * 100), -38.8);
  assert.equal(round1(expectedValue(0.325, 1.76, 0) * 100), -42.8);
});

test('de-vig uses both sides from the same book', () => {
  const market: AvailableMarket = {
    key: 'TOTAL_GAMES',
    name: 'Total games',
    selection: 'UNDER',
    opposite: 'OVER',
    line: 22,
    score: null,
    model: 'simulation',
    priceable: true,
    stale: false,
    featured: true,
    quotes: [
      { book: 'soft', decimalOdds: 1.76, fetchedAt: null },
      { book: 'other', decimalOdds: 1.7, fetchedAt: null },
    ],
    oppositeQuotes: [
      { book: 'soft', decimalOdds: 1.91, fetchedAt: null },
      { book: 'other', decimalOdds: 2.2, fetchedAt: null },
    ],
    best: { book: 'soft', decimalOdds: 1.76, fetchedAt: null },
    bestOpposite: { book: 'other', decimalOdds: 2.2, fetchedAt: null },
  };
  const priced = priceTwoWay(
    market,
    { prob: 0.348, low: 0.325, high: 0.372, pushProb: 0 },
    { approved: false, sampleOk: true }
  );
  assert.equal(priced.market.best?.book, 'soft');
  assert.equal(priced.market.bestOpposite?.book, 'soft');
  assert.ok(Math.abs((priced.fairProb ?? 0) - 0.52) < 0.015);
  assert.equal(priced.evPct, -38.8);
  assert.equal(priced.conservativeEvPct, -42.8);
  assert.equal(priced.needsReview, true);
});

test('simulation set scores agree with the match-winner probability', () => {
  const sim = simulateMatch({ pA: 0.64, pB: 0.61, bestOf: 3, uncertainty: 0.01 }, 3000, 11);
  assert.ok(simAgreesWithSets(sim));
  const scoreSum = Object.values(sim.setScores).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(scoreSum - 1) < 1e-9);
  assert.ok(Math.abs(sim.matchWinA + sim.matchWinB - 1) < 1e-9);
});

test('feature builder never reads a row dated on or after the match', () => {
  const history = [
    row('2026-01-01', 'a', { servicePointsWonPct: 0.6 }),
    row('2026-06-01', 'a', { servicePointsWonPct: 0.99 }),
    row('2026-06-02', 'a', { servicePointsWonPct: 0.99 }),
  ];
  assert.equal(rowsBefore(history, '2026-06-01').length, 1);
  const features = buildMatchupFeatures({
    asOf: '2026-06-01',
    tour: 'ATP',
    surface: 'Hard',
    bestOf: 3,
    playerId: 'a',
    opponentId: 'b',
    history: [
      ...history,
      ...history.map((item) => row(item.date, 'b', { servicePointsWonPct: item.servicePointsWonPct })),
    ],
  });
  assert.equal(features.player.n, 1);
  assert.ok((features.player.serve.value ?? 1) < 0.9);
});

test('backtest report repeats for the same seed and rejects a negative closing-line sample', () => {
  const bets = Array.from({ length: 40 }, (_, index) => ({
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    tour: 'ATP' as const,
    surface: 'Hard',
    market: 'MATCH_WINNER',
    modelProb: 0.55,
    openOdds: 2,
    closeOdds: 1.7,
    won: index % 2 === 0,
  }));
  const walked = walkForward(bets, (history, row) => (history.length ? 0.55 : row.modelProb));
  const first = evaluateMarket(walked, { minBets: 300, maxEce: 0.05 }, 4);
  const second = evaluateMarket(walked, { minBets: 300, maxEce: 0.05 }, 4);
  assert.equal(sameReport(first, second), true);
  assert.equal(first.approved, false);
  assert.ok(first.reasons.some((reason) => /closing line|Only/.test(reason)));
});

test('a failed gate is never called value', async () => {
  const report = evaluateMarket([
    {
      date: '2026-01-01',
      tour: 'ATP',
      surface: 'Hard',
      market: 'TOTAL_GAMES',
      modelProb: 0.6,
      openOdds: 1.9,
      closeOdds: 1.5,
      won: false,
    },
  ]);
  assert.equal(report.approved, false);
  const history = ['a', 'b'].flatMap((id) =>
    Array.from({ length: 12 }, (_, index) => row(`2026-01-${String(index + 1).padStart(2, '0')}`, id))
  );
  const markets = resolveAvailableMarkets(odds([book()]));
  const pack = buildMatchPack({
    asOf: '2026-08-01',
    tour: 'ATP',
    surface: 'Hard',
    bestOf: 3,
    playerId: 'a',
    opponentId: 'b',
    history,
    markets,
    report,
    sims: 400,
    seed: 2,
  });
  const selection = pack.priced.find((item) => item.market.key === 'TOTAL_GAMES' && item.market.selection === 'OVER') || null;
  assert.notEqual(selection?.tier, 'Strong value');
  assert.notEqual(selection?.tier, 'Lean');
  const payload = answerPayload({
    player: 'Medvedev',
    opponent: 'Rublev',
    surface: 'Hard',
    bestOf: 3,
    tournament: 'Hangzhou',
    question: 'Is over 22.5 games a good bet?',
    selection,
    features: pack.features,
    report,
  });
  const draft = await composeAnswer(payload);
  assert.equal(/strong value|I'd back|bet on/i.test(draft.answer), false);
  assert.equal(/settled bets/i.test(draft.answer), false);
  assert.equal(draft.errors.length, 0, draft.errors.join('; ') + '\n' + draft.answer);
});

test('questions never mention aces when the board has no ace price', () => {
  const markets = resolveAvailableMarkets(odds([book()]));
  assert.equal(markets.some((market) => String(market.key).includes('ACE')), false);
  for (let seed = 1; seed <= 1000; seed += 1) {
    const questions = generateQuestions({
      matchId: 'm1',
      markets,
      player: 'Medvedev',
      opponent: 'Rublev',
      surface: 'hard',
      seed,
      count: 4,
    }).questions;
    for (const question of questions) {
      assert.equal(/ace/i.test(question.text), false, question.text);
      assert.equal(String(question.market_key).includes('ACE'), false);
      assert.equal(question.data_available, true);
    }
  }
});

test('one-sided prices are not given an EV', () => {
  const markets = resolveAvailableMarkets(
    odds([
      book({
        Total: { line: '22.5', over: '1.91', under: 'N/A' },
      }),
    ])
  );
  const total = markets.find((market) => market.key === 'TOTAL_GAMES');
  assert.equal(total, undefined);
});

test('questions use the chart main line, not an alt', () => {
  const markets = resolveAvailableMarkets(
    odds([
      book({
        Total: { line: '21.5', over: '-118', under: '-118' },
        TotalLines: [
          { line: '21', over: '-105', under: '-115' },
          { line: '21.5', over: '-118', under: '-118' },
          { line: '22.5', over: '-150', under: '+120' },
        ],
        Spread: { line: '-4.5', over: '+105', under: '-143' },
        SpreadLines: [
          { line: '-4.5', over: '+105', under: '-143' },
          { line: '-8.5', over: '-110', under: '-110' },
        ],
        TotalSets: { line: '2.5', over: '-200', under: '+150' },
        TotalSetsLines: [{ line: '2.5', over: '-200', under: '+150' }],
      }),
    ])
  );
  const questions = generateQuestions({
    matchId: 'm1',
    markets,
    player: 'Blanch',
    opponent: 'Maloney',
    surface: 'hard',
    seed: 3,
    count: 4,
  }).questions;
  const text = questions.map((row) => row.text).join(' ');
  assert.match(text, /21\.5/);
  assert.match(text, /4\.5/);
  assert.equal(/8\.5/.test(text), false);
  assert.equal(/\b21 games\b/.test(text), false);
  assert.equal(/2\.5 sets/.test(text), false);
});

test('plus handicap questions do not say too many', () => {
  const dog = generateQuestions({
    matchId: 'm1',
    markets: resolveAvailableMarkets(
      odds([
        book({
          Spread: { line: '+1.5', over: '1.91', under: '1.91' },
          Total: { line: '22.5', over: '1.91', under: '1.91' },
        }),
      ])
    ),
    player: 'Djokovic',
    opponent: 'Medvedev',
    surface: 'hard',
    seed: 1,
    count: 4,
  }).questions;
  const playerCover = dog.find((row) => /Djokovic cover \+1\.5/i.test(row.text));
  assert.ok(playerCover, dog.map((row) => row.text).join(' | '));
  assert.equal(/too many/i.test(playerCover.text), false, playerCover.text);

  const fav = generateQuestions({
    matchId: 'm1',
    markets: resolveAvailableMarkets(
      odds([
        book({
          Spread: { line: '-2.5', over: '1.91', under: '1.91' },
          Total: { line: '22.5', over: '1.91', under: '1.91' },
        }),
      ])
    ),
    player: 'Djokovic',
    opponent: 'Medvedev',
    surface: 'hard',
    seed: 1,
    count: 4,
  }).questions;
  const favCover = fav.find((row) => /Djokovic cover -2\.5/i.test(row.text));
  assert.ok(favCover, fav.map((row) => row.text).join(' | '));
  assert.match(favCover.text, /too many games to win by/i);
});

test('validator rejects an EV that does not match the quoted probability', async () => {
  const payload = answerPayload({
    player: 'Tiago Pereira',
    opponent: 'O. Virtanen',
    surface: 'Hard',
    bestOf: 3,
    tournament: 'Porto',
    question: 'Is under 22 games a bet?',
    selection: null,
    features: buildMatchupFeatures({
      asOf: '2026-08-01',
      tour: 'ATP',
      surface: 'Hard',
      bestOf: 3,
      playerId: 'a',
      opponentId: 'b',
      history: [],
    }),
    report: evaluateMarket([]),
  });
  payload.market = {
    key: 'TOTAL_GAMES',
    selection: 'UNDER',
    line: 22,
    best_odds: 1.76,
    best_book: 'soft',
    opposite_odds: 1.91,
    selected_odds: 1.76,
  };
  payload.model = { prob: 0.348, interval: [0.325, 0.372] };
  payload.market_fair_prob = 0.52;
  payload.ev_pct = -38.8;
  payload.conservative_ev_pct = -42.8;
  payload.push_prob = 0;
  payload.needs_review = true;
  payload.confidence_tier = 'Insufficient data';
  payload.stat_comparison = [
    { stat: 'Hold %', player: 70.7, opponent: 84.6, note: 'implausible' },
    { stat: 'Return pts won %', player: 36.9, opponent: 36.7, note: 'level' },
  ];
  const draft = await composeAnswer(payload);
  assert.equal(draft.errors.length, 0, draft.errors.join('; ') + '\n' + draft.answer);
  assert.equal(/-38\.8|-42\.8|32\.5|37\.2/.test(draft.answer), false);
  const audited = validateAnswer(draft.answer, { ...payload, ev_pct: -30.9 });
  assert.ok(audited.some((error) => /EV/.test(error)));
  assert.match(draft.answer, /under 22 games/);
  assert.match(draft.answer, /haven't validated/i);
  assert.match(draft.answer, /70\.7/);
  const quoted = { ...payload, quoted: { prob_pct: 34.8, fair_pct: 52, low_pct: 32.5, high_pct: 37.2, odds: 1.76, odds_label: '1.76' }, footer: payload.footer };
  const mismatch = validateAnswer(
    `${draft.answer.replace('Not one to touch.', 'Honestly, not really.')} The EV is -30.9.`,
    quoted
  );
  assert.ok(mismatch.some((error) => /cannot quote|-30\.9|EV/.test(error)));
});

test('validator rejects invented numbers and banned phrases', () => {
  const payload = answerPayload({
    player: 'Medvedev',
    opponent: 'Rublev',
    surface: 'Hard',
    bestOf: 3,
    tournament: 'Hangzhou',
    question: 'Is over 22.5 games a good bet?',
    selection: null,
    features: buildMatchupFeatures({
      asOf: '2026-08-01',
      tour: 'ATP',
      surface: 'Hard',
      bestOf: 3,
      playerId: 'a',
      opponentId: 'b',
      history: [],
    }),
    report: evaluateMarket([]),
  });
  const ready = { ...payload, quoted: payload.quoted, footer: payload.footer };
  const invented = validateAnswer(
    `${'Honestly, not really. '.repeat(20)} The secret number is 99. Medvedev and Rublev.`,
    ready
  );
  assert.ok(invented.some((error) => error.includes('99')));
  const banned = validateAnswer(
    `${'Honestly, not really. This is a sure thing for Medvedev against Rublev. '.repeat(8)}`,
    ready
  );
  assert.ok(banned.some((error) => /Banned/.test(error)));
});
