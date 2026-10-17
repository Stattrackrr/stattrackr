import { americanToDecimal } from '@/lib/currencyUtils';
import { getBookmakerRegion, type BookmakerRegion } from '@/lib/bookmakers';

export type TennisOuLine = { line: string; over: string; under: string };
export type TennisBookRegion = BookmakerRegion;

/** Decimal prices shown in the tennis line selector. */
export const TENNIS_SELECTOR_MIN_DECIMAL = 1.65;
export const TENNIS_SELECTOR_MAX_DECIMAL = 2.5;
/** Props-page moneyline floor. Dashboard H2H still shows shorter prices. */
export const TENNIS_MONEYLINE_MIN_DECIMAL = 1.3;

export interface TennisBookRow {
  name: string;
  region?: TennisBookRegion;
  H2H: { home: string; away: string };
  Spread: TennisOuLine;
  Total: TennisOuLine;
  GamesWon: TennisOuLine;
  GamesLost: TennisOuLine;
  TotalSets: TennisOuLine;
  SpreadLines: TennisOuLine[];
  TotalLines: TennisOuLine[];
  GamesWonLines: TennisOuLine[];
  GamesLostLines: TennisOuLine[];
  TotalSetsLines: TennisOuLine[];
  /** Home player's sets won. Over 0.5 is "to win a set". */
  SetsWon?: TennisOuLine;
  /** Away player's sets won. */
  SetsLost?: TennisOuLine;
  SetsWonLines?: TennisOuLine[];
  SetsLostLines?: TennisOuLine[];
}

export interface TennisMatchOdds {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: TennisBookRow[];
  /** When the book snapshot was stored. The tennis AI refuses EV once this is stale. */
  fetchedAt?: string | null;
}

export const TENNIS_OU_STATS = ['spread', 'totalGames', 'gamesWon', 'gamesLost', 'totalSets', 'setsWon', 'setsLost'] as const;

/** Set markets are lopsided by nature, so they use the moneyline floor instead of the 1.65–2.50 band. */
const TENNIS_SET_MARKET_STATS = new Set(['totalSets', 'setsWon', 'setsLost']);

export function isTennisOuStat(stat: string | null | undefined): boolean {
  return TENNIS_OU_STATS.includes(stat as (typeof TENNIS_OU_STATS)[number]);
}

function hasOu(line: TennisOuLine | undefined): line is TennisOuLine {
  return Boolean(line && line.line !== 'N/A' && (line.over !== 'N/A' || line.under !== 'N/A'));
}

function decimalFromAmericanStr(s: string | undefined): number | null {
  if (!s || s === 'N/A') return null;
  const am = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(am)) return null;
  const dec = americanToDecimal(am);
  if (!Number.isFinite(dec)) return null;
  return Math.round(dec * 100) / 100;
}

function decimalInSelectorBand(dec: number | null): boolean {
  if (dec == null) return false;
  return dec >= TENNIS_SELECTOR_MIN_DECIMAL && dec <= TENNIS_SELECTOR_MAX_DECIMAL;
}

export function tennisH2hMeetsMinOdds(h2h: { home?: string; away?: string } | undefined): boolean {
  if (!h2h) return false;
  const home = decimalFromAmericanStr(h2h.home);
  const away = decimalFromAmericanStr(h2h.away);
  return home != null || away != null;
}

export function tennisMoneylinePriceMeetsMin(odds: string | undefined): boolean {
  const dec = decimalFromAmericanStr(odds);
  return dec != null && dec >= TENNIS_MONEYLINE_MIN_DECIMAL;
}

export function tennisH2hEvenness(h2h: { home?: string; away?: string } | undefined): number {
  if (!h2h) return Number.POSITIVE_INFINITY;
  const home = decimalFromAmericanStr(h2h.home);
  const away = decimalFromAmericanStr(h2h.away);
  if (home != null && away != null) return Math.abs(home - away);
  const only = home ?? away;
  if (only == null) return Number.POSITIVE_INFINITY;
  return 10 + Math.abs(only - 1.9);
}

const PREFERRED_TENNIS_BOOKS = ['pointsbet', 'bet365', 'unibet'];

