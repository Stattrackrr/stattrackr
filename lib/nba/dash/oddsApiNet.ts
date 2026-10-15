/**
 * NBA player props from odds-api.net: the Australian books (plus Pinnacle) BallDontLie doesn't carry.
 * Every request costs 1 credit on the 50k/month plan shared with NBL.
 */

import { parseNblOddsApiNetSideLine } from '@/lib/nbl/oddsApiNet';
import type { NbaPlayerPropsByBook, NbaPropEntry } from './oddsTypes';
import { normalizeTeamKey, resolveNbaClubName } from './teams';

const BASE = 'https://api.odds-api.net/v1';

/** DraftKings / FanDuel are left to BallDontLie; this list keeps each game to one snapshot page. */
export const NBA_ODDS_NET_BOOKS: readonly string[] = [
  'sportsbet',
  'tab',
  'unibet',
  'bet365',
  'betr',
  'betright',
  'playup',
  'picklebet',
  'pointsbet',
  'tabtouch',
  'palmerbet',
  'neds',
  'ladbrokes',
  'dabble',
  'betgoodwin',
  'pinnacle',
];
const BOOKS = new Set(NBA_ODDS_NET_BOOKS);
/** Stored key when the bare name would read as a non-AU book. */
const STORED_BOOK: Record<string, string> = { bet365: 'bet365_au' };
const STORED_BOOKS = new Set(NBA_ODDS_NET_BOOKS.map((b) => STORED_BOOK[b] ?? b));

const METRIC_TO_KEY: Record<string, string> = {
  'player points': 'PTS',
  'player rebounds': 'REB',
  'player assists': 'AST',
  'player threes': 'THREES',
  'player threes made': 'THREES',
  'player steals': 'STL',
  'player blocks': 'BLK',
  'player turnovers': 'TO',
  'player pra': 'PRA',
  'player pr': 'PR',
  'player pa': 'PA',
  'player ra': 'RA',
};

/** odds-api.net tip times can be hours off BallDontLie's; teams never meet twice inside this. */
const EVENT_MATCH_MS = 12 * 60 * 60 * 1000;

type OddsNetEvent = {
  event_id?: string | number;
  id?: string | number;
  home_team?: string;
  away_team?: string;
  home?: string;
  away?: string;
  start_time?: number | string;
  commence_time?: number | string;
};

type OddsNetItem = {
  bookmaker?: string;
  player_name?: string;
  selection_name?: string;
  metric?: string;
  line?: string | number;
  side?: string;
  odds?: number;
  is_available?: boolean;
  period?: string;
};

export type NbaOddsNetTarget = { gameId: string; homeTeam: string; awayTeam: string; tipMs: number };

export type NbaOddsNetResult = {
  /** Games fetched successfully (an empty board means no listed props yet). */
  props: Map<string, NbaPlayerPropsByBook>;
  /** Games whose fetch failed; callers keep their previous lines. */
  failed: Set<string>;
  requests: number;
};

export function isNbaOddsNetBook(book: string): boolean {
  return STORED_BOOKS.has(book);
}

function apiKey(): string {
  return String(process.env.ODDS_API_NET_KEY || process.env.ODDS_API_NET || '').trim();
}

function tipMsOf(raw: number | string | undefined): number {
  if (typeof raw === 'number' && raw > 0) return raw > 1e12 ? raw : raw * 1000;
  if (typeof raw === 'string' && raw.trim()) return Date.parse(raw);
  return NaN;
}

function teamKey(raw: string | undefined): string {
  return normalizeTeamKey(resolveNbaClubName(raw) || raw || '');
}

function american(decimal: number): string {
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return String(-Math.round(100 / (decimal - 1)));
}

