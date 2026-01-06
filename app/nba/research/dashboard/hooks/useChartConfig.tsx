'use client';

import { useMemo, useCallback } from 'react';
import { CustomChartTooltip } from '../components/charts/CustomChartTooltip';
import { calculateYAxisConfig } from '../utils/yAxisConfigUtils';
import { createChartLabelFormatter } from '../utils/chartFormatters';
import { calculateHitRateStats } from '../utils/hitRateStatsUtils';
import { PLAYER_STAT_OPTIONS, TEAM_STAT_OPTIONS } from '../constants';
import { HitRateStats } from '../types';

export interface UseChartConfigParams {
  chartData: any[];
  bettingLine: number;
  selectedStat: string;
  propsMode: 'player' | 'team';
  baseGameDataLength: number;
  selectedPlayer: { id: number; full?: string; firstName?: string; lastName?: string } | null;
  isLoading: boolean;
  resolvedPlayerId: string | null;
  selectedTimeframe: string;
  isDark: boolean;
  gamePropsTeam: string;
  selectedTeam: string;
}

export function useChartConfig({
  chartData,
  bettingLine,
  selectedStat,
  propsMode,
  baseGameDataLength,
  selectedPlayer,
  isLoading,
  resolvedPlayerId,
  selectedTimeframe,
  isDark,
  gamePropsTeam,
  selectedTeam,
}: UseChartConfigParams) {
  const currentStatOptions = propsMode === 'player' ? PLAYER_STAT_OPTIONS : TEAM_STAT_OPTIONS;

  // Hit rate calculations - using statistical distribution instead of simple counting
  const hitRateStats = useMemo<HitRateStats>(() => {
    return calculateHitRateStats({
      chartData,
      bettingLine,
      selectedStat,
      currentStatOptions,
      propsMode,
      baseGameDataLength,
      selectedPlayer,
      isLoading,
      resolvedPlayerId,
    });
  }, [chartData, bettingLine, selectedStat, currentStatOptions, propsMode, baseGameDataLength, selectedPlayer, isLoading, resolvedPlayerId]);

  // Custom tooltip content - completely independent to prevent lag when adjusting betting line
  const customTooltip = useCallback(({ active, payload, label }: any) => {
    return (
      <CustomChartTooltip
        active={active}
        payload={payload}
        label={label}
        propsMode={propsMode}
        selectedStat={selectedStat}
        isDark={isDark}
        gamePropsTeam={gamePropsTeam}
        selectedTeam={selectedTeam}
      />
    );
  }, [propsMode, selectedStat, isDark, gamePropsTeam, selectedTeam]);

  // Memoized label formatter for chart bars
  const formatChartLabel = useMemo(() => createChartLabelFormatter(selectedStat), [selectedStat]);

  // Calculate Y-axis domain with appropriate tick increments
  const yAxisConfig = useMemo(() => {
    return calculateYAxisConfig({
      chartData,
      selectedStat,
      selectedTimeframe,
      propsMode,
    });
  }, [chartData, selectedStat, selectedTimeframe, propsMode]);

  return {
    hitRateStats,
    customTooltip,
    formatChartLabel,
    yAxisConfig,
    currentStatOptions,
  };
}

