import { useEffect } from 'react';

export interface UseTeamLogosParams {
  propsMode: 'player' | 'team';
  selectedTeam: string;
  gamePropsTeam: string;
  opponentTeam: string;
  setSelectedTeamLogoUrl: (url: string) => void;
  setSelectedTeamLogoAttempt: (attempt: number) => void;
  setOpponentTeamLogoUrl: (url: string) => void;
  setOpponentTeamLogoAttempt: (attempt: number) => void;
  getEspnLogoUrl: (team: string) => string;
}

/**
 * Custom hook to manage team logo URLs for selected team and opponent team
 */
export function useTeamLogos({
  propsMode,
  selectedTeam,
  gamePropsTeam,
  opponentTeam,
  setSelectedTeamLogoUrl,
  setSelectedTeamLogoAttempt,
  setOpponentTeamLogoUrl,
  setOpponentTeamLogoAttempt,
  getEspnLogoUrl,
}: UseTeamLogosParams) {
  // Keep logo URL in sync with selectedTeam/gamePropsTeam
  useEffect(() => {
    const teamToUse = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    if (teamToUse && teamToUse !== 'N/A') {
      setSelectedTeamLogoAttempt(0);
      setSelectedTeamLogoUrl(getEspnLogoUrl(teamToUse));
    } else {
      setSelectedTeamLogoUrl('');
      setSelectedTeamLogoAttempt(0);
    }
  }, [selectedTeam, gamePropsTeam, propsMode, setSelectedTeamLogoUrl, setSelectedTeamLogoAttempt, getEspnLogoUrl]);

  // Keep opponent logo URL in sync
  useEffect(() => {
    if (opponentTeam) {
      setOpponentTeamLogoAttempt(0);
      setOpponentTeamLogoUrl(getEspnLogoUrl(opponentTeam));
    } else {
      setOpponentTeamLogoUrl('');
      setOpponentTeamLogoAttempt(0);
    }
  }, [opponentTeam, setOpponentTeamLogoUrl, setOpponentTeamLogoAttempt, getEspnLogoUrl]);
}


