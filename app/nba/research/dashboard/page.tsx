'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { useTheme } from "@/contexts/ThemeContext";
import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useMemo, useRef, useEffect, memo, useCallback, Suspense } from 'react';
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
import InjuryContainer from '@/components/InjuryContainer';
import DepthChartContainer from './components/DepthChartContainer';
import { cachedFetch } from '@/lib/requestCache';
import ShotChart from './ShotChart';
import TrackPlayerModal from '@/components/TrackPlayerModal';
import AddToJournalModal from '@/components/AddToJournalModal';
import { useSubscription } from '@/hooks/useSubscription';
import { TeamTrackingStatsTable } from '@/components/TeamTrackingStatsTable';
import { PlayTypeAnalysis } from '@/components/PlayTypeAnalysis';
import NotificationSystem from '@/components/NotificationSystem';
import { SimilarPlayers } from './components/SimilarPlayers';
import { getBookmakerInfo as getBookmakerInfoFromLib } from '@/lib/bookmakers';

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

const mergeBookRowsByBaseName = (books: any[], skipMerge = false): any[] => {
  if (skipMerge) return books;

  const MERGE_KEYS = [
    'H2H',
    'Spread',
    'Total',
    'PTS',
    'REB',
    'AST',
    'THREES',
    'BLK',
    'STL',
    'TO',
    'PRA',
    'PR',
    'PA',
    'RA',
    'DD',
    'TD',
    'FIRST_BASKET',
  ];

  const mergedMap = new Map<string, any>();
  const order: string[] = [];

  for (const book of books || []) {
    const baseNameRaw = (book as any)?.meta?.baseName || book?.name || '';
    const baseKey = baseNameRaw.toLowerCase();
    const displayName = baseNameRaw || book?.name || 'Book';

    if (!mergedMap.has(baseKey)) {
      const clone = JSON.parse(JSON.stringify(book));
      clone.name = displayName;
      // Preserve metadata (including gameHomeTeam/gameAwayTeam)
      if (book.meta && !clone.meta) {
        clone.meta = { ...book.meta };
      }
      mergedMap.set(baseKey, clone);
      order.push(baseKey);
      continue;
    }

    const target = mergedMap.get(baseKey);
    
    // Preserve metadata from source if target doesn't have it
    if (book.meta && !target.meta) {
      target.meta = { ...book.meta };
    } else if (book.meta && target.meta) {
      // Merge metadata, preserving gameHomeTeam/gameAwayTeam
      target.meta = { ...target.meta, ...book.meta };
    }

    for (const key of MERGE_KEYS) {
      const sourceVal = book[key];
      const targetVal = target[key];

      if (!sourceVal) continue;

      if (key === 'H2H') {
        if (targetVal?.home === 'N/A' && sourceVal.home !== 'N/A') {
          targetVal.home = sourceVal.home;
        }
        if (targetVal?.away === 'N/A' && sourceVal.away !== 'N/A') {
          targetVal.away = sourceVal.away;
        }
        continue;
      }

      const needsLine =
        sourceVal &&
        typeof sourceVal === 'object' &&
        ('line' in sourceVal || 'yes' in sourceVal);

      if (!needsLine) {
        if (!targetVal && sourceVal) {
          target[key] = JSON.parse(JSON.stringify(sourceVal));
        }
        continue;
      }

      const shouldReplaceLine =
        targetVal?.line === 'N/A' && sourceVal.line !== 'N/A';

      if (shouldReplaceLine) {
        target[key] = { ...sourceVal };
        continue;
      }

      if (sourceVal.over && targetVal?.over === 'N/A') {
        targetVal.over = sourceVal.over;
      }
      if (sourceVal.under && targetVal?.under === 'N/A') {
        targetVal.under = sourceVal.under;
      }
      if (sourceVal.yes && targetVal?.yes === 'N/A') {
        targetVal.yes = sourceVal.yes;
      }
      if (sourceVal.no && targetVal?.no === 'N/A') {
        targetVal.no = sourceVal.no;
      }
    }
  }

  return order.map((key) => mergedMap.get(key));
};

type DerivedOdds = { openingLine?: number | null; currentLine?: number | null };

type MovementRow = { ts: number; timeLabel: string; line: number; change: string; direction: 'up' | 'down' | 'flat' };

const getNthWeekdayOfMonthUtc = (year: number, month: number, weekday: number, nth: number) => {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstWeekdayOffset = (weekday - firstOfMonth.getUTCDay() + 7) % 7;
  const day = 1 + firstWeekdayOffset + (nth - 1) * 7;
  return new Date(Date.UTC(year, month, day));
};

const getEasternOffsetMinutes = (date: Date) => {
  const year = date.getUTCFullYear();
  const startDst = getNthWeekdayOfMonthUtc(year, 2, 0, 2); // Second Sunday in March
  startDst.setUTCHours(7, 0, 0, 0); // 2 AM ET -> 7 AM UTC during standard time
  const endDst = getNthWeekdayOfMonthUtc(year, 10, 0, 1); // First Sunday in November
  endDst.setUTCHours(6, 0, 0, 0); // 2 AM ET -> 6 AM UTC during daylight time
  const isDst = date >= startDst && date < endDst;
  return isDst ? -240 : -300; // minutes offset from UTC
};

const parseBallDontLieTipoff = (game: any): Date | null => {
  if (!game) return null;
  const iso = String(game?.date || '');
  if (!iso) return null;
  const status = String(game?.status || '');
  const datePart = iso.split('T')[0];
  if (!datePart) return null;

  const timeMatch = status.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
  if (!timeMatch) {
    const fallback = new Date(iso);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) {
    hour += 12;
  } else if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  const baseDate = new Date(iso);
  const offsetMinutes = getEasternOffsetMinutes(baseDate);
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  const offsetSign = offsetMinutes <= 0 ? '-' : '+';
  const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

  const zonedIso = `${datePart}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offsetStr}`;
  const parsed = new Date(zonedIso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

type MatchupInfo = { tipoffLocal?: string | null; tipoffDate?: string | null } | null;

export interface PredictedOutcomeResult {
  overProb: number | null;
  underProb: number | null;
  confidence: 'High' | 'Medium' | 'Low';
  expectedValue?: number | null;
}

export interface OfficialOddsCardProps {
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
  predictedOutcome?: PredictedOutcomeResult | null;
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
function currentNbaSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 0=Jan, 9=Oct, 11=Dec
  const day = now.getDate();
  
  // NBA season starts around October 15th and runs through June
  // Season year is the year it starts (e.g., 2024-25 season = 2024)
  
  // If we're in October (month 9) and before the 15th, use previous year
  if (month === 9 && day < 15) {
    return now.getFullYear() - 1;
  }
  
  // If we're in October 15+ or November/December, use current year
  if (month >= 9) {
    return now.getFullYear();
  }
  
  // If we're in January-September, use previous year
  return now.getFullYear() - 1;
}
function parseMinutes(minStr: string): number {
  if (!minStr || minStr === '0:00') return 0;
  const [m, s] = minStr.split(':').map(Number);
  return (Number.isFinite(m) ? m : 0) + ((Number.isFinite(s) ? s : 0) / 60);
}
// Player stats from BallDontLie stats API
function getStatValue(stats: BallDontLieStats, key: string): number {
  switch (key) {
    case 'min': return parseMinutes(stats.min);
    case 'pts': return stats.pts;
    case 'reb': return stats.reb;
    case 'ast': return stats.ast;
    case 'fg3m': return stats.fg3m;
    case 'fg3a': return stats.fg3a;
    case 'fg3_pct': return (stats.fg3_pct || 0) * 100;
    case 'fgm': return stats.fgm;
    case 'fga': return stats.fga;
    case 'fg_pct': return (stats.fg_pct || 0) * 100;
    case 'ftm': return stats.ftm;
    case 'fta': return stats.fta;
    case 'ft_pct': return (stats.ft_pct || 0) * 100;
    case 'oreb': return stats.oreb;
    case 'dreb': return stats.dreb;
    case 'turnover': return stats.turnover;
    case 'pf': return stats.pf;
    case 'stl': return stats.stl;
    case 'blk': return stats.blk;
    // Composite stats
    case 'pra': return (stats.pts || 0) + (stats.reb || 0) + (stats.ast || 0);
    case 'pr': return (stats.pts || 0) + (stats.reb || 0);
    case 'ra': return (stats.reb || 0) + (stats.ast || 0);
    default: return 0;
  }
}

// Game-level stats from BallDontLie games API
function getGameStatValue(game: any, key: string, teamAbbr: string): number {
  if (!game) return 0;
  
  const homeScore = game.home_team_score || 0;
  const visitorScore = game.visitor_team_score || 0;
  const homeTeam = game.home_team?.abbreviation;
  const visitorTeam = game.visitor_team?.abbreviation;
  const normalizedTeam = normalizeAbbr(teamAbbr);
  const isHome = normalizeAbbr(homeTeam || '') === normalizedTeam;
  
  switch (key) {
    case 'total_pts':
      return homeScore + visitorScore;
    
    case 'spread':
      // Betting research logic: calculate from selected team's perspective
      // Favorite (negative spread like -9.5): negative when they win
      // Underdog (positive spread like +9.5): positive when they win
      // Calculate the score difference from the selected team's perspective
      const selectedTeamScore = isHome ? homeScore : visitorScore;
      const opponentScore = isHome ? visitorScore : homeScore;
      const margin = selectedTeamScore - opponentScore;
      // The margin is positive when selected team wins, negative when they lose
      // But we want: favorite shows negative when they win, underdog shows positive when they win
      // Since we don't know the historical spread, we'll use the convention:
      // Negative margin = selected team lost (or didn't cover if favorite)
      // Positive margin = selected team won (or covered if underdog)
      // To match betting convention: flip the sign so favorites show negative
      // We'll infer favorite/underdog from typical patterns, but for now just show the margin
      // Actually, let's just return the margin and let the display handle the sign convention
      return margin;
    
    case 'moneyline':
      // 1 = win, 0 = loss
      return isHome ? (homeScore > visitorScore ? 1 : 0) : (visitorScore > homeScore ? 1 : 0);
    
    case 'home_total':
      return homeScore;
    
    case 'away_total':
      return visitorScore;
    
    case 'first_half_total':
      return (game.home_q1 || 0) + (game.home_q2 || 0) + (game.visitor_q1 || 0) + (game.visitor_q2 || 0);
    
    case 'second_half_total':
      return (game.home_q3 || 0) + (game.home_q4 || 0) + (game.visitor_q3 || 0) + (game.visitor_q4 || 0);
    
    case 'q1_total':
      return (game.home_q1 || 0) + (game.visitor_q1 || 0);
    
    case 'q2_total':
      return (game.home_q2 || 0) + (game.visitor_q2 || 0);
    
    case 'q3_total':
      return (game.home_q3 || 0) + (game.visitor_q3 || 0);
    
    case 'q4_total':
      return (game.home_q4 || 0) + (game.visitor_q4 || 0);
    
    case 'q1_moneyline':
      // 1 = won quarter, 0 = lost quarter
      const homeQ1 = game.home_q1 || 0;
      const visitorQ1 = game.visitor_q1 || 0;
      return isHome ? (homeQ1 > visitorQ1 ? 1 : 0) : (visitorQ1 > homeQ1 ? 1 : 0);
    
    case 'q2_moneyline':
      const homeQ2 = game.home_q2 || 0;
      const visitorQ2 = game.visitor_q2 || 0;
      return isHome ? (homeQ2 > visitorQ2 ? 1 : 0) : (visitorQ2 > homeQ2 ? 1 : 0);
    
    case 'q3_moneyline':
      const homeQ3 = game.home_q3 || 0;
      const visitorQ3 = game.visitor_q3 || 0;
      return isHome ? (homeQ3 > visitorQ3 ? 1 : 0) : (visitorQ3 > homeQ3 ? 1 : 0);
    
    case 'q4_moneyline':
      const homeQ4 = game.home_q4 || 0;
      const visitorQ4 = game.visitor_q4 || 0;
      return isHome ? (homeQ4 > visitorQ4 ? 1 : 0) : (visitorQ4 > homeQ4 ? 1 : 0);
    
    default:
      return 0;
  }
}

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
const TEAM_ID_TO_ABBR: Record<number, string> = {
  1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
  11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
  21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
};

// Reverse mapping: abbreviation to team ID
const ABBR_TO_TEAM_ID: Record<string, number> = Object.fromEntries(
  Object.entries(TEAM_ID_TO_ABBR).map(([id, abbr]) => [abbr, parseInt(id)])
);

// Team abbreviation to full name mapping
const TEAM_FULL_NAMES: Record<string, string> = {
  'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets', 'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers', 'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons', 'GSW': 'Golden State Warriors', 'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies', 'MIA': 'Miami Heat',
  'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves', 'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks',
  'OKC': 'Oklahoma City Thunder', 'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs', 'TOR': 'Toronto Raptors',
  'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards'
};

// ESPN logo slug mapping for exceptions (scoreboard path)
const ESPN_LOGO_SLUG: Record<string, string> = {
  NOP: 'new-orleans-pelicans',
  UTA: 'utah-jazz',
  SAS: 'san-antonio-spurs',
};

// ESPN filename exceptions for base 500/ path
// Note: ESPN uses 'no.png' (not 'nop.png') for New Orleans; 'utah.png' for Jazz, 'sa.png' for Spurs
const ESPN_FILE_ABBR: Record<string, string> = {
  NOP: 'no',
  UTA: 'utah',
  SAS: 'sa',
};

// Build ordered candidate URLs for ESPN logos for a team
const getEspnLogoCandidates = (abbr: string): string[] => {
  const normalized = normalizeAbbr(abbr || '');
  const baseFile = (ESPN_FILE_ABBR[normalized] || normalized.toLowerCase());
  const lc = normalized.toLowerCase();
  const candidates: string[] = [];
  // 1) Base 500 path with filename (works for most teams; includes 'no.png' and 'utah.png')
  candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/${baseFile}.png`);
  // 2) Scoreboard slug path for known exceptions (Pelicans, Jazz)
  const exceptionSlug = ESPN_LOGO_SLUG[normalized];
  if (exceptionSlug) {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${exceptionSlug}.png`);
  } else {
    // Generic scoreboard fallback using abbr (some teams have abbr scoreboard assets)
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${lc}.png`);
  }

  // Team-specific extra variants for ESPN inconsistencies (removed UTA fallbacks - utah.png works)
  if (normalized === 'NOP') {
    // Extra safety variants for Pelicans
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/no.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/nop.png`);
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return candidates.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
};

// First candidate for convenience
const getEspnLogoUrl = (abbr: string): string => getEspnLogoCandidates(abbr)[0];
// Second candidate for convenience (legacy usage)
const getEspnFallbackLogoUrl = (abbr: string): string => getEspnLogoCandidates(abbr)[1] || getEspnLogoCandidates(abbr)[0];

// Opponent defensive stats data (2024-25 season)
const opponentDefensiveStats: Record<string, {
  ptsAllowed: number;
  rebAllowed: number;
  astAllowed: number;
  fgmAllowed: number;
  fgaAllowed: number;
  fg3mAllowed: number;
  fg3aAllowed: number;
  stlAllowed: number;
  blkAllowed: number;
}> = {
  'OKC': { ptsAllowed: 107.6, rebAllowed: 44.9, astAllowed: 24.6, fgmAllowed: 37.9, fgaAllowed: 87.0, fg3mAllowed: 13.5, fg3aAllowed: 39.3, stlAllowed: 6.7, blkAllowed: 4.8 },
  'CLE': { ptsAllowed: 112.4, rebAllowed: 43.5, astAllowed: 25.6, fgmAllowed: 41.2, fgaAllowed: 90.9, fg3mAllowed: 13.5, fg3aAllowed: 37.5, stlAllowed: 7.8, blkAllowed: 4.4 },
  'BOS': { ptsAllowed: 107.2, rebAllowed: 43.7, astAllowed: 24.0, fgmAllowed: 40.3, fgaAllowed: 89.4, fg3mAllowed: 12.9, fg3aAllowed: 37.1, stlAllowed: 6.9, blkAllowed: 3.6 },
  'HOU': { ptsAllowed: 109.8, rebAllowed: 42.1, astAllowed: 23.5, fgmAllowed: 40.5, fgaAllowed: 88.3, fg3mAllowed: 12.3, fg3aAllowed: 34.5, stlAllowed: 7.9, blkAllowed: 5.7 },
  'NYK': { ptsAllowed: 111.7, rebAllowed: 41.8, astAllowed: 25.2, fgmAllowed: 41.6, fgaAllowed: 87.7, fg3mAllowed: 13.1, fg3aAllowed: 35.7, stlAllowed: 7.0, blkAllowed: 5.0 },
  'DEN': { ptsAllowed: 116.9, rebAllowed: 42.5, astAllowed: 29.0, fgmAllowed: 43.3, fgaAllowed: 93.0, fg3mAllowed: 14.1, fg3aAllowed: 38.7, stlAllowed: 8.7, blkAllowed: 5.1 },
  'IND': { ptsAllowed: 115.1, rebAllowed: 45.0, astAllowed: 26.0, fgmAllowed: 42.6, fgaAllowed: 89.9, fg3mAllowed: 12.9, fg3aAllowed: 36.3, stlAllowed: 7.2, blkAllowed: 4.5 },
  'LAC': { ptsAllowed: 108.2, rebAllowed: 41.5, astAllowed: 25.7, fgmAllowed: 39.5, fgaAllowed: 85.8, fg3mAllowed: 13.0, fg3aAllowed: 37.0, stlAllowed: 8.8, blkAllowed: 4.3 },
  'LAL': { ptsAllowed: 112.2, rebAllowed: 43.0, astAllowed: 27.3, fgmAllowed: 41.4, fgaAllowed: 89.3, fg3mAllowed: 13.6, fg3aAllowed: 38.1, stlAllowed: 8.2, blkAllowed: 4.2 },
  'MIN': { ptsAllowed: 109.3, rebAllowed: 42.9, astAllowed: 24.8, fgmAllowed: 40.5, fgaAllowed: 88.0, fg3mAllowed: 12.7, fg3aAllowed: 36.0, stlAllowed: 8.4, blkAllowed: 4.5 },
  'GSW': { ptsAllowed: 110.5, rebAllowed: 44.1, astAllowed: 25.9, fgmAllowed: 40.4, fgaAllowed: 86.9, fg3mAllowed: 13.2, fg3aAllowed: 36.3, stlAllowed: 7.6, blkAllowed: 5.4 },
  'MEM': { ptsAllowed: 116.9, rebAllowed: 43.5, astAllowed: 27.0, fgmAllowed: 41.9, fgaAllowed: 91.8, fg3mAllowed: 14.2, fg3aAllowed: 39.4, stlAllowed: 8.7, blkAllowed: 5.5 },
  'MIL': { ptsAllowed: 113.0, rebAllowed: 45.3, astAllowed: 26.4, fgmAllowed: 41.6, fgaAllowed: 91.1, fg3mAllowed: 13.9, fg3aAllowed: 39.4, stlAllowed: 7.3, blkAllowed: 3.8 },
  'DET': { ptsAllowed: 113.6, rebAllowed: 42.5, astAllowed: 24.8, fgmAllowed: 40.6, fgaAllowed: 87.9, fg3mAllowed: 13.6, fg3aAllowed: 37.2, stlAllowed: 8.9, blkAllowed: 5.0 },
  'ORL': { ptsAllowed: 105.5, rebAllowed: 42.1, astAllowed: 22.8, fgmAllowed: 38.1, fgaAllowed: 81.5, fg3mAllowed: 11.4, fg3aAllowed: 31.4, stlAllowed: 7.7, blkAllowed: 4.4 },
  'ATL': { ptsAllowed: 119.3, rebAllowed: 43.7, astAllowed: 28.2, fgmAllowed: 43.4, fgaAllowed: 90.2, fg3mAllowed: 14.3, fg3aAllowed: 37.8, stlAllowed: 9.2, blkAllowed: 4.9 },
  'SAC': { ptsAllowed: 115.3, rebAllowed: 42.3, astAllowed: 27.0, fgmAllowed: 41.6, fgaAllowed: 87.8, fg3mAllowed: 14.5, fg3aAllowed: 38.2, stlAllowed: 7.9, blkAllowed: 4.3 },
  'CHI': { ptsAllowed: 119.4, rebAllowed: 46.1, astAllowed: 28.9, fgmAllowed: 44.4, fgaAllowed: 95.0, fg3mAllowed: 13.6, fg3aAllowed: 39.6, stlAllowed: 8.1, blkAllowed: 5.1 },
  'DAL': { ptsAllowed: 115.4, rebAllowed: 45.3, astAllowed: 27.1, fgmAllowed: 43.1, fgaAllowed: 91.7, fg3mAllowed: 12.9, fg3aAllowed: 35.4, stlAllowed: 8.1, blkAllowed: 4.6 },
  'MIA': { ptsAllowed: 110.0, rebAllowed: 44.7, astAllowed: 26.5, fgmAllowed: 41.3, fgaAllowed: 88.6, fg3mAllowed: 13.6, fg3aAllowed: 37.9, stlAllowed: 7.5, blkAllowed: 4.7 },
  'PHX': { ptsAllowed: 116.6, rebAllowed: 44.2, astAllowed: 27.3, fgmAllowed: 42.6, fgaAllowed: 90.1, fg3mAllowed: 14.2, fg3aAllowed: 38.4, stlAllowed: 8.5, blkAllowed: 4.0 },
  'POR': { ptsAllowed: 113.9, rebAllowed: 44.2, astAllowed: 26.2, fgmAllowed: 41.6, fgaAllowed: 88.3, fg3mAllowed: 12.7, fg3aAllowed: 35.2, stlAllowed: 9.5, blkAllowed: 5.5 },
  'SAS': { ptsAllowed: 116.7, rebAllowed: 46.2, astAllowed: 28.0, fgmAllowed: 43.8, fgaAllowed: 92.5, fg3mAllowed: 14.4, fg3aAllowed: 39.3, stlAllowed: 8.1, blkAllowed: 4.3 },
  'TOR': { ptsAllowed: 115.2, rebAllowed: 45.0, astAllowed: 25.9, fgmAllowed: 41.2, fgaAllowed: 88.3, fg3mAllowed: 13.2, fg3aAllowed: 37.7, stlAllowed: 9.2, blkAllowed: 5.9 },
  'BKN': { ptsAllowed: 112.2, rebAllowed: 43.7, astAllowed: 27.1, fgmAllowed: 40.5, fgaAllowed: 84.3, fg3mAllowed: 12.9, fg3aAllowed: 35.7, stlAllowed: 8.0, blkAllowed: 5.6 },
  'PHI': { ptsAllowed: 115.8, rebAllowed: 45.5, astAllowed: 28.3, fgmAllowed: 42.4, fgaAllowed: 86.8, fg3mAllowed: 14.2, fg3aAllowed: 37.6, stlAllowed: 7.4, blkAllowed: 5.1 },
  'NOP': { ptsAllowed: 119.3, rebAllowed: 45.7, astAllowed: 28.6, fgmAllowed: 43.7, fgaAllowed: 90.5, fg3mAllowed: 14.6, fg3aAllowed: 41.1, stlAllowed: 9.0, blkAllowed: 5.2 },
  'CHA': { ptsAllowed: 114.2, rebAllowed: 45.2, astAllowed: 26.8, fgmAllowed: 41.6, fgaAllowed: 88.9, fg3mAllowed: 14.2, fg3aAllowed: 40.0, stlAllowed: 8.8, blkAllowed: 5.3 },
  'WAS': { ptsAllowed: 120.4, rebAllowed: 48.9, astAllowed: 28.5, fgmAllowed: 43.7, fgaAllowed: 92.8, fg3mAllowed: 14.3, fg3aAllowed: 39.2, stlAllowed: 9.1, blkAllowed: 5.2 },
  'UTA': { ptsAllowed: 121.2, rebAllowed: 44.2, astAllowed: 29.6, fgmAllowed: 44.6, fgaAllowed: 93.0, fg3mAllowed: 14.9, fg3aAllowed: 41.5, stlAllowed: 9.8, blkAllowed: 6.4 }
};

// Get opponent defensive rank for a specific stat
const getOpponentDefensiveRank = (teamAbbr: string, statType: 'ptsAllowed' | 'rebAllowed' | 'astAllowed' | 'fgmAllowed' | 'fgaAllowed' | 'fg3mAllowed' | 'fg3aAllowed' | 'stlAllowed' | 'blkAllowed'): number => {
  // Create array of teams with their defensive stats for sorting
  const teamsWithStats = Object.entries(opponentDefensiveStats).map(([team, stats]) => ({
    team,
    value: stats[statType] || 999
  }));

  // Sort by value - LOWER is BETTER for defense (rank 1 = best defense)
  teamsWithStats.sort((a, b) => a.value - b.value);

  // Find the rank (1-based index)
  const rank = teamsWithStats.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30; // Default to 30th if team not found
};

// Get opponent defensive rank color (inverted logic - bad defense is good for your player)
const getOpponentDefensiveRankColor = (rank: number): string => {
  // For opponent defense: higher rank = worse defense = better for your player
  if (rank >= 25) return 'text-green-500';       // Excellent (25th-30th worst defense)
  if (rank >= 19) return 'text-green-400';       // Very good (19th-24th)
  if (rank >= 13) return 'text-orange-500';      // Okay (13th-18th)
  if (rank >= 7) return 'text-red-400';          // Pretty bad (7th-12th)
  return 'text-red-500';                         // Bad (1st-6th best defense)
};

// Add ordinal suffix to numbers (1st, 2nd, 3rd, 4th, etc.)
const getOrdinalSuffix = (num: number): string => {
  const lastDigit = num % 10;
  const lastTwoDigits = num % 100;
  
  // Special cases for 11th, 12th, 13th
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return num + 'th';
  }
  
  // Standard cases
  switch (lastDigit) {
    case 1: return num + 'st';
    case 2: return num + 'nd';
    case 3: return num + 'rd';
    default: return num + 'th';
  }
};

// NBA Team Ratings Data (2024-25 Season) - Offensive and Defensive Ratings
const teamRatings: Record<string, { offensive: number; defensive: number; net: number }> = {
  'CLE': { offensive: 119.8, defensive: 108.1, net: 0 },  // Rank 1
  'BOS': { offensive: 119.5, defensive: 110.1, net: 0 },  // Rank 2
  'OKC': { offensive: 119.2, defensive: 106.6, net: 0 },  // Rank 3
  'DEN': { offensive: 118.9, defensive: 115.1, net: 0 },  // Rank 4
  'NYK': { offensive: 117.3, defensive: 113.3, net: 0 },  // Rank 5
  'MEM': { offensive: 117.2, defensive: 112.6, net: 0 },  // Rank 6
  'SAC': { offensive: 115.9, defensive: 115.3, net: 0 },  // Rank 7
  'MIN': { offensive: 115.7, defensive: 110.8, net: 0 },  // Rank 8
  'IND': { offensive: 115.4, defensive: 113.3, net: 0 },  // Rank 9
  'MIL': { offensive: 115.1, defensive: 112.7, net: 0 },  // Rank 10
  'LAL': { offensive: 115.0, defensive: 113.8, net: 0 },  // Rank 11
  'HOU': { offensive: 114.9, defensive: 110.3, net: 0 },  // Rank 12
  'PHX': { offensive: 114.7, defensive: 117.7, net: 0 },  // Rank 13
  'DET': { offensive: 114.6, defensive: 112.5, net: 0 },  // Rank 14
  'LAC': { offensive: 114.3, defensive: 109.4, net: 0 },  // Rank 15
  'GSW': { offensive: 114.2, defensive: 111.0, net: 0 },  // Rank 16
  'ATL': { offensive: 113.7, defensive: 114.8, net: 0 },  // Rank 17
  'DAL': { offensive: 113.7, defensive: 115.0, net: 0 },  // Rank 18
  'SAS': { offensive: 113.5, defensive: 116.3, net: 0 },  // Rank 19
  'CHI': { offensive: 113.2, defensive: 114.8, net: 0 },  // Rank 20
  'MIA': { offensive: 112.4, defensive: 112.0, net: 0 },  // Rank 21
  'POR': { offensive: 111.0, defensive: 113.7, net: 0 },  // Rank 22
  'PHI': { offensive: 111.0, defensive: 117.3, net: 0 },  // Rank 23
  'UTA': { offensive: 110.2, defensive: 119.4, net: 0 },  // Rank 24
  'NOP': { offensive: 109.7, defensive: 119.1, net: 0 },  // Rank 25
  'TOR': { offensive: 109.6, defensive: 113.6, net: 0 },  // Rank 26
  'ORL': { offensive: 108.9, defensive: 109.1, net: 0 },  // Rank 27
  'BKN': { offensive: 108.1, defensive: 115.4, net: 0 },  // Rank 28
  'CHA': { offensive: 106.7, defensive: 115.7, net: 0 },  // Rank 29
  'WAS': { offensive: 105.8, defensive: 118.0, net: 0 }   // Rank 30
};

// Calculate net rating for each team
Object.keys(teamRatings).forEach(team => {
  teamRatings[team].net = teamRatings[team].offensive - teamRatings[team].defensive;
});

// NBA Team Pace Data (2024-25 Season) - Fastest to Slowest
const teamPace: Record<string, number> = {
  'MEM': 103.69, 'CHI': 103.61, 'ATL': 103.41, 'WAS': 101.82, 'OKC': 100.90,
  'UTA': 100.85, 'IND': 100.76, 'DEN': 100.67, 'TOR': 100.62, 'CLE': 100.31,
  'DET': 100.27, 'DAL': 100.15, 'SAS': 100.08, 'MIL': 99.92, 'NOP': 99.77,
  'POR': 99.51, 'GSW': 99.37, 'HOU': 99.03, 'SAC': 98.91, 'LAL': 98.34,
  'PHX': 98.31, 'LAC': 98.24, 'CHA': 98.22, 'PHI': 98.13, 'MIN': 97.95,
  'NYK': 97.64, 'MIA': 97.08, 'BKN': 96.73, 'BOS': 96.59, 'ORL': 96.51
};

// NBA Team Rebound Percentage Data (2024-25 Season)
const teamReboundPct: Record<string, number> = {
  'MEM': 58.8, 'CHI': 58.5, 'ATL': 57.9, 'WAS': 54.6, 'OKC': 59.3,
  'UTA': 56.8, 'IND': 59.4, 'DEN': 60.4, 'TOR': 55.3, 'CLE': 60.7,
  'DET': 58.0, 'DAL': 58.3, 'SAS': 57.5, 'MIL': 59.8, 'NOP': 55.2,
  'POR': 55.5, 'GSW': 56.8, 'HOU': 55.3, 'SAC': 58.2, 'LAL': 59.3,
  'PHX': 59.5, 'LAC': 58.9, 'CHA': 53.7, 'PHI': 56.3, 'MIN': 58.8,
  'NYK': 58.9, 'MIA': 57.6, 'BKN': 55.2, 'BOS': 59.1, 'ORL': 55.0
};

// Get team ratings with fallback
const getTeamRating = (teamAbbr: string, type: 'offensive' | 'defensive' | 'net') => {
  return teamRatings[teamAbbr]?.[type] ?? 0.0;
};

// Get team rank for a specific rating type
const getTeamRank = (teamAbbr: string, type: 'offensive' | 'defensive' | 'net') => {
  // Create array of teams with their ratings for sorting
  const teamsWithRatings = Object.entries(teamRatings).map(([team, ratings]) => ({
    team,
    rating: ratings[type] || 0
  }));

  // Sort based on rating type (higher is better for offensive/net, lower is better for defensive)
  teamsWithRatings.sort((a, b) => {
    if (type === 'defensive') {
      return a.rating - b.rating; // Lower defensive rating is better (rank 1)
    }
    return b.rating - a.rating; // Higher offensive/net rating is better (rank 1)
  });

  // Find the rank (1-based index)
  const rank = teamsWithRatings.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30; // Default to 30th if team not found
};

// Get pace value for a team
const getTeamPace = (teamAbbr: string): number => {
  return teamPace[teamAbbr] ?? 0.0;
};

// Get rebound percentage for a team
const getTeamReboundPct = (teamAbbr: string): number => {
  return teamReboundPct[teamAbbr] ?? 0.0;
};

// Get pace rank for a team (higher pace = better for overs)
const getPaceRank = (teamAbbr: string): number => {
  const paceArray = Object.entries(teamPace).map(([team, pace]) => ({ team, pace }));
  paceArray.sort((a, b) => b.pace - a.pace); // Higher pace = better rank
  const rank = paceArray.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30;
};

// Memoized chart: only re-renders when its props change
// Label layer split out so it doesn't re-render on bettingLine changes
const StaticLabelList = memo(function StaticLabelList({ isDark, formatChartLabel, fontSizePx = 12 }: { isDark: boolean; formatChartLabel: (v: any) => string; fontSizePx?: number }) {
  return (
    <LabelList
      dataKey="value"
      position={CHART_CONFIG.labelList.position}
      style={{
        fontSize: `${fontSizePx}px`,
        fontWeight: CHART_CONFIG.labelList.fontWeight,
        fill: isDark ? '#ffffff' : '#000000'
      }}
      formatter={formatChartLabel}
    />
  );
}, (prev, next) => prev.isDark === next.isDark && prev.formatChartLabel === next.formatChartLabel && prev.fontSizePx === next.fontSizePx);

