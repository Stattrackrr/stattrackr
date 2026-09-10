/**
 * Tennis match odds from The Odds API, mapped onto TennisBookRow.
 * Home/Away follow the Odds API event (home_team / away_team).
 */

import { americanToDecimal, decimalToAmerican } from '@/lib/currencyUtils';
import { getBookmakerRegion } from '@/lib/bookmakers';
import sharedCache from '@/lib/sharedCache';
import type { TennisBookRow, TennisOuLine } from '@/lib/tennis/oddsTypes';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_SECONDS = 5 * 60;
const EMPTY_OU: TennisOuLine = { line: 'N/A', over: 'N/A', under: 'N/A' };

const FEATURED_MARKETS = [
  'h2h',
  'spreads',
  'totals',
  'alternate_spreads',
  'alternate_totals',
  'team_totals',
  'alternate_team_totals',
  'alternate_set_totals',
].join(',');

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

function oddsApiKey(): string {
  return String(process.env.ODDS_API_KEY || '').trim();
}

function oddsRuntime(): {
  inflight: Map<string, Promise<OddsApiTennisMatch | null>>;
} {
  const g = globalThis as typeof globalThis & {
    __tennisOddsApiInflight?: { inflight: Map<string, Promise<OddsApiTennisMatch | null>> };
  };
  if (!g.__tennisOddsApiInflight) g.__tennisOddsApiInflight = { inflight: new Map() };
  return g.__tennisOddsApiInflight;
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
    const spreadLines = collectSpreads(markets, homeName, awayName);
    const totalLines = collectOuByPoint(markets, new Set(['totals', 'alternate_totals']));
    const gamesWonLines = collectPlayerTotals(markets, homeName);
    const gamesLostLines = collectPlayerTotals(markets, awayName);
    const totalSetsLines = collectOuByPoint(markets, new Set(['alternate_set_totals']));
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
  if (Array.isArray(cached)) return cached;
  const { json } = await oddsApiGet<OddsEventMeta[]>(`/sports/${encodeURIComponent(sportKey)}/events`);
  const events = Array.isArray(json) ? json : [];
  await sharedCache.setJSON(cacheId, events, CACHE_TTL_SECONDS);
  return events;
}

function eventMatchesPlayers(event: OddsEventMeta, homeName: string, awayName: string): boolean {
  const eventHome = String(event.home_team || '');
  const eventAway = String(event.away_team || '');
  const sameWay = tennisNamesMatch(eventHome, homeName) && tennisNamesMatch(eventAway, awayName);
  const flipped = tennisNamesMatch(eventHome, awayName) && tennisNamesMatch(eventAway, homeName);
  return sameWay || flipped;
}

async function findTennisEvent(homeName: string, awayName: string): Promise<OddsEventMeta | null> {
  const sports = await listActiveTennisSports();
  const needle = `${normalizeName(homeName)} ${normalizeName(awayName)} ${lastNameToken(homeName)} ${lastNameToken(awayName)}`;
  const ranked = [...sports].sort((a, b) => {
    const aHit = needle.includes(String(a.key || '').replace(/tennis_|_/g, '')) ? 0 : 1;
    const bHit = needle.includes(String(b.key || '').replace(/tennis_|_/g, '')) ? 0 : 1;
    return aHit - bHit;
  });
  for (const sport of ranked) {
    const key = String(sport.key || '').trim();
    if (!key) continue;
    const events = await listSportEvents(key);
    const hit = events.find((event) => eventMatchesPlayers(event, homeName, awayName));
    if (hit?.id && hit.sport_key) return hit;
  }
  return null;
}

async function fetchEventOdds(sportKey: string, eventId: string): Promise<OddsEventOdds | null> {
  const cacheId = `tennis_odds_api_event_odds_v1_${sportKey}_${eventId}`;
  const cached = await sharedCache.getJSON<OddsEventOdds>(cacheId);
  if (cached && typeof cached === 'object') return cached;
  const path =
    `/sports/${encodeURIComponent(sportKey)}/events/${encodeURIComponent(eventId)}/odds` +
    `?regions=${REGIONS}&oddsFormat=decimal&markets=${encodeURIComponent(FEATURED_MARKETS)}`;
  const { json } = await oddsApiGet<OddsEventOdds>(path);
  if (!json || typeof json !== 'object') return null;
  await sharedCache.setJSON(cacheId, json, CACHE_TTL_SECONDS);
  return json;
}

export async function getOddsApiTennisMatch(opts: {
  homeName: string;
  awayName: string;
}): Promise<OddsApiTennisMatch | null> {
  const homeName = String(opts.homeName || '').trim();
  const awayName = String(opts.awayName || '').trim();
  if (!homeName || !awayName || !oddsApiKey()) return null;
  const lookupKey = `tennis_odds_api_lookup_v1_${normalizeName(homeName)}_${normalizeName(awayName)}`;
  const runtime = oddsRuntime();
  const inflight = runtime.inflight.get(lookupKey);
  if (inflight) return inflight;
  const pending = (async () => {
    try {
      const event = await findTennisEvent(homeName, awayName);
      const sportKey = String(event?.sport_key || '').trim();
      const eventId = String(event?.id || '').trim();
      if (!event || !sportKey || !eventId) return null;
      const raw = await fetchEventOdds(sportKey, eventId);
      if (!raw) return null;
      return {
        eventId,
        sportKey,
        homeTeam: String(raw.home_team || event.home_team || '').trim(),
        awayTeam: String(raw.away_team || event.away_team || '').trim(),
        books: parseBooks(raw),
      };
    } catch {
      return null;
    }
  })();
  runtime.inflight.set(lookupKey, pending);
  try {
    return await pending;
  } finally {
    runtime.inflight.delete(lookupKey);
  }
}
