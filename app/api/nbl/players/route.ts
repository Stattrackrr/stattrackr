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
  const byTeam = ['1', 'true'].includes(
    String(request.nextUrl.searchParams.get('byTeam') || '').toLowerCase()
  );

  const file = path.join(
    process.cwd(),
    'data',
    byTeam ? `nbl-rosters-by-team-${year}.json` : `nbl-roster-${year}.json`
  );
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      {
        error: `Roster for ${year} not found. Run: npm run fetch:nbl:roster:nbl27`,
      },
      { status: 404 }
    );
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Corrupt roster snapshot' }, { status: 503 });
  }
}
