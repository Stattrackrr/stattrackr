/**
 * AFL odds refresh using The Odds API (v4).
 * Game odds (H2H, spreads, totals) are cached for 90 minutes (~30 API credits per refresh).
 * Cron runs every 90 min; 16/day × 30 ≈ 480 credits/day, ~14.4k/month.
 */

import sharedCache from '@/lib/sharedCache';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const AFL_SPORT_KEY = 'aussierules_afl';

/** Cache key and TTL: 2.5 hours so odds/props refresh sooner if a player is ruled out; old data stays until new refresh succeeds. */
export const AFL_ODDS_CACHE_KEY = 'afl_game_odds_v2';
export const AFL_ODDS_CACHE_TTL_SECONDS = 2.5 * 60 * 60;

// Same bookmaker shape the NBA dashboard expects (game odds only)
export interface AflBookRow {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
}

export interface AflGameOdds {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: AflBookRow[];
}

export interface AflOddsCache {
  games: AflGameOdds[];
  lastUpdated: string;
  nextUpdate: string;
}

// The Odds API v4 response types
interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsApiMarket {
  key: string;
  last_update?: string;
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

const AFL_ODDS_EXCLUDED_BOOKMAKERS = ['tabtouch', 'playup', 'betrivers', 'bet rivers'];

function isExcludedAflBookmaker(key: string | undefined, title: string | undefined): boolean {
  const k = (key ?? '').trim().toLowerCase();
  const t = (title ?? '').trim().toLowerCase();
  return AFL_ODDS_EXCLUDED_BOOKMAKERS.some((x) => k === x || t === x || k.includes(x) || t.includes(x));
}

function formatAmerican(price: number): string {
  if (price === undefined || price === null || !Number.isFinite(price)) return 'N/A';
  const p = Math.round(price);
  return p > 0 ? `+${p}` : String(p);
}

function norm(s: string | undefined): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function outcomeMatchesTeam(o: OddsApiOutcome, team: string): boolean {
  const n = norm(o.name);
  const t = norm(team);
  if (!t) return false;
  return n === t || n.includes(t) || t.includes(n);
}

function parseOutcomesToBookRow(
  homeTeam: string,
  awayTeam: string,
  bookmaker: OddsApiBookmaker
): AflBookRow | null {
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
    const homePoint = homeOut != null && typeof (homeOut as OddsApiOutcome & { point?: number }).point === 'number'
      ? (homeOut as OddsApiOutcome & { point: number }).point
      : undefined;
    const awayPoint = awayOut != null && typeof (awayOut as OddsApiOutcome & { point?: number }).point === 'number'
      ? (awayOut as OddsApiOutcome & { point: number }).point
      : undefined;
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
    const pointOut = totals.outcomes.find((o) => typeof (o as OddsApiOutcome & { point?: number }).point === 'number');
    const point = pointOut && typeof (pointOut as OddsApiOutcome & { point?: number }).point === 'number'
      ? (pointOut as OddsApiOutcome & { point: number }).point
      : null;
    if (point != null) {
      totalLine = String(point);
      if (overOut != null) totalOver = formatAmerican(overOut.price);
      if (underOut != null) totalUnder = formatAmerican(underOut.price);
    }
    // Some APIs put point on the market or first outcome
    if (totalLine === 'N/A' && totals.outcomes[0] != null && typeof (totals.outcomes[0] as OddsApiOutcome & { point?: number }).point === 'number') {
      totalLine = String((totals.outcomes[0] as OddsApiOutcome & { point: number }).point);
      if (overOut != null) totalOver = formatAmerican(overOut.price);
      if (underOut != null) totalUnder = formatAmerican(underOut.price);
    }
  }

  return {
    name: bookmaker.title || bookmaker.key || 'Unknown',
    H2H: { home: homeH2H, away: awayH2H },
    Spread: { line: spreadLine, over: spreadOver, under: spreadUnder },
    Total: { line: totalLine, over: totalOver, under: totalUnder },
  };
}

export async function refreshAflOddsData(): Promise<{
  success: boolean;
  gamesCount: number;
  lastUpdated: string;
  nextUpdate: string;
  games?: AflGameOdds[];
  error?: string;
}> {
  const apiKey = process.env.ODDS_API_KEY?.trim();
  if (!apiKey) {
    return { success: false, gamesCount: 0, lastUpdated: '', nextUpdate: '', error: 'ODDS_API_KEY not set' };
  }

  const now = new Date();
  const nextUpdate = new Date(now.getTime() + AFL_ODDS_CACHE_TTL_SECONDS * 1000);

  const url = `${ODDS_API_BASE}/sports/${AFL_SPORT_KEY}/odds?regions=au&oddsFormat=american&markets=h2h,spreads,totals&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    const remaining = res.headers.get('x-requests-remaining');
    const used = res.headers.get('x-requests-used');
    if (remaining) console.log(`[AFL Odds] The Odds API remaining: ${remaining}, used: ${used ?? '?'}`);

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

    const games: AflGameOdds[] = events.map((ev) => {
      const bookmakers: AflBookRow[] = [];
      for (const b of ev.bookmakers || []) {
        if (isExcludedAflBookmaker(b.key, b.title)) continue;
        const row = parseOutcomesToBookRow(ev.home_team, ev.away_team, b);
        if (row) bookmakers.push(row);
      }
      return {
        gameId: ev.id,
        homeTeam: ev.home_team,
        awayTeam: ev.away_team,
        commenceTime: ev.commence_time,
        bookmakers,
      };
    });

    const cachePayload: AflOddsCache = {
      games,
      lastUpdated: now.toISOString(),
      nextUpdate: nextUpdate.toISOString(),
    };
    if (games.length > 0) {
      await sharedCache.setJSON(AFL_ODDS_CACHE_KEY, cachePayload, AFL_ODDS_CACHE_TTL_SECONDS);
    }

    return {
      success: true,
      gamesCount: games.length,
      lastUpdated: cachePayload.lastUpdated,
      nextUpdate: cachePayload.nextUpdate,
      games,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      gamesCount: 0,
      lastUpdated: '',
      nextUpdate: '',
      error: message,
    };
  }
}

/** Read game odds from 90-min cache (populated by cron every 90 min). */
export async function getAflOddsCache(): Promise<AflOddsCache | null> {
  const raw = await sharedCache.getJSON<AflOddsCache>(AFL_ODDS_CACHE_KEY);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.games)) return null;
  return raw;
}

/** Find event ID for a matchup from games list (for player-props event-level fetch). */
export function getAflEventIdForMatchup(games: AflGameOdds[], team: string, opponent: string, gameDate?: string | null): string | null {
  if (!games?.length) return null;
  const n = (s: string) => String(s ?? '').trim().toLowerCase();
  const dateKey = (s: string) => (s || '').slice(0, 10);
  const t = n(team);
  const o = n(opponent);
  for (const g of games) {
    const h = n(g.homeTeam);
    const a = n(g.awayTeam);
    if (!t || (!h && !a)) continue;
    const teamMatch = h.includes(t) || a.includes(t) || t.includes(h) || t.includes(a);
    const oppMatch = !o || h.includes(o) || a.includes(o) || o.includes(h) || o.includes(a);
    if (!teamMatch || !oppMatch) continue;
    if (gameDate && dateKey(g.commenceTime) !== dateKey(gameDate)) continue;
    return g.gameId;
  }
  return null;
}
