// Team analysis and comparison utility functions

import { BallDontLieStats } from '../types';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { teamReboundPct } from './teamStats';

// Get rebound percentage rank for a team (higher rebound % = better for overs)
export const getReboundRank = (teamAbbr: string): number => {
  const reboundArray = Object.entries(teamReboundPct).map(([team, rebPct]) => ({ team, rebPct }));
  reboundArray.sort((a, b) => b.rebPct - a.rebPct); // Higher rebound % = better rank
  const rank = reboundArray.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30;
};

// Get color based on team rank for overs betting (5-tier system)
export const getRankColor = (rank: number, type: 'offensive' | 'defensive' | 'net' | 'pace' | 'rebound' | 'opponent_rebound' | 'opponent_net'): string => {
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
export const createTeamComparisonPieData = (
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
export const getPlayerCurrentTeam = (playerStats: BallDontLieStats[]): string => {
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
      return teamAbbr;
    }
  }
  return 'N/A';
};

// Get opponent team from games schedule
export const getOpponentTeam = (currentTeam: string, todaysGames: any[]): string => {
  if (!currentTeam || currentTeam === 'N/A' || !todaysGames.length) {
    return '';
  }
  
  // Normalize the current team for comparison
  const normCurrentTeam = normalizeAbbr(currentTeam);
  
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
      
      // Skip final games and look for upcoming games
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