function prettyPlayer(raw: string | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function milestoneThreshold(value: number): number {
  return Number.isInteger(value) ? value : Math.round(value + 0.5);
}

export function nbaOddsNetEventProps(items: OddsNetItem[]): NbaPlayerPropsByBook {
  type Row = { book: string; player: string; key: string; value: number; over?: number; under?: number };
  const rows = new Map<string, Row>();
  for (const item of items) {
    if (item.is_available === false) continue;
    const book = String(item.bookmaker || '').trim().toLowerCase();
    const key = METRIC_TO_KEY[String(item.metric || '').trim().toLowerCase()];
    const period = String(item.period || '').trim().toLowerCase();
    if (!BOOKS.has(book) || !key || (period && period !== 'full time')) continue;
    const player = prettyPlayer(item.player_name);
    const parsed = parseNblOddsApiNetSideLine(item);
    if (!/[a-z]/i.test(player) || !parsed || typeof item.odds !== 'number' || item.odds <= 1) continue;
    const stored = STORED_BOOK[book] ?? book;
    const id = `${stored}|${player.toLowerCase()}|${key}|${parsed.value}`;
    const row = rows.get(id) ?? { book: stored, player, key, value: parsed.value };
    row[parsed.side] = item.odds;
    rows.set(id, row);
  }

  const out: NbaPlayerPropsByBook = {};
  for (const row of rows.values()) {
    let entry: NbaPropEntry | null = null;
    if (row.over && row.under) {
      entry = { line: String(row.value), over: american(row.over), under: american(row.under) };
    } else if (row.over) {
      entry = { line: String(milestoneThreshold(row.value)), over: american(row.over), under: 'N/A', milestone: true };
    }
    if (!entry) continue;
    const list = (((out[row.book] ??= {})[row.player] ??= {})[row.key] ??= []);
    if (!list.some((e) => e.line === entry!.line && Boolean(e.milestone) === Boolean(entry!.milestone))) list.push(entry);
  }
  for (const players of Object.values(out)) {
    for (const stats of Object.values(players)) {
      for (const lines of Object.values(stats)) lines.sort((a, b) => Number(a.line) - Number(b.line));
    }
  }
  return out;
}

export async function fetchNbaOddsNetProps(targets: NbaOddsNetTarget[]): Promise<NbaOddsNetResult> {
  const result: NbaOddsNetResult = { props: new Map(), failed: new Set(), requests: 0 };
  const key = apiKey();
  if (!key || !targets.length) {
    for (const t of targets) result.failed.add(t.gameId);
    return result;
  }

  const getJson = async (path: string): Promise<unknown> => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      result.requests += 1;
      try {
        const res = await fetch(`${BASE}${path}`, {
          headers: { 'X-API-Key': key, Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(25_000),
        });
        if (res.ok) return res.json();
        if (res.status !== 429 && res.status !== 503) {
          console.warn(`[odds-api.net NBA] ${res.status} ${path.split('?')[0]}`);
          return null;
        }
      } catch (err) {
        console.warn('[odds-api.net NBA] fetch fail', err instanceof Error ? err.message : err);
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  };

  const eventsPayload = (await getJson('/events?sport=basketball&league=NBA&limit=100')) as
    | { items?: OddsNetEvent[]; events?: OddsNetEvent[]; data?: OddsNetEvent[] }
    | OddsNetEvent[]
    | null;
  if (!eventsPayload) {
    for (const t of targets) result.failed.add(t.gameId);
    return result;
  }
  const events = Array.isArray(eventsPayload)
    ? eventsPayload
    : eventsPayload.items ?? eventsPayload.events ?? eventsPayload.data ?? [];

  const books = NBA_ODDS_NET_BOOKS.join(',');
  for (const target of targets) {
    const home = teamKey(target.homeTeam);
    const away = teamKey(target.awayTeam);
    const event = events.find((ev) => {
      const a = teamKey(ev.home_team || ev.home);
      const b = teamKey(ev.away_team || ev.away);
      const sameTeams = (a === home && b === away) || (a === away && b === home);
      const tip = tipMsOf(ev.start_time ?? ev.commence_time);
      return sameTeams && Number.isFinite(tip) && Math.abs(tip - target.tipMs) <= EVENT_MATCH_MS;
    });
    const eventId = event?.event_id ?? event?.id;
    if (eventId == null) {
      result.props.set(target.gameId, {});
      continue;
    }
    const items: OddsNetItem[] = [];
    let cursor = '';
    let ok = true;
    for (let page = 0; page < 4; page += 1) {
      const qs = new URLSearchParams({ types: 'player prop', limit: '500', bookmakers: books });
      if (cursor) qs.set('cursor', cursor);
      const snap = (await getJson(`/events/${encodeURIComponent(String(eventId))}/odds/snapshot?${qs}`)) as {
        items?: OddsNetItem[];
        next_cursor?: string;
        complete?: boolean;
      } | null;
      if (!snap) {
        ok = false;
        break;
      }
      items.push(...(snap.items ?? []));
      if (!snap.next_cursor || snap.complete === true) break;
      cursor = snap.next_cursor;
    }
    if (!ok) {
      result.failed.add(target.gameId);
      continue;
    }
    result.props.set(target.gameId, nbaOddsNetEventProps(items));
  }
  return result;
}
