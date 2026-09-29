import { marketIdentity } from '@/lib/tennisAi/availability';
import { evaluateMarket, type BacktestReport } from '@/lib/tennisAi/backtest';
import { countOverUnder, expectedCount } from '@/lib/tennisAi/counts';
import { priceTwoWay } from '@/lib/tennisAi/ev';
import { buildMatchupFeatures, type FormRecord, type HistoryMatch, type MatchupFeatures, type Tour } from '@/lib/tennisAi/features';
import { meanOfHist, probCoverLine, probOverHist, setScoreWinProb, simulateMatch, type SimSummary } from '@/lib/tennisAi/simulate';
import { responsibleGamblingFooter } from '@/lib/tennisAi/answers';
import type { AnswerPayload, AvailableMarket, PricedSelection, StatComparison } from '@/lib/tennisAi/types';

export type MatchPack = {
  features: MatchupFeatures;
  sim: SimSummary;
  priced: PricedSelection[];
  report: BacktestReport;
};

function interval(prob: number, width: number): [number, number] {
  const w = Math.max(0.02, width);
  return [Math.max(0.01, prob - w), Math.min(0.99, prob + w)];
}

function blendedRate(form: { surface: FormRecord; surfaceLast10: FormRecord; last10: FormRecord }): number | null {
  const season = form.surface.n >= 8 ? form.surface.wins / form.surface.n : null;
  const recent = form.surfaceLast10.n >= 8 ? form.surfaceLast10.wins / form.surfaceLast10.n : null;
  if (recent != null && season != null) return recent * 0.6 + season * 0.4;
  if (recent != null) return recent;
  if (season != null) return season;
  if (form.last10.n >= 8) return form.last10.wins / form.last10.n;
  return null;
}

/** Win rate from surface form, with last 10 weighted ahead of the longer sample. Two even records stay near 50%. */
function formWinProb(features: MatchupFeatures, selection: string): number | null {
  const mine = selection === 'OPPONENT' ? features.opponent.form : features.player.form;
  const theirs = selection === 'OPPONENT' ? features.player.form : features.opponent.form;
  const p = blendedRate(mine);
  const q = blendedRate(theirs);
  if (p == null || q == null) return null;
  const a = Math.max(p, 0.05) * Math.max(1 - q, 0.05);
  const b = Math.max(1 - p, 0.05) * Math.max(q, 0.05);
  return a / (a + b);
}

function sideProb(
  market: AvailableMarket,
  sim: SimSummary,
  features: MatchupFeatures
): { prob: number; low: number; high: number; pushProb: number } | null {
  const width = features.serveUncertainty * 2;
  if (market.model === 'unmodelled') return null;
  if (market.key === 'MATCH_WINNER') {
    let prob = market.selection === 'PLAYER' ? sim.matchWinA : sim.matchWinB;
    const form = formWinProb(features, market.selection);
    if (form != null) prob = prob * 0.5 + form * 0.5;
    if (features.h2hPlayed >= 3) {
      const h2h =
        market.selection === 'OPPONENT'
          ? 1 - features.h2hWins / features.h2hPlayed
          : features.h2hWins / features.h2hPlayed;
      prob = prob * 0.85 + h2h * 0.15;
    }
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: 0 };
  }
  if (market.key === 'TOTAL_GAMES' && market.line != null) {
    const side = probOverHist(sim.totalGames, market.line);
    const prob = market.selection === 'OVER' ? side.over : side.under;
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: side.push };
  }
  if (market.key === 'GAME_HANDICAP' && market.line != null) {
    const playerLine = market.selection === 'PLAYER' ? market.line : -market.line;
    const side = probCoverLine(sim.gameMargin, playerLine);
    const prob = market.selection === 'PLAYER' ? side.over : side.under;
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: side.push };
  }
  if (market.key === 'PLAYER_TOTAL_GAMES' && market.line != null) {
    const hist = market.selection === 'OVER' || market.selection === 'PLAYER' ? sim.gamesA : sim.gamesA;
    const side = probOverHist(hist, market.line);
    const prob = market.selection === 'UNDER' ? side.under : side.over;
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: side.push };
  }
  if (market.key === 'TOTAL_SETS' && market.line != null) {
    const side = probOverHist(sim.setsPlayed, market.line);
    const prob = market.selection === 'OVER' ? side.over : side.under;
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: side.push };
  }
  if (market.key === 'PLAYER_ACES' || market.key === 'TOTAL_ACES' || market.key === 'PLAYER_DOUBLE_FAULTS') {
    const games = meanOfHist(market.selection === 'OPPONENT' ? sim.serviceGamesB : sim.serviceGamesA);
    const rate =
      market.key === 'PLAYER_DOUBLE_FAULTS'
        ? features.player.dfRate.value ?? features.player.dfRate.prior ?? 0.2
        : features.player.aceRate.value ?? features.player.aceRate.prior ?? 0.4;
    const both = market.key === 'TOTAL_ACES';
    const oppRate = features.opponent.aceRate.value ?? features.opponent.aceRate.prior ?? 0.4;
    const lambda = both
      ? expectedCount(games, rate) + expectedCount(meanOfHist(sim.serviceGamesB), oppRate)
      : expectedCount(games, rate);
    if (market.line == null || !(lambda > 0)) return null;
    const side = countOverUnder(lambda, market.line);
    const prob = market.selection === 'UNDER' ? side.under : side.over;
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: side.push };
  }
  if (market.key === 'FIRST_SET_WINNER') {
    const prob = market.selection === 'PLAYER' ? sim.firstSetA : 1 - sim.firstSetA;
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: 0 };
  }
  if (market.key === 'TIEBREAK_IN_MATCH') {
    const prob = market.selection === 'NO' ? 1 - sim.tiebreak : sim.tiebreak;
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: 0 };
  }
  if (market.key === 'SET_BETTING' && market.score) {
    const prob = sim.setScores[market.score] || 0;
    const [low, high] = interval(prob, width);
    return { prob, low, high, pushProb: 0 };
  }
  return null;
}

