/**
 * Cash top8 arm: market-EV shopping on NBA player props, capped at 8 posts per US-East day.
 * Mirrors the profit-mine winner (Arm A EV ≥ 3%, top 8/day). Pure; fixed for cash-v1.
 */

import { bettableQuote, distinctPrices, legCandidateKey, type AiCandidate, type CandidateQuote } from '@/lib/aiPicks/candidates/types';
import { NBA_HOLD_MS, nbaHoldReason, POST_HORIZON_MS, type Proposal } from '@/lib/aiPicks/decide/select';
import { gameIdentity, MIN_LEAD_MS } from '@/lib/aiPicks/decide/timing';
import { isNblPropMarket } from '@/lib/aiPicks/markets';
import { evPerUnit, round } from '@/lib/aiPicks/model/math';
import { AI_CASH_TRACK } from '@/lib/aiPicks/params';
import { AI_PICK_MIN_PRICE, type AiPick } from '@/lib/aiPicks/types';

export const CASH_LIMITS = {
  minPrice: AI_PICK_MIN_PRICE,
  maxPrice: 2.5,
  minBooks: 2,
  /** Same floor as shadow Arm A (MODEL_V0.minEv). */
  minMarketEv: 0.03,
  /** Soft-quote ceiling: beyond this is usually a feed error (Arm D). */
  maxMarketEv: 0.2,
  windowMs: POST_HORIZON_MS,
  /** Profit-mine sweet spot. */
  perDay: 8,
  /** One scan should not dump the whole day if the board is wide. */
  perRun: 8,
  /** Keep a slate from stacking one game. */
  perGame: 2,
  units: 1,
} as const;

export const CASH_TZ = 'America/New_York';

const BLOCKING_FLAG =
  /Fewer than|Has not played|Not enough|Only one side|far apart|Listed out|Longer than the main line|No two-way price at this line|Alternate line/;

type Check = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });

