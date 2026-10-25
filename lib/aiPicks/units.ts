/**
 * Stake sizing on the 0.5-3 unit ladder. Quarter Kelly with one unit as 1% of a bankroll sets the
 * size from the edge and price; support, the learned per-market scale and the AI's own track record
 * pull it down. A sport must prove itself over its first picks before staking big, and a bad
 * recent run drops everything to 1 unit.
 */

import type { Proposal } from '@/lib/aiPicks/decide/select';
import { clamp } from '@/lib/aiPicks/model/math';
import { modelGroup, paramsForSport, type AiPicksParams } from '@/lib/aiPicks/params';
import { AI_PICK_UNITS } from '@/lib/aiPicks/types';

export type TrackRecord = { settled: number; recentRoi: number | null; recentPicks: number };

const MIN_UNITS = AI_PICK_UNITS[0];
const MAX_UNITS = AI_PICK_UNITS[AI_PICK_UNITS.length - 1];

/** Full Kelly stake as a bankroll share; a push returns the stake. */
export function kellyStake(prob: number, price: number, pushProb = 0): number {
  const b = price - 1;
  if (!(b > 0)) return 0;
  const q = Math.max(0, 1 - prob - pushProb);
  return Math.max(0, (prob * b - q) / b);
}

function supportFactor(score: number | null): number {
  if (score == null) return 0.85;
  if (score >= 0.7) return 1;
  if (score >= 0.6) return 0.9;
  return 0.8;
}

/** Long prices lose more often; their stake is capped however big the edge looks. */
export function priceCap(price: number): number {
  if (price > 2.7) return 0.5;
  if (price > 2.2) return 1;
  return MAX_UNITS;
}

/** Best price this far above the shortest book on the same line usually means a stale or wrong price. */
const BOOK_SPREAD_LIMIT = 1.25;

/** Best price over the shortest price quoted for this selection (1 with fewer than two books). */
export function bookSpread(quotes: Array<{ price: number }>): number {
  const prices = quotes.map((q) => q.price).filter((p) => p > 1);
  if (prices.length < 2) return 1;
  return Math.max(...prices) / Math.min(...prices);
}

export function snapUnits(raw: number): number {
  return clamp(Math.round(raw * 2) / 2, MIN_UNITS, MAX_UNITS);
}

export function sizeUnits(
  p: Proposal,
  params: AiPicksParams,
  records: Record<string, TrackRecord>
): { units: number; why: string } {
  const s = params.staking;
  const push = p.kind === 'single' ? p.legs[0]!.c.pushProb : 0;
  const kelly = kellyStake(p.prob, p.price, push);
  const support = Math.min(...p.legs.map((l) => supportFactor(l.c.supportScore)));
  const scales = p.legs.map((l) => paramsForSport(params, l.c.sport).stakeScale[modelGroup(l.c)] ?? 1);
  const scale = scales.reduce((a, b) => a + b, 0) / scales.length;
  const raw = (s.kellyFraction * kelly * support * scale) / s.unitShare;

  const caps: Array<[number, string]> = [[s.maxUnits, 'stake ceiling']];
  if (priceCap(p.price) < MAX_UNITS) caps.push([priceCap(p.price), 'long price']);
  if (p.kind === 'multi') caps.push([s.multiMaxUnits, 'multi']);
  if (p.legs.some((l) => bookSpread(l.c.quotes ?? []) > BOOK_SPREAD_LIMIT)) caps.push([1, 'books far apart on the price']);
  if (p.legs.some((l) => (l.c.flags ?? []).some((f) => f.startsWith('Early season')))) caps.push([1.5, 'early season']);
  for (const sport of new Set(p.legs.map((l) => l.c.sport))) {
    const rec = records[sport];
    if (!rec || rec.settled < s.rampPicks) caps.push([s.rampMaxUnits, `${sport} still proving itself`]);
    if (rec && rec.recentPicks >= s.drawdownMinPicks && rec.recentRoi != null && rec.recentRoi < s.drawdownRoi) {
      caps.push([1, `${sport} on a bad run`]);
    }
  }
  const [cap, capWhy] = caps.reduce((lo, c) => (c[0] < lo[0] ? c : lo));
  const units = snapUnits(Math.min(raw, cap));
  const why = raw > cap ? `Kelly ${raw.toFixed(2)}u, capped at ${cap}u (${capWhy})` : `Kelly ${raw.toFixed(2)}u`;
  return { units, why };
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
