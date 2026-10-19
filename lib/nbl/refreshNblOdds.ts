/**
 * NBL game odds (head to head, line, total) from odds-api.net's Australian books, plus Unibet direct.
 */

import { resolveNblClubName } from '@/lib/nblTeamCanonical';
import sharedCache from '@/lib/sharedCache';
import { fetchOddsApiNetNblGameLines } from '@/lib/nbl/oddsApiNet';
import { appendNblGameOddsHistory } from '@/lib/nbl/oddsHistory';
import { withUnibetNblGameLines } from '@/lib/nbl/unibetGameLines';
import type { NblBookRow, NblGameOdds, NblOddsCache } from '@/lib/nbl/oddsTypes';

export type { NblBookRow, NblGameOdds, NblOddsCache };

export const NBL_ODDS_CACHE_KEY = 'nbl_game_odds_v1';
export const NBL_ODDS_STALE_CACHE_KEY = 'nbl_game_odds_v1_stale';
export const NBL_ODDS_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60 * 10;

function officialName(raw: string): string {
  return resolveNblClubName(raw) || String(raw || '').trim();
}

export async function refreshNblOddsData(options?: {
  skipWrite?: boolean;
  /** Append timestamped per-game history files on disk (GitHub Actions only). */
  disk?: boolean;
}): Promise<{
  success: boolean;
  gamesCount: number;
  lastUpdated: string;
  nextUpdate: string;
  games?: NblGameOdds[];
  cachePayload?: NblOddsCache;
  error?: string;
}> {
  if (!String(process.env.ODDS_API_NET_KEY || process.env.ODDS_API_NET || '').trim()) {
    return { success: false, gamesCount: 0, lastUpdated: '', nextUpdate: '', error: 'ODDS_API_NET_KEY not set' };
  }

  const now = new Date();
  const nextUpdate = new Date(now.getTime() + 30 * 60 * 1000);
  try {
    const apiGames = await fetchOddsApiNetNblGameLines();
    if (!apiGames) {
      return { success: false, gamesCount: 0, lastUpdated: '', nextUpdate: '', error: 'odds-api.net NBL game lines unavailable' };
    }
    const games = await withUnibetNblGameLines(apiGames).catch(() => apiGames);

    const cachePayload: NblOddsCache = {
      games,
      lastUpdated: now.toISOString(),
      nextUpdate: nextUpdate.toISOString(),
    };
    if (!options?.skipWrite) {
      await setNblOddsCache(cachePayload);
    }
    if (options?.disk) {
      try {
        const written = appendNblGameOddsHistory(games, cachePayload.lastUpdated);
        if (written) console.log(`[NBL Odds] game-odds history captures written: ${written}`);
      } catch (err) {
        console.warn('[NBL Odds] game-odds history write failed', err instanceof Error ? err.message : err);
      }
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
