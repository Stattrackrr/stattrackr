/**
 * Scoped odds-api.net pulls for Tennis / NBA / NBL tools scans.
 * One credit per request — keep book lists short and concurrency low.
 */

import { TOOLS_ODDS_NET_BOOKS } from './books';
import type { OddsNetItem } from './markets';
import type { ToolsSport } from './types';

const BASE = 'https://api.odds-api.net/v1';

export type ToolsEvent = {
  /** Board sports use ToolsSport; bonus live may use nfl/soccer/ufc/…. */
  sport: ToolsSport | string;
  apiSport: string;
  league: string;
  eventId: string;
  home: string;
  away: string;
  startMs: number;
};

export type ToolsSnapshot = {
  event: ToolsEvent;
  items: OddsNetItem[];
  asOf: Record<string, number>;
};

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

async function tennisLeagues(): Promise<string[]> {
  const coverage = await getJson('/coverage?sport=tennis&lookback_days=2');
  const leagues = new Set<string>();
  for (const row of (coverage?.markets ?? []) as Array<{ league?: string }>) {
    const league = String(row.league || '').trim();
    // Singles only — doubles market keys don't map cleanly to two-way home/away.
    if (!league || /doubles/i.test(league)) continue;
    leagues.add(league);
  }
  return [...leagues];
}

async function listLeagueEvents(
  apiSport: string,
  league: string,
  sport: ToolsSport,
  now: number,
  horizonMs: number
): Promise<ToolsEvent[]> {
  const out: ToolsEvent[] = [];
  let cursor = '';
  for (let page = 0; page < 3; page += 1) {
    const qs = new URLSearchParams({ sport: apiSport, league, limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const res = await getJson(`/events?${qs}`);
    for (const ev of (res?.items ?? res?.events ?? []) as any[]) {
      const startMs = Number(ev.start_time) * 1000;
      if (!Number.isFinite(startMs)) continue;
      if (ev.event_state && ev.event_state !== 'scheduled' && ev.event_state !== 'pre-match') continue;
      // Skip imminent / live-ish and far-out.
      if (!(startMs > now + 12 * 60_000 && startMs < now + horizonMs)) continue;
      const eventId = String(ev.event_id ?? ev.id ?? '');
      if (!eventId) continue;
      out.push({
        sport,
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

/** Per-sport caps so tennis volume cannot starve NBA/NBL. */
const DEFAULT_PER_SPORT_CAP: Record<ToolsSport, number> = {
  tennis: 100,
  nba: 40,
  nbl: 24,
};

/** Upcoming tools events for the requested sports (next `hours`). Fair per-sport budgets. */
export async function listToolsEvents(
  sports: ToolsSport[],
  opts: { hours?: number; maxEvents?: number; perSportCap?: Partial<Record<ToolsSport, number>> } = {}
): Promise<ToolsEvent[]> {
  const hours = opts.hours ?? 24;
  const now = Date.now();
  const horizonMs = hours * 3600_000;
  const out: ToolsEvent[] = [];

  for (const sport of sports) {
    const cap = opts.perSportCap?.[sport] ?? DEFAULT_PER_SPORT_CAP[sport] ?? 40;
    let rows: ToolsEvent[] = [];
    if (sport === 'nba') {
      rows = await listLeagueEvents('basketball', 'NBA', 'nba', now, horizonMs);
    } else if (sport === 'nbl') {
      rows = await listLeagueEvents('basketball', 'NBL', 'nbl', now, horizonMs);
    } else if (sport === 'tennis') {
      const leagues = await tennisLeagues();
      const batches = await mapLimit(leagues, 4, (league) =>
        listLeagueEvents('tennis', league, 'tennis', now, horizonMs)
      );
      for (const batch of batches) rows.push(...batch);
    }
    rows.sort((a, b) => a.startMs - b.startMs);
    out.push(...rows.slice(0, cap));
  }

  out.sort((a, b) => a.startMs - b.startMs);
  if (opts.maxEvents != null && opts.maxEvents > 0) return out.slice(0, opts.maxEvents);
  return out;
}

/** Game lines only (ML / HCP / totals / team totals). Player props stay off — row-cap + name noise. */
const SNAPSHOT_TYPES = 'moneyline,handicap,total,team total';

export async function fetchEventSnapshot(
  event: ToolsEvent,
  bookmakers: readonly string[] = TOOLS_ODDS_NET_BOOKS
): Promise<ToolsSnapshot | null> {
  const items: OddsNetItem[] = [];
  const asOf: Record<string, number> = {};
  let cursor = '';
  const books = [...bookmakers].filter(Boolean).join(',');
  if (!books) return null;
  for (let page = 0; page < 8; page += 1) {
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
  return { event, items, asOf };
}

export async function fetchToolsSnapshots(
  events: ToolsEvent[],
  concurrency = 4,
  bookmakers?: readonly string[]
): Promise<ToolsSnapshot[]> {
  const rows = await mapLimit(events, concurrency, (ev) => fetchEventSnapshot(ev, bookmakers));
  return rows.filter((r): r is ToolsSnapshot => r != null);
}
