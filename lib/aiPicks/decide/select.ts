/**
 * Which plays get posted: singles from the strongest qualifying selections, and 2-leg multis from
 * separate games priced at one bookmaker. Pure functions; the runner supplies scan, watchlist and
 * what is already posted.
 */

import { bookPrices } from '@/lib/aiPicks/books';
import { distinctPrices, type AiCandidate } from '@/lib/aiPicks/candidates/types';
import { isNblPropMarket, isPlayerPropMarket } from '@/lib/aiPicks/markets';
import { round } from '@/lib/aiPicks/model/math';
import { paramsForSport, type AiPicksParams, type AiSportParams } from '@/lib/aiPicks/params';
import { AI_PICK_MIN_PRICE } from '@/lib/aiPicks/types';
import { aiDayKey, gameIdentity, heldUp, MIN_LEAD_MS, readiness, type WatchPoint } from '@/lib/aiPicks/decide/timing';

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
/** Multis priced above this are capped per sport per window (sports not listed are uncapped). */
export const LONG_MULTI_PRICE = 2.5;
export const MAX_LONG_MULTIS_PER_WINDOW: Record<string, number> = { tennis: 1 };
/**
 * NBA volume follows the slate (its games in the rolling window): about one single per game, spread
 * as the edges fall, so a game may take two and another none. Limits, not targets.
 */
export const MAX_NBA_SINGLES_PER_GAME = { total: 2, game: 1 };
export const NBA_MIN_SINGLES = 2;
/** Once the slate's singles are used, only an edge this many times the minimum still posts. */
export const NBA_BACKUP_EV_MULTIPLE = 3;
/** NBA singles taken in one run, so one review never carries a whole slate. */
export const MAX_NBA_SINGLES_PER_RUN = 3;
/** NBA-only multis have their own allowance (see nbaMultiCap), spaced by this. */
export const NBA_MULTI_GAP_MS = 60 * 60 * 1000;

export const nbaSinglesCap = (slateGames: number) => Math.max(NBA_MIN_SINGLES, slateGames);
/** Extra places for standout edges past the slate's singles: one per 5 games, at least one. */
export const nbaBackupSingles = (slateGames: number) => Math.max(1, Math.round(slateGames / 5));
/** About one NBA multi per 3 games, 1 to 4. */
export const nbaMultiCap = (slateGames: number) => Math.min(4, Math.max(1, Math.ceil(slateGames / 3)));
/** NBA teams confirm game-time calls from about 90 minutes out; bets a pending call could hurt wait until then. */
export const NBA_HOLD_MS = 90 * 60 * 1000;

/** Listed but not ruled out or cleared: questionable, day-to-day, doubtful, game-time decision. */
export function isNbaGameTimeCall(status: unknown): boolean {
  return /questionable|day.to.day|doubtful|game.?time/i.test(String(status ?? ''));
}

const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * A pending game-time call holds only the bets it could hurt; bets it can only help keep the early price.
 * The model prices a questionable player at his normal role, so no bet comes from the status itself.
 */
export function nbaHoldReason(c: Pick<AiCandidate, 'market' | 'side' | 'context'>): string | null {
  if (isPlayerPropMarket(c.market)) {
    // Sitting voids his own props; only a limited return can cost, and that hurts overs.
    if (c.side === 'over' && isNbaGameTimeCall(c.context.listedStatus)) return 'Questionable: his overs wait until 90 minutes before tip';
    // A teammate sitting only adds to his minutes and shots.
    const mates = names(c.context.waitingOn);
    if (c.side === 'under' && mates.length) return `Waiting on ${mates.join(', ')}: unders hold until 90 minutes before tip`;
    return null;
  }
  const home = names(c.context.waitingOnHome);
  const away = names(c.context.waitingOnAway);
  const hurt = c.market === 'total' ? [...home, ...away] : c.side === 'home' ? home : c.side === 'away' ? away : [];
  return hurt.length ? `Waiting on ${hurt.join(', ')}: holds until 90 minutes before tip` : null;
}
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
  /** Posting times (ms) of recent multis on the shared allowance (any with a non-NBA leg). */
  multisRecent: number[];
  /** Posting times (ms) of recent all-NBA multis. */
  nbaMultisRecent?: number[];
  /** NBA games with a leg in a recent pick. */
  nbaGamesRecent?: Set<string>;
  /** NBA games in the window: upcoming ones plus those already picked (see nbaSlateGames). Unset: no slate limits. */
  nbaSlateGames?: number;
  /** Posting times (ms) of recent multis priced above LONG_MULTI_PRICE, per sport of each leg. */
  longMultisRecent?: Record<string, number[]>;
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
  /** Singles posted per game (gameIdentity), split player props / game lines; for per-game limits. */
  singlesByGame?: Record<string, { prop: number; game: number }>;
};

