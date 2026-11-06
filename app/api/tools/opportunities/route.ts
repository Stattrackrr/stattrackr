import { NextRequest, NextResponse } from 'next/server';
import { apiRateLimiter, checkRateLimit } from '@/lib/rateLimit';
import { allowToolsAdmin } from '@/lib/tools/auth';
import { resolveSports, runOpportunitiesScan } from '@/lib/tools/runScan';
import type { ToolsKind, ToolsSport } from '@/lib/tools/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const rate = checkRateLimit(request, apiRateLimiter);
  if (!rate.allowed && rate.response) return rate.response;
  if (!(await allowToolsAdmin(request))) {
    return NextResponse.json(
      { success: false, adminRequired: true, error: 'Betting Tools is admin-only.' },
      { status: 403 }
    );
  }

  const sportParam = request.nextUrl.searchParams.get('sport');
  const kindParam = (request.nextUrl.searchParams.get('kind') || 'all').toLowerCase();
  const force = request.nextUrl.searchParams.get('fresh') === '1';
  const sports = resolveSports(sportParam);

  try {
    const payload = await runOpportunitiesScan(sports, { force });
    let opportunities = payload.opportunities;
    if (kindParam === 'arb' || kindParam === 'middles' || kindParam === 'ev') {
      opportunities = opportunities.filter((o) => o.kind === (kindParam as Exclude<ToolsKind, 'bonus'>));
    }
    // All tab never includes bonus (handled by a separate route).
    return NextResponse.json({
      success: true,
      opportunities,
      meta: payload.meta,
      sports: sports as ToolsSport[],
    });
  } catch (err) {
    console.error('[tools/opportunities]', err);
    return NextResponse.json({ success: false, error: 'Tools scan failed. Try again shortly.' }, { status: 500 });
  }
}