function preferredBookRank(name: string | undefined): number {
  const hit = PREFERRED_TENNIS_BOOKS.findIndex((needle) =>
    String(name || '').toLowerCase().includes(needle)
  );
  return hit >= 0 ? hit : 99;
}

export function tennisBookIsAustralian(name: string | null | undefined, region?: TennisBookRegion): boolean {
  return (region ?? getBookmakerRegion(String(name || ''))) === 'au';
}

/** Stable: Australian books first, everything else keeps its order. */
export function australianBooksFirst<T extends { name: string; region?: TennisBookRegion }>(books: T[]): T[] {
  return [
    ...books.filter((book) => tennisBookIsAustralian(book.name, book.region)),
    ...books.filter((book) => !tennisBookIsAustralian(book.name, book.region)),
  ];
}

/** Dashboard default: an Australian book wins whenever one prices the market. */
function australianRank(book: TennisBookRow): number {
  return tennisBookIsAustralian(book.name, book.region) ? 0 : 1;
}

export function tennisBestMoneylinePick(books: TennisBookRow[] | undefined): number | undefined {
  if (!books?.length) return undefined;
  let best: { bookIndex: number; au: number; even: number; preferred: number } | undefined;
  books.forEach((book, bookIndex) => {
    if (!tennisH2hMeetsMinOdds(book.H2H)) return;
    const au = australianRank(book);
    const even = tennisH2hEvenness(book.H2H);
    const preferred = preferredBookRank(book.name);
    if (best && au !== best.au) {
      if (au < best.au) best = { bookIndex, au, even, preferred };
      return;
    }
    if (
      !best ||
      even < best.even - 0.001 ||
      (Math.abs(even - best.even) < 0.001 && preferred < best.preferred)
    ) {
      best = { bookIndex, au, even, preferred };
    }
  });
  return best?.bookIndex;
}

function lineIsHalfPoint(line: string | null | undefined): boolean {
  const n = parseFloat(String(line ?? '').replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) return false;
  return Math.abs(Math.abs(n) % 1 - 0.5) < 0.01;
}

/** Drop player-set O/U (1.5) and point totals (210.5) from the wrong tennis market. */
export function tennisOuLinePlausible(stat: string, line: string | number | null | undefined): boolean {
  const n = parseFloat(String(line ?? '').replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) return false;
  if (stat === 'totalGames') return n >= 14.5 && n <= 79.5;
  if (stat === 'gamesWon' || stat === 'gamesLost') return n >= 5.5 && n <= 45.5;
  // Match set totals are 2.5 (BO3) or 3.5/4.5 (BO5). 1.5 is player sets won O/U.
  if (stat === 'totalSets') return n >= 2.5 && n <= 4.5;
  if (stat === 'setsWon' || stat === 'setsLost') return n >= 0.5 && n <= 2.5;
  if (stat === 'spread') return Math.abs(n) >= 0.5 && Math.abs(n) <= 20;
  return true;
}

/** Same rule as the tennis chart: spread over/cover is value <= line (won by more than the handicap). */
export function tennisValueHitsOver(stat: string, value: number, line: number): boolean {
  if (stat === 'spread') return value <= line;
  return value > line;
}

export function filterTennisOuLines(stat: string, lines: TennisOuLine[]): TennisOuLine[] {
  const byLine = new Map<number, TennisOuLine>();
  for (const row of lines) {
    if (!tennisOuLinePlausible(stat, row.line)) continue;
    const n = parseFloat(String(row.line).replace(/[^0-9.+-]/g, ''));
    const prev = byLine.get(n);
    if (!prev) {
      byLine.set(n, { line: String(n), over: row.over, under: row.under });
      continue;
    }
    byLine.set(n, {
      line: String(n),
      over: prev.over !== 'N/A' ? prev.over : row.over,
      under: prev.under !== 'N/A' ? prev.under : row.under,
    });
  }
  return [...byLine.values()].sort((a, b) => Number.parseFloat(a.line) - Number.parseFloat(b.line));
}

