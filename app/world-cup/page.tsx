'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
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
import { getWorldCupFlagUrl, resolveWorldCupFlagCode, resolveBestWorldCupFlagUrl, FIFA_NAME_TO_CODE } from '@/lib/worldCupFlags';
function rankOpponentAllowedValues(entries: { slug: string; value: number }[]): Record<string, number> {
  if (!entries.length) return {};
  const sorted = [...entries].sort((a, b) => a.value - b.value || a.slug.localeCompare(b.slug));
  const ranks: Record<string, number> = {};
  let i = 0;
  while (i < sorted.length) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1]!.value === sorted[i]!.value) end++;
    const rank = i + 1;
    for (let c = i; c <= end; c++) ranks[sorted[c]!.slug] = rank;
    i = end + 1;
  }
  return ranks;
}

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
  'moneyline',
  'goals',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'shots_blocked',
  'shots_inside_box',
  'shots_outside_box',
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
  club?: string | null;
  // Canonical GK/DEF/MID/FWD bucket, resolved from `role` (BDL roster position)
  // at build time so every searchable player carries a position.
  positionGroup?: WorldCupPositionGroup;
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
  lineupMeta?: {
    source: 'feature' | 'last-match' | 'mixed';
    selectedTeamLastMatchId: number | null;
    selectedTeamLastMatchOpponentId: number | null;
    opponentTeamLastMatchId: number | null;
    opponentTeamLastMatchOpponentId: number | null;
  };
  lineupPlayerPhotos?: Record<string, string>;
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
  { id: 'GK', label: 'GK', name: 'Goalkeeper' },
  { id: 'DEF', label: 'DEF', name: 'Defender' },
  { id: 'MID', label: 'MID', name: 'Midfielder' },
  { id: 'FWD', label: 'FWD', name: 'Forward' },
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
// Goalkeepers get their own metric set — outfield stats (goals/shots) are ~0 for keepers.
const WORLD_CUP_DVP_GK_METRICS = [
  { key: 'saves', label: 'Saves vs ' },
  { key: 'passes_accurate', label: 'Passes vs ' },
  { key: 'yellow_cards', label: 'Yellow Cards vs ' },
] as const;
// Stats shown in the Opponent Breakdown (team-level "allowed" averages). These
// reuse the DVP batch endpoint's stat keys; values are summed across DEF/MID/ATT
// to give a whole-team allowed-per-game figure (mirrors the AFL Opponent
// Breakdown card's allowed-averages layout).
const WORLD_CUP_OPP_BREAKDOWN_METRICS = [
  { key: 'goals', label: 'Goals' },
  { key: 'shots_total', label: 'Shots' },
  { key: 'shots_on_target', label: 'Shots on Target' },
  { key: 'corners', label: 'Corners' },
  { key: 'passes_accurate', label: 'Passes' },
  { key: 'yellow_cards', label: 'Yellow Cards' },
  { key: 'red_cards', label: 'Red Cards' },
] as const;
// Stats shown in the Team Matchup (attack vs defense). A subset of the breakdown
// stats that read naturally as "going forward": cards are excluded since they
// don't frame as attack/defense.
const WORLD_CUP_MATCHUP_METRICS = [
  { key: 'goals', label: 'Goals' },
  { key: 'shots_total', label: 'Shots' },
  { key: 'shots_on_target', label: 'SOT' },
  { key: 'corners', label: 'Corners' },
  { key: 'passes_accurate', label: 'Passes' },
  { key: 'yellow_cards', label: 'Yellow Cards' },
  { key: 'fouls', label: 'Fouls Committed' },
  { key: 'was_fouled', label: 'Fouls Suffered' },
] as const;

/** Plain-language labels for each bar in the Team Matchup card. */
function worldCupMatchupSideLabels(statKey: string): { team: string; opponent: string } {
  switch (statKey) {
    case 'goals':
      return { team: 'Scores', opponent: 'Concedes' };
    case 'shots_total':
      return { team: 'Takes', opponent: 'Allows' };
    case 'shots_on_target':
      return { team: 'On target', opponent: 'Allows SOT' };
    case 'corners':
      return { team: 'Wins', opponent: 'Concedes' };
    case 'passes_accurate':
      return { team: 'Completes', opponent: 'Allows' };
    case 'yellow_cards':
      return { team: 'Booked', opponent: 'Books opp.' };
    case 'fouls':
      // Team = fouls they commit. Opponent "allowed" = fouls committed against them (= they draw).
      return { team: 'Commits', opponent: 'Draws' };
    case 'was_fouled':
      // Team = fouls they draw. Opponent "allowed" = fouls suffered by their opponents (= they commit).
      return { team: 'Draws', opponent: 'Commits' };
    default:
      return { team: 'For', opponent: 'Faces' };
  }
}
// Opponent Breakdown is computed over each team's last N completed games (any
// season/competition), not per-season — these are the toggle options. id 0 is
// the "All games" view (default), which averages over every game we have for a
// nation. Windows a team can't fill (e.g. L10 when they've only played 3) are
// disabled in the UI.
const WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW = 0;
const WORLD_CUP_OPP_BREAKDOWN_WINDOWS = [
  { id: 5, label: 'L5' },
  { id: 10, label: 'L10' },
  { id: WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW, label: 'All' },
] as const;
const WORLD_CUP_STAT_OPTIONS = [
  // Game Props only: win/draw/loss result view (value derived from scoreline).
  { id: 'moneyline', label: 'Money Line', playerKey: null, teamKey: 'moneyline' },
  // Player main chart order mirrors app/soccer/components/soccerPlayerStatCatalog.ts
  { id: 'goals', label: 'Goals', playerKey: 'goals', teamKey: 'goals' },
  { id: 'assists', label: 'Assists', playerKey: 'assists', teamKey: 'assists' },
  { id: 'total_shots', label: 'Total Shots', playerKey: 'derived_shots_total', teamKey: 'shots_total' },
  { id: 'shots_on_target', label: 'Shots on Target', playerKey: 'shots_on_target', teamKey: 'shots_on_target' },
  { id: 'shots_off_target', label: 'Shots off Target', playerKey: null, teamKey: 'shots_off_target' },
  { id: 'shots_blocked', label: 'Shots Blocked', playerKey: 'derived_shots_blocked', teamKey: 'shots_blocked' },
  { id: 'shots_inside_box', label: 'Shots Inside Box', playerKey: null, teamKey: 'shots_inside_box' },
  { id: 'shots_outside_box', label: 'Shots Outside Box', playerKey: null, teamKey: 'shots_outside_box' },
  { id: 'corner_kicks', label: 'Corners', playerKey: null, teamKey: 'corners' },
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
  { id: 'passes', label: 'Passes', playerKey: 'passes_total', teamKey: 'passes_total' },
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
// Stat options hidden from the chart in BOTH modes (player + team), per product
// decision. Removed from the main stat pills entirely.
const WORLD_CUP_HIDDEN_STAT_IDS = new Set<string>([
  'ball_possession',
  'throw_ins',
  'goal_kicks',
  'crosses',
  'passes_in_final_third',
]);
// Same stats by their stat-key, to drop them from the supporting-stats row too
// (that row is keyed by playerKey/teamKey, not option id).
const WORLD_CUP_HIDDEN_SUPPORTING_KEYS = new Set<string>([
  'assists',
  'throw_ins',
  'goal_kicks',
  'big_chances_created',
  'big_chances',
]);
// Player Props (player mode): stat options to hide from both the main stat
// pills and the supporting-stats row. These were removed per product decision.
const WORLD_CUP_PLAYER_HIDDEN_STAT_IDS = new Set<string>([
  'expected_goals_xg',
  'expected_assists_xa',
  'big_chances',
  'big_chances_created',
  'big_chances_missed',
  'shots_blocked',
  'crosses',
  'possession_lost',
  'tackles_won',
  'interceptions',
  'clearances',
  'duels_lost',
]);
// The corresponding playerKey strings, used to drop the same stats from the
// supporting-stats row (which is keyed by playerKey, not option id).
const WORLD_CUP_PLAYER_HIDDEN_SUPPORTING_KEYS = new Set<string>([
  'expected_goals',
  'expected_assists',
  'big_chances_created',
  'big_chances_missed',
  'derived_shots_blocked',
  'crosses_total',
  'possession_lost',
  'tackles_won',
  'interceptions',
  'clearances',
  'duels_lost',
]);
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
// Stats where the "All" (team + opponent) perspective is meaningless because the
// two sides are mirror values. Fouls suffered == the opponent's fouls committed,
// so "Fouls Committed (All)" and "Fouls Suffered (All)" both equal total match
// fouls — identical. For these we disable "All" and pin to the selected team.
const WORLD_CUP_NO_ALL_PERSPECTIVE_STAT_KEYS = new Set<string>(['fouls', 'was_fouled']);
type WorldCupChartContext = {
  statId: WorldCupChartStatId;
  statKey: string | null;
  statLabel: string;
  timeframe: WorldCupChartTimeframe;
};

// Canonical 4-way position group used across player props (search, rosters, and
// Defense vs Position). Mirrors classifyIntlPositionString in
// lib/internationalDashboard.ts so BDL roster labels and the historical
// match-stat labels agree on every player.
type WorldCupPositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD';

/**
 * Classify a raw position string (BDL roster codes, full descriptors, or
 * abbreviations) into GK/DEF/MID/FWD, or null when unrecognized. Order matters:
 * GK -> DEF (so "wing back" stays DEF) -> MID (so "attacking/defensive
 * midfielder" stays MID) -> FWD.
 */
function classifyWorldCupPositionGroup(value: string | null | undefined): WorldCupPositionGroup | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === 'fifa') return null;
  if (raw === 'g') return 'GK';
  if (raw === 'd') return 'DEF';
  if (raw === 'm') return 'MID';
  if (raw === 'f' || raw === 'w') return 'FWD';
  if (/goalkeep|goalie|keeper|portero/.test(raw) || raw === 'gk') return 'GK';
  if (
    /back|defender|defence|defense|sweeper|fullback|full-back|\bcb\b|\blb\b|\brb\b|\bwb\b|\blwb\b|\brwb\b|\brcb\b|\blcb\b/.test(
      raw
    )
  )
    return 'DEF';
  if (
    /midfield|\bmid\b|\bcm\b|\bdm\b|\bam\b|\bcdm\b|\bcam\b|\bdmf\b|\bamf\b|\blm\b|\brm\b|\bmc\b|\brcm\b|\blcm\b|\bmf\b/.test(
      raw
    )
  )
    return 'MID';
  if (
    /forward|striker|wing|attacker|attack|\bcf\b|\bst\b|\bss\b|\blw\b|\brw\b|\bfw\b|centre forward|center forward/.test(
      raw
    )
  )
    return 'FWD';
  return null;
}

/**
 * Guaranteed resolver: every player resolves to a position group. Falls back to
 * MID only when no usable label exists at all, so no searchable player is ever
 * left without a position.
 */
function resolveWorldCupPlayerGroup(value: string | null | undefined): WorldCupPositionGroup {
  return classifyWorldCupPositionGroup(value) ?? 'MID';
}

/** Resolve a player's group, preferring a precomputed `positionGroup`. */
function getWorldCupPlayerGroup(
  player: { positionGroup?: WorldCupPositionGroup | null; role?: string | null } | null | undefined
): WorldCupPositionGroup {
  if (!player) return 'MID';
  return player.positionGroup ?? resolveWorldCupPlayerGroup(player.role);
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

/** Map a persisted team (possibly a placeholder slug id) onto the live BDL list. */
function resolveStoredWorldCupTeam(
  stored: WorldCupTeamOption,
  teamOptions: WorldCupTeamOption[]
): WorldCupTeamOption | null {
  if (!stored || !teamOptions.length) return stored;
  if (/^\d+$/.test(stored.id)) {
    return teamOptions.find((team) => team.id === stored.id) ?? stored;
  }
  const nameKey = stored.name.trim().toLowerCase();
  const codeKey = (stored.countryCode || stored.abbreviation || stored.id).trim().toLowerCase();
  return (
    teamOptions.find((team) => team.name.trim().toLowerCase() === nameKey) ||
    teamOptions.find((team) => (team.countryCode || '').trim().toLowerCase() === codeKey) ||
    teamOptions.find((team) => team.abbreviation.trim().toLowerCase() === codeKey) ||
    teamOptions.find((team) => team.id.trim().toLowerCase() === codeKey) ||
    null
  );
}

const WORLD_CUP_STORAGE_KEYS = {
  propsMode: 'world-cup:propsMode',
  competition: 'world-cup:competition',
  selectedTeam: 'world-cup:selectedTeam',
  gamePropsTeam: 'world-cup:gamePropsTeam',
  selectedPlayer: 'world-cup:selectedPlayer',
  chartContext: 'world-cup:chartContext',
} as const;

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

type WorldCupCompetitionTag = 'WC' | 'WCQ' | 'Euros' | 'NL' | 'Copa' | 'AFCON' | 'AC' | 'Club';

const WORLD_CUP_COMPETITION_TAG_ORDER: WorldCupCompetitionTag[] = ['WC', 'WCQ', 'Euros', 'NL', 'Copa', 'AFCON', 'AC', 'Club'];

// Tournament stage buckets, ordered by "pressure" (group -> final).
type WorldCupStageBucket = 'group' | 'r16' | 'qf' | 'sf' | 'third' | 'final';
const WORLD_CUP_STAGE_ORDER: { id: WorldCupStageBucket; label: string }[] = [
  { id: 'group', label: 'Group Stage' },
  { id: 'r16', label: 'Round of 16' },
  { id: 'qf', label: 'Quarter-final' },
  { id: 'sf', label: 'Semi-final' },
  { id: 'third', label: '3rd Place' },
  { id: 'final', label: 'Final' },
];

// The `stage` field arrives as a string (BDL) or { name } (international sources).
function readWorldCupMatchStage(match: any): string | null {
  const raw = match?.stage;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && typeof raw.name === 'string') return raw.name;
  return null;
}

// Normalize the heterogeneous stage strings from each source into one bucket.
function deriveWorldCupStageBucket(stageRaw: string | null): WorldCupStageBucket | null {
  if (!stageRaw) return null;
  const s = stageRaw.toLowerCase();
  if (s.includes('semi')) return 'sf';
  if (s.includes('quarter') || /\bqf\b/.test(s)) return 'qf';
  if (s.includes('round of 16') || s.includes('last 16') || s.includes('1/8') || s.includes('eighth')) return 'r16';
  if ((s.includes('third') || s.includes('3rd')) && s.includes('place')) return 'third';
  if (s.includes('final')) return 'final';
  if (s.includes('group') || s.includes('league')) return 'group';
  return null;
}

function readWorldCupMatchPenaltyScores(match: Record<string, any> | null | undefined): {
  home: number | null;
  away: number | null;
} {
  if (!match) return { home: null, away: null };
  const home =
    toNumber(match.homeScorePenalties) ??
    toNumber(match.home_score_penalties) ??
    toNumber(match.home_score_penalty) ??
    null;
  const away =
    toNumber(match.awayScorePenalties) ??
    toNumber(match.away_score_penalties) ??
    toNumber(match.away_score_penalty) ??
    null;
  return { home, away };
}

/** Knockout level after ET; chart still grades as a draw, tooltip shows pens winner. */
function resolveWorldCupPenaltyShootout(
  match: Record<string, any> | null | undefined,
  isHome: boolean,
  teamLabel: string,
  opponentLabel: string
): {
  winnerName: string;
  teamWonPenalties: boolean;
  penScorelineTeamFirst: string;
} | null {
  const { home, away } = readWorldCupMatchPenaltyScores(match);
  if (home == null || away == null || home === away) return null;
  const homeWon = home > away;
  const teamWonPenalties = isHome ? homeWon : !homeWon;
  const winnerName = homeWon
    ? isHome
      ? teamLabel
      : opponentLabel
    : isHome
      ? opponentLabel
      : teamLabel;
  const teamPens = isHome ? home : away;
  const oppPens = isHome ? away : home;
  return { winnerName, teamWonPenalties, penScorelineTeamFirst: `${teamPens}-${oppPens}` };
}

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

  // Club leagues are ingested via API-Football with `club-` prefixed slugs
  // (epl, la-liga, …). Tag them all as a single "Club" competition so they sit
  // alongside the national-team tags in the chart's competition filter.
  if (slugs.some((s) => s.startsWith('club'))) return 'Club';
  if (slugs.some((s) => s.startsWith('wcq') || s === 'wc-qualifiers' || s === 'world-cup-qualification')) return 'WCQ';
  if (slugs.some((s) => s === 'copa-america' || s === 'copa_america' || s === 'copaamerica')) return 'Copa';
  if (slugs.some((s) => s === 'afcon' || s === 'africa-cup-of-nations')) return 'AFCON';
  if (slugs.some((s) => s === 'asian-cup' || s === 'afc-asian-cup')) return 'AC';
  if (slugs.some((s) => s === 'euros' || s === 'euro')) return 'Euros';
  if (slugs.some((s) => s === 'nations-league' || s === 'nationsleague')) return 'NL';
  if (sources.some((s) => s === 'statsbomb')) return 'Euros';
  if (sources.some((s) => s === 'api-football')) return 'NL';
  return 'WC';
}

/**
 * Club crests are not national flags. Club games are ingested from API-Football,
 * whose numeric team ids flow through as the opponent's `source_team_id` and map
 * 1:1 to that provider's logo CDN. Build the crest URL from that id so club
 * opponents show a real logo instead of a monogram fallback.
 */
function resolveWorldCupClubLogoUrl(
  opponentTeamId: string | number | null | undefined,
  source: unknown
): string | null {
  const id = String(opponentTeamId ?? '').trim();
  if (!/^\d+$/.test(id)) return null;
  if (String(source ?? '').toLowerCase() !== 'api-football') return null;
  return `https://media.api-sports.io/football/teams/${id}.png`;
}

/** Indicator stats used to decide whether a competition has full team-level data. */
const RICH_TEAM_STAT_KEYS = ['shots_total', 'corners', 'possession_pct', 'passes_total'] as const;

function groupTeamRowsByCompetition(
  teamRows: Array<Record<string, any>>
): Map<string, Array<Record<string, any>>> {
  const rowsByComp = new Map<string, Array<Record<string, any>>>();
  for (const row of teamRows) {
    const tag = deriveWorldCupCompetitionTag(row, undefined);
    const list = rowsByComp.get(tag) ?? [];
    list.push(row);
    rowsByComp.set(tag, list);
  }
  return rowsByComp;
}

/**
 * Competitions that participate in the symmetric-coverage gate. A competition is
 * "sparse" when its rows only carry scoreline-level fields (goals, cards) — e.g.
 * a couple of past World Cup games from BDL without full team_match_stats. Those
 * sparse buckets are excluded so they do not hide shots / possession / corners
 * that WCQ (SofaScore) and other rich sources provide.
 */
function getSymmetricCoverageCompetitions(
  rowsByComp: Map<string, Array<Record<string, any>>>
): string[] {
  const comps = Array.from(rowsByComp.keys());
  const rich = comps.filter((comp) => {
    const rows = rowsByComp.get(comp) ?? [];
    if (!rows.length) return false;
    const present = RICH_TEAM_STAT_KEYS.filter((key) =>
      rows.some((row) => toNumber(row[key]) != null)
    );
    return present.length >= 2;
  });
  return rich.length ? rich : comps;
}

function teamStatPresentInComp(
  rowsByComp: Map<string, Array<Record<string, any>>>,
  comp: string,
  key: string
): boolean {
  const rows = rowsByComp.get(comp) ?? [];
  if (!rows.length) return false;
  // Zero-default stats (yellow/red cards, fouls, …) chart as 0 when the field is
  // missing. Requiring a non-null value here wrongly drops red cards: most games
  // have no red, so every row can be null even though the stat is available.
  if (ZERO_DEFAULT_STAT_KEYS.has(key)) {
    return rows.some((row) =>
      toNumber(row[key]) != null ||
      RICH_TEAM_STAT_KEYS.some((richKey) => toNumber(row[richKey]) != null)
    );
  }
  return rows.some((row) => toNumber(row[key]) != null);
}

/**
 * Team mode: return stat keys present in every *rich* competition among the team
 * rows (see getSymmetricCoverageCompetitions). Keeps pills aligned across WC /
 * Euros / NL / Copa / AFCON when those sources all provide full team stats, but
 * does not let a sparse WC slice hide stats from WCQ.
 */
function getSymmetricTeamStatKeys(
  keys: string[],
  teamRows: Array<Record<string, any>>
): Set<string> {
  const result = new Set<string>();
  if (!teamRows.length) return result;
  const rowsByComp = groupTeamRowsByCompetition(teamRows);
  const comps = getSymmetricCoverageCompetitions(rowsByComp);
  for (const key of keys) {
    if (!key) continue;
    const coveredEverywhere = comps.every((comp) => teamStatPresentInComp(rowsByComp, comp, key));
    if (coveredEverywhere) result.add(key);
  }
  return result;
}

