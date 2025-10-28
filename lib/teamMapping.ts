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
 */
export function gameInvolvesTeam(homeTeam: string, awayTeam: string, teamAbbr: string): boolean {
  const fullName = getFullTeamName(teamAbbr);
  return homeTeam === fullName || awayTeam === fullName;
}
