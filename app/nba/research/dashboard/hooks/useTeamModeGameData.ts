import { useEffect, useRef } from 'react';

export interface UseTeamModeGameDataParams {
  propsMode: 'player' | 'team';
  gamePropsTeam: string;
  fetchGameDataForTeam: (team: string) => void;
  setGameStats: (stats: any[]) => void;
}

/**
 * Custom hook to fetch game data when in team mode and team is selected
 */
export function useTeamModeGameData({
  propsMode,
  gamePropsTeam,
  fetchGameDataForTeam,
  setGameStats,
}: UseTeamModeGameDataParams) {
  // Track last values to prevent unnecessary re-runs
  const lastPropsModeRef = useRef(propsMode);
  const lastGamePropsTeamRef = useRef(gamePropsTeam);
  const fetchGameDataForTeamRef = useRef(fetchGameDataForTeam);
  
  // Update refs on every render
  fetchGameDataForTeamRef.current = fetchGameDataForTeam;
  
  useEffect(() => {
    // Only run if propsMode or gamePropsTeam actually changed
    const propsModeChanged = lastPropsModeRef.current !== propsMode;
    const gamePropsTeamChanged = lastGamePropsTeamRef.current !== gamePropsTeam;
    
    if (!propsModeChanged && !gamePropsTeamChanged) {
      return;
    }
    
    // Update refs
    lastPropsModeRef.current = propsMode;
    lastGamePropsTeamRef.current = gamePropsTeam;
    
    if (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A') {
      console.log(`🏀 Fetching game data for team mode: ${gamePropsTeam}`);
      fetchGameDataForTeamRef.current(gamePropsTeam);
    } else if (propsMode === 'player') {
      // Clear game data when switching back to player mode
      setGameStats([]);
    } else if (propsMode === 'team' && gamePropsTeam === 'N/A') {
      // Clear game data when no team selected in Game Props
      setGameStats([]);
    }
  }, [propsMode, gamePropsTeam, setGameStats]);
}


