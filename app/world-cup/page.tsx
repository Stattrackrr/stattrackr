'use client';

import { Suspense, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, Search } from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { useOddsFormat } from '@/app/nba/research/dashboard/hooks/useOddsFormat';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabaseClient';
import {
  buildWorldCupPlayerDashboardParams,
  buildWorldCupDashboardRequestKeyFromPage,
  consumeWorldCupDashboardPrefetch,
  fetchWorldCupDashboardJson,
  formatWorldCupPlayerDisplayName,
  loadWorldCupDashboardWithHandoff,
  readWorldCupDashboardLocalCache,
  readWorldCupPlayerOddsPrefetch,
  readPrefetchedWorldCupDashboardMem,
  worldCupDashboardRequestIdentityMatches,
  worldCupDashboardRequestKey,
} from '@/lib/worldCupPlayerAliases';
import { getWorldCupFlagUrl, resolveWorldCupFlagCode, resolveBestWorldCupFlagUrl, FIFA_NAME_TO_CODE, worldCupTeamsMatch } from '@/lib/worldCupFlags';
import { americanToDecimal, DEFAULT_ODDS_FORMAT } from '@/lib/currencyUtils';
import { getBookmakerInfo } from '@/lib/bookmakers';
import {
  propsPathForSport,
  WC_BACK_TO_PROPS_CLEAR_SEARCH_KEY,
  WC_BACK_TO_PROPS_SKIP_FETCH_KEY,
  WC_PROPS_RETURN_SPORT_KEY,
  WORLD_CUP_SELECTION_KEYS as WORLD_CUP_STORAGE_KEYS,
  clearLegacyWorldCupLocalStorage,
  clearWorldCupDashboardPersistence,
  worldCupSelectionStorage,
  type PropsSportMode,
} from '@/lib/nbaConstants';
import { ImpliedOddsWheel } from '@/app/nba/research/dashboard/components/odds/ImpliedOddsWheel';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import {
  calculateImpliedProbabilities,
  calculateWorldCupImpliedOdds,
  getAvailableWorldCupOddsLines,
  getOddsMarketForStat,
  getPrimaryOddsLineForStat,
  getWorldCupOddsLinesForStat,
  hasWorldCupOddsForTargetLine,
  parseWorldCupOddsLine,
  resolveWorldCupOddsLineForTarget,
  worldCupOddsLinesMatch,
  type WorldCupPlayerOddsBook,
} from '@/lib/impliedProbability';
const WC_URL_SPECIAL_LETTERS = new RegExp(
  '[\\u00f8\\u0153\\u00e6\\u00e5\\u00df\\u00fe\\u00f0\\u0111\\u0142\\u0131\\u014b\\u0138\\u02bb\']',
  'g'
);
const WC_URL_SPECIAL_LETTER_MAP: Record<string, string> = {
  '\u00f8': 'o',
  '\u0153': 'oe',
  '\u00e6': 'ae',
  '\u00e5': 'a',
  '\u00df': 'ss',
  '\u00fe': 'th',
  '\u00f0': 'd',
  '\u0111': 'd',
  '\u0142': 'l',
  '\u0131': 'i',
  '\u014b': 'n',
  '\u0138': 'k',
  '\u02bb': '',
  "'": '',
};

