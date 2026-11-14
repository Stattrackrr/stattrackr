/**
 * The shadow arms: frozen research policies that all judge the same logged snapshots, quotes and
 * inputs, each recording its own would-be bets. Nothing here posts. An arm's rules and constants
 * are fixed for the life of its versions; changing any of them means new versions and a new sample.
 *
 *   A  control / residual clock   v0-market, shadow-v0.1. The market as it is, exactly as before this
 *      file existed. When the fit gate passes (out-of-fold lift over the raw market with lo > 0 on at
 *      least 10 ET dates and 300 graded t2h lines), fitted coefficients go in under a new model_version.
 *   B  role-shock                 bets only when tonight's minutes or usage input is in its top decile,
 *      and only on the side the shock points to.
 *   C  news-lag                   bets when the US books or a teammate's injury status moved and an
 *      Australian price that was up before the move is still there.
 *   D  process-clean shopping     the honest line-shopping baseline: confirmed price, real consensus.
 *
 * Rows from different arms never collide: nba_shadow_bets is unique on (policy, policy_version,
 * trigger_snapshot_id, side) and every arm has its own policy_version.
 *
 * Gates (lib/nba/model/fitGate.ts, lib/nba/model/report.ts), the same for every arm:
 *   promote coefficients: >= 10 ET dates, >= 300 graded t2h lines, out-of-fold lift vs raw market lo > 0;
 *   reopen (live use):    measured sample reached, CLV (b) lo99 > 0 and total lo99 > 0, calibration
 *                         holds for overs and unders. Positive total from (a) alone does not reopen;
 *   futility:             total CLV hi95 below +1%.
 */

import { isAussieBook } from '@/lib/aiPicks/candidates/types';
import { fairAtLine, sizeFromSpread } from '@/lib/nba/model/clv';
import type { LoggedQuote } from './lines';
import { decide, fairExcluding, MODEL_V0, scoreOver, type ModelCoefs, type WouldBe } from './shadowRules';

export type ArmId = 'A' | 'B' | 'C' | 'D';
/** The snapshot kinds a would-be bet can be decided on. */
export type TriggerKind = 't2h' | 'injury_change' | 'us_move';
type Side = 'over' | 'under';

/** Arm A. Bumped whenever its policy or coefficients change; each version is its own evaluation sample. */
/** shadow-v0.1: news fires only on real designation moves for players with props, one bet per line per game. */
export const SHADOW_POLICY_VERSION = 'shadow-v0.1';
export const ACTIVE_COEFS: ModelCoefs = MODEL_V0;

// Frozen 15 Nov 2026. Thresholds come from the inputs' own spread and from bet counts on 13,583
// graded t2h lines recomputed with the inputs-v6 fixes; no results were read to pick them.

/** Arms B, C and D need this many books with a coherent two-way price at the main line. */
export const ARM_MIN_BOOKS = 4;
/** Arm B: top decile of |minutes_new_info_z| (90th percentile 0.178). */
export const B_MINUTES_Z_MIN = 0.18;
/** Arm B: top decile of usage_shift_z over every line (90th percentile 0.048). */
export const B_USAGE_Z_MIN = 0.05;
/**
 * Arm B: the price must be at least the market's fair price with the bet book left out. Not higher:
 * until fitted coefficients are promoted the arm scores with the market itself, so a higher bar is a
 * shopping bar, and at +5% the arm found under 2 lines a night (about 9 at this bar). Its edge has to
 * show up as CLV (b).
 */
export const B_MIN_EV = 0;
/** Arm C: EV at the stale Australian price against the US books' fair after the move. */
export const C_MIN_EV = 0.03;
/** Arm C: a teammate's status change counts as fresh for this many minutes. */
export const C_NEWS_MAX_AGE_MIN = 15;
/** Arm D: the same flat bar as arm A, so the two differ only in process. */
export const D_MIN_EV = 0.03;
/** Arm D: an edge this large over 4+ books is a feed error, as in the live rules. */
export const D_MAX_EV = 0.2;

const B_COEFS: ModelCoefs = { ...MODEL_V0, version: 'b-role-v1', minEv: B_MIN_EV };
const C_COEFS: ModelCoefs = { ...MODEL_V0, version: 'c-lag-v1', minEv: C_MIN_EV };
const D_COEFS: ModelCoefs = { ...MODEL_V0, version: 'd-shop-v1', minEv: D_MIN_EV };

/** Both US reference books' main line and fair over-price before and after a move. */
export type UsMoveInfo = {
  movedAt: string | null;
  books: Array<{ from: { line: number; fairOver: number }; to: { line: number; fairOver: number } }>;
};

export type ArmLine = { stat: string; features: Record<string, unknown>; nBooks: number; bookDispersion: number | null; mainLine: number; quotes: LoggedQuote[] };

