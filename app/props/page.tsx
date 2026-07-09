'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { MobileBottomNavigation } from "@/app/nba/research/dashboard/components/header";
import { useTheme } from "@/contexts/ThemeContext";
import { useRouter } from 'next/navigation';
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, startTransition } from 'react';
import { createPortal, preload as reactPreload } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import { useViewerProfile } from '@/hooks/useViewerProfile';
import {
  bindPropsPageSnapshotGetter,
  clearPropsPageWarmSnapshot,
  snapshotPropsPageBeforeLeave,
  takePropsBackNavWarmSnapshot,
} from '@/lib/propsPageSessionCache';
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
import { getFullTeamName, TEAM_FULL_TO_ABBR } from '@/lib/teamMapping';
import { getPlayerHeadshotUrl } from '@/lib/nbaLogos';
import { getAflPlayerHeadshotUrl } from '@/lib/aflPlayerHeadshots';
import { formatAflFantasyDfsPositionLabel } from '@/lib/aflDfsRoleLabels';
import {
  buildWorldCupPlayerDashboardParams,
  prefetchWorldCupDashboard,
  prefetchWorldCupPlayerFromProp,
  worldCupPlayerNameToSlug,
  writeWorldCupPlayerOddsPrefetch,
  fetchWorldCupDashboardJson,
} from '@/lib/worldCupPlayerAliases';
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
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import { StatTrackrLogo } from '@/components/StatTrackrLogo';
import Image from 'next/image';
import {
  defaultPropsSport,
  isSecondaryPropsSport,
  NBA_PUBLIC_ENABLED,
  propsPathForSport,
  resolvePropsSportParam,
  WC_BACK_TO_PROPS_CLEAR_SEARCH_KEY,
  WC_BACK_TO_PROPS_SKIP_FETCH_KEY,
  WC_PROPS_RETURN_SPORT_KEY,
  clearWorldCupDashboardPersistence,
  WORLD_CUP_LOGO_PATH,
  WORLD_CUP_LOGO_MARK_CLASS,
  WORLD_CUP_LOGO_MARK_COMPACT_CLASS,
  WORLD_CUP_LOGO_TOGGLE_CLASS,
  WORLD_CUP_PUBLIC_ENABLED,
  type PropsSportMode,
} from '@/lib/nbaConstants';
import { resolveWorldCupFlagCode, resolveBestWorldCupFlagUrl, worldCupTeamsMatch } from '@/lib/worldCupFlags';

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
  wcTeamId?: string | null;
  wcOpponentTeamId?: string | null;
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
  wcGamesAvg?: number | null;
  wcGamesHitRate?: { hits: number; total: number } | null;
  wcGameLog?: Array<{ opponent: string; value: number; date?: string }>;
  position?: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null; // Player position (used for DvP calculation)
  dvpRating?: number | null;
  dvpStatValue?: number | null;
  headshotUrl?: string | null;
  wcPosition?: string | null;
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
}

function normalizeWorldCupStatForDashboard(stat: string): string {
  const value = String(stat || '').trim().toLowerCase();
  if (!value) return 'goals';
  if (value === 'anytime_goal_scorer' || value === 'anytime_goals' || value === 'goals_anytime') return 'goals';
  if (value === 'goals' || value === 'goals_over') return 'goals';
  if (value === 'assists' || value === 'assists_over') return 'assists';
  if (value === 'shots_on_target' || value === 'sot' || value === 'shots_on_target_over') return 'shots_on_target';
  if (value === 'total_shots' || value === 'shots' || value === 'shots_total' || value === 'shots_over') return 'total_shots';
  if (value === 'fouls_committed' || value === 'fouls') return 'fouls_committed';
  if (value === 'yellow_cards' || value === 'to_be_booked' || value === 'cards') return 'yellow_cards';
  return value;
}

function navigateToWorldCupDashboardFromProp(
  prop: Pick<
    PlayerProp,
    | 'playerName'
    | 'playerId'
    | 'team'
    | 'opponent'
    | 'wcTeamId'
    | 'wcOpponentTeamId'
    | 'statType'
    | 'line'
    | 'bookmaker'
    | 'gameDate'
    | 'wcPosition'
  >,
  router: { push: (href: string) => void },
  lineValue?: number,
  returnSport: PropsSportMode = 'world-cup'
): void {
  const team = String(prop.team || '').trim();
  const opponent = String(prop.opponent || '').trim();
  const playerId = String(prop.playerId || '').trim();
  const teamId = String(prop.wcTeamId || '').trim();
  const opponentTeamId = String(prop.wcOpponentTeamId || '').trim();
  const matchDate = String(prop.gameDate || '').trim();
  const selectedLine =
    typeof lineValue === 'number' && Number.isFinite(lineValue)
      ? lineValue
      : Number.isFinite(prop.line)
        ? prop.line
        : null;
  const selectedBook = String(prop.bookmaker || '').trim();

  try {
    clearWorldCupDashboardPersistence();
    sessionStorage.setItem(WC_PROPS_RETURN_SPORT_KEY, returnSport);
    sessionStorage.setItem(
      'wc_player_from_props',
      JSON.stringify({
        name: prop.playerName,
        playerId: /^\d+$/.test(playerId) ? playerId : undefined,
        team: team || undefined,
        teamId: /^\d+$/.test(teamId) ? teamId : undefined,
        opponent: opponent || undefined,
        opponentTeamId: /^\d+$/.test(opponentTeamId) ? opponentTeamId : undefined,
        stat: normalizeWorldCupStatForDashboard(prop.statType),
        line: selectedLine,
        bookmaker: selectedBook || undefined,
        matchDate: matchDate || undefined,
        position: prop.wcPosition || undefined,
        fetchedAt: Date.now(),
      })
    );
  } catch {
    // ignore
  }

  const q = new URLSearchParams();
  if (/^\d+$/.test(playerId)) q.set('playerId', playerId);
  if (team) q.set('team', team);
  if (/^\d+$/.test(teamId)) q.set('teamId', teamId);
  if (opponent) q.set('opponent', opponent);
  if (/^\d+$/.test(opponentTeamId)) q.set('opponentTeamId', opponentTeamId);
  q.set('stat', normalizeWorldCupStatForDashboard(prop.statType));
  if (selectedLine != null) q.set('line', String(selectedLine));
  if (selectedBook) q.set('bookmaker', selectedBook);
  if (matchDate) q.set('matchDate', matchDate);
  if (prop.wcPosition) q.set('position', prop.wcPosition);

  prefetchWorldCupPlayerFromProp({
    playerName: prop.playerName,
    playerId: /^\d+$/.test(playerId) ? playerId : null,
    teamId: /^\d+$/.test(teamId) ? teamId : null,
    teamName: team || null,
    opponentTeamId: /^\d+$/.test(opponentTeamId) ? opponentTeamId : null,
    opponentTeamName: opponent || null,
    matchDate: matchDate || null,
  });
  prefetchWorldCupDashboard('/api/world-cup/dashboard?oppBreakdown=1&wcOnly=1');

  const oddsUrl = `/api/world-cup/dashboard?playerOdds=1&playerName=${encodeURIComponent(prop.playerName)}&homeTeam=${encodeURIComponent(team)}&awayTeam=${encodeURIComponent(opponent)}${matchDate ? `&matchDate=${encodeURIComponent(matchDate)}` : ''}`;
  void fetchWorldCupDashboardJson(oddsUrl)
    .then((data) => {
      const books = Array.isArray((data as { books?: unknown[] } | null)?.books)
        ? (data as { books: unknown[] }).books
        : [];
      if (!books.length) return;
      writeWorldCupPlayerOddsPrefetch({
        playerName: prop.playerName,
        team: team || undefined,
        opponent: opponent || undefined,
        matchDate: matchDate || undefined,
        books,
      });
    })
    .catch(() => {});

  const slug = worldCupPlayerNameToSlug(prop.playerName);
  const query = q.toString();
  const href = slug
    ? `/world-cup/player/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`
    : `/world-cup?mode=player&player=${encodeURIComponent(prop.playerName)}${query ? `&${query}` : ''}`;
  snapshotPropsPageBeforeLeave();
  router.push(href);
}

function secondarySportKickoffLabel(sport: PropsSportMode): string {
  if (sport === 'afl') return 'Bounce';
  if (sport === 'world-cup') return 'Kick-off';
  return 'Tipoff';
}

function rowSportKickoffLabel(rowSport: 'nba' | 'afl' | 'world-cup'): string {
  if (rowSport === 'afl') return 'Bounce';
  if (rowSport === 'world-cup') return 'Kick-off';
  return 'Tipoff';
}

function propsListRowKey(
  prop: PlayerProp,
  rowSport: 'nba' | 'afl' | 'world-cup'
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
}

type CombinedSportSource = 'nba' | 'afl' | 'world-cup';
type CombinedPlayerPropRow = PlayerProp & { sportSource?: CombinedSportSource };

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
  worldCup?: {
    ok: boolean;
    status: number;
    lastUpdated?: string | null;
    nextUpdate?: string | null;
    ingestMessage?: string | null;
    noWorldCupOdds?: boolean;
    games?: AflGameForProps[];
    props?: PlayerProp[];
  };
};

