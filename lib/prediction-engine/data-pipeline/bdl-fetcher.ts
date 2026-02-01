/**
 * BallDontLie Data Fetcher
 * Fetches player stats, game logs, odds, and props from BallDontLie GOAT API
 */

import type { PlayerStats, GameLog, StatLine, PlayerProp } from '../types';

// BDL V1 API for stats
const BDL_V1_BASE = 'https://api.balldontlie.io/v1';
const BDL_V2_BASE = 'https://api.balldontlie.io/nba/v2';

function getApiKey(): string {
  return process.env.BALLDONTLIE_API_KEY || '';
}

function authHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Fetch player game stats directly from BDL V1
 */
async function fetchBDLStats(playerId: number, perPage: number = 100): Promise<any[]> {
  const url = new URL(`${BDL_V1_BASE}/stats`);
  url.searchParams.set('player_ids[]', playerId.toString());
  url.searchParams.set('per_page', perPage.toString());
  
  console.log(`[BDL Fetcher] Fetching stats: ${url.toString()}`);
  
  const response = await fetch(url.toString(), {
    headers: authHeaders(),
    cache: 'no-store',
  });
  
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`[BDL Fetcher] Error ${response.status}: ${text}`);
    throw new Error(`BDL API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.data || [];
}

/**
 * Fetch player season averages from game stats
 */
export async function fetchPlayerSeasonAverages(playerId: number, season?: string): Promise<any> {
  try {
    const games = await fetchBDLStats(playerId, 100);
    
    if (games.length === 0) {
      console.warn(`[BDL Fetcher] No games found for player ${playerId}`);
      return null;
    }
    
    // Calculate season averages from game logs
    const totals = games.reduce((acc: any, game: any) => ({
      pts: acc.pts + (game.pts || 0),
      reb: acc.reb + (game.reb || 0),
      ast: acc.ast + (game.ast || 0),
      stl: acc.stl + (game.stl || 0),
      blk: acc.blk + (game.blk || 0),
      fg3m: acc.fg3m + (game.fg3m || 0),
      fgm: acc.fgm + (game.fgm || 0),
      fga: acc.fga + (game.fga || 0),
      ftm: acc.ftm + (game.ftm || 0),
      fta: acc.fta + (game.fta || 0),
      turnover: acc.turnover + (game.turnover || 0),
      min: acc.min + (parseFloat(game.min) || 0),
    }), { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, turnover: 0, min: 0 });
    
    const count = games.length;
    const firstGame = games[0];
    
    console.log(`[BDL Fetcher] Calculated averages from ${count} games for player ${playerId}`);
    
    return {
      games_played: count,
      pts: totals.pts / count,
      reb: totals.reb / count,
      ast: totals.ast / count,
      stl: totals.stl / count,
      blk: totals.blk / count,
      fg3m: totals.fg3m / count,
      fg_pct: totals.fga > 0 ? totals.fgm / totals.fga : 0,
      ft_pct: totals.fta > 0 ? totals.ftm / totals.fta : 0,
      turnover: totals.turnover / count,
      min: (totals.min / count).toFixed(1),
      player: firstGame?.player || { first_name: 'Unknown', last_name: 'Player' },
    };
  } catch (error) {
    console.error('[BDL Fetcher] Error fetching season averages:', error);
    return null;
  }
}

/**
 * Fetch player advanced stats from BDL V2
 */
export async function fetchPlayerAdvancedStats(playerId: number, season?: string): Promise<any> {
  try {
    const url = new URL(`${BDL_V2_BASE}/stats/advanced`);
    url.searchParams.append('player_ids[]', playerId.toString());
    url.searchParams.set('per_page', '100');
    
    console.log(`[BDL Fetcher] Fetching advanced stats: ${url.toString()}`);
    
    const response = await fetch(url.toString(), {
      headers: authHeaders(),
      cache: 'no-store',
    });
    
    if (!response.ok) {
      console.warn(`[BDL Fetcher] Advanced stats returned ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('[BDL Fetcher] Error fetching advanced stats:', error);
    return [];
  }
}