/** Keep a .5 line only when every posted over/under price is in 1.65–2.50 decimal. */
export function tennisOuLineInSelectorBand(line: TennisOuLine | undefined): boolean {
  if (!line || !lineIsHalfPoint(line.line)) return false;
  const over = decimalFromAmericanStr(line.over);
  const under = decimalFromAmericanStr(line.under);
  if (over == null && under == null) return false;
  if (over != null && !decimalInSelectorBand(over)) return false;
  if (under != null && !decimalInSelectorBand(under)) return false;
  return true;
}

function rawLinesForStat(book: TennisBookRow, stat: string): TennisOuLine[] {
  if (stat === 'spread') return book.SpreadLines?.length ? book.SpreadLines : hasOu(book.Spread) ? [book.Spread] : [];
  if (stat === 'totalGames') return book.TotalLines?.length ? book.TotalLines : hasOu(book.Total) ? [book.Total] : [];
  if (stat === 'gamesWon') return book.GamesWonLines?.length ? book.GamesWonLines : hasOu(book.GamesWon) ? [book.GamesWon] : [];
  if (stat === 'gamesLost') return book.GamesLostLines?.length ? book.GamesLostLines : hasOu(book.GamesLost) ? [book.GamesLost] : [];
  if (stat === 'totalSets') return book.TotalSetsLines?.length ? book.TotalSetsLines : hasOu(book.TotalSets) ? [book.TotalSets] : [];
  if (stat === 'setsWon') return book.SetsWonLines?.length ? book.SetsWonLines : hasOu(book.SetsWon) ? [book.SetsWon] : [];
  if (stat === 'setsLost') return book.SetsLostLines?.length ? book.SetsLostLines : hasOu(book.SetsLost) ? [book.SetsLost] : [];
  return [];
}

/** Blank any side priced under the moneyline floor; drop the line when no side is left. */
function setMarketLineAboveFloor(line: TennisOuLine): TennisOuLine | null {
  if (!lineIsHalfPoint(line.line)) return null;
  const keep = (price: string) => {
    const dec = decimalFromAmericanStr(price);
    return dec != null && dec >= TENNIS_MONEYLINE_MIN_DECIMAL ? price : 'N/A';
  };
  const over = keep(line.over);
  const under = keep(line.under);
  if (over === 'N/A' && under === 'N/A') return null;
  return { line: line.line, over, under };
}

/** Set-market lines with each side floored, including under-only (straight-sets) prices. */
export function tennisSetMarketPriceLines(book: TennisBookRow | undefined, stat: string): TennisOuLine[] {
  if (!book || !TENNIS_SET_MARKET_STATS.has(stat)) return [];
  return filterTennisOuLines(stat, rawLinesForStat(book, stat))
    .map(setMarketLineAboveFloor)
    .filter((line): line is TennisOuLine => line != null);
}

export type TennisOuLineOptions = {
  /** Dashboard: every set-market price with no floor, plus the match line taken from the moneyline. */
  allSetPrices?: boolean;
};

export const TENNIS_DASHBOARD_LINES: TennisOuLineOptions = { allSetPrices: true };

function bookIsBestOf5(book: TennisBookRow): boolean {
  const totals = book.TotalSetsLines?.length ? book.TotalSetsLines : book.TotalSets ? [book.TotalSets] : [];
  return totals.some((row) => row.line !== 'N/A' && ouLineNumber(row) >= 3.5);
}

function hasAmericanPrice(price: string | undefined): price is string {
  return decimalFromAmericanStr(price) != null;
}

/**
 * Winning the match is winning 2 sets in best of 3 (3 in best of 5), so that sets line is the
 * moneyline. Books are oriented for the viewed player: H2H.home is them.
 */
function dashboardSetLines(book: TennisBookRow, stat: string): TennisOuLine[] {
  const lines = filterTennisOuLines(stat, rawLinesForStat(book, stat)).filter(
    (row) => lineIsHalfPoint(row.line) && (hasAmericanPrice(row.over) || hasAmericanPrice(row.under))
  );
  if (stat === 'totalSets') return lines;
  const matchLine = bookIsBestOf5(book) ? 2.5 : 1.5;
  const over = stat === 'setsWon' ? book.H2H?.home : book.H2H?.away;
  const under = stat === 'setsWon' ? book.H2H?.away : book.H2H?.home;
  if ((hasAmericanPrice(over) || hasAmericanPrice(under)) && !lines.some((row) => ouLineNumber(row) === matchLine)) {
    lines.push({
      line: String(matchLine),
      over: hasAmericanPrice(over) ? over : 'N/A',
      under: hasAmericanPrice(under) ? under : 'N/A',
    });
  }
  return lines.sort((a, b) => ouLineNumber(a) - ouLineNumber(b));
}

