/**
 * Match odds from API-Tennis get_odds, mapped to the AFL dashboard book row shape.
 * Home in API-Tennis is event_first_player.
 */

import { americanToDecimal, decimalToAmerican } from '@/lib/currencyUtils';
import { getBookmakerInfo, getBookmakerRegion } from '@/lib/bookmakers';
import sharedCache from '@/lib/sharedCache';
import { getOddsApiTennisMatch, tennisNamesMatch } from '@/lib/tennis/oddsApi';
import { getTennisNextGame } from '@/lib/tennis/nextGame';
import type { TennisBookRow, TennisMatchOdds, TennisOuLine } from '@/lib/tennis/oddsTypes';

export type { TennisBookRow, TennisMatchOdds } from '@/lib/tennis/oddsTypes';

const API_BASE = 'https://api.api-tennis.com/tennis/';
const ODDS_CACHE_TTL_SECONDS = 5 * 60;
const EMPTY_OU = { line: 'N/A', over: 'N/A', under: 'N/A' };

type DecimalByBook = Record<string, string>;
type NestedByLine = Record<string, DecimalByBook>;

function apiKey(): string {
  return String(process.env.API_TENNIS_KEY || '').trim();
}

function cacheKey(matchId: string): string {
  return `tennis_match_odds_v1_${matchId}`;
}

function oddsRuntime(): { inflight: Map<string, Promise<Record<string, unknown> | null>> } {
  const g = globalThis as typeof globalThis & {
    __tennisOddsInflight?: { inflight: Map<string, Promise<Record<string, unknown> | null>> };
  };
  if (!g.__tennisOddsInflight) g.__tennisOddsInflight = { inflight: new Map() };
  return g.__tennisOddsInflight;
}

async function apiTennisCall(params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ APIkey: key, timezone: 'UTC', ...params });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${API_BASE}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      continue;
    }
    return res.json();
  }
  return null;
}

function asDecimalByBook(value: unknown): DecimalByBook | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return null;
  const out: DecimalByBook = {};
  for (const [book, price] of entries) {
    if (typeof price === 'string' || typeof price === 'number') {
      out[book] = String(price);
    } else {
      return null;
    }
  }
  return Object.keys(out).length ? out : null;
}

function asNestedByLine(value: unknown): NestedByLine | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: NestedByLine = {};
  for (const [line, books] of Object.entries(value as Record<string, unknown>)) {
    const map = asDecimalByBook(books);
    if (map) out[line] = map;
  }
  return Object.keys(out).length ? out : null;
}

function market(raw: Record<string, unknown>, name: string): unknown {
  return raw[name];
}

function formatAmericanFromDecimal(raw: string | undefined): string {
  const n = Number.parseFloat(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 1) return 'N/A';
  return decimalToAmerican(n);
}

function bookNamesFromMap(map: DecimalByBook | null | undefined): string[] {
  return map ? Object.keys(map) : [];
}

function bookNamesFromNested(nested: NestedByLine | null | undefined): string[] {
  if (!nested) return [];
  const names = new Set<string>();
  for (const books of Object.values(nested)) {
    for (const name of Object.keys(books)) names.add(name);
  }
  return [...names];
}

function collectAllLines(
  overByLine: NestedByLine | null,
  underByLine: NestedByLine | null,
  book: string
): TennisOuLine[] {
  const keys = new Set<string>([
    ...Object.keys(overByLine || {}),
    ...Object.keys(underByLine || {}),
  ]);
  const out: TennisOuLine[] = [];
  for (const line of keys) {
    const over = formatAmericanFromDecimal(overByLine?.[line]?.[book]);
    const under = formatAmericanFromDecimal(underByLine?.[line]?.[book]);
    if (over === 'N/A' && under === 'N/A') continue;
    const n = Number.parseFloat(String(line).replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    out.push({ line: String(n), over, under });
  }
  out.sort((a, b) => Number.parseFloat(a.line) - Number.parseFloat(b.line));
  return out;
}

function pickMainLine(lines: TennisOuLine[]): TennisOuLine | null {
  if (!lines.length) return null;
  const half = lines.filter((row) => {
    const n = Number.parseFloat(row.line);
    return Number.isFinite(n) && Math.abs(Math.abs(n) % 1 - 0.5) < 0.01;
  });
  const pool = half.length ? half : lines;
  let best: TennisOuLine | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const row of pool) {
    const overAm = Number.parseFloat(String(row.over).replace(/[^0-9.+-]/g, ''));
    const underAm = Number.parseFloat(String(row.under).replace(/[^0-9.+-]/g, ''));
    if (!Number.isFinite(overAm) || !Number.isFinite(underAm) || row.over === 'N/A' || row.under === 'N/A') continue;
    const gap = Math.abs(americanToDecimal(overAm) - americanToDecimal(underAm));
    if (gap < bestGap) {
      bestGap = gap;
      best = row;
    }
  }
  return best ?? pool[0] ?? null;
}

function emptyOu(): TennisOuLine {
  return { ...EMPTY_OU };
}

