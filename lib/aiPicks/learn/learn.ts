/**
 * Nightly learning. Every graded play the AI watched (posted or not) and every settled pick feed a
 * few bounded adjustments per sport:
 *   - model weight per market group: the blend of model and market that would have scored best,
 *   - tennis day-form swing: from how often three-set matches really happened vs the model,
 *   - NBL milestone margin: from how often milestones really landed vs the market's fair price,
 *   - minimum edge: tighter when the posted picks lose to the closing price, looser when they beat it,
 *   - stake scale per market group: from closing-price value on posted picks,
 *   - context strength: how hard matchups, pace, injuries, Elo, rankings and fatigue move the
 *     model, from whether the adjusted or unadjusted numbers called the results better.
 * Each change needs a minimum sample, moves a small step per night and stays inside hard bounds,
 * so a lucky or unlucky week cannot swing the system. Samples are counted per game (see
 * LearnSample.cluster), not per line, since a game's lines win and lose together.
 */

import { clamp, round } from '@/lib/aiPicks/model/math';
import type { AiSportParams, AiTennisParams } from '@/lib/aiPicks/params';
import type { AiPick } from '@/lib/aiPicks/types';

export type LearnSample = {
  group: string;
  market: string;
  side: string;
  line: number | null;
  won: 0 | 1;
  /** Model alone, market fair and the blend used, for the side backed. */
  model: number | null;
  marketProb: number | null;
  blended: number;
  /** Model alone with game context off / at full strength, when stored. */
  contextBase?: number | null;
  contextFull?: number | null;
  /**
   * What the play rides on (a tennis match, an NBL player in a game, an NBL game's lines). Plays
   * sharing one count as one between them. Missing means the play stands alone.
   */
  cluster?: string;
};

export type ContextMetrics = {
  /** Distinct clusters behind the usable plays. */
  n: number;
  plays: number;
  logLossOff: number | null;
  logLossFull: number | null;
  bestStrength: number | null;
};

export type GroupMetrics = {
  n: number;
  /** Distinct clusters behind the plays; minimum samples count these. */
  clusters: number;
  hitRate: number;
  avgBlended: number;
  logLossModel: number | null;
  logLossMarket: number | null;
  bestWeight: number | null;
};

export type PickMetrics = { n: number; roi: number | null; clvN: number; clv: number | null };

export type LearnResult<T extends AiSportParams> = {
  params: T;
  changes: string[];
  metrics: {
    samples: number;
    groups: Record<string, GroupMetrics>;
    picks: PickMetrics;
    groupPicks: Record<string, PickMetrics>;
    context: ContextMetrics;
  };
};

/** minN for weights and context strength is in games; fewer than ~100 just chases noise night to night. */
const WEIGHT = { minN: 100, priorN: 150, step: 0.05, max: 0.8, grid: 0.05 };
const DAY_FORM = { minN: 60, threshold: 0.03, step: 0.005, lo: 0.03, hi: 0.1 };
const MILESTONE_POWER = { minN: 60, threshold: 0.02, step: 0.01, lo: 1, hi: 1.2 };
const MIN_EV = { minN: 30, loseClv: -0.01, winClv: 0.02, step: 0.005, lo: 0.025, hi: 0.06, legGap: 0.01, legLo: 0.015 };
const STAKE = { minN: 20, perClv: 3, lo: 0.6, hi: 1.25, step: 0.1 };
/** Plays where context moved the model by less than this say nothing about its strength. */
const CONTEXT = { minN: 100, priorN: 150, step: 0.1, lo: 0, hi: 1.5, grid: 0.05, minMove: 0.005 };

