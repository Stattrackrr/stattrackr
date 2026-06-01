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

const DASH_CARD_GLOW =
  'border border-gray-200 dark:border-[#463e6b] bg-white dark:bg-[#0a1929] shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_20px_rgba(124,58,237,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22),0_0_36px_rgba(124,58,237,0.22)]';

type PropsMode = 'player' | 'team';
type OddsFormat = 'american' | 'decimal';
type InsightTab = 'dvp' | 'opponent' | 'matchup';

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
  { id: 'passes', label: 'Total Passes', playerKey: 'passes_total', teamKey: 'passes_total' },
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
  { id: 'last15', label: 'L15', count: 15 },
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

/** ISO-2 / common codes → ESPN FIFA 3-letter slug used by their flag CDN. */
const WORLD_CUP_ISO2_TO_FIFA: Record<string, string> = {
  ar: 'arg',
  au: 'aus',
  at: 'aut',
  be: 'bel',
  br: 'bra',
  ca: 'can',
  ch: 'sui',
  ci: 'civ',
  cl: 'chi',
  cm: 'cmr',
  cn: 'chn',
  co: 'col',
  cr: 'crc',
  cw: 'cuw',
  cz: 'cze',
  de: 'ger',
  dk: 'den',
  ec: 'ecu',
  eg: 'egy',
  es: 'esp',
  fi: 'fin',
  fr: 'fra',
  gh: 'gha',
  gr: 'gre',
  hn: 'hon',
  hr: 'cro',
  hu: 'hun',
  ie: 'irl',
  ir: 'irn',
  is: 'isl',
  it: 'ita',
  jo: 'jor',
  jp: 'jpn',
  kr: 'kor',
  ma: 'mar',
  mx: 'mex',
  ng: 'nga',
  nl: 'ned',
  no: 'nor',
  nz: 'nzl',
  pe: 'per',
  pl: 'pol',
  pt: 'por',
  py: 'par',
  qa: 'qat',
  ro: 'rou',
  rs: 'srb',
  ru: 'rus',
  sa: 'ksa',
  se: 'swe',
  si: 'svn',
  sk: 'svk',
  sn: 'sen',
  tn: 'tun',
  tr: 'tur',
  ua: 'ukr',
  us: 'usa',
  uy: 'uru',
  ve: 'ven',
  bg: 'bul',
  am: 'arm',
  by: 'blr',
  ge: 'geo',
  kz: 'kaz',
  uz: 'uzb',
};

const WORLD_CUP_COUNTRY_NAME_TO_FIFA: Record<string, string> = {
  'costa rica': 'crc',
  'south korea': 'kor',
  'korea republic': 'kor',
  'republic of korea': 'kor',
  'united states': 'usa',
  'saudi arabia': 'ksa',
  'czech republic': 'cze',
  czechia: 'cze',
  england: 'eng',
  netherlands: 'ned',
  germany: 'ger',
  spain: 'esp',
  japan: 'jpn',
  mexico: 'mex',
  sweden: 'swe',
  france: 'fra',
  brazil: 'bra',
  argentina: 'arg',
  australia: 'aus',
  croatia: 'cro',
  poland: 'pol',
  portugal: 'por',
  belgium: 'bel',
  switzerland: 'sui',
  uruguay: 'uru',
  colombia: 'col',
  ecuador: 'ecu',
  peru: 'per',
  chile: 'chi',
  iran: 'irn',
  morocco: 'mar',
  senegal: 'sen',
  tunisia: 'tun',
  cameroon: 'cmr',
  ghana: 'gha',
  qatar: 'qat',
  canada: 'can',
  curacao: 'cuw',
  curaçao: 'cuw',
  wales: 'wal',
  scotland: 'sco',
  'northern ireland': 'nir',
};

/** Cases where ISO 3166-1 alpha-3 differs from FIFA's 3-letter code. */
const WORLD_CUP_ISO3_TO_FIFA: Record<string, string> = {
  cri: 'crc',
  deu: 'ger',
  nld: 'ned',
  che: 'sui',
  hrv: 'cro',
  prt: 'por',
  dnk: 'den',
  isl: 'isl',
  irl: 'irl',
  pol: 'pol',
  bgr: 'bul',
  ron: 'rou',
  bih: 'bih',
  mkd: 'mkd',
  lva: 'lat',
  ltu: 'ltu',
  est: 'est',
  blr: 'blr',
  alb: 'alb',
  mlt: 'mlt',
  cyp: 'cyp',
  lux: 'lux',
  tur: 'tur',
  bel: 'bel',
  esp: 'esp',
  ita: 'ita',
  fra: 'fra',
  gbr: 'eng',
  zaf: 'rsa',
  hkg: 'hkg',
  twn: 'tpe',
  prk: 'prk',
  kor: 'kor',
  irn: 'irn',
  mex: 'mex',
  arg: 'arg',
  bra: 'bra',
  usa: 'usa',
  can: 'can',
  jpn: 'jpn',
  ksa: 'ksa',
  qat: 'qat',
  uae: 'uae',
  egy: 'egy',
  mar: 'mar',
  tun: 'tun',
  cmr: 'cmr',
  sen: 'sen',
  gha: 'gha',
  nga: 'nga',
  civ: 'civ',
};

