/**
 * Match odds from API-Tennis get_odds, mapped to the AFL dashboard book row shape.
 * Home in API-Tennis is event_first_player.
 */

import { americanToDecimal, decimalToAmerican } from '@/lib/currencyUtils';
import { getBookmakerInfo, getBookmakerRegion } from '@/lib/bookmakers';
import sharedCache from '@/lib/sharedCache';
import {
  getOddsApiTennisMatch,
  readOddsApiTennisCatalog,
  refreshOddsApiTennisCatalog,
  tennisNamesMatch,
  tennisTourFromOdds,
  type OddsApiTennisMatch,
} from '@/lib/tennis/oddsApi';
import {
  getTennisNextGame,
  listUniqueUpcomingTennisGames,
  tennisCommenceTimeForMatch,
  warmTennisUpcomingFixtures,
  type TennisNextGame,
} from '@/lib/tennis/nextGame';
import {
  filterTennisOuLines,
  type TennisBookRow,
  type TennisMatchOdds,
  type TennisOuLine,
} from '@/lib/tennis/oddsTypes';

export type { TennisBookRow, TennisMatchOdds } from '@/lib/tennis/oddsTypes';

const API_BASE = 'https://api.api-tennis.com/tennis/';
const ODDS_CACHE_TTL_SECONDS = 5 * 60;
const SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;
const MIN_REFRESH_MS = 25 * 60 * 1000;
const MAX_SNAPSHOT_MATCHES = 80;
const REFRESH_META_KEY = 'tennis_odds_refresh_meta_v2';
const ODDS_INDEX_KEY = 'tennis_odds_index_v1';
const EMPTY_OU = { line: 'N/A', over: 'N/A', under: 'N/A' };

export type TennisOddsSnapshot = {
  matchId: string;
  homeName: string;
  awayName: string;
  bookmakers: TennisBookRow[];
  fetchedAt: string;
  oddsApiEventId?: string;
  commenceTime?: string | null;
  tour?: string | null;
  tournamentName?: string | null;
  sportKey?: string | null;
};

export type TennisOddsIndexMatch = {
  matchId: string;
  homeName: string;
  awayName: string;
  commenceTime?: string | null;
  tour?: string | null;
  tournamentName?: string | null;
  oddsApiEventId?: string;
  sportKey?: string | null;
};

type TennisOddsRefreshMeta = {
  fetchedAt: string;
  upcoming: number;
  snapshots: number;
  oddsApiSports: number;
  oddsApiEvents: number;
  matchIds?: string[];
};

export type TennisOddsRefreshResult = TennisOddsRefreshMeta & {
  skipped: boolean;
};

type DecimalByBook = Record<string, string>;
type NestedByLine = Record<string, DecimalByBook>;

function apiKey(): string {
  return String(process.env.API_TENNIS_KEY || '').trim();
}

function cacheKey(matchId: string): string {
  return `tennis_match_odds_v1_${matchId}`;
}

