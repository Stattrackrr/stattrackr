'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, Cell } from 'recharts';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';
import type { SoccerStatTeamScope, SoccerTimeframe } from '@/app/soccer/components/SoccerStatsChart';

type SoccerVenueFilter = 'HOME' | 'AWAY';

type SoccerSupportingStatsProps = {
  matches: SoccerwayRecentMatch[];
  selectedTeamName: string;
  timeframe: SoccerTimeframe;
  teamScope: SoccerStatTeamScope;
  mainChartStat?: string;
  isDark: boolean;
};

type SupportingRow = {
  key: string;
  opponent: string;
  value: number;
  isPercent: boolean;
  gameSeason: number;
  kickoffMs: number;
};

const DEFAULT_SUPPORTING_OPTIONS = ['expected_goals_xg', 'shots_on_target', 'total_shots', 'ball_possession'];
const SUPPORTING_OPTIONS_BY_MAIN: Record<string, string[]> = {
  total_goals: ['expected_goals_xg', 'xg_on_target_xgot', 'shots_on_target', 'total_shots'],
  expected_goals_xg: ['xg_on_target_xgot', 'shots_on_target', 'big_chances', 'total_shots'],
  xg_on_target_xgot: ['expected_goals_xg', 'shots_on_target', 'big_chances', 'total_shots'],
  ball_possession: ['passes', 'accurate_passes', 'passes_in_final_third', 'touches_in_opposition_box'],
  total_shots: ['shots_on_target', 'shots_off_target', 'blocked_shots', 'expected_goals_xg'],
  shots_on_target: ['xg_on_target_xgot', 'big_chances', 'expected_goals_xg', 'total_shots'],
  shots_off_target: ['blocked_shots', 'total_shots', 'expected_goals_xg', 'shots_on_target'],
  blocked_shots: ['shots_off_target', 'total_shots', 'tackles', 'clearances'],
  passes: ['accurate_passes', 'ball_possession', 'passes_in_final_third', 'accurate_through_passes'],
  accurate_passes: ['passes', 'ball_possession', 'passes_in_final_third', 'accurate_through_passes'],
  tackles: ['duels_won', 'interceptions', 'clearances', 'fouls'],
  duels_won: ['tackles', 'interceptions', 'clearances', 'fouls'],
};
const PERCENT_STATS = new Set(['ball_possession']);

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

function getScopedValueForStat(params: {
  statMap: Record<string, number>;
  homeStatMap: Record<string, number>;
  awayStatMap: Record<string, number>;
  stat: string;
  teamScope: SoccerStatTeamScope;
}): number | null {
  const { statMap, homeStatMap, awayStatMap, stat, teamScope } = params;
  const homeValue = homeStatMap[stat];
  const awayValue = awayStatMap[stat];

  if (teamScope === 'all') {
    if (Number.isFinite(homeValue) && Number.isFinite(awayValue)) return homeValue + awayValue;
    return Number.isFinite(statMap[stat]) ? statMap[stat] : null;
  }
  if (teamScope === 'home') {
    return Number.isFinite(homeValue) ? homeValue : null;
  }
  return Number.isFinite(awayValue) ? awayValue : null;
}

function applyTimeframe(rows: SupportingRow[], timeframe: SoccerTimeframe): SupportingRow[] {
  if (!rows.length) return [];
  if (timeframe === 'all') return rows;
  if (timeframe.startsWith('season:')) {
    const year = Number.parseInt(timeframe.replace('season:', ''), 10);
    return rows.filter((row) => row.gameSeason === year);
  }
  const lastN = Number.parseInt(timeframe.replace('last', ''), 10);
  if (!Number.isFinite(lastN) || lastN <= 0) return rows;
  return rows.slice(-lastN);
}

