'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Search, Trophy, Users } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabaseClient';

const DASH_CARD_GLOW =
  'border border-gray-200 dark:border-[#463e6b] bg-white dark:bg-[#0a1929] shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_20px_rgba(124,58,237,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22),0_0_36px_rgba(124,58,237,0.22)]';

type PropsMode = 'player' | 'team';
type OddsFormat = 'american' | 'decimal';
type InsightTab = 'dvp' | 'opponent' | 'matchup';

type WorldCupTeamOption = {
  id: string;
  name: string;
  abbreviation: string;
  group: string;
  confederation: string;
};

type WorldCupPlayerOption = {
  id: string;
  name: string;
  shortName: string;
  teamName: string;
  teamId: string | null;
  countryCode: string | null;
  number: string;
  role: string;
};

type WorldCupDashboardData = {
  season: number;
  teams: Array<{
    id: number;
    name: string;
    abbreviation?: string | null;
    country_code?: string | null;
    confederation?: string | null;
  }>;
  standings: Array<Record<string, any>>;
  matches: Array<Record<string, any>>;
  playerMatches?: Array<Record<string, any>>;
  selectedTeam: {
    id: number;
    name: string;
    abbreviation?: string | null;
    country_code?: string | null;
    confederation?: string | null;
  } | null;
  featureMatch: Record<string, any> | null;
  selectedTeamMatches: Array<Record<string, any>>;
  rosters: Array<Record<string, any>>;
  teamMatchStats: Array<Record<string, any>>;
  playerMatchStats: Array<Record<string, any>>;
  lineups: Array<Record<string, any>>;
  events: Array<Record<string, any>>;
  shots: Array<Record<string, any>>;
  playerShots?: Array<Record<string, any>>;
  momentum: Array<Record<string, any>>;
  bestPlayers: Array<Record<string, any>>;
  avgPositions: Array<Record<string, any>>;
  teamForm: Array<Record<string, any>>;
  odds: Array<Record<string, any>>;
  futures: Array<Record<string, any>>;
};

const WORLD_CUP_TEAMS: WorldCupTeamOption[] = [
  { id: 'arg', name: 'Argentina', abbreviation: 'ARG', group: 'Group pending', confederation: 'CONMEBOL' },
  { id: 'aus', name: 'Australia', abbreviation: 'AUS', group: 'Group pending', confederation: 'AFC' },
  { id: 'bra', name: 'Brazil', abbreviation: 'BRA', group: 'Group pending', confederation: 'CONMEBOL' },
  { id: 'eng', name: 'England', abbreviation: 'ENG', group: 'Group pending', confederation: 'UEFA' },
  { id: 'fra', name: 'France', abbreviation: 'FRA', group: 'Group pending', confederation: 'UEFA' },
  { id: 'mex', name: 'Mexico', abbreviation: 'MEX', group: 'Group A', confederation: 'CONCACAF' },
  { id: 'usa', name: 'United States', abbreviation: 'USA', group: 'Group pending', confederation: 'CONCACAF' },
];

const WORLD_CUP_PLAYERS: WorldCupPlayerOption[] = [
  { id: 'player-1', name: 'World Cup Player', shortName: 'WCP', teamName: 'Select team after API', teamId: null, countryCode: null, number: '10', role: 'FWD' },
  { id: 'player-2', name: 'Tournament Midfielder', shortName: 'TM', teamName: 'Select team after API', teamId: null, countryCode: null, number: '8', role: 'MID' },
  { id: 'player-3', name: 'Starting Goalkeeper', shortName: 'SG', teamName: 'Select team after API', teamId: null, countryCode: null, number: '1', role: 'GK' },
];

const TEAM_METRICS = ['xG', 'Shots', 'SOT', 'Big chances', 'Corners', 'Possession', 'Cards', 'Fouls'];
const PLAYER_METRICS = ['Goals', 'Assists', 'xG', 'xA', 'SOT', 'Key passes', 'Touches', 'Duels'];
const ROLE_ROWS = ['Striker', 'Winger', 'Attacking mid', 'Central mid', 'Fullback', 'Centre back', 'Goalkeeper'];
const WORLD_CUP_STAT_OPTIONS = [
  // Player main chart order mirrors app/soccer/components/soccerPlayerStatCatalog.ts
  { id: 'goals', label: 'Goals', playerKey: 'goals', teamKey: null },
  { id: 'assists', label: 'Assists', playerKey: 'assists', teamKey: null },
  { id: 'total_shots', label: 'Total Shots', playerKey: 'derived_shots_total', teamKey: 'shots_total' },
  { id: 'shots_on_target', label: 'Shots on Target', playerKey: 'shots_on_target', teamKey: 'shots_on_target' },
  { id: 'accurate_passes', label: 'Passes', playerKey: 'passes_accurate', teamKey: 'passes_accurate' },
  { id: 'big_chances_created', label: 'Big Chances Created', playerKey: 'big_chances_created', teamKey: 'big_chances' },
  { id: 'fouls_committed', label: 'Fouls Committed', playerKey: 'fouls_committed', teamKey: 'fouls' },
  { id: 'fouls_suffered', label: 'Fouls Suffered', playerKey: 'was_fouled', teamKey: null },
  { id: 'duels_won', label: 'Duels Won', playerKey: 'duels_won', teamKey: null },
  { id: 'yellow_cards', label: 'Yellow Cards', playerKey: 'yellow_cards', teamKey: 'yellow_cards' },
  { id: 'red_cards', label: 'Red Cards', playerKey: 'red_cards', teamKey: null },

  // Goalkeeper main chart order mirrors app/soccer/components/soccerPlayerStatCatalog.ts
  { id: 'goalkeeper_saves', label: 'GK Saves', playerKey: 'saves', teamKey: 'saves' },
  { id: 'saves_inside_box', label: 'Saves Inside Box', playerKey: 'saves_inside_box', teamKey: null },
  { id: 'punches', label: 'Punches', playerKey: 'punches', teamKey: null },
  { id: 'high_claims', label: 'High Claims', playerKey: 'high_claims', teamKey: null },

  // Extra supporting/team stat universe, ordered to mirror SoccerStatsChart where possible.
  { id: 'expected_goals_xg', label: 'xG', playerKey: 'expected_goals', teamKey: 'expected_goals' },
  { id: 'expected_assists_xa', label: 'xA', playerKey: 'expected_assists', teamKey: null },
  { id: 'ball_possession', label: 'Ball Possession', playerKey: null, teamKey: 'possession_pct' },
  { id: 'big_chances', label: 'Big Chances', playerKey: 'big_chances_created', teamKey: 'big_chances' },
  { id: 'big_chances_missed', label: 'Big Chances Missed', playerKey: 'big_chances_missed', teamKey: 'big_chances_missed' },
  { id: 'corner_kicks', label: 'Corner Kicks', playerKey: null, teamKey: 'corners' },
  { id: 'passes', label: 'Passes', playerKey: 'passes_total', teamKey: 'passes_total' },
  { id: 'passes_in_final_third', label: 'Passes in Final Third', playerKey: null, teamKey: 'passes_final_third' },
  { id: 'crosses', label: 'Crosses', playerKey: 'crosses_total', teamKey: 'crosses_total' },
  { id: 'possession_lost', label: 'Possession Lost', playerKey: 'possession_lost', teamKey: null },
  { id: 'successful_dribbles', label: 'Successful Dribbles', playerKey: 'dribbles_completed', teamKey: 'dribbles_completed' },
  { id: 'dribbles_attempted', label: 'Dribbles Attempted', playerKey: 'dribbles_attempted', teamKey: 'dribbles_total' },
  { id: 'tackles', label: 'Tackles', playerKey: 'tackles', teamKey: 'tackles' },
  { id: 'tackles_won', label: 'Tackles Won', playerKey: 'tackles_won', teamKey: null },
  { id: 'clearances', label: 'Clearances', playerKey: 'clearances', teamKey: 'clearances' },
  { id: 'duels_lost', label: 'Duels Lost', playerKey: 'duels_lost', teamKey: null },
  { id: 'ground_duels_won', label: 'Ground Duels Won', playerKey: null, teamKey: 'ground_duels_won' },
  { id: 'ground_duels_total', label: 'Ground Duels', playerKey: null, teamKey: 'ground_duels_total' },
  { id: 'offsides', label: 'Offsides', playerKey: null, teamKey: 'offsides' },
  { id: 'throw_ins', label: 'Throw Ins', playerKey: null, teamKey: 'throw_ins' },
  { id: 'goal_kicks', label: 'Goal Kicks', playerKey: null, teamKey: 'goal_kicks' },
  { id: 'free_kicks', label: 'Free Kicks', playerKey: null, teamKey: 'free_kicks' },
] as const;
const WORLD_CUP_TIMEFRAMES = [
  { id: 'last5', label: 'L5', count: 5 },
  { id: 'last10', label: 'L10', count: 10 },
  { id: 'last20', label: 'L20', count: 20 },
  { id: 'last50', label: 'L50', count: 50 },
  { id: 'all', label: 'ALL', count: 100 },
] as const;
const ZERO_DEFAULT_STAT_KEYS = new Set([
  'goals',
  'assists',
  'shots_on_target',
  'key_passes',
  'duels_won',
  'duels_lost',
  'ground_duels_won',
  'ground_duels_total',
  'shots_total',
  'derived_shots_total',
  'derived_shots_blocked',
  'shots_blocked',
  'big_chances',
  'big_chances_created',
  'corners',
  'offsides',
  'yellow_cards',
  'red_cards',
  'fouls',
  'fouls_committed',
  'was_fouled',
  'clearances',
  'saves',
  'saves_inside_box',
  'punches',
  'high_claims',
  'passes_total',
  'passes_accurate',
  'passes_final_third',
  'crosses_total',
  'crosses_accurate',
  'dribbles_attempted',
  'dribbles_completed',
  'dribbles_total',
  'possession_lost',
  'tackles',
  'tackles_won',
  'throw_ins',
  'goal_kicks',
  'free_kicks',
]);
const WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS = new Set(['saves', 'saves_inside_box', 'punches', 'high_claims']);

