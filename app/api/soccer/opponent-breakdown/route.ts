import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getSoccerTeamResultsCache, normalizeSoccerTeamHref } from '@/lib/soccerCache';
import { getPermanentSoccerTeamResults } from '@/lib/soccerPermanentStore';
import {
  buildCompetitionLabel,
  computeTeamDefensiveAverages,
  filterMatchesToSeasonYear,
  filterToCompetition,
  leagueAverageForStat,
  OPPONENT_BREAKDOWN_DISPLAY_STATS,
  OPPONENT_BREAKDOWN_STAT_DEF,
  rankByStat,
  type OpponentBreakdownLeagueFilter,
  type OpponentBreakdownStatId,
  type TeamDefensiveAverages,
} from '@/lib/soccerOpponentBreakdown';
import type { SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const CONCURRENCY = 4;

type OpponentBreakdownTimeframe = 'season' | 'last5';
type OpponentBreakdownStatRow = {
  id: OpponentBreakdownStatId;
  label: string;
  shortLabel: string;
  perGame: number | null;
  rank: number | null;
  rankedSize: number;
  leagueAverage: number | null;
  niche: boolean;
  lowerIsBetter: boolean;
  isPercent: boolean;
};
type LeagueRosterEntry = {
  name: string;
  href: string;
};
type SampleFile = {
  competitions?: Array<{
    country?: string;
    competition?: string;
    teams?: Array<{ name?: string; href?: string }>;
  }>;
};

type OpponentBreakdownSnapshotFile = {
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
    stats?: OpponentBreakdownStatRow[];
  }>;
};

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

async function readPremierLeagueSnapshot(): Promise<OpponentBreakdownSnapshotFile | null> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'soccer-opponent-breakdown-premier-league.json');
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as OpponentBreakdownSnapshotFile;
  } catch {
    return null;
  }
}

async function readPremierLeagueLast5Snapshot(): Promise<OpponentBreakdownSnapshotFile | null> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'soccer-opponent-breakdown-premier-league-last5.json');
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as OpponentBreakdownSnapshotFile;
  } catch {
    return null;
  }
}

