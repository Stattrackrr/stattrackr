/**
 * Which punter-arm cases become bets. The reasons qualify the play (see angles.ts); this is the
 * price discipline and the limits. The market's fair price is the recorded probability, so the arm's
 * record and closing-line value show whether the reasons beat a market that already knows them.
 * Pure; fixed for the track version.
 */

import { distinctPrices, legCandidateKey, type AiCandidate } from '@/lib/aiPicks/candidates/types';
import {
  MAX_NBA_SINGLES_PER_GAME,
  MAX_NBA_SINGLES_PER_RUN,
  nbaBackupSingles,
  nbaHoldReason,
  nbaSinglesCap,
  NBA_HOLD_MS,
  PICK_WINDOW_MS,
  POST_HORIZON_MS,
  type Proposal,
} from '@/lib/aiPicks/decide/select';
import { gameIdentity, MIN_LEAD_MS } from '@/lib/aiPicks/decide/timing';
import { isNblPropMarket, type NblPropMarket } from '@/lib/aiPicks/markets';
import { evPerUnit, round } from '@/lib/aiPicks/model/math';
import { AI_PUNTER_TRACK } from '@/lib/aiPicks/params';
import { AI_PICK_MIN_PRICE, type AiPick } from '@/lib/aiPicks/types';
import type { PunterCase } from './angles';

export const PUNTER_LIMITS = {
  /** Even-money range, the prices this style of bet is taken at. */
  minPrice: AI_PICK_MIN_PRICE,
  maxPrice: 2.5,
  minBooks: 2,
  /**
   * Best Australian price against the market's fair price: at most a normal bookmaker margin under
   * it (a 1.87/1.87 market is 6.5% under on each side). The case picks the bet; this only refuses
   * a price worse than an ordinary one...
   */
  minMarketEv: -0.07,
  /** ...and a price this far over it is a stale or mis-keyed quote, not a gift. */
  maxMarketEv: 0.15,
  /**
   * Bet as soon as the case is there, as far out as the live picks post: the early price is the
   * point, before the books move the line on the same reasons. Only a pending game-time call waits.
   */
  windowMs: POST_HORIZON_MS,
  /**
   * Volume matches live NBA singles (select.ts): slate-sized 24h cap, up to MAX_NBA_SINGLES_PER_RUN
   * a scan, up to MAX_NBA_SINGLES_PER_GAME.total props a game. Not a fixed 3/day.
   */
  perRun: MAX_NBA_SINGLES_PER_RUN,
  units: 1,
} as const;

/** A case this strong may fill a live-style slate "standout / backup" place. */
export const PUNTER_BACKUP_CORE = 4;

/** Data problems that rule a line out. The live model's own disagreements with the market do not apply here. */
export const PUNTER_BLOCKING_FLAG =
  /Fewer than|Has not played|Not enough|Only one side|far apart|Listed out|Longer than the main line|No two-way price at this line|Alternate line/;

type Check = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });

/** Value of the best price against the market's own fair price (0 = fair, negative = paying margin). */
export function punterMarketEv(c: Pick<AiCandidate, 'marketProb' | 'bestPrice' | 'pushProb'>): number | null {
  return c.marketProb == null ? null : round(evPerUnit(c.marketProb, c.bestPrice, c.pushProb), 4);
}

/**
 * The candidate as this arm records it: the market's fair chance is the probability and the edge is
 * the price against it. Null when the market has no fair price for the line.
 */
export function punterCandidate(c: AiCandidate): AiCandidate | null {
  const ev = punterMarketEv(c);
  if (c.marketProb == null || ev == null) return null;
  return { ...c, prob: c.marketProb, ev };
}

export function punterEligible(c: AiCandidate, nowMs: number): Check {
  if (c.sport !== 'nba' || !c.player || c.line == null || !isNblPropMarket(c.market)) return no('Not an NBA player prop');
  if (c.side !== 'over' && c.side !== 'under') return no('Not an over/under');
  if (c.marketKind !== 'main' || c.context.marketSource !== 'main') return no('Not the main over/under line');
  const toStart = Date.parse(c.startsAt) - nowMs;
  if (!(toStart > MIN_LEAD_MS) || toStart > PUNTER_LIMITS.windowMs) return no('Outside the posting window');
  if (toStart > NBA_HOLD_MS) {
    const hold = nbaHoldReason(c);
    if (hold) return no(hold);
  }
  const flag = c.flags.find((f) => PUNTER_BLOCKING_FLAG.test(f));
  if (flag) return no(flag);
  if (distinctPrices(c.quotes).length < PUNTER_LIMITS.minBooks) return no('Fewer than 2 books price it');
  if (c.bestPrice < PUNTER_LIMITS.minPrice || c.bestPrice > PUNTER_LIMITS.maxPrice) return no('Price outside 1.65 to 2.50');
  const ev = punterMarketEv(c);
  if (ev == null) return no('No fair market price');
  if (ev < PUNTER_LIMITS.minMarketEv) return no("Best price is too far under the market's fair price");
  if (ev > PUNTER_LIMITS.maxMarketEv) return no('Price too far over the market to trust');
  return { ok: true };
}

