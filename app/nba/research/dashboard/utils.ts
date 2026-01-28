// Utility functions for NBA Dashboard

import { normalizeAbbr } from '@/lib/nbaAbbr';
import { ABBR_TO_TEAM_ID } from './constants';
import type { BallDontLieStats, BallDontLieGame } from './types';

export const getNthWeekdayOfMonthUtc = (year: number, month: number, weekday: number, nth: number) => {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstWeekdayOffset = (weekday - firstOfMonth.getUTCDay() + 7) % 7;
  const day = 1 + firstWeekdayOffset + (nth - 1) * 7;
  return new Date(Date.UTC(year, month, day));
};

export const getEasternOffsetMinutes = (date: Date) => {
  const year = date.getUTCFullYear();
  const startDst = getNthWeekdayOfMonthUtc(year, 2, 0, 2); // Second Sunday in March
  startDst.setUTCHours(7, 0, 0, 0); // 2 AM ET -> 7 AM UTC during standard time
  const endDst = getNthWeekdayOfMonthUtc(year, 10, 0, 1); // First Sunday in November
  endDst.setUTCHours(6, 0, 0, 0); // 2 AM ET -> 6 AM UTC during daylight time
  const isDst = date >= startDst && date < endDst;
  return isDst ? -240 : -300; // minutes offset from UTC
};

