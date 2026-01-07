'use client';

import { useMemo } from 'react';
import { processBaseGameData } from '../utils/baseGameDataUtils';
import { processAllGamesSecondAxisData } from '../utils/allGamesSecondAxisDataUtils';
import { calculateBackToBackGameIds } from '../utils/backToBackGameIdsUtils';
import { processFilteredGameData } from '../utils/filteredGameDataUtils';

export interface UseGameDataProcessingParams {
  playerStats: any[];
  selectedTimeframe: string;
  selectedPlayer: { id: number; full?: string; firstName?: string; lastName?: string } | null;
  propsMode: 'player' | 'team';
  gameStats: any[];
  selectedTeam: string;
  opponentTeam: string;
  manualOpponent: string;
  homeAway: 'ALL' | 'HOME' | 'AWAY';
  isLoading: boolean;
  resolvedPlayerId: string | null;
  teammateFilterId: number | null;
  gamePropsTeam: string;
  selectedFilterForAxis: string | null;
  advancedStatsPerGame: Record<number, { pace?: number; usage_percentage?: number }>;
  dvpRanksPerGame: Record<string, number | null>;
  minMinutesFilter: number;
  maxMinutesFilter: number;
  excludeBlowouts: boolean;
  excludeBackToBack: boolean;
  withWithoutMode: 'with' | 'without';
  teammatePlayedGameIds: Set<number>;
}

export function useGameDataProcessing({
  playerStats,
  selectedTimeframe,
  selectedPlayer,
  propsMode,
  gameStats,
  selectedTeam,
  opponentTeam,
  manualOpponent,
  homeAway,
  isLoading,
  resolvedPlayerId,
  teammateFilterId,
  gamePropsTeam,
  selectedFilterForAxis,
  advancedStatsPerGame,
  dvpRanksPerGame,
  minMinutesFilter,
  maxMinutesFilter,
  excludeBlowouts,
  excludeBackToBack,
  withWithoutMode,
  teammatePlayedGameIds,
}: UseGameDataProcessingParams) {
  /* -------- Base game data (structure only, no stat values) ----------
     This should only recalculate when player/timeframe changes, NOT when stat changes
     Only depend on player ID, not the whole object, to prevent recalculation on metadata updates */
  const playerId = selectedPlayer?.id?.toString() || null;
  const baseGameData = useMemo(() => {
    return processBaseGameData({
      playerStats,
      selectedTimeframe,
      selectedPlayer,
      propsMode,
      gameStats,
      selectedTeam,
      opponentTeam,
      manualOpponent,
      homeAway,
      isLoading,
      resolvedPlayerId,
      teammateFilterId,
      gamePropsTeam,
    });
  }, [playerStats, selectedTimeframe, playerId, propsMode, gameStats, selectedTeam, opponentTeam, manualOpponent, homeAway, isLoading, resolvedPlayerId, teammateFilterId]);

  // Calculate allGamesSecondAxisData from playerStats directly (all games, no timeframe filter)
  // This allows us to filter from ALL games, then apply timeframe
  const allGamesSecondAxisData = useMemo(() => {
    return processAllGamesSecondAxisData({
      playerStats,
      selectedFilterForAxis,
      selectedTimeframe,
      advancedStatsPerGame,
      dvpRanksPerGame,
      propsMode,
    });
  }, [playerStats, selectedFilterForAxis, selectedTimeframe, advancedStatsPerGame, dvpRanksPerGame, propsMode]);

  // Precompute back-to-back games (player mode)
  const backToBackGameIds = useMemo(() => {
    return calculateBackToBackGameIds({
      propsMode,
      playerStats,
    });
  }, [propsMode, playerStats]);

  // Apply advanced filters to base data for player mode
  // Only depend on player ID, not the whole object, to prevent recalculation on metadata updates
  const filteredGameData = useMemo(() => {
    return processFilteredGameData({
      propsMode,
      baseGameData,
      minMinutesFilter,
      maxMinutesFilter,
      excludeBlowouts,
      excludeBackToBack,
      backToBackGameIds,
      withWithoutMode,
      teammateFilterId,
      teammatePlayedGameIds,
      selectedTimeframe,
      playerStats,
      selectedPlayer,
    });
  }, [propsMode, baseGameData, minMinutesFilter, maxMinutesFilter, excludeBlowouts, excludeBackToBack, backToBackGameIds, withWithoutMode, teammateFilterId, teammatePlayedGameIds, selectedTimeframe, playerStats, playerId]);

  return {
    baseGameData,
    allGamesSecondAxisData,
    backToBackGameIds,
    filteredGameData,
  };
}

