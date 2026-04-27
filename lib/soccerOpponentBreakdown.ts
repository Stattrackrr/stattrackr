import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

export type OpponentBreakdownLeagueFilter = {
  competitionName: string;
  competitionCountry?: string | null;
};

export type OpponentBreakdownStatId =
  | 'goals'
  | 'expected_goals_xg'
  | 'xg_on_target_xgot'
  | 'total_shots'
  | 'shots_on_target'
  | 'corner_kicks'
  | 'big_chances'
  | 'shots_inside_the_box'
  | 'touches_in_opp_box'
  | 'ball_possession'
  | 'crosses'
  | 'accurate_passes';

type OpponentBreakdownStatDef = {
  label: string;
  shortLabel: string;
  statName: string;
  lowerIsBetter: boolean;
  niche?: boolean;
  isPercent?: boolean;
};

const STAT_DEF: Record<OpponentBreakdownStatId, OpponentBreakdownStatDef> = {
  goals: { label: 'Goals allowed', shortLabel: 'GA', statName: '', lowerIsBetter: true },
  expected_goals_xg: {
    label: 'xG allowed',
    shortLabel: 'xGA',
    statName: 'Expected goals (xG)',
    lowerIsBetter: true,
  },
  xg_on_target_xgot: {
    label: 'xGOT allowed',
    shortLabel: 'xGOTA',
    statName: 'xG on target (xGOT)',
    lowerIsBetter: true,
    niche: true,
  },
  total_shots: {
    label: 'Shots allowed',
    shortLabel: 'Shots',
    statName: 'Total shots',
    lowerIsBetter: true,
  },
  shots_on_target: {
    label: 'SOT allowed',
    shortLabel: 'SOT',
    statName: 'Shots on target',
    lowerIsBetter: true,
  },
  corner_kicks: {
    label: 'Corners conceded',
    shortLabel: 'Corners',
    statName: 'Corner kicks',
    lowerIsBetter: true,
    niche: true,
  },
  big_chances: {
    label: 'Big chances allowed',
    shortLabel: 'Big ch.',
    statName: 'Big chances',
    lowerIsBetter: true,
    niche: true,
  },
  shots_inside_the_box: {
    label: 'Shots in box allowed',
    shortLabel: 'In box',
    statName: 'Shots inside the box',
    lowerIsBetter: true,
    niche: true,
  },
  touches_in_opp_box: {
    label: 'Opp. box touches',
    shortLabel: 'Box touches',
    statName: 'Touches in opposition box',
    lowerIsBetter: true,
    niche: true,
  },
  ball_possession: {
    label: 'Opp. possession',
    shortLabel: 'Poss.',
    statName: 'Ball possession',
    lowerIsBetter: true,
    niche: true,
    isPercent: true,
  },
  crosses: {
    label: 'Crosses allowed',
    shortLabel: 'Crosses',
    statName: 'Crosses',
    lowerIsBetter: true,
    niche: true,
  },
  accurate_passes: {
    label: 'Accurate passes allowed',
    shortLabel: 'Passes',
    statName: 'Accurate passes',
    lowerIsBetter: true,
    niche: true,
  },
};

export const OPPONENT_BREAKDOWN_DISPLAY_STATS: OpponentBreakdownStatId[] = [
  'goals',
  'expected_goals_xg',
  'total_shots',
  'shots_on_target',
  'xg_on_target_xgot',
  'corner_kicks',
  'big_chances',
  'shots_inside_the_box',
  'touches_in_opp_box',
  'ball_possession',
  'crosses',
  'accurate_passes',
];