export const parseBallDontLieTipoff = (game: any): Date | null => {
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

export function currentNbaSeason(): number {
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

export function parseMinutes(minStr: string): number {
  if (!minStr || minStr === '0:00') return 0;
  const [m, s] = minStr.split(':').map(Number);
  return (Number.isFinite(m) ? m : 0) + ((Number.isFinite(s) ? s : 0) / 60);
}

export function getStatValue(stats: BallDontLieStats, key: string): number {
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
    case 'double_double': {
      const count = [stats.pts, stats.reb, stats.ast, stats.stl ?? 0, stats.blk ?? 0].filter(v => (v || 0) >= 10).length;
      return count >= 2 ? 1 : 0;
    }
    case 'triple_double': {
      const count = [stats.pts, stats.reb, stats.ast, stats.stl ?? 0, stats.blk ?? 0].filter(v => (v || 0) >= 10).length;
      return count >= 3 ? 1 : 0;
    }
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

export function getGameStatValue(game: any, key: string, teamAbbr: string): number {
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

export const mergeBookRowsByBaseName = (books: any[], skipMerge = false): any[] => {
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

  // Optimized clone function - replaces expensive JSON.parse(JSON.stringify())
  const cloneBookRow = (book: any): any => {
    const clone: any = { ...book };
    // Clone nested objects
    if (book.H2H) clone.H2H = { ...book.H2H };
    if (book.Spread) clone.Spread = { ...book.Spread };
    if (book.Total) clone.Total = { ...book.Total };
    if (book.PTS) clone.PTS = { ...book.PTS };
    if (book.REB) clone.REB = { ...book.REB };
    if (book.AST) clone.AST = { ...book.AST };
    if (book.THREES) clone.THREES = { ...book.THREES };
    if (book.PRA) clone.PRA = { ...book.PRA };
    if (book.PR) clone.PR = { ...book.PR };
    if (book.PA) clone.PA = { ...book.PA };
    if (book.RA) clone.RA = { ...book.RA };
    if (book.BLK) clone.BLK = { ...book.BLK };
    if (book.STL) clone.STL = { ...book.STL };
    if (book.TO) clone.TO = { ...book.TO };
    if (book.DD) clone.DD = { ...book.DD };
    if (book.TD) clone.TD = { ...book.TD };
    if (book.FIRST_BASKET) clone.FIRST_BASKET = { ...book.FIRST_BASKET };
    if (book.meta) clone.meta = { ...book.meta };
    return clone;
  };

  for (const book of books || []) {
    const baseNameRaw = (book as any)?.meta?.baseName || book?.name || '';
    const baseKey = baseNameRaw.toLowerCase();
    const displayName = baseNameRaw || book?.name || 'Book';

    if (!mergedMap.has(baseKey)) {
      const clone = cloneBookRow(book);
      clone.name = displayName;
      mergedMap.set(baseKey, clone);
      order.push(baseKey);
      continue;
    }

    const target = mergedMap.get(baseKey);

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
          // Clone object if it's a nested object, otherwise use spread
          target[key] = typeof sourceVal === 'object' && sourceVal !== null && !Array.isArray(sourceVal)
            ? { ...sourceVal }
            : sourceVal;
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

export const getOpponentDefensiveRank = (teamAbbr: string, statType: 'ptsAllowed' | 'rebAllowed' | 'astAllowed' | 'fgmAllowed' | 'fgaAllowed' | 'fg3mAllowed' | 'fg3aAllowed' | 'stlAllowed' | 'blkAllowed'): number => {
  // Import dynamically to avoid circular dependency
  const { opponentDefensiveStats } = require('./constants');
  
  const teamsWithStats = Object.entries(opponentDefensiveStats).map(([team, stats]: [string, any]) => ({
    team,
    value: stats[statType] || 999
  }));

  teamsWithStats.sort((a, b) => a.value - b.value);

  const rank = teamsWithStats.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30;
};

export const getOpponentDefensiveRankColor = (rank: number): string => {
  if (rank >= 25) return 'text-green-500';
  if (rank >= 19) return 'text-green-400';
  if (rank >= 13) return 'text-orange-500';
  if (rank >= 7) return 'text-red-400';
  return 'text-red-500';
};

export const getOrdinalSuffix = (num: number): string => {
  const lastDigit = num % 10;
  const lastTwoDigits = num % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return num + 'th';
  }
  
  switch (lastDigit) {
    case 1: return num + 'st';
    case 2: return num + 'nd';
    case 3: return num + 'rd';
    default: return num + 'th';
  }
};

export const getTeamRating = (teamAbbr: string, type: 'offensive' | 'defensive' | 'net') => {
  const { teamRatings } = require('./constants');
  return teamRatings[teamAbbr]?.[type] ?? 0.0;
};

export const getTeamRank = (teamAbbr: string, type: 'offensive' | 'defensive' | 'net') => {
  const { teamRatings } = require('./constants');
  
  const teamsWithRatings = Object.entries(teamRatings).map(([team, ratings]: [string, any]) => ({
    team,
    rating: ratings[type] || 0
  }));

  teamsWithRatings.sort((a, b) => {
    if (type === 'defensive') {
      return a.rating - b.rating;
    }
    return b.rating - a.rating;
  });

  const rank = teamsWithRatings.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30;
};

export const getTeamPace = (teamAbbr: string): number => {
  const { teamPace } = require('./constants');
  return teamPace[teamAbbr] ?? 0.0;
};

export const getTeamReboundPct = (teamAbbr: string): number => {
  const { teamReboundPct } = require('./constants');
  return teamReboundPct[teamAbbr] ?? 0.0;
};

export const getPaceRank = (teamAbbr: string): number => {
  const { teamPace } = require('./constants') as { teamPace: Record<string, number> };
  const paceArray = Object.entries(teamPace).map(([team, pace]) => ({ team, pace: pace as number }));
  paceArray.sort((a, b) => b.pace - a.pace);
  const rank = paceArray.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30;
};

export const getReboundRank = (teamAbbr: string): number => {
  const { teamReboundPct } = require('./constants') as { teamReboundPct: Record<string, number> };
  const reboundArray = Object.entries(teamReboundPct).map(([team, rebPct]) => ({ team, rebPct: rebPct as number }));
  reboundArray.sort((a, b) => b.rebPct - a.rebPct);
  const rank = reboundArray.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30;
};

export const getRankColor = (rank: number, type: 'offensive' | 'defensive' | 'net' | 'pace' | 'rebound' | 'opponent_rebound' | 'opponent_net'): string => {
  if (type === 'offensive' || type === 'net' || type === 'pace' || type === 'rebound') {
    if (rank <= 6) return 'text-green-500';
    if (rank <= 12) return 'text-green-400';
    if (rank <= 18) return 'text-orange-500';
    if (rank <= 24) return 'text-red-400';
    return 'text-red-500';
  } else if (type === 'opponent_rebound' || type === 'opponent_net') {
    if (rank >= 25) return 'text-green-500';
    if (rank >= 19) return 'text-green-400';
    if (rank >= 13) return 'text-orange-500';
    if (rank >= 7) return 'text-red-400';
    return 'text-red-500';
  } else {
    if (rank >= 25) return 'text-green-500';
    if (rank >= 19) return 'text-green-400';
    if (rank >= 13) return 'text-orange-500';
    if (rank >= 7) return 'text-red-400';
    return 'text-red-500';
  }
};

export const getPlayerCurrentTeam = (playerStats: BallDontLieStats[]): string => {
  if (!playerStats.length) return 'N/A';
  
  const sortedStats = playerStats
    .filter(stat => stat?.game?.date && stat?.team?.abbreviation)
    .sort((a, b) => {
      const dateA = new Date(a.game?.date || 0).getTime();
      const dateB = new Date(b.game?.date || 0).getTime();
      return dateB - dateA;
    });
  
  for (const stat of sortedStats.slice(0, 10)) {
    const teamAbbr = stat?.team?.abbreviation;
    if (teamAbbr) {
      return teamAbbr;
    }
  }
  
  return 'N/A';
};

export const getOpponentTeam = (currentTeam: string, todaysGames: any[]): string => {
  if (!currentTeam || currentTeam === 'N/A' || !todaysGames.length) {
    return '';
  }
  
  const normCurrentTeam = normalizeAbbr(currentTeam);
  
  for (let i = 0; i < todaysGames.length; i++) {
    const game = todaysGames[i];
    const homeTeam = normalizeAbbr(game.home_team?.abbreviation || '');
    const visitorTeam = normalizeAbbr(game.visitor_team?.abbreviation || '');
    
    if (homeTeam === normCurrentTeam || visitorTeam === normCurrentTeam) {
      const status = String(game.status || '').toLowerCase();
      const isFinal = status.includes('final') || status.includes('completed');
      
      if (!isFinal) {
        if (homeTeam === normCurrentTeam && visitorTeam) {
          return visitorTeam;
        }
        if (visitorTeam === normCurrentTeam && homeTeam) {
          return homeTeam;
        }
      }
    }
  }
  
  return '';
};

export const resolveTeammateIdFromNameLocal = async (name: string, teamAbbr?: string): Promise<number | null> => {
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
    let results = await tryFetch(name);
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