/**
 * Fetch player game logs
 */
export async function fetchPlayerGameLogs(
  playerId: number,
  season?: string,
  limit: number = 20
): Promise<GameLog[]> {
  try {
    const games = await fetchBDLStats(playerId, limit);
    
    // Transform to GameLog format
    return games.map((game: any) => ({
      gameId: game.game?.id?.toString() || '',
      date: game.game?.date || '',
      opponent: game.game?.home_team_id === game.team?.id 
        ? game.game?.visitor_team?.abbreviation 
        : game.game?.home_team?.abbreviation,
      isHome: game.game?.home_team_id === game.team?.id,
      teamInGame: game.team?.abbreviation || undefined,
      minutes: parseFloat(game.min) || 0,
      pts: game.pts || 0,
      reb: game.reb || 0,
      ast: game.ast || 0,
      stl: game.stl || 0,
      blk: game.blk || 0,
      fg3m: game.fg3m || 0,
      fgPct: game.fg_pct || 0,
      ftPct: game.ft_pct || 0,
      to: game.turnover || 0,
      plusMinus: game.plus_minus || 0,
    }));
  } catch (error) {
    console.error('[BDL Fetcher] Error fetching game logs:', error);
    return [];
  }
}

/**
 * Calculate recent averages from game logs
 */
export function calculateRecentAverages(gameLogs: GameLog[], numGames: number): StatLine {
  const recentGames = gameLogs.slice(0, numGames);
  
  if (recentGames.length === 0) {
    return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, minutes: 0 };
  }
  
  const sum = recentGames.reduce((acc, game) => ({
    pts: acc.pts + game.pts,
    reb: acc.reb + game.reb,
    ast: acc.ast + game.ast,
    stl: acc.stl + game.stl,
    blk: acc.blk + game.blk,
    fg3m: acc.fg3m + game.fg3m,
    minutes: acc.minutes + game.minutes,
  }), { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, minutes: 0 });
  
  const count = recentGames.length;
  
  return {
    pts: sum.pts / count,
    reb: sum.reb / count,
    ast: sum.ast / count,
    stl: sum.stl / count,
    blk: sum.blk / count,
    fg3m: sum.fg3m / count,
    minutes: sum.minutes / count,
  };
}

/**
 * Calculate home/away splits from game logs
 */
export function calculateSplits(gameLogs: GameLog[]): { home: StatLine; away: StatLine } {
  const homeGames = gameLogs.filter(g => g.isHome);
  const awayGames = gameLogs.filter(g => !g.isHome);
  
  return {
    home: calculateRecentAverages(homeGames, homeGames.length),
    away: calculateRecentAverages(awayGames, awayGames.length),
  };
}

/**
 * Calculate head-to-head average vs specific opponent
 * Returns undefined when no games vs this opponent
 */
export function calculateVsOpponent(gameLogs: GameLog[], opponent: string): StatLine | undefined {
  const oppNorm = opponent?.toUpperCase?.() || '';
  const vsGames = gameLogs.filter(g => (g.opponent || '').toUpperCase() === oppNorm);
  if (vsGames.length === 0) return undefined;
  return calculateRecentAverages(vsGames, vsGames.length);
}

/**
 * Derive former teams from game logs (when player_former_teams table is empty).
 * Uses teamInGame from each game to find teams the player has played for.
 */
export function deriveFormerTeamsFromGameLogs(
  gameLogs: GameLog[],
  currentTeam: string
): string[] {
  const current = (currentTeam || '').toUpperCase().trim();
  const seen = new Set<string>();
  for (const g of gameLogs) {
    const team = (g.teamInGame || '').toUpperCase().trim();
    if (team && team !== current) seen.add(team);
  }
  return Array.from(seen);
}

/**
 * Fetch today's player props
 * Note: This should be called from client-side or with absolute URL
 */
