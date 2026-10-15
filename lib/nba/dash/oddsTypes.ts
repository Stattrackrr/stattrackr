import { parseNbaPlayerQuarterStat } from '@/lib/nba/dash/pbpShared';

export interface NbaBookRow {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
  lines?: NbaPropLine[];
}

export interface NbaPropLine {
  line: string;
  over: string;
  under: string;
  kind: 'ou' | 'milestone';
  label: string;
}

/** One posted player line. Milestones (10+, 20+) carry only an over price. */
export interface NbaPropEntry {
  line: string;
  over: string;
  under: string;
  milestone?: boolean;
}

/** book → player name → prop key (PTS, REB, PRA, PTS_1Q…) → lines */
export type NbaPlayerPropsByBook = Record<string, Record<string, Record<string, NbaPropEntry[]>>>;

export interface NbaGameOdds {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  /** Spread line is the home side's (negative = home favoured); over = home price, under = away. */
  bookmakers: NbaBookRow[];
  playerProps?: NbaPlayerPropsByBook;
}

export interface NbaOddsCache {
  games: NbaGameOdds[];
  lastUpdated: string;
  nextUpdate: string;
  /** Last odds-api.net pull; it runs less often than the BallDontLie refresh. */
  oddsNetFetchedAt?: string;
}

export type NbaOddsMarket = 'h2h' | 'spread' | 'total';

export const NBA_PLAYER_PROP_STAT_TO_MARKET: Record<string, string> = {
  points: 'player_points',
  rebounds: 'player_rebounds',
  assists: 'player_assists',
  threeMade: 'player_threes',
  pra: 'player_points_rebounds_assists',
  pr: 'player_points_rebounds',
  pa: 'player_points_assists',
  ra: 'player_rebounds_assists',
};

export function nbaPlayerPropMarketForStat(stat: string | null | undefined): string | null {
  if (!stat) return null;
  return NBA_PLAYER_PROP_STAT_TO_MARKET[stat] ?? null;
}

export function nbaOddsMarketForStat(
  mode: 'player' | 'team',
  stat: string | null | undefined
): NbaOddsMarket | null {
  if (mode === 'player') {
    if (parseNbaPlayerQuarterStat(stat)) return 'total';
    return nbaPlayerPropMarketForStat(stat) ? 'total' : null;
  }
  if (stat === 'moneyline') return 'h2h';
  if (stat === 'spread') return 'spread';
  if (stat === 'total_pts') return 'total';
  return null;
}