type WorldCupChartStatId = (typeof WORLD_CUP_STAT_OPTIONS)[number]['id'];
type WorldCupChartTimeframe = (typeof WORLD_CUP_TIMEFRAMES)[number]['id'];
type WorldCupChartContext = {
  statId: WorldCupChartStatId;
  statKey: string | null;
  statLabel: string;
  timeframe: WorldCupChartTimeframe;
};

function isWorldCupGoalkeeperRole(value: string | null | undefined): boolean {
  const role = String(value || '').trim().toLowerCase();
  return role === 'gk' || role === 'goalkeeper' || role.includes('keeper');
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMetric(value: unknown): string {
  const parsed = toNumber(value);
  if (parsed == null) return '-';
  if (Number.isInteger(parsed)) return String(parsed);
  return parsed >= 10 ? parsed.toFixed(1) : parsed.toFixed(2);
}

function averageMetric(rows: Array<Record<string, any>>, key: string): string {
  const values = rows.map((row) => getWorldCupStatNumber(row, key)).filter((value): value is number => value != null);
  if (!values.length) return '-';
  return formatMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getWorldCupStatNumber(row: Record<string, any>, key: string): number | null {
  const parsed = toNumber(row[key]);
  if (parsed != null) return parsed;
  return ZERO_DEFAULT_STAT_KEYS.has(key) ? 0 : null;
}

function metricValue(metric: string, mode: PropsMode, data: WorldCupDashboardData | null, selectedPlayerId?: string | null): string {
  if (!data) return '-';
  const rows =
    mode === 'player' && selectedPlayerId
      ? data.playerMatchStats.filter((row) => String(row.player_id ?? row.player?.id ?? '') === selectedPlayerId)
      : mode === 'player'
        ? data.playerMatchStats
        : data.teamMatchStats;
  const lookup: Record<string, string> = {
    Goals: 'goals',
    Assists: 'assists',
    xG: 'expected_goals',
    xA: 'expected_assists',
    SOT: 'shots_on_target',
    'Key passes': 'key_passes',
    Duels: 'duels_won',
    Shots: 'shots_total',
    'Big chances': 'big_chances',
    Corners: 'corners',
    Possession: 'possession_pct',
    Cards: 'yellow_cards',
    Fouls: 'fouls',
    Clearances: 'clearances',
    Saves: 'saves',
  };
  const key = lookup[metric];
  return key ? averageMetric(rows, key) : '-';
}

function metricNumber(metric: string, mode: PropsMode, data: WorldCupDashboardData | null, selectedPlayerId?: string | null): number | null {
  const value = metricValue(metric, mode, data, selectedPlayerId);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitName(value: string): [string, string?] {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [value || 'TBD'];
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join(' '), parts.slice(mid).join(' ')];
}

function TeamBadge({ team, isDark }: { team: WorldCupTeamOption | null; isDark: boolean }) {
  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ${
        isDark ? 'bg-purple-950/70 text-purple-100 ring-1 ring-purple-500/40' : 'bg-purple-100 text-purple-700 ring-1 ring-purple-200'
      }`}
    >
      {team?.abbreviation || 'TBD'}
    </div>
  );
}

function EmptyState({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`flex min-h-[120px] items-center justify-center px-4 text-center text-sm text-gray-500 dark:text-gray-400 ${className}`}>
      {text}
    </div>
  );
}

function WorldCupXAxisTick({ x, y, payload, data }: any) {
  const dataPoint = data?.find((row: any) => row.xKey === payload.value);
  const label = dataPoint?.tickLabel || payload.value;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={16} textAnchor="middle" fill="currentColor" fontSize={10} fontWeight={700}>
        {label}
      </text>
      {dataPoint?.tickDateLabel ? (
        <text x={0} y={0} dy={30} textAnchor="middle" fill="currentColor" fontSize={9} opacity={0.65}>
          {dataPoint.tickDateLabel}
        </text>
      ) : null}
    </g>
  );
}

function WorldCupChartTooltip({
  active,
  payload,
  isDark,
  statLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, any> }>;
  isDark: boolean;
  statLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs shadow-xl ${isDark ? 'border-gray-700 bg-[#07131f] text-gray-100' : 'border-gray-200 bg-white text-gray-900'}`}>
      <div className="font-semibold">{row.matchLabel || 'World Cup match'}</div>
      <div className="mt-1 text-gray-500 dark:text-gray-400">{row.gameDate || ''}</div>
      <div className="mt-2">
        {statLabel}: <span className="font-bold text-purple-500">{formatMetric(row.value)}</span>
      </div>
      {row.scoreline ? <div className="mt-1 text-gray-500 dark:text-gray-400">{row.scoreline}</div> : null}
    </div>
  );
}

