'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import { canonicalSoccerStatKey, readPlayerMatchStatNumber } from '@/lib/soccerStatKeyAliases';
import type { PlayerMatchStats } from '@/lib/soccerPlayerStatsScrape';
import type {
  SoccerPlayerChartTimeframe,
  SoccerPlayerPropsChartSnapshot,
} from '@/app/soccer/components/soccerPlayerPropsTypes';
import { buildOutfieldMainChartTiles } from '@/app/soccer/components/soccerPlayerStatCatalog';

type PlayerPropsResponse = {
  success?: boolean;
  error?: string;
  player?: string;
  matches?: PlayerMatchStats[];
};

type SoccerPlayerPropsTestCardProps = {
  teamHref: string | null;
  /** Squad slug from cached batch (e.g. haaland-erling). Required before any fetch runs. */
  playerKey?: string | null;
  /** Display name for player-stats matching; recommended when playerKey is set. */
  displayName?: string | null;
  nextOpponentName?: string | null;
  isDark: boolean;
  emptyTextClass: string;
  onChartSnapshotChange?: (snapshot: SoccerPlayerPropsChartSnapshot) => void;
};

type PlayerStatCategory = keyof PlayerMatchStats['categories'];
type StatTile = {
  id: string;
  label: string;
  category: PlayerStatCategory;
  key: string;
};

const DEFAULT_MAIN_STAT_TILE: StatTile = {
  id: 'general:goals',
  label: 'Goals',
  category: 'general',
  key: 'goals',
};

const TIMEFRAME_OPTIONS = ['last5', 'last10', 'last20', 'last50', 'h2h', 'thisSeason', 'lastSeason', 'all'] as const;

type ChartTimeframe = SoccerPlayerChartTimeframe;

