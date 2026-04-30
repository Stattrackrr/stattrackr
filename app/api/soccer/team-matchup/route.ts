import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getSoccerTeamResultsCache, normalizeSoccerTeamHref } from '@/lib/soccerCache';
import { getPermanentSoccerTeamResults } from '@/lib/soccerPermanentStore';
import {
  buildCompetitionLabel,
  filterMatchesToSeasonYear,
  filterToCompetition,
  type OpponentBreakdownLeagueFilter,
} from '@/lib/soccerOpponentBreakdown';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const CONCURRENCY = 4;
type TeamMatchupTimeframe = 'season' | 'last5';

type SampleFile = {
  competitions?: Array<{
    country?: string;
    competition?: string;
    teams?: Array<{ name?: string; href?: string; competition?: string; country?: string }>;
  }>;
};

type MatchupStatId = 'goals' | 'expected_goals_xg' | 'total_shots' | 'shots_on_target' | 'corner_kicks';

type MatchupRow = {
  id: MatchupStatId;
  label: string;
  teamForValue: number | null;
  teamForRank: number | null;
  teamForRankedSize: number;
  teamAgainstValue: number | null;
  teamAgainstRank: number | null;
  teamAgainstRankedSize: number;
  opponentForValue: number | null;
  opponentForRank: number | null;
  opponentForRankedSize: number;
  opponentAgainstValue: number | null;
  opponentAgainstRank: number | null;
  opponentAgainstRankedSize: number;
};

type TeamSeasonAverages = {
  teamName: string;
  teamHref: string;
  games: number;
  attack: Record<MatchupStatId, number | null>;
  defence: Record<MatchupStatId, number | null>;
};

type TeamMatchupSnapshotFile = {
  generatedAt?: string;
  competitionName?: string;
  competitionCountry?: string;
  competitionLabel?: string;
  seasonYear?: number;
  teamsSampled?: number;
  teamsInLeague?: number;
  teams?: Array<{
    name?: string;
    href?: string;
    leagueGames?: number;
    attack?: Partial<Record<MatchupStatId, { perGame?: number | null; rank?: number | null; rankedSize?: number }>>;
    defence?: Partial<Record<MatchupStatId, { perGame?: number | null; rank?: number | null; rankedSize?: number }>>;
  }>;
};

export type TeamMatchupApiResponse = {
  mode: 'matchup' | 'no-data' | 'no-roster';
  competitionLabel: string;
  seasonYear: number | null;
  timeframe: TeamMatchupTimeframe;
  teamsSampled: number;
  teamsInLeague: number;
  team: { name: string; href: string; games: number | null } | null;
  opponent: { name: string; href: string; games: number | null } | null;
  rows: MatchupRow[];
  note?: string;
};

const MATCHUP_STATS: Array<{ id: MatchupStatId; label: string; statName: string | null }> = [
  { id: 'goals', label: 'Goals', statName: null },
  { id: 'expected_goals_xg', label: 'xG', statName: 'Expected goals (xG)' },
  { id: 'total_shots', label: 'Shots', statName: 'Total shots' },
  { id: 'shots_on_target', label: 'SOT', statName: 'Shots on target' },
  { id: 'corner_kicks', label: 'Corners', statName: 'Corner kicks' },
];

async function readPremierLeagueTeamMatchupSnapshot(): Promise<TeamMatchupSnapshotFile | null> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'soccer-team-matchup-premier-league.json');
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as TeamMatchupSnapshotFile;
  } catch {
    return null;
  }
}

async function readPremierLeagueTeamMatchupLast5Snapshot(): Promise<TeamMatchupSnapshotFile | null> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'soccer-team-matchup-premier-league-last5.json');
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as TeamMatchupSnapshotFile;
  } catch {
    return null;
  }
}

function normalizeSearchValue(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function valuesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeSearchValue(a);
  const right = normalizeSearchValue(b);
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

function parseTimeframe(value: string | null): TeamMatchupTimeframe {
  return String(value || '').trim().toLowerCase() === 'last5' ? 'last5' : 'season';
}

async function loadLeagueRosterFromSample(filter: OpponentBreakdownLeagueFilter): Promise<Array<{ name: string; href: string }> | null> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'soccerway-teams-sample.json');
    const raw = await readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as SampleFile;
    const competitions = Array.isArray(data.competitions) ? data.competitions : [];
    const exactMatch =
      competitions.find(
        (competition) =>
          valuesMatch(competition.competition, filter.competitionName) &&
          (!filter.competitionCountry || valuesMatch(competition.country, filter.competitionCountry))
      ) ?? null;
    const fallbackMatch = exactMatch ?? competitions.find((competition) => valuesMatch(competition.competition, filter.competitionName)) ?? null;
    if (!fallbackMatch?.teams?.length) return null;
    return fallbackMatch.teams
      .map((team) => ({
        name: String(team.name || '').trim(),
        href: normalizeSoccerTeamHref(String(team.href || '')),
      }))
      .filter((team) => team.name && team.href);
  } catch {
    return null;
  }
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
  const period = match.stats?.periods.find((item) => item.name.toLowerCase() === 'match');
  if (!period) return [];
  return period.categories.flatMap((category) => category.stats);
}

