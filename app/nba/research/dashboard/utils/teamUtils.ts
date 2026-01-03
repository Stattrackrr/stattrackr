import { normalizeAbbr } from '@/lib/nbaAbbr';

// Team ID to abbreviation mapping
export const TEAM_ID_TO_ABBR: Record<number, string> = {
  1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
  11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
  21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
};

// Reverse mapping: abbreviation to team ID
export const ABBR_TO_TEAM_ID: Record<string, number> = Object.fromEntries(
  Object.entries(TEAM_ID_TO_ABBR).map(([id, abbr]) => [abbr, parseInt(id)])
);

// Team abbreviation to full name mapping
export const TEAM_FULL_NAMES: Record<string, string> = {
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
  SAS: 'san-antonio-spurs',
};

// ESPN filename exceptions for base 500/ path
// Note: ESPN uses 'no.png' (not 'nop.png') for New Orleans; 'utah.png' for Jazz, 'sa.png' for Spurs
const ESPN_FILE_ABBR: Record<string, string> = {
  NOP: 'no',
  UTA: 'utah',
  SAS: 'sa',
};

// Build ordered candidate URLs for ESPN logos for a team
export const getEspnLogoCandidates = (abbr: string): string[] => {
  const normalized = normalizeAbbr(abbr || '');
  const baseFile = (ESPN_FILE_ABBR[normalized] || normalized.toLowerCase());
  const lc = normalized.toLowerCase();
  const candidates: string[] = [];
  // 1) Base 500 path with filename (works for most teams; includes 'no.png' and 'utah.png')
  candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/${baseFile}.png`);
  // 2) Scoreboard slug path for known exceptions (Pelicans, Jazz)
  const exceptionSlug = ESPN_LOGO_SLUG[normalized];
  if (exceptionSlug) {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${exceptionSlug}.png`);
  } else {
    // Generic scoreboard fallback using abbr (some teams have abbr scoreboard assets)
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${lc}.png`);
  }

  // Team-specific extra variants for ESPN inconsistencies (removed UTA fallbacks - utah.png works)
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
export const getEspnLogoUrl = (abbr: string): string => getEspnLogoCandidates(abbr)[0];
// Second candidate for convenience (legacy usage)
export const getEspnFallbackLogoUrl = (abbr: string): string => getEspnLogoCandidates(abbr)[1] || getEspnLogoCandidates(abbr)[0];

