import { devig, impliedFromDecimal, type DevigMethod } from '@/lib/tennisAi/devig';
import type { AvailableMarket, BookQuote, ConfidenceTier, PricedSelection } from '@/lib/tennisAi/types';

export const STRONG_EV_PCT = 3;
export const SANITY_GAP = 0.15;
export const KELLY_CAP = 0.02;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** EV per 1 unit. A push returns the stake, so it adds nothing. */
export function expectedValue(modelProb: number, decimalOdds: number, pushProb = 0): number {
  const pWin = clamp(modelProb, 0, 1);
  const pPush = clamp(pushProb, 0, 1 - pWin);
  const pLose = Math.max(0, 1 - pWin - pPush);
  return pWin * (decimalOdds - 1) - pLose;
}

export function kellyFraction(modelProb: number, decimalOdds: number, pushProb = 0): number {
  const b = decimalOdds - 1;
  if (!(b > 0)) return 0;
  const ev = expectedValue(modelProb, decimalOdds, pushProb);
  return ev / b;
}

export function quarterKelly(modelProb: number, decimalOdds: number, pushProb = 0): number {
  return clamp(0.25 * kellyFraction(modelProb, decimalOdds, pushProb), 0, KELLY_CAP);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Probability rounded to 0.1%, which is the figure an answer is allowed to quote. */
export function shownProb(prob: number): number {
  return Math.round(prob * 1000) / 1000;
}

const WIDE_MARGIN = 0.09;

function sameBookPair(
  market: AvailableMarket,
  selectedBook?: string | null
): { side: BookQuote; other: BookQuote } | null {
  const byBook = new Map<string, { side?: BookQuote; other?: BookQuote }>();
  for (const quote of market.quotes) {
    const row = byBook.get(quote.book) || {};
    row.side = !row.side || quote.decimalOdds > row.side.decimalOdds ? quote : row.side;
    byBook.set(quote.book, row);
  }
  for (const quote of market.oppositeQuotes) {
    const row = byBook.get(quote.book) || {};
    row.other = !row.other || quote.decimalOdds > row.other.decimalOdds ? quote : row.other;
    byBook.set(quote.book, row);
  }
  const pairs = [...byBook.values()].filter((row): row is { side: BookQuote; other: BookQuote } =>
    Boolean(row.side && row.other)
  );
  if (!pairs.length) return null;
  if (selectedBook) {
    const chosen = pairs.find((row) => row.side.book === selectedBook);
    if (chosen) return chosen;
  }
  pairs.sort((a, b) => b.side.decimalOdds - a.side.decimalOdds);
  return pairs[0];
}

export function priceTwoWay(
  market: AvailableMarket,
  model: { prob: number; low: number; high: number; pushProb?: number },
  opts: {
    method?: DevigMethod;
    approved: boolean;
    sampleOk: boolean;
    selectedBook?: string | null;
  }
): PricedSelection {
  const warnings: string[] = [];
  const pushProb = model.pushProb ?? 0;
  const empty: PricedSelection = {
    market,
    modelProb: model.prob,
    low: model.low,
    high: model.high,
    pushProb,
    fairProb: null,
    impliedRaw: null,
    edgePct: null,
    evPct: null,
    conservativeEvPct: null,
    kellyPct: null,
    tier: 'Insufficient data',
    needsReview: false,
    backtestApproved: opts.approved,
    warnings,
  };
  if (!market.priceable || market.model === 'unmodelled') {
    warnings.push(market.model === 'unmodelled' ? 'No model for this market.' : 'Both sides are required to remove the margin.');
    return empty;
  }
  if (market.stale) {
    warnings.push('Odds snapshot is stale.');
    return empty;
  }
  const pair = sameBookPair(market, opts.selectedBook);
  const best = pair?.side ?? null;
  const other = pair?.other ?? null;
  if (!best || !other) {
    warnings.push('No paired price.');
    return empty;
  }
  const implied = impliedFromDecimal(best.decimalOdds);
  const impliedOther = impliedFromDecimal(other.decimalOdds);
  if (implied == null || impliedOther == null) {
    warnings.push('Price is not a valid decimal odd.');
    return empty;
  }
  const [fair] = devig([implied, impliedOther], opts.method || 'shin');
  const quotedProb = shownProb(model.prob);
  const quotedLow = shownProb(model.low);
  const quotedPush = shownProb(pushProb);
  const edgePct = round1((quotedProb - fair) * 100);
  const ev = expectedValue(quotedProb, best.decimalOdds, quotedPush);
  const conservative = expectedValue(quotedLow, best.decimalOdds, quotedPush);
  const gap = Math.abs(quotedProb - fair);
  const overround = implied + impliedOther - 1;
  let needsReview = gap > SANITY_GAP;
  if (needsReview) warnings.push('Model and market disagree by a lot. Treat this as a possible data problem.');
  if (overround > WIDE_MARGIN) {
    needsReview = true;
    warnings.push('The book margin on this pair is unusually wide.');
  }
  if (!opts.approved) warnings.push('This market has not passed the backtest, so it is informational only.');
  let tier: ConfidenceTier = 'No edge';
  if (!opts.sampleOk || needsReview) tier = 'Insufficient data';
  else if (!opts.approved || ev <= 0) tier = 'No edge';
  else if (conservative * 100 > STRONG_EV_PCT) tier = 'Strong value';
  else if (ev > 0) tier = 'Lean';
  return {
    market: { ...market, best, bestOpposite: other },
    modelProb: model.prob,
    low: model.low,
    high: model.high,
    pushProb,
    fairProb: fair,
    impliedRaw: implied,
    edgePct,
    evPct: round1(ev * 100),
    conservativeEvPct: round1(conservative * 100),
    kellyPct: round1(quarterKelly(quotedLow, best.decimalOdds, quotedPush) * 100),
    tier,
    needsReview,
    backtestApproved: opts.approved,
    warnings,
  };
}
