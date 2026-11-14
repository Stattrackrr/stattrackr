/**
 * Frozen shadow policies (agreed build spec, section 3 item 1): every logged line is judged once at
 * its decision point by every registered arm (see arms.ts), and each arm's would-be bet, if any, is
 * recorded with everything it was based on.
 *   main: the first snapshot from 2 hours before tip (t2h);
 *   news: each injury_change snapshot, and each us_move snapshot for arms that take them.
 * Then the posted price is checked again 5, 10 and 20 minutes later, and after tip the bet gets its
 * closing line value (bet line, bet book left out of the close, k at 0.8 / 1 / 1.25). Nothing posts.
 */

import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ARMS, type Arm } from './arms';
import type { LoggedLine, LoggedQuote } from './lines';
import { dropRepeatNews, memoryKey, wouldBeBets, type Trigger } from './shadowBets';
import { closingValue, type PriceMemory } from './shadowRules';

export { ACTIVE_COEFS, SHADOW_POLICY_VERSION } from './arms';
export { memoryKey, type Trigger } from './shadowBets';

const MEMORY_KEY = 'nba_prop_log_price_memory_v1';
const MEMORY_TTL_S = 2 * 60 * 60;
const CHECK_OFFSETS_MIN = [5, 10, 20] as const;
/** A check runs on the first logger run past its offset, within this window (runs are every 5 minutes). */
const CHECK_WINDOW_MIN = 10;
const BET_BATCH = 500;
const PAGE = 1000;

export async function readPriceMemory(): Promise<Record<string, PriceMemory>> {
  return (await sharedCache.getJSON<Record<string, PriceMemory>>(MEMORY_KEY)) ?? {};
}

/** This run's prices, keeping the earliest sighting of a price that has not changed. */
export async function writePriceMemory(
  previous: Record<string, PriceMemory>,
  lines: Array<{ gameId: string; line: LoggedLine }>,
  nowIso: string
): Promise<void> {
  const next: Record<string, PriceMemory> = {};
  for (const { gameId, line } of lines) {
    const key = memoryKey(gameId, line.boardName, line.stat);
    const before = previous[key] ?? {};
    const mem: PriceMemory = {};
    for (const qt of line.quotes) {
      if (qt.line !== line.mainLine) continue;
      const old = before[qt.book];
      const same = old && old.over === qt.over && old.under === qt.under;
      mem[qt.book] = { over: qt.over, under: qt.under, seenAt: same ? old.seenAt : nowIso };
    }
    next[key] = mem;
  }
  await sharedCache.setJSON(MEMORY_KEY, next, MEMORY_TTL_S);
}

export type ShadowResult = { recorded: number; byArm: Record<string, number>; errors: string[] };

/**
 * Would-be bets of every arm for this run's decision snapshots. One read (news bets already taken)
 * and one batched write however many arms there are; an arm that fails is reported and skipped.
 */
export async function recordShadowBets(triggers: Trigger[], memory: Record<string, PriceMemory>, nowMs: number, arms: readonly Arm[] = ARMS): Promise<ShadowResult> {
  const { bets, errors } = wouldBeBets(triggers, memory, nowMs, arms);
  const result: ShadowResult = { recorded: 0, byArm: {}, errors };
  if (!bets.length) return result;
  // News: one would-be bet per arm, player, stat and side per game.
  const news = bets.filter((b) => b.policy === 'news');
  let prior: Array<{ policy_version: string; game_id: string; player_id: string | null; stat: string; side: string }> = [];
  if (news.length) {
    const versions = [...new Set(news.map((b) => b.policy_version))];
    const games = [...new Set(news.map((b) => b.game_id))];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('nba_shadow_bets')
        .select('policy_version, game_id, player_id, stat, side')
        .eq('policy', 'news')
        .in('policy_version', versions)
        .in('game_id', games)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`nba_shadow_bets read: ${error.message}`);
      prior = prior.concat(data ?? []);
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  const fresh = dropRepeatNews(bets, prior);
  const armOf = new Map(arms.map((a) => [a.policyVersion, a.id]));
  for (let i = 0; i < fresh.length; i += BET_BATCH) {
    const { data, error } = await supabaseAdmin
      .from('nba_shadow_bets')
      .upsert(fresh.slice(i, i + BET_BATCH), { onConflict: 'policy,policy_version,trigger_snapshot_id,side', ignoreDuplicates: true })
      .select('id, book, price, created_at, policy_version');
    if (error) throw new Error(`nba_shadow_bets: ${error.message}`);
    const checks = (data ?? []).map((b) => ({ shadow_bet_id: b.id, posted_at: b.created_at, book: b.book, price_posted: b.price }));
    if (checks.length) {
      const { error: cError } = await supabaseAdmin.from('nba_bet_price_checks').insert(checks);
      if (cError) throw new Error(`nba_bet_price_checks: ${cError.message}`);
    }
    for (const b of data ?? []) {
      const arm = armOf.get(b.policy_version) ?? b.policy_version;
      result.byArm[arm] = (result.byArm[arm] ?? 0) + 1;
      result.recorded += 1;
    }
  }
  return result;
}

