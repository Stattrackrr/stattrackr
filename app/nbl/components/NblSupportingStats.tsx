'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts';
import { CHART_CONFIG } from '@/app/nba/research/dashboard/constants';
import type { NblChartTimeframe } from '@/app/nbl/components/NblStatsChart';
import { NBL_CURRENT_SEASON_YEAR, resolveNblClubName } from '@/lib/nblTeamCanonical';

function toNumericValue(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Rosetta shooting % is often 0–1; display as 0–100. */
function toPercentValue(v: unknown): number {
  const n = toNumericValue(v) ?? 0;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

type BaseRow = { xKey: string; opponent: string; key: string; tickLabel: string; round: string; gameSeason?: number };

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

/** Apply same timeframe filter as NblStatsChart so bars match the main chart. */
function applyTimeframe<T extends BaseRow>(
  baseData: T[],
  timeframe: NblChartTimeframe,
  season?: number,
  nextOpponent?: string | null
): T[] {
  if (!baseData.length) return [];
  if (timeframe === 'season2025') {
    return baseData.filter((row) => row.gameSeason === 2025) as T[];
  }
  if (timeframe === 'season2024') {
    return baseData.filter((row) => row.gameSeason === 2024) as T[];
  }
  if (timeframe === 'season2023') {
    return baseData.filter((row) => row.gameSeason === 2023) as T[];
  }
  if (timeframe === 'h2h') {
    // Match NblStatsChart: prefer upcoming opponent when provided; otherwise fallback to latest game's opponent.
    const targetOpponent = nextOpponent?.trim() || baseData[baseData.length - 1]?.opponent;
    if (!targetOpponent) return baseData;
    const resolveOpp = (opp: string | undefined) =>
      opp ? (resolveNblClubName(opp) || opp.trim()) : '';
    const targetOfficial = resolveOpp(targetOpponent);
    const h2h = baseData.filter((row) => {
      const rowOpp = row.opponent;
      if (!rowOpp || typeof rowOpp !== 'string') return false;
      return resolveOpp(rowOpp) === targetOfficial || rowOpp.trim() === targetOpponent;
    });
    return (h2h.length ? h2h : baseData) as T[];
  }
  const lastN = parseInt(timeframe.replace('last', ''), 10);
  if (Number.isFinite(lastN) && lastN > 0) {
    // baseData is already oldest → newest; take last N = N most recent, still oldest→newest (newest on right)
    return baseData.slice(-lastN) as T[];
  }
  return baseData;
}

export type SupportingStatKind =
  | 'minutes'
  | 'points'
  | 'rebounds'
  | 'assists'
  | 'pra'
  | 'pr'
  | 'pa'
  | 'ra'
  | 'steals'
  | 'blocks'
  | 'turnovers'
  | 'threeMade'
  | 'threeAttempted'
  | 'threePct'
  | 'offensiveRebounds'
  | 'defensiveRebounds'
  | 'fgMade'
  | 'fgAttempted'
  | 'fgPct'
  | 'twoMade'
  | 'twoAttempted'
  | 'twoPct'
  | 'ftMade'
  | 'ftAttempted'
  | 'ftPct'
  | 'fouls'
  | 'plusMinus'
  | 'efficiency';

const PCT_KINDS = new Set<SupportingStatKind>(['fgPct', 'twoPct', 'threePct', 'ftPct']);

/** Labels for every supporting kind (also used for averages / empty copy). */
const ALL_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'minutes', label: 'MINS' },
  { value: 'points', label: 'PTS' },
  { value: 'rebounds', label: 'REB' },
  { value: 'assists', label: 'AST' },
  { value: 'pra', label: 'PRA' },
  { value: 'pr', label: 'PR' },
  { value: 'pa', label: 'PA' },
  { value: 'ra', label: 'RA' },
  { value: 'threeMade', label: '3PM' },
  { value: 'threePct', label: '3P%' },
  { value: 'fgMade', label: 'FGM' },
  { value: 'fgAttempted', label: 'FGA' },
  { value: 'steals', label: 'STL' },
  { value: 'blocks', label: 'BLK' },
  { value: 'offensiveRebounds', label: 'OREB' },
  { value: 'defensiveRebounds', label: 'DREB' },
  { value: 'fgPct', label: 'FG%' },
  { value: 'ftMade', label: 'FTM' },
  { value: 'ftAttempted', label: 'FTA' },
  { value: 'ftPct', label: 'FT%' },
  { value: 'turnovers', label: 'TO' },
  { value: 'fouls', label: 'PF' },
  { value: 'threeAttempted', label: '3PA' },
  { value: 'twoMade', label: '2PM' },
  { value: 'twoAttempted', label: '2PA' },
  { value: 'twoPct', label: '2P%' },
  { value: 'plusMinus', label: '+/-' },
  { value: 'efficiency', label: 'EFF' },
];

