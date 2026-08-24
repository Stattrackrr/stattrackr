'use client';

import { useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts';
import { CHART_CONFIG } from '@/app/nba/research/dashboard/constants';
import type { NblChartTimeframe } from '@/app/tennis/components/TennisStatsChart';
import { TENNIS_STAT_LABELS } from '@/lib/tennis/chartStats';

function toNumericValue(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type SupportingStatKind =
  | 'minutes'
  | 'aces'
  | 'doubleFaults'
  | 'gamesWon'
  | 'gamesLost'
  | 'totalGames'
  | 'pointsWon'
  | 'returnPointsWon'
  | 'firstServePct'
  | 'breakPointsConverted'
  | 'breakPointsSaved'
  | 'moneyline'
  | 'spread'
  | 'setsWon';

const ALL_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'aces', label: TENNIS_STAT_LABELS.aces },
  { value: 'doubleFaults', label: TENNIS_STAT_LABELS.doubleFaults },
  { value: 'gamesWon', label: TENNIS_STAT_LABELS.gamesWon },
  { value: 'gamesLost', label: TENNIS_STAT_LABELS.gamesLost },
  { value: 'totalGames', label: TENNIS_STAT_LABELS.totalGames },
  { value: 'pointsWon', label: TENNIS_STAT_LABELS.pointsWon },
  { value: 'returnPointsWon', label: TENNIS_STAT_LABELS.returnPointsWon },
  { value: 'firstServePct', label: TENNIS_STAT_LABELS.firstServePct },
  { value: 'breakPointsConverted', label: TENNIS_STAT_LABELS.breakPointsConverted },
  { value: 'breakPointsSaved', label: TENNIS_STAT_LABELS.breakPointsSaved },
  { value: 'moneyline', label: TENNIS_STAT_LABELS.moneyline },
  { value: 'spread', label: TENNIS_STAT_LABELS.spread },
  { value: 'setsWon', label: TENNIS_STAT_LABELS.setsWon },
];

const PCT_KINDS = new Set<SupportingStatKind>(['firstServePct']);

