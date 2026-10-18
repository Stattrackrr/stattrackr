/**
 * Tennis odds from odds-api.net: every bookmaker it lists per match (Sportsbet, TAB, Ladbrokes, PointsBet, ...),
 * plus bet365 AU kept apart. API-Tennis's bet365 is the international book, which prices game handicap /
 * total games lines the AU site doesn't offer, so the AI only trusts the AU row for bet365.
 */

import { decimalToAmerican } from '@/lib/currencyUtils';
import {
  emptySourceMatch,
  sideOf,
  sourceMatchToBookRow,
  tennisGameIsBestOfThree,
  validPrice,
  type SourceMatch,
} from '@/lib/tennis/extraBooks/shared';
import type { TennisNextGame } from '@/lib/tennis/nextGame';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import { tennisOuLinePlausible, type TennisBookRow, type TennisOuLine } from '@/lib/tennis/oddsTypes';

const BASE = 'https://api.odds-api.net/v1';
const BOOK = 'bet365';
export const TENNIS_BET365_AU_BOOK = 'bet365 au';
const CONCURRENCY = 4;
/** Fixture start times move with order of play; odds-api.net keeps the scheduled time. */
const START_TOLERANCE_MS = 24 * 60 * 60 * 1000;

type NetEvent = {
  event_id?: string | number;
  home_team?: string;
  away_team?: string;
  start_time?: number;
  event_state?: string;
  bookmakers?: string[];
};

type NetItem = {
  bookmaker?: string;
  bet_type?: string;
  metric?: string;
  period?: string;
  side?: string;
  line?: string | number;
  odds?: number;
  is_available?: boolean;
  main_line_eligible?: boolean;
  player_name?: string;
  market_key?: string;
};

type Pair = { a?: NetItem; b?: NetItem; main: boolean };

function apiKey(): string {
  return String(process.env.ODDS_API_NET_KEY || process.env.ODDS_API_NET || '').trim();
}

