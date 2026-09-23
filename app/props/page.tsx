'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { MobileBottomNavigation } from "@/app/nba/research/dashboard/components/header";
import { useTheme } from "@/contexts/ThemeContext";
import { useRouter } from 'next/navigation';
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, type CSSProperties } from 'react';
import { createPortal, preload as reactPreload } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import { useViewerProfile } from '@/hooks/useViewerProfile';
import {
  bindPropsPageSnapshotGetter,
  clearPropsPageWarmSnapshot,
  clearPropsReturnSport,
  consumePropsReturnSport,
  snapshotPropsPageBeforeLeave,
  takePropsBackNavWarmSnapshot,
} from '@/lib/propsPageSessionCache';
import {
  abortAflPropsStatsBackfill,
  isOnPropsPage,
  startAflPropsStatsBackfill,
} from '@/lib/aflPropsStatsBackfillControl';
import { abortAflDashboardFetches } from '@/lib/aflDashboardFetch';
import {
  kickCombinedPropsEarlyFetch,
  peekCombinedPropsEarlyPayload,
  takeCombinedPropsEarlyPayload,
} from '@/lib/propsCombinedEarlyFetch';
import { slimCombinedPropsSnapshotForClient } from '@/lib/combinedPropsSnapshotPaint';
import {
  type CombinedPropsSnapshot,
  AFL_USER_NO_ODDS,
  applyLiveAflPropsCutoff,
  isAflCommenceTimePropsEligible,
  filterAflPropsEligibleGames,
} from '@/lib/combinedPropsSnapshotTypes';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { resolveNblClubName } from '@/lib/nblTeamCanonical';
import { getFullTeamName, TEAM_FULL_TO_ABBR } from '@/lib/teamMapping';
import { getPlayerHeadshotUrl } from '@/lib/nbaLogos';
import { getAflPlayerHeadshotUrl } from '@/lib/aflPlayerHeadshots';
import { formatAflFantasyDfsPositionLabel } from '@/lib/aflDfsRoleLabels';
import { formatNblPropsPositionLabel } from '@/lib/nbl/playTypesShared';
import { AflPropsPlayerAvatar } from '@/components/AflPropsPlayerAvatar';
import { getEspnLogoUrl } from '@/lib/nbaAbbr';
import { PLAYER_ID_MAPPINGS, convertBdlToNbaId } from '@/lib/playerIdMapping';
import { currentNbaSeason, TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from '@/lib/nbaConstants';
import { getBookmakerInfo } from '@/lib/bookmakers';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import { parseBallDontLieTipoff } from '@/app/nba/research/dashboard/utils';
import { americanToDecimal, DEFAULT_ODDS_FORMAT, formatOdds, readOddsFormatPreference } from '@/lib/currencyUtils';
import { cachedFetch } from '@/lib/requestCache';
import { prefetchAflDashboardFromProps } from '@/lib/aflPropsNavigationPrefetch';
import { prefetchNblDashboardFromProps } from '@/lib/nblPropsNavigationPrefetch';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import { StatTrackrLogo } from '@/components/StatTrackrLogo';
import {
  defaultPropsSport,
  isSecondaryPropsSport,
  isNblPropsSport,
  isTennisPropsSport,
  isTennisSportParam,
  tennisTourFromPropsSport,
  propsSportFromTennisTour,
  secondaryListSportForMode,
  NBA_PUBLIC_ENABLED,
  NBL_PUBLIC_ENABLED,
  TENNIS_PUBLIC_ENABLED,
  propsPathForSport,
  resolvePropsSportParam,
  NBL_LOGO_PATH,
  TENNIS_LOGO_PATH,
  WTA_LOGO_PATH,
  TENNIS_LOGO_TOGGLE_CLASS,
  TENNIS_LOGO_MARK_CLASS,
  TENNIS_LOGO_MARK_COMPACT_CLASS,
  tennisLogoForTour,
  type PropsSportMode,
  type SecondaryPropsSport,
} from '@/lib/nbaConstants';
import { prefetchTennisDashboardFromProps } from '@/lib/tennisPropsNavigationPrefetch';
import {
  eventTargetIsInteractive,
  isUnmodifiedLeftClick,
  propsDashboardHref,
  tennisDashboardHref,
  nblDashboardHref,
} from '@/lib/propsDashboardLinks';
import { tennisFlagUrl } from '@/lib/tennis/flags';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import { tennisEventPlaceLabel, tennisTourLabel } from '@/lib/tennis/chartStats';
import { collapseTennisRowsToPrimaryMarketLine } from '@/lib/tennis/propsMarketCollapse';
import {
  aggregateTennisPropsForPaint,
  bookmakerLinesFromTennisRow,
} from '@/lib/tennis/aggregatePropsForPaint';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';

interface Game {
  id: number;
  date: string;
  status: string;
  home_team: { id: number; abbreviation: string };
  visitor_team: { id: number; abbreviation: string };
  home_team_score?: number;
  visitor_team_score?: number;
  /** ISO datetime for tipoff countdown (e.g. AFL from cache) */
  datetime?: string;
}

interface PlayerProp {
  playerName: string;
  playerId: string;
  team: string;
  opponent: string;
  statType: string;
  line: number;
  overProb: number;
  underProb: number;
  overOdds: string;
  underOdds: string;
  impliedOverProb: number;
  impliedUnderProb: number;
  bestLine: number;
  bookmaker: string;
  confidence: 'High' | 'Medium' | 'Low';
  expectedValue?: number;
  gameDate: string;
  // New fields for table columns
  last5Avg?: number | null;
  last10Avg?: number | null;
  h2hAvg?: number | null;
  last5HitRate?: { hits: number; total: number } | null;
  last10HitRate?: { hits: number; total: number } | null;
  h2hHitRate?: { hits: number; total: number } | null;
  seasonAvg?: number | null;
  seasonHitRate?: { hits: number; total: number } | null;
  streak?: number | null;
  position?: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null; // Player position (used for DvP calculation)
  dvpRating?: number | null;
  dvpStatValue?: number | null;
  dvpFieldSize?: number | null;
  headshotUrl?: string | null;
  bookmakerLines?: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }>;
  // AFL: link to game for filtering; game matchup for display
  gameId?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  /** AFL Fantasy bucket (DEF/MID/FWD/RUC) for list display; from /api/afl/player-props/list. */
  aflFantasyPosition?: 'DEF' | 'MID' | 'FWD' | 'RUC' | null;
  /** DFS role short label (e.g. INS MID); optional when not in DFS map. */
  aflDfsRole?: string | null;
  nblPosition?: string | null;
  nblPlayType?: string | null;
  /** Player's actual club when home/away on the odds row may be swapped. */
  playerTeam?: string | null;
  playerIoc?: string | null;
  playerRank?: number | null;
  opponentIoc?: string | null;
  opponentId?: string | null;
  opponentRank?: number | null;
  playerSeed?: number | null;
  opponentSeed?: number | null;
  playerDrawRank?: number | null;
  opponentDrawRank?: number | null;
  tournamentName?: string | null;
  surface?: string | null;
}


function secondarySportKickoffLabel(sport: PropsSportMode): string {
  if (sport === 'afl') return 'Bounce';
  if (isTennisPropsSport(sport)) return 'Start';
  return 'Tipoff';
}

function rowSportKickoffLabel(rowSport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta'): string {
  if (rowSport === 'afl') return 'Bounce';
  if (isTennisPropsSport(rowSport)) return 'Start';
  return 'Tipoff';
}

function kickoffMaxAheadMs(rowSport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta'): number {
  return isTennisPropsSport(rowSport) ? 21 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
}

function sportSelectorClass(active: boolean, shellDark: boolean): string {
  const base =
    'flex-1 sm:flex-none px-4 py-2.5 lg:min-w-[180px] lg:px-8 lg:py-3 rounded-xl lg:rounded-lg text-sm font-semibold border transition-all duration-200 flex items-center justify-center';
  if (active) {
    return shellDark
      ? `${base} text-white border-transparent scale-[1.04] z-[1]`
      : `${base} bg-purple-100 text-purple-800 border-purple-400 ring-2 ring-purple-300`;
  }
  return shellDark
    ? `${base} bg-[#152238] text-gray-300 border-white/15 opacity-90 hover:opacity-100 hover:border-white/25 hover:bg-[#1a2c44]`
    : `${base} bg-white text-gray-600 border-gray-300 hover:bg-gray-50`;
}

function sportSelectorLogoClass(
  sport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta',
  extraClass = 'w-10 h-10 lg:w-12 lg:h-12 object-contain'
): string {
  if (sport === 'atp') return extraClass;
  const brighten =
    sport === 'wta'
      ? 'brightness-150 saturate-150'
      : 'brightness-110';
  return `${extraClass} ${brighten}`;
}

function sportSelectorGlow(
  sport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta',
  active: boolean
): CSSProperties | undefined {
  if (!active) return undefined;
  const palette =
    sport === 'afl'
      ? { ring: '#fb923c', glow: 'rgba(249,115,22,0.95)', fill: '#431407' }
      : sport === 'nbl'
        ? { ring: '#fbbf24', glow: 'rgba(245,158,11,0.95)', fill: '#451a03' }
      : sport === 'wta'
        ? { ring: '#e9d5ff', glow: 'rgba(232,121,249,1)', fill: '#3b0764' }
        : sport === 'atp'
          ? { ring: '#7dd3fc', glow: 'rgba(56,189,248,1)', fill: '#082f49' }
            : { ring: '#c4b5fd', glow: 'rgba(167,139,250,1)', fill: '#2e1065' };
  return {
    backgroundColor: palette.fill,
    borderColor: palette.ring,
    boxShadow: `0 0 0 2px ${palette.ring}, 0 0 22px ${palette.glow}, 0 0 52px ${palette.glow}`,
  };
}

function formatPropsRowStatLine(
  statType: string,
  line: number,
  label: string,
  opts?: { milestone?: boolean }
): string {
  if (statType === 'moneyline') return label;
  if (statType === 'spread') {
    if (!Number.isFinite(line)) return label;
    const signed = line > 0 ? `+${line}` : String(line);
    return `${label} ${signed}`;
  }
  if (opts?.milestone && Number.isFinite(line)) {
    const threshold = Number.isInteger(line) ? line : Math.round(line + 0.5);
    return `${label} ${threshold}+`;
  }
  return `${label} ${line > 0 ? 'Over' : 'Under'} ${Math.abs(line)}`;
}

type TennisPropsMarketKey = 'moneyline' | 'spread' | 'totalGames' | 'gamesWon' | 'gamesLost' | 'totalSets';

const TENNIS_PROPS_MARKET_TONE: Record<
  TennisPropsMarketKey,
  { dark: string; light: string }
> = {
  moneyline: {
    dark: 'text-yellow-300',
    light: 'text-yellow-700',
  },
  spread: {
    dark: 'text-purple-300',
    light: 'text-purple-700',
  },
  totalGames: {
    dark: 'text-emerald-300',
    light: 'text-emerald-800',
  },
  gamesWon: {
    dark: 'text-blue-300',
    light: 'text-blue-800',
  },
  gamesLost: {
    dark: 'text-red-400',
    light: 'text-red-700',
  },
  totalSets: {
    dark: 'text-pink-300',
    light: 'text-pink-700',
  },
};

function tennisPropsMarketKey(statType: string): TennisPropsMarketKey | null {
  const value = String(statType || '').trim();
  if (
    value === 'moneyline' ||
    value === 'spread' ||
    value === 'totalGames' ||
    value === 'gamesWon' ||
    value === 'gamesLost' ||
    value === 'totalSets'
  ) {
    return value;
  }
  const n = value.toLowerCase().replace(/[\s_]+/g, '');
  if (n === 'moneyline') return 'moneyline';
  if (n === 'spread') return 'spread';
  if (n === 'totalgames') return 'totalGames';
  if (n === 'gameswon') return 'gamesWon';
  if (n === 'gameslost' || n === 'oppgameswon') return 'gamesLost';
  if (n === 'totalsets') return 'totalSets';
  return null;
}

function propsRowStatLineClassName(
  statType: string,
  opts: { colorTennisMarkets: boolean; isDark: boolean; mobile?: boolean }
): string {
  const base = opts.mobile
    ? 'text-sm font-semibold mt-1 truncate'
    : 'text-sm font-medium mt-0.5 truncate';
  if (opts.colorTennisMarkets) {
    const key = tennisPropsMarketKey(statType);
    if (key) {
      const tone = TENNIS_PROPS_MARKET_TONE[key];
      return `${base} ${opts.isDark ? tone.dark : tone.light}`;
    }
  }
  return `${base} ${opts.isDark ? 'text-purple-400' : 'text-purple-600'}`;
}

function dvpColorBands(
  rowSport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta',
  fieldSize?: number | null
): { easyMin: number; hardMax: number } {
  if (rowSport === 'afl') return { easyMin: 13, hardMax: 6 };
  if (rowSport === 'nbl' || isTennisPropsSport(rowSport)) {
    const n = Math.max(Number(fieldSize) || (rowSport === 'nbl' ? 10 : 0), 1);
    return {
      easyMin: Math.max(2, Math.ceil((n * 2) / 3)),
      hardMax: Math.max(1, Math.floor(n / 3)),
    };
  }
  return { easyMin: 21, hardMax: 10 };
}

function dvpRankText(
  _rowSport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta',
  rank: number,
  _fieldSize?: number | null
): string {
  return `#${rank}`;
}

function propsListRowKey(
  prop: PlayerProp,
  rowSport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta'
): string {
  return `${rowSport}|${prop.playerName}|${prop.statType}|${prop.line}|${prop.gameId ?? ''}|${prop.opponent ?? ''}`;
}

const PROPS_DESKTOP_STAT_COL_STYLE = {
  width: '88px',
  minWidth: '88px',
  maxWidth: '88px',
} as const;

const PROPS_DESKTOP_ODDS_COL_STYLE = {
  width: '300px',
  minWidth: '300px',
  maxWidth: '300px',
} as const;

const PROPS_DESKTOP_IP_COL_STYLE = {
  width: '120px',
  minWidth: '120px',
  maxWidth: '120px',
} as const;

function navigateToTennisDashboardFromProp(
  prop: Pick<
    PlayerProp,
    'playerName' | 'playerId' | 'team' | 'opponent' | 'opponentIoc' | 'opponentId' | 'statType' | 'line' | 'bookmaker'
  >,
  router: { push: (href: string) => void },
  lineValue?: number
): void {
  const href = tennisDashboardHref({
    playerName: prop.playerName,
    playerId: prop.playerId,
    team: prop.team,
    opponent: prop.opponent,
    opponentIoc: prop.opponentIoc,
    opponentId: prop.opponentId,
    statType: prop.statType,
    line:
      typeof lineValue === 'number' && Number.isFinite(lineValue)
        ? lineValue
        : Number.isFinite(prop.line)
          ? prop.line
          : null,
    bookmaker: prop.bookmaker,
  });
  prefetchTennisDashboardFromProps({
    playerName: prop.playerName,
    playerId: prop.playerId,
    tour: String(prop.team || '').trim(),
    opponent: prop.opponent,
  });
  abortAflDashboardFetches();
  snapshotPropsPageBeforeLeave();
  router.push(href);
}

function tennisPropsHeadshotUrl(
  prop: Pick<PlayerProp, 'headshotUrl' | 'playerId'>
): string | null {
  return clientTennisHeadshotUrl(prop.playerId, prop.headshotUrl);
}

function normalizeAflStatForDashboard(stat: string): string {
  const value = String(stat || '').trim().toLowerCase();
  if (!value) return 'disposals';
  if (value === 'disposals' || value === 'disposals_over') return 'disposals';
  if (value === 'goals_over' || value === 'anytime_goal_scorer') return 'goals';
  if (value === 'marks') return 'marks';
  if (value === 'tackles') return 'tackles';
  if (value === 'kicks') return 'kicks';
  if (value === 'handballs') return 'handballs';
  if (value === 'tog') return 'tog';
  if (value === 'inside_50s') return 'inside_50s';
  if (value === 'uncontested' || value === 'uncontested_possessions') return 'uncontested_possessions';
  if (value === 'meters_gained') return 'meters_gained';
  if (value === 'free_kicks_against') return 'free_kicks_against';
  return 'disposals';
}

function medianValue(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function getConsensusImpliedProbabilities(
  prop: PlayerProp,
  linesOverride?: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }>
): { overProb: number | null; underProb: number | null } {
  const sourceLines = Array.isArray(linesOverride) && linesOverride.length > 0
    ? linesOverride
    : (Array.isArray(prop.bookmakerLines) ? prop.bookmakerLines : []);

  const overValues: number[] = [];
  const underValues: number[] = [];
  for (const line of sourceLines) {
    const implied = calculateImpliedProbabilities(line.overOdds, line.underOdds);
    if (implied) {
      overValues.push(implied.overImpliedProb);
      underValues.push(implied.underImpliedProb);
      continue;
    }
    const overAmerican = parseAmericanOdds(line.overOdds);
    const underAmerican = parseAmericanOdds(line.underOdds);
    if (overAmerican !== null && underAmerican !== null) {
      overValues.push(americanToImpliedProb(overAmerican));
      underValues.push(americanToImpliedProb(underAmerican));
    }
  }

  const medianOver = medianValue(overValues);
  const medianUnder = medianValue(underValues);
  if (medianOver !== null && medianUnder !== null) {
    return { overProb: medianOver, underProb: medianUnder };
  }

  // Fallback to row-level odds fields when no bookmaker lines are usable.
  const implied = calculateImpliedProbabilities(prop.overOdds, prop.underOdds);
  const overAmerican = parseAmericanOdds(prop.overOdds);
  const underAmerican = parseAmericanOdds(prop.underOdds);
  let overProb: number | null = implied ? implied.overImpliedProb : (overAmerican !== null ? americanToImpliedProb(overAmerican) : null);
  let underProb: number | null = implied ? implied.underImpliedProb : (underAmerican !== null ? americanToImpliedProb(underAmerican) : null);
  if (overProb === null && underProb === null) {
    overProb = prop.impliedOverProb ?? null;
    underProb = prop.impliedUnderProb ?? null;
  }
  return { overProb, underProb };
}

/** AFL game from list API (for props page games filter). */
interface AflGameForProps {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  tournamentName?: string | null;
  surface?: string | null;
}

type CombinedSportSource = 'nba' | 'afl' | 'nbl' | 'atp' | 'wta';
type CombinedPlayerPropRow = PlayerProp & { sportSource?: CombinedSportSource };

function combinedPlayerCollapseKey(prop: CombinedPlayerPropRow): string {
  const sport = prop.sportSource || 'nba';
  const id = String(prop.playerId || '').trim();
  if (id) return `${sport}|id:${id}`;
  return `${sport}|name:${String(prop.playerName || '').trim().toLowerCase()}`;
}

function combinedMarketPriority(prop: CombinedPlayerPropRow): number {
  const sport = prop.sportSource;
  const tennisKey = tennisPropsMarketKey(prop.statType);
  if (sport === 'atp' || sport === 'wta' || tennisKey) {
    const order: Record<TennisPropsMarketKey, number> = {
      totalGames: 0,
      gamesWon: 1,
      totalSets: 2,
      spread: 3,
      gamesLost: 4,
      moneyline: 5,
    };
    return tennisKey ? order[tennisKey] : 9;
  }
  const stat = normalizeSecondaryPropStatType(prop.statType);
  if (sport === 'nbl') {
    if (stat === 'points') return 0;
    if (stat === 'rebounds') return 1;
    if (stat === 'assists') return 2;
    if (stat === 'threeMade') return 3;
    return 4;
  }
  if (sport === 'afl') {
    if (stat === 'disposals' || stat === 'disposals_over') return 0;
    if (stat === 'goals_over') return 1;
    if (stat === 'marks') return 2;
    if (stat === 'tackles') return 3;
    if (stat === 'kicks') return 4;
    if (stat === 'handballs') return 5;
    if (stat === 'fantasy_points') return 6;
    if (stat === 'anytime_goal_scorer') return 7;
    return 8;
  }
  const nba = String(prop.statType || '').toUpperCase();
  if (nba === 'PTS') return 0;
  if (nba === 'PRA') return 1;
  if (nba === 'REB') return 2;
  if (nba === 'AST') return 3;
  if (nba === 'THREES' || nba === 'FG3M') return 4;
  if (nba === 'PR') return 5;
  if (nba === 'PA') return 6;
  if (nba === 'RA') return 7;
  return 8;
}

function combinedRowQualityScore(prop: CombinedPlayerPropRow): number {
  const hitPct = (hr?: { hits: number; total: number } | null) =>
    hr && hr.total > 0 ? (hr.hits / hr.total) * 100 : -1;
  const books =
    (Array.isArray(prop.bookmakerLines) ? prop.bookmakerLines.length : 0) ||
    (String(prop.bookmaker || '').trim() ? 1 : 0);
  return books * 1000 + hitPct(prop.last10HitRate) * 10 + hitPct(prop.last5HitRate);
}

function preferCombinedRow(current: CombinedPlayerPropRow, next: CombinedPlayerPropRow): CombinedPlayerPropRow {
  const prio = combinedMarketPriority(next) - combinedMarketPriority(current);
  if (prio < 0) return next;
  if (prio > 0) return current;
  return combinedRowQualityScore(next) > combinedRowQualityScore(current) ? next : current;
}

/** Combined tab: one market per player. Sport pages keep every market. */
function collapseCombinedPropsToOnePerPlayer(rows: CombinedPlayerPropRow[]): CombinedPlayerPropRow[] {
  const winner = new Map<string, CombinedPlayerPropRow>();
  for (const row of rows) {
    const key = combinedPlayerCollapseKey(row);
    const existing = winner.get(key);
    winner.set(key, existing ? preferCombinedRow(existing, row) : row);
  }
  const seen = new Set<string>();
  const out: CombinedPlayerPropRow[] = [];
  for (const row of rows) {
    const key = combinedPlayerCollapseKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const chosen = winner.get(key);
    if (chosen) out.push(chosen);
  }
  return out;
}

type CombinedPropsSnapshotResponse = {
  success: boolean;
  error?: string;
  snapshotVersion?: number;
  generatedAt?: string;
  staleAt?: string;
  cachedSnapshot?: boolean;
  backgroundRefreshStarted?: boolean;
  nba: {
    ok: boolean;
    status: number;
    cached?: boolean;
    lastUpdated?: string | null;
    gameDate?: string | null;
    props?: PlayerProp[];
  };
  afl: {
    ok: boolean;
    status: number;
    lastUpdated?: string | null;
    nextUpdate?: string | null;
    ingestMessage?: string | null;
    noAflOdds?: boolean;
    games?: AflGameForProps[];
    props?: PlayerProp[];
    debugMeta?: Record<string, unknown> | null;
  };
  tennis?: {
    ok: boolean;
    status: number;
    lastUpdated?: string | null;
    nextUpdate?: string | null;
    ingestMessage?: string | null;
    noTennisOdds?: boolean;
    games?: AflGameForProps[];
    props?: PlayerProp[];
  };
  nbl?: {
    ok: boolean;
    status: number;
    lastUpdated?: string | null;
    nextUpdate?: string | null;
    ingestMessage?: string | null;
    noNblOdds?: boolean;
    games?: AflGameForProps[];
    props?: PlayerProp[];
  };
  paintSnapshot?: boolean;
};

const TENNIS_RANK_FILTER_OPTIONS: Array<{ label: string; maxRank: number | null }> = [
  { label: 'All ranks', maxRank: null },
  { label: 'Top 50', maxRank: 50 },
  { label: 'Top 100', maxRank: 100 },
  { label: 'Top 200', maxRank: 200 },
  { label: 'Top 300', maxRank: 300 },
];
const TENNIS_MAX_RANK_STORAGE_KEY = 'tennis_filters_max_rank';

function readTennisMaxRankFilter(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TENNIS_MAX_RANK_STORAGE_KEY);
    if (raw == null || raw === 'all' || raw === '') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeTennisMaxRankFilter(maxRank: number | null) {
  try {
    window.localStorage.setItem(TENNIS_MAX_RANK_STORAGE_KEY, maxRank == null ? 'all' : String(maxRank));
  } catch {
    /* ignore quota */
  }
}

function tennisPlayerPassesRankFilter(
  rank: number | null | undefined,
  maxRank: number | null
): boolean {
  if (maxRank == null) return true;
  const n = typeof rank === 'number' && Number.isFinite(rank) ? rank : null;
  if (n == null || n <= 0) return false;
  return n <= maxRank;
}

function tennisRankFilterButtonLabel(maxRank: number | null): string {
  return maxRank == null ? 'Rank' : `Top ${maxRank}`;
}

function TennisRankFilterOptions({
  maxRank,
  isDark,
  mounted,
  onSelect,
}: {
  maxRank: number | null;
  isDark: boolean;
  mounted: boolean;
  onSelect: (next: number | null) => void;
}) {
  return (
    <div className="p-2 space-y-1">
      {TENNIS_RANK_FILTER_OPTIONS.map((opt) => {
        const selected = opt.maxRank === maxRank;
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => onSelect(opt.maxRank)}
            className={`flex w-full items-center px-3 py-2 rounded text-left text-sm font-medium transition-all ${
              selected
                ? mounted && isDark
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-100 text-purple-900'
                : mounted && isDark
                  ? 'hover:bg-gray-700 text-gray-300'
                  : 'hover:bg-gray-50 text-gray-700'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function propsFilterButtonClass(open: boolean, isDark: boolean): string {
  const base = 'relative flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border w-full transition-colors';
  if (open) {
    return `${base} ${isDark ? 'bg-[#0d1728] border-white/20 text-slate-100' : 'bg-gray-50 border-gray-400 text-gray-800'}`;
  }
  return `${base} ${
    isDark
      ? 'bg-[#0d1728] border-white/10 text-slate-300 hover:border-white/20 hover:bg-[#111e32]'
      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
  }`;
}

// Tipoff Countdown Component
function TipoffCountdown({
  game,
  isDark,
  label = 'Tipoff',
  maxAheadMs,
}: {
  game: Game | null;
  isDark: boolean;
  label?: string;
  maxAheadMs?: number;
}) {
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  const [isBeyond24h, setIsBeyond24h] = useState(false);
  const liveWindowMs = 3 * 60 * 60 * 1000;
  const aheadLimitMs = maxAheadMs ?? 7 * 24 * 60 * 60 * 1000;

  useEffect(() => {
    if (!game) {
      setCountdown(null);
      return;
    }

    const now = Date.now();
    let tipoffDate: Date | null = null;
    
    // First, try to use the datetime field from the game object (most reliable)
    if ((game as any).datetime) {
      const gameDateTime = new Date((game as any).datetime);
      if (
        !Number.isNaN(gameDateTime.getTime()) &&
        gameDateTime.getTime() > now - liveWindowMs &&
        gameDateTime.getTime() < now + aheadLimitMs
      ) {
        tipoffDate = gameDateTime;
      }
    }
    
    // If that didn't work, check if status is a valid ISO timestamp
    if (!tipoffDate && game.status) {
      const statusTime = Date.parse(game.status);
      if (!Number.isNaN(statusTime)) {
        const parsedStatus = new Date(statusTime);
        // Check if it's at midnight (00:00:00) - if so, it's just a date placeholder, not the actual game time
        const isMidnight = parsedStatus.getUTCHours() === 0 && parsedStatus.getUTCMinutes() === 0 && parsedStatus.getUTCSeconds() === 0;
        
        // Allow a recently-passed tipoff so the props page can still show LIVE after bounce.
        if (
          parsedStatus.getTime() > now - liveWindowMs &&
          !isMidnight &&
          parsedStatus.getTime() < now + aheadLimitMs
        ) {
          tipoffDate = parsedStatus;
        }
      }
    }
    
    // Try to parse tipoff from status (this extracts time from status like "7:00 PM")
    if (!tipoffDate) {
      tipoffDate = parseBallDontLieTipoff(game);
      
      // If parseBallDontLieTipoff returned midnight UTC, it's likely just a date - try extracting time from status manually
      if (tipoffDate) {
        const isMidnight = tipoffDate.getUTCHours() === 0 && tipoffDate.getUTCMinutes() === 0 && tipoffDate.getUTCSeconds() === 0;
        if (isMidnight && game.status) {
          // Try to extract time from status string manually
          const timeMatch = game.status.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
          if (timeMatch) {
            const gameDateStr = game.date?.split('T')[0] || new Date().toISOString().split('T')[0];
            let hour = parseInt(timeMatch[1], 10);
            const minute = parseInt(timeMatch[2], 10);
            const meridiem = timeMatch[3].toUpperCase();
            if (meridiem === 'PM' && hour !== 12) hour += 12;
            else if (meridiem === 'AM' && hour === 12) hour = 0;
            
            // Create date with the game date and the parsed time (in local timezone)
            const baseDate = new Date(gameDateStr);
            const tipoff = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0);
            
            tipoffDate = tipoff;
          } else {
            // No time in status, use date with 7:30 PM local time
            const dateStr = game.date?.split('T')[0] || '';
            if (dateStr) {
              const localDate = new Date(dateStr);
              localDate.setHours(19, 30, 0, 0); // 7:30 PM local
              tipoffDate = localDate;
            }
          }
        }
      }
    }
    
    // Last resort: use game.date with 7:30 PM local time
    if (!tipoffDate && game.date) {
      const dateStr = game.date.split('T')[0];
      if (dateStr) {
        const localDate = new Date(dateStr);
        localDate.setHours(19, 30, 0, 0); // 7:30 PM local
        tipoffDate = localDate;
      }
    }
    
    if (!tipoffDate || tipoffDate.getTime() <= now - liveWindowMs) {
      setCountdown(null);
      setIsGameInProgress(false);
      return;
    }

    const updateCountdown = () => {
      const now = new Date().getTime();
      const tipoff = tipoffDate.getTime();
      const diff = tipoff - now;
      setIsBeyond24h(diff > 24 * 60 * 60 * 1000);
      
      // Check if game is in progress (started within last 3 hours)
      const timeSinceTipoff = now - tipoff;
      const gameIsLive = timeSinceTipoff > 0 && timeSinceTipoff < liveWindowMs;
      
      setIsGameInProgress(gameIsLive);
      
      if (gameIsLive || diff <= 0) {
        setCountdown(null);
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setCountdown({ hours, minutes, seconds });
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    
    return () => clearInterval(interval);
  }, [game, aheadLimitMs]);

  if (isGameInProgress) {
    return (
      <div className="inline-flex items-center justify-center w-[84px] h-16 rounded-xl border-2 animate-live-badge-pulse-green"
        style={{
          background: 'linear-gradient(145deg, rgba(34, 197, 94, 0.72), rgba(22, 163, 74, 0.62))',
          borderColor: 'rgba(74, 222, 128, 0.58)',
          boxShadow: '0 0 10px rgba(34, 197, 94, 0.35), 0 0 5px rgba(22, 163, 74, 0.22), inset 0 1px 0 rgba(134, 239, 172, 0.18)',
        }}>
        <span className="text-xs font-semibold text-red-500 animate-live-pulse-red">LIVE</span>
      </div>
    );
  }

  if (!countdown) {
    return (
      <div className={`text-sm font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
    );
  }

  const isUrgent = countdown.hours === 0 && countdown.minutes < 30;
  const palette = isUrgent
    ? {
        top: '#f97316',
        bottom: '#ef4444',
        border: '#fdba74',
        glow: '#f97316',
      }
    : isBeyond24h
      ? {
          top: '#1e293b',
          bottom: '#334155',
          border: '#64748b',
          glow: '#475569',
        }
      : {
          top: '#7c3aed',
          bottom: '#2563eb',
          border: '#a78bfa',
          glow: '#7c3aed',
        };

  return (
    <div className="inline-flex flex-col items-center justify-center w-[84px] h-16 px-1.5 rounded-xl border-2"
      style={{
        background: `linear-gradient(145deg, ${palette.top}, ${palette.bottom})`,
        borderColor: palette.border,
        boxShadow: `0 0 14px ${palette.glow}75, 0 0 7px ${palette.glow}55, inset 0 1px 0 #ffffff2a`,
      }}>
      <div className="text-[10px] text-white/90 mb-0.5 tracking-wide">{label}</div>
      <div className="text-xs font-mono font-semibold text-white">
        {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
      </div>
    </div>
  );
}

function SportMark({
  sport,
  tour,
  isDark,
  compact = false,
  tiny = false,
}: {
  sport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta';
  tour?: string | null;
  isDark: boolean;
  compact?: boolean;
  tiny?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const isAfl = sport === 'afl';
  const isNbl = sport === 'nbl';
  const isTennis = isTennisPropsSport(sport);
  const tennisTour = sport === 'wta' ? 'WTA' : sport === 'atp' ? 'ATP' : String(tour || '').toUpperCase() === 'WTA' ? 'WTA' : 'ATP';
  const imgClass = isTennis
      ? (tiny
          ? 'h-5 w-8 object-contain'
          : compact ? TENNIS_LOGO_MARK_COMPACT_CLASS : TENNIS_LOGO_MARK_CLASS)
      : (tiny
          ? 'w-5 h-5 object-contain'
          : compact ? 'w-6 h-6 object-contain' : 'w-8 h-8 object-contain');
  const fallbackClass = compact
    ? `inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold border ${
        isAfl
          ? isDark
            ? 'bg-orange-900/40 text-orange-200 border-orange-700'
            : 'bg-orange-100 text-orange-700 border-orange-300'
          : isTennis
            ? isDark
              ? 'bg-lime-900/40 text-lime-200 border-lime-700'
              : 'bg-lime-100 text-lime-700 border-lime-300'
          : isDark
            ? 'bg-blue-900/40 text-blue-200 border-blue-700'
            : 'bg-blue-100 text-blue-700 border-blue-300'
      }`
    : `inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border ${
        isAfl
          ? isDark
            ? 'bg-orange-900/40 text-orange-200 border-orange-700'
            : 'bg-orange-100 text-orange-700 border-orange-300'
          : isTennis
            ? isDark
              ? 'bg-lime-900/40 text-lime-200 border-lime-700'
              : 'bg-lime-100 text-lime-700 border-lime-300'
          : isDark
            ? 'bg-blue-900/40 text-blue-200 border-blue-700'
            : 'bg-blue-100 text-blue-700 border-blue-300'
      }`;
  const src = isAfl
    ? '/images/afl-logo.png'
    : isNbl
      ? NBL_LOGO_PATH
    : isTennis
      ? tennisLogoForTour(tennisTour)
      : '/images/nba-logo.png'
  const label = isAfl ? 'AFL' : isNbl ? 'NBL' : isTennis ? tennisTour : 'NBA';

  return (
    <span className="inline-flex items-center justify-center" aria-label={label} title={label}>
      {!imgError ? (
        <img
          src={src}
          alt={label}
          className={imgClass}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className={fallbackClass}>{label}</span>
      )}
    </span>
  );
}

function SecondaryGameMatchupLogos({
  homeTeam,
  awayTeam,
  homeTeamCode,
  awayTeamCode,
  homeTeamLogo,
  awayTeamLogo,
  sport,
  aflLogoByTeam,
  nblLogoByTeam = {},
  isDark,
  mounted,
  size = 'md',
}: {
  homeTeam: string;
  awayTeam: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  sport: PropsSportMode;
  aflLogoByTeam: Record<string, string>;
  nblLogoByTeam?: Record<string, string>;
  isDark: boolean;
  mounted: boolean;
  size?: 'sm' | 'md';
}) {
  const imgClass = size === 'md' ? 'w-8 h-8' : 'w-5 h-5';
  const vsClass = size === 'md' ? 'text-xs' : 'text-[10px] leading-none';
  const vsWeight = size === 'md' ? 'font-semibold' : '';

  if (isTennisPropsSport(sport)) {
    const homeName = String(homeTeam ?? '').trim();
    const awayName = String(awayTeam ?? '').trim();
    const tourLogo = tennisLogoForTour(sport === 'wta' ? 'WTA' : 'ATP');
    const homeLogo = tourLogo;
    const awayLogo = tourLogo;
    const shortName = (name: string) => {
      const parts = name.split(/\s+/).filter(Boolean);
      return parts.length <= 1 ? name : `${parts[0][0]}. ${parts[parts.length - 1]}`;
    };
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <img src={homeLogo} alt="" className={`${imgClass} object-contain flex-shrink-0`} />
        <span className={`${vsClass} ${vsWeight} truncate ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>
          {shortName(homeName)}
        </span>
        <span className={`${vsClass} ${vsWeight} flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
        <span className={`${vsClass} ${vsWeight} truncate ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>
          {shortName(awayName)}
        </span>
        <img src={awayLogo} alt="" className={`${imgClass} object-contain flex-shrink-0`} />
      </div>
    );
  }

  if (isNblPropsSport(sport)) {
    const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
    const tryNblLogo = (name: string, fallback?: string | null): string | null => {
      const direct = String(fallback || '').trim();
      if (direct.startsWith('http') || direct.startsWith('/')) return direct;
      if (!name) return null;
      if (nblLogoByTeam[name]) return nblLogoByTeam[name];
      const official = resolveNblClubName(name);
      if (official && nblLogoByTeam[official]) return nblLogoByTeam[official];
      const key = n(official || name);
      for (const [logoKey, url] of Object.entries(nblLogoByTeam)) {
        if (n(logoKey) === key) return url;
      }
      return null;
    };
    const homeLogoUrl =
      tryNblLogo(homeTeam, homeTeamLogo) || tryNblLogo(homeTeamCode || '');
    const awayLogoUrl =
      tryNblLogo(awayTeam, awayTeamLogo) || tryNblLogo(awayTeamCode || '');
    const homeAlt = resolveNblClubName(homeTeam) || homeTeam;
    const awayAlt = resolveNblClubName(awayTeam) || awayTeam;
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {homeLogoUrl ? (
          <img src={homeLogoUrl} alt={homeAlt} className={`${imgClass} object-contain flex-shrink-0`} />
        ) : (
          <div className={`${imgClass} rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
        )}
        <span className={`${vsClass} ${vsWeight} flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
        {awayLogoUrl ? (
          <img src={awayLogoUrl} alt={awayAlt} className={`${imgClass} object-contain flex-shrink-0`} />
        ) : (
          <div className={`${imgClass} rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
        )}
      </div>
    );
  }

  const h = toOfficialAflTeamDisplayName(homeTeam);
  let a = toOfficialAflTeamDisplayName(awayTeam);
  if (h && a && h === a) a = '';
  const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  const tryAflLogo = (name: string): string | null => {
    if (!name) return null;
    if (aflLogoByTeam[n(name)]) return aflLogoByTeam[n(name)];
    for (const w of name.split(/\s+/)) {
      if (aflLogoByTeam[n(w)]) return aflLogoByTeam[n(w)];
    }
    return null;
  };
  const homeLogoUrl = h ? tryAflLogo(h) : null;
  const awayLogoUrl = a ? tryAflLogo(a) : null;
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {homeLogoUrl ? (
        <img src={homeLogoUrl} alt={h} className={`${imgClass} object-contain flex-shrink-0`} />
      ) : (
        <div className={`${imgClass} rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
      )}
      <span className={`${vsClass} ${vsWeight} flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
      {awayLogoUrl ? (
        <img src={awayLogoUrl} alt={a} className={`${imgClass} object-contain flex-shrink-0`} />
      ) : (
        <div className={`${imgClass} rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
      )}
    </div>
  );
}

function tennisShortDisplayName(name: string): string {
  const parts = String(name || '').split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return String(name || '').trim();
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

function tennisPropsEventSubtitle(prop: PlayerProp, games: AflGameForProps[]): string {
  const game = prop.gameId ? games.find((g) => g.gameId === prop.gameId) ?? null : null;
  const tour = tennisTourLabel({ tour: prop.team || prop.playerTeam });
  const place = tennisEventPlaceLabel(prop.tournamentName || game?.tournamentName);
  const surface = String(prop.surface || game?.surface || '').trim();
  return [tour, place, surface].filter(Boolean).join(' - ');
}

function tennisRankLabel(rank?: number | null): string {
  return rank != null && Number.isFinite(rank) && rank > 0 ? `#${rank}` : '';
}

function tennisIocFromListedPlayer(name: string, props: PlayerProp[]): string | null {
  const want = String(name || '').trim();
  if (!want) return null;
  const wantKey = want.toLowerCase();
  const exact: string[] = [];
  const identity: string[] = [];
  for (const row of props) {
    const ioc = String(row.playerIoc || '').trim();
    if (!ioc) continue;
    const playerName = String(row.playerName || '').trim();
    if (playerName.toLowerCase() === wantKey) {
      if (!exact.includes(ioc)) exact.push(ioc);
      continue;
    }
    if (tennisIdentityMatch(playerName, want) && !identity.includes(ioc)) identity.push(ioc);
  }
  if (exact.length === 1) return exact[0];
  if (identity.length === 1) return identity[0];
  return null;
}

function isTennisMoneylineStat(statType?: string): boolean {
  return String(statType || '') === 'moneyline';
}

function TennisFlagAndRank({
  ioc,
  rank,
  isDark,
  mounted,
  compact = false,
}: {
  ioc?: string | null;
  rank?: number | null;
  isDark: boolean;
  mounted: boolean;
  compact?: boolean;
}) {
  const flagUrl = tennisFlagUrl(ioc);
  const rankLabel = tennisRankLabel(rank);
  if (!flagUrl && !rankLabel) return null;
  const flagClass = compact ? 'h-[10px] w-3.5' : 'h-3.5 w-5';
  const rankClass = compact
    ? `text-[10px] leading-none tabular-nums flex-shrink-0 ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`
    : `text-xs tabular-nums flex-shrink-0 ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`;
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      {flagUrl ? (
        <img src={flagUrl} alt="" className={`${flagClass} object-cover rounded-[1px] shadow-sm`} />
      ) : null}
      {rankLabel ? <span className={rankClass}>{rankLabel}</span> : null}
    </span>
  );
}

function TennisPropsOpponentLine({
  opponentName,
  opponentIoc,
  opponentRank,
  isDark,
  mounted,
  compact = false,
}: {
  opponentName: string;
  opponentIoc?: string | null;
  opponentRank?: number | null;
  isDark: boolean;
  mounted: boolean;
  compact?: boolean;
}) {
  const name = String(opponentName || '').trim();
  if (!name) return null;
  const textClass = compact ? 'text-[10px] leading-none' : 'text-xs';
  const flagClass = compact ? 'h-[10px] w-3.5' : 'h-3 w-[18px]';
  const nameClass = `${textClass} font-medium truncate ${mounted && isDark ? 'text-white' : 'text-gray-700'}`;
  const rankClass = `${textClass} tabular-nums flex-shrink-0 ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`;
  const vsClass = `${textClass} flex-shrink-0 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`;
  const flagUrl = tennisFlagUrl(opponentIoc);
  const rankLabel = tennisRankLabel(opponentRank);
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <span className={vsClass}>vs</span>
      {flagUrl ? (
        <img src={flagUrl} alt="" className={`${flagClass} object-cover rounded-[1px] flex-shrink-0 shadow-sm`} />
      ) : null}
      <span className={nameClass}>{tennisShortDisplayName(name)}</span>
      {rankLabel ? <span className={rankClass}>{rankLabel}</span> : null}
    </div>
  );
}

// Constants
const SEARCH_DEBOUNCE_MS = 300;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_STORAGE_MAX_SIZE = 4 * 1024 * 1024; // 4MB (conservative limit, most browsers allow 5-10MB)

function safeSetSessionStorage(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (value.length > SESSION_STORAGE_MAX_SIZE) {
      console.warn(`[NBA Landing] Data too large for sessionStorage (${value.length} bytes):`, key);
      return false;
    }
    sessionStorage.setItem(key, value);
    return true;
  } catch (e: any) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      console.warn(`[NBA Landing] SessionStorage quota exceeded for key:`, key);
    } else {
      console.warn(`[NBA Landing] Failed to set sessionStorage:`, key, e);
    }
    return false;
  }
}

function getDashboardGamesDateRange(): { start: string; end: string } {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];
  return { start, end };
}

function getDashboardGamesCacheKey(): string {
  const { start, end } = getDashboardGamesDateRange();
  return `dashboard-games-${start}-${end}`;
}

function readDashboardGamesFromSessionCache(): Game[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const cacheKey = getDashboardGamesCacheKey();
    const cachedData = sessionStorage.getItem(cacheKey);
    const cachedTimestamp = sessionStorage.getItem(`${cacheKey}-timestamp`);
    if (!cachedData || !cachedTimestamp) return null;
    const age = Date.now() - parseInt(cachedTimestamp, 10);
    if (age >= CACHE_TTL_MS) return null;
    const parsed = JSON.parse(cachedData);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Game[];
  } catch {
    // ignore parse/storage errors
  }
  return null;
}
const BATCH_DELAY_MS = 500;
const ODDS_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_ODDS_CHECK_DELAY_MS = 30 * 1000; // 30 seconds
const NOTIFICATION_STORAGE_KEY = 'stattrackr-notifications';
const PROPS_NEXT_SPORT_SURVEY_STORAGE_PREFIX = 'props-next-sport-survey-v1';
const NEXT_SPORT_SURVEY_OPTIONS = ['Tennis', 'Soccer', 'MLB', 'Esports'] as const;
type NextSportSurveyOption = (typeof NEXT_SPORT_SURVEY_OPTIONS)[number];
const PROPS_NEXT_SPORT_SURVEY_ENDS_AT = '2026-04-14T01:19:00.000Z';
const PROPS_NBL_ANNOUNCEMENT_DISMISSED_KEY = 'props_nbl_announcement_dismissed_v1';
const NBA_TEAM_ABBR_ALIASES: Record<string, string> = {
  WSH: 'WAS',
  GS: 'GSW',
  NO: 'NOP',
  SA: 'SAS',
  PHO: 'PHX',
  BK: 'BKN',
  BRK: 'BKN',
  NY: 'NYK',
};
const EASTERN_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getEasternDateKey(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
  }

  const parts = EASTERN_DATE_FORMATTER.formatToParts(parsed);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

function normalizeNbaTeam(team: string): string {
  if (!team) return '';
  const upper = team.toUpperCase().trim().replace(/\./g, '');
  if (upper.length <= 3) {
    return NBA_TEAM_ABBR_ALIASES[upper] || upper;
  }

  const abbr = TEAM_FULL_TO_ABBR[upper] || TEAM_FULL_TO_ABBR[team] || null;
  if (!abbr) return upper;
  const normalizedAbbr = abbr.toUpperCase().replace(/\./g, '');
  return NBA_TEAM_ABBR_ALIASES[normalizedAbbr] || normalizedAbbr;
}

const AFL_PROPS_CACHE_KEY = 'afl_props_list_cache_v6';
const NBL_PROPS_CACHE_KEY = 'nbl_props_list_cache_v5';

const ATP_PROPS_CACHE_KEY = 'atp_props_list_cache_v18';
const WTA_PROPS_CACHE_KEY = 'wta_props_list_cache_v23';


function aflPropHasHistoricalStats(row: {
  last5Avg?: number | null;
  last10Avg?: number | null;
  seasonAvg?: number | null;
}): boolean {
  return row.last5Avg != null || row.last10Avg != null || row.seasonAvg != null;
}

/** True once H2H found games. {hits:0,total:0} is a stale empty lookup and should be retried. */
function aflPropHasH2hGames(row: {
  h2hAvg?: number | null;
  h2hHitRate?: { hits: number; total: number } | null;
}): boolean {
  if (row.h2hAvg != null) return true;
  return (row.h2hHitRate?.total ?? 0) > 0;
}

function aflPropStatsBackfillKey(p: PlayerProp): string {
  return `${p.playerName}|${p.statType}|${p.homeTeam || p.team}|${p.awayTeam || p.opponent}|${p.line}`;
}

const aflH2hBackfillAttempted = new Set<string>();

/** Match server AFL_ENRICHED_STATS_MIN_COVERAGE — partial L5 (e.g. 30%) must still refetch. */
const AFL_HISTORICAL_STATS_MIN_COVERAGE = 0.8;

function countAflPropsWithHistoricalStats(props: PlayerProp[]): number {
  return props.filter(isAflCombinedListProp).filter(aflPropHasHistoricalStats).length;
}

function aflPropsHistoricalStatsCoverage(props: PlayerProp[]): number {
  const listed = props.filter(isAflCombinedListProp);
  if (listed.length === 0) return 1;
  return countAflPropsWithHistoricalStats(listed) / listed.length;
}

function aflPropsMissingH2hGames(props: PlayerProp[]): boolean {
  const listed = props.filter(isAflCombinedListProp);
  if (listed.length === 0) return false;
  return listed.some((p) => !aflPropHasH2hGames(p) && !aflH2hBackfillAttempted.has(aflPropStatsBackfillKey(p)));
}

function aflPropsMissingHistoricalStats(props: PlayerProp[]): boolean {
  const listed = props.filter(isAflCombinedListProp);
  if (listed.length === 0) return false;
  return aflPropsHistoricalStatsCoverage(listed) < AFL_HISTORICAL_STATS_MIN_COVERAGE;
}

function aflPropsNeedStatsBackfill(props: PlayerProp[]): boolean {
  return aflPropsMissingHistoricalStats(props) || aflPropsMissingH2hGames(props);
}

async function backfillAflPropStatsBatch(props: PlayerProp[]): Promise<PlayerProp[] | null> {
  if (!isOnPropsPage()) return null;
  const needsStats = props
    .filter((p) => {
      if (!isAflCombinedListProp(p) || !p.overOdds || p.overOdds === 'N/A') return false;
      const missingHist = !aflPropHasHistoricalStats(p);
      const missingH2h = !aflPropHasH2hGames(p);
      if (!missingHist && !missingH2h) return false;
      if (missingH2h && !missingHist && aflH2hBackfillAttempted.has(aflPropStatsBackfillKey(p))) return false;
      return true;
    })
    .sort((a, b) => {
      const aPri = aflPropHasHistoricalStats(a) && !aflPropHasH2hGames(a) ? 0 : 1;
      const bPri = aflPropHasHistoricalStats(b) && !aflPropHasH2hGames(b) ? 0 : 1;
      return aPri - bPri;
    })
    .slice(0, 60);
  if (needsStats.length === 0) return null;

  for (const p of needsStats) {
    if (!aflPropHasH2hGames(p)) aflH2hBackfillAttempted.add(aflPropStatsBackfillKey(p));
  }

  const batchProps = needsStats.map((p) => ({
    playerName: p.playerName,
    team: p.homeTeam || p.team,
    opponent: p.awayTeam || p.opponent,
    statType: p.statType,
    line: p.line,
    playerTeam: p.playerTeam || p.team,
  }));

  const signal = startAflPropsStatsBackfill();
  try {
    const res = await fetch('/api/afl/props-stats/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ props: batchProps, cacheOnly: true }),
      cache: 'no-store',
      signal,
    });
    if (!isOnPropsPage() || signal.aborted) return null;
    if (!res.ok) {
      for (const p of needsStats) aflH2hBackfillAttempted.delete(aflPropStatsBackfillKey(p));
      return null;
    }
    const data = (await res.json()) as {
      stats?: Record<
        string,
        {
          last5Avg?: number | null;
          last10Avg?: number | null;
          h2hAvg?: number | null;
          seasonAvg?: number | null;
          streak?: number | null;
          last5HitRate?: { hits: number; total: number } | null;
          last10HitRate?: { hits: number; total: number } | null;
          h2hHitRate?: { hits: number; total: number } | null;
          seasonHitRate?: { hits: number; total: number } | null;
          dvpRating?: number | null;
          dvpStatValue?: number | null;
        }
      >;
    };
    if (!isOnPropsPage() || signal.aborted) return null;
    const stats = data.stats ?? {};
    let merged = 0;
    const updated = props.map((p) => {
      const keys = [
        `${p.playerName}|${p.statType}|${p.homeTeam || p.team}|${p.awayTeam || p.opponent}|${p.line}`,
        `${p.playerName}|${p.statType}|${p.team}|${p.opponent}|${p.line}`,
      ];
      const s = keys.map((k) => stats[k]).find(Boolean);
      if (!s) return p;
      merged++;
      return {
        ...p,
        last5Avg: s.last5Avg ?? p.last5Avg,
        last10Avg: s.last10Avg ?? p.last10Avg,
        h2hAvg: s.h2hAvg ?? p.h2hAvg,
        seasonAvg: s.seasonAvg ?? p.seasonAvg,
        streak: s.streak ?? p.streak,
        last5HitRate: s.last5HitRate ?? p.last5HitRate,
        last10HitRate: s.last10HitRate ?? p.last10HitRate,
        h2hHitRate: s.h2hHitRate ?? p.h2hHitRate,
        seasonHitRate: s.seasonHitRate ?? p.seasonHitRate,
        dvpRating: s.dvpRating ?? p.dvpRating,
        dvpStatValue: s.dvpStatValue ?? p.dvpStatValue,
      };
    });
    return merged > 0 ? updated : null;
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return null;
    }
    for (const p of needsStats) aflH2hBackfillAttempted.delete(aflPropStatsBackfillKey(p));
    return null;
  }
}


function isTennisPropStatType(statType: string): boolean {
  const n = normalizeSecondaryPropStatType(statType).replace(/_/g, '');
  return (
    n === 'moneyline' ||
    n === 'spread' ||
    n === 'totalgames' ||
    n === 'gameswon' ||
    n === 'gameslost' ||
    n === 'totalsets'
  );
}

function isTennisListProp(row: PlayerProp): boolean {
  return (
    isTennisPropStatType(row.statType) &&
    propsSportFromTennisTour(row.team || row.homeTeamCode) != null
  );
}

function tennisListRowsHaveFormStats(props: PlayerProp[]): boolean {
  const rows = props.filter(isTennisListProp);
  if (!rows.length) return false;
  const withStats = rows.filter(aflPropHasHistoricalStats).length;
  return withStats >= Math.max(1, Math.ceil(rows.length * 0.15));
}

function resolvePropsRowSport(
  prop: PlayerProp,
  sport: PropsSportMode
): CombinedSportSource {
  if (sport !== 'combined') {
    if (sport === 'nba' || sport === 'afl' || sport === 'nbl' || sport === 'atp' || sport === 'wta') {
      return sport;
    }
    return 'nba';
  }
  const tagged = (prop as CombinedPlayerPropRow).sportSource;
  if (tagged) return tagged;
  const tennis = propsSportFromTennisTour(prop.team || prop.homeTeamCode);
  if (tennis) return tennis;
  if (isTennisPropStatType(prop.statType)) return 'atp';
  if (isNblListPropStatType(prop.statType)) return 'nbl';
  if (
    isAflExclusivePropStatType(prop.statType) ||
    prop.aflFantasyPosition ||
    prop.aflDfsRole
  ) {
    return 'afl';
  }
  return 'nba';
}

function isNblListPropStatType(statType: string): boolean {
  const n = normalizeSecondaryPropStatType(statType);
  return n === 'points' || n === 'rebounds' || n === 'assists' || n === 'threemade';
}

function isNblListProp(row: PlayerProp): boolean {
  return isNblListPropStatType(row.statType);
}

function nblBookmakerLineCount(prop: PlayerProp | null | undefined): number {
  if (Array.isArray(prop?.bookmakerLines) && prop.bookmakerLines.length > 0) {
    return prop.bookmakerLines.length;
  }
  return String(prop?.bookmaker || '').trim() ? 1 : 0;
}

function nblLineHasUnibet(prop: PlayerProp): boolean {
  if (/unibet/i.test(String(prop.bookmaker || ''))) return true;
  return (prop.bookmakerLines || []).some((line) => /unibet/i.test(String(line.bookmaker || '')));
}

function nblLooksMissingUnibet(props: PlayerProp[]): boolean {
  const rows = props.filter(
    (row) => isNblListProp(row) && !/^(yes|no|over|under)$/i.test(String(row.playerName || '').trim())
  );
  if (!rows.length) return true;
  return !rows.some(nblLineHasUnibet);
}

function nblPropMergeKey(prop: PlayerProp): string {
  const matchup = [prop.homeTeam, prop.awayTeam]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
  return `${String(prop.playerName || '').trim().toLowerCase()}|${String(prop.statType || '').toLowerCase()}|${matchup}`;
}

function mergeNblPropForPaint(previous: PlayerProp | undefined, next: PlayerProp): PlayerProp {
  if (!previous) return next;
  const lines = [...(previous.bookmakerLines || [])];
  for (const line of next.bookmakerLines || []) {
    if (!lines.some((existing) => existing.bookmaker === line.bookmaker && existing.line === line.line)) {
      lines.push(line);
    }
  }
  const keep = nblBookmakerLineCount(next) >= nblBookmakerLineCount(previous) ? next : previous;
  const other = keep === next ? previous : next;
  return {
    ...keep,
    bookmakerLines: lines.length ? lines : keep.bookmakerLines,
    bookmaker: keep.bookmaker || other.bookmaker,
    overOdds: keep.overOdds || other.overOdds,
    underOdds: keep.underOdds || other.underOdds,
  };
}

function preferNblPropsForPaint(previous: PlayerProp[], incoming: PlayerProp[]): PlayerProp[] {
  const prevRows = previous.filter(isNblListProp);
  const nextRows = incoming.filter(isNblListProp);
  if (!nextRows.length) return prevRows;
  if (!prevRows.length) return nextRows;
  const byKey = new Map<string, PlayerProp>();
  for (const row of prevRows) byKey.set(nblPropMergeKey(row), row);
  for (const row of nextRows) {
    const key = nblPropMergeKey(row);
    byKey.set(key, mergeNblPropForPaint(byKey.get(key), row));
  }
  return [...byKey.values()];
}

function isAflCombinedListProp(row: PlayerProp): boolean {
  return !isTennisPropStatType(row.statType) && !isNblListPropStatType(row.statType);
}

function aflPropHasPositionLabel(row: PlayerProp): boolean {
  return Boolean(formatAflFantasyDfsPositionLabel(row.aflFantasyPosition, row.aflDfsRole));
}

function aflPropsMissingPositionLabels(props: PlayerProp[]): boolean {
  const listed = props.filter(isAflCombinedListProp);
  if (listed.length === 0) return false;
  return !listed.some(aflPropHasPositionLabel);
}

function tennisPropMergeKey(prop: PlayerProp): string {
  return `${prop.playerName}|${prop.gameId || ''}|${prop.statType}|${prop.line}`;
}

function tennisBookmakerLineCount(prop: PlayerProp | null | undefined): number {
  if (Array.isArray(prop?.bookmakerLines) && prop.bookmakerLines.length > 0) {
    return prop.bookmakerLines.length;
  }
  return 0;
}

function tennisDisplayBookmakerLines(prop: PlayerProp) {
  return bookmakerLinesFromTennisRow(prop);
}

function tennisPropsForPaint(rows: PlayerProp[]): PlayerProp[] {
  return aggregateTennisPropsForPaint(rows.filter(isTennisListProp)) as PlayerProp[];
}

function tennisTipoffValue(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw || raw === 'N/A') return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return '';
  const date = new Date(parsed);
  const dateOnly = !raw.includes('T') && date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  return dateOnly ? '' : raw;
}

function mergeTennisPropForPaint(previous: PlayerProp | undefined, next: PlayerProp): PlayerProp {
  if (!previous) return next;
  const nextBooks = tennisBookmakerLineCount(next);
  const prevBooks = tennisBookmakerLineCount(previous);
  const bookmakerLines =
    nextBooks >= prevBooks && Array.isArray(next.bookmakerLines) && next.bookmakerLines.length > 0
      ? next.bookmakerLines
      : previous.bookmakerLines?.length
        ? previous.bookmakerLines
        : next.bookmakerLines;
  const gameDate = tennisTipoffValue(next.gameDate) || tennisTipoffValue(previous.gameDate) || next.gameDate || previous.gameDate;
  const primary = bookmakerLines?.[0];
  const nextRank = typeof next.dvpRating === 'number' && Number.isFinite(next.dvpRating) && next.dvpRating > 0;
  const prevRank = typeof previous.dvpRating === 'number' && Number.isFinite(previous.dvpRating) && previous.dvpRating > 0;
  const prevField = Number(previous.dvpFieldSize) || 0;
  const nextField = Number(next.dvpFieldSize) || 0;
  const keepPrevDvp = prevRank && (!nextRank || prevField > nextField);
  return {
    ...next,
    gameDate,
    bookmakerLines,
    bookmaker: nextBooks >= prevBooks ? next.bookmaker || previous.bookmaker : previous.bookmaker || next.bookmaker,
    overOdds: primary?.overOdds || next.overOdds || previous.overOdds,
    underOdds: primary?.underOdds || next.underOdds || previous.underOdds,
    dvpRating: keepPrevDvp ? previous.dvpRating : next.dvpRating ?? previous.dvpRating,
    dvpStatValue: keepPrevDvp ? previous.dvpStatValue : next.dvpStatValue ?? previous.dvpStatValue,
    dvpFieldSize: keepPrevDvp ? previous.dvpFieldSize : next.dvpFieldSize ?? previous.dvpFieldSize,
    last5Avg: next.last5Avg ?? previous.last5Avg,
    last10Avg: next.last10Avg ?? previous.last10Avg,
    h2hAvg: next.h2hAvg ?? previous.h2hAvg,
    seasonAvg: next.seasonAvg ?? previous.seasonAvg,
    streak: next.streak ?? previous.streak,
    last5HitRate: next.last5HitRate ?? previous.last5HitRate,
    last10HitRate: next.last10HitRate ?? previous.last10HitRate,
    h2hHitRate: next.h2hHitRate ?? previous.h2hHitRate,
    seasonHitRate: next.seasonHitRate ?? previous.seasonHitRate,
  };
}

/** Keep multi-book odds and real start times when a later list fetch is thinner. */
function preferTennisPropsForPaint(previous: PlayerProp[], incoming: PlayerProp[]): PlayerProp[] {
  const prevRows = tennisPropsForPaint(previous);
  const nextRows = tennisPropsForPaint(incoming);
  if (!nextRows.length) return prevRows;
  if (!prevRows.length) return nextRows;
  const byKey = new Map<string, PlayerProp>();
  for (const row of prevRows) byKey.set(tennisPropMergeKey(row), row);
  for (const row of nextRows) {
    const key = tennisPropMergeKey(row);
    byKey.set(key, mergeTennisPropForPaint(byKey.get(key), row));
  }
  return [...byKey.values()];
}

function tennisLooksOneMarketPerPlayer(props: PlayerProp[]): boolean {
  const byPlayer = new Map<string, Set<string>>();
  for (const prop of props.filter(isTennisListProp)) {
    const key = String(prop.playerId || prop.playerName || '').trim().toLowerCase();
    if (!key) continue;
    const stats = byPlayer.get(key) ?? new Set<string>();
    stats.add(String(prop.statType || '').toLowerCase());
    byPlayer.set(key, stats);
  }
  const sizes = [...byPlayer.values()].map((stats) => stats.size);
  if (sizes.length < 6) return false;
  const oneMarket = sizes.filter((size) => size <= 1).length;
  return oneMarket / sizes.length >= 0.8;
}

function preferAflPropsForCombined(primary: PlayerProp[], fallback: PlayerProp[]): PlayerProp[] {
  const primaryAfl = primary.filter(isAflCombinedListProp);
  const fallbackAfl = fallback.filter(isAflCombinedListProp);
  if (primaryAfl.length === 0) return fallbackAfl;
  if (fallbackAfl.length === 0) return primaryAfl;
  const primaryCoverage = aflPropsHistoricalStatsCoverage(primaryAfl);
  const fallbackCoverage = aflPropsHistoricalStatsCoverage(fallbackAfl);
  const primaryPos = primaryAfl.some(aflPropHasPositionLabel);
  const fallbackPos = fallbackAfl.some(aflPropHasPositionLabel);
  if (fallbackCoverage > primaryCoverage && (fallbackPos || !primaryPos)) return fallbackAfl;
  if (primaryCoverage > fallbackCoverage && (primaryPos || !fallbackPos)) return primaryAfl;
  if (primaryPos !== fallbackPos) return primaryPos ? primaryAfl : fallbackAfl;
  return primaryAfl.length >= fallbackAfl.length ? primaryAfl : fallbackAfl;
}

type SecondaryPropsSessionCache = {
  props: PlayerProp[];
  games: AflGameForProps[];
  selectedGameIds: string[];
  userModifiedGames: boolean;
  isFresh: boolean;
};

type SecondaryGameSelection = {
  ids: string[];
  userModified: boolean;
};

function mergeSecondaryGames(primary: AflGameForProps[], extra: AflGameForProps[]): AflGameForProps[] {
  const seen = new Set<string>();
  const out: AflGameForProps[] = [];
  for (const game of [...primary, ...extra]) {
    const id = String(game?.gameId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(game);
  }
  return out;
}

function readSecondaryPropsSessionCache(sport: SecondaryPropsSport): SecondaryPropsSessionCache {
  const empty: SecondaryPropsSessionCache = {
    props: [],
    games: [],
    selectedGameIds: [],
    userModifiedGames: false,
    isFresh: false,
  };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = sessionStorage.getItem(getSecondaryPropsCacheKey(sport));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as {
      props?: PlayerProp[];
      games?: AflGameForProps[];
      selectedGameIds?: string[];
      userModifiedGames?: boolean;
      timestamp?: number;
    };
    const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
    const isFresh = Number.isFinite(age) && age < AFL_PROPS_CACHE_TTL_MS;
    const propsRaw = Array.isArray(parsed?.props) ? parsed.props : [];
    const props = isTennisPropsSport(sport)
      ? propsRaw.filter(isTennisListProp)
      : propsRaw;
    const statsFresh = isTennisPropsSport(sport)
      ? tennisListRowsHaveFormStats(props)
      : !aflPropsNeedStatsBackfill(props);
    return {
      props,
      games: Array.isArray(parsed?.games) ? parsed.games : [],
      selectedGameIds: Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : [],
      userModifiedGames: parsed?.userModifiedGames === true,
      isFresh: isFresh && statsFresh,
    };
  } catch {
    return empty;
  }
}

function tennisPropsForTour(props: PlayerProp[], tour: 'atp' | 'wta'): PlayerProp[] {
  return props.filter(
    (p) => isTennisListProp(p) && propsSportFromTennisTour(p.team || p.homeTeamCode) === tour
  );
}

function tennisTourRowsForHydrate(tour: 'atp' | 'wta', memory: PlayerProp[]): PlayerProp[] {
  const fromMemory = tennisPropsForTour(memory, tour);
  if (fromMemory.length > 0) return fromMemory;
  const fromCaches = readTennisTourPropsFromCaches(tour);
  if (fromCaches.length > 0) return fromCaches;
  return tennisPropsForTour(readSecondaryPropsSessionCache(tour).props, tour);
}

function combinedModeHasAflRows(aflProps: PlayerProp[]): boolean {
  return aflProps.some(isAflCombinedListProp);
}


function combinedModeMissingSecondarySlice(
  aflProps: PlayerProp[],
  opts?: { noAflOdds?: boolean }
): { missingAfl: boolean } {
  const noAflOdds = opts?.noAflOdds === true;
  const hasAfl = combinedModeHasAflRows(aflProps);
  const missingAfl = !noAflOdds && !hasAfl;
  return { missingAfl };
}

function isCombinedSecondaryPaintReady(
  aflProps: PlayerProp[],
  opts?: { noAflOdds?: boolean }
): boolean {
  const noAflOdds = opts?.noAflOdds === true;
  return noAflOdds || combinedModeHasAflRows(aflProps);
}

function combinedModeHasVisibleRows(
  nbaProps: PlayerProp[],
  aflProps: PlayerProp[],
  tennisProps: PlayerProp[] = [],
  nblProps: PlayerProp[] = []
): boolean {
  if (nbaProps.length > 0) return true;
  if (aflProps.some(isAflCombinedListProp)) return true;
  if (tennisProps.some((prop) => isTennisPropStatType(prop.statType))) return true;
  if (nblProps.some(isNblListProp)) return true;
  return false;
}

function combinedModeNeedsDataRefresh(
  nbaProps: PlayerProp[],
  aflProps: PlayerProp[],
  partialRefetchAttempted: { afl: boolean },
  oddsFlags?: { noAflOdds?: boolean }
): boolean {
  if (!combinedModeHasVisibleRows(nbaProps, aflProps)) return true;
  const { missingAfl } = combinedModeMissingSecondarySlice(aflProps, oddsFlags);
  if (missingAfl && !partialRefetchAttempted.afl) return true;
  if (aflProps.some(isAflCombinedListProp) && aflPropsMissingHistoricalStats(aflProps)) {
    return true;
  }
  return false;
}


function normalizeSecondaryPropStatType(statType: string): string {
  return String(statType || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/** AFL-only markets used to keep tennis rows out of the AFL slice. */
function isAflExclusivePropStatType(statType: string): boolean {
  const n = normalizeSecondaryPropStatType(statType);
  return (
    n === 'disposals' ||
    n === 'disposals_over' ||
    n === 'kicks' ||
    n === 'marks' ||
    n === 'tackles' ||
    n === 'handballs' ||
    n === 'fantasy_points' ||
    n === 'goals_over' ||
    n === 'anytime_goal_scorer' ||
    n.includes('disposal') ||
    n.includes('handball') ||
    n.includes('tackle') ||
    n.includes('goal')
  );
}


function propGameIdsFromRows(props: PlayerProp[]): Set<string> {
  const ids = new Set<string>();
  for (const p of props) {
    if (p.gameId) ids.add(p.gameId);
  }
  return ids;
}

function gamesMatchingProps(props: PlayerProp[], games: AflGameForProps[]): AflGameForProps[] {
  const ids = propGameIdsFromRows(props);
  if (ids.size === 0) return games;
  return games.filter((g) => ids.has(g.gameId));
}

/** Never restore game ids that do not belong to the current rows. */
function selectedGameIdsForProps(
  props: PlayerProp[],
  games: AflGameForProps[],
  preferredIds?: string[]
): Set<string> {
  const propIds = propGameIdsFromRows(props);
  if (propIds.size === 0) return new Set<string>();
  if (Array.isArray(preferredIds) && preferredIds.length > 0) {
    const overlap = preferredIds.filter((id) => propIds.has(id));
    if (overlap.length > 0) return new Set(overlap);
  }
  const matchedGames = gamesMatchingProps(props, games);
  if (matchedGames.length > 0) {
    return new Set(matchedGames.map((g) => g.gameId));
  }
  return new Set(propIds);
}

function propsRowShowsUnderOdds(
  rowSport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta',
  underOdds?: string | null
): boolean {
  if (rowSport === 'nbl') {
    const u = String(underOdds || '').trim();
    return u !== '' && u !== 'N/A';
  }
  return true;
}
const COMBINED_PROPS_CACHE_KEY = 'combined_props_snapshot_cache_v18';
const COMBINED_PROPS_LS_KEY = 'combined_props_snapshot_ls_v14';
const COMBINED_PROPS_LS_TS_KEY = 'combined_props_snapshot_ls_ts_v14';
const COMBINED_PROPS_LS_TTL_MS = 30 * 60 * 1000;

type CombinedSnapshotBrowserCache = CombinedPropsSnapshotResponse & {
  timestamp?: number;
  selectedGameIds?: string[];
};

function readCombinedSnapshotBrowserCache(): CombinedSnapshotBrowserCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const sessionRaw = sessionStorage.getItem(COMBINED_PROPS_CACHE_KEY);
    if (sessionRaw) {
      const parsed = JSON.parse(sessionRaw) as CombinedSnapshotBrowserCache;
      const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
      if (age < CACHE_TTL_MS) return parsed;
    }
  } catch {
    // ignore
  }
  try {
    const lsRaw = localStorage.getItem(COMBINED_PROPS_LS_KEY);
    const lsTsRaw = localStorage.getItem(COMBINED_PROPS_LS_TS_KEY);
    const lsTs = lsTsRaw ? parseInt(lsTsRaw, 10) : 0;
    const lsAge = Number.isFinite(lsTs) ? Date.now() - lsTs : Infinity;
    if (lsRaw && lsAge < COMBINED_PROPS_LS_TTL_MS) {
      const parsed = JSON.parse(lsRaw) as CombinedSnapshotBrowserCache;
      if (parsed && typeof parsed === 'object') {
        return { ...parsed, timestamp: lsTs };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function readTennisTourPropsFromCaches(tour: 'atp' | 'wta'): PlayerProp[] {
  const cached = readSecondaryPropsSessionCache(tour);
  if (cached.isFresh) {
    const rows = tennisPropsForTour(cached.props, tour);
    if (rows.length > 0) return rows;
  }
  const combined = readCombinedSnapshotBrowserCache();
  return tennisPropsForTour(
    Array.isArray(combined?.tennis?.props) ? combined.tennis.props : [],
    tour
  );
}

function getSecondaryPropsCacheKey(sport: SecondaryPropsSport): string {
  if (sport === 'atp') return ATP_PROPS_CACHE_KEY;
  if (sport === 'wta') return WTA_PROPS_CACHE_KEY;
  if (sport === 'nbl') return NBL_PROPS_CACHE_KEY;
  return AFL_PROPS_CACHE_KEY;
}

function writeTennisTourSessionCaches(opts: {
  props: PlayerProp[];
  games: AflGameForProps[];
  selectedGameIds: string[];
  now: number;
  noTennisOdds?: boolean;
}) {
  for (const sport of ['atp', 'wta'] as const) {
    const tour = tennisTourFromPropsSport(sport);
    const tourProps = opts.props.filter(
      (p) => isTennisListProp(p) && propsSportFromTennisTour(p.team || p.homeTeamCode) === sport
    );
    const gameIds = new Set(tourProps.map((p) => p.gameId).filter(Boolean) as string[]);
    const tourGames = opts.games.filter(
      (g) => gameIds.has(g.gameId) || String(g.homeTeamCode || '').toUpperCase() === tour
    );
    const key = getSecondaryPropsCacheKey(sport);
    try {
      if (tourProps.length === 0) {
        if (opts.noTennisOdds) sessionStorage.removeItem(key);
        continue;
      }
      const existing = readSecondaryPropsSessionCache(sport);
      sessionStorage.setItem(
        key,
        JSON.stringify({
          props: preferTennisPropsForPaint(existing.props, tourProps),
          games: tourGames.length > 0 ? tourGames : existing.games,
          selectedGameIds: opts.selectedGameIds,
          timestamp: opts.now,
        })
      );
    } catch {
      // ignore quota
    }
  }
}

function getSecondaryPropsListUrl(sport: SecondaryPropsSport, debugStats: boolean, refresh = false): string {
  if (sport === 'atp' || sport === 'wta') {
    const params = new URLSearchParams();
    params.set('tour', sport === 'wta' ? 'WTA' : 'ATP');
    if (refresh) params.set('refresh', '1');
    return `/api/tennis/player-props/list?${params.toString()}`;
  }
  if (sport === 'nbl') {
    return '/api/nbl/player-props/list';
  }
  const base = '/api/afl/player-props/list';
  const params = new URLSearchParams();
  // Default enrich=true attaches cached L5/L10/H2H/Season/DvP when the pre-warmed snapshot is cold.
  if (debugStats) params.set('debugStats', '1');
  if (refresh) params.set('refresh', '1');
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function fetchSecondaryPropsList(url: string): Promise<Response> {
  const timeoutMs = 25_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

const AFL_PROPS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min – show cached list instantly when returning, refresh in background
const AFL_TEAM_LOGOS_CACHE_KEY = 'afl_team_logos_cache_v1';
const AFL_TEAM_LOGOS_CACHE_TS_KEY = 'afl_team_logos_cache_ts_v1';
const AFL_TEAM_LOGOS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
/** Mirror of AFL team logos in localStorage so they survive tab close/refresh (cache key + TS share TTL). */
const AFL_TEAM_LOGOS_LS_KEY = 'afl_team_logos_ls_v1';
const AFL_TEAM_LOGOS_LS_TS_KEY = 'afl_team_logos_ls_ts_v1';
const AFL_TEAM_LOGOS_LS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Mirror of resolved AFL portrait URLs (player name -> url) for fast cross-session paint. */
const AFL_PORTRAIT_EXTRAS_LS_KEY_PREFIX = 'st_afl_portrait_extras_ls_v';
const AFL_PORTRAIT_EXTRAS_LS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Tell the browser to prefetch an image URL so it lands in the HTTP cache before
 * the corresponding <img> renders. No-op for empty/invalid URLs and on the server.
 * Uses React 19's preload() to inject <link rel="preload" as="image"> when possible,
 * and falls back to a detached Image() so cache-warming still works in older runtimes.
 */
function warmImage(href: string | null | undefined): void {
  if (!href || typeof href !== 'string') return;
  const trimmed = href.trim();
  if (!trimmed) return;
  try {
    if (typeof reactPreload === 'function') {
      reactPreload(trimmed, { as: 'image' });
      return;
    }
  } catch {
    // fall through to Image() warm
  }
  if (typeof window === 'undefined') return;
  try {
    const img = new window.Image();
    img.decoding = 'async';
    img.src = trimmed;
  } catch {
    // ignore
  }
}

// Static sport logos used above the fold on the props page – warm immediately at module load
// so the browser fetches them in parallel with the JS bundle and they're ready on first paint.
if (typeof window !== 'undefined') {
  warmImage('/images/nba-logo.png');
  warmImage('/images/afl-logo.png');
  kickCombinedPropsEarlyFetch();
}

class LRUCache<T> {
  private cache = new Map<string, T>();
  private readonly maxSize: number;
  private accessOrder = new Map<string, number>();

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.accessOrder.set(key, Date.now());
    }
    return value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    this.cache.set(key, value);
    this.accessOrder.set(key, Date.now());
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.accessOrder.delete(key);
  }

  private evictLRU(): void {
    if (this.accessOrder.size === 0) return;

    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, time] of this.accessOrder.entries()) {
      if (time < lruTime) {
        lruTime = time;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.accessOrder.delete(lruKey);
    }
  }
}

const playerStatsCache = new LRUCache<any[]>(100);
const playerStatsPromiseCache = new LRUCache<Promise<any[]>>(50);

export default function NBALandingPage() {
  const router = useRouter();
  const { isDark, theme, setTheme } = useTheme();
  const {
    viewerId,
    userEmail,
    username,
    avatarUrl,
    isPro,
    subscriptionChecked,
    setUsername,
    setAvatarUrl,
  } = useViewerProfile({ loginRedirect: '/login' });
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [todaysGames, setTodaysGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);

  // Debounce search query to reduce filtering overhead
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    
    return () => clearTimeout(timer);
  }, [searchQuery]);
  
  // Initialize player props and loading state - always start with loading true to prevent hydration mismatch
  // We'll check sessionStorage in useEffect after mount
  const [playerProps, setPlayerProps] = useState<PlayerProp[]>([]);
  const [propsLoading, setPropsLoading] = useState(true);
  const [propsProcessing, setPropsProcessing] = useState(false); // Track if cache is empty but processing is happening
  const [showNoPropsMessage, setShowNoPropsMessage] = useState(false); // After 8s with no props, show "come back later"
  const [mounted, setMounted] = useState(false);
  const propsLoadedRef = useRef(false); // Track if props are already loaded to prevent redundant fetches
  const initialFetchCompletedRef = useRef(false); // Track if initial fetch has completed
  const playerPropsRef = useRef(playerProps);
  const [dropdownContainer, setDropdownContainer] = useState<HTMLElement | null>(null);
  const [navigatingToPlayer, setNavigatingToPlayer] = useState(false);
  const navigatingRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const PROPS_DESKTOP_SKELETON_ROW_HEIGHT_PX = 58;
  const PROPS_DESKTOP_SKELETON_TOP_OFFSET_PX = 210;
  const [desktopSkeletonRowCount, setDesktopSkeletonRowCount] = useState(20);
  // Load filter selections from localStorage on mount
  const loadFiltersFromStorage = () => {
    if (typeof window === 'undefined') {
      return {
        bookmakers: new Set<string>(),
        propTypes: new Set<string>(),
        games: new Set<number>()
      };
    }
    
    try {
      const savedBookmakers = localStorage.getItem('nba_filters_bookmakers');
      const savedPropTypes = localStorage.getItem('nba_filters_propTypes');
      const savedGames = localStorage.getItem('nba_filters_games');
      
      return {
        bookmakers: savedBookmakers ? new Set<string>(JSON.parse(savedBookmakers)) : new Set<string>(),
        propTypes: savedPropTypes ? new Set<string>(JSON.parse(savedPropTypes)) : new Set<string>(),
        games: savedGames ? new Set<number>(JSON.parse(savedGames)) : new Set<number>()
      };
    } catch (e) {
      console.warn('[NBA Landing] Failed to load filters from localStorage:', e);
      return {
        bookmakers: new Set<string>(),
        propTypes: new Set<string>(),
        games: new Set<number>()
      };
    }
  };

  const savedFilters = loadFiltersFromStorage();
  const [selectedBookmakers, setSelectedBookmakers] = useState<Set<string>>(savedFilters.bookmakers);
  const [selectedPropTypes, setSelectedPropTypes] = useState<Set<string>>(savedFilters.propTypes);
  const [selectedGames, setSelectedGames] = useState<Set<number>>(savedFilters.games);
  const [bookmakerDropdownOpen, setBookmakerDropdownOpen] = useState(false);
  const [propTypeDropdownOpen, setPropTypeDropdownOpen] = useState(false);
  const [gamesDropdownOpen, setGamesDropdownOpen] = useState(false);
  const [tennisMaxRank, setTennisMaxRank] = useState<number | null>(readTennisMaxRankFilter);
  const [propLineDropdownOpen, setPropLineDropdownOpen] = useState(false);
  const [propLineSort, setPropLineSort] = useState<'none' | 'high' | 'low'>('none');
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  currentPageRef.current = currentPage;
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const propsWarmReturnHandledRef = useRef(false);
  const filtersSectionRef = useRef<HTMLDivElement>(null);
  const [filterBottom, setFilterBottom] = useState(120);
  const lockedPositionRef = useRef<number | null>(null);
  const gamesButtonRef = useRef<HTMLButtonElement>(null);
  const propTypeButtonRef = useRef<HTMLButtonElement>(null);
  const bookmakerButtonRef = useRef<HTMLButtonElement>(null);

  const getMobileFilterDropdownStyle = (): React.CSSProperties => ({
    position: 'fixed',
    top: `${lockedPositionRef.current ?? filterBottom}px`,
    left: '1rem',
    right: '1rem',
    maxHeight: `calc(100vh - ${(lockedPositionRef.current ?? filterBottom) + 16}px)`,
    pointerEvents: 'auto',
    boxSizing: 'border-box',
  });

  // Lock position when dropdown opens - MOBILE ONLY - calculate once and never update
  useEffect(() => {
    if (!isMobile) return; // Desktop uses normal positioning
    
    const anyDropdownOpen = gamesDropdownOpen || bookmakerDropdownOpen || propTypeDropdownOpen;
    if (anyDropdownOpen) {
      if (filtersSectionRef.current && lockedPositionRef.current === null) {
        // Calculate position once when dropdown first opens
        const rect = filtersSectionRef.current.getBoundingClientRect();
        const lockedPosition = rect.bottom + 8;
        lockedPositionRef.current = lockedPosition;
        setFilterBottom(lockedPosition);
      }
    } else {
      // Reset when all dropdowns close
      lockedPositionRef.current = null;
    }
  }, [gamesDropdownOpen, bookmakerDropdownOpen, propTypeDropdownOpen, isMobile]);

  // Lock dropdown position on scroll - MOBILE ONLY - prevent any movement
  useEffect(() => {
    if (!isMobile) return; // Desktop uses normal positioning
    
    if (!gamesDropdownOpen && !bookmakerDropdownOpen && !propTypeDropdownOpen) {
      return;
    }
    
    if (lockedPositionRef.current === null) {
      return;
    }

    const lockPosition = () => {
      const dropdowns = document.querySelectorAll('[data-dropdown-locked]');
      dropdowns.forEach((dropdown) => {
        const el = dropdown as HTMLElement;
        if (lockedPositionRef.current !== null) {
          el.style.setProperty('top', `${lockedPositionRef.current}px`, 'important');
          el.style.setProperty('position', 'fixed', 'important');
        }
      });
    };

    // Lock position immediately
    lockPosition();
    
    // Lock position on scroll
    window.addEventListener('scroll', lockPosition, { passive: true });
    // Lock position on resize
    window.addEventListener('resize', lockPosition, { passive: true });
    
    // Also use requestAnimationFrame to continuously lock it
    let rafId: number;
    const lockLoop = () => {
      lockPosition();
      rafId = requestAnimationFrame(lockLoop);
    };
    rafId = requestAnimationFrame(lockLoop);

    return () => {
      window.removeEventListener('scroll', lockPosition);
      window.removeEventListener('resize', lockPosition);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [gamesDropdownOpen, bookmakerDropdownOpen, propTypeDropdownOpen, isMobile]);

  useEffect(() => {
    if (!isMobile || typeof document === 'undefined') return;

    const anyDropdownOpen = gamesDropdownOpen || bookmakerDropdownOpen || propTypeDropdownOpen;
    if (!anyDropdownOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousTouchAction = document.body.style.touchAction;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [gamesDropdownOpen, bookmakerDropdownOpen, propTypeDropdownOpen, isMobile]);

  // Track which popup is open: key is "playerName|statType|lineValue"
  const [openPopup, setOpenPopup] = useState<string | null>(null);
  // Column sorting state: column name -> 'none' | 'asc' | 'desc'
  const [columnSort, setColumnSort] = useState<Record<string, 'none' | 'asc' | 'desc'>>({
    dvp: 'none',
    l5: 'none',
    l10: 'none',
    h2h: 'none',
    season: 'none',
    streak: 'none',
    ip: 'none',
  });
  const handleColumnSort = (column: string) => {
    setColumnSort((prev) => {
      const current = prev[column] || 'none';
      const next = current === 'none' ? 'asc' : current === 'asc' ? 'desc' : 'none';
      const newSort: Record<string, 'none' | 'asc' | 'desc'> = {
        dvp: 'none',
        l5: 'none',
        l10: 'none',
        h2h: 'none',
        season: 'none',
        streak: 'none',
        ip: 'none',
      };
      newSort[column] = next;
      return newSort;
    });
  };

  // Odds format state - load from localStorage or default to 'american'
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>(DEFAULT_ODDS_FORMAT);

  // Props page sport: Combined (default) | NBA | AFL — restore explicit mode from URL when provided
  const [propsSport, setPropsSport] = useState<PropsSportMode>(defaultPropsSport());
  const [aflGames, setAflGames] = useState<AflGameForProps[]>([]);
  const [aflProps, setAflProps] = useState<PlayerProp[]>([]);
  const [tennisCombinedProps, setTennisCombinedProps] = useState<PlayerProp[]>([]);
  const tennisCombinedPropsRef = useRef<PlayerProp[]>([]);
  tennisCombinedPropsRef.current = tennisCombinedProps;
  const [nblCombinedProps, setNblCombinedProps] = useState<PlayerProp[]>([]);
  const nblCombinedPropsRef = useRef<PlayerProp[]>([]);
  nblCombinedPropsRef.current = nblCombinedProps;
  /** AFL slice parked while ATP/WTA is using the secondary list bucket. */
  const combinedAflHoldRef = useRef<{ props: PlayerProp[]; games: AflGameForProps[] } | null>(null);
  const aflPropsRef = useRef<PlayerProp[]>([]);
  aflPropsRef.current = aflProps;
  const aflGamesRef = useRef<AflGameForProps[]>([]);
  aflGamesRef.current = aflGames;
  const todaysGamesRef = useRef<Game[]>([]);
  todaysGamesRef.current = todaysGames;
  const propsSportRef = useRef<PropsSportMode>(propsSport);
  propsSportRef.current = propsSport;
  const combinedOddsFlagsRef = useRef<{ noAflOdds: boolean }>({
    noAflOdds: false,
  });
  const [aflPropsLoading, setAflPropsLoading] = useState(false);
  const [aflPropsFetchComplete, setAflPropsFetchComplete] = useState(false);
  const [combinedPropsLoading, setCombinedPropsLoading] = useState(false);
  const [combinedPropsFetchComplete, setCombinedPropsFetchComplete] = useState(false);
  const [combinedPaintUnlocked, setCombinedPaintUnlocked] = useState(false);
  const combinedPaintUnlockedRef = useRef(false);
  combinedPaintUnlockedRef.current = combinedPaintUnlocked;
  const aflPropsFetchCompleteRef = useRef(false);
  const combinedPropsFetchCompleteRef = useRef(false);
  const setCombinedFetchComplete = useCallback((complete: boolean) => {
    combinedPropsFetchCompleteRef.current = complete;
    setCombinedPropsFetchComplete(complete);
  }, []);
  /** Skip one combined API fetch after an instant warm sport toggle (AFL/tennis → combined). */
  const combinedWarmToggleRef = useRef(false);
  const combinedPartialAflRefetchAttemptedRef = useRef(false);
  const combinedPartialTennisRefetchAttemptedRef = useRef(false);
  const combinedFetchInFlightRef = useRef(false);
  const combinedLoadPromiseRef = useRef<Promise<void> | null>(null);
  /** Skip AFL/tennis list fetch after instant session-cache restore (persists through Strict Mode re-runs). */
  const secondarySkipFetchSportRef = useRef<SecondaryPropsSport | null>(null);
  /** Set when applySportMode hydrates secondary rows — fetch effect must not undo it. */
  const secondaryWarmHydrateRef = useRef(false);
  /** Authoritative secondary list sport — stale in-flight fetches must not apply after toggle. */
  const secondaryListSportRef = useRef<SecondaryPropsSport | null>(null);
  const aflRetryTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const aflListFetchInFlightRef = useRef<{
    sport: SecondaryPropsSport;
    promise: Promise<{
      games: AflGameForProps[];
      aggregated: PlayerProp[];
      ingestMessage?: string;
      lastUpdated?: string;
      nextUpdate?: string;
      noAflOdds?: boolean;
    }>;
  } | null>(null);
  const setSecondaryPropsFetchComplete = useCallback((complete: boolean) => {
    aflPropsFetchCompleteRef.current = complete;
    setAflPropsFetchComplete(complete);
  }, []);
  const [aflPropsRetryKey, setAflPropsRetryKey] = useState(0); // increment to refetch (e.g. after empty or user Retry)
  const [selectedAflGames, setSelectedAflGames] = useState<Set<string>>(new Set());
  const selectedAflGamesRef = useRef<Set<string>>(new Set());
  // If the user manually checks/unchecks games, don't let the async AFL list fetch overwrite their selection.
  const userModifiedAflGamesRef = useRef(false);
  const secondaryGameSelectionRef = useRef<Partial<Record<SecondaryPropsSport, SecondaryGameSelection>>>({});

  const rememberSecondaryGameSelection = useCallback((sport: PropsSportMode) => {
    if (!isSecondaryPropsSport(sport)) return;
    const ids = Array.from(selectedAflGamesRef.current);
    const userModified = userModifiedAflGamesRef.current === true;
    secondaryGameSelectionRef.current[sport] = { ids, userModified };
    try {
      const key = getSecondaryPropsCacheKey(sport);
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      sessionStorage.setItem(
        key,
        JSON.stringify({
          ...parsed,
          selectedGameIds: ids,
          userModifiedGames: userModified,
        })
      );
    } catch {
      // ignore quota / parse errors
    }
  }, []);

  const seedSecondaryGameSelection = useCallback((
    sport: SecondaryPropsSport,
    parsed?: { selectedGameIds?: string[]; userModifiedGames?: boolean }
  ) => {
    if (secondaryGameSelectionRef.current[sport]) return;
    if (!parsed) return;
    secondaryGameSelectionRef.current[sport] = {
      ids: Array.isArray(parsed.selectedGameIds) ? parsed.selectedGameIds : [],
      userModified: parsed.userModifiedGames === true,
    };
  }, []);

  const applyRememberedGameSelection = useCallback((sport: SecondaryPropsSport, availableIds: string[]) => {
    const available = new Set(availableIds.filter(Boolean));
    const saved = secondaryGameSelectionRef.current[sport];
    const userModified = saved?.userModified === true;
    userModifiedAflGamesRef.current = userModified;
    let next: Set<string>;
    if (userModified) {
      const overlap = (saved?.ids ?? []).filter((id) => available.has(id));
      next = overlap.length > 0 ? new Set(overlap) : available;
    } else {
      next = available;
    }
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
    return next;
  }, []);

  const mergeNbaPropsWithStoredCalculatedStats = useCallback((props: PlayerProp[]) => {
    const calculatedMap = new Map<string, PlayerProp>();
    const calculatedKeys: string[] = [];

    if (typeof window === 'undefined') {
      return { props, calculatedMap, calculatedKeys };
    }

    try {
      const stored = sessionStorage.getItem('nba-player-props-calculated-stats');
      if (!stored) return { props, calculatedMap, calculatedKeys };

      const calculatedStats = JSON.parse(stored);
      if (!Array.isArray(calculatedStats)) {
        return { props, calculatedMap, calculatedKeys };
      }

      calculatedStats.forEach((prop: PlayerProp) => {
        const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
        calculatedMap.set(key, prop);
        calculatedKeys.push(key);
      });

      return {
        props: props.map((prop: PlayerProp) => {
          const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
          const calculated = calculatedMap.get(key);
          if (!calculated) return prop;

          return {
            ...prop,
            h2hAvg: calculated.h2hAvg ?? prop.h2hAvg,
            seasonAvg: calculated.seasonAvg ?? prop.seasonAvg,
            h2hHitRate: calculated.h2hHitRate ?? prop.h2hHitRate,
            seasonHitRate: calculated.seasonHitRate ?? prop.seasonHitRate,
          };
        }),
        calculatedMap,
        calculatedKeys,
      };
    } catch {
      return { props, calculatedMap, calculatedKeys: [] };
    }
  }, []);

  const aggregateSecondaryListPayload = useCallback((listData: any, sport: SecondaryPropsSport) => {
    const tennisTour = tennisTourFromPropsSport(sport);
    const tennisLogo = tennisTour ? tennisLogoForTour(tennisTour) : null;
    const rawGames: AflGameForProps[] = Array.isArray(listData?.games) ? listData.games : [];
    const games: AflGameForProps[] = tennisTour
      ? rawGames.map((g) => ({
          ...g,
          homeTeamCode: tennisTour,
          awayTeamCode: tennisTour,
          homeTeamLogo: tennisLogo,
          awayTeamLogo: tennisLogo,
        }))
      : rawGames;
    const rawRows: any[] = Array.isArray(listData?.data) ? listData.data : [];
    const rows = rawRows;
    const normalizeTeamDisplay = (team: string) =>
      sport === 'afl' ? toOfficialAflTeamDisplayName(team || '') : String(team || '').trim();
    const keyToRow = new Map<string, {
      playerName: string;
      gameId: string;
      homeTeam: string;
      awayTeam: string;
      homeTeamCode?: string | null;
      awayTeamCode?: string | null;
      homeTeamLogo?: string | null;
      awayTeamLogo?: string | null;
      playerTeam?: string | null;
      opponentName?: string | null;
      statType: string;
      line: number;
      commenceTime: string;
      bookmakerLines: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }>;
      last5Avg?: number | null;
      last10Avg?: number | null;
      h2hAvg?: number | null;
      seasonAvg?: number | null;
      streak?: number | null;
      last5HitRate?: { hits: number; total: number } | null;
      last10HitRate?: { hits: number; total: number } | null;
      h2hHitRate?: { hits: number; total: number } | null;
      seasonHitRate?: { hits: number; total: number } | null;
      dvpRating?: number | null;
      dvpStatValue?: number | null;
      dvpFieldSize?: number | null;
      headshotUrl?: string | null;
      playerId?: string | null;
      teamId?: string | null;
      opponentTeamId?: string | null;
      aflFantasyPosition?: 'DEF' | 'MID' | 'FWD' | 'RUC' | null;
      aflDfsRole?: string | null;
      nblPosition?: string | null;
      nblPlayType?: string | null;
      playerIoc?: string | null;
      playerRank?: number | null;
      opponentId?: string | null;
      opponentIoc?: string | null;
      opponentRank?: number | null;
      playerSeed?: number | null;
      opponentSeed?: number | null;
      playerDrawRank?: number | null;
      opponentDrawRank?: number | null;
      tournamentName?: string | null;
      surface?: string | null;
    }>();

    for (const r of rows) {
      const key = `${r.playerName}|${r.gameId}|${r.statType}|${r.line}`;
      const existing = keyToRow.get(key);
      const bl = { bookmaker: r.bookmaker, line: r.line, overOdds: r.overOdds || 'N/A', underOdds: r.underOdds || 'N/A' };
      const incomingLines =
        Array.isArray(r.bookmakerLines) && r.bookmakerLines.length > 0
          ? r.bookmakerLines.map((line: { bookmaker?: string; line?: number; overOdds?: string; underOdds?: string }) => ({
              bookmaker: line.bookmaker || r.bookmaker,
              line: typeof line.line === 'number' ? line.line : r.line,
              overOdds: line.overOdds || r.overOdds || 'N/A',
              underOdds: line.underOdds || r.underOdds || 'N/A',
            }))
          : [bl];
      if (existing) {
        for (const line of incomingLines) {
          const duplicate = existing.bookmakerLines.some(
            (row) => row.bookmaker === line.bookmaker && row.line === line.line
          );
          if (!duplicate) existing.bookmakerLines.push(line);
        }
        if (!existing.opponentName && typeof r.opponent === 'string') {
          existing.opponentName = r.opponent;
        }
        if (!existing.aflFantasyPosition && r.aflFantasyPosition) {
          existing.aflFantasyPosition = r.aflFantasyPosition;
        }
        if (!existing.aflDfsRole && r.aflDfsRole) {
          existing.aflDfsRole = r.aflDfsRole;
        }
        if (!existing.nblPosition && r.nblPosition) {
          existing.nblPosition = r.nblPosition;
        }
        if (!existing.nblPlayType && r.nblPlayType) {
          existing.nblPlayType = r.nblPlayType;
        }
        if (!existing.opponentId && r.opponentId != null) {
          existing.opponentId = String(r.opponentId);
        }
        if (!existing.opponentIoc && r.opponentIoc) {
          existing.opponentIoc = r.opponentIoc;
        }
      } else {
        keyToRow.set(key, {
          playerName: r.playerName,
          gameId: r.gameId,
          homeTeam: r.homeTeam,
          awayTeam: r.awayTeam,
          homeTeamCode: r.homeTeamCode ?? null,
          awayTeamCode: r.awayTeamCode ?? null,
          homeTeamLogo: r.homeTeamLogo ?? null,
          awayTeamLogo: r.awayTeamLogo ?? null,
          playerTeam: r.playerTeam ?? null,
          opponentName: typeof r.opponent === 'string' ? r.opponent : null,
          statType: r.statType,
          line: r.line,
          commenceTime: r.commenceTime || r.gameDate || '',
          bookmakerLines: incomingLines,
          last5Avg: r.last5Avg,
          last10Avg: r.last10Avg,
          h2hAvg: r.h2hAvg,
          seasonAvg: r.seasonAvg,
          streak: r.streak,
          last5HitRate: r.last5HitRate,
          last10HitRate: r.last10HitRate,
          h2hHitRate: r.h2hHitRate,
          seasonHitRate: r.seasonHitRate,
          dvpRating: r.dvpRating,
          dvpStatValue: r.dvpStatValue,
          dvpFieldSize: r.dvpFieldSize,
          headshotUrl: r.headshotUrl ?? null,
          playerId: r.playerId != null ? String(r.playerId) : null,
          teamId: r.teamId != null ? String(r.teamId) : null,
          opponentTeamId: r.opponentTeamId != null ? String(r.opponentTeamId) : null,
          aflFantasyPosition: r.aflFantasyPosition ?? null,
          aflDfsRole: r.aflDfsRole ?? null,
          nblPosition: r.nblPosition ?? null,
          nblPlayType: r.nblPlayType ?? null,
          playerIoc: r.playerIoc ?? null,
          playerRank: r.playerRank ?? null,
          opponentId: r.opponentId != null ? String(r.opponentId) : null,
          opponentIoc: r.opponentIoc ?? null,
          opponentRank: r.opponentRank ?? null,
          playerSeed: r.playerSeed ?? null,
          opponentSeed: r.opponentSeed ?? null,
          playerDrawRank: r.playerDrawRank ?? null,
          opponentDrawRank: r.opponentDrawRank ?? null,
          tournamentName: r.tournamentName ?? null,
          surface: r.surface ?? null,
        });
      }
    }

    const aggregated: PlayerProp[] = Array.from(keyToRow.values()).map((a) => {
      const playerTeam = a.playerTeam && String(a.playerTeam).trim() ? a.playerTeam : null;
      const homeNorm = normalizeTeamDisplay(a.homeTeam || '');
      const awayNorm = normalizeTeamDisplay(a.awayTeam || '');
      const playerNorm = playerTeam ? normalizeTeamDisplay(playerTeam) : null;
      const tennisOpponent = String(a.opponentName || '').trim();
      const playerKey = String(a.playerName || '').trim().toLowerCase();
      const homeKey = String(a.homeTeam || '').trim().toLowerCase();
      const team = isTennisPropsSport(sport) ? (playerTeam || '') : (playerNorm || homeNorm);
      const opponent =
        isTennisPropsSport(sport)
          ? tennisOpponent || (playerKey && playerKey === homeKey ? awayNorm : homeNorm)
          : playerNorm
            ? (playerNorm === homeNorm ? awayNorm : playerNorm === awayNorm ? homeNorm : awayNorm)
            : awayNorm;

      return {
        playerName: a.playerName,
        playerId:
          isTennisPropsSport(sport)
            ? String(a.playerId || '')
            : a.playerId && /^\d+$/.test(a.playerId)
              ? a.playerId
              : '',
        team,
        opponent,
        statType: a.statType,
        line: a.line,
        overProb: 0,
        underProb: 0,
        overOdds: a.bookmakerLines[0]?.overOdds ?? 'N/A',
        underOdds: a.bookmakerLines[0]?.underOdds ?? 'N/A',
        impliedOverProb: 0,
        impliedUnderProb: 0,
        bestLine: a.line,
        bookmaker: a.bookmakerLines[0]?.bookmaker ?? '',
        confidence: 'Medium',
        gameDate: a.commenceTime,
        bookmakerLines: a.bookmakerLines,
        gameId: a.gameId,
        homeTeam: a.homeTeam,
        awayTeam: a.awayTeam,
        homeTeamCode: tennisTour || a.homeTeamCode || null,
        awayTeamCode: tennisTour || a.awayTeamCode || null,
        homeTeamLogo: tennisLogo || a.homeTeamLogo || null,
        awayTeamLogo: tennisLogo || a.awayTeamLogo || null,
        last5Avg: a.last5Avg,
        last10Avg: a.last10Avg,
        h2hAvg: a.h2hAvg,
        seasonAvg: a.seasonAvg,
        streak: a.streak,
        last5HitRate: a.last5HitRate,
        last10HitRate: a.last10HitRate,
        h2hHitRate: a.h2hHitRate,
        seasonHitRate: a.seasonHitRate,
        dvpRating: a.dvpRating,
        dvpStatValue: a.dvpStatValue,
        dvpFieldSize: a.dvpFieldSize,
        headshotUrl: a.headshotUrl ?? null,
        aflFantasyPosition: a.aflFantasyPosition ?? null,
        aflDfsRole: a.aflDfsRole ?? null,
        nblPosition: a.nblPosition ?? null,
        nblPlayType: a.nblPlayType ?? null,
        playerTeam,
        playerIoc: a.playerIoc ?? null,
        playerRank: a.playerRank ?? null,
        opponentId: a.opponentId ?? null,
        opponentIoc: a.opponentIoc ?? null,
        opponentRank: a.opponentRank ?? null,
        playerSeed: a.playerSeed ?? null,
        opponentSeed: a.opponentSeed ?? null,
        playerDrawRank: a.playerDrawRank ?? null,
        opponentDrawRank: a.opponentDrawRank ?? null,
        tournamentName: a.tournamentName ?? null,
        surface: a.surface ?? null,
      };
    });

    let finalGames = games;
    let finalAggregated = aggregated;
    let noOdds =
      listData?.noAflOdds === true ||
      listData?.noTennisOdds === true;
    let ingestMessage =
      typeof listData?.ingestMessage === 'string' ? listData.ingestMessage : undefined;

    if (sport === 'afl') {
      const live = applyLiveAflPropsCutoff(aggregated, games);
      finalGames = live.games;
      finalAggregated = live.props;
      // Never resurrect stale rows past the live kickoff window — that leaves ingestMessage
      // saying "Fetched N stats" while the UI filters every row out (empty list + Try again).
      if (live.noAflOdds || live.props.length === 0) {
        noOdds = true;
        ingestMessage = AFL_USER_NO_ODDS;
      } else if (typeof listData?.ingestMessage === 'string') {
        ingestMessage = listData.ingestMessage;
      }
    }

    if (isTennisPropsSport(sport)) {
      finalAggregated = collapseTennisRowsToPrimaryMarketLine(finalAggregated);
    }

    return {
      games: finalGames,
      aggregated: finalAggregated,
      ingestMessage,
      lastUpdated: typeof listData?.lastUpdated === 'string' ? listData.lastUpdated : undefined,
      nextUpdate: typeof listData?.nextUpdate === 'string' ? listData.nextUpdate : undefined,
      noAflOdds: noOdds,
      debugMeta: listData?._meta as Record<string, unknown> | null | undefined,
    };
  }, []);

  const aggregateAflListPayload = useCallback(
    (listData: any) => aggregateSecondaryListPayload(listData, 'afl'),
    [aggregateSecondaryListPayload]
  );

  const syncSelectedAflGames = useCallback((nextGameIds: string[]) => {
    const nextSet = new Set(nextGameIds.filter(Boolean));
    const sport = isSecondaryPropsSport(propsSportRef.current) ? propsSportRef.current : null;
    const saved = sport ? secondaryGameSelectionRef.current[sport] : undefined;
    const userModified = saved?.userModified === true || userModifiedAflGamesRef.current === true;
    userModifiedAflGamesRef.current = userModified;
    if (!userModified) {
      selectedAflGamesRef.current = nextSet;
      setSelectedAflGames(nextSet);
      return;
    }
    const remembered = saved?.ids ?? Array.from(selectedAflGamesRef.current);
    const out = new Set<string>();
    for (const id of remembered) {
      if (nextSet.has(id)) out.add(id);
    }
    // Keep empty when the user intentionally cleared all games.
    selectedAflGamesRef.current = out;
    setSelectedAflGames(out);
  }, []);

  const getSelectedAflGameIdsForCache = useCallback((candidateGameIds: string[]) => {
    if (!userModifiedAflGamesRef.current) return candidateGameIds;
    const candidateSet = new Set(candidateGameIds);
    const current = Array.from(selectedAflGamesRef.current);
    const filtered = current.filter((id) => candidateSet.has(id));
    return filtered.length > 0 ? filtered : candidateGameIds;
  }, []);

  const persistCombinedSnapshotCaches = useCallback((snapshot: CombinedPropsSnapshotResponse) => {
    if (typeof window === 'undefined') return;

    const persist = () => {
      try {
        const now = Date.now();
        const paintSnapshot = slimCombinedPropsSnapshotForClient(snapshot as CombinedPropsSnapshot);
        const nbaProps = Array.isArray(paintSnapshot?.nba?.props) ? paintSnapshot.nba.props : [];
        const aflPropsForCache = Array.isArray(paintSnapshot?.afl?.props) ? paintSnapshot.afl.props : [];
        const aflGamesForCache = Array.isArray(paintSnapshot?.afl?.games) ? paintSnapshot.afl.games : [];
        const selectedGameIds = getSelectedAflGameIdsForCache(aflGamesForCache.map((game) => game.gameId));
        const tennisPropsForCache = Array.isArray(paintSnapshot?.tennis?.props) ? paintSnapshot.tennis.props : [];
        const tennisGamesForCache = Array.isArray(paintSnapshot?.tennis?.games) ? paintSnapshot.tennis.games : [];
        const existingCombined = readCombinedSnapshotBrowserCache();
        const existingCombinedTennis = Array.isArray(existingCombined?.tennis?.props)
          ? existingCombined.tennis.props
          : [];
        const mergedTennisProps = preferTennisPropsForPaint(existingCombinedTennis, tennisPropsForCache);
        if (paintSnapshot?.tennis && mergedTennisProps.length > 0) {
          paintSnapshot.tennis = { ...paintSnapshot.tennis, props: mergedTennisProps };
        }

        sessionStorage.setItem(
          COMBINED_PROPS_CACHE_KEY,
          JSON.stringify({
            ...paintSnapshot,
            selectedGameIds,
            timestamp: now,
          })
        );
        try {
          const combinedJson = JSON.stringify({ ...paintSnapshot, selectedGameIds });
          localStorage.setItem(COMBINED_PROPS_LS_KEY, combinedJson);
          localStorage.setItem(COMBINED_PROPS_LS_TS_KEY, now.toString());
        } catch {
          // localStorage quota — session cache still works for this tab
        }

        if (nbaProps.length > 0) {
          sessionStorage.setItem('nba-player-props-cache', JSON.stringify(nbaProps));
          sessionStorage.setItem('nba-player-props-cache-timestamp', now.toString());
        }

        if (snapshot?.afl?.noAflOdds) {
          sessionStorage.removeItem(AFL_PROPS_CACHE_KEY);
        } else if (aflPropsForCache.length > 0 || aflGamesForCache.length > 0) {
          let writeAflCache = true;
          try {
            const existingRaw = sessionStorage.getItem(AFL_PROPS_CACHE_KEY);
            if (existingRaw) {
              const existingParsed = JSON.parse(existingRaw) as { props?: PlayerProp[] };
              const existingProps = Array.isArray(existingParsed?.props) ? existingParsed.props : [];
              const existingCoverage = aflPropsHistoricalStatsCoverage(existingProps);
              const incomingCoverage = aflPropsHistoricalStatsCoverage(aflPropsForCache);
              if (
                existingCoverage >= AFL_HISTORICAL_STATS_MIN_COVERAGE &&
                incomingCoverage < existingCoverage
              ) {
                writeAflCache = false;
              }
            }
          } catch {
            // keep writeAflCache true
          }
          // Never lock the AFL tab onto a mostly-N/A snapshot.
          if (
            writeAflCache &&
            aflPropsForCache.some(isAflCombinedListProp) &&
            aflPropsHistoricalStatsCoverage(aflPropsForCache) < AFL_HISTORICAL_STATS_MIN_COVERAGE
          ) {
            writeAflCache = false;
          }
          if (writeAflCache) {
            sessionStorage.setItem(
              AFL_PROPS_CACHE_KEY,
              JSON.stringify({
                props: aflPropsForCache,
                games: aflGamesForCache,
                selectedGameIds,
                userModifiedGames:
                  propsSportRef.current === 'afl' && userModifiedAflGamesRef.current === true,
                timestamp: now,
              })
            );
          }
        }

        writeTennisTourSessionCaches({
          props: mergedTennisProps.length > 0 ? mergedTennisProps : tennisPropsForCache,
          games: tennisGamesForCache,
          selectedGameIds,
          now,
          noTennisOdds: paintSnapshot?.tennis?.noTennisOdds === true,
        });

        const nblPropsForCache = Array.isArray(paintSnapshot?.nbl?.props) ? paintSnapshot.nbl.props : [];
        const nblGamesForCache = Array.isArray(paintSnapshot?.nbl?.games) ? paintSnapshot.nbl.games : [];
        if (paintSnapshot?.nbl?.noNblOdds) {
          sessionStorage.removeItem(NBL_PROPS_CACHE_KEY);
        } else if (nblPropsForCache.length > 0 || nblGamesForCache.length > 0) {
          const existingNbl = readSecondaryPropsSessionCache('nbl');
          const mergedNblGames = mergeSecondaryGames(existingNbl.games, nblGamesForCache);
          const mergedNblProps = preferNblPropsForPaint(existingNbl.props, nblPropsForCache);
          const rememberedNbl = secondaryGameSelectionRef.current.nbl;
          const nblSelectedIds =
            rememberedNbl?.userModified === true
              ? rememberedNbl.ids.filter((id) => mergedNblGames.some((game) => game.gameId === id))
              : mergedNblGames.map((game) => game.gameId);
          sessionStorage.setItem(
            NBL_PROPS_CACHE_KEY,
            JSON.stringify({
              props: mergedNblProps.length > 0 ? mergedNblProps : nblPropsForCache,
              games: mergedNblGames.length > 0 ? mergedNblGames : nblGamesForCache,
              selectedGameIds: nblSelectedIds.length > 0 ? nblSelectedIds : mergedNblGames.map((game) => game.gameId),
              userModifiedGames: rememberedNbl?.userModified === true,
              timestamp: now,
            })
          );
        }
      } catch {
        // Ignore session cache write failures.
      }
    };

    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;

    if (typeof requestIdle === 'function') {
      requestIdle(persist, { timeout: 1000 });
    } else {
      window.setTimeout(persist, 0);
    }
  }, [getSelectedAflGameIdsForCache]);

  const applyCombinedSnapshot = useCallback((
    combinedSnapshot: CombinedPropsSnapshotResponse,
    options?: {
      persistCaches?: boolean;
      selectedGameIds?: string[];
      preserveAflProps?: PlayerProp[];
      preserveAflGames?: AflGameForProps[];
    }
  ) => {
    const nbaRows = Array.isArray(combinedSnapshot?.nba?.props) ? combinedSnapshot.nba.props : [];
    const snapshotAflGames = Array.isArray(combinedSnapshot?.afl?.games) ? combinedSnapshot.afl.games : [];
    const snapshotAflProps = Array.isArray(combinedSnapshot?.afl?.props) ? combinedSnapshot.afl.props : [];
    const preserveAflProps = Array.isArray(options?.preserveAflProps)
      ? options.preserveAflProps
      : aflPropsRef.current;
    const preserveAflGames = Array.isArray(options?.preserveAflGames) ? options.preserveAflGames : [];
    const aflPropsNext = preferAflPropsForCombined(preserveAflProps, snapshotAflProps);
    const aflGamesNext =
      preserveAflGames.length > 0 && snapshotAflGames.length === 0
        ? preserveAflGames
        : snapshotAflGames.length > 0
          ? snapshotAflGames
          : preserveAflGames;
    const tennisPropsFromSnapshot = Array.isArray(combinedSnapshot?.tennis?.props)
      ? combinedSnapshot.tennis.props.filter(isTennisListProp)
      : null;
    const tennisPropsNext =
      tennisPropsFromSnapshot ?? tennisCombinedPropsRef.current.filter(isTennisListProp);
    const snapshotNoAflOdds = combinedSnapshot?.afl?.noAflOdds === true;
    combinedOddsFlagsRef.current = {
      noAflOdds: snapshotNoAflOdds && aflPropsNext.length === 0,
    };
    const oddsFlagsNext = combinedOddsFlagsRef.current;
    const noAflOdds = oddsFlagsNext.noAflOdds;
    const mergedNba = mergeNbaPropsWithStoredCalculatedStats(nbaRows);

    propsLoadedRef.current = mergedNba.props.length > 0;
    initialFetchCompletedRef.current = true;
    mergedNba.calculatedKeys.forEach((key) => calculatedKeysRef.current.add(key));

    const nblFromSnapshot = Array.isArray(combinedSnapshot?.nbl?.props)
      ? combinedSnapshot.nbl.props
      : null;
    const nblPropsNext =
      nblFromSnapshot && nblFromSnapshot.length > 0
        ? nblFromSnapshot
        : nblCombinedPropsRef.current.filter(isNblListProp);
    const combinedVisible = combinedModeHasVisibleRows(
      mergedNba.props,
      aflPropsNext,
      tennisPropsNext,
      nblPropsNext
    );
    const { missingAfl } = combinedModeMissingSecondarySlice(
      aflPropsNext,
      combinedOddsFlagsRef.current
    );
    const combinedComplete = combinedVisible && !missingAfl;
    const paintUnlocked =
      isCombinedSecondaryPaintReady(aflPropsNext, oddsFlagsNext) || combinedVisible;

    const activeSport = propsSportRef.current;
    const keepSecondaryList = isTennisPropsSport(activeSport) || isNblPropsSport(activeSport);

    setPlayerProps(mergedNba.props);
    setPropsWithCalculatedStats(mergedNba.calculatedMap);
    setPropsLoading(false);
    setPropsProcessing(false);

    if (!keepSecondaryList) {
      setAflGames((prev) => {
        const mergedGames =
          preserveAflGames.length > 0 && snapshotAflGames.length === 0
            ? preserveAflGames
            : snapshotAflGames.length > 0
              ? snapshotAflGames
              : preserveAflGames;
        if (noAflOdds) return mergedGames;
        if (mergedGames.length > 0) return mergedGames;
        return prev;
      });
      setAflProps((prev) => {
        const merged = preferAflPropsForCombined(prev, aflPropsNext);
        if (noAflOdds && merged.length === 0) return [];
        if (merged.length > 0) return merged;
        return prev;
      });
    }
    if (nblFromSnapshot && nblFromSnapshot.length > 0) {
      const mergedNbl = preferNblPropsForPaint(nblCombinedPropsRef.current, nblFromSnapshot);
      setNblCombinedProps(mergedNbl);
      if (isNblPropsSport(activeSport)) {
        setAflProps((prev) => preferNblPropsForPaint(prev.filter(isNblListProp), mergedNbl));
        const nblGames = Array.isArray(combinedSnapshot?.nbl?.games) ? combinedSnapshot.nbl.games : [];
        if (nblGames.length > 0) setAflGames(nblGames);
      }
    } else if (combinedSnapshot?.nbl?.noNblOdds === true && nblCombinedPropsRef.current.length === 0) {
      setNblCombinedProps([]);
    }

    setTennisCombinedProps((prev) => {
      const keep = prev.filter(isTennisListProp);
      if (tennisPropsFromSnapshot != null && tennisPropsFromSnapshot.length > 0) {
        return preferTennisPropsForPaint(keep, tennisPropsFromSnapshot);
      }
      if (
        tennisPropsFromSnapshot != null &&
        combinedSnapshot?.tennis?.noTennisOdds === true &&
        keep.length === 0
      ) {
        return tennisPropsFromSnapshot;
      }
      return keep.length > 0 ? keep : tennisPropsNext;
    });
    if (!keepSecondaryList) {
      setAflIngestMessage(combinedSnapshot?.afl?.ingestMessage ?? null);
      setAflLastUpdated(combinedSnapshot?.afl?.lastUpdated ?? null);

      if (noAflOdds) {
        userModifiedAflGamesRef.current = false;
        syncSelectedAflGames([]);
      } else {
        const nextGameIds = aflGamesNext.map((game) => game.gameId);
        if (Array.isArray(options?.selectedGameIds)) {
          const nextGameIdSet = new Set(nextGameIds);
          const restoredSelection = new Set(options.selectedGameIds.filter((id) => nextGameIdSet.has(id)));
          selectedAflGamesRef.current = restoredSelection;
          setSelectedAflGames(restoredSelection);
        } else if (nextGameIds.length > 0) {
          syncSelectedAflGames(nextGameIds);
        }
      }

      setSecondaryPropsFetchComplete(true);
      setAflPropsLoading(false);
    }
    setCombinedFetchComplete(combinedComplete);
    setCombinedPropsLoading(!combinedVisible || missingAfl);
    setCombinedPaintUnlocked(paintUnlocked);

    if (options?.persistCaches !== false) {
      persistCombinedSnapshotCaches(combinedSnapshot);
    }
  }, [mergeNbaPropsWithStoredCalculatedStats, persistCombinedSnapshotCaches, setSecondaryPropsFetchComplete, syncSelectedAflGames, setCombinedFetchComplete]);

  // Re-unlock combined paint when returning to All with both slices already in memory.
  useEffect(() => {
    if (propsSport !== 'combined' || combinedPaintUnlocked) return;
    const ready = isCombinedSecondaryPaintReady(
      aflPropsRef.current,
      combinedOddsFlagsRef.current
    );
    if (ready) {
      setCombinedPaintUnlocked(true);
      setCombinedFetchComplete(true);
      setCombinedPropsLoading(false);
    }
  }, [propsSport, aflProps, combinedPaintUnlocked, setCombinedFetchComplete]);

  const skipPropsRefetchOnceRef = useRef(false);

  useEffect(() => {
    const unbind = bindPropsPageSnapshotGetter(() => {
      if (typeof window === 'undefined') return null;
      const sportParam = new URL(window.location.href).searchParams.get('sport');
      return {
        timestamp: Date.now(),
        sportParam,
        propsSport: propsSportRef.current,
        playerProps: playerPropsRef.current,
        aflProps: aflPropsRef.current,
        tennisCombinedProps: tennisCombinedPropsRef.current,
        nblCombinedProps: nblCombinedPropsRef.current,
        aflGames: aflGamesRef.current,
        todaysGames: todaysGamesRef.current,
        selectedAflGameIds: Array.from(selectedAflGamesRef.current),
        combinedPaintUnlocked: combinedPaintUnlockedRef.current,
        combinedFetchComplete: combinedPropsFetchCompleteRef.current,
        noAflOdds: combinedOddsFlagsRef.current.noAflOdds,
        scrollY: window.scrollY,
        currentPage: currentPageRef.current,
      };
    });
    return () => {
      abortAflPropsStatsBackfill();
      unbind();
    };
  }, []);

  useEffect(() => {
    if (pendingScrollRestoreRef.current == null) return;
    const y = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
    });
  }, []);
  /** AFL ingest status from list API (same as NBA: "Fetched X stats for Y season, Z games"). */
  const [aflIngestMessage, setAflIngestMessage] = useState<string | null>(null);
  const [aflLastUpdated, setAflLastUpdated] = useState<string | null>(null);
  // AFL player jumper numbers (name -> number) from league stats, for circle placeholder
  const [aflPlayerNumbers, setAflPlayerNumbers] = useState<Record<string, number>>({});
  // AFL team logos (normalized name -> url) for matchup display
  const [aflLogoByTeam, setAflLogoByTeam] = useState<Record<string, string>>({});
  const [nblLogoByTeam, setNblLogoByTeam] = useState<Record<string, string>>({});

  // Mobile bottom nav dropdown state
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [selectedSurveySport, setSelectedSurveySport] = useState<NextSportSurveyOption | null>(null);
  const [surveySubmitting, setSurveySubmitting] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [nblAnnouncementOpen, setNblAnnouncementOpen] = useState(false);
  const surveyStorageKey = useMemo(
    () => viewerId ? `${PROPS_NEXT_SPORT_SURVEY_STORAGE_PREFIX}:${viewerId}` : null,
    [viewerId]
  );
  const surveyEndsAtLabel = useMemo(() => {
    const parsed = new Date(PROPS_NEXT_SPORT_SURVEY_ENDS_AT);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, []);
  const isSurveyClosed = useMemo(() => Date.now() >= Date.parse(PROPS_NEXT_SPORT_SURVEY_ENDS_AT), []);

  const dismissNblAnnouncement = useCallback(() => {
    try {
      localStorage.setItem(PROPS_NBL_ANNOUNCEMENT_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage errors.
    }
    setNblAnnouncementOpen(false);
  }, []);

  const handleNextSportSurveySubmit = useCallback(async () => {
    if (!selectedSurveySport || surveySubmitting) {
      return;
    }

    setSurveySubmitting(true);
    setSurveyError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        throw new Error('Please sign in again and try once more.');
      }

      const response = await fetch('/api/props-sport-survey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          selectedSport: selectedSurveySport,
          sourcePage: 'props',
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to submit vote');
      }

      if (surveyStorageKey) {
        try {
          localStorage.setItem(
            surveyStorageKey,
            JSON.stringify({
              selectedSport: selectedSurveySport,
              submittedAt: new Date().toISOString(),
            })
          );
        } catch {
          // Ignore storage errors after a successful submit.
        }
      }

      setSurveyOpen(false);
    } catch (error) {
      setSurveyError(error instanceof Error ? error.message : 'Could not save your vote. Please try again.');
    } finally {
      setSurveySubmitting(false);
    }
  }, [selectedSurveySport, surveyStorageKey, surveySubmitting]);

  // Reset "user modified" flag when leaving AFL-only filter mode.
  useEffect(() => {
    if (!isSecondaryPropsSport(propsSport)) userModifiedAflGamesRef.current = false;
  }, [propsSport]);

  // Find player (not in props / no odds) modal: bottom-right on mobile, top-right on desktop
  const [findPlayerOpen, setFindPlayerOpen] = useState(false);
  const [findPlayerQuery, setFindPlayerQuery] = useState('');
  const [findPlayerResults, setFindPlayerResults] = useState<Array<{ name: string; team?: string; playerId?: string }>>([]);
  const [findPlayerLoading, setFindPlayerLoading] = useState(false);
  const findPlayerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);
  const journalDropdownRef = useRef<HTMLDivElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setMounted(true);
    try {
      // Notifications are disabled globally; clear any legacy entries.
      localStorage.removeItem(NOTIFICATION_STORAGE_KEY);
      localStorage.removeItem('stattrackr-popup-shown');
      localStorage.removeItem('afl_launch_popup_dismissed_v1');
    } catch {
      // ignore storage errors
    }
    // Set dropdown container to document.body for portal rendering
    if (typeof document !== 'undefined') {
      setDropdownContainer(document.body);
    }
    
    // Detect mobile viewport
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    const updateDesktopSkeletonRows = () => {
      const available = Math.max(window.innerHeight - PROPS_DESKTOP_SKELETON_TOP_OFFSET_PX, 640);
      const rows = Math.ceil(available / PROPS_DESKTOP_SKELETON_ROW_HEIGHT_PX) + 6;
      setDesktopSkeletonRowCount(Math.min(Math.max(rows, 18), 56));
    };
    checkMobile();
    updateDesktopSkeletonRows();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('resize', updateDesktopSkeletonRows);
    
    // Load odds format from localStorage
    setOddsFormat(readOddsFormatPreference());
    
    // Restore sport from URL when explicitly set; default launch stays combined mode (AFL-only in offseason).
    // Only set AFL loading true if we don't have cache (useLayoutEffect may have already restored cache and set loading false)
    if (typeof window !== 'undefined') {
      clearPropsReturnSport();
      const url = new URL(window.location.href);
      const sportParam = url.searchParams.get('sport');
      const resolvedSport = resolvePropsSportParam(sportParam);

      if (!TENNIS_PUBLIC_ENABLED && isTennisSportParam(sportParam)) {
        const params = new URLSearchParams(url.search);
        params.set('sport', 'all');
        window.history.replaceState(null, '', `/props?${params.toString()}`);
      }
      if (resolvedSport === 'combined' && sportParam !== 'all') {
        const params = new URLSearchParams(url.search);
        params.set('sport', 'all');
        window.history.replaceState(null, '', `/props?${params.toString()}`);
      }
      if (resolvedSport === 'nba') {
        setPropsSport('nba');
      } else if (resolvedSport === 'afl') {
        setPropsSport('afl');
        try {
          const raw = sessionStorage.getItem(AFL_PROPS_CACHE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { timestamp?: number };
            const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
            if (age >= AFL_PROPS_CACHE_TTL_MS) setAflPropsLoading(true);
          } else {
            setAflPropsLoading(true);
          }
        } catch {
          setAflPropsLoading(true);
        }
        // Keep sport=afl in URL so refresh stays on AFL
      } else if (resolvedSport === 'nbl') {
        setPropsSport('nbl');
        try {
          const raw = sessionStorage.getItem(getSecondaryPropsCacheKey('nbl'));
          if (raw) {
            const parsed = JSON.parse(raw) as { timestamp?: number };
            const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
            if (age >= AFL_PROPS_CACHE_TTL_MS) setAflPropsLoading(true);
          } else {
            setAflPropsLoading(true);
          }
        } catch {
          setAflPropsLoading(true);
        }
      } else if (isTennisPropsSport(resolvedSport)) {
        setPropsSport(resolvedSport);
        try {
          const raw = sessionStorage.getItem(getSecondaryPropsCacheKey(resolvedSport));
          if (raw) {
            const parsed = JSON.parse(raw) as { timestamp?: number };
            const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
            if (age >= AFL_PROPS_CACHE_TTL_MS) setAflPropsLoading(true);
          } else {
            setAflPropsLoading(true);
          }
        } catch {
          setAflPropsLoading(true);
        }
      } else if (sportParam === 'combined' || sportParam === 'all') {
        setPropsSport('combined');
      }
      // When coming back from AFL dashboard "Back to Player Props", clear the search
      // filter and debounced value so the next search (e.g. same player name) runs correctly.
      try {
        if (sessionStorage.getItem('afl_back_to_props_clear_search') === '1') {
          sessionStorage.removeItem('afl_back_to_props_clear_search');
          setSearchQuery('');
          setDebouncedSearchQuery('');
        }

      } catch {}
      const hasPlayerParams = url.searchParams.has('player') ||
                              url.searchParams.has('pid') ||
                              url.searchParams.has('name') ||
                              url.searchParams.has('stat') ||
                              url.searchParams.has('line');

      if (hasPlayerParams) {
        // Clear player-related parameters to ensure clean state
        url.searchParams.delete('player');
        url.searchParams.delete('pid');
        url.searchParams.delete('name');
        url.searchParams.delete('stat');
        url.searchParams.delete('line');
        url.searchParams.delete('tf');
        url.searchParams.delete('mode');

        // Update URL without page reload
        window.history.replaceState({}, '', url.toString());
        // Debug logging removed('[NBA Landing] 🧹 Cleared player-related URL parameters');
      }

      // Also clear any dashboard session storage to prevent stale state
      try {
        sessionStorage.removeItem('nba_dashboard_session_v1');
        sessionStorage.removeItem('last_prop_click');
        sessionStorage.removeItem('last_prop_url');
      } catch (e) {
        // Ignore errors
      }
    }
    
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('resize', updateDesktopSkeletonRows);
    };
  }, []);

  // Run before paint: restore from sessionStorage so first paint shows cache (no loading flash)
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    let sportParam = url.searchParams.get('sport');
    if (sportParam == null) {
      const storedReturn = consumePropsReturnSport();
      if (storedReturn) {
        const returnPath = propsPathForSport(storedReturn);
        window.history.replaceState(null, '', returnPath);
        sportParam = new URL(returnPath, window.location.origin).searchParams.get('sport');
      }
    }
    const requiresCombinedFirstPaint =
      sportParam === null || sportParam === 'combined' || sportParam === 'all';
    let restoredNbaCache = false;
    let restoredAflCache = false;
    let restoredCombinedSnapshot = false;
    let paintedNbaProps: PlayerProp[] = [];
    let paintedAflProps: PlayerProp[] = [];
    let paintedTennisProps: PlayerProp[] = [];
    let paintedNoAflOdds = false;

    // 1) Restore sport from URL when explicitly provided
    const resolvedSport = resolvePropsSportParam(sportParam);
    const urlSpecifiesSport =
      sportParam != null && sportParam !== 'all' && sportParam !== 'combined';
    if (resolvedSport === 'nba') {
      setPropsSport('nba');
    } else if (resolvedSport === 'afl') {
      setPropsSport('afl');
      secondaryListSportRef.current = 'afl';
    } else if (resolvedSport === 'nbl') {
      setPropsSport('nbl');
      secondaryListSportRef.current = 'nbl';
    } else if (isTennisPropsSport(resolvedSport)) {
      setPropsSport(resolvedSport);
      secondaryListSportRef.current = resolvedSport;
    } else if (resolvedSport === 'combined') {
      setPropsSport('combined');
    }

    const forceRefresh = url.searchParams.get('refresh') === '1';
    if (forceRefresh) clearPropsPageWarmSnapshot();

    const warmSnapshot = !forceRefresh ? takePropsBackNavWarmSnapshot(sportParam) : null;
    if (warmSnapshot) {
      skipPropsRefetchOnceRef.current = true;
      combinedWarmToggleRef.current = true;
      propsLoadedRef.current = (warmSnapshot.playerProps as PlayerProp[]).length > 0;
      initialFetchCompletedRef.current = true;
      combinedOddsFlagsRef.current = {
        noAflOdds: warmSnapshot.noAflOdds,
      };
      if (!urlSpecifiesSport) {
        const restoredSport = resolvePropsSportParam(String(warmSnapshot.propsSport));
        setPropsSport(restoredSport);
        if (restoredSport === 'afl') secondaryListSportRef.current = 'afl';
        if (isTennisPropsSport(restoredSport)) secondaryListSportRef.current = restoredSport;
        if (restoredSport === 'nbl') secondaryListSportRef.current = 'nbl';
        
      }
      setPlayerProps(warmSnapshot.playerProps as PlayerProp[]);
      setAflProps(warmSnapshot.aflProps as PlayerProp[]);
      setTennisCombinedProps(
        Array.isArray(warmSnapshot.tennisCombinedProps)
          ? (warmSnapshot.tennisCombinedProps as PlayerProp[])
          : []
      );
      setNblCombinedProps(
        Array.isArray(warmSnapshot.nblCombinedProps)
          ? (warmSnapshot.nblCombinedProps as PlayerProp[]).filter(isNblListProp)
          : []
      );
      setAflGames(warmSnapshot.aflGames as AflGameForProps[]);
      setTodaysGames(warmSnapshot.todaysGames as Game[]);
      selectedAflGamesRef.current = new Set(warmSnapshot.selectedAflGameIds);
      setSelectedAflGames(new Set(warmSnapshot.selectedAflGameIds));
      setCombinedPaintUnlocked(warmSnapshot.combinedPaintUnlocked);
      setCombinedFetchComplete(warmSnapshot.combinedFetchComplete);
      setCombinedPropsLoading(false);
      setPropsLoading(false);
      setAflPropsLoading(false);
      setSecondaryPropsFetchComplete(true);
      setGamesLoading(false);
      setCurrentPage(warmSnapshot.currentPage);
      pendingScrollRestoreRef.current = warmSnapshot.scrollY;
      paintedNbaProps = warmSnapshot.playerProps as PlayerProp[];
      paintedAflProps = warmSnapshot.aflProps as PlayerProp[];
      paintedNoAflOdds = warmSnapshot.noAflOdds;
      restoredNbaCache = paintedNbaProps.length > 0;
      restoredAflCache = paintedAflProps.length > 0 || (warmSnapshot.aflGames as AflGameForProps[]).length > 0;
      restoredCombinedSnapshot =
        warmSnapshot.propsSport === 'combined' ||
        (!urlSpecifiesSport && resolvedSport === 'combined');
    }

    if (requiresCombinedFirstPaint && !warmSnapshot) {
      try {
        const parsed =
          readCombinedSnapshotBrowserCache() ??
          (peekCombinedPropsEarlyPayload() as CombinedSnapshotBrowserCache | null);
        if (parsed) {
          const nbaProps = Array.isArray(parsed?.nba?.props) ? parsed.nba.props : [];
          const aflPropsCached = Array.isArray(parsed?.afl?.props) ? parsed.afl.props : [];
          const aflGamesCached = Array.isArray(parsed?.afl?.games) ? parsed.afl.games : [];
          const nblPropsCached = Array.isArray(parsed?.nbl?.props) ? parsed.nbl.props : [];
          const tennisPropsCached = Array.isArray(parsed?.tennis?.props) ? parsed.tennis.props : [];
          const hasSnapshotData =
            nbaProps.length > 0 ||
            aflPropsCached.length > 0 ||
            aflGamesCached.length > 0 ||
            nblPropsCached.length > 0 ||
            tennisPropsCached.length > 0;
          if (hasSnapshotData) {
            let snapshotForApply: CombinedPropsSnapshotResponse = parsed;

            applyCombinedSnapshot(snapshotForApply, {
              persistCaches: false,
              selectedGameIds: Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : undefined,
            });
            const tennisFromSnapshot = Array.isArray(parsed?.tennis?.props)
              ? (parsed.tennis.props as PlayerProp[]).filter(isTennisListProp)
              : [];
            const tennisHydrate = preferTennisPropsForPaint(
              [...readTennisTourPropsFromCaches('atp'), ...readTennisTourPropsFromCaches('wta')],
              tennisFromSnapshot
            );
            if (tennisHydrate.length > 0) {
              paintedTennisProps = tennisHydrate;
              setTennisCombinedProps(tennisHydrate);
            }
            if (nblPropsCached.length > 0) {
              setNblCombinedProps(nblPropsCached.filter(isNblListProp));
            }
            paintedNbaProps = nbaProps;
            paintedAflProps = aflPropsCached;
            paintedNoAflOdds = parsed?.afl?.noAflOdds === true;
            restoredNbaCache = nbaProps.length > 0;
            restoredAflCache = aflPropsCached.length > 0 || aflGamesCached.length > 0;
            const partialCombinedCache = (() => {
              const { missingAfl } = combinedModeMissingSecondarySlice(
                aflPropsCached,
                {
                  noAflOdds: parsed?.afl?.noAflOdds === true,
                }
              );
              return missingAfl;
            })();
            if (partialCombinedCache) {
              setCombinedFetchComplete(false);
              restoredCombinedSnapshot = false;
            } else {
              restoredCombinedSnapshot = true;
            }

          }
        }
      } catch {
        // ignore cache parse errors
      }
    }

    // 2) NBA player props cache (always restore so sport toggles NBA↔AFL stay instant)
    if (!restoredCombinedSnapshot && !warmSnapshot && NBA_PUBLIC_ENABLED) {
      const CACHE_KEY = 'nba-player-props-cache';
      const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
      const cachedData = sessionStorage.getItem(CACHE_KEY);
      const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
      if (cachedData && cachedTimestamp) {
        const age = Date.now() - parseInt(cachedTimestamp, 10);
        if (age < CACHE_TTL_MS) {
          try {
            const parsed = JSON.parse(cachedData);
            if (Array.isArray(parsed) && parsed.length > 0) {
              let propsWithMergedStats = parsed;
              const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
              try {
                const stored = sessionStorage.getItem(CALCULATED_STATS_KEY);
                if (stored) {
                  const calculatedStats = JSON.parse(stored);
                  if (Array.isArray(calculatedStats)) {
                    const calculatedMap = new Map<string, PlayerProp>();
                    calculatedStats.forEach((prop: PlayerProp) => {
                      const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                      calculatedMap.set(key, prop);
                    });
                    propsWithMergedStats = parsed.map((prop: PlayerProp) => {
                      const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                      const calculated = calculatedMap.get(key);
                      if (calculated) {
                        return {
                          ...prop,
                          h2hAvg: calculated.h2hAvg ?? prop.h2hAvg,
                          seasonAvg: calculated.seasonAvg ?? prop.seasonAvg,
                          h2hHitRate: calculated.h2hHitRate ?? prop.h2hHitRate,
                          seasonHitRate: calculated.seasonHitRate ?? prop.seasonHitRate,
                        };
                      }
                      return prop;
                    });
                    calculatedStats.forEach((prop: PlayerProp) => {
                      const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                      calculatedKeysRef.current.add(key);
                    });
                    setPropsWithCalculatedStats(calculatedMap);
                  }
                }
              } catch {
                // ignore
              }
              setPlayerProps(propsWithMergedStats);
              propsLoadedRef.current = true;
              setPropsLoading(false);
              paintedNbaProps = propsWithMergedStats;
              restoredNbaCache = true;
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }

    // 3) Games cache (same key as fetchTodaysGames)
    if (!warmSnapshot) {
    const cachedGames = readDashboardGamesFromSessionCache();
    if (cachedGames) {
      setTodaysGames(cachedGames);
      setGamesLoading(false);
    }
    }

    // 4) AFL / tennis: paint from fresh session cache immediately for instant back-nav experience.
    if (
      !warmSnapshot &&
      (sportParam === null ||
      sportParam === 'afl' ||
      isTennisSportParam(sportParam) ||
      sportParam === 'combined' ||
      sportParam === 'all' ||
      sportParam === 'nbl')
    ) {
      let secondaryRestoreCanSkipFetch = false;
      try {
        if (requiresCombinedFirstPaint) {
          const aflCached = readSecondaryPropsSessionCache('afl');
          const aflReady =
            aflCached.isFresh && (aflCached.props.length > 0 || aflCached.games.length > 0);

          if (!restoredCombinedSnapshot && aflReady) {
            const liveAfl = applyLiveAflPropsCutoff(aflCached.props, aflCached.games);
            if (liveAfl.noAflOdds) {
              setAflIngestMessage(liveAfl.ingestMessage);
              setAflGames([]);
              setAflProps([]);
              paintedAflProps = [];
              combinedOddsFlagsRef.current = {
                ...combinedOddsFlagsRef.current,
                noAflOdds: true,
              };
            } else {
              setAflProps(liveAfl.props);
              paintedAflProps = liveAfl.props;
              const matchedAflGames = gamesMatchingProps(liveAfl.props, liveAfl.games);
              setAflGames(matchedAflGames);
              const selected = selectedGameIdsForProps(
                liveAfl.props,
                matchedAflGames,
                aflCached.selectedGameIds.length > 0 ? aflCached.selectedGameIds : undefined
              );
              selectedAflGamesRef.current = selected;
              setSelectedAflGames(selected);
            }
            restoredAflCache = true;
          }
        } else if (!restoredCombinedSnapshot) {
          const secondaryCacheKey = isTennisSportParam(sportParam)
            ? getSecondaryPropsCacheKey(sportParam === 'wta' ? 'wta' : 'atp')
            : sportParam === 'nbl'
              ? getSecondaryPropsCacheKey('nbl')
              : AFL_PROPS_CACHE_KEY;
          const raw = sessionStorage.getItem(secondaryCacheKey);
          if (raw) {
            const parsed = JSON.parse(raw) as {
              props?: PlayerProp[];
              games?: AflGameForProps[];
              selectedGameIds?: string[];
              userModifiedGames?: boolean;
              timestamp?: number;
            };
            const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
            const isFresh = Number.isFinite(age) && age < AFL_PROPS_CACHE_TTL_MS;
            const cachedPropsRaw = Array.isArray(parsed?.props) ? parsed.props : [];
            const cachedProps = isTennisSportParam(sportParam)
              ? cachedPropsRaw.filter(
                  (p) =>
                    isTennisListProp(p) &&
                    propsSportFromTennisTour(p.team || p.homeTeamCode) ===
                      (sportParam === 'wta' ? 'wta' : 'atp')
                )
              : sportParam === 'nbl'
                ? cachedPropsRaw.filter(isNblListProp)
                : cachedPropsRaw.filter((p) => !isTennisPropStatType(p.statType) && !isNblListProp(p));
            const cachedGames = Array.isArray(parsed?.games) ? parsed.games : [];
            const hasPaintableSecondaryRows =
              isTennisSportParam(sportParam)
                ? cachedProps.length > 0
                : cachedProps.length > 0 || cachedGames.length > 0;
            if (isFresh && hasPaintableSecondaryRows) {
              if (sportParam === 'afl') {
                const liveAfl = applyLiveAflPropsCutoff(cachedProps, cachedGames);
                if (liveAfl.noAflOdds) {
                  setAflIngestMessage(liveAfl.ingestMessage);
                  setAflProps([]);
                  setAflGames([]);
                  selectedAflGamesRef.current = new Set();
                  setSelectedAflGames(new Set());
                  restoredAflCache = false;
                } else {
                  setAflProps(liveAfl.props);
                  const matchedGames = gamesMatchingProps(liveAfl.props, liveAfl.games);
                  setAflGames(matchedGames);
                  const selected = selectedGameIdsForProps(
                    liveAfl.props,
                    matchedGames,
                    Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : undefined
                  );
                  selectedAflGamesRef.current = selected;
                  setSelectedAflGames(selected);
                  restoredAflCache = true;
                }
              } else {
                setAflProps(cachedProps);
                const matchedGames = gamesMatchingProps(cachedProps, cachedGames);
                const gamesForUi =
                  cachedGames.length > matchedGames.length ? cachedGames : matchedGames;
                setAflGames(gamesForUi);
                const listSport: SecondaryPropsSport =
                  sportParam === 'nbl' ? 'nbl' : sportParam === 'wta' ? 'wta' : 'atp';
                seedSecondaryGameSelection(listSport, {
                  selectedGameIds: Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : [],
                  userModifiedGames: parsed?.userModifiedGames === true,
                });
                applyRememberedGameSelection(
                  listSport,
                  gamesForUi.length > 0
                    ? gamesForUi.map((game) => game.gameId)
                    : Array.from(propGameIdsFromRows(cachedProps))
                );
                restoredAflCache = true;
              }
              if (sportParam === 'afl' || isTennisSportParam(sportParam) || sportParam === 'nbl') {
                const listSport: SecondaryPropsSport = isTennisSportParam(sportParam)
                  ? sportParam === 'wta'
                    ? 'wta'
                    : 'atp'
                  : sportParam === 'nbl'
                    ? 'nbl'
                    : 'afl';
                secondaryListSportRef.current = listSport;
                secondaryRestoreCanSkipFetch = true;
                secondarySkipFetchSportRef.current = listSport;
                secondaryWarmHydrateRef.current = true;
                if (sportParam === 'nbl') setNblCombinedProps(cachedProps);
              }
            }
          }
        }
      } catch {
        // ignore cache parse errors
      }
      if (sportParam === 'afl' || isTennisSportParam(sportParam) || sportParam === 'nbl') {
        if (restoredAflCache) {
          setSecondaryPropsFetchComplete(secondaryRestoreCanSkipFetch);
          setAflPropsLoading(!secondaryRestoreCanSkipFetch);
        } else {
          setSecondaryPropsFetchComplete(false);
          setAflPropsLoading(true);
        }
      } else {
        setSecondaryPropsFetchComplete(restoredAflCache);
        setAflPropsLoading(!restoredAflCache);
      }
      if (requiresCombinedFirstPaint) {
        if (paintedTennisProps.length === 0) {
          const tennisHydrate = [
            ...readTennisTourPropsFromCaches('atp'),
            ...readTennisTourPropsFromCaches('wta'),
          ];
          if (tennisHydrate.length > 0) {
            paintedTennisProps = tennisHydrate;
            setTennisCombinedProps(tennisHydrate);
          }
        }
        const nblHydrate = nblCombinedPropsRef.current.some(isNblListProp)
          ? nblCombinedPropsRef.current.filter(isNblListProp)
          : readSecondaryPropsSessionCache('nbl').props.filter(isNblListProp);
        if (nblHydrate.length > 0) {
          setNblCombinedProps(nblHydrate);
        }
        const hasCombinedPaint = combinedModeHasVisibleRows(
          paintedNbaProps,
          paintedAflProps,
          paintedTennisProps,
          nblHydrate
        );
        const { missingAfl } = combinedModeMissingSecondarySlice(
          paintedAflProps,
          { noAflOdds: paintedNoAflOdds }
        );
        const combinedComplete = restoredCombinedSnapshot || (!missingAfl && hasCombinedPaint);
        setCombinedFetchComplete(combinedComplete);
        setCombinedPropsLoading(!hasCombinedPaint);
        setCombinedPaintUnlocked(
          restoredCombinedSnapshot ||
            isCombinedSecondaryPaintReady(paintedAflProps, {
              noAflOdds: paintedNoAflOdds,
            }) ||
            hasCombinedPaint
        );
        setPropsLoading(!hasCombinedPaint && paintedNbaProps.length === 0);
        setAflPropsLoading(!hasCombinedPaint && paintedAflProps.length === 0);
      }
      try {
        let logoMap: Record<string, string> | null = null;
        const logosRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_KEY);
        const logosTsRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_TS_KEY);
        const logosTs = logosTsRaw ? parseInt(logosTsRaw, 10) : 0;
        const logosAge = Number.isFinite(logosTs) ? Date.now() - logosTs : Infinity;
        if (logosRaw && logosAge < AFL_TEAM_LOGOS_CACHE_TTL_MS) {
          const parsed = JSON.parse(logosRaw);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            logoMap = parsed as Record<string, string>;
          }
        }
        if (!logoMap) {
          const lsRaw = localStorage.getItem(AFL_TEAM_LOGOS_LS_KEY);
          const lsTsRaw = localStorage.getItem(AFL_TEAM_LOGOS_LS_TS_KEY);
          const lsTs = lsTsRaw ? parseInt(lsTsRaw, 10) : 0;
          const lsAge = Number.isFinite(lsTs) ? Date.now() - lsTs : Infinity;
          if (lsRaw && lsAge < AFL_TEAM_LOGOS_LS_TTL_MS) {
            const parsed = JSON.parse(lsRaw);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
              logoMap = parsed as Record<string, string>;
            }
          }
        }
        if (logoMap) {
          setAflLogoByTeam(logoMap);
          for (const url of Object.values(logoMap)) warmImage(url);
        }
      } catch {
        // ignore
      }
    } else {
      setCombinedFetchComplete(false);
      setCombinedPropsLoading(false);
    }
  }, []);

  useEffect(() => {
    playerPropsRef.current = playerProps;
  }, [playerProps]);

  const getPlayerIdFromName = (playerName: string): string | null => {
    const mapping = PLAYER_ID_MAPPINGS.find(m =>
      m.name.toLowerCase() === playerName.toLowerCase() ||
      m.name.toLowerCase().includes(playerName.toLowerCase()) ||
      playerName.toLowerCase().includes(m.name.toLowerCase())
    );
    return mapping?.bdlId || null;
  };

  const DEBUG_H2H_PLAYER = (process.env.NEXT_PUBLIC_DEBUG_H2H_PLAYER || '').toLowerCase().trim();

  const calculatePlayerAverages = async (
    playerName: string,
    statType: string,
    opponent: string,
    playerTeam?: string,
    line?: number
  ): Promise<{
    last5: number | null;
    last10: number | null;
    h2h: number | null;
    last5HitRate: { hits: number; total: number } | null;
    last10HitRate: { hits: number; total: number } | null;
    h2hHitRate: { hits: number; total: number } | null;
    seasonAvg: number | null;
    seasonHitRate: { hits: number; total: number } | null;
    streak: number | null;
  }> => {
    try {
      const shouldDebugH2H = !DEBUG_H2H_PLAYER || playerName.toLowerCase() === DEBUG_H2H_PLAYER;
      const playerId = getPlayerIdFromName(playerName);
      if (!playerId) {
        console.warn(`[calculatePlayerAverages] No player ID found for: ${playerName}`);
        return {
          last5: null,
          last10: null,
          h2h: null,
          last5HitRate: null,
          last10HitRate: null,
          h2hHitRate: null,
          seasonAvg: null,
          seasonHitRate: null,
          streak: null
        };
      }

      const currentSeason = currentNbaSeason();
      
      // Fetch stats per season - fetch both regular and playoffs in parallel
      // This reduces from 4 requests to 2 requests per player (2 seasons x 2 parallel fetches each)
      const grabSeason = async (yr: number, retries = 2): Promise<any[]> => {
        const cacheKey = `${playerId}-${yr}-all`;

        // Return cached data if available
        const cached = playerStatsCache.get(cacheKey);
        if (cached) {
          return cached;
        }
        // If a fetch is already in flight, await it
        const pendingPromise = playerStatsPromiseCache.get(cacheKey);
        if (pendingPromise) {
          return pendingPromise;
        }

        const fetchSingle = async (postseason: boolean, suffix: string): Promise<any[]> => {
          // Use queued fetch to prevent rate limiting
          const { queuedFetch } = await import('@/lib/requestQueue');
          const singleCacheKey = `${playerId}-${yr}-${postseason ? 'po' : 'reg'}`;
          
          // Return cached data if available
          const cachedSingle = playerStatsCache.get(singleCacheKey);
          if (cachedSingle) {
            return cachedSingle;
          }
          
          for (let attempt = 0; attempt <= retries; attempt++) {
            try {
              const url = `/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=3&postseason=${postseason}`;
              const requestId = `stats-${playerId}-${yr}-${suffix}`;
              // Debug logging removed(`[calculatePlayerAverages] Fetching ${suffix}: ${url} (attempt ${attempt + 1}/${retries + 1})`);
              const r = await queuedFetch(url, {}, requestId);
            
              // Try to parse response even on 429 - API might return cached data
              let j: any = {};
              try {
                j = await r.json();
              } catch (e) {
                const text = await r.text().catch(() => '');
                console.warn(`[calculatePlayerAverages] Failed to parse response for ${playerId}, season ${yr}, ${suffix}:`, text);
              }
              
              // Check if we got cached data even on 429
              const data = Array.isArray(j?.data) ? j.data : [];
              if (data.length > 0) {
                // Debug logging removed(`[calculatePlayerAverages] Got ${data.length} stats (${r.status === 429 ? 'cached' : 'fresh'}) for ${playerName} (${playerId}), season ${yr}, ${suffix}`);
                playerStatsCache.set(singleCacheKey, data);
                return data;
              }
              
              if (r.status === 429) {
                if (attempt < retries) {
                  const waitTime = (attempt + 1) * 2000;
                  // Debug logging removed(`[calculatePlayerAverages] Rate limited, waiting ${waitTime}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, waitTime));
                  continue;
                }
                console.warn(`[calculatePlayerAverages] Rate limited for ${playerId}, season ${yr}, ${suffix} - no cached data available`);
                return [];
              }
              if (!r.ok) {
                console.warn(`[calculatePlayerAverages] API error ${r.status} for ${playerId}, season ${yr}, ${suffix}`);
                return [];
              }
              
              return data;
            } catch (error: any) {
              // If queuedFetch threw a 429 error, try to extract cached data from error.response
              if (error?.status === 429 && error?.response) {
                try {
                  const j = await error.response.json();
                  const data = Array.isArray(j?.data) ? j.data : [];
                  if (data.length > 0) {
                    // Debug logging removed(`[calculatePlayerAverages] Got ${data.length} cached stats from 429 error for ${playerName} (${playerId}), season ${yr}, ${suffix}`);
                    playerStatsCache.set(singleCacheKey, data);
                    return data;
                  }
                } catch (parseError) {
                  // Failed to parse error response, continue to retry logic
                }
              }
              
              if (attempt < retries) {
                const waitTime = (attempt + 1) * 1000;
                // Debug logging removed(`[calculatePlayerAverages] Error on attempt ${attempt + 1}, retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
              }
              console.error(`[calculatePlayerAverages] Error fetching stats for ${playerId}, ${suffix}:`, error);
              return [];
            }
          }
          return [];
        };

        // Fetch regular first, then playoffs sequentially to avoid rate limiting
        // Even with RequestQueue limiting to 1 concurrent, sequential is safer
        const fetchPromise = (async () => {
          const regular = await fetchSingle(false, 'reg');
          // Small delay between regular and postseason to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 300));
          const playoffs = await fetchSingle(true, 'po');
          const combined = [...regular, ...playoffs];
          // Cache the combined result
          playerStatsCache.set(cacheKey, combined);
          return combined;
        })();

        playerStatsPromiseCache.set(cacheKey, fetchPromise);
        try {
          const result = await fetchPromise;
          return result;
        } finally {
          playerStatsPromiseCache.delete(cacheKey);
        }
      };

      // Fetch stats per season - fetch both regular and playoffs in parallel
      // This reduces from 4 requests to 2 requests per player (2 seasons x 2 parallel fetches each)
      const currSeason = await grabSeason(currentSeason);        // current season (2025/2026) - regular + playoffs in parallel
      await new Promise(resolve => setTimeout(resolve, 100));
      const prev1Season = await grabSeason(currentSeason - 1);    // previous season (2024/2025) - regular + playoffs in parallel

      // Merge all data and filter (like dashboard does)
      const allStats = [...currSeason, ...prev1Season];
      
      const validStats = allStats.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
      // Debug logging removed(`[calculatePlayerAverages] Valid stats after filter: ${validStats.length} out of ${allStats.length}`);
      
      // CRITICAL: Deduplicate by game ID first (regular/postseason might have duplicates)
      const uniqueStatsMap = new Map();
      for (const stat of validStats) {
        const gameId = stat?.game?.id;
        if (gameId) {
          // Keep the first occurrence (or you could keep the one with more data)
          if (!uniqueStatsMap.has(gameId)) {
            uniqueStatsMap.set(gameId, stat);
          }
        } else {
          // If no game ID, keep it (shouldn't happen but just in case)
          uniqueStatsMap.set(`no-id-${uniqueStatsMap.size}`, stat);
        }
      }
      const uniqueStats = Array.from(uniqueStatsMap.values());
      // Debug logging removed(`[calculatePlayerAverages] Deduplicated: ${validStats.length} → ${uniqueStats.length} unique games`);
      
      // Sort by date (newest first) - same as dashboard
      uniqueStats.sort((a, b) => {
        const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
        const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
        return db - da; // newest first
      });
      
      if (uniqueStats.length === 0) {
        console.warn(`[calculatePlayerAverages] No valid stats for ${playerName} (${playerId})`, {
          allStatsLength: allStats.length,
          sampleStat: allStats[0],
          hasGame: !!allStats[0]?.game,
          hasGameDate: !!allStats[0]?.game?.date,
          hasTeam: !!allStats[0]?.team,
        });
        return { 
          last5: null, 
          last10: null, 
          h2h: null,
          last5HitRate: null,
          last10HitRate: null,
          h2hHitRate: null,
          seasonAvg: null,
          seasonHitRate: null,
          streak: null
        };
      }

      const getStatValue = (game: any, stat: string): number => {
        // Handle combined stats (PRA, PA, PR, RA)
        if (stat === 'PRA') {
          return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.reb || 0) || 0) + (parseFloat(game.ast || 0) || 0);
        }
        if (stat === 'PA') {
          return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.ast || 0) || 0);
        }
        if (stat === 'PR') {
          return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.reb || 0) || 0);
        }
        if (stat === 'RA') {
          return (parseFloat(game.reb || 0) || 0) + (parseFloat(game.ast || 0) || 0);
        }
        
        const statMap: Record<string, string> = {
          'PTS': 'pts',
          'REB': 'reb',
          'AST': 'ast',
          'STL': 'stl',
          'BLK': 'blk',
          'THREES': 'fg3m',
        };
        const key = statMap[stat] || stat.toLowerCase();
        const rawValue = game[key];
        // Handle null, undefined, or empty string explicitly
        if (rawValue === null || rawValue === undefined || rawValue === '') {
          return 0;
        }
        const parsed = parseFloat(rawValue);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      // Helper function to parse minutes (same as dashboard)
      const parseMinutes = (minVal: any): number => {
        if (typeof minVal === 'number') return minVal;
        if (!minVal) return 0;
        const str = String(minVal);
        const match = str.match(/(\d+):(\d+)/);
        if (match) {
          return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
        }
        return parseFloat(str) || 0;
      };

      // CRITICAL: Filter out ALL games with 0 minutes FIRST, then get stat values
      // Then RE-SORT to ensure newest-first order (filtering might affect order)
      const gamesWithMinutes = uniqueStats.filter((stats: any) => {
        const minutes = parseMinutes(stats.min);
        // STRICT: Only include games where player actually played (minutes > 0)
        return minutes > 0;
      });
      
      // Debug logging removed(`[calculatePlayerAverages] ${playerName} ${statType}: ${gamesWithMinutes.length} games with minutes > 0`);
      
      // Log sample stat structure to debug stat extraction
      if (gamesWithMinutes.length > 0) {
        const sample = gamesWithMinutes[0];
      }
      
      const gamesWithStats = gamesWithMinutes
        .map((stats: any) => {
          const statValue = getStatValue(stats, statType);
          return {
            ...stats,
            statValue,
          };
        })
        .filter((stats: any) => {
          // Only include games with valid (finite) stat values
          // Note: 0 is a valid stat value (player had 0 points/rebounds/etc), so we keep it
          const isValid = Number.isFinite(stats.statValue);
          if (!isValid) {
            console.warn(`[calculatePlayerAverages] Invalid stat value for ${playerName} ${statType}:`, {
              statValue: stats.statValue,
              gameDate: stats?.game?.date,
              rawStat: stats[statType.toLowerCase()] || stats[statType] || 'missing',
              allStatKeys: Object.keys(stats),
            });
          }
          return isValid;
        })
        .sort((a, b) => {
          // RE-SORT by date to ensure newest-first (critical for L5/L10)
          const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
          const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
          return dateB - dateA; // Newest first
        });
      
      // Debug logging removed(`[calculatePlayerAverages] ${playerName} ${statType}: ${gamesWithStats.length} games with valid stat values (from ${gamesWithMinutes.length} games with minutes)`);

      if (gamesWithStats.length === 0) {
        return { 
          last5: null, 
          last10: null, 
          h2h: null,
          last5HitRate: null,
          last10HitRate: null,
          h2hHitRate: null,
          seasonAvg: null,
          seasonHitRate: null,
          streak: null,
        };
      }

      // Filter to current season games only (same logic as server-side)
      const getSeasonYear = (stats: any) => {
        if (!stats?.game?.date) return null;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        return gameMonth >= 9 ? gameYear : gameYear - 1;
      };

      const currentSeasonGames = gamesWithStats.filter((stats: any) => {
        const gameSeasonYear = getSeasonYear(stats);
        return gameSeasonYear === currentSeason;
      });

      // Season average: Calculate average from current season games only
      const seasonValues = currentSeasonGames.map((g: any) => g.statValue);
      const seasonSum = seasonValues.reduce((sum: number, val: number) => sum + val, 0);
      const seasonAvg = seasonValues.length > 0 ? seasonSum / seasonValues.length : null;
      
      // Calculate season hit rate (how many times hit over the line)
      let seasonHitRate: { hits: number; total: number } | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && seasonValues.length > 0) {
        const hits = seasonValues.filter((val: number) => val > line).length;
        seasonHitRate = { hits, total: seasonValues.length };
      }

      // Last 5 average: Take first 5 games (newest) from gamesWithStats, calculate average
      const last5Games = gamesWithStats.slice(0, 5);
      const last5Values = last5Games.map((g: any) => g.statValue);
      const last5Sum = last5Values.reduce((sum: number, val: number) => sum + val, 0);
      const last5Avg = last5Values.length > 0 ? last5Sum / last5Values.length : null;
      
      // Calculate last 5 hit rate (how many times hit over the line)
      let last5HitRate: { hits: number; total: number } | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && last5Values.length > 0) {
        const hits = last5Values.filter((val: number) => val > line).length;
        last5HitRate = { hits, total: last5Values.length };
      }
      

      // Last 10 average: Take first 10 games (newest) from gamesWithStats, calculate average
      const last10Games = gamesWithStats.slice(0, 10);
      const last10Values = last10Games.map((g: any) => g.statValue);
      const last10Sum = last10Values.reduce((sum: number, val: number) => sum + val, 0);
      const last10Avg = last10Values.length > 0 ? last10Sum / last10Values.length : null;
      
      // Calculate last 10 hit rate (how many times hit over the line)
      let last10HitRate: { hits: number; total: number } | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && last10Values.length > 0) {
        const hits = last10Values.filter((val: number) => val > line).length;
        last10HitRate = { hits, total: last10Values.length };
      }
      

      // H2H average - COPY EXACT LOGIC FROM DASHBOARD (lines 9634-9669)
      let h2hAvg: number | null = null;
      let h2hStats: number[] = [];
      let normalizedOpponent: string | null = null;
      if (opponent && opponent !== 'ALL' && opponent !== 'N/A' && opponent !== '') {
        // Use EXACT same normalizeAbbr function as dashboard
        const normalizeAbbr = (abbr: string): string => {
          if (!abbr) return '';
          return abbr.toUpperCase().trim();
        };
        
        // Determine correct opponent: if player's actual team matches provided opponent, they're swapped
        let correctOpponent = opponent;
        if (gamesWithStats.length > 0 && playerTeam) {
          const playerActualTeam = gamesWithStats[0]?.team?.abbreviation || "";
          const playerActualTeamNorm = normalizeAbbr(playerActualTeam);
          const providedTeamNorm = normalizeAbbr(TEAM_FULL_TO_ABBR[playerTeam] || playerTeam);
          const providedOpponentNorm = normalizeAbbr(TEAM_FULL_TO_ABBR[opponent] || opponent);
          
          // If player's actual team matches the provided opponent, they're swapped
          if (playerActualTeamNorm === providedOpponentNorm) {
            // Player is on the "opponent" team, so the real opponent is the "team"
            correctOpponent = playerTeam;
          }
        }
        
        // Normalize opponent - handle both abbreviations and full names
        // Try TEAM_FULL_TO_ABBR first (if it's a full name), otherwise use as-is (if it's already an abbreviation)
        normalizedOpponent = normalizeAbbr(TEAM_FULL_TO_ABBR[correctOpponent] || correctOpponent);
        
        // Debug: log opponent normalization
        if (shouldDebugH2H && process.env.NODE_ENV !== 'production') {
        }
        
        // FIXED to handle players who changed teams
        // The key insight: if a player has stats for a game, and the opponent we're looking for
        // is one of the teams in that game, then the player played against that opponent
        // (regardless of which team the player was on - this correctly handles team changes)
        h2hStats = gamesWithStats
          .filter((stats: any) => {
            // Get both teams from the game
            const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
            const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
            const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
            const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
            
            if (!homeTeamAbbr || !visitorTeamAbbr) {
              return false;
            }
            
            const homeNorm = normalizeAbbr(homeTeamAbbr);
            const awayNorm = normalizeAbbr(visitorTeamAbbr);
            
            // If the opponent we're looking for is in this game, and the player has stats for it,
            // then the player played against that opponent (regardless of which team they were on)
            // This correctly handles players who changed teams - we don't need to know which team
            // the player was on, we just need to know if the opponent is in the game
            const opponentInGame = homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
            
            // Player has stats for this game (gamesWithStats already filters for minutes > 0),
            // so if the opponent is in the game, this is an H2H match
            return opponentInGame;
          })
          .slice(0, 6) // Limit to last 6 H2H games
          .map((s: any) => s.statValue);
        
        h2hAvg = h2hStats.length > 0
          ? h2hStats.reduce((sum: number, val: number) => sum + val, 0) / h2hStats.length
          : null;
        
      }
      
      // Calculate H2H hit rate (how many times hit over the line)
      let h2hHitRate: { hits: number; total: number } | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && h2hStats && h2hStats.length > 0) {
        const hits = h2hStats.filter((val: number) => val > line).length;
        h2hHitRate = { hits, total: h2hStats.length };
      }

      // Debug when H2H is missing
      if (shouldDebugH2H && (!h2hStats || h2hStats.length === 0 || h2hAvg === null) && process.env.NODE_ENV !== 'production') {
        const normalizeAbbrLocal = (abbr: string): string => (abbr || '').toUpperCase().trim();
        const opponentCounts: Record<string, number> = {};
        const fullOpponentCounts: Record<string, number> = {};

        // Build full opponent counts across all gamesWithStats
        for (const g of gamesWithStats) {
          const homeTeamId = g?.game?.home_team?.id ?? (g?.game as any)?.home_team_id;
          const visitorTeamId = g?.game?.visitor_team?.id ?? (g?.game as any)?.visitor_team_id;
          const homeTeamAbbr = g?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = g?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          const homeNorm = normalizeAbbrLocal(homeTeamAbbr || '');
          const awayNorm = normalizeAbbrLocal(visitorTeamAbbr || '');
          const playerTeamFromStats = g?.team?.abbreviation || '';
          const playerTeamNorm = normalizeAbbrLocal(playerTeamFromStats);

          const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
          let gameOpponent = '';
          if (playerTeamId && homeTeamId && visitorTeamId) {
            if (playerTeamId === homeTeamId && visitorTeamAbbr) {
              gameOpponent = normalizeAbbrLocal(visitorTeamAbbr);
            } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
              gameOpponent = normalizeAbbrLocal(homeTeamAbbr);
            }
          }
          if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
            if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
            else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
          }

          const key = gameOpponent || 'unknown';
          fullOpponentCounts[key] = (fullOpponentCounts[key] || 0) + 1;
        }

        const sampleGames = gamesWithStats.slice(0, 6).map((g: any) => {
          const homeTeamId = g?.game?.home_team?.id ?? (g?.game as any)?.home_team_id;
          const visitorTeamId = g?.game?.visitor_team?.id ?? (g?.game as any)?.visitor_team_id;
          const homeTeamAbbr = g?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = g?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          const homeNorm = normalizeAbbrLocal(homeTeamAbbr || '');
          const awayNorm = normalizeAbbrLocal(visitorTeamAbbr || '');
          const playerTeamFromStats = g?.team?.abbreviation || '';
          const playerTeamNorm = normalizeAbbrLocal(playerTeamFromStats);

          // Derive the opponent the player faced in this game (same logic as the main filter)
          const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
          let gameOpponent = '';
          if (playerTeamId && homeTeamId && visitorTeamId) {
            if (playerTeamId === homeTeamId && visitorTeamAbbr) {
              gameOpponent = normalizeAbbrLocal(visitorTeamAbbr);
            } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
              gameOpponent = normalizeAbbrLocal(homeTeamAbbr);
            }
          }
          if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
            if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
            else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
          }

          const key = gameOpponent || 'unknown';
          opponentCounts[key] = (opponentCounts[key] || 0) + 1;

          return {
            date: g?.game?.date,
            home: homeTeamAbbr,
            visitor: visitorTeamAbbr,
            playerTeam: playerTeamFromStats,
            derivedOpponent: gameOpponent || null,
            statValue: g?.statValue,
          };
        });

        console.warn('[calculatePlayerAverages][H2H Missing]', {
          playerName,
          statType,
          opponent,
          playerTeam,
          line,
          normalizedOpponent,
          gamesWithStatsCount: gamesWithStats.length,
          h2hStatsCount: h2hStats?.length || 0,
          sampleGame: gamesWithStats[0]?.game || null,
          opponentCounts,
          fullOpponentCounts,
          sampleGames,
        });
      }

      // Calculate streak: consecutive games over the line (starting from most recent)
      let streak: number | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && gamesWithStats.length > 0) {
        streak = 0;
        // Games are already sorted newest first, so iterate from start
        for (const game of gamesWithStats) {
          if (game.statValue > line) {
            streak++;
          } else {
            // Once we hit a game that didn't go over, stop counting
            break;
          }
        }
      }

      const result = {
        last5: last5Avg,
        last10: last10Avg,
        h2h: h2hAvg,
        last5HitRate,
        last10HitRate,
        h2hHitRate,
        seasonAvg,
        seasonHitRate,
        streak,
      };
      
      
      return result;
    } catch (error) {
      console.error(`[calculatePlayerAverages] Error for ${playerName} (${statType}):`, error);
      return { 
        last5: null, 
        last10: null, 
        h2h: null,
        last5HitRate: null,
        last10HitRate: null,
        h2hHitRate: null,
        seasonAvg: null,
        seasonHitRate: null,
        streak: null,
      };
    }
  };


  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    if (!NBA_PUBLIC_ENABLED || propsSport === 'afl') {
      const q = new URLSearchParams();
      q.set('mode', 'player');
      q.set('name', searchQuery.trim());
      snapshotPropsPageBeforeLeave();
      router.push(`/afl?${q.toString()}`);
      return;
    }
    snapshotPropsPageBeforeLeave();
    router.push(`/nba/research/dashboard?player=${encodeURIComponent(searchQuery.trim())}`);
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return 'TBD';
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    } catch {
      return 'TBD';
    }
  };

  // Memoize getStatLabel to prevent recreation on every render
  const getStatLabel = useCallback((statType: string) => {
    const labels: Record<string, string> = {
      'PTS': 'Points',
      'REB': 'Rebounds',
      'AST': 'Assists',
      'STL': 'Steals',
      'BLK': 'Blocks',
      'THREES': '3-Pointers',
      'FG3M': '3-Pointers',
      'PRA': 'Points + Rebounds + Assists',
      'PR': 'Points + Rebounds',
      'PA': 'Points + Assists',
      'RA': 'Rebounds + Assists',
      points: 'Points',
      rebounds: 'Rebounds',
      assists: 'Assists',
      threeMade: '3-Pointers',
      // AFL
      'disposals': 'Disposals',
      'disposals_over': 'Disposals Over',
      'anytime_goal_scorer': 'Anytime Goal Scorer',
      'goals_over': 'Goals Over',
      moneyline: 'Moneyline',
      spread: 'Spread',
      totalGames: 'Total Games',
      gamesWon: 'Games Won',
      gamesLost: 'Opp Games Won',
      totalSets: 'Total Sets',
    };
    return labels[statType] || statType;
  }, []);

  // Extract unique bookmakers and prop types from playerProps
  const availableBookmakers = useMemo(() => {
    const bookmakers = new Set<string>();
    playerProps.forEach(prop => {
      if (prop.bookmakerLines && prop.bookmakerLines.length > 0) {
        prop.bookmakerLines.forEach(line => {
          if (line.bookmaker) {
            bookmakers.add(line.bookmaker);
          }
        });
      }
      // Also include the main bookmaker
      if (prop.bookmaker) {
        bookmakers.add(prop.bookmaker);
      }
    });
    return Array.from(bookmakers).sort();
  }, [playerProps]);

  const availablePropTypes = useMemo(() => {
    const types = new Set<string>();
    playerProps.forEach(prop => {
      if (prop.statType) {
        types.add(prop.statType);
      }
    });

    const ordered = Array.from(types);

    // Desired display order for prop types
    const ORDER: string[] = [
      'PTS',   // points
      'REB',   // rebounds
      'AST',   // assists
      'THREES', // 3PM (props page uses THREES)
      'FG3M',  // fallback 3PM key if present
      'PRA',
      'PR',
      'PA',
      'RA',
      'STL',
      'BLK',
    ];

    const orderIndex = (type: string) => {
      const upper = type.toUpperCase();
      const idx = ORDER.indexOf(upper);
      return idx === -1 ? ORDER.length : idx;
    };

    ordered.sort((a, b) => {
      const ia = orderIndex(a);
      const ib = orderIndex(b);
      if (ia !== ib) return ia - ib;
      // For any types not explicitly ordered, fall back to alphabetical
      return a.localeCompare(b);
    });

    return ordered;
  }, [playerProps]);

  // Save filters to localStorage helper (defined before useEffects)
  const saveFiltersToStorage = (bookmakers: Set<string>, propTypes: Set<string>, games: Set<number>) => {
    if (typeof window === 'undefined') return;
    try {
      try {
        localStorage.setItem('nba_filters_bookmakers', JSON.stringify(Array.from(bookmakers)));
        localStorage.setItem('nba_filters_propTypes', JSON.stringify(Array.from(propTypes)));
        localStorage.setItem('nba_filters_games', JSON.stringify(Array.from(games)));
      } catch (e: any) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
          console.warn('[NBA Landing] localStorage quota exceeded when saving filters');
        } else {
          console.warn('[NBA Landing] Failed to save filters to localStorage:', e);
        }
      }
    } catch (e) {
      console.warn('[NBA Landing] Failed to save filters to localStorage:', e);
    }
  };

  // NBA: ensure all bookmakers/prop types selected when none or invalid (e.g. after switching from AFL)
  useEffect(() => {
    if (propsSport !== 'nba' || availableBookmakers.length === 0) return;
    const hasOverlap = Array.from(selectedBookmakers).some((b) => availableBookmakers.includes(b));
    if (selectedBookmakers.size > 0 && hasOverlap) return; // user has a valid selection
    let parsed: string[] = [];
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('nba_filters_bookmakers') : null;
      parsed = saved ? JSON.parse(saved) : [];
    } catch {
      parsed = [];
    }
    const savedOverlap = parsed.length > 0 && parsed.some((b: string) => availableBookmakers.includes(b));
    if (savedOverlap) {
      setSelectedBookmakers(new Set(parsed.filter((b: string) => availableBookmakers.includes(b))));
    } else {
      const defaultBookmakers = availableBookmakers.filter((bm) => bm.toLowerCase() !== 'betway');
      const newSet = new Set(defaultBookmakers);
      setSelectedBookmakers(newSet);
      saveFiltersToStorage(newSet, selectedPropTypes, selectedGames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsSport, availableBookmakers]);

  useEffect(() => {
    if (propsSport !== 'nba' || availablePropTypes.length === 0) return;
    const hasOverlap = Array.from(selectedPropTypes).some((t) => availablePropTypes.includes(t));
    if (selectedPropTypes.size > 0 && hasOverlap) return;
    let parsed: string[] = [];
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('nba_filters_propTypes') : null;
      parsed = saved ? JSON.parse(saved) : [];
    } catch {
      parsed = [];
    }
    const savedOverlap = parsed.length > 0 && parsed.some((t: string) => availablePropTypes.includes(t));
    if (savedOverlap) {
      setSelectedPropTypes(new Set(parsed.filter((t: string) => availablePropTypes.includes(t))));
    } else {
      const newSet = new Set(availablePropTypes);
      setSelectedPropTypes(newSet);
      saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsSport, availablePropTypes]);

  // Helper to match a prop to a game based on team/opponent
  // OPTIMIZATION: useCallback to prevent unnecessary re-creation on every render
  const getGameForProp = useCallback((prop: PlayerProp): Game | null => {
    if (todaysGames.length === 0) {
      return null;
    }

    const propTeam = normalizeNbaTeam(prop.team || prop.homeTeam || '');
    const propOpponent = normalizeNbaTeam(prop.opponent || prop.awayTeam || '');
    const propDateKey = getEasternDateKey(prop.gameDate);
    const propTeams = Array.from(
      new Set(
        [prop.team, prop.opponent, prop.homeTeam, prop.awayTeam]
          .map((team) => normalizeNbaTeam(team || ''))
          .filter(Boolean)
      )
    );

    const exactMatchWithDate = todaysGames.find((game) => {
      const homeTeam = normalizeNbaTeam(game.home_team?.abbreviation || '');
      const awayTeam = normalizeNbaTeam(game.visitor_team?.abbreviation || '');
      if (!homeTeam || !awayTeam || !propTeam || !propOpponent) return false;

      const matchupMatches =
        (propTeam === homeTeam && propOpponent === awayTeam) ||
        (propTeam === awayTeam && propOpponent === homeTeam);
      if (!matchupMatches) return false;
      if (!propDateKey) return true;

      const gameDateKey = getEasternDateKey((game as any).datetime || game.date || game.status);
      return !gameDateKey || gameDateKey === propDateKey;
    });
    if (exactMatchWithDate) {
      return exactMatchWithDate;
    }

    const exactMatch = todaysGames.find((game) => {
      const homeTeam = normalizeNbaTeam(game.home_team?.abbreviation || '');
      const awayTeam = normalizeNbaTeam(game.visitor_team?.abbreviation || '');
      if (!homeTeam || !awayTeam || !propTeam || !propOpponent) return false;

      return (
        (propTeam === homeTeam && propOpponent === awayTeam) ||
        (propTeam === awayTeam && propOpponent === homeTeam)
      );
    });
    if (exactMatch) {
      return exactMatch;
    }

    const datedSingleTeamMatch = todaysGames.filter((game) => {
      const homeTeam = normalizeNbaTeam(game.home_team?.abbreviation || '');
      const awayTeam = normalizeNbaTeam(game.visitor_team?.abbreviation || '');
      if (!homeTeam || !awayTeam || propTeams.length === 0 || !propDateKey) return false;

      const gameDateKey = getEasternDateKey((game as any).datetime || game.date || game.status);
      if (gameDateKey && gameDateKey !== propDateKey) return false;

      return propTeams.some((team) => team === homeTeam || team === awayTeam);
    });
    const matchedGame = datedSingleTeamMatch.length === 1 ? datedSingleTeamMatch[0] : null;

    if (!matchedGame && propTeam && propOpponent) {
      // Debug: log first few mismatches per unique prop team/opponent combo
      const debugKey = `${propTeam}-${propOpponent}`;
      if (!(window as any).__gameMatchDebug) {
        (window as any).__gameMatchDebug = new Set();
      }
      if (!(window as any).__gameMatchDebug.has(debugKey)) {
        (window as any).__gameMatchDebug.add(debugKey);
        // Debug logging removed
      }
    }
    
    return matchedGame || null;
  }, [todaysGames]); // OPTIMIZATION: Only recreate when todaysGames changes

  const getTipoffGameForRow = useCallback((prop: PlayerProp, rowSport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta'): Game | null => {
    const tipoffAt =
      tennisTipoffValue(prop.gameDate) ||
      tennisTipoffValue((prop as PlayerProp & { commenceTime?: string | null }).commenceTime);
    if (tipoffAt) {
      const parsedGameDate = new Date(tipoffAt);
      if (!Number.isNaN(parsedGameDate.getTime())) {
        if (rowSport === 'afl' || rowSport === 'nbl' || isTennisPropsSport(rowSport)) {
          return {
            id: 0,
            date: tipoffAt.slice(0, 10),
            status: tipoffAt,
            home_team: { id: 0, abbreviation: '' },
            visitor_team: { id: 0, abbreviation: '' },
            datetime: tipoffAt
          };
        }
      }
    }

    const matchedGame = getGameForProp(prop);
    if (matchedGame) {
      return matchedGame;
    }

    // Fallback for NBA rows when game matchup lookup fails.
    if (rowSport === 'nba' && prop.gameDate) {
      return {
        id: 0,
        date: prop.gameDate.slice(0, 10),
        status: prop.gameDate,
        home_team: { id: 0, abbreviation: '' },
        visitor_team: { id: 0, abbreviation: '' },
        datetime: prop.gameDate
      };
    }

    return null;
  }, [getGameForProp]);

  // Only show games that have at least one player prop
  const gamesWithProps = useMemo(() => {
    if (playerProps.length === 0 || todaysGames.length === 0) return [];
    const idsWithProps = new Set<number>();
    playerProps.forEach((prop) => {
      const game = getGameForProp(prop);
      if (game?.id) {
        idsWithProps.add(game.id);
      }
    });
    return todaysGames.filter((game) => idsWithProps.has(game.id));
  }, [playerProps, todaysGames, getGameForProp]);
  const shouldApplyNbaGameFilter = selectedGames.size > 0 && gamesWithProps.length > 0;

  const activeSecondaryProps = useMemo(() => {
    if (isNblPropsSport(propsSport)) {
      const fromTab = aflProps.filter(isNblListProp);
      return fromTab.length > 0 ? fromTab : nblCombinedProps.filter(isNblListProp);
    }
    if (!isTennisPropsSport(propsSport)) {
      return aflProps.filter((p) => !isTennisPropStatType(p.statType) && !isNblListProp(p));
    }
    const fromTab = aflProps.filter(
      (p) => isTennisListProp(p) && propsSportFromTennisTour(p.team || p.homeTeamCode) === propsSport
    );
    const source = fromTab.length > 0
      ? fromTab
      : tennisCombinedProps.filter(
          (p) => isTennisListProp(p) && propsSportFromTennisTour(p.team || p.homeTeamCode) === propsSport
        );
    return tennisPropsForPaint(source);
  }, [propsSport, aflProps, tennisCombinedProps, nblCombinedProps]);

  // AFL: games that have at least one prop, and filtered AFL props
  const aflGamesWithProps = useMemo(() => {
    if (activeSecondaryProps.length === 0 || aflGames.length === 0) return [];
    const eligibleGames = filterAflPropsEligibleGames(aflGames);
    const ids = new Set<string>();
    activeSecondaryProps.forEach((p) => {
      if (!p.gameId) return;
      if (!isAflCommenceTimePropsEligible(p.gameDate)) return;
      
      ids.add(p.gameId);
    });
    return eligibleGames.filter((g) => ids.has(g.gameId));
  }, [activeSecondaryProps, aflGames, propsSport]);

  const availableAflBookmakers = useMemo(() => {
    const bookmakers = new Set<string>();
    activeSecondaryProps.forEach((prop) => {
      prop.bookmakerLines?.forEach((l) => l.bookmaker && bookmakers.add(l.bookmaker));
      if (prop.bookmaker) bookmakers.add(prop.bookmaker);
    });
    return Array.from(bookmakers).sort();
  }, [activeSecondaryProps]);

  const availableAflPropTypes = useMemo(() => {
    const types = new Set<string>();
    activeSecondaryProps.forEach((p) => p.statType && types.add(p.statType));
    const order = isTennisPropsSport(propsSport)
        ? ['moneyline', 'spread', 'totalGames', 'gamesWon', 'gamesLost', 'totalSets']
        : isNblPropsSport(propsSport)
          ? ['points', 'rebounds', 'assists', 'threeMade']
        : ['disposals', 'disposals_over', 'anytime_goal_scorer', 'goals_over'];
    return Array.from(types).sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    });
  }, [activeSecondaryProps, propsSport]);

  const effectiveBookmakers = isSecondaryPropsSport(propsSport) ? availableAflBookmakers : availableBookmakers;
  const effectivePropTypes = isSecondaryPropsSport(propsSport) ? availableAflPropTypes : availablePropTypes;
  const isCombinedMode = propsSport === 'combined';
  const isSecondaryListMode = isSecondaryPropsSport(propsSport);
  const showH2hColumn = true;
  /** Combined keeps the same desktop column count as NBA/AFL-only; sport is an inline badge on the prop cell. */
  const showCombinedDesktopSportColumn = false;

  // AFL: always include every bookmaker that appears in AFL data (union into selection). Uses functional
  // updates + deps on available list only so a partial overlap from NBA/localStorage expands to all AFL
  // bookmakers without re-running when the user unchecks a bookmaker (stable available list).
  useEffect(() => {
    if (!isSecondaryListMode || availableAflBookmakers.length === 0) return;
    setSelectedBookmakers((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const b of availableAflBookmakers) {
        if (!next.has(b)) {
          next.add(b);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [propsSport, availableAflBookmakers]);

  // Tennis/AFL: drop NBA-only saved prop types so they can't hide every row on first paint.
  useEffect(() => {
    if (!isSecondaryListMode) return;
    if (selectedPropTypes.size === 0 || availableAflPropTypes.length === 0) return;
    const overlap = Array.from(selectedPropTypes).some((t) => availableAflPropTypes.includes(t));
    if (!overlap) setSelectedPropTypes(new Set());
  }, [isSecondaryListMode, propsSport, availableAflPropTypes, selectedPropTypes]);

  // AFL: ensure prop types selected when none or invalid (e.g. after switching from NBA)
  useEffect(() => {
    if (!isSecondaryListMode || activeSecondaryProps.length === 0 || availableAflPropTypes.length === 0) return;
    const propTypesOverlap = Array.from(selectedPropTypes).some((t) => availableAflPropTypes.includes(t));
    if (selectedPropTypes.size > 0 && propTypesOverlap) return;
    setSelectedPropTypes(new Set(availableAflPropTypes));
  }, [propsSport, activeSecondaryProps.length, availableAflPropTypes, selectedPropTypes]);

  // AFL: ensure all games selected when none or invalid (e.g. after switching from NBA or cache miss)
  useEffect(() => {
    if (!isSecondaryListMode) return;
    const eligibleProps =
      propsSport === 'afl'
        ? aflProps.filter((p) => !isTennisPropStatType(p.statType) && !isNblListProp(p))
        : isTennisPropsSport(propsSport) || isNblPropsSport(propsSport)
          ? activeSecondaryProps
          : aflProps;
    const propGameIds = propGameIdsFromRows(eligibleProps);
    if (propGameIds.size === 0 && aflGamesWithProps.length === 0) return;
    // Don't auto-select all games after the user has manually toggled them.
    if (userModifiedAflGamesRef.current) return;
    const gameIds =
      aflGamesWithProps.length > 0
        ? new Set(aflGamesWithProps.map((g) => g.gameId))
        : propGameIds;
    const alreadyAll =
      selectedAflGames.size === gameIds.size &&
      Array.from(gameIds).every((id) => selectedAflGames.has(id));
    if (alreadyAll) return;
    const next = new Set(gameIds);
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
  }, [propsSport, aflGamesWithProps, selectedAflGames, aflProps, activeSecondaryProps]);

  // Fetch AFL / tennis games + player props when that sport tab is selected.
  useEffect(() => {
    if (!isSecondaryPropsSport(propsSport)) return;
    if (skipPropsRefetchOnceRef.current) {
      skipPropsRefetchOnceRef.current = false;
      const hasWarmRows = isTennisPropsSport(propsSport)
        ? (tennisListRowsHaveFormStats(tennisPropsForTour(aflProps, propsSport)) ||
            tennisListRowsHaveFormStats(tennisPropsForTour(tennisCombinedPropsRef.current, propsSport))) &&
          !tennisLooksOneMarketPerPlayer([
            ...tennisPropsForTour(aflProps, propsSport),
            ...tennisPropsForTour(tennisCombinedPropsRef.current, propsSport),
          ])
        : isNblPropsSport(propsSport)
          ? false
        : aflProps.length > 0 || aflGames.length > 0;
      if (hasWarmRows) {
        setSecondaryPropsFetchComplete(true);
        setAflPropsLoading(false);
        return;
      }
    }
    const listSport: SecondaryPropsSport = secondaryListSportForMode(propsSport);
    secondaryListSportRef.current = listSport;
    const cacheKey = getSecondaryPropsCacheKey(listSport);
    let cancelled = false;
    let hadNonEmptyFresh = false;
    const hasVisibleSecondaryRows = isTennisPropsSport(listSport)
      ? tennisPropsForTour(aflProps, listSport).length > 0 ||
        tennisPropsForTour(tennisCombinedPropsRef.current, listSport).length > 0
      : listSport === 'nbl'
        ? aflProps.some(isNblListProp) || nblCombinedPropsRef.current.some(isNblListProp)
      : aflProps.some((p) => !isTennisPropStatType(p.statType) && !isNblListProp(p)) || aflGames.length > 0;
    const canReplaceSecondaryProps = (aggregated: PlayerProp[]) =>
      aggregated.length > 0 || !hasVisibleSecondaryRows;

    const secondaryWarmHydrateCanSkipFetch = (): boolean => {
      if (isTennisPropsSport(listSport)) {
        const tourRows = [
          ...tennisPropsForTour(aflProps, listSport),
          ...tennisPropsForTour(tennisCombinedPropsRef.current, listSport),
        ];
        return tennisListRowsHaveFormStats(tourRows) && !tennisLooksOneMarketPerPlayer(tourRows);
      }
      if (listSport === 'nbl') {
        return false;
      }
      const hasListRows = aflProps.some((p) => !isTennisPropStatType(p.statType) && !isNblListProp(p));
      if (!hasListRows) return false;
      if (listSport === 'afl' && aflPropsMissingPositionLabels(aflProps)) return false;
      if (listSport === 'afl' && aflPropsMissingHistoricalStats(aflProps)) {
        return aflProps.some((p) => !isTennisPropStatType(p.statType) && !isNblListProp(p));
      }
      return true;
    };

    if (secondaryWarmHydrateRef.current && secondarySkipFetchSportRef.current === listSport) {
      secondaryWarmHydrateRef.current = false;
      if (secondaryWarmHydrateCanSkipFetch()) {
        return () => {
          cancelled = true;
        };
      }
      secondarySkipFetchSportRef.current = null;
    }

    if (secondarySkipFetchSportRef.current === listSport) {
      if (secondaryWarmHydrateCanSkipFetch()) {
        return () => {
          cancelled = true;
        };
      }
      secondarySkipFetchSportRef.current = null;
    }

    const commitSecondaryProps = (props: PlayerProp[]) => {
      if (secondaryListSportRef.current !== listSport) return;
      if (isTennisPropsSport(listSport)) {
        setAflProps((prev) => preferTennisPropsForPaint(prev.filter(isTennisListProp), props));
        return;
      }
      if (listSport === 'nbl') {
        setNblCombinedProps((prev) => preferNblPropsForPaint(prev, props));
        setAflProps((prev) => preferNblPropsForPaint(prev.filter(isNblListProp), props));
        return;
      }
      setAflProps(props);
    };

    if (!hasVisibleSecondaryRows) {
      setSecondaryPropsFetchComplete(false);
      setAflPropsLoading(true);
    }
    const doFetch = async (): Promise<{
      games: AflGameForProps[];
      aggregated: PlayerProp[];
      ingestMessage?: string;
      lastUpdated?: string;
      nextUpdate?: string;
      noAflOdds?: boolean;
    }> => {
      const inFlight = aflListFetchInFlightRef.current;
      if (inFlight && inFlight.sport === listSport) {
        return inFlight.promise;
      }
      const debugStats =
        typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('debugStats') === '1';
      const listUrl = getSecondaryPropsListUrl(listSport, debugStats, aflPropsRetryKey > 0);
      const requestPromise = (async () => {
        const listRes = await fetchSecondaryPropsList(listUrl);
        if (cancelled) return { games: [], aggregated: [], noAflOdds: false };
        const listData = await listRes.json();
        return aggregateSecondaryListPayload(listData, listSport);
      })();
      aflListFetchInFlightRef.current = { sport: listSport, promise: requestPromise };
      try {
        return await requestPromise;
      } finally {
        if (
          aflListFetchInFlightRef.current?.sport === listSport &&
          aflListFetchInFlightRef.current.promise === requestPromise
        ) {
          aflListFetchInFlightRef.current = null;
        }
      }
    };
    (async () => {
      try {
        let result = await doFetch();
        if (cancelled || secondaryListSportRef.current !== listSport) return;
        if (result.noAflOdds && !isTennisPropsSport(listSport)) {
          if (!cancelled && secondaryListSportRef.current === listSport) {
            setAflIngestMessage(result.ingestMessage ?? null);
            setAflLastUpdated(result.lastUpdated ?? null);
            if (!hasVisibleSecondaryRows) {
              setAflGames([]);
              commitSecondaryProps([]);
              try {
                sessionStorage.removeItem(cacheKey);
              } catch {
                // Ignore
              }
              userModifiedAflGamesRef.current = false;
              syncSelectedAflGames([]);
            }
            setSecondaryPropsFetchComplete(true);
            setAflPropsLoading(false);
          }
          return;
        }
        const { games, aggregated } = result;
        setAflGames(games);
        if (!cancelled) {
          setAflIngestMessage(result.ingestMessage ?? null);
          setAflLastUpdated(result.lastUpdated ?? null);
        }
        let propsToCommit = aggregated;
        if (propsToCommit.length > 0) hadNonEmptyFresh = true;
        const needsAflStatsBackfill =
          listSport === 'afl' && aggregated.length > 0 && aflPropsNeedStatsBackfill(aggregated);

        if (
          propsToCommit.length === 0 &&
          !hadNonEmptyFresh &&
          !cancelled &&
          (listSport === 'afl' || isTennisPropsSport(listSport))
        ) {
          await new Promise((r) => setTimeout(r, 2000));
          if (cancelled) return;
          result = await doFetch();
          if (cancelled) return;
          const retryGames = result.games;
          const retryAggregated = result.aggregated;
          setAflGames(retryGames);
          if (retryAggregated.length > 0 || !hadNonEmptyFresh) {
            if (canReplaceSecondaryProps(retryAggregated)) {
              commitSecondaryProps(retryAggregated);
            }
            if (retryGames.length > 0) syncSelectedAflGames(retryGames.map((g) => g.gameId));
            if (!cancelled) {
              setAflIngestMessage(result.ingestMessage ?? null);
              setAflLastUpdated(result.lastUpdated ?? null);
              try {
                const existing = isTennisPropsSport(listSport)
                  ? readSecondaryPropsSessionCache(listSport)
                  : null;
                sessionStorage.setItem(
                  cacheKey,
                  JSON.stringify({
                    props: existing
                      ? preferTennisPropsForPaint(existing.props, retryAggregated)
                      : retryAggregated,
                    games: retryGames,
                    selectedGameIds: getSelectedAflGameIdsForCache(
                      retryGames.length > 0 ? retryGames.map((g) => g.gameId) : []
                    ),
                    userModifiedGames: userModifiedAflGamesRef.current === true,
                    timestamp: Date.now(),
                  })
                );
              } catch {
                // Ignore
              }
            }
          }
          if (!cancelled && retryAggregated.length === 0) {
            const delays = [12000, 27000, 45000];
            const timeouts: ReturnType<typeof setTimeout>[] = [];
            delays.forEach((delay) => {
              const t = setTimeout(async () => {
                if (cancelled || secondaryListSportRef.current !== listSport) return;
                const res = await doFetch();
                if (cancelled || secondaryListSportRef.current !== listSport) return;
                if (res.aggregated.length > 0) {
                  setAflGames(res.games);
                  commitSecondaryProps(res.aggregated);
                  if (res.games.length > 0) syncSelectedAflGames(res.games.map((g) => g.gameId));
                  if (!cancelled) {
                    setAflIngestMessage(res.ingestMessage ?? null);
                    setAflLastUpdated(res.lastUpdated ?? null);
                  }
                  try {
                    sessionStorage.setItem(
                      cacheKey,
                      JSON.stringify({
                        props: res.aggregated,
                        games: res.games,
                        selectedGameIds: getSelectedAflGameIdsForCache(
                          res.games.length > 0 ? res.games.map((g) => g.gameId) : []
                        ),
                        userModifiedGames: userModifiedAflGamesRef.current === true,
                        timestamp: Date.now(),
                      })
                    );
                  } catch {
                    // Ignore
                  }
                  aflRetryTimeoutsRef.current.forEach((id) => clearTimeout(id));
                  aflRetryTimeoutsRef.current = [];
                }
              }, delay);
              timeouts.push(t);
            });
            aflRetryTimeoutsRef.current = timeouts;
          }
          if (!cancelled) {
            setSecondaryPropsFetchComplete(true);
            setAflPropsLoading(false);
          }
          return;
        }
        if (canReplaceSecondaryProps(propsToCommit)) {
          commitSecondaryProps(propsToCommit);
          if (games.length > 0) {
            syncSelectedAflGames(games.map((g) => g.gameId));
          }
          if (!cancelled) {
            setAflIngestMessage(result.ingestMessage ?? null);
            setAflLastUpdated(result.lastUpdated ?? null);
            try {
              const existing = isTennisPropsSport(listSport)
                ? readSecondaryPropsSessionCache(listSport)
                : null;
              const toCache = {
                props: existing
                  ? preferTennisPropsForPaint(existing.props, propsToCommit)
                  : propsToCommit,
                games,
                selectedGameIds: getSelectedAflGameIdsForCache(
                  games.length > 0 ? games.map((g) => g.gameId) : []
                ),
                userModifiedGames: userModifiedAflGamesRef.current === true,
                timestamp: Date.now(),
              };
              if (listSport !== 'afl' || propsToCommit.length > 0) {
                sessionStorage.setItem(cacheKey, JSON.stringify(toCache));
              }
            } catch {
              // Ignore cache write (quota, etc.)
            }
          }
        } else if (games.length > 0) {
          setAflGames(games);
          syncSelectedAflGames(games.map((g) => g.gameId));
        }
        if (needsAflStatsBackfill && !cancelled && isOnPropsPage()) {
          void backfillAflPropStatsBatch(aggregated).then((backfilled) => {
            if (cancelled || secondaryListSportRef.current !== listSport || !backfilled || !isOnPropsPage()) return;
            commitSecondaryProps(backfilled);
            try {
              sessionStorage.setItem(
                cacheKey,
                JSON.stringify({
                  props: backfilled,
                  games,
                  selectedGameIds: getSelectedAflGameIdsForCache(
                    games.length > 0 ? games.map((g) => g.gameId) : []
                  ),
                  userModifiedGames: userModifiedAflGamesRef.current === true,
                  timestamp: Date.now(),
                })
              );
            } catch {
              // Ignore cache write (quota, etc.)
            }
          });
        }
      } catch (e) {
        if (
          !cancelled &&
          !hadNonEmptyFresh &&
          !hasVisibleSecondaryRows &&
          secondaryListSportRef.current === listSport
        ) {
          setAflGames([]);
          commitSecondaryProps([]);
        }
      } finally {
        if (!cancelled) {
          setSecondaryPropsFetchComplete(true);
          setAflPropsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      abortAflPropsStatsBackfill();
      if (aflListFetchInFlightRef.current?.sport === listSport) {
        aflListFetchInFlightRef.current = null;
      }
      aflRetryTimeoutsRef.current.forEach((id) => clearTimeout(id));
      aflRetryTimeoutsRef.current = [];
    };
  }, [propsSport, aflPropsRetryKey, aggregateSecondaryListPayload, setSecondaryPropsFetchComplete]);

  // Combined mode loads NBA + AFL + tennis from /api/props/combined.
  useEffect(() => {
    if (propsSport !== 'combined') return;

    const partialRefetchFlags = () => ({
      afl: combinedPartialAflRefetchAttemptedRef.current,
    });

    const buildProgressiveSnapshot = (
      slice: Partial<CombinedPropsSnapshotResponse>
    ): CombinedPropsSnapshotResponse => ({
      success: true,
      snapshotVersion: 1,
      generatedAt: new Date().toISOString(),
      staleAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      nba: slice.nba ?? {
        ok: playerPropsRef.current.length > 0,
        status: 200,
        cached: true,
        lastUpdated: null,
        gameDate: null,
        props: playerPropsRef.current,
      },
      afl: slice.afl ?? {
        ok: combinedModeHasAflRows(aflPropsRef.current),
        status: 200,
        lastUpdated: null,
        nextUpdate: null,
        ingestMessage: null,
        noAflOdds: combinedOddsFlagsRef.current.noAflOdds,
        games: [],
        props: aflPropsRef.current,
      },
      tennis: slice.tennis ?? {
        ok: tennisCombinedPropsRef.current.some(isTennisListProp),
        status: 200,
        lastUpdated: null,
        nextUpdate: null,
        ingestMessage: null,
        noTennisOdds: false,
        games: [],
        props: tennisCombinedPropsRef.current.filter(isTennisListProp),
      },
      nbl: slice.nbl ?? {
        ok: nblCombinedPropsRef.current.some(isNblListProp),
        status: 200,
        lastUpdated: null,
        nextUpdate: null,
        ingestMessage: null,
        noNblOdds: nblCombinedPropsRef.current.length === 0,
        games: [],
        props: nblCombinedPropsRef.current.filter(isNblListProp),
      },
    });

    const launchNbaProgressiveFetch = () => {
      if (NBA_PUBLIC_ENABLED && playerPropsRef.current.length === 0) {
        void fetch('/api/nba/player-props', { cache: 'default' })
          .then(async (nbaResponse) => {
            const nbaPayload = await nbaResponse.json().catch(() => null);
            if (!nbaResponse.ok || !Array.isArray(nbaPayload?.data) || nbaPayload.data.length === 0) return;
            applyCombinedSnapshot(
              buildProgressiveSnapshot({
                nba: {
                  ok: true,
                  status: nbaResponse.status,
                  cached: nbaPayload?.cached === true,
                  lastUpdated: typeof nbaPayload?.lastUpdated === 'string' ? nbaPayload.lastUpdated : null,
                  gameDate: typeof nbaPayload?.gameDate === 'string' ? nbaPayload.gameDate : null,
                  props: nbaPayload.data as PlayerProp[],
                },
              }),
              { persistCaches: false }
            );
          })
          .catch(() => {});
      }
    };

    const refillMissingSecondarySlices = async (
      payload: CombinedPropsSnapshotResponse,
      debugStats: boolean
    ) => {
      if (!isOnPropsPage()) return;
      const mergedAfl = preferAflPropsForCombined(
        aflPropsRef.current,
        Array.isArray(payload?.afl?.props) ? payload.afl.props : []
      );
      const oddsFlags = {
        noAflOdds: payload?.afl?.noAflOdds === true && mergedAfl.length === 0,
      };
      const { missingAfl } = combinedModeMissingSecondarySlice(mergedAfl, oddsFlags);
      const wantsAflStats =
        isOnPropsPage() &&
        (propsSportRef.current === 'combined' || propsSportRef.current === 'afl');

      if (missingAfl && !combinedPartialAflRefetchAttemptedRef.current && wantsAflStats) {
        try {
          const aflUrl = getSecondaryPropsListUrl('afl', debugStats);
          const aflResponse = await fetch(aflUrl, { cache: 'no-store' });
          const aflPayload = await aflResponse.json();
          const aflResult = aggregateAflListPayload(aflPayload);
          let aflPropsForSnapshot = aflResult.aggregated;
          if (
            isOnPropsPage() &&
            (propsSportRef.current === 'combined' || propsSportRef.current === 'afl') &&
            aflPropsForSnapshot.length > 0 &&
            aflPropsNeedStatsBackfill(aflPropsForSnapshot)
          ) {
            const backfilled = await backfillAflPropStatsBatch(aflPropsForSnapshot);
            if (backfilled && isOnPropsPage()) aflPropsForSnapshot = backfilled;
          }
          if (aflPropsForSnapshot.length > 0 && isOnPropsPage()) {
            applyCombinedSnapshot(
              buildProgressiveSnapshot({
                afl: {
                  ok: true,
                  status: aflResponse.status,
                  lastUpdated: aflResult.lastUpdated ?? null,
                  nextUpdate: aflResult.nextUpdate ?? null,
                  ingestMessage: aflResult.ingestMessage ?? null,
                  noAflOdds: aflResult.noAflOdds === true,
                  games: aflResult.games,
                  props: aflPropsForSnapshot,
                  debugMeta: aflResult.debugMeta ?? null,
                },
              }),
              { persistCaches: false }
            );
          }
        } catch {
          // ignore AFL refill errors
        }
        combinedPartialAflRefetchAttemptedRef.current = true;
      }

      if (
        isOnPropsPage() &&
        (propsSportRef.current === 'combined' || propsSportRef.current === 'afl') &&
        !missingAfl &&
        mergedAfl.length > 0 &&
        aflPropsNeedStatsBackfill(mergedAfl) &&
        !combinedPartialAflRefetchAttemptedRef.current
      ) {
        try {
          const backfilled = await backfillAflPropStatsBatch(mergedAfl);
          if (backfilled && isOnPropsPage() && !aflPropsNeedStatsBackfill(backfilled)) {
            applyCombinedSnapshot(
              buildProgressiveSnapshot({
                afl: {
                  ok: true,
                  status: 200,
                  lastUpdated: payload?.afl?.lastUpdated ?? null,
                  nextUpdate: payload?.afl?.nextUpdate ?? null,
                  ingestMessage: payload?.afl?.ingestMessage ?? null,
                  noAflOdds: payload?.afl?.noAflOdds === true,
                  games: Array.isArray(payload?.afl?.games) ? payload.afl.games : [],
                  props: backfilled,
                  debugMeta: payload?.afl?.debugMeta ?? null,
                },
              }),
              { persistCaches: false }
            );
          }
        } catch {
          // ignore AFL stats refill errors
        }
        combinedPartialAflRefetchAttemptedRef.current = true;
      }

      const tennisNow = [
        ...tennisCombinedPropsRef.current.filter(isTennisListProp),
        ...(Array.isArray(payload?.tennis?.props) ? payload.tennis.props.filter(isTennisListProp) : []),
      ];
      const hasAtp = tennisPropsForTour(tennisNow, 'atp').length > 0;
      const hasWta = tennisPropsForTour(tennisNow, 'wta').length > 0;
      if (
        TENNIS_PUBLIC_ENABLED &&
        !combinedPartialTennisRefetchAttemptedRef.current &&
        (!hasAtp || !hasWta)
      ) {
        try {
          const missingBoth = !hasAtp && !hasWta;
          const listUrl = missingBoth
            ? '/api/tennis/player-props/list'
            : getSecondaryPropsListUrl(hasAtp ? 'wta' : 'atp', debugStats);
          const listRes = await fetchSecondaryPropsList(listUrl);
          const listData = await listRes.json();
          const { aggregated, games } = aggregateSecondaryListPayload(
            listData,
            missingBoth ? 'atp' : hasAtp ? 'wta' : 'atp'
          );
          const incoming = aggregated.filter(isTennisListProp);
          if (incoming.length > 0) {
            if (missingBoth && tennisCombinedPropsRef.current.some((row) => tennisBookmakerLineCount(row) > 1)) {
              combinedPartialTennisRefetchAttemptedRef.current = true;
              return;
            }
            const presentRows = missingBoth
              ? []
              : tennisPropsForTour(tennisNow, hasAtp ? 'atp' : 'wta');
            applyCombinedSnapshot(
              buildProgressiveSnapshot({
                tennis: {
                  ok: true,
                  status: listRes.status,
                  lastUpdated: null,
                  nextUpdate: null,
                  ingestMessage: null,
                  noTennisOdds: false,
                  games,
                  props: [...presentRows, ...incoming],
                },
              }),
              { persistCaches: false }
            );
          }
        } catch {
          // ignore tennis refill errors
        }
        combinedPartialTennisRefetchAttemptedRef.current = true;
      }

      if (
        isOnPropsPage() &&
        (propsSportRef.current === 'combined' || propsSportRef.current === 'nbl') &&
        nblLooksMissingUnibet([
          ...nblCombinedPropsRef.current,
          ...((Array.isArray(payload?.nbl?.props) ? payload.nbl.props : []) as PlayerProp[]),
        ])
      ) {
        try {
          const listRes = await fetchSecondaryPropsList('/api/nbl/player-props/list');
          const listData = await listRes.json();
          const { aggregated, games } = aggregateSecondaryListPayload(listData, 'nbl');
          const incoming = aggregated.filter(isNblListProp);
          if (incoming.length > 0) {
            applyCombinedSnapshot(
              buildProgressiveSnapshot({
                nbl: {
                  ok: true,
                  status: listRes.status,
                  lastUpdated: null,
                  nextUpdate: null,
                  ingestMessage: null,
                  noNblOdds: false,
                  games,
                  props: incoming,
                },
              }),
              { persistCaches: false }
            );
          }
        } catch {
          // ignore NBL refill errors
        }
      }
    };

    const fetchCombinedProps = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const forceRefresh = urlParams.get('refresh') === '1';
      const debugStats = urlParams.get('debugStats') === '1';

      if (skipPropsRefetchOnceRef.current && !forceRefresh && !debugStats) {
        skipPropsRefetchOnceRef.current = false;
        setCombinedPropsLoading(false);
        setPropsLoading(false);
        setAflPropsLoading(false);
        return;
      }

      if (
        !forceRefresh &&
        !debugStats &&
        combinedPropsFetchCompleteRef.current &&
        combinedModeHasVisibleRows(
          playerPropsRef.current,
          aflPropsRef.current,
          tennisCombinedPropsRef.current,
          nblCombinedPropsRef.current
        ) &&
        !combinedModeNeedsDataRefresh(
          playerPropsRef.current,
          aflPropsRef.current,
          partialRefetchFlags(),
          combinedOddsFlagsRef.current
        )
      ) {
        setCombinedPropsLoading(false);
        setPropsLoading(false);
        setAflPropsLoading(false);
        setCombinedPaintUnlocked(
          isCombinedSecondaryPaintReady(aflPropsRef.current, combinedOddsFlagsRef.current)
        );
        return;
      }

      if (combinedWarmToggleRef.current && !forceRefresh && !debugStats) {
        combinedWarmToggleRef.current = false;
        if (
          !combinedModeNeedsDataRefresh(
            playerPropsRef.current,
            aflPropsRef.current,
            partialRefetchFlags(),
            combinedOddsFlagsRef.current
          )
        ) {
          setCombinedPaintUnlocked(
            isCombinedSecondaryPaintReady(aflPropsRef.current, combinedOddsFlagsRef.current)
          );
          return;
        }
      }
      combinedWarmToggleRef.current = false;

      const hasWarmCombinedCache =
        combinedPropsFetchCompleteRef.current ||
        combinedModeHasVisibleRows(
          playerPropsRef.current,
          aflPropsRef.current,
          tennisCombinedPropsRef.current,
          nblCombinedPropsRef.current
        );

      if (!hasWarmCombinedCache) {
        setCombinedPaintUnlocked(false);
        setCombinedPropsLoading(true);
        setPropsLoading(true);
        if (propsSportRef.current === 'combined' || propsSportRef.current === 'afl') {
          setAflPropsLoading(true);
        }
      }

      if (NBA_PUBLIC_ENABLED && playerPropsRef.current.length === 0) {
        launchNbaProgressiveFetch();
      }

      void (async () => {
        if (aflPropsRef.current.some(isAflCombinedListProp)) {
          setCombinedPaintUnlocked(true);
          setAflPropsLoading(false);
          return;
        }
        try {
          const listRes = await fetchSecondaryPropsList(getSecondaryPropsListUrl('afl', debugStats));
          const listData = await listRes.json();
          const aflResult = aggregateAflListPayload(listData);
          if (!listRes.ok || aflResult.aggregated.length === 0) return;
          applyCombinedSnapshot(
            {
              success: true,
              snapshotVersion: 1,
              generatedAt: new Date().toISOString(),
              staleAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
              nba: {
                ok: playerPropsRef.current.length > 0,
                status: 200,
                cached: true,
                lastUpdated: null,
                gameDate: null,
                props: playerPropsRef.current,
              },
              afl: {
                ok: true,
                status: listRes.status,
                lastUpdated: aflResult.lastUpdated ?? null,
                nextUpdate: aflResult.nextUpdate ?? null,
                ingestMessage: aflResult.ingestMessage ?? null,
                noAflOdds: aflResult.noAflOdds === true,
                games: aflResult.games,
                props: aflResult.aggregated,
              },
            },
            { persistCaches: false }
          );
        } catch {
          // AFL must paint even if tennis/combined is still hanging.
        }
      })();

      void (async () => {
        if (!TENNIS_PUBLIC_ENABLED) return;
        if (tennisCombinedPropsRef.current.some(isTennisListProp)) return;
        try {
          const listRes = await fetchSecondaryPropsList('/api/tennis/player-props/list');
          const listData = await listRes.json();
          const { aggregated, games } = aggregateSecondaryListPayload(listData, 'atp');
          const tennisRows = aggregated.filter(isTennisListProp);
          if (!listRes.ok || tennisRows.length === 0) return;
          if (tennisCombinedPropsRef.current.some((row) => tennisBookmakerLineCount(row) > 1)) return;
          applyCombinedSnapshot(
            buildProgressiveSnapshot({
              tennis: {
                ok: true,
                status: listRes.status,
                lastUpdated: null,
                nextUpdate: null,
                ingestMessage: null,
                noTennisOdds: false,
                games,
                props: tennisRows,
              },
            }),
            { persistCaches: false }
          );
        } catch {
          // Tennis paints from its own list; combined AFL must stay visible.
        }
      })();

      void (async () => {
        if (!nblLooksMissingUnibet(nblCombinedPropsRef.current)) return;
        try {
          const listRes = await fetchSecondaryPropsList('/api/nbl/player-props/list');
          const listData = await listRes.json();
          const { aggregated, games } = aggregateSecondaryListPayload(listData, 'nbl');
          const nblRows = aggregated.filter(isNblListProp);
          if (!listRes.ok || nblRows.length === 0) return;
          applyCombinedSnapshot(
            buildProgressiveSnapshot({
              nbl: {
                ok: true,
                status: listRes.status,
                lastUpdated: null,
                nextUpdate: null,
                ingestMessage: null,
                noNblOdds: false,
                games,
                props: nblRows,
              },
            }),
            { persistCaches: false }
          );
        } catch {
          // NBL paints from its own list cache; other sports stay visible.
        }
      })();

      const params = new URLSearchParams();
      if (forceRefresh) params.set('refresh', '1');
      if (debugStats) params.set('debugStats', '1');
      const combinedUrl = `/api/props/combined${params.toString() ? `?${params.toString()}` : ''}`;

      try {
        let payload =
          !forceRefresh && !debugStats
            ? ((await takeCombinedPropsEarlyPayload()) as CombinedPropsSnapshotResponse | null)
            : null;

        if (!payload) {
          const response = await fetch(combinedUrl, {
            cache: 'no-store',
          });
          payload = (await response.json().catch(() => null)) as CombinedPropsSnapshotResponse | null;
          if (!response.ok || !payload?.success || (!payload?.nba?.ok && !payload?.afl?.ok && !payload?.tennis?.ok && !payload?.nbl?.ok)) {
            throw new Error(payload?.error || 'Failed to load combined props');
          }
        } else if (!payload?.success || (!payload?.nba?.ok && !payload?.afl?.ok && !payload?.tennis?.ok && !payload?.nbl?.ok)) {
          throw new Error(payload?.error || 'Failed to load combined props');
        }

        applyCombinedSnapshot(payload, {
          persistCaches: (payload?.tennis?.props?.length || 0) > 0 || (payload?.nbl?.props?.length || 0) > 0,
        });
        void refillMissingSecondarySlices(payload, debugStats);
        const completeAfterSnapshot = !combinedModeNeedsDataRefresh(
          playerPropsRef.current,
          aflPropsRef.current,
          partialRefetchFlags(),
          combinedOddsFlagsRef.current
        );
        setCombinedFetchComplete(completeAfterSnapshot);
        setCombinedPropsLoading(!completeAfterSnapshot);
        setPropsLoading(!completeAfterSnapshot && playerPropsRef.current.length === 0);
        if (propsSportRef.current === 'combined' || propsSportRef.current === 'afl') {
          setAflPropsLoading(
            !completeAfterSnapshot && !combinedModeHasVisibleRows([], aflPropsRef.current)
          );
        }
      } catch (error) {
        console.warn('[Props] Combined payload fetch failed, falling back to direct parallel requests:', error);
        try {
          const [nbaResponse, aflResponse] = await Promise.all([
            NBA_PUBLIC_ENABLED
              ? fetch('/api/nba/player-props', { cache: forceRefresh ? 'no-store' : 'default' })
              : Promise.resolve(
                  new Response(JSON.stringify({ success: true, data: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                  })
                ),
            fetch(getSecondaryPropsListUrl('afl', debugStats), { cache: 'no-store' }),
          ]);
          const [nbaPayload, aflPayload] = await Promise.all([
            nbaResponse.json().catch(() => null),
            aflResponse.json().catch(() => null),
          ]);
          if (!nbaResponse.ok && !aflResponse.ok) {
            throw new Error('Fallback combined props requests failed');
          }
          const aflResult = aggregateAflListPayload(aflPayload);
          applyCombinedSnapshot({
            success: true,
            snapshotVersion: 1,
            generatedAt: new Date().toISOString(),
            staleAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
            nba: {
              ok: nbaResponse.ok,
              status: nbaResponse.status,
              cached: nbaPayload?.cached === true,
              lastUpdated: typeof nbaPayload?.lastUpdated === 'string' ? nbaPayload.lastUpdated : null,
              gameDate: typeof nbaPayload?.gameDate === 'string' ? nbaPayload.gameDate : null,
              props: nbaResponse.ok && Array.isArray(nbaPayload?.data) ? (nbaPayload.data as PlayerProp[]) : [],
            },
            afl: {
              ok: aflResponse.ok,
              status: aflResponse.status,
              lastUpdated: aflResult.lastUpdated ?? null,
              nextUpdate: aflResult.nextUpdate ?? null,
              ingestMessage: aflResult.ingestMessage ?? null,
              noAflOdds: aflResult.noAflOdds === true,
              games: aflResult.games,
              props: aflResult.aggregated,
              debugMeta: aflResult.debugMeta ?? null,
            },
          });
          combinedPartialAflRefetchAttemptedRef.current = true;
          setCombinedFetchComplete(true);
        } catch (fallbackError) {
          console.error('[Props] Failed to load combined props:', fallbackError);
          setCombinedFetchComplete(
            combinedModeHasVisibleRows(playerPropsRef.current, aflPropsRef.current, tennisCombinedPropsRef.current, nblCombinedPropsRef.current)
          );
          setCombinedPropsLoading(false);
          setPropsLoading(false);
          setAflPropsLoading(false);
        }
      }
    };

    if (!combinedLoadPromiseRef.current) {
      combinedFetchInFlightRef.current = true;
      combinedLoadPromiseRef.current = fetchCombinedProps().finally(() => {
        combinedFetchInFlightRef.current = false;
        combinedLoadPromiseRef.current = null;
      });
    }

    void combinedLoadPromiseRef.current;
    return () => {
      abortAflPropsStatsBackfill();
    };
  }, [aggregateAflListPayload, aggregateSecondaryListPayload, applyCombinedSnapshot, propsSport, setCombinedFetchComplete]);

  // Fetch AFL league player stats for jumper numbers (for circle placeholder)
  useEffect(() => {
    if ((propsSport !== 'afl' && propsSport !== 'combined') || aflProps.length === 0) return;
    const season = new Date().getFullYear();
    Promise.all([
      fetch(`/api/afl/league-player-stats?season=${season}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/afl/league-player-stats?season=${season - 1}`).then((r) => r.ok ? r.json() : null),
    ]).then(([curr, prev]) => {
      const map: Record<string, number> = {};
      const add = (data: { players?: Array<{ name?: string; number?: number }> } | null) => {
        if (!data?.players) return;
        for (const p of data.players) {
          const name = (p?.name ?? '').trim();
          const num = typeof p?.number === 'number' && Number.isFinite(p.number) ? p.number : null;
          if (name && num != null) map[name] = num;
        }
      };
      add(prev);
      add(curr);
      setAflPlayerNumbers(map);
    }).catch(() => {});
  }, [propsSport, aflProps.length]);

  // Fetch AFL team logos for matchup display (when on AFL tab)
  useEffect(() => {
    if (propsSport !== 'afl' && propsSport !== 'combined') return;
    let hasFreshCache = false;
    try {
      let cachedMap: Record<string, string> | null = null;
      const cachedRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_KEY);
      const cachedTsRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_TS_KEY);
      const cachedTs = cachedTsRaw ? parseInt(cachedTsRaw, 10) : 0;
      const age = Number.isFinite(cachedTs) ? Date.now() - cachedTs : Infinity;
      if (cachedRaw && age < AFL_TEAM_LOGOS_CACHE_TTL_MS) {
        const parsed = JSON.parse(cachedRaw);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          cachedMap = parsed as Record<string, string>;
        }
      }
      if (!cachedMap) {
        const lsRaw = localStorage.getItem(AFL_TEAM_LOGOS_LS_KEY);
        const lsTsRaw = localStorage.getItem(AFL_TEAM_LOGOS_LS_TS_KEY);
        const lsTs = lsTsRaw ? parseInt(lsTsRaw, 10) : 0;
        const lsAge = Number.isFinite(lsTs) ? Date.now() - lsTs : Infinity;
        if (lsRaw && lsAge < AFL_TEAM_LOGOS_LS_TTL_MS) {
          const parsed = JSON.parse(lsRaw);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            cachedMap = parsed as Record<string, string>;
            try {
              sessionStorage.setItem(AFL_TEAM_LOGOS_CACHE_KEY, JSON.stringify(cachedMap));
              sessionStorage.setItem(AFL_TEAM_LOGOS_CACHE_TS_KEY, Date.now().toString());
            } catch {
              // ignore
            }
          }
        }
      }
      if (cachedMap) {
        setAflLogoByTeam(cachedMap);
        for (const url of Object.values(cachedMap)) warmImage(url);
        hasFreshCache = true;
      }
    } catch {
      // ignore cache read errors
    }

    if (hasFreshCache) return;

    fetch('/api/afl/team-logos', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { logos?: Record<string, string> } | null) => {
        if (data?.logos && typeof data.logos === 'object' && Object.keys(data.logos).length > 0) {
          setAflLogoByTeam(data.logos);
          for (const url of Object.values(data.logos)) warmImage(url);
          try {
            const serialized = JSON.stringify(data.logos);
            const now = Date.now().toString();
            sessionStorage.setItem(AFL_TEAM_LOGOS_CACHE_KEY, serialized);
            sessionStorage.setItem(AFL_TEAM_LOGOS_CACHE_TS_KEY, now);
            localStorage.setItem(AFL_TEAM_LOGOS_LS_KEY, serialized);
            localStorage.setItem(AFL_TEAM_LOGOS_LS_TS_KEY, now);
          } catch {
            // ignore cache write errors
          }
        }
      })
      .catch(() => {});
  }, [propsSport]);

  useEffect(() => {
    if (propsSport !== 'nbl' && propsSport !== 'combined') return;
    if (Object.keys(nblLogoByTeam).length > 0) return;
    fetch('/api/nbl/team-logos', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { logoByTeam?: Record<string, string> } | null) => {
        if (data?.logoByTeam && typeof data.logoByTeam === 'object' && Object.keys(data.logoByTeam).length > 0) {
          setNblLogoByTeam(data.logoByTeam);
          for (const url of Object.values(data.logoByTeam)) warmImage(url);
        }
      })
      .catch(() => {});
  }, [propsSport, nblLogoByTeam]);

  const secondaryGameFilterApplies = useMemo(() => {
    if (selectedAflGames.size === 0) return false;
    return activeSecondaryProps.some((p) => p.gameId && selectedAflGames.has(p.gameId));
  }, [activeSecondaryProps, selectedAflGames]);

  const liveEligibleAflPropsCount = useMemo(
    () => activeSecondaryProps.filter((prop) => isAflCommenceTimePropsEligible(prop.gameDate)).length,
    [activeSecondaryProps]
  );

  const filteredAflProps = useMemo(() => {
    const filtered = activeSecondaryProps.filter((prop) => {
      if (!isAflCommenceTimePropsEligible(prop.gameDate)) return false;
      
      if (isTennisPropsSport(propsSport) && !isTennisPropStatType(prop.statType)) return false;
      if (
        isTennisPropsSport(propsSport) &&
        propsSportFromTennisTour(prop.team || prop.homeTeamCode) !== propsSport
      ) {
        return false;
      }
      
      if (debouncedSearchQuery.trim()) {
        const q = debouncedSearchQuery.toLowerCase();
        if (!prop.playerName.toLowerCase().includes(q) && !getStatLabel(prop.statType).toLowerCase().includes(q)) return false;
      }
      if (selectedPropTypes.size > 0 && !selectedPropTypes.has(prop.statType)) return false;
      if (selectedBookmakers.size > 0) {
        const bms = new Set<string>();
        prop.bookmakerLines?.forEach((l) => l.bookmaker && bms.add(l.bookmaker));
        if (prop.bookmaker) bms.add(prop.bookmaker);
        if (!Array.from(bms).some((bm) => selectedBookmakers.has(bm))) return false;
      }
      if (
        isTennisPropsSport(propsSport) &&
        !tennisPlayerPassesRankFilter(prop.playerRank, tennisMaxRank)
      ) {
        return false;
      }
      if (
        !isTennisPropsSport(propsSport) &&
        secondaryGameFilterApplies &&
        prop.gameId &&
        !selectedAflGames.has(prop.gameId)
      ) {
        return false;
      }
      return true;
    });
    return isTennisPropsSport(propsSport)
      ? collapseTennisRowsToPrimaryMarketLine(filtered)
      : filtered;
  }, [activeSecondaryProps, propsSport, debouncedSearchQuery, selectedPropTypes, selectedBookmakers, selectedAflGames, secondaryGameFilterApplies, tennisMaxRank, getStatLabel]);

  // Combined mode: minimal filters only (search + sort + pagination).
  const filteredCombinedProps = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    const isExcludedCombinedNbaStat = (statType: string) => {
      const normalized = String(statType || '').trim().toLowerCase();
      return normalized === 'blk' || normalized === 'blocks' || normalized === 'stl' || normalized === 'steals';
    };
    const isBetwayBookmaker = (name: string | undefined) => {
      const normalized = String(name || '').trim().toLowerCase().replace(/\s+/g, '');
      return normalized === 'betway';
    };
    const removeBetwayLines = (prop: PlayerProp): PlayerProp | null => {
      const filteredLines = (prop.bookmakerLines || []).filter((line) => !isBetwayBookmaker(line.bookmaker));
      const fallbackBookmakerIsBetway = isBetwayBookmaker(prop.bookmaker);
      if (filteredLines.length === 0 && fallbackBookmakerIsBetway) return null;

      if (filteredLines.length > 0) {
        const primary = filteredLines[0];
        return {
          ...prop,
          bookmakerLines: filteredLines,
          bookmaker: primary.bookmaker || prop.bookmaker,
          line: Number.isFinite(primary.line) ? primary.line : prop.line,
          bestLine: Number.isFinite(primary.line) ? primary.line : prop.bestLine,
          overOdds: primary.overOdds || prop.overOdds,
          underOdds: primary.underOdds || prop.underOdds,
        };
      }

      const synthesized = tennisDisplayBookmakerLines(prop).filter((line) => !isBetwayBookmaker(line.bookmaker));
      if (synthesized.length === 0) return fallbackBookmakerIsBetway ? null : prop;
      return {
        ...prop,
        bookmakerLines: synthesized,
        bookmaker: synthesized[0]?.bookmaker || prop.bookmaker,
        overOdds: synthesized[0]?.overOdds || prop.overOdds,
        underOdds: synthesized[0]?.underOdds || prop.underOdds,
      };
    };
    const mapWithSport = <T extends PlayerProp>(list: T[], sportSource: CombinedSportSource) => {
      return list
        .filter((prop) => {
          if (sportSource === 'nba' && isExcludedCombinedNbaStat(prop.statType)) return false;
          if (!q) return true;
          return (
            prop.playerName.toLowerCase().includes(q) ||
            getStatLabel(prop.statType).toLowerCase().includes(q)
          );
        })
        .map((prop) => removeBetwayLines(prop))
        .filter((prop): prop is PlayerProp => prop !== null)
        .map((prop) => ({ ...prop, sportSource }));
    };
    const assembled = [
      ...mapWithSport(playerProps, 'nba'),
      ...mapWithSport(
        aflProps.filter(
          (prop) => isAflCommenceTimePropsEligible(prop.gameDate) && isAflCombinedListProp(prop)
        ),
        'afl'
      ),
      ...(TENNIS_PUBLIC_ENABLED
        ? [
            ...mapWithSport(
              collapseTennisRowsToPrimaryMarketLine(
                tennisPropsForPaint(
                  tennisCombinedProps.filter(
                    (prop) =>
                      isTennisListProp(prop) &&
                      propsSportFromTennisTour(prop.team || prop.homeTeamCode) === 'atp'
                  )
                ).filter((prop) => isAflCommenceTimePropsEligible(prop.gameDate))
              ),
              'atp'
            ),
            ...mapWithSport(
              collapseTennisRowsToPrimaryMarketLine(
                tennisPropsForPaint(
                  tennisCombinedProps.filter(
                    (prop) =>
                      isTennisListProp(prop) &&
                      propsSportFromTennisTour(prop.team || prop.homeTeamCode) === 'wta'
                  )
                ).filter((prop) => isAflCommenceTimePropsEligible(prop.gameDate))
              ),
              'wta'
            ),
          ]
        : []),
      ...mapWithSport(
        nblCombinedProps.filter((prop) => isAflCommenceTimePropsEligible(prop.gameDate)),
        'nbl'
      ),
    ];
    return collapseCombinedPropsToOnePerPlayer(assembled);
  }, [playerProps, aflProps, tennisCombinedProps, nblCombinedProps, debouncedSearchQuery, getStatLabel, propsSport]);

  const displaySortedCombinedProps = useMemo(() => {
    const percent = (hitRate?: { hits: number; total: number } | null) =>
      hitRate && hitRate.total > 0 ? (hitRate.hits / hitRate.total) * 100 : null;
    const out = [...filteredCombinedProps];

    if (propLineSort === 'high') {
      out.sort((a, b) => b.line - a.line);
      return out;
    }
    if (propLineSort === 'low') {
      out.sort((a, b) => a.line - b.line);
      return out;
    }

    const activeColumnSort = Object.entries(columnSort).find(([_, dir]) => dir !== 'none');
    if (activeColumnSort) {
      const [column, direction] = activeColumnSort;
      out.sort((a, b) => {
        let aVal: number | null = null;
        let bVal: number | null = null;
        if (column === 'dvp') {
          aVal = a.dvpRating ?? null;
          bVal = b.dvpRating ?? null;
          if (aVal === null && bVal === null) return 0;
          if (aVal === null) return 1;
          if (bVal === null) return -1;
          return direction === 'asc' ? bVal - aVal : aVal - bVal;
        }
        if (column === 'l5') { aVal = percent(a.last5HitRate); bVal = percent(b.last5HitRate); }
        else if (column === 'l10') { aVal = percent(a.last10HitRate); bVal = percent(b.last10HitRate); }
        else if (column === 'h2h') { aVal = percent(a.h2hHitRate); bVal = percent(b.h2hHitRate); }
        else if (column === 'season') { aVal = percent(a.seasonHitRate); bVal = percent(b.seasonHitRate); }
        else if (column === 'streak') { aVal = a.streak ?? null; bVal = b.streak ?? null; }
        else if (column === 'ip') {
          aVal = getConsensusImpliedProbabilities(a).overProb;
          bVal = getConsensusImpliedProbabilities(b).overProb;
        }
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        return direction === 'asc' ? bVal - aVal : aVal - bVal;
      });
      return out;
    }

    out.sort((a, b) => {
      const aL10Total = a.last10HitRate?.total ?? 0;
      const bL10Total = b.last10HitRate?.total ?? 0;
      const aHasFullL10 = aL10Total >= 10;
      const bHasFullL10 = bL10Total >= 10;
      if (aHasFullL10 !== bHasFullL10) return aHasFullL10 ? -1 : 1;
      const aL10 = percent(a.last10HitRate);
      const bL10 = percent(b.last10HitRate);
      if (aL10 !== null || bL10 !== null) return (bL10 ?? -1) - (aL10 ?? -1);
      const aL5 = percent(a.last5HitRate);
      const bL5 = percent(b.last5HitRate);
      if (aL5 !== null || bL5 !== null) return (bL5 ?? -1) - (aL5 ?? -1);
      const aDvp = a.dvpRating != null && a.dvpRating > 0 ? a.dvpRating : null;
      const bDvp = b.dvpRating != null && b.dvpRating > 0 ? b.dvpRating : null;
      if (aDvp !== null || bDvp !== null) {
        const aR = aDvp ?? 999;
        const bR = bDvp ?? 999;
        if (aR !== bR) return aR - bR;
      }
      const aConsensus = getConsensusImpliedProbabilities(a);
      const bConsensus = getConsensusImpliedProbabilities(b);
      const aP = Math.max(aConsensus.overProb ?? 0, aConsensus.underProb ?? 0);
      const bP = Math.max(bConsensus.overProb ?? 0, bConsensus.underProb ?? 0);
      return bP - aP;
    });
    return out;
  }, [filteredCombinedProps, propLineSort, columnSort]);

  // AFL: same "best to worst" default sort as NBA (DvP best first, then L10%, L5%, prob); column sort when active
  const displaySortedAflProps = useMemo(() => {
    const percent = (hitRate?: { hits: number; total: number } | null) =>
      hitRate && hitRate.total > 0 ? (hitRate.hits / hitRate.total) * 100 : null;
    const out = [...filteredAflProps];
    if (propLineSort === 'high') {
      out.sort((a, b) => b.line - a.line);
      return out;
    }
    if (propLineSort === 'low') {
      out.sort((a, b) => a.line - b.line);
      return out;
    }
    const activeColumnSort = Object.entries(columnSort).find(([_, dir]) => dir !== 'none');
    if (activeColumnSort) {
      const [column, direction] = activeColumnSort;
      out.sort((a, b) => {
        let aVal: number | null = null;
        let bVal: number | null = null;
        if (column === 'dvp') {
          aVal = a.dvpRating ?? null;
          bVal = b.dvpRating ?? null;
          if (aVal === null && bVal === null) return 0;
          if (aVal === null) return 1;
          if (bVal === null) return -1;
          return direction === 'asc' ? bVal - aVal : aVal - bVal;
        }
        if (column === 'l5') { aVal = percent(a.last5HitRate); bVal = percent(b.last5HitRate); }
        else if (column === 'l10') { aVal = percent(a.last10HitRate); bVal = percent(b.last10HitRate); }
        else if (column === 'h2h') { aVal = percent(a.h2hHitRate); bVal = percent(b.h2hHitRate); }
        else if (column === 'season') { aVal = percent(a.seasonHitRate); bVal = percent(b.seasonHitRate); }
        else if (column === 'streak') { aVal = a.streak ?? null; bVal = b.streak ?? null; }
        else if (column === 'ip') {
          aVal = getConsensusImpliedProbabilities(a).overProb;
          bVal = getConsensusImpliedProbabilities(b).overProb;
        }
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        return direction === 'asc' ? bVal - aVal : aVal - bVal;
      });
      return out;
    }
    // Default (AFL): best from L10 first, then L5, then DvP, then implied prob.
    // This matches the manual "best from last 10" user action.
    out.sort((a, b) => {
      const aL10Total = a.last10HitRate?.total ?? 0;
      const bL10Total = b.last10HitRate?.total ?? 0;
      const aHasFullL10 = aL10Total >= 10;
      const bHasFullL10 = bL10Total >= 10;
      // Prioritize props with a full 10-game sample; smaller samples stay visible but rank later.
      if (aHasFullL10 !== bHasFullL10) return aHasFullL10 ? -1 : 1;

      const aL10 = percent(a.last10HitRate);
      const bL10 = percent(b.last10HitRate);
      if (aL10 !== null || bL10 !== null) return (bL10 ?? -1) - (aL10 ?? -1);

      const aL5 = percent(a.last5HitRate);
      const bL5 = percent(b.last5HitRate);
      if (aL5 !== null || bL5 !== null) return (bL5 ?? -1) - (aL5 ?? -1);

      const aDvp = a.dvpRating != null && a.dvpRating > 0 ? a.dvpRating : null;
      const bDvp = b.dvpRating != null && b.dvpRating > 0 ? b.dvpRating : null;
      if (aDvp !== null || bDvp !== null) {
        const aR = aDvp ?? 999;
        const bR = bDvp ?? 999;
        if (aR !== bR) return aR - bR;
      }
      const aConsensus = getConsensusImpliedProbabilities(a);
      const bConsensus = getConsensusImpliedProbabilities(b);
      const aP = Math.max(aConsensus.overProb ?? 0, aConsensus.underProb ?? 0);
      const bP = Math.max(bConsensus.overProb ?? 0, bConsensus.underProb ?? 0);
      return bP - aP;
    });
    return out;
  }, [filteredAflProps, propLineSort, columnSort]);

  const ITEMS_PER_PAGE = 20;
  const aflTotalPages = Math.max(1, Math.ceil(displaySortedAflProps.length / ITEMS_PER_PAGE));
  const finalPaginatedAflProps = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return displaySortedAflProps.slice(start, start + ITEMS_PER_PAGE);
  }, [displaySortedAflProps, currentPage, ITEMS_PER_PAGE]);
  const combinedTotalPages = Math.max(1, Math.ceil(displaySortedCombinedProps.length / ITEMS_PER_PAGE));
  const finalPaginatedCombinedProps = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return displaySortedCombinedProps.slice(start, start + ITEMS_PER_PAGE);
  }, [displaySortedCombinedProps, currentPage, ITEMS_PER_PAGE]);

  // Track explicitly deselected games (games user clicked to deselect)
  const [deselectedGames, setDeselectedGames] = useState<Set<number>>(() => {
    if (typeof window === 'undefined') return new Set<number>();
    try {
      const saved = localStorage.getItem('nba_filters_deselected_games');
      return saved ? new Set<number>(JSON.parse(saved)) : new Set<number>();
    } catch {
      return new Set<number>();
    }
  });

  // Save deselected games to localStorage
  const saveDeselectedGames = (deselected: Set<number>) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('nba_filters_deselected_games', JSON.stringify(Array.from(deselected)));
      } catch (e) {
        console.warn('[NBA Landing] Failed to save deselected games:', e);
      }
    }
  };

  // NBA: Select all games with props by default (unless explicitly deselected); also fix when selection has no overlap (e.g. after switching from AFL)
  useEffect(() => {
    if (propsSport !== 'nba' || gamesWithProps.length === 0) return;
    const gameIds = new Set(gamesWithProps.map((game) => game.id));
    const hasOverlap = Array.from(selectedGames).some((id) => gameIds.has(id));
    if (selectedGames.size > 0 && hasOverlap) {
      // Add any new games that appeared (unless they were explicitly deselected)
      const newGames = Array.from(gameIds).filter((id) => !selectedGames.has(id) && !deselectedGames.has(id));
      if (newGames.length > 0) {
        const merged = new Set([...Array.from(selectedGames), ...newGames]);
        setSelectedGames(merged);
        saveFiltersToStorage(selectedBookmakers, selectedPropTypes, merged);
      }
      return;
    }
    // No selection or no overlap: select all games except explicitly deselected
    const newSet = new Set(Array.from(gameIds).filter((id) => !deselectedGames.has(id)));
    setSelectedGames(newSet);
    saveFiltersToStorage(selectedBookmakers, selectedPropTypes, newSet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsSport, gamesWithProps, deselectedGames]);

  // Pagination reset is handled by the effect at ~462 that runs on filter/sort change only.
  // Do not depend on playerProps here — it gets new references often and was resetting
  // the page to 1 when the user clicked to another page.

  // Filter player props based on search query and selected filters
  // Filter props based on search, bookmakers, prop types, and games
  const filteredPlayerProps = useMemo(() => {
    return playerProps.filter(prop => {
      // Search filter (using debounced query)
      if (debouncedSearchQuery.trim()) {
        const query = debouncedSearchQuery.toLowerCase();
        const playerNameMatch = prop.playerName.toLowerCase().includes(query);
        const statTypeMatch = getStatLabel(prop.statType).toLowerCase().includes(query);
        if (!playerNameMatch && !statTypeMatch) {
          return false;
        }
      }

      // Prop type filter
      if (selectedPropTypes.size > 0 && !selectedPropTypes.has(prop.statType)) {
        return false;
      }

      // Bookmaker filter - check if prop has any bookmaker from selected list
      if (selectedBookmakers.size > 0) {
        const propBookmakers = new Set<string>();
        if (prop.bookmakerLines && prop.bookmakerLines.length > 0) {
          prop.bookmakerLines.forEach(line => {
            if (line.bookmaker) {
              propBookmakers.add(line.bookmaker);
            }
          });
        }
        if (prop.bookmaker) {
          propBookmakers.add(prop.bookmaker);
        }
        
        // Check if any of the prop's bookmakers are in the selected set
        const hasSelectedBookmaker = Array.from(propBookmakers).some(bm => selectedBookmakers.has(bm));
        if (!hasSelectedBookmaker) {
          return false;
        }
      }

      // Game filter - check if prop belongs to a selected game
      if (shouldApplyNbaGameFilter) {
        const game = getGameForProp(prop);
        if (!game || !selectedGames.has(game.id)) {
          return false;
        }
      }

      return true;
    });
  }, [playerProps, debouncedSearchQuery, selectedBookmakers, selectedPropTypes, selectedGames, shouldApplyNbaGameFilter, getStatLabel, getGameForProp]);

  // Apply prop line sorting (highest/lowest)
  // IMPORTANT: Sort ALL playerProps first (across all pages), then filter
  // This ensures highest/lowest considers all props today, not just filtered ones
  const sortedPlayerProps = useMemo(() => {
    // If prop line sort is active, sort ALL props first, then filter
    if (propLineSort === 'high' || propLineSort === 'low') {
      // First, sort ALL playerProps by line
      let allPropsSorted = [...playerProps];
      if (propLineSort === 'high') {
        allPropsSorted.sort((a, b) => b.line - a.line);
      } else {
        allPropsSorted.sort((a, b) => a.line - b.line);
      }
      
      // Then apply filters to the sorted list
      return allPropsSorted.filter(prop => {
        // Search filter
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          const playerNameMatch = prop.playerName.toLowerCase().includes(query);
          const statTypeMatch = getStatLabel(prop.statType).toLowerCase().includes(query);
          if (!playerNameMatch && !statTypeMatch) {
            return false;
          }
        }

        // Prop type filter
        if (selectedPropTypes.size > 0 && !selectedPropTypes.has(prop.statType)) {
          return false;
        }

        // Bookmaker filter
        if (selectedBookmakers.size > 0) {
          const propBookmakers = new Set<string>();
          if (prop.bookmakerLines && prop.bookmakerLines.length > 0) {
            prop.bookmakerLines.forEach(line => {
              if (line.bookmaker) {
                propBookmakers.add(line.bookmaker);
              }
            });
          }
          if (prop.bookmaker) {
            propBookmakers.add(prop.bookmaker);
          }
          
          const hasSelectedBookmaker = Array.from(propBookmakers).some(bm => selectedBookmakers.has(bm));
          if (!hasSelectedBookmaker) {
            return false;
          }
        }

        // Game filter
        if (shouldApplyNbaGameFilter) {
          const game = getGameForProp(prop);
          if (!game || !selectedGames.has(game.id)) {
            return false;
          }
        }

        return true;
      });
    }
    
    // If no prop line sort, just return filtered props (will be sorted by L10% later)
    return filteredPlayerProps;
  }, [playerProps, propLineSort, filteredPlayerProps, searchQuery, selectedBookmakers, selectedPropTypes, selectedGames, shouldApplyNbaGameFilter, getStatLabel, getGameForProp]);

  // Deduplicate props: same player + stat + line + opponent should only appear once
  // Keep the one with the most bookmakers or best odds
  // Uses sortedPlayerProps so Prop Line sort (highest/lowest) order is preserved
  const uniquePlayerProps = useMemo(() => {
    const seen = new Map<string, PlayerProp>();
    
    sortedPlayerProps.forEach(prop => {
      // Create unique key: playerName + statType + line + opponent
      const key = `${prop.playerName}|${prop.statType}|${prop.line}|${prop.opponent}`;
      
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, prop);
      } else {
        // If duplicate found, keep the one with more bookmakers or better odds
        const existingBookmakers = (existing.bookmakerLines?.length || 0) + (existing.bookmaker ? 1 : 0);
        const newBookmakers = (prop.bookmakerLines?.length || 0) + (prop.bookmaker ? 1 : 0);
        
        if (newBookmakers > existingBookmakers) {
          seen.set(key, prop);
        } else if (newBookmakers === existingBookmakers && prop.bookmakerLines && existing.bookmakerLines) {
          // If same number of bookmakers, merge them
          const mergedBookmakers = new Map<string, { bookmaker: string; line: number; overOdds: string; underOdds: string }>();
          
          existing.bookmakerLines.forEach(line => {
            mergedBookmakers.set(line.bookmaker, line);
          });
          prop.bookmakerLines.forEach(line => {
            mergedBookmakers.set(line.bookmaker, line);
          });
          
          seen.set(key, {
            ...existing,
            bookmakerLines: Array.from(mergedBookmakers.values())
          });
        }
      }
    });
    
    return Array.from(seen.values());
  }, [sortedPlayerProps]);

  // Sort for display
  // - If prop line sort is active, keep the line-based order (already applied)
  // - If column sort is active, sort by that column
  // - Otherwise, sort by L10% (fallback to L5% then overall prob)
  const displaySortedProps = useMemo(() => {
    const percent = (hitRate?: { hits: number; total: number } | null) =>
      hitRate && hitRate.total > 0 ? (hitRate.hits / hitRate.total) * 100 : null;

    // Use deduplicated props
    const propsToSort = uniquePlayerProps;

    // Check if any column sort is active
    const activeColumnSort = Object.entries(columnSort).find(([_, dir]) => dir !== 'none');
    
    if (propLineSort !== 'none') {
      // Prop line sort takes precedence
      return [...propsToSort];
    }

    if (activeColumnSort) {
      const [column, direction] = activeColumnSort;
      const sorted = [...propsToSort].sort((a, b) => {
        let aValue: number | null = null;
        let bValue: number | null = null;

        switch (column) {
          case 'dvp':
            // Sort by DvP rank (higher rank = easier matchup)
            aValue = a.dvpRating ?? null;
            bValue = b.dvpRating ?? null;
            // First click uses "asc", which means best/easiest DvP first.
            if (aValue === null && bValue === null) return 0;
            if (aValue === null) return 1;
            if (bValue === null) return -1;
            return direction === 'asc' ? bValue - aValue : aValue - bValue;
          
          case 'l5':
            aValue = percent(a.last5HitRate);
            bValue = percent(b.last5HitRate);
            break;
          
          case 'ip':
            // Sort by bookmaker implied over probability (highest = best)
            aValue = getConsensusImpliedProbabilities(a).overProb;
            bValue = getConsensusImpliedProbabilities(b).overProb;
            break;
          
          case 'l10':
            aValue = percent(a.last10HitRate);
            bValue = percent(b.last10HitRate);
            break;
          
          case 'h2h':
            aValue = percent(a.h2hHitRate);
            bValue = percent(b.h2hHitRate);
            break;

          case 'season':
            aValue = percent(a.seasonHitRate);
            bValue = percent(b.seasonHitRate);
            break;
          
          case 'streak':
            aValue = a.streak ?? null;
            bValue = b.streak ?? null;
            break;
        }

        // Handle null values
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1; // nulls go to end
        if (bValue === null) return -1;
        
        // Sort based on direction
        // For hit rates, IP, and streak: "asc" (best) = highest values first (descending sort)
        // DvP is handled separately above
        return direction === 'asc' ? bValue - aValue : aValue - bValue;
      });
      return sorted;
    }

    // Default: best from true L10 sample first, then L5, then DvP, then implied probability.
    return [...propsToSort].sort((a, b) => {
      const aL10Total = a.last10HitRate?.total ?? 0;
      const bL10Total = b.last10HitRate?.total ?? 0;
      const aHasFullL10 = aL10Total >= 10;
      const bHasFullL10 = bL10Total >= 10;
      // Keep partial samples (e.g. 2/2) visible, but rank them after full 10-game samples.
      if (aHasFullL10 !== bHasFullL10) return aHasFullL10 ? -1 : 1;

      const aL10 = percent(a.last10HitRate);
      const bL10 = percent(b.last10HitRate);
      if (aL10 !== null || bL10 !== null) {
        return (bL10 ?? -1) - (aL10 ?? -1);
      }

      const aL5 = percent(a.last5HitRate);
      const bL5 = percent(b.last5HitRate);
      if (aL5 !== null || bL5 !== null) {
        return (bL5 ?? -1) - (aL5 ?? -1);
      }

      const aDvp = a.dvpRating != null && a.dvpRating > 0 ? a.dvpRating : null;
      const bDvp = b.dvpRating != null && b.dvpRating > 0 ? b.dvpRating : null;
      if (aDvp !== null || bDvp !== null) {
        // Lower rank = better; nulls go to end
        const aRank = aDvp ?? 999;
        const bRank = bDvp ?? 999;
        if (aRank !== bRank) return aRank - bRank;
      }
      // Use consensus implied probabilities for sorting (median across books)
      const aConsensus = getConsensusImpliedProbabilities(a);
      const bConsensus = getConsensusImpliedProbabilities(b);
      const aProb = Math.max(aConsensus.overProb ?? 0, aConsensus.underProb ?? 0);
      const bProb = Math.max(bConsensus.overProb ?? 0, bConsensus.underProb ?? 0);
      return bProb - aProb;
    });
  }, [uniquePlayerProps, propLineSort, columnSort]);

  // Pagination
  const pageSize = 20;
  // Total count should use deduplicated props
  const totalPropsCount = uniquePlayerProps.length;
  // Total pages based on the full count
  const totalPages = Math.max(1, Math.ceil(totalPropsCount / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedPlayerProps = useMemo(() => {
    const start = (currentPageSafe - 1) * pageSize;
    return displaySortedProps.slice(start, start + pageSize);
  }, [displaySortedProps, currentPageSafe]);

  // Calculate missing stats for props that don't have seasonAvg or h2hAvg
  // This is a fallback for props that were cached without these stats
  const [propsWithCalculatedStats, setPropsWithCalculatedStats] = useState<Map<string, PlayerProp>>(new Map());
  const calculatedKeysRef = useRef<Set<string>>(new Set());
  const calculatingRef = useRef<Set<string>>(new Set());
  
  // Load calculated stats from sessionStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
      const stored = sessionStorage.getItem(CALCULATED_STATS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const statsMap = new Map<string, PlayerProp>();
          parsed.forEach((prop: PlayerProp) => {
            const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
            statsMap.set(key, prop);
            calculatedKeysRef.current.add(key);
          });
          setPropsWithCalculatedStats(statsMap);
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }, []);
  
  useEffect(() => {
    let isCancelled = false;
    const abortControllers = new Map<string, AbortController>();
    
    const calculateMissingStats = async () => {
      const propsToCalculate = paginatedPlayerProps.filter(prop => {
        const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
        const needsCalculation = (prop.h2hAvg === null || prop.h2hAvg === undefined || prop.seasonAvg === null || prop.seasonAvg === undefined) &&
          prop.playerName && prop.statType && prop.opponent && prop.line !== undefined;
        return needsCalculation && !calculatedKeysRef.current.has(key) && !calculatingRef.current.has(key);
      });
      
      if (propsToCalculate.length === 0 || isCancelled) return;
      
      // Calculate stats for props that are missing them
      const calculations = propsToCalculate.map(async (prop) => {
        if (isCancelled) return;
        
        const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
        const abortController = new AbortController();
        abortControllers.set(key, abortController);
        
        // Mark as calculating
        calculatingRef.current.add(key);
        
        try {
          const stats = await calculatePlayerAverages(
            prop.playerName,
            prop.statType,
            prop.opponent,
            prop.team,
            prop.line
          );
          
          // Check if cancelled before updating state
          if (isCancelled) return;
          
          // Only update if we got valid stats
          if (stats.h2h !== null || stats.seasonAvg !== null) {
            const updatedProp = {
              ...prop,
              h2hAvg: stats.h2h ?? prop.h2hAvg,
              seasonAvg: stats.seasonAvg ?? prop.seasonAvg,
              h2hHitRate: stats.h2hHitRate ?? prop.h2hHitRate,
              seasonHitRate: stats.seasonHitRate ?? prop.seasonHitRate,
            };
            
            // Update local state
            setPropsWithCalculatedStats(prev => {
              const newMap = new Map(prev);
              newMap.set(key, updatedProp);
              
              // Save calculated stats to sessionStorage
              if (typeof window !== 'undefined' && !isCancelled) {
                const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
                const statsArray = Array.from(newMap.values());
                const statsString = JSON.stringify(statsArray);
                safeSetSessionStorage(CALCULATED_STATS_KEY, statsString);
              }
              
              return newMap;
            });
            
            // Update main playerProps state and persist to cache
            setPlayerProps(prev => {
              const updated = prev.map(p => {
                const propKey = `${p.playerName}|${p.statType}|${p.opponent}|${p.line}`;
                if (propKey === key) {
                  return updatedProp;
                }
                return p;
              });
              
              // Save to sessionStorage
              if (typeof window !== 'undefined' && !isCancelled) {
                const CACHE_KEY = 'nba-player-props-cache';
                const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
                const dataString = JSON.stringify(updated);
                safeSetSessionStorage(CACHE_KEY, dataString);
                safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
              }
              
              return updated;
            });
            
            calculatedKeysRef.current.add(key);
          }
        } catch (error) {
          console.warn(`[Props Page] Failed to calculate stats for ${prop.playerName} ${prop.statType}:`, error);
        } finally {
          calculatingRef.current.delete(key);
          abortControllers.delete(key);
        }
      });
      
      await Promise.all(calculations);
    };
    
    calculateMissingStats();
    
    // Cleanup function
    return () => {
      isCancelled = true;
      // Cancel all in-flight calculations
      abortControllers.forEach((controller) => {
        controller.abort();
      });
      abortControllers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginatedPlayerProps]);
  
  // Merge calculated stats into paginated props
  const finalPaginatedProps = useMemo(() => {
    return paginatedPlayerProps.map(prop => {
      const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
      const calculated = propsWithCalculatedStats.get(key);
      return calculated || prop;
    });
  }, [paginatedPlayerProps, propsWithCalculatedStats]);

  const activeFilteredCount = propsSport === 'nba'
    ? filteredPlayerProps.length
    : isSecondaryListMode
      ? filteredAflProps.length
      : filteredCombinedProps.length;
  const activePaginatedProps = propsSport === 'nba'
    ? finalPaginatedProps
    : isSecondaryListMode
      ? finalPaginatedAflProps
      : finalPaginatedCombinedProps;
  const activeTotalPages = propsSport === 'nba'
    ? totalPages
    : isSecondaryListMode
      ? aflTotalPages
      : combinedTotalPages;
  const activeCurrentPage = propsSport === 'nba' ? currentPageSafe : currentPage;

  const secondaryPaintableProps = useMemo(() => {
    if (!isSecondaryListMode) return [] as PlayerProp[];
    const liveProps = activeSecondaryProps.filter((prop) => isAflCommenceTimePropsEligible(prop.gameDate));

    return liveProps;
  }, [isSecondaryListMode, propsSport, activeSecondaryProps]);

  const secondaryPropsPaintRows = isSecondaryListMode && secondaryPaintableProps.length > 0;
  const propsTablePaginatedProps = activePaginatedProps;
  const propsTableHasRows =
    propsSport === 'nba'
      ? activeFilteredCount > 0
      : isSecondaryListMode
        ? activeFilteredCount > 0 || secondaryPaintableProps.length > 0
        : activeFilteredCount > 0;

  const isPropsLoadingSkeleton = useMemo(() => {
    if (secondaryPropsPaintRows) return false;
    if (activeFilteredCount !== 0) return false;
    if (propsSport === 'combined') {
      if (debouncedSearchQuery.trim()) return false;
      if (!combinedPaintUnlocked) return true;
      if (combinedPropsLoading || propsLoading || aflPropsLoading || !combinedPropsFetchComplete) {
        return true;
      }
      return false;
    }
    if (
      (isSecondaryListMode && (aflPropsLoading || !aflPropsFetchComplete)) ||
      (propsSport === 'nba' && !showNoPropsMessage)
    ) {
      return true;
    }
    if (isSecondaryListMode && aflPropsFetchComplete) return false;
    if (propsSport === 'nba' && showNoPropsMessage) return false;
    return true;
  }, [
    secondaryPropsPaintRows,
    activeFilteredCount,
    propsSport,
    aflPropsLoading,
    aflPropsFetchComplete,
    showNoPropsMessage,
    combinedPropsLoading,
    propsLoading,
    combinedPropsFetchComplete,
    combinedPaintUnlocked,
    debouncedSearchQuery,
  ]);
  /** Club-site portraits for AFL props; bump version to invalidate client after resolver changes. */
  const [aflPortraitExtras, setAflPortraitExtras] = useState<Record<string, string>>({});
  const aflPortraitFetchedRef = useRef<Set<string>>(new Set());
  const aflPortraitMissUntilRef = useRef<Map<string, number>>(new Map());
  /** True while current page has AFL names still awaiting /api/afl/player-portraits (avoids jersey # flash). */
  const [aflPortraitBatchLoading, setAflPortraitBatchLoading] = useState(false);
  const AFL_PORTRAIT_RESOLVER_VERSION = '10';
  const AFL_PORTRAIT_VERSION_KEY = 'st_afl_portrait_resolver_v';
  const AFL_PORTRAIT_EXTRAS_KEY = 'st_afl_portrait_extras_v10';
  const AFL_PORTRAIT_EXTRAS_LS_KEY = `${AFL_PORTRAIT_EXTRAS_LS_KEY_PREFIX}${AFL_PORTRAIT_RESOLVER_VERSION}`;
  const AFL_PORTRAIT_EXTRAS_LS_TS_KEY = `${AFL_PORTRAIT_EXTRAS_LS_KEY}_ts`;
  const AFL_PORTRAIT_FETCH_BATCH_SIZE = 16;
  const AFL_PORTRAIT_RETRY_DELAY_MS = 2 * 60 * 1000;
  const aflPortraitFetchGenRef = useRef(0);

  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(AFL_PORTRAIT_VERSION_KEY) !== AFL_PORTRAIT_RESOLVER_VERSION) {
        sessionStorage.setItem(AFL_PORTRAIT_VERSION_KEY, AFL_PORTRAIT_RESOLVER_VERSION);
        sessionStorage.removeItem(AFL_PORTRAIT_EXTRAS_KEY);
        // Clear stale localStorage mirrors from older resolver versions so we don't paint dead URLs.
        try {
          if (typeof localStorage !== 'undefined') {
            for (let i = localStorage.length - 1; i >= 0; i -= 1) {
              const key = localStorage.key(i);
              if (key && key.startsWith(AFL_PORTRAIT_EXTRAS_LS_KEY_PREFIX) && key !== AFL_PORTRAIT_EXTRAS_LS_KEY && key !== AFL_PORTRAIT_EXTRAS_LS_TS_KEY) {
                localStorage.removeItem(key);
              }
            }
          }
        } catch {
          /* ignore */
        }
        aflPortraitFetchedRef.current = new Set();
        aflPortraitMissUntilRef.current = new Map();
        setAflPortraitExtras({});
        return;
      }

      // Prefer sessionStorage (same tab) then fall back to localStorage so a refresh / new
      // tab still paints AFL portraits from cache without waiting on the batch API.
      let parsed: Record<string, string> | null = null;
      const sessionRaw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(AFL_PORTRAIT_EXTRAS_KEY) : null;
      if (sessionRaw) {
        const maybe = JSON.parse(sessionRaw) as Record<string, string> | null;
        if (maybe && typeof maybe === 'object') parsed = maybe;
      }
      if (!parsed && typeof localStorage !== 'undefined') {
        const lsRaw = localStorage.getItem(AFL_PORTRAIT_EXTRAS_LS_KEY);
        const lsTsRaw = localStorage.getItem(AFL_PORTRAIT_EXTRAS_LS_TS_KEY);
        const lsTs = lsTsRaw ? parseInt(lsTsRaw, 10) : 0;
        const lsAge = Number.isFinite(lsTs) ? Date.now() - lsTs : Infinity;
        if (lsRaw && lsAge < AFL_PORTRAIT_EXTRAS_LS_TTL_MS) {
          const maybe = JSON.parse(lsRaw) as Record<string, string> | null;
          if (maybe && typeof maybe === 'object') parsed = maybe;
        }
      }
      if (!parsed) return;
      const next: Record<string, string> = {};
      for (const [name, url] of Object.entries(parsed)) {
        if (typeof name !== 'string' || !name.trim()) continue;
        if (typeof url !== 'string' || !url.trim()) continue;
        next[name] = url;
      }
      if (Object.keys(next).length > 0) {
        setAflPortraitExtras(next);
        aflPortraitFetchedRef.current = new Set(Object.keys(next));
        aflPortraitMissUntilRef.current = new Map();
        // Warm browser cache so the actual <img> tags paint without a per-image round-trip.
        for (const url of Object.values(next)) warmImage(url);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (Object.keys(aflPortraitExtras).length === 0) return;
      const serialized = JSON.stringify(aflPortraitExtras);
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(AFL_PORTRAIT_EXTRAS_KEY, serialized);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(AFL_PORTRAIT_EXTRAS_LS_KEY, serialized);
        localStorage.setItem(AFL_PORTRAIT_EXTRAS_LS_TS_KEY, Date.now().toString());
      }
    } catch {
      /* ignore */
    }
  }, [aflPortraitExtras, AFL_PORTRAIT_EXTRAS_LS_KEY, AFL_PORTRAIT_EXTRAS_LS_TS_KEY]);

  const aflPortraitFetchKey = useMemo(() => {
    if (propsSport !== 'afl' && propsSport !== 'combined') return '';
    const parts: string[] = [];
    for (const prop of activePaginatedProps) {
      const rowSport =
        propsSport === 'combined'
          ? ((prop as CombinedPlayerPropRow).sportSource ?? 'nba')
          : 'afl';
      if (rowSport !== 'afl') continue;
      parts.push(`${prop.playerName}\0${prop.team ?? ''}`);
    }
    return parts.sort().join('|');
  }, [propsSport, activePaginatedProps]);

  useLayoutEffect(() => {
    if (propsSport !== 'afl' && propsSport !== 'combined') {
      setAflPortraitBatchLoading(false);
      return;
    }
    const pending = new Set<string>();
    for (const prop of activePaginatedProps) {
      const rowSport =
        propsSport === 'combined'
          ? ((prop as CombinedPlayerPropRow).sportSource ?? 'nba')
          : 'afl';
      if (rowSport !== 'afl') continue;
      const n = prop.playerName;
      if (!n || pending.has(n)) continue;
      if (aflPortraitFetchedRef.current.has(n)) continue;
      const missUntil = aflPortraitMissUntilRef.current.get(n) ?? 0;
      if (missUntil > Date.now()) continue;
      if (getAflPlayerHeadshotUrl(n)) continue;
      pending.add(n);
    }
    setAflPortraitBatchLoading(pending.size > 0);
  }, [propsSport, activePaginatedProps, aflPortraitFetchKey]);

  useEffect(() => {
    if (!aflPortraitFetchKey) return;
    const players: { name: string; team?: string; homeTeam?: string; awayTeam?: string }[] = [];
    const seen = new Set<string>();
    for (const prop of activePaginatedProps) {
      const rowSport =
        propsSport === 'combined'
          ? ((prop as CombinedPlayerPropRow).sportSource ?? 'nba')
          : 'afl';
      if (rowSport !== 'afl') continue;
      const n = prop.playerName;
      if (!n || seen.has(n)) continue;
      seen.add(n);
      if (aflPortraitFetchedRef.current.has(n)) continue;
      const missUntil = aflPortraitMissUntilRef.current.get(n) ?? 0;
      if (missUntil > Date.now()) continue;
      if (getAflPlayerHeadshotUrl(n)) {
        aflPortraitFetchedRef.current.add(n);
        continue;
      }
      players.push({
        name: n,
        team: prop.team || undefined,
        homeTeam: prop.homeTeam || undefined,
        awayTeam: prop.awayTeam || undefined,
      });
    }
    if (players.length === 0) {
      setAflPortraitBatchLoading(false);
      return;
    }
    const fetchGen = ++aflPortraitFetchGenRef.current;
    const chunks: Array<{ name: string; team?: string; homeTeam?: string; awayTeam?: string }[]> = [];
    for (let i = 0; i < players.length; i += AFL_PORTRAIT_FETCH_BATCH_SIZE) {
      chunks.push(players.slice(i, i + AFL_PORTRAIT_FETCH_BATCH_SIZE));
    }

    void Promise.all(
      chunks.map(async (batch) => {
        try {
          const r = await fetch('/api/afl/player-portraits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ players: batch }),
          });
          if (!r.ok) {
            for (const p of batch) {
              aflPortraitMissUntilRef.current.set(p.name, Date.now() + AFL_PORTRAIT_RETRY_DELAY_MS);
            }
            return;
          }
          const data = (await r.json()) as { portraits?: Record<string, string | null> };
          const portraits = data.portraits ?? {};
          for (const p of batch) {
            const resolvedUrl = portraits[p.name];
            if (resolvedUrl) {
              aflPortraitFetchedRef.current.add(p.name);
              aflPortraitMissUntilRef.current.delete(p.name);
            } else {
              aflPortraitMissUntilRef.current.set(p.name, Date.now() + AFL_PORTRAIT_RETRY_DELAY_MS);
            }
          }
          // Always merge successful URLs — do not drop them when a newer fetch starts.
          setAflPortraitExtras((prev) => {
            const next = { ...prev };
            for (const [name, url] of Object.entries(portraits)) {
              if (url) {
                next[name] = url;
                warmImage(url);
              }
            }
            return next;
          });
        } catch {
          for (const p of batch) {
            aflPortraitMissUntilRef.current.set(p.name, Date.now() + AFL_PORTRAIT_RETRY_DELAY_MS);
          }
        }
      })
    ).finally(() => {
      if (aflPortraitFetchGenRef.current === fetchGen) {
        setAflPortraitBatchLoading(false);
      }
    });
  }, [aflPortraitFetchKey, propsSport, activePaginatedProps]);

  // Warm the browser image cache for every logo / headshot URL that will appear in the
  // current page of rows. Runs whenever the visible row set, sport, or AFL logo map changes.
  // This is the main lever for "logos / headshots feel delayed on first paint" — the URLs
  // become known as soon as the props payload arrives, so we kick off the network fetches
  // before React even mounts the row's <img>.
  useEffect(() => {
    if (!activePaginatedProps || activePaginatedProps.length === 0) return;
    const aflLogoLookup = (name: string): string | null => {
      if (!name) return null;
      const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = n(name);
      if (aflLogoByTeam[key]) return aflLogoByTeam[key];
      for (const w of name.split(/\s+/)) {
        const wk = n(w);
        if (aflLogoByTeam[wk]) return aflLogoByTeam[wk];
      }
      return null;
    };
    for (const prop of activePaginatedProps) {
      const rowSport =
        propsSport === 'combined'
          ? ((prop as CombinedPlayerPropRow).sportSource ?? 'nba')
          : propsSport;
      if (rowSport === 'nba') {
        const bdlId = getPlayerIdFromName(prop.playerName);
        const nbaId = bdlId ? convertBdlToNbaId(bdlId) : null;
        if (nbaId) warmImage(getPlayerHeadshotUrl(nbaId));
        const teamAbbr = (() => {
          if (!prop.team) return '';
          if (prop.team.length <= 3) return prop.team.toUpperCase();
          return TEAM_FULL_TO_ABBR[prop.team] || prop.team.toUpperCase();
        })();
        const opponentAbbr = (() => {
          if (!prop.opponent) return '';
          if (prop.opponent.length <= 3) return prop.opponent.toUpperCase();
          return TEAM_FULL_TO_ABBR[prop.opponent] || prop.opponent.toUpperCase();
        })();
        if (teamAbbr) warmImage(getEspnLogoUrl(teamAbbr));
        if (opponentAbbr) warmImage(getEspnLogoUrl(opponentAbbr));
      } else if (rowSport === 'nbl') {
        if (prop.headshotUrl) warmImage(prop.headshotUrl);
      } else if (rowSport === 'afl') {
        const staticHeadshot = getAflPlayerHeadshotUrl(prop.playerName);
        const headshotUrl = staticHeadshot ?? aflPortraitExtras[prop.playerName] ?? null;
        if (headshotUrl) warmImage(headshotUrl);
        // Matchup logos – use same official-name normalization the renderer uses.
        const homeDisp = toOfficialAflTeamDisplayName(prop.team || prop.homeTeam || '');
        const awayDispRaw = toOfficialAflTeamDisplayName(prop.opponent || prop.awayTeam || '');
        const awayDisp = homeDisp && awayDispRaw && homeDisp === awayDispRaw ? '' : awayDispRaw;
        const homeLogo = homeDisp ? aflLogoLookup(homeDisp) : null;
        const awayLogo = awayDisp ? aflLogoLookup(awayDisp) : null;
        if (homeLogo) warmImage(homeLogo);
        if (awayLogo) warmImage(awayLogo);
      } else if (isTennisPropsSport(rowSport)) {
        const tennisHeadshot = tennisPropsHeadshotUrl(prop);
        if (tennisHeadshot) warmImage(tennisHeadshot);
        if (prop.homeTeamLogo) warmImage(prop.homeTeamLogo);
        if (prop.awayTeamLogo) warmImage(prop.awayTeamLogo);
      }
    }
  }, [activePaginatedProps, propsSport, aflLogoByTeam, aflPortraitExtras, aflGames]);

  const applySportMode = useCallback((nextMode: PropsSportMode) => {
    if (!NBA_PUBLIC_ENABLED && nextMode === 'nba') {
      nextMode = 'combined';
    }

    if (!TENNIS_PUBLIC_ENABLED && isTennisPropsSport(nextMode)) {
      nextMode = 'combined';
    }
    if (!NBL_PUBLIC_ENABLED && nextMode === 'nbl') {
      nextMode = 'combined';
    }
    if (isSecondaryPropsSport(propsSport) && propsSport !== nextMode) {
      rememberSecondaryGameSelection(propsSport);
    }
    let combinedWarm = false;
    if ((isTennisPropsSport(nextMode) || nextMode === 'nbl') && !isTennisPropsSport(propsSport) && propsSport !== 'nbl') {
      const aflSlice = aflProps.filter(isAflCombinedListProp);
      if (aflSlice.length > 0) {
        combinedAflHoldRef.current = { props: aflSlice, games: [...aflGames] };
        try {
          sessionStorage.setItem(
            AFL_PROPS_CACHE_KEY,
            JSON.stringify({
              props: aflSlice,
              games: aflGames,
              selectedGameIds: Array.from(selectedAflGamesRef.current),
              timestamp: Date.now(),
            })
          );
        } catch {
          // ignore quota
        }
      }
    }
    const liveAflPropsLeavingTab =
      nextMode === 'combined' && propsSport === 'afl' ? aflProps : null;
    const liveAflGamesLeavingTab =
      nextMode === 'combined' && propsSport === 'afl' ? aflGames : null;

    if (nextMode === 'combined') {
      const leavingSecondaryForCombined =
        propsSport === 'afl' || isTennisPropsSport(propsSport);
      if (!leavingSecondaryForCombined) {
      try {
        const raw = sessionStorage.getItem(COMBINED_PROPS_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as CombinedPropsSnapshotResponse & { timestamp?: number; selectedGameIds?: string[] };
          const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
          const nbaProps = Array.isArray(parsed?.nba?.props) ? parsed.nba.props : [];
          const aflPropsCached = Array.isArray(parsed?.afl?.props) ? parsed.afl.props : [];
          const hasSnapshotData = nbaProps.length > 0 || aflPropsCached.length > 0;
          if (age < CACHE_TTL_MS && hasSnapshotData) {
            applyCombinedSnapshot(parsed, {
              persistCaches: false,
              selectedGameIds: Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : undefined,
              preserveAflProps: liveAflPropsLeavingTab ?? undefined,
              preserveAflGames: liveAflGamesLeavingTab ?? undefined,
            });
            combinedWarm = true;
            combinedWarmToggleRef.current = true;
          }
        }
      } catch {
        // ignore cache parse errors; combined fetch effect will load fresh data
      }
      }

      // AFL → All: never trust stale combined snapshot — keep live AFL rows.
      if (propsSport === 'afl' && aflProps.length > 0) {
        const needsCombinedRefresh = combinedModeNeedsDataRefresh(
          playerProps,
          aflProps,
          {
            afl: combinedPartialAflRefetchAttemptedRef.current,
          },
          combinedOddsFlagsRef.current
        );
        setCombinedFetchComplete(!needsCombinedRefresh);
        setCombinedPropsLoading(needsCombinedRefresh);
        setCombinedPaintUnlocked(
          isCombinedSecondaryPaintReady(aflProps, combinedOddsFlagsRef.current)
        );
        setAflPropsLoading(false);
        setSecondaryPropsFetchComplete(true);
        combinedWarm = true;
        combinedWarmToggleRef.current = !needsCombinedRefresh;
        try {
          persistCombinedSnapshotCaches({
            success: true,
            snapshotVersion: 1,
            generatedAt: new Date().toISOString(),
            staleAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
            nba: {
              ok: playerProps.length > 0,
              status: 200,
              cached: true,
              lastUpdated: null,
              gameDate: null,
              props: playerProps,
            },
            afl: {
              ok: true,
              status: 200,
              lastUpdated: aflLastUpdated,
              nextUpdate: null,
              ingestMessage: aflIngestMessage,
              noAflOdds: false,
              games: aflGames,
              props: aflProps,
            },
            nbl: {
              ok: nblCombinedProps.length > 0,
              status: 200,
              lastUpdated: null,
              nextUpdate: null,
              ingestMessage: null,
              noNblOdds: nblCombinedProps.length === 0,
              games: [],
              props: nblCombinedProps,
            },
          });
        } catch {
          // ignore cache write failures
        }
      }


      if (propsSport === 'nbl' && aflProps.length > 0) {
        setNblCombinedProps(aflProps);
        let restoredAflProps: PlayerProp[] = [];
        let restoredAflGames: AflGameForProps[] = [];
        const heldAfl = combinedAflHoldRef.current;
        if (heldAfl && heldAfl.props.length > 0) {
          const liveHeld = applyLiveAflPropsCutoff(heldAfl.props, heldAfl.games);
          if (!liveHeld.noAflOdds) {
            restoredAflProps = liveHeld.props;
            restoredAflGames = liveHeld.games;
          }
        }
        if (restoredAflProps.length === 0) {
          const aflCached = readSecondaryPropsSessionCache('afl');
          if (aflCached.props.length > 0 || aflCached.games.length > 0) {
            const liveAfl = applyLiveAflPropsCutoff(aflCached.props, aflCached.games);
            if (!liveAfl.noAflOdds) {
              restoredAflProps = liveAfl.props;
              restoredAflGames = liveAfl.games;
            }
          }
        }
        if (restoredAflProps.length === 0) {
          try {
            const raw = sessionStorage.getItem(COMBINED_PROPS_CACHE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as CombinedPropsSnapshotResponse & { timestamp?: number };
              const snapshotAfl = Array.isArray(parsed?.afl?.props) ? parsed.afl.props.filter(isAflCombinedListProp) : [];
              const snapshotGames = Array.isArray(parsed?.afl?.games) ? parsed.afl.games : [];
              if (snapshotAfl.length > 0 || snapshotGames.length > 0) {
                const liveSnap = applyLiveAflPropsCutoff(snapshotAfl, snapshotGames);
                if (!liveSnap.noAflOdds) {
                  restoredAflProps = liveSnap.props;
                  restoredAflGames = liveSnap.games;
                }
              }
            }
          } catch {
            // ignore snapshot parse errors
          }
        }
        if (restoredAflProps.length > 0) {
          const matchedAflGames = gamesMatchingProps(restoredAflProps, restoredAflGames);
          setAflProps(restoredAflProps);
          setAflGames(matchedAflGames.length > 0 ? matchedAflGames : restoredAflGames);
        }
        combinedWarm = true;
        combinedWarmToggleRef.current = true;
        setCombinedPaintUnlocked(true);
        setAflPropsLoading(false);
        setSecondaryPropsFetchComplete(true);
      }

      if (isTennisPropsSport(propsSport)) {
        const leavingTour = propsSport as 'atp' | 'wta';
        const otherTour: 'atp' | 'wta' = leavingTour === 'wta' ? 'atp' : 'wta';
        const currentTourRows = aflProps.filter(isTennisListProp);
        const otherFromMemory = tennisPropsForTour(tennisCombinedPropsRef.current, otherTour);
        const otherFromCache = readTennisTourPropsFromCaches(otherTour);
        const otherRows = otherFromMemory.length >= otherFromCache.length ? otherFromMemory : otherFromCache;
        const tennisMerged = [...otherRows, ...currentTourRows];
        setTennisCombinedProps(tennisMerged);
        writeTennisTourSessionCaches({
          props: tennisMerged,
          games: [],
          selectedGameIds: [],
          now: Date.now(),
        });

        let restoredAflProps: PlayerProp[] = [];
        let restoredAflGames: AflGameForProps[] = [];
        const heldAfl = combinedAflHoldRef.current;
        if (heldAfl && heldAfl.props.length > 0) {
          const liveHeld = applyLiveAflPropsCutoff(heldAfl.props, heldAfl.games);
          if (!liveHeld.noAflOdds) {
            restoredAflProps = liveHeld.props;
            restoredAflGames = liveHeld.games;
          }
        }
        if (restoredAflProps.length === 0) {
          const aflCached = readSecondaryPropsSessionCache('afl');
          if (aflCached.props.length > 0 || aflCached.games.length > 0) {
            const liveAfl = applyLiveAflPropsCutoff(aflCached.props, aflCached.games);
            if (!liveAfl.noAflOdds) {
              restoredAflProps = liveAfl.props;
              restoredAflGames = liveAfl.games;
            }
          }
        }
        if (restoredAflProps.length === 0) {
          try {
            const raw = sessionStorage.getItem(COMBINED_PROPS_CACHE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as CombinedPropsSnapshotResponse & { timestamp?: number };
              const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
              const snapshotAfl = Array.isArray(parsed?.afl?.props) ? parsed.afl.props.filter(isAflCombinedListProp) : [];
              const snapshotGames = Array.isArray(parsed?.afl?.games) ? parsed.afl.games : [];
              if (age < CACHE_TTL_MS && (snapshotAfl.length > 0 || snapshotGames.length > 0)) {
                const liveSnap = applyLiveAflPropsCutoff(snapshotAfl, snapshotGames);
                if (!liveSnap.noAflOdds) {
                  restoredAflProps = liveSnap.props;
                  restoredAflGames = liveSnap.games;
                }
              }
            }
          } catch {
            // ignore snapshot parse errors
          }
        }

        if (restoredAflProps.length > 0) {
          const matchedAflGames = gamesMatchingProps(restoredAflProps, restoredAflGames);
          setAflProps(restoredAflProps);
          setAflGames(matchedAflGames.length > 0 ? matchedAflGames : restoredAflGames);
          const selected = new Set(
            (matchedAflGames.length > 0 ? matchedAflGames : restoredAflGames).map((g) => g.gameId)
          );
          if (selected.size > 0) {
            selectedAflGamesRef.current = selected;
            setSelectedAflGames(selected);
          }
        } else {
          setAflProps([]);
          setAflGames([]);
        }
        const needsCombinedRefresh = combinedModeNeedsDataRefresh(
          playerProps,
          restoredAflProps,
          {
            afl: combinedPartialAflRefetchAttemptedRef.current,
          },
          combinedOddsFlagsRef.current
        );
        const canPaint =
          isCombinedSecondaryPaintReady(restoredAflProps, combinedOddsFlagsRef.current) ||
          combinedModeHasVisibleRows(playerProps, restoredAflProps, tennisMerged, nblCombinedProps);
        setCombinedPaintUnlocked(canPaint);
        setCombinedFetchComplete(!needsCombinedRefresh && canPaint);
        setCombinedPropsLoading(needsCombinedRefresh && !canPaint);
        setAflPropsLoading(false);
        setSecondaryPropsFetchComplete(true);
        combinedWarm = canPaint;
        combinedWarmToggleRef.current = !needsCombinedRefresh;
      }

      if (!combinedWarm) {
        setCombinedFetchComplete(false);
        setCombinedPropsLoading(true);
      }
    }
    if (nextMode === 'nba' && !propsLoadedRef.current) {
      try {
        const CACHE_KEY = 'nba-player-props-cache';
        const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
        const cachedData = sessionStorage.getItem(CACHE_KEY);
        const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
        if (cachedData && cachedTimestamp) {
          const age = Date.now() - parseInt(cachedTimestamp, 10);
          if (age < CACHE_TTL_MS) {
            const parsed = JSON.parse(cachedData);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const mergedNba = mergeNbaPropsWithStoredCalculatedStats(parsed);
              setPlayerProps(mergedNba.props);
              propsLoadedRef.current = true;
              initialFetchCompletedRef.current = true;
              setPropsWithCalculatedStats(mergedNba.calculatedMap);
              mergedNba.calculatedKeys.forEach((key) => calculatedKeysRef.current.add(key));
              setPropsLoading(false);
            }
          }
        }
      } catch {
        // ignore cache parse errors; fetch effect will load fresh data
      }
    }

    const cachedGames = readDashboardGamesFromSessionCache();
    if (cachedGames) {
      setTodaysGames((prev) => (prev.length > 0 ? prev : cachedGames));
      setGamesLoading(false);
    }

    let secondaryRestoredFromCache = false;
    if (isSecondaryPropsSport(nextMode)) {
      secondaryListSportRef.current = nextMode;
      aflRetryTimeoutsRef.current.forEach((id) => clearTimeout(id));
      aflRetryTimeoutsRef.current = [];
      aflListFetchInFlightRef.current = null;
      const switchingSecondarySport =
        isSecondaryPropsSport(propsSport) && propsSport !== nextMode;
      const leavingCombinedForSecondary =
        propsSport === 'combined' && isSecondaryPropsSport(nextMode);
      if (switchingSecondarySport || leavingCombinedForSecondary) {
        // Switching sports: drop saved book/stat filters so they can't hide every row for one frame.
        // Game checkboxes are remembered per sport and restored after hydrate.
        setSelectedPropTypes(new Set());
        setSelectedBookmakers(new Set());
      }

      const applySecondaryHydrate = (
        hydratedProps: PlayerProp[],
        hydratedGames: AflGameForProps[],
        preferredGameIds?: string[]
      ) => {
        if (hydratedProps.length === 0) return false;
        setAflProps(hydratedProps);
        const matchedGames = gamesMatchingProps(hydratedProps, hydratedGames);
        const gamesForUi =
          hydratedGames.length > matchedGames.length ? hydratedGames : matchedGames;
        setAflGames(gamesForUi);
        if (!secondaryGameSelectionRef.current[nextMode] && preferredGameIds) {
          seedSecondaryGameSelection(nextMode, {
            selectedGameIds: preferredGameIds,
            userModifiedGames: false,
          });
        }
        const availableIds =
          gamesForUi.length > 0
            ? gamesForUi.map((game) => game.gameId)
            : Array.from(propGameIdsFromRows(hydratedProps));
        applyRememberedGameSelection(nextMode, availableIds);
        secondaryRestoredFromCache = true;
        setSecondaryPropsFetchComplete(true);
        setAflPropsLoading(false);
        secondarySkipFetchSportRef.current = nextMode;
        secondaryWarmHydrateRef.current = true;
        return true;
      };

      if (!secondaryRestoredFromCache) {
        try {
          const cacheKey = getSecondaryPropsCacheKey(nextMode);
          const raw = sessionStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw) as {
              props?: PlayerProp[];
              games?: AflGameForProps[];
              selectedGameIds?: string[];
              userModifiedGames?: boolean;
              timestamp?: number;
            };
            const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
            const cachedPropsRaw = Array.isArray(parsed?.props) ? parsed.props : [];
            const cachedProps = isTennisPropsSport(nextMode)
              ? cachedPropsRaw.filter(
                  (p) =>
                    isTennisListProp(p) &&
                    propsSportFromTennisTour(p.team || p.homeTeamCode) === nextMode
                )
              : nextMode === 'nbl'
                ? cachedPropsRaw.filter(isNblListProp)
              : cachedPropsRaw.filter((p) => !isTennisPropStatType(p.statType) && !isNblListProp(p));
            const cachedGames = Array.isArray(parsed?.games) ? parsed.games : [];
            const hasPaintableSecondaryRows = isTennisPropsSport(nextMode)
              ? cachedProps.length > 0
              : cachedProps.length > 0 || cachedGames.length > 0;
            if (age < AFL_PROPS_CACHE_TTL_MS && hasPaintableSecondaryRows) {
              seedSecondaryGameSelection(nextMode, {
                selectedGameIds: Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : [],
                userModifiedGames: parsed?.userModifiedGames === true,
              });
              applySecondaryHydrate(
                cachedProps,
                cachedGames,
                Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : undefined
              );
            }
          }
        } catch {
          // ignore cache parse errors
        }
      }

      // Combined → AFL: rows already live in aflProps on the combined feed.
      if (
        !secondaryRestoredFromCache &&
        nextMode === 'afl' &&
        propsSport === 'combined' &&
        aflProps.length > 0
      ) {
        const aflRows = aflProps.filter((p) => !isTennisPropStatType(p.statType) && !isNblListProp(p));
        const matchedGames = gamesMatchingProps(aflRows, aflGames);
        setAflGames(matchedGames);
        applyRememberedGameSelection(
          'afl',
          matchedGames.length > 0
            ? matchedGames.map((game) => game.gameId)
            : Array.from(propGameIdsFromRows(aflRows))
        );
        secondaryRestoredFromCache = true;
        setSecondaryPropsFetchComplete(true);
        setAflPropsLoading(false);
        secondarySkipFetchSportRef.current = 'afl';
        secondaryWarmHydrateRef.current = true;
      }

      if (!secondaryRestoredFromCache && nextMode === 'nbl') {
        const nblRows = nblCombinedProps.filter(isNblListProp);
        const cachedNbl = readSecondaryPropsSessionCache('nbl');
        seedSecondaryGameSelection('nbl', {
          selectedGameIds: cachedNbl.selectedGameIds,
          userModifiedGames: cachedNbl.userModifiedGames,
        });
        if (nblRows.length > 0) {
          applySecondaryHydrate(nblRows, cachedNbl.games);
        } else {
          setAflProps([]);
          setAflGames([]);
        }
      }

      if (!secondaryRestoredFromCache && isTennisPropsSport(nextMode)) {
        if (isTennisPropsSport(propsSport) && propsSport !== nextMode) {
          const leavingRows = aflProps.filter(isTennisListProp);
          if (leavingRows.length > 0) {
            const leavingTour = propsSport;
            const kept = tennisCombinedPropsRef.current.filter(
              (p) =>
                isTennisListProp(p) &&
                propsSportFromTennisTour(p.team || p.homeTeamCode) !== leavingTour
            );
            const merged = [...kept, ...leavingRows];
            tennisCombinedPropsRef.current = merged;
            setTennisCombinedProps(merged);
          }
        }
        const tourRows = tennisTourRowsForHydrate(nextMode, tennisCombinedPropsRef.current);
        if (tourRows.length > 0) {
          applySecondaryHydrate(tourRows, []);
        }
      }

      // Secondary switch without hydrate: drop the other sport's rows.
      if (switchingSecondarySport && !secondaryRestoredFromCache) {
        setAflProps([]);
        setAflGames([]);
        userModifiedAflGamesRef.current =
          secondaryGameSelectionRef.current[nextMode]?.userModified === true;
        selectedAflGamesRef.current = userModifiedAflGamesRef.current
          ? new Set(secondaryGameSelectionRef.current[nextMode]?.ids ?? [])
          : new Set();
        setSelectedAflGames(selectedAflGamesRef.current);
      }
    }

    setPropsSport(nextMode);
    if (nextMode === 'combined') {
      if (combinedWarm) {
        setCombinedPaintUnlocked(true);
        setAflPropsLoading(false);
      } else {
        const ready = isCombinedSecondaryPaintReady(
          aflPropsRef.current,
          combinedOddsFlagsRef.current
        );
        if (ready) {
          setCombinedPaintUnlocked(true);
          setCombinedFetchComplete(true);
          setCombinedPropsLoading(false);
        } else {
          setCombinedPaintUnlocked(false);
        }
      }
    }
    if (isSecondaryPropsSport(nextMode)) {
      if (secondaryRestoredFromCache) {
        // secondarySkipFetchSportRef already set during cache hydrate
      } else {
        secondarySkipFetchSportRef.current = null;
        setSecondaryPropsFetchComplete(false);
        setAflPropsLoading(true);
      }
    } else {
      secondarySkipFetchSportRef.current = null;
      secondaryListSportRef.current = null;
      if (nextMode === 'combined') {
        if (!combinedWarm) {
          setAflPropsLoading(true);
        }
      } else if (nextMode !== 'nba') {
        setAflPropsLoading(true);
      }
    }
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const testCode = params?.get('test_event_code');
    const effectiveMode =
      !NBA_PUBLIC_ENABLED && nextMode === 'nba' ? 'combined' : nextMode;
    const path = propsPathForSport(effectiveMode, testCode);
    router.replace(path, { scroll: false });
  }, [router, mergeNbaPropsWithStoredCalculatedStats, setSecondaryPropsFetchComplete, propsSport, aflProps, aflGames, aflLastUpdated, aflIngestMessage, playerProps, nblCombinedProps, applyCombinedSnapshot, persistCombinedSnapshotCaches, rememberSecondaryGameSelection, seedSecondaryGameSelection, applyRememberedGameSelection]);

  const toggleSportSelection = useCallback((sport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta') => {
    
    if (isTennisPropsSport(sport) && !TENNIS_PUBLIC_ENABLED) return;
    if (sport === 'nbl' && !NBL_PUBLIC_ENABLED) return;
    // Combined means "no explicit single-sport filter selected".
    // Clicking an active sport toggles it off back to combined.
    const nextMode: PropsSportMode = propsSport === sport ? 'combined' : sport;
    applySportMode(nextMode);
  }, [propsSport, applySportMode]);

  const toggleBookmaker = (bookmaker: string) => {
    setSelectedBookmakers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bookmaker)) {
        newSet.delete(bookmaker);
      } else {
        newSet.add(bookmaker);
      }
      // Save to localStorage
      saveFiltersToStorage(newSet, selectedPropTypes, selectedGames);
      return newSet;
    });
  };

  const togglePropType = (propType: string) => {
    setSelectedPropTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(propType)) {
        newSet.delete(propType);
      } else {
        newSet.add(propType);
      }
      // Save to localStorage
      saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
      return newSet;
    });
  };

  const toggleGame = (gameId: number) => {
    setSelectedGames(prev => {
      const newSet = new Set(prev);
      if (newSet.has(gameId)) {
        // User is deselecting this game - mark it as explicitly deselected
        newSet.delete(gameId);
        setDeselectedGames(prevDeselected => {
          const newDeselected = new Set(prevDeselected);
          newDeselected.add(gameId);
          saveDeselectedGames(newDeselected);
          return newDeselected;
        });
      } else {
        // User is selecting this game - remove from deselected list
        newSet.add(gameId);
        setDeselectedGames(prevDeselected => {
          const newDeselected = new Set(prevDeselected);
          newDeselected.delete(gameId);
          saveDeselectedGames(newDeselected);
          return newDeselected;
        });
      }
      // Save to localStorage
      saveFiltersToStorage(selectedBookmakers, selectedPropTypes, newSet);
      return newSet;
    });
  };

  const clearAllGames = () => {
    setSelectedGames(new Set());
    setDeselectedGames(prev => {
      const next = new Set(prev);
      gamesWithProps.forEach(g => next.add(g.id));
      saveDeselectedGames(next);
      return next;
    });
    saveFiltersToStorage(selectedBookmakers, selectedPropTypes, new Set());
  };

  const selectAllGames = () => {
    const allIds = new Set(gamesWithProps.map(g => g.id));
    setSelectedGames(allIds);
    setDeselectedGames(prev => {
      const next = new Set(prev);
      allIds.forEach(id => next.delete(id));
      saveDeselectedGames(next);
      return next;
    });
    saveFiltersToStorage(selectedBookmakers, selectedPropTypes, allIds);
  };

  const applyTennisMaxRank = (next: number | null) => {
    setTennisMaxRank(next);
    writeTennisMaxRankFilter(next);
    setGamesDropdownOpen(false);
    setCurrentPage(1);
  };

  const toggleAflGame = (gameId: string) => {
    userModifiedAflGamesRef.current = true;
    setSelectedAflGames((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      selectedAflGamesRef.current = next;
      rememberSecondaryGameSelection(propsSportRef.current);
      return next;
    });
  };
  const selectAllAflGames = () => {
    userModifiedAflGamesRef.current = true;
    const next = new Set(aflGamesWithProps.map((g) => g.gameId));
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
    rememberSecondaryGameSelection(propsSportRef.current);
  };
  const clearAllAflGames = () => {
    userModifiedAflGamesRef.current = true;
    const next = new Set<string>();
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
    rememberSecondaryGameSelection(propsSportRef.current);
  };

  const getConfidenceColor = (confidence: string) => {
    if (confidence === 'High') return mounted && isDark ? 'text-green-400' : 'text-green-600';
    if (confidence === 'Medium') return mounted && isDark ? 'text-yellow-400' : 'text-yellow-600';
    return mounted && isDark ? 'text-gray-400' : 'text-gray-600';
  };


  // Avoid full-screen blocking loader when navigating back from dashboards.
  // Let page skeletons render immediately; redirect non-pro users once checks finish.
  if (subscriptionChecked && !isPro) {
    return <div className="min-h-screen bg-[#050d1a]" />;
  }

  // Use isDark (not mounted&&isDark) for the page shell so first paint is never bg-gray-50.
  const shellDark = !mounted || isDark;

  return (
    <div className={`min-h-screen lg:h-screen ${shellDark ? 'bg-[#050d1a]' : 'bg-gray-50'} lg:overflow-x-auto lg:overflow-y-hidden`}>
      {/* Loading bar at top when navigating to dashboard - must be at root level */}
      <LoadingBar isLoading={navigatingToPlayer} isDark={isDark} showImmediately={navigatingToPlayer} mobileOffset={0} />
      <style jsx global>{`
        .dashboard-container {
          --sidebar-margin: 0px;
          --sidebar-width: 0px;
          --gap: 2px;
          --inner-max: 1550px;
          --app-max: calc(var(--sidebar-width) + var(--gap) + var(--inner-max));
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
        }

        .mobile-filter-scroll::-webkit-scrollbar {
          height: 8px;
        }
        .mobile-filter-scroll::-webkit-scrollbar-track {
          background: #f3f4f6;
          border-radius: 4px;
        }
        .mobile-filter-scroll::-webkit-scrollbar-thumb {
          background: #9ca3af;
          border-radius: 4px;
        }
        .mobile-filter-scroll::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }
        .dark .mobile-filter-scroll::-webkit-scrollbar-track {
          background: #1f2937;
        }
        .dark .mobile-filter-scroll::-webkit-scrollbar-thumb {
          background: #4b5563;
        }
        .dark .mobile-filter-scroll::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }

        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }

        @media (min-width: 1024px) {
          .dashboard-container {
            --sidebar-width: 340px;
            --right-panel-width: 340px;
          }
        }
        
        @media (min-width: 1500px) {
          .dashboard-container {
            --sidebar-margin: 0px;
            --sidebar-width: 400px;
            --right-panel-width: 400px;
            --content-margin-right: 0px;
            --content-padding-left: 0px;
            --content-padding-right: 0px;
          }
        }
        
        @media (min-width: 2200px) {
          .dashboard-container {
            --sidebar-margin: 0px;
            --sidebar-width: 460px;
            --right-panel-width: 460px;
            --content-margin-right: 0px;
            --content-padding-left: 0px;
            --content-padding-right: 0px;
          }
        }
      `}</style>
      
      <div className={`px-0 dashboard-container ${shellDark ? 'bg-[#050d1a]' : ''}`} style={{ 
        marginLeft: 'calc(var(--sidebar-width, 0px) + var(--gap, 2px))',
        width: 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 2px)))',
        paddingLeft: 0,
      }}>
        <div className={`mx-auto w-full max-w-[1550px] ${shellDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingLeft: 0, paddingRight: '0px' }}>
          <div className={`pt-4 min-h-0 lg:h-full dashboard-container ${shellDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingLeft: 0 }}>
            {/* Left Sidebar */}
            <LeftSidebar
              oddsFormat={oddsFormat}
              setOddsFormat={(format) => {
                const formatValue = typeof format === 'function' ? format(oddsFormat) : format;
                setOddsFormat(formatValue);
                try {
                  localStorage.setItem('oddsFormat', formatValue);
                } catch (e: any) {
                  if (e.name === 'QuotaExceededError' || e.code === 22) {
                    console.warn('[NBA Landing] localStorage quota exceeded when saving odds format');
                  } else {
                    console.warn('[NBA Landing] Failed to save odds format to localStorage:', e);
                  }
                }
              }}
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
            />

            {/* Main Content Area - Top Player Props */}
            <div 
              className={`relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 pt-1 lg:pt-0 overflow-y-auto lg:overflow-x-hidden lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar ${shellDark ? 'bg-[#050d1a]' : ''}`}
              style={{
                scrollbarGutter: 'stable',
                paddingLeft: 0,
                paddingRight: 0,
              }}
            >
          <div className={`h-full pb-12 lg:pr-0 px-2 lg:px-1 ${shellDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingTop: 0, boxSizing: 'border-box' }}>
            {/* Sport filter: default combined (none selected); click active sport again to return to combined */}
            <div className={`flex gap-2 mb-3 lg:mb-3 lg:gap-3 py-3 px-1 lg:py-3 lg:px-1 rounded-2xl lg:rounded-none border lg:border-0 overflow-visible ${shellDark ? 'bg-[#050d1a] border-white/10 lg:border-transparent' : 'bg-gray-50 border-gray-200'}`}>
              {NBA_PUBLIC_ENABLED && (
                <button
                  type="button"
                  onClick={() => toggleSportSelection('nba')}
                  className={sportSelectorClass(propsSport === 'nba', shellDark)}
                  style={sportSelectorGlow('nba', propsSport === 'nba')}
                  aria-label="NBA"
                  aria-pressed={propsSport === 'nba'}
                >
                  <img
                    src="/images/nba-logo.png"
                    alt=""
                    className={sportSelectorLogoClass('nba')}
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleSportSelection('afl')}
                className={sportSelectorClass(propsSport === 'afl', shellDark)}
                style={sportSelectorGlow('afl', propsSport === 'afl')}
                aria-label="AFL"
                aria-pressed={propsSport === 'afl'}
              >
                <img
                  src="/images/afl-logo.png"
                  alt=""
                  className={sportSelectorLogoClass('afl')}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </button>
              {NBL_PUBLIC_ENABLED && (
              <button
                type="button"
                onClick={() => toggleSportSelection('nbl')}
                className={sportSelectorClass(propsSport === 'nbl', shellDark)}
                style={sportSelectorGlow('nbl', propsSport === 'nbl')}
                aria-label="NBL"
                aria-pressed={propsSport === 'nbl'}
              >
                <img
                  src={NBL_LOGO_PATH}
                  alt=""
                  className={sportSelectorLogoClass('nbl')}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </button>
              )}
              {TENNIS_PUBLIC_ENABLED && (
                <>
                  <button
                    type="button"
                    onClick={() => toggleSportSelection('atp')}
                    className={sportSelectorClass(propsSport === 'atp', shellDark)}
                    style={sportSelectorGlow('atp', propsSport === 'atp')}
                    aria-label="ATP"
                    aria-pressed={propsSport === 'atp'}
                  >
                    <img
                      src={TENNIS_LOGO_PATH}
                      alt=""
                      className={sportSelectorLogoClass('atp', TENNIS_LOGO_TOGGLE_CLASS)}
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSportSelection('wta')}
                    className={sportSelectorClass(propsSport === 'wta', shellDark)}
                    style={sportSelectorGlow('wta', propsSport === 'wta')}
                    aria-label="WTA"
                    aria-pressed={propsSport === 'wta'}
                  >
                    <img
                      src={WTA_LOGO_PATH}
                      alt=""
                      className={sportSelectorLogoClass('wta', TENNIS_LOGO_TOGGLE_CLASS)}
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                    />
                  </button>
                </>
              )}
            </div>

            {/* Search Bar */}
            <div className={`mb-3 ${shellDark ? 'bg-[#050d1a]' : ''}`}>
              <form onSubmit={handleSearch} style={{ width: '100%', margin: 0, padding: 0, boxSizing: 'border-box' }}>
                <div className="relative" style={{ width: '100%', boxSizing: 'border-box' }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for a player..."
                    className={`px-4 py-3 pl-12 rounded-xl border ${
                      shellDark 
                        ? 'bg-[#0d1728] border-white/10 text-white placeholder-slate-500' 
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                    } focus:outline-none focus:ring-2 focus:ring-white/10 focus:border-white/20`}
                    style={{ boxSizing: 'border-box', width: '100%' }}
                  />
                  <svg
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </form>

              {/* Filters Section */}
              {!isCombinedMode && (
              <div 
                ref={filtersSectionRef}
                className={`mt-2 flex flex-col gap-1.5 ${shellDark ? 'bg-[#050d1a]' : ''}`} 
                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
              >
                <div className="flex gap-1.5">
                {/* Games Dropdown */}
                <div className="relative flex-1">
                  <button
                    ref={gamesButtonRef}
                    onClick={() => {
                      setGamesDropdownOpen(!gamesDropdownOpen);
                      setBookmakerDropdownOpen(false);
                      setPropTypeDropdownOpen(false);
                    }}
                    className={propsFilterButtonClass(gamesDropdownOpen, shellDark)}
                  >
                    <span className="text-sm font-medium whitespace-nowrap">
                      {isTennisPropsSport(propsSport) ? tennisRankFilterButtonLabel(tennisMaxRank) : 'Games'}
                    </span>
                    <svg
                      className={`w-4 h-4 transition-transform flex-shrink-0 ${gamesDropdownOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {gamesDropdownOpen && (
                    isMobile && dropdownContainer ? (
                      createPortal(
                        <>
                          <div
                            className="fixed inset-0 z-[100]"
                            onClick={() => setGamesDropdownOpen(false)}
                          />
                          <div 
                            data-dropdown-locked
                            className={`fixed z-[101] rounded-lg border shadow-lg overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-900 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`}
                            style={getMobileFilterDropdownStyle()}
                          >
                          <div className="p-2 space-y-1" style={{ width: '100%', boxSizing: 'border-box' }}>
                            {isTennisPropsSport(propsSport) ? (
                              <TennisRankFilterOptions
                                maxRank={tennisMaxRank}
                                isDark={isDark}
                                mounted={mounted}
                                onSelect={applyTennisMaxRank}
                              />
                            ) : (
                              <>
                            {isSecondaryListMode
                              ? aflGamesWithProps.map((game) => {
                                  const isSelected = selectedAflGames.has(game.gameId);
                                  return (
                                    <label
                                      key={game.gameId}
                                      className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
                                        isSelected ? (mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900') : (mounted && isDark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-50 text-gray-700')
                                      }`}
                                    >
                                      <input type="checkbox" checked={isSelected} onChange={() => toggleAflGame(game.gameId)} className="hidden" />
                                      <SecondaryGameMatchupLogos
                                        homeTeam={game.homeTeam}
                                        awayTeam={game.awayTeam}
                                        homeTeamCode={game.homeTeamCode}
                                        awayTeamCode={game.awayTeamCode}
                                        homeTeamLogo={game.homeTeamLogo}
                                        awayTeamLogo={game.awayTeamLogo}
                                        sport={propsSport}
                                        aflLogoByTeam={aflLogoByTeam}
                                        nblLogoByTeam={nblLogoByTeam}
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="md"
                                      />
                                    </label>
                                  );
                                })
                              : gamesWithProps.map(game => {
                              const isSelected = selectedGames.has(game.id);
                              const homeTeam = game.home_team?.abbreviation || '';
                              const awayTeam = game.visitor_team?.abbreviation || '';
                              const homeLogoUrl = getEspnLogoUrl(homeTeam);
                              const awayLogoUrl = getEspnLogoUrl(awayTeam);
                              return (
                                <label
                                  key={game.id}
                                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
                                    isSelected
                                      ? mounted && isDark
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-900'
                                      : mounted && isDark
                                      ? 'hover:bg-gray-700 text-gray-300'
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleGame(game.id)}
                                    className="hidden"
                                  />
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                                    {awayLogoUrl && (
                                      <img
                                        src={awayLogoUrl}
                                        alt={awayTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                    <span className={`text-xs font-semibold flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
                                    {homeLogoUrl && (
                                      <img
                                        src={homeLogoUrl}
                                        alt={homeTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                  </div>
                                </label>
                              );
                            })}
                            <div className="flex pt-0.5">
                              <button
                                type="button"
                                onClick={isSecondaryListMode ? clearAllAflGames : clearAllGames}
                                className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                  mounted && isDark
                                    ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                                }`}
                              >
                                Clear all
                              </button>
                              <div className={`w-px self-stretch flex-shrink-0 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-200'}`} />
                              <button
                                type="button"
                                onClick={isSecondaryListMode ? selectAllAflGames : selectAllGames}
                                className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                  mounted && isDark
                                    ? 'text-purple-400 hover:bg-gray-700 hover:text-purple-200'
                                    : 'text-purple-600 hover:bg-gray-50 hover:text-purple-800'
                                }`}
                              >
                                Select all
                              </button>
                            </div>
                              </>
                            )}
                          </div>
                        </div>
                        </>,
                        dropdownContainer
                      )
                    ) : (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setGamesDropdownOpen(false)}
                        />
                        <div 
                          className={`absolute top-full left-0 right-0 mt-2 z-20 rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                            mounted && isDark
                              ? 'bg-gray-900 border-gray-700'
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          <div className="p-2 space-y-1">
                            {isTennisPropsSport(propsSport) ? (
                              <TennisRankFilterOptions
                                maxRank={tennisMaxRank}
                                isDark={isDark}
                                mounted={mounted}
                                onSelect={applyTennisMaxRank}
                              />
                            ) : (
                              <>
                            {isSecondaryListMode
                              ? aflGamesWithProps.map((game) => {
                                  const isSelected = selectedAflGames.has(game.gameId);
                                  return (
                                    <label
                                      key={game.gameId}
                                      className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
                                        isSelected ? (mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900') : (mounted && isDark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-50 text-gray-700')
                                      }`}
                                    >
                                      <input type="checkbox" checked={isSelected} onChange={() => toggleAflGame(game.gameId)} className="hidden" />
                                      <SecondaryGameMatchupLogos
                                        homeTeam={game.homeTeam}
                                        awayTeam={game.awayTeam}
                                        homeTeamCode={game.homeTeamCode}
                                        awayTeamCode={game.awayTeamCode}
                                        homeTeamLogo={game.homeTeamLogo}
                                        awayTeamLogo={game.awayTeamLogo}
                                        sport={propsSport}
                                        aflLogoByTeam={aflLogoByTeam}
                                        nblLogoByTeam={nblLogoByTeam}
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="md"
                                      />
                                    </label>
                                  );
                                })
                              : gamesWithProps.map(game => {
                              const isSelected = selectedGames.has(game.id);
                              const homeTeam = game.home_team?.abbreviation || '';
                              const awayTeam = game.visitor_team?.abbreviation || '';
                              const homeLogoUrl = getEspnLogoUrl(homeTeam);
                              const awayLogoUrl = getEspnLogoUrl(awayTeam);
                              return (
                                <label
                                  key={game.id}
                                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
                                    isSelected
                                      ? mounted && isDark
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-900'
                                      : mounted && isDark
                                      ? 'hover:bg-gray-700 text-gray-300'
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleGame(game.id)}
                                    className="hidden"
                                  />
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {awayLogoUrl && (
                                      <img
                                        src={awayLogoUrl}
                                        alt={awayTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                    <span className="text-sm font-medium flex-shrink-0">{awayTeam}</span>
                                    <span className={`text-sm flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
                                    {homeLogoUrl && (
                                      <img
                                        src={homeLogoUrl}
                                        alt={homeTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                    <span className="text-sm font-medium flex-shrink-0">{homeTeam}</span>
                                  </div>
                                </label>
                              );
                            })}
                            <div className="flex pt-0.5">
                              <button
                                type="button"
                                onClick={isSecondaryListMode ? clearAllAflGames : clearAllGames}
                                className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                  mounted && isDark
                                    ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                                }`}
                              >
                                Clear all
                              </button>
                              <div className={`w-px self-stretch flex-shrink-0 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-200'}`} />
                              <button
                                type="button"
                                onClick={isSecondaryListMode ? selectAllAflGames : selectAllGames}
                                className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                  mounted && isDark
                                    ? 'text-purple-400 hover:bg-gray-700 hover:text-purple-200'
                                    : 'text-purple-600 hover:bg-gray-50 hover:text-purple-800'
                                }`}
                              >
                                Select all
                              </button>
                            </div>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )
                  )}
                </div>

                {/* Prop Types Dropdown */}
                <div className="relative flex-1" style={{ minWidth: 0, maxWidth: '100%' }}>
                  <button
                    ref={propTypeButtonRef}
                    onClick={() => {
                      setPropTypeDropdownOpen(!propTypeDropdownOpen);
                      setBookmakerDropdownOpen(false);
                      setGamesDropdownOpen(false);
                    }}
                    className={propsFilterButtonClass(propTypeDropdownOpen, shellDark)}
                  >
                    <span className="text-sm font-medium whitespace-nowrap">
                      Prop Types
                    </span>
                    <svg
                      className={`w-4 h-4 transition-transform flex-shrink-0 ${propTypeDropdownOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {propTypeDropdownOpen && (
                    isMobile && dropdownContainer ? (
                      createPortal(
                        <>
                          <div
                            className="fixed inset-0 z-[100]"
                            onClick={() => setPropTypeDropdownOpen(false)}
                          />
                          <div 
                            data-dropdown-locked
                            className={`fixed z-[101] rounded-lg border shadow-lg overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-900 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`}
                            style={getMobileFilterDropdownStyle()}
                          >
                          <div className="space-y-1" style={{ width: '100%', boxSizing: 'border-box' }}>
                            {effectivePropTypes.map(propType => {
                              const isSelected = selectedPropTypes.has(propType);
                              return (
                                <label
                                  key={propType}
                                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                                    isSelected
                                      ? mounted && isDark
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-900'
                                      : mounted && isDark
                                      ? 'hover:bg-gray-700 text-gray-300'
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => togglePropType(propType)}
                                    className="hidden"
                                  />
                                  <span className="text-sm font-medium">{getStatLabel(propType)}</span>
                                </label>
                              );
                          })}
                          <div className="flex pt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                const newSet = new Set<string>();
                                setSelectedPropTypes(newSet);
                                saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                              }}
                              className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                mounted && isDark
                                  ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                              }`}
                            >
                              Clear all
                            </button>
                            <div className={`w-px self-stretch flex-shrink-0 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-200'}`} />
                            <button
                              type="button"
                              onClick={() => {
                                const newSet = new Set(availablePropTypes);
                                setSelectedPropTypes(newSet);
                                saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                              }}
                              className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                mounted && isDark
                                  ? 'text-purple-400 hover:bg-gray-700 hover:text-purple-200'
                                  : 'text-purple-600 hover:bg-gray-50 hover:text-purple-800'
                              }`}
                            >
                              Select all
                            </button>
                          </div>
                        </div>
                      </div>
                      </>,
                      dropdownContainer
                    )
                  ) : (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setPropTypeDropdownOpen(false)}
                      />
                      <div 
                        className={`absolute top-full left-0 right-0 mt-2 z-20 rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                          mounted && isDark
                            ? 'bg-gray-800 border-gray-700'
                            : 'bg-white border-gray-300'
                        }`}
                      >
                        <div className="p-2 space-y-1">
                          {effectivePropTypes.map(propType => {
                            const isSelected = selectedPropTypes.has(propType);
                            return (
                              <label
                                key={propType}
                                className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                                  isSelected
                                    ? mounted && isDark
                                      ? 'bg-purple-600 text-white'
                                      : 'bg-purple-100 text-purple-900'
                                    : mounted && isDark
                                    ? 'hover:bg-gray-700 text-gray-300'
                                    : 'hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => togglePropType(propType)}
                                  className="hidden"
                                />
                                <span className="text-sm font-medium">{getStatLabel(propType)}</span>
                              </label>
                            );
                          })}
                          <div className="flex pt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                const newSet = new Set<string>();
                                setSelectedPropTypes(newSet);
                                saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                              }}
                              className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                mounted && isDark
                                  ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                              }`}
                            >
                              Clear all
                            </button>
                            <div className={`w-px self-stretch flex-shrink-0 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-200'}`} />
                            <button
                              type="button"
                              onClick={() => {
                                const newSet = new Set(availablePropTypes);
                                setSelectedPropTypes(newSet);
                                saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                              }}
                              className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                mounted && isDark
                                  ? 'text-purple-400 hover:bg-gray-700 hover:text-purple-200'
                                  : 'text-purple-600 hover:bg-gray-50 hover:text-purple-800'
                              }`}
                            >
                              Select all
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )
                )}
                </div>

                {/* Bookmakers Dropdown */}
                <div className="relative flex-1">
                  <button
                    onClick={() => {
                      setBookmakerDropdownOpen(!bookmakerDropdownOpen);
                      setPropTypeDropdownOpen(false);
                      setGamesDropdownOpen(false);
                    }}
                    ref={bookmakerButtonRef}
                    className={propsFilterButtonClass(bookmakerDropdownOpen, shellDark)}
                  >
                    <span className="text-sm font-medium whitespace-nowrap">
                      Bookmakers
                    </span>
                    <svg
                      className={`w-4 h-4 transition-transform flex-shrink-0 ${bookmakerDropdownOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {bookmakerDropdownOpen && (
                    isMobile && dropdownContainer ? (
                      createPortal(
                        <>
                          <div
                            className="fixed inset-0 z-[100]"
                            onClick={() => setBookmakerDropdownOpen(false)}
                          />
                          <div 
                            data-dropdown-locked
                            className={`fixed z-[101] rounded-lg border shadow-lg overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-900 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`}
                            style={getMobileFilterDropdownStyle()}
                          >
                            <div className="space-y-1" style={{ width: '100%', boxSizing: 'border-box' }}>
                              {effectiveBookmakers.map(bookmaker => {
                                const bookmakerInfo = getBookmakerInfo(bookmaker);
                                const isSelected = selectedBookmakers.has(bookmaker);
                                return (
                                  <label
                                    key={bookmaker}
                                    className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                                      isSelected
                                        ? mounted && isDark
                                          ? 'bg-purple-600 text-white'
                                          : 'bg-purple-100 text-purple-900'
                                        : mounted && isDark
                                        ? 'hover:bg-gray-700 text-gray-300'
                                        : 'hover:bg-gray-50 text-gray-700'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleBookmaker(bookmaker)}
                                      className="hidden"
                                    />
                                    {bookmakerInfo?.logoUrl && (
                                      <img
                                        src={bookmakerInfo.logoUrl}
                                        alt={bookmakerInfo.name}
                                        className="w-4 h-4 object-contain"
                                      />
                                    )}
                                    <span className="text-sm font-medium">{bookmakerInfo?.name || bookmaker}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </>,
                        dropdownContainer
                      )
                    ) : (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setBookmakerDropdownOpen(false)}
                        />
                        <div 
                          className={`absolute top-full left-0 right-0 mt-2 z-20 rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                            mounted && isDark
                              ? 'bg-gray-900 border-gray-700'
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          <div className="p-2 space-y-1">
                            {effectiveBookmakers.map(bookmaker => {
                              const bookmakerInfo = getBookmakerInfo(bookmaker);
                              const isSelected = selectedBookmakers.has(bookmaker);
                              return (
                                <label
                                  key={bookmaker}
                                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                                    isSelected
                                      ? mounted && isDark
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-900'
                                      : mounted && isDark
                                      ? 'hover:bg-gray-700 text-gray-300'
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleBookmaker(bookmaker)}
                                    className="hidden"
                                  />
                                  {bookmakerInfo?.logoUrl && (
                                    <img
                                      src={bookmakerInfo.logoUrl}
                                      alt={bookmakerInfo.name}
                                      className="w-4 h-4 object-contain"
                                    />
                                  )}
                                  <span className="text-sm font-medium">{bookmakerInfo?.name || bookmaker}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )
                  )}
                </div>
                </div>
              </div>
              )}
            </div>

            {/* Player Props Section */}
            <div
              className={`${
                isPropsLoadingSkeleton
                  ? 'min-h-[calc(100dvh-17rem)] lg:min-h-[calc(100dvh-15rem)]'
                  : 'h-[calc(100%-160px)]'
              } ${shellDark ? 'bg-[#050d1a]' : ''}`}
              style={{ boxSizing: 'border-box', width: '100%', overflow: 'visible', paddingTop: 0, marginTop: 0 }}
            >
              <div className={`rounded-2xl lg:rounded-lg w-full pr-0 lg:pr-2 border lg:border-transparent ${
                shellDark ? 'bg-[#050d1a] border-white/5' : 'bg-white border-gray-200'
              }`} style={{ boxSizing: 'border-box', width: '100%', paddingTop: 0, marginTop: 0, paddingLeft: '0.6rem', paddingRight: '0.6rem' }}>
                {!propsTableHasRows && !secondaryPropsPaintRows ? (
                    isPropsLoadingSkeleton ? (
                      <>
                      {/* Desktop Skeleton - AFL loading or NBA empty */}
                      <div className="hidden 2xl:block overflow-x-auto min-h-[calc(100dvh-17rem)]">
                        <table className="w-full table-fixed">
                          <thead>
                            <tr className={`border-b ${isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                              <th className="py-3 px-4 text-left">
                                <div className={`h-8 w-32 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                              </th>
                              <th className={`py-3 px-4 text-left ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>Odds</th>
                              <th className={`py-3 px-4 text-left ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>IP</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                DvP
                              </th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>L5</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>L10</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                'H2H'
                              </th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>Season</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>Streak</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                {secondarySportKickoffLabel(propsSport)}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...Array(desktopSkeletonRowCount)].map((_, idx) => (
                              <tr key={idx} className={`border-b ${isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                                    <div className="flex-1 space-y-2">
                                      <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                                      <div className={`h-3 w-24 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="space-y-1.5">
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className={`h-4 w-12 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-4 w-16 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className={`2xl:hidden space-y-4 ${isDark ? 'bg-[#050d1a]' : ''}`}>
                        {[...Array(desktopSkeletonRowCount)].map((_, idx) => (
                          <div
                            key={idx}
                            className={`rounded-xl border-2 pl-3 pr-4 py-3.5 ${isDark ? 'bg-[#0a1929] border-gray-900' : 'bg-white border-gray-200'}`}
                          >
                            <div className="mb-1.5">
                              <div className="flex items-center gap-2.5 mb-2">
                                <div className={`w-10 h-10 rounded-full animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                <div className="flex-1 space-y-2">
                                  <div className={`h-5 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  <div className={`h-4 w-24 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-4 gap-2 mb-2">
                              {[...Array(4)].map((_, statIdx) => (
                                <div
                                  key={statIdx}
                                  className={`rounded-lg border p-2 animate-pulse ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-300'}`}
                                  style={{ animationDelay: `${idx * 0.1 + statIdx * 0.05}s` }}
                                >
                                  <div className={`h-3 w-12 mb-1 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                  <div className={`h-4 w-8 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center justify-between">
                              <div className={`h-4 w-20 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                              <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                      </>
                    ) : isSecondaryListMode && aflPropsFetchComplete ? (
                      liveEligibleAflPropsCount === 0 && !debouncedSearchQuery.trim() ? (
                        <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <p className="text-lg font-medium mb-2">No props found</p>
                          <p className="text-sm">Come back later</p>
                          <button
                            type="button"
                            onClick={() => {
                              userModifiedAflGamesRef.current = false;
                              secondarySkipFetchSportRef.current = null;
                              try {
                                sessionStorage.removeItem(getSecondaryPropsCacheKey(propsSport));
                              } catch {
                                // Ignore
                              }
                              setSecondaryPropsFetchComplete(false);
                              setAflPropsLoading(true);
                              setAflPropsRetryKey((k) => k + 1);
                            }}
                            className={`mt-4 px-4 py-2 rounded-lg font-medium ${mounted && isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
                          >
                            Try again
                          </button>
                        </div>
                      ) : liveEligibleAflPropsCount === 0 ? (
                        <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <p className="text-lg font-medium max-w-lg">
                            {isTennisPropsSport(propsSport)
                              ? 'No props found'
                              : aflIngestMessage && /^Fetched \d+ stats/i.test(aflIngestMessage)
                                ? AFL_USER_NO_ODDS
                                : (aflIngestMessage ?? AFL_USER_NO_ODDS)}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              userModifiedAflGamesRef.current = false;
                              secondarySkipFetchSportRef.current = null;
                              try {
                                sessionStorage.removeItem(getSecondaryPropsCacheKey(propsSport));
                              } catch {
                                // Ignore
                              }
                              setSecondaryPropsFetchComplete(false);
                              setAflPropsLoading(true);
                              setAflPropsRetryKey((k) => k + 1);
                            }}
                            className={`mt-4 px-4 py-2 rounded-lg font-medium ${mounted && isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
                          >
                            Try again
                          </button>
                        </div>
                      ) : (
                        <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <p className="text-lg font-medium">No props match your search or filters</p>
                          <p className="text-sm mt-1">Try a different search term or adjust the Games / Prop Types / Bookmakers filters.</p>
                        </div>
                      )
                    ) : propsSport === 'combined' ? (
                      combinedPaintUnlocked &&
                      combinedPropsFetchComplete &&
                      !combinedPropsLoading &&
                      liveEligibleAflPropsCount === 0 &&
                      !debouncedSearchQuery.trim() ? (
                        <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <p className="text-lg font-medium mb-2">No props found</p>
                          <p className="text-sm">Come back later</p>
                        </div>
                      ) : (
                        <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <p className="text-lg font-medium mb-2">No props match your search</p>
                          <p className="text-sm">Try a different player or stat search.</p>
                        </div>
                      )
                    ) : propsSport === 'nba' && showNoPropsMessage ? (
                      <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${
                        mounted && isDark ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        <p className="text-lg font-medium mb-2">No props found</p>
                        <p className="text-sm">Come back later</p>
                      </div>
                    ) : (
                    <>
                      {/* Desktop Skeleton - Hidden on mobile */}
                      <div className="hidden 2xl:block overflow-x-auto min-h-[calc(100dvh-17rem)]">
                        <table className="w-full table-fixed">
                          <thead>
                            <tr className={`border-b ${isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                              <th className="py-3 px-4 text-left">
                                <div className={`h-8 w-32 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                              </th>
                              <th className={`py-3 px-4 text-left ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>Odds</th>
                              <th className={`py-3 px-4 text-left ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>IP</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                DvP
                              </th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>L5</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>L10</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                'H2H'
                              </th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>Season</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>Streak</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                {secondarySportKickoffLabel(propsSport)}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...Array(desktopSkeletonRowCount)].map((_, idx) => (
                              <tr key={idx} className={`border-b ${isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                                    <div className="flex-1 space-y-2">
                                      <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                                      <div className={`h-3 w-24 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="space-y-1.5">
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className={`h-4 w-12 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-4 w-16 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      {/* Mobile Skeleton - Hidden on desktop */}
                      <div className={`2xl:hidden space-y-4 ${isDark ? 'bg-[#050d1a]' : ''}`}>
                        {[...Array(desktopSkeletonRowCount)].map((_, idx) => (
                          <div
                            key={idx}
                            className={`rounded-xl border-2 pl-3 pr-4 py-3.5 ${
                              isDark ? 'bg-[#0a1929] border-gray-900' : 'bg-white border-gray-200'
                            }`}
                          >
                            {/* Header Section */}
                            <div className="mb-1.5">
                              <div className="flex items-center gap-2.5 mb-2">
                                <div className={`w-10 h-10 rounded-full animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                <div className="flex-1 space-y-2">
                                  <div className={`h-5 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  <div className={`h-4 w-24 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                </div>
                              </div>
                            </div>
                            
                            {/* Stats Grid */}
                            <div className="grid grid-cols-4 gap-2 mb-2">
                              {[...Array(4)].map((_, statIdx) => (
                                <div
                                  key={statIdx}
                                  className={`rounded-lg border p-2 animate-pulse ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-300'}`}
                                  style={{ animationDelay: `${idx * 0.1 + statIdx * 0.05}s` }}
                                >
                                  <div className={`h-3 w-12 mb-1 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                  <div className={`h-4 w-8 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                </div>
                              ))}
                            </div>
                            
                            {/* Bottom Row */}
                            <div className="flex items-center justify-between">
                              <div className={`h-4 w-20 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                              <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                    )
                  ) : (
                    <>
                      {/* Desktop Table View - Hidden on mobile */}
                      <div className="hidden 2xl:block overflow-x-auto">
                        <table className="w-full table-fixed">
                        <thead>
                          <tr className={`border-b ${mounted && isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                            {/* Prop Line Sorter (replaces Player text) */}
                            <th className="py-3 px-4 text-left">
                              <div className="relative inline-flex">
                                <button
                                  onClick={() => {
                                    setPropLineDropdownOpen(!propLineDropdownOpen);
                                    setBookmakerDropdownOpen(false);
                                    setPropTypeDropdownOpen(false);
                                    setGamesDropdownOpen(false);
                                  }}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold ${
                                    mounted && isDark
                                      ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                  }`}
                                >
                                  <span>Prop Line</span>
                                  <svg
                                    className={`w-4 h-4 transition-transform ${propLineDropdownOpen ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                                {propLineDropdownOpen && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={() => setPropLineDropdownOpen(false)}
                                    />
                                    <div
                                      className={`absolute top-full left-0 mt-2 z-20 rounded-lg border shadow-lg w-44 ${
                                        mounted && isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                                      }`}
                                    >
                                      <button
                                        onClick={() => {
                                          setPropLineSort('high');
                                          setPropLineDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm rounded ${
                                          propLineSort === 'high'
                                            ? mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900'
                                            : mounted && isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                      >
                                        Highest prop line
                                      </button>
                                      <button
                                        onClick={() => {
                                          setPropLineSort('low');
                                          setPropLineDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm rounded ${
                                          propLineSort === 'low'
                                            ? mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900'
                                            : mounted && isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                      >
                                        Lowest prop line
                                      </button>
                                      <button
                                        onClick={() => {
                                          setPropLineSort('none');
                                          setPropLineDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm rounded ${
                                          propLineSort === 'none'
                                            ? mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900'
                                            : mounted && isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                      >
                                        Clear
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </th>
                            {isCombinedMode && showCombinedDesktopSportColumn && (
                              <th className={`text-left py-3 px-3 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>
                                Sport
                              </th>
                            )}
                            <th className={`text-left py-3 px-4 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_ODDS_COL_STYLE}>Odds</th>
                            <th 
                              className={`text-left py-3 px-4 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`}
                              style={PROPS_DESKTOP_IP_COL_STYLE}
                              onClick={() => handleColumnSort('ip')}
                            >
                              <div className="flex items-center gap-1.5">
                                <span>IP</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.ip !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.ip === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.ip === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.ip === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={PROPS_DESKTOP_STAT_COL_STYLE}
                              onClick={() => handleColumnSort('dvp')}
                            >
                              <div className="flex flex-col items-center justify-center gap-0.5">
                                
                                <span className="flex items-center justify-center gap-1.5">
                                  <span>DvP</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.dvp !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.dvp === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.dvp === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.dvp === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                                </span>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={PROPS_DESKTOP_STAT_COL_STYLE}
                              onClick={() => handleColumnSort('l5')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>L5</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.l5 !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.l5 === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.l5 === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.l5 === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={PROPS_DESKTOP_STAT_COL_STYLE}
                              onClick={() => handleColumnSort('l10')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>L10</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.l10 !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.l10 === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.l10 === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.l10 === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            {showH2hColumn && (
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={PROPS_DESKTOP_STAT_COL_STYLE}
                              onClick={() => handleColumnSort('h2h')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>H2H</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.h2h !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.h2h === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.h2h === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.h2h === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            )}
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={PROPS_DESKTOP_STAT_COL_STYLE}
                              onClick={() => handleColumnSort('season')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>Season</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.season !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.season === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.season === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.season === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={PROPS_DESKTOP_STAT_COL_STYLE}
                              onClick={() => handleColumnSort('streak')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>Streak</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.streak !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.streak === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.streak === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.streak === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                              {secondarySportKickoffLabel(propsSport)}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {propsTablePaginatedProps.map((prop, idx) => {
                            const rowSport = resolvePropsRowSport(prop, propsSport);
                            const dashboardHref = propsDashboardHref({
                              sport: rowSport,
                              playerName: prop.playerName,
                              playerId: prop.playerId,
                              team: prop.team,
                              opponent: prop.opponent,
                              opponentIoc: prop.opponentIoc,
                              opponentId: prop.opponentId,
                              statType: prop.statType,
                              line: Number.isFinite(prop.line) ? prop.line : null,
                              bookmaker: prop.bookmaker,
                            });
                            const bdlId = rowSport === 'nba' ? getPlayerIdFromName(prop.playerName) : null;
                            const nbaId = bdlId ? convertBdlToNbaId(bdlId) : null; // NBA Stats ID for headshot
                            const headshotUrl = nbaId ? getPlayerHeadshotUrl(nbaId) : null;
                            const aflHeadshotUrl =
                              rowSport === 'afl'
                                ? getAflPlayerHeadshotUrl(prop.playerName) ?? aflPortraitExtras[prop.playerName] ?? null
                                : null;
                            const aflAvatarPending =
                              rowSport === 'afl' &&
                              aflPortraitBatchLoading &&
                              !getAflPlayerHeadshotUrl(prop.playerName) &&
                              !aflPortraitExtras[prop.playerName] &&
                              !aflPortraitFetchedRef.current.has(prop.playerName);
                            const displayProp = prop;
                            // Normalize team names to abbreviations for logo lookup
                            // Handle both full names and abbreviations
                            const normalizeTeam = (team: string): string => {
                              if (!team) return '';
                              // Check if it's already an abbreviation (3 letters)
                              if (team.length <= 3) return team.toUpperCase();
                              // Try to find abbreviation from full name
                              return TEAM_FULL_TO_ABBR[team] || team.toUpperCase();
                            };
                            // Normalize stat for dashboard URL so it lands on the right tab (e.g., steals -> stl)
                            const normalizeStatForDashboard = (stat: string): string => {
                              const upper = (stat || '').toUpperCase().trim();
                              if (upper === 'THREES' || upper === '3PM' || upper === '3PM/A' || upper === 'FG3M') return 'fg3m';
                              if (upper === 'PTS' || upper === 'POINTS') return 'pts';
                              if (upper === 'REB' || upper === 'REBOUNDS') return 'reb';
                              if (upper === 'AST' || upper === 'ASSISTS') return 'ast';
                              if (upper === 'PRA') return 'pra';
                              if (upper === 'PR') return 'pr';
                              if (upper === 'PA') return 'pa';
                              if (upper === 'RA') return 'ra';
                              if (upper === 'STL' || upper === 'STEALS') return 'stl';
                              if (upper === 'BLK' || upper === 'BLOCKS') return 'blk';
                              return upper.toLowerCase();
                            };
                            const teamAbbr = normalizeTeam(prop.team);
                            const opponentAbbr = normalizeTeam(prop.opponent);
                            const oddsBookmakerLineCount = (() => {
                              const lines = isTennisPropsSport(rowSport)
                                ? tennisDisplayBookmakerLines(prop)
                                : (prop.bookmakerLines ?? []);
                              if (!lines.length) return 0;
                              const filtered =
                                !isCombinedMode && selectedBookmakers.size > 0
                                  ? lines.filter(
                                      (line) => line.bookmaker && selectedBookmakers.has(line.bookmaker)
                                    )
                                  : lines;
                              return filtered.length;
                            })();
                            const singleBookmakerOddsCell = oddsBookmakerLineCount === 1;
                            const teamLogoUrl = getEspnLogoUrl(teamAbbr);
                            const opponentLogoUrl = getEspnLogoUrl(opponentAbbr);
                              const navigateToSecondaryDashboard = (lineValue?: number, bookmakerName?: string) => {
                              if (rowSport === 'nba') {
                                const href = propsDashboardHref({
                                  sport: 'nba',
                                  playerName: prop.playerName,
                                  statType: prop.statType,
                                  line:
                                    typeof lineValue === 'number' && Number.isFinite(lineValue)
                                      ? lineValue
                                      : Number.isFinite(prop.line)
                                        ? prop.line
                                        : null,
                                });
                                try {
                                  sessionStorage.removeItem('nba_dashboard_session_v1');
                                  sessionStorage.setItem('from_props_page', 'true');
                                  safeSetSessionStorage('last_prop_url', href);
                                } catch {}
                                snapshotPropsPageBeforeLeave();
                                router.push(href);
                                setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                                return;
                              }
                              if (isTennisPropsSport(rowSport) || isTennisPropsSport(propsSport)) {
                                navigateToTennisDashboardFromProp(
                                  {
                                    ...prop,
                                    bookmaker: bookmakerName || prop.bookmaker,
                                  },
                                  router,
                                  lineValue
                                );
                                setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                                return;
                              }

                              if (rowSport === 'nbl' || isNblPropsSport(propsSport)) {
                                prefetchNblDashboardFromProps({
                                  playerName: prop.playerName,
                                  playerId: prop.playerId,
                                  team: prop.team,
                                  opponent: prop.opponent,
                                });
                                const href = nblDashboardHref({
                                  playerName: prop.playerName,
                                  playerId: prop.playerId,
                                  team: prop.team,
                                  opponent: prop.opponent,
                                  statType: prop.statType,
                                  line:
                                    typeof lineValue === 'number' && Number.isFinite(lineValue)
                                      ? lineValue
                                      : Number.isFinite(prop.line)
                                        ? prop.line
                                        : null,
                                  bookmaker: bookmakerName || prop.bookmaker,
                                });
                                snapshotPropsPageBeforeLeave();
                                router.push(href);
                                setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                                return;
                              }

                              const team = prop.team || '';
                              const opponent = prop.opponent || '';

                              prefetchAflDashboardFromProps({
                                playerName: prop.playerName,
                                team,
                                opponent,
                              });

                              if (team) {
                                fetch(`/api/afl/next-game?team=${encodeURIComponent(team)}&season=2026`)
                                  .then((r) => r.json())
                                  .then((d) => {
                                    try {
                                      sessionStorage.setItem('afl_next_game_prefetch', JSON.stringify({
                                        team,
                                        next_opponent: d?.next_opponent ?? null,
                                        next_game_tipoff: d?.next_game_tipoff ?? null,
                                        next_game_id: d?.next_game_id ?? d?.game_id ?? null,
                                        fetchedAt: Date.now(),
                                      }));
                                    } catch {}
                                    const gameId = d?.game_id ?? d?.gameId ?? null;
                                    if (gameId) {
                                      fetch(`/api/afl/odds?game_id=${encodeURIComponent(String(gameId))}`, { cache: 'default' }).catch(() => {});
                                    } else if (team && opponent) {
                                      fetch(`/api/afl/odds?team=${encodeURIComponent(team)}&opponent=${encodeURIComponent(opponent)}`, { cache: 'default' }).catch(() => {});
                                    }
                                    const prefetchOpponent =
                                      (typeof d?.next_opponent === 'string' && d.next_opponent.trim())
                                        ? d.next_opponent.trim()
                                        : opponent;
                                    const prefetchTipoff =
                                      typeof d?.next_game_tipoff === 'string' && d.next_game_tipoff
                                        ? d.next_game_tipoff
                                        : '';
                                    const prefetchDate =
                                      prefetchTipoff && Number.isFinite(new Date(prefetchTipoff).getTime())
                                        ? new Date(prefetchTipoff).toISOString().split('T')[0]
                                        : '';
                                    const teamOpp = [
                                      `team=${encodeURIComponent(team)}`,
                                      prefetchOpponent ? `opponent=${encodeURIComponent(prefetchOpponent)}` : '',
                                      prefetchDate ? `game_date=${encodeURIComponent(prefetchDate)}` : '',
                                      gameId ? `event_id=${encodeURIComponent(String(gameId))}` : '',
                                    ].filter(Boolean).join('&');
                                    if (teamOpp) {
                                      fetch(`/api/afl/player-props?player=${encodeURIComponent(prop.playerName)}&all=1&${teamOpp}`, { cache: 'default' })
                                        .then(async (res) => {
                                          if (!res.ok) return null;
                                          return await res.json();
                                        })
                                        .then((data) => {
                                          if (!data?.all || typeof data.all !== 'object') return;
                                          try {
                                            sessionStorage.setItem('afl_player_props_prefetch', JSON.stringify({
                                              player: prop.playerName,
                                              team,
                                              all: data.all,
                                              fetchedAt: Date.now(),
                                            }));
                                          } catch {
                                            // Ignore session write failures.
                                          }
                                        })
                                        .catch(() => {});
                                    }
                                  })
                                  .catch(() => {});
                              }
                              const q = new URLSearchParams();
                              q.set('mode', 'player');
                              q.set('name', prop.playerName);
                              if (prop.team) q.set('team', prop.team);
                              if (prop.opponent) q.set('opponent', prop.opponent);
                              q.set('stat', normalizeAflStatForDashboard(prop.statType));
                              const selectedLine = (typeof lineValue === 'number' && Number.isFinite(lineValue))
                                ? lineValue
                                : (Number.isFinite(prop.line) ? prop.line : null);
                              if (selectedLine != null) q.set('line', String(selectedLine));
                              const selectedBook = String(bookmakerName || prop.bookmaker || '').trim();
                              if (selectedBook) q.set('bookmaker', selectedBook);

                              // Navigate immediately; prefetches above already started in parallel.
                              snapshotPropsPageBeforeLeave();
                              router.push(`/afl?${q.toString()}`);
                              setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                            };
                            return (
                              <tr
                                key={propsListRowKey(prop, rowSport)}
                                className={`border-b ${mounted && isDark ? 'border-gray-900 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'} transition-colors cursor-pointer`}
                                onAuxClick={(e) => {
                                  if (e.button !== 1) return;
                                  if (eventTargetIsInteractive(e)) return;
                                  e.preventDefault();
                                  window.open(dashboardHref, '_blank', 'noopener,noreferrer');
                                }}
                                onClick={(e) => {
                                  if (!isUnmodifiedLeftClick(e)) return;
                                  if (eventTargetIsInteractive(e)) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (navigatingRef.current) return;
                                  navigatingRef.current = true;
                                  setNavigatingToPlayer(true);

                                  if (rowSport === 'afl' || rowSport === 'nbl' || isTennisPropsSport(rowSport)) {
                                    navigateToSecondaryDashboard();
                                    return;
                                  }

                                  const clickData = {
                                    player: prop.playerName,
                                    statType: prop.statType,
                                    line: prop.line,
                                    timestamp: Date.now(),
                                  };
                                  if (typeof window !== 'undefined') {
                                    safeSetSessionStorage('last_prop_click', JSON.stringify(clickData));
                                  }
                                  const normalizedStat = normalizeStatForDashboard(prop.statType);
                                  const finalUrl = `/nba/research/dashboard?player=${encodeURIComponent(prop.playerName)}&stat=${normalizedStat}&line=${prop.line.toString()}&tf=last10`;
                                  if (typeof window !== 'undefined') {
                                    safeSetSessionStorage('last_prop_url', finalUrl);
                                  }
                                  if (typeof window !== 'undefined') {
                                    try {
                                      window.sessionStorage.removeItem('nba_dashboard_session_v1');
                                    } catch (err) {
                                      console.warn('Failed to clear dashboard session storage', err);
                                    }
                                  }
                                  if (typeof window !== 'undefined') {
                                    try {
                                      sessionStorage.setItem('from_props_page', 'true');
                                    } catch (err) {
                                      // Ignore
                                    }
                                  }
                                  snapshotPropsPageBeforeLeave();
                                  router.push(finalUrl);
                                  setTimeout(() => {
                                    navigatingRef.current = false;
                                    setNavigatingToPlayer(false);
                                  }, 1500);
                                }}
                              >
                                {/* Player Column */}
                                <td className="py-3 px-4 overflow-hidden">
                                  <a
                                    href={dashboardHref}
                                    className="flex items-center gap-3 min-w-0 no-underline hover:no-underline"
                                    onClick={(e) => {
                                      if (!isUnmodifiedLeftClick(e)) return;
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (navigatingRef.current) return;
                                      navigatingRef.current = true;
                                      setNavigatingToPlayer(true);
                                      if (rowSport === 'afl' || rowSport === 'nbl' || isTennisPropsSport(rowSport)) {
                                        navigateToSecondaryDashboard();
                                        return;
                                      }
                                      try {
                                        sessionStorage.removeItem('nba_dashboard_session_v1');
                                        sessionStorage.setItem('from_props_page', 'true');
                                      } catch {}
                                      snapshotPropsPageBeforeLeave();
                                      router.push(dashboardHref);
                                      setTimeout(() => {
                                        navigatingRef.current = false;
                                        setNavigatingToPlayer(false);
                                      }, 1500);
                                    }}
                                  >
                                    {rowSport === 'nba' && (
                                      <AflPropsPlayerAvatar
                                        headshotUrl={headshotUrl}
                                        jerseyNumber={null}
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="md"
                                      />
                                    )}
                                    {rowSport === 'afl' &&
                                      (aflAvatarPending ? (
                                        <div
                                          className="w-12 h-12 rounded-full flex-shrink-0 border-2 animate-pulse bg-gray-200 dark:bg-gray-600"
                                          style={{
                                            borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb',
                                          }}
                                          aria-hidden
                                        />
                                      ) : (
                                        <AflPropsPlayerAvatar
                                          headshotUrl={aflHeadshotUrl}
                                          jerseyNumber={
                                            aflPlayerNumbers[prop.playerName] != null
                                              ? aflPlayerNumbers[prop.playerName]!
                                              : null
                                          }
                                          isDark={isDark}
                                          mounted={mounted}
                                          size="md"
                                        />
                                      ))}
                                    {isTennisPropsSport(rowSport) && (
                                      <AflPropsPlayerAvatar
                                        headshotUrl={tennisPropsHeadshotUrl(prop)}
                                        jerseyNumber={null}
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="md"
                                      />
                                    )}
                                    {rowSport === 'nbl' && (
                                      <AflPropsPlayerAvatar
                                        headshotUrl={prop.headshotUrl || null}
                                        jerseyNumber={null}
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="md"
                                      />
                                    )}
                                    <div className="min-w-0 flex-1 overflow-hidden">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <div className={`font-semibold truncate min-w-0 ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                          {prop.playerName}
                                        </div>
                                        {isTennisPropsSport(rowSport) ? (
                                          <TennisFlagAndRank
                                            ioc={prop.playerIoc}
                                            rank={prop.playerRank}
                                            isDark={isDark}
                                            mounted={mounted}
                                          />
                                        ) : null}
                                        {isCombinedMode && (
                                          <span className="flex-shrink-0">
                                            <SportMark
                                              sport={rowSport}
                                              tour={isTennisPropsSport(rowSport) ? prop.team : undefined}
                                              isDark={mounted && isDark}
                                              tiny
                                            />
                                          </span>
                                        )}
                                      </div>
                                      {rowSport === 'afl' && (() => {
                                        const aflPosLine = formatAflFantasyDfsPositionLabel(prop.aflFantasyPosition, prop.aflDfsRole);
                                        return aflPosLine ? (
                                          <div
                                            className={`text-xs font-semibold mt-0.5 ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}
                                          >
                                            {aflPosLine}
                                          </div>
                                        ) : null;
                                      })()}
                                      {rowSport === 'nbl' && (() => {
                                        const nblPosLine = formatNblPropsPositionLabel(prop.nblPosition, prop.nblPlayType);
                                        return nblPosLine ? (
                                          <div
                                            className={`text-xs font-semibold mt-0.5 ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}
                                          >
                                            {nblPosLine}
                                          </div>
                                        ) : null;
                                      })()}
                                      
                                      {isTennisPropsSport(rowSport) && (
                                        <div
                                          className={`text-xs font-semibold mt-0.5 truncate ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}
                                        >
                                          {tennisPropsEventSubtitle(prop, aflGames)}
                                        </div>
                                      )}
                                      <div
                                        className={propsRowStatLineClassName(prop.statType, {
                                          colorTennisMarkets: isTennisPropsSport(propsSport),
                                          isDark: !!(mounted && isDark),
                                        })}
                                      >
                                        {formatPropsRowStatLine(prop.statType, prop.line, getStatLabel(prop.statType), {
                                          milestone: rowSport === 'nbl' && (!prop.underOdds || prop.underOdds === 'N/A'),
                                        })}
                                      </div>
                                      <div className="flex items-center gap-2 mt-1">
                                        {rowSport === 'afl' ? (() => {
                                          // Use the prop's gameId to get the correct game from aflGames (same source as list API); display that game's matchup.
                                          const game = prop.gameId ? aflGames.find((g) => g.gameId === prop.gameId) ?? null : null;
                                          const gameHome = game ? toOfficialAflTeamDisplayName(game.homeTeam) : toOfficialAflTeamDisplayName(prop.homeTeam || prop.team || '');
                                          const gameAway = game ? toOfficialAflTeamDisplayName(game.awayTeam) : toOfficialAflTeamDisplayName(prop.awayTeam || prop.opponent || '');
                                          const playerTeam = toOfficialAflTeamDisplayName(prop.team || '') || gameHome;
                                          const opponent = playerTeam === gameHome ? gameAway : playerTeam === gameAway ? gameHome : gameAway;
                                          const homeD = playerTeam;
                                          let awayD = opponent;
                                          const same = homeD && awayD && homeD === awayD;
                                          if (same) awayD = '';
                                          const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
                                          const tryAflLogo = (name: string): string | null => {
                                            if (!name) return null;
                                            if (aflLogoByTeam[n(name)]) return aflLogoByTeam[n(name)];
                                            for (const w of name.split(/\s+/)) {
                                              if (aflLogoByTeam[n(w)]) return aflLogoByTeam[n(w)];
                                            }
                                            return null;
                                          };
                                          const homeLogoUrl = homeD ? tryAflLogo(homeD) : null;
                                          const awayLogoUrl = awayD ? tryAflLogo(awayD) : null;
                                          return (
                                            <div className="flex items-center gap-2 flex-wrap">
                                              {homeLogoUrl ? (
                                                <img src={homeLogoUrl} alt={homeD || ''} className="w-8 h-8 object-contain flex-shrink-0" />
                                              ) : (
                                                <div className={`w-8 h-8 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                              <span className={`text-xs flex-shrink-0 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>vs</span>
                                              {awayLogoUrl ? (
                                                <img src={awayLogoUrl} alt={awayD || ''} className="w-8 h-8 object-contain flex-shrink-0" />
                                              ) : (
                                                <div className={`w-8 h-8 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                            </div>
                                          );
                                        })(                                        ) : isTennisPropsSport(rowSport) ? (
                                          <TennisPropsOpponentLine
                                            opponentName={prop.opponent || prop.awayTeam || ''}
                                            opponentIoc={prop.opponentIoc || tennisIocFromListedPlayer(prop.opponent || '', playerProps)}
                                            opponentRank={prop.opponentRank}
                                            isDark={isDark}
                                            mounted={mounted}
                                          />
                                        ) : rowSport === 'nbl' ? (() => {
                                          const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
                                          const tryNblLogo = (name: string): string | null => {
                                            if (!name) return null;
                                            if (nblLogoByTeam[name]) return nblLogoByTeam[name];
                                            const key = n(name);
                                            for (const [logoKey, url] of Object.entries(nblLogoByTeam)) {
                                              if (n(logoKey) === key) return url;
                                            }
                                            return null;
                                          };
                                          const homeLogoUrl = tryNblLogo(prop.team || prop.homeTeam || '');
                                          const awayLogoUrl = tryNblLogo(prop.opponent || prop.awayTeam || '');
                                          return (
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              {homeLogoUrl ? (
                                                <img src={homeLogoUrl} alt={prop.team || ''} className="w-6 h-6 object-contain flex-shrink-0" />
                                              ) : (
                                                <div className={`w-6 h-6 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                              <span className={`text-xs flex-shrink-0 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>vs</span>
                                              {awayLogoUrl ? (
                                                <img src={awayLogoUrl} alt={prop.opponent || ''} className="w-6 h-6 object-contain flex-shrink-0" />
                                              ) : (
                                                <div className={`w-6 h-6 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                            </div>
                                          );
                                        })() : (
                                          <>
                                            <img src={teamLogoUrl} alt={prop.team} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                            <img src={opponentLogoUrl} alt={prop.opponent} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </a>
                                </td>

                                {isCombinedMode && showCombinedDesktopSportColumn && (
                                  <td className="py-3 px-3">
                                    <SportMark sport={rowSport} tour={isTennisPropsSport(rowSport) ? prop.team : undefined} isDark={mounted && isDark} />
                                  </td>
                                )}
                                
                                {/* Odds Column - Show bookmakers grouped by line with expand/collapse */}
                                <td
                                  className={`py-3 px-4 ${singleBookmakerOddsCell ? 'align-middle' : 'align-top'}`}
                                  style={PROPS_DESKTOP_ODDS_COL_STYLE}
                                >
                                    {(() => {
                                      const paintLines = isTennisPropsSport(rowSport)
                                        ? tennisDisplayBookmakerLines(prop)
                                        : (prop.bookmakerLines || []);
                                      return paintLines.length > 0 ? (
                                      (() => {
                                        // Filter bookmakerLines by selected bookmakers (if any are selected)
                                        let filteredLines = paintLines;
                                        if (!isCombinedMode && selectedBookmakers.size > 0) {
                                          filteredLines = paintLines.filter(line => 
                                            line.bookmaker && selectedBookmakers.has(line.bookmaker)
                                          );
                                        }
                                        
                                        // Group bookmakers by line value
                                        const linesByValue = new Map<number, typeof paintLines>();
                                        filteredLines.forEach(line => {
                                          const lineValue = line.line;
                                          if (!linesByValue.has(lineValue)) {
                                            linesByValue.set(lineValue, []);
                                          }
                                          linesByValue.get(lineValue)!.push(line);
                                        });

                                        // Sort by number of bookmakers (descending) - favor lines with more bookmakers
                                        const sortedLines = Array.from(linesByValue.entries()).sort((a, b) => {
                                          return b[1].length - a[1].length; // More bookmakers first
                                        });

                                        const singleBookmakerRow = filteredLines.length === 1;

                                        // Render each unique line value
                                        return (
                                          <div className={singleBookmakerRow ? 'max-w-full' : 'space-y-2 max-w-full'}>
                                            {sortedLines.map(([lineValue, lines]) => {
                                          // Use a stable key: player name + stat type + line value
                                          const expandKey = `${prop.playerName}|${prop.statType}|${lineValue}`;
                                          // Show 2 initially, or all if there are 2 or fewer
                                          const visibleLines = lines.length <= 2 ? lines : lines.slice(0, 2);
                                          const remainingCount = lines.length - visibleLines.length;
                                          const isPopupOpen = openPopup === expandKey;

                                          return (
                                            <div
                                              key={lineValue}
                                              className="flex items-center gap-1.5 max-w-full"
                                            >
                                              <div className="flex flex-col items-start gap-1.5">
                                              {/* Show visible bookmakers for this line */}
                                              {visibleLines.map((line, lineIdx) => {
                                                const bookmakerInfo = getBookmakerInfo(line.bookmaker || '');
                                                return (
                                                  <div key={lineIdx} className="flex items-center gap-1.5">
                                                    {/* Bookmaker card/button */}
                                                    <a
                                                      href={propsDashboardHref({
                                                        sport: rowSport,
                                                        playerName: prop.playerName,
                                                        playerId: prop.playerId,
                                                        team: prop.team,
                                                        opponent: prop.opponent,
                                                        statType: prop.statType,
                                                        line: line.line,
                                                        bookmaker: line.bookmaker,
                                                      })}
                                                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors ${
                                                      mounted && isDark
                                                        ? 'bg-[#0a1929] border-gray-700 hover:bg-[#0d1f35]'
                                                        : 'bg-white border-gray-300 hover:bg-gray-50'
                                                    }`}
                                                    onClick={(e) => {
                                                      if (!isUnmodifiedLeftClick(e)) return;
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      if (navigatingRef.current) return;
                                                      navigatingRef.current = true;
                                                      setNavigatingToPlayer(true);
                                                      navigateToSecondaryDashboard(line.line, line.bookmaker);
                                                    }}>
                                                      {bookmakerInfo?.logoUrl && (
                                                        <img
                                                          src={bookmakerInfo.logoUrl}
                                                          alt={bookmakerInfo.name}
                                                          className="w-6 h-6 object-contain flex-shrink-0 rounded"
                                                          onError={(e) => {
                                                            (e.target as HTMLImageElement).style.display = 'none';
                                                          }}
                                                        />
                                                      )}
                                                      <div className={`flex items-center gap-1 whitespace-nowrap ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                                        {(() => {
                                                          // Format odds based on user preference; show — for N/A
                                                          const formatOddsValue = (oddsStr: string): string => {
                                                            if (!oddsStr || oddsStr === 'N/A') return '—';
                                                            if (oddsFormat === 'decimal') {
                                                              const parsed = parseAmericanOdds(oddsStr);
                                                              if (parsed !== null) {
                                                                const decimal = americanToDecimal(parsed);
                                                                return decimal.toFixed(2);
                                                              }
                                                            }
                                                            return oddsStr; // Return as-is for American format
                                                          };
                                                          return (
                                                            <>
                                                              <span className={`${mounted && isDark ? 'text-green-400' : 'text-green-600'} text-[10px] 2xl:text-xs`}>O {formatOddsValue(line.overOdds)}</span>
                                                              {propsRowShowsUnderOdds(rowSport, line.underOdds) && (
                                                                <>
                                                                  <span className={`${mounted && isDark ? 'text-gray-500' : 'text-gray-400'} text-[10px] 2xl:text-xs`}>|</span>
                                                                  <span className={`${mounted && isDark ? 'text-red-400' : 'text-red-600'} text-[10px] 2xl:text-xs`}>U {formatOddsValue(line.underOdds)}</span>
                                                                </>
                                                              )}
                                                            </>
                                                          );
                                                        })()}
                                                      </div>
                                                    </a>
                                                  </div>
                                                );
                                              })}
                                              </div>
                                              
                                              {/* Show "+X more" button if there are more bookmakers */}
                                              {remainingCount > 0 && (
                                                <div className="relative">
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation(); // Prevent row click
                                                      setOpenPopup(openPopup === expandKey ? null : expandKey);
                                                    }}
                                                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                                                      mounted && isDark
                                                        ? 'bg-[#0a1929] border-gray-700 text-white hover:bg-[#0d1f35]'
                                                        : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                                                    }`}
                                                  >
                                                    +{remainingCount}
                                                  </button>
                                                  
                                                  {/* Popup modal for expanded view */}
                                                  {isPopupOpen && (
                                                    <>
                                                      {/* Backdrop - click to close */}
                                                      <div
                                                        className="fixed inset-0 z-40"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setOpenPopup(null);
                                                        }}
                                                      />
                                                      {/* Popup content - positioned relative to button */}
                                                      <div
                                                        className={`absolute top-full left-0 mt-2 z-50 rounded-lg border shadow-2xl p-4 max-w-3xl ${
                                                          mounted && isDark
                                                            ? 'bg-[#0a1929] border-gray-700'
                                                            : 'bg-gray-900 border-gray-500'
                                                        }`}
                                                        style={{
                                                          maxHeight: '70vh',
                                                          overflowY: 'auto',
                                                          minWidth: '400px'
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                      >
                                                        {/* Close button */}
                                                        <div className="flex justify-between items-center mb-3">
                                                          <span className={`text-sm font-medium text-gray-300`}>
                                                            {lines.length} bookmakers
                                                          </span>
                                                          <button
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              setOpenPopup(null);
                                                            }}
                                                            className={`text-gray-400 hover:text-white transition-colors p-1`}
                                                            aria-label="Close"
                                                          >
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                          </button>
                                                        </div>
                                                        
                                                        {/* All bookmakers in grid */}
                                                        <div className="flex flex-wrap gap-2">
                                                          {lines.map((line, lineIdx) => {
                                                            const bookmakerInfo = getBookmakerInfo(line.bookmaker || '');
                                                            return (
                                                              <a
                                                                href={propsDashboardHref({
                                                                  sport: rowSport,
                                                                  playerName: prop.playerName,
                                                                  playerId: prop.playerId,
                                                                  team: prop.team,
                                                                  opponent: prop.opponent,
                                                                  statType: prop.statType,
                                                                  line: line.line,
                                                                  bookmaker: line.bookmaker,
                                                                })}
                                                                key={lineIdx}
                                                                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${
                                                                  mounted && isDark
                                                                    ? 'bg-[#0a1929] border-gray-700'
                                                                    : 'bg-gray-800 border-gray-500'
                                                                }`}
                                                                onClick={(e) => {
                                                                  if (!isUnmodifiedLeftClick(e)) return;
                                                                  e.preventDefault();
                                                                  e.stopPropagation();
                                                                  if (navigatingRef.current) return;
                                                                  navigatingRef.current = true;
                                                                  setNavigatingToPlayer(true);
                                                                  setOpenPopup(null);
                                                                  navigateToSecondaryDashboard(line.line, line.bookmaker);
                                                                }}
                                                              >
                                                                {bookmakerInfo?.logoUrl && (
                                                                  <img
                                                                    src={bookmakerInfo.logoUrl}
                                                                    alt={bookmakerInfo.name}
                                                                    className="w-6 h-6 object-contain flex-shrink-0 rounded"
                                                                    onError={(e) => {
                                                                      (e.target as HTMLImageElement).style.display = 'none';
                                                                    }}
                                                                  />
                                                                )}
                                                                <div className="flex items-center gap-1 whitespace-nowrap text-white">
                                                                  {(() => {
                                                                    // Format odds based on user preference; show — for N/A
                                                                    const formatOddsValue = (oddsStr: string): string => {
                                                                      if (!oddsStr || oddsStr === 'N/A') return '—';
                                                                      if (oddsFormat === 'decimal') {
                                                                        const parsed = parseAmericanOdds(oddsStr);
                                                                        if (parsed !== null) {
                                                                          const decimal = americanToDecimal(parsed);
                                                                          return decimal.toFixed(2);
                                                                        }
                                                                      }
                                                                      return oddsStr;
                                                                    };
                                                                    return (
                                                                      <>
                                                                        <span className="text-green-400 font-medium text-[10px] 2xl:text-xs">O {formatOddsValue(line.overOdds)}</span>
                                                                        {propsRowShowsUnderOdds(rowSport, line.underOdds) && (
                                                                          <>
                                                                            <span className="text-gray-500 text-[10px] 2xl:text-xs">|</span>
                                                                            <span className="text-red-400 font-medium text-[10px] 2xl:text-xs">U {formatOddsValue(line.underOdds)}</span>
                                                                          </>
                                                                        )}
                                                                      </>
                                                                    );
                                                                  })()}
                                                                </div>
                                                              </a>
                                                            );
                                                          })}
                                                        </div>
                                                      </div>
                                                    </>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                          </div>
                                        );
                                      })()
                                    ) : (
                                      // Fallback to main bookmaker if no bookmakerLines
                                      (() => {
                                        const bookmakerInfo = getBookmakerInfo(prop.bookmaker || '');
                                        return (
                                          <div className="flex items-center gap-2">
                                            {bookmakerInfo?.logoUrl && (
                                              <img
                                                src={bookmakerInfo.logoUrl}
                                                alt={bookmakerInfo.name}
                                                className="w-5 h-5 object-contain flex-shrink-0"
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            )}
                                            <div className={`text-sm ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                              <div>Over: {prop.overOdds && prop.overOdds !== 'N/A' ? prop.overOdds : '—'}</div>
                                              {propsRowShowsUnderOdds(rowSport, prop.underOdds) && (
                                                <div>Under: {prop.underOdds && prop.underOdds !== 'N/A' ? prop.underOdds : '—'}</div>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })()
                                    );
                                    })()}
                                </td>
                                
                                {/* IP Column - Implied Odds */}
                                <td
                                  className={`py-3 px-4 whitespace-nowrap ${singleBookmakerOddsCell ? 'align-middle' : 'align-top'}`}
                                  style={PROPS_DESKTOP_IP_COL_STYLE}
                                >
                                  <div className="flex items-center">
                                    {/* Bookmakers */}
                                    <div className="flex flex-col gap-1">
                                      <div className={`text-[10px] ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Bookmakers
                                      </div>
                                      <div className="flex flex-col gap-0.5">
                                        {(() => {
                                          const sourceLines = isTennisPropsSport(rowSport)
                                            ? tennisDisplayBookmakerLines(prop)
                                            : (prop.bookmakerLines || []);
                                          const filteredLines = !isCombinedMode && selectedBookmakers.size > 0
                                            ? sourceLines.filter((line) => line.bookmaker && selectedBookmakers.has(line.bookmaker))
                                            : sourceLines;
                                          const { overProb, underProb } = getConsensusImpliedProbabilities(prop, filteredLines);
                                          const showUnderIp = propsRowShowsUnderOdds(rowSport, prop.underOdds);
                                          return (
                                            <>
                                              <div className={`text-sm font-semibold ${overProb != null ? (showUnderIp && overProb < (underProb ?? 0) ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : ''}`}>
                                                Over {overProb != null ? `${overProb.toFixed(1)}%` : '—'}
                                              </div>
                                              {showUnderIp && (
                                                <div className={`text-sm font-semibold ${underProb != null ? (underProb >= (overProb ?? 0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400') : ''}`}>
                                                  Under {underProb != null ? `${underProb.toFixed(1)}%` : '—'}
                                                </div>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                
                                {/* DvP Column */}
                                <td className="py-3 px-1 text-center align-middle" style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                  {displayProp.dvpRating !== null && displayProp.dvpRating !== undefined && typeof displayProp.dvpRating === 'number' && displayProp.dvpRating > 0 ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        // Color coding by league size.
                                        // AFL (18 teams): 1-6 hard (red), 7-12 neutral (orange), 13-18 easy (green)
                                        // NBA (30 teams): 1-10 hard (red), 11-20 neutral (orange), 21-30 easy (green)
                                        const { easyMin, hardMax } = dvpColorBands(rowSport, displayProp.dvpFieldSize);
                                        if (displayProp.dvpRating! >= easyMin) {
                                          bgColor = mounted && isDark ? '#166534' : '#dcfce7'; // green-800 / green-100
                                          borderColor = '#22c55e';
                                          glowColor = '#22c55e';
                                        } else if (displayProp.dvpRating! > hardMax) {
                                          bgColor = mounted && isDark ? '#9a3412' : '#fed7aa'; // orange-800 / orange-100
                                          borderColor = '#f97316';
                                          glowColor = '#f97316';
                                        } else {
                                          bgColor = mounted && isDark ? '#991b1b' : '#fee2e2'; // red-800 / red-100
                                          borderColor = '#ef4444';
                                          glowColor = '#ef4444';
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center text-center leading-tight">
                                        <div className="flex-1 flex items-center justify-center">
                                          <div className="text-sm font-semibold text-white leading-tight">
                                            {dvpRankText(rowSport, displayProp.dvpRating, displayProp.dvpFieldSize)}
                                          </div>
                                        </div>
                                        {isTennisPropsSport(rowSport) && isTennisMoneylineStat(displayProp.statType) ? (
                                          <span className="pb-0.5 text-[8px] leading-none font-medium text-white/80">
                                            Seed
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="relative inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                      {isTennisPropsSport(rowSport) && isTennisMoneylineStat(displayProp.statType) ? (
                                        <span className={`absolute bottom-0.5 left-0 right-0 text-[8px] leading-none font-medium ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                          Seed
                                        </span>
                                      ) : null}
                                    </div>
                                  )}
                                </td>
                                
                                {/* L5 Column */}
                                <td className="py-3 px-1 text-center align-middle" style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                  {(displayProp.last5Avg !== null && displayProp.last5Avg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (displayProp.last5HitRate) {
                                          const hitRate = (displayProp.last5HitRate.hits / displayProp.last5HitRate.total) * 100;
                                          if (hitRate < 30) {
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
                                            bgColor = '#22c55e';
                                            borderColor = '#22c55e';
                                            glowColor = '#22c55e';
                                          }
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          {displayProp.last5Avg!.toFixed(1)}
                                        </div>
                                        {displayProp.last5HitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.last5HitRate.hits}/{displayProp.last5HitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.last5HitRate.hits / displayProp.last5HitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                
                                {/* L10 Column */}
                                <td className="py-3 px-1 text-center align-middle" style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                  {(displayProp.last10Avg !== null && displayProp.last10Avg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (displayProp.last10HitRate) {
                                          const hitRate = (displayProp.last10HitRate.hits / displayProp.last10HitRate.total) * 100;
                                          if (hitRate < 30) {
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
                                            bgColor = '#22c55e';
                                            borderColor = '#22c55e';
                                            glowColor = '#22c55e';
                                          }
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          {displayProp.last10Avg!.toFixed(1)}
                                        </div>
                                        {displayProp.last10HitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.last10HitRate.hits}/{displayProp.last10HitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.last10HitRate.hits / displayProp.last10HitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                
                                {showH2hColumn && (
                                <td className="py-3 px-1 text-center align-middle" style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                  {(displayProp.h2hHitRate?.total ?? 0) > 0 ||
                                  (displayProp.h2hAvg !== null && displayProp.h2hAvg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (displayProp.h2hHitRate) {
                                          const hitRate = (displayProp.h2hHitRate.hits / displayProp.h2hHitRate.total) * 100;
                                          if (hitRate < 30) {
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
                                            bgColor = '#22c55e';
                                            borderColor = '#22c55e';
                                            glowColor = '#22c55e';
                                          }
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        {displayProp.h2hAvg != null && (
                                          <div className="text-sm font-semibold text-white leading-tight">
                                            {displayProp.h2hAvg.toFixed(1)}
                                          </div>
                                        )}
                                        {displayProp.h2hHitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.h2hHitRate.hits}/{displayProp.h2hHitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.h2hHitRate.hits / displayProp.h2hHitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                )}

                                {/* Season Column */}
                                <td className="py-3 px-1 text-center align-middle" style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                  {(displayProp.seasonHitRate?.total ?? 0) > 0 ||
                                  (displayProp.seasonAvg !== null && displayProp.seasonAvg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (displayProp.seasonHitRate) {
                                          const hitRate = (displayProp.seasonHitRate.hits / displayProp.seasonHitRate.total) * 100;
                                          if (hitRate < 30) {
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
                                            bgColor = '#22c55e';
                                            borderColor = '#22c55e';
                                            glowColor = '#22c55e';
                                          }
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          {displayProp.seasonAvg!.toFixed(1)}
                                        </div>
                                        {displayProp.seasonHitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.seasonHitRate.hits}/{displayProp.seasonHitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.seasonHitRate.hits / displayProp.seasonHitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                
                                {/* Streak Column */}
                                <td className="py-3 px-1 text-center align-middle" style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                  {(displayProp.streak !== null && displayProp.streak !== undefined) ? (
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = '';
                                        let borderColor = '';
                                        let glowColor = '';
                                        
                                        if (displayProp.streak! >= 2) {
                                          bgColor = '#22c55e';
                                          borderColor = '#22c55e';
                                          glowColor = '#22c55e';
                                        } else if (displayProp.streak === 1) {
                                          bgColor = '#E88A3B';
                                          borderColor = '#f97316';
                                          glowColor = '#f97316';
                                        } else {
                                          bgColor = '#B03A3A';
                                          borderColor = '#ef4444';
                                          glowColor = '#ef4444';
                                        }
                                        
                                        return {
                                          background: `linear-gradient(to top, ${bgColor}, ${bgColor}00)`,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <span className="text-sm font-semibold text-white">
                                        {displayProp.streak === 0
                                          ? '0'
                                          : displayProp.streak! > 0
                                            ? `${displayProp.streak} 🔥`
                                            : String(displayProp.streak)}
                                      </span>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className={`text-sm font-medium ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
                                  )}
                                </td>
                                
                                {/* Tipoff Countdown Column */}
                                <td className="py-3 px-1 text-center align-middle" style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                  <TipoffCountdown
                                    game={getTipoffGameForRow(prop, rowSport)}
                                    isDark={mounted && isDark}
                                    label={rowSportKickoffLabel(rowSport)}
                                    maxAheadMs={kickoffMaxAheadMs(rowSport)}
                                  />
                                </td>
                                
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                      
                      {/* Mobile Column Sort Filters - Scrollable row above player props */}
                      {!isCombinedMode && (
                      <div className="2xl:hidden mb-4 w-full px-0.5">
                        <div 
                          className="overflow-x-auto mobile-filter-scroll rounded-2xl px-0.5 py-1.5"
                          style={{ 
                            scrollbarWidth: 'thin',
                            scrollbarColor: mounted && isDark ? '#4b5563 #1f2937' : '#9ca3af #f3f4f6',
                            paddingLeft: '0.5rem',
                            paddingRight: '1rem'
                          }}
                        >
                          <div className="flex gap-2 min-w-max pb-2" style={{ width: 'max-content' }}>
                            {/* IP Sort */}
                            <button
                              onClick={() => handleColumnSort('ip')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap flex-shrink-0 shadow-sm ${
                                columnSort.ip !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>IP</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.ip !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.ip === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.ip === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.ip === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* DvP Sort */}
                            <button
                              onClick={() => handleColumnSort('dvp')}
                              title={undefined}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap flex-shrink-0 shadow-sm ${
                                columnSort.dvp !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>DvP</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.dvp !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.dvp === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.dvp === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.dvp === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* L5 Sort */}
                            <button
                              onClick={() => handleColumnSort('l5')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap flex-shrink-0 shadow-sm ${
                                columnSort.l5 !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>L5</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.l5 !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.l5 === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.l5 === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.l5 === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* L10 Sort */}
                            <button
                              onClick={() => handleColumnSort('l10')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap flex-shrink-0 shadow-sm ${
                                columnSort.l10 !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>L10</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.l10 !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.l10 === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.l10 === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.l10 === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* H2H Sort */}
                            {showH2hColumn && (
                            <button
                              onClick={() => handleColumnSort('h2h')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap flex-shrink-0 shadow-sm ${
                                columnSort.h2h !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>H2H</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.h2h !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.h2h === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.h2h === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.h2h === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>
                            )}

                            {/* Season Sort */}
                            <button
                              onClick={() => handleColumnSort('season')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap flex-shrink-0 shadow-sm ${
                                columnSort.season !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>Season</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.season !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.season === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.season === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.season === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* Streak Sort */}
                            <button
                              onClick={() => handleColumnSort('streak')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap flex-shrink-0 shadow-sm ${
                                columnSort.streak !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>Streak</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.streak !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.streak === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.streak === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.streak === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                      )}
                      
                      {/* Mobile Card View - Hidden on desktop */}
                      <div className={`2xl:hidden space-y-4.5 ${shellDark ? 'bg-[#050d1a]' : ''}`}>
                        {propsTablePaginatedProps.map((prop, idx) => {
                          const rowSport = resolvePropsRowSport(prop, propsSport);
                          const dashboardHref = propsDashboardHref({
                            sport: rowSport,
                            playerName: prop.playerName,
                            playerId: prop.playerId,
                            team: prop.team,
                            opponent: prop.opponent,
                            opponentIoc: prop.opponentIoc,
                            opponentId: prop.opponentId,
                            statType: prop.statType,
                            line: Number.isFinite(prop.line) ? prop.line : null,
                            bookmaker: prop.bookmaker,
                          });
                          const bdlId = rowSport === 'nba' ? getPlayerIdFromName(prop.playerName) : null;
                          const nbaId = bdlId ? convertBdlToNbaId(bdlId) : null;
                          const headshotUrl = nbaId ? getPlayerHeadshotUrl(nbaId) : null;
                          const aflHeadshotUrl =
                            rowSport === 'afl'
                              ? getAflPlayerHeadshotUrl(prop.playerName) ?? aflPortraitExtras[prop.playerName] ?? null
                              : null;
                          const aflAvatarPending =
                            rowSport === 'afl' &&
                            aflPortraitBatchLoading &&
                            !getAflPlayerHeadshotUrl(prop.playerName) &&
                            !aflPortraitExtras[prop.playerName] &&
                            !aflPortraitFetchedRef.current.has(prop.playerName);
                          const normalizeTeam = (team: string): string => {
                            if (!team) return '';
                            if (team.length <= 3) return team.toUpperCase();
                            return TEAM_FULL_TO_ABBR[team] || team.toUpperCase();
                          };
                          const teamAbbr = normalizeTeam(prop.team);
                          const opponentAbbr = normalizeTeam(prop.opponent);
                          const teamLogoUrl = getEspnLogoUrl(teamAbbr);
                          const opponentLogoUrl = getEspnLogoUrl(opponentAbbr);
                          const game = getTipoffGameForRow(prop, rowSport);
                          
                          // Format game date/time
                          const formatGameDateTime = (game: Game | null): string => {
                            if (!game || !game.date) return '';
                            try {
                              const date = new Date(game.date);
                              const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                              const dayName = days[date.getDay()];
                              const hours = date.getHours();
                              const minutes = date.getMinutes();
                              const ampm = hours >= 12 ? 'PM' : 'AM';
                              const displayHours = hours % 12 || 12;
                              const displayMinutes = minutes.toString().padStart(2, '0');
                              return `${dayName} @ ${displayHours}:${displayMinutes}${ampm}`;
                            } catch {
                              return '';
                            }
                          };
                          
                          // Helper to format hit rate percentage
                          const getHitRatePercent = (hitRate: { hits: number; total: number } | null | undefined): string => {
                            if (!hitRate || hitRate.total === 0) return 'N/A';
                            return `${((hitRate.hits / hitRate.total) * 100).toFixed(0)}%`;
                          };
                          
                          // Helper to get stat box color based on hit rate
                          const getStatBoxStyle = (hitRate: { hits: number; total: number } | null | undefined, isStreak = false) => {
                            // If no hitRate data (null/undefined) or no valid data (total === 0) and not streak, return grey box - darker on mobile/dark mode
                            if (!isStreak && (!hitRate || hitRate.total === 0)) {
                              return {
                                background: mounted && isDark ? '#1a2140' : '#f3f4f6',
                                borderColor: mounted && isDark ? '#4d4a73' : '#d1d5db',
                                borderWidth: '2px',
                                boxShadow: 'none',
                              };
                            }
                            
                            let bgColor = mounted && isDark ? '#1a2140' : '#f9fafb';
                            let borderColor = mounted && isDark ? '#4d4a73' : '#e5e7eb';
                            let glowColor: string | null = null;
                            
                            if (isStreak) {
                              const streakValue = prop.streak ?? 0;
                              if (streakValue >= 2) {
                                bgColor = '#22c55e'; // green
                                borderColor = '#22c55e';
                                glowColor = '#22c55e';
                              } else if (streakValue === 1) {
                                bgColor = '#f59e0b'; // amber
                                borderColor = '#f59e0b';
                                glowColor = '#f59e0b';
                              } else {
                                bgColor = '#ef4444'; // red
                                borderColor = '#ef4444';
                                glowColor = '#ef4444';
                              }
                            } else if (hitRate) {
                              const percent = (hitRate.hits / hitRate.total) * 100;
                              if (percent < 30) {
                                bgColor = '#ef4444'; // red
                                borderColor = '#ef4444';
                                glowColor = '#ef4444';
                              } else if (percent < 70) {
                                bgColor = '#f59e0b'; // amber
                                borderColor = '#f59e0b';
                                glowColor = '#f59e0b';
                              } else {
                                bgColor = '#22c55e'; // green
                                borderColor = '#22c55e';
                                glowColor = '#22c55e';
                              }
                            }
                            
                            return {
                              background: bgColor !== (mounted && isDark ? '#1a2140' : '#f9fafb')
                                ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)`
                                : bgColor,
                              borderColor: borderColor,
                              borderWidth: '1px',
                              boxShadow: glowColor ? `0 0 12px ${glowColor}75, 0 0 6px ${glowColor}55` : 'none',
                            };
                          };
                          
                          // Format odds helper; show — for N/A
                          const formatOddsValue = (oddsStr: string): string => {
                            if (!oddsStr || oddsStr === 'N/A') return '—';
                            if (oddsFormat === 'decimal') {
                              const parsed = parseAmericanOdds(oddsStr);
                              if (parsed !== null) {
                                const decimal = americanToDecimal(parsed);
                                return decimal.toFixed(2);
                              }
                            }
                            return oddsStr;
                          };
                          
                          return (
                            <div
                              key={propsListRowKey(prop, rowSport)}
                              className={`relative rounded-2xl border px-3.5 py-3.5 cursor-pointer active:scale-[0.99] transition-transform shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${
                                mounted && isDark ? 'bg-gradient-to-br from-[#0b1a2b] via-[#10253f] to-[#1b1c3d] border-[#463e6b]' : 'bg-white border-gray-200'
                              }`}
                              onAuxClick={(e) => {
                                if (e.button !== 1) return;
                                if (eventTargetIsInteractive(e)) return;
                                e.preventDefault();
                                window.open(dashboardHref, '_blank', 'noopener,noreferrer');
                              }}
                              onClick={(e) => {
                                if (!isUnmodifiedLeftClick(e)) return;
                                if (eventTargetIsInteractive(e)) return;
                                if (navigatingRef.current) return;
                                navigatingRef.current = true;
                                setNavigatingToPlayer(true);
                                if (rowSport === 'afl' || rowSport === 'nbl' || isTennisPropsSport(rowSport)) {
                                  if (isTennisPropsSport(rowSport)) {
                                    navigateToTennisDashboardFromProp(prop, router);
                                    setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                                    return;
                                  }
                                  if (rowSport === 'nbl') {
                                    prefetchNblDashboardFromProps({
                                      playerName: prop.playerName,
                                      playerId: prop.playerId,
                                      team: prop.team,
                                      opponent: prop.opponent,
                                    });
                                    snapshotPropsPageBeforeLeave();
                                    router.push(
                                      nblDashboardHref({
                                        playerName: prop.playerName,
                                        playerId: prop.playerId,
                                        team: prop.team,
                                        opponent: prop.opponent,
                                        statType: prop.statType,
                                        line: Number.isFinite(prop.line) ? prop.line : null,
                                        bookmaker: prop.bookmaker,
                                      })
                                    );
                                    setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                                    return;
                                  }
                                  const team = prop.team || '';
                                  const opponent = prop.opponent || '';

                                  prefetchAflDashboardFromProps({
                                    playerName: prop.playerName,
                                    team,
                                    opponent,
                                  });

                                  if (team) {
                                    fetch(`/api/afl/next-game?team=${encodeURIComponent(team)}&season=2026`)
                                      .then((r) => r.json())
                                      .then((d) => {
                                        try {
                                          sessionStorage.setItem('afl_next_game_prefetch', JSON.stringify({
                                            team,
                                            next_opponent: d?.next_opponent ?? null,
                                            next_game_tipoff: d?.next_game_tipoff ?? null,
                                            next_game_id: d?.next_game_id ?? d?.game_id ?? null,
                                            fetchedAt: Date.now(),
                                          }));
                                        } catch {}
                                        const gameId = d?.game_id ?? d?.gameId ?? null;
                                        if (gameId) {
                                          fetch(`/api/afl/odds?game_id=${encodeURIComponent(String(gameId))}`, { cache: 'default' }).catch(() => {});
                                        } else if (team && opponent) {
                                          fetch(`/api/afl/odds?team=${encodeURIComponent(team)}&opponent=${encodeURIComponent(opponent)}`, { cache: 'default' }).catch(() => {});
                                        }
                                      })
                                      .catch(() => {});
                                  }
                                  const q = new URLSearchParams();
                                  q.set('mode', 'player');
                                  q.set('name', prop.playerName);
                                  if (prop.team) q.set('team', prop.team);
                                  if (prop.opponent) q.set('opponent', prop.opponent);
                                  q.set('stat', normalizeAflStatForDashboard(prop.statType));
                                  const selectedLine = Number.isFinite(prop.line) ? prop.line : null;
                                  if (selectedLine != null) q.set('line', String(selectedLine));
                                  const selectedBook = String(prop.bookmaker || '').trim();
                                  if (selectedBook) q.set('bookmaker', selectedBook);

                                  setTimeout(() => {
                                    snapshotPropsPageBeforeLeave();
                                    router.push(`/afl?${q.toString()}`);
                                  }, 200);
                                  setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                                  return;
                                }
                                try {
                                  sessionStorage.removeItem('nba_dashboard_session_v1');
                                  sessionStorage.setItem('from_props_page', 'true');
                                } catch {}
                                const params = new URLSearchParams();
                                params.set('player', prop.playerName);
                                params.set('stat', (prop.statType || '').toLowerCase());
                                params.set('line', prop.line.toString());
                                params.set('tf', 'last10');
                                snapshotPropsPageBeforeLeave();
                                router.push(`/nba/research/dashboard?${params.toString()}`);
                                setTimeout(() => {
                                  navigatingRef.current = false;
                                  setNavigatingToPlayer(false);
                                }, 1500);
                              }}
                            >
                              {/* Header Section */}
                              <div className="mb-1.5">
                                {/* Player Name and Headshot Row */}
                                <div className="flex items-start gap-2.5 mb-2 min-w-0">
                                  {rowSport === 'afl' ? (
                                    aflAvatarPending ? (
                                      <div
                                        className="w-10 h-10 rounded-full flex-shrink-0 border-2 animate-pulse bg-gray-200 dark:bg-gray-600"
                                        style={{
                                          borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb',
                                        }}
                                        aria-hidden
                                      />
                                    ) : (
                                      <AflPropsPlayerAvatar
                                        headshotUrl={aflHeadshotUrl}
                                        jerseyNumber={
                                          aflPlayerNumbers[prop.playerName] != null
                                            ? aflPlayerNumbers[prop.playerName]!
                                            : null
                                        }
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="sm"
                                      />
                                    )
                                  ) : isTennisPropsSport(rowSport) ? (
                                    <AflPropsPlayerAvatar
                                      headshotUrl={tennisPropsHeadshotUrl(prop)}
                                      jerseyNumber={null}
                                      isDark={isDark}
                                      mounted={mounted}
                                      size="sm"
                                    />
                                  ) : rowSport === 'nbl' ? (
                                    <AflPropsPlayerAvatar
                                      headshotUrl={prop.headshotUrl || null}
                                      jerseyNumber={null}
                                      isDark={isDark}
                                      mounted={mounted}
                                      size="sm"
                                    />
                                  ) : (
                                    <AflPropsPlayerAvatar
                                      headshotUrl={headshotUrl}
                                      jerseyNumber={null}
                                      isDark={isDark}
                                      mounted={mounted}
                                      size="sm"
                                    />
                                  )}
                                  <div className="flex-1 min-w-0 overflow-hidden">
                                    <div className="flex items-center justify-between gap-2 min-w-0">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <a
                                          href={dashboardHref}
                                          className={`font-bold text-base truncate min-w-0 no-underline hover:no-underline ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}
                                          onClick={(e) => {
                                            if (!isUnmodifiedLeftClick(e)) return;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (navigatingRef.current) return;
                                            navigatingRef.current = true;
                                            setNavigatingToPlayer(true);
                                            if (isTennisPropsSport(rowSport)) {
                                              navigateToTennisDashboardFromProp(prop, router);
                                            } else if (rowSport === 'afl') {
                                              prefetchAflDashboardFromProps({
                                                playerName: prop.playerName,
                                                team: prop.team || '',
                                                opponent: prop.opponent || '',
                                              });
                                              snapshotPropsPageBeforeLeave();
                                              router.push(dashboardHref);
                                            } else {
                                              try {
                                                sessionStorage.removeItem('nba_dashboard_session_v1');
                                                sessionStorage.setItem('from_props_page', 'true');
                                              } catch {}
                                              snapshotPropsPageBeforeLeave();
                                              router.push(dashboardHref);
                                            }
                                            setTimeout(() => {
                                              navigatingRef.current = false;
                                              setNavigatingToPlayer(false);
                                            }, 1500);
                                          }}
                                        >
                                          {prop.playerName}
                                        </a>
                                        {isTennisPropsSport(rowSport) ? (
                                          <TennisFlagAndRank
                                            ioc={prop.playerIoc}
                                            rank={prop.playerRank}
                                            isDark={isDark}
                                            mounted={mounted}
                                            compact
                                          />
                                        ) : null}
                                        {isCombinedMode && (
                                          <span className="flex-shrink-0">
                                            <SportMark
                                              sport={rowSport}
                                              tour={isTennisPropsSport(rowSport) ? prop.team : undefined}
                                              isDark={mounted && isDark}
                                              tiny
                                            />
                                          </span>
                                        )}
                                      </div>
                                      {/* Team Logos */}
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {rowSport === 'afl' ? (() => {
                                          const game = prop.gameId ? aflGames.find((g) => g.gameId === prop.gameId) ?? null : null;
                                          const gameHome = game ? toOfficialAflTeamDisplayName(game.homeTeam) : toOfficialAflTeamDisplayName(prop.homeTeam || prop.team || '');
                                          const gameAway = game ? toOfficialAflTeamDisplayName(game.awayTeam) : toOfficialAflTeamDisplayName(prop.awayTeam || prop.opponent || '');
                                          const playerTeam = toOfficialAflTeamDisplayName(prop.team || '') || gameHome;
                                          const opponent = playerTeam === gameHome ? gameAway : playerTeam === gameAway ? gameHome : gameAway;
                                          const homeD = playerTeam;
                                          let awayD = opponent;
                                          const same = homeD && awayD && homeD === awayD;
                                          if (same) awayD = '';
                                          const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
                                          const tryAflLogo = (name: string): string | null => {
                                            if (!name) return null;
                                            if (aflLogoByTeam[n(name)]) return aflLogoByTeam[n(name)];
                                            for (const w of name.split(/\s+/)) {
                                              if (aflLogoByTeam[n(w)]) return aflLogoByTeam[n(w)];
                                            }
                                            return null;
                                          };
                                          const homeLogoUrl = homeD ? tryAflLogo(homeD) : null;
                                          const awayLogoUrl = awayD ? tryAflLogo(awayD) : null;
                                          return (
                                            <>
                                              {homeLogoUrl ? (
                                                <img src={homeLogoUrl} alt={homeD || ''} className="w-5 h-5 object-contain" />
                                              ) : (
                                                <div className={`w-5 h-5 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                              <span className={`text-[10px] leading-none ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>vs</span>
                                              {awayLogoUrl ? (
                                                <img src={awayLogoUrl} alt={awayD || ''} className="w-5 h-5 object-contain" />
                                              ) : (
                                                <div className={`w-5 h-5 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                            </>
                                          );
                                        })() : isTennisPropsSport(rowSport) ? null : rowSport === 'nbl' ? (() => {
                                          const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
                                          const tryNblLogo = (name: string): string | null => {
                                            if (!name) return null;
                                            if (nblLogoByTeam[name]) return nblLogoByTeam[name];
                                            const key = n(name);
                                            for (const [logoKey, url] of Object.entries(nblLogoByTeam)) {
                                              if (n(logoKey) === key) return url;
                                            }
                                            return null;
                                          };
                                          const homeLogoUrl = tryNblLogo(prop.team || prop.homeTeam || '');
                                          const awayLogoUrl = tryNblLogo(prop.opponent || prop.awayTeam || '');
                                          return (
                                            <>
                                              {homeLogoUrl ? (
                                                <img src={homeLogoUrl} alt={prop.team || ''} className="w-5 h-5 object-contain" />
                                              ) : (
                                                <div className={`w-5 h-5 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                              <span className={`text-[10px] leading-none ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>vs</span>
                                              {awayLogoUrl ? (
                                                <img src={awayLogoUrl} alt={prop.opponent || ''} className="w-5 h-5 object-contain" />
                                              ) : (
                                                <div className={`w-5 h-5 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                            </>
                                          );
                                        })() : (
                                          <>
                                            {teamLogoUrl && (
                                              <img
                                                src={teamLogoUrl}
                                                alt={prop.team}
                                                className="w-5 h-5 object-contain"
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            )}
                                            {opponentLogoUrl && (
                                              <img
                                                src={opponentLogoUrl}
                                                alt={prop.opponent}
                                                className="w-5 h-5 object-contain"
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    {rowSport === 'afl' && (() => {
                                      const aflPosLine = formatAflFantasyDfsPositionLabel(prop.aflFantasyPosition, prop.aflDfsRole);
                                      return aflPosLine ? (
                                        <div
                                          className={`text-xs font-semibold mt-0.5 ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}
                                        >
                                          {aflPosLine}
                                        </div>
                                      ) : null;
                                    })()}
                                    {rowSport === 'nbl' && (() => {
                                      const nblPosLine = formatNblPropsPositionLabel(prop.nblPosition, prop.nblPlayType);
                                      return nblPosLine ? (
                                        <div
                                          className={`text-xs font-semibold mt-0.5 ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}
                                        >
                                          {nblPosLine}
                                        </div>
                                      ) : null;
                                    })()}
                                    
                                    {isTennisPropsSport(rowSport) && (
                                      <>
                                        <div
                                          className={`text-xs font-semibold mt-0.5 truncate ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}
                                        >
                                          {tennisPropsEventSubtitle(prop, aflGames)}
                                        </div>
                                        <div className="mt-1">
                                          <TennisPropsOpponentLine
                                            opponentName={prop.opponent || prop.awayTeam || ''}
                                            opponentIoc={prop.opponentIoc || tennisIocFromListedPlayer(prop.opponent || '', playerProps)}
                                            opponentRank={prop.opponentRank}
                                            isDark={isDark}
                                            mounted={mounted}
                                            compact
                                          />
                                        </div>
                                      </>
                                    )}
                                    {/* Stat Type and Line */}
                                    <div
                                      className={propsRowStatLineClassName(prop.statType, {
                                        colorTennisMarkets: isTennisPropsSport(propsSport),
                                        isDark: !!(mounted && isDark),
                                        mobile: true,
                                      })}
                                    >
                                      {formatPropsRowStatLine(prop.statType, prop.line, getStatLabel(prop.statType), {
                                        milestone: rowSport === 'nbl' && (!prop.underOdds || prop.underOdds === 'N/A'),
                                      })}
                                    </div>
                                  </div>
                                  {/* Bookmaker IP Box - darker text on mobile */}
                                  <div className="flex-shrink-0">
                                    <div className="flex flex-col items-center justify-center rounded-lg border-2 px-3 py-2" style={getStatBoxStyle(null)}>
                                      <div className={`text-[10px] font-semibold mb-1 ${mounted && isDark ? 'text-gray-500 sm:text-gray-300' : 'text-gray-600 sm:text-gray-700'}`}>Books</div>
                                      {(() => {
                                        const sourceLines = isTennisPropsSport(rowSport)
                                          ? tennisDisplayBookmakerLines(prop)
                                          : (prop.bookmakerLines || []);
                                        const filteredLines = !isCombinedMode && selectedBookmakers.size > 0
                                          ? sourceLines.filter((line) => line.bookmaker && selectedBookmakers.has(line.bookmaker))
                                          : sourceLines;
                                        const { overProb, underProb } = getConsensusImpliedProbabilities(prop, filteredLines);
                                        const showUnderIp = propsRowShowsUnderOdds(rowSport, prop.underOdds);

                                        return (
                                          <>
                                            <div className={`text-xs font-bold ${mounted && isDark ? 'text-green-500 sm:text-green-400' : 'text-green-600'}`}>
                                              {overProb !== null && overProb !== undefined ? `${overProb.toFixed(0)}%` : '-'}
                                            </div>
                                            {showUnderIp && (
                                              <div className={`text-xs font-bold ${mounted && isDark ? 'text-red-500 sm:text-red-400' : 'text-red-600'}`}>
                                                {underProb !== null && underProb !== undefined ? `${underProb.toFixed(0)}%` : '-'}
                                              </div>
                                            )}
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Statistics Grid */}
                              <div className={`grid grid-cols-6 gap-1 px-1 py-2.5 rounded-2xl mb-3.5 w-full overflow-hidden border ${
                                mounted && isDark ? 'bg-[#0f1a34] border-[#4a3f74]' : 'bg-gray-50 border-gray-200'
                              }`}>
                                {/* DvP */}
                                <div className="relative flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={(() => {
                                  if (prop.dvpRating === null || prop.dvpRating === undefined) {
                                    return { background: mounted && isDark ? '#1a2140' : '#f9fafb', borderColor: mounted && isDark ? '#4d4a73' : '#e5e7eb' };
                                  }
                                  let bgColor = mounted && isDark ? '#1a2140' : '#f9fafb';
                                  let borderColor = mounted && isDark ? '#4d4a73' : '#e5e7eb';
                                  let glowColor: string | null = null;
                                  const { easyMin, hardMax } = dvpColorBands(rowSport, prop.dvpFieldSize);
                                  if (prop.dvpRating >= easyMin) {
                                    bgColor = '#22c55e';
                                    borderColor = '#22c55e';
                                    glowColor = '#22c55e';
                                  } else if (prop.dvpRating > hardMax) {
                                    bgColor = '#f59e0b';
                                    borderColor = '#f59e0b';
                                    glowColor = '#f59e0b';
                                  } else {
                                    bgColor = '#ef4444';
                                    borderColor = '#ef4444';
                                    glowColor = '#ef4444';
                                  }
                            return {
                              background: bgColor !== (mounted && isDark ? '#1a2140' : '#f9fafb')
                                ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)`
                                : bgColor,
                              borderColor: borderColor,
                              borderWidth: '2px',
                              boxShadow: glowColor ? `0 0 12px ${glowColor}75, 0 0 6px ${glowColor}55` : 'none',
                            };
                                })()}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>DvP</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {prop.dvpRating !== null && prop.dvpRating !== undefined ? dvpRankText(rowSport, prop.dvpRating, prop.dvpFieldSize) : 'N/A'}
                                  </div>
                                  {isTennisPropsSport(rowSport) && isTennisMoneylineStat(prop.statType) ? (
                                    <span className={`text-[8px] leading-none font-medium mt-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                      Seed
                                    </span>
                                  ) : null}
                                </div>
                                {/* L5 */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.last5HitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>L5</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.last5HitRate || prop.last5HitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
                                    {getHitRatePercent(prop.last5HitRate)}
                                  </div>
                                </div>
                                
                                {/* L10 */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.last10HitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>L10</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.last10HitRate || prop.last10HitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
                                    {getHitRatePercent(prop.last10HitRate)}
                                  </div>
                                </div>
                                
                                {showH2hColumn && (
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.h2hHitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>H2H</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.h2hHitRate || prop.h2hHitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
                                    {getHitRatePercent(prop.h2hHitRate)}
                                  </div>
                                </div>
                                )}
                                
                                {/* STRK */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(null, true)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>STRK</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {prop.streak ?? 'N/A'}
                                  </div>
                                </div>
                                
                                {/* SZN */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.seasonHitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>SZN</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.seasonHitRate || prop.seasonHitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
                                    {getHitRatePercent(prop.seasonHitRate)}
                                  </div>
                                </div>
                                
                              </div>
                              
                              {/* Bookmaker Odds Section - Horizontally Scrollable */}
                              {(() => {
                                const paintLines = isTennisPropsSport(rowSport)
                                  ? tennisDisplayBookmakerLines(prop)
                                  : (prop.bookmakerLines || []);
                                if (!paintLines.length) return null;
                                const linesByValue = new Map<number, typeof paintLines>();
                                paintLines.forEach(line => {
                                  const lineValue = line.line;
                                  if (!linesByValue.has(lineValue)) {
                                    linesByValue.set(lineValue, []);
                                  }
                                  // Filter by selected bookmakers
                                  let filteredLines = [line];
                                  if (!isCombinedMode && selectedBookmakers.size > 0) {
                                    filteredLines = [line].filter(l => l.bookmaker && selectedBookmakers.has(l.bookmaker));
                                  }
                                  if (filteredLines.length > 0) {
                                    linesByValue.get(lineValue)!.push(...filteredLines);
                                  }
                                });
                                
                                // Sort by number of bookmakers (descending) - favor lines with more bookmakers
                                const sortedLines = Array.from(linesByValue.entries()).sort((a, b) => {
                                  return b[1].length - a[1].length; // More bookmakers first
                                });
                                
                                // Mobile: Show first 2 bookmakers + "+ X" button
                                const allBookmakers = Array.from(linesByValue.values()).flat();
                                const firstTwoBookmakers = allBookmakers.slice(0, 2);
                                const remainingCount = allBookmakers.length - 2;
                                const expandKey = `${prop.playerName}|${prop.statType}|mobile-all`;
                                const isPopupOpen = openPopup === expandKey;
                                
                                return (
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex flex-col gap-2 min-w-0">
                                      {/* First 2 bookmakers */}
                                      {firstTwoBookmakers.map((bookmaker, idx) => {
                                        const bookmakerInfo = getBookmakerInfo(bookmaker.bookmaker || '');
                                        return (
                                          <div
                                            key={idx}
                                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border flex-shrink-0 ${
                                              mounted && isDark ? 'bg-[#081427] border-[#22324d]' : 'bg-gray-100 border-gray-300'
                                            }`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              
                                              if (navigatingRef.current) return;
                                              navigatingRef.current = true;
                                              setNavigatingToPlayer(true);
                                              /* soccer navigation removed */
                                              setTimeout(() => {
                                                navigatingRef.current = false;
                                                setNavigatingToPlayer(false);
                                              }, 1500);
                                            }}
                                          >
                                            {bookmakerInfo?.logoUrl && (
                                              <img
                                                src={bookmakerInfo.logoUrl}
                                                alt={bookmakerInfo.name}
                                                className="object-contain rounded flex-shrink-0"
                                                style={{ width: '22px', height: '22px' }}
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            )}
                                            <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
                                              <span className={`font-bold ${mounted && isDark ? 'text-green-400' : 'text-green-600'}`} style={{ fontSize: '12px' }}>
                                                O {formatOddsValue(bookmaker.overOdds)}
                                              </span>
                                              {propsRowShowsUnderOdds(rowSport, bookmaker.underOdds) && (
                                                <>
                                                  <span className={mounted && isDark ? 'text-gray-500' : 'text-gray-400'} style={{ fontSize: '11px' }}>|</span>
                                                  <span className={`font-bold ${mounted && isDark ? 'text-red-400' : 'text-red-600'}`} style={{ fontSize: '12px' }}>
                                                    U {formatOddsValue(bookmaker.underOdds)}
                                                  </span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                      
                                      {/* "+ X" button if there are more bookmakers */}
                                      {remainingCount > 0 && (
                                        <div className="relative">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenPopup(openPopup === expandKey ? null : expandKey);
                                            }}
                                            className={`flex items-center justify-center px-2 py-1.5 rounded-lg border flex-shrink-0 relative ${
                                              mounted && isDark ? 'bg-[#081427] border-[#22324d] hover:bg-[#10233a]' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                                            }`}
                                            style={{ minWidth: '36px' }}
                                          >
                                            <span className={`text-xs font-bold ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>
                                              +{remainingCount}
                                            </span>
                                          </button>
                                          
                                          {/* Popup modal for all bookmakers - Mobile */}
                                          {isPopupOpen && (
                                            <>
                                              {/* Backdrop - click to close */}
                                              <div
                                                className="fixed inset-0 z-[100]"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setOpenPopup(null);
                                                }}
                                              />
                                              {/* Popup content - centered on mobile */}
                                              <div
                                                className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] rounded-2xl border shadow-2xl p-4 w-[90vw] max-w-md ${
                                                  mounted && isDark
                                                    ? 'bg-[#0b1a2b] border-[#22324d]'
                                                    : 'bg-white border-gray-300'
                                                }`}
                                                style={{
                                                  maxHeight: '70vh',
                                                  overflowY: 'auto'
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                {/* Close button */}
                                                <div className="flex justify-between items-center mb-3">
                                                  <span className={`text-sm font-medium ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                                    {allBookmakers.length} bookmakers
                                                  </span>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setOpenPopup(null);
                                                    }}
                                                    className={`${mounted && isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'} transition-colors p-1`}
                                                    aria-label="Close"
                                                  >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                  </button>
                                                </div>
                                                
                                                {/* All bookmakers list */}
                                                <div className="space-y-2">
                                                  {allBookmakers.map((line, idx) => {
                                                    const bookmakerInfo = getBookmakerInfo(line.bookmaker || '');
                                                    return (
                                                      <div
                                                        key={idx}
                                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                                                          mounted && isDark ? 'bg-[#0a1929] border-gray-800' : 'bg-gray-50 border-gray-200'
                                                        }`}
                                                      >
                                                        {bookmakerInfo?.logoUrl && (
                                                          <img
                                                            src={bookmakerInfo.logoUrl}
                                                            alt={bookmakerInfo.name}
                                                            className="w-8 h-8 object-contain rounded flex-shrink-0"
                                                            onError={(e) => {
                                                              (e.target as HTMLImageElement).style.display = 'none';
                                                            }}
                                                          />
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                          <div className={`text-sm font-semibold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                                            {bookmakerInfo?.name || line.bookmaker}
                                                          </div>
                                                          <div className="flex items-center gap-3 mt-1">
                                                            <span className={`text-xs font-bold ${mounted && isDark ? 'text-green-400' : 'text-green-600'}`}>
                                                              O {formatOddsValue(line.overOdds)}
                                                            </span>
                                                            {propsRowShowsUnderOdds(rowSport, line.underOdds) && (
                                                              <span className={`text-xs font-bold ${mounted && isDark ? 'text-red-400' : 'text-red-600'}`}>
                                                                U {formatOddsValue(line.underOdds)}
                                                              </span>
                                                            )}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {/* Tipoff Countdown - Next to bookmakers on the right */}
                                    <div className="flex items-start justify-center flex-shrink-0 pr-1 pt-0.5">
                                      <TipoffCountdown game={game} isDark={mounted && isDark} label={rowSportKickoffLabel(rowSport)} maxAheadMs={kickoffMaxAheadMs(rowSport)} />
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Tipoff Countdown - Show if no bookmakers */}
                              {((isTennisPropsSport(rowSport)
                                ? tennisDisplayBookmakerLines(prop)
                                : (prop.bookmakerLines || [])
                              ).length === 0) && (
                                <div className="flex items-center justify-start pr-1">
                                  <TipoffCountdown game={game} isDark={mounted && isDark} label={rowSportKickoffLabel(rowSport)} maxAheadMs={kickoffMaxAheadMs(rowSport)} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Pagination controls - Shared for desktop and mobile */}
                      <div className="flex items-center justify-between mt-6 px-2 pb-24 sm:pb-4">
                        <div className={`text-sm ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {isSecondaryListMode
                            ? `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1} - ${Math.min(currentPage * ITEMS_PER_PAGE, displaySortedAflProps.length)} of ${displaySortedAflProps.length}`
                            : propsSport === 'combined'
                              ? `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1} - ${Math.min(currentPage * ITEMS_PER_PAGE, displaySortedCombinedProps.length)} of ${displaySortedCombinedProps.length}`
                              : `Showing ${(currentPageSafe - 1) * pageSize + 1} - ${Math.min(currentPageSafe * pageSize, displaySortedProps.length)} of ${totalPropsCount}`}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCurrentPage(Math.max(1, activeCurrentPage - 1))}
                            disabled={activeCurrentPage === 1}
                            className={`px-3 py-1 rounded border text-sm ${
                              (activeCurrentPage === 1)
                                ? mounted && isDark ? 'text-gray-500 border-gray-700 cursor-not-allowed' : 'text-gray-400 border-gray-200 cursor-not-allowed'
                                : mounted && isDark ? 'text-gray-200 border-gray-600 hover:bg-gray-700' : 'text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Prev
                          </button>
                          <span className={`text-sm ${mounted && isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                            Page {activeCurrentPage} / {activeTotalPages}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCurrentPage(Math.min(activeTotalPages, activeCurrentPage + 1))}
                            disabled={activeCurrentPage === activeTotalPages}
                            className={`px-3 py-1 rounded border text-sm ${
                              (activeCurrentPage === activeTotalPages)
                                ? mounted && isDark ? 'text-gray-500 border-gray-700 cursor-not-allowed' : 'text-gray-400 border-gray-200 cursor-not-allowed'
                                : mounted && isDark ? 'text-gray-200 border-gray-600 hover:bg-gray-700' : 'text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  
                  {/* Mobile Games Section - Hidden */}
                  <div className="hidden mt-6">
                    <h3 className={`text-xl font-bold mb-3 ${
                      mounted && isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      Today's Games
                    </h3>
                    {gamesLoading ? (
                      <div className="text-center py-8">
                        <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          Loading games...
                        </div>
                      </div>
                    ) : todaysGames.length === 0 ? (
                      <div className="text-center py-8">
                        <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          No games scheduled for today
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {todaysGames.map((game) => {
                          const homeTeam = game.home_team?.abbreviation || 'TBD';
                          const awayTeam = game.visitor_team?.abbreviation || 'TBD';
                          const isFinal = game.status?.toLowerCase().includes('final');
                          const homeScore = game.home_team_score;
                          const awayScore = game.visitor_team_score;
                          
                          return (
                            <div
                              key={game.id}
                              className={`p-3 rounded-lg border ${
                                mounted && isDark
                                  ? 'bg-gray-700 border-gray-600'
                                  : 'bg-gray-50 border-gray-200'
                              }`}
                            >
                              <div className="text-center mb-2">
                                <div className={`text-xs ${
                                  mounted && isDark ? 'text-gray-400' : 'text-gray-500'
                                }`}>
                                  {formatTime(game.date)}
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className={`text-sm font-medium ${
                                    mounted && isDark ? 'text-white' : 'text-gray-900'
                                  }`}>
                                    {awayTeam}
                                  </span>
                                  {isFinal && awayScore !== undefined && (
                                    <span className={`text-sm font-bold ${
                                      mounted && isDark ? 'text-white' : 'text-gray-900'
                                    }`}>
                                      {awayScore}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className={`text-sm font-medium ${
                                    mounted && isDark ? 'text-white' : 'text-gray-900'
                                  }`}>
                                    {homeTeam}
                                  </span>
                                  {isFinal && homeScore !== undefined && (
                                    <span className={`text-sm font-bold ${
                                      mounted && isDark ? 'text-white' : 'text-gray-900'
                                    }`}>
                                      {homeScore}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {!isFinal && (
                                <div className="mt-2 text-center">
                                  <button
                                    onClick={() => {
                                      snapshotPropsPageBeforeLeave();
                                      router.push(`/nba/research/dashboard?team=${homeTeam}`);
                                    }}
                                    className={`text-xs px-3 py-1 rounded ${
                                      mounted && isDark
                                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                        : 'bg-purple-100 hover:bg-purple-200 text-purple-700'
                                    } transition-colors`}
                                  >
                                    View Props
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Find player (not in props / no odds): bottom-right mobile, top-right desktop */}
      {propsSport !== 'combined' && (
      <button
        type="button"
        onClick={() => {
          setFindPlayerOpen(true);
          setFindPlayerQuery('');
          setFindPlayerResults([]);
        }}
        className={`fixed z-[70] right-4 bottom-20 lg:bottom-auto lg:top-4 flex items-center justify-center w-12 h-12 rounded-full shadow-lg border transition-transform hover:scale-105 active:scale-95 ${
          mounted && isDark
            ? 'bg-[#0a1929] border-gray-600 text-purple-400 hover:bg-gray-800'
            : 'bg-white border-gray-200 text-purple-600 hover:bg-gray-50'
        }`}
        aria-label="Search players who may not have odds"
        title="Find player (may not have odds)"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
      )}

      {nblAnnouncementOpen && !surveyOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-3xl border shadow-2xl ${
              mounted && isDark ? 'bg-[#081525]/95 border-slate-700/80' : 'bg-white/95 border-gray-200'
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="props-nbl-announcement-title"
          >
            <div className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${
                    mounted && isDark ? 'border-slate-700 bg-slate-900/80' : 'border-gray-200 bg-gray-50'
                  }`}>
                    <StatTrackrLogo className="w-8 h-8" />
                  </div>
                  <div>
                    <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
                      mounted && isDark ? 'text-purple-300/80' : 'text-purple-600'
                    }`}>
                      Coming Next
                    </div>
                    <h2
                      id="props-nbl-announcement-title"
                      className={`mt-1 text-[28px] leading-none font-semibold ${
                        mounted && isDark ? 'text-white' : 'text-gray-900'
                      }`}
                    >
                      NBL is next
                    </h2>
                  </div>
                </div>
              </div>

              <p className={`mt-4 text-sm sm:text-[15px] leading-6 ${mounted && isDark ? 'text-slate-300' : 'text-gray-600'}`}>
                We&apos;re going to build the next sport properly, just like AFL and NBA.
              </p>
              <p className={`mt-3 text-sm sm:text-[15px] leading-6 ${mounted && isDark ? 'text-slate-300' : 'text-gray-600'}`}>
                Next up: <span className={`font-semibold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>NBL</span>. Same quality bar you already get on AFL and NBA.
              </p>

              <button
                type="button"
                onClick={dismissNblAnnouncement}
                className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-purple-600 to-violet-500 px-4 py-3.5 text-sm font-semibold text-white transition hover:from-purple-500 hover:to-violet-400"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {surveyOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-3xl border shadow-2xl ${
              mounted && isDark ? 'bg-[#081525]/95 border-slate-700/80' : 'bg-white/95 border-gray-200'
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="props-next-sport-survey-title"
          >
            <div className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${
                    mounted && isDark ? 'border-slate-700 bg-slate-900/80' : 'border-gray-200 bg-gray-50'
                  }`}>
                    <StatTrackrLogo className="w-8 h-8" />
                  </div>
                  <div>
                    <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
                      mounted && isDark ? 'text-purple-300/80' : 'text-purple-600'
                    }`}>
                      Quick Poll
                    </div>
                    <h2
                      id="props-next-sport-survey-title"
                      className={`mt-1 text-[28px] leading-none font-semibold ${
                        mounted && isDark ? 'text-white' : 'text-gray-900'
                      }`}
                    >
                      We Want Your Say
                    </h2>
                  </div>
                </div>
              </div>

              <p className={`mt-4 text-sm sm:text-[15px] leading-6 ${mounted && isDark ? 'text-slate-300' : 'text-gray-600'}`}>
                What sport do you want to see on stattrackr next?
              </p>
              {surveyEndsAtLabel && (
                <p className={`mt-2 text-xs sm:text-[13px] ${mounted && isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                  Survey closes in 36 hours on {surveyEndsAtLabel}.
                </p>
              )}

              <div className="mt-5 grid grid-cols-1 gap-2.5">
                {NEXT_SPORT_SURVEY_OPTIONS.map((option) => {
                  const isSelected = selectedSurveySport === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setSelectedSurveySport(option);
                        setSurveyError(null);
                      }}
                      className={`group w-full rounded-2xl border px-4 py-3.5 text-left text-sm font-medium transition-all ${
                        isSelected
                          ? mounted && isDark
                            ? 'border-purple-400/80 bg-purple-500/12 text-white shadow-[0_0_0_1px_rgba(168,85,247,0.18)]'
                            : 'border-purple-400 bg-purple-50 text-gray-900 shadow-[0_0_0_1px_rgba(168,85,247,0.12)]'
                          : mounted && isDark
                            ? 'border-slate-700 bg-slate-900/55 text-slate-200 hover:border-slate-500 hover:bg-slate-900/80'
                            : 'border-gray-200 bg-gray-50/90 text-gray-800 hover:border-purple-200 hover:bg-white'
                      }`}
                      aria-pressed={isSelected}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span>{option}</span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                            isSelected
                              ? 'border-purple-400 bg-purple-500 text-white'
                              : mounted && isDark
                                ? 'border-slate-500 text-transparent group-hover:border-slate-400'
                                : 'border-gray-300 text-transparent group-hover:border-purple-300'
                          }`}
                          aria-hidden="true"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.2 7.2a1 1 0 01-1.415 0l-3.2-3.2a1 1 0 111.414-1.42l2.493 2.494 6.493-6.494a1 1 0 011.415 0z" clipRule="evenodd" />
                          </svg>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {surveyError && (
                <p className="mt-4 text-sm text-red-500">
                  {surveyError}
                </p>
              )}

              <button
                type="button"
                onClick={handleNextSportSurveySubmit}
                disabled={!selectedSurveySport || surveySubmitting}
                className={`mt-5 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3.5 text-sm font-semibold transition ${
                  !selectedSurveySport || surveySubmitting
                    ? 'cursor-not-allowed bg-slate-400/60 text-white'
                    : 'bg-gradient-to-r from-purple-600 to-violet-500 text-white hover:from-purple-500 hover:to-violet-400'
                }`}
              >
                {surveySubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Find player modal */}
      {findPlayerOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setFindPlayerOpen(false)}
          role="presentation"
        >
          <div
            className={`w-full max-w-md max-h-[85vh] flex flex-col rounded-xl border shadow-xl ${
              mounted && isDark ? 'bg-[#0a1929] border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="find-player-title"
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 id="find-player-title" className={`text-lg font-semibold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                Find player
              </h2>
              <button
                type="button"
                onClick={() => setFindPlayerOpen(false)}
                className={`rounded p-1.5 transition-colors ${mounted && isDark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100'}`}
                aria-label="Close"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <p className={`text-sm mb-3 ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                Search for players who may not appear or don&apos;t have odds on this page.
              </p>
              <input
                type="text"
                value={findPlayerQuery}
                onChange={(e) => setFindPlayerQuery(e.target.value)}
                placeholder={
                  propsSport === 'afl'
                      ? 'Search AFL players...'
                      : propsSport === 'nbl'
                        ? 'Search NBL players...'
                      : isTennisPropsSport(propsSport)
                        ? `Search ${propsSport === 'wta' ? 'WTA' : 'ATP'} players...`
                      : propsSport === 'combined'
                        ? TENNIS_PUBLIC_ENABLED
                          ? 'Search NBA, AFL, NBL, ATP or WTA players...'
                          : 'Search NBA, AFL or NBL players...'
                        : 'Search NBA players...'
                }
                className={`w-full px-4 py-2.5 rounded-lg border text-sm ${
                  mounted && isDark
                    ? 'bg-[#10243e] border-gray-600 text-white placeholder-gray-500'
                    : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
                }`}
                autoFocus
                autoComplete="off"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              {findPlayerLoading && (
                <p className={`text-sm py-4 ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>Searching...</p>
              )}
              {!findPlayerLoading && findPlayerQuery.trim().length < 2 && (
                <p className={`text-sm py-4 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Type at least 2 characters to search.
                </p>
              )}
              {!findPlayerLoading && findPlayerQuery.trim().length >= 2 && findPlayerResults.length === 0 && (
                <p className={`text-sm py-4 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>No players found.</p>
              )}
              {!findPlayerLoading && findPlayerResults.length > 0 && (
                <ul className="space-y-1">
                  {findPlayerResults.map((player, idx) => {
                    const tennisTour = propsSportFromTennisTour(player.team);
                    const findSport: 'nba' | 'afl' | 'nbl' | 'atp' | 'wta' =
                      isTennisPropsSport(propsSport) || tennisTour
                        ? tennisTour || (propsSport === 'wta' ? 'wta' : 'atp')
                        : propsSport === 'afl'
                          ? 'afl'
                          : propsSport === 'nbl'
                            ? 'nbl'
                          : 'nba';
                    const findHref = propsDashboardHref({
                      sport: findSport,
                      playerName: player.name,
                      playerId: player.playerId,
                      team: player.team,
                    });
                    return (
                    <li key={`${player.name}-${player.team ?? ''}-${idx}`}>
                      <a
                        href={findHref}
                        onClick={(e) => {
                          if (!isUnmodifiedLeftClick(e)) return;
                          e.preventDefault();
                          setFindPlayerOpen(false);
                          if (isTennisPropsSport(propsSport) || propsSportFromTennisTour(player.team)) {
                            prefetchTennisDashboardFromProps({
                              playerName: player.name,
                              playerId: player.playerId,
                              tour: player.team,
                            });
                            snapshotPropsPageBeforeLeave();
                            router.push(findHref);
                          } else if (propsSport === 'nbl') {
                            snapshotPropsPageBeforeLeave();
                            router.push(findHref);
                          } else if (propsSport === 'afl') {
                            const team = player.team ?? '';
                            prefetchAflDashboardFromProps({
                              playerName: player.name,
                              team,
                            });
                            if (team) {
                              fetch(`/api/afl/next-game?team=${encodeURIComponent(team)}&season=2026`)
                                .then((r) => r.json())
                                .then((d) => {
                                  try {
                                    sessionStorage.setItem('afl_next_game_prefetch', JSON.stringify({
                                      team,
                                      next_opponent: d?.next_opponent ?? null,
                                      next_game_tipoff: d?.next_game_tipoff ?? null,
                                      fetchedAt: Date.now(),
                                    }));
                                  } catch {}
                                })
                                .catch(() => {});
                            }
                            snapshotPropsPageBeforeLeave();
                            router.push(findHref);
                          } else {
                            try {
                              sessionStorage.removeItem('nba_dashboard_session_v1');
                              sessionStorage.setItem('from_props_page', 'true');
                            } catch {}
                            snapshotPropsPageBeforeLeave();
                            router.push(findHref);
                          }
                        }}
                        className={`block w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors ${
                          mounted && isDark
                            ? 'text-gray-200 hover:bg-gray-800'
                            : 'text-gray-800 hover:bg-gray-100'
                        }`}
                      >
                        <span className="font-medium">{player.name}</span>
                        {player.team && (
                          <span className={mounted && isDark ? 'text-gray-500 ml-2' : 'text-gray-400 ml-2'}>{player.team}</span>
                        )}
                      </a>
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation - Only visible on mobile */}
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
        setOddsFormat={(fmt) => {
          setOddsFormat(fmt);
          try {
            localStorage.setItem('oddsFormat', fmt);
          } catch {
            // ignore
          }
        }}
      />

    </div>
  );
}

// Helper function to parse American odds string to number
function parseAmericanOdds(oddsStr: string): number | null {
  if (!oddsStr || oddsStr === 'N/A') return null;
  
  // Remove any non-numeric characters except + and -
  const cleaned = oddsStr.replace(/[^0-9.+-]/g, '');
  const parsed = parseFloat(cleaned);
  
  if (isNaN(parsed)) return null;
  return parsed;
}

// Helper function to convert American odds to implied probability
function americanToImpliedProb(american: number): number {
  if (american > 0) {
    return (100 / (american + 100)) * 100;
  } else {
    return (Math.abs(american) / (Math.abs(american) + 100)) * 100;
  }
}

