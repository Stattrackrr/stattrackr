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
    // Only fetch team matchup (DVP team-totals) when in Game Props mode.
    // When in Player Props mode we don't load this data — it loads when user clicks Game Props.
    if (propsMode !== 'team') {
      setTeamMatchupStats({ currentTeam: null, opponent: null });
      setTeamMatchupLoading(false);
      return;
    }

    const currentTeam = gamePropsTeam;
    if (!currentTeam || currentTeam === 'N/A' || !opponentTeam || opponentTeam === 'N/A') {
      setTeamMatchupStats({ currentTeam: null, opponent: null });
      setTeamMatchupLoading(false);
      return;
    }

    const fetchTeamMatchupStats = async () => {
      setTeamMatchupLoading(true);
      try {
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
        setTeamMatchupStats({ currentTeam: null, opponent: null });
      } finally {
        setTeamMatchupLoading(false);
      }
    };

    // Defer slightly so Game Props UI can paint first
    const timeoutId = setTimeout(fetchTeamMatchupStats, 300);

    return () => clearTimeout(timeoutId);
  }, [propsMode, gamePropsTeam, opponentTeam, setTeamMatchupStats, setTeamMatchupLoading]);
}