async function fetchJson(url: string): Promise<any> {
  const key = apiKey();
  if (!key) return null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'X-API-Key': key, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

async function tennisLeagues(): Promise<string[]> {
  const coverage = await fetchJson(`${BASE}/coverage?sport=tennis&lookback_days=3`);
  const leagues = new Set<string>();
  for (const row of (coverage?.markets ?? []) as Array<{ league?: string }>) {
    const league = String(row.league || '').trim();
    if (league && !/doubles/i.test(league)) leagues.add(league);
  }
  return [...leagues];
}

async function leagueEvents(league: string): Promise<NetEvent[]> {
  const events: NetEvent[] = [];
  let cursor = '';
  for (let pageNo = 0; pageNo < 3; pageNo += 1) {
    const qs = new URLSearchParams({ sport: 'tennis', league, limit: '200' });
    if (cursor) qs.set('cursor', cursor);
    const page = await fetchJson(`${BASE}/events?${qs}`);
    events.push(...((page?.items ?? page?.events ?? []) as NetEvent[]));
    cursor = String(page?.next_cursor || '');
    if (!cursor) break;
  }
  return events.filter((ev) => ev.event_id != null && ev.event_state !== 'finished');
}

function sameMatch(ev: NetEvent, game: TennisNextGame): { homeIsHome: boolean } | null {
  const home = String(ev.home_team || '');
  const away = String(ev.away_team || '');
  const start = typeof ev.start_time === 'number' ? ev.start_time * 1000 : NaN;
  const tip = Date.parse(String(game.tipoff || ''));
  if (Number.isFinite(start) && Number.isFinite(tip) && Math.abs(start - tip) > START_TOLERANCE_MS) return null;
  if (tennisIdentityMatch(home, game.homeName) && tennisIdentityMatch(away, game.awayName)) return { homeIsHome: true };
  if (tennisIdentityMatch(home, game.awayName) && tennisIdentityMatch(away, game.homeName)) return { homeIsHome: false };
  return null;
}

function num(value: unknown): number | null {
  const n = Number.parseFloat(String(value ?? '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function american(decimal: number | undefined): string {
  return typeof decimal === 'number' && decimal > 1 ? decimalToAmerican(decimal) : 'N/A';
}

/** Prefers the book's main line, then the most balanced. */
function pickPair(rows: Map<number, Pair>): [number, Pair] | null {
  const complete = [...rows.entries()].filter(([, row]) => row.a?.odds && row.b?.odds);
  if (!complete.length) return null;
  const balance = ([, row]: [number, Pair]) => Math.abs((row.a!.odds as number) - (row.b!.odds as number));
  complete.sort((x, y) => Number(y[1].main) - Number(x[1].main) || balance(x) - balance(y));
  return complete[0];
}

const EMPTY: TennisOuLine = { line: 'N/A', over: 'N/A', under: 'N/A' };

/** One bet365 AU book row in API-Tennis home orientation, or null when bet365 prices none of these markets. */
export function tennisBet365AuRowFromItems(items: NetItem[], homeIsHome: boolean): TennisBookRow | null {
  const winner: Pair = { main: true };
  const handicaps = new Map<number, Pair>();
  const totals = new Map<number, Pair>();
  for (const item of items) {
    if (String(item.bookmaker || '').toLowerCase() !== BOOK || item.is_available === false) continue;
    if (String(item.period || '').toLowerCase() !== 'full time') continue;
    if (!(typeof item.odds === 'number' && item.odds > 1)) continue;
    const side = String(item.side || '').toLowerCase();
    if (item.bet_type === 'moneyline') {
      if (side === 'home') winner.a = item;
      else if (side === 'away') winner.b = item;
      continue;
    }
    if (String(item.metric || '').toLowerCase() !== 'games') continue;
    const line = num(item.line);
    if (line == null) continue;
    if (item.bet_type === 'handicap') {
      if (side !== 'home' && side !== 'away') continue;
      const homeLine = side === 'home' ? line : -line;
      const row = handicaps.get(homeLine) ?? { main: false };
      if (side === 'home') row.a = item;
      else row.b = item;
      row.main ||= item.main_line_eligible === true;
      handicaps.set(homeLine, row);
    } else if (item.bet_type === 'total') {
      const raw = String(item.line || '').toLowerCase();
      const ou = raw.includes('under') ? 'under' : raw.includes('over') ? 'over' : null;
      if (!ou || !tennisOuLinePlausible('totalGames', line)) continue;
      const row = totals.get(line) ?? { main: false };
      if (ou === 'over') row.a = item;
      else row.b = item;
      row.main ||= item.main_line_eligible === true;
      totals.set(line, row);
    }
  }

  const homeOdds = homeIsHome ? winner.a?.odds : winner.b?.odds;
  const awayOdds = homeIsHome ? winner.b?.odds : winner.a?.odds;
  let spread: TennisOuLine | null = null;
  const hc = pickPair(handicaps);
  if (hc && tennisOuLinePlausible('spread', hc[0])) {
    const [netHomeLine, row] = hc;
    spread = homeIsHome
      ? { line: String(netHomeLine), over: american(row.a!.odds), under: american(row.b!.odds) }
      : { line: String(-netHomeLine), over: american(row.b!.odds), under: american(row.a!.odds) };
  }
  const tot = pickPair(totals);
  const total = tot ? { line: String(tot[0]), over: american(tot[1].a!.odds), under: american(tot[1].b!.odds) } : null;
  if (!homeOdds && !awayOdds && !spread && !total) return null;
  return {
    name: TENNIS_BET365_AU_BOOK,
    region: 'au',
    H2H: { home: american(homeOdds), away: american(awayOdds) },
    Spread: spread ?? EMPTY,
    Total: total ?? EMPTY,
    GamesWon: EMPTY,
    GamesLost: EMPTY,
    TotalSets: EMPTY,
    SpreadLines: spread ? [spread] : [],
    TotalLines: total ? [total] : [],
    GamesWonLines: [],
    GamesLostLines: [],
    TotalSetsLines: [],
  };
}

/** Australian books on odds-api.net; others keep the region `getBookmakerRegion` gives them. */
const AU_BOOKS = new Set(['sportsbet', 'tab', 'tabtouch', 'ladbrokes', 'neds', 'pointsbet', 'palmerbet', 'betr', 'dabble', 'betright', 'playup', 'picklebet', 'unibet']);

function overUnderSide(item: NetItem): 'over' | 'under' | null {
  const text = `${item.side ?? ''} ${item.line ?? ''}`.toLowerCase();
  return text.includes('under') ? 'under' : text.includes('over') ? 'over' : null;
}

function playerOf(item: NetItem): string {
  if (item.player_name) return item.player_name;
  const m = String(item.market_key || '').match(/^player prop\/[^/]+\/(.+?) (?:over|under) /i);
  return m ? m[1] : '';
}

/** Every full-match market one non-bet365 book prices on odds-api.net, in odds-api.net home/away order. */
export function tennisOddsApiNetSourceFromItems(items: NetItem[], book: string, names: { home: string; away: string }): SourceMatch {
  const src = emptySourceMatch(book, names.home, names.away, AU_BOOKS.has(book) ? 'au' : undefined);
  const pairs = new Map<string, { a?: number; b?: number }>();
  const put = (key: string, slot: 'a' | 'b', odds: number) => {
    const row = pairs.get(key) ?? {};
    row[slot] = odds;
    pairs.set(key, row);
  };
  for (const item of items) {
    if (item.is_available === false || String(item.period || '').toLowerCase() !== 'full time') continue;
    if (!(typeof item.odds === 'number' && item.odds > 1)) continue;
    const metric = String(item.metric || '').toLowerCase();
    const side = String(item.side || '').toLowerCase();
    const line = num(item.line);
    if (item.bet_type === 'moneyline') {
      if (side === 'home' || side === 'away') put('h2h', side === 'home' ? 'a' : 'b', item.odds);
    } else if (item.bet_type === 'handicap' && line != null && (side === 'home' || side === 'away')) {
      const kind = metric === 'sets' ? 'sets' : metric === 'games' || metric === 'standard' ? 'games' : null;
      if (!kind) continue;
      const homeLine = side === 'home' ? line : -line;
      put(`hc|${kind}|${homeLine}`, side === 'home' ? 'a' : 'b', item.odds);
    } else if (item.bet_type === 'total' && line != null) {
      const ou = overUnderSide(item);
      const kind = metric === 'sets' ? 'sets' : metric === 'games' || metric === 'standard' ? 'games' : null;
      if (ou && kind) put(`tot|${kind}|${line}`, ou === 'over' ? 'a' : 'b', item.odds);
    } else if (item.bet_type === 'team total' && line != null && (side === 'home' || side === 'away')) {
      const ou = overUnderSide(item);
      if (ou && (metric === 'games' || metric === 'sets')) put(`team|${metric}|${side}|${line}`, ou === 'over' ? 'a' : 'b', item.odds);
    } else if (item.bet_type === 'player prop' && line != null) {
      const ou = overUnderSide(item);
      const who = sideOf(playerOf(item), src);
      const kind = metric === 'player set wins' ? 'sets' : metric === 'player total games' ? 'games' : null;
      if (ou && who && kind) put(`team|${kind}|${who}|${line}`, ou === 'over' ? 'a' : 'b', item.odds);
    }
  }
  for (const [key, { a, b }] of pairs) {
    if (!validPrice(a) || !validPrice(b)) continue;
    const parts = key.split('|');
    if (parts[0] === 'h2h') src.h2h = { home: a, away: b };
    else if (parts[0] === 'hc') (parts[1] === 'sets' ? src.setHandicaps : src.handicaps).push({ homeLine: Number(parts[2]), home: a, away: b });
    else if (parts[0] === 'tot') (parts[1] === 'sets' ? src.totalSets : src.totals).push({ line: Number(parts[2]), over: a, under: b });
    else if (parts[0] === 'team') {
      const [, kind, who, lineText] = parts;
      const lineValue = Number(lineText);
      if (kind === 'games') (who === 'home' ? src.homeGames : src.awayGames).push({ line: lineValue, over: a, under: b });
      else if (lineValue === 0.5) {
        if (who === 'home') src.homeWinSet = { yes: a, no: b };
        else src.awayWinSet = { yes: a, no: b };
      }
    }
  }
  return src;
}

export type TennisOddsApiNetBooks = {
  /** bet365 AU, kept apart so it shows next to the international bet365 row instead of merging into it. */
  bet365Au: Map<string, TennisBookRow>;
  /** Every other odds-api.net book per API-Tennis match id. */
  rows: Map<string, TennisBookRow[]>;
};

/** One all-bookmaker snapshot per matched match. */
export async function fetchTennisOddsApiNetBooks(games: TennisNextGame[]): Promise<TennisOddsApiNetBooks> {
  const bet365Au = new Map<string, TennisBookRow>();
  const rows = new Map<string, TennisBookRow[]>();
  const out = { bet365Au, rows };
  if (!apiKey() || !games.length) return out;
  const leagues = await tennisLeagues();
  if (!leagues.length) return out;
  const events = (await mapLimit(leagues, CONCURRENCY, leagueEvents)).flat();
  const matched: Array<{
    matchId: string;
    eventId: string;
    homeIsHome: boolean;
    names: { home: string; away: string };
    bestOfThree: boolean;
  }> = [];
  for (const game of games) {
    const matchId = String(game.matchId || '').trim();
    if (!matchId) continue;
    for (const ev of events) {
      const hit = sameMatch(ev, game);
      if (!hit) continue;
      matched.push({
        matchId,
        eventId: String(ev.event_id),
        homeIsHome: hit.homeIsHome,
        names: { home: String(ev.home_team || ''), away: String(ev.away_team || '') },
        bestOfThree: tennisGameIsBestOfThree(game),
      });
      break;
    }
  }
  await mapLimit(matched, CONCURRENCY, async ({ matchId, eventId, homeIsHome, names, bestOfThree }) => {
    const items: NetItem[] = [];
    let cursor = '';
    for (let pageNo = 0; pageNo < 4; pageNo += 1) {
      const qs = new URLSearchParams({ limit: '500' });
      if (cursor) qs.set('cursor', cursor);
      const snap = await fetchJson(`${BASE}/events/${encodeURIComponent(eventId)}/odds/snapshot?${qs}`);
      if (!snap) break;
      items.push(...((snap.items ?? []) as NetItem[]));
      cursor = String(snap.next_cursor || '');
      if (!cursor || snap.complete === true) break;
    }
    const byBook = new Map<string, NetItem[]>();
    for (const item of items) {
      const book = String(item.bookmaker || '').toLowerCase();
      if (!book) continue;
      byBook.set(book, [...(byBook.get(book) ?? []), item]);
    }
    const b365 = tennisBet365AuRowFromItems(byBook.get(BOOK) ?? [], homeIsHome);
    if (b365) bet365Au.set(matchId, b365);
    const others: TennisBookRow[] = [];
    for (const [book, list] of byBook) {
      if (book.startsWith(BOOK)) continue;
      const row = sourceMatchToBookRow(tennisOddsApiNetSourceFromItems(list, book, names), homeIsHome, bestOfThree);
      if (row) others.push(row);
    }
    if (others.length) rows.set(matchId, others);
  });
  return out;
}
