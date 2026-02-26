import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());

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
function readCachedLeaguePlayerStats(season: number): { season: number; players: LeaguePlayerStatRow[] } | null {
  const files = [
    path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`),
  ];
  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as { season?: number; players?: LeaguePlayerStatRow[] };
      if (!data?.players?.length) continue;
      return { season: data.season ?? season, players: data.players };
    } catch {
      /* try next file */
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();

  const cached = readCachedLeaguePlayerStats(season);
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
