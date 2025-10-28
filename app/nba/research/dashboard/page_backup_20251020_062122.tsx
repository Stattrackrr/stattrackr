'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useMemo, useRef, useEffect, memo, useCallback } from 'react';
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

type MatchupInfo = { tipoffLocal?: string | null } | null;

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
  const m = now.getMonth();
  const d = now.getDate();
  
  // NBA season starts around October 15th
  // If we're in October and after the 15th, or any month after October, use current year
  // If we're before October 15th, use previous year
  if (m === 9 && d >= 15) { // October 15th or later
    return now.getFullYear();
  }
  
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
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
};

// ESPN filename exceptions for base 500/ path
// Note: ESPN uses 'no.png' (not 'nop.png') for New Orleans; 'uta.png' exists for Jazz
const ESPN_FILE_ABBR: Record<string, string> = {
  NOP: 'no',
  UTA: 'uta',
};

// Build ordered candidate URLs for ESPN logos for a team
const getEspnLogoCandidates = (abbr: string): string[] => {
  const normalized = normalizeAbbr(abbr || '');
  const baseFile = (ESPN_FILE_ABBR[normalized] || normalized.toLowerCase());
  const lc = normalized.toLowerCase();
  const candidates: string[] = [];
  // 1) Base 500 path with filename (works for most teams; includes 'no.png' and 'uta.png')
  candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/${baseFile}.png`);
  // 2) Scoreboard slug path for known exceptions (Pelicans, Jazz)
  const exceptionSlug = ESPN_LOGO_SLUG[normalized];
  if (exceptionSlug) {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${exceptionSlug}.png`);
  } else {
    // Generic scoreboard fallback using abbr (some teams have abbr scoreboard assets)
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${lc}.png`);
  }

  // Team-specific extra variants for ESPN inconsistencies
  if (normalized === 'UTA') {
    // Try abbr and names across both folders
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/uta.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/utah.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/jazz.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/utah.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/jazz.png`);
  }
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
const StaticLabelList = memo(function StaticLabelList({ isDark, formatChartLabel }: { isDark: boolean; formatChartLabel: (v: any) => string }) {
  return (
    <LabelList
      dataKey="value"
      position={CHART_CONFIG.labelList.position}
      style={{
        fontSize: CHART_CONFIG.labelList.fontSize,
        fontWeight: CHART_CONFIG.labelList.fontWeight,
        fill: isDark ? '#ffffff' : '#000000'
      }}
      formatter={formatChartLabel}
    />
  );
}, (prev, next) => prev.isDark === next.isDark && prev.formatChartLabel === next.formatChartLabel);

// Static bars chart - never re-renders for betting line changes
const StaticBarsChart = memo(function StaticBarsChart({
  data,
  yAxisConfig,
  isDark,
  bettingLine,
  customTooltip,
  formatChartLabel,
  selectedStat,
}: {
  data: any[];
  yAxisConfig: { domain: [number, number]; ticks: number[] };
  isDark: boolean;
  bettingLine: number;
  customTooltip: any;
  formatChartLabel: (v: any) => string;
  selectedStat: string;
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
  
  // Memoize axis styles to prevent recreating objects on every render
  const xAxisTickStyle = useMemo(() => ({ fill: isDark ? '#d1d5db' : '#374151', fontSize: 12 }), [isDark]);
  const yAxisTickStyle = useMemo(() => ({ fill: isDark ? '#d1d5db' : '#374151', fontSize: 12 }), [isDark]);
  const xAxisLineStyle = useMemo(() => ({ stroke: isDark ? '#4b5563' : '#d1d5db' }), [isDark]);
  const yAxisLineStyle = useMemo(() => ({ stroke: isDark ? '#4b5563' : '#d1d5db' }), [isDark]);
  
  return (
    <ResponsiveContainer 
      width="100%" 
      height="100%" 
      debounceMs={CHART_CONFIG.performance.debounceMs}
    >
      <BarChart 
        data={data} 
        margin={CHART_CONFIG.margin}
        syncMethod="value"
        maxBarSize={data.length <= 5 ? 250 : data.length <= 10 ? 250 : CHART_CONFIG.performance.maxBarSize}
        barCategoryGap={data.length <= 5 ? '4%' : data.length <= 10 ? '6%' : '9%'}
        barGap={selectedStat === 'fg3m' ? -40 : 4}
      >
        <XAxis
          dataKey="xKey"
          tickFormatter={(_, i) => data[i]?.tickLabel ?? ""}
          tick={xAxisTickStyle}
          axisLine={xAxisLineStyle}
          height={CHART_CONFIG.xAxis.height}
          interval={CHART_CONFIG.xAxis.interval}
          allowDuplicatedCategory={CHART_CONFIG.xAxis.allowDuplicatedCategory}
        />
        <YAxis 
          domain={yAxisConfig.domain}
          ticks={yAxisConfig.ticks}
          tick={yAxisTickStyle}
          axisLine={yAxisLineStyle}
        />
        <Tooltip 
          isAnimationActive={false} 
          content={customTooltip}
          animationDuration={0}
          wrapperStyle={{ zIndex: 9999 }}
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
              style={{ 
                transition: 'all 0.3s ease'
              }}
            />
          ))}
          {!['fg3m', 'moneyline', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat) && <StaticLabelList isDark={isDark} formatChartLabel={formatChartLabel} />}
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
}: {
  yAxisConfig: { domain: [number, number]; ticks: number[] };
  isDark: boolean;
  bettingLine: number;
  dataLength: number;
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
  
  return (
    <ResponsiveContainer 
      width="100%" 
      height="100%"
    >
      <BarChart 
        data={dummyData} // Dummy data to maintain coordinate system
        margin={CHART_CONFIG.margin} // Same margins as static chart
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
        <Bar 
          dataKey="value" 
          fill="transparent" 
          isAnimationActive={false}
        />
        {/* No ReferenceLine - using CSS overlay instead */}
      </BarChart>
    </ResponsiveContainer>
  );
});

