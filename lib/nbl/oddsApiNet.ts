/**
 * NBL player markets from odds-api.net (Sportsbet / TAB / Bet365 / Unibet).
 * Game moneyline/spread/total stay on The Odds API.
 */

import { officialNblClubName } from '@/lib/nblTeamCanonical';

type OddsNetMarket = {
  canonicalMarket?: string;
  rawName?: string;
  name?: string;
  line?: number;
  period?: string;
  isActive?: boolean;
  moreInfo?: { player?: string };
  selections?: Array<{
    canonicalOutcome?: string;
    rawName?: string;
    name?: string;
    odds?: number;
    line?: number;
    isActive?: boolean;
    moreInfo?: { player?: string };
  }>;
};

type OddsNetGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: Array<{ name: string; markets: OddsNetMarket[] }>;
};

const BASE = 'https://api.odds-api.net/v1';

/** Always request these; coverage can add more so new books still land. */
const FALLBACK_BOOKS = [
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
  'betgoodwin',
  'neds',
  'ladbrokes',
  'dabble',
  'betmgm',
  'caesars',
  'bwin',
  'cloudbet',
  'virginbet',
] as const;

const BOOK_NAMES: Record<string, string> = {
  sportsbet: 'Sportsbet',
  tab: 'TAB',
  tabtouch: 'TABtouch',
  unibet: 'Unibet',
  unibetau: 'Unibet',
  bet365: 'Bet365',
  betr: 'Betr',
  betright: 'Bet Right',
  playup: 'PlayUp',
  picklebet: 'Picklebet',
  pointsbet: 'PointsBet',
  pointsbetau: 'PointsBet',
  palmerbet: 'Palmerbet',
  betgoodwin: 'BetGoodwin',
  neds: 'Neds',
  ladbrokes: 'Ladbrokes',
  dabble: 'Dabble',
  betmgm: 'BetMGM',
  caesars: 'Caesars',
  bwin: 'Bwin',
  cloudbet: 'Cloudbet',
  virginbet: 'Virgin Bet',
};

type MetricCanon = { stat: string; canon: string; noun: string };
const METRIC_TO_CANON: Record<string, MetricCanon> = {
  'player points': { stat: 'points', canon: 'PLAYER_POINTS', noun: 'points' },
  'player rebounds': { stat: 'rebounds', canon: 'PLAYER_REBOUNDS', noun: 'rebounds' },
  'player assists': { stat: 'assists', canon: 'PLAYER_ASSISTS', noun: 'assists' },
  'player threes': { stat: 'threeMade', canon: 'PLAYER_THREES_MADE', noun: 'threes' },
};

type OddsApiEvent = {
  event_id?: string | number;
  id?: string | number;
  home_team?: string;
  away_team?: string;
  home?: string;
  away?: string;
  start_time?: number;
  commence_time?: string | number;
  event_state?: string;
};

type OddsApiItem = {
  bookmaker?: string;
  player_name?: string;
  selection_name?: string;
  metric?: string;
  line?: string;
  odds?: number;
  is_available?: boolean;
  period?: string;
};

function eventsFrom(payload: unknown): OddsApiEvent[] {
  if (Array.isArray(payload)) return payload as OddsApiEvent[];
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as { items?: OddsApiEvent[]; events?: OddsApiEvent[]; data?: OddsApiEvent[] };
  if (Array.isArray(p.items)) return p.items;
  if (Array.isArray(p.events)) return p.events;
  if (Array.isArray(p.data)) return p.data;
  return [];
}

