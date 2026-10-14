import { NextRequest, NextResponse } from 'next/server';
import { loadNbaLineups } from '@/lib/nba/dash/server';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/lineups?team= — starters/bench from the team's latest completed game. */
export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get('team')?.trim() || '';
  if (!team) return NextResponse.json({ error: 'Missing team' }, { status: 400 });
  try {
    const result = await loadNbaLineups(team);
    if (!result) {
      return NextResponse.json({ error: `No completed-game lineup found for "${team}"` }, { status: 404 });
    }
    return NextResponse.json(
      {
        year: result.year,
        predicted: false,
        source: 'supabase',
        sharedMatch: true,
        team: result.team,
        opponent: result.opponent,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load lineups' }, { status: 502 });
  }
}