export function buildMatchPack(input: {
  asOf: string;
  tour: Tour;
  surface: string;
  bestOf: 3 | 5;
  playerId: string;
  opponentId: string;
  history: HistoryMatch[];
  markets: AvailableMarket[];
  report?: BacktestReport | null;
  sims?: number;
  seed?: number;
  selectedBook?: string | null;
}): MatchPack {
  const features = buildMatchupFeatures(input);
  const messyHold = [features.player.hold.value, features.opponent.hold.value].some(
    (hold) => hold != null && (hold < 0.75 || hold > 0.95)
  );
  const sim = simulateMatch(
    {
      pA: features.pServePlayer,
      pB: features.pServeOpponent,
      bestOf: input.bestOf,
      uncertainty: features.serveUncertainty,
    },
    input.sims ?? 4000,
    input.seed ?? 1
  );
  const report = input.report ?? evaluateMarket([]);
  const priced: PricedSelection[] = input.markets.map((market): PricedSelection => {
    const model = sideProb(market, sim, features);
    if (!model) {
      return priceTwoWay(
        { ...market, model: 'unmodelled' },
        { prob: 0.5, low: 0.5, high: 0.5 },
        { approved: false, sampleOk: false, selectedBook: input.selectedBook }
      );
    }
    const pricedRow = priceTwoWay(market, model, {
      approved: report.approved && market.model !== 'unmodelled',
      sampleOk: !features.insufficient && !features.player.retiredRecent && !messyHold,
      selectedBook: input.selectedBook,
    });
    if (!messyHold) return pricedRow;
    return {
      ...pricedRow,
      needsReview: true,
      tier: 'Insufficient data' as const,
      warnings: pricedRow.warnings.some((warning) => /hold rate/i.test(warning))
        ? pricedRow.warnings
        : [...pricedRow.warnings, 'Hold rate is outside a normal pro range.'],
    };
  });
  return { features, sim, priced, report };
}

export function statsFor(features: MatchupFeatures): StatComparison[] {
  const row = (
    stat: string,
    player: number | null | undefined,
    opponent: number | null | undefined
  ): StatComparison => ({
    stat,
    player: player == null ? null : Math.round(player * 1000) / 10,
    opponent: opponent == null ? null : Math.round(opponent * 1000) / 10,
    note: player != null && opponent != null && player >= opponent ? 'player edge' : 'opponent edge',
  });
  return [
    row('Hold %', (features.player.hold.value ?? 0) * (features.player.hold.value != null ? 1 : NaN), features.opponent.hold.value),
    row('Return pts won %', features.player.returns.value, features.opponent.returns.value),
  ].map((item) => ({
    ...item,
    player: item.player != null && Number.isFinite(item.player) ? Math.round((item.stat === 'Hold %' || item.stat === 'Return pts won %' ? item.player : item.player) * (item.player <= 1 ? 100 : 1) * 10) / 10 : null,
    opponent: item.opponent != null && Number.isFinite(item.opponent) ? Math.round(item.opponent * (item.opponent <= 1 ? 100 : 1) * 10) / 10 : null,
  }));
}

export function findPriced(priced: PricedSelection[], market: Pick<AvailableMarket, 'key' | 'selection' | 'line'>): PricedSelection | null {
  const id = marketIdentity(market);
  return priced.find((row) => marketIdentity(row.market) === id) || null;
}

