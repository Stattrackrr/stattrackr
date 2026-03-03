import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/player-props/refresh
 * Refreshes AFL player props only (reads games from existing odds cache). Optional manual endpoint.
 * The main cron is /api/afl/odds/refresh, which does odds + props in one run; use this only to re-fetch props without re-fetching odds.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) {
      return auth.response;
    }
  }

  try {
    const result = await refreshAflPlayerPropsCache();
    return NextResponse.json({
      success: result.success,
      eventsRefreshed: result.eventsRefreshed,
      playersWithProps: result.playersWithProps,
      error: result.error ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