function commenceIso(ev: OddsApiEvent): string {
  if (typeof ev.start_time === 'number' && ev.start_time > 0) {
    return new Date(ev.start_time * 1000).toISOString();
  }
  if (typeof ev.commence_time === 'number' && ev.commence_time > 0) {
    return new Date(ev.commence_time * (ev.commence_time > 1e12 ? 1 : 1000)).toISOString();
  }
  if (typeof ev.commence_time === 'string' && ev.commence_time.trim()) {
    const t = Date.parse(ev.commence_time);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return '';
}

function apiKey(): string {
  return String(process.env.ODDS_API_NET_KEY || process.env.ODDS_API_NET || '').trim();
}

async function playerPropBookmakers(): Promise<string> {
  const books = new Set<string>(FALLBACK_BOOKS);
  const coverage = await fetchJson(`${BASE}/coverage?sport=basketball&league=NBL&lookback_days=14`);
  const markets = Array.isArray((coverage as { markets?: Array<{ bet_type?: string; bookmaker?: string }> } | null)?.markets)
    ? (coverage as { markets: Array<{ bet_type?: string; bookmaker?: string }> }).markets
    : [];
  for (const row of markets) {
    const book = String(row.bookmaker || '').trim().toLowerCase();
    if (book && row.bet_type === 'player prop') books.add(book);
  }
  return [...books].join(',');
}

async function fetchJson(url: string): Promise<unknown> {
  const key = apiKey();
  if (!key) return null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'X-API-Key': key, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 429 || res.status === 503) {
        console.warn(`[odds-api.net NBL] ${res.status} retry ${attempt}/3`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[odds-api.net NBL] ${res.status} ${url}: ${body.slice(0, 180)}`);
        return null;
      }
      return res.json();
    } catch (err) {
      console.warn('[odds-api.net NBL] fetch fail', err instanceof Error ? err.message : err);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

function displayBook(raw: string | undefined): string | null {
  const key = String(raw || '').trim().toLowerCase();
  return BOOK_NAMES[key] || (key ? key.replace(/\b\w/g, (c) => c.toUpperCase()) : null);
}

function prettyPerson(raw: string | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^\|+|\|+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isLikelyPlayerName(raw: string): boolean {
  const s = String(raw || '').trim();
  if (s.length < 3 || /\d/.test(s)) return false;
  if (/^(over|under|yes|no)$/i.test(s)) return false;
  if (/\b(points?|rebounds?|assists?|threes?|pts|reb|ast)\b/i.test(s)) return false;
  return /[a-z]/i.test(s);
}

function cleanSelectionPlayer(raw: string | undefined): string {
  let s = String(raw || '').trim();
  s = s.replace(/^\|+|\|+$/g, '').trim();
  s = s.replace(/^player\s+(points|rebounds|assists|threes|pra|pr|pa|ra)\s*[-–:]\s*/i, '');
  s = s.replace(/\s*\((?:match|game|1st half|2nd half|q\d)\)\s*$/i, '');
  s = s.replace(/\s*[-–]\s*\d+\+.*$/i, '');
  s = s.replace(/\s+\d+\+\s*.*$/i, '');
  s = s.replace(/\s+(over|under)\s+\d.*$/i, '');
  s = s.replace(/\s*\([^)]{1,6}\)\s*$/g, '');
  return prettyPerson(s);
}

function displayPlayer(item: OddsApiItem): string {
  const fromField = prettyPerson(item.player_name);
  if (isLikelyPlayerName(fromField)) return fromField;
  const fromSelection = cleanSelectionPlayer(item.selection_name);
  if (isLikelyPlayerName(fromSelection)) return fromSelection;
  return fromField;
}

function parseSideLine(raw: string | undefined): { side: 'over' | 'under'; value: number } | null {
  const m = String(raw || '')
    .trim()
    .match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  return { side: m[1].toLowerCase() as 'over' | 'under', value: Number(m[2]) };
}

function milestoneThreshold(value: number): number {
  return Math.abs(value - Math.round(value)) < 1e-6 ? value : Math.round(value + 0.5);
}

export async function fetchOddsApiNetNblGames(): Promise<OddsNetGame[]> {
  if (!apiKey()) return [];
  const bookmakerParam = await playerPropBookmakers();
  const eventsPage = await fetchJson(`${BASE}/events?sport=basketball&league=NBL&limit=50`);
  const events = eventsFrom(eventsPage);
  const games: OddsNetGame[] = [];

  for (const ev of events) {
    const eventId = ev.event_id ?? ev.id;
    const home = officialNblClubName(ev.home_team || ev.home);
    const away = officialNblClubName(ev.away_team || ev.away);
    if (!home || !away || eventId == null) continue;
    const items: OddsApiItem[] = [];
    let cursor = '';
    for (let page = 0; page < 6; page += 1) {
      const qs = new URLSearchParams({
        types: 'player prop',
        bookmakers: bookmakerParam,
        limit: '500',
      });
      if (cursor) qs.set('cursor', cursor);
      const snap = await fetchJson(`${BASE}/events/${encodeURIComponent(String(eventId))}/odds/snapshot?${qs}`);
      const payload = snap as { items?: OddsApiItem[]; next_cursor?: string; complete?: boolean } | null;
      items.push(...(payload?.items || []));
      if (!payload?.next_cursor || payload.complete === true) break;
      cursor = payload.next_cursor;
    }

    const byBook = new Map<string, Map<string, { over?: OddsApiItem; under?: OddsApiItem; meta: MetricCanon; player: string; value: number; period: string }>>();
    for (const item of items) {
      if (item.is_available === false) continue;
      const book = displayBook(item.bookmaker);
      const meta = METRIC_TO_CANON[String(item.metric || '').toLowerCase()];
      const parsed = parseSideLine(item.line);
      const player = displayPlayer(item);
      if (!book || !meta || !parsed || !player) continue;
      if (typeof item.odds !== 'number' || item.odds <= 1) continue;
      const period = String(item.period || '').trim();
      const bookMap = byBook.get(book) ?? new Map();
      const key = `${player.toLowerCase()}|${meta.stat}|${parsed.value}|${period.toLowerCase()}`;
      const row = bookMap.get(key) ?? { meta, player, value: parsed.value, period };
      if (parsed.side === 'under') row.under = item;
      else row.over = item;
      bookMap.set(key, row);
      byBook.set(book, bookMap);
    }

    const bookmakers: OddsNetGame['bookmakers'] = [];
    for (const [name, rows] of byBook) {
      const markets: OddsNetMarket[] = [];
      for (const row of rows.values()) {
        const twoWay = Boolean(row.over && row.under);
        if (twoWay) {
          markets.push({
            canonicalMarket: row.meta.canon,
            rawName: `Player ${row.meta.noun.replace(/^./, (c) => c.toUpperCase())}`,
            name: `${row.player} ${row.value}`,
            line: row.value,
            period: row.period,
            isActive: true,
            moreInfo: { player: row.player },
            selections: [
              row.over
                ? {
                    canonicalOutcome: 'OVER',
                    rawName: `${row.player} Over ${row.value}`,
                    name: `${row.player} Over ${row.value}`,
                    odds: row.over.odds,
                    line: row.value,
                    isActive: true,
                    moreInfo: { player: row.player },
                  }
                : null,
              row.under
                ? {
                    canonicalOutcome: 'UNDER',
                    rawName: `${row.player} Under ${row.value}`,
                    name: `${row.player} Under ${row.value}`,
                    odds: row.under.odds,
                    line: row.value,
                    isActive: true,
                    moreInfo: { player: row.player },
                  }
                : null,
            ].filter((sel): sel is NonNullable<typeof sel> => sel != null),
          });
          continue;
        }
        if (!row.over) continue;
        const threshold = milestoneThreshold(row.value);
        markets.push({
          canonicalMarket: row.meta.canon,
          rawName: `${threshold}+ ${row.meta.noun}`,
          name: `${row.player} ${threshold}+ ${row.meta.noun}`,
          line: threshold,
          period: row.period,
          isActive: true,
          moreInfo: { player: row.player },
          selections: [
            {
              canonicalOutcome: 'OVER',
              rawName: row.player,
              name: row.player,
              odds: row.over.odds,
              line: threshold,
              isActive: true,
              moreInfo: { player: row.player },
            },
          ],
        });
      }
      if (markets.length) bookmakers.push({ name, markets });
    }

    if (!bookmakers.length) continue;
    games.push({
      gameId: String(eventId),
      homeTeam: home,
      awayTeam: away,
      commenceTime: commenceIso(ev),
      bookmakers,
    });
  }

  return games;
}
