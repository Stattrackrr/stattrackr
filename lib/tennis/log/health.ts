/**
 * Daily integrity check of the tennis logger. Each check targets a failure that would otherwise be silent:
 * the poller stopping or erroring, close arms not written, results not arriving, would-be bets missing
 * price checks or CLV, a feed failing, and odds-api.net coverage of the matches we track.
 * Stored in Redis (`tennis_log_health_v1`, latest plus one per day) and shown in the weekly report.
 */

import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { RUN_STATS_PREFIX, type TennisLogRunStats } from './poll';

const HEALTH_KEY = 'tennis_log_health_v1';
const HEALTH_TTL_S = 60 * 24 * 60 * 60;
const H = 60 * 60_000;
const FEEDS = ['oddsnet', 'scraper:betright', 'scraper:pointsbet', 'scraper:unibet', 'scraper:ladbrokes', 'scraper:neds'];

export type HealthCheck = { name: string; ok: boolean; value: string; expect: string };
export type TennisLogHealth = { checkedAt: string; ok: boolean; checks: HealthCheck[]; recentErrors: Array<{ at: string; error: string }> };

async function count(table: string, filter: (q: any) => any): Promise<number | null> {
  const { count: n, error } = await filter(supabaseAdmin.from(table).select('*', { count: 'exact', head: true }));
  return error ? null : n ?? 0;
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');

export async function checkTennisLogHealth(nowMs = Date.now()): Promise<TennisLogHealth> {
  const checks: HealthCheck[] = [];
  const add = (name: string, ok: boolean, value: string, expect: string) => checks.push({ name, ok, value, expect });
  const since24 = new Date(nowMs - 24 * H).toISOString();

  // Poller: runs every 3 minutes (~480 a day); long gaps or many failing runs mean lost data.
  const days = [0, 1].map((d) => new Date(nowMs - d * 24 * H).toISOString().slice(0, 10));
  const stats = (await Promise.all(days.map((d) => sharedCache.getJSON<TennisLogRunStats>(`${RUN_STATS_PREFIX}${d}`)))).filter(Boolean) as TennisLogRunStats[];
  const today = stats[0];
  const runs = stats.reduce((a, s) => a + s.runs, 0);
  const lastRunMin = today?.lastRunAt ? Math.round((nowMs - Date.parse(today.lastRunAt)) / 60_000) : null;
  add('poller running', lastRunMin != null && lastRunMin <= 10, lastRunMin == null ? 'no run recorded today' : `last run ${lastRunMin} min ago`, 'within 10 min');
  add('longest gap between runs', (today?.maxGapMinutes ?? 0) <= 15, `${today?.maxGapMinutes ?? 0} min today`, 'at most 15 min');
  const withErrors = stats.reduce((a, s) => a + s.runsWithErrors, 0);
  add('runs with errors', runs > 0 && withErrors / runs <= 0.05, `${withErrors} of ${runs} (today and yesterday)`, 'at most 5%');

  // Close arms: every match that had a main arm and started over 2 hours ago should have closed.
  const { data: arms } = await supabaseAdmin.from('tennis_arm_snapshots').select('match_id, arm').gte('captured_at', new Date(nowMs - 48 * H).toISOString()).limit(5000);
  const { data: started } = await supabaseAdmin
    .from('tennis_matches')
    .select('match_id')
    .lt('scheduled_start', new Date(nowMs - 2 * H).toISOString())
    .gte('scheduled_start', new Date(nowMs - 48 * H).toISOString())
    .limit(5000);
  const startedIds = new Set((started ?? []).map((m) => m.match_id));
  const withMain = new Set((arms ?? []).filter((a) => a.arm === 'main' && startedIds.has(a.match_id)).map((a) => a.match_id));
  const withClose = new Set((arms ?? []).filter((a) => a.arm === 'close').map((a) => a.match_id));
  const closed = [...withMain].filter((id) => withClose.has(id)).length;
  add('close arm written', !withMain.size || closed / withMain.size >= 0.9, `${closed} of ${withMain.size} (${pct(closed, withMain.size)})`, 'at least 90%');

  // Results: matches that started 12-72 hours ago should be graded; "unknown" means no result was found.
  const due = await count('tennis_matches', (q) => q.lt('scheduled_start', new Date(nowMs - 12 * H).toISOString()).gte('scheduled_start', new Date(nowMs - 72 * H).toISOString()));
  const ungraded = await count('tennis_matches', (q) => q.is('graded_at', null).lt('scheduled_start', new Date(nowMs - 12 * H).toISOString()).gte('scheduled_start', new Date(nowMs - 72 * H).toISOString()));
  const unknown = await count('tennis_matches', (q) => q.eq('status', 'unknown').gte('scheduled_start', new Date(nowMs - 72 * H).toISOString()));
  add('results graded', (ungraded ?? 0) <= Math.max(2, 0.1 * (due ?? 0)), `${ungraded} of ${due} still ungraded 12h after start`, 'at most 10%');
  add('results not found', (unknown ?? 0) <= Math.max(2, 0.1 * (due ?? 0)), `${unknown} marked unknown`, 'at most 10%');

  // Would-be bets: +20 min price check within the hour; CLV once the match has closed.
  const missingChecks = await count('tennis_shadow_bets', (q) => q.is('price_20m', null).lt('created_at', new Date(nowMs - H).toISOString()).gte('created_at', new Date(nowMs - 7 * 24 * H).toISOString()));
  const { data: openBets } = await supabaseAdmin.from('tennis_shadow_bets').select('match_id').is('clv', null).gte('created_at', new Date(nowMs - 7 * 24 * H).toISOString()).limit(1000);
  const missingClv = (openBets ?? []).filter((b) => withClose.has(b.match_id)).length;
  add('would-be bet price checks', (missingChecks ?? 0) === 0, `${missingChecks ?? 'n/a'} missing the +20 min check`, 'none');
  add('would-be bet CLV', missingClv === 0, `${missingClv} closed without CLV`, 'none');

  // Feeds: share of failed heartbeats in 24 hours.
  for (const feed of FEEDS) {
    const ok = await count('tennis_poll_heartbeats', (q) => q.eq('feed', feed).eq('ok', true).gte('polled_at', since24));
    const failed = await count('tennis_poll_heartbeats', (q) => q.eq('feed', feed).eq('ok', false).gte('polled_at', since24));
    const total = (ok ?? 0) + (failed ?? 0);
    if (!total) {
      // Ladbrokes / Neds scrapers are blocked (403) and odds-api.net carries both books; silence is expected.
      if (feed === 'oddsnet' || feed === 'scraper:betright') add(`feed ${feed}`, false, 'no heartbeats in 24h', 'heartbeats every poll');
      continue;
    }
    add(`feed ${feed}`, (failed ?? 0) / total <= 0.1, `${failed} of ${total} failed`, 'at most 10%');
  }

  // Coverage: share of tracked matches with an odds-api.net event (Pinnacle / Betfair come only from there).
  const { data: recent } = await supabaseAdmin.from('tennis_matches').select('tier, oddsnet_event_id').gte('scheduled_start', since24).lt('scheduled_start', new Date(nowMs).toISOString()).limit(5000);
  const byTier: Record<string, [number, number]> = {};
  for (const m of recent ?? []) {
    const t = (byTier[m.tier ?? 'unknown'] ??= [0, 0]);
    t[0] += 1;
    if (m.oddsnet_event_id) t[1] += 1;
  }
  const tour = byTier.tour ?? [0, 0];
  add('odds-api.net coverage, tour matches', !tour[0] || tour[1] / tour[0] >= 0.6, Object.entries(byTier).map(([t, [n, k]]) => `${t} ${k}/${n}`).join(', ') || 'no matches', 'tour at least 60%');

  return {
    checkedAt: new Date(nowMs).toISOString(),
    ok: checks.every((c) => c.ok),
    checks,
    recentErrors: stats.flatMap((s) => s.recentErrors).slice(-10),
  };
}

export async function saveTennisLogHealth(health: TennisLogHealth): Promise<void> {
  await sharedCache.setJSON(HEALTH_KEY, health, HEALTH_TTL_S);
  await sharedCache.setJSON(`${HEALTH_KEY}:${health.checkedAt.slice(0, 10)}`, health, HEALTH_TTL_S);
}

export async function readTennisLogHealth(): Promise<TennisLogHealth | null> {
  return sharedCache.getJSON<TennisLogHealth>(HEALTH_KEY);
}
