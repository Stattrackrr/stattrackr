import { useEffect } from 'react';

export interface UseTeamInjuriesParams {
  propsMode: 'player' | 'team';
  selectedTeam: string;
  gamePropsTeam: string;
  opponentTeam: string;
  setTeamInjuries: (injuries: any) => void;
}

/**
 * Custom hook to fetch injuries for depth chart integration (fetch both selected and opponent teams)
 */
export function useTeamInjuries({
  propsMode,
  selectedTeam,
  gamePropsTeam,
  opponentTeam,
  setTeamInjuries,
}: UseTeamInjuriesParams) {
  useEffect(() => {
    const fetchTeamInjuries = async () => {
      const teamA = propsMode === 'team' ? gamePropsTeam : selectedTeam;
      const teamB = opponentTeam;
      
      if (!teamA || teamA === 'N/A') {
        setTeamInjuries({});
        return;
      }

      try {
        const teamsParam = [teamA, teamB]
          .filter(Boolean)
          .filter((t, i, arr) => t !== 'N/A' && arr.indexOf(t as string) === i)
          .join(',');
        const url = teamsParam ? `/api/injuries?teams=${teamsParam}` : `/api/injuries?teams=${teamA}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.success) {
          setTeamInjuries(data.injuriesByTeam || {});
        }
      } catch (error) {
        console.warn('Failed to fetch team injuries:', error);
        setTeamInjuries({});
      }
    };

    fetchTeamInjuries();
  }, [selectedTeam, propsMode, gamePropsTeam, opponentTeam, setTeamInjuries]);
}

