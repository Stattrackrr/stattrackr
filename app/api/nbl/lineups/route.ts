import { NextRequest, NextResponse } from 'next/server';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';
import { buildRealLineups } from '@/lib/nbl/realLineups';

export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get('team')?.trim() || '';
  const opponent = request.nextUrl.searchParams.get('opponent')?.trim() || '';
  const year = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );

  if (!team) {
    return NextResponse.json({ error: 'Missing team' }, { status: 400 });
  }

  try {
    const result = await buildRealLineups({
      team,
      opponent: opponent || null,
      year: Number.isFinite(year) ? year : NBL_CURRENT_SEASON_YEAR,
    });

    if (!result.team) {
      return NextResponse.json(
        { error: `No completed-game lineup found for "${team}"` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      year: Number.isFinite(year) ? year : NBL_CURRENT_SEASON_YEAR,
      predicted: false,
      source: 'sportradar-embed',
      sharedMatch: result.sharedMatch,
      team: result.team,
      opponent: result.opponent,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load lineups' },
      { status: 502 }
    );
  }
}