function supportingOptionsForMain(main?: string): { value: SupportingStatKind; label: string }[] {
  const mainKey = String(main || '');
  const preferred: SupportingStatKind[] =
    mainKey === 'aces'
      ? ['doubleFaults', 'firstServePct', 'gamesWon', 'pointsWon']
      : mainKey === 'doubleFaults'
        ? ['aces', 'firstServePct', 'gamesWon']
        : mainKey === 'gamesWon' || mainKey === 'gamesLost' || mainKey === 'totalGames'
          ? ['aces', 'pointsWon', 'setsWon', 'spread']
          : mainKey === 'moneyline' || mainKey === 'spread'
            ? ['totalGames', 'gamesWon', 'gamesLost', 'aces']
            : ['aces', 'doubleFaults', 'gamesWon', 'firstServePct', 'pointsWon'];
  const seen = new Set<SupportingStatKind>();
  const ordered: SupportingStatKind[] = [];
  for (const key of preferred) {
    if (key === mainKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ALL_TOGGLE_OPTIONS.filter((o) => ordered.includes(o.value));
}

export function defaultSupportingStatForMain(mainChartStat?: string): SupportingStatKind {
  return supportingOptionsForMain(mainChartStat)[0]?.value ?? 'aces';
}

type BaseRow = { xKey: string; opponent: string; key: string; tickLabel: string; round: string; gameSeason?: number };

function applyTimeframe<T extends BaseRow>(
  baseData: T[],
  timeframe: NblChartTimeframe,
  _season?: number,
  nextOpponent?: string | null
): T[] {
  if (!baseData.length) return [];
  if (timeframe === 'season2026') return baseData.filter((row) => row.gameSeason === 2026) as T[];
  if (timeframe === 'season2025') return baseData.filter((row) => row.gameSeason === 2025) as T[];
  if (timeframe === 'season2024') return baseData.filter((row) => row.gameSeason === 2024) as T[];
  if (timeframe === 'season2023') return baseData.filter((row) => row.gameSeason === 2023) as T[];
  if (timeframe === 'h2h') {
    const targetOpponent = nextOpponent?.trim() || baseData[baseData.length - 1]?.opponent;
    if (!targetOpponent) return baseData;
    const h2h = baseData.filter((row) => row.opponent?.trim() === targetOpponent);
    return (h2h.length ? h2h : baseData) as T[];
  }
  const lastN = parseInt(timeframe.replace('last', ''), 10);
  if (Number.isFinite(lastN) && lastN > 0) return baseData.slice(-lastN) as T[];
  return baseData;
}

type StatBag = Record<SupportingStatKind, number>;

function readGameStats(g: Record<string, unknown>): StatBag {
  const n = (key: string) => toNumericValue(g[key]) ?? 0;
  const toPercentValue = (v: unknown): number => {
    const raw = toNumericValue(v) ?? 0;
    const pct = raw <= 1 ? raw * 100 : raw;
    return Math.max(0, Math.min(100, pct));
  };
  return {
    minutes: Math.round(n('minutes')),
    aces: n('aces'),
    doubleFaults: n('doubleFaults'),
    gamesWon: n('gamesWon'),
    gamesLost: n('gamesLost'),
    totalGames: n('totalGames'),
    pointsWon: n('pointsWon'),
    returnPointsWon: n('returnPointsWon'),
    firstServePct: toPercentValue(g.firstServePct),
    breakPointsConverted: n('breakPointsConverted'),
    breakPointsSaved: n('breakPointsSaved'),
    moneyline: n('moneyline'),
    spread: n('spread'),
    setsWon: n('setsWon'),
  };
}

interface TennisSupportingStatsProps {
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

export function TennisSupportingStats({
  gameLogs,
  timeframe,
  season = 2026,
  nextOpponent = null,
  mainChartStat,
  supportingStatKind,
  onSupportingStatKindChange,
  isDark,
  alignRightTight = false,
}: TennisSupportingStatsProps) {
  const supportingOptions = useMemo(() => supportingOptionsForMain(mainChartStat), [mainChartStat]);

  useEffect(() => {
    if (supportingOptions.length > 0 && !supportingOptions.some((o) => o.value === supportingStatKind)) {
      onSupportingStatKindChange(supportingOptions[0].value);
    }
  }, [supportingOptions, supportingStatKind, onSupportingStatKindChange]);

  const toggleRailPaddingClass = alignRightTight ? 'pl-3 pr-4 sm:pl-4 sm:pr-6' : 'px-3 sm:px-4';

  const baseData = useMemo(() => {
    if (!Array.isArray(gameLogs) || gameLogs.length === 0) return [];
    const sorted = [...gameLogs].sort((a, b) => {
      const aDate = new Date(String(a.date ?? a.game_date ?? '')).getTime();
      const bDate = new Date(String(b.date ?? b.game_date ?? '')).getTime();
      return (Number.isFinite(aDate) ? aDate : 0) - (Number.isFinite(bDate) ? bDate : 0);
    });
    return sorted.map((g, idx) => {
      const opponent = String(g.opponent ?? '-');
      const stats = readGameStats(g);
      const gameSeason =
        typeof g.season === 'number'
          ? g.season
          : parseInt(String(g.date ?? '').slice(0, 4), 10) || season;
      return {
        key: `${idx}-${opponent}`,
        xKey: `${idx}-${opponent}`,
        tickLabel: opponent,
        round: String(g.round ?? ''),
        opponent,
        value: stats[supportingStatKind] ?? 0,
        isPercent: PCT_KINDS.has(supportingStatKind),
        gameDate: String(g.date ?? ''),
        gameSeason,
        ...stats,
      };
    });
  }, [gameLogs, supportingStatKind, season]);

  const chartData = useMemo(() => {
    const data = applyTimeframe(baseData, timeframe, season, nextOpponent);
    return data.map((row, idx) => ({ ...row, key: `supporting-${idx}`, xKey: `supporting-${idx}` }));
  }, [baseData, timeframe, season, nextOpponent]);

  const averagesByStat = useMemo(() => {
    const empty = Object.fromEntries(ALL_TOGGLE_OPTIONS.map((o) => [o.value, null])) as Record<
      SupportingStatKind,
      number | null
    >;
    const windowed = applyTimeframe(baseData, timeframe, season, nextOpponent);
    if (!windowed.length) return empty;
    const n = windowed.length;
    const avg = (key: SupportingStatKind) =>
      windowed.reduce((sum, row) => sum + (Number((row as Record<string, unknown>)[key]) || 0), 0) / n;
    const next = { ...empty };
    for (const opt of supportingOptions) next[opt.value] = avg(opt.value);
    return next;
  }, [baseData, timeframe, season, nextOpponent, supportingOptions]);

  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const margin = { top: 24, right: 0, left: 0, bottom: 4 };
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const emptyTick = useMemo(
    () =>
      ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x},${y})`} />,
    []
  );

  const formatLabel = (value: number, isPercent: boolean) =>
    isPercent ? `${Math.round(value)}%` : String(Math.round(value));

  const formatAvg = (kind: SupportingStatKind) => {
    const v = averagesByStat[kind];
    if (v == null || !Number.isFinite(v)) return '—';
    if (PCT_KINDS.has(kind)) return `${v.toFixed(1)}%`;
    if (kind === 'minutes' || kind === 'moneyline') return String(Math.round(v));
    return v.toFixed(1);
  };

  const pills = (
    <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 min-w-0 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
      <div
        className={`w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar ${toggleRailPaddingClass}`}
        style={{ scrollbarWidth: 'thin' }}
      >
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
  );

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col gap-3 min-w-0">
        {pills}
        <div className={`min-h-[120px] flex items-center justify-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          No {ALL_TOGGLE_OPTIONS.find((o) => o.value === supportingStatKind)?.label ?? supportingStatKind} data
        </div>
      </div>
    );
  }

  const isPercent = chartData[0]?.isPercent ?? PCT_KINDS.has(supportingStatKind);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {pills}
      <div className={`w-full h-[380px] min-h-[340px] flex-shrink-0 min-w-0 pointer-events-none select-none ${alignRightTight ? 'lg:pr-6 xl:pr-7' : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart key={timeframe} data={chartData} margin={margin} barCategoryGap="5%">
            <XAxis
              dataKey="xKey"
              axisLine={{ stroke: isDark ? '#6b7280' : '#9ca3af', strokeWidth: 2 }}
              tickLine={false}
              tick={emptyTick}
              tickFormatter={() => ''}
              height={8}
              interval={0}
            />
            <Bar
              dataKey="value"
              radius={CHART_CONFIG.bar.radius}
              isAnimationActive={false}
              label={(props) => {
                const { x, y, width, value } = props;
                const payload = (props as { payload?: { isPercent?: boolean } }).payload;
                const numericValue = Number(value);
                return (
                  <text
                    x={Number(x ?? 0) + Number(width ?? 0) / 2}
                    y={Number(y ?? 0) - 6}
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