export function tennisOuLinesForStat(
  book: TennisBookRow | undefined,
  stat: string,
  opts?: TennisOuLineOptions
): TennisOuLine[] {
  if (!book) return [];
  if (TENNIS_SET_MARKET_STATS.has(stat) && opts?.allSetPrices) return dashboardSetLines(book, stat);
  if (TENNIS_SET_MARKET_STATS.has(stat)) {
    const lines = tennisSetMarketPriceLines(book, stat);
    // Sets won/lost read as "to win a set"; an under-only line would show the straight-sets price instead.
    return stat === 'totalSets' ? lines : lines.filter((line) => line.over !== 'N/A');
  }
  const plausible = filterTennisOuLines(stat, rawLinesForStat(book, stat));
  return dropMisleadingPlayerTotalAlts(stat, plausible.filter(tennisOuLineInSelectorBand), book);
}

function ouLineNumber(line: TennisOuLine): number {
  return parseFloat(String(line.line).replace(/[^0-9.+-]/g, ''));
}

function spreadAbsLines(book: TennisBookRow): Set<number> {
  const out = new Set<number>();
  const add = (row: TennisOuLine | undefined) => {
    if (!row || row.line === 'N/A') return;
    const n = Math.abs(ouLineNumber(row));
    if (Number.isFinite(n) && n >= 0.5) out.add(n);
  };
  add(book.Spread);
  for (const row of book.SpreadLines || []) add(row);
  return out;
}

/**
 * Same-market totals must get harder to overlay as the line rises.
 * 8.5 O 1.95 next to 10.5 O 1.86 is a different market (usually set games) glued on.
 */
function dropInvertedTotalAlts(lines: TennisOuLine[]): TennisOuLine[] {
  if (lines.length < 2) return lines;
  const main = [...lines].sort((a, b) => tennisOuEvenness(a) - tennisOuEvenness(b))[0];
  if (!main) return lines;
  const mainN = ouLineNumber(main);
  const mainOver = decimalFromAmericanStr(main.over);
  const mainUnder = decimalFromAmericanStr(main.under);
  if (mainOver == null) return lines;
  return lines.filter((row) => {
    const n = ouLineNumber(row);
    if (Math.abs(n - mainN) < 0.01) return true;
    const over = decimalFromAmericanStr(row.over);
    const under = decimalFromAmericanStr(row.under);
    if (over == null) return true;
    if (n < mainN && over > mainOver + 0.02) return false;
    if (n > mainN && over < mainOver - 0.02) return false;
    if (under != null && mainUnder != null) {
      if (n < mainN && under < mainUnder - 0.02) return false;
      if (n > mainN && under > mainUnder + 0.02) return false;
    }
    return true;
  });
}

/**
 * Player match-game totals sit around 9–20. 6.5/7.5/8.5 next to a 9.5+ ladder are
 * set totals or handicaps — and their juice will not move like a real alt ladder.
 */
function dropMisleadingPlayerTotalAlts(
  stat: string,
  lines: TennisOuLine[],
  book: TennisBookRow
): TennisOuLine[] {
  if (stat !== 'gamesWon' && stat !== 'gamesLost') return lines;
  const spreadAbs = spreadAbsLines(book);
  const withoutSpread = spreadAbs.size
    ? lines.filter((row) => !spreadAbs.has(Math.abs(ouLineNumber(row))))
    : lines;
  const pool = withoutSpread.length ? withoutSpread : lines;
  if (!pool.length) return pool;
  const nums = pool.map(ouLineNumber).filter(Number.isFinite);
  const max = Math.max(...nums);
  const matchLike = Number.isFinite(max) && max >= 9.5 ? pool.filter((row) => ouLineNumber(row) >= 9.5) : pool;
  const ranked = matchLike.length ? matchLike : pool;
  return dropInvertedTotalAlts(ranked);
}

