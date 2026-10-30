/**
 * Frozen shadow policies (agreed build spec, section 3 item 1): every logged line is judged once at
 * its decision point and the would-be bet, if any, is recorded with everything it was based on.
 *   main: the first snapshot from 2 hours before tip (t2h);
 *   news: each injury_change snapshot.
 * Then the posted price is checked again 5, 10 and 20 minutes later, and after tip the bet gets its
 * closing line value (bet line, bet book left out of the close, k at 0.8 / 1 / 1.25). Nothing posts.
 */

import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { clvSplit, sizeFromSpread } from '@/lib/nba/model/clv';
import type { LoggedLine, LoggedQuote } from './lines';
import { confirmationGaps, decide, fairExcluding, MODEL_V0, priceConfirmed, type ModelCoefs, type PriceMemory } from './shadowRules';

/** Bumped whenever the policy or the coefficients change; each version is its own evaluation sample. */
export const SHADOW_POLICY_VERSION = 'shadow-v0';
export const ACTIVE_COEFS: ModelCoefs = MODEL_V0;

const MEMORY_KEY = 'nba_prop_log_price_memory_v1';
const MEMORY_TTL_S = 2 * 60 * 60;
const CHECK_OFFSETS_MIN = [5, 10, 20] as const;
/** A check runs on the first logger run past its offset, within this window (runs are every 5 minutes). */
const CHECK_WINDOW_MIN = 10;

export const memoryKey = (gameId: string, boardName: string, stat: string) => `${gameId}|${boardName}|${stat}`;

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

export type Trigger = {
  snapshotId: string;
  kind: 'main' | 'news';
  row: { game_id: string; tip_at: string; player_id: string | null; stat: string; main_line: number; n_books: number; book_dispersion: number | null; features: Record<string, unknown>; model_version: string; feature_version: string };
  line: LoggedLine;
};

