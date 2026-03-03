import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshAflPlayerPropsCache } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/player-props/refresh
 * Refreshes AFL player props cache only (reads games from existing odds cache).
 * Called by Vercel cron 5 min after /api/afl/odds/refresh so props run "just after" odds.
 * Uses ~20–30 API credits (player props only; game odds not re-fetched).
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