// Custom tick component for X-axis with team logos
const CustomXAxisTick = memo(function CustomXAxisTick({ x, y, payload, data }: any) {
  const [logoError, setLogoError] = useState(false);
  const [logoAttempt, setLogoAttempt] = useState(0);
  
  // Get the actual data point to extract team abbreviation
  const dataPoint = data?.find((d: any) => d.xKey === payload.value);
  const teamAbbr = dataPoint?.tickLabel || payload.value;
  
  // Get logo candidates
  const logoCandidates = getEspnLogoCandidates(teamAbbr);
  const logoUrl = logoCandidates[logoAttempt] || logoCandidates[0];
  
  if (logoError && logoAttempt >= logoCandidates.length - 1) {
    // Fallback to text if all logo attempts fail
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={16}
          textAnchor="middle"
          fill="currentColor"
          fontSize={10}
          fontWeight="600"
        >
          {teamAbbr}
        </text>
      </g>
    );
  }
  
  return (
    <g transform={`translate(${x},${y})`}>
      <image
        x={-12}
        y={0}
        width={24}
        height={24}
        xlinkHref={logoUrl}
        onError={() => {
          if (logoAttempt < logoCandidates.length - 1) {
            setLogoAttempt(prev => prev + 1);
          } else {
            setLogoError(true);
          }
        }}
      />
    </g>
  );
}, (prev, next) => prev.x === next.x && prev.y === next.y && prev.payload?.value === next.payload?.value);
// Static bars chart - never re-renders for betting line changes
const StaticBarsChart = memo(function StaticBarsChart({
  data,
  yAxisConfig,
  isDark,
  bettingLine,
  customTooltip,
  formatChartLabel,
  selectedStat,
  compactMobile,
  selectedTimeframe,
  onChartTouchStart,
  onChartTouchMove,
  onChartTouchEnd,
  onChartMouseLeave,
}: {
  data: any[];
  yAxisConfig: { domain: [number, number]; ticks: number[]; dataMin: number; dataMax: number };
  isDark: boolean;
  bettingLine: number;
  customTooltip: any;
  formatChartLabel: (v: any) => string;
  selectedStat: string;
  compactMobile?: boolean;
  selectedTimeframe?: string;
  onChartTouchStart?: () => void;
  onChartTouchMove?: () => void;
  onChartTouchEnd?: () => void;
  onChartMouseLeave?: () => void;
}) {
  const colorMap = useMemo(() => {
    return data.map(d => {
      if (selectedStat === 'spread') {
        // For spread: lower values are better (covered spread), so invert the logic
        return d.value < bettingLine ? 'over' : d.value === bettingLine ? 'push' : 'under';
      } else {
        // For all other stats: higher values are better
        return d.value > bettingLine ? 'over' : d.value === bettingLine ? 'push' : 'under';
      }
    });
  }, [data, bettingLine, selectedStat]);
  
  // Detect mobile viewport for bar sizing only (does not affect desktop)
  const [isMobileSB, setIsMobileSB] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => {
      setIsMobileSB(mq.matches);
      setViewportWidth(window.innerWidth);
    };
    update();
    window.addEventListener('resize', update);
    if (mq.addEventListener) {
      mq.addEventListener('change', update);
      return () => {
        mq.removeEventListener('change', update);
        window.removeEventListener('resize', update);
      };
    } else {
      // @ts-ignore legacy
      mq.addListener(update);
      return () => {
        // @ts-ignore legacy
        mq.removeListener(update);
        window.removeEventListener('resize', update);
      };
    }
  }, []);

  // Memoize axis styles to prevent recreating objects on every render
  const xAxisTickStyle = useMemo(() => ({ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }), [isDark]);
  const yAxisTickStyle = useMemo(() => ({ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }), [isDark]);
  const xAxisLineStyle = useMemo(() => ({ stroke: isDark ? '#4b5563' : '#d1d5db' }), [isDark]);
  const yAxisLineStyle = useMemo(() => ({ stroke: isDark ? '#4b5563' : '#d1d5db' }), [isDark]);

  const computedBarCategoryGap = useMemo(() => {
    const base = data.length <= 5 ? '2%' : data.length <= 10 ? '3%' : '5%';
    return compactMobile ? '1.5%' : base; // small but visible category gap on mobile
  }, [data.length, compactMobile]);
  const computedMaxBarSize = useMemo(() => (compactMobile ? 120 : CHART_CONFIG.performance.maxBarSize), [compactMobile]);
  
  // Hide logos and labels for Last Season to reduce clutter (but keep spacing)
  const hideLogosAndLabels = selectedTimeframe === 'lastseason';
  
  const chartMargin = useMemo(() => {
    const margin = { ...CHART_CONFIG.margin };
    if (compactMobile || isMobileSB) {
      margin.bottom = 0;
      margin.left = 2;
      margin.right = 2;
    }
    // Add extra bottom margin when logos are hidden to maintain Y-axis 0 position
    // This prevents the chart from expanding into the logo space
    if (hideLogosAndLabels && !compactMobile && !isMobileSB) {
      margin.bottom = CHART_CONFIG.margin.bottom + CHART_CONFIG.xAxis.height;
    }
    return margin;
  }, [compactMobile, isMobileSB, hideLogosAndLabels]);

  return (
    <ResponsiveContainer 
      key={viewportWidth}
      width="100%" 
      height="100%" 
      debounce={CHART_CONFIG.performance.debounceMs}
    >
      <BarChart 
        data={data} 
        margin={chartMargin}
        syncMethod="value"
        maxBarSize={data.length <= 5 ? 250 : data.length <= 10 ? 250 : computedMaxBarSize}
        barCategoryGap={computedBarCategoryGap}
        barGap={selectedStat === 'fg3m' ? -40 : (compactMobile ? 2 : 2)}
        onTouchStart={onChartTouchStart}
        onTouchMove={onChartTouchMove}
        onTouchEnd={onChartTouchEnd}
        onMouseLeave={onChartMouseLeave}
      >
        <XAxis
          dataKey="xKey"
          tick={hideLogosAndLabels ? false : <CustomXAxisTick data={data} />}
          axisLine={hideLogosAndLabels ? false : xAxisLineStyle}
          height={CHART_CONFIG.xAxis.height}
          interval={CHART_CONFIG.xAxis.interval}
          allowDuplicatedCategory={CHART_CONFIG.xAxis.allowDuplicatedCategory}
          hide={!!compactMobile || hideLogosAndLabels}
          padding={compactMobile ? { left: 8, right: 8 } : undefined as any}
        />
        <YAxis 
          domain={yAxisConfig.domain}
          ticks={yAxisConfig.ticks}
          tick={yAxisTickStyle}
          axisLine={yAxisLineStyle}
          hide={!!compactMobile}
          width={!isMobileSB ? CHART_CONFIG.yAxis.width : undefined}
        />
        <Tooltip 
          isAnimationActive={false} 
          content={customTooltip}
          animationDuration={0}
          wrapperStyle={{ zIndex: 9999 }}
          cursor={{ fill: isDark ? '#4b5563' : '#9ca3af', opacity: 0.3 }}
        />
        <Bar 
          dataKey={selectedStat === 'fg3m' ? "stats.fg3a" : "value"} 
          radius={CHART_CONFIG.bar.radius} 
          isAnimationActive={false} 
          animationDuration={0}
          background={false}
          shape={selectedStat === 'fg3m' ? (props: any) => {
            const { x, y, width, height, payload } = props;
            const attempts = payload?.stats?.fg3a || 0;
            const makes = payload?.stats?.fg3m || 0;
            const makesHeight = attempts > 0 ? (makes / attempts) * height : 0;
            
            return (
              <g>
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={isDark ? '#4b5563' : '#d1d5db'}
                  fillOpacity={0.5}
                  rx={CHART_CONFIG.bar.radius[0]}
                  ry={CHART_CONFIG.bar.radius[0]}
                />
                
                {attempts > 0 && makes === 0 && (
                  <text
                    x={x + width / 2}
                    y={y + height / 2 + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill={isDark ? '#ffffff' : '#000000'}
                  >
                    {attempts}
                  </text>
                )}
                
                {attempts > 0 && makes > 0 && (
                  <text
                    x={x + width / 2}
                    y={y + (height - makesHeight) / 2 + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill={isDark ? '#ffffff' : '#000000'}
                  >
                    {attempts}
                  </text>
                )}
                
                {makes > 0 && (
                  <rect
                    x={x}
                    y={y + height - makesHeight}
                    width={width}
                    height={makesHeight}
                    fill={makes > bettingLine ? CHART_CONFIG.colors.green : makes === bettingLine ? '#9ca3af' : CHART_CONFIG.colors.red}
                    rx={CHART_CONFIG.bar.radius[0]}
                    ry={CHART_CONFIG.bar.radius[0]}
                  />
                )}
                
                {makes > 0 && makesHeight > 15 && (
                  <text
                    x={x + width / 2}
                    y={y + height - makesHeight / 2 + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill="#ffffff"
                  >
                    {makes}
                  </text>
                )}
              </g>
            );
          } : undefined}
        >
          {data.map((e, i) => (
            <Cell 
              key={e.xKey || i} 
              fill={colorMap[i] === 'over' ? CHART_CONFIG.colors.green : colorMap[i] === 'push' ? '#9ca3af' : CHART_CONFIG.colors.red}
              data-bar-index={i}
              data-value={typeof e.value === 'number' ? e.value : ''}
              style={{ 
                transition: 'all 0.3s ease'
              }}
            />
          ))}
          {!['fg3m', 'moneyline', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat) && !hideLogosAndLabels && (
            <StaticLabelList isDark={isDark} formatChartLabel={formatChartLabel} fontSizePx={compactMobile ? 14 : 12} />
          )}
        </Bar>
        {/* NO ReferenceLine here - handled by separate chart */}
      </BarChart>
    </ResponsiveContainer>
  );
}, (prev, next) => (
  // Only re-render when essential props change, ignore bettingLine
  prev.data === next.data &&
  prev.yAxisConfig === next.yAxisConfig &&
  prev.isDark === next.isDark &&
  prev.selectedStat === next.selectedStat &&
  prev.customTooltip === next.customTooltip &&
  prev.formatChartLabel === next.formatChartLabel
));

// Dynamic reference line chart - re-renders freely for betting line changes
const DynamicReferenceLineChart = memo(function DynamicReferenceLineChart({
  yAxisConfig,
  isDark,
  bettingLine,
  dataLength,
  compactMobile,
}: {
  yAxisConfig: { domain: [number, number]; ticks: number[]; dataMin: number; dataMax: number };
  isDark: boolean;
  bettingLine: number;
  dataLength: number;
  compactMobile?: boolean;
}) {
  const clampedRefLine = useMemo(() => {
    const maxY = Array.isArray(yAxisConfig?.domain) ? yAxisConfig.domain[1] : undefined;
    const top = typeof maxY === 'number' ? maxY : bettingLine;
    const y = Math.min(bettingLine, top);
    return y;
  }, [bettingLine, yAxisConfig]);
  
  const refLineColor = useMemo(() => isDark ? '#ffffff' : '#000000', [isDark]);
  
  // Create dummy data with same length as main chart to maintain coordinate system
  const dummyData = useMemo(() => 
    Array.from({ length: Math.max(dataLength, 1) }, (_, i) => ({ 
      xKey: `dummy_${i}`, 
      value: yAxisConfig.domain[0] + 0.1 // Tiny visible value to establish coordinate system
    })), 
    [dataLength, yAxisConfig]
  );
  
  const chartMargin = useMemo(() => {
    if (compactMobile) {
      const mobileMargin = { ...CHART_CONFIG.margin };
      mobileMargin.bottom = 0;
      mobileMargin.left = 2;
      mobileMargin.right = 2;
      return mobileMargin;
    }
    return CHART_CONFIG.margin;
  }, [compactMobile]);
  return (
    <ResponsiveContainer 
      width="100%" 
      height="100%"
    >
      <BarChart 
        data={dummyData} // Dummy data to maintain coordinate system
        margin={chartMargin} // Same margins as static chart
      >
        <XAxis 
          dataKey="xKey"
          hide // Hidden - only for coordinate system
        />
        <YAxis 
          domain={yAxisConfig.domain} // Same domain as static chart
          ticks={yAxisConfig.ticks}   // Same ticks as static chart
          hide // Hidden - only for coordinate system
        />
        <ReferenceLine y={clampedRefLine} stroke={refLineColor} strokeDasharray="6 6" strokeWidth={3} ifOverflow="extendDomain" />
        <Bar 
          dataKey="value" 
          fill="transparent" 
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
});

// Static betting line overlay (never re-renders, updated via DOM)
const StaticBettingLineOverlay = memo(function StaticBettingLineOverlay({ isDark, isMobile }: { isDark: boolean; isMobile?: boolean }) {
  const lineColor = isDark ? '#ffffff' : '#000000';
  
  return (
    <div 
      id="betting-line-container"
      className="absolute pointer-events-none"
      style={{
        left: isMobile ? 8 : CHART_CONFIG.yAxis.width,
        right: isMobile ? 8 : (CHART_CONFIG.margin.right + 10),
        top: CHART_CONFIG.margin.top,
        bottom: isMobile ? CHART_CONFIG.margin.bottom : CHART_CONFIG.margin.bottom + 40,
        zIndex: 5 // above bars but below tooltips
      }}
    >
      <div
        id="betting-line-fast"
        className="absolute w-full"
        style={{
          bottom: '50%', // Initial position
          opacity: 0.8,
          height: '3px',
          background: `repeating-linear-gradient(to right, ${lineColor} 0px, ${lineColor} 12px, transparent 12px, transparent 18px)`
        }}
      />
    </div>
  );
}, (prev, next) => prev.isDark === next.isDark);

// Direct DOM updater (no React re-renders)
const updateBettingLinePosition = (yAxisConfig: any, bettingLine: number) => {
  const doUpdate = (el: HTMLElement) => {
    if (!yAxisConfig?.domain) return;

    const [minY, maxY] = yAxisConfig.domain;
    const range = maxY - minY;

    // Mobile-only: fit overlay to actual bar bounds for exact alignment
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      const container = document.getElementById('betting-line-container') as HTMLElement | null;
      const parent = container?.parentElement as HTMLElement | null;
      const bars = Array.from(document.querySelectorAll('[data-bar-index]')) as HTMLElement[];
      if (container && parent && bars.length) {
        const parentRect = parent.getBoundingClientRect();
        let minLeft = Infinity;
        let maxRight = -Infinity;
        let minTop = Infinity;
        let maxBottom = -Infinity;
        const barValues: number[] = [];

        for (const b of bars) {
          const r = b.getBoundingClientRect();
          minLeft = Math.min(minLeft, r.left - parentRect.left);
          maxRight = Math.max(maxRight, r.right - parentRect.left);
          const valueAttr = b.getAttribute('data-value');
          const parsed = valueAttr != null ? parseFloat(valueAttr) : NaN;
          if (!Number.isNaN(parsed)) barValues.push(parsed);
        }

        if (Number.isFinite(minLeft)) container.style.left = `${Math.max(0, minLeft)}px`;
        if (Number.isFinite(maxRight)) container.style.right = `${Math.max(0, parentRect.width - maxRight)}px`;
      }
    }

    const clampedLine = Math.max(minY, Math.min(bettingLine, maxY));

    // Use actual bars range when available to prevent visual offset from axis padding
    let effectiveMin = minY;
    let effectiveMax = maxY;
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      if (typeof yAxisConfig.dataMin === 'number') {
        effectiveMin = Math.min(minY, yAxisConfig.dataMin);
      }
      if (typeof yAxisConfig.dataMax === 'number') {
        effectiveMax = Math.max(maxY, yAxisConfig.dataMax);
      }
    }
    const effectiveRange = effectiveMax - effectiveMin;
    let percentage = effectiveRange > 0 ? ((clampedLine - effectiveMin) / effectiveRange) * 100 : 50;

    // Clamp for safety
    if (!Number.isFinite(percentage)) percentage = 50;
    percentage = Math.max(0, Math.min(100, percentage));

    el.style.bottom = `${percentage}%`;
  };

  const el = document.getElementById('betting-line-fast');
  if (el) {
    doUpdate(el as HTMLElement);
  } else {
    // If the line isn't mounted yet (e.g., after timeframe/stat remount), try again shortly
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        const el2 = document.getElementById('betting-line-fast');
        if (el2) doUpdate(el2 as HTMLElement);
      });
      setTimeout(() => {
        const el3 = document.getElementById('betting-line-fast');
        if (el3) doUpdate(el3 as HTMLElement);
      }, 50);
    }
  }
};

// Combined chart component
const StatsBarChart = memo(function StatsBarChart({
  data,
  yAxisConfig,
  isDark,
  bettingLine,
  customTooltip,
  formatChartLabel,
  selectedStat,
  selectedTimeframe,
}: {
  data: any[];
  yAxisConfig: { domain: [number, number]; ticks: number[]; dataMin: number; dataMax: number };
  isDark: boolean;
  bettingLine: number;
  customTooltip: any;
  formatChartLabel: (v: any) => string;
  selectedStat: string;
  selectedTimeframe?: string;
}) {
  // Keep overlay in sync only with committed line (reduces updates during hold).
  useEffect(() => {
    updateBettingLinePosition(yAxisConfig, bettingLine);
  }, [bettingLine, yAxisConfig]);

  // Detect mobile only on client to avoid affecting desktop SSR
  const [isMobile, setIsMobile] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [mobileTooltipActive, setMobileTooltipActive] = useState(false);
  const mobileTooltipTimerRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearMobileTooltipTimer = useCallback(() => {
    if (mobileTooltipTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(mobileTooltipTimerRef.current);
      mobileTooltipTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearMobileTooltipTimer();
    };
  }, [clearMobileTooltipTimer]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => {
      const matches = mq.matches;
      setIsMobile(prev => {
        if (prev !== matches) {
          setLayoutKey((k) => k + 1);
          if (!matches) {
            setMobileTooltipActive(false);
            clearMobileTooltipTimer();
          }
        }
        return matches;
      });
    };
    update();
    if (mq.addEventListener) {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    } else {
      // Safari/older
      // @ts-ignore
      mq.addListener(update);
      return () => {
        // @ts-ignore
        mq.removeListener(update);
      };
    }
  }, []);

  // Mobile transient line for live updates during hold (ReferenceLine follows this)
  const [mobileLine, setMobileLine] = useState<number | null>(null);
  useEffect(() => {
    const handler = (e: any) => {
      const v = e?.detail?.value;
      if (typeof v === 'number') setMobileLine(v);
    };
    window.addEventListener('transient-line', handler as any);
    return () => window.removeEventListener('transient-line', handler as any);
  }, []);
  useEffect(() => { setMobileLine(null); }, [bettingLine, selectedStat]);

  // Use transient line if available, otherwise use committed betting line
  const activeLine = mobileLine ?? bettingLine;

  // Calculate colorMap for background glow using active line (transient or committed)
  const colorMap = useMemo(() => {
    return data.map(e => {
      const val = e.value;
      if (val == null) return 'under';
      return val > activeLine ? 'over' : val === activeLine ? 'push' : 'under';
    });
  }, [data, activeLine]);

  // Calculate predominant trend for background glow
  const overCount = colorMap.filter(c => c === 'over').length;
  const underCount = colorMap.filter(c => c === 'under').length;
  const total = data.length;
  const overPercent = total > 0 ? (overCount / total) * 100 : 0;
  const underPercent = total > 0 ? (underCount / total) * 100 : 0;
  
  // Determine background glow based on predominant trend (disabled for moneyline/spread)
  let backgroundGradient = '';
  const disableGlow = ['moneyline', 'spread'].includes(selectedStat);
  if (!disableGlow && overPercent > 60) {
    // Strong over trend - green glow
    backgroundGradient = isDark 
      ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.28) 0%, rgba(34, 197, 94, 0.20) 15%, rgba(34, 197, 94, 0.12) 30%, rgba(34, 197, 94, 0.06) 45%, rgba(34, 197, 94, 0.02) 60%, rgba(34, 197, 94, 0.008) 75%, rgba(34, 197, 94, 0.003) 85%, rgba(34, 197, 94, 0.001) 92%, rgba(34, 197, 94, 0.0002) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.20) 0%, rgba(34, 197, 94, 0.14) 15%, rgba(34, 197, 94, 0.09) 30%, rgba(34, 197, 94, 0.045) 45%, rgba(34, 197, 94, 0.015) 60%, rgba(34, 197, 94, 0.006) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)';
  } else if (!disableGlow && underPercent > 60) {
    // Strong under trend - red glow
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.28) 0%, rgba(239, 68, 68, 0.20) 15%, rgba(239, 68, 68, 0.12) 30%, rgba(239, 68, 68, 0.06) 45%, rgba(239, 68, 68, 0.02) 60%, rgba(239, 68, 68, 0.008) 75%, rgba(239, 68, 68, 0.003) 85%, rgba(239, 68, 68, 0.001) 92%, rgba(239, 68, 68, 0.0002) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.20) 0%, rgba(239, 68, 68, 0.14) 15%, rgba(239, 68, 68, 0.09) 30%, rgba(239, 68, 68, 0.045) 45%, rgba(239, 68, 68, 0.015) 60%, rgba(239, 68, 68, 0.006) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)'
  } else if (!disableGlow && overPercent > underPercent && overPercent > 40) {
    // Slight over trend - subtle green glow
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.16) 0%, rgba(34, 197, 94, 0.11) 15%, rgba(34, 197, 94, 0.06) 30%, rgba(34, 197, 94, 0.03) 45%, rgba(34, 197, 94, 0.012) 60%, rgba(34, 197, 94, 0.005) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.12) 0%, rgba(34, 197, 94, 0.085) 15%, rgba(34, 197, 94, 0.055) 30%, rgba(34, 197, 94, 0.024) 45%, rgba(34, 197, 94, 0.008) 60%, rgba(34, 197, 94, 0.003) 75%, rgba(34, 197, 94, 0.001) 85%, rgba(34, 197, 94, 0.0003) 92%, rgba(34, 197, 94, 0.00005) 97%, transparent 100%)';
  } else if (!disableGlow && underPercent > overPercent && underPercent > 40) {
    // Slight under trend - subtle red glow
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.16) 0%, rgba(239, 68, 68, 0.11) 15%, rgba(239, 68, 68, 0.06) 30%, rgba(239, 68, 68, 0.03) 45%, rgba(239, 68, 68, 0.012) 60%, rgba(239, 68, 68, 0.005) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.12) 0%, rgba(239, 68, 68, 0.085) 15%, rgba(239, 68, 68, 0.055) 30%, rgba(239, 68, 68, 0.024) 45%, rgba(239, 68, 68, 0.008) 60%, rgba(239, 68, 68, 0.003) 75%, rgba(239, 68, 68, 0.001) 85%, rgba(239, 68, 68, 0.0003) 92%, rgba(239, 68, 68, 0.00005) 97%, transparent 100%)';
  }

  const handleChartTouchStart = useCallback((event?: React.TouchEvent | TouchEvent) => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    setIsDragging(false);
    if (event && 'touches' in event && event.touches.length > 0) {
      const touch = event.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    } else {
      touchStartRef.current = null;
    }
  }, [isMobile, clearMobileTooltipTimer]);

  const handleChartTouchMove = useCallback((event?: React.TouchEvent | TouchEvent) => {
    if (!isMobile) return;
    if (touchStartRef.current && event && 'touches' in event && event.touches.length > 0) {
      const touch = event.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > 16) {
        setIsDragging(true);
        clearMobileTooltipTimer();
        setMobileTooltipActive(false);
      }
    }
  }, [isMobile, clearMobileTooltipTimer]);

  const handleChartTouchEnd = useCallback(() => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    touchStartRef.current = null;
    if (isDragging) {
      setMobileTooltipActive(false);
      setIsDragging(false);
      return;
    }
    setIsDragging(false);
    // Toggle tooltip: if open, close it; if closed, open it
    setMobileTooltipActive(prev => !prev);
  }, [isMobile, clearMobileTooltipTimer, isDragging]);

  const handleChartMouseLeave = useCallback(() => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    setMobileTooltipActive(false);
  }, [isMobile, clearMobileTooltipTimer]);

  const adjustedTooltip = useCallback((tooltipProps: any) => {
    if (isMobile && !mobileTooltipActive) {
      return null;
    }
    return customTooltip(tooltipProps);
  }, [isMobile, mobileTooltipActive, customTooltip]);

  return (
    <div className="relative w-full h-full chart-mobile-optimized" key={layoutKey}>
      {/* Background glow effect */}
      {backgroundGradient && (
        <div 
          key={`glow-${activeLine}-${overPercent.toFixed(0)}`}
          className="absolute pointer-events-none" 
          style={{ 
            top: '-5%',
            left: '-30%',
            right: '-30%',
            bottom: '-30%',
            background: backgroundGradient,
            zIndex: 0,
            transition: 'background 0.1s ease-out'
          }}
        />
      )}
      {/* Static bars layer */}
      <StaticBarsChart
        key={`${selectedStat}-${yAxisConfig?.domain?.join?.(',') || ''}`}
        data={data}
        yAxisConfig={yAxisConfig}
        isDark={isDark}
        bettingLine={bettingLine}
        customTooltip={adjustedTooltip}
        formatChartLabel={formatChartLabel}
        selectedStat={selectedStat}
        compactMobile={isMobile}
        selectedTimeframe={selectedTimeframe}
        onChartTouchStart={handleChartTouchStart}
        onChartTouchMove={handleChartTouchMove}
        onChartTouchEnd={handleChartTouchEnd}
        onChartMouseLeave={handleChartMouseLeave}
      />
      {/* Mobile-only: Reference line layer (SVG) for perfect alignment */}
      {isMobile && (
        <div className="absolute inset-0 pointer-events-none">
          <DynamicReferenceLineChart
            yAxisConfig={yAxisConfig}
            isDark={isDark}
            bettingLine={mobileLine ?? bettingLine}
            dataLength={data.length}
            compactMobile={isMobile}
          />
        </div>
      )}
      {/* Desktop-only: CSS overlay line */}
      {!isMobile && <StaticBettingLineOverlay isDark={isDark} />}
    </div>
  );
});

// Home/Away dropdown (H/A)
const HomeAwaySelect = memo(function HomeAwaySelect({ value, onChange, isDark }: { value: 'ALL' | 'HOME' | 'AWAY'; onChange: (v: 'ALL' | 'HOME' | 'AWAY') => void; isDark: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">H/A</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as 'ALL' | 'HOME' | 'AWAY')}
        className="w-16 sm:w-24 md:w-28 px-2 sm:px-2 md:px-3 py-2 sm:py-1.5 rounded-xl bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm sm:text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
      >
        <option value="ALL">ALL</option>
        <option value="HOME">HOME</option>
        <option value="AWAY">AWAY</option>
      </select>
    </div>
  );
});

// Memoized Over Rate pill
const OverRatePill = memo(function OverRatePill({ overCount, total, isDark }: { overCount: number; total: number; isDark: boolean }) {
  const pct = total > 0 ? (overCount / total) * 100 : 0;
  const cls = pct >= 60
    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    : pct >= 40
    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
    : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  return (
    <span className={`px-1 sm:px-2 py-1 sm:py-1.5 rounded text-xs sm:text-sm font-bold ${cls} whitespace-nowrap`} data-over-rate>
      {overCount}/{total} ({pct.toFixed(1)}%)
    </span>
  );
});

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
const getReboundRank = (teamAbbr: string): number => {
  const reboundArray = Object.entries(teamReboundPct).map(([team, rebPct]) => ({ team, rebPct }));
  reboundArray.sort((a, b) => b.rebPct - a.rebPct); // Higher rebound % = better rank
  const rank = reboundArray.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30;
};

// Get color based on team rank for overs betting (5-tier system)
const getRankColor = (rank: number, type: 'offensive' | 'defensive' | 'net' | 'pace' | 'rebound' | 'opponent_rebound' | 'opponent_net'): string => {
  if (type === 'offensive' || type === 'net' || type === 'pace' || type === 'rebound') {
    // For offensive/net/pace/rebound: lower rank = better for overs
    if (rank <= 6) return 'text-green-500';        // Excellent (1st-6th)
    if (rank <= 12) return 'text-green-400';       // Very good (7th-12th) 
    if (rank <= 18) return 'text-orange-500';      // Okay (13th-18th)
    if (rank <= 24) return 'text-red-400';         // Pretty bad (19th-24th)
    return 'text-red-500';                         // Bad (25th-30th)
  } else if (type === 'opponent_rebound' || type === 'opponent_net') {
    // For opponent rebound/net: higher rank = worse performance = better for your player
    if (rank >= 25) return 'text-green-500';       // Excellent (25th-30th worst performance)
    if (rank >= 19) return 'text-green-400';       // Very good (19th-24th)
    if (rank >= 13) return 'text-orange-500';      // Okay (13th-18th)
    if (rank >= 7) return 'text-red-400';          // Pretty bad (7th-12th)
    return 'text-red-500';                         // Bad (1st-6th best performance)
  } else {
    // For defensive: higher rank = worse defense = better for overs
    if (rank >= 25) return 'text-green-500';       // Excellent (25th-30th worst defense)
    if (rank >= 19) return 'text-green-400';       // Very good (19th-24th)
    if (rank >= 13) return 'text-orange-500';      // Okay (13th-18th)
    if (rank >= 7) return 'text-red-400';          // Pretty bad (7th-12th)
    return 'text-red-500';                         // Bad (1st-6th best defense)
  }
};
// Helper function to create pie chart data for team comparisons with amplified differences
const createTeamComparisonPieData = (
  teamValue: number,
  opponentValue: number,
  teamName: string,
  opponentName: string,
  isInverted: boolean = false,
  amplify: boolean = true,
  useAbsoluteForShare: boolean = false,
  clampNegatives: boolean = false,
  baseline: number = 0,
  invertOpponentForShare: boolean = false,
  invertMax: number = 130, // for defensive rating scale (lower is better)
  ampBoost: number = 1.0
) => {
  // If both zero, split evenly
  if (teamValue === 0 && opponentValue === 0) {
    return [
      { name: teamName, value: 50, fill: '#6b7280', displayValue: '0.0' },
      { name: opponentName, value: 50, fill: '#6b7280', displayValue: '0.0' }
    ];
  }

  // Choose how to derive shares
  let a = teamValue;
  let b = opponentValue;
  let hasNegative = false;
  if (useAbsoluteForShare) {
    a = Math.abs(teamValue);
    b = Math.abs(opponentValue);
  } else if (clampNegatives) {
    // Advantage-style: positive dominates negative, but keep both visible with a baseline
    a = Math.max(teamValue, 0);
    b = Math.max(opponentValue, 0);
  } else {
    // Shift-to-zero style for mixed signs
    hasNegative = a < 0 || b < 0;
    if (hasNegative) {
      const minVal = Math.min(a, b);
      a = a - minVal; // min becomes 0
      b = b - minVal;
    }
  }

  // Add a small baseline to both to avoid 100/0 visuals
  if (baseline > 0) {
    a += baseline;
    b += baseline;
  }

  // Guard against both becoming 0
  const safeTotal = a + b;
  if (safeTotal <= 0) {
    return [
      { name: teamName, value: 50, fill: '#6b7280', displayValue: teamValue.toFixed(1) },
      { name: opponentName, value: 50, fill: '#6b7280', displayValue: opponentValue.toFixed(1) }
    ];
  }

  // Optionally invert opponent value for share (e.g., defensive rating where smaller is better)
  if (invertOpponentForShare) {
    b = Math.max(0, invertMax - (useAbsoluteForShare ? Math.abs(opponentValue) : opponentValue));
  }

  // Recompute total after invert
  const totalForShare = a + b;
  const safeTotal2 = totalForShare > 0 ? totalForShare : 1;

  // Base percentages without distortion
  let baseTeamPercent = (a / safeTotal2) * 100;
  let baseOppPercent = 100 - baseTeamPercent;

  // Optional amplification to make small differences more visible.
  let teamPercent = baseTeamPercent;
  let opponentPercent = baseOppPercent;
  if (amplify) {
    const difference = Math.abs(baseTeamPercent - 50); // How far from 50/50
    let amplificationFactor;
    if (difference < 0.5) amplificationFactor = 8.0;
    else if (difference < 1) amplificationFactor = 6.0;
    else if (difference < 2) amplificationFactor = 5.0;
    else if (difference < 5) amplificationFactor = 3.0;
    else amplificationFactor = 1.5;

    amplificationFactor *= Math.max(ampBoost, 0.5); // allow boosting or slightly damping

    const amplifiedDifference = Math.min(difference * amplificationFactor, 52);
    if (baseTeamPercent > 50) {
      teamPercent = Math.min(50 + amplifiedDifference, 95);
      opponentPercent = 100 - teamPercent;
    } else {
      opponentPercent = Math.min(50 + amplifiedDifference, 95);
      teamPercent = 100 - opponentPercent;
    }
  }

  // Colors: green for dominant share in this section, red for the lesser share
  // Brighter, more saturated colors for stronger contrast (not lighter/pastel)
  const brightGreen = '#16a34a'; // green-600
  const brightRed = '#ff1a1a';   // vivid bright red
  const teamDominates = teamPercent >= opponentPercent;
  const teamColor = teamDominates ? brightGreen : brightRed;
  const opponentColor = teamDominates ? brightRed : brightGreen;

  return [
    { name: teamName, value: teamPercent, fill: teamColor, displayValue: teamValue.toFixed(1) },
    { name: opponentName, value: opponentPercent, fill: opponentColor, displayValue: opponentValue.toFixed(1) }
  ];
};

// Get player's current team from recent games
const getPlayerCurrentTeam = (playerStats: BallDontLieStats[]): string => {
  if (!playerStats.length) return 'N/A';
  
  // Sort by date to get most recent games first (they should already be sorted but ensure it)
  const sortedStats = playerStats
    .filter(stat => stat?.game?.date && stat?.team?.abbreviation)
    .sort((a, b) => {
      const dateA = new Date(a.game?.date || 0).getTime();
      const dateB = new Date(b.game?.date || 0).getTime();
      return dateB - dateA; // Most recent first
    });
  
  // Check the most recent games (up to 10) to find the current team
  for (const stat of sortedStats.slice(0, 10)) {
    const teamAbbr = stat?.team?.abbreviation;
    if (teamAbbr) {
      console.log(`🏀 Player's most recent team from game data: ${teamAbbr} (date: ${stat?.game?.date})`);
      return teamAbbr;
    }
  }
  
  console.log(`⚠️ No valid team found in player stats`);
  return 'N/A';
};

// Get opponent team from games schedule
const getOpponentTeam = (currentTeam: string, todaysGames: any[]): string => {
  console.clear();
  console.log(`%c🔍 === OPPONENT DETECTION START ===%c`, 'color: #3498db; font-weight: bold; font-size: 14px', '');
  console.log(`%cSearching for opponent of: %c${currentTeam}`, 'color: #555', 'color: #e74c3c; font-weight: bold; font-size: 14px');
  console.log(`%cTotal games available: %c${todaysGames.length}`, 'color: #555', 'color: #f39c12; font-weight: bold');
  
  if (!currentTeam || currentTeam === 'N/A' || !todaysGames.length) {
    console.log(`%c⏸️ EARLY RETURN - Insufficient data%c`, 'color: #f39c12; font-weight: bold', '');
    console.log(`  currentTeam: ${currentTeam}, games: ${todaysGames.length}`);
    return '';
  }
  
  // Normalize the current team for comparison
  const normCurrentTeam = normalizeAbbr(currentTeam);
  console.log(`%cNormalized input team: %c${normCurrentTeam}`, 'color: #555', 'color: #27ae60; font-weight: bold; font-size: 14px');
  
  // Create a table of all games
  const gameTable = todaysGames.map((game, i) => ({
    '#': i,
    'Home (Raw)': game.home_team?.abbreviation || '?',
    'Away (Raw)': game.visitor_team?.abbreviation || '?',
    'Home (Norm)': normalizeAbbr(game.home_team?.abbreviation || ''),
    'Away (Norm)': normalizeAbbr(game.visitor_team?.abbreviation || ''),
    'Date': game.date,
    'Status': game.status || 'unknown'
  }));
  
  console.log(`%c📊 ALL GAMES:`, 'color: #2c3e50; font-weight: bold; font-size: 12px');
  console.table(gameTable);
  
  let matchingGames = [];
  
  for (let i = 0; i < todaysGames.length; i++) {
    const game = todaysGames[i];
    const homeTeam = normalizeAbbr(game.home_team?.abbreviation || '');
    const visitorTeam = normalizeAbbr(game.visitor_team?.abbreviation || '');
    
    if (homeTeam === normCurrentTeam || visitorTeam === normCurrentTeam) {
      const matchType = homeTeam === normCurrentTeam ? 'HOME' : 'AWAY';
      const opponent = homeTeam === normCurrentTeam ? visitorTeam : homeTeam;
      const status = String(game.status || '').toLowerCase();
      const isFinal = status.includes('final') || status.includes('completed');
      
      matchingGames.push({ homeTeam, visitorTeam, date: game.date, status: game.status, isFinal });
      
      console.log(`%c✅ MATCH FOUND [${i}]%c ${homeTeam} vs ${visitorTeam}`, 'color: #27ae60; font-weight: bold', 'color: #000');
      console.log(`   ${normCurrentTeam} is ${matchType}, opponent is ${opponent}, status: ${status}, isFinal: ${isFinal}`);
      
      // Skip final games and look for upcoming games
      if (!isFinal) {
        if (homeTeam === normCurrentTeam && visitorTeam) {
          console.log(`%c🎯 RETURNING: ${visitorTeam}%c (${normCurrentTeam} is HOME)`, 'color: #27ae60; font-weight: bold; font-size: 14px', '');
          console.log(`%c🔍 === OPPONENT DETECTION END ===%c\n`, 'color: #3498db; font-weight: bold; font-size: 14px', '');
          return visitorTeam;
        }
        if (visitorTeam === normCurrentTeam && homeTeam) {
          console.log(`%c🎯 RETURNING: ${homeTeam}%c (${normCurrentTeam} is AWAY)`, 'color: #27ae60; font-weight: bold; font-size: 14px', '');
          console.log(`%c🔍 === OPPONENT DETECTION END ===%c\n`, 'color: #3498db; font-weight: bold; font-size: 14px', '');
          return homeTeam;
        }
      } else {
        console.log(`   ⏭️ Skipping - this is a FINAL game, looking for upcoming...`);
      }
    }
  }
  
  console.log(`%c❌ NO OPPONENT FOUND%c for ${normCurrentTeam}`, 'color: #e74c3c; font-weight: bold; font-size: 14px', '');
  console.log(`   Searched ${todaysGames.length} games, found ${matchingGames.length} matches`);
  if (matchingGames.length > 0) {
    console.table(matchingGames);
  }
  console.log(`%c🔍 === OPPONENT DETECTION END ===%c\n`, 'color: #3498db; font-weight: bold; font-size: 14px', '');
  return '';
};

// Static stat options - never change so no need to recreate on every render
const PLAYER_STAT_OPTIONS = [
  { key: "min", label: "MINS" }, { key: "pts", label: "PTS" }, { key: "reb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "pra", label: "PRA" }, // Points + Rebounds + Assists
  { key: "pr", label: "PR" },   // Points + Rebounds
  { key: "ra", label: "RA" },   // Rebounds + Assists
  { key: "fg3m", label: "3PM/A" },
  { key: "fg3_pct", label: "3P%" }, { key: "fgm", label: "FGM" }, { key: "fga", label: "FGA" },
  { key: "fg_pct", label: "FG%" }, { key: "stl", label: "STL" }, { key: "blk", label: "BLK" },
  { key: "ftm", label: "FTM" }, { key: "fta", label: "FTA" },
  { key: "ft_pct", label: "FT%" }, { key: "oreb", label: "OREB" }, { key: "dreb", label: "DREB" },
  { key: "turnover", label: "TO" }, { key: "pf", label: "PF" }
];

const TEAM_STAT_OPTIONS = [
  // Most important game props first
  { key: "moneyline", label: "MONEYLINE" },
  { key: "spread", label: "SPREAD" }, 
  { key: "total_pts", label: "TOTAL PTS" },
  // Other totals
  { key: "home_total", label: "HOME TOTAL" },
  { key: "away_total", label: "AWAY TOTAL" },
  { key: "first_half_total", label: "1H TOTAL" },
  { key: "second_half_total", label: "2H TOTAL" },
  { key: "q1_moneyline", label: "Q1 ML" },
  { key: "q1_total", label: "Q1 TOTAL" },
  { key: "q2_moneyline", label: "Q2 ML" },
  { key: "q2_total", label: "Q2 TOTAL" },
  { key: "q3_moneyline", label: "Q3 ML" },
  { key: "q3_total", label: "Q3 TOTAL" },
  { key: "q4_moneyline", label: "Q4 ML" },
  { key: "q4_total", label: "Q4 TOTAL" }
];

// Static chart configuration - never recreated
const CHART_CONFIG = {
  margin: { top: 22, right: 14, left: 0, bottom: 18 },
  colors: {
    green: '#10b981',
    red: '#ef4444', 
    purple: '#8b5cf6',
    referenceLine: '#8b5cf6'
  },
  xAxis: {
    height: 40, // Increased from 30 to provide more space for logos/padding
    interval: 0,
    allowDuplicatedCategory: false
  },
  yAxis: {
    width: 32 // tiny bit further from the wall on tablet/desktop
  },
  bar: {
    radius: [10, 10, 10, 10] as [number, number, number, number]
  },
  labelList: {
    position: 'top' as const,
    fontSize: '12px',
    fontWeight: 'bold'
  },
  // Performance optimizations
  performance: {
    debounceMs: 100, // Resize debounce
    maxBarSize: 80, // Limit bar width on large screens
    reduceMotion: true // Disable animations for performance
  }
};

// Unified tooltip style so bars and pie use the same hover look
const getUnifiedTooltipStyle = (isDarkMode: boolean) => ({
  backgroundColor: isDarkMode ? '#4b5563' : '#9ca3af', // match chart hover bg - grey in light mode
  color: isDarkMode ? '#FFFFFF' : '#000000', // white text in dark mode, black text in light mode
  border: '1px solid #9ca3af',
  borderRadius: '8px',
  padding: '12px',
  fontSize: '14px',
  zIndex: 9999 // High z-index to appear above betting line overlay
});


// StatTooltip component for advanced stats
const StatTooltip = ({ statName, value, definition }: { statName: string; value: React.ReactNode; definition?: string }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-1 relative">
        <span className="text-xs text-gray-700 dark:text-gray-300">{statName}</span>
        {definition && (
          <>
            <button
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              className="w-2.5 h-2.5 rounded-full text-[10px] font-bold flex items-center justify-center bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
            >
              ?
            </button>
            {showTooltip && (
              <div className="absolute z-50 left-0 bottom-5 w-32 px-2 py-1.5 text-xs leading-relaxed rounded border shadow-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                {definition}
              </div>
            )}
          </>
        )}
      </div>
      {value}
    </div>
  );
};

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
  
  if (!selectedPlayer) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Games</h3>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">Select a player to view their recent game logs</div>
          </div>
        </div>
      </div>
    );
  }

  if (!playerStats.length) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Games</h3>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">No game data available for {selectedPlayer.full}</div>
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
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
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
            <tr className={isDark ? 'bg-slate-900' : 'bg-slate-100'}>
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
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.min || '0:00'}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-bold">{game.pts || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.reb || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.ast || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.stl || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.blk || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fgm || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fga || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{fgPct}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fg3m || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fg3a || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{fg3Pct}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.ftm || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fta || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.turnover || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.pf || 0}</td>
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
// Memoized Official Odds card to avoid rerenders on chart state changes
const PureChart = memo(function PureChart({
  isLoading,
  chartData,
  yAxisConfig,
  isDark,
  bettingLine,
  selectedStat,
  currentStatOptions,
  apiError,
  selectedPlayer,
  propsMode,
  gamePropsTeam,
  customTooltip,
  selectedTimeframe,
}: any) {
  // Use the main tooltip instead - this old one is removed

  const formatChartLabel = useCallback((value: any): string => {
    const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    if (isPercentageStat) return `${numValue.toFixed(1)}%`;
    return `${numValue}`;
  }, [selectedStat]);

  return (
    <div className="h-full w-full">
      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <div className="text-gray-600 dark:text-gray-400">Loading player stats...</div>
          </div>
        </div>
      ) : (
        <StatsBarChart
          data={chartData}
          yAxisConfig={yAxisConfig}
          isDark={isDark}
          bettingLine={bettingLine}
          customTooltip={customTooltip}
          formatChartLabel={formatChartLabel}
          selectedStat={selectedStat}
          selectedTimeframe={selectedTimeframe}
        />
      )}
    </div>
  );
}, (prev, next) => (
  prev.isLoading === next.isLoading &&
  prev.chartData === next.chartData &&
  prev.yAxisConfig === next.yAxisConfig &&
  prev.isDark === next.isDark &&
  prev.bettingLine === next.bettingLine &&
  prev.selectedStat === next.selectedStat &&
  prev.currentStatOptions === next.currentStatOptions &&
  prev.apiError === next.apiError &&
  prev.selectedPlayer === next.selectedPlayer &&
  prev.propsMode === next.propsMode &&
  prev.gamePropsTeam === next.gamePropsTeam &&
  prev.customTooltip === next.customTooltip &&
  prev.selectedTimeframe === next.selectedTimeframe
));

