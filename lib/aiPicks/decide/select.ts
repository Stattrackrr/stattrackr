/**
 * Which plays get posted: singles from the strongest qualifying selections, and 2-leg multis from
 * separate games priced at one bookmaker. Pure functions; the runner supplies scan, watchlist and
 * what is already posted.
 */

import { bookPrices } from '@/lib/aiPicks/books';
import { distinctPrices, type AiCandidate } from '@/lib/aiPicks/candidates/types';
import { isNblPropMarket } from '@/lib/aiPicks/markets';
import { round } from '@/lib/aiPicks/model/math';
import type { AiPicksParams, AiSportParams } from '@/lib/aiPicks/params';
import { AI_PICK_MIN_PRICE } from '@/lib/aiPicks/types';
import { gameIdentity, heldUp, MIN_LEAD_MS, readiness, type WatchPoint } from '@/lib/aiPicks/decide/timing';

export const POST_HORIZON_MS = 24 * 60 * 60 * 1000;
/**
 * Caps run over any rolling 24 hours, not the Sydney calendar day, so picks spread through the day
 * instead of all landing just after midnight.
 */
export const PICK_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Same-sport singles are spaced out; a standout edge only needs the shorter gap. */
export const SINGLE_GAP_MS = 3 * 60 * 60 * 1000;
export const STANDOUT_SINGLE_GAP_MS = 60 * 60 * 1000;
/** A single whose edge is at least this multiple of the sport's minimum is a standout. */
export const STANDOUT_EV_MULTIPLE = 2;
/** Hard ceiling per sport per window; only standouts go past maxSinglesPerDay toward it. */
export const MAX_SINGLES_CEILING = 5;
export const MAX_MULTIS_PER_WINDOW = 3;
export const MULTI_GAP_MS = 3 * 60 * 60 * 1000;
/** Multis are two likely outcomes, not two long shots. */
const MAX_MULTI_PRICE = 3.5;
const MIN_LEG_PROB = 0.55;
const MIN_LEG_SUPPORT = 0.6;
const MIN_BOOKS = 2;
const MIN_MODEL_LEAN = 0.01;
/** Multi legs considered per run, best EV first. */
const MAX_LEG_POOL = 40;

export type Watched = { c: AiCandidate; history: WatchPoint[] };

export type ProposalLeg = { c: AiCandidate; price: number; book: string };
export type Proposal = {
  kind: 'single' | 'multi';
  /** Watchlist key: the candidate key for a single, `multi|a||b` for a multi. */
  key: string;
  sport: string;
  legs: ProposalLeg[];
  price: number;
  book: string;
  prob: number;
  ev: number;
  reason: string;
};

/** What is already posted (or ruled out) that limits the next choices. "Recent" is the last PICK_WINDOW_MS. */
export type PostedState = {
  /** Posting times (ms) of recent singles, per sport. */
  singlesRecent: Record<string, number[]>;
  /** Posting times (ms) of recent multis. */
  multisRecent: number[];
  /** Candidate keys already in a posted pick. */
  usedKeys: Set<string>;
  /** Games that had a recent single. */
  singleGamesRecent: Set<string>;
  /** `sport|player` with a recent single. */
  playersRecent: Set<string>;
  /** Selections (`game|market|who`) already backed, to stop over and under on the same thing. */
  selectionsBacked: Set<string>;
  /** Subjects (see subjectId) already in any posted pick, single or multi leg. */
  subjectsUsed: Set<string>;
};

export function sportParams(params: AiPicksParams, sport: string): AiSportParams {
  return sport === 'tennis' ? params.tennis : params.nbl;
}

export function selectionId(
  c: Pick<AiCandidate, 'eventKey' | 'eventLabel' | 'startsAt' | 'market' | 'player' | 'team'> & { sport: string }
): string {
  const who = (c.player || (c.sport === 'tennis' ? '' : c.team) || '').toLowerCase();
  return `${gameIdentity(c)}|${c.market}|${who}`;
}

/**
 * What a bet is really about; only one pick may be on each. A tennis match is one subject (handicap,
 * games, sets and winner all ride on the same result), an NBL player in a game is one, and an NBL
 * game's own lines (head to head, line, total) are one.
 */