const OPT = Object.fromEntries(ALL_TOGGLE_OPTIONS.map((o) => [o.value, o])) as Record<
  SupportingStatKind,
  { value: SupportingStatKind; label: string }
>;

/** Scoring volume / efficiency — what drives points. */
const POINTS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.fgMade,
  OPT.fgAttempted,
  OPT.fgPct,
  OPT.threeMade,
  OPT.threeAttempted,
  OPT.threePct,
  OPT.twoMade,
  OPT.twoAttempted,
  OPT.twoPct,
  OPT.ftMade,
  OPT.ftAttempted,
  OPT.ftPct,
];

/** Field-goal family (FGM / FGA / FG%). */
const FG_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.fgMade,
  OPT.fgAttempted,
  OPT.fgPct,
  OPT.threeMade,
  OPT.threeAttempted,
  OPT.threePct,
  OPT.twoMade,
  OPT.twoAttempted,
  OPT.twoPct,
];

/** Three-point family. */
const THREE_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.threeMade,
  OPT.threeAttempted,
  OPT.threePct,
  OPT.fgMade,
  OPT.fgAttempted,
  OPT.fgPct,
  OPT.twoMade,
  OPT.twoAttempted,
  OPT.twoPct,
];

/** Two-point family. */
const TWO_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.twoMade,
  OPT.twoAttempted,
  OPT.twoPct,
  OPT.fgMade,
  OPT.fgAttempted,
  OPT.fgPct,
  OPT.threeMade,
  OPT.threeAttempted,
  OPT.threePct,
];

/** Free-throw family. */
const FT_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.ftMade,
  OPT.ftAttempted,
  OPT.ftPct,
  OPT.fgMade,
  OPT.fgAttempted,
  OPT.fgPct,
];

const REBOUNDS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.offensiveRebounds,
  OPT.defensiveRebounds,
  OPT.rebounds,
  OPT.blocks,
];

const ASSISTS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.turnovers,
  OPT.pa,
  OPT.pra,
];

const PRA_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.rebounds,
  OPT.assists,
  OPT.pr,
  OPT.pa,
  OPT.ra,
];

const PR_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.rebounds,
  OPT.pra,
  OPT.offensiveRebounds,
  OPT.defensiveRebounds,
];

const PA_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.assists,
  OPT.pra,
  OPT.turnovers,
];

const RA_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.rebounds,
  OPT.assists,
  OPT.pra,
  OPT.offensiveRebounds,
  OPT.defensiveRebounds,
];

const STEALS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.blocks,
  OPT.turnovers,
  OPT.fouls,
  OPT.assists,
];

const BLOCKS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.steals,
  OPT.rebounds,
  OPT.offensiveRebounds,
  OPT.defensiveRebounds,
];

const TURNOVERS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.assists,
  OPT.steals,
  OPT.fouls,
  OPT.points,
];

const FOULS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.turnovers,
  OPT.steals,
  OPT.blocks,
];

