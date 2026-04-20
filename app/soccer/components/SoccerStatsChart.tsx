'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

export type SoccerTimeframe = 'last5' | 'last10' | 'last20' | 'last50' | 'all' | `season:${number}`;
type SoccerSplitResultFilter = 'all' | 'wins' | 'losses' | 'draws';
type SoccerVenueFilter = 'all' | 'HOME' | 'AWAY';
type SoccerMatchVenue = Exclude<SoccerVenueFilter, 'all'>;
export type SoccerStatTeamScope = 'all' | 'home' | 'away';

type SoccerChartRow = {
  key: string;
  xKey: string;
  tickLabel: string;
  opponent: string;
  result: string;
  venue: SoccerMatchVenue;
  value: number;
  comparisonValue: string | null;
  gameDate: string;
  scoreline: string;
  sourceMatch: SoccerwayRecentMatch;
  gameSeason: number;
};

type SoccerStatsChartProps = {
  matches: SoccerwayRecentMatch[];
  selectedTeamName: string;
  isDark: boolean;
  onSelectedStatChange?: (stat: string) => void;
  onSelectedTimeframeChange?: (timeframe: SoccerTimeframe) => void;
  onSelectedTeamScopeChange?: (scope: SoccerStatTeamScope) => void;
};

const SOCCER_STAT_PRIORITY = [
  'total_goals',
  'expected_goals_xg',
  'xg_on_target_xgot',
  'ball_possession',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'blocked_shots',
  'big_chances',
  'corner_kicks',
  'yellow_cards',
  'red_cards',
  'passes',
  'accurate_passes',
  'long_passes',
  'passes_in_final_third',
  'crosses',
  'expected_assists_xa',
  'fouls',
  'offsides',
  'free_kicks',
  'throw_ins',
  'touches_in_opposition_box',
  'accurate_through_passes',
  'tackles',
  'duels_won',
  'clearances',
  'interceptions',
  'errors_leading_to_shot',
  'errors_leading_to_goal',
  'goalkeeper_saves',
  'xgot_faced',
  'goals_prevented',
  'shots_inside_the_box',
  'shots_outside_the_box',
  'hit_the_woodwork',
];

function normalizeTeamName(value: string): string {
  return value.trim().toLowerCase();
}

function formatStatKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(xg\)/g, ' xg')
    .replace(/\(xgot\)/g, ' xgot')
    .replace(/\(xa\)/g, ' xa')
    .replace(/%/g, ' percent ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatStatLabel(label: string): string {
  if (label === 'total_goals') return 'Total goals';
  if (label === 'expected_goals_xg') return 'xG';
  if (label === 'xg_on_target_xgot') return 'xGOT';
  if (label === 'expected_assists_xa') return 'xA';
  return label
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function getSelectedTeamSide(match: SoccerwayRecentMatch, selectedTeamName: string): 'home' | 'away' | null {
  const selected = normalizeTeamName(selectedTeamName);
  if (normalizeTeamName(match.homeTeam) === selected) return 'home';
  if (normalizeTeamName(match.awayTeam) === selected) return 'away';
  return null;
}

function getMatchPeriodStats(match: SoccerwayRecentMatch): SoccerwayMatchStat[] {
  const period = match.stats?.periods.find((item) => item.name.toLowerCase() === 'match');
  if (!period) return [];
  return period.categories.flatMap((category) => category.stats);
}

function parseNumericValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number.parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

function getTeamValueForStat(match: SoccerwayRecentMatch, selectedTeamName: string, stat: SoccerwayMatchStat): number | null {
  const side = getSelectedTeamSide(match, selectedTeamName);
  const raw = side === 'away' ? stat.awayValue : stat.homeValue;
  return parseNumericValue(raw);
}

function getOpponentValueForStat(match: SoccerwayRecentMatch, selectedTeamName: string, stat: SoccerwayMatchStat): string | null {
  const side = getSelectedTeamSide(match, selectedTeamName);
  return side === 'away' ? stat.homeValue ?? null : stat.awayValue ?? null;
}

function getSelectedTeamPerspective(match: SoccerwayRecentMatch, selectedTeamName: string) {
  const side = getSelectedTeamSide(match, selectedTeamName);
  const teamScore = side === 'away' ? match.awayScore : match.homeScore;
  const opponentScore = side === 'away' ? match.homeScore : match.awayScore;
  const opponent = side === 'away' ? match.homeTeam : match.awayTeam;
  const venue: SoccerMatchVenue = side === 'away' ? 'AWAY' : 'HOME';
  const result = teamScore > opponentScore ? 'W' : teamScore < opponentScore ? 'L' : 'D';

  return {
    teamScore,
    opponentScore,
    opponent,
    result,
    venue,
  };
}

function getTeamAbbrev(team: string): string {
  const parts = team.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.slice(0, 3).map((part) => part[0]).join('').toUpperCase();
}

function getTimeframeLabel(value: SoccerTimeframe): string {
  if (value === 'last5') return 'L5';
  if (value === 'last10') return 'L10';
  if (value === 'last20') return 'L20';
  if (value === 'last50') return 'L50';
  if (value === 'all') return 'ALL';
  return value.replace('season:', '');
}

function SoccerXAxisTick({ x, y, payload, data, isDark }: any) {
  const point = data?.find((item: SoccerChartRow) => item.xKey === payload.value) as SoccerChartRow | undefined;
  if (!point) return null;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={14}
        textAnchor="middle"
        fill={isDark ? '#cbd5e1' : '#475569'}
        fontSize={10}
        fontWeight={700}
      >
        {point.tickLabel}
      </text>
      <text
        x={0}
        y={0}
        dy={28}
        textAnchor="middle"
        fill={isDark ? '#94a3b8' : '#64748b'}
        fontSize={9}
        fontWeight={600}
      >
        {point.venue === 'HOME' ? 'H' : 'A'}
      </text>
    </g>
  );
}

function SoccerChartTooltip({ active, payload, coordinate, isDark, selectedStatLabel }: any) {
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
  const point = payload[0]?.payload as SoccerChartRow | undefined;
  if (!point) return null;

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
    const tooltipWidth = 240;
    const offsetX = 15;
    const offsetY = -10;
    let left = currentPosition.x + offsetX;
    if (left + tooltipWidth > viewportWidth - 10) left = viewportWidth - tooltipWidth - 10;
    return { left: `${left}px`, top: `${currentPosition.y + offsetY}px` };
  };

  const position = getTooltipPosition();
  const tooltipContent = (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{
        backgroundColor: isDark ? '#111827' : '#ffffff',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        color: isDark ? '#f9fafb' : '#111827',
        minWidth: isMobile ? '280px' : '220px',
        maxWidth: isMobile ? '90vw' : 'none',
        zIndex: 999999,
        pointerEvents: 'none',
        position: 'fixed',
        left: position.left,
        top: position.top,
        transform: 'none',
      }}
    >
      <div className="font-semibold">{point.opponent}</div>
      <div className="text-[11px] opacity-70">{point.gameDate}</div>
      <div className="mt-1">{point.result} · {point.scoreline}</div>
      <div className="mt-1">
        {selectedStatLabel}: <span className="font-semibold">{payload[0]?.value}</span>
        {point.comparisonValue ? <span className="opacity-70"> vs {point.comparisonValue}</span> : null}
      </div>
    </div>
  );

  const shouldRender = typeof window !== 'undefined' && active && (mousePosition ?? (isMobile && coordinate));
  if (shouldRender) {
    return createPortal(tooltipContent, document.body);
  }
  return null;
}