export function sportParams(params: AiPicksParams, sport: string): AiSportParams {
  return paramsForSport(params, sport);
}

/** Which per-game allowance a single uses. */
export function singleSlotKind(c: Pick<AiCandidate, 'market' | 'player'>): 'prop' | 'game' {
  return isPlayerPropMarket(c.market) && c.player ? 'prop' : 'game';
}

export function selectionId(
  c: Pick<AiCandidate, 'eventKey' | 'eventLabel' | 'startsAt' | 'market' | 'player' | 'team'> & { sport: string }
): string {
  const who = (c.player || (c.sport === 'tennis' ? '' : c.team) || '').toLowerCase();
  return `${gameIdentity(c)}|${c.market}|${who}`;
}

/**
 * What a bet is really about; only one pick may be on each. A tennis match is one subject (handicap,
 * games, sets and winner all ride on the same result), a basketball player in a game is one, and a
 * basketball game's own lines (head to head, line, total) are one.
 */
export function subjectId(
  c: Pick<AiCandidate, 'eventKey' | 'eventLabel' | 'startsAt' | 'market' | 'player'> & { sport: string }
): string {
  const game = gameIdentity(c);
  if (c.sport === 'tennis') return game;
  if (isPlayerPropMarket(c.market) && c.player) return `${game}|player|${c.player.toLowerCase()}`;
  return `${game}|game`;
}

type Check = { ok: true } | { ok: false; reason: string };

