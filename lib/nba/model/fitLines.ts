/**
 * Fits the residual model on logged, graded lines (agreed build spec, Part D): decision-time (t2h)
 * base-stat lines, the market's fair as the anchor, the pre-registered v1 features. Returns
 * coefficients in the shape the shadow policy scores with, and the out-of-fold lift over the market
 * both at decision time and at close (lift that is gone by close is the latency signature, Part E).
 */

import type { ModelCoefs } from '@/lib/nba/propLog/shadowRules';
import { BASE_STATS, buildDesign, CANDIDATE_FEATURES, marketOnlyDesign, modelSpec, V1_FEATURES, type ModelLine, type ModelSpec } from './design';
import { fitResidual, fitWithCv, lambdasFor, liftOverBaseline, predict, type Design, type Interval } from './residual';

/** Below this, a fit is noise; the report says so instead. */
export const MIN_FIT_LINES = 300;
export const MIN_FIT_DATES = 10;
const FOLDS = 5;

const etDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export type SnapshotRow = {
  game_id: string;
  player_id: string;
  stat: string;
  tip_at: string;
  fair_over_all: number | null;
  n_books: number;
  book_dispersion: number | null;
  features: Record<string, unknown> | null;
  result_over: string | null;
};

export const COMBO_STATS = ['pra', 'pr', 'pa', 'ra'] as const;

/** Numeric inputs a logged line carries: v1 and every library candidate (true/false as 1/0), plus derived ones. */
function numericFeatures(f: Record<string, unknown>): Record<string, number | null> {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null);
  const derived: Record<string, unknown> = {
    bp_dvp_rank: (f.bpDvp as { rank?: unknown } | undefined)?.rank,
    ref_fta_player: num(f.ref_fta_z) != null && num(f.fta_share) != null ? num(f.ref_fta_z)! * num(f.fta_share)! : null,
  };
  const keys = new Set([...V1_FEATURES.map((s) => s.key), ...CANDIDATE_FEATURES.map((s) => s.key)]);
  return Object.fromEntries([...keys].map((k) => [k, num(k in derived ? derived[k] : f[k])]));
}

export function toModelLine(r: SnapshotRow, opts: { combos?: boolean } = {}): ModelLine | null {
  if (r.result_over !== 'win' && r.result_over !== 'loss') return null;
  const allowed: readonly string[] = opts.combos ? [...BASE_STATS, ...COMBO_STATS] : BASE_STATS;
  if (r.fair_over_all == null || !allowed.includes(r.stat)) return null;
  return {
    y: r.result_over === 'win' ? 1 : 0,
    fairOver: Number(r.fair_over_all),
    stat: r.stat,
    features: numericFeatures(r.features ?? {}),
    game: r.game_id,
    subject: r.player_id,
    date: etDate(r.tip_at),
    nBooks: Number(r.n_books),
    bookDispersion: r.book_dispersion == null ? null : Number(r.book_dispersion),
  };
}

/**
 * Out-of-fold predictions for another set of rows (close lines): each test row is scored by a fit on
 * decision-time rows from date blocks strictly before its own.
 */
function walkForwardOnto(train: Design, test: Design, scale: number, folds = FOLDS): Array<number | null> {
  const dates = [...new Set(train.rows.map((r) => r.date))].sort();
  const size = Math.ceil(dates.length / folds);
  const out: Array<number | null> = test.rows.map(() => null);
  for (let i = size; i < dates.length; i += size) {
    const cut = dates[i]!;
    const next = dates[i + size] ?? '\uffff';
    const rows = train.rows.filter((r) => r.date < cut);
    if (!rows.length) continue;
    const t = { params: train.params, rows };
    const theta = fitResidual(t, lambdasFor(t, scale));
    test.rows.forEach((r, j) => {
      if (r.date >= cut && r.date < next) out[j] = predict(theta, r.x);
    });
  }
  return out;
}

export type LoggedFit =
  | { status: 'insufficient'; lines: number; dates: number; needLines: number; needDates: number }
  | {
      status: 'fitted';
      lines: number;
      games: number;
      dates: number;
      scale: number;
      coefs: ModelCoefs;
      /** Positive = the model beats the market (log loss per line, averaged per game). */
      liftVsMarket: Interval;
      liftVsFittedMarket: Interval;
      liftAtClose: Interval | null;
    };

export function fitLines(lines: ModelLine[], closeLines: ModelLine[] = [], version = `v1-${new Date().toISOString().slice(0, 10)}`): LoggedFit {
  const dates = new Set(lines.map((l) => l.date)).size;
  if (lines.length < MIN_FIT_LINES || dates < MIN_FIT_DATES) return { status: 'insufficient', lines: lines.length, dates, needLines: MIN_FIT_LINES, needDates: MIN_FIT_DATES };
  const spec: ModelSpec = modelSpec(lines);
  const design = buildDesign(lines, spec);
  const fit = fitWithCv(design, FOLDS);
  const market = fitWithCv(marketOnlyDesign(lines, spec), FOLDS);
  const raw = design.rows.map((_, i) => (fit.oof[i] == null ? null : lines[i]!.fairOver));
  const fittedMarket = market.oof.map((p, i) => (fit.oof[i] == null ? null : p));
  let liftAtClose: Interval | null = null;
  if (closeLines.length) {
    const closeDesign = buildDesign(closeLines, spec);
    const oofClose = walkForwardOnto(design, closeDesign, fit.scale);
    liftAtClose = liftOverBaseline(closeDesign, oofClose, closeLines.map((l, i) => (oofClose[i] == null ? null : l.fairOver)));
  }
  return {
    status: 'fitted',
    lines: lines.length,
    games: new Set(lines.map((l) => l.game)).size,
    dates,
    scale: fit.scale,
    coefs: {
      version,
      theta: Object.fromEntries(spec.params.map((p, j) => [p.name, Math.round(fit.theta[j]! * 1e6) / 1e6])),
      controls: spec.controls,
      minEv: 0.03,
      features: V1_FEATURES.map((f) => ({ name: f.name, key: f.key, ...(f.stats ? { stats: f.stats } : {}) })),
    },
    liftVsMarket: liftOverBaseline(design, fit.oof, raw),
    liftVsFittedMarket: liftOverBaseline(design, fit.oof, fittedMarket),
    liftAtClose,
  };
}
