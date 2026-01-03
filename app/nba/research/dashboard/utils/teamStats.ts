// Opponent defensive stats data (2024-25 season)
export const opponentDefensiveStats: Record<string, {
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
export const getOpponentDefensiveRank = (teamAbbr: string, statType: 'ptsAllowed' | 'rebAllowed' | 'astAllowed' | 'fgmAllowed' | 'fgaAllowed' | 'fg3mAllowed' | 'fg3aAllowed' | 'stlAllowed' | 'blkAllowed'): number => {
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
export const getOpponentDefensiveRankColor = (rank: number): string => {
  // For opponent defense: higher rank = worse defense = better for your player
  if (rank >= 25) return 'text-green-500';       // Excellent (25th-30th worst defense)
  if (rank >= 19) return 'text-green-400';       // Very good (19th-24th)
  if (rank >= 13) return 'text-orange-500';      // Okay (13th-18th)
  if (rank >= 7) return 'text-red-400';          // Pretty bad (7th-12th)
  return 'text-red-500';                         // Bad (1st-6th best defense)
};

// NBA Team Ratings Data (2024-25 Season) - Offensive and Defensive Ratings
export const teamRatings: Record<string, { offensive: number; defensive: number; net: number }> = {
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
export const teamPace: Record<string, number> = {
  'MEM': 103.69, 'CHI': 103.61, 'ATL': 103.41, 'WAS': 101.82, 'OKC': 100.90,
  'UTA': 100.85, 'IND': 100.76, 'DEN': 100.67, 'TOR': 100.62, 'CLE': 100.31,
  'DET': 100.27, 'DAL': 100.15, 'SAS': 100.08, 'MIL': 99.92, 'NOP': 99.77,
  'POR': 99.51, 'GSW': 99.37, 'HOU': 99.03, 'SAC': 98.91, 'LAL': 98.34,
  'PHX': 98.31, 'LAC': 98.24, 'CHA': 98.22, 'PHI': 98.13, 'MIN': 97.95,
  'NYK': 97.64, 'MIA': 97.08, 'BKN': 96.73, 'BOS': 96.59, 'ORL': 96.51
};

// NBA Team Rebound Percentage Data (2024-25 Season)
export const teamReboundPct: Record<string, number> = {
  'MEM': 58.8, 'CHI': 58.5, 'ATL': 57.9, 'WAS': 54.6, 'OKC': 59.3,
  'UTA': 56.8, 'IND': 59.4, 'DEN': 60.4, 'TOR': 55.3, 'CLE': 60.7,
  'DET': 58.0, 'DAL': 58.3, 'SAS': 57.5, 'MIL': 59.8, 'NOP': 55.2,
  'POR': 55.5, 'GSW': 56.8, 'HOU': 55.3, 'SAC': 58.2, 'LAL': 59.3,
  'PHX': 59.5, 'LAC': 58.9, 'CHA': 53.7, 'PHI': 56.3, 'MIN': 58.8,
  'NYK': 58.9, 'MIA': 57.6, 'BKN': 55.2, 'BOS': 59.1, 'ORL': 55.0
};

// Get team ratings with fallback
export const getTeamRating = (teamAbbr: string, type: 'offensive' | 'defensive' | 'net') => {
  return teamRatings[teamAbbr]?.[type] ?? 0.0;
};

// Get team rank for a specific rating type
export const getTeamRank = (teamAbbr: string, type: 'offensive' | 'defensive' | 'net') => {
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
export const getTeamPace = (teamAbbr: string): number => {
  return teamPace[teamAbbr] ?? 0.0;
};

// Get rebound percentage for a team
export const getTeamReboundPct = (teamAbbr: string): number => {
  return teamReboundPct[teamAbbr] ?? 0.0;
};

// Get pace rank for a team (higher pace = better for overs)
export const getPaceRank = (teamAbbr: string): number => {
  const paceArray = Object.entries(teamPace).map(([team, pace]) => ({ team, pace }));
  paceArray.sort((a, b) => b.pace - a.pace); // Higher pace = better rank
  const rank = paceArray.findIndex(t => t.team === teamAbbr) + 1;
  return rank > 0 ? rank : 30;
};

// Add ordinal suffix to numbers (1st, 2nd, 3rd, 4th, etc.)
export const getOrdinalSuffix = (num: number): string => {
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

