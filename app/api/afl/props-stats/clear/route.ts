import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { clearAflPropStatsCache } from '@/lib/aflPropStatsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleClear() {
  console.log('[AFL props-stats/clear] Clearing prop stats cache...');
  const deleted = await clearAflPropStatsCache();
  console.log('[AFL props-stats/clear] Done. Deleted', deleted, 'cache keys. Reload the props page to refetch stats.');
  return NextResponse.json({ success: true, deleted });
}

/**
 * GET or POST /api/afl/props-stats/clear
 * GET: use ?secret=CRON_SECRET in production.
 * POST: allowed for local scripts (no auth in development).
 * Clears all AFL prop stats cache entries. Use before re-running warm to repopulate fresh.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }
  try {
    return await handleClear();
  } catch (e) {
    console.error('[AFL props-stats/clear]', e);
    return NextResponse.json({ success: false, error: 'Failed to clear cache' }, { status: 500 });
  }
}

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ message: 'Use GET with secret for production' }, { status: 405 });
  }
  try {
    return await handleClear();
  } catch (e) {
    console.error('[AFL props-stats/clear]', e);
    return NextResponse.json({ success: false, error: 'Failed to clear cache' }, { status: 500 });
  }
}
