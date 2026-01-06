import { useEffect } from 'react';

export interface UseTeamMatchupStatsParams {
  propsMode: 'player' | 'team';
  selectedTeam: string;
  gamePropsTeam: string;
  opponentTeam: string;
  setTeamMatchupStats: (stats: { currentTeam: any; opponent: any }) => void;
  setTeamMatchupLoading: (loading: boolean) => void;
}

/**
 * Custom hook to fetch team matchup stats for pie chart comparison
 * DEFERRED to not block stats display
 */
export function useTeamMatchupStats({
  propsMode,
  selectedTeam,
  gamePropsTeam,
  opponentTeam,
  setTeamMatchupStats,
  setTeamMatchupLoading,
}: UseTeamMatchupStatsParams) {
  useEffect(() => {
    const fetchTeamMatchupStats = async () => {
      const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
      
      if (!currentTeam || currentTeam === 'N/A' || !opponentTeam || opponentTeam === 'N/A') {
        setTeamMatchupStats({currentTeam: null, opponent: null});
        return;
      }
      
      setTeamMatchupLoading(true);
      try {
        // Fetch stats for both teams
        const [currentTeamResponse, opponentResponse] = await Promise.all([
          fetch(`/api/dvp/team-totals?team=${currentTeam}&games=82`),
          fetch(`/api/dvp/team-totals?team=${opponentTeam}&games=82`)
        ]);
        
        const [currentTeamData, opponentData] = await Promise.all([
          currentTeamResponse.json(),
          opponentResponse.json()
        ]);
        
        setTeamMatchupStats({
          currentTeam: currentTeamData.success ? currentTeamData.perGame : null,
          opponent: opponentData.success ? opponentData.perGame : null
        });
      } catch (error) {
        console.error('Failed to fetch team matchup stats:', error);
        setTeamMatchupStats({currentTeam: null, opponent: null});
      } finally {
        setTeamMatchupLoading(false);
      }
    };
    
    // Defer by 3 seconds to let stats load first
    const timeoutId = setTimeout(fetchTeamMatchupStats, 3000);
    
    return () => clearTimeout(timeoutId);
  }, [propsMode, gamePropsTeam, selectedTeam, opponentTeam, setTeamMatchupStats, setTeamMatchupLoading]);
}


