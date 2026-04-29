'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

export type SoccerTimeframe = 'last5' | 'last10' | 'last20' | 'last50' | 'all' | `season:${number}`;
type SoccerVenueFilter = 'all' | 'HOME' | 'AWAY';
type SoccerMatchVenue = Exclude<SoccerVenueFilter, 'all'>;
export type SoccerStatTeamScope = 'all' | 'team' | 'opp';

type SoccerChartRow = {
  key: string;
  xKey: string;
  tickLabel: string;
  tickDateLabel: string;
  opponent: string;
  opponentLogoUrl: string | null;
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
  onSelectedCompetitionChange?: (competition: string) => void;
};

export const SOCCER_STAT_PRIORITY = [
  'moneyline',
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

export const SOCCER_TOP_STAT_PRIORITY = [
  'moneyline',
  'total_goals',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'blocked_shots',
  'big_chances',
  'corner_kicks',
  'yellow_cards',
  'red_cards',
  'fouls',
  'free_kicks',
  'touches_in_opposition_box',
  'tackles',
  'goalkeeper_saves',
  'shots_inside_the_box',
  'shots_outside_the_box',
] as const;

export const SOCCER_BETTABLE_STATS = new Set([
  'moneyline',
  'total_goals',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'blocked_shots',
  'big_chances',
  'corner_kicks',
  'yellow_cards',
  'red_cards',
  'fouls',
  'free_kicks',
  'touches_in_opposition_box',
  'tackles',
  'goalkeeper_saves',
  'shots_inside_the_box',
  'shots_outside_the_box',
]);

function normalizeTeamName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
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
  if (label === 'moneyline') return 'H2H';
  if (label === 'total_goals') return 'Total goals';
  if (label === 'expected_goals_xg') return 'xG';
  if (label === 'xg_on_target_xgot') return 'xGOT';
  if (label === 'expected_assists_xa') return 'xA';
  return label
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function roundToSoccerHalfStep(value: number): number {
  return Math.round(value * 2) / 2;
}

function formatSoccerAxisValue(value: number): string {
  return `${Math.round(value)}`;
}

function buildPositiveIntegerAxis(maxValue: number): { domain: [number, number]; ticks: number[] } {
  const safeMax = Math.max(1, Math.ceil(maxValue));
  let bestOption: { bound: number; intervals: number; padding: number } | null = null;

  for (const intervals of [4, 3, 2]) {
    const bound = Math.max(intervals, Math.ceil(safeMax / intervals) * intervals);
    const padding = bound - safeMax;
    if (
      !bestOption ||
      padding < bestOption.padding ||
      (padding === bestOption.padding && intervals > bestOption.intervals)
    ) {
      bestOption = { bound, intervals, padding };
    }
  }

  const selected = bestOption ?? { bound: 2, intervals: 2, padding: 0 };
  const step = selected.bound / selected.intervals;
  return {
    domain: [0, selected.bound],
    ticks: Array.from({ length: selected.intervals + 1 }, (_, index) => index * step),
  };
}

function buildSymmetricIntegerAxis(maxAbsValue: number): { domain: [number, number]; ticks: number[] } {
  const safeMax = Math.max(1, Math.ceil(maxAbsValue));
  let bestOption: { bound: number; halfIntervals: number; padding: number } | null = null;

  for (const halfIntervals of [2, 1]) {
    const step = Math.max(1, Math.ceil(safeMax / halfIntervals));
    const bound = step * halfIntervals;
    const padding = bound - safeMax;
    if (
      !bestOption ||
      padding < bestOption.padding ||
      (padding === bestOption.padding && halfIntervals > bestOption.halfIntervals)
    ) {
      bestOption = { bound, halfIntervals, padding };
    }
  }

  const selected = bestOption ?? { bound: 1, halfIntervals: 1, padding: 0 };
  const step = selected.bound / selected.halfIntervals;
  const ticks: number[] = [];
  for (let value = -selected.bound; value <= selected.bound; value += step) {
    ticks.push(value);
  }

  return {
    domain: [-selected.bound, selected.bound],
    ticks,
  };
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
  const opponentLogoUrl = side === 'away' ? match.homeLogoUrl ?? null : match.awayLogoUrl ?? null;
  const venue: SoccerMatchVenue = side === 'away' ? 'AWAY' : 'HOME';
  const result = teamScore > opponentScore ? 'W' : teamScore < opponentScore ? 'L' : 'D';

  return {
    teamScore,
    opponentScore,
    opponent,
    opponentLogoUrl,
    result,
    venue,
  };
}

function getTeamAbbrev(team: string): string {
  const parts = team.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.slice(0, 3).map((part) => part[0]).join('').toUpperCase();
}

function getCompetitionLabel(match: SoccerwayRecentMatch): string {
  const competition = String(match.competitionName || '').trim();
  if (competition) return competition;
  const country = String(match.competitionCountry || '').trim();
  if (country) return country;
  return 'Unknown competition';
}

function getCompetitionKey(match: SoccerwayRecentMatch): string {
  const country = String(match.competitionCountry || '').trim();
  const competition = String(match.competitionName || '').trim();
  return `${country}:::${competition}`;
}

function getTimeframeLabel(value: SoccerTimeframe): string {
  if (value === 'last5') return 'L5';
  if (value === 'last10') return 'L10';
  if (value === 'last20') return 'L20';
  if (value === 'last50') return 'L50';
  if (value === 'all') return 'ALL';
  return value.replace('season:', '');
}

function shouldHideSoccerTickDetails(timeframe: SoccerTimeframe): boolean {
  return timeframe === 'last50' || timeframe === 'all' || timeframe.startsWith('season:');
}

function shouldHideSoccerVenueMarker(timeframe: SoccerTimeframe): boolean {
  return timeframe === 'all';
}

function formatTickDate(kickoffUnix: number | null): string {
  if (kickoffUnix == null) return '';
  return new Date(kickoffUnix * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getSoccerSeasonYear(kickoff: Date | null): number {
  if (!kickoff) return 0;
  const month = kickoff.getUTCMonth();
  const year = kickoff.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function SoccerXAxisTick({ x, y, payload, data, isDark, hideTickDetails, hideVenueMarker }: any) {
  const point = data?.find((item: SoccerChartRow) => item.xKey === payload.value) as SoccerChartRow | undefined;
  if (!point) return null;

  return (
    <g transform={`translate(${x},${y})`}>
      {!hideTickDetails && point.opponentLogoUrl ? (
        <image
          href={point.opponentLogoUrl}
          x={-10}
          y={4}
          width={20}
          height={20}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : !hideTickDetails ? (
        <text
          x={0}
          y={0}
          dy={18}
          textAnchor="middle"
          fill={isDark ? '#cbd5e1' : '#475569'}
          fontSize={10}
          fontWeight={700}
        >
          {point.tickLabel}
        </text>
      ) : null}
      {!hideVenueMarker ? (
        <text
          x={0}
          y={0}
          dy={!hideTickDetails && point.opponentLogoUrl ? 36 : !hideTickDetails ? 34 : 18}
          textAnchor="middle"
          fill={isDark ? '#c084fc' : '#9333ea'}
          fontSize={9}
          fontWeight={700}
        >
          {point.venue === 'HOME' ? 'H' : 'A'}
        </text>
      ) : null}
      {!hideTickDetails ? (
        <text
          x={0}
          y={0}
          dy={50}
          textAnchor="middle"
          fill={isDark ? '#94a3b8' : '#64748b'}
          fontSize={9}
          fontWeight={600}
        >
          {point.tickDateLabel}
        </text>
      ) : null}
    </g>
  );
}

function SoccerChartTooltip({ active, payload, coordinate, isDark, selectedStatLabel, selectedStatKey }: any) {
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
  const displayValue =
    selectedStatKey === 'moneyline'
      ? point.result === 'D' ? '0' : point.result
      : payload[0]?.value;

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
        {selectedStatLabel}: <span className="font-semibold">{displayValue}</span>
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

export const SoccerStatsChart = memo(function SoccerStatsChart({
  matches,
  selectedTeamName,
  isDark,
  onSelectedStatChange,
  onSelectedTimeframeChange,
  onSelectedTeamScopeChange,
  onSelectedCompetitionChange,
}: SoccerStatsChartProps) {
  const [selectedStat, setSelectedStat] = useState('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<SoccerTimeframe>('last10');
  const [selectedStatTeamScope, setSelectedStatTeamScope] = useState<SoccerStatTeamScope>('team');
  const [selectedCompetition, setSelectedCompetition] = useState('all');
  const [lineValue, setLineValue] = useState(0);
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const [isCompetitionDropdownOpen, setIsCompetitionDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const competitionDropdownRef = useRef<HTMLDivElement>(null);

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
        const opponentStatMap: Record<string, number> = {};

        for (const stat of getMatchPeriodStats(match)) {
          const key = formatStatKey(stat.name);
          const homeValue = parseNumericValue(stat.homeValue);
          const awayValue = parseNumericValue(stat.awayValue);
          const value = getTeamValueForStat(match, selectedTeamName, stat);
          const opponentValue = side === 'away' ? homeValue : awayValue;
          if (homeValue != null) homeStatMap[key] = homeValue;
          if (awayValue != null) awayStatMap[key] = awayValue;
          if (value == null) continue;
          statMap[key] = value;
          if (opponentValue != null) opponentStatMap[key] = opponentValue;
          comparisonMap[key] = getOpponentValueForStat(match, selectedTeamName, stat);
          labelMap[key] = stat.name;
        }

        const kickoff = match.kickoffUnix != null ? new Date(match.kickoffUnix * 1000) : null;
        const gameSeason = getSoccerSeasonYear(kickoff);
        const gameDate = kickoff
          ? kickoff.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : 'Unknown date';
        const perspective = getSelectedTeamPerspective(match, selectedTeamName);
        statMap.total_goals = perspective.teamScore;
        opponentStatMap.total_goals = perspective.opponentScore;
        homeStatMap.total_goals = match.homeScore;
        awayStatMap.total_goals = match.awayScore;
        comparisonMap.total_goals = `${match.homeScore}-${match.awayScore}`;
        labelMap.total_goals = 'Total goals';
        statMap.moneyline = perspective.result === 'W' ? 1 : perspective.result === 'L' ? -1 : 0;
        opponentStatMap.moneyline = perspective.result === 'W' ? -1 : perspective.result === 'L' ? 1 : 0;
        comparisonMap.moneyline = null;
        labelMap.moneyline = 'H2H';

        return {
          match,
          side,
          gameSeason,
          gameDate,
          kickoffMs: kickoff?.getTime() ?? 0,
          competitionKey: getCompetitionKey(match),
          competitionLabel: getCompetitionLabel(match),
          ...perspective,
          statMap,
          opponentStatMap,
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
        if (Number.isFinite(value) && SOCCER_BETTABLE_STATS.has(key)) keys.add(key);
      }
    }

    const ordered: string[] = [];
    for (const key of SOCCER_TOP_STAT_PRIORITY) {
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
      const teamValue = row.statMap[selectedStat];
      const opponentValue = row.opponentStatMap[selectedStat];
      return Number.isFinite(teamValue) || Number.isFinite(opponentValue);
    });
  }, [normalizedRows, selectedStat]);

  const statTeamScopeOptions = useMemo(() => {
    return [
      { key: 'team' as const, label: selectedTeamName || 'Team' },
      { key: 'all' as const, label: 'Combined' },
      { key: 'opp' as const, label: 'Opp' },
    ];
  }, [selectedTeamName]);

  useEffect(() => {
    if (!selectedStat) return;
    setSelectedStatTeamScope('team');
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
      const timeframeEl = timeframeDropdownRef.current;
      if (timeframeEl && event.target instanceof Node && !timeframeEl.contains(event.target)) {
        setIsTimeframeDropdownOpen(false);
      }
      const competitionEl = competitionDropdownRef.current;
      if (competitionEl && event.target instanceof Node && !competitionEl.contains(event.target)) {
        setIsCompetitionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const competitionOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const row of normalizedRows) {
      const existing = counts.get(row.competitionKey);
      if (existing) existing.count += 1;
      else counts.set(row.competitionKey, { label: row.competitionLabel, count: 1 });
    }
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
  }, [normalizedRows]);

  useEffect(() => {
    if (selectedCompetition === 'all') return;
    if (competitionOptions.some((option) => option.key === selectedCompetition)) return;
    setSelectedCompetition('all');
  }, [competitionOptions, selectedCompetition]);

  const filteredRows = useMemo(() => {
    if (selectedCompetition === 'all') return normalizedRows;
    return normalizedRows.filter((row) => row.competitionKey === selectedCompetition);
  }, [normalizedRows, selectedCompetition]);

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

  useEffect(() => {
    onSelectedCompetitionChange?.(selectedCompetition);
  }, [onSelectedCompetitionChange, selectedCompetition]);

  const selectedCompetitionLabel = useMemo(() => {
    if (selectedCompetition === 'all') return 'All comps';
    return competitionOptions.find((option) => option.key === selectedCompetition)?.label ?? 'Competition';
  }, [competitionOptions, selectedCompetition]);

  const baseChartData = useMemo(() => {
    if (!selectedStat) return [];
    return filteredRows
      .map((row, idx) => {
        const homeValue = row.homeStatMap[selectedStat];
        const awayValue = row.awayStatMap[selectedStat];
        const teamValue = row.statMap[selectedStat];
        const opponentValue = row.opponentStatMap[selectedStat];
        let value: number | null = null;
        let comparisonValue: string | null = null;

        if (selectedStatTeamScope === 'all') {
          if (Number.isFinite(homeValue) && Number.isFinite(awayValue)) {
            value = homeValue + awayValue;
            comparisonValue = `${homeValue}-${awayValue}`;
          } else if (Number.isFinite(teamValue)) {
            value = teamValue;
            comparisonValue = row.comparisonMap[selectedStat] ?? null;
          }
        } else if (selectedStatTeamScope === 'team') {
          if (Number.isFinite(teamValue)) {
            value = teamValue;
            comparisonValue = Number.isFinite(opponentValue) ? String(opponentValue) : null;
          }
        } else if (selectedStatTeamScope === 'opp') {
          if (Number.isFinite(opponentValue)) {
            value = opponentValue;
            comparisonValue = Number.isFinite(teamValue) ? String(teamValue) : null;
          }
        }

        if (!Number.isFinite(value)) return null;

        return {
          key: `${row.match.matchId}-${idx}`,
          xKey: `${row.match.matchId}-${idx}`,
          tickLabel: getTeamAbbrev(row.opponent),
          tickDateLabel: formatTickDate(row.match.kickoffUnix),
          opponent: row.opponent,
          opponentLogoUrl: row.opponentLogoUrl,
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

  useEffect(() => {
    setLineValue(0.5);
  }, [selectedStat, selectedStatTeamScope]);

  const yAxisConfig = useMemo(() => {
    if (selectedStat === 'moneyline') {
      return {
        // Add a little extra room below losses so the -1 bar
        // doesn't sit flush with the bottom edge of the plot.
        domain: [-1.12, 1] as [number, number],
        ticks: [-1, 0, 1],
      };
    }

    const values = chartData.map((row) => row.value).filter((value) => Number.isFinite(value));
    if (!values.length) return buildPositiveIntegerAxis(4);

    const minValue = Math.min(...values, lineValue);
    const maxValue = Math.max(...values, lineValue);
    if (minValue < 0) {
      return buildSymmetricIntegerAxis(Math.max(Math.abs(minValue), Math.abs(maxValue)));
    }

    return buildPositiveIntegerAxis(maxValue);
  }, [chartData, lineValue, selectedStat]);

  const lineInputBounds = useMemo(() => {
    if (selectedStat === 'moneyline') {
      return { min: -1, max: 1 };
    }
    return { min: yAxisConfig.domain[0], max: yAxisConfig.domain[1] };
  }, [selectedStat, yAxisConfig]);

  const customTooltip = useMemo(() => {
    const selectedStatLabel = statLabels.get(selectedStat) || formatStatLabel(selectedStat || 'stat');
    return (props: any) => (
      <SoccerChartTooltip
        {...props}
        isDark={isDark}
        selectedStatLabel={selectedStatLabel}
        selectedStatKey={selectedStat}
      />
    );
  }, [isDark, selectedStat, statLabels]);

  const hideTickDetails = useMemo(() => shouldHideSoccerTickDetails(selectedTimeframe), [selectedTimeframe]);
  const hideVenueMarker = useMemo(() => shouldHideSoccerVenueMarker(selectedTimeframe), [selectedTimeframe]);
  const soccerXAxisTick = useMemo(
    () => <SoccerXAxisTick data={chartData} isDark={isDark} hideTickDetails={hideTickDetails} hideVenueMarker={hideVenueMarker} />,
    [chartData, hideTickDetails, hideVenueMarker, isDark]
  );

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
              step={0.5}
              value={lineValue}
              min={lineInputBounds.min}
              max={lineInputBounds.max}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) {
                  setLineValue(roundToSoccerHalfStep(next));
                }
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
          <div className="relative sm:ml-auto" ref={competitionDropdownRef}>
            <button
              type="button"
              onClick={() => setIsCompetitionDropdownOpen((prev) => !prev)}
              className={`w-36 sm:w-40 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600 ${
                isCompetitionDropdownOpen ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 shadow-[0_0_15px_rgba(139,92,246,0.5)] dark:shadow-[0_0_15px_rgba(139,92,246,0.7)]' : ''
              }`}
            >
              <span className="truncate">{selectedCompetitionLabel}</span>
              <svg className="w-3 h-3 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isCompetitionDropdownOpen ? (
              <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                {[
                  { key: 'all', label: `All competitions (${normalizedRows.length})` },
                  ...competitionOptions.map((option) => ({
                    key: option.key,
                    label: `${option.label} (${option.count})`,
                  })),
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      setSelectedCompetition(option.key);
                      setIsCompetitionDropdownOpen(false);
                    }}
                    className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg ${
                      selectedCompetition === option.key
                        ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

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
            yAxisTickFormatter={(value: number) => {
              if (selectedStat === 'moneyline') {
                if (value >= 1) return 'W';
                if (value <= -1) return 'L';
                return '0';
              }
              return formatSoccerAxisValue(value);
            }}
            yAxisTickStyle={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            preservePrimaryYAxisTicks={true}
            centerAverageOverlay={true}
            averageOverlayLowerOnMobile={true}
            desktopChartLeftInset={40}
            desktopChartRightInset={8}
            desktopChartRightMargin={8}
            yAxisWidth={34}
            xAxisHeight={hideTickDetails ? 28 : 56}
            chartBottomMargin={8}
            hideBarValueLabels={selectedTimeframe === 'all'}
          />
        )}
      </div>
    </div>
  );
});