export function SoccerStatsChart({
  matches,
  selectedTeamName,
  isDark,
  onSelectedStatChange,
  onSelectedTimeframeChange,
  onSelectedTeamScopeChange,
}: SoccerStatsChartProps) {
  const [selectedStat, setSelectedStat] = useState('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<SoccerTimeframe>('last10');
  const [selectedStatTeamScope, setSelectedStatTeamScope] = useState<SoccerStatTeamScope>('all');
  const [lineValue, setLineValue] = useState(0);
  const [splitResultFilter, setSplitResultFilter] = useState<SoccerSplitResultFilter>('all');
  const [splitVenueFilter, setSplitVenueFilter] = useState<SoccerVenueFilter>('all');
  const [showSplitsFilters, setShowSplitsFilters] = useState(false);
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);

  const normalizedRows = useMemo(() => {
    return matches
      .map((match) => {
        const side = getSelectedTeamSide(match, selectedTeamName);
        if (!side) return null;

        const statMap: Record<string, number> = {};
        const homeStatMap: Record<string, number> = {};
        const awayStatMap: Record<string, number> = {};
        const comparisonMap: Record<string, string | null> = {};
        const labelMap: Record<string, string> = {};

        for (const stat of getMatchPeriodStats(match)) {
          const key = formatStatKey(stat.name);
          const homeValue = parseNumericValue(stat.homeValue);
          const awayValue = parseNumericValue(stat.awayValue);
          const value = getTeamValueForStat(match, selectedTeamName, stat);
          if (homeValue != null) homeStatMap[key] = homeValue;
          if (awayValue != null) awayStatMap[key] = awayValue;
          if (value == null) continue;
          statMap[key] = value;
          comparisonMap[key] = getOpponentValueForStat(match, selectedTeamName, stat);
          labelMap[key] = stat.name;
        }

        const kickoff = match.kickoffUnix != null ? new Date(match.kickoffUnix * 1000) : null;
        const gameSeason = kickoff?.getUTCFullYear() ?? 0;
        const gameDate = kickoff
          ? kickoff.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : 'Unknown date';
        const perspective = getSelectedTeamPerspective(match, selectedTeamName);
        statMap.total_goals = match.homeScore + match.awayScore;
        homeStatMap.total_goals = match.homeScore;
        awayStatMap.total_goals = match.awayScore;
        comparisonMap.total_goals = `${match.homeScore}-${match.awayScore}`;
        labelMap.total_goals = 'Total goals';

        return {
          match,
          side,
          gameSeason,
          gameDate,
          kickoffMs: kickoff?.getTime() ?? 0,
          ...perspective,
          statMap,
          homeStatMap,
          awayStatMap,
          comparisonMap,
          labelMap,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => a.kickoffMs - b.kickoffMs);
  }, [matches, selectedTeamName]);

  const statLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of normalizedRows) {
      for (const [key, label] of Object.entries(row.labelMap)) {
        if (!map.has(key)) map.set(key, label);
      }
    }
    return map;
  }, [normalizedRows]);

  const availableStats = useMemo(() => {
    const keys = new Set<string>();
    for (const row of normalizedRows) {
      for (const [key, value] of Object.entries(row.statMap)) {
        if (Number.isFinite(value)) keys.add(key);
      }
    }

    const ordered: string[] = [];
    for (const key of SOCCER_STAT_PRIORITY) {
      if (keys.has(key)) ordered.push(key);
    }
    for (const key of keys) {
      if (!ordered.includes(key)) ordered.push(key);
    }
    return ordered;
  }, [normalizedRows]);

  useEffect(() => {
    if (!availableStats.length) {
      setSelectedStat('');
      return;
    }
    if (selectedStat && availableStats.includes(selectedStat)) return;
    setSelectedStat(availableStats[0]);
  }, [availableStats, selectedStat]);

  useEffect(() => {
    if (selectedStat) onSelectedStatChange?.(selectedStat);
  }, [selectedStat, onSelectedStatChange]);

  const statSupportsTeamScope = useMemo(() => {
    if (!selectedStat) return false;
    return normalizedRows.some((row) => {
      const homeValue = row.homeStatMap[selectedStat];
      const awayValue = row.awayStatMap[selectedStat];
      return Number.isFinite(homeValue) || Number.isFinite(awayValue);
    });
  }, [normalizedRows, selectedStat]);

  const statTeamScopeOptions = useMemo(() => {
    if (selectedStat === 'ball_possession') {
      return [
        { key: 'home' as const, label: 'Home' },
        { key: 'away' as const, label: 'Away' },
      ];
    }

    return [
      { key: 'all' as const, label: 'All' },
      { key: 'home' as const, label: 'Home' },
      { key: 'away' as const, label: 'Away' },
    ];
  }, [selectedStat]);

  useEffect(() => {
    if (!selectedStat) return;
    setSelectedStatTeamScope(statTeamScopeOptions[0].key);
  }, [selectedStat, statTeamScopeOptions]);

  useEffect(() => {
    if (!statSupportsTeamScope) {
      setSelectedStatTeamScope('all');
      return;
    }

    if (!statTeamScopeOptions.some((option) => option.key === selectedStatTeamScope)) {
      setSelectedStatTeamScope(statTeamScopeOptions[0].key);
    }
  }, [selectedStatTeamScope, statSupportsTeamScope, statTeamScopeOptions]);

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      const el = timeframeDropdownRef.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) {
        setIsTimeframeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const filteredRows = useMemo(() => {
    return normalizedRows.filter((row) => {
      if (splitResultFilter === 'wins' && row.result !== 'W') return false;
      if (splitResultFilter === 'losses' && row.result !== 'L') return false;
      if (splitResultFilter === 'draws' && row.result !== 'D') return false;
      if (splitVenueFilter !== 'all' && row.venue !== splitVenueFilter) return false;
      return true;
    });
  }, [normalizedRows, splitResultFilter, splitVenueFilter]);

  const seasonOptions = useMemo(() => {
    const years = [...new Set(filteredRows.map((row) => row.gameSeason).filter((year) => year >= 2008))].sort((a, b) => b - a);
    return years.map((year) => `season:${year}` as SoccerTimeframe);
  }, [filteredRows]);

  const timeframeOptions = useMemo(() => {
    return ['last5', 'last10', 'last20', 'last50', 'all', ...seasonOptions] as SoccerTimeframe[];
  }, [seasonOptions]);

  useEffect(() => {
    if (!timeframeOptions.includes(selectedTimeframe)) {
      setSelectedTimeframe('last10');
    }
  }, [timeframeOptions, selectedTimeframe]);

  useEffect(() => {
    onSelectedTimeframeChange?.(selectedTimeframe);
  }, [selectedTimeframe, onSelectedTimeframeChange]);

  useEffect(() => {
    onSelectedTeamScopeChange?.(selectedStatTeamScope);
  }, [onSelectedTeamScopeChange, selectedStatTeamScope]);

  const baseChartData = useMemo(() => {
    if (!selectedStat) return [];
    return filteredRows
      .map((row, idx) => {
        const homeValue = row.homeStatMap[selectedStat];
        const awayValue = row.awayStatMap[selectedStat];
        let value: number | null = null;
        let comparisonValue: string | null = null;

        if (selectedStatTeamScope === 'all') {
          if (Number.isFinite(homeValue) && Number.isFinite(awayValue)) {
            value = homeValue + awayValue;
            comparisonValue = `${homeValue}-${awayValue}`;
          } else if (Number.isFinite(row.statMap[selectedStat])) {
            value = row.statMap[selectedStat];
            comparisonValue = row.comparisonMap[selectedStat] ?? null;
          }
        } else if (selectedStatTeamScope === 'home') {
          if (Number.isFinite(homeValue)) {
            value = homeValue;
            comparisonValue = Number.isFinite(awayValue) ? String(awayValue) : null;
          }
        } else if (selectedStatTeamScope === 'away') {
          if (Number.isFinite(awayValue)) {
            value = awayValue;
            comparisonValue = Number.isFinite(homeValue) ? String(homeValue) : null;
          }
        }

        if (!Number.isFinite(value)) return null;

        return {
          key: `${row.match.matchId}-${idx}`,
          xKey: `${row.match.matchId}-${idx}`,
          tickLabel: getTeamAbbrev(row.opponent),
          opponent: row.opponent,
          result: row.result,
          venue: row.venue,
          value: value as number,
          comparisonValue,
          gameDate: row.gameDate,
          scoreline: `${row.teamScore}-${row.opponentScore}`,
          sourceMatch: row.match,
          gameSeason: row.gameSeason,
        } satisfies SoccerChartRow;
      })
      .filter((row): row is SoccerChartRow => row != null);
  }, [filteredRows, selectedStat, selectedStatTeamScope]);

  const chartData = useMemo(() => {
    if (selectedTimeframe === 'all') return baseChartData;
    if (selectedTimeframe.startsWith('season:')) {
      const year = Number.parseInt(selectedTimeframe.replace('season:', ''), 10);
      return baseChartData.filter((row) => row.gameSeason === year);
    }
    const lastN = Number.parseInt(selectedTimeframe.replace('last', ''), 10);
    if (!Number.isFinite(lastN) || lastN <= 0) return baseChartData;
    return baseChartData.slice(-lastN);
  }, [baseChartData, selectedTimeframe]);

  const statAverage = useMemo(() => {
    if (!baseChartData.length) return 0;
    return baseChartData.reduce((sum, row) => sum + row.value, 0) / baseChartData.length;
  }, [baseChartData]);

  useEffect(() => {
    setLineValue(Number.isFinite(statAverage) ? Math.round(statAverage) : 0);
  }, [selectedStat, selectedStatTeamScope, statAverage]);

  const yAxisConfig = useMemo(() => {
    const values = chartData.map((row) => row.value).filter((value) => Number.isFinite(value));
    if (!values.length) return { domain: [0, 10] as [number, number], ticks: [0, 3, 7, 10] };

    const minValue = Math.min(...values, lineValue);
    const maxValue = Math.max(...values, lineValue);
    const hasDecimals = values.some((value) => Math.abs(value - Math.round(value)) > 0.001) || Math.abs(lineValue - Math.round(lineValue)) > 0.001;

    if (minValue < 0) {
      const bound = Math.max(Math.ceil(Math.max(Math.abs(minValue), Math.abs(maxValue))), 1);
      const step = bound / 2;
      const ticks = [-bound, -step, 0, step, bound].map((value) =>
        hasDecimals ? Math.round(value * 10) / 10 : Math.round(value)
      );
      return {
        domain: [-bound, bound] as [number, number],
        ticks,
      };
    }

    const bound = Math.max(hasDecimals ? Math.ceil(maxValue * 10) / 10 : Math.ceil(maxValue), 1);
    const step = bound / 3;
    const ticks = [0, step, step * 2, bound].map((value) =>
      hasDecimals ? Math.round(value * 10) / 10 : Math.round(value)
    );

    return {
      domain: [0, bound] as [number, number],
      ticks,
    };
  }, [chartData, lineValue]);

  const customTooltip = useMemo(() => {
    const selectedStatLabel = statLabels.get(selectedStat) || formatStatLabel(selectedStat || 'stat');
    return (props: any) => <SoccerChartTooltip {...props} isDark={isDark} selectedStatLabel={selectedStatLabel} />;
  }, [isDark, selectedStat, statLabels]);

  const soccerXAxisTick = useMemo(() => <SoccerXAxisTick data={chartData} isDark={isDark} />, [chartData, isDark]);

  if (!selectedTeamName) {
    return (
      <div className="h-full w-full flex items-center justify-center p-4 text-sm text-gray-500 dark:text-gray-400">
        Select a team to load the chart.
      </div>
    );
  }

  if (!availableStats.length) {
    return (
      <div className="h-full w-full flex items-center justify-center p-4 text-sm text-gray-500 dark:text-gray-400">
        No chartable Soccerway team stats were returned for this team.
      </div>
    );
  }

  return (
    <div className="h-full w-full pt-3 pb-2 flex flex-col px-0 sm:px-1 md:px-2">
      <div className="mb-4 sm:mb-5 md:mb-4 mt-0 w-full max-w-full">
        <div
          className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
            {availableStats.map((key) => (
              <StatPill
                key={key}
                label={statLabels.get(key) || formatStatLabel(key)}
                value={key}
                isSelected={selectedStat === key}
                onSelect={setSelectedStat}
                isDark={isDark}
                darker
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 sm:space-y-3 md:space-y-4 mb-2 sm:mb-3 md:mb-4 lg:mb-6">
        <div className="flex items-center flex-wrap gap-1 sm:gap-2 md:gap-3 pl-0 sm:pl-0 ml-0 sm:ml-1">
          <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
            <input
              id="soccer-betting-line-input"
              key={`soccer-line-${selectedStat}`}
              type="number"
            step={1}
              value={lineValue}
              min={yAxisConfig.domain[0]}
              max={yAxisConfig.domain[1]}
              onChange={(e) => {
                const next = Number(e.target.value);
              if (Number.isFinite(next)) setLineValue(Math.round(next));
              }}
              className="w-20 sm:w-20 md:w-22 px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              aria-label={`Set line value for ${statLabels.get(selectedStat) || formatStatLabel(selectedStat)}`}
            />
            <div className="relative" ref={timeframeDropdownRef}>
              <button
                type="button"
                onClick={() => setIsTimeframeDropdownOpen((prev) => !prev)}
                className="w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                <span className="truncate">{getTimeframeLabel(selectedTimeframe)}</span>
                <svg className="w-3 h-3 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isTimeframeDropdownOpen ? (
                <div className="absolute top-full right-0 mt-1 w-20 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {timeframeOptions.map((timeframe) => (
                    <button
                      key={timeframe}
                      type="button"
                      onClick={() => {
                        setSelectedTimeframe(timeframe);
                        setIsTimeframeDropdownOpen(false);
                      }}
                      className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg ${
                        selectedTimeframe === timeframe
                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {getTimeframeLabel(timeframe)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {statSupportsTeamScope ? (
            <div className="flex basis-full justify-center sm:flex-1">
              <div className="flex items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] p-0.5">
                {statTeamScopeOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSelectedStatTeamScope(option.key)}
                    className={`px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md transition-colors ${
                      selectedStatTeamScope === option.key
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setShowSplitsFilters((prev) => !prev)}
            className={`w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 text-center flex items-center justify-center flex-shrink-0 relative sm:ml-auto ${
              showSplitsFilters ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 shadow-[0_0_15px_rgba(139,92,246,0.5)] dark:shadow-[0_0_15px_rgba(139,92,246,0.7)]' : ''
            }`}
          >
            Splits
          </button>
        </div>
      </div>

      {showSplitsFilters ? (
        <div className="mb-2 px-2 lg:-mt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Result</span>
            {([
              { key: 'all', label: 'All' },
              { key: 'wins', label: 'Wins' },
              { key: 'losses', label: 'Losses' },
              { key: 'draws', label: 'Draws' },
            ] as const).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSplitResultFilter(option.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  splitResultFilter === option.key
                    ? 'bg-purple-600 text-white border-purple-400/30'
                    : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {option.label}
              </button>
            ))}

            <div className="flex items-center gap-1.5 w-full lg:w-auto lg:ml-auto">
              {([
                { key: 'all', label: 'All Venues' },
                { key: 'HOME', label: 'Home' },
                { key: 'AWAY', label: 'Away' },
              ] as const).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSplitVenueFilter(option.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    splitVenueFilter === option.key
                      ? 'bg-purple-600 text-white border-purple-400/30'
                      : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 relative">
        {chartData.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">No stats match selected filters</p>
          </div>
        ) : (
          <SimpleChart
            key={`soccer-chart-${selectedStat}`}
            chartData={chartData}
            yAxisConfig={yAxisConfig}
            isDark={isDark}
            bettingLine={lineValue}
            selectedStat={selectedStat}
            selectedTimeframe={selectedTimeframe}
            customTooltip={customTooltip}
            customXAxisTick={soccerXAxisTick}
            yAxisTickFormatter={(value: number) => `${Math.round(value)}`}
            yAxisTickStyle={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            preservePrimaryYAxisTicks={true}
            centerAverageOverlay={true}
            averageOverlayLowerOnMobile={true}
            desktopChartLeftInset={40}
            desktopChartRightInset={8}
            desktopChartRightMargin={8}
            yAxisWidth={34}
          />
        )}
      </div>
    </div>
  );
}
