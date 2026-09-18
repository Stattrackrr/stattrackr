import { after, NextRequest, NextResponse } from 'next/server';
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

async function runTennisIngest(step: string) {
  if (step === 'shards') {
    const overlay = getHydratedTennisOverlay();
    if (!overlay?.matches?.length) {
      throw new Error('No overlay in memory; run step=overlay first');
    }
    const shards = await publishShards(overlay);
    return { step, overlayRows: overlay.matches.length, shards };
  }
  const { fixtures: _fixtures, ...result } = await refreshTennisMatchOverlay();
  return { step, ...result };
}

/**
 * Incremental tennis ingest: fetch recently finished matches and append
 * them onto Redis player-log shards. Historical games already in cache stay put.
 * Default GitHub/Vercel cron returns immediately and finishes via after().
 * Odds, upcoming, DVP, and dashboard warm run on their own crons.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const step = String(request.nextUrl.searchParams.get('step') || 'all').trim().toLowerCase();
  const sync = request.nextUrl.searchParams.get('sync') === '1';
  if (sync) {
    try {
      const result = await runTennisIngest(step);
      return NextResponse.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }
  after(async () => {
    try {
      await runTennisIngest(step);
    } catch (err) {
      console.error('[tennis ingest]', err);
    }
  });
  return NextResponse.json({ success: true, accepted: true, step });
}