function findStat(match: SoccerwayRecentMatch, statName: string): SoccerwayMatchStat | null {
  for (const stat of getMatchStats(match)) {
    if (stat.name.toLowerCase() === statName.toLowerCase()) return stat;
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
      return { teamName: team.teamName, teamHref: team.teamHref, value };
    })
    .filter((team): team is { teamName: string; teamHref: string; value: number } => team.value != null);

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

function resolveRosterTeam(
  roster: Array<{ name: string; href: string }>,
  href: string,
  name: string
): { name: string; href: string } | null {
  const normalizedHref = normalizeSoccerTeamHref(href);
  if (normalizedHref && TEAM_HREF_RE.test(normalizedHref)) {
    const exact = roster.find((team) => normalizeSoccerTeamHref(team.href) === normalizedHref);
    if (exact) return exact;
  }
  const normalizedName = normalizeName(name);
  if (!normalizedName) return null;
  return (
    roster.find((team) => normalizeName(team.name) === normalizedName) ??
    roster.find((team) => normalizedName.includes(normalizeName(team.name)) || normalizeName(team.name).includes(normalizedName)) ??
    null
  );
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

export async function GET(request: NextRequest) {
  const teamName = request.nextUrl.searchParams.get('teamName')?.trim() || '';
  const teamHref = request.nextUrl.searchParams.get('teamHref')?.trim() || '';
  const opponentName = request.nextUrl.searchParams.get('opponentName')?.trim() || '';
  const opponentHref = request.nextUrl.searchParams.get('opponentHref')?.trim() || '';
  const competitionName = request.nextUrl.searchParams.get('competitionName')?.trim() || '';
  const competitionCountry = request.nextUrl.searchParams.get('competitionCountry')?.trim() || '';
  const timeframe = parseTimeframe(request.nextUrl.searchParams.get('timeframe'));

  if (!competitionName) {
    return NextResponse.json({ error: 'Missing competitionName' }, { status: 400 });
  }
  if (!teamName && !teamHref) {
    return NextResponse.json({ error: 'Missing teamName or teamHref' }, { status: 400 });
  }
  if (!opponentName && !opponentHref) {
    return NextResponse.json({ error: 'Missing opponentName or opponentHref' }, { status: 400 });
  }

  const leagueFilter: OpponentBreakdownLeagueFilter = {
    competitionName,
    competitionCountry: competitionCountry || null,
  };
  const competitionLabel = buildCompetitionLabel(leagueFilter);
  const seasonYear = getCurrentSoccerSeasonYear();

  const isPremierLeagueRequest =
    valuesMatch(competitionName, 'Premier League') && (!competitionCountry || valuesMatch(competitionCountry, 'England'));
  if (isPremierLeagueRequest) {
    const snapshot =
      timeframe === 'last5'
        ? await readPremierLeagueTeamMatchupLast5Snapshot()
        : await readPremierLeagueTeamMatchupSnapshot();
    const snapshotTeams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
    const resolvedTeam =
      snapshotTeams.find((team) => normalizeSoccerTeamHref(String(team?.href || '')) === normalizeSoccerTeamHref(teamHref)) ??
      snapshotTeams.find((team) => normalizeName(String(team?.name || '')) === normalizeName(teamName)) ??
      null;
    const resolvedOpponent =
      snapshotTeams.find((team) => normalizeSoccerTeamHref(String(team?.href || '')) === normalizeSoccerTeamHref(opponentHref)) ??
      snapshotTeams.find((team) => normalizeName(String(team?.name || '')) === normalizeName(opponentName)) ??
      null;

    if (resolvedTeam && resolvedOpponent) {
      const rows = MATCHUP_STATS.map((stat) => ({
        id: stat.id,
        label: stat.label,
        teamForValue: resolvedTeam.attack?.[stat.id]?.perGame ?? null,
        teamForRank: resolvedTeam.attack?.[stat.id]?.rank ?? null,
        teamForRankedSize: Number(resolvedTeam.attack?.[stat.id]?.rankedSize || 0),
        teamAgainstValue: resolvedTeam.defence?.[stat.id]?.perGame ?? null,
        teamAgainstRank: resolvedTeam.defence?.[stat.id]?.rank ?? null,
        teamAgainstRankedSize: Number(resolvedTeam.defence?.[stat.id]?.rankedSize || 0),
        opponentForValue: resolvedOpponent.attack?.[stat.id]?.perGame ?? null,
        opponentForRank: resolvedOpponent.attack?.[stat.id]?.rank ?? null,
        opponentForRankedSize: Number(resolvedOpponent.attack?.[stat.id]?.rankedSize || 0),
        opponentAgainstValue: resolvedOpponent.defence?.[stat.id]?.perGame ?? null,
        opponentAgainstRank: resolvedOpponent.defence?.[stat.id]?.rank ?? null,
        opponentAgainstRankedSize: Number(resolvedOpponent.defence?.[stat.id]?.rankedSize || 0),
      }));

      return NextResponse.json({
        mode: 'matchup',
        competitionLabel: String(snapshot?.competitionLabel || 'England · Premier League'),
        seasonYear: Number(snapshot?.seasonYear || seasonYear) || null,
        timeframe,
        teamsSampled: Number(snapshot?.teamsSampled || snapshotTeams.length),
        teamsInLeague: Number(snapshot?.teamsInLeague || snapshotTeams.length),
        team: {
          name: String(resolvedTeam.name || teamName || 'Team'),
          href: normalizeSoccerTeamHref(String(resolvedTeam.href || teamHref || '')),
          games: Number(resolvedTeam.leagueGames || 0) || null,
        },
        opponent: {
          name: String(resolvedOpponent.name || opponentName || 'Opponent'),
          href: normalizeSoccerTeamHref(String(resolvedOpponent.href || opponentHref || '')),
          games: Number(resolvedOpponent.leagueGames || 0) || null,
        },
        rows,
        note:
          snapshot?.generatedAt && Number(snapshot?.seasonYear || 0) === seasonYear
            ? `Current season ${timeframe === 'last5' ? 'last 5 ' : ''}snapshot built ${new Date(snapshot.generatedAt).toLocaleString()}`
            : snapshot?.generatedAt
              ? `${timeframe === 'last5' ? 'Last 5 ' : ''}snapshot built ${new Date(snapshot.generatedAt).toLocaleString()}`
              : undefined,
      } satisfies TeamMatchupApiResponse);
    }
  }

  const roster = await loadLeagueRosterFromSample(leagueFilter);
  if (!roster?.length) {
    return NextResponse.json({
      mode: 'no-roster',
      competitionLabel,
      seasonYear: seasonYear || null,
      timeframe,
      teamsSampled: 0,
      teamsInLeague: 0,
      team: null,
      opponent: null,
      rows: [],
      note: `Could not load roster data for ${competitionLabel}.`,
    } satisfies TeamMatchupApiResponse);
  }

  const resolvedTeam = resolveRosterTeam(roster, teamHref, teamName);
  const resolvedOpponent = resolveRosterTeam(roster, opponentHref, opponentName);
  if (!resolvedTeam || !resolvedOpponent) {
    return NextResponse.json({
      mode: 'no-data',
      competitionLabel,
      seasonYear: seasonYear || null,
      timeframe,
      teamsSampled: 0,
      teamsInLeague: roster.length,
      team: resolvedTeam ? { name: resolvedTeam.name, href: resolvedTeam.href, games: null } : null,
      opponent: resolvedOpponent ? { name: resolvedOpponent.name, href: resolvedOpponent.href, games: null } : null,
      rows: [],
      note: 'Could not map the selected teams to the league roster.',
    } satisfies TeamMatchupApiResponse);
  }

  const allAverages: TeamSeasonAverages[] = [];
  for (let index = 0; index < roster.length; index += CONCURRENCY) {
    const batch = roster.slice(index, index + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (team) => {
        const matches = await loadCachedTeamMatches(team.href);
        if (!matches?.length) return null;
        const seasonMatches =
          timeframe === 'last5'
            ? filterMatchesToSeasonYear(matches, seasonYear)
            : filterMatchesToSeasonYear(filterToCompetition(matches, leagueFilter), seasonYear);
        const sampledMatches = timeframe === 'last5' ? sortMatchesByRecency(seasonMatches).slice(0, 5) : seasonMatches;
        if (!sampledMatches.length) return null;
        return computeTeamSeasonAverages(team.name, team.href, sampledMatches);
      })
    );
    for (const result of batchResults) {
      if (result) allAverages.push(result);
    }
  }

  if (!allAverages.length) {
    return NextResponse.json({
      mode: 'no-data',
      competitionLabel,
      seasonYear: seasonYear || null,
      timeframe,
      teamsSampled: 0,
      teamsInLeague: roster.length,
      team: { name: resolvedTeam.name, href: resolvedTeam.href, games: null },
      opponent: { name: resolvedOpponent.name, href: resolvedOpponent.href, games: null },
      rows: [],
      note: `No cached ${competitionLabel} ${timeframe === 'last5' ? 'last 5 ' : ''}data is available yet.`,
    } satisfies TeamMatchupApiResponse);
  }

  const teamAverage = allAverages.find((row) => normalizeSoccerTeamHref(row.teamHref) === normalizeSoccerTeamHref(resolvedTeam.href)) ?? null;
  const opponentAverage = allAverages.find((row) => normalizeSoccerTeamHref(row.teamHref) === normalizeSoccerTeamHref(resolvedOpponent.href)) ?? null;
  if (!teamAverage || !opponentAverage) {
    return NextResponse.json({
      mode: 'no-data',
      competitionLabel,
      seasonYear: seasonYear || null,
      timeframe,
      teamsSampled: allAverages.length,
      teamsInLeague: roster.length,
      team: { name: resolvedTeam.name, href: resolvedTeam.href, games: null },
      opponent: { name: resolvedOpponent.name, href: resolvedOpponent.href, games: null },
      rows: [],
      note: `Not enough cached league data to build this ${timeframe === 'last5' ? 'last 5 ' : ''}matchup yet.`,
    } satisfies TeamMatchupApiResponse);
  }

  const rows = MATCHUP_STATS.map((stat) => {
    const attackRanks = rankValues(allAverages, stat.id, 'attack');
    const defenceRanks = rankValues(allAverages, stat.id, 'defence');
    const teamAttack = attackRanks.find((row) => normalizeSoccerTeamHref(row.teamHref) === normalizeSoccerTeamHref(teamAverage.teamHref));
    const teamDefence = defenceRanks.find((row) => normalizeSoccerTeamHref(row.teamHref) === normalizeSoccerTeamHref(teamAverage.teamHref));
    const opponentAttack = attackRanks.find((row) => normalizeSoccerTeamHref(row.teamHref) === normalizeSoccerTeamHref(opponentAverage.teamHref));
    const opponentDefence = defenceRanks.find((row) => normalizeSoccerTeamHref(row.teamHref) === normalizeSoccerTeamHref(opponentAverage.teamHref));
    return {
      id: stat.id,
      label: stat.label,
      teamForValue: teamAttack?.value ?? null,
      teamForRank: teamAttack?.rank ?? null,
      teamForRankedSize: attackRanks.filter((row) => row.rank != null).length,
      teamAgainstValue: teamDefence?.value ?? null,
      teamAgainstRank: teamDefence?.rank ?? null,
      teamAgainstRankedSize: defenceRanks.filter((row) => row.rank != null).length,
      opponentForValue: opponentAttack?.value ?? null,
      opponentForRank: opponentAttack?.rank ?? null,
      opponentForRankedSize: attackRanks.filter((row) => row.rank != null).length,
      opponentAgainstValue: opponentDefence?.value ?? null,
      opponentAgainstRank: opponentDefence?.rank ?? null,
      opponentAgainstRankedSize: defenceRanks.filter((row) => row.rank != null).length,
    } satisfies MatchupRow;
  });

  return NextResponse.json({
    mode: 'matchup',
    competitionLabel,
    seasonYear: seasonYear || null,
    timeframe,
    teamsSampled: allAverages.length,
    teamsInLeague: roster.length,
    team: { name: teamAverage.teamName, href: teamAverage.teamHref, games: teamAverage.games },
    opponent: { name: opponentAverage.teamName, href: opponentAverage.teamHref, games: opponentAverage.games },
    rows,
    note:
      allAverages.length < roster.length
        ? `Using ${timeframe === 'last5' ? 'last 5 current-season matches for ' : ''}${allAverages.length} of ${roster.length} ${competitionLabel} teams with cached data.`
        : undefined,
  } satisfies TeamMatchupApiResponse);
}
