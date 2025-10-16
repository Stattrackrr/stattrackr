// NBA team abbreviations mapping
export const NBA_TEAMS = {
  'ATL': 'Atlanta Hawks',
  'BOS': 'Boston Celtics',
  'BKN': 'Brooklyn Nets',
  'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls',
  'CLE': 'Cleveland Cavaliers',
  'DAL': 'Dallas Mavericks',
  'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons',
  'GSW': 'Golden State Warriors',
  'HOU': 'Houston Rockets',
  'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers',
  'LAL': 'Los Angeles Lakers',
  'MEM': 'Memphis Grizzlies',
  'MIA': 'Miami Heat',
  'MIL': 'Milwaukee Bucks',
  'MIN': 'Minnesota Timberwolves',
  'NOP': 'New Orleans Pelicans',
  'NYK': 'New York Knicks',
  'OKC': 'Oklahoma City Thunder',
  'ORL': 'Orlando Magic',
  'PHI': 'Philadelphia 76ers',
  'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers',
  'SAC': 'Sacramento Kings',
  'SAS': 'San Antonio Spurs',
  'TOR': 'Toronto Raptors',
  'UTA': 'Utah Jazz',
  'WAS': 'Washington Wizards'
} as const;

// Common alias mapping (historical or alt sources)
const ALIASES: Record<string, keyof typeof NBA_TEAMS> = {
  'NO': 'NOP',      // ESPN/others sometimes use NO for New Orleans
  'NOH': 'NOP',     // Old Hornets era
  'NOK': 'NOP',     // Temporary New Orleans/Oklahoma City era
  'NOR': 'NOP',     // New Orleans short form
  'NOLA': 'NOP',
  'UTH': 'UTA',     // Common typo
  'UTA.': 'UTA',    // Trailing punctuation
  'PHO': 'PHX',
  'NY': 'NYK',
  'SA': 'SAS',
  'GS': 'GSW',
  'NJ': 'BKN',      // Old Nets
  'SEA': 'OKC',     // Historical (Sonics -> Thunder)
};

// Full name and nickname aliases
const NAME_ALIASES: Record<string, keyof typeof NBA_TEAMS> = {
  'UTAH': 'UTA',
  'UTAH JAZZ': 'UTA',
  'JAZZ': 'UTA',
  'NEW ORLEANS': 'NOP',
  'NEW ORLEANS PELICANS': 'NOP',
  'PELICANS': 'NOP',
};

export type NBATeamCode = keyof typeof NBA_TEAMS;

export function getTeamName(abbreviation: string): string {
  return NBA_TEAMS[abbreviation as NBATeamCode] || abbreviation;
}

export function normalizeAbbr(abbr: string): string {
  if (!abbr) return abbr;
  // Trim whitespace and collapse internal spaces
  const cleaned = abbr.trim().replace(/\s+/g, ' ');
  const up = cleaned.toUpperCase();
  // Exact code
  if (NBA_TEAMS[up as NBATeamCode]) return up;
  // Name aliases (for inputs like "Utah Jazz", "Pelicans")
  const named = NAME_ALIASES[up];
  if (named && NBA_TEAMS[named]) return named;
  // Code aliases (NO->NOP, UTH->UTA, etc.)
  const alias = ALIASES[up];
  if (alias && NBA_TEAMS[alias]) return alias;
  // Try removing non-alphanumeric characters and re-check
  const compact = up.replace(/[^A-Z0-9]/g, '');
  if (NBA_TEAMS[compact as NBATeamCode]) return compact;
  const alias2 = ALIASES[compact];
  if (alias2 && NBA_TEAMS[alias2]) return alias2;
  return compact || up;
}
