'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import AflXAxisTick from '@/app/afl/components/AflXAxisTick';

const STAT_PRIORITY = [
  'goals',
  'disposals',
  'marks',
  'tackles',
  'kicks',
  'handballs',
  'behinds',
  'clearances',
  'inside_50s',
  'hitouts',
  'free_kicks_for',
  'free_kicks_against',
  'contested_possessions',
  'uncontested_possessions',
  'contested_marks',
  'marks_inside_50',
  'one_percenters',
  'bounces',
  'goal_assists',
  'percent_played',
];
const META_SKIP = new Set(['season', 'game_number', 'guernsey']);
const TIMEFRAME_OPTIONS = ['last5', 'last10', 'last15', 'last20', 'h2h', 'lastseason', 'thisseason'] as const;

interface AflChartTooltipProps {
  active?: boolean;
  payload?: any[];
  coordinate?: { x: number; y: number };
  isDark: boolean;
  selectedStatLabel: string;
}

function AflChartTooltip({ active, payload, coordinate, isDark, selectedStatLabel }: AflChartTooltipProps) {
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== 'undefined' && window.innerWidth < 640);
    };
    checkMobile();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setMousePosition(null);
      return;
    }
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches?.length > 0) {
        const t = e.touches[0];
        setMousePosition({ x: t.clientX, y: t.clientY });
      }
    };
    if (coordinate?.x != null && coordinate?.y != null) {
      setMousePosition({ x: coordinate.x, y: coordinate.y });
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchstart', handleTouchStart);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchstart', handleTouchStart);
    };
  }, [active, coordinate?.x, coordinate?.y]);

  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as
    | { round?: string; opponent?: string; result?: string; value?: number }
    | undefined;
  if (!point) return null;

  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipText = isDark ? '#ffffff' : '#000000';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const labelColor = isDark ? '#9ca3af' : '#6b7280';
  const winColor = isDark ? '#10b981' : '#059669';
  const lossColor = isDark ? '#ef4444' : '#dc2626';

  const getTooltipPosition = () => {
    const currentPosition = mousePosition ?? (coordinate ? { x: coordinate.x, y: coordinate.y } : null);
    if (!currentPosition) return { left: undefined, top: undefined };
    if (isMobile) {
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
      const tooltipWidth = 280;
      const tooltipHeight = 120;
      const left = Math.max(10, (viewportWidth - tooltipWidth) / 2);
      const top = Math.max(10, Math.min(viewportHeight * 0.4, viewportHeight - tooltipHeight - 20));
      return { left: `${left}px`, top: `${top}px` };
    }
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const tooltipWidth = 280;
    const offsetX = 15;
    const offsetY = -10;
    let left = currentPosition.x + offsetX;
    if (left + tooltipWidth > viewportWidth - 10) left = viewportWidth - tooltipWidth - 10;
    return { left: `${left}px`, top: `${currentPosition.y + offsetY}px` };
  };

  const position = getTooltipPosition();
  const isWin = point.result?.toLowerCase().startsWith('w');
  const resultColor = point.result ? (isWin ? winColor : lossColor) : labelColor;

  const tooltipStyle: React.CSSProperties = {
    backgroundColor: tooltipBg,
    border: `1px solid ${tooltipBorder}`,
    borderRadius: '8px',
    padding: '12px',
    minWidth: isMobile ? '280px' : '200px',
    maxWidth: isMobile ? '90vw' : 'none',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    zIndex: 999999,
    pointerEvents: 'none',
    position: 'fixed',
    left: position.left,
    top: position.top,
    transform: 'none',
  };

  const formattedValue =
    typeof point.value === 'number'
      ? Number.isInteger(point.value)
        ? String(point.value)
        : point.value.toFixed(1)
      : '-';

  const tooltipContent = (
    <div style={tooltipStyle}>
      <div
        style={{
          marginBottom: '12px',
          paddingBottom: '8px',
          borderBottom: `1px solid ${tooltipBorder}`,
          fontSize: '13px',
          fontWeight: '600',
          color: tooltipText,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{point.round ?? '-'} vs {point.opponent ?? '-'}</span>
        {point.result && (
          <span style={{ color: resultColor, fontWeight: '600', fontSize: '12px' }}>
            {point.result}
          </span>
        )}
      </div>
      <div
        style={{
          padding: '8px',
          backgroundColor: isDark ? '#374151' : '#f3f4f6',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: '600',
          color: tooltipText,
        }}
      >
        {selectedStatLabel}: {formattedValue}
      </div>
    </div>
  );

  const shouldRender = typeof window !== 'undefined' && active && (mousePosition ?? (isMobile && coordinate));
  if (shouldRender) {
    return createPortal(tooltipContent, document.body);
  }
  return null;
}

function formatStatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function toNumericValue(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type AflChartTimeframe = (typeof TIMEFRAME_OPTIONS)[number];

interface AflStatsChartProps {
  stats: Record<string, string | number>;
  gameLogs?: Array<Record<string, unknown>>;
  isDark: boolean;
  isLoading?: boolean;
  hasSelectedPlayer?: boolean;
  apiErrorHint?: string | null;
  teammateFilterName?: string | null;
  withWithoutMode?: 'with' | 'without';
  season?: number;
  clearTeammateFilter?: () => void;
  /** When provided, chart timeframe is controlled by parent (e.g. to sync Supporting stats). */
  selectedTimeframe?: AflChartTimeframe;
  onTimeframeChange?: (timeframe: AflChartTimeframe) => void;
}

export function AflStatsChart({
  stats: _stats,
  gameLogs = [],
  isDark,
  isLoading,
  hasSelectedPlayer,
  apiErrorHint,
  teammateFilterName,
  withWithoutMode = 'with',
  season = 2025,
  clearTeammateFilter,
  selectedTimeframe: controlledTimeframe,
  onTimeframeChange,
}: AflStatsChartProps) {
  const [logoByTeam, setLogoByTeam] = useState<Record<string, string>>({});
  const [teammateRounds, setTeammateRounds] = useState<Set<string>>(new Set());
  const [internalTimeframe, setInternalTimeframe] =
    useState<AflChartTimeframe>('last10');
  const selectedTimeframe = controlledTimeframe ?? internalTimeframe;
  const setSelectedTimeframe = useCallback(
    (t: AflChartTimeframe) => {
      if (onTimeframeChange) onTimeframeChange(t);
      if (controlledTimeframe == null) setInternalTimeframe(t);
    },
    [onTimeframeChange, controlledTimeframe]
  );

  useEffect(() => {
    if (!teammateFilterName?.trim()) {
      setTeammateRounds(new Set());
      return;
    }
    let cancelled = false;
    fetch(
      `/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(teammateFilterName.trim())}`
    )
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const games = Array.isArray(json?.games) ? json.games : [];
        const rounds = new Set<string>(
          games.map((g: Record<string, unknown>) => String(g.round ?? '').trim()).filter(Boolean)
        );
        setTeammateRounds(rounds);
      })
      .catch(() => {
        if (!cancelled) setTeammateRounds(new Set());
      });
    return () => { cancelled = true; };
  }, [teammateFilterName, season]);

  useEffect(() => {
    let cancelled = false;

    const loadTeamLogos = async () => {
      try {
        const tryUrls = [
          '/api/afl/teams?league=1&season=2025',
          '/api/afl/teams?season=2025',
        ];

        let rows: any[] = [];
        for (const url of tryUrls) {
          const res = await fetch(url);
          if (!res.ok) continue;
          const json = await res.json();
          rows = Array.isArray(json?.response)
            ? json.response
            : Array.isArray(json)
              ? json
              : [];
          if (rows.length > 0) break;
        }
        if (rows.length === 0) return;

        const nextMap: Record<string, string> = {};
        for (const row of rows) {
          const team = row?.team ?? row;
          const name = String(team?.name ?? '').trim();
          const logo = String(team?.logo ?? team?.image ?? '').trim();
          if (!name || !logo) continue;
          nextMap[normalizeTeamName(name)] = logo;
        }

        if (!cancelled && Object.keys(nextMap).length > 0) {
          setLogoByTeam(nextMap);
        }
      } catch {
        // Leave fallback text ticks when logos are unavailable.
      }
    };

    loadTeamLogos();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableStats = useMemo(() => {
    const keys = new Set<string>();
    for (const row of gameLogs) {
      for (const [k, v] of Object.entries(row)) {
        if (META_SKIP.has(k)) continue;
        const num = toNumericValue(v);
        if (num !== null) keys.add(k);
      }
    }
    const ordered: string[] = [];
    for (const k of STAT_PRIORITY) if (keys.has(k)) ordered.push(k);
    for (const k of keys) if (!ordered.includes(k)) ordered.push(k);
    return ordered;
  }, [gameLogs]);

  const [selectedStat, setSelectedStat] = useState<string>('');
  const [lineValue, setLineValue] = useState(0);
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const lineDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!availableStats.length) {
      setSelectedStat('');
      return;
    }
    if (!selectedStat || !availableStats.includes(selectedStat)) {
      setSelectedStat(availableStats[0]);
    }
  }, [availableStats, selectedStat]);

  const filteredGameLogs = useMemo(() => {
    if (!teammateFilterName?.trim()) return gameLogs;
    if (teammateRounds.size === 0) return gameLogs;
    return gameLogs.filter((g) => {
      const round = String(g.round ?? '').trim();
      const playedWithTeammate = teammateRounds.has(round);
      if (withWithoutMode === 'with') return playedWithTeammate;
      return !playedWithTeammate;
    });
  }, [gameLogs, teammateFilterName, teammateRounds, withWithoutMode]);

  const baseChartData = useMemo(() => {
    if (!selectedStat) return [];
    return [...filteredGameLogs]
      .sort((a, b) => {
        const aNum = typeof a.game_number === 'number' ? a.game_number : Number(a.game_number ?? 0);
        const bNum = typeof b.game_number === 'number' ? b.game_number : Number(b.game_number ?? 0);
        if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
        const aDate = new Date(String(a.date ?? a.game_date ?? '')).getTime();
        const bDate = new Date(String(b.date ?? b.game_date ?? '')).getTime();
        if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;
        return 0;
      })
      .map((g, idx) => {
        const gameNum = typeof g.game_number === 'number' ? g.game_number : idx + 1;
        const round = String(g.round ?? '-');
        const opponent = String(g.opponent ?? '-');
        const result = String(g.result ?? '-');
        const gameDate = String(g.date ?? g.game_date ?? '');
        const value = toNumericValue(g[selectedStat]) ?? 0;
        const key = `${gameNum}-${round}-${opponent}-${idx}`;

        return {
          key,
          xKey: `G${gameNum}`,
          tickLabel: opponent,
          round,
          opponent,
          result,
          value,
          gameId: key,
          gameDate,
          game: {
            id: key,
            date: gameDate,
            home_team: { abbreviation: opponent.toUpperCase() },
            visitor_team: { abbreviation: opponent.toUpperCase() },
          },
        };
      });
  }, [filteredGameLogs, selectedStat]);

  const chartData = useMemo(() => {
    if (!baseChartData.length) return [];

    if (selectedTimeframe === 'thisseason' || selectedTimeframe === 'lastseason') {
      return baseChartData;
    }

    if (selectedTimeframe === 'h2h') {
      const latestOpponent = baseChartData[baseChartData.length - 1]?.opponent;
      if (!latestOpponent) return baseChartData;
      const h2hData = baseChartData.filter((row) => row.opponent === latestOpponent);
      return h2hData.length ? h2hData : baseChartData;
    }

    const lastN = parseInt(selectedTimeframe.replace('last', ''), 10);
    if (Number.isFinite(lastN) && lastN > 0) return baseChartData.slice(-lastN);
    return baseChartData;
  }, [baseChartData, selectedTimeframe]);

  const statAverage = useMemo(() => {
    if (!chartData.length) return 0;
    const total = chartData.reduce((sum, row) => sum + row.value, 0);
    return total / chartData.length;
  }, [chartData]);

  const hasDecimalValues = useMemo(() => (
    chartData.some((d) => Math.abs(d.value - Math.round(d.value)) > 0.001)
  ), [chartData]);

  const sliderStep = hasDecimalValues ? 0.1 : 0.5;

  // Y-axis: 0 at bottom, 4 ticks. Goals/marks: top = max+1; others: top = next multiple of 5 (NBA style)
  const yAxisConfig = useMemo(() => {
    if (!chartData.length) return { domain: [0, 10] as [number, number], ticks: [0, 3, 7, 10] };

    const values = chartData.map((d) => d.value);
    const maxValue = Math.max(...values);
    const useMaxPlusOne = selectedStat === 'goals' || selectedStat === 'marks';
    const max = useMaxPlusOne
      ? Math.max(Math.ceil(maxValue) + 1, 1)
      : Math.max(Math.ceil(maxValue / 5) * 5, 5);
    const step = max / 3;
    const useDecimals = values.some((v) => Math.abs(v - Math.round(v)) > 0.001);
    const ticks: number[] = [
      0,
      useDecimals ? Math.round(step * 10) / 10 : Math.round(step),
      useDecimals ? Math.round(step * 2 * 10) / 10 : Math.round(step * 2),
      max,
    ];

    return {
      domain: [0, max] as [number, number],
      ticks,
    };
  }, [chartData, selectedStat]);

  const selectedStatLabel = useMemo(() => formatStatLabel(selectedStat || 'stat'), [selectedStat]);

  const emitTransientLine = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    try {
      window.dispatchEvent(new CustomEvent('transient-line', { detail: { value } }));
    } catch {
      // Ignore event dispatch issues.
    }
  }, []);

  const normalizeLineValue = useCallback((raw: number) => {
    if (!Number.isFinite(raw)) return lineValue;
    const snapped = hasDecimalValues
      ? Math.round(raw * 10) / 10
      : Math.round(raw * 2) / 2;
    const min = yAxisConfig.domain[0];
    const max = yAxisConfig.domain[1];
    return Math.max(min, Math.min(max, snapped));
  }, [hasDecimalValues, lineValue, yAxisConfig.domain]);

  const setLineAndEmit = useCallback((raw: number) => {
    const next = normalizeLineValue(raw);
    setLineValue(next);
    emitTransientLine(next);
  }, [emitTransientLine, normalizeLineValue]);

  useEffect(() => {
    if (!Number.isFinite(statAverage)) return;
    const next = hasDecimalValues
      ? Math.round(statAverage * 10) / 10
      : Math.round(statAverage * 2) / 2;
    setLineValue(next);
    emitTransientLine(next);
    const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
    if (input) input.value = String(next);
  }, [selectedStat, selectedTimeframe, statAverage, hasDecimalValues, emitTransientLine]);

  const timeframeLabels: Record<(typeof TIMEFRAME_OPTIONS)[number], string> = {
    last5: 'L5',
    last10: 'L10',
    last15: 'L15',
    last20: 'L20',
    h2h: 'H2H',
    lastseason: 'Last Season',
    thisseason: 'This Season',
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (timeframeDropdownRef.current && !timeframeDropdownRef.current.contains(e.target as Node)) {
        setIsTimeframeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (lineDebounceRef.current) clearTimeout(lineDebounceRef.current);
    };
  }, []);

  const customTooltip = useCallback((props: any) => {
    return (
      <AflChartTooltip
        active={props.active}
        payload={props.payload}
        coordinate={props.coordinate}
        isDark={isDark}
        selectedStatLabel={selectedStatLabel}
      />
    );
  }, [isDark, selectedStatLabel]);

  const aflXAxisTick = useMemo(() => (
    <AflXAxisTick data={chartData} logoByTeam={logoByTeam} isDark={isDark} />
  ), [chartData, logoByTeam, isDark]);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-4">
        <div className="animate-pulse text-gray-500 dark:text-gray-400 text-sm">Loading stats...</div>
      </div>
    );
  }

  if (!gameLogs.length) {
    return (
      <div className="h-full w-full flex items-center justify-center p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a player to see game chart</p>
      </div>
    );
  }

  if (hasSelectedPlayer && (!availableStats.length || !selectedStat || !chartData.length)) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No game stat data for this player this season</p>
        {apiErrorHint && (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 max-w-md break-words">
            {apiErrorHint}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="h-full w-full px-2 sm:px-3 md:px-4 pt-3 pb-2 flex flex-col">
      <div className="mb-4 sm:mb-5 md:mb-4 mt-1 sm:mt-0 w-full max-w-full">
        <div
          className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
            {availableStats.map((k) => (
              <StatPill
                key={k}
                label={formatStatLabel(k)}
                value={k}
                isSelected={selectedStat === k}
                onSelect={setSelectedStat}
                isDark={isDark}
              />
            ))}
          </div>
        </div>
      </div>

      {/* One row: Line input + Timeframe dropdown next to each other */}
      <div className="space-y-2 sm:space-y-3 md:space-y-4 mb-2 sm:mb-3 md:mb-4 lg:mb-6">
        <div className="flex items-center flex-wrap gap-1 sm:gap-2 md:gap-3 pl-0 sm:pl-0 ml-2 sm:ml-6">
          <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Line</span>
          <input
            id="betting-line-input"
            key={`line-${selectedStat}-${selectedTimeframe}`}
            type="number"
            step={sliderStep}
            defaultValue={lineValue}
            min={yAxisConfig.domain[0]}
            max={yAxisConfig.domain[1]}
            onChange={(e) => {
              const raw = Number((e.target as HTMLInputElement).value);
              if (!Number.isFinite(raw)) return;
              const next = normalizeLineValue(raw);
              emitTransientLine(next);
              if (lineDebounceRef.current) clearTimeout(lineDebounceRef.current);
              lineDebounceRef.current = setTimeout(() => {
                setLineValue(next);
                lineDebounceRef.current = null;
              }, 300);
            }}
            className="w-20 sm:w-20 md:w-22 px-2.5 py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            aria-label={`Set line value for ${selectedStatLabel}`}
          />
          <div className="relative" ref={timeframeDropdownRef}>
            <button
              type="button"
              onClick={() => setIsTimeframeDropdownOpen(!isTimeframeDropdownOpen)}
              className="w-20 sm:w-24 md:w-28 lg:w-32 px-2 sm:px-2 md:px-3 py-2.5 sm:py-2 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              <span className="truncate">{timeframeLabels[selectedTimeframe] || 'L10'}</span>
              <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isTimeframeDropdownOpen && (
              <>
                <div className="absolute top-full right-0 mt-1 w-20 sm:w-24 md:w-28 lg:w-32 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {TIMEFRAME_OPTIONS.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => {
                        setSelectedTimeframe(tf);
                        setIsTimeframeDropdownOpen(false);
                      }}
                      className={`w-full px-2 sm:px-2 md:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg last:rounded-b-lg ${
                        selectedTimeframe === tf
                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {timeframeLabels[tf]}
                    </button>
                  ))}
                </div>
                <div className="fixed inset-0 z-40" onClick={() => setIsTimeframeDropdownOpen(false)} aria-hidden />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <SimpleChart
          chartData={chartData}
          yAxisConfig={yAxisConfig}
          isDark={isDark}
          bettingLine={lineValue}
          selectedStat={selectedStat}
          selectedTimeframe={selectedTimeframe}
          customTooltip={customTooltip}
          customXAxisTick={aflXAxisTick}
          yAxisTickFormatter={(value) => String(Math.round(value))}
          teammateFilterName={teammateFilterName}
          withWithoutMode={withWithoutMode}
          clearTeammateFilter={clearTeammateFilter}
        />
      </div>
    </div>
  );
}
