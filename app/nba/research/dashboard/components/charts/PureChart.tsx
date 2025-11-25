'use client';

import { memo, useCallback } from 'react';
import StatsBarChart from './StatsBarChart';

export default memo(function PureChart({
  isLoading,
  chartData,
  yAxisConfig,
  isDark,
  bettingLine,
  selectedStat,
  currentStatOptions,
  apiError,
  selectedPlayer,
  propsMode,
  gamePropsTeam,
  customTooltip,
  selectedTimeframe,
}: any) {
  const formatChartLabel = useCallback((value: any): string => {
    const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    if (isPercentageStat) return `${numValue.toFixed(1)}%`;
    return `${numValue}`;
  }, [selectedStat]);

  return (
    <div className="h-full w-full">
      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <div className="text-gray-600 dark:text-gray-400">Loading player stats...</div>
          </div>
        </div>
      ) : (
        <StatsBarChart
          data={chartData}
          yAxisConfig={yAxisConfig}
          isDark={isDark}
          bettingLine={bettingLine}
          customTooltip={customTooltip}
          formatChartLabel={formatChartLabel}
          selectedStat={selectedStat}
          selectedTimeframe={selectedTimeframe}
        />
      )}
    </div>
  );
}, (prev, next) => (
  prev.isLoading === next.isLoading &&
  prev.chartData === next.chartData &&
  prev.yAxisConfig === next.yAxisConfig &&
  prev.isDark === next.isDark &&
  prev.bettingLine === next.bettingLine &&
  prev.selectedStat === next.selectedStat &&
  prev.currentStatOptions === next.currentStatOptions &&
  prev.apiError === next.apiError &&
  prev.selectedPlayer === next.selectedPlayer &&
  prev.propsMode === next.propsMode &&
  prev.gamePropsTeam === next.gamePropsTeam &&
  prev.customTooltip === next.customTooltip &&
  prev.selectedTimeframe === next.selectedTimeframe
));