const MINUTES_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.points,
  OPT.rebounds,
  OPT.assists,
  OPT.efficiency,
  OPT.plusMinus,
];

const IMPACT_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  OPT.minutes,
  OPT.points,
  OPT.rebounds,
  OPT.assists,
  OPT.turnovers,
  OPT.efficiency,
  OPT.plusMinus,
];

/** Fallback when main chart has no dedicated supporting set yet. */
const DEFAULT_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [OPT.minutes];

/**
 * AFL-style: supporting pills depend on the main chart stat.
 * Always excludes the active main-chart kind.
 */
export function supportingOptionsForMain(
  mainChartStat?: string
): { value: SupportingStatKind; label: string }[] {
  const main = (mainChartStat ?? '').trim();
  let options: { value: SupportingStatKind; label: string }[];
  switch (main) {
    case 'points':
      options = POINTS_TOGGLE_OPTIONS;
      break;
    case 'fgMade':
    case 'fgAttempted':
    case 'fgPct':
      options = FG_TOGGLE_OPTIONS;
      break;
    case 'threeMade':
    case 'threeAttempted':
    case 'threePct':
      options = THREE_TOGGLE_OPTIONS;
      break;
    case 'twoMade':
    case 'twoAttempted':
    case 'twoPct':
      options = TWO_TOGGLE_OPTIONS;
      break;
    case 'ftMade':
    case 'ftAttempted':
    case 'ftPct':
      options = FT_TOGGLE_OPTIONS;
      break;
    case 'rebounds':
    case 'offensiveRebounds':
    case 'defensiveRebounds':
      options = REBOUNDS_TOGGLE_OPTIONS;
      break;
    case 'assists':
      options = ASSISTS_TOGGLE_OPTIONS;
      break;
    case 'pra':
      options = PRA_TOGGLE_OPTIONS;
      break;
    case 'pr':
      options = PR_TOGGLE_OPTIONS;
      break;
    case 'pa':
      options = PA_TOGGLE_OPTIONS;
      break;
    case 'ra':
      options = RA_TOGGLE_OPTIONS;
      break;
    case 'steals':
      options = STEALS_TOGGLE_OPTIONS;
      break;
    case 'blocks':
      options = BLOCKS_TOGGLE_OPTIONS;
      break;
    case 'turnovers':
      options = TURNOVERS_TOGGLE_OPTIONS;
      break;
    case 'fouls':
      options = FOULS_TOGGLE_OPTIONS;
      break;
    case 'minutes':
      options = MINUTES_TOGGLE_OPTIONS;
      break;
    case 'plusMinus':
    case 'efficiency':
      options = IMPACT_TOGGLE_OPTIONS;
      break;
    default:
      options = DEFAULT_TOGGLE_OPTIONS;
      break;
  }
  return options.filter((o) => o.value !== main);
}

/** First pill when the main chart stat changes (mirrors AFL resetting to TOG). */
export function defaultSupportingStatForMain(mainChartStat?: string): SupportingStatKind {
  return supportingOptionsForMain(mainChartStat)[0]?.value ?? 'minutes';
}

type StatBag = Record<SupportingStatKind, number>;

