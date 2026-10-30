/**
 * Australian lag measurement (agreed build spec, Part B stage 4). Every minute, for games inside 2 hours
 * of tip: DraftKings and FanDuel from BallDontLie (one request per game, no odds-api.net credits). When
 * both move the same way, each Australian book's quote at that moment is noted and the game's AU prices
 * are pulled from odds-api.net no faster than the feed's own refresh interval, under a daily cap, until
 * each book follows or 30 minutes pass. Lag runs from the US books' scrape time to the AU book's own
 * as-of time, so neither feed's delivery delay is in it. Every poll is logged with the clock drift.
 */

import { nbaPlayerLines, nbaRosterEntry, resolveNbaBoardName } from '@/lib/aiPicks/candidates/nba';
import { isAussieBook } from '@/lib/aiPicks/candidates/types';
import type { NblPropMarket } from '@/lib/aiPicks/markets';
import { getNbaOddsCache } from '@/lib/nba/dash/odds';
import { fetchNbaOddsNetProps } from '@/lib/nba/dash/oddsApiNet';
import type { NbaGameOdds, NbaPlayerPropsByBook } from '@/lib/nba/dash/oddsTypes';
import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { auFollowed, detectUsMoves, usLines, type AuQuote, type BdlPropRow, type UsLine } from './rules';

const STATE_KEY = 'nba_lag_state_v1';
const STATE_TTL_S = 24 * 60 * 60;
const WINDOW_MS = 2 * 60 * 60 * 1000;
const EVENT_MS = 30 * 60 * 1000;
/** odds-api.net pulls for lag follow-ups per UTC day (each is a few credits). */
export const AU_DAILY_CAP = 500;
const MIN_AU_GAP_MS = 60_000;

type BookFollow = { before: AuQuote; sourceTs: string | null; followedAt?: string; after?: AuQuote };
type PendingEvent = {
  id: string;
  gameId: string;
  playerId: string;
  name: string;
  stat: NblPropMarket;
  direction: -1 | 1;
  usMoveAt: string;
  usFrom: Record<string, { line: number; fairOver: number }>;
  usTo: Record<string, { line: number; fairOver: number }>;
  au: Record<string, BookFollow>;
  deadline: number;
};
type LagState = {
  us: Record<string, Record<string, UsLine>>;
  events: PendingEvent[];
  au: Record<string, { lastPullMs: number; refreshSec: number }>;
  day: string;
  auPulls: number;
};

/** Each AU book's main quote for a player and stat: its most balanced over/under, else its milestone nearest the line. */
export function auQuotes(props: NbaPlayerPropsByBook | undefined, name: string, stat: NblPropMarket, nearLine: number, times: Record<string, string> = {}): Record<string, BookFollow> {
  const names = Object.values(props ?? {}).flatMap((players) => Object.keys(players ?? {}));
  const roster = [nbaRosterEntry('p', name)];
  const matched = [...new Set(names.filter((n) => resolveNbaBoardName(n, roster) === 'p'))];
  if (!matched.length) return {};
  const lines = nbaPlayerLines({ playerProps: props } as NbaGameOdds, matched).filter((l) => l.stat === stat && isAussieBook(l.book));
  const out: Record<string, BookFollow> = {};
  for (const book of new Set(lines.map((l) => l.book))) {
    const mine = lines.filter((l) => l.book === book);
    const twoWay = mine.filter((l) => l.kind === 'ou' && l.overDecimal && l.underDecimal).sort((a, b) => Math.abs(a.overDecimal! - a.underDecimal!) - Math.abs(b.overDecimal! - b.underDecimal!))[0];
    const pick = twoWay ?? mine.filter((l) => l.overDecimal).sort((a, b) => Math.abs(a.line - nearLine) - Math.abs(b.line - nearLine))[0];
    if (pick) out[book] = { before: { line: pick.line, over: pick.overDecimal, under: pick.underDecimal }, sourceTs: times[book] ?? null };
  }
  return out;
}

