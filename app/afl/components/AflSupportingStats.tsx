'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts';
import { CHART_CONFIG } from '@/app/nba/research/dashboard/constants';
import type { AflChartTimeframe } from '@/app/afl/components/AflStatsChart';

function toNumericValue(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type BaseRow = { xKey: string; opponent: string; key: string; tickLabel: string; round: string };

function parseRoundIndex(round: unknown): number {
  const text = String(round ?? '').trim().toUpperCase();
  if (!text) return Number.POSITIVE_INFINITY;
  const match = text.match(/(?:ROUND|R)?\s*(\d+)/);
  if (!match) return Number.POSITIVE_INFINITY;
  return parseInt(match[1], 10);
}

/** Apply same timeframe filter as AflStatsChart so bars match the main chart. */
function applyTimeframe<T extends BaseRow>(baseData: T[], timeframe: AflChartTimeframe): T[] {
  if (!baseData.length) return [];
  if (timeframe === 'thisseason' || timeframe === 'lastseason') return baseData;
  if (timeframe === 'h2h') {
    const latestOpponent = baseData[baseData.length - 1]?.opponent;
    if (!latestOpponent) return baseData;
    const h2h = baseData.filter((row) => row.opponent === latestOpponent);
    return (h2h.length ? h2h : baseData) as T[];
  }
  const lastN = parseInt(timeframe.replace('last', ''), 10);
  if (Number.isFinite(lastN) && lastN > 0) return baseData.slice(-lastN) as T[];
  return baseData;
}

export type SupportingStatKind =
  | 'tog'
  | 'kicks'
  | 'handballs'
  | 'effective_disposals'
  | 'disposal_efficiency'
  | 'behinds'
  | 'inside_50s'
  | 'marks_inside_50';

const DISPOSALS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG' },
  { value: 'kicks', label: 'Kicks' },
  { value: 'handballs', label: 'Handballs' },
  { value: 'effective_disposals', label: 'Effective disposals' },
  { value: 'disposal_efficiency', label: 'Disposal efficiency' },
];

const GOALS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG' },
  { value: 'behinds', label: 'Behinds' },
  { value: 'inside_50s', label: 'Inside 50s' },
  { value: 'marks_inside_50', label: 'Marks inside 50' },
];

/** For main chart stats that don't have their own supporting options yet, show TOG only. */
const DEFAULT_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG' },
];

interface AflSupportingStatsProps {
  gameLogs: Array<Record<string, unknown>>;
  timeframe: AflChartTimeframe;
  mainChartStat?: string;
  supportingStatKind: SupportingStatKind;
  onSupportingStatKindChange: (kind: SupportingStatKind) => void;
  isDark: boolean;
}