function parseLeadingNumber(value: string | null | undefined): number | null {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number.parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatMatchDate(kickoffUnix: number | null): string {
  if (!kickoffUnix) return '-';
  return new Date(kickoffUnix * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTickDate(kickoffUnix: number | null): string {
  if (!kickoffUnix) return '';
  return new Date(kickoffUnix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getTeamAbbrev(team: string): string {
  const parts = team.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.slice(0, 3).map((part) => part[0]).join('').toUpperCase();
}

function getCompetitionKey(match: PlayerMatchStats): string {
  return `${String(match.competitionCountry || '').trim()}:::${String(match.competitionName || '').trim()}`;
}

function getCompetitionLabel(match: PlayerMatchStats): string {
  const competition = String(match.competitionName || '').trim();
  if (competition) return competition;
  const country = String(match.competitionCountry || '').trim();
  if (country) return country;
  return 'Unknown competition';
}

function getTimeframeLabel(value: ChartTimeframe): string {
  if (value === 'last5') return 'L5';
  if (value === 'last10') return 'L10';
  if (value === 'last20') return 'L20';
  if (value === 'last50') return 'L50';
  if (value === 'h2h') return 'H2H';
  if (value === 'thisSeason') return 'This season';
  if (value === 'lastSeason') return 'Last season';
  return 'ALL';
}

function getSoccerSeasonYear(kickoff: Date | null): number {
  if (!kickoff) return 0;
  const month = kickoff.getUTCMonth();
  const year = kickoff.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function normalizeOpponentName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function opponentNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeOpponentName(a);
  const right = normalizeOpponentName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function buildPositiveAxis(values: number[], lineValue: number): { domain: [number, number]; ticks: number[] } {
  const maxValue = Math.max(...values, lineValue, 1);
  const max = Math.max(Math.ceil(maxValue / 5) * 5, 5);
  const step = max / 3;
  const hasDecimals = values.some((value) => Math.abs(value - Math.round(value)) > 0.001) || Math.abs(lineValue - Math.round(lineValue)) > 0.001;
  return {
    domain: [0, max],
    ticks: [0, step, step * 2, max].map((value) => (hasDecimals ? Math.round(value * 10) / 10 : Math.round(value))),
  };
}

function SoccerPlayerChartTooltip({
  active,
  payload,
  coordinate,
  isDark,
  statLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  coordinate?: { x?: number; y?: number };
  isDark: boolean;
  statLabel: string;
}) {
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
  const point = payload[0]?.payload ?? {};
  const value = typeof point.value === 'number' ? point.value : null;

  const getTooltipPosition = () => {
    const currentPosition = mousePosition ?? (coordinate?.x != null && coordinate?.y != null ? { x: coordinate.x, y: coordinate.y } : null);
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
      <div className="font-semibold">{String(point.opponent || '-')}</div>
      <div className="text-[11px] opacity-70">{String(point.gameDate || '-')}</div>
      <div className="mt-1">
        {String(point.result || '')} · {String(point.scoreline || '')}
      </div>
      <div className="mt-1">
        {statLabel}: <span className="font-semibold">{value == null ? '-' : value}</span>
      </div>
    </div>
  );

  const shouldRender = typeof window !== 'undefined' && active && (mousePosition ?? (isMobile && coordinate));
  if (shouldRender) {
    return createPortal(tooltipContent, document.body);
  }
  return null;
}

function SoccerPlayerXAxisTick({ x, y, payload, data, isDark, hideTickDetails }: any) {
  const point = data?.find((item: Record<string, unknown>) => item.xKey === payload.value);
  if (!point) return null;

  return (
    <g transform={`translate(${x},${y})`}>
      {!hideTickDetails && typeof point.opponentLogoUrl === 'string' && point.opponentLogoUrl ? (
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
          {String(point.tickLabel || '')}
        </text>
      ) : null}
      <text
        x={0}
        y={0}
        dy={!hideTickDetails && typeof point.opponentLogoUrl === 'string' && point.opponentLogoUrl ? 36 : !hideTickDetails ? 34 : 18}
        textAnchor="middle"
        fill={isDark ? '#c084fc' : '#9333ea'}
        fontSize={9}
        fontWeight={700}
      >
        {point.venue === 'HOME' ? 'H' : 'A'}
      </text>
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
          {String(point.tickDateLabel || '')}
        </text>
      ) : null}
    </g>
  );
}

const PLAYER_KEY_PARAM_RE = /^[a-z0-9-]{2,80}$/;

// v2: switched from `top`-only to full-category (all 7 Soccerway tabs) payloads. Bump invalidates stale top-only entries.
const PLAYER_PROPS_CHART_CACHE_PREFIX = 'soccer-player-props-chart:v2:';

function normalizeChartCacheHref(raw: string): string {
  const href = String(raw || '').trim();
  if (!href) return '';
  return (href.startsWith('/') ? href : `/${href}`).replace(/\/+$/, '');
}

function readPlayerPropsChartCache(href: string, playerKey: string): PlayerMatchStats[] | null {
  if (typeof window === 'undefined') return null;
  const h = normalizeChartCacheHref(href);
  const pk = String(playerKey || '').trim().toLowerCase();
  if (!h || !pk) return null;
  try {
    const raw = window.sessionStorage.getItem(`${PLAYER_PROPS_CHART_CACHE_PREFIX}${h}:::${pk}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { matches?: PlayerMatchStats[] } | null;
    const m = parsed?.matches;
    return Array.isArray(m) && m.length > 0 ? m : null;
  } catch {
    return null;
  }
}

function writePlayerPropsChartCache(href: string, playerKey: string, matches: PlayerMatchStats[]): void {
  if (typeof window === 'undefined') return;
  const h = normalizeChartCacheHref(href);
  const pk = String(playerKey || '').trim().toLowerCase();
  if (!h || !pk || !matches.length) return;
  try {
    const payload = JSON.stringify({ matches });
    if (payload.length > 4_500_000) return;
    window.sessionStorage.setItem(`${PLAYER_PROPS_CHART_CACHE_PREFIX}${h}:::${pk}`, payload);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Bar heights as % of row (same pattern as team chart skeleton on `app/soccer/page.tsx`). */
const CHART_SKELETON_BAR_HEIGHTS_PCT = [45, 62, 38, 71, 55, 48, 65, 42, 58, 51, 47, 63, 39, 72, 56, 49, 66, 43, 59, 52];

function SoccerPlayerPropsChartSkeleton({ isDark }: { isDark: boolean }) {
  const bar = isDark ? 'bg-gray-800' : 'bg-gray-200';
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 px-1 pt-1">
      <div className="flex flex-wrap gap-1.5">
        {['w-[4.5rem]', 'w-16', 'w-20', 'w-14', 'w-[4.25rem]', 'w-[5.25rem]'].map((w, i) => (
          <div key={i} className={`h-8 ${w} flex-shrink-0 rounded-full animate-pulse ${bar}`} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className={`h-8 w-20 flex-shrink-0 rounded-lg animate-pulse ${bar}`} />
        <div className={`h-8 w-20 flex-shrink-0 rounded-xl animate-pulse ${bar}`} />
        <div className={`h-8 w-36 flex-shrink-0 rounded-xl animate-pulse sm:ml-auto ${bar}`} />
      </div>
      <div className="flex min-h-[200px] flex-1 flex-col px-0 pb-1">
        <div className="flex h-full min-h-[180px] flex-1 items-end justify-center gap-0.5 px-1 sm:gap-1">
          {CHART_SKELETON_BAR_HEIGHTS_PCT.map((pct, idx) => (
            <div
              key={idx}
              className="flex h-full max-w-[50px] flex-1 flex-col justify-end"
              style={{ height: '100%' }}
            >
              <div
                className={`w-full min-w-[6px] rounded-t-md animate-pulse sm:min-w-[7px] ${bar}`}
                style={{
                  height: `${pct}%`,
                  minHeight: '28px',
                  animationDelay: `${idx * 0.05}s`,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SoccerPlayerPropsTestCard({
  teamHref,
  playerKey = null,
  displayName = null,
  nextOpponentName = null,
  isDark,
  emptyTextClass,
  onChartSnapshotChange,
}: SoccerPlayerPropsTestCardProps) {
  const [matches, setMatches] = useState<PlayerMatchStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStat, setSelectedStat] = useState(DEFAULT_MAIN_STAT_TILE.id);
  const [selectedTimeframe, setSelectedTimeframe] = useState<ChartTimeframe>('last10');
  const [selectedCompetition, setSelectedCompetition] = useState('all');
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const [isCompetitionDropdownOpen, setIsCompetitionDropdownOpen] = useState(false);
  const [manualLineValue, setManualLineValue] = useState<number | null>(null);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const competitionDropdownRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const href = String(teamHref || '').trim();
    const pk = String(playerKey || '').trim().toLowerCase();
    if (!href || !pk || !PLAYER_KEY_PARAM_RE.test(pk)) {
      setMatches([]);
      return;
    }
    const cached = readPlayerPropsChartCache(href, pk);
    if (cached?.length) {
      setMatches(cached);
      setError(null);
    } else {
      setMatches([]);
    }
  }, [teamHref, playerKey]);

  useEffect(() => {
    const href = String(teamHref || '').trim();
    const pk = String(playerKey || '').trim().toLowerCase();
    if (!href || !pk || !PLAYER_KEY_PARAM_RE.test(pk)) {
      setMatches([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    // Request all 7 Soccerway tabs; UI filters which keys it surfaces dynamically.
    const params = new URLSearchParams({ href, cacheOnly: '1', limit: '0', categories: 'all', season: 'current' });
    params.set('playerKey', pk);
    const dn = String(displayName || '').trim();
    if (dn) params.set('player', dn);
    const snapshot = readPlayerPropsChartCache(href, pk);
    setLoading(!snapshot?.length);
    setError(null);

    fetch(`/api/soccer/player-props-test?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as PlayerPropsResponse | null;
        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.error || `Player props test request failed (${response.status})`);
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        const next = Array.isArray(payload?.matches) ? payload.matches : [];
        setMatches(next);
        if (next.length) writePlayerPropsChartCache(href, pk, next);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return;
        if (!snapshot?.length) setMatches([]);
        setError(err instanceof Error ? err.message : 'Failed to load player props');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [teamHref, playerKey, displayName]);

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

  const availableStatTiles = useMemo(() => buildOutfieldMainChartTiles(matches), [matches]);

  useEffect(() => {
    if (!availableStatTiles.length) return;
    if (!availableStatTiles.some((tile) => tile.id === selectedStat)) {
      setSelectedStat(availableStatTiles[0].id);
    }
  }, [availableStatTiles, selectedStat]);

  const selectedStatMeta =
    availableStatTiles.find((tile) => tile.id === selectedStat) ?? availableStatTiles[0] ?? DEFAULT_MAIN_STAT_TILE;

  useEffect(() => {
    onChartSnapshotChange?.({
      matches,
      mainStatKey: canonicalSoccerStatKey(selectedStatMeta.key),
      timeframe: selectedTimeframe,
      competitionFilter: selectedCompetition,
      loading,
    });
  }, [loading, matches, onChartSnapshotChange, selectedCompetition, selectedStatMeta.key, selectedTimeframe]);

  useEffect(() => {
    setManualLineValue(null);
  }, [selectedStat, selectedTimeframe]);

  const competitionOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const match of matches) {
      const key = getCompetitionKey(match);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { label: getCompetitionLabel(match), count: 1 });
    }
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
  }, [matches]);

  useEffect(() => {
    if (selectedCompetition === 'all') return;
    if (competitionOptions.some((option) => option.key === selectedCompetition)) return;
    setSelectedCompetition('all');
  }, [competitionOptions, selectedCompetition]);

  const selectedCompetitionLabel = useMemo(() => {
    if (selectedCompetition === 'all') return 'All comps';
    return competitionOptions.find((option) => option.key === selectedCompetition)?.label ?? 'Competition';
  }, [competitionOptions, selectedCompetition]);

  const filteredMatches = useMemo(() => {
    if (selectedCompetition === 'all') return matches;
    return matches.filter((match) => getCompetitionKey(match) === selectedCompetition);
  }, [matches, selectedCompetition]);

  const currentSeasonYear = useMemo(() => getSoccerSeasonYear(new Date()), []);

  const chartMatches = useMemo(() => {
    const sortedNewestFirst = [...filteredMatches].sort((a, b) => (b.kickoffUnix ?? 0) - (a.kickoffUnix ?? 0));
    if (selectedTimeframe === 'h2h') {
      if (!nextOpponentName?.trim()) return [];
      return sortedNewestFirst
        .filter((match) => opponentNamesMatch(match.opponent, nextOpponentName))
        .slice(0, 15)
        .sort((a, b) => (a.kickoffUnix ?? 0) - (b.kickoffUnix ?? 0));
    }
    if (selectedTimeframe === 'thisSeason' || selectedTimeframe === 'lastSeason') {
      const targetSeason = selectedTimeframe === 'thisSeason' ? currentSeasonYear : currentSeasonYear - 1;
      return sortedNewestFirst
        .filter((match) => {
          const kickoff = match.kickoffUnix ? new Date(match.kickoffUnix * 1000) : null;
          return getSoccerSeasonYear(kickoff) === targetSeason;
        })
        .sort((a, b) => (a.kickoffUnix ?? 0) - (b.kickoffUnix ?? 0));
    }
    const limited =
      selectedTimeframe === 'last5'
        ? sortedNewestFirst.slice(0, 5)
        : selectedTimeframe === 'last10'
          ? sortedNewestFirst.slice(0, 10)
          : selectedTimeframe === 'last20'
            ? sortedNewestFirst.slice(0, 20)
            : selectedTimeframe === 'last50'
              ? sortedNewestFirst.slice(0, 50)
              : sortedNewestFirst;
    return limited.sort((a, b) => (a.kickoffUnix ?? 0) - (b.kickoffUnix ?? 0));
  }, [currentSeasonYear, filteredMatches, nextOpponentName, selectedTimeframe]);

  const chartData = useMemo(() => {
    return chartMatches.map((match) => {
      const value = readPlayerMatchStatNumber(match.categories, selectedStatMeta.key);
      return {
        key: match.matchId,
        xKey: match.matchId,
        tickLabel: getTeamAbbrev(match.opponent),
        tickDateLabel: formatTickDate(match.kickoffUnix),
        opponent: match.opponent,
        opponentLogoUrl: match.opponentLogoUrl ?? null,
        value: value ?? 0,
        gameDate: formatMatchDate(match.kickoffUnix),
        result: match.result,
        scoreline: match.scoreline,
        venue: match.venue,
      };
    });
  }, [chartMatches, selectedStatMeta.category, selectedStatMeta.key]);

  const chartAverage = useMemo(() => average(chartData.map((row) => row.value)), [chartData]);
  const averageLineValue = chartAverage == null ? 0.5 : Math.round(chartAverage * 2) / 2;
  const lineValue = manualLineValue ?? averageLineValue;
  const yAxisConfig = useMemo(
    () => buildPositiveAxis(chartData.map((row) => row.value), lineValue),
    [chartData, lineValue]
  );
  const hideTickDetails = selectedTimeframe === 'last50' || selectedTimeframe === 'thisSeason' || selectedTimeframe === 'lastSeason' || selectedTimeframe === 'all';
  const playerXAxisTick = useMemo(
    () => <SoccerPlayerXAxisTick data={chartData} isDark={isDark} hideTickDetails={hideTickDetails} />,
    [chartData, hideTickDetails, isDark]
  );
  const customTooltip = useCallback(
    (props: {
      active?: boolean;
      payload?: Array<{ payload?: Record<string, unknown> }>;
      coordinate?: { x?: number; y?: number };
    }) => (
      <SoccerPlayerChartTooltip
        active={props.active}
        payload={props.payload}
        coordinate={props.coordinate}
        isDark={isDark}
        statLabel={selectedStatMeta.label}
      />
    ),
    [isDark, selectedStatMeta.label]
  );

  const hrefTrimmed = String(teamHref || '').trim();
  const pkTrimmed = String(playerKey || '').trim().toLowerCase();
  const hasValidPlayerKey = Boolean(pkTrimmed && PLAYER_KEY_PARAM_RE.test(pkTrimmed));
  const playerLabel = displayName?.trim() || 'this player';

  if (!hrefTrimmed) {
    return (
      <div className={`flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm ${emptyTextClass}`}>
        Search for a player above — pick someone with cached games to load their chart.
      </div>
    );
  }

  if (!hasValidPlayerKey) {
    return (
      <div className={`flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm ${emptyTextClass}`}>
        Use the player search above to pick a player. The chart fills once cached match rows exist for that player.
      </div>
    );
  }

  return (
    <div className="h-full w-full pt-3 pb-2 flex flex-col px-0 sm:px-1 md:px-2 overflow-hidden">
      {loading ? (
        <SoccerPlayerPropsChartSkeleton isDark={isDark} />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : matches.length === 0 ? (
        <div className={`flex flex-1 items-center justify-center px-4 text-center text-sm ${emptyTextClass}`}>
          No cached player-stat rows for {playerLabel} yet. Run the batch scrape for this team, then pick the player again.
        </div>
      ) : (
        <>
          <div className="mb-4 sm:mb-5 md:mb-4 mt-0 w-full max-w-full">
            <div
              className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar"
              style={{ scrollbarWidth: 'thin' }}
            >
              <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
                {availableStatTiles.map((tile) => (
                  <StatPill
                    key={tile.id}
                    label={tile.label}
                    value={tile.id}
                    isSelected={selectedStat === tile.id}
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
              <input
                id="soccer-player-betting-line-input"
                type="number"
                step={0.5}
                value={lineValue}
                min={0}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next)) setManualLineValue(next);
                }}
                className="w-20 sm:w-20 md:w-22 px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                aria-label={`Set line value for ${selectedStatMeta.label}`}
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
                    {TIMEFRAME_OPTIONS.map((timeframe) => (
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
                      { key: 'all', label: `All competitions (${matches.length})` },
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
                <p className={`text-sm ${emptyTextClass}`}>
                  {selectedTimeframe === 'h2h'
                    ? nextOpponentName?.trim()
                      ? 'No cached H2H matches found for the upcoming opponent'
                      : 'No upcoming opponent found for H2H timeframe'
                    : `No chart data for ${selectedStatMeta.label}.`}
                </p>
              </div>
            ) : (
              <SimpleChart
                key={`soccer-player-chart-${selectedStat}`}
                chartData={chartData}
                yAxisConfig={yAxisConfig}
                isDark={isDark}
                bettingLine={lineValue}
                selectedStat={selectedStat}
                selectedTimeframe={selectedTimeframe}
                disableBarAnimation
                customXAxisTick={playerXAxisTick}
                customTooltip={customTooltip}
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
        </>
      )}
    </div>
  );
}
