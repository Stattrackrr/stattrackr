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
  if (book.lines?.length) return book.lines;
  if (nblOuHasOdds(book.Total)) {
    return [{ ...book.Total, kind: 'ou', label: book.Total.line }];
  }
  return [];
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
  return (
    lines.find((l) => {
      const n = parseNblOddsLine(l.line);
      return n != null && Math.abs(n - value) < 0.01;
    }) ??
    lines.find((l) => l.kind === 'ou') ??
    lines[0]
  );
}
