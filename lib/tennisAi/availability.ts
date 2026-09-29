import { americanToDecimal } from '@/lib/currencyUtils';
import { MARKET_REGISTRY } from '@/lib/tennisAi/registry';
import type { AvailableMarket, BookQuote, MarketKey, SelectionSide } from '@/lib/tennisAi/types';
import { tennisOuLinePlausible, type TennisBookRow, type TennisMatchOdds, type TennisOuLine } from '@/lib/tennis/oddsTypes';

export const DEFAULT_STALE_MS = 10 * 60 * 1000;
/**
 * The tennis odds cron runs every 30 minutes and skips a snapshot younger than 25.
 * Treat the board as current until that cycle has had time to replace it.
 */
export const FEED_STALE_MS = 40 * 60 * 1000;

export function decimalFromBook(raw: string | null | undefined): number | null {
  if (raw == null || raw === 'N/A') return null;
  const text = String(raw).trim();
  const n = Number.parseFloat(text.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (text.includes('+') || n >= 100 || n <= -100) {
    const dec = americanToDecimal(n);
    return Number.isFinite(dec) && dec > 1 ? Math.round(dec * 100) / 100 : null;
  }
  if (n > 1 && n < 100) return Math.round(n * 100) / 100;
  return null;
}

function lineNumber(raw: string | null | undefined): number | null {
  const n = Number.parseFloat(String(raw ?? '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function quote(book: string, decimalOdds: number | null, fetchedAt: string | null): BookQuote | null {
  if (decimalOdds == null) return null;
  return { book, decimalOdds, fetchedAt };
}

function bestQuote(rows: BookQuote[]): BookQuote | null {
  return rows.reduce<BookQuote | null>((best, row) => {
    if (!best || row.decimalOdds > best.decimalOdds) return row;
    return best;
  }, null);
}

function pairMarket(input: {
  key: MarketKey;
  selection: SelectionSide;
  opposite: SelectionSide;
  line: number | null;
  score?: string | null;
  quotes: BookQuote[];
  oppositeQuotes: BookQuote[];
  stale: boolean;
  featured?: boolean;
}): AvailableMarket {
  const definition = MARKET_REGISTRY[input.key];
  const priceable = input.quotes.length > 0 && input.oppositeQuotes.length > 0;
  return {
    key: input.key,
    name: definition.name,
    selection: input.selection,
    opposite: input.opposite,
    line: input.line,
    score: input.score ?? null,
    model: definition.model,
    priceable,
    stale: input.stale,
    featured: input.featured ?? false,
    quotes: input.quotes,
    oppositeQuotes: input.oppositeQuotes,
    best: bestQuote(input.quotes),
    bestOpposite: bestQuote(input.oppositeQuotes),
  };
}

const SELECTOR_MIN = 1.65;
const SELECTOR_MAX = 2.5;

function halfPoint(line: number): boolean {
  return Math.abs(Math.abs(line) % 1 - 0.5) < 0.01;
}

/** Same lines the tennis chart will list: half point, both sides, price in the selector band. */
function chartLines(book: TennisBookRow, stat: 'spread' | 'totalGames' | 'gamesWon' | 'totalSets'): TennisOuLine[] {
  const raw =
    stat === 'spread'
      ? book.SpreadLines?.length
        ? book.SpreadLines
        : [book.Spread]
      : stat === 'totalGames'
        ? book.TotalLines?.length
          ? book.TotalLines
          : [book.Total]
        : stat === 'gamesWon'
          ? book.GamesWonLines?.length
            ? book.GamesWonLines
            : [book.GamesWon]
          : book.TotalSetsLines?.length
            ? book.TotalSetsLines
            : [book.TotalSets];
  return raw.filter((row) => {
    if (!tennisOuLinePlausible(stat, row.line)) return false;
    const line = lineNumber(row.line);
    if (line == null || !halfPoint(line)) return false;
    const over = decimalFromBook(row.over);
    const under = decimalFromBook(row.under);
    return (
      over != null &&
      under != null &&
      over >= SELECTOR_MIN &&
      over <= SELECTOR_MAX &&
      under >= SELECTOR_MIN &&
      under <= SELECTOR_MAX
    );
  });
}

function evenness(row: TennisOuLine): number {
  const over = decimalFromBook(row.over);
  const under = decimalFromBook(row.under);
  if (over == null || under == null) return Number.POSITIVE_INFINITY;
  return Math.abs(over - under);
}

/** The line the chart opens on for this market. */
function chartMainLine(books: TennisBookRow[], stat: 'spread' | 'totalGames' | 'gamesWon' | 'totalSets'): number | null {
  let bestLine: number | null = null;
  let bestEven = Number.POSITIVE_INFINITY;
  for (const book of books) {
    const lines = chartLines(book, stat);
    if (!lines.length) continue;
    const nums = lines
      .map((row) => lineNumber(row.line))
      .filter((line): line is number => line != null)
      .sort((a, b) => a - b);
    const mid = nums[Math.floor(nums.length / 2)];
    const near = lines.filter((row) => {
      const line = lineNumber(row.line);
      return line != null && mid != null && Math.abs(line - mid) <= 2;
    });
    const pool = near.length ? near : lines;
    const main = [...pool].sort((a, b) => evenness(a) - evenness(b))[0];
    const line = main ? lineNumber(main.line) : null;
    const gap = main ? evenness(main) : Number.POSITIVE_INFINITY;
    if (line != null && gap < bestEven) {
      bestEven = gap;
      bestLine = line;
    }
  }
  return bestLine;
}

/**
 * Markets that have a live quote. One-sided prices stay in the list as unpriceable
 * so the answer layer can say the market exists but cannot be de-vigged.
 */
export function resolveAvailableMarkets(
  odds: TennisMatchOdds | null | undefined,
  opts?: { now?: number; staleAfterMs?: number; fetchedAt?: string | null }
): AvailableMarket[] {
  if (!odds?.bookmakers?.length) return [];
  const fetchedAt = opts?.fetchedAt ?? odds.fetchedAt ?? null;
  const now = opts?.now ?? Date.now();
  const staleAfter = opts?.staleAfterMs ?? DEFAULT_STALE_MS;
  const age = fetchedAt ? now - Date.parse(fetchedAt) : Number.POSITIVE_INFINITY;
  const stale = !Number.isFinite(age) || age > staleAfter;
  const books = odds.bookmakers;
  const out: AvailableMarket[] = [];

  const mlPlayer: BookQuote[] = [];
  const mlOpp: BookQuote[] = [];
  for (const book of books) {
    const home = quote(book.name, decimalFromBook(book.H2H?.home), fetchedAt);
    const away = quote(book.name, decimalFromBook(book.H2H?.away), fetchedAt);
    if (home) mlPlayer.push(home);
    if (away) mlOpp.push(away);
  }
  if (mlPlayer.length || mlOpp.length) {
    out.push(
      pairMarket({
        key: 'MATCH_WINNER',
        selection: 'PLAYER',
        opposite: 'OPPONENT',
        line: null,
        quotes: mlPlayer,
        oppositeQuotes: mlOpp,
        stale,
        featured: true,
      })
    );
    out.push(
      pairMarket({
        key: 'MATCH_WINNER',
        selection: 'OPPONENT',
        opposite: 'PLAYER',
        line: null,
        quotes: mlOpp,
        oppositeQuotes: mlPlayer,
        stale,
        featured: true,
      })
    );
  }

  pushOu(out, books, 'TOTAL_GAMES', 'totalGames', 'OVER', 'UNDER', fetchedAt, stale, false);
  pushOu(out, books, 'GAME_HANDICAP', 'spread', 'PLAYER', 'OPPONENT', fetchedAt, stale, true);
  pushOu(out, books, 'PLAYER_TOTAL_GAMES', 'gamesWon', 'OVER', 'UNDER', fetchedAt, stale, false);
  pushOu(out, books, 'TOTAL_SETS', 'totalSets', 'OVER', 'UNDER', fetchedAt, stale, false);
  return out;
}

function pushOu(
  out: AvailableMarket[],
  books: TennisBookRow[],
  key: MarketKey,
  stat: 'spread' | 'totalGames' | 'gamesWon' | 'totalSets',
  overSide: SelectionSide,
  underSide: SelectionSide,
  fetchedAt: string | null,
  stale: boolean,
  negateOppositeLine = false
) {
  const main = chartMainLine(books, stat);
  const byLine = new Map<number, { over: BookQuote[]; under: BookQuote[] }>();
  for (const book of books) {
    for (const row of chartLines(book, stat)) {
      const line = lineNumber(row.line);
      if (line == null) continue;
      const bucket = byLine.get(line) || { over: [], under: [] };
      const over = quote(book.name, decimalFromBook(row.over), fetchedAt);
      const under = quote(book.name, decimalFromBook(row.under), fetchedAt);
      if (over) bucket.over.push(over);
      if (under) bucket.under.push(under);
      byLine.set(line, bucket);
    }
  }
  for (const [line, bucket] of byLine) {
    if (!bucket.over.length && !bucket.under.length) continue;
    const oppositeLine = negateOppositeLine ? -line : line;
    const featured =
      main != null && (negateOppositeLine ? Math.abs(Math.abs(line) - Math.abs(main)) < 0.01 : Math.abs(line - main) < 0.01);
    out.push(
      pairMarket({
        key,
        selection: overSide,
        opposite: underSide,
        line,
        quotes: bucket.over,
        oppositeQuotes: bucket.under,
        stale,
        featured,
      })
    );
    out.push(
      pairMarket({
        key,
        selection: underSide,
        opposite: overSide,
        line: oppositeLine,
        quotes: bucket.under,
        oppositeQuotes: bucket.over,
        stale,
        featured,
      })
    );
  }
}

export function marketIdentity(market: Pick<AvailableMarket, 'key' | 'selection' | 'line'>): string {
  return `${market.key}|${market.selection}|${market.line ?? ''}`;
}
