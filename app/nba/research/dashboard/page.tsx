'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { useTheme } from "@/contexts/ThemeContext";
import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useMemo, useRef, useEffect, memo, useCallback, Suspense } from 'react';
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
import { OddsSnapshot, deriveOpeningCurrentMovement, filterByMarket } from '@/lib/odds';
import InjuryContainer from '@/components/InjuryContainer';
import DepthChartContainer from './components/DepthChartContainer';
import { cachedFetch } from '@/lib/requestCache';
import ShotChart from './ShotChart';
import TrackPlayerModal from '@/components/TrackPlayerModal';
import AddToJournalModal from '@/components/AddToJournalModal';
import { useSubscription } from '@/hooks/useSubscription';

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
  lineMovementData?: {
  openingLine: { line: number; bookmaker: string; timestamp: string } | null;
  currentLine: { line: number; bookmaker: string; timestamp: string } | null;
    impliedOdds: number | null;
    lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
  } | null;
  selectedStat?: string;
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
      // Betting research logic: positive = team lost (failed to cover), negative = team won (covered spread)
      return isHome ? visitorScore - homeScore : homeScore - visitorScore;
    
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

type BdlSearchResult = { id: number; full: string; team?: string; pos?: string };
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
  
  const chartMargin = useMemo(() => {
    const margin = { ...CHART_CONFIG.margin };
    if (compactMobile || isMobileSB) {
      margin.bottom = 0;
      margin.left = 2;
      margin.right = 2;
    }
    return margin;
  }, [compactMobile, isMobileSB]);
  
  // Hide logos and labels for Last Season to reduce clutter
  const hideLogosAndLabels = selectedTimeframe === 'lastseason';

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
          axisLine={xAxisLineStyle}
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
        bottom: isMobile ? CHART_CONFIG.margin.bottom : CHART_CONFIG.margin.bottom + 30,
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
    <span className={`px-1 sm:px-2 py-0.5 sm:py-1 rounded text-xs sm:text-sm font-bold ${cls} whitespace-nowrap`} data-over-rate>
      {overCount}/{total} ({pct.toFixed(1)}%)
    </span>
  );
});

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
  { key: "fg_pct", label: "FG%" }, { key: "ftm", label: "FTM" }, { key: "fta", label: "FTA" },
  { key: "ft_pct", label: "FT%" }, { key: "oreb", label: "OREB" }, { key: "dreb", label: "DREB" },
  { key: "turnover", label: "TO" }, { key: "pf", label: "PF" }, { key: "stl", label: "STL" }, { key: "blk", label: "BLK" }
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
    height: 30,
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

  // Prefer current season games; if none, gracefully fall back to last season, then all
  const currentSeason = currentNbaSeason();
  const bySeason = (seasonYear: number) => playerStats.filter(game => {
    if (!game.game?.date) return false;
    const d = new Date(game.game.date);
    const y = d.getFullYear();
    const m = d.getMonth();
    const gameSeasonYear = m >= 9 ? y : y - 1; // Oct-Dec belong to current season year
    return gameSeasonYear === seasonYear;
  });

  let displayGames = bySeason(currentSeason);
  if (displayGames.length === 0) {
    displayGames = bySeason(currentSeason - 1);
  }
  if (displayGames.length === 0) {
    displayGames = playerStats;
  }
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
    return isPercentageStat ? `${numValue.toFixed(1)}%` : numValue.toString();
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
      ) : !chartData.length ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            {apiError && <div className="text-xs text-red-500 mb-2">{apiError}</div>}
            <div className="text-gray-500 dark:text-gray-400 text-lg mb-2">
              {propsMode === 'player' ? 'No Player Selected' : 'No Team Selected'}
            </div>
            <div className="text-gray-400 dark:text-gray-500 text-sm">
              {propsMode === 'player' 
                ? (selectedPlayer 
                    ? `No ${String(selectedStat).toUpperCase()} data found for ${selectedPlayer.full}` 
                    : 'Please search and select a player to research their statistics')
                : (gamePropsTeam && gamePropsTeam !== 'N/A' 
                    ? `No ${String(selectedStat).toUpperCase()} data found for ${gamePropsTeam}` 
                    : 'Please search and select a team to research their game statistics')
              }
            </div>
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
  const onClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <button
      onClick={onClick}
      className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
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
}: any) {
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
        el.className = `px-1 sm:px-2 py-0.5 sm:py-1 rounded text-xs sm:text-sm font-bold ${cls} whitespace-nowrap`;
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
  const getBookmakerInfo = (name: string) => {
    const bookmakerMap: Record<string, { name: string; logo: string; logoUrl?: string }> = {
      'DraftKings': { name: 'DraftKings', logo: 'DK', logoUrl: `https://logo.clearbit.com/draftkings.com` },
      'FanDuel': { name: 'FanDuel', logo: 'FD', logoUrl: `https://logo.clearbit.com/fanduel.com` },
      'BetMGM': { name: 'BetMGM', logo: 'MGM', logoUrl: `https://logo.clearbit.com/betmgm.com` },
      'Caesars': { name: 'Caesars', logo: 'CZR', logoUrl: `https://logo.clearbit.com/caesars.com` },
      'BetRivers': { name: 'BetRivers', logo: 'BR', logoUrl: `https://logo.clearbit.com/riverscasino.com` },
      'Bovada': { name: 'Bovada', logo: 'BV', logoUrl: `https://logo.clearbit.com/bovada.lv` },
      'BetOnline.ag': { name: 'BetOnline.ag', logo: 'BO', logoUrl: `https://logo.clearbit.com/betonline.ag` },
    };
    return bookmakerMap[name] || { name, logo: name.substring(0, 2).toUpperCase() };
  };
  
  // Calculate best bookmaker and line for stat (lowest over line)
  const bestBookmakerForStat = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0) return null;
    
    const statMap: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'pra': 'PTS',
      'pr': 'PTS',
      'ra': 'REB',
    };
    
    const bookRowKey = statMap[selectedStat] || null;
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
  
  // Calculate best line for stat (lowest over line)
  const bestLineForStat = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0) return null;
    
    const statMap: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'pra': 'PTS',
      'pr': 'PTS',
      'ra': 'REB',
    };
    
    const bookRowKey = statMap[selectedStat] || null;
    if (!bookRowKey) return null;
    
    let bestLine = Infinity;
    
    for (const book of realOddsData) {
      const statData = (book as any)[bookRowKey];
      if (!statData || statData.line === 'N/A') continue;
      const lineValue = parseFloat(statData.line);
      if (isNaN(lineValue)) continue;
      if (lineValue < bestLine) {
        bestLine = lineValue;
      }
    }
    
    return bestLine !== Infinity ? bestLine : null;
  }, [realOddsData, selectedStat]);
  
  // Auto-set betting line to best available line when odds data loads (only if user hasn't manually set it)
  useEffect(() => {
    if (bestLineForStat !== null && !hasManuallySetLineRef.current) {
      // Only auto-set if:
      // 1. The line hasn't been auto-set for this stat yet, OR
      // 2. The best line has changed from what we last auto-set
      const shouldAutoSet = 
        lastAutoSetStatRef.current !== selectedStat ||
        lastAutoSetLineRef.current === null ||
        Math.abs((lastAutoSetLineRef.current || 0) - bestLineForStat) > 0.01;
      
      if (shouldAutoSet) {
        // Only update if the current betting line is different from the best line
        // Use a ref to check the current value to avoid dependency issues
        const currentBettingLine = bettingLine;
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
  useEffect(() => {
    if (!realOddsData || realOddsData.length === 0) return;
    
    const statMap: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'pra': 'PTS',
      'pr': 'PTS',
      'ra': 'REB',
    };
    
    const bookRowKey = statMap[selectedStat] || null;
    if (!bookRowKey) return;
    
    // Find if any bookmaker has a line matching the current display line (updates immediately)
    const matchingBook = realOddsData.find((book: any) => {
      const statData = (book as any)[bookRowKey];
      if (!statData || statData.line === 'N/A') return false;
      const lineValue = parseFloat(statData.line);
      if (isNaN(lineValue)) return false;
      return Math.abs(lineValue - displayLine) < 0.01;
    });
    
    if (matchingBook) {
      // Only update if it's different from current selection
      setSelectedBookmaker(prev => prev !== matchingBook.name ? matchingBook.name : prev);
    } else {
      // Clear selection if no bookmaker matches
      setSelectedBookmaker(prev => prev !== null ? null : prev);
    }
  }, [displayLine, realOddsData, selectedStat]);
  
   const StatPills = useMemo(() => (
      <div className="mb-2 sm:mb-3 md:mb-4 mt-1 sm:mt-0">
        <div
          className="w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x custom-scrollbar"
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
                    onClick={() => {
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

    // Hide controls when no data
    if (!chartData || chartData.length === 0) {
      return null;
    }

    return (
      <>
        {StatPills}
        {/* Responsive controls layout */}
        <div className="space-y-2 sm:space-y-3 md:space-y-4 mb-2 sm:mb-3 md:mb-4 lg:mb-6">
          {/* Top row: Line input (left), Over Rate (center-left), Team vs + Timeframes (right) */}
          <div className="flex items-center flex-wrap gap-1 sm:gap-2 md:gap-3 pl-0 sm:pl-0 sm:ml-6">
            {/* Alt Lines Dropdown - Desktop only */}
            {(() => {
              // Hide if no odds data available
              if (!realOddsData || realOddsData.length === 0) return null;
              
              const statMap: Record<string, string> = {
                'pts': 'PTS',
                'reb': 'REB',
                'ast': 'AST',
                'pra': 'PTS',
                'pr': 'PTS',
                'ra': 'REB',
              };
              
              const bookRowKey = statMap[selectedStat] || null;
              if (!bookRowKey) return null;
              
              // Get all available lines for dropdown
              const altLines = realOddsData && realOddsData.length > 0
                ? realOddsData
                    .map((book: any) => {
                      const statData = (book as any)[bookRowKey];
                      if (!statData || statData.line === 'N/A') return null;
                      
                      const lineValue = parseFloat(statData.line);
                      if (isNaN(lineValue)) return null;
                      
                      return {
                        bookmaker: book.name,
                        line: lineValue,
                        over: statData.over,
                        under: statData.under,
                      };
                    })
                    .filter((item: any): item is { bookmaker: string; line: number; over: string; under: string } => item !== null)
                    .sort((a: { line: number }, b: { line: number }) => a.line - b.line)
                : [];
              
              // Find the bookmaker to display: check all available lines for a match
              const displayBookmaker = (() => {
                // First, check if any bookmaker has a line matching the current display line (updates immediately)
                const matchingLine = altLines.find((l: { bookmaker: string; line: number }) => 
                  Math.abs(l.line - displayLine) < 0.01
                );
                
                if (matchingLine) {
                  return {
                    bookmaker: matchingLine.bookmaker,
                    line: matchingLine.line,
                    over: matchingLine.over,
                    under: matchingLine.under,
                  };
                }
                
                return null;
              })();
              
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
                              className="w-5 h-5 sm:w-6 sm:h-6 rounded object-contain flex-shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'block';
                              }}
                            />
                          ) : null}
                          <span className={`text-base sm:text-lg flex-shrink-0 ${!bookmakerInfo.logoUrl ? '' : 'hidden'}`}>
                            {bookmakerInfo.logo}
                          </span>
                          <div className="flex flex-col items-start gap-0.5 min-w-0">
                            {displayBookmaker.over && displayBookmaker.over !== 'N/A' && (
                              <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                                O{fmtOdds(displayBookmaker.over)}
                              </span>
                            )}
                            {displayBookmaker.under && displayBookmaker.under !== 'N/A' && (
                              <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                                U{fmtOdds(displayBookmaker.under)}
                              </span>
                            )}
                          </div>
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
                            altLines.map((altLine: { bookmaker: string; line: number; over: string; under: string }, idx: number) => {
                              const bookmakerInfo = getBookmakerInfo(altLine.bookmaker);
                              const isSelected = Math.abs(altLine.line - displayLine) < 0.01;
                              
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
                                          if (fallback) fallback.style.display = 'block';
                                        }}
                                      />
                                    ) : null}
                                    <span className={`text-lg flex-shrink-0 ${!bookmakerInfo.logoUrl ? '' : 'hidden'}`}>
                                      {bookmakerInfo.logo}
                                    </span>
                                    
                                    {/* Line and Bookmaker Name */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                          {altLine.line}
                                        </span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                          {bookmakerInfo.name}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {/* Odds */}
                                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                    {altLine.over && altLine.over !== 'N/A' && (
                                      <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-[10px] font-mono">
                                        O {fmtOdds(altLine.over)}
                                      </span>
                                    )}
                                    {altLine.under && altLine.under !== 'N/A' && (
                                      <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-[10px] font-mono">
                                        U {fmtOdds(altLine.under)}
                                      </span>
                                    )}
                                  </div>
                                  
                                  {/* Selected indicator */}
                                  {isSelected && (
                                    <svg className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                              );
                            })
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
                  // Hide if no odds data available
                  if (!realOddsData || realOddsData.length === 0) return null;
                  
                  const statMap: Record<string, string> = {
                    'pts': 'PTS',
                    'reb': 'REB',
                    'ast': 'AST',
                    'pra': 'PTS',
                    'pr': 'PTS',
                    'ra': 'REB',
                  };
                  
                  const bookRowKey = statMap[selectedStat] || null;
                  if (!bookRowKey) return null;
                  
                  // Get all available lines for dropdown
                  const altLines = realOddsData && realOddsData.length > 0
                    ? realOddsData
                        .map((book: any) => {
                          const statData = (book as any)[bookRowKey];
                          if (!statData || statData.line === 'N/A') return null;
                          
                          const lineValue = parseFloat(statData.line);
                          if (isNaN(lineValue)) return null;
                          
                          return {
                            bookmaker: book.name,
                            line: lineValue,
                            over: statData.over,
                            under: statData.under,
                          };
                        })
                        .filter((item: any): item is { bookmaker: string; line: number; over: string; under: string } => item !== null)
                        .sort((a: { line: number }, b: { line: number }) => a.line - b.line)
                    : [];
                  
                  // Find the bookmaker to display: check all available lines for a match
                  const displayBookmaker = (() => {
                    const matchingLine = altLines.find((l: { bookmaker: string; line: number }) => 
                      Math.abs(l.line - displayLine) < 0.01
                    );
                    
                    if (matchingLine) {
                      return {
                        bookmaker: matchingLine.bookmaker,
                        line: matchingLine.line,
                        over: matchingLine.over,
                        under: matchingLine.under,
                      };
                    }
                    
                    return null;
                  })();
                  
                  const bookmakerInfo = displayBookmaker ? getBookmakerInfo(displayBookmaker.bookmaker) : null;
                  const shouldShowBookmaker = displayBookmaker !== null;
                  
                  return (
                    <div className="sm:hidden relative flex-shrink-0 w-[100px]" ref={altLinesRef}>
                      <button
                        onClick={() => setIsAltLinesOpen(!isAltLinesOpen)}
                        className="w-full px-1.5 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors h-[32px] overflow-hidden"
                      >
                        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
                          {shouldShowBookmaker && bookmakerInfo && displayBookmaker ? (
                            <>
                              {bookmakerInfo.logoUrl ? (
                                <img 
                                  src={bookmakerInfo.logoUrl} 
                                  alt={bookmakerInfo.name}
                                  className="w-5 h-5 rounded object-contain flex-shrink-0"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                    if (fallback) fallback.style.display = 'block';
                                  }}
                                />
                              ) : null}
                              <span className={`text-base flex-shrink-0 ${!bookmakerInfo.logoUrl ? '' : 'hidden'}`}>
                                {bookmakerInfo.logo}
                              </span>
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
                                altLines.map((altLine: { bookmaker: string; line: number; over: string; under: string }, idx: number) => {
                                  const bookmakerInfo = getBookmakerInfo(altLine.bookmaker);
                                  const isSelected = Math.abs(altLine.line - displayLine) < 0.01;
                                  
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
                                              if (fallback) fallback.style.display = 'block';
                                            }}
                                          />
                                        ) : null}
                                        <span className={`text-lg flex-shrink-0 ${!bookmakerInfo.logoUrl ? '' : 'hidden'}`}>
                                          {bookmakerInfo.logo}
                                        </span>
                                        
                                        {/* Line and Bookmaker Name */}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                              {altLine.line}
                                            </span>
                                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                              {bookmakerInfo.name}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                      
                                      {/* Odds */}
                                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                        {altLine.over && altLine.over !== 'N/A' && (
                                          <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-[10px] font-mono">
                                            O {fmtOdds(altLine.over)}
                                          </span>
                                        )}
                                        {altLine.under && altLine.under !== 'N/A' && (
                                          <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-[10px] font-mono">
                                            U {fmtOdds(altLine.under)}
                                          </span>
                                        )}
                                      </div>
                                      
                                      {/* Selected indicator */}
                                      {isSelected && (
                                        <svg className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </button>
                                  );
                                })
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
            </div>
            {/* Middle: Over Rate pill, centered within remaining space (appears slightly left due to right content) - Desktop only */}
          <div className="hidden sm:flex flex-1 items-center justify-center">
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
}: any) {
  return (
<div 
className="chart-container-no-focus relative z-10 bg-white dark:bg-slate-800 rounded-lg shadow-sm p-0 sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0 border border-gray-200 dark:border-gray-700 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden"
      style={{ outline: 'none', boxShadow: 'none' }}
    >
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
      />
      {/* Mobile: Over Rate pill above chart */}
      <div className="sm:hidden px-2 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Over Rate:</span>
          <OverRatePill 
            overCount={chartData.filter((d: any) => d.value > bettingLine).length} 
            total={chartData.length} 
            isDark={isDark} 
          />
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
  lineMovementData,
  selectedStat,
}: OfficialOddsCardProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative z-50 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 w-full min-w-0 flex-shrink-0 overflow-hidden">
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* First: Line Movement (most important) */}
        <div className="p-3 sm:p-4 md:p-6 lg:border-r border-gray-200 dark:border-gray-700">
          <div className={`text-sm sm:text-base font-semibold mb-2 ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>Line Movement</div>
          <div className="border-b border-gray-300 dark:border-gray-600 mb-3"></div>
          <div className="relative">
            <div className="space-y-2.5 max-h-48 overflow-y-auto custom-scrollbar pr-2 pb-8">
            {intradayMovements.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400 text-sm">
                No line movement data available
              </div>
            ) : (
              intradayMovements.map((m: any, idx: number) => (
                <div key={`${m.ts}-${idx}`} className="grid grid-cols-[128px_auto_auto] gap-3 items-center text-xs">
                  <span className={`font-mono ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>{m.timeLabel}</span>
                  <span className={
                    (m.direction === 'up'
                      ? (mounted && isDark ? 'text-green-400' : 'text-green-600')
                      : m.direction === 'down'
                      ? (mounted && isDark ? 'text-red-400' : 'text-red-600')
                      : (mounted && isDark ? 'text-white' : 'text-gray-900')) + ' font-mono font-bold justify-self-end'
                  }>
                    {m.line.toFixed(1)} {m.direction === 'up' ? '↗' : m.direction === 'down' ? '↘' : '—'}
                  </span>
                  <span className={`text-[10px] font-mono justify-self-end ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>{m.change}</span>
                </div>
              ))
            )}
            </div>
            {/* Fade gradient at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none bg-gradient-to-t from-white via-white/80 dark:from-slate-800 dark:via-slate-800/80 to-transparent"></div>
          </div>
        </div>
        
        {/* Second: Matchup Odds & Implied/Official Odds */}
        <div className="p-3 sm:p-4 md:p-6 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left: Matchup Odds */}
            <div>
            <div className="text-sm sm:text-base font-semibold mb-3 text-gray-900 dark:text-white">Matchup Odds</div>
            <div className="flex items-center gap-1.5 mb-3">
              {selectedTeamLogoUrl && <img src={selectedTeamLogoUrl} alt={selectedTeam} className="w-6 h-6 sm:w-5 sm:h-5 object-contain" />}
              <span className={(mounted && isDark ? 'text-slate-200' : 'text-slate-800') + ' text-base sm:text-sm font-bold'}>{(!selectedTeam || selectedTeam === 'N/A') ? '—' : selectedTeam}</span>
              <span className={'text-gray-600 dark:text-gray-400 text-sm sm:text-xs'}>vs</span>
              <span className={(mounted && isDark ? 'text-slate-200' : 'text-slate-800') + ' text-base sm:text-sm font-bold'}>{(!opponentTeam || opponentTeam === '') ? '—' : opponentTeam}</span>
              {opponentTeamLogoUrl && <img src={opponentTeamLogoUrl} alt={opponentTeam} className="w-6 h-6 sm:w-5 sm:h-5 object-contain" />}
            </div>
            <div className={'text-gray-600 dark:text-gray-400 text-sm sm:text-xs mb-3'}>
              Tipoff: {matchupInfo?.tipoffLocal || '—'}
            </div>
            {(() => {
              const fd = (books || []).find(b => b.name.toLowerCase() === 'fanduel');
              if (!fd) {
                return (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    No odds data available
                  </div>
                );
              }

              const displayHalfLine = (s: string) => {
                const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
                if (Number.isNaN(v)) return s;
                const frac = Math.abs(v * 10) % 10;
                if (frac === 0) {
                  const adj = v - 0.5;
                  return adj.toFixed(1);
                }
                return Number.isFinite(v) ? v.toFixed(1) : s;
              };

              return (
                <div className="space-y-2">
                  <div className="text-xs sm:text-[10px] text-gray-500 dark:text-gray-400 mb-2">@ FanDuel</div>
                  <div className="grid gap-x-4 gap-y-2 text-sm sm:text-xs" style={{ gridTemplateColumns: 'max-content 1fr' }}>
                    <div className={mounted && isDark ? 'text-slate-300' : 'text-slate-600'}>Moneyline</div>
                    <div className={(mounted && isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>
                      <div className="space-y-0.5">
                        <div>
                          {(selectedTeam || 'HOME')}: <span className="font-semibold">{fmtOdds(fd.H2H.home)}</span>
                        </div>
                        <div className="opacity-90">
                          {(opponentTeam || 'AWAY')}: <span className="font-semibold">{fmtOdds(fd.H2H.away)}</span>
                        </div>
                      </div>
                    </div>

                    <div className={mounted && isDark ? 'text-slate-300' : 'text-slate-600'}>Spread</div>
                    <div className={(mounted && isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>
                      <div className="space-y-0.5">
                        <div>{displayHalfLine(fd.Spread.line)} (<span className="font-semibold">{fmtOdds(fd.Spread.over)}</span>)</div>
                        <div>+{displayHalfLine(fd.Spread.line)} (<span className="font-semibold">{fmtOdds(fd.Spread.under)}</span>)</div>
                      </div>
                    </div>

                    <div className={mounted && isDark ? 'text-slate-300' : 'text-slate-600'}>Total</div>
                    <div className={(mounted && isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>
                      <div className="space-y-0.5">
                        <div>O {displayHalfLine(fd.Total.line)} (<span className="font-semibold">{fmtOdds(fd.Total.over)}</span>)</div>
                        <div>U {displayHalfLine(fd.Total.line)} (<span className="font-semibold">{fmtOdds(fd.Total.under)}</span>)</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
            </div>

            {/* Right: Implied Odds + Official Odds Combined */}
            <div className="space-y-4">
              {/* Implied Odds */}
              <div>
                <div className={`text-sm sm:text-base font-semibold mb-3 ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>Implied Odds</div>
                {(((lineMovementData as any)?.overImpliedProb !== null && (lineMovementData as any)?.overImpliedProb !== undefined) ||
                  (lineMovementData?.impliedOdds !== null && lineMovementData?.impliedOdds !== undefined)) ? (
                  <div className="space-y-2 text-base sm:text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-gray-700 dark:text-gray-200">Over:</span>
                      <span className={`font-semibold ${
                        (lineMovementData as any)?.isOverFavorable === true 
                          ? 'text-green-600 dark:text-green-400' 
                          : (lineMovementData as any)?.isOverFavorable === false
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}>
                        {((lineMovementData as any)?.overImpliedProb ?? lineMovementData?.impliedOdds ?? 0).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-gray-700 dark:text-gray-200">Under:</span>
                      <span className={`font-semibold ${
                        (lineMovementData as any)?.isOverFavorable === false 
                          ? 'text-green-600 dark:text-green-400' 
                          : (lineMovementData as any)?.isOverFavorable === true
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}>
                        {((lineMovementData as any)?.underImpliedProb ?? (lineMovementData?.impliedOdds ? (100 - lineMovementData.impliedOdds) : 0)).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedStat ? `No ${selectedStat.toUpperCase()} odds available at this time, check back later!` : 'No odds available at this time'}
                  </div>
                )}
              </div>
              
              {/* Official Odds */}
              <div>
                <div className={`text-sm sm:text-base font-semibold mb-3 ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>Official Odds</div>
                {(() => {
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
                  
                  // Get current line from books (realOddsData) - use first available bookmaker with data
                  let currentLineFromBooks: { line: number; bookmaker: string } | null = null;
                  if (books && books.length > 0) {
                    for (const book of books) {
                      const bookData = (book as any)[bookKey];
                      if (bookData && bookData.line && bookData.line !== 'N/A') {
                        const lineValue = parseFloat(String(bookData.line).replace(/[^0-9.+-]/g, ''));
                        if (!Number.isNaN(lineValue)) {
                          currentLineFromBooks = {
                            line: lineValue,
                            bookmaker: book.name,
                          };
                          break;
                        }
                      }
                    }
                  }
                  
                  return (
                    <div className="space-y-2 text-base sm:text-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700 dark:text-gray-200">Opening:</span>
                        <span className="text-gray-900 dark:text-white">
                          {lineMovementData?.openingLine ? `${lineMovementData.openingLine.line.toFixed(1)} (${lineMovementData.openingLine.bookmaker})` : '—'}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-gray-700 dark:text-gray-200">Current:</span>
                        <span className="text-gray-900 dark:text-white">
                          {currentLineFromBooks 
                            ? `${currentLineFromBooks.line.toFixed(1)} (${currentLineFromBooks.bookmaker})`
                            : lineMovementData?.currentLine 
                              ? `${lineMovementData.currentLine.line.toFixed(1)} (${lineMovementData.currentLine.bookmaker})`
                              : '—'}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
      {(derivedOdds.openingLine == null && derivedOdds.currentLine == null) && (
        <div className="mt-2 px-3 sm:px-4 md:px-6 pb-3 text-[10px] text-gray-500 dark:text-gray-400">Awaiting odds data...</div>
      )}
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
    prev.books === next.books
  );
});

// Defense vs Position metrics (static, defined once)
const DVP_METRICS = [
  { key: 'pts' as const, label: 'Points vs ', isPercentage: false },
  { key: 'reb' as const, label: 'Rebounds vs ', isPercentage: false },
  { key: 'ast' as const, label: 'Assists vs ', isPercentage: false },
  { key: 'fg_pct' as const, label: 'Field Goal % vs ', isPercentage: true },
  { key: 'fg3_pct' as const, label: 'Three Point % vs ', isPercentage: true },
  { key: 'stl' as const, label: 'Steals vs ', isPercentage: false },
  { key: 'blk' as const, label: 'Blocks vs ', isPercentage: false },
] as const;

// Global cache shared between all PositionDefenseCard instances (mobile + desktop)
// Split into two caches: team DVP data (position-independent) and rank data (position-specific)
const dvpTeamCache = new Map<string, { metrics: any, sample: number }>();
const dvpRankCache = new Map<string, { metrics: any }>();

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
      if (!targetOpp || !targetPos) return;

      // Check if we have both team DVP and rank data cached
      const teamCacheKey = `${targetOpp}:82`;
      const rankCacheKey = `${targetPos}:82`;
      const teamCached = dvpTeamCache.get(teamCacheKey);
      const rankCached = dvpRankCache.get(rankCacheKey);
      
      // Show team stats immediately if available, ranks can load in background
      if (teamCached) {
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
          for (const m of DVP_METRICS) {
            const ranks = rankCached.metrics?.[m.key] || {};
            const rank = ranks?.[targetOpp] as number | undefined;
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
        
        // Fetch only what we don't have cached
        const promises: Promise<any>[] = [];
        
        if (!teamCached) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/batch?team=${targetOpp}&metrics=${metricsStr}&games=82`,
              undefined,
              300000 // 5 minute cache - team DVP doesn't change often
            ).then(data => ({ type: 'team', data }))
          );
        }
        
        if (!rankCached) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/rank/batch?pos=${targetPos}&metrics=${metricsStr}&games=82`,
              undefined,
              300000 // 5 minute cache
            ).then(data => ({ type: 'rank', data }))
          );
        }
        
        if (promises.length > 0) {
          const results = await Promise.all(promises);
          
          let dvpData = teamCached;
          let rankData = rankCached;
          
          results.forEach(result => {
            if (result.type === 'team') {
              dvpData = { metrics: result.data?.metrics, sample: result.data?.sample_games || 0 };
              dvpTeamCache.set(teamCacheKey, dvpData);
            } else if (result.type === 'rank') {
              rankData = { metrics: result.data?.metrics };
              dvpRankCache.set(rankCacheKey, rankData);
            }
          });
          
          if (!abort && dvpData && rankData) {
            const map: Record<string, number | null> = {};
            const rmap: Record<string, number | null> = {};
            
            for (const m of DVP_METRICS) {
              const perGame = dvpData.metrics?.[m.key];
              const value = perGame ? (perGame?.[targetPos as any] as number | undefined) : undefined;
              map[m.key] = typeof value === 'number' ? value : null;
              
              const ranks = rankData.metrics?.[m.key] || {};
              const rank = ranks?.[targetOpp] as number | undefined;
              rmap[m.key] = Number.isFinite(rank as any) ? (rank as number) : null;
            }
            
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
      
      // Skip if already cached
      if (!targetOpp || (dvpTeamCache.has(teamCacheKey) && dvpRankCache.has(rankCacheKey))) return;
      
      try {
        const metricsStr = DVP_METRICS.map(m => m.key).join(',');
        const promises: Promise<any>[] = [];
        
        // Only fetch what's not cached
        if (!dvpTeamCache.has(teamCacheKey)) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/batch?team=${targetOpp}&metrics=${metricsStr}&games=82`,
              undefined,
              300000
            ).then(data => ({ type: 'team', data }))
          );
        }
        
        if (!dvpRankCache.has(rankCacheKey)) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/rank/batch?pos=${p}&metrics=${metricsStr}&games=10`,
              undefined,
              300000
            ).then(data => ({ type: 'rank', data }))
          );
        }
        
        if (promises.length > 0) {
          const results = await Promise.all(promises);
          results.forEach(result => {
            if (result.type === 'team') {
              dvpTeamCache.set(teamCacheKey, { metrics: result.data?.metrics, sample: result.data?.sample_games || 0 });
            } else if (result.type === 'rank') {
              dvpRankCache.set(rankCacheKey, { metrics: result.data?.metrics });
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
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    return isPercentage ? `${v.toFixed(1)}%` : v.toFixed(1);
  };

  const posLabel = posSel || selectedPosition || '—';

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
                <span className="font-semibold">{oppSel || opponentTeam || '—'}</span>
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
        {!selectedPosition ? (
          <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">Select a player to determine position.</div>
        ) : (
<div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-48 sm:max-h-56 md:max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
            {DVP_METRICS.map((m) => {
              const rank = perRank[m.key];
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
                        {rank && rank > 0 ? `#${rank}` : '—'}
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
const OpponentAnalysisCard = memo(function OpponentAnalysisCard({ isDark, opponentTeam, selectedTimeFilter }: { isDark: boolean; opponentTeam: string; selectedTimeFilter: string }) {
  const [mounted, setMounted] = useState(false);
  const [teamStats, setTeamStats] = useState<any>(null);
  const [teamRanks, setTeamRanks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  useEffect(() => {
    if (!opponentTeam) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch team stats
        const statsResponse = await fetch(`/api/dvp/team-totals?team=${opponentTeam}&games=82`);
        const statsData = await statsResponse.json();
        if (statsData.success) {
          setTeamStats(statsData.perGame);
        }
        
        // Fetch ranks for all metrics
        const metrics = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'];
        const rankPromises = metrics.map(metric => 
          fetch(`/api/dvp/team-totals/rank?metric=${metric}&games=82`)
            .then(res => {
              if (!res.ok) {
                throw new Error(`Failed to fetch rank for ${metric}: ${res.status}`);
              }
              return res.json();
            })
            .then(data => ({ metric, rank: data.ranks?.[opponentTeam] || 0 }))
            .catch(error => {
              console.error(`Error fetching rank for ${metric}:`, error);
              return { metric, rank: 0 };
            })
        );
        
        const rankResults = await Promise.all(rankPromises);
        const ranks: Record<string, number> = {};
        rankResults.forEach(r => { ranks[r.metric] = r.rank; });
        setTeamRanks(ranks);
      } catch (error) {
        console.error('Failed to fetch team data:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [opponentTeam]);
  
  const getRankColor = (rank: number): string => {
    if (rank === 0 || !rank) return mounted && isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
    if (rank >= 26) return 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';
    if (rank >= 21) return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
    if (rank >= 16) return 'bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-100';
    if (rank >= 11) return 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200';
    if (rank >= 6) return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
    return 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Opponent Analysis</h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">Current season stats</span>
      </div>
      <div className="space-y-4">
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
                {loading || !teamStats ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Points Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {teamStats.pts.toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.pts || 0)}`}>
                          {teamRanks.pts > 0 ? `#${teamRanks.pts}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Rebounds Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {teamStats.reb.toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.reb || 0)}`}>
                          {teamRanks.reb > 0 ? `#${teamRanks.reb}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Assists Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {teamStats.ast.toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.ast || 0)}`}>
                          {teamRanks.ast > 0 ? `#${teamRanks.ast}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Field Goal % Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {teamStats.fg_pct.toFixed(1)}%
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.fg_pct || 0)}`}>
                          {teamRanks.fg_pct > 0 ? `#${teamRanks.fg_pct}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>3-Point % Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {teamStats.fg3_pct.toFixed(1)}%
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.fg3_pct || 0)}`}>
                          {teamRanks.fg3_pct > 0 ? `#${teamRanks.fg3_pct}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Steals Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {teamStats.stl.toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.stl || 0)}`}>
                          {teamRanks.stl > 0 ? `#${teamRanks.stl}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Blocks Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {teamStats.blk.toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.blk || 0)}`}>
                          {teamRanks.blk > 0 ? `#${teamRanks.blk}` : '—'}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => (
  prev.isDark === next.isDark &&
  prev.opponentTeam === next.opponentTeam &&
  prev.selectedTimeFilter === next.selectedTimeFilter
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
  fmtOdds
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
}) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const home = (propsMode === 'team' ? gamePropsTeam : selectedTeam) || 'HOME';
  const away = opponentTeam || 'AWAY';
  
  const books = realOddsData.length > 0 ? realOddsData : [
    { name: 'DraftKings', H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' }, PTS: { line: 'N/A', over: 'N/A', under: 'N/A' }, REB: { line: 'N/A', over: 'N/A', under: 'N/A' }, AST: { line: 'N/A', over: 'N/A', under: 'N/A' } },
    { name: 'FanDuel', H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' }, PTS: { line: 'N/A', over: 'N/A', under: 'N/A' }, REB: { line: 'N/A', over: 'N/A', under: 'N/A' }, AST: { line: 'N/A', over: 'N/A', under: 'N/A' } },
    { name: 'BetMGM', H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' }, PTS: { line: 'N/A', over: 'N/A', under: 'N/A' }, REB: { line: 'N/A', over: 'N/A', under: 'N/A' }, AST: { line: 'N/A', over: 'N/A', under: 'N/A' } },
    { name: 'Caesars', H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' }, PTS: { line: 'N/A', over: 'N/A', under: 'N/A' }, REB: { line: 'N/A', over: 'N/A', under: 'N/A' }, AST: { line: 'N/A', over: 'N/A', under: 'N/A' } }
  ];

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
      <div className="text-sm text-gray-900 dark:text-white font-semibold mb-2">BEST ODDS</div>
      
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
          {books.map((row, i) => (
            <tr key={row.name} className={mounted && isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.name}</td>
              
              {/* Team mode: show H2H, Spread, Total */}
              {propsMode === 'team' && (
                <>
              <td className="py-2 px-3">
                <div className="font-mono text-gray-900 dark:text-white whitespace-nowrap">
{home} <span className={i === bestH2H.home ? green : grey}>{oddsFormat === 'decimal' ? fmtOdds(row.H2H.home) : row.H2H.home}</span>
                </div>
                <div className="font-mono text-gray-900 dark:text-white opacity-80 whitespace-nowrap">
{away} <span className={i === bestH2H.away ? green : grey}>{oddsFormat === 'decimal' ? fmtOdds(row.H2H.away) : row.H2H.away}</span>
                </div>
              </td>
              <td className="py-2 px-3">
                {(() => {
                  const lineVal = parseLine(row.Spread.line);
                  if (row.Spread.line === 'N/A' || Number.isNaN(lineVal)) {
                    return (
                      <>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          + N/A ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.over) : row.Spread.over})
                        </div>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          - N/A ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.under) : row.Spread.under})
                        </div>
                      </>
                    );
                  }
                  // Display both + and - with the same line value
                  const absLineVal = Math.abs(lineVal);
                  return (
                    <>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.positive.has(i) ? green : grey}`}>
                        + {displayHalfLine(String(absLineVal))} ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.over) : row.Spread.over})
                      </div>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.negative.has(i) ? green : grey}`}>
                        - {displayHalfLine(String(absLineVal))} ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.under) : row.Spread.under})
                      </div>
                    </>
                  );
                })()}
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.Total.over.has(i) ? green : grey}`}>O {displayHalfLine(row.Total.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.Total.over) : row.Total.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.Total.under.has(i) ? green : grey}`}>U {displayHalfLine(row.Total.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.Total.under) : row.Total.under})</div>
              </td>
                </>
              )}
              
              {/* Player mode: show player props */}
              {propsMode === 'player' && (
                <>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PTS.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.PTS.over) : row.PTS.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PTS.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.PTS.under) : row.PTS.under})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.REB.over.has(i) ? green : grey}`}>O {displayHalfLine(row.REB.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.REB.over) : row.REB.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.REB.under.has(i) ? green : grey}`}>U {displayHalfLine(row.REB.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.REB.under) : row.REB.under})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.AST.over.has(i) ? green : grey}`}>O {displayHalfLine(row.AST.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.AST.over) : row.AST.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.AST.under.has(i) ? green : grey}`}>U {displayHalfLine(row.AST.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.AST.under) : row.AST.under})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.over.has(i) ? green : grey}`}>O {displayHalfLine(row.THREES?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.THREES?.over || 'N/A') : row.THREES?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.under.has(i) ? green : grey}`}>U {displayHalfLine(row.THREES?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.THREES?.under || 'N/A') : row.THREES?.under || 'N/A'})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PRA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PRA?.over || 'N/A') : row.PRA?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PRA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PRA?.under || 'N/A') : row.PRA?.under || 'N/A'})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PR.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PR?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PR?.over || 'N/A') : row.PR?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PR.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PR?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PR?.under || 'N/A') : row.PR?.under || 'N/A'})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PA?.over || 'N/A') : row.PA?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PA?.under || 'N/A') : row.PA?.under || 'N/A'})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.RA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.RA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.RA?.over || 'N/A') : row.RA?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.RA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.RA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.RA?.under || 'N/A') : row.RA?.under || 'N/A'})</div>
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
  prev.oddsFormat === next.oddsFormat
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
  fmtOdds
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
}) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const home = (propsMode === 'team' ? gamePropsTeam : selectedTeam) || 'HOME';
  const away = opponentTeam || 'AWAY';
  
  const books = realOddsData.length > 0 ? realOddsData : [
    { name: 'DraftKings', H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' }, PTS: { line: 'N/A', over: 'N/A', under: 'N/A' }, REB: { line: 'N/A', over: 'N/A', under: 'N/A' }, AST: { line: 'N/A', over: 'N/A', under: 'N/A' } },
    { name: 'FanDuel', H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' }, PTS: { line: 'N/A', over: 'N/A', under: 'N/A' }, REB: { line: 'N/A', over: 'N/A', under: 'N/A' }, AST: { line: 'N/A', over: 'N/A', under: 'N/A' } },
    { name: 'BetMGM', H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' }, PTS: { line: 'N/A', over: 'N/A', under: 'N/A' }, REB: { line: 'N/A', over: 'N/A', under: 'N/A' }, AST: { line: 'N/A', over: 'N/A', under: 'N/A' } },
    { name: 'Caesars', H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' }, PTS: { line: 'N/A', over: 'N/A', under: 'N/A' }, REB: { line: 'N/A', over: 'N/A', under: 'N/A' }, AST: { line: 'N/A', over: 'N/A', under: 'N/A' } }
  ];

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
      <div className="text-sm text-gray-900 dark:text-white font-semibold mb-2">BEST ODDS</div>
      
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
          {books.map((row, i) => (
            <tr key={row.name} className={mounted && isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.name}</td>
              
              {/* Team mode: show H2H, Spread, Total */}
              {propsMode === 'team' && (
                <>
              <td className="py-2 px-3">
                <div className="font-mono text-gray-900 dark:text-white whitespace-nowrap">
{home} <span className={i === bestH2H.home ? green : grey}>{oddsFormat === 'decimal' ? fmtOdds(row.H2H.home) : row.H2H.home}</span>
                </div>
                <div className="font-mono text-gray-900 dark:text-white opacity-80 whitespace-nowrap">
{away} <span className={i === bestH2H.away ? green : grey}>{oddsFormat === 'decimal' ? fmtOdds(row.H2H.away) : row.H2H.away}</span>
                </div>
              </td>
              <td className="py-2 px-3">
                {(() => {
                  const lineVal = parseLine(row.Spread.line);
                  if (row.Spread.line === 'N/A' || Number.isNaN(lineVal)) {
                    return (
                      <>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          + N/A ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.over) : row.Spread.over})
                        </div>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          - N/A ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.under) : row.Spread.under})
                        </div>
                      </>
                    );
                  }
                  // Display both + and - with the same line value
                  const absLineVal = Math.abs(lineVal);
                  return (
                    <>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.positive.has(i) ? green : grey}`}>
                        + {displayHalfLine(String(absLineVal))} ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.over) : row.Spread.over})
                      </div>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.negative.has(i) ? green : grey}`}>
                        - {displayHalfLine(String(absLineVal))} ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.under) : row.Spread.under})
                      </div>
                    </>
                  );
                })()}
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.Total.over.has(i) ? green : grey}`}>O {displayHalfLine(row.Total.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.Total.over) : row.Total.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.Total.under.has(i) ? green : grey}`}>U {displayHalfLine(row.Total.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.Total.under) : row.Total.under})</div>
              </td>
                </>
              )}
              
              {/* Player mode: show player props */}
              {propsMode === 'player' && (
                <>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PTS.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.PTS.over) : row.PTS.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PTS.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.PTS.under) : row.PTS.under})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.REB.over.has(i) ? green : grey}`}>O {displayHalfLine(row.REB.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.REB.over) : row.REB.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.REB.under.has(i) ? green : grey}`}>U {displayHalfLine(row.REB.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.REB.under) : row.REB.under})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.AST.over.has(i) ? green : grey}`}>O {displayHalfLine(row.AST.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.AST.over) : row.AST.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.AST.under.has(i) ? green : grey}`}>U {displayHalfLine(row.AST.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.AST.under) : row.AST.under})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.over.has(i) ? green : grey}`}>O {displayHalfLine(row.THREES?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.THREES?.over || 'N/A') : row.THREES?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.under.has(i) ? green : grey}`}>U {displayHalfLine(row.THREES?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.THREES?.under || 'N/A') : row.THREES?.under || 'N/A'})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PRA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PRA?.over || 'N/A') : row.PRA?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PRA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PRA?.under || 'N/A') : row.PRA?.under || 'N/A'})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PR.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PR?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PR?.over || 'N/A') : row.PR?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PR.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PR?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PR?.under || 'N/A') : row.PR?.under || 'N/A'})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PA?.over || 'N/A') : row.PA?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.PA?.under || 'N/A') : row.PA?.under || 'N/A'})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.RA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.RA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.RA?.over || 'N/A') : row.RA?.over || 'N/A'})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.RA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.RA?.line || 'N/A')} ({oddsFormat === 'decimal' ? fmtOdds(row.RA?.under || 'N/A') : row.RA?.under || 'N/A'})</div>
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
  prev.oddsFormat === next.oddsFormat
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
  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserEmail(session.user.email || null);
        setUsername(session.user.user_metadata?.username || session.user.user_metadata?.full_name || null);
        setAvatarUrl(session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null);
        
        // Check Pro access - try profiles table first, fallback to user_metadata
        const { data: profile } = await (supabase
          .from('profiles') as any)
          .select('subscription_status, subscription_tier')
          .eq('id', session.user.id)
          .single();
        
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
        console.log('🔐 Pro Status Check:', { isActive, isProTier, proStatus, profile, metadata: session.user.user_metadata });
        setIsPro(proStatus);
      } else {
        // No session - redirect to login with return path (non-blocking)
        setTimeout(() => {
          router.push('/login?redirect=/nba/research/dashboard');
        }, 0);
      }
    };
    getUser();
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
  
  // Get current betting line for selected stat (fallback to 0.5)
  const bettingLine = bettingLines[selectedStat] ?? 0.5;
  
  // Update betting line for current stat
  const setBettingLine = (value: number) => {
    setBettingLines(prev => ({
      ...prev,
      [selectedStat]: value
    }));
  };
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
          .reverse(); // Most recent first
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
          change: '—',
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
            change: openingLine ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '—',
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
    return rows;
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
    checkFeatureAccess
  } = useSubscription();
  
  // Next game info for tracking (separate from chart filter)
  const [nextGameOpponent, setNextGameOpponent] = useState<string>('');
  const [nextGameDate, setNextGameDate] = useState<string>('');
  const [isGameInProgress, setIsGameInProgress] = useState(false);


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

    // Find next game (sorted by time)
    const nextGame = teamGames
      .map((g: any) => ({ 
        g, 
        t: new Date(g.date || 0).getTime(), 
        status: String(g.status || '').toLowerCase() 
      }))
      .sort((a, b) => a.t - b.t)
      .find(({ status }) => !status.includes('final') && !status.includes('completed'));
    
    if (nextGame) {
      const home = normalizeAbbr(nextGame.g?.home_team?.abbreviation || '');
      const away = normalizeAbbr(nextGame.g?.visitor_team?.abbreviation || '');
      const opponent = normTeam === home ? away : home;
      const gameDate = nextGame.g?.date ? new Date(nextGame.g.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      // Check if game is in progress (game time passed but not final)
      const status = nextGame.status;
      
      // API sometimes returns date strings as status - ignore these
      const isDateStatus = status.includes('T') || status.includes('+') || status.match(/\d{4}-\d{2}-\d{2}/);
      const gameStarted = nextGame.t <= now; // Game time has actually passed
      
      // Only mark as in progress if:
      // 1. Game time has passed
      // 2. Status is NOT empty, 'scheduled', or a date string
      // 3. Status doesn't include 'final' or 'completed'
      const inProgress = !isDateStatus && gameStarted && status !== '' && status !== 'scheduled' && !status.includes('final') && !status.includes('completed');
      
      console.log('Game progress check:', { 
        opponent, 
        gameDate, 
        status, 
        isDateStatus,
        gameTime: new Date(nextGame.t).toISOString(), 
        now: new Date(now).toISOString(),
        gameStarted, 
        inProgress 
      });
      
      setNextGameOpponent(opponent || '');
      setNextGameDate(gameDate);
      setIsGameInProgress(inProgress);
    } else {
      setNextGameOpponent('');
      setNextGameDate('');
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

  // Function to fetch a single team's depth chart
  const fetchTeamDepthChart = async (team: string): Promise<DepthChartData | null> => {
    try {
      if (!team || team === 'N/A') return null;
      const url = `/api/depth-chart?team=${encodeURIComponent(team)}`;
      const res = await fetch(url);
      const js = await res.json().catch(() => ({}));
      if (!res.ok) return null;
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
        if (saved?.selectedTimeframe) setSelectedTimeframe(saved.selectedTimeframe);
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
        if (tf) setSelectedTimeframe(tf);
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
          ? json.results.map((r: any) => ({ id: r.id, full: r.full, team: r.team, pos: r.pos }))
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

    // Fetch current + previous + prior, both regular and playoffs (3 seasons total)
    const [currReg, currPO, prev1Reg, prev1PO, prev2Reg, prev2PO] = await Promise.all([
      grab(season, false),        // 2024-25 regular
      grab(season, true),         // 2024-25 playoffs
      grab(season - 1, false),    // 2023-24 regular  
      grab(season - 1, true),     // 2023-24 playoffs
      grab(season - 2, false),    // 2022-23 regular
      grab(season - 2, true)      // 2022-23 playoffs
    ]);

    // Merge then sort newest-first; downstream will dedupe and slice to timeframe
    const rows = [...currReg, ...currPO, ...prev1Reg, ...prev1PO, ...prev2Reg, ...prev2PO];
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
      // Fetch critical path data first: game stats + ESPN data
      // Then load premium features (advanced stats, shot distance) in background
      const [rows, espnData] = await Promise.all([
        fetchSortedStats(pid),
        fetchEspnPlayerData(player.full, player.teamAbbr)
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
      
  // Parse ESPN height data and merge with sample player data
      const heightData = parseEspnHeight(espnData?.height);
      
      // Try to get jersey from ESPN, then from player data, then from depth chart roster
      let jerseyNumber = Number(espnData?.jersey || player.jersey || 0);
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
        heightFeet: Number(heightData.feet || player.heightFeet || 0),
        heightInches: Number(heightData.inches || player.heightInches || 0),
      });
      
      // Reset betting lines to default for new player
      setBettingLines({});
      
      // Set opponent team based on games schedule (will update when games load)
      const opponent = getOpponentTeam(currentTeam, todaysGames);
      setOpponentTeam(normalizeAbbr(opponent));
      
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
      // Fetch critical path data first: game stats + ESPN data
      // Then load premium features (advanced stats, shot distance) in background
      const [rows, espnData] = await Promise.all([
        fetchSortedStats(pid),
        fetchEspnPlayerData(r.full, r.team)
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
      
      // Parse ESPN height data
      const heightData = parseEspnHeight(espnData?.height);
      
      // Debug ESPN data
      console.log('🏀 Full ESPN data:', espnData);
      
      // Try to get jersey from ESPN, then from depth chart roster, then from sample data
      let jerseyNumber = Number(espnData?.jersey || 0);
      let heightFeetData = heightData.feet;
      let heightInchesData = heightData.inches;
      
      // Fallback to sample players data if ESPN doesn't have jersey or height
      const samplePlayer = SAMPLE_PLAYERS.find(p => p.full.toLowerCase() === r.full.toLowerCase());
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
      
      // Update player object with search API team + ESPN data
      setSelectedPlayer({
        ...tempPlayer,
        teamAbbr: currentTeam,
        jersey: jerseyNumber,
        heightFeet: heightFeetData || null,
        heightInches: heightInchesData || null,
        // Add raw height as fallback for debugging
        rawHeight: espnData?.height || null,
      });
      
      // Reset betting lines to default for new player
      setBettingLines({});
      
      // Set opponent team based on games schedule
      const opponent = getOpponentTeam(currentTeam, todaysGames);
      setOpponentTeam(normalizeAbbr(opponent));
      
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
          game: opponent ? `vs ${opponent}` : "—",
          date: shortDate,
          xKey: String(game.id || `game-${index}`),
          tickLabel: opponent || "—", // Show opponent abbreviation on x-axis for team mode
        };
      });
    }
    
    // Player mode: use existing player stats logic
    if (!playerStats.length) return [];
    
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
      const tickLabel = opponent || "—";
      
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
  }, [playerStats, selectedTimeframe, selectedPlayer, propsMode, gameStats, selectedTeam, opponentTeam, manualOpponent, homeAway]); // Added team mode dependencies, manual opponent, and home/away
  
  /* -------- Chart data with current stat values ----------
     Only recalculate values when selectedStat changes */
  const chartData = useMemo(() => {
    return baseGameData.map(game => ({
      ...game,
      value: propsMode === 'team' 
        ? getGameStatValue((game as any).gameData, selectedStat, gamePropsTeam) 
        : getStatValue((game as any).stats, selectedStat) ?? 0,
    }));
  }, [baseGameData, selectedStat, propsMode, propsMode === 'team' ? gamePropsTeam : selectedTeam]);

  // Hit rate calculations - only recalculate when chartData or bettingLine changes
  const hitRateStats = useMemo(() => {
    const overCount = chartData.filter(d => d.value > bettingLine).length;
    const underCount = chartData.filter(d => d.value < bettingLine).length;
    const average = chartData.length ? chartData.reduce((s, d) => s + (Number.isFinite(d.value) ? d.value : 0), 0) / chartData.length : 0;
    
    return { overCount, underCount, average };
  }, [chartData, bettingLine]);


  const currentStatOptions = propsMode === 'player' ? PLAYER_STAT_OPTIONS : TEAM_STAT_OPTIONS;

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
        if (gameStats?.game) {
          const gameISO = gameStats.game.date;
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
    const values = chartData.map(d => d.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    
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
  }, [chartData, selectedStat, selectedTimeframe]);

  // Real odds data state
  const [realOddsData, setRealOddsData] = useState<BookRow[]>([]);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);
  
  // Merge line movement data with live odds to get accurate current line
  const mergedLineMovementData = useMemo(() => {
    if (!lineMovementData) return null;
    
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
    if (mergedLineMovementData) {
      return {
        openingLine: mergedLineMovementData.openingLine?.line ?? null,
        currentLine: mergedLineMovementData.currentLine?.line ?? null,
      };
    }
    // Fallback to old snapshot logic for team mode
    const filtered = filterByMarket(oddsSnapshots, marketKey);
    return deriveOpeningCurrentMovement(filtered);
  }, [mergedLineMovementData, oddsSnapshots, marketKey]);
  
  // Update intraday movements to use merged data for accurate current line
  const intradayMovementsFinal = useMemo(() => {
    if (mergedLineMovementData) {
      const { lineMovement = [], openingLine, currentLine } = mergedLineMovementData;

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
          .reverse(); // Most recent first
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
          change: '—',
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
            change: openingLine ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '—',
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
  }, [mergedLineMovementData, intradayMovements]);
  
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
      }
      
      const response = await fetch(`/api/odds?${params}`);
      const data = await response.json();
      
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
        setOddsError(data.error || 'Failed to fetch odds');
        setRealOddsData([]);
        return;
      }
      
      setRealOddsData(data.data || []);
      const playerName = selectedPlayer?.full || `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
      const target = propsMode === 'player' ? playerName : gamePropsTeam;
      console.log(`📊 Loaded ${data.data?.length || 0} bookmaker odds for ${target}`);
      
    } catch (error) {
      console.error('Error fetching odds:', error);
      setOddsError(error instanceof Error ? error.message : 'Failed to load odds');
      setRealOddsData([]);
    } finally {
      setOddsLoading(false);
    }
  };
  
  // Fetch odds when player/team or mode changes
  useEffect(() => {
    fetchOddsData();
  }, [selectedPlayer, selectedTeam, gamePropsTeam, propsMode]);

  const americanToDecimal = (odds: string): string => {
    if (odds === 'N/A') return 'N/A';
    const n = parseInt(odds.replace(/[^+\-\d]/g, ''), 10);
    if (isNaN(n)) return odds;
    const dec = n > 0 ? (1 + n / 100) : (1 + 100 / Math.abs(n));
    return dec.toFixed(2);
  };

  const fmtOdds = (odds: string): string => odds === 'N/A' ? 'N/A' : (oddsFormat === 'decimal' ? americanToDecimal(odds) : odds);

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
          overflow-y: scroll; /* Force scrollbar to always show */
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
 className={`relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 sm:gap-3 md:gap-4 overflow-y-auto overflow-x-hidden overscroll-contain px-0 pb-0 lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar ${
              sidebarOpen ? 'lg:flex-[6] xl:flex-[6.2]' : 'lg:flex-[6] xl:flex-[6]'
            }`}
            style={{
              scrollbarGutter: 'stable'
            }}
          >
            {/* 1. Filter By Container (Mobile First) */}
            <div className="lg:hidden bg-white dark:bg-slate-800 rounded-lg shadow-sm px-3 md:px-4 lg:px-6 pt-3 md:pt-4 pb-4 md:pb-5 border border-gray-200 dark:border-gray-700 relative overflow-visible">
              <div className="flex items-center justify-start mb-3">
                <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
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
                        Height: {playerInfo.height || "—"}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {playerInfo.teamName || "—"}
                      </div>
                    </div>
                  )}
                </div>

                {/* Dynamic Search - Player or Team based on props mode */}
                <div className="flex-1 mx-2 sm:mx-6 md:mx-8">
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
                                  <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                                  <div className="text-sm text-gray-500 dark:text-gray-400">
                                    {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
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
                              <div>
                                <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                  {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
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
                <div className="hidden lg:flex flex-shrink-0">
                  {propsMode === 'player' ? (
                    // Player Props Mode - Show player's team vs NEXT GAME opponent (not chart filter)
                    selectedTeam && nextGameOpponent && selectedTeam !== 'N/A' && nextGameOpponent !== '' ? (
                      <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-2 py-1 sm:px-4 sm:py-2 min-w-0">
                        {/* Player Team */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img 
                            src={selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)}
                            alt={selectedTeam}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              // Advance through ESPN candidates exactly once per team to avoid flicker
                              const candidates = getEspnLogoCandidates(selectedTeam);
                              const next = selectedTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setSelectedTeamLogoAttempt(next);
                                setSelectedTeamLogoUrl(candidates[next]);
                              } else {
                                // No more candidates; stop retrying
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate max-w-[60px] sm:max-w-none">{selectedTeam}</span>
                        </div>
                        
                        {/* VS */}
                        <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                        
                        {/* Next Game Opponent */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img 
                            src={getEspnLogoUrl(nextGameOpponent)}
                            alt={nextGameOpponent}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              // Advance through ESPN candidates exactly once per team to avoid flicker
                              const candidates = getEspnLogoCandidates(nextGameOpponent);
                              const next = opponentTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setOpponentTeamLogoAttempt(next);
                                e.currentTarget.src = candidates[next];
                              } else {
                                // No more candidates; stop retrying
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate max-w-[60px] sm:max-w-none">{nextGameOpponent}</span>
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
                      <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-2 py-1 sm:px-4 sm:py-2 min-w-0">
                        {/* Selected Team */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img 
                            src={selectedTeamLogoUrl || getEspnLogoUrl(gamePropsTeam)}
                            alt={gamePropsTeam}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              // Advance through ESPN candidates exactly once per team to avoid flicker
                              const candidates = getEspnLogoCandidates(gamePropsTeam);
                              const next = selectedTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setSelectedTeamLogoAttempt(next);
                                setSelectedTeamLogoUrl(candidates[next]);
                              } else {
                                // No more candidates; stop retrying
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate max-w-[60px] sm:max-w-none">{gamePropsTeam}</span>
                        </div>
                        
                        {/* VS */}
                        <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                        
                        {/* Opponent Team */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img 
                            src={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                            alt={opponentTeam}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              // Advance through ESPN candidates exactly once per team to avoid flicker
                              const candidates = getEspnLogoCandidates(opponentTeam);
                              const next = opponentTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setOpponentTeamLogoAttempt(next);
                                setOpponentTeamLogoUrl(candidates[next]);
                              } else {
                                // No more candidates; stop retrying
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
                                  <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                                  <div className="text-sm text-gray-500 dark:text-gray-400">
                                    {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
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
                        Height: {playerInfo.height || "—"}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {playerInfo.teamName || "—"}
                      </div>
                    </div>
                  )}
                </div>

                {/* Team vs Team Display - Mobile only - Aligned with height */}
                <div className="flex-shrink-0">
                  {propsMode === 'player' ? (
                    // Player Props Mode - Show player's team vs NEXT GAME opponent (not chart filter)
                    selectedTeam && nextGameOpponent && selectedTeam !== 'N/A' && nextGameOpponent !== '' ? (
                      <div className="flex items-center gap-1.5 sm:gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-2 py-1 sm:px-4 sm:py-2 min-w-0">
                        {/* Player Team */}
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-shrink">
                          <img 
                            src={selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)}
                            alt={selectedTeam}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              // Advance through ESPN candidates exactly once per team to avoid flicker
                              const candidates = getEspnLogoCandidates(selectedTeam);
                              const next = selectedTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setSelectedTeamLogoAttempt(next);
                                setSelectedTeamLogoUrl(candidates[next]);
                              } else {
                                // No more candidates; stop retrying
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate min-w-0">{selectedTeam}</span>
                        </div>
                        
                        {/* VS */}
                        <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                        
                        {/* Next Game Opponent */}
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                          <img 
                            src={getEspnLogoUrl(nextGameOpponent)}
                            alt={nextGameOpponent}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              // Advance through ESPN candidates exactly once per team to avoid flicker
                              const candidates = getEspnLogoCandidates(nextGameOpponent);
                              const next = opponentTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setOpponentTeamLogoAttempt(next);
                                e.currentTarget.src = candidates[next];
                              } else {
                                // No more candidates; stop retrying
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate min-w-0">{nextGameOpponent}</span>
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
                      <div className="flex items-center gap-1.5 sm:gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-2.5 py-1.5 sm:px-4 sm:py-2 min-w-0">
                        {/* Selected Team */}
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-shrink">
                          <img 
                            src={selectedTeamLogoUrl || getEspnLogoUrl(gamePropsTeam)}
                            alt={gamePropsTeam}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              // Advance through ESPN candidates exactly once per team to avoid flicker
                              const candidates = getEspnLogoCandidates(gamePropsTeam);
                              const next = selectedTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setSelectedTeamLogoAttempt(next);
                                setSelectedTeamLogoUrl(candidates[next]);
                              } else {
                                // No more candidates; stop retrying
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate min-w-0">{gamePropsTeam}</span>
                        </div>
                        
                        {/* VS */}
                        <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                        
                        {/* Opponent Team */}
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                          <img 
                            src={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                            alt={opponentTeam}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              // Advance through ESPN candidates exactly once per team to avoid flicker
                              const candidates = getEspnLogoCandidates(opponentTeam);
                              const next = opponentTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setOpponentTeamLogoAttempt(next);
                                setOpponentTeamLogoUrl(candidates[next]);
                              } else {
                                // No more candidates; stop retrying
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate min-w-0">{opponentTeam}</span>
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
              chartData={chartData}
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
              />

              {/* Section 2: Team Matchup with Pie Chart */}
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
                    let isDefensiveStat = false; // Track if this is a defensive stat (lower is better)
                    
                    switch (selectedComparison) {
                      case 'points':
                        // For defensive stats, invert: lower allowed = better, so invert the values
                        // Use max of 150 points allowed as baseline
                        const maxPoints = 150;
                        teamValue = maxPoints - (currentStats.pts || 0);
                        opponentValue = maxPoints - (opponentStats.pts || 0);
                        isDefensiveStat = true;
                        break;
                      case 'rebounds':
                        // Invert rebounds allowed: lower allowed = better
                        const maxRebounds = 60;
                        teamValue = maxRebounds - (currentStats.reb || 0);
                        opponentValue = maxRebounds - (opponentStats.reb || 0);
                        isDefensiveStat = true;
                        break;
                      case 'assists':
                        // Invert assists allowed: lower allowed = better
                        const maxAssists = 35;
                        teamValue = maxAssists - (currentStats.ast || 0);
                        opponentValue = maxAssists - (opponentStats.ast || 0);
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
                    
                    // Store original values for display (before inversion)
                    const originalTeamValue = isDefensiveStat 
                      ? (selectedComparison === 'points' ? (currentStats.pts || 0) :
                         selectedComparison === 'rebounds' ? (currentStats.reb || 0) :
                         (currentStats.ast || 0))
                      : teamValue;
                    const originalOpponentValue = isDefensiveStat
                      ? (selectedComparison === 'points' ? (opponentStats.pts || 0) :
                         selectedComparison === 'rebounds' ? (opponentStats.reb || 0) :
                         (opponentStats.ast || 0))
                      : opponentValue;
                    
                    console.log('📊 Team Matchup Pie Data:', {
                      comparison: selectedComparison,
                      teamValue,
                      opponentValue,
                      originalTeamValue,
                      originalOpponentValue,
                      currentTeam,
                      currentOpponent,
                      currentStats,
                      opponentStats
                    });

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
            </div>

            {/* 4.5 Shot Chart Container (Mobile) - Player Props mode only */}
            {propsMode === 'player' && (
              <div className="lg:hidden">
                <ShotChart isDark={isDark} shotData={shotDistanceData} />
              </div>
            )}

            {/* 5. Advanced Stats Container (Mobile) - Player Props mode only */}
            {propsMode === 'player' && (
              <div className="lg:hidden bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3 md:p-4 border border-gray-200 dark:border-gray-700" style={{ minHeight: '200px' }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Advanced Stats</h3>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">Current season stats</span>
                </div>
                {advancedStats ? (
                  <div className="space-y-3">
                    {/* Mobile: Single column layout with sections */}
                    
                    {/* Offensive Metrics */}
                    <div>
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Offensive</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
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
                      <div className="grid grid-cols-2 gap-2 text-xs">
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
                      <div className="grid grid-cols-2 gap-2 text-xs">
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
                  lineMovementData={mergedLineMovementData}
                  selectedStat={selectedStat}
                />
              </div>
            ), [isDark, derivedOdds, intradayMovements, selectedTeam, gamePropsTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds, mergedLineMovementData, selectedStat])}

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

            {/* 10. Player Box Score Container (Mobile) - Final container! */}
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

            {/* Under-chart container (Desktop) - memoized element to avoid parent re-evals */}
            {useMemo(() => (
<div className="hidden lg:block">
                <OfficialOddsCard
                isDark={isDark}
                derivedOdds={derivedOdds}
                intradayMovements={intradayMovements}
                selectedTeam={propsMode === 'team' ? gamePropsTeam : selectedTeam}
                opponentTeam={opponentTeam}
                selectedTeamLogoUrl={(propsMode === 'team' ? gamePropsTeam : selectedTeam) && (propsMode === 'team' ? gamePropsTeam : selectedTeam) !== 'N/A' ? (selectedTeamLogoUrl || getEspnLogoUrl(propsMode === 'team' ? gamePropsTeam : selectedTeam)) : ''}
                opponentTeamLogoUrl={opponentTeam && opponentTeam !== '' ? (opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)) : ''}
                matchupInfo={matchupInfo}
                oddsFormat={oddsFormat}
                books={realOddsData}
                fmtOdds={fmtOdds}
                lineMovementData={mergedLineMovementData}
                selectedStat={selectedStat}
              />
              </div>
            ), [isDark, derivedOdds, intradayMovements, selectedTeam, gamePropsTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds, mergedLineMovementData, selectedStat])}

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
 className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-0 fade-scrollbar custom-scrollbar ${
              sidebarOpen ? 'lg:flex-[3] xl:flex-[3.3]' : 'lg:flex-[4] xl:flex-[4]'
            }`}
          >

            {/* Filter By Container (Desktop - in right panel) */}
            <div className="hidden lg:block bg-white dark:bg-slate-800 rounded-lg shadow-sm px-3 pt-3 pb-4 border border-gray-200 dark:border-gray-700 relative overflow-visible">
              <div className="flex items-center justify-start mb-3">
                <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
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
                />

                {/* Section 2: Team Matchup with Pie Chart */}
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
                                    <div className="text-xs opacity-85">Rank: —</div>
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
                                    <div className="text-xs opacity-85">Rank: —</div>
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
                          let isDefensiveStat = false; // Track if this is a defensive stat (lower is better)
                          
                          switch (selectedComparison) {
                            case 'points':
                              // For defensive stats, invert: lower allowed = better, so invert the values
                              // Use max of 150 points allowed as baseline
                              const maxPoints = 150;
                              teamValue = maxPoints - (currentStats.pts || 0);
                              opponentValue = maxPoints - (opponentStats.pts || 0);
                              isDefensiveStat = true;
                              break;
                            case 'rebounds':
                              // Invert rebounds allowed: lower allowed = better
                              const maxRebounds = 60;
                              teamValue = maxRebounds - (currentStats.reb || 0);
                              opponentValue = maxRebounds - (opponentStats.reb || 0);
                              isDefensiveStat = true;
                              break;
                            case 'assists':
                              // Invert assists allowed: lower allowed = better
                              const maxAssists = 35;
                              teamValue = maxAssists - (currentStats.ast || 0);
                              opponentValue = maxAssists - (opponentStats.ast || 0);
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
                          
                          // Store original values for display (before inversion)
                          const originalTeamValue = isDefensiveStat 
                            ? (selectedComparison === 'points' ? (currentStats.pts || 0) :
                               selectedComparison === 'rebounds' ? (currentStats.reb || 0) :
                               (currentStats.ast || 0))
                            : teamValue;
                          const originalOpponentValue = isDefensiveStat
                            ? (selectedComparison === 'points' ? (opponentStats.pts || 0) :
                               selectedComparison === 'rebounds' ? (opponentStats.reb || 0) :
                               (opponentStats.ast || 0))
                            : opponentValue;

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
              </div>

            {/* Shot Chart (Desktop) - only in Player Props mode */}
            {propsMode === 'player' && (
              <div className="hidden lg:block">
                <ShotChart isDark={isDark} shotData={shotDistanceData} />
              </div>
            )}
            
            {/* Advanced Stats Container (Desktop) - only in Player Props mode, below Shot Chart */}
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
        
        <div className="grid grid-cols-4 h-16">
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
            className={`flex flex-col items-center justify-center gap-1 transition-colors relative ${
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