import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { GET as getPlayerGameLogs } from '@/app/api/afl/player-game-logs/route';
import { footywireNicknameToOfficial, leagueTeamToOfficial, rosterTeamToInjuryTeam } from '@/lib/aflTeamMapping';
import { dedupeAflGames } from '@/lib/aflGameDedupe';

const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());
const SUPPORTED_SEASONS = [2026, 2025, 2024] as const;
const MAX_CANDIDATE_PLAYERS = 8;
const TEAM_GAME_LOGS_BATCH_SIZE = 3;
const TEAM_GAME_LOGS_CACHE_TTL_MS = 1000 * 60 * 10;

type AflGameLogRecord = Record<string, unknown>;
type LeaguePlayerStatRow = {
  name: string;
  team: string;
  games: number;
};
type TeamGameLogsResponse = {
  season: number;
  team: string;
  source: 'club-aggregate';
  expectedGameCount?: number | null;
  candidatesUsed: string[];
  games: AflGameLogRecord[];
  gamesWithQuarters: AflGameLogRecord[];
  game_count: number;
};

const teamGameLogsCache = new Map<string, { expiresAt: number; payload: TeamGameLogsResponse }>();

function resolveToOfficialTeam(teamRaw: string | undefined | null): string | null {
  if (!teamRaw || typeof teamRaw !== 'string') return null;
  const trimmed = teamRaw.trim();
  if (!trimmed) return null;
  return leagueTeamToOfficial(trimmed) || footywireNicknameToOfficial(trimmed) || rosterTeamToInjuryTeam(trimmed) || trimmed;
}

function readCachedLeaguePlayerStats(season: number): LeaguePlayerStatRow[] {
  try {
    const fileName =
      season === 2026
        ? 'afl-league-player-stats-2026.json'
        : season === 2025
          ? 'afl-league-player-stats-2025.json'
          : season === 2024
            ? 'afl-league-player-stats-2024.json'
            : null;
    if (!fileName) return [];
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', fileName), 'utf8');
    const data = JSON.parse(raw) as { players?: LeaguePlayerStatRow[] };
    return Array.isArray(data?.players) ? data.players : [];
  } catch {
    return [];
  }
}

function readExpectedTeamGameCount(season: number, officialTeam: string): number | null {
  try {
    const fileName =
      season === 2026
        ? 'afl-team-rankings-2026-ta.json'
        : season === 2025
          ? 'afl-team-rankings-2025-ta.json'
          : season === 2024
            ? 'afl-team-rankings-2024-ta.json'
            : null;
    if (!fileName) return null;
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', fileName), 'utf8');
    const data = JSON.parse(raw) as {
      teams?: Array<{ team?: string; stats?: Record<string, number | string | null> }>;
    };
    const row = (data.teams ?? []).find((teamRow) => resolveToOfficialTeam(teamRow?.team ?? null) === officialTeam);
    const gamesRaw = row?.stats?.Gm;
    const games = typeof gamesRaw === 'number' ? gamesRaw : Number(gamesRaw ?? NaN);
    return Number.isFinite(games) ? games : null;
  } catch {
    return null;
  }
}

async function fetchPlayerLogsForTeamSeason(season: number, playerName: string, team: string): Promise<{
  games: AflGameLogRecord[];
  gamesWithQuarters: AflGameLogRecord[];
} | null> {
  const url = new URL('http://localhost/api/afl/player-game-logs');
  url.searchParams.set('season', String(season));
  url.searchParams.set('player_name', playerName);
  url.searchParams.set('team', team);
  url.searchParams.set('include_both', '1');

  try {
    const response = await getPlayerGameLogs(new NextRequest(url));
    if (!response.ok) return null;
    const payload = await response.json() as {
      games?: AflGameLogRecord[];
      gamesWithQuarters?: AflGameLogRecord[];
    };
    return {
      games: Array.isArray(payload?.games) ? payload.games : [],
      gamesWithQuarters: Array.isArray(payload?.gamesWithQuarters) ? payload.gamesWithQuarters : (Array.isArray(payload?.games) ? payload.games : []),
    };
  } catch {
    return null;
  }
}

function buildTeamGameLogsCacheKey(season: number, team: string): string {
  return `${season}:${team.trim().toLowerCase()}`;
}

export async function GET(request: NextRequest) {
  const teamParam = request.nextUrl.searchParams.get('team')?.trim() ?? '';
  const seasonParam = request.nextUrl.searchParams.get('season');
  const requestedSeason = seasonParam ? parseInt(seasonParam, 10) : parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();
  const season = SUPPORTED_SEASONS.includes(requestedSeason as (typeof SUPPORTED_SEASONS)[number])
    ? requestedSeason
    : 2026;

  const officialTeam = resolveToOfficialTeam(teamParam);
  if (!officialTeam) {
    return NextResponse.json({ error: 'Missing team parameter' }, { status: 400 });
  }

  const cacheKey = buildTeamGameLogsCacheKey(season, officialTeam);
  const cached = teamGameLogsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }
  const candidates = readCachedLeaguePlayerStats(season)
    .filter((player) => resolveToOfficialTeam(player.team) === officialTeam)
    .sort((a, b) => {
      const gamesDelta = (Number(b.games) || 0) - (Number(a.games) || 0);
      if (gamesDelta !== 0) return gamesDelta;
      return a.name.localeCompare(b.name, 'en');
    })
    .slice(0, MAX_CANDIDATE_PLAYERS);

  if (candidates.length === 0) {
    const emptyPayload: TeamGameLogsResponse = {
      season,
      team: officialTeam,
      source: 'club-aggregate',
      candidatesUsed: [],
      games: [],
      gamesWithQuarters: [],
      game_count: 0,
    };
    teamGameLogsCache.set(cacheKey, {
      expiresAt: Date.now() + TEAM_GAME_LOGS_CACHE_TTL_MS,
      payload: emptyPayload,
    });
    return NextResponse.json(emptyPayload);
  }

  const expectedGameCount = readExpectedTeamGameCount(season, officialTeam);
  let games: AflGameLogRecord[] = [];
  let gamesWithQuarters: AflGameLogRecord[] = [];
  const candidatesUsed: string[] = [];

  for (let i = 0; i < candidates.length; i += TEAM_GAME_LOGS_BATCH_SIZE) {
    const batch = candidates.slice(i, i + TEAM_GAME_LOGS_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (candidate) => ({
        candidate,
        payload: await fetchPlayerLogsForTeamSeason(season, candidate.name, officialTeam),
      }))
    );

    for (const { candidate, payload } of batchResults) {
      if (!payload) continue;
      candidatesUsed.push(candidate.name);
      games = dedupeAflGames([...games, ...payload.games]);
      gamesWithQuarters = dedupeAflGames([...gamesWithQuarters, ...payload.gamesWithQuarters]);
    }

    if (expectedGameCount != null) {
      const currentCount = Math.max(games.length, gamesWithQuarters.length);
      if (currentCount >= expectedGameCount) {
        break;
      }
    }
  }

  const payload: TeamGameLogsResponse = {
    season,
    team: officialTeam,
    source: 'club-aggregate',
    expectedGameCount,
    candidatesUsed,
    game_count: Math.max(games.length, gamesWithQuarters.length),
    games,
    gamesWithQuarters,
  };
  teamGameLogsCache.set(cacheKey, {
    expiresAt: Date.now() + TEAM_GAME_LOGS_CACHE_TTL_MS,
    payload,
  });
  return NextResponse.json(payload);
}
