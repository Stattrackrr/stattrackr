/**
 * The weekly proof report (agreed build spec, Part E). Pure: takes the would-be bets with their CLV,
 * price checks and results, and returns the metrics and what the pre-registered rules say.
 *
 *   Primary: CLV at the posted, confirmed price (total, and its parts (a) price vs decision fair and
 *            (b) fair drift to close), averaged per game and bootstrapped over games.
 *   Reported, never gating: CLV at +5/+10/+20 minutes, vanished share, same-line vs moved, k
 *            sensitivity, all-books close, realized flat return, calibration by side and stat.
 *   Rules: futility (95% upper bound of total CLV below +1%), reopen at n (99% one-sided lower bound
 *            above 0 for (b) and total, calibration holds for overs and unders), cap at the end of the
 *            regular season.
 */

import { clvSplit } from './clv';
import { gameBootstrap, type Interval } from './residual';

export type ReportBet = {
  id: string;
  game: string;
  /** ISO time the would-be bet was recorded. */
  at: string;
  policy: 'main' | 'news';
  side: 'over' | 'under';
  stat: string;
  line: number;
  price: number;
  /** Passed the phantom-price rule; only these count for the primary metric and the rules. */
  confirmed: boolean;
  /** Model P(side) and the market's fair P(over) at decision time. */
  modelProb: number;
  fairOver: number;
  clv: {
    total: number;
    a: number;
    b: number;
    sameLine: boolean;
    k: number | null;
    totalK08: number;
    totalK125: number;
    totalAllBooks: number | null;
    closeLine: number;
    closeFair: number;
  } | null;
  result: 'win' | 'loss' | 'push' | 'void' | null;
  check: { p5: number | null; p10: number | null; p20: number | null; vanished: boolean | null } | null;
};

export const TARGET_B = 0.015;
const Z_99 = 2.33;
const Z_80 = 0.84;
export const FUTILITY_FLOOR = 0.01;
export const MEASURE_DAYS = 14;

/** Interval plus the one-sided bounds the rules use. */
export type Bounds = Interval & { lo99: number; hi95: number };

function bounds(perGame: number[]): Bounds {
  const two = gameBootstrap(perGame, 0.95);
  const one = gameBootstrap(perGame, 0.98);
  return { ...two, lo99: one.lo, hi95: two.hi };
}

/** Per-game means of a per-bet value, so a game with many bets counts once. */
export function perGameMeans<T>(rows: T[], game: (r: T) => string, value: (r: T) => number | null): number[] {
  const by = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const v = value(r);
    if (v == null || !Number.isFinite(v)) continue;
    const g = by.get(game(r)) ?? { s: 0, n: 0 };
    g.s += v;
    g.n += 1;
    by.set(game(r), g);
  }
  return [...by.values()].map((g) => g.s / g.n);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/**
 * Design effect of clustering by game: the variance of the mean with bets grouped by game, over the
 * variance if every bet were independent. Never below 1.
 */
export function designEffect(values: Array<{ game: string; v: number }>): number {
  const m = mean(values.map((x) => x.v));
  const within = values.reduce((a, x) => a + (x.v - m) ** 2, 0);
  if (!within) return 1;
  const sums = new Map<string, number>();
  for (const x of values) sums.set(x.game, (sums.get(x.game) ?? 0) + (x.v - m));
  const clustered = [...sums.values()].reduce((a, s) => a + s * s, 0);
  return Math.max(1, clustered / within);
}

/** Bets needed for 80% power on a 99% one-sided lower bound above 0 if true (b) is +1.5%. */
export function sampleSize(sdB: number, de: number): number {
  return Math.ceil(de * (((Z_99 + Z_80) * sdB) / TARGET_B) ** 2);
}

/** Flat 1-unit return on a graded bet; null when ungraded. */
export function flatReturn(b: Pick<ReportBet, 'result' | 'price'>): number | null {
  if (b.result === 'win') return b.price - 1;
  if (b.result === 'loss') return -1;
  if (b.result === 'push' || b.result === 'void') return 0;
  return null;
}

export type CalibrationCell = { group: string; bets: number; predicted: number; actual: number; gap: Bounds };