function readGameStats(g: Record<string, unknown>): StatBag {
  const n = (key: string) => Math.max(0, toNumericValue(g[key]) ?? 0);
  const signed = (key: string) => toNumericValue(g[key]) ?? 0;
  const points = n('points');
  const rebounds = n('rebounds');
  const assists = n('assists');
  const rawMinutes = n('minutes');
  return {
    minutes: Math.round(rawMinutes),
    points,
    rebounds,
    assists,
    pra: n('pra') || points + rebounds + assists,
    pr: n('pr') || points + rebounds,
    pa: n('pa') || points + assists,
    ra: n('ra') || rebounds + assists,
    steals: n('steals'),
    blocks: n('blocks'),
    turnovers: n('turnovers'),
    threeMade: n('threeMade'),
    threeAttempted: n('threeAttempted'),
    threePct: toPercentValue(g.threePct),
    offensiveRebounds: n('offensiveRebounds'),
    defensiveRebounds: n('defensiveRebounds'),
    fgMade: n('fgMade'),
    fgAttempted: n('fgAttempted'),
    fgPct: toPercentValue(g.fgPct),
    twoMade: n('twoMade'),
    twoAttempted: n('twoAttempted'),
    twoPct: toPercentValue(g.twoPct),
    ftMade: n('ftMade'),
    ftAttempted: n('ftAttempted'),
    ftPct: toPercentValue(g.ftPct),
    fouls: n('fouls'),
    plusMinus: signed('plusMinus'),
    efficiency: signed('efficiency'),
  };
}

interface NblSupportingStatsProps {
  gameLogs: Array<Record<string, unknown>>;
  timeframe: NblChartTimeframe;
  season?: number;
  nextOpponent?: string | null;
  mainChartStat?: string;
  supportingStatKind: SupportingStatKind;
  onSupportingStatKindChange: (kind: SupportingStatKind) => void;
  isDark: boolean;
  alignRightTight?: boolean;
}

