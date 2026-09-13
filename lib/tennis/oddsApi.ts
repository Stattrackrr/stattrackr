/**
 * Tennis match odds from The Odds API, mapped onto TennisBookRow.
 * Home/Away follow the Odds API event (home_team / away_team).
 */

import { americanToDecimal, decimalToAmerican } from '@/lib/currencyUtils';
import { getBookmakerRegion } from '@/lib/bookmakers';
import sharedCache from '@/lib/sharedCache';
import { filterTennisOuLines, type TennisBookRow, type TennisOuLine } from '@/lib/tennis/oddsTypes';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_SECONDS = 5 * 60;
const CATALOG_TTL_SECONDS = 24 * 60 * 60;
const CATALOG_KEY = 'tennis_odds_api_catalog_v1';
const CATALOG_META_KEY = 'tennis_odds_api_catalog_meta_v1';
const CATALOG_RETRY_MS = 30 * 60 * 1000;
const MAX_SPORTS_PER_REFRESH = 4;
const EMPTY_OU: TennisOuLine = { line: 'N/A', over: 'N/A', under: 'N/A' };

const FEATURED_MARKETS = [
  'h2h',
  'spreads',
  'totals',
  'alternate_spreads',
  'alternate_totals',
].join(',');

const FALLBACK_MARKETS = ['h2h,spreads,totals', 'h2h'];

const REGIONS = 'us,uk,au';

type OddsOutcome = {
  name?: string;
  description?: string;
  price?: number | string;
  point?: number | string;
};

type OddsMarket = {
  key?: string;
  outcomes?: OddsOutcome[];
};

type OddsBook = {
  key?: string;
  title?: string;
  markets?: OddsMarket[];
};

type OddsEventMeta = {
  id?: string;
  sport_key?: string;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
};

type OddsEventOdds = OddsEventMeta & {
  bookmakers?: OddsBook[];
};

type OddsSport = {
  key?: string;
  title?: string;
  active?: boolean;
  group?: string;
};

export type OddsApiTennisMatch = {
  eventId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  books: TennisBookRow[];
};

export type OddsApiTennisCatalog = {
  fetchedAt: string;
  sports: string[];
  matches: OddsApiTennisMatch[];
};

function oddsApiKey(): string {
  return String(process.env.ODDS_API_KEY || '').trim();
}

function emptyOu(): TennisOuLine {
  return { ...EMPTY_OU };
}

function formatAmericanFromDecimal(raw: string | number | undefined): string {
  const n = Number.parseFloat(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 1) return 'N/A';
  return decimalToAmerican(n);
}

export function tennisNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  const na = normalizeName(left);
  const nb = normalizeName(right);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const la = lastNameToken(left);
  const lb = lastNameToken(right);
  return la.length >= 4 && la === lb;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function lastNameToken(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return normalizeName(parts[parts.length - 1] || '');
}

function pickMainLine(lines: TennisOuLine[]): TennisOuLine {
  if (!lines.length) return emptyOu();
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
  return best ?? pool[0] ?? emptyOu();
}

function linesFromMap(overByLine: Map<number, string>, underByLine: Map<number, string>): TennisOuLine[] {
  const keys = new Set<number>([...overByLine.keys(), ...underByLine.keys()]);
  const out: TennisOuLine[] = [];
  for (const line of keys) {
    const over = overByLine.get(line) ?? 'N/A';
    const under = underByLine.get(line) ?? 'N/A';
    if (over === 'N/A' && under === 'N/A') continue;
    out.push({ line: String(line), over, under });
  }
  out.sort((a, b) => Number.parseFloat(a.line) - Number.parseFloat(b.line));
  return out;
}

function collectSpreads(markets: OddsMarket[], homeName: string, awayName: string): TennisOuLine[] {
  const overByLine = new Map<number, string>();
  const underByLine = new Map<number, string>();
  for (const market of markets) {
    if (market.key !== 'spreads' && market.key !== 'alternate_spreads') continue;
    for (const outcome of market.outcomes || []) {
      const point = Number.parseFloat(String(outcome.point ?? ''));
      if (!Number.isFinite(point)) continue;
      const price = formatAmericanFromDecimal(outcome.price);
      if (price === 'N/A') continue;
      if (tennisNamesMatch(outcome.name, homeName)) overByLine.set(point, price);
      else if (tennisNamesMatch(outcome.name, awayName)) underByLine.set(-point, price);
    }
  }
  return linesFromMap(overByLine, underByLine);
}

