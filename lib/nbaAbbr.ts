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
  // Atlanta Hawks
  'HAWKS': 'ATL',
  
  // Boston Celtics
  'CELTICS': 'BOS',
  
  // Brooklyn Nets
  'BRO': 'BKN',
  'BRK': 'BKN',
  'NETS': 'BKN',
  'NJ': 'BKN',      // Old Nets (New Jersey)
  'NJN': 'BKN',
  
  // Charlotte Hornets
  'CHO': 'CHA',
  'HORNETS': 'CHA',
  'CHH': 'CHA',     // Old Hornets
  
  // Chicago Bulls
  'BULLS': 'CHI',
  
  // Cleveland Cavaliers
  'CAVS': 'CLE',
  'CAVALIERS': 'CLE',
  
  // Dallas Mavericks
  'MAVS': 'DAL',
  'MAVERICKS': 'DAL',
  
  // Denver Nuggets
  'NUGGETS': 'DEN',
  
  // Detroit Pistons
  'PISTONS': 'DET',
  
  // Golden State Warriors
  'GS': 'GSW',
  'GOLDEN STATE': 'GSW',
  'WARRIORS': 'GSW',
  
  // Houston Rockets
  'ROCKETS': 'HOU',
  
  // Indiana Pacers
  'PACERS': 'IND',
  
  // LA Clippers
  'CLIPPERS': 'LAC',
  'LACLIPPERS': 'LAC',
  
  // Los Angeles Lakers
  'LAKERS': 'LAL',
  'LALAKERS': 'LAL',
  
  // Memphis Grizzlies
  'GRIZZLIES': 'MEM',
  'GRIZZ': 'MEM',
  
  // Miami Heat
  'HEAT': 'MIA',
  
  // Milwaukee Bucks
  'BUCKS': 'MIL',
  
  // Minnesota Timberwolves
  'WOLVES': 'MIN',
  'TIMBERWOLVES': 'MIN',
  'TWOLVES': 'MIN',
  
  // New Orleans Pelicans
  'NO': 'NOP',      // ESPN/others sometimes use NO for New Orleans
  'NOH': 'NOP',     // Old Hornets era
  'NOK': 'NOP',     // Temporary New Orleans/Oklahoma City era
  'NOR': 'NOP',     // New Orleans short form
  'NOLA': 'NOP',
  'PELICANS': 'NOP',
  'PELS': 'NOP',
  
  // New York Knicks
  'NY': 'NYK',
  'KNICKS': 'NYK',
  
  // Oklahoma City Thunder
  'THUNDER': 'OKC',
  'SEA': 'OKC',     // Historical (Sonics -> Thunder)
  'SONICS': 'OKC',
  
  // Orlando Magic
  'MAGIC': 'ORL',
  
  // Philadelphia 76ers
  '76ERS': 'PHI',
  'SIXERS': 'PHI',
  'PHILA': 'PHI',
  
  // Phoenix Suns
  'PHO': 'PHX',
  'SUNS': 'PHX',
  
  // Portland Trail Blazers
  'BLAZERS': 'POR',
  'TRAILBLAZERS': 'POR',
  
  // Sacramento Kings
  'KINGS': 'SAC',
  
  // San Antonio Spurs
  'SA': 'SAS',
  'SPURS': 'SAS',
  'SAN ANTONIO': 'SAS',
  
  // Toronto Raptors
  'RAPTORS': 'TOR',
  'RAPS': 'TOR',
  
  // Utah Jazz
  'UTH': 'UTA',     // Common typo
  'UTA.': 'UTA',    // Trailing punctuation
  'JAZZ': 'UTA',
  
  // Washington Wizards
  'WIZ': 'WAS',
  'WIZARDS': 'WAS',
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

// Ball Don't Lie team ID to abbreviation mapping
export const TEAM_ID_TO_ABBR: Record<number, string> = {
  1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
  11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
  21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
};

// Reverse mapping: abbreviation to team ID
export const ABBR_TO_TEAM_ID: Record<string, number> = Object.fromEntries(
  Object.entries(TEAM_ID_TO_ABBR).map(([id, abbr]) => [abbr, parseInt(id)])
);

// ESPN logo slug mapping for exceptions (scoreboard path)
export const ESPN_LOGO_SLUG: Record<string, string> = {
  NOP: 'new-orleans-pelicans',
  UTA: 'utah-jazz',
};

// ESPN filename exceptions for base 500/ path
export const ESPN_FILE_ABBR: Record<string, string> = {
  NOP: 'no',
  UTA: 'utah',
};

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

/**
 * Build ordered candidate URLs for ESPN logos for a team
 */
export function getEspnLogoCandidates(abbr: string): string[] {
  const normalized = normalizeAbbr(abbr || '');
  const baseFile = (ESPN_FILE_ABBR[normalized] || normalized.toLowerCase());
  const lc = normalized.toLowerCase();
  const candidates: string[] = [];
  
  // 1) Base 500 path with filename (works for most teams)
  candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/${baseFile}.png`);
  
  // 2) Scoreboard slug path for known exceptions
  const exceptionSlug = ESPN_LOGO_SLUG[normalized];
  if (exceptionSlug) {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${exceptionSlug}.png`);
  } else {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${lc}.png`);
  }

  // Team-specific extra variants
  if (normalized === 'UTA') {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/uta.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/utah.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/jazz.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/utah.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/jazz.png`);
  }
  if (normalized === 'NOP') {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/no.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/nop.png`);
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return candidates.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
}

/**
 * Get first candidate ESPN logo URL
 */
export function getEspnLogoUrl(abbr: string): string {
  return getEspnLogoCandidates(abbr)[0];
}

/**
 * Get fallback ESPN logo URL (second candidate)
 */
export function getEspnFallbackLogoUrl(abbr: string): string {
  const candidates = getEspnLogoCandidates(abbr);
  return candidates[1] || candidates[0];
}