export type PunterEntry = { c: AiCandidate; case: PunterCase };

/** Lines that add stats together. The reasons are about one thing he does; a combined line also rides on the rest. */
const COMBINED: ReadonlySet<NblPropMarket> = new Set(['pra', 'pr', 'pa', 'ra']);

/**
 * The better case first: most reasons, then the single stat the reasons are about before a combined
 * line, then the softer (or tougher) matchup. Price only separates cases that are otherwise level.
 */
export function punterOrder(a: PunterEntry, b: PunterEntry): number {
  return (
    b.case.core - a.case.core ||
    Number(COMBINED.has(a.case.stat)) - Number(COMBINED.has(b.case.stat)) ||
    b.case.matchup - a.case.matchup ||
    (punterMarketEv(b.c) ?? 0) - (punterMarketEv(a.c) ?? 0) ||
    a.c.key.localeCompare(b.c.key)
  );
}

/** What this arm has already bet: its own picks only, never the live ones. */
export type PunterState = {
  /** Posting times (ms) in the last 24 hours. */
  recent: number[];
  /** Prop singles already posted per game identity in the window. */
  propsByGame: Record<string, number>;
  /** Games seen on this arm (for slate size when the scan is thin). */
  games: Set<string>;
  keys: Set<string>;
  /** Players already taken in the window (one pick per player, like live). */
  players: Set<string>;
  /** NBA games in the rolling window (upcoming + already picked); unset = no slate cap. */
  slateGames?: number;
};

export function punterPostedState(picks: AiPick[], nowMs: number): PunterState {
  const state: PunterState = { recent: [], propsByGame: {}, games: new Set(), keys: new Set(), players: new Set() };
  for (const pick of picks) {
    if (pick.track !== AI_PUNTER_TRACK) continue;
    const postedMs = Date.parse(pick.postedAt);
    const recent = postedMs > nowMs - PICK_WINDOW_MS;
    if (recent) state.recent.push(postedMs);
    for (const leg of pick.legs) {
      const game = gameIdentity(leg);
      state.games.add(game);
      state.keys.add(legCandidateKey(leg));
      if (recent) {
        state.propsByGame[game] = (state.propsByGame[game] ?? 0) + 1;
        if (leg.player) state.players.add(leg.player.toLowerCase());
      }
    }
  }
  return state;
}

/** Room on the slate: live NBA singles cap (about one per game) plus backup places for strong cases. */
export function punterSlateOpen(e: PunterEntry, state: PunterState, takenThisRun: number): boolean {
  if (state.slateGames == null) return true;
  const used = state.recent.length + takenThisRun;
  const cap = nbaSinglesCap(state.slateGames);
  const backup = e.case.core >= PUNTER_BACKUP_CORE ? nbaBackupSingles(state.slateGames) : 0;
  return used < cap + backup;
}

/**
 * Qualifying cases in posting order: the better case first (punterOrder), never the better price
 * ahead of it. Volume matches live NBA singles: slate 24h cap, MAX_NBA_SINGLES_PER_RUN a scan,
 * up to MAX_NBA_SINGLES_PER_GAME.total props a game, one pick per player.
 */
export function choosePunter(entries: PunterEntry[], state: PunterState, nowMs: number, closed: ReadonlySet<string> = new Set()): PunterEntry[] {
  const ranked = entries
    .filter((e) => e.case.qualifies && e.case.side === e.c.side && punterEligible(e.c, nowMs).ok)
    .filter((e) => !closed.has(e.c.key) && !state.keys.has(e.c.key))
    .sort(punterOrder);
  const out: PunterEntry[] = [];
  const takenByGame: Record<string, number> = {};
  const takenPlayers = new Set<string>();
  for (const e of ranked) {
    if (out.length >= PUNTER_LIMITS.perRun) break;
    const game = gameIdentity(e.c);
    const player = (e.c.player ?? '').toLowerCase();
    if (player && (state.players.has(player) || takenPlayers.has(player))) continue;
    const posted = state.propsByGame[game] ?? 0;
    const run = takenByGame[game] ?? 0;
    if (posted + run >= MAX_NBA_SINGLES_PER_GAME.total) continue;
    if (!punterSlateOpen(e, state, out.length)) continue;
    takenByGame[game] = run + 1;
    if (player) takenPlayers.add(player);
    out.push(e);
  }
  return out;
}

export function punterProposal(e: PunterEntry): Proposal {
  const c = e.c;
  const reasons = e.case.angles.filter((a) => a.kind !== 'support').map((a) => a.key);
  return {
    kind: 'single',
    key: c.key,
    sport: c.sport,
    legs: [{ c, price: c.bestPrice, book: c.bestBook }],
    price: c.bestPrice,
    book: c.bestBook,
    prob: c.prob,
    ev: c.ev,
    reason: `Punter case: ${reasons.join(' + ')}`,
  };
}