export function parseNbaOddsLine(raw: string | undefined | null): number | null {
  if (raw == null || raw === 'N/A') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function nbaH2hMeetsMinOdds(h2h: NbaBookRow['H2H'] | undefined): boolean {
  if (!h2h) return false;
  return h2h.home !== 'N/A' && h2h.away !== 'N/A';
}

export function nbaOuHasOdds(row: { line?: string; over?: string; under?: string } | undefined): boolean {
  if (!row || row.line === 'N/A') return false;
  return row.over !== 'N/A' || row.under !== 'N/A';
}

export function nbaBookLines(book: NbaBookRow | undefined): NbaPropLine[] {
  if (!book) return [];
  if (book.lines?.length) return nbaPreferOuLines(book.lines);
  if (nbaOuHasOdds(book.Total)) {
    return [{ ...book.Total, kind: 'ou', label: book.Total.line }];
  }
  return [];
}

/** Props-page milestone band (decimal). Dashboard is unfiltered. */
export const NBA_PROPS_MILESTONE_MIN_DECIMAL = 1.55;
export const NBA_PROPS_MILESTONE_MAX_DECIMAL = 2.6;

/** Decimal price used when a stat has no two-way over/under. */
export const NBA_ALT_LINE_TARGET_DECIMAL = 1.7;

function nbaAmericanNumber(raw: string | undefined | null): number | null {
  if (raw == null || raw === 'N/A') return null;
  const n = Number(String(raw).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Smaller means a more even over/under. Matches the line menu order. */
export function nbaOuEvenness(over: string, under: string): number {
  const o = nbaAmericanNumber(over);
  const u = nbaAmericanNumber(under);
  if (o == null || u == null) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.abs(o) - Math.abs(u));
}

function nbaPriceDistanceFromTarget(over: string, under: string): number {
  const prices = [over, under]
    .map((raw) => nbaAmericanToDecimal(raw))
    .filter((n): n is number => n != null);
  if (!prices.length) return Number.POSITIVE_INFINITY;
  return Math.min(...prices.map((dec) => Math.abs(dec - NBA_ALT_LINE_TARGET_DECIMAL)));
}

/**
 * Best line for a stat. Two-way over/unders win, most even first.
 * With no over/under, the line whose price is closest to $1.70.
 */
export function nbaBestLinePick(
  books: NbaBookRow[] | undefined,
  market: 'spread' | 'total'
): { bookIndex: number; line: number } | null {
  if (!books?.length) return null;
  const ou: { bookIndex: number; line: number; even: number }[] = [];
  const alt: { bookIndex: number; line: number; dist: number }[] = [];

  const consider = (bookIndex: number, row: { line: string; over: string; under: string; kind?: string }) => {
    const line = parseNbaOddsLine(row.line);
    if (line == null) return;
    const twoWay = row.kind !== 'milestone' && row.over !== 'N/A' && row.under !== 'N/A';
    if (twoWay) {
      ou.push({ bookIndex, line, even: nbaOuEvenness(row.over, row.under) });
      return;
    }
    if (row.over === 'N/A' && row.under === 'N/A') return;
    alt.push({ bookIndex, line, dist: nbaPriceDistanceFromTarget(row.over, row.under) });
  };

  books.forEach((book, bookIndex) => {
    if (market === 'spread') {
      consider(bookIndex, { ...book.Spread, kind: 'ou' });
      return;
    }
    const lines = nbaBookLines(book);
    if (lines.length) {
      for (const row of lines) consider(bookIndex, row);
      return;
    }
    if (nbaOuHasOdds(book.Total)) consider(bookIndex, { ...book.Total, kind: 'ou' });
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

export function nbaAmericanToDecimal(raw: string | undefined | null): number | null {
  if (raw == null || raw === 'N/A') return null;
  const n = Number(String(raw).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return n / 100 + 1;
  return 100 / Math.abs(n) + 1;
}

export function nbaMilestoneOddsInPropsBand(overOdds: string | undefined | null): boolean {
  const dec = nbaAmericanToDecimal(overOdds);
  if (dec == null) return false;
  return dec >= NBA_PROPS_MILESTONE_MIN_DECIMAL && dec <= NBA_PROPS_MILESTONE_MAX_DECIMAL;
}

export function nbaPreferOuLines(lines: NbaPropLine[]): NbaPropLine[] {
  const twoWay = lines.filter((l) => l.kind === 'ou' && l.under !== 'N/A' && l.over !== 'N/A');
  return twoWay.length ? twoWay : lines;
}

export function nbaFilterMilestoneLinesForPropsPage(lines: NbaPropLine[]): NbaPropLine[] {
  const preferred = nbaPreferOuLines(lines);
  if (preferred.some((l) => l.kind === 'ou')) return preferred;
  return preferred.filter((l) => nbaMilestoneOddsInPropsBand(l.over));
}

export function nbaExactLineOnBook(
  book: NbaBookRow | undefined,
  value: number | null | undefined
): NbaPropLine | undefined {
  if (!book || value == null || !Number.isFinite(value)) return undefined;
  return nbaBookLines(book).find((l) => {
    const n = parseNbaOddsLine(l.line);
    return n != null && Math.abs(n - value) < 0.01;
  });
}

export function nbaLineMatchingValue(
  book: NbaBookRow | undefined,
  value: number | null | undefined
): NbaPropLine | undefined {
  const lines = nbaBookLines(book);
  if (!lines.length) return undefined;
  if (value == null || !Number.isFinite(value)) {
    return lines.find((l) => l.kind === 'ou') ?? lines[0];
  }
  return nbaExactLineOnBook(book, value) ?? lines.find((l) => l.kind === 'ou') ?? lines[0];
}
