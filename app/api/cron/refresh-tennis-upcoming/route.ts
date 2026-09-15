import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { warmTennisUpcomingFixtures } from '@/lib/tennis/nextGame';
import { syncTennisCommenceTimesFromUpcoming } from '@/lib/tennis/odds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Re-pull API-Tennis fixture start times. Tennis order-of-play ("not before")
 * moves all day; odds snapshots should not freeze the Start column.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const upcomingPlayers = await warmTennisUpcomingFixtures({ force: true });
    const times = await syncTennisCommenceTimesFromUpcoming();
    return NextResponse.json({
      success: true,
      upcomingPlayers,
      commenceTimesUpdated: times.updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
