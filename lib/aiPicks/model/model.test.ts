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
import { DEFAULT_AI_PICKS_PARAMS } from '../params';
import { bestQuote, bettableQuote, eligibility, isAussieBook } from '../candidates/types';
import { buildTennisCandidates, tennisSelections } from '../candidates/tennis';
import { buildNblGameCandidates } from '../candidates/nbl';
import { tennisContext } from './tennisContext';
import { probOverHist } from '@/lib/tennisAi/simulate';
import { historyFromRows } from '@/lib/tennisAi/live';
import { buildMatchPack } from '@/lib/tennisAi/pack';
import type { TennisBookRow } from '@/lib/tennis/oddsTypes';
import type { TennisMatchRow } from '@/lib/tennis/types';

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

test('posted price: best Australian book, offshore books only inform the middle price', () => {
  assert.ok(['Sportsbet', 'TABtouch', 'Bet Right', 'PointsBet (AU)', 'Bet365 AU', 'Dabble AU', 'bet365'].every(isAussieBook));
  assert.ok(!['Pinnacle', 'Pncl', '1xBet', 'Betano', 'Marathon', 'Betfair', 'BetMGM', 'Betnation_nl'].some(isAussieBook));

  const q = bettableQuote([
    { book: 'Pinnacle', price: 2.05 },
    { book: '1xBet', price: 2.1 },
    { book: 'Sportsbet', price: 1.95 },
    { book: 'TAB', price: 1.9 },
  ])!;
  assert.equal(q.best.book, 'Sportsbet');
  assert.deepEqual(q.quotes.map((x) => x.book), ['Sportsbet', 'TAB']);

  // A stale Australian price far above every book's middle price is not posted.
  const stale = bettableQuote([
    { book: 'Pinnacle', price: 1.9 },
    { book: 'Betano', price: 1.92 },
    { book: 'Ladbrokes', price: 1.88 },
    { book: 'PlayUp', price: 2.4 },
  ])!;
  assert.equal(stale.best.book, 'Ladbrokes');
  assert.match(stale.flags[0]!, /outlier price 2.4 at PlayUp/);
  assert.match(stale.flags[1]!, /Only one Australian bookmaker/);

  assert.equal(bettableQuote([{ book: 'Pinnacle', price: 2 }, { book: 'Betano', price: 2.02 }]), null);
});

test('NBL game lines: every alternate spread and total is priced; main line comes from each book main', () => {
  const row = (name: string, spreads: Array<[string, string, string]>, totals: Array<[string, string, string]>, main: [number, number]) => ({
    name,
    H2H: { home: '-250', away: '+200' },
    Spread: { line: spreads[main[0]]![0], over: spreads[main[0]]![1], under: spreads[main[0]]![2] },
    Total: { line: totals[main[1]]![0], over: totals[main[1]]![1], under: totals[main[1]]![2] },
    SpreadLines: spreads.map(([line, over, under]) => ({ line, over, under })),
    TotalLines: totals.map(([line, over, under]) => ({ line, over, under })),
  });
  const spreads: Array<[string, string, string]> = [['-11.5', '+143', '-185'], ['-8.5', '-105', '-120'], ['-5.5', '-161', '+128']];
  const totals: Array<[string, string, string]> = [['179.5', '-200', '+160'], ['185.5', '-114', '-109'], ['191.5', '+150', '-192']];
  const odds = {
    gameId: 'g',
    homeTeam: 'Tasmania JackJumpers',
    awayTeam: 'Brisbane Bullets',
    commenceTime: '2026-10-21T08:30:00Z',
    bookmakers: [row('Unibet', spreads, totals, [1, 1]), row('Sportsbet', spreads, totals, [1, 1]), row('TAB', [spreads[1]!], [totals[1]!], [0, 0])],
  };
  const out = buildNblGameCandidates({ odds, finals: [], params: DEFAULT_AI_PICKS_PARAMS.nbl, currentSeason: 2026 });
  const lines = (market: string) => [...new Set(out.filter((c) => c.market === market && c.side !== 'away').map((c) => `${c.line}:${c.marketKind}`))];
  assert.deepEqual(lines('spread'), ['-11.5:alternate', '-8.5:main', '-5.5:alternate']);
  assert.deepEqual(lines('total'), ['179.5:alternate', '185.5:main', '191.5:alternate']);
  const alt = out.find((c) => c.market === 'total' && c.line === 191.5 && c.side === 'over')!;
  assert.deepEqual(alt.quotes.map((q) => q.book).sort(), ['Sportsbet', 'Unibet']);
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

test('tennis context numbers on every market: context off at strength 0, the model itself at strength 1', () => {
  const played = (id: string, serve: number, returns: number, surface: string, minutes: number) =>
    Array.from({ length: 16 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      tour: 'ATP',
      surface,
      playerId: id,
      opponentId: `${id}-opp${i}`,
      isWin: i % 3 !== 0,
      servicePointsWonPct: serve,
      returnPointsWonPct: returns,
      serviceGamesWon: 10,
      serveGames: 12,
      minutes,
      totalSets: 2,
      score: '6-4 6-4',
      playerRank: id === 'h' ? 30 : 120,
      opponentRank: id === 'h' ? 300 : 15,
    })) as unknown as TennisMatchRow[];
  const history = historyFromRows([...played('h', 0.7, 0.42, 'Clay', 95), ...played('a', 0.6, 0.35, 'Hard', 200)], 'ATP');
  const pack = buildMatchPack({ asOf: '2026-09-20T00:00:00Z', tour: 'ATP', surface: 'Hard', bestOf: 3, playerId: 'h', opponentId: 'a', history, markets: [], sims: 2000, seed: 7 });
  const books = [
    book('Sportsbet', {
      H2H: { home: '-200', away: '+165' },
      SpreadLines: [ou('-3.5', '-110', '-110')],
      TotalLines: [ou('21.5', '-115', '-105')],
      GamesWonLines: [ou('12.5', '-110', '-110')],
      TotalSetsLines: [ou('2.5', '+150', '-180')],
      SetsLostLines: [ou('0.5', '+140', '-170')],
    }),
  ];
  const build = (strength: number) =>
    buildTennisCandidates({
      match: { matchId: 'm', homeId: 'h', awayId: 'a', homeName: 'H. Home', awayName: 'A. Away', startsAt: '2026-10-01T05:00:00Z', surface: 'Hard', bestOf: 3, tournament: null },
      books,
      sim: pack.sim,
      features: pack.features,
      logs: { home: [], away: [] },
      params: DEFAULT_AI_PICKS_PARAMS.tennis,
      anchor: { sims: 2000, seed: 7 },
      context: tennisContext({ history, features: pack.features, homeId: 'h', awayId: 'a', baseSim: pack.sim, strength, sims: 2000, seed: 7 }),
    });
  const full = build(1);
  const off = build(0);
  assert.deepEqual([...new Set(full.map((c) => c.market))].sort(), ['game_handicap', 'match_winner', 'player_games', 'total_games', 'total_sets', 'win_a_set']);
  for (const c of [...full, ...off]) assert.ok(c.contextProbs, `${c.key} has no context numbers`);
  for (const c of full) near(c.contextProbs!.full, c.modelProb!, 0.0015);
  // The context model rounds serve rates to 4 places, so strength 0 re-simulates from marginally different inputs.
  for (const c of off.filter((x) => x.market !== 'match_winner')) near(c.contextProbs!.base, c.modelProb!, 0.01);
  assert.ok(full.some((c) => c.market !== 'match_winner' && Math.abs(c.contextProbs!.full - c.contextProbs!.base) >= 0.005));
});
