import { useEffect } from 'react';

export interface UseH2hOpponentSelectionParams {
  selectedTimeframe: string;
  manualOpponent: string;
  opponentTeam: string;
  nextGameOpponent: string;
  setManualOpponent: (opponent: string) => void;
  setOpponentTeam: (team: string) => void;
}

/**
 * Custom hook to auto-handle opponent selection when switching to H2H timeframe
 */
export function useH2hOpponentSelection({
  selectedTimeframe,
  manualOpponent,
  opponentTeam,
  nextGameOpponent,
  setManualOpponent,
  setOpponentTeam,
}: UseH2hOpponentSelectionParams) {
  useEffect(() => {
    if (selectedTimeframe === 'h2h') {
      // When switching to H2H, only clear manual opponent if it's currently ALL
      if (manualOpponent === 'ALL') {
        setManualOpponent('');
      }
      
      // If opponentTeam is not set (empty, N/A, or ALL), use the nextGameOpponent that's already calculated
      if ((!opponentTeam || opponentTeam === 'N/A' || opponentTeam === 'ALL' || opponentTeam === '') && nextGameOpponent && nextGameOpponent !== '') {
        console.log(`🔄 H2H: Setting opponent to next game opponent: ${nextGameOpponent}`);
        setOpponentTeam(nextGameOpponent);
      }
    }
    // Don't auto-switch away from manual selections when leaving H2H
  }, [selectedTimeframe, manualOpponent, opponentTeam, nextGameOpponent, setManualOpponent, setOpponentTeam]);
}


