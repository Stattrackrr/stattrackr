import { parseNblPlayerQuarterStat } from '@/lib/nbl/pbpShared';

export interface NblBookRow {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
  lines?: NblPropLine[];
}

export interface NblPropLine {
  line: string;
  over: string;
  under: string;
  kind: 'ou' | 'milestone';
  label: string;
}

export interface NblGameOdds {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: NblBookRow[];
}

export interface NblOddsCache {
  games: NblGameOdds[];
  lastUpdated: string;
  nextUpdate: string;
}

export type NblOddsMarket = 'h2h' | 'spread' | 'total';

export const NBL_PLAYER_PROP_STAT_TO_MARKET: Record<string, string> = {
  points: 'player_points',
  rebounds: 'player_rebounds',
  assists: 'player_assists',
  threeMade: 'player_threes',
  pra: 'player_points_rebounds_assists',
  pr: 'player_points_rebounds',
  pa: 'player_points_assists',
  ra: 'player_rebounds_assists',
};

export function nblPlayerPropMarketForStat(stat: string | null | undefined): string | null {
  if (!stat) return null;
  return NBL_PLAYER_PROP_STAT_TO_MARKET[stat] ?? null;
}

export function nblOddsMarketForStat(
  mode: 'player' | 'team',
  stat: string | null | undefined
): NblOddsMarket | null {
  if (mode === 'player') {
    if (parseNblPlayerQuarterStat(stat)) return 'total';
    return nblPlayerPropMarketForStat(stat) ? 'total' : null;
  }
  if (stat === 'moneyline') return 'h2h';
  if (stat === 'spread') return 'spread';
  if (stat === 'total_pts') return 'total';
  return null;
}

