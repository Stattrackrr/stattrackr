'use client';

import { memo, useState, useEffect, useMemo } from 'react';
import SimpleChart from './charts/SimpleChart';
import ChartControls from './ChartControls';
import { RangeSlider } from './charts';
import PureChart from './PureChart';
import { SECOND_AXIS_FILTER_OPTIONS } from '../constants';

type AverageStatInfo = {
  label: string;
  value: number;
  format?: 'percent' | 'number';
};

const ChartContainer = memo(function ChartContainer({
  isDark,
  currentStatOptions,
  selectedStat,
  onSelectStat,
  bettingLine,
  onChangeBettingLine,
  selectedTimeframe,
  onSelectTimeframe,
  chartData,
  yAxisConfig,
  isLoading,
  oddsLoading,
  apiError,
  selectedPlayer,
  propsMode,
  gamePropsTeam,
  customTooltip,
  currentOpponent,
  manualOpponent,
  onOpponentChange,
  currentTeam,
  homeAway,
  onChangeHomeAway,
  realOddsData,
  fmtOdds,
  minMinutesFilter,
  maxMinutesFilter,
  onMinMinutesChange,
  onMaxMinutesChange,
  excludeBlowouts,
  excludeBackToBack,
  onExcludeBlowoutsChange,
  onExcludeBackToBackChange,
  rosterForSelectedTeam,
  withWithoutMode,
  setWithWithoutMode,
  teammateFilterId,
  teammateFilterName,
  setTeammateFilterId,
  setTeammateFilterName,
  loadingTeammateGames,
  clearTeammateFilter,
  hitRateStats,
  lineMovementEnabled,
  intradayMovements,
  secondAxisData,
      selectedFilterForAxis,
      onSelectFilterForAxis,
  sliderConfig,
  sliderRange,
  setSliderRange,
}: any) {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const totalSamples = hitRateStats?.total ?? chartData.length;
  const overSamples = hitRateStats?.overCount ?? chartData.filter((d: any) => d.value > bettingLine).length;
  
  // Check if URL params indicate a player should be loaded (for initial page load detection)
  // Use useState/useEffect to avoid hydration mismatch (server renders false, client checks after mount)
  const [hasUrlPlayer, setHasUrlPlayer] = useState(false);
  
  useEffect(() => {
    if (propsMode === 'player') {
      try {
        const url = new URL(window.location.href);
        const pid = url.searchParams.get('pid');
        const name = url.searchParams.get('name');
        setHasUrlPlayer(!!(pid && name));
      } catch {
        setHasUrlPlayer(false);
      }
    }
  }, [propsMode]);

  const formatAverageValue = (avg: AverageStatInfo): string => {
    if (!Number.isFinite(avg.value)) return '0.0';
    if (avg.format === 'percent') return `${avg.value.toFixed(1)}%`;
    return avg.value.toFixed(1);
  };

  const renderAverageChips = (className = '') => {
    if (!hitRateStats?.averages?.length) return null;
    return (
      <div className={`flex flex-wrap items-center gap-1 sm:gap-2 ${className}`}>
        {hitRateStats.averages.map((avg: AverageStatInfo) => (
          <span
            key={`avg-${avg.label}`}
            className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-[#0a1929] dark:text-gray-200 text-[10px] sm:text-xs font-medium"
          >
            {avg.label}:{' '}
            <span className="font-semibold text-gray-900 dark:text-white">
              {formatAverageValue(avg)}
            </span>
          </span>
        ))}
      </div>
    );
  };

  // Second Axis Filter Pills (styled like StatPills) - inside chart container
  const SecondAxisFilterPills = useMemo(() => {
    // Only show in player mode
    if (propsMode !== 'player') return null;

    // Filter out the "None" option and only show the actual filter options
    const filterOptions = SECOND_AXIS_FILTER_OPTIONS.filter(opt => opt.key !== null);

    return (
      <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar">
        <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
          {filterOptions.map((option) => (
            <button
              key={option.key || 'none'}
              onClick={() => {
                // Toggle: if already selected, deselect (set to null), otherwise select
                onSelectFilterForAxis(selectedFilterForAxis === option.key ? null : option.key);
              }}
              className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer border ${
                selectedFilterForAxis === option.key
                  ? 'bg-purple-600 text-white border-purple-400/30'
                  : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-300/40 dark:border-gray-600/30'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }, [propsMode, selectedFilterForAxis, onSelectFilterForAxis]);

  return (
<div 
className="chart-container-no-focus relative z-10 bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-0 sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0 border border-gray-200 dark:border-gray-700 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden"
      style={{ outline: 'none', boxShadow: 'none' }}
    >
      {/* Desktop: In-chart overlay pill (disabled; use pre-chart placement to match mobile) */}
      <div className="hidden"></div>
      <ChartControls
        isDark={isDark}
        currentStatOptions={currentStatOptions}
        selectedStat={selectedStat}
        onSelectStat={onSelectStat}
        bettingLine={bettingLine}
        onChangeBettingLine={onChangeBettingLine}
        selectedTimeframe={selectedTimeframe}
        onSelectTimeframe={onSelectTimeframe}
        chartData={chartData}
        currentOpponent={currentOpponent}
        manualOpponent={manualOpponent}
        onOpponentChange={onOpponentChange}
        propsMode={propsMode}
        currentTeam={currentTeam}
        homeAway={homeAway}
        onChangeHomeAway={onChangeHomeAway}
        yAxisConfig={yAxisConfig}
        realOddsData={realOddsData}
        oddsLoading={oddsLoading}
        fmtOdds={fmtOdds}
        minMinutesFilter={minMinutesFilter}
        maxMinutesFilter={maxMinutesFilter}
        onMinMinutesChange={onMinMinutesChange}
        onMaxMinutesChange={onMaxMinutesChange}
        excludeBlowouts={excludeBlowouts}
        excludeBackToBack={excludeBackToBack}
        onExcludeBlowoutsChange={onExcludeBlowoutsChange}
        onExcludeBackToBackChange={onExcludeBackToBackChange}
        rosterForSelectedTeam={rosterForSelectedTeam}
        selectedFilterForAxis={selectedFilterForAxis}
        onSelectFilterForAxis={onSelectFilterForAxis}
        withWithoutMode={withWithoutMode}
        setWithWithoutMode={setWithWithoutMode}
        teammateFilterId={teammateFilterId}
        teammateFilterName={teammateFilterName}
        setTeammateFilterId={setTeammateFilterId}
        setTeammateFilterName={setTeammateFilterName}
        loadingTeammateGames={loadingTeammateGames}
        clearTeammateFilter={clearTeammateFilter}
        lineMovementEnabled={lineMovementEnabled}
        intradayMovements={intradayMovements}
        hitRateStats={hitRateStats}
        selectedPlayer={selectedPlayer}
        isLoading={isLoading}
        showAdvancedFilters={showAdvancedFilters}
        setShowAdvancedFilters={setShowAdvancedFilters}
      />
      {/* Second Axis Filter Pills and Slider - Inside chart container */}
      {showAdvancedFilters && (
        <>
          <div className="mb-2 sm:mb-3 flex items-center gap-3">
            {showAdvancedFilters && SecondAxisFilterPills}
            {/* Range Slider on the right - Desktop only */}
            {showAdvancedFilters && selectedFilterForAxis && sliderConfig && sliderRange && (
              <div className="hidden sm:flex flex-shrink-0 ml-2 pr-12">
                <RangeSlider
                  min={sliderConfig.min}
                  max={sliderConfig.max}
                  valueMin={sliderRange.min}
                  valueMax={sliderRange.max}
                  onChange={(min, max) => setSliderRange({ min, max })}
                  step={selectedFilterForAxis === 'fg_pct' || selectedFilterForAxis === 'usage_rate' ? 0.1 : selectedFilterForAxis === 'dvp_rank' ? 1 : 0.5}
                  formatValue={(val) => {
                    if (selectedFilterForAxis === 'fg_pct' || selectedFilterForAxis === 'usage_rate') {
                      return `${val.toFixed(1)}%`;
                    }
                    return Math.round(val).toString();
                  }}
                />
              </div>
            )}
          </div>
          {/* Range Slider below filters - Mobile only */}
          {showAdvancedFilters && selectedFilterForAxis && sliderConfig && sliderRange && (
            <div className="sm:hidden mb-2 flex justify-center px-4">
              <RangeSlider
                min={sliderConfig.min}
                max={sliderConfig.max}
                valueMin={sliderRange.min}
                valueMax={sliderRange.max}
                onChange={(min, max) => setSliderRange({ min, max })}
                step={selectedFilterForAxis === 'fg_pct' || selectedFilterForAxis === 'usage_rate' ? 0.1 : selectedFilterForAxis === 'dvp_rank' ? 1 : 0.5}
                formatValue={(val) => {
                  if (selectedFilterForAxis === 'fg_pct' || selectedFilterForAxis === 'usage_rate') {
                    return `${val.toFixed(1)}%`;
                  }
                  return Math.round(val).toString();
                }}
              />
            </div>
          )}
        </>
      )}
      <div className="flex-1 min-h-0 relative">
        <SimpleChart
          key={manualOpponent ?? 'ALL'}
          isLoading={isLoading}
          chartData={chartData}
          yAxisConfig={yAxisConfig}
          isDark={isDark}
          bettingLine={bettingLine}
          selectedStat={selectedStat}
          selectedTimeframe={selectedTimeframe}
          secondAxisData={showAdvancedFilters ? secondAxisData : null}
          selectedFilterForAxis={showAdvancedFilters ? selectedFilterForAxis : null}
          customTooltip={customTooltip}
          teammateFilterId={teammateFilterId}
          teammateFilterName={teammateFilterName}
          withWithoutMode={withWithoutMode}
          clearTeammateFilter={clearTeammateFilter}
          homeAway={homeAway}
          excludeBlowouts={excludeBlowouts}
          excludeBackToBack={excludeBackToBack}
          onChangeHomeAway={onChangeHomeAway}
          onExcludeBlowoutsChange={onExcludeBlowoutsChange}
          onExcludeBackToBackChange={onExcludeBackToBackChange}
        />
      </div>
    </div>
  );
}, (prev, next) => {
  // Memo comparison for ChartContainer - skip if key props haven't changed
  // Chart is independent - don't re-render when isLoading changes (other components loading)
  // Only re-render when chart data or config changes
  return (
    prev.isDark === next.isDark &&
    prev.selectedStat === next.selectedStat &&
    prev.bettingLine === next.bettingLine &&
    prev.selectedTimeframe === next.selectedTimeframe &&
    prev.propsMode === next.propsMode &&
    prev.manualOpponent === next.manualOpponent &&
    // Removed isLoading and oddsLoading - chart is independent
    prev.chartData === next.chartData &&
    prev.yAxisConfig === next.yAxisConfig &&
    prev.currentOpponent === next.currentOpponent &&
    prev.currentTeam === next.currentTeam &&
    prev.homeAway === next.homeAway &&
    prev.minMinutesFilter === next.minMinutesFilter &&
    prev.maxMinutesFilter === next.maxMinutesFilter &&
    prev.excludeBlowouts === next.excludeBlowouts &&
    prev.excludeBackToBack === next.excludeBackToBack &&
    prev.withWithoutMode === next.withWithoutMode &&
    prev.selectedFilterForAxis === next.selectedFilterForAxis &&
    prev.sliderRange === next.sliderRange
  );
});

export default ChartContainer;