/** Would-be bets for this run's decision snapshots; returns how many were recorded. */
export async function recordShadowBets(triggers: Trigger[], memory: Record<string, PriceMemory>, nowMs: number): Promise<number> {
  const nowIso = new Date(nowMs).toISOString();
  const bets: Array<Record<string, unknown>> = [];
  for (const t of triggers) {
    if (!t.row.player_id) continue;
    const previous = memory[memoryKey(t.row.game_id, t.line.boardName, t.line.stat)];
    const gaps = confirmationGaps(Date.parse(t.row.tip_at) - nowMs);
    const quoteFor = (book: string) => t.line.quotes.find((q) => q.book === book && q.line === t.line.mainLine);
    const bet = decide({
      coefs: ACTIVE_COEFS,
      line: { stat: t.row.stat, features: t.row.features, nBooks: t.row.n_books, bookDispersion: t.row.book_dispersion, mainLine: t.line.mainLine, quotes: t.line.quotes },
      best: { over: t.line.bestAuOver, under: t.line.bestAuUnder },
      confirmed: (side, book) => {
        const quote = quoteFor(book);
        return quote ? priceConfirmed({ quote, side, previous, nowMs, ...gaps }) : false;
      },
    });
    if (!bet) continue;
    bets.push({
      policy: t.kind,
      policy_version: SHADOW_POLICY_VERSION,
      model_version: ACTIVE_COEFS.version,
      feature_version: t.row.feature_version,
      trigger_snapshot_id: t.snapshotId,
      game_id: t.row.game_id,
      player_id: t.row.player_id,
      stat: t.row.stat,
      side: bet.side,
      line: t.line.mainLine,
      price: bet.price,
      book: bet.book,
      price_confirmed: bet.confirmed,
      model_prob: Math.round(bet.prob * 10000) / 10000,
      fair_at_decision: Math.round(bet.fair * 10000) / 10000,
      features: { ...t.row.features, ev: Math.round(bet.ev * 10000) / 10000 },
      created_at: nowIso,
    });
  }
  if (!bets.length) return 0;
  const { data, error } = await supabaseAdmin
    .from('nba_shadow_bets')
    .upsert(bets, { onConflict: 'policy,policy_version,trigger_snapshot_id,side', ignoreDuplicates: true })
    .select('id, book, price, created_at');
  if (error) throw new Error(`nba_shadow_bets: ${error.message}`);
  const checks = (data ?? []).map((b) => ({ shadow_bet_id: b.id, posted_at: b.created_at, book: b.book, price_posted: b.price }));
  if (checks.length) {
    const { error: cError } = await supabaseAdmin.from('nba_bet_price_checks').insert(checks);
    if (cError) throw new Error(`nba_bet_price_checks: ${cError.message}`);
  }
  return data?.length ?? 0;
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

type ShadowRow = { id: string; game_id: string; player_id: string; stat: string; side: 'over' | 'under'; line: number; price: number; book: string; fair_at_decision: number; features: Record<string, any>; trigger_snapshot_id: string };

/** Closing line value for would-be bets whose game has a close snapshot. */
export async function computeShadowClv(nowMs: number): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('nba_shadow_bets')
    .select('id, game_id, player_id, stat, side, line, price, book, fair_at_decision, features, trigger_snapshot_id')
    .is('clv', null)
    .order('created_at')
    .limit(500);
  if (error) throw new Error(`shadow bets read: ${error.message}`);
  let done = 0;
  for (const b of (data ?? []) as ShadowRow[]) {
    const { data: close } = await supabaseAdmin
      .from('nba_prop_snapshots')
      .select('id, tip_at, main_line')
      .eq('game_id', b.game_id)
      .eq('player_id', b.player_id)
      .eq('stat', b.stat)
      .eq('snapshot_kind', 'close')
      .maybeSingle();
    if (!close || Date.parse(close.tip_at) > nowMs) continue;
    const { data: q } = await supabaseAdmin.from('nba_prop_book_quotes').select('book, line, over_price, under_price, source_ts, coherent').eq('snapshot_id', close.id);
    const quotes: LoggedQuote[] = (q ?? []).map((r) => ({ book: r.book, line: Number(r.line), over: r.over_price, under: r.under_price, sourceTs: r.source_ts, coherent: r.coherent }));
    const closeLine = Number(close.main_line);
    const looFair = fairExcluding(quotes, closeLine, b.book);
    const allFair = fairExcluding(quotes, closeLine, null);
    const proj = b.features?.projection as { mean?: number; sd?: number } | undefined;
    if (looFair == null || !proj?.mean || !proj.sd) {
      await supabaseAdmin.from('nba_shadow_bets').update({ clv: { missing: looFair == null ? 'no close fair' : 'no projection spread' } }).eq('id', b.id);
      continue;
    }
    const k = sizeFromSpread(proj.mean, proj.sd * proj.sd);
    const base = { side: b.side, price: Number(b.price), line: Number(b.line), fairNow: Number(b.fair_at_decision), lineNow: Number(b.line), lineClose: closeLine };
    const r4 = (v: number) => Math.round(v * 10000) / 10000;
    const at = (kk: number, fair: number) => clvSplit({ ...base, fairClose: fair, k: kk });
    const main = at(k, looFair);
    await supabaseAdmin
      .from('nba_shadow_bets')
      .update({
        clv: {
          total: r4(main.total),
          a: r4(main.a),
          b: r4(main.b),
          sameLine: closeLine === Number(b.line),
          k: Number.isFinite(k) ? r4(k) : null,
          totalK08: r4(at(k * 0.8, looFair).total),
          totalK125: r4(at(k * 1.25, looFair).total),
          totalAllBooks: allFair == null ? null : r4(at(k, allFair).total),
          closeLine,
          closeFair: r4(looFair),
        },
      })
      .eq('id', b.id);
    done += 1;
  }
  return done;
}
