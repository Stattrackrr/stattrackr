'use client';

import { useCallback } from 'react';
import { fmtOdds as fmtOddsUtil } from '../utils/oddsUtils';
import { fetchSortedStatsCore } from '../utils/playerStatsUtils';

export interface UseDashboardUtilsParams {
  oddsFormat: 'american' | 'decimal';
  selectedTimeframe: string;
}

export function useDashboardUtils({
  oddsFormat,
  selectedTimeframe,
}: UseDashboardUtilsParams) {
  // Format odds utility
  const fmtOdds = useCallback((odds: string | undefined | null): string => {
    return fmtOddsUtil(odds, oddsFormat);
  }, [oddsFormat]);

  // Fetch game stats for a player
  const fetchSortedStats = useCallback(async (playerId: string) => {
    return await fetchSortedStatsCore(playerId, selectedTimeframe);
  }, [selectedTimeframe]);

  return {
    fmtOdds,
    fetchSortedStats,
  };
}