function logLoss(p: number, y: 0 | 1): number {
  const q = clamp(p, 0.01, 0.99);
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

type Weighted = { weight?: number };

/** Mean with optional per-item weights (missing = 1). */
function wmean<T extends Weighted>(items: T[], value: (x: T) => number): number {
  let t = 0;
  let w = 0;
  for (const x of items) {
    const wt = x.weight ?? 1;
    t += wt * value(x);
    w += wt;
  }
  return w > 0 ? t / w : NaN;
}

/** Each cluster's plays share one unit of weight; returns them weighted and the cluster count. */
export function perCluster<T extends { cluster?: string }>(samples: T[]): { items: Array<T & { weight: number }>; clusters: number } {
  const keys = samples.map((s, i) => s.cluster ?? `#${i}`);
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return { items: samples.map((s, i) => ({ ...s, weight: 1 / counts.get(keys[i]!)! })), clusters: counts.size };
}

/** Base model weight in [0, max] whose blend with the market had the lowest log loss. */
export function bestWeight(samples: Array<{ model: number; marketProb: number; won: 0 | 1 } & Weighted>): number | null {
  if (!samples.length) return null;
  let best = { w: 0, loss: Infinity };
  for (let w = 0; w <= WEIGHT.max + 1e-9; w += WEIGHT.grid) {
    const loss = wmean(samples, (s) => logLoss(w * s.model + (1 - w) * s.marketProb, s.won));
    if (loss < best.loss - 1e-12) best = { w: round(w, 2), loss };
  }
  return best.w;
}

type ContextSample = { base: number; full: number; won: 0 | 1 } & Weighted;

const atStrength = (s: ContextSample, k: number) => s.base + k * (s.full - s.base);

/** Context strength in [lo, hi] whose model (off -> full, scaled) had the lowest log loss. */
export function bestStrength(samples: ContextSample[]): number | null {
  if (!samples.length) return null;
  let best = { k: 1, loss: Infinity };
  for (let k = CONTEXT.lo; k <= CONTEXT.hi + 1e-9; k += CONTEXT.grid) {
    const loss = wmean(samples, (s) => logLoss(atStrength(s, k), s.won));
    if (loss < best.loss - 1e-12) best = { k: round(k, 2), loss };
  }
  return best.k;
}

export function contextMetrics(samples: LearnSample[]): ContextMetrics & { usable: ContextSample[] } {
  const { items, clusters } = perCluster(
    samples.filter((s) => s.contextBase != null && s.contextFull != null && Math.abs(s.contextFull - s.contextBase) >= CONTEXT.minMove)
  );
  const usable = items.map((s) => ({ base: s.contextBase!, full: s.contextFull!, won: s.won, weight: s.weight }));
  return {
    usable,
    n: clusters,
    plays: usable.length,
    logLossOff: usable.length ? round(wmean(usable, (s) => logLoss(s.base, s.won)), 4) : null,
    logLossFull: usable.length ? round(wmean(usable, (s) => logLoss(s.full, s.won)), 4) : null,
    bestStrength: clusters >= CONTEXT.minN ? bestStrength(usable) : null,
  };
}

/** Move toward the target by at most `step`, pulled back toward the current value on thin samples. */
export function shrinkStep(current: number, target: number, n: number, priorN: number, step: number): number {
  const pulled = current + (target - current) * (n / (n + priorN));
  return current + clamp(pulled - current, -step, step);
}

function groupMetrics(samples: LearnSample[]): GroupMetrics & { bothClusters: number } {
  const all = perCluster(samples);
  const { items: both, clusters: bothClusters } = perCluster(
    samples.filter((s) => s.model != null && s.marketProb != null) as Array<LearnSample & { model: number; marketProb: number }>
  );
  return {
    n: samples.length,
    clusters: all.clusters,
    bothClusters,
    hitRate: round(wmean(all.items, (s) => s.won), 4),
    avgBlended: round(wmean(all.items, (s) => s.blended), 4),
    logLossModel: both.length ? round(wmean(both, (s) => logLoss(s.model, s.won)), 4) : null,
    logLossMarket: both.length ? round(wmean(both, (s) => logLoss(s.marketProb, s.won)), 4) : null,
    bestWeight: bothClusters >= WEIGHT.minN ? bestWeight(both) : null,
  };
}

/** Settled singles: ROI at posted stakes and average value against the closing price. */
export function pickMetrics(picks: AiPick[]): PickMetrics {
  const settled = picks.filter((p) => p.status !== 'pending' && p.status !== 'void');
  const staked = settled.reduce((a, p) => a + p.units, 0);
  const profit = settled.reduce((a, p) => a + (p.profitUnits ?? 0), 0);
  const clvs = settled
    .filter((p) => p.kind === 'single')
    .map((p) => p.legs[0])
    .filter((l): l is NonNullable<typeof l> => Boolean(l && l.closingPrice && l.closingPrice > 1))
    .map((l) => l.price / l.closingPrice! - 1);
  return {
    n: settled.length,
    roi: staked > 0 ? round(profit / staked, 4) : null,
    clvN: clvs.length,
    clv: clvs.length ? round(mean(clvs), 4) : null,
  };
}

export function learnSport<T extends AiSportParams>(
  sport: string,
  current: T,
  samples: LearnSample[],
  picks: AiPick[],
  groupOf: (leg: AiPick['legs'][number]) => string
): LearnResult<T> {
  const params: T = { ...current, modelWeight: { ...current.modelWeight }, stakeScale: { ...current.stakeScale } };
  const changes: string[] = [];
  const set = (label: string, before: number, after: number, apply: (v: number) => void, dp = 3) => {
    const v = round(after, dp);
    if (Math.abs(v - before) < 1e-9) return;
    apply(v);
    changes.push(`${label} ${before} -> ${v}`);
  };

  const byGroup = new Map<string, LearnSample[]>();
  for (const s of samples) byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), s]);
  const groups: Record<string, GroupMetrics> = {};
  for (const [group, list] of byGroup) {
    const { bothClusters, ...m } = groupMetrics(list);
    groups[group] = m;
    const cur = params.modelWeight[group];
    if (cur == null || m.bestWeight == null) continue;
    set(`${group} model weight`, cur, shrinkStep(cur, m.bestWeight, bothClusters, WEIGHT.priorN, WEIGHT.step), (v) => (params.modelWeight[group] = v), 2);
  }

  if (sport === 'tennis' && 'dayForm' in params) {
    const tp = params as unknown as AiTennisParams;
    const { items: sets, clusters } = perCluster(
      samples
        .filter((s) => s.market === 'total_sets' && s.line === 2.5 && s.model != null)
        .map((s) => ({ cluster: s.cluster, ...(s.side === 'over' ? { p: s.model!, y: s.won } : { p: 1 - s.model!, y: (1 - s.won) as 0 | 1 }) }))
    );
    if (clusters >= DAY_FORM.minN) {
      const bias = wmean(sets, (s) => s.p) - wmean(sets, (s) => s.y);
      // Model sees too many three-setters: players swing more day to day than it assumes.
      const dir = bias > DAY_FORM.threshold ? 1 : bias < -DAY_FORM.threshold ? -1 : 0;
      if (dir) set('day form', tp.dayForm, clamp(tp.dayForm + dir * DAY_FORM.step, DAY_FORM.lo, DAY_FORM.hi), (v) => (tp.dayForm = v));
    }
  }

  if (sport === 'nbl') {
    const { items: ms, clusters } = perCluster(samples.filter((s) => s.group === 'milestone' && s.side === 'over' && s.marketProb != null));
    if (clusters >= MILESTONE_POWER.minN) {
      const bias = wmean(ms, (s) => s.marketProb!) - wmean(ms, (s) => s.won);
      // Fair milestone prices still land less often than they say: strip more margin.
      const dir = bias > MILESTONE_POWER.threshold ? 1 : bias < -MILESTONE_POWER.threshold ? -1 : 0;
      if (dir) {
        set(
          'milestone margin power',
          params.oneWayMarginPower,
          clamp(params.oneWayMarginPower + dir * MILESTONE_POWER.step, MILESTONE_POWER.lo, MILESTONE_POWER.hi),
          (v) => (params.oneWayMarginPower = v)
        );
      }
    }
  }

  const { usable: _usable, ...context } = contextMetrics(samples);
  if (context.bestStrength != null) {
    const cur = params.contextStrength;
    const next = clamp(shrinkStep(cur, context.bestStrength, context.n, CONTEXT.priorN, CONTEXT.step), CONTEXT.lo, CONTEXT.hi);
    set('context strength', cur, next, (v) => (params.contextStrength = v), 2);
  }

  const pm = pickMetrics(picks);
  if (pm.clvN >= MIN_EV.minN && pm.clv != null) {
    const dir = pm.clv < MIN_EV.loseClv ? 1 : pm.clv > MIN_EV.winClv && (pm.roi ?? 0) >= 0 ? -1 : 0;
    if (dir) {
      set('min single edge', params.minEvSingle, clamp(params.minEvSingle + dir * MIN_EV.step, MIN_EV.lo, MIN_EV.hi), (v) => (params.minEvSingle = v));
      set('min leg edge', params.minEvLeg, Math.max(MIN_EV.legLo, params.minEvSingle - MIN_EV.legGap), (v) => (params.minEvLeg = v));
    }
  }

  const byPickGroup = new Map<string, AiPick[]>();
  for (const p of picks) {
    if (p.kind !== 'single' || !p.legs[0]) continue;
    const g = groupOf(p.legs[0]);
    byPickGroup.set(g, [...(byPickGroup.get(g) ?? []), p]);
  }
  const groupPicks: Record<string, PickMetrics> = {};
  for (const [group, list] of byPickGroup) {
    const m = pickMetrics(list);
    groupPicks[group] = m;
    if (m.clvN < STAKE.minN || m.clv == null) continue;
    const cur = params.stakeScale[group] ?? 1;
    const target = clamp(1 + STAKE.perClv * m.clv, STAKE.lo, STAKE.hi);
    set(`${group} stake scale`, cur, cur + clamp(target - cur, -STAKE.step, STAKE.step), (v) => (params.stakeScale[group] = v), 2);
  }

  return { params, changes, metrics: { samples: samples.length, groups, picks: pm, groupPicks, context } };
}
