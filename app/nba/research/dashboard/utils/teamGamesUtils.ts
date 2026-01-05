import { currentNbaSeason } from './playerUtils';
import { ABBR_TO_TEAM_ID } from './teamUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { BallDontLieGame } from '../types';

export interface CacheAllTeamsOptions {
  teamGameCache: Record<string, BallDontLieGame[]>;
  fetchTeamGamesData: (teamAbbr: string, showLoading: boolean) => Promise<BallDontLieGame[]>;
  onBackgroundCacheLoadingChange?: (loading: boolean) => void;
  onCacheProgressChange?: (progress: { current: number; total: number }) => void;
  onTeamGameCacheUpdate?: (updater: (prev: Record<string, BallDontLieGame[]>) => Record<string, BallDontLieGame[]>) => void;
}

export interface FetchGameDataForTeamOptions {
  teamAbbr: string;
  teamGameCache: Record<string, BallDontLieGame[]>;
  fetchTeamGamesData: (teamAbbr: string, showLoading: boolean) => Promise<BallDontLieGame[]>;
  onGameStatsLoadingChange?: (loading: boolean) => void;
  onGameStatsChange?: (games: BallDontLieGame[]) => void;
  onTeamGameCacheUpdate?: (updater: (prev: Record<string, BallDontLieGame[]>) => Record<string, BallDontLieGame[]>) => void;
  onCacheAllTeams?: () => void;
}

/**
 * Core function to fetch team games
 * Returns games data, optionally updating loading state via callbacks
 */
