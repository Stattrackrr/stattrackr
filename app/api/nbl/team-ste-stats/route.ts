import { NextRequest, NextResponse } from 'next/server';
import { NBL_CURRENT_SEASON_YEAR, NBL_SHOT_CHART_SEASON_YEAR } from '@/lib/nblTeamCanonical';
import { buildNblSteStatsPayload } from '@/lib/nbl/teamSteStats';

const TTL_MS = 1000 * 60 * 30;
const cache = new Map<string, { expiresAt: number; data: unknown }>();

export async function GET(request: NextRequest) {
  const yearParam = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      ''
  );
  const year = Number.isFinite(yearParam) && yearParam > 0 ? yearParam : NBL_SHOT_CHART_SEASON_YEAR;
  const windowParam = Number(request.nextUrl.searchParams.get('window') ?? '0');
  const windowN = Number.isFinite(windowParam) && windowParam >= 0 ? Math.trunc(windowParam) : 0;
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';

  const cacheKey = `${year}:${windowN}`;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    const data = buildNblSteStatsPayload({ year, window: windowN });

    // If requested current season has no games yet, fall back to last completed season
    // unless the caller explicitly asked for that empty year.
    if (
      data.teamCount === 0 &&
      year === NBL_CURRENT_SEASON_YEAR &&
      !request.nextUrl.searchParams.get('year') &&
      !request.nextUrl.searchParams.get('season')
    ) {
      const fallback = buildNblSteStatsPayload({
        year: NBL_SHOT_CHART_SEASON_YEAR,
        window: windowN,
      });
      cache.set(`${NBL_SHOT_CHART_SEASON_YEAR}:${windowN}`, {
        expiresAt: Date.now() + TTL_MS,
        data: fallback,
      });
      return NextResponse.json(fallback);
    }

    cache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, data });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Failed to build NBL STE stats',
        year,
        window: windowN,
        teams: [],
      },
      { status: 500 }
    );
  }
}
