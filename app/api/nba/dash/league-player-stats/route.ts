import { NextRequest, NextResponse } from 'next/server';
import { getNbaSeasonDataset, resolveNbaDataSeason } from '@/lib/nba/dash/season';
import { nbaSeasonLabel } from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/league-player-stats?year= — season per-game averages for every player. */
export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get('year') || request.nextUrl.searchParams.get('season') || '');
  try {
    const year = await resolveNbaDataSeason(Number.isFinite(requested) && requested > 0 ? requested : null);
    const data = await getNbaSeasonDataset(year);
    return NextResponse.json(
      { year, seasonLabel: nbaSeasonLabel(year), count: data.league.length, players: data.league },
      { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, players: [] }, { status: 500 });
  }
}