function getSymmetricTeamStatIds(
  candidateOptions: Array<{ id: string; teamKey: string | null }>,
  teamRows: Array<Record<string, any>>
): Set<string> {
  const result = new Set<string>();
  if (!teamRows.length) return result;
  const rowsByComp = groupTeamRowsByCompetition(teamRows);
  const comps = getSymmetricCoverageCompetitions(rowsByComp);

  for (const option of candidateOptions) {
    const key = option.teamKey;
    if (!key) continue;
    const coveredEverywhere = comps.every((comp) => teamStatPresentInComp(rowsByComp, comp, key));
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
    (dataPoint.opponentLogoUrl as string | null | undefined) ||
    resolveBestWorldCupFlagUrl(opponentName, opponentCountryCode);
  const logoUrl = !logoFailed && rawLogoUrl ? rawLogoUrl : null;
  const dateFill = isDark ? '#94a3b8' : '#64748b';
  const compFill = isDark ? '#a78bfa' : '#7c3aed';

  // Monogram fallback so EVERY game shows a logo-style badge — even when no flag
  // resolves (uncommon opponent names or sources without a country code).
  const monogram = String(label || opponentName || '?')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase() || '?';
  const badgeFill = isDark ? '#1e293b' : '#e2e8f0';
  const badgeStroke = isDark ? '#334155' : '#cbd5e1';
  const monoFill = isDark ? '#e2e8f0' : '#334155';

  return (
    <g transform={`translate(${x},${y})`}>
      {!hideTickDetails ? (
        logoUrl ? (
          <image
            href={logoUrl}
            x={-10}
            y={4}
            width={20}
            height={20}
            preserveAspectRatio="xMidYMid meet"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <>
            <circle cx={0} cy={14} r={10.5} fill={badgeFill} stroke={badgeStroke} strokeWidth={1} />
            <text x={0} y={14} dy={3} textAnchor="middle" fill={monoFill} fontSize={8} fontWeight={800} letterSpacing={0.2}>
              {monogram}
            </text>
          </>
        )
      ) : null}
      {!hideTickDetails && dataPoint.tickDateLabel ? (
        <text x={0} y={0} dy={37} textAnchor="middle" fill={dateFill} fontSize={9} fontWeight={600}>
          {dataPoint.tickDateLabel}
        </text>
      ) : null}
      {!hideTickDetails && dataPoint.competitionTag ? (
        <text
          x={0}
          y={0}
          dy={48}
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
  isMoneyline?: boolean;
}

function WorldCupChartTooltip({ active, payload, coordinate, isDark, statLabel, isMoneyline }: WorldCupChartTooltipProps) {
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
        penaltyShootout?: {
          winnerName: string;
          teamWonPenalties: boolean;
          penScorelineTeamFirst: string;
        } | null;
      }
    | undefined;
  if (!point) return null;

  const competitionFullName: Record<string, string> = {
    WC: 'World Cup',
    WCQ: 'World Cup Qualifier',
    Euros: 'Euros',
    NL: 'Nations League',
    Copa: 'Copa América',
    AFCON: 'Africa Cup of Nations',
    AC: 'Asian Cup',
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
          color: isMoneyline ? resultColor : tooltipText,
        }}
      >
        {isMoneyline
          ? `${gameResultLabel ?? 'Result'}${point.scoreline ? ` (${point.scoreline})` : ''}`
          : `${statLabel}: ${formattedValue}`}
      </div>

      {point.penaltyShootout ? (
        <div
          style={{
            marginBottom: '8px',
            padding: '8px',
            backgroundColor: isDark ? '#374151' : '#f3f4f6',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            color: point.penaltyShootout.teamWonPenalties ? winColor : lossColor,
          }}
        >
          {point.penaltyShootout.winnerName} won {point.penaltyShootout.penScorelineTeamFirst} on pens
        </div>
      ) : null}

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
    passes_total: 'Passes',
    passes_accurate: 'Completed Passes',
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
    passes_in_final_third: 'Passes in Final Third',
    successful_dribbles: 'Successful Dribbles',
  };
  return labels[key] ?? key.split('_').map((word) => word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)).join(' ');
}

