/**
 * The AU prices on the NBA board refresh every 15 minutes (faster near tip), so a soft book's price
 * can be gone by the time a pick posts. Before a pick goes up, its game is pulled fresh from
 * odds-api.net and the candidate repriced from that pull. Board prices are never posted.
 */

import { isNbaAchievementMarket } from '@/lib/aiPicks/markets';
import { evPerUnit, round } from '@/lib/aiPicks/model/math';
import type { AiSportParams } from '@/lib/aiPicks/params';
import { nbaAchievementQuotes, nbaPlayerLines } from './nba';
import { gameQuotes, propSelections } from './nbl';
import { BLOCKING_FLAG, bettableQuote, edgeFlag, eligibility, isAussieBook, type AiCandidate, type CandidateQuote } from './types';
import type { AiPickMarketKind } from '@/lib/aiPicks/types';
import type { NblGameOdds } from '@/lib/nbl/oddsTypes';
import { normalizeNbaPropPlayerName } from '@/lib/nba/dash/odds';
import { fetchNbaOddsNetProps, isNbaOddsNetBook, isNbaOddsNetGameBook } from '@/lib/nba/dash/oddsApiNet';
import type { NbaBookRow, NbaGameOdds, NbaPlayerPropsByBook } from '@/lib/nba/dash/oddsTypes';

/** Posted book's odds-api.net as_of must be this fresh, or the quote is dropped. */
export const MAX_LIVE_BOOK_AGE_MS = 20 * 60 * 1000;

export type NbaLiveGame = {
  props: NbaPlayerPropsByBook;
  lines: NbaBookRow[];
  /** odds-api.net bookmaker_as_of per stored book name. */
  bookTimes: Record<string, string>;
};

/** Books whose NBA prices come from odds-api.net (the ones the live pull can confirm). */
export function isLiveCheckedBook(book: string): boolean {
  return isNbaOddsNetBook(book) || isNbaOddsNetGameBook(book);
}

/** Missing as_of is treated as fresh (feed sometimes omits a book); a parsed old stamp is not. */
export function isFreshBook(asOf: string | null | undefined, nowMs: number, maxAgeMs = MAX_LIVE_BOOK_AGE_MS): boolean {
  if (asOf == null || asOf === '') return true;
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return true;
  return nowMs - t <= maxAgeMs;
}

/** NBA must have a successful live pull; other sports keep scan prices. */
export function keepNbaAfterLivePull(sport: string, liveHit: boolean): boolean {
  return sport !== 'nba' || liveHit;
}

function bookTimeLookup(bookTimes: Record<string, string> | undefined, book: string): string | undefined {
  if (!bookTimes) return undefined;
  const raw = book.toLowerCase().trim();
  if (bookTimes[raw]) return bookTimes[raw];
  const compact = raw.replace(/[^a-z0-9]/g, '');
  for (const [key, iso] of Object.entries(bookTimes)) {
    const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (k === compact || k === `${compact}au` || `${k}au` === compact) return iso;
  }
  return undefined;
}

