import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { runAflPropsStatsWarm } from '@/lib/aflPropsStatsWarm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/props-stats/warm
 * Warms the AFL prop stats cache by fetching game logs and computing L5/L10/H2H/Season/Streak/DvP
 * for all current props from the list cache. Call after player-props/refresh (cron or workflow).
 * Protected by CRON_SECRET in production.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const origin = request.nextUrl?.origin ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const baseUrl = origin.startsWith('http') ? origin : `https://${origin}`;
  const useListApi = request.nextUrl?.searchParams?.get('useList') === '1';
  const cronSecret = (process.env.CRON_SECRET ?? '').replace(/\r\n|\r|\n/g, '').trim();

  const result = await runAflPropsStatsWarm(baseUrl, { useListApi, cronSecret });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error, warmed: 0 }, { status: 500 });
  }

  // Rebuild enriched list payload after stats warm so props page doesn't keep stale H2H/L5/L10 values.
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cronSecret) {
      headers.Authorization = `Bearer ${cronSecret}`;
      headers['X-Cron-Secret'] = cronSecret;
    }
    await fetch(`${baseUrl}/api/afl/player-props/list?enrich=true`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
  } catch {
    // Ignore prewarm errors; the warm result above is still valid.
  }

  const message =
    (result.total ?? 0) < 50
      ? 'Run /api/afl/odds/refresh first so the props cache has all games (aim for eventsRefreshed = gamesCount). Use ?useList=1 to warm the exact rows the list API returns.'
      : undefined;

  return NextResponse.json({
    success: true,
    warmed: result.warmed,
    failed: result.failed,
    noData: result.noData,
    coveragePct: result.coveragePct,
    total: result.total,
    skipped: result.skipped,
    rowsFromCache: result.rowsFromCache,
    uniqueProps: result.uniqueProps,
    ...(useListApi ? { source: 'listApi' } : {}),
    ...(message ? { message } : {}),
  });
}
