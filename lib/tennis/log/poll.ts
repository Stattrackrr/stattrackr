/**
 * Tennis logging poll (spec sections 9, 11 and 18; lean build: collect everything, defer analysis).
 * Every few minutes, for singles matches from 6 hours before the scheduled start until they go live:
 *   - odds-api.net (Australian books + Pinnacle + Betfair, every market, each book's own time) and the
 *     scrapers (BetRight, Ladbrokes, Neds, PointsBet, Unibet; capture time only);
 *   - quote rows written only when a price changes, a heartbeat per match and feed, raw payloads archived;
 *   - arm snapshots (main 6h out, late 30 min out, close = the last poll before live) with every Australian
 *     candidate line, its fair and fair_source; one would-be bet per match at the main arm;
 *   - +5/+10/+20 minute prices for the would-be bets, CLV at close, grading after the match.
 * Logging never blocks the live path: it runs in its own cron and every write failure is counted.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { betrightTennisFeed } from '@/lib/tennis/extraBooks/betright';
import { ladbrokesTennisFeed, nedsTennisFeed } from '@/lib/tennis/extraBooks/entain';
import { pointsbetTennisFeed } from '@/lib/tennis/extraBooks/pointsbet';
import { findListedEvent, type ExtraBookFeed, type ListedEvent, type SourceMatch } from '@/lib/tennis/extraBooks/shared';
import { unibetTennisFeed } from '@/lib/tennis/extraBooks/unibet';
import { readTennisPlayerLogsCacheMany } from '@/lib/tennis/dashboardCache';
import { isUnplayedTennisMatch, parseTennisSetsFromPlayerView, tennisScoreIsRetired } from '@/lib/tennis/chartStats';
import { readUpcomingTennisByPlayerCache, type TennisNextGame } from '@/lib/tennis/nextGame';
import { tennisFixtureStatusIsTerminal } from '@/lib/tennis/oddsBoard';
import { tennisHandForName } from '@/lib/tennis/hands';
import { lookupCourtPace, lookupTennisVenue } from '@/lib/tennis/venues';
import { fetchTennisOddsNetSnapshot, listTennisOddsNetEvents, matchTennisOddsNetEvent, type TennisOddsNetEvent } from '@/lib/tennis/oddsApiNet';
import { makeModel, priceIntegrated } from '@/lib/tennis/model/pricing';
import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { chooseShadowBet, CODE_VERSION, dpKey, evaluateCandidates, invertArm, matchRules, pairQuotes, SAME_LINE_TOL, SHARP_BOOKS, sharpFairs, type ArmModel, type Candidate, type SharpFair } from './fair';
import { BOOK_RULES_VERSION, gradeForBook } from './bookRules';
import { GRADER_VERSION, gradeSelection, isRoundRobin, type MatchOutcome, type SetScore } from './grade';
import { MAPPING_VERSION, partner, quoteKey, sourceToQuotes, type LogMarket, type QuoteRow } from './quotes';

export const LOG_POLICY_VERSION = 'tennis-v0-1';
const CALIBRATION_VERSION = 'prior-0';
const STATE_PREFIX = 'tennis_log_state_v1:';
const ACTIVE_KEY = 'tennis_log_active_v1';
const LOCK_KEY = 'tennis_log_lock_v1';
const ENDING_KEY = 'tennis_log_ending_v1';
const LOCK_MS = 4 * 60_000;
const H = 60 * 60_000;
const WINDOW_MS = 6 * H;
const LATE_MS = 30 * 60_000;
/** Without a live flag, a match is closed out this long after its scheduled start. */
const CLOSE_FALLBACK_MS = 6 * H;
const GRADE_AFTER_MS = 3 * H;
const CONFIRM_GAP_MS = 2 * 60_000;
const SOURCE_FRESH_MS = 15 * 60_000;
const CHECKS_MIN = [5, 10, 20] as const;
const CHECK_WINDOW_MIN = 6;
const RAW_BUCKET = 'tennis-raw';
const RAW_RETENTION_DAYS = 90;
const STATE_TTL_S = 2 * 24 * 60 * 60;
const CONCURRENCY = 4;

const SCRAPERS: Array<{ feed: ExtraBookFeed; book: string }> = [
  { feed: betrightTennisFeed, book: 'betright' },
  { feed: ladbrokesTennisFeed, book: 'ladbrokes' },
  { feed: nedsTennisFeed, book: 'neds' },
  { feed: pointsbetTennisFeed, book: 'pointsbet' },
  { feed: unibetTennisFeed, book: 'unibet' },
];

type FeedQuote = QuoteRow & { feed: string; sourceTs: string | null };
type QuoteState = { price: number; firstSeenAt: string; sourceTs: string | null };
type MatchState = {
  quotes: Record<string, QuoteState>;
  lastPoll?: { at: string; quotes: FeedQuote[] };
  arms: Partial<Record<'main' | 'late' | 'close', string>>;
  shadow?: { id: string; market: LogMarket; line: number | null; selection: string; book: string; price: number; fair: number };
  liveSeenAt?: string;
  netEventId?: string;
};

type Fixture = {
  next: TennisNextGame;
  matchId: string;
  homeId: string;
  awayId: string;
  tipMs: number;
  bestOf: number;
  rules: ReturnType<typeof matchRules>;
  tier: string;
};

