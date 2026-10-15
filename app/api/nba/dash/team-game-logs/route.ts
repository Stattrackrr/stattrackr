import { NextRequest, NextResponse } from 'next/server';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { loadNbaTeamGameLogs } from '@/lib/nba/dash/server';
import { NBA_CHART_HISTORY_YEARS, resolveNbaClubName } from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/team-game-logs?team=&years= — final scores + quarters for Game Props. */
export async function GET(request: NextRequest) {
  const teamParam = String(request.nextUrl.searchParams.get('team') || '').trim();
  const team = resolveNbaClubName(teamParam) || teamParam;
  if (!team) return NextResponse.json({ error: 'Missing team parameter' }, { status: 400 });
  const yearsParam = String(request.nextUrl.searchParams.get('years') || '').trim();
  const years = yearsParam
    ? yearsParam.split(',').map(Number).filter((y) => Number.isFinite(y))
    : [...NBA_CHART_HISTORY_YEARS];
  try {
    const games = await nbaDashCached('team-game-logs', [team.toLowerCase(), years], NBA_DASH_CACHE.teamLogs, () =>
      loadNbaTeamGameLogs(team, years)
    );
    return NextResponse.json(
      { team, years, gameCount: games.length, games },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' } }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, games: [] }, { status: 500 });
  }
}