export function NblSupportingStats({
  gameLogs,
  timeframe,
  season = NBL_CURRENT_SEASON_YEAR,
  nextOpponent = null,
  mainChartStat,
  supportingStatKind,
  onSupportingStatKindChange,
  isDark,
  alignRightTight = false,
}: NblSupportingStatsProps) {
  const supportingOptions = supportingOptionsForMain(mainChartStat);
  const showSupportingToggle = true;
  const toggleRailPaddingClass = alignRightTight ? 'pl-3 pr-4 sm:pl-4 sm:pr-6' : 'px-3 sm:px-4';

  // All games sorted oldest → newest (newest on the right)
  const baseData = useMemo(() => {
    if (!Array.isArray(gameLogs) || gameLogs.length === 0) return [];
    const sorted = [...gameLogs].sort((a, b) => {
      const aDate = new Date(String(a.date ?? a.game_date ?? '')).getTime();
      const bDate = new Date(String(b.date ?? b.game_date ?? '')).getTime();
      if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;
      const aRound = parseRoundIndex(a.round);
      const bRound = parseRoundIndex(b.round);
      if (Number.isFinite(aRound) && Number.isFinite(bRound) && aRound !== bRound) return aRound - bRound;
      const aNum = typeof a.game_number === 'number' ? a.game_number : Number(a.game_number ?? 0);
      const bNum = typeof b.game_number === 'number' ? b.game_number : Number(b.game_number ?? 0);
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
      return 0;
    });
    return sorted.map((g, idx) => {
      const gameNum = typeof g.game_number === 'number' ? g.game_number : idx + 1;
      const round = String(g.round ?? '-');
      const opponent = String(g.opponent ?? '-');
      const key = `${gameNum}-${round}-${opponent}-${idx}`;
      const stats = readGameStats(g as Record<string, unknown>);
      const value = stats[supportingStatKind] ?? 0;
      const isPercent = PCT_KINDS.has(supportingStatKind);
      const gameSeason =
        typeof (g as Record<string, unknown>).season === 'number'
          ? ((g as Record<string, unknown>).season as number)
          : (() => {
              const dateStr = String(g.date ?? g.game_date ?? '');
              const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : NaN;
              return Number.isFinite(year) ? year : season;
            })();
      return {
        key,
        xKey: key,
        tickLabel: opponent,
        round,
        opponent,
        value,
        isPercent,
        gameDate: String(g.date ?? g.game_date ?? ''),
        gameSeason,
      };
    });
  }, [gameLogs, supportingStatKind, season]);

  const chartData = useMemo(() => {
    const data = applyTimeframe(baseData, timeframe, season, nextOpponent) as (BaseRow & { value: number; isPercent: boolean; gameDate: string })[];
    // Ensure unique keys per bar so Recharts doesn't merge (e.g. same game_number across seasons)
    return data.map((row, idx) => ({ ...row, key: `supporting-${idx}`, xKey: `supporting-${idx}` }));
  }, [baseData, timeframe, season, nextOpponent]);

  const baseDataAll = useMemo(() => {
    if (!Array.isArray(gameLogs) || gameLogs.length === 0) return [];
    const sorted = [...gameLogs].sort((a, b) => {
      const aRound = parseRoundIndex(a.round);
      const bRound = parseRoundIndex(b.round);
      if (Number.isFinite(aRound) && Number.isFinite(bRound) && aRound !== bRound) return aRound - bRound;

      const aDate = new Date(String(a.date ?? a.game_date ?? '')).getTime();
      const bDate = new Date(String(b.date ?? b.game_date ?? '')).getTime();
      if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;

      const aNum = typeof a.game_number === 'number' ? a.game_number : Number(a.game_number ?? 0);
      const bNum = typeof b.game_number === 'number' ? b.game_number : Number(b.game_number ?? 0);
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
      return 0;
    });
    return sorted.map((g, idx) => {
      const gameNum = typeof g.game_number === 'number' ? g.game_number : idx + 1;
      const round = String(g.round ?? '-');
      const opponent = String(g.opponent ?? '-');
      const key = `${gameNum}-${round}-${opponent}-${idx}`;
      const stats = readGameStats(g as Record<string, unknown>);
      const gameSeason =
        typeof (g as Record<string, unknown>).season === 'number'
          ? ((g as Record<string, unknown>).season as number)
          : (() => {
              const dateStr = String((g as Record<string, unknown>).date ?? (g as Record<string, unknown>).game_date ?? '');
              const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : NaN;
              return Number.isFinite(year) ? year : season;
            })();
      return {
        key, xKey: `G${gameNum}`, tickLabel: opponent, round, opponent, gameSeason,
        ...stats,
      };
    });
  }, [gameLogs, season]);

  const filteredAll = useMemo(
    () => applyTimeframe(baseDataAll, timeframe, season, nextOpponent),
    [baseDataAll, timeframe, season, nextOpponent]
  );

  const averagesByStat = useMemo(() => {
    const empty = Object.fromEntries(ALL_TOGGLE_OPTIONS.map((o) => [o.value, null])) as Record<SupportingStatKind, number | null>;
    if (!filteredAll.length) return empty;
    const n = filteredAll.length;
    const avg = (key: SupportingStatKind) =>
      filteredAll.reduce((s, r) => s + Number((r as unknown as Record<string, number>)[key] ?? 0), 0) / n;
    return Object.fromEntries(ALL_TOGGLE_OPTIONS.map((o) => [o.value, avg(o.value)])) as Record<SupportingStatKind, number | null>;
  }, [filteredAll]);

  const average = useMemo(() => {
    if (!chartData.length) return null;
    const sum = chartData.reduce((s, row) => s + row.value, 0);
    const avg = sum / chartData.length;
    const isPct = chartData[0]?.isPercent ?? PCT_KINDS.has(supportingStatKind);
    return { value: avg, isPercent: isPct };
  }, [chartData, supportingStatKind]);

  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const margin = { top: 24, right: 0, left: 0, bottom: 4 };
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const xAxisHeight = 8;
  const emptyTick = useMemo(
    () => ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x},${y})`} />,
    []
  );

  const formatLabel = (value: number, isPercent: boolean) =>
    isPercent ? `${Math.round(value)}%` : String(Math.round(value));

  const emptyMessage = `No ${ALL_TOGGLE_OPTIONS.find((o) => o.value === supportingStatKind)?.label ?? supportingStatKind} data`;

  const formatAvg = (kind: SupportingStatKind) => {
    const v = averagesByStat[kind];
    if (v == null || !Number.isFinite(v)) return '—';
    if (PCT_KINDS.has(kind)) return `${v.toFixed(1)}%`;
    if (kind === 'minutes') return String(Math.round(v));
    return v.toFixed(1);
  };

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col gap-3 min-w-0">
        {showSupportingToggle && (
          <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 min-w-0 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
            <div className={`w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar ${toggleRailPaddingClass}`} style={{ scrollbarWidth: 'thin' }}>
              <div className="flex flex-nowrap gap-2 justify-start min-w-min pb-1">
                {supportingOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => onSupportingStatKindChange(o.value)}
                    className={`flex-shrink-0 min-w-[80px] sm:min-w-[100px] px-3 sm:px-5 py-2.5 sm:py-3 rounded-lg text-sm sm:text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                      supportingStatKind === o.value
                        ? isDark
                          ? 'bg-gray-600 text-gray-100'
                          : 'bg-gray-500 text-white'
                        : isDark
                          ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                  >
                    <span>{o.label}</span>
                    <span className="text-xs font-normal opacity-90">{formatAvg(o.value)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={`h-px w-full shrink-0 ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} aria-hidden />
          </div>
        )}
        <div className={`min-h-[120px] flex items-center justify-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {emptyMessage}
        </div>
      </div>
    );
  }

  const isPercent = chartData[0]?.isPercent ?? PCT_KINDS.has(supportingStatKind);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {showSupportingToggle && (
        <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 min-w-0 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
          <div className={`w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar ${toggleRailPaddingClass}`} style={{ scrollbarWidth: 'thin' }}>
            <div className="flex flex-nowrap gap-2 justify-start min-w-min pb-1">
              {supportingOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onSupportingStatKindChange(o.value)}
                  className={`flex-shrink-0 min-w-[80px] sm:min-w-[100px] px-3 sm:px-5 py-2.5 sm:py-3 rounded-lg text-sm sm:text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                    supportingStatKind === o.value
                      ? isDark
                        ? 'bg-gray-600 text-gray-100'
                        : 'bg-gray-500 text-white'
                      : isDark
                        ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  }`}
                >
                  <span>{o.label}</span>
                  <span className="text-xs font-normal opacity-90">{formatAvg(o.value)}</span>
                </button>
              ))}
            </div>
          </div>
          <div
            className={`h-px w-full shrink-0 ${
              isDark ? 'bg-gray-600' : 'bg-gray-300'
            }`}
            aria-hidden
          />
        </div>
      )}
      <div className={`w-full h-[380px] min-h-[340px] flex-shrink-0 min-w-0 pointer-events-none select-none ${alignRightTight ? 'lg:pr-6 xl:pr-7' : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart key={timeframe} data={chartData} margin={margin} barCategoryGap="5%">
            <XAxis
              dataKey="xKey"
              axisLine={{ stroke: isDark ? '#6b7280' : '#9ca3af', strokeWidth: 2 }}
              tickLine={false}
              tick={emptyTick}
              tickFormatter={() => ''}
              height={xAxisHeight}
              interval={0}
            />
            <Bar
              dataKey="value"
              radius={CHART_CONFIG.bar.radius}
              isAnimationActive={false}
              label={(props) => {
                const { x, y, width, value } = props;
                const payload = (props as { payload?: { isPercent?: boolean } }).payload;
                const labelX = Number(x ?? 0) + Number(width ?? 0) / 2;
                const labelY = Number(y ?? 0) - 6;
                const numericValue = Number(value);
                return (
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    fill={labelFill}
                    fontSize={12}
                    fontWeight={500}
                  >
                    {Number.isFinite(numericValue)
                      ? formatLabel(numericValue, payload?.isPercent ?? isPercent)
                      : ''}
                  </text>
                );
              }}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={barFill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export type NblSupportingStatKind = SupportingStatKind;
