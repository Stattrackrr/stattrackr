/**
 * Wide live odds pull for the Bonus Flipper only.
 * Cap league lists + snapshots so one "Find" stays ~100–120 odds-api credits
 * (then cached ~15m). ARB/EV/MID stay on Redis boards.
 */

import { canonBook } from './books';
import type { OddsNetItem } from './markets';
import type { ToolsEvent, ToolsSnapshot } from './fetch';

const BASE = 'https://api.odds-api.net/v1';

/** Hard caps — tune if credit burn is too high. Cold Find ≈ leagues + events + 1. */
export const BONUS_LIVE_MAX_LEAGUES = 44;
export const BONUS_LIVE_MAX_EVENTS = 96;
export const BONUS_LIVE_EVENT_PAGES = 1;
export const BONUS_LIVE_HORIZON_MS = 24 * 3600_000;
export const BONUS_LIVE_MIN_START_MS = 8 * 60_000;
/** Guarantee these leagues get snapshot seats before round-robin fill. */
const RESERVED_LEAGUE = /^(NFL|NBA|NBL|NCAAF|NHL|MLB|EPL|Premier League|La Liga|Bundesliga|Serie A|UFC|ATP|WTA|AFL|NRL|WNBA)/i;
const RESERVED_PER_LEAGUE = 4;

const PRIORITY_SPORTS = [
  'american football',
  'basketball',
  'tennis',
  'soccer',
  'mma/ufc',
  'ice hockey',
  'baseball',
  'rugby league',
  'aussie rules',
  'cricket',
  'rugby union',
] as const;

const PRIORITY_LEAGUE =
  /^(NFL|NBA|NBL|NCAAF|NHL|MLB|EPL|Premier League|La Liga|Bundesliga|Serie A|Ligue 1|UEFA|UFC|ATP|WTA|AFL|NRL|A-League|Big Bash|WNBA)/i;

/** Bonus Flipper needs player props too — Redis size is handled in bonusWarm slim/trim only. */
const SNAPSHOT_TYPES = 'moneyline,handicap,total,team total,player prop';

function apiKey(): string {
  return String(process.env.ODDS_API_NET_KEY || process.env.ODDS_API_NET || '').trim();
}

async function getJson(path: string): Promise<any | null> {
  const key = apiKey();
  if (!key) return null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { 'X-API-Key': key, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
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
        out[i] = await fn(items[i]!);
      }
    })
  );
  return out;
}

/** odds-api.net catalog key → source keys that appear on event.bookmakers / snapshot rows. */
function bookSourceKeys(bonusBook: string): string[] {
  const b = canonBook(bonusBook);
  if (b === 'allbets') return ['allbets', 'goldbet'];
  return b ? [b] : [];
}

function eventHasBonusBook(bookmakers: string[] | undefined, sources: Set<string>): boolean {
  if (!bookmakers?.length) return true; // unknown — still try
  return bookmakers.some((b) => sources.has(String(b || '').toLowerCase()));
}

function sportSlug(apiSport: string, league = ''): string {
  const s = apiSport.toLowerCase();
  const lg = String(league || '');
  if (s === 'basketball') {
    if (/^NBA\b/i.test(lg)) return 'nba';
    if (/^NBL\b/i.test(lg)) return 'nbl';
    if (/^WNBA\b/i.test(lg)) return 'wnba';
    return 'basketball';
  }
  if (s === 'tennis') return 'tennis';
  if (s === 'american football') {
    if (/NCAAF|college/i.test(lg)) return 'ncaaf';
    if (/^NFL\b/i.test(lg)) return 'nfl';
    return 'football';
  }
  if (s === 'soccer') return 'soccer';
  if (s === 'mma/ufc') return 'ufc';
  if (s === 'ice hockey') return 'nhl';
  if (s === 'baseball') return 'mlb';
  if (s === 'aussie rules') return 'afl';
  if (s === 'rugby league') return 'nrl';
  if (s === 'cricket') return 'cricket';
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sport';
}

