/**
 * Keep Tools opportunities cache warm so /tools opens near-instant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { sendToolsArbPush } from '@/lib/push/send';
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
    const push = await sendToolsArbPush(payload.opportunities).catch((err) => {
      console.error('[cron/warm-tools] arb push', err);
      return { sent: 0, removed: 0, skipped: 0, error: (err as Error).message };
    });
    return NextResponse.json({
      success: true,
      opportunities: payload.opportunities.length,
      scannedEvents: payload.meta.scannedEvents,
      scannedAt: payload.meta.scannedAt,
      arbPush: push,
    });
  } catch (err) {
    console.error('[cron/warm-tools]', err);
    return NextResponse.json({ success: false, error: 'warm-tools failed' }, { status: 500 });
  }
}
