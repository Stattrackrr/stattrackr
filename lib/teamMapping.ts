/**
 * Maps between team abbreviations and full names used by The Odds API
 */

export const TEAM_FULL_TO_ABBR: Record<string, string> = {
  // Eastern Conference
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Detroit Pistons': 'DET',
  'Indiana Pacers': 'IND',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'New York Knicks': 'NYK',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Toronto Raptors': 'TOR',
  'Washington Wizards': 'WAS',
  
  // Western Conference
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Los Angeles Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'Oklahoma City Thunder': 'OKC',
  'Phoenix Suns': 'PHX',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Utah Jazz': 'UTA',
};

export const TEAM_ABBR_TO_FULL: Record<string, string> = Object.fromEntries(
  Object.entries(TEAM_FULL_TO_ABBR).map(([full, abbr]) => [abbr, full])
);

/**
 * Convert team abbreviation to full name
 */
export function getFullTeamName(abbr: string): string {
  return TEAM_ABBR_TO_FULL[abbr] || abbr;
}

/**
 * Convert full team name to abbreviation
 */
export function getTeamAbbr(fullName: string): string {
  return TEAM_FULL_TO_ABBR[fullName] || fullName;
}

/**
 * Check if a game involves a specific team (by abbreviation)
 * Handles both abbreviations (e.g., "LAL") and full names (e.g., "Los Angeles Lakers")
 * Also handles partial matches (e.g., "Milwaukee" matches "Milwaukee Bucks")
 */
export function gameInvolvesTeam(homeTeam: string, awayTeam: string, teamAbbr: string): boolean {
  const fullName = getFullTeamName(teamAbbr);
  const normalizedAbbr = teamAbbr.toUpperCase().trim();
  const normalizedHome = homeTeam.toUpperCase().trim();
  const normalizedAway = awayTeam.toUpperCase().trim();
  
  // Check if homeTeam or awayTeam matches the abbreviation directly
  if (normalizedHome === normalizedAbbr || normalizedAway === normalizedAbbr) {
    return true;
  }
  
  // Check if homeTeam or awayTeam matches the full name exactly
  if (homeTeam === fullName || awayTeam === fullName) {
    return true;
  }
  
  // Also check normalized full name (case-insensitive)
  const normalizedFullName = fullName.toUpperCase().trim();
  if (normalizedHome === normalizedFullName || normalizedAway === normalizedFullName) {
    return true;
  }
  
  // Check if stored team name contains the full name (e.g., "Milwaukee Bucks" contains "Milwaukee")
  // or if full name contains stored team name (e.g., "Milwaukee" is in "Milwaukee Bucks")
  if (normalizedHome.includes(normalizedFullName) || normalizedAway.includes(normalizedFullName) ||
      normalizedFullName.includes(normalizedHome) || normalizedFullName.includes(normalizedAway)) {
    return true;
  }
  
  // Also check if stored team name contains abbreviation (e.g., "MIL Bucks" contains "MIL")
  if (normalizedHome.includes(normalizedAbbr) || normalizedAway.includes(normalizedAbbr)) {
    return true;
  }
  
  return false;
}
