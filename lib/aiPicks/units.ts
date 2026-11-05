/**
 * Stake sizing. Flat until the model's probabilities are shown to be calibrated: Kelly on overstated
 * probabilities stakes most on the worst bets, so every single is 1 unit, half a unit on long prices.
 */

import type { Proposal } from '@/lib/aiPicks/decide/select';
import { clamp } from '@/lib/aiPicks/model/math';
import { AI_PICK_UNITS } from '@/lib/aiPicks/types';

export type TrackRecord = { settled: number; recentRoi: number | null; recentPicks: number };

const MIN_UNITS = AI_PICK_UNITS[0];
const MAX_UNITS = AI_PICK_UNITS[AI_PICK_UNITS.length - 1];

export const FLAT_UNITS = 1;
export const LONG_PRICE_UNITS = 0.5;
/** Prices above this stake LONG_PRICE_UNITS. */
export const LONG_PRICE = 2.5;

/** Full Kelly stake as a bankroll share; a push returns the stake. */
export function kellyStake(prob: number, price: number, pushProb = 0): number {
  const b = price - 1;
  if (!(b > 0)) return 0;
  const q = Math.max(0, 1 - prob - pushProb);
  return Math.max(0, (prob * b - q) / b);
}

export function snapUnits(raw: number): number {
  return clamp(Math.round(raw * 2) / 2, MIN_UNITS, MAX_UNITS);
}

export function sizeUnits(p: Pick<Proposal, 'price'>): { units: number; why: string } {
  return p.price > LONG_PRICE
    ? { units: LONG_PRICE_UNITS, why: `Flat stake: ${LONG_PRICE_UNITS}u above $${LONG_PRICE.toFixed(2)}` }
    : { units: FLAT_UNITS, why: `Flat stake: ${FLAT_UNITS}u` };
}

/** Per-sport record from settled picks: all-time count and the last `recentDays` ROI. */
export function trackRecords(
  picks: Array<{ sport: string; status: string; units: number; profitUnits: number | null; postedAt: string }>,
  nowMs: number,
  recentDays = 30
): Record<string, TrackRecord> {
  const out: Record<string, TrackRecord & { staked: number; profit: number }> = {};
  const since = nowMs - recentDays * 86_400_000;
  for (const pick of picks) {
    if (pick.status === 'pending' || pick.status === 'void') continue;
    const r = (out[pick.sport] ??= { settled: 0, recentRoi: null, recentPicks: 0, staked: 0, profit: 0 });
    r.settled += 1;
    if (Date.parse(pick.postedAt) >= since) {
      r.recentPicks += 1;
      r.staked += pick.units;
      r.profit += pick.profitUnits ?? 0;
    }
  }
  return Object.fromEntries(
    Object.entries(out).map(([sport, r]) => [
      sport,
      { settled: r.settled, recentPicks: r.recentPicks, recentRoi: r.staked > 0 ? r.profit / r.staked : null },
    ])
  );
}
