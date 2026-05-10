import { writeFile } from 'fs/promises';
import path from 'path';
import { getSoccerTeamResultsCache, normalizeSoccerTeamHref } from '@/lib/soccerCache';
import { getPermanentSoccerTeamResults } from '@/lib/soccerPermanentStore';
import { readSoccerPilotTeams } from '@/lib/soccerPilotTeams';
import {
  buildCompetitionLabel,
  computeTeamDefensiveAverages,
  filterMatchesToSeasonYear,
  leagueAverageForStat,
  OPPONENT_BREAKDOWN_DISPLAY_STATS,
  OPPONENT_BREAKDOWN_STAT_DEF,
  rankByStat,
  type OpponentBreakdownStatId,
  type TeamDefensiveAverages,
} from '@/lib/soccerOpponentBreakdown';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

const PREMIER_LEAGUE_NAME = 'Premier League';
const PREMIER_LEAGUE_COUNTRY = 'England';
const MATCHUP_OUT_PATH = path.join(process.cwd(), 'data', 'soccer-team-matchup-premier-league-last5.json');
const BREAKDOWN_OUT_PATH = path.join(process.cwd(), 'data', 'soccer-opponent-breakdown-premier-league-last5.json');

type MatchupStatId = 'goals' | 'expected_goals_xg' | 'total_shots' | 'shots_on_target' | 'corner_kicks';

type TeamSeasonAverages = {
  teamName: string;
  teamHref: string;
  games: number;
  attack: Record<MatchupStatId, number | null>;
  defence: Record<MatchupStatId, number | null>;
};

const MATCHUP_STATS: Array<{ id: MatchupStatId; label: string; statName: string | null }> = [
  { id: 'goals', label: 'Goals', statName: null },
  { id: 'expected_goals_xg', label: 'xG', statName: 'Expected goals (xG)' },
  { id: 'total_shots', label: 'Shots', statName: 'Total shots' },
  { id: 'shots_on_target', label: 'SOT', statName: 'Shots on target' },
  { id: 'corner_kicks', label: 'Corners', statName: 'Corner kicks' },
];

function normalizeToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
}

