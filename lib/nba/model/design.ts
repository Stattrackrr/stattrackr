/**
 * Logged NBA lines turned into the residual model's design (agreed build spec, Part D): the market's
 * logit, the over/under bias overall and per stat, the pre-registered v1 features in z-units with
 * their sign bounds, and the n_books / book-dispersion controls. Each player-game's lines share one
 * unit of weight, so a player's points and rebounds lines do not count twice.
 */

import { logit, type Design, type DesignRow, type Param } from './residual';

/** Fitted on base stats only; combos are scored out of sample. */
export const BASE_STATS = ['points', 'rebounds', 'assists', 'threeMade'] as const;
export type BaseStat = (typeof BASE_STATS)[number];

export type FeatureSpec = {
  name: string;
  /** Key in the line's feature values. */
  key: string;
  /** 0 when the direction is known (more minutes can only help an over); omitted = free. */
  lower?: number;
  /** Stats the column applies to (zero elsewhere); omitted = every stat. */
  stats?: readonly BaseStat[];
};

/** Pre-registered v1: minutes and usage only. Everything else is added one at a time, only with lift. */
export const V1_FEATURES: readonly FeatureSpec[] = [
  { name: 'minutes_new_info', key: 'minutes_new_info_z', lower: 0 },
  { name: 'usage_shift', key: 'usage_shift_z', lower: 0, stats: ['points', 'assists', 'threeMade'] },
  { name: 'usage_shift_reb', key: 'usage_shift_z', stats: ['rebounds'] },
];

export type ModelLine = {
  y: 0 | 1;
  /** De-vigged consensus P(over) at decision time, bet book excluded. */
  fairOver: number;
  stat: BaseStat;
  features: Record<string, number | null | undefined>;
  game: string;
  /** Player id: lines of one player in one game share a unit of weight. */
  subject: string;
  date: string;
  nBooks: number;
  bookDispersion: number | null;
};

export type ModelSpec = { params: Param[]; features: readonly FeatureSpec[]; controls: { booksMean: number; booksSd: number; dispMean: number; dispSd: number } };

const sd = (xs: number[], mean: number) => Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1)) || 1;

export function modelSpec(lines: ModelLine[], features: readonly FeatureSpec[] = V1_FEATURES): ModelSpec {
  const books = lines.map((l) => l.nBooks);
  const disp = lines.map((l) => l.bookDispersion ?? 0);
  const booksMean = books.reduce((a, b) => a + b, 0) / Math.max(1, books.length);
  const dispMean = disp.reduce((a, b) => a + b, 0) / Math.max(1, disp.length);
  const params: Param[] = [
    { name: 'a', center: 1, group: 'a' },
    { name: 'b', center: 0, group: 'b' },
    ...BASE_STATS.map((s): Param => ({ name: `b_${s}`, center: 0, group: 'bStat' })),
    ...features.map((f): Param => ({ name: f.name, center: 0, group: 'c', ...(f.lower != null ? { lower: f.lower } : {}) })),
    { name: 'n_books', center: 0, group: 'control' },
    { name: 'book_dispersion', center: 0, group: 'control' },
  ];
  return { params, features, controls: { booksMean, booksSd: sd(books, booksMean), dispMean, dispSd: sd(disp, dispMean) } };
}

/** One line as a row of the design, in param order. */
export function lineVector(spec: ModelSpec, l: Pick<ModelLine, 'fairOver' | 'stat' | 'features' | 'nBooks' | 'bookDispersion'>): number[] {
  const c = spec.controls;
  return [
    logit(l.fairOver),
    1,
    ...BASE_STATS.map((s) => (s === l.stat ? 1 : 0)),
    ...spec.features.map((f) => (f.stats && !f.stats.includes(l.stat) ? 0 : Number(l.features[f.key] ?? 0) || 0)),
    (l.nBooks - c.booksMean) / c.booksSd,
    ((l.bookDispersion ?? 0) - c.dispMean) / c.dispSd,
  ];
}

export function buildDesign(lines: ModelLine[], spec: ModelSpec = modelSpec(lines)): Design {
  const perSubject = new Map<string, number>();
  for (const l of lines) perSubject.set(`${l.game}|${l.subject}`, (perSubject.get(`${l.game}|${l.subject}`) ?? 0) + 1);
  const rows: DesignRow[] = lines.map((l) => ({
    x: lineVector(spec, l),
    y: l.y,
    w: 1 / perSubject.get(`${l.game}|${l.subject}`)!,
    game: l.game,
    date: l.date,
  }));
  return { params: spec.params, rows };
}

/** The market-only baselines for the lift test: a = 1, b = 0 (the fair price itself), and a, b fitted. */
export function marketOnlySpec(spec: ModelSpec): ModelSpec {
  return { ...spec, params: spec.params.filter((p) => p.name === 'a' || p.name === 'b'), features: [] };
}

export function marketOnlyDesign(lines: ModelLine[], spec: ModelSpec): Design {
  const d = buildDesign(lines, spec);
  return { params: spec.params.filter((p) => p.name === 'a' || p.name === 'b'), rows: d.rows.map((r) => ({ ...r, x: r.x.slice(0, 2) })) };
}
