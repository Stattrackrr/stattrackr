import { ACTIVE_COEFS, SHADOW_POLICY_VERSION } from '@/lib/nba/propLog/shadow';
import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { fitLoggedLines } from './fitLogged';
import type { LoggedFit } from './fitLines';
import { buildReport, type Report, type ReportBet } from './report';

const PAGE = 1000;
export const REPORT_KEY = 'nba_model_report_v1';
const REPORT_TTL_S = 400 * 24 * 60 * 60;

type BetRow = {
  id: string;
  game_id: string;
  created_at: string;
  policy: 'main' | 'news';
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
      .select('id, game_id, created_at, policy, side, stat, line, price, price_confirmed, model_prob, fair_at_decision, clv, nba_prop_snapshots!trigger_snapshot_id(result_over, result_under), nba_bet_price_checks(price_5m, price_10m, price_20m, vanished)')
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

export type WeeklyReport = Report & { fit: LoggedFit };

export async function buildWeeklyReport(nowMs = Date.now()): Promise<WeeklyReport> {
  const [bets, gamesLeft, fit] = await Promise.all([loadReportBets(), regularSeasonGamesLeft(nowMs), fitLoggedLines()]);
  const report = buildReport({ bets, nowMs, gamesLeft, policyVersion: SHADOW_POLICY_VERSION, modelVersion: ACTIVE_COEFS.version });
  return { ...report, fit };
}

/** Saves the report as the latest and under its date, so past weeks stay readable. */
export async function saveWeeklyReport(report: WeeklyReport): Promise<void> {
  await sharedCache.setJSON(REPORT_KEY, report, REPORT_TTL_S);
  await sharedCache.setJSON(`${REPORT_KEY}:${report.generatedAt.slice(0, 10)}`, report, REPORT_TTL_S);
}