async function fetchUsProps(gameId: string): Promise<{ rows: BdlPropRow[]; driftMs: number | null }> {
  const key = String(process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').replace(/^Bearer\s+/i, '').trim();
  const sentAt = Date.now();
  const res = await fetch(`https://api.balldontlie.io/v2/odds/player_props?game_id=${encodeURIComponent(gameId)}&vendors[]=draftkings&vendors[]=fanduel`, {
    headers: { Authorization: key },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`BallDontLie ${res.status}`);
  const server = Date.parse(res.headers.get('date') ?? '');
  const json = (await res.json()) as { data?: BdlPropRow[] };
  return { rows: json.data ?? [], driftMs: Number.isFinite(server) ? Math.round((sentAt + Date.now()) / 2 - server) : null };
}

export type LagSummary = { games: number; usPolls: number; moves: number; auPulls: number; capReached: boolean; resolved: number; pending: number; errors: string[] };

export async function runLagPoll(nowMs = Date.now()): Promise<LagSummary> {
  const nowIso = new Date(nowMs).toISOString();
  const day = nowIso.slice(0, 10);
  const summary: LagSummary = { games: 0, usPolls: 0, moves: 0, auPulls: 0, capReached: false, resolved: 0, pending: 0, errors: [] };
  const board = await getNbaOddsCache();
  const state: LagState = (await sharedCache.getJSON<LagState>(STATE_KEY)) ?? { us: {}, events: [], au: {}, day, auPulls: 0 };
  if (state.day !== day) Object.assign(state, { day, auPulls: 0 });
  const games = (board?.games ?? []).filter((g) => {
    const tip = Date.parse(g.commenceTime);
    return tip > nowMs && tip - nowMs <= WINDOW_MS;
  });
  summary.games = games.length;
  const pollLog: Array<Record<string, unknown>> = [];

  // US side: one request per game per minute.
  const newMoves: Array<{ game: NbaGameOdds; move: ReturnType<typeof detectUsMoves>[number] }> = [];
  for (const game of games) {
    try {
      const { rows, driftMs } = await fetchUsProps(game.gameId);
      const next = usLines(rows);
      const prev = new Map(Object.entries(state.us[game.gameId] ?? {}));
      const moves = prev.size ? detectUsMoves(prev, next) : [];
      state.us[game.gameId] = Object.fromEntries(next);
      summary.usPolls += 1;
      for (const move of moves) newMoves.push({ game, move });
      pollLog.push({ game_id: game.gameId, polled_at: nowIso, triggers: moves.map((m) => `us:${m.key}`), cap_reached: false, clock_drift_ms: driftMs });
    } catch (err) {
      summary.errors.push(`US ${game.gameId}: ${err instanceof Error ? err.message : err}`);
    }
  }
  summary.moves = newMoves.length;

  if (newMoves.length) {
    const ids = [...new Set(newMoves.map((m) => Number(m.move.playerId)))];
    const { data } = await supabaseAdmin.from('nba_players').select('id, full_name').in('id', ids);
    const names = new Map((data ?? []).map((p) => [String(p.id), String(p.full_name)]));
    for (const { game, move } of newMoves) {
      const name = names.get(move.playerId);
      if (!name) continue;
      const usLine = Object.values(move.from)[0]?.line ?? 0;
      const au = auQuotes(game.playerProps, name, move.stat, usLine, game.propBookTimes ?? {});
      if (!Object.keys(au).length) continue;
      state.events.push({
        id: `${game.gameId}|${move.key}|${nowMs}`,
        gameId: game.gameId,
        playerId: move.playerId,
        name,
        stat: move.stat,
        direction: move.direction,
        usMoveAt: move.movedAt ?? nowIso,
        usFrom: move.from,
        usTo: move.to,
        au,
        deadline: nowMs + EVENT_MS,
      });
    }
  }

  // AU side: games with open events, at the feed's own pace, under the daily cap.
  const tipOf = new Map((board?.games ?? []).map((g) => [g.gameId, g]));
  for (const gameId of new Set(state.events.map((e) => e.gameId))) {
    const game = tipOf.get(gameId);
    if (!game || Date.parse(game.commenceTime) <= nowMs) continue;
    const last = state.au[gameId];
    if (last && nowMs - last.lastPullMs < Math.max(MIN_AU_GAP_MS, last.refreshSec * 1000)) continue;
    if (state.auPulls >= AU_DAILY_CAP) {
      if (!summary.capReached) pollLog.push({ game_id: gameId, polled_at: nowIso, triggers: ['au:cap'], cap_reached: true, clock_drift_ms: null });
      summary.capReached = true;
      continue;
    }
    try {
      const pull = await fetchNbaOddsNetProps([{ gameId, homeTeam: game.homeTeam, awayTeam: game.awayTeam, tipMs: Date.parse(game.commenceTime) }]);
      state.auPulls += 1;
      summary.auPulls += 1;
      state.au[gameId] = { lastPullMs: nowMs, refreshSec: pull.refreshSeconds.get(gameId) ?? 60 };
      const fresh = pull.props.get(gameId);
      const times = pull.bookTimes.get(gameId) ?? {};
      const events = state.events.filter((e) => e.gameId === gameId);
      for (const e of events) {
        const now = auQuotes(fresh, e.name, e.stat, Object.values(e.usFrom)[0]?.line ?? 0, times);
        for (const [book, follow] of Object.entries(e.au)) {
          if (follow.followedAt || !now[book]) continue;
          if (auFollowed(follow.before, now[book]!.before, e.direction)) {
            follow.followedAt = times[book] ?? nowIso;
            follow.after = now[book]!.before;
          }
        }
      }
      pollLog.push({ game_id: gameId, polled_at: nowIso, triggers: events.map((e) => `au:${e.id}`), cap_reached: false, clock_drift_ms: null });
      const { saveNbaOddsNetPull } = await import('@/lib/nba/dash/oddsIngest');
      await saveNbaOddsNetPull(pull).catch(() => 0);
    } catch (err) {
      summary.errors.push(`AU ${gameId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Resolve events: every book followed, the window closed, or the game started.
  const lagRows: Array<Record<string, unknown>> = [];
  state.events = state.events.filter((e) => {
    const game = tipOf.get(e.gameId);
    const started = !game || Date.parse(game.commenceTime) <= nowMs;
    const allFollowed = Object.values(e.au).every((f) => f.followedAt);
    if (!started && !allFollowed && nowMs < e.deadline) return true;
    for (const [book, f] of Object.entries(e.au)) {
      const from = Object.values(e.usFrom);
      const to = Object.values(e.usTo);
      lagRows.push({
        game_id: e.gameId,
        player_id: e.playerId,
        stat: e.stat,
        trigger_kind: 'us_move',
        us_move_at: e.usMoveAt,
        us_line_from: from[0]?.line ?? null,
        us_line_to: to[0]?.line ?? null,
        us_fair_from: from[0]?.fairOver ?? null,
        us_fair_to: to[0]?.fairOver ?? null,
        us_books_moved: { from: e.usFrom, to: e.usTo },
        book,
        au_line_before: f.before.line,
        au_over_before: f.before.over,
        au_under_before: f.before.under,
        au_source_ts_before: f.sourceTs,
        au_followed_at: f.followedAt ?? null,
        au_line_after: f.after?.line ?? null,
        au_over_after: f.after?.over ?? null,
        au_under_after: f.after?.under ?? null,
        lag_seconds: f.followedAt ? Math.round((Date.parse(f.followedAt) - Date.parse(e.usMoveAt)) / 1000) : null,
      });
    }
    summary.resolved += 1;
    return false;
  });
  summary.pending = state.events.length;
  for (const id of Object.keys(state.us)) if (!tipOf.has(id) || Date.parse(tipOf.get(id)!.commenceTime) <= nowMs) delete state.us[id];

  if (lagRows.length) {
    const { error } = await supabaseAdmin.from('nba_au_lag').insert(lagRows);
    if (error) summary.errors.push(`nba_au_lag: ${error.message}`);
  }
  if (pollLog.length) {
    const { error } = await supabaseAdmin.from('nba_poll_log').insert(pollLog);
    if (error) summary.errors.push(`nba_poll_log: ${error.message}`);
  }
  await sharedCache.setJSON(STATE_KEY, state, STATE_TTL_S);
  return summary;
}
