import { useEffect } from 'react';
import { getOpponentTeam } from '../utils/teamAnalysisUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { BallDontLieGame } from '../types';

export interface UseOpponentUpdateParams {
  selectedTeam: string;
  gamePropsTeam: string;
  todaysGames: BallDontLieGame[];
  propsMode: 'player' | 'team';
  manualOpponent: string;
  setOpponentTeam: (team: string) => void;
}

/**
 * Custom hook to update opponent when games or selected team changes
 */
export function useOpponentUpdate({
  selectedTeam,
  gamePropsTeam,
  todaysGames,
  propsMode,
  manualOpponent,
  setOpponentTeam,
}: UseOpponentUpdateParams) {
  useEffect(() => {
    // If manual opponent is set and not ALL, use that instead of automatic detection
    if (manualOpponent && manualOpponent !== '' && manualOpponent !== 'ALL') {
      setOpponentTeam(normalizeAbbr(manualOpponent));
      return;
    }
    
    // Otherwise, use automatic opponent detection
    const teamToCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    
    if (teamToCheck && teamToCheck !== 'N/A' && todaysGames.length > 0) {
      const opponent = getOpponentTeam(teamToCheck, todaysGames);
      setOpponentTeam(normalizeAbbr(opponent));
    } else {
      if (propsMode === 'team' && (!gamePropsTeam || gamePropsTeam === 'N/A')) {
        setOpponentTeam('');
      }
    }
  }, [selectedTeam, gamePropsTeam, todaysGames, propsMode, manualOpponent, setOpponentTeam]);
}


