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
 * Custom hook to update opponent when games or selected team changes.
 * Opponent selector (manualOpponent) is used only for chart filtering; matchup,
 * odds, and side panels always use the auto-detected next-game opponent.
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
    // Always use automatic opponent detection for matchup/odds/side panels.
    // manualOpponent is used only in processBaseGameData for chart filtering.
    const teamToCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;

    if (teamToCheck && teamToCheck !== 'N/A' && todaysGames.length > 0) {
      const opponent = getOpponentTeam(teamToCheck, todaysGames);
      setOpponentTeam(normalizeAbbr(opponent));
    } else {
      if (propsMode === 'team' && (!gamePropsTeam || gamePropsTeam === 'N/A')) {
        setOpponentTeam('');
      }
    }
  }, [selectedTeam, gamePropsTeam, todaysGames, propsMode, setOpponentTeam]);
}


