'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Cell, ReferenceLine } from 'recharts';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';
import {
  SOCCER_BETTABLE_STATS,
  SOCCER_STAT_PRIORITY,
  type SoccerStatTeamScope,
  type SoccerTimeframe,
} from '@/app/soccer/components/SoccerStatsChart';

type SoccerVenueFilter = 'HOME' | 'AWAY';

type SoccerSupportingStatsProps = {
  matches: SoccerwayRecentMatch[];
  selectedTeamName: string;
  timeframe: SoccerTimeframe;
  teamScope: SoccerStatTeamScope;
  competitionFilter?: string;
  mainChartStat?: string;
  isDark: boolean;
};

type SupportingRow = {
  key: string;
  opponent: string;
  value: number;
  isPercent: boolean;
  usesDecimal: boolean;
  gameSeason: number;
  kickoffMs: number;
};

const PERCENT_STATS = new Set(['ball_possession']);
const DEFAULT_SUPPORTING_OPTIONS = ['expected_goals_xg', 'xg_on_target_xgot', 'expected_assists_xa', 'ball_possession'];
const SUPPORTING_OPTIONS_BY_MAIN: Record<string, string[]> = {
  moneyline: ['expected_goals_xg', 'xg_on_target_xgot', 'total_shots', 'shots_on_target', 'expected_assists_xa', 'ball_possession'],
  total_goals: ['expected_goals_xg', 'xg_on_target_xgot', 'total_shots', 'shots_on_target', 'expected_assists_xa', 'ball_possession'],
  total_shots: ['shots_on_target', 'shots_off_target', 'touches_in_opposition_box', 'shots_inside_the_box', 'shots_outside_the_box'],
  shots_on_target: ['total_shots', 'blocked_shots', 'xg_on_target_xgot', 'expected_goals_xg', 'expected_assists_xa', 'accurate_through_passes'],
  shots_off_target: ['total_shots', 'expected_goals_xg', 'ball_possession', 'crosses', 'hit_the_woodwork'],
  blocked_shots: ['total_shots', 'expected_goals_xg', 'crosses', 'passes_in_final_third', 'touches_in_opposition_box'],
  big_chances: ['expected_goals_xg', 'xg_on_target_xgot', 'expected_assists_xa', 'touches_in_opposition_box'],
  corner_kicks: ['crosses', 'passes_in_final_third', 'touches_in_opposition_box', 'ball_possession'],
  yellow_cards: ['fouls', 'free_kicks', 'tackles', 'duels_won', 'interceptions', 'clearances', 'offsides'],
  red_cards: ['fouls', 'free_kicks', 'tackles', 'duels_won', 'interceptions', 'clearances', 'offsides'],
  fouls: ['yellow_cards', 'red_cards', 'tackles', 'duels_won', 'interceptions', 'clearances', 'offsides'],
  free_kicks: ['fouls', 'offsides', 'crosses', 'passes_in_final_third', 'ball_possession'],
  touches_in_opposition_box: ['expected_goals_xg', 'xg_on_target_xgot', 'expected_assists_xa', 'passes_in_final_third'],
  tackles: ['duels_won', 'interceptions', 'clearances', 'fouls'],
  goalkeeper_saves: ['total_shots', 'shots_on_target', 'xgot_faced', 'goals_prevented', 'clearances', 'interceptions'],
  shots_inside_the_box: ['total_shots', 'shots_on_target', 'expected_goals_xg', 'xg_on_target_xgot', 'expected_assists_xa', 'touches_in_opposition_box'],
  shots_outside_the_box: ['total_shots', 'shots_on_target', 'xg_on_target_xgot', 'hit_the_woodwork', 'ball_possession', 'crosses'],
};

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
  opponentStatMap: Record<string, number>;
  homeStatMap: Record<string, number>;
  awayStatMap: Record<string, number>;
  stat: string;
  teamScope: SoccerStatTeamScope;
}): number | null {
  const { statMap, opponentStatMap, homeStatMap, awayStatMap, stat, teamScope } = params;
  const homeValue = homeStatMap[stat];
  const awayValue = awayStatMap[stat];
  const teamValue = statMap[stat];
  const opponentValue = opponentStatMap[stat];

  if (teamScope === 'all') {
    if (stat === 'ball_possession') {
      return Number.isFinite(teamValue) ? teamValue : null;
    }
    if (Number.isFinite(homeValue) && Number.isFinite(awayValue)) return homeValue + awayValue;
    return Number.isFinite(teamValue) ? teamValue : null;
  }
  if (teamScope === 'team') {
    return Number.isFinite(teamValue) ? teamValue : null;
  }
  return Number.isFinite(opponentValue) ? opponentValue : null;
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

function getCompetitionKey(match: SoccerwayRecentMatch): string {
  const country = String(match.competitionCountry || '').trim();
  const competition = String(match.competitionName || '').trim();
  return `${country}:::${competition}`;
}

function formatSupportingValue(value: number, options?: { isPercent?: boolean; usesDecimal?: boolean }): string {
  if (options?.isPercent) return `${value.toFixed(1)}%`;
  if (options?.usesDecimal || Math.abs(value - Math.round(value)) > 0.001) return value.toFixed(1);
  return String(Math.round(value));
}

function getSupportingYAxisConfig(values: number[]): { domain: [number, number]; ticks: number[] } {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return { domain: [0, 10], ticks: [0, 3, 7, 10] };
  }

  const maxValue = Math.max(...finiteValues);
  const hasDecimals = finiteValues.some((value) => Math.abs(value - Math.round(value)) > 0.001);
  const bound = Math.max(hasDecimals ? Math.ceil(maxValue * 10) / 10 : Math.ceil(maxValue), 1);
  const step = bound / 3;
  const ticks = [0, step, step * 2, bound].map((value) =>
    hasDecimals ? Math.round(value * 10) / 10 : Math.round(value)
  );

  return {
    domain: [0, bound],
    ticks,
  };
}

