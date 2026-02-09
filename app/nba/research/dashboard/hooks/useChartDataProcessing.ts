'use client';

import { useMemo } from 'react';
import { processChartData } from '../utils/chartDataUtils';
import { processFilteredChartData } from '../utils/filteredChartDataUtils';
import { processSecondAxisData } from '../utils/secondAxisDataUtils';
import { calculateSliderConfig } from '../utils/sliderConfigUtils';

export interface UseChartDataProcessingParams {
  baseGameData: any[];
  filteredGameData: any[];
  selectedStat: string;
  propsMode: 'player' | 'team';
  gamePropsTeam: string;
  selectedTeam: string;
  todaysGames: any[];
  allGamesSecondAxisData: any[];
  selectedFilterForAxis: string | null;
  sliderRange: { min: number; max: number } | null;
  selectedTimeframe: string;
  selectedPlayer: { id: number | string; full?: string; firstName?: string; lastName?: string } | null;
  opponentTeam: string;
  manualOpponent: string;
  advancedStatsPerGame: Record<number, { pace?: number; usage_percentage?: number }>;
  dvpRanksPerGame: Record<string, number | null>;
}

export function useChartDataProcessing({
  baseGameData,
  filteredGameData,
  selectedStat,
  propsMode,
  gamePropsTeam,
  selectedTeam,
  todaysGames,
  allGamesSecondAxisData,
  selectedFilterForAxis,
  sliderRange,
  selectedTimeframe,
  selectedPlayer,
  opponentTeam,
  manualOpponent,
  advancedStatsPerGame,
  dvpRanksPerGame,
}: UseChartDataProcessingParams) {
  /* -------- Chart data with current stat values ----------
     Only recalculate values when selectedStat changes */
  const chartData = useMemo(() => {
    const source = propsMode === 'player' ? filteredGameData : baseGameData;
    // Return empty array immediately if source is empty to show skeleton
    if (!source || source.length === 0) {
      return [];
    }
    // OPTIMIZATION: Process chart data efficiently - this is a simple map operation
    return processChartData({
      source,
      selectedStat,
      propsMode,
      gamePropsTeam,
      todaysGames,
    });
  }, [baseGameData, filteredGameData, selectedStat, propsMode, propsMode === 'team' ? gamePropsTeam : selectedTeam, todaysGames]);

  // For spread we now use the signed margin directly (wins down, losses up)
  const adjustedChartData = useMemo(() => chartData, [chartData]);

  // Calculate slider min/max based on selected filter (use all games for accurate min/max)
  const sliderConfig = useMemo(() => {
    return calculateSliderConfig({
      selectedFilterForAxis,
      allGamesSecondAxisData,
    });
  }, [selectedFilterForAxis, allGamesSecondAxisData]);

  // Filter chart data based on slider range
  // IMPORTANT: Filter from ALL games first (using allGamesSecondAxisData from playerStats), then apply timeframe
  // Only depend on player ID, not the whole object, to prevent recalculation on metadata updates
  const playerId = selectedPlayer?.id?.toString() || null;
  const filteredChartData = useMemo(() => {
    return processFilteredChartData({
      adjustedChartData,
      selectedFilterForAxis,
      allGamesSecondAxisData,
      sliderRange,
      propsMode,
      selectedStat,
      selectedTimeframe,
      selectedPlayer,
      opponentTeam,
      manualOpponent: manualOpponent || 'ALL',
    });
  }, [adjustedChartData, selectedFilterForAxis, allGamesSecondAxisData, sliderRange, propsMode, selectedStat, selectedTimeframe, playerId, opponentTeam, manualOpponent]);

  // Calculate second axis data for display (from filteredChartData to match what's actually displayed)
  const secondAxisData = useMemo(() => {
    return processSecondAxisData({
      filteredChartData,
      selectedFilterForAxis,
      propsMode,
      advancedStatsPerGame,
      dvpRanksPerGame,
    });
  }, [selectedFilterForAxis, filteredChartData, propsMode, advancedStatsPerGame, dvpRanksPerGame]);

  return {
    chartData,
    adjustedChartData,
    sliderConfig,
    filteredChartData,
    secondAxisData,
  };
}

