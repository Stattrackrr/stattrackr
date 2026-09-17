import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshTennisMatchOverlay } from '@/lib/tennis/ingest';
import { warmTennisUpcomingFixtures } from '@/lib/tennis/nextGame';
import { refreshTennisOddsSnapshots } from '@/lib/tennis/odds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Incremental tennis ingest: fetch last 90 days, keep the current-season overlay in Supabase.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const { fixtures: _fixtures, ...result } = await refreshTennisMatchOverlay();
    const overlay = (await import('@/lib/tennis/ingest')).getHydratedTennisOverlay();
    let shards = { players: 0, logs: 0, skipped: true };
    try {
      const { publishTennisDashboardCache } = await import('@/lib/tennis/dashboardCache');
      shards = await publishTennisDashboardCache(overlay);
    } catch {
      /* shards still publish in the background from ingest */
    }
    let dashboard = { matchups: 0 };
    try {
      const { warmTennisDashboardComputed } = await import('@/lib/tennis/dashboardWarm');
      dashboard = await warmTennisDashboardComputed();
    } catch {
      dashboard = { matchups: 0 };
    }
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
      dashboard,
      shards,
      odds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