/** Fills the +5 / +10 / +20 minute prices from this run's board for checks that are due. */
export async function updatePriceChecks(currentLines: Map<string, LoggedLine>, nowMs: number): Promise<number> {
  const since = new Date(nowMs - (20 + CHECK_WINDOW_MIN) * 60_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('nba_bet_price_checks')
    .select('id, posted_at, book, price_posted, price_5m, price_10m, price_20m, vanished, nba_shadow_bets(game_id, player_id, stat, side, line)')
    .not('shadow_bet_id', 'is', null)
    .gte('posted_at', since)
    .is('price_20m', null);
  if (error) throw new Error(`price checks read: ${error.message}`);
  let updated = 0;
  for (const c of data ?? []) {
    const bet = (Array.isArray(c.nba_shadow_bets) ? c.nba_shadow_bets[0] : c.nba_shadow_bets) as { game_id: string; player_id: string; stat: string; side: 'over' | 'under'; line: number } | null;
    if (!bet) continue;
    const line = currentLines.get(`${bet.game_id}|${bet.player_id}|${bet.stat}`);
    const quote = line?.quotes.find((q: LoggedQuote) => q.book === c.book && q.line === Number(bet.line));
    const price = quote ? quote[bet.side] : null;
    const age = (nowMs - Date.parse(c.posted_at)) / 60_000;
    const update: Record<string, unknown> = {};
    for (const m of CHECK_OFFSETS_MIN) {
      const col = `price_${m}m` as 'price_5m' | 'price_10m' | 'price_20m';
      if (c[col] == null && age >= m && age < m + CHECK_WINDOW_MIN) update[col] = price ?? 0;
    }
    if (!Object.keys(update).length) continue;
    const seen = [c.price_5m, c.price_10m, c.price_20m, ...Object.values(update)].filter((v) => v != null) as number[];
    update.vanished = seen.some((p) => !(p >= Number(c.price_posted)));
    const { error: uError } = await supabaseAdmin.from('nba_bet_price_checks').update(update).eq('id', c.id);
    if (uError) throw new Error(`price check update: ${uError.message}`);
    updated += 1;
  }
  return updated;
}

const CLV_BETS_PER_RUN = 1000;
/**
 * More than a full slate, so bets still waiting on a close (up to NO_CLOSE_AFTER_MS after tip) can
 * never fill a run and hold up games that tipped after them.
 */
const CLV_GAMES_PER_RUN = 16;
const CLV_WRITES_PER_RUN = 400;
const CLV_WRITES_AT_ONCE = 10;
/** A line with no close snapshot this long after tip never gets one (the close is only taken before tip). */
const NO_CLOSE_AFTER_MS = 6 * 60 * 60 * 1000;

type PendingBet = {
  id: string;
  game_id: string;
  player_id: string;
  stat: string;
  side: 'over' | 'under';
  line: number;
  price: number;
  book: string;
  fair_at_decision: number;
  projection: { mean?: number; sd?: number } | null;
  nba_prop_snapshots: { tip_at: string } | Array<{ tip_at: string }> | null;
};

/**
 * Closing line value for would-be bets whose game has tipped. Work is bounded per run: only games
 * that have started, one read of their close snapshots and quotes shared by every arm's bets on the
 * same line, and a capped number of writes (the rest are picked up by the next run).
 */
export async function computeShadowClv(nowMs: number): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('nba_shadow_bets')
    .select('id, game_id, player_id, stat, side, line, price, book, fair_at_decision, projection:features->projection, nba_prop_snapshots!trigger_snapshot_id(tip_at)')
    .is('clv', null)
    .order('created_at')
    .limit(CLV_BETS_PER_RUN);
  if (error) throw new Error(`shadow bets read: ${error.message}`);
  const tipOf = (b: PendingBet) => Date.parse((Array.isArray(b.nba_prop_snapshots) ? b.nba_prop_snapshots[0] : b.nba_prop_snapshots)?.tip_at ?? '');
  const tipped = ((data ?? []) as unknown as PendingBet[]).filter((b) => tipOf(b) <= nowMs);
  const games = [...new Set(tipped.map((b) => b.game_id))].slice(0, CLV_GAMES_PER_RUN);
  if (!games.length) return 0;
  const bets = tipped.filter((b) => games.includes(b.game_id));
  const lineKey = (r: { game_id: string; player_id: string | null; stat: string }) => `${r.game_id}|${r.player_id}|${r.stat}`;
  const wanted = new Set(bets.map(lineKey));

  // The close snapshot of each line with a pending bet (the latest, if a line somehow has two).
  const closes = new Map<string, { id: string; main_line: number; captured_at: string }>();
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error: cError } = await supabaseAdmin
      .from('nba_prop_snapshots')
      .select('id, game_id, player_id, stat, main_line, captured_at')
      .eq('snapshot_kind', 'close')
      .in('game_id', games)
      .not('player_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (cError) throw new Error(`close snapshots read: ${cError.message}`);
    for (const r of rows ?? []) {
      const key = lineKey(r);
      if (!wanted.has(key)) continue;
      const have = closes.get(key);
      if (!have || r.captured_at > have.captured_at) closes.set(key, { id: r.id, main_line: Number(r.main_line), captured_at: r.captured_at });
    }
    if ((rows?.length ?? 0) < PAGE) break;
  }
  const quotes = new Map<string, LoggedQuote[]>();
  const closeIds = [...closes.values()].map((c) => c.id);
  for (let i = 0; i < closeIds.length; i += 100) {
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error: qError } = await supabaseAdmin
        .from('nba_prop_book_quotes')
        .select('snapshot_id, book, line, over_price, under_price, source_ts, coherent')
        .in('snapshot_id', closeIds.slice(i, i + 100))
        .order('snapshot_id')
        .order('book')
        .range(from, from + PAGE - 1);
      if (qError) throw new Error(`close quotes read: ${qError.message}`);
      for (const r of rows ?? []) {
        const list = quotes.get(r.snapshot_id) ?? [];
        list.push({ book: r.book, line: Number(r.line), over: r.over_price, under: r.under_price, sourceTs: r.source_ts, coherent: r.coherent });
        quotes.set(r.snapshot_id, list);
      }
      if ((rows?.length ?? 0) < PAGE) break;
    }
  }

  const updates: Array<{ id: string; clv: Record<string, unknown>; scored: boolean }> = [];
  for (const b of bets) {
    const close = closes.get(lineKey(b));
    if (!close) {
      if (nowMs - tipOf(b) > NO_CLOSE_AFTER_MS && updates.length < CLV_WRITES_PER_RUN) updates.push({ id: b.id, clv: { missing: 'no close snapshot' }, scored: false });
      continue;
    }
    const clv = closingValue({ side: b.side, line: Number(b.line), price: Number(b.price), book: b.book, fairAtDecision: Number(b.fair_at_decision), projection: b.projection }, close.main_line, quotes.get(close.id) ?? []);
    updates.push({ id: b.id, clv, scored: !('missing' in clv) });
    if (updates.length >= CLV_WRITES_PER_RUN) break;
  }
  let done = 0;
  for (let i = 0; i < updates.length; i += CLV_WRITES_AT_ONCE) {
    const results = await Promise.all(updates.slice(i, i + CLV_WRITES_AT_ONCE).map((u) => supabaseAdmin.from('nba_shadow_bets').update({ clv: u.clv }).eq('id', u.id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(`shadow clv update: ${failed.error.message}`);
    done += updates.slice(i, i + CLV_WRITES_AT_ONCE).filter((u) => u.scored).length;
  }
  return done;
}
