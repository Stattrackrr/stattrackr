import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshTennisMatchOverlay } from '@/lib/tennis/ingest';
import { warmTennisUpcomingFixtures } from '@/lib/tennis/nextGame';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Incremental tennis ingest: last 16 days of finished ATP/WTA singles + standings.
 * Writes sharedCache overlay and warms upcoming fixtures.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const result = await refreshTennisMatchOverlay();
    let warmedUpcoming = false;
    try {
      await warmTennisUpcomingFixtures();
      warmedUpcoming = true;
    } catch {
      warmedUpcoming = false;
    }
    return NextResponse.json({
      success: true,
      ...result,
      warmedUpcoming,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
