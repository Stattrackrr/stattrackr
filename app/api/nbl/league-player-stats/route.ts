import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

export async function GET(request: NextRequest) {
  const requested = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );
  const year = Number.isFinite(requested) ? requested : NBL_CURRENT_SEASON_YEAR;
  const file = path.join(process.cwd(), 'data', `nbl-league-player-stats-${year}.json`);
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      {
        error: `League player stats for ${year} not found. Run: npm run fetch:nbl:league-player-stats -- --year=${year}`,
      },
      { status: 404 }
    );
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Corrupt league player stats snapshot' }, { status: 503 });
  }
}