function StatsBars({
  isDark,
  metrics,
  mode,
  data,
  selectedPlayerId,
}: {
  isDark: boolean;
  metrics: string[];
  mode: PropsMode;
  data: WorldCupDashboardData | null;
  selectedPlayerId?: string | null;
}) {
  const metricRows = metrics.map((metric) => ({
    metric,
    value: metricNumber(metric, mode, data, selectedPlayerId),
    label: metricValue(metric, mode, data, selectedPlayerId),
  }));
  const hasValues = metricRows.some((row) => row.value != null);
  const maxValue = Math.max(1, ...metricRows.map((row) => row.value ?? 0));
  const heights = [46, 62, 38, 72, 54, 48, 66, 42, 58, 51, 47, 64, 40, 70, 56, 49, 67, 44];

  if (hasValues) {
    return (
      <div className="flex h-full min-h-[280px] items-end justify-center gap-2 px-3 pb-5 pt-8">
        {metricRows.map((row) => {
          const height = row.value == null ? 10 : Math.max(12, Math.round((row.value / maxValue) * 86));
          return (
            <div key={row.metric} className="flex h-full flex-1 max-w-[90px] flex-col items-center justify-end gap-2">
              <div className="text-xs font-bold text-gray-900 dark:text-white">{row.label}</div>
              <div
                className={`w-full rounded-t ${isDark ? 'bg-purple-500/45 ring-1 ring-purple-300/25' : 'bg-purple-300 ring-1 ring-purple-400'}`}
                style={{ height: `${height}%`, minHeight: 28 }}
              />
              <div className="min-h-[28px] text-center text-[10px] font-semibold leading-tight text-gray-500 dark:text-gray-400">
                {row.metric}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[280px] items-end justify-center gap-1 px-2 pb-4 pt-8">
      {heights.map((height, idx) => (
        <div key={idx} className="flex h-full flex-1 max-w-[52px] items-end">
          <div
            className={`w-full rounded-t ${isDark ? 'bg-purple-500/20 ring-1 ring-purple-400/20' : 'bg-purple-200 ring-1 ring-purple-300'}`}
            style={{ height: `${height}%`, minHeight: 28 }}
          />
        </div>
      ))}
    </div>
  );
}

function getChartStatConfig(mode: PropsMode, selectedStat: WorldCupChartStatId) {
  const preferred = WORLD_CUP_STAT_OPTIONS.find((option) => option.id === selectedStat) ?? WORLD_CUP_STAT_OPTIONS[0];
  if (mode === 'team' && !preferred.teamKey) {
    return WORLD_CUP_STAT_OPTIONS.find((option) => option.teamKey) ?? preferred;
  }
  if (mode === 'player' && !preferred.playerKey) {
    return WORLD_CUP_STAT_OPTIONS.find((option) => option.playerKey) ?? preferred;
  }
  return preferred;
}

function getWorldCupTimeframeLabel(value: WorldCupChartTimeframe): string {
  return WORLD_CUP_TIMEFRAMES.find((option) => option.id === value)?.label ?? value.toUpperCase();
}

function getWorldCupStatLabelByKey(key: string): string {
  const byOption = WORLD_CUP_STAT_OPTIONS.find((option) => option.playerKey === key || option.teamKey === key);
  if (byOption) return byOption.label;
  const labels: Record<string, string> = {
    expected_goals: 'xG',
    expected_assists: 'xA',
    shots_on_target: 'SOT',
    shots_total: 'Shots',
    derived_shots_total: 'Shots',
    big_chances: 'Big Chances',
    big_chances_created: 'Big Chances Created',
    passes_total: 'Passes',
    passes_accurate: 'Accurate Passes',
    key_passes: 'Key Passes',
    crosses_accurate: 'Accurate Crosses',
    fouls_committed: 'Fouls Committed',
    was_fouled: 'Fouls Suffered',
    tackles_won: 'Tackles Won',
    duels_won: 'Duels Won',
    yellow_cards: 'Yellow Cards',
    red_cards: 'Red Cards',
    minutes_played: 'Mins',
    saves: 'GK Saves',
    saves_inside_box: 'Saves Inside Box',
    punches: 'Punches',
    high_claims: 'High Claims',
    possession_pct: 'Possession',
    possession_lost: 'Possession Lost',
    corners: 'Corners',
    offsides: 'Offsides',
    clearances: 'Clearances',
    passes_final_third: 'Final Third Passes',
    crosses_total: 'Crosses',
    crosses_accurate: 'Accurate Crosses',
    dribbles_attempted: 'Dribbles Attempted',
    dribbles_completed: 'Dribbles Completed',
    dribbles_total: 'Dribbles',
    throw_ins: 'Throw Ins',
    goal_kicks: 'Goal Kicks',
    free_kicks: 'Free Kicks',
    ball_possession: 'Ball Possession',
    corner_kicks: 'Corner Kicks',
    accurate_passes: 'Passes',
    passes_in_final_third: 'Passes in Final Third',
    successful_dribbles: 'Successful Dribbles',
  };
  return labels[key] ?? key.split('_').map((word) => word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)).join(' ');
}

function buildWorldCupSupportingKeys(mainKey: string | null, mode: PropsMode): string[] {
  const unique = (preferred: string[]) => preferred.filter((key, index, arr) => Boolean(key) && arr.indexOf(key) === index);
  const main = mainKey || '';
  if (mode === 'team') {
    if (['expected_goals', 'shots_total', 'shots_on_target', 'big_chances'].includes(main)) {
      return unique(['expected_goals', 'shots_total', 'shots_on_target', 'big_chances', 'corners']);
    }
    if (['yellow_cards', 'fouls'].includes(main)) {
      return unique(['fouls', 'yellow_cards', 'tackles', 'clearances']);
    }
    if (['passes_total', 'passes_accurate', 'passes_final_third'].includes(main)) {
      return unique(['passes_total', 'passes_accurate', 'passes_final_third', 'expected_goals', 'shots_total']);
    }
    if (['corners', 'offsides', 'throw_ins', 'goal_kicks', 'free_kicks'].includes(main)) {
      return unique([main, 'expected_goals', 'shots_total', 'shots_on_target']);
    }
    return unique([main, 'expected_goals', 'shots_total', 'shots_on_target', 'possession_pct', 'corners'].filter(Boolean));
  }

  if (['goals', 'derived_shots_total', 'shots_on_target', 'expected_goals'].includes(main)) {
    return unique([
      'minutes_played',
      'goals',
      'derived_shots_total',
      'shots_on_target',
      'expected_goals',
      'big_chances_created',
      'big_chances_missed',
    ]);
  }
  if (['assists', 'expected_assists', 'key_passes'].includes(main)) {
    return unique(['minutes_played', 'assists', 'expected_assists', 'key_passes', 'passes_total', 'passes_accurate']);
  }
  if (['passes_accurate', 'passes_total'].includes(main)) {
    return unique(['minutes_played', 'passes_total', 'passes_accurate', 'expected_assists', 'key_passes']);
  }
  if (['dribbles_completed', 'dribbles_attempted'].includes(main)) {
    return unique(['minutes_played', 'dribbles_attempted', 'dribbles_completed', 'duels_won', 'was_fouled']);
  }
  if (['fouls_committed', 'yellow_cards', 'red_cards', 'duels_won'].includes(main)) {
    return unique(['minutes_played', 'fouls_committed', 'was_fouled', 'duels_won', 'tackles_won', 'yellow_cards', 'red_cards']);
  }
  if (['saves', 'saves_inside_box'].includes(main)) {
    return unique(['minutes_played', 'saves', 'saves_inside_box', 'punches', 'high_claims']);
  }
  return unique(['minutes_played', main, 'expected_goals', 'expected_assists'].filter(Boolean));
}

function getAvailableWorldCupStats(mode: PropsMode, selectedPlayer: WorldCupPlayerOption | null) {
  const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayer?.role);
  return WORLD_CUP_STAT_OPTIONS.filter((option) => {
    const key = mode === 'player' ? option.playerKey : option.teamKey;
    if (!key) return false;
    if (mode === 'player' && WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(key) && !isGoalkeeper) return false;
    return true;
  });
}

function buildWorldCupYAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  const maxValue = Math.max(1, ...values);
  const hasDecimals = values.some((value) => Math.abs(value - Math.round(value)) > 0.001);
  const top = hasDecimals ? Math.max(1, Math.ceil(maxValue * 10) / 10) : Math.max(1, Math.ceil(maxValue));
  const step = top / 3;
  return {
    domain: [0, top],
    ticks: [0, step, step * 2, top].map((value) => (hasDecimals ? Math.round(value * 10) / 10 : Math.round(value))),
  };
}

function buildWorldCupMainYAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  const maxValue = Math.max(1, ...values);
  const hasDecimals = values.some((value) => Math.abs(value - Math.round(value)) > 0.001);
  const paddedMax = maxValue * 1.1;
  const top = hasDecimals ? Math.max(1, Math.ceil(paddedMax * 10) / 10) : Math.max(1, Math.ceil(paddedMax));
  const step = top / 3;
  return {
    domain: [0, top],
    ticks: [0, step, step * 2, top].map((value) => (hasDecimals ? Math.round(value * 10) / 10 : Math.round(value))),
  };
}

function getWorldCupMatchDate(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getTeamAbbreviationFromLabel(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return value.slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((word) => word[0]).join('').toUpperCase();
}

function WorldCupGameByGameChart({
  data,
  mode,
  selectedTeam,
  selectedPlayer,
  isDark,
  loading,
  error,
  onChartContextChange,
}: {
  data: WorldCupDashboardData | null;
  mode: PropsMode;
  selectedTeam: WorldCupTeamOption | null;
  selectedPlayer: WorldCupPlayerOption | null;
  isDark: boolean;
  loading: boolean;
  error: string | null;
  onChartContextChange?: (context: WorldCupChartContext) => void;
}) {
  const [selectedStat, setSelectedStat] = useState<WorldCupChartStatId>('goals');
  const [timeframe, setTimeframe] = useState<WorldCupChartTimeframe>('last10');
  const [manualLineValue, setManualLineValue] = useState<number | null>(null);
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const availableStats = useMemo(() => getAvailableWorldCupStats(mode, selectedPlayer), [mode, selectedPlayer]);
  const statConfig = availableStats.find((option) => option.id === selectedStat) ?? availableStats[0] ?? getChartStatConfig(mode, selectedStat);
  const statKey = mode === 'player' ? statConfig.playerKey : statConfig.teamKey;
  const selectedTeamId = selectedTeam?.id ?? null;
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;

  const chartRows = useMemo(() => {
    if (!data || !statKey) return [];
    const allMatches = [...(data.matches ?? []), ...(data.playerMatches ?? [])];
    const matchLookup = new Map(allMatches.map((match) => [String(match.id), match]));
    const sourceRows =
      mode === 'player'
        ? data.playerMatchStats.filter((row) => !selectedPlayerId || String(row.player_id ?? row.player?.id ?? '') === selectedPlayerId)
        : data.teamMatchStats.filter((row) => !selectedTeamId || String(row.team_id ?? '') === selectedTeamId);

    const rows = sourceRows
      .map((row) => {
        const matchId = String(row.match_id ?? '');
        const match = matchLookup.get(matchId);
        const value = getWorldCupStatNumber(row, statKey);
        const teamId = String(row.team_id ?? selectedTeamId ?? '');
        const homeId = String(match?.homeTeam?.id ?? match?.raw?.home_team?.id ?? '');
        const awayId = String(match?.awayTeam?.id ?? match?.raw?.away_team?.id ?? '');
        const isHome = row.is_home === true || (homeId && teamId && homeId === teamId);
        const opponentLabel = isHome
          ? String(match?.awayLabel || match?.awayTeam?.name || 'Opponent')
          : String(match?.homeLabel || match?.homeTeam?.name || 'Opponent');
        const teamScore = isHome ? match?.homeScore : match?.awayScore;
        const opponentScore = isHome ? match?.awayScore : match?.homeScore;
        const scoreline = teamScore != null && opponentScore != null ? `${teamScore}-${opponentScore}` : '';
        return {
          key: matchId || `${row.player_id ?? row.team_id}-${row.team_id ?? 'row'}`,
          xKey: matchId || `${row.player_id ?? row.team_id}-${row.team_id ?? 'row'}`,
          tickLabel: getTeamAbbreviationFromLabel(opponentLabel),
          tickDateLabel: getWorldCupMatchDate(match?.datetime),
          opponent: opponentLabel,
          value,
          gameDate: getWorldCupMatchDate(match?.datetime),
          gameTimestamp: Date.parse(String(match?.datetime || '')) || 0,
          matchLabel: match ? `${match.homeLabel || 'TBD'} vs ${match.awayLabel || 'TBD'}` : `Match ${matchId}`,
          scoreline,
          result: scoreline,
          venue: isHome ? 'HOME' : 'AWAY',
        };
      })
      .filter((row) => row.value != null)
      .sort((a, b) => a.gameTimestamp - b.gameTimestamp);

    const frame = WORLD_CUP_TIMEFRAMES.find((option) => option.id === timeframe) ?? WORLD_CUP_TIMEFRAMES[1];
    return rows.slice(-frame.count);
  }, [data, mode, selectedPlayerId, selectedTeamId, statKey, timeframe]);

  const values = chartRows.map((row) => row.value).filter((value): value is number => value != null);
  const averageValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const lineValue = manualLineValue ?? Math.round(averageValue * 2) / 2;
  const yAxisConfig = buildWorldCupMainYAxis(values);
  useEffect(() => {
    if (!availableStats.length) return;
    if (availableStats.some((option) => option.id === selectedStat)) return;
    setSelectedStat(availableStats[0].id);
  }, [availableStats, selectedStat]);

  useEffect(() => {
    onChartContextChange?.({
      statId: statConfig.id,
      statKey,
      statLabel: statConfig.label,
      timeframe,
    });
  }, [onChartContextChange, statConfig.id, statConfig.label, statKey, timeframe]);

  useEffect(() => {
    setManualLineValue(null);
  }, [selectedStat, timeframe]);

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      const el = timeframeDropdownRef.current;
      if (el && event.target instanceof Node && !el.contains(event.target)) {
        setIsTimeframeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  if (loading && !data) {
    return <StatsBars isDark={isDark} metrics={mode === 'player' ? PLAYER_METRICS : TEAM_METRICS} mode={mode} data={null} />;
  }

  if (error) {
    return <EmptyState text={error} className="h-full" />;
  }

  return (
    <div className="h-full w-full pt-3 pb-2 flex flex-col px-0 sm:px-1 md:px-2 overflow-hidden">
      <div className="mb-4 sm:mb-5 md:mb-4 mt-0 w-full max-w-full">
        <div
          className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
          {availableStats.map((option) => (
            <StatPill
              key={option.id}
              label={option.label}
              value={option.id}
              isSelected={statConfig.id === option.id}
              onSelect={(value) => setSelectedStat(value as WorldCupChartStatId)}
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
            id="world-cup-betting-line-input"
            type="number"
            step={0.5}
            value={lineValue}
            min={0}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) setManualLineValue(next);
            }}
            className="w-20 sm:w-20 md:w-22 px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            aria-label={`Set line value for ${statConfig.label}`}
          />
          <div className="relative" ref={timeframeDropdownRef}>
            <button
              type="button"
              onClick={() => setIsTimeframeDropdownOpen((prev) => !prev)}
              className="w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              <span className="truncate">{getWorldCupTimeframeLabel(timeframe)}</span>
              <svg className="w-3 h-3 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isTimeframeDropdownOpen ? (
              <div className="absolute top-full right-0 mt-1 w-20 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                {WORLD_CUP_TIMEFRAMES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setTimeframe(option.id);
                      setIsTimeframeDropdownOpen(false);
                    }}
                    className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg ${
                      timeframe === option.id
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

      <div className="min-h-0 flex-1">
        {chartRows.length ? (
          <SimpleChart
            chartData={chartRows}
            yAxisConfig={yAxisConfig}
            isDark={isDark}
            bettingLine={lineValue}
            selectedStat={statConfig.id}
            selectedTimeframe={timeframe}
            customTooltip={(props: any) => <WorldCupChartTooltip {...props} isDark={isDark} statLabel={statConfig.label} />}
            customXAxisTick={<WorldCupXAxisTick data={chartRows} />}
            disableBarAnimation
            centerAverageOverlay
            averageOverlayLowerOnMobile
            desktopChartLeftInset={40}
            desktopChartRightInset={8}
            desktopChartRightMargin={8}
            yAxisWidth={34}
            xAxisHeight={timeframe === 'all' || timeframe === 'last50' ? 28 : 56}
            chartBottomMargin={8}
            hideBarValueLabels={timeframe === 'all'}
          />
        ) : (
          <EmptyState
            text={
              mode === 'player'
                ? 'No game-by-game BDL player stats are available for this selected player yet.'
                : 'No game-by-game BDL team stats are available for this selected team yet.'
            }
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 px-3 sm:px-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p> : null}
      </div>
      <span className="rounded-full border border-purple-300/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-600 dark:border-purple-500/50 dark:text-purple-300">
        BDL ready
      </span>
    </div>
  );
}

function MetricGrid({
  metrics,
  mode,
  data,
  selectedPlayerId,
}: {
  metrics: string[];
  mode?: PropsMode;
  data?: WorldCupDashboardData | null;
  selectedPlayerId?: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 px-3 sm:grid-cols-4 sm:px-4">
      {metrics.map((metric) => (
        <div key={metric} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-[#07131f]">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{metric}</div>
          <div className="mt-2 text-lg font-bold text-gray-900 dark:text-white">
            {mode ? metricValue(metric, mode, data ?? null, selectedPlayerId) : '-'}
          </div>
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{data ? 'BDL World Cup' : 'Waiting for World Cup API'}</div>
        </div>
      ))}
    </div>
  );
}

function getWorldCupRowsForMode(
  data: WorldCupDashboardData | null,
  mode: PropsMode,
  selectedPlayerId: string | null,
  selectedTeamId: string | null
): Array<Record<string, any>> {
  if (!data) return [];
  return mode === 'player'
    ? data.playerMatchStats.filter((row) => !selectedPlayerId || String(row.player_id ?? row.player?.id ?? '') === selectedPlayerId)
    : data.teamMatchStats.filter((row) => !selectedTeamId || String(row.team_id ?? '') === selectedTeamId);
}

function filterWorldCupRowsByTimeframe(rows: Array<Record<string, any>>, data: WorldCupDashboardData | null, timeframe: WorldCupChartTimeframe) {
  const allMatches = [...(data?.matches ?? []), ...(data?.playerMatches ?? [])];
  const matchLookup = new Map(allMatches.map((match) => [String(match.id), match]));
  const sorted = [...rows].sort((a, b) => {
    const aTime = Date.parse(String(matchLookup.get(String(a.match_id))?.datetime || '')) || 0;
    const bTime = Date.parse(String(matchLookup.get(String(b.match_id))?.datetime || '')) || 0;
    return bTime - aTime;
  });
  const frame = WORLD_CUP_TIMEFRAMES.find((option) => option.id === timeframe) ?? WORLD_CUP_TIMEFRAMES[1];
  return sorted.slice(0, frame.count).reverse();
}

function WorldCupSupportingStats({
  data,
  mode,
  selectedPlayer,
  selectedPlayerId,
  selectedTeamId,
  chartContext,
  isDark,
}: {
  data: WorldCupDashboardData | null;
  mode: PropsMode;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  selectedTeamId: string | null;
  chartContext: WorldCupChartContext;
  isDark: boolean;
}) {
  const [selectedSupportingStat, setSelectedSupportingStat] = useState('');
  const rows = useMemo(
    () =>
      filterWorldCupRowsByTimeframe(
        getWorldCupRowsForMode(data, mode, selectedPlayerId, selectedTeamId),
        data,
        chartContext.timeframe
      ),
    [chartContext.timeframe, data, mode, selectedPlayerId, selectedTeamId]
  );
  const supportingOptions = useMemo(() => {
    const candidates = buildWorldCupSupportingKeys(chartContext.statKey, mode);
    const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayer?.role);
    return candidates.filter((key, index, arr) => {
      if (arr.indexOf(key) !== index) return false;
      if (mode === 'player' && WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(key) && !isGoalkeeper) return false;
      return true;
    });
  }, [chartContext.statKey, mode, selectedPlayer?.role]);

  useEffect(() => {
    if (!supportingOptions.length) {
      setSelectedSupportingStat('');
      return;
    }
    if (selectedSupportingStat && supportingOptions.includes(selectedSupportingStat)) return;
    setSelectedSupportingStat(supportingOptions[0]);
  }, [selectedSupportingStat, supportingOptions]);

  const averagesByStat = useMemo(() => {
    const averages = new Map<string, number | null>();
    for (const stat of supportingOptions) {
      const values = rows.map((row) => getWorldCupStatNumber(row, stat)).filter((value): value is number => value != null);
      averages.set(stat, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
    }
    return averages;
  }, [rows, supportingOptions]);

  const selectedRows = useMemo(() => {
    if (!selectedSupportingStat) return [];
    const allMatches = [...(data?.matches ?? []), ...(data?.playerMatches ?? [])];
    const matchLookup = new Map(allMatches.map((match) => [String(match.id), match]));
    return rows.map((row) => {
      const match = matchLookup.get(String(row.match_id));
      return {
        key: String(row.match_id),
        xKey: String(row.match_id),
        tickLabel: getTeamAbbreviationFromLabel(
          row.is_home === true
            ? String(match?.awayLabel || 'Opponent')
            : String(match?.homeLabel || 'Opponent')
        ),
        tickDateLabel: getWorldCupMatchDate(match?.datetime),
        opponent:
          row.is_home === true
            ? String(match?.awayLabel || 'Opponent')
            : String(match?.homeLabel || 'Opponent'),
        value: getWorldCupStatNumber(row, selectedSupportingStat) ?? 0,
        gameDate: getWorldCupMatchDate(match?.datetime),
        matchLabel: match ? `${match.homeLabel || 'TBD'} vs ${match.awayLabel || 'TBD'}` : `Match ${String(row.match_id)}`,
      };
    });
  }, [data?.matches, data?.playerMatches, rows, selectedSupportingStat]);

  const emptyText = isDark ? 'text-gray-500' : 'text-gray-400';
  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const supportingYAxisConfig = buildWorldCupYAxis(selectedRows.map((row) => row.value));

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
              const avgLabel = avg == null ? '—' : formatMetric(avg);
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
                  <span className="line-clamp-2">{getWorldCupStatLabelByKey(option)}</span>
                  <span className="text-[10px] sm:text-xs font-normal opacity-90">{avgLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className={`h-px w-full shrink-0 ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} aria-hidden />
      </div>

      {selectedRows.length === 0 ? (
        <div className={`min-h-[120px] flex items-center justify-center text-sm ${emptyText}`}>
          No supporting stats available for {chartContext.statLabel}
        </div>
      ) : (
        <div className="h-[320px] min-h-[280px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={selectedRows} margin={{ top: 24, right: 8, left: 0, bottom: 0 }} barCategoryGap="5%">
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
                  const numericValue = Number(value);
                  if (!Number.isFinite(numericValue)) return null;
                  return (
                    <text
                      x={Number(x ?? 0) + Number(width ?? 0) / 2}
                      y={Number(y ?? 0) - 6}
                      textAnchor="middle"
                      fill={labelFill}
                      fontSize={12}
                      fontWeight={600}
                    >
                      {formatMetric(numericValue)}
                    </text>
                  );
                }}
              >
                {selectedRows.map((row) => (
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

function SearchBox({
  id,
  value,
  onChange,
  onFocus,
  placeholder,
  isDark,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  placeholder: string;
  isDark: boolean;
}) {
  return (
    <div className="relative mx-auto max-w-xl lg:max-w-lg">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
      <input
        id={id}
        type="search"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className={`w-full rounded-lg border py-2 pl-9 pr-3 text-sm placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 dark:placeholder-gray-400 ${
          isDark ? 'border-gray-600 bg-[#0f172a] text-white' : 'border-gray-300 bg-gray-50 text-gray-900'
        }`}
      />
    </div>
  );
}

function WorldCupInsightsPanel({
  isDark,
  selectedTeam,
  opponentTeam,
  data,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  data: WorldCupDashboardData | null;
}) {
  const [tab, setTab] = useState<InsightTab>('dvp');
  const tabs: Array<{ id: InsightTab; label: string }> = [
    { id: 'dvp', label: 'DVP' },
    { id: 'opponent', label: 'Opponent Breakdown' },
    { id: 'matchup', label: 'Team Matchup' },
  ];
  const activeTab = 'bg-purple-600 text-white border-purple-600';
  const inactiveTab =
    'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700';

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden px-0.5 pb-0.5 pt-0.5 xl:px-1 xl:pb-1 xl:pt-1">
      <div className="mb-1 flex flex-shrink-0 gap-1 xl:gap-1.5">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors xl:px-2.5 xl:text-sm ${
              tab === item.id ? activeTab : inactiveTab
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg px-2 py-3 custom-scrollbar">
        {tab === 'dvp' ? (
          <div>
            <SectionHeader title="World Cup DVP" subtitle="Opponent allowed by soccer role once player match stats are connected." />
            <div className="space-y-2 px-3 sm:px-4">
              {ROLE_ROWS.map((role, idx) => (
                <div key={role} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-[#07131f]">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{role}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">xG, SOT, key passes, duels allowed</div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-bold ${
                      idx < 2
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-100'
                        : idx < 5
                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-100'
                          : 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-100'
                    }`}
                  >
                    -
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : tab === 'opponent' ? (
          <div>
            <SectionHeader
              title="Opponent Breakdown"
              subtitle={`${opponentTeam?.name || 'Opponent'} defensive profile, form, cards, chances, and pressure stats.`}
            />
            <MetricGrid metrics={['xG', 'Shots', 'SOT', 'Big chances', 'Corners', 'Cards', 'Clearances', 'Saves']} mode="team" data={data} />
          </div>
        ) : (
          <div>
            <SectionHeader
              title="Team Matchup"
              subtitle={`${selectedTeam?.name || 'Selected team'} attack vs ${opponentTeam?.name || 'opponent'} defense, and reverse.`}
            />
            <div className="space-y-3 px-3 sm:px-4">
              {['Attack vs defense', 'Defense vs attack', 'Odds and implied probability', 'Recent form'].map((label) => (
                <div key={label} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{label}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">API pending</span>
                  </div>
                  <div className={`h-2 rounded-full ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <div className="h-2 w-1/2 rounded-full bg-purple-500/70" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WorldCupPageContent() {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>('american');
  const [propsMode, setPropsMode] = useState<PropsMode>('player');
  const [selectedTeam, setSelectedTeam] = useState<WorldCupTeamOption | null>(WORLD_CUP_TEAMS[0] ?? null);
  const [selectedPlayer, setSelectedPlayer] = useState<WorldCupPlayerOption | null>(WORLD_CUP_PLAYERS[0] ?? null);
  const [teamSearchQuery, setTeamSearchQuery] = useState(selectedTeam?.name ?? '');
  const [playerSearchQuery, setPlayerSearchQuery] = useState(selectedPlayer?.name ?? '');
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [playerSearchOpen, setPlayerSearchOpen] = useState(false);
  const [searchedPlayers, setSearchedPlayers] = useState<WorldCupPlayerOption[]>([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const [playerSearchError, setPlayerSearchError] = useState<string | null>(null);
  const [worldCupData, setWorldCupData] = useState<WorldCupDashboardData | null>(null);
  const [worldCupLoading, setWorldCupLoading] = useState(false);
  const [worldCupError, setWorldCupError] = useState<string | null>(null);
  const [chartContext, setChartContext] = useState<WorldCupChartContext>({
    statId: 'goals',
    statKey: 'goals',
    statLabel: 'Goals',
    timeframe: 'last10',
  });
  const [isPro, setIsPro] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);
  const journalDropdownRef = useRef<HTMLDivElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);
  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } = useDashboardStyles({
    sidebarOpen,
  });

  const teamOptions = useMemo<WorldCupTeamOption[]>(() => {
    if (!worldCupData?.teams?.length) return WORLD_CUP_TEAMS;
    return worldCupData.teams.map((team) => ({
      id: String(team.id),
      name: team.name,
      abbreviation: team.abbreviation || team.country_code || team.name.slice(0, 3).toUpperCase(),
      group:
        String(
          worldCupData.standings.find((row) => Number(row?.team?.id) === team.id)?.group?.name ??
            worldCupData.featureMatch?.group ??
            'World Cup'
        ) || 'World Cup',
      confederation: team.confederation || 'FIFA',
    }));
  }, [worldCupData]);

  const playerOptions = useMemo<WorldCupPlayerOption[]>(() => {
    const rosterPlayers = !worldCupData?.rosters?.length ? [] : worldCupData.rosters.slice(0, 80).map((row) => {
      const player = row.player ?? {};
      const name = String(player.name || player.short_name || 'World Cup Player');
      const parts = name.split(/\s+/).filter(Boolean);
      const teamId = row.team_id != null ? String(row.team_id) : worldCupData.selectedTeam?.id != null ? String(worldCupData.selectedTeam.id) : null;
      const teamName = teamOptions.find((team) => team.id === teamId)?.name || selectedTeam?.name || worldCupData.selectedTeam?.name || 'World Cup';
      return {
        id: String(player.id ?? name),
        name,
        shortName: String(player.short_name || `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` || 'WC').slice(0, 3).toUpperCase(),
        teamName,
        teamId,
        countryCode: String(player.country_code || '').trim() || null,
        number: String(player.jersey_number || row.shirt_number || ''),
        role: String(row.position || player.position || 'FIFA'),
      };
    });
    const merged = new Map<string, WorldCupPlayerOption>();
    [...searchedPlayers, ...rosterPlayers].forEach((player) => merged.set(player.id, player));
    const players = Array.from(merged.values());
    return players.length ? players : WORLD_CUP_PLAYERS;
  }, [searchedPlayers, selectedTeam?.name, teamOptions, worldCupData]);

  const opponentTeam = useMemo(() => {
    const featureMatch = worldCupData?.featureMatch;
    const homeId = featureMatch?.homeTeam?.id != null ? String(featureMatch.homeTeam.id) : null;
    const awayId = featureMatch?.awayTeam?.id != null ? String(featureMatch.awayTeam.id) : null;
    if (selectedTeam?.id && homeId === selectedTeam.id && awayId) {
      return teamOptions.find((team) => team.id === awayId) ?? null;
    }
    if (selectedTeam?.id && awayId === selectedTeam.id && homeId) {
      return teamOptions.find((team) => team.id === homeId) ?? null;
    }
    return teamOptions.find((team) => team.id !== selectedTeam?.id) ?? null;
  }, [selectedTeam?.id, teamOptions, worldCupData?.featureMatch]);
  const headerTitle = propsMode === 'player' ? selectedPlayer?.name || 'World Cup Player Props' : selectedTeam?.name || 'World Cup Game Props';
  const emptyText = isDark ? 'text-gray-400' : 'text-gray-500';
  const fixturePrimaryLines = splitName(selectedTeam?.name || 'World Cup Team');
  const fixtureSecondaryLines = splitName(opponentTeam?.name || 'World Cup Opponent');
  const featureMatchMeta = worldCupData?.featureMatch
    ? [
        worldCupData.featureMatch.stage,
        worldCupData.featureMatch.group,
        worldCupData.featureMatch.datetime
          ? new Date(String(worldCupData.featureMatch.datetime)).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : null,
      ]
        .filter(Boolean)
        .join(' - ')
    : 'FIFA World Cup 2026 - BDL GOAT data pending';
  const selectedTeamId = selectedTeam?.id ?? null;
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;
  const selectedTeamNeedsHydration = !selectedTeamId || !/^\d+$/.test(selectedTeamId);

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace('/login?redirect=/world-cup');
        return;
      }

      const user = session.user;
      setUserEmail(user.email ?? null);

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, username, avatar_url, subscription_status, subscription_tier')
          .eq('id', user.id)
          .single();
        const p = profile as {
          full_name?: string | null;
          username?: string | null;
          avatar_url?: string | null;
          subscription_status?: string | null;
          subscription_tier?: string | null;
        } | null;
        setUsername(p?.full_name || p?.username || null);
        setAvatarUrl(p?.avatar_url ?? null);
        const active = p?.subscription_status === 'active' || p?.subscription_status === 'trialing';
        const proTier = p?.subscription_tier === 'pro';
        setIsPro(Boolean(active && proTier));
      } catch (error) {
        console.error('Error loading profile:', error);
      }
    };

    void loadUser();
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorldCupData() {
      setWorldCupLoading(true);
      setWorldCupError(null);
      try {
        const params = new URLSearchParams({ season: '2026' });
        if (selectedTeamId && /^\d+$/.test(selectedTeamId)) params.set('teamId', selectedTeamId);
        if (selectedPlayerId) params.set('playerId', selectedPlayerId);
        const response = await fetch(`/api/world-cup/dashboard?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => null)) as WorldCupDashboardData | { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload && 'error' in payload ? String(payload.error) : 'Failed to load World Cup data');
        }
        if (cancelled) return;
        const nextData = payload as WorldCupDashboardData;
        setWorldCupData(nextData);

        if (nextData.selectedTeam && selectedTeamNeedsHydration) {
          const team = {
            id: String(nextData.selectedTeam.id),
            name: nextData.selectedTeam.name,
            abbreviation: nextData.selectedTeam.abbreviation || nextData.selectedTeam.country_code || nextData.selectedTeam.name.slice(0, 3).toUpperCase(),
            group: 'World Cup',
            confederation: nextData.selectedTeam.confederation || 'FIFA',
          };
          setSelectedTeam(team);
          setTeamSearchQuery(team.name);
        }
      } catch (error) {
        if (!cancelled) setWorldCupError(error instanceof Error ? error.message : 'Failed to load World Cup data');
      } finally {
        if (!cancelled) setWorldCupLoading(false);
      }
    }

    void loadWorldCupData();
    return () => {
      cancelled = true;
    };
  }, [selectedPlayerId, selectedTeamId, selectedTeamNeedsHydration]);

  useEffect(() => {
    const query = playerSearchQuery.trim();
    if (!playerSearchOpen || query.length < 2) {
      setPlayerSearchLoading(false);
      setPlayerSearchError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPlayerSearchLoading(true);
      setPlayerSearchError(null);
      try {
        const params = new URLSearchParams({ search: query });
        const response = await fetch(`/api/world-cup/players?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => null)) as { data?: Array<Record<string, any>>; error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to search World Cup players');
        }
        if (cancelled) return;
        const players = (payload?.data ?? []).map((player) => {
          const name = String(player.name || player.short_name || 'World Cup Player');
          const parts = name.split(/\s+/).filter(Boolean);
          const countryName = String(player.country_name || player.country_code || 'World Cup');
          const countryCode = String(player.country_code || '').trim() || null;
          const matchedTeam = teamOptions.find((team) => {
            const code = countryCode?.toLowerCase();
            const name = countryName.toLowerCase();
            return (
              (code && [team.abbreviation, team.id].some((value) => String(value).toLowerCase() === code)) ||
              team.name.toLowerCase() === name ||
              team.name.toLowerCase().includes(name) ||
              name.includes(team.name.toLowerCase())
            );
          });
          return {
            id: String(player.id ?? name),
            name,
            shortName: String(player.short_name || `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` || 'WC').slice(0, 3).toUpperCase(),
            teamName: matchedTeam?.name || countryName,
            teamId: matchedTeam?.id || null,
            countryCode,
            number: String(player.jersey_number || ''),
            role: String(player.position || 'FIFA'),
          };
        });
        setSearchedPlayers(players);
      } catch (error) {
        if (!cancelled) setPlayerSearchError(error instanceof Error ? error.message : 'Failed to search World Cup players');
      } finally {
        if (!cancelled) setPlayerSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [playerSearchOpen, playerSearchQuery, teamOptions]);

  const filteredTeams = useMemo(() => {
    const q = teamSearchQuery.trim().toLowerCase();
    if (!q) return teamOptions;
    return teamOptions.filter((team) =>
      [team.name, team.abbreviation, team.group, team.confederation].some((value) => value.toLowerCase().includes(q))
    );
  }, [teamOptions, teamSearchQuery]);

  const filteredPlayers = useMemo(() => {
    const q = playerSearchQuery.trim().toLowerCase();
    if (!q) return playerOptions;
    return playerOptions.filter((player) =>
      [player.name, player.teamName, player.role, player.number].some((value) => value.toLowerCase().includes(q))
    );
  }, [playerOptions, playerSearchQuery]);

  const filterControls = (
    <>
      <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
        <button
          type="button"
          onClick={() => setPropsMode('player')}
          className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
            propsMode === 'player'
              ? 'bg-purple-600 text-white border-purple-500'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
          }`}
        >
          Player Props
        </button>
        <button
          type="button"
          onClick={() => setPropsMode('team')}
          className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
            propsMode === 'team'
              ? 'bg-purple-600 text-white border-purple-500'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
          }`}
        >
          Game Props
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
        World Cup UI scaffold only. BDL GOAT endpoints will power this after the API key is added.
      </p>
    </>
  );

  return (
    <div className="min-h-screen h-screen max-h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors overflow-y-auto overflow-x-hidden overscroll-contain lg:max-h-none lg:overflow-y-hidden lg:overflow-x-auto">
      <DashboardStyles />
      <div className="px-0 dashboard-container" style={containerStyle}>
        <div className={innerContainerClassName} style={innerContainerStyle}>
          <div className="pt-4 min-h-0 lg:h-full dashboard-container" style={{ paddingLeft: 0 }}>
            <DashboardLeftSidebarWrapper
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              oddsFormat={oddsFormat}
              setOddsFormat={setOddsFormat}
              hasPremium={isPro}
              avatarUrl={avatarUrl}
              username={username}
              userEmail={userEmail}
              isPro={isPro}
              onSubscriptionClick={() => router.push('/subscription')}
              onSignOutClick={async () => {
                await supabase.auth.signOut({ scope: 'local' });
                router.push('/');
              }}
              onProfileUpdated={({ username: u, avatar_url: a }) => {
                if (u !== undefined) setUsername(u ?? null);
                if (a !== undefined) setAvatarUrl(a ?? null);
              }}
              showDashboardNavLinks={false}
            />

            <div className="flex flex-col lg:flex-row gap-0 lg:gap-0 min-h-0">
              <div className={mainContentClassName} style={mainContentStyle}>
                <div className={`lg:hidden rounded-lg ${DASH_CARD_GLOW} px-3 md:px-4 pt-3 md:pt-4 pb-4 md:pb-5 relative overflow-visible`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  {filterControls}
                </div>

                <div className={`relative z-[60] rounded-lg ${DASH_CARD_GLOW} px-2.5 py-2 sm:px-4 sm:py-3 md:px-5 md:py-3.5 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}>
                  <div className="flex flex-col gap-1.5 lg:gap-2">
                    <div className="hidden lg:flex items-center gap-3 min-w-0">
                      <div className="flex flex-1 min-w-0 items-center">
                        <div className="flex items-center gap-2 min-w-0">
                          {propsMode === 'player' ? (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                              {selectedPlayer?.shortName || 'WC'}
                            </span>
                          ) : (
                            <TeamBadge team={selectedTeam} isDark={isDark} />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <h1 className="text-base md:text-lg font-bold text-gray-900 dark:text-white truncate min-w-0">{headerTitle}</h1>
                              {propsMode === 'player' && selectedPlayer?.number ? (
                                <span className="text-xs md:text-sm font-semibold text-purple-600 dark:text-purple-300 flex-shrink-0">
                                  #{selectedPlayer.number}
                                </span>
                              ) : null}
                            </div>
                            {propsMode === 'player' && selectedPlayer ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                {selectedPlayer.role} - {selectedPlayer.teamName}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-1 justify-center">
                        <div className="flex flex-col items-center gap-1.5 min-w-0 flex-shrink">
                          <div className="flex items-center gap-2 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 xl:px-2.5 xl:py-1.5 min-w-0 flex-shrink overflow-hidden">
                            <div className="flex flex-col items-center justify-center w-14 xl:w-[72px] min-w-0 flex-shrink-0">
                              <TeamBadge team={selectedTeam} isDark={isDark} />
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] xl:text-[11px] font-medium text-gray-900 dark:text-white truncate">{fixturePrimaryLines[0]}</div>
                                {fixturePrimaryLines[1] ? <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 truncate">{fixturePrimaryLines[1]}</div> : null}
                              </div>
                            </div>
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-xs flex-shrink-0">VS</span>
                            <div className="flex flex-col items-center justify-center w-14 xl:w-[72px] min-w-0 flex-shrink-0">
                              <TeamBadge team={opponentTeam} isDark={isDark} />
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] xl:text-[11px] font-medium text-gray-900 dark:text-white truncate">{fixtureSecondaryLines[0]}</div>
                                {fixtureSecondaryLines[1] ? <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 truncate">{fixtureSecondaryLines[1]}</div> : null}
                              </div>
                            </div>
                          </div>
                          <div className="text-[10px] xl:text-[11px] text-center w-full leading-tight text-purple-600 dark:text-purple-300">
                            {worldCupLoading ? 'Loading BDL World Cup data...' : worldCupError || featureMatchMeta}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-1 min-w-0 justify-end">
                        <div className="flex h-[88px] w-[88px] flex-col items-center justify-center rounded-full border border-purple-400/50 bg-purple-500/10 text-center">
                          <div className="text-[10px] uppercase tracking-wide text-purple-600 dark:text-purple-300">Win %</div>
                          <div className="text-lg font-bold text-gray-900 dark:text-white">-</div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400">odds</div>
                        </div>
                      </div>
                    </div>

                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      <div className="w-full min-w-0">
                        <div className="flex items-center justify-center gap-2 min-w-0">
                          <h1 className="text-base font-bold text-gray-900 dark:text-white text-center truncate min-w-0">{headerTitle}</h1>
                        </div>
                        <div className="text-[11px] text-gray-600 dark:text-gray-400 text-center truncate">
                          {worldCupLoading ? 'Loading BDL World Cup data...' : worldCupError || featureMatchMeta}
                        </div>
                      </div>
                      <div className="flex justify-center">
                        <div className="flex items-center gap-2 sm:gap-2.5 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-2.5 sm:py-1.5 min-w-0">
                          <div className="flex flex-col items-center justify-center w-14 sm:w-[68px] min-w-0 flex-shrink-0">
                            <TeamBadge team={selectedTeam} isDark={isDark} />
                            <div className="mt-1 text-center leading-tight min-w-0">
                              <div className="text-[10px] font-medium text-gray-900 dark:text-white truncate">{fixturePrimaryLines[0]}</div>
                            </div>
                          </div>
                          <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs">VS</span>
                          <div className="flex flex-col items-center justify-center w-14 sm:w-[68px] min-w-0 flex-shrink-0">
                            <TeamBadge team={opponentTeam} isDark={isDark} />
                            <div className="mt-1 text-center leading-tight min-w-0">
                              <div className="text-[10px] font-medium text-gray-900 dark:text-white truncate">{fixtureSecondaryLines[0]}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full min-w-0 border-t border-gray-200 dark:border-gray-700/80 pt-2 mt-1.5 lg:mt-2 lg:pt-2">
                      {propsMode === 'player' ? (
                        <div className="relative">
                          <SearchBox
                            id="world-cup-player-search"
                            value={playerSearchQuery}
                            onChange={(value) => {
                              setPlayerSearchQuery(value);
                              setPlayerSearchOpen(true);
                            }}
                            onFocus={() => setPlayerSearchOpen(true)}
                            placeholder={playerOptions.length ? `Search ${playerOptions.length} World Cup players...` : 'Search World Cup players...'}
                            isDark={isDark}
                          />
                          {playerSearchOpen ? (
                            <div className={`absolute left-1/2 top-full z-[80] mt-1 max-h-64 w-full max-w-xl -translate-x-1/2 overflow-y-auto rounded-lg border shadow-lg custom-scrollbar lg:max-w-lg ${isDark ? 'border-gray-600 bg-[#0f172a]' : 'border-gray-200 bg-white'}`}>
                              {playerSearchLoading ? (
                                <div className={`px-3 py-3 text-sm ${emptyText}`}>Searching BDL players...</div>
                              ) : playerSearchError ? (
                                <div className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{playerSearchError}</div>
                              ) : filteredPlayers.length === 0 ? (
                                <div className={`px-3 py-3 text-sm ${emptyText}`}>No World Cup players match</div>
                              ) : (
                                filteredPlayers.map((player) => (
                                  <button
                                    key={player.id}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                      setSelectedPlayer(player);
                                      setPlayerSearchQuery(player.name);
                                      setPlayerSearchOpen(false);
                                      const team =
                                        (player.teamId ? teamOptions.find((item) => item.id === player.teamId) : null) ??
                                        teamOptions.find((item) => {
                                          const code = player.countryCode?.toLowerCase();
                                          const label = player.teamName.toLowerCase();
                                          return (
                                            (code && item.abbreviation.toLowerCase() === code) ||
                                            item.name.toLowerCase() === label ||
                                            item.name.toLowerCase().includes(label) ||
                                            label.includes(item.name.toLowerCase())
                                          );
                                        });
                                      if (team) {
                                        setSelectedTeam(team);
                                        setTeamSearchQuery(team.name);
                                      }
                                    }}
                                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:hover:bg-[#1e293b] ${
                                      selectedPlayer?.id === player.id ? 'bg-purple-50 dark:bg-purple-950/40' : ''
                                    }`}
                                  >
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">{player.shortName}</span>
                                    <span className="min-w-0">
                                      <span className="block truncate font-medium text-gray-900 dark:text-white">{player.name}</span>
                                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                                        {player.teamName} - {player.role}
                                      </span>
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="relative">
                          <SearchBox
                            id="world-cup-team-search"
                            value={teamSearchQuery}
                            onChange={(value) => {
                              setTeamSearchQuery(value);
                              setTeamSearchOpen(true);
                            }}
                            onFocus={() => setTeamSearchOpen(true)}
                            placeholder={teamOptions.length ? `Search ${teamOptions.length} World Cup teams...` : 'Search World Cup teams...'}
                            isDark={isDark}
                          />
                          {teamSearchOpen && teamSearchQuery.trim() ? (
                            <div className={`absolute left-1/2 top-full z-[80] mt-1 max-h-64 w-full max-w-xl -translate-x-1/2 overflow-y-auto rounded-lg border shadow-lg custom-scrollbar lg:max-w-lg ${isDark ? 'border-gray-600 bg-[#0f172a]' : 'border-gray-200 bg-white'}`}>
                              {filteredTeams.map((team) => (
                                <button
                                  key={team.id}
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    setSelectedTeam(team);
                                    setTeamSearchQuery(team.name);
                                    setTeamSearchOpen(false);
                                  }}
                                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:hover:bg-[#1e293b] ${
                                    selectedTeam?.id === team.id ? 'bg-purple-50 dark:bg-purple-950/40' : ''
                                  }`}
                                >
                                  <span className="font-medium text-gray-900 dark:text-white">{team.name}</span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {team.group} - {team.confederation}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`chart-container-no-focus relative z-10 rounded-lg p-0 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${DASH_CARD_GLOW} sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0`}>
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <div className={`flex-shrink-0 border-b px-3 py-2.5 text-sm font-semibold ${isDark ? 'border-gray-700 text-gray-100' : 'border-gray-200 text-gray-900'}`}>
                      {propsMode === 'player' ? 'Player props chart' : 'Team stats chart'} - World Cup
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden px-1 py-1 sm:px-2 sm:py-2">
                      <WorldCupGameByGameChart
                        isDark={isDark}
                        mode={propsMode}
                        data={worldCupData}
                        selectedTeam={selectedTeam}
                        selectedPlayer={selectedPlayer}
                        loading={worldCupLoading}
                        error={worldCupError}
                        onChartContextChange={setChartContext}
                      />
                    </div>
                  </div>
                </div>

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                  <SectionHeader
                    title="Supporting stats"
                  />
                  {worldCupError ? (
                    <EmptyState text={worldCupError} />
                  ) : (
                    <WorldCupSupportingStats
                      data={worldCupData}
                      mode={propsMode}
                      selectedPlayer={selectedPlayer}
                      selectedPlayerId={selectedPlayerId}
                      selectedTeamId={selectedTeamId}
                      chartContext={chartContext}
                      isDark={isDark}
                    />
                  )}
                </div>

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                  <SectionHeader title="Predicted lineups" subtitle="BDL match lineups, formations, average positions, and starters will populate here." />
                  <div className="grid grid-cols-1 gap-3 px-3 sm:px-4 xl:grid-cols-2">
                    {[selectedTeam, opponentTeam].map((team, idx) => (
                      <div key={team?.id || idx} className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 dark:border-white/10 dark:bg-[#07131f]">
                        <div className="mb-3 flex items-center gap-2">
                          <TeamBadge team={team} isDark={isDark} />
                          <div>
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">{team?.name || 'TBD'}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {team?.id === String(worldCupData?.featureMatch?.homeTeam?.id)
                                ? worldCupData?.featureMatch?.homeFormation || 'Formation pending'
                                : team?.id === String(worldCupData?.featureMatch?.awayTeam?.id)
                                  ? worldCupData?.featureMatch?.awayFormation || 'Formation pending'
                                  : 'Formation pending'}
                            </div>
                          </div>
                        </div>
                        <div className="relative h-[280px] overflow-hidden rounded-2xl bg-emerald-100 ring-1 ring-emerald-200 dark:bg-emerald-950/70 dark:ring-emerald-800">
                          <div className="absolute inset-x-8 top-1/2 h-px bg-white/70" />
                          <div className="absolute inset-y-8 left-1/2 w-px bg-white/70" />
                          <div className="grid h-full grid-rows-4 place-items-center py-6">
                            {[0, 1, 2, 3].map((line) => (
                              <div key={line} className="flex gap-4">
                                {[0, 1, 2].slice(0, line === 0 ? 1 : 3).map((spot) => (
                                  <span key={spot} className="h-8 w-8 rounded-full bg-white/90 shadow ring-2 ring-purple-400/50 dark:bg-slate-100" />
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`lg:hidden w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  <WorldCupInsightsPanel isDark={isDark} selectedTeam={selectedTeam} opponentTeam={opponentTeam} data={worldCupData} />
                </div>

                <div className={`lg:hidden w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4`}>
                  <SectionHeader title="Group standings" subtitle="Groups, points, goal difference, and qualification position." />
                  <EmptyState text="Group standings will load from BDL once the API key is connected." />
                </div>

                {propsMode === 'player' ? (
                  <div className="w-full min-w-0 pb-6 lg:pb-0">
                    <div className={`min-h-[120px] rounded-lg border border-dashed ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                      <EmptyState text="Player game log and box score rows will appear here." />
                    </div>
                  </div>
                ) : null}
              </div>

              <div
                className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 fade-scrollbar custom-scrollbar min-w-0 ${
                  sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
                }`}
              >
                <div className={`hidden lg:block w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  {filterControls}
                </div>

                <div className={`hidden lg:block h-[420px] w-full min-w-0 shrink-0 rounded-lg xl:h-[460px] ${DASH_CARD_GLOW} overflow-hidden`}>
                  <WorldCupInsightsPanel isDark={isDark} selectedTeam={selectedTeam} opponentTeam={opponentTeam} data={worldCupData} />
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  <SectionHeader title="Team form home/away" subtitle="Group position, match form, and home/away split." />
                  <MetricGrid metrics={['xG', 'Shots', 'SOT', 'Big chances', 'Possession', 'Cards', 'Corners', 'Fouls']} mode="team" data={worldCupData} />
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  <SectionHeader title="Availability" subtitle="Roster status, cards, suspensions, lineup notes, and tournament squad context." />
                  <EmptyState text="BDL rosters and match events will power availability once the API is connected." />
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  <SectionHeader title="World Cup schedule" subtitle="Upcoming fixtures, venue, kickoff, status, and bracket source labels." />
                  <div className="space-y-2 px-3 sm:px-4">
                    {['Next match', 'Group stage', 'Knockout path'].map((label, idx) => (
                      <div key={label} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-[#07131f]">
                        {idx === 0 ? <CalendarDays className="h-4 w-4 text-purple-500" /> : idx === 1 ? <Users className="h-4 w-4 text-purple-500" /> : <Trophy className="h-4 w-4 text-purple-500" />}
                        <div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">{label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">API pending</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MobileBottomNavigation
        hasPremium={isPro}
        username={username}
        userEmail={userEmail}
        avatarUrl={avatarUrl}
        showJournalDropdown={showJournalDropdown}
        showProfileDropdown={showProfileDropdown}
        showSettingsDropdown={showSettingsDropdown}
        setShowJournalDropdown={setShowJournalDropdown}
        setShowProfileDropdown={setShowProfileDropdown}
        setShowSettingsDropdown={setShowSettingsDropdown}
        profileDropdownRef={profileDropdownRef}
        journalDropdownRef={journalDropdownRef}
        settingsDropdownRef={settingsDropdownRef}
        onProfileClick={() => window.dispatchEvent(new CustomEvent('open-profile-modal'))}
        onSubscription={() => router.push('/subscription')}
        onLogout={async () => {
          await supabase.auth.signOut({ scope: 'local' });
          router.push('/');
        }}
        theme={theme}
        oddsFormat={oddsFormat}
        setTheme={setTheme}
        setOddsFormat={setOddsFormat}
      />
    </div>
  );
}

export default function WorldCupPage() {
  return (
    <Suspense fallback={null}>
      <WorldCupPageContent />
    </Suspense>
  );
}