function snapshotKey(matchId: string): string {
  return `tennis_odds_snapshot_v1_${matchId}`;
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
    const spreadLines = filterTennisOuLines('spread', collectAllLines(gamesAh.over, gamesAh.under, name));
    const rawMatchTotals = collectAllLines(totals.over, totals.under, name);
    const totalLines = filterTennisOuLines('totalGames', rawMatchTotals);
    const gamesWonLines = filterTennisOuLines('gamesWon', collectAllLines(homeGames.over, homeGames.under, name));
    const gamesLostLines = filterTennisOuLines('gamesLost', collectAllLines(awayGames.over, awayGames.under, name));
    const totalSetsLines = filterTennisOuLines(
      'totalSets',
      [
        ...collectAllLines(setTotals.over, setTotals.under, name),
        ...filterTennisOuLines('totalSets', rawMatchTotals),
      ]
    );
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

async function fetchRawOdds(
  matchId: string,
  opts?: { force?: boolean }
): Promise<Record<string, unknown> | null> {
  const runtime = oddsRuntime();
  const inflightKey = opts?.force ? `${matchId}:force` : matchId;
  const inflight = runtime.inflight.get(inflightKey);
  if (inflight) return inflight;
  const pending = (async () => {
    if (!opts?.force) {
      const cached = await sharedCache.getJSON<Record<string, unknown>>(cacheKey(matchId));
      if (cached && typeof cached === 'object') return cached;
    }
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
  runtime.inflight.set(inflightKey, pending);
  try {
    return await pending;
  } finally {
    runtime.inflight.delete(inflightKey);
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
    const spreadLines = filterTennisOuLines('spread', mergeOuLineLists(prev.SpreadLines, row.SpreadLines));
    const totalLines = filterTennisOuLines('totalGames', mergeOuLineLists(prev.TotalLines, row.TotalLines));
    const gamesWonLines = filterTennisOuLines('gamesWon', mergeOuLineLists(prev.GamesWonLines, row.GamesWonLines));
    const gamesLostLines = filterTennisOuLines('gamesLost', mergeOuLineLists(prev.GamesLostLines, row.GamesLostLines));
    const totalSetsLines = filterTennisOuLines('totalSets', mergeOuLineLists(prev.TotalSetsLines, row.TotalSetsLines));
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

function mergeSources(
  raw: Record<string, unknown> | null,
  oddsApi: OddsApiTennisMatch | null,
  next: TennisNextGame
): TennisBookRow[] {
  let books = raw ? parseMatchMarkets(raw) : [];
  if (oddsApi?.books?.length) {
    const oddsHomeIsTennisHome = tennisNamesMatch(oddsApi.homeTeam, next.homeName);
    books = mergeBookRows(books, orientBooksForPlayer(oddsApi.books, oddsHomeIsTennisHome));
  }
  return books;
}

function presentSnapshot(snapshot: TennisOddsSnapshot, next: TennisNextGame): TennisMatchOdds {
  const playerIsHome = Boolean(next.playerIsHome);
  return {
    matchId: snapshot.matchId,
    homeTeam: playerIsHome ? next.homeName : next.awayName,
    awayTeam: playerIsHome ? next.awayName : next.homeName,
    bookmakers: orientBooksForPlayer(snapshot.bookmakers, playerIsHome),
  };
}

async function writeSnapshot(
  next: TennisNextGame,
  books: TennisBookRow[],
  extra?: { oddsApiEventId?: string; sportKey?: string | null }
): Promise<TennisOddsSnapshot> {
  const snapshot: TennisOddsSnapshot = {
    matchId: String(next.matchId),
    homeName: next.homeName,
    awayName: next.awayName,
    bookmakers: books,
    fetchedAt: new Date().toISOString(),
    oddsApiEventId: extra?.oddsApiEventId,
    commenceTime: next.tipoff,
    tour: next.tour,
    tournamentName: next.tournamentName,
    sportKey: extra?.sportKey ?? null,
  };
  await sharedCache.setJSON(snapshotKey(snapshot.matchId), snapshot, SNAPSHOT_TTL_SECONDS);
  return snapshot;
}

export async function readTennisOddsSnapshot(matchId: string): Promise<TennisOddsSnapshot | null> {
  const id = String(matchId || '').trim();
  if (!id) return null;
  const snapshot = await sharedCache.getJSON<TennisOddsSnapshot>(snapshotKey(id));
  return snapshot?.bookmakers?.length ? snapshot : null;
}

export async function listTennisOddsIndex(): Promise<TennisOddsIndexMatch[]> {
  const index = await sharedCache.getJSON<{ matches?: TennisOddsIndexMatch[] }>(ODDS_INDEX_KEY);
  return Array.isArray(index?.matches) ? index.matches : [];
}

async function writeOddsIndex(matches: TennisOddsIndexMatch[]): Promise<void> {
  await sharedCache.setJSON(
    ODDS_INDEX_KEY,
    { fetchedAt: new Date().toISOString(), matches },
    SNAPSHOT_TTL_SECONDS
  );
}

function catalogMatchAsNextGame(match: OddsApiTennisMatch): TennisNextGame {
  const tour = tennisTourFromOdds(match.sportKey, match.sportTitle);
  return {
    opponent: match.awayTeam,
    opponentId: null,
    opponentIoc: null,
    opponentRank: null,
    opponentLogo: null,
    tipoff: match.commenceTime || null,
    live: false,
    isGrandSlam: /_open$|_french_open|_wimbledon|_us_open|_australian_open/i.test(String(match.sportKey || '')),
    tour,
    tournamentName: match.sportTitle || null,
    tournamentKey: match.sportKey || null,
    surface: null,
    round: null,
    matchId: `odds:${match.eventId}`,
    status: null,
    playerIsHome: true,
    homeName: match.homeTeam,
    awayName: match.awayTeam,
    playerSeed: null,
    opponentSeed: null,
    topSeedName: null,
    topSeedId: null,
  };
}

function pickRefreshTargets(games: TennisNextGame[]): TennisNextGame[] {
  const live = games.filter((game) => game.live);
  const rest = games.filter((game) => !game.live);
  return [...live, ...rest].slice(0, MAX_SNAPSHOT_MATCHES);
}

function refreshInflightRuntime(): {
  inflight: Promise<TennisOddsRefreshResult> | null;
} {
  const g = globalThis as typeof globalThis & {
    __tennisOddsRefresh?: { inflight: Promise<TennisOddsRefreshResult> | null };
  };
  if (!g.__tennisOddsRefresh) g.__tennisOddsRefresh = { inflight: null };
  return g.__tennisOddsRefresh;
}

export async function syncTennisCommenceTimesFromUpcoming(): Promise<{ updated: number }> {
  const upcoming = await listUniqueUpcomingTennisGames({ waitForFresh: false });
  const index = await listTennisOddsIndex();
  if (!upcoming.length || !index.length) return { updated: 0 };
  let updated = 0;
  const nextIndex = index.map((row) => {
    const tip = tennisCommenceTimeForMatch(upcoming, {
      matchId: row.matchId,
      homeName: row.homeName,
      awayName: row.awayName,
    });
    if (tip && tip !== row.commenceTime) {
      updated += 1;
      return { ...row, commenceTime: tip };
    }
    return row;
  });
  if (updated) await writeOddsIndex(nextIndex);
  await Promise.all(
    nextIndex.map(async (row) => {
      const tip = tennisCommenceTimeForMatch(upcoming, {
        matchId: row.matchId,
        homeName: row.homeName,
        awayName: row.awayName,
      });
      if (!tip) return;
      const snap = await readTennisOddsSnapshot(row.matchId);
      if (!snap || snap.commenceTime === tip) return;
      await sharedCache.setJSON(snapshotKey(row.matchId), { ...snap, commenceTime: tip }, SNAPSHOT_TTL_SECONDS);
    })
  );
  return { updated };
}

export async function refreshTennisOddsSnapshots(opts?: {
  force?: boolean;
}): Promise<TennisOddsRefreshResult> {
  const runtime = refreshInflightRuntime();
  if (runtime.inflight) return runtime.inflight;
  runtime.inflight = (async () => {
    const previous = await sharedCache.getJSON<TennisOddsRefreshMeta>(REFRESH_META_KEY);
    const ageMs = previous?.fetchedAt ? Date.now() - Date.parse(previous.fetchedAt) : Number.POSITIVE_INFINITY;
    if (!opts?.force && Number.isFinite(ageMs) && ageMs < MIN_REFRESH_MS && previous) {
      try {
        await warmTennisUpcomingFixtures({ force: true });
        await syncTennisCommenceTimesFromUpcoming();
      } catch {
        /* keep serving odds; times refresh on the upcoming cron */
      }
      return { ...previous, skipped: true };
    }
    await warmTennisUpcomingFixtures({ force: true });
    const upcoming = await listUniqueUpcomingTennisGames({ waitForFresh: false });
    const catalog = await refreshOddsApiTennisCatalog({ upcoming, force: true });
    const targets = pickRefreshTargets(upcoming);
    let snapshots = 0;
    for (let i = 0; i < targets.length; i += 4) {
      const batch = targets.slice(i, i + 4);
      await Promise.all(
        batch.map(async (game) => {
          const matchId = String(game.matchId || '').trim();
          if (!matchId) return;
          const [raw, oddsApi] = await Promise.all([
            fetchRawOdds(matchId, { force: true }),
            getOddsApiTennisMatch({ homeName: game.homeName, awayName: game.awayName }),
          ]);
          const books = mergeSources(raw, oddsApi, game);
          if (!books.length) return;
          await writeSnapshot(game, books, {
            oddsApiEventId: oddsApi?.eventId,
            sportKey: oddsApi?.sportKey,
          });
          snapshots += 1;
        })
      );
    }
    const catalogOnly = (catalog?.matches ?? []).filter(
      (match) =>
        !upcoming.some(
          (game) =>
            (tennisNamesMatch(match.homeTeam, game.homeName) &&
              tennisNamesMatch(match.awayTeam, game.awayName)) ||
            (tennisNamesMatch(match.homeTeam, game.awayName) &&
              tennisNamesMatch(match.awayTeam, game.homeName))
        )
    );
    for (const match of catalogOnly) {
      if (!match.books?.length) continue;
      const next = catalogMatchAsNextGame(match);
      await writeSnapshot(next, match.books, {
        oddsApiEventId: match.eventId,
        sportKey: match.sportKey,
      });
      snapshots += 1;
    }
    const indexMatches: TennisOddsIndexMatch[] = [];
    const seen = new Set<string>();
    for (const game of targets) {
      const matchId = String(game.matchId || '').trim();
      if (!matchId || seen.has(matchId)) continue;
      seen.add(matchId);
      indexMatches.push({
        matchId,
        homeName: game.homeName,
        awayName: game.awayName,
        commenceTime: game.tipoff,
        tour: game.tour,
        tournamentName: game.tournamentName,
      });
    }
    for (const match of catalogOnly) {
      const matchId = `odds:${match.eventId}`;
      if (seen.has(matchId)) continue;
      seen.add(matchId);
      indexMatches.push({
        matchId,
        homeName: match.homeTeam,
        awayName: match.awayTeam,
        commenceTime: match.commenceTime,
        tour: tennisTourFromOdds(match.sportKey, match.sportTitle),
        tournamentName: match.sportTitle || null,
        oddsApiEventId: match.eventId,
        sportKey: match.sportKey,
      });
    }
    await writeOddsIndex(indexMatches);
    await Promise.all([
      sharedCache.deleteJSON('tennis_player_props_list_v4'),
      sharedCache.deleteJSON('tennis_player_props_list_v5'),
      sharedCache.deleteJSON('tennis_player_props_list_v6'),
      sharedCache.deleteJSON('tennis_player_props_list_v7'),
      sharedCache.deleteJSON('tennis_player_props_list_v8'),
      sharedCache.deleteJSON('tennis_player_props_list_v9'),
      sharedCache.deleteJSON('tennis_player_props_list_v10'),
      sharedCache.deleteJSON('tennis_player_props_list_v11'),
      sharedCache.deleteJSON('tennis_player_props_list_v12'),
      sharedCache.deleteJSON('tennis_player_props_list_v13'),
      sharedCache.deleteJSON('tennis_player_props_list_v18'),
      sharedCache.deleteJSON('tennis_player_props_list_v19'),
      sharedCache.deleteJSON('tennis_player_props_list_v20'),
      sharedCache.deleteJSON('tennis_player_props_list_v21'),
      sharedCache.deleteJSON('tennis_player_props_list_v22'),
      sharedCache.deleteJSON('tennis_player_props_list_v23'),
      sharedCache.deleteJSON('tennis_player_props_list_v24'),
      sharedCache.deleteJSON('tennis_player_props_list_v25'),
    ]).catch(() => undefined);
    const meta: TennisOddsRefreshMeta = {
      fetchedAt: new Date().toISOString(),
      upcoming: upcoming.length,
      snapshots,
      oddsApiSports: catalog?.sports.length ?? 0,
      oddsApiEvents: catalog?.matches.length ?? 0,
      matchIds: indexMatches.map((row) => row.matchId),
    };
    await sharedCache.setJSON(REFRESH_META_KEY, meta, SNAPSHOT_TTL_SECONDS);
    return { ...meta, skipped: false };
  })();
  try {
    return await runtime.inflight;
  } finally {
    runtime.inflight = null;
  }
}

export async function getTennisMatchOddsForPlayer(opts: {
  playerId?: string | null;
  playerName?: string | null;
}): Promise<TennisMatchOdds | null> {
  const playerId = String(opts.playerId || '').trim();
  const playerName = String(opts.playerName || '').trim();
  if ((!playerId && !playerName) || !apiKey()) return null;
  const next = await getTennisNextGame({ playerId, playerName });
  const matchId = String(next?.matchId || '').trim();
  if (!next || !matchId) return null;
  const snapshot = await sharedCache.getJSON<TennisOddsSnapshot>(snapshotKey(matchId));
  if (snapshot?.bookmakers?.length && snapshot.oddsApiEventId) {
    return presentSnapshot(snapshot, next);
  }
  if (!(await readOddsApiTennisCatalog())) {
    await refreshOddsApiTennisCatalog({ upcoming: [next] });
  }
  if (snapshot?.bookmakers?.length) {
    const extra = await getOddsApiTennisMatch({ homeName: next.homeName, awayName: next.awayName });
    if (!extra?.books?.length) return presentSnapshot(snapshot, next);
    const books = mergeSources(null, extra, next);
    const stored = await writeSnapshot(next, mergeBookRows(snapshot.bookmakers, books), {
      oddsApiEventId: extra.eventId,
      sportKey: extra.sportKey,
    });
    return presentSnapshot(stored, next);
  }
  const [raw, oddsApi] = await Promise.all([
    fetchRawOdds(matchId),
    getOddsApiTennisMatch({ homeName: next.homeName, awayName: next.awayName }),
  ]);
  const books = mergeSources(raw, oddsApi, next);
  if (!books.length) return null;
  const stored = await writeSnapshot(next, books, {
    oddsApiEventId: oddsApi?.eventId,
    sportKey: oddsApi?.sportKey,
  });
  return presentSnapshot(stored, next);
}