function medianLineNumber(lines: TennisOuLine[]): number {
  const nums = lines.map(ouLineNumber).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return nums[mid]!;
  return (nums[mid - 1]! + nums[mid]!) / 2;
}

/** Smaller is closer to a true two-way main. One-sided prices rank after any two-way. */
export function tennisOuEvenness(line: TennisOuLine | undefined): number {
  if (!line) return Number.POSITIVE_INFINITY;
  const over = decimalFromAmericanStr(line.over);
  const under = decimalFromAmericanStr(line.under);
  if (over != null && under != null) return Math.abs(over - under);
  const only = over ?? under;
  if (only == null) return Number.POSITIVE_INFINITY;
  return 10 + Math.abs(only - 1.9);
}

function dashboardWinASetFirst(stat: string, opts?: TennisOuLineOptions): boolean {
  return Boolean(opts?.allSetPrices) && (stat === 'setsWon' || stat === 'setsLost');
}

export function tennisMainLineForStat(
  book: TennisBookRow | undefined,
  stat: string,
  opts?: TennisOuLineOptions
): TennisOuLine | undefined {
  if (!book) return undefined;
  const lines = tennisOuLinesForStat(book, stat, opts);
  if (!lines.length) return undefined;
  if (dashboardWinASetFirst(stat, opts)) {
    const winASet = lines.find((row) => ouLineNumber(row) === 0.5);
    if (winASet) return winASet;
  }
  const median = medianLineNumber(lines);
  const nearMedian = lines.filter((row) => Math.abs(ouLineNumber(row) - median) <= 2);
  const pool = nearMedian.length ? nearMedian : lines;
  return [...pool].sort((a, b) => {
    const even = tennisOuEvenness(a) - tennisOuEvenness(b);
    if (Math.abs(even) > 0.03) return even;
    return Math.abs(ouLineNumber(a) - median) - Math.abs(ouLineNumber(b) - median);
  })[0];
}

export function tennisOuLineIsMain(
  book: TennisBookRow | undefined,
  stat: string,
  line: TennisOuLine | string | number | null | undefined,
  opts?: TennisOuLineOptions
): boolean {
  const main = tennisMainLineForStat(book, stat, opts);
  if (!main) return false;
  const n =
    typeof line === 'object' && line
      ? tennisParseLineNumber(line.line)
      : tennisParseLineNumber(line == null ? null : String(line));
  if (dashboardWinASetFirst(stat, opts) && n !== 0.5) return false;
  return tennisLineMatches(main.line, n);
}

export function tennisBestOuPick(
  books: TennisBookRow[] | undefined,
  stat: string,
  opts?: TennisOuLineOptions
): { bookIndex: number; line: TennisOuLine } | undefined {
  if (!books?.length) return undefined;
  const winASetFirst = dashboardWinASetFirst(stat, opts);
  let best:
    | { bookIndex: number; line: TennisOuLine; au: number; even: number; preferred: number; winASet: boolean }
    | undefined;
  books.forEach((book, bookIndex) => {
    const line = tennisMainLineForStat(book, stat, opts);
    if (!line) return;
    const prefRank = preferredBookRank(book.name);
    const au = australianRank(book);
    const even = tennisOuEvenness(line);
    const winASet = winASetFirst && ouLineNumber(line) === 0.5;
    const candidate = { bookIndex, line, au, even, preferred: prefRank, winASet };
    if (best && winASet !== best.winASet) {
      if (winASet) best = candidate;
      return;
    }
    if (best && au !== best.au) {
      if (au < best.au) best = candidate;
      return;
    }
    if (
      !best ||
      even < best.even - 0.001 ||
      (Math.abs(even - best.even) < 0.001 && prefRank < best.preferred)
    ) {
      best = candidate;
    }
  });
  return best ? { bookIndex: best.bookIndex, line: best.line } : undefined;
}

export function tennisParseLineNumber(line: string | null | undefined): number | null {
  if (line == null || line === 'N/A') return null;
  const n = parseFloat(String(line).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function tennisLineMatches(
  line: string | null | undefined,
  value: number | null | undefined,
  tol = 0.01
): boolean {
  const n = tennisParseLineNumber(line);
  if (n == null || value == null || !Number.isFinite(value)) return false;
  return Math.abs(n - value) < tol;
}
