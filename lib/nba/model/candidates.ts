/**
 * Feature-library tests (agreed build spec, Part D: one input at a time, only with lift). Each
 * candidate is judged on the lines where it was logged: the current model (market + v1) against the
 * same model plus the candidate, both fitted walk-forward by date, compared out of fold game by game.
 * With a dozen or more candidates, a 95% bar would pass one by luck, so the bar is a 99% one-sided
 * lower bound on the lift above 0.
 */

import { BASE_STATS, buildDesign, modelSpec, V1_FEATURES, type CandidateSpec, type ModelLine } from './design';
import { MIN_FIT_DATES, MIN_FIT_LINES } from './fitLines';
import { fitWithCv, liftOverBaseline, type Interval } from './residual';

const CANDIDATE_KEY = '__candidate';
const FOLDS = 5;

export type CandidateResult =
  | { name: string; status: 'insufficient'; lines: number; dates: number }
  | {
      name: string;
      status: 'pass' | 'fail';
      lines: number;
      games: number;
      dates: number;
      /** Log-loss gain per line over the current model (positive = better), out of fold, per game. */
      lift: Interval;
      /** 1% one-sided lower bound of the lift: the pass bar. */
      liftLo99: number;
      /** Fitted weight per standard deviation of the candidate (its direction). */
      coefPerSd: number;
    };

const applies = (spec: CandidateSpec, l: ModelLine) => {
  const base = (BASE_STATS as readonly string[]).includes(l.stat);
  if (spec.lines === 'combo' ? base : !base) return false;
  return !spec.stats || (spec.stats as readonly string[]).includes(l.stat);
};

export function testCandidate(all: ModelLine[], spec: CandidateSpec): CandidateResult {
  const sample = all.filter((l) => applies(spec, l) && typeof l.features[spec.key] === 'number' && Number.isFinite(l.features[spec.key]));
  const dates = new Set(sample.map((l) => l.date)).size;
  if (sample.length < MIN_FIT_LINES || dates < MIN_FIT_DATES) return { name: spec.name, status: 'insufficient', lines: sample.length, dates };

  const values = sample.map((l) => l.features[spec.key] as number);
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, values.length - 1)) || 1;
  const lines = sample.map((l) => ({ ...l, features: { ...l.features, [CANDIDATE_KEY]: ((l.features[spec.key] as number) - mean) / sd } }));

  const baseDesign = buildDesign(lines, modelSpec(lines, V1_FEATURES));
  const candSpec = modelSpec(lines, [...V1_FEATURES, { name: spec.name, key: CANDIDATE_KEY }]);
  const candDesign = buildDesign(lines, candSpec);
  const base = fitWithCv(baseDesign, FOLDS);
  const cand = fitWithCv(candDesign, FOLDS);
  const lift = liftOverBaseline(candDesign, cand.oof, base.oof);
  const lift99 = liftOverBaseline(candDesign, cand.oof, base.oof, 0.98);
  return {
    name: spec.name,
    status: lift99.lo > 0 ? 'pass' : 'fail',
    lines: lines.length,
    games: new Set(lines.map((l) => l.game)).size,
    dates,
    lift,
    liftLo99: lift99.lo,
    coefPerSd: cand.theta[candSpec.params.findIndex((p) => p.name === spec.name)]!,
  };
}

export function testCandidates(lines: ModelLine[], specs: readonly CandidateSpec[]): CandidateResult[] {
  return specs.map((s) => testCandidate(lines, s));
}