function normalizeWorldCupPlayerName(name: string): string {
  const folded = String(name || '')
    .toLowerCase()
    .replace(WC_URL_SPECIAL_LETTERS, (ch) => WC_URL_SPECIAL_LETTER_MAP[ch] ?? ch);
  return folded
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function worldCupPlayerNameToSlug(name: string): string {
  const normalized = normalizeWorldCupPlayerName(name);
  return normalized ? normalized.replace(/\s+/g, '-') : '';
}

function worldCupPlayerSlugToSearchHint(slug: string): string {
  return String(slug || '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function worldCupPlayerSlugMatchesName(slug: string, name: string): boolean {
  const target = worldCupPlayerNameToSlug(name);
  const raw = String(slug || '').trim().toLowerCase();
  if (!target || !raw) return false;
  if (target === raw) return true;
  return target.replace(/-/g, '') === raw.replace(/-/g, '');
}

function worldCupPlayerSlugFromPathname(pathname: string | null): string | null {
  const prefix = '/world-cup/player/';
  if (!pathname?.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length).split('/')[0] ?? '';
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

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
type PlayerComparisonTab = 'team' | 'player';
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
  /** Props-list position label (GK/DEF/MID/FWD) when opened from player props. */
  propsPositionLabel?: string | null;
};

type WorldCupDashboardData = {
  playerChartOnly?: boolean;
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
    selectedTeamId?: number | null;
    opponentTeamId?: number | null;
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
  /** WC 2026 opponent allowed averages for Player vs Team (never all-time). */
  wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse;
  /** Pre-warmed player pool for Player vs Team rankings (bundled on main dashboard load). */
  playerVsPool?: {
    players?: WorldCupPlayerPoolEntry[];
    opponentBreakdown?: WorldCupOppBreakdownResponse;
    wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse;
  };
  /** Full squad player match stats for the selected nation (bundled from team dashboard cache). */
  squadPlayerMatchStats?: Array<Record<string, any>>;
  /** WC history team match rows with scoreline-enriched goals (for Team Share panel). */
  teamWcMatchStats?: Array<Record<string, any>>;
  /** Pre-warmed DVP payloads (GK/DEF/MID/FWD × L5/L10/All) bundled on player dashboard load. */
  dvpBundles?: Record<string, WorldCupDvpResponse>;
};

function normalizeWorldCupDashboardData(data: Partial<WorldCupDashboardData>): WorldCupDashboardData {
  return {
    playerChartOnly: data.playerChartOnly,
    season: data.season ?? 2026,
    teams: data.teams ?? [],
    standings: data.standings ?? [],
    matches: data.matches ?? [],
    playerMatches: data.playerMatches,
    selectedTeam: data.selectedTeam ?? null,
    featureMatch: data.featureMatch ?? null,
    selectedTeamMatches: data.selectedTeamMatches ?? [],
    rosters: data.rosters ?? [],
    teamMatchStats: data.teamMatchStats ?? [],
    playerMatchStats: data.playerMatchStats ?? [],
    lineups: data.lineups ?? [],
    lineupMeta: data.lineupMeta,
    lineupPlayerPhotos: data.lineupPlayerPhotos,
    events: data.events ?? [],
    shots: data.shots ?? [],
    playerShots: data.playerShots,
    momentum: data.momentum ?? [],
    bestPlayers: data.bestPlayers ?? [],
    avgPositions: data.avgPositions ?? [],
    teamForm: data.teamForm ?? [],
    odds: data.odds ?? [],
    futures: data.futures ?? [],
    wc2026OpponentBreakdown: data.wc2026OpponentBreakdown,
    playerVsPool: data.playerVsPool,
    squadPlayerMatchStats: data.squadPlayerMatchStats,
    teamWcMatchStats: data.teamWcMatchStats,
    dvpBundles: data.dvpBundles,
  };
}

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
  { id: 'FWD', label: 'FWD', name: 'Forward' },
  { id: 'MID', label: 'MID', name: 'Midfielder' },
  { id: 'DEF', label: 'DEF', name: 'Defender' },
  { id: 'GK', label: 'GK', name: 'Goalkeeper' },
] as const;
type WorldCupDvpPosition = (typeof WORLD_CUP_DVP_POSITIONS)[number]['id'];
const WORLD_CUP_DVP_METRICS = [
  { key: 'goals', label: 'Goals vs ' },
  { key: 'assists', label: 'Assists vs ' },
  { key: 'shots_total', label: 'Shots vs ' },
  { key: 'shots_on_target', label: 'Shots on Target vs ' },
  { key: 'passes_accurate', label: 'Passes vs ' },
  { key: 'yellow_cards', label: 'Yellow Cards vs ' },
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
/** Game Props main stat pill order (first three shown when available). */
const GAME_PROPS_STAT_PRIORITY = ['moneyline', 'goals', 'total_shots'] as const;
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

const WC_BAR_ANIMATION_MS = 180;

function worldCupChartContextEqual(a: WorldCupChartContext, b: WorldCupChartContext): boolean {
  return (
    a.statId === b.statId &&
    a.statKey === b.statKey &&
    a.statLabel === b.statLabel &&
    a.timeframe === b.timeframe
  );
}

function worldCupOpponentTeamEqual(
  a: WorldCupTeamOption | null,
  b: WorldCupTeamOption | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.abbreviation === b.abbreviation &&
    (a.countryCode ?? '') === (b.countryCode ?? '')
  );
}

function worldCupSupportingDataFingerprint(data: WorldCupDashboardData | null): string {
  if (!data) return 'null';
  const sampleStat = (row: Record<string, any>) =>
    ['goals', 'assists', 'passes_accurate', 'shots_total', 'minutes']
      .map((key) => row[key] ?? '')
      .join(':');
  const playerRows = data.playerMatchStats ?? [];
  const teamRows = data.teamMatchStats ?? [];
  const playerSample = playerRows
    .slice(-5)
    .map((row) => `${row.match_id}|${row.player_id ?? ''}|${sampleStat(row)}`)
    .join(';');
  const teamSample = teamRows
    .slice(-5)
    .map((row) => `${row.match_id}|${row.team_id ?? ''}|${sampleStat(row)}`)
    .join(';');
  return [
    playerRows.length,
    teamRows.length,
    data.matches?.length ?? 0,
    data.playerMatches?.length ?? 0,
    data.teams?.length ?? 0,
    playerSample,
    teamSample,
  ].join('#');
}

// Canonical 4-way position group used across player props (search, rosters, and
// Defense vs Position). Mirrors classifyIntlPositionString in
// lib/internationalDashboard.ts so BDL roster labels and the historical
// match-stat labels agree on every player.
type WorldCupPositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD';

/**
 * Classify a raw position string (BDL roster codes, full descriptors, or
 * abbreviations) into GK/DEF/MID/FWD, or null when unrecognized. Order matters:
 * GK -> DEF (so "wing back" stays DEF) -> FWD wide codes (RM/LM/RW/LW) ->
 * MID (so "attacking/defensive midfielder" stays MID) -> FWD descriptors.
 */
function classifyWorldCupPositionGroup(value: string | null | undefined): WorldCupPositionGroup | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === 'fifa') return null;
  if (raw === 'g' || raw === 'gk') return 'GK';
  if (raw === 'd' || raw === 'def') return 'DEF';
  if (raw === 'm' || raw === 'mid') return 'MID';
  if (raw === 'f' || raw === 'fwd' || raw === 'att' || raw === 'w') return 'FWD';
  if (/goalkeep|goalie|keeper|portero/.test(raw) || raw === 'gk') return 'GK';
  if (
    /back|defender|defence|defense|sweeper|fullback|full-back|\bcb\b|\blb\b|\brb\b|\bwb\b|\blwb\b|\brwb\b|\brcb\b|\blcb\b/.test(
      raw
    )
  )
    return 'DEF';
  if (
    /^(rw|lw|rm|lm|fw|lf|rf|wg|win)$/.test(raw) ||
    /\b(right|left)\s+wing(?:er)?\b/.test(raw) ||
    /\bwinger\b/.test(raw)
  )
    return 'FWD';
  if (
    /midfield|\bmid\b|\bcm\b|\bdm\b|\bam\b|\bcdm\b|\bcam\b|\bdmf\b|\bamf\b|\bmc\b|\brcm\b|\blcm\b|\bmf\b/.test(
      raw
    )
  )
    return 'MID';
  if (
    /forward|striker|wing|attacker|attack|\bcf\b|\bst\b|\bss\b|\blw\b|\brw\b|\bfw\b|\bfwd\b|\batt\b|centre forward|center forward/.test(
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
    fwd: 'Forward',
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

function formatWorldCupPlayerRole(player: WorldCupPlayerOption | null | undefined): string {
  if (!player) return '';
  if (classifyWorldCupPositionGroup(player.role)) return formatWorldCupRole(player.role);
  return formatWorldCupRole(player.positionGroup ?? getWorldCupPlayerGroup(player));
}

function formatWorldCupPropsPositionLabel(player: WorldCupPlayerOption | null | undefined): string {
  const fromProps = String(player?.propsPositionLabel || '').trim().toUpperCase();
  if (fromProps && classifyWorldCupPositionGroup(fromProps)) return fromProps;
  if (!player) return '';
  const role = String(player.role || '').trim().toUpperCase();
  if (classifyWorldCupPositionGroup(role) && ['GK', 'DEF', 'MID', 'FWD'].includes(role)) return role;
  return player.positionGroup ?? getWorldCupPlayerGroup(player);
}

function worldCupPlayerOptionFromPositionLabel(position: string | null | undefined): {
  role: string;
  positionGroup: WorldCupPositionGroup;
  propsPositionLabel: string | null;
} {
  const label = String(position || '').trim();
  if (!label) {
    return { role: 'MID', positionGroup: 'MID', propsPositionLabel: 'MID' };
  }
  const positionGroup = resolveWorldCupPlayerGroup(label);
  const bucket = classifyWorldCupPositionGroup(label);
  const propsPositionLabel = bucket ? label.toUpperCase() : positionGroup;
  const role = bucket
    ? ['GK', 'DEF', 'MID', 'FWD'].includes(label.toUpperCase())
      ? label.toUpperCase()
      : label
    : positionGroup;
  return { role, positionGroup, propsPositionLabel };
}

function applyWorldCupPropsPositionLabel(
  player: WorldCupPlayerOption,
  positionLabel: string | null | undefined
): WorldCupPlayerOption {
  const label = String(positionLabel || '').trim();
  if (!label) return player;
  const applied = worldCupPlayerOptionFromPositionLabel(label);
  return {
    ...player,
    role: applied.role,
    positionGroup: applied.positionGroup,
    propsPositionLabel: applied.propsPositionLabel,
  };
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

function resolveWorldCupTeamByName(
  name: string | null | undefined,
  teamOptions: WorldCupTeamOption[]
): WorldCupTeamOption | null {
  const label = String(name || '').trim();
  if (!label || !teamOptions.length) return null;
  return (
    teamOptions.find((team) => worldCupTeamsMatch(team.name, label)) ??
    teamOptions.find((team) => worldCupTeamsMatch(team.abbreviation, label)) ??
    teamOptions.find((team) => worldCupTeamsMatch(team.countryCode || '', label)) ??
    null
  );
}

function resolveWorldCupTeamFromUrl(
  teamOptions: WorldCupTeamOption[],
  urlTeamId: string | null,
  urlTeamName: string | null
): WorldCupTeamOption | null {
  if (urlTeamId && /^\d+$/.test(urlTeamId)) {
    const fromId = teamOptions.find((option) => option.id === urlTeamId);
    if (fromId) return fromId;
    if (urlTeamName) return worldCupTeamPlaceholderFromName(urlTeamName, urlTeamId);
  }
  if (urlTeamName) {
    return (
      resolveWorldCupTeamByName(urlTeamName, teamOptions) ?? worldCupTeamPlaceholderFromName(urlTeamName)
    );
  }
  return null;
}

function normalizeWorldCupStatFromUrl(stat: string): (typeof WORLD_CUP_STAT_OPTIONS)[number]['id'] {
  const value = String(stat || '').trim().toLowerCase();
  if (!value) return 'goals';
  if (value === 'anytime_goal_scorer' || value === 'anytime_goals' || value === 'goals_anytime') return 'goals';
  if (value === 'goals' || value === 'goals_over') return 'goals';
  if (value === 'assists' || value === 'assists_over') return 'assists';
  if (value === 'shots_on_target' || value === 'sot' || value === 'shots_on_target_over') return 'shots_on_target';
  if (value === 'total_shots' || value === 'shots' || value === 'shots_total' || value === 'shots_over') return 'total_shots';
  if (value === 'fouls_committed' || value === 'fouls') return 'fouls_committed';
  if (value === 'yellow_cards' || value === 'to_be_booked' || value === 'cards') return 'yellow_cards';
  const direct = WORLD_CUP_STAT_OPTIONS.find((option) => option.id === value);
  return direct?.id ?? 'goals';
}

function chartContextFromStatParam(stat: string, timeframe: WorldCupChartTimeframe = 'last10'): WorldCupChartContext {
  const statId = normalizeWorldCupStatFromUrl(stat);
  const config = getChartStatConfig('player', statId);
  return {
    statId,
    statKey: config.playerKey ?? config.teamKey ?? String(statId),
    statLabel: config.label,
    timeframe,
  };
}

function resolveWorldCupPlayerOddsMatchup(input: {
  urlTeamQuery: string | null;
  urlOpponentQuery: string | null;
  urlMatchDateQuery: string | null;
  activeTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  selectedPlayer: WorldCupPlayerOption | null;
  fixtureOpponentName: string | null;
  featureMatchDatetime?: string | null;
}): { homeName: string; awayName: string; matchDate: string } {
  const homeName =
    input.urlTeamQuery ||
    input.selectedPlayer?.teamName ||
    input.activeTeam?.name ||
    '';
  const awayName =
    input.urlOpponentQuery ||
    input.fixtureOpponentName ||
    input.opponentTeam?.name ||
    '';
  const matchDate =
    input.urlMatchDateQuery ||
    (input.featureMatchDatetime ? String(input.featureMatchDatetime) : '');
  return { homeName, awayName, matchDate };
}

function buildWorldCupPlayerDeepLinkQuery(params: {
  playerId?: string | null;
  team?: string | null;
  teamId?: string | null;
  opponent?: string | null;
  opponentTeamId?: string | null;
  stat?: string | null;
  line?: string | null;
  bookmaker?: string | null;
  position?: string | null;
  matchDate?: string | null;
}): string {
  const qs = new URLSearchParams();
  const numericPlayerId = String(params.playerId || '').trim();
  if (/^\d+$/.test(numericPlayerId)) qs.set('playerId', numericPlayerId);
  if (params.team?.trim()) qs.set('team', params.team.trim());
  const numericTeamId = String(params.teamId || '').trim();
  if (/^\d+$/.test(numericTeamId)) qs.set('teamId', numericTeamId);
  if (params.opponent?.trim()) qs.set('opponent', params.opponent.trim());
  const numericOpponentTeamId = String(params.opponentTeamId || '').trim();
  if (/^\d+$/.test(numericOpponentTeamId)) qs.set('opponentTeamId', numericOpponentTeamId);
  if (params.stat?.trim()) qs.set('stat', params.stat.trim());
  if (params.line?.trim()) qs.set('line', params.line.trim());
  if (params.bookmaker?.trim()) qs.set('bookmaker', params.bookmaker.trim());
  if (params.position?.trim()) qs.set('position', params.position.trim());
  if (params.matchDate?.trim()) qs.set('matchDate', params.matchDate.trim());
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : '';
}

function worldCupStableUrlPlayerKey(urlPlayerSlug: string | null, urlPlayerQuery: string | null): string {
  const slug = urlPlayerSlug?.trim().toLowerCase() ?? '';
  const query = urlPlayerQuery ? normalizeWorldCupPlayerName(urlPlayerQuery) : '';
  return [slug, query].filter(Boolean).join('|');
}

function mapWorldCupApiPlayerRow(
  player: Record<string, unknown>,
  teamOptions: WorldCupTeamOption[]
): WorldCupPlayerOption {
  const name = formatWorldCupPlayerDisplayName(String(player.name || player.short_name || 'World Cup Player'));
  const parts = name.split(/\s+/).filter(Boolean);
  const countryName = String(player.country_name || player.country_code || 'World Cup');
  const countryCode = String(player.country_code || '').trim() || null;
  const rawPosition = String(player.position || '').trim();
  const positionGroup = resolveWorldCupPlayerGroup(rawPosition);
  const draft: WorldCupPlayerOption = {
    id: String(player.id ?? name),
    name,
    shortName: String(player.short_name || `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` || 'WC').slice(0, 3).toUpperCase(),
    teamName: countryName,
    teamId: null,
    countryCode,
    number: String(player.jersey_number || ''),
    role: classifyWorldCupPositionGroup(rawPosition) ? rawPosition : positionGroup,
    positionGroup,
    club: String(player.club || player.club_name || player.current_club || '').trim() || null,
  };
  const matchedTeam = resolveWorldCupTeamForPlayer(draft, teamOptions);
  return {
    ...draft,
    teamName: matchedTeam?.name || countryName,
    teamId: matchedTeam?.id || null,
  };
}

function worldCupPlayerPlaceholderFromHint(
  hint: string,
  id?: string | null,
  positionLabel?: string | null
): WorldCupPlayerOption {
  const name = formatWorldCupPlayerDisplayName(hint.trim());
  const parts = name.split(/\s+/).filter(Boolean);
  const position = worldCupPlayerOptionFromPositionLabel(positionLabel);
  return {
    id: id || worldCupPlayerNameToSlug(name) || 'url-player',
    name,
    shortName: `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.slice(0, 3).toUpperCase() || 'WC',
    teamName: 'World Cup',
    teamId: null,
    countryCode: null,
    number: '',
    role: position.role,
    positionGroup: position.positionGroup,
    propsPositionLabel: position.propsPositionLabel,
    club: null,
  };
}

type WorldCupPropsHandoff = {
  name?: string;
  playerId?: string;
  team?: string;
  teamId?: string;
  opponent?: string;
  opponentTeamId?: string;
  stat?: string;
  line?: number;
  bookmaker?: string;
  matchDate?: string;
  position?: string | null;
};

function parseWorldCupPropsHandoff(raw: string | null): WorldCupPropsHandoff | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorldCupPropsHandoff;
  } catch {
    return null;
  }
}

function worldCupTeamPlaceholderFromName(teamName: string, teamId?: string | null): WorldCupTeamOption {
  const name = teamName.trim();
  const parsedTeamId = String(teamId || '').trim();
  const id = /^\d+$/.test(parsedTeamId) ? parsedTeamId : name.toLowerCase().replace(/\s+/g, '-');
  return {
    id,
    name,
    abbreviation: name.slice(0, 3).toUpperCase(),
    countryCode: resolveWorldCupFlagCode(name) || null,
    group: 'World Cup',
    confederation: 'FIFA',
  };
}

function resolveWorldCupTeamFromHandoff(
  parsed: WorldCupPropsHandoff,
  teamOptions: WorldCupTeamOption[]
): WorldCupTeamOption | null {
  const teamName = String(parsed.team || '').trim();
  if (!teamName) return null;
  const parsedTeamId = String(parsed.teamId || '').trim();
  if (/^\d+$/.test(parsedTeamId)) {
    return teamOptions.find((option) => option.id === parsedTeamId) ?? worldCupTeamPlaceholderFromName(teamName, parsedTeamId);
  }
  if (teamOptions.length) {
    return resolveWorldCupTeamByName(teamName, teamOptions) ?? worldCupTeamPlaceholderFromName(teamName);
  }
  return worldCupTeamPlaceholderFromName(teamName);
}

function buildWorldCupPlayerFromHandoff(parsed: WorldCupPropsHandoff): WorldCupPlayerOption | null {
  const name = String(parsed.name || '').trim();
  if (!name) return null;
  const parsedPlayerId = String(parsed.playerId || '').trim();
  const parsedTeamId = String(parsed.teamId || '').trim();
  const handoffPosition = String(parsed.position || '').trim();
  const position = worldCupPlayerOptionFromPositionLabel(handoffPosition);
  if (!/^\d+$/.test(parsedPlayerId)) {
    return worldCupPlayerPlaceholderFromHint(name, null, handoffPosition);
  }
  return {
    id: parsedPlayerId,
    name: formatWorldCupPlayerDisplayName(name),
    shortName:
      name
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0])
        .join('')
        .slice(0, 3)
        .toUpperCase() || 'WC',
    teamName: parsed.team || 'World Cup',
    teamId: /^\d+$/.test(parsedTeamId) ? parsedTeamId : null,
    countryCode: parsed.team ? resolveWorldCupFlagCode(parsed.team) || null : null,
    number: '',
    role: position.role,
    positionGroup: position.positionGroup,
    propsPositionLabel: position.propsPositionLabel,
    club: null,
  };
}

function tryApplyWorldCupDashboardPrefetchFromHandoff(
  parsed: WorldCupPropsHandoff,
  setWorldCupData: (value: WorldCupDashboardData | null) => void,
  loadedDashboardKeyRef: MutableRefObject<string | null>
): boolean {
  const playerName = String(parsed.name || '').trim();
  if (!playerName) return false;
  const params = buildWorldCupPlayerDashboardParams({
    playerName,
    playerId: /^\d+$/.test(String(parsed.playerId || '')) ? String(parsed.playerId) : null,
    teamId: /^\d+$/.test(String(parsed.teamId || '')) ? String(parsed.teamId) : null,
    teamName: parsed.team || null,
    opponentTeamId: /^\d+$/.test(String(parsed.opponentTeamId || '')) ? String(parsed.opponentTeamId) : null,
    opponentTeamName: parsed.opponent || null,
    competition: 'all',
  });
  const prefetched = consumeWorldCupDashboardPrefetch<WorldCupDashboardData>(
    worldCupDashboardRequestKey(params)
  );
  if (!prefetched) return false;
  setWorldCupData(prefetched);
  loadedDashboardKeyRef.current = buildWorldCupDashboardKey(
    'player',
    /^\d+$/.test(String(parsed.teamId || '')) ? String(parsed.teamId) : null,
    /^\d+$/.test(String(parsed.playerId || '')) ? String(parsed.playerId) : null
  );
  return true;
}

function applyWorldCupPropsHandoffState(
  parsed: WorldCupPropsHandoff,
  teamOptions: WorldCupTeamOption[],
  setters: {
    setFixtureOpponentName: (value: string | null) => void;
    setChartContext: Dispatch<SetStateAction<WorldCupChartContext>>;
    setWcCurrentLineValue: (value: number) => void;
    setSelectedTeam: (value: WorldCupTeamOption | null) => void;
    setTeamSearchQuery: (value: string) => void;
    setPropsMode: (value: PropsMode) => void;
    setSelectedPlayer: (value: WorldCupPlayerOption | null) => void;
    setCompetition: (value: Competition) => void;
    setWorldCupData: (value: WorldCupDashboardData | null) => void;
  },
  refs: {
    propsHandoffPositionRef: MutableRefObject<string | null>;
    preferredWcBookmakerRef: MutableRefObject<string | null>;
    hasIncomingWcBookOrLineRef: MutableRefObject<boolean>;
    urlPlayerResolvedRef: MutableRefObject<boolean>;
    previousCompetition: MutableRefObject<Competition | null>;
    loadedDashboardKeyRef: MutableRefObject<string | null>;
  }
): boolean {
  if (parsed.opponent) setters.setFixtureOpponentName(parsed.opponent);
  if (parsed.stat) {
    setters.setChartContext((prev) => chartContextFromStatParam(parsed.stat!, prev.timeframe));
  }
  if (parsed.line != null && Number.isFinite(Number(parsed.line))) {
    refs.hasIncomingWcBookOrLineRef.current = true;
    setters.setWcCurrentLineValue(Number(parsed.line));
  }
  if (parsed.bookmaker) {
    refs.preferredWcBookmakerRef.current = parsed.bookmaker;
    refs.hasIncomingWcBookOrLineRef.current = true;
  }
  setters.setCompetition('all');
  refs.previousCompetition.current = 'all';
  const team = resolveWorldCupTeamFromHandoff(parsed, teamOptions);
  if (team) {
    setters.setSelectedTeam(team);
    setters.setTeamSearchQuery('');
  }
  const player = buildWorldCupPlayerFromHandoff(parsed);
  if (!player) return false;
  refs.propsHandoffPositionRef.current = String(parsed.position || '').trim() || null;
  setters.setPropsMode('player');
  setters.setSelectedPlayer(player);
  if (/^\d+$/.test(player.id)) {
    refs.urlPlayerResolvedRef.current = true;
  }
  tryApplyWorldCupDashboardPrefetchFromHandoff(parsed, setters.setWorldCupData, refs.loadedDashboardKeyRef);
  return true;
}

function worldCupPlayerMatchesUrlTarget(
  player: WorldCupPlayerOption | null,
  opts: { slug: string | null; query: string | null; playerId: string | null }
): boolean {
  if (!player?.name || !/^\d+$/.test(player.id)) return false;
  if (opts.playerId && player.id === opts.playerId) return true;
  if (opts.slug && worldCupPlayerSlugMatchesName(opts.slug, player.name)) return true;
  if (opts.query && normalizeWorldCupPlayerName(player.name) === normalizeWorldCupPlayerName(opts.query)) return true;
  return false;
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

/** Game Props needs the full cross-competition team history, not a single WC row. */
function countTeamGamePropsRows(data: WorldCupDashboardData, teamId: string): number {
  return (data.teamMatchStats ?? []).filter((row) => String(row.team_id ?? '') === teamId).length;
}

function hasFullTeamGamePropsData(data: WorldCupDashboardData, teamId: string): boolean {
  const rows = (data.teamMatchStats ?? []).filter((row) => String(row.team_id ?? '') === teamId);
  if (!rows.length) return false;
  const hasIntl = rows.some((row) => {
    const src = String(row.source ?? '').toLowerCase();
    return Boolean(src && src !== 'bdl');
  });
  return hasIntl || rows.length >= 5;
}

function hasFullPlayerPropsData(
  data: WorldCupDashboardData,
  playerId: string,
  playerName?: string | null
): boolean {
  const rows = resolvePlayerScopedStatRows(data.playerMatchStats ?? [], playerId, playerName ?? null);
  if (!rows.length) return false;
  const hasIntl = rows.some((row) => {
    const src = String(row.source ?? '').toLowerCase();
    return Boolean(src && src !== 'bdl');
  });
  const hasClub = rows.some((row) => {
    const slug = String(row.tournament_slug ?? '').toLowerCase();
    return slug.startsWith('club');
  });
  const bdlWcRows = rows.filter((row) => {
    const src = String(row.source ?? '').toLowerCase();
    const slug = String(row.tournament_slug ?? '').toLowerCase();
    return src === 'bdl' || slug === 'worldcup' || slug === 'world-cup';
  });
  // WC-only players may have 1–3 finals games; do not force endless refetch.
  return hasIntl || hasClub || bdlWcRows.length > 0 || rows.length >= 8;
}

function hasFullPlayerDashboardPanelData(data: WorldCupDashboardData | null | undefined): boolean {
  if (!data || data.playerChartOnly) return false;
  return Boolean(
    (data.rosters?.length ?? 0) > 0 ||
    (data.squadPlayerMatchStats?.length ?? 0) > 0 ||
    (data.playerVsPool?.players?.length ?? 0) > 0 ||
    data.wc2026OpponentBreakdown
  );
}

function normalizeWorldCupPlayerNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function resolvePlayerScopedStatRows(
  rows: Array<Record<string, any>>,
  playerId: string | null,
  playerName: string | null
): Array<Record<string, any>> {
  const withAppearance = rows.filter((row) => hasWorldCupPlayerAppearance(row));
  if (!playerId && !playerName) return withAppearance;

  if (playerId) {
    const byId = withAppearance.filter(
      (row) => String(row.player_id ?? row.player?.id ?? '') === playerId
    );
    if (byId.length) return byId;
  }

  const normTarget = playerName ? normalizeWorldCupPlayerNameForMatch(playerName) : null;
  if (normTarget) {
    const byName = withAppearance.filter((row) => {
      const rowName = String(row.player_name ?? row.player?.name ?? row.player?.short_name ?? '');
      return Boolean(rowName && normalizeWorldCupPlayerNameForMatch(rowName) === normTarget);
    });
    if (byName.length) return byName;
  }

  // Player dashboard responses are already scoped to one player.
  return withAppearance;
}

function worldCupStatRowMergeKey(row: Record<string, any>): string {
  const matchId = String(row.match_id ?? row.source_match_id ?? '').trim();
  if (!matchId) return '';
  const playerId = String(row.player_id ?? row.player?.id ?? '').trim();
  return playerId ? `${playerId}|${matchId}` : matchId;
}

function worldCupStatRowRichness(row: Record<string, any>): number {
  let score = 0;
  for (const value of Object.values(row)) {
    if (value != null && value !== '') score += 1;
  }
  return score;
}

function mergeWorldCupPlayerStatRows(
  ...groups: Array<Array<Record<string, any>>>
): Array<Record<string, any>> {
  const byKey = new Map<string, Record<string, any>>();
  for (const rows of groups) {
    for (const row of rows) {
      const key = worldCupStatRowMergeKey(row);
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing || worldCupStatRowRichness(row) >= worldCupStatRowRichness(existing)) {
        byKey.set(key, row);
      }
    }
  }
  return Array.from(byKey.values());
}

function worldCupStatRowDateKey(row: Record<string, any>, match: Record<string, any> | undefined): string {
  const raw = match?.datetime ?? row.match_date ?? row.date ?? row.game_date;
  if (raw) {
    const ms = Date.parse(String(raw));
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  return String(row.match_id ?? row.source_match_id ?? '').trim();
}

function worldCupChartGameIdentityKey(
  row: Record<string, any>,
  match: Record<string, any> | undefined,
  selectedTeamName: string | null,
  opponentLabel: string,
  competitionTag: WorldCupCompetitionTag
): string {
  const nation = String(selectedTeamName ?? '').trim().toLowerCase();
  const opponent = String(opponentLabel || row.opponent || row.opponent_name || '').trim().toLowerCase();
  const dateKey = worldCupStatRowDateKey(row, match);
  if (!dateKey || !opponent || opponent === 'opponent') return worldCupStatRowMergeKey(row);
  const compGroup = worldCupCompetitionChartGroup(competitionTag);
  return `${compGroup}|${dateKey}|${nation}|${opponent}`;
}

function scoreWorldCupStatRowForDedupe(
  row: Record<string, any>,
  match: Record<string, any> | undefined,
  selectedTeamId: string | null,
  selectedTeamName: string | null
): number {
  let score = worldCupStatRowRichness(row);
  const source = String(row.source ?? '').trim().toLowerCase();
  if (source === 'bdl') score += 200;
  else if (source === 'api-football' || source === 'statsbomb') score += 100;
  if (match && worldCupStatRowTeamInMatch(row, match, selectedTeamId, selectedTeamName)) score += 150;
  if (getWorldCupStatNumber(row, 'goals') != null) score += 20;
  if (getWorldCupStatNumber(row, 'minutes_played') != null) score += 10;
  return score;
}

function dedupeWorldCupPlayerStatRowsByGame(
  rows: Array<Record<string, any>>,
  matches: Array<Record<string, any>>,
  playerMatches: Array<Record<string, any>>,
  selectedTeamId: string | null,
  selectedTeamName: string | null
): Array<Record<string, any>> {
  if (!rows.length) return rows;
  const countryLookup = buildWorldCupTeamCountryLookup([]);
  const matchForRow = (row: Record<string, any>) =>
    resolveWorldCupMatchForStatRow(row, matches, playerMatches, selectedTeamId, selectedTeamName);
  const byGame = new Map<string, Record<string, any>>();
  const scoreForRow = (row: Record<string, any>) =>
    scoreWorldCupStatRowForDedupe(row, matchForRow(row), selectedTeamId, selectedTeamName);

  for (const row of rows) {
    const match = matchForRow(row);
    const { opponentLabel } = resolveWorldCupPlayerChartContext(
      row,
      match,
      selectedTeamId,
      countryLookup,
      selectedTeamName
    );
    if (selectedTeamName && worldCupTeamsMatch(selectedTeamName, opponentLabel)) continue;
    const competitionTag = deriveWorldCupCompetitionTag(row, match);
    const identityKey = worldCupChartGameIdentityKey(
      row,
      match,
      selectedTeamName,
      opponentLabel,
      competitionTag
    );
    if (!identityKey) continue;
    const existing = byGame.get(identityKey);
    if (!existing || scoreForRow(row) >= scoreForRow(existing)) {
      byGame.set(identityKey, row);
    }
  }
  return byGame.size ? Array.from(byGame.values()) : rows;
}

function mergeWorldCupMatchRows(...groups: Array<Array<Record<string, any>>>): Array<Record<string, any>> {
  const byId = new Map<string, Record<string, any>>();
  const add = (match: Record<string, any>) => {
    for (const rawId of [match.id, match.source_match_id, match.match_id]) {
      const id = String(rawId ?? '').trim();
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing || worldCupMatchRichness(match) >= worldCupMatchRichness(existing)) {
        byId.set(id, match);
      }
    }
  };
  for (const group of groups) {
    for (const match of group) add(match);
  }
  return Array.from(byId.values());
}

function mergeWorldCupDashboardPayload(
  prev: WorldCupDashboardData | null,
  next: Partial<WorldCupDashboardData>
): WorldCupDashboardData {
  const normalizedNext = normalizeWorldCupDashboardData(next);
  if (!prev) return normalizedNext;

  const mergedPlayerStats = mergeWorldCupPlayerStatRows(
    prev.playerMatchStats ?? [],
    normalizedNext.playerMatchStats ?? []
  );
  const mergedMatches = mergeWorldCupMatchRows(prev.matches ?? [], normalizedNext.matches ?? []);
  const mergedPlayerMatches = mergeWorldCupMatchRows(
    prev.playerMatches ?? [],
    normalizedNext.playerMatches ?? [],
    normalizedNext.matches ?? []
  );

  const panelDataReady = hasFullPlayerDashboardPanelData(normalizedNext);

  return normalizeWorldCupDashboardData({
    ...prev,
    ...normalizedNext,
    playerChartOnly: panelDataReady ? undefined : normalizedNext.playerChartOnly ?? prev.playerChartOnly,
    playerMatchStats: mergedPlayerStats,
    matches: mergedMatches,
    playerMatches: mergedPlayerMatches,
    teamMatchStats:
      (normalizedNext.teamMatchStats?.length ?? 0) > 0
        ? normalizedNext.teamMatchStats
        : prev.teamMatchStats,
    rosters: (normalizedNext.rosters?.length ?? 0) > 0 ? normalizedNext.rosters : prev.rosters,
    squadPlayerMatchStats:
      (normalizedNext.squadPlayerMatchStats?.length ?? 0) > 0
        ? normalizedNext.squadPlayerMatchStats
        : prev.squadPlayerMatchStats,
    teamWcMatchStats:
      (normalizedNext.teamWcMatchStats?.length ?? 0) > 0
        ? normalizedNext.teamWcMatchStats
        : prev.teamWcMatchStats,
    playerVsPool: normalizedNext.playerVsPool ?? prev.playerVsPool,
    wc2026OpponentBreakdown: normalizedNext.wc2026OpponentBreakdown ?? prev.wc2026OpponentBreakdown,
    dvpBundles: normalizedNext.dvpBundles ?? prev.dvpBundles,
    lineups: (normalizedNext.lineups?.length ?? 0) > 0 ? normalizedNext.lineups : prev.lineups,
    lineupMeta: normalizedNext.lineupMeta ?? prev.lineupMeta,
    lineupPlayerPhotos: normalizedNext.lineupPlayerPhotos ?? prev.lineupPlayerPhotos,
  });
}

function buildWorldCupDashboardKey(
  mode: PropsMode,
  teamId: string | null,
  playerId: string | null
): string | null {
  if (!teamId || !/^\d+$/.test(teamId)) return null;
  if (mode === 'player') {
    if (!playerId || !/^\d+$/.test(playerId)) return null;
    return `player:${teamId}:${playerId}`;
  }
  return `team:${teamId}`;
}

/** Skip a dashboard round-trip when the cached payload matches mode + selection. */
function canReuseWorldCupDashboard(
  data: WorldCupDashboardData | null,
  mode: PropsMode,
  teamId: string | null,
  playerId: string | null,
  loadedKey: string | null
): boolean {
  const expectedKey = buildWorldCupDashboardKey(mode, teamId, playerId);
  if (!data || !expectedKey || !teamId || loadedKey !== expectedKey) return false;

  const payloadTeamId = data.selectedTeam?.id != null ? String(data.selectedTeam.id) : null;
  if (payloadTeamId && payloadTeamId !== teamId) return false;

  const teamRowCount = countTeamGamePropsRows(data, teamId);
  if (teamRowCount === 0) return false;

  if (mode === 'team') {
    return hasFullTeamGamePropsData(data, teamId);
  }

  if (!playerId || !/^\d+$/.test(playerId)) return false;
  if (data.playerChartOnly) return false;
  return hasFullPlayerPropsData(data, playerId) && hasFullPlayerDashboardPanelData(data);
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
  if (key === 'fouls_committed') {
    const fouls = toNumber(row.fouls);
    if (fouls != null) return fouls;
  }
  if (key === 'was_fouled') {
    const foulsDrawn = toNumber(row.fouls_drawn ?? row.fouls_suffered);
    if (foulsDrawn != null) return foulsDrawn;
  }
  return ZERO_DEFAULT_STAT_KEYS.has(key) ? 0 : null;
}

/** Team Game Props: match scoreline backs goals when team_match_stats omits them (common on sparse WC rows). */
function resolveWorldCupTeamStatValue(
  row: Record<string, any>,
  match: Record<string, any> | null | undefined,
  statKey: string,
  perspective: WorldCupStatPerspective = 'team'
): number | null {
  const isHome = row.is_home === true;
  const teamScore = isHome
    ? toNumber(match?.homeScore ?? match?.home_score)
    : toNumber(match?.awayScore ?? match?.away_score);
  const opponentScore = isHome
    ? toNumber(match?.awayScore ?? match?.away_score)
    : toNumber(match?.homeScore ?? match?.home_score);

  const readKey = (key: string): number | null => {
    const parsed = toNumber(row[key]);
    if (parsed != null) return parsed;
    return ZERO_DEFAULT_STAT_KEYS.has(key) ? 0 : null;
  };
  const readGoals = (key: 'goals' | 'opp_goals', scoreFallback: number | null | undefined): number => {
    const parsed = toNumber(row[key]);
    if (parsed != null) return parsed;
    if (scoreFallback != null) return scoreFallback;
    return 0;
  };

  if (perspective === 'opponent') {
    if (statKey === 'goals') return readGoals('opp_goals', opponentScore);
    return readKey(`opp_${statKey}`);
  }
  if (perspective === 'all' && !WORLD_CUP_NO_ALL_PERSPECTIVE_STAT_KEYS.has(statKey)) {
    if (statKey === 'goals') {
      return readGoals('goals', teamScore) + readGoals('opp_goals', opponentScore);
    }
    const own = readKey(statKey);
    const opp = readKey(`opp_${statKey}`);
    if (own == null && opp == null) return null;
    return (own ?? 0) + (opp ?? 0);
  }
  if (statKey === 'goals') return readGoals('goals', teamScore);
  return readKey(statKey);
}

function hasWorldCupPlayerAppearance(row: Record<string, any>): boolean {
  const minutes = getWorldCupStatNumber(row, 'minutes_played');
  if (minutes != null) return minutes >= 1;

  const source = String(row.source ?? '').toLowerCase();
  const tournament = String(row.tournament_slug ?? '').toLowerCase();
  if (!source && !tournament) return false;

  return [
    'goals',
    'assists',
    'shots_total',
    'shots_on_target',
    'passes_accurate',
    'passes_total',
    'tackles',
    'fouls_committed',
    'fouls_suffered',
    'yellow_cards',
    'red_cards',
  ].some((key) => getWorldCupStatNumber(row, key) != null);
}

const WORLD_CUP_PLAYER_VS_PLAYER_MIN_MINUTES = 5;
const WORLD_CUP_PLAYER_VS_PLAYER_MIN_GAMES_SELECTABLE = 1;
const WORLD_CUP_PLAYER_VS_PLAYER_MIN_GAMES_DEFAULT = 5;

function hasPlayerVsPlayerQualifyingGame(row: Record<string, any>): boolean {
  const minutes = getWorldCupStatNumber(row, 'minutes_played');
  return minutes != null && minutes >= WORLD_CUP_PLAYER_VS_PLAYER_MIN_MINUTES;
}

function buildPlayerVsPlayerSquadProfile(rows: Array<Record<string, any>>): {
  minutesByPlayer: Map<string, number>;
  gamesByPlayer: Map<string, number>;
} {
  const minutesByPlayer = new Map<string, number>();
  const gamesByPlayer = new Map<string, number>();
  for (const row of rows) {
    const pid = String(row.player_id ?? row.player?.id ?? '');
    if (!pid || !hasPlayerVsPlayerQualifyingGame(row)) continue;
    gamesByPlayer.set(pid, (gamesByPlayer.get(pid) ?? 0) + 1);
    minutesByPlayer.set(pid, (minutesByPlayer.get(pid) ?? 0) + (Number(row.minutes_played) || 0));
  }
  return { minutesByPlayer, gamesByPlayer };
}

function playerVsPlayerQualifyingGameCount(
  gamesByPlayer: Map<string, number>,
  playerId: string
): number {
  return gamesByPlayer.get(playerId) ?? 0;
}

function hasPlayerVsPlayerSelectableEligibility(
  gamesByPlayer: Map<string, number>,
  playerId: string
): boolean {
  return (
    playerVsPlayerQualifyingGameCount(gamesByPlayer, playerId) >=
    WORLD_CUP_PLAYER_VS_PLAYER_MIN_GAMES_SELECTABLE
  );
}

function hasPlayerVsPlayerDefaultEligibility(
  gamesByPlayer: Map<string, number>,
  playerId: string
): boolean {
  return (
    playerVsPlayerQualifyingGameCount(gamesByPlayer, playerId) >=
    WORLD_CUP_PLAYER_VS_PLAYER_MIN_GAMES_DEFAULT
  );
}

const WORLD_CUP_TEAMMATE_FETCH_BATCH = 4;

function filterWorldCupPlayerStatRows(
  rows: Array<Record<string, any>>,
  playerId: string,
  playerName?: string | null
): Array<Record<string, any>> {
  const norm = (value: string) =>
    value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const normTarget = playerName ? norm(playerName) : null;
  return rows.filter((row) => {
    if (String(row.player_id ?? row.player?.id ?? '') === playerId) return true;
    if (!normTarget) return false;
    const rowName = String(row.player_name ?? row.player?.name ?? row.player?.short_name ?? '');
    return rowName && norm(rowName) === normTarget;
  });
}

async function fetchWorldCupTeammateProfiles(
  candidates: Array<{ id: string; name: string }>
): Promise<
  Array<{
    candidate: { id: string; name: string };
    rows: Array<Record<string, any>>;
    isDefaultEligible: boolean;
  } | null>
> {
  const results: Array<{
    candidate: { id: string; name: string };
    rows: Array<Record<string, any>>;
    isDefaultEligible: boolean;
  } | null> = [];

  for (let index = 0; index < candidates.length; index += WORLD_CUP_TEAMMATE_FETCH_BATCH) {
    const batch = candidates.slice(index, index + WORLD_CUP_TEAMMATE_FETCH_BATCH);
    const batchResults = await Promise.all(
      batch.map(async (candidate) => {
        const params = new URLSearchParams();
        params.set('playerId', candidate.id);
        params.set('playerName', candidate.name);
        try {
          const data = await fetchWorldCupDashboardJson<WorldCupDashboardData>(
            `/api/world-cup/dashboard?${params.toString()}`
          );
          const rows = Array.isArray(data?.playerMatchStats) ? data.playerMatchStats : [];
          const profile = buildPlayerVsPlayerSquadProfile(rows);
          if (!hasPlayerVsPlayerSelectableEligibility(profile.gamesByPlayer, candidate.id)) {
            return null;
          }
          return {
            candidate,
            rows,
            isDefaultEligible: hasPlayerVsPlayerDefaultEligibility(profile.gamesByPlayer, candidate.id),
          };
        } catch {
          return null;
        }
      })
    );
    results.push(...batchResults);
  }

  return results;
}

function metricValue(metric: string, mode: PropsMode, data: WorldCupDashboardData | null, selectedPlayerId?: string | null): string {
  if (!data) return '-';
  const rows =
    mode === 'player' && selectedPlayerId
      ? (data.playerMatchStats ?? [])
          .filter((row) => String(row.player_id ?? row.player?.id ?? '') === selectedPlayerId)
          .filter((row) => hasWorldCupPlayerAppearance(row))
      : mode === 'player'
        ? (data.playerMatchStats ?? []).filter((row) => hasWorldCupPlayerAppearance(row))
        : data.teamMatchStats ?? [];
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
const WC_CHART_REVEAL_HOLD_MS = 200;

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

function worldCupMatchRichness(match: Record<string, any>): number {
  let score = 0;
  if (match.awayLabel || match.awayTeam?.name || match.away_team?.name) score += 2;
  if (match.homeLabel || match.homeTeam?.name || match.home_team?.name) score += 2;
  if (match.datetime) score += 1;
  return score;
}

function worldCupMatchSideIds(match: Record<string, any>): { homeId: string; awayId: string } {
  return {
    homeId: String(
      match?.homeTeam?.id ??
        match?.home_team?.id ??
        match?.home_team_source_id ??
        match?.raw?.home_team?.id ??
        ''
    ).trim(),
    awayId: String(
      match?.awayTeam?.id ??
        match?.away_team?.id ??
        match?.away_team_source_id ??
        match?.raw?.away_team?.id ??
        ''
    ).trim(),
  };
}

function worldCupMatchSideNames(match: Record<string, any>): { homeName: string; awayName: string } {
  return {
    homeName: String(
      match?.homeLabel ?? match?.homeTeam?.name ?? match?.home_team?.name ?? match?.home_team_name ?? ''
    ).trim(),
    awayName: String(
      match?.awayLabel ?? match?.awayTeam?.name ?? match?.away_team?.name ?? match?.away_team_name ?? ''
    ).trim(),
  };
}

function worldCupStatRowTeamId(row: Record<string, any>, selectedTeamId: string | null): string {
  return String(row.team_id ?? row.source_team_id ?? selectedTeamId ?? '').trim();
}

function parseWorldCupStatRowIsHome(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return null;
}

function worldCupEffectiveTeamContext(
  selectedTeam: WorldCupTeamOption | null,
  selectedPlayer: WorldCupPlayerOption | null
): { teamId: string | null; teamName: string | null } {
  return {
    teamId: selectedTeam?.id ?? selectedPlayer?.teamId ?? null,
    teamName: selectedTeam?.name ?? selectedPlayer?.teamName ?? null,
  };
}

function worldCupStatRowTeamInMatch(
  row: Record<string, any>,
  match: Record<string, any> | undefined,
  selectedTeamId: string | null,
  selectedTeamName: string | null
): boolean {
  if (!match) return false;
  const teamId = worldCupStatRowTeamId(row, selectedTeamId);
  const { homeId, awayId } = worldCupMatchSideIds(match);
  if (teamId && homeId && teamId === homeId) return true;
  if (teamId && awayId && teamId === awayId) return true;
  const parsedIsHome = parseWorldCupStatRowIsHome(row.is_home);
  const { homeName, awayName } = worldCupMatchSideNames(match);
  if (parsedIsHome === true) {
    if (teamId && homeId) return teamId === homeId;
    const nation = String(selectedTeamName ?? '').trim();
    return Boolean(nation && worldCupTeamsMatch(nation, homeName));
  }
  if (parsedIsHome === false) {
    if (teamId && awayId) return teamId === awayId;
    const nation = String(selectedTeamName ?? '').trim();
    return Boolean(nation && worldCupTeamsMatch(nation, awayName));
  }
  const nation = String(selectedTeamName ?? '').trim();
  if (!nation) return false;
  return worldCupTeamsMatch(nation, homeName) || worldCupTeamsMatch(nation, awayName);
}

/** Resolve opponent from match sides using the stat row's team id / is_home — works even when selectedTeam is stale. */
function resolveWorldCupOpponentFromMatchSides(
  row: Record<string, any>,
  match: Record<string, any>
): { isHome: boolean; opponentLabel: string; opponentTeamId: string } | null {
  const teamId = worldCupStatRowTeamId(row, null);
  const { homeId, awayId } = worldCupMatchSideIds(match);
  const { homeName, awayName } = worldCupMatchSideNames(match);

  if (teamId && homeId && teamId === homeId) {
    return { isHome: true, opponentLabel: awayName || 'Opponent', opponentTeamId: awayId };
  }
  if (teamId && awayId && teamId === awayId) {
    return { isHome: false, opponentLabel: homeName || 'Opponent', opponentTeamId: homeId };
  }
  const parsedIsHome = parseWorldCupStatRowIsHome(row.is_home);
  if (parsedIsHome === true) {
    return { isHome: true, opponentLabel: awayName || 'Opponent', opponentTeamId: awayId };
  }
  if (parsedIsHome === false) {
    return { isHome: false, opponentLabel: homeName || 'Opponent', opponentTeamId: homeId };
  }
  return null;
}

function resolveWorldCupMatchForStatRow(
  row: Record<string, any>,
  matches: Array<Record<string, any>>,
  playerMatches: Array<Record<string, any>>,
  selectedTeamId: string | null,
  selectedTeamName: string | null
): Record<string, any> | undefined {
  const matchId = String(row.match_id ?? row.source_match_id ?? '').trim();
  if (!matchId) return undefined;
  const rowSource = String(row.source ?? '').trim().toLowerCase();
  const candidates = [...playerMatches, ...matches].filter((match) => {
    const ids = [match.id, match.source_match_id, match.match_id]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    return ids.includes(matchId);
  });
  if (!candidates.length) return undefined;

  const teamMatches = candidates.filter((match) =>
    worldCupStatRowTeamInMatch(row, match, selectedTeamId, selectedTeamName)
  );
  if (teamMatches.length) {
    if (rowSource) {
      const sourceMatch = teamMatches.find(
        (match) => String(match.source ?? '').trim().toLowerCase() === rowSource
      );
      if (sourceMatch) return sourceMatch;
    }
    return teamMatches[0];
  }

  // BDL match ids are small integers and collide with intl source_match_ids — never
  // attach a BDL stat row to a fixture the selected nation did not play in.
  if (rowSource === 'bdl' || !rowSource) return undefined;
  if (rowSource) {
    const sourceCandidates = candidates.filter(
      (match) => String(match.source ?? '').trim().toLowerCase() === rowSource
    );
    for (const match of sourceCandidates) {
      if (worldCupStatRowTeamInMatch(row, match, selectedTeamId, selectedTeamName)) return match;
      if (resolveWorldCupOpponentFromMatchSides(row, match)) return match;
    }
    return undefined;
  }
  return candidates[0];
}

function buildWorldCupMatchLookup(
  matches: Array<Record<string, any>>,
  playerMatches: Array<Record<string, any>>
): Map<string, Record<string, any>> {
  const byId = new Map<string, Record<string, any>>();
  const add = (match: Record<string, any>) => {
    const keys = [match.id, match.source_match_id, match.match_id]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    for (const key of keys) {
      const existing = byId.get(key);
      if (!existing || worldCupMatchRichness(match) >= worldCupMatchRichness(existing)) {
        byId.set(key, match);
      }
    }
  };
  for (const match of [...matches, ...playerMatches]) add(match);
  return byId;
}

function resolveWorldCupPlayerChartContext(
  row: Record<string, any>,
  match: Record<string, any> | undefined,
  selectedTeamId: string | null,
  countryLookup: ReturnType<typeof buildWorldCupTeamCountryLookup>,
  selectedTeamName?: string | null
): {
  isHome: boolean;
  opponentLabel: string;
  opponentCountryCode: string | null;
  opponentTeamId: string;
} {
  const nation = selectedTeamName ?? null;
  const validMatch =
    match && worldCupStatRowTeamInMatch(row, match, selectedTeamId, nation) ? match : undefined;

  if (!validMatch && match) {
    const fromSides = resolveWorldCupOpponentFromMatchSides(row, match);
    if (fromSides) {
      return {
        ...fromSides,
        opponentCountryCode: resolveWorldCupOpponentCountryCode(
          match,
          fromSides.isHome,
          fromSides.opponentLabel,
          countryLookup
        ),
      };
    }
  }

  if (!validMatch) {
    const opponent = String(row.opponent ?? row.opponent_name ?? '').trim();
    if (opponent && !(nation && worldCupTeamsMatch(nation, opponent))) {
      const nameKey = opponent.toLowerCase();
      return {
        isHome: true,
        opponentLabel: opponent,
        opponentCountryCode:
          countryLookup.byName.get(nameKey) ??
          resolveWorldCupFlagCode(opponent) ??
          WORLD_CUP_COUNTRY_NAME_TO_FIFA[nameKey] ??
          null,
        opponentTeamId: '',
      };
    }
    return {
      isHome: true,
      opponentLabel: 'Opponent',
      opponentCountryCode: null,
      opponentTeamId: '',
    };
  }

  const teamId = worldCupStatRowTeamId(row, selectedTeamId);
  const { homeId, awayId } = worldCupMatchSideIds(validMatch);
  const { homeName, awayName } = worldCupMatchSideNames(validMatch);
  const parsedIsHome = parseWorldCupStatRowIsHome(row.is_home);
  const nationMatchesHome = Boolean(nation && worldCupTeamsMatch(nation, homeName));
  const nationMatchesAway = Boolean(nation && worldCupTeamsMatch(nation, awayName));
  let isHome: boolean;
  if (parsedIsHome === true) {
    isHome = true;
  } else if (parsedIsHome === false) {
    isHome = false;
  } else if (homeId && teamId && homeId === teamId) {
    isHome = true;
  } else if (awayId && teamId && awayId === teamId) {
    isHome = false;
  } else if (nationMatchesHome && !nationMatchesAway) {
    isHome = true;
  } else if (nationMatchesAway && !nationMatchesHome) {
    isHome = false;
  } else {
    isHome = nationMatchesHome;
  }
  let opponentLabel = isHome
    ? String(
        validMatch?.awayLabel ||
          validMatch?.awayTeam?.name ||
          validMatch?.away_team?.name ||
          validMatch?.away_team_name ||
          'Opponent'
      )
    : String(
        validMatch?.homeLabel ||
          validMatch?.homeTeam?.name ||
          validMatch?.home_team?.name ||
          validMatch?.home_team_name ||
          'Opponent'
      );
  let opponentTeamId = isHome ? awayId : homeId;
  if (nation && worldCupTeamsMatch(nation, opponentLabel)) {
    isHome = !isHome;
    opponentLabel = isHome ? awayName || 'Opponent' : homeName || 'Opponent';
    opponentTeamId = isHome ? awayId : homeId;
  }
  const opponentCountryCode = resolveWorldCupOpponentCountryCode(
    validMatch,
    isHome,
    opponentLabel,
    countryLookup
  );
  return { isHome, opponentLabel, opponentCountryCode, opponentTeamId };
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

/** Chart filter + axis: club vs every national-team competition merged together. */
type WorldCupChartCompetitionGroup = 'Club' | 'International';

const WORLD_CUP_CHART_COMPETITION_GROUP_ORDER: WorldCupChartCompetitionGroup[] = ['International', 'Club'];

const WORLD_CUP_COMPETITION_TAG_ORDER: WorldCupCompetitionTag[] = ['WC', 'WCQ', 'Euros', 'NL', 'Copa', 'AFCON', 'AC', 'Club'];

function worldCupCompetitionChartGroup(tag: WorldCupCompetitionTag): WorldCupChartCompetitionGroup {
  return tag === 'Club' ? 'Club' : 'International';
}

function worldCupChartCompetitionGroupLabel(
  group: WorldCupChartCompetitionGroup,
  opts?: { short?: boolean }
): string {
  if (group === 'Club') return 'Club';
  return opts?.short ? 'Intl' : 'International';
}

/** Granular tournament key for the second chart filter (replaces knockout stage). */
type WorldCupIntlCompetitionDetailKey = Exclude<WorldCupCompetitionTag, 'Club'>;

const WORLD_CUP_INTL_COMPETITION_DETAILS: Array<{
  key: WorldCupIntlCompetitionDetailKey;
  label: string;
  short: string;
  order: number;
}> = [
  { key: 'WC', label: 'World Cup', short: 'WC', order: 1 },
  { key: 'WCQ', label: 'World Cup Qualifiers', short: 'WCQ', order: 2 },
  { key: 'Euros', label: 'Euros', short: 'Euros', order: 3 },
  { key: 'NL', label: 'Nations League', short: 'NL', order: 4 },
  { key: 'Copa', label: 'Copa América', short: 'Copa', order: 5 },
  { key: 'AFCON', label: 'AFCON', short: 'AFCON', order: 6 },
  { key: 'AC', label: 'Asian Cup', short: 'AC', order: 7 },
];

const WORLD_CUP_INTL_DETAIL_BY_KEY = Object.fromEntries(
  WORLD_CUP_INTL_COMPETITION_DETAILS.map((entry) => [entry.key, entry])
) as Record<WorldCupIntlCompetitionDetailKey, (typeof WORLD_CUP_INTL_COMPETITION_DETAILS)[number]>;

const WORLD_CUP_CLUB_SLUG_DETAILS: Record<string, { label: string; short: string; order: number }> = {
  'club-champions-league': { label: 'UEFA Champions League', short: 'UCL', order: 10 },
  'club-europa-league': { label: 'UEFA Europa League', short: 'UEL', order: 11 },
  'club-conference-league': { label: 'UEFA Conference League', short: 'UECL', order: 12 },
  'club-epl': { label: 'Premier League', short: 'EPL', order: 20 },
  'club-la-liga': { label: 'La Liga', short: 'La Liga', order: 21 },
  'club-serie-a': { label: 'Serie A', short: 'Serie A', order: 22 },
  'club-bundesliga': { label: 'Bundesliga', short: 'Bundesliga', order: 23 },
  'club-ligue-1': { label: 'Ligue 1', short: 'Ligue 1', order: 24 },
  'club-liga-portugal': { label: 'Liga Portugal', short: 'Liga PT', order: 25 },
  'club-eredivisie': { label: 'Eredivisie', short: 'Eredivisie', order: 26 },
  'club-brasileirao': { label: 'Brasileirão', short: 'Brasileirão', order: 27 },
  'club-mls': { label: 'Major League Soccer', short: 'MLS', order: 28 },
  'club-belgian-pro-league': { label: 'Belgian Pro League', short: 'Belgium', order: 29 },
  'club-saudi-pro-league': { label: 'Saudi Pro League', short: 'Saudi', order: 30 },
  'club-argentine-primera': { label: 'Argentine Primera', short: 'Argentina', order: 31 },
  'club-liga-mx': { label: 'Liga MX', short: 'Liga MX', order: 32 },
  'club-super-lig': { label: 'Süper Lig', short: 'Süper Lig', order: 33 },
  'club-j1-league': { label: 'J1 League', short: 'J1', order: 34 },
  'club-k-league': { label: 'K League 1', short: 'K League', order: 35 },
  'club-a-league': { label: 'A-League', short: 'A-League', order: 36 },
  'club-championship': { label: 'Championship', short: 'Championship', order: 37 },
  'club-scottish-prem': { label: 'Scottish Premiership', short: 'Scotland', order: 38 },
  'club-south-african-psl': { label: 'South African PSL', short: 'SA PSL', order: 39 },
  'club-fa-cup': { label: 'FA Cup', short: 'FA Cup', order: 40 },
  'club-efl-cup': { label: 'EFL Cup', short: 'EFL Cup', order: 41 },
  'club-copa-del-rey': { label: 'Copa del Rey', short: 'Copa del Rey', order: 42 },
  'club-dfb-pokal': { label: 'DFB-Pokal', short: 'DFB-Pokal', order: 43 },
  'club-coppa-italia': { label: 'Coppa Italia', short: 'Coppa Italia', order: 44 },
  'club-coupe-de-france': { label: 'Coupe de France', short: 'Coupe FR', order: 45 },
  'club-taca-de-portugal': { label: 'Taça de Portugal', short: 'Taça PT', order: 46 },
};

function readWorldCupTournamentSlug(
  row: Record<string, any> | null | undefined,
  match: Record<string, any> | null | undefined
): string {
  for (const value of [match?.tournament_slug, match?.tournamentSlug, row?.tournament_slug]) {
    const slug = String(value ?? '').trim().toLowerCase();
    if (slug) return slug;
  }
  return '';
}

function deriveWorldCupCompetitionDetailKey(
  row: Record<string, any> | null | undefined,
  match: Record<string, any> | null | undefined
): string {
  const slug = readWorldCupTournamentSlug(row, match);
  if (slug.startsWith('club-')) return slug;
  if (slug === 'worldcup' || slug === 'world-cup' || slug === 'fifa-world-cup') return 'WC';
  if (slug.startsWith('wcq') || slug === 'wc-qualifiers' || slug === 'world-cup-qualification') return 'WCQ';
  if (slug === 'copa-america' || slug === 'copa_america' || slug === 'copaamerica') return 'Copa';
  if (slug === 'afcon' || slug === 'africa-cup-of-nations') return 'AFCON';
  if (slug === 'asian-cup' || slug === 'afc-asian-cup') return 'AC';
  if (slug === 'euros' || slug === 'euro') return 'Euros';
  if (slug === 'nations-league' || slug === 'nationsleague') return 'NL';
  if (slug) return slug;
  return deriveWorldCupCompetitionTag(row, match);
}

function worldCupCompetitionDetailMeta(key: string): { label: string; short: string; order: number } {
  const club = WORLD_CUP_CLUB_SLUG_DETAILS[key];
  if (club) return club;
  const intl = WORLD_CUP_INTL_DETAIL_BY_KEY[key as WorldCupIntlCompetitionDetailKey];
  if (intl) return intl;
  const humanized = key.replace(/^club-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { label: humanized || key, short: humanized.slice(0, 6) || key, order: 900 };
}

function compareWorldCupCompetitionDetailKeys(a: string, b: string): number {
  const orderA = worldCupCompetitionDetailMeta(a).order;
  const orderB = worldCupCompetitionDetailMeta(b).order;
  if (orderA !== orderB) return orderA - orderB;
  return worldCupCompetitionDetailMeta(a).label.localeCompare(worldCupCompetitionDetailMeta(b).label);
}

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

// The `stage` / `group` fields arrive as strings (BDL) or { name } (international sources).
function readWorldCupMatchStage(match: any): string | null {
  const raw = match?.stage;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && typeof raw.name === 'string') return raw.name;
  return null;
}

function readWorldCupMatchGroup(match: any): string | null {
  const raw = match?.group;
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
  // API-Football World Cup finals use tournament_slug "worldcup" — must be WC, not NL.
  if (
    slugs.some((s) => s === 'worldcup' || s === 'world-cup' || s === 'fifa-world-cup')
  ) {
    return 'WC';
  }
  const seasonYear = Number(
    match?.season?.year ?? match?.season_year ?? row?.season_year ?? row?.season ?? NaN
  );
  if (
    (seasonYear === 2018 || seasonYear === 2022 || seasonYear === 2026) &&
    sources.some((s) => s === 'bdl' || s === 'api-football')
  ) {
    return 'WC';
  }
  if (sources.some((s) => s === 'api-football') && slugs.every((s) => !s)) return 'NL';
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
  source: unknown,
  opts?: { isClubCompetition?: boolean }
): string | null {
  const id = String(opponentTeamId ?? '').trim();
  if (!/^\d+$/.test(id)) return null;
  const src = String(source ?? '').toLowerCase();
  if (src !== 'api-football' && !opts?.isClubCompetition) return null;
  return `https://media.api-sports.io/football/teams/${id}.png`;
}

function resolveWorldCupOpponentLogoUrl(args: {
  row: Record<string, any>;
  match: Record<string, any> | undefined;
  competitionTag: WorldCupCompetitionTag;
  opponentTeamId: string;
  opponentLabel: string;
  opponentCountryCode: string | null;
}): string | null {
  const { row, match, competitionTag, opponentTeamId, opponentLabel, opponentCountryCode } = args;
  const isClub = competitionTag === 'Club';

  if (isClub) {
    const source = match?.source ?? row?.source;
    const sides = match ? resolveWorldCupOpponentFromMatchSides(row, match) : null;
    const opponentSide = sides
      ? sides.isHome
        ? match?.awayTeam ?? match?.away_team
        : match?.homeTeam ?? match?.home_team
      : null;
    const embeddedLogo = opponentSide?.logo ?? opponentSide?.logo_url;
    if (embeddedLogo) return String(embeddedLogo);

    const teamId = opponentTeamId || sides?.opponentTeamId || '';
    const clubLogo = resolveWorldCupClubLogoUrl(teamId, source, { isClubCompetition: true });
    if (clubLogo) return clubLogo;
  }

  return resolveBestWorldCupFlagUrl(opponentLabel, opponentCountryCode);
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

function getWorldCupPlayerStatRows(
  rows: Array<Record<string, any>>,
  selectedPlayerId: string | null
): Array<Record<string, any>> {
  return resolvePlayerScopedStatRows(rows, selectedPlayerId, null);
}

function WorldCupXAxisTick({ x, y, payload, data, isDark, hideTickDetails }: any) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const syncMobile = () => setIsMobile(typeof window !== 'undefined' && window.innerWidth < 640);
    syncMobile();
    window.addEventListener('resize', syncMobile);
    return () => window.removeEventListener('resize', syncMobile);
  }, []);
  const dataPoint = data?.find((row: any) => row.xKey === payload.value);
  const label = dataPoint?.tickLabel || payload.value;
  const opponentCountryCode = dataPoint?.opponentCountryCode as string | null | undefined;
  const opponentName = dataPoint?.opponent as string | null | undefined;
  const rawLogoUrl =
    (dataPoint?.opponentLogoUrl as string | null | undefined) ||
    resolveBestWorldCupFlagUrl(opponentName, opponentCountryCode);
  useEffect(() => {
    setLogoFailed(false);
  }, [rawLogoUrl]);
  if (!dataPoint) return null;
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
  const tickDateLabel = dataPoint
    ? isMobile
      ? formatWorldCupCompactDate(dataPoint.gameDate) || dataPoint.tickDateLabel
      : dataPoint.tickDateLabel
    : '';

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
      {!hideTickDetails && tickDateLabel ? (
        <text x={0} y={0} dy={37} textAnchor="middle" fill={dateFill} fontSize={isMobile ? 8 : 9} fontWeight={600}>
          {tickDateLabel}
        </text>
      ) : null}
      {!hideTickDetails && dataPoint.competitionDetailShort ? (
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
          {dataPoint.competitionDetailShort}
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
        competitionGroup?: WorldCupChartCompetitionGroup;
        competitionDetailKey?: string;
        competitionDetailLabel?: string;
        competitionDetailShort?: string;
        outcome?: 'W' | 'D' | 'L' | null;
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
    Club: 'Club',
  };
  const competitionLabel =
    point.competitionDetailLabel ??
    (point.competitionTag
      ? competitionFullName[point.competitionTag] ??
        (point.competitionGroup === 'Club' ? 'Club' : 'International')
      : point.competitionGroup
        ? worldCupChartCompetitionGroupLabel(point.competitionGroup)
        : null);

  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipText = isDark ? '#ffffff' : '#000000';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const labelColor = isDark ? '#9ca3af' : '#6b7280';
  const winColor = isDark ? '#10b981' : '#059669';
  const lossColor = isDark ? '#ef4444' : '#dc2626';

  const moneylineResultLabel = isMoneyline
    ? point.outcome === 'W'
      ? 'Win'
      : point.outcome === 'L'
        ? 'Loss'
        : point.outcome === 'D'
          ? 'Draw'
          : typeof point.value === 'number'
            ? point.value >= 0.5
              ? 'Win'
              : point.value <= -0.5
                ? 'Loss'
                : point.value === 0
                  ? 'Draw'
                  : null
            : null
    : null;
  const moneylineResultColor =
    moneylineResultLabel === 'Win'
      ? winColor
      : moneylineResultLabel === 'Loss'
        ? lossColor
        : labelColor;

  // Date formatting — compact M/D on mobile; MM/DD/YY on desktop (NBA/AFL-style).
  let dateShort = point.gameDate ?? '';
  if (point.gameDate) {
    const ts = Date.parse(point.gameDate);
    if (!Number.isNaN(ts)) {
      const d = new Date(ts);
      if (isMobile) {
        dateShort = formatWorldCupCompactDate(d);
      } else {
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const year = String(d.getFullYear()).slice(-2);
        dateShort = `${month}/${day}/${year}`;
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
      </div>

      <div
        style={{
          marginBottom: '8px',
          padding: '8px',
          backgroundColor: isDark ? '#374151' : '#f3f4f6',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: 600,
          color: isMoneyline ? moneylineResultColor : tooltipText,
        }}
      >
        {isMoneyline
          ? `${moneylineResultLabel ?? 'Result'}${point.scoreline ? ` (${point.scoreline})` : ''}`
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

function getChartStatConfig(
  mode: PropsMode,
  selectedStat: WorldCupChartStatId
): (typeof WORLD_CUP_STAT_OPTIONS)[number] {
  const preferred = WORLD_CUP_STAT_OPTIONS.find((option) => option.id === selectedStat) ?? WORLD_CUP_STAT_OPTIONS[0];
  if (mode === 'team' && !preferred.teamKey) {
    return WORLD_CUP_STAT_OPTIONS.find((option) => option.teamKey != null) ?? preferred;
  }
  if (mode === 'player' && !preferred.playerKey) {
    return WORLD_CUP_STAT_OPTIONS.find((option) => option.playerKey != null) ?? preferred;
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
  if (mode === 'team') {
    const prioritized = GAME_PROPS_STAT_PRIORITY.flatMap((id) => {
      const match = filtered.find((option) => option.id === id);
      return match ? [match] : [];
    });
    const rest = filtered.filter((option) => !GAME_PROPS_STAT_PRIORITY.includes(option.id as typeof GAME_PROPS_STAT_PRIORITY[number]));
    return [...prioritized, ...rest];
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

function formatWorldCupCompactDate(value: unknown): string {
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

function getWorldCupTickDateLabel(value: unknown, compact = false): string {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  if (compact) return formatWorldCupCompactDate(date);
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

const WC_PLAYER_ODDS_STATS = new Set<WorldCupChartStatId>([
  'goals',
  'assists',
  'total_shots',
  'shots_on_target',
  'fouls_committed',
  'yellow_cards',
]);

function worldCupBookOffersOddsLine(
  statId: WorldCupChartStatId,
  book: WorldCupPlayerOddsBook,
  lineValue: number | null | undefined
): boolean {
  if (!WC_PLAYER_ODDS_STATS.has(statId)) return true;
  if (lineValue == null || !Number.isFinite(lineValue)) return true;
  if (statId === 'goals' || statId === 'yellow_cards') return true;
  const lines = getAvailableWorldCupOddsLines(statId, [book]);
  if (!lines.length) return false;
  const resolved = resolveWorldCupOddsLineForTarget(statId, lines, lineValue);
  return resolved != null && lines.some((line) => worldCupOddsLinesMatch(line, resolved));
}

function wcFmtOdds(americanStr: string | undefined, format: OddsFormat): string {
  if (!americanStr || americanStr === 'N/A') return 'N/A';
  const am = Number.parseFloat(String(americanStr).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(am)) return 'N/A';
  if (format === 'decimal') return americanToDecimal(am).toFixed(2);
  return am > 0 ? `+${am}` : String(am);
}

type WorldCupOddsDropdownItem = {
  bookIndex: number;
  line: number;
  kind: 'yesno' | 'ou';
  over?: string;
  under?: string;
  yes?: string;
  no?: string;
};

function buildWorldCupOddsDropdownItems(
  statId: WorldCupChartStatId,
  books: WorldCupPlayerOddsBook[]
): WorldCupOddsDropdownItem[] {
  const items: WorldCupOddsDropdownItem[] = [];
  books.forEach((book, bookIndex) => {
    const lines = getWorldCupOddsLinesForStat(statId, book);
    for (const market of lines) {
      const line = parseWorldCupOddsLine(market.line);
      if (line == null) continue;
      if (statId === 'goals' && Math.abs(line - 0.5) < 0.01 && book.AnytimeGoalScorer?.yes) {
        items.push({
          bookIndex,
          line,
          kind: 'yesno',
          yes: book.AnytimeGoalScorer.yes,
          no: book.AnytimeGoalScorer.no,
        });
        continue;
      }
      if (statId === 'yellow_cards' && Math.abs(line - 0.5) < 0.01 && book.ToBeBooked?.yes) {
        items.push({
          bookIndex,
          line,
          kind: 'yesno',
          yes: book.ToBeBooked.yes,
          no: book.ToBeBooked.no,
        });
        continue;
      }
      if (!market.over || market.over === 'N/A') continue;
      items.push({
        bookIndex,
        line,
        kind: 'ou',
        over: market.over,
        under: market.under,
      });
    }
  });
  items.sort((a, b) => a.line - b.line || a.bookIndex - b.bookIndex);
  return items;
}

function WorldCupLineSelector({
  books,
  statId,
  selectedBookIndex,
  onSelectBookIndex,
  oddsFormat,
  isDark,
  disabled = false,
  loading = false,
  currentLineValue = null,
  onSelectLineValue,
}: {
  books: WorldCupPlayerOddsBook[];
  statId: WorldCupChartStatId;
  selectedBookIndex: number;
  onSelectBookIndex: (index: number) => void;
  oddsFormat: OddsFormat;
  isDark: boolean;
  disabled?: boolean;
  loading?: boolean;
  currentLineValue?: number | null;
  onSelectLineValue?: (lineValue: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownItems = useMemo(() => buildWorldCupOddsDropdownItems(statId, books), [statId, books]);
  const selectedBook = books[selectedBookIndex];
  const hasOddsForLine =
    currentLineValue != null &&
    Number.isFinite(currentLineValue) &&
    hasWorldCupOddsForTargetLine(statId, books, currentLineValue);
  const displayMarket =
    hasOddsForLine && selectedBook
      ? getOddsMarketForStat(statId, selectedBook, currentLineValue)
      : null;
  const bookmakerInfo = selectedBook ? getBookmakerInfo(selectedBook.name) : null;
  const isYesNo = displayMarket != null && 'yes' in displayMarket;
  const displayOver = displayMarket && 'over' in displayMarket ? displayMarket.over : undefined;
  const displayUnder = displayMarket && 'under' in displayMarket ? displayMarket.under : undefined;
  const displayYes = displayMarket && 'yes' in displayMarket ? displayMarket.yes : undefined;
  const displayNo = displayMarket && 'no' in displayMarket ? displayMarket.no : undefined;
  const hasDisplayableOdds =
    hasOddsForLine &&
    books.length > 0 &&
    Boolean(selectedBook) &&
    displayMarket != null &&
    (isYesNo
      ? Boolean(displayYes && displayYes !== 'N/A')
      : Boolean(displayOver && displayOver !== 'N/A'));

  const noOddsForCurrentLine =
    currentLineValue != null &&
    Number.isFinite(currentLineValue) &&
    books.length > 0 &&
    !loading &&
    !hasOddsForLine;

  const showSkeleton =
    (loading || books.length === 0 || !hasDisplayableOdds || noOddsForCurrentLine) && !disabled;

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  if (!WC_PLAYER_ODDS_STATS.has(statId)) return null;

  return (
    <div className="relative flex-shrink-0 w-[100px] sm:w-[110px] md:w-[120px]" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((open) => !open)}
        disabled={disabled}
        className="w-full px-1.5 sm:px-2 py-1 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors h-[32px] sm:h-[36px] overflow-hidden disabled:opacity-60"
      >
        <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-hidden">
          {showSkeleton ? (
            <div className={`h-4 w-16 rounded animate-pulse flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          ) : bookmakerInfo && selectedBook && displayMarket ? (
            <>
              {bookmakerInfo.logoUrl ? (
                <img
                  src={bookmakerInfo.logoUrl}
                  alt={bookmakerInfo.name}
                  className="w-6 h-6 sm:w-7 sm:h-7 rounded object-contain flex-shrink-0"
                  onError={(event) => {
                    (event.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <span
                  className="text-xs font-semibold text-white px-1.5 py-0.5 rounded flex-shrink-0 min-w-[1.25rem] h-5 flex items-center justify-center"
                  style={{ backgroundColor: bookmakerInfo.color }}
                >
                  {bookmakerInfo.logo}
                </span>
              )}
              <div className="flex flex-col items-start gap-0.5 min-w-0">
                {isYesNo ? (
                  <>
                    {displayYes ? (
                      <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                        Yes {wcFmtOdds(displayYes, oddsFormat)}
                      </span>
                    ) : null}
                    {displayNo && displayNo !== 'N/A' ? (
                      <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                        No {wcFmtOdds(displayNo, oddsFormat)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    {displayOver ? (
                      <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                        O {wcFmtOdds(displayOver, oddsFormat)}
                      </span>
                    ) : null}
                    {displayUnder && displayUnder !== 'N/A' ? (
                      <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                        U {wcFmtOdds(displayUnder, oddsFormat)}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-start gap-0.5 min-w-0">
              <span className="text-[11px] sm:text-xs text-gray-700 dark:text-gray-300 font-medium">Odds</span>
            </div>
          )}
        </div>
        <svg className={`w-4 h-4 flex-shrink-0 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && dropdownItems.length > 0 ? (
        <>
          <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 min-w-[280px] max-w-[320px] max-h-[400px] overflow-y-auto">
            <div className="p-3 border-b border-gray-200 dark:border-gray-600">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Select line</div>
            </div>
            <div className="p-2">
              {dropdownItems.map((item, index) => {
                const book = books[item.bookIndex];
                const info = getBookmakerInfo(book.name);
                const isSelected =
                  item.bookIndex === selectedBookIndex && Math.abs((currentLineValue ?? item.line) - item.line) < 0.01;
                return (
                  <button
                    key={`${book.name}-${item.bookIndex}-${item.line}-${index}`}
                    type="button"
                    onClick={() => {
                      onSelectBookIndex(item.bookIndex);
                      onSelectLineValue?.(item.line);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between transition-colors border ${
                      isSelected
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30'
                        : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {info.logoUrl ? (
                        <img src={info.logoUrl} alt={info.name} className="w-6 h-6 rounded object-contain flex-shrink-0" />
                      ) : (
                        <span className="text-[10px] font-semibold text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: info.color }}>
                          {info.logo}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{info.name}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400">
                          {item.kind === 'yesno' ? 'Anytime scorer' : `Line ${item.line}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0 ml-2">
                      {item.kind === 'yesno' ? (
                        <>
                          {item.yes ? <span className="text-[11px] text-green-600 dark:text-green-400 font-mono">Yes {wcFmtOdds(item.yes, oddsFormat)}</span> : null}
                          {item.no && item.no !== 'N/A' ? <span className="text-[11px] text-red-600 dark:text-red-400 font-mono">No {wcFmtOdds(item.no, oddsFormat)}</span> : null}
                        </>
                      ) : (
                        <>
                          {item.over ? <span className="text-[11px] text-green-600 dark:text-green-400 font-mono">O {wcFmtOdds(item.over, oddsFormat)}</span> : null}
                          {item.under && item.under !== 'N/A' ? <span className="text-[11px] text-red-600 dark:text-red-400 font-mono">U {wcFmtOdds(item.under, oddsFormat)}</span> : null}
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} aria-hidden />
        </>
      ) : null}
    </div>
  );
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
  chartContext: externalChartContext,
  onChartContextChange,
  playerOddsBooks,
  playerOddsLoading,
  oddsFormat,
  selectedBookIndex,
  onSelectBookIndex,
  externalLineValue,
  currentLineValue,
  onExternalLineChange,
  onSelectOddsLine,
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
  chartContext?: WorldCupChartContext;
  onChartContextChange?: (context: WorldCupChartContext) => void;
  playerOddsBooks?: WorldCupPlayerOddsBook[];
  playerOddsLoading?: boolean;
  oddsFormat?: OddsFormat;
  selectedBookIndex?: number;
  onSelectBookIndex?: (index: number) => void;
  externalLineValue?: number | null;
  currentLineValue?: number | null;
  onExternalLineChange?: (value: number) => void;
  onSelectOddsLine?: (value: number) => void;
}) {
  const [selectedStat, setSelectedStat] = useState<WorldCupChartStatId>(() => {
    if (externalChartContext?.statId) return externalChartContext.statId;
    return mode === 'player' ? 'passes' : 'moneyline';
  });
  const [timeframe, setTimeframe] = useState<WorldCupChartTimeframe>(
    externalChartContext?.timeframe ?? 'last10'
  );
  const applyingExternalChartContextRef = useRef(false);
  const lastExternalChartContextRef = useRef(externalChartContext);
  const [perspective, setPerspective] = useState<WorldCupStatPerspective>('all');
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const [competitionFilter, setCompetitionFilter] = useState<WorldCupChartCompetitionGroup | 'all'>('all');
  const [isCompetitionDropdownOpen, setIsCompetitionDropdownOpen] = useState(false);
  const competitionDropdownRef = useRef<HTMLDivElement>(null);
  const [tournamentFilter, setTournamentFilter] = useState<string | 'all'>('all');
  const [isTournamentDropdownOpen, setIsTournamentDropdownOpen] = useState(false);
  const tournamentDropdownRef = useRef<HTMLDivElement>(null);
  const baseAvailableStats = useMemo(
    () => getAvailableWorldCupStats(mode, selectedPlayer, competition),
    [mode, selectedPlayer, competition]
  );
  const teamStatRows = useMemo(() => {
    if (mode !== 'team' || !data) return [] as Array<Record<string, any>>;
    const teamId = selectedTeam?.id ?? null;
    return (data.teamMatchStats ?? []).filter((row) => !teamId || String(row.team_id ?? '') === teamId);
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
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;
  const selectedTeamId =
    (selectedTeam?.id && /^\d+$/.test(selectedTeam.id) ? selectedTeam.id : null) ??
    (selectedPlayer?.teamId && /^\d+$/.test(selectedPlayer.teamId) ? selectedPlayer.teamId : null) ??
    (data?.selectedTeam?.id != null ? String(data.selectedTeam.id) : null);
  const selectedTeamName =
    selectedTeam?.name ??
    selectedPlayer?.teamName ??
    (data?.selectedTeam?.name ? String(data.selectedTeam.name) : null);

  const baseChartRows = useMemo(() => {
    if (!data || !statKey) return [];
    const countryLookup = buildWorldCupTeamCountryLookup(data.teams ?? []);
    const sourceRows = dedupeWorldCupPlayerStatRowsByGame(
      mergeWorldCupPlayerStatRows(
        mode === 'player'
          ? getWorldCupPlayerStatRows(data.playerMatchStats ?? [], selectedPlayerId)
          : (data.teamMatchStats ?? []).filter((row) => !selectedTeamId || String(row.team_id ?? '') === selectedTeamId)
      ),
      data.matches ?? [],
      data.playerMatches ?? [],
      selectedTeamId,
      selectedTeamName
    );

    const rows = sourceRows
      .filter((row) => {
        const match = resolveWorldCupMatchForStatRow(
          row,
          data.matches ?? [],
          data.playerMatches ?? [],
          selectedTeamId,
          selectedTeamName
        );
        if (match) return true;
        if (String(row.opponent ?? row.opponent_name ?? '').trim()) return true;
        const slug = String(row.tournament_slug ?? '').toLowerCase();
        return slug === 'worldcup' || slug === 'world-cup' || slug === 'fifa-world-cup';
      })
      .map((row, index) => {
        const match = resolveWorldCupMatchForStatRow(
          row,
          data.matches ?? [],
          data.playerMatches ?? [],
          selectedTeamId,
          selectedTeamName
        );
        const { isHome, opponentLabel, opponentCountryCode, opponentTeamId } = resolveWorldCupPlayerChartContext(
          row,
          match,
          selectedTeamId,
          countryLookup,
          selectedTeamName
        );
        const teamLabel = isHome
          ? String(match?.homeLabel || match?.homeTeam?.name || match?.home_team?.name || selectedTeam?.name || 'Team')
          : String(match?.awayLabel || match?.awayTeam?.name || match?.away_team?.name || selectedTeam?.name || 'Team');
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
          if (mode === 'team') return resolveWorldCupTeamStatValue(row, match, statKey, perspective);
          return getWorldCupStatNumber(row, statKey);
        })();
        const competitionTag = deriveWorldCupCompetitionTag(row, match);
        const competitionGroup = worldCupCompetitionChartGroup(competitionTag);
        const competitionDetailKey = deriveWorldCupCompetitionDetailKey(row, match);
        const competitionDetailMeta = worldCupCompetitionDetailMeta(competitionDetailKey);
        const opponentLogoUrl = resolveWorldCupOpponentLogoUrl({
          row,
          match,
          competitionTag,
          opponentTeamId,
          opponentLabel,
          opponentCountryCode,
        });
        const rowKey = worldCupStatRowMergeKey(row) || `chart-row-${index}`;
        return {
          key: rowKey,
          xKey: rowKey,
          tickLabel: getTeamAbbreviationFromLabel(opponentLabel),
          tickDateLabel: getWorldCupTickDateLabel(match?.datetime),
          competitionTag,
          competitionGroup,
          competitionDetailKey,
          competitionDetailLabel: competitionDetailMeta.label,
          competitionDetailShort: competitionDetailMeta.short,
          opponentCountryCode,
          opponentLogoUrl,
          opponent: opponentLabel,
          value,
          outcome,
          penaltyShootout,
          gameDate: typeof match?.datetime === 'string' ? match.datetime : '',
          gameTimestamp: Date.parse(String(match?.datetime || '')) || 0,
          matchLabel: match
            ? `${match.homeLabel || 'TBD'} vs ${match.awayLabel || 'TBD'}`
            : `Match ${String(row.match_id ?? row.source_match_id ?? '') || '—'}`,
          scoreline,
          result: scoreline,
          venue: isHome ? 'HOME' : 'AWAY',
          minutes: getWorldCupStatNumber(row, 'minutes_played'),
        };
      })
      .filter((row) => {
        if (row.value == null) return false;
        if (!selectedTeamName) return true;
        return !worldCupTeamsMatch(selectedTeamName, row.opponent);
      })
      .sort((a, b) => a.gameTimestamp - b.gameTimestamp);

    return rows;
  }, [data, mode, selectedPlayerId, selectedTeamId, selectedTeamName, statKey, perspective, isMoneyline]);

  // Club vs international groups for the competition filter (All / Club / International).
  const chartCompetitions = useMemo(() => {
    const counts = new Map<WorldCupChartCompetitionGroup, number>();
    for (const row of baseChartRows) {
      const group = row.competitionGroup as WorldCupChartCompetitionGroup | undefined;
      if (!group) continue;
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return WORLD_CUP_CHART_COMPETITION_GROUP_ORDER.filter((group) => counts.has(group)).map((group) => ({
      group,
      label: worldCupChartCompetitionGroupLabel(group),
      count: counts.get(group) ?? 0,
    }));
  }, [baseChartRows]);

  // Rows after the Club / International filter.
  const competitionFilteredRows = useMemo(
    () =>
      competitionFilter === 'all'
        ? baseChartRows
        : baseChartRows.filter((row) => row.competitionGroup === competitionFilter),
    [baseChartRows, competitionFilter]
  );

  // Granular tournaments within the current Club / International selection.
  const chartTournaments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of competitionFilteredRows) {
      const key = String(row.competitionDetailKey ?? '');
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => compareWorldCupCompetitionDetailKeys(a, b))
      .map(([key, count]) => {
        const meta = worldCupCompetitionDetailMeta(key);
        return { key, label: meta.label, short: meta.short, count };
      });
  }, [competitionFilteredRows]);

  const chartRows = useMemo(() => {
    let rows = competitionFilteredRows;
    if (tournamentFilter !== 'all') {
      rows = rows.filter((row) => row.competitionDetailKey === tournamentFilter);
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
  }, [competitionFilteredRows, tournamentFilter, timeframe, opponentTeam]);

  const values = useMemo(
    () => chartRows.map((row) => row.value).filter((value): value is number => value != null),
    [chartRows]
  );
  const lineValue =
    externalLineValue != null && Number.isFinite(externalLineValue) ? externalLineValue : 0.5;
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
    statConfig.id === 'shots_on_target' ||
    statConfig.id === 'fouls_committed' ||
    statConfig.id === 'yellow_cards';
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
    if (availableStats.some((option) => option.id === selectedStat)) return;
    const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayer?.role);
    const preferredId: WorldCupChartStatId = isGoalkeeper ? 'goalkeeper_saves' : 'passes';
    const preferredAvailable = availableStats.some((option) => option.id === preferredId);
    setSelectedStat(preferredAvailable ? preferredId : availableStats[0].id);
  }, [mode, selectedPlayer?.id, selectedPlayer?.role, availableStats, selectedStat]);

  useEffect(() => {
    if (mode !== 'team') return;
    if (!availableStats.length) return;
    const preferredId: WorldCupChartStatId = 'moneyline';
    const preferredAvailable = availableStats.some((option) => option.id === preferredId);
    setSelectedStat(preferredAvailable ? preferredId : availableStats[0].id);
  }, [mode, selectedTeam?.id, availableStats]);

  useEffect(() => {
    if (!externalChartContext) return;
    if (worldCupChartContextEqual(lastExternalChartContextRef.current ?? externalChartContext, externalChartContext)) {
      return;
    }
    lastExternalChartContextRef.current = externalChartContext;

    const nextStat = externalChartContext.statId;
    const nextTimeframe = externalChartContext.timeframe;
    const statValid = availableStats.some((option) => option.id === nextStat);
    applyingExternalChartContextRef.current = true;
    if (statValid) setSelectedStat(nextStat);
    setTimeframe(nextTimeframe);
  }, [externalChartContext, availableStats]);

  useEffect(() => {
    if (applyingExternalChartContextRef.current) {
      applyingExternalChartContextRef.current = false;
      return;
    }
    onChartContextChange?.({
      statId: statConfig.id,
      statKey,
      statLabel: statConfig.label,
      timeframe,
    });
  }, [onChartContextChange, statConfig.id, statConfig.label, statKey, timeframe]);

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      const tf = timeframeDropdownRef.current;
      if (tf && !tf.contains(event.target)) setIsTimeframeDropdownOpen(false);
      const comp = competitionDropdownRef.current;
      if (comp && !comp.contains(event.target)) setIsCompetitionDropdownOpen(false);
      const tournament = tournamentDropdownRef.current;
      if (tournament && !tournament.contains(event.target)) setIsTournamentDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Reset the competition filter when the chosen competition is no longer in
  // the current selection (e.g. after switching team/player).
  useEffect(() => {
    if (competitionFilter === 'all') return;
    if (!chartCompetitions.some((entry) => entry.group === competitionFilter)) {
      setCompetitionFilter('all');
    }
  }, [chartCompetitions, competitionFilter]);

  // Reset tournament when switching back to all games (club + international).
  useEffect(() => {
    if (competitionFilter === 'all') {
      setTournamentFilter('all');
    }
  }, [competitionFilter]);

  // Reset the tournament filter when the chosen tournament is no longer available.
  useEffect(() => {
    if (tournamentFilter === 'all') return;
    if (!chartTournaments.some((entry) => entry.key === tournamentFilter)) {
      setTournamentFilter('all');
    }
  }, [chartTournaments, tournamentFilter]);

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

  const chartAnimationKey = useMemo(() => {
    const first = chartRows[0]?.xKey ?? '';
    const last = chartRows[chartRows.length - 1]?.xKey ?? '';
    return `${mode}|${statConfig.id}|${timeframe}|${perspective}|${competitionFilter}|${tournamentFilter}|${chartRows.length}|${first}|${last}`;
  }, [
    mode,
    statConfig.id,
    timeframe,
    perspective,
    competitionFilter,
    tournamentFilter,
    chartRows,
  ]);

  if (loading && !data) {
    return <WorldCupChartSkeleton isDark={isDark} />;
  }

  const awaitingChartRows =
    !error &&
    chartRows.length === 0 &&
    Boolean(selectedPlayer || selectedTeam) &&
    (!data || !(data.playerMatchStats?.length || data.teamMatchStats?.length));

  if (error) {
    return <EmptyState text={error} className="h-full" />;
  }

  const hasClubAndInternational = chartCompetitions.length > 1;
  const showGroupCompetitionPicker = hasClubAndInternational;
  const showTournamentCompetitionPicker =
    chartTournaments.length > 1 &&
    (competitionFilter !== 'all' || !showGroupCompetitionPicker);

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
                  onExternalLineChange?.(snapped);
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
            <>
              {mode === 'player' && selectedPlayer ? (
                <WorldCupLineSelector
                  books={playerOddsBooks ?? []}
                  statId={statConfig.id}
                  selectedBookIndex={selectedBookIndex ?? 0}
                  onSelectBookIndex={onSelectBookIndex ?? (() => {})}
                  oddsFormat={oddsFormat ?? DEFAULT_ODDS_FORMAT}
                  isDark={isDark}
                  loading={Boolean(playerOddsLoading)}
                  disabled={!WC_PLAYER_ODDS_STATS.has(statConfig.id)}
                  currentLineValue={currentLineValue ?? lineValue}
                  onSelectLineValue={onSelectOddsLine ?? onExternalLineChange}
                />
              ) : null}
              <input
                id="world-cup-betting-line-input"
                type="number"
                step={0.5}
                value={lineValue}
                min={0}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  onExternalLineChange?.(next);
                }}
                className="w-20 sm:w-20 md:w-22 px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                aria-label={`Set line value for ${statConfig.label}`}
              />
            </>
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
          {showGroupCompetitionPicker ? (
            <div className="relative ml-auto" ref={competitionDropdownRef}>
              <button
                type="button"
                onClick={() => setIsCompetitionDropdownOpen((prev) => !prev)}
                className="min-w-[108px] px-2.5 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-600"
                aria-label="Filter by club or international"
              >
                <span className="truncate">
                  {competitionFilter === 'all'
                    ? 'Competition'
                    : `${worldCupChartCompetitionGroupLabel(competitionFilter)} ${chartCompetitions.find((entry) => entry.group === competitionFilter)?.count ?? ''}`}
                </span>
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isCompetitionDropdownOpen ? (
                <div className="absolute top-full right-0 mt-1 w-36 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {chartCompetitions.map((entry) => (
                    <button
                      key={entry.group}
                      type="button"
                      onClick={() => {
                        setCompetitionFilter(entry.group);
                        setIsCompetitionDropdownOpen(false);
                      }}
                      className={`w-full px-2 py-1.5 text-xs font-medium text-left flex items-center justify-between gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg ${
                        competitionFilter === entry.group
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
          {showTournamentCompetitionPicker ? (
            <div
              className={`relative ${showGroupCompetitionPicker ? '' : 'ml-auto'}`}
              ref={tournamentDropdownRef}
            >
              <button
                type="button"
                onClick={() => setIsTournamentDropdownOpen((prev) => !prev)}
                className="min-w-[120px] px-2.5 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-600"
                aria-label="Filter games by competition"
              >
                <span className="truncate">
                  {tournamentFilter === 'all'
                    ? 'Competition'
                    : `${chartTournaments.find((entry) => entry.key === tournamentFilter)?.short ?? 'Competition'} ${
                        chartTournaments.find((entry) => entry.key === tournamentFilter)?.count ?? ''
                      }`}
                </span>
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isTournamentDropdownOpen ? (
                <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {chartTournaments.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => {
                        setTournamentFilter(entry.key);
                        setIsTournamentDropdownOpen(false);
                      }}
                      className={`w-full px-2 py-1.5 text-xs font-medium text-left flex items-center justify-between gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg ${
                        tournamentFilter === entry.key
                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      <span className="truncate">{entry.label}</span>
                      <span className="text-gray-500 dark:text-gray-400 shrink-0">{entry.count}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setTournamentFilter('all');
                      setIsTournamentDropdownOpen(false);
                    }}
                    className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 last:rounded-b-lg ${
                      tournamentFilter === 'all'
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
        {(loading && !data) || awaitingChartRows ? (
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
            chartAnimationKey={chartAnimationKey}
            barAnimationDuration={WC_BAR_ANIMATION_MS}
            barAnimationEasing="ease-out"
            centerAverageOverlay
            averageOverlayInsideChart
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
    return getWorldCupPlayerStatRows(data.playerMatchStats ?? [], selectedPlayerId);
  }
  return (data.teamMatchStats ?? []).filter((row) => !selectedTeamId || String(row.team_id ?? '') === selectedTeamId);
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

type WorldCupSupportingStatsProps = {
  data: WorldCupDashboardData | null;
  mode: PropsMode;
  selectedPlayerRole?: string | null;
  selectedPlayerId: string | null;
  selectedTeamId: string | null;
  selectedTeamName?: string | null;
  opponentTeam: WorldCupTeamOption | null;
  chartContext: WorldCupChartContext;
  isDark: boolean;
  competition: Competition;
};

function worldCupSupportingStatsPropsEqual(
  prev: WorldCupSupportingStatsProps,
  next: WorldCupSupportingStatsProps
): boolean {
  return (
    prev.mode === next.mode &&
    prev.selectedPlayerId === next.selectedPlayerId &&
    prev.selectedTeamId === next.selectedTeamId &&
    (prev.selectedTeamName ?? null) === (next.selectedTeamName ?? null) &&
    (prev.selectedPlayerRole ?? null) === (next.selectedPlayerRole ?? null) &&
    prev.isDark === next.isDark &&
    prev.competition === next.competition &&
    worldCupChartContextEqual(prev.chartContext, next.chartContext) &&
    worldCupOpponentTeamEqual(prev.opponentTeam, next.opponentTeam) &&
    worldCupSupportingDataFingerprint(prev.data) === worldCupSupportingDataFingerprint(next.data)
  );
}

const WorldCupSupportingStats = memo(function WorldCupSupportingStats({
  data,
  mode,
  selectedPlayerRole,
  selectedPlayerId,
  selectedTeamId,
  selectedTeamName,
  opponentTeam,
  chartContext,
  isDark,
  competition,
}: WorldCupSupportingStatsProps) {
  const [selectedSupportingStat, setSelectedSupportingStat] = useState('');
  const effectiveTeamName = selectedTeamName ?? data?.selectedTeam?.name ?? null;
  const rows = useMemo(
    () =>
      filterWorldCupRowsByTimeframe(
        dedupeWorldCupPlayerStatRowsByGame(
          getWorldCupRowsForMode(data, mode, selectedPlayerId, selectedTeamId),
          data?.matches ?? [],
          data?.playerMatches ?? [],
          selectedTeamId,
          effectiveTeamName
        ),
        data,
        chartContext.timeframe,
        opponentTeam
      ),
    [chartContext.timeframe, data, mode, selectedPlayerId, selectedTeamId, effectiveTeamName, opponentTeam]
  );
  // Full team rows (not timeframe-limited) used to detect which supporting
  // stats are symmetric across every competition the team played.
  const teamSymmetryRows = useMemo(() => {
    if (mode !== 'team' || !data) return [] as Array<Record<string, any>>;
    return (data.teamMatchStats ?? []).filter((row) => !selectedTeamId || String(row.team_id ?? '') === selectedTeamId);
  }, [mode, data, selectedTeamId]);

  const supportingOptions = useMemo(() => {
    const candidates = buildWorldCupSupportingKeys(chartContext.statKey, mode);
    const isGoalkeeper = isWorldCupGoalkeeperRole(selectedPlayerRole);
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
  }, [chartContext.statKey, mode, selectedPlayerRole, competition, teamSymmetryRows]);

  useEffect(() => {
    if (!supportingOptions.length) {
      setSelectedSupportingStat('');
      return;
    }
    if (selectedSupportingStat && supportingOptions.includes(selectedSupportingStat)) return;
    setSelectedSupportingStat(supportingOptions[0]);
  }, [selectedSupportingStat, supportingOptions]);

  const resolveSupportingStatValue = useCallback(
    (row: Record<string, any>, statKey: string): number | null => {
      if (mode === 'team') {
        const match = resolveWorldCupMatchForStatRow(
          row,
          data?.matches ?? [],
          data?.playerMatches ?? [],
          selectedTeamId,
          effectiveTeamName
        );
        return resolveWorldCupTeamStatValue(row, match, statKey, 'team');
      }
      return getWorldCupStatNumber(row, statKey);
    },
    [mode, data?.matches, data?.playerMatches, selectedTeamId, effectiveTeamName]
  );

  const averagesByStat = useMemo(() => {
    const averages = new Map<string, number | null>();
    for (const stat of supportingOptions) {
      const values = rows
        .map((row) => resolveSupportingStatValue(row, stat))
        .filter((value): value is number => value != null);
      averages.set(stat, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
    }
    return averages;
  }, [rows, supportingOptions, resolveSupportingStatValue]);

  const selectedRows = useMemo(() => {
    if (!selectedSupportingStat) return [];
    const countryLookup = buildWorldCupTeamCountryLookup(data?.teams ?? []);
    const uniqueRows = rows;
    return uniqueRows.map((row, index) => {
      const match = resolveWorldCupMatchForStatRow(
        row,
        data?.matches ?? [],
        data?.playerMatches ?? [],
        selectedTeamId,
        effectiveTeamName
      );
      const { isHome, opponentLabel, opponentCountryCode, opponentTeamId } = resolveWorldCupPlayerChartContext(
        row,
        match,
        selectedTeamId,
        countryLookup,
        effectiveTeamName
      );
      const competitionTag = deriveWorldCupCompetitionTag(row, match);
      const opponentLogoUrl = resolveWorldCupOpponentLogoUrl({
        row,
        match,
        competitionTag,
        opponentTeamId,
        opponentLabel,
        opponentCountryCode,
      });
      const rowKey = worldCupStatRowMergeKey(row) || `supporting-row-${index}`;
      if (effectiveTeamName && worldCupTeamsMatch(effectiveTeamName, opponentLabel)) {
        return null;
      }
      return {
        key: rowKey,
        xKey: rowKey,
        tickLabel: getTeamAbbreviationFromLabel(opponentLabel),
        tickDateLabel: getWorldCupTickDateLabel(match?.datetime),
        opponent: opponentLabel,
        opponentCountryCode,
        opponentLogoUrl,
        venue: isHome ? 'HOME' : 'AWAY',
        value: resolveSupportingStatValue(row, selectedSupportingStat) ?? 0,
        gameDate: typeof match?.datetime === 'string' ? match.datetime : '',
        matchLabel: match ? `${match.homeLabel || 'TBD'} vs ${match.awayLabel || 'TBD'}` : `Match ${String(row.match_id)}`,
      };
    }).filter((row): row is NonNullable<typeof row> => row != null);
  }, [data?.teams, rows, selectedSupportingStat, selectedTeamId, effectiveTeamName, resolveSupportingStatValue]);

  const supportingAnimationTrigger = useMemo(
    () => `${mode}|${chartContext.statKey}|${selectedSupportingStat}|${chartContext.timeframe}`,
    [mode, chartContext.statKey, selectedSupportingStat, chartContext.timeframe]
  );
  const lastSupportingAnimationTriggerRef = useRef(supportingAnimationTrigger);
  const shouldAnimateSupportingBars = lastSupportingAnimationTriggerRef.current !== supportingAnimationTrigger;
  if (shouldAnimateSupportingBars) {
    lastSupportingAnimationTriggerRef.current = supportingAnimationTrigger;
  }

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
            <BarChart
              data={selectedRows}
              margin={{ top: 24, right: 0, left: 0, bottom: 4 }}
              barCategoryGap="5%"
            >
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
                isAnimationActive={shouldAnimateSupportingBars}
                animationDuration={shouldAnimateSupportingBars ? WC_BAR_ANIMATION_MS : 0}
                animationEasing="ease-out"
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
}, worldCupSupportingStatsPropsEqual);

const WORLD_CUP_SEARCH_SHELL_CLASS = 'relative mx-auto w-full max-w-xl lg:max-w-lg';

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
    <div className="relative w-full">
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

const WORLD_CUP_PLACEHOLDER_PLAYER_IDS = new Set(WORLD_CUP_PLAYERS.map((player) => player.id));

const WORLD_CUP_POSITION_PILL_STYLES: Record<
  WorldCupPositionGroup,
  { light: string; dark: string }
> = {
  GK: {
    light: 'bg-amber-100 text-amber-800 ring-amber-200/80',
    dark: 'bg-amber-500/20 text-amber-200 ring-amber-400/30',
  },
  DEF: {
    light: 'bg-sky-100 text-sky-800 ring-sky-200/80',
    dark: 'bg-sky-500/20 text-sky-200 ring-sky-400/30',
  },
  MID: {
    light: 'bg-emerald-100 text-emerald-800 ring-emerald-200/80',
    dark: 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/30',
  },
  FWD: {
    light: 'bg-rose-100 text-rose-800 ring-rose-200/80',
    dark: 'bg-rose-500/20 text-rose-200 ring-rose-400/30',
  },
};

function worldCupPlayerInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts.at(-1)![0] ?? ''}`.toUpperCase();
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
  wcOnly?: boolean;
  /** Position-agnostic set of teams that have played ≥1 WC 2026 game (wcOnly mode only). */
  wcTeamsWithGames?: string[];
};

function worldCupDvpBundleKey(position: string): string {
  return `${position}:w0:wc`;
}

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
  dvpBundles,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  opponentTeam: WorldCupTeamOption | null;
  teamOptions: WorldCupTeamOption[];
  competition: Competition;
  dvpBundles?: Record<string, WorldCupDvpResponse>;
}) {
  const playerPosition = useMemo<WorldCupDvpPosition>(
    () => getWorldCupPlayerGroup(selectedPlayer),
    [selectedPlayer]
  );
  const [posSel, setPosSel] = useState<WorldCupDvpPosition>(playerPosition);
  const [oppSel, setOppSel] = useState<string>(opponentTeam?.id ?? '');
  const [posOpen, setPosOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
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
    const bundleKey = worldCupDvpBundleKey(posSel);
    const bundled = dvpBundles?.[bundleKey];
    if (bundled) {
      setDvpData(bundled);
      setDvpLoading(false);
      setDvpError(null);
      return () => {
        cancelled = true;
      };
    }

    setDvpLoading(true);
    setDvpError(null);
    const statKeys = dvpMetrics.map((m) => m.key).join(',');
    const url = `/api/world-cup/dashboard?dvpBatch=1&competition=${encodeURIComponent(competition)}&position=${posSel}&window=0&wcOnly=1&stats=${encodeURIComponent(statKeys)}`;
    fetchWorldCupDashboardJson<WorldCupDvpResponse>(url)
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
  }, [posSel, competition, dvpBundles]);

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
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold border bg-amber-500 border-amber-500 text-white">
          🏆 WC 2026
        </span>
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
          ) : opponentSlug && !dvpLoading && dvpData && dvpData.wcTeamsWithGames && !dvpData.wcTeamsWithGames.includes(opponentSlug) ? (
            <div className={`mx-3 my-3 rounded-lg border-2 border-dashed px-3 py-6 text-center text-sm ${
              isDark ? 'border-amber-800 text-amber-300' : 'border-amber-300 text-amber-700'
            }`}>
              🏆 <span className="font-semibold">{opponentName}</span> has not yet played in the 2026 World Cup.
            </div>
          ) : !dvpLoading && dvpData && (dvpData.wcTeamsWithGames?.length ?? 0) === 0 ? (
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
  wc2026OpponentBreakdown,
}: {
  isDark: boolean;
  opponentTeam: WorldCupTeamOption | null;
  wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse;
}) {
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
    const bundled = resolveBundledWc2026OpponentBreakdown(wc2026OpponentBreakdown, undefined);

    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      oppBreakdown: '1',
      wcOnly: '1',
    });
    if (opponentTeam?.id && /^\d+$/.test(opponentTeam.id)) {
      params.set('opponentTeamId', opponentTeam.id);
      if (opponentTeam.name) params.set('opponentTeamName', opponentTeam.name);
      if (opponentTeam.countryCode) params.set('opponentCountryCode', opponentTeam.countryCode);
    }
    fetchWorldCupDashboardJson<WorldCupOppBreakdownResponse>(`/api/world-cup/dashboard?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        setBreakdown(
          bundled
            ? resolveEffectiveOpponentBreakdown(bundled, payload, opponentTeam) ?? payload
            : payload
        );
      })
      .catch((err: Error) => {
        if (cancelled) return;
        const bundledCoversOpponent =
          Boolean(bundled && opponentTeam && opponentHasBreakdownStats(bundled, opponentTeam));
        setBreakdown(bundledCoversOpponent ? bundled : null);
        setError(err.message || 'Failed to load opponent breakdown');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wc2026OpponentBreakdown, opponentTeam]);

  const opponentForLabel = opponentTeam;
  const opponentName = opponentForLabel?.name ?? '';
  const opponentSlug = resolveWorldCupTeamSlug(opponentForLabel);
  const opponentHasWc2026Stats = opponentHasBreakdownStats(breakdown, opponentForLabel);
  const opponentBreakdownSlug =
    resolveOpponentBreakdownSlug(breakdown, opponentForLabel) ??
    resolveWorldCupTeamSlugCandidates(opponentForLabel).find((slug) => (breakdown?.games?.[slug] ?? 0) > 0) ??
    opponentSlug;
  const opponentGamesUsed = opponentBreakdownSlug ? breakdown?.games?.[opponentBreakdownSlug] ?? 0 : 0;

  const totalOpponents = breakdown ? Object.keys(breakdown.names).length : 0;
  const rankedOpponents = countWorldCupOpponentBreakdownPlayedTeams(breakdown) || totalOpponents;
  const rankDenominator = rankedOpponents;
  // Flag thin samples so the user knows a "0.0 allowed" is over very few games.
  const SMALL_SAMPLE = 5;
  const lowSample = opponentGamesUsed > 0 && opponentGamesUsed < SMALL_SAMPLE;

  const formatValue = (value: number | undefined, _statKey: string) => {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toFixed(2);
  };

  const noData = Boolean(breakdown) && totalOpponents === 0;

  // Full league-table list for the selected ranking stat: every ranked nation,
  // ordered #1 (hardest / allows least) → #N (easiest / allows most).
  const rankingList = useMemo(
    () => buildWorldCupOpponentAllowedRanking(breakdown, rankingStat),
    [breakdown, rankingStat]
  );

  const rankingStatLabel =
    WORLD_CUP_OPP_BREAKDOWN_METRICS.find((m) => m.key === rankingStat)?.label ?? rankingStat;

  return (
    <div className="w-full min-w-0 h-full flex flex-col px-1.5 py-1">
      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold border bg-amber-500 border-amber-500 text-white">
          🏆 WC 2026
        </span>
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
              title={`Averaged over ${opponentGamesUsed} WC 2026 group-stage game${opponentGamesUsed === 1 ? '' : 's'}`}
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
              {`${opponentGamesUsed} WC game${opponentGamesUsed === 1 ? '' : 's'}`}
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
        ) : opponentName && !loading && breakdown && !opponentHasWc2026Stats ? (
          <div className={`rounded-lg border-2 border-dashed px-3 py-5 text-center text-sm ${
            isDark ? 'border-amber-800 text-amber-300' : 'border-amber-300 text-amber-700'
          }`}>
            🏆 <span className="font-semibold">{opponentName}</span> has not played in the 2026 World Cup yet.
          </div>
        ) : noData ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            No completed matches yet — opponent averages will populate once games are played.
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 custom-scrollbar">
              {WORLD_CUP_OPP_BREAKDOWN_METRICS.map((metric) => {
                const lookup = lookupWorldCupOpponentBreakdownMetric(
                  breakdown,
                  metric.key,
                  opponentForLabel
                );
                const value = lookup.value;
                const rank = lookup.rank ?? null;
                const styles = getWorldCupDvpRankStyles(rank, rankDenominator, isDark);
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
                        {rank != null && rank > 0 ? `#${rank}` : '—'}
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
                  const styles = getWorldCupDvpRankStyles(row.rank, rankDenominator, isDark);
                  const isSelected =
                    Boolean(opponentBreakdownSlug) &&
                    (row.slug === opponentBreakdownSlug ||
                      resolveWorldCupTeamSlugCandidates(opponentForLabel).includes(row.slug));
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
                        {row.rank != null && row.rank > 0 ? `#${row.rank}` : '—'}
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
                Easiest
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
  { label: 'Passes', playerKey: 'passes_total', poolKey: 'passes_total', opponentKey: 'passes_accurate' },
  { label: 'Yellow Cards', playerKey: 'yellow_cards', poolKey: 'yellow_cards', opponentKey: 'yellow_cards' },
];

const WORLD_CUP_GK_PLAYER_VS_TEAM_METRICS: WorldCupPvTMetric[] = [
  { label: 'Saves', playerKey: 'saves', poolKey: 'saves', opponentKey: null },
  { label: 'Goals Conceded', playerKey: 'goals_conceded', poolKey: 'goals_conceded', opponentKey: 'goals', lowerIsBetter: true },
  { label: 'Passes', playerKey: 'passes_total', poolKey: 'passes_total', opponentKey: 'passes_accurate' },
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

function buildWc2026MatchIdSet(
  matches: Array<Record<string, any>>,
  playerMatches: Array<Record<string, any>> = []
): Set<string> {
  const ids = new Set<string>();
  for (const match of [...matches, ...playerMatches]) {
    const id = String(match.id ?? '');
    if (!id) continue;
    const season = toNumber(match.season);
    if (season != null) {
      if (season === 2026) ids.add(id);
      continue;
    }
    const datetime = match.datetime ?? match.match_date;
    if (datetime && new Date(String(datetime)).getUTCFullYear() === 2026) ids.add(id);
  }
  return ids;
}

function isWorldCupFinalsCompletedPlayerRow(
  row: Record<string, any>,
  match: Record<string, any> | undefined
): boolean {
  if (match?.status && !isCompletedWorldCupMatchStatus(match.status)) return false;
  return deriveWorldCupCompetitionTag(row, match) === 'WC';
}

function isWorldCup2026CompletedPlayerRow(
  row: Record<string, any>,
  match: Record<string, any> | undefined
): boolean {
  if (!isWorldCupFinalsCompletedPlayerRow(row, match)) return false;
  const season = toNumber(row.season ?? match?.season);
  if (season != null) return season >= 2026;
  const datetime = match?.datetime ?? match?.match_date ?? row.match_date ?? row.datetime;
  if (!datetime) return false;
  return new Date(String(datetime)).getUTCFullYear() >= 2026;
}

function filterPlayerVsTeamRows(
  rows: Array<Record<string, any>>,
  playerId: string | null,
  playerName: string | null,
  matchLookup: Map<string, Record<string, any>>,
  opts?: { editionYear?: number; matchIds?: Set<string> }
): Array<Record<string, any>> {
  const rowMatchesEdition = (row: Record<string, any>, match: Record<string, any> | undefined) => {
    if (opts?.matchIds?.size) {
      const matchId = String(row.match_id ?? '');
      if (!matchId || !opts.matchIds.has(matchId)) return false;
      return isWorldCupFinalsCompletedPlayerRow(row, match);
    }
    return opts?.editionYear === 2026
      ? isWorldCup2026CompletedPlayerRow(row, match)
      : isWorldCupFinalsCompletedPlayerRow(row, match);
  };
  return resolvePlayerScopedStatRows(rows, playerId, playerName).filter((row) => {
    return rowMatchesEdition(row, matchLookup.get(String(row.match_id ?? '')));
  });
}

type WorldCupTeamShareView = 'perGame' | 'totals';

type WorldCupTeamShareMetric = {
  label: string;
  playerKey: string;
  teamKey: string;
};

const WORLD_CUP_TEAM_SHARE_METRICS: WorldCupTeamShareMetric[] = [
  { label: 'Goals', playerKey: 'goals', teamKey: 'goals' },
  { label: 'Total Shots', playerKey: 'derived_shots_total', teamKey: 'shots_total' },
  { label: 'Shots on Target', playerKey: 'shots_on_target', teamKey: 'shots_on_target' },
  { label: 'Passes', playerKey: 'passes_total', teamKey: 'passes_total' },
  { label: 'Tackles', playerKey: 'tackles', teamKey: 'tackles' },
  { label: 'Fouls Committed', playerKey: 'fouls_committed', teamKey: 'fouls' },
  { label: 'Fouls Suffered', playerKey: 'was_fouled', teamKey: 'was_fouled' },
];

function enrichWorldCupTeamRowsFromScoreline(
  rows: Array<Record<string, any>>,
  matches: Array<Record<string, any>>
): Array<Record<string, any>> {
  const byId = new Map(matches.map((match) => [String(match.id ?? ''), match]));
  return rows.map((row) => {
    const match = byId.get(String(row.match_id ?? ''));
    if (!match) return row;
    const homeId = String(match.home_team?.id ?? match.homeTeam?.id ?? '');
    const awayId = String(match.away_team?.id ?? match.awayTeam?.id ?? '');
    const teamId = String(row.team_id ?? '');
    const isHome = row.is_home === true || Boolean(homeId && teamId && homeId === teamId);
    const homeScore = toNumber(match.home_score ?? match.homeScore);
    const awayScore = toNumber(match.away_score ?? match.awayScore);
    const scoreFor = isHome ? homeScore : awayScore;
    const scoreAgainst = isHome ? awayScore : homeScore;
    const out = { ...row };
    if (scoreFor != null) {
      const rowGoals = toNumber(out.goals);
      if (rowGoals == null || rowGoals === 0) out.goals = scoreFor;
    }
    if (scoreAgainst != null) {
      const rowOppGoals = toNumber(out.opp_goals);
      if (rowOppGoals == null || rowOppGoals === 0) out.opp_goals = scoreAgainst;
    }
    return out;
  });
}

function readTeamMatchStatValue(row: Record<string, any>, teamKey: string): number | null {
  if (teamKey === 'fouls') {
    return getWorldCupStatNumber(row, 'fouls') ?? getWorldCupStatNumber(row, 'fouls_committed');
  }
  if (teamKey === 'was_fouled') {
    return getWorldCupStatNumber(row, 'was_fouled') ?? getWorldCupStatNumber(row, 'fouls_suffered');
  }
  if (teamKey === 'shots_total') {
    const direct = toNumber(row.shots_total);
    const derived = toNumber(row.derived_shots_total) ?? toNumber(row.total_shots);
    if (direct != null && derived != null) return Math.max(direct, derived);
    return direct ?? derived;
  }
  return getWorldCupStatNumber(row, teamKey);
}

function filterWorldCupTeamMatchRows(
  rows: Array<Record<string, any>>,
  teamId: string | null,
  matchLookup: Map<string, Record<string, any>>,
  opts?: { matchIds?: Set<string> }
): Array<Record<string, any>> {
  return rows.filter((row) => {
    if (teamId && String(row.team_id ?? '') !== teamId) return false;
    const matchId = String(row.match_id ?? '');
    if (opts?.matchIds?.size && (!matchId || !opts.matchIds.has(matchId))) return false;
    const match = matchLookup.get(matchId);
    if (match?.status && !isCompletedWorldCupMatchStatus(match.status)) return false;
    return deriveWorldCupCompetitionTag(row, match) === 'WC';
  });
}

function filterSquadWorldCupPlayerRows(
  rows: Array<Record<string, any>>,
  teamId: string | null,
  matchLookup: Map<string, Record<string, any>>,
  opts?: { matchIds?: Set<string> }
): Array<Record<string, any>> {
  return rows.filter((row) => {
    if (!hasWorldCupPlayerAppearance(row)) return false;
    if (teamId && String(row.team_id ?? '') !== teamId) return false;
    const matchId = String(row.match_id ?? '');
    if (opts?.matchIds?.size && (!matchId || !opts.matchIds.has(matchId))) return false;
    return isWorldCupFinalsCompletedPlayerRow(row, matchLookup.get(matchId));
  });
}

function resolveWorldCupPlayerShareValue(
  rows: Array<Record<string, any>>,
  playerKey: string,
  mode: WorldCupTeamShareView
): number | null {
  if (!rows.length) return null;
  const values = rows
    .map((row) => readPlayerVsTeamStatValue(row, playerKey))
    .filter((value): value is number => value != null);
  if (!values.length) return null;
  const summed = values.reduce((sum, value) => sum + value, 0);
  if (mode === 'totals') return summed;
  return summed / rows.length;
}

function resolveWorldCupTeamShareTeamValue(
  rows: Array<Record<string, any>>,
  teamKey: string,
  mode: WorldCupTeamShareView
): number | null {
  if (!rows.length) return null;
  const values = rows
    .map((row) => readTeamMatchStatValue(row, teamKey))
    .filter((value): value is number => value != null);
  if (!values.length) return null;
  const summed = values.reduce((sum, value) => sum + value, 0);
  if (mode === 'totals') return summed;
  return summed / rows.length;
}

function formatWorldCupTeamShareValue(value: number | null, mode: WorldCupTeamShareView): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (mode === 'totals') {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function formatWorldCupTeamSharePct(playerValue: number | null, teamValue: number | null): string | null {
  if (playerValue == null || teamValue == null || !Number.isFinite(playerValue) || !Number.isFinite(teamValue) || teamValue <= 0) {
    return null;
  }
  const pct = (playerValue / teamValue) * 100;
  return pct >= 100 ? `${Math.round(pct)}%` : `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}

function rankSquadWorldCupStat(
  squadRows: Array<Record<string, any>>,
  selectedPlayerId: string | null,
  playerKey: string,
  mode: WorldCupTeamShareView
): { rank: number; total: number; tied: number } | null {
  if (!selectedPlayerId) return null;
  const byPlayer = new Map<string, Array<Record<string, any>>>();
  for (const row of squadRows) {
    const pid = String(row.player_id ?? row.player?.id ?? '');
    if (!pid) continue;
    const bucket = byPlayer.get(pid) ?? [];
    bucket.push(row);
    byPlayer.set(pid, bucket);
  }

  const entries: Array<{ playerId: string; value: number }> = [];
  for (const [playerId, rows] of byPlayer.entries()) {
    const value = resolveWorldCupPlayerShareValue(rows, playerKey, mode);
    if (value == null || !Number.isFinite(value)) continue;
    entries.push({ playerId, value });
  }
  if (!entries.length) return null;

  const selectedValue = entries.find((entry) => entry.playerId === selectedPlayerId)?.value;
  if (selectedValue == null) return null;

  const sorted = [...entries].sort((a, b) => b.value - a.value);
  for (let i = 0; i < sorted.length; ) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1]!.value === sorted[i]!.value) end++;
    if (sorted[i]!.value === selectedValue) {
      return { rank: i + 1, total: sorted.length, tied: end - i + 1 };
    }
    i = end + 1;
  }
  return { rank: sorted.length, total: sorted.length, tied: 1 };
}

function WorldCupPlayerTeamSharePanel({
  isDark,
  selectedPlayer,
  selectedPlayerId,
  selectedTeam,
  playerMatchStats,
  teamMatchStats,
  teamWcMatchStats,
  squadPlayerMatchStats,
  matches,
  playerMatches,
  deferSquadFallback = false,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  selectedTeam: WorldCupTeamOption | null;
  playerMatchStats: Array<Record<string, any>>;
  teamMatchStats: Array<Record<string, any>>;
  teamWcMatchStats?: Array<Record<string, any>>;
  squadPlayerMatchStats?: Array<Record<string, any>>;
  matches: Array<Record<string, any>>;
  playerMatches: Array<Record<string, any>>;
  deferSquadFallback?: boolean;
}) {
  const [view, setView] = useState<WorldCupTeamShareView>('perGame');
  const [fallbackSquadStats, setFallbackSquadStats] = useState<Array<Record<string, any>>>([]);
  const [fallbackSquadLoading, setFallbackSquadLoading] = useState(false);

  const teamId = selectedPlayer?.teamId ?? selectedTeam?.id ?? null;
  const teamName = selectedTeam?.name ?? selectedPlayer?.teamName ?? 'Team';
  const hasBundledSquad = (squadPlayerMatchStats?.length ?? 0) > 0;

  const wc2026MatchIds = useMemo(
    () => buildWc2026MatchIdSet(matches, playerMatches),
    [matches, playerMatches]
  );

  const matchLookup = useMemo(() => {
    const allMatches = [...matches, ...playerMatches];
    return new Map(allMatches.map((match) => [String(match.id), match]));
  }, [matches, playerMatches]);

  useEffect(() => {
    if (deferSquadFallback || hasBundledSquad || !teamId || !/^\d+$/.test(teamId)) {
      setFallbackSquadStats([]);
      setFallbackSquadLoading(false);
      return;
    }
    let cancelled = false;
    setFallbackSquadLoading(true);
    const params = new URLSearchParams({ season: '2026', teamId });
    fetchWorldCupDashboardJson<WorldCupDashboardData>(`/api/world-cup/dashboard?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setFallbackSquadStats(Array.isArray(data?.playerMatchStats) ? data.playerMatchStats : []);
        }
      })
      .catch(() => {
        if (!cancelled) setFallbackSquadStats([]);
      })
      .finally(() => {
        if (!cancelled) setFallbackSquadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, hasBundledSquad, deferSquadFallback]);

  const playerRows = useMemo(
    () =>
      filterPlayerVsTeamRows(
        playerMatchStats,
        selectedPlayerId,
        selectedPlayer?.name ?? null,
        matchLookup,
        { editionYear: 2026, matchIds: wc2026MatchIds }
      ),
    [playerMatchStats, selectedPlayerId, selectedPlayer?.name, matchLookup, wc2026MatchIds]
  );

  const teamRows = useMemo(() => {
    const raw = (teamWcMatchStats?.length ?? 0) > 0 ? teamWcMatchStats! : teamMatchStats;
    const source =
      (teamWcMatchStats?.length ?? 0) > 0
        ? raw
        : enrichWorldCupTeamRowsFromScoreline(raw, Array.from(matchLookup.values()));
    return filterWorldCupTeamMatchRows(source, teamId, matchLookup, { matchIds: wc2026MatchIds });
  }, [teamWcMatchStats, teamMatchStats, teamId, matchLookup, wc2026MatchIds]);

  const squadRows = useMemo(() => {
    const source = hasBundledSquad
      ? squadPlayerMatchStats!
      : fallbackSquadStats.length
        ? fallbackSquadStats
        : playerMatchStats;
    return filterSquadWorldCupPlayerRows(source, teamId, matchLookup, { matchIds: wc2026MatchIds });
  }, [hasBundledSquad, squadPlayerMatchStats, fallbackSquadStats, playerMatchStats, teamId, matchLookup, wc2026MatchIds]);

  const squadLoading = !hasBundledSquad && fallbackSquadLoading;

  const dimText = isDark ? 'text-gray-500' : 'text-gray-400';

  return (
    <div className="flex w-full min-w-0 flex-col gap-1 px-0 pb-0 pt-0">
      <div className="flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-900 dark:text-white">Team Share</span>
          <span className="text-[8px] font-semibold uppercase tracking-wide text-purple-500 dark:text-purple-400">2026 WC</span>
        </div>
        <div className={`inline-flex rounded-full border overflow-hidden text-[9px] font-semibold ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            type="button"
            onClick={() => setView('perGame')}
            className={`px-2 py-0.5 transition-colors ${view === 'perGame' ? 'bg-purple-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
          >
            Per Game
          </button>
          <button
            type="button"
            onClick={() => setView('totals')}
            className={`px-2 py-0.5 transition-colors ${view === 'totals' ? 'bg-purple-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
          >
            Totals
          </button>
        </div>
      </div>

      <div className={`rounded-lg px-2 py-1.5 ${isDark ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-gray-50 border border-gray-100'}`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-gray-900 dark:text-white truncate leading-none">
              {formatWorldCupPlayerDisplayName(selectedPlayer?.name ?? '') || (
                <span className="text-gray-400 font-normal">Select player</span>
              )}
            </div>
            <div className={`text-[8px] uppercase tracking-wide mt-0.5 ${dimText}`}>
              {view === 'perGame' ? `${playerRows.length} game${playerRows.length === 1 ? '' : 's'}` : 'Total'}
            </div>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <div className="w-5 h-5 rounded-full bg-purple-500/10 ring-1 ring-purple-500/25 flex items-center justify-center">
              <span className="text-[6px] font-black tracking-widest text-purple-400">OF</span>
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-[11px] font-bold text-gray-900 dark:text-white truncate leading-none">
              {teamName}
            </div>
            <div className={`text-[8px] uppercase tracking-wide mt-0.5 ${dimText}`}>
              {view === 'perGame' ? `${teamRows.length} game${teamRows.length === 1 ? '' : 's'}` : 'Total'}
            </div>
          </div>
        </div>
      </div>

      {!selectedPlayer || !playerRows.length ? (
        <div className={`text-[10px] px-0.5 py-1 ${dimText}`}>
          Select a player with completed 2026 World Cup games.
        </div>
      ) : !teamRows.length ? (
        <div className={`text-[10px] px-0.5 py-1 ${dimText}`}>
          No completed 2026 World Cup team games found for {teamName}.
        </div>
      ) : (
        <div className="min-w-0">
          <div className="flex flex-col">
            {WORLD_CUP_TEAM_SHARE_METRICS.map((metric) => {
              const playerValue = resolveWorldCupPlayerShareValue(playerRows, metric.playerKey, view);
              const teamValue = resolveWorldCupTeamShareTeamValue(teamRows, metric.teamKey, view);
              const sharePct = formatWorldCupTeamSharePct(playerValue, teamValue);
              const shareNum =
                playerValue != null && teamValue != null && teamValue > 0
                  ? Math.min(100, (playerValue / teamValue) * 100)
                  : null;
              const rank = rankSquadWorldCupStat(squadRows, selectedPlayerId, metric.playerKey, view);

              return (
                <div
                  key={metric.label}
                  className={`py-1 border-b last:border-0 ${isDark ? 'border-white/[0.05]' : 'border-gray-100'}`}
                >
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2">
                    <div className="flex items-center justify-end gap-1 min-w-0">
                      <span className="text-[12px] font-bold tabular-nums text-gray-900 dark:text-white leading-none">
                        {formatWorldCupTeamShareValue(playerValue, view)}
                      </span>
                      {squadLoading ? (
                        <span className="w-7 h-3.5 rounded bg-gray-200 dark:bg-white/5 animate-pulse" />
                      ) : (
                        renderWorldCupPlayerRankBadge(rank) ?? <span className="w-7" />
                      )}
                    </div>

                    <div className="w-14 sm:w-16 text-center shrink-0">
                      <div className={`text-[8px] font-semibold uppercase tracking-wide leading-none ${dimText}`}>
                        {metric.label}
                      </div>
                      {sharePct ? (
                        <div className="text-[10px] font-bold tabular-nums text-purple-500 dark:text-purple-400 leading-none mt-0.5">
                          {sharePct}
                        </div>
                      ) : (
                        <div className={`text-[10px] font-bold leading-none mt-0.5 ${dimText}`}>—</div>
                      )}
                    </div>

                    <div className="flex items-center justify-start min-w-0">
                      <span className="text-[12px] font-bold tabular-nums text-gray-900 dark:text-white leading-none">
                        {formatWorldCupTeamShareValue(teamValue, view)}
                      </span>
                    </div>
                  </div>

                  {shareNum != null ? (
                    <div className={`mt-0.5 h-1 rounded-full overflow-hidden ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}>
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 to-violet-400 transition-[width] duration-300 ease-out"
                        style={{ width: `${shareNum}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
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
  playerVsPool,
  wc2026OpponentBreakdown,
  embedded = false,
  deferPanelFallbacks = false,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  playerMatchStats: Array<Record<string, any>>;
  matches: Array<Record<string, any>>;
  playerMatches: Array<Record<string, any>>;
  playerVsPool?: WorldCupDashboardData['playerVsPool'];
  wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse;
  embedded?: boolean;
  deferPanelFallbacks?: boolean;
}) {
  const [rankScope, setRankScope] = useState<WorldCupPlayerVsRankScope>('team');
  const [fallbackPlayerPool, setFallbackPlayerPool] = useState<WorldCupPlayerPoolEntry[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const bundledBreakdown = useMemo(
    () => resolveBundledWc2026OpponentBreakdown(wc2026OpponentBreakdown, playerVsPool),
    [wc2026OpponentBreakdown, playerVsPool]
  );
  const [fetchedBreakdown, setFetchedBreakdown] = useState<WorldCupOppBreakdownResponse | null>(null);
  const [oppBreakdownLoading, setOppBreakdownLoading] = useState(!bundledBreakdown);
  const [error, setError] = useState<string | null>(null);

  const hasBundledPool = (playerVsPool?.players?.length ?? 0) > 0;
  const playerPool = useMemo(
    () => (hasBundledPool ? (playerVsPool!.players ?? []) : fallbackPlayerPool).filter((entry) => entry.games > 0),
    [hasBundledPool, playerVsPool, fallbackPlayerPool]
  );
  const breakdown = useMemo(
    () => resolveEffectiveOpponentBreakdown(bundledBreakdown, fetchedBreakdown, opponentTeam),
    [bundledBreakdown, fetchedBreakdown, opponentTeam]
  );
  const loading = poolLoading || (!breakdown && oppBreakdownLoading);

  const wc2026MatchIds = useMemo(
    () => buildWc2026MatchIdSet(matches, playerMatches),
    [matches, playerMatches]
  );

  const matchLookup = useMemo(() => {
    const allMatches = [...matches, ...playerMatches];
    return new Map(allMatches.map((match) => [String(match.id), match]));
  }, [matches, playerMatches]);

  const playerRows = useMemo(
    () =>
      filterPlayerVsTeamRows(
        playerMatchStats,
        selectedPlayerId,
        selectedPlayer?.name ?? null,
        matchLookup,
        { editionYear: 2026, matchIds: wc2026MatchIds }
      ),
    [playerMatchStats, selectedPlayerId, selectedPlayer?.name, matchLookup, wc2026MatchIds]
  );

  const teamSlug = useMemo(() => resolveWorldCupTeamSlug(selectedTeam), [selectedTeam]);
  const opponentSlug = useMemo(() => resolveWorldCupTeamSlug(opponentTeam), [opponentTeam]);
  const opponentLiveFetchRef = useRef<string | null>(null);

  useEffect(() => {
    opponentLiveFetchRef.current = null;
  }, [opponentTeam?.id, bundledBreakdown]);

  useEffect(() => {
    if (deferPanelFallbacks) {
      setOppBreakdownLoading(Boolean(bundledBreakdown));
      return;
    }
    if (
      bundledBreakdown &&
      (!opponentTeam || opponentHasBreakdownStats(bundledBreakdown, opponentTeam))
    ) {
      setOppBreakdownLoading(false);
      return;
    }

    let cancelled = false;
    setOppBreakdownLoading(true);
    const params = new URLSearchParams({
      oppBreakdown: '1',
      wcOnly: '1',
    });
    if (opponentTeam?.id && /^\d+$/.test(opponentTeam.id)) {
      params.set('opponentTeamId', opponentTeam.id);
      if (opponentTeam.name) params.set('opponentTeamName', opponentTeam.name);
      if (opponentTeam.countryCode) params.set('opponentCountryCode', opponentTeam.countryCode);
    }
    fetchWorldCupDashboardJson<WorldCupOppBreakdownResponse>(`/api/world-cup/dashboard?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        if (hasWorldCupOpponentBreakdownData(payload)) {
          setFetchedBreakdown(payload);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load WC 2026 opponent stats');
        }
      })
      .finally(() => {
        if (!cancelled) setOppBreakdownLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bundledBreakdown, opponentTeam?.id, opponentTeam?.name, opponentTeam?.countryCode, deferPanelFallbacks]);

  useEffect(() => {
    if (deferPanelFallbacks) return;
    if (!opponentTeam?.id || !/^\d+$/.test(opponentTeam.id)) return;
    if (opponentHasBreakdownStats(breakdown, opponentTeam)) return;

    const fetchKey = `${opponentTeam.id}:${Boolean(bundledBreakdown)}`;
    if (opponentLiveFetchRef.current === fetchKey) return;
    opponentLiveFetchRef.current = fetchKey;

    let cancelled = false;
    setOppBreakdownLoading(true);
    const params = new URLSearchParams({
      playerVsPool: '1',
      scope: 'worldcup',
      opponentTeamId: opponentTeam.id,
    });
    if (opponentTeam.name) params.set('opponentTeamName', opponentTeam.name);
    if (opponentTeam.countryCode) params.set('opponentCountryCode', opponentTeam.countryCode);

    fetchWorldCupDashboardJson<{
      opponentBreakdown?: WorldCupOppBreakdownResponse;
      wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse;
    }>(`/api/world-cup/dashboard?${params.toString()}`)
      .then((poolPayload) => {
        if (cancelled) return;
        const poolBreakdown = resolveBundledWc2026OpponentBreakdown(poolPayload.wc2026OpponentBreakdown, {
          opponentBreakdown: poolPayload.opponentBreakdown,
          wc2026OpponentBreakdown: poolPayload.wc2026OpponentBreakdown,
        });
        if (poolBreakdown && opponentHasBreakdownStats(poolBreakdown, opponentTeam)) {
          setFetchedBreakdown(poolBreakdown);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setOppBreakdownLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [breakdown, opponentTeam, deferPanelFallbacks]);

  useEffect(() => {
    if (deferPanelFallbacks) {
      setFallbackPlayerPool([]);
      setPoolLoading(false);
      return;
    }
    if (hasBundledPool) {
      setFallbackPlayerPool([]);
      setPoolLoading(false);
      return;
    }
    let cancelled = false;
    setPoolLoading(true);
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
    fetchWorldCupDashboardJson<{
      players?: WorldCupPlayerPoolEntry[];
      opponentBreakdown?: WorldCupOppBreakdownResponse;
      wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse;
    }>(`/api/world-cup/dashboard?${params.toString()}`)
      .then((poolPayload) => {
        if (cancelled) return;
        setFallbackPlayerPool(Array.isArray(poolPayload.players) ? poolPayload.players : []);
        const poolBreakdown = resolveBundledWc2026OpponentBreakdown(poolPayload.wc2026OpponentBreakdown, {
          opponentBreakdown: poolPayload.opponentBreakdown,
          wc2026OpponentBreakdown: poolPayload.wc2026OpponentBreakdown,
        });
        if (poolBreakdown) {
          setFetchedBreakdown(poolBreakdown);
          setOppBreakdownLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setFallbackPlayerPool([]);
          setError(err.message || 'Failed to load Player vs Team data');
        }
      })
      .finally(() => {
        if (!cancelled) setPoolLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasBundledPool, selectedPlayerId, teamSlug, opponentSlug, opponentTeam?.id, opponentTeam?.name, opponentTeam?.countryCode, playerMatchStats.length, deferPanelFallbacks]);

  const totalOpponents = Math.max(
    breakdown?.rankingTotal ?? 0,
    Object.keys(breakdown?.names ?? {}).length
  ) || 48;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 px-0.5 pb-0.5 pt-0.5 xl:px-1 xl:pb-1 xl:pt-1">

      {/* ── Title + scope toggle ── */}
      <div className="flex items-center shrink-0 justify-between gap-2">
        <div className="min-w-0">
          {!embedded ? (
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-900 dark:text-white">Player vs Team</span>
          ) : null}
          <span
            className={`${embedded ? 'block' : 'ml-1.5'} text-[9px] font-semibold uppercase tracking-widest text-purple-500 dark:text-purple-400`}
          >
            2026 World Cup only
          </span>
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
              {formatWorldCupPlayerDisplayName(selectedPlayer?.name ?? '') || (
                <span className="text-gray-400 font-normal">Select player</span>
              )}
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
  competitionDetailLabel?: string;
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
  const [opponentData, setOpponentData] = useState<WorldCupTeamFormResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId || !/^\d+$/.test(teamId)) {
      setData(null);
      setOpponentData(null);
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

    fetchWorldCupDashboardJson<WorldCupTeamFormResponse>(`/api/world-cup/dashboard?${params.toString()}`, {
      signal: controller.signal,
      skipCache: true,
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

  useEffect(() => {
    if (!opponentId || !/^\d+$/.test(opponentId)) {
      setOpponentData(null);
      return;
    }
    if ((data?.opponentAll?.length ?? 0) > 0 || (data?.opponentRecent?.length ?? 0) > 0) {
      setOpponentData(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ teamForm: '1', teamId: opponentId, competition });

    fetchWorldCupDashboardJson<WorldCupTeamFormResponse>(`/api/world-cup/dashboard?${params.toString()}`, {
      signal: controller.signal,
      skipCache: true,
    })
      .then((payload) => {
        if (!cancelled) setOpponentData(payload);
      })
      .catch(() => {
        if (!cancelled) setOpponentData(null);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [competition, data?.opponentAll, data?.opponentRecent, opponentId]);

  return { data, opponentData, loading, error };
}

// Map the active competition view to a short tag for the client-side fallback
// (used for Euros / Nations League, where the API returns single-competition
// matches rather than the cross-source `teamRecent` payload).
function worldCupCompetitionTagForFallback(competition: Competition): string {
  if (competition === 'euros') return 'Euros';
  if (competition === 'nations-league') return 'NL';
  return 'WC';
}

function worldCupRecentFormOutcome(
  goalsFor: number | null | undefined,
  goalsAgainst: number | null | undefined
): 'W' | 'D' | 'L' | null {
  if (goalsFor == null || goalsAgainst == null) return null;
  if (goalsFor > goalsAgainst) return 'W';
  if (goalsFor < goalsAgainst) return 'L';
  return 'D';
}

// Fallback when the API didn't supply cross-source `teamRecent` (Euros / Nations
// League views): build a team's last 5 games from the single-competition match
// list the team-form endpoint returned.
function buildWorldCupClientRecentForm(
  matches: WorldCupFormMatch[],
  teamId: number | null,
  statsByPair: Map<string, WorldCupTeamMatchStatRow>,
  competition: Competition,
  limit: number | null = 5
): WorldCupRecentFormGame[] {
  if (teamId == null) return [];
  const teamKey = String(teamId);
  const sorted = [...matches]
    .filter((match) => String(match.homeTeam?.id) === teamKey || String(match.awayTeam?.id) === teamKey)
    .sort((a, b) => (Date.parse(b.datetime || '') || 0) - (Date.parse(a.datetime || '') || 0));
  const scoped = limit == null ? sorted : sorted.slice(0, limit);

  return scoped.map((match) => {
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
    const competitionTag = worldCupCompetitionTagForFallback(competition);
    return {
      matchId: String(match.id),
      datetime: match.datetime,
      competitionTag,
      competitionDetailLabel: worldCupCompetitionDetailMeta(competitionTag).label,
      isHome,
      goalsFor: goalsFor ?? null,
      goalsAgainst: goalsAgainst ?? null,
      outcome: worldCupRecentFormOutcome(goalsFor, goalsAgainst),
      penaltyWin: null,
      opponentName: oppName,
      opponentCode: resolveWorldCupFlagCode(oppName) || null,
      stats,
      statsAgainst,
    };
  });
}

const WORLD_CUP_COMPARE_FORM_STAT_KEYS = [
  'goals',
  'shots_total',
  'shots_on_target',
  'corners',
  'possession_pct',
  'passes_accurate',
  'fouls',
  'yellow_cards',
  'red_cards',
] as const;

function buildWorldCupRecentFormFromStatRows(
  statRows: Array<Record<string, any>>,
  matchLookup: Map<string, Record<string, any>>,
  teamId: string | number
): WorldCupRecentFormGame[] {
  const teamKey = String(teamId);
  const sorted = [...statRows]
    .filter((row) => String(row.team_id ?? '') === teamKey)
    .sort((a, b) => {
      const aTime = Date.parse(String(matchLookup.get(String(a.match_id))?.datetime ?? '')) || 0;
      const bTime = Date.parse(String(matchLookup.get(String(b.match_id))?.datetime ?? '')) || 0;
      return bTime - aTime;
    });

  return sorted
    .map((row) => {
      const match = matchLookup.get(String(row.match_id));
      const isHome = row.is_home === true;
      const goalsFor =
        readWorldCupStatNumber(row as WorldCupTeamMatchStatRow, 'goals') ??
        (isHome ? toNumber(match?.homeScore ?? match?.home_score) : toNumber(match?.awayScore ?? match?.away_score));
      const goalsAgainst =
        readWorldCupStatNumber(row as WorldCupTeamMatchStatRow, 'opp_goals') ??
        (isHome ? toNumber(match?.awayScore ?? match?.away_score) : toNumber(match?.homeScore ?? match?.home_score));
      const oppTeam = isHome ? match?.awayTeam ?? match?.away_team : match?.homeTeam ?? match?.home_team;
      const oppLabel = isHome
        ? String(match?.awayLabel || oppTeam?.name || 'Opponent')
        : String(match?.homeLabel || oppTeam?.name || 'Opponent');
      const stats: Record<string, number | null> = {};
      const statsAgainst: Record<string, number | null> = {};
      for (const key of WORLD_CUP_COMPARE_FORM_STAT_KEYS) {
        stats[key] = readWorldCupStatNumber(row as WorldCupTeamMatchStatRow, key);
        statsAgainst[key] = readWorldCupStatNumber(row as WorldCupTeamMatchStatRow, `opp_${key}`);
      }
      if (stats.goals == null && goalsFor != null) stats.goals = goalsFor;
      if (statsAgainst.goals == null && goalsAgainst != null) statsAgainst.goals = goalsAgainst;
      if (stats.passes_accurate == null) {
        stats.passes_accurate = readWorldCupStatNumber(row as WorldCupTeamMatchStatRow, 'passes_total');
      }
      return {
        matchId: String(row.match_id),
        datetime: typeof match?.datetime === 'string' ? match.datetime : null,
        competitionTag: deriveWorldCupCompetitionTag(row, match),
        competitionDetailLabel: worldCupCompetitionDetailMeta(deriveWorldCupCompetitionDetailKey(row, match)).label,
        isHome,
        goalsFor,
        goalsAgainst,
        outcome: worldCupRecentFormOutcome(goalsFor, goalsAgainst),
        penaltyWin: null,
        opponentName: oppLabel,
        opponentCode:
          resolveWorldCupFlagCode(oppTeam?.country_code) ||
          resolveWorldCupFlagCode(oppTeam?.abbreviation) ||
          resolveWorldCupFlagCode(oppLabel) ||
          null,
        stats,
        statsAgainst,
      };
    })
    .filter((game) => game.goalsFor != null || Object.values(game.stats).some((value) => value != null));
}

function resolveWorldCupCompareGames(opts: {
  teamId: string | number | null;
  apiAll?: WorldCupRecentFormGame[];
  apiRecent?: WorldCupRecentFormGame[];
  apiMatches?: WorldCupFormMatch[];
  apiNumericTeamId?: number | null;
  apiStatsByPair: Map<string, WorldCupTeamMatchStatRow>;
  dashboardStatRows?: Array<Record<string, any>>;
  dashboardMatches?: Array<Record<string, any>>;
  competition: Competition;
}): WorldCupRecentFormGame[] {
  if (opts.apiAll?.length) return opts.apiAll;
  if (opts.apiRecent?.length) return opts.apiRecent;
  if (opts.teamId != null && (opts.dashboardStatRows?.length ?? 0) > 0) {
    const matchLookup = buildWorldCupMatchLookup(opts.dashboardMatches ?? [], []);
    const fromDashboard = buildWorldCupRecentFormFromStatRows(
      opts.dashboardStatRows ?? [],
      matchLookup,
      opts.teamId
    );
    if (fromDashboard.length) return fromDashboard;
  }
  if (opts.apiMatches?.length && opts.apiNumericTeamId != null) {
    return buildWorldCupClientRecentForm(
      opts.apiMatches,
      opts.apiNumericTeamId,
      opts.apiStatsByPair,
      opts.competition,
      null
    );
  }
  return [];
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
    let value: number | null | undefined;
    if (perspective === 'against' && key === 'goals') {
      value = game.statsAgainst?.[key] ?? game.goalsAgainst;
    } else {
      const source = perspective === 'against' ? game.statsAgainst : game.stats;
      value = source?.[key];
      if (perspective === 'for' && key === 'goals' && (value == null || !Number.isFinite(value))) {
        value = game.goalsFor;
      }
    }
    if (value != null && Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function formatWorldCupRecentStatValue(value: number | null, statKey?: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (statKey === 'goals') return value.toFixed(2);
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
        {game.competitionDetailLabel ?? game.competitionTag ?? '—'}
      </span>
      <span className={`w-14 shrink-0 whitespace-nowrap text-left text-[10px] tabular-nums leading-none ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        {dateLabel}
      </span>
    </div>
  );
}

type WorldCupTeammateOption = {
  id: string;
  name: string;
  isDefaultEligible: boolean;
};

function lookupWorldCupRosterMeta(
  rosters: Array<Record<string, any>>,
  playerId: string
): { positionGroup: WorldCupPositionGroup; number: string | null } | null {
  for (const row of rosters) {
    const player = row.player ?? {};
    const pid = String(player.id ?? row.player_id ?? '');
    if (pid !== playerId) continue;
    const position = String(row.position ?? player.position ?? '').trim();
    return {
      positionGroup: resolveWorldCupPlayerGroup(position || player.position),
      number: String(player.jersey_number ?? row.shirt_number ?? '').trim() || null,
    };
  }
  return null;
}

function WorldCupTeammateComparePicker({
  isDark,
  teammates,
  compareId,
  compareLoading,
  teamFlagUrl,
  onSelect,
  rosters,
}: {
  isDark: boolean;
  teammates: WorldCupTeammateOption[];
  compareId: string;
  compareLoading: boolean;
  teamFlagUrl: string | null;
  onSelect: (playerId: string) => void;
  rosters: Array<Record<string, any>>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = teammates.find((teammate) => teammate.id === compareId) ?? null;
  const dimText = isDark ? 'text-gray-500' : 'text-gray-400';

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  if (!teammates.length) {
    return <p className={`text-[11px] font-bold ${dimText}`}>No teammates with 5+ min games</p>;
  }

  const shell = isDark
    ? 'border-gray-700/80 bg-[#0b1220]/98 shadow-[0_10px_28px_rgba(0,0,0,0.45)] backdrop-blur-md'
    : 'border-gray-200/90 bg-white/98 shadow-[0_10px_28px_rgba(15,23,42,0.12)] backdrop-blur-md';
  const triggerShell = isDark
    ? 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-purple-500/30'
    : 'border-gray-200 bg-white hover:bg-gray-50 hover:border-purple-200';

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`group flex w-full items-center justify-end gap-2 rounded-lg border px-2 py-1.5 text-right transition-all ${triggerShell} ${
          open ? (isDark ? 'border-purple-500/40 bg-purple-500/10' : 'border-purple-300 bg-purple-50') : ''
        }`}
      >
        <div className="min-w-0 flex-1 text-right">
          <p className={`truncate text-[11px] font-bold leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {compareLoading && !selected ? 'Loading…' : selected?.name ?? 'Select teammate'}
          </p>
        </div>
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${
            isDark ? 'bg-gray-800/80 ring-white/10' : 'bg-gray-100 ring-black/5'
          }`}
        >
          {teamFlagUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={teamFlagUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
          ) : (
            <span className={`text-[9px] font-bold ${dimText}`}>
              {worldCupPlayerInitials(selected?.name ?? 'TM')}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${dimText} ${
            open ? 'rotate-180 text-purple-400' : 'group-hover:text-purple-400'
          }`}
        />
      </button>

      {open ? (
        <div className={`absolute right-0 top-[calc(100%+6px)] z-[90] w-[min(100vw-2rem,15rem)] overflow-hidden rounded-xl border ${shell}`}>
          <div
            className={`border-b px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.14em] ${
              isDark ? 'border-gray-700/80 text-gray-500' : 'border-gray-100 text-gray-400'
            }`}
          >
            Compare teammate
          </div>
          <ul className="max-h-56 overflow-y-auto py-1 custom-scrollbar">
            {teammates.map((teammate) => {
              const isSelected = teammate.id === compareId;
              const meta = lookupWorldCupRosterMeta(rosters, teammate.id);
              const group = meta?.positionGroup ?? 'FWD';
              const pillStyle = WORLD_CUP_POSITION_PILL_STYLES[group];
              return (
                <li key={teammate.id}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onSelect(teammate.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 border-l-2 px-2.5 py-2.5 text-left transition-colors ${
                      isSelected
                        ? isDark
                          ? 'border-purple-400 bg-purple-500/15'
                          : 'border-purple-500 bg-purple-50'
                        : isDark
                          ? 'border-transparent hover:bg-white/[0.04]'
                          : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <div className="relative h-8 w-8 shrink-0">
                      {teamFlagUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={teamFlagUrl}
                          alt=""
                          className={`h-8 w-8 rounded-full object-cover ring-1 ${
                            isDark ? 'ring-white/10' : 'ring-black/10'
                          }`}
                        />
                      ) : (
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold ${
                            isDark ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {worldCupPlayerInitials(teammate.name)}
                        </span>
                      )}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 rounded px-0.5 py-px text-[8px] font-bold leading-none ring-1 ${
                          isDark ? pillStyle.dark : pillStyle.light
                        }`}
                      >
                        {group}
                      </span>
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-gray-900 dark:text-white">
                          {teammate.name}
                        </span>
                        {meta?.number ? (
                          <span className={`shrink-0 text-[10px] tabular-nums ${dimText}`}>#{meta.number}</span>
                        ) : null}
                      </span>
                    </span>
                    {isSelected ? (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
                          isDark ? 'bg-purple-500/20 text-purple-300' : 'bg-purple-100 text-purple-700'
                        }`}
                      >
                        Active
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
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
  squadPlayerMatchStats,
  deferSquadFallback = false,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  playerMatchStats: Array<Record<string, any>>;
  matches: Array<Record<string, any>>;
  playerMatches: Array<Record<string, any>>;
  rosters: Array<Record<string, any>>;
  squadPlayerMatchStats?: Array<Record<string, any>>;
  deferSquadFallback?: boolean;
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

  const [fallbackSquadStats, setFallbackSquadStats] = useState<Array<Record<string, any>>>([]);
  const [fallbackSquadLoading, setFallbackSquadLoading] = useState(false);
  const hasBundledSquad = (squadPlayerMatchStats?.length ?? 0) > 0;

  useEffect(() => {
    const teamId = selectedPlayer?.teamId;
    if (deferSquadFallback || hasBundledSquad || !teamId || !/^\d+$/.test(teamId)) {
      setFallbackSquadStats([]);
      setFallbackSquadLoading(false);
      return;
    }
    let cancelled = false;
    setFallbackSquadLoading(true);
    const params = new URLSearchParams();
    params.set('teamId', teamId);
    fetchWorldCupDashboardJson<WorldCupDashboardData>(`/api/world-cup/dashboard?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setFallbackSquadStats(Array.isArray(data?.playerMatchStats) ? data.playerMatchStats : []);
      })
      .catch(() => {
        if (!cancelled) setFallbackSquadStats([]);
      })
      .finally(() => {
        if (!cancelled) setFallbackSquadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer?.teamId, hasBundledSquad, deferSquadFallback]);

  const squadSourceRows = useMemo(() => {
    if (hasBundledSquad) return squadPlayerMatchStats!;
    if (fallbackSquadStats.length) return fallbackSquadStats;
    return null;
  }, [hasBundledSquad, squadPlayerMatchStats, fallbackSquadStats]);

  // Squad profile: used only to rank roster candidates before full-profile checks.
  const { minutesByPlayer } = useMemo(() => {
    const sourceRows = hasBundledSquad
      ? squadPlayerMatchStats!
      : fallbackSquadStats.length
        ? fallbackSquadStats
        : playerMatchStats;
    return buildPlayerVsPlayerSquadProfile(sourceRows);
  }, [hasBundledSquad, squadPlayerMatchStats, fallbackSquadStats, playerMatchStats]);

  const rankedCandidates = useMemo(() => {
    if (!selectedPlayer) return [];
    const teamId = selectedPlayer.teamId;
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string }> = [];
    for (const row of rosters) {
      const player = row.player ?? {};
      const rawName = formatWorldCupPlayerDisplayName(
        String(player.name ?? player.short_name ?? row.player_name ?? '').trim()
      );
      if (!rawName) continue;
      const rowTeamId = row.team_id != null ? String(row.team_id) : null;
      if (teamId && rowTeamId && rowTeamId !== teamId) continue;
      const pid = String(player.id ?? row.player_id ?? rawName);
      if (pid === selectedPlayerId || seen.has(pid)) continue;
      seen.add(pid);
      result.push({ id: pid, name: rawName });
    }
    return result.sort((a, b) => {
      const diff = (minutesByPlayer.get(b.id) ?? 0) - (minutesByPlayer.get(a.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [rosters, selectedPlayer, selectedPlayerId, minutesByPlayer]);

  const [teammates, setTeammates] = useState<WorldCupTeammateOption[]>([]);
  const [compareId, setCompareId] = useState<string>('');
  const [compareStatsById, setCompareStatsById] = useState<Record<string, Array<Record<string, any>>>>({});
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const userPickedCompareRef = useRef(false);

  useEffect(() => {
    userPickedCompareRef.current = false;
  }, [selectedPlayerId]);

  // Resolve teammate profiles: dropdown = 5+ min in 1+ game; default = 5+ min in 5+ games.
  useEffect(() => {
    if (!rankedCandidates.length) {
      setTeammates([]);
      setCompareStatsById({});
      if (!userPickedCompareRef.current) setCompareId('');
      return;
    }

    const awaitingSquadFallback =
      !hasBundledSquad &&
      Boolean(selectedPlayer?.teamId && /^\d+$/.test(selectedPlayer.teamId)) &&
      fallbackSquadLoading;
    if (awaitingSquadFallback) return;

    let cancelled = false;
    setEligibleLoading(true);

    const applyResolved = (
      resolved: Array<{
        candidate: { id: string; name: string };
        rows: Array<Record<string, any>>;
        isDefaultEligible: boolean;
      }>
    ) => {
      const order = new Map(rankedCandidates.map((candidate, index) => [candidate.id, index]));
      resolved.sort((a, b) => (order.get(a.candidate.id) ?? 0) - (order.get(b.candidate.id) ?? 0));

      const nextTeammates: WorldCupTeammateOption[] = resolved.map((entry) => ({
        id: entry.candidate.id,
        name: entry.candidate.name,
        isDefaultEligible: entry.isDefaultEligible,
      }));
      const nextStatsById = Object.fromEntries(
        resolved.map((entry) => [entry.candidate.id, entry.rows])
      );
      const defaultTeammates = nextTeammates.filter((teammate) => teammate.isDefaultEligible);

      setTeammates(nextTeammates);
      setCompareStatsById(nextStatsById);

      if (nextTeammates.length === 0) {
        if (!userPickedCompareRef.current) setCompareId('');
        return;
      }

      if (userPickedCompareRef.current && nextTeammates.some((teammate) => teammate.id === compareId)) {
        return;
      }

      setCompareId(defaultTeammates[0]?.id ?? '');
    };

    if (squadSourceRows?.length) {
      const { gamesByPlayer } = buildPlayerVsPlayerSquadProfile(squadSourceRows);
      const resolved = rankedCandidates
        .map((candidate) => {
          if (!hasPlayerVsPlayerSelectableEligibility(gamesByPlayer, candidate.id)) return null;
          return {
            candidate,
            rows: filterWorldCupPlayerStatRows(squadSourceRows, candidate.id, candidate.name),
            isDefaultEligible: hasPlayerVsPlayerDefaultEligibility(gamesByPlayer, candidate.id),
          };
        })
        .filter(
          (
            entry
          ): entry is {
            candidate: { id: string; name: string };
            rows: Array<Record<string, any>>;
            isDefaultEligible: boolean;
          } => entry != null
        );
      if (!cancelled) {
        applyResolved(resolved);
        setEligibleLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }

    void fetchWorldCupTeammateProfiles(rankedCandidates)
      .then((results) => {
        if (cancelled) return;
        applyResolved(
          results.filter(
            (
              entry
            ): entry is {
              candidate: { id: string; name: string };
              rows: Array<Record<string, any>>;
              isDefaultEligible: boolean;
            } => entry != null
          )
        );
      })
      .finally(() => {
        if (!cancelled) setEligibleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    rankedCandidates,
    selectedPlayerId,
    selectedPlayer?.teamId,
    hasBundledSquad,
    squadSourceRows,
    fallbackSquadLoading,
  ]);

  const compareName = teammates.find((teammate) => teammate.id === compareId)?.name ?? null;
  const compareStats = compareId ? (compareStatsById[compareId] ?? []) : [];
  const compareLoading = eligibleLoading;
  const teamFlagUrl = getWorldCupFlagUrl(
    selectedPlayer?.countryCode || resolveWorldCupFlagCode(selectedPlayer?.teamName ?? '') || selectedPlayer?.teamName
  );

  const getL5AvgsFromRows = useCallback(
    (rows: Array<Record<string, any>>, pid: string, name: string) => {
      const norm = (n: string) =>
        n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
      const normTarget = name ? norm(name) : null;
      const pidRows = rows
        .filter((row) => {
          if (!hasPlayerVsPlayerQualifyingGame(row)) return false;
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
          <p className={`text-[11px] font-bold truncate leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {formatWorldCupPlayerDisplayName(selectedPlayer.name)}
          </p>
          <p className={`text-[9px] mt-0.5 ${dimText}`}>L{p1?.games ?? 0} avg</p>
        </div>
        <div className={`flex items-center justify-center rounded-full w-7 h-7 mx-auto text-[9px] font-black tracking-wider ${isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-300 text-gray-500'}`}>
          VS
        </div>
        <div className="min-w-0 text-right">
          <WorldCupTeammateComparePicker
            isDark={isDark}
            teammates={teammates}
            compareId={compareId}
            compareLoading={compareLoading}
            teamFlagUrl={teamFlagUrl}
            rosters={rosters}
            onSelect={(playerId) => {
              userPickedCompareRef.current = true;
              setCompareId(playerId);
            }}
          />
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
  summaryGames,
  perspective,
}: {
  isDark: boolean;
  team: WorldCupTeamOption | null;
  accent: 'blue' | 'orange';
  games: WorldCupRecentFormGame[];
  /** Games used for footer averages (defaults to `games`). */
  summaryGames?: WorldCupRecentFormGame[];
  perspective: WorldCupFormPerspective;
}) {
  const record = summarizeWorldCupFormRecord(games);
  const avgGames = summaryGames?.length ? summaryGames : games;
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
            {games.map((game, index) => (
              <WorldCupRecentGameRow key={`${game.matchId}-${index}`} isDark={isDark} game={game} />
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
                  {formatWorldCupRecentStatValue(averageWorldCupRecentStat(avgGames, stat.key, perspective), stat.key)}
                </span>
                <span className={`text-[9px] font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {stat.label}
                  {avgGames.length !== games.length ? ` · ${avgGames.length}g` : ''}
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

  const selectedSummaryGames = useMemo<WorldCupRecentFormGame[]>(() => {
    const all = data?.teamAll?.length ? data.teamAll : selectedGames;
    if (competition === 'world-cup') {
      const wc2026 = all.filter((g) => {
        if (g.competitionTag !== 'WC') return false;
        if (!g.datetime) return false;
        return new Date(g.datetime).getUTCFullYear() >= 2026;
      });
      if (wc2026.length) return wc2026;
    }
    return all;
  }, [competition, data?.teamAll, selectedGames]);

  const opponentGames = useMemo<WorldCupRecentFormGame[]>(() => {
    if (!opponentTeam) return [];
    if (data?.opponentRecent?.length) return data.opponentRecent;
    return buildWorldCupClientRecentForm(data?.opponentMatches ?? [], data?.opponentId ?? null, statsByPair, competition);
  }, [opponentTeam, data?.opponentRecent, data?.opponentMatches, data?.opponentId, statsByPair, competition]);

  const opponentSummaryGames = useMemo<WorldCupRecentFormGame[]>(() => {
    if (!opponentTeam) return [];
    const all = data?.opponentAll?.length ? data.opponentAll : opponentGames;
    if (competition === 'world-cup') {
      const wc2026 = all.filter((g) => {
        if (g.competitionTag !== 'WC') return false;
        if (!g.datetime) return false;
        return new Date(g.datetime).getUTCFullYear() >= 2026;
      });
      if (wc2026.length) return wc2026;
    }
    return all;
  }, [competition, data?.opponentAll, opponentGames, opponentTeam]);

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
          <WorldCupRecentFormColumn
            isDark={isDark}
            team={selectedTeam}
            accent="blue"
            games={selectedGames}
            summaryGames={selectedSummaryGames}
            perspective={perspective}
          />
          {opponentTeam ? (
            <WorldCupRecentFormColumn
              isDark={isDark}
              team={opponentTeam}
              accent="orange"
              games={opponentGames}
              summaryGames={opponentSummaryGames}
              perspective={perspective}
            />
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
  opponentData,
  dashboardData,
  loading,
  error,
  competition,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  data: WorldCupTeamFormResponse | null;
  opponentData?: WorldCupTeamFormResponse | null;
  dashboardData?: WorldCupDashboardData | null;
  loading: boolean;
  error: string | null;
  competition: Competition;
}) {
  const statsByPair = useMemo(() => buildWorldCupStatsByPair(data?.teamMatchStats ?? []), [data?.teamMatchStats]);
  const opponentStatsByPair = useMemo(
    () => buildWorldCupStatsByPair(opponentData?.teamMatchStats ?? data?.teamMatchStats ?? []),
    [data?.teamMatchStats, opponentData?.teamMatchStats]
  );
  const dashboardMatches = useMemo(
    () => [...(dashboardData?.matches ?? []), ...(dashboardData?.playerMatches ?? [])],
    [dashboardData?.matches, dashboardData?.playerMatches]
  );

  // Compare uses the full all-time history (every ingested competition), not the last 5.
  const selectedGames = useMemo<WorldCupRecentFormGame[]>(
    () =>
      resolveWorldCupCompareGames({
        teamId: selectedTeam?.id ?? data?.teamId ?? null,
        apiAll: data?.teamAll,
        apiRecent: data?.teamRecent,
        apiMatches: data?.teamMatches,
        apiNumericTeamId: data?.teamId ?? null,
        apiStatsByPair: statsByPair,
        dashboardStatRows: dashboardData?.teamMatchStats,
        dashboardMatches,
        competition,
      }),
    [
      selectedTeam?.id,
      data?.teamAll,
      data?.teamRecent,
      data?.teamMatches,
      data?.teamId,
      statsByPair,
      dashboardData?.teamMatchStats,
      dashboardMatches,
      competition,
    ]
  );

  const opponentGames = useMemo<WorldCupRecentFormGame[]>(() => {
    if (!opponentTeam) return [];
    const opponentNumericId = opponentData?.teamId ?? data?.opponentId ?? null;
    return resolveWorldCupCompareGames({
      teamId: opponentTeam.id,
      apiAll: data?.opponentAll?.length ? data.opponentAll : opponentData?.teamAll,
      apiRecent: data?.opponentRecent?.length ? data.opponentRecent : opponentData?.teamRecent,
      apiMatches: data?.opponentMatches?.length ? data.opponentMatches : opponentData?.teamMatches,
      apiNumericTeamId: opponentNumericId,
      apiStatsByPair: opponentStatsByPair,
      competition,
    });
  }, [
    opponentTeam,
    data?.opponentAll,
    data?.opponentRecent,
    data?.opponentMatches,
    data?.opponentId,
    opponentData?.teamAll,
    opponentData?.teamRecent,
    opponentData?.teamMatches,
    opponentData?.teamId,
    opponentStatsByPair,
    competition,
  ]);

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
    const name = formatWorldCupPlayerDisplayName(String(player.name || player.short_name || 'Player'));
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

function worldCupLineupsTitle(opts: {
  lineupMeta?: WorldCupDashboardData['lineupMeta'];
  opponentTeam: WorldCupTeamOption | null;
  teamOptions: WorldCupTeamOption[];
  teams?: WorldCupDashboardData['teams'];
}): string {
  if (opts.opponentTeam) return 'Most Recent Lineups';
  return 'Most Recent Lineup';
}

function worldCupLineupLastMatchOpponent(
  lastMatchOpponentId: number | null | undefined,
  teamOptions: WorldCupTeamOption[],
  teams?: WorldCupDashboardData['teams']
): WorldCupTeamOption | null {
  if (!lastMatchOpponentId) return null;
  return resolveWorldCupTeamOption(lastMatchOpponentId, teamOptions, teams);
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
    const id = String(row.player_id ?? player.id ?? '').trim();
    const name = formatWorldCupPlayerDisplayName(String(player.name || player.short_name || '').trim());
    if (id && name) map.set(id, name);
  }
  return map;
}

function readLineupPlayerPhoto(
  row: Record<string, any>,
  player: Record<string, any>,
  playerId: string,
  photoByPlayerId?: Record<string, string>
): string | null {
  const fromMap = photoByPlayerId?.[playerId];
  if (fromMap) return fromMap;
  for (const value of [
    player.photo,
    player.image_url,
    player.imageUrl,
    player.headshot_url,
    row.photo,
    row.image_url,
  ]) {
    const url = String(value ?? '').trim();
    if (url.startsWith('http')) return url;
  }
  return null;
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
    const name = formatWorldCupPlayerDisplayName(
      rosterName && rosterName.length > rawName.length ? rosterName : rawName
    );
    const entry: WorldCupLineupPlayer = {
      id: playerId,
      name,
      number: String(row.shirt_number ?? player.jersey_number ?? '').trim(),
      position: String(row.position || player.position || '').trim(),
      imageUrl: readLineupPlayerPhoto(row, player, playerId, opts?.photoByPlayerId),
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

function worldCupPlayerLastName(name: string): string {
  const formatted = formatWorldCupPlayerDisplayName(name);
  const parts = formatted.split(/\s+/).filter(Boolean);
  return parts.length ? parts.at(-1)! : formatted;
}

const WORLD_CUP_LINEUP_ACCENT = {
  blue: {
    headerBg: 'bg-gradient-to-r from-blue-500/15 via-blue-500/5 to-transparent dark:from-blue-500/20 dark:via-blue-500/10',
    headerBorder: 'border-blue-500/15 dark:border-blue-400/20',
    title: 'text-blue-700 dark:text-blue-300',
    ring: 'ring-blue-400/60 dark:ring-blue-300/50',
    badge: 'bg-gradient-to-br from-blue-500 to-blue-700',
    bench: 'border-blue-500/15 bg-blue-500/5 dark:border-blue-400/20 dark:bg-blue-500/10',
    chip: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
  },
  amber: {
    headerBg: 'bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent dark:from-amber-500/20 dark:via-amber-500/10',
    headerBorder: 'border-amber-500/15 dark:border-amber-400/20',
    title: 'text-amber-700 dark:text-amber-300',
    ring: 'ring-amber-400/60 dark:ring-amber-300/50',
    badge: 'bg-gradient-to-br from-amber-500 to-amber-700',
    bench: 'border-amber-500/15 bg-amber-500/5 dark:border-amber-400/20 dark:bg-amber-500/10',
    chip: 'bg-amber-500/10 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  },
} as const;

function WorldCupLineupPlayerBadge({
  player,
  accent,
  sizeClass = 'h-9 w-9 text-[11px]',
  showNumberOverlay = false,
}: {
  player: WorldCupLineupPlayer;
  accent: 'blue' | 'amber';
  sizeClass?: string;
  showNumberOverlay?: boolean;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = Boolean(player.imageUrl) && !photoFailed;
  const theme = WORLD_CUP_LINEUP_ACCENT[accent];

  const avatar = showPhoto ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={player.imageUrl!}
      alt={formatWorldCupPlayerDisplayName(player.name)}
      className={`${sizeClass} rounded-full object-cover object-top shadow-lg ring-2 ${theme.ring}`}
      onError={() => setPhotoFailed(true)}
    />
  ) : (
    <span
      className={`flex ${sizeClass} items-center justify-center rounded-full font-bold text-white shadow-lg ring-2 ${theme.ring} ${theme.badge}`}
    >
      {player.number || '–'}
    </span>
  );

  if (!showNumberOverlay || !player.number) return avatar;

  return (
    <div className="relative">
      {avatar}
      <span className="absolute -bottom-1 left-1/2 min-w-[1.1rem] -translate-x-1/2 rounded-full bg-black/80 px-1 py-px text-center text-[9px] font-bold leading-none text-white shadow">
        {player.number}
      </span>
    </div>
  );
}

function WorldCupLineupTeamHeader({
  isDark,
  team,
  accent,
  formation,
  subtitle,
  lastMatchOpponent,
}: {
  isDark: boolean;
  team: WorldCupTeamOption | null;
  accent: 'blue' | 'amber';
  formation?: string | null;
  subtitle?: string;
  lastMatchOpponent?: WorldCupTeamOption | null;
}) {
  const teamName = team?.name ?? (accent === 'blue' ? 'Selected' : 'Opponent');
  const teamFlag = getWorldCupFlagUrl(team?.countryCode || team?.abbreviation);
  const theme = WORLD_CUP_LINEUP_ACCENT[accent];

  return (
    <div className={`flex items-center gap-3 border-b px-3 py-2.5 sm:px-4 ${theme.headerBg} ${theme.headerBorder} ${isDark ? 'border-gray-700/80' : 'border-gray-200/80'}`}>
      {teamFlag ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={teamFlag} alt="" className="h-5 w-7 shrink-0 rounded-sm object-cover shadow-sm ring-1 ring-black/10" />
      ) : (
        <span className={`flex h-5 w-7 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
          {team?.abbreviation?.slice(0, 3) || 'TBD'}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-bold ${theme.title}`}>
          <span>{teamName}</span>
          {lastMatchOpponent?.name ? (
            <span className={`font-semibold ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {` vs ${lastMatchOpponent.name}`}
            </span>
          ) : null}
        </div>
        {subtitle ? (
          <div className={`truncate text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{subtitle}</div>
        ) : null}
      </div>
      {formation ? (
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums tracking-wide ${
            isDark ? 'bg-gray-800/80 text-gray-200' : 'bg-white text-gray-700 shadow-sm'
          }`}
        >
          {formation}
        </span>
      ) : null}
    </div>
  );
}

function WorldCupLineupSubstitutes({
  isDark,
  substitutes,
  accent,
}: {
  isDark: boolean;
  substitutes: WorldCupLineupPlayer[];
  accent: 'blue' | 'amber';
}) {
  if (!substitutes.length) return null;
  const theme = WORLD_CUP_LINEUP_ACCENT[accent];

  return (
    <div className={`border-t px-3 py-2.5 sm:px-4 ${theme.bench} ${isDark ? 'border-gray-700/80' : 'border-gray-200/80'}`}>
      <div className={`mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        Substitutes
      </div>
      <div className="flex flex-wrap gap-1.5">
        {substitutes.map((player) => (
          <div
            key={player.id}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 ${theme.chip} ${
              isDark ? 'border-white/10' : 'border-black/5'
            }`}
          >
            <WorldCupLineupPlayerBadge
              player={player}
              accent={accent}
              sizeClass="h-5 w-5 text-[8px]"
            />
            <span className="truncate text-[11px] font-medium">{worldCupPlayerLastName(player.name)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorldCupLineupColumn({
  isDark,
  team,
  lineup,
  accent,
  lastMatchOpponent,
}: {
  isDark: boolean;
  team: WorldCupTeamOption | null;
  lineup: WorldCupTeamLineup;
  accent: 'blue' | 'amber';
  lastMatchOpponent?: WorldCupTeamOption | null;
}) {
  const renderRow = (entry: WorldCupLineupPlayer) => {
    const group = resolveWorldCupPlayerGroup(entry.position);
    const pillStyle = WORLD_CUP_POSITION_PILL_STYLES[group];
    return (
      <div
        key={entry.id}
        className={`flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors ${
          isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-white/70'
        }`}
      >
        <WorldCupLineupPlayerBadge player={entry} accent={accent} sizeClass="h-9 w-9 text-[11px]" />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{entry.name}</div>
          {entry.position ? (
            <div className={`truncate text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{entry.position}</div>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold leading-none ring-1 ${
            isDark ? pillStyle.dark : pillStyle.light
          }`}
        >
          {group}
        </span>
      </div>
    );
  };

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border shadow-sm ${
        isDark ? 'border-gray-700/80 bg-[#0b1220]' : 'border-gray-200 bg-white'
      }`}
    >
      <WorldCupLineupTeamHeader
        isDark={isDark}
        team={team}
        accent={accent}
        formation={lineup.formation}
        subtitle="Starting XI"
        lastMatchOpponent={lastMatchOpponent}
      />
      <div className="flex flex-col gap-0.5 px-2 py-2">
        {lineup.starters.length ? lineup.starters.map(renderRow) : (
          <div className={`px-2 py-6 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            No starters available yet.
          </div>
        )}
      </div>
      <WorldCupLineupSubstitutes isDark={isDark} substitutes={lineup.substitutes} accent={accent} />
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
  substitutes,
  formation,
  formationLabel,
  accent,
  lastMatchOpponent,
}: {
  isDark: boolean;
  team: WorldCupTeamOption | null;
  players: WorldCupLineupPlayer[];
  substitutes: WorldCupLineupPlayer[];
  formation: number[] | null;
  formationLabel?: string | null;
  accent: 'blue' | 'amber';
  lastMatchOpponent?: WorldCupTeamOption | null;
}) {
  const lines = buildWorldCupPitchRows(players, formation);
  const rowCount = lines.length;
  const shownFormation = lines.slice(1).map((line) => line.length).join('-');
  const headerFormation = formationLabel || shownFormation;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border shadow-sm ${
        isDark ? 'border-gray-700/80 bg-[#0b1220]' : 'border-gray-200 bg-white'
      }`}
    >
      <WorldCupLineupTeamHeader
        isDark={isDark}
        team={team}
        accent={accent}
        formation={headerFormation}
        subtitle="Starting XI"
        lastMatchOpponent={lastMatchOpponent}
      />
      <div className="p-2 sm:p-3">
        <div className="relative min-h-[360px] overflow-hidden rounded-xl shadow-inner ring-1 ring-emerald-900/30 dark:ring-emerald-950/60">
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-700 dark:from-emerald-700 dark:via-emerald-800 dark:to-emerald-950" />
          <div
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, rgba(255,255,255,0.55) 0, rgba(255,255,255,0.55) 9%, transparent 9%, transparent 18%)',
            }}
          />
          <div className="absolute inset-2 rounded-lg border border-white/25 sm:inset-3" />
          <div className="absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-white/35 sm:inset-x-6" />
          <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/35" />
          <div className="absolute left-1/2 top-0 h-[17%] w-[58%] -translate-x-1/2 border border-b-white/35 border-l-white/35 border-r-white/35 border-t-0" />
          <div className="absolute left-1/2 top-0 h-[7%] w-[30%] -translate-x-1/2 border border-b-white/35 border-l-white/35 border-r-white/35 border-t-0" />
          <div className="absolute left-1/2 bottom-0 h-[17%] w-[58%] -translate-x-1/2 border border-l-white/35 border-r-white/35 border-t-white/35 border-b-0" />
          <div className="absolute left-1/2 bottom-0 h-[7%] w-[30%] -translate-x-1/2 border border-l-white/35 border-r-white/35 border-t-white/35 border-b-0" />
          {lines.map((line, rowIdx) => {
            const top = rowCount > 1 ? 88 - rowIdx * (76 / (rowCount - 1)) : 50;
            return line.map((player, colIdx) => {
              const left = ((colIdx + 1) / (line.length + 1)) * 100;
              return (
                <div
                  key={player.id}
                  className="absolute flex w-[4.75rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 sm:w-28"
                  style={{ top: `${top}%`, left: `${left}%` }}
                >
                  <WorldCupLineupPlayerBadge
                    player={player}
                    accent={accent}
                    sizeClass="h-10 w-10 text-[11px] sm:h-11 sm:w-11"
                    showNumberOverlay
                  />
                  <div className="max-w-full rounded-md bg-black/50 px-1.5 py-0.5 text-center shadow-sm backdrop-blur-[2px]">
                    <span className="block truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]">
                      {worldCupPlayerLastName(player.name)}
                    </span>
                  </div>
                </div>
              );
            });
          })}
        </div>
      </div>
      <WorldCupLineupSubstitutes isDark={isDark} substitutes={substitutes} accent={accent} />
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
  const selectedForLineup = useMemo(
    () =>
      resolveWorldCupTeamOption(lineupMeta?.selectedTeamId, teamOptions, teams) ?? selectedTeam,
    [lineupMeta?.selectedTeamId, selectedTeam, teamOptions, teams]
  );
  const opponentForLineup = useMemo(
    () =>
      resolveWorldCupTeamOption(lineupMeta?.opponentTeamId, teamOptions, teams) ?? opponentTeam,
    [lineupMeta?.opponentTeamId, opponentTeam, teamOptions, teams]
  );
  const selectedLastMatchOpponent = useMemo(
    () =>
      worldCupLineupLastMatchOpponent(
        lineupMeta?.selectedTeamLastMatchOpponentId,
        teamOptions,
        teams
      ),
    [lineupMeta?.selectedTeamLastMatchOpponentId, teamOptions, teams]
  );
  const opponentLastMatchOpponent = useMemo(
    () =>
      worldCupLineupLastMatchOpponent(
        lineupMeta?.opponentTeamLastMatchOpponentId,
        teamOptions,
        teams
      ),
    [lineupMeta?.opponentTeamLastMatchOpponentId, teamOptions, teams]
  );
  const nameByPlayerId = useMemo(() => buildWorldCupPlayerNameById(rosters), [rosters]);
  const lineupBuildOpts = useMemo(
    () => ({ nameByPlayerId, photoByPlayerId: lineupPlayerPhotos ?? {} }),
    [nameByPlayerId, lineupPlayerPhotos]
  );

  const selectedLineup = useMemo(
    () => buildWorldCupLineup(lineups, selectedForLineup?.id, lineupBuildOpts),
    [lineups, selectedForLineup?.id, lineupBuildOpts]
  );
  const opponentLineup = useMemo(
    () => buildWorldCupLineup(lineups, opponentForLineup?.id, lineupBuildOpts),
    [lineups, opponentForLineup?.id, lineupBuildOpts]
  );

  const renderTeam = (
    team: WorldCupTeamOption | null,
    lineup: WorldCupTeamLineup,
    accent: 'blue' | 'amber',
    lastMatchOpponent: WorldCupTeamOption | null
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
          substitutes={lineup.substitutes}
          formation={lineup.formation ? parseWorldCupFormation(lineup.formation) : null}
          formationLabel={lineup.formation}
          accent={accent}
          lastMatchOpponent={lastMatchOpponent}
        />
      );
    }
    // Partial data (rare) → simple list so nothing is misplaced on the pitch.
    if (lineup.starters.length) {
      return (
        <WorldCupLineupColumn
          isDark={isDark}
          team={team}
          lineup={lineup}
          accent={accent}
          lastMatchOpponent={lastMatchOpponent}
        />
      );
    }
    // No data yet.
    return (
      <div
        className={`flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed px-4 py-10 text-center ${
          isDark ? 'border-gray-700/80 bg-[#0b1220]/50 text-gray-500' : 'border-gray-200 bg-gray-50 text-gray-400'
        }`}
      >
        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Lineup pending</div>
        <div className="mt-1 max-w-[14rem] text-xs text-gray-400 dark:text-gray-500">
          Confirmed starting XI will appear here once available.
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 px-3 sm:grid-cols-2 sm:gap-5 sm:px-4">
      {renderTeam(selectedForLineup, selectedLineup, 'blue', selectedLastMatchOpponent)}
      {opponentForLineup ? (
        renderTeam(opponentForLineup, opponentLineup, 'amber', opponentLastMatchOpponent)
      ) : (
        <div
          className={`flex min-h-[220px] items-center justify-center rounded-xl border border-dashed px-4 py-10 text-center text-xs ${
            isDark ? 'border-gray-700/80 bg-[#0b1220]/50 text-gray-500' : 'border-gray-200 bg-gray-50 text-gray-400'
          }`}
        >
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

type WorldCupStandingRow = {
  teamId: string;
  teamName: string;
  countryCode: string | null;
  groupName: string;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  qualificationStatus: string | null;
};

function normalizeWorldCupStandingRow(raw: Record<string, any>): WorldCupStandingRow | null {
  const team = raw?.team ?? {};
  const group = raw?.group ?? {};
  const teamId = team?.id != null ? String(team.id) : '';
  if (!teamId) return null;
  const goalsFor = Number(raw?.goals_for ?? raw?.goalsFor ?? 0) || 0;
  const goalsAgainst = Number(raw?.goals_against ?? raw?.goalsAgainst ?? 0) || 0;
  const goalDifferenceRaw = raw?.goal_difference ?? raw?.goalDifference;
  return {
    teamId,
    teamName: String(team?.name || 'TBD'),
    countryCode: team?.country_code || team?.abbreviation || null,
    groupName: String(group?.name || 'Group'),
    rank: Number(raw?.rank ?? raw?.position ?? raw?.standing ?? 0) || 999,
    played: Number(raw?.played ?? raw?.games_played ?? 0) || 0,
    won: Number(raw?.won ?? raw?.wins ?? 0) || 0,
    drawn: Number(raw?.drawn ?? raw?.draws ?? raw?.tied ?? 0) || 0,
    lost: Number(raw?.lost ?? raw?.losses ?? 0) || 0,
    goalsFor,
    goalsAgainst,
    goalDifference:
      goalDifferenceRaw != null
        ? Number(goalDifferenceRaw) || 0
        : goalsFor - goalsAgainst,
    points: Number(raw?.points ?? 0) || 0,
    qualificationStatus: raw?.qualification_status ?? raw?.qualificationStatus ?? null,
  };
}

function WorldCupGroupStandingsPanel({
  isDark,
  standings,
  selectedTeam,
  opponentTeam,
}: {
  isDark: boolean;
  standings: Array<Record<string, any>>;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
}) {
  const normalized = useMemo(
    () =>
      standings
        .map((row) => normalizeWorldCupStandingRow(row))
        .filter((row): row is WorldCupStandingRow => row != null),
    [standings]
  );

  const groups = useMemo(() => {
    const byGroup = new Map<string, WorldCupStandingRow[]>();
    for (const row of normalized) {
      const list = byGroup.get(row.groupName) ?? [];
      list.push(row);
      byGroup.set(row.groupName, list);
    }
    for (const [name, rows] of byGroup) {
      rows.sort((a, b) => a.rank - b.rank || b.points - a.points || a.teamName.localeCompare(b.teamName));
      byGroup.set(name, rows);
    }
    return Array.from(byGroup.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [normalized]);

  const highlightIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedTeam?.id) ids.add(selectedTeam.id);
    if (opponentTeam?.id) ids.add(opponentTeam.id);
    return ids;
  }, [selectedTeam?.id, opponentTeam?.id]);

  const focusGroupNames = useMemo(() => {
    if (!highlightIds.size) return null;
    const names = new Set<string>();
    for (const row of normalized) {
      if (highlightIds.has(row.teamId)) names.add(row.groupName);
    }
    return names.size ? names : null;
  }, [normalized, highlightIds]);

  const visibleGroups = useMemo(() => {
    if (!groups.length) return [];
    if (focusGroupNames) {
      const focused = groups.filter(([name]) => focusGroupNames.has(name));
      if (focused.length) return focused;
    }
    return groups;
  }, [groups, focusGroupNames]);

  const [activeGroup, setActiveGroup] = useState('');

  useEffect(() => {
    if (!visibleGroups.length) return;
    const preferred =
      (focusGroupNames && visibleGroups.find(([name]) => focusGroupNames.has(name))?.[0]) ||
      visibleGroups[0]?.[0] ||
      '';
    setActiveGroup((prev) => (visibleGroups.some(([name]) => name === prev) ? prev : preferred));
  }, [visibleGroups, focusGroupNames]);

  const activeRows = visibleGroups.find(([name]) => name === activeGroup)?.[1] ?? visibleGroups[0]?.[1] ?? [];

  if (!normalized.length) {
    return <EmptyState text="Group standings will appear once tournament games are played." />;
  }

  const fmtGd = (value: number) => (value > 0 ? `+${value}` : String(value));

  return (
    <div className="flex flex-col gap-2 px-3 pb-1 sm:px-4">
      {visibleGroups.length > 1 ? (
        <div
          className={`inline-flex w-full max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border p-0.5 custom-scrollbar fade-scrollbar ${
            isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'
          }`}
        >
          {visibleGroups.map(([name]) => (
            <button
              key={name}
              type="button"
              onClick={() => setActiveGroup(name)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                activeGroup === name
                  ? 'bg-purple-600 text-white shadow-sm'
                  : isDark
                    ? 'text-gray-300 hover:bg-gray-800'
                    : 'text-gray-600 hover:bg-white'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      ) : activeGroup ? (
        <p className={`px-0.5 text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{activeGroup}</p>
      ) : null}

      <div
        className={`overflow-x-auto overflow-y-auto max-h-[320px] rounded-lg border custom-scrollbar fade-scrollbar ${
          isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'
        }`}
      >
        <table className="w-full min-w-[340px] text-xs">
          <thead className={`sticky top-0 z-10 ${isDark ? 'bg-[#0a1929] text-gray-400' : 'bg-white text-gray-500'}`}>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="px-2 py-2 text-left font-semibold">#</th>
              <th className="px-2 py-2 text-left font-semibold">Team</th>
              <th className="px-1.5 py-2 text-center font-semibold">P</th>
              <th className="px-1.5 py-2 text-center font-semibold">W</th>
              <th className="px-1.5 py-2 text-center font-semibold">D</th>
              <th className="px-1.5 py-2 text-center font-semibold">L</th>
              <th className="px-1.5 py-2 text-center font-semibold">GD</th>
              <th className="px-1.5 py-2 text-center font-semibold">Pts</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.map((row) => {
              const highlighted = highlightIds.has(row.teamId);
              const flag = getWorldCupFlagUrl(row.countryCode || row.teamName);
              return (
                <tr
                  key={`${row.groupName}-${row.teamId}`}
                  className={`border-b last:border-b-0 ${
                    highlighted
                      ? isDark
                        ? 'bg-purple-900/25 border-gray-700'
                        : 'bg-purple-50 border-gray-100'
                      : isDark
                        ? 'border-gray-800'
                        : 'border-gray-100'
                  }`}
                >
                  <td className={`px-2 py-2 tabular-nums ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {row.rank < 999 ? row.rank : '—'}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {flag ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={flag} alt="" className="h-3.5 w-5 shrink-0 rounded-sm object-cover" />
                      ) : (
                        <span className="h-3.5 w-5 shrink-0 rounded-sm bg-gray-300 dark:bg-gray-600" />
                      )}
                      <span
                        className={`truncate font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'} ${
                          highlighted ? 'text-purple-700 dark:text-purple-200' : ''
                        }`}
                      >
                        {row.teamName}
                      </span>
                    </div>
                  </td>
                  <td className={`px-1.5 py-2 text-center tabular-nums ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{row.played}</td>
                  <td className={`px-1.5 py-2 text-center tabular-nums ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{row.won}</td>
                  <td className={`px-1.5 py-2 text-center tabular-nums ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{row.drawn}</td>
                  <td className={`px-1.5 py-2 text-center tabular-nums ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{row.lost}</td>
                  <td className={`px-1.5 py-2 text-center tabular-nums ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{fmtGd(row.goalDifference)}</td>
                  <td className={`px-1.5 py-2 text-center tabular-nums font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  maxHeightClass = 'max-h-[320px]',
}: {
  isDark: boolean;
  matches: Array<Record<string, any>>;
  maxHeightClass?: string;
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
    <div className={`${maxHeightClass} space-y-2 overflow-y-auto px-3 pb-1 sm:px-4 custom-scrollbar fade-scrollbar`}>
      {rows.map((m) => {
        const homeLabel = m.homeLabel || m.homeTeam?.name || 'TBD';
        const awayLabel = m.awayLabel || m.awayTeam?.name || 'TBD';
        const completed = m.status === 'completed';
        const live = m.status === 'in_progress';
        const { date, time } = formatWorldCupScheduleDate(m.datetime);
        const groupName = readWorldCupMatchGroup(m);
        const stageName = readWorldCupMatchStage(m);
        const groupLabel = groupName
          ? groupName.toLowerCase().startsWith('group')
            ? groupName
            : `Group ${groupName}`
          : stageName || '';
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
  dashboardData,
}: {
  isDark: boolean;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  competition: Competition;
  dashboardData?: WorldCupDashboardData | null;
}) {
  const [tab, setTab] = useState<WorldCupTeamFormTab>('compare');
  const teamIdParam = selectedTeam?.id && /^\d+$/.test(selectedTeam.id) ? selectedTeam.id : null;
  const opponentIdParam = opponentTeam?.id && /^\d+$/.test(opponentTeam.id) ? opponentTeam.id : null;

  const { data, opponentData, loading, error } = useWorldCupTeamForm(teamIdParam, opponentIdParam, competition);

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
        {tab === 'team_form' ? (
          <WorldCupTeamFormCard
            isDark={isDark}
            selectedTeam={selectedTeam}
            opponentTeam={opponentTeam}
            data={data}
            loading={loading}
            error={error}
            competition={competition}
          />
        ) : (
          <WorldCupTeamComparisonCard
            isDark={isDark}
            selectedTeam={selectedTeam}
            opponentTeam={opponentTeam}
            data={data}
            opponentData={opponentData}
            dashboardData={dashboardData}
            loading={loading}
            error={error}
            competition={competition}
          />
        )}
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

function resolveWorldCupOpponentBreakdownMetricEntry(
  breakdown: WorldCupOppBreakdownResponse | null,
  statKey: string
): { values: Record<string, number>; ranks: Record<string, number> } | null {
  if (!breakdown?.metrics) return null;
  for (const key of worldCupOpponentBreakdownStatKeys(statKey)) {
    const entry = breakdown.metrics[key];
    if (entry) return entry;
  }
  return null;
}

function countWorldCupOpponentBreakdownPlayedTeams(breakdown: WorldCupOppBreakdownResponse | null): number {
  if (!breakdown?.games) return 0;
  return Object.values(breakdown.games).filter((gamesPlayed) => (gamesPlayed ?? 0) >= 1).length;
}

function opponentBreakdownMetricCoverage(
  breakdown: WorldCupOppBreakdownResponse | null,
  statKey = 'goals'
): number {
  if (!breakdown?.games) return 0;
  const entry = resolveWorldCupOpponentBreakdownMetricEntry(breakdown, statKey);
  if (!entry) return 0;
  return Object.keys(breakdown.games).filter(
    (slug) => (breakdown.games?.[slug] ?? 0) >= 1 && Number.isFinite(entry.values[slug])
  ).length;
}

function opponentAllowedRankMap(
  breakdown: WorldCupOppBreakdownResponse | null,
  statKey: string
): Record<string, number> {
  const entry = resolveWorldCupOpponentBreakdownMetricEntry(breakdown, statKey);
  if (!entry || !breakdown?.names) return {};
  const universe = Object.keys(breakdown.names).filter(
    (slug) => (breakdown.games?.[slug] ?? 0) >= 1
  );
  if (!universe.length) return {};
  return rankOpponentAllowedValues(
    universe.map((slug) => ({
      slug,
      value: Number.isFinite(entry.values[slug]) ? entry.values[slug]! : 0,
    }))
  );
}

function buildWorldCupOpponentAllowedRanking(
  breakdown: WorldCupOppBreakdownResponse | null,
  statKey: string
): Array<{ slug: string; name: string; value: number; rank: number | null; games: number }> {
  const entry = resolveWorldCupOpponentBreakdownMetricEntry(breakdown, statKey);
  if (!entry || !breakdown) return [];

  const universe = Object.keys(breakdown.names ?? {}).filter(
    (slug) => (breakdown.games?.[slug] ?? 0) >= 1
  );
  if (!universe.length) return [];

  const ranks = opponentAllowedRankMap(breakdown, statKey);

  return universe
    .map((slug) => ({
      slug,
      name: breakdown.names[slug] ?? slug,
      value: Number.isFinite(entry.values[slug]) ? entry.values[slug]! : 0,
      rank: ranks[slug] ?? null,
      games: breakdown.games?.[slug] ?? 0,
    }))
    .sort(
      (a, b) =>
        (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
        a.value - b.value ||
        a.name.localeCompare(b.name)
    );
}

function computeOpponentAllowedRankFromValues(
  entry: { values: Record<string, number>; ranks: Record<string, number> },
  slug: string,
  breakdown: WorldCupOppBreakdownResponse | null,
  statKey?: string
): { rank: number; tied: number } | undefined {
  if (!breakdown?.names) {
    const r = entry.ranks[slug];
    if (typeof r === 'number' && Number.isFinite(r)) return { rank: r, tied: 1 };
    return undefined;
  }

  const played = (breakdown.games?.[slug] ?? 0) >= 1;
  if (!played) return undefined;

  const ranks = statKey
    ? opponentAllowedRankMap(breakdown, statKey)
    : rankOpponentAllowedValues(
        Object.keys(breakdown.names).filter((teamSlug) => (breakdown.games?.[teamSlug] ?? 0) >= 1).map(
          (teamSlug) => ({
            slug: teamSlug,
            value: Number.isFinite(entry.values[teamSlug]) ? entry.values[teamSlug]! : 0,
          })
        )
      );
  const rank = ranks[slug];
  if (rank == null) return undefined;
  const tied = Object.values(ranks).filter((r) => r === rank).length;
  return { rank, tied };
}

function hasWorldCupOpponentBreakdownData(
  breakdown: WorldCupOppBreakdownResponse | null | undefined
): breakdown is WorldCupOppBreakdownResponse {
  return Boolean(breakdown && Object.keys(breakdown.names ?? {}).length > 0);
}

/** WC 2026 allowed averages for Player vs Team — several dashboard bundles use different fields. */
function resolveBundledWc2026OpponentBreakdown(
  wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse,
  playerVsPool?: WorldCupDashboardData['playerVsPool']
): WorldCupOppBreakdownResponse | null {
  for (const candidate of [
    wc2026OpponentBreakdown,
    playerVsPool?.wc2026OpponentBreakdown,
    playerVsPool?.opponentBreakdown,
  ]) {
    if (hasWorldCupOpponentBreakdownData(candidate)) return candidate;
  }
  return null;
}

function worldCupOpponentBreakdownStatKeys(statKey: string): string[] {
  if (statKey === 'passes_total' || statKey === 'passes_accurate') {
    return ['passes_total', 'passes_accurate', 'passes'];
  }
  if (statKey === 'fouls' || statKey === 'fouls_committed') {
    return ['fouls', 'fouls_committed'];
  }
  if (statKey === 'was_fouled' || statKey === 'fouls_suffered') {
    return ['was_fouled', 'fouls_suffered'];
  }
  return [statKey];
}

function resolveOpponentBreakdownSlug(
  breakdown: WorldCupOppBreakdownResponse | null,
  team: WorldCupTeamOption | null,
  statKey = 'goals'
): string | null {
  if (!breakdown || !team) return null;
  const statKeys = worldCupOpponentBreakdownStatKeys(statKey);
  for (const key of statKeys) {
    const entry = breakdown.metrics[key];
    if (!entry) continue;
    for (const slug of resolveWorldCupTeamSlugCandidates(team)) {
      if (typeof entry.values[slug] === 'number' && Number.isFinite(entry.values[slug])) return slug;
    }
    const teamName = team.name.trim().toLowerCase();
    for (const [slug, name] of Object.entries(breakdown.names)) {
      const normalized = String(name).trim().toLowerCase();
      if (normalized === teamName || resolveWorldCupFlagCode(name) === resolveWorldCupTeamSlug(team)) {
        if (typeof entry.values[slug] === 'number' && Number.isFinite(entry.values[slug])) return slug;
      }
    }
  }
  return null;
}

function mergeWorldCupOpponentBreakdownPreferLive(
  base: WorldCupOppBreakdownResponse | null,
  overlay: WorldCupOppBreakdownResponse | null,
  opponentTeam: WorldCupTeamOption | null
): WorldCupOppBreakdownResponse | null {
  if (!base) return overlay;
  if (!overlay || !opponentTeam) return base;
  const targetSlug = resolveOpponentBreakdownSlug(overlay, opponentTeam);
  if (!targetSlug) return base;

  const names = { ...base.names, ...(overlay.names ?? {}) };
  const games = { ...base.games, ...(overlay.games ?? {}) };
  const totalGames = { ...base.totalGames, ...(overlay.totalGames ?? {}) };
  const metrics: WorldCupOppBreakdownResponse['metrics'] = { ...base.metrics };

  for (const [statKey, overlayEntry] of Object.entries(overlay.metrics ?? {})) {
    const value = overlayEntry.values[targetSlug];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const baseEntry = metrics[statKey] ?? { values: {}, ranks: {} };
    metrics[statKey] = {
      values: { ...baseEntry.values, [targetSlug]: value },
      ranks: { ...baseEntry.ranks },
    };
  }

  return {
    ...base,
    names,
    games,
    totalGames,
    metrics,
    rankingTotal: base.rankingTotal ?? overlay.rankingTotal,
  };
}

function resolveEffectiveOpponentBreakdown(
  bundled: WorldCupOppBreakdownResponse | null,
  fetched: WorldCupOppBreakdownResponse | null,
  opponentTeam: WorldCupTeamOption | null
): WorldCupOppBreakdownResponse | null {
  if (!bundled) return fetched;
  if (!fetched) return bundled;
  if (!opponentTeam) {
    const bundledCoverage = opponentBreakdownMetricCoverage(bundled);
    const fetchedCoverage = opponentBreakdownMetricCoverage(fetched);
    return fetchedCoverage >= bundledCoverage ? fetched : bundled;
  }
  const bundledHasOpponent = opponentHasBreakdownStats(bundled, opponentTeam);
  const fetchedHasOpponent = opponentHasBreakdownStats(fetched, opponentTeam);
  const fetchedCoverage = opponentBreakdownMetricCoverage(fetched);
  const bundledCoverage = opponentBreakdownMetricCoverage(bundled);
  if (fetchedCoverage > bundledCoverage) {
    return mergeWorldCupOpponentBreakdownPreferLive(fetched, bundled, opponentTeam) ?? fetched;
  }
  if (fetchedHasOpponent && !bundledHasOpponent) {
    return mergeWorldCupOpponentBreakdownPreferLive(bundled, fetched, opponentTeam) ?? fetched;
  }
  return bundled;
}

function opponentHasBreakdownStats(
  breakdown: WorldCupOppBreakdownResponse | null,
  team: WorldCupTeamOption | null
): boolean {
  if (!breakdown || !team) return false;
  return lookupWorldCupOpponentBreakdownMetric(breakdown, 'goals', team).value != null;
}

function lookupWorldCupOpponentBreakdownMetric(
  breakdown: WorldCupOppBreakdownResponse | null,
  statKey: string,
  team: WorldCupTeamOption | null
): { value?: number; rank?: number; rankTied?: number } {
  const statKeys = worldCupOpponentBreakdownStatKeys(statKey);
  for (const key of statKeys) {
    if (!breakdown?.metrics[key] || !team) continue;
    const entry = breakdown.metrics[key];
    for (const slug of resolveWorldCupTeamSlugCandidates(team)) {
      if (typeof entry.values[slug] === 'number' && Number.isFinite(entry.values[slug])) {
        const r = computeOpponentAllowedRankFromValues(entry, slug, breakdown, key);
        return { value: entry.values[slug], rank: r?.rank, rankTied: r?.tied };
      }
    }
    const teamName = team.name.trim().toLowerCase();
    for (const [slug, name] of Object.entries(breakdown.names)) {
      const normalized = String(name).trim().toLowerCase();
      if (normalized === teamName || resolveWorldCupFlagCode(name) === resolveWorldCupTeamSlug(team)) {
        if (typeof entry.values[slug] === 'number' && Number.isFinite(entry.values[slug])) {
          const r = computeOpponentAllowedRankFromValues(entry, slug, breakdown, key);
          return { value: entry.values[slug], rank: r?.rank, rankTied: r?.tied };
        }
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
    fetchWorldCupDashboardJson<WorldCupOppBreakdownResponse>(`/api/world-cup/dashboard?oppBreakdown=1&window=${windowN}`)
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

  // Attack: #1 = most goals = green (best). Defense/allowed: #1 = stingiest = red (hardest);
  // #48 = allows most = green (easiest matchup for the attacker).
  const attackRankPillClass = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) {
      return isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-500';
    }
    const third = rankedSize / 3;
    if (rank <= third) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    if (rank <= third * 2) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  };

  const defenseRankPillClass = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) {
      return isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-500';
    }
    const third = rankedSize / 3;
    if (rank <= third) return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
    if (rank <= third * 2) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  };

  const attackRankBarColor = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return isDark ? '#4b5563' : '#9ca3af';
    const third = rankedSize / 3;
    if (rank <= third) return '#16a34a';
    if (rank <= third * 2) return '#f59e0b';
    return '#e11d48';
  };

  const defenseRankBarColor = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return isDark ? '#4b5563' : '#9ca3af';
    const third = rankedSize / 3;
    if (rank <= third) return '#e11d48';
    if (rank <= third * 2) return '#f59e0b';
    return '#16a34a';
  };

  const attackBarPct = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return 0;
    const minPct = 6;
    return Math.max(minPct, ((rankedSize + 1 - rank) / rankedSize) * 100);
  };

  const defenseBarPct = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return 0;
    const minPct = 6;
    return Math.max(minPct, (rank / rankedSize) * 100);
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
              const teamPct = attackBarPct(row.attackRank);
              const oppPct = defenseBarPct(row.defenseRank);
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
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${teamPct}%`, backgroundColor: attackRankBarColor(row.attackRank) }} />
                    </div>
                    <span className="w-10 flex-shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 dark:text-white">{formatValue(row.attackValue)}</span>
                    {row.attackRank ? (
                      <span className={`w-7 flex-shrink-0 rounded-md px-1 py-0.5 text-center text-[9px] font-bold tabular-nums ${attackRankPillClass(row.attackRank)}`}>#{row.attackRank}</span>
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
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${oppPct}%`, backgroundColor: defenseRankBarColor(row.defenseRank) }} />
                    </div>
                    <span className="w-10 flex-shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 dark:text-white">{formatValue(row.defenseValue)}</span>
                    {row.defenseRank ? (
                      <span className={`w-7 flex-shrink-0 rounded-md px-1 py-0.5 text-center text-[9px] font-bold tabular-nums ${defenseRankPillClass(row.defenseRank)}`}>#{row.defenseRank}</span>
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

function WorldCupPlayerComparisonPanel({
  isDark,
  selectedPlayer,
  selectedPlayerId,
  selectedTeam,
  opponentTeam,
  playerMatchStats,
  matches,
  playerMatches,
  rosters,
  playerVsPool,
  squadPlayerMatchStats,
  wc2026OpponentBreakdown,
  deferPanelFallbacks = false,
}: {
  isDark: boolean;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedPlayerId: string | null;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  playerMatchStats: Array<Record<string, any>>;
  matches: Array<Record<string, any>>;
  playerMatches: Array<Record<string, any>>;
  rosters: Array<Record<string, any>>;
  playerVsPool?: WorldCupDashboardData['playerVsPool'];
  squadPlayerMatchStats?: Array<Record<string, any>>;
  wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse;
  deferPanelFallbacks?: boolean;
}) {
  const [tab, setTab] = useState<PlayerComparisonTab>('team');
  const tabs: Array<{ id: PlayerComparisonTab; label: string }> = [
    { id: 'team', label: 'Player vs Team' },
    { id: 'player', label: 'Player vs Player' },
  ];
  const activeTab = 'bg-purple-600 text-white border-purple-600';
  const inactiveTab =
    'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700';

  return (
    <div className="flex w-full min-w-0 flex-col px-0.5 pb-0.5 pt-0.5 xl:px-1 xl:pb-1 xl:pt-1">
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

      {tab === 'team' ? (
        <WorldCupPlayerVsTeamPanel
          isDark={isDark}
          embedded
          selectedPlayer={selectedPlayer}
          selectedPlayerId={selectedPlayerId}
          selectedTeam={selectedTeam}
          opponentTeam={opponentTeam}
          playerMatchStats={playerMatchStats}
          matches={matches}
          playerMatches={playerMatches}
          playerVsPool={playerVsPool}
          wc2026OpponentBreakdown={wc2026OpponentBreakdown}
          deferPanelFallbacks={deferPanelFallbacks}
        />
      ) : (
        <WorldCupPlayerVsPlayerPanel
          isDark={isDark}
          selectedPlayer={selectedPlayer}
          selectedPlayerId={selectedPlayerId}
          playerMatchStats={playerMatchStats}
          matches={matches}
          playerMatches={playerMatches}
          rosters={rosters}
          squadPlayerMatchStats={squadPlayerMatchStats}
        />
      )}
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
  dvpBundles,
  wc2026OpponentBreakdown,
}: {
  isDark: boolean;
  mode: PropsMode;
  selectedPlayer: WorldCupPlayerOption | null;
  selectedTeam: WorldCupTeamOption | null;
  opponentTeam: WorldCupTeamOption | null;
  teamOptions: WorldCupTeamOption[];
  competition: Competition;
  dvpBundles?: Record<string, WorldCupDvpResponse>;
  wc2026OpponentBreakdown?: WorldCupOppBreakdownResponse;
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
              dvpBundles={dvpBundles}
            />
          </div>
        ) : activeTabId === 'opponent' ? (
          <div className="h-full">
            <WorldCupOpponentBreakdownCard
              isDark={isDark}
              opponentTeam={opponentTeam}
              wc2026OpponentBreakdown={wc2026OpponentBreakdown}
            />
          </div>
        ) : (
          <div className="h-full">
            <WorldCupTeamMatchupCard
              isDark={isDark}
              selectedTeam={selectedTeam}
              opponentTeam={opponentTeam}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function useIsLgDesktop(): boolean {
  const [isLgDesktop, setIsLgDesktop] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsLgDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return isLgDesktop;
}

export function WorldCupPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlPlayerQuery = searchParams.get('player')?.trim() || searchParams.get('name')?.trim() || null;
  const urlPlayerId = searchParams.get('playerId')?.trim() || null;
  const urlTeamQuery = searchParams.get('team')?.trim() || null;
  const urlTeamIdQuery = searchParams.get('teamId')?.trim() || null;
  const urlOpponentQuery = searchParams.get('opponent')?.trim() || null;
  const urlOpponentTeamIdQuery = searchParams.get('opponentTeamId')?.trim() || null;
  const urlStatQuery = searchParams.get('stat')?.trim() || null;
  const urlLineQuery = searchParams.get('line')?.trim() || null;
  const urlBookmakerQuery = searchParams.get('bookmaker')?.trim() || null;
  const urlPositionQuery = searchParams.get('position')?.trim() || null;
  const urlMatchDateQuery = searchParams.get('matchDate')?.trim() || null;
  const urlPlayerSlug = worldCupPlayerSlugFromPathname(pathname);
  const { theme, setTheme, isDark } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>(DEFAULT_ODDS_FORMAT);
  useOddsFormat({ setOddsFormat });
  const [propsMode, setPropsMode] = useState<PropsMode>('player');
  const [competition, setCompetition] = useState<Competition>('all');
  const [selectedTeam, setSelectedTeam] = useState<WorldCupTeamOption | null>(null);
  /** Game Props team pick — independent from the player's nation (mirrors AFL `aflTeamFilter`). */
  const [gamePropsTeam, setGamePropsTeam] = useState<WorldCupTeamOption | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<WorldCupPlayerOption | null>(null);
  const [teamSearchQuery, setTeamSearchQuery] = useState('');
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [searchedPlayers, setSearchedPlayers] = useState<WorldCupPlayerOption[]>([]);
  const [fixtureOpponentName, setFixtureOpponentName] = useState<string | null>(null);
  const propsHandoffPositionRef = useRef<string | null>(null);
  const preferredWcBookmakerRef = useRef<string | null>(null);
  const hasIncomingWcBookOrLineRef = useRef(false);
  const lastAppliedDeepLinkKeyRef = useRef('');
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
  const handleChartContextChange = useCallback((next: WorldCupChartContext) => {
    setChartContext((prev) => {
      if (worldCupChartContextEqual(prev, next)) return prev;
      if (prev.statId !== next.statId) {
        const urlStat = searchParams.get('stat')?.trim();
        const urlStatId = urlStat ? normalizeWorldCupStatFromUrl(urlStat) : null;
        if (urlStatId !== next.statId) {
          hasIncomingWcBookOrLineRef.current = false;
        }
      }
      return next;
    });
  }, [searchParams]);
  const supportingStatsDataFingerprint = useMemo(
    () => worldCupSupportingDataFingerprint(worldCupData),
    [worldCupData]
  );
  const supportingStatsData = useMemo(
    () => worldCupData,
    [supportingStatsDataFingerprint]
  );
  const [isPro, setIsPro] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [navigatingToProps, setNavigatingToProps] = useState(false);
  const navigatingToPropsRef = useRef(false);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);
  const journalDropdownRef = useRef<HTMLDivElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);
  const previousCompetition = useRef<Competition | null>(null);
  const hadStoredTeamOnHydration = useRef(false);
  const prevPropsModeRef = useRef<PropsMode>('player');
  const prevTeamContextIdRef = useRef<string>('');
  const prevSelectedPlayerIdRef = useRef<string | null>(null);
  const loadedDashboardKeyRef = useRef<string | null>(null);
  const dashboardFetchInFlightKeyRef = useRef<string | null>(null);
  const prevDashboardRequestKeyRef = useRef<string | null>(null);
  const urlPlayerResolvedRef = useRef(false);
  const lastUrlPlayerKeyRef = useRef('');
  const urlPlayerFetchInFlightRef = useRef(false);
  const prevUrlPlayerDeepLinkKeyRef = useRef('');
  const lastWcAutoLineContextRef = useRef<string | null>(null);
  const ignoreNextWcTransientLineRef = useRef(false);
  const preferredWcBookAppliedRef = useRef(false);
  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } = useDashboardStyles({
    sidebarOpen,
  });
  const isLgDesktop = useIsLgDesktop();
  const deferPanelFallbacks = Boolean(worldCupData?.playerChartOnly);

  const navigateBackToPlayerProps = useCallback(() => {
    navigatingToPropsRef.current = true;
    setNavigatingToProps(true);
    let returnSport: PropsSportMode = 'world-cup';
    try {
      clearWorldCupDashboardPersistence();
      const stored = sessionStorage.getItem(WC_PROPS_RETURN_SPORT_KEY)?.trim();
      if (stored === 'combined' || stored === 'nba' || stored === 'afl' || stored === 'world-cup') {
        returnSport = stored;
      }
      sessionStorage.removeItem(WC_PROPS_RETURN_SPORT_KEY);
      sessionStorage.setItem(WC_BACK_TO_PROPS_SKIP_FETCH_KEY, '1');
      sessionStorage.setItem(WC_BACK_TO_PROPS_CLEAR_SEARCH_KEY, '1');
    } catch {
      /* ignore */
    }
    setNavigatingToProps(true);
    router.push(propsPathForSport(returnSport));
  }, [router]);

  useEffect(() => {
    router.prefetch(propsPathForSport('world-cup'));
    router.prefetch(propsPathForSport('combined'));
  }, [router]);

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
        standings.find((row) => Number(row?.team?.id) === team.id)?.group?.name ??
        readWorldCupMatchGroup(worldCupData?.featureMatch) ??
        'World Cup',
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
  const resolvedActiveTeamId =
    activeTeamId && /^\d+$/.test(activeTeamId)
      ? activeTeamId
      : urlTeamIdQuery && /^\d+$/.test(urlTeamIdQuery)
        ? urlTeamIdQuery
        : null;
  const selectedPlayerId = selectedPlayer?.id && /^\d+$/.test(selectedPlayer.id) ? selectedPlayer.id : null;
  const selectedTeamNeedsHydration = !selectedTeamId || !/^\d+$/.test(selectedTeamId);
  const activeTeamNeedsHydration = !resolvedActiveTeamId;
  const hasChartStats = Boolean(worldCupData?.playerMatchStats?.length);
  const chartContextTeam = useMemo((): WorldCupTeamOption | null => {
    if (activeTeam?.id && /^\d+$/.test(activeTeam.id)) return activeTeam;
    if (!resolvedActiveTeamId) return activeTeam;
    const fromOptions = teamOptions.find((team) => team.id === resolvedActiveTeamId);
    if (fromOptions) return fromOptions;
    if (
      worldCupData?.selectedTeam?.id != null &&
      String(worldCupData.selectedTeam.id) === resolvedActiveTeamId
    ) {
      return worldCupTeamOptionFromBdl(worldCupData.selectedTeam);
    }
    const fallbackName = urlTeamQuery || selectedPlayer?.teamName || 'Team';
    return {
      id: resolvedActiveTeamId,
      name: fallbackName,
      abbreviation: fallbackName.slice(0, 3).toUpperCase(),
      countryCode: null,
      group: 'World Cup',
      confederation: 'FIFA',
    };
  }, [
    activeTeam,
    resolvedActiveTeamId,
    teamOptions,
    urlTeamQuery,
    selectedPlayer?.teamName,
    worldCupData?.selectedTeam,
  ]);

  const dashboardRequestKey = useMemo(() => {
    if (!hydratedFromStorage || !hasSelection) return null;

    const activeTeamIdForRequest =
      activeTeamId && /^\d+$/.test(activeTeamId)
        ? activeTeamId
        : urlTeamIdQuery && /^\d+$/.test(urlTeamIdQuery)
          ? urlTeamIdQuery
          : null;
    const playerNameForRequest =
      urlPlayerQuery ||
      (urlPlayerSlug ? worldCupPlayerSlugToSearchHint(urlPlayerSlug) : '') ||
      selectedPlayer?.name?.trim() ||
      '';
    const playerIdForRequest =
      selectedPlayerId || (urlPlayerId && /^\d+$/.test(urlPlayerId) ? urlPlayerId : null);
    const teamNameForRequest =
      selectedTeam?.name?.trim() || urlTeamQuery || selectedPlayer?.teamName?.trim() || '';
    const opponentNameForRequest = fixtureOpponentName || urlOpponentQuery || '';

    if (propsMode === 'player') {
      if (!playerNameForRequest && !playerIdForRequest) return null;
      const params = buildWorldCupPlayerDashboardParams({
        playerName: playerNameForRequest || 'World Cup Player',
        playerId: playerIdForRequest,
        teamId: activeTeamIdForRequest,
        teamName: activeTeamIdForRequest ? null : teamNameForRequest || null,
        opponentTeamId: urlOpponentTeamIdQuery,
        opponentTeamName: opponentNameForRequest || null,
        competition,
      });
      return worldCupDashboardRequestKey(params);
    }

    if (!activeTeamIdForRequest && !teamNameForRequest) return null;
    const params = new URLSearchParams({ season: '2026', competition });
    if (activeTeamIdForRequest) params.set('teamId', activeTeamIdForRequest);
    else if (teamNameForRequest) params.set('teamName', teamNameForRequest);
    if (urlOpponentTeamIdQuery && /^\d+$/.test(urlOpponentTeamIdQuery)) {
      params.set('opponentTeamId', urlOpponentTeamIdQuery);
    }
    if (opponentNameForRequest) params.set('opponentTeamName', opponentNameForRequest);
    return worldCupDashboardRequestKey(params);
  }, [
    hydratedFromStorage,
    hasSelection,
    propsMode,
    activeTeamId,
    selectedPlayerId,
    selectedPlayer?.name,
    selectedPlayer?.teamName,
    selectedTeam?.name,
    competition,
    fixtureOpponentName,
    urlTeamIdQuery,
    urlTeamQuery,
    urlOpponentQuery,
    urlOpponentTeamIdQuery,
    urlPlayerQuery,
    urlPlayerSlug,
    urlPlayerId,
  ]);

  const chartDashboardRequestKey = useMemo(() => {
    if (!hydratedFromStorage || !hasSelection || propsMode !== 'player') return null;

    const activeTeamIdForRequest =
      activeTeamId && /^\d+$/.test(activeTeamId)
        ? activeTeamId
        : urlTeamIdQuery && /^\d+$/.test(urlTeamIdQuery)
          ? urlTeamIdQuery
          : null;
    const playerNameForRequest =
      urlPlayerQuery ||
      (urlPlayerSlug ? worldCupPlayerSlugToSearchHint(urlPlayerSlug) : '') ||
      selectedPlayer?.name?.trim() ||
      '';
    const playerIdForRequest =
      selectedPlayerId || (urlPlayerId && /^\d+$/.test(urlPlayerId) ? urlPlayerId : null);
    const teamNameForRequest =
      selectedTeam?.name?.trim() || urlTeamQuery || selectedPlayer?.teamName?.trim() || '';
    const opponentNameForRequest = fixtureOpponentName || urlOpponentQuery || '';

    if (!playerNameForRequest && !playerIdForRequest) return null;
    const params = buildWorldCupPlayerDashboardParams({
      playerName: playerNameForRequest || 'World Cup Player',
      playerId: playerIdForRequest,
      teamId: activeTeamIdForRequest,
      teamName: activeTeamIdForRequest ? null : teamNameForRequest || null,
      opponentTeamId: urlOpponentTeamIdQuery,
      opponentTeamName: opponentNameForRequest || null,
      competition,
      playerChartOnly: true,
    });
    return worldCupDashboardRequestKey(params);
  }, [
    hydratedFromStorage,
    hasSelection,
    propsMode,
    activeTeamId,
    selectedPlayerId,
    selectedPlayer?.name,
    selectedPlayer?.teamName,
    selectedTeam?.name,
    competition,
    fixtureOpponentName,
    urlTeamIdQuery,
    urlTeamQuery,
    urlOpponentQuery,
    urlOpponentTeamIdQuery,
    urlPlayerQuery,
    urlPlayerSlug,
    urlPlayerId,
  ]);

  const chartRevealKey = useMemo(() => {
    if (!hasSelection) return '';
    if (propsMode === 'player') {
      return `player:${selectedPlayerId ?? selectedPlayer?.name ?? ''}:${dashboardRequestKey ?? ''}`;
    }
    return `team:${activeTeamId ?? ''}:${dashboardRequestKey ?? ''}`;
  }, [
    hasSelection,
    propsMode,
    selectedPlayerId,
    selectedPlayer?.name,
    activeTeamId,
    dashboardRequestKey,
  ]);
  const [chartRevealHold, setChartRevealHold] = useState(false);
  const chartRevealKeyRef = useRef('');
  useEffect(() => {
    if (worldCupData?.playerMatchStats?.length) {
      setChartRevealHold(false);
    }
  }, [worldCupData?.playerMatchStats?.length]);

  useEffect(() => {
    if (!chartRevealKey) {
      setChartRevealHold(false);
      chartRevealKeyRef.current = '';
      return;
    }
    if (chartRevealKey === chartRevealKeyRef.current) return;
    chartRevealKeyRef.current = chartRevealKey;
    // Skip the skeleton flash when chart rows are already on screen (cache / prefetch).
    if (worldCupData?.playerMatchStats?.length) {
      setChartRevealHold(false);
      return;
    }
    setChartRevealHold(true);
    const timer = window.setTimeout(() => setChartRevealHold(false), WC_CHART_REVEAL_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [chartRevealKey, worldCupData?.playerMatchStats?.length]);
  const chartAreaLoading =
    !hasChartStats &&
    (chartRevealHold ||
      (hasSelection && !worldCupError && (worldCupLoading || !worldCupData)));
  const showContentSkeleton = !hasSelection || (!hasChartStats && chartAreaLoading);
  const showInsightsSkeleton = showContentSkeleton;

  const playerOptions = useMemo<WorldCupPlayerOption[]>(() => {
    const rosterPlayers = !worldCupData?.rosters?.length ? [] : worldCupData.rosters.slice(0, 80).map((row, i) => {
      const player = row.player ?? {};
      const name = formatWorldCupPlayerDisplayName(String(player.name || player.short_name || 'World Cup Player'));
      const parts = name.split(/\s+/).filter(Boolean);
      const teamId = row.team_id != null ? String(row.team_id) : worldCupData.selectedTeam?.id != null ? String(worldCupData.selectedTeam.id) : null;
      const teamName = teamOptions.find((team) => team.id === teamId)?.name || selectedTeam?.name || worldCupData.selectedTeam?.name || 'World Cup';
      const club = String(player.club || player.club_name || player.current_club || row.club || '').trim() || null;
      const rawPosition = String(row.position || player.position || '').trim();
      const positionGroup = resolveWorldCupPlayerGroup(rawPosition);
      return {
        id: String(player.id ?? name),
        name,
        shortName: String(player.short_name || `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` || 'WC').slice(0, 3).toUpperCase(),
        teamName,
        teamId,
        countryCode: String(player.country_code || '').trim() || null,
        number: String(player.jersey_number || row.shirt_number || ''),
        role: classifyWorldCupPositionGroup(rawPosition) ? rawPosition : positionGroup,
        positionGroup,
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
    if (!hasSelection) return null;
    const featureMatch = worldCupData?.featureMatch;
    if (featureMatch && activeTeam?.id && !activeTeamNeedsHydration) {
      const homeId = featureMatch.homeTeam?.id != null ? String(featureMatch.homeTeam.id) : null;
      const awayId = featureMatch.awayTeam?.id != null ? String(featureMatch.awayTeam.id) : null;
      if (homeId === activeTeam.id && awayId) {
        return teamOptions.find((team) => team.id === awayId) ?? null;
      }
      if (awayId === activeTeam.id && homeId) {
        return teamOptions.find((team) => team.id === homeId) ?? null;
      }
    }
    const opponentHint = fixtureOpponentName || urlOpponentQuery;
    if (opponentHint && teamOptions.length) {
      return resolveWorldCupTeamByName(opponentHint, teamOptions);
    }
    return null;
  }, [
    hasSelection,
    activeTeam?.id,
    activeTeamNeedsHydration,
    teamOptions,
    worldCupData?.featureMatch,
    fixtureOpponentName,
    urlOpponentQuery,
  ]);
  const emptyText = isDark ? 'text-gray-400' : 'text-gray-500';
  const featureMatchMeta = worldCupData?.featureMatch
    ? [
        readWorldCupMatchStage(worldCupData.featureMatch),
        readWorldCupMatchGroup(worldCupData.featureMatch),
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
  const [wcPlayerOddsBooks, setWcPlayerOddsBooks] = useState<WorldCupPlayerOddsBook[]>([]);
  const [wcPlayerOddsLoading, setWcPlayerOddsLoading] = useState(false);
  const [selectedWcBookIndex, setSelectedWcBookIndex] = useState(0);
  const [wcCurrentLineValue, setWcCurrentLineValue] = useState<number | null>(null);
  const wcExternalLineValue = useMemo(() => {
    if (propsMode !== 'player') return undefined;
    if (wcCurrentLineValue != null && Number.isFinite(wcCurrentLineValue)) return wcCurrentLineValue;
    if (!wcPlayerOddsBooks.length || !WC_PLAYER_ODDS_STATS.has(chartContext.statId)) return 0.5;
    const book = wcPlayerOddsBooks[selectedWcBookIndex];
    if (!book) return 0.5;
    const available = getAvailableWorldCupOddsLines(chartContext.statId, [book]);
    const primary = available[0] ?? getPrimaryOddsLineForStat(chartContext.statId, [book]);
    return primary ?? 0.5;
  }, [propsMode, wcCurrentLineValue, wcPlayerOddsBooks, selectedWcBookIndex, chartContext.statId]);
  const wcOddsResolvedLineValue = useMemo(() => {
    if (propsMode !== 'player' || !WC_PLAYER_ODDS_STATS.has(chartContext.statId)) return null;
    if (wcCurrentLineValue == null || !Number.isFinite(wcCurrentLineValue)) return null;
    const available = getAvailableWorldCupOddsLines(chartContext.statId, wcPlayerOddsBooks);
    return resolveWorldCupOddsLineForTarget(chartContext.statId, available, wcCurrentLineValue);
  }, [propsMode, chartContext.statId, wcCurrentLineValue, wcPlayerOddsBooks]);
  const dashboardImpliedOdds = useMemo(() => {
    if (propsMode !== 'player' || !wcPlayerOddsBooks.length) return null;
    if (wcCurrentLineValue == null || !Number.isFinite(wcCurrentLineValue)) return null;
    if (!hasWorldCupOddsForTargetLine(chartContext.statId, wcPlayerOddsBooks, wcCurrentLineValue)) {
      return null;
    }
    const line = wcOddsResolvedLineValue ?? wcCurrentLineValue;
    return calculateWorldCupImpliedOdds(
      chartContext.statId,
      line,
      wcPlayerOddsBooks,
      calculateImpliedProbabilities
    );
  }, [
    propsMode,
    wcPlayerOddsBooks,
    chartContext.statId,
    wcCurrentLineValue,
    wcOddsResolvedLineValue,
  ]);
  const fixtureLogoStyle = isDark
    ? { filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.65))' }
    : { filter: 'drop-shadow(0 0 1px rgba(15,23,42,0.45)) drop-shadow(0 1px 1px rgba(0,0,0,0.2))' };
  const selectedTeamLogo = getWorldCupFlagUrl(activeTeam?.countryCode || activeTeam?.abbreviation);
  const opponentTeamLogo = getWorldCupFlagUrl(opponentTeam?.countryCode || opponentTeam?.abbreviation);
  const selectedTeamAbbr = activeTeam?.abbreviation || activeTeam?.name?.slice(0, 3).toUpperCase() || 'TBD';
  const opponentTeamAbbr = opponentTeam?.abbreviation || opponentTeam?.name?.slice(0, 3).toUpperCase() || 'TBD';
  const hasMatchup =
    hasSelection &&
    Boolean(
      (opponentTeam || urlOpponentQuery || fixtureOpponentName) &&
        (activeTeam || (urlTeamIdQuery && (urlTeamQuery || selectedPlayer?.teamName)))
    );

  useEffect(() => {
    const { homeName, awayName, matchDate } = resolveWorldCupPlayerOddsMatchup({
      urlTeamQuery,
      urlOpponentQuery,
      urlMatchDateQuery,
      activeTeam,
      opponentTeam,
      selectedPlayer,
      fixtureOpponentName,
      featureMatchDatetime: worldCupData?.featureMatch?.datetime
        ? String(worldCupData.featureMatch.datetime)
        : null,
    });

    if (propsMode !== 'player' || !selectedPlayer?.name || !homeName || !awayName) {
      setWcPlayerOddsBooks([]);
      setWcPlayerOddsLoading(false);
      return;
    }

    let cancelled = false;
    const oddsPrefetch = readWorldCupPlayerOddsPrefetch({
      playerName: selectedPlayer.name,
      team: homeName,
      opponent: awayName,
      matchDate: matchDate || null,
    });
    if (oddsPrefetch?.books?.length) {
      setWcPlayerOddsBooks(oddsPrefetch.books as WorldCupPlayerOddsBook[]);
      setWcPlayerOddsLoading(false);
    } else {
      setWcPlayerOddsLoading(true);
    }

    const params = new URLSearchParams({
      playerOdds: '1',
      playerName: selectedPlayer.name,
      homeTeam: homeName,
      awayTeam: awayName,
    });
    if (matchDate) params.set('matchDate', matchDate);
    const oddsUrl = `/api/world-cup/dashboard?${params.toString()}`;

    void fetchWorldCupDashboardJson<{ books?: WorldCupPlayerOddsBook[] }>(oddsUrl)
      .then((json) => {
        if (cancelled) return;
        setWcPlayerOddsBooks(Array.isArray(json?.books) ? json.books : []);
      })
      .catch(() => {
        if (!cancelled && !oddsPrefetch?.books?.length) setWcPlayerOddsBooks([]);
      })
      .finally(() => {
        if (!cancelled) setWcPlayerOddsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    propsMode,
    selectedPlayer?.id,
    selectedPlayer?.name,
    selectedPlayer?.teamName,
    urlTeamQuery,
    urlOpponentQuery,
    urlMatchDateQuery,
    activeTeam?.name,
    opponentTeam?.name,
    fixtureOpponentName,
    worldCupData?.featureMatch?.datetime,
  ]);

  useEffect(() => {
    if (!wcPlayerOddsBooks.length) {
      setSelectedWcBookIndex(0);
      preferredWcBookAppliedRef.current = false;
      if (!hasIncomingWcBookOrLineRef.current) {
        setWcCurrentLineValue(null);
      }
      return;
    }
  }, [wcPlayerOddsBooks]);

  useEffect(() => {
    const preferred = preferredWcBookmakerRef.current;
    if (!preferred || !wcPlayerOddsBooks.length) return;
    if (preferredWcBookAppliedRef.current) return;

    const statId = chartContext.statId;
    const line = wcCurrentLineValue;
    const preferredLower = preferred.trim().toLowerCase();

    const preferredWithLineIdx = wcPlayerOddsBooks.findIndex((book) => {
      const label = String(book.name || '').trim().toLowerCase();
      return label === preferredLower && worldCupBookOffersOddsLine(statId, book, line);
    });
    const preferredIdx =
      preferredWithLineIdx >= 0
        ? preferredWithLineIdx
        : wcPlayerOddsBooks.findIndex((book) => String(book.name || '').trim().toLowerCase() === preferredLower);

    if (preferredIdx >= 0) {
      preferredWcBookAppliedRef.current = true;
      setSelectedWcBookIndex(preferredIdx);
    }
  }, [wcPlayerOddsBooks, chartContext.statId, wcCurrentLineValue]);

  // When stat changes: pick a book with data and set line from that book. On refetch,
  // preserve a manual line that differs from the book line (AFL dashboard behavior).
  useEffect(() => {
    if (propsMode !== 'player' || !wcPlayerOddsBooks.length) return;
    if (!WC_PLAYER_ODDS_STATS.has(chartContext.statId)) return;

    if (
      hasIncomingWcBookOrLineRef.current &&
      wcCurrentLineValue != null &&
      Number.isFinite(wcCurrentLineValue)
    ) {
      lastWcAutoLineContextRef.current = chartContext.statId;
      return;
    }

    const lineFromBook = (book: WorldCupPlayerOddsBook) => {
      const available = getAvailableWorldCupOddsLines(chartContext.statId, [book]);
      return available[0] ?? getPrimaryOddsLineForStat(chartContext.statId, [book]);
    };

    let book = wcPlayerOddsBooks[selectedWcBookIndex];
    let line = book ? lineFromBook(book) : null;
    if (line == null) {
      const withDataIdx = wcPlayerOddsBooks.findIndex((candidate) => lineFromBook(candidate) != null);
      if (withDataIdx >= 0) {
        setSelectedWcBookIndex(withDataIdx);
        book = wcPlayerOddsBooks[withDataIdx];
        line = lineFromBook(book);
      }
    }

    const n = line != null && Number.isFinite(line) ? line : 0.5;
    const currentContext = chartContext.statId;
    const contextChanged = lastWcAutoLineContextRef.current !== currentContext;
    lastWcAutoLineContextRef.current = currentContext;

    if (!Number.isFinite(n)) return;
    const tol = 0.01;
    if (
      !contextChanged &&
      wcCurrentLineValue != null &&
      Number.isFinite(wcCurrentLineValue) &&
      Math.abs(wcCurrentLineValue - n) > tol
    ) {
      return;
    }
    ignoreNextWcTransientLineRef.current = true;
    setWcCurrentLineValue(n);
  }, [propsMode, chartContext.statId, wcPlayerOddsBooks, selectedWcBookIndex, wcCurrentLineValue]);

  // When the user edits the line input, switch to a book that offers that line when possible.
  useEffect(() => {
    if (propsMode !== 'player' || !wcPlayerOddsBooks.length) return;
    if (!WC_PLAYER_ODDS_STATS.has(chartContext.statId)) return;
    if (ignoreNextWcTransientLineRef.current) {
      ignoreNextWcTransientLineRef.current = false;
      return;
    }
    if (wcCurrentLineValue == null || !Number.isFinite(wcCurrentLineValue)) return;

    const tol = 0.01;
    const value = wcCurrentLineValue;
    for (let idx = 0; idx < wcPlayerOddsBooks.length; idx++) {
      const lines = getAvailableWorldCupOddsLines(chartContext.statId, [wcPlayerOddsBooks[idx]]);
      const resolved = resolveWorldCupOddsLineForTarget(chartContext.statId, lines, value);
      if (resolved != null && lines.some((line) => worldCupOddsLinesMatch(line, resolved))) {
        if (idx !== selectedWcBookIndex) setSelectedWcBookIndex(idx);
        return;
      }
    }
  }, [propsMode, wcCurrentLineValue, chartContext.statId, wcPlayerOddsBooks, selectedWcBookIndex]);

  const handleSelectWcOddsLine = useCallback((lineValue: number) => {
    ignoreNextWcTransientLineRef.current = true;
    setWcCurrentLineValue(lineValue);
  }, []);
  const skeletonBar = isDark ? 'bg-gray-800' : 'bg-gray-200';

  const urlPlayerResolveKey = [
    urlPlayerSlug?.toLowerCase() ?? '',
    urlPlayerId && /^\d+$/.test(urlPlayerId) ? urlPlayerId : '',
    urlPlayerQuery ? normalizeWorldCupPlayerName(urlPlayerQuery) : '',
  ].join('|');
  const hasUrlPlayerTarget = Boolean(urlPlayerSlug || urlPlayerQuery || urlPlayerId);

  const urlDeepLinkKey = [
    urlPlayerQuery ?? '',
    urlPlayerId ?? '',
    urlTeamQuery ?? '',
    urlTeamIdQuery ?? '',
    urlOpponentQuery ?? '',
    urlStatQuery ?? '',
    urlLineQuery ?? '',
    urlBookmakerQuery ?? '',
  ].join('|');

  // Props-page deep link: player, team, opponent, stat, line, bookmaker in the query string.
  useEffect(() => {
    if (!hydratedFromStorage) return;
    if (
      !urlPlayerQuery &&
      !urlPlayerId &&
      !urlTeamQuery &&
      !urlOpponentQuery &&
      !urlStatQuery &&
      !urlLineQuery &&
      !urlBookmakerQuery
    ) {
      return;
    }
    if (lastAppliedDeepLinkKeyRef.current === urlDeepLinkKey) return;
    lastAppliedDeepLinkKeyRef.current = urlDeepLinkKey;
    preferredWcBookAppliedRef.current = false;
    if (urlOpponentQuery) setFixtureOpponentName(urlOpponentQuery);
    if (urlStatQuery) {
      setChartContext((prev) => chartContextFromStatParam(urlStatQuery, prev.timeframe));
    }
    if (urlLineQuery) {
      const line = Number.parseFloat(urlLineQuery);
      if (Number.isFinite(line)) {
        hasIncomingWcBookOrLineRef.current = true;
        setWcCurrentLineValue(line);
      }
    }
    if (urlBookmakerQuery) {
      preferredWcBookmakerRef.current = urlBookmakerQuery;
      hasIncomingWcBookOrLineRef.current = true;
    }
  }, [
    hydratedFromStorage,
    urlDeepLinkKey,
    urlPlayerQuery,
    urlPlayerId,
    urlTeamQuery,
    urlOpponentQuery,
    urlStatQuery,
    urlLineQuery,
    urlBookmakerQuery,
  ]);

  useEffect(() => {
    if (!hydratedFromStorage || (!urlTeamQuery && !urlTeamIdQuery) || !teamOptions.length) return;
    const team = resolveWorldCupTeamFromUrl(teamOptions, urlTeamIdQuery, urlTeamQuery);
    if (team && team.id !== selectedTeam?.id) {
      setSelectedTeam(team);
      setTeamSearchQuery('');
    }
  }, [hydratedFromStorage, urlTeamQuery, urlTeamIdQuery, teamOptions, selectedTeam?.id]);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    if (navigatingToPropsRef.current || navigatingToProps) return;
    const stablePlayerKey = worldCupStableUrlPlayerKey(urlPlayerSlug, urlPlayerQuery);
    if (!stablePlayerKey) return;
    if (prevUrlPlayerDeepLinkKeyRef.current && prevUrlPlayerDeepLinkKeyRef.current !== stablePlayerKey) {
      setSelectedPlayer(null);
      setSelectedTeam(null);
      setWorldCupData(null);
      setWorldCupError(null);
      setWorldCupLoading(false);
      setFixtureOpponentName(null);
      loadedDashboardKeyRef.current = null;
      dashboardFetchInFlightKeyRef.current = null;
      urlPlayerResolvedRef.current = false;
      urlPlayerFetchInFlightRef.current = false;
      propsHandoffPositionRef.current = null;
    }
    prevUrlPlayerDeepLinkKeyRef.current = stablePlayerKey;
  }, [hydratedFromStorage, navigatingToProps, urlPlayerQuery, urlPlayerSlug]);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    if (navigatingToPropsRef.current || navigatingToProps) return;
    const parsed = parseWorldCupPropsHandoff(sessionStorage.getItem('wc_player_from_props'));
    if (!parsed) return;
    sessionStorage.removeItem('wc_player_from_props');
    applyWorldCupPropsHandoffState(
      parsed,
      teamOptions,
      {
        setFixtureOpponentName,
        setChartContext,
        setWcCurrentLineValue,
        setSelectedTeam,
        setTeamSearchQuery,
        setPropsMode,
        setSelectedPlayer,
        setCompetition,
        setWorldCupData,
      },
      {
        propsHandoffPositionRef,
        preferredWcBookmakerRef,
        hasIncomingWcBookOrLineRef,
        urlPlayerResolvedRef,
        previousCompetition,
        loadedDashboardKeyRef,
      }
    );
  }, [hydratedFromStorage, navigatingToProps, teamOptions, urlDeepLinkKey]);

  // Rehydrate page context on refresh only (sessionStorage — cleared when tab closes).
  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      setHydratedFromStorage(true);
      return;
    }
    clearLegacyWorldCupLocalStorage();
    const storage = worldCupSelectionStorage();
    const pageUrl = new URL(window.location.href);
    const urlHasPlayer = Boolean(
      pageUrl.pathname.startsWith('/world-cup/player/') ||
        pageUrl.searchParams.get('player')?.trim() ||
        pageUrl.searchParams.get('name')?.trim() ||
        pageUrl.searchParams.get('playerId')?.trim()
    );
    const urlMode = pageUrl.searchParams.get('mode')?.trim();
    const applyPropsHandoffDuringHydration = () => {
      const parsed = parseWorldCupPropsHandoff(sessionStorage.getItem('wc_player_from_props'));
      if (!parsed) return false;
      sessionStorage.removeItem('wc_player_from_props');
      return applyWorldCupPropsHandoffState(
        parsed,
        [],
        {
          setFixtureOpponentName,
          setChartContext,
          setWcCurrentLineValue,
          setSelectedTeam,
          setTeamSearchQuery,
          setPropsMode,
          setSelectedPlayer,
          setCompetition,
          setWorldCupData,
        },
        {
          propsHandoffPositionRef,
          preferredWcBookmakerRef,
          hasIncomingWcBookOrLineRef,
          urlPlayerResolvedRef,
          previousCompetition,
          loadedDashboardKeyRef,
        }
      );
    };

    const seedPlayerFromUrl = (alreadyHasPlayer: boolean) => {
      if (alreadyHasPlayer || !urlHasPlayer) return;
      const urlPlayerIdFromPage = pageUrl.searchParams.get('playerId')?.trim() || null;
      const urlPlayerNameFromPage =
        pageUrl.searchParams.get('player')?.trim() || pageUrl.searchParams.get('name')?.trim() || null;
      const slugFromPath = worldCupPlayerSlugFromPathname(pageUrl.pathname);
      const hint = slugFromPath
        ? worldCupPlayerSlugToSearchHint(slugFromPath)
        : urlPlayerNameFromPage || urlPlayerIdFromPage || '';
      if (!hint) return;
      setPropsMode('player');
      const urlPositionFromPage = pageUrl.searchParams.get('position')?.trim() || null;
      setSelectedPlayer(worldCupPlayerPlaceholderFromHint(hint, urlPlayerIdFromPage, urlPositionFromPage));
      const urlTeamFromPage = pageUrl.searchParams.get('team')?.trim() || null;
      const urlTeamIdFromPage = pageUrl.searchParams.get('teamId')?.trim() || null;
      if (urlTeamFromPage && urlTeamIdFromPage && /^\d+$/.test(urlTeamIdFromPage)) {
        setSelectedTeam({
          id: urlTeamIdFromPage,
          name: urlTeamFromPage,
          abbreviation: urlTeamFromPage.slice(0, 3).toUpperCase(),
          countryCode: resolveWorldCupFlagCode(urlTeamFromPage) || null,
          group: 'World Cup',
          confederation: 'FIFA',
        });
        setTeamSearchQuery('');
      }
      const urlOpponentFromPage = pageUrl.searchParams.get('opponent')?.trim() || null;
      if (urlOpponentFromPage) setFixtureOpponentName(urlOpponentFromPage);
      const urlStatFromPage = pageUrl.searchParams.get('stat')?.trim() || null;
      if (urlStatFromPage) {
        setChartContext((prev) => chartContextFromStatParam(urlStatFromPage, prev.timeframe));
      }
    };

    if (!storage) {
      if (urlHasPlayer) setPropsMode('player');
      else if (urlMode === 'team' || urlMode === 'player') setPropsMode(urlMode);
      const handoffPlayer = applyPropsHandoffDuringHydration();
      seedPlayerFromUrl(handoffPlayer);
      setHydratedFromStorage(true);
      return;
    }
    let restoredStoredPlayer = false;
    try {
      const storedMode = storage.getItem(WORLD_CUP_STORAGE_KEYS.propsMode);
      let restoredCompetition: Competition = 'all';
      const storedCompetition = storage.getItem(WORLD_CUP_STORAGE_KEYS.competition);

      if (urlHasPlayer) {
        setPropsMode('player');
        setCompetition('all');
        restoredCompetition = 'all';
      } else if (urlMode === 'team' || urlMode === 'player') {
        setPropsMode(urlMode);
        if (
          storedCompetition === 'all' ||
          storedCompetition === 'world-cup' ||
          storedCompetition === 'euros' ||
          storedCompetition === 'nations-league'
        ) {
          restoredCompetition = storedCompetition;
          setCompetition(storedCompetition);
        }
      } else if (storedMode === 'player' || storedMode === 'team') {
        setPropsMode(storedMode);
        if (
          storedCompetition === 'all' ||
          storedCompetition === 'world-cup' ||
          storedCompetition === 'euros' ||
          storedCompetition === 'nations-league'
        ) {
          restoredCompetition = storedCompetition;
          setCompetition(storedCompetition);
        }
      } else if (
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

      const storedTeamRaw = storage.getItem(WORLD_CUP_STORAGE_KEYS.selectedTeam);
      if (!urlHasPlayer && storedTeamRaw) {
        const parsed = JSON.parse(storedTeamRaw) as WorldCupTeamOption | null;
        if (parsed && parsed.id) {
          setSelectedTeam(parsed);
          setTeamSearchQuery('');
        }
      }

      const storedGamePropsTeamRaw = storage.getItem(WORLD_CUP_STORAGE_KEYS.gamePropsTeam);
      if (storedGamePropsTeamRaw) {
        const parsed = JSON.parse(storedGamePropsTeamRaw) as WorldCupTeamOption | null;
        if (parsed && parsed.id) {
          hadStoredTeamOnHydration.current = true;
          setGamePropsTeam(parsed);
        }
      }

      const storedPlayerRaw = storage.getItem(WORLD_CUP_STORAGE_KEYS.selectedPlayer);
      if (!urlHasPlayer && storedPlayerRaw) {
        const parsed = JSON.parse(storedPlayerRaw) as WorldCupPlayerOption | null;
        if (parsed && parsed.id) {
          restoredStoredPlayer = true;
          setSelectedPlayer(parsed);
        }
      }

      const storedChartRaw = storage.getItem(WORLD_CUP_STORAGE_KEYS.chartContext);
      const restoredMode = storedMode === 'team' ? 'team' : 'player';
      if (storedChartRaw) {
        const parsed = JSON.parse(storedChartRaw) as Partial<WorldCupChartContext> | null;
        if (parsed?.timeframe) {
          if (restoredMode === 'team') {
            setChartContext({
              statId: parsed.statId ?? 'moneyline',
              statKey: parsed.statKey ?? 'moneyline',
              statLabel: parsed.statLabel ?? 'Money Line',
              timeframe: parsed.timeframe,
            });
          } else if (parsed.statId) {
            setChartContext({
              statId: parsed.statId,
              statKey: parsed.statKey ?? parsed.statId,
              statLabel: parsed.statLabel ?? String(parsed.statId),
              timeframe: parsed.timeframe,
            });
          }
        }
      }
    } catch (err) {
      console.warn('Failed to restore World Cup selection', err);
    }
    const handoffPlayer = applyPropsHandoffDuringHydration();
    seedPlayerFromUrl(handoffPlayer || restoredStoredPlayer);

    const playerSlugFromPath = worldCupPlayerSlugFromPathname(pageUrl.pathname);
    const dashboardCacheKey = buildWorldCupDashboardRequestKeyFromPage({
      playerId: pageUrl.searchParams.get('playerId'),
      playerQuery: pageUrl.searchParams.get('player') || pageUrl.searchParams.get('name'),
      playerSlug: playerSlugFromPath,
      teamId: pageUrl.searchParams.get('teamId'),
      teamName: pageUrl.searchParams.get('team'),
      opponentTeamId: pageUrl.searchParams.get('opponentTeamId'),
      opponentName: pageUrl.searchParams.get('opponent'),
      competition: 'all',
    });
    if (dashboardCacheKey) {
      const chartCacheParams = new URLSearchParams(dashboardCacheKey);
      chartCacheParams.set('playerChartOnly', '1');
      const chartCacheKey = worldCupDashboardRequestKey(chartCacheParams);
      const fullCached =
        readPrefetchedWorldCupDashboardMem<WorldCupDashboardData>(dashboardCacheKey) ??
        readWorldCupDashboardLocalCache<WorldCupDashboardData>(dashboardCacheKey);
      const chartCached =
        readPrefetchedWorldCupDashboardMem<WorldCupDashboardData>(chartCacheKey) ??
        readWorldCupDashboardLocalCache<WorldCupDashboardData>(chartCacheKey);
      const earlyPayload =
        fullCached && !fullCached.playerChartOnly
          ? fullCached
          : chartCached?.playerMatchStats?.length
            ? chartCached
            : fullCached?.playerMatchStats?.length
              ? fullCached
              : null;
      if (earlyPayload) {
        const params = new URLSearchParams(dashboardCacheKey);
        if (!earlyPayload.playerChartOnly) {
          loadedDashboardKeyRef.current = buildWorldCupDashboardKey(
            'player',
            params.get('teamId'),
            params.get('playerId')
          );
          setWorldCupLoading(false);
        }
        setWorldCupData(earlyPayload ? normalizeWorldCupDashboardData(earlyPayload) : null);
      }
    }

    setHydratedFromStorage(true);
  }, []);

  useEffect(() => {
    if (urlPlayerResolveKey !== lastUrlPlayerKeyRef.current) {
      lastUrlPlayerKeyRef.current = urlPlayerResolveKey;
      urlPlayerResolvedRef.current = false;
    }
  }, [urlPlayerResolveKey]);

  useEffect(() => {
    if (urlPositionQuery) propsHandoffPositionRef.current = urlPositionQuery;
  }, [urlPositionQuery]);

  useEffect(() => {
    const position = propsHandoffPositionRef.current || urlPositionQuery;
    if (!position || !selectedPlayer?.id) return;
    const applied = worldCupPlayerOptionFromPositionLabel(position);
    if (
      selectedPlayer.role === applied.role &&
      selectedPlayer.positionGroup === applied.positionGroup &&
      selectedPlayer.propsPositionLabel === applied.propsPositionLabel
    ) {
      return;
    }
    setSelectedPlayer((prev) => {
      if (!prev) return prev;
      if (
        prev.role === applied.role &&
        prev.positionGroup === applied.positionGroup &&
        prev.propsPositionLabel === applied.propsPositionLabel
      ) {
        return prev;
      }
      return applyWorldCupPropsPositionLabel(prev, position);
    });
  }, [
    selectedPlayer?.id,
    selectedPlayer?.role,
    selectedPlayer?.positionGroup,
    selectedPlayer?.propsPositionLabel,
    urlPositionQuery,
  ]);

  // Resolve a player from /world-cup/player/[slug] or ?player= / ?playerId= query params.
  useEffect(() => {
    if (!hydratedFromStorage || !hasUrlPlayerTarget) return;
    if (navigatingToPropsRef.current || navigatingToProps) return;
    if (
      urlPlayerId &&
      selectedPlayer?.id &&
      /^\d+$/.test(selectedPlayer.id) &&
      selectedPlayer.id === urlPlayerId
    ) {
      urlPlayerResolvedRef.current = true;
      const handoffPosition = propsHandoffPositionRef.current || urlPositionQuery;
      if (handoffPosition) {
        setSelectedPlayer((prev) => (prev ? applyWorldCupPropsPositionLabel(prev, handoffPosition) : prev));
      }
      if (urlTeamQuery || urlTeamIdQuery) {
        const teamFromUrl = resolveWorldCupTeamFromUrl(teamOptions, urlTeamIdQuery, urlTeamQuery);
        if (teamFromUrl && teamFromUrl.id !== selectedTeam?.id) {
          setSelectedTeam(teamFromUrl);
          setTeamSearchQuery('');
        }
      }
      return;
    }
    if (
      worldCupPlayerMatchesUrlTarget(selectedPlayer, {
        slug: urlPlayerSlug,
        query: urlPlayerQuery,
        playerId: urlPlayerId,
      })
    ) {
      urlPlayerResolvedRef.current = true;
      const handoffPosition = propsHandoffPositionRef.current || urlPositionQuery;
      if (handoffPosition) {
        setSelectedPlayer((prev) => (prev ? applyWorldCupPropsPositionLabel(prev, handoffPosition) : prev));
      }
      return;
    }
    if (urlPlayerResolvedRef.current || urlPlayerFetchInFlightRef.current) return;

    const searchHint = urlPlayerSlug
      ? worldCupPlayerSlugToSearchHint(urlPlayerSlug)
      : urlPlayerQuery || urlPlayerId || '';
    if (!searchHint) return;

    setPropsMode('player');
    const handoffPosition = propsHandoffPositionRef.current || urlPositionQuery;
    setSelectedPlayer(worldCupPlayerPlaceholderFromHint(searchHint, urlPlayerId, handoffPosition));

    urlPlayerFetchInFlightRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ search: searchHint, competition });
        const response = await fetch(`/api/world-cup/players?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => null)) as {
          data?: Array<Record<string, unknown>>;
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load World Cup player');
        }
        if (cancelled || navigatingToPropsRef.current) return;

        const players = (payload?.data ?? []).map((player) => mapWorldCupApiPlayerRow(player, teamOptions));
        let match: WorldCupPlayerOption | null = null;
        if (urlPlayerId) {
          match = players.find((player) => player.id === urlPlayerId) ?? null;
        }
        if (!match && urlPlayerSlug) {
          match = players.find((player) => worldCupPlayerSlugMatchesName(urlPlayerSlug, player.name)) ?? null;
        }
        if (!match && urlPlayerQuery) {
          const normalizedQuery = normalizeWorldCupPlayerName(urlPlayerQuery);
          match =
            players.find((player) => normalizeWorldCupPlayerName(player.name) === normalizedQuery) ??
            players.find((player) => player.name.toLowerCase().includes(urlPlayerQuery.toLowerCase())) ??
            null;
        }
        if (!match) match = players[0] ?? null;
        if (!match) return;
        if (navigatingToPropsRef.current) return;

        const handoffPosition = propsHandoffPositionRef.current || urlPositionQuery;
        if (handoffPosition) {
          match = applyWorldCupPropsPositionLabel(match, handoffPosition);
        }

        urlPlayerResolvedRef.current = true;
        setSelectedPlayer(match);
        setSearchedPlayers((prev) => {
          const merged = new Map(prev.map((player) => [player.id, player]));
          merged.set(match!.id, match!);
          return Array.from(merged.values());
        });
        if (hasApiTeams) {
          const team =
            resolveWorldCupTeamFromUrl(teamOptions, urlTeamIdQuery, urlTeamQuery) ??
            resolveWorldCupTeamForPlayer(match, teamOptions);
          if (team) {
            setSelectedTeam(team);
            setTeamSearchQuery(team.name);
          }
        } else {
          setSelectedTeam(null);
          setTeamSearchQuery(match.teamName || urlTeamQuery || '');
        }
        if (urlOpponentQuery) setFixtureOpponentName(urlOpponentQuery);
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to resolve World Cup player from URL', error);
        }
      } finally {
        if (!cancelled) urlPlayerFetchInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hydratedFromStorage,
    navigatingToProps,
    hasUrlPlayerTarget,
    urlPlayerSlug,
    urlPlayerQuery,
    urlPlayerId,
    competition,
    teamOptions,
    hasApiTeams,
    urlTeamQuery,
    urlOpponentQuery,
  ]);

  // Keep the address bar in sync with the active player or Game Props mode.
  useEffect(() => {
    if (!hydratedFromStorage) return;
    if (navigatingToPropsRef.current || navigatingToProps) return;

    if (propsMode === 'team') {
      if (pathname?.startsWith('/world-cup/player/')) {
        router.replace('/world-cup?mode=team', { scroll: false });
      }
      return;
    }

    if (propsMode === 'player' && selectedPlayer?.name) {
      const slug = worldCupPlayerNameToSlug(selectedPlayer.name);
      if (!slug) return;
      const target = `/world-cup/player/${encodeURIComponent(slug)}`;
      const qs = buildWorldCupPlayerDeepLinkQuery({
        playerId:
          urlPlayerId && /^\d+$/.test(urlPlayerId)
            ? urlPlayerId
            : selectedPlayer.id && /^\d+$/.test(selectedPlayer.id)
              ? selectedPlayer.id
              : null,
        team: urlTeamQuery || selectedTeam?.name || null,
        teamId:
          urlTeamIdQuery && /^\d+$/.test(urlTeamIdQuery)
            ? urlTeamIdQuery
            : selectedTeam?.id && /^\d+$/.test(selectedTeam.id)
              ? selectedTeam.id
              : null,
        opponent: fixtureOpponentName || urlOpponentQuery,
        opponentTeamId: urlOpponentTeamIdQuery || opponentTeam?.id || null,
        stat: chartContext.statId,
        line:
          wcCurrentLineValue != null && Number.isFinite(wcCurrentLineValue)
            ? String(wcCurrentLineValue)
            : null,
        bookmaker: preferredWcBookmakerRef.current || urlBookmakerQuery,
        position: propsHandoffPositionRef.current || urlPositionQuery || selectedPlayer.positionGroup || selectedPlayer.role,
        matchDate: urlMatchDateQuery,
      });
      const desired = `${target}${qs}`;
      const current = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      if (current !== desired) {
        router.replace(desired, { scroll: false });
      }
      return;
    }

    if (propsMode === 'player' && !selectedPlayer && pathname?.startsWith('/world-cup/player/')) {
      router.replace('/world-cup', { scroll: false });
    }
  }, [
    hydratedFromStorage,
    navigatingToProps,
    propsMode,
    selectedPlayer?.id,
    selectedPlayer?.name,
    selectedPlayer?.role,
    selectedPlayer?.positionGroup,
    pathname,
    router,
    searchParams,
    urlTeamQuery,
    urlTeamIdQuery,
    urlOpponentQuery,
    urlOpponentTeamIdQuery,
    urlStatQuery,
    urlLineQuery,
    urlBookmakerQuery,
    urlPositionQuery,
    urlMatchDateQuery,
    fixtureOpponentName,
    selectedTeam?.name,
    selectedTeam?.id,
    opponentTeam?.id,
    chartContext.statId,
    wcCurrentLineValue,
  ]);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    const storage = worldCupSelectionStorage();
    if (!storage) return;
    try {
      storage.setItem(WORLD_CUP_STORAGE_KEYS.propsMode, propsMode);
    } catch {
      /* sessionStorage unavailable */
    }
  }, [hydratedFromStorage, propsMode]);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    const storage = worldCupSelectionStorage();
    if (!storage) return;
    try {
      storage.setItem(WORLD_CUP_STORAGE_KEYS.competition, competition);
    } catch {
      /* sessionStorage unavailable */
    }
  }, [hydratedFromStorage, competition]);

  // When the user switches competition, drop selections — but not on the initial
  // restore from sessionStorage (previousCompetition is seeded during hydration).
  useEffect(() => {
    if (!hydratedFromStorage) return;
    if (previousCompetition.current === null) {
      previousCompetition.current = competition;
      return;
    }
    if (previousCompetition.current !== competition) {
      previousCompetition.current = competition;
      setSelectedPlayer(null);
      setSelectedTeam(null);
      setGamePropsTeam(null);
      setTeamSearchQuery('');
      setSearchedPlayers([]);
      const storage = worldCupSelectionStorage();
      if (!storage) return;
      try {
        storage.removeItem(WORLD_CUP_STORAGE_KEYS.selectedTeam);
        storage.removeItem(WORLD_CUP_STORAGE_KEYS.gamePropsTeam);
        storage.removeItem(WORLD_CUP_STORAGE_KEYS.selectedPlayer);
      } catch {
        /* sessionStorage unavailable */
      }
    }
  }, [competition, hydratedFromStorage]);

  useEffect(() => {
    if (!hydratedFromStorage || propsMode !== 'player' || !selectedTeam) return;
    const storage = worldCupSelectionStorage();
    if (!storage) return;
    try {
      storage.setItem(WORLD_CUP_STORAGE_KEYS.selectedTeam, JSON.stringify(selectedTeam));
    } catch {
      /* sessionStorage unavailable */
    }
  }, [hydratedFromStorage, propsMode, selectedTeam]);

  useEffect(() => {
    if (!hydratedFromStorage || propsMode !== 'team' || !gamePropsTeam) return;
    const storage = worldCupSelectionStorage();
    if (!storage) return;
    try {
      storage.setItem(WORLD_CUP_STORAGE_KEYS.gamePropsTeam, JSON.stringify(gamePropsTeam));
    } catch {
      /* sessionStorage unavailable */
    }
  }, [hydratedFromStorage, propsMode, gamePropsTeam]);

  useEffect(() => {
    if (!hydratedFromStorage || !selectedPlayer) return;
    const storage = worldCupSelectionStorage();
    if (!storage) return;
    try {
      storage.setItem(WORLD_CUP_STORAGE_KEYS.selectedPlayer, JSON.stringify(selectedPlayer));
    } catch {
      /* sessionStorage unavailable */
    }
  }, [hydratedFromStorage, selectedPlayer]);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    const storage = worldCupSelectionStorage();
    if (!storage) return;
    try {
      storage.setItem(WORLD_CUP_STORAGE_KEYS.chartContext, JSON.stringify(chartContext));
    } catch {
      /* sessionStorage unavailable */
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
    loadedDashboardKeyRef.current = null;
    setWorldCupData(null);
    setWorldCupError(null);
    if (propsMode === 'team') {
      setChartContext({
        statId: 'moneyline',
        statKey: 'moneyline',
        statLabel: 'Money Line',
        timeframe: 'last10',
      });
    } else {
      setChartContext((ctx) => ({ ...ctx, timeframe: 'last10' }));
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
      loadedDashboardKeyRef.current = null;
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
    const team =
      resolveWorldCupTeamFromUrl(teamOptions, urlTeamIdQuery, urlTeamQuery) ??
      resolveWorldCupTeamForPlayer(selectedPlayer, teamOptions);
    if (!team || team.id === selectedTeam?.id) return;
    setSelectedTeam(team);
    setTeamSearchQuery('');
  }, [
    propsMode,
    selectedPlayer,
    hasApiTeams,
    teamOptions,
    selectedTeam?.id,
    urlTeamIdQuery,
    urlTeamQuery,
  ]);

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        const redirectPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
        router.replace(`/login?redirect=${encodeURIComponent(redirectPath)}`);
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
  }, [router, pathname, searchParams]);

  useEffect(() => {
    const prevKey = prevDashboardRequestKeyRef.current;
    if (
      prevKey &&
      dashboardRequestKey &&
      prevKey !== dashboardRequestKey &&
      !worldCupDashboardRequestIdentityMatches(prevKey, dashboardRequestKey)
    ) {
      loadedDashboardKeyRef.current = null;
      dashboardFetchInFlightKeyRef.current = null;
      setWorldCupData(null);
      setWorldCupError(null);
    }
    prevDashboardRequestKeyRef.current = dashboardRequestKey;
  }, [dashboardRequestKey]);

  useEffect(() => {
    if (!hydratedFromStorage || !dashboardRequestKey) {
      if (!hasSelection) {
        setWorldCupData(null);
        setWorldCupLoading(false);
        setWorldCupError(null);
      }
      return;
    }
    if (navigatingToPropsRef.current || navigatingToProps) return;

    const params = new URLSearchParams(dashboardRequestKey);
    const activeTeamIdForRequest = params.get('teamId');
    const playerIdForRequest = params.get('playerId');
    const dashboardUrl = `/api/world-cup/dashboard?${dashboardRequestKey}`;

    const expectedLoadedKey = buildWorldCupDashboardKey(
      propsMode,
      activeTeamIdForRequest,
      playerIdForRequest
    );
    if (worldCupData && loadedDashboardKeyRef.current === expectedLoadedKey) {
      const playerPayloadIncomplete =
        propsMode === 'player' &&
        typeof playerIdForRequest === 'string' &&
        /^\d+$/.test(playerIdForRequest) &&
        (worldCupData.playerChartOnly ||
          !hasFullPlayerPropsData(worldCupData, playerIdForRequest, selectedPlayer?.name) ||
          !hasFullPlayerDashboardPanelData(worldCupData));
      if (!playerPayloadIncomplete) {
        setWorldCupLoading(false);
        setWorldCupError(null);
        return;
      }
      loadedDashboardKeyRef.current = null;
    }

    if (
      canReuseWorldCupDashboard(
        worldCupData,
        propsMode,
        activeTeamIdForRequest,
        playerIdForRequest,
        loadedDashboardKeyRef.current
      )
    ) {
      setWorldCupLoading(false);
      setWorldCupError(null);
      return;
    }

    const applyDashboardPayload = (payload: WorldCupDashboardData, markLoaded: boolean) => {
      if (markLoaded) {
        loadedDashboardKeyRef.current = expectedLoadedKey;
        setWorldCupLoading(false);
      } else if (payload.playerMatchStats?.length) {
        setWorldCupLoading(false);
      } else {
        setWorldCupLoading(true);
      }
      setWorldCupError(null);
      setWorldCupData((prev) => {
        const next = normalizeWorldCupDashboardData(payload);
        if (markLoaded || !payload.playerChartOnly) {
          return mergeWorldCupDashboardPayload(prev, payload);
        }
        if (!prev) return next;
        return normalizeWorldCupDashboardData({
          ...prev,
          ...payload,
          playerChartOnly: true,
          playerMatchStats: mergeWorldCupPlayerStatRows(prev.playerMatchStats ?? [], next.playerMatchStats ?? []),
          matches: mergeWorldCupMatchRows(prev.matches ?? [], next.matches ?? []),
          playerMatches: mergeWorldCupMatchRows(prev.playerMatches ?? [], next.playerMatches ?? []),
          teamMatchStats: prev.teamMatchStats,
          rosters: prev.rosters,
          lineups: prev.lineups,
          events: prev.events,
          shots: prev.shots,
          momentum: prev.momentum,
          bestPlayers: prev.bestPlayers,
          avgPositions: prev.avgPositions,
          teamForm: prev.teamForm,
          odds: prev.odds,
          futures: prev.futures,
          wc2026OpponentBreakdown: prev.wc2026OpponentBreakdown,
          playerVsPool: prev.playerVsPool,
          squadPlayerMatchStats: prev.squadPlayerMatchStats,
          teamWcMatchStats: prev.teamWcMatchStats,
          dvpBundles: prev.dvpBundles,
        });
      });
      if (payload.selectedTeam) {
        const team = worldCupTeamOptionFromBdl(payload.selectedTeam);
        if (propsMode === 'player' && team.id !== selectedTeam?.id) {
          setSelectedTeam(team);
          setTeamSearchQuery('');
        } else if (propsMode === 'team' && activeTeamNeedsHydration && team.id !== gamePropsTeam?.id) {
          setGamePropsTeam(team);
          setTeamSearchQuery('');
        }
      }
    };

    const readCachedDashboardPayload = (requestKey: string | null): WorldCupDashboardData | null => {
      if (!requestKey) return null;
      return (
        readPrefetchedWorldCupDashboardMem<WorldCupDashboardData>(requestKey) ??
        consumeWorldCupDashboardPrefetch<WorldCupDashboardData>(requestKey) ??
        readWorldCupDashboardLocalCache<WorldCupDashboardData>(requestKey)
      );
    };

    const fullCached = readCachedDashboardPayload(dashboardRequestKey);
    if (fullCached && !fullCached.playerChartOnly) {
      applyDashboardPayload(fullCached, true);
      return;
    }

    const chartCachedPayload = readCachedDashboardPayload(chartDashboardRequestKey);
    let chartStatsReady = Boolean(
      chartCachedPayload?.playerMatchStats?.length || fullCached?.playerMatchStats?.length
    );

    if (chartCachedPayload?.playerMatchStats?.length) {
      applyDashboardPayload(chartCachedPayload, false);
    } else if (fullCached?.playerMatchStats?.length && fullCached.playerChartOnly) {
      applyDashboardPayload(fullCached, false);
    }

    if (dashboardFetchInFlightKeyRef.current === dashboardRequestKey) return;

    let cancelled = false;
    dashboardFetchInFlightKeyRef.current = dashboardRequestKey;
    if (!chartStatsReady) {
      setWorldCupLoading(true);
    }
    setWorldCupError(null);

    void (async () => {
      let deferFullFetch = false;

      const applyFullDashboardPayload = (payload: WorldCupDashboardData, forRequestKey: string) => {
        if (cancelled) return;
        if (
          dashboardRequestKey &&
          !worldCupDashboardRequestIdentityMatches(forRequestKey, dashboardRequestKey)
        ) {
          return;
        }
        loadedDashboardKeyRef.current = buildWorldCupDashboardKey(
          propsMode,
          activeTeamIdForRequest,
          playerIdForRequest
        );
        setWorldCupData((prev) => mergeWorldCupDashboardPayload(prev, payload));
        setWorldCupLoading(false);
        setWorldCupError(null);
        if (payload.selectedTeam) {
          const team = worldCupTeamOptionFromBdl(payload.selectedTeam);
          if (propsMode === 'player' && team.id !== selectedTeam?.id) {
            setSelectedTeam(team);
            setTeamSearchQuery('');
          } else if (propsMode === 'team' && activeTeamNeedsHydration && team.id !== gamePropsTeam?.id) {
            setGamePropsTeam(team);
            setTeamSearchQuery('');
          }
        }
      };

      try {
        const shouldLoadChartFirst =
          propsMode === 'player' &&
          Boolean(chartDashboardRequestKey) &&
          !chartStatsReady &&
          !fullCached;

        if (shouldLoadChartFirst && chartDashboardRequestKey) {
          const chartUrl = `/api/world-cup/dashboard?${chartDashboardRequestKey}`;
          const chartPayload = await loadWorldCupDashboardWithHandoff<WorldCupDashboardData>(
            chartUrl,
            chartDashboardRequestKey
          );
          if (cancelled) return;
          if (chartPayload?.playerMatchStats?.length) {
            const needsChartApply =
              loadedDashboardKeyRef.current !== expectedLoadedKey ||
              !(worldCupData?.playerMatchStats?.length);
            if (needsChartApply) {
              applyDashboardPayload(chartPayload, false);
            } else {
              setWorldCupLoading(false);
            }
          }
          if (cancelled) return;
          if (
            loadedDashboardKeyRef.current === expectedLoadedKey &&
            playerIdForRequest &&
            hasFullPlayerPropsData(
              chartPayload,
              playerIdForRequest,
              params.get('playerName') || selectedPlayer?.name
            ) &&
            hasFullPlayerDashboardPanelData(chartPayload)
          ) {
            setWorldCupLoading(false);
            return;
          }

          deferFullFetch = true;
          void loadWorldCupDashboardWithHandoff<WorldCupDashboardData>(
            dashboardUrl,
            dashboardRequestKey
          )
            .then((payload) => applyFullDashboardPayload(payload, dashboardRequestKey))
            .catch((error) => {
              if (!cancelled) {
                setWorldCupError(error instanceof Error ? error.message : 'Failed to load World Cup data');
              }
            })
            .finally(() => {
              if (dashboardFetchInFlightKeyRef.current === dashboardRequestKey) {
                dashboardFetchInFlightKeyRef.current = null;
              }
            });
          return;
        }

        const payload = await loadWorldCupDashboardWithHandoff<WorldCupDashboardData>(
          dashboardUrl,
          dashboardRequestKey
        );
        applyFullDashboardPayload(payload, dashboardRequestKey);
      } catch (error) {
        if (!cancelled) {
          setWorldCupError(error instanceof Error ? error.message : 'Failed to load World Cup data');
        }
      } finally {
        if (!deferFullFetch) {
          if (dashboardFetchInFlightKeyRef.current === dashboardRequestKey) {
            dashboardFetchInFlightKeyRef.current = null;
          }
          if (!cancelled) setWorldCupLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // A superseding effect run must not leave the in-flight guard stuck (blank chart forever).
      if (dashboardFetchInFlightKeyRef.current === dashboardRequestKey) {
        dashboardFetchInFlightKeyRef.current = null;
      }
    };
  }, [dashboardRequestKey, chartDashboardRequestKey, hydratedFromStorage, navigatingToProps, hasSelection, propsMode]);

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

  const filteredTeams = useMemo(() => {
    const q = teamSearchQuery.trim().toLowerCase();
    if (!q) return teamOptions;
    return teamOptions.filter((team) =>
      [team.name, team.abbreviation, team.group, team.confederation].some((value) => value.toLowerCase().includes(q))
    );
  }, [teamOptions, teamSearchQuery]);

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
      <LoadingBar isLoading={navigatingToProps} isDark={isDark} showImmediately={navigatingToProps} mobileOffset={0} />
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
                          {propsMode === 'player' && selectedPlayer ? (
                            <button
                              type="button"
                              onClick={navigateBackToPlayerProps}
                              className="flex items-center gap-1.5 mb-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                              </svg>
                              <span>Back to Player Props</span>
                            </button>
                          ) : null}
                          <div className="flex items-baseline gap-3 mb-1">
                            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                              {propsMode === 'team'
                                ? activeTeam?.name || 'Select a Team'
                                : formatWorldCupPlayerDisplayName(selectedPlayer?.name ?? '') || 'Select a Player'}
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
                              {formatWorldCupPropsPositionLabel(selectedPlayer) ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  Position: {formatWorldCupPropsPositionLabel(selectedPlayer)}
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
                          ) : null}
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

                      {/* Right: implied odds wheel when player props lines are available */}
                      <div className="hidden lg:flex flex-1 min-w-0 items-center justify-end">
                        {propsMode === 'player' && dashboardImpliedOdds ? (
                          <div className="flex-shrink-0">
                            <ImpliedOddsWheel
                              isDark={isDark}
                              calculatedImpliedOdds={dashboardImpliedOdds}
                            />
                          </div>
                        ) : wcPlayerOddsLoading && propsMode === 'player' ? (
                          <div className={`h-14 w-14 rounded-full animate-pulse ${skeletonBar}`} />
                        ) : null}
                      </div>
                    </div>

                    {/* Mobile: Row 1 = name + #number; Row 2 = team/role | matchup pill */}
                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      {propsMode === 'player' && dashboardImpliedOdds ? (
                        <div className="absolute top-0 right-0 z-10">
                          <ImpliedOddsWheel
                            isDark={isDark}
                            calculatedImpliedOdds={dashboardImpliedOdds}
                            size={96}
                          />
                        </div>
                      ) : null}
                      <div className={`w-full min-w-0 ${propsMode === 'player' && dashboardImpliedOdds ? 'pr-[5.75rem]' : ''}`}>
                        <div className="flex-shrink-0 min-w-0">
                          <div>
                            {propsMode === 'player' && selectedPlayer ? (
                              <button
                                type="button"
                                onClick={navigateBackToPlayerProps}
                                className="flex items-center gap-1.5 mb-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                              >
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                <span>Back to Player Props</span>
                              </button>
                            ) : null}
                            <div className="flex items-baseline gap-3">
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                                {propsMode === 'team'
                                  ? activeTeam?.name || 'Select a Team'
                                  : formatWorldCupPlayerDisplayName(selectedPlayer?.name ?? '') || 'Select a Player'}
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
                                {formatWorldCupPropsPositionLabel(selectedPlayer) ? (
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {formatWorldCupPropsPositionLabel(selectedPlayer)}
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
                            ) : null}
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

                    {propsMode === 'team' ? (
                      <div className="w-full min-w-0 border-t border-gray-200 dark:border-gray-700/80 pt-2 mt-1.5 lg:mt-2 lg:pt-2">
                        <div className={WORLD_CUP_SEARCH_SHELL_CLASS}>
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
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={`chart-container-no-focus relative z-10 rounded-lg p-0 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${DASH_CARD_GLOW} sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0`}>
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <div className="min-h-0 flex-1 overflow-hidden px-1 py-1 sm:px-2 sm:py-2">
                      {showSkeleton ? (
                        <WorldCupCardSkeleton isDark={isDark} fill />
                      ) : (
                        <WorldCupGameByGameChart
                          key={propsMode}
                          isDark={isDark}
                          mode={propsMode}
                          data={worldCupData}
                          selectedTeam={chartContextTeam}
                          selectedPlayer={selectedPlayer}
                          opponentTeam={opponentTeam}
                          loading={chartAreaLoading}
                          error={worldCupError}
                          competition={competition}
                          chartContext={chartContext}
                          onChartContextChange={handleChartContextChange}
                          playerOddsBooks={wcPlayerOddsBooks}
                          playerOddsLoading={wcPlayerOddsLoading}
                          oddsFormat={oddsFormat}
                          selectedBookIndex={selectedWcBookIndex}
                          onSelectBookIndex={setSelectedWcBookIndex}
                          externalLineValue={wcExternalLineValue}
                          currentLineValue={wcCurrentLineValue}
                          onExternalLineChange={setWcCurrentLineValue}
                          onSelectOddsLine={handleSelectWcOddsLine}
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
                      data={supportingStatsData}
                      mode={propsMode}
                      selectedPlayerRole={selectedPlayer?.role}
                      selectedPlayerId={selectedPlayerId}
                      selectedTeamId={resolvedActiveTeamId}
                      selectedTeamName={chartContextTeam?.name ?? selectedPlayer?.teamName ?? urlTeamQuery ?? null}
                      opponentTeam={opponentTeam}
                      chartContext={chartContext}
                      isDark={isDark}
                      competition={competition}
                    />
                  )}
                    </>
                  )}
                </div>

                {isLgDesktop ? (
                <div className={`w-full min-w-0 flex flex-col rounded-lg ${DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={5} className="px-3 sm:px-4 py-1" />
                  ) : (
                    <>
                  <SectionHeader
                    title={worldCupLineupsTitle({
                      lineupMeta: worldCupData?.lineupMeta,
                      opponentTeam,
                      teamOptions,
                      teams: worldCupData?.teams,
                    })}
                  />
                  <WorldCupLineupsPanel
                    isDark={isDark}
                    selectedTeam={chartContextTeam}
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
                ) : null}

                {!isLgDesktop ? (
                <>
                <div className={`w-full min-w-0 flex flex-col rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4 md:p-4 max-h-[60vh] min-h-0 overflow-hidden`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={4} />
                  ) : (
                  <div className="min-h-0 flex-1 overflow-hidden">
                  <WorldCupInsightsPanel
                    key={`${propsMode}-insights`}
                    isDark={isDark}
                    mode={propsMode}
                    selectedPlayer={selectedPlayer}
                    selectedTeam={chartContextTeam}
                    opponentTeam={opponentTeam}
                    teamOptions={teamOptions}
                    competition={competition}
                    dvpBundles={worldCupData?.dvpBundles}
                    wc2026OpponentBreakdown={worldCupData?.wc2026OpponentBreakdown}
                  />
                  </div>
                  )}
                </div>

                {propsMode === 'player' ? (
                  <div className={`w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4 pb-6`}>
                    {showInsightsSkeleton ? (
                      <WorldCupCardSkeleton isDark={isDark} rows={5} className="p-3" />
                    ) : (
                      <WorldCupPlayerComparisonPanel
                        isDark={isDark}
                        selectedPlayer={selectedPlayer}
                        selectedPlayerId={selectedPlayerId}
                        selectedTeam={chartContextTeam}
                        opponentTeam={opponentTeam}
                        playerMatchStats={worldCupData?.playerMatchStats ?? []}
                        matches={worldCupData?.matches ?? []}
                        playerMatches={worldCupData?.playerMatches ?? []}
                        rosters={worldCupData?.rosters ?? []}
                        playerVsPool={worldCupData?.playerVsPool}
                        squadPlayerMatchStats={worldCupData?.squadPlayerMatchStats}
                        wc2026OpponentBreakdown={worldCupData?.wc2026OpponentBreakdown}
                        deferPanelFallbacks={deferPanelFallbacks}
                      />
                    )}
                  </div>
                ) : null}

                {propsMode === 'player' ? (
                  <div className={`w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} p-2 sm:p-2.5`}>
                    {showInsightsSkeleton ? (
                      <WorldCupCardSkeleton isDark={isDark} rows={4} className="p-3" />
                    ) : (
                      <WorldCupPlayerTeamSharePanel
                        isDark={isDark}
                        selectedPlayer={selectedPlayer}
                        selectedPlayerId={selectedPlayerId}
                        selectedTeam={chartContextTeam}
                        playerMatchStats={worldCupData?.playerMatchStats ?? []}
                        teamMatchStats={worldCupData?.teamMatchStats ?? []}
                        teamWcMatchStats={worldCupData?.teamWcMatchStats}
                        squadPlayerMatchStats={worldCupData?.squadPlayerMatchStats}
                        matches={worldCupData?.matches ?? []}
                        playerMatches={worldCupData?.playerMatches ?? []}
                        deferSquadFallback={deferPanelFallbacks}
                      />
                    )}
                  </div>
                ) : null}

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={5} className="px-3 sm:px-4 py-1" />
                  ) : (
                    <>
                  <SectionHeader
                    title={worldCupLineupsTitle({
                      lineupMeta: worldCupData?.lineupMeta,
                      opponentTeam,
                      teamOptions,
                      teams: worldCupData?.teams,
                    })}
                  />
                  <WorldCupLineupsPanel
                    isDark={isDark}
                    selectedTeam={chartContextTeam}
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

                <div className={`w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={4} />
                  ) : (
                    <>
                      <SectionHeader title="Group standings" subtitle="Groups, points, goal difference, and qualification position." />
                      <WorldCupGroupStandingsPanel
                        isDark={isDark}
                        standings={worldCupData?.standings ?? []}
                        selectedTeam={chartContextTeam}
                        opponentTeam={opponentTeam}
                      />
                    </>
                  )}
                </div>

                <div className={`w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={3} />
                  ) : (
                    <>
                      <SectionHeader title="Availability" subtitle="Tournament squads for both teams in the matchup." />
                      <WorldCupRosterPanel
                        isDark={isDark}
                        selectedTeam={chartContextTeam}
                        opponentTeam={opponentTeam}
                        rosters={worldCupData?.rosters ?? []}
                      />
                    </>
                  )}
                </div>

                <div className={`w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={3} />
                  ) : (
                    <>
                      <SectionHeader title="World Cup schedule" subtitle="Next 72 hours — teams, group, day, and kickoff time." />
                      <WorldCupSchedulePanel
                        isDark={isDark}
                        matches={worldCupData?.matches ?? []}
                        maxHeightClass="max-h-[360px]"
                      />
                    </>
                  )}
                </div>
                </>
                ) : null}
              </div>

              {isLgDesktop ? (
              <div
                className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 fade-scrollbar custom-scrollbar min-w-0 ${
                  sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
                }`}
              >
                <div className={`w-full min-w-0 rounded-lg ${DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  {filterControls}
                </div>

                <div className={`h-[480px] w-full min-w-0 shrink-0 rounded-lg xl:h-[520px] ${DASH_CARD_GLOW} overflow-hidden`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} fill className="p-3 sm:p-4" />
                  ) : (
                  <WorldCupInsightsPanel
                    key={`${propsMode}-insights-desktop`}
                    isDark={isDark}
                    mode={propsMode}
                    selectedPlayer={selectedPlayer}
                    selectedTeam={chartContextTeam}
                    opponentTeam={opponentTeam}
                    teamOptions={teamOptions}
                    competition={competition}
                    dvpBundles={worldCupData?.dvpBundles}
                    wc2026OpponentBreakdown={worldCupData?.wc2026OpponentBreakdown}
                  />
                  )}
                </div>

                <div className={`w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={5} className="p-1" />
                  ) : propsMode === 'player' ? (
                    <WorldCupPlayerComparisonPanel
                      isDark={isDark}
                      selectedPlayer={selectedPlayer}
                      selectedPlayerId={selectedPlayerId}
                      selectedTeam={chartContextTeam}
                      opponentTeam={opponentTeam}
                      playerMatchStats={worldCupData?.playerMatchStats ?? []}
                      matches={worldCupData?.matches ?? []}
                      playerMatches={worldCupData?.playerMatches ?? []}
                      rosters={worldCupData?.rosters ?? []}
                      playerVsPool={worldCupData?.playerVsPool}
                      squadPlayerMatchStats={worldCupData?.squadPlayerMatchStats}
                      wc2026OpponentBreakdown={worldCupData?.wc2026OpponentBreakdown}
                      deferPanelFallbacks={deferPanelFallbacks}
                    />
                  ) : (
                    <WorldCupTeamFormHomeAwayPanel
                      isDark={isDark}
                      selectedTeam={chartContextTeam}
                      opponentTeam={opponentTeam}
                      competition={competition}
                      dashboardData={worldCupData}
                    />
                  )}
                </div>

                {propsMode === 'player' ? (
                  <div className={`w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-2 sm:p-2.5`}>
                    {showInsightsSkeleton ? (
                      <WorldCupCardSkeleton isDark={isDark} rows={4} className="p-1" />
                    ) : (
                      <WorldCupPlayerTeamSharePanel
                        isDark={isDark}
                        selectedPlayer={selectedPlayer}
                        selectedPlayerId={selectedPlayerId}
                        selectedTeam={chartContextTeam}
                        playerMatchStats={worldCupData?.playerMatchStats ?? []}
                        teamMatchStats={worldCupData?.teamMatchStats ?? []}
                        teamWcMatchStats={worldCupData?.teamWcMatchStats}
                        squadPlayerMatchStats={worldCupData?.squadPlayerMatchStats}
                        matches={worldCupData?.matches ?? []}
                        playerMatches={worldCupData?.playerMatches ?? []}
                        deferSquadFallback={deferPanelFallbacks}
                      />
                    )}
                  </div>
                ) : null}

                <div className={`w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
                  {showInsightsSkeleton ? (
                    <WorldCupCardSkeleton isDark={isDark} rows={3} />
                  ) : (
                    <>
                      <SectionHeader title="Availability" subtitle="Tournament squads for both teams in the matchup." />
                      <WorldCupRosterPanel
                        isDark={isDark}
                        selectedTeam={chartContextTeam}
                        opponentTeam={opponentTeam}
                        rosters={worldCupData?.rosters ?? []}
                      />
                    </>
                  )}
                </div>

                <div className={`w-full min-w-0 shrink-0 rounded-lg ${DASH_CARD_GLOW} overflow-hidden p-3 sm:p-4`}>
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
              ) : null}
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
