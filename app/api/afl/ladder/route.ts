import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());

export type LadderRow = {
  pos: number;
  team: string;
  played: number;
  win: number;
  loss: number;
  draw: number;
  points_for: number | null;
  points_against: number | null;
  percentage: number | null;
  premiership_points: number | null;
};

/** Read cached premiership ladder. Run scripts/fetch-footywire-ladder.js to refresh. */
function readCachedLadder(season: number): { season: number; teams: LadderRow[] } | null {
  const files = [
    path.join(process.cwd(), 'data', `afl-ladder-${season}.json`),
    path.join(process.cwd(), 'data', `afl-ladder-${season - 1}.json`),
  ];
  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as { season?: number; teams?: LadderRow[] };
      if (!data?.teams?.length) continue;
      return { season: data.season ?? season, teams: data.teams };
    } catch {
      /* try next file */
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();

  const cached = readCachedLadder(season);
  if (!cached) {
    const prev = readCachedLadder(season - 1);
    if (prev) {
      return NextResponse.json({
        ...prev,
        _note: `No ladder for ${season}; returning ${season - 1}`,
      });
    }
    return NextResponse.json(
      { error: 'Ladder not found. Run: npm run fetch:footywire-ladder' },
      { status: 404 }
    );
  }

  return NextResponse.json(cached);
}
