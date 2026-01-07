'use client';

import { memo, useCallback } from 'react';
import StatsBarChart from './StatsBarChart';

// Using memo but with a simpler comparison to avoid blocking re-renders
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
  secondAxisData,
  selectedFilterForAxis,
}: any) {
  const formatChartLabel = useCallback((value: any): string => {
    const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    if (isPercentageStat) return `${numValue.toFixed(1)}%`;
    return `${numValue}`;
  }, [selectedStat]);

  // Chart is independent - only depends on its own data, not global isLoading
  // This allows chart to render immediately when data is available, regardless of other components
  const hasChartData = chartData && chartData.length > 0;
  
  return (
    <div className="h-full w-full">
      {!hasChartData ? (
        <div className="h-full w-full flex flex-col" style={{ padding: '16px 8px 8px 8px' }}>
          {/* Chart bars skeleton - vertical bars like the actual chart */}
          <div className="flex-1 flex items-end justify-center gap-1 px-2 h-full">
            {[...Array(20)].map((_, idx) => {
              // Create varied heights like a real chart
              const heights = [45, 62, 38, 71, 55, 48, 65, 42, 58, 51, 47, 63, 39, 72, 56, 49, 66, 43, 59, 52];
              const height = heights[idx] || (Math.random() * 40 + 30);
              
              return (
                <div
                  key={idx}
                  className="flex-1 max-w-[50px] flex flex-col items-center justify-end"
                  style={{ height: '100%' }}
                >
                  {/* Vertical bar - matches chart bar structure, thicker */}
                  <div
                    className={`w-full rounded-t animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
                    style={{
                      height: `${height}%`,
                      animationDelay: `${idx * 0.08}s`,
                      minHeight: '30px',
                      transition: 'height 0.3s ease',
                      minWidth: '28px'
                    }}
                  />
                </div>
              );
            })}
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
          secondAxisData={secondAxisData}
          selectedFilterForAxis={selectedFilterForAxis}
        />
      )}
    </div>
  );
}, (prev, next) => {
  // Chart is independent - only compare chart data and config, not global isLoading
  // This prevents chart from re-rendering when other components are loading
  return (
    prev.chartData === next.chartData &&
    prev.selectedStat === next.selectedStat &&
    prev.selectedTimeframe === next.selectedTimeframe &&
    prev.yAxisConfig === next.yAxisConfig &&
    prev.bettingLine === next.bettingLine &&
    prev.secondAxisData === next.secondAxisData &&
    prev.selectedFilterForAxis === next.selectedFilterForAxis
  );
});






