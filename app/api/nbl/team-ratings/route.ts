import { NextRequest, NextResponse } from 'next/server';
import { loadNblTeamRatings } from '@/lib/nbl/teamRatings';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

export async function GET(request: NextRequest) {
  const yearParam = Number(request.nextUrl.searchParams.get('year') || NBL_CURRENT_SEASON_YEAR);
  const year = Number.isFinite(yearParam) ? yearParam : NBL_CURRENT_SEASON_YEAR;
  const payload = loadNblTeamRatings(year);
  return NextResponse.json(payload);
}
