import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());

/** Read cached team rankings. Run scripts/fetch-footywire-team-rankings.js to refresh. */
function readCachedTeamRankings(season: number, type: 'ta' | 'oa' = 'ta') {
  const files = [
    path.join(process.cwd(), 'data', `afl-team-rankings-${season}-${type}.json`),
    path.join(process.cwd(), 'data', `afl-team-rankings-${season}.json`),
  ];
  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as {
        season?: number;
        teams?: Array<{ rank: number | null; team: string; stats: Record<string, number | string | null> }>;
        statColumns?: string[];
        statLabels?: Record<string, string>;
      };
      if (!data?.teams?.length) continue;
      return data;
    } catch {
      /* try next file */
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season');
  const typeParam = request.nextUrl.searchParams.get('type') as 'ta' | 'oa' | null;
  const type = typeParam === 'oa' ? 'oa' : 'ta';
  const season = seasonParam ? parseInt(seasonParam, 10) : parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();

  const cached = readCachedTeamRankings(season, type);
  if (!cached) {
    const prev = readCachedTeamRankings(season - 1, type);
    if (prev) {
      return NextResponse.json({
        ...prev,
        season,
        _note: `No data for ${season}; returning ${season - 1}`,
      });
    }
    return NextResponse.json(
      { error: 'Team rankings not found. Run: npm run fetch:footywire-team-rankings' },
      { status: 404 }
    );
  }

  return NextResponse.json(cached);
}
