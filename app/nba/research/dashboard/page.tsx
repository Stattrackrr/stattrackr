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
  
  // NBA season starts around October 21st
  // Until then, use previous season
  if (m === 9 && d < 21) { // October is month 9 (0-indexed)
    return now.getFullYear() - 1;
  }
  
  return m >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}
function parseMinutes(minStr: string): number {
  if (!minStr || minStr === '0:00') return 0;
  const [m, s] = minStr.split(':').map(Number);
  return (Number.isFinite(m) ? m : 0) + ((Number.isFinite(s) ? s : 0) / 60);
}
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

type BdlSearchResult = { id: number; full: string; team?: string; pos?: string };
 type EspnPlayerData = { name: string; jersey?: string; height?: string; weight?: number; team?: string; position?: string };
 
 // Persist session across refresh within the same tab (clears on tab close)
 const SESSION_KEY = 'nba_dashboard_session_v1';
 type SavedSession = {
   player: BdlSearchResult;
   selectedStat: string;
   selectedTimeframe: string;
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
      isAnimationActive={false}
      style={{
        fontSize: CHART_CONFIG.labelList.fontSize,
        fontWeight: CHART_CONFIG.labelList.fontWeight,
        fill: isDark ? '#ffffff' : '#000000'
      }}
      formatter={formatChartLabel}
    />
  );
}, (prev, next) => prev.isDark === next.isDark && prev.formatChartLabel === next.formatChartLabel);

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
  const colorMap = useMemo(() => data.map(d => (d.value > bettingLine ? 'over' : d.value === bettingLine ? 'push' : 'under')), [data, bettingLine]);
  const clampedRefLine = useMemo(() => {
    const maxY = Array.isArray(yAxisConfig?.domain) ? yAxisConfig.domain[1] : undefined;
    const top = typeof maxY === 'number' ? maxY : bettingLine;
    const y = Math.max(0, Math.min(bettingLine, top));
    return y;
  }, [bettingLine, yAxisConfig]);
  
  // Memoize axis styles to prevent recreating objects on every render
  const xAxisTickStyle = useMemo(() => ({ fill: isDark ? '#d1d5db' : '#374151', fontSize: 12 }), [isDark]);
  const yAxisTickStyle = useMemo(() => ({ fill: isDark ? '#d1d5db' : '#374151', fontSize: 12 }), [isDark]);
  const xAxisLineStyle = useMemo(() => ({ stroke: isDark ? '#4b5563' : '#d1d5db' }), [isDark]);
  const yAxisLineStyle = useMemo(() => ({ stroke: isDark ? '#4b5563' : '#d1d5db' }), [isDark]);
  const refLineColor = useMemo(() => isDark ? '#ffffff' : '#000000', [isDark]);
  
  // For 3PM stat, create background data for 3PA (attempts)
  const backgroundData = useMemo(() => {
    if (selectedStat === 'fg3m') {
      const bgData = data.map(d => ({
        ...d,
        backgroundValue: d.stats?.fg3a || 0 // 3PA value for background
      }));
      return bgData;
    }
    return null;
  }, [data, selectedStat]);
  
  return (
    <ResponsiveContainer 
      width="100%" 
      height="100%" 
      debounceMs={CHART_CONFIG.performance.debounceMs} // Debounce resize events to reduce lag
    >
      <BarChart 
        data={data} 
        margin={CHART_CONFIG.margin}
        syncMethod="value" // Performance optimization for synced charts
        maxBarSize={CHART_CONFIG.performance.maxBarSize} // Limit bar width on large screens
        barCategoryGap={selectedStat === 'fg3m' ? 0 : '10%'} // Overlap bars for 3PM view
        barGap={selectedStat === 'fg3m' ? -60 : 4} // Force bars to overlap completely
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
          animationDuration={0} // Disable tooltip animations
        />
        <Bar 
          dataKey={selectedStat === 'fg3m' ? "stats.fg3a" : "value"} 
          radius={CHART_CONFIG.bar.radius} 
          isAnimationActive={false} 
          animationDuration={0}
          background={false}
          shape={selectedStat === 'fg3m' ? (props: any) => {
            const { x, y, width, height, payload } = props;
            const attempts = payload?.stats?.fg3a || 0; // This is now the main bar height
            const makes = payload?.stats?.fg3m || 0; // Get makes from stats
            
            // Calculate makes height relative to attempts bar height
            const makesHeight = attempts > 0 ? (makes / attempts) * height : 0;
            
            return (
              <g>
                {/* Background bar for attempts (gray) - this is the main bar */}
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
                
                {/* Label positioning: attempts number inside bar when no makes */}
                {attempts > 0 && makes === 0 && (
                  <text
                    x={x + width / 2}
                    y={y + height / 2 + 4} // Middle of the bar
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill={isDark ? '#ffffff' : '#000000'}
                  >
                    {attempts}
                  </text>
                )}
                
                {/* 3PA number in the attempts section (only when there are makes) */}
                {attempts > 0 && makes > 0 && (
                  <text
                    x={x + width / 2}
                    y={y + (height - makesHeight) / 2 + 4} // Middle of the attempts-only section
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill={isDark ? '#ffffff' : '#000000'}
                  >
                    {attempts}
                  </text>
                )}
                
                {/* Foreground bar for makes (colored) */}
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
                
                {/* 3PM number in the makes (foreground) section */}
                {makes > 0 && makesHeight > 15 && ( // Only show if makes section is tall enough
                  <text
                    x={x + width / 2}
                    y={y + height - makesHeight / 2 + 4} // Middle of the makes section
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill="#ffffff" // White text on colored background
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
            />
          ))}
          {/* Labels are memoized and independent from bettingLine - skip for 3PM since we have custom labels */}
          {selectedStat !== 'fg3m' && <StaticLabelList isDark={isDark} formatChartLabel={formatChartLabel} />}
        </Bar>
        <ReferenceLine 
          y={clampedRefLine} 
          stroke={refLineColor} 
          strokeDasharray="4 4" 
          strokeWidth={2} 
          ifOverflow="discard"
          isAnimationActive={false} // Disable reference line animations
        />
      </BarChart>
    </ResponsiveContainer>
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
    <span className={`px-2 py-1 rounded text-sm font-bold ${cls}`}>
      {pct.toFixed(1)}%
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
  { key: "total_pts", label: "TOTAL PTS" }, { key: "spread", label: "SPREAD" }, { key: "moneyline", label: "MONEYLINE" },
  { key: "total_reb", label: "TOTAL REB" }, { key: "total_ast", label: "TOTAL AST" }, { key: "fg_pct", label: "FG%" },
  { key: "fg3_pct", label: "3P%" }, { key: "ft_pct", label: "FT%" }, { key: "total_to", label: "TOTAL TO" },
  { key: "pace", label: "PACE" }, { key: "off_rating", label: "OFF RTG" }, { key: "def_rating", label: "DEF RTG" }
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
    radius: [8, 8, 0, 0] as [number, number, number, number]
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
  fontSize: '14px'
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
                        src={getEspnLogoUrl(playerTeam)}
                        alt={playerTeam}
                        className="w-4 h-4 object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <span className="font-medium text-gray-900 dark:text-white">{playerTeam}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-gray-900 dark:text-white">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 dark:text-gray-400 text-[10px]">{isHome ? 'vs' : '@'}</span>
                      <img 
                        src={getEspnLogoUrl(opponent)}
                        alt={opponent}
                        className="w-4 h-4 object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
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
}: any) {
  // Custom tooltip recreated only when selectedStat or isDark changes
  const customTooltip = useCallback(({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    const statMeta = currentStatOptions.find((s: any) => s.key === selectedStat);
    const statLabel = statMeta ? statMeta.label : String(selectedStat).toUpperCase();
    const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
    const numValue = typeof data.value === 'number' ? data.value : parseFloat(data.value) || 0;
    const formattedValue = isPercentageStat ? `${numValue.toFixed(1)}%` : `${numValue}`;
    const gameStats = data.stats;
    const correctMinutes = gameStats?.min ?? '0:00';
    let correctDate = 'Unknown Date';
    if (gameStats?.game?.date) {
      correctDate = new Date(gameStats.game.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    const tooltipStyle = getUnifiedTooltipStyle(isDark);
    return (
      <div style={tooltipStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div>{statLabel}: {formattedValue}</div>
          {(selectedStat === 'pra' || selectedStat === 'pr' || selectedStat === 'ra') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {selectedStat !== 'ra' && <div>PTS: {Number(gameStats?.pts || 0)}</div>}
              <div>REB: {Number(gameStats?.reb || 0)}</div>
              {selectedStat !== 'pr' && <div>AST: {Number(gameStats?.ast || 0)}</div>}
            </div>
          )}
          <div>MINS: {correctMinutes}</div>
          <div>{data.game}</div>
          <div>{correctDate}</div>
        </div>
      </div>
    );
  }, [selectedStat, isDark, currentStatOptions]);

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
          <div className="text-center">
            {apiError && <div className="text-xs text-red-500 mb-2">{apiError}</div>}
            <div className="text-gray-500 dark:text-gray-400 text-lg mb-2">No Data Available</div>
            <div className="text-gray-400 dark:text-gray-500 text-sm">
              {selectedPlayer ? `No ${String(selectedStat).toUpperCase()} data found for ${selectedPlayer.full}` : 'Select a player to view stats'}
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
prev.selectedPlayer === next.selectedPlayer
));

// Per-button memoized components to prevent unrelated re-renders
const StatPill = memo(function StatPill({ label, value, isSelected, onSelect, isDark }: { label: string; value: string; isSelected: boolean; onSelect: (v: string) => void; isDark: boolean }) {
  const onClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
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
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
        isSelected ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {value.replace('last','L')}
    </button>
  );
}, (prev, next) => prev.isSelected === next.isSelected && prev.value === next.value);

// Full chart container isolated from other UI
const ChartContainer = memo(
  function ChartContainer({
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
    overCount,
    totalCount,
  }: any) {
    const StatPills = useMemo(() => (
      <div className="mb-4">
        <div
          className="w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x"
          style={{ scrollbarWidth: 'thin', scrollbarColor: isDark ? '#4b5563 transparent' : '#d1d5db transparent' }}
        >
          <div className="inline-flex flex-nowrap gap-2">
            {currentStatOptions.map((s: any) => (
              <StatPill key={s.key} label={s.label} value={s.key} isSelected={selectedStat === s.key} onSelect={onSelectStat} isDark={isDark} />
            ))}
          </div>
        </div>
      </div>
    ), [isDark, currentStatOptions, selectedStat, onSelectStat]);

    const TimeframeButtons = useMemo(() => (
      <div className="flex items-center gap-2">
        {['last5','last10','last15','last20'].map((k: string) => (
          <TimeframeBtn key={k} value={k} isSelected={selectedTimeframe === k} onSelect={onSelectTimeframe} />
        ))}
      </div>
    ), [selectedTimeframe, onSelectTimeframe]);


    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700 h-[600px] flex flex-col min-w-0 flex-shrink-0">
        {StatPills}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Line:</label>
          <input
            type="number" step="0.5" min="0" value={bettingLine}
            onChange={(e) => onChangeBettingLine(Math.max(0, parseFloat(e.target.value) || 0))}
            className="w-20 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Over Rate:</span>
            <OverRatePill overCount={overCount} total={totalCount} isDark={isDark} />
          </div>
          {TimeframeButtons}
        </div>

        <div className="relative flex-1 min-h-0">
          <div className="h-full w-full">
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
            />
          </div>
        </div>
      </div>
    );
  },
  (prev, next) => (
    prev.isDark === next.isDark &&
    prev.currentStatOptions === next.currentStatOptions &&
    prev.selectedStat === next.selectedStat &&
    prev.bettingLine === next.bettingLine &&
    prev.selectedTimeframe === next.selectedTimeframe &&
    prev.chartData === next.chartData &&
    prev.yAxisConfig === next.yAxisConfig &&
    prev.isLoading === next.isLoading &&
    prev.apiError === next.apiError &&
    prev.selectedPlayer === next.selectedPlayer &&
    prev.overCount === next.overCount &&
    prev.totalCount === next.totalCount
  )
);

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
                const adj = v > 0 ? v - 0.5 : v + 0.5; // toward zero by 0.5
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
  
  // Selected team (player's team)
  const [selectedTeam, setSelectedTeam] = useState<string>('N/A');

  // Injury data state for depth chart integration
  const [teamInjuries, setTeamInjuries] = useState<Record<string, any[]>>({});

  // Logo URLs (stateful to avoid onError flicker loops)
  const [selectedTeamLogoUrl, setSelectedTeamLogoUrl] = useState<string>('');
  const [opponentTeamLogoUrl, setOpponentTeamLogoUrl] = useState<string>('');
  const [selectedTeamLogoAttempt, setSelectedTeamLogoAttempt] = useState<number>(0);
  const [opponentTeamLogoAttempt, setOpponentTeamLogoAttempt] = useState<number>(0);
  
  // Games state
  const [todaysGames, setTodaysGames] = useState<any[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);

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

  // Fetch games function
  const fetchTodaysGames = async () => {
    try {
      setGamesLoading(true);
      
      const formatDate = (date: Date) => {
        return date.toISOString().split('T')[0];
      };
      
      // Try multiple date ranges to find games
      const today = new Date();
      const dateRanges = [
        // Next 2 weeks (for upcoming season start)
        { start: formatDate(today), end: formatDate(new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)) },
        // Season opening week (Oct 21-28, 2025)
        { start: '2025-10-21', end: '2025-10-28' },
        // Today +/- 3 days
        { start: formatDate(new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000)), end: formatDate(new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000)) },
      ];
      
      for (const range of dateRanges) {
        console.log(`🔍 Trying to fetch games from ${range.start} to ${range.end}`);
        
        try {
          const response = await fetch(`/api/bdl/games?start_date=${range.start}&end_date=${range.end}&per_page=100`);
          const data = await response.json();
          
          if (data?.data?.length > 0) {
            console.log(`✅ Found ${data.data.length} games for ${range.start} to ${range.end}`);
            setTodaysGames(data.data);
            return; // Success, exit the loop
          } else {
            console.log(`❌ No games found for ${range.start} to ${range.end}`);
          }
        } catch (rangeError) {
          console.error(`Error fetching games for ${range.start}-${range.end}:`, rangeError);
        }
      }
      
      console.log('❌ No games found in any date range');
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
    if (selectedTeam && selectedTeam !== 'N/A' && todaysGames.length > 0) {
      const opponent = getOpponentTeam(selectedTeam, todaysGames);
      console.log(`🎯 Setting opponent team: ${opponent} for player team: ${selectedTeam}`);
      setOpponentTeam(normalizeAbbr(opponent));
    } else {
      console.log(`⏸️ Not updating opponent - selectedTeam: ${selectedTeam}, games: ${todaysGames.length}`);
    }
  }, [selectedTeam, todaysGames]);




  // Keep logo URL in sync with selectedTeam and opponentTeam, once per change
  useEffect(() => {
    if (selectedTeam && selectedTeam !== 'N/A') {
      setSelectedTeamLogoAttempt(0);
      setSelectedTeamLogoUrl(getEspnLogoUrl(selectedTeam));
    } else {
      setSelectedTeamLogoUrl('');
      setSelectedTeamLogoAttempt(0);
    }
  }, [selectedTeam]);

  useEffect(() => {
    if (opponentTeam) {
      setOpponentTeamLogoAttempt(0);
      setOpponentTeamLogoUrl(getEspnLogoUrl(opponentTeam));
    } else {
      setOpponentTeamLogoUrl('');
      setOpponentTeamLogoAttempt(0);
    }
  }, [opponentTeam]);

  // Fetch injuries for depth chart integration
  useEffect(() => {
    const fetchTeamInjuries = async () => {
      if (!selectedTeam || selectedTeam === 'N/A') {
        setTeamInjuries({});
        return;
      }

      try {
        const response = await fetch(`/api/injuries?teams=${selectedTeam}`);
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
  }, [selectedTeam]);




  // On mount: restore from URL first; else sessionStorage; else default
  useEffect(() => {
    fetchTodaysGames(); // Fetch games on mount

    try {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        const pid = url.searchParams.get('pid');
        const name = url.searchParams.get('name');
        const team = url.searchParams.get('team') || undefined;
        const stat = url.searchParams.get('stat');
        const tf = url.searchParams.get('tf');
        if (stat) setSelectedStat(stat);
        if (tf) setSelectedTimeframe(tf);
        if (pid && name) {
          const r: BdlSearchResult = { id: Number(pid), full: name, team, pos: undefined };
          handlePlayerSelectFromSearch(r);
          return;
        }
      }
    } catch {}

    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedSession>;
        if (saved?.selectedStat) setSelectedStat(saved.selectedStat);
        if (saved?.selectedTimeframe) setSelectedTimeframe(saved.selectedTimeframe);
        const r = saved?.player as BdlSearchResult | undefined;
        if (r && r.id && r.full) {
          handlePlayerSelectFromSearch(r);
          return;
        }
      }
    } catch {}

    (async () => {
      const p = getPlayerById('237');
      if (!p) return;
      await handlePlayerSelectFromLocal(p);
    })();
  }, []);

  /* --------- Live search (debounced) using /api/bdl/players ---------- */
  useEffect(() => {
    let t: any;
    const run = async () => {
      const q = searchQuery.trim();
      setSearchError(null);
      if (q.length < 2) { setSearchResults([]); return; }
      setSearchBusy(true);
      try {
        const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(q)}`);
        const json = await res.json().catch(() => ({}));
        const err = json?.error || null;
        setSearchError(err);
        const arr: BdlSearchResult[] = Array.isArray(json?.results)
          ? json.results.map((r: any) => ({ id: r.id, full: r.full, team: r.team, pos: r.pos }))
          : [];
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
      if (selectedPlayer && selectedTeam) {
        const r: BdlSearchResult = {
          id: Number(resolvedPlayerId || selectedPlayer.id),
          full: selectedPlayer.full,
          team: selectedTeam,
          pos: (selectedPlayer as any).position || undefined,
        };
        const toSave: SavedSession = {
          player: r,
          selectedStat,
          selectedTimeframe,
        };
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(toSave));
          // Update URL for share/save
          const url = new URL(window.location.href);
          url.searchParams.set('pid', String(r.id));
          url.searchParams.set('name', r.full);
          url.searchParams.set('team', selectedTeam);
          url.searchParams.set('stat', selectedStat);
          url.searchParams.set('tf', selectedTimeframe);
          window.history.replaceState({}, '', url.toString());
        }
      }
    } catch {}
  }, [selectedPlayer, selectedTeam, selectedStat, selectedTimeframe, resolvedPlayerId]);

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

  // Fetch stats (newest first); merge current + previous season so "last N" can span seasons
  const fetchSortedStats = async (playerId: string) => {
    const season = currentNbaSeason();
    const grab = async (yr: number, postseason = false) => {
      const r = await fetch(`/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=3&postseason=${postseason}`);
      const j = await r.json().catch(() => ({}));
      return (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
    };

    // Fetch current + previous, both regular and playoffs
    const [currReg, currPO, prevReg, prevPO] = await Promise.all([
      grab(season, false),
      grab(season, true),
      grab(season - 1, false),
      grab(season - 1, true)
    ]);

    // Merge then sort newest-first; downstream will dedupe and slice to timeframe
    const rows = [...currReg, ...currPO, ...prevReg, ...prevPO];
    const safe = rows.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
    safe.sort((a, b) => {
      const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return db - da; // newest first
    });
    return safe;
  };
  
  // Fetch advanced stats for a player
  const fetchAdvancedStats = async (playerId: string) => {
    setAdvancedStatsLoading(true);
    setAdvancedStatsError(null);
    try {
      const playerIdNum = parseInt(playerId);
      if (isNaN(playerIdNum)) {
        throw new Error('Invalid player ID');
      }
      
      // Use current NBA season, same as fetchSortedStats
      const season = currentNbaSeason();
      const stats = await BallDontLieAPI.getAdvancedStats([playerIdNum], String(season));
      if (stats.length > 0) {
        setAdvancedStats(stats[0]);
      } else {
        // If no current season stats, try previous season
        const statsPrevious = await BallDontLieAPI.getAdvancedStats([playerIdNum], String(season - 1));
        if (statsPrevious.length > 0) {
          setAdvancedStats(statsPrevious[0]);
        } else {
          setAdvancedStats(null);
          setAdvancedStatsError('No advanced stats found for this player');
        }
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
      
      // Parse ESPN height data and merge with sample player data
      const heightData = parseEspnHeight(espnData?.height);
      
      setSelectedPlayer({
        ...player,
        jersey: espnData?.jersey || player.jersey || '',
        heightFeet: heightData.feet || player.heightFeet,
        heightInches: heightData.inches || player.heightInches,
      });
      
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

  // header info - use dynamic team detection instead of static team data
  const playerInfo = {
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

  /* -------- Base game data (structure only, no stat values) ----------
     This should only recalculate when player/timeframe changes, NOT when stat changes */
  const baseGameData = useMemo(() => {
    if (!playerStats.length) return [];
    
    // Filter out games where player played 0 minutes FIRST
    const gamesPlayed = playerStats.filter(stats => {
      const minutes = parseMinutes(stats.min);
      return minutes > 0;
    });
    
    // THEN apply timeframe to get exact number of played games
    const n = parseInt(selectedTimeframe.replace('last', ''));
    const newestFirst = !Number.isNaN(n) ? gamesPlayed.slice(0, n) : gamesPlayed;
    
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
  }, [playerStats, selectedTimeframe, selectedPlayer]); // Removed selectedStat dependency!
  
  /* -------- Chart data with current stat values ----------
     Only recalculate values when selectedStat changes */
  const chartData = useMemo(() => {
    return baseGameData.map(game => ({
      ...game,
      value: getStatValue(game.stats, selectedStat) ?? 0,
    }));
  }, [baseGameData, selectedStat]);

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
      
      // Always calculate fresh from the stats object
      const gameStats = data.stats;
      const correctMinutes = gameStats?.min ?? "0:00";
      
      let correctDate = "Unknown Date";
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
      
      // Use inline styles to avoid theme dependency
      const tooltipStyle = getUnifiedTooltipStyle(isDark);
      
      return (
        <div style={tooltipStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>{statLabel}: {formattedValue}</div>
            {(selectedStat === 'pra' || selectedStat === 'pr' || selectedStat === 'ra') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {selectedStat !== 'ra' && <div>PTS: {Number(gameStats?.pts || 0)}</div>}
                <div>REB: {Number(gameStats?.reb || 0)}</div>
                {selectedStat !== 'pr' && <div>AST: {Number(gameStats?.ast || 0)}</div>}
              </div>
            )}
            <div>MINS: {correctMinutes}</div>
            <div>{data.game}</div>
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
    
    let maxYAxis;
    let increment;
    
    if (isPercentageStat) {
      maxYAxis = 100;
      increment = 5; // Percentages use 5-increment ticks
    } else if (isSmallIncrementStat) {
      // For 3PM, use 3PA values for Y-axis calculation to show proper scale
      let maxValue;
      if (selectedStat === 'fg3m') {
        maxValue = Math.max(...chartData.map(d => d.stats?.fg3a || 0));
        maxYAxis = Math.ceil(maxValue); // For 3PM, don't add extra increment - top bar should touch Y-axis max
      } else {
        maxValue = Math.max(...chartData.map(d => d.value));
        maxYAxis = Math.ceil(maxValue) + 1; // Round up to next 1-increment
      }
      increment = 1; // Use 1-increment ticks for smaller stats
    } else {
      const maxValue = Math.max(...chartData.map(d => d.value));
      maxYAxis = Math.ceil((maxValue + 1) / 5) * 5; // Round up to next 5-increment
      increment = 5; // Use 5-increment ticks for larger stats like points, minutes
    }
    
    // Generate ticks based on the increment
    const ticks = [];
    for (let i = 0; i <= maxYAxis; i += increment) {
      ticks.push(i);
    }
    
    return { domain: [0, maxYAxis], ticks };
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
      <div className="ml-64 mr-24 p-6 min-h-0">
        <div className="flex gap-6 min-h-0">
          {/* Left */}
          <div 
className="flex-[7] min-w-0 min-h-0 flex flex-col gap-6 overflow-y-auto pr-4 overscroll-contain"
            style={{
              height: 'calc(100vh - 3rem)',
              scrollbarWidth: 'thin',
              scrollbarColor: isDark ? '#4b5563 transparent' : '#d1d5db transparent'
            }}
          >
            {/* Header */}
<div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700 h-32 flex-shrink-0">
              <div className="flex items-center justify-between h-full">
                <div className="flex-shrink-0">
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

                {/* Search (live via /api/bdl/players) */}
                <div className="flex-1 max-w-md mx-8">
                  <div className="relative" ref={searchRef}>
                    <input
                      type="text"
                      placeholder={searchBusy ? "Searching..." : "Search for a player..."}
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                      onFocus={() => setShowDropdown(true)}
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    {showDropdown && searchQuery && (
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
                  </div>
                </div>

                {/* Team vs Team Display */}
                <div className="flex-shrink-0">
                  {selectedTeam && opponentTeam && selectedTeam !== 'N/A' && opponentTeam !== '' ? (
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
              isLoading={isLoading}
              apiError={apiError}
              selectedPlayer={selectedPlayer}
              overCount={hitRateStats.overCount}
              totalCount={chartData.length}
            />

            {/* Under-chart container (memoized element to avoid parent re-evals) */}
            {useMemo(() => (
              <OfficialOddsCard
                isDark={isDark}
                derivedOdds={derivedOdds}
                intradayMovements={intradayMovements}
                selectedTeam={selectedTeam}
                opponentTeam={opponentTeam}
                selectedTeamLogoUrl={selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)}
                opponentTeamLogoUrl={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                matchupInfo={matchupInfo}
                oddsFormat={oddsFormat}
                books={realOddsData}
                fmtOdds={fmtOdds}
              />
            ), [isDark, derivedOdds, intradayMovements, selectedTeam, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds])}

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
                      const home = selectedTeam || 'HOME';
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
            ), [isDark, oddsLoading, oddsError, realOddsData, selectedTeam, opponentTeam, oddsFormat, fmtOdds])}

            {/* Depth Chart (ESPN) - Memoized to prevent re-renders from betting line changes */}
            {useMemo(() => (
              <DepthChartContainer
                selectedTeam={selectedTeam}
                teamInjuries={teamInjuries}
                isDark={isDark}
                onPlayerSelect={setSelectedPlayer}
                selectedPlayerName={(() => {
                  if (!selectedPlayer) return '';
                  const fullName = selectedPlayer.full;
                  const constructedName = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
                  const finalName = fullName || constructedName;
                  return finalName;
                })()}
              />
            ), [selectedTeam, teamInjuries, isDark, setSelectedPlayer, selectedPlayer])}

            {/* Player Box Score - Memoized to prevent re-renders from chart changes */}
            {useMemo(() => (
              <PlayerBoxScore
                selectedPlayer={selectedPlayer}
                playerStats={playerStats}
                isDark={isDark}
              />
            ), [selectedPlayer, playerStats, isDark])}

          </div>


          {/* Right Panel */}
          <div 
            className="flex-[3] flex flex-col gap-6 h-screen max-h-screen overflow-y-auto pr-4" 
            style={{
              height: 'calc(100vh - 3rem)',
              scrollbarWidth: 'thin',
              scrollbarColor: isDark ? '#4b5563 transparent' : '#d1d5db transparent'
            }}
          >

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-6 pt-2 pb-4 border border-gray-200 dark:border-gray-700 h-32">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filter By</h3>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setPropsMode('player');
                    if (!PLAYER_STAT_OPTIONS.find(s => s.key === selectedStat)) {
                      setSelectedStat('pts');
                    }
                  }}
                  className={`px-6 py-3 rounded-lg text-base font-medium transition-colors ${
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
                    if (!TEAM_STAT_OPTIONS.find(s => s.key === selectedStat)) {
                      setSelectedStat('total_pts');
                    }
                  }}
                  className={`px-6 py-3 rounded-lg text-base font-medium transition-colors ${
                    propsMode === 'team'
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  Game Props
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {propsMode === 'player' ? 'Analyze individual player statistics and props' : 'Analyze game totals, spreads, and game-based props'}
              </p>
            </div>
            
            {/* Combined Opponent Analysis & Team Matchup - only shows for player mode */}
            {propsMode === 'player' && (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
                {/* Section 1: Opponent Analysis */}
                <OpponentAnalysisCard isDark={isDark} opponentTeam={opponentTeam} selectedTimeFilter={selectedTimeFilter} />

                {/* Section 2: Team Matchup with Pie Chart */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-600">
                  <h4 className="text-md font-semibold text-gray-900 dark:text-white mb-4">Team Matchup</h4>
                  
                  {/* Comparison Metric Selector */}
                  <div className="mb-4">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSelectedComparison('offense_defense')}
                        className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                          selectedComparison === 'offense_defense'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        OFF vs DEF
                      </button>
                      <button
                        onClick={() => setSelectedComparison('net_rating')}
                        className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                          selectedComparison === 'net_rating'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        NET RTG
                      </button>
                      <button
                        onClick={() => setSelectedComparison('pace')}
                        className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                          selectedComparison === 'pace'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        PACE
                      </button>
                      <button
                        onClick={() => setSelectedComparison('rebound_pct')}
                        className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                          selectedComparison === 'rebound_pct'
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        }`}
                      >
                        REB %
                      </button>
                    </div>
                  </div>

                  {/* Pie Chart Visualization */}
                  <div className="space-y-4">
                      <div className="flex items-center justify-between h-48 w-full gap-10">
                        {(() => {
                          let teamValue, opponentValue, isInverted = false;
                          
                          switch (selectedComparison) {
                            case 'offense_defense':
                              teamValue = teamRatings[selectedTeam]?.offensive || 0;
                              opponentValue = teamRatings[opponentTeam]?.defensive || 0;
                              break;
                            case 'net_rating':
                              teamValue = teamRatings[selectedTeam]?.net || 0;
                              opponentValue = teamRatings[opponentTeam]?.net || 0;
                              break;
                            case 'pace':
                              teamValue = getTeamPace(selectedTeam);
                              opponentValue = getTeamPace(opponentTeam);
                              break;
                            case 'rebound_pct':
                              teamValue = getTeamReboundPct(selectedTeam);
                              opponentValue = getTeamReboundPct(opponentTeam);
                              break;
                            default:
                              teamValue = 0;
                              opponentValue = 0;
                          }

                          if (selectedComparison === 'offense_defense') {
                            isInverted = true; // Lower defensive rating is better
                          }

                          const pieData = createTeamComparisonPieData(
                            teamValue,
                            opponentValue,
                            selectedTeam,
                            opponentTeam,
                            isInverted,
                            /* amplify */ (selectedComparison !== 'net_rating' && selectedComparison !== 'offense_defense'),
                            /* useAbs */ false,
                            /* clampNegatives */ selectedComparison === 'net_rating',
                            /* baseline */ selectedComparison === 'net_rating' ? 1 : (selectedComparison === 'offense_defense' ? 5 : 0),
                            /* invertOppForShare */ selectedComparison === 'offense_defense',
                            /* invertMax */ selectedComparison === 'offense_defense' ? 180 : 130,
                            /* ampBoost */ selectedComparison === 'rebound_pct' ? 3.0 : (selectedComparison === 'pace' ? 2.0 : 1.0)
                          );

                          // Always draw player's team on LEFT: flip draw order so team slice renders second
                          const pieDrawData = [pieData?.[1], pieData?.[0]];

                          const teamDisplayRaw = pieData?.[0]?.displayValue ?? '';
                          const oppDisplayRaw = pieData?.[1]?.displayValue ?? '';
                          const teamDisplay = selectedComparison === 'rebound_pct' ? `${teamDisplayRaw}%` : teamDisplayRaw;
                          const oppDisplay = selectedComparison === 'rebound_pct' ? `${oppDisplayRaw}%` : oppDisplayRaw;
                          const teamColor = pieData?.[0]?.fill || '#22c55e';
                          const oppColor = pieData?.[1]?.fill || '#ef4444';

                          // Compute ranks for current comparison
                          let teamRank: number | null = null;
                          let oppRank: number | null = null;
                          switch (selectedComparison) {
                            case 'offense_defense':
                              teamRank = getTeamRank(selectedTeam, 'offensive');
                              oppRank = getTeamRank(opponentTeam, 'defensive');
                              break;
                            case 'net_rating':
                              teamRank = getTeamRank(selectedTeam, 'net');
                              oppRank = getTeamRank(opponentTeam, 'net');
                              break;
                            case 'pace':
                              teamRank = getPaceRank(selectedTeam);
                              oppRank = getPaceRank(opponentTeam);
                              break;
                            case 'rebound_pct':
                              teamRank = getReboundRank(selectedTeam);
                              oppRank = getReboundRank(opponentTeam);
                              break;
                            default:
                              teamRank = null; oppRank = null;
                          }

                          return (
                            <div className="w-full">
                              <div className="flex items-center justify-between h-48 w-full gap-6 md:gap-8">
                                {/* Left value */}
                                <div className="w-32 text-right text-sm font-semibold pr-2 md:pr-4" style={{ color: teamColor }}>
                                  <div className="truncate">{selectedTeam}</div>
                                  <div>{teamDisplay}</div>
                                  <div className="text-xs" style={{ color: teamColor, opacity: 0.85 }}>
                                    {teamRank ? `Rank: ${getOrdinalSuffix(teamRank)}` : 'Rank: —'}
                                  </div>
                                </div>

                                {/* Pie */}
                                <div className="h-44 w-44 md:w-56 md:h-56 flex-shrink-0 select-none"
                                  onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  onMouseUpCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  style={{ userSelect: 'none' }}
                                >
                                  <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                      <Pie
                                        data={pieDrawData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={40}
                                        outerRadius={80}
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
                                        wrapperStyle={{ outline: 'none' }}
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

                                {/* Right value */}
                                <div className="w-28 md:w-32 text-left text-sm font-semibold pl-2 md:pl-4" style={{ color: oppColor }}>
                                  <div className="truncate">{opponentTeam || 'TBD'}</div>
                                  <div>{oppDisplay}</div>
                                  <div className="text-xs" style={{ color: oppColor, opacity: 0.85 }}>
                                    {oppRank ? `Rank: ${getOrdinalSuffix(oppRank)}` : 'Rank: —'}
                                  </div>
                                </div>
                              </div>

                              {/* Dynamic Legend matching slice colors */}
                              <div className="flex items-center justify-center gap-4 text-xs mt-3">
                                <div className="flex items-center gap-1">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: teamColor }}></div>
                                  <span className="text-gray-600 dark:text-gray-300">{selectedTeam}</span>
                                </div>
                                <div className="text-gray-400">vs</div>
                                <div className="flex items-center gap-1">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: oppColor }}></div>
                                  <span className="text-gray-600 dark:text-gray-300">{opponentTeam || 'TBD'}</span>
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
            )}

            {/* Advanced Player Stats */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Advanced Analytics</h3>
              <div className="space-y-4">
                {advancedStats ? (
                  <div className="grid grid-cols-2 gap-4">
                    {/* Left Column: Offensive & Defensive */}
                    <div className="space-y-3">
                      {/* Offensive Metrics */}
                      <div>
                        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Offensive</h4>
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
                        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Defensive</h4>
                        <div className="space-y-1">
                          <StatTooltip statName="DEF RTG" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.defensive_rating ? 'text-gray-400' :
                              advancedStats.defensive_rating <= 108 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.defensive_rating <= 112 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.defensive_rating?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Points allowed per 100 possessions. NBA avg: 112. Elite: ≤108" />
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
                    <div className="space-y-3">
                      {/* Overall Impact */}
                      <div>
                        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Impact</h4>
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
                        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Rebounding</h4>
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
                        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600 pb-1">Playmaking</h4>
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
                          } definition="Assists ÷ turnovers. NBA avg: 1.8. Elite: 2.0+" />
                          <StatTooltip statName="TO RATIO" value={
                            <span className={`text-xs font-semibold ${
                              !advancedStats.turnover_ratio ? 'text-gray-400' :
                              advancedStats.turnover_ratio <= 12 ? 'text-green-600 dark:text-green-400' :
                              advancedStats.turnover_ratio <= 16 ? 'text-orange-500 dark:text-orange-400' : 'text-red-500 dark:text-red-400'
                            }`}>
                              {advancedStats.turnover_ratio?.toFixed(1) || 'N/A'}
                            </span>
                          } definition="Turnovers per 100 possessions. NBA avg: 14. Elite: ≤12" />
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
            </div>

            {/* ESPN Injury Report */}
            <InjuryContainer
              selectedTeam={selectedTeam}
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
