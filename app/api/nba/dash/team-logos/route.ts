import { NextResponse } from 'next/server';
import { nbaLogoMaps } from '@/lib/nba/dash/server';
import { NBA_CLUBS, NBA_CURRENT_SEASON_YEAR } from '@/lib/nba/dash/teams';

/** GET /api/nba/dash/team-logos — ESPN logos keyed by full name, nickname and code. */
export async function GET() {
  const { logoByTeam, logoByCode } = nbaLogoMaps();
  return NextResponse.json(
    { year: NBA_CURRENT_SEASON_YEAR, clubs: NBA_CLUBS, logoByTeam, logoByCode },
    { headers: { 'Cache-Control': 'public, s-maxage=86400' } }
  );
}