function collectOuByPoint(markets: OddsMarket[], keys: Set<string>): TennisOuLine[] {
  const overByLine = new Map<number, string>();
  const underByLine = new Map<number, string>();
  for (const market of markets) {
    if (!keys.has(String(market.key || ''))) continue;
    for (const outcome of market.outcomes || []) {
      const point = Number.parseFloat(String(outcome.point ?? ''));
      if (!Number.isFinite(point)) continue;
      const price = formatAmericanFromDecimal(outcome.price);
      if (price === 'N/A') continue;
      const name = String(outcome.name || '').toLowerCase();
      if (name === 'over') overByLine.set(point, price);
      else if (name === 'under') underByLine.set(point, price);
    }
  }
  return linesFromMap(overByLine, underByLine);
}

function collectPlayerTotals(markets: OddsMarket[], playerName: string): TennisOuLine[] {
  const overByLine = new Map<number, string>();
  const underByLine = new Map<number, string>();
  for (const market of markets) {
    if (market.key !== 'team_totals' && market.key !== 'alternate_team_totals') continue;
    for (const outcome of market.outcomes || []) {
      if (!tennisNamesMatch(outcome.description, playerName)) continue;
      const point = Number.parseFloat(String(outcome.point ?? ''));
      if (!Number.isFinite(point)) continue;
      const price = formatAmericanFromDecimal(outcome.price);
      if (price === 'N/A') continue;
      const name = String(outcome.name || '').toLowerCase();
      if (name === 'over') overByLine.set(point, price);
      else if (name === 'under') underByLine.set(point, price);
    }
  }
  return linesFromMap(overByLine, underByLine);
}