export type ArmInput = {
  trigger: TriggerKind;
  line: ArmLine;
  /** The top Australian price on each side, confirmed or not. */
  best: { over: { price: number; book: string } | null; under: { price: number; book: string } | null };
  /** Phantom-price rule for a book's current price on a side. */
  confirmed: (side: Side, book: string) => boolean;
  /** When a book's current price on a side was first seen (ms); null if it is new or changed since the last poll. */
  seenSince: (side: Side, book: string) => number | null;
  /** DraftKings / FanDuel fair over-price at the main line on the stored board. */
  fairOverUs: number | null;
  usMove?: UsMoveInfo | null;
  nowMs: number;
};

/** A would-be bet with the arm's reason for it (stored with the bet). */
export type ArmBet = WouldBe & { tags: Record<string, unknown> };

export type Arm = {
  id: ArmId;
  name: string;
  purpose: string;
  policyVersion: string;
  coefs: ModelCoefs;
  triggers: readonly TriggerKind[];
  decide: (input: ArmInput) => ArmBet | null;
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** The best Australian price on a side at the main line that passes `ok` (best first). */
export function bestAuPrice(line: ArmLine, side: Side, ok: (book: string) => boolean): { price: number; book: string } | null {
  const top = line.quotes
    .filter((q) => q.line === line.mainLine && isAussieBook(q.book) && q[side] != null && q[side]! > 1 && ok(q.book))
    .sort((a, b) => b[side]! - a[side]!)[0];
  return top ? { price: top[side]!, book: top.book } : null;
}

/** One side at one price: the fair with that book left out, the arm's probability, and the EV. */
function priced(line: ArmLine, side: Side, at: { price: number; book: string }, probOver: (fairOver: number) => number): WouldBe | null {
  const fair = fairExcluding(line.quotes, line.mainLine, at.book);
  if (fair == null) return null;
  const pOver = probOver(fair);
  const prob = side === 'over' ? pOver : 1 - pOver;
  return { side, price: at.price, book: at.book, prob, fair, ev: prob * at.price - 1, confirmed: true };
}

/** Arm A: today's rule, untouched (see decide in shadowRules.ts). Unconfirmed prices are recorded and flagged. */
function decideControl(input: ArmInput): ArmBet | null {
  const bet = decide({ coefs: ACTIVE_COEFS, line: input.line, best: input.best, confirmed: input.confirmed });
  return bet ? { ...bet, tags: {} } : null;
}

/** Which way tonight's role information points for a line: up, down, or neither (also when the two inputs disagree). */
export function roleShock(features: Record<string, unknown>): { side: Side; shock: 'minutes_up' | 'usage_up' | 'minutes_down'; minutesZ: number; usageZ: number } | null {
  const minutesZ = num(features.minutes_new_info_z);
  if (minutesZ == null) return null;
  const usageZ = num(features.usage_shift_z) ?? 0;
  const up = minutesZ >= B_MINUTES_Z_MIN || usageZ >= B_USAGE_Z_MIN;
  const down = minutesZ <= -B_MINUTES_Z_MIN;
  if (up === down) return null;
  return { side: up ? 'over' : 'under', shock: down ? 'minutes_down' : minutesZ >= B_MINUTES_Z_MIN ? 'minutes_up' : 'usage_up', minutesZ, usageZ };
}

/**
 * Arm B, role-shock. Main decision point only. The line must carry an extreme minutes or usage
 * input; the bet is on the side it points to, at the best confirmed Australian price, when that
 * price is no worse than the arm's probability says is fair.
 */
function decideRoleShock(input: ArmInput): ArmBet | null {
  const shock = roleShock(input.line.features);
  if (!shock || input.line.nBooks < ARM_MIN_BOOKS) return null;
  const at = bestAuPrice(input.line, shock.side, (book) => input.confirmed(shock.side, book));
  const bet = at && priced(input.line, shock.side, at, (fairOver) => scoreOver(B_COEFS, { ...input.line, fairOver }));
  if (!bet || bet.ev < B_MIN_EV) return null;
  return { ...bet, tags: { reason: shock.shock, minutes_z: shock.minutesZ, usage_z: shock.usageZ } };
}

/**
 * The information in a US move: +1 when both books now expect more from the player (line up, or the
 * over shorter at the same line), -1 for less, 0 when they disagree or one of them did not move.
 */
export function usInfoDirection(move: UsMoveInfo): -1 | 0 | 1 {
  const dirs = move.books.map((b) => Math.sign(b.to.line !== b.from.line ? b.to.line - b.from.line : b.to.fairOver - b.from.fairOver));
  return dirs.length >= 2 && dirs[0] !== 0 && dirs.every((d) => d === dirs[0]) ? (dirs[0] as -1 | 1) : 0;
}

/** The US books' fair over-price after a move, carried to the Australian main line (average of the books). */
export function usFairAtLine(move: UsMoveInfo, mainLine: number, projection: { mean?: unknown; sd?: unknown } | undefined): number | null {
  const mean = num(projection?.mean);
  const sd = num(projection?.sd);
  const fairs: number[] = [];
  for (const b of move.books) {
    if (b.to.line === mainLine && !Number.isInteger(mainLine)) {
      fairs.push(b.to.fairOver);
      continue;
    }
    if (mean == null || sd == null || !(mean > 0) || !(sd > 0)) return null;
    const p = fairAtLine(b.to.fairOver, b.to.line, mainLine, sizeFromSpread(mean, sd * sd));
    if (!(p.over + p.under > 0)) return null;
    fairs.push(p.over / (p.over + p.under));
  }
  return fairs.length ? fairs.reduce((a, v) => a + v, 0) / fairs.length : null;
}

/**
 * Arm C, news-lag. Fires on event snapshots only. Something moved (both US books, or a rotation
 * teammate's injury status within the last C_NEWS_MAX_AGE_MIN minutes); the bet is on the side the
 * move points to, at an Australian price that was already up before the move, passes the
 * phantom-price rule, and still pays C_MIN_EV against the US books' fair.
 */
function decideNewsLag(input: ArmInput): ArmBet | null {
  if (input.line.nBooks < ARM_MIN_BOOKS) return null;
  const f = input.line.features;
  let side: Side;
  let usFairOver: number | null;
  let movedMs: number;
  let tags: Record<string, unknown>;
  if (input.trigger === 'us_move') {
    if (!input.usMove) return null;
    const dir = usInfoDirection(input.usMove);
    if (!dir) return null;
    side = dir > 0 ? 'over' : 'under';
    usFairOver = usFairAtLine(input.usMove, input.line.mainLine, f.projection as { mean?: unknown; sd?: unknown } | undefined);
    const at = input.usMove.movedAt ? Date.parse(input.usMove.movedAt) : NaN;
    movedMs = Number.isFinite(at) ? Math.min(at, input.nowMs) : input.nowMs;
    tags = { reason: 'us_move', us_dir: dir, us_to: input.usMove.books.map((b) => b.to) };
  } else if (input.trigger === 'injury_change') {
    const ageLn = num(f.teammate_news_age_ln);
    const dir = num(f.teammate_news_dir);
    if (ageLn == null || !dir || ageLn > Math.log1p(C_NEWS_MAX_AGE_MIN)) return null;
    side = dir > 0 ? 'over' : 'under';
    usFairOver = input.fairOverUs;
    movedMs = input.nowMs - Math.expm1(ageLn) * 60_000;
    tags = { reason: 'teammate_news', news_dir: dir, news_age_ln: ageLn, news_player: f.teammate_news_id ?? null };
  } else {
    return null;
  }
  if (usFairOver == null) return null;
  const pOver = usFairOver;
  const stale = (book: string) => {
    const since = input.seenSince(side, book);
    return since != null && since <= movedMs && input.confirmed(side, book);
  };
  const at = bestAuPrice(input.line, side, stale);
  const bet = at && priced(input.line, side, at, () => pOver);
  if (!bet || bet.ev < C_MIN_EV) return null;
  return { ...bet, tags: { ...tags, us_fair_over: r4(pOver) } };
}

/**
 * Arm D, process-clean shopping. Main decision point only: the best confirmed Australian price on
 * each side against the fair with that book left out, a consensus of ARM_MIN_BOOKS or more, one flat
 * EV bar and a ceiling. No inputs, no projection.
 */
function decideShopping(input: ArmInput): ArmBet | null {
  if (input.line.nBooks < ARM_MIN_BOOKS) return null;
  const sides = (['over', 'under'] as const)
    .map((side) => {
      const at = bestAuPrice(input.line, side, (book) => input.confirmed(side, book));
      return at && priced(input.line, side, at, (fairOver) => scoreOver(D_COEFS, { ...input.line, fairOver }));
    })
    .filter((b): b is WouldBe => b != null)
    .sort((x, y) => y.ev - x.ev);
  const bet = sides[0];
  return bet && bet.ev >= D_MIN_EV && bet.ev <= D_MAX_EV ? { ...bet, tags: { reason: 'price' } } : null;
}

export const ARMS: readonly Arm[] = [
  {
    id: 'A',
    name: 'control',
    purpose: 'The 8-week residual experiment: the market as it is until the fit gate promotes coefficients.',
    policyVersion: SHADOW_POLICY_VERSION,
    coefs: ACTIVE_COEFS,
    triggers: ['t2h', 'injury_change'],
    decide: decideControl,
  },
  {
    id: 'B',
    name: 'role-shock',
    purpose: "Bets only when tonight's minutes or usage input is extreme, on the side it points to.",
    policyVersion: 'arm-b-role-v1',
    coefs: B_COEFS,
    triggers: ['t2h'],
    decide: decideRoleShock,
  },
  {
    id: 'C',
    name: 'news-lag',
    purpose: 'Australian prices that have not followed a US move or a teammate status change.',
    policyVersion: 'arm-c-lag-v1',
    coefs: C_COEFS,
    triggers: ['injury_change', 'us_move'],
    decide: decideNewsLag,
  },
  {
    id: 'D',
    name: 'clean-shopping',
    purpose: 'Honest line-shopping baseline: confirmed price against a real consensus, nothing else.',
    policyVersion: 'arm-d-shop-v1',
    coefs: D_COEFS,
    triggers: ['t2h'],
    decide: decideShopping,
  },
];

export const armById = (id: ArmId): Arm => ARMS.find((a) => a.id === id)!;