function getCurrentSoccerSeasonYear(): number {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

export type OpponentBreakdownApiResponse = {
  mode: 'league' | 'no-roster' | 'no-data';
  competitionLabel: string;
  teamsSampled: number;
  teamsInLeague: number;
  timeframe: OpponentBreakdownTimeframe;
  opponent: {
    name: string;
    href: string;
    leagueGames: number;
    stats: OpponentBreakdownStatRow[];
  } | null;
  note?: string;
};

function parseTimeframe(value: string | null): OpponentBreakdownTimeframe {
  return String(value || '').trim().toLowerCase() === 'last5' ? 'last5' : 'season';
}

async function loadLeagueRosterFromSample(filter: OpponentBreakdownLeagueFilter): Promise<LeagueRosterEntry[] | null> {
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

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
}

function resolveRosterTeam(roster: LeagueRosterEntry[], href: string, name: string): LeagueRosterEntry | null {
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

function sortMatchesByRecency(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return [...matches].sort((a, b) => {
    const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    if (aKickoff !== bKickoff) return bKickoff - aKickoff;
    return String(b.matchId || '').localeCompare(String(a.matchId || ''));
  });
}

function buildDynamicRows(opponentAverage: TeamDefensiveAverages, allAverages: TeamDefensiveAverages[]): OpponentBreakdownStatRow[] {
  return OPPONENT_BREAKDOWN_DISPLAY_STATS.map((statId) => {
    const statDef = OPPONENT_BREAKDOWN_STAT_DEF[statId];
    const rankedRows = rankByStat(allAverages, statId);
    const rankedSize = rankedRows.filter((row) => row.rank != null).length;
    const opponentRank = rankedRows.find((row) => row.teamName === opponentAverage.teamName)?.rank ?? null;
    return {
      id: statId,
      label: statDef.label,
      shortLabel: statDef.shortLabel,
      perGame: opponentAverage.byStat[statId]?.perGame ?? null,
      rank: opponentRank,
      rankedSize,
      leagueAverage: leagueAverageForStat(allAverages, statId),
      niche: Boolean(statDef.niche),
      lowerIsBetter: statDef.lowerIsBetter,
      isPercent: Boolean(statDef.isPercent),
    };
  });
}

export async function GET(request: NextRequest) {
  const opponentName = request.nextUrl.searchParams.get('opponentName')?.trim() || '';
  const competitionName = request.nextUrl.searchParams.get('competitionName')?.trim() || '';
  const competitionCountry = request.nextUrl.searchParams.get('competitionCountry')?.trim() || '';
  const opponentHrefParam = request.nextUrl.searchParams.get('opponentHref')?.trim() || '';
  const timeframe = parseTimeframe(request.nextUrl.searchParams.get('timeframe'));
  const leagueFilter: OpponentBreakdownLeagueFilter = {
    competitionName,
    competitionCountry: competitionCountry || null,
  };
  const competitionLabel = buildCompetitionLabel(leagueFilter);
  const currentSeasonYear = getCurrentSoccerSeasonYear();

  if (!competitionName) {
    return NextResponse.json({ error: 'Missing competitionName' }, { status: 400 });
  }

  if (!opponentName && !opponentHrefParam) {
    return NextResponse.json({ error: 'Pass opponentName or opponentHref' }, { status: 400 });
  }

  const isPremierLeagueRequest =
    valuesMatch(competitionName, 'Premier League') && (!competitionCountry || valuesMatch(competitionCountry, 'England'));

  if (timeframe === 'last5' && isPremierLeagueRequest) {
    const snapshot = await readPremierLeagueLast5Snapshot();
    const snapshotTeams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
    const normalizedOpponentHref = normalizeSoccerTeamHref(opponentHrefParam);
    const normalizedOpponentName = normalizeName(opponentName);
    const snapshotTeam =
      snapshotTeams.find((team) => normalizeSoccerTeamHref(String(team?.href || '')) === normalizedOpponentHref) ??
      snapshotTeams.find((team) => normalizeName(String(team?.name || '')) === normalizedOpponentName) ??
      null;

    if (snapshotTeam && Array.isArray(snapshotTeam.stats)) {
      return NextResponse.json({
        mode: 'league',
        competitionLabel: String(snapshot?.competitionLabel || 'England · Premier League'),
        teamsSampled: Number(snapshot?.teamsSampled || snapshotTeams.length),
        teamsInLeague: Number(snapshot?.teamsInLeague || snapshotTeams.length),
        timeframe,
        opponent: {
          name: String(snapshotTeam.name || opponentName || 'Opponent'),
          href: normalizeSoccerTeamHref(String(snapshotTeam.href || opponentHrefParam || '')),
          leagueGames: Number(snapshotTeam.leagueGames || 0),
          stats: snapshotTeam.stats,
        },
        note:
          snapshot?.generatedAt && Number(snapshot?.seasonYear || 0) === currentSeasonYear
            ? `Current season last 5 snapshot built ${new Date(snapshot.generatedAt).toLocaleString()}`
            : snapshot?.generatedAt
              ? `Last 5 snapshot built ${new Date(snapshot.generatedAt).toLocaleString()}`
              : undefined,
      } satisfies OpponentBreakdownApiResponse);
    }
  }

  if (timeframe === 'last5') {
    const roster = await loadLeagueRosterFromSample(leagueFilter);
    if (!roster?.length) {
      return NextResponse.json({
        mode: 'no-roster',
        competitionLabel,
        teamsSampled: 0,
        teamsInLeague: 0,
        timeframe,
        opponent: null,
        note: `Could not load roster data for ${competitionLabel}.`,
      } satisfies OpponentBreakdownApiResponse);
    }

    const resolvedOpponent = resolveRosterTeam(roster, opponentHrefParam, opponentName);
    if (!resolvedOpponent) {
      return NextResponse.json({
        mode: 'no-data',
        competitionLabel,
        teamsSampled: 0,
        teamsInLeague: roster.length,
        timeframe,
        opponent: null,
        note: 'Could not map the opponent to the league roster.',
      } satisfies OpponentBreakdownApiResponse);
    }

    const allAverages: TeamDefensiveAverages[] = [];
    for (let index = 0; index < roster.length; index += CONCURRENCY) {
      const batch = roster.slice(index, index + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (team) => {
          const matches = await loadCachedTeamMatches(team.href);
          if (!matches?.length) return null;
          const seasonMatches = filterMatchesToSeasonYear(matches, currentSeasonYear);
          const recentMatches = sortMatchesByRecency(seasonMatches).slice(0, 5);
          if (!recentMatches.length) return null;
          return computeTeamDefensiveAverages(team.name, team.href, recentMatches);
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
        teamsSampled: 0,
        teamsInLeague: roster.length,
        timeframe,
        opponent: null,
        note: `No cached ${competitionLabel} last 5 data is available yet.`,
      } satisfies OpponentBreakdownApiResponse);
    }

    const opponentAverage =
      allAverages.find((team) => normalizeSoccerTeamHref(team.teamHref) === normalizeSoccerTeamHref(resolvedOpponent.href)) ?? null;
    if (!opponentAverage) {
      return NextResponse.json({
        mode: 'no-data',
        competitionLabel,
        teamsSampled: allAverages.length,
        teamsInLeague: roster.length,
        timeframe,
        opponent: null,
        note: 'Not enough cached data to build the opponent last 5 breakdown yet.',
      } satisfies OpponentBreakdownApiResponse);
    }

    return NextResponse.json({
      mode: 'league',
      competitionLabel,
      teamsSampled: allAverages.length,
      teamsInLeague: roster.length,
      timeframe,
      opponent: {
        name: opponentAverage.teamName,
        href: opponentAverage.teamHref,
        leagueGames: opponentAverage.games,
        stats: buildDynamicRows(opponentAverage, allAverages),
      },
      note:
        allAverages.length < roster.length
          ? `Using last 5 current-season matches for ${allAverages.length} of ${roster.length} teams with cached data.`
          : 'Using each team’s last 5 current-season matches.',
    } satisfies OpponentBreakdownApiResponse);
  }

  if (!isPremierLeagueRequest) {
    return NextResponse.json({
      mode: 'no-data',
      competitionLabel,
      teamsSampled: 0,
      teamsInLeague: 0,
      timeframe,
      opponent: null,
      note: 'Opponent breakdown is served from the cached Premier League snapshot only right now.',
    } satisfies OpponentBreakdownApiResponse);
  }

  const snapshot = await readPremierLeagueSnapshot();
  const snapshotTeams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
  const normalizedOpponentHref = normalizeSoccerTeamHref(opponentHrefParam);
  const normalizedOpponentName = normalizeName(opponentName);
  const snapshotTeam =
    snapshotTeams.find((team) => normalizeSoccerTeamHref(String(team?.href || '')) === normalizedOpponentHref) ??
    snapshotTeams.find((team) => normalizeName(String(team?.name || '')) === normalizedOpponentName) ??
    null;

  if (!snapshotTeam || !Array.isArray(snapshotTeam.stats)) {
    return NextResponse.json({
      mode: 'no-data',
      competitionLabel,
      teamsSampled: Number(snapshot?.teamsSampled || snapshotTeams.length),
      teamsInLeague: Number(snapshot?.teamsInLeague || snapshotTeams.length),
      timeframe,
      opponent: null,
      note:
        snapshotTeams.length > 0
          ? `Opponent not found in the cached ${competitionLabel} snapshot.`
          : `No cached ${competitionLabel} snapshot is available yet. Run the warm/build script first.`,
    } satisfies OpponentBreakdownApiResponse);
  }

  return NextResponse.json({
    mode: 'league',
    competitionLabel: String(snapshot?.competitionLabel || 'England · Premier League'),
    teamsSampled: Number(snapshot?.teamsSampled || snapshotTeams.length),
    teamsInLeague: Number(snapshot?.teamsInLeague || snapshotTeams.length),
    timeframe,
    opponent: {
      name: String(snapshotTeam.name || opponentName || 'Opponent'),
      href: normalizeSoccerTeamHref(String(snapshotTeam.href || opponentHrefParam || '')),
      leagueGames: Number(snapshotTeam.leagueGames || 0),
      stats: snapshotTeam.stats,
    },
    note:
      snapshot?.generatedAt && Number(snapshot?.seasonYear || 0) === currentSeasonYear
        ? `Current season snapshot built ${new Date(snapshot.generatedAt).toLocaleString()}`
        : snapshot?.generatedAt
          ? `Snapshot built ${new Date(snapshot.generatedAt).toLocaleString()}`
          : undefined,
  } satisfies OpponentBreakdownApiResponse);
}
