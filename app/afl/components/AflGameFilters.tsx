'use client';

import { useState } from 'react';

const AFL_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;
const DVP_STAT_OPTIONS = [
  { key: 'disposals', label: 'Disposals' },
  { key: 'kicks', label: 'Kicks' },
  { key: 'marks', label: 'Marks' },
  { key: 'goals', label: 'Goals' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'clearances', label: 'Clearances' },
  { key: 'inside_50s', label: 'Inside 50s' },
];

const OPPONENT_RANK_STAT_OPTIONS = [
  { code: 'D', label: 'Disposals' },
  { code: 'K', label: 'Kicks' },
  { code: 'HB', label: 'Handballs' },
  { code: 'M', label: 'Marks' },
  { code: 'G', label: 'Goals' },
  { code: 'T', label: 'Tackles' },
  { code: 'CL', label: 'Clearances' },
  { code: 'I50', label: 'Inside 50s' },
];

export type AflGameFiltersState = {
  dvpRankMin: number | null;
  dvpRankMax: number | null;
  dvpPosition: string;
  dvpMetric: string;
  opponentRankMin: number | null;
  opponentRankMax: number | null;
  opponentStat: string;
  togMin: number | null;
  togMax: number | null;
};

export const DEFAULT_AFL_GAME_FILTERS: AflGameFiltersState = {
  dvpRankMin: null,
  dvpRankMax: null,
  dvpPosition: 'MID',
  dvpMetric: 'disposals',
  opponentRankMin: null,
  opponentRankMax: null,
  opponentStat: 'D',
  togMin: null,
  togMax: null,
};

export type AflGameFilterDataItem = {
  gameIndex: number;
  opponent: string;
  dvpRank: number | null;
  dvpRankSource?: 'tipoff' | 'live' | null;
  opponentRank: number | null;
  tog: number | null;
};

interface AflGameFiltersProps {
  isDark: boolean;
  filters: AflGameFiltersState;
  onFiltersChange: (f: AflGameFiltersState) => void;
  filterData: AflGameFilterDataItem[] | null;
  playerPosition: string | null;
  inline?: boolean;
}

export default function AflGameFilters({
  isDark,
  filters,
  onFiltersChange,
  filterData,
  playerPosition,
  inline = false,
}: AflGameFiltersProps) {
  const [isOpen, setIsOpen] = useState(inline);

  const update = (key: keyof AflGameFiltersState, value: number | string | null) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const hasData = filterData && filterData.length > 0;
  const dvpRanks = hasData ? filterData.map((d) => d.dvpRank).filter((r): r is number => r != null) : [];
  const opponentRanks = hasData ? filterData.map((d) => d.opponentRank).filter((r): r is number => r != null) : [];
  const togs = hasData ? filterData.map((d) => d.tog).filter((r): r is number => r != null) : [];

  const dvpMin = dvpRanks.length ? Math.min(...dvpRanks) : 1;
  const dvpMax = dvpRanks.length ? Math.max(...dvpRanks) : 18;
  const oppMin = opponentRanks.length ? Math.min(...opponentRanks) : 1;
  const oppMax = opponentRanks.length ? Math.max(...opponentRanks) : 18;
  const togRangeMin = togs.length ? Math.min(...togs) : 0;
  const togRangeMax = togs.length ? Math.max(...togs) : 100;

  const content = (
    <div className={`rounded-lg border p-3 space-y-4 ${isDark ? 'border-gray-600 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
      {!hasData ? (
        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Select a player and load games to use filters.
        </p>
      ) : (
        <>
          {/* DVP Rank */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              DVP Rank: {filters.dvpRankMin ?? dvpMin} – {filters.dvpRankMax ?? dvpMax}
            </label>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <select
                value={filters.dvpPosition}
                onChange={(e) => update('dvpPosition', e.target.value)}
                className={`text-xs px-2 py-1 rounded border ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300'}`}
              >
                {AFL_POSITIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select
                value={filters.dvpMetric}
                onChange={(e) => update('dvpMetric', e.target.value)}
                className={`text-xs px-2 py-1 rounded border ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300'}`}
              >
                {DVP_STAT_OPTIONS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="range"
                min={dvpMin}
                max={dvpMax}
                value={filters.dvpRankMin ?? dvpMin}
                onChange={(e) => update('dvpRankMin', parseInt(e.target.value, 10))}
                className="flex-1 h-2"
              />
              <input
                type="range"
                min={dvpMin}
                max={dvpMax}
                value={filters.dvpRankMax ?? dvpMax}
                onChange={(e) => update('dvpRankMax', parseInt(e.target.value, 10))}
                className="flex-1 h-2"
              />
            </div>
          </div>

          {/* Opponent Rank (OA) */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              Opponent rank (allowed): {filters.opponentRankMin ?? oppMin} – {filters.opponentRankMax ?? oppMax}
            </label>
            <select
              value={filters.opponentStat}
              onChange={(e) => update('opponentStat', e.target.value)}
              className={`text-xs px-2 py-1 rounded border mb-1.5 w-full ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300'}`}
            >
              {OPPONENT_RANK_STAT_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="range"
                min={oppMin}
                max={oppMax}
                value={filters.opponentRankMin ?? oppMin}
                onChange={(e) => update('opponentRankMin', parseInt(e.target.value, 10))}
                className="flex-1 h-2"
              />
              <input
                type="range"
                min={oppMin}
                max={oppMax}
                value={filters.opponentRankMax ?? oppMax}
                onChange={(e) => update('opponentRankMax', parseInt(e.target.value, 10))}
                className="flex-1 h-2"
              />
            </div>
          </div>

          {/* TOG % */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              TOG %: {filters.togMin ?? togRangeMin}% – {filters.togMax ?? togRangeMax}%
            </label>
            <div className="flex gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={filters.togMin ?? togRangeMin}
                onChange={(e) => update('togMin', parseInt(e.target.value, 10))}
                className="flex-1 h-2"
              />
              <input
                type="range"
                min={0}
                max={100}
                value={filters.togMax ?? togRangeMax}
                onChange={(e) => update('togMax', parseInt(e.target.value, 10))}
                className="flex-1 h-2"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => onFiltersChange({ ...DEFAULT_AFL_GAME_FILTERS, dvpPosition: playerPosition || 'MID' })}
            className={`w-full py-1.5 px-3 rounded text-xs font-medium ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
          >
            Clear filters
          </button>
        </>
      )}
    </div>
  );

  if (inline) return <div>{content}</div>;

  return (
    <div className={isDark ? 'text-gray-100' : 'text-gray-900'}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-2.5 rounded-lg border ${isDark ? 'bg-[#0a1929] border-gray-600 hover:bg-gray-800/50' : 'bg-white border-gray-200 hover:bg-gray-50'} transition-colors`}
      >
        <span className="font-semibold text-sm">Game filters</span>
        <span className="text-xs text-gray-500">{isOpen ? '▼' : '▶'} {hasData ? `${filterData.length} games` : ''}</span>
      </button>
      {isOpen && content}
    </div>
  );
}
