/**
 * One book's prices for one match as quote rows on the five in-scope markets (spec section 1), always in
 * API-Tennis home/away orientation:
 *   match_winner   selection home | away                      line null
 *   game_handicap  selection home | away                      line = the home player's games handicap
 *   total_games    selection over | under                     line
 *   games_won      selection home over | home under | away over | away under, line
 *   win_a_set      selection home yes | home no | away yes | away no, line null
 * Prices are decimal. Selections that pair up (home/away, over/under, yes/no) make one two-way market.
 */

import type { SourceMatch } from '@/lib/tennis/extraBooks/shared';

export const LOG_MARKETS = ['match_winner', 'game_handicap', 'total_games', 'games_won', 'win_a_set'] as const;
export type LogMarket = (typeof LOG_MARKETS)[number];

/** Raised whenever the mapping from book markets to these rows changes, so old rows can be told apart. */
export const MAPPING_VERSION = 'tennis-map-1';

export type QuoteRow = { book: string; market: LogMarket; line: number | null; selection: string; price: number };

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 1;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** The source match seen from API-Tennis's home player. */
function oriented(src: SourceMatch, homeIsHome: boolean): SourceMatch {
  if (homeIsHome) return src;
  const hc = (h: { homeLine: number; home: number; away: number }) => ({ homeLine: -h.homeLine, home: h.away, away: h.home });
  return {
    ...src,
    home: src.away,
    away: src.home,
    h2h: src.h2h ? { home: src.h2h.away, away: src.h2h.home } : undefined,
    handicaps: src.handicaps.map(hc),
    setHandicaps: src.setHandicaps.map(hc),
    homeGames: src.awayGames,
    awayGames: src.homeGames,
    homeWinSet: src.awayWinSet,
    awayWinSet: src.homeWinSet,
  };
}

export function sourceToQuotes(source: SourceMatch, homeIsHome: boolean, bestOf: number, book = source.book): QuoteRow[] {
  const src = oriented(source, homeIsHome);
  const out: QuoteRow[] = [];
  const push = (market: LogMarket, line: number | null, selection: string, price: number | undefined) => {
    if (ok(price)) out.push({ book, market, line: line == null ? null : round(line), selection, price: round(price) });
  };
  if (src.h2h) {
    push('match_winner', null, 'home', src.h2h.home);
    push('match_winner', null, 'away', src.h2h.away);
  }
  for (const h of src.handicaps) {
    push('game_handicap', h.homeLine, 'home', h.home);
    push('game_handicap', h.homeLine, 'away', h.away);
  }
  for (const t of src.totals) {
    push('total_games', t.line, 'over', t.over);
    push('total_games', t.line, 'under', t.under);
  }
  for (const [who, rows] of [
    ['home', src.homeGames],
    ['away', src.awayGames],
  ] as const) {
    for (const g of rows) {
      push('games_won', g.line, `${who} over`, g.over);
      push('games_won', g.line, `${who} under`, g.under);
    }
  }
  // Win a set: the book's own market, else (best of 3 only) the +1.5 set handicap, which is the same bet.
  const winSet = (who: 'home' | 'away') => {
    const own = who === 'home' ? src.homeWinSet : src.awayWinSet;
    if (own) return own;
    if (bestOf !== 3) return undefined;
    const want = who === 'home' ? 1.5 : -1.5;
    const row = src.setHandicaps.find((h) => Math.abs(h.homeLine - want) < 0.01);
    if (!row) return undefined;
    return who === 'home' ? { yes: row.home, no: row.away } : { yes: row.away, no: row.home };
  };
  for (const who of ['home', 'away'] as const) {
    const w = winSet(who);
    if (!w) continue;
    push('win_a_set', null, `${who} yes`, w.yes);
    push('win_a_set', null, `${who} no`, w.no);
  }
  return out;
}

/** The selection that pairs with this one in its two-way market. */
export function partner(selection: string): string {
  const swaps: Record<string, string> = { home: 'away', away: 'home', over: 'under', under: 'over', yes: 'no', no: 'yes' };
  const parts = selection.split(' ');
  const last = parts.pop()!;
  if (!parts.length) return swaps[last] ?? last;
  return [...parts, swaps[last] ?? last].join(' ');
}

/** Stable key of one quote: book, market, line and selection. */
export const quoteKey = (q: Pick<QuoteRow, 'book' | 'market' | 'line' | 'selection'>) => `${q.book}|${q.market}|${q.line ?? ''}|${q.selection}`;
