import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import {
  getHydratedTennisOverlay,
  refreshTennisMatchOverlay,
} from '@/lib/tennis/ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function publishShards(overlay = getHydratedTennisOverlay()) {
  const { publishTennisDashboardCache } = await import('@/lib/tennis/dashboardCache');
  return publishTennisDashboardCache(overlay);
}

/**
 * Incremental tennis ingest: fetch recently finished matches and append
 * them onto Redis player-log shards. Historical games already in cache stay put.
 * Odds, upcoming, DVP, and dashboard warm run on their own crons.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const step = String(request.nextUrl.searchParams.get('step') || 'all').trim().toLowerCase();
  try {
    if (step === 'shards') {
      const overlay = getHydratedTennisOverlay();
      if (!overlay?.matches?.length) {
        return NextResponse.json(
          { success: false, error: 'No overlay in memory; run step=overlay first' },
          { status: 409 }
        );
      }
      const shards = await publishShards(overlay);
      return NextResponse.json({
        success: true,
        step,
        overlayRows: overlay.matches.length,
        shards,
      });
    }

    const { fixtures: _fixtures, ...result } = await refreshTennisMatchOverlay();
    return NextResponse.json({ success: true, step, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
