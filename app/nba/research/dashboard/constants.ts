// Constants for NBA Dashboard

import { normalizeAbbr } from '@/lib/nbaAbbr';

export const PLACEHOLDER_BOOK_ROWS: any[] = [
  {
    name: 'DraftKings',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
  },
  {
    name: 'FanDuel',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
  },
  {
    name: 'BetMGM',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
  },
  {
    name: 'Caesars',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
  },
];

export const TEAM_ID_TO_ABBR: Record<number, string> = {
  1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
  11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
  21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
};

export const ABBR_TO_TEAM_ID: Record<string, number> = Object.fromEntries(
  Object.entries(TEAM_ID_TO_ABBR).map(([id, abbr]) => [abbr, parseInt(id)])
);

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

export const ESPN_LOGO_SLUG: Record<string, string> = {
  NOP: 'new-orleans-pelicans',
  UTA: 'utah-jazz',
  SAS: 'san-antonio-spurs',
};

export const ESPN_FILE_ABBR: Record<string, string> = {
  NOP: 'no',
  UTA: 'utah',
  SAS: 'sa',
};

export const getEspnLogoCandidates = (abbr: string): string[] => {
  const normalized = normalizeAbbr(abbr || '');
  const baseFile = (ESPN_FILE_ABBR[normalized] || normalized.toLowerCase());
  const lc = normalized.toLowerCase();
  const candidates: string[] = [];
  candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/${baseFile}.png`);
  const exceptionSlug = ESPN_LOGO_SLUG[normalized];
  if (exceptionSlug) {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${exceptionSlug}.png`);
  } else {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${lc}.png`);
  }
  if (normalized === 'NOP') {
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/no.png`);
    candidates.push(`https://a.espncdn.com/i/teamlogos/nba/500/nop.png`);
  }
  const seen = new Set<string>();
  return candidates.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
};

export const getEspnLogoUrl = (abbr: string): string => getEspnLogoCandidates(abbr)[0];
export const getEspnFallbackLogoUrl = (abbr: string): string => getEspnLogoCandidates(abbr)[1] || getEspnLogoCandidates(abbr)[0];

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

export const teamRatings: Record<string, { offensive: number; defensive: number; net: number }> = {
  'CLE': { offensive: 119.8, defensive: 108.1, net: 0 },
  'BOS': { offensive: 119.5, defensive: 110.1, net: 0 },
  'OKC': { offensive: 119.2, defensive: 106.6, net: 0 },
  'DEN': { offensive: 118.9, defensive: 115.1, net: 0 },
  'NYK': { offensive: 117.3, defensive: 113.3, net: 0 },
  'MEM': { offensive: 117.2, defensive: 112.6, net: 0 },
  'SAC': { offensive: 115.9, defensive: 115.3, net: 0 },
  'MIN': { offensive: 115.7, defensive: 110.8, net: 0 },
  'IND': { offensive: 115.4, defensive: 113.3, net: 0 },
  'MIL': { offensive: 115.1, defensive: 112.7, net: 0 },
  'LAL': { offensive: 115.0, defensive: 113.8, net: 0 },
  'HOU': { offensive: 114.9, defensive: 110.3, net: 0 },
  'PHX': { offensive: 114.7, defensive: 117.7, net: 0 },
  'DET': { offensive: 114.6, defensive: 112.5, net: 0 },
  'LAC': { offensive: 114.3, defensive: 109.4, net: 0 },
  'GSW': { offensive: 114.2, defensive: 111.0, net: 0 },
  'ATL': { offensive: 113.7, defensive: 114.8, net: 0 },
  'DAL': { offensive: 113.7, defensive: 115.0, net: 0 },
  'SAS': { offensive: 113.5, defensive: 116.3, net: 0 },
  'CHI': { offensive: 113.2, defensive: 114.8, net: 0 },
  'MIA': { offensive: 112.4, defensive: 112.0, net: 0 },
  'POR': { offensive: 111.0, defensive: 113.7, net: 0 },
  'PHI': { offensive: 111.0, defensive: 117.3, net: 0 },
  'UTA': { offensive: 110.2, defensive: 119.4, net: 0 },
  'NOP': { offensive: 109.7, defensive: 119.1, net: 0 },
  'TOR': { offensive: 109.6, defensive: 113.6, net: 0 },
  'ORL': { offensive: 108.9, defensive: 109.1, net: 0 },
  'BKN': { offensive: 108.1, defensive: 115.4, net: 0 },
  'CHA': { offensive: 106.7, defensive: 115.7, net: 0 },
  'WAS': { offensive: 105.8, defensive: 118.0, net: 0 }
};

Object.keys(teamRatings).forEach(team => {
  teamRatings[team].net = teamRatings[team].offensive - teamRatings[team].defensive;
});

