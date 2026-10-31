/**
 * Tennis odds from odds-api.net: the Australian books (Sportsbet, TAB, Ladbrokes, PointsBet, ...) plus
 * Pinnacle and Betfair. Its bet365 matches the AU site and is stored as `bet365 au`, apart from
 * API-Tennis's international bet365.
 */

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
import type { TennisBookRow } from '@/lib/tennis/oddsTypes';

const BASE = 'https://api.odds-api.net/v1';
export const TENNIS_BET365_AU_BOOK = 'bet365 au';
const CONCURRENCY = 4;
/**
 * Asking for every bookmaker (100+) ran past the snapshot's row cap and cut off most Australian books,
 * so the request names the books we use. Pinnacle and Betfair are the sharp anchor.
 */
export const TENNIS_ODDS_NET_BOOKS: readonly string[] = [
  'sportsbet',
  'tab',
  'tabtouch',
  'ladbrokes',
  'neds',
  'pointsbet',
  'betright',
  'unibet',
  'dabble',
  'playup',
  'betr',
  'picklebet',
  'palmerbet',
  'bet365',
  'betgoodwin',
  'pinnacle',
  'betfair',
];
const SNAPSHOT_PAGES = 4;
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

/** Australian books on odds-api.net; others keep the region `getBookmakerRegion` gives them. */
const AU_BOOKS = new Set([
  'sportsbet',
  'tab',
  'tabtouch',
  'ladbrokes',
  'neds',
  'pointsbet',
  'palmerbet',
  'betr',
  'dabble',
  'betright',
  'playup',
  'picklebet',
  'unibet',
  TENNIS_BET365_AU_BOOK,
]);

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

export type TennisOddsNetStats = { matches: number; rowCapHits: string[] };

/** One snapshot of our books per matched match; book rows per API-Tennis match id. */
export async function fetchTennisOddsApiNetBooks(
  games: TennisNextGame[],
  stats: TennisOddsNetStats = { matches: 0, rowCapHits: [] }
): Promise<Map<string, TennisBookRow[]>> {
  const rows = new Map<string, TennisBookRow[]>();
  if (!apiKey() || !games.length) return rows;
  const leagues = await tennisLeagues();
  if (!leagues.length) return rows;
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
    for (let pageNo = 0; pageNo < SNAPSHOT_PAGES; pageNo += 1) {
      const qs = new URLSearchParams({ limit: '500', bookmakers: TENNIS_ODDS_NET_BOOKS.join(',') });
      if (cursor) qs.set('cursor', cursor);
      const snap = await fetchJson(`${BASE}/events/${encodeURIComponent(eventId)}/odds/snapshot?${qs}`);
      if (!snap) {
        cursor = '';
        break;
      }
      items.push(...((snap.items ?? []) as NetItem[]));
      cursor = snap.complete === true ? '' : String(snap.next_cursor || '');
      if (!cursor) break;
    }
    // Pages still left after the last one: some books were cut off. Logged so it can't happen silently.
    if (cursor) {
      stats.rowCapHits.push(matchId);
      console.warn(`[tennis odds-api.net] row cap hit for match ${matchId} (event ${eventId}) after ${items.length} rows`);
    }
    stats.matches += 1;
    const byBook = new Map<string, NetItem[]>();
    for (const item of items) {
      const book = String(item.bookmaker || '').toLowerCase();
      if (!book) continue;
      byBook.set(book, [...(byBook.get(book) ?? []), item]);
    }
    const others: TennisBookRow[] = [];
    for (const [book, list] of byBook) {
      if (book.startsWith('bet365') && book !== 'bet365') continue;
      const name = book === 'bet365' ? TENNIS_BET365_AU_BOOK : book;
      const row = sourceMatchToBookRow(tennisOddsApiNetSourceFromItems(list, name, names), homeIsHome, bestOfThree);
      if (row) others.push(row);
    }
    if (others.length) rows.set(matchId, others);
  });
  return rows;
}
