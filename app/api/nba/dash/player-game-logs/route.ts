import { NextRequest, NextResponse } from 'next/server';
import { loadNbaPlayerGameLogs, loadNbaPlayerMeta } from '@/lib/nba/dash/server';
import { getNbaClubById, NBA_CHART_HISTORY_YEARS, NBA_CURRENT_SEASON_YEAR, nbaSeasonLabel } from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

function parseYears(request: NextRequest): number[] {
  const yearsParam = String(request.nextUrl.searchParams.get('years') || '').trim();
  if (yearsParam) {
    const parsed = yearsParam
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((y) => Number.isFinite(y) && y >= 2015 && y <= 2100);
    if (parsed.length) return [...new Set(parsed)];
  }
  if (['1', 'true'].includes(String(request.nextUrl.searchParams.get('history') || '').toLowerCase())) {
    return [...NBA_CHART_HISTORY_YEARS];
  }
  const year = Number(request.nextUrl.searchParams.get('year') || request.nextUrl.searchParams.get('season') || NBA_CURRENT_SEASON_YEAR);
  return [Number.isFinite(year) ? year : NBA_CURRENT_SEASON_YEAR];
}

/** GET /api/nba/dash/player-game-logs?playerId=&years= — stored box scores + quarters + tracking. */
export async function GET(request: NextRequest) {
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  if (!playerId) {
    return NextResponse.json({ error: 'Provide playerId' }, { status: 400 });
  }
  const years = parseYears(request);
  try {
    const [games, meta] = await Promise.all([loadNbaPlayerGameLogs(playerId, years), loadNbaPlayerMeta(playerId)]);
    return NextResponse.json(
      {
        playerId,
        name: meta?.full_name ?? null,
        team: getNbaClubById(meta?.team_id)?.name ?? null,
        years,
        year: years[0] ?? NBA_CURRENT_SEASON_YEAR,
        seasonLabel: years.map(nbaSeasonLabel).join('+'),
        generatedAt: new Date().toISOString(),
        source: 'supabase',
        gameCount: games.length,
        games,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' } }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, games: [] }, { status: 500 });
  }
}
