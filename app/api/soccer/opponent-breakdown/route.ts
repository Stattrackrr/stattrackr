import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeSoccerTeamHref } from '@/lib/soccerCache';
import {
  buildCompetitionLabel,
  type OpponentBreakdownLeagueFilter,
  type OpponentBreakdownStatId,
} from '@/lib/soccerOpponentBreakdown';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;

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
    stats?: OpponentBreakdownApiResponse['opponent'] extends { stats: infer T } ? T : never;
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

function getCurrentSoccerSeasonYear(): number {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function normalizeName(n: string): string {
  return n
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
}

export type OpponentBreakdownApiResponse = {
  mode: 'league' | 'no-roster' | 'no-data';
  competitionLabel: string;
  teamsSampled: number;
  teamsInLeague: number;
  opponent: {
    name: string;
    href: string;
    leagueGames: number;
    stats: Array<{
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
    }>;
  } | null;
  note?: string;
};

export async function GET(request: NextRequest) {
  const opponentName = request.nextUrl.searchParams.get('opponentName')?.trim() || '';
  const competitionName = request.nextUrl.searchParams.get('competitionName')?.trim() || '';
  const competitionCountry = request.nextUrl.searchParams.get('competitionCountry')?.trim() || '';
  const opponentHrefParam = request.nextUrl.searchParams.get('opponentHref')?.trim() || '';
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
  if (!isPremierLeagueRequest) {
    return NextResponse.json({
      mode: 'no-data',
      competitionLabel,
      teamsSampled: 0,
      teamsInLeague: 0,
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
