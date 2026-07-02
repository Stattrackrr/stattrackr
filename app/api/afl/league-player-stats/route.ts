import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readAflDataJsonFile } from '@/lib/readAflDataJson';

const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());
const SUPPORTED_SEASONS = [2026, 2025, 2024] as const;

export type LeaguePlayerStatRow = {
  name: string;
  team: string;
  games: number;
  disposals: number;
  kicks: number;
  handballs: number;
  marks: number;
  goals: number;
  tackles: number;
  clearances: number;
  inside_50s: number;
  rebound_50s: number;
};

/** Read cached league player stats. Run scripts/fetch-footywire-league-player-stats.js to refresh. */
function readCachedLeaguePlayerStats(season: number): { season: number; players: LeaguePlayerStatRow[] } | null | 'corrupt' {
  const fileName =
    season === 2026
      ? 'afl-league-player-stats-2026.json'
      : season === 2025
        ? 'afl-league-player-stats-2025.json'
        : season === 2024
          ? 'afl-league-player-stats-2024.json'
          : null;
  if (!fileName) return null;
  const result = readAflDataJsonFile<{ season?: number; players?: LeaguePlayerStatRow[] }>(
    path.join(process.cwd(), 'data', fileName)
  );
  if (!result.ok) return result.reason === 'corrupt' ? 'corrupt' : null;
  const data = result.data;
  if (!data?.players?.length) return null;
  return { season: data.season ?? season, players: data.players };
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season');
  const requestedSeason = seasonParam ? parseInt(seasonParam, 10) : parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();
  const season = SUPPORTED_SEASONS.includes(requestedSeason as (typeof SUPPORTED_SEASONS)[number])
    ? requestedSeason
    : 2026;

  const cached = readCachedLeaguePlayerStats(season);
  if (cached === 'corrupt') {
    return NextResponse.json(
      { error: `League player stats for ${season} are corrupt (merge conflict). Re-run AFL data refresh.` },
      { status: 503 }
    );
  }
  if (!cached) {
    const prev = readCachedLeaguePlayerStats(season - 1);
    if (prev) {
      return NextResponse.json({
        ...prev,
        _note: `No data for ${season}; returning ${season - 1}`,
      });
    }
    return NextResponse.json(
      { error: 'League player stats not found. Run: npm run fetch:footywire-league-player-stats' },
      { status: 404 }
    );
  }

  return NextResponse.json(cached);
}
