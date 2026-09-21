import { NextRequest, NextResponse } from 'next/server';
import {
  nblLadderHasPlayedGames,
  nblLastCompletedSeasonYear,
  readNblLadderSnapshot,
  resolveNblLadderYear,
} from '@/lib/nbl/ladderSeason';

export async function GET(request: NextRequest) {
  const rawYear =
    request.nextUrl.searchParams.get('year') || request.nextUrl.searchParams.get('season');
  const requested = rawYear == null ? NaN : Number(rawYear);
  const year = Number.isFinite(requested) ? requested : resolveNblLadderYear();

  const snapshot = readNblLadderSnapshot(year);
  if (nblLadderHasPlayedGames(snapshot?.teams)) {
    return NextResponse.json(snapshot);
  }

  if (!Number.isFinite(requested)) {
    const fallbackYear = nblLastCompletedSeasonYear();
    if (fallbackYear !== year) {
      const fallback = readNblLadderSnapshot(fallbackYear);
      if (nblLadderHasPlayedGames(fallback?.teams)) {
        return NextResponse.json(fallback);
      }
    }
  }

  return NextResponse.json(
    { error: 'NBL ladder unavailable', year, teams: [] },
    { status: 404 }
  );
}