function getCurrentSoccerSeasonYear(): number {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function sortMatchesByRecency(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return [...matches].sort((a, b) => {
    const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    if (aKickoff !== bKickoff) return bKickoff - aKickoff;
    return String(b.matchId || '').localeCompare(String(a.matchId || ''));
  });
}

async function loadCachedTeamMatches(teamHref: string): Promise<SoccerwayRecentMatch[] | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return null;
  const cached = await getSoccerTeamResultsCache(normalized, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
  if (cached?.matches?.length) return cached.matches;
  const permanent = await getPermanentSoccerTeamResults(normalized);
  return permanent?.matches ?? null;
}

function getTeamSide(match: SoccerwayRecentMatch, teamName: string): 'home' | 'away' | null {
  const normalized = normalizeName(teamName);
  if (normalizeName(match.homeTeam) === normalized) return 'home';
  if (normalizeName(match.awayTeam) === normalized) return 'away';
  return null;
}

function getMatchStats(match: SoccerwayRecentMatch): SoccerwayMatchStat[] {
  const period = match.stats?.periods.find((item) => String(item.name || '').trim().toLowerCase() === 'match');
  if (!period) return [];
  return period.categories.flatMap((category) => category.stats);
}

function findStat(match: SoccerwayRecentMatch, statName: string): SoccerwayMatchStat | null {
  for (const stat of getMatchStats(match)) {
    if (String(stat.name || '').trim().toLowerCase() === statName.toLowerCase()) return stat;
  }
  return null;
}

function parseNumeric(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function getTeamPerspectiveValue(match: SoccerwayRecentMatch, teamName: string, stat: SoccerwayMatchStat): number | null {
  const side = getTeamSide(match, teamName);
  if (!side) return null;
  return parseNumeric(side === 'home' ? stat.homeValue : stat.awayValue);
}

function getOpponentPerspectiveValue(match: SoccerwayRecentMatch, teamName: string, stat: SoccerwayMatchStat): number | null {
  const side = getTeamSide(match, teamName);
  if (!side) return null;
  return parseNumeric(side === 'home' ? stat.awayValue : stat.homeValue);
}

function goalsScored(match: SoccerwayRecentMatch, teamName: string): number {
  const side = getTeamSide(match, teamName);
  if (!side) return 0;
  return side === 'home' ? match.homeScore : match.awayScore;
}

function goalsConceded(match: SoccerwayRecentMatch, teamName: string): number {
  const side = getTeamSide(match, teamName);
  if (!side) return 0;
  return side === 'home' ? match.awayScore : match.homeScore;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeTeamSeasonAverages(teamName: string, teamHref: string, matches: SoccerwayRecentMatch[]): TeamSeasonAverages {
  const attack = {} as TeamSeasonAverages['attack'];
  const defence = {} as TeamSeasonAverages['defence'];

  for (const stat of MATCHUP_STATS) {
    if (stat.id === 'goals') {
      attack[stat.id] = average(matches.map((match) => goalsScored(match, teamName)));
      defence[stat.id] = average(matches.map((match) => goalsConceded(match, teamName)));
      continue;
    }

    const attackValues: number[] = [];
    const defenceValues: number[] = [];
    for (const match of matches) {
      const statRow = findStat(match, stat.statName!);
      if (!statRow) continue;
      const forValue = getTeamPerspectiveValue(match, teamName, statRow);
      const againstValue = getOpponentPerspectiveValue(match, teamName, statRow);
      if (forValue != null) attackValues.push(forValue);
      if (againstValue != null) defenceValues.push(againstValue);
    }

    attack[stat.id] = average(attackValues);
    defence[stat.id] = average(defenceValues);
  }

  return {
    teamName,
    teamHref,
    games: matches.length,
    attack,
    defence,
  };
}

function rankValues(
  teams: TeamSeasonAverages[],
  statId: MatchupStatId,
  mode: 'attack' | 'defence'
): Array<{ teamName: string; teamHref: string; value: number | null; rank: number | null }> {
  const withValues = teams
    .map((team) => {
      const value = mode === 'attack' ? team.attack[statId] : team.defence[statId];
      return value != null ? { teamName: team.teamName, teamHref: team.teamHref, value } : null;
    })
    .filter((team): team is { teamName: string; teamHref: string; value: number } => team != null);

  const sorted = [...withValues].sort((a, b) => (mode === 'attack' ? b.value - a.value : a.value - b.value));
  const rankByTeam = new Map<string, number>();
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i].value !== sorted[i - 1].value) currentRank = i + 1;
    rankByTeam.set(sorted[i].teamHref, currentRank);
  }

  return teams.map((team) => {
    const value = mode === 'attack' ? team.attack[statId] : team.defence[statId];
    return {
      teamName: team.teamName,
      teamHref: team.teamHref,
      value,
      rank: value != null ? rankByTeam.get(team.teamHref) ?? null : null,
    };
  });
}