export function subjectId(
  c: Pick<AiCandidate, 'eventKey' | 'eventLabel' | 'startsAt' | 'market' | 'player'> & { sport: string }
): string {
  const game = gameIdentity(c);
  if (c.sport === 'tennis') return game;
  if (isNblPropMarket(c.market) && c.player) return `${game}|player|${c.player.toLowerCase()}`;
  return `${game}|game`;
}

type Check = { ok: true } | { ok: false; reason: string };

function common(c: AiCandidate, p: AiSportParams, nowMs: number): Check {
  const toStart = Date.parse(c.startsAt) - nowMs;
  if (!(toStart > MIN_LEAD_MS) || toStart > POST_HORIZON_MS) return { ok: false, reason: 'Outside the posting window' };
  // Books on a shared feed post identical prices, so a price only counts once.
  if (distinctPrices(c.quotes).length < MIN_BOOKS) return { ok: false, reason: 'Fewer than 2 books price it' };
  if (c.supportScore != null && c.supportScore < p.minSupport) return { ok: false, reason: 'Support too thin' };
  // An edge that is only one book being generous, with our own numbers no better than the market, is not a play.
  if (c.modelProb != null && c.marketProb != null && c.modelProb < c.marketProb + MIN_MODEL_LEAN) {
    return { ok: false, reason: 'Model does not back it' };
  }
  // NBL props wait for the over/under board: milestones alone cannot be checked against a fair line.
  if (c.sport === 'nbl' && isNblPropMarket(c.market) && c.context.marketSource !== 'main') {
    return { ok: false, reason: 'Over/under lines not out yet' };
  }
  return { ok: true };
}

export function qualifiesSingle(c: AiCandidate, params: AiPicksParams, nowMs: number): Check {
  const p = sportParams(params, c.sport);
  if (!c.singleEligible) return { ok: false, reason: 'Not single eligible' };
  if (c.ev < p.minEvSingle) return { ok: false, reason: 'Edge below the single minimum' };
  return common(c, p, nowMs);
}

export function qualifiesLeg(c: AiCandidate, params: AiPicksParams, nowMs: number): Check {
  const p = sportParams(params, c.sport);
  if (!c.multiEligible) return { ok: false, reason: 'Not multi eligible' };
  if (c.ev < p.minEvLeg) return { ok: false, reason: 'Edge below the leg minimum' };
  return common(c, p, nowMs);
}

function rankScore(c: AiCandidate): number {
  return c.ev * (0.8 + 0.4 * (c.supportScore ?? 0.5));
}

function conflicts(c: AiCandidate, state: PostedState): boolean {
  return state.usedKeys.has(c.key) || state.selectionsBacked.has(selectionId(c)) || state.subjectsUsed.has(subjectId(c));
}

export function isStandoutSingle(c: Pick<AiCandidate, 'ev'>, p: AiSportParams): boolean {
  return c.ev >= p.minEvSingle * STANDOUT_EV_MULTIPLE;
}

/** Room for another single in this sport: under the cap (standouts up to the ceiling) and spaced from the last one. */
export function singleSlotOpen(c: AiCandidate, p: AiSportParams, state: PostedState, nowMs: number): boolean {
  const times = state.singlesRecent[c.sport] ?? [];
  const standout = isStandoutSingle(c, p);
  if (times.length >= MAX_SINGLES_CEILING) return false;
  if (times.length >= p.maxSinglesPerDay && !standout) return false;
  if (!times.length) return true;
  return nowMs - Math.max(...times) >= (standout ? STANDOUT_SINGLE_GAP_MS : SINGLE_GAP_MS);
}

