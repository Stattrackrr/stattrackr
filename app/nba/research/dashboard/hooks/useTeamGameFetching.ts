'use client';

import { useState, useCallback } from 'react';
import { fetchTeamGamesData as fetchTeamGamesDataCore, cacheAllTeamsInBackground as cacheAllTeamsInBackgroundCore, fetchGameDataForTeam as fetchGameDataForTeamCore } from '../utils/teamGamesUtils';

export interface UseTeamGameFetchingParams {
  setGameStats: (games: any[]) => void;
  setGameStatsLoading: (loading: boolean) => void;
}

export function useTeamGameFetching({
  setGameStats,
  setGameStatsLoading,
}: UseTeamGameFetchingParams) {
  // Team game data cache for instant loading
  const [teamGameCache, setTeamGameCache] = useState<Record<string, any[]>>({});
  const [backgroundCacheLoading, setBackgroundCacheLoading] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ current: 0, total: 0 });

  // Core function to fetch team games - now imported from utils
  const fetchTeamGamesData = useCallback(async (teamAbbr: string, showLoading: boolean = true) => {
    return await fetchTeamGamesDataCore(teamAbbr, {
      onLoadingChange: showLoading ? setGameStatsLoading : undefined,
      onGamesChange: showLoading ? setGameStats : undefined,
    });
  }, [setGameStats, setGameStatsLoading]);

  // Background cache all teams function - now imported from utils
  const cacheAllTeamsInBackground = useCallback(async () => {
    return await cacheAllTeamsInBackgroundCore({
      backgroundCacheLoading,
      teamGameCache,
      fetchTeamGamesData,
      onBackgroundCacheLoadingChange: setBackgroundCacheLoading,
      onCacheProgressChange: setCacheProgress,
      onTeamGameCacheUpdate: setTeamGameCache,
    });
  }, [backgroundCacheLoading, teamGameCache, fetchTeamGamesData, setBackgroundCacheLoading, setCacheProgress, setTeamGameCache]);

  // Priority fetch: load requested team immediately, then cache others in background - now imported from utils
  const fetchGameDataForTeam = useCallback(async (teamAbbr: string) => {
    return await fetchGameDataForTeamCore({
      teamAbbr,
      teamGameCache,
      fetchTeamGamesData,
      onGameStatsLoadingChange: setGameStatsLoading,
      onGameStatsChange: setGameStats,
      onTeamGameCacheUpdate: setTeamGameCache,
      onCacheAllTeams: cacheAllTeamsInBackground,
    });
  }, [teamGameCache, fetchTeamGamesData, setGameStatsLoading, setGameStats, setTeamGameCache, cacheAllTeamsInBackground]);

  return {
    fetchTeamGamesData,
    fetchGameDataForTeam,
    cacheAllTeamsInBackground,
    teamGameCache,
    backgroundCacheLoading,
    cacheProgress,
  };
}