function parseBooks(event: OddsEventOdds): TennisBookRow[] {
  const homeName = String(event.home_team || '').trim();
  const awayName = String(event.away_team || '').trim();
  const rows: TennisBookRow[] = [];
  for (const book of event.bookmakers || []) {
    const markets = Array.isArray(book.markets) ? book.markets : [];
    const h2h = markets.find((market) => market.key === 'h2h');
    let homeH2H = 'N/A';
    let awayH2H = 'N/A';
    for (const outcome of h2h?.outcomes || []) {
      const price = formatAmericanFromDecimal(outcome.price);
      if (tennisNamesMatch(outcome.name, homeName)) homeH2H = price;
      else if (tennisNamesMatch(outcome.name, awayName)) awayH2H = price;
    }
    const spreadLines = filterTennisOuLines('spread', collectSpreads(markets, homeName, awayName));
    const rawTotals = collectOuByPoint(markets, new Set(['totals', 'alternate_totals']));
    const totalLines = filterTennisOuLines('totalGames', rawTotals);
    const gamesWonLines = filterTennisOuLines('gamesWon', collectPlayerTotals(markets, homeName));
    const gamesLostLines = filterTennisOuLines('gamesLost', collectPlayerTotals(markets, awayName));
    const totalSetsLines = filterTennisOuLines('totalSets', [
      ...collectOuByPoint(markets, new Set(['alternate_set_totals'])),
      ...filterTennisOuLines('totalSets', rawTotals),
    ]);
    if (
      homeH2H === 'N/A' &&
      awayH2H === 'N/A' &&
      !spreadLines.length &&
      !totalLines.length &&
      !gamesWonLines.length &&
      !gamesLostLines.length &&
      !totalSetsLines.length
    ) {
      continue;
    }
    rows.push({
      name: String(book.title || book.key || 'Book').trim(),
      region: getBookmakerRegion(String(book.key || book.title || '')),
      H2H: { home: homeH2H, away: awayH2H },
      Spread: pickMainLine(spreadLines),
      Total: pickMainLine(totalLines),
      GamesWon: pickMainLine(gamesWonLines),
      GamesLost: pickMainLine(gamesLostLines),
      TotalSets: pickMainLine(totalSetsLines),
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

async function oddsApiGet<T>(path: string): Promise<{ json: T | null; status: number }> {
  const key = oddsApiKey();
  if (!key) return { json: null, status: 0 };
  const url = path.includes('?')
    ? `${ODDS_API_BASE}${path}&apiKey=${encodeURIComponent(key)}`
    : `${ODDS_API_BASE}${path}?apiKey=${encodeURIComponent(key)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      continue;
    }
    if (!res.ok) return { json: null, status: res.status };
    return { json: (await res.json()) as T, status: res.status };
  }
  return { json: null, status: 0 };
}

async function listActiveTennisSports(): Promise<OddsSport[]> {
  const cacheId = 'tennis_odds_api_sports_v1';
  const cached = await sharedCache.getJSON<OddsSport[]>(cacheId);
  if (Array.isArray(cached) && cached.length) return cached;
  const { json } = await oddsApiGet<OddsSport[]>('/sports');
  const tennis = (Array.isArray(json) ? json : []).filter(
    (sport) => sport?.active && String(sport.key || '').startsWith('tennis_')
  );
  if (tennis.length) await sharedCache.setJSON(cacheId, tennis, 10 * 60);
  return tennis;
}

async function listSportEvents(sportKey: string): Promise<OddsEventMeta[]> {
  const cacheId = `tennis_odds_api_events_v1_${sportKey}`;
  const cached = await sharedCache.getJSON<OddsEventMeta[]>(cacheId);
  if (Array.isArray(cached) && cached.length) return cached;
  const { json } = await oddsApiGet<OddsEventMeta[]>(`/sports/${encodeURIComponent(sportKey)}/events`);
  const events = Array.isArray(json) ? json : [];
  if (events.length) await sharedCache.setJSON(cacheId, events, CACHE_TTL_SECONDS);
  return events;
}

function eventMatchesPlayers(
  event: { home_team?: string; away_team?: string; homeTeam?: string; awayTeam?: string },
  homeName: string,
  awayName: string
): boolean {
  const eventHome = String(event.home_team || event.homeTeam || '');
  const eventAway = String(event.away_team || event.awayTeam || '');
  const sameWay = tennisNamesMatch(eventHome, homeName) && tennisNamesMatch(eventAway, awayName);
  const flipped = tennisNamesMatch(eventHome, awayName) && tennisNamesMatch(eventAway, homeName);
  return sameWay || flipped;
}

function rankSportsForUpcoming(
  sports: OddsSport[],
  upcoming: Array<{ homeName: string; awayName: string; tournamentName?: string | null; tour?: string | null }>
): OddsSport[] {
  const needles = upcoming
    .flatMap((game) => [
      normalizeName(String(game.tournamentName || '')),
      String(game.tour || '').toLowerCase(),
    ])
    .filter(Boolean);
  return [...sports].sort((a, b) => {
    const aKey = String(a.key || '').replace(/tennis_|_/g, '');
    const bKey = String(b.key || '').replace(/tennis_|_/g, '');
    const aTitle = normalizeName(String(a.title || ''));
    const bTitle = normalizeName(String(b.title || ''));
    const aScore = needles.reduce((sum, needle) => {
      if (!needle) return sum;
      return sum + (aKey.includes(needle) || needle.includes(aKey) || aTitle.includes(needle) ? 2 : 0);
    }, 0);
    const bScore = needles.reduce((sum, needle) => {
      if (!needle) return sum;
      return sum + (bKey.includes(needle) || needle.includes(bKey) || bTitle.includes(needle) ? 2 : 0);
    }, 0);
    return bScore - aScore;
  });
}

function matchFromEvent(sportKey: string, event: OddsEventOdds): OddsApiTennisMatch | null {
  const eventId = String(event.id || '').trim();
  const homeTeam = String(event.home_team || '').trim();
  const awayTeam = String(event.away_team || '').trim();
  if (!eventId || !homeTeam || !awayTeam) return null;
  return {
    eventId,
    sportKey: String(event.sport_key || sportKey).trim(),
    homeTeam,
    awayTeam,
    books: parseBooks(event),
  };
}

async function fetchSportOdds(sportKey: string): Promise<OddsEventOdds[]> {
  const marketSets = [FEATURED_MARKETS, ...FALLBACK_MARKETS];
  for (const markets of marketSets) {
    const path =
      `/sports/${encodeURIComponent(sportKey)}/odds` +
      `?regions=${REGIONS}&oddsFormat=decimal&markets=${encodeURIComponent(markets)}`;
    const { json, status } = await oddsApiGet<OddsEventOdds[]>(path);
    if (Array.isArray(json) && json.some((event) => Array.isArray(event.bookmakers) && event.bookmakers.length)) {
      return json;
    }
    if (status === 401 || status === 422) continue;
    if (status && status !== 404) break;
  }
  return [];
}

export async function readOddsApiTennisCatalog(): Promise<OddsApiTennisCatalog | null> {
  const cached = await sharedCache.getJSON<OddsApiTennisCatalog>(CATALOG_KEY);
  if (cached && Array.isArray(cached.matches) && cached.matches.length) return cached;
  return null;
}

export async function getOddsApiTennisMatch(opts: {
  homeName: string;
  awayName: string;
}): Promise<OddsApiTennisMatch | null> {
  const homeName = String(opts.homeName || '').trim();
  const awayName = String(opts.awayName || '').trim();
  if (!homeName || !awayName) return null;
  const catalog = await readOddsApiTennisCatalog();
  if (!catalog) return null;
  return catalog.matches.find((match) => eventMatchesPlayers(match, homeName, awayName)) ?? null;
}

function catalogRefreshRuntime(): {
  inflight: Promise<OddsApiTennisCatalog | null> | null;
} {
  const g = globalThis as typeof globalThis & {
    __tennisOddsApiCatalogRefresh?: { inflight: Promise<OddsApiTennisCatalog | null> | null };
  };
  if (!g.__tennisOddsApiCatalogRefresh) g.__tennisOddsApiCatalogRefresh = { inflight: null };
  return g.__tennisOddsApiCatalogRefresh;
}

export async function refreshOddsApiTennisCatalog(opts?: {
  upcoming?: Array<{ homeName: string; awayName: string; tournamentName?: string | null; tour?: string | null }>;
  force?: boolean;
}): Promise<OddsApiTennisCatalog | null> {
  const existing = await readOddsApiTennisCatalog();
  if (existing && !opts?.force) return existing;
  const runtime = catalogRefreshRuntime();
  if (runtime.inflight) return runtime.inflight;
  runtime.inflight = (async () => {
    if (!oddsApiKey()) return existing;
    if (!opts?.force) {
      const meta = await sharedCache.getJSON<{ lastAttemptAt?: string }>(CATALOG_META_KEY);
      const ageMs = meta?.lastAttemptAt ? Date.now() - Date.parse(meta.lastAttemptAt) : Number.POSITIVE_INFINITY;
      if (Number.isFinite(ageMs) && ageMs < CATALOG_RETRY_MS) return existing;
    }
    await sharedCache.setJSON(CATALOG_META_KEY, { lastAttemptAt: new Date().toISOString() }, CATALOG_TTL_SECONDS);
    const upcoming = opts?.upcoming ?? [];
    const sports = await listActiveTennisSports();
    const wanted: string[] = [];
    const ranked = upcoming.length ? rankSportsForUpcoming(sports, upcoming) : sports;
    for (const sport of ranked) {
      if (wanted.length >= MAX_SPORTS_PER_REFRESH) break;
      const key = String(sport.key || '').trim();
      if (!key) continue;
      if (!upcoming.length) {
        if (key.startsWith('tennis_atp_') || key.startsWith('tennis_wta_')) wanted.push(key);
        continue;
      }
      const events = await listSportEvents(key);
      const hit = events.some((event) =>
        upcoming.some((game) => eventMatchesPlayers(event, game.homeName, game.awayName))
      );
      if (hit) wanted.push(key);
    }
    const matches: OddsApiTennisMatch[] = [];
    for (const sportKey of wanted) {
      const events = await fetchSportOdds(sportKey);
      for (const event of events) {
        const match = matchFromEvent(sportKey, event);
        if (match?.books.length) matches.push(match);
      }
    }
    if (!matches.length) return readOddsApiTennisCatalog();
    const catalog: OddsApiTennisCatalog = {
      fetchedAt: new Date().toISOString(),
      sports: wanted,
      matches,
    };
    await sharedCache.setJSON(CATALOG_KEY, catalog, CATALOG_TTL_SECONDS);
    return catalog;
  })();
  try {
    return await runtime.inflight;
  } finally {
    runtime.inflight = null;
  }
}
