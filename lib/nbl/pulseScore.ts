/**
 * NBL player markets from PulseScore (Sportsbet AU + TAB).
 * Game moneyline/spread/total stay on The Odds API.
 */

import { decimalToAmerican } from '@/lib/currencyUtils';
import { resolveNblClubName } from '@/lib/nblTeamCanonical';
import sharedCache from '@/lib/sharedCache';
import { NBL_PLAYER_PROP_STAT_TO_MARKET, type NblBookRow, type NblPropLine } from '@/lib/nbl/oddsTypes';

const PULSESCORE_BASE = 'https://api.pulsescore.net/api';
const CACHE_KEY = 'nbl_ps_board_v1';
const CACHE_TTL_SECONDS = 365 * 24 * 60 * 60 * 10;
const FRESH_MS = 2 * 60 * 1000;

const BOOKS: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: 'sportsbet-com-au', name: 'Sportsbet' },
  { slug: 'tab', name: 'TAB' },
];

const PREFERRED_THRESHOLD: Record<string, number> = {
  points: 20,
  rebounds: 6,
  assists: 4,
  threeMade: 1,
};

interface PulseSelection {
  canonicalOutcome?: string;
  rawName?: string;
  name?: string;
  odds?: number;
  line?: number;
  isActive?: boolean;
}

interface PulseMarket {
  canonicalMarket?: string;
  rawName?: string;
  name?: string;
  period?: string;
  isActive?: boolean;
  selections?: PulseSelection[];
}

interface PulseEvent {
  eventId?: string | number;
  home?: string;
  away?: string;
  startTime?: string;
  league?: string;
  markets?: PulseMarket[];
}

interface PulseLeague {
  name?: string;
  league?: string;
  events?: PulseEvent[];
}

export interface PulseNblGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: Array<{ name: string; markets: PulseMarket[] }>;
}

interface PulseNblBoard {
  lastUpdated: string;
  games: PulseNblGame[];
}

let inflight: Promise<PulseNblBoard> | null = null;
let memoryBoard: PulseNblGame[] | null = null;

function pulseKey(): string {
  return String(process.env.PULSESCORE_API_KEY || process.env.PULSE_SCORE_KEY || '').trim();
}

function isNblLeagueName(name: string | undefined): boolean {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  if (/\bnba\b/.test(n) && !/\bnbl\b/.test(n)) return false;
  return n === 'nbl' || /\bnbl\b/.test(n) || n.includes('australian nbl');
}

function officialTeam(raw: string | undefined): string {
  const s = String(raw || '').trim();
  return resolveNblClubName(s) || s;
}

function teamKey(raw: string | undefined): string {
  return officialTeam(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function teamsMatch(a: string | undefined, b: string | undefined): boolean {
  const ka = teamKey(a);
  const kb = teamKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return ka.includes(kb) || kb.includes(ka);
}

function gameBucket(home: string, away: string, start: string): string {
  const teams = [teamKey(home), teamKey(away)].filter(Boolean).sort().join('|');
  return `${teams}|${String(start || '').slice(0, 10)}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const key = pulseKey();
  if (!key) return null;
  const res = await fetch(url, {
    headers: { 'X-Secret': key, Accept: 'application/json', 'Accept-Encoding': 'gzip' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[PulseScore NBL] ${res.status} ${url.replace(key, '…')}: ${body.slice(0, 180)}`);
    return null;
  }
  return res.json();
}

function leaguesFrom(payload: unknown): PulseLeague[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as { leagues?: PulseLeague[]; data?: PulseLeague[] };
  if (Array.isArray(payload)) return payload as PulseLeague[];
  if (Array.isArray(p.leagues)) return p.leagues;
  if (Array.isArray(p.data)) return p.data;
  return [];
}

function eventsFromLeague(league: PulseLeague): PulseEvent[] {
  return (league.events || []).map((ev) => ({
    ...ev,
    league: ev.league || league.name || league.league,
  }));
}

