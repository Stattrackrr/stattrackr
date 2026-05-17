'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { PlayerMatchStats } from '@/lib/soccerPlayerStatsScrape';
import { readPlayerMatchStatNumber } from '@/lib/soccerStatKeyAliases';
import type { SoccerPlayerChartTimeframe } from '@/app/soccer/components/soccerPlayerPropsTypes';
import {
  filterPlayerMatchesByCompetition,
  getPlayerChartMatches,
  getSoccerSeasonYear,
} from '@/app/soccer/components/soccerPlayerChartMatches';
import {
  buildSupportingStatKeys,
  getSoccerPlayerStatLabel,
} from '@/app/soccer/components/soccerPlayerStatCatalog';

type SoccerPlayerSupportingStatsProps = {
  matches: PlayerMatchStats[];
  mainStatKey: string;
  timeframe: SoccerPlayerChartTimeframe;
  competitionFilter?: string;
  nextOpponentName?: string | null;
  isDark: boolean;
};

type SupportingRow = {
  key: string;
  opponent: string;
  value: number;
  usesDecimal: boolean;
  gameSeason: number;
  kickoffMs: number;
};

function formatSupportingValue(value: number, usesDecimal: boolean): string {
  if (usesDecimal || Math.abs(value - Math.round(value)) > 0.001) return value.toFixed(1);
  return String(Math.round(value));
}

function getSupportingYAxisConfig(values: number[]): { domain: [number, number]; ticks: number[] } {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) return { domain: [0, 10], ticks: [0, 3, 7, 10] };
  const maxValue = Math.max(...finiteValues);
  const hasDecimals = finiteValues.some((value) => Math.abs(value - Math.round(value)) > 0.001);
  const bound = Math.max(hasDecimals ? Math.ceil(maxValue * 10) / 10 : Math.ceil(maxValue), 1);
  const step = bound / 3;
  const ticks = [0, step, step * 2, bound].map((value) =>
    hasDecimals ? Math.round(value * 10) / 10 : Math.round(value)
  );
  return { domain: [0, bound], ticks };
}

