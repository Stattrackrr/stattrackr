/** Leading chart pills — remaining player stats follow this order. */
export const TENNIS_CHART_STAT_OPTIONS = [
  { key: 'moneyline', label: 'MONEYLINE' },
  { key: 'spread', label: 'SPREAD' },
  { key: 'totalGames', label: 'TOTAL GAMES' },
  { key: 'gamesWon', label: 'GAMES WON' },
  { key: 'gamesLost', label: 'OPP GAMES WON' },
] as const;

export const TENNIS_TEAM_STAT_OPTIONS = TENNIS_CHART_STAT_OPTIONS;

export const TENNIS_PLAYER_STAT_PRIORITY = [
  ...TENNIS_CHART_STAT_OPTIONS.map((s) => s.key),
  'aces',
  'doubleFaults',
  'pointsWon',
  'returnPointsWon',
  'firstServePct',
  'firstServeWonPct',
  'secondServeWonPct',
  'servicePointsWonPct',
  'returnPointsWonPct',
  'breakPointsConverted',
  'breakPointsConvertedPct',
  'breakPointsSaved',
  'breakPointsSavedPct',
  'serveGames',
  'servePoints',
  'firstServesIn',
  'firstServesWon',
  'secondServesWon',
  'setsWon',
] as const;

const CHART_KEYS = new Set<string>(TENNIS_CHART_STAT_OPTIONS.map((s) => s.key));
const ALL_STAT_KEYS = new Set<string>(TENNIS_PLAYER_STAT_PRIORITY);

/** Walkover / default with no balls played — the match never started. */
export function isUnplayedTennisMatch(score: unknown): boolean {
  const text = String(score ?? '').trim();
  if (!text) return false;
  if (/^(w\/o|wo|walkover|def|default)$/i.test(text)) return true;
  if (/\b(w\/o|walkover)\b/i.test(text) && !/\d+\s*[-–]\s*\d+/.test(text)) return true;
  return false;
}

export function tennisMatchesPlayed<T extends { score?: unknown }>(games: readonly T[]): T[] {
  return games.filter((game) => !isUnplayedTennisMatch(game.score));
}

export function isTennisGameStat(stat: string | null | undefined): boolean {
  return !!stat && CHART_KEYS.has(stat);
}

export function isTennisChartStat(stat: string | null | undefined): boolean {
  return !!stat && ALL_STAT_KEYS.has(stat);
}

export function tennisLastName(name: string | null | undefined): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[parts.length - 1] || String(name || '');
}

export function tennisTourLabel(opts: {
  tour?: string | null;
  isGrandSlam?: boolean;
}): string {
  if (opts.isGrandSlam) return 'Grand Slam';
  const tour = String(opts.tour || '').toUpperCase();
  if (tour === 'WTA') return 'WTA';
  if (tour === 'ATP') return 'ATP';
  return tour || 'Tennis';
}

export function defaultTennisGameStat(stat: string | null | undefined): string {
  if (isTennisChartStat(stat)) return stat as string;
  return 'moneyline';
}

export const TENNIS_STAT_LABELS: Record<string, string> = {
  aces: 'ACES',
  doubleFaults: 'DF',
  gamesWon: 'GAMES WON',
  gamesLost: 'OPP GAMES WON',
  totalGames: 'TOTAL GAMES',
  pointsWon: 'PTS WON',
  returnPointsWon: 'RET PTS',
  returnPointsWonPct: 'RET %',
  servePointsWon: 'SV PTS',
  servePoints: 'SV PT',
  serveGames: 'SV GMS',
  firstServesIn: '1ST IN',
  firstServesWon: '1ST W',
  secondServeAttempts: '2ND ATT',
  secondServesWon: '2ND W',
  firstServePct: '1ST %',
  firstServeWonPct: '1ST WON',
  secondServeWonPct: '2ND WON',
  servicePointsWonPct: 'SV %',
  breakPointsConverted: 'BP WON',
  breakPointsConvertedPct: 'BP %',
  breakPointsSaved: 'BP SVD',
  breakPointsSavedPct: 'BP SVD %',
  breakPointsFaced: 'BP FACED',
  minutes: 'MINS',
  moneyline: 'MONEYLINE',
  spread: 'SPREAD',
  setsWon: 'SETS',
  setsLost: 'SETS L',
  totalPoints: 'MATCH PTS',
};
