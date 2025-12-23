'use client';

import { useState, useEffect } from 'react';

export interface GameFilterData {
  gameId: string;
  gameDate: string;
  opponent: string;
  opponentDvpRanks: {
    [position: string]: {
      [metric: string]: number | null;
    };
  };
  opponentPace: number | null;
  opponentPaceRank: number | null;
  playerUsageRate: number | null;
  playerFGM: number | null;
}

export interface GameFiltersState {
  // Pace rank filter (1-30, where 1 is best pace)
  paceRankMin: number | null;
  paceRankMax: number | null;
  
  // DvP rank filter (1-30, where 1 is worst defense)
  dvpRankMin: number | null;
  dvpRankMax: number | null;
  dvpPosition: string; // PG, SG, SF, PF, C
  dvpMetric: string; // pts, reb, ast, fg3m, fg_pct, stl, blk, to
  
  // Usage rate filter (percentage)
  usageRateMin: number | null;
  usageRateMax: number | null;
  
  // FG% filter (percentage)
  fgPctMin: number | null;
  fgPctMax: number | null;
  
  // Playtype filter (array of selected play types)
  playTypes: string[]; // e.g., ['PRBallHandler', 'Transition', 'Spotup']
  
  // Shot chart filter (shot zones)
  shotZones: string[]; // e.g., ['restrictedArea', 'paint', 'midRange', 'leftCorner3', 'rightCorner3', 'aboveBreak3']
  
  // Minutes filter
  minutesMin: number | null;
  minutesMax: number | null;
}