export function AflSupportingStats({
  gameLogs,
  timeframe,
  mainChartStat,
  supportingStatKind,
  onSupportingStatKindChange,
  isDark,
}: AflSupportingStatsProps) {
  const showDisposalsToggle = mainChartStat === 'disposals';
  const showGoalsToggle = mainChartStat === 'goals';
  const supportingOptions =
    showGoalsToggle
      ? GOALS_TOGGLE_OPTIONS
      : showDisposalsToggle
        ? DISPOSALS_TOGGLE_OPTIONS
        : DEFAULT_TOGGLE_OPTIONS;
  const showSupportingToggle = true;

  const baseData = useMemo(() => {
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
      const percentPlayed = Math.max(0, Math.min(100, toNumericValue(g.percent_played) ?? 0));
      const kicks = Math.max(0, toNumericValue(g.kicks) ?? 0);
      const handballs = Math.max(0, toNumericValue(g.handballs) ?? 0);
      const effectiveDisposals = Math.max(0, toNumericValue(g.effective_disposals) ?? 0);
      const disposalEfficiency = Math.max(0, Math.min(100, toNumericValue(g.disposal_efficiency) ?? 0));
      const behinds = Math.max(0, toNumericValue(g.behinds) ?? 0);
      const inside50s = Math.max(0, toNumericValue(g.inside_50s) ?? 0);
      const marksInside50 = Math.max(0, toNumericValue(g.marks_inside_50) ?? 0);
      const useTog = supportingStatKind === 'tog';
      const value =
        useTog
          ? percentPlayed
          : supportingStatKind === 'kicks'
            ? kicks
            : supportingStatKind === 'handballs'
              ? handballs
              : supportingStatKind === 'effective_disposals'
                ? effectiveDisposals
                : supportingStatKind === 'disposal_efficiency'
                  ? disposalEfficiency
                  : supportingStatKind === 'behinds'
                    ? behinds
                    : supportingStatKind === 'inside_50s'
                      ? inside50s
                      : marksInside50;
      const isPercent = useTog || supportingStatKind === 'disposal_efficiency';
      return {
        key,
        xKey: `G${gameNum}`,
        tickLabel: opponent,
        round,
        opponent,
        value,
        isPercent,
        gameDate: String(g.date ?? g.game_date ?? ''),
      };
    });
  }, [gameLogs, supportingStatKind]);

  const chartData = useMemo(() => {
    const data = applyTimeframe(baseData, timeframe);
    return [...data].sort((a, b) => {
      const aRi = parseRoundIndex(a.round);
      const bRi = parseRoundIndex(b.round);
      if (aRi !== bRi) return aRi - bRi;
      const aDate = new Date((a as { gameDate?: string }).gameDate ?? 0).getTime();
      const bDate = new Date((b as { gameDate?: string }).gameDate ?? 0).getTime();
      if (Number.isFinite(aDate) && Number.isFinite(bDate)) return aDate - bDate;
      return 0;
    });
  }, [baseData, timeframe]);

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
      const tog = Math.max(0, Math.min(100, toNumericValue(g.percent_played) ?? 0));
      const kicks = Math.max(0, toNumericValue(g.kicks) ?? 0);
      const handballs = Math.max(0, toNumericValue(g.handballs) ?? 0);
      const effective_disposals = Math.max(0, toNumericValue(g.effective_disposals) ?? 0);
      const disposal_efficiency = Math.max(0, Math.min(100, toNumericValue(g.disposal_efficiency) ?? 0));
      const behinds = Math.max(0, toNumericValue(g.behinds) ?? 0);
      const inside_50s = Math.max(0, toNumericValue(g.inside_50s) ?? 0);
      const marks_inside_50 = Math.max(0, toNumericValue(g.marks_inside_50) ?? 0);
      return { key, xKey: `G${gameNum}`, tickLabel: opponent, round, opponent, tog, kicks, handballs, effective_disposals, disposal_efficiency, behinds, inside_50s, marks_inside_50 };
    });
  }, [gameLogs]);

  const filteredAll = useMemo(
    () => applyTimeframe(baseDataAll, timeframe),
    [baseDataAll, timeframe]
  );

  const averagesByStat = useMemo(() => {
    if (!filteredAll.length)
      return { tog: null, kicks: null, handballs: null, effective_disposals: null, disposal_efficiency: null, behinds: null, inside_50s: null, marks_inside_50: null };
    const n = filteredAll.length;
    const tog = filteredAll.reduce((s, r) => s + r.tog, 0) / n;
    const kicks = filteredAll.reduce((s, r) => s + r.kicks, 0) / n;
    const handballs = filteredAll.reduce((s, r) => s + r.handballs, 0) / n;
    const effective_disposals = filteredAll.reduce((s, r) => s + r.effective_disposals, 0) / n;
    const disposal_efficiency = filteredAll.reduce((s, r) => s + r.disposal_efficiency, 0) / n;
    const behinds = filteredAll.reduce((s, r) => s + r.behinds, 0) / n;
    const inside_50s = filteredAll.reduce((s, r) => s + r.inside_50s, 0) / n;
    const marks_inside_50 = filteredAll.reduce((s, r) => s + r.marks_inside_50, 0) / n;
    return { tog, kicks, handballs, effective_disposals, disposal_efficiency, behinds, inside_50s, marks_inside_50 };
  }, [filteredAll]);

  const average = useMemo(() => {
    if (!chartData.length) return null;
    const sum = chartData.reduce((s, row) => s + row.value, 0);
    const avg = sum / chartData.length;
    const isPct = chartData[0]?.isPercent ?? supportingStatKind === 'tog';
    return { value: avg, isPercent: isPct };
  }, [chartData, supportingStatKind]);

  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const margin = { top: 24, right: 14, left: 0, bottom: 4 };
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const xAxisHeight = 8;
  const emptyTick = useMemo(
    () => ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x},${y})`} />,
    []
  );

  const formatLabel = (value: number, isPercent: boolean) =>
    isPercent ? `${Math.round(value)}%` : String(Math.round(value));

  const emptyMessage =
    supportingStatKind === 'tog'
      ? 'No % on ground data'
      : supportingStatKind === 'disposal_efficiency'
        ? 'No disposal efficiency data'
        : supportingStatKind === 'effective_disposals'
          ? 'No effective disposals data'
          : supportingStatKind === 'behinds'
            ? 'No behinds data'
            : supportingStatKind === 'inside_50s'
              ? 'No inside 50s data'
              : supportingStatKind === 'marks_inside_50'
                ? 'No marks inside 50 data'
                : `No ${supportingStatKind} data`;

  const formatAvg = (kind: SupportingStatKind) => {
    const v =
      kind === 'tog'
        ? averagesByStat.tog
        : kind === 'kicks'
          ? averagesByStat.kicks
          : kind === 'handballs'
            ? averagesByStat.handballs
            : kind === 'effective_disposals'
              ? averagesByStat.effective_disposals
              : kind === 'disposal_efficiency'
                ? averagesByStat.disposal_efficiency
                : kind === 'behinds'
                  ? averagesByStat.behinds
                  : kind === 'inside_50s'
                    ? averagesByStat.inside_50s
                    : averagesByStat.marks_inside_50;
    if (v == null || !Number.isFinite(v)) return '—';
    if (kind === 'tog' || kind === 'disposal_efficiency') return `${v.toFixed(1)}%`;
    return v.toFixed(1);
  };

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {showSupportingToggle && (
        <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
          <div className="flex flex-wrap gap-2 justify-center">
              {supportingOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onSupportingStatKindChange(o.value)}
                  className={`min-w-[100px] px-5 py-3 rounded-lg text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
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
            <div
              className={`h-px w-full shrink-0 ${
                isDark ? 'bg-gray-600' : 'bg-gray-300'
              }`}
              aria-hidden
            />
          </div>
        )}
        <div
          className={`min-h-[120px] flex items-center justify-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
        >
          {emptyMessage}
        </div>
      </div>
    );
  }

  const isPercent = chartData[0]?.isPercent ?? supportingStatKind === 'tog';

  return (
    <div className="flex flex-col gap-3">
      {showSupportingToggle && (
        <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
          <div className="flex flex-wrap gap-2 justify-center">
            {supportingOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onSupportingStatKindChange(o.value)}
                className={`min-w-[100px] px-5 py-3 rounded-lg text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
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
          <div
            className={`h-px w-full shrink-0 ${
              isDark ? 'bg-gray-600' : 'bg-gray-300'
            }`}
            aria-hidden
          />
        </div>
      )}
      <div className="w-full h-[380px] min-h-[340px] -mx-1 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={margin} barCategoryGap="5%">
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
              label={({ x, y, width, value, payload }) => (
                <text
                  x={(x ?? 0) + (width ?? 0) / 2}
                  y={(y ?? 0) - 6}
                  textAnchor="middle"
                  fill={labelFill}
                  fontSize={12}
                  fontWeight={500}
                >
                  {Number.isFinite(value)
                    ? formatLabel(value, (payload as { isPercent?: boolean })?.isPercent ?? isPercent)
                    : ''}
                </text>
              )}
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