export async function rebuildPremierLeagueLast5SnapshotsFromCache(): Promise<{
  matchupTeamsSampled: number;
  breakdownTeamsSampled: number;
  teamsInLeague: number;
  seasonYear: number;
}> {
  const roster = readSoccerPilotTeams(Number.MAX_SAFE_INTEGER)
    .filter((team) =>
      team.competitions.some(
        (competition) =>
          tokensMatch(competition.competition, PREMIER_LEAGUE_NAME) && tokensMatch(competition.country, PREMIER_LEAGUE_COUNTRY)
      )
    )
    .map((team) => ({ name: team.name, href: team.href }));

  const seasonYear = getCurrentSoccerSeasonYear();
  const validTeams = (
    await Promise.all(
      roster.map(async (team) => {
        const matches = await loadCachedTeamMatches(team.href);
        if (!matches?.length) return null;
        const currentSeasonMatches = sortMatchesByRecency(filterMatchesToSeasonYear(matches, seasonYear)).slice(0, 5);
        if (currentSeasonMatches.length === 0) return null;
        return { team, matches: currentSeasonMatches };
      })
    )
  ).filter((entry): entry is { team: { name: string; href: string }; matches: SoccerwayRecentMatch[] } => entry != null);

  const matchupTeams = validTeams.map((entry) => computeTeamSeasonAverages(entry.team.name, entry.team.href, entry.matches));
  const breakdownTeams = validTeams.map((entry) => computeTeamDefensiveAverages(entry.team.name, entry.team.href, entry.matches));

  const matchupSnapshotTeams = matchupTeams.map((team) => {
    const attack = {} as Record<MatchupStatId, { perGame: number | null; rank: number | null; rankedSize: number }>;
    const defence = {} as Record<MatchupStatId, { perGame: number | null; rank: number | null; rankedSize: number }>;
    for (const stat of MATCHUP_STATS) {
      const attackRanks = rankValues(matchupTeams, stat.id, 'attack');
      const defenceRanks = rankValues(matchupTeams, stat.id, 'defence');
      const attackRow = attackRanks.find((row) => row.teamHref === team.teamHref);
      const defenceRow = defenceRanks.find((row) => row.teamHref === team.teamHref);
      attack[stat.id] = {
        perGame: attackRow?.value ?? null,
        rank: attackRow?.rank ?? null,
        rankedSize: attackRanks.filter((row) => row.rank != null).length,
      };
      defence[stat.id] = {
        perGame: defenceRow?.value ?? null,
        rank: defenceRow?.rank ?? null,
        rankedSize: defenceRanks.filter((row) => row.rank != null).length,
      };
    }
    return {
      name: team.teamName,
      href: team.teamHref,
      leagueGames: team.games,
      attack,
      defence,
    };
  });

  const breakdownSnapshotTeams = breakdownTeams.map((team) => ({
    name: team.teamName,
    href: team.teamHref,
    leagueGames: team.games,
    stats: OPPONENT_BREAKDOWN_DISPLAY_STATS.map((statId) => {
      const statDef = OPPONENT_BREAKDOWN_STAT_DEF[statId as OpponentBreakdownStatId];
      const ranking = rankByStat(breakdownTeams as TeamDefensiveAverages[], statId as OpponentBreakdownStatId);
      const row = ranking.find((entry) => entry.teamName === team.teamName);
      return {
        id: statId,
        label: statDef.label,
        shortLabel: statDef.shortLabel,
        perGame: team.byStat[statId as OpponentBreakdownStatId]?.perGame ?? null,
        rank: row?.rank ?? null,
        rankedSize: ranking.filter((entry) => entry.rank != null).length,
        leagueAverage: leagueAverageForStat(breakdownTeams as TeamDefensiveAverages[], statId as OpponentBreakdownStatId),
        niche: Boolean(statDef.niche),
        lowerIsBetter: statDef.lowerIsBetter,
        isPercent: Boolean(statDef.isPercent),
      };
    }),
  }));

  const generatedAt = new Date().toISOString();
  const competitionLabel = buildCompetitionLabel({
    competitionName: PREMIER_LEAGUE_NAME,
    competitionCountry: PREMIER_LEAGUE_COUNTRY,
  });

  await writeFile(
    MATCHUP_OUT_PATH,
    JSON.stringify(
      {
        generatedAt,
        source: 'cache-last5-builder',
        timeframe: 'last5',
        competitionName: PREMIER_LEAGUE_NAME,
        competitionCountry: PREMIER_LEAGUE_COUNTRY,
        competitionLabel,
        seasonYear,
        teamsInLeague: roster.length,
        teamsSampled: matchupSnapshotTeams.length,
        stats: MATCHUP_STATS.map((stat) => ({ id: stat.id, label: stat.label })),
        teams: matchupSnapshotTeams,
      },
      null,
      2
    ),
    'utf8'
  );

  await writeFile(
    BREAKDOWN_OUT_PATH,
    JSON.stringify(
      {
        generatedAt,
        source: 'cache-last5-builder',
        timeframe: 'last5',
        competitionName: PREMIER_LEAGUE_NAME,
        competitionCountry: PREMIER_LEAGUE_COUNTRY,
        competitionLabel,
        seasonYear,
        teamsInLeague: roster.length,
        teamsSampled: breakdownSnapshotTeams.length,
        teams: breakdownSnapshotTeams,
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    matchupTeamsSampled: matchupSnapshotTeams.length,
    breakdownTeamsSampled: breakdownSnapshotTeams.length,
    teamsInLeague: roster.length,
    seasonYear,
  };
}