function buildWorldCupSupportingKeys(mainKey: string | null, mode: PropsMode): string[] {
  const unique = (preferred: string[]) => preferred.filter((key, index, arr) => Boolean(key) && arr.indexOf(key) === index);
  const main = mainKey || '';
  if (mode === 'team') {
    // Category groups so the supporting row reflects the main chart (e.g. pick
    // Goals/Total Shots → the shooting family appears). The symmetric-coverage
    // filter in WorldCupSupportingStats then trims anything a competition lacks,
    // so xG falls back to total shots / SOT automatically when unavailable.
    const shooting = [
      'goals',
      'shots_total',
      'shots_on_target',
      'shots_off_target',
      'shots_blocked',
      'shots_inside_box',
      'shots_outside_box',
      'expected_goals',
      'big_chances',
    ];
    const passing = ['passes_total', 'possession_pct', 'passes_accurate'];
    const discipline = ['fouls', 'yellow_cards', 'red_cards', 'offsides'];
    const setPieces = ['corners', 'offsides', 'throw_ins', 'free_kicks', 'goal_kicks'];
    const defending = ['tackles', 'interceptions', 'clearances', 'fouls'];

    if (shooting.includes(main)) return unique([main, ...shooting]);
    if (passing.includes(main)) return unique([main, ...passing]);
    if (['corners', 'throw_ins', 'free_kicks', 'goal_kicks'].includes(main)) {
      return unique([main, ...setPieces, 'shots_total', 'shots_on_target']);
    }
    if (['yellow_cards', 'red_cards'].includes(main)) return unique([main, ...discipline, ...defending]);
    if (main === 'fouls') return unique([main, ...discipline, 'tackles', 'interceptions']);
    if (['tackles', 'interceptions', 'clearances'].includes(main)) return unique([main, ...defending]);
    return unique([main, 'shots_total', 'shots_on_target', 'possession_pct', 'corners', 'passes_total'].filter(Boolean));
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
    return unique(['minutes_played', 'assists', 'expected_assists', 'key_passes', 'passes_total']);
  }
  if (['passes_accurate', 'passes_total'].includes(main)) {
    return unique(['minutes_played', 'passes_total', 'expected_assists', 'key_passes']);
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
    // Globally hidden stats (both modes).
    if (WORLD_CUP_HIDDEN_STAT_IDS.has(option.id)) return false;
    if (mode === 'player') {
      if (WORLD_CUP_PLAYER_HIDDEN_STAT_IDS.has(option.id)) return false;
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
  if (mode === 'player') {
    // Player Props ordering: passes immediately after shots on target, and
    // tackles immediately after passes.
    const moveAfter = (id: string, afterId: string) => {
      const idx = filtered.findIndex((o) => o.id === id);
      if (idx === -1) return;
      const [item] = filtered.splice(idx, 1);
      const afterIdx = filtered.findIndex((o) => o.id === afterId);
      if (afterIdx === -1) filtered.push(item);
      else filtered.splice(afterIdx + 1, 0, item);
    };
    moveAfter('passes', 'shots_on_target');
    moveAfter('tackles', 'passes');
  }
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
    mode === 'player' ? 'passes' : 'total_shots'
  );
  const [timeframe, setTimeframe] = useState<WorldCupChartTimeframe>('last10');
  const [manualLineValue, setManualLineValue] = useState<number | null>(null);
  const [perspective, setPerspective] = useState<WorldCupStatPerspective>('all');
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const [competitionFilter, setCompetitionFilter] = useState<WorldCupCompetitionTag | 'all'>('all');
  const [isCompetitionDropdownOpen, setIsCompetitionDropdownOpen] = useState(false);
  const competitionDropdownRef = useRef<HTMLDivElement>(null);
  const [stageFilter, setStageFilter] = useState<WorldCupStageBucket | 'all'>('all');
  const [isStageDropdownOpen, setIsStageDropdownOpen] = useState(false);
  const stageDropdownRef = useRef<HTMLDivElement>(null);
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
    // Money Line is derived from the scoreline (not a team-stat field), so it is
    // always available regardless of cross-competition stat coverage.
    const filtered = baseAvailableStats.filter(
      (option) => option.id === 'moneyline' || symmetric.has(option.id)
    );
    return filtered.length ? filtered : baseAvailableStats;
  }, [mode, baseAvailableStats, teamStatRows]);
  const statConfig = useMemo(
    () => availableStats.find((option) => option.id === selectedStat) ?? availableStats[0] ?? getChartStatConfig(mode, selectedStat),
    [availableStats, mode, selectedStat]
  );
  const statKey = mode === 'player' ? statConfig.playerKey : statConfig.teamKey;
  const isMoneyline = mode === 'team' && statConfig.id === 'moneyline';
  const selectedTeamId = selectedTeam?.id ?? null;
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;

  const baseChartRows = useMemo(() => {
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
        const opponentLabel = isHome
          ? String(match?.awayLabel || match?.awayTeam?.name || 'Opponent')
          : String(match?.homeLabel || match?.homeTeam?.name || 'Opponent');
        const teamLabel = isHome
          ? String(match?.homeLabel || match?.homeTeam?.name || selectedTeam?.name || 'Team')
          : String(match?.awayLabel || match?.awayTeam?.name || selectedTeam?.name || 'Team');
        const opponentCountryCode = resolveWorldCupOpponentCountryCode(match, isHome, opponentLabel, countryLookup);
        const teamScore = isHome ? match?.homeScore : match?.awayScore;
        const opponentScore = isHome ? match?.awayScore : match?.homeScore;
        const scoreline = teamScore != null && opponentScore != null ? `${teamScore}-${opponentScore}` : '';
        const penaltyShootout =
          teamScore != null && opponentScore != null && teamScore === opponentScore
            ? resolveWorldCupPenaltyShootout(match, isHome, teamLabel, opponentLabel)
            : null;
        // Win/Draw/Loss outcome from the selected team's perspective.
        const outcome: 'W' | 'D' | 'L' | null =
          teamScore == null || opponentScore == null
            ? null
            : teamScore > opponentScore
              ? 'W'
              : teamScore < opponentScore
                ? 'L'
                : 'D';
        // Resolve the value for the active perspective. `team` reads the base
        // key; `opponent` reads the match-mate's `opp_<key>`; `all` sums both
        // (match total). Missing values fall back to the base key's zero-default.
        // Money Line is special: value is the W/D/L outcome (+1/0/-1).
        const value = (() => {
          if (isMoneyline) return outcome == null ? null : outcome === 'W' ? 1 : outcome === 'L' ? -1 : 0;
          if (!statKey) return null;
          const readKey = (key: string): number | null => {
            const parsed = toNumber(row[key]);
            if (parsed != null) return parsed;
            return ZERO_DEFAULT_STAT_KEYS.has(statKey) ? 0 : null;
          };
          if (mode === 'team' && perspective === 'opponent') return readKey(`opp_${statKey}`);
          if (
            mode === 'team' &&
            perspective === 'all' &&
            !WORLD_CUP_NO_ALL_PERSPECTIVE_STAT_KEYS.has(statKey)
          ) {
            const own = readKey(statKey);
            const opp = readKey(`opp_${statKey}`);
            if (own == null && opp == null) return null;
            return (own ?? 0) + (opp ?? 0);
          }
          return readKey(statKey);
        })();
        const competitionTag = deriveWorldCupCompetitionTag(row, match);
        const opponentTeamId = isHome ? awayId : homeId;
        const opponentLogoUrl =
          (competitionTag === 'Club'
            ? resolveWorldCupClubLogoUrl(opponentTeamId, match?.source)
            : null) ?? resolveBestWorldCupFlagUrl(opponentLabel, opponentCountryCode);
        return {
          key: matchId || `${row.player_id ?? row.team_id}-${row.team_id ?? 'row'}`,
          xKey: matchId || `${row.player_id ?? row.team_id}-${row.team_id ?? 'row'}`,
          tickLabel: getTeamAbbreviationFromLabel(opponentLabel),
          tickDateLabel: getWorldCupTickDateLabel(match?.datetime),
          competitionTag,
          opponentCountryCode,
          opponentLogoUrl,
          opponent: opponentLabel,
          value,
          outcome,
          penaltyShootout,
          stageBucket: deriveWorldCupStageBucket(readWorldCupMatchStage(match)),
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

    return rows;
  }, [data, mode, selectedPlayerId, selectedTeamId, selectedTeam?.name, statKey, perspective, isMoneyline]);

  // Competitions present in the current selection, with game counts, for the
  // competition filter dropdown (e.g. "WC 8", "Euros 5", plus "All").
  const chartCompetitions = useMemo(() => {
    const counts = new Map<WorldCupCompetitionTag, number>();
    for (const row of baseChartRows) {
      const tag = row.competitionTag as WorldCupCompetitionTag | undefined;
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return WORLD_CUP_COMPETITION_TAG_ORDER.filter((tag) => counts.has(tag)).map((tag) => ({
      tag,
      count: counts.get(tag) ?? 0,
    }));
  }, [baseChartRows]);

  // Rows after the competition filter (drives the stage filter's options/counts
  // so stages reflect the chosen competition).
  const competitionFilteredRows = useMemo(
    () =>
      competitionFilter === 'all'
        ? baseChartRows
        : baseChartRows.filter((row) => row.competitionTag === competitionFilter),
    [baseChartRows, competitionFilter]
  );

  // Tournament stages present in the current selection, with game counts.
  const chartStages = useMemo(() => {
    const counts = new Map<WorldCupStageBucket, number>();
    for (const row of competitionFilteredRows) {
      const bucket = row.stageBucket as WorldCupStageBucket | null;
      if (!bucket) continue;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return WORLD_CUP_STAGE_ORDER.filter((entry) => counts.has(entry.id)).map((entry) => ({
      ...entry,
      count: counts.get(entry.id) ?? 0,
    }));
  }, [competitionFilteredRows]);

  const chartRows = useMemo(() => {
    let rows = competitionFilteredRows;
    if (stageFilter !== 'all') {
      rows = rows.filter((row) => row.stageBucket === stageFilter);
    }

    if (timeframe === 'h2h') {
      const opponentName = opponentTeam?.name?.trim().toLowerCase();
      const opponentAbbr = opponentTeam?.abbreviation?.trim().toUpperCase();
      const opponentCode = opponentTeam?.countryCode?.trim().toLowerCase();
      return rows.filter((row) => {
        const rowOpponentName = row.opponent?.trim().toLowerCase();
        const rowAbbr = row.tickLabel?.trim().toUpperCase();
        const rowCode = row.opponentCountryCode?.trim().toLowerCase();
        if (opponentName && rowOpponentName === opponentName) return true;
        if (opponentAbbr && rowAbbr === opponentAbbr) return true;
        if (opponentCode && rowCode === opponentCode) return true;
        return false;
      });
    }

    const frame = WORLD_CUP_TIMEFRAMES.find((option) => option.id === timeframe) ?? WORLD_CUP_TIMEFRAMES[1];
    return rows.slice(-frame.count);
  }, [competitionFilteredRows, stageFilter, timeframe, opponentTeam]);

  const values = useMemo(
    () => chartRows.map((row) => row.value).filter((value): value is number => value != null),
    [chartRows]
  );
  // Reference line defaults to 0.5 for every stat until the user moves it
  // (there are no bookie odds for these historical international matches). For
  // Money Line, +0.5 grades wins; 0 draws; -0.5 losses.
  const lineValue = manualLineValue ?? 0.5;
  const moneylineTarget = lineValue >= 0.5 ? 'Win' : lineValue <= -0.5 ? 'Loss' : 'Draw';
  // Hit rate for the selected outcome over the games currently shown (reflects
  // the active timeframe, since chartRows is already sliced to it).
  const moneylineSummary = useMemo(() => {
    if (!isMoneyline) return null;
    const totalGames = chartRows.length;
    if (!totalGames) return null;
    const targetOutcome = moneylineTarget === 'Win' ? 'W' : moneylineTarget === 'Loss' ? 'L' : 'D';
    const count = chartRows.reduce((sum, row) => sum + (row.outcome === targetOutcome ? 1 : 0), 0);
    const hitRate = Math.round((count / totalGames) * 100);
    return { count, totalGames, hitRate };
  }, [isMoneyline, chartRows, moneylineTarget]);
  const tightYAxis =
    statConfig.id === 'goals' ||
    statConfig.id === 'assists' ||
    statConfig.id === 'total_shots' ||
    statConfig.id === 'shots_on_target';
  const yAxisConfig = useMemo(
    () =>
      isMoneyline
        ? { domain: [-1, 1] as [number, number], ticks: [-1, 0, 1] }
        : buildWorldCupMainYAxis(values, { tight: tightYAxis }),
    [isMoneyline, values, tightYAxis]
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
    const preferredId: WorldCupChartStatId = isGoalkeeper ? 'goalkeeper_saves' : 'passes';
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
      if (!(event.target instanceof Node)) return;
      const tf = timeframeDropdownRef.current;
      if (tf && !tf.contains(event.target)) setIsTimeframeDropdownOpen(false);
      const comp = competitionDropdownRef.current;
      if (comp && !comp.contains(event.target)) setIsCompetitionDropdownOpen(false);
      const stage = stageDropdownRef.current;
      if (stage && !stage.contains(event.target)) setIsStageDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Reset the competition filter when the chosen competition is no longer in
  // the current selection (e.g. after switching team/player).
  useEffect(() => {
    if (competitionFilter === 'all') return;
    if (!chartCompetitions.some((entry) => entry.tag === competitionFilter)) {
      setCompetitionFilter('all');
    }
  }, [chartCompetitions, competitionFilter]);

  // Reset the stage filter when the chosen stage is no longer available (e.g.
  // after changing team/player or competition).
  useEffect(() => {
    if (stageFilter === 'all') return;
    if (!chartStages.some((entry) => entry.id === stageFilter)) {
      setStageFilter('all');
    }
  }, [chartStages, stageFilter]);

  // Fouls committed/suffered have no meaningful "All" view (the two sides are
  // mirror values, so the total is identical). Pin to the selected team instead.
  const noAllPerspective = Boolean(statKey && WORLD_CUP_NO_ALL_PERSPECTIVE_STAT_KEYS.has(statKey));
  useEffect(() => {
    if (noAllPerspective && perspective === 'all') {
      setPerspective('team');
    }
  }, [noAllPerspective, perspective]);

  const customTooltip = useCallback(
    (props: any) => <WorldCupChartTooltip {...props} isDark={isDark} statLabel={statConfig.label} isMoneyline={isMoneyline} />,
    [isDark, statConfig.label, isMoneyline]
  );

  const customXAxisTick = useMemo(
    () => <WorldCupXAxisTick data={chartRows} isDark={isDark} hideTickDetails={timeframe === 'all'} />,
    [chartRows, isDark, timeframe]
  );

  if (loading && !data) {
    return <WorldCupChartSkeleton isDark={isDark} />;
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
          {isMoneyline ? (
            <>
              <input
                id="world-cup-betting-line-input"
                type="number"
                step={0.5}
                min={-0.5}
                max={0.5}
                value={lineValue}
                onChange={(event) => {
                  const raw = Number(event.target.value);
                  if (!Number.isFinite(raw)) return;
                  // Snap to the three valid reference lines: loss / draw / win.
                  const snapped = raw <= -0.25 ? -0.5 : raw >= 0.25 ? 0.5 : 0;
                  setManualLineValue(snapped);
                }}
                className="w-20 sm:w-20 md:w-22 px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                aria-label="Set Money Line reference (-0.5 loss, 0 draw, 0.5 win)"
              />
              <span
                className={`text-xs font-semibold ${
                  moneylineTarget === 'Win'
                    ? 'text-green-600 dark:text-green-400'
                    : moneylineTarget === 'Loss'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-300'
                }`}
              >
                {moneylineTarget}
              </span>
            </>
          ) : (
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
          )}
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
          {mode === 'team' && !isMoneyline ? (
            <div className="inline-flex items-center rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] p-0.5 h-[32px]">
              {WORLD_CUP_STAT_PERSPECTIVES.filter(
                (option) => !(option.id === 'all' && noAllPerspective)
              ).map((option) => {
                // The selected team is fixed (e.g. "Portugal"); the opponent
                // changes each match, so it always reads "Opponent".
                const buttonLabel =
                  option.id === 'team' ? selectedTeam?.name ?? option.label : option.label;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPerspective(option.id)}
                    className={`px-2 sm:px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                      perspective === option.id
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    aria-pressed={perspective === option.id}
                    aria-label={`Show ${buttonLabel.toLowerCase()} ${statConfig.label.toLowerCase()}`}
                  >
                    {buttonLabel}
                  </button>
                );
              })}
            </div>
          ) : null}
          {chartCompetitions.length > 1 ? (
            <div className="relative ml-auto" ref={competitionDropdownRef}>
              <button
                type="button"
                onClick={() => setIsCompetitionDropdownOpen((prev) => !prev)}
                className="min-w-[108px] px-2.5 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-600"
                aria-label="Filter games by competition"
              >
                <span className="truncate">
                  {competitionFilter === 'all'
                    ? 'Competition'
                    : `${competitionFilter} ${chartCompetitions.find((entry) => entry.tag === competitionFilter)?.count ?? ''}`}
                </span>
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isCompetitionDropdownOpen ? (
                <div className="absolute top-full right-0 mt-1 w-32 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {chartCompetitions.map((entry) => (
                    <button
                      key={entry.tag}
                      type="button"
                      onClick={() => {
                        setCompetitionFilter(entry.tag);
                        setIsCompetitionDropdownOpen(false);
                      }}
                      className={`w-full px-2 py-1.5 text-xs font-medium text-left flex items-center justify-between gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg ${
                        competitionFilter === entry.tag
                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      <span>{entry.tag}</span>
                      <span className="text-gray-500 dark:text-gray-400">{entry.count}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setCompetitionFilter('all');
                      setIsCompetitionDropdownOpen(false);
                    }}
                    className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 last:rounded-b-lg ${
                      competitionFilter === 'all'
                        ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    All
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {chartStages.length > 1 ? (
            <div className={`relative ${chartCompetitions.length > 1 ? '' : 'ml-auto'}`} ref={stageDropdownRef}>
              <button
                type="button"
                onClick={() => setIsStageDropdownOpen((prev) => !prev)}
                className="min-w-[120px] px-2.5 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-600"
                aria-label="Filter games by tournament stage"
              >
                <span className="truncate">
                  {stageFilter === 'all'
                    ? 'Stage'
                    : `${WORLD_CUP_STAGE_ORDER.find((entry) => entry.id === stageFilter)?.label ?? 'Stage'} ${
                        chartStages.find((entry) => entry.id === stageFilter)?.count ?? ''
                      }`}
                </span>
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isStageDropdownOpen ? (
                <div className="absolute top-full right-0 mt-1 w-40 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {chartStages.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setStageFilter(entry.id);
                        setIsStageDropdownOpen(false);
                      }}
                      className={`w-full px-2 py-1.5 text-xs font-medium text-left flex items-center justify-between gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg ${
                        stageFilter === entry.id
                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      <span>{entry.label}</span>
                      <span className="text-gray-500 dark:text-gray-400">{entry.count}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setStageFilter('all');
                      setIsStageDropdownOpen(false);
                    }}
                    className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 last:rounded-b-lg ${
                      stageFilter === 'all'
                        ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    All
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 relative">
        {isMoneyline && !loading && moneylineSummary ? (
          <div
            className="absolute pointer-events-none z-[1] flex items-center justify-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md sm:rounded shadow-none sm:shadow leading-none backdrop-blur-[2px] top-0 left-1/2 -translate-x-1/2"
            style={{
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.82)',
              border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.18)' : 'rgba(203, 213, 225, 0.55)'}`,
            }}
            aria-hidden
          >
            <span className={`text-[10px] sm:text-[11px] font-medium leading-none ${isDark ? 'text-slate-200 sm:text-slate-100' : 'text-slate-700 sm:text-slate-800'}`}>
              Hit: <span className="font-semibold">{moneylineSummary.hitRate}%</span>
            </span>
            <span className={`text-[9px] sm:text-[10px] ${isDark ? 'text-slate-500 sm:text-slate-400' : 'text-slate-400 sm:text-slate-500'}`}>|</span>
            <span className={`text-[10px] sm:text-[11px] font-medium leading-none ${isDark ? 'text-slate-200 sm:text-slate-100' : 'text-slate-700 sm:text-slate-800'}`}>
              <span className="font-semibold">{moneylineSummary.count}/{moneylineSummary.totalGames}</span>
            </span>
          </div>
        ) : null}
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
                  ? 'No game-by-game player stats are available for this selected player yet.'
                  : 'No game-by-game team stats are available for this selected team yet.'
            }
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, center }: { title: string; subtitle?: string; center?: boolean }) {
  return (
    <div className={`mb-3 flex items-start gap-3 px-3 sm:px-4 ${center ? 'justify-center' : 'justify-between'}`}>
      <div className={center ? 'text-center' : ''}>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p> : null}
      </div>
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
  // Full team rows (not timeframe-limited) used to detect which supporting
  // stats are symmetric across every competition the team played.
  const teamSymmetryRows = useMemo(() => {
    if (mode !== 'team' || !data) return [] as Array<Record<string, any>>;
    return data.teamMatchStats.filter((row) => !selectedTeamId || String(row.team_id ?? '') === selectedTeamId);
  }, [mode, data, selectedTeamId]);

  const supportingOptions = useMemo(() => {
    const candidates = buildWorldCupSupportingKeys(chartContext.statKey, mode);
    const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayer?.role);
    const unsupportedKeys = UNSUPPORTED_SUPPORTING_KEYS_BY_COMPETITION[competition];
    // In team mode, only keep supporting stats present in EVERY competition the
    // team played (mirrors the main chart's symmetric pills).
    const symmetricKeys =
      mode === 'team' && teamSymmetryRows.length
        ? getSymmetricTeamStatKeys(candidates, teamSymmetryRows)
        : null;
    // Game Props: stats that are near-duplicates of each other. Selecting one in
    // the main chart hides its siblings from the supporting row so we never show
    // e.g. "Passes" (accurate) next to "Total Passes" with a different number.
    const TEAM_STAT_SIBLINGS: Record<string, string[]> = {
      passes_accurate: ['passes_total'],
    };
    const mainSiblings =
      mode === 'team' && chartContext.statKey ? TEAM_STAT_SIBLINGS[chartContext.statKey] ?? [] : [];

    const filtered = candidates.filter((key, index, arr) => {
      if (arr.indexOf(key) !== index) return false;
      // Globally hidden supporting stats (both modes).
      if (WORLD_CUP_HIDDEN_SUPPORTING_KEYS.has(key)) return false;
      // Game Props: never echo the stat already shown in the main chart, nor a
      // near-duplicate sibling of it.
      if (mode === 'team' && key === chartContext.statKey) return false;
      if (mode === 'team' && mainSiblings.includes(key)) return false;
      if (mode === 'player') {
        if (WORLD_CUP_PLAYER_HIDDEN_SUPPORTING_KEYS.has(key)) return false;
        if (WORLD_CUP_GOALKEEPER_ONLY_PLAYER_KEYS.has(key) && !isGoalkeeper) return false;
        if (isGoalkeeper && WORLD_CUP_OUTFIELD_ONLY_PLAYER_KEYS.has(key)) return false;
      }
      if (unsupportedKeys.has(key)) return false;
      if (symmetricKeys && !symmetricKeys.has(key)) return false;
      return true;
    });
    return filtered;
  }, [chartContext.statKey, mode, selectedPlayer?.role, competition, teamSymmetryRows]);

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
      const competitionTag = deriveWorldCupCompetitionTag(row, match);
      const opponentTeamId = isHome
        ? String(match?.awayTeam?.id ?? '')
        : String(match?.homeTeam?.id ?? '');
      const opponentLogoUrl =
        (competitionTag === 'Club'
          ? resolveWorldCupClubLogoUrl(opponentTeamId, match?.source)
          : null) ?? resolveBestWorldCupFlagUrl(opponentLabel, opponentCountryCode);
      return {
        key: String(row.match_id),
        xKey: String(row.match_id),
        tickLabel: getTeamAbbreviationFromLabel(opponentLabel),
        tickDateLabel: getWorldCupTickDateLabel(match?.datetime),
        opponent: opponentLabel,
        opponentCountryCode,
        opponentLogoUrl,
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
  season?: number;
  position: WorldCupDvpPosition;
  opponents: string[];
  metrics: Record<string, WorldCupDvpMetricEntry>;
  samples: Record<string, number>;
  teamGames: Record<string, number>;
  totalGames?: Record<string, number>;
  names?: Record<string, string>;
  message?: string;
  /** Position-agnostic set of teams that have played ≥1 WC 2026 game (wcOnly mode only). */
  wcTeamsWithGames?: string[];
};

type WorldCupOppBreakdownResponse = {
  window: number;
  generatedAt?: string;
  // Keyed by FIFA country slug so a nation's games from every source/competition
  // collapse into one ranking. names maps slug -> display name.
  names: Record<string, string>;
  // slug -> games used for this window / total games available for the nation.
  games?: Record<string, number>;
  totalGames?: Record<string, number>;
  /** Teams included in the opponent rank denominator for this panel. */
  rankingTotal?: number;
  // Defense: opponent allowed averages + ranks (lowest allowed = rank 1).
  metrics: Record<string, WorldCupDvpMetricEntry>;
  // Attack: the nation's own per-game averages + ranks (most = rank 1).
  forMetrics?: Record<string, WorldCupDvpMetricEntry>;
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
  const playerPosition = useMemo<WorldCupDvpPosition>(
    () => getWorldCupPlayerGroup(selectedPlayer),
    [selectedPlayer]
  );
  const [posSel, setPosSel] = useState<WorldCupDvpPosition>(playerPosition);
  const [oppSel, setOppSel] = useState<string>(opponentTeam?.id ?? '');
  const [posOpen, setPosOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
  const [windowN, setWindowN] = useState<number>(WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW);
  const [wcOnly, setWcOnly] = useState(false);
  const [dvpData, setDvpData] = useState<WorldCupDvpResponse | null>(null);
  const [dvpLoading, setDvpLoading] = useState(false);
  const [dvpError, setDvpError] = useState<string | null>(null);

  // Goalkeepers use a keeper-specific stat set; everyone else uses the outfield set.
  const dvpMetrics: ReadonlyArray<{ key: string; label: string }> =
    posSel === 'GK' ? WORLD_CUP_DVP_GK_METRICS : WORLD_CUP_DVP_METRICS;

  useEffect(() => {
    setPosSel(playerPosition);
  }, [playerPosition]);

  useEffect(() => {
    setOppSel(opponentTeam?.id ?? '');
  }, [opponentTeam?.id]);

  useEffect(() => {
    let cancelled = false;
    setDvpLoading(true);
    setDvpError(null);
    const statKeys = dvpMetrics.map((m) => m.key).join(',');
    const url = `/api/world-cup/dashboard?dvpBatch=1&competition=${encodeURIComponent(competition)}&position=${posSel}&window=${windowN}&stats=${encodeURIComponent(statKeys)}${wcOnly ? '&wcOnly=1' : ''}`;
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
  }, [posSel, competition, windowN, wcOnly]);

  const opponentForLabel = useMemo(
    () => teamOptions.find((team) => team.id === oppSel) || opponentTeam,
    [oppSel, teamOptions, opponentTeam]
  );
  const posLabel = WORLD_CUP_DVP_POSITIONS.find((p) => p.id === posSel)?.label ?? posSel;
  const opponentLogoUrl = resolveBestWorldCupFlagUrl(
    opponentForLabel?.name,
    opponentForLabel?.countryCode,
    opponentForLabel?.abbreviation
  );

  const totalOpponents = dvpData?.opponents.length ?? 0;
  const opponentName = opponentForLabel?.name ?? '';
  // DVP data is keyed by FIFA slug (unifying a nation across all sources), so we
  // resolve the selected opponent's slug — matching the Opponent Breakdown.
  const opponentSlug =
    resolveWorldCupFlagCode(opponentForLabel?.countryCode) ||
    resolveWorldCupFlagCode(opponentForLabel?.abbreviation) ||
    resolveWorldCupFlagCode(opponentForLabel?.name) ||
    (opponentName ? opponentName.trim().toLowerCase() : '');
  const sampleSize = opponentSlug ? dvpData?.samples[opponentSlug] ?? 0 : 0;
  const opponentGames = opponentSlug ? dvpData?.teamGames[opponentSlug] ?? 0 : 0;
  const opponentTotalGames = opponentSlug ? dvpData?.totalGames?.[opponentSlug] ?? 0 : 0;

  // If the active fixed window exceeds the opponent's available games, snap to All.
  useEffect(() => {
    if (
      windowN !== WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW &&
      opponentTotalGames > 0 &&
      opponentTotalGames < windowN
    ) {
      setWindowN(WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW);
    }
  }, [opponentTotalGames, windowN]);

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWcOnly((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold border transition-colors ${
              wcOnly
                ? 'bg-amber-500 border-amber-500 text-white'
                : isDark
                  ? 'border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-400'
                  : 'border-gray-300 text-gray-500 hover:text-gray-700 hover:border-gray-400'
            }`}
          >
            🏆 WC 2026
          </button>
        <div className={`flex rounded-lg border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
          {WORLD_CUP_OPP_BREAKDOWN_WINDOWS.map((option) => {
            const isAllOption = option.id === WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW;
            const disabled = !isAllOption && opponentTotalGames > 0 && opponentTotalGames < option.id;
            const active = windowN === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                title={disabled ? `Only ${opponentTotalGames} games available` : undefined}
                onClick={() => setWindowN(option.id)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-purple-600 text-white'
                    : disabled
                      ? isDark
                        ? 'bg-[#0a1929] text-gray-700 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                      : isDark
                        ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                        : 'bg-gray-100 text-gray-600 hover:text-gray-900'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
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
          {dvpError ? (
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
          ) : wcOnly && opponentSlug && !dvpLoading && dvpData && dvpData.wcTeamsWithGames && !dvpData.wcTeamsWithGames.includes(opponentSlug) ? (
            <div className={`mx-3 my-3 rounded-lg border-2 border-dashed px-3 py-6 text-center text-sm ${
              isDark ? 'border-amber-800 text-amber-300' : 'border-amber-300 text-amber-700'
            }`}>
              🏆 <span className="font-semibold">{opponentName}</span> has not yet played in the 2026 World Cup.
              <br />
              <span className="text-xs opacity-75">Disable the WC 2026 filter to see all-time DVP stats.</span>
            </div>
          ) : wcOnly && !dvpLoading && dvpData && (dvpData.wcTeamsWithGames?.length ?? 0) === 0 ? (
            <div className={`mx-3 my-3 rounded-lg border-2 border-dashed px-3 py-6 text-center text-sm ${
              isDark ? 'border-amber-800 text-amber-300' : 'border-amber-300 text-amber-700'
            }`}>
              🏆 No teams have played in the 2026 World Cup yet.
              <br />
              <span className="text-xs opacity-75">Check back once the tournament begins.</span>
            </div>
          ) : (
            <>
              {dvpMetrics.map((metric) => {
                const entry = dvpData?.metrics[metric.key];
                const value = opponentSlug ? entry?.values[opponentSlug] : undefined;
                const rank = (opponentSlug ? entry?.ranks[opponentSlug] : null) ?? null;
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================
// Opponent Breakdown — mirrors the AFL dashboard's AflOpponentBreakdownCard:
// the opponent's "allowed averages" per stat, each with a defensive rank badge
// (red = hardest / allows least, green = easiest / allows most) and a legend.
// Powered by the DVP batch endpoint, summed across DEF/MID/ATT so the figures
// are whole-team allowed-per-game rather than per-position.
// =====================
function WorldCupOpponentBreakdownCard({
  isDark,
  opponentTeam,
}: {
  isDark: boolean;
  opponentTeam: WorldCupTeamOption | null;
}) {
  const [windowN, setWindowN] = useState<number>(WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW);
  const [wcOnly, setWcOnly] = useState(false);

  const [breakdown, setBreakdown] = useState<WorldCupOppBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Full 1–48 league-table view: toggled by a button; ranks every nation for a
  // single chosen stat instead of showing every stat for one opponent.
  const [showAllRankings, setShowAllRankings] = useState(false);
  const [rankingStat, setRankingStat] = useState<string>(WORLD_CUP_OPP_BREAKDOWN_METRICS[0].key);
  // Portal target: the modal must mount on document.body so a transformed/clipped
  // ancestor (the narrow sidebar card) doesn't trap the fixed overlay.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = wcOnly
      ? `/api/world-cup/dashboard?oppBreakdown=1&wcOnly=1`
      : `/api/world-cup/dashboard?oppBreakdown=1&window=${windowN}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
        }
        return res.json() as Promise<WorldCupOppBreakdownResponse>;
      })
      .then((payload) => {
        if (!cancelled) setBreakdown(payload);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setBreakdown(null);
        setError(err.message || 'Failed to load opponent breakdown');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowN, wcOnly]);

  const opponentForLabel = opponentTeam;
  const opponentName = opponentForLabel?.name ?? '';
  const opponentSlug =
    resolveWorldCupFlagCode(opponentForLabel?.countryCode) ||
    resolveWorldCupFlagCode(opponentForLabel?.abbreviation) ||
    resolveWorldCupFlagCode(opponentForLabel?.name) ||
    '';

  const totalOpponents = breakdown ? Object.keys(breakdown.names).length : 0;

  // Per-team sample size. totalGames is the same across windows (full count),
  // games is how many were used for the active window.
  const opponentTotalGames = opponentSlug ? breakdown?.totalGames?.[opponentSlug] ?? 0 : 0;
  const opponentGamesUsed = opponentSlug ? breakdown?.games?.[opponentSlug] ?? 0 : 0;
  const isAllWindow = windowN === WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW;
  // Flag thin samples so the user knows a "0.0 allowed" is over very few games.
  const SMALL_SAMPLE = 5;
  const lowSample = opponentGamesUsed > 0 && opponentGamesUsed < SMALL_SAMPLE;

  // If the active fixed window is larger than the opponent's available games,
  // snap to "All" (those buttons are also disabled below).
  useEffect(() => {
    if (!isAllWindow && opponentTotalGames > 0 && opponentTotalGames < windowN) {
      setWindowN(WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW);
    }
  }, [isAllWindow, opponentTotalGames, windowN]);

  const formatValue = (value: number | undefined, _statKey: string) => {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toFixed(2);
  };

  const noData = Boolean(breakdown) && totalOpponents === 0;

  // Full league-table list for the selected ranking stat: every ranked nation,
  // ordered #1 (hardest / allows least) → #N (easiest / allows most).
  const rankingList = useMemo(() => {
    const entry = breakdown?.metrics[rankingStat];
    if (!entry || !breakdown) return [] as Array<{
      slug: string;
      name: string;
      value: number;
      rank: number | null;
      games: number;
    }>;
    return Object.entries(entry.values)
      .map(([slug, value]) => ({
        slug,
        name: breakdown.names[slug] ?? slug,
        value,
        rank: entry.ranks[slug] ?? null,
        games: breakdown.games?.[slug] ?? 0,
      }))
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  }, [breakdown, rankingStat]);

  const rankingStatLabel =
    WORLD_CUP_OPP_BREAKDOWN_METRICS.find((m) => m.key === rankingStat)?.label ?? rankingStat;

  return (
    <div className="w-full min-w-0 h-full flex flex-col px-1.5 py-1">
      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWcOnly((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold border transition-colors ${
              wcOnly
                ? 'bg-amber-500 border-amber-500 text-white'
                : isDark
                  ? 'border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-400'
                  : 'border-gray-300 text-gray-500 hover:text-gray-700 hover:border-gray-400'
            }`}
          >
            🏆 WC 2026
          </button>
        {!wcOnly && <div className={`flex rounded-lg border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
          {WORLD_CUP_OPP_BREAKDOWN_WINDOWS.map((option) => {
            const isAllOption = option.id === WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW;
            // Disable a fixed window when the selected opponent hasn't played
            // enough games to fill it (e.g. L10 for a 3-game nation).
            const disabled =
              !isAllOption && opponentTotalGames > 0 && opponentTotalGames < option.id;
            const active = windowN === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                title={disabled ? `Only ${opponentTotalGames} games available` : undefined}
                onClick={() => setWindowN(option.id)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-purple-600 text-white'
                    : disabled
                      ? isDark
                        ? 'bg-[#0a1929] text-gray-700 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                      : isDark
                        ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                        : 'bg-gray-100 text-gray-600 hover:text-gray-900'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowAllRankings(true)}
        className={`w-full mb-2 flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
          isDark
            ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600'
            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
        }`}
      >
        View full 1–48 rankings
      </button>

      <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse flex-shrink-0`} />
            <h4 className={`text-sm font-mono font-bold uppercase tracking-wider truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {opponentName || 'TBD'} allowed averages
            </h4>
          </div>
          {opponentName && opponentGamesUsed > 0 ? (
            <span
              title={
                isAllWindow
                  ? `Averaged over all ${opponentGamesUsed} games`
                  : `Averaged over ${opponentGamesUsed} of last ${windowN} games`
              }
              className={`flex-shrink-0 inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${
                lowSample
                  ? isDark
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-amber-100 text-amber-700'
                  : isDark
                    ? 'bg-gray-700 text-gray-300'
                    : 'bg-gray-200 text-gray-600'
              }`}
            >
              {wcOnly
                ? `${opponentGamesUsed} WC game${opponentGamesUsed === 1 ? '' : 's'}`
                : isAllWindow
                  ? `${opponentGamesUsed} game${opponentGamesUsed === 1 ? '' : 's'}`
                  : `Last ${opponentGamesUsed} game${opponentGamesUsed === 1 ? '' : 's'}`}
            </span>
          ) : null}
        </div>

        {loading && !breakdown ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>
        ) : error ? (
          <div className="text-sm text-amber-600 dark:text-amber-400 py-4">{error}</div>
        ) : !opponentName ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Pick an opponent team to view their allowed averages.
          </div>
        ) : wcOnly && opponentSlug && !loading && breakdown && !breakdown.games?.[opponentSlug] ? (
          <div className={`rounded-lg border-2 border-dashed px-3 py-5 text-center text-sm ${
            isDark ? 'border-amber-800 text-amber-300' : 'border-amber-300 text-amber-700'
          }`}>
            🏆 <span className="font-semibold">{opponentName}</span> has not played in the 2026 World Cup yet.
            <br />
            <span className="text-xs opacity-75">Disable the WC 2026 filter to see all-time stats.</span>
          </div>
        ) : noData ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            No completed matches yet — opponent averages will populate once games are played.
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 custom-scrollbar">
              {WORLD_CUP_OPP_BREAKDOWN_METRICS.map((metric) => {
                const entry = breakdown?.metrics[metric.key];
                const value = opponentSlug ? entry?.values[opponentSlug] : undefined;
                const rank = (opponentSlug ? entry?.ranks[opponentSlug] : null) ?? null;
                const styles = getWorldCupDvpRankStyles(rank, totalOpponents, isDark);
                return (
                  <div
                    key={metric.key}
                    className={`flex items-center justify-between rounded border px-3 py-2 ${
                      isDark ? 'border-gray-600/60' : 'border-gray-200/80'
                    }`}
                  >
                    <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      {metric.label} Allowed
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`text-base font-bold font-mono ${isDark ? 'text-white' : 'text-black'}`}>
                        {loading ? '…' : formatValue(value, metric.key)}
                      </span>
                      <span
                        className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-xs font-bold ${styles.badgeColor}`}
                      >
                        {rank && totalOpponents > 0 ? `#${rank}` : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={`flex items-center justify-center gap-4 mt-2 pt-2 flex-shrink-0 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-red-600 dark:bg-red-500" aria-hidden />
                Hardest
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-green-600 dark:bg-green-500" aria-hidden />
                Easiest
              </span>
            </div>
          </>
        )}
      </div>

      {showAllRankings && mounted
        ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setShowAllRankings(false)}
          />
          <div
            className={`relative z-10 w-full max-w-md max-h-[85vh] flex flex-col rounded-xl border shadow-2xl ${
              isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'
            }`}
          >
            <div className={`flex items-center justify-between gap-2 px-4 py-3 border-b flex-shrink-0 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {rankingStatLabel} Allowed — Full Rankings
              </h3>
              <button
                type="button"
                onClick={() => setShowAllRankings(false)}
                className={`flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                  isDark ? 'text-gray-400 hover:bg-gray-700 hover:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className={`flex flex-wrap gap-1 px-4 py-2 border-b flex-shrink-0 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              {WORLD_CUP_OPP_BREAKDOWN_METRICS.map((metric) => {
                const active = metric.key === rankingStat;
                return (
                  <button
                    key={metric.key}
                    type="button"
                    onClick={() => setRankingStat(metric.key)}
                    className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-purple-600 text-white'
                        : isDark
                          ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {metric.label}
                  </button>
                );
              })}
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-1 custom-scrollbar"
              onWheel={(event) => event.stopPropagation()}
            >
              {rankingList.length === 0 ? (
                <div className={`text-sm py-4 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  No ranking data available yet.
                </div>
              ) : (
                rankingList.map((row) => {
                  const styles = getWorldCupDvpRankStyles(row.rank, totalOpponents, isDark);
                  const isSelected = Boolean(opponentSlug) && row.slug === opponentSlug;
                  const flagUrl = getWorldCupFlagUrl(row.slug);
                  return (
                    <div
                      key={row.slug}
                      className={`flex items-center gap-2 rounded border px-2 py-1.5 ${
                        isSelected
                          ? 'border-purple-500 bg-purple-500/10'
                          : isDark
                            ? 'border-gray-600/60'
                            : 'border-gray-200/80'
                      }`}
                    >
                      <span
                        className={`inline-flex w-9 flex-shrink-0 items-center justify-center px-1.5 py-1 rounded text-xs font-bold ${styles.badgeColor}`}
                      >
                        {row.rank && totalOpponents > 0 ? `#${row.rank}` : '—'}
                      </span>
                      {flagUrl ? (
                        <img src={flagUrl} alt={row.name} className="w-5 h-5 flex-shrink-0 object-contain" />
                      ) : null}
                      <span className={`flex-1 min-w-0 truncate text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                        {row.name}
                      </span>
                      <span className={`flex-shrink-0 text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {row.games} {row.games === 1 ? 'gm' : 'gms'}
                      </span>
                      <span className={`flex-shrink-0 w-12 text-right text-base font-bold font-mono ${isDark ? 'text-white' : 'text-black'}`}>
                        {formatValue(row.value, rankingStat)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className={`flex items-center justify-center gap-4 px-4 py-2 border-t flex-shrink-0 text-xs font-medium ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-red-600 dark:bg-red-500" aria-hidden />
                #1 Hardest
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-green-600 dark:bg-green-500" aria-hidden />
                {totalOpponents > 0 ? `#${totalOpponents} Easiest` : 'Easiest'}
              </span>
            </div>
          </div>
        </div>,
        document.body
      )
        : null}
    </div>
  );
}

// =====================
// Player vs Team — mirrors the AFL dashboard comparison table: player per-game
// averages on the left, opponent defensive allowed averages on the right, with
// squad / tournament rank badges.
// =====================

type WorldCupPlayerVsRankScope = 'team' | 'tournament';

type WorldCupPlayerPoolEntry = {
  playerKey: string;
  source: string;
  sourcePlayerId: string;
  teamSlug: string;
  position: WorldCupPositionGroup;
  games: number;
  averages: Partial<Record<string, number>>;
};

type WorldCupPvTMetric = {
  label: string;
  playerKey: string;
  poolKey: string | null;
  opponentKey: string | null;
  /** When true, lower player value = better = #1 (e.g. goals conceded) */
  lowerIsBetter?: boolean;
};

const WORLD_CUP_PLAYER_VS_TEAM_METRICS: WorldCupPvTMetric[] = [
  { label: 'Goals', playerKey: 'goals', poolKey: 'goals', opponentKey: 'goals' },
  { label: 'Total Shots', playerKey: 'derived_shots_total', poolKey: 'shots_total', opponentKey: 'shots_total' },
  { label: 'Shots on Target', playerKey: 'shots_on_target', poolKey: 'shots_on_target', opponentKey: 'shots_on_target' },
  { label: 'Fouls Committed', playerKey: 'fouls_committed', poolKey: 'fouls', opponentKey: 'fouls' },
  { label: 'Fouls Suffered', playerKey: 'was_fouled', poolKey: 'was_fouled', opponentKey: 'was_fouled' },
  { label: 'Passes', playerKey: 'passes_total', poolKey: 'passes_total', opponentKey: 'passes_total' },
  { label: 'Yellow Cards', playerKey: 'yellow_cards', poolKey: 'yellow_cards', opponentKey: 'yellow_cards' },
  { label: 'Red Cards', playerKey: 'red_cards', poolKey: 'red_cards', opponentKey: 'red_cards' },
];

const WORLD_CUP_GK_PLAYER_VS_TEAM_METRICS: WorldCupPvTMetric[] = [
  { label: 'Saves', playerKey: 'saves', poolKey: 'saves', opponentKey: null },
  { label: 'Goals Conceded', playerKey: 'goals_conceded', poolKey: 'goals_conceded', opponentKey: 'goals', lowerIsBetter: true },
  { label: 'Passes', playerKey: 'passes_total', poolKey: 'passes_total', opponentKey: 'passes_total' },
  { label: 'Yellow Cards', playerKey: 'yellow_cards', poolKey: 'yellow_cards', opponentKey: 'yellow_cards' },
];

function readPlayerVsTeamStatValue(row: Record<string, any>, playerKey: string): number | null {
  if (playerKey === 'fouls_committed') {
    return getWorldCupStatNumber(row, 'fouls_committed') ?? getWorldCupStatNumber(row, 'fouls');
  }
  if (playerKey === 'was_fouled') {
    return getWorldCupStatNumber(row, 'was_fouled') ?? getWorldCupStatNumber(row, 'fouls_suffered');
  }
  if (playerKey === 'shots_total' || playerKey === 'derived_shots_total') {
    const direct = toNumber(row.shots_total);
    const derived = toNumber(row.derived_shots_total) ?? toNumber(row.total_shots);
    if (direct != null && derived != null) return Math.max(direct, derived);
    return direct ?? derived;
  }
  if (playerKey === 'saves') {
    return getWorldCupStatNumber(row, 'saves') ?? getWorldCupStatNumber(row, 'goalkeeper_saves');
  }
  if (playerKey === 'goals_conceded') {
    return getWorldCupStatNumber(row, 'goals_conceded') ?? getWorldCupStatNumber(row, 'goals_allowed');
  }
  return getWorldCupStatNumber(row, playerKey);
}

function averagePlayerVsTeamStat(rows: Array<Record<string, any>>, playerKey: string): number | null {
  const values = rows
    .map((row) => readPlayerVsTeamStatValue(row, playerKey))
    .filter((value): value is number => value != null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPlayerVsTeamAvg(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function rankPlayerVsPoolStat(opts: {
  pool: WorldCupPlayerPoolEntry[];
  poolKey: string;
  playerAvg: number;
  scope: WorldCupPlayerVsRankScope;
  teamSlug: string;
  lowerIsBetter?: boolean;
}): { rank: number; total: number; tied: number } | null {
  const { pool, poolKey, playerAvg, scope, teamSlug, lowerIsBetter } = opts;
  if (!Number.isFinite(playerAvg)) return null;

  const eligible = pool.filter((entry) => {
    const avg = entry.averages[poolKey];
    if (typeof avg !== 'number' || !Number.isFinite(avg)) return false;
    if (scope === 'team' && entry.teamSlug !== teamSlug) return false;
    return true;
  });
  if (!eligible.length) return null;

  // Sort: descending by default (more = better = #1); ascending when lowerIsBetter (fewer = better = #1)
  const sorted = [...eligible].sort((a, b) =>
    lowerIsBetter
      ? (a.averages[poolKey] ?? 0) - (b.averages[poolKey] ?? 0)
      : (b.averages[poolKey] ?? 0) - (a.averages[poolKey] ?? 0)
  );

  for (let i = 0; i < sorted.length; ) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1]!.averages[poolKey] === sorted[i]!.averages[poolKey]) end++;
    if (sorted[i]!.averages[poolKey] === playerAvg) {
      return { rank: i + 1, total: sorted.length, tied: end - i + 1 };
    }
    i = end + 1;
  }
  return { rank: sorted.length, total: sorted.length, tied: 1 };
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0]!;
}

function pvtRankPill(
  rank: number,
  total: number,
  tied: number,
  colorMode: 'player' | 'opponent'
) {
  const ratio = rank / total;
  // player: low ratio = good = green | opponent: low ratio = tough = red
  const isGood = colorMode === 'player' ? ratio <= 0.25 : ratio >= 0.75;
  const isBad  = colorMode === 'player' ? ratio >= 0.75 : ratio <= 0.25;
  const [bg, text, ring] = isGood
    ? ['bg-emerald-500/10 dark:bg-emerald-500/15', 'text-emerald-600 dark:text-emerald-400', 'ring-emerald-500/30']
    : isBad
    ? ['bg-red-500/10 dark:bg-red-500/15', 'text-red-600 dark:text-red-400', 'ring-red-500/30']
    : ['bg-amber-500/10 dark:bg-amber-500/15', 'text-amber-600 dark:text-amber-400', 'ring-amber-500/30'];
  const isTied = tied > 1;
  const title = isTied
    ? `Tied ${rank}${ordinalSuffix(rank)} — ${tied} ${colorMode === 'player' ? 'players' : 'teams'}`
    : undefined;
  return (
    <span
      title={title}
      className={`relative inline-flex items-center rounded px-1.5 py-[3px] text-[9px] font-bold tabular-nums leading-none ring-1 ${bg} ${text} ${ring}${isTied ? ' cursor-help' : ''}`}
    >
      #{rank}
      {isTied && (
        <sup className="ml-0.5 text-[7px] font-bold leading-none -mt-1">{tied}</sup>
      )}
    </span>
  );
}

function renderWorldCupPlayerRankBadge(rank: { rank: number; total: number; tied?: number } | null) {
  if (!rank || rank.total < 1) return null;
  return pvtRankPill(rank.rank, rank.total, rank.tied ?? 1, 'player');
}

function renderWorldCupOpponentRankBadge(rank: number | null, totalOpponents: number, tied = 1) {
  if (rank == null || !Number.isFinite(rank) || totalOpponents < 1) return null;
  return pvtRankPill(rank, totalOpponents, tied, 'opponent');
}

function isCompletedWorldCupMatchStatus(status: unknown): boolean {
  const normalized = String(status ?? 'completed').toLowerCase();
  return normalized === 'completed' || normalized === 'finished' || normalized === 'ft';
}

function isWorldCupFinalsCompletedPlayerRow(
  row: Record<string, any>,
  match: Record<string, any> | undefined
): boolean {
  if (match?.status && !isCompletedWorldCupMatchStatus(match.status)) return false;
  return deriveWorldCupCompetitionTag(row, match) === 'WC';
}

function WorldCupPlayerVsTeamPanel({
  isDark,
  selectedPlayer,
  selectedPlayerId,
  selectedTeam,
  opponentTeam,
  playerMatchStats,
  matches,
  playerMatches,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  playerMatchStats: Array<Record<string, any>>;
  matches: Array<Record<string, any>>;
  playerMatches: Array<Record<string, any>>;
}) {
  const [rankScope, setRankScope] = useState<WorldCupPlayerVsRankScope>('team');
  const [breakdown, setBreakdown] = useState<WorldCupOppBreakdownResponse | null>(null);
  const [playerPool, setPlayerPool] = useState<WorldCupPlayerPoolEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchLookup = useMemo(() => {
    const allMatches = [...matches, ...playerMatches];
    return new Map(allMatches.map((match) => [String(match.id), match]));
  }, [matches, playerMatches]);

  const playerRows = useMemo(
    () =>
      !selectedPlayerId
        ? []
        : playerMatchStats
            .filter((row) => String(row.player_id ?? row.player?.id ?? '') === selectedPlayerId)
            .filter((row) => hasWorldCupPlayerAppearance(row))
            .filter((row) =>
              isWorldCupFinalsCompletedPlayerRow(row, matchLookup.get(String(row.match_id ?? '')))
            ),
    [playerMatchStats, selectedPlayerId, matchLookup]
  );

  const teamSlug = useMemo(() => resolveWorldCupTeamSlug(selectedTeam), [selectedTeam]);
  const opponentSlug = useMemo(() => resolveWorldCupTeamSlug(opponentTeam), [opponentTeam]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      playerVsPool: '1',
      scope: 'worldcup',
    });
    if (opponentTeam?.id && /^\d+$/.test(opponentTeam.id)) {
      params.set('opponentTeamId', opponentTeam.id);
      if (opponentTeam.name) params.set('opponentTeamName', opponentTeam.name);
      if (opponentTeam.countryCode) params.set('opponentCountryCode', opponentTeam.countryCode);
    }
    fetch(`/api/world-cup/dashboard?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `Player pool failed (${res.status})`);
        }
        return res.json() as Promise<{
          players?: WorldCupPlayerPoolEntry[];
          opponentBreakdown?: WorldCupOppBreakdownResponse;
        }>;
      })
      .then((poolPayload) => {
        if (cancelled) return;
        setBreakdown(poolPayload.opponentBreakdown ?? null);
        setPlayerPool(Array.isArray(poolPayload.players) ? poolPayload.players : []);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setBreakdown(null);
          setPlayerPool([]);
          setError(err.message || 'Failed to load Player vs Team data');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlayerId, teamSlug, opponentSlug, opponentTeam?.id, opponentTeam?.name, opponentTeam?.countryCode, playerMatchStats.length]);

  const totalOpponents = Math.max(
    breakdown?.rankingTotal ?? 0,
    Object.keys(breakdown?.names ?? {}).length
  ) || 48;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 px-0.5 pb-0.5 pt-0.5 xl:px-1 xl:pb-1 xl:pt-1">

      {/* ── Title + scope toggle ── */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-900 dark:text-white">Player vs Team</span>
          <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-widest text-purple-500 dark:text-purple-400">WC only</span>
        </div>
        <div className={`inline-flex rounded-full border overflow-hidden text-[10px] font-semibold ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button type="button" onClick={() => setRankScope('team')}
            className={`px-3 py-1 transition-colors ${rankScope === 'team' ? 'bg-purple-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}>
            Squad
          </button>
          <button type="button" onClick={() => setRankScope('tournament')}
            className={`px-3 py-1 transition-colors ${rankScope === 'tournament' ? 'bg-purple-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}>
            Tournament
          </button>
        </div>
      </div>

      {/* ── Player vs Opponent names ── */}
      <div className={`rounded-xl p-2.5 ${isDark ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-gray-50 border border-gray-100'}`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-gray-900 dark:text-white truncate leading-tight">
              {selectedPlayer?.name || <span className="text-gray-400 font-normal">Select player</span>}
            </div>
            <div className="text-[9px] uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-0.5">
              {playerRows.length > 0 ? `${playerRows.length} WC ${playerRows.length === 1 ? 'game' : 'games'}` : 'Player'}
            </div>
          </div>
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <div className="w-6 h-6 rounded-full bg-purple-500/10 ring-1 ring-purple-500/25 flex items-center justify-center">
              <span className="text-[7px] font-black tracking-widest text-purple-400">VS</span>
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-[12px] font-bold text-gray-900 dark:text-white truncate leading-tight">
              {opponentTeam?.name || <span className="text-gray-400 font-normal">Select opponent</span>}
            </div>
            <div className="text-[9px] uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-0.5">Opponent</div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      {error ? (
        <div className="text-sm text-red-500 dark:text-red-400 px-1">{error}</div>
      ) : !selectedPlayer || !playerRows.length ? (
        <div className="text-[11px] text-gray-400 dark:text-gray-500 px-1 py-2">
          Select a player with completed World Cup games.
        </div>
      ) : (
        <div className="min-w-0">
          {/* Column labels */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-5 mb-1.5 px-0.5">
            <span className="text-[8px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500 text-right">Avg</span>
            <span className="w-16 sm:w-20" />
            <span className="text-[8px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-500 text-left">Allowed</span>
          </div>

          {/* Stat rows — GK gets a different metric set */}
          {(() => {
            const isGK = selectedPlayer?.positionGroup === 'GK';
            const activeMetrics = isGK ? WORLD_CUP_GK_PLAYER_VS_TEAM_METRICS : WORLD_CUP_PLAYER_VS_TEAM_METRICS;
            return (
          <div className="flex flex-col gap-0">
            {activeMetrics.map((metric) => {
              const playerAvg = averagePlayerVsTeamStat(playerRows, metric.playerKey);
              const playerValue = formatPlayerVsTeamAvg(playerAvg);
              const opponentLookup = lookupWorldCupOpponentBreakdownMetric(breakdown, metric.opponentKey ?? '', opponentTeam);
              const opponentValueRaw = metric.opponentKey ? opponentLookup.value : undefined;
              const opponentValue = typeof opponentValueRaw === 'number' && Number.isFinite(opponentValueRaw)
                ? opponentValueRaw.toFixed(2) : null;
              const playerRank = playerAvg != null && metric.poolKey
                ? rankPlayerVsPoolStat({ pool: playerPool, poolKey: metric.poolKey, playerAvg, scope: rankScope, teamSlug, lowerIsBetter: metric.lowerIsBetter })
                : null;
              const opponentRank = metric.opponentKey && opponentTeam ? opponentLookup.rank ?? null : null;
              const opponentRankTied = opponentLookup.rankTied ?? 1;

              return (
                <div key={metric.label}
                  className={`grid grid-cols-[1fr_auto_1fr] items-center gap-x-5 py-1.5 border-b last:border-0 ${isDark ? 'border-white/[0.05]' : 'border-gray-100'}`}>

                  {/* Player side — right aligned */}
                  <div className="flex items-center justify-end gap-1.5 min-w-0">
                    <span className="text-[13px] font-bold tabular-nums text-gray-900 dark:text-white leading-none">
                      {loading && !playerValue ? '…' : playerValue ?? '—'}
                    </span>
                    {loading ? <span className="w-8 h-4 rounded bg-gray-200 dark:bg-white/5 animate-pulse" /> :
                      renderWorldCupPlayerRankBadge(playerRank) ?? <span className="w-8" />}
                  </div>

                  {/* Stat label — centered */}
                  <div className="flex flex-col items-center gap-0.5 w-16 sm:w-20 shrink-0">
                    <span className="text-[8px] sm:text-[9px] uppercase tracking-widest font-semibold text-gray-400 dark:text-gray-600 text-center leading-tight whitespace-nowrap">
                      {metric.label}
                    </span>
                    <div className={`w-full h-px ${isDark ? 'bg-white/[0.06]' : 'bg-gray-200'}`} />
                  </div>

                  {/* Opponent side — left aligned */}
                  <div className="flex items-center justify-start gap-1.5 min-w-0">
                    {loading ? <span className="w-8 h-4 rounded bg-gray-200 dark:bg-white/5 animate-pulse" /> :
                      renderWorldCupOpponentRankBadge(opponentRank, totalOpponents, opponentRankTied) ?? <span className="w-8" />}
                    <span className="text-[13px] font-bold tabular-nums text-gray-900 dark:text-white leading-none">
                      {loading && !opponentValue ? '…' : opponentValue ?? '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
            );
          })()}
        </div>
      )}
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

type WorldCupRecentFormGame = {
  matchId: string;
  datetime: string | null;
  competitionTag: string;
  isHome: boolean;
  goalsFor: number | null;
  goalsAgainst: number | null;
  outcome: 'W' | 'D' | 'L' | null;
  penaltyWin: boolean | null;
  opponentName: string;
  opponentCode: string | null;
  stats: Record<string, number | null>;
  statsAgainst: Record<string, number | null>;
};

type WorldCupFormPerspective = 'for' | 'against';

type WorldCupTeamFormResponse = {
  success: boolean;
  teamId: number;
  opponentId: number | null;
  teamMatches: WorldCupFormMatch[];
  opponentMatches: WorldCupFormMatch[];
  teamMatchStats: WorldCupTeamMatchStatRow[];
  teamRecent?: WorldCupRecentFormGame[];
  opponentRecent?: WorldCupRecentFormGame[];
  teamAll?: WorldCupRecentFormGame[];
  opponentAll?: WorldCupRecentFormGame[];
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

function readWorldCupStatNumber(row: WorldCupTeamMatchStatRow | undefined, key: string): number | null {
  if (!row) return null;
  const raw = row[key];
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatWorldCupFormValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
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

// Map the active competition view to a short tag for the client-side fallback
// (used for Euros / Nations League, where the API returns single-competition
// matches rather than the cross-source `teamRecent` payload).
function worldCupCompetitionTagForFallback(competition: Competition): string {
  if (competition === 'euros') return 'Euros';
  if (competition === 'nations-league') return 'NL';
  return 'WC';
}

// Fallback when the API didn't supply cross-source `teamRecent` (Euros / Nations
// League views): build a team's last 5 games from the single-competition match
// list the team-form endpoint returned.
function buildWorldCupClientRecentForm(
  matches: WorldCupFormMatch[],
  teamId: number | null,
  statsByPair: Map<string, WorldCupTeamMatchStatRow>,
  competition: Competition
): WorldCupRecentFormGame[] {
  if (teamId == null) return [];
  const teamKey = String(teamId);
  const sorted = [...matches]
    .filter((match) => String(match.homeTeam?.id) === teamKey || String(match.awayTeam?.id) === teamKey)
    .sort((a, b) => (Date.parse(b.datetime || '') || 0) - (Date.parse(a.datetime || '') || 0))
    .slice(0, 5);

  return sorted.map((match) => {
    const isHome = String(match.homeTeam?.id) === teamKey;
    const goalsFor = isHome ? match.homeScore : match.awayScore;
    const goalsAgainst = isHome ? match.awayScore : match.homeScore;
    const oppTeam = isHome ? match.awayTeam : match.homeTeam;
    const oppName = oppTeam?.name || 'Opponent';
    const row = statsByPair.get(`${match.id}:${teamId}`);
    const stats: Record<string, number | null> = {};
    const statsAgainst: Record<string, number | null> = {};
    for (const { key } of WORLD_CUP_FORM_STAT_KEYS) {
      stats[key] = key === 'goals' ? goalsFor ?? null : readWorldCupStatNumber(row, key);
      statsAgainst[key] =
        key === 'goals' ? goalsAgainst ?? null : readWorldCupStatNumber(row, `opp_${key}`);
    }
    return {
      matchId: String(match.id),
      datetime: match.datetime,
      competitionTag: worldCupCompetitionTagForFallback(competition),
      isHome,
      goalsFor: goalsFor ?? null,
      goalsAgainst: goalsAgainst ?? null,
      outcome:
        goalsFor == null || goalsAgainst == null
          ? null
          : goalsFor > goalsAgainst
            ? 'W'
            : goalsFor < goalsAgainst
              ? 'L'
              : 'D',
      penaltyWin: null,
      opponentName: oppName,
      opponentCode: resolveWorldCupFlagCode(oppName) || null,
      stats,
      statsAgainst,
    };
  });
}

function summarizeWorldCupFormRecord(games: WorldCupRecentFormGame[]): { wins: number; draws: number; losses: number } {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const game of games) {
    if (game.outcome === 'W') wins += 1;
    else if (game.outcome === 'L') losses += 1;
    else if (game.outcome === 'D') draws += 1;
  }
  return { wins, draws, losses };
}

// Per-game averages shown beneath each team's last-5 list.
const WORLD_CUP_RECENT_SUMMARY_STATS: Array<{ key: string; label: string }> = [
  { key: 'goals', label: 'Goals' },
  { key: 'shots_total', label: 'Shots' },
  { key: 'shots_on_target', label: 'SOT' },
  { key: 'corners', label: 'Corners' },
];

function averageWorldCupRecentStat(
  games: WorldCupRecentFormGame[],
  key: string,
  perspective: WorldCupFormPerspective
): number | null {
  let sum = 0;
  let count = 0;
  for (const game of games) {
    const source = perspective === 'against' ? game.statsAgainst : game.stats;
    const value = source?.[key];
    if (value != null && Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function formatWorldCupRecentStatValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(1);
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

function getWorldCupRecentOutcomeStyles(outcome: 'W' | 'D' | 'L' | null, isDark: boolean): {
  pill: string;
  score: string;
} {
  if (outcome === 'W') {
    return {
      pill: 'bg-green-600 text-white',
      score: isDark ? 'text-green-400' : 'text-green-600',
    };
  }
  if (outcome === 'L') {
    return {
      pill: 'bg-red-600 text-white',
      score: isDark ? 'text-red-400' : 'text-red-600',
    };
  }
  return {
    pill: isDark ? 'bg-slate-600 text-white' : 'bg-slate-400 text-white',
    score: isDark ? 'text-slate-300' : 'text-slate-500',
  };
}

function formatWorldCupRecentDate(datetime: string | null): string {
  if (!datetime) return '';
  const parsed = new Date(datetime);
  if (Number.isNaN(parsed.getTime())) return '';
  const day = parsed.getDate();
  const month = parsed.toLocaleString('en-US', { month: 'short' });
  const year = String(parsed.getFullYear()).slice(-2);
  return `${day} ${month} '${year}`;
}

function WorldCupRecentGameRow({ isDark, game }: { isDark: boolean; game: WorldCupRecentFormGame }) {
  const outcomeStyles = getWorldCupRecentOutcomeStyles(game.outcome, isDark);
  const flagCode = game.opponentCode || resolveWorldCupFlagCode(game.opponentName) || null;
  const flagUrl = getWorldCupFlagUrl(flagCode);
  const scoreLabel =
    game.goalsFor != null && game.goalsAgainst != null
      ? `${game.goalsFor}–${game.goalsAgainst}`
      : '—';
  const dateLabel = formatWorldCupRecentDate(game.datetime);
  const showPenalty = game.outcome === 'D' && game.penaltyWin != null;

  return (
    <div className={`flex items-center gap-1 rounded-md px-1 py-1 ${isDark ? 'hover:bg-gray-800/60' : 'hover:bg-white'}`}>
      <span
        className={`w-3.5 shrink-0 text-center text-[9px] font-bold leading-none ${
          isDark ? 'text-gray-500' : 'text-gray-400'
        }`}
        title={game.isHome ? 'Home' : 'Away'}
      >
        {game.isHome ? 'H' : 'A'}
      </span>
      {flagUrl ? (
        <img src={flagUrl} alt="" className="h-3.5 w-5 shrink-0 rounded-sm object-cover" loading="lazy" />
      ) : (
        <span className="h-3.5 w-5 shrink-0 rounded-sm bg-gray-300 dark:bg-gray-700" />
      )}
      <span className={`w-10 shrink-0 text-center text-[11px] font-semibold tabular-nums ${outcomeStyles.score}`}>
        {scoreLabel}
      </span>
      <span className={`min-w-[1.25rem] shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold leading-none ${outcomeStyles.pill}`}>
        {game.outcome ?? '—'}
        {showPenalty ? (game.penaltyWin ? ' P✓' : ' P✗') : ''}
      </span>
      <span className="min-w-0 flex-1" aria-hidden />
      <span
        className={`hidden shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold leading-none sm:inline-block ${
          isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
        }`}
      >
        {game.competitionTag}
      </span>
      <span className={`w-14 shrink-0 whitespace-nowrap text-left text-[10px] tabular-nums leading-none ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        {dateLabel}
      </span>
    </div>
  );
}

function WorldCupPlayerVsPlayerPanel({
  isDark,
  selectedPlayer,
  selectedPlayerId,
  playerMatchStats,
  matches,
  playerMatches,
  rosters,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  playerMatchStats: Array<Record<string, any>>;
  matches: Array<Record<string, any>>;
  playerMatches: Array<Record<string, any>>;
  rosters: Array<Record<string, any>>;
}) {
  const allMatches = useMemo(() => [...matches, ...playerMatches], [matches, playerMatches]);
  const matchLookup = useMemo(
    () => new Map(allMatches.map((m) => [String(m.id), m])),
    [allMatches]
  );

  const FORM_STATS: Array<{ key: string; label: string }> = [
    { key: 'minutes_played', label: 'Minutes' },
    { key: 'goals', label: 'Goals' },
    { key: 'shots_total', label: 'Total Shots' },
    { key: 'shots_on_target', label: 'Shots on Target' },
    { key: 'passes_total', label: 'Passes' },
    { key: 'tackles', label: 'Tackles' },
    { key: 'fouls', label: 'Fouls Committed' },
    { key: 'was_fouled', label: 'Fouls Suffered' },
    { key: 'dribbles_attempted', label: 'Dribbles' },
  ];

  // Total WC minutes per player id — used to sort teammates by most-played.
  const minutesByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of playerMatchStats) {
      const pid = String(row.player_id ?? '');
      if (!pid) continue;
      map.set(pid, (map.get(pid) ?? 0) + (Number(row.minutes_played) || 0));
    }
    return map;
  }, [playerMatchStats]);

  // Get teammates straight from roster by teamId — no playerMatchStats dependency.
  const teammates = useMemo(() => {
    if (!selectedPlayer) return [];
    const teamId = selectedPlayer.teamId;
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string }> = [];
    for (const row of rosters) {
      const player = row.player ?? {};
      const rawName = String(player.name ?? player.short_name ?? row.player_name ?? '').trim();
      if (!rawName) continue;
      const rowTeamId = row.team_id != null ? String(row.team_id) : null;
      if (teamId && rowTeamId && rowTeamId !== teamId) continue;
      const pid = String(player.id ?? row.player_id ?? rawName);
      if (pid === selectedPlayerId || seen.has(pid)) continue;
      seen.add(pid);
      result.push({ id: pid, name: rawName });
    }
    // Sort by most WC minutes first so the default auto-selection picks the
    // most-played teammate. Fall back to alphabetical for untouched players.
    return result.sort((a, b) => {
      const diff = (minutesByPlayer.get(b.id) ?? 0) - (minutesByPlayer.get(a.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [rosters, selectedPlayer, selectedPlayerId, minutesByPlayer]);

  const [compareId, setCompareId] = useState<string>('');
  const [compareStats, setCompareStats] = useState<Array<Record<string, any>>>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  // Auto-pick the teammate with most WC minutes when the player or roster changes.
  useEffect(() => {
    if (teammates.length > 0 && (!compareId || !teammates.find((t) => t.id === compareId))) {
      setCompareId(teammates[0].id);
    }
  }, [teammates]);

  const compareName = teammates.find((t) => t.id === compareId)?.name ?? null;

  // Fetch comparison player's stats whenever selection changes
  useEffect(() => {
    if (!compareId || !compareName) return;
    let cancelled = false;
    setCompareLoading(true);
    const params = new URLSearchParams();
    params.set('playerId', compareId);
    params.set('playerName', compareName);
    fetch(`/api/world-cup/dashboard?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setCompareStats(data?.playerMatchStats ?? []);
      })
      .catch(() => { if (!cancelled) setCompareStats([]); })
      .finally(() => { if (!cancelled) setCompareLoading(false); });
    return () => { cancelled = true; };
  }, [compareId, compareName]);

  const getL5AvgsFromRows = useCallback(
    (rows: Array<Record<string, any>>, pid: string, name: string) => {
      const norm = (n: string) =>
        n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
      const normTarget = name ? norm(name) : null;
      const pidRows = rows
        .filter((row) => {
          if (!hasWorldCupPlayerAppearance(row)) return false;
          if (String(row.player_id ?? row.player?.id ?? '') === pid) return true;
          if (!normTarget) return false;
          const rowName = String(row.player_name ?? row.player?.name ?? row.player?.short_name ?? '');
          return rowName && norm(rowName) === normTarget;
        })
        .map((row) => {
          const matchId = String(row.match_id ?? '');
          const match = matchLookup.get(matchId);
          const datetime = match?.datetime ?? match?.date ?? row.match_date ?? null;
          const stats: Record<string, number | null> = {};
          for (const s of FORM_STATS) {
            const v = toNumber(row[s.key]);
            stats[s.key] = s.key === 'shots_total' && v == null
              ? (toNumber(row.derived_shots_total) ?? toNumber(row.total_shots))
              : v;
          }
          return { datetime: datetime ? String(datetime) : null, stats };
        })
        .sort((a, b) => (b.datetime ? new Date(b.datetime).getTime() : 0) - (a.datetime ? new Date(a.datetime).getTime() : 0))
        .slice(0, 5);
      const avgs: Record<string, number | null> = {};
      for (const s of FORM_STATS) {
        const vals = pidRows.map((r) => r.stats[s.key]).filter((v): v is number => v != null);
        avgs[s.key] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }
      return { avgs, games: pidRows.length };
    },
    [matchLookup]
  );

  const p1 = useMemo(() => selectedPlayerId ? getL5AvgsFromRows(playerMatchStats, selectedPlayerId, selectedPlayer?.name ?? '') : null, [selectedPlayerId, selectedPlayer?.name, playerMatchStats, getL5AvgsFromRows]);
  const p2 = useMemo(() => compareId ? getL5AvgsFromRows(compareStats, compareId, compareName ?? '') : null, [compareId, compareName, compareStats, getL5AvgsFromRows]);

  const fmtAvg = (v: number | null, key: string) => {
    if (v == null) return '—';
    if (key === 'passes_total') return v.toFixed(1);
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  };

  const dimText = isDark ? 'text-gray-500' : 'text-gray-400';

  if (!selectedPlayer) {
    return <div className={`text-xs text-center py-6 ${dimText}`}>Select a player to compare.</div>;
  }

  return (
    <div className="flex flex-col">
      {/* Player name headers */}
      <div className={`grid grid-cols-[1fr_36px_1fr] items-center gap-1 px-2 py-2 rounded-lg mb-2 ${isDark ? 'bg-gray-800/50' : 'bg-gray-100/80'}`}>
        <div className="min-w-0">
          <p className={`text-[11px] font-bold truncate leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>{selectedPlayer.name}</p>
          <p className={`text-[9px] mt-0.5 ${dimText}`}>L{p1?.games ?? 0} avg</p>
        </div>
        <div className={`flex items-center justify-center rounded-full w-7 h-7 mx-auto text-[9px] font-black tracking-wider ${isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-300 text-gray-500'}`}>
          VS
        </div>
        <div className="min-w-0 text-right">
          {teammates.length > 0 ? (
            <select
              value={compareId}
              onChange={(e) => setCompareId(e.target.value)}
              className={`text-[11px] font-bold w-full text-right bg-transparent border-none outline-none cursor-pointer truncate leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}
            >
              {teammates.map((t) => (
                <option key={t.id} value={t.id} className={isDark ? 'bg-gray-800' : 'bg-white'}>{t.name}</option>
              ))}
            </select>
          ) : (
            <p className={`text-[11px] font-bold ${dimText}`}>No teammates</p>
          )}
          <p className={`text-[9px] mt-0.5 ${dimText}`}>{compareLoading ? 'Loading…' : `L${p2?.games ?? 0} avg`}</p>
        </div>
      </div>

      {/* Stat rows */}
      <div className={`rounded-lg overflow-hidden border ${isDark ? 'border-gray-700/50' : 'border-gray-200'}`}>
        {FORM_STATS.map((s, i) => {
          const v1 = p1?.avgs[s.key] ?? null;
          const v2 = p2?.avgs[s.key] ?? null;
          const bothValid = v1 != null && v2 != null;
          const p1Better = bothValid && v1 > v2;
          const p2Better = bothValid && v2 > v1;
          const tied = bothValid && v1 === v2;
          const neutral = isDark ? 'text-gray-300' : 'text-gray-700';
          const c1 = !bothValid ? neutral : p1Better ? 'text-emerald-400' : tied ? (isDark ? 'text-gray-400' : 'text-gray-500') : 'text-red-400/80';
          const c2 = !bothValid ? neutral : p2Better ? 'text-emerald-400' : tied ? (isDark ? 'text-gray-400' : 'text-gray-500') : 'text-red-400/80';
          const rowBg = i % 2 === 0
            ? (isDark ? 'bg-gray-800/40' : 'bg-white')
            : (isDark ? 'bg-gray-800/20' : 'bg-gray-50');
          return (
            <div key={s.key} className={`grid grid-cols-[1fr_120px_1fr] items-center px-3 py-1.5 ${rowBg}`}>
              <span className={`text-[12px] tabular-nums font-bold ${c1} ${p1Better ? 'text-[13px]' : ''}`}>
                {fmtAvg(v1, s.key)}
              </span>
              <span className={`text-[9px] font-semibold uppercase tracking-widest text-center ${dimText}`}>
                {s.label}
              </span>
              <span className={`text-[12px] tabular-nums font-bold text-right ${c2} ${p2Better ? 'text-[13px]' : ''}`}>
                {fmtAvg(v2, s.key)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorldCupRecentFormColumn({
  isDark,
  team,
  accent,
  games,
  perspective,
}: {
  isDark: boolean;
  team: WorldCupTeamOption | null;
  accent: 'blue' | 'orange';
  games: WorldCupRecentFormGame[];
  perspective: WorldCupFormPerspective;
}) {
  const record = summarizeWorldCupFormRecord(games);
  const teamName = team?.name ?? (accent === 'blue' ? 'Selected' : 'Opponent');
  const teamFlag = getWorldCupFlagUrl(team?.countryCode || team?.abbreviation);
  const accentText = accent === 'blue'
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-amber-600 dark:text-amber-400';

  return (
    <div className={`flex flex-col rounded-lg border px-2 py-2.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}>
      <div className="mb-2">
        <div className="flex items-center gap-2">
          {teamFlag ? (
            <img src={teamFlag} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" loading="lazy" />
          ) : null}
          <div className={`min-w-0 flex-1 truncate text-sm font-semibold ${accentText}`}>{teamName}</div>
          <div className="ml-auto shrink-0 text-xs font-semibold leading-none tabular-nums">
            <span className="text-green-500 dark:text-green-400">{record.wins}</span>
            <span className="text-gray-400 dark:text-gray-500">-</span>
            <span className="text-slate-500 dark:text-slate-300">{record.draws}</span>
            <span className="text-gray-400 dark:text-gray-500">-</span>
            <span className="text-red-500 dark:text-red-400">{record.losses}</span>
          </div>
        </div>
      </div>

      {games.length ? (
        <>
          <div className="flex flex-col gap-0.5">
            {games.map((game) => (
              <WorldCupRecentGameRow key={game.matchId} isDark={isDark} game={game} />
            ))}
          </div>

          <div className={`mt-2 grid grid-cols-4 gap-1 border-t pt-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            {WORLD_CUP_RECENT_SUMMARY_STATS.map((stat) => (
              <div key={stat.key} className="flex flex-col items-center text-center">
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    perspective === 'against'
                      ? isDark
                        ? 'text-red-300'
                        : 'text-red-600'
                      : isDark
                        ? 'text-white'
                        : 'text-gray-900'
                  }`}
                >
                  {formatWorldCupRecentStatValue(averageWorldCupRecentStat(games, stat.key, perspective))}
                </span>
                <span className={`text-[9px] font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={`py-3 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          No recent games available.
        </div>
      )}
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
  competition,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  data: WorldCupTeamFormResponse | null;
  loading: boolean;
  error: string | null;
  competition: Competition;
}) {
  const [perspective, setPerspective] = useState<WorldCupFormPerspective>('for');
  const statsByPair = useMemo(() => buildWorldCupStatsByPair(data?.teamMatchStats ?? []), [data?.teamMatchStats]);

  // Prefer the API's cross-source `teamRecent` (genuine last 5 across every
  // competition). Fall back to single-competition matches (Euros / Nations
  // League views) when the cross-source payload isn't present.
  const selectedGames = useMemo<WorldCupRecentFormGame[]>(() => {
    if (data?.teamRecent?.length) return data.teamRecent;
    return buildWorldCupClientRecentForm(data?.teamMatches ?? [], data?.teamId ?? null, statsByPair, competition);
  }, [data?.teamRecent, data?.teamMatches, data?.teamId, statsByPair, competition]);

  const opponentGames = useMemo<WorldCupRecentFormGame[]>(() => {
    if (!opponentTeam) return [];
    if (data?.opponentRecent?.length) return data.opponentRecent;
    return buildWorldCupClientRecentForm(data?.opponentMatches ?? [], data?.opponentId ?? null, statsByPair, competition);
  }, [opponentTeam, data?.opponentRecent, data?.opponentMatches, data?.opponentId, statsByPair, competition]);

  if (loading) {
    return (
      <div className="px-2 pb-1.5">
        <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
          {[0, 1].map((idx) => (
            <div key={idx} className={`min-h-[12rem] rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="px-2 pb-2 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (!selectedGames.length && !opponentGames.length) {
    return (
      <div className={`px-2 pb-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        No recent games available for this team yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col px-2 pb-1.5">
      <div className="mb-1.5 flex items-center justify-end gap-2">
        <div className={`inline-flex items-center rounded-lg border p-0.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
          <button
            type="button"
            onClick={() => setPerspective('for')}
            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${
              perspective === 'for'
                ? 'bg-green-600 text-white shadow-sm'
                : isDark
                  ? 'text-gray-300 hover:bg-gray-800'
                  : 'text-gray-600 hover:bg-white'
            }`}
          >
            For
          </button>
          <button
            type="button"
            onClick={() => setPerspective('against')}
            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${
              perspective === 'against'
                ? 'bg-red-600 text-white shadow-sm'
                : isDark
                  ? 'text-gray-300 hover:bg-gray-800'
                  : 'text-gray-600 hover:bg-white'
            }`}
          >
            Against
          </button>
        </div>
      </div>

      <div className="overflow-x-hidden pr-0.5">
        <div className={`grid grid-cols-1 gap-1 lg:items-start ${opponentTeam ? 'lg:grid-cols-2' : ''}`}>
          <WorldCupRecentFormColumn isDark={isDark} team={selectedTeam} accent="blue" games={selectedGames} perspective={perspective} />
          {opponentTeam ? (
            <WorldCupRecentFormColumn isDark={isDark} team={opponentTeam} accent="orange" games={opponentGames} perspective={perspective} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Compare tab: selected team's attacking output vs the opponent's attacking
// output (forward vs forward) over their combined cross-source recent games.
// Fouls suffered reads the opponent-in-each-game value (`against` perspective).
const WORLD_CUP_COMPARE_STATS: Array<{
  id: string;
  key: string;
  label: string;
  perspective: WorldCupFormPerspective;
}> = [
  { id: 'goals', key: 'goals', label: 'Goals', perspective: 'for' },
  { id: 'shots_total', key: 'shots_total', label: 'Shots', perspective: 'for' },
  { id: 'shots_on_target', key: 'shots_on_target', label: 'SOT', perspective: 'for' },
  { id: 'corners', key: 'corners', label: 'Corners', perspective: 'for' },
  { id: 'possession_pct', key: 'possession_pct', label: 'Possession', perspective: 'for' },
  { id: 'passes_accurate', key: 'passes_accurate', label: 'Passes', perspective: 'for' },
  { id: 'fouls_committed', key: 'fouls', label: 'Fouls committed', perspective: 'for' },
  { id: 'fouls_suffered', key: 'fouls', label: 'Fouls suffered', perspective: 'against' },
  { id: 'yellow_cards', key: 'yellow_cards', label: 'Yellow cards', perspective: 'for' },
  { id: 'red_cards', key: 'red_cards', label: 'Red cards', perspective: 'for' },
];

// Neutral per-team colours for the Compare bars (team identity, not better/worse).
const WORLD_CUP_TEAM_A_BAR = '#3b82f6'; // blue-500 (selected team)
const WORLD_CUP_TEAM_B_BAR = '#f59e0b'; // amber-500 (opponent)

function WorldCupCompareStatRow({
  isDark,
  label,
  teamValue,
  opponentValue,
}: {
  isDark: boolean;
  label: string;
  teamValue: number | null;
  opponentValue: number | null;
}) {
  const teamStrength = Math.max(teamValue ?? 0, 0);
  const opponentStrength = Math.max(opponentValue ?? 0, 0);
  const total = teamStrength + opponentStrength;
  const teamShare = total > 0 ? (teamStrength / total) * 100 : 50;
  const opponentShare = 100 - teamShare;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-semibold leading-none">
        <span className={isDark ? 'text-blue-400' : 'text-blue-600'}>{formatWorldCupFormValue(teamValue)}</span>
        <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{label}</span>
        <span className={isDark ? 'text-amber-400' : 'text-amber-600'}>{formatWorldCupFormValue(opponentValue)}</span>
      </div>
      <div className="relative h-3.5 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-700/60">
        <div className="absolute inset-y-0 left-0" style={{ width: `${teamShare}%`, backgroundColor: WORLD_CUP_TEAM_A_BAR }} />
        <div className="absolute inset-y-0 right-0" style={{ width: `${opponentShare}%`, backgroundColor: WORLD_CUP_TEAM_B_BAR }} />
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
  competition,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  data: WorldCupTeamFormResponse | null;
  loading: boolean;
  error: string | null;
  competition: Competition;
}) {
  const statsByPair = useMemo(() => buildWorldCupStatsByPair(data?.teamMatchStats ?? []), [data?.teamMatchStats]);

  // Compare uses the full all-time history (every ingested competition), not the last 5.
  const selectedGames = useMemo<WorldCupRecentFormGame[]>(() => {
    if (data?.teamAll?.length) return data.teamAll;
    if (data?.teamRecent?.length) return data.teamRecent;
    return buildWorldCupClientRecentForm(data?.teamMatches ?? [], data?.teamId ?? null, statsByPair, competition);
  }, [data?.teamAll, data?.teamRecent, data?.teamMatches, data?.teamId, statsByPair, competition]);

  const opponentGames = useMemo<WorldCupRecentFormGame[]>(() => {
    if (!opponentTeam) return [];
    if (data?.opponentAll?.length) return data.opponentAll;
    if (data?.opponentRecent?.length) return data.opponentRecent;
    return buildWorldCupClientRecentForm(data?.opponentMatches ?? [], data?.opponentId ?? null, statsByPair, competition);
  }, [opponentTeam, data?.opponentAll, data?.opponentRecent, data?.opponentMatches, data?.opponentId, statsByPair, competition]);

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

  const rows = WORLD_CUP_COMPARE_STATS.map((stat) => ({
    id: stat.id,
    label: stat.label,
    teamValue: averageWorldCupRecentStat(selectedGames, stat.key, stat.perspective),
    opponentValue: averageWorldCupRecentStat(opponentGames, stat.key, stat.perspective),
  })).filter((row) => row.teamValue != null || row.opponentValue != null);

  return (
    <div className="px-2 pb-1.5">
      <div className={`flex flex-col rounded-lg border px-2.5 py-2.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}>
        <div className="mb-2 flex items-center justify-between text-xs font-semibold leading-none">
          <span className="truncate text-blue-600 dark:text-blue-400">{selectedTeam?.name ?? 'Selected'}</span>
          <span className="truncate text-amber-600 dark:text-amber-400">{opponentTeam.name}</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <WorldCupCompareStatRow
              key={row.id}
              isDark={isDark}
              label={row.label}
              teamValue={row.teamValue}
              opponentValue={row.opponentValue}
            />
          ))}
        </div>
        <div className={`mt-2.5 flex items-center justify-between border-t pt-2 text-[11px] font-medium leading-none ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <span className={isDark ? 'text-blue-400' : 'text-blue-600'}>
            {selectedTeam?.name ?? 'Selected'} · {selectedGames.length} {selectedGames.length === 1 ? 'game' : 'games'}
          </span>
          <span className={isDark ? 'text-amber-400' : 'text-amber-600'}>
            {opponentTeam.name} · {opponentGames.length} {opponentGames.length === 1 ? 'game' : 'games'}
          </span>
        </div>
      </div>
    </div>
  );
}

type WorldCupRosterEntry = {
  id: string;
  name: string;
  number: string;
  position: string;
  group: 'GK' | 'DF' | 'MF' | 'FW';
  apps: number | null;
  goals: number | null;
};

const WORLD_CUP_POSITION_GROUPS: Array<{ id: WorldCupRosterEntry['group']; label: string }> = [
  { id: 'GK', label: 'Goalkeepers' },
  { id: 'DF', label: 'Defenders' },
  { id: 'MF', label: 'Midfielders' },
  { id: 'FW', label: 'Forwards' },
];

type WorldCupRosterFilter = WorldCupRosterEntry['group'];

const WORLD_CUP_ROSTER_FILTERS: Array<{ id: WorldCupRosterFilter; label: string }> = [
  { id: 'GK', label: 'GK' },
  { id: 'DF', label: 'DEF' },
  { id: 'MF', label: 'MID' },
  { id: 'FW', label: 'FWD' },
];

function classifyWorldCupRosterGroup(value: string | null | undefined): WorldCupRosterEntry['group'] {
  const raw = String(value || '').trim();
  if (!raw) return 'MF';
  const lower = raw.toLowerCase();
  if (['g', 'gk', 'goalkeeper', 'goalie', 'portero'].includes(lower) || lower.includes('keeper')) return 'GK';
  if (
    [
      'd', 'def', 'defender', 'cb', 'centre back', 'center back', 'centerback', 'centreback',
      'lb', 'left back', 'leftback', 'rb', 'right back', 'rightback',
      'wb', 'lwb', 'rwb', 'wing back', 'left wing back', 'right wing back',
    ].includes(lower) ||
    lower.includes('back') ||
    lower.includes('defen')
  ) {
    return 'DF';
  }
  if (
    [
      'm', 'mf', 'mid', 'midfielder', 'cm', 'mc', 'centre midfielder', 'center midfielder',
      'cdm', 'dm', 'defensive midfielder', 'defensive mid',
      'cam', 'am', 'attacking midfielder', 'attacking mid',
      'lm', 'left midfielder', 'rm', 'right midfielder',
    ].includes(lower) ||
    lower.includes('mid')
  ) {
    return 'MF';
  }
  if (
    [
      'f', 'fw', 'forward', 'st', 'striker', 'cf', 'centre forward', 'center forward',
      'ss', 'second striker', 'lw', 'left wing', 'leftwing', 'left winger',
      'rw', 'right wing', 'rightwing', 'right winger', 'w', 'winger',
    ].includes(lower) ||
    lower.includes('forward') ||
    lower.includes('strik') ||
    lower.includes('wing')
  ) {
    return 'FW';
  }
  return 'MF';
}

function resolveWorldCupRosterTeamId(
  rosters: Array<Record<string, any>>,
  teamId: string | null | undefined,
  excludeTeamId?: string | null
): string | null {
  if (teamId && rosters.some((row) => String(row?.team_id ?? '') === String(teamId))) {
    return String(teamId);
  }
  if (!excludeTeamId) return teamId ? String(teamId) : null;
  const otherIds = Array.from(
    new Set(
      rosters
        .map((row) => String(row?.team_id ?? ''))
        .filter((id) => id && id !== String(excludeTeamId))
    )
  );
  return otherIds.length === 1 ? otherIds[0] : null;
}

function buildWorldCupRoster(
  rosters: Array<Record<string, any>>,
  teamId: string | null | undefined,
  excludeTeamId?: string | null
): WorldCupRosterEntry[] {
  const resolvedTeamId = resolveWorldCupRosterTeamId(rosters, teamId, excludeTeamId);
  if (!resolvedTeamId || !rosters?.length) return [];
  const byId = new Map<string, WorldCupRosterEntry>();
  for (const row of rosters) {
    if (String(row?.team_id ?? '') !== resolvedTeamId) continue;
    const player = row.player ?? {};
    const name = String(player.name || player.short_name || 'Player');
    const id = String(player.id ?? name);
    const position = String(row.position || player.position || '');
    const apps = Number.isFinite(Number(row.appearances)) ? Number(row.appearances) : null;
    const goals = Number.isFinite(Number(row.goals)) ? Number(row.goals) : null;
    const entry: WorldCupRosterEntry = {
      id,
      name,
      number: String(player.jersey_number ?? row.shirt_number ?? '').trim(),
      position,
      group: classifyWorldCupRosterGroup(position),
      apps,
      goals,
    };
    const existing = byId.get(id);
    // Keep the row with the richest stats if a player appears twice.
    if (!existing || (apps ?? -1) > (existing.apps ?? -1)) byId.set(id, entry);
  }
  const groupOrder = new Map(WORLD_CUP_POSITION_GROUPS.map((g, idx) => [g.id, idx]));
  return Array.from(byId.values()).sort((a, b) => {
    const ga = groupOrder.get(a.group) ?? 99;
    const gb = groupOrder.get(b.group) ?? 99;
    if (ga !== gb) return ga - gb;
    const na = Number(a.number) || 999;
    const nb = Number(b.number) || 999;
    if (na !== nb) return na - nb;
    return a.name.localeCompare(b.name);
  });
}

function WorldCupRosterColumn({
  isDark,
  team,
  entries,
  accent,
  filter,
}: {
  isDark: boolean;
  team: WorldCupTeamOption | null;
  entries: WorldCupRosterEntry[];
  accent: 'blue' | 'amber';
  filter: WorldCupRosterFilter;
}) {
  const teamName = team?.name ?? (accent === 'blue' ? 'Selected' : 'Opponent');
  const teamFlag = getWorldCupFlagUrl(team?.countryCode || team?.abbreviation);
  const accentText = accent === 'blue'
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-amber-600 dark:text-amber-400';
  const grouped = WORLD_CUP_POSITION_GROUPS
    .filter((group) => group.id === filter)
    .map((group) => ({ ...group, players: entries.filter((entry) => entry.group === group.id) }))
    .filter((group) => group.players.length);

  return (
    <div className={`flex flex-col rounded-lg border ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}>
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        {teamFlag ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={teamFlag} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />
        ) : null}
        <span className={`truncate text-sm font-semibold ${accentText}`}>{teamName}</span>
        <span className={`ml-auto shrink-0 text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {entries.length} {entries.length === 1 ? 'player' : 'players'}
        </span>
      </div>
      {entries.length && grouped.length ? (
        <div className="flex flex-col gap-1.5 px-2 py-2">
          {grouped.map((group) => (
            <div key={group.id}>
              <div className={`px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {group.label}
              </div>
              <div className="flex flex-col">
                {group.players.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs">
                    <span className={`w-5 shrink-0 text-right tabular-nums font-semibold ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {entry.number || '–'}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{entry.name}</span>
                    <span className={`shrink-0 tabular-nums text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {entry.apps != null ? `${entry.apps} ap` : ''}
                      {entry.goals ? ` · ${entry.goals} g` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`px-3 py-6 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {entries.length ? 'No players in this position.' : 'Squad not yet announced.'}
        </div>
      )}
    </div>
  );
}

function WorldCupRosterPanel({
  isDark,
  selectedTeam,
  opponentTeam,
  rosters,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  rosters: Array<Record<string, any>>;
}) {
  const selectedEntries = useMemo(
    () => buildWorldCupRoster(rosters, selectedTeam?.id),
    [rosters, selectedTeam?.id]
  );
  const opponentEntries = useMemo(
    () => buildWorldCupRoster(rosters, opponentTeam?.id, selectedTeam?.id),
    [rosters, opponentTeam?.id, selectedTeam?.id]
  );

  const [filter, setFilter] = useState<WorldCupRosterFilter>('MF');

  if (!selectedTeam) {
    return <EmptyState text="Select a team to see the squad." />;
  }

  return (
    <div className="flex flex-col gap-3 px-3 sm:px-4">
      <div className={`inline-flex w-fit items-center gap-0.5 rounded-lg border p-0.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
        {WORLD_CUP_ROSTER_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
              filter === option.id
                ? 'bg-purple-600 text-white shadow-sm'
                : isDark
                  ? 'text-gray-300 hover:bg-gray-800'
                  : 'text-gray-600 hover:bg-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <WorldCupRosterColumn isDark={isDark} team={selectedTeam} entries={selectedEntries} accent="blue" filter={filter} />
        {opponentTeam ? (
          <WorldCupRosterColumn isDark={isDark} team={opponentTeam} entries={opponentEntries} accent="amber" filter={filter} />
        ) : (
          <div className={`flex items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center text-xs ${isDark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'}`}>
            No opponent fixture selected.
          </div>
        )}
      </div>
    </div>
  );
}

type WorldCupLineupPlayer = {
  id: string;
  name: string;
  number: string;
  position: string;
  imageUrl?: string | null;
};

type WorldCupTeamLineup = {
  formation: string | null;
  starters: WorldCupLineupPlayer[];
  substitutes: WorldCupLineupPlayer[];
};

function worldCupLineupsSubtitle(
  lineupMeta: WorldCupDashboardData['lineupMeta'] | undefined
): string {
  if (lineupMeta?.source === 'last-match') {
    return 'Both teams from each side\u2019s last completed match. Headshots shown when matched to club/intl data.';
  }
  if (lineupMeta?.source === 'mixed') {
    return 'Confirmed lineups where available; otherwise each team\u2019s last completed match (both sides).';
  }
  return 'Confirmed match-day starting XI and substitutes. Headshots shown when matched to club/intl data.';
}

function resolveWorldCupTeamOption(
  teamId: number | string | null | undefined,
  teamOptions: WorldCupTeamOption[],
  teams?: WorldCupDashboardData['teams']
): WorldCupTeamOption | null {
  if (teamId == null || teamId === '') return null;
  const id = String(teamId);
  const fromOptions = teamOptions.find((team) => team.id === id);
  if (fromOptions) return fromOptions;
  const fromApi = teams?.find((team) => String(team.id) === id);
  if (!fromApi) return null;
  return {
    id: String(fromApi.id),
    name: fromApi.name,
    abbreviation: fromApi.abbreviation || fromApi.country_code || fromApi.name.slice(0, 3).toUpperCase(),
    countryCode: fromApi.country_code || fromApi.abbreviation || null,
    group: 'World Cup',
    confederation: fromApi.confederation || 'FIFA',
  };
}

function buildWorldCupPlayerNameById(rosters: Array<Record<string, any>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rosters) {
    const player = row.player ?? {};
    const id = String(player.id ?? '').trim();
    const name = String(player.name || '').trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

function buildWorldCupLineup(
  lineups: Array<Record<string, any>>,
  teamId: string | null | undefined,
  opts?: {
    nameByPlayerId?: Map<string, string>;
    photoByPlayerId?: Record<string, string>;
  }
): WorldCupTeamLineup {
  const empty: WorldCupTeamLineup = { formation: null, starters: [], substitutes: [] };
  if (!teamId || !lineups?.length) return empty;
  const starters: WorldCupLineupPlayer[] = [];
  const substitutes: WorldCupLineupPlayer[] = [];
  let formation: string | null = null;
  for (const row of lineups) {
    if (String(row?.team_id ?? '') !== String(teamId)) continue;
    if (!formation && row.formation) formation = String(row.formation);
    const player = row.player ?? {};
    const playerId = String(player.id ?? row.player_id ?? player.name ?? Math.random());
    const rosterName = opts?.nameByPlayerId?.get(playerId);
    const rawName = String(player.name || player.short_name || rosterName || 'Player');
    const name = rosterName && rosterName.length > rawName.length ? rosterName : rawName;
    const entry: WorldCupLineupPlayer = {
      id: playerId,
      name,
      number: String(row.shirt_number ?? player.jersey_number ?? '').trim(),
      position: String(row.position || player.position || '').trim(),
      imageUrl: opts?.photoByPlayerId?.[playerId] ?? null,
    };
    if (row.is_starter) starters.push(entry);
    else if (row.is_substitute) substitutes.push(entry);
    else starters.push(entry);
  }
  const byNumber = (a: WorldCupLineupPlayer, b: WorldCupLineupPlayer) =>
    (Number(a.number) || 999) - (Number(b.number) || 999);
  starters.sort(byNumber);
  substitutes.sort(byNumber);
  return { formation, starters, substitutes };
}

function WorldCupLineupPlayerBadge({
  player,
  dotColor,
  sizeClass = 'h-8 w-8 text-[11px]',
}: {
  player: WorldCupLineupPlayer;
  dotColor: string;
  sizeClass?: string;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = Boolean(player.imageUrl) && !photoFailed;
  if (showPhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.imageUrl!}
        alt={player.name}
        className={`${sizeClass} rounded-full object-cover shadow ring-2 ${dotColor}`}
        onError={() => setPhotoFailed(true)}
      />
    );
  }
  return (
    <span className={`flex ${sizeClass} items-center justify-center rounded-full font-bold text-white shadow ring-2 ${dotColor}`}>
      {player.number || '–'}
    </span>
  );
}

function WorldCupLineupColumn({
  isDark,
  team,
  lineup,
  accent,
}: {
  isDark: boolean;
  team: WorldCupTeamOption | null;
  lineup: WorldCupTeamLineup;
  accent: 'blue' | 'amber';
}) {
  const teamName = team?.name ?? (accent === 'blue' ? 'Selected' : 'Opponent');
  const teamFlag = getWorldCupFlagUrl(team?.countryCode || team?.abbreviation);
  const accentText = accent === 'blue'
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-amber-600 dark:text-amber-400';
  const badgeColor = accent === 'blue'
    ? 'bg-blue-500 ring-blue-300/60'
    : 'bg-amber-500 ring-amber-300/60';

  const renderRow = (entry: WorldCupLineupPlayer) => (
    <div key={entry.id} className="flex items-start gap-2 rounded-md px-1 py-1.5 text-sm">
      <WorldCupLineupPlayerBadge player={entry} dotColor={badgeColor} sizeClass="h-7 w-7 text-[11px]" />
      <span className={`min-w-0 flex-1 break-words text-sm font-medium leading-snug ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{entry.name}</span>
      {entry.position ? (
        <span className={`shrink-0 text-[10px] font-medium uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {entry.position}
        </span>
      ) : null}
    </div>
  );

  return (
    <div className={`flex flex-col rounded-lg border ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}>
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        {teamFlag ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={teamFlag} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />
        ) : null}
        <span className={`truncate text-sm font-semibold ${accentText}`}>{teamName}</span>
        {lineup.formation ? (
          <span className={`ml-auto shrink-0 text-[11px] font-semibold tabular-nums ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {lineup.formation}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 px-2 py-2">
        <div className={`px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Starting XI
        </div>
        <div className="flex flex-col">{lineup.starters.map(renderRow)}</div>
        {lineup.substitutes.length ? (
          <>
            <div className={`mt-1 px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Substitutes
            </div>
            <div className="flex flex-col">{lineup.substitutes.map(renderRow)}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function parseWorldCupFormation(formation: string | null): number[] {
  if (!formation) return [4, 3, 3];
  const parts = formation
    .split(/[^0-9]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parts.length ? parts : [4, 3, 3];
}

// Rank a position from most defensive (0 = GK) to most attacking (~50 = striker).
// Used to order any starting XI into formation rows correctly, whatever the shape.
function worldCupPitchRank(pos: string): number {
  const p = (pos || '').toLowerCase().trim();
  if (!p) return 30;
  if (p === 'g' || p === 'gk' || /goal|keeper/.test(p)) return 0;
  if (p === 'd') return 11;
  if (p === 'm') return 30;
  if (p === 'f') return 50;
  // Defenders
  if (/\b(lwb|rwb|wb|lb|rb|dl|dr)\b|wing.?back|left back|right back|full.?back/.test(p)) return 12;
  if (/\b(cb|dc)\b|cent.*back|centre.?back|center.?back/.test(p)) return 10;
  if (/defen|\bdf\b/.test(p)) return 11;
  // Midfielders
  if (/\b(cdm|dm|dmc)\b|defensive mid|holding|anchor/.test(p)) return 20;
  if (/\b(lm|rm|ml|mr)\b|left mid|right mid|wide mid/.test(p)) return 33;
  if (/\b(cam|am|amc)\b|attacking mid|playmaker|number ?10/.test(p)) return 40;
  if (/\b(cm|mc|cmf)\b|central mid|midfield|\bmid\b|\bmf\b/.test(p)) return 30;
  // Attackers
  if (/\b(lw|rw|aml|amr|lf|rf)\b|winger|wide forward|left wing|right wing/.test(p)) return 45;
  if (/forward|strik|\b(st|cf|fw|ss)\b|centre forward|center forward|second striker/.test(p)) return 50;
  return 30;
}

// Horizontal hint: -1 left, 0 central, 1 right — keeps each row tidy left→right.
function worldCupPitchSide(pos: string): number {
  const p = (pos || '').toLowerCase();
  if (/left|\b(lb|lw|lm|lwb|dl|aml|lf)\b/.test(p)) return -1;
  if (/right|\b(rb|rw|rm|rwb|dr|amr|rf)\b/.test(p)) return 1;
  return 0;
}

function sortWorldCupRowBySide(row: WorldCupLineupPlayer[]): WorldCupLineupPlayer[] {
  return [...row].sort(
    (a, b) =>
      worldCupPitchSide(a.position) - worldCupPitchSide(b.position) ||
      (Number(a.number) || 999) - (Number(b.number) || 999)
  );
}

function orderWorldCupPitchPlayers(players: WorldCupLineupPlayer[]): WorldCupLineupPlayer[] {
  return players
    .map((p, i) => ({ p, rank: worldCupPitchRank(p.position), i }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (Number(a.p.number) || 999) - (Number(b.p.number) || 999) ||
        a.i - b.i
    )
    .map((x) => x.p);
}

// Fallback when there's no usable formation string: split outfielders into
// defense / midfield / attack bands by rank so the pitch still looks balanced.
function bucketWorldCupOutfieldRows(outfield: WorldCupLineupPlayer[]): WorldCupLineupPlayer[][] {
  const def = outfield.filter((p) => worldCupPitchRank(p.position) < 18);
  const mid = outfield.filter((p) => {
    const r = worldCupPitchRank(p.position);
    return r >= 18 && r < 44;
  });
  const fwd = outfield.filter((p) => worldCupPitchRank(p.position) >= 44);
  return [def, mid, fwd].filter((row) => row.length);
}

// Turn any starting XI into pitch rows: GK row first, then one row per
// formation line (defense → attack). Row counts always match the formation.
function buildWorldCupPitchRows(
  players: WorldCupLineupPlayer[],
  formation: number[] | null
): WorldCupLineupPlayer[][] {
  const ordered = orderWorldCupPitchPlayers(players);
  const gk = ordered.filter((p) => worldCupPitchRank(p.position) === 0).slice(0, 1);
  const outfield = ordered.filter((p) => !gk.includes(p));
  const total = formation ? formation.reduce((sum, n) => sum + n, 0) : -1;

  let rows: WorldCupLineupPlayer[][];
  if (formation && outfield.length === total) {
    rows = [];
    let idx = 0;
    formation.forEach((count) => {
      rows.push(outfield.slice(idx, idx + count));
      idx += count;
    });
  } else {
    rows = bucketWorldCupOutfieldRows(outfield);
  }

  rows = rows.map(sortWorldCupRowBySide);
  return [gk, ...rows];
}

function WorldCupPitch({
  isDark,
  team,
  players,
  formation,
  accent,
}: {
  isDark: boolean;
  team: WorldCupTeamOption | null;
  players: WorldCupLineupPlayer[];
  formation: number[] | null;
  accent: 'blue' | 'amber';
}) {
  const teamName = team?.name ?? (accent === 'blue' ? 'Selected' : 'Opponent');
  const teamFlag = getWorldCupFlagUrl(team?.countryCode || team?.abbreviation);
  const accentText = accent === 'blue'
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-amber-600 dark:text-amber-400';
  const dotColor = accent === 'blue'
    ? 'bg-blue-500 ring-blue-300/60'
    : 'bg-amber-500 ring-amber-300/60';

  const lines = buildWorldCupPitchRows(players, formation);
  const rowCount = lines.length;
  // Badge/caption reflect what is actually drawn so they never disagree.
  const shownFormation = lines.slice(1).map((line) => line.length).join('-');

  return (
    <div className={`flex flex-col rounded-lg border ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}>
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        {teamFlag ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={teamFlag} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />
        ) : null}
        <span className={`truncate text-sm font-semibold ${accentText}`}>{teamName}</span>
        <span className={`ml-auto shrink-0 text-[11px] font-semibold tabular-nums ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {shownFormation}
        </span>
      </div>
      <div className="relative mx-2 my-2 min-h-[340px] overflow-visible rounded-2xl bg-emerald-600/90 ring-1 ring-emerald-700 dark:bg-emerald-900/70 dark:ring-emerald-800">
        <div className="absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-white/40" />
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40" />
        <div className="absolute left-1/2 top-0 h-12 w-24 -translate-x-1/2 border border-t-0 border-white/40" />
        <div className="absolute left-1/2 bottom-0 h-12 w-24 -translate-x-1/2 border border-b-0 border-white/40" />
        {lines.map((line, rowIdx) => {
          const top = rowCount > 1 ? 90 - rowIdx * (80 / (rowCount - 1)) : 50;
          return line.map((player, colIdx) => {
            const left = ((colIdx + 1) / (line.length + 1)) * 100;
            return (
              <div
                key={player.id}
                className="absolute flex w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                style={{ top: `${top}%`, left: `${left}%` }}
              >
                <WorldCupLineupPlayerBadge player={player} dotColor={dotColor} />
                <span className="max-w-[7.5rem] text-center text-[11px] font-semibold leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
                  <span className="block break-words">{player.name}</span>
                </span>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

function WorldCupLineupsPanel({
  isDark,
  selectedTeam,
  opponentTeam,
  lineups,
  lineupMeta,
  teamOptions,
  teams,
  rosters,
  lineupPlayerPhotos,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  lineups: Array<Record<string, any>>;
  lineupMeta?: WorldCupDashboardData['lineupMeta'];
  teamOptions: WorldCupTeamOption[];
  teams?: WorldCupDashboardData['teams'];
  rosters: Array<Record<string, any>>;
  lineupPlayerPhotos?: Record<string, string>;
}) {
  const lastMatchOpponentTeam = useMemo(() => {
    if (!lineupMeta?.selectedTeamLastMatchId || !lineupMeta.selectedTeamLastMatchOpponentId) return null;
    return resolveWorldCupTeamOption(
      lineupMeta.selectedTeamLastMatchOpponentId,
      teamOptions,
      teams
    );
  }, [lineupMeta, teamOptions, teams]);

  const displayOpponentTeam = lastMatchOpponentTeam ?? opponentTeam;
  const nameByPlayerId = useMemo(() => buildWorldCupPlayerNameById(rosters), [rosters]);
  const lineupBuildOpts = useMemo(
    () => ({ nameByPlayerId, photoByPlayerId: lineupPlayerPhotos ?? {} }),
    [nameByPlayerId, lineupPlayerPhotos]
  );

  const selectedLineup = useMemo(
    () => buildWorldCupLineup(lineups, selectedTeam?.id, lineupBuildOpts),
    [lineups, selectedTeam?.id, lineupBuildOpts]
  );
  const opponentLineup = useMemo(
    () => buildWorldCupLineup(lineups, displayOpponentTeam?.id, lineupBuildOpts),
    [lineups, displayOpponentTeam?.id, lineupBuildOpts]
  );

  const renderTeam = (
    team: WorldCupTeamOption | null,
    lineup: WorldCupTeamLineup,
    accent: 'blue' | 'amber'
  ) => {
    // Full confirmed XI → lay out on the pitch. The row builder ranks every
    // player defense→attack and slices them into the formation, so any shape
    // (4-3-3, 4-2-3-1, 3-4-3, 5-3-2, 4-1-4-1, …) renders correctly. When the
    // formation string is missing we pass null and it buckets by position.
    if (lineup.starters.length >= 10) {
      return (
        <WorldCupPitch
          isDark={isDark}
          team={team}
          players={lineup.starters}
          formation={lineup.formation ? parseWorldCupFormation(lineup.formation) : null}
          accent={accent}
        />
      );
    }
    // Partial data (rare) → simple list so nothing is misplaced on the pitch.
    if (lineup.starters.length) {
      return <WorldCupLineupColumn isDark={isDark} team={team} lineup={lineup} accent={accent} />;
    }
    // No data yet.
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed px-3 py-10 text-center text-xs ${isDark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'}`}>
        Waiting for confirmed lineups
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-3 px-3 sm:grid-cols-2 sm:px-4">
      {renderTeam(selectedTeam, selectedLineup, 'blue')}
      {displayOpponentTeam ? (
        renderTeam(displayOpponentTeam, opponentLineup, 'amber')
      ) : (
        <div className={`flex items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center text-xs ${isDark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'}`}>
          No opponent fixture selected.
        </div>
      )}
    </div>
  );
}

function formatWorldCupScheduleDate(datetime: string | null): { date: string; time: string } {
  if (!datetime) return { date: 'TBD', time: '' };
  const d = new Date(datetime);
  if (Number.isNaN(d.getTime())) return { date: 'TBD', time: '' };
  return {
    date: d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }),
    time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

function WorldCupScheduleSide({
  isDark,
  team,
  label,
  align,
}: {
  isDark: boolean;
  team: Record<string, any> | null | undefined;
  label: string;
  align: 'left' | 'right';
}) {
  const flag = getWorldCupFlagUrl(team?.country_code || team?.abbreviation);
  const flagEl = flag ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={flag} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />
  ) : (
    <span className="h-4 w-6 shrink-0 rounded-sm bg-gray-300 dark:bg-gray-600" />
  );
  const nameEl = (
    <span className={`truncate text-sm font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{label}</span>
  );
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      {flagEl}
      {nameEl}
    </div>
  );
}

function WorldCupSchedulePanel({
  isDark,
  matches,
}: {
  isDark: boolean;
  matches: Array<Record<string, any>>;
}) {
  const rows = useMemo(() => {
    if (!matches?.length) return [];
    const sorted = matches
      .slice()
      .sort((a, b) => (Date.parse(a.datetime || '') || 0) - (Date.parse(b.datetime || '') || 0));

    const now = Date.now();
    const liveBuffer = 3 * 60 * 60 * 1000; // keep in-progress games visible
    const windowEnd = now + 72 * 60 * 60 * 1000;
    const inWindow = sorted.filter((m) => {
      if (m.status === 'in_progress') return true;
      const t = Date.parse(m.datetime || '') || 0;
      return t >= now - liveBuffer && t <= windowEnd;
    });
    if (inWindow.length) return inWindow;

    // Nothing in the next 72h (e.g. pre-tournament) → show the soonest upcoming.
    const upcoming = sorted.filter((m) => (Date.parse(m.datetime || '') || 0) >= now);
    return upcoming.length ? upcoming : sorted;
  }, [matches]);

  if (!rows.length) {
    return <EmptyState text="No fixtures scheduled yet." />;
  }

  return (
    <div className="max-h-[320px] space-y-2 overflow-y-auto px-3 pb-1 sm:px-4 custom-scrollbar fade-scrollbar">
      {rows.map((m) => {
        const homeLabel = m.homeLabel || m.homeTeam?.name || 'TBD';
        const awayLabel = m.awayLabel || m.awayTeam?.name || 'TBD';
        const completed = m.status === 'completed';
        const live = m.status === 'in_progress';
        const { date, time } = formatWorldCupScheduleDate(m.datetime);
        const groupLabel = m.group ? `Group ${m.group}` : m.stage || '';
        return (
          <div
            key={m.id}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
              isDark ? 'border-gray-700 bg-[#07131f]' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex w-14 shrink-0 flex-col leading-tight">
              <span className={`text-xs font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{date}</span>
              <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{time}</span>
            </div>
            <WorldCupScheduleSide isDark={isDark} team={m.homeTeam} label={homeLabel} align="left" />
            <div className="flex shrink-0 flex-col items-center">
              {completed ? (
                <span className={`text-sm font-bold tabular-nums ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                  {m.homeScore}–{m.awayScore}
                </span>
              ) : live ? (
                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Live</span>
              ) : (
                <span className={`text-[11px] font-semibold ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>v</span>
              )}
              {groupLabel ? (
                <span className={`mt-0.5 text-[9px] font-medium uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {groupLabel}
                </span>
              ) : null}
            </div>
            <WorldCupScheduleSide isDark={isDark} team={m.awayTeam} label={awayLabel} align="right" />
          </div>
        );
      })}
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
  const [tab, setTab] = useState<WorldCupTeamFormTab>('compare');
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
          onClick={() => setTab('compare')}
          className={`${tabBase} ${tab === 'compare' ? activeTab : inactiveTab}`}
        >
          Compare
        </button>
        <button
          type="button"
          onClick={() => setTab('team_form')}
          className={`${tabBase} ${tab === 'team_form' ? activeTab : inactiveTab}`}
        >
          Team Form
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
            competition={competition}
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
            competition={competition}
          />
        </div>
      </div>
    </div>
  );
}

function resolveWorldCupTeamSlug(team: WorldCupTeamOption | null): string {
  if (!team) return '';
  return (
    resolveWorldCupFlagCode(team.countryCode) ||
    resolveWorldCupFlagCode(team.abbreviation) ||
    resolveWorldCupFlagCode(team.name) ||
    ''
  );
}

function resolveWorldCupTeamSlugCandidates(team: WorldCupTeamOption | null): string[] {
  if (!team) return [];
  const slugs = new Set<string>();
  for (const candidate of [team.countryCode, team.abbreviation, team.name]) {
    const code = resolveWorldCupFlagCode(candidate);
    if (code) slugs.add(code);
    const lower = String(candidate ?? '').trim().toLowerCase();
    if (lower) slugs.add(lower);
  }
  return [...slugs];
}

function computeOpponentAllowedRankFromValues(
  entry: { values: Record<string, number>; ranks: Record<string, number> },
  slug: string,
  breakdown: WorldCupOppBreakdownResponse | null
): { rank: number; tied: number } | undefined {
  if (!breakdown?.names) {
    const r = entry.ranks[slug];
    if (typeof r === 'number' && Number.isFinite(r)) return { rank: r, tied: 1 };
    return undefined;
  }
  const universe = Object.keys(breakdown.names);
  if (!universe.length) return undefined;
  const rankValues = universe.map((teamSlug) => ({
    slug: teamSlug,
    value:
      (breakdown.games?.[teamSlug] ?? 0) >= 1 && Number.isFinite(entry.values[teamSlug])
        ? entry.values[teamSlug]!
        : 0,
  }));
  const ranks = rankOpponentAllowedValues(rankValues);
  const rank = ranks[slug];
  if (rank == null) return undefined;
  const tied = Object.values(ranks).filter((r) => r === rank).length;
  return { rank, tied };
}

function lookupWorldCupOpponentBreakdownMetric(
  breakdown: WorldCupOppBreakdownResponse | null,
  statKey: string,
  team: WorldCupTeamOption | null
): { value?: number; rank?: number; rankTied?: number } {
  if (!breakdown?.metrics[statKey] || !team) return {};
  const entry = breakdown.metrics[statKey];
  for (const slug of resolveWorldCupTeamSlugCandidates(team)) {
    if (typeof entry.values[slug] === 'number' && Number.isFinite(entry.values[slug])) {
      const r = computeOpponentAllowedRankFromValues(entry, slug, breakdown);
      return { value: entry.values[slug], rank: r?.rank, rankTied: r?.tied };
    }
  }
  const teamName = team.name.trim().toLowerCase();
  for (const [slug, name] of Object.entries(breakdown.names)) {
    const normalized = String(name).trim().toLowerCase();
    if (normalized === teamName || resolveWorldCupFlagCode(name) === resolveWorldCupTeamSlug(team)) {
      if (typeof entry.values[slug] === 'number' && Number.isFinite(entry.values[slug])) {
        const r = computeOpponentAllowedRankFromValues(entry, slug, breakdown);
        return { value: entry.values[slug], rank: r?.rank, rankTied: r?.tied };
      }
    }
  }
  return {};
}

/**
 * Team Matchup: the selected team's attacking averages (going forward) versus
 * how the opponent defends (their allowed averages = the Opponent Breakdown),
 * and the reverse via the toggle. Both sides read the SAME precomputed payload
 * the Opponent Breakdown uses, so the numbers match the chart everywhere:
 *   - attack  = forMetrics[stat].values[slug]  (ranked: most = #1)
 *   - allowed = metrics[stat].values[slug]      (ranked: least allowed = #1)
 */
function WorldCupTeamMatchupCard({
  isDark,
  selectedTeam,
  opponentTeam,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
}) {
  const [windowN, setWindowN] = useState<number>(WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW);

  const [breakdown, setBreakdown] = useState<WorldCupOppBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/world-cup/dashboard?oppBreakdown=1&window=${windowN}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
        }
        return res.json() as Promise<WorldCupOppBreakdownResponse>;
      })
      .then((payload) => {
        if (!cancelled) setBreakdown(payload);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setBreakdown(null);
        setError(err.message || 'Failed to load team matchup');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowN]);

  const opponentForLabel = opponentTeam;

  const teamSlug = resolveWorldCupTeamSlug(selectedTeam);
  const oppSlug = resolveWorldCupTeamSlug(opponentForLabel);

  const teamFlagUrl = getWorldCupFlagUrl(selectedTeam?.countryCode || selectedTeam?.abbreviation);
  const oppFlagUrl = getWorldCupFlagUrl(opponentForLabel?.countryCode || opponentForLabel?.abbreviation);

  const teamLabel = selectedTeam?.name || 'Selected team';
  const opponentLabel = opponentForLabel?.name || 'Opponent';
  const teamAbbr = (selectedTeam?.abbreviation || selectedTeam?.name || '').slice(0, 3).toUpperCase();
  const oppAbbr = (opponentForLabel?.abbreviation || opponentForLabel?.name || '').slice(0, 3).toUpperCase();
  const isOpponentPrimary = false;

  // Ranking universe size (ranked nations), used to convert ranks -> bar share.
  const rankedSize = breakdown ? Math.max(Object.keys(breakdown.names).length, 20) : 20;

  const rows = useMemo(() => {
    if (!breakdown || !breakdown.forMetrics) return [];
    return WORLD_CUP_MATCHUP_METRICS.map((metric) => {
      const forEntry = breakdown.forMetrics?.[metric.key];
      const allowedEntry = breakdown.metrics[metric.key];
      // Attack slug = whoever is "for" in this view; defense slug = the other.
      const attackSlug = isOpponentPrimary ? oppSlug : teamSlug;
      const defenseSlug = isOpponentPrimary ? teamSlug : oppSlug;
      const attackValue = attackSlug ? forEntry?.values[attackSlug] ?? null : null;
      const attackRank = attackSlug ? forEntry?.ranks[attackSlug] ?? null : null;
      const defenseValue = defenseSlug ? allowedEntry?.values[defenseSlug] ?? null : null;
      const defenseRank = defenseSlug ? allowedEntry?.ranks[defenseSlug] ?? null : null;
      const sideLabels = worldCupMatchupSideLabels(metric.key);
      return {
        key: metric.key,
        label: metric.label,
        teamSideLabel: sideLabels.team,
        opponentSideLabel: sideLabels.opponent,
        attackValue,
        attackRank,
        defenseValue,
        defenseRank,
      };
    });
  }, [breakdown, isOpponentPrimary, oppSlug, teamSlug]);

  const teamGames = teamSlug ? breakdown?.games?.[teamSlug] ?? 0 : 0;
  const oppGames = oppSlug ? breakdown?.games?.[oppSlug] ?? 0 : 0;
  const teamTotal = teamSlug ? breakdown?.totalGames?.[teamSlug] ?? 0 : 0;
  const oppTotal = oppSlug ? breakdown?.totalGames?.[oppSlug] ?? 0 : 0;

  const formatValue = (value: number | null) => {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toFixed(2);
  };

  // Tiered rank pill: top third green, middle amber, bottom third red.
  const rankPillClass = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) {
      return isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-500';
    }
    const third = rankedSize / 3;
    if (rank <= third) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    if (rank <= third * 2) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  };

  // Bar segment fill colored by the same rank tier (green/amber/red).
  const rankBarColor = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return isDark ? '#4b5563' : '#9ca3af';
    const third = rankedSize / 3;
    if (rank <= third) return '#16a34a';
    if (rank <= third * 2) return '#f59e0b';
    return '#e11d48';
  };

  const hasTeams = Boolean(teamSlug && oppSlug);
  const noData = Boolean(breakdown) && hasTeams && rows.every((r) => r.attackValue == null && r.defenseValue == null);

  return (
    <div className="w-full min-w-0 h-full flex flex-col px-1.5 py-1">
      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Matchup</h3>
        <div className={`flex rounded-lg border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
          {WORLD_CUP_OPP_BREAKDOWN_WINDOWS.map((option) => {
            const isAllOption = option.id === WORLD_CUP_OPP_BREAKDOWN_ALL_WINDOW;
            const minTotal = Math.min(teamTotal || 0, oppTotal || 0);
            const disabled = !isAllOption && minTotal > 0 && minTotal < option.id;
            const active = windowN === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => setWindowN(option.id)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-purple-600 text-white'
                    : disabled
                      ? isDark
                        ? 'bg-[#0a1929] text-gray-700 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                      : isDark
                        ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                        : 'bg-gray-100 text-gray-600 hover:text-gray-900'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Matchup header — selected team (attacking) vs opponent (defending). */}
      <div className="mb-2 flex flex-shrink-0 items-center gap-2">
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
        <h4 className={`truncate text-sm font-bold uppercase tracking-wider ${isDark ? 'text-white' : 'text-slate-900'}`}>
          {teamLabel} <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>vs</span> {opponentLabel}
        </h4>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 custom-scrollbar">
        {!selectedTeam ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Select a team to see the matchup.</div>
        ) : loading && !breakdown ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((idx) => (
              <div key={idx} className={`h-12 w-full rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-red-600 dark:text-red-400 py-4">{error}</div>
        ) : !hasTeams ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Pick an opponent to compare.</div>
        ) : noData ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>No data available yet.</div>
        ) : (
          <div className="space-y-2">
            <div className={`flex items-center justify-center gap-2 text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              <span className="tabular-nums">
                <span className="font-bold uppercase">{teamAbbr}</span> {teamGames || teamTotal} games
              </span>
              <span className="opacity-40">·</span>
              <span className="tabular-nums">
                <span className="font-bold uppercase">{oppAbbr}</span> {oppGames || oppTotal} games
              </span>
            </div>

            {rows.map((row) => {
              const minPct = 6;
              const teamPct = row.attackRank
                ? Math.max(minPct, ((rankedSize + 1 - row.attackRank) / rankedSize) * 100)
                : 0;
              const oppPct = row.defenseRank
                ? Math.max(minPct, ((rankedSize + 1 - row.defenseRank) / rankedSize) * 100)
                : 0;
              return (
                <div
                  key={row.key}
                  className={`rounded-xl border px-2.5 py-2 transition-colors ${
                    isDark
                      ? 'border-gray-700/60 bg-white/[0.02] hover:border-gray-600'
                      : 'border-gray-200 bg-gray-50/70 hover:border-gray-300'
                  }`}
                >
                  <div className={`mb-1.5 text-center text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {row.label}
                  </div>

                  {/* Team (attack) bar */}
                  <div className="mb-1 flex items-center gap-1.5">
                    {teamFlagUrl ? (
                      <img src={teamFlagUrl} alt={teamLabel} className="h-3.5 w-3.5 flex-shrink-0 rounded-full object-cover ring-1 ring-black/10" />
                    ) : (
                      <span className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[6px] font-bold ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-300 text-gray-700'}`}>{teamAbbr.slice(0, 1)}</span>
                    )}
                    <div className="w-[52px] flex-shrink-0 leading-tight">
                      <div className={`text-[10px] font-bold uppercase ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{teamAbbr}</div>
                      <div className={`text-[10px] font-semibold ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{row.teamSideLabel}</div>
                    </div>
                    <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-800">
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${teamPct}%`, backgroundColor: rankBarColor(row.attackRank) }} />
                    </div>
                    <span className="w-10 flex-shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 dark:text-white">{formatValue(row.attackValue)}</span>
                    {row.attackRank ? (
                      <span className={`w-7 flex-shrink-0 rounded-md px-1 py-0.5 text-center text-[9px] font-bold tabular-nums ${rankPillClass(row.attackRank)}`}>#{row.attackRank}</span>
                    ) : (
                      <span className="w-7 flex-shrink-0" />
                    )}
                  </div>

                  {/* Opponent (allowed) bar */}
                  <div className="flex items-center gap-1.5">
                    {oppFlagUrl ? (
                      <img src={oppFlagUrl} alt={opponentLabel} className="h-3.5 w-3.5 flex-shrink-0 rounded-full object-cover ring-1 ring-black/10" />
                    ) : (
                      <span className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[6px] font-bold ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-300 text-gray-700'}`}>{oppAbbr.slice(0, 1)}</span>
                    )}
                    <div className="w-[52px] flex-shrink-0 leading-tight">
                      <div className={`text-[10px] font-bold uppercase ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{oppAbbr}</div>
                      <div className={`text-[10px] font-semibold ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{row.opponentSideLabel}</div>
                    </div>
                    <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-800">
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${oppPct}%`, backgroundColor: rankBarColor(row.defenseRank) }} />
                    </div>
                    <span className="w-10 flex-shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 dark:text-white">{formatValue(row.defenseValue)}</span>
                    {row.defenseRank ? (
                      <span className={`w-7 flex-shrink-0 rounded-md px-1 py-0.5 text-center text-[9px] font-bold tabular-nums ${rankPillClass(row.defenseRank)}`}>#{row.defenseRank}</span>
                    ) : (
                      <span className="w-7 flex-shrink-0" />
                    )}
                  </div>
                </div>
              );
            })}

          </div>
        )}
      </div>
    </div>
  );
}

function WorldCupInsightsPanel({
  isDark,
  mode,
  selectedPlayer,
  selectedTeam,
  opponentTeam,
  teamOptions,
  competition,
}: {
  isDark: boolean;
  mode: PropsMode;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  teamOptions: WorldCupTeamOption[];
  competition: Competition;
}) {
  const [tab, setTab] = useState<InsightTab>('dvp');
  // DVP (Defense vs Position) is a player-props-only insight, so hide it on the
  // Game Props (team) side.
  const tabs: Array<{ id: InsightTab; label: string }> = [
    ...(mode === 'player' ? [{ id: 'dvp' as InsightTab, label: 'DVP' }] : []),
    { id: 'opponent', label: 'Opponent Breakdown' },
    { id: 'matchup', label: 'Team Matchup' },
  ];
  // If the active tab isn't available in the current mode (e.g. DVP while in
  // team mode), fall back to the first available tab.
  const activeTabId = tabs.some((item) => item.id === tab) ? tab : tabs[0].id;
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
              activeTabId === item.id ? activeTab : inactiveTab
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTabId === 'dvp' ? (
          <div className="h-full overflow-y-auto rounded-lg px-2 py-3 custom-scrollbar">
            <WorldCupDvpCard
              key={`${selectedPlayer?.id ?? 'none'}-${opponentTeam?.id ?? 'none'}-${competition}`}
              isDark={isDark}
              selectedPlayer={selectedPlayer}
              opponentTeam={opponentTeam}
              teamOptions={teamOptions}
              competition={competition}
            />
          </div>
        ) : activeTabId === 'opponent' ? (
          <WorldCupOpponentBreakdownCard
            isDark={isDark}
            opponentTeam={opponentTeam}
          />
        ) : (
          <WorldCupTeamMatchupCard
            isDark={isDark}
            selectedTeam={selectedTeam}
            opponentTeam={opponentTeam}
          />
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
  /** Game Props team pick — independent from the player's nation (mirrors AFL `aflTeamFilter`). */
  const [gamePropsTeam, setGamePropsTeam] = useState<WorldCupTeamOption | null>(null);
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
  const previousCompetition = useRef<Competition | null>(null);
  const hadStoredTeamOnHydration = useRef(false);
  const prevPropsModeRef = useRef<PropsMode>('player');
  const prevTeamContextIdRef = useRef<string>('');
  const prevSelectedPlayerIdRef = useRef<string | null>(null);
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

  // Player mode uses `selectedTeam` (synced from the active player). Game Props uses
  // an explicit team search pick, falling back to the player's nation — same split
  // as AFL's `selectedPlayer.team` vs `aflTeamFilter`.
  const activeTeam = useMemo(() => {
    if (propsMode === 'team') {
      return gamePropsTeam ?? selectedTeam;
    }
    return selectedTeam;
  }, [propsMode, gamePropsTeam, selectedTeam]);

  const hasSelection = propsMode === 'player' ? Boolean(selectedPlayer) : Boolean(activeTeam);
  const showSkeleton = !hasSelection;
  const hasApiTeams = Boolean(worldCupData?.teams?.length || apiTeams?.length);
  const selectedTeamId = selectedTeam?.id ?? null;
  const activeTeamId = activeTeam?.id ?? null;
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;
  const selectedTeamNeedsHydration = !selectedTeamId || !/^\d+$/.test(selectedTeamId);
  const activeTeamNeedsHydration = !activeTeamId || !/^\d+$/.test(activeTeamId);
  // Keep insight panels (DVP, opponent breakdown, team form) on skeleton until the
  // dashboard API has hydrated the real BDL team — avoids flashing placeholder teams
  // (e.g. Argentina from WORLD_CUP_TEAMS) while a player search is loading.
  const showInsightsSkeleton = !hasSelection || worldCupLoading || activeTeamNeedsHydration;
  // Content containers (supporting stats) skeleton on the same timing as the
  // main chart: no selection OR the dashboard fetch for this selection is still
  // in flight. Mirrors the AFL dashboard's loading skeletons.
  const showContentSkeleton = !hasSelection || worldCupLoading;

  const playerOptions = useMemo<WorldCupPlayerOption[]>(() => {
    const rosterPlayers = !worldCupData?.rosters?.length ? [] : worldCupData.rosters.slice(0, 80).map((row, i) => {
      const player = row.player ?? {};
      if (i === 0) console.log('[BDL player obj]', player, '[BDL roster row]', row);
      const name = String(player.name || player.short_name || 'World Cup Player');
      const parts = name.split(/\s+/).filter(Boolean);
      const teamId = row.team_id != null ? String(row.team_id) : worldCupData.selectedTeam?.id != null ? String(worldCupData.selectedTeam.id) : null;
      const teamName = teamOptions.find((team) => team.id === teamId)?.name || selectedTeam?.name || worldCupData.selectedTeam?.name || 'World Cup';
      const club = String(player.club || player.club_name || player.current_club || row.club || '').trim() || null;
      return {
        id: String(player.id ?? name),
        name,
        shortName: String(player.short_name || `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` || 'WC').slice(0, 3).toUpperCase(),
        teamName,
        teamId,
        countryCode: String(player.country_code || '').trim() || null,
        number: String(player.jersey_number || row.shirt_number || ''),
        role: String(row.position || player.position || 'FIFA'),
        positionGroup: resolveWorldCupPlayerGroup(row.position || player.position),
        club,
      };
    });
    const merged = new Map<string, WorldCupPlayerOption>();
    [...searchedPlayers, ...rosterPlayers].forEach((player) => merged.set(player.id, player));
    const players = Array.from(merged.values());
    if (players.length) return players;
    return showSkeleton ? [] : WORLD_CUP_PLAYERS;
  }, [searchedPlayers, selectedTeam?.name, showSkeleton, teamOptions, worldCupData]);

  const opponentTeam = useMemo(() => {
    if (!hasSelection || activeTeamNeedsHydration) return null;
    const featureMatch = worldCupData?.featureMatch;
    if (!featureMatch || !activeTeam?.id) return null;
    const homeId = featureMatch.homeTeam?.id != null ? String(featureMatch.homeTeam.id) : null;
    const awayId = featureMatch.awayTeam?.id != null ? String(featureMatch.awayTeam.id) : null;
    if (homeId === activeTeam.id && awayId) {
      return teamOptions.find((team) => team.id === awayId) ?? null;
    }
    if (awayId === activeTeam.id && homeId) {
      return teamOptions.find((team) => team.id === homeId) ?? null;
    }
    // No feature match yet — leave null so DVP stays unset until the API resolves
    // the fixture (never default to the first placeholder team e.g. Argentina).
    return null;
  }, [hasSelection, activeTeam?.id, activeTeamNeedsHydration, teamOptions, worldCupData?.featureMatch]);
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
    : 'FIFA World Cup 2026 - data pending';
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
  const selectedTeamLogo = getWorldCupFlagUrl(activeTeam?.countryCode || activeTeam?.abbreviation);
  const opponentTeamLogo = getWorldCupFlagUrl(opponentTeam?.countryCode || opponentTeam?.abbreviation);
  const selectedTeamAbbr = activeTeam?.abbreviation || activeTeam?.name?.slice(0, 3).toUpperCase() || 'TBD';
  const opponentTeamAbbr = opponentTeam?.abbreviation || opponentTeam?.name?.slice(0, 3).toUpperCase() || 'TBD';
  const hasMatchup = hasSelection && !showInsightsSkeleton && Boolean(opponentTeam && activeTeam);
  const skeletonBar = isDark ? 'bg-gray-800' : 'bg-gray-200';

  // Rehydrate page context on refresh (mode, competition, team/player, chart stat).
  useEffect(() => {
    if (typeof window === 'undefined') {
      setHydratedFromStorage(true);
      return;
    }
    try {
      const storedMode = window.localStorage.getItem(WORLD_CUP_STORAGE_KEYS.propsMode);
      if (storedMode === 'player' || storedMode === 'team') {
        setPropsMode(storedMode);
      }

      let restoredCompetition: Competition = 'world-cup';
      const storedCompetition = window.localStorage.getItem(WORLD_CUP_STORAGE_KEYS.competition);
      if (
        storedCompetition === 'all' ||
        storedCompetition === 'world-cup' ||
        storedCompetition === 'euros' ||
        storedCompetition === 'nations-league'
      ) {
        restoredCompetition = storedCompetition;
        setCompetition(storedCompetition);
      }
      // Seed before hydratedFromStorage flips so the competition-change handler
      // does not treat a restored value as a user switch and wipe the team.
      previousCompetition.current = restoredCompetition;

      const storedTeamRaw = window.localStorage.getItem(WORLD_CUP_STORAGE_KEYS.selectedTeam);
      if (storedTeamRaw) {
        const parsed = JSON.parse(storedTeamRaw) as WorldCupTeamOption | null;
        if (parsed && parsed.id) {
          setSelectedTeam(parsed);
          setTeamSearchQuery('');
        }
      }

      const storedGamePropsTeamRaw = window.localStorage.getItem(WORLD_CUP_STORAGE_KEYS.gamePropsTeam);
      if (storedGamePropsTeamRaw) {
        const parsed = JSON.parse(storedGamePropsTeamRaw) as WorldCupTeamOption | null;
        if (parsed && parsed.id) {
          hadStoredTeamOnHydration.current = true;
          setGamePropsTeam(parsed);
        }
      }

      const storedPlayerRaw = window.localStorage.getItem(WORLD_CUP_STORAGE_KEYS.selectedPlayer);
      if (storedPlayerRaw) {
        const parsed = JSON.parse(storedPlayerRaw) as WorldCupPlayerOption | null;
        if (parsed && parsed.id) {
          setSelectedPlayer(parsed);
          setPlayerSearchQuery(parsed.name ?? '');
        }
      }

      const storedChartRaw = window.localStorage.getItem(WORLD_CUP_STORAGE_KEYS.chartContext);
      if (storedChartRaw) {
        const parsed = JSON.parse(storedChartRaw) as Partial<WorldCupChartContext> | null;
        if (parsed?.statId && parsed?.timeframe) {
          setChartContext({
            statId: parsed.statId,
            statKey: parsed.statKey ?? parsed.statId,
            statLabel: parsed.statLabel ?? String(parsed.statId),
            timeframe: parsed.timeframe,
          });
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
      window.localStorage.setItem(WORLD_CUP_STORAGE_KEYS.propsMode, propsMode);
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, propsMode]);

  useEffect(() => {
    if (!hydratedFromStorage || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(WORLD_CUP_STORAGE_KEYS.competition, competition);
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, competition]);

  // When the user switches competition, drop selections — but not on the initial
  // restore from localStorage (previousCompetition is seeded during hydration).
  useEffect(() => {
    if (!hydratedFromStorage) return;
    if (previousCompetition.current === null) {
      previousCompetition.current = competition;
      return;
    }
    if (previousCompetition.current !== competition) {
      previousCompetition.current = competition;
      setSelectedPlayer(null);
      setPlayerSearchQuery('');
      setSelectedTeam(null);
      setGamePropsTeam(null);
      setTeamSearchQuery('');
      setSearchedPlayers([]);
      try {
        window.localStorage.removeItem(WORLD_CUP_STORAGE_KEYS.selectedTeam);
        window.localStorage.removeItem(WORLD_CUP_STORAGE_KEYS.gamePropsTeam);
        window.localStorage.removeItem(WORLD_CUP_STORAGE_KEYS.selectedPlayer);
      } catch {
        /* localStorage unavailable */
      }
    }
  }, [competition, hydratedFromStorage]);

  useEffect(() => {
    if (!hydratedFromStorage || propsMode !== 'player' || !selectedTeam || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(WORLD_CUP_STORAGE_KEYS.selectedTeam, JSON.stringify(selectedTeam));
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, propsMode, selectedTeam]);

  useEffect(() => {
    if (!hydratedFromStorage || propsMode !== 'team' || !gamePropsTeam || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(WORLD_CUP_STORAGE_KEYS.gamePropsTeam, JSON.stringify(gamePropsTeam));
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, propsMode, gamePropsTeam]);

  useEffect(() => {
    if (!hydratedFromStorage || !selectedPlayer || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(WORLD_CUP_STORAGE_KEYS.selectedPlayer, JSON.stringify(selectedPlayer));
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, selectedPlayer]);

  useEffect(() => {
    if (!hydratedFromStorage || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(WORLD_CUP_STORAGE_KEYS.chartContext, JSON.stringify(chartContext));
    } catch {
      /* localStorage unavailable */
    }
  }, [hydratedFromStorage, chartContext]);

  // Upgrade a persisted Game Props team (slug id) to the real BDL team once the
  // API team list is available — keeps Game Props working after refresh.
  useEffect(() => {
    if (!hydratedFromStorage || propsMode !== 'team' || !gamePropsTeam || !hasApiTeams) return;
    if (!activeTeamNeedsHydration) return;
    const resolved = resolveStoredWorldCupTeam(gamePropsTeam, teamOptions);
    if (resolved && resolved.id !== gamePropsTeam.id) {
      setGamePropsTeam(resolved);
      setTeamSearchQuery('');
    }
  }, [
    hydratedFromStorage,
    propsMode,
    gamePropsTeam,
    activeTeamNeedsHydration,
    hasApiTeams,
    teamOptions,
  ]);

  // First visit to Game Props with no prior team — default to the first real team.
  useEffect(() => {
    if (!hydratedFromStorage || propsMode !== 'team' || activeTeam || !hasApiTeams) return;
    if (hadStoredTeamOnHydration.current) return;
    const firstReal = teamOptions.find((team) => /^\d+$/.test(team.id));
    if (firstReal) setGamePropsTeam(firstReal);
  }, [hydratedFromStorage, propsMode, activeTeam, hasApiTeams, teamOptions]);

  // Game Props team search is independent from Player Props — clear the explicit
  // pick when the active player changes, but not on the initial hydration pass.
  useEffect(() => {
    const current = selectedPlayer?.id ?? null;
    const prev = prevSelectedPlayerIdRef.current;
    if (prev && current !== prev) {
      setGamePropsTeam(null);
    }
    prevSelectedPlayerIdRef.current = current;
  }, [selectedPlayer?.id]);

  // Mirror AFL mode-toggle resets: chart window + search UI, without mutating the
  // player's nation when entering Game Props.
  useEffect(() => {
    const prev = prevPropsModeRef.current;
    if (prev === propsMode) return;

    setTeamSearchQuery('');
    setChartContext((ctx) => ({ ...ctx, timeframe: 'last10' }));
    if (propsMode === 'player' && selectedPlayer?.name) {
      setPlayerSearchQuery(selectedPlayer.name);
    }

    prevPropsModeRef.current = propsMode;
  }, [propsMode, selectedPlayer?.name]);

  // Drop stale dashboard payload when the Game Props team context changes.
  useEffect(() => {
    if (propsMode !== 'team') {
      prevTeamContextIdRef.current = '';
      return;
    }
    const current = activeTeamId ?? '';
    const prev = prevTeamContextIdRef.current;
    if (prev && prev !== current) {
      setWorldCupData(null);
      setWorldCupError(null);
    }
    prevTeamContextIdRef.current = current;
  }, [propsMode, activeTeamId]);

  // Keep selected team in sync with the active player once API teams are loaded.
  // Skip while teamOptions are still placeholders — resolving against WORLD_CUP_TEAMS
  // can pick the wrong nation and flash incorrect DVP/matchup data.
  useEffect(() => {
    if (propsMode !== 'player' || !selectedPlayer || !hasApiTeams) return;
    const team = resolveWorldCupTeamForPlayer(selectedPlayer, teamOptions);
    if (!team || team.id === selectedTeam?.id) return;
    setSelectedTeam(team);
    setTeamSearchQuery('');
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
        if (activeTeamId && /^\d+$/.test(activeTeamId)) params.set('teamId', activeTeamId);
        // Game Props must not send player context — the API would override the
        // requested nation with the player's club and skip team stat merges.
        if (propsMode === 'player') {
          if (selectedPlayerId) params.set('playerId', selectedPlayerId);
          if (selectedPlayer?.name) params.set('playerName', selectedPlayer.name);
        }
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
          if (propsMode === 'player' && (selectedPlayerId || selectedTeamNeedsHydration)) {
            if (team.id !== selectedTeam?.id) {
              setSelectedTeam(team);
              setTeamSearchQuery('');
            }
          } else if (propsMode === 'team' && activeTeamNeedsHydration) {
            if (team.id !== gamePropsTeam?.id) {
              setGamePropsTeam(team);
              setTeamSearchQuery('');
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
  }, [
    hasSelection,
    hydratedFromStorage,
    propsMode,
    selectedPlayerId,
    activeTeamId,
    activeTeamNeedsHydration,
    selectedTeamNeedsHydration,
    competition,
    selectedPlayer?.name,
    gamePropsTeam?.id,
    selectedTeam?.id,
  ]);

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
            positionGroup: resolveWorldCupPlayerGroup(player.position),
            club: String(player.club || player.club_name || player.current_club || '').trim() || null,
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
                                ? activeTeam?.name || 'Select a Team'
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
                              {selectedPlayer.club ? (
                                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                  {selectedPlayer.club}
                                </div>
                              ) : null}
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {selectedPlayer.teamName || '—'}
                              </div>
                              {selectedPlayer.role ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  Position: {formatWorldCupRole(selectedPlayer.role)}
                                </div>
                              ) : null}
                            </>
                          ) : propsMode === 'team' && activeTeam ? (
                            <>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {activeTeam.confederation || '—'}
                              </div>
                              {activeTeam.group ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {activeTeam.group}
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
                                    alt={activeTeam?.name || selectedTeamAbbr}
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
                              {worldCupLoading ? 'Loading World Cup data...' : worldCupError || featureMatchMeta}
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
                                  ? activeTeam?.name || 'Select a Team'
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
                                {selectedPlayer.club ? (
                                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                    {selectedPlayer.club}
                                  </div>
                                ) : null}
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {selectedPlayer.teamName || '—'}
                                </div>
                                {selectedPlayer.role ? (
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {formatWorldCupRole(selectedPlayer.role)}
                                  </div>
                                ) : null}
                              </div>
                            ) : propsMode === 'team' && activeTeam ? (
                              <div>
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {activeTeam.confederation || '—'}
                                </div>
                                {activeTeam.group ? (
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {activeTeam.group}
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
                                        alt={activeTeam?.name || selectedTeamAbbr}
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
                                <div className={`px-3 py-3 text-sm ${emptyText}`}>Searching players...</div>
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
                                    setGamePropsTeam(team);
                                    setTeamSearchQuery('');
                                    setTeamSearchOpen(false);
                                  }}
                                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:hover:bg-[#1e293b] ${
                                    activeTeam?.id === team.id ? 'bg-purple-50 dark:bg-purple-950/40' : ''
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
                          selectedTeam={activeTeam}
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
                  {showContentSkeleton ? (
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
                      selectedTeamId={activeTeamId}
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
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={5} className="px-3 sm:px-4 py-1" />
                  ) : (
                    <>
                  <SectionHeader title="Lineups" subtitle={worldCupLineupsSubtitle(worldCupData?.lineupMeta)} />
                  <WorldCupLineupsPanel
                    isDark={isDark}
                    selectedTeam={activeTeam}
                    opponentTeam={opponentTeam}
                    lineups={worldCupData?.lineups ?? []}
                    lineupMeta={worldCupData?.lineupMeta}
                    teamOptions={teamOptions}
                    teams={worldCupData?.teams}
                    rosters={worldCupData?.rosters ?? []}
                    lineupPlayerPhotos={worldCupData?.lineupPlayerPhotos}
                  />
                    </>
                  )}
                </div>

                <div className={`lg:hidden w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={4} />
                  ) : (
                  <WorldCupInsightsPanel
                    key={`${propsMode}-insights`}
                    isDark={isDark}
                    mode={propsMode}
                    selectedPlayer={selectedPlayer}
                    selectedTeam={activeTeam}
                    opponentTeam={opponentTeam}
                    teamOptions={teamOptions}
                    competition={competition}
                  />
                  )}
                </div>

                <div className={`lg:hidden w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={4} />
                  ) : (
                    <>
                      <SectionHeader title="Group standings" subtitle="Groups, points, goal difference, and qualification position." />
                      <EmptyState text="Group standings will load once the API key is connected." />
                    </>
                  )}
                </div>

                {propsMode === 'player' ? (
                  <div className={`lg:hidden w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4 pb-6`}>
                    {showInsightsSkeleton ? (
                      <WorldCupCardSkeleton isDark={isDark} rows={5} className="p-3" />
                    ) : (
                      <WorldCupPlayerVsTeamPanel
                        isDark={isDark}
                        selectedPlayer={selectedPlayer}
                        selectedPlayerId={selectedPlayerId}
                        selectedTeam={selectedTeam}
                        opponentTeam={opponentTeam}
                        playerMatchStats={worldCupData?.playerMatchStats ?? []}
                        matches={worldCupData?.matches ?? []}
                        playerMatches={worldCupData?.playerMatches ?? []}
                      />
                    )}
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

                <div className={`hidden lg:block h-[480px] w-full min-w-0 shrink-0 rounded-lg xl:h-[520px] ${DASH_CARD_GLOW} overflow-hidden`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} fill className="p-3 sm:p-4" />
                  ) : (
                  <WorldCupInsightsPanel
                    key={`${propsMode}-insights-desktop`}
                    isDark={isDark}
                    mode={propsMode}
                    selectedPlayer={selectedPlayer}
                    selectedTeam={activeTeam}
                    opponentTeam={opponentTeam}
                    teamOptions={teamOptions}
                    competition={competition}
                  />
                  )}
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={5} className="p-1" />
                  ) : propsMode === 'player' ? (
                    <WorldCupPlayerVsTeamPanel
                      isDark={isDark}
                      selectedPlayer={selectedPlayer}
                      selectedPlayerId={selectedPlayerId}
                      selectedTeam={selectedTeam}
                      opponentTeam={opponentTeam}
                      playerMatchStats={worldCupData?.playerMatchStats ?? []}
                      matches={worldCupData?.matches ?? []}
                      playerMatches={worldCupData?.playerMatches ?? []}
                    />
                  ) : (
                    <WorldCupTeamFormHomeAwayPanel
                      isDark={isDark}
                      selectedTeam={activeTeam}
                      opponentTeam={opponentTeam}
                      competition={competition}
                    />
                  )}
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={3} />
                  ) : propsMode === 'player' ? (
                    <>
                      <SectionHeader title="Player vs Player" center />
                      <WorldCupPlayerVsPlayerPanel
                        isDark={isDark}
                        selectedPlayer={selectedPlayer}
                        selectedPlayerId={selectedPlayerId}
                        playerMatchStats={worldCupData?.playerMatchStats ?? []}
                        matches={worldCupData?.matches ?? []}
                        playerMatches={worldCupData?.playerMatches ?? []}
                        rosters={worldCupData?.rosters ?? []}
                      />
                    </>
                  ) : (
                    <>
                      <SectionHeader title="Availability" subtitle="Tournament squads for both teams in the matchup." />
                      <WorldCupRosterPanel
                        isDark={isDark}
                        selectedTeam={activeTeam}
                        opponentTeam={opponentTeam}
                        rosters={worldCupData?.rosters ?? []}
                      />
                    </>
                  )}
                </div>

                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={3} />
                  ) : (
                    <>
                      <SectionHeader title="World Cup schedule" subtitle="Next 72 hours — teams, group, day, and kickoff time." />
                      <WorldCupSchedulePanel
                        isDark={isDark}
                        matches={worldCupData?.matches ?? []}
                      />
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