export async function fetchTeamGamesData(
  teamAbbr: string,
  options?: {
    onLoadingChange?: (loading: boolean) => void;
    onGamesChange?: (games: BallDontLieGame[]) => void;
  }
): Promise<BallDontLieGame[]> {
  if (!teamAbbr || teamAbbr === 'N/A') return [];
  
  const { onLoadingChange, onGamesChange } = options || {};
  
  if (onLoadingChange) {
    onLoadingChange(true);
  }
  
  try {
    const season = currentNbaSeason();
    const teamId = ABBR_TO_TEAM_ID[normalizeAbbr(teamAbbr)];
    
    if (!teamId) {
      console.warn(`No team ID found for ${teamAbbr}`);
      return [];
    }
    
    console.log(`🏀 Fetching games for team ${teamAbbr} (ID: ${teamId})`);
    
    // Use aggregated, team-scoped fast path (no cursor), one call per season
    const current = currentNbaSeason();
    const targetSeasons = [String(current), String(current - 1), String(current - 2)];

    const seasonResults = await Promise.all(
      targetSeasons.map(async (s) => {
        try {
          // Fetch all games for this season (API handles pagination internally)
          const url = `/api/bdl/games?seasons[]=${s}&team_ids[]=${teamId}&per_page=100`;
          const res = await fetch(url);
          const js = await res.json();
          const arr = Array.isArray(js?.data) ? js.data : [];
          return arr;
        } catch {
          return [] as any[];
        }
      })
    );

    const seasonData = { data: seasonResults.flat() } as any;

    if (seasonData?.data) {
      console.log(`🔍 FILTERING: Starting with ${seasonData.data.length} total games`);
      
      // Filter for games involving our team and only completed games
      let allTeamGames = seasonData.data.filter((game: any) => {
        return game.home_team?.id === teamId || game.visitor_team?.id === teamId;
      });
      
      console.log(`🔍 Found ${allTeamGames.length} total games involving ${teamAbbr} (before status filtering)`);
      
      // Check what statuses we have
      const statusCounts = allTeamGames.reduce((acc: any, game: any) => {
        const status = game.status || 'undefined';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`🔍 Game statuses for ${teamAbbr}:`, statusCounts);
      
      let games = seasonData.data.filter((game: any) => {
        const isTeamInvolved = game.home_team?.id === teamId || game.visitor_team?.id === teamId;
        const isCompleted = game.status === 'Final';
        const hasScores = game.home_team_score != null && game.visitor_team_score != null;
        
        const passes = isTeamInvolved && isCompleted && hasScores;
        
        // Debug first few games
        if (seasonData.data.indexOf(game) < 5) {
          console.log(`🔎 Game filter debug:`, {
            id: game.id,
            date: game.date,
            home: game.home_team?.abbreviation + ` (ID: ${game.home_team?.id})`,
            away: game.visitor_team?.abbreviation + ` (ID: ${game.visitor_team?.id})`,
            status: game.status,
            targetTeamId: teamId,
            isTeamInvolved,
            isCompleted,
            hasScores,
            passes
          });
        }
        
        return passes;
      });
      
      // Sort by date (oldest first for full season display)
      games = games
        .sort((a: any, b: any) => {
          const dateA = new Date(a.date || 0).getTime();
          const dateB = new Date(b.date || 0).getTime();
          return dateA - dateB; // Oldest first (season progression)
        });
      
      console.log(`🏆 Full 2024-25 season: ${games.length} games`);
      
      // Break down games by month/type
      const gamesByMonth = games.reduce((acc: any, game: any) => {
        const date = game.date;
        const month = date ? date.substring(0, 7) : 'unknown'; // YYYY-MM
        acc[month] = (acc[month] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`📊 Games breakdown by month:`, gamesByMonth);
      
      // Check for potential preseason (October before 15th) or playoff games (April after 15th)
      const preseasonGames = games.filter((g: any) => {
        const date = g.date;
        return date && date.startsWith('2024-10') && parseInt(date.split('-')[2]) < 15;
      });
      
      const playoffGames = games.filter((g: any) => {
        const date = g.date;
        return date && (date.startsWith('2025-04') && parseInt(date.split('-')[2]) > 15) || date.startsWith('2025-05') || date.startsWith('2025-06');
      });
      
      console.log(`🏆 Potential preseason games: ${preseasonGames.length}`);
      console.log(`🏆 Potential playoff games: ${playoffGames.length}`);
      
      console.log(`📊 Found ${games.length} games for ${teamAbbr}`);
      if (games.length > 0) {
        const newest = games[0]?.date;
        const oldest = games[games.length - 1]?.date;
        console.log(`📅 Date range: ${oldest} to ${newest}`);
      }
      
      // Games are already in chronological order (oldest to newest)
      if (onGamesChange) {
        onGamesChange(games);
      }
      return games;
    }
    
    console.warn(`No games found for ${teamAbbr}`);
    return [];
  } catch (error) {
    console.error(`Error fetching game data for ${teamAbbr}:`, error);
    if (onGamesChange) {
      onGamesChange([]);
    }
    return [];
  } finally {
    if (onLoadingChange) {
      onLoadingChange(false);
    }
  }
}

/**
 * Background cache all teams function
 */
export async function cacheAllTeamsInBackground(options: CacheAllTeamsOptions & { backgroundCacheLoading: boolean }): Promise<void> {
  const {
    backgroundCacheLoading,
    teamGameCache,
    fetchTeamGamesData,
    onBackgroundCacheLoadingChange,
    onCacheProgressChange,
    onTeamGameCacheUpdate,
  } = options;

  if (backgroundCacheLoading) return; // Prevent multiple background loads
  
  onBackgroundCacheLoadingChange?.(true);
  console.log('🔄 Starting background cache of all team data...');
  
  // List of all NBA teams
  const allTeams = Object.keys(ABBR_TO_TEAM_ID);
  const teamsToCache = allTeams.filter(team => !teamGameCache[team]);
  
  onCacheProgressChange?.({ current: 0, total: teamsToCache.length });
  
  for (let i = 0; i < teamsToCache.length; i++) {
    const teamAbbr = teamsToCache[i];
    try {
      // Use a simplified version without UI loading states
      const games = await fetchTeamGamesData(teamAbbr, false); // false = no UI loading
      
      onTeamGameCacheUpdate?.(prev => ({
        ...prev,
        [teamAbbr]: games
      }));
      
      // Update progress
      onCacheProgressChange?.({ current: i + 1, total: teamsToCache.length });
      
      // Small delay between teams to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.warn(`Background cache failed for ${teamAbbr}:`, error);
    }
  }
  
  console.log('✅ Background cache completed for all teams');
  onBackgroundCacheLoadingChange?.(false);
  onCacheProgressChange?.({ current: 0, total: 0 });
}

/**
 * Priority fetch: load requested team immediately, then cache others in background
 */
export async function fetchGameDataForTeam(options: FetchGameDataForTeamOptions): Promise<BallDontLieGame[]> {
  const {
    teamAbbr,
    teamGameCache,
    fetchTeamGamesData,
    onGameStatsLoadingChange,
    onGameStatsChange,
    onTeamGameCacheUpdate,
    onCacheAllTeams,
  } = options;

  if (!teamAbbr || teamAbbr === 'N/A') return [];
  
  // Check cache first
  if (teamGameCache[teamAbbr]) {
    console.log(`⚡ Using cached data for ${teamAbbr}`);
    
    // Add 20ms delay to make switching visible
    onGameStatsLoadingChange?.(true);
    await new Promise(resolve => setTimeout(resolve, 20));
    onGameStatsChange?.(teamGameCache[teamAbbr]);
    onGameStatsLoadingChange?.(false);
    
    return teamGameCache[teamAbbr];
  }
  
  console.log(`🏀 Priority loading ${teamAbbr}...`);
  
  // Load requested team immediately with UI loading state
  const games = await fetchTeamGamesData(teamAbbr, true);
  
  // Cache the result
  onTeamGameCacheUpdate?.(prev => ({
    ...prev,
    [teamAbbr]: games
  }));
  
  // Trigger background caching of all other teams (non-blocking)
  if (onCacheAllTeams) {
    setTimeout(() => {
      onCacheAllTeams();
    }, 500); // Small delay to let UI update first
  }
  
  return games;
}
