'use client';

import { useMemo } from 'react';
import { calculateHeaderInfo } from '../utils/headerInfoUtils';
import { calculateMatchupInfo } from '../utils/matchupInfoUtils';
import { calculateBestLineForStat } from '../utils/bestLineForStatUtils';

export interface UseSimpleCalculationsParams {
  propsMode: 'player' | 'team';
  gamePropsTeam: string;
  selectedPlayer: { id: number | string; full?: string; firstName?: string; lastName?: string } | null;
  selectedTeam: string;
  opponentTeam: string;
  todaysGames: any[];
  realOddsData: any[];
  selectedStat: string;
}

export function useSimpleCalculations({
  propsMode,
  gamePropsTeam,
  selectedPlayer,
  selectedTeam,
  opponentTeam,
  todaysGames,
  realOddsData,
  selectedStat,
}: UseSimpleCalculationsParams) {
  // Header info - dynamic based on props mode
  const headerInfo = useMemo(() => {
    return calculateHeaderInfo({
      propsMode,
      gamePropsTeam,
      selectedPlayer,
      selectedTeam,
    });
  }, [propsMode, gamePropsTeam, selectedPlayer, selectedTeam]);

  // Keep the old variable name for compatibility
  const playerInfo = headerInfo;

  // Determine today's matchup and tipoff time (no fetch; uses existing todaysGames)
  const matchupInfo = useMemo(() => {
    return calculateMatchupInfo({
      selectedTeam,
      opponentTeam,
      todaysGames,
    });
  }, [selectedTeam, opponentTeam, todaysGames]);

  // Calculate best line for stat (lowest over line) - exclude alternate lines
  // This is used to initialize bettingLine when switching stats
  const bestLineForStat = useMemo(() => {
    return calculateBestLineForStat({
      realOddsData,
      selectedStat,
    });
  }, [realOddsData, selectedStat]);

  return {
    headerInfo,
    playerInfo,
    matchupInfo,
    bestLineForStat,
  };
}

