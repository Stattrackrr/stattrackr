/**
 * NBL game odds via The Odds API v4 (`basketball_nbl`, region au).
 */

import { resolveNblClubName } from '@/lib/nblTeamCanonical';
import sharedCache from '@/lib/sharedCache';
import type { NblBookRow, NblGameOdds, NblOddsCache } from '@/lib/nbl/oddsTypes';

export type { NblBookRow, NblGameOdds, NblOddsCache };

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const NBL_SPORT_KEY = 'basketball_nbl';

export const NBL_ODDS_CACHE_KEY = 'nbl_game_odds_v1';
export const NBL_ODDS_STALE_CACHE_KEY = 'nbl_game_odds_v1_stale';
export const NBL_ODDS_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60 * 10;

const NBL_ODDS_EXCLUDED_BOOKMAKERS = ['tabtouch', 'playup', 'betrivers', 'bet rivers'];

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

function isExcludedBookmaker(key: string | undefined, title: string | undefined): boolean {
  const k = (key ?? '').trim().toLowerCase();
  const t = (title ?? '').trim().toLowerCase();
  return NBL_ODDS_EXCLUDED_BOOKMAKERS.some((x) => k === x || t === x || k.includes(x) || t.includes(x));
}

function formatAmerican(price: number): string {
  if (price === undefined || price === null || !Number.isFinite(price)) return 'N/A';
  const p = Math.round(price);
  return p > 0 ? `+${p}` : String(p);
}

function officialName(raw: string): string {
  return resolveNblClubName(raw) || String(raw || '').trim();
}

function norm(s: string | undefined): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function outcomeMatchesTeam(o: OddsApiOutcome, team: string): boolean {
  const names = [norm(o.name), norm(officialName(o.name))].filter(Boolean);
  const teams = [norm(team), norm(officialName(team))].filter(Boolean);
  if (!teams.length) return false;
  return names.some((n) => teams.some((t) => n === t || n.includes(t) || t.includes(n)));
}

function parseOutcomesToBookRow(
  homeTeam: string,
  awayTeam: string,
  bookmaker: OddsApiBookmaker
): NblBookRow | null {
  const h2h = bookmaker.markets.find((m) => m.key === 'h2h');
  const spreads = bookmaker.markets.find((m) => m.key === 'spreads');
  const totals = bookmaker.markets.find((m) => m.key === 'totals');

  let homeH2H = 'N/A';
  let awayH2H = 'N/A';
  if (h2h?.outcomes && h2h.outcomes.length >= 2) {
    const homeOut = h2h.outcomes.find((o) => outcomeMatchesTeam(o, homeTeam));
    const awayOut = h2h.outcomes.find((o) => outcomeMatchesTeam(o, awayTeam));
    if (homeOut != null) homeH2H = formatAmerican(homeOut.price);
    if (awayOut != null) awayH2H = formatAmerican(awayOut.price);
  }

  let spreadLine = 'N/A';
  let spreadOver = 'N/A';
  let spreadUnder = 'N/A';
  if (spreads?.outcomes && spreads.outcomes.length >= 2) {
    const homeOut = spreads.outcomes.find((o) => outcomeMatchesTeam(o, homeTeam));
    const awayOut = spreads.outcomes.find((o) => outcomeMatchesTeam(o, awayTeam));
    const homePoint = typeof homeOut?.point === 'number' ? homeOut.point : undefined;
    const awayPoint = typeof awayOut?.point === 'number' ? awayOut.point : undefined;
    if (typeof homePoint === 'number') {
      spreadLine = String(homePoint);
      spreadOver = formatAmerican(homeOut!.price);
      spreadUnder = awayOut != null ? formatAmerican(awayOut.price) : 'N/A';
    } else if (typeof awayPoint === 'number') {
      spreadLine = String(awayPoint);
      spreadOver = formatAmerican(awayOut!.price);
      spreadUnder = homeOut != null ? formatAmerican(homeOut.price) : 'N/A';
    }
  }

  let totalLine = 'N/A';
  let totalOver = 'N/A';
  let totalUnder = 'N/A';
  if (totals?.outcomes && totals.outcomes.length >= 2) {
    const overOut = totals.outcomes.find((o) => o.name?.toLowerCase() === 'over');
    const underOut = totals.outcomes.find((o) => o.name?.toLowerCase() === 'under');
    const pointOut = totals.outcomes.find((o) => typeof o.point === 'number');
    const point = typeof pointOut?.point === 'number' ? pointOut.point : null;
    if (point != null) {
      totalLine = String(point);
      if (overOut != null) totalOver = formatAmerican(overOut.price);
      if (underOut != null) totalUnder = formatAmerican(underOut.price);
    }
  }

  if (homeH2H === 'N/A' && awayH2H === 'N/A' && spreadLine === 'N/A' && totalLine === 'N/A') return null;

  return {
    name: bookmaker.title || bookmaker.key || 'Unknown',
    H2H: { home: homeH2H, away: awayH2H },
    Spread: { line: spreadLine, over: spreadOver, under: spreadUnder },
    Total: { line: totalLine, over: totalOver, under: totalUnder },
  };
}