export function answerPayload(input: {
  player: string;
  opponent: string;
  surface: string;
  bestOf: 3 | 5;
  tournament: string;
  question: string;
  selection: PricedSelection | null;
  features: MatchupFeatures;
  report: BacktestReport;
}): AnswerPayload {
  const selection = input.selection;
  const flags: string[] = [];
  if (input.features.h2hPlayed) {
    flags.push(`Head to head is ${input.features.h2hWins} wins from ${input.features.h2hPlayed} meetings, which is a small sample unless it is long`);
  }
  if (input.features.opponent.restDays != null && input.features.opponent.restDays <= 1) {
    flags.push(`${input.opponent} is on short rest`);
  }
  const holdPlayer = input.features.player.hold.value == null ? null : Math.round(input.features.player.hold.value * 1000) / 10;
  const holdOpp = input.features.opponent.hold.value == null ? null : Math.round(input.features.opponent.hold.value * 1000) / 10;
  const retPlayer = input.features.player.returns.value == null ? null : Math.round(input.features.player.returns.value * 1000) / 10;
  const retOpp = input.features.opponent.returns.value == null ? null : Math.round(input.features.opponent.returns.value * 1000) / 10;
  const holdImplausible = [holdPlayer, holdOpp].some((value) => value != null && (value < 75 || value > 95));
  const returnsLevel = retPlayer != null && retOpp != null && Math.abs(retPlayer - retOpp) <= 1.5;
  const losses = (record: FormRecord) => record.n - record.wins;
  const playerForm = input.features.player.form;
  const opponentForm = input.features.opponent.form;
  const comparisons = [
    {
      stat: 'Hold %',
      player: holdPlayer,
      opponent: holdOpp,
      note: holdImplausible ? 'implausible' : 'serve',
    },
    {
      stat: 'Return pts won %',
      player: retPlayer,
      opponent: retOpp,
      note: returnsLevel ? 'level' : 'return',
    },
  ];
  return {
    question: {
      text: input.question,
      market_key: selection?.market.key ?? null,
      selection: selection?.market.selection ?? null,
      line: selection?.market.line ?? null,
    },
    match: {
      player: input.player,
      opponent: input.opponent,
      surface: input.surface,
      format: input.bestOf === 5 ? 'best of 5' : 'best of 3',
      tournament: input.tournament || 'this event',
    },
    market: selection
      ? {
          key: selection.market.key,
          selection: selection.market.selection,
          line: selection.market.line,
          best_odds: selection.market.best?.decimalOdds ?? null,
          best_book: selection.market.best?.book ?? null,
          opposite_odds: selection.market.bestOpposite?.decimalOdds ?? null,
          selected_odds: selection.market.best?.decimalOdds ?? null,
        }
      : null,
    model: {
      prob: selection?.modelProb ?? null,
      interval: selection?.low != null && selection.high != null ? [selection.low, selection.high] : null,
    },
    push_prob: selection?.pushProb ?? 0,
    needs_review: Boolean(selection?.needsReview) || holdImplausible,
    market_fair_prob: selection?.fairProb ?? null,
    edge_pct: selection?.edgePct ?? null,
    ev_pct: selection?.evPct ?? null,
    conservative_ev_pct: selection?.conservativeEvPct ?? null,
    confidence_tier: selection?.needsReview || holdImplausible ? 'Insufficient data' : selection?.tier ?? 'Insufficient data',
    backtest: {
      approved: input.report.approved,
      n_bets: input.report.n,
      clv_pct: input.report.clvPct,
      calibration_note: input.report.approved ? 'historical check passed' : 'not validated',
    },
    stat_comparison: comparisons,
    form: {
      playerSurfaceWins: playerForm.surface.wins,
      playerSurfaceLosses: losses(playerForm.surface),
      playerSurfaceN: playerForm.surface.n,
      playerSurfaceLast10Wins: playerForm.surfaceLast10.wins,
      playerSurfaceLast10Losses: losses(playerForm.surfaceLast10),
      playerSurfaceLast10N: playerForm.surfaceLast10.n,
      playerLast10Wins: playerForm.last10.wins,
      playerLast10Losses: losses(playerForm.last10),
      playerLast10N: playerForm.last10.n,
      opponentSurfaceWins: opponentForm.surface.wins,
      opponentSurfaceLosses: losses(opponentForm.surface),
      opponentSurfaceN: opponentForm.surface.n,
      opponentSurfaceLast10Wins: opponentForm.surfaceLast10.wins,
      opponentSurfaceLast10Losses: losses(opponentForm.surfaceLast10),
      opponentSurfaceLast10N: opponentForm.surfaceLast10.n,
      opponentLast10Wins: opponentForm.last10.wins,
      opponentLast10Losses: losses(opponentForm.last10),
      opponentLast10N: opponentForm.last10.n,
      h2hWins: input.features.h2hWins,
      h2hPlayed: input.features.h2hPlayed,
    },
    context_flags: flags,
    warnings: selection?.warnings ?? ['No priced market matched this question.'],
    stake_pct: selection?.kellyPct ?? null,
    footer: responsibleGamblingFooter(),
    quoted: { prob_pct: null, fair_pct: null, low_pct: null, high_pct: null, odds: null, odds_label: null },
  };
}

export function simAgreesWithSets(sim: SimSummary): boolean {
  const fromScores = setScoreWinProb(sim.setScores, 'A');
  return Math.abs(fromScores - sim.matchWinA) < 1e-9;
}
