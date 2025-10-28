// Shared NBA constants and utilities
// Single source of truth for team mappings and season calculations

/**
 * Ball Don't Lie team ID to abbreviation mapping
 */
export const TEAM_ID_TO_ABBR: Record<number, string> = {
  1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
  11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
  21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
} as const;

/**
 * Reverse mapping: abbreviation to team ID
 */
export const ABBR_TO_TEAM_ID: Record<string, number> = Object.fromEntries(
  Object.entries(TEAM_ID_TO_ABBR).map(([id, abbr]) => [abbr, parseInt(id, 10)])
);

/**
 * Team abbreviation to full name mapping
 */
export const TEAM_FULL_NAMES: Record<string, string> = {
  'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets', 'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers', 'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons', 'GSW': 'Golden State Warriors', 'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies', 'MIA': 'Miami Heat',
  'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves', 'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks',
  'OKC': 'Oklahoma City Thunder', 'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs', 'TOR': 'Toronto Raptors',
  'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards'
} as const;

/**
 * Calculate the current NBA season year
 * NBA season starts around October 15th and runs through June
 * Season year is the year it starts (e.g., 2024-25 season = 2024)
 */
export function currentNbaSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 0=Jan, 9=Oct, 11=Dec
  const day = now.getDate();
  
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

/**
 * Get team full name from abbreviation
 */
export function getTeamFullName(abbr: string): string {
  return TEAM_FULL_NAMES[abbr] || abbr;
}

/**
 * Get team ID from abbreviation
 */
export function getTeamId(abbr: string): number | null {
  return ABBR_TO_TEAM_ID[abbr] ?? null;
}

/**
 * Get team abbreviation from ID
 */
export function getTeamAbbr(id: number): string | null {
  return TEAM_ID_TO_ABBR[id] ?? null;
}