export async function fetchPlayerProps(gameDate?: string): Promise<PlayerProp[]> {
  // For now, return empty array - props should be passed in from client
  console.warn('[BDL Fetcher] fetchPlayerProps called server-side - props should be passed from client');
  return [];
}

/**
 * Fetch game odds (spread, total)
 * Note: This should be called from client-side or with absolute URL
 */
export async function fetchGameOdds(team: string): Promise<{ spread: number; total: number }> {
  // Default values - odds should be passed in from client
  console.warn('[BDL Fetcher] fetchGameOdds called server-side - using default values');
  return { spread: -5, total: 220 };
}

/**
 * Fetch complete player data for prediction
 */
export async function fetchCompletePlayerData(
  playerId: number,
  season?: string,
  /** When provided, fetch more games (50) for better H2H vs this opponent */
  opponent?: string
): Promise<Partial<PlayerStats>> {
  try {
    const gameLogLimit = opponent ? 50 : 20; // More games when we need H2H
    // Fetch all data in parallel
    const [seasonAvg, advancedStats, gameLogs] = await Promise.all([
      fetchPlayerSeasonAverages(playerId, season),
      fetchPlayerAdvancedStats(playerId, season),
      fetchPlayerGameLogs(playerId, season, gameLogLimit),
    ]);
    
    if (!seasonAvg) {
      throw new Error(`No season data found for player ${playerId}`);
    }
    
    // Calculate recent averages
    const last5 = calculateRecentAverages(gameLogs, 5);
    const last10 = calculateRecentAverages(gameLogs, 10);
    const last20 = calculateRecentAverages(gameLogs, 20);
    
    // Calculate splits
    const splits = calculateSplits(gameLogs);
    
    // Calculate advanced stats average
    const avgAdvanced = advancedStats.length > 0
      ? {
          usage: advancedStats.reduce((sum: number, s: any) => sum + (s.usg_pct || 0), 0) / advancedStats.length,
          pace: advancedStats.reduce((sum: number, s: any) => sum + (s.pace || 0), 0) / advancedStats.length,
          trueShootingPct: advancedStats.reduce((sum: number, s: any) => sum + (s.ts_pct || 0), 0) / advancedStats.length,
          offRating: advancedStats.reduce((sum: number, s: any) => sum + (s.off_rtg || 0), 0) / advancedStats.length,
          defRating: advancedStats.reduce((sum: number, s: any) => sum + (s.def_rtg || 0), 0) / advancedStats.length,
          per: advancedStats.reduce((sum: number, s: any) => sum + (s.per || 0), 0) / advancedStats.length,
        }
      : {
          usage: 0,
          pace: 0,
          trueShootingPct: 0,
          offRating: 0,
          defRating: 0,
          per: 0,
        };
    
    return {
      playerId,
      playerName: `${seasonAvg.player?.first_name} ${seasonAvg.player?.last_name}`,
      team: seasonAvg.player?.team?.abbreviation || '',
      position: seasonAvg.player?.position || '',
      seasonStats: {
        gamesPlayed: seasonAvg.games_played || 0,
        pts: seasonAvg.pts || 0,
        reb: (seasonAvg.reb || 0) + (seasonAvg.oreb || 0) + (seasonAvg.dreb || 0),
        ast: seasonAvg.ast || 0,
        stl: seasonAvg.stl || 0,
        blk: seasonAvg.blk || 0,
        fg3m: seasonAvg.fg3m || 0,
        fgPct: seasonAvg.fg_pct || 0,
        ftPct: seasonAvg.ft_pct || 0,
        toPct: seasonAvg.turnover || 0,
        minutes: parseFloat(seasonAvg.min) || 0,
      },
      advancedStats: avgAdvanced,
      recentGames: gameLogs,
      last5Avg: last5,
      last10Avg: last10,
      last20Avg: last20,
      homeAvg: splits.home,
      awayAvg: splits.away,
    };
  } catch (error) {
    console.error('[BDL Fetcher] Error fetching player data:', error);
    throw error;
  }
}
