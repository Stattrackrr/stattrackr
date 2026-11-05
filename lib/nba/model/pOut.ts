/**
 * The chance a teammate sits tonight (agreed build spec, section 3). History has no injury reports,
 * so the history part uses what is always known before tip: team games missed in a row. The
 * report's designation dominates live; it can only be fitted from the
 * status changes logged from 30 Oct 2026, so until then it uses provisional values, marked as such.
 * Calibration is checked directly (Brier score, reliability by designation), not through CLV.
 */

export type POutInput = {
  /** Team games missed in a row right before tonight (0 = played the last one). */
  missedInRow: number;
  /** Logged for later fits; added nothing in history once games missed are known. */
  daysSinceLastGame?: number | null;
  /** The report's designation: out, doubtful, questionable, probable, day-to-day; null = not listed. */
  designation?: string | null;
  /** RotoWire's "may not play" tag. */
  mayNotPlay?: boolean;
};

/** Groups of team games missed in a row: 0, 1, 2, 3-5, 6+. */
export const MISSED_BINS = [0, 1, 2, 3, 6] as const;

export function missedBin(missedInRow: number): number {
  let bin = 0;
  MISSED_BINS.forEach((lo, i) => {
    if (missedInRow >= lo) bin = i;
  });
  return bin;
}

/** P(sits tonight) per missed-in-a-row group. */
export type POutHistoryRates = number[];

/** Rates per group with a light pull toward the overall rate, so thin groups are not extreme. */
export function fitPOutHistory(rows: Array<{ x: POutInput; missed: 0 | 1 }>, prior = 20): POutHistoryRates {
  const overall = rows.reduce((a, r) => a + r.missed, 0) / Math.max(1, rows.length);
  return MISSED_BINS.map((_, bin) => {
    const set = rows.filter((r) => missedBin(r.x.missedInRow) === bin);
    return (set.reduce((a, r) => a + r.missed, 0) + prior * overall) / (set.length + prior);
  });
}

/**
 * Fitted on 2025-26 rotation players (15+ minutes over their last 5 played; 23.8k player-games) by
 * scripts/_fit-pout.ts. A smooth curve on games missed under-predicted "missed one" by ~8 points, so
 * these are plain group rates (Brier 0.189 -> 0.118 out of sample). Late season runs higher than early
 * (more rest): 0 missed was 7% in Nov-Jan and 11% in Feb-Apr, 6+ missed 83% and 93%.
 */
export const HISTORY_POUT_RATES: POutHistoryRates = [0.091, 0.455, 0.674, 0.824, 0.885];

/**
 * Provisional: the report's designation, until the logged status changes are enough to fit it.
 * Out is near certain; probable rarely sits; questionable is close to a coin flip.
 */
export const PROVISIONAL_DESIGNATION_POUT: Record<string, number> = {
  out: 0.98,
  doubtful: 0.85,
  questionable: 0.45,
  'day-to-day': 0.3,
  probable: 0.08,
};

export function pOut(x: POutInput, history: POutHistoryRates = HISTORY_POUT_RATES): { p: number; basis: 'designation' | 'history' } {
  const designated = x.designation ? PROVISIONAL_DESIGNATION_POUT[x.designation] : undefined;
  if (designated != null) return { p: designated, basis: 'designation' };
  const p = history[missedBin(x.missedInRow)]!;
  return { p: x.mayNotPlay ? Math.max(p, 0.3) : p, basis: 'history' };
}
