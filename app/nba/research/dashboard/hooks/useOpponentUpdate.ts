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
    console.log(`%c🔍 === OPPONENT USEEFFECT TRIGGERED ===%c`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
    console.log(`%cDependency changes: propsMode=${propsMode}, manualOpponent="${manualOpponent}"`, 'color: #555', '');
    
    // If manual opponent is set and not ALL, use that instead of automatic detection
    if (manualOpponent && manualOpponent !== '' && manualOpponent !== 'ALL') {
      console.log(`%c🎯 MANUAL OPPONENT OVERRIDE: ${manualOpponent}%c`, 'color: #f39c12; font-weight: bold; font-size: 12px', '');
      setOpponentTeam(normalizeAbbr(manualOpponent));
      console.log(`%c🔍 === OPPONENT USEEFFECT END ===%c\n`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
      return;
    }
    
    // Otherwise, use automatic opponent detection
    const teamToCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    console.log(`%cTeam to check: %c${teamToCheck}%c (mode: ${propsMode})`, 'color: #555', 'color: #e74c3c; font-weight: bold', 'color: #555');
    console.log(`%cGames available: %c${todaysGames.length}`, 'color: #555', 'color: #f39c12; font-weight: bold');
    
    if (teamToCheck && teamToCheck !== 'N/A' && todaysGames.length > 0) {
      const opponent = getOpponentTeam(teamToCheck, todaysGames);
      console.log(`%c🎯 SETTING OPPONENT: ${opponent}%c (for ${teamToCheck})`, 'color: #27ae60; font-weight: bold; font-size: 12px', 'color: #555');
      setOpponentTeam(normalizeAbbr(opponent));
    } else {
      console.log(`%c⏸️ SKIPPING OPPONENT UPDATE%c - Insufficient data`, 'color: #f39c12; font-weight: bold', 'color: #555');
      console.log(`  teamToCheck: ${teamToCheck}, todaysGames: ${todaysGames.length}`);
      if (propsMode === 'team' && (!gamePropsTeam || gamePropsTeam === 'N/A')) {
        console.log(`  -> Clearing opponent (team mode with no team selected)`);
        setOpponentTeam('');
      }
    }
    console.log(`%c🔍 === OPPONENT USEEFFECT END ===%c\n`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
  }, [selectedTeam, gamePropsTeam, todaysGames, propsMode, manualOpponent, setOpponentTeam]);
}


