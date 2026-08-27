'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { NblGameFilterDataItem } from '@/app/tennis/components/TennisGameFilters';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import TennisXAxisTick from '@/app/tennis/components/TennisXAxisTick';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { TENNIS_CHART_STAT_OPTIONS, TENNIS_PLAYER_STAT_PRIORITY, TENNIS_STAT_LABELS, formatTennisSetScore, isUnplayedTennisMatch, parseTennisSetsFromPlayerView, tennisOpponentCode, tennisScoreIsRetired } from '@/lib/tennis/chartStats';

type NblAdvancedFilterKey =
  | 'dvp_rank'
  | 'minutes'
  | 'rank_points'
  | 'rank_rebounds'
  | 'rank_assists'
  | 'rank_steals'
  | 'rank_blocks'
  | 'rank_threes'
  | null;
type NblSplitResultFilter = 'all' | 'wins' | 'losses';
const NBL_ADVANCED_OPPONENT_RANK_FILTERS: Array<{
  key: Exclude<NblAdvancedFilterKey, 'dvp_rank' | 'minutes' | null>;
  label: string;
  oaStatCode: string;
}> = [
  { key: 'rank_points', label: 'Points', oaStatCode: 'PTS' },
  { key: 'rank_rebounds', label: 'Rebounds', oaStatCode: 'REB' },
  { key: 'rank_assists', label: 'Assists', oaStatCode: 'AST' },
  { key: 'rank_steals', label: 'Steals', oaStatCode: 'STL' },
  { key: 'rank_blocks', label: 'Blocks', oaStatCode: 'BLK' },
  { key: 'rank_threes', label: '3PM', oaStatCode: '3PM' },
];

function isOpponentRankAdvancedFilter(
  key: NblAdvancedFilterKey
): key is Exclude<NblAdvancedFilterKey, 'dvp_rank' | 'minutes' | null> {
  return key != null && key.startsWith('rank_');
}

const CHART_STAT_TO_ADVANCED_OPPONENT_FILTER: Record<
  string,
  Exclude<NblAdvancedFilterKey, 'dvp_rank' | 'minutes' | null>
> = {
  points: 'rank_points',
  rebounds: 'rank_rebounds',
  assists: 'rank_assists',
  steals: 'rank_steals',
  blocks: 'rank_blocks',
  threeMade: 'rank_threes',
};

const STAT_PRIORITY = [...TENNIS_PLAYER_STAT_PRIORITY];
const META_SKIP = new Set(['season', 'game_number', 'matchId', 'date', 'game_date', 'tourneyDate', 'matchDate', 'opponent', 'opponentId', 'opponentCode', 'opponentIoc', 'isHome', 'team', 'teamCode', 'result', 'venue', 'round', 'tour', 'tourneyId', 'tourneyName', 'tourneyLevel', 'surface', 'score', 'hand', 'ioc', 'playerId', 'playerName', 'isGrandSlam', 'isWin', 'bestOf', 'opponentRank', 'playerRank', 'opponentRankPoints', 'rankPoints', 'seed', 'entry', 'height', 'age', 'drawSize', '__nblGameIndex']);
const STATS_HIDDEN = new Set<string>(['minutes', 'setsLost', 'breakPointsFaced', 'servePointsWon', 'totalPoints', 'secondServeAttempts', 'firstServesIn', 'secondServesWon', 'setsWon', 'servePoints', 'serveGames']);
const PCT_STATS = new Set(['firstServePct', 'firstServeWonPct', 'secondServeWonPct', 'servicePointsWonPct', 'returnPointsWonPct', 'breakPointsSavedPct', 'breakPointsConvertedPct']);
const TIMEFRAME_OPTIONS = ['last5', 'last10', 'last15', 'last20', 'last50', 'h2h', 'season2026', 'season2025', 'season2024'] as const;

interface NblChartTooltipProps {
  active?: boolean;
  payload?: any[];
  coordinate?: { x: number; y: number };
  isDark: boolean;
  selectedStatLabel: string;
  selectedStat?: string;
  dvpPosition?: string | null;
  perGameFilterData?: NblGameFilterDataItem[] | null;
}

