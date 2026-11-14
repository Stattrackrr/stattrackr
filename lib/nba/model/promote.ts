/**
 * When a shadow arm may take over live NBA prop posting from the current model. A stub: nothing in
 * lib/aiPicks calls this, and wiring it in is a separate, owner-approved change. It exists so the
 * rule is written down and tested before any arm is close to it.
 *
 * An arm may go live only when its weekly report says all of:
 *   - the measured sample has been reached (reopen.reached);
 *   - CLV (b), the fair price moving the bet's way after the decision, has a 99% lower bound above 0;
 *   - total CLV has a 99% lower bound above 0;
 *   - calibration holds for overs and for unders;
 *   - the futility stop has not fired.
 * Positive total CLV that comes from (a) alone, the posted price against the decision-time fair, is
 * line shopping and never qualifies.
 */

import type { Report } from './report';

export type ArmStanding = {
  id: string;
  policyVersion: string;
  modelVersion: string;
  clv: Report['clv'];
  verdict: Pick<Report['verdict'], 'reopen' | 'futility'>;
};

/** Off unless NBA_ARM_LIVE_POSTING is exactly "on". Unset everywhere by default. */
export function armLivePostingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NBA_ARM_LIVE_POSTING === 'on';
}

/** Whether one arm clears every reopen rule, with what is still missing. */
export function armMayGoLive(arm: ArmStanding): { ok: boolean; missing: string[] } {
  const { reopen, futility } = arm.verdict;
  const missing: string[] = [];
  if (!reopen.reached) missing.push('measured sample not reached');
  if (!(arm.clv.b.lo99 > 0)) missing.push('CLV (b) 99% lower bound is not above 0');
  if (!(arm.clv.total.lo99 > 0)) missing.push('total CLV 99% lower bound is not above 0');
  if (!reopen.calibrationHolds) missing.push('calibration does not hold for overs and unders');
  if (futility.stop) missing.push('futility stop has fired');
  if (!missing.length && !reopen.ready) missing.push('report does not read as ready to reopen');
  return { ok: !missing.length, missing };
}

/**
 * The arm that may replace live posting, if any: live posting for arms must be switched on, and the
 * arm must clear every reopen rule. With several, the one with the strongest (b) lower bound.
 */
export function selectPromotableArm(arms: ArmStanding[], opts: { enabled?: boolean } = {}): ArmStanding | null {
  if (!(opts.enabled ?? armLivePostingEnabled())) return null;
  return arms.filter((a) => armMayGoLive(a).ok).sort((x, y) => y.clv.b.lo99 - x.clv.b.lo99)[0] ?? null;
}
