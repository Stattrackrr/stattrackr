import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { clearAflPropStatsCache } from '@/lib/aflPropStatsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/props-stats/clear?secret=CRON_SECRET
 * Clears all AFL prop stats cache entries. Use before re-running warm to repopulate fresh.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  try {
    const deleted = await clearAflPropStatsCache();
    return NextResponse.json({ success: true, deleted });
  } catch (e) {
    console.error('[afl/props-stats/clear]', e);
    return NextResponse.json({ success: false, error: 'Failed to clear cache' }, { status: 500 });
  }
}
