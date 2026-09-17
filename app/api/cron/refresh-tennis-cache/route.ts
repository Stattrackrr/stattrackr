import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import {
  getHydratedTennisOverlay,
  hydrateTennisMatchOverlay,
  refreshTennisMatchOverlay,
} from '@/lib/tennis/ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function publishShards() {
  const overlay = getHydratedTennisOverlay() || (await hydrateTennisMatchOverlay());
  const { publishTennisDashboardCache } = await import('@/lib/tennis/dashboardCache');
  return publishTennisDashboardCache(overlay);
}

/**
 * Incremental tennis ingest: fetch recent finished matches, keep the current-season
 * overlay in Supabase, then publish Redis player-log shards.
 * Odds, upcoming, DVP, and dashboard warm run on their own crons.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const step = String(request.nextUrl.searchParams.get('step') || 'all').trim().toLowerCase();
  try {
    if (step === 'shards') {
      const shards = await publishShards();
      const overlay = getHydratedTennisOverlay();
      return NextResponse.json({
        success: true,
        step,
        overlayRows: overlay?.matches?.length || 0,
        shards,
      });
    }

    const { fixtures: _fixtures, ...result } = await refreshTennisMatchOverlay();
    if (step === 'overlay') {
      return NextResponse.json({ success: true, step, ...result });
    }

    let shards = { players: 0, logs: 0, skipped: true };
    try {
      shards = await publishShards();
    } catch {
      shards = { players: 0, logs: 0, skipped: true };
    }
    return NextResponse.json({
      success: true,
      step: 'all',
      ...result,
      shards,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
