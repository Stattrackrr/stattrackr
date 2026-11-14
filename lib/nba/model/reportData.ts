import { ACTIVE_COEFS, ARMS, SHADOW_POLICY_VERSION, type ArmId } from '@/lib/nba/propLog/arms';
import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { fitLoggedLines } from './fitLogged';
import { fitGate, type FitGate } from './fitGate';
import type { CandidateResult } from './candidates';
import type { LoggedFit } from './fitLines';
import { armLivePostingEnabled } from './promote';
import { buildReport, type Report, type ReportBet } from './report';
import { buildScoreboard, type ArmScoreboard } from './scoreboard';

const PAGE = 1000;
/** Arm A's full weekly report (the control), as before the other arms existed. Also saved per date. */
export const REPORT_KEY = 'nba_model_report_v1';
/** Latest residual fit + promote gate (day-10 market comparison). Separate from ACTIVE_COEFS. */
export const FIT_GATE_KEY = 'nba_model_fit_gate_v1';
/** The scoreboard: one row per arm with its verdicts, and where each arm's full report is stored. */
export const ARMS_KEY = 'nba_model_arms_v1';
const REPORT_TTL_S = 400 * 24 * 60 * 60;

/** Each arm's full report lives under its model version, so a new version is a new record. */
export const armReportKey = (modelVersion: string) => `${REPORT_KEY}:${modelVersion}`;

type BetRow = {
  id: string;
  game_id: string;
  created_at: string;
  policy: 'main' | 'news';
  trigger: string | null;
  side: 'over' | 'under';
  stat: string;
  line: number;
  price: number;
  price_confirmed: boolean;
  model_prob: number;
  fair_at_decision: number;
  clv: (ReportBet['clv'] & { missing?: string }) | null;
  nba_prop_snapshots: { result_over: string | null; result_under: string | null } | Array<{ result_over: string | null; result_under: string | null }> | null;
  nba_bet_price_checks: Array<{ price_5m: number | null; price_10m: number | null; price_20m: number | null; vanished: boolean | null }> | null;
};

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const result = (v: string | null | undefined): ReportBet['result'] => (v === 'win' || v === 'loss' || v === 'push' || v === 'void' ? v : null);
const priceOrNull = (v: number | null) => (v == null ? null : Number(v) || null);