export const teamPace: Record<string, number> = {
  'MEM': 103.69, 'CHI': 103.61, 'ATL': 103.41, 'WAS': 101.82, 'OKC': 100.90,
  'UTA': 100.85, 'IND': 100.76, 'DEN': 100.67, 'TOR': 100.62, 'CLE': 100.31,
  'DET': 100.27, 'DAL': 100.15, 'SAS': 100.08, 'MIL': 99.92, 'NOP': 99.77,
  'POR': 99.51, 'GSW': 99.37, 'HOU': 99.03, 'SAC': 98.91, 'LAL': 98.34,
  'PHX': 98.31, 'LAC': 98.24, 'CHA': 98.22, 'PHI': 98.13, 'MIN': 97.95,
  'NYK': 97.64, 'MIA': 97.08, 'BKN': 96.73, 'BOS': 96.59, 'ORL': 96.51
};

export const teamReboundPct: Record<string, number> = {
  'MEM': 58.8, 'CHI': 58.5, 'ATL': 57.9, 'WAS': 54.6, 'OKC': 59.3,
  'UTA': 56.8, 'IND': 59.4, 'DEN': 60.4, 'TOR': 55.3, 'CLE': 60.7,
  'DET': 58.0, 'DAL': 58.3, 'SAS': 57.5, 'MIL': 59.8, 'NOP': 55.2,
  'POR': 55.5, 'GSW': 56.8, 'HOU': 55.3, 'SAC': 58.2, 'LAL': 59.3,
  'PHX': 59.5, 'LAC': 58.9, 'CHA': 53.7, 'PHI': 56.3, 'MIN': 58.8,
  'NYK': 58.9, 'MIA': 57.6, 'BKN': 55.2, 'BOS': 59.1, 'ORL': 55.0
};

export const PLAYER_STAT_OPTIONS = [
  { key: "min", label: "MINS" }, { key: "pts", label: "PTS" }, { key: "reb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "pra", label: "PRA" },
  { key: "pr", label: "PR" },
  { key: "pa", label: "PA" },
  { key: "ra", label: "RA" },
  { key: "fg3m", label: "3PM/A" },
  { key: "fg3_pct", label: "3P%" }, { key: "fgm", label: "FGM" }, { key: "fga", label: "FGA" },
  { key: "fg_pct", label: "FG%" }, { key: "ftm", label: "FTM" }, { key: "fta", label: "FTA" },
  { key: "ft_pct", label: "FT%" }, { key: "oreb", label: "OREB" }, { key: "dreb", label: "DREB" },
  { key: "turnover", label: "TO" }, { key: "pf", label: "PF" }, { key: "stl", label: "STL" }, { key: "blk", label: "BLK" }
];

export const TEAM_STAT_OPTIONS = [
  { key: "moneyline", label: "MONEYLINE" },
  { key: "spread", label: "SPREAD" },
  { key: "total_pts", label: "TOTAL PTS" },
  { key: "home_total", label: "HOME TOTAL" },
  { key: "away_total", label: "AWAY TOTAL" },
  { key: "first_half_total", label: "1H TOTAL" },
  { key: "second_half_total", label: "2H TOTAL" },
  { key: "q1_moneyline", label: "Q1 ML" },
  { key: "q1_total", label: "Q1 TOTAL" },
  { key: "q2_moneyline", label: "Q2 ML" },
  { key: "q2_total", label: "Q2 TOTAL" },
  { key: "q3_moneyline", label: "Q3 ML" },
  { key: "q3_total", label: "Q3 TOTAL" },
  { key: "q4_moneyline", label: "Q4 ML" },
  { key: "q4_total", label: "Q4 TOTAL" }
];

export const CHART_CONFIG = {
  margin: { top: 22, right: 14, left: 0, bottom: 29 },
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
  yAxis: {
    width: 32
  },
  bar: {
    radius: [10, 10, 10, 10] as [number, number, number, number]
  },
  labelList: {
    position: 'top' as const,
    fontSize: '12px',
    fontWeight: 'bold'
  },
  performance: {
    debounceMs: 100,
    maxBarSize: 80,
    reduceMotion: true
  }
};

export const DVP_METRICS = [
  { key: 'pts', label: 'Points', statType: 'ptsAllowed' },
  { key: 'reb', label: 'Rebounds', statType: 'rebAllowed' },
  { key: 'ast', label: 'Assists', statType: 'astAllowed' },
];

// Second axis filter options (only available in player mode)
export const SECOND_AXIS_FILTER_OPTIONS = [
  { key: null, label: 'None' },
  { key: 'minutes', label: 'Player Minutes' },
  { key: 'fg_pct', label: 'Player FG%' },
  { key: 'pace', label: 'Game Pace' },
  { key: 'usage_rate', label: 'Usage Rate' },
  { key: 'dvp_rank', label: 'Opp DvP Rank' },
];

export const LINE_MOVEMENT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_LINE_MOVEMENT === 'true';