export type LeagueRosterEntry = {
  name: string;
  href: string;
  competitionName?: string | null;
  competitionCountry?: string | null;
};

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeCompetitionToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeCompetitionToken(a);
  const right = normalizeCompetitionToken(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function getTeamSide(match: SoccerwayRecentMatch, teamName: string): 'home' | 'away' | null {
  const t = normalizeName(teamName);
  if (normalizeName(match.homeTeam) === t) return 'home';
  if (normalizeName(match.awayTeam) === t) return 'away';
  return null;
}

function getMatchStats(match: SoccerwayRecentMatch): SoccerwayMatchStat[] {
  const period = match.stats?.periods.find((p) => p.name.toLowerCase() === 'match');
  if (!period) return [];
  return period.categories.flatMap((c) => c.stats);
}

function findStat(match: SoccerwayRecentMatch, statName: string): SoccerwayMatchStat | null {
  for (const stat of getMatchStats(match)) {
    if (stat.name.toLowerCase() === statName.toLowerCase()) return stat;
  }
  return null;
}

function parseNum(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Opponent's value on a stat = what the focal team "allowed" (e.g. opponent's xG, shots, ...). */
function getOpponentNumeric(
  match: SoccerwayRecentMatch,
  focalTeamName: string,
  stat: SoccerwayMatchStat
): number | null {
  const side = getTeamSide(match, focalTeamName);
  if (!side) return null;
  const raw = side === 'home' ? stat.awayValue : stat.homeValue;
  return parseNum(raw);
}

function goalsConceded(match: SoccerwayRecentMatch, teamName: string): number {
  const side = getTeamSide(match, teamName);
  if (!side) return 0;
  return side === 'home' ? match.awayScore : match.homeScore;
}

export function isPremierLeagueMatch(match: SoccerwayRecentMatch): boolean {
  const c = (match.competitionName || '').toLowerCase();
  return c.includes('premier league') || c === "premier league (england)";
}

export function buildCompetitionLabel(filter: OpponentBreakdownLeagueFilter): string {
  const competitionName = String(filter.competitionName || '').trim();
  const competitionCountry = String(filter.competitionCountry || '').trim();
  return [competitionCountry, competitionName].filter(Boolean).join(' · ') || competitionName || competitionCountry || 'League';
}

export function matchBelongsToCompetition(match: SoccerwayRecentMatch, filter: OpponentBreakdownLeagueFilter): boolean {
  const competitionName = normalizeCompetitionToken(match.competitionName);
  const filterCompetitionName = normalizeCompetitionToken(filter.competitionName);
  if (!competitionName || !filterCompetitionName) return false;

  const competitionCountry = normalizeCompetitionToken(match.competitionCountry);
  const filterCompetitionCountry = normalizeCompetitionToken(filter.competitionCountry);

  if (!tokensMatch(competitionName, filterCompetitionName)) return false;
  if (filterCompetitionCountry && competitionCountry) return competitionCountry === filterCompetitionCountry;
  return true;
}

export function filterToCompetition(
  matches: SoccerwayRecentMatch[],
  filter: OpponentBreakdownLeagueFilter
): SoccerwayRecentMatch[] {
  const exactMatches = matches.filter((match) => matchBelongsToCompetition(match, filter));
  if (exactMatches.length > 0) return exactMatches;

  const filterCompetitionName = normalizeCompetitionToken(filter.competitionName);
  if (!filterCompetitionName) return [];

  if (filterCompetitionName.includes('premier league')) {
    return matches.filter(isPremierLeagueMatch);
  }

  return matches.filter((match) => tokensMatch(match.competitionName, filter.competitionName));
}

export function getSoccerSeasonYearFromKickoffUnix(kickoffUnix: number | null | undefined): number {
  if (kickoffUnix == null || !Number.isFinite(kickoffUnix)) return 0;
  const kickoff = new Date(kickoffUnix * 1000);
  const month = kickoff.getUTCMonth();
  const year = kickoff.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

export function filterMatchesToSeasonYear(
  matches: SoccerwayRecentMatch[],
  seasonYear: number
): SoccerwayRecentMatch[] {
  if (!Number.isFinite(seasonYear) || seasonYear <= 0) return [];
  return matches.filter((match) => getSoccerSeasonYearFromKickoffUnix(match.kickoffUnix) === seasonYear);
}

export type TeamDefensiveAverages = {
  teamName: string;
  teamHref: string;
  games: number;
  byStat: Record<OpponentBreakdownStatId, { perGame: number | null; gamesCounted: number } | null>;
};

function statAverageForTeam(
  matches: SoccerwayRecentMatch[],
  focalTeamName: string,
  id: OpponentBreakdownStatId
): { perGame: number | null; gamesCounted: number } | null {
  if (id === 'goals') {
    if (matches.length === 0) return null;
    const total = matches.reduce((s, m) => s + goalsConceded(m, focalTeamName), 0);
    return { perGame: total / matches.length, gamesCounted: matches.length };
  }
  const statName = STAT_DEF[id].statName;
  let sum = 0;
  let n = 0;
  for (const m of matches) {
    const s = findStat(m, statName);
    if (!s) continue;
    const v = getOpponentNumeric(m, focalTeamName, s);
    if (v == null) continue;
    sum += v;
    n += 1;
  }
  if (n === 0) return matches.length > 0 ? { perGame: null, gamesCounted: 0 } : null;
  return { perGame: sum / n, gamesCounted: n };
}

export function computeTeamDefensiveAverages(
  teamName: string,
  teamHref: string,
  plMatches: SoccerwayRecentMatch[]
): TeamDefensiveAverages {
  const byStat = {} as TeamDefensiveAverages['byStat'];
  for (const id of OPPONENT_BREAKDOWN_DISPLAY_STATS) {
    byStat[id] = statAverageForTeam(plMatches, teamName, id);
  }
  return {
    teamName,
    teamHref,
    games: plMatches.length,
    byStat,
  };
}

export function rankByStat(
  teams: TeamDefensiveAverages[],
  stat: OpponentBreakdownStatId
): { teamName: string; value: number | null; rank: number | null }[] {
  const withVals = teams
    .map((t) => {
      const p = t.byStat[stat];
      const v = p?.perGame;
      if (v == null || p == null || p.gamesCounted === 0) return { teamName: t.teamName, value: null as number | null, key: t.teamName };
      return { teamName: t.teamName, value: v, key: t.teamName };
    })
    .filter((r): r is { teamName: string; value: number; key: string } => r.value != null);

  if (withVals.length === 0) {
    return teams.map((t) => ({ teamName: t.teamName, value: null, rank: null }));
  }
  const lower = STAT_DEF[stat].lowerIsBetter;
  const sorted = [...withVals].sort((a, b) => (lower ? a.value - b.value : b.value - a.value));

  const rankByTeam = new Map<string, number>();
  let r = 1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i].value !== sorted[i - 1].value) r = i + 1;
    rankByTeam.set(sorted[i].key, r);
  }

  return teams.map((t) => {
    const p = t.byStat[stat];
    return {
      teamName: t.teamName,
      value: p?.perGame ?? null,
      rank: p?.perGame != null && p.gamesCounted! > 0 ? rankByTeam.get(t.teamName) ?? null : null,
    };
  });
}

export function leagueAverageForStat(teams: TeamDefensiveAverages[], stat: OpponentBreakdownStatId): number | null {
  const vals = teams
    .map((t) => t.byStat[stat]?.perGame)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export { STAT_DEF as OPPONENT_BREAKDOWN_STAT_DEF };
