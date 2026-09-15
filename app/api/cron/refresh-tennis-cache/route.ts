import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshTennisMatchOverlay } from '@/lib/tennis/ingest';
import { warmTennisUpcomingFixtures } from '@/lib/tennis/nextGame';
import { refreshTennisOddsSnapshots } from '@/lib/tennis/odds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Incremental tennis ingest: last 16 days of finished ATP/WTA singles + standings.
 * Writes sharedCache overlay and re-pulls live fixture start times for next-opponent lookup.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const { fixtures: _fixtures, ...result } = await refreshTennisMatchOverlay();
    let upcomingPlayers = 0;
    let warmedUpcoming = false;
    try {
      upcomingPlayers = await warmTennisUpcomingFixtures({ force: true });
      warmedUpcoming = upcomingPlayers > 0;
    } catch {
      warmedUpcoming = false;
    }
    let odds = null;
    try {
      odds = await refreshTennisOddsSnapshots({ force: true });
    } catch {
      odds = null;
    }
    return NextResponse.json({
      success: true,
      ...result,
      upcomingPlayers,
      warmedUpcoming,
      odds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
