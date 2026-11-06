/**
 * Keep Tools opportunities cache warm so /tools opens near-instant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { resolveSports, runOpportunitiesScan } from '@/lib/tools/runScan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;

  try {
    const sports = resolveSports('all');
    const payload = await runOpportunitiesScan(sports, { force: true });
    return NextResponse.json({
      success: true,
      opportunities: payload.opportunities.length,
      scannedEvents: payload.meta.scannedEvents,
      scannedAt: payload.meta.scannedAt,
    });
  } catch (err) {
    console.error('[cron/warm-tools]', err);
    return NextResponse.json({ success: false, error: 'warm-tools failed' }, { status: 500 });
  }
}