function flipSpread(spread: TennisOuLine): TennisOuLine {
  const n = Number.parseFloat(String(spread.line).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n) || spread.line === 'N/A') return spread;
  return {
    line: String(-n),
    over: spread.under,
    under: spread.over,
  };
}

function nestedMarket(
  raw: Record<string, unknown>,
  marketName: string,
  overKeys: string[],
  underKeys: string[]
): { over: NestedByLine | null; under: NestedByLine | null } {
  const block = market(raw, marketName) as Record<string, unknown> | undefined;
  if (!block || typeof block !== 'object') return { over: null, under: null };
  let over: NestedByLine | null = null;
  let under: NestedByLine | null = null;
  for (const key of overKeys) {
    over = asNestedByLine(block[key]);
    if (over) break;
  }
  for (const key of underKeys) {
    under = asNestedByLine(block[key]);
    if (under) break;
  }
  return { over, under };
}

function parseMatchMarkets(raw: Record<string, unknown>): TennisBookRow[] {
  const h2h = market(raw, 'Home/Away') as Record<string, unknown> | undefined;
  const homeH2H = asDecimalByBook(h2h?.Home);
  const awayH2H = asDecimalByBook(h2h?.Away);

  const gamesAh = nestedMarket(
    raw,
    'Asian Handicap (Games)',
    ['Asian Handicap (Games) Home', 'Home'],
    ['Asian Handicap (Games) Away', 'Away']
  );
  const totals = nestedMarket(
    raw,
    'Over/Under by Games in Match',
    ['Over/Under by Games in Match Over', 'Over'],
    ['Over/Under by Games in Match Under', 'Under']
  );
  const homeGames = nestedMarket(raw, 'Total - Home', ['Total Over', 'Over'], ['Total Under', 'Under']);
  const awayGames = nestedMarket(raw, 'Total - Away', ['Total Over', 'Over'], ['Total Under', 'Under']);
  const setTotals = nestedMarket(raw, 'Over/Under', ['Over/Under Over', 'Over'], ['Over/Under Under', 'Under']);

  const names = new Set<string>([
    ...bookNamesFromMap(homeH2H),
    ...bookNamesFromMap(awayH2H),
    ...bookNamesFromNested(gamesAh.over),
    ...bookNamesFromNested(gamesAh.under),
    ...bookNamesFromNested(totals.over),
    ...bookNamesFromNested(totals.under),
    ...bookNamesFromNested(homeGames.over),
    ...bookNamesFromNested(homeGames.under),
    ...bookNamesFromNested(awayGames.over),
    ...bookNamesFromNested(awayGames.under),
    ...bookNamesFromNested(setTotals.over),
    ...bookNamesFromNested(setTotals.under),
  ]);

  const rows: TennisBookRow[] = [];
  for (const name of names) {
    const spreadLines = collectAllLines(gamesAh.over, gamesAh.under, name);
    const totalLines = collectAllLines(totals.over, totals.under, name);
    const gamesWonLines = collectAllLines(homeGames.over, homeGames.under, name);
    const gamesLostLines = collectAllLines(awayGames.over, awayGames.under, name);
    const totalSetsLines = collectAllLines(setTotals.over, setTotals.under, name);
    rows.push({
      name,
      region: getBookmakerRegion(name),
      H2H: {
        home: formatAmericanFromDecimal(homeH2H?.[name]),
        away: formatAmericanFromDecimal(awayH2H?.[name]),
      },
      Spread: pickMainLine(spreadLines) ?? emptyOu(),
      Total: pickMainLine(totalLines) ?? emptyOu(),
      GamesWon: pickMainLine(gamesWonLines) ?? emptyOu(),
      GamesLost: pickMainLine(gamesLostLines) ?? emptyOu(),
      TotalSets: pickMainLine(totalSetsLines) ?? emptyOu(),
      SpreadLines: spreadLines,
      TotalLines: totalLines,
      GamesWonLines: gamesWonLines,
      GamesLostLines: gamesLostLines,
      TotalSetsLines: totalSetsLines,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function orientBooksForPlayer(books: TennisBookRow[], playerIsHome: boolean): TennisBookRow[] {
  if (playerIsHome) return books;
  return books.map((book) => ({
    ...book,
    H2H: { home: book.H2H.away, away: book.H2H.home },
    Spread: flipSpread(book.Spread),
    SpreadLines: book.SpreadLines.map(flipSpread).sort(
      (a, b) => Number.parseFloat(a.line) - Number.parseFloat(b.line)
    ),
    Total: { ...book.Total },
    TotalLines: [...book.TotalLines],
    GamesWon: { ...book.GamesLost },
    GamesLost: { ...book.GamesWon },
    GamesWonLines: [...book.GamesLostLines],
    GamesLostLines: [...book.GamesWonLines],
    TotalSets: { ...book.TotalSets },
    TotalSetsLines: [...book.TotalSetsLines],
  }));
}

async function fetchRawOdds(matchId: string): Promise<Record<string, unknown> | null> {
  const runtime = oddsRuntime();
  const inflight = runtime.inflight.get(matchId);
  if (inflight) return inflight;
  const pending = (async () => {
    const cached = await sharedCache.getJSON<Record<string, unknown>>(cacheKey(matchId));
    if (cached && typeof cached === 'object') return cached;
    const json = await apiTennisCall({ method: 'get_odds', match_key: matchId });
    const result = json?.result;
    const raw =
      result && typeof result === 'object'
        ? ((result[matchId] ?? result[Object.keys(result)[0] ?? '']) as Record<string, unknown> | undefined)
        : null;
    if (!raw || typeof raw !== 'object') return null;
    await sharedCache.setJSON(cacheKey(matchId), raw, ODDS_CACHE_TTL_SECONDS);
    return raw;
  })();
  runtime.inflight.set(matchId, pending);
  try {
    return await pending;
  } finally {
    runtime.inflight.delete(matchId);
  }
}

function mergeOuLineLists(primary: TennisOuLine[], extra: TennisOuLine[]): TennisOuLine[] {
  const byLine = new Map<string, TennisOuLine>();
  for (const row of [...primary, ...extra]) {
    const n = Number.parseFloat(row.line);
    if (!Number.isFinite(n)) continue;
    const key = String(n);
    const prev = byLine.get(key);
    if (!prev) {
      byLine.set(key, { line: key, over: row.over, under: row.under });
      continue;
    }
    byLine.set(key, {
      line: key,
      over: prev.over !== 'N/A' ? prev.over : row.over,
      under: prev.under !== 'N/A' ? prev.under : row.under,
    });
  }
  return [...byLine.values()].sort((a, b) => Number.parseFloat(a.line) - Number.parseFloat(b.line));
}

function mergeBookRows(primary: TennisBookRow[], extra: TennisBookRow[]): TennisBookRow[] {
  const byKey = new Map<string, TennisBookRow>();
  const displayName = (name: string) => getBookmakerInfo(name).name;
  const regionOf = (row: TennisBookRow) => row.region ?? getBookmakerRegion(row.name);
  const mergeKey = (row: TennisBookRow) => `${displayName(row.name).toLowerCase()}::${regionOf(row)}`;
  for (const row of [...primary, ...extra]) {
    const key = mergeKey(row);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...row, name: displayName(row.name), region: regionOf(row) });
      continue;
    }
    const spreadLines = mergeOuLineLists(prev.SpreadLines, row.SpreadLines);
    const totalLines = mergeOuLineLists(prev.TotalLines, row.TotalLines);
    const gamesWonLines = mergeOuLineLists(prev.GamesWonLines, row.GamesWonLines);
    const gamesLostLines = mergeOuLineLists(prev.GamesLostLines, row.GamesLostLines);
    const totalSetsLines = mergeOuLineLists(prev.TotalSetsLines, row.TotalSetsLines);
    byKey.set(key, {
      name: prev.name,
      region: prev.region ?? regionOf(row),
      H2H: {
        home: prev.H2H.home !== 'N/A' ? prev.H2H.home : row.H2H.home,
        away: prev.H2H.away !== 'N/A' ? prev.H2H.away : row.H2H.away,
      },
      Spread: pickMainLine(spreadLines) ?? emptyOu(),
      Total: pickMainLine(totalLines) ?? emptyOu(),
      GamesWon: pickMainLine(gamesWonLines) ?? emptyOu(),
      GamesLost: pickMainLine(gamesLostLines) ?? emptyOu(),
      TotalSets: pickMainLine(totalSetsLines) ?? emptyOu(),
      SpreadLines: spreadLines,
      TotalLines: totalLines,
      GamesWonLines: gamesWonLines,
      GamesLostLines: gamesLostLines,
      TotalSetsLines: totalSetsLines,
    });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTennisMatchOddsForPlayer(opts: {
  playerId?: string | null;
}): Promise<TennisMatchOdds | null> {
  const playerId = String(opts.playerId || '').trim();
  if (!playerId || !apiKey()) return null;
  const next = await getTennisNextGame({ playerId });
  const matchId = String(next?.matchId || '').trim();
  if (!next || !matchId) return null;
  const [raw, oddsApi] = await Promise.all([
    fetchRawOdds(matchId),
    getOddsApiTennisMatch({ homeName: next.homeName, awayName: next.awayName }),
  ]);
  let books = raw ? parseMatchMarkets(raw) : [];
  if (oddsApi?.books?.length) {
    const oddsHomeIsTennisHome = tennisNamesMatch(oddsApi.homeTeam, next.homeName);
    const oddsBooks = orientBooksForPlayer(oddsApi.books, oddsHomeIsTennisHome);
    books = mergeBookRows(books, oddsBooks);
  }
  const playerIsHome = Boolean(next.playerIsHome);
  books = orientBooksForPlayer(books, playerIsHome);
  return {
    matchId,
    homeTeam: playerIsHome ? next.homeName : next.awayName,
    awayTeam: playerIsHome ? next.awayName : next.homeName,
    bookmakers: books,
  };
}