// Tipoff Countdown Component
function TipoffCountdown({
  game,
  isDark,
  label = 'Tipoff',
}: {
  game: Game | null;
  isDark: boolean;
  label?: string;
}) {
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  const [isBeyond24h, setIsBeyond24h] = useState(false);
  const liveWindowMs = 3 * 60 * 60 * 1000;

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
        gameDateTime.getTime() < now + (7 * 24 * 60 * 60 * 1000)
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
          parsedStatus.getTime() < now + (7 * 24 * 60 * 60 * 1000)
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
  }, [game]);

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
  isDark,
  compact = false,
}: {
  sport: 'nba' | 'afl' | 'world-cup';
  isDark: boolean;
  compact?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const isAfl = sport === 'afl';
  const isWorldCup = sport === 'world-cup';
  const imgClass = isWorldCup
    ? (compact ? WORLD_CUP_LOGO_MARK_COMPACT_CLASS : WORLD_CUP_LOGO_MARK_CLASS)
    : (compact ? 'w-6 h-6 object-contain' : 'w-8 h-8 object-contain');
  const fallbackClass = compact
    ? `inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold border ${
        isAfl
          ? isDark
            ? 'bg-orange-900/40 text-orange-200 border-orange-700'
            : 'bg-orange-100 text-orange-700 border-orange-300'
          : isDark
            ? 'bg-blue-900/40 text-blue-200 border-blue-700'
            : 'bg-blue-100 text-blue-700 border-blue-300'
      }`
    : `inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border ${
        isAfl
          ? isDark
            ? 'bg-orange-900/40 text-orange-200 border-orange-700'
            : 'bg-orange-100 text-orange-700 border-orange-300'
          : isDark
            ? 'bg-blue-900/40 text-blue-200 border-blue-700'
            : 'bg-blue-100 text-blue-700 border-blue-300'
      }`;
  const src = isAfl ? '/images/afl-logo.png' : isWorldCup ? WORLD_CUP_LOGO_PATH : '/images/nba-logo.png';
  const label = isAfl ? 'AFL' : isWorldCup ? 'World Cup' : 'NBA';

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

type WcPropsMatchup = {
  homeName: string;
  awayName: string;
  homeFlagUrl: string | null;
  awayFlagUrl: string | null;
};

function wcResolveTeamFlag(opts: {
  teamName: string;
  teamCode?: string | null;
  teamLogo?: string | null;
}): string | null {
  const name = String(opts.teamName ?? '').trim();
  if (!name) return null;
  const code = opts.teamCode ?? resolveWorldCupFlagCode(name);
  const fromMap = resolveBestWorldCupFlagUrl(name, code);
  if (fromMap) return fromMap;
  const logo = String(opts.teamLogo ?? '').trim();
  return logo || null;
}

function lookupWcGameTeamMeta(
  games: AflGameForProps[],
  gameId: string | undefined,
  teamName: string,
  prop?: PlayerProp
): { code: string | null; logo: string | null } {
  const name = String(teamName ?? '').trim();
  if (!name) return { code: null, logo: null };

  const teamSlug = resolveWorldCupFlagCode(name);
  const game = gameId ? games.find((g) => g.gameId === gameId) ?? null : null;
  const sides = game
    ? [
        { name: game.homeTeam, code: game.homeTeamCode, logo: game.homeTeamLogo },
        { name: game.awayTeam, code: game.awayTeamCode, logo: game.awayTeamLogo },
      ]
    : prop
      ? [
          { name: prop.homeTeam ?? '', code: prop.homeTeamCode, logo: prop.homeTeamLogo },
          { name: prop.awayTeam ?? '', code: prop.awayTeamCode, logo: prop.awayTeamLogo },
        ]
      : [];

  for (const side of sides) {
    if (!String(side.name ?? '').trim()) continue;
    if (worldCupTeamsMatch(name, side.name)) {
      return {
        code: side.code ?? resolveWorldCupFlagCode(side.name) ?? teamSlug,
        logo: side.logo ?? null,
      };
    }
  }

  if (teamSlug) {
    for (const side of sides) {
      const sideSlug = resolveWorldCupFlagCode(side.code) ?? resolveWorldCupFlagCode(side.name);
      if (sideSlug && sideSlug === teamSlug) {
        return { code: side.code ?? teamSlug, logo: side.logo ?? null };
      }
    }
  }

  return { code: teamSlug, logo: null };
}

function wcTeamFlagUrl(
  teamName: string,
  opts?: { teamCode?: string | null; teamLogo?: string | null }
): string | null {
  return wcResolveTeamFlag({
    teamName,
    teamCode: opts?.teamCode,
    teamLogo: opts?.teamLogo,
  });
}

function wcTeamKeysMatch(a: string, b: string): boolean {
  return worldCupTeamsMatch(a, b);
}

function resolveWcPropsMatchup(prop: PlayerProp, games: AflGameForProps[]): WcPropsMatchup {
  const game = prop.gameId ? games.find((g) => g.gameId === prop.gameId) ?? null : null;
  const gameHome = String(game?.homeTeam ?? prop.homeTeam ?? '').trim();
  const gameAway = String(game?.awayTeam ?? prop.awayTeam ?? '').trim();
  const playerTeam = String(prop.team ?? gameHome).trim();
  const opponent =
    playerTeam && gameHome && wcTeamKeysMatch(playerTeam, gameHome)
      ? gameAway
      : playerTeam && gameAway && wcTeamKeysMatch(playerTeam, gameAway)
        ? gameHome
        : String(prop.opponent ?? (gameAway || gameHome)).trim();
  let homeD = playerTeam || gameHome;
  let awayD = opponent || gameAway;
  if (homeD && awayD && wcTeamKeysMatch(homeD, awayD)) awayD = '';
  const homeMeta = lookupWcGameTeamMeta(games, prop.gameId, homeD, prop);
  const awayMeta = lookupWcGameTeamMeta(games, prop.gameId, awayD, prop);
  return {
    homeName: homeD,
    awayName: awayD,
    homeFlagUrl: homeD ? wcTeamFlagUrl(homeD, { teamCode: homeMeta.code, teamLogo: homeMeta.logo }) : null,
    awayFlagUrl: awayD ? wcTeamFlagUrl(awayD, { teamCode: awayMeta.code, teamLogo: awayMeta.logo }) : null,
  };
}

function WcPropsMatchupLogos({
  prop,
  games,
  isDark,
  mounted,
  size = 'md',
}: {
  prop: PlayerProp;
  games: AflGameForProps[];
  isDark: boolean;
  mounted: boolean;
  size?: 'sm' | 'md';
}) {
  const { homeName, awayName, homeFlagUrl, awayFlagUrl } = resolveWcPropsMatchup(prop, games);
  const imgClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  const placeholderClass = imgClass;
  const vsClass = size === 'sm' ? 'text-[9px] leading-none' : 'text-[10px] leading-none';
  const gapClass = size === 'sm' ? 'gap-1' : 'gap-1.5';
  return (
    <div className={`flex items-center ${gapClass} flex-wrap`}>
      {homeFlagUrl ? (
        <img
          src={homeFlagUrl}
          alt={homeName}
          className={`${imgClass} object-contain flex-shrink-0 rounded-sm`}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          className={`${placeholderClass} rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`}
        />
      )}
      <span className={`${vsClass} flex-shrink-0 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>vs</span>
      {awayFlagUrl ? (
        <img
          src={awayFlagUrl}
          alt={awayName}
          className={`${imgClass} object-contain flex-shrink-0 rounded-sm`}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          className={`${placeholderClass} rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`}
        />
      )}
    </div>
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
  isDark: boolean;
  mounted: boolean;
  size?: 'sm' | 'md';
}) {
  const imgClass = size === 'md' ? 'w-8 h-8' : 'w-5 h-5';
  const vsClass = size === 'md' ? 'text-xs' : 'text-[10px] leading-none';
  const vsWeight = size === 'md' ? 'font-semibold' : '';

  if (sport === 'world-cup') {
    let homeName = String(homeTeam ?? '').trim();
    let awayName = String(awayTeam ?? '').trim();
    if (homeName && awayName && wcTeamKeysMatch(homeName, awayName)) awayName = '';
    const homeFlagUrl = homeName
      ? wcTeamFlagUrl(homeName, { teamCode: homeTeamCode, teamLogo: homeTeamLogo })
      : null;
    const awayFlagUrl = awayName
      ? wcTeamFlagUrl(awayName, { teamCode: awayTeamCode, teamLogo: awayTeamLogo })
      : null;
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {homeFlagUrl ? (
          <img src={homeFlagUrl} alt={homeName} className={`${imgClass} object-contain flex-shrink-0 rounded-sm`} />
        ) : (
          <div className={`${imgClass} rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
        )}
        <span className={`${vsClass} ${vsWeight} flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
        {awayFlagUrl ? (
          <img src={awayFlagUrl} alt={awayName} className={`${imgClass} object-contain flex-shrink-0 rounded-sm`} />
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

// Constants
const SEARCH_DEBOUNCE_MS = 300;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_STORAGE_MAX_SIZE = 4 * 1024 * 1024; // 4MB (conservative limit, most browsers allow 5-10MB)

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

const AFL_PROPS_CACHE_KEY = 'afl_props_list_cache_v5';
const WC_PROPS_CACHE_KEY = 'wc_props_list_cache_v9';
const WC_PROPS_MIN_DECIMAL_ODDS = 1.6;

function worldCupBackNavSkipFetchPending(): boolean {
  try {
    return sessionStorage.getItem(WC_BACK_TO_PROPS_SKIP_FETCH_KEY) === '1';
  } catch {
    return false;
  }
}

function consumeWorldCupBackNavSkipFetch(): boolean {
  try {
    const pending = sessionStorage.getItem(WC_BACK_TO_PROPS_SKIP_FETCH_KEY) === '1';
    if (pending) sessionStorage.removeItem(WC_BACK_TO_PROPS_SKIP_FETCH_KEY);
    return pending;
  } catch {
    return false;
  }
}

function worldCupListConfirmsNoOdds(listData: unknown): boolean {
  const payload = listData as { data?: unknown[]; noWorldCupOdds?: boolean; noAflOdds?: boolean } | null;
  const rawRows = Array.isArray(payload?.data) ? payload.data : [];
  if (rawRows.length > 0) return false;
  return payload?.noWorldCupOdds === true || payload?.noAflOdds === true;
}

function rawWorldCupListRows(listData: any): any[] {
  const rawRows = Array.isArray(listData?.data) ? listData.data : [];
  // Match server combined snapshot: min-odds only (do not require warmed stats here).
  return rawRows.filter((r: { overOdds?: string; underOdds?: string; yesOdds?: string }) =>
    wcPropsMeetsMinOdds(r.overOdds, r.underOdds, r.yesOdds)
  );
}

function wcPropsMeetsMinOdds(overOdds?: string, underOdds?: string, yesOdds?: string): boolean {
  const raw = String(yesOdds ?? overOdds ?? '').trim();
  if (!raw || raw === 'N/A') return false;
  let decimal: number | null = null;
  const asFloat = Number.parseFloat(raw.replace(',', '.'));
  if (Number.isFinite(asFloat) && asFloat > 1 && asFloat < 500 && !/^[+-]/.test(raw)) {
    decimal = asFloat;
  } else {
    const n = Number.parseInt(raw.replace('+', ''), 10);
    if (Number.isFinite(n)) decimal = n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
  }
  return decimal != null && decimal >= WC_PROPS_MIN_DECIMAL_ODDS;
}

function worldCupPropHasPlayerCategoryStats(row: {
  last5Avg?: number | null;
  last10Avg?: number | null;
  seasonAvg?: number | null;
  wcGamesAvg?: number | null;
  wcGamesHitRate?: { hits: number; total: number } | null;
  dvpRating?: number | null;
}): boolean {
  if (row.last5Avg != null) return true;
  if (row.last10Avg != null) return true;
  if (row.seasonAvg != null) return true;
  if (row.wcGamesAvg != null) return true;
  if (row.dvpRating != null && row.dvpRating > 0) return true;
  return (row.wcGamesHitRate?.total ?? 0) > 0;
}

/** L5/L10/Season columns — DvP alone is not enough to skip a refetch after tab switches. */
function worldCupPropHasHistoricalStats(row: {
  last5Avg?: number | null;
  last10Avg?: number | null;
  seasonAvg?: number | null;
}): boolean {
  return row.last5Avg != null || row.last10Avg != null || row.seasonAvg != null;
}

function aflPropHasHistoricalStats(row: {
  last5Avg?: number | null;
  last10Avg?: number | null;
  seasonAvg?: number | null;
}): boolean {
  return row.last5Avg != null || row.last10Avg != null || row.seasonAvg != null;
}

function countAflPropsWithHistoricalStats(props: PlayerProp[]): number {
  return props.filter(isAflCombinedListProp).filter(aflPropHasHistoricalStats).length;
}

function aflPropsMissingHistoricalStats(props: PlayerProp[]): boolean {
  const listed = props.filter(isAflCombinedListProp);
  if (listed.length === 0) return false;
  return countAflPropsWithHistoricalStats(listed) === 0;
}

async function backfillAflPropStatsBatch(props: PlayerProp[]): Promise<PlayerProp[] | null> {
  const needsStats = props
    .filter(
      (p) =>
        isAflCombinedListProp(p) &&
        !aflPropHasHistoricalStats(p) &&
        p.overOdds &&
        p.overOdds !== 'N/A'
    )
    .slice(0, 60);
  if (needsStats.length === 0) return null;

  const batchProps = needsStats.map((p) => ({
    playerName: p.playerName,
    team: p.team,
    opponent: p.opponent,
    statType: p.statType,
    line: p.line,
  }));

  try {
    const res = await fetch('/api/afl/props-stats/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ props: batchProps }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
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
    const stats = data.stats ?? {};
    let merged = 0;
    const updated = props.map((p) => {
      const key = `${p.playerName}|${p.statType}|${p.team}|${p.opponent}|${p.line}`;
      const s = stats[key];
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
  } catch {
    return null;
  }
}

function countWorldCupPropsWithHistoricalStats(props: PlayerProp[]): number {
  return filterWorldCupListProps(props).filter(worldCupPropHasHistoricalStats).length;
}

function worldCupPropsMissingHistoricalStats(props: PlayerProp[]): boolean {
  const listed = filterWorldCupListProps(props);
  if (listed.length === 0) return false;
  return countWorldCupPropsWithHistoricalStats(listed) === 0;
}

function preferWorldCupPropsWithHistoricalStats(primary: PlayerProp[], fallback: PlayerProp[]): PlayerProp[] {
  const primaryListed = pickWorldCupPropsFromCombinedSource(primary);
  const fallbackListed = pickWorldCupPropsFromCombinedSource(fallback);
  if (primaryListed.length === 0) return fallbackListed;
  if (fallbackListed.length === 0) return primaryListed;
  const primaryStats = countWorldCupPropsWithHistoricalStats(primaryListed);
  const fallbackStats = countWorldCupPropsWithHistoricalStats(fallbackListed);
  return fallbackStats > primaryStats ? fallbackListed : primaryListed;
}

function isAflCombinedListProp(row: PlayerProp): boolean {
  return !isWorldCupSoccerPropStatType(row.statType);
}

function preferAflPropsForCombined(primary: PlayerProp[], fallback: PlayerProp[]): PlayerProp[] {
  const primaryAfl = primary.filter(isAflCombinedListProp);
  const fallbackAfl = fallback.filter(isAflCombinedListProp);
  if (primaryAfl.length === 0) return fallbackAfl;
  if (fallbackAfl.length === 0) return primaryAfl;
  return primaryAfl.length >= fallbackAfl.length ? primaryAfl : fallbackAfl;
}

type SecondaryPropsSessionCache = {
  props: PlayerProp[];
  games: AflGameForProps[];
  selectedGameIds: string[];
  isFresh: boolean;
};

function readSecondaryPropsSessionCache(sport: 'afl' | 'world-cup'): SecondaryPropsSessionCache {
  const empty: SecondaryPropsSessionCache = {
    props: [],
    games: [],
    selectedGameIds: [],
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
      timestamp?: number;
    };
    const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
    const isFresh = Number.isFinite(age) && age < AFL_PROPS_CACHE_TTL_MS;
    const propsRaw = Array.isArray(parsed?.props) ? parsed.props : [];
    const props =
      sport === 'world-cup' ? hydrateWorldCupPropsFromCacheRows(propsRaw) : propsRaw;
    const statsFresh =
      sport === 'world-cup'
        ? !worldCupPropsMissingHistoricalStats(props)
        : !aflPropsMissingHistoricalStats(props);
    return {
      props,
      games: Array.isArray(parsed?.games) ? parsed.games : [],
      selectedGameIds: Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : [],
      isFresh: isFresh && statsFresh,
    };
  } catch {
    return empty;
  }
}

function combinedModeHasAflRows(aflProps: PlayerProp[]): boolean {
  return aflProps.some(isAflCombinedListProp);
}

function combinedModeHasWcRows(worldCupProps: PlayerProp[]): boolean {
  return WORLD_CUP_PUBLIC_ENABLED && filterWorldCupListProps(worldCupProps).length > 0;
}

function combinedModeMissingSecondarySlice(
  aflProps: PlayerProp[],
  worldCupProps: PlayerProp[],
  opts?: { noAflOdds?: boolean; noWorldCupOdds?: boolean }
): { missingAfl: boolean; missingWc: boolean } {
  const noAflOdds = opts?.noAflOdds === true;
  const noWorldCupOdds = opts?.noWorldCupOdds === true;
  const hasAfl = combinedModeHasAflRows(aflProps);
  const hasWc = combinedModeHasWcRows(worldCupProps);
  const missingAfl = !noAflOdds && !hasAfl && hasWc;
  const missingWc = WORLD_CUP_PUBLIC_ENABLED && !noWorldCupOdds && !hasWc && hasAfl;
  return { missingAfl, missingWc };
}

function isCombinedSecondaryPaintReady(
  aflProps: PlayerProp[],
  worldCupProps: PlayerProp[],
  opts?: { noAflOdds?: boolean; noWorldCupOdds?: boolean }
): boolean {
  const noAflOdds = opts?.noAflOdds === true;
  const noWorldCupOdds = opts?.noWorldCupOdds === true;
  const aflResolved = noAflOdds || combinedModeHasAflRows(aflProps);
  const wcResolved =
    !WORLD_CUP_PUBLIC_ENABLED || noWorldCupOdds || combinedModeHasWcRows(worldCupProps);
  return aflResolved && wcResolved;
}

function combinedModeHasVisibleRows(
  nbaProps: PlayerProp[],
  aflProps: PlayerProp[],
  worldCupProps: PlayerProp[]
): boolean {
  if (nbaProps.length > 0) return true;
  if (aflProps.some(isAflCombinedListProp)) return true;
  if (filterWorldCupListProps(worldCupProps).length > 0) return true;
  return false;
}

function combinedModeNeedsDataRefresh(
  nbaProps: PlayerProp[],
  aflProps: PlayerProp[],
  worldCupProps: PlayerProp[],
  partialRefetchAttempted: { wc: boolean; afl: boolean },
  oddsFlags?: { noAflOdds?: boolean; noWorldCupOdds?: boolean }
): boolean {
  if (!combinedModeHasVisibleRows(nbaProps, aflProps, worldCupProps)) return true;
  const { missingAfl, missingWc } = combinedModeMissingSecondarySlice(
    aflProps,
    worldCupProps,
    oddsFlags
  );
  if (missingWc && !partialRefetchAttempted.wc) return true;
  if (missingAfl && !partialRefetchAttempted.afl) return true;
  if (filterWorldCupListProps(worldCupProps).length > 0 && worldCupPropsMissingHistoricalStats(worldCupProps)) {
    // Stats may still be warming — keep showing odds rows; do not block the combined feed as "incomplete".
    return missingAfl || missingWc;
  }
  if (aflProps.some(isAflCombinedListProp) && aflPropsMissingHistoricalStats(aflProps)) {
    return true;
  }
  return false;
}

function hydrateWorldCupPropsFromCacheRows(cachedPropsRaw: PlayerProp[]): PlayerProp[] {
  const paintable = filterWorldCupPaintableProps(cachedPropsRaw);
  if (paintable.length > 0) return paintable;
  return pickWorldCupPropsFromCombinedSource(cachedPropsRaw);
}

function hydrateWorldCupPropsFromSessionCache(): PlayerProp[] {
  try {
    const wcRaw = sessionStorage.getItem(WC_PROPS_CACHE_KEY);
    if (!wcRaw) return [];
    const wcParsed = JSON.parse(wcRaw) as {
      props?: PlayerProp[];
      timestamp?: number;
    };
    const wcAge = wcParsed?.timestamp != null ? Date.now() - Number(wcParsed.timestamp) : Infinity;
    const wcProps = Array.isArray(wcParsed?.props) ? wcParsed.props : [];
    if (wcAge >= AFL_PROPS_CACHE_TTL_MS || wcProps.length === 0) return [];
    return hydrateWorldCupPropsFromCacheRows(wcProps);
  } catch {
    return [];
  }
}

function filterWorldCupPaintableProps(props: PlayerProp[]): PlayerProp[] {
  return props.filter(isWorldCupPaintableProp);
}

function normalizeSecondaryPropStatType(statType: string): string {
  return String(statType || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/** AFL-only markets — must never render under World Cup mode. */
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
    n.includes('disposal') ||
    n.includes('handball') ||
    n.includes('tackle')
  );
}

function isWorldCupSoccerPropStatType(statType: string): boolean {
  if (isAflExclusivePropStatType(statType)) return false;
  const n = normalizeSecondaryPropStatType(statType);
  return (
    n === 'goals' ||
    n === 'assists' ||
    n === 'total_shots' ||
    n === 'shots_on_target' ||
    n === 'fouls_committed' ||
    n === 'yellow_cards' ||
    n === 'anytime_goal_scorer' ||
    n === 'anytime_goals' ||
    n === 'goals_anytime' ||
    n.includes('goal') ||
    n.includes('assist') ||
    n.includes('shot') ||
    n.includes('foul') ||
    n.includes('yellow') ||
    n.includes('card')
  );
}

function isWorldCupPaintableProp(row: PlayerProp): boolean {
  if (isAflExclusivePropStatType(row.statType)) return false;
  return worldCupPropHasPlayerCategoryStats(row);
}

/** Rows eligible for WC-only list (matches combined interleave — stats may still be warming). */
function isWorldCupListProp(row: PlayerProp): boolean {
  if (isAflExclusivePropStatType(row.statType)) return false;
  if (isWorldCupSoccerPropStatType(row.statType)) return true;
  return worldCupPropHasPlayerCategoryStats(row);
}

function filterWorldCupListProps(props: PlayerProp[]): PlayerProp[] {
  return props.filter(isWorldCupListProp);
}

/** Prefer paintable WC rows; fall back to any non-AFL market with stats (combined → WC hydrate). */
function pickWorldCupHydrationProps(props: PlayerProp[]): PlayerProp[] {
  const paintable = props.filter(isWorldCupPaintableProp);
  if (paintable.length > 0) return paintable;
  return props.filter(
    (p) => !isAflExclusivePropStatType(p.statType) && worldCupPropHasPlayerCategoryStats(p)
  );
}

/** Combined → WC: use the same rows the All feed already showed. */
function pickWorldCupPropsFromCombinedSource(props: PlayerProp[]): PlayerProp[] {
  const listed = filterWorldCupListProps(props);
  if (listed.length > 0) return listed;
  return pickWorldCupHydrationProps(props);
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

/** Never restore AFL game ids over WC props (or vice versa) — only ids that match rows. */
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

function propsRowShowsUnderOdds(rowSport: 'nba' | 'afl' | 'world-cup'): boolean {
  return rowSport !== 'world-cup';
}
const COMBINED_PROPS_CACHE_KEY = 'combined_props_snapshot_cache_v3';
const COMBINED_PROPS_LS_KEY = 'combined_props_snapshot_ls_v3';
const COMBINED_PROPS_LS_TS_KEY = 'combined_props_snapshot_ls_ts_v3';
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
function getSecondaryPropsCacheKey(sport: 'afl' | 'world-cup'): string {
  return sport === 'world-cup' ? WC_PROPS_CACHE_KEY : AFL_PROPS_CACHE_KEY;
}

function getSecondaryPropsListUrl(sport: 'afl' | 'world-cup', debugStats: boolean): string {
  if (sport === 'world-cup') {
    const base = '/api/world-cup/dashboard?playerPropsList=1';
    return debugStats ? `${base}&debugStats=1` : base;
  }
  const base = '/api/afl/player-props/list';
  return debugStats ? `${base}?debugStats=1` : base;
}

const WC_PROPS_FETCH_TIMEOUT_MS = 25_000;
const WC_PLAYER_PROPS_LIST_URL = '/api/world-cup/dashboard?playerPropsList=1';
const WC_LIST_CLIENT_CACHE_MS = 45_000;

type WorldCupListFetchResult = {
  response: Response;
  payload: unknown;
};

let worldCupPlayerPropsListInFlight: Promise<WorldCupListFetchResult> | null = null;
let worldCupPlayerPropsListCache: { fetchedAt: number; result: WorldCupListFetchResult } | null = null;

async function fetchSecondaryPropsList(url: string): Promise<Response> {
  if (url.startsWith(WC_PLAYER_PROPS_LIST_URL.split('?')[0]) && url.includes('playerPropsList=1')) {
    const { response } = await fetchWorldCupPlayerPropsListDeduped();
    return response;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WC_PROPS_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** One in-flight WC list request per page — avoids 6s render pile-ups that freeze refresh. */
async function fetchWorldCupPlayerPropsListDeduped(): Promise<WorldCupListFetchResult> {
  const now = Date.now();
  if (
    worldCupPlayerPropsListCache &&
    now - worldCupPlayerPropsListCache.fetchedAt < WC_LIST_CLIENT_CACHE_MS
  ) {
    return worldCupPlayerPropsListCache.result;
  }
  if (worldCupPlayerPropsListInFlight) {
    return worldCupPlayerPropsListInFlight;
  }

  worldCupPlayerPropsListInFlight = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WC_PROPS_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(WC_PLAYER_PROPS_LIST_URL, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      const result: WorldCupListFetchResult = { response, payload };
      if (response.ok && payload != null) {
        worldCupPlayerPropsListCache = { fetchedAt: Date.now(), result };
      }
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  })().finally(() => {
    worldCupPlayerPropsListInFlight = null;
  });

  return worldCupPlayerPropsListInFlight;
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
  warmImage(WORLD_CUP_LOGO_PATH);
  kickCombinedPropsEarlyFetch();
}

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
  const PROPS_DESKTOP_SKELETON_TOP_OFFSET_PX = 300;
  const [desktopSkeletonRowCount, setDesktopSkeletonRowCount] = useState(12);
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
    wc: 'none',
    season: 'none',
    streak: 'none',
    ip: 'none',
  });
  // Odds format state - load from localStorage or default to 'american'
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>(DEFAULT_ODDS_FORMAT);

  // Props page sport: Combined (default) | NBA | AFL — restore explicit mode from URL when provided
  const [propsSport, setPropsSport] = useState<PropsSportMode>(defaultPropsSport());
  const [aflGames, setAflGames] = useState<AflGameForProps[]>([]);
  const [aflProps, setAflProps] = useState<PlayerProp[]>([]);
  const [worldCupCombinedProps, setWorldCupCombinedProps] = useState<PlayerProp[]>([]);
  /** Always-current WC slice for combined → WC toggles (avoid stale applySportMode closure). */
  const worldCupCombinedPropsRef = useRef<PlayerProp[]>([]);
  worldCupCombinedPropsRef.current = worldCupCombinedProps;
  const aflPropsRef = useRef<PlayerProp[]>([]);
  aflPropsRef.current = aflProps;
  const aflGamesRef = useRef<AflGameForProps[]>([]);
  aflGamesRef.current = aflGames;
  const todaysGamesRef = useRef<Game[]>([]);
  todaysGamesRef.current = todaysGames;
  const propsSportRef = useRef<PropsSportMode>(propsSport);
  propsSportRef.current = propsSport;
  const combinedOddsFlagsRef = useRef<{ noAflOdds: boolean; noWorldCupOdds: boolean }>({
    noAflOdds: false,
    noWorldCupOdds: false,
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
  /** Skip one combined API fetch after an instant warm sport toggle (AFL/WC → combined). */
  const combinedWarmToggleRef = useRef(false);
  const combinedPartialWcRefetchAttemptedRef = useRef(false);
  const combinedPartialAflRefetchAttemptedRef = useRef(false);
  const combinedFetchInFlightRef = useRef(false);
  const combinedLoadPromiseRef = useRef<Promise<void> | null>(null);
  /** Skip AFL/WC list fetch after instant session-cache restore (persists through Strict Mode re-runs). */
  const secondarySkipFetchSportRef = useRef<'afl' | 'world-cup' | null>(null);
  /** Set when applySportMode hydrates secondary rows — fetch effect must not undo it. */
  const secondaryWarmHydrateRef = useRef(false);
  /** Authoritative secondary list sport — stale in-flight fetches must not apply after toggle. */
  const secondaryListSportRef = useRef<'afl' | 'world-cup' | null>(null);
  const aflRetryTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const aflListFetchInFlightRef = useRef<{
    sport: 'afl' | 'world-cup';
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

  const aggregateSecondaryListPayload = useCallback((listData: any, sport: 'afl' | 'world-cup') => {
    const games: AflGameForProps[] = Array.isArray(listData?.games) ? listData.games : [];
    const rawRows: any[] = Array.isArray(listData?.data) ? listData.data : [];
    const rows =
      sport === 'world-cup'
        ? rawWorldCupListRows(listData)
        : rawRows;
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
      wcGamesAvg?: number | null;
      wcGamesHitRate?: { hits: number; total: number } | null;
      wcGameLog?: Array<{ opponent: string; value: number; date?: string }>;
      dvpRating?: number | null;
      dvpStatValue?: number | null;
      headshotUrl?: string | null;
      wcPosition?: string | null;
      playerId?: string | null;
      teamId?: string | null;
      opponentTeamId?: string | null;
      aflFantasyPosition?: 'DEF' | 'MID' | 'FWD' | 'RUC' | null;
      aflDfsRole?: string | null;
    }>();

    for (const r of rows) {
      const key = `${r.playerName}|${r.gameId}|${r.statType}|${r.line}`;
      const existing = keyToRow.get(key);
      const bl = { bookmaker: r.bookmaker, line: r.line, overOdds: r.overOdds || 'N/A', underOdds: r.underOdds || 'N/A' };
      if (existing) {
        existing.bookmakerLines.push(bl);
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
          statType: r.statType,
          line: r.line,
          commenceTime: r.commenceTime || '',
          bookmakerLines: [bl],
          last5Avg: r.last5Avg,
          last10Avg: r.last10Avg,
          h2hAvg: r.h2hAvg,
          seasonAvg: r.seasonAvg,
          streak: r.streak,
          last5HitRate: r.last5HitRate,
          last10HitRate: r.last10HitRate,
          h2hHitRate: r.h2hHitRate,
          seasonHitRate: r.seasonHitRate,
          wcGamesAvg: r.wcGamesAvg,
          wcGamesHitRate: r.wcGamesHitRate,
          wcGameLog: r.wcGameLog,
          dvpRating: r.dvpRating,
          dvpStatValue: r.dvpStatValue,
          headshotUrl: r.headshotUrl ?? null,
          wcPosition: r.wcPosition ?? null,
          playerId: r.playerId != null ? String(r.playerId) : null,
          teamId: r.teamId != null ? String(r.teamId) : null,
          opponentTeamId: r.opponentTeamId != null ? String(r.opponentTeamId) : null,
          aflFantasyPosition: r.aflFantasyPosition ?? null,
          aflDfsRole: r.aflDfsRole ?? null,
        });
      }
    }

    const aggregated: PlayerProp[] = Array.from(keyToRow.values()).map((a) => {
      const playerTeam = a.playerTeam && String(a.playerTeam).trim() ? a.playerTeam : null;
      const homeNorm = normalizeTeamDisplay(a.homeTeam || '');
      const awayNorm = normalizeTeamDisplay(a.awayTeam || '');
      const playerNorm = playerTeam ? normalizeTeamDisplay(playerTeam) : null;
      const team = playerNorm || homeNorm;
      const opponent = playerNorm
        ? (playerNorm === homeNorm ? awayNorm : playerNorm === awayNorm ? homeNorm : awayNorm)
        : awayNorm;

      return {
        playerName: a.playerName,
        playerId: a.playerId && /^\d+$/.test(a.playerId) ? a.playerId : '',
        team,
        opponent,
        wcTeamId: a.teamId && /^\d+$/.test(a.teamId) ? a.teamId : null,
        wcOpponentTeamId: a.opponentTeamId && /^\d+$/.test(a.opponentTeamId) ? a.opponentTeamId : null,
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
        homeTeamCode: a.homeTeamCode ?? null,
        awayTeamCode: a.awayTeamCode ?? null,
        homeTeamLogo: a.homeTeamLogo ?? null,
        awayTeamLogo: a.awayTeamLogo ?? null,
        last5Avg: a.last5Avg,
        last10Avg: a.last10Avg,
        h2hAvg: a.h2hAvg,
        seasonAvg: a.seasonAvg,
        streak: a.streak,
        last5HitRate: a.last5HitRate,
        last10HitRate: a.last10HitRate,
        h2hHitRate: a.h2hHitRate,
        seasonHitRate: a.seasonHitRate,
        wcGamesAvg: a.wcGamesAvg,
        wcGamesHitRate: a.wcGamesHitRate,
        wcGameLog: a.wcGameLog,
        dvpRating: a.dvpRating,
        dvpStatValue: a.dvpStatValue,
        headshotUrl: a.headshotUrl ?? null,
        wcPosition: a.wcPosition ?? null,
        aflFantasyPosition: a.aflFantasyPosition ?? null,
        aflDfsRole: a.aflDfsRole ?? null,
      };
    });

    let finalGames = games;
    let finalAggregated = aggregated;
    let noOdds = listData?.noAflOdds === true || listData?.noWorldCupOdds === true;
    let ingestMessage =
      typeof listData?.ingestMessage === 'string' ? listData.ingestMessage : undefined;
    const staleSnapshot =
      listData?._meta &&
      typeof listData._meta === 'object' &&
      (listData._meta as { stale?: unknown }).stale === true;

    if (sport === 'afl') {
      const live = applyLiveAflPropsCutoff(aggregated, games);
      finalGames = live.games;
      finalAggregated = live.props;
      if (live.noAflOdds) {
        if (staleSnapshot && aggregated.length > 0) {
          finalGames = games;
          finalAggregated = aggregated;
        } else {
          noOdds = true;
          ingestMessage = live.ingestMessage ?? AFL_USER_NO_ODDS;
        }
      }
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
    const nextSet = new Set(nextGameIds);
    // First AFL load with no prior selection: default to all current games.
    if (!userModifiedAflGamesRef.current && selectedAflGamesRef.current.size === 0) {
      selectedAflGamesRef.current = nextSet;
      setSelectedAflGames(nextSet);
      return;
    }
    // Preserve restored/user-selected games by intersecting with the new game list.
    const out = new Set<string>();
    for (const id of selectedAflGamesRef.current) {
      if (nextSet.has(id)) out.add(id);
    }
    // If a restored selection becomes invalid (new slate/no overlap), fall back to all.
    // Keep empty when the user intentionally cleared all games.
    const nextSelection = out.size === 0 && !userModifiedAflGamesRef.current ? nextSet : out;
    selectedAflGamesRef.current = nextSelection;
    setSelectedAflGames(nextSelection);
  }, []);

  const getSelectedAflGameIdsForCache = useCallback((candidateGameIds: string[]) => {
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
          sessionStorage.setItem(
            AFL_PROPS_CACHE_KEY,
            JSON.stringify({
              props: aflPropsForCache,
              games: aflGamesForCache,
              selectedGameIds,
              timestamp: now,
            })
          );
        }

        const wcPropsForCache = Array.isArray(paintSnapshot?.worldCup?.props) ? paintSnapshot.worldCup.props : [];
        const wcGamesForCache = Array.isArray(paintSnapshot?.worldCup?.games) ? paintSnapshot.worldCup.games : [];
        if (paintSnapshot?.worldCup?.noWorldCupOdds) {
          sessionStorage.removeItem(WC_PROPS_CACHE_KEY);
        } else if (wcPropsForCache.length > 0 || wcGamesForCache.length > 0) {
          let writeWcCache = true;
          try {
            const existingRaw = sessionStorage.getItem(WC_PROPS_CACHE_KEY);
            if (existingRaw) {
              const existingParsed = JSON.parse(existingRaw) as { props?: PlayerProp[] };
              const existingProps = Array.isArray(existingParsed?.props) ? existingParsed.props : [];
              const existingStats = countWorldCupPropsWithHistoricalStats(existingProps);
              const incomingStats = countWorldCupPropsWithHistoricalStats(wcPropsForCache);
              if (existingStats > incomingStats) writeWcCache = false;
            }
          } catch {
            // keep writeWcCache true
          }
          if (writeWcCache) {
            sessionStorage.setItem(
              WC_PROPS_CACHE_KEY,
              JSON.stringify({
                props: wcPropsForCache,
                games: wcGamesForCache,
                selectedGameIds,
                timestamp: now,
              })
            );
          }
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
      preserveWorldCupProps?: PlayerProp[];
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
    const worldCupPropsNext = preferWorldCupPropsWithHistoricalStats(
      Array.isArray(options?.preserveWorldCupProps)
        ? options.preserveWorldCupProps
        : worldCupCombinedPropsRef.current,
      Array.isArray(combinedSnapshot?.worldCup?.props) ? combinedSnapshot.worldCup.props : []
    );
    const snapshotNoAflOdds = combinedSnapshot?.afl?.noAflOdds === true;
    const snapshotNoWorldCupOdds = combinedSnapshot?.worldCup?.noWorldCupOdds === true;
    combinedOddsFlagsRef.current = {
      noAflOdds: snapshotNoAflOdds && aflPropsNext.length === 0,
      noWorldCupOdds: snapshotNoWorldCupOdds && worldCupPropsNext.length === 0,
    };
    const oddsFlagsNext = combinedOddsFlagsRef.current;
    const noAflOdds = oddsFlagsNext.noAflOdds;
    const mergedNba = mergeNbaPropsWithStoredCalculatedStats(nbaRows);

    propsLoadedRef.current = mergedNba.props.length > 0;
    initialFetchCompletedRef.current = true;
    mergedNba.calculatedKeys.forEach((key) => calculatedKeysRef.current.add(key));

    const combinedVisible = combinedModeHasVisibleRows(mergedNba.props, aflPropsNext, worldCupPropsNext);
    const { missingAfl, missingWc } = combinedModeMissingSecondarySlice(
      aflPropsNext,
      worldCupPropsNext,
      combinedOddsFlagsRef.current
    );
    const combinedComplete = combinedVisible && !missingAfl && !missingWc;
    const paintUnlocked =
      isCombinedSecondaryPaintReady(aflPropsNext, worldCupPropsNext, oddsFlagsNext) || combinedVisible;

    startTransition(() => {
    setPlayerProps(mergedNba.props);
    setPropsWithCalculatedStats(mergedNba.calculatedMap);
    setPropsLoading(false);
    setPropsProcessing(false);

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
    setWorldCupCombinedProps((prev) => {
      const merged = preferWorldCupPropsWithHistoricalStats(prev, worldCupPropsNext);
      return WORLD_CUP_PUBLIC_ENABLED ? merged : [];
    });
    setAflIngestMessage(combinedSnapshot?.afl?.ingestMessage ?? null);
    setAflLastUpdated(combinedSnapshot?.afl?.lastUpdated ?? null);
    if (combinedSnapshot?.afl?.debugMeta) {
      setAflListDebugMeta(combinedSnapshot.afl.debugMeta);
    } else {
      setAflListDebugMeta(null);
    }

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
    setCombinedFetchComplete(combinedComplete);
    setCombinedPropsLoading(!combinedVisible || missingAfl || missingWc);
    setCombinedPaintUnlocked(paintUnlocked);
    });

    if (options?.persistCaches !== false) {
      persistCombinedSnapshotCaches(combinedSnapshot);
    }
  }, [mergeNbaPropsWithStoredCalculatedStats, persistCombinedSnapshotCaches, setSecondaryPropsFetchComplete, syncSelectedAflGames, setCombinedFetchComplete]);

  // Re-unlock combined paint when returning to All with both slices already in memory.
  useEffect(() => {
    if (propsSport !== 'combined' || combinedPaintUnlocked) return;
    const ready = isCombinedSecondaryPaintReady(
      aflPropsRef.current,
      worldCupCombinedPropsRef.current,
      combinedOddsFlagsRef.current
    );
    if (ready) {
      setCombinedPaintUnlocked(true);
      setCombinedFetchComplete(true);
      setCombinedPropsLoading(false);
    }
  }, [propsSport, aflProps, worldCupCombinedProps, combinedPaintUnlocked, setCombinedFetchComplete]);

  const skipPropsRefetchOnceRef = useRef(false);

  useEffect(() => {
    return bindPropsPageSnapshotGetter(() => {
      if (typeof window === 'undefined') return null;
      const sportParam = new URL(window.location.href).searchParams.get('sport');
      return {
        timestamp: Date.now(),
        sportParam,
        propsSport: propsSportRef.current,
        playerProps: playerPropsRef.current,
        aflProps: aflPropsRef.current,
        worldCupCombinedProps: worldCupCombinedPropsRef.current,
        aflGames: aflGamesRef.current,
        todaysGames: todaysGamesRef.current,
        selectedAflGameIds: Array.from(selectedAflGamesRef.current),
        combinedPaintUnlocked: combinedPaintUnlockedRef.current,
        combinedFetchComplete: combinedPropsFetchCompleteRef.current,
        noAflOdds: combinedOddsFlagsRef.current.noAflOdds,
        noWorldCupOdds: combinedOddsFlagsRef.current.noWorldCupOdds,
        scrollY: window.scrollY,
        currentPage: currentPageRef.current,
      };
    });
  }, []);

  useEffect(() => {
    if (pendingScrollRestoreRef.current == null) return;
    const y = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
    });
  }, []);
  /** When ?debugStats=1, list API returns _meta with debugNa (why L5/L10/Season show N/A). */
  const [aflListDebugMeta, setAflListDebugMeta] = useState<Record<string, unknown> | null>(null);
  /** AFL ingest status from list API (same as NBA: "Fetched X stats for Y season, Z games"). */
  const [aflIngestMessage, setAflIngestMessage] = useState<string | null>(null);
  const [aflLastUpdated, setAflLastUpdated] = useState<string | null>(null);
  // AFL player jumper numbers (name -> number) from league stats, for circle placeholder
  const [aflPlayerNumbers, setAflPlayerNumbers] = useState<Record<string, number>>({});
  // AFL team logos (normalized name -> url) for matchup display
  const [aflLogoByTeam, setAflLogoByTeam] = useState<Record<string, string>>({});

  // Mobile bottom nav dropdown state
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [selectedSurveySport, setSelectedSurveySport] = useState<NextSportSurveyOption | null>(null);
  const [surveySubmitting, setSurveySubmitting] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);
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

  // Reset "user modified" flag when leaving AFL-only filter mode.
  useEffect(() => {
    if (propsSport !== 'afl' && propsSport !== 'world-cup') userModifiedAflGamesRef.current = false;
  }, [propsSport]);

  // Find player (not in props / no odds) modal: bottom-right on mobile, top-right on desktop
  const [findPlayerOpen, setFindPlayerOpen] = useState(false);
  const [findPlayerQuery, setFindPlayerQuery] = useState('');
  const [findPlayerResults, setFindPlayerResults] = useState<Array<{ name: string; team?: string }>>([]);
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
      const available = Math.max(window.innerHeight - PROPS_DESKTOP_SKELETON_TOP_OFFSET_PX, 420);
      const rows = Math.ceil(available / PROPS_DESKTOP_SKELETON_ROW_HEIGHT_PX);
      setDesktopSkeletonRowCount(Math.min(Math.max(rows, 10), 32));
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
      const url = new URL(window.location.href);
      const sportParam = url.searchParams.get('sport');
      const resolvedSport = resolvePropsSportParam(sportParam);
      if (!WORLD_CUP_PUBLIC_ENABLED && (sportParam === 'world-cup' || sportParam === 'worldcup')) {
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
      } else if (resolvedSport === 'world-cup' && WORLD_CUP_PUBLIC_ENABLED) {
        setPropsSport('world-cup');
        try {
          const hydrated = hydrateWorldCupPropsFromSessionCache();
          if (hydrated.length === 0) setAflPropsLoading(true);
        } catch {
          setAflPropsLoading(true);
        }
      } else if (sportParam === 'combined' || sportParam === 'all') {
        setPropsSport('combined');
      }
      // When coming back from AFL/World Cup dashboard "Back to Player Props", clear the search
      // filter and debounced value so the next search (e.g. same player name) runs correctly.
      try {
        if (sessionStorage.getItem('afl_back_to_props_clear_search') === '1') {
          sessionStorage.removeItem('afl_back_to_props_clear_search');
          setSearchQuery('');
          setDebouncedSearchQuery('');
        }
        if (sessionStorage.getItem(WC_BACK_TO_PROPS_CLEAR_SEARCH_KEY) === '1') {
          sessionStorage.removeItem(WC_BACK_TO_PROPS_CLEAR_SEARCH_KEY);
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
    const sportParam = url.searchParams.get('sport');
    const requiresCombinedFirstPaint =
      sportParam === null || sportParam === 'combined' || sportParam === 'all';
    let restoredNbaCache = false;
    let restoredAflCache = false;
    let restoredCombinedSnapshot = false;
    let paintedNbaProps: PlayerProp[] = [];
    let paintedAflProps: PlayerProp[] = [];
    let paintedWcProps: PlayerProp[] = [];
    let paintedNoAflOdds = false;
    let paintedNoWorldCupOdds = false;

    // 1) Restore sport from URL when explicitly provided
    const resolvedSport = resolvePropsSportParam(sportParam);
    const urlSpecifiesSport =
      sportParam != null && sportParam !== 'all' && sportParam !== 'combined';
    if (resolvedSport === 'nba') {
      setPropsSport('nba');
    } else if (resolvedSport === 'afl') {
      setPropsSport('afl');
      secondaryListSportRef.current = 'afl';
    } else if (resolvedSport === 'world-cup') {
      setPropsSport('world-cup');
      secondaryListSportRef.current = 'world-cup';
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
        noWorldCupOdds: warmSnapshot.noWorldCupOdds,
      };
      if (!urlSpecifiesSport) {
        setPropsSport(warmSnapshot.propsSport);
        if (warmSnapshot.propsSport === 'afl') secondaryListSportRef.current = 'afl';
        if (warmSnapshot.propsSport === 'world-cup') secondaryListSportRef.current = 'world-cup';
      }
      setPlayerProps(warmSnapshot.playerProps as PlayerProp[]);
      setAflProps(warmSnapshot.aflProps as PlayerProp[]);
      setWorldCupCombinedProps(warmSnapshot.worldCupCombinedProps as PlayerProp[]);
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
      paintedWcProps = warmSnapshot.worldCupCombinedProps as PlayerProp[];
      paintedNoAflOdds = warmSnapshot.noAflOdds;
      paintedNoWorldCupOdds = warmSnapshot.noWorldCupOdds;
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
          const wcPropsCached = WORLD_CUP_PUBLIC_ENABLED
            ? Array.isArray(parsed?.worldCup?.props)
              ? parsed.worldCup.props
              : []
            : [];
          const hasSnapshotData =
            nbaProps.length > 0 ||
            aflPropsCached.length > 0 ||
            aflGamesCached.length > 0 ||
            wcPropsCached.length > 0;
          if (hasSnapshotData) {
            let snapshotForApply: CombinedPropsSnapshotResponse = WORLD_CUP_PUBLIC_ENABLED
              ? parsed
              : {
                  ...parsed,
                  worldCup: {
                    ok: false,
                    status: 200,
                    lastUpdated: null,
                    nextUpdate: null,
                    ingestMessage: null,
                    noWorldCupOdds: true,
                    games: [],
                    props: [],
                  },
                };
            let wcHydrated = wcPropsCached;
            if (WORLD_CUP_PUBLIC_ENABLED && wcHydrated.length === 0) {
              const wcSession = hydrateWorldCupPropsFromSessionCache();
              if (wcSession.length > 0) {
                wcHydrated = wcSession;
                snapshotForApply = {
                  ...snapshotForApply,
                  worldCup: {
                    ok: true,
                    status: 200,
                    lastUpdated: snapshotForApply.worldCup?.lastUpdated ?? null,
                    nextUpdate: snapshotForApply.worldCup?.nextUpdate ?? null,
                    ingestMessage: snapshotForApply.worldCup?.ingestMessage ?? null,
                    noWorldCupOdds: false,
                    games: snapshotForApply.worldCup?.games ?? [],
                    props: wcSession,
                  },
                };
              }
            }
            applyCombinedSnapshot(snapshotForApply, {
              persistCaches: false,
              selectedGameIds: Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : undefined,
            });
            paintedNbaProps = nbaProps;
            paintedAflProps = aflPropsCached;
            paintedWcProps = wcHydrated;
            paintedNoAflOdds = parsed?.afl?.noAflOdds === true;
            paintedNoWorldCupOdds = parsed?.worldCup?.noWorldCupOdds === true;
            restoredNbaCache = nbaProps.length > 0;
            restoredAflCache = aflPropsCached.length > 0 || aflGamesCached.length > 0;
            const partialCombinedCache = (() => {
              const { missingAfl, missingWc } = combinedModeMissingSecondarySlice(
                aflPropsCached,
                wcHydrated,
                {
                  noAflOdds: parsed?.afl?.noAflOdds === true,
                  noWorldCupOdds: parsed?.worldCup?.noWorldCupOdds === true,
                }
              );
              return missingAfl || missingWc;
            })();
            if (partialCombinedCache) {
              setCombinedFetchComplete(false);
              restoredCombinedSnapshot = false;
            } else {
              restoredCombinedSnapshot = true;
            }
            if (worldCupBackNavSkipFetchPending()) {
              consumeWorldCupBackNavSkipFetch();
              setCombinedFetchComplete(true);
              setCombinedPropsLoading(false);
              setAflPropsLoading(false);
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

    // 4) AFL / World Cup: paint from fresh session cache immediately for instant back-nav experience.
    if (
      !warmSnapshot &&
      (sportParam === null ||
      sportParam === 'afl' ||
      sportParam === 'world-cup' ||
      sportParam === 'combined' ||
      sportParam === 'all')
    ) {
      let secondaryRestoreCanSkipFetch = false;
      let restoredWcCache = false;
      try {
        if (requiresCombinedFirstPaint) {
          const aflCached = readSecondaryPropsSessionCache('afl');
          const wcCached = WORLD_CUP_PUBLIC_ENABLED
            ? readSecondaryPropsSessionCache('world-cup')
            : { props: [], games: [], selectedGameIds: [], isFresh: false };

          const aflReady =
            aflCached.isFresh && (aflCached.props.length > 0 || aflCached.games.length > 0);
          const wcReady =
            !WORLD_CUP_PUBLIC_ENABLED || (wcCached.isFresh && wcCached.props.length > 0);

          // Combined mode: never paint AFL or WC alone — wait for both slices (or full combined snapshot).
          if (!restoredCombinedSnapshot && aflReady && wcReady) {
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

            setWorldCupCombinedProps(wcCached.props);
            paintedWcProps = wcCached.props;
            restoredWcCache = true;
          }
        } else if (!restoredCombinedSnapshot) {
          const secondaryCacheKey =
            sportParam === 'world-cup'
              ? WC_PROPS_CACHE_KEY
              : AFL_PROPS_CACHE_KEY;
          const raw = sessionStorage.getItem(secondaryCacheKey);
          if (raw) {
            const parsed = JSON.parse(raw) as {
              props?: PlayerProp[];
              games?: AflGameForProps[];
              selectedGameIds?: string[];
              timestamp?: number;
            };
            const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
            const isFresh = Number.isFinite(age) && age < AFL_PROPS_CACHE_TTL_MS;
            const cachedPropsRaw = Array.isArray(parsed?.props) ? parsed.props : [];
            const cachedProps =
              sportParam === 'world-cup'
                ? hydrateWorldCupPropsFromCacheRows(cachedPropsRaw)
                : cachedPropsRaw;
            const cachedGames = Array.isArray(parsed?.games) ? parsed.games : [];
            const hasPaintableSecondaryRows =
              sportParam === 'world-cup'
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
                }
              } else {
                setAflProps(cachedProps);
                const matchedGames = gamesMatchingProps(cachedProps, cachedGames);
                setAflGames(matchedGames);
                const selected = selectedGameIdsForProps(
                  cachedProps,
                  matchedGames,
                  Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : undefined
                );
                selectedAflGamesRef.current = selected;
                setSelectedAflGames(selected);
              }
              restoredAflCache = true;
              if (sportParam === 'afl' || sportParam === 'world-cup') {
                const listSport = sportParam === 'world-cup' ? 'world-cup' : 'afl';
                secondaryListSportRef.current = listSport;
                secondaryRestoreCanSkipFetch =
                  listSport !== 'world-cup' ||
                  !worldCupPropsMissingHistoricalStats(cachedProps) ||
                  worldCupBackNavSkipFetchPending();
                if (secondaryRestoreCanSkipFetch) {
                  secondarySkipFetchSportRef.current = listSport;
                  secondaryWarmHydrateRef.current = true;
                }
              }
            }
          }
        }
      } catch {
        // ignore cache parse errors
      }
      if (sportParam === 'afl' || sportParam === 'world-cup') {
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
        const hasCombinedPaint = combinedModeHasVisibleRows(
          paintedNbaProps,
          paintedAflProps,
          paintedWcProps
        );
        const { missingAfl, missingWc } = combinedModeMissingSecondarySlice(
          paintedAflProps,
          paintedWcProps,
          { noAflOdds: paintedNoAflOdds, noWorldCupOdds: paintedNoWorldCupOdds }
        );
        const combinedComplete = restoredCombinedSnapshot || (!missingAfl && !missingWc && hasCombinedPaint);
        setCombinedFetchComplete(combinedComplete);
        setCombinedPropsLoading(!hasCombinedPaint);
        setCombinedPaintUnlocked(
          restoredCombinedSnapshot ||
            isCombinedSecondaryPaintReady(paintedAflProps, paintedWcProps, {
              noAflOdds: paintedNoAflOdds,
              noWorldCupOdds: paintedNoWorldCupOdds,
            }) ||
            hasCombinedPaint
        );
        setPropsLoading(!hasCombinedPaint && paintedNbaProps.length === 0);
        setAflPropsLoading(!hasCombinedPaint && paintedAflProps.length === 0 && paintedWcProps.length === 0);
      }
      // 5) AFL team logos cache for instant logo-only matchup rendering.
      //    Prefer sessionStorage (fresh-this-tab), then fall back to localStorage so a
      //    fresh tab open still gets logos painted from cache instead of waiting on the API.
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
          // Warm every team logo URL up-front so matchups paint instantly the moment rows render.
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

  // Keep playerPropsRef in sync for 8-second no-props check
  useEffect(() => {
    playerPropsRef.current = playerProps;
  }, [playerProps]);

  // After 8 seconds of trying with no props, show "no props found come back later"
  useEffect(() => {
    const timer = setTimeout(() => {
      if (playerPropsRef.current.length === 0) {
        setShowNoPropsMessage(true);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  // Reset to first page and close popups whenever filters or sorting change (or sport)
  useEffect(() => {
    setCurrentPage(1);
    setOpenPopup(null); // Close any open popups
  }, [propLineSort, debouncedSearchQuery, selectedBookmakers, selectedPropTypes, selectedGames, columnSort, propsSport]);
  
  // Helper function to cycle column sort: none -> asc -> desc -> none
  // When a column is clicked, clear all other column sorts (only one column sorted at a time)
  const handleColumnSort = (column: string) => {
    setColumnSort(prev => {
      const current = prev[column] || 'none';
      const next = current === 'none' ? 'asc' : current === 'asc' ? 'desc' : 'none';
      // Reset all columns to 'none', then set the clicked column
      const newSort: Record<string, 'none' | 'asc' | 'desc'> = {
        dvp: 'none',
        l5: 'none',
        l10: 'none',
        h2h: 'none',
        wc: 'none',
        season: 'none',
        streak: 'none',
        ip: 'none',
      };
      newSort[column] = next;
      return newSort;
    });
  };
  
  // Close popup on ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenPopup(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  // Kick non-pro users when subscription is checked and games (cache) have loaded
  useEffect(() => {
    if (subscriptionChecked && !isPro && !gamesLoading) {
      router.replace('/home#pricing');
    }
  }, [subscriptionChecked, isPro, gamesLoading, router]);

  useEffect(() => {
    if (!mounted || !subscriptionChecked || !isPro || !surveyStorageKey || !viewerId) {
      return;
    }

    if (isSurveyClosed) {
      setSurveyOpen(false);
      return;
    }

    let cancelled = false;

    const checkSurveyStatus = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken || cancelled) {
          return;
        }

        const response = await fetch('/api/props-sport-survey?view=status', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'include',
        });

        const payload = await response.json().catch(() => null);
        const hasAnswered = Boolean(payload?.hasAnswered);
        const selectedSport = payload?.selectedSport;

        if (surveyStorageKey && hasAnswered && selectedSport && typeof selectedSport === 'string') {
          try {
            localStorage.setItem(
              surveyStorageKey,
              JSON.stringify({
                selectedSport,
                submittedAt: payload?.answeredAt ?? new Date().toISOString(),
              })
            );
          } catch {
            // Ignore storage errors.
          }
        }

        if (!cancelled) {
          setSurveyOpen(!hasAnswered && !Boolean(payload?.isClosed));
        }
      } catch {
        try {
          const savedVote = localStorage.getItem(surveyStorageKey);
          if (!cancelled) {
            setSurveyOpen(!savedVote);
          }
        } catch {
          if (!cancelled) {
            setSurveyOpen(true);
          }
        }
      }
    };

    checkSurveyStatus();

    return () => {
      cancelled = true;
    };
  }, [mounted, subscriptionChecked, isPro, surveyStorageKey, viewerId, isSurveyClosed]);

  useEffect(() => {
    if (!surveyOpen || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [surveyOpen]);

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

  // Fetch games (today plus nearby) to keep props-linked games selected across date boundaries
  // OPTIMIZATION: Pre-fetch games immediately and cache them for dashboard
  useEffect(() => {
    const fetchTodaysGames = async () => {
      const { start, end } = getDashboardGamesDateRange();
      const cacheKey = getDashboardGamesCacheKey();

      const refreshGamesInBackground = () => {
        fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`, { cache: 'default' })
          .then(async (response) => {
            if (response.ok) {
              const data = await response.json();
              if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
                setTodaysGames(data.data);
                const dataString = JSON.stringify(data.data);
                safeSetSessionStorage(cacheKey, dataString);
                safeSetSessionStorage(`${cacheKey}-timestamp`, Date.now().toString());
              }
            }
          })
          .catch(() => {});
      };

      try {
        const cachedGames = readDashboardGamesFromSessionCache();
        if (cachedGames) {
          setTodaysGames(cachedGames);
          setGamesLoading(false);
          refreshGamesInBackground();
          return;
        }

        if (todaysGamesRef.current.length > 0) {
          setGamesLoading(false);
          return;
        }

        setGamesLoading(true);

        const response = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`);
        const data = await response.json();
        const games = Array.isArray(data?.data) ? data.data : [];
        
        setTodaysGames(games);
        
        // Cache games for dashboard (same format as dashboard uses)
        if (typeof window !== 'undefined' && games.length > 0) {
          const gamesString = JSON.stringify(games);
          safeSetSessionStorage(cacheKey, gamesString);
          safeSetSessionStorage(`${cacheKey}-timestamp`, Date.now().toString());
          // Debug logging removed(`✅ Cached ${games.length} games for dashboard pre-fetch`);
        }
      } catch (error) {
        console.error('Error fetching games:', error);
        setTodaysGames([]);
      } finally {
        setGamesLoading(false);
      }
    };

    fetchTodaysGames();

    // Preload AFL + World Cup list in background for sessionStorage (WC was missing — caused AFL→WC skeleton flash).
    const preloadSecondaryPropsCache = async (sport: 'afl' | 'world-cup') => {
      if (sport === 'world-cup' && !WORLD_CUP_PUBLIC_ENABLED) return;
      try {
        if (typeof window === 'undefined') return;
        const cacheKey = getSecondaryPropsCacheKey(sport);
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { timestamp?: number; props?: unknown[]; games?: unknown[] };
          const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
          const hasData =
            (Array.isArray(parsed?.props) && parsed.props.length > 0) ||
            (Array.isArray(parsed?.games) && parsed.games.length > 0);
          if (age < AFL_PROPS_CACHE_TTL_MS && hasData) return;
        }
        const listUrl = getSecondaryPropsListUrl(sport, false);
        const listRes = await fetchSecondaryPropsList(listUrl);
        const listData = await listRes.json();
        const { games, aggregated } = aggregateSecondaryListPayload(listData, sport);
        if (listData.noAflOdds === true || listData.noWorldCupOdds === true) {
          if (aggregated.length === 0 && games.length === 0) {
            try {
              sessionStorage.removeItem(cacheKey);
            } catch {
              // Ignore
            }
          }
        } else if (aggregated.length > 0 || games.length > 0) {
          const toCache = {
            props: aggregated,
            games,
            selectedGameIds: getSelectedAflGameIdsForCache(games.length > 0 ? games.map((g) => g.gameId) : []),
            timestamp: Date.now(),
          };
          sessionStorage.setItem(cacheKey, JSON.stringify(toCache));
        }
      } catch {
        // Ignore; tab will fetch when selected
      }
    };

    (async () => {
      try {
        if (typeof window !== 'undefined') {
          const sportParam = new URL(window.location.href).searchParams.get('sport');
          if (sportParam === 'nba') {
            void preloadSecondaryPropsCache('afl');
            void preloadSecondaryPropsCache('world-cup');
            return;
          }
          if (sportParam === 'afl') {
            void preloadSecondaryPropsCache('afl');
            return;
          }
          if (sportParam === 'world-cup') {
            void preloadSecondaryPropsCache('world-cup');
            return;
          }
          // combined/all: /api/props/combined fetches AFL+WC — skip redundant list preloads.
        }
      } catch {
        // Ignore
      }
    })();
  }, []);

  // Fetch AFL / World Cup games + player props when sport is AFL or World Cup only.
  // Combined mode loads all sports from /api/props/combined.
  useEffect(() => {
    if (propsSport !== 'afl' && propsSport !== 'world-cup') return;
    if (skipPropsRefetchOnceRef.current) {
      skipPropsRefetchOnceRef.current = false;
      setSecondaryPropsFetchComplete(true);
      setAflPropsLoading(false);
      return;
    }
    const listSport: 'afl' | 'world-cup' = propsSport === 'world-cup' ? 'world-cup' : 'afl';
    secondaryListSportRef.current = listSport;
    const cacheKey = getSecondaryPropsCacheKey(listSport);
    let cancelled = false;
    let hadNonEmptyFresh = false;
    const hasVisibleSecondaryRows =
      listSport === 'world-cup'
        ? filterWorldCupListProps(aflProps).length > 0
        : aflProps.length > 0 || aflGames.length > 0;
    const canReplaceSecondaryProps = (aggregated: PlayerProp[]) =>
      aggregated.length > 0 || !hasVisibleSecondaryRows;

    const secondaryWarmHydrateCanSkipFetch = (): boolean => {
      const hasListRows =
        listSport === 'world-cup'
          ? filterWorldCupListProps(aflProps).length > 0
          : aflProps.some((p) => !isWorldCupSoccerPropStatType(p.statType));
      if (!hasListRows) return false;
      if (listSport === 'world-cup' && worldCupPropsMissingHistoricalStats(aflProps)) {
        return worldCupBackNavSkipFetchPending();
      }
      if (listSport === 'afl' && aflPropsMissingHistoricalStats(aflProps)) {
        return false;
      }
      return true;
    };

    const backNavSilentRefresh =
      listSport === 'world-cup' && consumeWorldCupBackNavSkipFetch() && hasVisibleSecondaryRows;
    if (backNavSilentRefresh) {
      setSecondaryPropsFetchComplete(true);
      setAflPropsLoading(false);
    } else if (secondaryWarmHydrateRef.current && secondarySkipFetchSportRef.current === listSport) {
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
      setAflProps(props);
    };

    if (!backNavSilentRefresh && !hasVisibleSecondaryRows) {
      setSecondaryPropsFetchComplete(false);
      setAflPropsLoading(true);
    }
    const doFetch = async (): Promise<{ games: AflGameForProps[]; aggregated: PlayerProp[]; ingestMessage?: string; lastUpdated?: string; nextUpdate?: string; noAflOdds?: boolean }> => {
      const inFlight = aflListFetchInFlightRef.current;
      if (inFlight && inFlight.sport === listSport) {
        return inFlight.promise;
      }
      const debugStats = typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('debugStats') === '1';
      const listUrl = getSecondaryPropsListUrl(listSport, debugStats);
      const requestPromise = (async () => {
        if (listSport === 'world-cup') {
          const { response: listRes, payload: listData } = await fetchWorldCupPlayerPropsListDeduped();
          if (cancelled) return { games: [], aggregated: [], noAflOdds: false };
          if (!cancelled && debugStats && listData && typeof listData === 'object' && '_meta' in (listData as object)) {
            setAflListDebugMeta((listData as { _meta: Record<string, unknown> })._meta);
          }
          if (!cancelled && !debugStats) setAflListDebugMeta(null);
          if (!listRes.ok || listData == null) return { games: [], aggregated: [], noAflOdds: false };
          return aggregateSecondaryListPayload(listData, listSport);
        }
        const listRes = await fetchSecondaryPropsList(listUrl);
        if (cancelled) return { games: [], aggregated: [], noAflOdds: false };
        const listData = await listRes.json();
        if (!cancelled && debugStats && listData._meta) setAflListDebugMeta(listData._meta as Record<string, unknown>);
        if (!cancelled && !debugStats) setAflListDebugMeta(null);
        return aggregateSecondaryListPayload(listData, listSport);
      })();
      aflListFetchInFlightRef.current = { sport: listSport, promise: requestPromise };
      try {
        return await requestPromise;
      } finally {
        if (aflListFetchInFlightRef.current?.sport === listSport && aflListFetchInFlightRef.current.promise === requestPromise) {
          aflListFetchInFlightRef.current = null;
        }
      }
    };
    (async () => {
      try {
        let result = await doFetch();
        if (cancelled || secondaryListSportRef.current !== listSport) return;
        if (result.noAflOdds) {
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
        if (
          listSport === 'afl' &&
          aggregated.length > 0 &&
          aflPropsMissingHistoricalStats(aggregated)
        ) {
          const backfilled = await backfillAflPropStatsBatch(aggregated);
          if (backfilled) propsToCommit = backfilled;
        }
        if (propsToCommit.length > 0) hadNonEmptyFresh = true;

        // Retry once when empty and we never got props this run (transient failure or cache expiry)
        if (propsToCommit.length === 0 && !hadNonEmptyFresh && !cancelled && (listSport === 'afl' || listSport === 'world-cup')) {
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
                sessionStorage.setItem(cacheKey, JSON.stringify({
                  props: retryAggregated,
                  games: retryGames,
                  selectedGameIds: getSelectedAflGameIdsForCache(
                    retryGames.length > 0 ? retryGames.map((g) => g.gameId) : []
                  ),
                  timestamp: Date.now(),
                }));
              } catch {
                // Ignore
              }
            }
          }
          if (!cancelled && retryAggregated.length === 0) {
            // Retry list fetch so we pick up data when cron has run. Never call odds refresh from the client
            // (AFL refresh runs execSync(build-afl-dvp); WC refresh hits API-Football). List polls are cache-read only.
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
                    sessionStorage.setItem(cacheKey, JSON.stringify({
                      props: res.aggregated,
                      games: res.games,
                      selectedGameIds: getSelectedAflGameIdsForCache(
                        res.games.length > 0 ? res.games.map((g) => g.gameId) : []
                      ),
                      timestamp: Date.now(),
                    }));
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
        // Keep visible rows when WC stats filter yields empty on first response (AFL does not hit this).
        if (canReplaceSecondaryProps(propsToCommit)) {
          commitSecondaryProps(propsToCommit);
          if (games.length > 0) {
            syncSelectedAflGames(games.map((g) => g.gameId));
          }
          if (!cancelled) {
            setAflIngestMessage(result.ingestMessage ?? null);
            setAflLastUpdated(result.lastUpdated ?? null);
            try {
              const toCache = {
                props: propsToCommit,
                games,
              selectedGameIds: getSelectedAflGameIdsForCache(
                games.length > 0 ? games.map((g) => g.gameId) : []
              ),
                timestamp: Date.now(),
              };
              if (listSport !== 'afl' || !aflPropsMissingHistoricalStats(propsToCommit)) {
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
      } catch (e) {
        if (!cancelled && !hadNonEmptyFresh && !hasVisibleSecondaryRows && secondaryListSportRef.current === listSport) {
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
      if (aflListFetchInFlightRef.current?.sport === listSport) {
        aflListFetchInFlightRef.current = null;
      }
      aflRetryTimeoutsRef.current.forEach((id) => clearTimeout(id));
      aflRetryTimeoutsRef.current = [];
    };
  }, [propsSport, aflPropsRetryKey, aggregateSecondaryListPayload, setSecondaryPropsFetchComplete]);

  // Persist AFL / World Cup props + game filter to sessionStorage when user changes selection (so returning from dashboard restores filter)
  useEffect(() => {
    if (!isSecondaryPropsSport(propsSport) || aflProps.length === 0) return;
    if (propsSport === 'afl' && aflGames.length === 0) return;
    const propsToCache =
      propsSport === 'world-cup' ? filterWorldCupListProps(aflProps) : aflProps;
    if (propsToCache.length === 0) return;
    try {
      const toCache = {
        props: propsToCache,
        games: aflGames,
        selectedGameIds: Array.from(selectedAflGames),
        timestamp: Date.now(),
      };
      sessionStorage.setItem(getSecondaryPropsCacheKey(propsSport), JSON.stringify(toCache));
    } catch {
      // Ignore quota etc.
    }
  }, [propsSport, aflProps, aflGames, selectedAflGames]);

  // Find-player modal: use exact same search as AFL dashboard (fetchPlayers + client-side filter)
  useEffect(() => {
    if (!findPlayerOpen) return;
    const q = findPlayerQuery.trim();
    if (!q || q.length < 2) {
      setFindPlayerResults([]);
      return;
    }
    if (findPlayerDebounceRef.current) clearTimeout(findPlayerDebounceRef.current);
    findPlayerDebounceRef.current = setTimeout(async () => {
      findPlayerDebounceRef.current = null;
      setFindPlayerLoading(true);
      try {
        if (propsSport === 'afl') {
          // Match dashboard exactly: same API, same mapping, same client filter. Request limit 100 so API returns full set (dashboard gets 60 for single-word via effectiveLimit; we ask 100 to get everything).
          const params = new URLSearchParams({ query: q, limit: '100' });
          const res = await fetch(`/api/afl/players?${params.toString()}`, { cache: 'no-store' });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data?.error || 'Failed to load players');
          }
          const list = Array.isArray(data?.players) ? data.players : [];
          const searchResults = list.map((p: Record<string, unknown>) => ({
            name: String(p?.name ?? '-'),
            team: typeof p?.team === 'string' ? p.team : undefined,
          }));
          // Same client-side filter as dashboard: name.includes(q) — show all matches (dashboard slices to 12 for dropdown; we show all)
          const qLower = q.toLowerCase();
          const filtered = searchResults.filter((p: { name: string; team?: string }) =>
            (p.name ?? '').toLowerCase().includes(qLower)
          );
          setFindPlayerResults(filtered);
        } else {
          const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(q)}&per_page=25`, { cache: 'no-store' });
          const data = await res.json();
          let list = Array.isArray(data?.results) ? data.results : [];
          list = list.map((p: { full?: string; team?: string }) => ({ name: String(p?.full ?? ''), team: p?.team }));
          const qLower = q.toLowerCase();
          list = list.filter((p: { name: string; team?: string }) => (p.name || '').toLowerCase().includes(qLower));
          setFindPlayerResults(list.slice(0, 25));
        }
      } catch {
        setFindPlayerResults([]);
      } finally {
        setFindPlayerLoading(false);
      }
    }, 250);
    return () => {
      if (findPlayerDebounceRef.current) clearTimeout(findPlayerDebounceRef.current);
    };
  }, [findPlayerOpen, findPlayerQuery, propsSport]);

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
      // Fall back to longer-lived localStorage mirror so refreshed/new tabs still paint logos
      // from cache (sessionStorage is scoped per-tab).
      if (!cachedMap) {
        const lsRaw = localStorage.getItem(AFL_TEAM_LOGOS_LS_KEY);
        const lsTsRaw = localStorage.getItem(AFL_TEAM_LOGOS_LS_TS_KEY);
        const lsTs = lsTsRaw ? parseInt(lsTsRaw, 10) : 0;
        const lsAge = Number.isFinite(lsTs) ? Date.now() - lsTs : Infinity;
        if (lsRaw && lsAge < AFL_TEAM_LOGOS_LS_TTL_MS) {
          const parsed = JSON.parse(lsRaw);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            cachedMap = parsed as Record<string, string>;
            // Re-seed session cache for the rest of this tab's lifetime.
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

    // If we already have fresh cached logos, avoid unnecessary fetch on quick back-nav.
    if (hasFreshCache) return;

    fetch('/api/afl/team-logos', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { logos?: Record<string, string> } | null) => {
        if (data?.logos && typeof data.logos === 'object' && Object.keys(data.logos).length > 0) {
          setAflLogoByTeam(data.logos);
          // Warm every logo URL the moment we know it so rows paint without a per-image delay.
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

  // Helper to check if a bookmaker is a pick'em/DFS-only bookmaker
  const isPickemBookmaker = (name: string): boolean => {
    const lower = (name || '').toLowerCase();
    const pickemBookmakers = ['draftkings pick6', 'pick6', 'prizepicks', 'prize picks', 'underdog fantasy', 'underdog'];
    return pickemBookmakers.some(key => lower.includes(key));
  };

  // Helper function to get player ID from player name (moved before useEffect for accessibility)
  const getPlayerIdFromName = (playerName: string): string | null => {
    const mapping = PLAYER_ID_MAPPINGS.find(m => 
      m.name.toLowerCase() === playerName.toLowerCase() ||
      m.name.toLowerCase().includes(playerName.toLowerCase()) ||
      playerName.toLowerCase().includes(m.name.toLowerCase())
    );
    // Use bdlId (not nbaId) because /api/stats uses Ball Don't Lie API
    return mapping?.bdlId || null;
  };

  // Pre-load team data in background (non-blocking)
  const preloadTeamData = async (teams: string[], season: number) => {
    if (!teams || teams.length === 0) return;
    
    // Debug logging removed(`[NBA Landing] 🚀 Starting background pre-load for ${teams.length} teams...`);
    
    // Pre-load league-wide data first (only need to fetch once)
    const leagueWidePromises = [
      // Team defensive rankings (shot chart) - returns all teams
      fetch(`/api/team-defense-rankings?season=${season}`, { cache: 'default' }).catch(() => {}),
    ];
    await Promise.all(leagueWidePromises);
    
    // Pre-load team-specific data in batches
    const batchSize = 3;
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize);
      
      // Pre-load all team data in parallel for this batch
      const promises = batch.flatMap(team => [
        // Team tracking stats (passing)
        fetch(`/api/tracking-stats/team?team=${team}&season=${season}&category=passing`, { cache: 'default' }).catch(() => {}),
        // Team tracking stats (rebounding)
        fetch(`/api/tracking-stats/team?team=${team}&season=${season}&category=rebounding`, { cache: 'default' }).catch(() => {}),
        // Team tracking stats (last 5 games - passing)
        fetch(`/api/tracking-stats/team?team=${team}&season=${season}&category=passing&lastNGames=5`, { cache: 'default' }).catch(() => {}),
        // Team tracking stats (last 5 games - rebounding)
        fetch(`/api/tracking-stats/team?team=${team}&season=${season}&category=rebounding&lastNGames=5`, { cache: 'default' }).catch(() => {}),
      ]);
      
      await Promise.all(promises);
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < teams.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    
    // Debug logging removed(`[NBA Landing] ✅ Finished pre-loading team data for ${teams.length} teams`);
  };

  // Track if props are loaded (to prevent clearing on refresh)
  // Initialize to false - will be set to true when props are loaded
  // Note: We removed initialState check to prevent hydration mismatch
  
  // Helper function to safely set sessionStorage with size check
  const safeSetSessionStorage = (key: string, value: string): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      // Check size before storing (rough estimate: 1 char ≈ 1 byte for JSON)
      const estimatedSize = value.length;
      if (estimatedSize > SESSION_STORAGE_MAX_SIZE) {
        console.warn(`[NBA Landing] Data too large for sessionStorage (${estimatedSize} bytes):`, key);
        return false;
      }
      sessionStorage.setItem(key, value);
      return true;
    } catch (e: any) {
      // Handle QuotaExceededError specifically
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn(`[NBA Landing] SessionStorage quota exceeded for key:`, key);
      } else {
        console.warn(`[NBA Landing] Failed to set sessionStorage:`, key, e);
      }
      return false;
    }
  };

  useEffect(() => {
    if (propsSport !== 'combined') return;

    const partialRefetchFlags = () => ({
      wc: combinedPartialWcRefetchAttemptedRef.current,
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
      worldCup: slice.worldCup ?? {
        ok: combinedModeHasWcRows(worldCupCombinedPropsRef.current),
        status: 200,
        lastUpdated: null,
        nextUpdate: null,
        ingestMessage: null,
        noWorldCupOdds: combinedOddsFlagsRef.current.noWorldCupOdds,
        games: [],
        props: worldCupCombinedPropsRef.current,
      },
    });

    const mergeWorldCupListResponse = (
      wcPayload: unknown,
      wcResponse: Response
    ): boolean => {
      const wcResult = aggregateSecondaryListPayload(wcPayload, 'world-cup');
      if (wcResult.aggregated.length > 0) {
        applyCombinedSnapshot(
          buildProgressiveSnapshot({
            worldCup: {
              ok: true,
              status: wcResponse.status,
              lastUpdated: wcResult.lastUpdated ?? null,
              nextUpdate: wcResult.nextUpdate ?? null,
              ingestMessage: wcResult.ingestMessage ?? null,
              noWorldCupOdds: false,
              games: wcResult.games,
              props: wcResult.aggregated,
            },
          }),
          { persistCaches: false }
        );
        combinedOddsFlagsRef.current = {
          ...combinedOddsFlagsRef.current,
          noWorldCupOdds: false,
        };
        return true;
      }
      if (worldCupListConfirmsNoOdds(wcPayload)) {
        combinedOddsFlagsRef.current = {
          ...combinedOddsFlagsRef.current,
          noWorldCupOdds: true,
        };
        return true;
      }
      return false;
    };

    const launchNbaProgressiveFetch = (debugStats: boolean) => {
      if (NBA_PUBLIC_ENABLED && playerPropsRef.current.length === 0) {
        void fetch('/api/nba/player-props', { cache: 'default' }).then(async (nbaResponse) => {
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
        }).catch(() => {});
      }
    };

    const mergeWcListIntoCombinedSnapshot = (
      payload: CombinedPropsSnapshotResponse,
      wcPayload: unknown,
      wcResponse: Response
    ): CombinedPropsSnapshotResponse => {
      const wcResult = aggregateSecondaryListPayload(wcPayload, 'world-cup');
      if (wcResult.aggregated.length === 0) return payload;
      return {
        ...payload,
        worldCup: {
          ok: true,
          status: wcResponse.status,
          lastUpdated: wcResult.lastUpdated ?? payload.worldCup?.lastUpdated ?? null,
          nextUpdate: wcResult.nextUpdate ?? payload.worldCup?.nextUpdate ?? null,
          ingestMessage: wcResult.ingestMessage ?? payload.worldCup?.ingestMessage ?? null,
          noWorldCupOdds: wcResult.noAflOdds === true,
          games: wcResult.games,
          props: wcResult.aggregated,
        },
      };
    };

    const refillMissingSecondarySlices = async (
      payload: CombinedPropsSnapshotResponse,
      debugStats: boolean
    ) => {
      const mergedAfl = preferAflPropsForCombined(
        aflPropsRef.current,
        Array.isArray(payload?.afl?.props) ? payload.afl.props : []
      );
      const mergedWc = preferWorldCupPropsWithHistoricalStats(
        worldCupCombinedPropsRef.current,
        Array.isArray(payload?.worldCup?.props) ? payload.worldCup.props : []
      );
      const oddsFlags = {
        noAflOdds: payload?.afl?.noAflOdds === true && mergedAfl.length === 0,
        noWorldCupOdds: payload?.worldCup?.noWorldCupOdds === true && mergedWc.length === 0,
      };
      const { missingAfl, missingWc } = combinedModeMissingSecondarySlice(
        mergedAfl,
        mergedWc,
        oddsFlags
      );

      if (missingWc && !combinedPartialWcRefetchAttemptedRef.current && WORLD_CUP_PUBLIC_ENABLED) {
        try {
          const { response: wcResponse, payload: wcPayload } = await fetchWorldCupPlayerPropsListDeduped();
          if (wcPayload != null && mergeWorldCupListResponse(wcPayload, wcResponse)) {
            combinedPartialWcRefetchAttemptedRef.current = true;
          }
        } catch {
          // Allow retry on a later pass.
        }
      }

      if (missingAfl && !combinedPartialAflRefetchAttemptedRef.current) {
        try {
          const aflUrl = debugStats ? '/api/afl/player-props/list?debugStats=1' : '/api/afl/player-props/list';
          const aflResponse = await fetch(aflUrl, { cache: 'no-store' });
          const aflPayload = await aflResponse.json();
          const aflResult = aggregateAflListPayload(aflPayload);
          let aflPropsForSnapshot = aflResult.aggregated;
          if (aflPropsForSnapshot.length > 0 && aflPropsMissingHistoricalStats(aflPropsForSnapshot)) {
            const backfilled = await backfillAflPropStatsBatch(aflPropsForSnapshot);
            if (backfilled) aflPropsForSnapshot = backfilled;
          }
          if (aflPropsForSnapshot.length > 0) {
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
        !missingAfl &&
        mergedAfl.length > 0 &&
        aflPropsMissingHistoricalStats(mergedAfl) &&
        !combinedPartialAflRefetchAttemptedRef.current
      ) {
        try {
          const aflUrl = debugStats ? '/api/afl/player-props/list?debugStats=1' : '/api/afl/player-props/list';
          const aflResponse = await fetch(aflUrl, { cache: 'no-store' });
          const aflPayload = await aflResponse.json();
          const aflResult = aggregateAflListPayload(aflPayload);
          let aflPropsForSnapshot = aflResult.aggregated;
          if (aflPropsForSnapshot.length > 0 && aflPropsMissingHistoricalStats(aflPropsForSnapshot)) {
            const backfilled = await backfillAflPropStatsBatch(aflPropsForSnapshot);
            if (backfilled) aflPropsForSnapshot = backfilled;
          }
          if (aflPropsForSnapshot.length > 0 && !aflPropsMissingHistoricalStats(aflPropsForSnapshot)) {
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
          // ignore AFL stats refill errors
        }
        combinedPartialAflRefetchAttemptedRef.current = true;
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
          worldCupCombinedPropsRef.current
        ) &&
        !combinedModeNeedsDataRefresh(
          playerPropsRef.current,
          aflPropsRef.current,
          worldCupCombinedPropsRef.current,
          partialRefetchFlags(),
          combinedOddsFlagsRef.current
        )
      ) {
        setCombinedPropsLoading(false);
        setPropsLoading(false);
        setAflPropsLoading(false);
        setCombinedPaintUnlocked(
          isCombinedSecondaryPaintReady(
            aflPropsRef.current,
            worldCupCombinedPropsRef.current,
            combinedOddsFlagsRef.current
          )
        );
        return;
      }

      if (combinedWarmToggleRef.current && !forceRefresh && !debugStats) {
        combinedWarmToggleRef.current = false;
        if (
          !combinedModeNeedsDataRefresh(
            playerPropsRef.current,
            aflPropsRef.current,
            worldCupCombinedPropsRef.current,
            partialRefetchFlags(),
            combinedOddsFlagsRef.current
          )
        ) {
          setCombinedPaintUnlocked(
            isCombinedSecondaryPaintReady(
              aflPropsRef.current,
              worldCupCombinedPropsRef.current,
              combinedOddsFlagsRef.current
            )
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
          worldCupCombinedPropsRef.current
        );

      if (!hasWarmCombinedCache) {
        setCombinedPaintUnlocked(false);
        setCombinedPropsLoading(true);
        setPropsLoading(true);
        setAflPropsLoading(true);
      }

      if (NBA_PUBLIC_ENABLED && playerPropsRef.current.length === 0) {
        launchNbaProgressiveFetch(debugStats);
      }

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
            cache: forceRefresh || debugStats ? 'no-store' : 'default',
          });
          payload = (await response.json().catch(() => null)) as CombinedPropsSnapshotResponse | null;
          if (
            !response.ok ||
            !payload?.success ||
            (!payload?.nba?.ok && !payload?.afl?.ok && (!WORLD_CUP_PUBLIC_ENABLED || !payload?.worldCup?.ok))
          ) {
            throw new Error(payload?.error || 'Failed to load combined props');
          }
        } else if (
          !payload?.success ||
          (!payload?.nba?.ok && !payload?.afl?.ok && (!WORLD_CUP_PUBLIC_ENABLED || !payload?.worldCup?.ok))
        ) {
          throw new Error(payload?.error || 'Failed to load combined props');
        }

        applyCombinedSnapshot(payload);
        void refillMissingSecondarySlices(payload, debugStats);
        const completeAfterSnapshot = !combinedModeNeedsDataRefresh(
          playerPropsRef.current,
          aflPropsRef.current,
          worldCupCombinedPropsRef.current,
          partialRefetchFlags(),
          combinedOddsFlagsRef.current
        );
        setCombinedFetchComplete(completeAfterSnapshot);
        setCombinedPropsLoading(!completeAfterSnapshot);
        setPropsLoading(!completeAfterSnapshot && playerPropsRef.current.length === 0);
        setAflPropsLoading(
          !completeAfterSnapshot &&
            !combinedModeHasVisibleRows([], aflPropsRef.current, worldCupCombinedPropsRef.current)
        );
      } catch (error) {
        console.warn('[Props] Combined payload fetch failed, falling back to direct parallel requests:', error);
        try {
          const wcFetchPromise = WORLD_CUP_PUBLIC_ENABLED
            ? fetchSecondaryPropsList('/api/world-cup/dashboard?playerPropsList=1')
            : Promise.resolve(
                new Response(
                  JSON.stringify({
                    success: true,
                    games: [],
                    data: [],
                    noWorldCupOdds: true,
                    noAflOdds: true,
                  }),
                  { status: 200, headers: { 'Content-Type': 'application/json' } }
                )
              );
          const [nbaResponse, aflResponse, wcResponse] = await Promise.all([
            NBA_PUBLIC_ENABLED
              ? fetch('/api/nba/player-props', { cache: forceRefresh ? 'no-store' : 'default' })
              : Promise.resolve(
                  new Response(JSON.stringify({ success: true, data: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                  })
                ),
            fetch(debugStats ? '/api/afl/player-props/list?debugStats=1' : '/api/afl/player-props/list', { cache: 'no-store' }),
            wcFetchPromise,
          ]);
          const [nbaPayload, aflPayload, wcPayload] = await Promise.all([
            nbaResponse.json().catch(() => null),
            aflResponse.json().catch(() => null),
            wcResponse.json().catch(() => null),
          ]);
          if (!nbaResponse.ok && !aflResponse.ok && !wcResponse.ok) {
            throw new Error('Fallback combined props requests failed');
          }
          const aflResult = aggregateAflListPayload(aflPayload);
          const wcResult = aggregateSecondaryListPayload(wcPayload, 'world-cup');
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
              props: nbaResponse.ok && Array.isArray(nbaPayload?.data) ? nbaPayload.data as PlayerProp[] : [],
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
            worldCup: {
              ok: wcResponse.ok,
              status: wcResponse.status,
              lastUpdated: wcResult.lastUpdated ?? null,
              nextUpdate: wcResult.nextUpdate ?? null,
              ingestMessage: wcResult.ingestMessage ?? null,
              noWorldCupOdds: wcResult.noAflOdds === true,
              games: wcResult.games,
              props: wcResult.aggregated,
            },
          });
          combinedPartialWcRefetchAttemptedRef.current = true;
          combinedPartialAflRefetchAttemptedRef.current = true;
          setCombinedFetchComplete(true);
        } catch (fallbackError) {
          console.error('[Props] Failed to load combined props:', fallbackError);
          setCombinedFetchComplete(
            combinedModeHasVisibleRows(
              playerPropsRef.current,
              aflPropsRef.current,
              worldCupCombinedPropsRef.current
            )
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
  }, [aggregateAflListPayload, aggregateSecondaryListPayload, applyCombinedSnapshot, propsSport, setCombinedFetchComplete]);

  // Restore games from sessionStorage when switching sport or returning from a dashboard
  useEffect(() => {
    const cachedGames = readDashboardGamesFromSessionCache();
    if (cachedGames) {
      setTodaysGames((prev) => (prev.length > 0 ? prev : cachedGames));
      setGamesLoading(false);
    }

    if (propsSport !== 'afl' && propsSport !== 'combined') return;
    if (aflGames.length > 0) return;
    try {
      const raw = sessionStorage.getItem(AFL_PROPS_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { games?: AflGameForProps[]; timestamp?: number };
      const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
      const cachedAflGames = Array.isArray(parsed?.games) ? parsed.games : [];
      if (age < AFL_PROPS_CACHE_TTL_MS && cachedAflGames.length > 0) {
        setAflGames(cachedAflGames);
      }
    } catch {
      // ignore cache parse errors
    }
  }, [propsSport, aflGames.length]);

  // Rehydrate games from sessionStorage when returning from a dashboard without remounting
  useEffect(() => {
    const restoreGamesIfNeeded = () => {
      const cachedGames = readDashboardGamesFromSessionCache();
      if (!cachedGames) return;
      setTodaysGames((prev) => (prev.length > 0 ? prev : cachedGames));
      setGamesLoading(false);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        restoreGamesIfNeeded();
      }
    };

    window.addEventListener('pageshow', restoreGamesIfNeeded);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', restoreGamesIfNeeded);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Fetch player props with good win chances from BDL
  useEffect(() => {
    if (propsSport !== 'nba') {
      if (propsSport === 'combined') {
        return;
      }
      setPropsLoading(false);
      return;
    }

    // Cache keys (defined outside functions so they're accessible to both fetchPlayerProps and checkOddsUpdate)
    const CACHE_KEY = 'nba-player-props-cache';
    const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
    
    const fetchPlayerProps = async () => {
      try {
        // Check sessionStorage first for instant load when navigating back
        
        const urlParams = new URLSearchParams(window.location.search);
        const forceRefresh = urlParams.get('refresh') === '1';
        
        // If force refresh, clear sessionStorage to ensure fresh data
        if (forceRefresh && typeof window !== 'undefined') {
          try {
            sessionStorage.removeItem(CACHE_KEY);
            sessionStorage.removeItem(CACHE_TIMESTAMP_KEY);
            // Debug logging removed('[NBA Landing] 🧹 Cleared sessionStorage for force refresh');
          } catch (e) {
            console.warn('[NBA Landing] Failed to clear sessionStorage:', e);
          }
        }
        
        // Define cacheUrl early so it's available in all code paths
        const cacheUrl = '/api/nba/player-props';
        
        // If we already have props from useLayoutEffect cache or prior load, just refresh in background
        if (propsLoadedRef.current) {
          // Debug logging removed(`[NBA Landing] ✅ Props already loaded from initialization (${playerProps.length} props), refreshing in background...`);
          // Refresh in background without showing loading state
          fetch(cacheUrl, { cache: forceRefresh ? 'no-store' : 'default' }).then(async (response) => {
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
                setPlayerProps(data.data);
                if (typeof window !== 'undefined') {
                  const dataString = JSON.stringify(data.data);
                  safeSetSessionStorage(CACHE_KEY, dataString);
                  safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
                }
              }
            }
          }).catch(() => {});
          return; // Skip the main fetch, props are already displayed
        }
        
        if (!forceRefresh && typeof window !== 'undefined') {
          const cachedData = sessionStorage.getItem(CACHE_KEY);
          const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
          
          if (cachedData && cachedTimestamp) {
            const age = Date.now() - parseInt(cachedTimestamp, 10);
            if (age < CACHE_TTL_MS) {
              try {
                const parsed = JSON.parse(cachedData);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  // Debug logging removed(`[NBA Landing] ✅ Using cached player props from sessionStorage (${parsed.length} props, ${Math.round(age / 1000)}s old)`);
                  
                  // Merge in any calculated stats from sessionStorage
                  let propsWithMergedStats = parsed;
                  try {
                    const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
                    const stored = sessionStorage.getItem(CALCULATED_STATS_KEY);
                    if (stored) {
                      const calculatedStats = JSON.parse(stored);
                      if (Array.isArray(calculatedStats)) {
                        const calculatedMap = new Map<string, PlayerProp>();
                        calculatedStats.forEach((prop: PlayerProp) => {
                          const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                          calculatedMap.set(key, prop);
                        });
                        
                        // Merge calculated stats into props
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
                        
                        // Also update the calculated stats state
                        setPropsWithCalculatedStats(calculatedMap);
                        calculatedStats.forEach((prop: PlayerProp) => {
                          const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                          calculatedKeysRef.current.add(key);
                        });
                      }
                    }
                  } catch (e) {
                    // Ignore errors
                  }
                  
                  setPlayerProps(propsWithMergedStats);
                  propsLoadedRef.current = true; // Mark as loaded
                  initialFetchCompletedRef.current = true; // Mark initial fetch as completed
                  setPropsLoading(false);
                  // Still fetch in background to update if needed (non-blocking)
                  fetch(cacheUrl, { cache: 'default' }).then(async (response) => {
                    if (response.ok) {
                      const data = await response.json();
                      if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
                        setPlayerProps(data.data);
                        const dataString = JSON.stringify(data.data);
                        safeSetSessionStorage(CACHE_KEY, dataString);
                        safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
                      }
                    }
                  }).catch(() => {});
                  return; // Use cached data immediately, update in background
                }
              } catch (e) {
                console.warn('[NBA Landing] ⚠️ Failed to parse cached data, fetching fresh');
              }
            } else {
              // Debug logging removed(`[NBA Landing] ⏰ Cache expired (${Math.round(age / 1000)}s old), fetching fresh`);
            }
          }
        }
        
        // Only set loading if we don't have props already (don't clear existing props)
        if (!propsLoadedRef.current) {
          setPropsLoading(true);
        }
        
        // Only read from cache - no processing on client side
        // Processing is done server-side by cron job
        // Always read from cache - refresh=1 just forces a fresh fetch (no cache headers)
        const cacheResponse = await fetch(cacheUrl, {
          cache: forceRefresh ? 'no-store' : 'default'
        });
        // Debug logging removed(`[NBA Landing] API response status: ${cacheResponse.status}`);
        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();
          if (cacheData.success && cacheData.data && Array.isArray(cacheData.data) && cacheData.data.length > 0) {
            // Debug logging removed(`[NBA Landing] ✅ Using cached player props data (${cacheData.data.length} props)`);
          
          // Debug: Check which stat types are present
          const statTypes = new Set(cacheData.data.map((p: PlayerProp) => p.statType));
          // Debug logging removed(`[NBA Landing] 📊 Stat types in cache:`, Array.from(statTypes).sort());
          const stlCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'STL').length;
          const blkCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'BLK').length;
          const threesCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'THREES').length;
          // Debug logging removed(`[NBA Landing] 📊 STL props: ${stlCount}, BLK props: ${blkCount}, THREES props: ${threesCount}`);
          
          // Debug: Check bookmakerLines counts
          const propsWithMultipleBookmakers = cacheData.data.filter((p: PlayerProp) => 
            p.bookmakerLines && Array.isArray(p.bookmakerLines) && p.bookmakerLines.length > 1
          );
          const propsWithOneBookmaker = cacheData.data.filter((p: PlayerProp) => 
            p.bookmakerLines && Array.isArray(p.bookmakerLines) && p.bookmakerLines.length === 1
          );
          // Debug logging removed(`[NBA Landing] 📊 Bookmakers: ${propsWithMultipleBookmakers.length} props with multiple, ${propsWithOneBookmaker.length} props with single`);
          
          // Sample a prop to see its bookmakerLines
          if (cacheData.data.length > 0) {
            const sampleProp = cacheData.data[0] as PlayerProp;
          }
          
          // Merge in any calculated stats from sessionStorage
          let propsWithMergedStats = cacheData.data;
          if (typeof window !== 'undefined') {
            try {
              const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
              const stored = sessionStorage.getItem(CALCULATED_STATS_KEY);
              if (stored) {
                const calculatedStats = JSON.parse(stored);
                if (Array.isArray(calculatedStats)) {
                  const calculatedMap = new Map<string, PlayerProp>();
                  calculatedStats.forEach((prop: PlayerProp) => {
                    const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                    calculatedMap.set(key, prop);
                  });
                  
                  // Merge calculated stats into props
                  propsWithMergedStats = cacheData.data.map((prop: PlayerProp) => {
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
                  
                  // Also update the calculated stats state
                  setPropsWithCalculatedStats(calculatedMap);
                  calculatedStats.forEach((prop: PlayerProp) => {
                    const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                    calculatedKeysRef.current.add(key);
                  });
                }
              }
            } catch (e) {
              // Ignore errors
            }
          }
          
            setPlayerProps(propsWithMergedStats);
            propsLoadedRef.current = true; // Mark as loaded
            initialFetchCompletedRef.current = true; // Mark initial fetch as completed
            setPropsProcessing(false); // Reset processing state when we have data
            
            // Save to sessionStorage for instant load on back navigation
            if (typeof window !== 'undefined') {
              const dataString = JSON.stringify(cacheData.data);
              if (safeSetSessionStorage(CACHE_KEY, dataString)) {
                safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
                // Debug logging removed(`[NBA Landing] 💾 Cached ${cacheData.data.length} player props to sessionStorage`);
              }
            }
            
            // Pre-load team data in background for teams with games today
            const uniqueTeams = new Set<string>();
            cacheData.data.forEach((prop: PlayerProp) => {
              if (prop.team) uniqueTeams.add(prop.team);
              if (prop.opponent) uniqueTeams.add(prop.opponent);
            });
            
            if (uniqueTeams.size > 0) {
              // Debug logging removed(`[NBA Landing] 🚀 Pre-loading team data for ${uniqueTeams.size} teams in background...`);
              preloadTeamData(Array.from(uniqueTeams), currentNbaSeason()).catch(err => {
                console.warn('[NBA Landing] ⚠️ Error pre-loading team data:', err);
              });
            }
            
            setPropsLoading(false);
            return;
          } else {
            console.warn(`[NBA Landing] ⚠️ No cached data available - cache is being populated`);
            // Don't clear existing props - keep them visible
            if (!propsLoadedRef.current) {
              setPlayerProps([]);
            }
            setPropsProcessing(!cacheData.cached); // Show processing state if cache is empty
            initialFetchCompletedRef.current = true; // Mark initial fetch as completed
            setPropsLoading(false);
            
            // Note: Player props processing is handled by GitHub workflow (process-player-props.yml)
            // No need to trigger from frontend - reduces server load and prevents duplicate processing
            return;
          }
        } else {
          console.warn(`[NBA Landing] Cache API error: ${cacheResponse.status} ${cacheResponse.statusText}`);
          // Don't clear existing props on error - keep them visible
          if (!propsLoadedRef.current) {
            setPlayerProps([]);
          }
          initialFetchCompletedRef.current = true; // Mark initial fetch as completed even on error
          setPropsLoading(false);
          return;
        }
      } catch (error) {
        console.error('[NBA Landing] Error fetching player props:', error);
        // Don't clear existing props on error - keep them visible
        if (!propsLoadedRef.current) {
          setPlayerProps([]);
        }
        initialFetchCompletedRef.current = true; // Mark initial fetch as completed even on error
        setPropsLoading(false);
      }
    };

    fetchPlayerProps();
    
    // Poll for odds updates and refresh player props when odds change
    // This ensures player props reflect new lines when odds refresh (every 30 mins)
    let lastOddsTimestamp: string | null = null;
    const checkOddsUpdate = async () => {
      try {
        // Check odds cache timestamp
        const oddsResponse = await fetch('/api/odds?check_timestamp=1', { cache: 'no-store' });
        if (oddsResponse.ok) {
          const oddsData = await oddsResponse.json();
          const currentTimestamp = oddsData.lastUpdated;
          
          if (currentTimestamp && currentTimestamp !== lastOddsTimestamp && lastOddsTimestamp !== null) {
            // Odds have been updated - refresh player props in background (don't clear existing)
            // Debug logging removed('[NBA Landing] 🔄 Odds updated, refreshing player props in background...');
            // Fetch new props in background and update when ready
            fetch('/api/nba/player-props', { cache: 'default' }).then(async (response) => {
                  if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
                      setPlayerProps(data.data);
                      if (typeof window !== 'undefined') {
                        const dataString = JSON.stringify(data.data);
                        safeSetSessionStorage(CACHE_KEY, dataString);
                        safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
                      }
                    }
                  }
            }).catch(() => {});
          }
          
          lastOddsTimestamp = currentTimestamp;
        }
      } catch (err) {
        // Ignore errors - this is a background check
      }
    };
    
    // Check every 10 minutes for odds updates (reduced from 2 minutes)
    const oddsCheckInterval = setInterval(checkOddsUpdate, ODDS_CHECK_INTERVAL_MS);
    
    // Initial check after 30 seconds (give odds refresh time to complete)
    const initialCheckTimeout = setTimeout(() => {
      checkOddsUpdate();
    }, INITIAL_ODDS_CHECK_DELAY_MS);
    
    return () => {
      clearInterval(oddsCheckInterval);
      clearTimeout(initialCheckTimeout);
    };
  }, [propsSport]);

  // Note: getPlayerPosition and getDvpRating are no longer needed on client-side
  // Position and DvP are calculated server-side during processing and stored in cache
  const mapStatTypeToDvpMetric = (statType: string): string | null => {
    const mapping: Record<string, string> = {
      'PTS': 'pts',
      'REB': 'reb',
      'AST': 'ast',
      'STL': 'stl',
      'BLK': 'blk',
      'THREES': 'fg3m',
      'FG3M': 'fg3m',
      'FG_PCT': 'fg_pct',
      'TO': 'to',
      // Combined stats - will be calculated from component stats
      'PRA': 'pra',  // Points + Rebounds + Assists
      'PA': 'pa',    // Points + Assists
      'PR': 'pr',    // Points + Rebounds
      'RA': 'ra',    // Rebounds + Assists
    };
    const upperStat = statType.toUpperCase();
    const metric = mapping[upperStat] || null;
    if (!metric) {
      console.warn(`[mapStatTypeToDvpMetric] No mapping for statType: ${statType} (${upperStat})`);
    }
    return metric;
  };

  // Helper function to fetch DvP rank and stat value
  const getDvpRating = async (
    opponent: string,
    position: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null,
    statType: string
  ): Promise<{ rank: number | null; statValue: number | null }> => {
    if (!opponent) {
      console.warn(`[getDvpRating] No opponent provided for ${statType}`);
      return { rank: null, statValue: null };
    }
    if (!position) {
      console.warn(`[getDvpRating] No position provided for ${opponent} ${statType}`);
      return { rank: null, statValue: null };
    }
    
    const metric = mapStatTypeToDvpMetric(statType);
    if (!metric) {
      console.warn(`[getDvpRating] No metric mapping for statType: ${statType}`);
      return { rank: null, statValue: null };
    }
    
    try {
      // Opponent might already be an abbreviation, but try both
      let teamAbbr = opponent;
      if (TEAM_FULL_TO_ABBR[opponent]) {
        teamAbbr = TEAM_FULL_TO_ABBR[opponent];
      } else {
        // If it's not in the mapping, assume it's already an abbreviation
        teamAbbr = opponent.toUpperCase().trim();
      }
      
      // Fetch rank instead of perGame value (API uses 'pos' parameter)
      const url = `/api/dvp/rank?pos=${position}&metric=${metric}`;
          // Debug logging removed(`[getDvpRating] Fetching rank: ${url} (opponent: "${opponent}" -> teamAbbr: "${teamAbbr}")`);
      
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn(`[getDvpRating] Rank API not ok: ${response.status} for ${url}`, errorText);
        return { rank: null, statValue: null };
      }
      
      const data = await response.json();
      // Debug logging removed(`[getDvpRating] Rank response for ${opponent} (${teamAbbr}) ${position} ${statType}:`, data);
      
      if (!data.success) {
        console.warn(`[getDvpRating] Rank API returned success: false`, data);
        return { rank: null, statValue: null };
      }
      
      // Extract rank for this team from the ranks object
      const ranks = data.ranks || {};
      // Try both the teamAbbr and normalized versions
      const normalizedTeamAbbr = teamAbbr.toUpperCase().trim();
      let rank = ranks[normalizedTeamAbbr] ?? ranks[teamAbbr];
      
      // If still not found, try all variations
      if (rank === null || rank === undefined) {
        const allKeys = Object.keys(ranks);
        const matchingKey = allKeys.find(k => k.toUpperCase() === normalizedTeamAbbr || normalizedTeamAbbr.includes(k.toUpperCase()) || k.toUpperCase().includes(normalizedTeamAbbr));
        if (matchingKey) {
          rank = ranks[matchingKey];
        }
      }
      
      // Extract stat value for this team from the values array
      const values = data.values || [];
      const normalizedTeamAbbrLower = normalizedTeamAbbr.toLowerCase();
      let statValue: number | null = null;
      const teamValue = values.find((v: any) => {
        const vTeam = String(v.team || '').toUpperCase().trim();
        return vTeam === normalizedTeamAbbr || normalizedTeamAbbr === vTeam;
      });
      
      if (teamValue && teamValue.value !== null && teamValue.value !== undefined) {
        statValue = typeof teamValue.value === 'number' ? teamValue.value : parseFloat(String(teamValue.value));
        if (statValue !== null && isNaN(statValue)) statValue = null;
      }
      
      if (rank === null || rank === undefined) {
        console.warn(`[getDvpRating] No rank value for ${teamAbbr} in response. Available teams:`, Object.keys(ranks).slice(0, 5));
        return { rank: null, statValue };
      }
      
      const rankValue = typeof rank === 'number' ? rank : parseInt(String(rank), 10);
      if (isNaN(rankValue) || rankValue <= 0) {
        console.warn(`[getDvpRating] Invalid rank value: ${rank} for ${teamAbbr}`);
        return { rank: null, statValue };
      }
      
      // Debug logging removed(`[getDvpRating] ✅ Extracted rank: ${rankValue}, statValue: ${statValue} for ${opponent} (${teamAbbr}) ${position} ${statType}`);
      return { rank: rankValue, statValue };
    } catch (error) {
      console.error(`[getDvpRating] Error for ${opponent} ${position} ${statType}:`, error);
      return { rank: null, statValue: null };
    }
  };

