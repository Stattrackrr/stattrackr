import { useEffect } from 'react';
import { DepthChartData } from '../types';
import { fetchTeamDepthChart } from '../utils/depthChartUtils';

export interface UseTeamRosterPrefetchParams {
  propsMode: 'player' | 'team';
  originalPlayerTeam: string;
  gamePropsTeam: string;
  opponentTeam: string;
  setPlayerTeamRoster: (roster: DepthChartData | null) => void;
  setOpponentTeamRoster: (roster: DepthChartData | null) => void;
  setRostersLoading: (loading: (prev: { player: boolean; opponent: boolean }) => { player: boolean; opponent: boolean }) => void;
}

/**
 * Custom hook to prefetch rosters for current teams (specific to current mode)
 */
export function useTeamRosterPrefetch({
  propsMode,
  originalPlayerTeam,
  gamePropsTeam,
  opponentTeam,
  setPlayerTeamRoster,
  setOpponentTeamRoster,
  setRostersLoading,
}: UseTeamRosterPrefetchParams) {
  useEffect(() => {
    const prefetchTeamRosters = async () => {
      const playerTeam = propsMode === 'team' ? gamePropsTeam : originalPlayerTeam;
      const oppTeam = opponentTeam;
      
      if (!playerTeam || playerTeam === 'N/A') return;
      
      // Fetch player team roster
      if (playerTeam !== 'N/A') {
        setRostersLoading(prev => ({ ...prev, player: true }));
        const playerRoster = await fetchTeamDepthChart(playerTeam);
        setPlayerTeamRoster(playerRoster);
        setRostersLoading(prev => ({ ...prev, player: false }));
      }
      
      // Fetch opponent team roster if available
      if (oppTeam && oppTeam !== 'N/A' && oppTeam !== playerTeam) {
        setRostersLoading(prev => ({ ...prev, opponent: true }));
        const opponentRoster = await fetchTeamDepthChart(oppTeam);
        setOpponentTeamRoster(opponentRoster);
        setRostersLoading(prev => ({ ...prev, opponent: false }));
      }
    };
    
    prefetchTeamRosters();
  }, [originalPlayerTeam, opponentTeam, propsMode, gamePropsTeam, setPlayerTeamRoster, setOpponentTeamRoster, setRostersLoading]);
}

