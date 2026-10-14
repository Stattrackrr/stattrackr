import { NextRequest, NextResponse } from 'next/server';
import { loadNbaPlayerRatings } from '@/lib/nba/dash/leagueCards';
import { resolveNbaDataSeason } from '@/lib/nba/dash/season';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/player-ratings?year= — minutes-weighted on-court ORtg / DRtg. */
export async function GET(request: NextRequest) {
  const yearParam = Number(request.nextUrl.searchParams.get('year') || '');
  try {
    const year = await resolveNbaDataSeason(Number.isFinite(yearParam) && yearParam > 0 ? yearParam : null);
    return NextResponse.json(await loadNbaPlayerRatings(year), {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, players: [] }, { status: 500 });
  }
}