export function parseNblOddsLine(raw: string | undefined | null): number | null {
  if (raw == null || raw === 'N/A') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function nblH2hMeetsMinOdds(h2h: NblBookRow['H2H'] | undefined): boolean {
  if (!h2h) return false;
  return h2h.home !== 'N/A' && h2h.away !== 'N/A';
}

export function nblOuHasOdds(row: { line?: string; over?: string; under?: string } | undefined): boolean {
  if (!row || row.line === 'N/A') return false;
  return row.over !== 'N/A' || row.under !== 'N/A';
}

export function nblBookLines(book: NblBookRow | undefined): NblPropLine[] {
  if (!book) return [];
  if (book.lines?.length) return nblPreferOuLines(book.lines);
  if (nblOuHasOdds(book.Total)) {
    return [{ ...book.Total, kind: 'ou', label: book.Total.line }];
  }
  return [];
}

/** Props-page milestone band (decimal). Dashboard is unfiltered. */
export const NBL_PROPS_MILESTONE_MIN_DECIMAL = 1.55;
export const NBL_PROPS_MILESTONE_MAX_DECIMAL = 2.6;

/** Decimal price used when a stat has no two-way over/under. */
export const NBL_ALT_LINE_TARGET_DECIMAL = 1.7;

function nblAmericanNumber(raw: string | undefined | null): number | null {
  if (raw == null || raw === 'N/A') return null;
  const n = Number(String(raw).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Smaller means a more even over/under. Matches the line menu order. */
export function nblOuEvenness(over: string, under: string): number {
  const o = nblAmericanNumber(over);
  const u = nblAmericanNumber(under);
  if (o == null || u == null) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.abs(o) - Math.abs(u));
}

function nblPriceDistanceFromTarget(over: string, under: string): number {
  const prices = [over, under]
    .map((raw) => nblAmericanToDecimal(raw))
    .filter((n): n is number => n != null);
  if (!prices.length) return Number.POSITIVE_INFINITY;
  return Math.min(...prices.map((dec) => Math.abs(dec - NBL_ALT_LINE_TARGET_DECIMAL)));
}

/**
 * Best line for a stat. Two-way over/unders win, most even first.
 * With no over/under, the line whose price is closest to $1.70.
 */
export function nblBestLinePick(
  books: NblBookRow[] | undefined,
  market: 'spread' | 'total'
): { bookIndex: number; line: number } | null {
  if (!books?.length) return null;
  const ou: { bookIndex: number; line: number; even: number }[] = [];
  const alt: { bookIndex: number; line: number; dist: number }[] = [];

  const consider = (bookIndex: number, row: { line: string; over: string; under: string; kind?: string }) => {
    const line = parseNblOddsLine(row.line);
    if (line == null) return;
    const twoWay = row.kind !== 'milestone' && row.over !== 'N/A' && row.under !== 'N/A';
    if (twoWay) {
      ou.push({ bookIndex, line, even: nblOuEvenness(row.over, row.under) });
      return;
    }
    if (row.over === 'N/A' && row.under === 'N/A') return;
    alt.push({ bookIndex, line, dist: nblPriceDistanceFromTarget(row.over, row.under) });
  };

  books.forEach((book, bookIndex) => {
    if (market === 'spread') {
      consider(bookIndex, { ...book.Spread, kind: 'ou' });
      return;
    }
    const lines = nblBookLines(book);
    if (lines.length) {
      for (const row of lines) consider(bookIndex, row);
      return;
    }
    if (nblOuHasOdds(book.Total)) consider(bookIndex, { ...book.Total, kind: 'ou' });
  });

  if (ou.length) {
    ou.sort((a, b) => a.even - b.even || b.line - a.line || a.bookIndex - b.bookIndex);
    const best = ou[0];
    return best ? { bookIndex: best.bookIndex, line: best.line } : null;
  }
  if (!alt.length) return null;
  alt.sort((a, b) => a.dist - b.dist || a.bookIndex - b.bookIndex || a.line - b.line);
  const best = alt[0];
  return best ? { bookIndex: best.bookIndex, line: best.line } : null;
}

export function nblAmericanToDecimal(raw: string | undefined | null): number | null {
  if (raw == null || raw === 'N/A') return null;
  const n = Number(String(raw).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return n / 100 + 1;
  return 100 / Math.abs(n) + 1;
}

export function nblMilestoneOddsInPropsBand(overOdds: string | undefined | null): boolean {
  const dec = nblAmericanToDecimal(overOdds);
  if (dec == null) return false;
  return dec >= NBL_PROPS_MILESTONE_MIN_DECIMAL && dec <= NBL_PROPS_MILESTONE_MAX_DECIMAL;
}

export function nblPreferOuLines(lines: NblPropLine[]): NblPropLine[] {
  const twoWay = lines.filter((l) => l.kind === 'ou' && l.under !== 'N/A' && l.over !== 'N/A');
  return twoWay.length ? twoWay : lines;
}

export function nblFilterMilestoneLinesForPropsPage(lines: NblPropLine[]): NblPropLine[] {
  const preferred = nblPreferOuLines(lines);
  if (preferred.some((l) => l.kind === 'ou')) return preferred;
  return preferred.filter((l) => nblMilestoneOddsInPropsBand(l.over));
}

export function nblExactLineOnBook(
  book: NblBookRow | undefined,
  value: number | null | undefined
): NblPropLine | undefined {
  if (!book || value == null || !Number.isFinite(value)) return undefined;
  return nblBookLines(book).find((l) => {
    const n = parseNblOddsLine(l.line);
    return n != null && Math.abs(n - value) < 0.01;
  });
}

export function nblLineMatchingValue(
  book: NblBookRow | undefined,
  value: number | null | undefined
): NblPropLine | undefined {
  const lines = nblBookLines(book);
  if (!lines.length) return undefined;
  if (value == null || !Number.isFinite(value)) {
    return lines.find((l) => l.kind === 'ou') ?? lines[0];
  }
  return nblExactLineOnBook(book, value) ?? lines.find((l) => l.kind === 'ou') ?? lines[0];
}