export type TennisLogSummary = {
  fixtures: number;
  polled: number;
  quotesWritten: number;
  heartbeats: number;
  arms: Record<string, number>;
  shadowBets: number;
  priceChecks: number;
  graded: number;
  rowCapHits: number;
  errors: string[];
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    })
  );
  return out;
}

function tierOf(next: TennisNextGame): string {
  const t = String(next.eventType ?? '').toLowerCase();
  if (next.isGrandSlam) return 'slam';
  if (/challenger/.test(t)) return 'challenger';
  if (/itf/.test(t)) return 'itf';
  if (/125/.test(String(next.tournamentName ?? ''))) return 'wta125';
  return 'tour';
}

/** One fixture per match from the per-player upcoming map, with both player ids. */
export async function loadFixtures(nowMs: number): Promise<Fixture[]> {
  const { byPlayerId } = await readUpcomingTennisByPlayerCache();
  const by = new Map<string, { next: TennisNextGame; homeId: string | null; awayId: string | null }>();
  for (const [playerId, next] of byPlayerId) {
    if (!next.matchId || playerId.startsWith('name:')) continue;
    const row = by.get(next.matchId) ?? { next, homeId: null, awayId: null };
    if (next.playerIsHome) row.homeId = playerId;
    else row.awayId = playerId;
    if (!row.homeId && next.opponentId && !next.playerIsHome) row.homeId = next.opponentId;
    if (!row.awayId && next.opponentId && next.playerIsHome) row.awayId = next.opponentId;
    by.set(next.matchId, row);
  }
  const out: Fixture[] = [];
  for (const { next, homeId, awayId } of by.values()) {
    const tipMs = Date.parse(String(next.tipoff || ''));
    if (!homeId || !awayId || !Number.isFinite(tipMs)) continue;
    if (next.homeName.includes('/') || next.awayName.includes('/')) continue;
    if (tipMs - nowMs > WINDOW_MS || nowMs - tipMs > CLOSE_FALLBACK_MS) continue;
    if (tennisFixtureStatusIsTerminal(next.status || '')) continue;
    const bestOf = next.isGrandSlam && next.tour === 'ATP' ? 5 : 3;
    out.push({ next, matchId: String(next.matchId), homeId, awayId, tipMs, bestOf, rules: matchRules(bestOf, next.isGrandSlam), tier: tierOf(next) });
  }
  return out;
}

/** One price per book, market, line and selection: odds-api.net first (it carries the book's time), else the scraper. */
function mergeBooks(quotes: FeedQuote[]): FeedQuote[] {
  const by = new Map<string, FeedQuote>();
  for (const q of quotes) {
    const key = quoteKey(q);
    const prev = by.get(key);
    if (!prev || (prev.feed !== 'oddsnet' && q.feed === 'oddsnet')) by.set(key, q);
  }
  return [...by.values()];
}

const stateKey = (q: FeedQuote) => `${q.feed}|${quoteKey(q)}`;

/** A price members could act on: seen unchanged on an earlier poll, and the book's own time fresh where known. */
function confirmedIn(state: MatchState, nowMs: number) {
  return (q: FeedQuote) => {
    const s = state.quotes[stateKey(q)];
    if (!s || s.price !== q.price || nowMs - Date.parse(s.firstSeenAt) < CONFIRM_GAP_MS) return false;
    return !q.sourceTs || nowMs - Date.parse(q.sourceTs) <= SOURCE_FRESH_MS;
  };
}

/** Our fair for one selection at an arm: the sharp line if there is one, else the DP at the arm's model. */
function fairFor(market: LogMarket, line: number | null, selection: string, fairs: SharpFair[], model: ArmModel | null, fx: Fixture): number | null {
  const base = /(^|\s)(away|under|no)$/.test(selection) ? partner(selection) : selection;
  const flip = base !== selection;
  const same = fairs.find((f) => f.market === market && f.base === base && (line == null ? f.line == null : f.line != null && Math.abs(f.line - line) < SAME_LINE_TOL));
  let p: number | null = same ? same.p : null;
  if (p == null && model) {
    const key = dpKey(market, line, base);
    if (key) p = priceIntegrated(model.theta, model.cov, model.tau, makeModel([key], fx.bestOf, fx.rules.ruleN, fx.rules.ruleF), model.order, model.rho)[key] ?? null;
  }
  return p == null ? null : flip ? 1 - p : p;
}

const r6 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 1e6) / 1e6);

async function insertBatches(table: string, rows: Array<Record<string, unknown>>, errors: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabaseAdmin.from(table).insert(rows.slice(i, i + 1000));
    if (error) errors.push(`${table}: ${error.message}`);
    else n += Math.min(1000, rows.length - i);
  }
  return n;
}