function getSoccerSeasonYear(kickoff: Date | null): number {
  if (!kickoff) return 0;
  const month = kickoff.getUTCMonth();
  const year = kickoff.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function getOpponent(match: SoccerwayRecentMatch, selectedTeamName: string): string {
  const side = getSelectedTeamSide(match, selectedTeamName);
  return side === 'away' ? match.homeTeam : match.awayTeam;
}

export function SoccerSupportingStats({
  matches,
  selectedTeamName,
  timeframe,
  teamScope,
  mainChartStat,
  isDark,
}: SoccerSupportingStatsProps) {
  const normalizedRows = useMemo(() => {
    return matches
      .map((match) => {
        const side = getSelectedTeamSide(match, selectedTeamName);
        if (!side) return null;

        const statMap: Record<string, number> = {};
        const homeStatMap: Record<string, number> = {};
        const awayStatMap: Record<string, number> = {};
        for (const stat of getMatchPeriodStats(match)) {
          const key = formatStatKey(stat.name);
          const homeValue = parseNumericValue(stat.homeValue);
          const awayValue = parseNumericValue(stat.awayValue);
          const value = getTeamValueForStat(match, selectedTeamName, stat);
          if (homeValue != null) homeStatMap[key] = homeValue;
          if (awayValue != null) awayStatMap[key] = awayValue;
          if (value == null) continue;
          statMap[key] = value;
        }

        const kickoff = match.kickoffUnix != null ? new Date(match.kickoffUnix * 1000) : null;
        return {
          match,
          statMap,
          homeStatMap,
          awayStatMap,
          kickoffMs: kickoff?.getTime() ?? 0,
          gameSeason: getSoccerSeasonYear(kickoff),
          opponent: getOpponent(match, selectedTeamName),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => a.kickoffMs - b.kickoffMs);
  }, [matches, selectedTeamName]);

  const availableStats = useMemo(() => {
    const keys = new Set<string>();
    for (const row of normalizedRows) {
      for (const [key, value] of Object.entries(row.statMap)) {
        if (Number.isFinite(value)) keys.add(key);
      }
    }
    return keys;
  }, [normalizedRows]);

  const supportingOptions = useMemo(() => {
    const preferred = SUPPORTING_OPTIONS_BY_MAIN[mainChartStat || ''] || DEFAULT_SUPPORTING_OPTIONS;
    const filtered = preferred.filter((key) => key !== mainChartStat && availableStats.has(key));
    if (filtered.length > 0) return filtered;
    return Array.from(availableStats).filter((key) => key !== mainChartStat).slice(0, 4);
  }, [availableStats, mainChartStat]);

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
    const rows = normalizedRows
      .map((row, idx) => {
        const value = getScopedValueForStat({
          statMap: row.statMap,
          homeStatMap: row.homeStatMap,
          awayStatMap: row.awayStatMap,
          stat: selectedSupportingStat,
          teamScope,
        });
        if (!Number.isFinite(value)) return null;
        return {
          key: `${row.match.matchId}-${idx}`,
          opponent: row.opponent,
          value: value as number,
          isPercent: PERCENT_STATS.has(selectedSupportingStat),
          gameSeason: row.gameSeason,
          kickoffMs: row.kickoffMs,
        } satisfies SupportingRow;
      })
      .filter((row): row is SupportingRow => row != null);
    return applyTimeframe(rows, timeframe);
  }, [normalizedRows, selectedSupportingStat, teamScope, timeframe]);

  const averagesByStat = useMemo(() => {
    const averages = new Map<string, number | null>();
    for (const stat of supportingOptions) {
      const values = applyTimeframe(
        normalizedRows
          .map((row, idx) => {
            const value = getScopedValueForStat({
              statMap: row.statMap,
              homeStatMap: row.homeStatMap,
              awayStatMap: row.awayStatMap,
              stat,
              teamScope,
            });
            if (!Number.isFinite(value)) return null;
            return {
              key: `${row.match.matchId}-${idx}`,
              opponent: row.opponent,
              value: value as number,
              isPercent: PERCENT_STATS.has(stat),
              gameSeason: row.gameSeason,
              kickoffMs: row.kickoffMs,
            } satisfies SupportingRow;
          })
          .filter((row): row is SupportingRow => row != null),
        timeframe
      ).map((row) => row.value);
      if (!values.length) {
        averages.set(stat, null);
        continue;
      }
      averages.set(stat, values.reduce((sum, value) => sum + value, 0) / values.length);
    }
    return averages;
  }, [normalizedRows, supportingOptions, teamScope, timeframe]);

  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const emptyMessage = selectedSupportingStat
    ? `No ${formatStatLabel(selectedSupportingStat).toLowerCase()} data`
    : 'No supporting stats available';

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 min-w-0 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
        <div
          className="w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar px-3 sm:px-4"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="flex flex-nowrap gap-2 justify-start min-w-min pb-1">
            {supportingOptions.map((option) => {
              const avg = averagesByStat.get(option);
              const avgLabel =
                avg == null
                  ? '—'
                  : PERCENT_STATS.has(option)
                    ? `${avg.toFixed(1)}%`
                    : avg.toFixed(1);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSelectedSupportingStat(option)}
                  className={`flex-shrink-0 min-w-[88px] sm:min-w-[110px] px-3 sm:px-5 py-2.5 sm:py-3 rounded-lg text-sm sm:text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                    selectedSupportingStat === option
                      ? isDark
                        ? 'bg-gray-600 text-gray-100'
                        : 'bg-gray-500 text-white'
                      : isDark
                        ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  }`}
                >
                  <span>{formatStatLabel(option)}</span>
                  <span className="text-xs font-normal opacity-90">{avgLabel}</span>
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
            <BarChart data={chartData} margin={{ top: 24, right: 0, left: 0, bottom: 4 }} barCategoryGap="5%">
              <XAxis
                dataKey="key"
                axisLine={{ stroke: isDark ? '#6b7280' : '#9ca3af', strokeWidth: 2 }}
                tickLine={false}
                tick={false}
                tickFormatter={() => ''}
                height={8}
                interval={0}
              />
              <Bar
                dataKey="value"
                radius={[10, 10, 10, 10]}
                isAnimationActive={false}
                label={(props) => {
                  const { x, y, width, value } = props;
                  const payload = (props as { payload?: { isPercent?: boolean } }).payload;
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
                      {payload?.isPercent ? `${Math.round(numericValue)}%` : String(Math.round(numericValue))}
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
}
