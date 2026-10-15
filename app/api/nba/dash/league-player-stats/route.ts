import { NextRequest, NextResponse } from 'next/server';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { getNbaSeasonDataset, resolveNbaDataSeason } from '@/lib/nba/dash/season';
import { nbaSeasonLabel } from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/league-player-stats?year= — season per-game averages for every player. */
export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get('year') || request.nextUrl.searchParams.get('season') || '');
  try {
    const year = await resolveNbaDataSeason(Number.isFinite(requested) && requested > 0 ? requested : null);
    const players = await nbaDashCached('league-player-stats', [year], NBA_DASH_CACHE.league, async () => {
      const data = await getNbaSeasonDataset(year);
      return data.league;
    });
    return NextResponse.json(
      { year, seasonLabel: nbaSeasonLabel(year), count: players.length, players },
      { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, players: [] }, { status: 500 });
  }
}