export const SoccerPlayerSupportingStats = memo(function SoccerPlayerSupportingStats({
  matches,
  mainStatKey,
  timeframe,
  competitionFilter = 'all',
  nextOpponentName = null,
  isDark,
}: SoccerPlayerSupportingStatsProps) {
  const currentSeasonYear = useMemo(() => getSoccerSeasonYear(new Date()), []);

  const competitionFilteredMatches = useMemo(
    () => filterPlayerMatchesByCompetition(matches, competitionFilter),
    [competitionFilter, matches]
  );

  const chartMatches = useMemo(
    () =>
      getPlayerChartMatches(matches, timeframe, {
        competitionFilter,
        nextOpponentName,
        currentSeasonYear,
      }),
    [competitionFilter, currentSeasonYear, matches, nextOpponentName, timeframe]
  );

  const supportingOptions = useMemo(
    () => buildSupportingStatKeys(competitionFilteredMatches, mainStatKey),
    [competitionFilteredMatches, mainStatKey]
  );

  const [selectedSupportingStat, setSelectedSupportingStat] = useState('');

  useEffect(() => {
    if (!supportingOptions.length) {
      setSelectedSupportingStat('');
      return;
    }
    if (selectedSupportingStat && supportingOptions.includes(selectedSupportingStat)) return;
    setSelectedSupportingStat(supportingOptions[0]);
  }, [selectedSupportingStat, supportingOptions]);

  const chartData = useMemo(() => {
    if (!selectedSupportingStat) return [];
    return chartMatches.map((match, idx) => {
      const numeric = readPlayerMatchStatNumber(match.categories, selectedSupportingStat) ?? 0;
      const kickoff = match.kickoffUnix != null ? new Date(match.kickoffUnix * 1000) : null;
      return {
        key: `${match.matchId}-${idx}`,
        opponent: match.opponent,
        value: numeric,
        usesDecimal: Math.abs(numeric - Math.round(numeric)) > 0.001,
        gameSeason: getSoccerSeasonYear(kickoff),
        kickoffMs: kickoff?.getTime() ?? 0,
      } satisfies SupportingRow;
    });
  }, [chartMatches, selectedSupportingStat]);

  const averagesByStat = useMemo(() => {
    const averages = new Map<string, number | null>();
    if (!chartMatches.length) return averages;
    for (const stat of supportingOptions) {
      const values = chartMatches.map((match) => readPlayerMatchStatNumber(match.categories, stat) ?? 0);
      averages.set(stat, values.reduce((sum, value) => sum + value, 0) / values.length);
    }
    return averages;
  }, [chartMatches, supportingOptions]);

  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const supportingYAxisConfig = useMemo(
    () => getSupportingYAxisConfig(chartData.map((row) => row.value)),
    [chartData]
  );

  const emptyMessage = selectedSupportingStat
    ? !chartMatches.length && timeframe === 'h2h'
      ? nextOpponentName?.trim()
        ? 'No H2H matches for the upcoming opponent'
        : 'No upcoming opponent found for H2H timeframe'
      : !chartMatches.length
        ? 'No matches in this timeframe'
        : `No ${getSoccerPlayerStatLabel(selectedSupportingStat).toLowerCase()} data`
    : 'No supporting stats available';

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 min-w-0 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
        <div
          className="w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar px-3 sm:px-4"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="flex flex-nowrap gap-2 justify-start min-w-min pb-1">
            {supportingOptions.map((option, index) => {
              const avg = averagesByStat.get(option);
              const avgLabel = avg == null ? '—' : formatSupportingValue(avg, Math.abs(avg - Math.round(avg)) > 0.001);
              return (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  onClick={() => setSelectedSupportingStat(option)}
                  className={`flex-shrink-0 min-w-[88px] sm:min-w-[100px] max-w-[140px] px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 text-center leading-tight ${
                    selectedSupportingStat === option
                      ? isDark
                        ? 'bg-gray-600 text-gray-100'
                        : 'bg-gray-500 text-white'
                      : isDark
                        ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  }`}
                >
                  <span className="line-clamp-2">{getSoccerPlayerStatLabel(option)}</span>
                  <span className="text-[10px] sm:text-xs font-normal opacity-90">{avgLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className={`h-px w-full shrink-0 ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} aria-hidden />
      </div>

      {chartData.length === 0 ? (
        <div className={`min-h-[120px] flex items-center justify-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {emptyMessage}
        </div>
      ) : (
        <div className="w-full h-[320px] min-h-[280px] flex-shrink-0 min-w-0 pointer-events-none select-none">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }} barCategoryGap="5%">
              <YAxis
                domain={supportingYAxisConfig.domain}
                ticks={supportingYAxisConfig.ticks}
                axisLine={false}
                tickLine={false}
                tick={false}
                width={34}
              />
              <XAxis dataKey="key" axisLine={false} tickLine={false} tick={false} height={0} interval={0} />
              <ReferenceLine y={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeWidth={2} ifOverflow="extendDomain" />
              <Bar
                dataKey="value"
                radius={[10, 10, 0, 0]}
                isAnimationActive={false}
                label={(props) => {
                  const { x, y, width, value } = props;
                  const payload = (props as { payload?: { usesDecimal?: boolean } }).payload;
                  const numericValue = Number(value);
                  if (!Number.isFinite(numericValue)) return null;
                  return (
                    <text
                      x={Number(x ?? 0) + Number(width ?? 0) / 2}
                      y={Number(y ?? 0) - 6}
                      textAnchor="middle"
                      fill={labelFill}
                      fontSize={12}
                      fontWeight={500}
                    >
                      {formatSupportingValue(numericValue, Boolean(payload?.usesDecimal))}
                    </text>
                  );
                }}
              >
                {chartData.map((row) => (
                  <Cell key={row.key} fill={barFill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
});