export function cashDayKey(iso: string | number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CASH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Admin is banned on Bet365 — never the posted book for cash-v1. Quotes still keep it for logging/fair. */
export function isCashBlockedBook(book: string): boolean {
  const k = book.toLowerCase().replace(/[^a-z0-9]/g, '');
  return k === 'bet365' || k.startsWith('bet365');
}

/** Best bettable AU quote excluding Bet365; full quote list is unchanged on the candidate. */
export function cashBettable(quotes: CandidateQuote[]) {
  return bettableQuote(quotes.filter((q) => !isCashBlockedBook(q.book)));
}

/** Best AU (non-Bet365) price vs market fair (0 = fair). */
export function cashMarketEv(c: Pick<AiCandidate, 'marketProb' | 'bestPrice' | 'pushProb'>): number | null {
  return c.marketProb == null ? null : round(evPerUnit(c.marketProb, c.bestPrice, c.pushProb), 4);
}

/**
 * Record the market fair as the model probability, and re-pick the posted book/price without Bet365.
 * Other books (including Bet365) stay on `quotes` for alts / logging.
 */
export function cashCandidate(c: AiCandidate): AiCandidate | null {
  if (c.marketProb == null) return null;
  const picked = cashBettable(c.quotes);
  if (!picked) return null;
  const bestPrice = picked.best.price;
  const bestBook = picked.best.book;
  const ev = round(evPerUnit(c.marketProb, bestPrice, c.pushProb), 4);
  return { ...c, bestPrice, bestBook, prob: c.marketProb, ev };
}

export function cashEligible(c: AiCandidate, nowMs: number): Check {
  if (c.sport !== 'nba' || !c.player || c.line == null || !isNblPropMarket(c.market)) return no('Not an NBA player prop');
  if (c.side !== 'over' && c.side !== 'under') return no('Not an over/under');
  if (c.marketKind !== 'main' || c.context.marketSource !== 'main') return no('Not the main over/under line');
  const toStart = Date.parse(c.startsAt) - nowMs;
  if (!(toStart > MIN_LEAD_MS) || toStart > CASH_LIMITS.windowMs) return no('Outside the posting window');
  if (toStart > NBA_HOLD_MS) {
    const hold = nbaHoldReason(c);
    if (hold) return no(hold);
  }
  const flag = c.flags.find((f) => BLOCKING_FLAG.test(f));
  if (flag) return no(flag);
  if (distinctPrices(c.quotes).length < CASH_LIMITS.minBooks) return no('Fewer than 2 books price it');
  if (c.bestPrice < CASH_LIMITS.minPrice || c.bestPrice > CASH_LIMITS.maxPrice) return no('Price outside range');
  const ev = cashMarketEv(c);
  if (ev == null) return no('No fair market price');
  if (ev < CASH_LIMITS.minMarketEv) return no('Market EV under 3%');
  if (ev > CASH_LIMITS.maxMarketEv) return no('Market EV too high to trust');
  return { ok: true };
}

export type CashState = {
  dayKey: string;
  /** Confirmed posts already on this US-East day. */
  dayCount: number;
  propsByGame: Record<string, number>;
  keys: Set<string>;
  players: Set<string>;
};

export function cashPostedState(picks: AiPick[], nowMs: number): CashState {
  const dayKey = cashDayKey(nowMs);
  const state: CashState = { dayKey, dayCount: 0, propsByGame: {}, keys: new Set(), players: new Set() };
  for (const pick of picks) {
    if (pick.track !== AI_CASH_TRACK) continue;
    const postedMs = Date.parse(pick.postedAt);
    if (cashDayKey(postedMs) === dayKey) {
      state.dayCount += 1;
      for (const leg of pick.legs) {
        const game = gameIdentity(leg);
        state.propsByGame[game] = (state.propsByGame[game] ?? 0) + 1;
        if (leg.player) state.players.add(leg.player.toLowerCase());
      }
    }
    for (const leg of pick.legs) state.keys.add(legCandidateKey(leg));
  }
  return state;
}

/** Highest market EV first. */
export function cashOrder(a: AiCandidate, b: AiCandidate): number {
  return (cashMarketEv(b) ?? 0) - (cashMarketEv(a) ?? 0) || a.key.localeCompare(b.key);
}

/**
 * Fill remaining day slots with the fattest EV lines: one player once, ≤2 props/game, ≤8/ET day.
 */
export function chooseCash(cands: AiCandidate[], state: CashState, nowMs: number, closed: ReadonlySet<string> = new Set()): AiCandidate[] {
  const room = Math.max(0, CASH_LIMITS.perDay - state.dayCount);
  if (!room) return [];
  const ranked = cands
    .filter((c) => cashEligible(c, nowMs).ok)
    .filter((c) => !closed.has(c.key) && !state.keys.has(c.key))
    .sort(cashOrder);
  const out: AiCandidate[] = [];
  const takenByGame: Record<string, number> = {};
  const takenPlayers = new Set<string>();
  for (const c of ranked) {
    if (out.length >= Math.min(room, CASH_LIMITS.perRun)) break;
    const game = gameIdentity(c);
    const player = (c.player ?? '').toLowerCase();
    if (player && (state.players.has(player) || takenPlayers.has(player))) continue;
    const posted = state.propsByGame[game] ?? 0;
    const run = takenByGame[game] ?? 0;
    if (posted + run >= CASH_LIMITS.perGame) continue;
    takenByGame[game] = run + 1;
    if (player) takenPlayers.add(player);
    out.push(c);
  }
  return out;
}

export function cashProposal(c: AiCandidate): Proposal {
  const evPct = ((cashMarketEv(c) ?? c.ev) * 100).toFixed(1);
  return {
    kind: 'single',
    key: c.key,
    sport: c.sport,
    legs: [{ c, price: c.bestPrice, book: c.bestBook }],
    price: c.bestPrice,
    book: c.bestBook,
    prob: c.prob,
    ev: c.ev,
    reason: `Cash top8: market EV ${evPct}% at ${c.bestBook}`,
  };
}

export function cashWriteUp(c: AiCandidate): string {
  const evPct = ((cashMarketEv(c) ?? c.ev) * 100).toFixed(1);
  return `Cash top8 (nba-cash-v1): ${c.player} ${c.side} ${c.line} ${c.market} at $${c.bestPrice.toFixed(2)} (${c.bestBook}). Market EV ${evPct}% vs consensus fair — daily top-8 by EV.`;
}