// Debug helpers
const DEBUG_H2H_PLAYER = (process.env.NEXT_PUBLIC_DEBUG_H2H_PLAYER || '').toLowerCase().trim();

// LRU Cache implementation for player stats
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
      // Update access time for LRU
      this.accessOrder.set(key, Date.now());
    }
    return value;
  }

  set(key: string, value: T): void {
    // If cache is full, evict least recently used
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
    
    // Find least recently used key
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

// LRU caches to reduce duplicate /api/stats calls per player/season/postseason
// Limited to 100 entries each to prevent memory leaks
const playerStatsCache = new LRUCache<any[]>(100);
const playerStatsPromiseCache = new LRUCache<Promise<any[]>>(50);

// Calculate L5, L10, H2H averages and hit rates
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
    if (propsSport === 'world-cup') {
      const q = new URLSearchParams();
      q.set('mode', 'player');
      q.set('player', searchQuery.trim());
      snapshotPropsPageBeforeLeave();
      router.push(`/world-cup?${q.toString()}`);
      return;
    }
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
      // AFL
      'disposals': 'Disposals',
      'disposals_over': 'Disposals Over',
      'anytime_goal_scorer': 'Anytime Goal Scorer',
      'goals_over': 'Goals Over',
      // World Cup
      'goals': 'Goals',
      'assists': 'Assists',
      'total_shots': 'Shots',
      'shots_on_target': 'Shots on Target',
      'fouls_committed': 'Fouls',
      'yellow_cards': 'Yellow Cards',
    };
    return labels[statType] || statType;
  }, []);

  const getAflInitials = (name: string): string => {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0]! + parts[parts.length - 1]![0]).toUpperCase();
    if (parts.length === 1) return (parts[0]!.slice(0, 2) || '?').toUpperCase();
    return '?';
  };

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

  const getTipoffGameForRow = useCallback((prop: PlayerProp, rowSport: 'nba' | 'afl' | 'world-cup'): Game | null => {
    if (prop.gameDate) {
      const parsedGameDate = new Date(prop.gameDate);
      if (!Number.isNaN(parsedGameDate.getTime())) {
        if (rowSport === 'afl' || rowSport === 'world-cup') {
          return {
            id: 0,
            date: prop.gameDate.slice(0, 10),
            status: prop.gameDate,
            home_team: { id: 0, abbreviation: '' },
            visitor_team: { id: 0, abbreviation: '' },
            datetime: prop.gameDate
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

  // AFL: games that have at least one prop, and filtered AFL props
  const aflGamesWithProps = useMemo(() => {
    if (aflProps.length === 0 || aflGames.length === 0) return [];
    const eligibleGames = filterAflPropsEligibleGames(aflGames);
    const ids = new Set<string>();
    aflProps.forEach((p) => {
      if (!p.gameId) return;
      if (!isAflCommenceTimePropsEligible(p.gameDate)) return;
      if (propsSport === 'world-cup' && !isWorldCupListProp(p)) return;
      ids.add(p.gameId);
    });
    return eligibleGames.filter((g) => ids.has(g.gameId));
  }, [aflProps, aflGames, propsSport]);

  const availableAflBookmakers = useMemo(() => {
    const bookmakers = new Set<string>();
    aflProps.forEach((prop) => {
      prop.bookmakerLines?.forEach((l) => l.bookmaker && bookmakers.add(l.bookmaker));
      if (prop.bookmaker) bookmakers.add(prop.bookmaker);
    });
    return Array.from(bookmakers).sort();
  }, [aflProps]);

  const availableAflPropTypes = useMemo(() => {
    const types = new Set<string>();
    aflProps.forEach((p) => p.statType && types.add(p.statType));
    const order =
      propsSport === 'world-cup'
        ? ['goals', 'assists', 'total_shots', 'shots_on_target', 'fouls_committed', 'yellow_cards']
        : ['disposals', 'disposals_over', 'anytime_goal_scorer', 'goals_over'];
    return Array.from(types).sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    });
  }, [aflProps, propsSport]);

  const effectiveBookmakers = isSecondaryPropsSport(propsSport) ? availableAflBookmakers : availableBookmakers;
  const effectivePropTypes = isSecondaryPropsSport(propsSport) ? availableAflPropTypes : availablePropTypes;
  const isCombinedMode = propsSport === 'combined';
  const isSecondaryListMode = isSecondaryPropsSport(propsSport);
  const isWorldCupProps = propsSport === 'world-cup';
  const showH2hColumn = !isWorldCupProps;
  const showWcGamesColumn = isWorldCupProps;
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

  // AFL: ensure prop types selected when none or invalid (e.g. after switching from NBA)
  useEffect(() => {
    if (!isSecondaryListMode || aflProps.length === 0 || availableAflPropTypes.length === 0) return;
    const propTypesOverlap = Array.from(selectedPropTypes).some((t) => availableAflPropTypes.includes(t));
    if (selectedPropTypes.size > 0 && propTypesOverlap) return;
    setSelectedPropTypes(new Set(availableAflPropTypes));
  }, [propsSport, aflProps.length, availableAflPropTypes, selectedPropTypes]);

  // AFL: ensure all games selected when none or invalid (e.g. after switching from NBA or cache miss)
  useEffect(() => {
    if (!isSecondaryListMode) return;
    const eligibleProps =
      propsSport === 'world-cup'
        ? aflProps.filter(isWorldCupListProp)
        : propsSport === 'afl'
          ? aflProps.filter((p) => !isWorldCupSoccerPropStatType(p.statType))
          : aflProps;
    const propGameIds = propGameIdsFromRows(eligibleProps);
    if (propGameIds.size === 0 && aflGamesWithProps.length === 0) return;
    // Don't auto-select all games after the user has manually toggled them.
    if (userModifiedAflGamesRef.current) return;
    const gameIds =
      aflGamesWithProps.length > 0
        ? new Set(aflGamesWithProps.map((g) => g.gameId))
        : propGameIds;
    const hasOverlap = Array.from(selectedAflGames).some((id) => gameIds.has(id));
    if (selectedAflGames.size > 0 && hasOverlap) return;
    const next = new Set(gameIds);
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
  }, [propsSport, aflGamesWithProps, selectedAflGames, aflProps]);

  const secondaryGameFilterApplies = useMemo(() => {
    if (selectedAflGames.size === 0) return false;
    return aflProps.some((p) => p.gameId && selectedAflGames.has(p.gameId));
  }, [aflProps, selectedAflGames]);

  const liveEligibleAflPropsCount = useMemo(
    () => aflProps.filter((prop) => isAflCommenceTimePropsEligible(prop.gameDate)).length,
    [aflProps]
  );

  const filteredAflProps = useMemo(() => {
    return aflProps.filter((prop) => {
      if (!isAflCommenceTimePropsEligible(prop.gameDate)) return false;
      if (propsSport === 'world-cup' && !isWorldCupListProp(prop)) return false;
      if (propsSport === 'afl' && isWorldCupSoccerPropStatType(prop.statType)) return false;
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
      if (secondaryGameFilterApplies && prop.gameId && !selectedAflGames.has(prop.gameId)) return false;
      return true;
    });
  }, [aflProps, propsSport, debouncedSearchQuery, selectedPropTypes, selectedBookmakers, selectedAflGames, secondaryGameFilterApplies, getStatLabel]);

  // Combined mode: minimal filters only (search + sort + pagination).
  const filteredCombinedProps = useMemo(() => {
    if (propsSport === 'combined' && !combinedPaintUnlocked) {
      return [] as CombinedPlayerPropRow[];
    }
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

      return {
        ...prop,
        bookmakerLines: [],
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
    return [
      ...mapWithSport(playerProps, 'nba'),
      ...mapWithSport(
        aflProps.filter((prop) => isAflCommenceTimePropsEligible(prop.gameDate)),
        'afl'
      ),
      ...(WORLD_CUP_PUBLIC_ENABLED ? mapWithSport(worldCupCombinedProps, 'world-cup') : []),
    ] as CombinedPlayerPropRow[];
  }, [playerProps, aflProps, worldCupCombinedProps, debouncedSearchQuery, getStatLabel, propsSport, combinedPaintUnlocked]);

  const displaySortedCombinedProps = useMemo(() => {
    const percent = (hitRate?: { hits: number; total: number } | null) =>
      hitRate && hitRate.total > 0 ? (hitRate.hits / hitRate.total) * 100 : null;
    const out = [...filteredCombinedProps];
    const blendBySport = (...sportRows: CombinedPlayerPropRow[][]) => {
      const lists = sportRows.filter((rows) => rows.length > 0);
      if (!lists.length) return [];
      const blended: CombinedPlayerPropRow[] = [];
      const indices = lists.map(() => 0);
      const total = lists.reduce((count, rows) => count + rows.length, 0);
      while (blended.length < total) {
        for (let i = 0; i < lists.length; i++) {
          const rows = lists[i]!;
          const idx = indices[i]!;
          if (idx < rows.length) {
            blended.push(rows[idx]!);
            indices[i] = idx + 1;
          }
        }
      }
      return blended;
    };

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
      const compareByActiveColumn = (a: CombinedPlayerPropRow, b: CombinedPlayerPropRow) => {
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
        else if (column === 'wc') { aVal = percent(a.wcGamesHitRate); bVal = percent(b.wcGamesHitRate); }
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
      };

      const nbaSorted = out.filter((p) => p.sportSource === 'nba').sort(compareByActiveColumn);
      const aflSorted = out.filter((p) => p.sportSource === 'afl').sort(compareByActiveColumn);
      const wcSorted = out.filter((p) => p.sportSource === 'world-cup').sort(compareByActiveColumn);

      return blendBySport(nbaSorted, aflSorted, wcSorted);
    }

    const compareByDefaultQuality = (a: PlayerProp, b: PlayerProp) => {
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
    };

    // Combined default ranking:
    // 1) Rank each sport by quality using the same comparator.
    // 2) Interleave rows so one sport cannot crowd out the first pages.
    const nbaSorted = out.filter((p) => p.sportSource === 'nba').sort(compareByDefaultQuality);
    const aflSorted = out.filter((p) => p.sportSource === 'afl').sort(compareByDefaultQuality);
    const wcSorted = out.filter((p) => p.sportSource === 'world-cup').sort(compareByDefaultQuality);

    return blendBySport(nbaSorted, aflSorted, wcSorted);
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
        else if (column === 'wc') { aVal = percent(a.wcGamesHitRate); bVal = percent(b.wcGamesHitRate); }
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

          case 'wc':
            aValue = percent(a.wcGamesHitRate);
            bValue = percent(b.wcGamesHitRate);
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
    const liveProps = aflProps.filter((prop) => isAflCommenceTimePropsEligible(prop.gameDate));
    if (propsSport === 'world-cup') {
      const listed = filterWorldCupListProps(liveProps);
      if (listed.length > 0) return listed;
      return liveProps.filter((p) => !isAflExclusivePropStatType(p.statType));
    }
    return liveProps;
  }, [isSecondaryListMode, propsSport, aflProps]);

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
    if (propsSport === 'combined' && !combinedPaintUnlocked) return true;
    if (
      (isSecondaryListMode && (aflPropsLoading || !aflPropsFetchComplete)) ||
      (propsSport === 'nba' && !showNoPropsMessage) ||
      (propsSport === 'combined' &&
        (combinedPropsLoading || propsLoading || aflPropsLoading || !combinedPropsFetchComplete))
    ) {
      return true;
    }
    if (isSecondaryListMode && aflPropsFetchComplete) return false;
    if (propsSport === 'combined') return false;
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
    aflProps.length,
    playerProps.length,
    worldCupCombinedProps.length,
    combinedPropsFetchComplete,
    filteredCombinedProps.length,
    combinedPaintUnlocked,
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
      } else if (rowSport === 'world-cup') {
        if (prop.headshotUrl) warmImage(prop.headshotUrl);
        const matchup = resolveWcPropsMatchup(prop, aflGames);
        if (matchup.homeFlagUrl) warmImage(matchup.homeFlagUrl);
        if (matchup.awayFlagUrl) warmImage(matchup.awayFlagUrl);
      }
    }
  }, [activePaginatedProps, propsSport, aflLogoByTeam, aflPortraitExtras, aflGames]);

  const applySportMode = useCallback((nextMode: PropsSportMode) => {
    if (!NBA_PUBLIC_ENABLED && nextMode === 'nba') {
      nextMode = 'combined';
    }
    if (!WORLD_CUP_PUBLIC_ENABLED && nextMode === 'world-cup') {
      nextMode = 'combined';
    }
    let combinedWarm = false;
    const liveWorldCupPropsLeavingTab =
      nextMode === 'combined' && propsSport === 'world-cup' ? aflProps : null;
    const liveAflPropsLeavingTab =
      nextMode === 'combined' && propsSport === 'afl' ? aflProps : null;
    const liveAflGamesLeavingTab =
      nextMode === 'combined' && propsSport === 'afl' ? aflGames : null;
    if (nextMode === 'combined' && propsSport === 'world-cup') {
      setWorldCupCombinedProps(aflProps);
      setAflProps([]);
      setAflGames([]);
    }
    if (nextMode === 'combined') {
      const leavingSecondaryForCombined = propsSport === 'afl' || propsSport === 'world-cup';
      if (!leavingSecondaryForCombined) {
      try {
        const raw = sessionStorage.getItem(COMBINED_PROPS_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as CombinedPropsSnapshotResponse & { timestamp?: number; selectedGameIds?: string[] };
          const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
          const nbaProps = Array.isArray(parsed?.nba?.props) ? parsed.nba.props : [];
          const aflPropsCached = Array.isArray(parsed?.afl?.props) ? parsed.afl.props : [];
          const wcPropsCached = Array.isArray(parsed?.worldCup?.props) ? parsed.worldCup.props : [];
          const hasSnapshotData = nbaProps.length > 0 || aflPropsCached.length > 0 || wcPropsCached.length > 0;
          if (age < CACHE_TTL_MS && hasSnapshotData) {
            applyCombinedSnapshot(parsed, {
              persistCaches: false,
              selectedGameIds: Array.isArray(parsed?.selectedGameIds) ? parsed.selectedGameIds : undefined,
              preserveWorldCupProps: liveWorldCupPropsLeavingTab ?? undefined,
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

      // AFL → All: never trust stale combined snapshot — keep live AFL rows and merge WC from session.
      if (propsSport === 'afl' && aflProps.length > 0) {
        const wcFromSession = hydrateWorldCupPropsFromSessionCache();
        const wcMerged = preferWorldCupPropsWithHistoricalStats(
          wcFromSession,
          worldCupCombinedPropsRef.current
        );
        setWorldCupCombinedProps(wcMerged);
        const needsCombinedRefresh = combinedModeNeedsDataRefresh(
          playerProps,
          aflProps,
          wcMerged,
          {
            wc: combinedPartialWcRefetchAttemptedRef.current,
            afl: combinedPartialAflRefetchAttemptedRef.current,
          },
          combinedOddsFlagsRef.current
        );
        setCombinedFetchComplete(!needsCombinedRefresh);
        setCombinedPropsLoading(needsCombinedRefresh);
        setCombinedPaintUnlocked(
          isCombinedSecondaryPaintReady(aflProps, wcMerged, combinedOddsFlagsRef.current)
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
            worldCup: {
              ok: wcMerged.length > 0,
              status: 200,
              lastUpdated: null,
              nextUpdate: null,
              ingestMessage: null,
              noWorldCupOdds: wcMerged.length === 0,
              games: [],
              props: wcMerged,
            },
          });
        } catch {
          // ignore cache write failures
        }
      }

      // World Cup → combined: restore AFL slice from session cache after WC rows were moved to worldCupCombinedProps.
      if (propsSport === 'world-cup') {
        const aflCached = readSecondaryPropsSessionCache('afl');
        if (aflCached.isFresh && (aflCached.props.length > 0 || aflCached.games.length > 0)) {
          const liveAfl = applyLiveAflPropsCutoff(aflCached.props, aflCached.games);
          let matchedAflGames: AflGameForProps[] = [];
          if (liveAfl.noAflOdds) {
            setAflIngestMessage(liveAfl.ingestMessage);
            setAflProps([]);
            setAflGames([]);
            combinedOddsFlagsRef.current = {
              ...combinedOddsFlagsRef.current,
              noAflOdds: true,
            };
          } else {
            setAflProps(liveAfl.props);
            matchedAflGames = gamesMatchingProps(liveAfl.props, liveAfl.games);
            setAflGames(matchedAflGames);
          }
          if (aflCached.selectedGameIds.length > 0) {
            const selected = new Set(aflCached.selectedGameIds);
            selectedAflGamesRef.current = selected;
            setSelectedAflGames(selected);
          } else if (matchedAflGames.length > 0) {
            const allIds = matchedAflGames.map((g) => g.gameId);
            const selected = new Set(allIds);
            selectedAflGamesRef.current = selected;
            setSelectedAflGames(selected);
          }
          const wcSlice = liveWorldCupPropsLeavingTab ?? worldCupCombinedPropsRef.current;
          const needsCombinedRefresh = combinedModeNeedsDataRefresh(
            playerProps,
            liveAfl.noAflOdds ? [] : liveAfl.props,
            wcSlice,
            {
              wc: combinedPartialWcRefetchAttemptedRef.current,
              afl: combinedPartialAflRefetchAttemptedRef.current,
            },
            combinedOddsFlagsRef.current
          );
          setCombinedFetchComplete(!needsCombinedRefresh);
          setCombinedPropsLoading(needsCombinedRefresh);
          setCombinedPaintUnlocked(
            isCombinedSecondaryPaintReady(
              liveAfl.noAflOdds ? [] : liveAfl.props,
              wcSlice,
              combinedOddsFlagsRef.current
            )
          );
          setAflPropsLoading(false);
          setSecondaryPropsFetchComplete(true);
          combinedWarm = true;
          combinedWarmToggleRef.current = !needsCombinedRefresh;
        }
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
        // AFL game/type/bookmaker filters hide every WC row (and vice versa) for one frame → skeleton.
        setSelectedPropTypes(new Set());
        setSelectedBookmakers(new Set());
        userModifiedAflGamesRef.current = false;
        selectedAflGamesRef.current = new Set();
        setSelectedAflGames(new Set());
      }

      const applySecondaryHydrate = (
        hydratedProps: PlayerProp[],
        hydratedGames: AflGameForProps[],
        preferredGameIds?: string[]
      ) => {
        if (hydratedProps.length === 0) return false;
        setAflProps(hydratedProps);
        const matchedGames = gamesMatchingProps(hydratedProps, hydratedGames);
        setAflGames(matchedGames);
        const selected = selectedGameIdsForProps(hydratedProps, matchedGames, preferredGameIds);
        selectedAflGamesRef.current = selected;
        setSelectedAflGames(selected);
        secondaryRestoredFromCache = true;
        const canSkipFetch =
          nextMode !== 'world-cup' || !worldCupPropsMissingHistoricalStats(hydratedProps);
        setSecondaryPropsFetchComplete(canSkipFetch);
        setAflPropsLoading(!canSkipFetch);
        if (canSkipFetch) {
          secondarySkipFetchSportRef.current = nextMode;
          secondaryWarmHydrateRef.current = true;
        } else {
          secondarySkipFetchSportRef.current = null;
          secondaryWarmHydrateRef.current = false;
        }
        return true;
      };

      // Combined → WC: prefer in-memory All slice (what the user already sees), then combined snapshot.
      // Do not use WC session cache here — it may carry AFL game ids that hide every WC row.
      if (nextMode === 'world-cup' && propsSport === 'combined') {
        let wcPropsHydrated: PlayerProp[] = [];
        let wcGamesHydrated: AflGameForProps[] = [];
        let snapshotProps: PlayerProp[] = [];

        const inMemorySlice = worldCupCombinedPropsRef.current;
        if (inMemorySlice.length > 0) {
          wcPropsHydrated = pickWorldCupPropsFromCombinedSource(inMemorySlice);
        }

        try {
          const combinedRaw = sessionStorage.getItem(COMBINED_PROPS_CACHE_KEY);
          if (combinedRaw) {
            const combinedParsed = JSON.parse(combinedRaw) as CombinedPropsSnapshotResponse & {
              timestamp?: number;
            };
            const combinedAge =
              combinedParsed?.timestamp != null ? Date.now() - Number(combinedParsed.timestamp) : Infinity;
            if (combinedAge < CACHE_TTL_MS) {
              snapshotProps = Array.isArray(combinedParsed?.worldCup?.props)
                ? combinedParsed.worldCup.props
                : [];
              wcGamesHydrated = Array.isArray(combinedParsed?.worldCup?.games)
                ? combinedParsed.worldCup.games
                : [];
            }
          }
        } catch {
          // ignore parse errors
        }

        if (snapshotProps.length > 0) {
          wcPropsHydrated = preferWorldCupPropsWithHistoricalStats(wcPropsHydrated, snapshotProps);
        } else if (wcPropsHydrated.length === 0) {
          wcPropsHydrated = pickWorldCupPropsFromCombinedSource(snapshotProps);
        }

        if (worldCupPropsMissingHistoricalStats(wcPropsHydrated)) {
          try {
            const wcRaw = sessionStorage.getItem(WC_PROPS_CACHE_KEY);
            if (wcRaw) {
              const wcParsed = JSON.parse(wcRaw) as { props?: PlayerProp[]; games?: AflGameForProps[]; timestamp?: number };
              const wcAge = wcParsed?.timestamp != null ? Date.now() - Number(wcParsed.timestamp) : Infinity;
              const wcCachedProps = Array.isArray(wcParsed?.props) ? wcParsed.props : [];
              if (wcAge < AFL_PROPS_CACHE_TTL_MS && wcCachedProps.length > 0) {
                const paintable = filterWorldCupPaintableProps(wcCachedProps);
                const fromSession =
                  paintable.length > 0 ? paintable : pickWorldCupPropsFromCombinedSource(wcCachedProps);
                wcPropsHydrated = preferWorldCupPropsWithHistoricalStats(wcPropsHydrated, fromSession);
                if (wcGamesHydrated.length === 0 && Array.isArray(wcParsed?.games)) {
                  wcGamesHydrated = wcParsed.games;
                }
              }
            }
          } catch {
            // ignore parse errors
          }
        }

        applySecondaryHydrate(wcPropsHydrated, wcGamesHydrated);
      }

      // Session cache (AFL↔WC direct, refresh-on-WC, etc.) — skip when combined→WC already hydrated.
      if (!secondaryRestoredFromCache && !(leavingCombinedForSecondary && nextMode === 'world-cup')) {
      try {
        const cacheKey = getSecondaryPropsCacheKey(nextMode);
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            props?: PlayerProp[];
            games?: AflGameForProps[];
            selectedGameIds?: string[];
            timestamp?: number;
          };
          const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
          const cachedPropsRaw = Array.isArray(parsed?.props) ? parsed.props : [];
          const cachedProps =
            nextMode === 'world-cup'
              ? hydrateWorldCupPropsFromCacheRows(cachedPropsRaw)
              : cachedPropsRaw;
          const cachedGames = Array.isArray(parsed?.games) ? parsed.games : [];
          const hasPaintableSecondaryRows =
            nextMode === 'world-cup'
              ? cachedProps.length > 0
              : cachedProps.length > 0 || cachedGames.length > 0;
          if (age < AFL_PROPS_CACHE_TTL_MS && hasPaintableSecondaryRows) {
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
        const aflRows = aflProps.filter((p) => !isWorldCupSoccerPropStatType(p.statType));
        const matchedGames = gamesMatchingProps(aflRows, aflGames);
        setAflGames(matchedGames);
        const selected = selectedGameIdsForProps(aflRows, matchedGames);
        selectedAflGamesRef.current = selected;
        setSelectedAflGames(selected);
        secondaryRestoredFromCache = true;
        setSecondaryPropsFetchComplete(true);
        setAflPropsLoading(false);
        secondarySkipFetchSportRef.current = 'afl';
        secondaryWarmHydrateRef.current = true;
      }

      // Secondary switch without hydrate: drop the other sport's rows.
      if ((switchingSecondarySport || (leavingCombinedForSecondary && nextMode === 'world-cup')) && !secondaryRestoredFromCache) {
        setAflProps([]);
        setAflGames([]);
        userModifiedAflGamesRef.current = false;
        selectedAflGamesRef.current = new Set();
        setSelectedAflGames(new Set());
      }
    }

    setPropsSport(nextMode);
    if (nextMode === 'combined') {
      const ready = isCombinedSecondaryPaintReady(
        aflPropsRef.current,
        worldCupCombinedPropsRef.current,
        combinedOddsFlagsRef.current
      );
      if (ready) {
        setCombinedPaintUnlocked(true);
        setCombinedFetchComplete(true);
        setCombinedPropsLoading(false);
      } else if (!combinedWarm) {
        setCombinedPaintUnlocked(false);
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
  }, [router, mergeNbaPropsWithStoredCalculatedStats, setSecondaryPropsFetchComplete, propsSport, aflProps, aflGames, aflLastUpdated, aflIngestMessage, playerProps, worldCupCombinedProps, applyCombinedSnapshot, persistCombinedSnapshotCaches]);

  const toggleSportSelection = useCallback((sport: 'nba' | 'afl' | 'world-cup') => {
    if (sport === 'world-cup' && !WORLD_CUP_PUBLIC_ENABLED) return;
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

  const toggleAflGame = (gameId: string) => {
    userModifiedAflGamesRef.current = true;
    setSelectedAflGames((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      selectedAflGamesRef.current = next;
      return next;
    });
  };
  const selectAllAflGames = () => {
    userModifiedAflGamesRef.current = true;
    const next = new Set(aflGamesWithProps.map((g) => g.gameId));
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
  };
  const clearAllAflGames = () => {
    userModifiedAflGamesRef.current = true;
    const next = new Set<string>();
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
  };

  const getConfidenceColor = (confidence: string) => {
    if (confidence === 'High') return mounted && isDark ? 'text-green-400' : 'text-green-600';
    if (confidence === 'Medium') return mounted && isDark ? 'text-yellow-400' : 'text-yellow-600';
    return mounted && isDark ? 'text-gray-400' : 'text-gray-600';
  };


  // Avoid full-screen blocking loader when navigating back from dashboards.
  // Let page skeletons render immediately; redirect non-pro users once checks finish.
  if (subscriptionChecked && !isPro) {
    return null;
  }

  return (
    <div className={`min-h-screen lg:h-screen ${mounted && isDark ? 'bg-[#050d1a]' : 'bg-gray-50'} transition-colors lg:overflow-x-auto lg:overflow-y-hidden`}>
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
      
      <div className={`px-0 dashboard-container ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ 
        marginLeft: 'calc(var(--sidebar-width, 0px) + var(--gap, 2px))',
        width: 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 2px)))',
        paddingLeft: 0,
      }}>
        <div className={`mx-auto w-full max-w-[1550px] ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingLeft: 0, paddingRight: '0px' }}>
          <div className={`pt-4 min-h-0 lg:h-full dashboard-container ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingLeft: 0 }}>
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
              className={`relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 pt-1 lg:pt-0 overflow-y-auto lg:overflow-x-hidden lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar ${mounted && isDark ? 'bg-[#050d1a]' : ''}`}
              style={{
                scrollbarGutter: 'stable',
                paddingLeft: 0,
                paddingRight: 0,
              }}
            >
          <div className={`h-full pb-12 lg:pr-0 px-2 lg:px-1 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingTop: 0, boxSizing: 'border-box' }}>
            {/* Sport filter: default combined (none selected); click active sport again to return to combined */}
            <div className={`flex gap-2 mb-3 lg:mb-2 lg:gap-3 p-1.5 lg:p-0 rounded-2xl lg:rounded-none border lg:border-0 ${mounted && isDark ? 'bg-gradient-to-r from-[#0b1730] to-[#171433] lg:bg-none lg:bg-[#050d1a] border-[#352f57] lg:border-transparent' : 'bg-gray-50 border-gray-200'}`}>
              {NBA_PUBLIC_ENABLED && (
                <button
                  type="button"
                  onClick={() => toggleSportSelection('nba')}
                  className={`flex-1 sm:flex-none px-4 py-2.5 lg:min-w-[180px] lg:px-8 lg:py-3 rounded-xl lg:rounded-lg text-sm font-semibold border shadow-sm transition-all duration-200 flex items-center justify-center ${
                    propsSport === 'nba'
                      ? mounted && isDark ? 'bg-gradient-to-br from-purple-500 to-purple-700 text-white border-purple-400 shadow-[0_0_20px_rgba(124,58,237,0.35)]' : 'bg-purple-100 text-purple-800 border-purple-300'
                      : mounted && isDark ? 'bg-[#111b33] text-gray-300 border-[#3c3560] hover:bg-[#1a2542]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                  aria-label="NBA"
                >
                  <img
                    src="/images/nba-logo.png"
                    alt=""
                    className="w-10 h-10 lg:w-12 lg:h-12 object-contain"
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleSportSelection('afl')}
                className={`flex-1 sm:flex-none px-4 py-2.5 lg:min-w-[180px] lg:px-8 lg:py-3 rounded-xl lg:rounded-lg text-sm font-semibold border shadow-sm transition-all duration-200 flex items-center justify-center ${
                  propsSport === 'afl'
                    ? mounted && isDark ? 'bg-gradient-to-br from-purple-500 to-purple-700 text-white border-purple-400 shadow-[0_0_20px_rgba(124,58,237,0.35)]' : 'bg-purple-100 text-purple-800 border-purple-300'
                    : mounted && isDark ? 'bg-[#111b33] text-gray-300 border-[#3c3560] hover:bg-[#1a2542]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
                aria-label="AFL"
              >
                <img
                  src="/images/afl-logo.png"
                  alt=""
                  className="w-10 h-10 lg:w-12 lg:h-12 object-contain"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </button>
              <button
                type="button"
                disabled={!WORLD_CUP_PUBLIC_ENABLED}
                onClick={() => {
                  if (!WORLD_CUP_PUBLIC_ENABLED) return;
                  toggleSportSelection('world-cup');
                }}
                className={`flex-1 sm:flex-none px-4 py-2.5 lg:min-w-[180px] lg:px-8 lg:py-3 rounded-xl lg:rounded-lg text-sm font-semibold border shadow-sm transition-all duration-200 flex items-center justify-center ${
                  !WORLD_CUP_PUBLIC_ENABLED
                    ? mounted && isDark
                      ? 'bg-[#0d1528] text-gray-500 border-[#2a2545] opacity-60 cursor-not-allowed grayscale'
                      : 'bg-gray-100 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed grayscale'
                    : propsSport === 'world-cup'
                      ? mounted && isDark ? 'bg-gradient-to-br from-purple-500 to-purple-700 text-white border-purple-400 shadow-[0_0_20px_rgba(124,58,237,0.35)]' : 'bg-purple-100 text-purple-800 border-purple-300'
                      : mounted && isDark ? 'bg-[#111b33] text-gray-300 border-[#3c3560] hover:bg-[#1a2542]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
                aria-label="World Cup"
                aria-disabled={!WORLD_CUP_PUBLIC_ENABLED}
                title={!WORLD_CUP_PUBLIC_ENABLED ? 'Coming Soon' : undefined}
              >
                <img
                  src={WORLD_CUP_LOGO_PATH}
                  alt=""
                  className={WORLD_CUP_LOGO_TOGGLE_CLASS}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </button>
            </div>

            {/* Search Bar */}
            <div className={`mb-3 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`}>
              <form onSubmit={handleSearch} style={{ width: '100%', margin: 0, padding: 0, boxSizing: 'border-box' }}>
                <div className="relative" style={{ width: '100%', boxSizing: 'border-box' }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for a player..."
                    className={`px-4 py-3.5 pl-12 rounded-xl border shadow-sm ${
                      mounted && isDark 
                        ? 'bg-[#111b33] border-[#463e6b] text-white placeholder-gray-400' 
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                    } focus:outline-none focus:ring-2 focus:ring-purple-500/80 focus:border-purple-500`}
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
                className={`mt-2 flex flex-col gap-1.5 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} 
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
                    className={`relative flex items-center justify-between gap-2 px-4 py-3 rounded-lg border transition-all w-full ${
                      gamesDropdownOpen
                        ? mounted && isDark
                          ? 'bg-[#0a1929] border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-[#0a1929] border-gray-700 text-gray-300 hover:bg-[#0d1f35]'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-sm font-medium whitespace-nowrap">
                      Games
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
                    className={`relative flex items-center justify-between gap-2 px-4 py-3 rounded-lg border transition-all w-full ${
                      propTypeDropdownOpen
                        ? mounted && isDark
                          ? 'bg-[#0a1929] border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-[#0a1929] border-gray-700 text-gray-300 hover:bg-[#0d1f35]'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
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
                    className={`relative flex items-center justify-between gap-2 px-4 py-3 rounded-lg border transition-all w-full ${
                      bookmakerDropdownOpen
                        ? mounted && isDark
                          ? 'bg-[#0a1929] border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-[#0a1929] border-gray-700 text-gray-300 hover:bg-[#0d1f35]'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
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
              } ${mounted && isDark ? 'bg-[#050d1a]' : ''}`}
              style={{ boxSizing: 'border-box', width: '100%', overflow: 'visible', paddingTop: 0, marginTop: 0 }}
            >
              <div className={`rounded-2xl lg:rounded-lg w-full pr-0 lg:pr-2 border lg:border-transparent ${
                mounted && isDark ? 'bg-[#050d1a] border-[#3b3560]' : 'bg-white border-gray-200'
              } shadow-[0_10px_30px_rgba(0,0,0,0.12)]`} style={{ boxSizing: 'border-box', width: '100%', paddingTop: 0, marginTop: 0, paddingLeft: '0.6rem', paddingRight: '0.6rem' }}>
                <h2 className={`text-[1.75rem] lg:text-2xl text-center lg:text-left font-extrabold tracking-tight mb-3 ${
                  mounted && isDark ? 'text-white' : 'text-gray-900'
                }`} style={{ marginTop: 0, paddingTop: 0 }}>
                  Top Player Props
                </h2>

                {propsSport === 'afl' && aflListDebugMeta && (
                  <details className={`mb-4 rounded-lg border text-sm ${mounted && isDark ? 'bg-gray-900/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                    <summary className={`cursor-pointer px-3 py-2 font-medium ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      Debug: why L5/L10/Season show N/A ({aflListDebugMeta.rowsNa != null ? String(aflListDebugMeta.rowsNa) : '?'} rows with N/A)
                    </summary>
                    <pre className={`p-3 overflow-auto max-h-80 whitespace-pre-wrap break-words ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                      {JSON.stringify({ cacheBackend: aflListDebugMeta.cacheBackend, cacheHits: aflListDebugMeta.cacheHits, cacheMisses: aflListDebugMeta.cacheMisses, rowsWithStats: aflListDebugMeta.rowsWithStats, rowsNa: aflListDebugMeta.rowsNa, totalRows: aflListDebugMeta.totalRows, hint: aflListDebugMeta.hint, debugNaSample: Array.isArray(aflListDebugMeta.debugNa) ? (aflListDebugMeta.debugNa as unknown[]).slice(0, 25) : aflListDebugMeta.debugNa }, null, 2)}
                    </pre>
                  </details>
                )}
                
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
                                {propsSport === 'world-cup' && (
                                  <div className="mb-0.5 text-[9px] font-bold uppercase leading-tight text-amber-500 dark:text-amber-300">
                                    1+ game 2026 World Cup
                                  </div>
                                )}
                                DvP
                              </th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>L5</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>L10</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                {propsSport === 'world-cup' ? 'WC' : 'H2H'}
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
                        {[...Array(5)].map((_, idx) => (
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
                      liveEligibleAflPropsCount === 0 ? (
                        <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <p className="text-lg font-medium max-w-lg">
                            {aflIngestMessage ?? AFL_USER_NO_ODDS}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              userModifiedAflGamesRef.current = false;
                              secondarySkipFetchSportRef.current = null;
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
                      <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        <p className="text-lg font-medium mb-2">No props match your search</p>
                        <p className="text-sm">Try a different player or stat search.</p>
                      </div>
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
                                {propsSport === 'world-cup' && (
                                  <div className="mb-0.5 text-[9px] font-bold uppercase leading-tight text-amber-500 dark:text-amber-300">
                                    1+ game 2026 World Cup
                                  </div>
                                )}
                                DvP
                              </th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>L5</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>L10</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                {propsSport === 'world-cup' ? 'WC' : 'H2H'}
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
                        {[...Array(5)].map((_, idx) => (
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
                                {isWorldCupProps && (
                                  <span className="text-[9px] font-bold uppercase leading-tight text-amber-500 dark:text-amber-300">
                                    1+ game 2026 World Cup
                                  </span>
                                )}
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
                            {showWcGamesColumn && (
                            <th
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`}
                              style={PROPS_DESKTOP_STAT_COL_STYLE}
                              onClick={() => handleColumnSort('wc')}
                            >
                              <div className="flex flex-col items-center justify-center gap-0.5">
                                <div className="mb-0.5 text-[9px] font-bold uppercase leading-tight text-amber-500 dark:text-amber-300">
                                  2018 / 2022 / 2026 World Cup
                                </div>
                                <div className="flex items-center justify-center gap-1.5">
                                  <span>WC</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.wc !== 'none'
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.wc === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.wc === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.wc === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
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
                            const rowSport = propsSport === 'combined'
                              ? ((prop as CombinedPlayerPropRow).sportSource ?? 'nba')
                              : propsSport;
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
                              const lines = prop.bookmakerLines ?? [];
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
                              if (rowSport === 'world-cup' || propsSport === 'world-cup') {
                                navigateToWorldCupDashboardFromProp(
                                  {
                                    ...prop,
                                    bookmaker: bookmakerName || prop.bookmaker,
                                  },
                                  router,
                                  lineValue,
                                  propsSport === 'combined' || isCombinedMode ? 'combined' : 'world-cup'
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
                                onMouseEnter={() => {
                                  if (rowSport === 'world-cup' || rowSport === 'afl') return;
                                  const playerId = getPlayerIdFromName(prop.playerName);
                                  if (playerId && typeof window !== 'undefined') {
                                    const currentSeason = new Date().getFullYear();
                                    // Prefetch all 4 stat endpoints to warm up server cache
                                    // Use regular fetch (not cachedFetch) to ensure server cache is warmed
                                    const prefetchUrls = [
                                      `/api/stats?player_id=${playerId}&season=${currentSeason}&per_page=100&max_pages=5&postseason=false&skip_dvp=1`,
                                      `/api/stats?player_id=${playerId}&season=${currentSeason - 1}&per_page=100&max_pages=5&postseason=false&skip_dvp=1`,
                                      `/api/stats?player_id=${playerId}&season=${currentSeason}&per_page=100&max_pages=5&postseason=true&skip_dvp=1`,
                                      `/api/stats?player_id=${playerId}&season=${currentSeason - 1}&per_page=100&max_pages=5&postseason=true&skip_dvp=1`,
                                    ];
                                    
                                    // Fire and forget - don't await, just warm up the cache
                                    prefetchUrls.forEach(url => {
                                      fetch(url, { cache: 'default' }).catch(() => {
                                        // Ignore errors - this is just prefetch
                                      });
                                    });
                                  }
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (navigatingRef.current) return;
                                  navigatingRef.current = true;
                                  setNavigatingToPlayer(true);
                                  if (rowSport === 'afl' || rowSport === 'world-cup') {
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
                                <td className={`py-3 px-4 ${isCombinedMode ? 'relative' : ''}`}>
                                  {isCombinedMode && (
                                    <div
                                      className={`absolute z-10 ${
                                        rowSport === 'world-cup' ? 'top-1 left-3' : 'top-2 left-3'
                                      }`}
                                    >
                                      <SportMark
                                        sport={rowSport}
                                        isDark={mounted && isDark}
                                        compact
                                      />
                                    </div>
                                  )}
                                  <div className={`flex items-center gap-3 ${isCombinedMode ? 'pl-9' : ''}`}>
                                    {rowSport === 'nba' && headshotUrl && (
                                      <img
                                        src={headshotUrl}
                                        alt={prop.playerName}
                                        className="w-12 h-12 rounded-full object-cover flex-shrink-0 border-2 border-gray-200 dark:border-gray-700"
                                        style={{ imageRendering: 'auto' }}
                                        loading="eager"
                                        decoding="async"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
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
                                          initials={getAflInitials(prop.playerName)}
                                          isDark={isDark}
                                          mounted={mounted}
                                          size="md"
                                        />
                                      ))}
                                    {rowSport === 'world-cup' && (
                                      <AflPropsPlayerAvatar
                                        headshotUrl={prop.headshotUrl ?? null}
                                        jerseyNumber={null}
                                        initials={getAflInitials(prop.playerName)}
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="md"
                                      />
                                    )}
                                    <div>
                                      <div className={`font-semibold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                        {prop.playerName}
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
                                      {rowSport === 'world-cup' && prop.wcPosition && (
                                        <div
                                          className={`text-xs font-semibold mt-0.5 ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}
                                        >
                                          {prop.wcPosition}
                                        </div>
                                      )}
                                      <div className={`text-sm font-medium ${mounted && isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                                        {getStatLabel(prop.statType)} {prop.line > 0 ? 'Over' : 'Under'} {Math.abs(prop.line)}
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
                                        })() : rowSport === 'world-cup' ? (
                                          <WcPropsMatchupLogos
                                            prop={prop}
                                            games={aflGames}
                                            isDark={isDark}
                                            mounted={mounted}
                                            size="md"
                                          />
                                        ) : (
                                          <>
                                            <img src={teamLogoUrl} alt={prop.team} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                            <img src={opponentLogoUrl} alt={prop.opponent} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>

                                {isCombinedMode && showCombinedDesktopSportColumn && (
                                  <td className="py-3 px-3">
                                    <SportMark sport={rowSport} isDark={mounted && isDark} />
                                  </td>
                                )}
                                
                                {/* Odds Column - Show bookmakers grouped by line with expand/collapse */}
                                <td
                                  className={`py-3 px-4 ${singleBookmakerOddsCell ? 'align-middle' : 'align-top'}`}
                                  style={PROPS_DESKTOP_ODDS_COL_STYLE}
                                >
                                    {prop.bookmakerLines && prop.bookmakerLines.length > 0 ? (
                                      (() => {
                                        // Filter bookmakerLines by selected bookmakers (if any are selected)
                                        let filteredLines = prop.bookmakerLines;
                                        if (!isCombinedMode && selectedBookmakers.size > 0) {
                                          filteredLines = prop.bookmakerLines.filter(line => 
                                            line.bookmaker && selectedBookmakers.has(line.bookmaker)
                                          );
                                        }
                                        
                                        // Group bookmakers by line value
                                        const linesByValue = new Map<number, typeof prop.bookmakerLines>();
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
                                              className="flex flex-wrap items-center gap-1.5 max-w-full"
                                            >
                                              {/* Show visible bookmakers for this line */}
                                              {visibleLines.map((line, lineIdx) => {
                                                const bookmakerInfo = getBookmakerInfo(line.bookmaker || '');
                                                return (
                                                  <div key={lineIdx} className="flex items-center gap-1.5">
                                                    {/* Bookmaker card/button */}
                                                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors ${
                                                      mounted && isDark
                                                        ? 'bg-[#0a1929] border-gray-700 hover:bg-[#0d1f35]'
                                                        : 'bg-white border-gray-300 hover:bg-gray-50'
                                                    }`}
                                                    onClick={(e) => {
                                                      if (rowSport !== 'afl' && rowSport !== 'world-cup') return;
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
                                                              {propsRowShowsUnderOdds(rowSport) && (
                                                                <>
                                                                  <span className={`${mounted && isDark ? 'text-gray-500' : 'text-gray-400'} text-[10px] 2xl:text-xs`}>|</span>
                                                                  <span className={`${mounted && isDark ? 'text-red-400' : 'text-red-600'} text-[10px] 2xl:text-xs`}>U {formatOddsValue(line.underOdds)}</span>
                                                                </>
                                                              )}
                                                            </>
                                                          );
                                                        })()}
                                                      </div>
                                                    </div>
                                                    
                                                    {/* Separator line between bookmakers */}
                                                    {lineIdx < visibleLines.length - 1 && (
                                                      <div className={`w-px h-8 ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'}`} />
                                                    )}
                                                  </div>
                                                );
                                              })}
                                              
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
                                                              <div
                                                                key={lineIdx}
                                                                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${
                                                                  mounted && isDark
                                                                    ? 'bg-[#0a1929] border-gray-700'
                                                                    : 'bg-gray-800 border-gray-500'
                                                                }`}
                                                                onClick={(e) => {
                                                                  if (rowSport !== 'afl' && rowSport !== 'world-cup') return;
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
                                                                        {propsRowShowsUnderOdds(rowSport) && (
                                                                          <>
                                                                            <span className="text-gray-500 text-[10px] 2xl:text-xs">|</span>
                                                                            <span className="text-red-400 font-medium text-[10px] 2xl:text-xs">U {formatOddsValue(line.underOdds)}</span>
                                                                          </>
                                                                        )}
                                                                      </>
                                                                    );
                                                                  })()}
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
                                              {propsRowShowsUnderOdds(rowSport) && (
                                                <div>Under: {prop.underOdds && prop.underOdds !== 'N/A' ? prop.underOdds : '—'}</div>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })()
                                    )}
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
                                          const filteredLines = !isCombinedMode && selectedBookmakers.size > 0
                                            ? (prop.bookmakerLines || []).filter((line) => line.bookmaker && selectedBookmakers.has(line.bookmaker))
                                            : (prop.bookmakerLines || []);
                                          const { overProb, underProb } = getConsensusImpliedProbabilities(prop, filteredLines);
                                          const showUnderIp = propsRowShowsUnderOdds(rowSport);
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
                                        const isAflDvp = rowSport === 'afl';
                                        const isWcDvp = rowSport === 'world-cup';
                                        const easyMin = isAflDvp ? 13 : isWcDvp ? 34 : 21;
                                        const hardMax = isAflDvp ? 6 : isWcDvp ? 9 : 10;
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
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          #{displayProp.dvpRating}
                                        </div>
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' || rowSport === 'world-cup' ? (
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

                                {showWcGamesColumn && (
                                <td className="py-3 px-1 text-center align-middle" style={PROPS_DESKTOP_STAT_COL_STYLE}>
                                  {(displayProp.wcGamesHitRate?.total ?? 0) > 0 ||
                                  (displayProp.wcGamesAvg !== null && displayProp.wcGamesAvg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';

                                        if (displayProp.wcGamesHitRate) {
                                          const hitRate = (displayProp.wcGamesHitRate.hits / displayProp.wcGamesHitRate.total) * 100;
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
                                          {displayProp.wcGamesAvg!.toFixed(1)}
                                        </div>
                                        {displayProp.wcGamesHitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.wcGamesHitRate.hits}/{displayProp.wcGamesHitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.wcGamesHitRate.hits / displayProp.wcGamesHitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
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
                                        {displayProp.streak === 0 ? '0' : `${displayProp.streak} 🔥`}
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
                              title={isWorldCupProps ? '1+ game 2026 World Cup' : undefined}
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
                            {showWcGamesColumn && (
                            <button
                              onClick={() => handleColumnSort('wc')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap flex-shrink-0 shadow-sm ${
                                columnSort.wc !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>WC</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.wc !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.wc === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.wc === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.wc === 'none' && (
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
                      <div className={`2xl:hidden space-y-4.5 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`}>
                        {propsTablePaginatedProps.map((prop, idx) => {
                          const rowSport = propsSport === 'combined'
                            ? ((prop as CombinedPlayerPropRow).sportSource ?? 'nba')
                            : propsSport;
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
                              if (streakValue === 0) {
                                bgColor = '#ef4444'; // red
                                borderColor = '#ef4444';
                                glowColor = '#ef4444';
                              } else if (streakValue === 1) {
                                bgColor = '#f59e0b'; // amber
                                borderColor = '#f59e0b';
                                glowColor = '#f59e0b';
                              } else {
                                bgColor = '#22c55e'; // green
                                borderColor = '#22c55e';
                                glowColor = '#22c55e';
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
                              className={`relative rounded-2xl border pl-3.5 pr-3.5 py-3.5 cursor-pointer active:scale-[0.99] transition-transform ${isCombinedMode ? 'pt-8' : ''} shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${
                                mounted && isDark ? 'bg-gradient-to-br from-[#0b1a2b] via-[#10253f] to-[#1b1c3d] border-[#463e6b]' : 'bg-white border-gray-200'
                              }`}
                              onClick={() => {
                                if (navigatingRef.current) return;
                                navigatingRef.current = true;
                                setNavigatingToPlayer(true);
                                if (rowSport === 'afl' || rowSport === 'world-cup') {
                                  if (rowSport === 'world-cup') {
                                    navigateToWorldCupDashboardFromProp(prop, router, undefined, propsSport === 'combined' || isCombinedMode ? 'combined' : 'world-cup');
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
                                  const selectedLine = Number.isFinite(prop.line) ? prop.line : null;
                                  if (selectedLine != null) q.set('line', String(selectedLine));
                                  const selectedBook = String(prop.bookmaker || '').trim();
                                  if (selectedBook) q.set('bookmaker', selectedBook);

                                  // Show loading bar briefly so transition is intentional and prefetch has head start.
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
                              {isCombinedMode && (
                                <div
                                  className={`absolute z-10 pointer-events-none ${
                                    rowSport === 'world-cup' ? 'top-1 left-2' : 'top-2 left-2'
                                  }`}
                                >
                                  <SportMark
                                    sport={rowSport}
                                    isDark={mounted && isDark}
                                    compact
                                  />
                                </div>
                              )}
                              {/* Header Section */}
                              <div className="mb-1.5">
                                {/* Player Name and Headshot Row */}
                                <div className="flex items-center gap-2.5 mb-2">
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
                                        initials={getAflInitials(prop.playerName)}
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="sm"
                                      />
                                    )
                                  ) : rowSport === 'world-cup' ? (
                                    <AflPropsPlayerAvatar
                                      headshotUrl={prop.headshotUrl ?? null}
                                      jerseyNumber={null}
                                      initials={getAflInitials(prop.playerName)}
                                      isDark={isDark}
                                      mounted={mounted}
                                      size="sm"
                                    />
                                  ) : headshotUrl ? (
                                    <div className="w-10 h-10 rounded-full object-cover flex-shrink-0 border-2 overflow-hidden relative" style={{ borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb' }}>
                                      <Image
                                        src={headshotUrl}
                                        alt={prop.playerName}
                                        width={40}
                                        height={40}
                                        className="object-cover"
                                        loading="eager"
                                        unoptimized={false}
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                    </div>
                                  ) : null}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className={`font-bold text-base truncate ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                        {prop.playerName}
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
                                        })() : rowSport === 'world-cup' ? (
                                          <WcPropsMatchupLogos
                                            prop={prop}
                                            games={aflGames}
                                            isDark={isDark}
                                            mounted={mounted}
                                            size="sm"
                                          />
                                        ) : (
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
                                    {rowSport === 'world-cup' && prop.wcPosition && (
                                      <div
                                        className={`text-xs font-semibold mt-0.5 ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}
                                      >
                                        {prop.wcPosition}
                                      </div>
                                    )}
                                    {/* Stat Type and Line */}
                                    <div className={`text-sm font-semibold mt-0.5 ${mounted && isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                                      {getStatLabel(prop.statType)} {prop.line > 0 ? 'Over' : 'Under'} {Math.abs(prop.line)}
                                    </div>
                                  </div>
                                  {/* Bookmaker IP Box - darker text on mobile */}
                                  <div className="flex-shrink-0">
                                    <div className="flex flex-col items-center justify-center rounded-lg border-2 px-3 py-2" style={getStatBoxStyle(null)}>
                                      <div className={`text-[10px] font-semibold mb-1 ${mounted && isDark ? 'text-gray-500 sm:text-gray-300' : 'text-gray-600 sm:text-gray-700'}`}>Books</div>
                                      {(() => {
                                        const filteredLines = !isCombinedMode && selectedBookmakers.size > 0
                                          ? (prop.bookmakerLines || []).filter((line) => line.bookmaker && selectedBookmakers.has(line.bookmaker))
                                          : (prop.bookmakerLines || []);
                                        const { overProb, underProb } = getConsensusImpliedProbabilities(prop, filteredLines);
                                        const showUnderIp = propsRowShowsUnderOdds(rowSport);

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
                              <div className={`grid grid-cols-6 gap-1 px-1 py-2.5 rounded-2xl mb-3.5 w-full border ${
                                mounted && isDark ? 'bg-[#0f1a34] border-[#4a3f74]' : 'bg-gray-50 border-gray-200'
                              }`}>
                                {/* DvP */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={(() => {
                                  if (prop.dvpRating === null || prop.dvpRating === undefined) {
                                    return { background: mounted && isDark ? '#1a2140' : '#f9fafb', borderColor: mounted && isDark ? '#4d4a73' : '#e5e7eb' };
                                  }
                                  let bgColor = mounted && isDark ? '#1a2140' : '#f9fafb';
                                  let borderColor = mounted && isDark ? '#4d4a73' : '#e5e7eb';
                                  let glowColor: string | null = null;
                                  const isAflDvp = rowSport === 'afl';
                                  const easyMin = isAflDvp ? 13 : 21;
                                  const hardMax = isAflDvp ? 6 : 10;
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
                                    {prop.dvpRating !== null && prop.dvpRating !== undefined ? `#${prop.dvpRating}` : 'N/A'}
                                  </div>
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
                                {showWcGamesColumn && (
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.wcGamesHitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>WC</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.wcGamesHitRate || prop.wcGamesHitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
                                    {getHitRatePercent(prop.wcGamesHitRate)}
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
                              {prop.bookmakerLines && prop.bookmakerLines.length > 0 && (() => {
                                // Group by line value
                                const linesByValue = new Map<number, typeof prop.bookmakerLines>();
                                prop.bookmakerLines.forEach(line => {
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
                                              if (rowSport !== 'world-cup') return;
                                              if (navigatingRef.current) return;
                                              navigatingRef.current = true;
                                              setNavigatingToPlayer(true);
                                              navigateToWorldCupDashboardFromProp(
                                                {
                                                  ...prop,
                                                  bookmaker: bookmaker.bookmaker || prop.bookmaker,
                                                },
                                                router,
                                                prop.line,
                                                propsSport === 'combined' || isCombinedMode ? 'combined' : 'world-cup'
                                              );
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
                                              {propsRowShowsUnderOdds(rowSport) && (
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
                                                            {propsRowShowsUnderOdds(rowSport) && (
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
                                      <TipoffCountdown game={game} isDark={mounted && isDark} label={rowSportKickoffLabel(rowSport)} />
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Tipoff Countdown - Show if no bookmakers */}
                              {(!prop.bookmakerLines || prop.bookmakerLines.length === 0) && (
                                <div className="flex items-center justify-start pr-1">
                                  <TipoffCountdown game={game} isDark={mounted && isDark} label={rowSportKickoffLabel(rowSport)} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Pagination controls - Shared for desktop and mobile */}
                      <div className="flex items-center justify-between mt-6 px-2 pb-24 sm:pb-4">
                        <div className={`text-sm ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {propsSport === 'afl'
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
                  propsSport === 'world-cup'
                    ? 'Search World Cup players...'
                    : propsSport === 'afl'
                      ? 'Search AFL players...'
                      : propsSport === 'combined'
                        ? 'Search NBA or AFL players...'
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
                  {findPlayerResults.map((player, idx) => (
                    <li key={`${player.name}-${player.team ?? ''}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setFindPlayerOpen(false);
                          if (propsSport === 'afl') {
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
                            const q = new URLSearchParams();
                            q.set('mode', 'player');
                            q.set('name', player.name);
                            if (player.team) q.set('team', player.team);
                            snapshotPropsPageBeforeLeave();
                            router.push(`/afl?${q.toString()}`);
                          } else {
                            try {
                              sessionStorage.removeItem('nba_dashboard_session_v1');
                              sessionStorage.setItem('from_props_page', 'true');
                            } catch {}
                            snapshotPropsPageBeforeLeave();
                            router.push(`/nba/research/dashboard?player=${encodeURIComponent(player.name)}&tf=last10`);
                          }
                        }}
                        className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors ${
                          mounted && isDark
                            ? 'text-gray-200 hover:bg-gray-800'
                            : 'text-gray-800 hover:bg-gray-100'
                        }`}
                      >
                        <span className="font-medium">{player.name}</span>
                        {player.team && (
                          <span className={mounted && isDark ? 'text-gray-500 ml-2' : 'text-gray-400 ml-2'}>{player.team}</span>
                        )}
                      </button>
                    </li>
                  ))}
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

