import { NextRequest, NextResponse } from 'next/server';
import { expectedNblGamePace, nblPaceTable } from '@/lib/aiPicks/model/nblPace';
import { loadNblTeamGames } from '@/lib/nbl/teamGames';
import { NBL_CURRENT_SEASON_YEAR, resolveNblClubName } from '@/lib/nblTeamCanonical';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nbl/expected-pace?home=&away=&year=
 * Same matchup pace the AI props model uses (`expectedNblGamePace`).
 */
export async function GET(request: NextRequest) {
  const homeParam = String(request.nextUrl.searchParams.get('home') || '').trim();
  const awayParam = String(request.nextUrl.searchParams.get('away') || '').trim();
  const yearParam = Number(request.nextUrl.searchParams.get('year') || NBL_CURRENT_SEASON_YEAR);
  const season = Number.isFinite(yearParam) ? yearParam : NBL_CURRENT_SEASON_YEAR;

  const home = resolveNblClubName(homeParam) || homeParam;
  const away = resolveNblClubName(awayParam) || awayParam;
  if (!home || !away) {
    return NextResponse.json(
      { error: 'home and away team params are required' },
      { status: 400 }
    );
  }

  try {
    const table = nblPaceTable(loadNblTeamGames([season - 1, season]), season, Date.now());
    const exp = expectedNblGamePace(table, home, away);
    if (!exp) {
      return NextResponse.json({ error: 'Unable to project pace for this matchup' }, { status: 404 });
    }
    return NextResponse.json(
      {
        pace: exp.pace,
        home,
        away,
        h2h: exp.h2h,
        notes: exp.notes,
        season,
        source: 'ai:expectedNblGamePace',
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' } }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