function NblChartTooltip({ active, payload, coordinate, isDark, selectedStatLabel, selectedStat }: NblChartTooltipProps) {
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
    | {
        opponent?: string;
        result?: string;
        value?: number | null;
        gameDate?: string;
        score?: string;
        surface?: string;
        tourneyName?: string;
      }
    | undefined;
  if (!point) return null;

  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipText = isDark ? '#ffffff' : '#000000';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const labelColor = isDark ? '#9ca3af' : '#6b7280';
  const winColor = isDark ? '#10b981' : '#059669';
  const lossColor = isDark ? '#ef4444' : '#dc2626';

  let dateShort = point.gameDate ?? '';
  if (point.gameDate) {
    const ts = Date.parse(point.gameDate);
    if (!Number.isNaN(ts)) {
      const d = new Date(ts);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = String(d.getFullYear());
      dateShort = `${day}/${month}/${year}`;
    }
  }

  const isWin = Boolean(point.result && String(point.result).toLowerCase().startsWith('w'));
  const resultColor = point.result ? (isWin ? winColor : lossColor) : labelColor;
  const walkover = isUnplayedTennisMatch(point.score);
  const retired = tennisScoreIsRetired(point.score);
  const sets = parseTennisSetsFromPlayerView(point.score, isWin);
  const playerSets = sets.filter((set) => set.playerGames > set.opponentGames).length;
  const opponentSets = sets.filter((set) => set.opponentGames > set.playerGames).length;

  let gameResultLabel: string | null = null;
  if (walkover) {
    gameResultLabel = isWin ? 'W W/O' : 'L W/O';
  } else if (sets.length) {
    gameResultLabel = `${isWin ? 'W' : 'L'} ${playerSets}-${opponentSets}${retired ? ' RET' : ''}`;
  } else if (point.result) {
    const raw = String(point.result).trim();
    const lower = raw.toLowerCase();
    if (lower.startsWith('w') || lower.includes('win')) gameResultLabel = 'W';
    else if (lower.startsWith('l') || lower.includes('loss') || lower.includes('lost')) gameResultLabel = 'L';
    else gameResultLabel = raw;
  }

  const surface = String(point.surface || '').trim();
  const tourneyName = String(point.tourneyName || '').trim();
  const metaRows: Array<{ label: string; value: string }> = [];
  if (tourneyName) metaRows.push({ label: 'Event', value: tourneyName });
  if (surface) metaRows.push({ label: 'Surface', value: surface });

  const tooltipWidth = isMobile ? 280 : 248;
  const tooltipHeight = 148 + (walkover || retired ? 22 : 0) + sets.length * 22 + metaRows.length * 20;

  const getTooltipPosition = () => {
    const currentPosition = mousePosition ?? (coordinate ? { x: coordinate.x, y: coordinate.y } : null);
    if (!currentPosition) return { left: undefined, top: undefined };
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (isMobile) {
      const left = Math.max(10, (viewportWidth - tooltipWidth) / 2);
      const top = Math.max(10, Math.min(viewportHeight * 0.32, viewportHeight - tooltipHeight - 20));
      return { left: `${left}px`, top: `${top}px` };
    }
    const offsetX = 16;
    const offsetY = -10;
    let left = currentPosition.x + offsetX;
    if (left + tooltipWidth > viewportWidth - 10) left = Math.max(10, currentPosition.x - tooltipWidth - offsetX);
    let top = currentPosition.y + offsetY;
    if (top + tooltipHeight > viewportHeight - 10) top = Math.max(10, currentPosition.y - tooltipHeight - 12);
    return { left: `${left}px`, top: `${top}px` };
  };

  const position = getTooltipPosition();

  const tooltipStyle: React.CSSProperties = {
    backgroundColor: tooltipBg,
    border: `1px solid ${tooltipBorder}`,
    borderRadius: '12px',
    padding: '12px 14px',
    width: isMobile ? 'min(280px, 90vw)' : '248px',
    boxShadow: isDark
      ? '0 12px 28px -8px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.04)'
      : '0 12px 28px -8px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.04)',
    zIndex: 999999,
    pointerEvents: 'none',
    position: 'fixed',
    left: position.left,
    top: position.top,
    transform: 'none',
  };

  const isMoneylineStat =
    selectedStat === 'moneyline' || /^q[1-4]_moneyline$/.test(selectedStat || '');
  const formattedValue =
    typeof point.value === 'number'
      ? isMoneylineStat
        ? point.value >= 1
          ? 'W'
          : 'L'
        : PCT_STATS.has(selectedStat || '')
          ? `${point.value.toFixed(1)}%`
          : Number.isInteger(point.value)
            ? String(point.value)
            : point.value.toFixed(1)
      : '—';

  const tooltipContent = (
    <div style={tooltipStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {dateShort ? (
            <div style={{ fontSize: 11, fontWeight: 500, color: labelColor, letterSpacing: '0.01em' }}>
              {dateShort}
            </div>
          ) : null}
          <div
            style={{
              marginTop: dateShort ? 3 : 0,
              fontSize: 13,
              fontWeight: 600,
              color: tooltipText,
              lineHeight: 1.3,
            }}
          >
            {point.opponent ? `vs ${point.opponent}` : dateShort ? '' : '-'}
          </div>
        </div>
        {gameResultLabel && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.02em',
              color: resultColor,
              backgroundColor: isWin ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)',
              padding: '4px 8px',
              borderRadius: 999,
              lineHeight: 1,
            }}
          >
            {gameResultLabel}
          </span>
        )}
      </div>

      {(sets.length > 0 || walkover) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginBottom: 10,
            padding: '8px 10px',
            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc',
            borderRadius: 8,
          }}
        >
          {walkover ? (
            <div style={{ fontSize: 12, fontWeight: 600, color: tooltipText }}>Walkover</div>
          ) : (
            sets.map((set, idx) => (
              <div
                key={`set-${idx}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 12,
                }}
              >
                <span style={{ color: labelColor, fontWeight: 600 }}>{`Set ${idx + 1}`}</span>
                <span
                  style={{
                    color: tooltipText,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '0.02em',
                  }}
                >
                  {formatTennisSetScore(set)}
                </span>
              </div>
            ))
          )}
          {retired && !walkover ? (
            <div style={{ fontSize: 11, fontWeight: 600, color: labelColor }}>Retired</div>
          ) : null}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: metaRows.length ? 10 : 0,
          padding: '10px 12px',
          backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#f3f4f6',
          borderRadius: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: labelColor,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {selectedStatLabel}
        </span>
        <span
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: tooltipText,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {formattedValue}
        </span>
      </div>

      {formattedValue === '—' && (
        <div
          style={{
            marginBottom: metaRows.length ? 10 : 0,
            fontSize: 11,
            fontWeight: 600,
            color: labelColor,
            lineHeight: 1.35,
          }}
        >
          Serve stats not in the source for this match
        </div>
      )}

      {metaRows.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            fontSize: 12,
            color: labelColor,
          }}
        >
          {metaRows.map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
              }}
            >
              <span style={{ flexShrink: 0 }}>{row.label}</span>
              <span
                style={{
                  color: tooltipText,
                  fontWeight: 600,
                  textAlign: 'right',
                  lineHeight: 1.3,
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const shouldRender = typeof window !== 'undefined' && active && (mousePosition ?? (isMobile && coordinate));
  if (shouldRender) {
    return createPortal(tooltipContent, document.body);
  }
  return null;
}

function formatStatLabel(key: string): string {
  const option = TENNIS_CHART_STAT_OPTIONS.find((s) => s.key === key);
  if (option) return option.label;
  if (TENNIS_STAT_LABELS[key]) return TENNIS_STAT_LABELS[key];
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

function numericChartValues(rows: Array<{ value: number | null }>): number[] {
  return rows
    .map((row) => row.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

/** Rosetta shooting % is often 0–1; chart as 0–100. Missing tennis serve stats stay null (not 0). */
function toChartStatValue(stat: string, raw: unknown, row?: Record<string, unknown>): number | null {
  if (row && (stat === 'pr' || stat === 'pa' || stat === 'ra' || stat === 'pra')) {
    const pts = toNumericValue(row.points) ?? 0;
    const reb = toNumericValue(row.rebounds) ?? 0;
    const ast = toNumericValue(row.assists) ?? 0;
    const existing = toNumericValue(raw);
    if (existing != null && existing > 0) return existing;
    if (stat === 'pra') return pts + reb + ast;
    if (stat === 'pr') return pts + reb;
    if (stat === 'pa') return pts + ast;
    if (stat === 'ra') return reb + ast;
  }
  if (row && stat === 'efficiency') {
    const existing = toNumericValue(raw);
    if (existing != null) return existing;
    const pts = toNumericValue(row.points) ?? 0;
    const reb = toNumericValue(row.rebounds) ?? 0;
    const ast = toNumericValue(row.assists) ?? 0;
    const stl = toNumericValue(row.steals) ?? 0;
    const blk = toNumericValue(row.blocks) ?? 0;
    const fgm = toNumericValue(row.fgMade) ?? 0;
    const fga = toNumericValue(row.fgAttempted) ?? 0;
    const ftm = toNumericValue(row.ftMade) ?? 0;
    const fta = toNumericValue(row.ftAttempted) ?? 0;
    const to = toNumericValue(row.turnovers) ?? 0;
    return pts + reb + ast + stl + blk - (fga - fgm) - (fta - ftm) - to;
  }
  const n = toNumericValue(raw);
  const isMoneylineStat = stat === 'moneyline' || /^q[1-4]_moneyline$/.test(stat);
  if (n == null) return isMoneylineStat ? 0 : null;
  if (PCT_STATS.has(stat) && n <= 1) return n * 100;
  // Rosetta minutes are fractional — round to whole numbers for the chart.
  if (stat === 'minutes') return Math.round(n);
  return n;
}

function normalizeLogoUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.replace(/^http:\/\//i, 'https://');
}

function extractVenueFromGameLog(game: Record<string, unknown>): string {
  const candidates = [
    game.venue,
    game.ground,
    game.stadium,
    game.location,
    game.match_venue,
    game.game_venue,
    game.surface,
    game.tourneyName,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  // Pseudo-venues from home/away when no venue string
  if (typeof game.isHome === 'boolean') return game.isHome ? 'Home' : 'Away';
  return '';
}

function getGameOutcome(resultRaw: unknown): 'wins' | 'losses' | null {
  const result = String(resultRaw ?? '').trim().toLowerCase();
  if (!result) return null;
  if (result.startsWith('w') || result.includes('win') || result.includes('won')) return 'wins';
  if (result.startsWith('l') || result.includes('loss') || result.includes('lost')) return 'losses';
  return null;
}

function parseRoundIndex(round: unknown): number {
  const text = String(round ?? '').trim().toUpperCase();
  if (!text) return Number.POSITIVE_INFINITY;
  const match = text.match(/(?:ROUND|R)?\s*(\d+)/);
  if (match) return parseInt(match[1], 10);

  // Finals ordering after regular rounds so "last X" includes recent finals.
  if (/\b(GF|GRAND\s*FINAL)\b/.test(text)) return 29;
  if (/\b(PF|PRELIM)\b/.test(text)) return 28;
  if (/\b(SF|SEMI)\b/.test(text)) return 27;
  if (/\b(QF|QUAL)\b/.test(text)) return 26;
  if (/\b(EF|ELIM)\b/.test(text)) return 25;

  return Number.POSITIVE_INFINITY;
}

export type NblChartTimeframe = (typeof TIMEFRAME_OPTIONS)[number];

interface NblStatsChartProps {
  stats: Record<string, string | number>;
  gameLogs?: Array<Record<string, unknown>>;
  allGameLogs?: Array<Record<string, unknown>>;
  isDark: boolean;
  logoByTeam?: Record<string, string>;
  isLoading?: boolean;
  hasSelectedPlayer?: boolean;
  mode?: 'player' | 'team';
  apiErrorHint?: string | null;
  teammateFilterName?: string | null;
  withWithoutMode?: 'with' | 'without';
  season?: number;
  clearTeammateFilter?: () => void;
  /** Roster used to resolve teammate names → playerIds for with/without. */
  rosterPlayers?: Array<{ name: string; playerId: string | null; team?: string | null }>;
  /** When provided, chart timeframe is controlled by parent (e.g. to sync Supporting stats). */
  selectedTimeframe?: NblChartTimeframe;
  onTimeframeChange?: (timeframe: NblChartTimeframe) => void;
  /** When provided, the currently selected main stat is controlled by the parent (e.g. AFL page). */
  selectedStat?: string;
  /** Called when the selected stat changes (e.g. to show TOG/Kicks/Handballs toggle when Disposals). Required when selectedStat is controlled. */
  onSelectedStatChange?: (stat: string) => void;
  /** Advanced filter toggle (inline with chart, like NBA). */
  showAdvancedFilters?: boolean;
  setShowAdvancedFilters?: (show: boolean) => void;
  nblGameFilters?: import('@/app/tennis/components/TennisGameFilters').NblGameFiltersState;
  setNblGameFilters?: (f: import('@/app/tennis/components/TennisGameFilters').NblGameFiltersState) => void;
  perGameFilterData?: import('@/app/tennis/components/TennisGameFilters').NblGameFilterDataItem[] | null;
  playerPositionForFilters?: string | null;
  /** Renders to the left of the "Line" label (e.g. bookmaker selector). */
  slotLeftOfLine?: React.ReactNode;
  /** Renders on the far right of the controls row (e.g. Team filter). */
  slotRightOfControls?: React.ReactNode;
  /** When set, syncs the chart line to this value (e.g. from selected bookmaker's line). */
  externalLineValue?: number | null;
  /** Upcoming opponent (official name). When H2H is selected, chart shows only games vs this opponent. */
  nextOpponent?: string | null;
  /** In team (game props) mode, chart is for this team vs various opponents. Used for Team dropdown + H2H. */
  gamePropsTeam?: string | null;
  /** Increment/change to force-close chart UI controls (splits/advanced) on context changes. */
  uiResetToken?: string | number;
}

export function TennisStatsChart({
  stats: _stats,
  gameLogs = [],
  allGameLogs = [],
  isDark,
  logoByTeam: externalLogoByTeam,
  isLoading,
  hasSelectedPlayer,
  mode = 'player',
  apiErrorHint,
  teammateFilterName,
  withWithoutMode = 'with',
  season = TENNIS_CURRENT_YEAR,
  clearTeammateFilter,
  rosterPlayers = [],
  selectedStat: selectedStatProp,
  selectedTimeframe: controlledTimeframe,
  onTimeframeChange,
  onSelectedStatChange,
  showAdvancedFilters = false,
  setShowAdvancedFilters,
  nblGameFilters,
  setNblGameFilters,
  perGameFilterData = null,
  playerPositionForFilters = null,
  slotLeftOfLine = null,
  slotRightOfControls = null,
  externalLineValue = null,
  nextOpponent = null,
  gamePropsTeam = null,
  uiResetToken,
}: NblStatsChartProps) {
  const [chartLogoByTeam, setChartLogoByTeam] = useState<Record<string, string>>({});
  const [teammateGameKeys, setTeammateGameKeys] = useState<Set<string>>(new Set());
  const [internalTimeframe, setInternalTimeframe] =
    useState<NblChartTimeframe>('last10');
  const [selectedAdvancedFilter, setSelectedAdvancedFilter] = useState<NblAdvancedFilterKey>(null);
  const resetAdvancedRanges = useCallback(() => {
    if (!nblGameFilters || !setNblGameFilters) return;
    setNblGameFilters({
      ...nblGameFilters,
      dvpRankMin: null,
      dvpRankMax: null,
      opponentRankMin: null,
      opponentRankMax: null,
      minutesMin: null,
      minutesMax: null,
    });
  }, [nblGameFilters, setNblGameFilters]);
  const selectedTimeframe = controlledTimeframe ?? internalTimeframe;
  const setSelectedTimeframe = useCallback(
    (t: NblChartTimeframe) => {
      if (onTimeframeChange) onTimeframeChange(t);
      if (controlledTimeframe == null) setInternalTimeframe(t);
    },
    [onTimeframeChange, controlledTimeframe]
  );

  const resolveGameSeason = useCallback((g: Record<string, unknown>): number | null => {
    if (typeof g.season === 'number' && Number.isFinite(g.season)) return g.season;
    const dateStr = String(g.date ?? g.game_date ?? '');
    const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : NaN;
    return Number.isFinite(year) ? year : null;
  }, []);

  const dedupeNblGames = useCallback((games: Array<Record<string, unknown>>) => {
    const seen = new Set<string>();
    const out: Array<Record<string, unknown>> = [];
    for (const g of games) {
      const id = String(g.matchId ?? g.id ?? [g.date, g.opponent, g.round].join('-'));
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(g);
    }
    return out;
  }, []);

  const dedupedGameLogs = useMemo(
    () =>
      dedupeNblGames(
        (gameLogs as Record<string, unknown>[]).filter((g) => !isUnplayedTennisMatch(g.score))
      ) as typeof gameLogs,
    [gameLogs]
  );
  const dedupedAllGameLogs = useMemo(
    () =>
      dedupeNblGames(
        (allGameLogs as Record<string, unknown>[]).filter((g) => !isUnplayedTennisMatch(g.score))
      ) as typeof allGameLogs,
    [allGameLogs]
  );

  useEffect(() => {
    if (!teammateFilterName?.trim()) {
      setTeammateGameKeys(new Set());
      return;
    }
    let cancelled = false;
    const want = teammateFilterName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    const rosterHit =
      rosterPlayers.find((p) => {
        const n = String(p.name || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');
        return n === want || n.includes(want) || want.includes(n);
      }) || null;

    if (!rosterHit?.playerId) {
      setTeammateGameKeys(new Set());
      return;
    }

    fetch(
      `/api/tennis/matches?playerId=${encodeURIComponent(rosterHit.playerId)}`
    )
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const games = Array.isArray(json?.games) ? json.games : [];
        const keys = new Set<string>();
        for (const g of games as Record<string, unknown>[]) {
          const matchId = String(g.matchId ?? g.id ?? '').trim();
          if (matchId) {
            keys.add(`id:${matchId}`);
            continue;
          }
          const date = String(g.date ?? g.game_date ?? '').trim().slice(0, 10);
          const opp = String(g.opponent ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
          if (date && opp) keys.add(`d:${date}|${opp}`);
        }
        setTeammateGameKeys(keys);
      })
      .catch(() => {
        if (!cancelled) setTeammateGameKeys(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [teammateFilterName, season, rosterPlayers]);

  useEffect(() => {
    if (externalLogoByTeam && Object.keys(externalLogoByTeam).length > 0) {
      const normalizedExternal = Object.fromEntries(
        Object.entries(externalLogoByTeam).map(([k, v]) => [k, normalizeLogoUrl(v)])
      );
      setChartLogoByTeam(normalizedExternal);
      return;
    }
    let cancelled = false;

    const loadTeamLogos = async () => {
      try {
        const nextMap: Record<string, string> = {};
        if (!cancelled) setChartLogoByTeam(nextMap);
      } catch {
        // Leave fallback text ticks when logos are unavailable.
      }
    };

    loadTeamLogos();
    return () => {
      cancelled = true;
    };
  }, [externalLogoByTeam]);

  const hasActiveAdvancedRangeFilter =
    !!nblGameFilters &&
    (
      nblGameFilters.dvpRankMin != null ||
      nblGameFilters.dvpRankMax != null ||
      nblGameFilters.opponentRankMin != null ||
      nblGameFilters.opponentRankMax != null ||
      nblGameFilters.minutesMin != null ||
      nblGameFilters.minutesMax != null
    );

  const logsForStatOptions = useMemo(
    () => (dedupedGameLogs.length > 0 ? dedupedGameLogs : dedupedAllGameLogs),
    [dedupedGameLogs, dedupedAllGameLogs]
  );

  const availableStats = useMemo(() => {
    const keys = new Set<string>();
    for (const row of logsForStatOptions) {
      for (const [k, v] of Object.entries(row)) {
        if (META_SKIP.has(k) || STATS_HIDDEN.has(k)) continue;
        const num = toNumericValue(v);
        if (num !== null) keys.add(k);
      }
    }
    const ordered: string[] = [];
    for (const k of STAT_PRIORITY) if (keys.has(k)) ordered.push(k);
    for (const k of keys) if (!ordered.includes(k)) ordered.push(k);
    return ordered;
  }, [logsForStatOptions]);

  const preferredDefaultStat = useMemo(() => {
    if (!availableStats.length) return '';
    if (availableStats.includes('moneyline')) return 'moneyline';
    return availableStats[0];
  }, [availableStats]);

  const [internalSelectedStat, setInternalSelectedStat] = useState<string>('');
  const [lineValue, setLineValue] = useState(0);
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const [showSplitsFilters, setShowSplitsFilters] = useState(false);
  const [splitResultFilter, setSplitResultFilter] = useState<NblSplitResultFilter>('all');
  const [splitVenueFilter, setSplitVenueFilter] = useState<string>('all');
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const venueDropdownRef = useRef<HTMLDivElement>(null);
  const [isVenueDropdownOpen, setIsVenueDropdownOpen] = useState(false);
  const lineSyncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSyncedStatRef = useRef<string | null>(null);

  const selectedStat = selectedStatProp ?? internalSelectedStat;

  // When Advanced is open, keep opponent-rank advanced selection in sync with the
  // currently selected main stat (for supported AFL opponent-rank stats).
  useEffect(() => {
    if (!showAdvancedFilters) return;
    const mapped = CHART_STAT_TO_ADVANCED_OPPONENT_FILTER[selectedStat || ''];
    if (!mapped) return;

    // Only auto-sync when the main selected stat has actually changed.
    if (lastAutoSyncedStatRef.current === selectedStat) return;
    lastAutoSyncedStatRef.current = selectedStat || null;

    // Only auto-sync opponent-rank filters (or when nothing is selected). Never override DVP/Minutes.
    if (selectedAdvancedFilter != null && !isOpponentRankAdvancedFilter(selectedAdvancedFilter)) return;

    if (selectedAdvancedFilter !== mapped) {
      setSelectedAdvancedFilter(mapped);
    }
    if (nblGameFilters && setNblGameFilters) {
      const option = NBL_ADVANCED_OPPONENT_RANK_FILTERS.find((o) => o.key === mapped);
      if (option && nblGameFilters.opponentStat !== option.oaStatCode) {
        setNblGameFilters({ ...nblGameFilters, opponentStat: option.oaStatCode });
      }
    }
  }, [
    showAdvancedFilters,
    selectedStat,
    selectedAdvancedFilter,
    nblGameFilters,
    setNblGameFilters,
  ]);

  // Always derive opponentStat code from the active advanced opponent-rank pill.
  // This prevents stale opponentStat values when switching between rank pills.
  useEffect(() => {
    if (!showAdvancedFilters) return;
    if (!selectedAdvancedFilter || !isOpponentRankAdvancedFilter(selectedAdvancedFilter)) return;
    if (!nblGameFilters || !setNblGameFilters) return;
    const option = NBL_ADVANCED_OPPONENT_RANK_FILTERS.find((o) => o.key === selectedAdvancedFilter);
    if (!option) return;
    if (nblGameFilters.opponentStat === option.oaStatCode) return;
    setNblGameFilters({ ...nblGameFilters, opponentStat: option.oaStatCode });
  }, [showAdvancedFilters, selectedAdvancedFilter, nblGameFilters, setNblGameFilters]);

  // Ensure we always have a valid selected stat. When the parent controls the stat,
  // ask it to adopt the preferred default; otherwise, fall back to internal state.
  useEffect(() => {
    if (!availableStats.length) {
      if (selectedStatProp == null) {
        setInternalSelectedStat('');
      }
      return;
    }
    const current = selectedStat;
    if (!current || !availableStats.includes(current)) {
      const next = preferredDefaultStat;
      if (onSelectedStatChange) {
        onSelectedStatChange(next);
      } else {
        setInternalSelectedStat(next);
      }
    }
  }, [availableStats, preferredDefaultStat, selectedStat, selectedStatProp, onSelectedStatChange]);

  // When game logs change significantly (e.g. new player), ensure we have a sensible default.
  // If the user has already picked a valid stat, don't override their choice.
  useEffect(() => {
    if (!availableStats.length) return;
    if (selectedStat && availableStats.includes(selectedStat)) return;
    const next = preferredDefaultStat;
    if (onSelectedStatChange) {
      onSelectedStatChange(next);
    } else {
      setInternalSelectedStat(next);
    }
  }, [gameLogs, availableStats, preferredDefaultStat, selectedStat, onSelectedStatChange]);

  const filteredGameLogs = useMemo(() => {
    if (!teammateFilterName?.trim()) return dedupedGameLogs;
    if (teammateGameKeys.size === 0) {
      return withWithoutMode === 'with' ? [] : dedupedGameLogs;
    }
    return dedupedGameLogs.filter((g) => {
      const matchId = String(g.matchId ?? g.id ?? '').trim();
      const date = String(g.date ?? g.game_date ?? '').trim().slice(0, 10);
      const opp = String(g.opponent ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
      const key = matchId ? `id:${matchId}` : date && opp ? `d:${date}|${opp}` : '';
      const playedWithTeammate = !!key && teammateGameKeys.has(key);
      if (withWithoutMode === 'with') return playedWithTeammate;
      return !playedWithTeammate;
    });
  }, [dedupedGameLogs, teammateFilterName, teammateGameKeys, withWithoutMode]);

  const venueOptions = useMemo(() => {
    const fromGames = new Set<string>();
    let hasRealVenue = false;
    for (const game of filteredGameLogs) {
      const raw = (game as Record<string, unknown>).venue;
      if (typeof raw === 'string' && raw.trim()) {
        fromGames.add(raw.trim());
        hasRealVenue = true;
      }
    }
    if (hasRealVenue) return Array.from(fromGames).sort();
    // No venue strings — use Home/Away pseudo-venues
    return ['Home', 'Away'];
  }, [filteredGameLogs]);
  const venueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of filteredGameLogs) {
      if (splitResultFilter !== 'all') {
        const outcome = getGameOutcome((game as Record<string, unknown>).result);
        if (outcome !== splitResultFilter) continue;
      }
      const venue = extractVenueFromGameLog(game as Record<string, unknown>);
      if (!venue) continue;
      counts.set(venue, (counts.get(venue) ?? 0) + 1);
    }
    return counts;
  }, [filteredGameLogs, splitResultFilter]);
  const visibleVenueOptions = useMemo(
    () => venueOptions.filter((venue) => (venueCounts.get(venue) ?? 0) > 0),
    [venueOptions, venueCounts]
  );
  const totalVenueGames = useMemo(
    () => Array.from(venueCounts.values()).reduce((sum, n) => sum + n, 0),
    [venueCounts]
  );

  useEffect(() => {
    if (splitVenueFilter === 'all') return;
    if (!(visibleVenueOptions as readonly string[]).includes(splitVenueFilter)) {
      setSplitVenueFilter('all');
    }
  }, [splitVenueFilter, visibleVenueOptions]);

  useEffect(() => {
    setShowSplitsFilters(false);
    setIsVenueDropdownOpen(false);
    setSplitResultFilter('all');
    setSplitVenueFilter('all');
    setIsTimeframeDropdownOpen(false);
    setSelectedAdvancedFilter(null);
    if (showAdvancedFilters && setShowAdvancedFilters) {
      setShowAdvancedFilters(false);
    }
    resetAdvancedRanges();
  }, [uiResetToken]);

  const splitFilteredGameLogs = useMemo(() => {
    const filtered = filteredGameLogs.filter((g) => {
      // Minutes advanced filter applies from game logs even without perGameFilterData
      if (nblGameFilters) {
        const mins = toNumericValue((g as Record<string, unknown>).minutes);
        if (nblGameFilters.minutesMin != null && (mins == null || mins < nblGameFilters.minutesMin)) return false;
        if (nblGameFilters.minutesMax != null && (mins == null || mins > nblGameFilters.minutesMax)) return false;
      }
      if (splitResultFilter !== 'all') {
        const outcome = getGameOutcome(g.result);
        if (outcome !== splitResultFilter) return false;
      }
      if (splitVenueFilter !== 'all') {
        const venue = extractVenueFromGameLog(g as Record<string, unknown>);
        if (venue !== splitVenueFilter) return false;
      }
      return true;
    });
    return dedupeNblGames(filtered as Record<string, unknown>[]) as typeof filteredGameLogs;
  }, [filteredGameLogs, splitResultFilter, splitVenueFilter, nblGameFilters]);

  const chartSourceLogs = useMemo(() => {
    if (mode !== 'team') {
      return splitFilteredGameLogs;
    }
    return splitFilteredGameLogs;
  }, [mode, selectedStat, splitFilteredGameLogs]);

  const effectiveSeason = useCallback((g: Record<string, unknown>) => resolveGameSeason(g) ?? 0, [resolveGameSeason]);

  const gameToChartRow = useCallback((g: Record<string, unknown>, idx: number) => {
    const gameNum = typeof g.game_number === 'number' ? g.game_number : idx + 1;
    const round = String(g.round ?? '-');
    const opponent = String(g.opponent ?? '-');
    const result = String(g.result ?? '-');
    const gameDate = String(g.date ?? g.game_date ?? '');
    const venue = extractVenueFromGameLog(g);
    const pts = toNumericValue(g.points) ?? 0;
    const reb = toNumericValue(g.rebounds) ?? 0;
    const ast = toNumericValue(g.assists) ?? 0;
    const value = toChartStatValue(selectedStat, g[selectedStat], g);
    const isMoneylineStat =
      selectedStat === 'moneyline' || /^q[1-4]_moneyline$/.test(selectedStat);
    const minutesRaw = toNumericValue(g.minutes);
    const minutes = minutesRaw == null ? null : Math.round(minutesRaw);
    const key = `${gameNum}-${round}-${opponent}-${idx}`;
    const gameSeason = effectiveSeason(g);
    const sourceGameIndexRaw = g.__nblGameIndex;
    const sourceGameIndex = typeof sourceGameIndexRaw === 'number' && Number.isFinite(sourceGameIndexRaw) ? sourceGameIndexRaw : idx;
    // NBA SimpleChart composite bars (PRA/PR/PA/RA) read payload.stats.pts/reb/ast
    const stats = {
      pts,
      reb,
      ast,
      stl: toNumericValue(g.steals) ?? 0,
      blk: toNumericValue(g.blocks) ?? 0,
      min: minutes ?? 0,
      oreb: toNumericValue(g.offensiveRebounds) ?? 0,
      dreb: toNumericValue(g.defensiveRebounds) ?? 0,
      fgm: toNumericValue(g.fgMade) ?? 0,
      fga: toNumericValue(g.fgAttempted) ?? 0,
      fg3m: toNumericValue(g.threeMade) ?? 0,
      fg3a: toNumericValue(g.threeAttempted) ?? 0,
      ftm: toNumericValue(g.ftMade) ?? 0,
      fta: toNumericValue(g.ftAttempted) ?? 0,
      turnover: toNumericValue(g.turnovers) ?? 0,
      pf: toNumericValue(g.fouls) ?? 0,
      fg_pct: toChartStatValue('fgPct', g.fgPct),
      fg3_pct: toChartStatValue('threePct', g.threePct),
      ft_pct: toChartStatValue('ftPct', g.ftPct),
    };
    return {
      key,
      xKey: key,
      tickLabel: tennisOpponentCode(opponent),
      round,
      opponent,
      opponentIoc: String(g.opponentIoc || '').trim() || null,
      result,
      score: String(g.score ?? ''),
      surface: String(g.surface ?? '').trim() || null,
      tourneyName: String(g.tourneyName ?? '').trim() || null,
      value,
      moneylineLabel: isMoneylineStat && (value == null || value < 1) ? '' : undefined,
      minutes,
      stats,
      gameId: key,
      gameDate,
      venue,
      gameSeason,
      sourceGameIndex,
      game: { id: key, date: gameDate, home_team: { abbreviation: opponent.toUpperCase() }, visitor_team: { abbreviation: opponent.toUpperCase() } },
    };
  }, [selectedStat, effectiveSeason]);

  const baseChartData = useMemo(() => {
    if (!selectedStat) return [];
    return [...chartSourceLogs]
      .sort((a, b) => {
        const aSeason = effectiveSeason(a as Record<string, unknown>);
        const bSeason = effectiveSeason(b as Record<string, unknown>);
        if (aSeason !== bSeason) return aSeason - bSeason;
        const aDate = new Date(String(a.date ?? a.game_date ?? '')).getTime();
        const bDate = new Date(String(b.date ?? b.game_date ?? '')).getTime();
        if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;
        const aRound = parseRoundIndex(a.round);
        const bRound = parseRoundIndex(b.round);
        if (Number.isFinite(aRound) && Number.isFinite(bRound) && aRound !== bRound) return aRound - bRound;
        const aNum = typeof a.game_number === 'number' ? a.game_number : Number(a.game_number ?? 0);
        const bNum = typeof b.game_number === 'number' ? b.game_number : Number(b.game_number ?? 0);
        const hasANum = Number.isFinite(aNum) && aNum > 0;
        const hasBNum = Number.isFinite(bNum) && bNum > 0;
        if (hasANum && hasBNum && aNum !== bNum) return aNum - bNum;
        return 0;
      })
      .map((g, idx) => gameToChartRow(g as Record<string, unknown>, idx));
  }, [chartSourceLogs, selectedStat, effectiveSeason, gameToChartRow]);

  const chartData = useMemo(() => {
    if (!baseChartData.length) return [];

    let data: typeof baseChartData;
    if (selectedTimeframe === 'season2026') {
      data = baseChartData.filter((row) => (row as { gameSeason?: number }).gameSeason === 2026);
    } else if (selectedTimeframe === 'season2025') {
      data = baseChartData.filter((row) => (row as { gameSeason?: number }).gameSeason === 2025);
    } else if (selectedTimeframe === 'season2024') {
      data = baseChartData.filter((row) => (row as { gameSeason?: number }).gameSeason === 2024);
    } else if (selectedTimeframe === 'h2h') {
      // Use upcoming opponent when provided; otherwise fall back to last game's opponent
      const targetOpponent = nextOpponent?.trim() || baseChartData[baseChartData.length - 1]?.opponent;
      if (!targetOpponent) data = baseChartData;
      else {
        const resolveOpp = (opp: string | undefined) => (opp ? opp.trim() : '');
        const targetOfficial = resolveOpp(targetOpponent);
        const h2hData = baseChartData.filter((row) => {
          const rowOpp = row.opponent;
          if (!rowOpp || typeof rowOpp !== 'string') return false;
          return resolveOpp(rowOpp) === targetOfficial || rowOpp.trim() === targetOpponent;
        });
        // When no H2H games, show empty so we can display "No recent H2H found" instead of falling back to all games
        data = h2hData;
      }
    } else {
      // L5/L10/L15/L20 = N most recent games.
      // Use baseChartData rows directly so xKey/sourceGameIndex stay stable and
      // advanced second-axis values (TOG/DvP/Opp ranks) can join correctly.
      const lastN = parseInt(selectedTimeframe.replace('last', ''), 10);
      if (Number.isFinite(lastN) && lastN > 0) {
        const sortedNewestFirst = [...baseChartData].sort((a, b) => {
          const aDate = new Date(a.gameDate || '').getTime();
          const bDate = new Date(b.gameDate || '').getTime();
          if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return bDate - aDate;
          const aSeason = (a as { gameSeason?: number }).gameSeason ?? 0;
          const bSeason = (b as { gameSeason?: number }).gameSeason ?? 0;
          if (aSeason !== bSeason) return bSeason - aSeason;
          const aRound = parseRoundIndex(a.round);
          const bRound = parseRoundIndex(b.round);
          if (aRound !== bRound) return bRound - aRound;
          return 0;
        });
        data = sortedNewestFirst.slice(0, lastN);
      } else {
        data = baseChartData;
      }
    }
    // Ensure oldest is left, newest is right: sort by season then date (chronological)
    const ordered = [...data];
    ordered.sort((a, b) => {
      const aSeason = (a as { gameSeason?: number }).gameSeason ?? 0;
      const bSeason = (b as { gameSeason?: number }).gameSeason ?? 0;
      if (aSeason !== bSeason) return aSeason - bSeason;
      const aDate = new Date(a.gameDate || 0).getTime();
      const bDate = new Date(b.gameDate || 0).getTime();
      if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;
      const aRi = parseRoundIndex(a.round);
      const bRi = parseRoundIndex(b.round);
      if (aRi !== bRi) return aRi - bRi;
      return 0;
    });
    return ordered;
  }, [baseChartData, selectedTimeframe, season, nextOpponent, filteredGameLogs, gameToChartRow, effectiveSeason]);

  const secondAxisData = useMemo(() => {
    if (!showAdvancedFilters || !selectedAdvancedFilter) return null;

    // Minutes second axis can be built from game logs without perGameFilterData
    if (selectedAdvancedFilter === 'minutes') {
      return baseChartData.map((row) => ({
        gameId: row.xKey,
        gameDate: row.gameDate,
        value: typeof (row as { minutes?: number | null }).minutes === 'number'
          ? (row as { minutes: number }).minutes
          : null,
      }));
    }

    if (!perGameFilterData?.length) return null;

    const byGameIndex = new Map<number, number | null>();
    for (const row of perGameFilterData) {
      const value =
        selectedAdvancedFilter === 'dvp_rank'
          ? row.dvpRank
          : isOpponentRankAdvancedFilter(selectedAdvancedFilter)
            ? row.opponentRank
            : row.minutes;
      byGameIndex.set(row.gameIndex, value ?? null);
    }

    return baseChartData.map((row) => {
      const gameIndex = typeof (row as { sourceGameIndex?: unknown }).sourceGameIndex === 'number'
        ? (row as { sourceGameIndex: number }).sourceGameIndex
        : null;
      return {
        gameId: row.xKey,
        gameDate: row.gameDate,
        value: gameIndex != null ? (byGameIndex.get(gameIndex) ?? null) : null,
      };
    });
  }, [showAdvancedFilters, selectedAdvancedFilter, perGameFilterData, baseChartData]);

  const statAverage = useMemo(() => {
    const values = numericChartValues(chartData);
    if (!values.length) return 0;
    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
  }, [chartData]);

  const hasDecimalValues = useMemo(() => (
    numericChartValues(chartData).some((value) => Math.abs(value - Math.round(value)) > 0.001)
  ), [chartData]);

  const sliderStep = hasDecimalValues ? 0.1 : 0.5;

  // Y-axis: defaults to positive-only stats; spread uses symmetric negative/positive domain like NBA team mode.
  const yAxisConfig = useMemo(() => {
    if (!chartData.length) return { domain: [0, 10] as [number, number], ticks: [0, 3, 7, 10] };

    const values = numericChartValues(chartData);
    if (!values.length) return { domain: [0, 10] as [number, number], ticks: [0, 3, 7, 10] };

    const isMoneylineStat =
      selectedStat === 'moneyline' || /^q[1-4]_moneyline$/.test(selectedStat);
    if (isMoneylineStat) {
      return {
        domain: [0, 1] as [number, number],
        ticks: [0, 1],
      };
    }

    if (selectedStat === 'plusMinus' || selectedStat === 'spread' || /^q[1-4]_spread$/.test(selectedStat)) {
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      const absMax = Math.max(Math.abs(minValue), Math.abs(maxValue));
      const bound = Math.max(Math.ceil(absMax / 5) * 5, 5);
      const step = bound / 3;
      const useDecimals = values.some((v) => Math.abs(v - Math.round(v)) > 0.001);
      const ticks: number[] = [
        -bound,
        useDecimals ? Math.round((-step) * 10) / 10 : Math.round(-step),
        0,
        useDecimals ? Math.round(step * 10) / 10 : Math.round(step),
        bound,
      ];
      return {
        domain: [-bound, bound] as [number, number],
        ticks,
      };
    }

    const maxValue = Math.max(...values);
    const useMaxPlusOne =
      selectedStat === 'steals' ||
      selectedStat === 'blocks' ||
      selectedStat === 'turnovers' ||
      selectedStat === 'fouls';
    const pctCap = PCT_STATS.has(selectedStat) ? Math.max(Math.ceil(maxValue / 10) * 10, 10) : null;
    const max = pctCap != null
      ? Math.min(100, Math.max(pctCap, 10))
      : useMaxPlusOne
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

  // Set line from stat average when stat/external line changes, or when chart data first becomes available
  // (no bookmaker line yet). Do not depend on avg/length so timeframe changes keep the user's line.
  const chartDataReady = chartData.length > 0;
  useEffect(() => {
    if (externalLineValue != null && Number.isFinite(externalLineValue)) return;
    if (!chartDataReady || !Number.isFinite(statAverage)) return;
    const isMoneylineStat =
      selectedStat === 'moneyline' || /^q[1-4]_moneyline$/.test(selectedStat || '');
    const next = isMoneylineStat
      ? 0.5
      : hasDecimalValues
        ? Math.round(statAverage * 10) / 10
        : Math.round(statAverage * 2) / 2;
    setLineValue(next);
    emitTransientLine(next);
    const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
    if (input) input.value = String(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omit statAverage so timeframe changes don't reset line
  }, [selectedStat, externalLineValue, hasDecimalValues, emitTransientLine, chartDataReady]);

  // When external line (e.g. from selected bookmaker) changes, sync chart line to it. Do NOT depend on yAxisConfig.domain so that changing timeframe (which changes domain) doesn't overwrite the user's manual line.
  useEffect(() => {
    if (externalLineValue == null || !Number.isFinite(externalLineValue)) return;
    const [min, max] = yAxisConfig.domain;
    const clamped = Math.max(min, Math.min(max, externalLineValue));
    const next = hasDecimalValues ? Math.round(clamped * 10) / 10 : Math.round(clamped * 2) / 2;
    setLineValue(next);
    emitTransientLine(next);
    const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
    if (input) input.value = String(next);
  }, [externalLineValue, hasDecimalValues, emitTransientLine]);

  const timeframeLabels: Record<(typeof TIMEFRAME_OPTIONS)[number], string> = {
    last5: 'L5',
    last10: 'L10',
    last15: 'L15',
    last20: 'L20',
    last50: 'L50',
    h2h: 'H2H',
    season2026: '2026',
    season2025: '2025',
    season2024: '2024',
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (timeframeDropdownRef.current && !timeframeDropdownRef.current.contains(e.target as Node)) {
        setIsTimeframeDropdownOpen(false);
      }
      if (venueDropdownRef.current && !venueDropdownRef.current.contains(e.target as Node)) {
        setIsVenueDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (lineSyncDebounceRef.current) clearTimeout(lineSyncDebounceRef.current);
    };
  }, []);

  const customTooltip = useCallback((props: any) => {
    return (
      <NblChartTooltip
        active={props.active}
        payload={props.payload}
        coordinate={props.coordinate}
        isDark={isDark}
        selectedStatLabel={selectedStatLabel}
        selectedStat={selectedStat}
        dvpPosition={playerPositionForFilters ?? null}
        perGameFilterData={perGameFilterData ?? undefined}
      />
    );
  }, [isDark, selectedStatLabel, selectedStat, playerPositionForFilters, perGameFilterData]);

  const nblXAxisTick = useMemo(() => (
    <TennisXAxisTick
      data={chartData}
      logoByTeam={chartLogoByTeam}
      isDark={isDark}
      hideLogo={selectedTimeframe === 'last50'}
    />
  ), [chartData, chartLogoByTeam, isDark, selectedTimeframe]);

  const chartLoadingSkeleton = (
    <div className="h-full w-full flex flex-col" style={{ padding: '16px 8px 8px 8px' }}>
      <div className="flex-1 flex items-end justify-center gap-1 px-2 h-full">
        {[...Array(20)].map((_, idx) => {
          const heights = [45, 62, 38, 71, 55, 48, 65, 42, 58, 51, 47, 63, 39, 72, 56, 49, 66, 43, 59, 52];
          const height = heights[idx] || 48;
          return (
            <div
              key={idx}
              className="flex-1 max-w-[50px] flex flex-col items-center justify-end"
              style={{ height: '100%' }}
            >
              <div
                className={`w-full rounded-t animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
                style={{
                  height: `${height}%`,
                  animationDelay: `${idx * 0.08}s`,
                  minHeight: '30px',
                  transition: 'height 0.3s ease',
                  minWidth: '28px',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  if (isLoading) {
    return chartLoadingSkeleton;
  }

  const subjectLabel = mode === 'team' ? 'team' : 'player';

  if (!logsForStatOptions.length) {
    return (
      <div className="h-full w-full flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          {hasSelectedPlayer ? (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {isLoading
                  ? 'Loading game data…'
                  : `No game data for this ${subjectLabel}`}
              </p>
              {apiErrorHint && !isLoading && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{apiErrorHint}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{`Select a ${subjectLabel} to see game chart`}</p>
          )}
        </div>
      </div>
    );
  }

  if (hasSelectedPlayer && (!availableStats.length || !selectedStat)) {
    if (!apiErrorHint) {
      return chartLoadingSkeleton;
    }
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">{`No game stat data for this ${subjectLabel} this season`}</p>
        {apiErrorHint && (
          <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 max-w-md break-words">
            {apiErrorHint}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={`h-full w-full pt-3 pb-2 flex flex-col ${
        showAdvancedFilters ? 'px-0 sm:px-0 md:px-1' : 'px-0 sm:px-1 md:px-2'
      }`}
    >
      <div className="mb-4 sm:mb-5 md:mb-4 mt-0 w-full max-w-full">
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
                onSelect={(v) => {
                  if (onSelectedStatChange) {
                    onSelectedStatChange(v);
                  } else {
                    setInternalSelectedStat(v);
                  }
                }}
                isDark={isDark}
                darker
              />
            ))}
          </div>
        </div>
      </div>

      {/* One row: Line input + Timeframe dropdown next to each other */}
      <div
        className={`space-y-2 sm:space-y-3 md:space-y-4 ${
          showAdvancedFilters || showSplitsFilters
            ? 'mb-1 sm:mb-2 md:mb-2 lg:mb-3'
            : 'mb-2 sm:mb-3 md:mb-4 lg:mb-6'
        }`}
      >
        <div className="flex items-center flex-wrap gap-1 sm:gap-2 md:gap-3 pl-0 sm:pl-0 ml-0 sm:ml-1">
          {slotLeftOfLine}
          <input
            id="betting-line-input"
            key={`line-${selectedStat}`}
            type="number"
            step={sliderStep}
            defaultValue={lineValue}
            min={yAxisConfig.domain[0]}
            max={yAxisConfig.domain[1]}
            onChange={(e) => {
              const raw = Number((e.target as HTMLInputElement).value);
              if (!Number.isFinite(raw)) return;
              const next = normalizeLineValue(raw);
              // Keep chart movement immediate; debounce expensive parent sync work.
              setLineValue(next);
              if (lineSyncDebounceRef.current) clearTimeout(lineSyncDebounceRef.current);
              lineSyncDebounceRef.current = setTimeout(() => {
                emitTransientLine(next);
                lineSyncDebounceRef.current = null;
              }, 120);
            }}
            onBlur={(e) => {
              const raw = Number((e.target as HTMLInputElement).value);
              if (!Number.isFinite(raw)) return;
              const next = normalizeLineValue(raw);
              setLineValue(next);
              if (lineSyncDebounceRef.current) {
                clearTimeout(lineSyncDebounceRef.current);
                lineSyncDebounceRef.current = null;
              }
              emitTransientLine(next);
            }}
            className="w-20 sm:w-20 md:w-22 px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            aria-label={`Set line value for ${selectedStatLabel}`}
          />
          <div className="relative" ref={timeframeDropdownRef}>
            <button
              type="button"
              onClick={() => setIsTimeframeDropdownOpen(!isTimeframeDropdownOpen)}
              className="w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              <span className="truncate">{timeframeLabels[selectedTimeframe] || 'L10'}</span>
              <svg className="w-3 h-3 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isTimeframeDropdownOpen && (
              <>
                <div className="absolute top-full right-0 mt-1 w-20 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {TIMEFRAME_OPTIONS.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => {
                        setSelectedTimeframe(tf);
                        setIsTimeframeDropdownOpen(false);
                      }}
                      className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg ${
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
          <button
            type="button"
            onClick={() => setShowSplitsFilters((prev) => !prev)}
            className={`w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 text-center flex items-center justify-center flex-shrink-0 relative lg:ml-auto ${showSplitsFilters ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 shadow-[0_0_15px_rgba(139,92,246,0.5)] dark:shadow-[0_0_15px_rgba(139,92,246,0.7)]' : ''}`}
          >
            Splits
          </button>
          {slotRightOfControls != null && (
            <div className="flex items-center flex-shrink-0">
              {slotRightOfControls}
            </div>
          )}
        </div>
      </div>

      {showSplitsFilters && (
        <div className="mb-2 px-2 lg:-mt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Result</span>
            {([
              { key: 'all', label: 'All' },
              { key: 'wins', label: 'Wins' },
              { key: 'losses', label: 'Losses' },
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
              <div className="relative" ref={venueDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsVenueDropdownOpen((prev) => !prev)}
                  className="w-32 sm:w-36 md:w-40 lg:w-40 px-2 py-1.5 sm:px-2 sm:py-1.5 md:px-3 md:py-2 bg-white dark:bg-gray-900 dark:border-gray-700 border border-gray-300 rounded-xl text-xs sm:text-xs md:text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="truncate">
                    {splitVenueFilter === 'all'
                      ? `All venues (${totalVenueGames})`
                      : `${splitVenueFilter} (${venueCounts.get(splitVenueFilter) ?? 0})`}
                  </span>
                  <svg className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isVenueDropdownOpen && (
                  <>
                    <div className="absolute top-full right-0 mt-1 w-44 sm:w-48 md:w-52 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setSplitVenueFilter('all');
                          setIsVenueDropdownOpen(false);
                        }}
                        className={`w-full px-2 py-1.5 sm:px-2.5 sm:py-2 text-xs sm:text-sm font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg ${
                          splitVenueFilter === 'all'
                            ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                            : 'text-gray-900 dark:text-white'
                        }`}
                      >
                        {`All venues (${totalVenueGames})`}
                      </button>
                      {visibleVenueOptions.map((venue, index) => (
                        <button
                          key={venue}
                          type="button"
                          onClick={() => {
                            setSplitVenueFilter(venue);
                            setIsVenueDropdownOpen(false);
                          }}
                          className={`w-full px-2 py-1.5 sm:px-2.5 sm:py-2 text-xs sm:text-sm font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 ${
                            splitVenueFilter === venue
                              ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                              : 'text-gray-900 dark:text-white'
                          } ${index === visibleVenueOptions.length - 1 ? 'rounded-b-lg' : ''}`}
                        >
                          {`${venue} (${venueCounts.get(venue) ?? 0})`}
                        </button>
                      ))}
                    </div>
                    <div className="fixed inset-0 z-40" onClick={() => setIsVenueDropdownOpen(false)} aria-hidden />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {chartData.length === 0 && selectedTimeframe === 'h2h' ? (
          <div className="h-full w-full flex items-center justify-center p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">No recent H2H found</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">No stats match selected filters</p>
          </div>
        ) : dedupedGameLogs.length === 0 && hasActiveAdvancedRangeFilter ? (
          <div className="h-full w-full flex items-center justify-center p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">No stats match selected filters</p>
          </div>
        ) : (
          <SimpleChart
            key={`nbl-chart-${showAdvancedFilters ? 'advanced' : 'base'}-${selectedAdvancedFilter ?? 'none'}`}
            chartData={chartData}
            yAxisConfig={yAxisConfig}
            isDark={isDark}
            bettingLine={lineValue}
            selectedStat={selectedStat}
            selectedTimeframe={selectedTimeframe}
            secondAxisData={showAdvancedFilters ? secondAxisData : null}
            selectedFilterForAxis={showAdvancedFilters ? selectedAdvancedFilter : null}
            secondaryRankAxisMax={10}
            customTooltip={customTooltip}
            customXAxisTick={nblXAxisTick}
            xAxisHeight={52}
            yAxisTickFormatter={(value) => String(Math.round(value))}
            preservePrimaryYAxisTicks={
              selectedStat === 'moneyline' || /^q[1-4]_moneyline$/.test(selectedStat)
            }
            disableBarAnimation={false}
            barAnimationDuration={180}
            chartAnimationKey={`${mode}-${selectedStat}-${selectedTimeframe}-${chartData.map((row) => row.xKey).join('|')}`}
            teammateFilterName={teammateFilterName}
            withWithoutMode={withWithoutMode}
            clearTeammateFilter={clearTeammateFilter}
            centerAverageOverlay={true}
            averageOverlayLowerOnMobile={true}
            averageOverlayLower={showAdvancedFilters}
            averageOverlayLowerExtra={showAdvancedFilters && !selectedAdvancedFilter}
            desktopChartLeftInset={24}
            desktopChartRightInset={showAdvancedFilters ? 2 : 8}
            desktopChartRightInsetWithSecondAxis={showAdvancedFilters ? 28 : 64}
            desktopChartRightMargin={showAdvancedFilters ? 2 : 8}
            desktopChartRightMarginWithSecondAxis={showAdvancedFilters ? 0 : 4}
            yAxisWidth={26}
          />
        )}
      </div>
    </div>
  );
}