/** Would-be bets of one frozen policy version, with their results and price checks. */
export async function loadReportBets(policyVersion = SHADOW_POLICY_VERSION, modelVersion = ACTIVE_COEFS.version): Promise<ReportBet[]> {
  const out: ReportBet[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('nba_shadow_bets')
      .select('id, game_id, created_at, policy, trigger:features->>trigger, side, stat, line, price, price_confirmed, model_prob, fair_at_decision, clv, nba_prop_snapshots!trigger_snapshot_id(result_over, result_under), nba_bet_price_checks(price_5m, price_10m, price_20m, vanished)')
      .eq('policy_version', policyVersion)
      .eq('model_version', modelVersion)
      .order('created_at')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`nba_shadow_bets: ${error.message}`);
    for (const r of (data ?? []) as unknown as BetRow[]) {
      const snap = one(r.nba_prop_snapshots);
      const check = r.nba_bet_price_checks?.[0] ?? null;
      out.push({
        id: r.id,
        game: r.game_id,
        at: r.created_at,
        policy: r.policy,
        trigger: r.trigger,
        side: r.side,
        stat: r.stat,
        line: Number(r.line),
        price: Number(r.price),
        confirmed: r.price_confirmed,
        modelProb: Number(r.model_prob),
        fairOver: Number(r.fair_at_decision),
        clv: r.clv && typeof r.clv.total === 'number' ? r.clv : null,
        result: result(r.side === 'over' ? snap?.result_over : snap?.result_under),
        check: check ? { p5: priceOrNull(check.price_5m), p10: priceOrNull(check.price_10m), p20: priceOrNull(check.price_20m), vanished: check.vanished } : null,
      });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

/** Regular-season games from today (US Eastern) to the end of the current regular season. */
export async function regularSeasonGamesLeft(nowMs: number): Promise<number> {
  const today = new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const { data: last, error } = await supabaseAdmin.from('nba_games').select('season').eq('postseason', false).order('game_date', { ascending: false }).limit(1);
  if (error) throw new Error(`nba_games: ${error.message}`);
  const season = last?.[0]?.season;
  if (season == null) return 0;
  const { count } = await supabaseAdmin.from('nba_games').select('id', { count: 'exact', head: true }).eq('season', season).eq('postseason', false).gte('game_date', today);
  return count ?? 0;
}

export type ArmReport = Report & { arm: { id: ArmId; name: string; purpose: string } };

export type WeeklyReport = Report & {
  fit: LoggedFit;
  fitGate: FitGate;
  candidates: CandidateResult[];
  /** The same fit, gate and tests on lines with sound inputs only. */
  clean: { featureVersions: readonly string[]; fit: LoggedFit; fitGate: FitGate; candidates: CandidateResult[] };
  /** Every arm's full report (arm A's is also the top level of this object). */
  arms: ArmReport[];
  scoreboard: ArmScoreboard;
};

export async function buildWeeklyReport(nowMs = Date.now()): Promise<WeeklyReport> {
  const [gamesLeft, logged, ...loaded] = await Promise.all([
    regularSeasonGamesLeft(nowMs),
    fitLoggedLines(),
    ...ARMS.map((arm) =>
      loadReportBets(arm.policyVersion, arm.coefs.version).then(
        (bets) => ({ arm, bets, error: undefined as string | undefined }),
        (err) => ({ arm, bets: null, error: err instanceof Error ? err.message : String(err) })
      )
    ),
  ]);
  // One arm's report failing never hides the others; arm A's is the record this report is built on.
  const arms = loaded.map(({ arm, bets, error }) => {
    if (!bets) return { arm, report: null, error };
    try {
      const report: ArmReport = { ...buildReport({ bets, nowMs, gamesLeft, policyVersion: arm.policyVersion, modelVersion: arm.coefs.version }), arm: { id: arm.id, name: arm.name, purpose: arm.purpose } };
      return { arm, report, error: undefined };
    } catch (err) {
      return { arm, report: null, error: err instanceof Error ? err.message : String(err) };
    }
  });
  const control = arms.find((a) => a.arm.id === 'A');
  if (!control?.report) throw new Error(`arm A report: ${control?.error ?? 'missing'}`);
  const gate = fitGate(logged.fit);
  const cleanGate = fitGate(logged.clean.fit);
  const scoreboard = buildScoreboard({
    generatedAt: control.report.generatedAt,
    arms,
    reportKey: armReportKey,
    gate,
    cleanGate,
    cleanFeatureVersions: logged.clean.featureVersions,
    livePostingEnabled: armLivePostingEnabled(),
  });
  return {
    ...control.report,
    fit: logged.fit,
    fitGate: gate,
    candidates: logged.candidates,
    clean: { featureVersions: logged.clean.featureVersions, fit: logged.clean.fit, fitGate: cleanGate, candidates: logged.clean.candidates },
    arms: arms.flatMap((a) => (a.report ? [a.report] : [])),
    scoreboard,
  };
}

/**
 * Saves the week's record, each under the latest key and under its date so past weeks stay readable:
 *   nba_model_report_v1                  arm A's report with the fits and the scoreboard (as before);
 *   nba_model_report_v1:{model_version}  each arm's full report;
 *   nba_model_arms_v1                    the scoreboard on its own;
 *   nba_model_fit_gate_v1                the residual promote gates.
 */
export async function saveWeeklyReport(report: WeeklyReport): Promise<void> {
  const day = report.generatedAt.slice(0, 10);
  const { arms, ...main } = report;
  await sharedCache.setJSON(REPORT_KEY, main, REPORT_TTL_S);
  await sharedCache.setJSON(`${REPORT_KEY}:${day}`, main, REPORT_TTL_S);
  for (const arm of arms) {
    await sharedCache.setJSON(armReportKey(arm.modelVersion), arm, REPORT_TTL_S);
    await sharedCache.setJSON(`${armReportKey(arm.modelVersion)}:${day}`, arm, REPORT_TTL_S);
  }
  await sharedCache.setJSON(ARMS_KEY, report.scoreboard, REPORT_TTL_S);
  await sharedCache.setJSON(`${ARMS_KEY}:${day}`, report.scoreboard, REPORT_TTL_S);
  await sharedCache.setJSON(
    FIT_GATE_KEY,
    { generatedAt: report.generatedAt, gate: report.fitGate, cleanGate: report.clean.fitGate, cleanFeatureVersions: report.clean.featureVersions, promoteShadow: report.scoreboard.residual.promoteShadow, activeModel: ACTIVE_COEFS.version },
    REPORT_TTL_S
  );
}
