'use client';

import { useState, useRef, useEffect } from 'react';
import { GameFiltersState, GameFilterData } from './GameFilters';

interface GameFiltersChipsProps {
  isDark: boolean;
  filters: GameFiltersState;
  onFiltersChange: (filters: GameFiltersState) => void;
  filterData: GameFilterData[] | null;
  playerPosition: string;
  selectedFilter?: string | null; // Which filter is selected for second Y-axis
  onFilterSelect?: (filter: string | null) => void; // Callback when filter button is clicked
  showDropdownUnderFilterButton?: boolean; // If true, show dropdown under Filter button instead of clicked button
  showOnlyFilterButton?: boolean; // If true, only show the Filter button, not the individual filter buttons
}

const DVP_METRICS = [
  { key: 'pts', label: 'Points' },
  { key: 'reb', label: 'Rebs' },
  { key: 'ast', label: 'Ast' },
  { key: 'fg3m', label: '3PM' },
  { key: 'fg_pct', label: 'FG%' },
  { key: 'stl', label: 'Stl' },
  { key: 'blk', label: 'Blk' },
  { key: 'to', label: 'TO' },
];

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

const PLAY_TYPES = [
  { key: 'PRBallHandler', displayName: 'PNR Ball Handler' },
  { key: 'Transition', displayName: 'Transition' },
  { key: 'Spotup', displayName: 'Spot Up' },
  { key: 'OffScreen', displayName: 'Off Screen' },
  { key: 'Isolation', displayName: 'Isolation' },
  { key: 'Postup', displayName: 'Post Up' },
  { key: 'Cut', displayName: 'Cut' },
  { key: 'Handoff', displayName: 'Handoff' },
  { key: 'Misc', displayName: 'Misc' },
  { key: 'PRRollman', displayName: 'PNR Roll Man' },
  { key: 'OffRebound', displayName: 'Putbacks' },
];

const SHOT_ZONES = [
  { key: 'restrictedArea', displayName: 'Restricted Area' },
  { key: 'paint', displayName: 'Paint' },
  { key: 'midRange', displayName: 'Mid Range' },
  { key: 'leftCorner3', displayName: 'Left Corner 3' },
  { key: 'rightCorner3', displayName: 'Right Corner 3' },
  { key: 'aboveBreak3', displayName: 'Above Break 3' },
];