// Static betting line overlay (never re-renders, updated via DOM)
const StaticBettingLineOverlay = memo(function StaticBettingLineOverlay({ isDark }: { isDark: boolean }) {
  const lineColor = isDark ? '#ffffff' : '#000000';
  
  return (
    <div 
      id="betting-line-container"
      className="absolute pointer-events-none"
      style={{
        left: CHART_CONFIG.margin.left + 60, // Move significantly in from left edge to align with bars
        right: CHART_CONFIG.margin.right + 10, // Bring in from right edge
        top: CHART_CONFIG.margin.top,
        bottom: CHART_CONFIG.margin.bottom + 30, // Account for X-axis height
        zIndex: 0 // Very low z-index so tooltips appear above the line
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
  const lineElement = document.getElementById('betting-line-fast');
  
  if (!lineElement || !yAxisConfig?.domain) return;
  
  const [minY, maxY] = yAxisConfig.domain;
  const range = maxY - minY;
  
  // Calculate position percentage (0 = bottom, 100 = top)
  const clampedLine = Math.max(minY, Math.min(bettingLine, maxY));
  const percentage = range > 0 ? ((clampedLine - minY) / range) * 100 : 50;
  
  // Instant DOM update
  lineElement.style.bottom = `${percentage}%`;
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
}: {
  data: any[];
  yAxisConfig: { domain: [number, number]; ticks: number[] };
  isDark: boolean;
  bettingLine: number;
  customTooltip: any;
  formatChartLabel: (v: any) => string;
  selectedStat: string;
}) {
  // Setup direct input listeners for instant betting line updates (bypasses React)
  useEffect(() => {
    const inputElement = document.getElementById('betting-line-input') as HTMLInputElement;
    if (!inputElement) return;
    
    const handleInputChange = () => {
      const value = parseFloat(inputElement.value) || 0;
      updateBettingLinePosition(yAxisConfig, value);
      
      // Update over rate in real-time (handle spread logic)
      const overCount = selectedStat === 'spread' 
        ? data.filter(d => d.value < value).length  // For spread: lower values are better
        : data.filter(d => d.value > value).length; // For other stats: higher values are better
      const total = data.length;
      const pct = total > 0 ? (overCount / total) * 100 : 0;
      
      const overRateElement = document.querySelector('[data-over-rate]');
      if (overRateElement) {
        overRateElement.textContent = overCount + '/' + total + ' (' + pct.toFixed(1) + '%)';
        
        // Update over rate pill color
        overRateElement.className = overRateElement.className.replace(
          /bg-(green|yellow|red)-(100|900)/g, 
          pct >= 60 ? 'bg-green-100' : pct >= 40 ? 'bg-yellow-100' : 'bg-red-100'
        ).replace(
          /text-(green|yellow|red)-(800|200)/g,
          pct >= 60 ? 'text-green-800' : pct >= 40 ? 'text-yellow-800' : 'text-red-800'
        ).replace(
          /dark:bg-(green|yellow|red)-(100|900)/g,
          pct >= 60 ? 'dark:bg-green-900' : pct >= 40 ? 'dark:bg-yellow-900' : 'dark:bg-red-900'
        ).replace(
          /dark:text-(green|yellow|red)-(800|200)/g,
          pct >= 60 ? 'dark:text-green-200' : pct >= 40 ? 'dark:text-yellow-200' : 'dark:text-red-200'
        );
      }
      
      // Update bar colors and glow effects in real-time (handle spread logic)
      const allBarRects = document.querySelectorAll('.recharts-bar .recharts-rectangle');
      allBarRects.forEach((rectElement: any, index) => {
        if (data[index]) {
          const barValue = data[index].value;
          let isOver, isPush;
          
          if (selectedStat === 'spread') {
            // For spread: lower values are better (covered spread)
            isOver = barValue < value;
            isPush = barValue === value;
          } else {
            // For other stats: higher values are better
            isOver = barValue > value;
            isPush = barValue === value;
          }
          
          const newColor = isOver ? CHART_CONFIG.colors.green : isPush ? '#9ca3af' : CHART_CONFIG.colors.red;
          rectElement.setAttribute('fill', newColor);
          
          // Remove any existing filters/glows
          rectElement.style.filter = 'none';
          
          // Add smooth transition
          rectElement.style.transition = 'all 0.3s ease';
        }
      });
    };
    
    // Remove existing listeners
    inputElement.removeEventListener('input', handleInputChange);
    inputElement.removeEventListener('change', handleInputChange);
    
    // Add instant listeners
    inputElement.addEventListener('input', handleInputChange);
    inputElement.addEventListener('change', handleInputChange);
    
    // Initial position and value
    updateBettingLinePosition(yAxisConfig, bettingLine);
    inputElement.value = bettingLine.toString(); // Update input value when stat changes
    
    return () => {
      inputElement.removeEventListener('input', handleInputChange);
      inputElement.removeEventListener('change', handleInputChange);
    };
  }, [yAxisConfig, data, selectedStat, bettingLine]); // Update when axis, data, selectedStat, or bettingLine changes
  
  return (
    <div className="relative w-full h-full">
      {/* Static bars layer */}
      <StaticBarsChart
        data={data}
        yAxisConfig={yAxisConfig}
        isDark={isDark}
        bettingLine={bettingLine}
        customTooltip={customTooltip}
        formatChartLabel={formatChartLabel}
        selectedStat={selectedStat}
      />
      {/* Hidden coordinate system chart */}
      <div className="absolute inset-0 pointer-events-none opacity-0">
        <DynamicReferenceLineChart
          yAxisConfig={yAxisConfig}
          isDark={isDark}
          bettingLine={bettingLine}
          dataLength={data.length}
        />
      </div>
      {/* Static betting line overlay (updated via DOM) */}
      <StaticBettingLineOverlay isDark={isDark} />
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
  console.log(`\n🔍 === OPPONENT DETECTION START ===`);
  console.log(`🔍 Looking for opponent for team: "${currentTeam}"`);
  console.log(`🔍 Available games: ${todaysGames.length}`);
  
  if (!currentTeam || currentTeam === 'N/A' || !todaysGames.length) {
    console.log(`⏸️ Early return - currentTeam: "${currentTeam}", games: ${todaysGames.length}`);
    return '';
  }
  
  // Show first few games for debugging
  console.log(`🔍 First few games:`);
  for (let i = 0; i < Math.min(3, todaysGames.length); i++) {
    const game = todaysGames[i];
    console.log(`   ${i + 1}. ${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation} (${game.date})`);
  }
  
  let matchingGames = [];
  
  for (const game of todaysGames) {
    const homeTeam = game.home_team?.abbreviation;
    const visitorTeam = game.visitor_team?.abbreviation;
    
    if (homeTeam === currentTeam || visitorTeam === currentTeam) {
      matchingGames.push({ homeTeam, visitorTeam, date: game.date });
      console.log(`🎯 MATCH FOUND: ${homeTeam} vs ${visitorTeam} on ${game.date}`);
      
      if (homeTeam === currentTeam && visitorTeam) {
        console.log(`✅ Opponent found: "${visitorTeam}" (${currentTeam} is home)`);
        console.log(`🔍 === OPPONENT DETECTION END ===\n`);
        return visitorTeam;
      }
      if (visitorTeam === currentTeam && homeTeam) {
        console.log(`✅ Opponent found: "${homeTeam}" (${currentTeam} is away)`);
        console.log(`🔍 === OPPONENT DETECTION END ===\n`);
        return homeTeam;
      }
    }
  }
  
  console.log(`❌ No opponent found for "${currentTeam}" in ${todaysGames.length} games`);
  console.log(`🔍 Matching games found: ${matchingGames.length}`);
  if (matchingGames.length > 0) {
    console.log(`🔍 Matching games:`, matchingGames);
  }
  console.log(`🔍 === OPPONENT DETECTION END ===\n`);
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
  margin: { top: 30, right: 20, left: 10, bottom: 30 },
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
  bar: {
    radius: [10, 10, 0, 0] as [number, number, number, number]
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
  backgroundColor: isDarkMode ? '#4b5563' : '#6b7280', // match chart hover bg
  color: '#FFFFFF',
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

  // Filter to current season and limit to 50 most recent games
  const currentSeason = currentNbaSeason();
  const currentSeasonGames = playerStats.filter(game => {
    if (!game.game?.date) return false;
    const gameDate = new Date(game.game.date);
    const gameYear = gameDate.getFullYear();
    const gameMonth = gameDate.getMonth();
    
    // NBA season spans two calendar years (e.g., 2024-25 season)
    // Games from Oct-Dec are from the season year, games from Jan-Apr are from season year + 1
    const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
    return gameSeasonYear === currentSeason;
  }).slice(0, 50); // Limit to 50 most recent games
  
  // Pagination logic
  const totalGames = currentSeasonGames.length;
  const totalPages = Math.ceil(totalGames / gamesPerPage);
  const startIndex = currentPage * gamesPerPage;
  const endIndex = Math.min(startIndex + gamesPerPage, totalGames);
  const currentGames = currentSeasonGames.slice(startIndex, endIndex);
  
  const canGoPrevious = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Game Log</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Games {startIndex + 1}-{endIndex} of {totalGames}
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
  prev.customTooltip === next.customTooltip
));

// Per-button memoized components to prevent unrelated re-renders
const StatPill = memo(function StatPill({ label, value, isSelected, onSelect, isDark }: { label: string; value: string; isSelected: boolean; onSelect: (v: string) => void; isDark: boolean }) {
  const onClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <button
      onClick={onClick}
      className={`px-2 sm:px-3 md:px-4 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
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
          className="w-24 px-2 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
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
          <div className="absolute top-full left-0 mt-1 w-24 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto custom-scrollbar">
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
}: any) {
  // Dropdown state for timeframe selector (moved outside useMemo to follow hooks rules)
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  
  // Update over rate when chartData or bettingLine changes (timeframe/stat switches)
  useEffect(() => {
    const overCount = selectedStat === 'spread' 
      ? chartData.filter(d => d.value < bettingLine).length  // For spread: lower values are better
      : chartData.filter(d => d.value > bettingLine).length; // For other stats: higher values are better
    const total = chartData.length;
    const pct = total > 0 ? (overCount / total) * 100 : 0;
    
    const overRateElement = document.querySelector('[data-over-rate]');
    if (overRateElement) {
      overRateElement.textContent = overCount + '/' + total + ' (' + pct.toFixed(1) + '%)';
      
      // Update over rate pill color
      overRateElement.className = overRateElement.className.replace(
        /bg-(green|yellow|red)-(100|900)/g, 
        pct >= 60 ? 'bg-green-100' : pct >= 40 ? 'bg-yellow-100' : 'bg-red-100'
      ).replace(
        /text-(green|yellow|red)-(800|200)/g,
        pct >= 60 ? 'text-green-800' : pct >= 40 ? 'text-yellow-800' : 'text-red-800'
      ).replace(
        /dark:bg-(green|yellow|red)-(100|900)/g,
        pct >= 60 ? 'dark:bg-green-900' : pct >= 40 ? 'dark:bg-yellow-900' : 'dark:bg-red-900'
      ).replace(
        /dark:text-(green|yellow|red)-(800|200)/g,
        pct >= 60 ? 'dark:text-green-200' : pct >= 40 ? 'dark:text-yellow-200' : 'dark:text-red-200'
      );
    }
  }, [chartData, bettingLine, selectedStat]); // Update when chartData, bettingLine, or selectedStat changes
    const StatPills = useMemo(() => (
      <div className="mb-2 sm:mb-3 md:mb-4">
        <div
          className="w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x"
          style={{ scrollbarWidth: 'thin', scrollbarColor: isDark ? '#4b5563 transparent' : '#d1d5db transparent' }}
        >
          <div className="inline-flex flex-nowrap gap-1 sm:gap-1.5 md:gap-2 pb-1">
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
              className="w-20 sm:w-24 md:w-28 lg:w-32 px-1.5 sm:px-2 md:px-3 py-1.5 sm:py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-xs sm:text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              <span className="truncate">{selectedOption?.label || 'Timeframe'}</span>
              <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {/* Dropdown Menu */}
            {isTimeframeDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-20 sm:w-24 md:w-28 lg:w-32 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
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

    return (
      <>
        {StatPills}
        {/* Responsive controls layout */}
        <div className="space-y-2 sm:space-y-3 md:space-y-4 mb-2 sm:mb-3 md:mb-4 lg:mb-6">
          {/* Top row: Line input and Over Rate - Always visible */}
          <div className="flex items-center justify-between flex-wrap gap-1 sm:gap-2 md:gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <label className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Line:</label>
              <input
                id="betting-line-input"
                type="number" 
                step="0.5" 
                {...((['spread', 'moneyline'].includes(selectedStat)) ? {} : { min: "0" })}
                key={selectedStat} // Force re-render when stat changes
                defaultValue={bettingLine}
                onBlur={(e) => onChangeBettingLine(parseFloat(e.target.value) || 0)} // Update React state on blur for over rate calculation
                className="w-14 sm:w-16 md:w-18 lg:w-20 px-1.5 sm:px-2 md:px-3 py-1 sm:py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-xs sm:text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">Over Rate:</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 sm:hidden">Rate:</span>
              <OverRatePill 
                overCount={chartData.filter(d => d.value > bettingLine).length} 
                total={chartData.length} 
                isDark={isDark} 
              />
            </div>
          </div>
          
          {/* Bottom row: Opponent selector and Timeframe controls */}
          <div className="flex items-center justify-between flex-wrap gap-1 sm:gap-2 md:gap-3 lg:gap-4">
            {/* Opponent selector */}
            <OpponentSelector
              currentOpponent={currentOpponent}
              manualOpponent={manualOpponent}
              onOpponentChange={onOpponentChange}
              isDark={isDark}
              propsMode={propsMode}
              currentTeam={currentTeam}
              selectedTimeframe={selectedTimeframe}
            />
            {/* Timeframe controls */}
            <div className="flex-shrink-0">
              {TimeframeButtons}
            </div>
          </div>
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
}: any) {
  return (
    <div 
      className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-2 sm:p-3 md:p-4 lg:p-6 border border-gray-200 dark:border-gray-700 h-[400px] sm:h-[450px] md:h-[500px] lg:h-[600px] flex flex-col min-w-0 flex-shrink-0"
      style={{ outline: 'none' }}
      onFocus={(e) => e.target.blur()}
      tabIndex={-1}
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
      />
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
        />
      </div>
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
}: OfficialOddsCardProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full min-h-[120px] flex-shrink-0">
      <div className="grid items-baseline mb-2" style={{ gridTemplateColumns: '1.2fr 1.8fr 1.2fr' }}>
        <div className="text-sm text-white font-semibold justify-self-start">Official Odds</div>
        <div className="text-sm text-white font-semibold justify-self-start text-left ml-3 sm:ml-5">Line Movement</div>
        <div className="text-sm text-white font-semibold justify-self-start text-left ml-7">Matchup Odds</div>
      </div>
      <div className="grid gap-10 sm:gap-12 items-start text-sm" style={{ gridTemplateColumns: '1.2fr 1.8fr 1.2fr' }}>
        {/* Left column: stacked Opening/Current */}
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-gray-700 dark:text-gray-200">Opening Line:</span>
            <span className="text-gray-900 dark:text-white">{derivedOdds.openingLine != null ? derivedOdds.openingLine.toFixed(1) : 'N/A'}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-gray-700 dark:text-gray-200">Current Line:</span>
            <span className="text-gray-900 dark:text-white">{derivedOdds.currentLine != null ? derivedOdds.currentLine.toFixed(1) : 'N/A'}</span>
          </div>
        </div>
        {/* Middle column: movement list under centered title */}
        <div className="col-start-2 w-full">
          <div className="space-y-1.5 max-h-28 overflow-y-auto custom-scrollbar pr-0">
            {intradayMovements.length === 0 ? (
              <div className={isDark ? 'text-slate-400 text-xs' : 'text-slate-500 text-xs'}>No moves yet</div>
            ) : (
              intradayMovements.map((m: any) => (
                <div key={m.ts} className="grid grid-cols-[128px_auto_auto] gap-3 items-center text-xs">
                  <span className={'text-white font-mono'}>{m.timeLabel}</span>
                  <span className={
                    (m.direction === 'up'
                      ? (isDark ? 'text-green-400' : 'text-green-600')
                      : m.direction === 'down'
                      ? (isDark ? 'text-red-400' : 'text-red-600')
                      : 'text-white') + ' font-mono font-bold justify-self-end'
                  }>
                    {m.line.toFixed(1)} {m.direction === 'up' ? '↗' : m.direction === 'down' ? '↘' : '—'}
                  </span>
                  <span className={'text-white text-[10px] font-mono justify-self-end'}>{m.change}</span>
                </div>
              ))
            )}
          </div>
        </div>
        {/* Right column: matchup odds and tipoff */}
        <div className="col-start-3">
          <div className="flex items-center gap-1 mb-1">
            <img src={selectedTeamLogoUrl} alt={selectedTeam} className="w-5 h-5 object-contain" />
            <span className={(isDark ? 'text-slate-200' : 'text-slate-800') + ' text-sm font-bold'}>{selectedTeam || 'TBD'}</span>
            <span className={'text-white text-xs'}>vs</span>
            <span className={(isDark ? 'text-slate-200' : 'text-slate-800') + ' text-sm font-bold'}>{opponentTeam || 'TBD'}</span>
            <img src={opponentTeamLogoUrl} alt={opponentTeam} className="w-5 h-5 object-contain" />
          </div>
          <div className={'text-white text-xs mb-1'}>
            Tipoff: {matchupInfo?.tipoffLocal || 'N/A'}
          </div>
          {(() => {
            const fd = (books || []).find(b => b.name.toLowerCase() === 'fanduel');
            if (!fd) {
              return (
                <div className="grid gap-x-4 gap-y-1 text-xs" style={{ gridTemplateColumns: 'max-content 1fr' }}>
                  <div className={isDark ? 'text-slate-300' : 'text-slate-600'}>Moneyline</div>
                  <div className={(isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>N/A</div>
                  <div className={isDark ? 'text-slate-300' : 'text-slate-600'}>Spread</div>
                  <div className={(isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>N/A</div>
                  <div className={isDark ? 'text-slate-300' : 'text-slate-600'}>Total</div>
                  <div className={(isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>N/A</div>
                </div>
              );
            }

            const displayHalfLine = (s: string) => {
              const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
              if (Number.isNaN(v)) return s;
              const frac = Math.abs(v * 10) % 10;
              if (frac === 0) {
                // Allow negative spreads - subtract 0.5 from all values
                const adj = v - 0.5;
                return adj.toFixed(1);
              }
              return Number.isFinite(v) ? v.toFixed(1) : s;
            };

            return (
              <div className="grid gap-x-4 gap-y-1 text-xs" style={{ gridTemplateColumns: 'max-content 1fr' }}>
                <div className={isDark ? 'text-slate-300' : 'text-slate-600'}>Moneyline</div>
                <div className={(isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>
                  <div className="space-y-0.5">
                    <div>
                      {(selectedTeam || 'HOME')}: <span className="font-semibold">{fmtOdds(fd.H2H.home)}</span> <span className="opacity-80">@ FanDuel</span>
                    </div>
                    <div className="opacity-90">
                      {(opponentTeam || 'AWAY')}: <span className="font-semibold">{fmtOdds(fd.H2H.away)}</span> <span className="opacity-80">@ FanDuel</span>
                    </div>
                  </div>
                </div>

                <div className={isDark ? 'text-slate-300' : 'text-slate-600'}>Spread</div>
                <div className={(isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>
                  <div className="space-y-0.5">
                    <div>O {displayHalfLine(fd.Spread.line)} (<span className="font-semibold">{fmtOdds(fd.Spread.over)}</span>) <span className="opacity-80">@ FanDuel</span></div>
                    <div>U {displayHalfLine(fd.Spread.line)} (<span className="font-semibold">{fmtOdds(fd.Spread.under)}</span>) <span className="opacity-80">@ FanDuel</span></div>
                  </div>
                </div>

                <div className={isDark ? 'text-slate-300' : 'text-slate-600'}>Total</div>
                <div className={(isDark ? 'text-slate-300' : 'text-slate-600') + ' font-mono'}>
                  <div className="space-y-0.5">
                    <div>O {displayHalfLine(fd.Total.line)} (<span className="font-semibold">{fmtOdds(fd.Total.over)}</span>) <span className="opacity-80">@ FanDuel</span></div>
                    <div>U {displayHalfLine(fd.Total.line)} (<span className="font-semibold">{fmtOdds(fd.Total.under)}</span>) <span className="opacity-80">@ FanDuel</span></div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      {(derivedOdds.openingLine == null && derivedOdds.currentLine == null) && (
        <div className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">Awaiting odds data...</div>
      )}
    </div>
  );
}, (prev, next) => {
  // Re-render only if odds snapshots-derived data, team logos/names, or theme changes
  return (
    prev.isDark === next.isDark &&
    prev.derivedOdds === next.derivedOdds && // reference stable via useMemo
    prev.intradayMovements === next.intradayMovements && // reference stable via useMemo
    prev.selectedTeam === next.selectedTeam &&
    prev.opponentTeam === next.opponentTeam &&
    prev.selectedTeamLogoUrl === next.selectedTeamLogoUrl &&
    prev.opponentTeamLogoUrl === next.opponentTeamLogoUrl &&
    prev.matchupInfo?.tipoffLocal === next.matchupInfo?.tipoffLocal &&
    prev.oddsFormat === next.oddsFormat &&
    prev.books === next.books
  );
});

// Opponent Analysis (isolated, memoized)
const OpponentAnalysisCard = memo(function OpponentAnalysisCard({ isDark, opponentTeam, selectedTimeFilter }: { isDark: boolean; opponentTeam: string; selectedTimeFilter: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Opponent Analysis</h3>
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isDark ? "bg-cyan-400" : "bg-cyan-500"} animate-pulse`} />
            <h4 className={`text-sm font-semibold font-mono tracking-wider ${isDark ? "text-white" : "text-slate-900"}`}>
              OPPONENT BREAKDOWN
            </h4>
            <span className={`text-xs font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {selectedTimeFilter.toUpperCase()}
            </span>
          </div>
          
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
            <div className="space-y-2">
              <div className={`text-xs font-mono font-bold uppercase tracking-wider`}>
                <span className={`${isDark ? "text-green-400" : "text-green-600"}`}>{opponentTeam || 'TBD'}</span>
                <span className={`${isDark ? "text-slate-400" : "text-slate-500"}`}> DEFENSIVE RANKS</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>PTS ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'ptsAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'ptsAllowed'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>REB ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'rebAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'rebAllowed'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>AST ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'astAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'astAllowed'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>FGM ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'fgmAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'fgmAllowed'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>FGA ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'fgaAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'fgaAllowed'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>3PM ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'fg3mAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'fg3mAllowed'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>3PA ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'fg3aAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'fg3aAllowed'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>STL ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'stlAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'stlAllowed'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isDark ? "text-white" : "text-black"}`}>BLK ALLOWED</span>
                  <span className={`text-sm font-bold ${!opponentTeam || !opponentDefensiveStats[opponentTeam] ? isDark ? "text-slate-400" : "text-slate-500" : getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, 'blkAllowed'))}`}>
                    {!opponentTeam || !opponentDefensiveStats[opponentTeam] ? 'TBD' : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, 'blkAllowed'))}
                  </span>
                </div>
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

function NBADashboardContent() {
  const router = useRouter();
  const searchParamsHook = useSearchParams();
  const { isDark } = useTheme();

  const [propsMode, setPropsMode] = useState<'player' | 'team'>('player');
  const [selectedStat, setSelectedStat] = useState('pts');
  
  // Ensure correct default stat is set when propsMode changes
  useEffect(() => {
    if (propsMode === 'player') {
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
  }, [propsMode]);
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


  // Odds display format
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('oddsFormat') : null;
      if (saved === 'decimal' || saved === 'american') setOddsFormat(saved as any);
    } catch {}
  }, []);

  const derivedOdds = useMemo(() => {
    const filtered = filterByMarket(oddsSnapshots, marketKey);
    return deriveOpeningCurrentMovement(filtered);
  }, [oddsSnapshots, marketKey]);

  // Build intraday movement rows from snapshots (sorted oldest -> newest)
  const intradayMovements = useMemo(() => {
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
      const timeLabel = dt.toLocaleString('en-US', {
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
  }, [oddsSnapshots, marketKey]);


  // When wiring the real Odds API, populate oddsSnapshots here with live data.
  // Example:
  // useEffect(() => {
  //   fetch('/api/odds?...').then(res => res.json()).then((payload) => {
  //     const snapshots: OddsSnapshot[] = adaptPayloadToSnapshots(payload);
  //     setOddsSnapshots(snapshots);
  //   });
  // }, [marketKey]);

  // search state
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<BdlSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

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
  
  // Opponent team state
  const [opponentTeam, setOpponentTeam] = useState<string>('N/A');
  
  // Manual opponent selector (overrides automatic opponent detection)
  const [manualOpponent, setManualOpponent] = useState<string>('ALL');
  
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
  const [playerTeamRoster, setPlayerTeamRoster] = useState<any[]>([]);
  const [opponentTeamRoster, setOpponentTeamRoster] = useState<any[]>([]);
  const [rostersLoading, setRostersLoading] = useState<{player: boolean, opponent: boolean}>({player: false, opponent: false});

  // Logo URLs (stateful to avoid onError flicker loops)
  const [selectedTeamLogoUrl, setSelectedTeamLogoUrl] = useState<string>('');
  const [opponentTeamLogoUrl, setOpponentTeamLogoUrl] = useState<string>('');
  const [selectedTeamLogoAttempt, setSelectedTeamLogoAttempt] = useState<number>(0);
  const [opponentTeamLogoAttempt, setOpponentTeamLogoAttempt] = useState<number>(0);
  
  // Games state
  const [todaysGames, setTodaysGames] = useState<any[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  
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
      const iso = String(game?.date || '');
      const dt = iso ? new Date(iso) : null;
      const tipoffLocal = dt
        ? new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
          }).format(dt)
        : null;
      const homeAbbr = normalizeAbbr(game?.home_team?.abbreviation || '');
      const awayAbbr = normalizeAbbr(game?.visitor_team?.abbreviation || '');
      const isSelectedHome = teamA === homeAbbr;
      return { tipoffLocal, homeAbbr, awayAbbr, isSelectedHome };
    } catch {
      return null;
    }
  }, [selectedTeam, opponentTeam, todaysGames]);
  
  // Time filter for opponent breakdown display
  const [selectedTimeFilter] = useState('last10'); // Using existing selectedTimeframe as reference
  
  // Team comparison metric selector
  const [selectedComparison, setSelectedComparison] = useState<'offense_defense' | 'net_rating' | 'pace' | 'rebound_pct'>('offense_defense');
  
  // Pie chart display order (only affects visual display, not underlying data)
  const [pieChartSwapped, setPieChartSwapped] = useState(false);


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
      
      // Back to seasons[] parameter since dates[] isn't working better
      console.log(`📅 Using seasons[] parameter for team ${teamAbbr} (ID: ${teamId})`);
      
      // Fetch from multiple seasons: current (2024-25), last (2023-24), and prior (2022-23)
      const targetSeasons = ['2024', '2023', '2022']; // 2024-25, 2023-24, 2022-23 seasons
      
      // Fetch games from multiple seasons
      const fetchAllGames = async () => {
        console.log(`⚡ Fetching data from ${targetSeasons.length} seasons: ${targetSeasons.join(', ')}`);
        
        let allGames: any[] = [];
        let gameMap = new Map();
        
        // Fetch each season sequentially
        for (const season of targetSeasons) {
          console.log(`📅 Fetching season ${season}...`);
          let hasMore = true;
          let cursor = null;
          let pageNum = 1;
          let seasonGames = 0;
          
          while (hasMore && pageNum <= 20) {
            let url = `/api/bdl/games?seasons[]=${season}&per_page=100`;
            if (cursor) {
              url += `&cursor=${cursor}`;
            }
            
            try {
              const response = await fetch(url);
              const data = await response.json();
              
              if (data?.data?.length > 0) {
                let newGames = 0;
                data.data.forEach((game: any) => {
                  if (game.id && !gameMap.has(game.id)) {
                    gameMap.set(game.id, game);
                    newGames++;
                    seasonGames++;
                  }
                });
                
                cursor = data.meta?.next_cursor;
                if (cursor && newGames > 0) {
                  pageNum++;
                } else {
                  console.log(`📅 Season ${season}: ${seasonGames} games`);
                  hasMore = false;
                }
              } else {
                hasMore = false;
              }
            } catch (error) {
              console.error(`Error fetching season ${season}:`, error);
              hasMore = false;
            }
          }
        }
        
        allGames = Array.from(gameMap.values());
        console.log(`⚡ Total games across all seasons: ${allGames.length}`);
        return { data: allGames, meta: {} };
      };
      
      const seasonData = await fetchAllGames();
      
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
        const preseasonGames = games.filter(g => {
          const date = g.date;
          return date && date.startsWith('2024-10') && parseInt(date.split('-')[2]) < 15;
        });
        
        const playoffGames = games.filter(g => {
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

  // Fetch games function
  const fetchTodaysGames = async () => {
    try {
      setGamesLoading(true);
      
      const formatDate = (date: Date) => {
        return date.toISOString().split('T')[0];
      };
      
      // Use seasons parameter as recommended by BallDontLie support
      // Try current and next season to find games
      const currentSeason = '2024'; // 2024-25 season
      const nextSeason = '2025';    // 2025-26 season (if needed)
      
      const seasons = [currentSeason, nextSeason];
      
      for (const season of seasons) {
        console.log(`🔍 Trying to fetch games for season ${season}`);
        
        try {
          const response = await fetch(`/api/bdl/games?seasons[]=${season}&per_page=100`);
          const data = await response.json();
          
          if (data?.data?.length > 0) {
            console.log(`✅ Found ${data.data.length} games for season ${season}`);
            
            // Filter for today's games or upcoming games
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            
            let relevantGames = data.data.filter((game: any) => {
              const gameDate = game.date;
              if (!gameDate) return false;
              
              // Include games from today and near future (next 7 days)
              const gameDateObj = new Date(gameDate);
              const daysDiff = (gameDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
              
              return daysDiff >= -1 && daysDiff <= 7; // Yesterday to next week
            });
            
            if (relevantGames.length > 0) {
              console.log(`✅ Found ${relevantGames.length} relevant games for season ${season}`);
              setTodaysGames(relevantGames);
              return; // Success, exit the loop
            }
          } else {
            console.log(`❌ No games found for season ${season}`);
          }
        } catch (seasonError) {
          console.error(`Error fetching games for season ${season}:`, seasonError);
        }
      }
      
      console.log('❌ No games found in any season');
      setTodaysGames([]);
      
    } catch (error) {
      console.error('Error in fetchTodaysGames:', error);
      setTodaysGames([]);
    } finally {
      setGamesLoading(false);
    }
  };

  // Update opponent when games or selected team changes
  useEffect(() => {
    // If manual opponent is set and not ALL, use that instead of automatic detection
    if (manualOpponent && manualOpponent !== '' && manualOpponent !== 'ALL') {
      console.log(`🎯 Using manual opponent: ${manualOpponent}`);
      setOpponentTeam(normalizeAbbr(manualOpponent));
      return;
    }
    
    // Otherwise, use automatic opponent detection
    const teamToCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    if (teamToCheck && teamToCheck !== 'N/A' && todaysGames.length > 0) {
      const opponent = getOpponentTeam(teamToCheck, todaysGames);
      console.log(`🎯 Setting opponent team: ${opponent} for ${propsMode} team: ${teamToCheck}`);
      setOpponentTeam(normalizeAbbr(opponent));
    } else {
      console.log(`⏸️ Not updating opponent - ${propsMode} team: ${teamToCheck}, games: ${todaysGames.length}`);
      if (propsMode === 'team' && (!gamePropsTeam || gamePropsTeam === 'N/A')) {
        setOpponentTeam('');
      }
    }
  }, [selectedTeam, gamePropsTeam, todaysGames, propsMode, manualOpponent]);

  // Auto-handle opponent selection when switching to H2H (less aggressive)
  useEffect(() => {
    if (selectedTimeframe === 'h2h') {
      // When switching to H2H, only clear manual opponent if it's currently ALL
      if (manualOpponent === 'ALL') {
        setManualOpponent('');
      }
    }
    // Don't auto-switch away from manual selections when leaving H2H
  }, [selectedTimeframe, manualOpponent]);

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
        setPlayerTeamRoster(playerRoster || []);
        setRostersLoading(prev => ({ ...prev, player: false }));
      }
      
      // Fetch opponent team roster if available
      if (oppTeam && oppTeam !== 'N/A' && oppTeam !== playerTeam) {
        setRostersLoading(prev => ({ ...prev, opponent: true }));
        const opponentRoster = await fetchTeamDepthChart(oppTeam);
        setOpponentTeamRoster(opponentRoster || []);
        setRostersLoading(prev => ({ ...prev, opponent: false }));
      }
    };
    
    prefetchTeamRosters();
  }, [originalPlayerTeam, opponentTeam, propsMode, gamePropsTeam]);

  // Comprehensive roster cache - preload ALL team rosters for instant switching
  const [allTeamRosters, setAllTeamRosters] = useState<Record<string, DepthChartData>>({});
  const [rosterCacheLoading, setRosterCacheLoading] = useState(false);

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
      
      // Fetch all rosters in parallel
      const rosterPromises = Array.from(allTeams).map(async (team) => {
        try {
          const roster = await fetchTeamDepthChart(team);
          return { team, roster };
        } catch (error) {
          console.warn(`Failed to preload roster for ${team}:`, error);
          return { team, roster: null };
        }
      });
      
      const results = await Promise.all(rosterPromises);
      
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
    };
    
    preloadAllRosters();
  }, [todaysGames]);

  // Fetch injuries for depth chart integration
  useEffect(() => {
    const fetchTeamInjuries = async () => {
      const teamToFetch = propsMode === 'team' ? gamePropsTeam : selectedTeam;
      
      if (!teamToFetch || teamToFetch === 'N/A') {
        setTeamInjuries({});
        return;
      }

      try {
        const response = await fetch(`/api/injuries?teams=${teamToFetch}`);
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
  }, [selectedTeam, propsMode, gamePropsTeam]);




  // On mount: restore from sessionStorage and URL once
  useEffect(() => {
    let initialPropsMode: 'player' | 'team' = 'player';
    let shouldLoadDefaultPlayer = true;
    
    fetchTodaysGames(); // Fetch games on mount

    // First, restore propsMode from session storage
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedSession>;
        if (saved?.propsMode && (saved.propsMode === 'player' || saved.propsMode === 'team')) {
          initialPropsMode = saved.propsMode;
          setPropsMode(saved.propsMode);
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
        // dedupe & cap
        const seen = new Set<string>();
        const dedup = arr.filter(r => {
          if (seen.has(r.full)) return false;
          seen.add(r.full);
          return true;
        }).slice(0, 30);
        setSearchResults(dedup);
      } catch (e: any) {
        setSearchError(e?.message || "Search failed");
        setSearchResults([]);
      } finally {
        setSearchBusy(false);
      }
    };
    t = setTimeout(run, 250);
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
  }, [selectedPlayer, selectedTeam, selectedStat, selectedTimeframe, resolvedPlayerId, propsMode]);

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
  
  // Fetch advanced stats for a player
  const fetchAdvancedStats = async (playerId: string) => {
    setAdvancedStatsLoading(true);
    setAdvancedStatsError(null);
    try {
      const stats = await fetchAdvancedStatsCore(playerId);
      
      if (stats) {
        setAdvancedStats(stats);
      } else {
        setAdvancedStats(null);
        setAdvancedStatsError('No advanced stats found for this player');
      }
    } catch (error: any) {
      setAdvancedStatsError(error.message || 'Failed to fetch advanced stats');
      setAdvancedStats(null);
    } finally {
      setAdvancedStatsLoading(false);
    }
  };

  // Select from your local SAMPLE_PLAYERS (default) - but use API for team data
  const handlePlayerSelectFromLocal = async (player: NBAPlayer) => {
    setIsLoading(true); setApiError(null);
    try {
      const pid = /^\d+$/.test(String(player.id)) ? String(player.id) : await resolvePlayerId(player.full, player.teamAbbr);
      if (!pid) throw new Error(`Couldn't resolve player id for "${player.full}"`);
      setResolvedPlayerId(pid);
      
      // Fetch game stats, advanced stats, and ESPN data in parallel
      const [rows, espnData] = await Promise.all([
        Promise.all([
          fetchSortedStats(pid),
          fetchAdvancedStats(pid)
        ]).then(([stats]) => stats),
        fetchEspnPlayerData(player.full, player.teamAbbr)
      ]);
      
      setPlayerStats(rows);
      
      // Use sample data team directly for default players - NO GAME DATA FALLBACK
      const currentTeam = normalizeAbbr(player.teamAbbr);
      setSelectedTeam(currentTeam);
      setOriginalPlayerTeam(currentTeam); // Track the original player's team
      setDepthChartTeam(currentTeam); // Initialize depth chart to show player's team
      
      // Parse ESPN height data and merge with sample player data
      const heightData = parseEspnHeight(espnData?.height);
      
      setSelectedPlayer({
        ...player,
        jersey: espnData?.jersey || player.jersey || '',
        heightFeet: heightData.feet || player.heightFeet,
        heightInches: heightData.inches || player.heightInches,
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
    setIsLoading(true); setApiError(null);
    try {
      const pid = String(r.id);
      setResolvedPlayerId(pid);
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
      
      // Fetch game stats, advanced stats, and ESPN player data in parallel
      const [rows, espnData] = await Promise.all([
        Promise.all([
          fetchSortedStats(pid),
          fetchAdvancedStats(pid)
        ]).then(([stats]) => stats),
        fetchEspnPlayerData(r.full, r.team)
      ]);
      
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
      
      // Update player object with search API team + ESPN data
      setSelectedPlayer({
        ...tempPlayer,
        teamAbbr: currentTeam,
        jersey: espnData?.jersey || '',
        heightFeet: heightData.feet || null,
        heightInches: heightData.inches || null,
        // Add raw height as fallback for debugging
        rawHeight: espnData?.height || null,
      });
      
      // Reset betting lines to default for new player
      setBettingLines({});
      
      // Set opponent team based on games schedule
      const opponent = getOpponentTeam(currentTeam, todaysGames);
      setOpponentTeam(normalizeAbbr(opponent));
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
    } catch (e: any) {
      setApiError(e?.message || "Failed to load stats."); setPlayerStats([]);
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
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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
  }, [playerStats, selectedTimeframe, selectedPlayer, propsMode, gameStats, selectedTeam, opponentTeam, manualOpponent]); // Added team mode dependencies and manual opponent
  
  /* -------- Chart data with current stat values ----------
     Only recalculate values when selectedStat changes */
  const chartData = useMemo(() => {
    return baseGameData.map(game => ({
      ...game,
      value: propsMode === 'team' 
        ? getGameStatValue(game.gameData, selectedStat, gamePropsTeam) 
        : getStatValue(game.stats, selectedStat) ?? 0,
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
    if (!chartData.length) return { domain: [0, 50], ticks: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50] };
    
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
      return { domain: [minYAxis, maxYAxis], ticks: [0, 1] };
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
      
      return { domain: [minYAxis, maxYAxis], ticks };
    } else if (isSmallIncrementStat) {
      // For 3PM, use 3PA values for Y-axis calculation to show proper scale
      if (selectedStat === 'fg3m') {
        const maxAttempts = Math.max(...chartData.map(d => d.stats?.fg3a || 0));
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
    const ticks = [];
    for (let i = minYAxis; i <= maxYAxis; i += increment) {
      ticks.push(i);
    }
    
    return { domain: [minYAxis, maxYAxis], ticks };
  }, [chartData, selectedStat]);

  // Real odds data state
  const [realOddsData, setRealOddsData] = useState<BookRow[]>([]);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);
  
  // Fetch real odds data
  const fetchOddsData = async () => {
    if (!selectedPlayer) return;
    
    setOddsLoading(true);
    setOddsError(null);
    
    try {
      const params = new URLSearchParams({
        sport: 'basketball_nba',
        player: selectedPlayer.full_name || selectedPlayer.first_name + ' ' + selectedPlayer.last_name,
        market: selectedStat
      });
      
      const response = await fetch(`/api/odds?${params}`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch odds');
      }
      
      setRealOddsData(data.data || []);
      console.log(`📊 Loaded ${data.data?.length || 0} bookmaker odds`);
      
    } catch (error) {
      console.error('Error fetching odds:', error);
      setOddsError(error instanceof Error ? error.message : 'Failed to load odds');
      setRealOddsData([]);
    } finally {
      setOddsLoading(false);
    }
  };
  
  // Fetch odds when player or stat changes
  useEffect(() => {
    fetchOddsData();
  }, [selectedPlayer, selectedStat]);

  const americanToDecimal = (odds: string): string => {
    if (odds === 'N/A') return 'N/A';
    const n = parseInt(odds.replace(/[^+\-\d]/g, ''), 10);
    if (isNaN(n)) return odds;
    const dec = n > 0 ? (1 + n / 100) : (1 + 100 / Math.abs(n));
    return dec.toFixed(2);
  };

  const fmtOdds = (odds: string): string => odds === 'N/A' ? 'N/A' : (oddsFormat === 'decimal' ? americanToDecimal(odds) : odds);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      <LeftSidebar oddsFormat={oddsFormat} setOddsFormat={setOddsFormat} />
      {/* Mobile: Single column layout, Desktop: Two column layout */}
      <div className="ml-0 md:ml-[18vw] lg:ml-[16vw] xl:ml-[14vw] mr-4 md:mr-12 lg:mr-20 xl:mr-28 2xl:mr-36 p-2 sm:p-4 md:p-6 min-h-0">
        <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 md:gap-6 min-h-0">
          {/* Main content area */}
          <div 
className="flex-1 lg:flex-[7] min-w-0 min-h-0 flex flex-col gap-3 sm:gap-4 md:gap-6 overflow-y-auto lg:pr-4 overscroll-contain"
            style={{
              height: 'calc(100vh - 3rem)',
              scrollbarWidth: 'thin',
              scrollbarColor: isDark ? '#4b5563 transparent' : '#d1d5db transparent'
            }}
          >
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 h-auto sm:h-28 md:h-32 flex-shrink-0">
              <div className="flex items-center justify-between h-full">
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
                <div className="flex-1 max-w-md mx-8">
                  <div className="relative" ref={searchRef}>
                    <input
                      type="text"
                      placeholder={
                        propsMode === 'player' 
                          ? (searchBusy ? "Searching..." : "Search for a player...") 
                          : "Search for a team..."
                      }
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (propsMode === 'player') {
                          setShowDropdown(true);
                        } else {
                          // Team search logic - just update query, don't auto-select
                          // Team selection happens on Enter or manual click
                        }
                      }}
                      onFocus={() => {
                        if (propsMode === 'player') {
                          setShowDropdown(true);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && propsMode === 'team') {
                          // Handle Enter key for team search
                          const query = searchQuery.toLowerCase();
                          if (query.length >= 2) {
                            let foundTeam = '';
                            
                            // First try abbreviations directly
                            if (Object.keys(TEAM_FULL_NAMES).some(abbr => abbr.toLowerCase().includes(query))) {
                              foundTeam = Object.keys(TEAM_FULL_NAMES).find(abbr => abbr.toLowerCase().includes(query)) || '';
                            }
                            
                            // Then try full team names
                            if (!foundTeam) {
                              const matchingEntry = Object.entries(TEAM_FULL_NAMES).find(([abbr, fullName]) => 
                                fullName.toLowerCase().includes(query)
                              );
                              if (matchingEntry) {
                                foundTeam = matchingEntry[0]; // abbreviation
                              }
                            }
                            
                            // Try common team nicknames
                            if (!foundTeam) {
                              const nicknames: Record<string, string> = {
                                'lakers': 'LAL',
                                'warriors': 'GSW',
                                'celtics': 'BOS',
                                'heat': 'MIA',
                                'bulls': 'CHI',
                                'knicks': 'NYK',
                                'nets': 'BKN',
                                'sixers': 'PHI',
                                '76ers': 'PHI',
                                'mavs': 'DAL',
                                'spurs': 'SAS',
                                'rockets': 'HOU'
                              };
                              
                              if (nicknames[query]) {
                                foundTeam = nicknames[query];
                              }
                            }
                            
                            if (foundTeam) {
                              setGamePropsTeam(foundTeam);
                              setSelectedStat('total_pts'); // Auto-select stat for Game Props mode
                              // Fetch opponent team for Game Props mode
                              const opponent = getOpponentTeam(foundTeam, todaysGames);
                              setOpponentTeam(normalizeAbbr(opponent));
                              console.log(`🏀 Selected team for Game Props: ${foundTeam}, opponent: ${opponent}`);
                              setSearchQuery(''); // Clear search after selection
                            }
                          }
                        }
                      }}
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    {/* Player search dropdown - only show in player mode */}
                    {propsMode === 'player' && showDropdown && searchQuery && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
                        {searchResults.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                            {searchBusy ? "Searching..." : (searchError ? `Search error: ${searchError}` : `No players found for "${searchQuery}"`)}
                          </div>
                        ) : searchResults.map((r) => (
                          <button
                            key={`${r.id}-${r.full}`}
                            onClick={() => handlePlayerSelectFromSearch(r)}
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
                    
                    {/* Team search dropdown - only show in game props mode */}
                    {propsMode === 'team' && searchQuery && searchQuery.length >= 2 && (() => {
                      const query = searchQuery.toLowerCase();
                      const matchingTeams: Array<{ abbr: string; fullName: string }> = [];
                      
                      // Find matching teams
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
                      
                      if (nicknames[query] && !matchingTeams.find(t => t.abbr === nicknames[query])) {
                        const abbr = nicknames[query];
                        matchingTeams.push({ abbr, fullName: TEAM_FULL_NAMES[abbr] || abbr });
                      }
                      
                      return matchingTeams.length > 0 ? (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
                          {matchingTeams.slice(0, 10).map((team) => ( // Limit to 10 results
                            <button
                              key={team.abbr}
                              onClick={() => {
                                setGamePropsTeam(team.abbr);
                                setSelectedStat('total_pts'); // Auto-select stat for Game Props mode
                                // Fetch opponent team for Game Props mode
                                const opponent = getOpponentTeam(team.abbr, todaysGames);
                                setOpponentTeam(normalizeAbbr(opponent));
                                console.log(`🏀 Selected team for Game Props: ${team.abbr}, opponent: ${opponent}`);
                                setSearchQuery(''); // Clear search after selection
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

                {/* Team vs Team Display - Dynamic based on props mode */}
                <div className="flex-shrink-0">
                  {propsMode === 'player' ? (
                    // Player Props Mode - Show player's team vs opponent
                    selectedTeam && opponentTeam && selectedTeam !== 'N/A' && opponentTeam !== '' ? (
                      <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        {/* Player Team */}
                        <div className="flex items-center gap-2">
                          <img 
                            src={selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)}
                            alt={selectedTeam}
                            className="w-8 h-8 object-contain"
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
                          <span className="font-bold text-gray-900 dark:text-white text-sm">{selectedTeam}</span>
                        </div>
                        
                        {/* VS */}
                        <span className="text-gray-500 dark:text-gray-400 font-medium text-xs">VS</span>
                        
                        {/* Opponent Team */}
                        <div className="flex items-center gap-2">
                          <img 
                            src={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                            alt={opponentTeam}
                            className="w-8 h-8 object-contain"
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
                    ) : (
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                      </div>
                    )
                  ) : (
                    // Game Props Mode - Show selected team vs opponent or prompt
                    gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam ? (
                      <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        {/* Selected Team */}
                        <div className="flex items-center gap-2">
                          <img 
                            src={selectedTeamLogoUrl || getEspnLogoUrl(gamePropsTeam)}
                            alt={gamePropsTeam}
                            className="w-8 h-8 object-contain"
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
                          <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                        </div>
                        
                        {/* VS */}
                        <span className="text-gray-500 dark:text-gray-400 font-medium text-xs">VS</span>
                        
                        {/* Opponent Team */}
                        <div className="flex items-center gap-2">
                          <img 
                            src={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                            alt={opponentTeam}
                            className="w-8 h-8 object-contain"
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
                        <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                        <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Team</span>
                      </div>
                    )
                  )}
                </div>
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
            />

            {/* Under-chart container (memoized element to avoid parent re-evals) */}
            {useMemo(() => (
              <OfficialOddsCard
                isDark={isDark}
                derivedOdds={derivedOdds}
                intradayMovements={intradayMovements}
                selectedTeam={propsMode === 'team' ? gamePropsTeam : selectedTeam}
                opponentTeam={opponentTeam}
                selectedTeamLogoUrl={selectedTeamLogoUrl || getEspnLogoUrl(propsMode === 'team' ? gamePropsTeam : selectedTeam)}
                opponentTeamLogoUrl={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                matchupInfo={matchupInfo}
                oddsFormat={oddsFormat}
                books={realOddsData}
                fmtOdds={fmtOdds}
              />
            ), [isDark, derivedOdds, intradayMovements, selectedTeam, gamePropsTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds])}

            {/* BEST ODDS - Memoized to prevent re-renders from betting line changes */}
            {useMemo(() => (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
              <div className="text-sm text-gray-900 dark:text-white font-semibold mb-2">BEST ODDS</div>
              
              {/* Loading indicator */}
              {oddsLoading && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Loading odds data...</div>
              )}
              {oddsError && (
                <div className="text-xs text-red-500 mb-2">Error: {oddsError}</div>
              )}
              {realOddsData.length === 0 && !oddsLoading && (
                <div className="text-xs text-gray-400 dark:text-gray-500 mb-2">Configure ODDS_API_KEY to enable live odds</div>
              )}
              
              {/* Always show table */}
              (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs border-collapse">
                    <thead>
                      <tr className={ (isDark ? 'bg-slate-900' : 'bg-slate-100') + ' sticky top-0'}>
                        <th className="text-left py-2 pr-3 font-semibold text-gray-700 dark:text-gray-300">Bookmaker</th>
                        {['H2H','Spread','Total','PTS','REB','AST'].map((market) => (
                          <th key={market} className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{market}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                    {(() => {
                      const home = (propsMode === 'team' ? gamePropsTeam : selectedTeam) || 'HOME';
                      const away = opponentTeam || 'AWAY';
                      
                      // Use real data if available, otherwise show default bookmakers with N/A
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
                      const displayHalfLine = (s: string) => {
                        if (s === 'N/A') return 'N/A';
                        const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
                        if (Number.isNaN(v)) return s;
                        const frac = Math.abs(v * 10) % 10; // tenths
                        if (frac === 0) {
                          const adj = v > 0 ? v - 0.5 : v + 0.5; // move toward 0 by 0.5
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

                      // Helpers to choose best lines/odds per rules
                      const parseLine = (s: string) => {
                        if (s === 'N/A') return NaN;
                        return parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
                      };
                      const pickBest = (
                        preferLowLine: boolean,
                        getLine: (b: any) => string,
                        getOdds: (b: any) => string,
                      ) => {
                        // 1) pick best line first (lowest for overs, highest for unders)
                        let bestLine = preferLowLine ? Infinity : -Infinity;
                        for (let i = 0; i < books.length; i++) {
                          const v = parseLine(getLine(books[i]));
                          if (Number.isNaN(v)) continue;
                          if (preferLowLine ? v < bestLine : v > bestLine) bestLine = v;
                        }
                        // gather candidates with that line (handle floats)
                        const EPS = 1e-6;
                        const candIdx: number[] = [];
                        for (let i = 0; i < books.length; i++) {
                          const v = parseLine(getLine(books[i]));
                          if (!Number.isNaN(v) && Math.abs(v - bestLine) < EPS) candIdx.push(i);
                        }
                        if (candIdx.length <= 1) return new Set(candIdx);
                        // 2) tie-break by highest odds (american)
                        let maxOdds = -Infinity;
                        for (const i of candIdx) {
                          const o = americanToNumber(getOdds(books[i]));
                          if (o > maxOdds) maxOdds = o;
                        }
                        const winners = candIdx.filter(i => americanToNumber(getOdds(books[i])) === maxOdds);
                        return new Set(winners);
                      };

                      const bestH2H = {
                        home: maxIdx((b: any) => b.H2H.home),
                        away: maxIdx((b: any) => b.H2H.away),
                      } as const;

                      const bestSets = {
                        Spread: {
                          over: pickBest(true, (b: any) => b.Spread.line, (b: any) => b.Spread.over),
                          under: pickBest(false, (b: any) => b.Spread.line, (b: any) => b.Spread.under),
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
                      } as const;

                      const green = isDark ? 'text-green-400' : 'text-green-600';
                      const grey = isDark ? 'text-slate-300' : 'text-slate-600';

                      return books.map((row, i) => (
                        <tr key={row.name} className={ isDark ? 'border-b border-slate-700' : 'border-b border-slate-200' }>
                          <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.name}</td>
                          {/* H2H both teams */}
                          <td className="py-2 px-3">
                            <div className="font-mono text-gray-900 dark:text-white whitespace-nowrap">
{home} <span className={i === bestH2H.home ? green : grey}>{oddsFormat === 'decimal' ? fmtOdds(row.H2H.home) : row.H2H.home}</span>
                            </div>
                            <div className="font-mono text-gray-900 dark:text-white opacity-80 whitespace-nowrap">
{away} <span className={i === bestH2H.away ? green : grey}>{oddsFormat === 'decimal' ? fmtOdds(row.H2H.away) : row.H2H.away}</span>
                            </div>
                          </td>
                          {/* Spread O/U */}
                          <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.Spread.over.has(i) ? green : grey}`}>O {displayHalfLine(row.Spread.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.over) : row.Spread.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.Spread.under.has(i) ? green : grey}`}>U {displayHalfLine(row.Spread.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.Spread.under) : row.Spread.under})</div>
                          </td>
                          {/* Total O/U */}
                          <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.Total.over.has(i) ? green : grey}`}>O {displayHalfLine(row.Total.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.Total.over) : row.Total.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.Total.under.has(i) ? green : grey}`}>U {displayHalfLine(row.Total.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.Total.under) : row.Total.under})</div>
                          </td>
                          {/* PTS O/U */}
                          <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PTS.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.PTS.over) : row.PTS.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PTS.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.PTS.under) : row.PTS.under})</div>
                          </td>
                          {/* REB O/U */}
                          <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.REB.over.has(i) ? green : grey}`}>O {displayHalfLine(row.REB.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.REB.over) : row.REB.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.REB.under.has(i) ? green : grey}`}>U {displayHalfLine(row.REB.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.REB.under) : row.REB.under})</div>
                          </td>
                          {/* AST O/U */}
                          <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.AST.over.has(i) ? green : grey}`}>O {displayHalfLine(row.AST.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.AST.over) : row.AST.over})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.AST.under.has(i) ? green : grey}`}>U {displayHalfLine(row.AST.line)} ({oddsFormat === 'decimal' ? fmtOdds(row.AST.under) : row.AST.under})</div>
                          </td>
                        </tr>
                      ));
                    })()}
                    </tbody>
                  </table>
                </div>
              </div>
            ), [isDark, oddsLoading, oddsError, realOddsData, selectedTeam, gamePropsTeam, propsMode, opponentTeam, oddsFormat, fmtOdds])}

            {/* Unified Depth Chart - optimized for both modes */}
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
                : (allTeamRosters[currentTeam] || []);
              const currentOpponentRoster = propsMode === 'player' 
                ? (currentTeam === depthChartTeam ? opponentTeamRoster : playerTeamRoster)
                : (opponentTeam ? (allTeamRosters[opponentTeam] || []) : []);
              
              // Determine loading state based on mode
              const currentRostersLoading = propsMode === 'player' 
                ? rostersLoading 
                : { player: rosterCacheLoading, opponent: rosterCacheLoading };
              
              return (
                <DepthChartContainer
                  selectedTeam={currentTeam}
                  teamInjuries={teamInjuries}
                  isDark={isDark}
                  onPlayerSelect={propsMode === 'player' ? setSelectedPlayer : () => {}}
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
                  allTeamRosters={propsMode === 'team' ? allTeamRosters : undefined}
                />
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

            {/* Player Box Score - conditionally rendered inside useMemo */}
            {useMemo(() => {
              if (propsMode !== 'player') return null;
              
              return (
                <PlayerBoxScore
                  selectedPlayer={selectedPlayer}
                  playerStats={playerStats}
                  isDark={isDark}
                />
              );
            }, [propsMode, selectedPlayer, playerStats, isDark])}

          </div>


          {/* Right Panel - Mobile: Single column containers, Desktop: Right sidebar */}
          <div 
            className="flex-1 lg:flex-[3] flex flex-col gap-3 sm:gap-4 md:gap-6 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:pr-3 xl:pr-4" 
            style={{
              ...(typeof window !== 'undefined' && window.innerWidth >= 1024 ? {
                height: 'calc(100vh - 3rem)'
              } : {}),
              scrollbarWidth: 'thin',
              scrollbarColor: isDark ? '#4b5563 transparent' : '#d1d5db transparent'
            }}
          >

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-3 md:px-4 lg:px-6 pt-3 md:pt-4 pb-4 md:pb-5 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white mb-3">Filter By</h3>
              <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                <button
                  onClick={() => {
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
                  className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors ${
                    propsMode === 'player'
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  Player Props
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
            
            {/* Combined Opponent Analysis & Team Matchup - always visible in both modes */}
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3 md:p-4 lg:p-6 border border-gray-200 dark:border-gray-700">
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
                    
                    {/* Team Switcher - only show when both teams are available */}
                    {((propsMode === 'player' && selectedTeam && selectedTeam !== 'N/A' && opponentTeam && opponentTeam !== '') || 
                      (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam && opponentTeam !== '')) && (
                      <button
                        onClick={() => {
                          // Only toggle pie chart display order, don't change underlying team data
                          setPieChartSwapped(!pieChartSwapped);
                        }}
                        className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        title="Switch teams in comparison"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m0 0l4-4" />
                        </svg>
                        Swap
                      </button>
                    )}
                  </div>
                  
                  {/* Comparison Metric Selector */}
                  <div className="mb-3 md:mb-4">
                    <div className="grid grid-cols-2 gap-1 md:gap-2 lg:gap-3">
                      <button
                        onClick={() => setSelectedComparison('offense_defense')}
                        className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                          selectedComparison === 'offense_defense'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        OFF vs DEF
                      </button>
                      <button
                        onClick={() => setSelectedComparison('net_rating')}
                        className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                          selectedComparison === 'net_rating'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        NET RTG
                      </button>
                      <button
                        onClick={() => setSelectedComparison('pace')}
                        className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                          selectedComparison === 'pace'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        PACE
                      </button>
                      <button
                        onClick={() => setSelectedComparison('rebound_pct')}
                        className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                          selectedComparison === 'rebound_pct'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        REB %
                      </button>
                    </div>
                  </div>

                  {/* Stats Preview Box - appears right after selector buttons */}
                  {(() => {
                    const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
                    const currentOpponent = opponentTeam;
                    
                    if (!currentTeam || currentTeam === 'N/A') return null;
                    
                    let teamValue, opponentValue;
                    
                    if (propsMode === 'team' && !currentOpponent) {
                      switch (selectedComparison) {
                        case 'offense_defense':
                          if (pieChartSwapped) {
                            teamValue = 110;
                            opponentValue = teamRatings[currentTeam]?.defensive || 0;
                          } else {
                            teamValue = teamRatings[currentTeam]?.offensive || 0;
                            opponentValue = 110;
                          }
                          break;
                        case 'net_rating':
                          teamValue = teamRatings[currentTeam]?.net || 0;
                          opponentValue = 0;
                          break;
                        case 'pace':
                          teamValue = getTeamPace(currentTeam);
                          opponentValue = 100;
                          break;
                        case 'rebound_pct':
                          teamValue = getTeamReboundPct(currentTeam);
                          opponentValue = 50;
                          break;
                        default:
                          teamValue = 0;
                          opponentValue = 0;
                      }
                    } else {
                      switch (selectedComparison) {
                        case 'offense_defense':
                          if (pieChartSwapped) {
                            teamValue = teamRatings[currentTeam]?.defensive || 0;
                            opponentValue = teamRatings[currentOpponent]?.offensive || 0;
                          } else {
                            teamValue = teamRatings[currentTeam]?.offensive || 0;
                            opponentValue = teamRatings[currentOpponent]?.defensive || 0;
                          }
                          break;
                        case 'net_rating':
                          teamValue = teamRatings[currentTeam]?.net || 0;
                          opponentValue = teamRatings[currentOpponent]?.net || 0;
                          break;
                        case 'pace':
                          teamValue = getTeamPace(currentTeam);
                          opponentValue = getTeamPace(currentOpponent);
                          break;
                        case 'rebound_pct':
                          teamValue = getTeamReboundPct(currentTeam);
                          opponentValue = getTeamReboundPct(currentOpponent);
                          break;
                        default:
                          teamValue = 0;
                          opponentValue = 0;
                      }
                    }
                    
                    const teamDisplay = selectedComparison === 'rebound_pct' ? `${teamValue.toFixed(1)}%` : teamValue.toFixed(1);
                    const oppDisplay = selectedComparison === 'rebound_pct' ? `${opponentValue.toFixed(1)}%` : opponentValue.toFixed(1);
                    
                    return (
                      <div className="bg-gray-100 dark:bg-gray-700 rounded px-2 py-1 mb-2">
                        <div className="flex items-center justify-between gap-1 text-xs">
                          <div className="flex-1 text-center text-green-600 dark:text-green-400">
                            {selectedComparison === 'offense_defense' && (
                              <span className="font-bold text-gray-900 dark:text-white mr-1">
                                {pieChartSwapped ? 'DEF' : 'OFF'}
                              </span>
                            )}
                            <span className="font-bold">{currentTeam}</span>
                            <span className="font-bold ml-1">{teamDisplay}</span>
                          </div>
                          
                          <div className="text-gray-400 font-bold px-1">VS</div>
                          
                          <div className="flex-1 text-center text-red-500 dark:text-red-400">
                            {selectedComparison === 'offense_defense' && (
                              <span className="font-bold text-gray-900 dark:text-white mr-1">
                                {pieChartSwapped ? 'OFF' : 'DEF'}
                              </span>
                            )}
                            <span className="font-bold">{(propsMode === 'team' && !currentOpponent) ? 'League Avg' : (currentOpponent || 'TBD')}</span>
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
                                  <div className="h-44 w-44 md:w-56 md:h-56 flex-shrink-0 select-none">
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
                          
                          let teamValue, opponentValue, isInverted = false;
                          
                          if (propsMode === 'team' && !currentOpponent) {
                            // In Game Props mode without opponent, show team stats vs league average
                            switch (selectedComparison) {
                              case 'offense_defense':
                                if (pieChartSwapped) {
                                  // Swapped: Show league avg offense vs team defense
                                  teamValue = 110; // League average offensive rating
                                  opponentValue = teamRatings[currentTeam]?.defensive || 0;
                                } else {
                                  // Normal: Show team offense vs league avg defense
                                  teamValue = teamRatings[currentTeam]?.offensive || 0;
                                  opponentValue = 110; // League average defensive rating
                                }
                                break;
                              case 'net_rating':
                                teamValue = teamRatings[currentTeam]?.net || 0;
                                opponentValue = 0; // League average net rating
                                break;
                              case 'pace':
                                teamValue = getTeamPace(currentTeam);
                                opponentValue = 100; // League average pace
                                break;
                              case 'rebound_pct':
                                teamValue = getTeamReboundPct(currentTeam);
                                opponentValue = 50; // Neutral rebound percentage
                                break;
                              default:
                                teamValue = 0;
                                opponentValue = 0;
                            }
                          } else {
                            // Player Props mode - original logic
                            switch (selectedComparison) {
                              case 'offense_defense':
                                if (pieChartSwapped) {
                                  // Swapped: Show team defense vs opponent offense (keep teams in same position)
                                  teamValue = teamRatings[currentTeam]?.defensive || 0;
                                  opponentValue = teamRatings[currentOpponent]?.offensive || 0;
                                } else {
                                  // Normal: Show team offense vs opponent defense
                                  teamValue = teamRatings[currentTeam]?.offensive || 0;
                                  opponentValue = teamRatings[currentOpponent]?.defensive || 0;
                                }
                                break;
                              case 'net_rating':
                                teamValue = teamRatings[currentTeam]?.net || 0;
                                opponentValue = teamRatings[currentOpponent]?.net || 0;
                                break;
                              case 'pace':
                                teamValue = getTeamPace(currentTeam);
                                opponentValue = getTeamPace(currentOpponent);
                                break;
                              case 'rebound_pct':
                                teamValue = getTeamReboundPct(currentTeam);
                                opponentValue = getTeamReboundPct(currentOpponent);
                                break;
                              default:
                                teamValue = 0;
                                opponentValue = 0;
                            }
                          }
                          
                          // For offense vs defense comparison, invert defensive rating for proper comparison
                          // Lower defensive rating is better defense, so we need to flip the scale
                          let adjustedOpponentValue = opponentValue;
                          if (selectedComparison === 'offense_defense') {
                            // Convert defensive rating to "defensive strength" where higher = better defense
                            // Use 220 - defensive_rating so that 110 def = 110 strength, creating balanced comparison
                            adjustedOpponentValue = 220 - opponentValue;
                          }

                          if (selectedComparison === 'offense_defense') {
                            isInverted = true; // Lower defensive rating is better
                          }

                          const pieData = createTeamComparisonPieData(
                            teamValue,
                            adjustedOpponentValue,
                            currentTeam,
                            (propsMode === 'team' && !currentOpponent) ? 'League Avg' : currentOpponent,
                            isInverted,
                            /* amplify */ (selectedComparison !== 'net_rating'),
                            /* useAbs */ false,
                            /* clampNegatives */ selectedComparison === 'net_rating',
                            /* baseline */ selectedComparison === 'net_rating' ? 1 : (selectedComparison === 'offense_defense' ? 5 : 0),
                            /* invertOppForShare */ false, // No longer needed since we pre-invert
                            /* invertMax */ selectedComparison === 'offense_defense' ? 180 : 130,
                            /* ampBoost */ selectedComparison === 'rebound_pct' ? 3.0 : (selectedComparison === 'pace' ? 2.0 : 1.0)
                          );
                          
                          // Fix display values for offense vs defense to show original ratings
                          if (selectedComparison === 'offense_defense' && pieData) {
                            pieData[0].displayValue = teamValue.toFixed(1);
                            pieData[1].displayValue = opponentValue.toFixed(1);
                          }

                          // When swapping offense/defense, we need to invert the pie chart values
                          // so the visual proportions match the swapped comparison
                          let pieDrawData;
                          if (selectedComparison === 'offense_defense' && pieChartSwapped && pieData) {
                            // Invert the pie values for swapped offense/defense comparison
                            const totalValue = pieData[0].value + pieData[1].value;
                            const invertedPieData = [
                              {
                                ...pieData[0],
                                value: pieData[1].value, // Swap the visual proportions
                              },
                              {
                                ...pieData[1], 
                                value: pieData[0].value, // Swap the visual proportions
                              }
                            ];
                            // Always draw player's team on LEFT: flip draw order so team slice renders second
                            pieDrawData = [invertedPieData[1], invertedPieData[0]];
                          } else {
                            // Always draw player's team on LEFT: flip draw order so team slice renders second
                            pieDrawData = [pieData?.[1], pieData?.[0]];
                          }

                          const teamDisplayRaw = pieData?.[0]?.displayValue ?? '';
                          const oppDisplayRaw = pieData?.[1]?.displayValue ?? '';
                          const teamDisplay = selectedComparison === 'rebound_pct' ? `${teamDisplayRaw}%` : teamDisplayRaw;
                          const oppDisplay = selectedComparison === 'rebound_pct' ? `${oppDisplayRaw}%` : oppDisplayRaw;
                          const teamColor = pieData?.[0]?.fill || '#22c55e';
                          const oppColor = pieData?.[1]?.fill || '#ef4444';

                          // Compute ranks for current comparison
                          let teamRank: number | null = null;
                          let oppRank: number | null = null;
                          
                          if (propsMode === 'team' && !currentOpponent) {
                            // In Game Props mode without opponent, only show team rank
                            switch (selectedComparison) {
                              case 'offense_defense':
                                if (pieChartSwapped) {
                                  // Swapped: League avg offense (no rank) vs team defense
                                  teamRank = null; // No rank for league average
                                  oppRank = getTeamRank(currentTeam, 'defensive');
                                } else {
                                  // Normal: Team offense vs league avg defense (no rank)
                                  teamRank = getTeamRank(currentTeam, 'offensive');
                                  oppRank = null; // No opponent rank for league average
                                }
                                break;
                              case 'net_rating':
                                teamRank = getTeamRank(currentTeam, 'net');
                                oppRank = null;
                                break;
                              case 'pace':
                                teamRank = getPaceRank(currentTeam);
                                oppRank = null;
                                break;
                              case 'rebound_pct':
                                teamRank = getReboundRank(currentTeam);
                                oppRank = null;
                                break;
                              default:
                                teamRank = null; oppRank = null;
                            }
                          } else {
                            // Player Props mode - original logic
                            switch (selectedComparison) {
                              case 'offense_defense':
                                if (pieChartSwapped) {
                                  // Swapped: Team defense vs opponent offense (keep teams in same position)
                                  teamRank = getTeamRank(currentTeam, 'defensive');
                                  oppRank = getTeamRank(currentOpponent, 'offensive');
                                } else {
                                  // Normal: Team offense vs opponent defense
                                  teamRank = getTeamRank(currentTeam, 'offensive');
                                  oppRank = getTeamRank(currentOpponent, 'defensive');
                                }
                                break;
                              case 'net_rating':
                                teamRank = getTeamRank(currentTeam, 'net');
                                oppRank = getTeamRank(currentOpponent, 'net');
                                break;
                              case 'pace':
                                teamRank = getPaceRank(currentTeam);
                                oppRank = getPaceRank(currentOpponent);
                                break;
                              case 'rebound_pct':
                                teamRank = getReboundRank(currentTeam);
                                oppRank = getReboundRank(currentOpponent);
                                break;
                              default:
                                teamRank = null; oppRank = null;
                            }
                          }

                          // Always keep selected team on LEFT, opponent on RIGHT
                          // Only swap the stats/colors based on what comparison is being made
                          const leftTeam = currentTeam; // Selected team always on left
                          const leftDisplay = teamDisplay; // Selected team's current stat display
                          const leftRank = teamRank; // Selected team's current rank
                          const leftColor = teamColor; // Color based on advantage
                          
                          const rightTeam = currentOpponent; // Opponent always on right
                          const rightDisplay = oppDisplay; // Opponent's current stat display  
                          const rightRank = oppRank; // Opponent's current rank
                          const rightColor = oppColor; // Color based on advantage
                          
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
                                    width: 'min(25vw, 200px)',
                                    height: 'min(25vw, 200px)',
                                    minWidth: '120px',
                                    minHeight: '120px',
                                    maxWidth: '200px',
                                    maxHeight: '200px',
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
                                        labelStyle={{ color: '#FFFFFF' }}
                                        itemStyle={{ color: '#FFFFFF' }}
                                        formatter={(value: any, name: string, props: any) => [
                                          selectedComparison === 'rebound_pct' ? `${props.payload.displayValue}%` : `${props.payload.displayValue}`,
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
                                  <div className="h-48 w-48 md:h-56 md:w-56 flex-shrink-0 select-none"
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onMouseUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onFocus={(e) => { e.preventDefault(); e.target.blur(); }}
                                    style={{ 
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
                                          innerRadius={50}
                                          outerRadius={95}
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
                                          labelStyle={{ color: '#FFFFFF' }}
                                          itemStyle={{ color: '#FFFFFF' }}
                                          formatter={(value: any, name: string, props: any) => [
                                            selectedComparison === 'rebound_pct' ? `${props.payload.displayValue}%` : `${props.payload.displayValue}`,
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
                                    {/* OFF/DEF label for offense_defense comparison */}
                                    {selectedComparison === 'offense_defense' && (
                                      <div className="text-xs font-bold mb-1 text-gray-900 dark:text-white">
                                        {pieChartSwapped ? 'DEF' : 'OFF'}
                                      </div>
                                    )}
                                    <div className="truncate text-base font-bold">{leftTeam}</div>
                                    <div className="text-xl font-bold">{leftDisplay}</div>
                                    <div className="text-xs" style={{ color: leftColor, opacity: 0.85 }}>
                                      {leftRank ? `Rank: ${getOrdinalSuffix(leftRank)}` : 'Rank: —'}
                                    </div>
                                  </div>

                                  {/* VS Separator */}
                                  <div className="text-gray-400 text-sm font-bold px-2">VS</div>

                                  {/* Right value - Opponent */}
                                  <div className="flex-1 text-center text-sm font-semibold" style={{ color: rightColor }}>
                                    {/* OFF/DEF label for offense_defense comparison */}
                                    {selectedComparison === 'offense_defense' && (
                                      <div className="text-xs font-bold mb-1 text-gray-900 dark:text-white">
                                        {pieChartSwapped ? 'OFF' : 'DEF'}
                                      </div>
                                    )}
                                    <div className="truncate text-base font-bold">{(propsMode === 'team' && !currentOpponent) ? 'League Avg' : (rightTeam || 'TBD')}</div>
                                    <div className="text-xl font-bold">{rightDisplay}</div>
                                    <div className="text-xs" style={{ color: rightColor, opacity: 0.85 }}>
                                      {rightRank ? `Rank: ${getOrdinalSuffix(rightRank)}` : ((propsMode === 'team' && !currentOpponent) ? '' : 'Rank: —')}
                                    </div>
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
                                  <span className="text-gray-600 dark:text-gray-300">{(propsMode === 'team' && !currentOpponent) ? 'League Avg' : (rightTeam || 'TBD')}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      
                      
                      {/* Metric Description */}
                      <div className="text-center text-xs text-gray-500 dark:text-gray-400">
                        {selectedComparison === 'offense_defense' && 'Player Team Offense vs Opponent Defense'}
                        {selectedComparison === 'net_rating' && 'Net Rating Comparison (Offense - Defense)'}
                        {selectedComparison === 'pace' && 'Pace of Play Comparison'}
                        {selectedComparison === 'rebound_pct' && 'Rebounding Percentage Comparison'}
                      </div>
                  </div>
                </div>
              </div>

            {/* Advanced Player Stats - only in Player Props mode */}
            {propsMode === 'player' && (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3 md:p-4 lg:p-6 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-3 md:mb-4">
                  <h3 className="text-base md:text-lg lg:text-xl font-bold text-gray-900 dark:text-white">Advanced Stats</h3>
                </div>
              {advancedStats ? (
                  <div className="grid grid-cols-2 gap-3 md:gap-4 lg:gap-6">
                    {/* Left Column: Offensive & Defensive */}
                    <div className="space-y-3 md:space-y-4">
                      {/* Offensive Metrics */}
                      <div>
                        <h4 className="text-xs md:text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 md:mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Offensive</h4>
                        <div className="space-y-1">
                          <StatTooltip statName="OFF RTG" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.offensive_rating ? 'text-gray-400' :
                              advancedStats.offensive_rating >= 115 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.offensive_rating >= 108 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.offensive_rating?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Points per 100 possessions. NBA avg: 110. Elite: 115+" />
                          <StatTooltip statName="TS%" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.true_shooting_percentage ? 'text-gray-400' :
                              (advancedStats.true_shooting_percentage * 100) >= 58 ? 'text-green-600 dark:text-green-400' :
                              (advancedStats.true_shooting_percentage * 100) >= 54 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.true_shooting_percentage ? (advancedStats.true_shooting_percentage * 100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          } definition="Shooting efficiency (2pt + 3pt + FT). NBA avg: 56%. Elite: 58%+" />
                          <StatTooltip statName="eFG%" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.effective_field_goal_percentage ? 'text-gray-400' :
                              (advancedStats.effective_field_goal_percentage * 100) >= 55 ? 'text-green-600 dark:text-green-400' :
                              (advancedStats.effective_field_goal_percentage * 100) >= 50 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.effective_field_goal_percentage ? (advancedStats.effective_field_goal_percentage * 100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          } definition="FG% adjusted for 3pt value. NBA avg: 53%. Elite: 55%+" />
                          <StatTooltip statName="USG%" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.usage_percentage ? 'text-gray-400' :
                              (advancedStats.usage_percentage * 100) >= 28 ? 'text-green-600 dark:text-green-400' :
                              (advancedStats.usage_percentage * 100) >= 22 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.usage_percentage ? (advancedStats.usage_percentage * 100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          } definition="% of team plays used on court. NBA avg: 20%. Elite: 28%+" />
                        </div>
                      </div>

                      {/* Defensive Metrics */}
                      <div>
                        <h4 className="text-xs md:text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 md:mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Defensive</h4>
                        <div className="space-y-1">
                          <StatTooltip statName="DEF RTG" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.defensive_rating ? 'text-gray-400' :
                              advancedStats.defensive_rating <= 108 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.defensive_rating <= 112 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.defensive_rating?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Points allowed per 100 possessions. NBA avg: 112. Elite: &le;108" />
                          <StatTooltip statName="DREB%" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.defensive_rebound_percentage ? 'text-gray-400' :
                              (advancedStats.defensive_rebound_percentage * 100) >= 25 ? 'text-green-600 dark:text-green-400' :
                              (advancedStats.defensive_rebound_percentage * 100) >= 18 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.defensive_rebound_percentage ? (advancedStats.defensive_rebound_percentage * 100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          } definition="% of available defensive rebounds grabbed. NBA avg: 22%. Elite: 25%+" />
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Impact, Rebounding, Playmaking */}
                    <div className="space-y-3 md:space-y-4">
                      {/* Overall Impact */}
                      <div>
                        <h4 className="text-xs md:text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 md:mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Impact</h4>
                        <div className="space-y-1">
                          <StatTooltip statName="NET RTG" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.net_rating ? 'text-gray-400' :
                              advancedStats.net_rating >= 3 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.net_rating >= -2 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.net_rating?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Point differential per 100 poss on court. NBA avg: 0. Elite: +3" />
                          <StatTooltip statName="PIE" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.pie ? 'text-gray-400' :
                              (advancedStats.pie * 100) >= 15 ? 'text-green-600 dark:text-green-400' :
                              (advancedStats.pie * 100) >= 10 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.pie ? (advancedStats.pie * 100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          } definition="Overall statistical contribution measure. NBA avg: 10%. Elite: 15%+" />
                          <StatTooltip statName="PACE" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.pace ? 'text-gray-400' :
                              advancedStats.pace >= 102 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.pace >= 98 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.pace?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Possessions per 48 min. NBA avg: 100. Elite: 102+" />
                        </div>
                      </div>

                      {/* Rebounding Metrics */}
                      <div>
                        <h4 className="text-xs md:text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 md:mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Rebounding</h4>
                        <div className="space-y-1">
                          <StatTooltip statName="REB%" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.rebound_percentage ? 'text-gray-400' :
                              (advancedStats.rebound_percentage * 100) >= 15 ? 'text-green-600 dark:text-green-400' :
                              (advancedStats.rebound_percentage * 100) >= 10 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.rebound_percentage ? (advancedStats.rebound_percentage * 100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          } definition="% of available rebounds grabbed. NBA avg: 10%. Elite: 15%+" />
                          <StatTooltip statName="OREB%" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.offensive_rebound_percentage ? 'text-gray-400' :
                              (advancedStats.offensive_rebound_percentage * 100) >= 8 ? 'text-green-600 dark:text-green-400' :
                              (advancedStats.offensive_rebound_percentage * 100) >= 4 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.offensive_rebound_percentage ? (advancedStats.offensive_rebound_percentage * 100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          } definition="% of available offensive rebounds grabbed. NBA avg: 5%. Elite: 8%+" />
                        </div>
                      </div>

                      {/* Playmaking Metrics */}
                      <div>
                        <h4 className="text-xs md:text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 md:mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Playmaking</h4>
                        <div className="space-y-1">
                          <StatTooltip statName="AST%" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.assist_percentage ? 'text-gray-400' :
                              (advancedStats.assist_percentage * 100) >= 25 ? 'text-green-600 dark:text-green-400' :
                              (advancedStats.assist_percentage * 100) >= 15 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.assist_percentage ? (advancedStats.assist_percentage * 100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          } definition="% of teammate FGs assisted on court. NBA avg: 15%. Elite: 25%+" />
                          <StatTooltip statName="AST RATIO" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.assist_ratio ? 'text-gray-400' :
                              advancedStats.assist_ratio >= 20 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.assist_ratio >= 15 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.assist_ratio?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Assists per 100 possessions used. NBA avg: 15. Elite: 20+" />
                          <StatTooltip statName="AST/TO" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.assist_to_turnover ? 'text-gray-400' :
                              advancedStats.assist_to_turnover >= 2.0 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.assist_to_turnover >= 1.5 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.assist_to_turnover?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Assists &divide; turnovers. NBA avg: 1.8. Elite: 2.0+" />
                          <StatTooltip statName="TO RATIO" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.turnover_ratio ? 'text-gray-400' :
                              advancedStats.turnover_ratio <= 12 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.turnover_ratio <= 16 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.turnover_ratio?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Turnovers per 100 possessions. NBA avg: 14. Elite: &le;12" />
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
            
            {/* ESP Injury Report - always visible in both modes */}
            <InjuryContainer
              selectedTeam={propsMode === 'team' ? (gamePropsTeam && gamePropsTeam !== 'N/A' ? gamePropsTeam : '') : selectedTeam}
              opponentTeam={opponentTeam}
              isDark={isDark}
            />
            </div>


          </div>
      </div>
    </div>
  );
}

export default function NBADashboard() {
  return (
    <ThemeProvider>
      <NBADashboardContent />
    </ThemeProvider>
  );
}
