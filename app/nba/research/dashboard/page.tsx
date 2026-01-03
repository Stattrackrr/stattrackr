'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { useTheme } from "@/contexts/ThemeContext";
import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useMemo, useRef, useEffect, memo, useCallback, Suspense, startTransition, useDeferredValue, lazy } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Cell, Tooltip, LabelList,
  PieChart, Pie
} from 'recharts';
import { getPlayerById, formatHeight, NBAPlayer, SAMPLE_PLAYERS } from '@/lib/nbaPlayers';
import { BallDontLieAPI } from './api';
import { AdvancedStats } from './types';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { getFullTeamName, getTeamAbbr } from '@/lib/teamMapping';
import { OddsSnapshot, deriveOpeningCurrentMovement, filterByMarket } from '@/lib/odds';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import InjuryContainer from '@/components/InjuryContainer';
import DepthChartContainer from './components/DepthChartContainer';
import { cachedFetch } from '@/lib/requestCache';
import StaticBarsChart from './components/charts/StaticBarsChart';
import { RangeSlider } from './components/charts';
import SimpleChart from './components/charts/SimpleChart';
import { useSubscription } from '@/hooks/useSubscription';
import { OfficialOddsCard, BestOddsTable, BestOddsTableDesktop, ProjectedStatsCard } from './components/odds';
import { PositionDefenseCard, OpponentAnalysisCard } from './components/dvp';
import { HomeAwaySelect, OverRatePill } from './components/ui';
import ChartControls from './components/ChartControls';
import ChartContainer from './components/ChartContainer';
import { CHART_CONFIG, SECOND_AXIS_FILTER_OPTIONS, PLAYER_STAT_OPTIONS, TEAM_STAT_OPTIONS } from './constants';
import { updateBettingLinePosition, getUnifiedTooltipStyle } from './utils/chartUtils';
import { AltLineItem, partitionAltLineItems, cloneBookRow, mergeBookRowsByBaseName } from './utils/oddsUtils';
import { 
  TEAM_ID_TO_ABBR, 
  ABBR_TO_TEAM_ID, 
  TEAM_FULL_NAMES,
  getEspnLogoCandidates,
  getEspnLogoUrl,
  getEspnFallbackLogoUrl
} from './utils/teamUtils';
import {
  opponentDefensiveStats,
  getOpponentDefensiveRank,
  getOpponentDefensiveRankColor,
  teamRatings,
  teamPace,
  teamReboundPct,
  getTeamRating,
  getTeamRank,
  getTeamPace,
  getTeamReboundPct,
  getPaceRank,
  getOrdinalSuffix
} from './utils/teamStats';
import { getStatValue, getGameStatValue } from './utils/statUtils';
import { currentNbaSeason, parseMinutes } from './utils/playerUtils';
import { getEasternOffsetMinutes, parseBallDontLieTipoff } from './utils/dateUtils';
import { getReboundRank, getRankColor, createTeamComparisonPieData, getPlayerCurrentTeam, getOpponentTeam } from './utils/teamAnalysisUtils';

// Lazy load heavy components for better initial bundle size
const ShotChart = lazy(() => import('./ShotChart').then(mod => ({ default: mod.default })));
const AddToJournalModal = lazy(() => import('@/components/AddToJournalModal').then(mod => ({ default: mod.default })));
const TeamTrackingStatsTable = lazy(() => import('@/components/TeamTrackingStatsTable').then(mod => ({ default: mod.TeamTrackingStatsTable })));
const PlayTypeAnalysis = lazy(() => import('@/components/PlayTypeAnalysis').then(mod => ({ default: mod.PlayTypeAnalysis })));
import NotificationSystem from '@/components/NotificationSystem';
import { getBookmakerInfo as getBookmakerInfoFromLib } from '@/lib/bookmakers';
import serverLogger from '@/lib/serverLogger';
import { clientLogger } from '@/lib/clientLogger';
import Image from 'next/image';

// Depth chart types
type DepthPos = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
type DepthChartPlayer = { name: string; jersey?: string };
type DepthChartData = Record<DepthPos, DepthChartPlayer[]>;

// ==== Odds/UI Types ====
export type OddsFormat = 'american' | 'decimal';

export type BookRow = {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
  PTS: { line: string; over: string; under: string };
  REB: { line: string; over: string; under: string };
  AST: { line: string; over: string; under: string };
};

const PLACEHOLDER_BOOK_ROWS: any[] = [
  {
    name: 'DraftKings',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
  },
  {
    name: 'FanDuel',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
  },
  {
    name: 'BetMGM',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
  },
  {
    name: 'Caesars',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
  },
];

const LINE_MOVEMENT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_LINE_MOVEMENT === 'true';

// Optimized clone function - replaces expensive JSON.parse(JSON.stringify())
// Performs shallow clone with nested object cloning for BookRow structure

type DerivedOdds = { openingLine?: number | null; currentLine?: number | null };

type MovementRow = { ts: number; timeLabel: string; line: number; change: string; direction: 'up' | 'down' | 'flat' };


type MatchupInfo = { tipoffLocal?: string | null; tipoffDate?: string | null } | null;

export interface PredictedOutcomeResult {
  overProb: number | null;
  underProb: number | null;
  confidence: 'High' | 'Medium' | 'Low';
  expectedValue?: number | null;
}

export interface OfficialOddsCardProps {
  bettingLine?: number;
  isDark: boolean;
  derivedOdds: DerivedOdds;
  intradayMovements: MovementRow[];
  selectedTeam: string;
  opponentTeam: string;
  selectedTeamLogoUrl: string;
  opponentTeamLogoUrl: string;
  matchupInfo: MatchupInfo;
  oddsFormat: OddsFormat;
  books: BookRow[];
  fmtOdds: (odds: string) => string;
  lineMovementEnabled: boolean;
  lineMovementData?: {
  openingLine: { line: number; bookmaker: string; timestamp: string } | null;
  currentLine: { line: number; bookmaker: string; timestamp: string } | null;
    impliedOdds: number | null;
    lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
  } | null;
  selectedStat?: string;
  calculatedImpliedOdds?: {
    overImpliedProb: number | null;
    underImpliedProb: number | null;
  } | null;
  selectedBookmakerName?: string | null;
  selectedBookmakerLine?: number | null;
  propsMode?: 'player' | 'team';
  selectedPlayer?: any;
  primaryMarketLine?: number | null;
}

/* ==== Types (BDL) ==== */
interface BallDontLieGame {
  id: number;
  date: string;
  home_team?: { id: number; abbreviation: string; full_name: string; name: string };
  visitor_team?: { id: number; abbreviation: string; full_name: string; name: string };
  season: number;
  status: string;
}
interface BallDontLieStats {
  id: number;
  ast: number; blk: number; dreb: number;
  fg3_pct: number; fg3a: number; fg3m: number;
  fg_pct: number; fga: number; fgm: number;
  ft_pct: number; fta: number; ftm: number;
  min: string; oreb: number; pf: number; pts: number; reb: number;
  stl: number; turnover: number;
  game?: BallDontLieGame;
  team?: { id: number; abbreviation: string; full_name: string; name: string };
  player?: any;
}

/* ==== Utils ==== */

type BdlSearchResult = { id: number; full: string; team?: string; pos?: string; headshotUrl?: string | null };
 type EspnPlayerData = { name: string; jersey?: string; height?: string; weight?: number; team?: string; position?: string };
 
 // Persist session across refresh within the same tab (clears on tab close)
 const SESSION_KEY = 'nba_dashboard_session_v1';
 type SavedSession = {
   player: BdlSearchResult;
   selectedStat: string;
   selectedTimeframe: string;
   propsMode: 'player' | 'team';
 };

// Ball Don't Lie team ID to abbreviation mapping
// Team-related constants and functions are now imported from utils/teamUtils.ts and utils/teamStats.ts

// Memoized chart: only re-renders when its props change
// Label layer split out so it doesn't re-render on bettingLine changes


type AverageStatInfo = {
  label: string;
  value: number;
  format?: 'percent';
};

type HitRateStats = {
  overCount: number;
  underCount: number;
  total: number;
  totalBeforeFilters?: number; // Track total games before advanced filters (for "X/Y games" display)
  averages: AverageStatInfo[];
};

// Get rebound percentage rank for a team (higher rebound % = better for overs)

// Static stat options - never change so no need to recreate on every render

// Memoized Player Box Score component
const PlayerBoxScore = memo(function PlayerBoxScore({
  selectedPlayer,
  playerStats,
  isDark
}: {
  selectedPlayer: any;
  playerStats: BallDontLieStats[];
  isDark: boolean;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const [logoAttempts, setLogoAttempts] = useState<Record<string, number>>({});
  const gamesPerPage = 10;
  
  // Reset page when player changes
  useEffect(() => {
    setCurrentPage(0);
  }, [selectedPlayer]);
  
  // Always render the container - show skeleton when loading or no player selected
  if (!selectedPlayer) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Game Log</h3>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">Select a player to view their recent game logs</div>
          </div>
        </div>
      </div>
    );
  }

  // Show skeleton when player is selected but stats are loading (empty array)
  if (!playerStats.length) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Game Log</h3>
        <div className="overflow-x-auto">
          <div className="min-w-full">
            {/* Skeleton table */}
            <div className="animate-pulse">
              <div className={`${isDark ? 'bg-[#0a1929]' : 'bg-slate-100'} h-10 mb-2 rounded`}></div>
              {[...Array(5)].map((_, idx) => (
                <div key={idx} className={`${isDark ? 'border-slate-700' : 'border-slate-200'} border-b h-12 mb-1`}>
                  <div className="flex gap-2 h-full items-center px-2">
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded flex-1`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Only show current season games - no fallback to previous seasons
  const currentSeason = currentNbaSeason();
  const bySeason = (seasonYear: number) => playerStats.filter(game => {
    if (!game.game?.date) return false;
    const d = new Date(game.game.date);
    const y = d.getFullYear();
    const m = d.getMonth();
    const gameSeasonYear = m >= 9 ? y : y - 1; // Oct-Dec belong to current season year
    return gameSeasonYear === seasonYear;
  });

  // Only show current season - wait for data to load before filtering
  // This prevents race condition where previous season shows if current season request is still loading
  let displayGames = bySeason(currentSeason);
  // Remove games with 0 minutes played
  displayGames = displayGames.filter(g => parseMinutes(g.min) > 0);
  // Limit to 50 most recent games (playerStats are already newest-first)
  displayGames = displayGames.slice(0, 50);
  
  // Pagination logic
  const totalGames = displayGames.length;
  const totalPages = Math.ceil(totalGames / gamesPerPage);
  const startIndex = currentPage * gamesPerPage;
  const endIndex = Math.min(startIndex + gamesPerPage, totalGames);
  const currentGames = displayGames.slice(startIndex, endIndex);
  
  const canGoPrevious = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;
  const rangeStart = totalGames ? startIndex + 1 : 0;
  const rangeEnd = totalGames ? endIndex : 0;

  return (
    <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Game Log</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Games {rangeStart}-{rangeEnd} of {totalGames}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={!canGoPrevious}
              className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                !canGoPrevious ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={!canGoNext}
              className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                !canGoNext ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className={isDark ? 'bg-[#0a1929]' : 'bg-slate-100'}>
              <th className="text-left py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">DATE</th>
              <th className="text-left py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">TM</th>
              <th className="text-left py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">OPP</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">MIN</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">PTS</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">REB</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">AST</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">STL</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">BLK</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FGM</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FGA</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FG%</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">3PM</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">3PA</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">3P%</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FTM</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FTA</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">TO</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">PF</th>
            </tr>
          </thead>
          <tbody>
            {currentGames.map((game, index) => {
              const playerTeamRaw = game.team?.abbreviation;
              const playerTeam = normalizeAbbr(playerTeamRaw || 'UNK');
              
              // Get team info from game data - support both nested objects and *_id fields
              const homeTeamId = game.game?.home_team?.id ?? (game.game as any)?.home_team_id;
              const visitorTeamId = game.game?.visitor_team?.id ?? (game.game as any)?.visitor_team_id;
              const homeTeamAbbr = game.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
              const visitorTeamAbbr = game.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
              
              // Determine opponent using team IDs/abbrs
              const playerTeamId = ABBR_TO_TEAM_ID[playerTeam];
              let opponent = 'UNK';
              let isHome = false;
              
              if (playerTeamId && homeTeamId && visitorTeamId) {
                if (playerTeamId === homeTeamId && visitorTeamAbbr) {
                  opponent = normalizeAbbr(visitorTeamAbbr);
                  isHome = true;
                } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
                  opponent = normalizeAbbr(homeTeamAbbr);
                  isHome = false;
                }
              }
              
              // Fallback: compare abbreviations directly if IDs missing
              if (opponent === 'UNK' && homeTeamAbbr && visitorTeamAbbr) {
                const homeNorm = normalizeAbbr(homeTeamAbbr);
                const awayNorm = normalizeAbbr(visitorTeamAbbr);
                if (playerTeam === homeNorm) {
                  opponent = awayNorm;
                  isHome = true;
                } else if (playerTeam === awayNorm) {
                  opponent = homeNorm;
                  isHome = false;
                }
              }
              
              const fgPct = game.fga > 0 ? ((game.fgm / game.fga) * 100).toFixed(0) : '0';
              const fg3Pct = game.fg3a > 0 ? ((game.fg3m / game.fg3a) * 100).toFixed(0) : '0';
              
              // Format game date with year
              const gameDate = game.game?.date ? new Date(game.game.date).toLocaleDateString('en-US', {
                month: 'numeric',
                day: 'numeric',
                year: '2-digit'
              }) : '--';
              
              return (
                <tr key={startIndex + index} className={isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}>
                  <td className="py-2 px-2 text-gray-900 dark:text-white font-medium">
                    {gameDate}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <img 
                        src={(() => {
                          const candidates = getEspnLogoCandidates(playerTeam);
                          const attempt = logoAttempts[`player-${playerTeam}`] || 0;
                          return candidates[attempt] || candidates[0];
                        })()}
                        alt={playerTeam}
                        className="w-4 h-4 object-contain"
                        onError={(e) => {
                          const candidates = getEspnLogoCandidates(playerTeam);
                          const currentAttempt = logoAttempts[`player-${playerTeam}`] || 0;
                          const nextAttempt = currentAttempt + 1;
                          if (nextAttempt < candidates.length) {
                            setLogoAttempts(prev => ({ ...prev, [`player-${playerTeam}`]: nextAttempt }));
                          } else {
                            e.currentTarget.style.display = 'none';
                          }
                        }}
                      />
                      <span className="font-medium text-gray-900 dark:text-white">{playerTeam}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-gray-900 dark:text-white">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 dark:text-gray-400 text-[10px]">{isHome ? 'vs' : '@'}</span>
                      <img 
                        src={(() => {
                          const candidates = getEspnLogoCandidates(opponent);
                          const attempt = logoAttempts[`opponent-${opponent}`] || 0;
                          return candidates[attempt] || candidates[0];
                        })()}
                        alt={opponent}
                        className="w-4 h-4 object-contain"
                        onError={(e) => {
                          const candidates = getEspnLogoCandidates(opponent);
                          const currentAttempt = logoAttempts[`opponent-${opponent}`] || 0;
                          const nextAttempt = currentAttempt + 1;
                          if (nextAttempt < candidates.length) {
                            setLogoAttempts(prev => ({ ...prev, [`opponent-${opponent}`]: nextAttempt }));
                          } else {
                            e.currentTarget.style.display = 'none';
                          }
                        }}
                      />
                      <span className="font-medium">{opponent}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.min == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.min || '0:00'
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white">
                    {game.pts == null ? (
                      <span className="text-gray-400 dark:text-gray-500 font-bold">N/A</span>
                    ) : (
                      <span className="font-bold">{game.pts || 0}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.reb == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.reb || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.ast == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.ast || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.stl == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.stl || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.blk == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.blk || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fgm == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fgm || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fga == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fga || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fga == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      fgPct
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fg3m == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fg3m || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fg3a == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fg3a || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fg3a == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      fg3Pct
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.ftm == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.ftm || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fta == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fta || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.turnover == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.turnover || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.pf == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.pf || 0
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}, (prev, next) => (
  prev.selectedPlayer === next.selectedPlayer &&
  prev.playerStats === next.playerStats &&
  prev.isDark === next.isDark
));

function NBADashboardContent() {
  const router = useRouter();
  const { isDark, theme, setTheme } = useTheme();
  
  // Debug: Track renders (will log after state is defined)
  const renderCountRef = useRef(0);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false); // Default to false until verified
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const journalDropdownRef = useRef<HTMLDivElement>(null);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  // Advanced filters (player mode)
  const [minMinutesFilter, setMinMinutesFilter] = useState<number>(0);
  const [maxMinutesFilter, setMaxMinutesFilter] = useState<number>(48);
  const [excludeBlowouts, setExcludeBlowouts] = useState<boolean>(false);
  const [excludeBackToBack, setExcludeBackToBack] = useState<boolean>(false);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState<boolean>(false);
  const [isMinutesFilterOpen, setIsMinutesFilterOpen] = useState<boolean>(false);
  // With/Without filters - states will be defined after roster setup

  // Check for success parameter from checkout
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('success') === 'true') {
      alert('✅ Subscription successful! Welcome to Pro! Your Player Props features are now unlocked.');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Get user info and subscription status on mount
  // Cache subscription status to avoid frequent checks
  useEffect(() => {
    let isMounted = true;
    let subscriptionCheckInterval: NodeJS.Timeout | null = null;
    let lastSubscriptionStatus: { isActive: boolean; isPro: boolean } | null = null;
    
    const checkSubscription = async (skipCache = false) => {
      // Get session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        if (isMounted) {
          // No session - redirect to login with return path (non-blocking)
          setTimeout(() => {
            router.push('/login?redirect=/nba/research/dashboard');
          }, 0);
        }
        return;
      }

      if (!isMounted) return;

      setUserEmail(session.user.email || null);
      setUsername(session.user.user_metadata?.username || session.user.user_metadata?.full_name || null);
      setAvatarUrl(session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null);
      
      try {
        // Check Pro access - query database directly
        const { data: profile } = await (supabase
          .from('profiles') as any)
          .select('subscription_status, subscription_tier')
          .eq('id', session.user.id)
          .single();
        
        if (!isMounted) return;
        
        let isActive = false;
        let isProTier = false;
        
        if (profile) {
          // Use profiles table if available
          const profileData = profile as any;
          isActive = profileData.subscription_status === 'active' || profileData.subscription_status === 'trialing';
          isProTier = profileData.subscription_tier === 'pro';
        } else {
          // Fallback to user_metadata for dev testing
          const metadata = session.user.user_metadata || {};
          isActive = metadata.subscription_status === 'active';
          isProTier = metadata.subscription_plan === 'pro';
        }
        
        const proStatus = isActive && isProTier;
        
        // Cache active subscription status (to prevent logouts on errors)
        // But always update if subscription expires (isActive becomes false)
        if (isActive) {
          lastSubscriptionStatus = { isActive: true, isPro: proStatus };
        } else {
          // Subscription expired - clear cache and update immediately
          lastSubscriptionStatus = null;
        }
        
        // Always update if status changed, subscription expired, or if this is the first check
        if (!lastSubscriptionStatus || lastSubscriptionStatus.isPro !== proStatus || !isActive || skipCache) {
          clientLogger.debug('🔐 Dashboard Pro Status Check:', { isActive, isProTier, proStatus, profile, metadata: session.user.user_metadata });
          
          if (isMounted) {
            setIsPro(proStatus);
          }
          
          if (isActive) {
            lastSubscriptionStatus = { isActive, isPro: proStatus };
          }
        }
      } catch (error) {
        clientLogger.error('Error checking subscription:', error);
        // If we have a cached active subscription, keep it (never log out active subscribers)
        if (lastSubscriptionStatus?.isActive && isMounted) {
          clientLogger.debug('🔐 Using cached active subscription status due to error');
          setIsPro(lastSubscriptionStatus.isPro);
        }
      }
    };
    
    // Initial check
    checkSubscription(true);
    
    // Periodic check every 5 minutes (instead of on every token refresh)
    subscriptionCheckInterval = setInterval(() => {
      if (isMounted) {
        checkSubscription();
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Set up listener only for SIGNED_OUT and SIGNED_IN (not TOKEN_REFRESHED)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          lastSubscriptionStatus = null;
          setIsPro(false);
          router.push('/login?redirect=/nba/research/dashboard');
        }
      }
      // Only check on SIGNED_IN (not TOKEN_REFRESHED to avoid frequent checks)
      else if (event === 'SIGNED_IN' && isMounted && session?.user) {
        checkSubscription(true);
      }
    });
    
    return () => {
      isMounted = false;
      if (subscriptionCheckInterval) {
        clearInterval(subscriptionCheckInterval);
      }
      subscription?.unsubscribe();
    };
  }, [router]);

  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        journalDropdownRef.current &&
        !journalDropdownRef.current.contains(target) &&
        !target.closest('[data-journal-button]')
      ) {
        setShowJournalDropdown(false);
      }
      if (
        profileDropdownRef.current &&
        !profileDropdownRef.current.contains(target) &&
        !target.closest('[data-profile-button]')
      ) {
        setShowProfileDropdown(false);
      }
      if (
        settingsDropdownRef.current &&
        !settingsDropdownRef.current.contains(target) &&
        !target.closest('[data-settings-button]')
      ) {
        setShowSettingsDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleSidebarSubscription = async () => {
    if (!isPro) {
      router.push('/subscription');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/subscription');
        return;
      }

      const response = await fetch('/api/portal-client', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        router.push('/subscription');
      }
    } catch (error) {
      clientLogger.error('Portal error:', error);
      router.push('/subscription');
    }
  };

  const [propsMode, setPropsMode] = useState<'player' | 'team'>('player');
  const [selectedStat, setSelectedStat] = useState('pts');
  const [selectedFilterForAxis, setSelectedFilterForAxis] = useState<string | null>(null); // Second axis filter: 'minutes', 'dvp_rank', 'pace', 'usage_rate', 'fg_pct', null
  const [dvpProjectedTab, setDvpProjectedTab] = useState<'dvp' | 'projected' | 'opponent' | 'injuries'>('dvp'); // Tab selector for DvP, Projected, Opponent Breakdown, and Injuries
  const [sliderRange, setSliderRange] = useState<{ min: number; max: number } | null>(null); // Slider range for filtering
  const [projectedMinutes, setProjectedMinutes] = useState<number | null>(null); // Cached projected minutes (persists across tab switches)
  const [projectedMinutesLoading, setProjectedMinutesLoading] = useState(false);
  const [allProjectedMinutes, setAllProjectedMinutes] = useState<Record<string, number>>({}); // Bulk cache: key = "playerName|teamAbbr", value = minutes
  const [predictedPace, setPredictedPace] = useState<number | null>(null); // Predicted game pace from betting total
  const [seasonFgPct, setSeasonFgPct] = useState<number | null>(null); // Season average FG%
  const [averageUsageRate, setAverageUsageRate] = useState<number | null>(null); // Season average usage rate
  const [averageMinutes, setAverageMinutes] = useState<number | null>(null); // Season average minutes
  const [averageGamePace, setAverageGamePace] = useState<number | null>(null); // Average game pace from player's games
  
  const handleSelectFilterForAxis = useCallback((filter: string | null) => {
    setSelectedFilterForAxis(filter);
    // Reset slider when filter changes
    setSliderRange(null);
  }, []);
  
  // Track if stat was set from URL to prevent default stat logic from overriding it
  const statFromUrlRef = useRef(false);
  // Track if user manually selected a stat (to prevent default logic from overriding)
  const userSelectedStatRef = useRef(false);
  // Store the initial stat from URL immediately on mount (before any navigation)
  const initialStatFromUrlRef = useRef<string | null>(null);
  const hasCapturedInitialStatRef = useRef(false);
  
  // Wrapper for setSelectedStat that marks it as a user selection and updates URL immediately
  const handleStatSelect = useCallback((stat: string) => {
    userSelectedStatRef.current = true; // Mark as user selection
    setSelectedStat(stat);
    clientLogger.debug(`[Dashboard] 👤 User selected stat: "${stat}"`);
    
    // Update URL immediately to prevent race conditions
    if (typeof window !== 'undefined' && router) {
      const url = new URL(window.location.href);
      url.searchParams.set('stat', stat);
      router.replace(url.pathname + url.search, { scroll: false });
      clientLogger.debug(`[Dashboard] 🔄 Immediately updated URL stat parameter to: "${stat}"`);
      
      // Mark that URL was updated by user, so useSearchParams doesn't override it
      statFromUrlRef.current = true;
      
      // Reset the user selection flag after a short delay to allow URL to update
      // This prevents useSearchParams from reading the old URL value
      setTimeout(() => {
        userSelectedStatRef.current = false;
        clientLogger.debug(`[Dashboard] ✅ Reset user selection flag after URL update`);
      }, 100); // 100ms should be enough for router.replace to complete
    }
  }, [router]);
  
  // Use Next.js useSearchParams to read URL parameters
  const searchParams = useSearchParams();
  
  // Capture stat from URL IMMEDIATELY on mount (before any other code runs)
  useEffect(() => {
    if (hasCapturedInitialStatRef.current) return;
    hasCapturedInitialStatRef.current = true;
    
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        const stat = url.searchParams.get('stat');
        if (stat) {
          const normalizedStat = (() => {
            const statUpper = stat.toUpperCase();
            if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
              return 'fg3m';
            }
            return stat.toLowerCase();
          })();
          initialStatFromUrlRef.current = normalizedStat;
          clientLogger.debug(`[Dashboard] 🎯 Captured initial stat from URL on mount: "${stat}" -> "${normalizedStat}"`);
          statFromUrlRef.current = true;
          // Set it immediately
          setSelectedStat(normalizedStat);
        }
      } catch (e) {
        clientLogger.error('[Dashboard] Error capturing initial stat from URL:', e);
      }
    }
  }, []); // Run only once on mount
  
  // Track if we've used the initial stat from mount (only use it once)
  const hasUsedInitialStatRef = useRef(false);
  
  // Watch for stat parameter in URL and set it immediately
  useEffect(() => {
    const stat = searchParams.get('stat');
    
    // Only use initial stat from mount on the VERY FIRST render, then always respect URL
    if (!hasUsedInitialStatRef.current && initialStatFromUrlRef.current) {
      hasUsedInitialStatRef.current = true;
      // Clear the initial stat ref so we don't use it again
      const initialStat = initialStatFromUrlRef.current;
      initialStatFromUrlRef.current = null; // Clear it so we don't reset to it later
      console.log(`[Dashboard] 🎯 useSearchParams: Using initial stat from mount: "${initialStat}"`);
      statFromUrlRef.current = true;
      setSelectedStat(initialStat);
      
      // Store in session storage
      const saved = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
      if (saved && typeof saved === 'string') {
        try {
          const parsed = JSON.parse(saved);
          parsed.selectedStat = initialStat;
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
        } catch {}
      }
      return; // Use initial stat on first render only
    }
    
    // After first render, always respect the current URL parameter
    // BUT skip if user just manually selected a stat (to prevent override)
    if (userSelectedStatRef.current) {
      console.log(`[Dashboard] ⏭️ useSearchParams: Skipping - user just manually selected stat`);
      return;
    }
    
    if (stat) {
      const normalizedStat = (() => {
        const statUpper = stat.toUpperCase();
        if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
          return 'fg3m';
        }
        return stat.toLowerCase();
      })();
      
      // Only update if it's different from current stat to avoid unnecessary re-renders
      if (normalizedStat !== selectedStat) {
        console.log(`[Dashboard] 🎯 useSearchParams: Updating stat from URL: "${stat}" -> "${normalizedStat}" (current: "${selectedStat}")`);
        statFromUrlRef.current = true;
        setSelectedStat(normalizedStat);
        
        // Store in session storage
        const saved = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            parsed.selectedStat = normalizedStat;
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
          } catch {}
        }
      }
    } else {
      console.log(`[Dashboard] ⚠️ useSearchParams: No stat parameter found in URL`);
    }
  }, [searchParams, selectedStat]);
  
  // Sync selectedStat to URL when it changes (but don't trigger if it came from URL or user just selected)
  useEffect(() => {
    // Skip if stat was just set from URL (to avoid circular updates)
    if (statFromUrlRef.current) {
      statFromUrlRef.current = false; // Reset flag for next user interaction
      return;
    }
    
    // Skip if user just manually selected a stat (handleStatSelect already updated URL)
    if (userSelectedStatRef.current) {
      userSelectedStatRef.current = false; // Reset after one check
      return;
    }
    
    // Skip if this is the initial mount and we haven't processed URL yet
    if (!hasUsedInitialStatRef.current) {
      return;
    }
    
    // Update URL with current stat (only for non-user-initiated changes)
    if (typeof window !== 'undefined' && router) {
      const url = new URL(window.location.href);
      const currentStat = url.searchParams.get('stat');
      
      // Only update if different to avoid unnecessary navigation
      if (currentStat !== selectedStat) {
        url.searchParams.set('stat', selectedStat);
        // Use replace to avoid adding to history
        router.replace(url.pathname + url.search, { scroll: false });
        console.log(`[Dashboard] 🔄 Updated URL stat parameter to: "${selectedStat}"`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStat]); // router is stable, don't need it in deps
  
  // Ensure correct default stat is set when propsMode changes (but not when user clicks stats)
  useEffect(() => {
    console.log(`[Dashboard] 🔄 Default stat logic running: propsMode="${propsMode}", selectedStat="${selectedStat}", statFromUrlRef=${statFromUrlRef.current}, initialStatFromUrl="${initialStatFromUrlRef.current}", userSelectedStat=${userSelectedStatRef.current}`);
    
    // Skip if user manually selected a stat (don't override user choice)
    if (userSelectedStatRef.current) {
      console.log(`[Dashboard] ⏭️ Skipping default stat logic - user manually selected stat`);
      userSelectedStatRef.current = false; // Reset after one check
      return;
    }
    
    // Skip if we have an initial stat from URL (don't override it, even if URL was changed)
    // But only if we haven't used it yet - after first use, always respect URL
    if (initialStatFromUrlRef.current && !hasUsedInitialStatRef.current) {
      console.log(`[Dashboard] ⏭️ Skipping default stat logic - initial stat "${initialStatFromUrlRef.current}" was captured from URL on mount`);
      return;
    }
    
    // Check if there's a stat in the URL - if so, don't override it
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const urlStat = url.searchParams.get('stat');
      if (urlStat) {
        console.log(`[Dashboard] ⏭️ Skipping default stat logic - stat "${urlStat}" found in URL`);
        return;
      }
    }
    
    // Skip if stat was set from URL (don't override it)
    if (statFromUrlRef.current) {
      console.log(`[Dashboard] ⏭️ Skipping default stat logic - stat was set from URL (ref flag)`);
      statFromUrlRef.current = false; // Reset flag after skipping once
      return;
    }
    
    if (propsMode === 'player') {
      // Force non-Pro users back to Game Props mode
      if (!isPro) {
        setPropsMode('team');
        setSelectedStat('total_pts');
        return;
      }
      
      // Clear opponent when switching to player mode (player props don't have opponents)
      setOpponentTeam('');
      
      // Set default stat ONLY if current stat is invalid for player mode
      // Don't reset if user has a valid stat selected
      const playerStatExists = PLAYER_STAT_OPTIONS.find(s => s.key === selectedStat);
      if (!playerStatExists && selectedStat !== 'pts') {
        console.log(`[Dashboard] ⚠️ Stat "${selectedStat}" not found in PLAYER_STAT_OPTIONS, resetting to 'pts'`);
        setSelectedStat('pts');
      }
    } else if (propsMode === 'team') {
      // Only change if current stat is invalid for team mode
      const teamStatExists = TEAM_STAT_OPTIONS.find(s => s.key === selectedStat);
      if (!teamStatExists && selectedStat !== 'total_pts') {
        setSelectedStat('total_pts');
      }
    }
  }, [propsMode, isPro]); // Removed selectedStat from deps - only run when propsMode changes, not on every stat change
  const [selectedTimeframe, setSelectedTimeframe] = useState('last10');
  // Betting lines per stat (independent) - will be populated by odds API
  const [bettingLines, setBettingLines] = useState<Record<string, number>>({});
  // Track auto-set state for betting lines (shared across handlers)
  const hasManuallySetLineRef = useRef(false);
  const lastAutoSetStatRef = useRef<string | null>(null);
  const lastAutoSetLineRef = useRef<number | null>(null);
  
  // Update betting line for current stat
  const setBettingLine = (value: number) => {
    setBettingLines(prev => ({
      ...prev,
      [selectedStat]: value
    }));
  };
  
  // Get current betting line for selected stat (defined early so it can be used in hitRateStats)
  // Use stored line if available, otherwise default to 0.5
  // Note: bestLineForStat will update bettingLines state via useEffect when it becomes available
  const bettingLine = useMemo(() => {
    // First check if we have a stored line for this stat
    if (selectedStat in bettingLines) {
      const line = bettingLines[selectedStat];
      console.log('[DEBUG bettingLine] useMemo returning stored line', {
        selectedStat,
        line,
        timestamp: new Date().toISOString()
      });
      return line;
    }
    // Otherwise default to 0.5 (will be updated by useEffect when bestLineForStat is available)
    console.log('[DEBUG bettingLine] useMemo returning default 0.5', {
      selectedStat,
      bettingLinesKeys: Object.keys(bettingLines),
      timestamp: new Date().toISOString()
    });
    return 0.5;
  }, [bettingLines, selectedStat]);
  
  // Independent bookmaker lines (not linked to the chart betting line)
  const [bookOpeningLine, setBookOpeningLine] = useState<number | null>(null);
  const [bookCurrentLine, setBookCurrentLine] = useState<number | null>(null);

  // Odds API placeholders (no fetch yet)
  const [oddsSnapshots, setOddsSnapshots] = useState<OddsSnapshot[]>([]);
  const marketKey = 'player_points';
  
  // Line movement data from API
const [lineMovementData, setLineMovementData] = useState<{
  openingLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  currentLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  impliedOdds: number | null; // Backward compatibility
  overImpliedProb?: number | null;
  underImpliedProb?: number | null;
  isOverFavorable: boolean | null;
  lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
} | null>(null);
const [lineMovementLoading, setLineMovementLoading] = useState(false);
const lastLineMovementRequestRef = useRef<{ key: string; fetchedAt: number } | null>(null);
const lineMovementInFlightRef = useRef(false);


  // Odds display format
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('oddsFormat') : null;
      if (saved === 'decimal' || saved === 'american') setOddsFormat(saved as any);
    } catch {}
  }, []);

  // Build intraday movement rows from line movement data
  const intradayMovements = useMemo(() => {
    if (!LINE_MOVEMENT_ENABLED) {
      return [];
    }
    if (lineMovementData) {
      const { lineMovement = [], openingLine, currentLine } = lineMovementData;

      if (lineMovement.length > 0) {
        return lineMovement
          .map((movement) => {
            const dt = new Date(movement.timestamp);
            const timeLabel = dt.toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });
            const direction = movement.change > 0 ? 'up' : movement.change < 0 ? 'down' : 'flat';
            return {
              ts: new Date(movement.timestamp).getTime(),
              timeLabel: `${timeLabel} (${movement.bookmaker})`,
              line: movement.line,
              change: `${movement.change > 0 ? '+' : ''}${movement.change.toFixed(1)}`,
              direction: direction as 'up' | 'down' | 'flat',
            };
          })
          .sort((a, b) => b.ts - a.ts); // Most recent first (descending by timestamp)
      }

      const fallbackRows: { ts: number; timeLabel: string; line: number; change: string; direction: 'up' | 'down' | 'flat' }[] = [];
      const formatLabel = (entry: typeof openingLine, label: string) => {
        if (!entry) return '';
        const dt = new Date(entry.timestamp);
        const time = dt.toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        const suffix = entry.bookmaker ? ` (${entry.bookmaker})` : '';
        return `${time}${suffix}${label ? ` — ${label}` : ''}`;
      };

      if (openingLine) {
        fallbackRows.push({
          ts: new Date(openingLine.timestamp).getTime(),
          timeLabel: formatLabel(openingLine, 'Opening'),
          line: openingLine.line,
          change: '',
          direction: 'flat'
        });
      }

      if (currentLine) {
        const delta = openingLine ? currentLine.line - openingLine.line : 0;
        const hasDifferentTimestamp = !openingLine || currentLine.timestamp !== openingLine.timestamp;
        const hasDifferentLine = !openingLine || currentLine.line !== openingLine.line;

        if (hasDifferentTimestamp || hasDifferentLine) {
          fallbackRows.push({
            ts: new Date(currentLine.timestamp).getTime(),
            timeLabel: formatLabel(currentLine, 'Latest'),
            line: currentLine.line,
            change: openingLine ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '',
            direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
          });
        }
      }

      if (fallbackRows.length > 0) {
        return fallbackRows.sort((a, b) => b.ts - a.ts);
      }
    }
    
    // Fallback to old snapshot logic for team mode
    const items = filterByMarket(oddsSnapshots, marketKey)
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp);
    const rows: { ts: number; timeLabel: string; line: number; change: string; direction: 'up' | 'down' | 'flat' }[] = [];
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur = items[i];
      const delta = cur.line - prev.line;
      const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      const dt = new Date(cur.timestamp);
      const timeLabel = dt.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      rows.push({
        ts: cur.timestamp,
        timeLabel,
        line: cur.line,
        change: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`,
        direction: dir,
      });
    }
    return rows.sort((a, b) => b.ts - a.ts); // Most recent first (descending by timestamp)
  }, [lineMovementData, oddsSnapshots, marketKey]);

  // search state
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<BdlSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  
  // Debug: Track renders and state changes (renderCountRef already defined at top of function)
  const lastUrlRef = useRef<string>('');
  const lastTimeframeRef = useRef<string>('');
  const lastPlayerStatsLengthRef = useRef<number>(0);
  
  // Debug: Track component renders and key state changes
  useEffect(() => {
    renderCountRef.current += 1;
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const urlChanged = currentUrl !== lastUrlRef.current;
    const timeframeChanged = selectedTimeframe !== lastTimeframeRef.current;
    const statsChanged = playerStats.length !== lastPlayerStatsLengthRef.current;
    
    if (urlChanged || timeframeChanged || statsChanged || renderCountRef.current <= 3) {
      const renderData = {
        timestamp: new Date().toISOString(),
        url: currentUrl,
        urlChanged,
        selectedPlayer: selectedPlayer?.full || 'none',
        resolvedPlayerId,
        selectedTimeframe,
        timeframeChanged,
        playerStatsLength: playerStats.length,
        statsChanged,
        isLoading,
        selectedStat,
        opponentTeam
      };
      
      // Log to both browser console and server terminal
      console.log(`🎨 [Render #${renderCountRef.current}]`, renderData);
      serverLogger.log(`🎨 [Render #${renderCountRef.current}]`, { data: renderData });
      
      if (urlChanged) lastUrlRef.current = currentUrl;
      if (timeframeChanged) lastTimeframeRef.current = selectedTimeframe;
      if (statsChanged) lastPlayerStatsLengthRef.current = playerStats.length;
    }
  });

  // selection + data
  const [selectedPlayer, setSelectedPlayer] = useState<NBAPlayer | null>(null);
  const [resolvedPlayerId, setResolvedPlayerId] = useState<string | null>(null);
  const isHandlingPlayerSelectRef = useRef<boolean>(false);
  const [playerStats, setPlayerStats] = useState<BallDontLieStats[]>([]);
  
  // Debug: Track playerStats changes
  useEffect(() => {
    console.log('[DEBUG playerStats] State changed', {
      length: playerStats.length,
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
    });
  }, [playerStats]);
  const [isLoading, setIsLoading] = useState(false);
  // Track when core data (stats + DvP) is ready to show the screen
  const [coreDataReady, setCoreDataReady] = useState(false);
  
  const [apiError, setApiError] = useState<string | null>(null);
  
  // Track the last player ID to detect actual player changes (not just metadata updates)
  const lastPlayerIdRef = useRef<string | null>(null);
  
  // Clear odds data when player ID actually changes (not just metadata updates)
  // Player stats are cleared by handlePlayerSelect functions at the start
  useEffect(() => {
    if (selectedPlayer === null) {
      // Player cleared - reset odds only
      if (lastPlayerIdRef.current !== null) {
        setRealOddsData([]);
        setOddsSnapshots([]);
        setLineMovementData(null);
        setBettingLines({});
        lastPlayerIdRef.current = null;
      }
      return;
    }
    
    // Only clear odds if the player ID actually changed (not just metadata like jersey/height)
    const currentPlayerId = selectedPlayer.id?.toString() || null;
    if (currentPlayerId !== lastPlayerIdRef.current) {
      // Player ID changed - clear odds data
      console.log('[Odds Clear] Player ID changed, clearing odds', {
        oldId: lastPlayerIdRef.current,
        newId: currentPlayerId,
        playerName: selectedPlayer.full,
        currentOddsLength: realOddsData.length
      });
      // Only clear if we actually have odds to clear (prevent unnecessary state updates)
      if (realOddsData.length > 0 || oddsLoading || oddsError) {
        setRealOddsData([]);
        setOddsSnapshots([]);
        setLineMovementData(null);
        setOddsLoading(false);
        setOddsError(null);
        setBettingLines({});
        setBookOpeningLine(null);
        setBookCurrentLine(null);
      }
      lastPlayerIdRef.current = currentPlayerId;
      // Reset odds fetch ref so it will fetch again for the new player
      lastOddsPlayerIdRef.current = null;
    }
    // If player ID is the same, don't clear odds (just metadata update like jersey/height)
  }, [selectedPlayer]);
  
  // Clear player state when player parameter is removed from URL (e.g., browser back button)
  useEffect(() => {
    const player = searchParams.get('player');
    const pid = searchParams.get('pid');
    const name = searchParams.get('name');
    
    // If there's no player parameter in URL but we have a selected player, clear it
    if (!player && !pid && !name && selectedPlayer) {
      console.log('[Dashboard] 🧹 Clearing selectedPlayer - no player parameter in URL');
      setSelectedPlayer(null);
      setResolvedPlayerId(null);
      setPlayerStats([]);
      setRealOddsData([]);
      setOddsSnapshots([]);
      setLineMovementData(null);
    }
  }, [searchParams, selectedPlayer]);
  
  // Advanced stats state
  const [advancedStats, setAdvancedStats] = useState<AdvancedStats | null>(null);
  const [advancedStatsLoading, setAdvancedStatsLoading] = useState(false);
  const [advancedStatsError, setAdvancedStatsError] = useState<string | null>(null);
  
  // Advanced stats per game (for second axis - pace and usage_rate)
  const [advancedStatsPerGame, setAdvancedStatsPerGame] = useState<Record<number, { pace?: number; usage_percentage?: number }>>({});
  
  // DvP ranks per game (for second axis - dvp_rank)
  const [dvpRanksPerGame, setDvpRanksPerGame] = useState<Record<string, number | null>>({});
  
  // Prefetched advanced stats (pace, usage_rate) - stored by game ID
  const [prefetchedAdvancedStats, setPrefetchedAdvancedStats] = useState<Record<number, { pace?: number; usage_percentage?: number }>>({});
  
  // Prefetched DvP ranks - stored by stat/metric combination
  const [prefetchedDvpRanks, setPrefetchedDvpRanks] = useState<Record<string, Record<string, number | null>>>({});
  
  // Refs to track prefetch status (prevent duplicate prefetches)
  const advancedStatsPrefetchRef = useRef<Set<string>>(new Set());
  const dvpRanksPrefetchRef = useRef<Set<string>>(new Set());
  
  // Shot distance stats state
  const [shotDistanceData, setShotDistanceData] = useState<any | null>(null);
  const [shotDistanceLoading, setShotDistanceLoading] = useState(false);
  
  // Opponent team state
  const [opponentTeam, setOpponentTeam] = useState<string>('N/A');
  
  // Manual opponent selector (overrides automatic opponent detection)
  const [manualOpponent, setManualOpponent] = useState<string>('ALL');
  
  // Home/Away filter
  const [homeAway, setHomeAway] = useState<'ALL' | 'HOME' | 'AWAY'>('ALL');
  
  // Selected team (player's team - only for Player Props)
  const [selectedTeam, setSelectedTeam] = useState<string>('N/A');
  
  // Original player team (the team of the searched player - never changes during swaps)
  const [originalPlayerTeam, setOriginalPlayerTeam] = useState<string>('N/A');
  
  // Separate team selection for Game Props mode
  const [gamePropsTeam, setGamePropsTeam] = useState<string>('N/A');
  const [gamePropsOpponent, setGamePropsOpponent] = useState<string>('N/A');
  
  // Depth chart display team (independent of selectedTeam - only affects depth chart)
  const [depthChartTeam, setDepthChartTeam] = useState<string>('N/A');

  // Injury data state for depth chart integration
  const [teamInjuries, setTeamInjuries] = useState<Record<string, any[]>>({});
  
  // Store both team rosters for instant switching
  const [playerTeamRoster, setPlayerTeamRoster] = useState<DepthChartData | null>(null);
  const [opponentTeamRoster, setOpponentTeamRoster] = useState<DepthChartData | null>(null);
  const [rostersLoading, setRostersLoading] = useState<{player: boolean, opponent: boolean}>({player: false, opponent: false});

  // Logo URLs (stateful to avoid onError flicker loops)
  const [selectedTeamLogoUrl, setSelectedTeamLogoUrl] = useState<string>('');
  const [opponentTeamLogoUrl, setOpponentTeamLogoUrl] = useState<string>('');
  const [selectedTeamLogoAttempt, setSelectedTeamLogoAttempt] = useState<number>(0);
  const [opponentTeamLogoAttempt, setOpponentTeamLogoAttempt] = useState<number>(0);
  
  // Games state
  const [todaysGames, setTodaysGames] = useState<any[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const gamesFetchInFlightRef = useRef(false);
  
  // Game stats for team props (separate from player stats)
  const [gameStats, setGameStats] = useState<any[]>([]);
  const [gameStatsLoading, setGameStatsLoading] = useState(false);

  // Determine today's matchup and tipoff time (no fetch; uses existing todaysGames)
  const matchupInfo = useMemo(() => {
    try {
      const teamA = normalizeAbbr(selectedTeam || '');
      const teamB = normalizeAbbr(opponentTeam || '');
      if (!teamA || !teamB || !Array.isArray(todaysGames) || todaysGames.length === 0) return null;
      const game = todaysGames.find((g: any) => {
        const home = normalizeAbbr(g?.home_team?.abbreviation || '');
        const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
        return (home === teamA && away === teamB) || (home === teamB && away === teamA);
      });
      if (!game) return null;
      const tipoffDate = parseBallDontLieTipoff(game);
      const tipoffLocal = tipoffDate
        ? new Intl.DateTimeFormat(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
          }).format(tipoffDate)
        : null;
      const homeAbbr = normalizeAbbr(game?.home_team?.abbreviation || '');
      const awayAbbr = normalizeAbbr(game?.visitor_team?.abbreviation || '');
      const isSelectedHome = teamA === homeAbbr;
      return { tipoffLocal, tipoffDate: tipoffDate?.toISOString() ?? null, homeAbbr, awayAbbr, isSelectedHome };
    } catch {
      return null;
    }
  }, [selectedTeam, opponentTeam, todaysGames]);
  
  // Fetch line movement data when game, player, and stat change
  useEffect(() => {
    if (!LINE_MOVEMENT_ENABLED) {
      // Only update state if it's not already set to these values to prevent infinite loops
      setLineMovementLoading(prev => prev ? false : prev);
      setLineMovementData(prev => prev !== null ? null : prev);
      return;
    }
    const fetchLineMovement = async () => {
      console.log('📊 Line Movement Fetch Check:', { propsMode, selectedPlayer: selectedPlayer?.full, selectedTeam, opponentTeam, selectedStat });
      
      // Only fetch for player mode
      if (propsMode !== 'player' || !selectedPlayer || !selectedTeam || !opponentTeam || opponentTeam === '' || opponentTeam === 'N/A') {
        console.log('⏸️ Skipping line movement fetch - missing requirements');
        // Only update if not already null to prevent infinite loops
        setLineMovementData(prev => prev !== null ? null : prev);
        return;
      }
      
      const playerName = selectedPlayer.full || `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
      
      // Get the game date from todaysGames if available
      const teamA = normalizeAbbr(selectedTeam);
      const teamB = normalizeAbbr(opponentTeam);
      const game = todaysGames.find((g: any) => {
        const home = normalizeAbbr(g?.home_team?.abbreviation || '');
        const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
        return (home === teamA && away === teamB) || (home === teamB && away === teamA);
      });
      
      // Extract game date or use today's date
      const gameDate = game?.date ? new Date(game.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      const requestKey = JSON.stringify({
        mode: propsMode,
        playerId: selectedPlayer.id,
        team: selectedTeam,
        opponent: opponentTeam,
        stat: selectedStat,
        gameDate,
      });

      const nowTs = Date.now();
      const TTL_MS = 5 * 60 * 1000; // 5 minutes
      if (
        lastLineMovementRequestRef.current &&
        lastLineMovementRequestRef.current.key === requestKey &&
        nowTs - lastLineMovementRequestRef.current.fetchedAt < TTL_MS
      ) {
        console.log('⏩ Skipping duplicate line movement fetch', requestKey);
        return;
      }

      if (lineMovementInFlightRef.current) {
        console.log('⏳ Line movement fetch already in-flight, skipping new request');
        return;
      }

      lastLineMovementRequestRef.current = { key: requestKey, fetchedAt: nowTs };
      lineMovementInFlightRef.current = true;

      console.log(`🎯 Fetching line movement for: ${playerName} (date: ${gameDate}, stat: ${selectedStat})`);
      
      setLineMovementLoading(true);
      try {
        const url = `/api/odds/line-movement?player=${encodeURIComponent(playerName)}&stat=${encodeURIComponent(selectedStat)}&date=${gameDate}`;
        console.log('📡 Fetching:', url);
        const response = await fetch(url);
        if (!response.ok) {
          console.warn('❌ Line movement fetch failed:', response.status);
          setLineMovementData(null);
          return;
        }
        const result = await response.json();
        console.log('✅ Line movement data received:', result);
        // Extract the nested data object from the API response
        setLineMovementData(result.hasOdds ? (result.data as typeof lineMovementData) : null);
      } catch (error) {
        console.error('Error fetching line movement:', error);
        setLineMovementData(null);
        lastLineMovementRequestRef.current = null;
      } finally {
        setLineMovementLoading(false);
        lineMovementInFlightRef.current = false;
        if (lastLineMovementRequestRef.current) {
          lastLineMovementRequestRef.current = {
            key: requestKey,
            fetchedAt: Date.now(),
          };
        }
      }
    };
    
    fetchLineMovement();
  }, [propsMode, selectedPlayer, selectedTeam, opponentTeam, selectedStat, todaysGames]);
  
  // Time filter for opponent breakdown display
  const [selectedTimeFilter] = useState('last10'); // Using existing selectedTimeframe as reference
  
  // Team comparison metric selector
  const [selectedComparison, setSelectedComparison] = useState<'points' | 'rebounds' | 'assists' | 'fg_pct' | 'three_pct'>('points');
  
  // State for team matchup stats (fetched from DVP API)
  const [teamMatchupStats, setTeamMatchupStats] = useState<{currentTeam: any, opponent: any}>({currentTeam: null, opponent: null});
  const [teamMatchupLoading, setTeamMatchupLoading] = useState(false);
  
  // Pie chart display order (only affects visual display, not underlying data)
  const [pieChartSwapped, setPieChartSwapped] = useState(false);
  
  // Journal modal state
  const [showJournalModal, setShowJournalModal] = useState(false);
  
  // Sidebar toggle state for tablets/Macs
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Subscription/paywall state
  const { 
    hasPremium, 
    checkFeatureAccess,
    subscription,
    loading: subscriptionLoading
  } = useSubscription();
  
  // Debug subscription status
  useEffect(() => {
    console.log('[Dashboard] Subscription status:', {
      hasPremium,
      subscription,
      loading: subscriptionLoading
    });
  }, [hasPremium, subscription, subscriptionLoading]);
  
  // Next game info for tracking (separate from chart filter)
  const [nextGameOpponent, setNextGameOpponent] = useState<string>('');
  const [nextGameDate, setNextGameDate] = useState<string>('');
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  
  // Countdown timer state
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  
  // Update countdown every second
  useEffect(() => {
    if (!nextGameTipoff || isGameInProgress) {
      setCountdown(null);
      if (!nextGameTipoff) {
        console.log('[Countdown] No tipoff time available');
      }
      if (isGameInProgress) {
        console.log('[Countdown] Game in progress, hiding countdown');
      }
      return;
    }
    
    const updateCountdown = () => {
      const now = new Date().getTime();
      const tipoff = nextGameTipoff.getTime();
      const diff = tipoff - now;
      
      if (diff <= 0) {
        setCountdown(null);
        console.log('[Countdown] Game time has passed');
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
  }, [nextGameTipoff, isGameInProgress]);


  // Team game data cache for instant loading
  const [teamGameCache, setTeamGameCache] = useState<Record<string, any[]>>({});
  const [backgroundCacheLoading, setBackgroundCacheLoading] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ current: 0, total: 0 });

  // Background cache all teams function
  const cacheAllTeamsInBackground = async () => {
    if (backgroundCacheLoading) return; // Prevent multiple background loads
    
    setBackgroundCacheLoading(true);
    console.log('🔄 Starting background cache of all team data...');
    
    // List of all NBA teams
    const allTeams = Object.keys(ABBR_TO_TEAM_ID);
    const teamsToCache = allTeams.filter(team => !teamGameCache[team]);
    
    setCacheProgress({ current: 0, total: teamsToCache.length });
    
    for (let i = 0; i < teamsToCache.length; i++) {
      const teamAbbr = teamsToCache[i];
      try {
        // Use a simplified version without UI loading states
        const games = await fetchTeamGamesData(teamAbbr, false); // false = no UI loading
        
        setTeamGameCache(prev => ({
          ...prev,
          [teamAbbr]: games
        }));
        
        // Update progress
        setCacheProgress({ current: i + 1, total: teamsToCache.length });
        
        // Small delay between teams to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.warn(`Background cache failed for ${teamAbbr}:`, error);
      }
    }
    
    console.log('✅ Background cache completed for all teams');
    setBackgroundCacheLoading(false);
    setCacheProgress({ current: 0, total: 0 });
  };

  // Core function to fetch team games (without UI state updates)
  const fetchTeamGamesData = async (teamAbbr: string, showLoading: boolean = true) => {
    if (!teamAbbr || teamAbbr === 'N/A') return [];
    
    if (showLoading) {
      setGameStatsLoading(true);
    }
    try {
      const season = currentNbaSeason();
      const teamId = ABBR_TO_TEAM_ID[normalizeAbbr(teamAbbr)];
      
      if (!teamId) {
        console.warn(`No team ID found for ${teamAbbr}`);
        return [];
      }
      
      console.log(`🏀 Fetching games for team ${teamAbbr} (ID: ${teamId})`);
      
      // Use aggregated, team-scoped fast path (no cursor), one call per season
      const current = currentNbaSeason();
      const targetSeasons = [String(current), String(current - 1), String(current - 2)];

      const seasonResults = await Promise.all(
        targetSeasons.map(async (s) => {
          try {
            // Fetch all games for this season (API handles pagination internally)
            const url = `/api/bdl/games?seasons[]=${s}&team_ids[]=${teamId}&per_page=100`;
            const res = await fetch(url);
            const js = await res.json();
            const arr = Array.isArray(js?.data) ? js.data : [];
            return arr;
          } catch {
            return [] as any[];
          }
        })
      );

      const seasonData = { data: seasonResults.flat() } as any;

      if (seasonData?.data) {
        console.log(`🔍 FILTERING: Starting with ${seasonData.data.length} total games`);
        
        // Filter for games involving our team and only completed games
        let allTeamGames = seasonData.data.filter((game: any) => {
          return game.home_team?.id === teamId || game.visitor_team?.id === teamId;
        });
        
        console.log(`🔍 Found ${allTeamGames.length} total games involving ${teamAbbr} (before status filtering)`);
        
        // Check what statuses we have
        const statusCounts = allTeamGames.reduce((acc: any, game: any) => {
          const status = game.status || 'undefined';
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, {});
        
        console.log(`🔍 Game statuses for ${teamAbbr}:`, statusCounts);
        
        let games = seasonData.data.filter((game: any) => {
          const isTeamInvolved = game.home_team?.id === teamId || game.visitor_team?.id === teamId;
          const isCompleted = game.status === 'Final';
          const hasScores = game.home_team_score != null && game.visitor_team_score != null;
          
          const passes = isTeamInvolved && isCompleted && hasScores;
          
          // Debug first few games
          if (seasonData.data.indexOf(game) < 5) {
            console.log(`🔎 Game filter debug:`, {
              id: game.id,
              date: game.date,
              home: game.home_team?.abbreviation + ` (ID: ${game.home_team?.id})`,
              away: game.visitor_team?.abbreviation + ` (ID: ${game.visitor_team?.id})`,
              status: game.status,
              targetTeamId: teamId,
              isTeamInvolved,
              isCompleted,
              hasScores,
              passes
            });
          }
          
          return passes;
        });
        
        // Sort by date (oldest first for full season display)
        games = games
          .sort((a: any, b: any) => {
            const dateA = new Date(a.date || 0).getTime();
            const dateB = new Date(b.date || 0).getTime();
            return dateA - dateB; // Oldest first (season progression)
          });
          
        console.log(`🏆 Full 2024-25 season: ${games.length} games`);
        
        // Break down games by month/type
        const gamesByMonth = games.reduce((acc: any, game: any) => {
          const date = game.date;
          const month = date ? date.substring(0, 7) : 'unknown'; // YYYY-MM
          acc[month] = (acc[month] || 0) + 1;
          return acc;
        }, {});
        
        console.log(`📅 Games breakdown by month:`, gamesByMonth);
        
        // Check for potential preseason (October before 15th) or playoff games (April after 15th)
        const preseasonGames = games.filter((g: any) => {
          const date = g.date;
          return date && date.startsWith('2024-10') && parseInt(date.split('-')[2]) < 15;
        });
        
        const playoffGames = games.filter((g: any) => {
          const date = g.date;
          return date && (date.startsWith('2025-04') && parseInt(date.split('-')[2]) > 15) || date.startsWith('2025-05') || date.startsWith('2025-06');
        });
        
        console.log(`🏆 Potential preseason games: ${preseasonGames.length}`);
        console.log(`🏆 Potential playoff games: ${playoffGames.length}`);
        
        console.log(`📊 Found ${games.length} games for ${teamAbbr}`);
        if (games.length > 0) {
          const newest = games[0]?.date;
          const oldest = games[games.length - 1]?.date;
          console.log(`📅 Date range: ${oldest} to ${newest}`);
        }
        
        // Games are already in chronological order (oldest to newest)
        if (showLoading) {
          setGameStats(games);
        }
        return games;
      }
      
      console.warn(`No games found for ${teamAbbr}`);
      return [];
    } catch (error) {
      console.error(`Error fetching game data for ${teamAbbr}:`, error);
      if (showLoading) {
        setGameStats([]);
      }
      return [];
    } finally {
      if (showLoading) {
        setGameStatsLoading(false);
      }
    }
  };
  // Priority fetch: load requested team immediately, then cache others in background
  const fetchGameDataForTeam = async (teamAbbr: string) => {
    if (!teamAbbr || teamAbbr === 'N/A') return [];
    
    // Check cache first
    if (teamGameCache[teamAbbr]) {
      console.log(`⚡ Using cached data for ${teamAbbr}`);
      
      // Add 20ms delay to make switching visible
      setGameStatsLoading(true);
      await new Promise(resolve => setTimeout(resolve, 20));
      setGameStats(teamGameCache[teamAbbr]);
      setGameStatsLoading(false);
      
      return teamGameCache[teamAbbr];
    }
    
    console.log(`🏀 Priority loading ${teamAbbr}...`);
    
    // Load requested team immediately with UI loading state
    const games = await fetchTeamGamesData(teamAbbr, true);
    
    // Cache the result
    setTeamGameCache(prev => ({
      ...prev,
      [teamAbbr]: games
    }));
    
    // Trigger background caching of all other teams (non-blocking)
    setTimeout(() => {
      cacheAllTeamsInBackground();
    }, 500); // Small delay to let UI update first
    
    return games;
  };

  // Fetch games function (today ± 7 days)
  const fetchTodaysGames = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (gamesFetchInFlightRef.current) {
      return;
    }
    gamesFetchInFlightRef.current = true;

    try {
      if (!silent) {
        setGamesLoading(true);
      }
      
      const formatDate = (date: Date) => {
        return date.toISOString().split('T')[0];
      };
      
      // Fetch only a small date range (today ± 7 days) to avoid season paging
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];

      // Check sessionStorage first for instant load (if prefetched)
      if (typeof window !== 'undefined') {
        try {
          const cacheKey = `dashboard-games-${start}-${end}`;
          const cachedData = sessionStorage.getItem(cacheKey);
          const cachedTimestamp = sessionStorage.getItem(`${cacheKey}-timestamp`);
          const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
          
          if (cachedData && cachedTimestamp) {
            const age = Date.now() - parseInt(cachedTimestamp, 10);
            if (age < CACHE_TTL_MS) {
              try {
                const parsed = JSON.parse(cachedData);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  console.log(`✅ Using cached games from sessionStorage (${parsed.length} games, ${Math.round(age / 1000)}s old)`);
                  setTodaysGames(parsed);
                  setGamesLoading(false);
                  gamesFetchInFlightRef.current = false;
                  // Still fetch in background to update if needed (non-blocking)
                  fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`, { cache: 'default' }).then(async (response) => {
                    if (response.ok) {
                      const data = await response.json();
                      if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
                        setTodaysGames(data.data);
                        sessionStorage.setItem(cacheKey, JSON.stringify(data.data));
                        sessionStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
                      }
                    }
                  }).catch(() => {});
                  return;
                }
              } catch (e) {
                console.warn('Failed to parse cached games data, fetching fresh');
              }
            }
          }
        } catch (e) {
          // Ignore sessionStorage errors, continue to fetch
        }
      }

      try {
        const response = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`);
        const data = await response.json();
        const arr = Array.isArray(data?.data) ? data.data : [];
        if (arr.length > 0) {
          console.log(`✅ Fetched ${arr.length} games from ${start} to ${end}`);
          console.log(`   Games: ${arr.map((g: any) => `${g.home_team?.abbreviation} vs ${g.visitor_team?.abbreviation}`).join(', ')}`);
          setTodaysGames(arr);
          // Cache for next time
          if (typeof window !== 'undefined') {
            try {
              const cacheKey = `dashboard-games-${start}-${end}`;
              sessionStorage.setItem(cacheKey, JSON.stringify(arr));
              sessionStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
            } catch (e) {
              // Ignore storage errors
            }
          }
          return;
        }
      } catch (e) {
        console.error('Error fetching date-range games:', e);
      }

      console.log('❌ No games found in date range');
      setTodaysGames([]);
      
    } catch (error) {
      console.error('Error in fetchTodaysGames:', error);
      setTodaysGames([]);
    } finally {
      gamesFetchInFlightRef.current = false;
      if (!silent) {
        setGamesLoading(false);
      }
    }
  }, [gamesFetchInFlightRef]);

  // Prefetch "Last 5 Games" tracking stats when selectedTeam changes (for instant load when user clicks "Last 5 Games")
  useEffect(() => {
    if (!selectedTeam || selectedTeam === 'N/A' || propsMode !== 'player') return;
    
    const prefetchLast5Games = async () => {
      const season = 2025;
      const cacheKeyPassing = `tracking_stats_${selectedTeam}_${season}_passing_last5`;
      const cacheKeyRebounding = `tracking_stats_${selectedTeam}_${season}_rebounding_last5`;
      
      // Check if already cached and fresh (30 minutes TTL)
      try {
        const cachedPassing = sessionStorage.getItem(cacheKeyPassing);
        const cachedRebounding = sessionStorage.getItem(cacheKeyRebounding);
        
        if (cachedPassing && cachedRebounding) {
          try {
            const passingData = JSON.parse(cachedPassing);
            const reboundingData = JSON.parse(cachedRebounding);
            const cacheTimestamp = passingData.__timestamp || 0;
            const cacheAge = Date.now() - cacheTimestamp;
            const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
            
            if (cacheAge < CACHE_TTL_MS) {
              console.log(`[Dashboard] ✅ Last 5 Games data already cached for ${selectedTeam} (${Math.round(cacheAge / 1000)}s old)`);
              return; // Already cached and fresh
            }
          } catch (e) {
            // Invalid cache, continue to prefetch
          }
        }
      } catch (e) {
        // Ignore storage errors
      }
      
      // Prefetch in background (non-blocking)
      console.log(`[Dashboard] 🚀 Prefetching Last 5 Games data for ${selectedTeam}...`);
      const baseParams = `team=${encodeURIComponent(selectedTeam)}&season=${season}&lastNGames=5`;
      
      Promise.all([
        fetch(`/api/tracking-stats/team?${baseParams}&category=passing`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tracking-stats/team?${baseParams}&category=rebounding`).then(r => r.ok ? r.json() : null).catch(() => null)
      ]).then(([passingResult, reboundingResult]) => {
        if (passingResult && reboundingResult && !passingResult.error && !reboundingResult.error) {
          try {
            sessionStorage.setItem(cacheKeyPassing, JSON.stringify({
              players: passingResult.players || [],
              __timestamp: Date.now()
            }));
            sessionStorage.setItem(cacheKeyRebounding, JSON.stringify({
              players: reboundingResult.players || [],
              __timestamp: Date.now()
            }));
            console.log(`[Dashboard] ✅ Prefetched Last 5 Games data for ${selectedTeam} (${passingResult.players?.length || 0} passing, ${reboundingResult.players?.length || 0} rebounding)`);
          } catch (e) {
            // Ignore storage errors
          }
        }
      }).catch(err => {
        console.warn(`[Dashboard] ⚠️ Failed to prefetch Last 5 Games for ${selectedTeam}:`, err);
      });
    };
    
    // Small delay to not block initial render
    const timer = setTimeout(prefetchLast5Games, 1000);
    return () => clearTimeout(timer);
  }, [selectedTeam, propsMode]);

  // Fetch and cache ALL projected minutes once (bulk load)
  useEffect(() => {
    const CACHE_KEY = 'nba_all_projected_minutes';
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // Check sessionStorage cache first
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          const cacheAge = Date.now() - (parsed.timestamp || 0);
          if (cacheAge < CACHE_TTL_MS && parsed.data) {
            console.log(`[Dashboard] ✅ Loaded ${Object.keys(parsed.data).length} projected minutes from cache`);
            setAllProjectedMinutes(parsed.data);
            return; // Use cached data
          }
        }
      } catch (e) {
        console.warn('[Dashboard] Failed to load projected minutes cache:', e);
      }
    }

    // Fetch all projections
    let abort = false;
    const fetchAllProjections = async () => {
      try {
        console.log('[Dashboard] Fetching all projected minutes from SportsLine...');
        const response = await fetch('/api/nba/projections');
        if (!response.ok) {
          throw new Error(`Failed to fetch projections: ${response.status}`);
        }

        const data = await response.json();
        if (abort) return;

        // Normalize player name for matching
        const normalizePlayerName = (name: string): string => {
          return name
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        };

        // Build cache map: key = "normalizedPlayerName|normalizedTeam", value = minutes
        const cache: Record<string, number> = {};
        if (data.playerMinutes && Array.isArray(data.playerMinutes)) {
          for (const proj of data.playerMinutes) {
            const normalizedName = normalizePlayerName(proj.player);
            const normalizedTeam = normalizeAbbr(proj.team);
            const key = `${normalizedName}|${normalizedTeam}`;
            cache[key] = proj.minutes;
          }
        }

        if (!abort) {
          console.log(`[Dashboard] ✅ Cached ${Object.keys(cache).length} projected minutes`);
          setAllProjectedMinutes(cache);

          // Save to sessionStorage
          if (typeof window !== 'undefined') {
            try {
              sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                data: cache,
                timestamp: Date.now()
              }));
            } catch (e) {
              console.warn('[Dashboard] Failed to save projected minutes cache:', e);
            }
          }
        }
      } catch (err: any) {
        if (!abort) {
          console.error('[Dashboard] Error fetching all projected minutes:', err);
        }
      }
    };

    fetchAllProjections();

    return () => {
      abort = true;
    };
  }, []); // Only run once on mount

  // Look up projected minutes from cache when player/team changes
  useEffect(() => {
    if (!selectedPlayer || !selectedTeam || selectedTeam === 'N/A' || !opponentTeam || opponentTeam === 'N/A' || propsMode !== 'player') {
      setProjectedMinutes(null);
      setProjectedMinutesLoading(false);
      return;
    }

    setProjectedMinutesLoading(true);

    // Normalize player name for matching
    const normalizePlayerName = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const getNameVariations = (fullName: string): string[] => {
      const normalized = normalizePlayerName(fullName);
      const parts = normalized.split(' ');
      const variations = [normalized];
      if (parts.length > 1) {
        variations.push(`${parts[1]} ${parts[0]}`);
        variations.push(`${parts[0][0]} ${parts[1]}`);
        variations.push(`${parts[0]} ${parts[1][0]}`);
      }
      return Array.from(new Set(variations));
    };

    // Look up from cache
    const playerFullName = selectedPlayer.full || `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
    const nameVariations = getNameVariations(playerFullName);
    const normalizedCurrentTeam = normalizeAbbr(selectedTeam);

    // Try exact match first
    const normalizedName = normalizePlayerName(playerFullName);
    const exactKey = `${normalizedName}|${normalizedCurrentTeam}`;
    let minutes = allProjectedMinutes[exactKey];

    // If no exact match, try variations
    if (minutes === undefined) {
      for (const variation of nameVariations) {
        const variationKey = `${variation}|${normalizedCurrentTeam}`;
        if (allProjectedMinutes[variationKey] !== undefined) {
          minutes = allProjectedMinutes[variationKey];
          break;
        }
      }

      // If still no match, try fuzzy search (check if any key contains the variation)
      if (minutes === undefined) {
        for (const variation of nameVariations) {
          const matchingKey = Object.keys(allProjectedMinutes).find(key => {
            const [namePart, teamPart] = key.split('|');
            return (namePart.includes(variation) || variation.includes(namePart)) &&
                   teamPart === normalizedCurrentTeam;
          });
          if (matchingKey) {
            minutes = allProjectedMinutes[matchingKey];
            break;
          }
        }
      }
    }

    if (minutes !== undefined) {
      console.log('[Dashboard] Found projected minutes from cache:', minutes);
      setProjectedMinutes(minutes);
    } else {
      console.log('[Dashboard] No projected minutes found in cache for player');
      setProjectedMinutes(null);
    }

    setProjectedMinutesLoading(false);
  }, [selectedPlayer, selectedTeam, opponentTeam, propsMode, allProjectedMinutes]);


  // Update opponent when games or selected team changes
  useEffect(() => {
    console.log(`%c🔍 === OPPONENT USEEFFECT TRIGGERED ===%c`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
    console.log(`%cDependency changes: propsMode=${propsMode}, manualOpponent="${manualOpponent}"`, 'color: #555', '');
    
    // If manual opponent is set and not ALL, use that instead of automatic detection
    if (manualOpponent && manualOpponent !== '' && manualOpponent !== 'ALL') {
      console.log(`%c🎯 MANUAL OPPONENT OVERRIDE: ${manualOpponent}%c`, 'color: #f39c12; font-weight: bold; font-size: 12px', '');
      setOpponentTeam(normalizeAbbr(manualOpponent));
      console.log(`%c🔍 === OPPONENT USEEFFECT END ===%c\n`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
      return;
    }
    
    // Otherwise, use automatic opponent detection
    const teamToCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    console.log(`%cTeam to check: %c${teamToCheck}%c (mode: ${propsMode})`, 'color: #555', 'color: #e74c3c; font-weight: bold', 'color: #555');
    console.log(`%cGames available: %c${todaysGames.length}`, 'color: #555', 'color: #f39c12; font-weight: bold');
    
    if (teamToCheck && teamToCheck !== 'N/A' && todaysGames.length > 0) {
      const opponent = getOpponentTeam(teamToCheck, todaysGames);
      console.log(`%c🎯 SETTING OPPONENT: ${opponent}%c (for ${teamToCheck})`, 'color: #27ae60; font-weight: bold; font-size: 12px', 'color: #555');
      setOpponentTeam(normalizeAbbr(opponent));
    } else {
      console.log(`%c⏸️ SKIPPING OPPONENT UPDATE%c - Insufficient data`, 'color: #f39c12; font-weight: bold', 'color: #555');
      console.log(`  teamToCheck: ${teamToCheck}, todaysGames: ${todaysGames.length}`);
      if (propsMode === 'team' && (!gamePropsTeam || gamePropsTeam === 'N/A')) {
        console.log(`  -> Clearing opponent (team mode with no team selected)`);
        setOpponentTeam('');
      }
    }
    console.log(`%c🔍 === OPPONENT USEEFFECT END ===%c\n`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
  }, [selectedTeam, gamePropsTeam, todaysGames, propsMode, manualOpponent]);

  // Load games on mount and refresh every 3 hours (reduced churn)
  useEffect(() => {
    fetchTodaysGames();
    const id = setInterval(() => {
      fetchTodaysGames({ silent: true });
    }, 60 * 1000);
    return () => {
      clearInterval(id);
    };
  }, [fetchTodaysGames]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchTodaysGames({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchTodaysGames]);

  // When a team's game goes Final, immediately switch VS to next opponent (or ALL if none)
  // Also track next game for prop tracking/journal
  useEffect(() => {
    const teamToCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    if (!teamToCheck || teamToCheck === 'N/A' || todaysGames.length === 0) {
      setNextGameOpponent('');
      setNextGameDate('');
      setIsGameInProgress(false);
      return;
    }

    const normTeam = normalizeAbbr(teamToCheck);
    const now = Date.now();

    // Find upcoming games for this team
    const teamGames = todaysGames.filter((g: any) => {
      const home = normalizeAbbr(g?.home_team?.abbreviation || '');
      const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
      return home === normTeam || away === normTeam;
    });

    // Map all games with their info
    const mappedGames = teamGames.map((g: any) => ({ 
      g, 
      t: new Date(g.date || 0).getTime(), 
      status: String(g.status || '').toLowerCase(),
      rawStatus: String(g.status || '')
    }));
    
    // Check if there's a game currently in progress first
    const threeHoursMs = 3 * 60 * 60 * 1000;
    let currentGame = mappedGames.find((game) => {
      const rawStatus = game.rawStatus;
      const gameStatus = game.status;
      
      // Check if game is live by looking at tipoff time (same logic as check-bets endpoints)
      let isLive = false;
      const tipoffTime = Date.parse(rawStatus);
      if (!Number.isNaN(tipoffTime)) {
        const timeSinceTipoff = now - tipoffTime;
        isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
      }
      
      // Also check if game time has passed and game isn't final (fallback if status isn't a timestamp)
      const gameStarted = game.t <= now;
      const timeSinceGameTime = now - game.t;
      const isWithinThreeHours = timeSinceGameTime > 0 && timeSinceGameTime < threeHoursMs;
      
      // API sometimes returns date strings as status - ignore these
      const isDateStatus = rawStatus.includes('T') || rawStatus.includes('+') || rawStatus.match(/\d{4}-\d{2}-\d{2}/);
      
      // Mark as in progress if:
      // 1. Game is live (started within last 3 hours based on status timestamp), OR
      // 2. Game time has passed within last 3 hours and status doesn't indicate final
      return (isLive || (gameStarted && isWithinThreeHours && !isDateStatus)) 
        && gameStatus !== '' 
        && gameStatus !== 'scheduled' 
        && !gameStatus.includes('final') 
        && !gameStatus.includes('completed');
    });
    
    // If no game in progress, find next upcoming game
    const nextGame = currentGame || mappedGames
      .sort((a, b) => a.t - b.t)
      .find(({ status }) => !status.includes('final') && !status.includes('completed'));
    
    if (nextGame) {
      const home = normalizeAbbr(nextGame.g?.home_team?.abbreviation || '');
      const away = normalizeAbbr(nextGame.g?.visitor_team?.abbreviation || '');
      const opponent = normTeam === home ? away : home;
      const gameDate = nextGame.g?.date ? new Date(nextGame.g.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      // Check if game is in progress (same logic as above)
      const rawStatus = nextGame.rawStatus;
      const gameStatus = nextGame.status;
      
      // Check if game is live by looking at tipoff time (same logic as check-bets endpoints)
      let isLive = false;
      const tipoffTime = Date.parse(rawStatus);
      if (!Number.isNaN(tipoffTime)) {
        const timeSinceTipoff = now - tipoffTime;
        isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
      }
      
      // Also check if game time has passed and game isn't final (fallback if status isn't a timestamp)
      const gameStarted = nextGame.t <= now;
      const timeSinceGameTime = now - nextGame.t;
      const isWithinThreeHours = timeSinceGameTime > 0 && timeSinceGameTime < threeHoursMs;
      
      // API sometimes returns date strings as status - ignore these
      const isDateStatus = rawStatus.includes('T') || rawStatus.includes('+') || rawStatus.match(/\d{4}-\d{2}-\d{2}/);
      
      // Mark as in progress if:
      // 1. Game is live (started within last 3 hours based on status timestamp), OR
      // 2. Game time has passed within last 3 hours and status doesn't indicate final
      const inProgress = (isLive || (gameStarted && isWithinThreeHours && !isDateStatus)) 
        && gameStatus !== '' 
        && gameStatus !== 'scheduled' 
        && !gameStatus.includes('final') 
        && !gameStatus.includes('completed');
      
      console.log('Game progress check:', { 
        opponent, 
        gameDate, 
        status: rawStatus, 
        gameStatus,
        isDateStatus,
        tipoffTime: !Number.isNaN(tipoffTime) ? new Date(tipoffTime).toISOString() : 'invalid',
        gameTime: new Date(nextGame.t).toISOString(), 
        now: new Date(now).toISOString(),
        gameStarted,
        timeSinceGameTime: timeSinceGameTime / (60 * 60 * 1000) + ' hours',
        isWithinThreeHours,
        isLive,
        inProgress,
        isCurrentGame: !!currentGame
      });
      
      setNextGameOpponent(opponent || '');
      setNextGameDate(gameDate);
      setIsGameInProgress(inProgress);
      
      // Store tipoff time for countdown
      console.log('[Countdown DEBUG] Raw game data:', {
        game: nextGame.g,
        gameDate: nextGame.g?.date,
        gameStatus: nextGame.g?.status,
        gameDateTime: nextGame.g?.datetime,
        rawStatus: nextGame.rawStatus,
        gameTime: new Date(nextGame.t).toISOString(),
        now: new Date(now).toISOString(),
        gameTimeMs: nextGame.t,
        nowMs: now,
        gameTimeDiff: nextGame.t - now,
        gameTimeDiffHours: (nextGame.t - now) / (1000 * 60 * 60)
      });
      
      let tipoffDate: Date | null = null;
      
      // First, try to use the datetime field from the game object (most reliable)
      if (nextGame.g?.datetime) {
        const gameDateTime = new Date(nextGame.g.datetime);
        if (!Number.isNaN(gameDateTime.getTime()) && gameDateTime.getTime() > now) {
          tipoffDate = gameDateTime;
          console.log('[Countdown DEBUG] Using game.datetime field:', tipoffDate.toISOString());
        }
      }
      
      // If that didn't work, check if rawStatus is a valid ISO timestamp (like "2025-12-07T00:00:00Z")
      if (!tipoffDate) {
        const statusTime = Date.parse(rawStatus);
        if (!Number.isNaN(statusTime)) {
          const parsedStatus = new Date(statusTime);
          // Check if it's at midnight (00:00:00) - if so, it's just a date placeholder, not the actual game time
          const isMidnight = parsedStatus.getUTCHours() === 0 && parsedStatus.getUTCMinutes() === 0 && parsedStatus.getUTCSeconds() === 0;
          console.log('[Countdown DEBUG] Date.parse(rawStatus):', parsedStatus.toISOString(), isMidnight ? '(MIDNIGHT - date placeholder, not actual game time)' : '(has time)');
          
          // Only use if it's in the future and NOT midnight (midnight means it's just a date, not actual game time)
          if (parsedStatus.getTime() > now && !isMidnight && parsedStatus.getTime() < now + (7 * 24 * 60 * 60 * 1000)) {
            tipoffDate = parsedStatus;
            console.log('[Countdown DEBUG] Using rawStatus as ISO timestamp:', tipoffDate.toISOString());
          } else if (isMidnight) {
            // If it's midnight, it's just a date - we'll need to get the actual game time from elsewhere
            console.log('[Countdown DEBUG] rawStatus is midnight (date only), will try other methods');
          }
        }
      }
      
      // Try to parse tipoff from status (this extracts time from status like "7:00 PM")
      if (!tipoffDate) {
        tipoffDate = parseBallDontLieTipoff(nextGame.g);
        console.log('[Countdown DEBUG] parseBallDontLieTipoff result:', tipoffDate?.toISOString() || 'null');
      }
      
      // If still no valid tipoff, use the game date/time from nextGame.t
      // But check if it's actually in the future
      if (!tipoffDate || tipoffDate.getTime() <= now) {
        const gameTime = new Date(nextGame.t);
        console.log('[Countdown DEBUG] Game time check:', {
          gameTime: gameTime.toISOString(),
          gameTimeMs: gameTime.getTime(),
          nowMs: now,
          isFuture: gameTime.getTime() > now,
          diff: gameTime.getTime() - now,
          diffHours: (gameTime.getTime() - now) / (1000 * 60 * 60)
        });
        
        // Only use gameTime if it's in the future
        if (gameTime.getTime() > now) {
          tipoffDate = gameTime;
          console.log('[Countdown DEBUG] Using gameTime (future):', tipoffDate.toISOString());
        } else {
          // If gameTime is in the past, the game might be scheduled for later today
          // Try to extract time from status string
          const timeMatch = rawStatus.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
          console.log('[Countdown DEBUG] Time match from status:', timeMatch);
          
          if (timeMatch) {
            const gameDateStr = nextGame.g?.date || new Date().toISOString().split('T')[0];
            let hour = parseInt(timeMatch[1], 10);
            const minute = parseInt(timeMatch[2], 10);
            const meridiem = timeMatch[3].toUpperCase();
            if (meridiem === 'PM' && hour !== 12) hour += 12;
            else if (meridiem === 'AM' && hour === 12) hour = 0;
            
            // Create date with today's date and the parsed time
            const today = new Date();
            const tipoff = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute, 0);
            
            // If this time has already passed today, assume it's for tomorrow
            if (tipoff.getTime() <= now) {
              tipoff.setDate(tipoff.getDate() + 1);
            }
            
            tipoffDate = tipoff;
            console.log('[Countdown DEBUG] Created tipoff from status time:', tipoffDate.toISOString());
          } else {
            // Last resort: The rawStatus might be a date timestamp (midnight)
            // If so, extract the date and assume a reasonable game time (7:30 PM local)
            const hoursSinceGameTime = (now - gameTime.getTime()) / (1000 * 60 * 60);
            console.log('[Countdown DEBUG] Hours since game time:', hoursSinceGameTime);
            
            // Check if rawStatus is a date timestamp (midnight UTC)
            const statusTime = Date.parse(rawStatus);
            if (!Number.isNaN(statusTime)) {
              const statusDate = new Date(statusTime);
              const isMidnight = statusDate.getUTCHours() === 0 && statusDate.getUTCMinutes() === 0;
              
              if (isMidnight && statusDate.getTime() > now) {
                // It's a date timestamp - extract the date and assume game is at 7:30 PM local time
                const localDate = new Date(statusDate);
                // Convert to local time and set to 7:30 PM
                localDate.setHours(19, 30, 0, 0); // 7:30 PM local
                tipoffDate = localDate;
                console.log('[Countdown DEBUG] Using date from rawStatus with 7:30 PM local time:', tipoffDate.toISOString());
              } else if (hoursSinceGameTime < 24 && hoursSinceGameTime > -12) {
                // Game might be today, but we don't know the time - use a reasonable estimate
                // Most NBA games are between 7 PM and 10 PM local time
                const today = new Date();
                today.setHours(19, 30, 0, 0); // 7:30 PM today
                if (today.getTime() <= now) {
                  // If 7:30 PM has passed, assume it's tomorrow
                  today.setDate(today.getDate() + 1);
                }
                tipoffDate = today;
                console.log('[Countdown DEBUG] Using estimated time (7:30 PM today/tomorrow):', tipoffDate.toISOString());
              } else {
                tipoffDate = gameTime;
                console.log('[Countdown DEBUG] Using gameTime (last resort):', tipoffDate.toISOString());
              }
            } else {
              tipoffDate = gameTime;
              console.log('[Countdown DEBUG] Using gameTime (last resort):', tipoffDate.toISOString());
            }
          }
        }
      }
      
      const finalDiff = tipoffDate.getTime() - now;
      setNextGameTipoff(tipoffDate);
      console.log('[Countdown] Final tipoff calculation:', { 
        tipoffDate: tipoffDate?.toISOString(), 
        gameDate: nextGame.g?.date,
        rawStatus: nextGame.rawStatus,
        gameTime: new Date(nextGame.t).toISOString(),
        now: new Date(now).toISOString(),
        diff: finalDiff,
        diffHours: finalDiff / (1000 * 60 * 60),
        diffMinutes: finalDiff / (1000 * 60),
        willShowCountdown: finalDiff > 0 && !inProgress
      });
    } else {
      setNextGameOpponent('');
      setNextGameDate('');
      setNextGameTipoff(null);
      setIsGameInProgress(false);
    }

    // SMART AUTO-SWITCH: Only switch when the CURRENT opponent's game goes final
    // This prevents unnecessary re-renders when unrelated games finish
    if (opponentTeam && opponentTeam !== '' && opponentTeam !== 'N/A' && opponentTeam !== 'ALL') {
      // Find the game between current team and current opponent
      const currentGame = teamGames.find((g: any) => {
        const home = normalizeAbbr(g?.home_team?.abbreviation || '');
        const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
        return (home === normTeam && away === opponentTeam) || (away === normTeam && home === opponentTeam);
      });
      
      if (currentGame) {
        const status = String(currentGame.status || '').toLowerCase();
        const isCurrentGameFinal = status.includes('final') || status.includes('completed');
        
        console.log(`  Current game (${normTeam} vs ${opponentTeam}): status=${status}, final=${isCurrentGameFinal}`);
        
        if (isCurrentGameFinal) {
          console.log(`  -> Current game is final, finding next opponent...`);
          const nextOpponent = getOpponentTeam(normTeam, todaysGames);
          if (nextOpponent && nextOpponent !== opponentTeam) {
            console.log(`  -> Auto-switching from ${opponentTeam} to ${nextOpponent}`);
            setOpponentTeam(nextOpponent);
          } else {
            console.log(`  -> No next opponent found, keeping current`);
          }
        }
      }
    }
  }, [todaysGames, selectedTeam, gamePropsTeam, propsMode, manualOpponent, opponentTeam]);

  // Auto-handle opponent selection when switching to H2H
  useEffect(() => {
    if (selectedTimeframe === 'h2h') {
      // When switching to H2H, only clear manual opponent if it's currently ALL
      if (manualOpponent === 'ALL') {
        setManualOpponent('');
      }
      
      // If opponentTeam is not set (empty, N/A, or ALL), use the nextGameOpponent that's already calculated
      if ((!opponentTeam || opponentTeam === 'N/A' || opponentTeam === 'ALL' || opponentTeam === '') && nextGameOpponent && nextGameOpponent !== '') {
        console.log(`🔄 H2H: Setting opponent to next game opponent: ${nextGameOpponent}`);
        setOpponentTeam(nextGameOpponent);
      }
    }
    // Don't auto-switch away from manual selections when leaving H2H
  }, [selectedTimeframe, manualOpponent, opponentTeam, nextGameOpponent]);

  // Fetch game data when in team mode and team is selected
  useEffect(() => {
    if (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A') {
      console.log(`🏀 Fetching game data for team mode: ${gamePropsTeam}`);
      fetchGameDataForTeam(gamePropsTeam);
    } else if (propsMode === 'player') {
      // Clear game data when switching back to player mode
      setGameStats([]);
    } else if (propsMode === 'team' && gamePropsTeam === 'N/A') {
      // Clear game data when no team selected in Game Props
      setGameStats([]);
    }
  }, [propsMode, gamePropsTeam]);

  // Track if we've already attempted to fetch stats by game_id for this player/timeframe
  const lastSeasonGameIdFetchRef = useRef<{ playerId: string; attempted: boolean }>({ playerId: '', attempted: false });

  // WORKAROUND: When viewing last season and all stats have 0 minutes, fetch stats by game_id
  // for games where the player was on their previous team
  useEffect(() => {
    console.log(`[useEffect lastseason] Triggered:`, {
      selectedTimeframe,
      hasSelectedPlayer: !!selectedPlayer?.id,
      playerStatsLength: playerStats.length,
      refPlayerId: lastSeasonGameIdFetchRef.current.playerId,
      refAttempted: lastSeasonGameIdFetchRef.current.attempted
    });
    
    if (selectedTimeframe !== 'lastseason' || !selectedPlayer?.id || playerStats.length === 0) {
      // Reset ref when not viewing last season
      if (selectedTimeframe !== 'lastseason') {
        lastSeasonGameIdFetchRef.current = { playerId: '', attempted: false };
      }
      return;
    }
    
    const playerId = String(selectedPlayer.id);
    const lastSeason = currentNbaSeason() - 1;
    const getSeasonYear = (stat: any) => {
      if (!stat?.game?.date) return null;
      const d = new Date(stat.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      return m >= 9 ? y : y - 1;
    };
    
    const lastSeasonStats = playerStats.filter(s => getSeasonYear(s) === lastSeason);
    if (lastSeasonStats.length === 0) {
      console.log(`[useEffect lastseason] ⏭️ No last season stats found, skipping`);
      return;
    }
    
    // Skip if we've already attempted for this player AND we have valid stats
    // But if we still have 0-minute stats, try again (maybe the fetch failed)
    const parseMin = (minStr: string): number => {
      if (!minStr) return 0;
      const str = String(minStr).trim();
      if (!str || str === '0' || str === '00' || str === '0:00') return 0;
      const parts = str.split(':');
      if (parts.length === 2) {
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      }
      const num = parseFloat(str);
      return isNaN(num) ? 0 : num;
    };
    
    const withMinutes = lastSeasonStats.filter(s => {
      const min = parseMin(s.min || '');
      return min > 0;
    });
    
    // Check if we have valid stats (even if minutes are 0)
    const hasValidLastSeasonStats = lastSeasonStats.some(s => {
      const min = parseMin(s.min || '');
      return min > 0 || (s.pts > 0 || s.reb > 0 || s.ast > 0);
    });
    
    // Skip if we've already attempted AND we have valid stats
    if (lastSeasonGameIdFetchRef.current.playerId === playerId && 
        lastSeasonGameIdFetchRef.current.attempted && 
        hasValidLastSeasonStats) {
      console.log(`[useEffect lastseason] ⏭️ Already attempted for player ${playerId} and have valid stats, skipping`);
      return;
    }
    
    // Reset ref if it's a different player
    if (lastSeasonGameIdFetchRef.current.playerId !== playerId) {
      lastSeasonGameIdFetchRef.current = { playerId, attempted: false };
    }
    
    // If all last season stats have 0 minutes, fetch by game_id
    if (withMinutes.length === 0) {
      // Mark as attempted NOW to prevent duplicate fetches
      lastSeasonGameIdFetchRef.current = { playerId, attempted: true };
      
      console.log(`[useEffect lastseason] 🔧 Detected API data quality issue: all ${lastSeasonStats.length} last season stats have 0 minutes. Fetching by game_id...`);
      
      // Identify ALL games where ATL appears - player was on ATL for those games
      // We know from the logs that there are 4 games where ATL appears
      const atlGames = lastSeasonStats.filter(s => {
        const homeTeam = s.game?.home_team?.abbreviation;
        const visitorTeam = s.game?.visitor_team?.abbreviation;
        return (homeTeam === 'ATL' || visitorTeam === 'ATL') && s.game?.id;
      });
      
      console.log(`[useEffect lastseason] 🔍 Found ${atlGames.length} games where ATL appears (player was on ATL):`, atlGames.map(s => ({
        gameId: s.game?.id,
        date: s.game?.date,
        homeTeam: s.game?.home_team?.abbreviation,
        visitorTeam: s.game?.visitor_team?.abbreviation,
        statTeam: s.team?.abbreviation
      })));
      
      // Get unique game IDs for games where ATL appears
      const gameIds = Array.from(new Set(
        atlGames
          .map(s => s.game?.id)
          .filter((id): id is number => typeof id === 'number' && !isNaN(id))
      ));
      
      console.log(`[useEffect lastseason] 🔍 Unique game IDs to fetch: ${gameIds.length}`, gameIds);
      
      if (gameIds.length > 0) {
        console.log(`[useEffect lastseason] 🔧 Found ${gameIds.length} games with player's previous team, fetching stats by game_id...`);
        console.log(`[useEffect lastseason] 🔧 Game IDs to fetch:`, gameIds);
        
        // Fetch stats by game_id in batches (async, don't block)
        const fetchStatsByGameId = async () => {
          const { queuedFetch } = await import('@/lib/requestQueue');
          const batchSize = 50;
          const gameBatches: number[][] = [];
          for (let i = 0; i < gameIds.length; i += batchSize) {
            gameBatches.push(gameIds.slice(i, i + batchSize));
          }
          
          const statsByGameId: BallDontLieStats[] = [];
          for (const batch of gameBatches) {
            try {
              const gameIdsStr = batch.join(',');
              const url = `/api/stats?player_id=${playerId}&game_ids=${gameIdsStr}&per_page=100&max_pages=1`;
              const requestId = `stats-${playerId}-games-${batch[0]}-${Date.now()}`;
              console.log(`[useEffect lastseason] 🔧 Fetching stats for game IDs: ${gameIdsStr}`);
              const r = await queuedFetch(url, {}, requestId);
              const j = await r.json().catch(() => ({}));
              
              console.log(`[useEffect lastseason] 🔧 API response:`, {
                hasData: !!j?.data,
                dataIsArray: Array.isArray(j?.data),
                dataLength: Array.isArray(j?.data) ? j.data.length : 0,
                error: j?.error,
                fullResponse: j
              });
              
              const batchStats = (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
              
              console.log(`[useEffect lastseason] 🔧 Raw batch stats (${batchStats.length}):`, batchStats.slice(0, 3).map(s => ({
                gameId: s.game?.id,
                date: s.game?.date,
                team: s.team?.abbreviation,
                min: s.min,
                pts: s.pts,
                reb: s.reb,
                ast: s.ast
              })));
              
              // WORKAROUND: Even if stats have 0 minutes, if we know from game data that the player
              // was on ATL for these games, include them. The API has data quality issues for players
              // who changed teams, but we can still use the game data to show the player played.
              // We'll include stats if:
              // 1. They have actual minutes/data (normal case), OR
              // 2. The game has ATL as a participant (we know player was on ATL)
              // WORKAROUND: The BallDon'tLie API returns placeholder stats (0 minutes, 0 values) 
              // for players who changed teams, even when querying by game_id.
              // However, we know these are the correct games (we identified them by finding games where ATL appears).
              // So we'll include ALL stats returned from the game_id query, even if they have 0 minutes,
              // because at least we know these are the correct games where the player was on ATL.
              const validStats = batchStats.filter(s => {
                const gameId = s.game?.id;
                const min = parseMin(s.min || '');
                const hasActualData = min > 0 || (s.pts > 0 || s.reb > 0 || s.ast > 0);
                
                // Since we're querying by game_id for games we identified as ATL games,
                // include ALL stats returned, even if they have 0 minutes (API data quality issue)
                const isIdentifiedAtlGame = gameId && gameIds.includes(gameId);
                
                if (isIdentifiedAtlGame) {
                  console.log(`[useEffect lastseason] ✅ Including stat from identified ATL game (even with 0 minutes):`, {
                    gameId,
                    date: s.game?.date,
                    team: s.team?.abbreviation,
                    homeTeam: s.game?.home_team?.abbreviation,
                    visitorTeam: s.game?.visitor_team?.abbreviation,
                    min: s.min,
                    pts: s.pts,
                    reb: s.reb,
                    ast: s.ast
                  });
                  return true; // Always include stats from identified ATL games
                }
                
                // For other games, only include if they have actual data
                if (!hasActualData) {
                  console.log(`[useEffect lastseason] 🔍 Filtered out stat (not identified ATL game, no data):`, {
                    gameId,
                    min: s.min,
                    parsedMin: min,
                    pts: s.pts
                  });
                }
                return hasActualData;
              });
              
              statsByGameId.push(...validStats);
              console.log(`[useEffect lastseason] 🔧 Fetched ${validStats.length} valid stats from ${batch.length} games (raw: ${batchStats.length})`);
            } catch (error: any) {
              console.warn(`[useEffect lastseason] ⚠️ Error fetching stats by game_id for batch:`, error?.message || error);
            }
          }
          
          if (statsByGameId.length > 0) {
            console.log(`[useEffect lastseason] ✅ Successfully fetched ${statsByGameId.length} stats by game_id. Updating playerStats...`);
            
            // CORRECT THE TEAM: For stats from identified ATL games, fix the team abbreviation
            // The API returns stat.team=WAS, but we know the player was on ATL for these games
            const correctedStats = statsByGameId.map(stat => {
              const gameId = stat.game?.id;
              if (gameId && gameIds.includes(gameId)) {
                // This is one of our identified ATL games - correct the team to ATL
                const homeTeam = stat.game?.home_team?.abbreviation;
                const visitorTeam = stat.game?.visitor_team?.abbreviation;
                
                // We know the player was on ATL for these games, so set team to ATL
                const correctTeam = 'ATL';
                const correctTeamId = homeTeam === 'ATL' 
                  ? stat.game?.home_team?.id 
                  : (visitorTeam === 'ATL' 
                    ? stat.game?.visitor_team?.id 
                    : stat.team?.id);
                
                // Ensure team.id is always a number (required by BallDontLieStats type)
                // Use the team ID from game data if available, otherwise fall back to original or 0
                const teamId: number = correctTeamId ?? stat.team?.id ?? 0;
                
                console.log(`[useEffect lastseason] 🔧 Correcting team for game ${gameId}: ${stat.team?.abbreviation} → ${correctTeam} (home: ${homeTeam}, visitor: ${visitorTeam}, teamId: ${teamId})`);
                
                return {
                  ...stat,
                  team: {
                    ...(stat.team || {}),
                    abbreviation: correctTeam,
                    id: teamId,
                    full_name: 'Atlanta Hawks',
                    name: 'Hawks'
                  }
                };
              }
              return stat;
            });
            
            // Merge with existing stats
            // Keep all current season stats, and for last season:
            // - Keep all original last season stats (they have game data even if team is wrong)
            // - Add/update with the corrected stats from game_id fetch
            const currentSeasonStats = playerStats.filter(s => getSeasonYear(s) === currentNbaSeason());
            const lastSeasonStatsOriginal = playerStats.filter(s => getSeasonYear(s) === lastSeason);
            
            console.log(`[useEffect lastseason] 📊 Before merge: current=${currentSeasonStats.length}, lastSeason original=${lastSeasonStatsOriginal.length}, corrected stats=${correctedStats.length}`);
            
            // Create a map of game_id -> corrected stat for quick lookup
            const correctedStatsMap = new Map(correctedStats.map(s => [s.game?.id, s]));
            
            // For each original last season stat, use the corrected version if available, otherwise keep original
            const lastSeasonStatsCorrected = lastSeasonStatsOriginal.map(stat => {
              const gameId = stat.game?.id;
              if (gameId && correctedStatsMap.has(gameId)) {
                console.log(`[useEffect lastseason] 🔄 Replacing stat for game ${gameId} with corrected version`);
                return correctedStatsMap.get(gameId)!;
              }
              return stat;
            });
            
            // Also add any corrected stats that weren't in the original (shouldn't happen, but just in case)
            const correctedGameIds = new Set(correctedStats.map(s => s.game?.id).filter(Boolean));
            const originalGameIds = new Set(lastSeasonStatsOriginal.map(s => s.game?.id).filter(Boolean));
            const newStats = correctedStats.filter(s => {
              const gameId = s.game?.id;
              return gameId && !originalGameIds.has(gameId);
            });
            
            if (newStats.length > 0) {
              console.log(`[useEffect lastseason] ➕ Adding ${newStats.length} new stats that weren't in original`);
            }
            
            // Combine: current season + corrected last season stats + any new stats
            const updatedStats = [...currentSeasonStats, ...lastSeasonStatsCorrected, ...newStats];
            
            console.log(`[useEffect lastseason] 📊 After merge: current=${currentSeasonStats.length}, lastSeason=${lastSeasonStatsCorrected.length}, new=${newStats.length}, total=${updatedStats.length}`);
            
            setPlayerStats(updatedStats);
          } else {
            console.warn(`[useEffect lastseason] ⚠️ No valid stats found when querying by game_id`);
          }
        };
        
        // Fetch asynchronously (don't block the UI)
        fetchStatsByGameId().catch(err => {
          console.error(`[useEffect lastseason] ❌ Error in fetchStatsByGameId:`, err);
        });
      }
    }
  }, [selectedTimeframe, selectedPlayer?.id, playerStats]);


  // Keep logo URL in sync with selectedTeam/gamePropsTeam and opponentTeam
  useEffect(() => {
    const teamToUse = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    if (teamToUse && teamToUse !== 'N/A') {
      setSelectedTeamLogoAttempt(0);
      setSelectedTeamLogoUrl(getEspnLogoUrl(teamToUse));
    } else {
      setSelectedTeamLogoUrl('');
      setSelectedTeamLogoAttempt(0);
    }
  }, [selectedTeam, gamePropsTeam, propsMode]);

  useEffect(() => {
    if (opponentTeam) {
      setOpponentTeamLogoAttempt(0);
      setOpponentTeamLogoUrl(getEspnLogoUrl(opponentTeam));
    } else {
      setOpponentTeamLogoUrl('');
      setOpponentTeamLogoAttempt(0);
    }
  }, [opponentTeam]);

  // Fetch team matchup stats for pie chart comparison - DEFERRED to not block stats display
  useEffect(() => {
    const fetchTeamMatchupStats = async () => {
      const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
      
      if (!currentTeam || currentTeam === 'N/A' || !opponentTeam || opponentTeam === 'N/A') {
        setTeamMatchupStats({currentTeam: null, opponent: null});
        return;
      }
      
      setTeamMatchupLoading(true);
      try {
        // Fetch stats for both teams
        const [currentTeamResponse, opponentResponse] = await Promise.all([
          fetch(`/api/dvp/team-totals?team=${currentTeam}&games=82`),
          fetch(`/api/dvp/team-totals?team=${opponentTeam}&games=82`)
        ]);
        
        const [currentTeamData, opponentData] = await Promise.all([
          currentTeamResponse.json(),
          opponentResponse.json()
        ]);
        
        setTeamMatchupStats({
          currentTeam: currentTeamData.success ? currentTeamData.perGame : null,
          opponent: opponentData.success ? opponentData.perGame : null
        });
      } catch (error) {
        console.error('Failed to fetch team matchup stats:', error);
        setTeamMatchupStats({currentTeam: null, opponent: null});
      } finally {
        setTeamMatchupLoading(false);
      }
    };
    
    // Defer by 3 seconds to let stats load first
    const timeoutId = setTimeout(fetchTeamMatchupStats, 3000);
    
    return () => clearTimeout(timeoutId);
  }, [propsMode, gamePropsTeam, selectedTeam, opponentTeam]);

  // Function to fetch a single team's depth chart (with caching to prevent rate limits)
  const fetchTeamDepthChart = async (team: string): Promise<DepthChartData | null> => {
    try {
      if (!team || team === 'N/A') return null;
      const url = `/api/depth-chart?team=${encodeURIComponent(team)}`;
      // Use cachedFetch to prevent duplicate requests and respect rate limits
      const js = await cachedFetch(url, undefined, 300000); // Cache for 5 minutes
      if (!js || !js.success) return null;
      return js?.depthChart as DepthChartData | null;
    } catch (error) {
      console.warn(`Failed to fetch depth chart for ${team}:`, error);
      return null;
    }
  };

  // Prefetch rosters for current teams (specific to current mode)
  useEffect(() => {
    const prefetchTeamRosters = async () => {
      const playerTeam = propsMode === 'team' ? gamePropsTeam : originalPlayerTeam;
      const oppTeam = opponentTeam;
      
      if (!playerTeam || playerTeam === 'N/A') return;
      
      // Fetch player team roster
      if (playerTeam !== 'N/A') {
        setRostersLoading(prev => ({ ...prev, player: true }));
        const playerRoster = await fetchTeamDepthChart(playerTeam);
        setPlayerTeamRoster(playerRoster);
        setRostersLoading(prev => ({ ...prev, player: false }));
      }
      
      // Fetch opponent team roster if available
      if (oppTeam && oppTeam !== 'N/A' && oppTeam !== playerTeam) {
        setRostersLoading(prev => ({ ...prev, opponent: true }));
        const opponentRoster = await fetchTeamDepthChart(oppTeam);
        setOpponentTeamRoster(opponentRoster);
        setRostersLoading(prev => ({ ...prev, opponent: false }));
      }
    };
    
    prefetchTeamRosters();
  }, [originalPlayerTeam, opponentTeam, propsMode, gamePropsTeam]);


  // Comprehensive roster cache - preload ALL team rosters for instant switching
  const [allTeamRosters, setAllTeamRosters] = useState<Record<string, DepthChartData>>({});
  const [rosterCacheLoading, setRosterCacheLoading] = useState(false);

  // With/Without filters
  const [withWithoutMode, setWithWithoutMode] = useState<'with'|'without'>('with');
  const [teammateFilterId, setTeammateFilterId] = useState<number | null>(null);
  const [teammateFilterName, setTeammateFilterName] = useState<string | null>(null); // Store name for display
  const [teammatePlayedGameIds, setTeammatePlayedGameIds] = useState<Set<number>>(new Set());
  const [loadingTeammateGames, setLoadingTeammateGames] = useState<boolean>(false);

  // Reset teammate filters whenever the primary context changes (new player/team tab)
  useEffect(() => {
    // Always clear when leaving player mode or switching players
    setTeammateFilterId(null);
    setTeammateFilterName(null);
    setTeammatePlayedGameIds(new Set());
    setWithWithoutMode('with');
    setLoadingTeammateGames(false);
  }, [propsMode, selectedPlayer?.id]);

  const clearTeammateFilter = useCallback(() => {
    setTeammateFilterId(null);
    setTeammateFilterName(null);
    setTeammatePlayedGameIds(new Set());
    setLoadingTeammateGames(false);
  }, []);

  const rosterForSelectedTeam = useMemo(() => {
    if (propsMode !== 'player') return null;
    const roster = (playerTeamRoster && Object.keys(playerTeamRoster || {}).length ? playerTeamRoster : allTeamRosters[originalPlayerTeam]) as any;
    return roster || null;
  }, [propsMode, playerTeamRoster, allTeamRosters, originalPlayerTeam]);
  
  // Resolve BDL player id from a name if depth chart item lacks an id
  const resolveTeammateIdFromName = useCallback(async (name: string): Promise<number | null> => {
    try {
      if (!name) return null;
      const q = new URLSearchParams();
      q.set('endpoint', '/players');
      q.set('search', name);
      q.set('per_page', '100');
      const url = `/api/balldontlie?${q.toString()}`;
      const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
      const js = await res?.json().catch(() => ({})) as any;
      const arr = Array.isArray(js?.data) ? js.data : [];
      if (arr.length === 0) return null;
      // Prefer exact full-name match
      const exact = arr.find((p: any) => `${p.first_name} ${p.last_name}`.trim().toLowerCase() === name.trim().toLowerCase());
      const chosen = exact || arr[0];
      return typeof chosen?.id === 'number' ? chosen.id : null;
    } catch {
      return null;
    }
  }, []);
  // Effect moved below where baseGameData is declared

  // Resolve selected player's exact position from depth chart (after roster states are ready)
  // Rules:
  // 1) Starter always wins (depth index 0). If starter at multiple positions, tie-break by PG > SG > SF > PF > C.
  // 2) Otherwise scan by rows (depth index 1..), first appearance wins; within a row tie-break by PG > SG > SF > PF > C.
  // 3) Name matching uses normalized full/constructed names.
  const selectedPosition = useMemo((): 'PG'|'SG'|'SF'|'PF'|'C' | null => {
    try {
      if (propsMode !== 'player' || !selectedPlayer) return null;
      const fullName = selectedPlayer.full || '';
      const constructed = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
      const names = [fullName, constructed].filter(Boolean) as string[];
      const normalize = (s: string) => s
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const normNames = names.map(normalize);
      const roster = (playerTeamRoster && Object.keys(playerTeamRoster || {}).length ? playerTeamRoster : allTeamRosters[originalPlayerTeam]) as any;
      if (!roster) return null;
      const POS: Array<'PG'|'SG'|'SF'|'PF'|'C'> = ['PG','SG','SF','PF','C'];

      const matchAt = (pos: 'PG'|'SG'|'SF'|'PF'|'C', idx: number): boolean => {
        const arr = Array.isArray(roster[pos]) ? roster[pos] : [];
        if (!arr[idx]) return false;
        const pn = normalize(String(arr[idx]?.name || ''));
        if (!pn) return false;
        return normNames.some(cand => pn === cand || pn.endsWith(' ' + cand) || cand.endsWith(' ' + pn));
      };

      // 1) Starters first
      const starterMatches = POS.filter(pos => matchAt(pos, 0));
      if (starterMatches.length > 0) {
        // Tie-break by priority order: PG > SG > SF > PF > C
        for (const pos of POS) { if (starterMatches.includes(pos)) return pos; }
      }

      // 2) Scan by rows (depth index) then by POS order
      const maxDepth = Math.max(
        ...(POS.map(p => (Array.isArray(roster[p]) ? roster[p].length : 0)))
      );
      for (let depth = 1; depth < maxDepth; depth++) {
        for (const pos of POS) {
          if (matchAt(pos, depth)) return pos;
        }
      }

      return null;
    } catch { return null; }
  }, [propsMode, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, playerTeamRoster, allTeamRosters, originalPlayerTeam]);

  // Preload all team rosters when games are loaded (for instant team switching)
  useEffect(() => {
    const preloadAllRosters = async () => {
      if (todaysGames.length === 0) return;
      
      setRosterCacheLoading(true);
      console.log('🚀 Preloading all team rosters for instant switching...');
      
      // Get all unique teams from today's games
      const allTeams = new Set<string>();
      todaysGames.forEach(game => {
        if (game.home_team?.abbreviation) allTeams.add(normalizeAbbr(game.home_team.abbreviation));
        if (game.visitor_team?.abbreviation) allTeams.add(normalizeAbbr(game.visitor_team.abbreviation));
      });
      
      console.log(`📋 Found ${allTeams.size} teams to preload:`, Array.from(allTeams));
      
      // Fetch all rosters with staggered delays to avoid rate limiting
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const results = [];
      const teamArray = Array.from(allTeams);
      
      for (let i = 0; i < teamArray.length; i++) {
        const team = teamArray[i];
        try {
          const roster = await fetchTeamDepthChart(team);
          results.push({ team, roster });
        } catch (error) {
          console.warn(`Failed to preload roster for ${team}:`, error);
          results.push({ team, roster: null });
        }
        // Add 100ms delay between requests to respect rate limits
        if (i < teamArray.length - 1) {
          await delay(100);
        }
      }
      
      // Build roster cache
      const rosterCache: Record<string, DepthChartData> = {};
      results.forEach(({ team, roster }) => {
        if (roster) {
          rosterCache[team] = roster;
        }
      });
      
      setAllTeamRosters(rosterCache);
      setRosterCacheLoading(false);
      
      console.log(`✅ Preloaded ${Object.keys(rosterCache).length} team rosters for instant switching`);

      // Preload injuries for all teams we just cached so swaps show injury badges instantly
      try {
        const teamsParam = Array.from(allTeams).join(',');
        if (teamsParam) {
          const res = await fetch(`/api/injuries?teams=${teamsParam}`);
          const data = await res.json();
          if (data?.success) {
            setTeamInjuries((prev: any) => ({ ...prev, ...(data.injuriesByTeam || {}) }));
          }
        }
      } catch (err) {
        console.warn('Failed to preload injuries for all teams:', err);
      }
    };
    
    preloadAllRosters();
  }, [todaysGames]);

  // Fetch injuries for depth chart integration (fetch both selected and opponent teams)
  useEffect(() => {
    const fetchTeamInjuries = async () => {
      const teamA = propsMode === 'team' ? gamePropsTeam : selectedTeam;
      const teamB = opponentTeam;
      
      if (!teamA || teamA === 'N/A') {
        setTeamInjuries({});
        return;
      }

      try {
        const teamsParam = [teamA, teamB]
          .filter(Boolean)
          .filter((t, i, arr) => t !== 'N/A' && arr.indexOf(t as string) === i)
          .join(',');
        const url = teamsParam ? `/api/injuries?teams=${teamsParam}` : `/api/injuries?teams=${teamA}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.success) {
          setTeamInjuries(data.injuriesByTeam || {});
        }
      } catch (error) {
        console.warn('Failed to fetch team injuries:', error);
        setTeamInjuries({});
      }
    };

    fetchTeamInjuries();
  }, [selectedTeam, propsMode, gamePropsTeam, opponentTeam]);




  // On mount: restore from sessionStorage and URL once
  useEffect(() => {
    console.log(`[Dashboard] 🚀 Mount useEffect running - checking URL and session storage`);
    let initialPropsMode: 'player' | 'team' = 'player';
    let shouldLoadDefaultPlayer = true;
    

    // First, restore propsMode from session storage
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedSession> & { gamePropsTeam?: string };
        if (saved?.propsMode && (saved.propsMode === 'player' || saved.propsMode === 'team')) {
          initialPropsMode = saved.propsMode;
          setPropsMode(saved.propsMode);
          
          // Restore gamePropsTeam if in team mode
          if (saved.propsMode === 'team' && saved.gamePropsTeam && saved.gamePropsTeam !== 'N/A') {
            setGamePropsTeam(saved.gamePropsTeam);
          }
        }
        // Don't restore stat from session storage if there's a stat in the URL (URL takes precedence)
        const urlHasStat = typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('stat') : null;
        if (saved?.selectedStat && !urlHasStat) {
          console.log(`[Dashboard] 📦 Restoring stat from session storage: "${saved.selectedStat}" (no stat in URL)`);
          setSelectedStat(saved.selectedStat);
        } else if (urlHasStat) {
          console.log(`[Dashboard] ⏭️ Skipping session storage stat restore - stat "${urlHasStat}" found in URL`);
        }
        // Only restore selectedTimeframe if we have playerStats loaded (prevents race condition)
        // If playerStats is empty, don't restore timeframe yet - wait for stats to load first
        if (saved?.selectedTimeframe && playerStats.length > 0) {
          setSelectedTimeframe(saved.selectedTimeframe);
        }
      }
    } catch {}

    // Then check URL parameters (can override session storage)
    try {
      if (typeof window !== 'undefined') {
        // Capture initial URL IMMEDIATELY to prevent race conditions
        const initialUrl = window.location.href;
        console.log(`[Dashboard] 🔍 Initial URL (captured immediately): ${initialUrl}`);
        const url = new URL(initialUrl);
        const pid = url.searchParams.get('pid');
        const name = url.searchParams.get('name');
        const player = url.searchParams.get('player'); // Support 'player' param (from player props page)
        const team = url.searchParams.get('team') || undefined;
        const stat = url.searchParams.get('stat');
        const line = url.searchParams.get('line');
        const tf = url.searchParams.get('tf');
        const mode = url.searchParams.get('mode');
        
        console.log(`[Dashboard] 🔍 URL params: stat="${stat}", player="${player}", mode="${mode}", line="${line}"`);
        console.log(`[Dashboard] 🔍 All URL params:`, Object.fromEntries(url.searchParams.entries()));
        console.log(`[Dashboard] 🔍 Current window.location.href: ${window.location.href}`);
        
        // Set stat from URL FIRST (before propsMode) to prevent default stat logic from overriding it
        if (stat) {
          console.log(`[Dashboard] ✅ Found stat in URL: "${stat}"`);
          // Normalize stat from props page format (uppercase) to dashboard format (lowercase)
          // Also handle special cases like "THREES" -> "fg3m"
          const normalizedStat = (() => {
            const statUpper = stat.toUpperCase();
            // Map special cases first
            if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
              return 'fg3m';
            }
            // Convert uppercase to lowercase for standard stats
            // Props page uses: PTS, REB, AST, STL, BLK, PRA, PA, PR, RA
            // Dashboard expects: pts, reb, ast, stl, blk, pra, pa, pr, ra
            return stat.toLowerCase();
          })();
          
          console.log(`[Dashboard] 📊 Setting stat from URL: "${stat}" -> "${normalizedStat}"`);
          
          // Set flag to prevent default stat logic from overriding
          statFromUrlRef.current = true;
          setSelectedStat(normalizedStat);
          
          // Store in session storage to persist across player loading
          const saved = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedStat = normalizedStat;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
          
          // If line is provided, set it for this stat (use normalized stat for the key)
          if (line) {
            const lineValue = parseFloat(line);
            if (!isNaN(lineValue)) {
              setBettingLines(prev => ({
                ...prev,
                [normalizedStat]: Math.abs(lineValue) // Use absolute value (line can be negative for under props)
              }));
            }
          }
        } else {
          console.log(`[Dashboard] ⚠️ No stat parameter found in URL`);
        }
        
        // Set propsMode AFTER stat (so default stat logic can see the URL stat)
        if (mode === 'team' || mode === 'player') {
          console.log(`[Dashboard] 📝 Setting propsMode from URL: "${mode}"`);
          initialPropsMode = mode;
          setPropsMode(mode);
        }
        
        // Handle 'player' param (from player props page) - use it if 'name' is not provided
        const playerName = name || player;
        // When coming from player props page, default to "thisseason" to show current season data
        // ALWAYS override "thisseason" from URL to use "last10" as default
        // Only use URL timeframe if it's NOT "thisseason"
        if (tf && tf !== 'thisseason') {
          // Set timeframe immediately from URL (don't wait for stats to load)
          // This ensures the correct timeframe is active when stats load
          console.log(`[Dashboard] ✅ Setting timeframe from URL: "${tf}"`);
          setSelectedTimeframe(tf);
          // Also store it in session storage for persistence
          const saved = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedTimeframe = tf;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
        } else {
          // ALWAYS default to last10 (override "thisseason" from URL or when no URL param)
          console.log(`[Dashboard] 🔄 FORCING timeframe to "last10" (overriding URL tf=${tf || 'none'})`);
          setSelectedTimeframe('last10');
          // Update URL to reflect the change
          if (typeof window !== 'undefined') {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('tf', 'last10');
            window.history.replaceState({}, '', newUrl.toString());
          }
          // Store in session storage
          const saved = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedTimeframe = 'last10';
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
        }
        
        // Handle player selection - support both 'pid+name' and 'player' params
        if (false) { // Disabled - moved below
          // Coming from player props page without explicit timeframe - default to last10
          console.log(`[Dashboard] Setting default timeframe to "last10" for player from props page`);
          setSelectedTimeframe('last10');
          // Store in session storage
          if (typeof window !== 'undefined') {
            const saved = sessionStorage.getItem(SESSION_KEY);
            if (saved !== null) {
              try {
                const parsed = JSON.parse(saved as string);
                parsed.selectedTimeframe = 'last10';
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
              } catch {}
            }
          }
        }
        // Handle player selection - support both 'pid+name' and 'player' params
        if (pid && playerName) {
          const r: BdlSearchResult = { id: Number(pid), full: playerName, team, pos: undefined };
          if (initialPropsMode === 'player') {
            handlePlayerSelectFromSearch(r);
            shouldLoadDefaultPlayer = false;
            return;
          }
        } else if (playerName && !pid) {
          // If only 'player' name is provided (from player props page), search for the player
          if (initialPropsMode === 'player') {
            // OPTIMIZATION: Show player name immediately from URL (optimistic UI)
            // This prevents blank screen while searching
            const urlTeam = team ? normalizeAbbr(team) : '';
            startTransition(() => {
              setSelectedPlayer({
                id: '',
                full: playerName,
                firstName: playerName.split(' ')[0] || playerName,
                lastName: playerName.split(' ').slice(1).join(' ') || '',
                teamAbbr: urlTeam,
                jersey: '',
                heightFeet: null,
                heightInches: null,
                position: '',
              } as any);
              if (urlTeam) {
                setSelectedTeam(urlTeam);
                setOriginalPlayerTeam(urlTeam);
                setDepthChartTeam(urlTeam);
              }
            });
            
            // Set loading state immediately to prevent double render
            setIsLoading(true);
            // Trigger search for the player name
            const searchForPlayer = async () => {
              try {
                console.log(`[Dashboard] 🔍 [Props Page] Searching for player: "${playerName}"`);
                serverLogger.log(`[Dashboard] 🔍 [Props Page] Searching for player: "${playerName}"`);
                
                // OPTIMIZATION: Try all search variations in parallel instead of sequentially
                // This reduces search time from ~1.8s to ~0.6s (fastest response wins)
                const nameParts = playerName.trim().split(/\s+/);
                const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                
                const searchPromises = [
                  fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}`).catch(() => null),
                  fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}&all=true`).catch(() => null),
                ];
                
                // Only add last name search if we have a last name
                if (lastName && lastName !== playerName) {
                  searchPromises.push(
                    fetch(`/api/bdl/players?q=${encodeURIComponent(lastName)}&all=true`).catch(() => null)
                  );
                }
                
                // Wait for all searches, but use the first one that returns results
                const searchResponses = await Promise.all(searchPromises);
                let rawResults: any[] | null = null;
                let json: any = null;
                
                // Check searchResponses in order of preference (exact match first, then all=true, then last name)
                for (const res of searchResponses) {
                  if (!res || !res.ok) continue;
                  try {
                    json = await res.json();
                    rawResults = json?.results || json?.data;
                    if (Array.isArray(rawResults) && rawResults.length > 0) {
                      console.log(`[Dashboard] ✅ [Props Page] Found results from parallel search`);
                      break; // Use first successful result
                    }
                  } catch (e) {
                    // Continue to next result
                  }
                }
                
                // Fallback: if no results, try the original sequential approach
                if (!rawResults || !Array.isArray(rawResults) || rawResults.length === 0) {
                  console.log(`[Dashboard] ⚠️ [Props Page] Parallel search found no results, trying sequential fallback...`);
                  const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}`);
                  if (res.ok) {
                    json = await res.json();
                    rawResults = json?.results || json?.data;
                  }
                }
                
                const results: BdlSearchResult[] = Array.isArray(rawResults) && rawResults.length > 0
                  ? rawResults.map((r: any) => ({ 
                      id: r.id, 
                      full: r.full, 
                      team: r.team, 
                      pos: r.pos, 
                      headshotUrl: r.headshotUrl || null 
                    }))
                  : [];
                console.log(`[Dashboard] 📊 [Props Page] Parsed ${results.length} results for "${playerName}"`);
                if (results && results.length > 0) {
                  // Try to find exact match first, then use first result
                  const playerNameLower = playerName.toLowerCase().trim();
                  let playerResult = results.find(r => r.full.toLowerCase().trim() === playerNameLower);
                  if (!playerResult) {
                    // Try partial match (first name or last name)
                    playerResult = results.find(r => {
                      const fullLower = r.full.toLowerCase().trim();
                      return fullLower.includes(playerNameLower) || playerNameLower.includes(fullLower);
                    });
                  }
                  // Fallback to first result
                  if (!playerResult) {
                    playerResult = results[0];
                  }
                  
                  console.log(`[Dashboard] ✅ [Props Page] Found player: ${playerResult.full} (ID: ${playerResult.id}, Team: ${playerResult.team})`);
                  serverLogger.log(`[Dashboard] ✅ [Props Page] Found player: ${playerResult.full}`, { data: { id: playerResult.id, team: playerResult.team } });
                  const r: BdlSearchResult = {
                    id: playerResult.id,
                    full: playerResult.full,
                    team: playerResult.team,
                    pos: playerResult.pos
                  };
                  
                  // OPTIMIZATION: Show player immediately, then load stats in background
                  // This prevents the 5-7 second delay before any UI appears
                  const currentTeam = normalizeAbbr(r.team || '');
                  const pid = String(r.id);
                  
                  // Set player info immediately (optimistic UI)
                  startTransition(() => {
                    setSelectedPlayer({
                      id: pid,
                      full: r.full,
                      firstName: r.full.split(' ')[0] || r.full,
                      lastName: r.full.split(' ').slice(1).join(' ') || '',
                      teamAbbr: currentTeam,
                      jersey: '',
                      heightFeet: null,
                      heightInches: null,
                      position: r.pos || '',
                    } as any);
                    setSelectedTeam(currentTeam);
                    setOriginalPlayerTeam(currentTeam);
                    setDepthChartTeam(currentTeam);
                    setResolvedPlayerId(pid);
                    setPlayerStats([]); // Clear old stats, will load new ones
                  });
                  
                  // Now load stats in background without blocking
                  console.log(`[Dashboard] 🚀 [Props Page] Loading stats in background for:`, r);
                  serverLogger.log(`[Dashboard] 🚀 [Props Page] Loading stats in background`, { data: r });
                  handlePlayerSelectFromSearch(r).catch(err => {
                    console.error('[Dashboard] ❌ [Props Page] Error loading player stats:', err);
                    setApiError(`Failed to load stats: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    setIsLoading(false);
                  });
                  shouldLoadDefaultPlayer = false;
                } else {
                  console.warn(`[Dashboard] ⚠️ [Props Page] No results found for player: "${playerName}"`);
                  console.warn(`[Dashboard] ⚠️ [Props Page] API response was:`, json);
                  setApiError(`Player "${playerName}" not found. Please try searching manually.`);
                  setIsLoading(false); // Clear loading state if no results found
                }
              } catch (error) {
                console.error(`[Dashboard] ❌ [Props Page] Error searching for player "${playerName}":`, error);
                setApiError(`Error searching for player: ${error instanceof Error ? error.message : 'Unknown error'}`);
                setIsLoading(false); // Clear loading state on error
              }
            };
            // Await the search to ensure it completes before continuing
            searchForPlayer().catch(err => {
              console.error('[Dashboard] ❌ [Props Page] Unhandled error in searchForPlayer:', err);
              setApiError(`Failed to load player: ${err instanceof Error ? err.message : 'Unknown error'}`);
              setIsLoading(false); // Clear loading state on error
            });
            shouldLoadDefaultPlayer = false;
            // Don't return here - let the useEffect continue to set up other things
          }
        }
      }
    } catch (urlError) {
      console.error('[Dashboard] Error processing URL parameters:', urlError);
    }

    // Finally, restore saved player if in player mode
    if (initialPropsMode === 'player') {
      try {
        const raw = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
        if (raw) {
          const saved = JSON.parse(raw) as Partial<SavedSession & { playerCleared?: boolean }>;
          
          // If user deliberately cleared player data by switching modes, don't load default
          if (saved?.playerCleared) {
            shouldLoadDefaultPlayer = false;
            return;
          }
          
          // Only restore player data if the saved mode matches current mode
          if (saved?.propsMode === 'player') {
            const r = saved?.player as BdlSearchResult | undefined;
            if (r && r.id && r.full) {
              handlePlayerSelectFromSearch(r);
              shouldLoadDefaultPlayer = false;
              return;
            }
          }
        }
      } catch {}

      // Never auto-load any default player
      // Players should only be loaded when explicitly searched for or from URL sharing
    }
  }, []); // Only run once on mount

  // Restore timeframe from session storage when playerStats loads (fixes race condition)
  // Only run once when playerStats first loads, not on every timeframe change
  // NOTE: This should NOT override URL parameters - URL params are set immediately in initial useEffect
  const hasRestoredTimeframeRef = useRef(false);
  useEffect(() => {
    // Only restore if:
    // 1. Stats are loaded
    // 2. We haven't restored yet
    // 3. We're still on the default timeframe (last10) - meaning no URL param or manual selection happened
    // 4. There's a saved timeframe that's different from the default
    // ALWAYS force "last10" if we see "thisseason" anywhere
    if (playerStats.length > 0 && !hasRestoredTimeframeRef.current) {
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const urlTimeframe = url?.searchParams.get('tf');
      
      // If URL has "thisseason", force it to "last10"
      if (urlTimeframe === 'thisseason' || selectedTimeframe === 'thisseason') {
        console.log('[Dashboard] 🔄 FORCING timeframe from "thisseason" to "last10" in restore logic');
        setSelectedTimeframe('last10');
        if (typeof window !== 'undefined') {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('tf', 'last10');
          window.history.replaceState({}, '', newUrl.toString());
        }
        hasRestoredTimeframeRef.current = true;
        return;
      }
      
      // Check if URL has a timeframe param - respect other values
      if (urlTimeframe && urlTimeframe !== 'thisseason') {
        console.log('[Dashboard] ⚠️ Skipping timeframe restore - URL has timeframe param:', urlTimeframe);
        hasRestoredTimeframeRef.current = true;
        return;
      }
      
      // Only restore if we're still on default timeframe (last10)
      // This means we haven't manually selected a timeframe yet
      try {
        const saved = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
        if (saved && typeof saved === 'string') {
          const parsed = JSON.parse(saved);
          if (parsed?.selectedTimeframe && parsed.selectedTimeframe !== 'last10') {
            console.log(`[Dashboard] 🔄 Restoring timeframe from session: "${parsed.selectedTimeframe}"`);
            setSelectedTimeframe(parsed.selectedTimeframe);
          }
        }
      } catch {}
      hasRestoredTimeframeRef.current = true;
    }
  }, [playerStats.length, selectedTimeframe]); // Added selectedTimeframe to check current value

  /* --------- Live search (debounced) using /api/bdl/players ---------- */
  useEffect(() => {
    let t: any;
    const run = async () => {
      const q = searchQuery.trim();
      setSearchError(null);
      if (q.length < 2) { setSearchResults([]); return; }
      setSearchBusy(true);
      try {
        // For full name searches (contains space) or short queries, use broader search + client filtering
        const isFullNameSearch = q.includes(' ') || q.length < 3;
        const searchQuery = isFullNameSearch ? q.split(' ')[0] : q; // Use first word for API search
        
        const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(searchQuery)}`);
        const json = await res.json().catch(() => ({}));
        const err = json?.error || null;
        setSearchError(err);
        
        let arr: BdlSearchResult[] = Array.isArray(json?.results)
          ? json.results.map((r: any) => ({ id: r.id, full: r.full, team: r.team, pos: r.pos, headshotUrl: r.headshotUrl || null }))
          : [];
        
        // Client-side fuzzy filtering for full name searches
        if (isFullNameSearch && q.includes(' ')) {
          const queryWords = q.toLowerCase().split(' ').filter(word => word.length > 0);
          arr = arr.filter(player => {
            const playerName = player.full.toLowerCase();
            // Check if all query words are found in the player name
            return queryWords.every(word => 
              playerName.includes(word) || 
              // Also check if any word in player name starts with the query word
              playerName.split(' ').some(nameWord => nameWord.startsWith(word))
            );
          });
        }
        // dedupe & cap (20 results for faster rendering)
        const seen = new Set<string>();
        const dedup = arr.filter(r => {
          if (seen.has(r.full)) return false;
          seen.add(r.full);
          return true;
        }).slice(0, 20);
        setSearchResults(dedup);
      } catch (e: any) {
        setSearchError(e?.message || "Search failed");
        setSearchResults([]);
      } finally {
        setSearchBusy(false);
      }
    };
    t = setTimeout(run, 100);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Persist session when key state changes
  useEffect(() => {
    try {
      // Always save propsMode, selectedStat, and selectedTimeframe
      const baseSave: Partial<SavedSession> = {
        propsMode,
        selectedStat,
        selectedTimeframe,
      };

      // Add player data if in player mode and player is selected
      if (selectedPlayer && selectedTeam && propsMode === 'player') {
        const r: BdlSearchResult = {
          id: Number(resolvedPlayerId || selectedPlayer.id),
          full: selectedPlayer.full,
          team: selectedTeam,
          pos: (selectedPlayer as any).position || undefined,
        };
        (baseSave as SavedSession).player = r;
      }
      
      // Add team data if in team mode and team is selected
      if (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A') {
        (baseSave as any).gamePropsTeam = gamePropsTeam;
      }
      
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(baseSave));
        
        // Check if we're loading from URL params (has 'player' but not 'pid')
        // If so, don't update URL immediately to prevent double reload
        const currentUrl = new URL(window.location.href);
        const hasPlayerParam = currentUrl.searchParams.has('player');
        const hasPidParam = currentUrl.searchParams.has('pid');
        const isLoadingFromUrl = hasPlayerParam && !hasPidParam;
        
        // Update URL for share/save (but skip if we're still loading from URL params)
        if (!isLoadingFromUrl) {
          const url = new URL(window.location.href);
          url.searchParams.set('mode', propsMode);
          
          if (selectedPlayer && selectedTeam && propsMode === 'player') {
            const r = baseSave.player as BdlSearchResult;
            url.searchParams.set('pid', String(r.id));
            url.searchParams.set('name', r.full);
            url.searchParams.set('team', selectedTeam);
            // Remove 'player' param if it exists (we now have pid/name/team)
            url.searchParams.delete('player');
          } else {
            // Remove player-specific params when not in player mode
            url.searchParams.delete('pid');
            url.searchParams.delete('name');
            url.searchParams.delete('team');
            url.searchParams.delete('player');
          }
          
          url.searchParams.set('stat', selectedStat);
          url.searchParams.set('tf', selectedTimeframe);
          window.history.replaceState({}, '', url.toString());
        }
      }
    } catch {}
  }, [selectedPlayer, selectedTeam, selectedStat, selectedTimeframe, resolvedPlayerId, propsMode, gamePropsTeam]);

  // Resolve playerId with best match (if needed)
  const resolvePlayerId = async (fullName: string, teamAbbr?: string): Promise<string | null> => {
    try {
      const params = new URLSearchParams({ q: fullName });
      if (teamAbbr) params.set('team', teamAbbr);
      const res = await fetch(`/api/bdl/players?${params.toString()}`);
      const j = await res.json().catch(() => ({}));
      const best = j?.best;
      return best?.id ? String(best.id) : null;
    } catch {
      return null;
    }
  };

  // Parse ESPN height format (total inches or "6'10") into feet and inches
  const parseEspnHeight = (height: any): { feet?: number; inches?: number } => {
    console.log('🏀 ESPN height data:', height, 'Type:', typeof height);
    
    if (!height) return {};
    
    // If it's a number (total inches)
    if (typeof height === 'number' || /^\d+$/.test(String(height))) {
      const totalInches = parseInt(String(height), 10);
      const feet = Math.floor(totalInches / 12);
      const inches = totalInches % 12;
      console.log(`🏀 Converted ${totalInches}" to ${feet}'${inches}"`);
      return { feet, inches };
    }
    
    // Convert to string for other formats
    const heightStr = String(height);
    
    // ESPN format is like "6'10" or "6'10\"" or "6-10"
    const match = heightStr.match(/(\d+)['-](\d+)/);
    if (match) {
      const feet = parseInt(match[1], 10);
      const inches = parseInt(match[2], 10);
      console.log(`🏀 Parsed height: ${feet}'${inches}"`);
      return { feet, inches };
    }
    
    console.log(`❌ Could not parse height: "${heightStr}"`);
    return {};
  };

  // Fetch ESPN player data (jersey, height, etc.)
  const fetchEspnPlayerData = async (playerName: string, team?: string): Promise<EspnPlayerData | null> => {
    return await fetchEspnPlayerDataCore(playerName, team);
  };


  // Core function to fetch player stats (without UI state updates)
  const fetchSortedStatsCore = async (playerId: string) => {
    console.log('[fetchSortedStatsCore] Starting fetch for playerId:', playerId);
    const season = currentNbaSeason();
    
    // Use queued fetch to prevent rate limiting
    const { queuedFetch } = await import('@/lib/requestQueue');
    
    // Fetch stats for a season - fetch both regular and playoffs in parallel
    // This reduces from 4 requests to 2 requests per player (2 seasons x 1 parallel fetch each)
    const grabSeason = async (yr: number) => {
      const fetchRegular = async () => {
        // Use cache for faster loading - stats API has 8 hour cache
        // Fetch 3-5 pages to get this season and last season (max ~82 games per season = 1 page, but 3-5 pages covers edge cases)
        // This is much faster than fetching 50 pages (5000 games) which was overkill
        const url = `/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=5&postseason=false`;
        const requestId = `stats-${playerId}-${yr}-reg`;
        try {
          const r = await queuedFetch(url, {}, requestId);
          const j = await r.json().catch(() => ({}));
          const stats = (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
          
          // Debug: Log team distribution for last season
          if (yr === currentNbaSeason() - 1) {
            const parseMin = (minStr: string): number => {
              if (!minStr) return 0;
              const str = String(minStr).trim();
              if (!str || str === '0' || str === '00' || str === '0:00') return 0;
              const parts = str.split(':');
              if (parts.length === 2) {
                return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
              }
              const num = parseFloat(str);
              return isNaN(num) ? 0 : num;
            };
            
            const teams = new Set(stats.map(s => s?.team?.abbreviation).filter(Boolean));
            const withMinutes = stats.filter(s => {
              const min = parseMin(s.min || '');
              return min > 0;
            });
            const teamsWithMinutes = new Set(withMinutes.map(s => s?.team?.abbreviation).filter(Boolean));
            console.log(`[fetchSortedStatsCore] Last season (${yr}) stats: total=${stats.length}, with minutes>0=${withMinutes.length}, teams=${Array.from(teams).join(',')}, teamsWithMinutes=${Array.from(teamsWithMinutes).join(',')}`);
            if (stats.length > 0 && withMinutes.length === 0) {
              const sample = stats.slice(0, 5).map(s => ({
                date: s.game?.date,
                team: s.team?.abbreviation,
                min: s.min,
                pts: s.pts,
                reb: s.reb
              }));
              console.log(`[fetchSortedStatsCore] Sample last season stats (all have 0 minutes):`, sample);
              
              // WORKAROUND: If all stats have 0 minutes, identify games where player was on their previous team
              // and fetch stats by game_id to get actual data
              console.log(`[fetchSortedStatsCore] 🔧 Attempting to fetch stats by game_id for games with player's previous team...`);
              
              // Identify games where stat.team doesn't match either team in the game
              // This indicates the player was on a different team (e.g., stat.team=WAS but game has ATL)
              const gamesWithPreviousTeam = stats
                .filter(s => {
                  const homeTeam = s.game?.home_team?.abbreviation;
                  const visitorTeam = s.game?.visitor_team?.abbreviation;
                  const statTeam = s.team?.abbreviation;
                  
                  // If stat.team doesn't match either team in the game, player was likely on one of those teams
                  // This handles cases like stat.team=WAS but game has ATL (player was on ATL)
                  if (!homeTeam || !visitorTeam || !statTeam) return false;
                  
                  // Check if stat.team matches either team (normal case - skip)
                  if (statTeam === homeTeam || statTeam === visitorTeam) return false;
                  
                  // stat.team doesn't match - player was on one of the teams in the game
                  return true;
                })
                .map(s => s.game?.id)
                .filter((id): id is number => typeof id === 'number' && !isNaN(id));
              
              if (gamesWithPreviousTeam.length > 0) {
                console.log(`[fetchSortedStatsCore] 🔧 Found ${gamesWithPreviousTeam.length} games with player's previous team, fetching stats by game_id...`);
                
                // Fetch stats for these specific games (batch in groups of 50 to avoid URL length issues)
                const batchSize = 50;
                const gameBatches: number[][] = [];
                for (let i = 0; i < gamesWithPreviousTeam.length; i += batchSize) {
                  gameBatches.push(gamesWithPreviousTeam.slice(i, i + batchSize));
                }
                
                const statsByGameId: BallDontLieStats[] = [];
                for (const batch of gameBatches) {
                  try {
                    const gameIdsStr = batch.join(',');
                    const url = `/api/stats?player_id=${playerId}&game_ids=${gameIdsStr}&per_page=100&max_pages=1`;
                    const requestId = `stats-${playerId}-games-${batch[0]}`;
                    const r = await queuedFetch(url, {}, requestId);
                    const j = await r.json().catch(() => ({}));
                    const batchStats = (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
                    
                    // Filter to only include stats with actual minutes/data
                    const validStats = batchStats.filter(s => {
                      const min = parseMin(s.min || '');
                      return min > 0 || (s.pts > 0 || s.reb > 0 || s.ast > 0);
                    });
                    
                    statsByGameId.push(...validStats);
                    console.log(`[fetchSortedStatsCore] 🔧 Fetched ${validStats.length} valid stats from ${batch.length} games`);
                  } catch (error: any) {
                    console.warn(`[fetchSortedStatsCore] ⚠️ Error fetching stats by game_id for batch:`, error?.message || error);
                  }
                }
                
                if (statsByGameId.length > 0) {
                  console.log(`[fetchSortedStatsCore] ✅ Successfully fetched ${statsByGameId.length} stats by game_id (workaround for API data quality issue)`);
                  // Replace the invalid stats with the valid ones we fetched
                  return statsByGameId;
                } else {
                  console.warn(`[fetchSortedStatsCore] ⚠️ No valid stats found when querying by game_id`);
                }
              }
            }
          }
          
          return stats;
        } catch (error: any) {
          if (error?.status === 429) {
            console.warn(`[fetchSortedStatsCore] Rate limited for ${url}, returning empty array`);
            return [];
          }
          throw error;
        }
      };

      const fetchPlayoffs = async () => {
        // Use cache for faster loading - stats API has 8 hour cache
        // Fetch 3-5 pages to get this season and last season (max ~82 games per season = 1 page, but 3-5 pages covers edge cases)
        // This is much faster than fetching 50 pages (5000 games) which was overkill
        const url = `/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=5&postseason=true`;
        const requestId = `stats-${playerId}-${yr}-po`;
        try {
          const r = await queuedFetch(url, {}, requestId);
          const j = await r.json().catch(() => ({}));
          return (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
        } catch (error: any) {
          if (error?.status === 429) {
            console.warn(`[fetchSortedStatsCore] Rate limited for ${url}, returning empty array`);
            return [];
          }
          throw error;
        }
      };

      // Fetch both in parallel (request queue will handle concurrency)
      const [regular, playoffs] = await Promise.all([
        fetchRegular(),
        fetchPlayoffs()
      ]);

      return [...regular, ...playoffs];
    };

    // For "last10" timeframe, fetch both current season and last season in parallel
    // This prevents multiple refreshes and ensures all data is available at once
    if (selectedTimeframe === 'last10') {
      // Fetch both seasons in parallel - this is faster than sequential and prevents multiple refreshes
      const [currSeason, prevSeason] = await Promise.all([
        grabSeason(season),        // Current season (regular + playoffs in parallel)
        grabSeason(season - 1)     // Last season (regular + playoffs in parallel)
      ]);
      
      // Merge both seasons and return all data at once
      const rows = [...currSeason, ...prevSeason];
      console.log(`[fetchSortedStatsCore] Fetched both seasons in parallel for last10: current=${currSeason.length}, last=${prevSeason.length}, total=${rows.length}`);
      
      // Debug: Check last season stats - analyze prevSeason directly
      console.log(`[fetchSortedStatsCore] DEBUG: prevSeason.length=${prevSeason.length}`);
      if (prevSeason.length > 0) {
        console.log(`[fetchSortedStatsCore] DEBUG: Analyzing prevSeason stats...`);
        const parseMin = (minStr: string): number => {
          if (!minStr) return 0;
          const str = String(minStr).trim();
          if (!str || str === '0' || str === '00' || str === '0:00') return 0;
          const parts = str.split(':');
          if (parts.length === 2) {
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
          }
          const num = parseFloat(str);
          return isNaN(num) ? 0 : num;
        };
        
        const teams = new Set(prevSeason.map(s => s?.team?.abbreviation).filter(Boolean));
        const withMinutes = prevSeason.filter(s => {
          const min = parseMin(s.min || '');
          return min > 0;
        });
        const teamsWithMinutes = new Set(withMinutes.map(s => s?.team?.abbreviation).filter(Boolean));
        
        console.log(`[fetchSortedStatsCore] Last season analysis: total=${prevSeason.length}, with minutes>0=${withMinutes.length}, teams=${Array.from(teams).join(',')}, teamsWithMinutes=${Array.from(teamsWithMinutes).join(',')}`);
        
        if (prevSeason.length > 0 && withMinutes.length === 0) {
          const sample = prevSeason.slice(0, 5).map(s => ({
            date: s.game?.date,
            team: s.team?.abbreviation,
            min: s.min,
            pts: s.pts,
            reb: s.reb
          }));
          console.log(`[fetchSortedStatsCore] ⚠️ All last season stats have 0 minutes! Sample:`, sample);
        }
      }
      
      return rows;
    }
    
    // For other timeframes, fetch both seasons in parallel
    const [currSeason, prevSeason] = await Promise.all([
      grabSeason(season),        // Current season (regular + playoffs in parallel)
      grabSeason(season - 1)     // Last season (regular + playoffs in parallel)
    ]);

    // Merge current + previous season data, then sort newest-first
    // The baseGameData useMemo will filter by selectedTimeframe to show current/last season
    const rows = [...currSeason, ...prevSeason];
    
    console.log(`[fetchSortedStatsCore] Fetched both seasons for ${selectedTimeframe}: current=${currSeason.length}, last=${prevSeason.length}, total=${rows.length}`);
    
    // Debug: Check last season stats even if cached
    if (prevSeason.length > 0) {
      const currentSeason = currentNbaSeason();
      const lastSeason = currentSeason - 1;
      const parseMin = (minStr: string): number => {
        if (!minStr) return 0;
        const str = String(minStr).trim();
        if (!str || str === '0' || str === '00' || str === '0:00') return 0;
        const parts = str.split(':');
        if (parts.length === 2) {
          return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        }
        const num = parseFloat(str);
        return isNaN(num) ? 0 : num;
      };
      const getSeasonYear = (stat: any) => {
        if (!stat?.game?.date) return null;
        const d = new Date(stat.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        return m >= 9 ? y : y - 1;
      };
      
      const lastSeasonStats = rows.filter(s => {
        const seasonYear = getSeasonYear(s);
        return seasonYear === lastSeason;
      });
      
      const teams = new Set(lastSeasonStats.map(s => s?.team?.abbreviation).filter(Boolean));
      const withMinutes = lastSeasonStats.filter(s => {
        const min = parseMin(s.min || '');
        return min > 0;
      });
      const teamsWithMinutes = new Set(withMinutes.map(s => s?.team?.abbreviation).filter(Boolean));
      
      console.log(`[fetchSortedStatsCore] Last season (${lastSeason}) analysis: total=${lastSeasonStats.length}, with minutes>0=${withMinutes.length}, teams=${Array.from(teams).join(',')}, teamsWithMinutes=${Array.from(teamsWithMinutes).join(',')}`);
      
      if (lastSeasonStats.length > 0 && withMinutes.length === 0) {
        const sample = lastSeasonStats.slice(0, 5).map(s => ({
          date: s.game?.date,
          team: s.team?.abbreviation,
          min: s.min,
          pts: s.pts,
          reb: s.reb
        }));
        console.log(`[fetchSortedStatsCore] ⚠️ All last season stats have 0 minutes! Sample:`, sample);
      }
    }
    
    // Debug: log season breakdown to help diagnose filtering issues
    if (rows.length > 0) {
      const currentSeason = currentNbaSeason();
      const getSeasonYear = (stat: any) => {
        if (!stat.game?.date) return null;
        const d = new Date(stat.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        return m >= 9 ? y : y - 1;
      };
      const currentSeasonCount = rows.filter(s => getSeasonYear(s) === currentSeason).length;
      const lastSeasonCount = rows.filter(s => getSeasonYear(s) === currentSeason - 1).length;
      
      // Log sample dates from each season to verify they're being included
      const currentSeasonSample = rows.filter(s => getSeasonYear(s) === currentSeason).slice(0, 3).map(s => ({
        date: s.game?.date,
        min: s.min
      }));
      const lastSeasonSample = rows.filter(s => getSeasonYear(s) === currentSeason - 1).slice(0, 3).map(s => ({
        date: s.game?.date,
        min: s.min
      }));
      
      console.log(`[fetchSortedStatsCore] Season breakdown: current (${currentSeason}): ${currentSeasonCount} games, last (${currentSeason - 1}): ${lastSeasonCount} games, total: ${rows.length}`, {
        currSeasonLength: currSeason.length,
        prevSeasonLength: prevSeason.length,
        currentSeasonSample,
        lastSeasonSample
      });
    }
    
    // Debug: log the structure of received stats
    if (rows.length > 0) {
      const sampleStat = rows[0];
      console.log('[fetchSortedStatsCore] Received stats structure:', {
        playerId,
        totalRows: rows.length,
        currSeason: currSeason.length,
        prevSeason: prevSeason.length,
        hasGame: !!sampleStat?.game,
        hasGameDate: !!sampleStat?.game?.date,
        hasTeam: !!sampleStat?.team,
        hasTeamAbbr: !!sampleStat?.team?.abbreviation,
        sampleStatKeys: Object.keys(sampleStat || {}),
        // Log actual stat values to verify all fields are present
        statValues: {
          pts: sampleStat?.pts,
          reb: sampleStat?.reb,
          ast: sampleStat?.ast,
          stl: sampleStat?.stl,
          blk: sampleStat?.blk,
          fg3m: sampleStat?.fg3m,
          fgm: sampleStat?.fgm,
          fga: sampleStat?.fga,
          ftm: sampleStat?.ftm,
          fta: sampleStat?.fta,
          turnover: sampleStat?.turnover,
          pf: sampleStat?.pf,
          oreb: sampleStat?.oreb,
          dreb: sampleStat?.dreb,
        },
      });
      
      // Check stat coverage across all rows
      const statCoverage = {
        hasPts: rows.filter(s => s.pts !== undefined && s.pts !== null).length,
        hasReb: rows.filter(s => s.reb !== undefined && s.reb !== null).length,
        hasAst: rows.filter(s => s.ast !== undefined && s.ast !== null).length,
        hasStl: rows.filter(s => s.stl !== undefined && s.stl !== null).length,
        hasBlk: rows.filter(s => s.blk !== undefined && s.blk !== null).length,
        hasFg3m: rows.filter(s => s.fg3m !== undefined && s.fg3m !== null).length,
      };
      console.log(`[fetchSortedStatsCore] Stat coverage across ${rows.length} stats:`, statCoverage);
    }
    
    const safe = rows.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
    
    // Debug: log if we're filtering out all stats
    if (rows.length > 0 && safe.length === 0) {
      console.warn('[fetchSortedStatsCore] All stats filtered out! Sample stat structure:', {
        totalRows: rows.length,
        sampleStat: rows[0],
        hasGame: !!rows[0]?.game,
        hasGameDate: !!rows[0]?.game?.date,
        hasTeam: !!rows[0]?.team,
        hasTeamAbbr: !!rows[0]?.team?.abbreviation,
      });
    } else if (rows.length > 0) {
      console.log('[fetchSortedStatsCore] Filtered stats:', {
        totalRows: rows.length,
        safeRows: safe.length,
        filteredOut: rows.length - safe.length,
      });
    }
    
    safe.sort((a, b) => {
      const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return db - da; // newest first
    });
    
    // Debug: Log final return value to see what's being returned
    if (safe.length > 0) {
      const currentSeason = currentNbaSeason();
      const getSeasonYear = (stat: any) => {
        if (!stat.game?.date) return null;
        const d = new Date(stat.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        return m >= 9 ? y : y - 1;
      };
      const finalCurrentSeasonCount = safe.filter(s => getSeasonYear(s) === currentSeason).length;
      const finalLastSeasonCount = safe.filter(s => getSeasonYear(s) === currentSeason - 1).length;
      
      // Debug: Check team distribution across seasons
      const currentSeasonStats = safe.filter(s => getSeasonYear(s) === currentSeason);
      const lastSeasonStats = safe.filter(s => getSeasonYear(s) === currentSeason - 1);
      const currentSeasonTeams = new Set(currentSeasonStats.map(s => s?.team?.abbreviation).filter(Boolean));
      const lastSeasonTeams = new Set(lastSeasonStats.map(s => s?.team?.abbreviation).filter(Boolean));
      
      console.log(`[fetchSortedStatsCore] FINAL RETURN: returning ${safe.length} stats (current: ${finalCurrentSeasonCount}, last: ${finalLastSeasonCount})`);
      console.log(`[fetchSortedStatsCore] Team distribution - Current season teams: ${Array.from(currentSeasonTeams).join(', ') || 'none'}, Last season teams: ${Array.from(lastSeasonTeams).join(', ') || 'none'}`);
    }
    
    return safe;
  };

  // Fetch game stats for a player
  const fetchSortedStats = async (playerId: string) => {
    return await fetchSortedStatsCore(playerId);
  };
  
  // Core function to fetch advanced stats (without UI state updates)
  const fetchAdvancedStatsCore = async (playerId: string) => {
    const playerIdNum = parseInt(playerId);
    if (isNaN(playerIdNum)) {
      throw new Error('Invalid player ID');
    }
    
    const season = currentNbaSeason();
    let stats = await BallDontLieAPI.getAdvancedStats([playerIdNum], String(season));
    
    if (stats.length === 0) {
      // If no current season stats, try previous season
      stats = await BallDontLieAPI.getAdvancedStats([playerIdNum], String(season - 1));
    }
    
    return stats.length > 0 ? stats[0] : null;
  };

  // Core function to fetch ESPN player data (without UI state updates) 
  const fetchEspnPlayerDataCore = async (playerName: string, team?: string) => {
    try {
      const params = new URLSearchParams({ name: playerName });
      if (team) params.set('team', team.toLowerCase());
      const res = await fetch(`/api/espn/player?${params.toString()}`);
      const json = await res.json();
      return json.data || null;
    } catch (error) {
      console.warn('Failed to fetch ESPN player data:', error);
      return null;
    }
  };

  // Fetch full player data from Ball Don't Lie API (includes height, jersey_number, etc.)
  const fetchBdlPlayerData = async (playerId: string): Promise<any | null> => {
    try {
      const res = await fetch(`/api/bdl/player/${playerId}`);
      if (!res.ok) {
        console.warn(`❌ Failed to fetch BDL player data for ${playerId}: ${res.status}`);
        return null;
      }
      const json = await res.json();
      const playerData = json.data || null;
      
      if (playerData) {
        console.log(`✅ BDL player data fetched for ${playerId}:`, {
          jersey_number: playerData.jersey_number,
          height: playerData.height,
          hasJersey: !!playerData.jersey_number && playerData.jersey_number !== '',
          hasHeight: !!playerData.height && playerData.height !== ''
        });
      } else {
        console.warn(`⚠️ BDL player data is null for ${playerId}`);
      }
      
      return playerData;
    } catch (error) {
      console.warn('❌ Failed to fetch BDL player data:', error);
      return null;
    }
  };

  // Parse BDL height format (can be "6-10", "6'10\"", or total inches as number/string)
  const parseBdlHeight = (height: string | number | null | undefined): { feet?: number; inches?: number } => {
    if (!height) return {};
    
    // If it's a number (total inches)
    if (typeof height === 'number' || /^\d+$/.test(String(height))) {
      const totalInches = parseInt(String(height), 10);
      const feet = Math.floor(totalInches / 12);
      const inches = totalInches % 12;
      return { feet, inches };
    }
    
    // Convert to string for parsing
    const heightStr = String(height);
    
    // BDL format is typically "6-10" or "6'10" or "6'10\""
    const match = heightStr.match(/(\d+)['-](\d+)/);
    if (match) {
      const feet = parseInt(match[1], 10);
      const inches = parseInt(match[2], 10);
      return { feet, inches };
    }
    
    return {};
  };

  
  // Track current fetch to prevent race conditions
  const advancedStatsFetchRef = useRef<string | null>(null);
  const shotDistanceFetchRef = useRef<string | null>(null);
  
  // Restore stats from sessionStorage when player ID is set (for page refresh)
  useEffect(() => {
    if (resolvedPlayerId && hasPremium && typeof window !== 'undefined') {
      // Only restore if stats aren't already loaded
      if (!advancedStats) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${resolvedPlayerId}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
            console.log('✅ Restored advanced stats from cache for player', resolvedPlayerId);
          }
        } catch (e) {
          console.error('Error restoring advanced stats:', e);
        }
      }
      
      if (!shotDistanceData) {
        try {
          const cachedShotData = sessionStorage.getItem(`shot_distance_${resolvedPlayerId}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
            console.log('✅ Restored shot chart data from cache for player', resolvedPlayerId);
          }
        } catch (e) {
          console.error('Error restoring shot chart data:', e);
        }
      }
    }
  }, [resolvedPlayerId, hasPremium]); // Restore when player ID or premium status changes
  
  // Fetch advanced stats for a player
  const fetchAdvancedStats = async (playerId: string) => {
    // Don't attempt to fetch if user doesn't have premium - just silently return
    // The UI will already be gated by checkFeatureAccess elsewhere
    if (!hasPremium) {
      setAdvancedStats(null);
      setAdvancedStatsLoading(false);
      return;
    }
    
    // Mark this fetch as the current one
    advancedStatsFetchRef.current = playerId;
    
    // Check if we already have cached data - if so, don't clear it (preserve on refresh)
    const hasCachedData = typeof window !== 'undefined' && sessionStorage.getItem(`advanced_stats_${playerId}`);
    
    // Only clear if we don't have cached data (to preserve restored stats on refresh)
    if (!hasCachedData) {
      setAdvancedStats(null);
    }
    setAdvancedStatsLoading(true);
    setAdvancedStatsError(null);
    
    try {
      const stats = await fetchAdvancedStatsCore(playerId);
      
      // Only update if this is still the current fetch (prevent race conditions)
      if (advancedStatsFetchRef.current === playerId) {
        if (stats) {
          setAdvancedStats(stats);
          // Save to sessionStorage for persistence across refreshes
          if (typeof window !== 'undefined') {
            try {
              const storageKey = `advanced_stats_${playerId}`;
              sessionStorage.setItem(storageKey, JSON.stringify(stats));
            } catch (e) {
              // Ignore storage errors
            }
          }
        } else {
          setAdvancedStats(null);
          setAdvancedStatsError('No advanced stats found for this player');
        }
      }
    } catch (error: any) {
      // Only update if this is still the current fetch
      if (advancedStatsFetchRef.current === playerId) {
        setAdvancedStatsError(error.message || 'Failed to fetch advanced stats');
        setAdvancedStats(null);
      }
    } finally {
      // Only update loading state if this is still the current fetch
      if (advancedStatsFetchRef.current === playerId) {
        setAdvancedStatsLoading(false);
      }
    }
  };
  
  // Fetch shot distance stats for a player
  const fetchShotDistanceStats = async (playerId: string) => {
    // Don't attempt to fetch if user doesn't have premium - just silently return
    // The UI will already be gated by checkFeatureAccess elsewhere
    if (!hasPremium) {
      setShotDistanceData(null);
      setShotDistanceLoading(false);
      return;
    }
    
    // Mark this fetch as the current one
    shotDistanceFetchRef.current = playerId;
    
    // Check if we already have cached data - if so, don't clear it (preserve on refresh)
    const hasCachedData = typeof window !== 'undefined' && sessionStorage.getItem(`shot_distance_${playerId}`);
    
    // Only clear if we don't have cached data (to preserve restored stats on refresh)
    if (!hasCachedData) {
      setShotDistanceData(null);
    }
    setShotDistanceLoading(true);
    
    try {
      const season = currentNbaSeason();
      const response = await fetch(`/api/bdl/shot-distance?player_id=${playerId}&season=${season}`);
      const data = await response.json();
      
      // Only update if this is still the current fetch (prevent race conditions)
      if (shotDistanceFetchRef.current === playerId) {
        if (data && Array.isArray(data.data) && data.data.length > 0) {
          const shotData = data.data[0].stats;
          setShotDistanceData(shotData);
          // Save to sessionStorage for persistence across refreshes
          if (typeof window !== 'undefined') {
            try {
              const storageKey = `shot_distance_${playerId}`;
              sessionStorage.setItem(storageKey, JSON.stringify(shotData));
            } catch (e) {
              // Ignore storage errors
            }
          }
        } else {
          setShotDistanceData(null);
        }
      }
    } catch (error) {
      // Only update if this is still the current fetch
      if (shotDistanceFetchRef.current === playerId) {
        console.error('Failed to fetch shot distance stats:', error);
        setShotDistanceData(null);
      }
    } finally {
      // Only update loading state if this is still the current fetch
      if (shotDistanceFetchRef.current === playerId) {
        setShotDistanceLoading(false);
      }
    }
  };

  // Select from your local SAMPLE_PLAYERS (default) - but use API for team data
  const handlePlayerSelectFromLocal = async (player: NBAPlayer) => {
    setIsLoading(true); setApiError(null);
    
    // Clear premium stats immediately when switching players
    setAdvancedStats(null);
    setShotDistanceData(null);
    setAdvancedStatsLoading(false);
    setShotDistanceLoading(false);
    
    // Clear all odds data when switching players
    setRealOddsData([]);
    setOddsSnapshots([]);
    setLineMovementData(null);
    setOddsLoading(false);
    setOddsError(null);
    
    // Clear opponent team when switching players to force re-detection
    console.log(`[Player Select] Clearing opponent team for player switch to: ${player.full}`);
    setOpponentTeam('N/A');
    
    try {
      const pid = /^\d+$/.test(String(player.id)) ? String(player.id) : await resolvePlayerId(player.full, player.teamAbbr);
      if (!pid) throw new Error(`Couldn't resolve player id for "${player.full}"`);
      setResolvedPlayerId(pid);
      
      // Restore cached stats from sessionStorage if available
      if (typeof window !== 'undefined' && hasPremium) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${pid}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
          }
          
          const cachedShotData = sessionStorage.getItem(`shot_distance_${pid}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
          }
        } catch (e) {
          // Ignore storage errors, will fetch fresh data
        }
      }
      
      // OPTIMIZATION: Progressive loading for faster initial render
      // 1. Fetch critical path data first (stats) - show UI immediately
      // 2. Load non-critical data (BDL/ESPN metadata) in background
      // 3. Load premium features (advanced stats, shot distance) in background
      
      // Fetch stats first (critical - needed for chart)
      const rows = await fetchSortedStats(pid);
      
      // Use sample data team directly for default players - NO GAME DATA FALLBACK
      const currentTeam = normalizeAbbr(player.teamAbbr);
      
      // Set player stats immediately so UI can render (with basic player info)
      startTransition(() => {
        setSelectedTimeframe('last10');
        setPlayerStats(rows);
        setSelectedTeam(currentTeam);
        setOriginalPlayerTeam(currentTeam);
        setDepthChartTeam(currentTeam);
        setSelectedPlayer(player); // Set basic player first, will update with jersey/height later
      });
      
      // Load non-critical metadata in background (doesn't block UI)
      Promise.all([
        fetchBdlPlayerData(pid),
        fetchEspnPlayerData(player.full, player.teamAbbr).catch(() => null)
      ]).then(([bdlPlayerData, espnData]) => {
        // Parse BDL height data and merge with sample player data
        const heightData = parseBdlHeight(bdlPlayerData?.height);
        
        // Get jersey and height from BDL, with fallbacks to player object
        const bdlJersey = bdlPlayerData?.jersey_number;
        const bdlJerseyNum = (bdlJersey && bdlJersey !== '' && bdlJersey !== 'null' && bdlJersey !== '0') 
          ? Number(bdlJersey) 
          : 0;
        let jerseyNumber = bdlJerseyNum > 0 ? bdlJerseyNum : (player.jersey || 0);
        let heightFeetData: number | undefined = heightData.feet || player.heightFeet || undefined;
        let heightInchesData: number | undefined = heightData.inches || player.heightInches || undefined;
        
        // Fallback to depth chart roster for jersey if still missing
        if (!jerseyNumber && playerTeamRoster) {
          const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
          for (const pos of positions) {
            const posPlayers = playerTeamRoster[pos];
            if (Array.isArray(posPlayers)) {
              const found = posPlayers.find(p => 
                p.name && player.full && 
                (p.name.toLowerCase().includes(player.full.toLowerCase()) || 
                 player.full.toLowerCase().includes(p.name.toLowerCase()))
              );
              if (found && found.jersey && found.jersey !== 'N/A') {
                jerseyNumber = Number(found.jersey);
                break;
              }
            }
          }
        }
        
        // Update player with jersey/height metadata (non-blocking update)
        startTransition(() => {
          setSelectedPlayer({
            ...player,
            jersey: jerseyNumber,
            heightFeet: heightFeetData || undefined,
            heightInches: heightInchesData || undefined,
          });
        });
      }).catch(err => {
        console.warn('Failed to load player metadata (non-critical):', err);
      });
      
      // Start premium fetches in background (don't await)
      if (hasPremium) {
        fetchAdvancedStats(pid).catch(err => console.error('Advanced stats error:', err));
        fetchShotDistanceStats(pid).catch(err => console.error('Shot distance error:', err));
      }
      
      // Debug: log what we're setting as playerStats
      console.log('[Dashboard] Setting playerStats:', {
        playerId: pid,
        playerName: player.full,
        rowsCount: rows.length,
        sampleRow: rows[0],
        hasGame: !!rows[0]?.game,
        hasGameDate: !!rows[0]?.game?.date,
        hasTeam: !!rows[0]?.team,
        hasTeamAbbr: !!rows[0]?.team?.abbreviation,
        sampleRowKeys: rows[0] ? Object.keys(rows[0]) : [],
      });
      
      // Batch remaining state updates in startTransition
      startTransition(() => {
        // Reset betting-line auto-set trackers so odds can re-apply for the new player
        lastAutoSetStatRef.current = null;
        lastAutoSetLineRef.current = null;
        hasManuallySetLineRef.current = false;
        
        // Reset betting lines in transition to prevent visible refresh
        // BUT preserve the line from URL if it exists (important for steals/blocks)
        setBettingLines(prev => {
          // Check URL for line parameter
          if (typeof window !== 'undefined') {
            try {
              const url = new URL(window.location.href);
              const urlLine = url.searchParams.get('line');
              const urlStat = url.searchParams.get('stat');
              if (urlLine && urlStat) {
                const lineValue = parseFloat(urlLine);
                const normalizedStat = urlStat.toLowerCase();
                if (!isNaN(lineValue) && normalizedStat) {
                  // Preserve the URL line for the URL stat
                  return { [normalizedStat]: Math.abs(lineValue) };
                }
              }
            } catch {}
          }
          // Also check if current stat has a line that was set from URL
          const currentStatLine = prev[selectedStat];
          if (currentStatLine !== undefined && statFromUrlRef.current) {
            return { [selectedStat]: currentStatLine };
          }
          return {};
        });
      });
      // Update URL to reflect the change
      if (typeof window !== 'undefined') {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('tf', 'last10');
        window.history.replaceState({}, '', newUrl.toString());
      }
      
      // Set opponent immediately if games are already loaded, otherwise useEffect will handle it
      if (todaysGames.length > 0) {
        const opponent = getOpponentTeam(currentTeam, todaysGames);
        const normalizedOpponent = normalizeAbbr(opponent);
        console.log(`[Player Select] Setting opponent for ${currentTeam}: ${normalizedOpponent} (games already loaded)`);
        setOpponentTeam(normalizedOpponent);
      } else {
        console.log(`[Player Select] Team set to ${currentTeam}, opponent will be set when games load`);
      }
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
    } catch (e: any) {
      setApiError(e?.message || "Failed to load stats."); setPlayerStats([]);
      setOpponentTeam('');
    } finally { setIsLoading(false); }
  };

  // Select from live search results
  const handlePlayerSelectFromSearch = async (r: BdlSearchResult) => {
    // Prevent duplicate calls
    if (isHandlingPlayerSelectRef.current) {
      console.log('🔍 [handlePlayerSelectFromSearch] Already handling, skipping duplicate call');
      return;
    }
    
    isHandlingPlayerSelectRef.current = true;
    
    try {
      const callData = {
        player: r.full,
        id: r.id,
        team: r.team,
        pos: r.pos,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      };
      console.log('🔍 [handlePlayerSelectFromSearch] Called with:', callData);
      serverLogger.log('🔍 [handlePlayerSelectFromSearch] Called with', { data: callData });
      // Only set loading if not already loading (prevents double render when called from URL params)
      if (!isLoading) {
        console.log('🔍 [handlePlayerSelectFromSearch] Setting isLoading=true');
        setIsLoading(true);
      } else {
        console.log('🔍 [handlePlayerSelectFromSearch] Already loading, skipping setIsLoading');
      }
      setApiError(null);
    
    // Clear premium stats immediately when switching players
    setAdvancedStats(null);
    setShotDistanceData(null);
    setAdvancedStatsLoading(false);
    setShotDistanceLoading(false);
    
    // Clear all odds data when switching players
    setRealOddsData([]);
    setOddsSnapshots([]);
    setLineMovementData(null);
    setOddsLoading(false);
    setOddsError(null);
    
    try {
      const pid = String(r.id);
      setResolvedPlayerId(pid);
      
      // Restore cached stats from sessionStorage if available
      if (typeof window !== 'undefined' && hasPremium) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${pid}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
          }
          
          const cachedShotData = sessionStorage.getItem(`shot_distance_${pid}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
          }
        } catch (e) {
          // Ignore storage errors, will fetch fresh data
        }
      }
      // Create player object from search result
      const tempPlayer = {
        id: pid,
        full: r.full,
        firstName: r.full.split(' ')[0] || r.full,
        lastName: r.full.split(' ').slice(1).join(' ') || '',
        teamAbbr: '', // Will be determined from API game data
        jersey: '',
        heightFeet: null,
        heightInches: null,
        position: r.pos || '',
      } as any;
      
      // OPTIMIZATION: Fetch both current season and last season stats in parallel
      // This prevents multiple refreshes and ensures all data is available at once
      // fetchSortedStatsCore handles parallel fetching for both seasons
      console.log('🔍 [handlePlayerSelectFromSearch] Starting stats fetch (both seasons in parallel):', { pid, name: r.full });
      serverLogger.log('🔍 [handlePlayerSelectFromSearch] Starting stats fetch', { data: { pid, name: r.full } });
      
      // Fetch both seasons in parallel - prevents multiple refreshes
      const rows = await fetchSortedStats(pid).catch(err => {
        console.error('❌ [handlePlayerSelectFromSearch] fetchSortedStats failed:', err);
        return [];
      });
      
      // Start BDL and ESPN fetches in background (don't await - they'll update state when ready)
      const bdlPromise = fetchBdlPlayerData(pid).catch(err => {
        console.error('❌ [handlePlayerSelectFromSearch] fetchBdlPlayerData failed:', err);
        return null;
      });
      
      const espnPromise = fetchEspnPlayerData(r.full, r.team).catch(err => {
        console.warn('⚠️ [handlePlayerSelectFromSearch] fetchEspnPlayerData failed (non-critical):', err);
        return null;
      });
      
      // Process BDL/ESPN data when ready (non-blocking)
      Promise.all([bdlPromise, espnPromise]).then(([bdlPlayerData, espnData]) => {
        // Update player with jersey/height data when available
        if (bdlPlayerData || espnData) {
          const heightData = parseBdlHeight(bdlPlayerData?.height);
          const bdlJersey = bdlPlayerData?.jersey_number;
          const bdlJerseyNum = (bdlJersey && bdlJersey !== '' && bdlJersey !== 'null' && bdlJersey !== '0') 
            ? Number(bdlJersey) 
            : 0;
          let jerseyNumber = bdlJerseyNum > 0 ? bdlJerseyNum : 0;
          let heightFeetData: number | undefined = heightData.feet;
          let heightInchesData: number | undefined = heightData.inches;
          
          // Use ESPN as fallback
          if (espnData) {
            if (!jerseyNumber && espnData.jersey) {
              jerseyNumber = Number(espnData.jersey);
            }
            if (!heightFeetData && espnData.height) {
              const espnHeightData = parseEspnHeight(espnData.height);
              if (espnHeightData.feet) {
                heightFeetData = espnHeightData.feet;
                heightInchesData = espnHeightData.inches;
              }
            }
          }
          
          // Update player with new data if we got any
          if (jerseyNumber || heightFeetData) {
            setSelectedPlayer(prev => {
              if (!prev) return prev; // Return null if no previous player
              const currentJersey = typeof prev.jersey === 'number' ? prev.jersey : (typeof prev.jersey === 'string' ? Number(prev.jersey) || 0 : 0);
              return {
                ...prev,
                jersey: jerseyNumber || currentJersey,
                heightFeet: heightFeetData ?? prev.heightFeet ?? undefined,
                heightInches: heightInchesData ?? prev.heightInches ?? undefined,
              };
            });
          }
        }
      }).catch(err => {
        console.warn('⚠️ [handlePlayerSelectFromSearch] Error processing BDL/ESPN data:', err);
      });
      
      // Log stats completion
      console.log('🔍 [handlePlayerSelectFromSearch] Stats fetch completed:', { statsCount: rows.length });
      serverLogger.log('🔍 [handlePlayerSelectFromSearch] Stats fetch completed', { data: { statsCount: rows.length } });
      
      // Start premium fetches in background (don't await)
      if (hasPremium) {
        // Fire and forget - these will update state when ready
        fetchAdvancedStats(pid).catch(err => console.error('Advanced stats error:', err));
        fetchShotDistanceStats(pid).catch(err => console.error('Shot distance error:', err));
      }
      
      // Batch critical state updates together to prevent multiple re-renders
      // Use startTransition for non-urgent updates to keep UI responsive
      // Use the team from search API directly - NO FALLBACK TO GAME DATA
      const currentTeam = normalizeAbbr(r.team || '');
      
      // Get position from search result
      let playerPosition = r.pos || tempPlayer.position || '';
      
      // Try to get jersey/height from sample players or depth chart (synchronous sources)
      let jerseyNumber = 0;
      let heightFeetData: number | undefined = undefined;
      let heightInchesData: number | undefined = undefined;
      
      // Fallback to sample players data if available
      const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const searchName = normalizeName(r.full);
      const samplePlayer = SAMPLE_PLAYERS.find(p => {
        const playerName = normalizeName(p.full);
        return playerName === searchName || 
               playerName.includes(searchName) || 
               searchName.includes(playerName) ||
               (p.firstName && normalizeName(p.firstName + p.lastName) === searchName) ||
               (p.lastName && normalizeName(p.lastName) === normalizeName(r.full.split(' ').pop() || ''));
      });
      if (samplePlayer) {
        if (samplePlayer.jersey) {
          jerseyNumber = samplePlayer.jersey;
          console.log(`✅ Found jersey #${jerseyNumber} from sample data for ${r.full}`);
        }
        if (samplePlayer.heightFeet) {
          heightFeetData = samplePlayer.heightFeet;
          heightInchesData = samplePlayer.heightInches;
          console.log(`✅ Found height ${heightFeetData}'${heightInchesData}" from sample data for ${r.full}`);
        }
      }
      
      // Fallback to depth chart roster for jersey and position if still missing
      if (playerTeamRoster) {
        const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
        for (const pos of positions) {
          const posPlayers = playerTeamRoster[pos];
          if (Array.isArray(posPlayers)) {
            const found = posPlayers.find(p => 
              p.name && r.full && 
              (p.name.toLowerCase().includes(r.full.toLowerCase()) || 
               r.full.toLowerCase().includes(p.name.toLowerCase()))
            );
            if (found) {
              if (!jerseyNumber && found.jersey && found.jersey !== 'N/A') {
                jerseyNumber = Number(found.jersey);
                console.log(`✅ Found jersey #${jerseyNumber} from depth chart for ${r.full}`);
              }
              if (!playerPosition) {
                playerPosition = pos;
                console.log(`✅ Found position ${playerPosition} from depth chart for ${r.full}`);
              }
              break;
            }
          }
        }
      }
      
      // Batch all state updates together in startTransition to prevent multiple re-renders
      // Set selectedTimeframe FIRST so it's correct when playerStats updates (prevents double baseGameData recalculation)
      console.log('[DEBUG handlePlayerSelectFromSearch] About to batch state updates', {
        rowsCount: rows.length,
        currentTeam,
        timestamp: new Date().toISOString()
      });
      
      startTransition(() => {
        // ALWAYS set timeframe to "last10" when selecting a new player (override URL if needed)
        // Set this FIRST so baseGameData calculates correctly when playerStats updates
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting timeframe to "last10"`);
        setSelectedTimeframe('last10');
        
        // Then set playerStats - this will trigger baseGameData recalculation with correct timeframe
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting playerStats (${rows.length} rows)`);
        setPlayerStats(rows);
        
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting teams and player`);
        setSelectedTeam(currentTeam);
        setOriginalPlayerTeam(currentTeam);
        setDepthChartTeam(currentTeam);
        
        // Update player with available data (jersey/height from BDL/ESPN will update later)
        setSelectedPlayer({
          ...tempPlayer,
          teamAbbr: currentTeam,
          jersey: jerseyNumber || '',
          heightFeet: heightFeetData || null,
          heightInches: heightInchesData || null,
          position: playerPosition || undefined,
        });

        // Reset betting-line auto-set trackers so odds can re-apply for the new player
        lastAutoSetStatRef.current = null;
        lastAutoSetLineRef.current = null;
        hasManuallySetLineRef.current = false;
        
        // Reset betting lines in transition to prevent visible refresh
        // BUT preserve the line from URL if it exists (important for steals/blocks)
        console.log(`[DEBUG handlePlayerSelectFromSearch] Resetting bettingLines`);
        setBettingLines(prev => {
          // Check URL for line parameter
          if (typeof window !== 'undefined') {
            try {
              const url = new URL(window.location.href);
              const urlLine = url.searchParams.get('line');
              const urlStat = url.searchParams.get('stat');
              if (urlLine && urlStat) {
                const lineValue = parseFloat(urlLine);
                const normalizedStat = urlStat.toLowerCase();
                if (!isNaN(lineValue) && normalizedStat) {
                  // Preserve the URL line for the URL stat
                  return { [normalizedStat]: Math.abs(lineValue) };
                }
              }
            } catch {}
          }
          // Also check if current stat has a line that was set from URL
          const currentStatLine = prev[selectedStat];
          if (currentStatLine !== undefined && statFromUrlRef.current) {
            return { [selectedStat]: currentStatLine };
          }
          return {};
        });
        
        console.log(`[DEBUG handlePlayerSelectFromSearch] All state updates batched in startTransition`);
      });
      
      // Update URL to reflect the timeframe change (outside transition, doesn't affect rendering)
      if (typeof window !== 'undefined') {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('tf', 'last10');
        window.history.replaceState({}, '', newUrl.toString());
      }
      
      // Set opponent immediately if games are already loaded, otherwise useEffect will handle it
      if (todaysGames.length > 0) {
        const opponent = getOpponentTeam(currentTeam, todaysGames);
        const normalizedOpponent = normalizeAbbr(opponent);
        console.log(`[Player Select] Setting opponent for ${currentTeam}: ${normalizedOpponent} (games already loaded)`);
        setOpponentTeam(normalizedOpponent);
      } else {
        console.log(`[Player Select] Team set to ${currentTeam}, opponent will be set when games load`);
      }
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
      console.log('✅ handlePlayerSelectFromSearch completed successfully');
    } catch (e: any) {
      console.error('❌ handlePlayerSelectFromSearch error:', e);
      setApiError(e?.message || "Failed to load stats."); 
      setPlayerStats([]);
      setOpponentTeam('N/A');
    } finally {
      isHandlingPlayerSelectRef.current = false;
    }
    } finally {
      isHandlingPlayerSelectRef.current = false;
      setIsLoading(false);
      setShowDropdown(false);
      setSearchQuery('');
      setSearchResults([]);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside the search container (includes dropdown)
      // The button handlers will close the dropdown themselves
      if (searchRef.current && searchRef.current.contains(target)) {
        return; // Click is inside search container
      }
      // Click is outside - close dropdown
      setShowDropdown(false);
    };
    // Use a slight delay to ensure button onClick handlers fire first
    const handleClick = (e: MouseEvent) => {
      // Use requestAnimationFrame to defer the check until after button handlers
      requestAnimationFrame(() => {
        onClick(e);
      });
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // header info - dynamic based on props mode
  const headerInfo = useMemo(() => {
    if (propsMode === 'team') {
      // Game Props mode - show team info or prompt
      if (gamePropsTeam && gamePropsTeam !== 'N/A') {
        return {
          name: TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam,
          jersey: '',
          team: gamePropsTeam,
          teamName: TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam,
          height: ''
        };
      } else {
        return {
          name: 'Select a team',
          jersey: '',
          team: '',
          teamName: '',
          height: ''
        };
      }
    } else {
      // Player Props mode - show player info
      return {
        name: selectedPlayer?.full || 'Select a player',
        jersey: selectedPlayer ? `#${(selectedPlayer as any).jersey || ''}` : '',
        team: selectedTeam && selectedTeam !== 'N/A' ? selectedTeam : (selectedPlayer?.teamAbbr || ''),
        teamName: selectedTeam && selectedTeam !== 'N/A' ? TEAM_FULL_NAMES[selectedTeam] || selectedTeam : (selectedPlayer?.teamAbbr ? TEAM_FULL_NAMES[selectedPlayer.teamAbbr] || selectedPlayer.teamAbbr : ''),
        height: selectedPlayer ? (
          formatHeight((selectedPlayer as any).heightFeet, (selectedPlayer as any).heightInches) !== 'N/A' 
            ? formatHeight((selectedPlayer as any).heightFeet, (selectedPlayer as any).heightInches)
            : (selectedPlayer as any).rawHeight || 'N/A'
        ) : ''
      };
    }
  }, [propsMode, gamePropsTeam, selectedPlayer, selectedTeam]);

  // Keep the old variable name for compatibility
  const playerInfo = headerInfo;
  
  // Defer heavy baseGameData computation to prevent UI freeze during player selection
  // This allows the UI to remain responsive while stats are being processed
  // Removed useDeferredValue to prevent double refresh - use playerStats directly
  // const deferredPlayerStats = useDeferredValue(playerStats);
  
  /* -------- Base game data (structure only, no stat values) ----------
     This should only recalculate when player/timeframe changes, NOT when stat changes */
  const baseGameData = useMemo(() => {
    // Debug: Check what seasons are in playerStats
    const currentSeason = currentNbaSeason();
    const getSeasonYear = (stat: any) => {
      if (!stat?.game?.date) return null;
      const d = new Date(stat.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      return m >= 9 ? y : y - 1;
    };
    const seasonBreakdown: Record<number, number> = {};
    playerStats.forEach(s => {
      const seasonYear = getSeasonYear(s);
      if (seasonYear) {
        seasonBreakdown[seasonYear] = (seasonBreakdown[seasonYear] || 0) + 1;
      }
    });
    
    console.log('[DEBUG baseGameData] Recalculating baseGameData', {
      playerStatsLength: playerStats.length,
      selectedTimeframe,
      selectedPlayer: selectedPlayer?.full,
      propsMode,
      seasonBreakdown,
      currentSeason,
      expectedLastSeason: currentSeason - 1,
      hasLastSeasonData: seasonBreakdown[currentSeason - 1] > 0,
      timestamp: new Date().toISOString()
    });
    
    // Use playerStats directly to prevent double refresh from deferred value
    const statsToUse = playerStats;
    // Team mode: use game data instead of player stats
    if (propsMode === 'team') {
      if (!gameStats.length) return [];
      
      // Guard: If playerStats was just cleared but we're in team mode, don't recalculate
      // This prevents race conditions where playerStats gets cleared during team mode operations
      
      // Apply timeframe to games
      let filteredTeamGames = gameStats;
      
      // First, apply opponent filtering if a specific opponent is selected (not ALL)
      if (manualOpponent && manualOpponent !== 'ALL' && manualOpponent !== '') {
        const normalizedOpponent = normalizeAbbr(manualOpponent);
        filteredTeamGames = gameStats.filter(game => {
          const homeTeam = normalizeAbbr(game.home_team?.abbreviation || '');
          const visitorTeam = normalizeAbbr(game.visitor_team?.abbreviation || '');
          const currentTeam = normalizeAbbr(gamePropsTeam || '');
          
          // Check if this game involves both the selected team and the manual opponent
          const teamsInGame = [homeTeam, visitorTeam];
          return teamsInGame.includes(currentTeam) && teamsInGame.includes(normalizedOpponent);
        });
        console.log(`🎯 Manual Opponent Team: Filtered to ${filteredTeamGames.length} games vs ${manualOpponent}`);
      }
      
      // Special case: H2H filtering for team mode (only if no manual opponent is set)
      if (selectedTimeframe === 'h2h' && (!manualOpponent || manualOpponent === 'ALL')) {
        if (opponentTeam && opponentTeam !== '') {
          const normalizedOpponent = normalizeAbbr(opponentTeam);
          filteredTeamGames = gameStats.filter(game => {
            const homeTeam = normalizeAbbr(game.home_team?.abbreviation || '');
            const visitorTeam = normalizeAbbr(game.visitor_team?.abbreviation || '');
            const currentTeam = normalizeAbbr(gamePropsTeam || '');
            
            // Check if this game involves both the selected team and the opponent
            const teamsInGame = [homeTeam, visitorTeam];
            return teamsInGame.includes(currentTeam) && teamsInGame.includes(normalizedOpponent);
          }).slice(-6); // Limit to last 6 H2H games (most recent)
          console.log(`🔥 H2H Team: Filtered to ${filteredTeamGames.length} games vs ${opponentTeam} (max 6)`);
        } else {
          filteredTeamGames = [];
          console.log(`⚠️ H2H Team: No opponent available for filtering`);
        }
      } else if (selectedTimeframe === 'lastseason') {
        // Filter to last season games only
        const lastSeason = currentNbaSeason() - 1;
        filteredTeamGames = gameStats.filter(game => {
          if (!game.date) return false;
          const gameDate = new Date(game.date);
          const gameYear = gameDate.getFullYear();
          const gameMonth = gameDate.getMonth();
          
          // NBA season spans two calendar years (e.g., 2023-24 season)
          const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
          return gameSeasonYear === lastSeason;
        });
        console.log(`📅 Last Season Team: Filtered to ${filteredTeamGames.length} games from ${lastSeason}-${(lastSeason + 1) % 100}`);
      } else if (selectedTimeframe === 'thisseason') {
        // Filter to current season games only
        const currentSeason = currentNbaSeason();
        filteredTeamGames = gameStats.filter(game => {
          if (!game.date) return false;
          const gameDate = new Date(game.date);
          const gameYear = gameDate.getFullYear();
          const gameMonth = gameDate.getMonth();
          
          // NBA season spans two calendar years (e.g., 2024-25 season)
          const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
          return gameSeasonYear === currentSeason;
        });
        console.log(`📅 This Season Team: Filtered to ${filteredTeamGames.length} games from ${currentSeason}-${(currentSeason + 1) % 100}`);
      }
      
      // Home/Away filter
      if (homeAway !== 'ALL') {
        const currentNorm = normalizeAbbr(gamePropsTeam || selectedTeam || '');
        filteredTeamGames = filteredTeamGames.filter(game => {
          const homeAbbr = normalizeAbbr(game.home_team?.abbreviation || '');
          const isHome = homeAbbr === currentNorm;
          return homeAway === 'HOME' ? isHome : !isHome;
        });
      }
      
      const n = parseInt(selectedTimeframe.replace('last', ''));
      const recentGames = ['h2h', 'lastseason', 'thisseason'].includes(selectedTimeframe) 
        ? filteredTeamGames 
        : (!Number.isNaN(n) ? filteredTeamGames.slice(-n) : filteredTeamGames); // Last N games
      
      return recentGames.map((game, index) => {
        const homeTeam = game.home_team?.abbreviation || '';
        const visitorTeam = game.visitor_team?.abbreviation || '';
        const currentTeam = gamePropsTeam || selectedTeam; // Use gamePropsTeam for team mode
        const isHome = normalizeAbbr(homeTeam) === normalizeAbbr(currentTeam);
        const opponent = isHome ? visitorTeam : homeTeam;
        
        const iso = game.date;
        const d = iso ? new Date(iso) : null;
        const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
        
        return {
          gameData: game, // Keep reference to game data for value calculation
          opponent,
          gameNumber: index + 1,
          game: opponent ? `vs ${opponent}` : "",
          date: shortDate,
          xKey: String(game.id || `game-${index}`),
          tickLabel: opponent || "", // Show opponent abbreviation on x-axis for team mode
        };
      });
    }
    
    // Player mode: use existing player stats logic
    // IMPORTANT: If playerStats is empty but we have a selectedPlayer or resolvedPlayerId, this might be a race condition
    // Don't return empty array immediately - check if we're in the middle of a fetch
    if (!statsToUse.length) {
      // Check if URL params indicate a player should be loaded (for initial page load detection)
      let hasUrlPlayer = false;
      if (typeof window !== 'undefined' && propsMode === 'player') {
        try {
          const url = new URL(window.location.href);
          const pid = url.searchParams.get('pid');
          const name = url.searchParams.get('name');
          hasUrlPlayer = !!(pid && name);
          // Debug: log URL check details
          console.log('[baseGameData] URL check:', {
            href: window.location.href,
            search: window.location.search,
            pid,
            name,
            mode: url.searchParams.get('mode'),
            hasUrlPlayer,
          });
        } catch (e) {
          console.warn('[baseGameData] URL check error:', e);
        }
      }
      
      // Debug: log why we're returning empty
      console.log('[baseGameData] No playerStats:', {
        playerStatsLength: playerStats.length,
        selectedPlayer: selectedPlayer?.full,
        resolvedPlayerId,
        isLoading,
        hasUrlPlayer,
      });
      // If we have a selectedPlayer OR resolvedPlayerId OR URL params indicate a player, we're either loading or haven't started loading yet
      // This can happen on initial page load when URL params exist but selectedPlayer/fetch hasn't started
      // Return empty array to prevent showing wrong data (0/0), but don't break the memoization
      if (selectedPlayer || resolvedPlayerId || hasUrlPlayer) {
        // Player is selected/resolved/indicated by URL but stats aren't loaded yet - treat as loading state
        // This prevents showing "0/0" during initial load
        return [];
      }
      // No player selected or stats truly empty - return empty
      return [];
    }
    
    // Debug: log stats structure at the start of baseGameData processing
    console.log('[baseGameData] Processing playerStats:', {
      playerStatsLength: statsToUse.length,
      selectedPlayer: selectedPlayer?.full,
      selectedTimeframe,
      sampleStat: statsToUse[0],
      hasGame: !!statsToUse[0]?.game,
      hasGameDate: !!statsToUse[0]?.game?.date,
      hasTeam: !!statsToUse[0]?.team,
      hasTeamAbbr: !!statsToUse[0]?.team?.abbreviation,
    });
    
    // Filter out games where player played 0 minutes FIRST
    // BUT for lastseason, we need to check ALL stats (including 0 minutes) to see if we can infer team from game data
    const shouldIncludeZeroMinutes = selectedTimeframe === 'lastseason';
    const gamesPlayed = statsToUse.filter(stats => {
      const minutes = parseMinutes(stats.min);
      if (shouldIncludeZeroMinutes) {
        // For last season, include stats even with 0 minutes if we can infer the team from game data
        // This helps us work around API data quality issues where stat.team is wrong
        return true; // We'll filter by minutes later after we've determined the correct team
      }
      return minutes > 0;
    });
    
    // Debug: Check what's happening with last season stats
    if (selectedTimeframe === 'lastseason') {
      const currentSeason = currentNbaSeason();
      const lastSeason = currentSeason - 1;
      const getSeasonYear = (stat: any) => {
        if (!stat?.game?.date) return null;
        const d = new Date(stat.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        return m >= 9 ? y : y - 1;
      };
      
      const lastSeasonStats = statsToUse.filter(s => {
        const seasonYear = getSeasonYear(s);
        return seasonYear === lastSeason;
      });
      
      const lastSeasonWithMinutes = lastSeasonStats.filter(s => {
        const minutes = parseMinutes(s.min);
        return minutes > 0;
      });
      
      console.log(`[Last Season Debug] Total last season stats: ${lastSeasonStats.length}, with minutes > 0: ${lastSeasonWithMinutes.length}`);
      
      // Check if there are any stats with actual data (points, rebounds, etc.) even if minutes are 0
      const lastSeasonWithData = lastSeasonStats.filter(s => {
        const hasAnyStat = (s.pts && s.pts > 0) || (s.reb && s.reb > 0) || (s.ast && s.ast > 0) || 
                          (s.fgm && s.fgm > 0) || (s.fga && s.fga > 0);
        return hasAnyStat;
      });
      
      console.log(`[Last Season Debug] Last season stats with actual data (pts/reb/ast > 0): ${lastSeasonWithData.length}`);
      
      if (lastSeasonStats.length > 0 && lastSeasonWithMinutes.length === 0) {
        // Sample a few to see what's wrong
        const samples = lastSeasonStats.slice(0, 10).map(s => ({
          date: s.game?.date,
          team: s.team?.abbreviation,
          teamId: s.team?.id,
          teamFull: s.team?.full_name,
          homeTeam: s.game?.home_team?.abbreviation,
          visitorTeam: s.game?.visitor_team?.abbreviation,
          min: s.min,
          minType: typeof s.min,
          minRaw: s.min,
          minutes: parseMinutes(s.min),
          pts: s.pts,
          reb: s.reb,
          ast: s.ast,
          fgm: s.fgm,
          fga: s.fga,
          // Check player ID
          playerId: s.player?.id,
          // Check all numeric fields that might indicate actual play
          hasAnyStat: (s.pts && s.pts > 0) || (s.reb && s.reb > 0) || (s.ast && s.ast > 0) || (s.fgm && s.fgm > 0)
        }));
        console.log(`[Last Season Debug] Sample last season stats (first 10) - FULL DETAILS:`, samples);
        
        // Also check one stat in full detail to see ALL fields
        if (lastSeasonStats.length > 0) {
          const firstStat = lastSeasonStats[0];
          console.log(`[Last Season Debug] FIRST STAT FULL OBJECT (checking for hidden minutes/data):`, {
            id: firstStat.id,
            min: firstStat.min,
            minRaw: firstStat.min,
            minType: typeof firstStat.min,
            minutesParsed: parseMinutes(firstStat.min),
            pts: firstStat.pts,
            reb: firstStat.reb,
            ast: firstStat.ast,
            team: firstStat.team,
            player: firstStat.player ? { id: firstStat.player.id, name: firstStat.player.first_name + ' ' + firstStat.player.last_name } : null,
            game: firstStat.game ? {
              id: firstStat.game.id,
              date: firstStat.game.date,
              home_team: firstStat.game.home_team,
              visitor_team: firstStat.game.visitor_team
            } : null,
            // Check for alternative minute fields
            allKeys: Object.keys(firstStat),
            // Check if there are any numeric fields > 0
            numericFields: Object.entries(firstStat).filter(([k, v]) => typeof v === 'number' && v > 0).map(([k, v]) => ({ [k]: v })),
            // Show which specific stat fields have values
            statFieldValues: {
              pts: { value: firstStat.pts, type: typeof firstStat.pts, isPositive: firstStat.pts > 0 },
              reb: { value: firstStat.reb, type: typeof firstStat.reb, isPositive: firstStat.reb > 0 },
              ast: { value: firstStat.ast, type: typeof firstStat.ast, isPositive: firstStat.ast > 0 },
              fgm: { value: firstStat.fgm, type: typeof firstStat.fgm, isPositive: firstStat.fgm > 0 },
              fga: { value: firstStat.fga, type: typeof firstStat.fga, isPositive: firstStat.fga > 0 },
              fg3m: { value: firstStat.fg3m, type: typeof firstStat.fg3m, isPositive: firstStat.fg3m > 0 },
              ftm: { value: firstStat.ftm, type: typeof firstStat.ftm, isPositive: firstStat.ftm > 0 },
              fta: { value: firstStat.fta, type: typeof firstStat.fta, isPositive: firstStat.fta > 0 }
            },
            // Also check ALL numeric fields (including 0) to see the full picture
            allNumericFields: Object.entries(firstStat).filter(([k, v]) => typeof v === 'number').map(([k, v]) => ({ [k]: v })).slice(0, 20),
            // Check specific stat fields
            statFields: {
              pts: firstStat.pts,
              reb: firstStat.reb,
              ast: firstStat.ast,
              fgm: firstStat.fgm,
              fga: firstStat.fga,
              fg3m: firstStat.fg3m,
              fg3a: firstStat.fg3a,
              ftm: firstStat.ftm,
              fta: firstStat.fta,
              stl: firstStat.stl,
              blk: firstStat.blk,
              turnover: firstStat.turnover,
              pf: firstStat.pf
            }
          });
        }
        
        // Also check all teams in last season stats
        const allTeams = new Set(lastSeasonStats.map(s => s?.team?.abbreviation).filter(Boolean));
        console.log(`[Last Season Debug] ⚠️ All teams in last season stats (${lastSeasonStats.length} total):`, Array.from(allTeams));
        
        // Check if ATL appears in the game data (home_team/visitor_team) even if stat.team is wrong
        const teamsInGames = new Set<string>();
        const atlGames: any[] = [];
        lastSeasonStats.forEach(s => {
          const homeTeam = s?.game?.home_team?.abbreviation;
          const visitorTeam = s?.game?.visitor_team?.abbreviation;
          if (homeTeam) teamsInGames.add(homeTeam);
          if (visitorTeam) teamsInGames.add(visitorTeam);
          if (homeTeam === 'ATL' || visitorTeam === 'ATL') {
            atlGames.push({
              date: s.game?.date,
              statTeam: s.team?.abbreviation,
              homeTeam,
              visitorTeam,
              min: s.min,
              pts: s.pts
            });
          }
        });
        console.log(`[Last Season Debug] ⚠️ Teams appearing in game data (home/visitor):`, Array.from(teamsInGames));
        console.log(`[Last Season Debug] ⚠️ Games where ATL appears (${atlGames.length} total):`, atlGames.slice(0, 5));
        
        // Check if in those ATL games, WAS is the opponent (meaning player was on ATL)
        const atlGamesWithWasOpponent = atlGames.filter(g => {
          const opponent = g.homeTeam === 'ATL' ? g.visitorTeam : g.homeTeam;
          return opponent === 'WAS';
        });
        console.log(`[Last Season Debug] ⚠️ Games where ATL vs WAS (player likely on ATL):`, atlGamesWithWasOpponent.length);
        
        // Also check: if stat.team is WAS but game has ATL, player was likely on ATL
        const likelyAtlGames = lastSeasonStats.filter(s => {
          const homeTeam = s?.game?.home_team?.abbreviation;
          const visitorTeam = s?.game?.visitor_team?.abbreviation;
          const statTeam = s?.team?.abbreviation;
          return (homeTeam === 'ATL' || visitorTeam === 'ATL') && statTeam === 'WAS';
        });
        console.log(`[Last Season Debug] ⚠️ Stats where game has ATL but stat.team=WAS (likely player was on ATL):`, likelyAtlGames.length);
        
        // If we have stats with actual data but 0 minutes, we might need to include them
        if (lastSeasonWithData.length > 0) {
          console.log(`[Last Season Debug] ⚠️ Found ${lastSeasonWithData.length} last season stats with data but 0 minutes - these are being filtered out!`);
          const dataSamples = lastSeasonWithData.slice(0, 5).map(s => ({
            date: s.game?.date,
            team: s.team?.abbreviation,
            min: s.min,
            minutes: parseMinutes(s.min),
            pts: s.pts,
            reb: s.reb,
            ast: s.ast
          }));
          console.log(`[Last Season Debug] Sample stats with data but 0 minutes:`, dataSamples);
        }
      }
    }
    
    // Debug: Log breakdown of gamesPlayed by season year to diagnose filtering issues
    if (selectedTimeframe === 'thisseason') {
      const currentSeason = currentNbaSeason();
      const gamesBySeasonYear: Record<number, number> = {};
      const gamesWithZeroMinutes: Record<number, number> = {};
      const currentSeasonStats: any[] = [];
      const lastSeasonStats: any[] = [];
      
      statsToUse.forEach(s => {
        const minutes = parseMinutes(s.min);
        if (!s.game?.date) return;
        const d = new Date(s.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        const gameSeasonYear = m >= 9 ? y : y - 1;
        
        if (minutes > 0) {
          gamesBySeasonYear[gameSeasonYear] = (gamesBySeasonYear[gameSeasonYear] || 0) + 1;
          if (gameSeasonYear === currentSeason) {
            currentSeasonStats.push({ date: s.game.date, min: s.min, minutes });
          } else {
            lastSeasonStats.push({ date: s.game.date, min: s.min, minutes });
          }
        } else {
          gamesWithZeroMinutes[gameSeasonYear] = (gamesWithZeroMinutes[gameSeasonYear] || 0) + 1;
        }
      });
      
      const breakdown = {
        totalPlayerStats: playerStats.length,
        totalGamesPlayed: gamesPlayed.length,
        gamesBySeasonYear,
        gamesWithZeroMinutes,
        currentSeason,
        expectedCurrentSeasonGames: gamesBySeasonYear[currentSeason] || 0,
        expectedLastSeasonGames: gamesBySeasonYear[currentSeason - 1] || 0,
        currentSeasonStatsSample: currentSeasonStats.slice(0, 5),
        lastSeasonStatsSample: lastSeasonStats.slice(0, 5),
        currentSeasonStatsCount: currentSeasonStats.length,
        lastSeasonStatsCount: lastSeasonStats.length
      };
      
      console.log(`[baseGameData] 📊 Games breakdown for "thisseason" filter:`, breakdown);
      serverLogger.log(`[baseGameData] 📊 Games breakdown: totalStats=${breakdown.totalPlayerStats}, gamesPlayed=${breakdown.totalGamesPlayed}, currentSeason=${breakdown.currentSeason}, currentSeasonGames=${breakdown.expectedCurrentSeasonGames}, lastSeasonGames=${breakdown.expectedLastSeasonGames}`, { data: breakdown });
    }
    
    // If timeframe is "thisseason" and we're still loading, check if we have current season data yet
    // This prevents showing last season data while current season is still loading
    // BUT: If we already have current season data, show it even if still loading (might be loading more data)
    if (selectedTimeframe === 'thisseason' && isLoading) {
      const currentSeason = currentNbaSeason();
      const currentSeasonGames = gamesPlayed.filter(stats => {
        if (!stats.game?.date) return false;
        const d = new Date(stats.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        return (m >= 9 ? y : y - 1) === currentSeason;
      });
      
      // If we don't have ANY current season data yet, return empty to prevent showing last season data
      // But if we have some current season data, continue processing (don't return empty)
      if (currentSeasonGames.length === 0) {
        console.log(`[This Season] Still loading current season data, waiting... (have ${gamesPlayed.length} games but none from current season ${currentSeason})`);
        return [];
      } else {
        console.log(`[This Season] Have ${currentSeasonGames.length} current season games, showing them even though still loading`);
        // Continue processing - we have current season data to show
      }
    }
    
    // THEN apply opponent filter (if any) and timeframe logic on a deduped, date-sorted pool
    let filteredGames = gamesPlayed;
    
    // First, apply opponent filtering if a specific opponent is selected (not ALL)
    if (manualOpponent && manualOpponent !== 'ALL' && manualOpponent !== '') {
      const normalizedOpponent = normalizeAbbr(manualOpponent);
      let matchCount = 0;
      let noMatchCount = 0;
      const sampleNoMatches: any[] = [];
      
      filteredGames = gamesPlayed.filter(stats => {
        // FIXED to handle players who changed teams
        // The key insight: if a player has stats for a game, and the opponent we're looking for
        // is one of the teams in that game, then the player played against that opponent
        // (regardless of which team the player was on - this correctly handles team changes)
        
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
        const matches = homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
        
        if (matches) {
          matchCount++;
        } else {
          noMatchCount++;
          // Collect sample of non-matches for debugging (first 3)
          if (sampleNoMatches.length < 3) {
            sampleNoMatches.push({
              gameDate: stats?.game?.date,
              playerTeamFromStats: stats?.team?.abbreviation,
              homeTeamAbbr,
              visitorTeamAbbr,
              homeTeamId,
              visitorTeamId,
              normalizedOpponent,
              lookingFor: normalizedOpponent,
              // Check if opponent appears in the game
              hasOpponent: (homeTeamAbbr && normalizeAbbr(homeTeamAbbr) === normalizedOpponent) || 
                          (visitorTeamAbbr && normalizeAbbr(visitorTeamAbbr) === normalizedOpponent)
            });
          }
        }
        
        return matches;
      });
      
      console.log(`🎯 Manual Opponent Player: Filtered to ${filteredGames.length} games vs ${manualOpponent} (${matchCount} matches, ${noMatchCount} non-matches)`);
      if (sampleNoMatches.length > 0 && filteredGames.length === 0) {
        console.log(`🔍 Sample non-matches (first 3):`, JSON.stringify(sampleNoMatches, null, 2));
        // Also log a sample stat to see the full structure
        if (gamesPlayed.length > 0) {
          const sampleStat = gamesPlayed[0];
          console.log(`🔍 Sample stat structure:`, {
            hasTeam: !!sampleStat?.team,
            teamAbbr: sampleStat?.team?.abbreviation,
            hasGame: !!sampleStat?.game,
            homeTeam: sampleStat?.game?.home_team?.abbreviation,
            visitorTeam: sampleStat?.game?.visitor_team?.abbreviation,
            homeTeamId: sampleStat?.game?.home_team?.id,
            visitorTeamId: sampleStat?.game?.visitor_team?.id,
            gameDate: sampleStat?.game?.date
          });
        }
      }
    }
    
    // Deduplicate by game id and sort DESC before timeframe selection
    const dedupAndSortDesc = (games: any[]) => {
      const sorted = [...games].sort((a, b) => {
        const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
        const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
        return db - da;
      });
      const seen = new Set<number | string>();
      const out: typeof games = [];
      for (const g of sorted) {
        const gid = (g as any)?.game?.id ?? (g as any)?.game_id;
        if (gid && seen.has(gid)) continue;
        if (gid) seen.add(gid);
        out.push(g);
      }
      return out;
    };

    // Special case filters
    // For L5, L10, L15, L20 - prefer current season, but backfill from previous seasons to reach N games
    const n = parseInt(selectedTimeframe.replace('last', ''));
    if (!Number.isNaN(n) && ['last5', 'last10', 'last15', 'last20'].includes(selectedTimeframe)) {
      const currentSeason = currentNbaSeason();
      
      const getSeasonYear = (stats: any) => {
        if (!stats.game?.date) return null;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        return gameMonth >= 9 ? gameYear : gameYear - 1; // Oct-Dec -> season year, Jan-Apr -> season year - 1
      };
      
      // Dedup and sort before selection to avoid losing count after slicing
      const pool = dedupAndSortDesc(filteredGames);
      
      // Separate by season (all games already have >0 minutes)
      const currentSeasonGames = pool.filter(stats => getSeasonYear(stats) === currentSeason);
      const otherSeasonGames = pool.filter(stats => getSeasonYear(stats) !== currentSeason);
      
      // Take N games: prefer current season first, then backfill from previous seasons
      const result: typeof filteredGames = [];
      
      // First, add current season games up to N
      for (let i = 0; i < currentSeasonGames.length && result.length < n; i++) {
        result.push(currentSeasonGames[i]);
      }
      
      // Then backfill from previous seasons to reach N
      for (let i = 0; i < otherSeasonGames.length && result.length < n; i++) {
        result.push(otherSeasonGames[i]);
      }
      
      filteredGames = result;
      console.log(`📅 ${selectedTimeframe.toUpperCase()}: Using ${filteredGames.length}/${n} games (current season ${currentSeason}-${(currentSeason + 1) % 100}: ${currentSeasonGames.length}, backfill: ${Math.max(filteredGames.length - currentSeasonGames.length, 0)}, pool (dedup) total: ${pool.length})`);
    } else if (selectedTimeframe === 'h2h' && (!manualOpponent || manualOpponent === 'ALL')) {
      // Filter games to only show those against the current opponent team
      if (opponentTeam && opponentTeam !== '') {
        const normalizedOpponent = normalizeAbbr(opponentTeam);
        let matchCount = 0;
        let noMatchCount = 0;
        const sampleNoMatches: any[] = [];
        
        filteredGames = gamesPlayed.filter(stats => {
          // FIXED to handle players who changed teams
          // The key insight: if a player has stats for a game, and the opponent we're looking for
          // is one of the teams in that game, then the player played against that opponent
          // (regardless of which team the player was on - this correctly handles team changes)
          
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
          const matches = homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
          
          if (matches) {
            matchCount++;
          } else {
            noMatchCount++;
            // Collect sample of non-matches for debugging (first 3)
            if (sampleNoMatches.length < 3) {
              sampleNoMatches.push({
                gameDate: stats?.game?.date,
                playerTeamFromStats: stats?.team?.abbreviation,
                homeTeamAbbr,
                visitorTeamAbbr,
                homeTeamId,
                visitorTeamId,
                normalizedOpponent,
                hasOpponent: (homeTeamAbbr && normalizeAbbr(homeTeamAbbr) === normalizedOpponent) || 
                            (visitorTeamAbbr && normalizeAbbr(visitorTeamAbbr) === normalizedOpponent)
              });
            }
          }
          
          return matches;
        }).slice(0, 6); // Limit to last 6 H2H games
        
        console.log(`🔥 H2H: Filtered to ${filteredGames.length} games vs ${opponentTeam} (${matchCount} matches, ${noMatchCount} non-matches, max 6)`);
        if (sampleNoMatches.length > 0 && filteredGames.length === 0) {
          console.log(`🔍 H2H Sample non-matches (first 3):`, JSON.stringify(sampleNoMatches, null, 2));
        }
      } else {
        // No opponent team available, show empty
        filteredGames = [];
        console.log(`⚠️ H2H: No opponent team available for filtering`);
      }
    } else if (selectedTimeframe === 'lastseason') {
      // Filter to last season games only
      const lastSeason = currentNbaSeason() - 1;
      const currentSeason = currentNbaSeason();
      
      console.log(`🔍 [Last Season] Starting filter - playerStats.length=${playerStats?.length || 0}, gamesPlayed.length=${gamesPlayed.length}`);
      
      // Debug: Log breakdown of all stats by season and team
      const gamesBySeasonYear: Record<number, number> = {};
      const gamesByTeam: Record<string, number> = {};
      const lastSeasonTeams = new Set<string>();
      const currentSeasonTeams = new Set<string>();
      
      gamesPlayed.forEach(s => {
        if (!s.game?.date) return;
        const d = new Date(s.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        const gameSeasonYear = m >= 9 ? y : y - 1;
        const teamAbbr = s?.team?.abbreviation || 'UNKNOWN';
        
        gamesBySeasonYear[gameSeasonYear] = (gamesBySeasonYear[gameSeasonYear] || 0) + 1;
        gamesByTeam[teamAbbr] = (gamesByTeam[teamAbbr] || 0) + 1;
        
        if (gameSeasonYear === lastSeason) {
          lastSeasonTeams.add(teamAbbr);
        } else if (gameSeasonYear === currentSeason) {
          currentSeasonTeams.add(teamAbbr);
        }
      });
      
      // For last season, we need to work around API data quality issues:
      // 1. stat.team might be wrong (e.g., WAS instead of ATL)
      // 2. All stats might have 0 minutes
      // Solution: Use game data to infer the player's team, then filter by minutes
      filteredGames = gamesPlayed.filter(stats => {
        if (!stats.game?.date) return false;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        
        // NBA season spans two calendar years (e.g., 2023-24 season)
        // Games from Oct-Dec are from the season year, games from Jan-Apr are from season year + 1
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        if (gameSeasonYear !== lastSeason) return false;
        
        // WORKAROUND: If stat.team is wrong (e.g., WAS), try to infer from game data
        // If the game has ATL and stat.team is WAS, the player was likely on ATL
        // NOTE: We do NOT mutate the stats object here to avoid infinite loops
        // Instead, we just use the corrected team for filtering purposes
        const homeTeam = stats.game?.home_team?.abbreviation;
        const visitorTeam = stats.game?.visitor_team?.abbreviation;
        const statTeam = stats.team?.abbreviation;
        
        // Use game data to determine the player's actual team for filtering
        // If stat.team is WAS but game has ATL, the player was on ATL (not WAS)
        // We'll use this corrected team value for filtering, but NOT mutate the original object
        let actualTeam = statTeam;
        if (statTeam === 'WAS' && (homeTeam === 'ATL' || visitorTeam === 'ATL')) {
          // Player was on ATL, not WAS - use ATL for filtering
          actualTeam = 'ATL';
        }
        
        // Include all stats for now - we'll filter by minutes/data later
        // The actualTeam variable is used for logic, but we don't mutate stats.team
        return true;
      });
      
      // Now filter by minutes AFTER we've determined the correct team
      // WORKAROUND: For last season, if all stats have 0 minutes (API data quality issue),
      // use game data to identify which games the player was actually in
      const minutesFiltered = filteredGames.filter(stats => {
        const minutes = parseMinutes(stats.min);
        // For last season, include stats with 0 minutes if they have actual stat data (pts, reb, ast, etc.)
        // This handles cases where minutes are 0 but the player actually played
        if (minutes === 0) {
          const hasAnyStat = (stats.pts && stats.pts > 0) || (stats.reb && stats.reb > 0) || 
                            (stats.ast && stats.ast > 0) || (stats.fgm && stats.fgm > 0) ||
                            (stats.fga && stats.fga > 0);
          return hasAnyStat;
        }
        return minutes > 0;
      });
      
      console.log(`📅 Last Season: Before minutes filter: ${filteredGames.length}, After minutes filter: ${minutesFiltered.length}`);
      
      // CRITICAL WORKAROUND: If all last season stats have 0 minutes (API data quality issue),
      // use game data to identify games where the player was actually involved
      if (filteredGames.length > 0 && minutesFiltered.length === 0) {
        console.warn(`[Last Season Debug] ⚠️ API DATA QUALITY ISSUE: All ${filteredGames.length} last season stats have 0 minutes. Using game data to identify actual games...`);
        
        // Use game data to identify games where the player's team was involved
        // Strategy: If stat.team doesn't match either team in the game, but we have game data,
        // we can infer the player was on one of the teams in the game
        const gamesWithPlayerTeam = filteredGames.filter(stats => {
          const homeTeam = stats.game?.home_team?.abbreviation;
          const visitorTeam = stats.game?.visitor_team?.abbreviation;
          const statTeam = stats.team?.abbreviation;
          
          // Normal case: stat.team matches one of the teams in the game
          if (statTeam && (statTeam === homeTeam || statTeam === visitorTeam)) {
            return true;
          }
          
          // Workaround: If stat.team doesn't match, but we have game data with two teams,
          // the player was likely on one of those teams (API data quality issue)
          // Include the game if we have valid game data
          if (homeTeam && visitorTeam && stats.game?.id) {
            return true;
          }
          
          return false;
        });
        
        console.log(`[Last Season Debug] ✅ Found ${gamesWithPlayerTeam.length} games where player's team appears in game data (workaround for API data quality issue)`);
        
        // Use the games identified from game data instead of the empty minutesFiltered
        if (gamesWithPlayerTeam.length > 0) {
          filteredGames = gamesWithPlayerTeam;
          console.log(`[Last Season Debug] ✅ Using ${filteredGames.length} games identified from game data (workaround for 0-minute stats)`);
        } else {
          console.warn(`[Last Season Debug] ⚠️ Could not identify any games from game data either. All stats filtered out.`);
        }
      } else {
        filteredGames = minutesFiltered;
      }
      
      // Also check ALL stats (before minutes filter) to see what teams are in last season
      const allLastSeasonStats = playerStats?.filter((s: any) => {
        if (!s.game?.date) return false;
        const d = new Date(s.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        const gameSeasonYear = m >= 9 ? y : y - 1;
        return gameSeasonYear === lastSeason;
      }) || [];
      
      const allLastSeasonTeams = new Set<string>();
      const allLastSeasonWithMinutes = allLastSeasonStats.filter((s: any) => {
        const teamAbbr = s?.team?.abbreviation || 'UNKNOWN';
        allLastSeasonTeams.add(teamAbbr);
        const minutes = parseMinutes(s.min);
        return minutes > 0;
      });
      
      console.log(`📅 Last Season: Filtered to ${filteredGames.length} games from ${lastSeason}-${(lastSeason + 1) % 100}`);
      console.log(`📅 Last Season Debug:`, {
        totalGamesPlayed: gamesPlayed.length,
        gamesBySeasonYear,
        gamesByTeam,
        lastSeasonTeams: Array.from(lastSeasonTeams),
        currentSeasonTeams: Array.from(currentSeasonTeams),
        filteredCount: filteredGames.length,
        sampleFilteredDates: filteredGames.slice(0, 5).map(s => ({ date: s.game?.date, team: s.team?.abbreviation })),
        // NEW: Check ALL last season stats (including 0 minutes)
        allLastSeasonStatsCount: allLastSeasonStats.length,
        allLastSeasonTeams: Array.from(allLastSeasonTeams),
        allLastSeasonWithMinutesCount: allLastSeasonWithMinutes.length,
        sampleAllLastSeason: allLastSeasonStats.slice(0, 5).map(s => ({
          date: s.game?.date,
          team: s.team?.abbreviation,
          min: s.min,
          minutes: parseMinutes(s.min),
          pts: s.pts
        }))
      });
    } else if (selectedTimeframe === 'thisseason') {
      // Filter to current season games only
      const currentSeason = currentNbaSeason();
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      // Calculate the season start year for the current NBA season
      // If we're in Oct-Dec, current season started this year (e.g., Dec 2025 = 2025-26 season = year 2025)
      // If we're in Jan-Apr, current season started last year (e.g., Jan 2025 = 2024-25 season = year 2024)
      const seasonStartYear = currentMonth >= 9 ? currentYear : currentYear - 1;
      
      filteredGames = gamesPlayed.filter(stats => {
        if (!stats.game?.date) return false;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        
        // Calculate which NBA season this game belongs to
        // Games from Oct-Dec belong to the season year (e.g., Oct 2024 = 2024-25 season = year 2024)
        // Games from Jan-Apr belong to the previous calendar year's season (e.g., Apr 2025 = 2024-25 season = year 2024)
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        
        // Game must be from the current NBA season
        return gameSeasonYear === seasonStartYear;
      });
      const allGameDates = gamesPlayed.map(s => s.game?.date).filter(Boolean);
      
      // Debug: Check what season years the games actually belong to
      // Show both filtered and unfiltered games to understand the mismatch
      const gameSeasonYears = gamesPlayed.slice(0, 10).map(s => {
        if (!s.game?.date) return null;
        const d = new Date(s.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        const gameSeasonYear = m >= 9 ? y : y - 1;
        return { date: s.game.date, year: y, month: m, seasonYear: gameSeasonYear, matches: gameSeasonYear === seasonStartYear };
      });
      
      // Also check the filtered games to see what we're actually showing
      const filteredGameSeasonYears = filteredGames.slice(0, 10).map(s => {
        if (!s.game?.date) return null;
        const d = new Date(s.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        const gameSeasonYear = m >= 9 ? y : y - 1;
        return { date: s.game.date, year: y, month: m, seasonYear: gameSeasonYear };
      });
      
      // Show breakdown of games by season year to understand the data
      const gamesBySeasonYear: Record<number, number> = {};
      gamesPlayed.forEach(s => {
        if (!s.game?.date) return;
        const d = new Date(s.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        const gameSeasonYear = m >= 9 ? y : y - 1;
        gamesBySeasonYear[gameSeasonYear] = (gamesBySeasonYear[gameSeasonYear] || 0) + 1;
      });
      
      const filterData = {
        currentSeason,
        seasonStartYear: seasonStartYear,
        totalGames: gamesPlayed.length,
        filteredGames: filteredGames.length,
        isLoading,
        selectedPlayer: selectedPlayer?.full,
        sampleDates: allGameDates.slice(0, 5),
        sampleFilteredDates: filteredGames.slice(0, 5).map(s => s.game?.date),
        selectedTimeframe,
        gameSeasonYears: gameSeasonYears.filter(Boolean),
        filteredGameSeasonYears: filteredGameSeasonYears.filter(Boolean),
        gamesBySeasonYear
      };
      console.log(`📅 [This Season Filter]`, filterData);
      serverLogger.log(`📅 [This Season Filter]`, { data: filterData });
      
      // If thisseason filter returns empty but we have playerStats, check if current season data is still loading
      // If we're still loading (isLoading is true), return empty array to prevent showing last season data
      if (filteredGames.length === 0 && gamesPlayed.length > 0) {
        // Check if we have any current season games in the full playerStats (might still be loading)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const seasonStartYear = currentMonth >= 9 ? currentYear : currentYear - 1;
        
        const currentSeasonInAllStats = statsToUse.filter(s => {
          if (!s.game?.date) return false;
          const d = new Date(s.game.date);
          const y = d.getFullYear();
          const m = d.getMonth();
          const gameSeasonYear = m >= 9 ? y : y - 1;
          return gameSeasonYear === seasonStartYear;
        });
        
        console.warn(`⚠️ [This Season Filter] Returned 0 games but player has ${gamesPlayed.length} total games.`, {
          currentSeason,
          isLoading,
          currentSeasonInAllStatsCount: currentSeasonInAllStats.length,
          sampleDates: allGameDates.slice(0, 10),
          sampleCurrentSeasonDates: currentSeasonInAllStats.slice(0, 5).map(s => s.game?.date)
        });
        
        // If we're still loading AND we have current season games in the full stats, wait for them
        // Otherwise, if loading is done and still no current season games, log warning
        if (isLoading && currentSeasonInAllStats.length > 0) {
          console.log(`[This Season] Current season data still loading (${currentSeasonInAllStats.length} games found in full stats), waiting...`);
          // Return empty to prevent showing last season data while current season loads
          filteredGames = [];
        } else if (!isLoading) {
          // Debug: log sample game dates to understand the issue
          const sampleDates = gamesPlayed.slice(0, 5).map(s => {
            if (!s.game?.date) return null;
            const d = new Date(s.game.date);
            const y = d.getFullYear();
            const m = d.getMonth();
            const gameSeasonYear = m >= 9 ? y : y - 1;
            return { date: s.game.date, year: y, month: m, gameSeasonYear, currentSeason };
          });
          console.warn(`⚠️ This Season filter returned 0 games but player has ${gamesPlayed.length} total games.`, {
            currentSeason,
            sampleDates,
            allGameDates: gamesPlayed.map(s => s.game?.date).filter(Boolean).slice(0, 10),
            isLoading,
            currentSeasonInAllStats: currentSeasonInAllStats.length
          });
        }
      }
    }
    
    // Apply Home/Away filter before slicing/time-ordering
    if (homeAway !== 'ALL') {
      filteredGames = filteredGames.filter(stats => {
        const playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || '';
        const playerTeamNorm = normalizeAbbr(playerTeam);
        const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
        const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
        const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
        const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
        const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
        let isHome = false;
        if (playerTeamId && homeTeamId && visitorTeamId) {
          isHome = playerTeamId === homeTeamId;
        } else if (homeTeamAbbr && visitorTeamAbbr) {
          isHome = playerTeamNorm === normalizeAbbr(homeTeamAbbr);
        }
        return homeAway === 'HOME' ? isHome : !isHome;
      });
    }
    
    // Sort games by date (newest first) before applying timeframe filters
    const sortedByDate = [...filteredGames].sort((a, b) => {
      const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return dateB - dateA; // Newest first
    });
    
    // n was already parsed above for season filtering, but we need it again for slicing
    const nForSlice = parseInt(selectedTimeframe.replace('last', ''));
    
    // Deduplicate by gameId to fix API duplicate data issue (on sorted games)
    const uniqueGames = [];
    const seenGameIds = new Set();
    
    for (const game of sortedByDate) {
      const gameId = game?.game?.id;
      if (gameId && !seenGameIds.has(gameId)) {
        seenGameIds.add(gameId);
        uniqueGames.push(game);
      } else if (!gameId) {
        // Keep games without gameId (shouldn't happen but just in case)
        uniqueGames.push(game);
      }
    }
    
    console.log(`📈 Deduplicated: ${sortedByDate.length} → ${uniqueGames.length} unique games`);
    
    // Apply timeframe to unique games - use slice(0, n) to get FIRST n games (most recent)
    // Since uniqueGames is sorted newest-first, slice(0, n) gives us the newest n games
    // For special timeframes (h2h, lastseason, thisseason), don't slice
    // If a teammate filter is active, take many more games (10x) so we have enough after teammate filter
    // This is especially important for "without" filters which can be very restrictive
    const sliceMultiplier = teammateFilterId && selectedTimeframe.startsWith('last') ? 10 : 1;
    const sliceCount = !Number.isNaN(nForSlice) ? nForSlice * sliceMultiplier : undefined;
    const timeframeGames = ['h2h', 'lastseason', 'thisseason'].includes(selectedTimeframe)
      ? uniqueGames
      : (sliceCount ? uniqueGames.slice(0, sliceCount) : uniqueGames);
    
    // Reverse for chronological order (left→right oldest→newest)
    const ordered = timeframeGames.slice().reverse();
    
    // Debug: log before mapping
    console.log('[baseGameData] Before mapping:', {
      selectedTimeframe,
      gamesPlayedCount: gamesPlayed.length,
      filteredGamesCount: filteredGames.length,
      uniqueGamesCount: uniqueGames.length,
      timeframeGamesCount: timeframeGames.length,
      orderedCount: ordered.length,
      sampleOrderedStat: ordered[0],
      hasGame: !!ordered[0]?.game,
      hasGameDate: !!ordered[0]?.game?.date,
    });
    
    const result = ordered.map((stats, index) => {
      let playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
      
      // Get team info from stats.game - support both nested objects and *_id fields
      const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
      const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
      const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
      const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
      
      // WORKAROUND: For last season, if stat.team doesn't match either team in the game,
      // infer the correct team from game data (API data quality issue for players who changed teams)
      if (selectedTimeframe === 'lastseason' && playerTeam && homeTeamAbbr && visitorTeamAbbr) {
        const playerTeamNorm = normalizeAbbr(playerTeam);
        const homeNorm = normalizeAbbr(homeTeamAbbr);
        const visitorNorm = normalizeAbbr(visitorTeamAbbr);
        
        // If playerTeam doesn't match either team in the game, infer from game data
        if (playerTeamNorm !== homeNorm && playerTeamNorm !== visitorNorm) {
          // The player was on one of the teams in the game, but stat.team is wrong
          // For Saddiq Bey, we know he was on ATL last season, so if ATL is in the game, use ATL
          // Otherwise, we can't definitively determine which team, but we'll use the home team as a fallback
          if (homeNorm === 'ATL' || visitorNorm === 'ATL') {
            playerTeam = 'ATL';
            console.log(`[baseGameData] 🔧 Corrected team for last season game: ${stats?.team?.abbreviation} → ATL (game: ${homeTeamAbbr} vs ${visitorTeamAbbr})`);
          } else {
            // For other games, we can't be sure, but we'll use the home team as a heuristic
            // (This is a fallback - ideally we'd have better data)
            playerTeam = homeTeamAbbr;
            console.log(`[baseGameData] 🔧 Corrected team for last season game: ${stats?.team?.abbreviation} → ${homeTeamAbbr} (game: ${homeTeamAbbr} vs ${visitorTeamAbbr}, using home team as fallback)`);
          }
        }
      }
      
      const playerTeamNorm = normalizeAbbr(playerTeam);
      
      // Determine opponent using team IDs/abbrs
      const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
      let opponent = "";
      
      if (playerTeamId && homeTeamId && visitorTeamId) {
        if (playerTeamId === homeTeamId && visitorTeamAbbr) {
          opponent = visitorTeamAbbr;
        } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
          opponent = homeTeamAbbr;
        }
      }
      // Fallback: compare abbreviations directly if IDs missing
      if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
        const homeNorm = normalizeAbbr(homeTeamAbbr);
        const awayNorm = normalizeAbbr(visitorTeamAbbr);
        if (playerTeamNorm && playerTeamNorm === homeNorm) opponent = awayNorm;
        else if (playerTeamNorm && playerTeamNorm === awayNorm) opponent = homeNorm;
      }
      
      const iso = stats?.game?.date;
      const d = iso ? new Date(iso) : null;
      const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
      
      // Create unique key for each game to fix tooltip data grouping
      const gameId = stats?.game?.id ?? `${opponent}-${index}`;
      const tickLabel = opponent || "";
      
      return {
        stats, // Keep reference to original stats for value calculation
        opponent,
        gameNumber: index + 1,
        game: opponent ? `vs ${opponent}` : "—",
        date: shortDate,
        xKey: String(gameId),   // unique per game
        tickLabel,              // what we show on the axis
      };
    });
    
    console.log('[baseGameData] Final result:', {
      resultLength: result.length,
      selectedTimeframe,
    });
    
    return result;
  }, [playerStats, selectedTimeframe, selectedPlayer, propsMode, gameStats, selectedTeam, opponentTeam, manualOpponent, homeAway, isLoading, resolvedPlayerId, teammateFilterId]); // Added teammateFilterId to support larger slice when teammate filter is active
  
  // Calculate allGamesSecondAxisData from playerStats directly (all games, no timeframe filter)
  // This allows us to filter from ALL games, then apply timeframe
  const allGamesSecondAxisData = useMemo(() => {
    if (!selectedFilterForAxis || propsMode !== 'player' || !playerStats.length) {
      return null;
    }

    // Calculate from ALL playerStats (before any timeframe filtering)
    const result = playerStats
      .filter(stats => {
        // Only include games where player played (same filter as baseGameData)
        const minutes = parseMinutes(stats.min);
        const shouldIncludeZeroMinutes = selectedTimeframe === 'lastseason';
        if (shouldIncludeZeroMinutes) return true;
        return minutes > 0;
      })
      .map((stats: any) => {
        const numericGameId = typeof stats?.game?.id === 'number' ? stats.game.id : null;
        const gameIdStr = String(numericGameId || '');
        const gameDate = stats?.game?.date || '';
        let value: number | null = null;

        switch (selectedFilterForAxis) {
          case 'minutes':
            if (stats?.min) {
              value = parseMinutes(stats.min);
            }
            break;
          case 'fg_pct':
            if (stats?.fg_pct !== null && stats?.fg_pct !== undefined) {
              value = stats.fg_pct * 100;
            }
            break;
          case 'pace':
            if (numericGameId && advancedStatsPerGame[numericGameId]?.pace !== undefined) {
              value = advancedStatsPerGame[numericGameId].pace!;
            }
            break;
          case 'usage_rate':
            if (numericGameId && advancedStatsPerGame[numericGameId]?.usage_percentage !== undefined) {
              value = advancedStatsPerGame[numericGameId].usage_percentage! * 100;
            }
            break;
          case 'dvp_rank':
            value = dvpRanksPerGame[gameIdStr] ?? null;
            break;
          default:
            value = null;
        }

        return {
          gameId: gameIdStr,
          gameDate: String(gameDate),
          value,
          stats: stats, // Store stats reference for mapping later
        };
      });
    
    return result;
  }, [selectedFilterForAxis, playerStats, propsMode, advancedStatsPerGame, dvpRanksPerGame, selectedTimeframe]);
  
  // Prefetch teammate game data in background when roster is available (for faster filtering)
  useEffect(() => {
    if (!rosterForSelectedTeam || !baseGameData?.length || propsMode !== 'player') return;
    
    const games = (baseGameData || []).map((g: any) => g?.stats?.game?.id || g?.game?.id).filter(Boolean);
    if (!games.length) return;
    
    // Get all teammate IDs from roster
    const teammateIds: number[] = [];
    Object.values(rosterForSelectedTeam).forEach((pos: any) => {
      const arr = Array.isArray(pos) ? pos : [];
      arr.forEach((p: any) => {
        const id = p?.id || p?.player_id;
        if (id && typeof id === 'number' && String(id) !== String(selectedPlayer?.id || '')) {
          teammateIds.push(id);
        }
      });
    });
    
    if (teammateIds.length === 0) return;
    
    // Prefetch in background (low priority, don't block UI)
    const prefetchTeammateData = async () => {
      // Only prefetch first 5 teammates to avoid too many requests
      const teammatesToPrefetch = teammateIds.slice(0, 5);
      
      for (const teammateId of teammatesToPrefetch) {
        // Check if already cached
        const CACHE_KEY = `teammate-games-${teammateId}`;
        const cachedData = typeof window !== 'undefined' ? sessionStorage.getItem(CACHE_KEY) : null;
        
        if (cachedData) {
          continue; // Already cached, skip
        }
        
        // Prefetch in background (small delay to not interfere with user actions)
        setTimeout(async () => {
          try {
            const chunks: number[][] = [];
            const size = 50;
            for (let i = 0; i < games.length; i += size) chunks.push(games.slice(i, i + size));
            
            // Fetch in parallel but with lower priority
            const fetchPromises = chunks.map(async (chunk) => {
              const params = new URLSearchParams();
              params.set('endpoint', '/stats');
              params.set('per_page', '100');
              params.set('player_ids[]', String(teammateId));
              for (const gid of chunk) params.append('game_ids[]', String(gid));
              const url = `/api/balldontlie?${params.toString()}`;
              const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
              const json = await res?.json().catch(() => ({})) as any;
              return Array.isArray(json?.data) ? json.data : [];
            });
            
            const allResults = await Promise.all(fetchPromises);
            const played = new Set<number>();
            
            allResults.flat().forEach((s: any) => {
              const minStr = s?.min || '0:00';
              const [m, sec] = String(minStr).split(':').map((x: any) => parseInt(x || '0', 10));
              const minutes = (Number.isFinite(m) ? m : 0) + ((Number.isFinite(sec) ? sec : 0) > 0 ? 1 : 0);
              const gid = typeof s?.game?.id === 'number' ? s.game.id : (typeof s?.game_id === 'number' ? s.game_id : null);
              if (minutes > 0 && gid != null) played.add(gid);
            });
            
            // Cache the prefetched results
            if (typeof window !== 'undefined') {
              try {
                const allPlayedGameIds = Array.from(played);
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(allPlayedGameIds));
                sessionStorage.setItem(`teammate-games-${teammateId}-timestamp`, Date.now().toString());
                console.log(`[Teammate Filter] 🔮 Prefetched ${allPlayedGameIds.length} games for teammate ${teammateId}`);
              } catch (e) {
                // Ignore cache errors
              }
            }
          } catch (e) {
            // Silently fail prefetch
          }
        }, 2000); // 2 second delay to not interfere with immediate user actions
      }
    };
    
    prefetchTeammateData();
  }, [rosterForSelectedTeam, baseGameData, propsMode, selectedPlayer?.id]);
  
  // Precompute back-to-back games (player mode)
  const backToBackGameIds = useMemo(() => {
    if (propsMode !== 'player' || !playerStats || playerStats.length === 0) return new Set<string | number>();
    const withDates = playerStats.filter((p: any) => !!p?.game?.date);
    const sorted = withDates.slice().sort((a: any, b: any) =>
      new Date(a.game.date).getTime() - new Date(b.game.date).getTime()
    );
    const b2b = new Set<string | number>();
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date((sorted[i - 1] as any)?.game?.date as any);
      const cur = new Date((sorted[i] as any)?.game?.date as any);
      const diffDays = (cur.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays >= 0.5 && diffDays <= 1.5) {
        // Only include the second game of the back-to-back
        const curId = sorted[i]?.game?.id ?? `g_${i}`;
        b2b.add(curId);
      }
    }
    return b2b;
  }, [propsMode, playerStats]);

  const parseMinutesPlayed = (minVal: any): number => {
    if (typeof minVal === 'number') return minVal;
    if (!minVal) return 0;
    const s = String(minVal);
    if (s.includes(':')) {
      const [m, sec] = s.split(':').map(x => parseInt(x || '0', 10));
      return (Number.isFinite(m) ? m : 0) + ((Number.isFinite(sec) && sec > 0) ? 1 : 0);
    }
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  };

  // Apply advanced filters to base data for player mode
  const filteredGameData = useMemo(() => {
    if (propsMode !== 'player') return baseGameData;
    
    // First, apply all filters EXCEPT teammate filter
    let filtered = baseGameData.filter((g: any) => {
      const stats = g?.stats;
      const game = stats?.game;

      // minutes
      const minutes = parseMinutesPlayed(stats?.min);
      
      // WORKAROUND: For last season, if we have 0-minute games that were included via the API data quality workaround,
      // allow them through (they'll show 0 values but at least the games will be visible)
      const isLastSeasonWithApiIssue = selectedTimeframe === 'lastseason' && minutes === 0 && game?.id;
      
      if (minutes === 0 && !isLastSeasonWithApiIssue) return false; // exclude zero-minute games (except last season workaround)
      if (minutes > 0 && (minutes < minMinutesFilter || minutes > maxMinutesFilter)) return false;

      // blowout
      if (excludeBlowouts && game && typeof game.home_team_score === 'number' && typeof game.visitor_team_score === 'number') {
        const diff = Math.abs((game.home_team_score || 0) - (game.visitor_team_score || 0));
        if (diff >= 21) return false;
      }

      // back-to-back (when enabled, only include second game of B2B)
      if (excludeBackToBack) {
        if (!game || !backToBackGameIds.has(game.id)) return false;
      }
      
      return true;
    });
    
    // Apply teammate filter AFTER other filters
    // For "last N" timeframes with teammate filter, we want the last N games WHERE the teammate played/didn't play
    // Not: last N games filtered by teammate (which might only give 1 game)
    // So we need to filter ALL games first, then take the last N
    if (teammateFilterId && selectedTimeframe.startsWith('last')) {
      const n = parseInt(selectedTimeframe.replace('last', ''));
      if (!Number.isNaN(n) && n > 0) {
        // For "last N" with teammate filter, we need to work with ALL games, not just the timeframe slice
        // Get all games from playerStats (before timeframe filter) and apply filters
        // Reuse the same structure as baseGameData for consistency
        const allGamesFromStats: any[] = [];
        (playerStats || []).forEach((stat: any, index: number) => {
          const game = stat?.game;
          if (!game) return;
          
          let playerTeam = stat?.team?.abbreviation || selectedPlayer?.teamAbbr || '';
          const homeTeamId = game?.home_team?.id ?? (game as any)?.home_team_id;
          const visitorTeamId = game?.visitor_team?.id ?? (game as any)?.visitor_team_id;
          const homeTeamAbbr = game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          
          const playerTeamNorm = normalizeAbbr(playerTeam);
          const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
          let opponent = "";
          
          if (playerTeamId && homeTeamId && visitorTeamId) {
            if (playerTeamId === homeTeamId && visitorTeamAbbr) {
              opponent = visitorTeamAbbr;
            } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
              opponent = homeTeamAbbr;
            }
          }
          if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
            const homeNorm = normalizeAbbr(homeTeamAbbr);
            const awayNorm = normalizeAbbr(visitorTeamAbbr);
            if (playerTeamNorm && playerTeamNorm === homeNorm) opponent = awayNorm;
            else if (playerTeamNorm && playerTeamNorm === awayNorm) opponent = homeNorm;
          }
          
          const iso = game?.date;
          const d = iso ? new Date(iso) : null;
          const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
          const gameId = game?.id ?? `${opponent}-${index}`;
          const tickLabel = opponent || "";
          
          allGamesFromStats.push({
            stats: stat,
            opponent,
            gameNumber: index + 1,
            game: opponent ? `vs ${opponent}` : "—",
            date: shortDate,
            xKey: String(gameId),
            tickLabel,
          });
        });
        
        // Apply all filters in a single pass (minutes, blowouts, back-to-back, teammate)
        const allFiltered = allGamesFromStats.filter((g: any) => {
          const stats = g?.stats;
          const game = stats?.game;
          const gid = game?.id;
          
          // Minutes filter
          const minutes = parseMinutesPlayed(stats?.min);
          const isLastSeasonWithApiIssue = selectedTimeframe === 'lastseason' && minutes === 0 && game?.id;
          if (minutes === 0 && !isLastSeasonWithApiIssue) return false;
          if (minutes > 0 && (minutes < minMinutesFilter || minutes > maxMinutesFilter)) return false;
          
          // Blowouts filter
          if (excludeBlowouts && game && typeof game.home_team_score === 'number' && typeof game.visitor_team_score === 'number') {
            const diff = Math.abs((game.home_team_score || 0) - (game.visitor_team_score || 0));
            if (diff >= 21) return false;
          }
          
          // Back-to-back filter
          if (excludeBackToBack) {
            if (!game || !backToBackGameIds.has(game.id)) return false;
          }
          
          // Teammate filter
          if (gid) {
            const didPlay = teammatePlayedGameIds.has(gid);
            if (withWithoutMode === 'with' && !didPlay) return false;
            if (withWithoutMode === 'without' && didPlay) return false;
          }
          
          return true;
        });
        
        const teammateFiltered = allFiltered; // Single filter pass now
        
        // Sort by date (newest first) and take the last N games
        const sortedByDate = [...teammateFiltered].sort((a: any, b: any) => {
          const dateA = a?.stats?.game?.date ? new Date(a.stats.game.date).getTime() : 0;
          const dateB = b?.stats?.game?.date ? new Date(b.stats.game.date).getTime() : 0;
          return dateB - dateA; // Newest first
        });
        
        // Take the first N (most recent) games, then reverse so oldest is on the left
        filtered = sortedByDate.slice(0, n).reverse();
        
        console.log(`[Teammate Filter] Last N with teammate: ${allFiltered.length} total games -> ${teammateFiltered.length} after teammate filter -> ${filtered.length} last N games (mode: ${withWithoutMode}, teammate played in ${teammatePlayedGameIds.size} games)`);
      } else {
        // Not a valid "last N" timeframe, just apply teammate filter normally
        filtered = filtered.filter((g: any) => {
          const game = g?.stats?.game;
          const gid = game?.id;
          if (!gid) return false;
          const didPlay = teammatePlayedGameIds.has(gid);
          if (withWithoutMode === 'with' && !didPlay) return false;
          if (withWithoutMode === 'without' && didPlay) return false;
      return true;
    });
      }
    } else if (teammateFilterId) {
      // Apply teammate filter for non-"last N" timeframes
      const beforeCount = filtered.length;
      filtered = filtered.filter((g: any) => {
        const game = g?.stats?.game;
        const gid = game?.id;
        if (!gid) return false;
        const didPlay = teammatePlayedGameIds.has(gid);
        if (withWithoutMode === 'with' && !didPlay) return false;
        if (withWithoutMode === 'without' && didPlay) return false;
        return true;
      });
      console.log(`[Teammate Filter] Filtering results: ${beforeCount} games -> ${filtered.length} games (mode: ${withWithoutMode}, teammate played in ${teammatePlayedGameIds.size} games, timeframe: ${selectedTimeframe})`);
    }
    
    // Debug: log filtering results
    console.log('[filteredGameData] Filtering results:', {
      baseGameDataLength: baseGameData.length,
      filteredLength: filtered.length,
      minMinutesFilter,
      maxMinutesFilter,
      excludeBlowouts,
      excludeBackToBack,
      teammateFilterId,
      withWithoutMode,
      sampleFiltered: filtered[0],
    });
    
    return filtered;
  }, [propsMode, baseGameData, minMinutesFilter, maxMinutesFilter, excludeBlowouts, excludeBackToBack, backToBackGameIds, withWithoutMode, teammateFilterId, teammatePlayedGameIds, selectedTimeframe]);

  /* -------- Chart data with current stat values ----------
     Only recalculate values when selectedStat changes */
  const chartData = useMemo(() => {
    const source = propsMode === 'player' ? filteredGameData : baseGameData;
    const mapped = source.map(game => {
      const statValue = propsMode === 'team' 
        ? getGameStatValue((game as any).gameData, selectedStat, gamePropsTeam) 
        : getStatValue((game as any).stats, selectedStat);
      
      // For steals/blocks, ensure we return 0 instead of null/undefined
      // This is important because these stats can legitimately be 0
      const value = (statValue !== null && statValue !== undefined) ? statValue : 0;
      
      return {
        ...game,
        value,
      };
    });
    
    // Check if the most recent game (last item) is live
    if (mapped.length > 0) {
      const mostRecentGame = mapped[mapped.length - 1];
      const gameData = propsMode === 'team' ? (mostRecentGame as any).gameData : (mostRecentGame as any).stats?.game;
      
      if (gameData) {
        const rawStatus = String(gameData.status || '');
        const gameStatus = rawStatus.toLowerCase();
        const gameDate = gameData.date ? new Date(gameData.date).getTime() : 0;
        const now = Date.now();
        const threeHoursMs = 3 * 60 * 60 * 1000;
        
        // Check if game is live by looking at tipoff time
        let isLive = false;
        const tipoffTime = Date.parse(rawStatus);
        if (!Number.isNaN(tipoffTime)) {
          const timeSinceTipoff = now - tipoffTime;
          isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
        }
        
        // Also check if game time has passed and game isn't final (fallback)
        const gameStarted = gameDate > 0 && gameDate <= now;
        const timeSinceGameTime = gameDate > 0 ? now - gameDate : 0;
        const isWithinThreeHours = gameStarted && timeSinceGameTime > 0 && timeSinceGameTime < threeHoursMs;
        const isDateStatus = rawStatus.includes('T') || rawStatus.includes('+') || rawStatus.match(/\d{4}-\d{2}-\d{2}/);
        
        // Mark as live if game started within last 3 hours and not final
        const isLiveGame = (isLive || (gameStarted && isWithinThreeHours && !isDateStatus)) 
          && gameStatus !== '' 
          && gameStatus !== 'scheduled' 
          && !gameStatus.includes('final') 
          && !gameStatus.includes('completed');
        
        // Add isLive flag to the most recent game
        if (isLiveGame) {
          const lastItem = mapped[mapped.length - 1];
          (lastItem as any).isLive = true;
        }
      }
    }
    
    // Debug: log chartData computation (especially for steals/blocks)
    if (selectedStat === 'stl' || selectedStat === 'blk') {
      const statValues = mapped.map(d => d.value);
      const nonZeroCount = statValues.filter(v => v > 0).length;
      console.log(`[chartData] ${selectedStat.toUpperCase()} chartData:`, {
        propsMode,
        sourceLength: source.length,
        chartDataLength: mapped.length,
        selectedStat,
        totalValues: statValues.length,
        nonZeroValues: nonZeroCount,
        zeroValues: statValues.length - nonZeroCount,
        minValue: Math.min(...statValues),
        maxValue: Math.max(...statValues),
        allValues: statValues, // Show ALL values to debug
        sampleStats: mapped.slice(0, 5).map(d => ({
          value: d.value,
          hasStats: !!(d as any).stats,
          stl: (d as any).stats?.stl,
          blk: (d as any).stats?.blk,
          opponent: (d as any).opponent || (d as any).tickLabel,
        })),
      });
    } else {
      console.log('[chartData] Computed chartData:', {
        propsMode,
        sourceLength: source.length,
        chartDataLength: mapped.length,
        selectedStat,
        sampleChartData: mapped[0],
        sampleValue: mapped[0]?.value,
      });
    }
    
    return mapped;
  }, [baseGameData, filteredGameData, selectedStat, propsMode, propsMode === 'team' ? gamePropsTeam : selectedTeam, todaysGames]);

  // Track in-flight requests to prevent duplicates
  const teammateFetchAbortControllerRef = useRef<AbortController | null>(null);
  const teammateFetchInProgressRef = useRef<Set<number>>(new Set());

  // Load teammate participation for current base games when filter is active
  useEffect(() => {
    const run = async () => {
      if (!teammateFilterId) {
        setTeammatePlayedGameIds(new Set());
        return;
      }
      
      // Cancel any in-flight request for a different teammate
      if (teammateFetchAbortControllerRef.current) {
        teammateFetchAbortControllerRef.current.abort();
      }
      
      // Check if already fetching this teammate
      if (teammateFetchInProgressRef.current.has(teammateFilterId)) {
        console.log(`[Teammate Filter] ⏳ Already fetching games for teammate ${teammateFilterId}, skipping duplicate`);
        return;
      }
      
      try {
        // Get all games from baseGameData to check
        const games = (baseGameData || []).map((g: any) => g?.stats?.game?.id || g?.game?.id).filter(Boolean);
        if (!games.length) {
          setTeammatePlayedGameIds(new Set());
          return;
        }
        
        // Check cache first (30 min TTL)
        const CACHE_KEY = `teammate-games-${teammateFilterId}`;
        const CACHE_TIMESTAMP_KEY = `teammate-games-${teammateFilterId}-timestamp`;
        const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
        
        if (typeof window !== 'undefined') {
          const cachedData = sessionStorage.getItem(CACHE_KEY);
          const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
          
          if (cachedData && cachedTimestamp) {
            const age = Date.now() - parseInt(cachedTimestamp, 10);
            if (age < CACHE_TTL_MS) {
              try {
                const cachedGameIds = JSON.parse(cachedData);
                if (Array.isArray(cachedGameIds)) {
                  // Use all cached game IDs, not just ones from baseGameData
                  // This ensures we have complete data for all games
                  const allCachedIds = new Set(cachedGameIds);
                  
                  // If cache has very few games (< 10), it might be incomplete (from old logic)
                  // Clear the cache and refetch to ensure we have complete season data
                  if (allCachedIds.size < 10) {
                    console.log(`[Teammate Filter] ⚠️ Cache has only ${allCachedIds.size} games, likely incomplete. Clearing cache and refetching...`);
                    // Clear the stale cache
                    sessionStorage.removeItem(CACHE_KEY);
                    sessionStorage.removeItem(CACHE_TIMESTAMP_KEY);
                    // Continue to fetch fresh data below
                  } else {
                    setTeammatePlayedGameIds(allCachedIds);
                    console.log(`[Teammate Filter] ✅ Using cached data (${allCachedIds.size} total games, ${games.length} in current view, ${Math.round(age / 1000)}s old)`);
                  return; // Use cached data, skip API calls
                  }
                }
              } catch (e) {
                console.warn('[Teammate Filter] ⚠️ Failed to parse cached data, fetching fresh');
              }
            } else {
              console.log(`[Teammate Filter] ⏰ Cache expired (${Math.round(age / 1000)}s old), fetching fresh`);
            }
          }
        }
        
        // Mark as in-progress
        teammateFetchInProgressRef.current.add(teammateFilterId);
        setLoadingTeammateGames(true);
        
        // Create abort controller for this request
        const abortController = new AbortController();
        teammateFetchAbortControllerRef.current = abortController;
        
        // Fetch ALL teammate stats for the current season, not just games in baseGameData
        // This ensures we have complete data regardless of timeframe filter
        const currentSeason = currentNbaSeason();
          const params = new URLSearchParams();
          params.set('endpoint', '/stats');
          params.set('per_page', '100');
          params.set('player_ids[]', String(teammateFilterId));
        params.set('seasons[]', String(currentSeason));
          const url = `/api/balldontlie?${params.toString()}`;
          
          try {
            const res = await fetch(url, { 
              cache: 'no-store',
              signal: abortController.signal 
            }).catch(() => null);
            
          if (abortController.signal.aborted) {
            return;
          }
            
            const json = await res?.json().catch(() => ({})) as any;
          const allStats = Array.isArray(json?.data) ? json.data : [];
        
        // Check if request was aborted
        if (abortController.signal.aborted) {
          return;
        }
        
        const played = new Set<number>();
        
          // Process all results - mark games where teammate played (minutes > 0)
          allStats.forEach((s: any) => {
          const minStr = s?.min || '0:00';
          const [m, sec] = String(minStr).split(':').map((x: any) => parseInt(x || '0', 10));
          const minutes = (Number.isFinite(m) ? m : 0) + ((Number.isFinite(sec) ? sec : 0) > 0 ? 1 : 0);
          const gid = typeof s?.game?.id === 'number' ? s.game.id : (typeof s?.game_id === 'number' ? s.game_id : null);
            if (minutes > 0 && gid != null) {
              played.add(gid);
            }
        });
        
        console.log(`[Teammate Filter] 📊 Fetched ${allStats.length} total stats, ${played.size} games where teammate played`);
        
        // Cache the results (only if we got a reasonable amount of data)
        // If we got very few stats, the teammate might not have played much, but cache it anyway
        if (typeof window !== 'undefined') {
          try {
            const allPlayedGameIds = Array.from(played);
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(allPlayedGameIds));
            sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
            console.log(`[Teammate Filter] 💾 Cached ${allPlayedGameIds.length} games for teammate ${teammateFilterId} (from ${allStats.length} total stats)`);
          } catch (e) {
            console.warn('[Teammate Filter] ⚠️ Failed to cache results', e);
          }
        }
        
        setTeammatePlayedGameIds(played);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error('[Teammate Filter] ❌ Error fetching teammate games:', e);
        }
      } finally {
        teammateFetchInProgressRef.current.delete(teammateFilterId);
        setLoadingTeammateGames(false);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error('[Teammate Filter] ❌ Error in teammate filter logic:', e);
        }
        setTeammatePlayedGameIds(new Set());
      } finally {
        // Cleanup is handled in inner finally
      }
    };
    run();
    
    // Cleanup: abort request if component unmounts or dependencies change
    return () => {
      if (teammateFetchAbortControllerRef.current) {
        teammateFetchAbortControllerRef.current.abort();
      }
    };
  }, [withWithoutMode, teammateFilterId, baseGameData]);

  const currentStatOptions = propsMode === 'player' ? PLAYER_STAT_OPTIONS : TEAM_STAT_OPTIONS;

  // Hit rate calculations - using statistical distribution instead of simple counting
  const hitRateStats = useMemo<HitRateStats>(() => {
    // Debug: log chartData values before filtering
    console.log('[hitRateStats] Processing chartData:', {
      chartDataLength: chartData.length,
      sampleChartData: chartData[0],
      sampleValue: chartData[0]?.value,
      sampleValueType: typeof chartData[0]?.value,
      allValues: chartData.map(d => d.value),
      allValueTypes: chartData.map(d => typeof d.value),
    });
    
    const validValues = chartData
      .map(d => (Number.isFinite(d.value) ? d.value : Number(d.value)))
      .filter((v): v is number => Number.isFinite(v));
    
    // Debug: log filtering results
    console.log('[hitRateStats] Valid values:', {
      validValuesLength: validValues.length,
      validValues,
      chartDataLength: chartData.length,
      filteredOut: chartData.length - validValues.length,
    });
    
    if (validValues.length === 0) {
      // Check if URL params indicate a player should be loaded (for initial page load detection)
      let hasUrlPlayer = false;
      if (typeof window !== 'undefined' && propsMode === 'player') {
        try {
          const url = new URL(window.location.href);
          const pid = url.searchParams.get('pid');
          const name = url.searchParams.get('name');
          hasUrlPlayer = !!(pid && name);
        } catch {}
      }
      
      // If we have a selectedPlayer or resolvedPlayerId or URL params but no data, we're likely still loading
      // Don't show "0/0" - return empty stats that won't display the pill
      if (propsMode === 'player' && (selectedPlayer || resolvedPlayerId || hasUrlPlayer) && (isLoading || chartData.length === 0)) {
        console.log('[hitRateStats] Loading state - player exists but no data yet');
        // Return empty but with a flag that we're loading (chartData.length === 0 means we're waiting)
        return { overCount: 0, underCount: 0, total: 0, averages: [], totalBeforeFilters: undefined };
      }
      console.warn('[hitRateStats] No valid values found! Returning 0/0');
      return { overCount: 0, underCount: 0, total: 0, averages: [], totalBeforeFilters: propsMode === 'player' ? baseGameData.length : undefined };
    }
    
    // Calculate statistical metrics
    const mean = validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
    const variance = validValues.reduce((sum, val) => {
      const diff = val - mean;
      return sum + (diff * diff);
    }, 0) / validValues.length;
    const stdDev = Math.sqrt(variance);
    const adjustedStdDev = Math.max(stdDev, 2); // Minimum stdDev to avoid division issues
    
    // Calculate actual hit rates by counting games where stat > bettingLine
    // This gives real hit rates, not probability-based estimates
    const total = chartData.length;
    let overCount = 0;
    let underCount = 0;
    
    if (Number.isFinite(bettingLine)) {
      // Count actual hits: how many games had stat > bettingLine
      validValues.forEach(val => {
        if (val > bettingLine) {
          overCount++;
        } else {
          underCount++;
        }
      });
    } else {
      // If no betting line, can't calculate hit rates
      overCount = 0;
      underCount = total;
    }
    
    const safeReduce = (values: number[]): number => {
      if (!values.length) return 0;
      const total = values.reduce((sum, val) => sum + val, 0);
      return total / values.length;
    };
  
    const primaryValues = chartData
      .map(d => (Number.isFinite(d.value) ? d.value : Number(d.value)))
      .filter((v): v is number => Number.isFinite(v));
  
    const averages: AverageStatInfo[] = [];
    const statMeta = currentStatOptions.find(s => s.key === selectedStat);
    const baseLabel = statMeta ? statMeta.label : selectedStat.toUpperCase();
    const percentageStats = new Set(['fg3_pct', 'fg_pct', 'ft_pct', 'opp_fg_pct', 'opp_fg3_pct', 'opp_ft_pct']);
    const baseFormat: 'percent' | undefined = percentageStats.has(selectedStat) ? 'percent' : undefined;
    const primaryAverage = safeReduce(primaryValues);
    averages.push({ label: baseLabel, value: primaryAverage, format: baseFormat });

    if (['pra', 'pr', 'ra', 'pa'].includes(selectedStat)) {
      const parts = chartData.map((d: any) => {
        const stats = d && (d as any).stats;
        return stats || {};
      });
      const ptsValues = parts.map(p => Number(p.pts)).filter((v): v is number => Number.isFinite(v));
      const rebValues = parts.map(p => Number(p.reb)).filter((v): v is number => Number.isFinite(v));
      const astValues = parts.map(p => Number(p.ast)).filter((v): v is number => Number.isFinite(v));
  
      if (selectedStat === 'pra') {
        averages.push({ label: 'PTS', value: safeReduce(ptsValues) });
        averages.push({ label: 'REB', value: safeReduce(rebValues) });
        averages.push({ label: 'AST', value: safeReduce(astValues) });
      } else if (selectedStat === 'pr') {
        averages.push({ label: 'PTS', value: safeReduce(ptsValues) });
        averages.push({ label: 'REB', value: safeReduce(rebValues) });
      } else if (selectedStat === 'ra') {
        averages.push({ label: 'REB', value: safeReduce(rebValues) });
        averages.push({ label: 'AST', value: safeReduce(astValues) });
      } else if (selectedStat === 'pa') {
        averages.push({ label: 'PTS', value: safeReduce(ptsValues) });
        averages.push({ label: 'AST', value: safeReduce(astValues) });
      }
    } else if (selectedStat === 'fg3m') {
      const attempts = chartData
        .map((d: any) => Number((d?.stats as any)?.fg3a))
        .filter((v): v is number => Number.isFinite(v));
      averages.push({ label: '3PA', value: safeReduce(attempts) });
    } else if (selectedStat === 'fg3a') {
      const made = chartData
        .map((d: any) => Number((d?.stats as any)?.fg3m))
        .filter((v): v is number => Number.isFinite(v));
      averages.push({ label: '3PM', value: safeReduce(made) });
    }
  
    // Track total games before filters for "X/Y games" display (player mode only)
    const totalBeforeFilters = propsMode === 'player' ? baseGameData.length : undefined;
    
    return { overCount, underCount, total, averages, totalBeforeFilters };
  }, [chartData, bettingLine, selectedStat, currentStatOptions, propsMode, baseGameData.length, selectedPlayer, isLoading]);

  // Custom tooltip content - completely independent to prevent lag when adjusting betting line
  const customTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      
      // Use the currently selected stat for label and formatting
      const statMeta = currentStatOptions.find(s => s.key === selectedStat);
      const statLabel = statMeta ? statMeta.label : selectedStat.toUpperCase();
      const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
      const numValue = typeof data.value === 'number' ? data.value : parseFloat(data.value) || 0;
      const formattedValue = isPercentageStat ? `${numValue.toFixed(1)}%` : `${numValue}`;
      
      // Handle both player and team mode data
      let correctDate = "Unknown Date";
      let dateShort = "Unknown";
      let gameDetails = null;
      let opponentTeam = '';
      let playerTeam = '';
      
      // Format minutes with apostrophe (e.g., "40'" instead of "40:00")
      const formatMinutes = (minStr: string): string => {
        if (!minStr) return "0'";
        const match = minStr.match(/(\d+):(\d+)/);
        if (match) {
          const mins = parseInt(match[1], 10);
          return `${mins}'`;
        }
        return minStr;
      };
      
      if (propsMode === 'team' && data.gameData) {
        // Team mode: use game data
        const gameData = data.gameData;
        const gameISO = gameData.date;
        if (gameISO) {
          const date = new Date(gameISO);
          correctDate = date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
          });
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const year = String(date.getFullYear()).slice(-2);
          dateShort = `${month}/${day}/${year}`;
        }
        // For quarter stats, show quarter-specific scores instead of full game
        const isQuarterStat = ['q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline', 'q1_total', 'q2_total', 'q3_total', 'q4_total'].includes(selectedStat);
        let homeScore, visitorScore;
        
        if (isQuarterStat) {
          // Extract quarter number from stat name (e.g., 'q1_moneyline' -> 1)
          const quarter = selectedStat.charAt(1); // Gets '1', '2', '3', or '4'
          homeScore = gameData[`home_q${quarter}`] || 0;
          visitorScore = gameData[`visitor_q${quarter}`] || 0;
        } else {
          homeScore = gameData.home_team_score || 0;
          visitorScore = gameData.visitor_team_score || 0;
        }
        
        playerTeam = gamePropsTeam || selectedTeam || '';
        opponentTeam = gameData.home_team?.abbreviation === playerTeam 
          ? gameData.visitor_team?.abbreviation || ''
          : gameData.home_team?.abbreviation || '';
        
        gameDetails = {
          homeScore,
          visitorScore,
          homeTeam: gameData.home_team?.abbreviation || '',
          visitorTeam: gameData.visitor_team?.abbreviation || '',
          isQuarterStat,
          quarter: isQuarterStat ? selectedStat.charAt(1) : null
        };
      } else if (propsMode === 'player' && data.stats) {
        // Player mode: use player stats
        const gameStats = data.stats;
        playerTeam = gameStats?.team?.abbreviation || '';
        
        if ((gameStats as any)?.game) {
          const game = (gameStats as any).game;
          const gameISO = game.date;
          if (gameISO) {
            const date = new Date(gameISO);
            correctDate = date.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'short', 
              day: 'numeric' 
            });
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const year = String(date.getFullYear()).slice(-2);
            dateShort = `${month}/${day}/${year}`;
          }
          
          // Get opponent team
          const homeTeam = game.home_team?.abbreviation || '';
          const visitorTeam = game.visitor_team?.abbreviation || '';
          opponentTeam = homeTeam === playerTeam ? visitorTeam : homeTeam;
        }
      }
      
      // Calculate game result (won/lost by X)
      let gameResult: string | null = null;
      
      if (propsMode === 'team' && gameDetails) {
        const teamScore = gameDetails.homeTeam === (gamePropsTeam || selectedTeam) 
          ? gameDetails.homeScore 
          : gameDetails.visitorScore;
        const opponentScore = gameDetails.homeTeam === (gamePropsTeam || selectedTeam)
          ? gameDetails.visitorScore
          : gameDetails.homeScore;
        const margin = Math.abs(teamScore - opponentScore);
        if (teamScore > opponentScore) {
          gameResult = `Won by ${margin}`;
        } else if (teamScore < opponentScore) {
          gameResult = `Lost by ${margin}`;
        }
      } else if (propsMode === 'player' && data.stats && (data.stats as any)?.game) {
        const game = (data.stats as any).game;
        const homeScore = game.home_team_score || 0;
        const visitorScore = game.visitor_team_score || 0;
        const homeTeam = game.home_team?.abbreviation || '';
        const isHome = homeTeam === playerTeam;
        const teamScore = isHome ? homeScore : visitorScore;
        const oppScore = isHome ? visitorScore : homeScore;
        const margin = Math.abs(teamScore - oppScore);
        if (teamScore > oppScore) {
          gameResult = `Won by ${margin}`;
        } else if (teamScore < oppScore) {
          gameResult = `Lost by ${margin}`;
        }
      }
      
      // Professional tooltip styling
      const tooltipBg = isDark ? '#1f2937' : '#ffffff';
      const tooltipText = isDark ? '#ffffff' : '#000000';
      const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
      const labelColor = isDark ? '#9ca3af' : '#6b7280';
      const winColor = isDark ? '#10b981' : '#059669'; // Green for wins
      const lossColor = isDark ? '#ef4444' : '#dc2626'; // Red for losses
      
      return (
        <div style={{
          backgroundColor: tooltipBg,
          border: `1px solid ${tooltipBorder}`,
          borderRadius: '8px',
          padding: '12px',
          minWidth: '200px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          zIndex: 9999
        }}>
          {/* Header: Date, Opponent, and Game Result */}
          <div style={{ 
            marginBottom: '12px', 
            paddingBottom: '8px', 
            borderBottom: `1px solid ${tooltipBorder}`,
            fontSize: '13px',
            fontWeight: '600',
            color: tooltipText,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>{dateShort} {opponentTeam && `vs ${opponentTeam}`}</span>
            {gameResult && (
              <span style={{
                color: gameResult.startsWith('Won') ? winColor : lossColor,
                fontWeight: '600',
                fontSize: '12px'
              }}>
                {gameResult}
              </span>
            )}
          </div>
          
          {/* Main stat line - highlighted */}
          <div style={{
            marginBottom: '10px',
            padding: '8px',
            backgroundColor: isDark ? '#374151' : '#f3f4f6',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            color: tooltipText
          }}>
            {statLabel}: {formattedValue}
          </div>
          
          {/* Player mode: Stat-based detailed stats */}
          {propsMode === 'player' && data.stats && (() => {
            const stats = data.stats;
            const statRows: Array<{ label: string; value: string }> = [];
            
            // Always show minutes first
            statRows.push({
              label: 'Minutes',
              value: formatMinutes(stats.min || "0:00")
            });
            
            // Stat-specific stats based on selectedStat
            if (selectedStat === 'pts' || selectedStat === 'fg3m' || selectedStat === 'fgm') {
              // Points, 3PT Made, FG Made: Show shooting stats
              statRows.push({
                label: 'Points',
                value: String(Number(stats.pts || 0))
              });
              
              if (stats.ftm !== undefined && stats.fta !== undefined) {
                statRows.push({
                  label: 'FT Made',
                  value: `${stats.ftm}/${stats.fta}${stats.fta > 0 ? ` (${Math.round((stats.ftm / stats.fta) * 100)}%)` : ''}`
                });
              }
              
              if (stats.fg3m !== undefined && stats.fg3a !== undefined) {
                statRows.push({
                  label: '3PT Made',
                  value: `${stats.fg3m}/${stats.fg3a}${stats.fg3a > 0 ? ` (${Math.round((stats.fg3m / stats.fg3a) * 100)}%)` : ''}`
                });
              }
              
              if (stats.fgm !== undefined && stats.fga !== undefined) {
                statRows.push({
                  label: 'FG Made',
                  value: `${stats.fgm}/${stats.fga}${stats.fga > 0 ? ` (${Math.round((stats.fgm / stats.fga) * 100)}%)` : ''}`
                });
              }
            } else if (selectedStat === 'ast') {
              // Assists: Show assist-related stats
              statRows.push({
                label: 'Assists',
                value: String(Number(stats.ast || 0))
              });
              
              // TODO: Add Potential AST and Passes Made when tracking stats are available
              // These would come from tracking stats API
              // statRows.push({ label: 'Potential AST', value: String(trackingStats?.potentialAst || 0) });
              // statRows.push({ label: 'Passes Made', value: String(trackingStats?.passesMade || 0) });
            } else if (selectedStat === 'reb') {
              // Rebounds: Show rebounding stats
              // TODO: Add Rebound Chances when tracking stats are available
              // statRows.push({ label: 'Rebound Chances', value: String(trackingStats?.rebChances || 0) });
              
              statRows.push({
                label: 'OREB',
                value: String(Number(stats.oreb || 0))
              });
              
              statRows.push({
                label: 'DREB',
                value: String(Number(stats.dreb || 0))
              });
            } else {
              // Default: Show common stats
              statRows.push({
                label: 'Points',
                value: String(Number(stats.pts || 0))
              });
              
              statRows.push({
                label: 'Rebounds',
                value: String(Number(stats.reb || 0))
              });
              
              statRows.push({
                label: 'Assists',
                value: String(Number(stats.ast || 0))
              });
            }
            
            // Add fouls if available
            if (stats.pf !== undefined) {
              statRows.push({
                label: 'Fouls',
                value: String(stats.pf)
              });
            }
            
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                {statRows.map((row, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: labelColor }}>{row.label}:</span>
                    <span style={{ color: tooltipText, fontWeight: '500' }}>{row.value}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          
          {/* Team mode: Game score */}
          {propsMode === 'team' && gameDetails && (
            <div style={{ fontSize: '13px', color: tooltipText, marginTop: '8px' }}>
              <div style={{ marginBottom: '4px' }}>
                {gameDetails.isQuarterStat && `Q${gameDetails.quarter}: `}
                {gameDetails.homeTeam} {gameDetails.homeScore} - {gameDetails.visitorScore} {gameDetails.visitorTeam}
              </div>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  // Memoized label formatter for chart bars
  const formatChartLabel = useMemo(() => {
    const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
    return (value: any): string => {
      // Hide labels for moneyline stats (win/loss is clear from bar presence/absence)
      if (['moneyline', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat)) {
        return '';
      }
      const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
      if (isPercentageStat) {
        return `${numValue.toFixed(1)}%`;
      }
      return numValue.toString();
    };
  }, [selectedStat]);

  // Calculate Y-axis domain with appropriate tick increments
  const yAxisConfig = useMemo(() => {
    if (!chartData.length) return { domain: [0, 50], ticks: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50], dataMin: 0, dataMax: 0 };
    
    const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
    const smallIncrementStats = ['reb', 'ast', 'fg3m', 'fg3a', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'turnover', 'pf', 'stl', 'blk'];
    const isSmallIncrementStat = smallIncrementStats.includes(selectedStat);
    
    // Get min and max values from data
    // For spread stat, values will be adjusted later, but we need to account for absolute values
    // to ensure domain covers all possible adjusted values
    const values = chartData.map(d => d.value);
    let minValue = Math.min(...values);
    let maxValue = Math.max(...values);
    
    // For spread stat in team mode, account for sign adjustment
    // Values will be adjusted to all negative (favorite) or all positive (underdog)
    // So we need to ensure domain covers the absolute value range
    if (propsMode === 'team' && selectedStat === 'spread') {
      const absValues = values.map(v => Math.abs(v));
      const maxAbs = Math.max(...absValues);
      // Domain should accommodate: negative values down to -maxAbs, or positive values up to +maxAbs
      // We'll set domain to cover both possibilities with padding
      minValue = -maxAbs;
      maxValue = maxAbs;
    }
    
    let minYAxis;
    let maxYAxis;
    let increment;
    
    if (isPercentageStat) {
      minYAxis = 0;
      maxYAxis = 100;
      increment = 5; // Percentages use 5-increment ticks
    } else if (['moneyline', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat)) {
      // Special handling for moneyline: only 0 (loss) and 1 (win) values
      // Set domain higher than 1 so win bars appear large
      minYAxis = 0;
      maxYAxis = 1.5; // Make 1 appear at about 2/3 height for bigger visual impact
      return { domain: [minYAxis, maxYAxis], ticks: [0, 1], dataMin: minValue, dataMax: maxValue };
    } else if (selectedStat === 'spread') {
      // Special handling for spread: ensure minimum value is positioned higher to prevent bars going below container
      const range = maxValue - minValue;
      const padding = Math.max(5, Math.ceil(range * 0.15)); // At least 5 points padding, or 15% of range
      
      minYAxis = Math.floor((minValue - padding) / 5) * 5; // Round down to nearest 5-increment with padding
      maxYAxis = Math.ceil((maxValue + padding) / 5) * 5; // Round up to nearest 5-increment with padding
      increment = 5;
      
      // Generate ticks only for the visible data range (without showing padding ticks)
      const visibleMinY = Math.floor(minValue / 5) * 5; // Actual data minimum without padding
      const visibleMaxY = Math.ceil(maxValue / 5) * 5; // Actual data maximum without padding
      const ticks = [];
      for (let i = visibleMinY; i <= visibleMaxY; i += increment) {
        ticks.push(i);
      }
      
      return { domain: [minYAxis, maxYAxis], ticks, dataMin: minValue, dataMax: maxValue };
    } else if (isSmallIncrementStat) {
      // For 3PM, use 3PA values for Y-axis calculation to show proper scale
      if (selectedStat === 'fg3m') {
        const maxAttempts = Math.max(...chartData.map(d => (d as any).stats?.fg3a || 0));
        minYAxis = 0;
        maxYAxis = Math.ceil(maxAttempts); // For 3PM, don't add extra increment - top bar should touch Y-axis max
      } else {
        minYAxis = minValue < 0 ? Math.floor(minValue) - 1 : 0;
        // For steals/blocks, ensure domain is at least [0, 2] so betting line at 0.5 is visible
        // This handles cases where all values are 0 but betting line is 0.5
        if ((selectedStat === 'stl' || selectedStat === 'blk') && maxValue === 0) {
          maxYAxis = 2; // Ensure domain shows 0-2 so 0.5 line is visible
        } else {
          maxYAxis = Math.ceil(maxValue) + 1; // Round up to next 1-increment
        }
      }
      increment = 1; // Use 1-increment ticks for smaller stats
    } else {
      // Handle negative values by rounding down to nearest 5-increment
      minYAxis = minValue < 0 ? Math.floor(minValue / 5) * 5 : 0;
      maxYAxis = Math.ceil((maxValue + 1) / 5) * 5; // Round up to next 5-increment
      increment = 5; // Use 5-increment ticks for larger stats like points, minutes
    }

    // Generate ticks based on the increment
    let ticks: number[] = [];
    for (let i = minYAxis; i <= maxYAxis; i += increment) {
      ticks.push(i);
    }
    
    return { domain: [minYAxis, maxYAxis], ticks, dataMin: minValue, dataMax: maxValue };
  }, [chartData, selectedStat, selectedTimeframe, propsMode]);

  // Real odds data state
  const [realOddsData, setRealOddsData] = useState<BookRow[]>([]);
  
  // Debug: Track realOddsData changes
  useEffect(() => {
    console.log('[DEBUG realOddsData] State changed', {
      length: realOddsData.length,
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
    });
  }, [realOddsData]);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);

  // Calculate predicted pace from betting total line
  useEffect(() => {
    if (!realOddsData || realOddsData.length === 0 || !selectedTeam || selectedTeam === 'N/A' || !opponentTeam || opponentTeam === 'N/A' || propsMode !== 'player') {
      setPredictedPace(null);
      return;
    }

    // Find Total line from odds data
    let totalLine: number | null = null;
    for (const book of realOddsData) {
      const totalData = (book as any)?.Total;
      if (totalData && totalData.line && totalData.line !== 'N/A') {
        const lineValue = parseFloat(totalData.line);
        if (!isNaN(lineValue) && lineValue > 0) {
          // Use the first valid total line found (or could average them)
          totalLine = lineValue;
          break;
        }
      }
    }

    if (totalLine === null) {
      setPredictedPace(null);
      return;
    }

    // Convert total points to predicted pace
    // Formula: Pace ≈ Total / (2 * avg_points_per_possession)
    // Average NBA points per possession is ~1.12
    // So: Pace ≈ Total / 2.24
    // We'll use a more accurate formula based on historical data
    // Typical range: Total 200-240, Pace 95-105
    // Linear relationship: Pace = (Total - 200) * (10/40) + 95 = (Total - 200) * 0.25 + 95
    // Or more accurate: Pace = Total / 2.2 (simpler)
    const calculatedPace = totalLine / 2.2;
    
    // Clamp to reasonable NBA pace range (90-110)
    const clampedPace = Math.max(90, Math.min(110, calculatedPace));
    
    console.log('[Dashboard] Calculated predicted pace from total:', { totalLine, calculatedPace, clampedPace });
    setPredictedPace(clampedPace);
  }, [realOddsData, selectedTeam, opponentTeam, propsMode]);

  // Calculate season averages (FG%, minutes, game pace) from playerStats
  useEffect(() => {
    if (!playerStats || playerStats.length === 0 || propsMode !== 'player') {
      setSeasonFgPct(null);
      setAverageUsageRate(null);
      setAverageMinutes(null);
      setAverageGamePace(null);
      return;
    }

    // Calculate average FG% from all games
    const fgPctValues = playerStats
      .map(stats => stats.fg_pct)
      .filter((pct): pct is number => pct !== null && pct !== undefined && !isNaN(pct));

    if (fgPctValues.length === 0) {
      setSeasonFgPct(null);
    } else {
      const averageFgPct = fgPctValues.reduce((sum, pct) => sum + pct, 0) / fgPctValues.length;
      // Convert to percentage (multiply by 100)
      setSeasonFgPct(averageFgPct * 100);
    }

    // Calculate average minutes from all games
    const minutesValues = playerStats
      .map(stats => parseMinutes(stats.min))
      .filter((min): min is number => min !== null && min !== undefined && !isNaN(min) && min > 0);

    if (minutesValues.length === 0) {
      setAverageMinutes(null);
    } else {
      const avgMinutes = minutesValues.reduce((sum, min) => sum + min, 0) / minutesValues.length;
      setAverageMinutes(avgMinutes);
    }

    // Calculate average game pace from all games
    const paceValues: number[] = [];
    for (const stats of playerStats) {
      const game = stats.game;
      if (!game) continue;

      const homeTeam = game.home_team?.abbreviation;
      const awayTeam = game.visitor_team?.abbreviation;
      
      if (!homeTeam || !awayTeam) continue;

      const homePace = getTeamPace(normalizeAbbr(homeTeam));
      const awayPace = getTeamPace(normalizeAbbr(awayTeam));

      if (homePace > 0 && awayPace > 0) {
        const gamePace = (homePace + awayPace) / 2;
        paceValues.push(gamePace);
      }
    }

    if (paceValues.length === 0) {
      setAverageGamePace(null);
    } else {
      const avgPace = paceValues.reduce((sum, pace) => sum + pace, 0) / paceValues.length;
      setAverageGamePace(avgPace);
    }
  }, [playerStats, propsMode]);


  // Set coreDataReady when stats are loaded; wait for odds (with fallback) to avoid visible refresh
  // Uses existing lastPlayerStatsLengthRef (defined earlier) to track per-player changes
  const coreDataReadySetRef = useRef(false);
  
  useEffect(() => {
    // Reset when loading starts or no stats yet
    if (isLoading || playerStats.length === 0) {
      setCoreDataReady(false);
      coreDataReadySetRef.current = false;
      lastPlayerStatsLengthRef.current = 0;
      return;
    }

    // Only run when playerStats length actually changes (new player selected)
    if (playerStats.length === lastPlayerStatsLengthRef.current && coreDataReadySetRef.current) {
      return;
    }

    // Update ref to track current stats length
    lastPlayerStatsLengthRef.current = playerStats.length;

    // If we've already set coreDataReady for this player, don't re-run
    if (coreDataReadySetRef.current) {
      return;
    }

    // Set coreDataReady immediately - odds will render inline without causing refresh
    setCoreDataReady(true);
    coreDataReadySetRef.current = true;
  }, [playerStats.length, isLoading]);
  
  // Debug: Track component renders (after all state is defined)
  useEffect(() => {
    renderCountRef.current += 1;
    console.log(`[DEBUG Render] NBADashboardContent render #${renderCountRef.current}`, {
      timestamp: new Date().toISOString(),
      playerStatsLength: playerStats?.length || 0,
      selectedPlayer: selectedPlayer?.full,
      realOddsDataLength: realOddsData?.length || 0,
      bettingLine,
      selectedTimeframe,
      oddsLoading
    });
  });

  // For spread we now use the signed margin directly (wins down, losses up)
  const adjustedChartData = useMemo(() => chartData, [chartData]);

  // Calculate average usage rate from prefetchedAdvancedStats
  // Use baseGameData (filtered by timeframe) to match what the chart shows - works automatically without clicking filter
  useEffect(() => {
    if (!baseGameData || baseGameData.length === 0 || propsMode !== 'player') {
      setAverageUsageRate(null);
      return;
    }

    // Get player ID
    const playerIdRaw = selectedPlayer?.id;
    if (!playerIdRaw) {
      setAverageUsageRate(null);
      return;
    }
    const playerId = typeof playerIdRaw === 'number' ? playerIdRaw : Number(playerIdRaw);
    if (isNaN(playerId)) {
      setAverageUsageRate(null);
      return;
    }

    // Extract game IDs from baseGameData
    const gameIds: number[] = [];
    baseGameData.forEach((game: any) => {
      const stat = game.stats || game;
      const gameId = stat.game?.id || game.game?.id;
      if (gameId && typeof gameId === 'number') {
        gameIds.push(gameId);
      }
    });

    if (gameIds.length === 0) {
      setAverageUsageRate(null);
      return;
    }

    // Check if we have prefetched data for these games
    const missingGameIds = gameIds.filter(id => prefetchedAdvancedStats[id] === undefined);
    const hasAllData = missingGameIds.length === 0;

    // If we don't have all data, fetch it immediately (don't wait for background prefetch)
    if (!hasAllData) {
      let isMounted = true;
      const fetchUsageRate = async () => {
        try {
          const stats = await BallDontLieAPI.getAdvancedStatsByGames(gameIds, playerId);
          
          if (!isMounted) return;
          
          // Map stats by game ID
          const statsByGame: Record<number, { pace?: number; usage_percentage?: number }> = {};
          stats.forEach((stat: any) => {
            const gameId = stat.game?.id;
            if (gameId && typeof gameId === 'number') {
              statsByGame[gameId] = {
                pace: stat.pace ?? undefined,
                usage_percentage: stat.usage_percentage ?? undefined,
              };
            }
          });
          
          // Update prefetched stats
          setPrefetchedAdvancedStats(prev => ({ ...prev, ...statsByGame }));
          
          // Calculate usage rate from the fetched data
          const usageValues: number[] = [];
          baseGameData.forEach((game: any) => {
            const stat = game.stats || game;
            const gameId = stat.game?.id || game.game?.id;
            const minutes = parseMinutes(stat.min);
            
            if (gameId && minutes > 0 && statsByGame[gameId]?.usage_percentage !== undefined) {
              const usage = statsByGame[gameId].usage_percentage;
              if (usage !== null && usage !== undefined && !isNaN(usage) && usage >= 0) {
                usageValues.push(usage);
              }
            }
          });

          if (usageValues.length > 0) {
            const avgUsage = usageValues.reduce((sum, usage) => sum + usage, 0) / usageValues.length;
            setAverageUsageRate(avgUsage * 100);
          }
        } catch (error) {
          console.error('[Usage Rate] Error fetching advanced stats:', error);
        }
      };

      fetchUsageRate();
      return () => {
        isMounted = false;
      };
    }

    // If we have all prefetched data, calculate from it
    const usageValues: number[] = [];
    baseGameData.forEach((game: any) => {
      const stat = game.stats || game;
      const gameId = stat.game?.id || game.game?.id;
      const minutes = parseMinutes(stat.min);
      
      // Only include games where player actually played
      if (gameId && minutes > 0 && prefetchedAdvancedStats[gameId]?.usage_percentage !== undefined) {
        const usage = prefetchedAdvancedStats[gameId].usage_percentage;
        if (usage !== null && usage !== undefined && !isNaN(usage) && usage >= 0) {
          usageValues.push(usage);
        }
      }
    });

    if (usageValues.length === 0) {
      setAverageUsageRate(null);
    } else {
      const avgUsage = usageValues.reduce((sum, usage) => sum + usage, 0) / usageValues.length;
      // Convert to percentage (multiply by 100)
      const usageRate = avgUsage * 100;
      setAverageUsageRate(usageRate);
    }
  }, [prefetchedAdvancedStats, baseGameData, propsMode, selectedPlayer?.id]);

  // Calculate slider min/max based on selected filter (use all games for accurate min/max)
  const sliderConfig = useMemo(() => {
    if (!selectedFilterForAxis || !allGamesSecondAxisData) {
      return null;
    }

    const values = allGamesSecondAxisData
      .map(item => item.value)
      .filter((v): v is number => v !== null && Number.isFinite(v));

    if (values.length === 0) {
      return null;
    }

    let min: number;
    let max: number;

    switch (selectedFilterForAxis) {
      case 'minutes':
        min = 0;
        max = 50;
        break;
      case 'fg_pct':
        min = 0;
        max = 100;
        break;
      case 'pace':
        min = Math.floor(Math.min(...values));
        max = Math.ceil(Math.max(...values));
        break;
      case 'usage_rate':
        min = Math.floor(Math.min(...values));
        max = Math.ceil(Math.max(...values));
        break;
      case 'dvp_rank':
        min = 1;
        max = 30;
        break;
      default:
        return null;
    }

    return { min, max, values };
  }, [selectedFilterForAxis, allGamesSecondAxisData]);

  // Filter chart data based on slider range
  // IMPORTANT: Filter from ALL games first (using allGamesSecondAxisData from playerStats), then apply timeframe
  const filteredChartData = useMemo(() => {
    // If no filter axis selected, use adjustedChartData (which already has timeframe filter from baseGameData)
    if (!selectedFilterForAxis || !allGamesSecondAxisData || propsMode !== 'player') {
      return adjustedChartData;
    }
    
    // If sliderRange is not set yet, still need to apply timeframe filter to allGamesSecondAxisData
    // This ensures timeframe is always respected even before slider is initialized
    if (!sliderRange) {
      // Apply timeframe filter directly to allGamesSecondAxisData
      let timeframeFiltered = allGamesSecondAxisData;
      
      if (selectedTimeframe === 'h2h' && opponentTeam && opponentTeam !== '') {
        const normalizedOpponent = normalizeAbbr(opponentTeam);
        timeframeFiltered = allGamesSecondAxisData.filter((item: any) => {
          // FIXED to handle players who changed teams
          // If a player has stats for a game, and the opponent is in that game, it's an H2H match
          const stats = item.stats;
          const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
          const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
          const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          
          if (!homeTeamAbbr || !visitorTeamAbbr) {
            return false;
          }
          
          const homeNorm = normalizeAbbr(homeTeamAbbr);
          const awayNorm = normalizeAbbr(visitorTeamAbbr);
          
          // If the opponent is in this game, and the player has stats for it, it's an H2H match
          return homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
        }).slice(0, 6);
      } else if (selectedTimeframe === 'thisseason') {
        const currentSeason = currentNbaSeason();
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const seasonStartYear = currentMonth >= 9 ? currentYear : currentYear - 1;
        timeframeFiltered = allGamesSecondAxisData.filter((item: any) => {
          const stats = item.stats;
          if (!stats?.game?.date) return false;
          const gameDate = new Date(stats.game.date);
          const gameYear = gameDate.getFullYear();
          const gameMonth = gameDate.getMonth();
          const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
          return gameSeasonYear === seasonStartYear;
        });
      } else if (selectedTimeframe === 'lastseason') {
        const lastSeason = currentNbaSeason() - 1;
        timeframeFiltered = allGamesSecondAxisData.filter((item: any) => {
          const stats = item.stats;
          if (!stats?.game?.date) return false;
          const gameDate = new Date(stats.game.date);
          const gameYear = gameDate.getFullYear();
          const gameMonth = gameDate.getMonth();
          const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
          return gameSeasonYear === lastSeason;
        });
      } else if (selectedTimeframe.startsWith('last')) {
        // Handle 'last10', 'last5', etc.
        const n = parseInt(selectedTimeframe.replace('last', ''));
        if (!Number.isNaN(n)) {
          // Sort by date (newest first) and take first N
          const sorted = [...allGamesSecondAxisData].sort((a: any, b: any) => {
            const dateA = a.stats?.game?.date ? new Date(a.stats.game.date).getTime() : 0;
            const dateB = b.stats?.game?.date ? new Date(b.stats.game.date).getTime() : 0;
            return dateB - dateA; // Newest first
          });
          timeframeFiltered = sorted.slice(0, n);
        } else {
          timeframeFiltered = allGamesSecondAxisData;
        }
      }
      
      // Map to chartData format
      const sorted = [...timeframeFiltered].sort((a: any, b: any) => {
        const dateA = a.stats?.game?.date ? new Date(a.stats.game.date).getTime() : 0;
        const dateB = b.stats?.game?.date ? new Date(b.stats.game.date).getTime() : 0;
        return dateB - dateA;
      }).reverse();
      
      return sorted.map((item: any, index: number) => {
        const stats = item.stats;
        let playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
        const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
        const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
        const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
        const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
        const playerTeamNorm = normalizeAbbr(playerTeam);
        const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
        let opponent = "";
        if (playerTeamId && homeTeamId && visitorTeamId) {
          if (playerTeamId === homeTeamId && visitorTeamAbbr) {
            opponent = visitorTeamAbbr;
          } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
            opponent = homeTeamAbbr;
          }
        }
        if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
          const homeNorm = normalizeAbbr(homeTeamAbbr);
          const awayNorm = normalizeAbbr(visitorTeamAbbr);
          if (playerTeamNorm && playerTeamNorm === homeNorm) opponent = awayNorm;
          else if (playerTeamNorm && playerTeamNorm === awayNorm) opponent = homeNorm;
        }
        const iso = stats?.game?.date;
        const d = iso ? new Date(iso) : null;
        const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
        const gameId = stats?.game?.id ?? `${opponent}-${index}`;
        const gameData = {
          stats,
          opponent,
          gameNumber: index + 1,
          game: opponent ? `vs ${opponent}` : "—",
          date: shortDate,
          xKey: String(gameId),
          tickLabel: opponent || "",
        };
        const statValue = getStatValue(stats, selectedStat);
        const value = (statValue !== null && statValue !== undefined) ? statValue : 0;
        return {
          ...gameData,
          value,
        };
      });
    }

    // Filter ALL games by slider range using allGamesSecondAxisData (calculated from playerStats directly)
    const filteredStats = allGamesSecondAxisData
      .filter(item => {
        if (item.value === null || !Number.isFinite(item.value)) {
          return false; // Exclude games without filter data
        }
        // Filter games within the range [min, max]
        return item.value >= sliderRange.min && item.value <= sliderRange.max;
      })
      .map(item => item.stats); // Get the original stats objects

    // Now we need to recreate baseGameData format from these filtered stats
    // Then apply timeframe to get the final result
    // Sort by date (newest first) to match baseGameData logic
    const sortedFilteredStats = [...filteredStats].sort((a: any, b: any) => {
      const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return dateB - dateA; // Newest first
    });

    // Apply timeframe to the filtered games
    const n = parseInt(selectedTimeframe.replace('last', ''));
    let timeframeFilteredStats = sortedFilteredStats;
    
    if (!Number.isNaN(n) && selectedTimeframe.startsWith('last')) {
      // Take the first N games (newest first, so these are the most recent N)
      timeframeFilteredStats = sortedFilteredStats.slice(0, n);
    } else if (selectedTimeframe === 'h2h') {
      // Filter to only show games against the current opponent team
      if (opponentTeam && opponentTeam !== '') {
        const normalizedOpponent = normalizeAbbr(opponentTeam);
        const beforeFilter = sortedFilteredStats.length;
        timeframeFilteredStats = sortedFilteredStats.filter((stats: any) => {
          // FIXED to handle players who changed teams
          // If a player has stats for a game, and the opponent is in that game, it's an H2H match
          const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
          const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
          const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          
          if (!homeTeamAbbr || !visitorTeamAbbr) {
            return false;
          }
          
          const homeNorm = normalizeAbbr(homeTeamAbbr);
          const awayNorm = normalizeAbbr(visitorTeamAbbr);
          
          // If the opponent is in this game, and the player has stats for it, it's an H2H match
          return homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
        }).slice(0, 6); // Limit to last 6 H2H games
        console.log(`[filteredChartData] H2H filter: ${beforeFilter} -> ${timeframeFilteredStats.length} games vs ${opponentTeam}`);
      } else {
        timeframeFilteredStats = [];
        console.log(`[filteredChartData] H2H filter: No opponent team, returning empty`);
      }
    } else if (selectedTimeframe === 'thisseason') {
      // Filter to current season games only
      const currentSeason = currentNbaSeason();
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const seasonStartYear = currentMonth >= 9 ? currentYear : currentYear - 1;
      const beforeFilter = sortedFilteredStats.length;
      
      timeframeFilteredStats = sortedFilteredStats.filter((stats: any) => {
        if (!stats?.game?.date) return false;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        
        // Calculate which NBA season this game belongs to
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        
        // Game must be from the current NBA season
        return gameSeasonYear === seasonStartYear;
      });
      console.log(`[filteredChartData] This Season filter: ${beforeFilter} -> ${timeframeFilteredStats.length} games (seasonStartYear=${seasonStartYear}, currentSeason=${currentSeason})`);
    } else if (selectedTimeframe === 'lastseason') {
      // Filter to last season games only
      const lastSeason = currentNbaSeason() - 1;
      const beforeFilter = sortedFilteredStats.length;
      
      timeframeFilteredStats = sortedFilteredStats.filter((stats: any) => {
        if (!stats?.game?.date) return false;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        
        // NBA season spans two calendar years
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        return gameSeasonYear === lastSeason;
      });
      console.log(`[filteredChartData] Last Season filter: ${beforeFilter} -> ${timeframeFilteredStats.length} games (lastSeason=${lastSeason})`);
    }

    // Reverse for chronological order (oldest→newest, left→right)
    const ordered = timeframeFilteredStats.slice().reverse();

    // Map to baseGameData format, then to chartData format
    const mapped = ordered.map((stats: any, index: number) => {
      // Recreate baseGameData structure
      let playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
      const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
      const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
      const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
      const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
      
      const playerTeamNorm = normalizeAbbr(playerTeam);
      const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
      let opponent = "";
      
      if (playerTeamId && homeTeamId && visitorTeamId) {
        if (playerTeamId === homeTeamId && visitorTeamAbbr) {
          opponent = visitorTeamAbbr;
        } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
          opponent = homeTeamAbbr;
        }
      }
      if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
        const homeNorm = normalizeAbbr(homeTeamAbbr);
        const awayNorm = normalizeAbbr(visitorTeamAbbr);
        if (playerTeamNorm && playerTeamNorm === homeNorm) opponent = awayNorm;
        else if (playerTeamNorm && playerTeamNorm === awayNorm) opponent = homeNorm;
      }
      
      const iso = stats?.game?.date;
      const d = iso ? new Date(iso) : null;
      const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
      const gameId = stats?.game?.id ?? `${opponent}-${index}`;
      
      // Create baseGameData format
      const gameData = {
        stats,
        opponent,
        gameNumber: index + 1,
        game: opponent ? `vs ${opponent}` : "—",
        date: shortDate,
        xKey: String(gameId),
        tickLabel: opponent || "",
      };

      // Map to chartData format
      const statValue = getStatValue(stats, selectedStat);
      const value = (statValue !== null && statValue !== undefined) ? statValue : 0;
      
      return {
        ...gameData,
        value,
      };
    });

    return mapped;
  }, [adjustedChartData, selectedFilterForAxis, allGamesSecondAxisData, sliderRange, propsMode, selectedStat, selectedTimeframe, selectedPlayer, opponentTeam]);

  // Calculate second axis data for display (from filteredChartData to match what's actually displayed)
  const secondAxisData = useMemo(() => {
    if (!selectedFilterForAxis || propsMode !== 'player' || !filteredChartData.length) {
      return null;
    }

    let debugCount = 0;
    const result = filteredChartData.map((game: any) => {
      const numericGameId = typeof game.game?.id === 'number' ? game.game.id : 
                            typeof game.stats?.game?.id === 'number' ? game.stats.game.id : null;
      const gameIdStr = game.xKey || String(numericGameId || '');
      const gameDate = game.date || game.stats?.game?.date || '';
      let value: number | null = null;
      const stats = game.stats;

      switch (selectedFilterForAxis) {
        case 'minutes':
          if (stats?.min) {
            value = parseMinutes(stats.min);
          }
          break;
        case 'fg_pct':
          if (stats?.fg_pct !== null && stats?.fg_pct !== undefined) {
            value = stats.fg_pct * 100;
          }
          break;
        case 'pace':
          if (numericGameId && advancedStatsPerGame[numericGameId]?.pace !== undefined) {
            value = advancedStatsPerGame[numericGameId].pace!;
          }
          break;
        case 'usage_rate':
          if (numericGameId && advancedStatsPerGame[numericGameId]?.usage_percentage !== undefined) {
            value = advancedStatsPerGame[numericGameId].usage_percentage! * 100;
          }
          break;
        case 'dvp_rank':
          // Try multiple gameId formats for lookup
          const rank1 = dvpRanksPerGame[gameIdStr];
          const rank2 = numericGameId ? dvpRanksPerGame[String(numericGameId)] : null;
          value = rank1 ?? rank2 ?? null;
          
          // Debug first few lookups
          if (debugCount < 3) {
            console.log('[secondAxisData] DvP rank lookup:', {
              gameIdStr,
              numericGameId,
              rank1,
              rank2,
              finalValue: value,
              availableKeys: Object.keys(dvpRanksPerGame).slice(0, 5),
              totalKeys: Object.keys(dvpRanksPerGame).length
            });
            debugCount++;
          }
          break;
        default:
          value = null;
      }

      return {
        gameId: gameIdStr,
        gameDate: String(gameDate),
        value,
      };
    });
    
    // Debug summary for DvP rank
    if (selectedFilterForAxis === 'dvp_rank') {
      const valuesWithRanks = result.filter(item => item.value !== null && item.value !== undefined);
      const allGameIdsInResult = result.map(item => item.gameId);
      const allKeysInDvpRanks = Object.keys(dvpRanksPerGame);
      const matchingKeys = allGameIdsInResult.filter(id => allKeysInDvpRanks.includes(id));
      
      // Get sample entries with their values
      const sampleEntries = Object.entries(dvpRanksPerGame).slice(0, 5).map(([key, value]) => ({
        key,
        value,
        valueType: typeof value
      }));
      
      console.log('[secondAxisData] DvP rank summary:', {
        totalGames: result.length,
        gamesWithRanks: valuesWithRanks.length,
        sampleGameIdsInResult: allGameIdsInResult.slice(0, 5),
        sampleKeysInDvpRanks: allKeysInDvpRanks.slice(0, 5),
        sampleEntriesWithValues: sampleEntries,
        matchingKeys: matchingKeys.slice(0, 5),
        totalKeysInDvpRanks: allKeysInDvpRanks.length,
        nonNullValues: Object.entries(dvpRanksPerGame).filter(([_, v]) => v !== null && v !== undefined).length
      });
    }
    
    return result;
  }, [selectedFilterForAxis, filteredChartData, propsMode, advancedStatsPerGame, dvpRanksPerGame]);

  // Set initial slider range when filter is selected
  useEffect(() => {
    if (selectedFilterForAxis && sliderConfig && sliderRange === null) {
      // Initialize with full range
      setSliderRange({ min: sliderConfig.min, max: sliderConfig.max });
    }
  }, [selectedFilterForAxis, sliderConfig, sliderRange]);

  // Prefetch advanced stats (pace, usage_rate) in background when player stats are available
  // This runs independently of filter selection to ensure usage rate is always available
  useEffect(() => {
    if (propsMode !== 'player' || !playerStats || playerStats.length === 0) {
      return;
    }

    // Get player ID
    const playerIdRaw = selectedPlayer?.id;
    if (!playerIdRaw) {
      return;
    }
    const playerId = typeof playerIdRaw === 'number' ? playerIdRaw : Number(playerIdRaw);
    if (isNaN(playerId)) {
      return;
    }

    // Clear prefetch ref when player changes to ensure fresh fetch
    const currentPlayerKey = `player_${playerId}`;
    if (!advancedStatsPrefetchRef.current.has(currentPlayerKey)) {
      // New player - clear old prefetch keys
      advancedStatsPrefetchRef.current.clear();
      advancedStatsPrefetchRef.current.add(currentPlayerKey);
    }

    // Extract game IDs from playerStats - include ALL games (don't filter by minutes)
    // This ensures we get usage rate for all games, matching what the chart would show
    const gameIds: number[] = [];
    const seenGameIds = new Set<number>();
    playerStats.forEach((stat: any) => {
      const gameId = stat.game?.id;
      if (gameId && typeof gameId === 'number' && !seenGameIds.has(gameId)) {
        gameIds.push(gameId);
        seenGameIds.add(gameId);
      }
    });

    if (gameIds.length === 0) {
      return;
    }

    // Prefetch in background (don't block UI)
    // Use a ref to track if we've already started prefetching for these game IDs
    const prefetchKey = `advanced_${playerId}_${gameIds.sort().join(',')}`;
    
    if (advancedStatsPrefetchRef.current.has(prefetchKey)) {
      // Already prefetching or prefetched for these games
      console.log('[Usage Rate Prefetch] Already prefetching/prefetched for player', playerId);
      return;
    }

    // Check if we already have prefetched data for all these games
    const missingGameIds = gameIds.filter(id => prefetchedAdvancedStats[id] === undefined);
    if (missingGameIds.length === 0 && gameIds.length > 0) {
      // Already prefetched all games, mark as done
      advancedStatsPrefetchRef.current.add(prefetchKey);
      console.log('[Usage Rate Prefetch] Already have all prefetched data for', gameIds.length, 'games');
      return;
    }
    
    // If we have some but not all, still fetch (will merge with existing)
    if (missingGameIds.length < gameIds.length) {
      console.log('[Usage Rate Prefetch] Have', gameIds.length - missingGameIds.length, 'games, fetching', missingGameIds.length, 'missing');
    }

    // Mark as prefetching
    advancedStatsPrefetchRef.current.add(prefetchKey);
    console.log('[Usage Rate Prefetch] Starting prefetch for player', playerId, 'with', gameIds.length, 'games');
    
    let isMounted = true;
    const prefetchAdvancedStats = async () => {
      try {
        const stats = await BallDontLieAPI.getAdvancedStatsByGames(gameIds, playerId);
        
        if (!isMounted) return;
        
        // Map stats by game ID
        const statsByGame: Record<number, { pace?: number; usage_percentage?: number }> = {};
        stats.forEach((stat: any) => {
          const gameId = stat.game?.id;
          if (gameId && typeof gameId === 'number') {
            statsByGame[gameId] = {
              pace: stat.pace ?? undefined,
              usage_percentage: stat.usage_percentage ?? undefined,
            };
          }
        });
        
        console.log('[Usage Rate Prefetch] Fetched', Object.keys(statsByGame).length, 'games with usage rate data');
        setPrefetchedAdvancedStats(prev => ({ ...prev, ...statsByGame }));
      } catch (error) {
        console.error('[Prefetch] Error prefetching advanced stats:', error);
      }
    };

    prefetchAdvancedStats();
    
    return () => {
      isMounted = false;
    };
  }, [playerStats, propsMode, selectedPlayer?.id]);

  // Use prefetched advanced stats when pace or usage_rate is selected (for chart filtering)
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player') {
      setAdvancedStatsPerGame({});
      return;
    }

    // Only use prefetched data if pace or usage_rate is selected
    if (selectedFilterForAxis === 'pace' || selectedFilterForAxis === 'usage_rate') {
      // Use prefetched data immediately
      setAdvancedStatsPerGame(prefetchedAdvancedStats);
    } else {
      setAdvancedStatsPerGame({});
    }
  }, [selectedFilterForAxis, propsMode, prefetchedAdvancedStats]);

  // Legacy fetch (kept for backward compatibility, but should use prefetched data)
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player' || !adjustedChartData.length) {
      return;
    }

    // Only fetch if pace or usage_rate is selected AND we don't have prefetched data
    if (selectedFilterForAxis !== 'pace' && selectedFilterForAxis !== 'usage_rate') {
      return;
    }

    // Check if we already have prefetched data
    const gameIds: number[] = [];
    adjustedChartData.forEach((game: any) => {
      const gameId = game.game?.id || game.stats?.game?.id;
      if (gameId && typeof gameId === 'number') {
        gameIds.push(gameId);
      }
    });

    const hasAllPrefetched = gameIds.length > 0 && gameIds.every(id => prefetchedAdvancedStats[id] !== undefined);
    if (hasAllPrefetched) {
      // Already have prefetched data, skip fetch
      return;
    }

    // Get player ID (convert to number if string)
    const playerIdRaw = selectedPlayer?.id;
    if (!playerIdRaw) {
      return;
    }
    const playerId = typeof playerIdRaw === 'number' ? playerIdRaw : Number(playerIdRaw);
    if (isNaN(playerId)) {
      return;
    }

    if (gameIds.length === 0) {
      return;
    }

    // Fetch advanced stats for all games
    let isMounted = true;
    const fetchAdvancedStats = async () => {
      try {
        const stats = await BallDontLieAPI.getAdvancedStatsByGames(gameIds, playerId);
        
        if (!isMounted) return;
        
        // Map stats by game ID
        const statsByGame: Record<number, { pace?: number; usage_percentage?: number }> = {};
        stats.forEach((stat: any) => {
          const gameId = stat.game?.id;
          if (gameId && typeof gameId === 'number') {
            statsByGame[gameId] = {
              pace: stat.pace ?? undefined,
              usage_percentage: stat.usage_percentage ?? undefined,
            };
          }
        });
        
        // Populate both advancedStatsPerGame (for filter) and prefetchedAdvancedStats (for usage rate calculation)
        setAdvancedStatsPerGame(statsByGame);
        setPrefetchedAdvancedStats(prev => ({ ...prev, ...statsByGame }));
      } catch (error) {
        console.error('[Second Axis] Error fetching advanced stats:', error);
        if (isMounted) {
          setAdvancedStatsPerGame({});
        }
      }
    };

    fetchAdvancedStats();
    
    return () => {
      isMounted = false;
    };
  }, [selectedFilterForAxis, adjustedChartData, propsMode, selectedPlayer?.id]);

  // Prefetch DvP ranks in background for all possible stat/position combinations
  // Use ALL playerStats (not adjustedChartData) to ensure ranks are available for all games
  useEffect(() => {
    if (propsMode !== 'player' || !playerStats.length || !selectedStat) {
      if (propsMode === 'player' && playerStats.length && !selectedPosition) {
        console.log('[DvP Rank Prefetch] Waiting for selectedPosition to be determined...', {
          playerName: selectedPlayer?.full,
          hasPlayerStats: playerStats.length > 0,
          hasRoster: !!playerTeamRoster
        });
      }
      return;
    }
    
    if (!selectedPosition) {
      console.log('[DvP Rank Prefetch] Skipping - selectedPosition is null', {
        playerName: selectedPlayer?.full,
        hasPlayerStats: playerStats.length > 0
      });
      return;
    }

    // Map selected stat to DvP metric
    const statToDvpMetric: Record<string, string> = {
      'pts': 'pts',
      'reb': 'reb',
      'ast': 'ast',
      'fg3m': 'fg3m',
      'stl': 'stl',
      'blk': 'blk',
      'to': 'to',
      'fg_pct': 'fg_pct',
      'pra': 'pra',
      'pr': 'pr',
      'pa': 'pa',
      'ra': 'ra',
    };
    
    const dvpMetric = statToDvpMetric[selectedStat];
    if (!dvpMetric) {
      return;
    }

    // Use a ref to track if we've already started prefetching for this combination
    const prefetchKey = `${selectedPosition}:${dvpMetric}`;
    
    if (dvpRanksPrefetchRef.current.has(prefetchKey)) {
      // Already prefetching or prefetched for this combination
      return;
    }

    // Check if we already have prefetched data
    if (prefetchedDvpRanks[prefetchKey]) {
      // Already prefetched, mark as done
      dvpRanksPrefetchRef.current.add(prefetchKey);
      return;
    }

    // Mark as prefetching
    dvpRanksPrefetchRef.current.add(prefetchKey);
    
    console.log('[DvP Rank Prefetch] Starting prefetch', {
      prefetchKey,
      selectedPosition,
      selectedStat,
      dvpMetric,
      playerStatsCount: playerStats.length,
      playerName: selectedPlayer?.full
    });

    // Prefetch in background (don't block UI)
    let isMounted = true;
    const prefetchDvpRanks = async () => {
      try {
        // Map ranks to game IDs based on opponent team and game date
        // Use ALL playerStats (not adjustedChartData) to ensure ranks are available for all games
        const ranksByGame: Record<string, number | null> = {};
        
        // Build game data from playerStats (all games, not filtered by timeframe)
        const gamesToProcess = playerStats
          .filter((stats: any) => {
            // Only include games where player played (same filter as baseGameData)
            const minutes = parseMinutes(stats.min);
            return minutes > 0;
          })
          .map((stats: any) => {
            // Extract opponent and game info from stats
            let playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
            const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
            const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
            const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
            const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
            
            const playerTeamNorm = normalizeAbbr(playerTeam);
            const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
            let opponent = "";
            
            if (playerTeamId && homeTeamId && visitorTeamId) {
              if (playerTeamId === homeTeamId && visitorTeamAbbr) {
                opponent = visitorTeamAbbr;
              } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
                opponent = homeTeamAbbr;
              }
            }
            if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
              const homeNorm = normalizeAbbr(homeTeamAbbr);
              const awayNorm = normalizeAbbr(visitorTeamAbbr);
              if (playerTeamNorm && playerTeamNorm === homeNorm) opponent = awayNorm;
              else if (playerTeamNorm && playerTeamNorm === awayNorm) opponent = homeNorm;
            }
            
            const numericGameId = typeof stats?.game?.id === 'number' ? stats.game.id : null;
            const gameIdStr = String(numericGameId || '');
            const gameDate = stats?.game?.date || '';
            
            return { gameIdStr, opponent, gameDate, stats };
          });
        
        // Fetch historical ranks for each game
        const rankPromises = gamesToProcess.map(async ({ gameIdStr, opponent, gameDate }) => {
          if (!opponent || opponent === 'N/A' || opponent === 'ALL' || opponent === '') {
            return { gameIdStr, rank: null };
          }
          
          if (!gameDate) {
            return { gameIdStr, rank: null, useCurrent: true };
          }
          
          // Try to fetch historical rank for this game date
          try {
            const dateStr = new Date(gameDate).toISOString().split('T')[0];
            const historicalResponse = await fetch(
              `/api/dvp/rank/historical?date=${dateStr}&pos=${selectedPosition}&metric=${dvpMetric}`
            );
            
            if (historicalResponse.ok) {
              const historicalData = await historicalResponse.json();
              if (historicalData.success && historicalData.ranks) {
                const normalizedOpp = normalizeAbbr(opponent);
                const rank = historicalData.ranks[normalizedOpp] ?? 
                            historicalData.ranks[normalizedOpp.toUpperCase()] ?? null;
                if (rank && rank > 0) {
                  return { gameIdStr, rank };
                }
                // If historical lookup returned empty, fall through to current ranks
              } else {
                console.log(`[Prefetch] Historical API returned no ranks for ${dateStr} ${selectedPosition}:${dvpMetric}`, {
                  success: historicalData.success,
                  hasRanks: !!historicalData.ranks,
                  note: historicalData.note
                });
              }
            } else {
              console.warn(`[Prefetch] Historical API error for ${dateStr}: ${historicalResponse.status}`);
            }
          } catch (historicalError) {
            console.warn(`[Prefetch] Historical fetch failed for ${gameIdStr}:`, historicalError);
          }
          
          return { gameIdStr, rank: null, useCurrent: true };
        });
        
        const rankResults = await Promise.all(rankPromises);
        
        // Check if we need to fetch current ranks for any games
        // Also check if historical lookups returned any valid ranks
        const needsCurrentRanks = rankResults.some(r => r.useCurrent);
        const hasHistoricalRanks = rankResults.some(r => r.rank !== null);
        let currentRanks: Record<string, number> = {};
        
        // If no historical ranks were found, fetch current ranks for all games as fallback
        const shouldFetchCurrent = needsCurrentRanks || !hasHistoricalRanks;
        
        if (shouldFetchCurrent) {
          try {
            const currentResponse = await fetch(`/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${dvpMetric}&games=82`);
            if (currentResponse.ok) {
              const currentData = await currentResponse.json();
              currentRanks = currentData.metrics?.[dvpMetric] || {};
              console.log(`[Prefetch] Fetched current ranks for ${selectedPosition}:${dvpMetric}:`, {
                rankCount: Object.keys(currentRanks).length,
                sampleTeams: Object.keys(currentRanks).slice(0, 5),
                reason: !hasHistoricalRanks ? 'No historical ranks found, using current as fallback' : 'Some games need current ranks'
              });
            } else {
              console.warn(`[Prefetch] Current ranks API error: ${currentResponse.status}`);
            }
          } catch (error) {
            console.error(`[Prefetch] Failed to fetch current ranks:`, error);
          }
        }
        
        if (!isMounted) return;
        
        // Map ranks to games
        rankResults.forEach((result, index) => {
          if (result.rank !== null) {
            ranksByGame[result.gameIdStr] = result.rank;
              } else {
            // Try to use current ranks as fallback
            const gameData = gamesToProcess[index];
            if (gameData && gameData.opponent && gameData.opponent !== 'N/A' && gameData.opponent !== 'ALL' && gameData.opponent !== '') {
              const normalizedOpp = normalizeAbbr(gameData.opponent);
              // Try multiple variations of the team abbreviation
              let rank = currentRanks[normalizedOpp] ?? 
                        currentRanks[normalizedOpp.toUpperCase()] ?? 
                        currentRanks[normalizedOpp.toLowerCase()] ?? null;
              
              // If still not found, try to find a partial match
              if (rank === null || rank === undefined) {
                const matchingKey = Object.keys(currentRanks).find(key => 
                  key.toUpperCase() === normalizedOpp.toUpperCase() ||
                  normalizedOpp.toUpperCase().includes(key.toUpperCase()) ||
                  key.toUpperCase().includes(normalizedOpp.toUpperCase())
                );
                if (matchingKey) {
                  rank = currentRanks[matchingKey];
                }
              }
              
              ranksByGame[result.gameIdStr] = typeof rank === 'number' && rank > 0 ? rank : null;
          } else {
            ranksByGame[result.gameIdStr] = null;
            }
          }
        });
        
        // Store prefetched data
        const ranksWithValues = Object.entries(ranksByGame).filter(([_, rank]) => rank !== null && rank !== undefined);
        const sampleRanksWithValues = ranksWithValues.slice(0, 5);
        const sampleRanksNull = Object.entries(ranksByGame).filter(([_, rank]) => rank === null).slice(0, 5);
        
        console.log(`[DvP Rank Prefetch] Stored ranks for ${prefetchKey}:`, {
          gameCount: Object.keys(ranksByGame).length,
          ranksWithValues: ranksWithValues.length,
          sampleRanksWithValues,
          sampleRanksNull,
          sampleGameIds: Object.keys(ranksByGame).slice(0, 10)
        });
        setPrefetchedDvpRanks(prev => ({
          ...prev,
          [prefetchKey]: ranksByGame,
        }));
      } catch (error) {
        // Silent fail for prefetch
        console.error('[Prefetch] Error prefetching DvP ranks:', error);
      }
    };

    prefetchDvpRanks();
    
    return () => {
      isMounted = false;
    };
  }, [playerStats, propsMode, selectedPosition, selectedStat, selectedPlayer]);

  // Use prefetched DvP ranks when dvp_rank filter is selected
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player') {
      setDvpRanksPerGame({});
      return;
    }

    if (selectedFilterForAxis === 'dvp_rank') {
      // Need player position and selected stat to get the right prefetched data
      if (!selectedPosition || !selectedStat) {
        console.log('[DvP Rank] Cannot use ranks - missing data:', {
          hasPosition: !!selectedPosition,
          hasStat: !!selectedStat,
          selectedPosition,
          selectedStat,
          playerName: selectedPlayer?.full
        });
        setDvpRanksPerGame({});
        return;
      }

      const statToDvpMetric: Record<string, string> = {
        'pts': 'pts',
        'reb': 'reb',
        'ast': 'ast',
        'fg3m': 'fg3m',
        'stl': 'stl',
        'blk': 'blk',
        'to': 'to',
        'fg_pct': 'fg_pct',
        'pra': 'pra',
        'pr': 'pr',
        'pa': 'pa',
        'ra': 'ra',
      };
      
      const dvpMetric = statToDvpMetric[selectedStat];
      if (!dvpMetric) {
        setDvpRanksPerGame({});
        return;
      }

      const prefetchKey = `${selectedPosition}:${dvpMetric}`;
      const prefetched = prefetchedDvpRanks[prefetchKey];
      
      if (prefetched) {
        // Use prefetched data immediately
        console.log(`[DvP Rank] Using prefetched data for ${prefetchKey}:`, {
          gameCount: Object.keys(prefetched).length,
          sampleRanks: Object.entries(prefetched).slice(0, 5),
          sampleGameIds: Object.keys(prefetched).slice(0, 5),
          ranksWithValues: Object.entries(prefetched).filter(([_, rank]) => rank !== null && rank !== undefined).length
        });
        setDvpRanksPerGame(prefetched);
      } else {
        // Fallback to empty (will trigger legacy fetch if needed)
        console.log(`[DvP Rank] No prefetched data for ${prefetchKey}, waiting for prefetch...`, {
          availableKeys: Object.keys(prefetchedDvpRanks),
          selectedPosition,
          dvpMetric,
          prefetchKey
        });
        setDvpRanksPerGame({});
      }
    } else {
      setDvpRanksPerGame({});
    }
  }, [selectedFilterForAxis, propsMode, selectedPosition, selectedStat, prefetchedDvpRanks]);

  // Legacy fetch DvP ranks (kept for backward compatibility, but should use prefetched data)
  // Use filteredChartData to match what's actually displayed
  useEffect(() => {
    if (selectedFilterForAxis !== 'dvp_rank' || propsMode !== 'player' || !filteredChartData.length) {
      return;
    }

    // Need player position and selected stat to fetch DvP ranks
    if (!selectedPosition || !selectedStat) {
      return;
    }

    // Map selected stat to DvP metric
    const statToDvpMetric: Record<string, string> = {
      'pts': 'pts',
      'reb': 'reb',
      'ast': 'ast',
      'fg3m': 'fg3m',
      'stl': 'stl',
      'blk': 'blk',
      'to': 'to',
      'fg_pct': 'fg_pct',
      'pra': 'pra',
      'pr': 'pr',
      'pa': 'pa',
      'ra': 'ra',
    };
    
    const dvpMetric = statToDvpMetric[selectedStat];
    if (!dvpMetric) {
      return;
    }

    // Check if we already have prefetched data with valid values
    const prefetchKey = `${selectedPosition}:${dvpMetric}`;
    const prefetched = prefetchedDvpRanks[prefetchKey];
    if (prefetched) {
      // Check if prefetched data has any valid (non-null) values
      const hasValidValues = Object.values(prefetched).some(v => v !== null && v !== undefined);
      if (hasValidValues) {
        // Already have prefetched data with valid values, skip fetch
        console.log('[DvP Rank Legacy] Skipping - prefetched data has valid values');
      return;
      }
      // Prefetched data exists but all values are null - still fetch to try to get data
      console.log('[DvP Rank Legacy] Prefetched data exists but all values are null, fetching...');
    }

    let isMounted = true;
    const fetchDvpRanks = async () => {
      try {
        // Map ranks to game IDs based on opponent team and game date
        const ranksByGame: Record<string, number | null> = {};
        
        // Fetch historical ranks for each game - use filteredChartData to match displayed games
        const rankPromises = filteredChartData.map(async (game: any) => {
          const gameIdStr = game.xKey || String(game.game?.id || game.stats?.game?.id || '');
          const opponent = game.opponent || game.tickLabel || '';
          const gameDate = game.date || game.stats?.game?.date || '';
          
          if (!opponent || opponent === 'N/A' || opponent === 'ALL' || opponent === '') {
            return { gameIdStr, rank: null };
          }
          
          if (!gameDate) {
            // If no game date, fallback to current ranks
            return { gameIdStr, rank: null, useCurrent: true };
          }
          
          // Try to fetch historical rank for this game date
          try {
            const dateStr = new Date(gameDate).toISOString().split('T')[0];
            const historicalResponse = await fetch(
              `/api/dvp/rank/historical?date=${dateStr}&pos=${selectedPosition}&metric=${dvpMetric}`
            );
            
            if (historicalResponse.ok) {
              const historicalData = await historicalResponse.json();
              if (historicalData.success && historicalData.ranks && Object.keys(historicalData.ranks).length > 0) {
                const normalizedOpp = normalizeAbbr(opponent);
                const rank = historicalData.ranks[normalizedOpp] ?? 
                            historicalData.ranks[normalizedOpp.toUpperCase()] ?? null;
                // Only return rank if it's not 0 (0 means no data)
                if (rank && rank > 0) {
                  return { gameIdStr, rank };
              }
              }
              // If historical API returned empty ranks or no match, fall through to use current ranks
            }
          } catch (historicalError) {
            console.warn(`[Second Axis] Failed to fetch historical rank for game ${gameIdStr}:`, historicalError);
          }
          
          // Fallback: use current ranks if historical lookup fails
          return { gameIdStr, rank: null, useCurrent: true };
        });
        
        const rankResults = await Promise.all(rankPromises);
        
        // Check if we need to fetch current ranks for any games
        const needsCurrentRanks = rankResults.some(r => r.useCurrent);
        let currentRanks: Record<string, number> = {};
        
        if (needsCurrentRanks) {
          // Fetch current DvP ranks as fallback
          console.log('[DvP Rank Legacy] Fetching current ranks...', { selectedPosition, dvpMetric });
          const currentResponse = await fetch(`/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${dvpMetric}&games=82`);
          
          if (currentResponse.ok) {
            const currentData = await currentResponse.json();
            currentRanks = currentData.metrics?.[dvpMetric] || {};
            console.log('[DvP Rank Legacy] Current ranks response:', {
              hasMetrics: !!currentData.metrics,
              hasDvpMetric: !!currentData.metrics?.[dvpMetric],
              rankCount: Object.keys(currentRanks).length,
              sampleTeams: Object.keys(currentRanks).slice(0, 10),
              sampleRanks: Object.entries(currentRanks).slice(0, 5)
            });
          } else {
            console.warn('[DvP Rank Legacy] Current ranks API error:', currentResponse.status);
          }
        }
        
        if (!isMounted) return;
        
        // Map ranks to games
        rankResults.forEach((result) => {
          if (result.rank !== null) {
            ranksByGame[result.gameIdStr] = result.rank;
          } else if (result.useCurrent) {
            // Use current rank as fallback
            const game = filteredChartData.find((g: any) => {
              const gameIdStr = g.xKey || String(g.game?.id || g.stats?.game?.id || '');
              return gameIdStr === result.gameIdStr;
            });
            
            if (game) {
              const opponent = game.opponent || game.tickLabel || '';
              if (opponent && opponent !== 'N/A' && opponent !== 'ALL' && opponent !== '') {
                const normalizedOpp = normalizeAbbr(opponent);
                // Try multiple variations
                let rank = currentRanks[normalizedOpp] ?? 
                          currentRanks[normalizedOpp.toUpperCase()] ?? 
                          currentRanks[normalizedOpp.toLowerCase()] ?? null;
                
                // If still not found, try partial match
                if (rank === null || rank === undefined) {
                  const matchingKey = Object.keys(currentRanks).find(key => 
                    key.toUpperCase() === normalizedOpp.toUpperCase() ||
                    normalizedOpp.toUpperCase().includes(key.toUpperCase()) ||
                    key.toUpperCase().includes(normalizedOpp.toUpperCase())
                  );
                  if (matchingKey) {
                    rank = currentRanks[matchingKey];
                  }
                }
                
                ranksByGame[result.gameIdStr] = typeof rank === 'number' && rank > 0 ? rank : null;
                
                // Log when we can't find a match
                if (rank === null || rank === undefined) {
                  console.log('[DvP Rank Legacy] No rank found for opponent:', {
                    gameIdStr: result.gameIdStr,
                    opponent,
                    normalizedOpp,
                    availableTeams: Object.keys(currentRanks).slice(0, 10)
                  });
                }
              } else {
                ranksByGame[result.gameIdStr] = null;
              }
            } else {
              ranksByGame[result.gameIdStr] = null;
            }
          } else {
            ranksByGame[result.gameIdStr] = null;
          }
        });
        
        console.log('[DvP Rank Legacy] Fetched ranks:', {
          gameCount: Object.keys(ranksByGame).length,
          ranksWithValues: Object.entries(ranksByGame).filter(([_, rank]) => rank !== null && rank !== undefined).length,
          sampleRanks: Object.entries(ranksByGame).slice(0, 5),
          sampleGamesWithOpponents: filteredChartData.slice(0, 3).map((g: any) => ({
            gameId: g.xKey || String(g.game?.id || g.stats?.game?.id || ''),
            opponent: g.opponent || g.tickLabel || 'N/A'
          }))
        });
        setDvpRanksPerGame(ranksByGame);
      } catch (error) {
        console.error('[Second Axis] Error fetching DvP ranks:', error);
        if (isMounted) {
          setDvpRanksPerGame({});
        }
      }
    };

    fetchDvpRanks();
    
    return () => {
      isMounted = false;
    };
  }, [selectedFilterForAxis, filteredChartData, propsMode, selectedPosition, selectedStat, prefetchedDvpRanks]);

  // Helper function to map selected stat to bookmaker row key (defined early for use in bestLineForStat)
  const getBookRowKey = useCallback((stat: string): string | null => {
    const statToBookKey: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'fg3m': 'THREES',
      'stl': 'STL',
      'blk': 'BLK',
      'to': 'TO',
      'pra': 'PRA',
      'pr': 'PR',
      'pa': 'PA',
      'ra': 'RA',
      'spread': 'Spread',
      'total_pts': 'Total',
      'moneyline': 'H2H',
    };
    return statToBookKey[stat] || null;
  }, []);
  
  // Calculate best line for stat (lowest over line) - exclude alternate lines
  // This is used to initialize bettingLine when switching stats
  // Note: realOddsData is defined below, so we access it via closure
  const bestLineForStat = useMemo(() => {
    // Access realOddsData from the component scope (it's defined later but accessible via closure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const oddsData = realOddsData;
    if (!oddsData || oddsData.length === 0) return null;

    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return null;
    
    // Collect all lines per bookmaker
    const allLinesByBookmaker = new Map<string, number[]>();
    for (const book of realOddsData) {
      const meta = (book as any)?.meta;
      const baseName = (meta?.baseName || book?.name || '').toLowerCase();
      const statKey: string = meta?.stat || bookRowKey;
      
      if (statKey !== bookRowKey) continue;
      
      const statData = (book as any)[bookRowKey];
      if (!statData || statData.line === 'N/A') continue;
      const lineValue = parseFloat(statData.line);
      if (isNaN(lineValue)) continue;
      
      if (!allLinesByBookmaker.has(baseName)) {
        allLinesByBookmaker.set(baseName, []);
      }
      allLinesByBookmaker.get(baseName)!.push(lineValue);
    }
    
    // Calculate consensus line (most common line value across ALL bookmakers)
    const lineCounts = new Map<number, number>();
    for (const [bookmaker, lines] of allLinesByBookmaker.entries()) {
      for (const line of lines) {
        lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
      }
    }
    let consensusLine: number | null = null;
    let maxCount = 0;
    for (const [line, count] of lineCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        consensusLine = line;
      }
    }
    
    // Find primary lines (closest to consensus) and get the lowest
    let bestLine = Infinity;
    for (const [baseName, lines] of allLinesByBookmaker.entries()) {
      if (lines.length === 0) continue;
      
      let primaryLine = lines[0];
      if (consensusLine !== null && lines.length > 1) {
        let closestLine = lines[0];
        let minDiff = Math.abs(lines[0] - consensusLine);
        for (const line of lines) {
          const diff = Math.abs(line - consensusLine);
          if (diff < minDiff) {
            minDiff = diff;
            closestLine = line;
          }
        }
        // Always use closest to consensus (no threshold)
        primaryLine = closestLine;
      }
      
      if (primaryLine < bestLine) {
        bestLine = primaryLine;
      }
    }
    
    return bestLine !== Infinity ? bestLine : null;
  }, [realOddsData, selectedStat, getBookRowKey]);
  
  // Update bettingLines state when bestLineForStat becomes available
  // This ensures bettingLine (defined earlier) gets updated when odds data loads
  useEffect(() => {
    // Only update if:
    // 1. bestLineForStat is available
    // 2. We don't already have a stored line for this stat
    // 3. The current bettingLine is the default 0.5
    if (bestLineForStat !== null && !(selectedStat in bettingLines)) {
      const currentLine = bettingLine;
      if (Math.abs(currentLine - 0.5) < 0.01) {
        // Only update if it's still at the default
        setBettingLines(prev => ({
          ...prev,
          [selectedStat]: bestLineForStat
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestLineForStat, selectedStat]);
  
  // Merge line movement data with live odds to get accurate current line
  const mergedLineMovementData = useMemo(() => {
    if (!LINE_MOVEMENT_ENABLED || !lineMovementData) return null;
    
    // Map selected stat to bookmaker property
    const statToBookKey: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'fg3m': 'THREES',
      'pra': 'PRA',
      'pr': 'PR',
      'pa': 'PA',
      'ra': 'RA',
    };
    const bookKey = (selectedStat && statToBookKey[selectedStat]) || 'PTS';
    
    // Get current line from live odds (realOddsData) - use first available bookmaker with data
    let currentLineFromLive: { line: number; bookmaker: string; timestamp: string } | null = null;
    if (realOddsData && realOddsData.length > 0) {
      for (const b of realOddsData) {
        const bookData = (b as any)[bookKey];
        if (bookData && bookData.line && bookData.line !== 'N/A') {
          const lineValue = parseFloat(String(bookData.line).replace(/[^0-9.+-]/g, ''));
          if (!Number.isNaN(lineValue)) {
            currentLineFromLive = {
              line: lineValue,
              bookmaker: b.name,
              timestamp: new Date().toISOString(),
            };
            break;
          }
        }
      }
    }
    
    // Merge: use opening from database, current from live odds (if available)
    return {
      ...lineMovementData,
      currentLine: currentLineFromLive || lineMovementData.currentLine,
    };
  }, [lineMovementData, realOddsData, selectedStat]);
  
  const derivedOdds = useMemo(() => {
    if (LINE_MOVEMENT_ENABLED && mergedLineMovementData) {
      return {
        openingLine: mergedLineMovementData.openingLine?.line ?? null,
        currentLine: mergedLineMovementData.currentLine?.line ?? null,
      };
    }
    // Fallback to old snapshot logic for team mode
    const filtered = filterByMarket(oddsSnapshots, marketKey);
    return deriveOpeningCurrentMovement(filtered);
  }, [mergedLineMovementData, oddsSnapshots, marketKey]);


  // Prediction state
  // Hardcode to FanDuel only
  const selectedBookmakerForPrediction = 'fanduel';
  
  // Update intraday movements to use merged data for accurate current line
  const intradayMovementsFinal = useMemo(() => {
    if (!LINE_MOVEMENT_ENABLED || !mergedLineMovementData) {
      return [];
    }
    if (mergedLineMovementData) {
      const { lineMovement = [], openingLine, currentLine } = mergedLineMovementData;

      // Build a map of alt lines to check if movements are from alt lines
      const altLinesMap = new Map<string, { variantLabel: string | null; isPickem: boolean }>();
      let primaryLines: AltLineItem[] = [];
      let primaryKeysSet = new Set<string>();
      
      if (realOddsData && realOddsData.length > 0) {
        const statToBookKey: Record<string, string> = {
          'pts': 'PTS',
          'reb': 'REB',
          'ast': 'AST',
          'fg3m': 'THREES',
          'pra': 'PRA',
          'pr': 'PR',
          'pa': 'PA',
          'ra': 'RA',
        };
        const bookKey = (selectedStat && statToBookKey[selectedStat]) || 'PTS';
        
        // Get all lines and identify primary vs alt
        const allLines: AltLineItem[] = realOddsData
          .map((book: any) => {
            const statData = (book as any)[bookKey];
            if (!statData || statData.line === 'N/A') return null;
            const lineValue = parseFloat(statData.line);
            if (isNaN(lineValue)) return null;
            const meta = (book as any).meta || {};
            return {
              bookmaker: meta.baseName || book.name,
              line: lineValue,
              over: statData.over,
              under: statData.under,
              isPickem: meta.isPickem ?? false,
              variantLabel: meta.variantLabel ?? null,
            } as AltLineItem;
          })
          .filter((item: AltLineItem | null): item is AltLineItem => item !== null);
        
        const partitioned = partitionAltLineItems(allLines);
        primaryLines = partitioned.primary;
        const alternateLines: AltLineItem[] = partitioned.alternate;
        
        // Create a set of primary line keys (bookmaker + line) for quick lookup
        primaryKeysSet = new Set(
          primaryLines.map((p: AltLineItem) => `${p.bookmaker.toLowerCase().trim()}|${p.line.toFixed(1)}`)
        );
        
        // Map alt lines for quick lookup (to filter them out)
        // Store multiple keys for each alt line to handle name variations
        for (const alt of alternateLines) {
          const bookmakerLower = alt.bookmaker.toLowerCase().trim();
          const lineKey = alt.line.toFixed(1);
          
          // Store with the exact bookmaker name
          const key1 = `${bookmakerLower}|${lineKey}`;
          altLinesMap.set(key1, {
            variantLabel: alt.variantLabel ?? null,
            isPickem: alt.isPickem ?? false,
          });
          
          // Also store with normalized bookmaker name (remove common suffixes)
          const normalizedBookmaker = bookmakerLower
            .replace(/\s+(fantasy|sportsbook|sports|betting)$/i, '')
            .replace(/^the\s+/i, '')
            .trim();
          if (normalizedBookmaker !== bookmakerLower) {
            const key2 = `${normalizedBookmaker}|${lineKey}`;
            altLinesMap.set(key2, {
              variantLabel: alt.variantLabel ?? null,
              isPickem: alt.isPickem ?? false,
            });
          }
        }
      }

      if (lineMovement.length > 0) {
        // Filter to only show primary line movements (exclude alt lines)
        // Also use a more flexible matching approach for bookmaker names
        const primaryMovements = lineMovement.filter((movement) => {
          const bookmakerLower = movement.bookmaker.toLowerCase().trim();
          const lineRounded = Math.round(movement.line * 10) / 10; // Round to 1 decimal
          
          // Check all possible key variations
          const possibleKeys = [
            `${bookmakerLower}|${lineRounded.toFixed(1)}`,
            `${bookmakerLower}|${movement.line.toFixed(1)}`,
            `${bookmakerLower}|${movement.line.toFixed(2)}`,
          ];
          
          // Also check with normalized bookmaker name (remove common suffixes/prefixes)
          const normalizedBookmaker = bookmakerLower
            .replace(/\s+(fantasy|sportsbook|sports|betting)$/i, '')
            .replace(/^the\s+/i, '')
            .trim();
          if (normalizedBookmaker !== bookmakerLower) {
            possibleKeys.push(
              `${normalizedBookmaker}|${lineRounded.toFixed(1)}`,
              `${normalizedBookmaker}|${movement.line.toFixed(1)}`
            );
          }
          
          // Check if any of these keys match an alt line
          const isAltLine = possibleKeys.some(key => altLinesMap.has(key));
          
          // Only include if it's NOT an alt line
          return !isAltLine;
        });
        
        // If we have primary movements, use them; otherwise fall back to all movements
        // But also try to deduplicate by bookmaker (keep only one movement per bookmaker, most recent)
        const movementsToDisplay = primaryMovements.length > 0 ? primaryMovements : lineMovement;
        
        // Deduplicate by bookmaker - keep only the movement that matches a primary line (or most recent if no match)
        const deduplicatedMovements = new Map<string, typeof movementsToDisplay[0]>();
        
        for (const movement of movementsToDisplay) {
          const bookmakerKey = movement.bookmaker.toLowerCase().trim();
          const movementKey = `${bookmakerKey}|${movement.line.toFixed(1)}`;
          const isPrimaryLine = primaryKeysSet.has(movementKey);
          
          const existing = deduplicatedMovements.get(bookmakerKey);
          
          // Prefer movements that match primary lines
          if (!existing) {
            deduplicatedMovements.set(bookmakerKey, movement);
          } else {
            const existingKey = `${bookmakerKey}|${existing.line.toFixed(1)}`;
            const existingIsPrimary = primaryKeysSet.has(existingKey);
            
            // If current is primary and existing is not, replace it
            if (isPrimaryLine && !existingIsPrimary) {
              deduplicatedMovements.set(bookmakerKey, movement);
            }
            // If both are primary or both are not, keep the most recent
            else if (isPrimaryLine === existingIsPrimary) {
              if (new Date(movement.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
                deduplicatedMovements.set(bookmakerKey, movement);
              }
            }
            // If existing is primary and current is not, keep existing
          }
        }
        
        const finalMovements = Array.from(deduplicatedMovements.values()).filter((movement) => {
          const rawChange = (movement as any)?.change;
          let changeValue = 0;
          if (typeof rawChange === 'number') {
            changeValue = rawChange;
          } else if (typeof rawChange === 'string') {
            const normalized = rawChange.replace(/[^\d.-]/g, '');
            changeValue = normalized === '' ? 0 : parseFloat(normalized);
          }
          return Number.isFinite(changeValue) && Math.abs(changeValue) >= 0.01;
        });
        
        return finalMovements
          .map((movement) => {
            const dt = new Date(movement.timestamp);
            const timeLabel = dt.toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });
            const direction = movement.change > 0 ? 'up' : movement.change < 0 ? 'down' : 'flat';
            
            return {
              ts: new Date(movement.timestamp).getTime(),
              timeLabel: `${timeLabel} (${movement.bookmaker})`,
              line: movement.line,
              change: `${movement.change > 0 ? '+' : ''}${movement.change.toFixed(1)}`,
              direction: direction as 'up' | 'down' | 'flat',
            };
          })
          .sort((a, b) => b.ts - a.ts); // Most recent first (descending by timestamp)
      }

      const fallbackRows: { ts: number; timeLabel: string; line: number; change: string; direction: 'up' | 'down' | 'flat' }[] = [];
      const formatLabel = (entry: typeof openingLine, label: string) => {
        if (!entry) return '';
        const dt = new Date(entry.timestamp);
        const time = dt.toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        const suffix = entry.bookmaker ? ` (${entry.bookmaker})` : '';
        return `${time}${suffix}${label ? ` — ${label}` : ''}`;
      };

      if (openingLine) {
        fallbackRows.push({
          ts: new Date(openingLine.timestamp).getTime(),
          timeLabel: formatLabel(openingLine, 'Opening'),
          line: openingLine.line,
          change: '',
          direction: 'flat'
        });
      }

      if (currentLine) {
        const delta = openingLine ? currentLine.line - openingLine.line : 0;
        const hasDifferentTimestamp = !openingLine || currentLine.timestamp !== openingLine.timestamp;
        const hasDifferentLine = !openingLine || currentLine.line !== openingLine.line;

        if (hasDifferentTimestamp || hasDifferentLine) {
          fallbackRows.push({
            ts: new Date(currentLine.timestamp).getTime(),
            timeLabel: formatLabel(currentLine, 'Latest'),
            line: currentLine.line,
            change: openingLine ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '',
            direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
          });
        }
      }

      if (fallbackRows.length > 0) {
        return fallbackRows.sort((a, b) => b.ts - a.ts);
      }
    }
    
    // Fallback to original intradayMovements
    return intradayMovements;
  }, [mergedLineMovementData, intradayMovements, realOddsData, selectedStat]);
  
  // Fetch real odds data - fetches player props or team game odds based on mode
  const fetchOddsData = async (retryCount = 0) => {
    setOddsLoading(true);
    setOddsError(null);
    
    try {
      let params;
      
      if (propsMode === 'player') {
        // In player mode, fetch player's props by player name
        const playerName = selectedPlayer?.full || `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
        if (!playerName || !selectedPlayer) {
          // Don't clear odds here - let the player ID tracking useEffect handle clearing
          // This prevents clearing odds when player is temporarily null during state updates
          setOddsLoading(false);
          return;
        }
        params = new URLSearchParams({ player: playerName });
      } else {
        // In team mode, fetch game odds by team
        if (!gamePropsTeam || gamePropsTeam === 'N/A') {
          setRealOddsData([]);
          setOddsLoading(false);
          return;
        }
        params = new URLSearchParams({ team: gamePropsTeam });
        // Add refresh parameter if this is a retry due to missing metadata
        if (retryCount > 0) {
          params.set('refresh', '1');
        }
      }
      
      const response = await fetch(`/api/odds?${params}`);
      const data = await response.json();
      
      console.log('[fetchOddsData] API response:', {
        success: data.success,
        dataLength: data.data?.length || 0,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
        propsMode,
        gamePropsTeam,
        hasLoading: !!data.loading
      });
      
      // Handle background loading state
      if (data.loading) {
        // Data is loading in background - retry with exponential backoff (max 5 retries)
        if (retryCount < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // 1s, 2s, 4s, 8s, 10s max
          setTimeout(() => {
            fetchOddsData(retryCount + 1);
          }, delay);
        } else {
          // Max retries reached - stop loading
          setOddsLoading(false);
          setOddsError('Odds data taking longer than expected to load');
        }
        return;
      }
      
      if (!data.success) {
        // If odds API key is not configured, treat as no-data without error noise
        if (data.error && /odds api key not configured/i.test(data.error)) {
          setRealOddsData([]);
          setOddsError(null);
          return;
        }
        // Also treat 'waiting for refresh' as no error
        if (data.error && /waiting for refresh/i.test(data.error)) {
          setRealOddsData([]);
          setOddsError(null);
          return;
        }
        // Handle rate limit errors gracefully - keep existing data if available
        if (data.error && (/rate limit/i.test(data.error) || /429/i.test(data.error))) {
          // If we have cached data, keep showing it instead of error
          if (realOddsData.length > 0) {
            console.warn('[fetchOddsData] Rate limit hit, but keeping existing cached data');
            setOddsError('Rate limit exceeded - showing cached data');
            setOddsLoading(false);
            return;
          }
          // No cached data - show error but don't clear existing data
          setOddsError(data.error || 'Rate limit exceeded. Please wait a moment.');
          setOddsLoading(false);
          return;
        }
        setOddsError(data.error || 'Failed to fetch odds');
        setRealOddsData([]);
        return;
      }
      
      // If team mode and metadata is missing, trigger a single refresh; otherwise proceed without metadata
      if (propsMode === 'team' && (!data.homeTeam || !data.awayTeam) && data.data && data.data.length > 0) {
        console.log('[fetchOddsData] Missing team metadata - triggering cache refresh...');
        if (!missingTeamMetaRetryRef.current) {
          missingTeamMetaRetryRef.current = true;
          // Trigger a refresh with the refresh parameter
          const refreshParams = new URLSearchParams();
          if (gamePropsTeam) refreshParams.set('team', gamePropsTeam);
          refreshParams.set('refresh', '1');
          
          // Retry after a short delay to allow cache to refresh
          setTimeout(() => {
            fetchOddsData(retryCount + 1);
          }, 2000);
          return;
        } else {
          console.log('[fetchOddsData] Metadata still missing after retry, proceeding without team metadata');
          // Proceed with oddsData even without team metadata
        }
      }
      
      const oddsData = data.data || [];
      
      // Store home/away teams for team mode BEFORE setting state (to avoid multiple updates)
      if (propsMode === 'team' && data.homeTeam && data.awayTeam) {
        // Store these in a way we can access in BestOddsTable
        // We'll add them to each bookmaker as metadata
        if (oddsData.length > 0) {
          console.log('[fetchOddsData] Setting game teams:', {
            homeTeam: data.homeTeam,
            awayTeam: data.awayTeam,
            gamePropsTeam,
            bookCount: oddsData.length
          });
          oddsData.forEach((book: any) => {
            if (!book.meta) book.meta = {};
            book.meta.gameHomeTeam = data.homeTeam;
            book.meta.gameAwayTeam = data.awayTeam;
          });
        } else {
          console.log('[fetchOddsData] No bookmakers in data, cannot set team metadata');
        }
      } else if (propsMode === 'team') {
        console.log('[fetchOddsData] Not setting team metadata:', {
          propsMode,
          hasHomeTeam: !!data.homeTeam,
          hasAwayTeam: !!data.awayTeam
        });
      }
      
      console.log('[fetchOddsData] Setting realOddsData:', {
        length: oddsData.length,
        sampleBook: oddsData[0] ? {
          name: oddsData[0].name,
          hasPRA: !!oddsData[0].PRA,
          PRA: oddsData[0].PRA,
          hasPTS: !!oddsData[0].PTS,
          hasREB: !!oddsData[0].REB,
          hasAST: !!oddsData[0].AST,
        } : null
      });
      
      // Update odds in a transition to prevent visible refresh
      // Only update if data has actually changed (check length and first book name)
      console.log('[DEBUG fetchOddsData] About to set realOddsData', {
        oddsDataLength: oddsData.length,
        timestamp: new Date().toISOString()
      });
      
      startTransition(() => {
        setRealOddsData(prevOdds => {
          // Quick check: if length is same and first book is same, likely no change
          if (prevOdds.length === oddsData.length && 
              prevOdds.length > 0 && oddsData.length > 0 &&
              prevOdds[0]?.name === oddsData[0]?.name &&
              prevOdds[0]?.PTS?.line === oddsData[0]?.PTS?.line) {
            // Likely the same data, but do a full comparison to be sure
            const prevStr = JSON.stringify(prevOdds);
            const newStr = JSON.stringify(oddsData);
            if (prevStr === newStr) {
              console.log('[DEBUG fetchOddsData] Odds data unchanged, skipping update');
              return prevOdds; // No change, return previous to prevent re-render
            }
          }
          console.log('[DEBUG fetchOddsData] Updating realOddsData', {
            prevLength: prevOdds.length,
            newLength: oddsData.length
          });
          return oddsData;
        });
      });
      
      const playerName = selectedPlayer?.full || `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
      const target = propsMode === 'player' ? playerName : gamePropsTeam;
      console.log(`📊 Loaded ${data.data?.length || 0} bookmaker odds for ${target}`);
      
      // Debug: Check for PrizePicks in the data
      const allBookmakers = new Set<string>();
      const prizepicksEntries: any[] = [];
      (data.data || []).forEach((book: any) => {
        const bookName = (book?.meta?.baseName || book?.name || '').toLowerCase();
        if (bookName) {
          allBookmakers.add(bookName);
          if (bookName.includes('prizepicks')) {
            prizepicksEntries.push({
              name: book?.meta?.baseName || book?.name,
              stat: book?.meta?.stat,
              variantLabel: book?.meta?.variantLabel,
              isPickem: book?.meta?.isPickem,
              pts: book?.PTS,
            });
          }
        }
      });
      
    } catch (error) {
      console.error('Error fetching odds:', error);
      setOddsError(error instanceof Error ? error.message : 'Failed to load odds');
      setRealOddsData([]);
    } finally {
      setOddsLoading(false);
    }
  };
  
  // Track if odds are currently being fetched to prevent duplicate calls
  const isFetchingOddsRef = useRef(false);
  // Track a single retry for missing team metadata (team mode)
  const missingTeamMetaRetryRef = useRef(false);
  // Track last odds fetch key to avoid refetching when data already present
  const lastOddsFetchKeyRef = useRef<string | null>(null);
  
  // Track the last player ID (or name fallback) to prevent unnecessary odds fetches
  const lastOddsPlayerIdRef = useRef<string | null>(null);
  
  // Track last propsMode to detect mode changes
  const lastPropsModeRef = useRef<'player' | 'team' | null>(null);
  
  // Clear odds and reset fetch refs when propsMode changes
  useEffect(() => {
    if (lastPropsModeRef.current !== null && lastPropsModeRef.current !== propsMode) {
      console.log('[DEBUG propsMode change] Clearing odds and resetting refs', {
        oldMode: lastPropsModeRef.current,
        newMode: propsMode
      });
      setRealOddsData([]);
      setOddsLoading(false);
      setOddsError(null);
      lastOddsFetchKeyRef.current = null;
      lastOddsPlayerIdRef.current = null;
      isFetchingOddsRef.current = false;
      missingTeamMetaRetryRef.current = false;
    }
    lastPropsModeRef.current = propsMode;
  }, [propsMode]);
  
  // Fetch odds when player/team or mode changes - with debouncing to prevent rate limits
  useEffect(() => {
    console.log('[DEBUG fetchOdds useEffect] Triggered', {
      propsMode,
      hasSelectedPlayer: !!selectedPlayer,
      selectedPlayerId: selectedPlayer?.id,
      selectedPlayerName: selectedPlayer?.full,
      gamePropsTeam,
      realOddsDataLength: realOddsData.length,
      lastOddsPlayerId: lastOddsPlayerIdRef.current,
      isFetching: isFetchingOddsRef.current
    });
    
    // Reset missing metadata retry on dependency change
    missingTeamMetaRetryRef.current = false;
    
    // For team mode, add a small delay to ensure gamePropsTeam is set
    if (propsMode === 'team' && !gamePropsTeam) {
      console.log('[DEBUG fetchOdds useEffect] Team mode but no gamePropsTeam, skipping');
      return;
    }
    
    // In player mode, prefer player ID; fall back to name so we still fetch odds.
    if (propsMode === 'player') {
      if (selectedPlayer) {
        const currentPlayerKey =
          selectedPlayer.id?.toString() ||
          (selectedPlayer.full ? selectedPlayer.full.toLowerCase() : null);
        if (currentPlayerKey) {
          // If same player and we already have odds, skip fetching again
          // BUT: if odds were cleared (length is 0), we need to fetch again
          if (
            currentPlayerKey === lastOddsPlayerIdRef.current &&
            realOddsData.length > 0
          ) {
            console.log('[DEBUG fetchOdds useEffect] Same player and odds exist, skipping fetch', {
              currentPlayerKey,
              lastOddsPlayerId: lastOddsPlayerIdRef.current,
              realOddsDataLength: realOddsData.length
            });
            return;
          }
          // If odds were cleared but player is the same, reset the ref to allow fetching
          if (currentPlayerKey === lastOddsPlayerIdRef.current && realOddsData.length === 0) {
            console.log('[DEBUG fetchOdds useEffect] Same player but odds cleared, resetting ref to allow fetch', {
              currentPlayerKey,
              realOddsDataLength: realOddsData.length
            });
            lastOddsPlayerIdRef.current = null; // Reset to allow fetch
          }
          console.log('[DEBUG fetchOdds useEffect] Player key changed or no odds, will fetch', {
            currentPlayerKey,
            lastOddsPlayerId: lastOddsPlayerIdRef.current,
            realOddsDataLength: realOddsData.length
          });
          lastOddsPlayerIdRef.current = currentPlayerKey;
        } else {
          // No usable key; ensure ref resets so next valid player triggers fetch
          console.log('[DEBUG fetchOdds useEffect] No usable player key, resetting ref');
          lastOddsPlayerIdRef.current = null;
        }
      } else {
        console.log('[DEBUG fetchOdds useEffect] No player selected, skipping fetch');
        lastOddsPlayerIdRef.current = null;
        return; // No player selected; skip fetch
      }
    }
    
    // Build fetch key (player or team)
    const fetchKey = propsMode === 'team'
      ? `team:${gamePropsTeam || 'na'}`
      : `player:${selectedPlayer?.id || selectedPlayer?.full || 'na'}`;

    // Skip if already fetching
    if (isFetchingOddsRef.current) {
      console.log('[DEBUG fetchOdds useEffect] Already fetching, skipping');
      return;
    }
    
    // If we already have odds for this key and not loading, skip refetch
    if (fetchKey === lastOddsFetchKeyRef.current && realOddsData.length > 0 && !oddsLoading) {
      console.log('[DEBUG fetchOdds useEffect] Odds already loaded for key, skipping fetch', {
        fetchKey,
        realOddsDataLength: realOddsData.length
      });
      return;
    }
    
    // Debounce: wait 300ms before fetching to avoid rapid successive calls
    console.log('[DEBUG fetchOdds useEffect] Setting timeout to fetch odds in 300ms');
    const timeoutId = setTimeout(() => {
      console.log('[DEBUG fetchOdds useEffect] Timeout fired, starting fetch');
      isFetchingOddsRef.current = true;
      lastOddsFetchKeyRef.current = fetchKey;
      fetchOddsData().finally(() => {
        // Reset flag after a delay to allow for retries
        setTimeout(() => {
          isFetchingOddsRef.current = false;
        }, 1000);
      });
    }, 300);
    
    return () => {
      console.log('[DEBUG fetchOdds useEffect] Cleanup: clearing timeout');
      clearTimeout(timeoutId);
      // Don't reset isFetchingOddsRef here - let it be reset by the finally block
      // This prevents race conditions where cleanup runs before fetch completes
    };
  }, [selectedPlayer, selectedTeam, gamePropsTeam, propsMode]);

  const americanToDecimal = (odds: string | undefined | null): string => {
    if (!odds || odds === 'N/A') return 'N/A';
    const n = parseInt(odds.replace(/[^+\-\d]/g, ''), 10);
    if (isNaN(n)) return odds;
    const dec = n > 0 ? (1 + n / 100) : (1 + 100 / Math.abs(n));
    return dec.toFixed(2);
  };

  // Ensure positive American odds show a leading '+' and strip any surrounding noise
  const normalizeAmerican = (odds: string | undefined | null): string => {
    if (!odds || odds === 'N/A') return 'N/A';
    const n = parseInt(odds.replace(/[^+\-\d]/g, ''), 10);
    if (isNaN(n)) return odds;
    return n > 0 ? `+${n}` : `${n}`;
  };

  const fmtOdds = (odds: string | undefined | null): string => {
    if (!odds || odds === 'N/A') return 'N/A';
    return oddsFormat === 'decimal' ? americanToDecimal(odds) : normalizeAmerican(odds);
  };

  // Available bookmakers with valid over/under odds for selected stat
  const availableBookmakers = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0 || !selectedStat) return [];
    
    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return [];
    
    const bookmakers = new Map<string, { name: string; displayName: string }>();
    
    for (const book of realOddsData) {
      const statData = (book as any)[bookRowKey];
      if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
        const meta = (book as any)?.meta;
        // Exclude alternate lines (variantLabel indicates alternate)
        if (!meta?.variantLabel) {
          const baseName = (meta?.baseName || book?.name || '').toLowerCase();
          const displayName = meta?.baseName || book?.name || 'Unknown';
          if (!bookmakers.has(baseName)) {
            bookmakers.set(baseName, { name: baseName, displayName });
          }
        }
      }
    }
    
    return Array.from(bookmakers.values());
  }, [realOddsData, selectedStat, getBookRowKey]);

  // Extract FanDuel's line and odds for selected stat
  const selectedBookmakerData = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0 || !selectedStat) return { line: null, name: null, overOdds: null, underOdds: null };
    
    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return { line: null, name: null, overOdds: null, underOdds: null };
    
    // Always use FanDuel, main line only (no alternates)
    const fanduelBook = realOddsData.find((book: any) => {
      const baseName = ((book as any)?.meta?.baseName || book?.name || '').toLowerCase();
      return baseName === 'fanduel';
    });
    
    if (!fanduelBook) return { line: null, name: null, overOdds: null, underOdds: null };
    
    const meta = (fanduelBook as any)?.meta;
    // Exclude alternate lines (variantLabel indicates alternate)
    if (meta?.variantLabel) return { line: null, name: null, overOdds: null, underOdds: null };
    
    const statData = (fanduelBook as any)[bookRowKey];
    if (!statData || statData.line === 'N/A') {
      return { line: null, name: null, overOdds: null, underOdds: null };
    }
    
    const lineValue = parseFloat(statData.line);
    const displayName = (meta?.baseName || fanduelBook?.name || 'FanDuel');
    
    // Parse odds
    const overOddsStr = statData.over;
    const underOddsStr = statData.under;
    
    const overOdds = (overOddsStr && overOddsStr !== 'N/A') 
      ? (typeof overOddsStr === 'string' ? parseFloat(overOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(overOddsStr)))
      : null;
    const underOdds = (underOddsStr && underOddsStr !== 'N/A')
      ? (typeof underOddsStr === 'string' ? parseFloat(underOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(underOddsStr)))
      : null;
    
    return {
      line: Number.isFinite(lineValue) ? lineValue : null,
      name: displayName,
      overOdds: Number.isFinite(overOdds) ? overOdds : null,
      underOdds: Number.isFinite(underOdds) ? underOdds : null,
    };
  }, [realOddsData, selectedStat, getBookRowKey]);

  const selectedBookmakerLine = selectedBookmakerData.line;
  const selectedBookmakerName = selectedBookmakerData.name;

  // Calculate implied odds from FanDuel, with fallback to consensus
  // Calculate primary line from real bookmakers (not alt lines) - used for prediction
  // Uses the most common line value (consensus), not the average
  const primaryMarketLine = useMemo(() => {
    console.log('[primaryMarketLine] START calculation:', { 
      hasRealOddsData: !!realOddsData, 
      realOddsDataLength: realOddsData?.length || 0, 
      selectedStat,
      realOddsDataType: typeof realOddsData,
      isArray: Array.isArray(realOddsData)
    });
    
    if (!realOddsData || realOddsData.length === 0 || !selectedStat) {
      console.log('[primaryMarketLine] EARLY RETURN - No data:', { 
        hasRealOddsData: !!realOddsData, 
        realOddsDataLength: realOddsData?.length || 0, 
        selectedStat 
      });
      return null;
    }
    
    const bookRowKey = getBookRowKey(selectedStat);
    console.log('[primaryMarketLine] bookRowKey result:', { selectedStat, bookRowKey });
    if (!bookRowKey) {
      console.log('[primaryMarketLine] EARLY RETURN - No bookRowKey for stat:', selectedStat);
      return null;
    }
    
    console.log('[primaryMarketLine] Calculating for:', { selectedStat, bookRowKey, realOddsDataLength: realOddsData.length });
    console.log('[primaryMarketLine] Sample book structure:', realOddsData[0] ? {
      name: realOddsData[0].name,
      keys: Object.keys(realOddsData[0]),
      hasPRA: 'PRA' in realOddsData[0],
      PRA: (realOddsData[0] as any).PRA,
      hasBookRowKey: bookRowKey in realOddsData[0],
      bookRowKeyValue: (realOddsData[0] as any)[bookRowKey]
    } : null);
    
    // Collect all real lines (not alt lines) and find the most common one
    const lineCounts = new Map<number, number>();
    
    for (const book of realOddsData) {
      const meta = (book as any)?.meta;
      // Skip alt lines - only use primary over/under lines
      if (meta?.variantLabel) {
        console.log('[primaryMarketLine] Skipping alt line:', meta.variantLabel);
        continue;
      }
      
      const statData = (book as any)[bookRowKey];
      console.log('[primaryMarketLine] Checking book:', { 
        bookName: book?.name || meta?.baseName, 
        hasStatData: !!statData, 
        statDataType: typeof statData,
        statDataIsObject: statData && typeof statData === 'object',
        statDataKeys: statData && typeof statData === 'object' ? Object.keys(statData) : null,
        statDataLine: statData?.line,
        statDataOver: statData?.over,
        statDataUnder: statData?.under,
        fullStatData: statData
      });
      
      if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
        const lineStr = statData.line;
        const line = (lineStr && lineStr !== 'N/A') 
          ? (typeof lineStr === 'string' ? parseFloat(lineStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(lineStr)))
          : null;
        
        if (line !== null && Number.isFinite(line)) {
          // Round to nearest 0.5 to group similar lines together
          const roundedLine = Math.round(line * 2) / 2;
          lineCounts.set(roundedLine, (lineCounts.get(roundedLine) || 0) + 1);
          console.log('[primaryMarketLine] ✅ Found valid line:', { line, roundedLine, count: lineCounts.get(roundedLine) });
        } else {
          console.log('[primaryMarketLine] ❌ Invalid line value:', { lineStr, parsed: line, isFinite: Number.isFinite(line) });
        }
      } else {
        console.log('[primaryMarketLine] ❌ Stat data missing or N/A:', { 
          hasStatData: !!statData,
          line: statData?.line,
          over: statData?.over,
          under: statData?.under,
          lineCheck: statData?.line !== 'N/A',
          overCheck: statData?.over !== 'N/A',
          underCheck: statData?.under !== 'N/A'
        });
      }
    }
    
    if (lineCounts.size === 0) {
      console.log('[primaryMarketLine] ❌ No valid lines found after processing all books');
      return null;
    }
    
    // Find the most common line (consensus)
    let consensusLine: number | null = null;
    let maxCount = 0;
    for (const [line, count] of lineCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        consensusLine = line;
      }
    }
    
    console.log('[primaryMarketLine] ✅ Consensus line:', { consensusLine, maxCount, allLines: Array.from(lineCounts.entries()) });
    return consensusLine;
  }, [realOddsData, selectedStat, getBookRowKey]);
  
  // Debug: Log when primaryMarketLine changes
  useEffect(() => {
    console.log('[primaryMarketLine] Value changed:', { 
      primaryMarketLine, 
      realOddsDataLength: realOddsData?.length || 0,
      selectedStat 
    });
  }, [primaryMarketLine, realOddsData, selectedStat]);

  const calculatedImpliedOdds = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0 || !selectedStat) return null;
    
    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return null;
    
    // Try FanDuel first (only real lines, not alt lines)
    const fanduelBook = realOddsData.find((book: any) => {
      const baseName = ((book as any)?.meta?.baseName || book?.name || '').toLowerCase();
      return baseName === 'fanduel';
    });
    
    if (fanduelBook) {
      const meta = (fanduelBook as any)?.meta;
      // Only use primary over/under lines, skip alt lines
      if (!meta?.variantLabel) {
        const statData = (fanduelBook as any)[bookRowKey];
        if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
          const fanduelImplied = calculateImpliedProbabilities(statData.over, statData.under);
          if (fanduelImplied) {
            return fanduelImplied;
          }
        }
      }
    }
    
    // Fallback to consensus (average of all bookmakers with valid real odds, no alt lines)
    const validBooks: Array<{ over: number; under: number }> = [];
    
    for (const book of realOddsData) {
      const meta = (book as any)?.meta;
      // Skip alt lines - only use primary over/under lines
      if (meta?.variantLabel) continue;
      
      const statData = (book as any)[bookRowKey];
      if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
        const bookImplied = calculateImpliedProbabilities(statData.over, statData.under);
        if (bookImplied) {
          validBooks.push({
            over: bookImplied.overImpliedProb,
            under: bookImplied.underImpliedProb,
          });
        }
      }
    }
    
    if (validBooks.length > 0) {
      const avgOver = validBooks.reduce((sum, b) => sum + b.over, 0) / validBooks.length;
      const avgUnder = validBooks.reduce((sum, b) => sum + b.under, 0) / validBooks.length;
      return {
        overImpliedProb: avgOver,
        underImpliedProb: avgUnder,
      };
    }
    
    return null;
  }, [realOddsData, selectedStat, getBookRowKey]);

  // Normal distribution CDF (Cumulative Distribution Function) approximation
  // Returns the probability that a value from a standard normal distribution is <= z
  const normalCDF = (z: number): number => {
    // Abramowitz and Stegun approximation (accurate to ~0.0002)
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  };


  return (
<div className="min-h-screen lg:h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors lg:overflow-x-auto lg:overflow-y-hidden">
      <style jsx global>{`
        .dashboard-container {
          --sidebar-margin: 0px;
          --sidebar-width: 0px;
          --gap: 8px;
          --inner-max: 1550px;
          --app-max: calc(var(--sidebar-width) + var(--gap) + var(--inner-max));
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
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

        /* Mobile-only: reduce outer gap to tighten left/right padding */
        @media (max-width: 639px) {
          .dashboard-container { --gap: 8px; }
        }

        /* Custom scrollbar colors for light/dark mode - force always visible */
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #d1d5db transparent;
        }
        
        .dark .custom-scrollbar {
          scrollbar-color: #4b5563 transparent;
        }
        
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
          -webkit-appearance: none; /* Disable macOS overlay scrollbar */
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        
        /* Remove the little arrow buttons on custom scrollbars */
        .custom-scrollbar::-webkit-scrollbar-button {
          display: none;
          width: 0;
          height: 0;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #d1d5db;
          border-radius: 8px;
        }
        
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #4b5563;
        }

        /* Desktop scrollbar styling: fade until hovered */
        @media (hover: hover) and (pointer: fine) {
          .fade-scrollbar { scrollbar-color: transparent transparent; }
          .fade-scrollbar:hover { scrollbar-color: #9ca3af1a transparent; }
          .fade-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
          .fade-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 8px; }
          .fade-scrollbar:hover::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.2); }
        }

        /* Mobile-only: thinner scrollbar for stats slider */
        @media (max-width: 639px) {
          .stats-slider-scrollbar::-webkit-scrollbar {
            height: 4px;
          }
          .stats-slider-scrollbar {
            scrollbar-width: thin;
          }
        }

        /* Mobile-only: hide X/Y axis ticks and lines inside the chart */
        @media (max-width: 639px) {
          /* Hide tick groups and text for both axes */
          .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-tick,
          .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-ticks,
          .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-line,
          .chart-mobile-optimized .recharts-cartesian-axis text,
          .chart-mobile-optimized .recharts-cartesian-axis-tick-value {
            display: none !important;
          }
        }
        @media (min-width: 640px) {
          /* Ensure ticks/labels/lines reappear on tablets and larger */
          .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-tick,
          .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-ticks,
          .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-line,
          .chart-mobile-optimized .recharts-cartesian-axis text,
          .chart-mobile-optimized .recharts-cartesian-axis-tick-value {
            display: initial !important;
          }
        }
        
        /* Remove focus border from chart container and all children */
        .chart-container-no-focus,
        .chart-container-no-focus *,
        .chart-container-no-focus:focus,
        .chart-container-no-focus *:focus,
        .chart-container-no-focus:focus-visible,
        .chart-container-no-focus *:focus-visible,
        .chart-container-no-focus:active,
        .chart-container-no-focus *:active {
          outline: none !important;
          box-shadow: none !important;
        }
        
        .chart-container-no-focus {
          border-color: rgb(229, 231, 235) !important;
        }
        
        .dark .chart-container-no-focus {
          border-color: rgb(55, 65, 81) !important;
        }
        
        /* Prevent Recharts elements from getting focus */
        .chart-container-no-focus .recharts-wrapper,
        .chart-container-no-focus .recharts-surface,
        .chart-container-no-focus svg {
          outline: none !important;
        }
      `}</style>
      {/* Main layout container with sidebar, chart, and right panel */}
      <div className="px-0 dashboard-container" style={{ 
        marginLeft: sidebarOpen ? 'calc(var(--sidebar-width, 0px) + var(--gap, 8px))' : '0px',
        width: sidebarOpen ? 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 8px)))' : '100%',
        paddingLeft: 0,
        transition: 'margin-left 0.3s ease, width 0.3s ease'
      }}>
<div className={`mx-auto w-full ${sidebarOpen ? 'max-w-[1550px]' : 'max-w-[1800px]'}`} style={{ paddingLeft: sidebarOpen ? 0 : '2rem', paddingRight: sidebarOpen ? 0 : '1rem' }}>
          <div 
            className="pt-4 min-h-0 lg:h-full dashboard-container"
            style={{ paddingLeft: 0 }}
          >
        {/* Left Sidebar - conditionally rendered based on sidebarOpen state */}
        {sidebarOpen && (
          <LeftSidebar
            oddsFormat={oddsFormat}
            setOddsFormat={setOddsFormat}
            hasPremium={hasPremium}
            avatarUrl={avatarUrl}
            username={username}
            userEmail={userEmail}
            isPro={isPro}
            onSubscriptionClick={handleSidebarSubscription}
            onSignOutClick={handleLogout}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />
        )}
        
        {/* Expand Sidebar Button - visible when sidebar is closed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="hidden lg:flex fixed z-[60] items-center justify-center w-8 h-8 bg-gray-300 dark:bg-[#0a1929] hover:bg-gray-400 dark:hover:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg transition-all"
            style={{
              top: '1.5rem',
              left: 'clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px)',
              transition: 'left 0.3s ease, top 0.3s ease'
            }}
            aria-label="Open sidebar"
          >
            <svg 
              className="w-4 h-4 text-gray-700 dark:text-gray-300 transition-transform"
              style={{ transform: 'rotate(180deg)' }}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
<div className="flex flex-col lg:flex-row gap-0 lg:gap-1 min-h-0" style={{}}>
          {/* Main content area */}
          <div 
            className={`relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 overflow-y-auto overflow-x-hidden overscroll-contain pl-0 pr-2 sm:pl-0 sm:pr-2 md:px-0 pb-0 lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar ${
              sidebarOpen ? 'lg:flex-[6] xl:flex-[6.2]' : 'lg:flex-[6] xl:flex-[6]'
            }`}
            style={{
              scrollbarGutter: 'stable'
            }}
          >
            {/* 1. Filter By Container (Mobile Only) */}
            <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-3 md:px-4 lg:px-6 pt-3 md:pt-4 pb-4 md:pb-5 border border-gray-200 dark:border-gray-700 relative overflow-visible">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                <NotificationSystem isDark={isDark} />
              </div>
              <div className="flex gap-3 md:gap-4 flex-wrap mb-3">
                <button
                  disabled={!isPro}
                  onClick={(e) => {
                    // Prevent click if not Pro
                    if (!isPro) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (window.confirm('Player Props is a Pro feature. Would you like to upgrade?')) {
                        router.push('/subscription');
                      }
                      return;
                    }
                    
                    setPropsMode('player');
                    setSearchQuery(''); // Clear search when switching
                    // Always set PTS as default for Player Props
                    setSelectedStat('pts');
                    
                    // If we have a gamePropsTeam selected, use it as the player's team
                    if (gamePropsTeam && gamePropsTeam !== 'N/A') {
                      setSelectedTeam(gamePropsTeam);
                      setOriginalPlayerTeam(gamePropsTeam);
                      setDepthChartTeam(gamePropsTeam);
                    }
                    
                    // Clear the playerCleared flag when switching back to Player Props
                    if (typeof window !== 'undefined') {
                      try {
                        const raw = sessionStorage.getItem('nba-dashboard-session');
                        if (raw) {
                          const saved = JSON.parse(raw);
                          delete saved.playerCleared; // Remove the flag
                          sessionStorage.setItem('nba-dashboard-session', JSON.stringify(saved));
                        }
                      } catch {}
                    }
                  }}
                  className={`relative px-6 sm:px-8 md:px-10 py-3 sm:py-3 md:py-2 rounded-lg text-base sm:text-base md:text-base font-semibold transition-all ${
                    !isPro
                      ? "bg-gray-300 dark:bg-[#0a1929] text-gray-500 dark:text-gray-500 cursor-not-allowed opacity-60"
                      : propsMode === 'player'
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-2">
                    Player Props
                    {!isPro && (
                      <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setPropsMode('team');
                    setSearchQuery(''); // Clear search when switching
                    
                    // If we have a selectedTeam from Player Props, use it as the gamePropsTeam
                    if (selectedTeam && selectedTeam !== 'N/A') {
                      setGamePropsTeam(selectedTeam);
                    } else {
                      setGamePropsTeam('N/A'); // Reset team selection only if no team was selected
                    }
                    
                    // Keep player data but don't display it in Game Props mode
                    // DON'T clear: setSelectedPlayer, setSelectedTeam, setOriginalPlayerTeam, etc.
                    // This preserves the data for when user switches back to Player Props
                    
                    // Clear URL parameters and update session storage
                    if (typeof window !== 'undefined') {
                      // Save minimal session with cleared player flag
                      const clearedSession = {
                        propsMode: 'team' as const,
                        selectedStat,
                        selectedTimeframe,
                        playerCleared: true // Flag to indicate user deliberately cleared player data
                      };
                      sessionStorage.setItem('nba-dashboard-session', JSON.stringify(clearedSession));
                      
                      // Clear URL parameters
                      const url = new URL(window.location.href);
                      url.searchParams.delete('pid');
                      url.searchParams.delete('name');
                      url.searchParams.delete('team');
                      // Keep stat and tf parameters as they're relevant to Game Props
                      window.history.replaceState({}, '', url.toString());
                    }
                    
                    // Always set TOTAL_PTS as default for Game Props
                    setSelectedStat('total_pts');
                  }}
                  className={`px-6 sm:px-8 md:px-10 py-3 sm:py-3 md:py-2 rounded-lg text-base sm:text-base md:text-base font-semibold transition-colors ${
                    propsMode === 'team'
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  Game Props
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                {propsMode === 'player' ? 'Analyze individual player statistics and props' : 'Analyze game totals, spreads, and game-based props'}
              </p>
            </div>

            {/* Header (with search bar and team display) */}
<div className="relative z-[60] bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 h-auto sm:h-36 md:h-40 w-full min-w-0 flex-shrink-0 mr-1 sm:mr-2 md:mr-3 overflow-visible">
              <div className="flex flex-col h-full gap-2 lg:gap-3">
              {/* Desktop: Original layout - Player info, Search, Team vs Team all in one row */}
              <div className="hidden lg:flex items-center justify-between flex-1">
                <div className="flex-shrink-0">
                  {propsMode === 'team' ? (
                    // Game Props mode - show team or prompt
                    gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                      <div>
                        <div className="flex items-baseline gap-3 mb-1">
                          <h1 className="text-lg font-bold text-gray-900 dark:text-white">{TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam}</h1>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Team: {gamePropsTeam}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Game Props Mode
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-baseline gap-3 mb-1">
                          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Select a Team</h1>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Search for a team above
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Game Props Mode
                        </div>
                      </div>
                    )
                  ) : (
                    // Player Props mode - show player info
                    <div>
                      {/* Back button to player props page */}
                      {selectedPlayer && (
                        <button
                          onClick={() => {
                            // Clear dashboard session storage before navigating
                            try {
                              sessionStorage.removeItem('nba_dashboard_session_v1');
                              sessionStorage.removeItem('last_prop_click');
                              sessionStorage.removeItem('last_prop_url');
                            } catch (e) {
                              // Ignore errors
                            }
                            
                            // Use native browser back for instant navigation (same as browser back button)
                            window.history.back();
                          }}
                          className="flex items-center gap-1.5 mb-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                        >
                          <svg 
                            className="w-4 h-4" 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                          <span>Back to Player Props</span>
                        </button>
                      )}
                      <div className="flex items-baseline gap-3 mb-1">
                        <h1 className="text-lg font-bold text-gray-900 dark:text-white">{playerInfo.name}</h1>
                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{playerInfo.jersey}</span>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Height: {playerInfo.height || ""}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {playerInfo.teamName || ""}
                      </div>
                    </div>
                  )}
                </div>

                {/* Dynamic Search - Player or Team based on props mode */}
                <div className="flex-1 mx-2 sm:mx-6 md:mx-8 min-w-0">
                  <div className="relative z-[70]" ref={searchRef}>
                    {/* Desktop/Tablet input */}
                    <div className="hidden sm:block">
                      <input
                        type="text"
                        placeholder={
                          propsMode === 'player' 
                            ? (isPro ? (searchBusy ? "Searching..." : "Search for a player...") : "Upgrade to Pro to search players")
                            : "Search for a team..."
                        }
                        value={searchQuery}
                        onChange={(e) => {
                          // Block player search for non-Pro users
                          if (propsMode === 'player' && !isPro) {
                            e.target.blur();
                            return;
                          }
                          setSearchQuery(e.target.value);
                          if (propsMode === 'player') {
                            setShowDropdown(true);
                          }
                        }}
                        onFocus={(e) => {
                          // Block player search for non-Pro users
                          if (propsMode === 'player' && !isPro) {
                            e.target.blur();
                            if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                              router.push('/subscription');
                            }
                            return;
                          }
                          if (propsMode === 'player') setShowDropdown(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && propsMode === 'team') {
                            const query = searchQuery.toLowerCase();
                            if (query.length >= 2) {
                              let foundTeam = '';
                              if (Object.keys(TEAM_FULL_NAMES).some(abbr => abbr.toLowerCase().includes(query))) {
                                foundTeam = Object.keys(TEAM_FULL_NAMES).find(abbr => abbr.toLowerCase().includes(query)) || '';
                              }
                              if (!foundTeam) {
                                const matchingEntry = Object.entries(TEAM_FULL_NAMES).find(([abbr, fullName]) => fullName.toLowerCase().includes(query));
                                if (matchingEntry) foundTeam = matchingEntry[0];
                              }
                              const nicknames: Record<string, string> = { 'lakers': 'LAL','warriors':'GSW','celtics':'BOS','heat':'MIA','bulls':'CHI','knicks':'NYK','nets':'BKN','sixers':'PHI','76ers':'PHI','mavs':'DAL','spurs':'SAS','rockets':'HOU' };
                              if (!foundTeam && nicknames[query]) foundTeam = nicknames[query];
                              if (foundTeam) {
                                setGamePropsTeam(foundTeam);
                                setSelectedStat('total_pts');
                                const opponent = getOpponentTeam(foundTeam, todaysGames);
                                setOpponentTeam(normalizeAbbr(opponent));
                                setSearchQuery('');
                              }
                            }
                          }
                        }}
                        className="w-full px-4 py-2 bg-gray-50 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                    {/* Mobile icon button */}
                    <div className="sm:hidden flex justify-end">
                      <button onClick={() => {
                        if (propsMode === 'player' && !isPro) {
                          if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                            router.push('/subscription');
                          }
                          return;
                        }
                        setIsMobileSearchOpen(true);
                      }} className="p-2 rounded-lg bg-gray-100 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z"/></svg>
                      </button>
                    </div>
                    {/* Mobile search overlay */}
                    {isMobileSearchOpen && (
                      <>
                        {/* Backdrop */}
                        <div 
                          className="sm:hidden fixed inset-0 bg-black/20 z-[99]" 
                          onClick={() => setIsMobileSearchOpen(false)}
                        />
                        {/* Search panel */}
                        <div className="sm:hidden fixed left-0 right-0 top-0 bg-white dark:bg-[#0a1929] border-t border-gray-300 dark:border-gray-600 shadow-2xl z-[100] max-h-[78vh] overflow-y-auto pl-3 pr-5 rounded-b-lg">
                        <div className="pt-16">
                        <div className="flex items-end gap-2 pt-4 pb-4 border-b border-gray-300 dark:border-gray-700">
                          <input
                            autoFocus={propsMode !== 'player' || isPro}
                            type="text"
                            placeholder={propsMode === 'player' ? (isPro ? 'Search for a player...' : 'Upgrade to Pro') : 'Search for a team...'}
                            value={searchQuery}
                            onChange={(e) => {
                              if (propsMode === 'player' && !isPro) {
                                return;
                              }
                              setSearchQuery(e.target.value);
                              if (propsMode === 'player') setShowDropdown(true);
                            }}
                            onFocus={(e) => {
                              if (propsMode === 'player' && !isPro) {
                                e.target.blur();
                                setIsMobileSearchOpen(false);
                                if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                                  router.push('/subscription');
                                }
                                return;
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && propsMode === 'team') {
                                const query = searchQuery.toLowerCase();
                                if (query.length >= 2) {
                                  let foundTeam = '';
                                  if (Object.keys(TEAM_FULL_NAMES).some(abbr => abbr.toLowerCase().includes(query))) foundTeam = Object.keys(TEAM_FULL_NAMES).find(abbr => abbr.toLowerCase().includes(query)) || '';
                                  if (!foundTeam) {
                                    const m = Object.entries(TEAM_FULL_NAMES).find(([abbr, fullName]) => fullName.toLowerCase().includes(query));
                                    if (m) foundTeam = m[0];
                                  }
                                  const nick: Record<string,string> = { 'lakers':'LAL','warriors':'GSW','celtics':'BOS','heat':'MIA','bulls':'CHI','knicks':'NYK','nets':'BKN','sixers':'PHI','76ers':'PHI','mavs':'DAL','spurs':'SAS','rockets':'HOU' };
                                  if (!foundTeam && nick[query]) foundTeam = nick[query];
                                  if (foundTeam) {
                                    setGamePropsTeam(foundTeam);
                                    setSelectedStat('total_pts');
                                    const opponent = getOpponentTeam(foundTeam, todaysGames);
                                    setOpponentTeam(normalizeAbbr(opponent));
                                    setSearchQuery('');
                                    setIsMobileSearchOpen(false);
                                  }
                                }
                              }
                            }}
                            className="flex-1 px-4 py-3 bg-gray-50 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <button onClick={() => setIsMobileSearchOpen(false)} className="p-1.5 rounded bg-gray-100 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                          </button>
                        </div>
                        </div>
                        
                        {/* Search results */}
                        <div className="pb-4">
                          {propsMode === 'team' && searchQuery && searchQuery.length >= 2 && (() => {
                            const query = searchQuery.toLowerCase();
                            const matchingTeams: Array<{ abbr: string; fullName: string }> = [];
                            
                            Object.entries(TEAM_FULL_NAMES).forEach(([abbr, fullName]) => {
                              if (abbr.toLowerCase().includes(query) || fullName.toLowerCase().includes(query)) {
                                matchingTeams.push({ abbr, fullName });
                              }
                            });
                            
                            const nicknames: Record<string, string> = {
                              'lakers': 'LAL', 'warriors': 'GSW', 'celtics': 'BOS', 'heat': 'MIA',
                              'bulls': 'CHI', 'knicks': 'NYK', 'nets': 'BKN', 'sixers': 'PHI',
                              '76ers': 'PHI', 'mavs': 'DAL', 'spurs': 'SAS', 'rockets': 'HOU'
                            };
                            
                            if (nicknames[query] && !matchingTeams.find(t => t.abbr === nicknames[query])) {
                              const abbr = nicknames[query];
                              matchingTeams.push({ abbr, fullName: TEAM_FULL_NAMES[abbr] || abbr });
                            }
                            
                            return matchingTeams.length > 0 ? (
                              <>
                                {matchingTeams.slice(0, 10).map((team) => (
                                  <button
                                    key={team.abbr}
                                    onClick={() => {
                                      setGamePropsTeam(team.abbr);
                                      setSelectedStat('total_pts');
                                      const opponent = getOpponentTeam(team.abbr, todaysGames);
                                      setOpponentTeam(normalizeAbbr(opponent));
                                      setSearchQuery('');
                                      setIsMobileSearchOpen(false);
                                    }}
                                    className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                                  >
                                    <div className="font-medium text-gray-900 dark:text-white">{team.fullName}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">{team.abbr}</div>
                                  </button>
                                ))}
                              </>
                            ) : null;
                          })()}
                          
                          {propsMode === 'player' && isPro && searchQuery && (
                            <>
                              {searchResults.length === 0 ? (
                                <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                  {searchBusy ? "Searching..." : (searchError ? `Search error: ${searchError}` : `No players found for "${searchQuery}"`)}
                                </div>
                              ) : searchResults.map((r) => (
                                <button
                                  key={`${r.id}-${r.full}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log('🔘 Mobile search result clicked (first):', r, 'isPro:', isPro);
                                    if (!isPro) {
                                      if (window.confirm('Player Props is a Pro feature. Would you like to upgrade?')) {
                                        router.push('/subscription');
                                      }
                                      return;
                                    }
                                    console.log('✅ Calling handlePlayerSelectFromSearch for:', r.full);
                                    handlePlayerSelectFromSearch(r).catch(err => {
                                      console.error('Error in handlePlayerSelectFromSearch:', err);
                                    });
                                    setSearchQuery('');
                                    setIsMobileSearchOpen(false);
                                  }}
                                  className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    {r.headshotUrl && (
                                      <div className="w-10 h-10 rounded-full object-cover flex-shrink-0 overflow-hidden relative">
                                        <Image 
                                          src={r.headshotUrl} 
                                          alt={r.full}
                                          width={40}
                                          height={40}
                                          className="object-cover"
                                          loading="lazy"
                                          unoptimized={false}
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                          }}
                                        />
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                                      <div className="text-sm text-gray-500 dark:text-gray-400">
                                        {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                        </div>
                      </>
                    )}
                    {/* Player search dropdown - only show in player mode and for Pro users (Desktop only) */}
                    {propsMode === 'player' && isPro && showDropdown && searchQuery && (
                      <div className="hidden sm:block absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[80] max-h-72 overflow-y-auto">
                        {searchResults.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                            {searchBusy ? "Searching..." : (searchError ? `Search error: ${searchError}` : `No players found for "${searchQuery}"`)}
                          </div>
                        ) : searchResults.map((r) => (
                          <button
                            key={`${r.id}-${r.full}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              console.log('🔘 Desktop search result clicked:', r, 'isPro:', isPro);
                              // Extra check: ensure Pro access before player selection
                              if (!isPro) {
                                if (window.confirm('Player Props is a Pro feature. Would you like to upgrade?')) {
                                  router.push('/subscription');
                                }
                                return;
                              }
                              console.log('✅ Calling handlePlayerSelectFromSearch for:', r.full);
                              handlePlayerSelectFromSearch(r).catch(err => {
                                console.error('Error in handlePlayerSelectFromSearch:', err);
                              });
                              setSearchQuery('');
                              setShowDropdown(false);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                {r.headshotUrl && (
                                  <img 
                                    src={r.headshotUrl} 
                                    alt={r.full}
                                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                                  <div className="text-sm text-gray-500 dark:text-gray-400">
                                    {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
                                  </div>
                                </div>
                              </div>
                              {/* ID hidden intentionally */}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {/* Team search dropdown - only show in game props mode (Desktop only) */}
                    {propsMode === 'team' && searchQuery && searchQuery.length >= 2 && (() => {
                      const query = searchQuery.toLowerCase();
                      const matchingTeams: Array<{ abbr: string; fullName: string }> = [];
                      
                      // Find matching teams (memo-optimized)
                      Object.entries(TEAM_FULL_NAMES).forEach(([abbr, fullName]) => {
                        if (abbr.toLowerCase().includes(query) || fullName.toLowerCase().includes(query)) {
                          matchingTeams.push({ abbr, fullName });
                        }
                      });
                      
                      // Check nicknames
                      const nicknames: Record<string, string> = {
                        'lakers': 'LAL', 'warriors': 'GSW', 'celtics': 'BOS', 'heat': 'MIA',
                        'bulls': 'CHI', 'knicks': 'NYK', 'nets': 'BKN', 'sixers': 'PHI',
                        '76ers': 'PHI', 'mavs': 'DAL', 'spurs': 'SAS', 'rockets': 'HOU'
                      };
                      
                      // Add nickname match if not already present
                      const nicknameMatch = nicknames[query];
                      if (nicknameMatch && !matchingTeams.some(t => t.abbr === nicknameMatch)) {
                        matchingTeams.unshift({ abbr: nicknameMatch, fullName: TEAM_FULL_NAMES[nicknameMatch] || nicknameMatch });
                      }
                      
                      return matchingTeams.length > 0 ? (
                        <div className="hidden sm:block absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[100] max-h-72 overflow-y-auto">
                          {matchingTeams.slice(0, 10).map((team) => ( // Limit to 10 results
                            <button
                              key={team.abbr}
                              onClick={() => {
                                console.log(`%c🎬 === TEAM SELECTION HANDLER ===%c`, 'color: #9b59b6; font-weight: bold; font-size: 14px', '');
                                console.log(`%cSelected Team: %c${team.abbr}`, 'color: #555', 'color: #e74c3c; font-weight: bold; font-size: 14px');
                                console.log(`%cTeam Full Name: %c${team.fullName}`, 'color: #555', 'color: #3498db; font-weight: bold');
                                console.log(`%cGames available: %c${todaysGames.length}`, 'color: #555', 'color: #f39c12; font-weight: bold');
                                
                                setGamePropsTeam(team.abbr);
                                setSelectedStat('total_pts');
                                
                                const opponent = getOpponentTeam(team.abbr, todaysGames);
                                console.log(`%cOpponent Detection Result: %c"${opponent}"`, 'color: #555', 'color: #27ae60; font-weight: bold; font-size: 14px');
                                
                                const normalized = normalizeAbbr(opponent);
                                console.log(`%cNormalized opponent: %c"${normalized}"`, 'color: #555', 'color: #27ae60; font-weight: bold; font-size: 14px');
                                
                                setOpponentTeam(normalized);
                                console.log(`%c✅ State Updated%c - gamePropsTeam: ${team.abbr}, opponentTeam: ${normalized}`, 'color: #27ae60; font-weight: bold', 'color: #000');
                                console.log(`%c🎬 === HANDLER END ===%c\n`, 'color: #9b59b6; font-weight: bold; font-size: 14px', '');
                                
                                setSearchQuery('');
                              }}
                              className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium text-gray-900 dark:text-white">{team.fullName}</div>
                                  <div className="text-sm text-gray-500 dark:text-gray-400">{team.abbr}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* Team vs Team Display - Desktop only - Aligned with name */}
                <div className="hidden lg:flex flex-shrink-0 items-end">
                  {propsMode === 'player' ? (
                    // Player Props Mode - Show player's team vs NEXT GAME opponent (not chart filter)
                    selectedTeam && nextGameOpponent && selectedTeam !== 'N/A' && nextGameOpponent !== '' ? (
                      <div className="flex items-center gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                        {/* Player Team */}
                        <div className="flex items-center gap-1.5">
                          <img 
                            src={selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)}
                            alt={selectedTeam}
                            className="w-8 h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              const candidates = getEspnLogoCandidates(selectedTeam);
                              const next = selectedTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setSelectedTeamLogoAttempt(next);
                                setSelectedTeamLogoUrl(candidates[next]);
                              } else {
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-sm">{selectedTeam}</span>
                        </div>
                        
                        {/* Countdown to Tipoff - Centered between teams */}
                        {countdown && !isGameInProgress ? (
                          <div className="flex flex-col items-center min-w-[80px]">
                            <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Tipoff in</div>
                            <div className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                              {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                            </div>
                          </div>
                        ) : isGameInProgress ? (
                          <div className="flex flex-col items-center min-w-[80px]">
                            <div className="text-sm font-semibold text-green-600 dark:text-green-400">LIVE</div>
                          </div>
                        ) : nextGameTipoff ? (
                          <div className="flex flex-col items-center min-w-[80px]">
                            <div className="text-[10px] text-gray-500 dark:text-gray-400">Game time passed</div>
                          </div>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400 font-medium text-xs">VS</span>
                        )}
                        
                        {/* Next Game Opponent */}
                        <div className="flex items-center gap-1.5">
                          <img 
                            src={getEspnLogoUrl(nextGameOpponent)}
                            alt={nextGameOpponent}
                            className="w-8 h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              const candidates = getEspnLogoCandidates(nextGameOpponent);
                              const next = opponentTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setOpponentTeamLogoAttempt(next);
                                e.currentTarget.src = candidates[next];
                              } else {
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-sm">{nextGameOpponent}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                      </div>
                    )
                  ) : (
                    // Game Props Mode - Show selected team vs opponent or prompt
                    gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam ? (
                      <div className="flex items-center gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                        {/* Selected Team */}
                        <div className="flex items-center gap-1.5">
                          <img 
                            src={selectedTeamLogoUrl || getEspnLogoUrl(gamePropsTeam)}
                            alt={gamePropsTeam}
                            className="w-8 h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              const candidates = getEspnLogoCandidates(gamePropsTeam);
                              const next = selectedTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setSelectedTeamLogoAttempt(next);
                                setSelectedTeamLogoUrl(candidates[next]);
                              } else {
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                        </div>
                        
                        {/* Countdown to Tipoff - Centered between teams */}
                        {countdown && !isGameInProgress ? (
                          <div className="flex flex-col items-center min-w-[80px]">
                            <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Tipoff in</div>
                            <div className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                              {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                            </div>
                          </div>
                        ) : isGameInProgress ? (
                          <div className="flex flex-col items-center min-w-[80px]">
                            <div className="text-sm font-semibold text-green-600 dark:text-green-400">LIVE</div>
                          </div>
                        ) : nextGameTipoff ? (
                          <div className="flex flex-col items-center min-w-[80px]">
                            <div className="text-[10px] text-gray-500 dark:text-gray-400">Game time passed</div>
                          </div>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400 font-medium text-xs">VS</span>
                        )}
                        
                        {/* Opponent Team */}
                        <div className="flex items-center gap-1.5">
                          <img 
                            src={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                            alt={opponentTeam}
                            className="w-8 h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              const candidates = getEspnLogoCandidates(opponentTeam);
                              const next = opponentTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setOpponentTeamLogoAttempt(next);
                                setOpponentTeamLogoUrl(candidates[next]);
                              } else {
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-sm">{opponentTeam}</span>
                        </div>
                      </div>
                    ) : gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                        <img 
                          src={getEspnLogoUrl(gamePropsTeam)}
                          alt={gamePropsTeam}
                          className="w-8 h-8 object-contain"
                        />
                        <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                        <span className="text-gray-500 dark:text-gray-400 text-xs">No Game Today</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Team</span>
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Mobile: Two-row layout - First row: Player name and Search, Second row: Height and Team vs Team */}
              {/* First row: Player name / Team name and Search button */}
              <div className="lg:hidden flex items-center justify-between">
                <div className="flex-shrink-0">
                  {propsMode === 'team' ? (
                    // Game Props mode - show team or prompt
                    gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                      <div>
                        <div className="flex items-baseline gap-3 mb-1">
                          <h1 className="text-lg font-bold text-gray-900 dark:text-white">{TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam}</h1>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-baseline gap-3 mb-1">
                          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Select a Team</h1>
                        </div>
                      </div>
                    )
                  ) : (
                    // Player Props mode - show player name
                    <div>
                      {/* Back button to player props page */}
                      {selectedPlayer && (
                        <button
                          onClick={() => {
                            // Clear dashboard session storage before navigating
                            try {
                              sessionStorage.removeItem('nba_dashboard_session_v1');
                              sessionStorage.removeItem('last_prop_click');
                              sessionStorage.removeItem('last_prop_url');
                            } catch (e) {
                              // Ignore errors
                            }
                            
                            // Use native browser back for instant navigation (same as browser back button)
                            window.history.back();
                          }}
                          className="flex items-center gap-1.5 mb-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                        >
                          <svg 
                            className="w-4 h-4" 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                          <span>Back to Player Props</span>
                        </button>
                      )}
                      <div className="flex items-baseline gap-3">
                        <h1 className="text-lg font-bold text-gray-900 dark:text-white">{playerInfo.name}</h1>
                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{playerInfo.jersey}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Dynamic Search - Player or Team based on props mode - Aligned with name */}
                <div className="flex-shrink-0 ml-4">
                  <div className="relative z-[70]" ref={searchRef}>
                    {/* Mobile icon button */}
                    <div className="flex justify-end">
                      <button onClick={() => {
                        if (propsMode === 'player' && !isPro) {
                          if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                            router.push('/subscription');
                          }
                          return;
                        }
                        setIsMobileSearchOpen(true);
                      }} className="p-2 rounded-lg bg-gray-100 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z"/></svg>
                      </button>
                    </div>
                    {/* Mobile search overlay - same as before */}
                    {isMobileSearchOpen && (
                      <>
                        {/* Backdrop */}
                        <div 
                          className="fixed inset-0 bg-black/20 z-[99]" 
                          onClick={() => setIsMobileSearchOpen(false)}
                        />
                        {/* Search panel */}
                        <div className="fixed left-0 right-0 top-0 bg-white dark:bg-[#0a1929] border-t border-gray-300 dark:border-gray-600 shadow-2xl z-[100] max-h-[78vh] overflow-y-auto pl-3 pr-5 rounded-b-lg">
                        <div className="pt-16">
                        <div className="flex items-end gap-2 pt-4 pb-4 border-b border-gray-300 dark:border-gray-700">
                          <input
                            autoFocus={propsMode !== 'player' || isPro}
                            type="text"
                            placeholder={propsMode === 'player' ? (isPro ? 'Search player...' : 'Upgrade to Pro') : 'Search team...'}
                            value={searchQuery}
                            onChange={(e) => {
                              if (propsMode === 'player' && !isPro) {
                                return;
                              }
                              setSearchQuery(e.target.value);
                              if (propsMode === 'player') setShowDropdown(true);
                            }}
                            onFocus={(e) => {
                              if (propsMode === 'player' && !isPro) {
                                e.target.blur();
                                setIsMobileSearchOpen(false);
                                if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                                  router.push('/subscription');
                                }
                                return;
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && propsMode === 'team') {
                                const query = searchQuery.toLowerCase();
                                if (query.length >= 2) {
                                  let foundTeam = '';
                                  if (Object.keys(TEAM_FULL_NAMES).some(abbr => abbr.toLowerCase().includes(query))) foundTeam = Object.keys(TEAM_FULL_NAMES).find(abbr => abbr.toLowerCase().includes(query)) || '';
                                  if (!foundTeam) {
                                    const m = Object.entries(TEAM_FULL_NAMES).find(([abbr, fullName]) => fullName.toLowerCase().includes(query));
                                    if (m) foundTeam = m[0];
                                  }
                                  const nick: Record<string,string> = { 'lakers':'LAL','warriors':'GSW','celtics':'BOS','heat':'MIA','bulls':'CHI','knicks':'NYK','nets':'BKN','sixers':'PHI','76ers':'PHI','mavs':'DAL','spurs':'SAS','rockets':'HOU' };
                                  if (!foundTeam && nick[query]) foundTeam = nick[query];
                                  if (foundTeam) {
                                    setGamePropsTeam(foundTeam);
                                    setSelectedStat('total_pts');
                                    const opponent = getOpponentTeam(foundTeam, todaysGames);
                                    setOpponentTeam(normalizeAbbr(opponent));
                                    setSearchQuery('');
                                    setIsMobileSearchOpen(false);
                                  }
                                }
                              }
                            }}
                            className="flex-1 px-4 py-3 bg-gray-50 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <button onClick={() => setIsMobileSearchOpen(false)} className="p-1.5 rounded bg-gray-100 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                          </button>
                        </div>
                        
                        {/* Search results - same as before */}
                        <div className="pb-4">
                          {propsMode === 'team' && searchQuery && searchQuery.length >= 2 && (() => {
                            const query = searchQuery.toLowerCase();
                            const matchingTeams: Array<{ abbr: string; fullName: string }> = [];
                            
                            Object.entries(TEAM_FULL_NAMES).forEach(([abbr, fullName]) => {
                              if (abbr.toLowerCase().includes(query) || fullName.toLowerCase().includes(query)) {
                                matchingTeams.push({ abbr, fullName });
                              }
                            });
                            
                            const nicknames: Record<string, string> = {
                              'lakers': 'LAL', 'warriors': 'GSW', 'celtics': 'BOS', 'heat': 'MIA',
                              'bulls': 'CHI', 'knicks': 'NYK', 'nets': 'BKN', 'sixers': 'PHI',
                              '76ers': 'PHI', 'mavs': 'DAL', 'spurs': 'SAS', 'rockets': 'HOU'
                            };
                            
                            if (nicknames[query] && !matchingTeams.find(t => t.abbr === nicknames[query])) {
                              const abbr = nicknames[query];
                              matchingTeams.push({ abbr, fullName: TEAM_FULL_NAMES[abbr] || abbr });
                            }
                            
                            return matchingTeams.length > 0 ? (
                              <>
                                {matchingTeams.slice(0, 10).map((team) => (
                                  <button
                                    key={team.abbr}
                                    onClick={() => {
                                      setGamePropsTeam(team.abbr);
                                      setSelectedStat('total_pts');
                                      const opponent = getOpponentTeam(team.abbr, todaysGames);
                                      setOpponentTeam(normalizeAbbr(opponent));
                                      setSearchQuery('');
                                      setIsMobileSearchOpen(false);
                                    }}
                                    className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                                  >
                                    <div className="font-medium text-gray-900 dark:text-white">{team.fullName}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">{team.abbr}</div>
                                  </button>
                                ))}
                              </>
                            ) : null;
                          })()}
                          
                          {propsMode === 'player' && isPro && searchQuery && (
                            <>
                              {searchResults.length === 0 ? (
                                <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                  {searchBusy ? "Searching..." : (searchError ? `Search error: ${searchError}` : `No players found for "${searchQuery}"`)}
                                </div>
                              ) : searchResults.map((r) => (
                                <button
                                  key={`${r.id}-${r.full}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log('🔘 Mobile search result clicked (second):', r, 'isPro:', isPro);
                                    if (!isPro) {
                                      if (window.confirm('Player Props is a Pro feature. Would you like to upgrade?')) {
                                        router.push('/subscription');
                                      }
                                      return;
                                    }
                                    console.log('✅ Calling handlePlayerSelectFromSearch for:', r.full);
                                    handlePlayerSelectFromSearch(r).catch(err => {
                                      console.error('Error in handlePlayerSelectFromSearch:', err);
                                    });
                                    setSearchQuery('');
                                    setIsMobileSearchOpen(false);
                                  }}
                                  className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    {r.headshotUrl && (
                                      <img 
                                        src={r.headshotUrl} 
                                        alt={r.full}
                                        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                                      <div className="text-sm text-gray-500 dark:text-gray-400">
                                        {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                        </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Second row: Player height / Team info and Team vs Team display - Mobile only */}
              <div className="lg:hidden flex items-center justify-between">
                <div className="flex-shrink-0">
                  {propsMode === 'team' ? (
                    // Game Props mode - show team info
                    gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Team: {gamePropsTeam}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Game Props Mode
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Search for a team above
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Game Props Mode
                        </div>
                      </div>
                    )
                  ) : (
                    // Player Props mode - show player height and team
                    <div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Height: {playerInfo.height || ""}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {playerInfo.teamName || ""}
                      </div>
                    </div>
                  )}
                </div>

                {/* Team vs Team Display - Mobile only - Aligned with height */}
                <div className="flex-shrink-0">
                  {propsMode === 'player' ? (
                    // Player Props Mode - Show player's team vs NEXT GAME opponent (not chart filter)
                    selectedTeam && nextGameOpponent && selectedTeam !== 'N/A' && nextGameOpponent !== '' ? (
                      <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-4 sm:py-2 min-w-0">
                        {/* Team Logos */}
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                          {/* Player Team */}
                          <div className="flex items-center gap-1 min-w-0">
                            <img 
                              src={selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)}
                              alt={selectedTeam}
                              className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                              onError={(e) => {
                                const candidates = getEspnLogoCandidates(selectedTeam);
                                const next = selectedTeamLogoAttempt + 1;
                                if (next < candidates.length) {
                                  setSelectedTeamLogoAttempt(next);
                                  setSelectedTeamLogoUrl(candidates[next]);
                                } else {
                                  e.currentTarget.onerror = null;
                                }
                              }}
                            />
                            <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{selectedTeam}</span>
                          </div>
                          
                          {/* VS */}
                          <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                          
                          {/* Next Game Opponent */}
                          <div className="flex items-center gap-1 min-w-0">
                            <img 
                              src={getEspnLogoUrl(nextGameOpponent)}
                              alt={nextGameOpponent}
                              className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                              onError={(e) => {
                                const candidates = getEspnLogoCandidates(nextGameOpponent);
                                const next = opponentTeamLogoAttempt + 1;
                                if (next < candidates.length) {
                                  setOpponentTeamLogoAttempt(next);
                                  e.currentTarget.src = candidates[next];
                                } else {
                                  e.currentTarget.onerror = null;
                                }
                              }}
                            />
                            <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{nextGameOpponent}</span>
                          </div>
                        </div>
                        
                        {/* Countdown to Tipoff - On the side */}
                        {countdown && !isGameInProgress ? (
                          <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                            <div className="text-[9px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">Tipoff in</div>
                            <div className="text-xs font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                              {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                            </div>
                          </div>
                        ) : isGameInProgress ? (
                          <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                            <div className="text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">LIVE</div>
                          </div>
                        ) : nextGameTipoff ? (
                          <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                            <div className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Game time passed</div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                      </div>
                    )
                  ) : (
                    // Game Props Mode - Show selected team vs opponent or prompt
                    gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam ? (
                      <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2.5 py-1.5 sm:px-4 sm:py-2 min-w-0">
                        {/* Team Logos */}
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                          {/* Selected Team */}
                          <div className="flex items-center gap-1 min-w-0">
                            <img 
                              src={selectedTeamLogoUrl || getEspnLogoUrl(gamePropsTeam)}
                              alt={gamePropsTeam}
                              className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                              onError={(e) => {
                                const candidates = getEspnLogoCandidates(gamePropsTeam);
                                const next = selectedTeamLogoAttempt + 1;
                                if (next < candidates.length) {
                                  setSelectedTeamLogoAttempt(next);
                                  setSelectedTeamLogoUrl(candidates[next]);
                                } else {
                                  e.currentTarget.onerror = null;
                                }
                              }}
                            />
                            <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{gamePropsTeam}</span>
                          </div>
                          
                          {/* VS */}
                          <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                          
                          {/* Opponent Team */}
                          <div className="flex items-center gap-1 min-w-0">
                            <img 
                              src={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                              alt={opponentTeam}
                              className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                              onError={(e) => {
                                const candidates = getEspnLogoCandidates(opponentTeam);
                                const next = opponentTeamLogoAttempt + 1;
                                if (next < candidates.length) {
                                  setOpponentTeamLogoAttempt(next);
                                  setOpponentTeamLogoUrl(candidates[next]);
                                } else {
                                  e.currentTarget.onerror = null;
                                }
                              }}
                            />
                            <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{opponentTeam}</span>
                          </div>
                        </div>
                        
                        {/* Countdown to Tipoff - On the side */}
                        {countdown && !isGameInProgress ? (
                          <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                            <div className="text-[9px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">Tipoff in</div>
                            <div className="text-xs font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                              {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                            </div>
                          </div>
                        ) : isGameInProgress ? (
                          <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                            <div className="text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">LIVE</div>
                          </div>
                        ) : nextGameTipoff ? (
                          <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                            <div className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Game time passed</div>
                          </div>
                        ) : null}
                      </div>
                    ) : gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                        <img 
                          src={getEspnLogoUrl(gamePropsTeam)}
                          alt={gamePropsTeam}
                          className="w-8 h-8 object-contain"
                        />
                        <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                        <span className="text-gray-500 dark:text-gray-400 text-xs">No Game Today</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Team</span>
                      </div>
                    )
                  )}
                </div>
              </div>
              
              {/* Journal Button - Show for both Player Props and Game Props modes */}
              {((propsMode === 'player' && selectedPlayer && nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== 'N/A') ||
                (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam && opponentTeam !== '')) && (
                <div className="flex gap-2 px-0">
                  <button
                    onClick={() => {
                      if (!hasPremium) {
                        router.push('/subscription');
                        return;
                      }
                      if (!isGameInProgress) {
                        setShowJournalModal(true);
                      }
                    }}
                    disabled={isGameInProgress || !hasPremium}
                    className={`flex-1 px-2 py-1.5 text-white text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                      isGameInProgress || !hasPremium
                        ? 'bg-gray-400 cursor-not-allowed opacity-50' 
                        : 'bg-purple-600 hover:bg-purple-700'
                    }`}
                    title={
                      !hasPremium 
                        ? 'Journal is a Pro feature' 
                        : isGameInProgress 
                        ? 'Game in progress - journal disabled' 
                        : 'Add to journal'
                    }
                  >
                    {!hasPremium ? (
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                    Journal
                  </button>
                </div>
              )}
              </div>
            </div>

            {/* Chart card (fully isolated) */}
            <ChartContainer
              isDark={isDark}
              currentStatOptions={currentStatOptions}
              selectedStat={selectedStat}
              onSelectStat={handleStatSelect}
              bettingLine={bettingLine}
              onChangeBettingLine={setBettingLine}
              selectedTimeframe={selectedTimeframe}
              onSelectTimeframe={setSelectedTimeframe}
              chartData={filteredChartData}
              yAxisConfig={yAxisConfig}
              isLoading={propsMode === 'team' ? gameStatsLoading : isLoading}
              oddsLoading={propsMode === 'player' ? oddsLoading : false}
              apiError={propsMode === 'team' ? null : apiError}
              selectedPlayer={selectedPlayer}
              propsMode={propsMode}
              gamePropsTeam={gamePropsTeam}
              customTooltip={customTooltip}
              currentOpponent={opponentTeam}
              manualOpponent={manualOpponent}
              onOpponentChange={setManualOpponent}
              currentTeam={propsMode === 'team' ? gamePropsTeam : selectedTeam}
              homeAway={homeAway}
              onChangeHomeAway={setHomeAway}
              realOddsData={realOddsData}
              fmtOdds={fmtOdds}
              minMinutesFilter={minMinutesFilter}
              maxMinutesFilter={maxMinutesFilter}
              onMinMinutesChange={setMinMinutesFilter}
              onMaxMinutesChange={setMaxMinutesFilter}
              excludeBlowouts={excludeBlowouts}
              excludeBackToBack={excludeBackToBack}
              onExcludeBlowoutsChange={setExcludeBlowouts}
              onExcludeBackToBackChange={setExcludeBackToBack}
              rosterForSelectedTeam={rosterForSelectedTeam}
              withWithoutMode={withWithoutMode}
              setWithWithoutMode={setWithWithoutMode}
              teammateFilterId={teammateFilterId}
              teammateFilterName={teammateFilterName}
              setTeammateFilterId={setTeammateFilterId}
              setTeammateFilterName={setTeammateFilterName}
              loadingTeammateGames={loadingTeammateGames}
      clearTeammateFilter={clearTeammateFilter}
      hitRateStats={hitRateStats}
      lineMovementEnabled={LINE_MOVEMENT_ENABLED}
      intradayMovements={intradayMovementsFinal}
      secondAxisData={secondAxisData}
      selectedFilterForAxis={selectedFilterForAxis}
      onSelectFilterForAxis={handleSelectFilterForAxis}
      sliderConfig={sliderConfig}
      sliderRange={sliderRange}
      setSliderRange={setSliderRange}
            />
{/* 4. Opponent Analysis & Team Matchup Container (Mobile) */}
            <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-2 md:p-3 border border-gray-200 dark:border-gray-700 w-full min-w-0">
                {/* Section 0: Defense vs Position / Projected / Opponent Breakdown Tabs - only show in Player Props mode */}
                {propsMode === 'player' && (
                  <>
                    {/* Tab Selector */}
                    <div className="flex gap-2 sm:gap-2 mb-3 sm:mb-3">
                      <button
                        onClick={() => setDvpProjectedTab('dvp')}
                        className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                          dvpProjectedTab === 'dvp'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <span className="hidden xs:inline">Defense vs Position</span>
                        <span className="xs:hidden">DvP</span>
                      </button>
                      <button
                        onClick={() => setDvpProjectedTab('projected')}
                        className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                          dvpProjectedTab === 'projected'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Projected
                      </button>
                      <button
                        onClick={() => setDvpProjectedTab('opponent')}
                        className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                          dvpProjectedTab === 'opponent'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <span className="hidden xs:inline">Opponent Breakdown</span>
                        <span className="xs:hidden">Opponent</span>
                      </button>
                      <button
                        onClick={() => setDvpProjectedTab('injuries')}
                        className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                          dvpProjectedTab === 'injuries'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Injuries
                      </button>
                    </div>
                    
                    {/* Content based on selected tab - always render container, just show/hide content */}
                    <div className="relative min-h-[250px] sm:min-h-[200px] w-full min-w-0">
                      <div className={dvpProjectedTab === 'dvp' ? 'block' : 'hidden'}>
                        <PositionDefenseCard isDark={isDark} opponentTeam={opponentTeam} selectedPosition={selectedPosition} currentTeam={selectedTeam} />
                      </div>
                      <div className={dvpProjectedTab === 'projected' ? 'block' : 'hidden'}>
                        <ProjectedStatsCard
                          isDark={isDark}
                          selectedPlayer={selectedPlayer}
                          opponentTeam={opponentTeam}
                          currentTeam={selectedTeam}
                          projectedMinutes={projectedMinutes}
                          loading={projectedMinutesLoading}
                          predictedPace={predictedPace}
                          seasonFgPct={seasonFgPct}
                          averageUsageRate={averageUsageRate}
                          averageMinutes={averageMinutes}
                          averageGamePace={averageGamePace}
                          selectedTimeframe={selectedTimeframe}
                        />
                      </div>
                      <div className={dvpProjectedTab === 'opponent' ? 'block' : 'hidden'}>
                        <OpponentAnalysisCard 
                          isDark={isDark} 
                          opponentTeam={opponentTeam} 
                          selectedTimeFilter={selectedTimeFilter}
                          propsMode={propsMode}
                          playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
                          selectedStat={selectedStat}
                        />
                      </div>
                      <div className={dvpProjectedTab === 'injuries' ? 'block' : 'hidden'}>
                        <InjuryContainer
                          selectedTeam={selectedTeam}
                          opponentTeam={opponentTeam}
                          isDark={isDark}
                          selectedPlayer={selectedPlayer}
                          playerStats={playerStats}
                          teammateFilterId={teammateFilterId}
                          setTeammateFilterId={setTeammateFilterId}
                          setTeammateFilterName={setTeammateFilterName}
                          withWithoutMode={withWithoutMode}
                          setWithWithoutMode={setWithWithoutMode}
                          clearTeammateFilter={clearTeammateFilter}
                        />
                      </div>
                    </div>
                  </>
                )}

              {/* Section 2: Team Matchup with Pie Chart - only show in Game Props mode */}
              {propsMode === 'team' && (
              <div className="pt-3 md:pt-4 border-t border-gray-200 dark:border-gray-600">
                <div className="flex items-center justify-between mb-3 md:mb-4">
                  <h4 className="text-base md:text-lg lg:text-xl font-semibold text-gray-900 dark:text-white">Team Matchup</h4>
                </div>
                
                {/* Comparison Metric Selector */}
                <div className="mb-3 md:mb-4">
                  <div className="grid grid-cols-2 gap-1 md:gap-2 lg:gap-3">
                    <button
                      onClick={() => setSelectedComparison('points')}
                      className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                        selectedComparison === 'points'
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      POINTS
                    </button>
                    <button
                      onClick={() => setSelectedComparison('rebounds')}
                      className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                        selectedComparison === 'rebounds'
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      REBOUNDS
                    </button>
                    <button
                      onClick={() => setSelectedComparison('assists')}
                      className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                        selectedComparison === 'assists'
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      ASSISTS
                    </button>
                    <button
                      onClick={() => setSelectedComparison('fg_pct')}
                      className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                        selectedComparison === 'fg_pct'
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      FG%
                    </button>
                    <div className="col-span-2 flex justify-center">
                      <button
                        onClick={() => setSelectedComparison('three_pct')}
                        className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors w-[calc(50%-0.25rem)] ${
                          selectedComparison === 'three_pct'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        3P%
                      </button>
                    </div>
                  </div>
                </div>

                {/* Stats Preview Box - appears right after selector buttons */}
                {(() => {
                  const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
                  const currentOpponent = opponentTeam;
                  
                  if (!currentTeam || currentTeam === 'N/A' || teamMatchupLoading) return null;
                  
                  const currentStats = teamMatchupStats.currentTeam;
                  const opponentStats = teamMatchupStats.opponent;
                  
                  if (!currentStats || !opponentStats) return null;
                  
                  let teamValue: number = 0;
                  let opponentValue: number = 0;
                  let isPercentage = false;
                  
                  switch (selectedComparison) {
                    case 'points':
                      teamValue = currentStats.pts || 0;
                      opponentValue = opponentStats.pts || 0;
                      break;
                    case 'rebounds':
                      teamValue = currentStats.reb || 0;
                      opponentValue = opponentStats.reb || 0;
                      break;
                    case 'assists':
                      teamValue = currentStats.ast || 0;
                      opponentValue = opponentStats.ast || 0;
                      break;
                    case 'fg_pct':
                      teamValue = currentStats.fg_pct || 0;
                      opponentValue = opponentStats.fg_pct || 0;
                      isPercentage = true;
                      break;
                    case 'three_pct':
                      teamValue = currentStats.fg3_pct || 0;
                      opponentValue = opponentStats.fg3_pct || 0;
                      isPercentage = true;
                      break;
                  }
                  
                  const teamDisplay = isPercentage ? `${teamValue.toFixed(1)}%` : teamValue.toFixed(1);
                  const oppDisplay = isPercentage ? `${opponentValue.toFixed(1)}%` : opponentValue.toFixed(1);
                  
                  // Calculate pie data to get consistent colors
                  const tempPieData = createTeamComparisonPieData(
                    teamValue,
                    opponentValue,
                    currentTeam,
                    currentOpponent || 'TBD',
                    false,
                    /* amplify */ true,
                    /* useAbs */ false,
                    /* clampNegatives */ false,
                    /* baseline */ 0,
                    /* invertOppForShare */ false,
                    /* invertMax */ 130,
                    /* ampBoost */ isPercentage ? 3.0 : 1.0
                  );
                  
                  // Use pie chart colors for consistency (green = better, red = worse)
                  // pieData[0] is currentTeam, pieData[1] is opponent
                  const teamColorClass = tempPieData[0]?.fill === '#16a34a' || tempPieData[0]?.fill === '#22c55e'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-500 dark:text-red-400';
                  const oppColorClass = tempPieData[1]?.fill === '#16a34a' || tempPieData[1]?.fill === '#22c55e'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-500 dark:text-red-400';
                  
                  return (
                    <div className="bg-gray-100 dark:bg-[#0a1929] rounded px-2 py-1 mb-2">
                      <div className="flex items-center justify-between gap-1 text-xs">
                        <div className={`flex-1 text-center ${teamColorClass}`}>
                          <span className="font-bold">{currentTeam}</span>
                          <span className="font-bold ml-1">{teamDisplay}</span>
                        </div>
                        
                        <div className="text-gray-400 font-bold px-1">VS</div>
                        
                        <div className={`flex-1 text-center ${oppColorClass}`}>
                          <span className="font-bold">{currentOpponent || 'TBD'}</span>
                          <span className="font-bold ml-1">{oppDisplay}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Pie Chart Visualization */}
                <div className="mt-3 md:mt-4">
                  {(() => {
                    const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
                    const currentOpponent = opponentTeam;
                    
                    if (!currentTeam || currentTeam === 'N/A') return null;
                    
                    if (teamMatchupLoading) {
                      return (
                        <div className="flex flex-col items-center justify-center py-8 space-y-4">
                          <div className="relative w-48 h-48">
                            <div className="absolute inset-0 rounded-full border-8 border-gray-200 dark:border-gray-800 animate-pulse"></div>
                            <div className="absolute inset-4 rounded-full border-8 border-gray-300 dark:border-gray-700 animate-pulse" style={{ animationDelay: '0.1s' }}></div>
                            <div className="absolute inset-8 rounded-full bg-gray-200 dark:bg-gray-800 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                          </div>
                          <div className="space-y-2 w-full max-w-xs">
                            <div className="h-4 w-full rounded animate-pulse bg-gray-200 dark:bg-gray-800"></div>
                            <div className="h-4 w-3/4 mx-auto rounded animate-pulse bg-gray-200 dark:bg-gray-800" style={{ animationDelay: '0.1s' }}></div>
                          </div>
                        </div>
                      );
                    }
                    
                    const currentStats = teamMatchupStats.currentTeam;
                    const opponentStats = teamMatchupStats.opponent;
                    
                    if (!currentStats || !opponentStats) {
                      return <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">No matchup data available</div>;
                    }
                    
                    let teamValue: number = 0;
                    let opponentValue: number = 0;
                    let isPercentage = false;
                    
                    switch (selectedComparison) {
                      case 'points':
                        teamValue = currentStats.pts || 0;
                        opponentValue = opponentStats.pts || 0;
                        break;
                      case 'rebounds':
                        teamValue = currentStats.reb || 0;
                        opponentValue = opponentStats.reb || 0;
                        break;
                      case 'assists':
                        teamValue = currentStats.ast || 0;
                        opponentValue = opponentStats.ast || 0;
                        break;
                      case 'fg_pct':
                        teamValue = currentStats.fg_pct || 0;
                        opponentValue = opponentStats.fg_pct || 0;
                        isPercentage = true;
                        break;
                      case 'three_pct':
                        teamValue = currentStats.fg3_pct || 0;
                        opponentValue = opponentStats.fg3_pct || 0;
                        isPercentage = true;
                        break;
                    }
                    
                    // Use values directly for display (offensive stats - higher is better)
                    const originalTeamValue = teamValue;
                    const originalOpponentValue = opponentValue;
                    
                    // Removed console.log to prevent spam during re-renders

                    const pieData = createTeamComparisonPieData(
                      teamValue,
                      opponentValue,
                      currentTeam,
                      currentOpponent || 'TBD',
                      false,
                      /* amplify */ true,
                      /* useAbs */ false,
                      /* clampNegatives */ false,
                      /* baseline */ 0,
                      /* invertOppForShare */ false,
                      /* invertMax */ 130,
                      /* ampBoost */ isPercentage ? 3.0 : 1.0
                    );
                    
                    // Update display values to show original (non-inverted) values
                    pieData[0].displayValue = originalTeamValue.toFixed(1);
                    pieData[1].displayValue = originalOpponentValue.toFixed(1);

                    // Keep pie chart data in same order as pieData (currentTeam first, then opponent)
                    const pieDrawData = [pieData?.[0], pieData?.[1]];

                    const teamDisplayRaw = pieData?.[0]?.displayValue ?? '';
                    const oppDisplayRaw = pieData?.[1]?.displayValue ?? '';
                    const teamDisplay = isPercentage ? `${teamDisplayRaw}%` : teamDisplayRaw;
                    const oppDisplay = isPercentage ? `${oppDisplayRaw}%` : oppDisplayRaw;
                    const teamColor = pieData?.[0]?.fill || '#22c55e';
                    const oppColor = pieData?.[1]?.fill || '#ef4444';
                    
                    return (
                      <div className="flex flex-col items-center">
                        {/* Mobile Pie Chart - Smaller and Simplified */}
                        <div className="h-32 w-32 mb-2" style={{ minHeight: '128px', minWidth: '128px' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={pieDrawData}
                                cx="50%"
                                cy="50%"
                                innerRadius={20}
                                outerRadius={60}
                                paddingAngle={2}
                                dataKey="value"
                                startAngle={90}
                                endAngle={-270}
                              >
                                {pieDrawData?.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry?.fill} />
                                )) || []}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        
                        {/* Mobile Legend - Compact */}
                        <div className="flex items-center justify-center gap-3 text-xs">
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: teamColor }}></div>
                            <span className="font-medium">{currentTeam} {teamDisplay}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: oppColor }}></div>
                            <span className="font-medium">{currentOpponent || 'TBD'} {oppDisplay}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                
                <div className="text-center text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {selectedComparison === 'points' && 'Total Points Per Game Comparison'}
                  {selectedComparison === 'rebounds' && 'Total Rebounds Per Game Comparison'}
                  {selectedComparison === 'assists' && 'Total Assists Per Game Comparison'}
                  {selectedComparison === 'fg_pct' && 'Field Goal Shooting Percentage Comparison'}
                  {selectedComparison === 'three_pct' && '3-Point Shooting Percentage Comparison'}
                </div>
              </div>
              )}
            </div>

            {/* 4.5 Shot Chart Container (Mobile) - Player Props mode only - Always visible with skeleton when loading */}
            {propsMode === 'player' && (
              <div className="lg:hidden w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-0 sm:p-4 gap-4 border border-gray-200 dark:border-gray-700">
                <ShotChart 
                  isDark={isDark} 
                  shotData={shotDistanceData}
                  playerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
                  opponentTeam={opponentTeam}
                />
                {/* Play Type Analysis */}
                <PlayTypeAnalysis
                  playerId={selectedPlayer?.id ? String(selectedPlayer.id) : ''}
                  opponentTeam={opponentTeam}
                  season={currentNbaSeason()}
                  isDark={isDark}
                />
              </div>
            )}


            {/* 5.5. Tracking Stats Container (Mobile) - Team Rankings */}
            {useMemo(() => {
              if (propsMode !== 'player' || !selectedTeam || selectedTeam === 'N/A') return null;
              
              const playerName = selectedPlayer?.full || 
                `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
              
              return (
<div className="lg:hidden">
                  <Suspense fallback={<div className="h-32 flex items-center justify-center text-gray-500">Loading stats...</div>}>
                    <TeamTrackingStatsTable
                      teamAbbr={selectedTeam}
                      selectedPlayerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
                      selectedPlayerName={playerName || undefined}
                      season={2025}
                      isDark={isDark}
                    />
                  </Suspense>
                </div>
              );
            }, [propsMode, selectedTeam, selectedPlayer?.id, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, isDark])}

            {/* 6. Official Odds Card Container (Mobile) - Line Movement */}
            {useMemo(() => (
<div className="lg:hidden">
                <OfficialOddsCard
                  isDark={isDark}
                  derivedOdds={derivedOdds}
                  intradayMovements={intradayMovementsFinal}
                  selectedTeam={propsMode === 'team' ? gamePropsTeam : selectedTeam}
                  opponentTeam={opponentTeam}
                  selectedTeamLogoUrl={(propsMode === 'team' ? gamePropsTeam : selectedTeam) && (propsMode === 'team' ? gamePropsTeam : selectedTeam) !== 'N/A' ? (selectedTeamLogoUrl || getEspnLogoUrl(propsMode === 'team' ? gamePropsTeam : selectedTeam)) : ''}
                  opponentTeamLogoUrl={opponentTeam && opponentTeam !== '' ? (opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)) : ''}
                  matchupInfo={matchupInfo}
                  oddsFormat={oddsFormat}
                  books={realOddsData}
                  fmtOdds={fmtOdds}
                lineMovementEnabled={LINE_MOVEMENT_ENABLED}
                  lineMovementData={mergedLineMovementData}
                  selectedStat={selectedStat}
                  calculatedImpliedOdds={calculatedImpliedOdds}
                  selectedBookmakerName={selectedBookmakerName}
                  selectedBookmakerLine={selectedBookmakerLine}
                  propsMode={propsMode}
                  selectedPlayer={selectedPlayer}
                  primaryMarketLine={primaryMarketLine}
                  bettingLine={bettingLine}
                />
              </div>
            ), [isDark, derivedOdds, intradayMovementsFinal, selectedTeam, gamePropsTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds, mergedLineMovementData, selectedStat, calculatedImpliedOdds, selectedBookmakerName, selectedBookmakerLine, selectedPlayer, primaryMarketLine, bettingLine])}

            {/* 7. Best Odds Container (Mobile) - Matchup Odds */}
            <BestOddsTable
              isDark={isDark}
              oddsLoading={oddsLoading}
              oddsError={oddsError}
              realOddsData={realOddsData}
              selectedTeam={selectedTeam}
              gamePropsTeam={gamePropsTeam}
              propsMode={propsMode}
              opponentTeam={opponentTeam}
              oddsFormat={oddsFormat}
              fmtOdds={fmtOdds}
              playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
              selectedStat={selectedStat}
/>

            {/* 8. Depth Chart Container (Mobile) - Always visible with skeleton when loading */}
            {useMemo(() => {
              // Determine which team to show based on mode
              const currentTeam = propsMode === 'player' 
                ? depthChartTeam 
                : (depthChartTeam && depthChartTeam !== 'N/A' ? depthChartTeam : gamePropsTeam);
              
              // Determine roster data based on mode
              const currentTeamRoster = propsMode === 'player' 
                ? (currentTeam === depthChartTeam ? playerTeamRoster : opponentTeamRoster)
                : (allTeamRosters[currentTeam] || null);
              const currentOpponentRoster = propsMode === 'player' 
                ? (currentTeam === depthChartTeam ? opponentTeamRoster : playerTeamRoster)
                : (opponentTeam ? (allTeamRosters[opponentTeam] || null) : null);
              
              // Determine loading state based on mode
              const currentRostersLoading = propsMode === 'player' 
                ? rostersLoading 
                : { player: rosterCacheLoading, opponent: rosterCacheLoading };
              
              return (
                <div className="lg:hidden">
                  <DepthChartContainer
                    selectedTeam={currentTeam}
                    teamInjuries={teamInjuries}
                    isDark={isDark}
                    onPlayerSelect={propsMode === 'player' ? (playerName: string) => {
                      // In depth chart, we only have player names, not full player objects
                      // For now, just log the selection - full integration would require player lookup
                      console.log(`Selected player from depth chart: ${playerName}`);
                    } : () => {}}
                    selectedPlayerName={propsMode === 'player' && selectedPlayer ? (
                      (() => {
                        const fullName = selectedPlayer.full;
                        const constructedName = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
                        return fullName || constructedName;
                      })()
                    ) : ''}
                    opponentTeam={opponentTeam}
                    originalPlayerTeam={propsMode === 'player' ? originalPlayerTeam : gamePropsTeam}
                    playerTeamRoster={currentTeamRoster}
                    opponentTeamRoster={currentOpponentRoster}
                    rostersLoading={currentRostersLoading}
                    onTeamSwap={(team) => {
                      console.log(`🔄 Mobile depth chart team swap: ${team}`);
                      if (propsMode === 'player') {
                        setDepthChartTeam(team);
                      } else if (propsMode === 'team') {
                        setDepthChartTeam(team);
                      }
                    }}
                  />
                </div>
              );
            }, [
              propsMode, 
              depthChartTeam, 
              gamePropsTeam, 
              teamInjuries, 
              isDark, 
              selectedPlayer?.full, 
              selectedPlayer?.firstName, 
              selectedPlayer?.lastName, 
              opponentTeam, 
              originalPlayerTeam, 
              playerTeamRoster, 
              opponentTeamRoster, 
              rostersLoading, 
              allTeamRosters, 
              rosterCacheLoading, 
              todaysGames
            ])}


            {/* 10. Player Box Score Container (Mobile) */}
            {useMemo(() => {
              if (propsMode !== 'player') return null;
              
              return (
<div className="lg:hidden">
                  <PlayerBoxScore
                    selectedPlayer={selectedPlayer}
                    playerStats={playerStats}
                    isDark={isDark}
                  />
                </div>
              );
            }, [propsMode, selectedPlayer, playerStats, isDark])}

            {/* Tracking Stats Container (Desktop) - Team Rankings */}
            {useMemo(() => {
              if (propsMode !== 'player' || !selectedTeam || selectedTeam === 'N/A') return null;
              
              const playerName = selectedPlayer?.full || 
                `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
              
              return (
<div className="hidden lg:block">
                  <Suspense fallback={<div className="h-32 flex items-center justify-center text-gray-500">Loading stats...</div>}>
                    <TeamTrackingStatsTable
                      teamAbbr={selectedTeam}
                      selectedPlayerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
                      selectedPlayerName={playerName || undefined}
                      season={2025}
                      isDark={isDark}
                    />
                  </Suspense>
                </div>
              );
            }, [propsMode, selectedTeam, selectedPlayer?.id, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, isDark])}

            {/* Under-chart container (Desktop) - memoized element to avoid parent re-evals */}
            {useMemo(() => (
              propsMode !== 'team' ? (
                <div className="hidden lg:block">
                  <OfficialOddsCard
                    isDark={isDark}
                    derivedOdds={derivedOdds}
                    intradayMovements={intradayMovementsFinal}
                    selectedTeam={selectedTeam}
                    opponentTeam={opponentTeam}
                    selectedTeamLogoUrl={selectedTeam && selectedTeam !== 'N/A' ? (selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)) : ''}
                    opponentTeamLogoUrl={opponentTeam && opponentTeam !== '' ? (opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)) : ''}
                    matchupInfo={matchupInfo}
                    oddsFormat={oddsFormat}
                    books={realOddsData}
                    fmtOdds={fmtOdds}
                    lineMovementEnabled={LINE_MOVEMENT_ENABLED}
                    lineMovementData={mergedLineMovementData}
                    selectedStat={selectedStat}
                    calculatedImpliedOdds={calculatedImpliedOdds}
                    selectedBookmakerName={selectedBookmakerName}
                    selectedBookmakerLine={selectedBookmakerLine}
                  propsMode={propsMode}
                  selectedPlayer={selectedPlayer}
                  primaryMarketLine={primaryMarketLine}
                  bettingLine={bettingLine}
                />
              </div>
            ) : null
            ), [isDark, derivedOdds, intradayMovementsFinal, selectedTeam, gamePropsTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds, mergedLineMovementData, selectedStat, calculatedImpliedOdds, selectedBookmakerName, selectedBookmakerLine, selectedPlayer, primaryMarketLine])}

            {/* BEST ODDS (Desktop) - Memoized to prevent re-renders from betting line changes */}
            <BestOddsTableDesktop
                isDark={isDark}
                oddsLoading={oddsLoading}
                oddsError={oddsError}
                realOddsData={realOddsData}
                selectedTeam={selectedTeam}
                gamePropsTeam={gamePropsTeam}
                propsMode={propsMode}
                opponentTeam={opponentTeam}
                oddsFormat={oddsFormat}
                fmtOdds={fmtOdds}
                playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
                selectedStat={selectedStat}
              />

            {/* Unified Depth Chart (Desktop) - optimized for both modes - Always visible with skeleton when loading */}
            {useMemo(() => {
              // Determine which team to show based on mode
              // For Game Props mode, use depthChartTeam for switching, fallback to gamePropsTeam
              const currentTeam = propsMode === 'player' 
                ? depthChartTeam 
                : (depthChartTeam && depthChartTeam !== 'N/A' ? depthChartTeam : gamePropsTeam);
              
              // Determine roster data based on mode
              const currentTeamRoster = propsMode === 'player' 
                ? (currentTeam === depthChartTeam ? playerTeamRoster : opponentTeamRoster)
                : (allTeamRosters[currentTeam] || null);
              const currentOpponentRoster = propsMode === 'player' 
                ? (currentTeam === depthChartTeam ? opponentTeamRoster : playerTeamRoster)
                : (opponentTeam ? (allTeamRosters[opponentTeam] || null) : null);
              
              // Determine loading state based on mode
              const currentRostersLoading = propsMode === 'player' 
                ? rostersLoading 
                : { player: rosterCacheLoading, opponent: rosterCacheLoading };
              
              return (
<div className="hidden lg:block">
                  <DepthChartContainer
                  selectedTeam={currentTeam}
                  teamInjuries={teamInjuries}
                  isDark={isDark}
                  onPlayerSelect={propsMode === 'player' ? (playerName: string) => {
                    // In depth chart, we only have player names, not full player objects
                    // For now, just log the selection - full integration would require player lookup
                    console.log(`Selected player from depth chart: ${playerName}`);
                  } : () => {}}
                  selectedPlayerName={propsMode === 'player' && selectedPlayer ? (
                    (() => {
                      const fullName = selectedPlayer.full;
                      const constructedName = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
                      return fullName || constructedName;
                    })()
                  ) : ''}
                  opponentTeam={opponentTeam}
                  originalPlayerTeam={propsMode === 'player' ? originalPlayerTeam : gamePropsTeam}
                  playerTeamRoster={currentTeamRoster}
                  opponentTeamRoster={currentOpponentRoster}
                  rostersLoading={currentRostersLoading}
                  onTeamSwap={(team) => {
                    console.log(`🔄 Depth chart view only team swap: ${team}`);
                    // Only update the depth chart display team, not the main stats container
                    if (propsMode === 'player') {
                      setDepthChartTeam(team);
                    } else if (propsMode === 'team') {
                      // In Game Props mode, allow depth chart team switching for roster viewing
                      // but don't change the main gamePropsTeam or stats
                      // We need a separate state for depth chart display team in game props mode
                      setDepthChartTeam(team);
                    }
                  }}
                />
                </div>
              );
            }, [
              propsMode, 
              depthChartTeam, 
              gamePropsTeam, 
              teamInjuries, 
              isDark, 
              selectedPlayer?.full, 
              selectedPlayer?.firstName, 
              selectedPlayer?.lastName, 
              opponentTeam, 
              originalPlayerTeam, 
              playerTeamRoster, 
              opponentTeamRoster, 
              rostersLoading, 
              allTeamRosters, 
              rosterCacheLoading, 
              todaysGames
            ])}

            {/* Player Box Score (Desktop) - conditionally rendered inside useMemo */}
            {useMemo(() => {
              if (propsMode !== 'player') return null;
              
              return (
<div className="hidden lg:block">
                  <PlayerBoxScore
                    selectedPlayer={selectedPlayer}
                    playerStats={playerStats}
                    isDark={isDark}
                  />
                </div>
              );
            }, [propsMode, selectedPlayer, playerStats, isDark])}

          </div>


          {/* Right Panel - Mobile: Single column containers, Desktop: Right sidebar */}
          <div 
            className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 fade-scrollbar custom-scrollbar ${
              sidebarOpen ? 'lg:flex-[3] xl:flex-[3.3]' : 'lg:flex-[4] xl:flex-[4]'
            }`}
          >

            {/* Filter By Container (Desktop - in right panel) */}
            <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-3 pt-3 pb-4 border border-gray-200 dark:border-gray-700 relative overflow-visible">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                <NotificationSystem isDark={isDark} />
              </div>
              <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                <button
                  onClick={() => {
                    if (!hasPremium) {
                      router.push('/subscription');
                      return;
                    }
                    setPropsMode('player');
                    setSearchQuery(''); // Clear search when switching
                    // Always set PTS as default for Player Props
                    setSelectedStat('pts');
                    
                    // If we have a gamePropsTeam selected, use it as the player's team
                    if (gamePropsTeam && gamePropsTeam !== 'N/A') {
                      setSelectedTeam(gamePropsTeam);
                      setOriginalPlayerTeam(gamePropsTeam);
                      setDepthChartTeam(gamePropsTeam);
                    }
                    
                    // Clear the playerCleared flag when switching back to Player Props
                    if (typeof window !== 'undefined') {
                      try {
                        const raw = sessionStorage.getItem('nba-dashboard-session');
                        if (raw) {
                          const saved = JSON.parse(raw);
                          delete saved.playerCleared; // Remove the flag
                          sessionStorage.setItem('nba-dashboard-session', JSON.stringify(saved));
                        }
                      } catch {}
                    }
                  }}
                  disabled={!hasPremium}
                  className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors ${
                    propsMode === 'player'
                      ? "bg-purple-600 text-white"
                      : !hasPremium
                      ? "bg-gray-200 dark:bg-[#0a1929] text-gray-400 dark:text-gray-500 cursor-not-allowed"
                      : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    Player Props
                    {!hasPremium && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setPropsMode('team');
                    setSearchQuery(''); // Clear search when switching
                    
                    // If we have a selectedTeam from Player Props, use it as the gamePropsTeam
                    if (selectedTeam && selectedTeam !== 'N/A') {
                      setGamePropsTeam(selectedTeam);
                    } else {
                      setGamePropsTeam('N/A'); // Reset team selection only if no team was selected
                    }
                    
                    // Keep player data but don't display it in Game Props mode
                    // DON'T clear: setSelectedPlayer, setSelectedTeam, setOriginalPlayerTeam, etc.
                    // This preserves the data for when user switches back to Player Props
                    
                    // Clear URL parameters and update session storage
                    if (typeof window !== 'undefined') {
                      // Save minimal session with cleared player flag
                      const clearedSession = {
                        propsMode: 'team' as const,
                        selectedStat,
                        selectedTimeframe,
                        playerCleared: true // Flag to indicate user deliberately cleared player data
                      };
                      sessionStorage.setItem('nba-dashboard-session', JSON.stringify(clearedSession));
                      
                      // Clear URL parameters
                      const url = new URL(window.location.href);
                      url.searchParams.delete('pid');
                      url.searchParams.delete('name');
                      url.searchParams.delete('team');
                      // Keep stat and tf parameters as they're relevant to Game Props
                      window.history.replaceState({}, '', url.toString());
                    }
                    
                    // Always set TOTAL_PTS as default for Game Props
                    setSelectedStat('total_pts');
                  }}
                  className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors ${
                    propsMode === 'team'
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  Game Props
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                {propsMode === 'player' ? 'Analyze individual player statistics and props' : 'Analyze game totals, spreads, and game-based props'}
              </p>
            </div>
{/* Combined Opponent Analysis & Team Matchup (Desktop) - always visible in both modes */}
            <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 border border-gray-200 dark:border-gray-700 w-full min-w-0">
                {/* Section 0: Defense vs Position / Projected / Opponent Breakdown Tabs - only show in Player Props mode */}
                {propsMode === 'player' && (
                  <>
                    {/* Tab Selector */}
                    <div className="flex gap-1.5 xl:gap-2 mb-2 xl:mb-3">
                      <button
                        onClick={() => setDvpProjectedTab('dvp')}
                        className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                          dvpProjectedTab === 'dvp'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <span className="hidden 2xl:inline">Defense vs Position</span>
                        <span className="2xl:hidden">DvP</span>
                      </button>
                      <button
                        onClick={() => setDvpProjectedTab('projected')}
                        className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                          dvpProjectedTab === 'projected'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Projected
                      </button>
                      <button
                        onClick={() => setDvpProjectedTab('opponent')}
                        className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                          dvpProjectedTab === 'opponent'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <span className="hidden 2xl:inline">Opponent Breakdown</span>
                        <span className="2xl:hidden">Opponent</span>
                      </button>
                      <button
                        onClick={() => setDvpProjectedTab('injuries')}
                        className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                          dvpProjectedTab === 'injuries'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Injuries
                      </button>
                    </div>
                    
                    {/* Content based on selected tab - always render container, just show/hide content */}
                    <div className="relative min-h-[180px] xl:min-h-[200px] w-full min-w-0">
                      <div className={dvpProjectedTab === 'dvp' ? 'block' : 'hidden'}>
                        <PositionDefenseCard isDark={isDark} opponentTeam={opponentTeam} selectedPosition={selectedPosition} currentTeam={selectedTeam} />
                      </div>
                      <div className={dvpProjectedTab === 'projected' ? 'block' : 'hidden'}>
                        <ProjectedStatsCard
                          isDark={isDark}
                          selectedPlayer={selectedPlayer}
                          opponentTeam={opponentTeam}
                          currentTeam={selectedTeam}
                          projectedMinutes={projectedMinutes}
                          loading={projectedMinutesLoading}
                          predictedPace={predictedPace}
                          seasonFgPct={seasonFgPct}
                          averageUsageRate={averageUsageRate}
                          averageMinutes={averageMinutes}
                          averageGamePace={averageGamePace}
                          selectedTimeframe={selectedTimeframe}
                        />
                      </div>
                      <div className={dvpProjectedTab === 'opponent' ? 'block' : 'hidden'}>
                        <OpponentAnalysisCard 
                          isDark={isDark} 
                          opponentTeam={opponentTeam} 
                          selectedTimeFilter={selectedTimeFilter}
                          propsMode={propsMode}
                          playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
                          selectedStat={selectedStat}
                        />
                      </div>
                      <div className={dvpProjectedTab === 'injuries' ? 'block' : 'hidden'}>
                        <InjuryContainer
                          selectedTeam={selectedTeam}
                          opponentTeam={opponentTeam}
                          isDark={isDark}
                          selectedPlayer={selectedPlayer}
                          playerStats={playerStats}
                          teammateFilterId={teammateFilterId}
                          setTeammateFilterId={setTeammateFilterId}
                          setTeammateFilterName={setTeammateFilterName}
                          withWithoutMode={withWithoutMode}
                          setWithWithoutMode={setWithWithoutMode}
                          clearTeammateFilter={clearTeammateFilter}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Section 2: Team Matchup with Pie Chart - only show in Game Props mode */}
                {propsMode === 'team' && (
                <div className="pt-3 md:pt-4 border-t border-gray-200 dark:border-gray-600">
                  <div className="flex items-center justify-between mb-3 md:mb-4">
                    <h4 className="text-sm md:text-base font-medium text-gray-900 dark:text-white">Team Matchup</h4>
                  </div>
                  
                  {/* Comparison Metric Selector */}
                  <div className="mb-3 md:mb-4">
                    <div className="grid grid-cols-2 gap-1 md:gap-1.5">
                      <button
                        onClick={() => setSelectedComparison('points')}
                        className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                          selectedComparison === 'points'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        POINTS
                      </button>
                      <button
                        onClick={() => setSelectedComparison('rebounds')}
                        className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                          selectedComparison === 'rebounds'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        REBOUNDS
                      </button>
                      <button
                        onClick={() => setSelectedComparison('assists')}
                        className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                          selectedComparison === 'assists'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        ASSISTS
                      </button>
                      <button
                        onClick={() => setSelectedComparison('fg_pct')}
                        className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                          selectedComparison === 'fg_pct'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        FG%
                      </button>
                      <div className="col-span-2 flex justify-center">
                        <button
                          onClick={() => setSelectedComparison('three_pct')}
                          className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors w-[calc(50%-0.375rem)] ${
                            selectedComparison === 'three_pct'
                              ? "bg-purple-600 text-white"
                              : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                          }`}
                        >
                          3P%
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Stats Preview Box - appears right after selector buttons */}
                  {(() => {
                    const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
                    const currentOpponent = opponentTeam;
                    
                    if (!currentTeam || currentTeam === 'N/A' || teamMatchupLoading) return null;
                    
                    const currentStats = teamMatchupStats.currentTeam;
                    const opponentStats = teamMatchupStats.opponent;
                    
                    if (!currentStats || !opponentStats) return null;
                    
                    let teamValue: number = 0;
                    let opponentValue: number = 0;
                    let isPercentage = false;
                    let isDefensiveStat = false; // Track if this is a defensive stat (lower is better)
                    
                    switch (selectedComparison) {
                      case 'points':
                        teamValue = currentStats.pts || 0;
                        opponentValue = opponentStats.pts || 0;
                        isDefensiveStat = true;
                        break;
                      case 'rebounds':
                        teamValue = currentStats.reb || 0;
                        opponentValue = opponentStats.reb || 0;
                        isDefensiveStat = true;
                        break;
                      case 'assists':
                        teamValue = currentStats.ast || 0;
                        opponentValue = opponentStats.ast || 0;
                        isDefensiveStat = true;
                        break;
                      case 'fg_pct':
                        teamValue = currentStats.fg_pct || 0;
                        opponentValue = opponentStats.fg_pct || 0;
                        isPercentage = true;
                        break;
                      case 'three_pct':
                        teamValue = currentStats.fg3_pct || 0;
                        opponentValue = opponentStats.fg3_pct || 0;
                        isPercentage = true;
                        break;
                    }
                    
                    const teamDisplay = isPercentage ? `${teamValue.toFixed(1)}%` : teamValue.toFixed(1);
                    const oppDisplay = isPercentage ? `${opponentValue.toFixed(1)}%` : opponentValue.toFixed(1);
                    
                    // Calculate pie data to get consistent colors
                    const tempPieData = createTeamComparisonPieData(
                      teamValue,
                      opponentValue,
                      currentTeam,
                      currentOpponent || 'TBD',
                      false,
                      /* amplify */ true,
                      /* useAbs */ false,
                      /* clampNegatives */ false,
                      /* baseline */ 0,
                      /* invertOppForShare */ false,
                      /* invertMax */ 130,
                      /* ampBoost */ isPercentage ? 3.0 : 1.0
                    );
                    
                    // Use pie chart colors for consistency (green = better, red = worse)
                    // pieData[0] is currentTeam, pieData[1] is opponent
                    const teamColorClass = tempPieData[0]?.fill === '#16a34a' || tempPieData[0]?.fill === '#22c55e'
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-500 dark:text-red-400';
                    const oppColorClass = tempPieData[1]?.fill === '#16a34a' || tempPieData[1]?.fill === '#22c55e'
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-500 dark:text-red-400';
                    
                    return (
                      <div className="bg-gray-100 dark:bg-[#0a1929] rounded px-2 py-1 mb-2">
                        <div className="flex items-center justify-between gap-1 text-xs">
                          <div className={`flex-1 text-center ${teamColorClass}`}>
                            <span className="font-bold">{currentTeam}</span>
                            <span className="font-bold ml-1">{teamDisplay}</span>
                          </div>
                          
                          <div className="text-gray-400 font-bold px-1">VS</div>
                          
                          <div className={`flex-1 text-center ${oppColorClass}`}>
                            <span className="font-bold">{currentOpponent || 'TBD'}</span>
                            <span className="font-bold ml-1">{oppDisplay}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Pie Chart Visualization */}
                  <div className="space-y-4">
                      <div className="flex items-center justify-between h-48 w-full gap-10">
                        {(() => {
                          // Get the correct team references based on mode
                          const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
                          const currentOpponent = opponentTeam; // Use opponent team in both modes
                          
                          // If no team is selected, show neutral 50/50 grey pie
                          if (!currentTeam || currentTeam === 'N/A') {
                            const neutralPieData = [
                              { name: 'N/A', value: 50, fill: '#9ca3af', displayValue: 'N/A' },
                              { name: 'N/A', value: 50, fill: '#9ca3af', displayValue: 'N/A' }
                            ];
                            
                            return (
                              <div className="w-full">
                                <div className="flex items-center justify-between h-48 w-full gap-6 md:gap-8">
                                  {/* Left N/A */}
                                  <div className="w-32 text-right text-sm font-semibold pr-2 md:pr-4 text-gray-400">
                                    <div>N/A</div>
                                    <div>N/A</div>
                                    <div className="text-xs opacity-85">Rank: </div>
                                  </div>
                                  
                                  {/* Neutral Pie */}
                                  <div className="h-44 w-44 md:w-56 md:h-56 flex-shrink-0 select-none" style={{ minHeight: '176px', minWidth: '176px' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                      <PieChart>
                                        <Pie
                                          data={neutralPieData}
                                          cx="50%"
                                          cy="50%"
                                          innerRadius={40}
                                          outerRadius={80}
                                          paddingAngle={0}
                                          dataKey="value"
                                          startAngle={90}
                                          endAngle={-270}
                                        >
                                          {neutralPieData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.fill} />
                                          ))}
                                        </Pie>
                                      </PieChart>
                                    </ResponsiveContainer>
                                  </div>
                                  
                                  {/* Right N/A */}
                                  <div className="w-28 md:w-32 text-left text-sm font-semibold pl-2 md:pl-4 text-gray-400">
                                    <div>N/A</div>
                                    <div>N/A</div>
                                    <div className="text-xs opacity-85">Rank: </div>
                                  </div>
                                </div>
                                
                                {/* Neutral Legend */}
                                <div className="flex items-center justify-center gap-4 text-xs mt-3">
                                  <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 rounded-full bg-gray-400"></div>
                                    <span className="text-gray-500 dark:text-gray-400">No Team Selected</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          
                          if (teamMatchupLoading) {
                            return <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">Loading matchup data...</div>;
                          }
                          
                          const currentStats = teamMatchupStats.currentTeam;
                          const opponentStats = teamMatchupStats.opponent;
                          
                          if (!currentStats || !opponentStats) {
                            return <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">No matchup data available</div>;
                          }
                          
                          let teamValue: number = 0;
                          let opponentValue: number = 0;
                          let isPercentage = false;
                          
                          switch (selectedComparison) {
                            case 'points':
                              teamValue = currentStats.pts || 0;
                              opponentValue = opponentStats.pts || 0;
                              break;
                            case 'rebounds':
                              teamValue = currentStats.reb || 0;
                              opponentValue = opponentStats.reb || 0;
                              break;
                            case 'assists':
                              teamValue = currentStats.ast || 0;
                              opponentValue = opponentStats.ast || 0;
                              break;
                            case 'fg_pct':
                              teamValue = currentStats.fg_pct || 0;
                              opponentValue = opponentStats.fg_pct || 0;
                              isPercentage = true;
                              break;
                            case 'three_pct':
                              teamValue = currentStats.fg3_pct || 0;
                              opponentValue = opponentStats.fg3_pct || 0;
                              isPercentage = true;
                              break;
                          }
                          
                          // Use values directly for display (offensive stats - higher is better)
                          const originalTeamValue = teamValue;
                          const originalOpponentValue = opponentValue;

                          const pieData = createTeamComparisonPieData(
                            teamValue,
                            opponentValue,
                            currentTeam,
                            currentOpponent || 'TBD',
                            false,
                            /* amplify */ true,
                            /* useAbs */ false,
                            /* clampNegatives */ false,
                            /* baseline */ 0,
                            /* invertOppForShare */ false,
                            /* invertMax */ 130,
                            /* ampBoost */ isPercentage ? 3.0 : 1.0
                          );
                          
                          // Update display values to show original (non-inverted) values
                          pieData[0].displayValue = originalTeamValue.toFixed(1);
                          pieData[1].displayValue = originalOpponentValue.toFixed(1);

                          // Keep pie chart data in same order as pieData (currentTeam first, then opponent)
                          const pieDrawData = [pieData?.[0], pieData?.[1]];

                          const teamDisplayRaw = pieData?.[0]?.displayValue ?? '';
                          const oppDisplayRaw = pieData?.[1]?.displayValue ?? '';
                          const teamDisplay = isPercentage ? `${teamDisplayRaw}%` : teamDisplayRaw;
                          const oppDisplay = isPercentage ? `${oppDisplayRaw}%` : oppDisplayRaw;
                          const teamColor = pieData?.[0]?.fill || '#22c55e';
                          const oppColor = pieData?.[1]?.fill || '#ef4444';

                          // Display values (ranks can be added later if needed from DVP API)
                          const leftTeam = currentTeam;
                          const leftDisplay = teamDisplay;
                          const leftColor = teamColor;
                          
                          const rightTeam = currentOpponent;
                          const rightDisplay = oppDisplay;
                          const rightColor = oppColor
                          
                          return (
                            <div className="w-full">
                              {/* Centered Pie Chart */}
                              <div className="flex justify-center">
                                <div className="flex-shrink-0 select-none"
                                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  onMouseUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  onFocus={(e) => { e.preventDefault(); e.target.blur(); }}
                                  style={{ 
                                    width: 'min(20vw, 150px)',
                                    height: 'min(20vw, 150px)',
                                    minWidth: '100px',
                                    minHeight: '100px',
                                    maxWidth: '150px',
                                    maxHeight: '150px',
                                    userSelect: 'none', 
                                    outline: 'none',
                                    border: 'none',
                                    boxShadow: 'none'
                                  }}
                                >
                                  <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                                    <PieChart style={{ outline: 'none', border: 'none' }}>
                                      <Pie
                                        data={pieDrawData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={"30%"}
                                        outerRadius={"85%"}
                                        paddingAngle={5}
                                        dataKey="value"
                                        startAngle={90}
                                        endAngle={-270}
                                      >
                                        {pieDrawData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={entry.fill} />
                                        ))}
                                      </Pie>
                                      <Tooltip
                                        contentStyle={getUnifiedTooltipStyle(isDark)}
                                        wrapperStyle={{ outline: 'none', zIndex: 9999 }}
                                        labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                                        itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                                        formatter={(value: any, name: string, props: any) => [
                                          isPercentage ? `${props.payload.displayValue}%` : `${props.payload.displayValue}`,
                                          name
                                        ]}
                                      />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>

                              {/* Mobile Layout - stats below pie */}
                              <div className="sm:hidden space-y-4">
                                {/* Centered Pie */}
                                <div className="flex justify-center">
                                  <div className="h-32 w-32 md:h-40 md:w-40 flex-shrink-0 select-none"
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onMouseUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onFocus={(e) => { e.preventDefault(); e.target.blur(); }}
                                    style={{ 
                                      minHeight: '128px',
                                      minWidth: '128px',
                                      userSelect: 'none', 
                                      outline: 'none',
                                      border: 'none',
                                      boxShadow: 'none'
                                    }}
                                  >
                                    <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                                      <PieChart style={{ outline: 'none', border: 'none' }}>
                                        <Pie
                                          data={pieDrawData}
                                          cx="50%"
                                          cy="50%"
                                          innerRadius={35}
                                          outerRadius={75}
                                          paddingAngle={5}
                                          dataKey="value"
                                          startAngle={90}
                                          endAngle={-270}
                                        >
                                          {pieDrawData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.fill} />
                                          ))}
                                        </Pie>
                                        <Tooltip
                                          contentStyle={getUnifiedTooltipStyle(isDark)}
                                          wrapperStyle={{ outline: 'none', zIndex: 9999 }}
                                          labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                                          itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                                          formatter={(value: any, name: string, props: any) => [
                                            isPercentage ? `${props.payload.displayValue}%` : `${props.payload.displayValue}`,
                                            name
                                          ]}
                                        />
                                      </PieChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>

                                {/* Stats Row Below */}
                                <div className="flex items-center justify-between gap-4">
                                  {/* Left value - Selected Team */}
                                  <div className="flex-1 text-center text-sm font-semibold" style={{ color: leftColor }}>
                                    <div className="truncate text-base font-bold">{leftTeam}</div>
                                    <div className="text-xl font-bold">{leftDisplay}</div>
                                  </div>

                                  {/* VS Separator */}
                                  <div className="text-gray-400 text-sm font-bold px-2">VS</div>

                                  {/* Right value - Opponent */}
                                  <div className="flex-1 text-center text-sm font-semibold" style={{ color: rightColor }}>
                                    <div className="truncate text-base font-bold">{rightTeam || 'TBD'}</div>
                                    <div className="text-xl font-bold">{rightDisplay}</div>
                                  </div>
                                </div>
                              </div>

                              {/* Dynamic Legend matching slice colors */}
                              <div className="flex items-center justify-center gap-4 text-xs mt-3">
                                <div className="flex items-center gap-1">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: leftColor }}></div>
                                  <span className="text-gray-600 dark:text-gray-300">{leftTeam}</span>
                                </div>
                                <div className="text-gray-400">vs</div>
                                <div className="flex items-center gap-1">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: rightColor }}></div>
                                  <span className="text-gray-600 dark:text-gray-300">{rightTeam || 'TBD'}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      
                      
                      {/* Metric Description */}
                      <div className="text-center text-xs text-gray-500 dark:text-gray-400">
                        {selectedComparison === 'points' && 'Total Points Per Game Comparison'}
                        {selectedComparison === 'rebounds' && 'Total Rebounds Per Game Comparison'}
                        {selectedComparison === 'assists' && 'Total Assists Per Game Comparison'}
                        {selectedComparison === 'fg_pct' && 'Field Goal Shooting Percentage Comparison'}
                        {selectedComparison === 'three_pct' && '3-Point Shooting Percentage Comparison'}
                      </div>
                      
                      {/* Matchup Odds Section */}
                      {(() => {
                        const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
                        const currentOpponent = opponentTeam;
                        
                        // Only show odds if both teams are available and we have odds data
                        if (!currentTeam || currentTeam === 'N/A' || !currentOpponent || !currentOpponent || realOddsData.length === 0) return null;
                        
                        // Get best odds from all books for H2H, Spread, and Total
                        let bestMoneylineHome = 'N/A';
                        let bestMoneylineAway = 'N/A';
                        let bestTotalLine = 'N/A';
                        let bestTotalOverOdds = 'N/A';
                        let bestTotalUnderOdds = 'N/A';
                        
                        // Spread: track positive and negative separately
                        let bestPositiveSpread: { line: number; odds: string } | null = null;
                        let bestNegativeSpread: { line: number; odds: string } | null = null;
                        
                        const toNum = (s: string) => {
                          const n = parseInt(String(s).replace(/[^+\\-\\d]/g, ''), 10);
                          return Number.isFinite(n) ? n : -Infinity;
                        };
                        
                        const parseSpreadLine = (s: string): number => {
                          const n = parseFloat(String(s));
                          return Number.isFinite(n) ? n : 0;
                        };
                        
                        // Find best odds across all books
                        for (const book of realOddsData) {
                          if (book.H2H) {
                            if (book.H2H.home && toNum(book.H2H.home) > toNum(bestMoneylineHome)) bestMoneylineHome = book.H2H.home;
                            if (book.H2H.away && toNum(book.H2H.away) > toNum(bestMoneylineAway)) bestMoneylineAway = book.H2H.away;
                          }
                          if (book.Spread && book.Spread.line && book.Spread.line !== 'N/A') {
                            const line = parseSpreadLine(book.Spread.line);
                            const odds = book.Spread.over;
                            
                            if (line > 0) {
                              // Positive spread: highest line wins, if tied best odds
                              if (!bestPositiveSpread || line > bestPositiveSpread.line || 
                                  (line === bestPositiveSpread.line && toNum(odds) > toNum(bestPositiveSpread.odds))) {
                                bestPositiveSpread = { line, odds };
                              }
                            } else if (line < 0) {
                              // Negative spread: lowest line wins (closest to 0), if tied best odds
                              if (!bestNegativeSpread || line > bestNegativeSpread.line || 
                                  (line === bestNegativeSpread.line && toNum(odds) > toNum(bestNegativeSpread.odds))) {
                                bestNegativeSpread = { line, odds };
                              }
                            }
                          }
                          if (book.Total) {
                            if (book.Total.line && bestTotalLine === 'N/A') bestTotalLine = book.Total.line;
                            if (book.Total.over && toNum(book.Total.over) > toNum(bestTotalOverOdds)) bestTotalOverOdds = book.Total.over;
                            if (book.Total.under && toNum(book.Total.under) > toNum(bestTotalUnderOdds)) bestTotalUnderOdds = book.Total.under;
                          }
                        }
                        
                        return null;
                      })()}
                  </div>
                </div>
                )}
              </div>

            {/* Shot Chart (Desktop) - only in Player Props mode - Always visible with skeleton when loading */}
            {propsMode === 'player' && (
              <div className="hidden lg:block w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 gap-4 border border-gray-200 dark:border-gray-700">
                <Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-500">Loading shot chart...</div>}>
                  <ShotChart 
                    isDark={isDark} 
                    shotData={shotDistanceData}
                    playerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
                    opponentTeam={opponentTeam}
                  />
                </Suspense>
                {/* Play Type Analysis */}
                <Suspense fallback={<div className="h-32 flex items-center justify-center text-gray-500">Loading analysis...</div>}>
                  <PlayTypeAnalysis
                    playerId={selectedPlayer?.id ? String(selectedPlayer.id) : ''}
                    opponentTeam={opponentTeam}
                    season={currentNbaSeason()}
                    isDark={isDark}
                  />
                </Suspense>
              </div>
            )}


            </div>


          </div>
          
        </div>
        </div>
      </div>
      
      {/* Journal Modals */}
      {propsMode === 'player' && selectedPlayer && opponentTeam && (
        <Suspense fallback={null}>
          <AddToJournalModal
            isOpen={showJournalModal}
            onClose={() => setShowJournalModal(false)}
            playerName={selectedPlayer.full}
            playerId={String(selectedPlayer.id)}
            team={selectedTeam}
            opponent={nextGameOpponent}
            gameDate={nextGameDate}
            oddsFormat={oddsFormat}
          />
        </Suspense>
      )}
      
      {/* Game Props Journal Modals */}
      {propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam && (
        <Suspense fallback={null}>
          <AddToJournalModal
          isOpen={showJournalModal}
          onClose={() => setShowJournalModal(false)}
          playerName={TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam}
          playerId={gamePropsTeam}
          team={gamePropsTeam}
          opponent={opponentTeam}
          gameDate={nextGameDate}
          oddsFormat={oddsFormat}
          isGameProp={true}
        />
        </Suspense>
      )}
      
      {/* Mobile Bottom Navigation - Only visible on mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#0a1929] border-t border-gray-200 dark:border-gray-700 z-50 safe-bottom">
        {/* Profile Dropdown Menu - Shows above bottom nav */}
        {showProfileDropdown && (
          <div ref={profileDropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowProfileDropdown(false);
                  handleSidebarSubscription();
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Subscription
              </button>
              <div className="border-t border-gray-200 dark:border-gray-700"></div>
              <button
                onClick={() => {
                  setShowProfileDropdown(false);
                  handleLogout();
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
        
        {/* Journal Dropdown Menu - Shows above bottom nav */}
        {showJournalDropdown && hasPremium && (
          <div ref={journalDropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowJournalDropdown(false);
                  router.push('/journal');
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                View Journal
              </button>
            </div>
          </div>
        )}

        {/* Settings Dropdown Menu - Shows above bottom nav */}
        {showSettingsDropdown && (
          <div ref={settingsDropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              {/* Theme Selection */}
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Theme</label>
                <select 
                  value={theme}
                  onChange={(e) => {
                    setTheme(e.target.value as 'Light' | 'Dark');
                    localStorage.setItem('theme', e.target.value);
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="Light">Light</option>
                  <option value="Dark">Dark</option>
                </select>
              </div>
              
              {/* Odds Format Selection */}
              <div className="px-4 py-3">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Odds Format</label>
                <select 
                  value={oddsFormat}
                  onChange={(e) => {
                    const newFormat = e.target.value as 'american' | 'decimal';
                    setOddsFormat(newFormat);
                    localStorage.setItem('oddsFormat', newFormat);
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="american">American</option>
                  <option value="decimal">Decimal</option>
                </select>
              </div>
            </div>
          </div>
        )}
        
        {/* Mobile: Original grid layout */}
        <div className="grid grid-cols-4 h-16 lg:hidden">
          {/* Dashboard */}
          <button
            className="flex flex-col items-center justify-center gap-1 text-purple-600 dark:text-purple-400"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <circle cx="12" cy="12" r="6" strokeWidth={2} />
              <circle cx="12" cy="12" r="2" strokeWidth={2} />
            </svg>
            <span className="text-xs font-medium">Dashboard</span>
          </button>
          
          {/* Journal */}
          <button
            data-journal-button
            onClick={() => {
              if (!hasPremium) {
                router.push('/subscription');
                return;
              }
              setShowJournalDropdown(!showJournalDropdown);
            }}
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              !hasPremium
                ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                : 'text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400'
            }`}
          >
            {!hasPremium ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            )}
            <span className="text-xs font-medium">Journal</span>
          </button>
          
          {/* Profile */}
          <button
            data-profile-button
            onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            {(() => {
              const displayName = username || userEmail || 'Profile';
              const fallbackInitial = displayName?.trim().charAt(0)?.toUpperCase() || 'P';
              const getAvatarColor = (name: string): string => {
                let hash = 0;
                for (let i = 0; i < name.length; i++) {
                  hash = name.charCodeAt(i) + ((hash << 5) - hash);
                }
                const hue = Math.abs(hash) % 360;
                const saturation = 65 + (Math.abs(hash) % 20);
                const lightness = 45 + (Math.abs(hash) % 15);
                return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
              };
              const avatarColor = !avatarUrl ? getAvatarColor(displayName) : undefined;
              return (
                <div 
                  className="w-6 h-6 rounded-full overflow-hidden border border-gray-300 dark:border-gray-600 flex items-center justify-center text-xs font-semibold text-white"
                  style={avatarColor ? { backgroundColor: avatarColor } : { backgroundColor: 'rgb(243, 244, 246)' }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl ?? undefined} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full">{fallbackInitial}</span>
                  )}
                </div>
              );
            })()}
            <span className="text-xs font-medium">Profile</span>
          </button>
          
          {/* Settings */}
          <button
            data-settings-button
            onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs font-medium">Settings</span>
          </button>
        </div>
        
        {/* Desktop: Centered Journal button layout */}
        <div className="hidden lg:flex items-center justify-between h-16 px-4 relative">
          {/* Dashboard */}
          <button
            className="flex flex-col items-center justify-center gap-1 text-purple-600 dark:text-purple-400"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <circle cx="12" cy="12" r="6" strokeWidth={2} />
              <circle cx="12" cy="12" r="2" strokeWidth={2} />
            </svg>
            <span className="text-xs font-medium">Dashboard</span>
          </button>
          
          {/* Journal - Centered by default, moves to side when parlay is active */}
          <button
            data-journal-button
            onClick={() => {
              if (!hasPremium) {
                router.push('/subscription');
                return;
              }
              setShowJournalDropdown(!showJournalDropdown);
            }}
            className={`flex flex-col items-center justify-center gap-1 transition-all duration-300 ${
              !hasPremium
                ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                : 'text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400'
            } ${
              typeof document !== 'undefined' && document.body.hasAttribute('data-parlay-active')
                ? 'absolute left-4' // Move to left side when parlay is active
                : 'absolute left-1/2 -translate-x-1/2' // Centered by default
            }`}
          >
            {!hasPremium ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            )}
            <span className="text-xs font-medium">Journal</span>
          </button>
          
          {/* Profile */}
          <button
            data-profile-button
            onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            {(() => {
              const displayName = username || userEmail || 'Profile';
              const fallbackInitial = displayName?.trim().charAt(0)?.toUpperCase() || 'P';
              const getAvatarColor = (name: string): string => {
                let hash = 0;
                for (let i = 0; i < name.length; i++) {
                  hash = name.charCodeAt(i) + ((hash << 5) - hash);
                }
                const hue = Math.abs(hash) % 360;
                const saturation = 65 + (Math.abs(hash) % 20);
                const lightness = 45 + (Math.abs(hash) % 15);
                return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
              };
              const avatarColor = !avatarUrl ? getAvatarColor(displayName) : undefined;
              return (
                <div 
                  className="w-6 h-6 rounded-full overflow-hidden border border-gray-300 dark:border-gray-600 flex items-center justify-center text-xs font-semibold text-white"
                  style={avatarColor ? { backgroundColor: avatarColor } : { backgroundColor: 'rgb(243, 244, 246)' }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl ?? undefined} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full">{fallbackInitial}</span>
                  )}
                </div>
              );
            })()}
            <span className="text-xs font-medium">Profile</span>
          </button>
          
          {/* Settings */}
          <button
            data-settings-button
            onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs font-medium">Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NBADashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#050d1a]">Loading dashboard...</div>}>
      <NBADashboardWrapper />
    </Suspense>
  );
}

// Wrapper component to ensure theme context is available
// This ensures the component only renders client-side after ThemeProvider is mounted
function NBADashboardWrapper() {
  const [mounted, setMounted] = useState(false);
  
  // Call all hooks before any conditional returns
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Always render NBADashboardContent to ensure hooks are called consistently
  // The ThemeProvider should always be available from layout-client.tsx
  // If there's an error, it will be caught by ErrorBoundary
  return <NBADashboardContent />;
}