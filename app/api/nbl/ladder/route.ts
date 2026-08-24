import { NextRequest, NextResponse } from 'next/server';
import {
  nblLadderHasPlayedGames,
  nblLastCompletedSeasonYear,
  readNblLadderSnapshot,
  resolveNblLadderYear,
} from '@/lib/nbl/ladderSeason';

const TTL_MS = 1000 * 60 * 30;
const cache = new Map<number, { expiresAt: number; data: unknown }>();

export async function GET(request: NextRequest) {
  const rawYear =
    request.nextUrl.searchParams.get('year') || request.nextUrl.searchParams.get('season');
  const requested = rawYear == null ? NaN : Number(rawYear);
  const year = Number.isFinite(requested) ? requested : resolveNblLadderYear();
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';

  const cached = cache.get(year);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  const snapshot = readNblLadderSnapshot(year);
  if (nblLadderHasPlayedGames(snapshot?.teams)) {
    cache.set(year, { expiresAt: Date.now() + TTL_MS, data: snapshot });
    return NextResponse.json(snapshot);
  }

  if (!Number.isFinite(requested)) {
    const fallbackYear = nblLastCompletedSeasonYear();
    if (fallbackYear !== year) {
      const fallback = readNblLadderSnapshot(fallbackYear);
      if (nblLadderHasPlayedGames(fallback?.teams)) {
        cache.set(year, { expiresAt: Date.now() + TTL_MS, data: fallback });
        return NextResponse.json(fallback);
      }
    }
  }

  return NextResponse.json(
    { error: 'NBL ladder unavailable', year, teams: [] },
    { status: 404 }
  );
}