export const SoccerSupportingStats = memo(function SoccerSupportingStats({
  matches,
  selectedTeamName,
  timeframe,
  teamScope,
  competitionFilter = 'all',
  mainChartStat,
  isDark,
}: SoccerSupportingStatsProps) {
  const normalizedRows = useMemo(() => {
    return matches
      .map((match) => {
        const side = getSelectedTeamSide(match, selectedTeamName);
        if (!side) return null;

        const statMap: Record<string, number> = {};
        const opponentStatMap: Record<string, number> = {};
        const homeStatMap: Record<string, number> = {};
        const awayStatMap: Record<string, number> = {};
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
        }

        const kickoff = match.kickoffUnix != null ? new Date(match.kickoffUnix * 1000) : null;
        return {
          match,
          side,
          statMap,
          opponentStatMap,
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

  const filteredNormalizedRows = useMemo(() => {
    if (competitionFilter === 'all') return normalizedRows;
    return normalizedRows.filter((row) => getCompetitionKey(row.match) === competitionFilter);
  }, [competitionFilter, normalizedRows]);

  const availableStats = useMemo(() => {
    const keys = new Set<string>();
    for (const row of filteredNormalizedRows) {
      for (const [key, value] of Object.entries(row.statMap)) {
        if (Number.isFinite(value)) keys.add(key);
      }
    }
    return keys;
  }, [filteredNormalizedRows]);

  const supportingOptions = useMemo(() => {
    const preferredKeys = SUPPORTING_OPTIONS_BY_MAIN[mainChartStat || ''] || DEFAULT_SUPPORTING_OPTIONS;
    const candidateStats = Array.from(availableStats).filter(
      (key) => key !== mainChartStat && (!SOCCER_BETTABLE_STATS.has(key) || preferredKeys.includes(key))
    );
    const preferred = preferredKeys.filter((key) => candidateStats.includes(key));
    if (preferred.length > 0) return preferred;

    const ordered: string[] = [];
    for (const key of SOCCER_STAT_PRIORITY) {
      if (candidateStats.includes(key)) ordered.push(key);
    }
    for (const key of candidateStats) {
      if (!ordered.includes(key)) ordered.push(key);
    }
    return ordered;
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
    const rows = filteredNormalizedRows
      .map((row, idx) => {
        const value = getScopedValueForStat({
          statMap: row.statMap,
              opponentStatMap: row.opponentStatMap,
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
          usesDecimal: Math.abs((value as number) - Math.round(value as number)) > 0.001,
          gameSeason: row.gameSeason,
          kickoffMs: row.kickoffMs,
        } satisfies SupportingRow;
      })
      .filter((row): row is SupportingRow => row != null);
    return applyTimeframe(rows, timeframe);
  }, [filteredNormalizedRows, selectedSupportingStat, teamScope, timeframe]);

  const averagesByStat = useMemo(() => {
    const averages = new Map<string, number | null>();
    for (const stat of supportingOptions) {
      const values = applyTimeframe(
        filteredNormalizedRows
          .map((row, idx) => {
            const value = getScopedValueForStat({
              statMap: row.statMap,
              opponentStatMap: row.opponentStatMap,
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
              usesDecimal: Math.abs((value as number) - Math.round(value as number)) > 0.001,
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
  }, [filteredNormalizedRows, supportingOptions, teamScope, timeframe]);

  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const supportingYAxisConfig = useMemo(
    () => getSupportingYAxisConfig(chartData.map((row) => row.value)),
    [chartData]
  );
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
            <BarChart data={chartData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }} barCategoryGap="5%">
              <YAxis
                domain={supportingYAxisConfig.domain}
                ticks={supportingYAxisConfig.ticks}
                axisLine={false}
                tickLine={false}
                tick={false}
                width={34}
              />
              <XAxis
                dataKey="key"
                axisLine={false}
                tickLine={false}
                tick={false}
                tickFormatter={() => ''}
                height={0}
                allowDuplicatedCategory={false}
                interval={0}
              />
              <ReferenceLine y={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeWidth={2} ifOverflow="extendDomain" />
              <Bar
                dataKey="value"
                radius={[10, 10, 0, 0]}
                isAnimationActive={false}
                label={(props) => {
                  const { x, y, width, value } = props;
                  const payload = (props as { payload?: { isPercent?: boolean; usesDecimal?: boolean } }).payload;
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
                      {formatSupportingValue(numericValue, {
                        isPercent: payload?.isPercent,
                        usesDecimal: payload?.usesDecimal,
                      })}
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
