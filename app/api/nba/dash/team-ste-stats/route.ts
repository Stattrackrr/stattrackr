import { NextRequest, NextResponse } from 'next/server';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { resolveNbaDataSeason } from '@/lib/nba/dash/season';
import { buildNbaSteStatsPayload } from '@/lib/nba/dash/steStats';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/team-ste-stats?year=&window= — team offense / allowed averages + ranks. */
export async function GET(request: NextRequest) {
  const yearParam = Number(request.nextUrl.searchParams.get('year') || request.nextUrl.searchParams.get('season') || '');
  const windowParam = Number(request.nextUrl.searchParams.get('window') ?? '0');
  const windowN = Number.isFinite(windowParam) && windowParam >= 0 ? Math.trunc(windowParam) : 0;
  try {
    const year = await resolveNbaDataSeason(Number.isFinite(yearParam) && yearParam > 0 ? yearParam : null);
    const data = await nbaDashCached('team-ste-stats', [year, windowN], NBA_DASH_CACHE.league, () =>
      buildNbaSteStatsPayload({ year, window: windowN })
    );
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to build NBA team stats', window: windowN, teams: [] },
      { status: 500 }
    );
  }
}