async function fetchBookNblEvents(slug: string): Promise<PulseEvent[]> {
  const payload = await fetchJson(`${PULSESCORE_BASE}/${slug}/basketball/leagues`);
  const leagues = leaguesFrom(payload).filter((l) => isNblLeagueName(l.name || l.league));
  const embedded = leagues.flatMap(eventsFromLeague);
  if (embedded.length) return embedded;

  const out: PulseEvent[] = [];
  for (const league of leagues) {
    const label = league.name || league.league;
    if (!label) continue;
    const page = await fetchJson(
      `${PULSESCORE_BASE}/${slug}/basketball/leagues/${encodeURIComponent(label)}/events`
    );
    const p = page as { events?: PulseEvent[] } | null;
    const events = Array.isArray(p?.events) ? p!.events! : [];
    for (const ev of events) out.push({ ...ev, league: ev.league || label });
  }
  return out;
}

function mergeBoard(byBook: Array<{ name: string; events: PulseEvent[] }>): PulseNblGame[] {
  const map = new Map<string, PulseNblGame>();
  for (const { name, events } of byBook) {
    for (const ev of events) {
      const home = officialTeam(ev.home);
      const away = officialTeam(ev.away);
      if (!home || !away) continue;
      const key = gameBucket(home, away, ev.startTime || '');
      const existing = map.get(key);
      const book = { name, markets: ev.markets || [] };
      if (existing) {
        existing.bookmakers.push(book);
        continue;
      }
      map.set(key, {
        gameId: String(ev.eventId ?? key),
        homeTeam: home,
        awayTeam: away,
        commenceTime: ev.startTime || '',
        bookmakers: [book],
      });
    }
  }
  return [...map.values()];
}

async function refreshBoard(): Promise<PulseNblBoard> {
  const byBook = await Promise.all(
    BOOKS.map(async (b) => ({ name: b.name, events: await fetchBookNblEvents(b.slug) }))
  );
  const games = mergeBoard(byBook);
  const board: PulseNblBoard = { lastUpdated: new Date().toISOString(), games };
  if (games.length) {
    memoryBoard = games;
    await sharedCache.setJSON(CACHE_KEY, board, CACHE_TTL_SECONDS);
  }
  return board;
}

export async function getNblPulseScoreBoard(): Promise<PulseNblGame[]> {
  const cached = await sharedCache.getJSON<PulseNblBoard>(CACHE_KEY);
  const cachedAge = cached?.lastUpdated ? Date.now() - Date.parse(cached.lastUpdated) : Infinity;
  if (cached?.games?.length && Number.isFinite(cachedAge) && cachedAge < FRESH_MS) {
    memoryBoard = cached.games;
    return cached.games;
  }
  if (!pulseKey()) return cached?.games?.length ? cached.games : memoryBoard ?? [];
  if (!inflight) {
    inflight = refreshBoard().finally(() => {
      inflight = null;
    });
  }
  try {
    const fresh = await inflight;
    if (fresh.games.length) return fresh.games;
  } catch (err) {
    console.warn('[PulseScore NBL] refresh failed', err instanceof Error ? err.message : err);
  }
  return cached?.games?.length ? cached.games : memoryBoard ?? [];
}

export function findPulseNblGame(
  games: PulseNblGame[],
  team: string | null | undefined,
  opponent?: string | null
): PulseNblGame | null {
  if (!games.length || !team) return null;
  let candidates = games.filter(
    (g) => teamsMatch(g.homeTeam, team) || teamsMatch(g.awayTeam, team)
  );
  if (opponent) {
    const withOpp = candidates.filter(
      (g) => teamsMatch(g.homeTeam, opponent) || teamsMatch(g.awayTeam, opponent)
    );
    if (withOpp.length) candidates = withOpp;
  }
  if (!candidates.length) return null;
  const now = Date.now();
  candidates.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  return (
    candidates.find((g) => Date.parse(g.commenceTime) >= now - 3 * 60 * 60 * 1000) ??
    candidates[candidates.length - 1]
  );
}

function stripPlayerLabel(raw: string): string {
  return String(raw || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+(over|under)\b.*$/i, '')
    .trim();
}

