import { americanToDecimal } from '@/lib/currencyUtils';
import type { BookmakerRegion } from '@/lib/bookmakers';

export type TennisOuLine = { line: string; over: string; under: string };
export type TennisBookRegion = BookmakerRegion;

/** Decimal prices shown in the tennis line selector. */
export const TENNIS_SELECTOR_MIN_DECIMAL = 1.65;
export const TENNIS_SELECTOR_MAX_DECIMAL = 2.5;

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
}

export interface TennisMatchOdds {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: TennisBookRow[];
}

export const TENNIS_OU_STATS = ['spread', 'totalGames', 'gamesWon', 'gamesLost', 'totalSets'] as const;

export function isTennisOuStat(stat: string | null | undefined): boolean {
  return TENNIS_OU_STATS.includes(stat as (typeof TENNIS_OU_STATS)[number]);
}

function hasOu(line: TennisOuLine | undefined): boolean {
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

function lineIsHalfPoint(line: string | null | undefined): boolean {
  const n = parseFloat(String(line ?? '').replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) return false;
  return Math.abs(Math.abs(n) % 1 - 0.5) < 0.01;
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
  return [];
}

export function tennisOuLinesForStat(book: TennisBookRow | undefined, stat: string): TennisOuLine[] {
  if (!book) return [];
  return rawLinesForStat(book, stat).filter(tennisOuLineInSelectorBand);
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

function compareOuLinesEvenFirst(a: TennisOuLine, b: TennisOuLine): number {
  const even = tennisOuEvenness(a) - tennisOuEvenness(b);
  if (even !== 0) return even;
  return (parseFloat(a.line) || 0) - (parseFloat(b.line) || 0);
}

export function tennisMainLineForStat(book: TennisBookRow | undefined, stat: string): TennisOuLine | undefined {
  if (!book) return undefined;
  const lines = tennisOuLinesForStat(book, stat);
  if (!lines.length) return undefined;
  return [...lines].sort(compareOuLinesEvenFirst)[0];
}

export function tennisBestOuPick(
  books: TennisBookRow[] | undefined,
  stat: string
): { bookIndex: number; line: TennisOuLine } | undefined {
  if (!books?.length) return undefined;
  const preferred = ['pointsbet', 'bet365', 'unibet'];
  let best: { bookIndex: number; line: TennisOuLine; even: number; preferred: number } | undefined;
  books.forEach((book, bookIndex) => {
    const prefHit = preferred.findIndex((needle) => String(book.name || '').toLowerCase().includes(needle));
    const prefRank = prefHit >= 0 ? prefHit : 99;
    for (const line of tennisOuLinesForStat(book, stat)) {
      const even = tennisOuEvenness(line);
      if (
        !best ||
        even < best.even - 0.001 ||
        (Math.abs(even - best.even) < 0.001 && prefRank < best.preferred)
      ) {
        best = { bookIndex, line, even, preferred: prefRank };
      }
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
