import { NextResponse } from 'next/server';
import { loadNbaRoster } from '@/lib/nba/dash/server';
import { NBA_CURRENT_SEASON_YEAR, nbaSeasonLabel } from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/players — active NBA players with their current team (search roster). */
export async function GET() {
  try {
    const players = await loadNbaRoster();
    return NextResponse.json(
      {
        year: NBA_CURRENT_SEASON_YEAR,
        seasonLabel: nbaSeasonLabel(NBA_CURRENT_SEASON_YEAR),
        count: players.length,
        players,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, players: [] }, { status: 500 });
  }
}