export function normalizePlayerName(s: string): string {
  return stripPlayerLabel(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesMatch(playerQuery: string, outcomeName: string): boolean {
  const a = normalizePlayerName(playerQuery);
  const b = normalizePlayerName(outcomeName);
  if (!a || !b) return false;
  if (a === b) return true;
  const aParts = a.split(/\s+/).filter(Boolean);
  const bParts = b.split(/\s+/).filter(Boolean);
  const lastA = aParts[aParts.length - 1] ?? '';
  const lastB = bParts[bParts.length - 1] ?? '';
  const firstA = aParts[0] ?? '';
  const firstB = bParts[0] ?? '';
  if (lastA && lastB && lastA === lastB && firstA && firstB && (firstA === firstB || firstA[0] === firstB[0])) {
    return true;
  }
  const aTail = aParts.slice(-2).join(' ');
  const bTail = bParts.slice(-2).join(' ');
  if (aTail && aTail === bTail && aTail.includes(' ')) return true;
  return b.includes(a) || a.includes(b);
}

function marketStat(rawName: string): { stat: string; threshold: number } | null {
  const n = String(rawName || '').trim();
  if (/score and win/i.test(n)) return null;
  let m = n.match(/^(?:to score\s+)?(\d+)\+\s*points$/i);
  if (m) return { stat: 'points', threshold: Number(m[1]) };
  m = n.match(/^(?:to record\s+)?(\d+)\+\s*rebounds$/i);
  if (m) return { stat: 'rebounds', threshold: Number(m[1]) };
  m = n.match(/^(?:to record\s+)?(\d+)\+\s*assists$/i);
  if (m) return { stat: 'assists', threshold: Number(m[1]) };
  m = n.match(/^(?:to (?:make|record)\s+)?(\d+)\+\s*(?:made\s+)?threes$/i);
  if (m) return { stat: 'threeMade', threshold: Number(m[1]) };
  return null;
}

function americanFromDecimal(odds: number | undefined): string {
  if (odds == null || !Number.isFinite(odds) || odds <= 1) return 'N/A';
  return decimalToAmerican(odds);
}

function emptyBook(name: string): NblBookRow {
  return {
    name,
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
  };
}

function pickMainLine(lines: NblPropLine[], stat: string): NblPropLine {
  const twoWay = lines.find((l) => l.kind === 'ou' && l.under !== 'N/A');
  if (twoWay) return twoWay;
  const want = PREFERRED_THRESHOLD[stat];
  if (want != null) {
    const exact = lines.find((l) => l.label === `${want}+`);
    if (exact) return exact;
    return [...lines].sort((a, b) => {
      const da = Math.abs((parseFloat(a.label) || parseFloat(a.line) || 0) - want);
      const db = Math.abs((parseFloat(b.label) || parseFloat(b.line) || 0) - want);
      return da - db;
    })[0];
  }
  return lines[0];
}

export function pulseBooksByStat(game: PulseNblGame, player: string): Record<string, NblBookRow[]> {
  const out: Record<string, NblBookRow[]> = {};
  for (const stat of Object.keys(NBL_PLAYER_PROP_STAT_TO_MARKET)) {
    const rows = pulseBooksForPlayer(game, player, stat);
    if (rows.length) out[stat] = rows;
  }
  return out;
}

export function pulseBooksForPlayer(game: PulseNblGame, player: string, stat: string): NblBookRow[] {
  const rows: NblBookRow[] = [];
  for (const book of game.bookmakers) {
    const byLine = new Map<string, NblPropLine>();
    for (const market of book.markets || []) {
      if (market.isActive === false) continue;
      const parsed = marketStat(market.rawName || market.name || '');
      if (!parsed || parsed.stat !== stat) continue;
      const chartLine = parsed.threshold - 0.5;
      const label = `${parsed.threshold}+`;
      for (const sel of market.selections || []) {
        if (sel.isActive === false) continue;
        const selName = stripPlayerLabel(sel.rawName || sel.name || '');
        if (!namesMatch(player, selName)) continue;
        const over = americanFromDecimal(sel.odds);
        if (over === 'N/A') continue;
        byLine.set(label, {
          line: String(chartLine),
          over,
          under: 'N/A',
          kind: 'milestone',
          label,
        });
      }
    }
    const lines = [...byLine.values()].sort((a, b) => parseFloat(a.line) - parseFloat(b.line));
    if (!lines.length) continue;
    const main = pickMainLine(lines, stat);
    rows.push({
      ...emptyBook(book.name),
      Total: { line: main.line, over: main.over, under: main.under },
      lines,
    });
  }
  return rows;
}