/** Snapshot, candidates and (main arm) the would-be bet for one match. */
async function writeArm(arm: 'main' | 'late' | 'close', fx: Fixture, quotes: FeedQuote[], state: MatchState, nowMs: number, summary: TennisLogSummary): Promise<{ id: string; fairs: SharpFair[]; model: ArmModel | null } | null> {
  const merged = mergeBooks(quotes);
  const pairs = pairQuotes(merged);
  const fairs = sharpFairs(pairs);
  let model: ArmModel | null = null;
  try {
    model = invertArm(fairs, fx.bestOf, fx.rules);
  } catch (err) {
    summary.errors.push(`inversion ${fx.matchId}: ${err instanceof Error ? err.message : err}`);
  }
  const candidates = evaluateCandidates(pairs, fairs, model, fx.bestOf, fx.rules);
  const paired = new Set(pairs.flatMap((p) => [`${p.book}|${p.market}|${p.line ?? ''}|${p.base}`, `${p.book}|${p.market}|${p.line ?? ''}|${partner(p.base)}`]));
  const oneSided = merged.filter((q) => !SHARP_BOOKS.has(q.book) && !paired.has(`${q.book}|${q.market}|${q.line ?? ''}|${q.selection}`)).length;
  const capturedAt = new Date(nowMs).toISOString();
  const { data: snap, error } = await supabaseAdmin
    .from('tennis_arm_snapshots')
    .upsert(
      {
        match_id: fx.matchId,
        arm,
        captured_at: capturedAt,
        minutes_to_start: Math.round((fx.tipMs - nowMs) / 60_000),
        sharp: fairs.map((f) => ({ market: f.market, line: f.line, base: f.base, p: r6(f.p), byBook: f.byBook })),
        model: model && { ...model, theta: model.theta.map(r6), cov: model.cov.map((r) => r.map(r6)), coherence: r6(model.coherence) },
        config: { code_version: CODE_VERSION, rules_version: fx.rules.version, mapping_version: MAPPING_VERSION, devig: 'power', confirm_gap_ms: CONFIRM_GAP_MS, source_fresh_ms: SOURCE_FRESH_MS },
        calibration_version: CALIBRATION_VERSION,
        n_candidates: candidates.length,
        n_one_sided: oneSided,
        policy_version: LOG_POLICY_VERSION,
      },
      { onConflict: 'match_id,arm', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle();
  if (error || !snap) {
    if (error) summary.errors.push(`arm ${arm} ${fx.matchId}: ${error.message}`);
    return null;
  }
  summary.arms[arm] = (summary.arms[arm] ?? 0) + 1;
  const byKey = new Map(merged.map((q) => [quoteKey(q), q]));
  const confirmed = confirmedIn(state, nowMs);
  const isConfirmed = (c: Candidate) => {
    const q = byKey.get(quoteKey({ book: c.book, market: c.market, line: c.line, selection: c.selection }));
    return q ? confirmed(q) : false;
  };
  const rows = candidates.map((c) => ({
    arm_snapshot_id: snap.id,
    match_id: fx.matchId,
    arm,
    captured_at: capturedAt,
    book: c.book,
    market: c.market,
    line: c.line,
    selection: c.selection,
    price: c.price,
    q: r6(c.q),
    overround: r6(c.overround),
    fair: r6(c.fair),
    fair_source: c.fairSource,
    line_distance: c.lineDistance,
    half_lines: c.halfLines,
    sharp_lines: c.sharpLines,
    same_line_tol: SAME_LINE_TOL,
    calibration_state: 'prior',
    edge: r6(c.edge),
    ev: r6(c.ev),
    confirmed: isConfirmed(c),
    policy_version: LOG_POLICY_VERSION,
  }));
  await insertBatches('tennis_candidates', rows, summary.errors);
  if (arm === 'main' && !state.shadow) {
    const bet = chooseShadowBet(candidates, isConfirmed);
    if (bet) {
      const { data, error: bError } = await supabaseAdmin
        .from('tennis_shadow_bets')
        .upsert(
          {
            match_id: fx.matchId,
            arm_snapshot_id: snap.id,
            book: bet.book,
            market: bet.market,
            line: bet.line,
            selection: bet.selection,
            price: bet.price,
            fair: r6(bet.fair),
            fair_source: bet.fairSource,
            edge: r6(bet.edge),
            ev: r6(bet.ev),
            policy_version: LOG_POLICY_VERSION,
            created_at: capturedAt,
          },
          { onConflict: 'match_id,policy_version', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle();
      if (bError) summary.errors.push(`shadow bet ${fx.matchId}: ${bError.message}`);
      else if (data) {
        state.shadow = { id: data.id, market: bet.market, line: bet.line, selection: bet.selection, book: bet.book, price: bet.price, fair: bet.fair };
        summary.shadowBets += 1;
      }
    }
  }
  return { id: snap.id, fairs, model };
}

/** CLV for the match's would-be bet against the close: total, (a) price vs decision fair, (b) fair drift. */
async function writeClv(fx: Fixture, state: MatchState, close: { fairs: SharpFair[]; model: ArmModel | null }, summary: TennisLogSummary): Promise<void> {
  const bet = state.shadow;
  if (!bet) return;
  const closeFair = fairFor(bet.market, bet.line, bet.selection, close.fairs, close.model, fx);
  if (closeFair == null) return;
  const sameLine = close.fairs.some((f) => f.market === bet.market && (bet.line == null ? f.line == null : f.line != null && Math.abs(f.line - bet.line) < SAME_LINE_TOL));
  const total = closeFair * bet.price - 1;
  const a = bet.fair * bet.price - 1;
  const { error } = await supabaseAdmin
    .from('tennis_shadow_bets')
    .update({ close_fair: r6(closeFair), clv: { total: r6(total), a: r6(a), b: r6(total - a), close_source: sameLine ? 'sharp_direct' : 'model' } })
    .eq('id', bet.id);
  if (error) summary.errors.push(`clv ${fx.matchId}: ${error.message}`);
}

/** +5 / +10 / +20 minute prices for open would-be bets, from this poll's quotes. */
async function updatePriceChecks(quotesByMatch: Map<string, FeedQuote[]>, nowMs: number, summary: TennisLogSummary): Promise<void> {
  const since = new Date(nowMs - (20 + CHECK_WINDOW_MIN) * 60_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('tennis_shadow_bets')
    .select('id, match_id, book, market, line, selection, price, created_at, price_5m, price_10m, price_20m')
    .gte('created_at', since)
    .is('price_20m', null);
  if (error) {
    summary.errors.push(`price checks: ${error.message}`);
    return;
  }
  for (const b of data ?? []) {
    const quotes = quotesByMatch.get(b.match_id);
    if (!quotes) continue;
    const now = mergeBooks(quotes).find((q) => q.book === b.book && q.market === b.market && q.selection === b.selection && (b.line == null ? q.line == null : q.line != null && Math.abs(q.line - Number(b.line)) < SAME_LINE_TOL));
    const price = now?.price ?? 0;
    const age = (nowMs - Date.parse(b.created_at)) / 60_000;
    const update: Record<string, unknown> = {};
    for (const m of CHECKS_MIN) {
      const col = `price_${m}m` as 'price_5m' | 'price_10m' | 'price_20m';
      if (b[col] == null && age >= m && age < m + CHECK_WINDOW_MIN) update[col] = price;
    }
    if (!Object.keys(update).length) continue;
    const seen = [b.price_5m, b.price_10m, b.price_20m, ...Object.values(update)].filter((v) => v != null).map(Number);
    update.vanished = seen.some((p) => !(p >= Number(b.price)));
    const { error: uError } = await supabaseAdmin.from('tennis_shadow_bets').update(update).eq('id', b.id);
    if (uError) summary.errors.push(`price check ${b.id}: ${uError.message}`);
    else summary.priceChecks += 1;
  }
}

/** The finished match from the home player's logs: status and per-set scores (home first). */
function outcomeFromLogs(score: string, isWin: boolean, roundRobin: boolean): MatchOutcome & { score: string } {
  const winner = isWin ? 'home' : 'away';
  if (isUnplayedTennisMatch(score)) return { status: 'walkover', sets: [], score, winner, roundRobin };
  const sets: SetScore[] = parseTennisSetsFromPlayerView(score, isWin).map((s) => ({ home: s.playerGames, away: s.opponentGames, tiebreak: s.tiebreak ?? null }));
  const status = tennisScoreIsRetired(score) ? 'retired' : /\bdef\b/i.test(score) ? 'default' : 'completed';
  return { status, sets, score, winner, roundRobin };
}

/**
 * Observed match length (API-Tennis gives no duration). A live match is over once API-Tennis marks it
 * finished or it's no longer either player's next match, on two polls running (one missed fetch never ends
 * a match); the end is the first of those polls. odds-api.net can't tell us: it drops events once they go live.
 */
async function markEnded(nowMs: number, summary: TennisLogSummary): Promise<void> {
  const { byPlayerId } = await readUpcomingTennisByPlayerCache();
  if (!byPlayerId.size) return;
  const open = new Set<string>();
  for (const next of byPlayerId.values()) {
    if (next.matchId && !tennisFixtureStatusIsTerminal(next.status || '')) open.add(String(next.matchId));
  }
  const { data, error } = await supabaseAdmin
    .from('tennis_matches')
    .select('match_id, live_seen_at')
    .not('live_seen_at', 'is', null)
    .is('ended_seen_at', null)
    .gte('live_seen_at', new Date(nowMs - 10 * H).toISOString())
    .limit(100);
  if (error) {
    if (!/column/i.test(error.message)) summary.errors.push(`ended read: ${error.message}`);
    return;
  }
  const pending = (await sharedCache.getJSON<Record<string, number>>(ENDING_KEY)) ?? {};
  const live = new Set((data ?? []).map((m) => m.match_id));
  for (const id of Object.keys(pending)) if (!live.has(id)) delete pending[id];
  for (const m of data ?? []) {
    if (open.has(m.match_id)) {
      delete pending[m.match_id];
      continue;
    }
    const firstGone = pending[m.match_id];
    if (firstGone == null) {
      pending[m.match_id] = nowMs;
      continue;
    }
    const minutes = Math.round((firstGone - Date.parse(m.live_seen_at)) / 60_000);
    const { error: uError } = await supabaseAdmin
      .from('tennis_matches')
      .update({ ended_seen_at: new Date(firstGone).toISOString(), minutes_observed: minutes })
      .eq('match_id', m.match_id);
    if (uError) summary.errors.push(`ended ${m.match_id}: ${uError.message}`);
    else delete pending[m.match_id];
  }
  await sharedCache.setJSON(ENDING_KEY, pending, STATE_TTL_S);
}

/** Results for matches that should be over, and grades for their would-be bets. */
async function gradeFinished(nowMs: number, summary: TennisLogSummary): Promise<void> {
  const { data: matches, error } = await supabaseAdmin
    .from('tennis_matches')
    .select('match_id, home_id, scheduled_start, best_of, minutes_observed')
    .is('graded_at', null)
    .lt('scheduled_start', new Date(nowMs - GRADE_AFTER_MS).toISOString())
    .limit(40);
  if (error) {
    summary.errors.push(`grade read: ${error.message}`);
    return;
  }
  const ids = (matches ?? []).map((m) => m.home_id).filter(Boolean) as string[];
  if (!ids.length) return;
  const logs = await readTennisPlayerLogsCacheMany(ids);
  for (const m of matches ?? []) {
    const row = (logs.get(m.home_id) ?? []).find((r) => r.matchId === `${m.match_id}-${m.home_id}`);
    const stale = nowMs - Date.parse(m.scheduled_start) > 5 * 24 * H;
    if (!row) {
      if (stale) await supabaseAdmin.from('tennis_matches').update({ status: 'unknown', graded_at: new Date(nowMs).toISOString() }).eq('match_id', m.match_id);
      continue;
    }
    const outcome = outcomeFromLogs(String(row.score || ''), row.isWin, isRoundRobin(String(row.tourneyName || ''), String(row.round || '')));
    const early = outcome.status === 'retired' || outcome.status === 'default';
    // A start seen late (API-Tennis's live flag can lag) gives an impossible length: under 2 minutes a game.
    const games = outcome.sets.reduce((a, s) => a + s.home + s.away, 0);
    const implausible = m.minutes_observed != null && Number(m.minutes_observed) < 2 * games;
    const matchUpdate = {
      ...(implausible ? { minutes_observed: null } : {}),
      status: outcome.status,
      score: outcome.score,
      set_scores: outcome.sets,
      completed: outcome.status === 'completed',
      retired_side: early ? (outcome.winner === 'home' ? 'away' : 'home') : null,
      graded_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    };
    let { error: mError } = await supabaseAdmin.from('tennis_matches').update({ ...matchUpdate, winner_side: outcome.winner }).eq('match_id', m.match_id);
    // Before migrations/tennis_book_void_rules.sql there is no winner_side column.
    if (mError && /column/i.test(mError.message)) ({ error: mError } = await supabaseAdmin.from('tennis_matches').update(matchUpdate).eq('match_id', m.match_id));
    if (mError) {
      summary.errors.push(`match result ${m.match_id}: ${mError.message}`);
      continue;
    }
    // Option A: the posted book's rule settles the bet; the house grade is kept as the sensitivity check.
    const { data: bets } = await supabaseAdmin.from('tennis_shadow_bets').select('id, book, market, line, selection').eq('match_id', m.match_id).is('result', null);
    for (const b of bets ?? []) {
      const line = b.line == null ? null : Number(b.line);
      const house = gradeSelection(b.market as LogMarket, line, b.selection, outcome);
      const byBook = gradeForBook(b.book, b.market as LogMarket, line, b.selection, outcome, Number(m.best_of) || 3, house);
      const update = {
        result: byBook.grade,
        grader_version: byBook.rule === 'house' ? GRADER_VERSION : `${BOOK_RULES_VERSION}:${byBook.rule}`,
        rule_unverified: !byBook.verified,
        graded_at: new Date(nowMs).toISOString(),
      };
      let { error: bError } = await supabaseAdmin.from('tennis_shadow_bets').update({ ...update, result_house: house }).eq('id', b.id);
      if (bError && /column/i.test(bError.message)) ({ error: bError } = await supabaseAdmin.from('tennis_shadow_bets').update(update).eq('id', b.id));
      if (bError) summary.errors.push(`bet grade ${b.id}: ${bError.message}`);
    }
    summary.graded += 1;
  }
}

/** Gzipped raw payloads per feed and poll, in object storage; the index row keeps path and hash. */
async function archiveRaw(feed: string, payload: Record<string, unknown>, nowIso: string, summary: TennisLogSummary): Promise<void> {
  const keys = Object.keys(payload);
  if (!keys.length) return;
  const body = gzipSync(Buffer.from(JSON.stringify(payload)));
  const sha256 = createHash('sha256').update(body).digest('hex');
  const path = `${nowIso.slice(0, 10)}/${feed.replace(/[^a-z0-9-]/gi, '_')}/${nowIso.replace(/[:.]/g, '-')}.json.gz`;
  const upload = () => supabaseAdmin.storage.from(RAW_BUCKET).upload(path, body, { contentType: 'application/gzip', upsert: false });
  let { error } = await upload();
  if (error && /not found/i.test(error.message)) {
    await supabaseAdmin.storage.createBucket(RAW_BUCKET, { public: false }).catch(() => undefined);
    ({ error } = await upload());
  }
  if (error) {
    summary.errors.push(`raw ${feed}: ${error.message}`);
    return;
  }
  const { error: iError } = await supabaseAdmin.from('tennis_raw_payloads').insert({ feed, polled_at: nowIso, path, sha256, bytes: body.length, n_matches: keys.length });
  if (iError) summary.errors.push(`raw index: ${iError.message}`);
}

/** Raw payloads past retention are deleted; their index rows are flagged so they never read as missing data. */
async function expireRaw(nowMs: number, summary: TennisLogSummary): Promise<void> {
  const cutoff = new Date(nowMs - RAW_RETENTION_DAYS * 24 * H).toISOString();
  const { data } = await supabaseAdmin.from('tennis_raw_payloads').select('id, path').eq('raw_expired', false).lt('polled_at', cutoff).limit(100);
  if (!data?.length) return;
  const { error } = await supabaseAdmin.storage.from(RAW_BUCKET).remove(data.map((r) => r.path));
  if (error) {
    summary.errors.push(`raw expiry: ${error.message}`);
    return;
  }
  await supabaseAdmin.from('tennis_raw_payloads').update({ raw_expired: true }).in('id', data.map((r) => r.id));
}

export async function runTennisLog(nowMs = Date.now()): Promise<TennisLogSummary> {
  const summary: TennisLogSummary = { fixtures: 0, polled: 0, quotesWritten: 0, heartbeats: 0, arms: {}, shadowBets: 0, priceChecks: 0, graded: 0, rowCapHits: 0, errors: [] };
  const lock = await sharedCache.getJSON<{ at: number }>(LOCK_KEY);
  if (lock && nowMs - lock.at < LOCK_MS) {
    summary.errors.push('Previous run still going');
    return summary;
  }
  // Without the tables nothing can be stored, and price memory must not move ahead of what was written.
  const preflight = await supabaseAdmin.from('tennis_matches').select('match_id').limit(1);
  if (preflight.error) {
    summary.errors.push(`Tennis logging tables unavailable (run migrations/tennis_logging.sql): ${preflight.error.message}`);
    return summary;
  }
  await sharedCache.setJSON(LOCK_KEY, { at: nowMs }, Math.ceil(LOCK_MS / 1000));
  const nowIso = new Date(nowMs).toISOString();
  try {
    const fixtures = await loadFixtures(nowMs);
    summary.fixtures = fixtures.length;
    const active = (await sharedCache.getJSON<Record<string, number>>(ACTIVE_KEY)) ?? {};

    // odds-api.net: one snapshot per matched event.
    const events: TennisOddsNetEvent[] = await listTennisOddsNetEvents().catch(() => []);
    const matchedNet = fixtures.map((fx) => ({ fx, hit: matchTennisOddsNetEvent(events, fx.next) }));

    if (fixtures.length) {
      const rows = matchedNet.map(({ fx, hit }) => ({
        match_id: fx.matchId,
        ...(hit ? { oddsnet_event_id: String(hit.event.event_id) } : {}),
        tour: fx.next.tour,
        tier: fx.tier,
        tournament: fx.next.tournamentName,
        surface: fx.next.surface,
        best_of: fx.bestOf,
        is_grand_slam: fx.next.isGrandSlam,
        rules_version: fx.rules.version,
        home_id: fx.homeId,
        home_name: fx.next.homeName,
        away_id: fx.awayId,
        away_name: fx.next.awayName,
        scheduled_start: new Date(fx.tipMs).toISOString(),
        policy_version: LOG_POLICY_VERSION,
        updated_at: nowIso,
      }));
      const withConditions = rows.map((row, i) => {
        const fx = matchedNet[i]!.fx;
        const venue = lookupTennisVenue(fx.next.tournamentName, fx.next.surface);
        const located = Number.isFinite(venue.lat) && Number.isFinite(venue.lng) && !(venue.lat === 0 && venue.lng === 0);
        return {
          ...row,
          indoor: venue.setting == null ? null : venue.setting === 'Indoor',
          court_speed: venue.speed,
          court_pace: lookupCourtPace(fx.next.tournamentName),
          venue_city: venue.city || null,
          venue_country: venue.country || null,
          venue_lat: located ? venue.lat : null,
          venue_lng: located ? venue.lng : null,
          home_hand: tennisHandForName(fx.next.homeName),
          away_hand: tennisHandForName(fx.next.awayName),
        };
      });
      // A batch upsert writes the union of its rows' columns (missing ones as null), so matches whose
      // odds-api.net event has dropped (live) go in their own batch and keep the stored event id.
      for (const batch of [withConditions.filter((r) => 'oddsnet_event_id' in r), withConditions.filter((r) => !('oddsnet_event_id' in r))]) {
        if (!batch.length) continue;
        const { error } = await supabaseAdmin.from('tennis_matches').upsert(batch, { onConflict: 'match_id' });
        if (error) summary.errors.push(`tennis_matches: ${error.message}`);
      }
    }
    const netResults = await mapLimit(matchedNet, CONCURRENCY, async ({ fx, hit }) =>
      hit ? { fx, hit, snap: await fetchTennisOddsNetSnapshot(hit.event).catch(() => null) } : { fx, hit, snap: null }
    );

    // Scrapers: list once per feed, then one detail per matched fixture.
    const scraped = new Map<string, Array<{ book: string; source: SourceMatch | null; homeIsHome: boolean; ok: boolean }>>();
    for (const { feed, book } of SCRAPERS) {
      const listed: ListedEvent[] = (await feed.list().catch(() => [])).filter((e) => !e.home.includes('/') && !e.away.includes('/'));
      const jobs = fixtures.map((fx) => ({ fx, hit: listed.length ? findListedEvent(listed, fx.next) : null }));
      await mapLimit(jobs, CONCURRENCY, async ({ fx, hit }) => {
        if (!hit) return;
        const source = await feed.detail(hit.event).catch(() => null);
        scraped.set(fx.matchId, [...(scraped.get(fx.matchId) ?? []), { book, source, homeIsHome: hit.homeIsHome, ok: source != null }]);
      });
    }

    const quoteRows: Array<Record<string, unknown>> = [];
    const heartbeats: Array<Record<string, unknown>> = [];
    const quotesByMatch = new Map<string, FeedQuote[]>();
    const rawNet: Record<string, unknown> = {};
    const rawScraped: Record<string, unknown> = {};

    for (const { fx, hit, snap } of netResults) {
      const state = (await sharedCache.getJSON<MatchState>(`${STATE_PREFIX}${fx.matchId}`)) ?? { quotes: {}, arms: {} };
      const quotes: FeedQuote[] = [];
      if (hit) {
        const asOf = snap?.asOf ?? {};
        for (const { book, source } of snap?.sources ?? []) {
          const ts = asOf[book] ? new Date(asOf[book]!).toISOString() : null;
          for (const q of sourceToQuotes(source, hit.homeIsHome, fx.bestOf, book)) quotes.push({ ...q, feed: 'oddsnet', sourceTs: ts });
        }
        heartbeats.push({
          match_id: fx.matchId,
          feed: 'oddsnet',
          polled_at: nowIso,
          ok: Boolean(snap?.ok),
          error: snap ? null : 'fetch failed',
          books: Object.fromEntries((snap?.sources ?? []).map((s) => [s.book, asOf[s.book] ? new Date(asOf[s.book]!).toISOString() : null])),
          n_quotes: quotes.length,
        });
        if (snap?.rowCapHit) summary.rowCapHits += 1;
        if (snap?.raw.length) rawNet[fx.matchId] = { event_id: hit.event.event_id, event_state: hit.event.event_state ?? null, pages: snap.raw };
      }
      for (const s of scraped.get(fx.matchId) ?? []) {
        const rows = s.source ? sourceToQuotes(s.source, s.homeIsHome, fx.bestOf, s.book) : [];
        for (const q of rows) quotes.push({ ...q, feed: `scraper:${s.book}`, sourceTs: null });
        heartbeats.push({ match_id: fx.matchId, feed: `scraper:${s.book}`, polled_at: nowIso, ok: s.ok, error: s.ok ? null : 'detail failed', books: { [s.book]: null }, n_quotes: rows.length });
        if (s.source) rawScraped[`${fx.matchId}|${s.book}`] = s.source;
      }
      // odds-api.net drops an event around its listed start, which can be well before play begins: a matched
      // event missing from a list that did load means pre-match pricing is over (close out, stop collecting),
      // but only API-Tennis saying live marks the start. Matches with no data still get their close checks.
      const netGone = Boolean(state.netEventId) && !hit && events.length > 0;
      if (hit) state.netEventId = String(hit.event.event_id);
      const hasData = quotes.length > 0;
      if (!hasData && !state.lastPoll) continue;
      if (hasData) summary.polled += 1;

      const started = fx.next.live || hit?.event.event_state === 'live';
      const live = started || netGone;
      if (started && !state.liveSeenAt) {
        state.liveSeenAt = nowIso;
        await supabaseAdmin.from('tennis_matches').update({ live_seen_at: nowIso, status: 'live' }).eq('match_id', fx.matchId);
      }
      const pastFallback = nowMs - fx.tipMs > CLOSE_FALLBACK_MS - 10 * 60_000;
      // Close: the last poll before the match went live (this poll's prices may already be in-play).
      if ((live || pastFallback) && !state.arms.close && state.lastPoll) {
        const prevMs = Date.parse(state.lastPoll.at);
        const close = await writeArm('close', fx, state.lastPoll.quotes, state, prevMs, summary);
        if (close) {
          state.arms.close = close.id;
          await writeClv(fx, state, close, summary);
        }
      }
      if (!live && hasData) {
        // Prices on change: a row only when a book's price for a selection is new or different.
        const seen = new Set<string>();
        for (const q of quotes) {
          const key = stateKey(q);
          seen.add(key);
          const prev = state.quotes[key];
          if (prev && prev.price === q.price) {
            prev.sourceTs = q.sourceTs ?? prev.sourceTs;
            continue;
          }
          state.quotes[key] = { price: q.price, firstSeenAt: nowIso, sourceTs: q.sourceTs };
          quoteRows.push({
            match_id: fx.matchId,
            feed: q.feed,
            book: q.book,
            market: q.market,
            line: q.line,
            selection: q.selection,
            price: q.price,
            first_seen_at: nowIso,
            source_ts: q.sourceTs,
            ts_source: q.feed === 'oddsnet' ? 'book' : 'capture',
            mapping_version: MAPPING_VERSION,
            policy_version: LOG_POLICY_VERSION,
          });
        }
        // A selection gone from a feed that did return prices this poll was withdrawn: logged as price 0,
        // so availability at +5/+10/+20 can be rebuilt. A failed fetch never counts as a withdrawal.
        const feedsWithData = new Set(quotes.map((q) => q.feed));
        for (const key of Object.keys(state.quotes)) {
          if (seen.has(key)) continue;
          const [feed, book, market, line, selection] = key.split('|') as [string, string, string, string, string];
          if (feedsWithData.has(feed) && state.quotes[key]!.price > 0) {
            quoteRows.push({
              match_id: fx.matchId,
              feed,
              book,
              market,
              line: line === '' ? null : Number(line),
              selection,
              price: 0,
              first_seen_at: nowIso,
              source_ts: null,
              ts_source: feed === 'oddsnet' ? 'book' : 'capture',
              mapping_version: MAPPING_VERSION,
              policy_version: LOG_POLICY_VERSION,
            });
          }
          delete state.quotes[key];
        }
        quotesByMatch.set(fx.matchId, quotes);

        // Arms wait for a second poll, so a price can be confirmed (seen unchanged on an earlier poll).
        const toStart = fx.tipMs - nowMs;
        if (!state.arms.main && toStart <= WINDOW_MS && state.lastPoll) {
          const main = await writeArm('main', fx, quotes, state, nowMs, summary);
          if (main) state.arms.main = main.id;
        }
        if (!state.arms.late && toStart <= LATE_MS && state.lastPoll) {
          const late = await writeArm('late', fx, quotes, state, nowMs, summary);
          if (late) state.arms.late = late.id;
        }
        state.lastPoll = { at: nowIso, quotes };
      }
      active[fx.matchId] = fx.tipMs;
      await sharedCache.setJSON(`${STATE_PREFIX}${fx.matchId}`, state, STATE_TTL_S);
    }

    const quoteErrors = summary.errors.length;
    summary.quotesWritten = await insertBatches('tennis_quotes', quoteRows, summary.errors);
    if (summary.errors.length > quoteErrors) {
      // Some price changes weren't stored: forget them, so the next poll writes them again.
      for (const matchId of quotesByMatch.keys()) {
        const state = await sharedCache.getJSON<MatchState>(`${STATE_PREFIX}${matchId}`);
        if (state) await sharedCache.setJSON(`${STATE_PREFIX}${matchId}`, { ...state, quotes: {} }, STATE_TTL_S);
      }
    }
    summary.heartbeats = await insertBatches('tennis_poll_heartbeats', heartbeats, summary.errors);
    await updatePriceChecks(quotesByMatch, nowMs, summary);
    await archiveRaw('oddsnet', rawNet, nowIso, summary);
    await archiveRaw('scrapers', rawScraped, nowIso, summary);

    // Matches that dropped off the fixture list (started, finished) without a close: close out from the last poll.
    const current = new Set(fixtures.map((f) => f.matchId));
    for (const [matchId, tipMs] of Object.entries(active)) {
      if (current.has(matchId)) continue;
      const state = await sharedCache.getJSON<MatchState>(`${STATE_PREFIX}${matchId}`);
      if (state && !state.arms.close && state.lastPoll) {
        const { data: m } = await supabaseAdmin.from('tennis_matches').select('best_of, is_grand_slam, tier, home_id, away_id').eq('match_id', matchId).maybeSingle();
        if (m) {
          const fx: Fixture = {
            next: { isGrandSlam: m.is_grand_slam } as TennisNextGame,
            matchId,
            homeId: m.home_id,
            awayId: m.away_id,
            tipMs,
            bestOf: m.best_of,
            rules: matchRules(m.best_of, m.is_grand_slam),
            tier: m.tier,
          };
          const close = await writeArm('close', fx, state.lastPoll.quotes, state, Date.parse(state.lastPoll.at), summary);
          if (close) {
            state.arms.close = close.id;
            await writeClv(fx, state, close, summary);
            await sharedCache.setJSON(`${STATE_PREFIX}${matchId}`, state, STATE_TTL_S);
          }
        }
      }
      delete active[matchId];
    }
    await sharedCache.setJSON(ACTIVE_KEY, active, STATE_TTL_S);

    await markEnded(nowMs, summary);
    await gradeFinished(nowMs, summary);
    await expireRaw(nowMs, summary);
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await sharedCache.deleteJSON(LOCK_KEY).catch(() => undefined);
  }
  await recordRun(summary, nowMs).catch(() => undefined);
  return summary;
}

export type TennisLogRunStats = {
  date: string;
  runs: number;
  runsWithErrors: number;
  lastRunAt: string | null;
  maxGapMinutes: number;
  quotesWritten: number;
  shadowBets: number;
  graded: number;
  arms: Record<string, number>;
  recentErrors: Array<{ at: string; error: string }>;
};

export const RUN_STATS_PREFIX = 'tennis_log_runs_v1:';

/** Daily run counters for the health check: errors otherwise only reach the cron's HTTP response. */
async function recordRun(summary: TennisLogSummary, nowMs: number): Promise<void> {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const key = `${RUN_STATS_PREFIX}${date}`;
  const prev = (await sharedCache.getJSON<TennisLogRunStats>(key)) ?? { date, runs: 0, runsWithErrors: 0, lastRunAt: null, maxGapMinutes: 0, quotesWritten: 0, shadowBets: 0, graded: 0, arms: {}, recentErrors: [] };
  const lastAt = prev.lastRunAt ?? (await sharedCache.getJSON<TennisLogRunStats>(`${RUN_STATS_PREFIX}${new Date(nowMs - 24 * H).toISOString().slice(0, 10)}`))?.lastRunAt ?? null;
  const gap = lastAt ? (nowMs - Date.parse(lastAt)) / 60_000 : 0;
  const arms = { ...prev.arms };
  for (const [arm, n] of Object.entries(summary.arms)) arms[arm] = (arms[arm] ?? 0) + n;
  const errors = summary.errors.filter((e) => e !== 'Previous run still going');
  const next: TennisLogRunStats = {
    date,
    runs: prev.runs + 1,
    runsWithErrors: prev.runsWithErrors + (errors.length ? 1 : 0),
    lastRunAt: new Date(nowMs).toISOString(),
    maxGapMinutes: Math.max(prev.maxGapMinutes, Math.round(gap)),
    quotesWritten: prev.quotesWritten + summary.quotesWritten,
    shadowBets: prev.shadowBets + summary.shadowBets,
    graded: prev.graded + summary.graded,
    arms,
    recentErrors: [...prev.recentErrors, ...errors.slice(0, 3).map((error) => ({ at: new Date(nowMs).toISOString(), error: error.slice(0, 300) }))].slice(-20),
  };
  await sharedCache.setJSON(key, next, 14 * 24 * 60 * 60);
}