/** Mean predicted P(side) against the hit rate on decided bets, with a game bootstrap of (hit - predicted). */
export function calibration(bets: ReportBet[], groupOf: (b: ReportBet) => string): CalibrationCell[] {
  const decided = bets.filter((b) => b.result === 'win' || b.result === 'loss');
  const groups = new Map<string, ReportBet[]>();
  for (const b of decided) groups.set(groupOf(b), [...(groups.get(groupOf(b)) ?? []), b]);
  return [...groups.entries()]
    .map(([group, rows]) => ({
      group,
      bets: rows.length,
      predicted: mean(rows.map((r) => r.modelProb)),
      actual: mean(rows.map((r) => (r.result === 'win' ? 1 : 0))),
      gap: bounds(perGameMeans(rows, (r) => r.game, (r) => (r.result === 'win' ? 1 : 0) - r.modelProb)),
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

/** CLV had the bet been taken at the +m minute price (null when that price was gone). */
export function clvAtLaterPrice(b: ReportBet, later: number | null): number | null {
  if (!b.clv || !later || b.clv.k == null) return null;
  return clvSplit({ side: b.side, price: later, line: b.line, fairNow: b.fairOver, lineNow: b.line, fairClose: b.clv.closeFair, lineClose: b.clv.closeLine, k: b.clv.k }).total;
}

export type Measurement = {
  status: 'provisional' | 'fixed';
  from: string | null;
  to: string | null;
  bets: number;
  games: number;
  sdB: number;
  designEffect: number;
  n: number;
  betsPerGame: number;
};

/** SD of (b) and the design effect from the first two weeks of bets; fixed once two weeks have passed. */
export function measureSampleSize(bets: ReportBet[], nowMs: number): Measurement {
  const withClv = bets.filter((b) => b.clv).sort((a, b) => a.at.localeCompare(b.at));
  const first = withClv[0]?.at ?? null;
  const end = first ? Date.parse(first) + MEASURE_DAYS * 86_400_000 : nowMs;
  const window = withClv.filter((b) => Date.parse(b.at) < end);
  const values = window.map((b) => ({ game: b.game, v: b.clv!.b }));
  const m = mean(values.map((x) => x.v));
  const sdB = values.length > 1 ? Math.sqrt(values.reduce((a, x) => a + (x.v - m) ** 2, 0) / (values.length - 1)) : NaN;
  const de = values.length > 1 ? designEffect(values) : NaN;
  const games = new Set(window.map((b) => b.game)).size;
  return {
    status: first && nowMs >= end ? 'fixed' : 'provisional',
    from: first,
    to: first ? new Date(Math.min(end, nowMs)).toISOString() : null,
    bets: window.length,
    games,
    sdB,
    designEffect: de,
    n: Number.isFinite(sdB) && Number.isFinite(de) ? sampleSize(sdB, de) : NaN,
    betsPerGame: games ? window.length / games : NaN,
  };
}

export type Verdict = {
  futility: { stop: boolean; upper95: number };
  reopen: { reached: boolean; ready: boolean; bLo99: number; totalLo99: number; calibrationHolds: boolean };
  cap: { gamesNeeded: number; gamesLeft: number; gamesWithBets: number; onPace: boolean };
  /** The responses written in advance that the numbers currently point to. */
  readings: string[];
};

export type Report = {
  generatedAt: string;
  policyVersion: string;
  modelVersion: string;
  counts: { bets: number; confirmed: number; withClv: number; graded: number; games: number; byPolicy: Record<string, number> };
  clv: { total: Bounds; a: Bounds; b: Bounds };
  reported: {
    clvAt5: Interval;
    clvAt10: Interval;
    clvAt20: Interval;
    vanishedShare: number;
    sameLine: Interval;
    lineMoved: Interval;
    kSensitivity: { k08: number; k1: number; k125: number };
    allBooksClose: Interval;
    /** Would-be bets whose price failed the phantom-price rule (not counted anywhere else). */
    unconfirmed: Interval;
    flatReturn: { units: number; bets: number; perBet: Bounds };
  };
  calibrationBySide: CalibrationCell[];
  calibrationByStat: CalibrationCell[];
  measurement: Measurement;
  verdict: Verdict;
};

export function buildReport(opts: {
  bets: ReportBet[];
  nowMs: number;
  /** Regular-season games from now to the end of the regular season. */
  gamesLeft: number;
  policyVersion: string;
  modelVersion: string;
}): Report {
  const { nowMs } = opts;
  const bets = opts.bets.filter((b) => b.confirmed);
  const unconfirmed = opts.bets.filter((b) => !b.confirmed && b.clv);
  const withClv = bets.filter((b) => b.clv);
  const by = (value: (b: ReportBet) => number | null, rows = withClv) => perGameMeans(rows, (b) => b.game, value);
  const clv = { total: bounds(by((b) => b.clv!.total)), a: bounds(by((b) => b.clv!.a)), b: bounds(by((b) => b.clv!.b)) };
  const checks = bets.filter((b) => b.check?.vanished != null);
  const returns = bets.map((b) => ({ b, r: flatReturn(b) })).filter((x): x is { b: ReportBet; r: number } => x.r != null);
  const bySide = calibration(bets, (b) => b.side);
  const byStat = calibration(bets, (b) => `${b.stat} ${b.side}`);
  const measurement = measureSampleSize(bets, nowMs);

  const gamesWithBets = new Set(withClv.map((b) => b.game)).size;
  const reached = Number.isFinite(measurement.n) && measurement.status === 'fixed' && withClv.length >= measurement.n;
  const calibrationHolds = ['over', 'under'].every((side) => {
    const cell = bySide.find((c) => c.group === side);
    return !cell || (cell.gap.lo <= 0 && cell.gap.hi >= 0);
  });
  const gamesNeeded = Number.isFinite(measurement.n) && measurement.betsPerGame > 0 ? Math.ceil(measurement.n / measurement.betsPerGame) : NaN;
  const readings: string[] = [];
  if (clv.total.lo > 0 && !(clv.b.lo > 0)) readings.push('Positive total CLV comes from (a), the price against the decision-time fair: line shopping, not a model edge. Do not reopen on it.');
  const at10 = gameBootstrap(by((b) => clvAtLaterPrice(b, b.check?.p10 ?? null)));
  if (clv.total.lo > 0 && !(at10.mean > 0)) readings.push('Edge at the posted price but not ten minutes later: the edge depends on speed. Reopen still uses posted-price CLV; post faster where the lag data says it matters.');

  return {
    generatedAt: new Date(nowMs).toISOString(),
    policyVersion: opts.policyVersion,
    modelVersion: opts.modelVersion,
    counts: {
      bets: opts.bets.length,
      confirmed: bets.length,
      withClv: withClv.length,
      graded: returns.length,
      games: new Set(bets.map((b) => b.game)).size,
      byPolicy: bets.reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.policy]: (acc[b.policy] ?? 0) + 1 }), {}),
    },
    clv,
    reported: {
      clvAt5: gameBootstrap(by((b) => clvAtLaterPrice(b, b.check?.p5 ?? null))),
      clvAt10: at10,
      clvAt20: gameBootstrap(by((b) => clvAtLaterPrice(b, b.check?.p20 ?? null))),
      vanishedShare: checks.length ? checks.filter((b) => b.check!.vanished).length / checks.length : NaN,
      sameLine: gameBootstrap(by((b) => (b.clv!.sameLine ? b.clv!.total : null))),
      lineMoved: gameBootstrap(by((b) => (b.clv!.sameLine ? null : b.clv!.total))),
      kSensitivity: { k08: mean(withClv.map((b) => b.clv!.totalK08)), k1: mean(withClv.map((b) => b.clv!.total)), k125: mean(withClv.map((b) => b.clv!.totalK125)) },
      allBooksClose: gameBootstrap(by((b) => b.clv!.totalAllBooks)),
      unconfirmed: gameBootstrap(by((b) => b.clv!.total, unconfirmed)),
      flatReturn: { units: returns.reduce((a, x) => a + x.r, 0), bets: returns.length, perBet: bounds(perGameMeans(returns, (x) => x.b.game, (x) => x.r)) },
    },
    calibrationBySide: bySide,
    calibrationByStat: byStat,
    measurement,
    verdict: {
      futility: { stop: clv.total.games >= 2 && clv.total.hi95 < FUTILITY_FLOOR, upper95: clv.total.hi95 },
      reopen: { reached, ready: reached && clv.b.lo99 > 0 && clv.total.lo99 > 0 && calibrationHolds, bLo99: clv.b.lo99, totalLo99: clv.total.lo99, calibrationHolds },
      cap: { gamesNeeded, gamesLeft: opts.gamesLeft, gamesWithBets, onPace: Number.isFinite(gamesNeeded) ? gamesNeeded - gamesWithBets <= opts.gamesLeft : true },
      readings,
    },
  };
}