/** This selection's prices in a fresh pull; empty when the books no longer offer it. */
export function liveNbaQuotes(c: AiCandidate, live: NbaLiveGame): CandidateQuote[] {
  if (c.player) {
    // The board renames odds-api.net spellings ("Jared Mccain") to BallDontLie's when they normalise the same.
    const boardNames = Array.isArray(c.context.boardNames) ? (c.context.boardNames as string[]) : [c.player];
    const wanted = new Set(boardNames.map(normalizeNbaPropPlayerName));
    const names = [
      ...new Set(Object.values(live.props).flatMap((players) => Object.keys(players).filter((n) => wanted.has(normalizeNbaPropPlayerName(n))))),
    ];
    const odds = { playerProps: live.props } as NbaGameOdds;
    if (isNbaAchievementMarket(c.market)) {
      return c.side === 'over' ? nbaAchievementQuotes(odds, names, c.market).map((q) => ({ book: q.book, price: q.yes })) : [];
    }
    // Milestones fold into the over at the same line, so side and line pick out one selection.
    const sel = propSelections(nbaPlayerLines(odds, names).filter((l) => l.stat === c.market)).find(
      (s) => s.side === c.side && s.line === c.line
    );
    return sel?.quotes ?? [];
  }
  const q = gameQuotes({ bookmakers: live.lines } as unknown as NblGameOdds);
  const home = c.side === 'home';
  if (c.market === 'h2h') return (home ? q.h2hHome : c.side === 'away' ? q.h2hAway : []).map(({ book, price }) => ({ book, price }));
  if (c.market === 'spread' && c.line != null) {
    const homeLine = home ? c.line : -c.line;
    return q.spreads
      .filter((s) => s.homeLine === homeLine && (home ? s.home : s.away))
      .map((s) => ({ book: s.book, price: (home ? s.home : s.away)! }));
  }
  if (c.market === 'total' && c.line != null) {
    const over = c.side === 'over';
    return q.totals
      .filter((t) => t.line === c.line && (over ? t.over : t.under))
      .map((t) => ({ book: t.book, price: (over ? t.over : t.under)! }));
  }
  return [];
}

/**
 * The candidate at the live prices: the odds-api.net books' quotes are swapped for the fresh ones
 * (a book that dropped the line or has a stale as_of drops out). Null when no fresh Australian book is left.
 */
export function repriceNbaCandidate(c: AiCandidate, live: NbaLiveGame, params: AiSportParams, nowMs = Date.now()): AiCandidate | null {
  const fresh = liveNbaQuotes(c, live).filter((q) => {
    if (!isAussieBook(q.book)) return false;
    return isFreshBook(bookTimeLookup(live.bookTimes, q.book), nowMs);
  });
  const quotes = [...c.quotes.filter((q) => !isLiveCheckedBook(q.book)), ...fresh];
  const picked = bettableQuote(quotes);
  if (!picked) return null;
  const ev = evPerUnit(c.prob, picked.best.price, c.pushProb);
  const flags = c.flags.filter((f) => !/too big to trust/.test(f));
  const edge = edgeFlag(ev, params.maxTrustedEv);
  if (edge) flags.push(edge);
  const blocked = flags.some((f) => BLOCKING_FLAG.test(f));
  const lineKind = (c.context.lineKind as AiPickMarketKind | undefined) ?? c.marketKind;
  return {
    ...c,
    marketKind: lineKind,
    bestPrice: picked.best.price,
    bestBook: picked.best.book,
    quotes: picked.quotes,
    ev: round(ev),
    flags,
    ...eligibility(picked.best.price, lineKind, blocked, params),
  };
}

/** Fresh odds-api.net pulls for NBA games, keyed by game id; games whose pull failed are left out. */
export async function fetchLiveNbaGames(
  games: Array<{ gameId: string; homeTeam: string; awayTeam: string; startsAt: string }>
): Promise<{ live: Map<string, NbaLiveGame>; requests: number }> {
  const res = await fetchNbaOddsNetProps(
    games.map((g) => ({ gameId: g.gameId, homeTeam: g.homeTeam, awayTeam: g.awayTeam, tipMs: Date.parse(g.startsAt) }))
  );
  // The dashboard and props page read the board: give them the same prices the picks are about to post at.
  const { saveNbaOddsNetPull } = await import('@/lib/nba/dash/oddsIngest');
  const { rebakeNbaPropsPage } = await import('@/lib/nba/dash/propsPageRebake');
  await saveNbaOddsNetPull(res)
    .then((saved) => (saved ? rebakeNbaPropsPage() : null))
    .catch((err) => console.warn('[ai-picks] saving live prices to the board failed:', err instanceof Error ? err.message : err));
  const live = new Map<string, NbaLiveGame>();
  for (const g of games) {
    const props = res.props.get(g.gameId);
    if (res.failed.has(g.gameId) || !props || !Object.keys(props).length) continue;
    live.set(g.gameId, {
      props,
      lines: res.gameLines.get(g.gameId) ?? [],
      bookTimes: res.bookTimes.get(g.gameId) ?? {},
    });
  }
  return { live, requests: res.requests };
}