/** Ready singles in posting order: one per sport per run, spaced and capped per sport, one per game and player. */
export function chooseSingles(watched: Watched[], params: AiPicksParams, state: PostedState, nowMs: number): Proposal[] {
  const out: Proposal[] = [];
  const takenSports = new Set<string>();
  const ready = watched
    .filter((w) => qualifiesSingle(w.c, params, nowMs).ok)
    .map((w) => ({ w, r: readiness(w.c, w.history, { nowMs, postWindowHours: sportParams(params, w.c.sport).postWindowHours, minEv: sportParams(params, w.c.sport).minEvSingle }) }))
    .filter((x) => x.r.ready)
    .sort((a, b) => rankScore(b.w.c) - rankScore(a.w.c));
  for (const { w, r } of ready) {
    const c = w.c;
    const p = sportParams(params, c.sport);
    if (takenSports.has(c.sport)) continue;
    if (!singleSlotOpen(c, p, state, nowMs)) continue;
    if (conflicts(c, state)) continue;
    if (state.singleGamesRecent.has(gameIdentity(c))) continue;
    if (c.player && state.playersRecent.has(`${c.sport}|${c.player.toLowerCase()}`)) continue;
    takenSports.add(c.sport);
    out.push({
      kind: 'single',
      key: c.key,
      sport: c.sport,
      legs: [{ c, price: c.bestPrice, book: c.bestBook }],
      price: c.bestPrice,
      book: c.bestBook,
      prob: c.prob,
      ev: c.ev,
      reason: r.reason,
    });
  }
  return out;
}

export function multiKey(keys: string[]): string {
  return `multi|${[...keys].sort().join('||')}`;
}

/**
 * Best ready 2-leg multi: legs from different games, both bettable at one book, combined price
 * at least 1.65, and positive EV after treating the legs as independent.
 */
export function chooseMulti(
  watched: Watched[],
  params: AiPicksParams,
  state: PostedState,
  nowMs: number,
  exclude: { keys: Set<string>; rejected: Set<string>; subjects?: Set<string> }
): Proposal | null {
  if (state.multisRecent.length >= MAX_MULTIS_PER_WINDOW) return null;
  if (state.multisRecent.length && nowMs - Math.max(...state.multisRecent) < MULTI_GAP_MS) return null;
  const pool = watched
    .filter((w) => w.c.prob >= MIN_LEG_PROB && (w.c.supportScore == null || w.c.supportScore >= MIN_LEG_SUPPORT))
    .filter((w) => qualifiesLeg(w.c, params, nowMs).ok && heldUp(w.history, nowMs))
    .filter((w) => !conflicts(w.c, state) && !exclude.keys.has(w.c.key) && !exclude.subjects?.has(subjectId(w.c)))
    .sort((a, b) => b.c.ev - a.c.ev)
    .slice(0, MAX_LEG_POOL);
  let best: Proposal | null = null;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const [a, b] = [pool[i]!, pool[j]!].sort((x, y) => Date.parse(x.c.startsAt) - Date.parse(y.c.startsAt));
      if (gameIdentity(a.c) === gameIdentity(b.c)) continue;
      const key = multiKey([a.c.key, b.c.key]);
      if (exclude.rejected.has(key)) continue;
      const first = sportParams(params, a.c.sport);
      const r = readiness(a.c, a.history, { nowMs, postWindowHours: first.postWindowHours, minEv: first.minEvLeg });
      if (!r.ready) continue;
      const pa = bookPrices(a.c.quotes);
      const pb = bookPrices(b.c.quotes);
      let pick: { qa: { book: string; price: number }; qb: { book: string; price: number }; price: number } | null = null;
      for (const [k, qa] of pa) {
        const qb = pb.get(k);
        if (!qb) continue;
        const price = qa.price * qb.price;
        if (price < AI_PICK_MIN_PRICE || price > MAX_MULTI_PRICE) continue;
        if (!pick || price > pick.price) pick = { qa, qb, price };
      }
      if (!pick) continue;
      const prob = a.c.prob * b.c.prob;
      const ev = prob * pick.price - 1;
      const minEv = Math.max(first.minEvSingle, sportParams(params, b.c.sport).minEvSingle);
      if (ev < minEv) continue;
      if (best && ev <= best.ev) continue;
      best = {
        kind: 'multi',
        key,
        sport: a.c.sport === b.c.sport ? a.c.sport : 'mixed',
        legs: [
          { c: a.c, price: pick.qa.price, book: pick.qa.book },
          { c: b.c, price: pick.qb.price, book: pick.qb.book },
        ],
        price: round(pick.price, 3),
        book: pick.qa.book,
        prob: round(prob, 4),
        ev: round(ev, 4),
        reason: r.reason,
      };
    }
  }
  return best;
}