function common(c: AiCandidate, p: AiSportParams, nowMs: number): Check {
  const toStart = Date.parse(c.startsAt) - nowMs;
  if (!(toStart > MIN_LEAD_MS) || toStart > POST_HORIZON_MS) return { ok: false, reason: 'Outside the posting window' };
  if (c.sport === 'nba' && toStart > NBA_HOLD_MS) {
    const hold = nbaHoldReason(c);
    if (hold) return { ok: false, reason: hold };
  }
  // Books on a shared feed post identical prices, so a price only counts once.
  if (distinctPrices(c.quotes).length < MIN_BOOKS) return { ok: false, reason: 'Fewer than 2 books price it' };
  if (c.supportScore != null && c.supportScore < p.minSupport) return { ok: false, reason: 'Support too thin' };
  // An edge that is only one book being generous, with our own numbers no better than the market, is not a play.
  if (c.modelProb != null && c.marketProb != null && c.modelProb < c.marketProb + MIN_MODEL_LEAN) {
    return { ok: false, reason: 'Model does not back it' };
  }
  // Basketball props wait for the over/under board: milestones alone cannot be checked against a fair line.
  if ((c.sport === 'nbl' || c.sport === 'nba') && isNblPropMarket(c.market) && c.context.marketSource !== 'main') {
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

/** Room for another NBA single in this game: 2 at most, one of them a game line, counting this run's picks. */
export function nbaGameSlotOpen(c: AiCandidate, state: PostedState, taken: Record<string, { prop: number; game: number }>): boolean {
  const game = gameIdentity(c);
  const posted = state.singlesByGame?.[game];
  const run = taken[game];
  const games = (posted?.game ?? 0) + (run?.game ?? 0);
  const total = (posted?.prop ?? 0) + (run?.prop ?? 0) + games;
  if (total >= MAX_NBA_SINGLES_PER_GAME.total) return false;
  return singleSlotKind(c) !== 'game' || games < MAX_NBA_SINGLES_PER_GAME.game;
}

/** Room for another NBA single on the slate: one per game, then a few more for standout edges. */
export function nbaSlateOpen(c: AiCandidate, p: AiSportParams, state: PostedState, takenThisRun: number): boolean {
  if (state.nbaSlateGames == null) return true;
  const used = (state.singlesRecent.nba?.length ?? 0) + takenThisRun;
  const cap = nbaSinglesCap(state.nbaSlateGames);
  const backup = c.ev >= p.minEvSingle * NBA_BACKUP_EV_MULTIPLE ? nbaBackupSingles(state.nbaSlateGames) : 0;
  return used < cap + backup;
}

/** NBA games in the window: those still to come (from the scan) and those already in a recent pick. */
export function nbaSlateGames(state: PostedState, upcoming: Array<Pick<AiCandidate, 'sport' | 'eventKey' | 'eventLabel' | 'startsAt'>>): number {
  const games = new Set(state.nbaGamesRecent ?? []);
  for (const c of upcoming) if (c.sport === 'nba') games.add(gameIdentity(c));
  return games.size;
}

/**
 * Ready singles in posting order, one per player. NBL and tennis: one per sport per run, spaced and
 * capped per sport, one per game. NBA: per-game and slate limits (up to MAX_NBA_SINGLES_PER_RUN a run).
 */
export function chooseSingles(watched: Watched[], params: AiPicksParams, state: PostedState, nowMs: number): Proposal[] {
  const out: Proposal[] = [];
  const takenSports = new Set<string>();
  const nbaTaken: Record<string, { prop: number; game: number }> = {};
  let nbaCount = 0;
  const ready = watched
    .filter((w) => qualifiesSingle(w.c, params, nowMs).ok)
    .map((w) => ({ w, r: readiness(w.c, w.history, { nowMs, postWindowHours: sportParams(params, w.c.sport).postWindowHours, minEv: sportParams(params, w.c.sport).minEvSingle }) }))
    .filter((x) => x.r.ready)
    .sort((a, b) => rankScore(b.w.c) - rankScore(a.w.c));
  const chosenSubjects = new Set<string>();
  for (const { w, r } of ready) {
    const c = w.c;
    const p = sportParams(params, c.sport);
    if (conflicts(c, state) || chosenSubjects.has(subjectId(c))) continue;
    if (c.player && state.playersRecent.has(`${c.sport}|${c.player.toLowerCase()}`)) continue;
    if (c.sport === 'nba') {
      if (nbaCount >= MAX_NBA_SINGLES_PER_RUN || !nbaGameSlotOpen(c, state, nbaTaken) || !nbaSlateOpen(c, p, state, nbaCount)) continue;
      const slot = (nbaTaken[gameIdentity(c)] ??= { prop: 0, game: 0 });
      slot[singleSlotKind(c)] += 1;
      nbaCount += 1;
    } else {
      if (takenSports.has(c.sport)) continue;
      if (!singleSlotOpen(c, p, state, nowMs)) continue;
      if (state.singleGamesRecent.has(gameIdentity(c))) continue;
      takenSports.add(c.sport);
    }
    chosenSubjects.add(subjectId(c));
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

/** A leg's sport has used its allowance of long-priced multis this window. */
function longMultiFull(state: PostedState, sports: string[]): boolean {
  return sports.some((s) => {
    const cap = MAX_LONG_MULTIS_PER_WINDOW[s];
    return cap != null && (state.longMultisRecent?.[s]?.length ?? 0) >= cap;
  });
}

export function multiKey(keys: string[]): string {
  return `multi|${[...keys].sort().join('||')}`;
}

const allowanceOpen = (times: number[], cap: number, gapMs: number, nowMs: number) =>
  times.length < cap && !(times.length && nowMs - Math.max(...times) < gapMs);

/** Basketball multis are built from short lines (20+ PRA rather than 25+); tennis legs, where multis have paid, are not capped. */
export const MAX_BASKETBALL_LEG_PRICE = 1.5;

function legPriceOk(sport: string, price: number): boolean {
  return sport === 'tennis' || price <= MAX_BASKETBALL_LEG_PRICE;
}

/**
 * A single could still be posted on this player (or game) under the per-game and per-sport limits.
 * Such subjects stay out of multis: one pick per subject, so a leg would rule the single out.
 */
export function singleRoomFor(c: AiCandidate, params: AiPicksParams, state: PostedState): boolean {
  const p = sportParams(params, c.sport);
  if (c.player && state.playersRecent.has(`${c.sport}|${c.player.toLowerCase()}`)) return false;
  if (c.sport === 'nba') return nbaGameSlotOpen(c, state, {}) && nbaSlateOpen(c, p, state, 0);
  const cap = isStandoutSingle(c, p) ? MAX_SINGLES_CEILING : p.maxSinglesPerDay;
  return (state.singlesRecent[c.sport]?.length ?? 0) < cap && !state.singleGamesRecent.has(gameIdentity(c));
}

/** Tennis legs may run overnight (7pm then 3am) but not most of a day apart. */
export const TENNIS_MULTI_MAX_GAP_MS = 12 * 60 * 60 * 1000;

/**
 * Two legs can share a multi: basketball (NBA and NBL) never mixes with tennis. Basketball legs start
 * on the same Sydney day, even when tomorrow's game is inside the 24-hour window; tennis legs start
 * within TENNIS_MULTI_MAX_GAP_MS of each other.
 */
export function multiLegsCompatible(
  a: Pick<AiCandidate, 'sport' | 'startsAt'>,
  b: Pick<AiCandidate, 'sport' | 'startsAt'>
): boolean {
  if ((a.sport === 'tennis') !== (b.sport === 'tennis')) return false;
  if (a.sport === 'tennis') return Math.abs(Date.parse(a.startsAt) - Date.parse(b.startsAt)) <= TENNIS_MULTI_MAX_GAP_MS;
  return aiDayKey(a.startsAt) === aiDayKey(b.startsAt);
}

/**
 * Best ready 2-leg multi: legs from different games that can be combined (see multiLegsCompatible), both
 * bettable at one book, combined price at least 1.65, and positive EV after treating the legs as
 * independent. All-NBA multis go on the NBA allowance (sized to the slate); any other on the shared one.
 */
export function chooseMulti(
  watched: Watched[],
  params: AiPicksParams,
  state: PostedState,
  nowMs: number,
  exclude: { keys: Set<string>; rejected: Set<string>; subjects?: Set<string> }
): Proposal | null {
  const sharedOpen = allowanceOpen(state.multisRecent, MAX_MULTIS_PER_WINDOW, MULTI_GAP_MS, nowMs);
  const nbaOpen = allowanceOpen(state.nbaMultisRecent ?? [], nbaMultiCap(state.nbaSlateGames ?? 0), NBA_MULTI_GAP_MS, nowMs);
  if (!sharedOpen && !nbaOpen) return null;
  const forSingles = new Set(
    watched
      .filter((w) => qualifiesSingle(w.c, params, nowMs).ok && !conflicts(w.c, state) && singleRoomFor(w.c, params, state))
      .map((w) => subjectId(w.c))
  );
  const pool = watched
    .filter((w) => w.c.prob >= MIN_LEG_PROB && (w.c.supportScore == null || w.c.supportScore >= MIN_LEG_SUPPORT))
    .filter((w) => qualifiesLeg(w.c, params, nowMs).ok && heldUp(w.history, nowMs))
    .filter((w) => !conflicts(w.c, state) && !exclude.keys.has(w.c.key) && !exclude.subjects?.has(subjectId(w.c)))
    .filter((w) => !forSingles.has(subjectId(w.c)))
    .sort((a, b) => b.c.ev - a.c.ev)
    .slice(0, MAX_LEG_POOL);
  let best: Proposal | null = null;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const [a, b] = [pool[i]!, pool[j]!].sort((x, y) => Date.parse(x.c.startsAt) - Date.parse(y.c.startsAt));
      if (gameIdentity(a.c) === gameIdentity(b.c) || !multiLegsCompatible(a.c, b.c)) continue;
      if (a.c.sport === 'nba' && b.c.sport === 'nba' ? !nbaOpen : !sharedOpen) continue;
      const key = multiKey([a.c.key, b.c.key]);
      if (exclude.rejected.has(key)) continue;
      const maxPrice = longMultiFull(state, [a.c.sport, b.c.sport]) ? LONG_MULTI_PRICE : MAX_MULTI_PRICE;
      const first = sportParams(params, a.c.sport);
      // Posting early takes the same strong edge a single needs, so a multi never jumps ahead of one.
      const r = readiness(a.c, a.history, { nowMs, postWindowHours: first.postWindowHours, minEv: first.minEvSingle });
      if (!r.ready) continue;
      const pa = bookPrices(a.c.quotes);
      const pb = bookPrices(b.c.quotes);
      let pick: { qa: { book: string; price: number }; qb: { book: string; price: number }; price: number } | null = null;
      for (const [k, qa] of pa) {
        const qb = pb.get(k);
        if (!qb) continue;
        if (!legPriceOk(a.c.sport, qa.price) || !legPriceOk(b.c.sport, qb.price)) continue;
        const price = qa.price * qb.price;
        if (price < AI_PICK_MIN_PRICE || price > maxPrice) continue;
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
