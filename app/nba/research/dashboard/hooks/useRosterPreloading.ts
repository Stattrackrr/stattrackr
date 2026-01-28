import { useEffect } from 'react';
import { DepthChartData, BallDontLieGame } from '../types';
import { fetchTeamDepthChart } from '../utils/depthChartUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { cachedFetch } from '@/lib/requestCache';

export interface UseRosterPreloadingParams {
  todaysGames: BallDontLieGame[];
  setAllTeamRosters: (rosters: Record<string, DepthChartData>) => void;
  setRosterCacheLoading: (loading: boolean) => void;
  setTeamInjuries: (injuries: any) => void;
}

/**
 * Custom hook to preload all team rosters when games are loaded
 */
export function useRosterPreloading({
  todaysGames,
  setAllTeamRosters,
  setRosterCacheLoading,
  setTeamInjuries,
}: UseRosterPreloadingParams) {
  useEffect(() => {
    const preloadAllRosters = async () => {
      if (todaysGames.length === 0) return;
      
      setRosterCacheLoading(true);
      
      // Get all unique teams from today's games
      const allTeams = new Set<string>();
      todaysGames.forEach(game => {
        if (game.home_team?.abbreviation) allTeams.add(normalizeAbbr(game.home_team.abbreviation));
        if (game.visitor_team?.abbreviation) allTeams.add(normalizeAbbr(game.visitor_team.abbreviation));
      });
      
      // Fetch all rosters with staggered delays to avoid rate limiting (runs in background)
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const results = [];
      const teamArray = Array.from(allTeams);
      
      for (let i = 0; i < teamArray.length; i++) {
        const team = teamArray[i];
        try {
          const roster = await fetchTeamDepthChart(team);
          results.push({ team, roster });
        } catch (error) {
          results.push({ team, roster: null });
        }
        // Add 100ms delay between requests to respect rate limits
        if (i < teamArray.length - 1) {
          await delay(100);
        }
      }
      
      // Build roster cache and update (UI already shown; depth chart will use cache when ready)
      const rosterCache: Record<string, DepthChartData> = {};
      results.forEach(({ team, roster }) => {
        if (roster) {
          rosterCache[team] = roster;
        }
      });
      
      setAllTeamRosters(rosterCache);
      setRosterCacheLoading(false);

      // Preload injuries for all teams we just cached so swaps show injury badges instantly
      try {
        const teamsParam = Array.from(allTeams).join(',');
        if (teamsParam) {
          const data = await cachedFetch<{ success: boolean; injuriesByTeam?: Record<string, any> }>(
            `/api/injuries?teams=${teamsParam}`,
            undefined,
            300000 // Cache for 5 minutes
          );
          if (data?.success) {
            setTeamInjuries((prev: any) => ({ ...prev, ...(data.injuriesByTeam || {}) }));
          }
        }
      } catch (err) {
        // Ignore errors
      }
    };
    
    preloadAllRosters();
  }, [todaysGames, setAllTeamRosters, setRosterCacheLoading, setTeamInjuries]);
}

