/**
 * API-Tennis get_odds as a logging feed. One request covers every match on a date range, keyed by the API-Tennis
 * match key (our match_id), so there is no name matching. Home is API-Tennis's first player, as everywhere else.
 * It carries Pinnacle on almost every singles match including ITF and qualifying, which odds-api.net doesn't
 * list; its "Betfair" is the sportsbook (about 7% margin), not the exchange. Other books are logged for reference.
 * No per-book timestamps: quotes are capture-time only.
 */

import type { QuoteRow } from './quotes';

const API_BASE = 'https://api.api-tennis.com/tennis/';

/** API-Tennis book names to ours. Pinnacle keeps the sharp name; the rest are reference books members can't use. */
export const API_TENNIS_BOOKS: Record<string, string> = {
  Pncl: 'pinnacle',
  Betfair: 'betfair sportsbook',
  bet365: 'bet365 intl',
  WilliamHill: 'williamhill',
  Marathon: 'marathon',
  Sbo: 'sbobet',
  '1xBet': '1xbet',
  BetVictor: 'betvictor',
  Betano: 'betano',
};

/** Logged for reference only: never candidates or would-be bets. */
export const REFERENCE_BOOKS: ReadonlySet<string> = new Set(Object.values(API_TENNIS_BOOKS).filter((b) => b !== 'pinnacle'));

type ByBook = Record<string, string>;
type ByLine = Record<string, ByBook>;

const price = (v: unknown) => {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n > 1 ? Math.round(n * 1000) / 1000 : null;
};
const lineOf = (k: string) => {
  const n = Number.parseFloat(k.replace('+', ''));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
};

/** Every book's quotes for one match on the five logged markets. */
export function apiTennisOddsToQuotes(raw: Record<string, any>, bestOf: number): QuoteRow[] {
  const out: QuoteRow[] = [];
  const push = (apiBook: string, market: QuoteRow['market'], line: number | null, selection: string, p: number | null) => {
    const book = API_TENNIS_BOOKS[apiBook];
    if (book && p != null) out.push({ book, market, line, selection, price: p });
  };
  // A mislabelled side shows up as an impossible pair; only margins between 0 and 15% are kept.
  const sane = (pa: number, pb: number) => {
    const overround = 1 / pa + 1 / pb;
    return overround >= 1 && overround <= 1.15;
  };
  const twoWay = (a: ByBook | undefined, b: ByBook | undefined, emit: (book: string, pa: number, pb: number) => void) => {
    for (const book of Object.keys(a ?? {})) {
      const pa = price(a?.[book]);
      const pb = price(b?.[book]);
      if (pa != null && pb != null && sane(pa, pb)) emit(book, pa, pb);
    }
  };
  const byLine = (a: ByLine | undefined, b: ByLine | undefined, emit: (book: string, line: number, pa: number, pb: number) => void) => {
    for (const key of Object.keys(a ?? {})) {
      const line = lineOf(key);
      if (line == null) continue;
      twoWay(a?.[key], b?.[key], (book, pa, pb) => emit(book, line, pa, pb));
    }
  };

  const h2h = raw['Home/Away'];
  twoWay(h2h?.Home, h2h?.Away, (book, home, away) => {
    push(book, 'match_winner', null, 'home', home);
    push(book, 'match_winner', null, 'away', away);
  });
  // Games handicap: both sides keyed by the home player's line.
  const ah = raw['Asian Handicap (Games)'];
  byLine(ah?.['Asian Handicap (Games) Home'], ah?.['Asian Handicap (Games) Away'], (book, line, home, away) => {
    push(book, 'game_handicap', line, 'home', home);
    push(book, 'game_handicap', line, 'away', away);
  });
  const tot = raw['Over/Under by Games in Match'];
  byLine(tot?.['Over/Under by Games in Match Over'], tot?.['Over/Under by Games in Match Under'], (book, line, over, under) => {
    push(book, 'total_games', line, 'over', over);
    push(book, 'total_games', line, 'under', under);
  });
  for (const [who, name] of [['home', 'Total - Home'], ['away', 'Total - Away']] as const) {
    const m = raw[name];
    byLine(m?.['Total Over'], m?.['Total Under'], (book, line, over, under) => {
      push(book, 'games_won', line, `${who} over`, over);
      push(book, 'games_won', line, `${who} under`, under);
    });
  }
  // Win a set: the book's own market; else "opponent wins in straight sets" (No = yes); else, in best of 3,
  // the set handicaps. API-Tennis labels set handicap sides backwards on some feeds, so within one side and
  // book the shorter of +1.5 / -1.5 is "wins a set" and the longer "wins in straight sets" (as lib/tennis/odds.ts).
  const sets = raw['Asian Handicap (Sets)'];
  const setSide = (side: 'Home' | 'Away') => {
    const lines = (sets?.[`Asian Handicap (Sets) ${side}`] ?? {}) as ByLine;
    const plus = lines['+1.5'] ?? lines['1.5'];
    const minus = lines['-1.5'];
    const winASet: Record<string, number> = {};
    const straight: Record<string, number> = {};
    for (const book of Object.keys(plus ?? {})) {
      const a = price(plus?.[book]);
      const b = price(minus?.[book]);
      if (a == null || b == null || a === b) continue;
      winASet[book] = Math.min(a, b);
      straight[book] = Math.max(a, b);
    }
    return { winASet, straight };
  };
  const handicapSides = bestOf === 3 ? { home: setSide('Home'), away: setSide('Away') } : null;
  for (const [who, player, other] of [['home', 1, 2], ['away', 2, 1]] as const) {
    const done = new Set<string>();
    const emit = (book: string, yes: number, no: number) => {
      if (done.has(book)) return;
      done.add(book);
      push(book, 'win_a_set', null, `${who} yes`, yes);
      push(book, 'win_a_set', null, `${who} no`, no);
    };
    const own = raw[`Win at least one set (Player ${player})`];
    twoWay(own?.Yes, own?.No, emit);
    const otherStraight = raw[`Win In Straigh Sets (Player ${other})`];
    twoWay(otherStraight?.No, otherStraight?.Yes, emit);
    if (handicapSides) {
      const mine = handicapSides[who].winASet;
      const theirs = handicapSides[who === 'home' ? 'away' : 'home'].straight;
      for (const book of Object.keys(mine)) {
        const yes = mine[book]!;
        const no = theirs[book];
        if (no != null && sane(yes, no)) emit(book, yes, no);
      }
    }
  }
  return out;
}

/** All matches' odds for a UTC date range in one request; null on failure (a failed fetch is never "no prices"). */
export async function fetchApiTennisOdds(dateStart: string, dateStop: string): Promise<{ byMatch: Map<string, Record<string, any>>; raw: unknown } | null> {
  const key = String(process.env.API_TENNIS_KEY || '').trim();
  if (!key) return null;
  try {
    const qs = new URLSearchParams({ method: 'get_odds', date_start: dateStart, date_stop: dateStop, APIkey: key });
    const res = await fetch(`${API_BASE}?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json?.success !== 1 && !json?.result) return null;
    const byMatch = new Map<string, Record<string, any>>();
    for (const [id, odds] of Object.entries((json?.result ?? {}) as Record<string, Record<string, any>>)) byMatch.set(String(id), odds);
    return { byMatch, raw: json?.result ?? {} };
  } catch {
    return null;
  }
}
