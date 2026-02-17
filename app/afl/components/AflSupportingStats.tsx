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

/** Apply same timeframe filter as AflStatsChart so bars match the main chart. */
function applyTimeframe(
  baseData: Array<{ xKey: string; opponent: string; value: number; key: string; tickLabel: string; round: string }>,
  timeframe: AflChartTimeframe
): typeof baseData {
  if (!baseData.length) return [];
  if (timeframe === 'thisseason' || timeframe === 'lastseason') return baseData;
  if (timeframe === 'h2h') {
    const latestOpponent = baseData[baseData.length - 1]?.opponent;
    if (!latestOpponent) return baseData;
    const h2h = baseData.filter((row) => row.opponent === latestOpponent);
    return h2h.length ? h2h : baseData;
  }
  const lastN = parseInt(timeframe.replace('last', ''), 10);
  if (Number.isFinite(lastN) && lastN > 0) return baseData.slice(-lastN);
  return baseData;
}

interface AflSupportingStatsProps {
  gameLogs: Array<Record<string, unknown>>;
  timeframe: AflChartTimeframe;
  isDark: boolean;
}

export function AflSupportingStats({ gameLogs, timeframe, isDark }: AflSupportingStatsProps) {
  const baseData = useMemo(() => {
    if (!Array.isArray(gameLogs) || gameLogs.length === 0) return [];
    const sorted = [...gameLogs].sort((a, b) => {
      const aNum = typeof a.game_number === 'number' ? a.game_number : Number(a.game_number ?? 0);
      const bNum = typeof b.game_number === 'number' ? b.game_number : Number(b.game_number ?? 0);
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
      const aDate = new Date(String(a.date ?? a.game_date ?? '')).getTime();
      const bDate = new Date(String(b.date ?? b.game_date ?? '')).getTime();
      if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;
      return 0;
    });
    return sorted.map((g, idx) => {
      const gameNum = typeof g.game_number === 'number' ? g.game_number : idx + 1;
      const round = String(g.round ?? '-');
      const opponent = String(g.opponent ?? '-');
      const key = `${gameNum}-${round}-${opponent}-${idx}`;
      const value = toNumericValue(g.percent_played) ?? 0;
      return {
        key,
        xKey: `G${gameNum}`,
        tickLabel: opponent,
        round,
        opponent,
        value: Math.max(0, Math.min(100, value)),
      };
    });
  }, [gameLogs]);

  const chartData = useMemo(
    () => applyTimeframe(baseData, timeframe),
    [baseData, timeframe]
  );

  const barFill = CHART_CONFIG.colors.purple;
  const margin = { top: 28, right: 14, left: 0, bottom: 19 };
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const emptyTick = useMemo(
    () => ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x},${y})`} />,
    []
  );

  if (chartData.length === 0) {
    return (
      <div className={`min-h-[120px] flex items-center justify-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        No % played data
      </div>
    );
  }

  return (
    <div className="w-full h-[280px] min-h-[240px] -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={margin}
          barCategoryGap="5%"
        >
          <XAxis
            dataKey="xKey"
            axisLine={{ stroke: isDark ? '#6b7280' : '#9ca3af', strokeWidth: 2 }}
            tickLine={false}
            tick={emptyTick}
            tickFormatter={() => ''}
            height={CHART_CONFIG.xAxis.height}
            interval={0}
          />
          <Bar
            dataKey="value"
            radius={CHART_CONFIG.bar.radius}
            isAnimationActive={false}
            label={({ x, y, width, value }) => (
              <text
                x={(x ?? 0) + (width ?? 0) / 2}
                y={(y ?? 0) - 6}
                textAnchor="middle"
                fill={labelFill}
                fontSize={12}
                fontWeight={500}
              >
                {Number.isFinite(value) ? `${Math.round(value)}%` : ''}
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
  );
}
