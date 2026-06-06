'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { CalendarDays, Search, Trophy, Users } from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabaseClient';
import { getWorldCupFlagUrl, resolveWorldCupFlagCode, FIFA_NAME_TO_CODE } from '@/lib/worldCupFlags';

const DASH_CARD_GLOW =
  'border border-gray-200 dark:border-[#463e6b] bg-white dark:bg-[#0a1929] shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_20px_rgba(124,58,237,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22),0_0_36px_rgba(124,58,237,0.22)]';

type PropsMode = 'player' | 'team';
type OddsFormat = 'american' | 'decimal';
type InsightTab = 'dvp' | 'opponent' | 'matchup';
type Competition = 'all' | 'world-cup' | 'euros' | 'nations-league';

// Stat IDs to hide per competition (data not provided by that source).
const COMMON_INTERNATIONAL_UNSUPPORTED = new Set<string>([
  'crosses',
  'saves_inside_box',
  'punches',
  'high_claims',
  'tackles_won',
  'passes_in_final_third',
  'possession_lost',
  'duels_lost',
  'ground_duels_won',
  'ground_duels_total',
  'throw_ins',
  'goal_kicks',
  'free_kicks',
  'ball_possession',
  'corner_kicks',
]);
// Team-mode (Game Props) candidate stats. These are aggregated from per-player
// match rows across BDL + the international sources. This is only the candidate
// pool — the chart further trims it at runtime to the stats that EVERY shown
// competition actually provides (see getSymmetricTeamStatIds), so e.g. xG (only
// StatsBomb has it) drops out automatically when API-Football comps are present.
const WORLD_CUP_TEAM_SUPPORTED_STAT_IDS = new Set<string>([
  'goals',
  'assists',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'shots_blocked',
  'shots_inside_box',
  'shots_outside_box',
  'accurate_passes',
  'passes',
  'fouls_committed',
  'fouls_suffered',
  'yellow_cards',
  'red_cards',
  'tackles',
  'interceptions',
  'expected_goals_xg',
  // Team-only betting markets now ingested for every competition
  // (BDL + StatsBomb + API-Football team statistics).
  'corner_kicks',
  'offsides',
  'ball_possession',
  'crosses',
  'throw_ins',
  'free_kicks',
  'goal_kicks',
]);
const UNSUPPORTED_STATS_BY_COMPETITION: Record<Competition, Set<string>> = {
  all: new Set<string>(),
  'world-cup': new Set<string>(),
  euros: COMMON_INTERNATIONAL_UNSUPPORTED, // StatsBomb still has xG + big chances
  'nations-league': new Set<string>([
    ...COMMON_INTERNATIONAL_UNSUPPORTED,
    'expected_goals_xg',
    'expected_assists_xa',
    'big_chances',
    'big_chances_created',
    'big_chances_missed',
  ]),
};
// Same idea but for the supporting-stat row's playerKey/teamKey strings.
const UNSUPPORTED_SUPPORTING_KEYS_BY_COMPETITION: Record<Competition, Set<string>> = {
  all: new Set<string>(),
  'world-cup': new Set<string>(),
  euros: new Set<string>([
    'crosses_total',
    'crosses_accurate',
    'saves_inside_box',
    'punches',
    'high_claims',
    'tackles_won',
    'passes_final_third',
    'possession_lost',
    'duels_lost',
    'ground_duels_won',
    'ground_duels_total',
  ]),
  'nations-league': new Set<string>([
    'crosses_total',
    'crosses_accurate',
    'saves_inside_box',
    'punches',
    'high_claims',
    'tackles_won',
    'passes_final_third',
    'possession_lost',
    'duels_lost',
    'ground_duels_won',
    'ground_duels_total',
    'expected_goals',
    'expected_assists',
    'big_chances',
    'big_chances_created',
    'big_chances_missed',
  ]),
};

const COMPETITION_DVP_SEASONS: Record<Competition, Array<number>> = {
  all: [2024, 2022, 2020],
  'world-cup': [2018, 2022, 2026],
  euros: [2020, 2024],
  'nations-league': [2020, 2022, 2024],
};

type WorldCupTeamOption = {
  id: string;
  name: string;
  abbreviation: string;
  countryCode?: string | null;
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
  { id: 'arg', name: 'Argentina', abbreviation: 'ARG', countryCode: 'ARG', group: 'Group pending', confederation: 'CONMEBOL' },
  { id: 'aus', name: 'Australia', abbreviation: 'AUS', countryCode: 'AUS', group: 'Group pending', confederation: 'AFC' },
  { id: 'bra', name: 'Brazil', abbreviation: 'BRA', countryCode: 'BRA', group: 'Group pending', confederation: 'CONMEBOL' },
  { id: 'eng', name: 'England', abbreviation: 'ENG', countryCode: 'ENG', group: 'Group pending', confederation: 'UEFA' },
  { id: 'fra', name: 'France', abbreviation: 'FRA', countryCode: 'FRA', group: 'Group pending', confederation: 'UEFA' },
  { id: 'mex', name: 'Mexico', abbreviation: 'MEX', countryCode: 'MEX', group: 'Group A', confederation: 'CONCACAF' },
  { id: 'usa', name: 'United States', abbreviation: 'USA', countryCode: 'USA', group: 'Group pending', confederation: 'CONCACAF' },
];

const WORLD_CUP_PLAYERS: WorldCupPlayerOption[] = [
  { id: 'player-1', name: 'World Cup Player', shortName: 'WCP', teamName: 'Select team after API', teamId: null, countryCode: null, number: '10', role: 'FWD' },
  { id: 'player-2', name: 'Tournament Midfielder', shortName: 'TM', teamName: 'Select team after API', teamId: null, countryCode: null, number: '8', role: 'MID' },
  { id: 'player-3', name: 'Starting Goalkeeper', shortName: 'SG', teamName: 'Select team after API', teamId: null, countryCode: null, number: '1', role: 'GK' },
];

const TEAM_METRICS = ['xG', 'Shots', 'SOT', 'Big chances', 'Corners', 'Possession', 'Cards', 'Fouls'];
const PLAYER_METRICS = ['Goals', 'Assists', 'xG', 'xA', 'SOT', 'Key passes', 'Touches', 'Duels'];
const WORLD_CUP_DVP_POSITIONS = [
  { id: 'DEF', label: 'DEF', name: 'Defender' },
  { id: 'MID', label: 'MID', name: 'Midfielder' },
  { id: 'ATT', label: 'ATT', name: 'Attacker' },
] as const;
type WorldCupDvpPosition = (typeof WORLD_CUP_DVP_POSITIONS)[number]['id'];
const WORLD_CUP_DVP_METRICS = [
  { key: 'goals', label: 'Goals vs ' },
  { key: 'assists', label: 'Assists vs ' },
  { key: 'shots_total', label: 'Shots vs ' },
  { key: 'shots_on_target', label: 'Shots on Target vs ' },
  { key: 'passes_accurate', label: 'Passes vs ' },
  { key: 'yellow_cards', label: 'Yellow Cards vs ' },
  { key: 'red_cards', label: 'Red Cards vs ' },
] as const;
const WORLD_CUP_STAT_OPTIONS = [
  // Player main chart order mirrors app/soccer/components/soccerPlayerStatCatalog.ts
  { id: 'goals', label: 'Goals', playerKey: 'goals', teamKey: 'goals' },
  { id: 'assists', label: 'Assists', playerKey: 'assists', teamKey: 'assists' },
  { id: 'total_shots', label: 'Total Shots', playerKey: 'derived_shots_total', teamKey: 'shots_total' },
  { id: 'shots_on_target', label: 'Shots on Target', playerKey: 'shots_on_target', teamKey: 'shots_on_target' },
  { id: 'shots_off_target', label: 'Shots off Target', playerKey: null, teamKey: 'shots_off_target' },
  { id: 'shots_blocked', label: 'Shots Blocked', playerKey: 'derived_shots_blocked', teamKey: 'shots_blocked' },
  { id: 'shots_inside_box', label: 'Shots Inside Box', playerKey: null, teamKey: 'shots_inside_box' },
  { id: 'shots_outside_box', label: 'Shots Outside Box', playerKey: null, teamKey: 'shots_outside_box' },
  { id: 'accurate_passes', label: 'Passes', playerKey: 'passes_accurate', teamKey: 'passes_accurate' },
  { id: 'big_chances_created', label: 'Big Chances Created', playerKey: 'big_chances_created', teamKey: 'big_chances' },
  { id: 'fouls_committed', label: 'Fouls Committed', playerKey: 'fouls_committed', teamKey: 'fouls' },
  { id: 'fouls_suffered', label: 'Fouls Suffered', playerKey: 'was_fouled', teamKey: 'was_fouled' },
  { id: 'duels_won', label: 'Duels Won', playerKey: 'duels_won', teamKey: null },
  { id: 'yellow_cards', label: 'Yellow Cards', playerKey: 'yellow_cards', teamKey: 'yellow_cards' },
  { id: 'red_cards', label: 'Red Cards', playerKey: 'red_cards', teamKey: 'red_cards' },

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
  { id: 'passes', label: 'Total Passes', playerKey: 'passes_total', teamKey: 'passes_total' },
  { id: 'passes_in_final_third', label: 'Passes in Final Third', playerKey: null, teamKey: 'passes_final_third' },
  { id: 'crosses', label: 'Crosses', playerKey: 'crosses_total', teamKey: 'crosses_total' },
  { id: 'possession_lost', label: 'Possession Lost', playerKey: 'possession_lost', teamKey: null },
  { id: 'successful_dribbles', label: 'Successful Dribbles', playerKey: 'dribbles_completed', teamKey: 'dribbles_completed' },
  { id: 'dribbles_attempted', label: 'Dribbles Attempted', playerKey: 'dribbles_attempted', teamKey: 'dribbles_total' },
  { id: 'tackles', label: 'Tackles', playerKey: 'tackles', teamKey: 'tackles' },
  { id: 'interceptions', label: 'Interceptions', playerKey: 'interceptions', teamKey: 'interceptions' },
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
  { id: 'last15', label: 'L15', count: 15 },
  { id: 'last20', label: 'L20', count: 20 },
  { id: 'all', label: 'ALL', count: 1000 },
  { id: 'h2h', label: 'H2H', count: 100 },
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
const WORLD_CUP_OUTFIELD_ONLY_PLAYER_KEYS = new Set([
  'goals',
  'assists',
  'derived_shots_total',
  'shots_total',
  'shots_on_target',
  'big_chances_created',
  'big_chances_missed',
  'expected_goals',
  'expected_assists',
  'crosses_total',
  'crosses_accurate',
  'dribbles_completed',
  'dribbles_attempted',
  'dribbles_total',
  'was_fouled',
]);

type WorldCupChartStatId = (typeof WORLD_CUP_STAT_OPTIONS)[number]['id'];
type WorldCupChartTimeframe = (typeof WORLD_CUP_TIMEFRAMES)[number]['id'];
// Game Props: whose value to chart for the selected stat. `team` = selected
// national team, `opponent` = their match-mate, `all` = both teams combined
// (match total).
type WorldCupStatPerspective = 'team' | 'opponent' | 'all';
const WORLD_CUP_STAT_PERSPECTIVES: Array<{ id: WorldCupStatPerspective; label: string }> = [
  { id: 'team', label: 'Team' },
  { id: 'opponent', label: 'Opponent' },
  { id: 'all', label: 'All' },
];
type WorldCupChartContext = {
  statId: WorldCupChartStatId;
  statKey: string | null;
  statLabel: string;
  timeframe: WorldCupChartTimeframe;
};

function classifyWorldCupPosition(value: string | null | undefined): WorldCupDvpPosition | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  // Goalkeepers fold into the defender bucket since DVP has no GK row.
  if (['g', 'gk', 'goalkeeper', 'goalie', 'portero'].includes(lower) || lower.includes('keeper')) return 'DEF';
  if (
    ['d', 'def', 'defender', 'cb', 'centre back', 'center back', 'centerback', 'centreback',
     'lb', 'left back', 'leftback', 'rb', 'right back', 'rightback',
     'wb', 'lwb', 'rwb', 'wing back', 'left wing back', 'right wing back'].includes(lower)
  ) return 'DEF';
  if (
    ['m', 'mf', 'mid', 'midfielder', 'cm', 'mc', 'centre midfielder', 'center midfielder',
     'cdm', 'dm', 'defensive midfielder', 'defensive mid',
     'cam', 'am', 'attacking midfielder', 'attacking mid',
     'lm', 'left midfielder', 'rm', 'right midfielder'].includes(lower)
  ) return 'MID';
  if (
    ['f', 'fw', 'forward', 'st', 'striker', 'cf', 'centre forward', 'center forward',
     'ss', 'second striker', 'lw', 'left wing', 'leftwing', 'left winger',
     'rw', 'right wing', 'rightwing', 'right winger', 'w', 'winger'].includes(lower)
  ) return 'ATT';
  return null;
}