export async function refreshNblOddsData(options?: { skipWrite?: boolean }): Promise<{
  success: boolean;
  gamesCount: number;
  lastUpdated: string;
  nextUpdate: string;
  games?: NblGameOdds[];
  cachePayload?: NblOddsCache;
  error?: string;
}> {
  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    return { success: false, gamesCount: 0, lastUpdated: '', nextUpdate: '', error: 'ODDS_API_KEY not set' };
  }

  const now = new Date();
  const nextUpdate = new Date(now.getTime() + 30 * 60 * 1000);
  const url = `${ODDS_API_BASE}/sports/${NBL_SPORT_KEY}/odds?regions=au&oddsFormat=american&markets=h2h,spreads,totals&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    const remaining = res.headers.get('x-requests-remaining');
    const used = res.headers.get('x-requests-used');
    if (remaining) console.log(`[NBL Odds] The Odds API remaining: ${remaining}, used: ${used ?? '?'}`);

    if (!res.ok) {
      const text = await res.text();
      return {
        success: false,
        gamesCount: 0,
        lastUpdated: '',
        nextUpdate: '',
        error: `The Odds API ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const events = (await res.json()) as OddsApiEvent[];
    if (!Array.isArray(events)) {
      return { success: false, gamesCount: 0, lastUpdated: '', nextUpdate: '', error: 'Invalid response: not an array' };
    }

    const games: NblGameOdds[] = events.map((ev) => {
      const homeTeam = officialName(ev.home_team);
      const awayTeam = officialName(ev.away_team);
      const bookmakers: NblBookRow[] = [];
      for (const b of ev.bookmakers || []) {
        if (isExcludedBookmaker(b.key, b.title)) continue;
        const row = parseOutcomesToBookRow(ev.home_team, ev.away_team, b);
        if (row) bookmakers.push(row);
      }
      return {
        gameId: ev.id,
        homeTeam,
        awayTeam,
        commenceTime: ev.commence_time,
        bookmakers,
      };
    });

    const cachePayload: NblOddsCache = {
      games,
      lastUpdated: now.toISOString(),
      nextUpdate: nextUpdate.toISOString(),
    };
    if (!options?.skipWrite) {
      await setNblOddsCache(cachePayload);
    }

    return {
      success: true,
      gamesCount: games.length,
      lastUpdated: cachePayload.lastUpdated,
      nextUpdate: cachePayload.nextUpdate,
      games,
      cachePayload,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, gamesCount: 0, lastUpdated: '', nextUpdate: '', error: message };
  }
}

export async function setNblOddsCache(payload: NblOddsCache): Promise<void> {
  if (!payload || !Array.isArray(payload.games)) return;
  const existing = await getNblOddsCache();
  if (payload.games.length === 0 && existing?.games?.length) return;
  if (existing?.games?.length) {
    await sharedCache.setJSON(NBL_ODDS_STALE_CACHE_KEY, existing, NBL_ODDS_CACHE_TTL_SECONDS);
  }
  await sharedCache.setJSON(NBL_ODDS_CACHE_KEY, payload, NBL_ODDS_CACHE_TTL_SECONDS);
}

export async function getNblOddsCache(): Promise<NblOddsCache | null> {
  const raw = await sharedCache.getJSON<NblOddsCache>(NBL_ODDS_CACHE_KEY);
  if (raw && typeof raw === 'object' && Array.isArray(raw.games) && raw.games.length > 0) return raw;
  const stale = await sharedCache.getJSON<NblOddsCache>(NBL_ODDS_STALE_CACHE_KEY);
  if (stale && typeof stale === 'object' && Array.isArray(stale.games) && stale.games.length > 0) return stale;
  if (raw && typeof raw === 'object' && Array.isArray(raw.games)) return raw;
  return null;
}

function teamInGame(home: string, away: string, team: string): boolean {
  const t = officialName(team).trim().toLowerCase();
  if (!t) return false;
  const h = officialName(home).trim().toLowerCase();
  const a = officialName(away).trim().toLowerCase();
  return h === t || a === t;
}

export function findNblOddsGame(
  games: NblGameOdds[],
  team: string | null,
  opponent?: string | null
): NblGameOdds | null {
  if (!games.length || !team) return null;
  let candidates = games.filter((g) => teamInGame(g.homeTeam, g.awayTeam, team));
  if (opponent) {
    const withOpp = candidates.filter((g) => teamInGame(g.homeTeam, g.awayTeam, opponent));
    if (withOpp.length) candidates = withOpp;
  }
  if (!candidates.length) return null;
  const now = Date.now();
  candidates.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  const upcoming = candidates.find((g) => Date.parse(g.commenceTime) >= now - 3 * 60 * 60 * 1000);
  return upcoming ?? candidates[candidates.length - 1];
}
