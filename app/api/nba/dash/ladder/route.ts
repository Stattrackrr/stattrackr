import { NextRequest, NextResponse } from 'next/server';
import { loadNbaLadder } from '@/lib/nba/dash/server';
import { NBA_CURRENT_SEASON_YEAR, nbaSeasonLabel } from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/ladder — standings from final regular-season games (last season until tip-off). */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('year') || request.nextUrl.searchParams.get('season');
  const requested = raw == null ? NaN : Number(raw);
  try {
    const year = Number.isFinite(requested) ? requested : NBA_CURRENT_SEASON_YEAR;
    let ladder = await loadNbaLadder(year);
    let shown = year;
    if (!ladder.played && !Number.isFinite(requested)) {
      shown = year - 1;
      ladder = await loadNbaLadder(shown);
    }
    if (!ladder.played) {
      return NextResponse.json({ error: 'NBA ladder unavailable', year, teams: [] }, { status: 404 });
    }
    return NextResponse.json(
      { year: shown, seasonLabel: nbaSeasonLabel(shown), teams: ladder.teams },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, teams: [] }, { status: 500 });
  }
}