function normalizeWorldCupFifaCode(countryCode?: string | null): string | null {
  const raw = String(countryCode || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.length === 2) return WORLD_CUP_ISO2_TO_FIFA[lower] ?? null;
  if (lower.length === 3) return WORLD_CUP_ISO3_TO_FIFA[lower] ?? lower;
  return WORLD_CUP_COUNTRY_NAME_TO_FIFA[lower] ?? null;
}

function getWorldCupFlagUrl(countryCode?: string | null): string | null {
  const fifa = normalizeWorldCupFifaCode(countryCode);
  if (!fifa) return null;
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/countries/500/${fifa}.png&h=80&w=80`;
}

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
  const opponentId = isHome ? match?.awayTeam?.id : match?.homeTeam?.id;
  if (opponentId != null) {
    const fromId = lookup.byId.get(String(opponentId));
    if (fromId) return fromId;
  }
  const nameKey = opponentLabel.trim().toLowerCase();
  const fromName = lookup.byName.get(nameKey);
  if (fromName) return fromName;
  const fifaFromName = WORLD_CUP_COUNTRY_NAME_TO_FIFA[nameKey];
  if (fifaFromName) return fifaFromName;
  return null;
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
      }
    | undefined;
  if (!point) return null;

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

function getAvailableWorldCupStats(mode: PropsMode, selectedPlayer: WorldCupPlayerOption | null) {
  const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayer?.role);
  const filtered = WORLD_CUP_STAT_OPTIONS.filter((option) => {
    const key = mode === 'player' ? option.playerKey : option.teamKey;
    if (!key) return false;
    if (mode === 'player') {
      if (WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(key) && !isGoalkeeper) return false;
      if (isGoalkeeper && WORLD_CUP_OUTFIELD_ONLY_PLAYER_KEYS.has(key)) return false;
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
  onChartContextChange?: (context: WorldCupChartContext) => void;
}) {
  const [selectedStat, setSelectedStat] = useState<WorldCupChartStatId>(
    mode === 'player' ? 'accurate_passes' : 'goals'
  );
  const [timeframe, setTimeframe] = useState<WorldCupChartTimeframe>('last10');
  const [manualLineValue, setManualLineValue] = useState<number | null>(null);
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const availableStats = useMemo(() => getAvailableWorldCupStats(mode, selectedPlayer), [mode, selectedPlayer]);
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
        const value = getWorldCupStatNumber(row, statKey);
        const teamId = String(row.team_id ?? selectedTeamId ?? '');
        const homeId = String(match?.homeTeam?.id ?? match?.raw?.home_team?.id ?? '');
        const awayId = String(match?.awayTeam?.id ?? match?.raw?.away_team?.id ?? '');
        const isHome = row.is_home === true || Boolean(homeId && teamId && homeId === teamId);
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
          tickDateLabel: getWorldCupMatchDate(match?.datetime),
          opponentCountryCode,
          opponentLogoUrl: getWorldCupFlagUrl(opponentCountryCode),
          opponent: opponentLabel,
          value,
          gameDate: getWorldCupMatchDate(match?.datetime),
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
  }, [data, mode, selectedPlayerId, selectedTeamId, statKey, timeframe, opponentTeam]);

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
    () => <WorldCupXAxisTick data={chartRows} isDark={isDark} hideTickDetails={false} />,
    [chartRows, isDark]
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
            xAxisHeight={44}
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
}: {
  data: WorldCupDashboardData | null;
  mode: PropsMode;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  selectedTeamId: string | null;
  opponentTeam: WorldCupTeamOption | null;
  chartContext: WorldCupChartContext;
  isDark: boolean;
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
    return candidates.filter((key, index, arr) => {
      if (arr.indexOf(key) !== index) return false;
      if (mode === 'player') {
        if (WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(key) && !isGoalkeeper) return false;
        if (isGoalkeeper && WORLD_CUP_OUTFIELD_ONLY_PLAYER_KEYS.has(key)) return false;
      }
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
        tickDateLabel: getWorldCupMatchDate(match?.datetime),
        opponent: opponentLabel,
        opponentCountryCode,
        opponentLogoUrl: getWorldCupFlagUrl(opponentCountryCode),
        venue: isHome ? 'HOME' : 'AWAY',
        value: getWorldCupStatNumber(row, selectedSupportingStat) ?? 0,
        gameDate: getWorldCupMatchDate(match?.datetime),
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
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  opponentTeam: WorldCupTeamOption | null;
  teamOptions: WorldCupTeamOption[];
}) {
  const playerPosition = useMemo(
    () => classifyWorldCupPosition(selectedPlayer?.role),
    [selectedPlayer?.role]
  );
  const [posSel, setPosSel] = useState<WorldCupDvpPosition>(playerPosition ?? 'MID');
  const [oppSel, setOppSel] = useState<string>(opponentTeam?.id ?? '');
  const [posOpen, setPosOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
  const [season, setSeason] = useState<2018 | 2022 | 2026>(2022);
  const [dvpData, setDvpData] = useState<WorldCupDvpResponse | null>(null);
  const [dvpLoading, setDvpLoading] = useState(false);
  const [dvpError, setDvpError] = useState<string | null>(null);

  useEffect(() => {
    if (playerPosition) setPosSel(playerPosition);
  }, [playerPosition]);

  useEffect(() => {
    if (opponentTeam?.id) setOppSel(opponentTeam.id);
  }, [opponentTeam?.id]);

  useEffect(() => {
    let cancelled = false;
    setDvpLoading(true);
    setDvpError(null);
    const statKeys = WORLD_CUP_DVP_METRICS.map((m) => m.key).join(',');
    const url = `/api/world-cup/dashboard?dvpBatch=1&season=${season}&position=${posSel}&stats=${encodeURIComponent(statKeys)}`;
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
  }, [season, posSel]);

  const opponentForLabel = useMemo(
    () => teamOptions.find((team) => team.id === oppSel) || opponentTeam,
    [oppSel, teamOptions, opponentTeam]
  );
  const posLabel = WORLD_CUP_DVP_POSITIONS.find((p) => p.id === posSel)?.label ?? posSel;
  const opponentLogoUrl = getWorldCupFlagUrl(opponentForLabel?.countryCode || opponentForLabel?.abbreviation);

  const seasonOptions: Array<2018 | 2022 | 2026> = [2018, 2022, 2026];

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

function WorldCupInsightsPanel({
  isDark,
  selectedPlayer,
  selectedTeam,
  opponentTeam,
  teamOptions,
  data,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  teamOptions: WorldCupTeamOption[];
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
          <WorldCupDvpCard
            key={`${selectedPlayer?.id ?? 'none'}-${opponentTeam?.id ?? 'none'}`}
            isDark={isDark}
            selectedPlayer={selectedPlayer}
            opponentTeam={opponentTeam}
            teamOptions={teamOptions}
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
  const [selectedTeam, setSelectedTeam] = useState<WorldCupTeamOption | null>(WORLD_CUP_TEAMS[0] ?? null);
  const [selectedPlayer, setSelectedPlayer] = useState<WorldCupPlayerOption | null>(WORLD_CUP_PLAYERS[0] ?? null);
  const [teamSearchQuery, setTeamSearchQuery] = useState(selectedTeam?.name ?? '');
  const [playerSearchQuery, setPlayerSearchQuery] = useState(selectedPlayer?.name ?? '');
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);
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
      countryCode: team.country_code || team.abbreviation || null,
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
  const selectedTeamId = selectedTeam?.id ?? null;
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;
  const selectedTeamNeedsHydration = !selectedTeamId || !/^\d+$/.test(selectedTeamId);

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
  const hasMatchup = Boolean(opponentTeam);

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

  // Keep selected team in sync with the active player (header matchup + DVP opponent).
  useEffect(() => {
    if (propsMode !== 'player' || !selectedPlayer || !teamOptions.length) return;
    const team = resolveWorldCupTeamForPlayer(selectedPlayer, teamOptions);
    if (!team || team.id === selectedTeam?.id) return;
    setSelectedTeam(team);
    setTeamSearchQuery(team.name);
  }, [propsMode, selectedPlayer, teamOptions, selectedTeam?.id]);

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
  }, [hydratedFromStorage, selectedPlayerId, selectedTeamId, selectedTeamNeedsHydration]);

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
                        {hasMatchup ? (
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
                            {hasMatchup ? (
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
                                      const team = resolveWorldCupTeamForPlayer(player, teamOptions);
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
                    <div className="min-h-0 flex-1 overflow-hidden px-1 py-1 sm:px-2 sm:py-2">
                      <WorldCupGameByGameChart
                        isDark={isDark}
                        mode={propsMode}
                        data={worldCupData}
                        selectedTeam={selectedTeam}
                        selectedPlayer={selectedPlayer}
                        opponentTeam={opponentTeam}
                        loading={worldCupLoading}
                        error={worldCupError}
                        onChartContextChange={setChartContext}
                      />
                    </div>
                  </div>
                </div>

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
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
                  <WorldCupInsightsPanel
                    isDark={isDark}
                    selectedPlayer={selectedPlayer}
                    selectedTeam={selectedTeam}
                    opponentTeam={opponentTeam}
                    teamOptions={teamOptions}
                    data={worldCupData}
                  />
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
                  <WorldCupInsightsPanel
                    isDark={isDark}
                    selectedPlayer={selectedPlayer}
                    selectedTeam={selectedTeam}
                    opponentTeam={opponentTeam}
                    teamOptions={teamOptions}
                    data={worldCupData}
                  />
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