export default function GameFiltersChips({
  isDark,
  filters,
  onFiltersChange,
  filterData,
  playerPosition,
  selectedFilter = null,
  onFilterSelect,
  showDropdownUnderFilterButton = false,
  showOnlyFilterButton = false,
}: GameFiltersChipsProps) {
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Close dropdown when clicking outside (hooks must be called before early returns)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Calculate min/max from filter data (needed for renderFilterContent)
  const stats = filterData ? {
    paceRanks: filterData.map(d => d.opponentPaceRank).filter((r): r is number => r !== null),
    usageRates: filterData.map(d => d.playerUsageRate).filter((r): r is number => r !== null),
  } : {
    paceRanks: [],
    usageRates: [],
  };

  const paceRankMin = stats.paceRanks.length > 0 ? Math.min(...stats.paceRanks) : 1;
  const paceRankMax = stats.paceRanks.length > 0 ? Math.max(...stats.paceRanks) : 30;
  const usageRateMin = stats.usageRates.length > 0 ? Math.min(...stats.usageRates) : 0;
  const usageRateMax = stats.usageRates.length > 0 ? Math.max(...stats.usageRates) : 100;

  const updateFilter = (key: keyof GameFiltersState, value: number | string | null | string[]) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  const hasData = filterData && filterData.length > 0;
  
  // Helper function to render filter content (defined before use)
  const renderFilterContent = (filterKey: string) => {
    switch (filterKey) {
      case 'minutes':
        return (
          <div className="space-y-3">
            <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
              Minutes Played: {filters.minutesMin ?? 0} - {filters.minutesMax ?? 48}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={filters.minutesMin ?? 0}
                onChange={(e) => updateFilter('minutesMin', parseInt(e.target.value))}
                className="flex-1 h-2"
              />
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={filters.minutesMax ?? 48}
                onChange={(e) => updateFilter('minutesMax', parseInt(e.target.value))}
                className="flex-1 h-2"
              />
            </div>
            <button
              onClick={() => {
                updateFilter('minutesMin', null);
                updateFilter('minutesMax', null);
                setOpenFilter(null);
                onFilterSelect?.(null);
              }}
              className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
        );
      
      case 'pace':
        return (
          <div className="space-y-3">
            <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
              Opponent Pace Rank: {filters.paceRankMin ?? paceRankMin} - {filters.paceRankMax ?? paceRankMax}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={paceRankMin}
                max={paceRankMax}
                value={filters.paceRankMin ?? paceRankMin}
                onChange={(e) => updateFilter('paceRankMin', parseInt(e.target.value))}
                className="flex-1 h-2"
              />
              <input
                type="range"
                min={paceRankMin}
                max={paceRankMax}
                value={filters.paceRankMax ?? paceRankMax}
                onChange={(e) => updateFilter('paceRankMax', parseInt(e.target.value))}
                className="flex-1 h-2"
              />
            </div>
            <button
              onClick={() => {
                updateFilter('paceRankMin', null);
                updateFilter('paceRankMax', null);
                setOpenFilter(null);
                onFilterSelect?.(null);
              }}
              className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
        );
      
      case 'dvp':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Position:</label>
              <select
                value={filters.dvpPosition}
                onChange={(e) => updateFilter('dvpPosition', e.target.value)}
                className={`text-xs px-2 py-1 rounded border ${
                  isDark ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                }`}
              >
                {POSITIONS.map(pos => (
                  <option key={pos} value={pos}>{pos}</option>
                ))}
              </select>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 ml-2">Metric:</label>
              <select
                value={filters.dvpMetric}
                onChange={(e) => updateFilter('dvpMetric', e.target.value)}
                className={`text-xs px-2 py-1 rounded border ${
                  isDark ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                }`}
              >
                {DVP_METRICS.map(metric => (
                  <option key={metric.key} value={metric.key}>{metric.label}</option>
                ))}
              </select>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
              Rank: {filters.dvpRankMin ?? 1} - {filters.dvpRankMax ?? 30}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={30}
                value={filters.dvpRankMin ?? 1}
                onChange={(e) => updateFilter('dvpRankMin', parseInt(e.target.value))}
                className="flex-1 h-2"
              />
              <input
                type="range"
                min={1}
                max={30}
                value={filters.dvpRankMax ?? 30}
                onChange={(e) => updateFilter('dvpRankMax', parseInt(e.target.value))}
                className="flex-1 h-2"
              />
            </div>
            <button
              onClick={() => {
                updateFilter('dvpRankMin', null);
                updateFilter('dvpRankMax', null);
                updateFilter('dvpPosition', playerPosition);
                updateFilter('dvpMetric', 'pts');
                setOpenFilter(null);
                onFilterSelect?.(null);
              }}
              className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
        );
      
      case 'usage':
        return (
          <div className="space-y-3">
            <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
              Usage Rate: {filters.usageRateMin?.toFixed(1) ?? usageRateMin.toFixed(1)}% - {filters.usageRateMax?.toFixed(1) ?? usageRateMax.toFixed(1)}%
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={usageRateMin}
                max={usageRateMax}
                step={0.1}
                value={filters.usageRateMin ?? usageRateMin}
                onChange={(e) => updateFilter('usageRateMin', parseFloat(e.target.value))}
                className="flex-1 h-2"
              />
              <input
                type="range"
                min={usageRateMin}
                max={usageRateMax}
                step={0.1}
                value={filters.usageRateMax ?? usageRateMax}
                onChange={(e) => updateFilter('usageRateMax', parseFloat(e.target.value))}
                className="flex-1 h-2"
              />
            </div>
            <button
              onClick={() => {
                updateFilter('usageRateMin', null);
                updateFilter('usageRateMax', null);
                setOpenFilter(null);
                onFilterSelect?.(null);
              }}
              className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
        );
      
      case 'fgpct':
        return (
          <div className="space-y-3">
            <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
              FG%: {filters.fgPctMin?.toFixed(1) ?? '0.0'}% - {filters.fgPctMax?.toFixed(1) ?? '100.0'}%
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={filters.fgPctMin ?? 0}
                onChange={(e) => updateFilter('fgPctMin', parseFloat(e.target.value))}
                className="flex-1 h-2"
              />
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={filters.fgPctMax ?? 100}
                onChange={(e) => updateFilter('fgPctMax', parseFloat(e.target.value))}
                className="flex-1 h-2"
              />
            </div>
            <button
              onClick={() => {
                updateFilter('fgPctMin', null);
                updateFilter('fgPctMax', null);
                setOpenFilter(null);
                onFilterSelect?.(null);
              }}
              className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
        );
      
      case 'playtype':
        return (
          <div className="space-y-3">
            <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
              Select Play Types:
            </label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {PLAY_TYPES.map(playType => (
                <label key={playType.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.playTypes?.includes(playType.key) || false}
                    onChange={(e) => {
                      const current = filters.playTypes || [];
                      const updated = e.target.checked
                        ? [...current, playType.key]
                        : current.filter(pt => pt !== playType.key);
                      updateFilter('playTypes', updated);
                    }}
                    className="rounded"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">{playType.displayName}</span>
                </label>
              ))}
            </div>
            <button
              onClick={() => {
                updateFilter('playTypes', []);
                setOpenFilter(null);
                onFilterSelect?.(null);
              }}
              className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
        );
      
      case 'shotzones':
        return (
          <div className="space-y-3">
            <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
              Select Shot Zones:
            </label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {SHOT_ZONES.map(zone => (
                <label key={zone.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.shotZones?.includes(zone.key) || false}
                    onChange={(e) => {
                      const current = filters.shotZones || [];
                      const updated = e.target.checked
                        ? [...current, zone.key]
                        : current.filter(sz => sz !== zone.key);
                      updateFilter('shotZones', updated);
                    }}
                    className="rounded"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">{zone.displayName}</span>
                </label>
              ))}
            </div>
            <button
              onClick={() => {
                updateFilter('shotZones', []);
                setOpenFilter(null);
                onFilterSelect?.(null);
              }}
              className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
        );
      
      default:
        return null;
    }
  };
  
  // If showOnlyFilterButton is true, only render the Filter button
  if (showOnlyFilterButton) {
    // Use selectedFilter to determine which dropdown to show
    const activeFilter = selectedFilter || openFilter;
    
    const getFilterLabel = () => {
      if (!activeFilter) return 'Filter';
      switch (activeFilter) {
        case 'minutes': return 'Filter (Minutes)';
        case 'pace': return 'Filter (Pace)';
        case 'dvp': return 'Filter (DvP)';
        case 'usage': return 'Filter (Usage)';
        case 'fgpct': return 'Filter (FG%)';
        case 'playtype': return 'Filter (Playtype)';
        case 'shotzones': return 'Filter (Shot Zones)';
        default: return 'Filter';
      }
    };
    
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => {
            // Toggle dropdown - only open when button is clicked
            if (openFilter === activeFilter) {
              setOpenFilter(null);
            } else if (activeFilter) {
              setOpenFilter(activeFilter);
            }
          }}
          className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer ${
            activeFilter
              ? 'bg-purple-600 text-white'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {getFilterLabel()}
        </button>
        {openFilter === activeFilter && activeFilter && (
          <div
            className={`absolute top-full right-0 mt-1 w-72 z-[100] rounded-lg shadow-lg border p-3 ${
              isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
            style={{ zIndex: 100 }}
          >
            {renderFilterContent(activeFilter)}
          </div>
        )}
      </div>
    );
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Check if each filter is active
  const isPaceActive = filters.paceRankMin !== null || filters.paceRankMax !== null;
  const isDvpActive = filters.dvpRankMin !== null || filters.dvpRankMax !== null;
  const isUsageActive = filters.usageRateMin !== null || filters.usageRateMax !== null;
  const isFgPctActive = filters.fgPctMin !== null || filters.fgPctMax !== null;
  const isPlayTypeActive = filters.playTypes && filters.playTypes.length > 0;
  const isShotZoneActive = filters.shotZones && filters.shotZones.length > 0;
  const isMinutesActive = filters.minutesMin !== null || filters.minutesMax !== null;

  // Get display labels
  const paceLabel = isPaceActive 
    ? `Pace: ${filters.paceRankMin ?? paceRankMin}-${filters.paceRankMax ?? paceRankMax}`
    : 'Pace';
  
  const dvpMetricLabel = DVP_METRICS.find(m => m.key === filters.dvpMetric)?.label || filters.dvpMetric;
  const dvpLabel = isDvpActive
    ? `DvP ${filters.dvpPosition} ${dvpMetricLabel}: ${filters.dvpRankMin ?? 1}-${filters.dvpRankMax ?? 30}`
    : `DvP ${filters.dvpPosition}`;
  
  const usageLabel = isUsageActive
    ? `Usage: ${filters.usageRateMin?.toFixed(1) ?? usageRateMin.toFixed(1)}-${filters.usageRateMax?.toFixed(1) ?? usageRateMax.toFixed(1)}%`
    : 'Usage';
  
  const playTypeLabel = isPlayTypeActive
    ? `Playtype: ${filters.playTypes.length}`
    : 'Playtype';
  
  const shotZoneLabel = isShotZoneActive
    ? `Shot Zones: ${filters.shotZones.length}`
    : 'Shot Zones';
  
  const minutesLabel = isMinutesActive
    ? `Minutes: ${filters.minutesMin ?? 0}-${filters.minutesMax ?? 48}`
    : 'Minutes';

  return (
    <div className="relative inline-flex items-center gap-1.5 sm:gap-1.5 md:gap-2" ref={dropdownRef}>
      {/* Minutes Button - First */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            console.log('[GameFiltersChips] Minutes button clicked, current openFilter:', openFilter);
            if (openFilter === 'minutes') {
              setOpenFilter(null);
              console.log('[GameFiltersChips] Clearing filter selection');
              onFilterSelect?.(null);
            } else {
              setOpenFilter('minutes');
              console.log('[GameFiltersChips] Setting filter to minutes, calling onFilterSelect');
              onFilterSelect?.('minutes');
            }
          }}
          className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer ${
            selectedFilter === 'minutes'
              ? 'bg-purple-600 text-white'
              : isMinutesActive
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
          title={minutesLabel}
          style={{ position: 'relative', zIndex: 10 }}
        >
          {minutesLabel}
        </button>
      </div>

      {/* Pace Rank Button */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (openFilter === 'pace') {
              setOpenFilter(null);
              onFilterSelect?.(null);
            } else {
              setOpenFilter('pace');
              onFilterSelect?.('pace');
            }
          }}
          disabled={!hasData}
          className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
            selectedFilter === 'pace'
              ? 'bg-purple-600 text-white'
              : isPaceActive
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          } ${!hasData ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={!hasData ? 'No filter data available' : paceLabel}
        >
          {paceLabel}
        </button>
        {openFilter === 'pace' && hasData && (
          <div
            className={`absolute top-full left-0 mt-1 w-72 z-50 rounded-lg shadow-lg border p-3 ${
              isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3">
              <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
                Opponent Pace Rank: {filters.paceRankMin ?? paceRankMin} - {filters.paceRankMax ?? paceRankMax}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={paceRankMin}
                  max={paceRankMax}
                  value={filters.paceRankMin ?? paceRankMin}
                  onChange={(e) => updateFilter('paceRankMin', parseInt(e.target.value))}
                  className="flex-1 h-2"
                />
                <input
                  type="range"
                  min={paceRankMin}
                  max={paceRankMax}
                  value={filters.paceRankMax ?? paceRankMax}
                  onChange={(e) => updateFilter('paceRankMax', parseInt(e.target.value))}
                  className="flex-1 h-2"
                />
              </div>
              <button
                onClick={() => {
                  updateFilter('paceRankMin', null);
                  updateFilter('paceRankMax', null);
                  setOpenFilter(null);
                }}
                className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* DvP Rank Button */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (openFilter === 'dvp') {
              setOpenFilter(null);
              onFilterSelect?.(null);
            } else {
              setOpenFilter('dvp');
              onFilterSelect?.('dvp');
            }
          }}
          disabled={!hasData}
          className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
            selectedFilter === 'dvp'
              ? 'bg-purple-600 text-white'
              : isDvpActive
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          } ${!hasData ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={!hasData ? 'No filter data available' : dvpLabel}
        >
          {dvpLabel}
        </button>
        {openFilter === 'dvp' && hasData && (
          <div
            className={`absolute top-full left-0 mt-1 w-72 z-50 rounded-lg shadow-lg border p-3 ${
              isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Position:</label>
                <select
                  value={filters.dvpPosition}
                  onChange={(e) => updateFilter('dvpPosition', e.target.value)}
                  className={`text-xs px-2 py-1 rounded border ${
                    isDark ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                  }`}
                >
                  {POSITIONS.map(pos => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300 ml-2">Metric:</label>
                <select
                  value={filters.dvpMetric}
                  onChange={(e) => updateFilter('dvpMetric', e.target.value)}
                  className={`text-xs px-2 py-1 rounded border ${
                    isDark ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                  }`}
                >
                  {DVP_METRICS.map(metric => (
                    <option key={metric.key} value={metric.key}>{metric.label}</option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                Rank: {filters.dvpRankMin ?? 1} - {filters.dvpRankMax ?? 30}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={filters.dvpRankMin ?? 1}
                  onChange={(e) => updateFilter('dvpRankMin', parseInt(e.target.value))}
                  className="flex-1 h-2"
                />
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={filters.dvpRankMax ?? 30}
                  onChange={(e) => updateFilter('dvpRankMax', parseInt(e.target.value))}
                  className="flex-1 h-2"
                />
              </div>
              <button
                onClick={() => {
                  updateFilter('dvpRankMin', null);
                  updateFilter('dvpRankMax', null);
                  setOpenFilter(null);
                }}
                className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Usage Rate Button */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (openFilter === 'usage') {
              setOpenFilter(null);
              onFilterSelect?.(null);
            } else {
              setOpenFilter('usage');
              onFilterSelect?.('usage');
            }
          }}
          disabled={!hasData}
          className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
            selectedFilter === 'usage'
              ? 'bg-purple-600 text-white'
              : isUsageActive
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          } ${!hasData ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={!hasData ? 'No filter data available' : usageLabel}
        >
          {usageLabel}
        </button>
        {openFilter === 'usage' && hasData && (
          <div
            className={`absolute top-full left-0 mt-1 w-72 z-50 rounded-lg shadow-lg border p-3 ${
              isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3">
              <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
                Usage Rate: {filters.usageRateMin?.toFixed(1) ?? usageRateMin.toFixed(1)}% - {filters.usageRateMax?.toFixed(1) ?? usageRateMax.toFixed(1)}%
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={usageRateMin}
                  max={usageRateMax}
                  step={0.1}
                  value={filters.usageRateMin ?? usageRateMin}
                  onChange={(e) => updateFilter('usageRateMin', parseFloat(e.target.value))}
                  className="flex-1 h-2"
                />
                <input
                  type="range"
                  min={usageRateMin}
                  max={usageRateMax}
                  step={0.1}
                  value={filters.usageRateMax ?? usageRateMax}
                  onChange={(e) => updateFilter('usageRateMax', parseFloat(e.target.value))}
                  className="flex-1 h-2"
                />
              </div>
              <button
                onClick={() => {
                  updateFilter('usageRateMin', null);
                  updateFilter('usageRateMax', null);
                  setOpenFilter(null);
                }}
                className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Playtype Button */}
      <div className="relative">
        <button
          onClick={() => setOpenFilter(openFilter === 'playtype' ? null : 'playtype')}
          disabled={!hasData}
          className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
            isPlayTypeActive
              ? 'bg-purple-600 text-white'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          } ${!hasData ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={!hasData ? 'No filter data available' : playTypeLabel}
        >
          {playTypeLabel}
        </button>
        {openFilter === 'playtype' && hasData && (
          <div
            className={`absolute top-full left-0 mt-1 w-72 z-50 rounded-lg shadow-lg border p-3 ${
              isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3">
              <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
                Select Play Types:
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {PLAY_TYPES.map(playType => (
                  <label key={playType.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.playTypes?.includes(playType.key) || false}
                      onChange={(e) => {
                        const current = filters.playTypes || [];
                        const updated = e.target.checked
                          ? [...current, playType.key]
                          : current.filter(pt => pt !== playType.key);
                        updateFilter('playTypes', updated);
                      }}
                      className="rounded"
                    />
                    <span className="text-xs text-gray-700 dark:text-gray-300">{playType.displayName}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={() => {
                  updateFilter('playTypes', []);
                  setOpenFilter(null);
                }}
                className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Shot Zones Button */}
      <div className="relative">
        <button
          onClick={() => setOpenFilter(openFilter === 'shotzones' ? null : 'shotzones')}
          disabled={!hasData}
          className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
            isShotZoneActive
              ? 'bg-purple-600 text-white'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          } ${!hasData ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={!hasData ? 'No filter data available' : shotZoneLabel}
        >
          {shotZoneLabel}
        </button>
        {openFilter === 'shotzones' && hasData && (
          <div
            className={`absolute top-full left-0 mt-1 w-72 z-50 rounded-lg shadow-lg border p-3 ${
              isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3">
              <label className="block text-xs font-medium mb-1.5 text-gray-700 dark:text-gray-300">
                Select Shot Zones:
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {SHOT_ZONES.map(zone => (
                  <label key={zone.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.shotZones?.includes(zone.key) || false}
                      onChange={(e) => {
                        const current = filters.shotZones || [];
                        const updated = e.target.checked
                          ? [...current, zone.key]
                          : current.filter(sz => sz !== zone.key);
                        updateFilter('shotZones', updated);
                      }}
                      className="rounded"
                    />
                    <span className="text-xs text-gray-700 dark:text-gray-300">{zone.displayName}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={() => {
                  updateFilter('shotZones', []);
                  setOpenFilter(null);
                }}
                className="w-full py-1.5 px-3 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