function isWorldCupGoalkeeperRole(value: string | null | undefined): boolean {
  const role = String(value || '').trim().toLowerCase();
  if (!role) return false;
  if (role === 'g' || role === 'gk' || role === 'goalkeeper' || role === 'goalie') return true;
  if (role.includes('keeper') || role.includes('goalkeeper') || role.includes('portero')) return true;
  return false;
}

function formatWorldCupRole(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  const map: Record<string, string> = {
    g: 'Goalkeeper',
    gk: 'Goalkeeper',
    goalkeeper: 'Goalkeeper',
    goalie: 'Goalkeeper',
    d: 'Defender',
    df: 'Defender',
    def: 'Defender',
    defender: 'Defender',
    cb: 'Centre Back',
    'centre back': 'Centre Back',
    'center back': 'Centre Back',
    lb: 'Left Back',
    rb: 'Right Back',
    wb: 'Wing Back',
    lwb: 'Left Wing Back',
    rwb: 'Right Wing Back',
    m: 'Midfielder',
    mf: 'Midfielder',
    mid: 'Midfielder',
    midfielder: 'Midfielder',
    cm: 'Centre Midfielder',
    cdm: 'Defensive Midfielder',
    dm: 'Defensive Midfielder',
    cam: 'Attacking Midfielder',
    am: 'Attacking Midfielder',
    lm: 'Left Midfielder',
    rm: 'Right Midfielder',
    f: 'Forward',
    fw: 'Forward',
    forward: 'Forward',
    st: 'Striker',
    striker: 'Striker',
    cf: 'Centre Forward',
    ss: 'Second Striker',
    lw: 'Left Wing',
    rw: 'Right Wing',
    w: 'Winger',
    winger: 'Winger',
  };
  if (map[normalized]) return map[normalized];
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function resolveWorldCupTeamForPlayer(
  player: WorldCupPlayerOption | null,
  teamOptions: WorldCupTeamOption[]
): WorldCupTeamOption | null {
  if (!player || !teamOptions.length) return null;

  if (player.teamId) {
    const byId = teamOptions.find((team) => team.id === player.teamId);
    if (byId) return byId;
  }

  const code = player.countryCode?.trim().toLowerCase() || '';
  const label = player.teamName?.trim().toLowerCase() || '';
  const fifaFromName = label ? WORLD_CUP_COUNTRY_NAME_TO_FIFA[label] : null;

  return (
    teamOptions.find((team) => {
      const teamCode = (team.countryCode || '').trim().toLowerCase();
      const teamAbbr = team.abbreviation.trim().toLowerCase();
      const teamName = team.name.trim().toLowerCase();
      const teamIdLower = team.id.trim().toLowerCase();

      if (code && (teamCode === code || teamAbbr === code || teamIdLower === code)) return true;
      if (fifaFromName && (teamCode === fifaFromName || teamAbbr === fifaFromName || teamIdLower === fifaFromName)) {
        return true;
      }
      if (label && (teamName === label || teamName.includes(label) || label.includes(teamName))) return true;
      return false;
    }) ?? null
  );
}

function worldCupTeamOptionFromBdl(team: {
  id: number;
  name: string;
  abbreviation?: string | null;
  country_code?: string | null;
  confederation?: string | null;
}): WorldCupTeamOption {
  return {
    id: String(team.id),
    name: team.name,
    abbreviation: team.abbreviation || team.country_code || team.name.slice(0, 3).toUpperCase(),
    countryCode: team.country_code || team.abbreviation || null,
    group: 'World Cup',
    confederation: team.confederation || 'FIFA',
  };
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

function hasWorldCupPlayerAppearance(row: Record<string, any>): boolean {
  const minutes = getWorldCupStatNumber(row, 'minutes_played');
  return minutes != null && minutes >= 1;
}

function metricValue(metric: string, mode: PropsMode, data: WorldCupDashboardData | null, selectedPlayerId?: string | null): string {
  if (!data) return '-';
  const rows =
    mode === 'player' && selectedPlayerId
      ? data.playerMatchStats
          .filter((row) => String(row.player_id ?? row.player?.id ?? '') === selectedPlayerId)
          .filter((row) => hasWorldCupPlayerAppearance(row))
      : mode === 'player'
        ? data.playerMatchStats.filter((row) => hasWorldCupPlayerAppearance(row))
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

function TeamBadge({ team, isDark }: { team: WorldCupTeamOption | null; isDark: boolean }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = !logoFailed ? getWorldCupFlagUrl(team?.countryCode || team?.abbreviation) : null;
  if (logoUrl) {
    return (
      <div
        className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-1 ${
          isDark ? 'bg-[#0a1929] ring-purple-500/40' : 'bg-white ring-purple-200'
        }`}
      >
        <img
          src={logoUrl}
          alt={team?.name || team?.abbreviation || 'Team'}
          className="h-7 w-7 object-contain"
          onError={() => setLogoFailed(true)}
        />
      </div>
    );
  }
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

/** Blank skeleton shown inside dashboard cards when no player/team is selected. */
function WorldCupCardSkeleton({
  isDark,
  rows = 3,
  className = '',
  fill = false,
}: {
  isDark: boolean;
  rows?: number;
  className?: string;
  fill?: boolean;
}) {
  const bar = isDark ? 'bg-gray-800' : 'bg-gray-200';
  if (fill) {
    return (
      <div className={`flex h-full w-full flex-col gap-3 ${className}`}>
        <div className={`h-9 w-1/3 rounded-xl animate-pulse ${bar}`} />
        <div className={`min-h-0 flex-1 rounded-xl animate-pulse ${bar}`} />
      </div>
    );
  }
  return (
    <div className={`w-full space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className={`h-10 rounded-xl animate-pulse ${bar}`} />
      ))}
    </div>
  );
}

/** Bar-chart-shaped skeleton shown in the game-by-game chart while a player's
 * stats are loading (e.g. right after switching players). */
function WorldCupChartSkeleton({ isDark, className = '' }: { isDark: boolean; className?: string }) {
  const bar = isDark ? 'bg-gray-800' : 'bg-gray-200';
  const heights = [55, 80, 45, 70, 60, 90, 50, 75, 65, 40];
  return (
    <div className={`flex h-full w-full flex-col ${className}`}>
      <div className="flex min-h-0 flex-1 items-end justify-between gap-1.5 sm:gap-2">
        {heights.map((h, idx) => (
          <div key={idx} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <div className={`w-full rounded-t-md animate-pulse ${bar}`} style={{ height: `${h}%` }} />
            <div className={`h-3 w-3 rounded-full animate-pulse ${bar}`} />
            <div className={`h-1.5 w-2/3 rounded animate-pulse ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Flag resolution (ISO2/ISO3/name → ESPN FIFA slug) lives in lib/worldCupFlags.ts,
// backed by a verified, generated override map. `WORLD_CUP_COUNTRY_NAME_TO_FIFA`
// is kept as an alias so existing name-based team resolution keeps working.
const WORLD_CUP_COUNTRY_NAME_TO_FIFA = FIFA_NAME_TO_CODE;

function buildWorldCupTeamCountryLookup(teams: Array<{ id?: number | string; name?: string; abbreviation?: string | null; country_code?: string | null }>) {
  const byName = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const team of teams) {
    const code = String(team.country_code || team.abbreviation || '').trim();
    if (!code) continue;
    if (team.id != null) byId.set(String(team.id), code);
    if (team.name) byName.set(team.name.trim().toLowerCase(), code);
    if (team.abbreviation) byName.set(String(team.abbreviation).trim().toLowerCase(), code);
  }
  return { byName, byId };
}

function resolveWorldCupOpponentCountryCode(
  match: Record<string, any> | undefined,
  isHome: boolean,
  opponentLabel: string,
  lookup: ReturnType<typeof buildWorldCupTeamCountryLookup>
): string | null {
  const opponentTeam = isHome ? match?.awayTeam : match?.homeTeam;
  const fromTeam = opponentTeam?.country_code || opponentTeam?.abbreviation;
  if (fromTeam) return String(fromTeam).trim();
  // Prefer name-based lookups before id-based — international match team ids
  // (StatsBomb / API-Football) are NOT in BDL's team id namespace and would
  // wrongly resolve to unrelated BDL countries.
  const nameKey = opponentLabel.trim().toLowerCase();
  const fromName = lookup.byName.get(nameKey);
  if (fromName) return fromName;
  const fifaFromName = WORLD_CUP_COUNTRY_NAME_TO_FIFA[nameKey];
  if (fifaFromName) return fifaFromName;
  // Only fall back to byId when the match has a BDL-style numeric id source
  // (BDL teams). Skip for known intl-source matches.
  if (!match?.source) {
    const opponentId = isHome ? match?.awayTeam?.id : match?.homeTeam?.id;
    if (opponentId != null) {
      const fromId = lookup.byId.get(String(opponentId));
      if (fromId) return fromId;
    }
  }
  return null;
}

type WorldCupCompetitionTag = 'WC' | 'Euros' | 'NL' | 'Copa' | 'AFCON';

// Map a stat row / its match to a short competition tag shown under the date.
// Intl matches carry `source`/`tournament_slug`; BDL World Cup rows do not, so
// the absence of an intl marker defaults to World Cup. `tournament_slug` is the
// authoritative signal — Nations League, Copa América and AFCON all share
// `source: 'api-football'`, so we must distinguish them by slug first.
function deriveWorldCupCompetitionTag(
  row: Record<string, any> | null | undefined,
  match: Record<string, any> | null | undefined
): WorldCupCompetitionTag {
  const slugs = [match?.tournament_slug, match?.tournamentSlug, row?.tournament_slug].map((v) =>
    String(v ?? '').toLowerCase()
  );
  const sources = [match?.source, row?.source].map((v) => String(v ?? '').toLowerCase());

  if (slugs.some((s) => s === 'copa-america' || s === 'copa_america' || s === 'copaamerica')) return 'Copa';
  if (slugs.some((s) => s === 'afcon' || s === 'africa-cup-of-nations')) return 'AFCON';
  if (slugs.some((s) => s === 'euros' || s === 'euro')) return 'Euros';
  if (slugs.some((s) => s === 'nations-league' || s === 'nationsleague')) return 'NL';
  if (sources.some((s) => s === 'statsbomb')) return 'Euros';
  if (sources.some((s) => s === 'api-football')) return 'NL';
  return 'WC';
}

/**
 * Team mode: return the set of stat option ids whose `teamKey` has real data in
 * EVERY competition present among the given team rows. Keeps the chart's stat
 * pills "symmetrical" — a stat only shows if all of WC / Euros / NL / Copa /
 * AFCON (whichever the team actually played) provide it, so no competition ever
 * renders a misleading empty bar.
 */
function getSymmetricTeamStatIds(
  candidateOptions: Array<{ id: string; teamKey: string | null }>,
  teamRows: Array<Record<string, any>>
): Set<string> {
  const result = new Set<string>();
  if (!teamRows.length) return result;

  // Group rows by competition tag.
  const rowsByComp = new Map<string, Array<Record<string, any>>>();
  for (const row of teamRows) {
    const tag = deriveWorldCupCompetitionTag(row, undefined);
    const list = rowsByComp.get(tag) ?? [];
    list.push(row);
    rowsByComp.set(tag, list);
  }
  const comps = Array.from(rowsByComp.keys());

  for (const option of candidateOptions) {
    const key = option.teamKey;
    if (!key) continue;
    const coveredEverywhere = comps.every((comp) => {
      const rows = rowsByComp.get(comp) ?? [];
      return rows.some((row) => toNumber(row[key]) != null);
    });
    if (coveredEverywhere) result.add(option.id);
  }
  return result;
}

function WorldCupXAxisTick({ x, y, payload, data, isDark, hideTickDetails }: any) {
  const [logoFailed, setLogoFailed] = useState(false);
  const dataPoint = data?.find((row: any) => row.xKey === payload.value);
  if (!dataPoint) return null;
  const label = dataPoint.tickLabel || payload.value;
  const opponentCountryCode = dataPoint.opponentCountryCode as string | null | undefined;
  const opponentName = dataPoint.opponent as string | null | undefined;
  const rawLogoUrl =
    getWorldCupFlagUrl(opponentCountryCode) ||
    getWorldCupFlagUrl(opponentName) ||
    (dataPoint.opponentLogoUrl as string | null | undefined);
  const logoUrl = !logoFailed && rawLogoUrl ? rawLogoUrl : null;
  const labelFill = isDark ? '#cbd5e1' : '#475569';
  const dateFill = isDark ? '#94a3b8' : '#64748b';
  const compFill = isDark ? '#a78bfa' : '#7c3aed';

  return (
    <g transform={`translate(${x},${y})`}>
      {!hideTickDetails && logoUrl ? (
        <image
          href={logoUrl}
          x={-10}
          y={4}
          width={20}
          height={20}
          preserveAspectRatio="xMidYMid meet"
          onError={() => setLogoFailed(true)}
        />
      ) : !hideTickDetails ? (
        <text x={0} y={0} dy={18} textAnchor="middle" fill={labelFill} fontSize={10} fontWeight={700}>
          {label}
        </text>
      ) : null}
      {!hideTickDetails && dataPoint.tickDateLabel ? (
        <text x={0} y={0} dy={logoUrl ? 36 : 34} textAnchor="middle" fill={dateFill} fontSize={9} fontWeight={600}>
          {dataPoint.tickDateLabel}
        </text>
      ) : null}
      {!hideTickDetails && dataPoint.competitionTag ? (
        <text
          x={0}
          y={0}
          dy={logoUrl ? 47 : 45}
          textAnchor="middle"
          fill={compFill}
          fontSize={8}
          fontWeight={700}
          letterSpacing={0.3}
        >
          {dataPoint.competitionTag}
        </text>
      ) : null}
    </g>
  );
}

interface WorldCupChartTooltipProps {
  active?: boolean;
  payload?: any[];
  coordinate?: { x: number; y: number };
  isDark: boolean;
  statLabel: string;
}

function WorldCupChartTooltip({ active, payload, coordinate, isDark, statLabel }: WorldCupChartTooltipProps) {
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
        gameDate?: string;
        scoreline?: string;
        result?: string;
        venue?: string;
        value?: number;
        matchLabel?: string;
        minutes?: number | null;
        competitionTag?: WorldCupCompetitionTag;
      }
    | undefined;
  if (!point) return null;

  const competitionFullName: Record<string, string> = {
    WC: 'World Cup',
    Euros: 'Euros',
    NL: 'Nations League',
    Copa: 'Copa América',
    AFCON: 'Africa Cup of Nations',
  };
  const competitionLabel = point.competitionTag ? competitionFullName[point.competitionTag] : null;

  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipText = isDark ? '#ffffff' : '#000000';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const labelColor = isDark ? '#9ca3af' : '#6b7280';
  const winColor = isDark ? '#10b981' : '#059669';
  const lossColor = isDark ? '#ef4444' : '#dc2626';

  // Date formatting (NBA/AFL-style MM/DD/YY)
  let dateShort = point.gameDate ?? '';
  if (point.gameDate) {
    const ts = Date.parse(point.gameDate);
    if (!Number.isNaN(ts)) {
      const d = new Date(ts);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = String(d.getFullYear()).slice(-2);
      dateShort = `${month}/${day}/${year}`;
    }
  }

  // Derive W/L/D + margin from soccer scoreline like "2-1" (already team-first vs opponent).
  let gameResultLabel: string | null = null;
  let resultColor: string = labelColor;
  if (point.scoreline) {
    const m = String(point.scoreline).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        if (a === b) {
          gameResultLabel = 'Draw';
          resultColor = labelColor;
        } else if (a > b) {
          gameResultLabel = `W by ${a - b}`;
          resultColor = winColor;
        } else {
          gameResultLabel = `L by ${b - a}`;
          resultColor = lossColor;
        }
      }
    }
  }

  const getTooltipPosition = () => {
    const currentPosition = mousePosition ?? (coordinate ? { x: coordinate.x, y: coordinate.y } : null);
    if (!currentPosition) return { left: undefined as string | undefined, top: undefined as string | undefined };
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
    const tooltipWidth = 280;
    const offsetX = 15;
    const offsetY = -10;
    let left = currentPosition.x + offsetX;
    if (left + tooltipWidth > viewportWidth - 10) left = viewportWidth - tooltipWidth - 10;
    return { left: `${left}px`, top: `${currentPosition.y + offsetY}px` };
  };

  const position = getTooltipPosition();

  const tooltipStyle: React.CSSProperties = {
    backgroundColor: tooltipBg,
    border: `1px solid ${tooltipBorder}`,
    borderRadius: '8px',
    padding: '12px',
    minWidth: isMobile ? '280px' : '200px',
    maxWidth: isMobile ? '90vw' : 'none',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    zIndex: 999999,
    pointerEvents: 'none',
    position: 'fixed',
    left: position.left,
    top: position.top,
    transform: 'none',
  };

  const formattedValue =
    typeof point.value === 'number'
      ? Number.isInteger(point.value)
        ? String(point.value)
        : point.value.toFixed(1)
      : '-';

  const tooltipContent = (
    <div style={tooltipStyle}>
      <div
        style={{
          marginBottom: '10px',
          paddingBottom: '6px',
          borderBottom: `1px solid ${tooltipBorder}`,
          fontSize: '13px',
          fontWeight: 600,
          color: tooltipText,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          {(dateShort || point.opponent)
            ? `${dateShort || ''}${dateShort && point.opponent ? ' vs ' : ''}${point.opponent ?? ''}`
            : '-'}
        </span>
        {gameResultLabel ? (
          <span style={{ color: resultColor, fontWeight: 600, fontSize: '12px' }}>{gameResultLabel}</span>
        ) : null}
      </div>

      <div
        style={{
          marginBottom: '8px',
          padding: '8px',
          backgroundColor: isDark ? '#374151' : '#f3f4f6',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: 600,
          color: tooltipText,
        }}
      >
        {statLabel}: {formattedValue}
      </div>

      {competitionLabel ? (
        <div
          style={{
            marginBottom: '8px',
            fontSize: '12px',
            color: labelColor,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Competition</span>
          <span style={{ color: tooltipText, fontWeight: 600 }}>{competitionLabel}</span>
        </div>
      ) : null}

      {point.minutes != null ? (
        <div
          style={{
            marginBottom: '8px',
            fontSize: '12px',
            color: labelColor,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Minutes</span>
          <span style={{ color: tooltipText, fontWeight: 600 }}>
            {Number.isInteger(point.minutes) ? point.minutes : Number(point.minutes).toFixed(0)}
          </span>
        </div>
      ) : null}

      {point.scoreline ? (
        <div
          style={{
            fontSize: '12px',
            color: labelColor,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Final score</span>
          <span style={{ color: tooltipText, fontWeight: 600 }}>{point.scoreline}</span>
        </div>
      ) : null}
    </div>
  );

  const shouldRender = typeof window !== 'undefined' && active && (mousePosition ?? (isMobile && coordinate));
  if (shouldRender) {
    return createPortal(tooltipContent, document.body);
  }
  return null;
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
    passes_total: 'Total Passes',
    passes_accurate: 'Passes',
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

function getAvailableWorldCupStats(
  mode: PropsMode,
  selectedPlayer: WorldCupPlayerOption | null,
  competition: Competition = 'world-cup'
) {
  const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayer?.role);
  const filtered = WORLD_CUP_STAT_OPTIONS.filter((option) => {
    const key = mode === 'player' ? option.playerKey : option.teamKey;
    if (!key) return false;
    if (mode === 'player') {
      if (WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(key) && !isGoalkeeper) return false;
      if (isGoalkeeper && WORLD_CUP_OUTFIELD_ONLY_PLAYER_KEYS.has(key)) return false;
    }
    // Team mode (Game Props) stats come from aggregating per-player match rows
    // across BDL + the international sources, which only expose a subset of
    // team metrics. Restrict the pills to the ones we can actually populate so
    // the chart never renders an empty stat.
    if (mode === 'team' && !WORLD_CUP_TEAM_SUPPORTED_STAT_IDS.has(option.id)) {
      return false;
    }
    // Hide stats that are not provided by the international sources.
    if (UNSUPPORTED_STATS_BY_COMPETITION[competition].has(option.id)) {
      return false;
    }
    return true;
  });
  if (mode !== 'player' || !isGoalkeeper) return filtered;
  const goalkeeperStats = filtered.filter((option) =>
    option.playerKey ? WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(option.playerKey) : false
  );
  const otherStats = filtered.filter((option) =>
    option.playerKey ? !WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(option.playerKey) : true
  );
  return [...goalkeeperStats, ...otherStats];
}

function buildWorldCupMainYAxis(
  values: number[],
  options: { tight?: boolean } = {}
): { domain: [number, number]; ticks: number[] } {
  const maxValue = Math.max(1, ...values);
  const hasDecimals = values.some((value) => Math.abs(value - Math.round(value)) > 0.001);
  const paddedMax = options.tight ? maxValue : maxValue * 1.1;
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

function getWorldCupTickDateLabel(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const month = date.toLocaleDateString([], { month: 'short' });
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  return `${month} ${day} '${year}`;
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
  opponentTeam,
  isDark,
  loading,
  error,
  competition,
  onChartContextChange,
}: {
  data: WorldCupDashboardData | null;
  mode: PropsMode;
  selectedTeam: WorldCupTeamOption | null;
  selectedPlayer: WorldCupPlayerOption | null;
  opponentTeam: WorldCupTeamOption | null;
  isDark: boolean;
  loading: boolean;
  error: string | null;
  competition: Competition;
  onChartContextChange?: (context: WorldCupChartContext) => void;
}) {
  const [selectedStat, setSelectedStat] = useState<WorldCupChartStatId>(
    mode === 'player' ? 'accurate_passes' : 'goals'
  );
  const [timeframe, setTimeframe] = useState<WorldCupChartTimeframe>('last10');
  const [manualLineValue, setManualLineValue] = useState<number | null>(null);
  const [perspective, setPerspective] = useState<WorldCupStatPerspective>('team');
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const baseAvailableStats = useMemo(
    () => getAvailableWorldCupStats(mode, selectedPlayer, competition),
    [mode, selectedPlayer, competition]
  );
  const teamStatRows = useMemo(() => {
    if (mode !== 'team' || !data) return [] as Array<Record<string, any>>;
    const teamId = selectedTeam?.id ?? null;
    return data.teamMatchStats.filter((row) => !teamId || String(row.team_id ?? '') === teamId);
  }, [mode, data, selectedTeam?.id]);
  const availableStats = useMemo(() => {
    if (mode !== 'team') return baseAvailableStats;
    // Until rows load, keep the full candidate pool so pills don't flicker.
    if (!teamStatRows.length) return baseAvailableStats;
    const symmetric = getSymmetricTeamStatIds(baseAvailableStats, teamStatRows);
    const filtered = baseAvailableStats.filter((option) => symmetric.has(option.id));
    return filtered.length ? filtered : baseAvailableStats;
  }, [mode, baseAvailableStats, teamStatRows]);
  const statConfig = useMemo(
    () => availableStats.find((option) => option.id === selectedStat) ?? availableStats[0] ?? getChartStatConfig(mode, selectedStat),
    [availableStats, mode, selectedStat]
  );
  const statKey = mode === 'player' ? statConfig.playerKey : statConfig.teamKey;
  const selectedTeamId = selectedTeam?.id ?? null;
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;

  const chartRows = useMemo(() => {
    if (!data || !statKey) return [];
    const allMatches = [...(data.matches ?? []), ...(data.playerMatches ?? [])];
    const matchLookup = new Map(allMatches.map((match) => [String(match.id), match]));
    const countryLookup = buildWorldCupTeamCountryLookup(data.teams ?? []);
    const sourceRows =
      mode === 'player'
        ? data.playerMatchStats
            .filter((row) => !selectedPlayerId || String(row.player_id ?? row.player?.id ?? '') === selectedPlayerId)
            .filter((row) => hasWorldCupPlayerAppearance(row))
        : data.teamMatchStats.filter((row) => !selectedTeamId || String(row.team_id ?? '') === selectedTeamId);

    const rows = sourceRows
      .map((row) => {
        const matchId = String(row.match_id ?? '');
        const match = matchLookup.get(matchId);
        const teamId = String(row.team_id ?? selectedTeamId ?? '');
        const homeId = String(match?.homeTeam?.id ?? match?.raw?.home_team?.id ?? '');
        const awayId = String(match?.awayTeam?.id ?? match?.raw?.away_team?.id ?? '');
        const isHome = row.is_home === true || Boolean(homeId && teamId && homeId === teamId);
        // Resolve the value for the active perspective. `team` reads the base
        // key; `opponent` reads the match-mate's `opp_<key>`; `all` sums both
        // (match total). Missing values fall back to the base key's zero-default.
        const value = (() => {
          if (!statKey) return null;
          const readKey = (key: string): number | null => {
            const parsed = toNumber(row[key]);
            if (parsed != null) return parsed;
            return ZERO_DEFAULT_STAT_KEYS.has(statKey) ? 0 : null;
          };
          if (mode === 'team' && perspective === 'opponent') return readKey(`opp_${statKey}`);
          if (mode === 'team' && perspective === 'all') {
            const own = readKey(statKey);
            const opp = readKey(`opp_${statKey}`);
            if (own == null && opp == null) return null;
            return (own ?? 0) + (opp ?? 0);
          }
          return readKey(statKey);
        })();
        const opponentLabel = isHome
          ? String(match?.awayLabel || match?.awayTeam?.name || 'Opponent')
          : String(match?.homeLabel || match?.homeTeam?.name || 'Opponent');
        const opponentCountryCode = resolveWorldCupOpponentCountryCode(match, isHome, opponentLabel, countryLookup);
        const teamScore = isHome ? match?.homeScore : match?.awayScore;
        const opponentScore = isHome ? match?.awayScore : match?.homeScore;
        const scoreline = teamScore != null && opponentScore != null ? `${teamScore}-${opponentScore}` : '';
        return {
          key: matchId || `${row.player_id ?? row.team_id}-${row.team_id ?? 'row'}`,
          xKey: matchId || `${row.player_id ?? row.team_id}-${row.team_id ?? 'row'}`,
          tickLabel: getTeamAbbreviationFromLabel(opponentLabel),
          tickDateLabel: getWorldCupTickDateLabel(match?.datetime),
          competitionTag: deriveWorldCupCompetitionTag(row, match),
          opponentCountryCode,
          opponentLogoUrl: getWorldCupFlagUrl(opponentCountryCode),
          opponent: opponentLabel,
          value,
          gameDate: typeof match?.datetime === 'string' ? match.datetime : '',
          gameTimestamp: Date.parse(String(match?.datetime || '')) || 0,
          matchLabel: match ? `${match.homeLabel || 'TBD'} vs ${match.awayLabel || 'TBD'}` : `Match ${matchId}`,
          scoreline,
          result: scoreline,
          venue: isHome ? 'HOME' : 'AWAY',
          minutes: getWorldCupStatNumber(row, 'minutes_played'),
        };
      })
      .filter((row) => row.value != null)
      .sort((a, b) => a.gameTimestamp - b.gameTimestamp);

    if (timeframe === 'h2h') {
      const opponentName = opponentTeam?.name?.trim().toLowerCase();
      const opponentAbbr = opponentTeam?.abbreviation?.trim().toUpperCase();
      const opponentCode = opponentTeam?.countryCode?.trim().toLowerCase();
      const filtered = rows.filter((row) => {
        const rowOpponentName = row.opponent?.trim().toLowerCase();
        const rowAbbr = row.tickLabel?.trim().toUpperCase();
        const rowCode = row.opponentCountryCode?.trim().toLowerCase();
        if (opponentName && rowOpponentName === opponentName) return true;
        if (opponentAbbr && rowAbbr === opponentAbbr) return true;
        if (opponentCode && rowCode === opponentCode) return true;
        return false;
      });
      return filtered;
    }

    const frame = WORLD_CUP_TIMEFRAMES.find((option) => option.id === timeframe) ?? WORLD_CUP_TIMEFRAMES[1];
    return rows.slice(-frame.count);
  }, [data, mode, selectedPlayerId, selectedTeamId, statKey, timeframe, opponentTeam, perspective]);

  const values = useMemo(
    () => chartRows.map((row) => row.value).filter((value): value is number => value != null),
    [chartRows]
  );
  const averageValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const lineValue = manualLineValue ?? Math.round(averageValue * 2) / 2;
  const tightYAxis =
    statConfig.id === 'goals' ||
    statConfig.id === 'assists' ||
    statConfig.id === 'total_shots' ||
    statConfig.id === 'shots_on_target';
  const yAxisConfig = useMemo(
    () => buildWorldCupMainYAxis(values, { tight: tightYAxis }),
    [values, tightYAxis]
  );
  useEffect(() => {
    if (!availableStats.length) return;
    if (availableStats.some((option) => option.id === selectedStat)) return;
    setSelectedStat(availableStats[0].id);
  }, [availableStats, selectedStat]);

  useEffect(() => {
    if (mode !== 'player') return;
    if (!availableStats.length) return;
    const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayer?.role);
    const preferredId: WorldCupChartStatId = isGoalkeeper ? 'goalkeeper_saves' : 'accurate_passes';
    const preferredAvailable = availableStats.some((option) => option.id === preferredId);
    setSelectedStat(preferredAvailable ? preferredId : availableStats[0].id);
  }, [mode, selectedPlayer?.id, selectedPlayer?.role, availableStats]);

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

  const customTooltip = useCallback(
    (props: any) => <WorldCupChartTooltip {...props} isDark={isDark} statLabel={statConfig.label} />,
    [isDark, statConfig.label]
  );

  const customXAxisTick = useMemo(
    () => <WorldCupXAxisTick data={chartRows} isDark={isDark} hideTickDetails={timeframe === 'all'} />,
    [chartRows, isDark, timeframe]
  );

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
          {mode === 'team' ? (
            <div className="inline-flex items-center rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] p-0.5 h-[32px]">
              {WORLD_CUP_STAT_PERSPECTIVES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPerspective(option.id)}
                  className={`px-2 sm:px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    perspective === option.id
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  aria-pressed={perspective === option.id}
                  aria-label={`Show ${option.label.toLowerCase()} ${statConfig.label.toLowerCase()}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {loading ? (
          <WorldCupChartSkeleton isDark={isDark} />
        ) : chartRows.length ? (
          <SimpleChart
            chartData={chartRows}
            yAxisConfig={yAxisConfig}
            isDark={isDark}
            bettingLine={lineValue}
            selectedStat={statConfig.id}
            selectedTimeframe={timeframe}
            customTooltip={customTooltip}
            customXAxisTick={customXAxisTick}
            disableBarAnimation
            centerAverageOverlay
            averageOverlayLowerOnMobile
            averageOverlayHigher
            desktopChartLeftInset={40}
            desktopChartRightInset={8}
            desktopChartRightMargin={8}
            yAxisWidth={34}
            xAxisHeight={54}
            chartBottomMargin={8}
            hideBarValueLabels={false}
          />
        ) : (
          <EmptyState
            text={
              timeframe === 'h2h'
                ? 'No head-to-head'
                : mode === 'player'
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
  if (mode === 'player') {
    return data.playerMatchStats
      .filter((row) => !selectedPlayerId || String(row.player_id ?? row.player?.id ?? '') === selectedPlayerId)
      .filter((row) => hasWorldCupPlayerAppearance(row));
  }
  return data.teamMatchStats.filter((row) => !selectedTeamId || String(row.team_id ?? '') === selectedTeamId);
}

function filterWorldCupRowsByTimeframe(
  rows: Array<Record<string, any>>,
  data: WorldCupDashboardData | null,
  timeframe: WorldCupChartTimeframe,
  opponentTeam?: WorldCupTeamOption | null
) {
  const allMatches = [...(data?.matches ?? []), ...(data?.playerMatches ?? [])];
  const matchLookup = new Map(allMatches.map((match) => [String(match.id), match]));
  const sorted = [...rows].sort((a, b) => {
    const aTime = Date.parse(String(matchLookup.get(String(a.match_id))?.datetime || '')) || 0;
    const bTime = Date.parse(String(matchLookup.get(String(b.match_id))?.datetime || '')) || 0;
    return bTime - aTime;
  });

  if (timeframe === 'h2h') {
    if (!opponentTeam) return [];
    const opponentName = opponentTeam.name?.trim().toLowerCase();
    const opponentAbbr = opponentTeam.abbreviation?.trim().toUpperCase();
    const opponentCode = opponentTeam.countryCode?.trim().toLowerCase();
    const filtered = sorted.filter((row) => {
      const match = matchLookup.get(String(row.match_id));
      const isHome = row.is_home === true;
      const opp = isHome ? match?.awayTeam : match?.homeTeam;
      const oppLabel = isHome
        ? String(match?.awayLabel || match?.awayTeam?.name || '')
        : String(match?.homeLabel || match?.homeTeam?.name || '');
      const oppName = oppLabel.trim().toLowerCase();
      const oppAbbr = String(opp?.abbreviation || '').trim().toUpperCase();
      const oppCode = String(opp?.country_code || opp?.abbreviation || '').trim().toLowerCase();
      if (opponentName && oppName === opponentName) return true;
      if (opponentAbbr && oppAbbr === opponentAbbr) return true;
      if (opponentCode && oppCode === opponentCode) return true;
      return false;
    });
    return filtered.reverse();
  }

  const frame = WORLD_CUP_TIMEFRAMES.find((option) => option.id === timeframe) ?? WORLD_CUP_TIMEFRAMES[1];
  return sorted.slice(0, frame.count).reverse();
}

function WorldCupSupportingStats({
  data,
  mode,
  selectedPlayer,
  selectedPlayerId,
  selectedTeamId,
  opponentTeam,
  chartContext,
  isDark,
  competition,
}: {
  data: WorldCupDashboardData | null;
  mode: PropsMode;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  selectedTeamId: string | null;
  opponentTeam: WorldCupTeamOption | null;
  chartContext: WorldCupChartContext;
  isDark: boolean;
  competition: Competition;
}) {
  const [selectedSupportingStat, setSelectedSupportingStat] = useState('');
  const rows = useMemo(
    () =>
      filterWorldCupRowsByTimeframe(
        getWorldCupRowsForMode(data, mode, selectedPlayerId, selectedTeamId),
        data,
        chartContext.timeframe,
        opponentTeam
      ),
    [chartContext.timeframe, data, mode, selectedPlayerId, selectedTeamId, opponentTeam]
  );
  const supportingOptions = useMemo(() => {
    const candidates = buildWorldCupSupportingKeys(chartContext.statKey, mode);
    const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayer?.role);
    const unsupportedKeys = UNSUPPORTED_SUPPORTING_KEYS_BY_COMPETITION[competition];
    return candidates.filter((key, index, arr) => {
      if (arr.indexOf(key) !== index) return false;
      if (mode === 'player') {
        if (WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(key) && !isGoalkeeper) return false;
        if (isGoalkeeper && WORLD_CUP_OUTFIELD_ONLY_PLAYER_KEYS.has(key)) return false;
      }
      if (unsupportedKeys.has(key)) return false;
      return true;
    });
  }, [chartContext.statKey, mode, selectedPlayer?.role, competition]);

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
    const countryLookup = buildWorldCupTeamCountryLookup(data?.teams ?? []);
    return rows.map((row) => {
      const match = matchLookup.get(String(row.match_id));
      const isHome = row.is_home === true;
      const opponentLabel = isHome
        ? String(match?.awayLabel || match?.awayTeam?.name || 'Opponent')
        : String(match?.homeLabel || match?.homeTeam?.name || 'Opponent');
      const opponentCountryCode = resolveWorldCupOpponentCountryCode(match, isHome, opponentLabel, countryLookup);
      return {
        key: String(row.match_id),
        xKey: String(row.match_id),
        tickLabel: getTeamAbbreviationFromLabel(opponentLabel),
        tickDateLabel: getWorldCupTickDateLabel(match?.datetime),
        opponent: opponentLabel,
        opponentCountryCode,
        opponentLogoUrl: getWorldCupFlagUrl(opponentCountryCode),
        venue: isHome ? 'HOME' : 'AWAY',
        value: getWorldCupStatNumber(row, selectedSupportingStat) ?? 0,
        gameDate: typeof match?.datetime === 'string' ? match.datetime : '',
        matchLabel: match ? `${match.homeLabel || 'TBD'} vs ${match.awayLabel || 'TBD'}` : `Match ${String(row.match_id)}`,
      };
    });
  }, [data?.matches, data?.playerMatches, data?.teams, rows, selectedSupportingStat]);

  const emptyText = isDark ? 'text-gray-500' : 'text-gray-400';
  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const labelFill = isDark ? '#e5e7eb' : '#374151';

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
                  className={`flex-shrink-0 min-w-[80px] sm:min-w-[100px] px-3 sm:px-5 py-2.5 sm:py-3 rounded-lg text-sm sm:text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                    selectedSupportingStat === option
                      ? isDark
                        ? 'bg-gray-600 text-gray-100'
                        : 'bg-gray-500 text-white'
                      : isDark
                        ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  }`}
                >
                  <span>{getWorldCupStatLabelByKey(option)}</span>
                  <span className="text-xs font-normal opacity-90">{avgLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className={`h-px w-full shrink-0 ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} aria-hidden />
      </div>

      {selectedRows.length === 0 ? (
        <div className={`min-h-[120px] flex items-center justify-center text-sm ${emptyText}`}>
          {chartContext.timeframe === 'h2h'
            ? 'No head-to-head'
            : `No supporting stats available for ${chartContext.statLabel}`}
        </div>
      ) : (
        <div className="w-full h-[380px] min-h-[340px] flex-shrink-0 min-w-0 pointer-events-none select-none">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={selectedRows} margin={{ top: 24, right: 0, left: 0, bottom: 4 }} barCategoryGap="5%">
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

type WorldCupDvpMetricEntry = {
  values: Record<string, number>;
  ranks: Record<string, number>;
};

type WorldCupDvpResponse = {
  success: boolean;
  season: number;
  position: WorldCupDvpPosition;
  opponents: string[];
  metrics: Record<string, WorldCupDvpMetricEntry>;
  samples: Record<string, number>;
  teamGames: Record<string, number>;
  message?: string;
};

function getWorldCupDvpRankStyles(rank: number | null, totalRanks: number, isDark: boolean) {
  if (rank == null || rank === 0 || totalRanks <= 0) {
    return {
      borderColor: isDark ? 'border-slate-700' : 'border-slate-300',
      badgeColor: isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600',
    };
  }
  // Higher rank = more allowed = better matchup (green); scale thresholds to total team count.
  const ratio = rank / totalRanks;
  if (ratio >= 0.85) {
    return {
      borderColor: isDark ? 'border-green-900' : 'border-green-800',
      badgeColor: 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100',
    };
  }
  if (ratio >= 0.7) {
    return {
      borderColor: isDark ? 'border-green-800' : 'border-green-600',
      badgeColor: 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100',
    };
  }
  if (ratio >= 0.55) {
    return {
      borderColor: isDark ? 'border-orange-800' : 'border-orange-600',
      badgeColor: 'bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-100',
    };
  }
  if (ratio >= 0.4) {
    return {
      borderColor: isDark ? 'border-orange-900' : 'border-orange-700',
      badgeColor: 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200',
    };
  }
  if (ratio >= 0.2) {
    return {
      borderColor: isDark ? 'border-red-800' : 'border-red-600',
      badgeColor: 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100',
    };
  }
  return {
    borderColor: isDark ? 'border-red-900' : 'border-red-800',
    badgeColor: 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100',
  };
}

function WorldCupDvpCard({
  isDark,
  selectedPlayer,
  opponentTeam,
  teamOptions,
  competition,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  opponentTeam: WorldCupTeamOption | null;
  teamOptions: WorldCupTeamOption[];
  competition: Competition;
}) {
  const playerPosition = useMemo(
    () => classifyWorldCupPosition(selectedPlayer?.role),
    [selectedPlayer?.role]
  );
  const [posSel, setPosSel] = useState<WorldCupDvpPosition>(playerPosition ?? 'MID');
  const [oppSel, setOppSel] = useState<string>(opponentTeam?.id ?? '');
  const [posOpen, setPosOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
  const dvpSeasons = COMPETITION_DVP_SEASONS[competition];
  const [season, setSeason] = useState<number>(dvpSeasons[Math.min(1, dvpSeasons.length - 1)] ?? dvpSeasons[0] ?? 2022);

  // When competition changes, snap to a valid season in that competition.
  useEffect(() => {
    if (!dvpSeasons.includes(season)) {
      setSeason(dvpSeasons[Math.min(1, dvpSeasons.length - 1)] ?? dvpSeasons[0] ?? 2022);
    }
  }, [dvpSeasons, season]);
  const [dvpData, setDvpData] = useState<WorldCupDvpResponse | null>(null);
  const [dvpLoading, setDvpLoading] = useState(false);
  const [dvpError, setDvpError] = useState<string | null>(null);

  useEffect(() => {
    if (playerPosition) setPosSel(playerPosition);
  }, [playerPosition]);

  useEffect(() => {
    setOppSel(opponentTeam?.id ?? '');
  }, [opponentTeam?.id]);

  useEffect(() => {
    let cancelled = false;
    setDvpLoading(true);
    setDvpError(null);
    const statKeys = WORLD_CUP_DVP_METRICS.map((m) => m.key).join(',');
    const url = `/api/world-cup/dashboard?dvpBatch=1&competition=${encodeURIComponent(competition)}&season=${season}&position=${posSel}&stats=${encodeURIComponent(statKeys)}`;
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
        }
        return res.json() as Promise<WorldCupDvpResponse>;
      })
      .then((payload) => {
        if (cancelled) return;
        setDvpData(payload);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setDvpData(null);
        setDvpError(err.message || 'Failed to load DVP');
      })
      .finally(() => {
        if (!cancelled) setDvpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, posSel, competition]);

  const opponentForLabel = useMemo(
    () => teamOptions.find((team) => team.id === oppSel) || opponentTeam,
    [oppSel, teamOptions, opponentTeam]
  );
  const posLabel = WORLD_CUP_DVP_POSITIONS.find((p) => p.id === posSel)?.label ?? posSel;
  const opponentLogoUrl = getWorldCupFlagUrl(opponentForLabel?.countryCode || opponentForLabel?.abbreviation);

  const seasonOptions: Array<number> = dvpSeasons;

  const totalOpponents = dvpData?.opponents.length ?? 0;
  const opponentName = opponentForLabel?.name ?? '';
  const sampleSize = opponentName ? dvpData?.samples[opponentName] ?? 0 : 0;
  const opponentGames = opponentName ? dvpData?.teamGames[opponentName] ?? 0 : 0;

  const formatDvpValue = (value: number | undefined, statKey: string) => {
    if (value == null || !Number.isFinite(value)) return '—';
    if (statKey === 'yellow_cards' || statKey === 'red_cards') return value.toFixed(2);
    if (statKey === 'passes_accurate') return value.toFixed(1);
    return value.toFixed(2);
  };

  return (
    <div className="mb-4 sm:mb-6 w-full min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2 sm:mb-2">
        <h3 className="text-base sm:text-base md:text-lg font-semibold text-gray-900 dark:text-white">
          Defense vs Position
        </h3>
        <div className={`flex rounded-lg border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
          {seasonOptions.map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => setSeason(year)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                season === year
                  ? 'bg-purple-600 text-white'
                  : isDark
                    ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                    : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              {year}
            </button>
          ))}
        </div>
      </div>
      <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0`}>
        <div className="px-3 sm:px-3 py-3 sm:py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
          <div className={`rounded-lg border ${isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              Position
            </div>
            <button
              type="button"
              onClick={() => setPosOpen((open) => !open)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm font-bold ${
                isDark ? 'bg-purple-600 border-purple-600 text-white' : 'bg-purple-600 border-purple-600 text-white'
              }`}
            >
              <span>{posLabel}</span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {posOpen ? (
              <>
                <div
                  className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${
                    isDark ? 'bg-[#0a1929] border-gray-600' : 'bg-white border-gray-300'
                  }`}
                >
                  {WORLD_CUP_DVP_POSITIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setPosSel(option.id);
                        setPosOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-sm font-bold text-left ${
                        posSel === option.id
                          ? 'bg-purple-600 text-white'
                          : isDark
                            ? 'hover:bg-gray-600 text-white'
                            : 'hover:bg-gray-100 text-gray-900'
                      }`}
                    >
                      <span className="font-bold">{option.label}</span>
                      <span className={`ml-2 text-xs font-normal ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {option.name}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="fixed inset-0 z-10" onClick={() => setPosOpen(false)} />
              </>
            ) : null}
          </div>

          <div className={`rounded-lg border ${isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              Opponent Team
            </div>
            <button
              type="button"
              onClick={() => setOppOpen((open) => !open)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md border text-sm ${
                isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2">
                {opponentLogoUrl ? (
                  <img src={opponentLogoUrl} alt={opponentForLabel?.name || 'Opponent'} className="w-6 h-6 object-contain" />
                ) : null}
                <span className="font-semibold truncate">{opponentForLabel?.name || 'Select opponent'}</span>
              </span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {oppOpen ? (
              <>
                <div
                  className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${
                    isDark ? 'bg-slate-800 border-gray-600' : 'bg-white border-gray-300'
                  }`}
                >
                  <div
                    className="max-h-56 overflow-y-auto custom-scrollbar overscroll-contain"
                    onWheel={(event) => event.stopPropagation()}
                  >
                    {teamOptions.map((team) => {
                      const teamLogoUrl = getWorldCupFlagUrl(team.countryCode || team.abbreviation);
                      return (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => {
                            setOppSel(team.id);
                            setOppOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-2 py-2 text-sm text-left ${
                            isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900'
                          }`}
                        >
                          {teamLogoUrl ? (
                            <img src={teamLogoUrl} alt={team.name} className="w-5 h-5 object-contain" />
                          ) : null}
                          <span className="font-medium truncate">{team.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="fixed inset-0 z-10" onClick={() => setOppOpen(false)} />
              </>
            ) : null}
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar max-h-64 pr-1 pb-2">
          {season === 2026 && (!dvpData || dvpData.opponents.length === 0) ? (
            <div className={`mx-3 my-3 rounded-lg border-2 border-dashed px-3 py-6 text-center text-sm ${
              isDark ? 'border-slate-700 text-gray-400' : 'border-slate-300 text-gray-500'
            }`}>
              No 2026 World Cup matches have been played yet — DVP will populate once games begin.
            </div>
          ) : dvpError ? (
            <div className={`mx-3 my-3 rounded-lg border-2 border-dashed px-3 py-6 text-center text-sm ${
              isDark ? 'border-red-900 text-red-300' : 'border-red-300 text-red-700'
            }`}>
              {dvpError}
            </div>
          ) : !opponentName ? (
            <div className={`mx-3 my-3 rounded-lg border-2 border-dashed px-3 py-6 text-center text-sm ${
              isDark ? 'border-slate-700 text-gray-400' : 'border-slate-300 text-gray-500'
            }`}>
              Pick an opponent team to view {posLabel} DVP allowed.
            </div>
          ) : (
            <>
              {WORLD_CUP_DVP_METRICS.map((metric) => {
                const entry = dvpData?.metrics[metric.key];
                const value = entry?.values[opponentName];
                const rank = entry?.ranks[opponentName] ?? null;
                const styles = getWorldCupDvpRankStyles(rank, totalOpponents, isDark);
                const rankLabel = rank && totalOpponents > 0 ? `${rank}/${totalOpponents}` : 'N/A';
                return (
                  <div
                    key={metric.key}
                    className={`mx-3 my-2 rounded-lg border-2 ${styles.borderColor} px-3 py-2.5`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {metric.label}
                        {posLabel}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'} text-base sm:text-lg`}>
                          {dvpLoading && !entry ? '…' : formatDvpValue(value, metric.key)}
                        </span>
                        <span
                          className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${styles.badgeColor}`}
                        >
                          {dvpLoading && !entry ? '…' : rankLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className={`mx-3 mt-3 mb-1 text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                {dvpLoading
                  ? `Loading ${season} ${posLabel} DVP…`
                  : sampleSize > 0
                    ? `${season} ${posLabel} DVP — ${sampleSize} player-game samples across ${opponentGames} ${opponentName} games. Rank 1 = stingiest, ${totalOpponents || 'N'} = most allowed.`
                    : dvpData && dvpData.opponents.length === 0
                      ? `No completed ${season} World Cup matches yet.`
                      : `No ${posLabel} stats recorded against ${opponentName} in ${season}.`}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================
// Team form / home & away — mirrors Soccer dashboard's
// SoccerTeamFormHomeAwayPanel structure with three tabs.
// =====================

type WorldCupFormMatch = {
  id: number;
  datetime: string | null;
  status: string | null;
  homeTeam: { id: number; name: string } | null;
  awayTeam: { id: number; name: string } | null;
  homeScore: number | null;
  awayScore: number | null;
};

type WorldCupTeamMatchStatRow = Record<string, unknown> & {
  match_id?: number;
  team_id?: number;
};

type WorldCupTeamFormResponse = {
  success: boolean;
  teamId: number;
  opponentId: number | null;
  teamMatches: WorldCupFormMatch[];
  opponentMatches: WorldCupFormMatch[];
  teamMatchStats: WorldCupTeamMatchStatRow[];
};

type WorldCupTeamFormTab = 'team_form' | 'compare';

const WORLD_CUP_FORM_STAT_KEYS: Array<{ key: string; label: string }> = [
  { key: 'goals', label: 'Goals' },
  { key: 'expected_goals', label: 'xG' },
  { key: 'shots_total', label: 'Shots' },
  { key: 'shots_on_target', label: 'SOT' },
  { key: 'big_chances', label: 'Big Chances' },
  { key: 'corners', label: 'Corners' },
  { key: 'possession_pct', label: 'Possession' },
  { key: 'yellow_cards', label: 'Yellow Cards' },
  { key: 'red_cards', label: 'Red Cards' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'saves', label: 'GK Saves' },
];
const WORLD_CUP_FORM_DEFAULT_VISIBLE = ['goals', 'expected_goals', 'shots_total', 'shots_on_target'];

function readWorldCupStatNumber(row: WorldCupTeamMatchStatRow | undefined, key: string): number | null {
  if (!row) return null;
  const raw = row[key];
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function getWorldCupTeamSide(match: WorldCupFormMatch, teamId: number): 'home' | 'away' | null {
  if (match.homeTeam?.id === teamId) return 'home';
  if (match.awayTeam?.id === teamId) return 'away';
  return null;
}

function getWorldCupGoalsFor(match: WorldCupFormMatch, teamId: number): number | null {
  const side = getWorldCupTeamSide(match, teamId);
  if (!side) return null;
  return side === 'home' ? match.homeScore : match.awayScore;
}

function getWorldCupGoalsAgainst(match: WorldCupFormMatch, teamId: number): number | null {
  const side = getWorldCupTeamSide(match, teamId);
  if (!side) return null;
  return side === 'home' ? match.awayScore : match.homeScore;
}

function buildWorldCupTeamStatAverages(
  matches: WorldCupFormMatch[],
  teamId: number,
  statsByPair: Map<string, WorldCupTeamMatchStatRow>
): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};

  for (const match of matches) {
    const side = getWorldCupTeamSide(match, teamId);
    if (!side) continue;

    const goalsFor = getWorldCupGoalsFor(match, teamId);
    if (goalsFor != null) {
      sums.goals = (sums.goals ?? 0) + goalsFor;
      counts.goals = (counts.goals ?? 0) + 1;
    }

    const row = statsByPair.get(`${match.id}:${teamId}`);
    if (!row) continue;

    for (const { key } of WORLD_CUP_FORM_STAT_KEYS) {
      if (key === 'goals') continue;
      const value = readWorldCupStatNumber(row, key);
      if (value == null) continue;
      sums[key] = (sums[key] ?? 0) + value;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return Object.fromEntries(
    Object.entries(sums)
      .filter(([key]) => (counts[key] ?? 0) > 0)
      .map(([key, sum]) => [key, sum / (counts[key] ?? 1)])
  );
}

function orderWorldCupFormStatKeys(keys: Iterable<string>): string[] {
  const keySet = new Set(keys);
  const ordered: string[] = [];
  for (const { key } of WORLD_CUP_FORM_STAT_KEYS) {
    if (keySet.has(key)) ordered.push(key);
  }
  for (const key of keySet) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

function getWorldCupFormStatLabel(key: string): string {
  return WORLD_CUP_FORM_STAT_KEYS.find((entry) => entry.key === key)?.label ?? getWorldCupStatLabelByKey(key);
}

function formatWorldCupFormValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function formatWorldCupFormDelta(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.005) return 'EVEN';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function getWorldCupDeltaStyles(delta: number | null): { textClass: string; fill: string } {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.005) {
    return { textClass: 'text-amber-600 dark:text-amber-300', fill: '#d97706' };
  }
  if (delta > 0) {
    return { textClass: 'text-green-600 dark:text-green-400', fill: '#16a34a' };
  }
  return { textClass: 'text-red-600 dark:text-red-400', fill: '#ef4444' };
}

function useWorldCupTeamForm(teamId: string | null, opponentId: string | null, competition: Competition) {
  const [data, setData] = useState<WorldCupTeamFormResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId || !/^\d+$/.test(teamId)) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ teamForm: '1', teamId, competition });
    if (opponentId && /^\d+$/.test(opponentId)) params.set('opponentId', opponentId);

    fetch(`/api/world-cup/dashboard?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as WorldCupTeamFormResponse | { error?: string } | null;
        if (!response.ok) {
          throw new Error((payload as { error?: string })?.error || 'Failed to load team form');
        }
        return payload as WorldCupTeamFormResponse;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err: Error) => {
        if (cancelled || err.name === 'AbortError') return;
        setData(null);
        setError(err.message || 'Failed to load team form');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [teamId, opponentId, competition]);

  return { data, loading, error };
}

type WorldCupFormViewMode = 'selected' | 'opponent';
type WorldCupFormWindowKey = 'last5' | 'h2h';

type WorldCupFormWindow = {
  key: WorldCupFormWindowKey;
  label: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  stats: Array<{ id: string; label: string; recentAverage: number | null; seasonAverage: number | null; delta: number | null }>;
};

function buildWorldCupFormWindows(
  teamId: number,
  matches: WorldCupFormMatch[],
  opponentId: number | null,
  statsByPair: Map<string, WorldCupTeamMatchStatRow>
): WorldCupFormWindow[] {
  const sortedMatches = [...matches].sort((a, b) => {
    const aTime = Date.parse(a.datetime || '') || 0;
    const bTime = Date.parse(b.datetime || '') || 0;
    return bTime - aTime;
  });

  const last5 = sortedMatches.slice(0, 5);
  const h2h = opponentId
    ? sortedMatches
        .filter((match) => {
          const side = getWorldCupTeamSide(match, teamId);
          if (!side) return false;
          const otherId = side === 'home' ? match.awayTeam?.id : match.homeTeam?.id;
          return otherId === opponentId;
        })
        .slice(0, 5)
    : [];

  const seasonAverages = buildWorldCupTeamStatAverages(sortedMatches, teamId, statsByPair);

  const summarize = (
    windowMatches: WorldCupFormMatch[],
    key: WorldCupFormWindowKey,
    label: string
  ): WorldCupFormWindow => {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    for (const match of windowMatches) {
      const goalsFor = getWorldCupGoalsFor(match, teamId);
      const goalsAgainst = getWorldCupGoalsAgainst(match, teamId);
      if (goalsFor == null || goalsAgainst == null) continue;
      if (goalsFor > goalsAgainst) wins += 1;
      else if (goalsFor < goalsAgainst) losses += 1;
      else draws += 1;
    }
    const recentAverages = buildWorldCupTeamStatAverages(windowMatches, teamId, statsByPair);
    const statKeys = orderWorldCupFormStatKeys([
      ...Object.keys(recentAverages),
      ...Object.keys(seasonAverages),
    ]);
    const stats = statKeys.map((statKey) => {
      const recentAverage = recentAverages[statKey] ?? null;
      const seasonAverage = seasonAverages[statKey] ?? null;
      return {
        id: statKey,
        label: getWorldCupFormStatLabel(statKey),
        recentAverage,
        seasonAverage,
        delta:
          recentAverage != null && seasonAverage != null && Number.isFinite(recentAverage) && Number.isFinite(seasonAverage)
            ? recentAverage - seasonAverage
            : null,
      };
    });
    return { key, label, games: windowMatches.length, wins, draws, losses, stats };
  };

  return [summarize(last5, 'last5', 'Last 5'), summarize(h2h, 'h2h', 'Last 5 H2H')];
}

function buildWorldCupStatsByPair(rows: WorldCupTeamMatchStatRow[]): Map<string, WorldCupTeamMatchStatRow> {
  const map = new Map<string, WorldCupTeamMatchStatRow>();
  for (const row of rows) {
    const matchId = Number(row.match_id);
    const teamId = Number(row.team_id);
    if (!Number.isFinite(matchId) || !Number.isFinite(teamId)) continue;
    map.set(`${matchId}:${teamId}`, row);
  }
  return map;
}

function WorldCupFormStatRow({
  isDark,
  primary,
  secondary,
  delta,
  label,
  rightLabel,
}: {
  isDark: boolean;
  primary: number | null;
  secondary: number | null;
  delta: number | null;
  label: string;
  rightLabel: string;
}) {
  const primaryStrength = Math.max(primary ?? 0, 0.05);
  const secondaryStrength = Math.max(secondary ?? 0, 0.05);
  const totalStrength = primaryStrength + secondaryStrength;
  const primaryShare = totalStrength > 0 ? (primaryStrength / totalStrength) * 100 : 50;
  const secondaryShare = 100 - primaryShare;
  const deltaStyles = getWorldCupDeltaStyles(delta);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold leading-none">
        <span className={deltaStyles.textClass}>{formatWorldCupFormValue(primary)}</span>
        <span className={`${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{label}</span>
        <span className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{formatWorldCupFormValue(secondary)}</span>
      </div>
      <div className="relative h-3.5 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-700/60">
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${primaryShare}%`, backgroundColor: deltaStyles.fill }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-slate-400 dark:bg-slate-500"
          style={{ width: `${secondaryShare}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] leading-none">
        <span className={deltaStyles.textClass}>{formatWorldCupFormDelta(delta)}</span>
        <span className={`${isDark ? 'text-white' : 'text-gray-500'}`}>{rightLabel}</span>
      </div>
    </div>
  );
}

function WorldCupTeamFormCard({
  isDark,
  selectedTeam,
  opponentTeam,
  data,
  loading,
  error,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  data: WorldCupTeamFormResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const [viewMode, setViewMode] = useState<WorldCupFormViewMode>('selected');

  const teamIdNum = data?.teamId ?? null;
  const opponentIdNum = data?.opponentId ?? null;
  const statsByPair = useMemo(() => buildWorldCupStatsByPair(data?.teamMatchStats ?? []), [data?.teamMatchStats]);

  const selectedWindows = useMemo(
    () =>
      teamIdNum != null
        ? buildWorldCupFormWindows(teamIdNum, data?.teamMatches ?? [], opponentIdNum, statsByPair)
        : null,
    [teamIdNum, opponentIdNum, data?.teamMatches, statsByPair]
  );
  const opponentWindows = useMemo(
    () =>
      opponentIdNum != null
        ? buildWorldCupFormWindows(opponentIdNum, data?.opponentMatches ?? [], teamIdNum, statsByPair)
        : null,
    [opponentIdNum, teamIdNum, data?.opponentMatches, statsByPair]
  );

  const currentWindows = viewMode === 'opponent' ? opponentWindows : selectedWindows;
  const selectedLabel = selectedTeam?.name ?? 'Selected';
  const opponentLabel = opponentTeam?.name ?? 'Opponent';

  const visible = WORLD_CUP_FORM_DEFAULT_VISIBLE;

  if (loading) {
    return (
      <div className="px-2 pb-1.5">
        <div className={`mb-1.5 h-9 rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
        <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
          {[0, 1].map((idx) => (
            <div key={idx} className={`min-h-[10rem] rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="px-2 pb-2 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (!currentWindows || currentWindows.every((window) => window.games === 0)) {
    return (
      <div className={`px-2 pb-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        No completed World Cup games for this team yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col px-2 pb-1.5">
      <div className="mb-1">
        <div className={`inline-flex w-full items-center rounded-xl border p-0.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
          <button
            type="button"
            onClick={() => setViewMode('selected')}
            className={`min-w-0 flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
              viewMode === 'selected'
                ? 'bg-green-600 text-white shadow-sm'
                : isDark
                  ? 'text-gray-300 hover:bg-gray-800'
                  : 'text-gray-600 hover:bg-white'
            }`}
          >
            <span className="block truncate">{selectedLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('opponent')}
            disabled={!opponentTeam}
            className={`min-w-0 flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
              viewMode === 'opponent'
                ? 'bg-red-600 text-white shadow-sm'
                : isDark
                  ? 'text-gray-300 hover:bg-gray-800'
                  : 'text-gray-600 hover:bg-white'
            } ${!opponentTeam ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className="block truncate">{opponentLabel}</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-hidden pr-0.5">
        <div className="grid grid-cols-1 gap-1 lg:grid-cols-2 lg:items-start">
          {currentWindows.map((window) => (
            <div
              key={window.key}
              className={`flex flex-col rounded-lg border px-2.5 py-2.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}
            >
              <div className="mb-2">
                <div className="flex items-center gap-2">
                  <div className={`text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
                    {window.label}
                  </div>
                  <div className="ml-auto text-xs font-semibold leading-none tabular-nums">
                    <span className="text-green-500 dark:text-green-400">{window.wins}</span>
                    <span className="text-gray-400 dark:text-gray-500">-</span>
                    <span className="text-slate-500 dark:text-slate-300">{window.draws}</span>
                    <span className="text-gray-400 dark:text-gray-500">-</span>
                    <span className="text-red-500 dark:text-red-400">{window.losses}</span>
                  </div>
                </div>
                <div className={`mt-0.5 text-xs leading-none ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {window.games} {window.key === 'h2h' ? 'H2H games' : 'recent games'}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                {window.stats
                  .filter((stat) => visible.includes(stat.id))
                  .map((stat) => (
                    <WorldCupFormStatRow
                      key={stat.id}
                      isDark={isDark}
                      primary={stat.recentAverage}
                      secondary={stat.seasonAverage}
                      delta={stat.delta}
                      label={stat.label}
                      rightLabel={window.key === 'h2h' ? 'vs WC avg' : 'vs WC avg'}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorldCupTeamComparisonCard({
  isDark,
  selectedTeam,
  opponentTeam,
  data,
  loading,
  error,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  data: WorldCupTeamFormResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const teamIdNum = data?.teamId ?? null;
  const opponentIdNum = data?.opponentId ?? null;
  const statsByPair = useMemo(() => buildWorldCupStatsByPair(data?.teamMatchStats ?? []), [data?.teamMatchStats]);

  const teamAverages = useMemo(
    () =>
      teamIdNum != null
        ? buildWorldCupTeamStatAverages(data?.teamMatches ?? [], teamIdNum, statsByPair)
        : {},
    [teamIdNum, data?.teamMatches, statsByPair]
  );
  const opponentAverages = useMemo(
    () =>
      opponentIdNum != null
        ? buildWorldCupTeamStatAverages(data?.opponentMatches ?? [], opponentIdNum, statsByPair)
        : {},
    [opponentIdNum, data?.opponentMatches, statsByPair]
  );

  const visible = WORLD_CUP_FORM_DEFAULT_VISIBLE;

  if (loading) {
    return (
      <div className="px-2 pb-1.5">
        <div className={`min-h-[12rem] rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
      </div>
    );
  }

  if (error) {
    return <div className="px-2 pb-2 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (!opponentTeam) {
    return (
      <div className={`px-2 pb-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Select a fixture with an opponent to compare.
      </div>
    );
  }

  return (
    <div className="px-2 pb-1.5">
      <div className={`flex flex-col rounded-lg border px-2.5 py-2.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}>
        <div className="mb-2 flex items-center justify-between text-xs font-semibold leading-none">
          <span className="text-green-600 dark:text-green-400 truncate">{selectedTeam?.name ?? 'Selected'}</span>
          <span className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>WC averages</span>
          <span className="text-red-600 dark:text-red-400 truncate">{opponentTeam.name}</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {visible.map((statKey) => {
            const teamValue = teamAverages[statKey] ?? null;
            const opponentValue = opponentAverages[statKey] ?? null;
            const delta =
              teamValue != null && opponentValue != null ? teamValue - opponentValue : null;
            return (
              <WorldCupFormStatRow
                key={statKey}
                isDark={isDark}
                primary={teamValue}
                secondary={opponentValue}
                delta={delta}
                label={getWorldCupFormStatLabel(statKey)}
                rightLabel="head to head"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WorldCupTeamFormHomeAwayPanel({
  isDark,
  selectedTeam,
  opponentTeam,
  competition,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  competition: Competition;
}) {
  const [tab, setTab] = useState<WorldCupTeamFormTab>('team_form');
  const teamIdParam = selectedTeam?.id && /^\d+$/.test(selectedTeam.id) ? selectedTeam.id : null;
  const opponentIdParam = opponentTeam?.id && /^\d+$/.test(opponentTeam.id) ? opponentTeam.id : null;

  const { data, loading, error } = useWorldCupTeamForm(teamIdParam, opponentIdParam, competition);

  const inactiveTab =
    'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700';
  const activeTab = 'bg-purple-600 text-white border-purple-600';
  const tabBase =
    'flex-1 px-2 xl:px-2.5 py-1.5 xl:py-1.5 text-xs xl:text-sm font-semibold rounded-lg transition-colors border';

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden px-0.5 pb-0.5 pt-0.5 xl:px-1 xl:pb-1 xl:pt-1">
      <div className="mb-1 flex flex-shrink-0 gap-1 xl:gap-1.5">
        <button
          type="button"
          onClick={() => setTab('team_form')}
          className={`${tabBase} ${tab === 'team_form' ? activeTab : inactiveTab}`}
        >
          Team Form
        </button>
        <button
          type="button"
          onClick={() => setTab('compare')}
          className={`${tabBase} ${tab === 'compare' ? activeTab : inactiveTab}`}
        >
          Compare
        </button>
      </div>

      <div className="relative flex flex-col">
        <div className={tab === 'team_form' ? 'flex min-w-0 flex-col' : 'hidden'}>
          <WorldCupTeamFormCard
            isDark={isDark}
            selectedTeam={selectedTeam}
            opponentTeam={opponentTeam}
            data={data}
            loading={loading}
            error={error}
          />
        </div>
        <div className={tab === 'compare' ? 'flex min-w-0 flex-col' : 'hidden'}>
          <WorldCupTeamComparisonCard
            isDark={isDark}
            selectedTeam={selectedTeam}
            opponentTeam={opponentTeam}
            data={data}
            loading={loading}
            error={error}
          />
        </div>
      </div>
    </div>
  );
}

function WorldCupInsightsPanel({
  isDark,
  selectedPlayer,
  selectedTeam,
  opponentTeam,
  teamOptions,
  data,
  competition,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  teamOptions: WorldCupTeamOption[];
  data: WorldCupDashboardData | null;
  competition: Competition;
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
          <WorldCupDvpCard
            key={`${selectedPlayer?.id ?? 'none'}-${opponentTeam?.id ?? 'none'}-${competition}`}
            isDark={isDark}
            selectedPlayer={selectedPlayer}
            opponentTeam={opponentTeam}
            teamOptions={teamOptions}
            competition={competition}
          />
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
  const [competition, setCompetition] = useState<Competition>('world-cup');
  const [selectedTeam, setSelectedTeam] = useState<WorldCupTeamOption | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<WorldCupPlayerOption | null>(null);
  const [teamSearchQuery, setTeamSearchQuery] = useState('');
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [playerSearchOpen, setPlayerSearchOpen] = useState(false);
  const [searchedPlayers, setSearchedPlayers] = useState<WorldCupPlayerOption[]>([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const [playerSearchError, setPlayerSearchError] = useState<string | null>(null);
  const [worldCupData, setWorldCupData] = useState<WorldCupDashboardData | null>(null);
  const [worldCupLoading, setWorldCupLoading] = useState(false);
  const [worldCupError, setWorldCupError] = useState<string | null>(null);
  const [apiTeams, setApiTeams] = useState<WorldCupDashboardData['teams'] | null>(null);
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
    const sourceTeams = worldCupData?.teams?.length ? worldCupData.teams : apiTeams;
    if (!sourceTeams?.length) return WORLD_CUP_TEAMS;
    const standings = worldCupData?.standings ?? [];
    return sourceTeams.map((team) => ({
      id: String(team.id),
      name: team.name,
      abbreviation: team.abbreviation || team.country_code || team.name.slice(0, 3).toUpperCase(),
      countryCode: team.country_code || team.abbreviation || null,
      group:
        String(
          standings.find((row) => Number(row?.team?.id) === team.id)?.group?.name ??
            worldCupData?.featureMatch?.group ??
            'World Cup'
        ) || 'World Cup',
      confederation: team.confederation || 'FIFA',
    }));
  }, [worldCupData, apiTeams]);

  const hasSelection = propsMode === 'player' ? Boolean(selectedPlayer) : Boolean(selectedTeam);
  const showSkeleton = !hasSelection;
  const hasApiTeams = Boolean(worldCupData?.teams?.length || apiTeams?.length);
  const selectedTeamId = selectedTeam?.id ?? null;
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;
  const selectedTeamNeedsHydration = !selectedTeamId || !/^\d+$/.test(selectedTeamId);
  // Keep insight panels (DVP, opponent breakdown, team form) on skeleton until the
  // dashboard API has hydrated the real BDL team — avoids flashing placeholder teams
  // (e.g. Argentina from WORLD_CUP_TEAMS) while a player search is loading.
  const showInsightsSkeleton = !hasSelection || worldCupLoading || selectedTeamNeedsHydration;

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
    if (players.length) return players;
    return showSkeleton ? [] : WORLD_CUP_PLAYERS;
  }, [searchedPlayers, selectedTeam?.name, showSkeleton, teamOptions, worldCupData]);

  const opponentTeam = useMemo(() => {
    if (!hasSelection || selectedTeamNeedsHydration) return null;
    const featureMatch = worldCupData?.featureMatch;
    if (!featureMatch || !selectedTeam?.id) return null;
    const homeId = featureMatch.homeTeam?.id != null ? String(featureMatch.homeTeam.id) : null;
    const awayId = featureMatch.awayTeam?.id != null ? String(featureMatch.awayTeam.id) : null;
    if (homeId === selectedTeam.id && awayId) {
      return teamOptions.find((team) => team.id === awayId) ?? null;
    }
    if (awayId === selectedTeam.id && homeId) {
      return teamOptions.find((team) => team.id === homeId) ?? null;
    }
    // No feature match yet — leave null so DVP stays unset until the API resolves
    // the fixture (never default to the first placeholder team e.g. Argentina).
    return null;
  }, [hasSelection, selectedTeam?.id, selectedTeamNeedsHydration, teamOptions, worldCupData?.featureMatch]);
  const emptyText = isDark ? 'text-gray-400' : 'text-gray-500';
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
  // Next match countdown / live status (mirrors AFL header)
  const nextGameTipoff = useMemo(() => {
    const dt = worldCupData?.featureMatch?.datetime ? new Date(String(worldCupData.featureMatch.datetime)) : null;
    return dt && !Number.isNaN(dt.getTime()) ? dt : null;
  }, [worldCupData?.featureMatch?.datetime]);
  const isGameInProgress = String(worldCupData?.featureMatch?.status || '').toLowerCase() === 'in_progress';
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  useCountdownTimer({ nextGameTipoff, isGameInProgress, setCountdown });
  const fixtureLogoStyle = isDark
    ? { filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.65))' }
    : { filter: 'drop-shadow(0 0 1px rgba(15,23,42,0.45)) drop-shadow(0 1px 1px rgba(0,0,0,0.2))' };
  const selectedTeamLogo = getWorldCupFlagUrl(selectedTeam?.countryCode || selectedTeam?.abbreviation);
  const opponentTeamLogo = getWorldCupFlagUrl(opponentTeam?.countryCode || opponentTeam?.abbreviation);
  const selectedTeamAbbr = selectedTeam?.abbreviation || selectedTeam?.name?.slice(0, 3).toUpperCase() || 'TBD';
  const opponentTeamAbbr = opponentTeam?.abbreviation || opponentTeam?.name?.slice(0, 3).toUpperCase() || 'TBD';
  const hasMatchup = hasSelection && !showInsightsSkeleton && Boolean(opponentTeam && selectedTeam);
  const skeletonBar = isDark ? 'bg-gray-800' : 'bg-gray-200';

  useEffect(() => {
    if (typeof window === 'undefined') {
      setHydratedFromStorage(true);
      return;
    }
    try {
      const storedMode = window.localStorage.getItem('world-cup:propsMode');
      if (storedMode === 'player' || storedMode === 'team') {
        setPropsMode(storedMode);
      }
      const storedCompetition = window.localStorage.getItem('world-cup:competition');
      if (
        storedCompetition === 'all' ||
        storedCompetition === 'world-cup' ||
        storedCompetition === 'euros' ||
        storedCompetition === 'nations-league'
      ) {
        setCompetition(storedCompetition);
      }
      const storedTeamRaw = window.localStorage.getItem('world-cup:selectedTeam');
      if (storedTeamRaw) {
        const parsed = JSON.parse(storedTeamRaw) as WorldCupTeamOption | null;
        if (parsed && parsed.id) {
          setSelectedTeam(parsed);
          setTeamSearchQuery(parsed.name ?? '');
        }
      }
      const storedPlayerRaw = window.localStorage.getItem('world-cup:selectedPlayer');
      if (storedPlayerRaw) {
        const parsed = JSON.parse(storedPlayerRaw) as WorldCupPlayerOption | null;
        if (parsed && parsed.id) {
          setSelectedPlayer(parsed);
          setPlayerSearchQuery(parsed.name ?? '');
        }
      }
    } catch (err) {
      console.warn('Failed to restore World Cup selection', err);
    }
    setHydratedFromStorage(true);
  }, []);

  useEffect(() => {
    if (!hydratedFromStorage || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('world-cup:propsMode', propsMode);
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, propsMode]);

  useEffect(() => {
    if (!hydratedFromStorage || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('world-cup:competition', competition);
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, competition]);

  // When switching competition, drop any selected player whose ID is not
  // numeric in the new context (international IDs are numeric source IDs,
  // BDL IDs are also numeric; collisions are unlikely but we reset to be safe
  // so the user picks a player in the new dataset).
  const previousCompetition = useRef<Competition>(competition);
  useEffect(() => {
    if (!hydratedFromStorage) return;
    if (previousCompetition.current !== competition) {
      previousCompetition.current = competition;
      setSelectedPlayer(null);
      setPlayerSearchQuery('');
      setSelectedTeam(null);
      setTeamSearchQuery('');
      setSearchedPlayers([]);
    }
  }, [competition, hydratedFromStorage]);

  useEffect(() => {
    if (!hydratedFromStorage || typeof window === 'undefined') return;
    try {
      if (selectedTeam) {
        window.localStorage.setItem('world-cup:selectedTeam', JSON.stringify(selectedTeam));
      } else {
        window.localStorage.removeItem('world-cup:selectedTeam');
      }
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, selectedTeam]);

  useEffect(() => {
    if (!hydratedFromStorage || typeof window === 'undefined') return;
    try {
      if (selectedPlayer) {
        window.localStorage.setItem('world-cup:selectedPlayer', JSON.stringify(selectedPlayer));
      } else {
        window.localStorage.removeItem('world-cup:selectedPlayer');
      }
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, selectedPlayer]);

  // Keep selected team in sync with the active player once API teams are loaded.
  // Skip while teamOptions are still placeholders — resolving against WORLD_CUP_TEAMS
  // can pick the wrong nation and flash incorrect DVP/matchup data.
  useEffect(() => {
    if (propsMode !== 'player' || !selectedPlayer || !hasApiTeams) return;
    const team = resolveWorldCupTeamForPlayer(selectedPlayer, teamOptions);
    if (!team || team.id === selectedTeam?.id) return;
    setSelectedTeam(team);
    setTeamSearchQuery(team.name);
  }, [propsMode, selectedPlayer, hasApiTeams, teamOptions, selectedTeam?.id]);

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
    if (!hydratedFromStorage) return;
    if (!hasSelection) {
      setWorldCupData(null);
      setWorldCupLoading(false);
      setWorldCupError(null);
      return;
    }
    let cancelled = false;

    async function loadWorldCupData() {
      setWorldCupLoading(true);
      setWorldCupError(null);
      try {
        const params = new URLSearchParams({ season: '2026' });
        params.set('competition', competition);
        if (selectedTeamId && /^\d+$/.test(selectedTeamId)) params.set('teamId', selectedTeamId);
        if (selectedPlayerId) params.set('playerId', selectedPlayerId);
        if (selectedPlayer?.name) params.set('playerName', selectedPlayer.name);
        const response = await fetch(`/api/world-cup/dashboard?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => null)) as WorldCupDashboardData | { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload && 'error' in payload ? String(payload.error) : 'Failed to load World Cup data');
        }
        if (cancelled) return;
        const nextData = payload as WorldCupDashboardData;
        setWorldCupData(nextData);

        if (nextData.selectedTeam) {
          const team = worldCupTeamOptionFromBdl(nextData.selectedTeam);
          if (selectedPlayerId || selectedTeamNeedsHydration) {
            if (team.id !== selectedTeam?.id) {
              setSelectedTeam(team);
              setTeamSearchQuery(team.name);
            }
          }
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
  }, [hasSelection, hydratedFromStorage, selectedPlayerId, selectedTeamId, selectedTeamNeedsHydration, competition, selectedPlayer?.name]);

  // Load the real BDL national-team list up front so Game Props team search can
  // resolve to numeric team ids (and the correct team) before any selection.
  useEffect(() => {
    if (!hydratedFromStorage || apiTeams?.length) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/world-cup/dashboard?season=2026&teamsOnly=1', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as { teams?: WorldCupDashboardData['teams'] } | null;
        if (!cancelled && payload?.teams?.length) setApiTeams(payload.teams);
      } catch {
        /* non-fatal: fall back to placeholder teams */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydratedFromStorage, apiTeams?.length]);

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
        const params = new URLSearchParams({ search: query, competition });
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
          const draft: WorldCupPlayerOption = {
            id: String(player.id ?? name),
            name,
            shortName: String(player.short_name || `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` || 'WC').slice(0, 3).toUpperCase(),
            teamName: countryName,
            teamId: null,
            countryCode,
            number: String(player.jersey_number || ''),
            role: String(player.position || 'FIFA'),
          };
          const matchedTeam = resolveWorldCupTeamForPlayer(draft, teamOptions);
          return {
            ...draft,
            teamName: matchedTeam?.name || countryName,
            teamId: matchedTeam?.id || null,
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
  }, [playerSearchOpen, playerSearchQuery, teamOptions, competition]);

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

                <div className={`relative z-[60] rounded-lg ${DASH_CARD_GLOW} p-2.5 sm:p-4 md:p-6 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}>
                  <div className="flex flex-col gap-1.5 lg:gap-3">
                    {/* Desktop: one row - player info (left) | team vs opponent (center) | implied odds wheel (right) */}
                    <div className="hidden lg:flex items-center flex-1">
                      <div className="flex-1 min-w-0">
                        <div>
                          <div className="flex items-baseline gap-3 mb-1">
                            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                              {propsMode === 'team'
                                ? selectedTeam?.name || 'Select a Team'
                                : selectedPlayer?.name || 'Select a Player'}
                            </h1>
                            {propsMode === 'player' && selectedPlayer?.number ? (
                              <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                                #{selectedPlayer.number}
                              </span>
                            ) : null}
                          </div>
                          {propsMode === 'player' && selectedPlayer ? (
                            <>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {selectedPlayer.teamName || '—'}
                              </div>
                              {selectedPlayer.role ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  Position: {formatWorldCupRole(selectedPlayer.role)}
                                </div>
                              ) : null}
                            </>
                          ) : propsMode === 'team' && selectedTeam ? (
                            <>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {selectedTeam.confederation || '—'}
                              </div>
                              {selectedTeam.group ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {selectedTeam.group}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div className="text-xs text-gray-600 dark:text-gray-400">Search below</div>
                          )}
                        </div>
                      </div>

                      {/* Middle: Team vs Opponent matchup pill with optional countdown */}
                      <div className="hidden lg:flex flex-1 min-w-0 items-end justify-center mx-2 xl:mx-4">
                        {showSkeleton ? (
                          <div className="flex flex-col items-center gap-1.5 min-w-0">
                            <div className={`h-10 w-44 xl:w-52 rounded-lg animate-pulse ${skeletonBar}`} />
                            <div className={`h-3 w-32 rounded animate-pulse ${skeletonBar}`} />
                          </div>
                        ) : hasMatchup ? (
                          <div className="flex flex-col items-center gap-1.5 min-w-0 flex-shrink">
                            <div className="flex items-center gap-1.5 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1.5 xl:px-3 xl:py-2 min-w-0 flex-shrink overflow-hidden">
                              <div className="flex items-center gap-1 xl:gap-1.5 min-w-0 flex-shrink">
                                {selectedTeamLogo ? (
                                  <img
                                    src={selectedTeamLogo}
                                    alt={selectedTeam?.name || selectedTeamAbbr}
                                    className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                    style={fixtureLogoStyle}
                                  />
                                ) : null}
                                <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate">
                                  {selectedTeamAbbr}
                                </span>
                              </div>
                              {countdown && !isGameInProgress ? (
                                <div className="flex flex-col items-center flex-shrink-0 min-w-0 w-14 xl:w-20">
                                  <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">Kick-off in</div>
                                  <div className="text-xs xl:text-sm font-mono font-semibold text-gray-900 dark:text-white tabular-nums">
                                    {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                                  </div>
                                </div>
                              ) : isGameInProgress ? (
                                <div className="flex flex-col items-center flex-shrink-0 min-w-0">
                                  <div className="text-xs xl:text-sm font-semibold text-green-600 dark:text-green-400 animate-live-pulse-green">LIVE</div>
                                </div>
                              ) : (
                                <span className="text-gray-500 dark:text-gray-400 font-medium text-xs flex-shrink-0">VS</span>
                              )}
                              <div className="flex items-center gap-1 xl:gap-1.5 min-w-0 flex-shrink">
                                {opponentTeamLogo ? (
                                  <img
                                    src={opponentTeamLogo}
                                    alt={opponentTeam?.name || opponentTeamAbbr}
                                    className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                    style={fixtureLogoStyle}
                                  />
                                ) : null}
                                <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate">
                                  {opponentTeamAbbr}
                                </span>
                              </div>
                            </div>
                            <div className="text-[10px] xl:text-xs text-gray-600 dark:text-gray-300 text-center w-full">
                              {worldCupLoading ? 'Loading BDL World Cup data...' : worldCupError || featureMatchMeta}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                            <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Team</span>
                          </div>
                        )}
                      </div>

                      {/* Right spacer to balance the matchup column and keep it horizontally centered */}
                      <div className="hidden lg:block flex-1 min-w-0" aria-hidden />
                    </div>

                    {/* Mobile: Row 1 = name + #number; Row 2 = team/role | matchup pill */}
                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      <div className="w-full min-w-0">
                        <div className="flex-shrink-0 min-w-0">
                          <div>
                            <div className="flex items-baseline gap-3">
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                                {propsMode === 'team'
                                  ? selectedTeam?.name || 'Select a Team'
                                  : selectedPlayer?.name || 'Select a Player'}
                              </h1>
                              {propsMode === 'player' && selectedPlayer?.number ? (
                                <span className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex-shrink-0">
                                  #{selectedPlayer.number}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="lg:hidden flex flex-col gap-1 w-full min-w-0">
                        <div className="flex items-start justify-between gap-1.5 w-full min-w-0">
                          <div className="flex-shrink-0 min-w-0">
                            {propsMode === 'player' && selectedPlayer ? (
                              <div>
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {selectedPlayer.teamName || '—'}
                                </div>
                                {selectedPlayer.role ? (
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {formatWorldCupRole(selectedPlayer.role)}
                                  </div>
                                ) : null}
                              </div>
                            ) : propsMode === 'team' && selectedTeam ? (
                              <div>
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {selectedTeam.confederation || '—'}
                                </div>
                                {selectedTeam.group ? (
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {selectedTeam.group}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="text-xs text-gray-600 dark:text-gray-400">Search below</div>
                            )}
                          </div>
                          <div className="flex-shrink-0 min-w-0">
                            {showSkeleton ? (
                              <div className={`h-9 w-36 sm:w-44 rounded-lg animate-pulse ${skeletonBar}`} />
                            ) : hasMatchup ? (
                              <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-3 sm:py-2 min-w-0">
                                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                  <div className="flex items-center gap-1 min-w-0">
                                    {selectedTeamLogo ? (
                                      <img
                                        src={selectedTeamLogo}
                                        alt={selectedTeam?.name || selectedTeamAbbr}
                                        className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                                        style={fixtureLogoStyle}
                                      />
                                    ) : null}
                                    <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">
                                      {selectedTeamAbbr}
                                    </span>
                                  </div>
                                  <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                                  <div className="flex items-center gap-1 min-w-0">
                                    {opponentTeamLogo ? (
                                      <img
                                        src={opponentTeamLogo}
                                        alt={opponentTeam?.name || opponentTeamAbbr}
                                        className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                                        style={fixtureLogoStyle}
                                      />
                                    ) : null}
                                    <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">
                                      {opponentTeamAbbr}
                                    </span>
                                  </div>
                                </div>
                                {countdown && !isGameInProgress ? (
                                  <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                    <div className="text-[9px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">Kick-off in</div>
                                    <div className="text-xs font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                                      {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                                    </div>
                                  </div>
                                ) : isGameInProgress ? (
                                  <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                    <div className="text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap animate-live-pulse-green">LIVE</div>
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                                <span className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm font-medium">Select Team</span>
                              </div>
                            )}
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
                            placeholder={
                              showSkeleton || !playerOptions.length
                                ? 'Search World Cup players...'
                                : `Search ${playerOptions.length} World Cup players...`
                            }
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
                                      if (hasApiTeams) {
                                        const team = resolveWorldCupTeamForPlayer(player, teamOptions);
                                        if (team) {
                                          setSelectedTeam(team);
                                          setTeamSearchQuery(team.name);
                                        }
                                      } else {
                                        setSelectedTeam(null);
                                        setTeamSearchQuery(player.teamName || '');
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
                    <div className="min-h-0 flex-1 overflow-hidden px-1 py-1 sm:px-2 sm:py-2">
                      {showSkeleton ? (
                        <WorldCupCardSkeleton isDark={isDark} fill />
                      ) : (
                        <WorldCupGameByGameChart
                          isDark={isDark}
                          mode={propsMode}
                          data={worldCupData}
                          selectedTeam={selectedTeam}
                          selectedPlayer={selectedPlayer}
                          opponentTeam={opponentTeam}
                          loading={worldCupLoading}
                          error={worldCupError}
                          competition={competition}
                          onChartContextChange={setChartContext}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                  {showSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={4} className="px-3 sm:px-4 py-1" />
                  ) : (
                    <>
                  <h3 className={`text-sm font-semibold mb-1 px-3 sm:px-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    Supporting stats
                  </h3>
                  {worldCupError ? (
                    <EmptyState text={worldCupError} />
                  ) : (
                    <WorldCupSupportingStats
                      data={worldCupData}
                      mode={propsMode}
                      selectedPlayer={selectedPlayer}
                      selectedPlayerId={selectedPlayerId}
                      selectedTeamId={selectedTeamId}
                      opponentTeam={opponentTeam}
                      chartContext={chartContext}
                      isDark={isDark}
                      competition={competition}
                    />
                  )}
                    </>
                  )}
                </div>

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                  {showSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={5} className="px-3 sm:px-4 py-1" />
                  ) : (
                    <>
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
                    </>
                  )}
                </div>

                <div className={`lg:hidden w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={4} />
                  ) : (
                  <WorldCupInsightsPanel
                    isDark={isDark}
                    selectedPlayer={selectedPlayer}
                    selectedTeam={selectedTeam}
                    opponentTeam={opponentTeam}
                    teamOptions={teamOptions}
                    data={worldCupData}
                    competition={competition}
                  />
                  )}
                </div>

                <div className={`lg:hidden w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4`}>
                  {showSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={4} />
                  ) : (
                    <>
                      <SectionHeader title="Group standings" subtitle="Groups, points, goal difference, and qualification position." />
                      <EmptyState text="Group standings will load from BDL once the API key is connected." />
                    </>
                  )}
                </div>

                {propsMode === 'player' ? (
                  <div className="w-full min-w-0 pb-6 lg:pb-0">
                    <div className={`min-h-[120px] rounded-lg ${showSkeleton ? '' : `border border-dashed ${isDark ? 'border-gray-700' : 'border-gray-200'}`}`}>
                      {showSkeleton ? (
                        <WorldCupCardSkeleton isDark={isDark} rows={3} className="p-3" />
                      ) : (
                        <EmptyState text="Player game log and box score rows will appear here." />
                      )}
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
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} fill className="p-3 sm:p-4" />
                  ) : (
                  <WorldCupInsightsPanel
                    isDark={isDark}
                    selectedPlayer={selectedPlayer}
                    selectedTeam={selectedTeam}
                    opponentTeam={opponentTeam}
                    teamOptions={teamOptions}
                    data={worldCupData}
                    competition={competition}
                  />
                  )}
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={4} className="p-3 sm:p-4" />
                  ) : (
                  <WorldCupTeamFormHomeAwayPanel
                    isDark={isDark}
                    selectedTeam={selectedTeam}
                    opponentTeam={opponentTeam}
                    competition={competition}
                  />
                  )}
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={3} />
                  ) : (
                    <>
                      <SectionHeader title="Availability" subtitle="Roster status, cards, suspensions, lineup notes, and tournament squad context." />
                      <EmptyState text="BDL rosters and match events will power availability once the API is connected." />
                    </>
                  )}
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={3} />
                  ) : (
                    <>
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
                    </>
                  )}
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