function pickLeagues(rows: Array<{ sport: string; league: string }>): Array<{ sport: string; league: string }> {
  const sportRank = new Map(PRIORITY_SPORTS.map((s, i) => [s, i]));
  const filtered = rows.filter((r) => {
    if (!r.sport || !r.league) return false;
    if (/doubles/i.test(r.league)) return false;
    return sportRank.has(r.sport.toLowerCase() as (typeof PRIORITY_SPORTS)[number]) || PRIORITY_LEAGUE.test(r.league);
  });
  filtered.sort((a, b) => {
    const pa = PRIORITY_LEAGUE.test(a.league) ? 0 : 1;
    const pb = PRIORITY_LEAGUE.test(b.league) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const sa = sportRank.get(a.sport.toLowerCase() as (typeof PRIORITY_SPORTS)[number]) ?? 99;
    const sb = sportRank.get(b.sport.toLowerCase() as (typeof PRIORITY_SPORTS)[number]) ?? 99;
    if (sa !== sb) return sa - sb;
    return a.league.localeCompare(b.league);
  });
  const seen = new Set<string>();
  const out: Array<{ sport: string; league: string }> = [];
  for (const row of filtered) {
    const k = `${row.sport}|${row.league}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
    if (out.length >= BONUS_LIVE_MAX_LEAGUES) break;
  }
  return out;
}

async function listLeagueEvents(
  apiSport: string,
  league: string,
  now: number,
  sources: Set<string>
): Promise<ToolsEvent[]> {
  const out: ToolsEvent[] = [];
  let cursor = '';
  for (let page = 0; page < BONUS_LIVE_EVENT_PAGES; page += 1) {
    const qs = new URLSearchParams({ sport: apiSport, league, limit: '40' });
    if (cursor) qs.set('cursor', cursor);
    const res = await getJson(`/events?${qs}`);
    for (const ev of (res?.items ?? res?.events ?? []) as any[]) {
      const startMs = Number(ev.start_time) * 1000;
      if (!Number.isFinite(startMs)) continue;
      const state = String(ev.event_state || '').toLowerCase();
      if (state && state !== 'scheduled' && state !== 'pre-match') continue;
      if (!(startMs > now + BONUS_LIVE_MIN_START_MS && startMs < now + BONUS_LIVE_HORIZON_MS)) continue;
      if (!eventHasBonusBook(ev.bookmakers, sources)) continue;
      const eventId = String(ev.event_id ?? ev.id ?? '');
      if (!eventId) continue;
      out.push({
        sport: sportSlug(apiSport, league),
        apiSport,
        league,
        eventId,
        home: String(ev.home_team || ev.home || 'Home'),
        away: String(ev.away_team || ev.away || 'Away'),
        startMs,
      });
    }
    cursor = String(res?.next_cursor || '');
    if (!cursor) break;
  }
  return out;
}

async function fetchSnapshot(event: ToolsEvent, bookmakers: string[]): Promise<ToolsSnapshot | null> {
  const items: OddsNetItem[] = [];
  const asOf: Record<string, number> = {};
  let cursor = '';
  const books = bookmakers.filter(Boolean).join(',');
  if (!books) return null;
  for (let page = 0; page < 4; page += 1) {
    const qs = new URLSearchParams({
      types: SNAPSHOT_TYPES,
      limit: '500',
      bookmakers: books,
    });
    if (cursor) qs.set('cursor', cursor);
    const snap = await getJson(`/events/${encodeURIComponent(event.eventId)}/odds/snapshot?${qs}`);
    if (!snap) return items.length ? { event, items, asOf } : null;
    items.push(...((snap.items ?? []) as OddsNetItem[]));
    Object.assign(asOf, snap.bookmaker_as_of_ts_ms ?? {});
    if (!snap.next_cursor || snap.complete === true) break;
    cursor = String(snap.next_cursor || '');
    if (!cursor) break;
  }
  return items.length ? { event, items, asOf } : null;
}

export type BonusLiveResult = {
  snapshots: ToolsSnapshot[];
  /** Approximate odds-api.net requests used for this pull. */
  requests: number;
  leaguesTried: number;
  eventsListed: number;
  eventsSnapshotted: number;
  sports: string[];
};

/**
 * Live pull of upcoming events where the bonus book is priced, vs held hedge books.
 * One credit ≈ one HTTP request to odds-api.net.
 */
export async function fetchBonusLiveSnapshots(opts: {
  bonusBook: string;
  heldBooks: string[];
}): Promise<BonusLiveResult> {
  const bonusBook = canonBook(opts.bonusBook);
  const held = [...new Set(opts.heldBooks.map(canonBook).filter((b) => b && b !== bonusBook))];
  if (!bonusBook || !held.length || !apiKey()) {
    return { snapshots: [], requests: 0, leaguesTried: 0, eventsListed: 0, eventsSnapshotted: 0, sports: [] };
  }

  const sources = new Set(bookSourceKeys(bonusBook));
  let requests = 0;

  const cov = await getJson(`/coverage?bookmaker=${encodeURIComponent(bonusBook)}&view=summary`);
  requests += 1;
  const leagueRows = ((cov?.leagues ?? []) as Array<{ sport?: string; league?: string }>).map((l) => ({
    sport: String(l.sport || '').trim(),
    league: String(l.league || '').trim(),
  }));
  const leagues = pickLeagues(leagueRows);
  const now = Date.now();

  const listedBatches = await mapLimit(leagues, 5, async (row) => {
    const rows = await listLeagueEvents(row.sport, row.league, now, sources);
    return rows;
  });
  requests += leagues.length;

  const listed = [...new Map(listedBatches.flat().map((e) => [e.eventId, e])).values()];
  // Reserved priority leagues first, then round-robin by sport (soccer can't starve NFL/NBA).
  const slice = balanceEventsBySport(listed, BONUS_LIVE_MAX_EVENTS);

  const bookmakers = [...new Set([bonusBook, ...sources, ...held])];
  const snaps = await mapLimit(slice, 4, (ev) => fetchSnapshot(ev, bookmakers));
  // Each event snapshot is at least 1 request (extra pages rare with book filter).
  requests += slice.length;
  const kept = snaps.filter((s): s is ToolsSnapshot => s != null);
  const sports = [...new Set(kept.map((s) => String(s.event.apiSport || s.event.sport)))].sort();

  return {
    snapshots: kept,
    requests,
    leaguesTried: leagues.length,
    eventsListed: listed.length,
    eventsSnapshotted: kept.length,
    sports,
  };
}

/** Priority-league seats first, then fair round-robin across apiSport. */
function balanceEventsBySport(events: ToolsEvent[], max: number): ToolsEvent[] {
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
  const out: ToolsEvent[] = [];
  const seen = new Set<string>();

  const reserveCounts = new Map<string, number>();
  for (const ev of sorted) {
    if (out.length >= max) break;
    if (!RESERVED_LEAGUE.test(ev.league)) continue;
    const n = reserveCounts.get(ev.league) ?? 0;
    if (n >= RESERVED_PER_LEAGUE) continue;
    if (seen.has(ev.eventId)) continue;
    seen.add(ev.eventId);
    reserveCounts.set(ev.league, n + 1);
    out.push(ev);
  }

  const bySport = new Map<string, ToolsEvent[]>();
  for (const e of sorted) {
    if (seen.has(e.eventId)) continue;
    const key = String(e.apiSport || e.sport || 'other').toLowerCase();
    const list = bySport.get(key) ?? [];
    list.push(e);
    bySport.set(key, list);
  }

  const sports = [...bySport.keys()].sort((a, b) => {
    const ra = PRIORITY_SPORTS.indexOf(a as (typeof PRIORITY_SPORTS)[number]);
    const rb = PRIORITY_SPORTS.indexOf(b as (typeof PRIORITY_SPORTS)[number]);
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });

  let progressed = true;
  while (out.length < max && progressed) {
    progressed = false;
    for (const sport of sports) {
      if (out.length >= max) break;
      const list = bySport.get(sport);
      if (!list?.length) continue;
      while (list.length) {
        const ev = list.shift()!;
        if (seen.has(ev.eventId)) continue;
        seen.add(ev.eventId);
        out.push(ev);
        progressed = true;
        break;
      }
    }
  }
  return out;
}
