/**
 * The arm scoreboard: one row per shadow arm with what it has shown and what the pre-registered
 * rules say about it, plus the residual promote gates. Pure, so the rules are unit-tested.
 *
 *   promote coefficients into an arm: the sound-inputs fit has >= 10 ET dates and >= 300 graded t2h
 *     lines and beats the raw market out of fold (lift lo > 0);
 *   reopen / live use of an arm: measured sample reached, CLV (b) lo99 > 0 and total lo99 > 0,
 *     calibration holds. Positive total from (a) alone is line shopping and does not reopen;
 *   futility: total CLV hi95 below +1%.
 */

import type { Arm, ArmId } from '@/lib/nba/propLog/arms';
import type { FitGate } from './fitGate';
import { armMayGoLive, selectPromotableArm } from './promote';
import { MEASURE_DAYS, type Report } from './report';

export type ArmScore = {
  id: ArmId;
  name: string;
  purpose: string;
  policyVersion: string;
  modelVersion: string;
  /** Where this arm's full report is stored. */
  reportKey: string;
  counts: Report['counts'];
  clv: Report['clv'];
  /**
   * The sample the reopen rule needs. The number is provisional until the arm has MEASURE_DAYS days
   * of bets with CLV (fixedAt), then fixed for the life of the arm's versions. Null before any bet.
   */
  measurement: { status: Report['measurement']['status']; betsNeeded: number | null; betsWithClv: number; fixedAt: string | null };
  reopen: Report['verdict']['reopen'];
  futility: Report['verdict']['futility'];
  /** Every reopen rule this arm has not cleared yet (empty = clear). */
  missingForLive: string[];
  readings: string[];
};

export type ArmFailure = { id: ArmId; name: string; policyVersion: string; modelVersion: string; error: string };

export type GateSummary = { status: FitGate['status']; promoteShadow: boolean; lines: number; dates: number; liftVsMarket: { mean: number; lo: number; hi: number; games: number } | null; readings: string[] };

export type ArmScoreboard = {
  generatedAt: string;
  arms: ArmScore[];
  /** Arms whose report could not be built this week (the others are unaffected). */
  failed: ArmFailure[];
  /**
   * The residual science (arm A's path): the fit on every line, the fit on lines with sound inputs,
   * and whether coefficients may go into an arm. Coefficients fitted on broken inputs can't score
   * sound ones, so promotion reads the sound-inputs fit.
   */
  residual: { allLines: GateSummary; cleanInputs: GateSummary; cleanFeatureVersions: readonly string[]; promoteShadow: boolean; readings: string[] };
  /** Live posting from an arm: off by default; an arm id only when the switch is on and an arm clears every reopen rule. */
  livePosting: { enabled: boolean; promotable: ArmId | null };
};

const gateSummary = (g: FitGate): GateSummary => ({
  status: g.status,
  promoteShadow: g.promoteShadow,
  lines: g.lines,
  dates: g.dates,
  liftVsMarket: g.status === 'fitted' ? g.liftVsMarket : null,
  readings: g.readings,
});

export function armScore(arm: Pick<Arm, 'id' | 'name' | 'purpose' | 'policyVersion' | 'coefs'>, report: Report, reportKey: string): ArmScore {
  const standing = { id: arm.id, policyVersion: arm.policyVersion, modelVersion: arm.coefs.version, clv: report.clv, verdict: report.verdict };
  return {
    id: arm.id,
    name: arm.name,
    purpose: arm.purpose,
    policyVersion: arm.policyVersion,
    modelVersion: arm.coefs.version,
    reportKey,
    counts: report.counts,
    clv: report.clv,
    measurement: {
      status: report.measurement.status,
      betsNeeded: Number.isFinite(report.measurement.n) ? report.measurement.n : null,
      betsWithClv: report.counts.withClv,
      fixedAt: report.measurement.from ? new Date(Date.parse(report.measurement.from) + MEASURE_DAYS * 86_400_000).toISOString() : null,
    },
    reopen: report.verdict.reopen,
    futility: report.verdict.futility,
    missingForLive: armMayGoLive(standing).missing,
    readings: report.counts.confirmed ? report.verdict.readings : ['No confirmed would-be bets recorded yet.'],
  };
}

export function buildScoreboard(opts: {
  generatedAt: string;
  arms: Array<{ arm: Pick<Arm, 'id' | 'name' | 'purpose' | 'policyVersion' | 'coefs'>; report: Report | null; error?: string }>;
  reportKey: (modelVersion: string) => string;
  gate: FitGate;
  cleanGate: FitGate;
  cleanFeatureVersions: readonly string[];
  livePostingEnabled: boolean;
}): ArmScoreboard {
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
  const scores = opts.arms.flatMap(({ arm, report }) => (report ? [armScore(arm, report, opts.reportKey(arm.coefs.version))] : [])).sort(byId);
  const failed = opts.arms
    .filter((a) => !a.report)
    .map(({ arm, error }) => ({ id: arm.id, name: arm.name, policyVersion: arm.policyVersion, modelVersion: arm.coefs.version, error: error ?? 'report failed' }))
    .sort(byId);
  const promotable = selectPromotableArm(
    scores.map((s) => ({ id: s.id, policyVersion: s.policyVersion, modelVersion: s.modelVersion, clv: s.clv, verdict: { reopen: s.reopen, futility: s.futility } })),
    { enabled: opts.livePostingEnabled }
  );
  const versions = opts.cleanFeatureVersions.join(', ');
  const readings: string[] = [];
  if (opts.cleanGate.status === 'insufficient') {
    readings.push(`Sound-inputs fit (${versions}) is still collecting: ${opts.cleanGate.dates} of ${opts.cleanGate.needDates} ET dates, ${opts.cleanGate.lines} of ${opts.cleanGate.needLines} lines. No coefficients can be promoted until it is fitted.`);
    if (opts.gate.promoteShadow) readings.push('The all-lines fit shows lift, but it includes lines logged with broken inputs. Wait for the sound-inputs fit before promoting.');
  } else if (opts.cleanGate.promoteShadow) {
    readings.push(`Sound-inputs fit (${versions}) beats the raw market out of fold: its coefficients may go into an arm under a new model_version.`);
  } else {
    readings.push(`Sound-inputs fit (${versions}) does not beat the raw market out of fold: no coefficients are promoted.`);
  }
  return {
    generatedAt: opts.generatedAt,
    arms: scores,
    failed,
    residual: { allLines: gateSummary(opts.gate), cleanInputs: gateSummary(opts.cleanGate), cleanFeatureVersions: opts.cleanFeatureVersions, promoteShadow: opts.cleanGate.promoteShadow, readings },
    livePosting: { enabled: opts.livePostingEnabled, promotable: (promotable?.id as ArmId | undefined) ?? null },
  };
}
