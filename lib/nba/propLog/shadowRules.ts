/**
 * Pure rules for the frozen shadow policies (agreed build spec, section 3 item 1 and Part D):
 * scoring a logged line with the model's coefficients, the fair price with the bet book left out,
 * the phantom-price rule, and the would-be bet itself. No I/O here, so every rule is unit-tested.
 */

import { fairTwoWay, median } from '@/lib/aiPicks/model/math';
import { BASE_STATS } from '@/lib/nba/model/design';
import { logit } from '@/lib/nba/model/residual';
import type { LoggedQuote } from './lines';

/** Coefficients by parameter name (see lib/nba/model/design.ts), with the controls' scaling from the fit. */
export type ModelCoefs = {
  version: string;
  theta: Record<string, number>;
  controls: { booksMean: number; booksSd: number; dispMean: number; dispSd: number };
  /** Minimum EV per unit at the best confirmed AU price for a would-be bet. */
  minEv: number;
  features: Array<{ name: string; key: string; stats?: readonly string[] }>;
};

/**
 * Before any fit: the market as it is (a = 1, everything else 0). Would-be bets under this version
 * are the pure line-shopping baseline, the (a) part of CLV.
 */
export const MODEL_V0: ModelCoefs = {
  version: 'v0-market',
  theta: { a: 1 },
  controls: { booksMean: 0, booksSd: 1, dispMean: 0, dispSd: 1 },
  minEv: 0.03,
  features: [
    { name: 'minutes_new_info', key: 'minutes_new_info_z' },
    { name: 'usage_shift', key: 'usage_shift_z', stats: ['points', 'assists', 'threeMade'] },
    { name: 'usage_shift_reb', key: 'usage_shift_z', stats: ['rebounds'] },
  ],
};

export type ScoredLine = { fairOver: number; stat: string; features: Record<string, unknown>; nBooks: number; bookDispersion: number | null };

/** P(over) from the model. Combos use the market terms and features only (no per-stat bias). */
export function scoreOver(c: ModelCoefs, l: ScoredLine): number {
  const t = (name: string) => c.theta[name] ?? 0;
  let z = t('a') * logit(l.fairOver) + t('b');
  if ((BASE_STATS as readonly string[]).includes(l.stat)) z += t(`b_${l.stat}`);
  for (const f of c.features) {
    if (f.stats && !f.stats.includes(l.stat)) continue;
    z += t(f.name) * (Number(l.features[f.key] ?? 0) || 0);
  }
  z += t('n_books') * ((l.nBooks - c.controls.booksMean) / c.controls.booksSd);
  z += t('book_dispersion') * (((l.bookDispersion ?? 0) - c.controls.dispMean) / c.controls.dispSd);
  return 1 / (1 + Math.exp(-z));
}

/** The de-vigged consensus P(over) at the main line with one book left out (median of power fairs). */
export function fairExcluding(quotes: LoggedQuote[], mainLine: number, excludeBook: string | null): number | null {
  const fairs = quotes
    .filter((q) => q.book !== excludeBook && q.line === mainLine && q.over && q.under && q.coherent)
    .map((q) => fairTwoWay(q.over!, q.under!)?.[0])
    .filter((p): p is number => p != null && Number.isFinite(p));
  return median(fairs);
}

export type PriceMemory = Record<string, { over: number | null; under: number | null; seenAt: string }>;

/**
 * Phantom-price rule: the same price at that book on an earlier poll at least `minGapMs` before,
 * the book's own scrape time within `maxSourceAgeMs` of now, and a coherent over/under pair there.
 */
export function priceConfirmed(opts: {
  quote: LoggedQuote;
  side: 'over' | 'under';
  previous: PriceMemory | undefined;
  nowMs: number;
  minGapMs: number;
  maxSourceAgeMs: number;
}): boolean {
  const { quote, side, previous, nowMs } = opts;
  const price = quote[side];
  const before = previous?.[quote.book];
  if (!price || !before || before[side] !== price) return false;
  if (nowMs - Date.parse(before.seenAt) < opts.minGapMs) return false;
  if (!quote.sourceTs || nowMs - Date.parse(quote.sourceTs) > opts.maxSourceAgeMs) return false;
  return quote.coherent !== false;
}

/** Near tip polls come every few minutes; earlier, the AU feed itself only refreshes every ~10-25. */
export function confirmationGaps(msToTip: number): { minGapMs: number; maxSourceAgeMs: number } {
  const near = msToTip <= 2 * 60 * 60 * 1000;
  return { minGapMs: (near ? 2 : 5) * 60_000, maxSourceAgeMs: (near ? 15 : 30) * 60_000 };
}

export type WouldBe = { side: 'over' | 'under'; price: number; book: string; prob: number; fair: number; ev: number; confirmed: boolean };

/**
 * The would-be bet on one line under a policy: each side at its best AU price, judged with the fair
 * price excluding that book. The side with the higher EV is kept if it clears the minimum.
 */
export function decide(opts: {
  coefs: ModelCoefs;
  line: Omit<ScoredLine, 'fairOver'> & { mainLine: number; quotes: LoggedQuote[] };
  best: { over: { price: number; book: string } | null; under: { price: number; book: string } | null };
  confirmed: (side: 'over' | 'under', book: string) => boolean;
}): WouldBe | null {
  const out: WouldBe[] = [];
  for (const side of ['over', 'under'] as const) {
    const b = opts.best[side];
    if (!b) continue;
    const fair = fairExcluding(opts.line.quotes, opts.line.mainLine, b.book);
    if (fair == null) continue;
    const pOver = scoreOver(opts.coefs, { ...opts.line, fairOver: fair });
    const prob = side === 'over' ? pOver : 1 - pOver;
    out.push({ side, price: b.price, book: b.book, prob, fair, ev: prob * b.price - 1, confirmed: opts.confirmed(side, b.book) });
  }
  const best = out.sort((x, y) => y.ev - x.ev)[0];
  return best && best.ev >= opts.coefs.minEv ? best : null;
}