interface GameFiltersProps {
  isDark: boolean;
  playerId: number | null; // BDL player ID
  season: number;
  playerPosition?: string; // Default position for DvP filter
  filters: GameFiltersState;
  onFiltersChange: (filters: GameFiltersState) => void;
  filterData: GameFilterData[] | null;
  onFilterDataLoad: (data: GameFilterData[] | null) => void;
  inline?: boolean; // If true, don't show collapsible wrapper (for use in Advanced Filters dropdown)
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

export default function GameFilters({
  isDark,
  playerId,
  season,
  playerPosition = 'PG',
  filters,
  onFiltersChange,
  filterData,
  onFilterDataLoad,
  inline = false,
}: GameFiltersProps) {
  const [isOpen, setIsOpen] = useState(inline); // Auto-open if inline
  const [loading, setLoading] = useState(false);

  // Debug: log when component renders (always log, even on mount)
  console.log('[GameFilters] Component rendering', { playerId, season, inline, hasFilterData: !!filterData, filterDataLength: filterData?.length || 0 });

  // Fetch filter data when player/season changes
  useEffect(() => {
    if (!playerId || !season) {
      console.log('[GameFilters] Skipping fetch - missing playerId or season', { playerId, season });
      onFilterDataLoad(null);
      return;
    }
    
    // Only fetch if we have valid IDs
    if (playerId === null || isNaN(playerId)) {
      console.log('[GameFilters] Skipping fetch - invalid playerId', { playerId });
      onFilterDataLoad(null);
      return;
    }

    const fetchFilterData = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/game-filters?player_id=${playerId}&season=${season}`);
        if (response.ok) {
          const json = await response.json();
          onFilterDataLoad(json.data || null);
        } else {
          console.warn('[GameFilters] No filter data found');
          onFilterDataLoad(null);
        }
      } catch (error) {
        console.error('[GameFilters] Error fetching filter data:', error);
        onFilterDataLoad(null);
      } finally {
        setLoading(false);
      }
    };

    fetchFilterData();
  }, [playerId, season, onFilterDataLoad]);

  // Calculate min/max values from filter data
  const stats = filterData ? {
    paceRanks: filterData.map(d => d.opponentPaceRank).filter((r): r is number => r !== null),
    usageRates: filterData.map(d => d.playerUsageRate).filter((r): r is number => r !== null),
    fgPcts: filterData.map(d => {
      // Calculate FG% from FGM and FGA if needed, or use cached value
      // For now, we'll need to get FGA from game stats - this is a placeholder
      return null; // TODO: Calculate from game stats
    }).filter((p: number | null): p is number => p !== null),
  } : {
    paceRanks: [],
    usageRates: [],
    fgPcts: [],
  };

  const paceRankMin = stats.paceRanks.length > 0 ? Math.min(...stats.paceRanks) : 1;
  const paceRankMax = stats.paceRanks.length > 0 ? Math.max(...stats.paceRanks) : 30;
  const usageRateMin = stats.usageRates.length > 0 ? Math.min(...stats.usageRates) : 0;
  const usageRateMax = stats.usageRates.length > 0 ? Math.max(...stats.usageRates) : 100;

  const updateFilter = (key: keyof GameFiltersState, value: number | string | null) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  // Show component even if no data (with message)
  const hasData = filterData && filterData.length > 0;

  // Always render the component (even if playerId is null, show message)
  // Log to verify component is rendering
  console.log('[GameFilters] Rendering component', { 
    playerId, 
    season, 
    inline, 
    hasData, 
    filterDataLength: filterData?.length || 0,
    willShow: true 
  });
  
  const content = (
        <>
        {!hasData ? (
          <div className={`p-3 rounded-lg ${
            isDark ? 'bg-gray-700/50 border border-gray-600' : 'bg-gray-50 border border-gray-200'
          }`}>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              ⚠️ No filter data available
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              Run the cache script to enable filters:
            </p>
            <code className="block text-[10px] bg-gray-100 dark:bg-gray-800 p-1.5 rounded text-gray-700 dark:text-gray-300 font-mono break-all">
              node scripts/cache-game-filters.js {playerId || 'PLAYER_ID'} {season}
            </code>
          </div>
        ) : (
        <div className={`mt-2 p-4 rounded-lg border ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        } space-y-4`}>
          {/* Pace Rank Filter */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Opponent Pace Rank: {filters.paceRankMin ?? paceRankMin} - {filters.paceRankMax ?? paceRankMax}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={paceRankMin}
                max={paceRankMax}
                value={filters.paceRankMin ?? paceRankMin}
                onChange={(e) => updateFilter('paceRankMin', parseInt(e.target.value))}
                className="flex-1"
              />
              <input
                type="range"
                min={paceRankMin}
                max={paceRankMax}
                value={filters.paceRankMax ?? paceRankMax}
                onChange={(e) => updateFilter('paceRankMax', parseInt(e.target.value))}
                className="flex-1"
              />
            </div>
          </div>

          {/* DvP Rank Filter */}
          <div>
            <div className="flex items-center gap-4 mb-2">
              <label className="block text-sm font-medium">
                DvP Rank: {filters.dvpRankMin ?? 1} - {filters.dvpRankMax ?? 30}
              </label>
              <select
                value={filters.dvpPosition}
                onChange={(e) => updateFilter('dvpPosition', e.target.value)}
                className={`text-sm px-2 py-1 rounded border ${
                  isDark ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                }`}
              >
                {POSITIONS.map(pos => (
                  <option key={pos} value={pos}>{pos}</option>
                ))}
              </select>
              <select
                value={filters.dvpMetric}
                onChange={(e) => updateFilter('dvpMetric', e.target.value)}
                className={`text-sm px-2 py-1 rounded border ${
                  isDark ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'
                }`}
              >
                {DVP_METRICS.map(metric => (
                  <option key={metric.key} value={metric.key}>{metric.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={30}
                value={filters.dvpRankMin ?? 1}
                onChange={(e) => updateFilter('dvpRankMin', parseInt(e.target.value))}
                className="flex-1"
              />
              <input
                type="range"
                min={1}
                max={30}
                value={filters.dvpRankMax ?? 30}
                onChange={(e) => updateFilter('dvpRankMax', parseInt(e.target.value))}
                className="flex-1"
              />
            </div>
          </div>

          {/* Usage Rate Filter */}
          <div>
            <label className="block text-sm font-medium mb-2">
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
                className="flex-1"
              />
              <input
                type="range"
                min={usageRateMin}
                max={usageRateMax}
                step={0.1}
                value={filters.usageRateMax ?? usageRateMax}
                onChange={(e) => updateFilter('usageRateMax', parseFloat(e.target.value))}
                className="flex-1"
              />
            </div>
          </div>

          {/* Clear Filters Button */}
          <button
            onClick={() => {
              onFiltersChange({
                paceRankMin: null,
                paceRankMax: null,
                dvpRankMin: null,
                dvpRankMax: null,
                dvpPosition: playerPosition || '',
                dvpMetric: 'pts',
                usageRateMin: null,
                usageRateMax: null,
                fgPctMin: null,
                fgPctMax: null,
                playTypes: [],
                shotZones: [],
                minutesMin: null,
                minutesMax: null,
              });
            }}
            className={`w-full py-2 px-4 rounded text-sm font-medium ${
              isDark
                ? 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
            } transition-colors`}
          >
            Clear All Filters
          </button>
        </div>
        )}
        </>
  );

  if (inline) {
    // Inline mode: just show the content without collapsible wrapper
    return <div>{content}</div>;
  }

  // Collapsible mode: show with button
  return (
    <div className={`mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-3 rounded-lg border ${
          isDark
            ? 'bg-gray-800 border-gray-700 hover:bg-gray-750'
            : 'bg-white border-gray-200 hover:bg-gray-50'
        } transition-colors`}
      >
        <span className="font-semibold text-sm">Game Filters</span>
        <span className="text-xs text-gray-500">
          {isOpen ? '▼' : '▶'} {hasData ? `(${filterData.length} games)` : '(no data)'}
        </span>
      </button>
      {isOpen && content}
    </div>
  );
}