// Per-button memoized components to prevent unrelated re-renders
const StatPill = memo(function StatPill({ label, value, isSelected, onSelect, isDark }: { label: string; value: string; isSelected: boolean; onSelect: (v: string) => void; isDark: boolean }) {
  const onClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <button
      onClick={onClick}
      className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
        isSelected ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  );
}, (prev, next) => prev.isSelected === next.isSelected && prev.label === next.label && prev.value === next.value && prev.isDark === next.isDark);

const TimeframeBtn = memo(function TimeframeBtn({ value, isSelected, onSelect }: { value: string; isSelected: boolean; onSelect: (v: string) => void }) {
  const onClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(value);
  }, [onSelect, value]);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ position: 'relative', zIndex: 50, pointerEvents: 'auto' }}
      className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer ${
        isSelected ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {value === 'h2h' ? 'H2H' : value === 'lastseason' ? 'Last Season' : value === 'thisseason' ? 'This Season' : value.replace('last','L')}
    </button>
  );
}, (prev, next) => prev.isSelected === next.isSelected && prev.value === next.value);

// Opponent selector component
const OpponentSelector = memo(function OpponentSelector({ 
  currentOpponent, 
  manualOpponent, 
  onOpponentChange, 
  isDark,
  propsMode,
  currentTeam,
  selectedTimeframe 
}: { 
  currentOpponent: string;
  manualOpponent: string;
  onOpponentChange: (opponent: string) => void;
  isDark: boolean;
  propsMode: string;
  currentTeam: string;
  selectedTimeframe: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [logoAttempts, setLogoAttempts] = useState<Record<string, number>>({});
  const allTeams = Object.keys(ABBR_TO_TEAM_ID).filter(team => team !== normalizeAbbr(currentTeam));
  
  // Determine what to display: ALL by default, or specific opponent when H2H or manually selected
  const displayValue = (() => {
    if (manualOpponent) return manualOpponent;
    if (selectedTimeframe === 'h2h' && currentOpponent) return currentOpponent;
    return 'ALL';
  })();
  
  // Create options list
  const options = [
    { value: 'ALL', label: 'ALL' },
    ...(currentOpponent ? [{ value: currentOpponent, label: currentOpponent }] : []),
    ...allTeams.sort().map(team => ({ value: team, label: team }))
  ].filter((option, index, array) => 
    // Remove duplicates (in case currentOpponent is already in allTeams)
    array.findIndex(o => o.value === option.value) === index
  );
  
  const handleSelect = (value: string) => {
    onOpponentChange(value);
    setIsOpen(false);
  };

  return (
    <div className="flex items-center gap-1 relative">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">VS</span>
      <div className="relative">
        {/* Custom dropdown trigger */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-16 sm:w-24 md:w-28 px-2 sm:px-2 md:px-3 py-2 sm:py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm sm:text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
        >
          <div className="flex items-center gap-1">
            {displayValue !== 'ALL' && (
              <img 
                src={(() => {
                  const candidates = getEspnLogoCandidates(displayValue);
                  const attempt = logoAttempts[`trigger-${displayValue}`] || 0;
                  return candidates[attempt] || candidates[0];
                })()} 
                alt={displayValue}
                className="w-5 h-5 object-contain"
                onError={(e) => {
                  const candidates = getEspnLogoCandidates(displayValue);
                  const currentAttempt = logoAttempts[`trigger-${displayValue}`] || 0;
                  const nextAttempt = currentAttempt + 1;
                  if (nextAttempt < candidates.length) {
                    setLogoAttempts(prev => ({ ...prev, [`trigger-${displayValue}`]: nextAttempt }));
                  } else {
                    e.currentTarget.style.display = 'none';
                  }
                }}
              />
            )}
            <span className="text-sm font-medium">{displayValue}</span>
          </div>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {/* Custom dropdown menu */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-20 sm:w-24 md:w-28 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto custom-scrollbar">
            {options.map(option => (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className="w-full px-2 py-2 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg last:rounded-b-lg flex items-center justify-center gap-1"
              >
                {option.value !== 'ALL' && (
                  <img 
                    src={(() => {
                      const candidates = getEspnLogoCandidates(option.value);
                      const attempt = logoAttempts[`option-${option.value}`] || 0;
                      return candidates[attempt] || candidates[0];
                    })()} 
                    alt={option.value}
                    className="w-5 h-5 object-contain"
                    onError={(e) => {
                      const candidates = getEspnLogoCandidates(option.value);
                      const currentAttempt = logoAttempts[`option-${option.value}`] || 0;
                      const nextAttempt = currentAttempt + 1;
                      if (nextAttempt < candidates.length) {
                        setLogoAttempts(prev => ({ ...prev, [`option-${option.value}`]: nextAttempt }));
                      } else {
                        e.currentTarget.style.display = 'none';
                      }
                    }}
                  />
                )}
                <span className="text-sm font-medium">{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Overlay to close dropdown when clicking outside */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}, (prev, next) => 
  prev.currentOpponent === next.currentOpponent && 
  prev.manualOpponent === next.manualOpponent && 
  prev.isDark === next.isDark &&
  prev.currentTeam === next.currentTeam &&
  prev.selectedTimeframe === next.selectedTimeframe
);

type AltLineItem = {
  bookmaker: string;
  line: number;
  over: string;
  under: string;
  isPickem?: boolean;
  variantLabel?: string | null;
};

const partitionAltLineItems = (lines: AltLineItem[]) => {
  // Separate milestones from over/under lines
  const milestones: AltLineItem[] = [];
  const overUnderLines: AltLineItem[] = [];
  
  for (const line of lines) {
    if (line.variantLabel === 'Milestone') {
      milestones.push(line);
    } else {
      overUnderLines.push(line);
    }
  }
  
  // Calculate consensus line (most common line value) for over/under lines only
  const lineCounts = new Map<number, number>();
  for (const line of overUnderLines) {
    lineCounts.set(line.line, (lineCounts.get(line.line) || 0) + 1);
  }
  
  let consensusLine: number | null = null;
  let maxCount = 0;
  for (const [line, count] of lineCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      consensusLine = line;
    }
  }
  
  // Group over/under lines by bookmaker
  const linesByBookmaker = new Map<string, AltLineItem[]>();
  for (const line of overUnderLines) {
    const key = (line.bookmaker || '').toLowerCase();
    if (!linesByBookmaker.has(key)) {
      linesByBookmaker.set(key, []);
    }
    linesByBookmaker.get(key)!.push(line);
  }
  
  // Identify primary line for each bookmaker (closest to consensus)
  const primaryLines = new Map<string, AltLineItem>();
  const alternate: AltLineItem[] = [];
  
  for (const [bookmaker, bookmakerLines] of linesByBookmaker.entries()) {
    if (bookmakerLines.length === 0) continue;
    
    let primaryLine = bookmakerLines[0]; // Default to first
    
    // If we have consensus and multiple lines, find closest to consensus
    if (consensusLine !== null && bookmakerLines.length > 1) {
      let closestLine = bookmakerLines[0];
      let minDiff = Math.abs(bookmakerLines[0].line - consensusLine);
      
      for (const line of bookmakerLines) {
        const diff = Math.abs(line.line - consensusLine);
        if (diff < minDiff) {
          minDiff = diff;
          closestLine = line;
        }
      }
      primaryLine = closestLine;
    }
    
    primaryLines.set(bookmaker, primaryLine);
    
    // All other lines for this bookmaker are alternates
    for (const line of bookmakerLines) {
      if (line.line !== primaryLine.line || 
          line.over !== primaryLine.over || 
          line.under !== primaryLine.under) {
        alternate.push(line);
      }
    }
  }
  
  const primary = Array.from(primaryLines.values());
  
  // Sort milestones by line value
  milestones.sort((a, b) => a.line - b.line);
  
  return { primary, alternate, milestones };
};

// Chart controls (updates freely with betting line changes)
const ChartControls = function ChartControls({
  isDark,
  currentStatOptions,
  selectedStat,
  onSelectStat,
  bettingLine,
  onChangeBettingLine,
  selectedTimeframe,
  onSelectTimeframe,
  chartData,
  currentOpponent,
  manualOpponent,
  onOpponentChange,
  propsMode,
  currentTeam,
  homeAway,
  onChangeHomeAway,
  yAxisConfig,
  realOddsData,
  fmtOdds,
  minMinutesFilter,
  maxMinutesFilter,
  onMinMinutesChange,
  onMaxMinutesChange,
  excludeBlowouts,
  excludeBackToBack,
  onExcludeBlowoutsChange,
  onExcludeBackToBackChange,
  rosterForSelectedTeam,
  withWithoutMode,
  setWithWithoutMode,
  teammateFilterId,
  setTeammateFilterId,
  loadingTeammateGames,
  clearTeammateFilter,
  lineMovementEnabled,
  intradayMovements,
}: any) {
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const latestMovement = lineMovementEnabled && intradayMovements && intradayMovements.length > 0
    ? intradayMovements[0]
    : null;
  // Track the latest in-progress line while the user is holding +/-
  const transientLineRef = useRef<number | null>(null);
  const holdDelayRef = useRef<any>(null);
  const holdRepeatRef = useRef<any>(null);
  
  // Alt Lines dropdown state
  const [isAltLinesOpen, setIsAltLinesOpen] = useState(false);
  const altLinesRef = useRef<HTMLDivElement>(null);
  // Track if betting line has been manually set (to avoid auto-updating when user changes it)
  const hasManuallySetLineRef = useRef(false);
  // Track previous odds data length to detect when new player data loads
  const prevOddsDataLengthRef = useRef<number>(0);
  // Track the last auto-set line to prevent infinite loops
  const lastAutoSetLineRef = useRef<number | null>(null);
  const lastAutoSetStatRef = useRef<string | null>(null);
  // Track which bookmaker was selected from the dropdown
  const [selectedBookmaker, setSelectedBookmaker] = useState<string | null>(null);
  // Debounce timer for betting line updates
  const bettingLineDebounceRef = useRef<NodeJS.Timeout | null>(null);
  // Track current line value for immediate bookmaker detection (updates instantly, separate from debounced bettingLine)
  const [displayLine, setDisplayLine] = useState(bettingLine);

  // Helper: resolve teammate ID from name + team using Ball Don't Lie /players endpoint
  const resolveTeammateIdFromNameLocal = async (name: string, teamAbbr?: string): Promise<number | null> => {
    try {
      if (!name) return null;
      const tryFetch = async (searchStr: string) => {
        const q = new URLSearchParams();
        q.set('endpoint', '/players');
        q.set('search', searchStr);
        q.set('per_page', '25');
        const maybeTeamId = teamAbbr ? ABBR_TO_TEAM_ID[normalizeAbbr(teamAbbr)] : undefined;
        if (maybeTeamId) q.append('team_ids[]', String(maybeTeamId));
        const url = `/api/balldontlie?${q.toString()}`;
        const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
        const js = await res?.json().catch(() => ({})) as any;
        const arr = Array.isArray(js?.data) ? js.data : [];
        return arr;
      };
      // 1) full name
      let results = await tryFetch(name);
      // 2) last name only if none
      if (!results.length) {
        const parts = name.split(' ').filter(Boolean);
        const last = parts[parts.length - 1] || name;
        results = await tryFetch(last);
      }
      if (!results.length) return null;
      const lower = name.trim().toLowerCase();
      const exact = results.find((p: any) => `${p.first_name} ${p.last_name}`.trim().toLowerCase() === lower);
      const chosen = exact || results[0];
      return typeof chosen?.id === 'number' ? chosen.id : null;
    } catch {
      return null;
    }
  };

  // Sync input and dashed line to the committed bettingLine value.
  // Only track bettingLine/yAxisConfig to avoid racing with timeframe updates.
  useEffect(() => {
    const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
    if (!input) return;
    const val = Number.isFinite(bettingLine) ? bettingLine : 0;
    input.value = String(val);
    updateBettingLinePosition(yAxisConfig, val);
  }, [bettingLine, yAxisConfig]);

  // Fast recolor (no React) when the transient input value changes while holding +/-
  const recolorBarsFast = (value: number) => {
    const rects = document.querySelectorAll('[data-bar-index]');
    rects.forEach((el: any) => {
      const idxAttr = el.getAttribute('data-bar-index');
      const i = idxAttr != null ? parseInt(idxAttr, 10) : NaN;
      if (!Number.isFinite(i) || !chartData[i]) return;
      const barValue = chartData[i].value;
      const isOver = selectedStat === 'spread' ? (barValue < value) : (barValue > value);
      const isPush = barValue === value;
      const newState = isOver ? 'over' : isPush ? 'push' : 'under';
      if (el.getAttribute('data-state') === newState) return;
      el.setAttribute('data-state', newState);
      el.setAttribute('fill', newState === 'over' ? '#10b981' : newState === 'push' ? '#9ca3af' : '#ef4444');
    });
  };

  // Update Over Rate pill instantly for a given line value (no React rerender)
  const updateOverRatePillFast = useCallback((value: number) => {
    const overCount = selectedStat === 'spread'
      ? chartData.filter((d: any) => d.value < value).length
      : chartData.filter((d: any) => d.value > value).length;
    const total = chartData.length;
    const pct = total > 0 ? (overCount / total) * 100 : 0;

    const nodes = document.querySelectorAll('[data-over-rate], [data-over-rate-inline]');
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      el.textContent = `${overCount}/${total} (${pct.toFixed(1)}%)`;
      if (el.hasAttribute('data-over-rate')) {
        const cls = pct >= 60
          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
          : pct >= 40
          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
        el.className = `px-1 sm:px-2 py-1 sm:py-1.5 rounded text-xs sm:text-sm font-bold ${cls} whitespace-nowrap`;
      }
    });
  }, [chartData, selectedStat]);

  // On timeframe change, commit the most recent transient line (if any),
  // otherwise keep the existing bettingLine. Avoid reading stale defaultValue.
  useEffect(() => {
    const commit = transientLineRef.current;
    if (commit != null && commit !== bettingLine) {
      onChangeBettingLine(commit);
    }
    // Always reposition overlay after the chart finishes its layout for new timeframe
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => updateBettingLinePosition(yAxisConfig, commit ?? bettingLine));
    }
  }, [selectedTimeframe]);
  // Dropdown state for timeframe selector (moved outside useMemo to follow hooks rules)
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  // Local accordion state for minutes filter
  const [isMinutesFilterOpen, setIsMinutesFilterOpen] = useState(false);
  // Close Advanced when clicking outside (desktop or mobile containers)
  const advancedDesktopRef = useRef<HTMLDivElement | null>(null);
  const advancedMobileRef = useRef<HTMLDivElement | null>(null);
  const advancedMobilePortalRef = useRef<HTMLDivElement | null>(null);

  // (With/Without teammate options now come directly from depth chart roster)
  useEffect(() => {
    if (!isAdvancedFiltersOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const inDesktop = advancedDesktopRef.current?.contains(target);
      const inMobile = advancedMobileRef.current?.contains(target);
      const inMobilePortal = advancedMobilePortalRef.current?.contains(target);
      if (inDesktop || inMobile || inMobilePortal) return;
      setIsAdvancedFiltersOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [isAdvancedFiltersOpen]);

  
  // Update Over Rate when committed line or data changes
  useEffect(() => {
    updateOverRatePillFast(bettingLine);
  }, [updateOverRatePillFast, bettingLine]);
  
  // Reset selectedBookmaker when stat changes
  useEffect(() => {
    setSelectedBookmaker(null);
    setDisplayLine(bettingLine);
  }, [selectedStat]);
  
  // Sync displayLine with bettingLine when it changes externally
  useEffect(() => {
    if (!hasManuallySetLineRef.current) {
      setDisplayLine(bettingLine);
    }
  }, [bettingLine]);
  
  // Helper function to get bookmaker info
  const normalizeBookNameForLookup = (name: string) => {
    if (!name) return '';
    return name.replace(/\s+Pick'?em.*$/i, '').trim();
  };

  const isPickemBookmakerName = (name: string | null | undefined): boolean => {
    if (!name) return false;
    return /pick'?em/i.test(name);
  };

  const getPickemVariantFromName = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const match = name.match(/\(([^)]+)\)\s*$/);
    return match ? match[1] : null;
  };

  // Use the centralized bookmaker info from lib/bookmakers.ts
  const getBookmakerInfo = (name: string) => {
    return getBookmakerInfoFromLib(name);
  };

  // Display helper: always show + for positive lines
  const fmtLine = (line: number | string): string => {
    const n = typeof line === 'number' ? line : parseFloat(String(line));
    if (!Number.isFinite(n)) return String(line);
    return n > 0 ? `+${n}` : `${n}`;
  };

  // Map selectedStat -> odds book key
  const getBookRowKey = (stat: string | null | undefined): string | null => {
    const map: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'fg3m': 'THREES',
      'pra': 'PRA',
      'pr': 'PR',
      'pa': 'PA',
      'ra': 'RA',
      'spread': 'Spread',
      'total_pts': 'Total',
      'moneyline': 'H2H',
    };
    return stat ? (map[stat] || null) : null;
  };
  
  // Calculate best bookmaker and line for stat (lowest over line)
  const bestBookmakerForStat = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0) return null;

    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return null;
    
    let bestBook: any = null;
    let bestLine = Infinity;
    
    for (const book of realOddsData) {
      const statData = (book as any)[bookRowKey];
      if (!statData || statData.line === 'N/A') continue;
      const lineValue = parseFloat(statData.line);
      if (isNaN(lineValue)) continue;
      if (lineValue < bestLine) {
        bestLine = lineValue;
        bestBook = book;
      }
    }
    
    return bestBook ? bestBook.name : null;
  }, [realOddsData, selectedStat]);
  
  // Calculate best line for stat (lowest over line) - exclude alternate lines
  const bestLineForStat = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0) return null;

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
  }, [realOddsData, selectedStat]);
  
  // Auto-set betting line to best available line when odds data loads (only if user hasn't manually set it)
  useEffect(() => {
    if (bestLineForStat !== null && !hasManuallySetLineRef.current) {
      // Only auto-set if:
      // 1. The line hasn't been auto-set for this stat yet, OR
      // 2. The best line has changed from what we last auto-set, OR
      // 3. The current line is the default 0.5 (meaning no line was stored for this stat)
      const currentBettingLine = bettingLine;
      const isDefaultLine = Math.abs(currentBettingLine - 0.5) < 0.01;
      
      const shouldAutoSet = 
        lastAutoSetStatRef.current !== selectedStat ||
        lastAutoSetLineRef.current === null ||
        isDefaultLine ||
        Math.abs((lastAutoSetLineRef.current || 0) - bestLineForStat) > 0.01;
      
      if (shouldAutoSet) {
        // Only update if the current betting line is different from the best line
        if (Math.abs(currentBettingLine - bestLineForStat) > 0.01) {
          onChangeBettingLine(bestLineForStat);
          setDisplayLine(bestLineForStat);
          lastAutoSetLineRef.current = bestLineForStat;
          lastAutoSetStatRef.current = selectedStat;
          
          // Update input field
          const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
          if (input) {
            input.value = String(bestLineForStat);
            transientLineRef.current = bestLineForStat;
            // Update visual elements
            if (yAxisConfig) {
              updateBettingLinePosition(yAxisConfig, bestLineForStat);
            }
            recolorBarsFast(bestLineForStat);
            updateOverRatePillFast(bestLineForStat);
          }
        } else {
          // Line is already set correctly, just update the refs
          lastAutoSetLineRef.current = bestLineForStat;
          lastAutoSetStatRef.current = selectedStat;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestLineForStat, selectedStat]);
  
  // Reset manual flag when stat changes (allow auto-fetch for new stat)
  useEffect(() => {
    hasManuallySetLineRef.current = false;
    lastAutoSetLineRef.current = null;
    lastAutoSetStatRef.current = null;
  }, [selectedStat]);
  
  // Reset manual flag when odds data loads (new player fetched)
  useEffect(() => {
    const currentLength = realOddsData?.length || 0;
    const prevLength = prevOddsDataLengthRef.current;
    
    // If data changed from empty to having data, reset manual flag to allow auto-fetch
    if (prevLength === 0 && currentLength > 0) {
      hasManuallySetLineRef.current = false;
      lastAutoSetLineRef.current = null;
      lastAutoSetStatRef.current = null;
    }
    
    prevOddsDataLengthRef.current = currentLength;
  }, [realOddsData]);
  
  // Auto-update selected bookmaker when line changes and matches a bookmaker (uses displayLine for immediate updates)
  // This includes alternate lines (Goblin/Demon variants) so users see the variant when they set a matching line
  useEffect(() => {
    if (!realOddsData || realOddsData.length === 0) return;
    
    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return;
    
    // Find ALL bookmaker entries that have a line matching the current display line
    // This includes alternate lines (Goblin/Demon variants) - prioritize exact matches including variants
    const matchingBooks = realOddsData.filter((book: any) => {
      const statData = (book as any)[bookRowKey];
      if (!statData || statData.line === 'N/A') return false;
      const lineValue = parseFloat(statData.line);
      if (isNaN(lineValue)) return false;
      return Math.abs(lineValue - displayLine) < 0.01;
    });
    
    if (matchingBooks.length > 0) {
      // Prioritize entries with variant labels (Goblin/Demon) if they match the line
      // This way when a user sets a line that matches a Goblin/Demon variant, it shows that variant
      const variantMatch = matchingBooks.find((book: any) => {
        const meta = (book as any)?.meta;
        return meta?.variantLabel && (meta.variantLabel === 'Goblin' || meta.variantLabel === 'Demon');
      });
      
      const bookToSelect = variantMatch || matchingBooks[0];
      const bookName = (bookToSelect as any)?.meta?.baseName || bookToSelect?.name;
      
      // Only update if it's different from current selection
      setSelectedBookmaker(prev => prev !== bookName ? bookName : prev);
    } else {
      // Clear selection if no bookmaker matches
      setSelectedBookmaker(prev => prev !== null ? null : prev);
    }
  }, [displayLine, realOddsData, selectedStat]);
  
   const StatPills = useMemo(() => (
      <div className="mb-4 sm:mb-5 md:mb-4 mt-1 sm:mt-0">
        <div
          className="w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar"
        >
          <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
            {currentStatOptions.map((s: any) => (
              <StatPill key={s.key} label={s.label} value={s.key} isSelected={selectedStat === s.key} onSelect={onSelectStat} isDark={isDark} />
            ))}
          </div>
        </div>
      </div>
    ), [isDark, currentStatOptions, selectedStat, onSelectStat]);

    const TimeframeButtons = useMemo(() => {
      const timeframeOptions = [
        { value: 'last5', label: 'L5' },
        { value: 'last10', label: 'L10' },
        { value: 'last15', label: 'L15' },
        { value: 'last20', label: 'L20' },
        { value: 'h2h', label: 'H2H' },
        { value: 'lastseason', label: 'Last Season' },
        { value: 'thisseason', label: 'This Season' }
      ];

      const selectedOption = timeframeOptions.find(opt => opt.value === selectedTimeframe);

      return (
        <>
          {/* Desktop Layout - Only show on larger screens */}
          <div className="hidden xl:flex flex-col gap-1 sm:gap-2">
            {/* First row: L5, L10, L15, L20, H2H */}
            <div className="flex items-center gap-1 sm:gap-2">
              {['last5','last10','last15','last20','h2h'].map((k: string) => (
                <TimeframeBtn key={k} value={k} isSelected={selectedTimeframe === k} onSelect={onSelectTimeframe} />
              ))}
            </div>
            {/* Second row: Last Season, This Season */}
            <div className="flex items-center gap-1 sm:gap-2">
              {['lastseason','thisseason'].map((k: string) => (
                <TimeframeBtn key={k} value={k} isSelected={selectedTimeframe === k} onSelect={onSelectTimeframe} />
              ))}
            </div>
          </div>

          {/* Compact/Mobile Dropdown - Show earlier */}
          <div className="xl:hidden relative">
            <button
              onClick={() => setIsTimeframeDropdownOpen(!isTimeframeDropdownOpen)}
              className="w-16 sm:w-24 md:w-28 lg:w-32 px-2 sm:px-2 md:px-3 py-2.5 sm:py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm sm:text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              <span className="truncate">{selectedOption?.label || 'Timeframe'}</span>
              <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {/* Dropdown Menu */}
            {isTimeframeDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-16 sm:w-24 md:w-28 lg:w-32 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                {timeframeOptions.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectTimeframe(option.value);
                      setIsTimeframeDropdownOpen(false);
                    }}
                    className={`w-full px-1.5 sm:px-2 md:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg last:rounded-b-lg ${
                      selectedTimeframe === option.value
                        ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {/* Overlay to close dropdown when clicking outside */}
            {isTimeframeDropdownOpen && (
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setIsTimeframeDropdownOpen(false)}
              />
            )}
          </div>
        </>
      );
    }, [selectedTimeframe, onSelectTimeframe, isTimeframeDropdownOpen, setIsTimeframeDropdownOpen]);

    // Always show controls, even when no data, so users can adjust filters/timeframes

    return (
      <>
        {StatPills}
        {/* Responsive controls layout */}
        <div className="space-y-2 sm:space-y-3 md:space-y-4 mb-2 sm:mb-3 md:mb-4 lg:mb-6">
          {/* Top row: Line input (left), Over Rate (center-left), Team vs + Timeframes (right) */}
          <div className="flex items-center flex-wrap gap-1 sm:gap-2 md:gap-3 pl-0 sm:pl-0 ml-2 sm:ml-6">
            {/* Alt Lines Dropdown - Desktop only */}
            {(() => {
              const bookRowKey = getBookRowKey(selectedStat);
              const isMoneyline = selectedStat === 'moneyline';
              
              // Get all available lines for dropdown
              const altLines: AltLineItem[] = realOddsData && realOddsData.length > 0 && bookRowKey
                ? (realOddsData
                    .map((book: any) => {
                      const statData = (book as any)[bookRowKey];
                      if (!statData) return null;
                      
                      // For moneyline (H2H), handle home/away odds differently
                      if (isMoneyline) {
                        if (statData.home === 'N/A' && statData.away === 'N/A') return null;
                        const meta = (book as any).meta || {};
                        return {
                          bookmaker: meta.baseName || book.name,
                          line: 0, // Moneyline doesn't have a line value
                          over: statData.home, // Use home as "over"
                          under: statData.away, // Use away as "under"
                          isPickem: meta.isPickem ?? false,
                          variantLabel: meta.variantLabel ?? null,
                        } as AltLineItem;
                      }
                      
                      // For spread/total (has line value)
                      if (statData.line === 'N/A') return null;
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
                    .filter((item: AltLineItem | null): item is AltLineItem => item !== null))
                : [];
              
              altLines.sort((a: AltLineItem, b: AltLineItem) => {
                // First, separate milestones from over/under lines
                const isMilestoneA = a.variantLabel === 'Milestone';
                const isMilestoneB = b.variantLabel === 'Milestone';
                if (isMilestoneA !== isMilestoneB) {
                  // Over/under lines come first (isMilestone = false = 0), milestones come after (true = 1)
                  return (isMilestoneA ? 1 : 0) - (isMilestoneB ? 1 : 0);
                }
                
                // Within same type, sort by pick'em status
                const isPickemA = a.isPickem ? 0 : 1;
                const isPickemB = b.isPickem ? 0 : 1;
                if (isPickemA !== isPickemB) return isPickemA - isPickemB;
                
                // For moneyline, sort by bookmaker name instead of line
                if (isMoneyline) {
                  return (a.bookmaker || '').localeCompare(b.bookmaker || '');
                }
                return a.line - b.line;
              });
              const { primary: primaryAltLines, alternate: alternateAltLines, milestones: milestoneLines } = partitionAltLineItems(altLines);
              const renderAltLineButton = (altLine: AltLineItem, idx: number) => {
                const bookmakerInfo = getBookmakerInfo(altLine.bookmaker);
                const isSelected = Math.abs(altLine.line - displayLine) < 0.01;
                const isPickemAlt = altLine.isPickem ?? false;
                const pickemVariant = altLine.variantLabel ?? null;

                return (
                  <button
                    key={`${altLine.bookmaker}-${altLine.line}-${idx}`}
                    onClick={() => {
                      onChangeBettingLine(altLine.line);
                      setSelectedBookmaker(altLine.bookmaker);
                      setIsAltLinesOpen(false);
                      const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
                      if (input) {
                        input.value = String(altLine.line);
                        transientLineRef.current = altLine.line;
                        updateBettingLinePosition(yAxisConfig, altLine.line);
                        recolorBarsFast(altLine.line);
                        updateOverRatePillFast(altLine.line);
                      }
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      isSelected ? 'bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-600' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Bookmaker Logo */}
                      {bookmakerInfo.logoUrl ? (
                        <img 
                          src={bookmakerInfo.logoUrl} 
                          alt={bookmakerInfo.name}
                          className="w-5 h-5 rounded object-contain flex-shrink-0"
                            onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <span 
                        className={`text-xs font-semibold text-white px-1.5 py-0.5 rounded flex-shrink-0 items-center justify-center min-w-[1.25rem] h-5 ${!bookmakerInfo.logoUrl ? 'flex' : 'hidden'}`}
                        style={{ backgroundColor: bookmakerInfo.color }}
                      >
                        {bookmakerInfo.logo}
                      </span>
                      
                      {/* Line and Bookmaker Name */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {!isMoneyline && (
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                              {fmtLine(altLine.line)}
                            </span>
                          )}
                          {isMoneyline && (
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                              ML
                            </span>
                          )}
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {bookmakerInfo.name}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Odds */}
                    {!isPickemAlt ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {altLine.over && altLine.over !== 'N/A' && altLine.over !== 'Pick\'em' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            isMoneyline 
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' 
                              : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          }`}>
                            {isMoneyline ? 'Home' : 'O'} {fmtOdds(altLine.over)}
                          </span>
                        )}
                        {altLine.under && altLine.under !== 'N/A' && altLine.under !== 'Pick\'em' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            isMoneyline 
                              ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' 
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {isMoneyline ? 'Away' : 'U'} {fmtOdds(altLine.under)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {pickemVariant === 'Goblin' && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? (
                          <img 
                            src="/images/goblin.png" 
                            alt="Goblin" 
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = document.createElement('span');
                              fallback.className = 'text-lg leading-none';
                              fallback.textContent = '👹';
                              if (img.parentElement && img.nextSibling) {
                                img.parentElement.insertBefore(fallback, img.nextSibling);
                              } else if (img.parentElement) {
                                img.parentElement.appendChild(fallback);
                              }
                            }}
                          />
                        ) : pickemVariant === 'Demon' && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? (
                          <img 
                            src="/images/demon.png" 
                            alt="Demon" 
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = document.createElement('span');
                              fallback.className = 'text-lg leading-none';
                              fallback.textContent = '😈';
                              if (img.parentElement && img.nextSibling) {
                                img.parentElement.insertBefore(fallback, img.nextSibling);
                              } else if (img.parentElement) {
                                img.parentElement.appendChild(fallback);
                              }
                            }}
                          />
                        ) : (
                          <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-[10px] font-semibold">
                            Pick&apos;em
                          </span>
                        )}
                      </div>
                    )}
                    
                    {/* Selected indicator */}
                    {isSelected && (
                      <svg className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              };
              
              // Find the bookmaker to display: find the bookmaker whose PRIMARY line matches displayLine
              const displayBookmaker = (() => {
                if (!realOddsData || realOddsData.length === 0) return null;
                
                // console.log('[DEBUG] Finding displayBookmaker for displayLine:', displayLine, 'selectedStat:', selectedStat, 'bookRowKey:', bookRowKey);
                
                // Track all lines per bookmaker to identify the true primary line
                const allLinesByBookmaker = new Map<string, Array<{line: number; over: string; under: string; isPickem: boolean; variantLabel: string | null}>>();
                
                // First pass: collect ALL lines for each bookmaker
                for (const book of realOddsData) {
                  const meta = (book as any)?.meta;
                  const baseName = (meta?.baseName || book?.name || '');
                  const baseNameLower = baseName.toLowerCase();
                  const statKey: string = meta?.stat || bookRowKey;
                  
                  // Only consider entries matching the selected stat
                  if (statKey !== bookRowKey) continue;
                  
                  const statData = (book as any)[bookRowKey];
                  if (!statData || statData.line === 'N/A') continue;
                  const lineValue = parseFloat(statData.line);
                  if (isNaN(lineValue)) continue;
                  
                  if (!allLinesByBookmaker.has(baseNameLower)) {
                    allLinesByBookmaker.set(baseNameLower, []);
                  }
                  
                  allLinesByBookmaker.get(baseNameLower)!.push({
                    line: lineValue,
                    over: statData.over,
                    under: statData.under,
                    isPickem: meta?.isPickem ?? false,
                    variantLabel: meta?.variantLabel ?? null,
                  });
                }
                
                // Calculate consensus line by finding the most common line value across ALL bookmakers
                // Count all line values, not just first lines
                const lineCounts = new Map<number, number>();
                for (const [bookmaker, lines] of allLinesByBookmaker.entries()) {
                  for (const line of lines) {
                    lineCounts.set(line.line, (lineCounts.get(line.line) || 0) + 1);
                  }
                }
                
                // Find the most common line (this is our consensus)
                let consensusLine: number | null = null;
                let maxCount = 0;
                for (const [line, count] of lineCounts.entries()) {
                  if (count > maxCount) {
                    maxCount = count;
                    consensusLine = line;
                  }
                }
                
                // console.log('[DEBUG] Consensus line (most common across all):', consensusLine, 'appears', maxCount, 'times');
                
                // Second pass: identify primary line for each bookmaker
                // Primary line is ALWAYS the one closest to consensus (if consensus exists)
                const primaryLinesByBookmaker = new Map<string, any>();
                for (const [baseNameLower, lines] of allLinesByBookmaker.entries()) {
                  if (lines.length === 0) continue;
                  
                  let primaryLine = lines[0]; // Default to first
                  
                  // If we have a consensus line, ALWAYS use the line closest to it
                  if (consensusLine !== null && lines.length > 1) {
                    let closestLine = lines[0];
                    let minDiff = Math.abs(lines[0].line - consensusLine);
                    
                    for (const line of lines) {
                      const diff = Math.abs(line.line - consensusLine);
                      if (diff < minDiff) {
                        minDiff = diff;
                        closestLine = line;
                      }
                    }
                    
                    // Always use the closest line to consensus (no threshold)
                    primaryLine = closestLine;
                    // console.log('[DEBUG] Bookmaker', baseNameLower, '- closest to consensus', consensusLine, 'is', primaryLine.line, '(diff:', minDiff, ')');
                  }
                  
                  // Get the original bookmaker name (preserve case)
                  const firstBook = realOddsData.find((book: any) => {
                    const meta = (book as any)?.meta;
                    const name = (meta?.baseName || book?.name || '').toLowerCase();
                    return name === baseNameLower;
                  });
                  const displayName = firstBook ? ((firstBook as any)?.meta?.baseName || firstBook?.name || baseNameLower) : baseNameLower;
                  
                  primaryLinesByBookmaker.set(baseNameLower, {
                    bookmaker: displayName,
                    line: primaryLine.line,
                    over: primaryLine.over,
                    under: primaryLine.under,
                    isPickem: primaryLine.isPickem,
                    variantLabel: primaryLine.variantLabel,
                  });
                  
                  // console.log('[DEBUG] Found primary line:', displayName, 'line:', primaryLine.line, 'over:', primaryLine.over, 'under:', primaryLine.under, '(from', lines.length, 'total lines)');
                }
                
                // console.log('[DEBUG] Primary lines map:', Array.from(primaryLinesByBookmaker.entries()).map(([name, data]) => `${name}: ${data.line}`));
                
                // Debug: Show all Bovada lines (including alternates)
                const bovadaLines = bookRowKey ? realOddsData
                  .filter((book: any) => {
                    const meta = (book as any)?.meta;
                    const baseName = (meta?.baseName || book?.name || '').toLowerCase();
                    return baseName.includes('bovada');
                  })
                  .map((book: any) => {
                    const meta = (book as any)?.meta;
                    const statData = (book as any)[bookRowKey];
                    return {
                      baseName: meta?.baseName || book?.name,
                      stat: meta?.stat,
                      line: statData ? statData.line : 'N/A',
                      over: statData ? statData.over : 'N/A',
                      under: statData ? statData.under : 'N/A',
                    };
                  }) : [];
                // console.log('[DEBUG] All Bovada lines for', bookRowKey, ':', bovadaLines);
                
                // console.log('[DEBUG] selectedBookmaker:', selectedBookmaker);
                
                // Second pass: find the bookmaker entry that matches displayLine
                // If selectedBookmaker is set, check ALL lines (including alternates/Goblin/Demon) for that bookmaker
                if (selectedBookmaker) {
                  const selectedLower = selectedBookmaker.toLowerCase();
                  
                  // First, try to find an exact match in realOddsData (includes alternate lines with variants)
                  const exactMatch = bookRowKey ? realOddsData.find((book: any) => {
                    const meta = (book as any)?.meta;
                    const baseName = (meta?.baseName || book?.name || '').toLowerCase();
                    if (baseName !== selectedLower) return false;
                    
                    const statData = (book as any)[bookRowKey];
                    if (!statData || statData.line === 'N/A') return false;
                    const lineValue = parseFloat(statData.line);
                    if (isNaN(lineValue)) return false;
                    return Math.abs(lineValue - displayLine) < 0.01;
                  }) : null;
                  
                  if (exactMatch && bookRowKey) {
                    const meta = (exactMatch as any)?.meta;
                    const statData = (exactMatch as any)[bookRowKey];
                    const result = {
                      bookmaker: meta?.baseName || exactMatch?.name || selectedBookmaker,
                      line: parseFloat(statData.line),
                      over: statData.over,
                      under: statData.under,
                      isPickem: meta?.isPickem ?? false,
                      variantLabel: meta?.variantLabel ?? null,
                    };
                    // console.log('[DEBUG] Found exact match (including variant):', result);
                    return result;
                  }
                  
                  // Fallback to primary line if no exact match found
                  const selectedPrimary = primaryLinesByBookmaker.get(selectedLower);
                  // console.log('[DEBUG] Checking selectedBookmaker:', selectedBookmaker, 'lower:', selectedLower, 'found:', selectedPrimary);
                  if (selectedPrimary && Math.abs(selectedPrimary.line - displayLine) < 0.01) {
                    // console.log('[DEBUG] Using selectedBookmaker primary line:', selectedPrimary);
                    return selectedPrimary;
                  } else if (selectedPrimary) {
                    // console.log('[DEBUG] Selected bookmaker line mismatch:', selectedPrimary.line, 'vs displayLine:', displayLine, 'diff:', Math.abs(selectedPrimary.line - displayLine));
                  }
                }
                
                // Otherwise, find the first bookmaker whose primary line matches
                for (const [bookmakerLower, primaryData] of primaryLinesByBookmaker.entries()) {
                  if (Math.abs(primaryData.line - displayLine) < 0.01) {
                    // console.log('[DEBUG] Found matching primary line:', bookmakerLower, primaryData);
                    return primaryData;
                  }
                }
                
                // console.log('[DEBUG] No matching primary line found for displayLine:', displayLine);
                return null;
              })();
              
              // console.log('[DEBUG] Final displayBookmaker result:', displayBookmaker);
              
              const displayIsPickem = displayBookmaker ? (displayBookmaker.isPickem ?? isPickemBookmakerName(displayBookmaker.bookmaker)) : false;
              const displayPickemVariant = displayBookmaker ? (displayBookmaker.variantLabel ?? null) : null;
              const bookmakerInfo = displayBookmaker ? getBookmakerInfo(displayBookmaker.bookmaker) : null;
              const shouldShowBookmaker = displayBookmaker !== null;
              
              return (
                <div className="hidden sm:block relative flex-shrink-0 w-[100px] sm:w-[110px] md:w-[120px]" ref={altLinesRef}>
                  <button
                    onClick={() => setIsAltLinesOpen(!isAltLinesOpen)}
                    className="w-full px-1.5 sm:px-2 py-1 sm:py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors h-[32px] sm:h-[36px] overflow-hidden"
                  >
                    <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-hidden">
                      {shouldShowBookmaker && bookmakerInfo && displayBookmaker ? (
                        <>
                          {bookmakerInfo.logoUrl ? (
                            <img 
                              src={bookmakerInfo.logoUrl} 
                              alt={bookmakerInfo.name}
                              className="w-6 h-6 sm:w-7 sm:h-7 rounded object-contain flex-shrink-0"
                            onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                            />
                          ) : null}
                          <span 
                            className={`text-xs font-semibold text-white px-1.5 py-0.5 rounded flex-shrink-0 items-center justify-center min-w-[1.25rem] h-5 ${!bookmakerInfo.logoUrl ? 'flex' : 'hidden'}`}
                            style={{ backgroundColor: bookmakerInfo.color }}
                          >
                            {bookmakerInfo.logo}
                          </span>
                          {/* Show Goblin/Demon symbol inline with logo for PrizePicks */}
                          {bookmakerInfo.name === 'PrizePicks' && displayIsPickem && displayPickemVariant ? (
                            <img 
                              src={displayPickemVariant === 'Goblin' ? '/images/goblin.png' : '/images/demon.png'} 
                              alt={displayPickemVariant} 
                              className="w-7 h-7 sm:w-8 sm:h-8 object-contain flex-shrink-0 ml-0.5 mt-0.5"
                              onError={(e) => {
                                // Fallback to text if image fails
                                const img = e.target as HTMLImageElement;
                                img.style.display = 'none';
                                const fallback = document.createElement('span');
                                fallback.className = 'text-[11px] sm:text-xs text-purple-600 dark:text-purple-300 font-semibold whitespace-nowrap';
                                fallback.textContent = (bookmakerInfo.name === 'Underdog' || bookmakerInfo.name === 'DraftKings Pick6') ? `Pick'em` : `Pick'em • ${displayPickemVariant}`;
                                if (img.parentElement && img.nextSibling) {
                                  img.parentElement.insertBefore(fallback, img.nextSibling);
                                } else if (img.parentElement) {
                                  img.parentElement.appendChild(fallback);
                                }
                              }}
                            />
                          ) : !displayIsPickem ? (
                            <div className="flex flex-col items-start gap-0.5 min-w-0">
                              {isMoneyline ? (
                                <span className="text-[11px] sm:text-xs text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                                  {bookmakerInfo.name}
                                </span>
                              ) : (
                                <>
                                  {displayBookmaker.over && displayBookmaker.over !== 'N/A' && (
                                    <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                                      O&nbsp;{fmtOdds(displayBookmaker.over)}
                                    </span>
                                  )}
                                  {displayBookmaker.under && displayBookmaker.under !== 'N/A' && (
                                    <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                                      U&nbsp;{fmtOdds(displayBookmaker.under)}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] sm:text-xs text-purple-600 dark:text-purple-300 font-semibold whitespace-nowrap">
                              Pick&apos;em{displayPickemVariant && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? ` • ${displayPickemVariant}` : ''}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Placeholder for logo space */}
                          <div className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" />
                          {/* Text in same structure as odds column */}
                          <div className="flex flex-col items-start gap-0.5 min-w-0">
                            <span className="text-[11px] sm:text-xs text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">Alt Lines</span>
                          </div>
                        </>
                      )}
                    </div>
                    <svg 
                      className={`w-4 h-4 transition-transform flex-shrink-0 ml-auto ${isAltLinesOpen ? 'rotate-180' : ''}`}
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {isAltLinesOpen && (
                    <>
                      <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 min-w-[280px] max-w-[320px] max-h-[400px] overflow-y-auto">
                        <div className="p-3 border-b border-gray-200 dark:border-gray-600">
                          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Alt Lines</div>
                        </div>
                        <div className="p-2">
                          {altLines.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                              {!realOddsData || realOddsData.length === 0 ? 'Loading odds data...' : 'No alternative lines available'}
                            </div>
                          ) : (
                            <>
                              {primaryAltLines.map(renderAltLineButton)}
                              {alternateAltLines.length > 0 && (
                                <>
                                  <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Alternate Lines
                                  </div>
                                  {alternateAltLines.map((altLine, idx) =>
                                    renderAltLineButton(altLine, idx + primaryAltLines.length)
                                  )}
                                </>
                              )}
                              {milestoneLines.length > 0 && (
                                <>
                                  <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Milestones
                                  </div>
                                  {milestoneLines.map((altLine, idx) =>
                                    renderAltLineButton(altLine, idx + primaryAltLines.length + alternateAltLines.length)
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsAltLinesOpen(false)}
                      />
                    </>
                  )}
                </div>
              );
            })()}
            
            {/* Left: line input */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-0.5 sm:gap-3 -mt-1 sm:mt-0">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {/* Alt Lines Button - Mobile only */}
                {(() => {
                  const bookRowKey = getBookRowKey(selectedStat);
                  const isMoneyline = selectedStat === 'moneyline';
                  
                  // Get all available lines for dropdown
              const altLines: AltLineItem[] = realOddsData && realOddsData.length > 0 && bookRowKey
                ? (realOddsData
                    .map((book: any) => {
                      const statData = (book as any)[bookRowKey];
                      if (!statData) return null;
                      
                      // For moneyline (H2H), handle home/away odds differently
                      if (isMoneyline) {
                        if (statData.home === 'N/A' && statData.away === 'N/A') return null;
                        const meta = (book as any).meta || {};
                        return {
                          bookmaker: meta.baseName || book.name,
                          line: 0, // Moneyline doesn't have a line value
                          over: statData.home, // Use home as "over"
                          under: statData.away, // Use away as "under"
                          isPickem: meta.isPickem ?? false,
                          variantLabel: meta.variantLabel ?? null,
                        } as AltLineItem;
                      }
                      
                      // For spread/total (has line value)
                      if (statData.line === 'N/A') return null;
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
                    .filter((item: AltLineItem | null): item is AltLineItem => item !== null))
                : [];
              
              altLines.sort((a: AltLineItem, b: AltLineItem) => {
                // First, separate milestones from over/under lines
                const isMilestoneA = a.variantLabel === 'Milestone';
                const isMilestoneB = b.variantLabel === 'Milestone';
                if (isMilestoneA !== isMilestoneB) {
                  // Over/under lines come first (isMilestone = false = 0), milestones come after (true = 1)
                  return (isMilestoneA ? 1 : 0) - (isMilestoneB ? 1 : 0);
                }
                
                // Within same type, sort by pick'em status
                const pickA = a.isPickem ? 0 : 1;
                const pickB = b.isPickem ? 0 : 1;
                if (pickA !== pickB) return pickA - pickB;
                return a.line - b.line;
              });
              const { primary: primaryAltLines, alternate: alternateAltLines, milestones: milestoneLines } = partitionAltLineItems(altLines);
              const renderAltLineButton = (altLine: AltLineItem, idx: number) => {
                const bookmakerInfo = getBookmakerInfo(altLine.bookmaker);
                const isSelected = Math.abs(altLine.line - displayLine) < 0.01;
                const isPickemAlt = altLine.isPickem ?? false;
                const pickemVariant = altLine.variantLabel ?? null;
                
                return (
                  <button
                    key={`${altLine.bookmaker}-${altLine.line}-${idx}`}
                    onClick={() => {
                      onChangeBettingLine(altLine.line);
                      setSelectedBookmaker(altLine.bookmaker);
                      setIsAltLinesOpen(false);
                      const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
                      if (input) {
                        input.value = String(altLine.line);
                        transientLineRef.current = altLine.line;
                        updateBettingLinePosition(yAxisConfig, altLine.line);
                        recolorBarsFast(altLine.line);
                        updateOverRatePillFast(altLine.line);
                      }
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      isSelected ? 'bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-600' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Bookmaker Logo */}
                      {bookmakerInfo.logoUrl ? (
                        <img 
                          src={bookmakerInfo.logoUrl} 
                          alt={bookmakerInfo.name}
                          className="w-5 h-5 rounded object-contain flex-shrink-0"
                            onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <span 
                        className={`text-xs font-semibold text-white px-1.5 py-0.5 rounded flex-shrink-0 items-center justify-center min-w-[1.25rem] h-5 ${!bookmakerInfo.logoUrl ? 'flex' : 'hidden'}`}
                        style={{ backgroundColor: bookmakerInfo.color }}
                      >
                        {bookmakerInfo.logo}
                      </span>
                      
                      {/* Line and Bookmaker Name */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {!isMoneyline && (
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                              {fmtLine(altLine.line)}
                            </span>
                          )}
                          {isMoneyline && (
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                              ML
                            </span>
                          )}
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {bookmakerInfo.name}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Odds */}
                    {!isPickemAlt ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {altLine.over && altLine.over !== 'N/A' && altLine.over !== 'Pick\'em' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            isMoneyline 
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' 
                              : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          }`}>
                            {isMoneyline ? 'Home' : 'O'} {fmtOdds(altLine.over)}
                          </span>
                        )}
                        {altLine.under && altLine.under !== 'N/A' && altLine.under !== 'Pick\'em' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            isMoneyline 
                              ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' 
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {isMoneyline ? 'Away' : 'U'} {fmtOdds(altLine.under)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {pickemVariant === 'Goblin' && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? (
                          <img 
                            src="/images/goblin.png" 
                            alt="Goblin" 
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = document.createElement('span');
                              fallback.className = 'text-lg leading-none';
                              fallback.textContent = '👹';
                              if (img.parentElement && img.nextSibling) {
                                img.parentElement.insertBefore(fallback, img.nextSibling);
                              } else if (img.parentElement) {
                                img.parentElement.appendChild(fallback);
                              }
                            }}
                          />
                        ) : pickemVariant === 'Demon' && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? (
                          <img 
                            src="/images/demon.png" 
                            alt="Demon" 
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = document.createElement('span');
                              fallback.className = 'text-lg leading-none';
                              fallback.textContent = '😈';
                              if (img.parentElement && img.nextSibling) {
                                img.parentElement.insertBefore(fallback, img.nextSibling);
                              } else if (img.parentElement) {
                                img.parentElement.appendChild(fallback);
                              }
                            }}
                          />
                        ) : (
                          <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-[10px] font-semibold">
                            Pick&apos;em
                          </span>
                        )}
                      </div>
                    )}
                    
                    {/* Selected indicator */}
                    {isSelected && (
                      <svg className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              };
                  
                  // Find the bookmaker to display: find the bookmaker whose PRIMARY line matches displayLine
                  const displayBookmaker = (() => {
                    if (!realOddsData || realOddsData.length === 0) return null;
                    
                    // console.log('[DEBUG MOBILE] Finding displayBookmaker for displayLine:', displayLine, 'selectedStat:', selectedStat, 'bookRowKey:', bookRowKey);
                    
                    // Track all lines per bookmaker to identify the true primary line
                    const allLinesByBookmaker = new Map<string, Array<{line: number; over: string; under: string; isPickem: boolean; variantLabel: string | null}>>();
                    
                    // First pass: collect ALL lines for each bookmaker (excluding milestones for initial display)
                    for (const book of realOddsData) {
                      const meta = (book as any)?.meta;
                      const baseName = (meta?.baseName || book?.name || '');
                      const baseNameLower = baseName.toLowerCase();
                      const statKey: string = meta?.stat || bookRowKey;
                      
                      // Only consider entries matching the selected stat
                      if (statKey !== bookRowKey) continue;
                      
                      // Exclude milestones - only show actual over/under lines on initial load
                      if (meta?.variantLabel === 'Milestone') continue;
                      
                      const statData = (book as any)[bookRowKey];
                      if (!statData || statData.line === 'N/A') continue;
                      const lineValue = parseFloat(statData.line);
                      if (isNaN(lineValue)) continue;
                      
                      if (!allLinesByBookmaker.has(baseNameLower)) {
                        allLinesByBookmaker.set(baseNameLower, []);
                      }
                      
                      allLinesByBookmaker.get(baseNameLower)!.push({
                        line: lineValue,
                        over: statData.over,
                        under: statData.under,
                        isPickem: meta?.isPickem ?? false,
                        variantLabel: meta?.variantLabel ?? null,
                      });
                    }
                    
                    // Calculate consensus line by finding the most common line value across ALL bookmakers
                    // Count all line values, not just first lines
                    const lineCounts = new Map<number, number>();
                    for (const [bookmaker, lines] of allLinesByBookmaker.entries()) {
                      for (const line of lines) {
                        lineCounts.set(line.line, (lineCounts.get(line.line) || 0) + 1);
                      }
                    }
                    
                    // Find the most common line (this is our consensus)
                    let consensusLine: number | null = null;
                    let maxCount = 0;
                    for (const [line, count] of lineCounts.entries()) {
                      if (count > maxCount) {
                        maxCount = count;
                        consensusLine = line;
                      }
                    }
                    
                    // console.log('[DEBUG MOBILE] Consensus line (most common across all):', consensusLine, 'appears', maxCount, 'times');
                    
                    // Second pass: identify primary line for each bookmaker
                    // Primary line is ALWAYS the one closest to consensus (if consensus exists)
                    const primaryLinesByBookmaker = new Map<string, any>();
                    for (const [baseNameLower, lines] of allLinesByBookmaker.entries()) {
                      if (lines.length === 0) continue;
                      
                      let primaryLine = lines[0]; // Default to first
                      
                      // If we have a consensus line, ALWAYS use the line closest to it
                      if (consensusLine !== null && lines.length > 1) {
                        let closestLine = lines[0];
                        let minDiff = Math.abs(lines[0].line - consensusLine);
                        
                        for (const line of lines) {
                          const diff = Math.abs(line.line - consensusLine);
                          if (diff < minDiff) {
                            minDiff = diff;
                            closestLine = line;
                          }
                        }
                        
                        // Always use the closest line to consensus (no threshold)
                        primaryLine = closestLine;
                        // console.log('[DEBUG MOBILE] Bookmaker', baseNameLower, '- closest to consensus', consensusLine, 'is', primaryLine.line, '(diff:', minDiff, ')');
                      }
                      
                      // Get the original bookmaker name (preserve case)
                      const firstBook = realOddsData.find((book: any) => {
                        const meta = (book as any)?.meta;
                        const name = (meta?.baseName || book?.name || '').toLowerCase();
                        return name === baseNameLower;
                      });
                      const displayName = firstBook ? ((firstBook as any)?.meta?.baseName || firstBook?.name || baseNameLower) : baseNameLower;
                      
                      primaryLinesByBookmaker.set(baseNameLower, {
                        bookmaker: displayName,
                        line: primaryLine.line,
                        over: primaryLine.over,
                        under: primaryLine.under,
                        isPickem: primaryLine.isPickem,
                        variantLabel: primaryLine.variantLabel,
                      });
                      
                      // console.log('[DEBUG MOBILE] Found primary line:', displayName, 'line:', primaryLine.line, 'over:', primaryLine.over, 'under:', primaryLine.under, '(from', lines.length, 'total lines)');
                    }
                    
                    // console.log('[DEBUG MOBILE] Primary lines map:', Array.from(primaryLinesByBookmaker.entries()).map(([name, data]) => `${name}: ${data.line}`));
                    
                    // Debug: Show all Bovada lines (including alternates)
                    const bovadaLines = bookRowKey ? realOddsData
                      .filter((book: any) => {
                        const meta = (book as any)?.meta;
                        const baseName = (meta?.baseName || book?.name || '').toLowerCase();
                        return baseName.includes('bovada');
                      })
                      .map((book: any) => {
                        const meta = (book as any)?.meta;
                        const statData = (book as any)[bookRowKey];
                        return {
                          baseName: meta?.baseName || book?.name,
                          stat: meta?.stat,
                          line: statData ? statData.line : 'N/A',
                          over: statData ? statData.over : 'N/A',
                          under: statData ? statData.under : 'N/A',
                        };
                      }) : [];
                    // console.log('[DEBUG MOBILE] All Bovada lines for', bookRowKey, ':', bovadaLines);
                    
                    // console.log('[DEBUG MOBILE] selectedBookmaker:', selectedBookmaker);
                    
                    // Second pass: find the bookmaker entry that matches displayLine
                    // If selectedBookmaker is set, check ALL lines (including alternates/Goblin/Demon) for that bookmaker
                    if (selectedBookmaker) {
                      const selectedLower = selectedBookmaker.toLowerCase();
                      
                      // First, try to find an exact match in realOddsData (excluding milestones unless explicitly selected)
                      const exactMatch = bookRowKey ? realOddsData.find((book: any) => {
                        const meta = (book as any)?.meta;
                        const baseName = (meta?.baseName || book?.name || '').toLowerCase();
                        if (baseName !== selectedLower) return false;
                        
                        // If no bookmaker is explicitly selected, exclude milestones
                        // Only show milestones if user explicitly selected that bookmaker's milestone line
                        if (!selectedBookmaker && meta?.variantLabel === 'Milestone') return false;
                        
                        const statData = (book as any)[bookRowKey];
                        if (!statData || statData.line === 'N/A') return false;
                        const lineValue = parseFloat(statData.line);
                        if (isNaN(lineValue)) return false;
                        return Math.abs(lineValue - displayLine) < 0.01;
                      }) : null;
                      
                      if (exactMatch && bookRowKey) {
                        const meta = (exactMatch as any)?.meta;
                        const statData = (exactMatch as any)[bookRowKey];
                        const result = {
                          bookmaker: meta?.baseName || exactMatch?.name || selectedBookmaker,
                          line: parseFloat(statData.line),
                          over: statData.over,
                          under: statData.under,
                          isPickem: meta?.isPickem ?? false,
                          variantLabel: meta?.variantLabel ?? null,
                        };
                        // console.log('[DEBUG MOBILE] Found exact match (including variant):', result);
                        return result;
                      }
                      
                      // Fallback to primary line if no exact match found
                      const selectedPrimary = primaryLinesByBookmaker.get(selectedLower);
                      // console.log('[DEBUG MOBILE] Checking selectedBookmaker:', selectedBookmaker, 'lower:', selectedLower, 'found:', selectedPrimary);
                      if (selectedPrimary && Math.abs(selectedPrimary.line - displayLine) < 0.01) {
                        // console.log('[DEBUG MOBILE] Using selectedBookmaker primary line:', selectedPrimary);
                        return selectedPrimary;
                      } else if (selectedPrimary) {
                        // console.log('[DEBUG MOBILE] Selected bookmaker line mismatch:', selectedPrimary.line, 'vs displayLine:', displayLine, 'diff:', Math.abs(selectedPrimary.line - displayLine));
                      }
                    }
                    
                    // Otherwise, find the first bookmaker whose primary line matches
                    for (const [bookmakerLower, primaryData] of primaryLinesByBookmaker.entries()) {
                      if (Math.abs(primaryData.line - displayLine) < 0.01) {
                        // console.log('[DEBUG MOBILE] Found matching primary line:', bookmakerLower, primaryData);
                        return primaryData;
                      }
                    }
                    
                    // console.log('[DEBUG MOBILE] No matching primary line found for displayLine:', displayLine);
                    return null;
                  })();
                  
                  // console.log('[DEBUG MOBILE] Final displayBookmaker result:', displayBookmaker);
                  
                  const displayIsPickemMobile = displayBookmaker ? (displayBookmaker.isPickem ?? isPickemBookmakerName(displayBookmaker.bookmaker)) : false;
                  const displayPickemVariantMobile = displayBookmaker ? (displayBookmaker.variantLabel ?? null) : null;
                  const bookmakerInfo = displayBookmaker ? getBookmakerInfo(displayBookmaker.bookmaker) : null;
                  const shouldShowBookmaker = displayBookmaker !== null;
                  
                  return (
                    <div className="sm:hidden relative flex-shrink-0 w-[100px]" ref={altLinesRef}>
                      <button
                        onClick={() => setIsAltLinesOpen(!isAltLinesOpen)}
                        className="w-full px-2 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors h-[32px] overflow-hidden"
                      >
                        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
                          {shouldShowBookmaker && bookmakerInfo && displayBookmaker ? (
                            <>
                              {bookmakerInfo.logoUrl ? (
                                <img 
                                  src={bookmakerInfo.logoUrl} 
                                  alt={bookmakerInfo.name}
                                  className="w-6 h-6 rounded object-contain flex-shrink-0"
                            onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                                />
                              ) : null}
                              <span className={`text-base flex-shrink-0 ${!bookmakerInfo.logoUrl ? '' : 'hidden'}`}>
                                {bookmakerInfo.logo}
                              </span>
                              {/* Show Goblin/Demon symbol inline with logo for PrizePicks */}
                              {bookmakerInfo.name === 'PrizePicks' && displayIsPickemMobile && displayPickemVariantMobile ? (
                                <img 
                                  src={displayPickemVariantMobile === 'Goblin' ? '/images/goblin.png' : '/images/demon.png'} 
                                  alt={displayPickemVariantMobile} 
                                  className="w-7 h-7 object-contain flex-shrink-0 ml-0.5 mt-0.5"
                                  onError={(e) => {
                                    // Fallback to text if image fails
                                    const img = e.target as HTMLImageElement;
                                    img.style.display = 'none';
                                    const fallback = document.createElement('span');
                                    fallback.className = 'text-[11px] text-purple-600 dark:text-purple-300 font-semibold whitespace-nowrap';
                                    fallback.textContent = bookmakerInfo.name === 'Underdog' ? `Pick'em` : `Pick'em • ${displayPickemVariantMobile}`;
                                    if (img.parentElement && img.nextSibling) {
                                      img.parentElement.insertBefore(fallback, img.nextSibling);
                                    } else if (img.parentElement) {
                                      img.parentElement.appendChild(fallback);
                                    }
                                  }}
                                />
                              ) : !displayIsPickemMobile ? (
                                <div className="flex flex-col items-start gap-0.5 min-w-0">
                                  {displayBookmaker.over && displayBookmaker.over !== 'N/A' && (
                                    <span className="text-[11px] text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                                      O{fmtOdds(displayBookmaker.over)}
                                    </span>
                                  )}
                                  {displayBookmaker.under && displayBookmaker.under !== 'N/A' && (
                                    <span className="text-[11px] text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                                      U{fmtOdds(displayBookmaker.under)}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[11px] text-purple-600 dark:text-purple-300 font-semibold whitespace-nowrap">
                                  Pick&apos;em{displayPickemVariantMobile && bookmakerInfo.name !== 'Underdog' ? ` • ${displayPickemVariantMobile}` : ''}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="w-5 h-5 flex-shrink-0" />
                              <div className="flex flex-col items-start gap-0.5 min-w-0">
                                <span className="text-[11px] text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">Alt Lines</span>
                              </div>
                            </>
                          )}
                        </div>
                        <svg 
                          className={`w-4 h-4 transition-transform flex-shrink-0 ml-auto ${isAltLinesOpen ? 'rotate-180' : ''}`}
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isAltLinesOpen && (
                        <>
                          <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 min-w-[280px] max-w-[320px] max-h-[400px] overflow-y-auto">
                            <div className="p-3 border-b border-gray-200 dark:border-gray-600">
                              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Alt Lines</div>
                            </div>
                            <div className="p-2">
                              {altLines.length === 0 ? (
                                <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                                  {!realOddsData || realOddsData.length === 0 ? 'Loading odds data...' : 'No alternative lines available'}
                                </div>
                              ) : (
                                <>
                                  {primaryAltLines.map(renderAltLineButton)}
                                  {alternateAltLines.length > 0 && (
                                    <>
                                      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        Alternate Lines
                                      </div>
                                      {alternateAltLines.map((altLine, idx) =>
                                        renderAltLineButton(altLine, idx + primaryAltLines.length)
                                      )}
                                    </>
                                  )}
                                  {milestoneLines.length > 0 && (
                                    <>
                                      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        Milestones
                                      </div>
                                      {milestoneLines.map((altLine, idx) =>
                                        renderAltLineButton(altLine, idx + primaryAltLines.length + alternateAltLines.length)
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => setIsAltLinesOpen(false)}
                          />
                        </>
                      )}
                    </div>
                  );
                })()}
                {selectedStat === 'moneyline' ? (
                  // For moneyline, show odds instead of betting line input
                  (() => {
                    const bookRowKey = getBookRowKey(selectedStat);
                    const displayBookmaker = (() => {
                      if (!realOddsData || realOddsData.length === 0 || !bookRowKey) return null;
                      // For moneyline, just get the first available bookmaker
                      for (const book of realOddsData) {
                        const statData = (book as any)[bookRowKey];
                        if (statData && (statData.home !== 'N/A' || statData.away !== 'N/A')) {
                          const meta = (book as any).meta || {};
                          return {
                            bookmaker: meta.baseName || book.name,
                            over: statData.home,
                            under: statData.away,
                          };
                        }
                      }
                      return null;
                    })();
                    
                    if (displayBookmaker) {
                      const bookmakerInfo = getBookmakerInfo(displayBookmaker.bookmaker);
                      return (
                        <div className="flex items-center gap-2 px-2.5 sm:px-2 md:px-3 py-1.5 sm:py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg">
                          {bookmakerInfo?.logoUrl ? (
                            <img 
                              src={bookmakerInfo.logoUrl} 
                              alt={bookmakerInfo.name}
                              className="w-5 h-5 rounded object-contain flex-shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <span 
                            className={`text-xs font-semibold text-white px-1.5 py-0.5 rounded flex-shrink-0 items-center justify-center min-w-[1.25rem] h-5 ${!bookmakerInfo?.logoUrl ? 'flex' : 'hidden'}`}
                            style={{ backgroundColor: bookmakerInfo?.color || '#6B7280' }}
                          >
                            {bookmakerInfo?.logo || ''}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs sm:text-sm font-mono text-blue-600 dark:text-blue-400">
                              Home {fmtOdds(displayBookmaker.over)}
                            </span>
                            <span className="text-xs sm:text-sm font-mono text-orange-600 dark:text-orange-400">
                              Away {fmtOdds(displayBookmaker.under)}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="px-2.5 sm:px-2 md:px-3 py-1.5 sm:py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-500 dark:text-gray-400">
                        No odds available
                      </div>
                    );
                  })()
                ) : (
                  <input
                    id="betting-line-input"
                    type="number" 
                    step="0.5" 
                    {...((['spread', 'moneyline'].includes(selectedStat)) ? {} : { min: "0" })}
                    key={selectedStat}
                    defaultValue={bettingLine}
                    onChange={(e) => {
                      const v = parseFloat((e.currentTarget as HTMLInputElement).value);
                      if (!Number.isFinite(v)) return;
                      transientLineRef.current = v;
                      hasManuallySetLineRef.current = true; // Mark as manually set to prevent auto-updates
                      
                      // Update displayLine immediately for instant bookmaker detection
                      setDisplayLine(v);
                      
                      // Update visual elements immediately (no lag)
                      updateBettingLinePosition(yAxisConfig, v);
                      recolorBarsFast(v);
                      updateOverRatePillFast(v);
                      try { window.dispatchEvent(new CustomEvent('transient-line', { detail: { value: v } })); } catch {}
                      
                      // Debounce state update to reduce re-renders (bookmaker detection will run after debounce)
                      if (bettingLineDebounceRef.current) {
                        clearTimeout(bettingLineDebounceRef.current);
                      }
                      bettingLineDebounceRef.current = setTimeout(() => {
                        onChangeBettingLine(v);
                        bettingLineDebounceRef.current = null;
                      }, 300);
                    }}
                    onBlur={(e) => {
                      const v = parseFloat((e.currentTarget as HTMLInputElement).value);
                      if (Number.isFinite(v)) {
                        transientLineRef.current = v;
                        hasManuallySetLineRef.current = true; // Mark as manually set
                        
                        // Update displayLine immediately
                        setDisplayLine(v);
                        
                        // Clear any pending debounce and update immediately
                        if (bettingLineDebounceRef.current) {
                          clearTimeout(bettingLineDebounceRef.current);
                          bettingLineDebounceRef.current = null;
                        }
                        onChangeBettingLine(v);
                        // selectedBookmaker will be auto-updated by useEffect if a matching bookmaker is found
                      }
                    }}
                    className="w-20 sm:w-16 md:w-18 lg:w-20 px-2.5 sm:px-2 md:px-3 py-1.5 sm:py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm sm:text-xs md:text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                )}
              </div>
            </div>
            {/* Mobile: Filters inline with line input */}
            <div className="sm:hidden flex items-center flex-wrap gap-2.5 ml-2 mt-4">
              <div className="flex-shrink-0 mr-1">
                {TimeframeButtons}
              </div>
              <div className="-ml-2"><HomeAwaySelect value={homeAway} onChange={onChangeHomeAway} isDark={isDark} /></div>
              <div className="mr-1">
                <OpponentSelector
                  currentOpponent={currentOpponent}
                  manualOpponent={manualOpponent}
                  onOpponentChange={onOpponentChange}
                  isDark={isDark}
                  propsMode={propsMode}
                  currentTeam={currentTeam}
                  selectedTimeframe={selectedTimeframe}
                />
              </div>
              {propsMode === 'player' && (
                <div className="relative" ref={advancedMobileRef}>
                  <button
                    onClick={() => setIsAdvancedFiltersOpen((v: boolean) => !v)}
                    className="w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 text-center flex items-center justify-center"
                  >
                    Advanced
                  </button>
                  {isAdvancedFiltersOpen && (
                    <div 
                      ref={advancedMobilePortalRef}
                      className="absolute right-0 top-full mt-1 w-[min(calc(100vw-2rem),20rem)] sm:w-72 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg p-3 z-50"
                      onClick={(e) => {
                        // Prevent clicks inside the dropdown from closing it
                        e.stopPropagation();
                      }}
                      onTouchStart={(e) => {
                        // Prevent touch events inside the dropdown from closing it
                        e.stopPropagation();
                      }}
                    >
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Advanced Filters</div>
                      <div className="space-y-2">
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                          <button
                            type="button"
                            onClick={() => setIsMinutesFilterOpen((v: boolean) => !v)}
                            className="w-full flex items-center justify-between"
                          >
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Minutes Played</span>
                            <span className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1">
                              {minMinutesFilter} - {maxMinutesFilter} min
                              <svg className={`w-3 h-3 transition-transform ${isMinutesFilterOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z" clipRule="evenodd"/></svg>
                            </span>
                          </button>
                          {isMinutesFilterOpen && (
                            <div className="mt-2">
                              <div className="relative">
                                <input type="range" min="0" max="48" step="1" value={minMinutesFilter} onChange={(e) => onMinMinutesChange(Number(e.target.value))} className="w-full" style={{ accentColor: '#7c3aed' }} />
                                <input type="range" min="0" max="48" step="1" value={maxMinutesFilter} onChange={(e) => onMaxMinutesChange(Number(e.target.value))} className="w-full -mt-3" style={{ accentColor: '#7c3aed' }} />
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onExcludeBlowoutsChange(!excludeBlowouts)}
                          className="w-full flex items-center justify-between px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="text-xs text-gray-700 dark:text-gray-300">Exclude Blowouts (±21)</span>
                          <span className={`inline-block h-4 w-7 rounded-full ${excludeBlowouts ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`block h-3 w-3 bg-white rounded-full transform ${excludeBlowouts ? 'translate-x-4' : 'translate-x-1'}`} />
                          </span>
                        </button>
                        {/* With / Without teammate */}
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                          <div className="flex items-center gap-2">
                            {/* Playing with */}
                            <div className="flex-1">
                              <div className="mb-0.5 text-[10px] text-gray-500 dark:text-gray-400">Playing with</div>
                              <select
                                value={withWithoutMode === 'with' ? String(teammateFilterId ?? '') : ''}
                                onChange={async (e) => {
                                  const v = e.target.value;
                                  setWithWithoutMode('with');
                                  if (!v) {
                                    setTeammateFilterId(null);
                                    return;
                                  }
                                  // If option is an encoded id, use it directly, otherwise resolve by name
                                  if (/^\d+$/.test(v)) {
                                    setTeammateFilterId(parseInt(v, 10));
                                    return;
                                  }
                                  const name = v.startsWith('name:') ? v.slice(5) : v;
                                  const id = await resolveTeammateIdFromNameLocal(name, currentTeam);
                                  setTeammateFilterId(id);
                                }}
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white"
                                disabled={!rosterForSelectedTeam}
                              >
                                <option value="">{rosterForSelectedTeam ? 'All' : 'Loading roster…'}</option>
                                {rosterForSelectedTeam && (
                                  Object.values(rosterForSelectedTeam).reduce((acc: any[], pos: any) => {
                                    const arr = Array.isArray(pos) ? pos : [];
                                    arr.forEach((p: any) => {
                                      const name = p?.full_name || p?.name || `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
                                      if (!name) return;
                                      const key = `name:${name}`;
                                      if (acc.some((x: any) => x.key === key)) return;
                                      acc.push({ key, name });
                                    });
                                    return acc;
                                  }, [] as any[]).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((p: any) => (
                                    <option key={`tm-with-${p.key}`} value={p.key}>
                                      {p.name}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>
                            {/* Playing without */}
                            <div className="flex-1">
                              <div className="mb-0.5 text-[10px] text-gray-500 dark:text-gray-400">Playing without</div>
                              <select
                                value={withWithoutMode === 'without' ? String(teammateFilterId ?? '') : ''}
                                onChange={async (e) => {
                                  const v = e.target.value;
                                  setWithWithoutMode('without');
                                  if (!v) {
                                    setTeammateFilterId(null);
                                    return;
                                  }
                                  if (/^\d+$/.test(v)) {
                                    setTeammateFilterId(parseInt(v, 10));
                                    return;
                                  }
                                  const name = v.startsWith('name:') ? v.slice(5) : v;
                                  const id = await resolveTeammateIdFromNameLocal(name, currentTeam);
                                  setTeammateFilterId(id);
                                }}
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white"
                                disabled={!rosterForSelectedTeam}
                              >
                                <option value="">{rosterForSelectedTeam ? 'All' : 'Loading roster…'}</option>
                                {rosterForSelectedTeam && (
                                  Object.values(rosterForSelectedTeam).reduce((acc: any[], pos: any) => {
                                    const arr = Array.isArray(pos) ? pos : [];
                                    arr.forEach((p: any) => {
                                      const name = p?.full_name || p?.name || `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
                                      if (!name) return;
                                      const key = `name:${name}`;
                                      if (acc.some((x: any) => x.key === key)) return;
                                      acc.push({ key, name });
                                    });
                                    return acc;
                                  }, [] as any[]).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((p: any) => (
                                    <option key={`tm-without-${p.key}`} value={p.key}>
                                      {p.name}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>
                          </div>
                          {teammateFilterId != null && (
                            <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                              <span>
                                {loadingTeammateGames ? 'Loading teammate games…' : `Filtering ${withWithoutMode} selected teammate`}
                              </span>
                              <button
                                type="button"
                                onClick={clearTeammateFilter}
                                className="text-purple-600 dark:text-purple-300 font-semibold hover:underline"
                              >
                                Clear
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onExcludeBackToBackChange(!excludeBackToBack)}
                          className="w-full flex items-center justify-between px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="text-xs text-gray-700 dark:text-gray-300">Back-to-Back</span>
                          <span className={`inline-block h-4 w-7 rounded-full ${excludeBackToBack ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`block h-3 w-3 bg-white rounded-full transform ${excludeBackToBack ? 'translate-x-4' : 'translate-x-1'}`} />
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Middle: Over Rate pill in header - Hidden on desktop to use in-chart placement */}
          <div className="hidden">
            <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">Over Rate:</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 sm:hidden ml-1">Rate:</span>
            <div className="ml-1">
              <OverRatePill 
                overCount={chartData.filter((d: any) => d.value > bettingLine).length} 
                total={chartData.length} 
                isDark={isDark} 
              />
            </div>
          </div>
            {/* Right: VS (opponent), H/A, and Timeframe inline - Desktop only */}
            <div className="hidden sm:flex items-center flex-wrap gap-2 sm:gap-3 ml-auto">
              <div className="mr-1 sm:mr-0">
                <OpponentSelector
                  currentOpponent={currentOpponent}
                  manualOpponent={manualOpponent}
                  onOpponentChange={onOpponentChange}
                  isDark={isDark}
                  propsMode={propsMode}
                  currentTeam={currentTeam}
                  selectedTimeframe={selectedTimeframe}
                />
              </div>
              <div className="-ml-2"><HomeAwaySelect value={homeAway} onChange={onChangeHomeAway} isDark={isDark} /></div>
              {propsMode === 'player' && (
                <div className="relative" ref={advancedDesktopRef}>
                  <button
                    onClick={() => setIsAdvancedFiltersOpen((v: boolean) => !v)}
                    className="w-16 sm:w-24 md:w-28 px-2 sm:px-2 md:px-3 py-2 sm:py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 text-center"
                  >
                    Advanced
                  </button>
                  {isAdvancedFiltersOpen && (
                    <div className="absolute right-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg p-3 z-50">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Advanced Filters</div>
                      <div className="space-y-2">
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                          <button
                            type="button"
                            onClick={() => setIsMinutesFilterOpen((v: boolean) => !v)}
                            className="w-full flex items-center justify-between"
                          >
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Minutes Played</span>
                            <span className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1">
                              {minMinutesFilter} - {maxMinutesFilter} min
                              <svg className={`w-3 h-3 transition-transform ${isMinutesFilterOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z" clipRule="evenodd"/></svg>
                            </span>
                          </button>
                          {isMinutesFilterOpen && (
                            <div className="mt-2">
                              <div className="relative">
                                <input type="range" min="0" max="48" step="1" value={minMinutesFilter} onChange={(e) => onMinMinutesChange(Number(e.target.value))} className="w-full" style={{ accentColor: '#7c3aed' }} />
                                <input type="range" min="0" max="48" step="1" value={maxMinutesFilter} onChange={(e) => onMaxMinutesChange(Number(e.target.value))} className="w-full -mt-3" style={{ accentColor: '#7c3aed' }} />
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onExcludeBlowoutsChange(!excludeBlowouts)}
                          className="w-full flex items-center justify-between px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="text-xs text-gray-700 dark:text-gray-300">Exclude Blowouts (±21)</span>
                          <span className={`inline-block h-4 w-7 rounded-full ${excludeBlowouts ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`block h-3 w-3 bg-white rounded-full transform ${excludeBlowouts ? 'translate-x-4' : 'translate-x-1'}`} />
                          </span>
                        </button>
                        {/* With / Without teammate (desktop) */}
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                          <div className="flex items-center gap-2">
                            {/* Playing with */}
                            <div className="flex-1">
                              <div className="mb-0.5 text-[10px] text-gray-500 dark:text-gray-400">Playing with</div>
                              <select
                                value={withWithoutMode === 'with' ? String(teammateFilterId ?? '') : ''}
                                onChange={async (e) => {
                                  const v = e.target.value;
                                  setWithWithoutMode('with');
                                  if (!v) {
                                    setTeammateFilterId(null);
                                    return;
                                  }
                                  if (/^\d+$/.test(v)) {
                                    setTeammateFilterId(parseInt(v, 10));
                                    return;
                                  }
                                  const name = v.startsWith('name:') ? v.slice(5) : v;
                                  const id = await resolveTeammateIdFromNameLocal(name, currentTeam);
                                  setTeammateFilterId(id);
                                }}
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white"
                                disabled={!rosterForSelectedTeam}
                              >
                                <option value="">{rosterForSelectedTeam ? 'All' : 'Loading roster…'}</option>
                                {rosterForSelectedTeam && (
                                  Object.values(rosterForSelectedTeam).reduce((acc: any[], pos: any) => {
                                    const arr = Array.isArray(pos) ? pos : [];
                                    arr.forEach((p: any) => {
                                      const name = p?.full_name || p?.name || `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
                                      if (!name) return;
                                      const key = `name:${name}`;
                                      if (acc.some((x: any) => x.key === key)) return;
                                      acc.push({ key, name });
                                    });
                                    return acc;
                                  }, [] as any[]).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((p: any) => (
                                    <option key={`tm-with-d-${p.key}`} value={p.key}>
                                      {p.name}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>
                            {/* Playing without */}
                            <div className="flex-1">
                              <div className="mb-0.5 text-[10px] text-gray-500 dark:text-gray-400">Playing without</div>
                              <select
                                value={withWithoutMode === 'without' ? String(teammateFilterId ?? '') : ''}
                                onChange={async (e) => {
                                  const v = e.target.value;
                                  setWithWithoutMode('without');
                                  if (!v) {
                                    setTeammateFilterId(null);
                                    return;
                                  }
                                  if (/^\d+$/.test(v)) {
                                    setTeammateFilterId(parseInt(v, 10));
                                    return;
                                  }
                                  const name = v.startsWith('name:') ? v.slice(5) : v;
                                  const id = await resolveTeammateIdFromNameLocal(name, currentTeam);
                                  setTeammateFilterId(id);
                                }}
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-xs text-gray-900 dark:text-white"
                                disabled={!rosterForSelectedTeam}
                              >
                                <option value="">{rosterForSelectedTeam ? 'All' : 'Loading roster…'}</option>
                                {rosterForSelectedTeam && (
                                  Object.values(rosterForSelectedTeam).reduce((acc: any[], pos: any) => {
                                    const arr = Array.isArray(pos) ? pos : [];
                                    arr.forEach((p: any) => {
                                      const name = p?.full_name || p?.name || `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
                                      if (!name) return;
                                      const key = `name:${name}`;
                                      if (acc.some((x: any) => x.key === key)) return;
                                      acc.push({ key, name });
                                    });
                                    return acc;
                                  }, [] as any[]).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((p: any) => (
                                    <option key={`tm-without-d-${p.key}`} value={p.key}>
                                      {p.name}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>
                          </div>
                          {teammateFilterId != null && (
                            <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                              <span>
                                {loadingTeammateGames ? 'Loading teammate games…' : `Filtering ${withWithoutMode} selected teammate`}
                              </span>
                              <button
                                type="button"
                                onClick={clearTeammateFilter}
                                className="text-purple-600 dark:text-purple-300 font-semibold hover:underline"
                              >
                                Clear
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onExcludeBackToBackChange(!excludeBackToBack)}
                          className="w-full flex items-center justify-between px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="text-xs text-gray-700 dark:text-gray-300">Back-to-Back</span>
                          <span className={`inline-block h-4 w-7 rounded-full ${excludeBackToBack ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`block h-3 w-3 bg-white rounded-full transform ${excludeBackToBack ? 'translate-x-4' : 'translate-x-1'}`} />
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex-shrink-0 mr-1 sm:mr-0">
                {TimeframeButtons}
              </div>
            </div>
          </div>

          {/* Subtle divider under timeframe controls */}
          <div className="w-full h-px bg-gray-300 dark:bg-gray-600/50 opacity-30 mt-1 sm:mt-2" />
          
          {/* Bottom row cleared - controls moved higher */}
        </div>
      </>
    );
};




// Container that combines controls and chart
const ChartContainer = function ChartContainer({
  isDark,
  currentStatOptions,
  selectedStat,
  onSelectStat,
  bettingLine,
  onChangeBettingLine,
  selectedTimeframe,
  onSelectTimeframe,
  chartData,
  yAxisConfig,
  isLoading,
  apiError,
  selectedPlayer,
  propsMode,
  gamePropsTeam,
  customTooltip,
  currentOpponent,
  manualOpponent,
  onOpponentChange,
  currentTeam,
  homeAway,
  onChangeHomeAway,
  realOddsData,
  fmtOdds,
  minMinutesFilter,
  maxMinutesFilter,
  onMinMinutesChange,
  onMaxMinutesChange,
  excludeBlowouts,
  excludeBackToBack,
  onExcludeBlowoutsChange,
  onExcludeBackToBackChange,
  rosterForSelectedTeam,
  withWithoutMode,
  setWithWithoutMode,
  teammateFilterId,
  setTeammateFilterId,
  loadingTeammateGames,
  clearTeammateFilter,
  hitRateStats,
  lineMovementEnabled,
  intradayMovements,
}: any) {
  const totalSamples = hitRateStats?.total ?? chartData.length;
  const overSamples = hitRateStats?.overCount ?? chartData.filter((d: any) => d.value > bettingLine).length;

  const formatAverageValue = (avg: AverageStatInfo): string => {
    if (!Number.isFinite(avg.value)) return '0.0';
    if (avg.format === 'percent') return `${avg.value.toFixed(1)}%`;
    return avg.value.toFixed(1);
  };

  const renderAverageChips = (className = '') => {
    if (!hitRateStats?.averages?.length) return null;
    return (
      <div className={`flex flex-wrap items-center gap-1 sm:gap-2 ${className}`}>
        {hitRateStats.averages.map((avg: AverageStatInfo) => (
          <span
            key={`avg-${avg.label}`}
            className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 text-[10px] sm:text-xs font-medium"
          >
            {avg.label}:{' '}
            <span className="font-semibold text-gray-900 dark:text-white">
              {formatAverageValue(avg)}
            </span>
          </span>
        ))}
      </div>
    );
  };
  return (
<div 
className="chart-container-no-focus relative z-10 bg-white dark:bg-slate-800 rounded-lg shadow-sm p-0 sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0 border border-gray-200 dark:border-gray-700 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden"
      style={{ outline: 'none', boxShadow: 'none' }}
    >
      {/* Desktop: In-chart overlay pill (disabled; use pre-chart placement to match mobile) */}
      <div className="hidden"></div>
      <ChartControls
        isDark={isDark}
        currentStatOptions={currentStatOptions}
        selectedStat={selectedStat}
        onSelectStat={onSelectStat}
        bettingLine={bettingLine}
        onChangeBettingLine={onChangeBettingLine}
        selectedTimeframe={selectedTimeframe}
        onSelectTimeframe={onSelectTimeframe}
        chartData={chartData}
        currentOpponent={currentOpponent}
        manualOpponent={manualOpponent}
        onOpponentChange={onOpponentChange}
        propsMode={propsMode}
        currentTeam={currentTeam}
        homeAway={homeAway}
        onChangeHomeAway={onChangeHomeAway}
        yAxisConfig={yAxisConfig}
        realOddsData={realOddsData}
        fmtOdds={fmtOdds}
        minMinutesFilter={minMinutesFilter}
        maxMinutesFilter={maxMinutesFilter}
        onMinMinutesChange={onMinMinutesChange}
        onMaxMinutesChange={onMaxMinutesChange}
        excludeBlowouts={excludeBlowouts}
        excludeBackToBack={excludeBackToBack}
        onExcludeBlowoutsChange={onExcludeBlowoutsChange}
        onExcludeBackToBackChange={onExcludeBackToBackChange}
        rosterForSelectedTeam={rosterForSelectedTeam}
        withWithoutMode={withWithoutMode}
        setWithWithoutMode={setWithWithoutMode}
        teammateFilterId={teammateFilterId}
        setTeammateFilterId={setTeammateFilterId}
        loadingTeammateGames={loadingTeammateGames}
        clearTeammateFilter={clearTeammateFilter}
        lineMovementEnabled={lineMovementEnabled}
        intradayMovements={intradayMovements}
      />
      {/* Mobile: Over Rate pill above chart */}
      <div className="sm:hidden px-2 pb-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Over Rate:</span>
            <OverRatePill 
              overCount={overSamples} 
              total={totalSamples} 
              isDark={isDark} 
            />
            {hitRateStats?.totalBeforeFilters && hitRateStats.totalBeforeFilters !== totalSamples && (
              <span className="text-xs text-gray-600 dark:text-gray-400">
                ({totalSamples}/{hitRateStats.totalBeforeFilters} games)
              </span>
            )}
          </div>
          {renderAverageChips('text-gray-600 dark:text-gray-300')}
        </div>
      </div>
      {/* Desktop: Over Rate pill above chart (same logic and placement as mobile) */}
      <div className="hidden sm:block px-3 pb-2 -mt-1 md:-mt-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Over Rate:</span>
            <OverRatePill 
              overCount={overSamples} 
              total={totalSamples} 
              isDark={isDark} 
            />
            {hitRateStats?.totalBeforeFilters && hitRateStats.totalBeforeFilters !== totalSamples && (
              <span className="text-xs text-gray-600 dark:text-gray-400">
                ({totalSamples}/{hitRateStats.totalBeforeFilters} games)
              </span>
            )}
          </div>
          {renderAverageChips('text-gray-600 dark:text-gray-300')}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <PureChart
          isLoading={isLoading}
          chartData={chartData}
          yAxisConfig={yAxisConfig}
          isDark={isDark}
          bettingLine={bettingLine}
          selectedStat={selectedStat}
          currentStatOptions={currentStatOptions}
          apiError={apiError}
          selectedPlayer={selectedPlayer}
          propsMode={propsMode}
          gamePropsTeam={gamePropsTeam}
          customTooltip={customTooltip}
          selectedTimeframe={selectedTimeframe}
        />
      </div>
      
      {/* Mobile-only: X-axis line and team logos strip below chart */}
      {/* Only show logos for L5, L10, and H2H on mobile */}
      {!isLoading && chartData && chartData.length > 0 && (selectedTimeframe === 'last5' || selectedTimeframe === 'last10' || selectedTimeframe === 'h2h') && (
        <div className="sm:hidden pb-3 overflow-x-auto custom-scrollbar">
          {/* X-axis line */}
          <div className="w-full h-0.5 bg-gray-300 dark:bg-gray-600 mb-1" style={{ paddingLeft: '6px', marginRight: '-2px' }}></div>
          <div className="flex items-end justify-between gap-0" style={{ width: '100%', height: '40px', paddingLeft: '6px', marginRight: '-2px' }}>
            {chartData.map((d: any, idx: number) => {
              const teamAbbr = d.tickLabel || d.opponent || '';
              if (!teamAbbr) return null;
              // Add left offset for all logos to align with bars
              const leftOffset = -4; // Shift all logos left by 4px to match bar padding
              
              return (
                <div key={`mobile-logo-${idx}-${teamAbbr}`} className="flex flex-col items-center justify-end" style={{ flex: '1 1 0', minWidth: 0, height: '100%', transform: `translateX(${leftOffset}px)` }}>
                  {/* Team logo */}
                  <img
                    src={getEspnLogoUrl(teamAbbr)}
                    alt={teamAbbr}
                    className="w-7 h-7 object-contain"
                    onError={(e) => {
                      const candidates = getEspnLogoCandidates(teamAbbr);
                      const currentSrc = e.currentTarget.src;
                      const currentIdx = candidates.indexOf(currentSrc);
                      const nextIdx = currentIdx + 1;
                      if (nextIdx < candidates.length) {
                        e.currentTarget.src = candidates[nextIdx];
                      } else {
                        e.currentTarget.style.display = 'none';
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
const OfficialOddsCard = memo(function OfficialOddsCard({
  isDark,
  derivedOdds,
  intradayMovements,
  selectedTeam,
  opponentTeam,
  selectedTeamLogoUrl,
  opponentTeamLogoUrl,
  matchupInfo,
  oddsFormat,
  books,
  fmtOdds,
  lineMovementEnabled,
  lineMovementData,
  selectedStat,
  predictedOutcome,
  calculatedImpliedOdds,
  selectedBookmakerName,
  selectedBookmakerLine,
  propsMode = 'player',
  selectedPlayer,
  primaryMarketLine,
}: OfficialOddsCardProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper to render donut chart wheel (hollow, green on left, red on right)
  const renderWheel = (overPercent: number, underPercent: number, label: string, size = 120) => {
    const radius = size / 2 - 20; // Inner radius for donut (hollow center)
    const circumference = 2 * Math.PI * radius;
    const overLength = circumference * (overPercent / 100);
    const underLength = circumference * (underPercent / 100);
    
                return (
      <div className="flex flex-col items-center">
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {/* Background circle (full circle, light gray) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={mounted && isDark ? "#374151" : "#e5e7eb"}
            strokeWidth="16"
          />
          {/* Under (red, right side) - draw first so it's on the right */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#ef4444"
            strokeWidth="16"
            strokeDasharray={`${underLength} ${circumference}`}
            strokeDashoffset={-overLength}
            strokeLinecap="round"
          />
          {/* Over (green, left side) - draw second so it's on the left */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#10b981"
            strokeWidth="16"
            strokeDasharray={`${overLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
          />
          {/* Center text - counter-rotate to keep it upright */}
          <text
            x={size / 2}
            y={size / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(90 ${size / 2} ${size / 2})`}
            className={`text-sm font-semibold ${mounted && isDark ? 'fill-white' : 'fill-gray-900'}`}
          >
            {overPercent.toFixed(1)}%
          </text>
        </svg>
        <div className={`text-xs mt-2 font-medium ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          {label}
        </div>
                  </div>
                );
  };

  // Don't render anything for game props
  if (propsMode === 'team') {
    return null;
  }

              return (
    <div className="relative z-50 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 w-full min-w-0 flex-shrink-0 overflow-hidden">
      <div className="p-3 sm:p-4 md:p-6">
        {/* Market Predicted Outcomes - Full Width (only show for player props, not game props) */}
        <div>
          <div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/40 p-4 h-full flex flex-col gap-3">
              <div className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
                Market Predicted Outcomes
              </div>
              
              {/* Player Name and Line */}
              {selectedPlayer && selectedStat && (
                <div className="flex items-center gap-2 text-xs sm:text-sm mb-2">
                  <span className={mounted && isDark ? 'text-gray-300' : 'text-gray-600'}>
                    {selectedPlayer.full || `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim()}:
                  </span>
                  <span className={(mounted && isDark ? 'text-slate-200' : 'text-slate-800') + ' font-mono font-semibold'}>
                    {selectedStat.toUpperCase()} {primaryMarketLine !== null && primaryMarketLine !== undefined && Number.isFinite(primaryMarketLine) ? primaryMarketLine.toFixed(1) : selectedBookmakerLine !== null && selectedBookmakerLine !== undefined && Number.isFinite(selectedBookmakerLine) ? selectedBookmakerLine.toFixed(1) : 'N/A'}
                  </span>
                </div>
              )}

              {/* Two wheels side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center justify-center">
                {/* StatTrackr Prediction Wheel */}
                <div className="flex flex-col items-center">
                  {predictedOutcome ? (
                    <>
                      {renderWheel(
                        predictedOutcome.overProb ?? 50,
                        predictedOutcome.underProb ?? 50,
                        'StatTrackr Prediction',
                        140
                      )}
                      <div className="mt-3 text-center">
                        <div className={`text-xs ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          StatTrackr Prob: <span className="font-semibold">{predictedOutcome.overProb?.toFixed(1) ?? 'N/A'}%</span>
                      </div>
                      </div>
                    </>
                  ) : (
                    <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Calculating prediction...
                    </div>
                  )}
                    </div>

                {/* Bookmaker/Implied Odds Wheel */}
                <div className="flex flex-col items-center">
                  {calculatedImpliedOdds ? (
                    <>
                      {renderWheel(
                        calculatedImpliedOdds.overImpliedProb ?? 50,
                        calculatedImpliedOdds.underImpliedProb ?? 50,
                        'Bookmaker/Implied Odds',
                        140
                      )}
                      <div className="mt-3 text-center">
                        <div className={`text-xs ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          Market Prob: <span className="font-semibold">{calculatedImpliedOdds.overImpliedProb?.toFixed(1) ?? 'N/A'}%</span>
                      </div>
                    </div>
                    </>
                  ) : (
                    <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      No market odds available
                  </div>
                  )}
                </div>
            </div>

              {/* Confidence and EV */}
              {predictedOutcome && (
                <div className="flex items-center justify-center gap-6 mt-2">
                  <div className="text-center">
                    <div className={`text-xs ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>Confidence</div>
                    <div className={`text-sm font-semibold ${
                      predictedOutcome.confidence === 'High' 
                          ? 'text-green-600 dark:text-green-400' 
                        : predictedOutcome.confidence === 'Medium'
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-red-600 dark:text-red-400'
                      }`}>
                      {predictedOutcome.confidence}
                    </div>
                  </div>
                  {predictedOutcome.expectedValue !== null && predictedOutcome.expectedValue !== undefined && (
                    <div className="text-center">
                      <div className={`text-xs ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>Expected Value</div>
                      <div className={`text-sm font-semibold ${
                        predictedOutcome.expectedValue > 0
                          ? 'text-green-600 dark:text-green-400' 
                          : predictedOutcome.expectedValue < 0
                          ? 'text-red-600 dark:text-red-400'
                          : mounted && isDark ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        {predictedOutcome.expectedValue > 0 ? '+' : ''}{predictedOutcome.expectedValue.toFixed(1)}%
                    </div>
                  </div>
                  )}
                  </div>
                )}
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.isDark === next.isDark &&
    prev.derivedOdds === next.derivedOdds &&
    prev.intradayMovements === next.intradayMovements &&
    prev.selectedTeam === next.selectedTeam &&
    prev.opponentTeam === next.opponentTeam &&
    prev.selectedTeamLogoUrl === next.selectedTeamLogoUrl &&
    prev.opponentTeamLogoUrl === next.opponentTeamLogoUrl &&
    prev.matchupInfo?.tipoffLocal === next.matchupInfo?.tipoffLocal &&
    prev.oddsFormat === next.oddsFormat &&
    prev.books === next.books &&
    prev.predictedOutcome === next.predictedOutcome &&
    prev.calculatedImpliedOdds === next.calculatedImpliedOdds &&
    prev.selectedBookmakerName === next.selectedBookmakerName &&
    prev.selectedBookmakerLine === next.selectedBookmakerLine
  );
});

// Defense vs Position metrics (static, defined once)
const DVP_METRICS = [
  { key: 'pts' as const, label: 'Points vs ', isPercentage: false },
  { key: 'reb' as const, label: 'Rebounds vs ', isPercentage: false },
  { key: 'ast' as const, label: 'Assists vs ', isPercentage: false },
  { key: 'fg3m' as const, label: 'Three Points Made vs ', isPercentage: false },
  { key: 'fg_pct' as const, label: 'Field Goal % vs ', isPercentage: true },
  { key: 'stl' as const, label: 'Steals vs ', isPercentage: false },
  { key: 'blk' as const, label: 'Blocks vs ', isPercentage: false },
  { key: 'to' as const, label: 'Turnovers vs ', isPercentage: false },
] as const;

// Global cache shared between all PositionDefenseCard instances (mobile + desktop)
// Split into two caches: team DVP data (position-independent) and rank data (position-specific)
const dvpTeamCache = new Map<string, { metrics: any, sample: number, timestamp: number }>();
const dvpRankCache = new Map<string, { metrics: any, timestamp: number }>();

// Auto-clear caches older than 2 minutes to ensure fresh data after ingest
const DVP_CACHE_TTL = 2 * 60 * 1000; // 2 minutes instead of 5
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of dvpTeamCache.entries()) {
    if (value.timestamp && (now - value.timestamp) > DVP_CACHE_TTL) {
      dvpTeamCache.delete(key);
    }
  }
  for (const [key, value] of dvpRankCache.entries()) {
    if (value.timestamp && (now - value.timestamp) > DVP_CACHE_TTL) {
      dvpRankCache.delete(key);
    }
  }
}, 60000); // Check every minute

// Defense vs Position (isolated, memoized)
const PositionDefenseCard = memo(function PositionDefenseCard({ isDark, opponentTeam, selectedPosition, currentTeam }: { isDark: boolean; opponentTeam: string; selectedPosition: 'PG'|'SG'|'SF'|'PF'|'C' | null; currentTeam: string }) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perStat, setPerStat] = useState<Record<string, number | null>>({});
  const [perRank, setPerRank] = useState<Record<string, number | null>>({});
  const [sample, setSample] = useState<number>(0);

  // Local selectors (team and opponent), defaulted from props
  const ALL_TEAMS = useMemo(() => Object.keys(ABBR_TO_TEAM_ID), []);
  const [oppSel, setOppSel] = useState<string>(opponentTeam || '');
  const [posSel, setPosSel] = useState<'PG'|'SG'|'SF'|'PF'|'C' | null>(selectedPosition || null);
  const [oppOpen, setOppOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  useEffect(() => { setOppSel(opponentTeam || ''); }, [opponentTeam]);
  useEffect(() => { if (selectedPosition) setPosSel(selectedPosition); }, [selectedPosition]);

  useEffect(() => {
    let abort = false;
    const run = async () => {
      setError(null);
      const targetOpp = oppSel || opponentTeam;
      const targetPos = posSel || selectedPosition;
      // Allow manual position selection even if selectedPosition is null
      if (!targetOpp || !targetPos) {
        // If we have an opponent but no position, clear stats but don't return early
        // This allows the user to manually select a position
        if (!targetOpp) return;
        if (!targetPos) {
          setPerStat({});
          setPerRank({});
          setSample(0);
          setLoading(false);
          return;
        }
        return;
      }

      // Check if we have both team DVP and rank data cached
      const teamCacheKey = `${targetOpp}:82`;
      const rankCacheKey = `${targetPos}:82`;
      
      // Force refresh: clear caches and fetch fresh data
      // This ensures latest ingested data is shown immediately
      // TEMPORARY: Always refresh to apply the 0-minute player filter fix
      const shouldRefresh = true; // Force refresh to apply fix
      if (shouldRefresh) {
        dvpTeamCache.delete(teamCacheKey);
        dvpRankCache.delete(rankCacheKey);
      }
      
      const teamCached = dvpTeamCache.get(teamCacheKey);
      const rankCached = dvpRankCache.get(rankCacheKey);
      
      // Show team stats immediately if available, ranks can load in background
      if (teamCached && !shouldRefresh) {
        const map: Record<string, number | null> = {};
        for (const m of DVP_METRICS) {
          const perGame = teamCached.metrics?.[m.key];
          const value = perGame ? (perGame?.[targetPos as any] as number | undefined) : undefined;
          map[m.key] = typeof value === 'number' ? value : null;
        }
        setPerStat(map);
        setSample(teamCached.sample);
        
        // If we have ranks too, show them
        if (rankCached) {
          const rmap: Record<string, number | null> = {};
          const normalizedOpp = normalizeAbbr(targetOpp);
          for (const m of DVP_METRICS) {
            const ranks = rankCached.metrics?.[m.key] || {};
            const rank = ranks?.[normalizedOpp] as number | undefined;
            rmap[m.key] = Number.isFinite(rank as any) ? (rank as number) : null;
          }
          setPerRank(rmap);
          setLoading(false);
        } else {
          // Ranks still loading
          setPerRank({});
          setLoading(true);
        }
      } else {
        setPerStat({});
        setPerRank({});
        setSample(0);
        setLoading(true);
      }

      try {
        const metricsStr = DVP_METRICS.map(m => m.key).join(',');
        
        // Fetch only what we don't have cached (or if refreshing)
        const promises: Promise<any>[] = [];
        
        // Always fetch fresh to apply the 0-minute player filter fix
        promises.push(
            cachedFetch<any>(
            `/api/dvp/batch?team=${targetOpp}&metrics=${metricsStr}&games=82&refresh=1`,
            undefined,
            0 // No cache - always fetch fresh
          ).then(data => ({ type: 'team', data }))
        );
        
        promises.push(
            cachedFetch<any>(
            `/api/dvp/rank/batch?pos=${targetPos}&metrics=${metricsStr}&games=82&refresh=1`,
            undefined,
            0 // No cache - always fetch fresh
          ).then(data => ({ type: 'rank', data }))
        );
        
        if (promises.length > 0) {
          const results = await Promise.all(promises);
          
          let dvpData = teamCached;
          let rankData = rankCached;
          
          results.forEach(result => {
            if (result.type === 'team') {
              dvpData = { metrics: result.data?.metrics, sample: result.data?.sample_games || 0, timestamp: Date.now() };
              dvpTeamCache.set(teamCacheKey, dvpData);
            } else if (result.type === 'rank') {
              rankData = { metrics: result.data?.metrics, timestamp: Date.now() };
              dvpRankCache.set(rankCacheKey, rankData);
            }
          });
          
          if (!abort && dvpData && rankData) {
            const map: Record<string, number | null> = {};
            const rmap: Record<string, number | null> = {};
            const normalizedOpp = normalizeAbbr(targetOpp);
            
            for (const m of DVP_METRICS) {
              const perGame = dvpData.metrics?.[m.key];
              const value = perGame ? (perGame?.[targetPos as any] as number | undefined) : undefined;
              map[m.key] = typeof value === 'number' ? value : null;
              
              const ranks = rankData.metrics?.[m.key] || {};
              const rank = ranks?.[normalizedOpp] as number | undefined;
              
              // Debug logging for first metric only
              if (m.key === 'pts') {
                console.log(`[DVP Frontend] Rank lookup for ${m.key}:`, {
                  normalizedOpp,
                  rank,
                  availableTeamKeys: Object.keys(ranks).slice(0, 10),
                  rankDataStructure: {
                    hasMetrics: !!rankData.metrics,
                    metricKeys: Object.keys(rankData.metrics || {}),
                    ranksType: typeof ranks,
                    ranksIsObject: ranks && typeof ranks === 'object',
                    ranksKeysCount: Object.keys(ranks).length
                  }
                });
              }
              
              // Accept 0 as a valid rank (means team has null value)
              rmap[m.key] = (typeof rank === 'number' && Number.isFinite(rank)) ? rank : null;
            }
            
            // Debug: log what we're setting
            console.log(`[DVP Frontend] Setting ranks:`, {
              rmap,
              sampleRanks: Object.entries(rmap).slice(0, 3),
              allKeys: Object.keys(rmap)
            });
            
            setPerStat(map);
            setPerRank(rmap);
            setSample(dvpData.sample);
          }
        }
      } catch (e: any) {
        if (!abort) setError(e?.message || 'Failed to load');
      } finally {
        if (!abort) setLoading(false);
      }
    };
    run();

    // Background prefetch for other positions - now using batched endpoints
    const targetOpp = oppSel || opponentTeam;
    const positions: Array<'PG'|'SG'|'SF'|'PF'|'C'> = ['PG','SG','SF','PF','C'];
    const other = positions.filter(p => p !== (posSel || selectedPosition));
    
    const prefetchOne = async (p: 'PG'|'SG'|'SF'|'PF'|'C') => {
      const teamCacheKey = `${targetOpp}:82`;
      const rankCacheKey = `${p}:82`;
      
      // Skip if already cached and not stale
      if (!targetOpp) return;
      const teamCached = dvpTeamCache.get(teamCacheKey);
      const rankCached = dvpRankCache.get(rankCacheKey);
      const now = Date.now();
      if (teamCached && rankCached && 
          teamCached.timestamp && rankCached.timestamp &&
          (now - teamCached.timestamp) < DVP_CACHE_TTL &&
          (now - rankCached.timestamp) < DVP_CACHE_TTL) return;
      
      try {
        const metricsStr = DVP_METRICS.map(m => m.key).join(',');
        const promises: Promise<any>[] = [];
        
        // Only fetch what's not cached or is stale
        if (!teamCached || (teamCached.timestamp && (now - teamCached.timestamp) >= DVP_CACHE_TTL)) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/batch?team=${targetOpp}&metrics=${metricsStr}&games=82`,
              undefined,
              DVP_CACHE_TTL
            ).then(data => ({ type: 'team', data }))
          );
        }
        
        if (!rankCached || (rankCached.timestamp && (now - rankCached.timestamp) >= DVP_CACHE_TTL)) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/rank/batch?pos=${p}&metrics=${metricsStr}&games=10`,
              undefined,
              DVP_CACHE_TTL
            ).then(data => ({ type: 'rank', data }))
          );
        }
        
        if (promises.length > 0) {
          const results = await Promise.all(promises);
          results.forEach(result => {
            if (result.type === 'team') {
              dvpTeamCache.set(teamCacheKey, { metrics: result.data?.metrics, sample: result.data?.sample_games || 0, timestamp: Date.now() });
            } else if (result.type === 'rank') {
              dvpRankCache.set(rankCacheKey, { metrics: result.data?.metrics, timestamp: Date.now() });
            }
          });
        }
      } catch {}
    };
    
    // Prefetch with delay to avoid blocking UI - but only if the browser is idle
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        other.forEach(p => { prefetchOne(p); });
      });
    } else {
      setTimeout(() => { other.forEach(p => { prefetchOne(p); }); }, 1000);
    }

    return () => { abort = true; };
  }, [oppSel, posSel, opponentTeam, selectedPosition]);

  const fmt = (v?: number | null, isPercentage?: boolean) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '';
    return isPercentage ? `${v.toFixed(1)}%` : v.toFixed(1);
  };

  const posLabel = posSel || selectedPosition || 'Select Position';

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Defense vs Position</h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">Current season stats</span>
      </div>
      <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
        {/* Controls row */}
        <div className="px-3 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Position switcher */}
          <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${mounted && isDark ? 'text-slate-200' : 'text-slate-800'}`}>Position</div>
            
            {/* Dropdown for all screen sizes to prevent overflow */}
            <div>
              <button
                onClick={() => setPosOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm font-bold ${mounted && isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'} ${posLabel === (posSel || selectedPosition) ? 'bg-purple-600 border-purple-600 text-white' : ''}`}
              >
                <span>{posLabel}</span>
                <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              
              {posOpen && (
                <>
                  <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${mounted && isDark ? 'bg-slate-800 border-gray-600' : 'bg-white border-gray-300'}`}>
                    {(['PG','SG','SF','PF','C'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => { setPosSel(p); setPosOpen(false); }}
                        className={`w-full px-3 py-2 text-sm font-bold text-left ${posLabel === p ? 'bg-purple-600 text-white' : (mounted && isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900')}`}
                      >{p}</button>
                    ))}
                  </div>
                  <div className="fixed inset-0 z-10" onClick={() => setPosOpen(false)} />
                </>
              )}
            </div>
          </div>
          {/* Opponent selector with logo (custom dropdown) */}
          <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${mounted && isDark ? 'text-slate-200' : 'text-slate-800'}`}>Opponent Team</div>
            <button
              onClick={() => setOppOpen(o => !o)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md border text-sm ${mounted && isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <span className="flex items-center gap-2">
                {(oppSel || opponentTeam) && <img src={getEspnLogoUrl(oppSel || opponentTeam || '')} alt={oppSel || opponentTeam || 'OPP'} className="w-6 h-6 object-contain" />}
                <span className="font-semibold">{oppSel || opponentTeam || ''}</span>
              </span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
            </button>

            {oppOpen && (
              <>
                <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${mounted && isDark ? 'bg-slate-800 border-gray-600' : 'bg-white border-gray-300'}`}>
                  <div className="max-h-56 overflow-y-auto custom-scrollbar overscroll-contain" onWheel={(e)=> e.stopPropagation()}>
                    {ALL_TEAMS.map(t => (
                      <button
                        key={t}
                        onClick={() => { setOppSel(t); setOppOpen(false); }}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-sm text-left ${mounted && isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                      >
                        <img src={getEspnLogoUrl(t)} alt={t} className="w-5 h-5 object-contain" />
                        <span className="font-medium">{t}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* click-away overlay */}
                <div className="fixed inset-0 z-10" onClick={() => setOppOpen(false)} />
              </>
            )}
          </div>
        </div>
        {!posSel && !selectedPosition ? (
          <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">Select a position above to view DvP stats.</div>
        ) : (
<div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-48 sm:max-h-56 md:max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
            {DVP_METRICS.map((m) => {
              const rank = perRank[m.key];
              
              // Removed debug logging to prevent spam during re-renders
              
              let borderColor: string;
              let badgeColor: string;
              
              if (rank == null || rank === 0) {
                borderColor = mounted && isDark ? 'border-slate-700' : 'border-slate-300';
                badgeColor = mounted && isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
              } else if (rank >= 26) {
                borderColor = mounted && isDark ? 'border-green-900' : 'border-green-800';
                badgeColor = 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';
              } else if (rank >= 21) {
                borderColor = mounted && isDark ? 'border-green-800' : 'border-green-600';
                badgeColor = 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
              } else if (rank >= 16) {
                borderColor = mounted && isDark ? 'border-orange-800' : 'border-orange-600';
                badgeColor = 'bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-100';
              } else if (rank >= 11) {
                borderColor = mounted && isDark ? 'border-orange-900' : 'border-orange-700';
                badgeColor = 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200';
              } else if (rank >= 6) {
                borderColor = mounted && isDark ? 'border-red-800' : 'border-red-600';
                badgeColor = 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
              } else {
                borderColor = mounted && isDark ? 'border-red-900' : 'border-red-800';
                badgeColor = 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';
              }
              
              return (
                <div key={m.key} className={`mx-3 my-2 rounded-lg border-2 ${borderColor} px-3 py-2.5`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>{m.label}{posLabel}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${mounted && isDark ? 'text-slate-100' : 'text-slate-900'} text-base sm:text-lg`}>
                        {fmt(perStat[m.key], m.isPercentage)}
                      </span>
                      <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`} title="Rank (30 better for overs, 1 for unders)">
                        {typeof rank === 'number' && rank > 0 ? `#${rank}` : rank === 0 ? 'N/A' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.isDark === next.isDark && prev.opponentTeam === next.opponentTeam && prev.selectedPosition === next.selectedPosition);
// Opponent Analysis (isolated, memoized)
// NOTE: This reuses the same batched DvP + rank data and caches as PositionDefenseCard
// to avoid redundant API calls and to ensure we always display real values instead of 0s.
const OpponentAnalysisCard = memo(function OpponentAnalysisCard({ 
  isDark, 
  opponentTeam, 
  selectedTimeFilter,
  propsMode,
  playerId,
  selectedStat
}: { 
  isDark: boolean; 
  opponentTeam: string; 
  selectedTimeFilter: string;
  propsMode?: 'player' | 'team';
  playerId?: string | number | null;
  selectedStat?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [activeView, setActiveView] = useState<'breakdown' | 'similar'>('breakdown');
  const [teamStats, setTeamStats] = useState<any>(null);
  const [teamRanks, setTeamRanks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset to "Opponent Breakdown" when player changes or opponent changes
  // This allows Similar Players to pre-fetch in the background without showing loading states
  useEffect(() => {
    setActiveView('breakdown');
  }, [playerId, opponentTeam]);

  useEffect(() => {
    // Don't fetch if opponent team is not set or is invalid
    if (!opponentTeam || opponentTeam === 'N/A' || opponentTeam === '' || opponentTeam === 'ALL') {
      setTeamStats(null);
      setTeamRanks({});
      setError(null);
      setLoading(false);
      return;
    }

    let abort = false;
    const LOCAL_CACHE_KEY = 'opponentAnalysisCacheV1';
    const LOCAL_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const targetOpp = opponentTeam;

      try {
        // Fetch team defensive stats from Basketball Reference (faster and more reliable)
        let defensiveStatsResponse: any;
        try {
          defensiveStatsResponse = await cachedFetch<any>(
            `/api/team-defensive-stats/bballref?team=${targetOpp}`,
            undefined,
            DVP_CACHE_TTL * 10 // Cache for 20 minutes (Basketball Reference updates daily)
          );
        } catch (fetchError: any) {
          // Handle HTTP errors (like 500, 400, etc.) and timeouts
          console.error('[OpponentAnalysisCard] Error fetching defensive stats:', fetchError);
          if (!abort) {
            setError(fetchError?.message || 'Failed to fetch defensive stats');
            setTeamStats(null);
            setTeamRanks({});
            setLoading(false);
          }
          return;
        }

        // Check if response is valid
        if (!defensiveStatsResponse) {
          console.error('[OpponentAnalysisCard] No response from defensive stats API for', targetOpp);
          if (!abort) {
            setError('No response from server');
            setTeamStats(null);
            setTeamRanks({});
            setLoading(false);
          }
          return;
        }

        console.log('[OpponentAnalysisCard] Response for', targetOpp, ':', {
          success: defensiveStatsResponse.success,
          hasPerGame: !!defensiveStatsResponse.perGame,
          sampleGames: defensiveStatsResponse.sample_games,
          error: defensiveStatsResponse.error,
          fullResponse: defensiveStatsResponse,
        });

        if (defensiveStatsResponse.success === true) {
          const perGame = defensiveStatsResponse.perGame || {};
          
          // Map BDL stats to our format (already per-game from API)
          const stats: any = {
            pts: perGame.pts || 0,
            reb: perGame.reb || 0,
            ast: perGame.ast || 0,
            fg_pct: perGame.fg_pct || 0,
            fg3_pct: perGame.fg3_pct || 0,
            stl: perGame.stl || 0,
            blk: perGame.blk || 0,
          };

          // Initialize ranks to 0 - will be fetched separately to avoid blocking
          const ranks: Record<string, number> = {
            pts: 0,
            reb: 0,
            ast: 0,
            fg_pct: 0,
            fg3_pct: 0,
            stl: 0,
            blk: 0,
          };

          // Fetch rankings asynchronously from Basketball Reference (much faster)
          (async () => {
            try {
              const rankingsResponse = await cachedFetch<any>(
                `/api/team-defensive-stats/bballref?all=1`, // Get all teams with rankings
                undefined,
                DVP_CACHE_TTL * 30 // Cache rankings for 1 hour
              );

              if (rankingsResponse?.success && rankingsResponse.rankings && !abort) {
                const normalizedOpp = normalizeAbbr(targetOpp);
                const teamRankings = rankingsResponse.rankings[normalizedOpp];
                if (teamRankings) {
                  setTeamRanks(teamRankings);
                }
              }
            } catch (rankError: any) {
              console.warn('[OpponentAnalysisCard] Failed to fetch rankings:', rankError);
              // Continue without ranks if ranking fetch fails
            }
          })();

          if (!abort) {
            setTeamStats(stats);
            setTeamRanks(ranks);
            setError(null);
          }
        } else {
          const errorMsg = defensiveStatsResponse?.error || defensiveStatsResponse?.message || 'Failed to fetch defensive stats';
          console.error('Failed to fetch defensive stats:', defensiveStatsResponse);
          if (!abort) {
            setTeamStats(null);
            setTeamRanks({});
            setError(errorMsg);
          }
        }
      } catch (error: any) {
        console.error('Failed to fetch opponent analysis data:', error);
        if (!abort) {
          setTeamStats(null);
          setTeamRanks({});
          setError(error?.message || 'Failed to load defensive stats');
        }
      } finally {
        if (!abort) setLoading(false);
      }
    };

    fetchData();

    return () => {
      abort = true;
    };
  }, [opponentTeam]);
  
  const getRankColor = (rank: number): string => {
    if (!rank || rank <= 0) return mounted && isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
    if (rank >= 25) return 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';
    if (rank >= 20) return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
    if (rank >= 15) return 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200';
    if (rank >= 10) return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
    return 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';
  };

  const formatRankLabel = (rank: number): string => {
    if (!rank || rank <= 0) return '';
    return `#${rank}`;
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Opponent Analysis</h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">Current season stats</span>
      </div>
      
      {/* Toggle buttons for Opponent Breakdown / Similar Players */}
      <div className="flex items-center gap-2 mb-4 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveView('breakdown')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeView === 'breakdown'
              ? mounted && isDark
                ? 'text-white border-b-2 border-cyan-400'
                : 'text-gray-900 border-b-2 border-cyan-500'
              : mounted && isDark
              ? 'text-gray-400 hover:text-gray-300'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Opponent Breakdown
        </button>
        {propsMode === 'player' && playerId && (
          <button
            onClick={() => setActiveView('similar')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'similar'
                ? mounted && isDark
                  ? 'text-white border-b-2 border-purple-500'
                  : 'text-gray-900 border-b-2 border-purple-500'
                : mounted && isDark
                ? 'text-gray-400 hover:text-gray-300'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Similar Players
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Always render SimilarPlayers (hidden when breakdown is active) so it starts fetching immediately when player is selected */}
        {propsMode === 'player' && playerId && (
          <div className={activeView === 'breakdown' ? 'hidden' : ''}>
            <SimilarPlayers 
              playerId={playerId} 
              opponent={opponentTeam} 
              statType={(selectedStat || 'PTS').toUpperCase()} 
              isDark={isDark} 
            />
          </div>
        )}

        {activeView === 'breakdown' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${mounted && isDark ? "bg-cyan-400" : "bg-cyan-500"} animate-pulse`} />
              <h4 className={`text-sm font-semibold font-mono tracking-wider ${mounted && isDark ? "text-white" : "text-slate-900"}`}>
                OPPONENT BREAKDOWN
              </h4>
            </div>
          
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
            <div className="space-y-2">
              <div className={`text-xs font-mono font-bold uppercase tracking-wider`}>
                <span className={`${mounted && isDark ? "text-green-400" : "text-green-600"}`}>{opponentTeam || 'TBD'}</span>
                <span className={`${mounted && isDark ? "text-slate-400" : "text-slate-500"}`}> DEFENSIVE RANKS</span>
              </div>
              <div className="space-y-3">
                {!opponentTeam || opponentTeam === 'N/A' || opponentTeam === '' || opponentTeam === 'ALL' ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Select an opponent to view defensive ranks</div>
                ) : loading ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                ) : error ? (
                  <div className="text-sm text-red-500 dark:text-red-400">{error}</div>
                ) : !teamStats ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No data available</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Points Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.pts ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.pts || 0)}`}>
                          {formatRankLabel(teamRanks.pts || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Rebounds Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.reb ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.reb || 0)}`}>
                          {formatRankLabel(teamRanks.reb || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Assists Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.ast ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.ast || 0)}`}>
                          {formatRankLabel(teamRanks.ast || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Field Goal % Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.fg_pct ?? 0).toFixed(1)}%
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.fg_pct || 0)}`}>
                          {formatRankLabel(teamRanks.fg_pct || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>3-Point % Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.fg3_pct ?? 0).toFixed(1)}%
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.fg3_pct || 0)}`}>
                          {formatRankLabel(teamRanks.fg3_pct || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Steals Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.stl ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.stl || 0)}`}>
                          {formatRankLabel(teamRanks.stl || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Blocks Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.blk ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.blk || 0)}`}>
                          {formatRankLabel(teamRanks.blk || 0)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.isDark === next.isDark &&
  prev.opponentTeam === next.opponentTeam &&
  prev.selectedTimeFilter === next.selectedTimeFilter &&
  prev.propsMode === next.propsMode &&
  prev.playerId === next.playerId &&
  prev.selectedStat === next.selectedStat
));

// Best Odds Table Component with mounted state to avoid hydration mismatch
const BestOddsTable = memo(function BestOddsTable({
  isDark,
  oddsLoading,
  oddsError,
  realOddsData,
  selectedTeam,
  gamePropsTeam,
  propsMode,
  opponentTeam,
  oddsFormat,
  fmtOdds,
  playerId,
  selectedStat
}: {
  isDark: boolean;
  oddsLoading: boolean;
  oddsError: string | null;
  realOddsData: any[];
  selectedTeam: string;
  gamePropsTeam: string;
  propsMode: 'player' | 'team';
  opponentTeam: string;
  oddsFormat: string;
  fmtOdds: (odds: string) => string;
  playerId?: string | number | null;
  selectedStat?: string;
}) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Map selectedStat to API format
  const statTypeMap: Record<string, string> = {
    'pts': 'PTS',
    'reb': 'REB',
    'ast': 'AST',
    'fg3m': 'THREES',
    'fgm': 'FGM',
    'fga': 'FGA',
    'ftm': 'FTM',
    'fta': 'FTA',
    'oreb': 'OREB',
    'dreb': 'DREB',
    'to': 'TO',
    'pf': 'PF',
    'stl': 'STL',
    'blk': 'BLK',
    'pra': 'PRA',
    'pr': 'PR',
    'pa': 'PA',
    'ra': 'RA',
  };
  const statType = selectedStat ? (statTypeMap[selectedStat.toLowerCase()] || selectedStat.toUpperCase()) : 'PTS';

  const home = (propsMode === 'team' ? gamePropsTeam : selectedTeam) || 'HOME';
  const away = opponentTeam || 'AWAY';
  const hasRealOdds = realOddsData.length > 0;
  
  // Helper to normalize team abbreviations for matching
  const normalizeAbbrForMatch = (abbr: string) => abbr?.toUpperCase().trim() || '';
  
  const books = useMemo(
    () => {
      const merged = mergeBookRowsByBaseName(hasRealOdds ? realOddsData : PLACEHOLDER_BOOK_ROWS, !hasRealOdds);
      // Show all vendors from BDL (no filtering)
      const filtered = merged;
      
      // If selected team is away, flip spread and swap odds for team mode
      if (propsMode === 'team' && filtered.length > 0) {
        const firstBook = filtered[0] as any;
        const gameHomeTeam = firstBook?.meta?.gameHomeTeam;
        const gameAwayTeam = firstBook?.meta?.gameAwayTeam;
        const selectedTeamAbbr = gamePropsTeam;
        
        if (gameHomeTeam && gameAwayTeam && selectedTeamAbbr) {
          // Convert team names to abbreviations for comparison
          const gameHomeAbbr = getTeamAbbr(gameHomeTeam);
          const gameAwayAbbr = getTeamAbbr(gameAwayTeam);
          const isAway = normalizeAbbrForMatch(gameAwayAbbr) === normalizeAbbrForMatch(selectedTeamAbbr);
          
          if (isAway) {
            // Flip spread sign and swap over/under odds, swap H2H odds
            return filtered.map((book: any) => {
              const flipped = JSON.parse(JSON.stringify(book));
              
              // Flip spread: if home is -8.5, away should be +8.5
              if (flipped.Spread && flipped.Spread.line !== 'N/A') {
                const lineVal = parseFloat(String(flipped.Spread.line).replace(/[^0-9.+-]/g, ''));
                if (!Number.isNaN(lineVal)) {
                  flipped.Spread.line = String(-lineVal); // Flip sign
                  // Swap over/under odds
                  const tempOver = flipped.Spread.over;
                  flipped.Spread.over = flipped.Spread.under;
                  flipped.Spread.under = tempOver;
                }
              }
              
              // Swap H2H odds (home becomes away, away becomes home)
              if (flipped.H2H) {
                const tempHome = flipped.H2H.home;
                flipped.H2H.home = flipped.H2H.away;
                flipped.H2H.away = tempHome;
              }
              
              return flipped;
            });
          }
        }
      }
      
      return filtered;
    },
    [hasRealOdds, realOddsData, propsMode, gamePropsTeam]
  );

  const americanToNumber = (s: string) => {
    if (s === 'N/A') return 0;
    return parseInt(s.replace(/[^+\-\d]/g, ''), 10);
  };
  
  // Convert American odds to a comparable value where higher = better
  const oddsToComparable = (s: string) => {
    if (s === 'N/A') return -Infinity;
    const american = americanToNumber(s);
    // For negative odds (favorites): -110 is better than -150 (less risk)
    // For positive odds (underdogs): +150 is better than +110 (more payout)
    // To make both comparable: convert to decimal-like value
    if (american < 0) {
      return 100 / Math.abs(american); // -110 -> ~0.909, -150 -> ~0.667
    } else if (american > 0) {
      return 1 + american / 100; // +150 -> 2.5, +110 -> 2.1
    }
    return 0;
  };
  
  // Helper to get PrizePicks variant label or formatted odds
  const getOddsDisplay = (row: any, statKey: string, oddsValue: string) => {
    const meta = (row as any)?.meta;
    const baseName = (meta?.baseName || row?.name || '').toLowerCase();
    const isPrizePicks = baseName.includes('prizepicks');
    const isPickem = meta?.isPickem ?? false;
    const variantLabel = meta?.variantLabel;
    const stat = meta?.stat;
    
    // If this is PrizePicks pick'em for the matching stat, show variant label
    if (isPrizePicks && isPickem && stat === statKey && variantLabel) {
      return variantLabel; // "Goblin" or "Demon"
    }
    
    // Otherwise show formatted odds
    return fmtOdds(oddsValue);
  };
  
  const displayHalfLine = (s: string) => {
    if (s === 'N/A') return 'N/A';
    const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
    if (Number.isNaN(v)) return s;
    const frac = Math.abs(v * 10) % 10;
    if (frac === 0) {
      const adj = v > 0 ? v - 0.5 : v + 0.5;
      return adj.toFixed(1);
    }
    return Number.isFinite(v) ? v.toFixed(1) : s;
  };

  const maxIdx = (get: (b: any) => string) => {
    let bi = 0;
    for (let i = 1; i < books.length; i++) {
      if (americanToNumber(get(books[i])) > americanToNumber(get(books[bi]))) bi = i;
    }
    return bi;
  };

  const parseLine = (s: string) => {
    if (s === 'N/A') return NaN;
    return parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
  };
  const pickBest = (
    preferLowLine: boolean,
    getLine: (b: any) => string,
    getOdds: (b: any) => string,
  ) => {
    let bestLine = preferLowLine ? Infinity : -Infinity;
    for (let i = 0; i < books.length; i++) {
      const v = parseLine(getLine(books[i]));
      if (Number.isNaN(v)) continue;
      if (preferLowLine ? v < bestLine : v > bestLine) bestLine = v;
    }
    const EPS = 1e-6;
    const candIdx: number[] = [];
    for (let i = 0; i < books.length; i++) {
      const v = parseLine(getLine(books[i]));
      if (!Number.isNaN(v) && Math.abs(v - bestLine) < EPS) candIdx.push(i);
    }
    if (candIdx.length <= 1) return new Set(candIdx);
    let maxOdds = -Infinity;
    let bestIdx = candIdx[0];
    for (const i of candIdx) {
      const o = americanToNumber(getOdds(books[i]));
      if (o > maxOdds) {
        maxOdds = o;
        bestIdx = i;
      }
    }
    return new Set([bestIdx]);
  };

  const bestH2H = {
    home: maxIdx((b: any) => b.H2H.home),
    away: maxIdx((b: any) => b.H2H.away),
  } as const;

  // For Spread: - display wants max line (closest to 0), + display wants min line (farthest from 0)
  const pickBestSpreadForPositive = () => {
    return pickBest(true, (b: any) => b.Spread.line, (b: any) => b.Spread.over); // min line for + display
  };
  
  const pickBestSpreadForNegative = () => {
    return pickBest(false, (b: any) => b.Spread.line, (b: any) => b.Spread.under); // max line for - display
  };

  const bestSets = {
    Spread: {
      positive: pickBestSpreadForPositive(),  // + display: min line (e.g., -8.5 shown as +8.5)
      negative: pickBestSpreadForNegative(),  // - display: max line (e.g., -7.5 shown as -7.5)
    },
    Total: {
      over: pickBest(true, (b: any) => b.Total.line, (b: any) => b.Total.over),
      under: pickBest(false, (b: any) => b.Total.line, (b: any) => b.Total.under),
    },
    PTS: {
      over: pickBest(true, (b: any) => b.PTS.line, (b: any) => b.PTS.over),
      under: pickBest(false, (b: any) => b.PTS.line, (b: any) => b.PTS.under),
    },
    REB: {
      over: pickBest(true, (b: any) => b.REB.line, (b: any) => b.REB.over),
      under: pickBest(false, (b: any) => b.REB.line, (b: any) => b.REB.under),
    },
    AST: {
      over: pickBest(true, (b: any) => b.AST.line, (b: any) => b.AST.over),
      under: pickBest(false, (b: any) => b.AST.line, (b: any) => b.AST.under),
    },
    THREES: {
      over: pickBest(true, (b: any) => b.THREES?.line, (b: any) => b.THREES?.over),
      under: pickBest(false, (b: any) => b.THREES?.line, (b: any) => b.THREES?.under),
    },
    PRA: {
      over: pickBest(true, (b: any) => b.PRA?.line, (b: any) => b.PRA?.over),
      under: pickBest(false, (b: any) => b.PRA?.line, (b: any) => b.PRA?.under),
    },
    PR: {
      over: pickBest(true, (b: any) => b.PR?.line, (b: any) => b.PR?.over),
      under: pickBest(false, (b: any) => b.PR?.line, (b: any) => b.PR?.under),
    },
    PA: {
      over: pickBest(true, (b: any) => b.PA?.line, (b: any) => b.PA?.over),
      under: pickBest(false, (b: any) => b.PA?.line, (b: any) => b.PA?.under),
    },
    RA: {
      over: pickBest(true, (b: any) => b.RA?.line, (b: any) => b.RA?.over),
      under: pickBest(false, (b: any) => b.RA?.line, (b: any) => b.RA?.under),
    },
  } as const;

  const green = mounted && isDark ? 'text-green-400' : 'text-green-600';
  const grey = mounted && isDark ? 'text-slate-300' : 'text-slate-600';

  // Different markets for player vs team mode
  const markets = propsMode === 'player' 
    ? ['PTS','REB','AST','3PT','P+R+A','P+R','P+A','R+A']
    : ['H2H','Spread','Total'];

  return (
    <div className="lg:hidden bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3 md:p-4 border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Best Odds</h3>
      </div>
      
      {oddsLoading && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Loading odds data...</div>
      )}
      {oddsError && (
        <div className="text-xs text-red-500 mb-2">Error: {oddsError}</div>
      )}
      
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className={(mounted && isDark ? 'bg-slate-900' : 'bg-slate-100') + ' sticky top-0'}>
              <th className="text-left py-2 pr-3 font-semibold text-gray-700 dark:text-gray-300">Bookmaker</th>
              {markets.map((market) => (
                <th key={market} className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{market}</th>
              ))}
            </tr>
          </thead>
          <tbody>
          {books.map((row: any, i: number) => (
            <tr key={`${row.name}-${i}`} className={mounted && isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.name}</td>
              
              {/* Team mode: show H2H, Spread, Total */}
              {propsMode === 'team' && (
                <>
              <td className="py-2 px-3">
                <div className="font-mono text-gray-900 dark:text-white whitespace-nowrap">
{home} <span className={i === bestH2H.home ? green : grey}>{fmtOdds(row.H2H.home)}</span>
                </div>
                <div className="font-mono text-gray-900 dark:text-white opacity-80 whitespace-nowrap">
{away} <span className={i === bestH2H.away ? green : grey}>{fmtOdds(row.H2H.away)}</span>
                </div>
              </td>
              <td className="py-2 px-3">
                {(() => {
                  const lineVal = parseLine(row.Spread.line);
                  if (row.Spread.line === 'N/A' || Number.isNaN(lineVal)) {
                    return (
                      <>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          + N/A ({fmtOdds(row.Spread.over)})
                        </div>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          - N/A ({fmtOdds(row.Spread.under)})
                        </div>
                      </>
                    );
                  }
                  // Display both + and - with the same line value
                  const absLineVal = Math.abs(lineVal);
                  return (
                    <>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.positive.has(i) ? green : grey}`}>
                        + {displayHalfLine(String(absLineVal))} ({fmtOdds(row.Spread.over)})
                      </div>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.negative.has(i) ? green : grey}`}>
                        - {displayHalfLine(String(absLineVal))} ({fmtOdds(row.Spread.under)})
                      </div>
                    </>
                  );
                })()}
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.Total.over.has(i) ? green : grey}`}>O {displayHalfLine(row.Total.line)} ({fmtOdds(row.Total.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.Total.under.has(i) ? green : grey}`}>U {displayHalfLine(row.Total.line)} ({fmtOdds(row.Total.under)})</div>
              </td>
                </>
              )}
              
              {/* Player mode: show player props */}
              {propsMode === 'player' && (
                <>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PTS.line)} ({getOddsDisplay(row, 'PTS', row.PTS.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PTS.line)} ({getOddsDisplay(row, 'PTS', row.PTS.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.REB.over.has(i) ? green : grey}`}>O {displayHalfLine(row.REB.line)} ({getOddsDisplay(row, 'REB', row.REB.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.REB.under.has(i) ? green : grey}`}>U {displayHalfLine(row.REB.line)} ({getOddsDisplay(row, 'REB', row.REB.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.AST.over.has(i) ? green : grey}`}>O {displayHalfLine(row.AST.line)} ({getOddsDisplay(row, 'AST', row.AST.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.AST.under.has(i) ? green : grey}`}>U {displayHalfLine(row.AST.line)} ({getOddsDisplay(row, 'AST', row.AST.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.over.has(i) ? green : grey}`}>O {displayHalfLine(row.THREES?.line || 'N/A')} ({getOddsDisplay(row, 'THREES', row.THREES?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.under.has(i) ? green : grey}`}>U {displayHalfLine(row.THREES?.line || 'N/A')} ({getOddsDisplay(row, 'THREES', row.THREES?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PRA?.line || 'N/A')} ({getOddsDisplay(row, 'PRA', row.PRA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PRA?.line || 'N/A')} ({getOddsDisplay(row, 'PRA', row.PRA?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PR.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PR?.line || 'N/A')} ({fmtOdds(row.PR?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PR.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PR?.line || 'N/A')} ({fmtOdds(row.PR?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PA?.line || 'N/A')} ({fmtOdds(row.PA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PA?.line || 'N/A')} ({fmtOdds(row.PA?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.RA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.RA?.line || 'N/A')} ({fmtOdds(row.RA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.RA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.RA?.line || 'N/A')} ({fmtOdds(row.RA?.under || 'N/A')})</div>
              </td>
                </>
              )}
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}, (prev, next) => (
  prev.isDark === next.isDark &&
  prev.oddsLoading === next.oddsLoading &&
  prev.oddsError === next.oddsError &&
  prev.realOddsData === next.realOddsData &&
  prev.selectedTeam === next.selectedTeam &&
  prev.gamePropsTeam === next.gamePropsTeam &&
  prev.propsMode === next.propsMode &&
  prev.opponentTeam === next.opponentTeam &&
  prev.oddsFormat === next.oddsFormat &&
  prev.playerId === next.playerId &&
  prev.selectedStat === next.selectedStat
));

const BestOddsTableDesktop = memo(function BestOddsTableDesktop({
  isDark,
  oddsLoading,
  oddsError,
  realOddsData,
  selectedTeam,
  gamePropsTeam,
  propsMode,
  opponentTeam,
  oddsFormat,
  fmtOdds,
  playerId,
  selectedStat
}: {
  isDark: boolean;
  oddsLoading: boolean;
  oddsError: string | null;
  realOddsData: any[];
  selectedTeam: string;
  gamePropsTeam: string;
  propsMode: 'player' | 'team';
  opponentTeam: string;
  oddsFormat: string;
  fmtOdds: (odds: string) => string;
  playerId?: string | number | null;
  selectedStat?: string;
}) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Map selectedStat to API format
  const statTypeMap: Record<string, string> = {
    'pts': 'PTS',
    'reb': 'REB',
    'ast': 'AST',
    'fg3m': 'THREES',
    'fgm': 'FGM',
    'fga': 'FGA',
    'ftm': 'FTM',
    'fta': 'FTA',
    'oreb': 'OREB',
    'dreb': 'DREB',
    'to': 'TO',
    'pf': 'PF',
    'stl': 'STL',
    'blk': 'BLK',
    'pra': 'PRA',
    'pr': 'PR',
    'pa': 'PA',
    'ra': 'RA',
  };
  const statType = selectedStat ? (statTypeMap[selectedStat.toLowerCase()] || selectedStat.toUpperCase()) : 'PTS';

  const home = (propsMode === 'team' ? gamePropsTeam : selectedTeam) || 'HOME';
  const away = opponentTeam || 'AWAY';
  const hasRealOdds = realOddsData.length > 0;
  
  // Helper to normalize team abbreviations for matching
  const normalizeAbbrForMatch = (abbr: string) => abbr?.toUpperCase().trim() || '';
  
  const books = useMemo(
    () => {
      const merged = mergeBookRowsByBaseName(hasRealOdds ? realOddsData : PLACEHOLDER_BOOK_ROWS, !hasRealOdds);
      // Show all vendors from BDL (no filtering)
      const filtered = merged;
      
      // If selected team is away, flip spread and swap odds for team mode
      if (propsMode === 'team' && filtered.length > 0) {
        const firstBook = filtered[0] as any;
        const gameHomeTeam = firstBook?.meta?.gameHomeTeam;
        const gameAwayTeam = firstBook?.meta?.gameAwayTeam;
        const selectedTeamAbbr = gamePropsTeam;
        
        if (gameHomeTeam && gameAwayTeam && selectedTeamAbbr) {
          // Convert team names to abbreviations for comparison
          const gameHomeAbbr = getTeamAbbr(gameHomeTeam);
          const gameAwayAbbr = getTeamAbbr(gameAwayTeam);
          const isAway = normalizeAbbrForMatch(gameAwayAbbr) === normalizeAbbrForMatch(selectedTeamAbbr);
          
          if (isAway) {
            // Flip spread sign and swap over/under odds, swap H2H odds
            return filtered.map((book: any) => {
              const flipped = JSON.parse(JSON.stringify(book));
              
              // Flip spread: if home is -8.5, away should be +8.5
              if (flipped.Spread && flipped.Spread.line !== 'N/A') {
                const lineVal = parseFloat(String(flipped.Spread.line).replace(/[^0-9.+-]/g, ''));
                if (!Number.isNaN(lineVal)) {
                  flipped.Spread.line = String(-lineVal); // Flip sign
                  // Swap over/under odds
                  const tempOver = flipped.Spread.over;
                  flipped.Spread.over = flipped.Spread.under;
                  flipped.Spread.under = tempOver;
                }
              }
              
              // Swap H2H odds (home becomes away, away becomes home)
              if (flipped.H2H) {
                const tempHome = flipped.H2H.home;
                flipped.H2H.home = flipped.H2H.away;
                flipped.H2H.away = tempHome;
              }
              
              return flipped;
            });
          }
        }
      }
      
      return filtered;
    },
    [hasRealOdds, realOddsData, propsMode, gamePropsTeam]
  );

  const americanToNumber = (s: string) => {
    if (s === 'N/A') return 0;
    return parseInt(s.replace(/[^+\-\d]/g, ''), 10);
  };
  
  // Convert American odds to a comparable value where higher = better
  const oddsToComparable = (s: string) => {
    if (s === 'N/A') return -Infinity;
    const american = americanToNumber(s);
    // For negative odds (favorites): -110 is better than -150 (less risk)
    // For positive odds (underdogs): +150 is better than +110 (more payout)
    // To make both comparable: convert to decimal-like value
    if (american < 0) {
      return 100 / Math.abs(american); // -110 -> ~0.909, -150 -> ~0.667
    } else if (american > 0) {
      return 1 + american / 100; // +150 -> 2.5, +110 -> 2.1
    }
    return 0;
  };
  
  // Helper to get PrizePicks variant label or formatted odds
  const getOddsDisplay = (row: any, statKey: string, oddsValue: string) => {
    const meta = (row as any)?.meta;
    const baseName = (meta?.baseName || row?.name || '').toLowerCase();
    const isPrizePicks = baseName.includes('prizepicks');
    const isPickem = meta?.isPickem ?? false;
    const variantLabel = meta?.variantLabel;
    const stat = meta?.stat;
    
    // If this is PrizePicks pick'em for the matching stat, show variant label
    if (isPrizePicks && isPickem && stat === statKey && variantLabel) {
      return variantLabel; // "Goblin" or "Demon"
    }
    
    // Otherwise show formatted odds
    return fmtOdds(oddsValue);
  };
  
  const displayHalfLine = (s: string) => {
    if (s === 'N/A') return 'N/A';
    const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
    if (Number.isNaN(v)) return s;
    const frac = Math.abs(v * 10) % 10;
    if (frac === 0) {
      const adj = v > 0 ? v - 0.5 : v + 0.5;
      return adj.toFixed(1);
    }
    return Number.isFinite(v) ? v.toFixed(1) : s;
  };

  const maxIdx = (get: (b: any) => string) => {
    let bi = 0;
    for (let i = 1; i < books.length; i++) {
      if (americanToNumber(get(books[i])) > americanToNumber(get(books[bi]))) bi = i;
    }
    return bi;
  };

  const parseLine = (s: string) => {
    if (s === 'N/A') return NaN;
    return parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
  };
  const pickBest = (
    preferLowLine: boolean,
    getLine: (b: any) => string,
    getOdds: (b: any) => string,
  ) => {
    let bestLine = preferLowLine ? Infinity : -Infinity;
    for (let i = 0; i < books.length; i++) {
      const v = parseLine(getLine(books[i]));
      if (Number.isNaN(v)) continue;
      if (preferLowLine ? v < bestLine : v > bestLine) bestLine = v;
    }
    const EPS = 1e-6;
    const candIdx: number[] = [];
    for (let i = 0; i < books.length; i++) {
      const v = parseLine(getLine(books[i]));
      if (!Number.isNaN(v) && Math.abs(v - bestLine) < EPS) candIdx.push(i);
    }
    if (candIdx.length <= 1) return new Set(candIdx);
    let maxOdds = -Infinity;
    let bestIdx = candIdx[0];
    for (const i of candIdx) {
      const o = americanToNumber(getOdds(books[i]));
      if (o > maxOdds) {
        maxOdds = o;
        bestIdx = i;
      }
    }
    return new Set([bestIdx]);
  };

  const bestH2H = {
    home: maxIdx((b: any) => b.H2H.home),
    away: maxIdx((b: any) => b.H2H.away),
  } as const;

  // For Spread: - display wants max line (closest to 0), + display wants min line (farthest from 0)
  const pickBestSpreadForPositive = () => {
    return pickBest(true, (b: any) => b.Spread.line, (b: any) => b.Spread.over); // min line for + display
  };
  
  const pickBestSpreadForNegative = () => {
    return pickBest(false, (b: any) => b.Spread.line, (b: any) => b.Spread.under); // max line for - display
  };

  const bestSets = {
    Spread: {
      positive: pickBestSpreadForPositive(),  // + display: min line (e.g., -8.5 shown as +8.5)
      negative: pickBestSpreadForNegative(),  // - display: max line (e.g., -7.5 shown as -7.5)
    },
    Total: {
      over: pickBest(true, (b: any) => b.Total.line, (b: any) => b.Total.over),
      under: pickBest(false, (b: any) => b.Total.line, (b: any) => b.Total.under),
    },
    PTS: {
      over: pickBest(true, (b: any) => b.PTS.line, (b: any) => b.PTS.over),
      under: pickBest(false, (b: any) => b.PTS.line, (b: any) => b.PTS.under),
    },
    REB: {
      over: pickBest(true, (b: any) => b.REB.line, (b: any) => b.REB.over),
      under: pickBest(false, (b: any) => b.REB.line, (b: any) => b.REB.under),
    },
    AST: {
      over: pickBest(true, (b: any) => b.AST.line, (b: any) => b.AST.over),
      under: pickBest(false, (b: any) => b.AST.line, (b: any) => b.AST.under),
    },
    THREES: {
      over: pickBest(true, (b: any) => b.THREES?.line, (b: any) => b.THREES?.over),
      under: pickBest(false, (b: any) => b.THREES?.line, (b: any) => b.THREES?.under),
    },
    PRA: {
      over: pickBest(true, (b: any) => b.PRA?.line, (b: any) => b.PRA?.over),
      under: pickBest(false, (b: any) => b.PRA?.line, (b: any) => b.PRA?.under),
    },
    PR: {
      over: pickBest(true, (b: any) => b.PR?.line, (b: any) => b.PR?.over),
      under: pickBest(false, (b: any) => b.PR?.line, (b: any) => b.PR?.under),
    },
    PA: {
      over: pickBest(true, (b: any) => b.PA?.line, (b: any) => b.PA?.over),
      under: pickBest(false, (b: any) => b.PA?.line, (b: any) => b.PA?.under),
    },
    RA: {
      over: pickBest(true, (b: any) => b.RA?.line, (b: any) => b.RA?.over),
      under: pickBest(false, (b: any) => b.RA?.line, (b: any) => b.RA?.under),
    },
  } as const;

  const green = mounted && isDark ? 'text-green-400' : 'text-green-600';
  const grey = mounted && isDark ? 'text-slate-300' : 'text-slate-600';

  // Different markets for player vs team mode
  const markets = propsMode === 'player' 
    ? ['PTS','REB','AST','3PT','P+R+A','P+R','P+A','R+A']
    : ['H2H','Spread','Total'];

  return (
    <div className="hidden lg:block bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Best Odds</h3>
      </div>
      
      {oddsLoading && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Loading odds data...</div>
      )}
      {oddsError && (
        <div className="text-xs text-red-500 mb-2">Error: {oddsError}</div>
      )}
      
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className={(mounted && isDark ? 'bg-slate-900' : 'bg-slate-100') + ' sticky top-0'}>
              <th className="text-left py-2 pr-3 font-semibold text-gray-700 dark:text-gray-300">Bookmaker</th>
              {markets.map((market) => (
                <th key={market} className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{market}</th>
              ))}
            </tr>
          </thead>
          <tbody>
          {books.map((row: any, i: number) => (
            <tr key={`${row.name}-${i}`} className={mounted && isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.name}</td>
              
              {/* Team mode: show H2H, Spread, Total */}
              {propsMode === 'team' && (
                <>
              <td className="py-2 px-3">
                <div className="font-mono text-gray-900 dark:text-white whitespace-nowrap">
{home} <span className={i === bestH2H.home ? green : grey}>{fmtOdds(row.H2H.home)}</span>
                </div>
                <div className="font-mono text-gray-900 dark:text-white opacity-80 whitespace-nowrap">
{away} <span className={i === bestH2H.away ? green : grey}>{fmtOdds(row.H2H.away)}</span>
                </div>
              </td>
              <td className="py-2 px-3">
                {(() => {
                  const lineVal = parseLine(row.Spread.line);
                  if (row.Spread.line === 'N/A' || Number.isNaN(lineVal)) {
                    return (
                      <>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          + N/A ({fmtOdds(row.Spread.over)})
                        </div>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          - N/A ({fmtOdds(row.Spread.under)})
                        </div>
                      </>
                    );
                  }
                  // Display both + and - with the same line value
                  const absLineVal = Math.abs(lineVal);
                  return (
                    <>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.positive.has(i) ? green : grey}`}>
                        + {displayHalfLine(String(absLineVal))} ({fmtOdds(row.Spread.over)})
                      </div>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.negative.has(i) ? green : grey}`}>
                        - {displayHalfLine(String(absLineVal))} ({fmtOdds(row.Spread.under)})
                      </div>
                    </>
                  );
                })()}
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.Total.over.has(i) ? green : grey}`}>O {displayHalfLine(row.Total.line)} ({fmtOdds(row.Total.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.Total.under.has(i) ? green : grey}`}>U {displayHalfLine(row.Total.line)} ({fmtOdds(row.Total.under)})</div>
              </td>
                </>
              )}
              
              {/* Player mode: show player props */}
              {propsMode === 'player' && (
                <>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PTS.line)} ({getOddsDisplay(row, 'PTS', row.PTS.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PTS.line)} ({getOddsDisplay(row, 'PTS', row.PTS.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.REB.over.has(i) ? green : grey}`}>O {displayHalfLine(row.REB.line)} ({getOddsDisplay(row, 'REB', row.REB.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.REB.under.has(i) ? green : grey}`}>U {displayHalfLine(row.REB.line)} ({getOddsDisplay(row, 'REB', row.REB.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.AST.over.has(i) ? green : grey}`}>O {displayHalfLine(row.AST.line)} ({getOddsDisplay(row, 'AST', row.AST.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.AST.under.has(i) ? green : grey}`}>U {displayHalfLine(row.AST.line)} ({getOddsDisplay(row, 'AST', row.AST.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.over.has(i) ? green : grey}`}>O {displayHalfLine(row.THREES?.line || 'N/A')} ({getOddsDisplay(row, 'THREES', row.THREES?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.under.has(i) ? green : grey}`}>U {displayHalfLine(row.THREES?.line || 'N/A')} ({getOddsDisplay(row, 'THREES', row.THREES?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PRA?.line || 'N/A')} ({getOddsDisplay(row, 'PRA', row.PRA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PRA?.line || 'N/A')} ({getOddsDisplay(row, 'PRA', row.PRA?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PR.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PR?.line || 'N/A')} ({fmtOdds(row.PR?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PR.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PR?.line || 'N/A')} ({fmtOdds(row.PR?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PA?.line || 'N/A')} ({fmtOdds(row.PA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PA?.line || 'N/A')} ({fmtOdds(row.PA?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.RA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.RA?.line || 'N/A')} ({fmtOdds(row.RA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.RA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.RA?.line || 'N/A')} ({fmtOdds(row.RA?.under || 'N/A')})</div>
              </td>
                </>
              )}
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}, (prev, next) => (
  prev.isDark === next.isDark &&
  prev.oddsLoading === next.oddsLoading &&
  prev.oddsError === next.oddsError &&
  prev.realOddsData === next.realOddsData &&
  prev.selectedTeam === next.selectedTeam &&
  prev.gamePropsTeam === next.gamePropsTeam &&
  prev.propsMode === next.propsMode &&
  prev.opponentTeam === next.opponentTeam &&
  prev.oddsFormat === next.oddsFormat &&
  prev.playerId === next.playerId &&
  prev.selectedStat === next.selectedStat
));

function NBADashboardContent() {
  const router = useRouter();
  const { isDark, theme, setTheme } = useTheme();
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
          console.log('🔐 Dashboard Pro Status Check:', { isActive, isProTier, proStatus, profile, metadata: session.user.user_metadata });
          
          if (isMounted) {
            setIsPro(proStatus);
          }
          
          if (isActive) {
            lastSubscriptionStatus = { isActive, isPro: proStatus };
          }
        }
      } catch (error) {
        console.error('Error checking subscription:', error);
        // If we have a cached active subscription, keep it (never log out active subscribers)
        if (lastSubscriptionStatus?.isActive && isMounted) {
          console.log('🔐 Using cached active subscription status due to error');
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
      console.error('Portal error:', error);
      router.push('/subscription');
    }
  };

  const [propsMode, setPropsMode] = useState<'player' | 'team'>('player');
  const [selectedStat, setSelectedStat] = useState('pts');
  
  // Ensure correct default stat is set when propsMode changes
  useEffect(() => {
    if (propsMode === 'player') {
      // Force non-Pro users back to Game Props mode
      if (!isPro) {
        setPropsMode('team');
        setSelectedStat('total_pts');
        return;
      }
      
      // Clear opponent when switching to player mode (player props don't have opponents)
      setOpponentTeam('');
      
      // Set default stat if needed
      if (selectedStat !== 'pts') {
        const playerStatExists = PLAYER_STAT_OPTIONS.find(s => s.key === selectedStat);
        if (!playerStatExists) {
          setSelectedStat('pts');
        }
      }
    } else if (propsMode === 'team' && selectedStat !== 'total_pts') {
      // Only change if we're not already on total_pts to avoid unnecessary updates
      const teamStatExists = TEAM_STAT_OPTIONS.find(s => s.key === selectedStat);
      if (!teamStatExists) {
        setSelectedStat('total_pts');
      }
    }
  }, [propsMode, isPro]);
  const [selectedTimeframe, setSelectedTimeframe] = useState('last10');
  // Betting lines per stat (independent) - will be populated by odds API
  const [bettingLines, setBettingLines] = useState<Record<string, number>>({});
  
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
      return bettingLines[selectedStat];
    }
    // Otherwise default to 0.5 (will be updated by useEffect when bestLineForStat is available)
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

  // selection + data
  const [selectedPlayer, setSelectedPlayer] = useState<NBAPlayer | null>(null);
  const [resolvedPlayerId, setResolvedPlayerId] = useState<string | null>(null);
  const [playerStats, setPlayerStats] = useState<BallDontLieStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  
  // Clear odds data when player changes (odds are separate from player stats)
  // Player stats are cleared by handlePlayerSelect functions at the start
  useEffect(() => {
    if (selectedPlayer === null) {
      // Player cleared - reset odds only
      setRealOddsData([]);
      setOddsSnapshots([]);
      setLineMovementData(null);
      setBettingLines({});
      return;
    }
    
    // Player changed - clear odds data only
    // Player stats are managed by handlePlayerSelect functions
    setRealOddsData([]);
    setOddsSnapshots([]);
    setLineMovementData(null);
    setOddsLoading(false);
    setOddsError(null);
    setBettingLines({});
    setBookOpeningLine(null);
    setBookCurrentLine(null);
  }, [selectedPlayer]);
  
  // Advanced stats state
  const [advancedStats, setAdvancedStats] = useState<AdvancedStats | null>(null);
  const [advancedStatsLoading, setAdvancedStatsLoading] = useState(false);
  const [advancedStatsError, setAdvancedStatsError] = useState<string | null>(null);
  
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
      setLineMovementLoading(false);
      setLineMovementData(null);
      return;
    }
    const fetchLineMovement = async () => {
      console.log('📊 Line Movement Fetch Check:', { propsMode, selectedPlayer: selectedPlayer?.full, selectedTeam, opponentTeam, selectedStat });
      
      // Only fetch for player mode
      if (propsMode !== 'player' || !selectedPlayer || !selectedTeam || !opponentTeam || opponentTeam === '' || opponentTeam === 'N/A') {
        console.log('⏸️ Skipping line movement fetch - missing requirements');
        setLineMovementData(null);
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
  
  // Tracking modals state
  const [showTrackModal, setShowTrackModal] = useState(false);
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

      try {
        const response = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`);
        const data = await response.json();
        const arr = Array.isArray(data?.data) ? data.data : [];
        if (arr.length > 0) {
          console.log(`✅ Fetched ${arr.length} games from ${start} to ${end}`);
          console.log(`   Games: ${arr.map((g: any) => `${g.home_team?.abbreviation} vs ${g.visitor_team?.abbreviation}`).join(', ')}`);
          setTodaysGames(arr);
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

  // Fetch team matchup stats for pie chart comparison
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
    
    fetchTeamMatchupStats();
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
  const [teammatePlayedGameIds, setTeammatePlayedGameIds] = useState<Set<number>>(new Set());
  const [loadingTeammateGames, setLoadingTeammateGames] = useState<boolean>(false);

  // Reset teammate filters whenever the primary context changes (new player/team tab)
  useEffect(() => {
    // Always clear when leaving player mode or switching players
    setTeammateFilterId(null);
    setTeammatePlayedGameIds(new Set());
    setWithWithoutMode('with');
    setLoadingTeammateGames(false);
  }, [propsMode, selectedPlayer?.id]);

  const clearTeammateFilter = useCallback(() => {
    setTeammateFilterId(null);
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
        if (saved?.selectedStat) setSelectedStat(saved.selectedStat);
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
        const url = new URL(window.location.href);
        const pid = url.searchParams.get('pid');
        const name = url.searchParams.get('name');
        const team = url.searchParams.get('team') || undefined;
        const stat = url.searchParams.get('stat');
        const tf = url.searchParams.get('tf');
        const mode = url.searchParams.get('mode');
        
        if (mode === 'team' || mode === 'player') {
          initialPropsMode = mode;
          setPropsMode(mode);
        }
        if (stat) setSelectedStat(stat);
        // Only restore timeframe from URL if we have playerStats loaded (prevents race condition)
        if (tf && playerStats.length > 0) {
          setSelectedTimeframe(tf);
        } else if (tf) {
          // Store it to restore later when stats load
          const saved = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedTimeframe = tf;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
        }
        if (pid && name) {
          const r: BdlSearchResult = { id: Number(pid), full: name, team, pos: undefined };
          if (initialPropsMode === 'player') {
            handlePlayerSelectFromSearch(r);
            shouldLoadDefaultPlayer = false;
            return;
          }
        }
      }
    } catch {}

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
  const hasRestoredTimeframeRef = useRef(false);
  useEffect(() => {
    if (playerStats.length > 0 && !hasRestoredTimeframeRef.current && selectedTimeframe === 'last10') {
      // Only restore if we're still on default timeframe (last10)
      // This means we haven't manually selected a timeframe yet
      try {
        const saved = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.selectedTimeframe && parsed.selectedTimeframe !== 'last10') {
            setSelectedTimeframe(parsed.selectedTimeframe);
          }
        }
      } catch {}
      hasRestoredTimeframeRef.current = true;
    }
  }, [playerStats.length]); // Removed selectedTimeframe from dependencies to prevent re-running on every change

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
        
        // Update URL for share/save
        const url = new URL(window.location.href);
        url.searchParams.set('mode', propsMode);
        
        if (selectedPlayer && selectedTeam && propsMode === 'player') {
          const r = baseSave.player as BdlSearchResult;
          url.searchParams.set('pid', String(r.id));
          url.searchParams.set('name', r.full);
          url.searchParams.set('team', selectedTeam);
        } else {
          // Remove player-specific params when not in player mode
          url.searchParams.delete('pid');
          url.searchParams.delete('name');
          url.searchParams.delete('team');
        }
        
        url.searchParams.set('stat', selectedStat);
        url.searchParams.set('tf', selectedTimeframe);
        window.history.replaceState({}, '', url.toString());
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
    const season = currentNbaSeason();
    const grab = async (yr: number, postseason = false) => {
      const r = await fetch(`/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=3&postseason=${postseason}`);
      const j = await r.json().catch(() => ({}));
      return (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
    };

    // Fetch current season + previous season (for "last season" filter and H2H comparisons)
    // We need both seasons available in playerStats, but default display will show only current season
    const [currReg, currPO, prev1Reg, prev1PO] = await Promise.all([
      grab(season, false),        // 2024-25 regular
      grab(season, true),         // 2024-25 playoffs
      grab(season - 1, false),    // 2023-24 regular (for last season filter)
      grab(season - 1, true),     // 2023-24 playoffs (for last season filter)
    ]);

    // Merge current + previous season data, then sort newest-first
    // The baseGameData useMemo will filter by selectedTimeframe to show current/last season
    const rows = [...currReg, ...currPO, ...prev1Reg, ...prev1PO];
    const safe = rows.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
    safe.sort((a, b) => {
      const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return db - da; // newest first
    });
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
      
      // OPTIMIZATION: Lazy load premium stats
      // Fetch critical path data first: game stats + BDL player data + ESPN (as fallback)
      // Then load premium features (advanced stats, shot distance) in background
      const [rows, bdlPlayerData, espnData] = await Promise.all([
        fetchSortedStats(pid),
        fetchBdlPlayerData(pid),
        fetchEspnPlayerData(player.full, player.teamAbbr).catch(() => null) // Fetch ESPN in parallel as fallback
      ]);
      
      // Start premium fetches in background (don't await)
      if (hasPremium) {
        // Fire and forget - these will update state when ready
        fetchAdvancedStats(pid).catch(err => console.error('Advanced stats error:', err));
        fetchShotDistanceStats(pid).catch(err => console.error('Shot distance error:', err));
      }
      
      setPlayerStats(rows);
      
      // Use sample data team directly for default players - NO GAME DATA FALLBACK
      const currentTeam = normalizeAbbr(player.teamAbbr);
      setSelectedTeam(currentTeam);
      setOriginalPlayerTeam(currentTeam); // Track the original player's team
      setDepthChartTeam(currentTeam); // Initialize depth chart to show player's team
      
      // Parse BDL height data and merge with sample player data
      const heightData = parseBdlHeight(bdlPlayerData?.height);
      
      // Get jersey and height from BDL, with fallbacks to player object
      // BDL returns jersey_number as string, so check for empty string too
      const bdlJersey = bdlPlayerData?.jersey_number;
      const bdlJerseyNum = (bdlJersey && bdlJersey !== '' && bdlJersey !== 'null' && bdlJersey !== '0') 
        ? Number(bdlJersey) 
        : 0;
      let jerseyNumber = bdlJerseyNum > 0 ? bdlJerseyNum : (player.jersey || 0);
      let heightFeetData: number | undefined = heightData.feet || player.heightFeet || undefined;
      let heightInchesData: number | undefined = heightData.inches || player.heightInches || undefined;
      
      console.log(`🔍 BDL data for ${player.full}:`, {
        jersey_number: bdlJersey,
        height: bdlPlayerData?.height,
        parsedHeight: heightData
      });
      
      // Fallback to depth chart roster for jersey if still missing
      if (!jerseyNumber && playerTeamRoster) {
        // Search all positions in roster for this player
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
      
      setSelectedPlayer({
        ...player,
        jersey: jerseyNumber,
        heightFeet: heightFeetData || undefined,
        heightInches: heightInchesData || undefined,
      });
      
      // Reset betting lines to default for new player
      setBettingLines({});
      
      // Set opponent team based on games schedule (will update when games load)
      const opponent = getOpponentTeam(currentTeam, todaysGames);
      const normalizedOpponent = normalizeAbbr(opponent);
      console.log(`[Player Select] Setting opponent for ${currentTeam}: ${normalizedOpponent} (raw: ${opponent})`);
      setOpponentTeam(normalizedOpponent);
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
    } catch (e: any) {
      setApiError(e?.message || "Failed to load stats."); setPlayerStats([]);
      setOpponentTeam('');
    } finally { setIsLoading(false); }
  };

  // Select from live search results
  const handlePlayerSelectFromSearch = async (r: BdlSearchResult) => {
    console.log('🔍 handlePlayerSelectFromSearch called with:', r);
    setIsLoading(true); 
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
      
      // OPTIMIZATION: Lazy load premium stats
      // Fetch critical path data first: game stats + BDL player data + ESPN (as fallback)
      // Then load premium features (advanced stats, shot distance) in background
      const [rows, bdlPlayerData, espnData] = await Promise.all([
        fetchSortedStats(pid),
        fetchBdlPlayerData(pid),
        fetchEspnPlayerData(r.full, r.team).catch(() => null) // Fetch ESPN in parallel as fallback
      ]);
      
      // Start premium fetches in background (don't await)
      if (hasPremium) {
        // Fire and forget - these will update state when ready
        fetchAdvancedStats(pid).catch(err => console.error('Advanced stats error:', err));
        fetchShotDistanceStats(pid).catch(err => console.error('Shot distance error:', err));
      }
      
      setPlayerStats(rows);
      
      // Use the team from search API directly - NO FALLBACK TO GAME DATA
      const currentTeam = normalizeAbbr(r.team || '');
      setSelectedTeam(currentTeam);
      setOriginalPlayerTeam(currentTeam); // Track the original player's team
      setDepthChartTeam(currentTeam); // Initialize depth chart to show player's team
      
      // Parse BDL height data
      const heightData = parseBdlHeight(bdlPlayerData?.height);
      
      // Debug BDL data
      console.log('🏀 Full BDL player data:', bdlPlayerData);
      
      // Get jersey and height from BDL, with fallbacks
      // BDL returns jersey_number as string, so check for empty string too
      const bdlJersey = bdlPlayerData?.jersey_number;
      const bdlJerseyNum = (bdlJersey && bdlJersey !== '' && bdlJersey !== 'null' && bdlJersey !== '0') 
        ? Number(bdlJersey) 
        : 0;
      let jerseyNumber = bdlJerseyNum > 0 ? bdlJerseyNum : 0;
      let heightFeetData: number | undefined = heightData.feet;
      let heightInchesData: number | undefined = heightData.inches;
      
      console.log(`🔍 BDL data for ${r.full}:`, {
        jersey_number: bdlJersey,
        height: bdlPlayerData?.height,
        parsedHeight: heightData
      });
      
      // Fallback to sample players data if BDL doesn't have jersey or height
      // Try exact match first, then try partial match for name variations (e.g., "Alex" vs "Alexandre")
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
        if (!jerseyNumber && samplePlayer.jersey) {
          jerseyNumber = samplePlayer.jersey;
          console.log(`✅ Found jersey #${jerseyNumber} from sample data for ${r.full}`);
        }
        if (!heightFeetData && samplePlayer.heightFeet) {
          heightFeetData = samplePlayer.heightFeet;
          console.log(`✅ Found height feet ${heightFeetData} from sample data for ${r.full}`);
        }
        if (!heightInchesData && samplePlayer.heightInches) {
          heightInchesData = samplePlayer.heightInches;
          console.log(`✅ Found height inches ${heightInchesData} from sample data for ${r.full}`);
        }
      }
      
      // Fallback to depth chart roster for jersey if still missing
      if (!jerseyNumber && playerTeamRoster) {
        // Search all positions in roster for this player
        const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
        for (const pos of positions) {
          const posPlayers = playerTeamRoster[pos];
          if (Array.isArray(posPlayers)) {
            const found = posPlayers.find(p => 
              p.name && r.full && 
              (p.name.toLowerCase().includes(r.full.toLowerCase()) || 
               r.full.toLowerCase().includes(p.name.toLowerCase()))
            );
            if (found && found.jersey && found.jersey !== 'N/A') {
              jerseyNumber = Number(found.jersey);
              console.log(`✅ Found jersey #${jerseyNumber} from depth chart for ${r.full}`);
              break;
            }
          }
        }
      }
      
      // Final fallback to ESPN if BDL and other sources don't have data
      if (espnData) {
        if (!jerseyNumber && espnData.jersey) {
          jerseyNumber = Number(espnData.jersey);
          console.log(`✅ Found jersey #${jerseyNumber} from ESPN for ${r.full}`);
        }
        if (!heightFeetData && espnData.height) {
          const espnHeightData = parseEspnHeight(espnData.height);
          if (espnHeightData.feet) {
            heightFeetData = espnHeightData.feet;
            heightInchesData = espnHeightData.inches;
            console.log(`✅ Found height ${heightFeetData}'${heightInchesData}" from ESPN for ${r.full}`);
          }
        }
      }
      
      // Update player object with search API team + BDL data
      setSelectedPlayer({
        ...tempPlayer,
        teamAbbr: currentTeam,
        jersey: jerseyNumber,
        heightFeet: heightFeetData,
        heightInches: heightInchesData,
        // Add raw height as fallback for debugging
        rawHeight: bdlPlayerData?.height || undefined,
      });
      
      // Reset betting lines to default for new player
      setBettingLines({});
      
      // Set opponent team based on games schedule
      const opponent = getOpponentTeam(currentTeam, todaysGames);
      const normalizedOpponent = normalizeAbbr(opponent);
      console.log(`[Player Select] Setting opponent for ${currentTeam}: ${normalizedOpponent} (raw: ${opponent})`);
      setOpponentTeam(normalizedOpponent);
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
      console.log('✅ handlePlayerSelectFromSearch completed successfully');
    } catch (e: any) {
      console.error('❌ handlePlayerSelectFromSearch error:', e);
      setApiError(e?.message || "Failed to load stats."); 
      setPlayerStats([]);
      setOpponentTeam('N/A');
    } finally {
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
  /* -------- Base game data (structure only, no stat values) ----------
     This should only recalculate when player/timeframe changes, NOT when stat changes */
  const baseGameData = useMemo(() => {
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
    // IMPORTANT: If playerStats is empty but we have a selectedPlayer, this might be a race condition
    // Don't return empty array immediately - check if we're in the middle of a fetch
    if (!playerStats.length) {
      // If we have a selectedPlayer but no stats, we might be loading
      // Return empty array to prevent showing wrong data, but don't break the memoization
      if (selectedPlayer && isLoading) {
        // Still loading - return empty to show loading state
        return [];
      }
      // No player selected or stats truly empty - return empty
      return [];
    }
    
    // Filter out games where player played 0 minutes FIRST
    const gamesPlayed = playerStats.filter(stats => {
      const minutes = parseMinutes(stats.min);
      return minutes > 0;
    });
    
    // THEN apply timeframe to get exact number of played games
    let filteredGames = gamesPlayed;
    
    // First, apply opponent filtering if a specific opponent is selected (not ALL)
    if (manualOpponent && manualOpponent !== 'ALL' && manualOpponent !== '') {
      const normalizedOpponent = normalizeAbbr(manualOpponent);
      filteredGames = gamesPlayed.filter(stats => {
        const playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
        const playerTeamNorm = normalizeAbbr(playerTeam);
        
        // Get opponent from game data
        const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
        const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
        const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
        const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
        
        // Determine opponent using team IDs/abbrs
        const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
        let gameOpponent = "";
        
        if (playerTeamId && homeTeamId && visitorTeamId) {
          if (playerTeamId === homeTeamId && visitorTeamAbbr) {
            gameOpponent = normalizeAbbr(visitorTeamAbbr);
          } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
            gameOpponent = normalizeAbbr(homeTeamAbbr);
          }
        }
        
        // Fallback: compare abbreviations directly if IDs missing
        if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
          const homeNorm = normalizeAbbr(homeTeamAbbr);
          const awayNorm = normalizeAbbr(visitorTeamAbbr);
          if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
          else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
        }
        
        return gameOpponent === normalizedOpponent;
      });
      console.log(`🎯 Manual Opponent Player: Filtered to ${filteredGames.length} games vs ${manualOpponent}`);
    }
    
    // Special case filters
    if (selectedTimeframe === 'h2h' && (!manualOpponent || manualOpponent === 'ALL')) {
      // Filter games to only show those against the current opponent team
      if (opponentTeam && opponentTeam !== '') {
        const normalizedOpponent = normalizeAbbr(opponentTeam);
        filteredGames = gamesPlayed.filter(stats => {
          const playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
          const playerTeamNorm = normalizeAbbr(playerTeam);
          
          // Get opponent from game data
          const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
          const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
          const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          
          // Determine opponent using team IDs/abbrs
          const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
          let gameOpponent = "";
          
          if (playerTeamId && homeTeamId && visitorTeamId) {
            if (playerTeamId === homeTeamId && visitorTeamAbbr) {
              gameOpponent = normalizeAbbr(visitorTeamAbbr);
            } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
              gameOpponent = normalizeAbbr(homeTeamAbbr);
            }
          }
          
          // Fallback: compare abbreviations directly if IDs missing
          if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
            const homeNorm = normalizeAbbr(homeTeamAbbr);
            const awayNorm = normalizeAbbr(visitorTeamAbbr);
            if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
            else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
          }
          
          return gameOpponent === normalizedOpponent;
        }).slice(0, 6); // Limit to last 6 H2H games
        console.log(`🔥 H2H: Filtered to ${filteredGames.length} games vs ${opponentTeam} (max 6)`);
      } else {
        // No opponent team available, show empty
        filteredGames = [];
        console.log(`⚠️ H2H: No opponent team available for filtering`);
      }
    } else if (selectedTimeframe === 'lastseason') {
      // Filter to last season games only
      const lastSeason = currentNbaSeason() - 1;
      filteredGames = gamesPlayed.filter(stats => {
        if (!stats.game?.date) return false;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        
        // NBA season spans two calendar years (e.g., 2023-24 season)
        // Games from Oct-Dec are from the season year, games from Jan-Apr are from season year + 1
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        return gameSeasonYear === lastSeason;
      });
      console.log(`📅 Last Season: Filtered to ${filteredGames.length} games from ${lastSeason}-${(lastSeason + 1) % 100}`);
    } else if (selectedTimeframe === 'thisseason') {
      // Filter to current season games only
      const currentSeason = currentNbaSeason();
      filteredGames = gamesPlayed.filter(stats => {
        if (!stats.game?.date) return false;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        
        // NBA season spans two calendar years (e.g., 2024-25 season)
        // Games from Oct-Dec are from the season year, games from Jan-Apr are from season year + 1
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        return gameSeasonYear === currentSeason;
      });
      console.log(`📅 This Season: Filtered to ${filteredGames.length} games from ${currentSeason}-${(currentSeason + 1) % 100}`);
      
      // If thisseason filter returns empty but we have playerStats, log a warning
      // This might indicate a data issue or race condition
      if (filteredGames.length === 0 && gamesPlayed.length > 0) {
        console.warn(`⚠️ This Season filter returned 0 games but player has ${gamesPlayed.length} total games. This might be a data issue.`);
        // Show sample game dates for debugging
        const sampleDates = gamesPlayed.slice(0, 5).map(s => s.game?.date).filter(Boolean);
        console.warn(`   Sample game dates:`, sampleDates);
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
    
    const n = parseInt(selectedTimeframe.replace('last', ''));
    const newestFirst = ['h2h', 'lastseason', 'thisseason'].includes(selectedTimeframe) 
      ? filteredGames 
      : (!Number.isNaN(n) ? filteredGames.slice(0, n) : filteredGames);
    
    // Deduplicate by gameId to fix API duplicate data issue
    const uniqueGames = [];
    const seenGameIds = new Set();
    
    for (const game of newestFirst) {
      const gameId = game?.game?.id;
      if (gameId && !seenGameIds.has(gameId)) {
        seenGameIds.add(gameId);
        uniqueGames.push(game);
      } else if (!gameId) {
        // Keep games without gameId (shouldn't happen but just in case)
        uniqueGames.push(game);
      }
    }
    
    console.log(`📈 Deduplicated: ${newestFirst.length} → ${uniqueGames.length} unique games`);
    
    // Apply timeframe to unique games and reverse for chronological order
    const timeframeGames = !Number.isNaN(n) ? uniqueGames.slice(0, n) : uniqueGames;
    const ordered = timeframeGames.slice().reverse(); // left→right oldest→newest
    return ordered.map((stats, index) => {
      const playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
      const playerTeamNorm = normalizeAbbr(playerTeam);
      
      // Get team info from stats.game - support both nested objects and *_id fields
      const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
      const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
      const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
      const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
      
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
  }, [playerStats, selectedTimeframe, selectedPlayer, propsMode, gameStats, selectedTeam, opponentTeam, manualOpponent, homeAway, isLoading]); // Added isLoading to prevent race conditions when stats are being fetched
  
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
    return baseGameData.filter((g: any) => {
      const stats = g?.stats;
      const game = stats?.game;

      // minutes
      const minutes = parseMinutesPlayed(stats?.min);
      if (minutes === 0) return false; // always exclude zero-minute games
      if (minutes < minMinutesFilter || minutes > maxMinutesFilter) return false;

      // blowout
      if (excludeBlowouts && game && typeof game.home_team_score === 'number' && typeof game.visitor_team_score === 'number') {
        const diff = Math.abs((game.home_team_score || 0) - (game.visitor_team_score || 0));
        if (diff >= 21) return false;
      }

      // back-to-back (when enabled, only include second game of B2B)
      if (excludeBackToBack) {
        if (!game || !backToBackGameIds.has(game.id)) return false;
      }
      
      // with/without teammate filter
      if (teammateFilterId) {
        const gid = game?.id;
        if (!gid) return false;
        const didPlay = teammatePlayedGameIds.has(gid);
        if (withWithoutMode === 'with' && !didPlay) return false;
        if (withWithoutMode === 'without' && didPlay) return false;
      }

      return true;
    });
  }, [propsMode, baseGameData, minMinutesFilter, maxMinutesFilter, excludeBlowouts, excludeBackToBack, backToBackGameIds, withWithoutMode, teammateFilterId, teammatePlayedGameIds]);

  /* -------- Chart data with current stat values ----------
     Only recalculate values when selectedStat changes */
  const chartData = useMemo(() => {
    const source = propsMode === 'player' ? filteredGameData : baseGameData;
    const mapped = source.map(game => ({
      ...game,
      value: propsMode === 'team' 
        ? getGameStatValue((game as any).gameData, selectedStat, gamePropsTeam) 
        : getStatValue((game as any).stats, selectedStat) ?? 0,
    }));
    
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
    
    return mapped;
  }, [baseGameData, filteredGameData, selectedStat, propsMode, propsMode === 'team' ? gamePropsTeam : selectedTeam, todaysGames]);

  // Load teammate participation for current base games when filter is active
  useEffect(() => {
    const run = async () => {
      if (!teammateFilterId) {
        setTeammatePlayedGameIds(new Set());
        return;
      }
      try {
        const games = (baseGameData || []).map((g: any) => g?.stats?.game?.id || g?.game?.id).filter(Boolean);
        if (!games.length) {
          setTeammatePlayedGameIds(new Set());
          return;
        }
        setLoadingTeammateGames(true);
        const chunks: number[][] = [];
        const size = 25;
        for (let i = 0; i < games.length; i += size) chunks.push(games.slice(i, i + size));
        const played = new Set<number>();
        for (const chunk of chunks) {
          const params = new URLSearchParams();
          params.set('endpoint', '/stats');
          params.set('per_page', '100');
          params.set('player_ids[]', String(teammateFilterId));
          for (const gid of chunk) params.append('game_ids[]', String(gid));
          const url = `/api/balldontlie?${params.toString()}`;
          const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
          const json = await res?.json().catch(() => ({})) as any;
          const data = Array.isArray(json?.data) ? json.data : [];
          data.forEach((s: any) => {
            const minStr = s?.min || '0:00';
            const [m, sec] = String(minStr).split(':').map((x: any) => parseInt(x || '0', 10));
            const minutes = (Number.isFinite(m) ? m : 0) + ((Number.isFinite(sec) ? sec : 0) > 0 ? 1 : 0);
            const gid = typeof s?.game?.id === 'number' ? s.game.id : (typeof s?.game_id === 'number' ? s.game_id : null);
            if (minutes > 0 && gid != null) played.add(gid);
          });
        }
        setTeammatePlayedGameIds(played);
      } finally {
        setLoadingTeammateGames(false);
      }
    };
    run();
  }, [withWithoutMode, teammateFilterId, baseGameData]);

  const currentStatOptions = propsMode === 'player' ? PLAYER_STAT_OPTIONS : TEAM_STAT_OPTIONS;

  // Hit rate calculations - using statistical distribution instead of simple counting
  const hitRateStats = useMemo<HitRateStats>(() => {
    const validValues = chartData
      .map(d => (Number.isFinite(d.value) ? d.value : Number(d.value)))
      .filter((v): v is number => Number.isFinite(v));
    
    if (validValues.length === 0) {
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
    
    // Calculate probability-based hit rates using normal distribution
    let overProb = 50; // Default to 50% if we can't calculate
    let underProb = 50;
    
    if (Number.isFinite(bettingLine) && adjustedStdDev > 0) {
      // Use the same normalCDF function we use for predictions
      const normalCDF = (z: number): number => {
        const t = 1 / (1 + 0.2316419 * Math.abs(z));
        const d = 0.3989423 * Math.exp(-z * z / 2);
        const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        return z > 0 ? 1 - p : p;
      };
      
      const zScore = (bettingLine - mean) / adjustedStdDev;
      underProb = normalCDF(zScore) * 100;
      overProb = (1 - normalCDF(zScore)) * 100;
    }
    
    // Convert probabilities to counts for display (maintains compatibility with existing UI)
    const total = chartData.length;
    const overCount = Math.round((overProb / 100) * total);
    const underCount = total - overCount;
    
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
  }, [chartData, bettingLine, selectedStat, currentStatOptions, propsMode, baseGameData.length]);

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
      let gameDetails = null;
      
      if (propsMode === 'team' && data.gameData) {
        // Team mode: use game data
        const gameData = data.gameData;
        const gameISO = gameData.date;
        if (gameISO) {
          correctDate = new Date(gameISO).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
          });
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
        if ((gameStats as any)?.game) {
          const gameISO = (gameStats as any)?.game?.date;
          if (gameISO) {
            correctDate = new Date(gameISO).toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'short', 
              day: 'numeric' 
            });
          }
        }
      }
      
      // Use inline styles to avoid theme dependency
      const tooltipStyle = getUnifiedTooltipStyle(isDark);
      
      return (
        <div style={tooltipStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>{statLabel}: {formattedValue}</div>
            
            {/* Team mode: show game score details with proper home/away display */}
            {propsMode === 'team' && gameDetails && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div>
                  {gameDetails.isQuarterStat && `Q${gameDetails.quarter}: `}
                  {gameDetails.homeTeam} {gameDetails.homeScore} - {gameDetails.visitorScore} {gameDetails.visitorTeam}
                </div>
              </div>
            )}
            
            {/* Player mode: show composite stat breakdowns */}
            {propsMode === 'player' && (selectedStat === 'pra' || selectedStat === 'pr' || selectedStat === 'ra') && data.stats && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {selectedStat !== 'ra' && <div>PTS: {Number(data.stats.pts || 0)}</div>}
                <div>REB: {Number(data.stats.reb || 0)}</div>
                {selectedStat !== 'pr' && <div>AST: {Number(data.stats.ast || 0)}</div>}
              </div>
            )}
            
            {/* Player mode: show minutes */}
            {propsMode === 'player' && data.stats && (
              <div>MINS: {data.stats.min || "0:00"}</div>
            )}
            
            {/* Show team vs opponent for both modes */}
            {propsMode === 'team' && gameDetails ? (
              <div>vs {gameDetails.homeTeam === (gamePropsTeam || selectedTeam) ? gameDetails.visitorTeam : gameDetails.homeTeam}</div>
            ) : (
              <div>{data.game}</div>
            )}
            <div>{correctDate}</div>
          </div>
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
        maxYAxis = Math.ceil(maxValue) + 1; // Round up to next 1-increment
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
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);

  // Adjust spread signs based on favorite/underdog status (after realOddsData is available)
  const adjustedChartData = useMemo(() => {
    if (propsMode !== 'team' || selectedStat !== 'spread' || chartData.length === 0 || realOddsData.length === 0) {
      return chartData;
    }

    // Check the current spread line to determine if selected team is favorite or underdog
    const firstBook = realOddsData[0] as any;
    const spreadLine = firstBook?.Spread?.line;
    
    if (!spreadLine || spreadLine === 'N/A') {
      return chartData;
    }

    const lineVal = parseFloat(String(spreadLine).replace(/[^0-9.+-]/g, ''));
    const isFavorite = !Number.isNaN(lineVal) && lineVal < 0;
    
    // Favorite: always show negative (absolute value with negative sign)
    // Underdog: always show positive (absolute value, no negative sign)
    return chartData.map(game => {
      if (typeof game.value === 'number') {
        return { ...game, value: isFavorite ? -Math.abs(game.value) : Math.abs(game.value) };
      }
      return game;
    });
  }, [chartData, propsMode, selectedStat, realOddsData]);
  
  // Helper function to map selected stat to bookmaker row key (defined early for use in bestLineForStat)
  const getBookRowKey = useCallback((stat: string): string | null => {
    const statToBookKey: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'fg3m': 'THREES',
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
  const [predictedOutcome, setPredictedOutcome] = useState<PredictedOutcomeResult | null>(null);
  
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
        const alternateLines = partitioned.alternate;
        
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
          setRealOddsData([]);
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
      
      // If team mode and metadata is missing, trigger a refresh
      if (propsMode === 'team' && (!data.homeTeam || !data.awayTeam) && data.data && data.data.length > 0) {
        console.log('[fetchOddsData] Missing team metadata - triggering cache refresh...');
        // Trigger a refresh with the refresh parameter
        const refreshParams = new URLSearchParams();
        if (gamePropsTeam) refreshParams.set('team', gamePropsTeam);
        refreshParams.set('refresh', '1');
        
        // Retry after a short delay to allow cache to refresh
        setTimeout(() => {
          fetchOddsData(retryCount + 1);
        }, 2000);
        return;
      }
      
      setRealOddsData(data.data || []);
      
      // Store home/away teams for team mode
      if (propsMode === 'team' && data.homeTeam && data.awayTeam) {
        // Store these in a way we can access in BestOddsTable
        // We'll add them to each bookmaker as metadata
        if (data.data && data.data.length > 0) {
          console.log('[fetchOddsData] Setting game teams:', {
            homeTeam: data.homeTeam,
            awayTeam: data.awayTeam,
            gamePropsTeam,
            bookCount: data.data.length
          });
          data.data.forEach((book: any) => {
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
  
  // Fetch odds when player/team or mode changes - with debouncing to prevent rate limits
  useEffect(() => {
    // For team mode, add a small delay to ensure gamePropsTeam is set
    if (propsMode === 'team' && !gamePropsTeam) {
      return;
    }
    
    // Debounce: wait 300ms before fetching to avoid rapid successive calls
    const timeoutId = setTimeout(() => {
      fetchOddsData();
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [selectedPlayer, selectedTeam, gamePropsTeam, propsMode]);

  const americanToDecimal = (odds: string): string => {
    if (odds === 'N/A') return 'N/A';
    const n = parseInt(odds.replace(/[^+\-\d]/g, ''), 10);
    if (isNaN(n)) return odds;
    const dec = n > 0 ? (1 + n / 100) : (1 + 100 / Math.abs(n));
    return dec.toFixed(2);
  };

  // Ensure positive American odds show a leading '+' and strip any surrounding noise
  const normalizeAmerican = (odds: string): string => {
    if (odds === 'N/A') return 'N/A';
    const n = parseInt(odds.replace(/[^+\-\d]/g, ''), 10);
    if (isNaN(n)) return odds;
    return n > 0 ? `+${n}` : `${n}`;
  };

  const fmtOdds = (odds: string): string => {
    if (odds === 'N/A') return 'N/A';
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
    if (!realOddsData || realOddsData.length === 0 || !selectedStat) return null;
    
    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return null;
    
    // Collect all real lines (not alt lines) and find the most common one
    const lineCounts = new Map<number, number>();
    
    for (const book of realOddsData) {
      const meta = (book as any)?.meta;
      // Skip alt lines - only use primary over/under lines
      if (meta?.variantLabel) continue;
      
      const statData = (book as any)[bookRowKey];
      if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
        const lineStr = statData.line;
        const line = (lineStr && lineStr !== 'N/A') 
          ? (typeof lineStr === 'string' ? parseFloat(lineStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(lineStr)))
          : null;
        
        if (line !== null && Number.isFinite(line)) {
          // Round to nearest 0.5 to group similar lines together
          const roundedLine = Math.round(line * 2) / 2;
          lineCounts.set(roundedLine, (lineCounts.get(roundedLine) || 0) + 1);
        }
      }
    }
    
    if (lineCounts.size === 0) return null;
    
    // Find the most common line (consensus)
    let consensusLine: number | null = null;
    let maxCount = 0;
    for (const [line, count] of lineCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        consensusLine = line;
      }
    }
    
    return consensusLine;
  }, [realOddsData, selectedStat, getBookRowKey]);

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
          const overOddsStr = statData.over;
          const underOddsStr = statData.under;
          
          const overOdds = (overOddsStr && overOddsStr !== 'N/A') 
            ? (typeof overOddsStr === 'string' ? parseFloat(overOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(overOddsStr)))
            : null;
          const underOdds = (underOddsStr && underOddsStr !== 'N/A')
            ? (typeof underOddsStr === 'string' ? parseFloat(underOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(underOddsStr)))
            : null;
          
          if (overOdds !== null && underOdds !== null && Number.isFinite(overOdds) && Number.isFinite(underOdds)) {
            const impliedProbabilityFromAmerican = (american: number): number => {
              if (american > 0) {
                return (100 / (american + 100)) * 100;
              } else {
                return (Math.abs(american) / (Math.abs(american) + 100)) * 100;
              }
            };
            
            const overProb = impliedProbabilityFromAmerican(overOdds);
            const underProb = impliedProbabilityFromAmerican(underOdds);
            const totalProb = overProb + underProb;
            
            if (totalProb > 0) {
              return {
                overImpliedProb: (overProb / totalProb) * 100,
                underImpliedProb: (underProb / totalProb) * 100,
              };
            }
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
        const overOddsStr = statData.over;
        const underOddsStr = statData.under;
        
        const overOdds = (overOddsStr && overOddsStr !== 'N/A') 
          ? (typeof overOddsStr === 'string' ? parseFloat(overOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(overOddsStr)))
          : null;
        const underOdds = (underOddsStr && underOddsStr !== 'N/A')
          ? (typeof underOddsStr === 'string' ? parseFloat(underOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(underOddsStr)))
          : null;
        
        if (overOdds !== null && underOdds !== null && Number.isFinite(overOdds) && Number.isFinite(underOdds)) {
          const impliedProbabilityFromAmerican = (american: number): number => {
            if (american > 0) {
              return (100 / (american + 100)) * 100;
            } else {
              return (Math.abs(american) / (Math.abs(american) + 100)) * 100;
            }
          };
          
          const overProb = impliedProbabilityFromAmerican(overOdds);
          const underProb = impliedProbabilityFromAmerican(underOdds);
          const totalProb = overProb + underProb;
          
          if (totalProb > 0) {
            validBooks.push({
              over: (overProb / totalProb) * 100,
              under: (underProb / totalProb) * 100,
            });
          }
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

  // Prediction calculation useEffect - only recalculates when player or stat changes, NOT when line changes
  useEffect(() => {
    if (propsMode !== 'player' || !selectedPlayer || !selectedStat) {
      setPredictedOutcome(null);
      return;
    }
    
    // Use primary market line (consensus from real bookmakers) - this is fixed and doesn't change when user adjusts betting line
    const predictionLine = primaryMarketLine;
    
    // Comprehensive prediction model combining multiple factors
    const calculatePrediction = async () => {
      try {
        const validValues = chartData.filter((d: any) => Number.isFinite(d.value)).map((d: any) => d.value);
        if (validValues.length === 0) {
          setPredictedOutcome(null);
          return;
        }
        
        // 1. Last 5 games average (most recent form)
        const last5Games = chartData.slice(-5).filter((d: any) => Number.isFinite(d.value));
        const last5Avg = last5Games.length > 0
          ? last5Games.reduce((sum: number, d: any) => sum + d.value, 0) / last5Games.length
          : null;
        
        // 2. H2H average vs current opponent
        const normalizedOpponent = opponentTeam && opponentTeam !== 'N/A' && opponentTeam !== 'ALL' && opponentTeam !== ''
          ? normalizeAbbr(opponentTeam)
          : null;
        const h2hGames = normalizedOpponent
          ? chartData.filter((d: any) => {
              const gameOpponent = normalizeAbbr(d.opponent || '');
              return gameOpponent === normalizedOpponent && Number.isFinite(d.value);
            })
          : [];
        const h2hAvg = h2hGames.length > 0
          ? h2hGames.reduce((sum: number, d: any) => sum + d.value, 0) / h2hGames.length
          : null;
        
        // 3. Season average (baseline)
        const seasonAvg = validValues.reduce((sum: number, val: number) => sum + val, 0) / validValues.length;
        
        // 4. DvP adjustment - use rankings for more impactful adjustments
        let dvpAdjustment = 0;
        if (normalizedOpponent && selectedPosition) {
          try {
            // Map selectedStat to DvP metric name
            const statToMetric: Record<string, string> = {
              'pts': 'pts',
              'reb': 'reb',
              'ast': 'ast',
              'fg3m': 'fg3m',
              'stl': 'stl',
              'blk': 'blk',
              'to': 'to',
              'fg_pct': 'fg_pct',
              'ft_pct': 'ft_pct',
            };
            const metric = statToMetric[selectedStat] || selectedStat;
            
            // Fetch DvP rank (1-30, where 1 is best defense, 30 is worst)
            const dvpRankResponse = await cachedFetch(
              `/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${metric}&games=82`,
              undefined,
              120000 // 2 minute cache
            );
            
            if (dvpRankResponse?.metrics?.[metric]) {
              // Get the rank for this specific team
              const ranks = dvpRankResponse.metrics[metric];
              const teamRank = ranks[normalizedOpponent] || ranks[normalizedOpponent.toUpperCase()] || null;
              
              // If we have a rank, apply tiered adjustments
              if (teamRank !== null && teamRank >= 1 && teamRank <= 30) {
                // Rank 1-10: Very good defense (lower prediction)
                if (teamRank <= 10) {
                  // Negative adjustment: -1.5 to -2.5 points based on rank (1 = -2.5, 10 = -1.5)
                  dvpAdjustment = -1.5 - ((10 - teamRank) / 10) * 1;
                }
                // Rank 11-20: Medium defense (small adjustment)
                else if (teamRank <= 20) {
                  // Small adjustment: -1 to +1 points based on rank (11 = -1, 20 = +1)
                  dvpAdjustment = -1 + ((teamRank - 11) / 9) * 2;
                }
                // Rank 21-30: Bad defense (raise prediction)
                else {
                  // Positive adjustment: +1.5 to +2.5 points based on rank (21 = +1.5, 30 = +2.5)
                  dvpAdjustment = 1.5 + ((teamRank - 21) / 9) * 1;
                }
              }
            }
          } catch (dvpError) {
            console.warn('Failed to fetch DvP rank data for prediction:', dvpError);
          }
        }
        
        // 5. Advanced stats/potentials (if available)
        let advancedStatsAdjustment = 0;
        if (advancedStats) {
          // Use usage percentage to adjust
          // Higher usage = more opportunities = higher expected output
          if (advancedStats.usage_percentage && Number.isFinite(advancedStats.usage_percentage)) {
            const usagePct = advancedStats.usage_percentage * 100;
            // Normalize usage (typical range 15-35%) to adjustment (further reduced)
            advancedStatsAdjustment += ((usagePct - 25) / 10) * 0.15; // Further reduced from 0.25
          }
        }
        
        // 6. Team pace adjustment (team-level stat, not player-level)
        // Higher pace = more possessions = more opportunities for stats
        const playerTeamAbbr = normalizeAbbr(selectedPlayer?.teamAbbr || '');
        const teamPaceValue = getTeamPace(playerTeamAbbr);
        if (teamPaceValue > 0) {
          const paceAdjustment = ((teamPaceValue - 100) / 10) * 0.1; // Further reduced from 0.15
          advancedStatsAdjustment += paceAdjustment;
        }
        
        // Combine all factors with weights
        // Weights: H2H (35%), Last 5 games (35%), Season avg (30%), then apply DvP and Advanced stats adjustments
        let predictedValue = seasonAvg; // Default to season average
        
        // Calculate weighted average of the three main factors
        let totalWeight = 0.3; // Season avg weight (30%)
        let weightedSum = seasonAvg * 0.3;
        
        if (last5Avg !== null && last5Games.length >= 3) {
          // Only use last 5 if we have at least 3 games (35% weight)
          weightedSum += last5Avg * 0.35;
          totalWeight += 0.35;
        }
        
        if (h2hAvg !== null && h2hGames.length >= 2) {
          // Only use H2H if we have at least 2 games (35% weight)
          weightedSum += h2hAvg * 0.35;
          totalWeight += 0.35;
        }
        
        // Normalize by total weight to get weighted average
        predictedValue = totalWeight > 0 ? weightedSum / totalWeight : seasonAvg;
        
        // Apply adjustments (these are additive, not weighted)
        predictedValue += dvpAdjustment;
        predictedValue += advancedStatsAdjustment;
        
        // Get market probabilities from calculatedImpliedOdds (which only uses real lines)
        const marketOverProb = calculatedImpliedOdds?.overImpliedProb ?? null;
        const marketUnderProb = calculatedImpliedOdds?.underImpliedProb ?? null;
        
        // Blend with bookmaker implied odds to "level it out" (30% market influence)
        // This helps align our predictions with market consensus
        let finalPredictedValue = predictedValue;
        if (marketOverProb !== null && marketUnderProb !== null && predictionLine !== null && predictionLine !== undefined && Number.isFinite(predictionLine)) {
          // The market line already reflects market consensus, so we blend our prediction 70% with market line 30%
          // This pulls our prediction closer to market when there's a big discrepancy
          finalPredictedValue = predictedValue * 0.7 + predictionLine * 0.3;
        }
        
        // Calculate standard deviation from all historical data
        const variance = validValues.reduce((sum: number, val: number) => {
          const diff = val - seasonAvg;
          return sum + (diff * diff);
        }, 0) / validValues.length;
        const stdDev = Math.sqrt(variance);
        const adjustedStdDev = Math.max(stdDev, 2);
        
        if (Number.isFinite(finalPredictedValue) && predictionLine !== null && predictionLine !== undefined && Number.isFinite(predictionLine) && adjustedStdDev > 0) {
          // Calculate z-score using the final predicted value (blended with market)
          const zScore = (predictionLine - finalPredictedValue) / adjustedStdDev;
          
          // Use normal distribution CDF to calculate probability
          const underProb = normalCDF(zScore) * 100;
          const overProb = (1 - normalCDF(zScore)) * 100;
          
          // Clamp probabilities between 0-100
          const clampedOverProb = Math.max(0, Math.min(100, overProb));
          const clampedUnderProb = Math.max(0, Math.min(100, underProb));
          
          const isOver = clampedOverProb >= 50;
          const statProb = isOver ? clampedOverProb : clampedUnderProb;
          const marketProb = isOver ? marketOverProb : marketUnderProb;
          
          // Calculate edge and confidence
          const edge = marketProb != null ? statProb - marketProb : null;
          let confidence: 'High' | 'Medium' | 'Low' = 'Low';
          if (edge != null) {
            const absEdge = Math.abs(edge);
            confidence = absEdge >= 12 ? 'High' : absEdge >= 6 ? 'Medium' : 'Low';
          }
          
          // Calculate Expected Value (EV) using actual betting odds
          // EV = (Probability × Decimal Odds - 1) × 100
          let expectedValue: number | null = null;
          
          // Get the actual odds for the bet (over or under)
          const bookRowKey = getBookRowKey(selectedStat);
          if (bookRowKey && realOddsData && realOddsData.length > 0 && predictionLine !== null && predictionLine !== undefined) {
            // Find the best odds for the primary market line (consensus line)
            let bestOverOdds: number | null = null;
            let bestUnderOdds: number | null = null;
            
            for (const book of realOddsData) {
              const statData = (book as any)[bookRowKey];
              if (!statData || statData.line === 'N/A') continue;
              
              const lineValue = parseFloat(statData.line);
              if (isNaN(lineValue)) continue;
              
              // Only use real lines (not alt lines) - check if it matches primary market line
              const meta = (book as any)?.meta;
              if (meta?.variantLabel) continue; // Skip alt lines
              
              // Check if this line matches the primary market line (within 0.1)
              if (Math.abs(lineValue - predictionLine) < 0.1) {
                // Parse over odds
                if (statData.over && statData.over !== 'N/A') {
                  const overOddsStr = statData.over;
                  const overOdds = typeof overOddsStr === 'string' 
                    ? parseFloat(overOddsStr.replace(/[^0-9.+-]/g, ''))
                    : parseFloat(String(overOddsStr));
                  if (Number.isFinite(overOdds) && (bestOverOdds === null || overOdds > bestOverOdds)) {
                    bestOverOdds = overOdds;
                  }
                }
                
                // Parse under odds
                if (statData.under && statData.under !== 'N/A') {
                  const underOddsStr = statData.under;
                  const underOdds = typeof underOddsStr === 'string'
                    ? parseFloat(underOddsStr.replace(/[^0-9.+-]/g, ''))
                    : parseFloat(String(underOddsStr));
                  if (Number.isFinite(underOdds) && (bestUnderOdds === null || underOdds > bestUnderOdds)) {
                    bestUnderOdds = underOdds;
                  }
                }
              }
            }
            
            // Calculate EV using the best odds
            if (isOver && bestOverOdds !== null) {
              // Convert American odds to decimal odds
              const decimalOdds = bestOverOdds > 0 
                ? (bestOverOdds / 100) + 1 
                : (100 / Math.abs(bestOverOdds)) + 1;
              
              // EV = (Probability × Decimal Odds - 1) × 100
              expectedValue = ((statProb / 100) * decimalOdds - 1) * 100;
            } else if (!isOver && bestUnderOdds !== null) {
              // Convert American odds to decimal odds
              const decimalOdds = bestUnderOdds > 0 
                ? (bestUnderOdds / 100) + 1 
                : (100 / Math.abs(bestUnderOdds)) + 1;
              
              // EV = (Probability × Decimal Odds - 1) × 100
              expectedValue = ((statProb / 100) * decimalOdds - 1) * 100;
            }
          }
          
          // Fallback: if we can't get actual odds, use implied probability method
          if (expectedValue === null && marketProb !== null && marketProb > 0 && marketProb <= 100) {
            // This is a rough approximation using implied probability
            // EV ≈ (StatTrackr Probability / Market Implied Probability - 1) × 100
            expectedValue = (statProb / marketProb - 1) * 100;
          }
          
          setPredictedOutcome({
            overProb: clampedOverProb,
            underProb: clampedUnderProb,
            confidence,
            expectedValue,
          });
        } else {
          setPredictedOutcome(null);
        }
      } catch (error) {
        console.error('Error calculating prediction:', error);
        setPredictedOutcome(null);
      }
    };
    
    calculatePrediction();
  }, [
    propsMode,
    selectedPlayer,
    selectedStat,
    primaryMarketLine, // Only changes when player/stat changes, not when user adjusts betting line
    calculatedImpliedOdds, // Only uses real lines from bookmakers
    chartData, // Historical data for the player/stat
    opponentTeam, // For H2H calculation
    selectedPosition, // For DvP calculation
    advancedStats, // For advanced stats adjustment
    // Note: realOddsData is accessed from closure, not in deps to avoid array size changes
  ]);

  return (
<div className="min-h-screen lg:h-screen bg-gray-50 dark:bg-gray-900 transition-colors lg:overflow-x-auto lg:overflow-y-hidden">
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
          />
        )}
        
        {/* Sidebar Toggle Button - visible on tablets/Macs */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="hidden lg:flex fixed z-[60] items-center justify-center w-8 h-8 bg-gray-300 dark:bg-slate-900 hover:bg-gray-400 dark:hover:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg transition-all"
          style={{
            top: sidebarOpen ? '1rem' : '1.5rem',
            left: sidebarOpen ? 'calc(clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px) + var(--sidebar-width, 360px) + 8px)' : 'clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px)',
            transition: 'left 0.3s ease, top 0.3s ease'
          }}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg 
            className="w-4 h-4 text-gray-700 dark:text-gray-300 transition-transform"
            style={{ transform: sidebarOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
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
            <div className="lg:hidden bg-white dark:bg-slate-800 rounded-lg shadow-sm px-3 md:px-4 lg:px-6 pt-3 md:pt-4 pb-4 md:pb-5 border border-gray-200 dark:border-gray-700 relative overflow-visible">
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
                      ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-500 cursor-not-allowed opacity-60"
                      : propsMode === 'player'
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
<div className="relative z-[60] bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 h-auto sm:h-36 md:h-40 w-full min-w-0 flex-shrink-0 mr-1 sm:mr-2 md:mr-3 overflow-visible">
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
                        className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
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
                      }} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200">
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
                        <div className="sm:hidden fixed inset-x-0 top-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-b-lg shadow-2xl z-[100] max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center gap-2 p-3 border-b border-gray-300 dark:border-gray-700">
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
                            className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <button onClick={() => setIsMobileSearchOpen(false)} className="p-1.5 rounded bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                          </button>
                        </div>
                        
                        {/* Search results */}
                        <div className="p-2">
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
                      </>
                    )}
                    {/* Player search dropdown - only show in player mode and for Pro users (Desktop only) */}
                    {propsMode === 'player' && isPro && showDropdown && searchQuery && (
                      <div className="hidden sm:block absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[80] max-h-72 overflow-y-auto">
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
                        <div className="hidden sm:block absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[100] max-h-72 overflow-y-auto">
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
                      <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
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
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                      </div>
                    )
                  ) : (
                    // Game Props Mode - Show selected team vs opponent or prompt
                    gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam ? (
                      <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
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
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        <img 
                          src={getEspnLogoUrl(gamePropsTeam)}
                          alt={gamePropsTeam}
                          className="w-8 h-8 object-contain"
                        />
                        <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                        <span className="text-gray-500 dark:text-gray-400 text-xs">No Game Today</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
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
                    <div className="flex items-baseline gap-3">
                      <h1 className="text-lg font-bold text-gray-900 dark:text-white">{playerInfo.name}</h1>
                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{playerInfo.jersey}</span>
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
                      }} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200">
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
                        <div className="fixed inset-x-0 top-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-b-lg shadow-2xl z-[100] max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center gap-2 p-3 border-b border-gray-300 dark:border-gray-700">
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
                            className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                          <button onClick={() => setIsMobileSearchOpen(false)} className="p-1.5 rounded bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                          </button>
                        </div>
                        
                        {/* Search results - same as before */}
                        <div className="p-2">
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
                      <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-2 py-1 sm:px-4 sm:py-2 min-w-0">
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
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                      </div>
                    )
                  ) : (
                    // Game Props Mode - Show selected team vs opponent or prompt
                    gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam ? (
                      <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-2.5 py-1.5 sm:px-4 sm:py-2 min-w-0">
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
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        <img 
                          src={getEspnLogoUrl(gamePropsTeam)}
                          alt={gamePropsTeam}
                          className="w-8 h-8 object-contain"
                        />
                        <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                        <span className="text-gray-500 dark:text-gray-400 text-xs">No Game Today</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Team</span>
                      </div>
                    )
                  )}
                </div>
              </div>
              
              {/* Tracking Buttons - Show for both Player Props and Game Props modes */}
              {((propsMode === 'player' && selectedPlayer && nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== 'N/A') ||
                (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam && opponentTeam !== '')) && (
                <div className="flex gap-2 px-0">
                  <button
                    onClick={() => !isGameInProgress && setShowTrackModal(true)}
                    disabled={isGameInProgress}
                    className={`flex-1 px-2 py-1.5 text-white text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                      isGameInProgress 
                        ? 'bg-gray-400 cursor-not-allowed opacity-50' 
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                    title={isGameInProgress ? 'Game in progress - tracking disabled' : `Track ${propsMode === 'team' ? 'team' : 'player'} prop`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Track
                  </button>
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
              onSelectStat={setSelectedStat}
              bettingLine={bettingLine}
              onChangeBettingLine={setBettingLine}
              selectedTimeframe={selectedTimeframe}
              onSelectTimeframe={setSelectedTimeframe}
              chartData={adjustedChartData}
              yAxisConfig={yAxisConfig}
              isLoading={propsMode === 'team' ? gameStatsLoading : isLoading}
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
              setTeammateFilterId={setTeammateFilterId}
              loadingTeammateGames={loadingTeammateGames}
      clearTeammateFilter={clearTeammateFilter}
      hitRateStats={hitRateStats}
      lineMovementEnabled={LINE_MOVEMENT_ENABLED}
      intradayMovements={intradayMovementsFinal}
            />
{/* 4. Opponent Analysis & Team Matchup Container (Mobile) */}
            <div className="lg:hidden bg-white dark:bg-slate-800 rounded-lg shadow-sm p-2 md:p-3 border border-gray-200 dark:border-gray-700">
              {/* Section 0: Defense vs Position (new) - only show in Player Props mode */}
              {propsMode === 'player' && <PositionDefenseCard isDark={isDark} opponentTeam={opponentTeam} selectedPosition={selectedPosition} currentTeam={selectedTeam} />}

              {/* Section 1: Opponent Analysis */}
              <OpponentAnalysisCard 
                isDark={isDark} 
                opponentTeam={opponentTeam} 
                selectedTimeFilter={selectedTimeFilter}
                propsMode={propsMode}
                playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
                selectedStat={selectedStat}
              />

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
                          : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      POINTS
                    </button>
                    <button
                      onClick={() => setSelectedComparison('rebounds')}
                      className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                        selectedComparison === 'rebounds'
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      REBOUNDS
                    </button>
                    <button
                      onClick={() => setSelectedComparison('assists')}
                      className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                        selectedComparison === 'assists'
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      ASSISTS
                    </button>
                    <button
                      onClick={() => setSelectedComparison('fg_pct')}
                      className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                        selectedComparison === 'fg_pct'
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
                    <div className="bg-gray-100 dark:bg-gray-700 rounded px-2 py-1 mb-2">
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

            {/* 4.5 Shot Chart Container (Mobile) - Player Props mode only */}
            {propsMode === 'player' && (
              <div className="lg:hidden w-full flex flex-col bg-white dark:bg-slate-800 rounded-lg shadow-sm p-0 sm:p-4 gap-4 border border-gray-200 dark:border-gray-700">
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
                  <TeamTrackingStatsTable
                    teamAbbr={selectedTeam}
                    selectedPlayerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
                    selectedPlayerName={playerName || undefined}
                    season={2025}
                    isDark={isDark}
                    opponentTeam={opponentTeam}
                    opponentTeamLogoUrl={opponentTeamLogoUrl || (opponentTeam ? getEspnLogoUrl(opponentTeam) : undefined)}
                  />
                </div>
              );
            }, [propsMode, selectedTeam, selectedPlayer?.id, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, isDark, opponentTeam, opponentTeamLogoUrl])}

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
                  predictedOutcome={predictedOutcome}
                  calculatedImpliedOdds={calculatedImpliedOdds}
                  selectedBookmakerName={selectedBookmakerName}
                  selectedBookmakerLine={selectedBookmakerLine}
                  propsMode={propsMode}
                  selectedPlayer={selectedPlayer}
                  primaryMarketLine={primaryMarketLine}
                />
              </div>
            ), [isDark, derivedOdds, intradayMovementsFinal, selectedTeam, gamePropsTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds, mergedLineMovementData, selectedStat, predictedOutcome, calculatedImpliedOdds, selectedBookmakerName, selectedBookmakerLine, selectedPlayer, primaryMarketLine])}

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

            {/* 8. Depth Chart Container (Mobile) */}
            {useMemo(() => {
              // Determine which team to show based on mode
              const currentTeam = propsMode === 'player' 
                ? depthChartTeam 
                : (depthChartTeam && depthChartTeam !== 'N/A' ? depthChartTeam : gamePropsTeam);
              
              // Don't render if no team selected
              if (!currentTeam || currentTeam === 'N/A') return null;
              
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

            {/* 9. Injury Container (Mobile) */}
<div className="lg:hidden">
              <InjuryContainer
                selectedTeam={propsMode === 'team' ? (gamePropsTeam && gamePropsTeam !== 'N/A' ? gamePropsTeam : '') : selectedTeam}
                opponentTeam={opponentTeam}
                isDark={isDark}
              />
            </div>

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
                  <TeamTrackingStatsTable
                    teamAbbr={selectedTeam}
                    selectedPlayerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
                    selectedPlayerName={playerName || undefined}
                    season={2025}
                    isDark={isDark}
                    opponentTeam={opponentTeam}
                    opponentTeamLogoUrl={opponentTeamLogoUrl || (opponentTeam ? getEspnLogoUrl(opponentTeam) : undefined)}
                  />
                </div>
              );
            }, [propsMode, selectedTeam, selectedPlayer?.id, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, isDark, opponentTeam, opponentTeamLogoUrl])}

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
                    predictedOutcome={predictedOutcome}
                    calculatedImpliedOdds={calculatedImpliedOdds}
                    selectedBookmakerName={selectedBookmakerName}
                    selectedBookmakerLine={selectedBookmakerLine}
                    propsMode={propsMode}
                    selectedPlayer={selectedPlayer}
                    primaryMarketLine={primaryMarketLine}
                  />
                </div>
              ) : null
            ), [isDark, derivedOdds, intradayMovementsFinal, selectedTeam, gamePropsTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds, mergedLineMovementData, selectedStat, predictedOutcome, calculatedImpliedOdds, selectedBookmakerName, selectedBookmakerLine, selectedPlayer, primaryMarketLine])}

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

            {/* Unified Depth Chart (Desktop) - optimized for both modes */}
            {useMemo(() => {
              // Determine which team to show based on mode
              // For Game Props mode, use depthChartTeam for switching, fallback to gamePropsTeam
              const currentTeam = propsMode === 'player' 
                ? depthChartTeam 
                : (depthChartTeam && depthChartTeam !== 'N/A' ? depthChartTeam : gamePropsTeam);
              
              // Don't render if no team selected
              if (!currentTeam || currentTeam === 'N/A') return null;
              
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
            <div className="hidden lg:block bg-white dark:bg-slate-800 rounded-lg shadow-sm px-3 pt-3 pb-4 border border-gray-200 dark:border-gray-700 relative overflow-visible">
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
                      ? "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
            <div className="hidden lg:block bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3 border border-gray-200 dark:border-gray-700">
                {/* Section 0: Defense vs Position (new) - only show in Player Props mode */}
                {propsMode === 'player' && <PositionDefenseCard isDark={isDark} opponentTeam={opponentTeam} selectedPosition={selectedPosition} currentTeam={selectedTeam} />}

                {/* Section 1: Opponent Analysis */}
                <OpponentAnalysisCard 
                  isDark={isDark} 
                  opponentTeam={opponentTeam} 
                  selectedTimeFilter={selectedTimeFilter}
                  propsMode={propsMode}
                  playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
                  selectedStat={selectedStat}
                />

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
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        POINTS
                      </button>
                      <button
                        onClick={() => setSelectedComparison('rebounds')}
                        className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                          selectedComparison === 'rebounds'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        REBOUNDS
                      </button>
                      <button
                        onClick={() => setSelectedComparison('assists')}
                        className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                          selectedComparison === 'assists'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        ASSISTS
                      </button>
                      <button
                        onClick={() => setSelectedComparison('fg_pct')}
                        className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                          selectedComparison === 'fg_pct'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
                              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
                      <div className="bg-gray-100 dark:bg-gray-700 rounded px-2 py-1 mb-2">
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

            {/* Shot Chart (Desktop) - only in Player Props mode */}
            {propsMode === 'player' && (
              <div className="hidden lg:block w-full flex flex-col bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 gap-4 border border-gray-200 dark:border-gray-700">
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

            {/* Advanced Stats Container (Desktop - Right Panel) - only in Player Props mode, below Shot Chart */}
            {propsMode === 'player' && (
              <div className="hidden lg:block bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700" style={{ minHeight: '200px' }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Advanced Stats</h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Current season stats</span>
                </div>
                {advancedStats ? (
                  <div className="grid grid-cols-3 gap-4">
                    {/* Offensive Metrics */}
                    <div>
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Offensive</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span>OFF RTG</span>
                          <span className={`font-semibold ${
                            !advancedStats.offensive_rating ? 'text-gray-400' :
                            advancedStats.offensive_rating >= 115 ? 'text-green-600 dark:text-green-400' :
                            advancedStats.offensive_rating >= 108 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.offensive_rating?.toFixed(1) || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>TS%</span>
                          <span className={`font-semibold ${
                            !advancedStats.true_shooting_percentage ? 'text-gray-400' :
                            (advancedStats.true_shooting_percentage * 100) >= 58 ? 'text-green-600 dark:text-green-400' :
                            (advancedStats.true_shooting_percentage * 100) >= 54 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.true_shooting_percentage ? (advancedStats.true_shooting_percentage * 100).toFixed(1) + '%' : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>eFG%</span>
                          <span className={`font-semibold ${
                            !advancedStats.effective_field_goal_percentage ? 'text-gray-400' :
                            (advancedStats.effective_field_goal_percentage * 100) >= 55 ? 'text-green-600 dark:text-green-400' :
                            (advancedStats.effective_field_goal_percentage * 100) >= 50 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.effective_field_goal_percentage ? (advancedStats.effective_field_goal_percentage * 100).toFixed(1) + '%' : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>USG%</span>
                          <span className={`font-semibold ${
                            !advancedStats.usage_percentage ? 'text-gray-400' :
                            (advancedStats.usage_percentage * 100) >= 28 ? 'text-green-600 dark:text-green-400' :
                            (advancedStats.usage_percentage * 100) >= 22 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.usage_percentage ? (advancedStats.usage_percentage * 100).toFixed(1) + '%' : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Impact & Defensive Metrics */}
                    <div>
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Impact & Defense</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span>NET RTG</span>
                          <span className={`font-semibold ${
                            !advancedStats.net_rating ? 'text-gray-400' :
                            advancedStats.net_rating >= 3 ? 'text-green-600 dark:text-green-400' :
                            advancedStats.net_rating >= -2 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.net_rating?.toFixed(1) || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>DEF RTG</span>
                          <span className={`font-semibold ${
                            !advancedStats.defensive_rating ? 'text-gray-400' :
                            advancedStats.defensive_rating <= 108 ? 'text-green-600 dark:text-green-400' :
                            advancedStats.defensive_rating <= 112 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.defensive_rating?.toFixed(1) || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>PIE</span>
                          <span className={`font-semibold ${
                            !advancedStats.pie ? 'text-gray-400' :
                            (advancedStats.pie * 100) >= 15 ? 'text-green-600 dark:text-green-400' :
                            (advancedStats.pie * 100) >= 10 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.pie ? (advancedStats.pie * 100).toFixed(1) + '%' : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>PACE</span>
                          <span className={`font-semibold ${
                            !advancedStats.pace ? 'text-gray-400' :
                            advancedStats.pace >= 102 ? 'text-green-600 dark:text-green-400' :
                            advancedStats.pace >= 98 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.pace?.toFixed(1) || 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Rebounding & Playmaking */}
                    <div>
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Rebounding & Playmaking</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span>REB%</span>
                          <span className={`font-semibold ${
                            !advancedStats.rebound_percentage ? 'text-gray-400' :
                            (advancedStats.rebound_percentage * 100) >= 15 ? 'text-green-600 dark:text-green-400' :
                            (advancedStats.rebound_percentage * 100) >= 10 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.rebound_percentage ? (advancedStats.rebound_percentage * 100).toFixed(1) + '%' : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>AST%</span>
                          <span className={`font-semibold ${
                            !advancedStats.assist_percentage ? 'text-gray-400' :
                            (advancedStats.assist_percentage * 100) >= 25 ? 'text-green-600 dark:text-green-400' :
                            (advancedStats.assist_percentage * 100) >= 15 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.assist_percentage ? (advancedStats.assist_percentage * 100).toFixed(1) + '%' : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>OREB%</span>
                          <span className={`font-semibold ${
                            !advancedStats.offensive_rebound_percentage ? 'text-gray-400' :
                            (advancedStats.offensive_rebound_percentage * 100) >= 8 ? 'text-green-600 dark:text-green-400' :
                            (advancedStats.offensive_rebound_percentage * 100) >= 4 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.offensive_rebound_percentage ? (advancedStats.offensive_rebound_percentage * 100).toFixed(1) + '%' : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>AST/TO</span>
                          <span className={`font-semibold ${
                            !advancedStats.assist_to_turnover ? 'text-gray-400' :
                            advancedStats.assist_to_turnover >= 2.0 ? 'text-green-600 dark:text-green-400' :
                            advancedStats.assist_to_turnover >= 1.5 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                          }`}>
                            {advancedStats.assist_to_turnover?.toFixed(1) || 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : advancedStatsLoading ? (
                  <div className="text-center py-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Loading advanced stats...</div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">No advanced stats available</div>
                  </div>
                )}
              </div>
            )}

            {/* ESP Injury Report (Desktop) - always visible in both modes */}
            <div className="hidden lg:block">
              <InjuryContainer
                selectedTeam={propsMode === 'team' ? (gamePropsTeam && gamePropsTeam !== 'N/A' ? gamePropsTeam : '') : selectedTeam}
                opponentTeam={opponentTeam}
                isDark={isDark}
              />
            </div>
            </div>


          </div>
          
        </div>
        </div>
      </div>
      
      {/* Tracking Modals */}
      {propsMode === 'player' && selectedPlayer && opponentTeam && (
        <>
          <TrackPlayerModal
            isOpen={showTrackModal}
            onClose={() => setShowTrackModal(false)}
            playerName={selectedPlayer.full}
            playerId={String(selectedPlayer.id)}
            team={selectedTeam}
            opponent={nextGameOpponent}
            gameDate={nextGameDate}
            oddsFormat={oddsFormat}
          />
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
        </>
      )}
      
      {/* Game Props Tracking Modals */}
      {propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam && (
        <>
          <TrackPlayerModal
            isOpen={showTrackModal}
            onClose={() => setShowTrackModal(false)}
            playerName={TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam}
            playerId={gamePropsTeam}
            team={gamePropsTeam}
            opponent={opponentTeam}
            gameDate={nextGameDate}
            oddsFormat={oddsFormat}
            isGameProp={true}
          />
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
        </>
      )}
      
      {/* Mobile Bottom Navigation - Only visible on mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 z-50 safe-bottom">
        {/* Profile Dropdown Menu - Shows above bottom nav */}
        {showProfileDropdown && (
          <div ref={profileDropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
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
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowJournalDropdown(false);
                  router.push('/journal');
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                View Journal
              </button>
              <div className="border-t border-gray-200 dark:border-gray-700"></div>
              <button
                onClick={() => {
                  setShowJournalDropdown(false);
                  router.push('/journal?tab=tracking');
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                View Tracking
              </button>
            </div>
          </div>
        )}

        {/* Settings Dropdown Menu - Shows above bottom nav */}
        {showSettingsDropdown && (
          <div ref={settingsDropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              {/* Theme Selection */}
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Theme</label>
                <select 
                  value={theme}
                  onChange={(e) => {
                    setTheme(e.target.value as 'Light' | 'Dark');
                    localStorage.setItem('theme', e.target.value);
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
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
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">Loading dashboard...</div>}>
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