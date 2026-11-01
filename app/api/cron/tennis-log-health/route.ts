import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { checkTennisLogHealth, saveTennisLogHealth } from '@/lib/tennis/log/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/** Daily: tennis logger integrity (poller, close arms, results, would-be bets, feeds, coverage). */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const health = await checkTennisLogHealth();
    await saveTennisLogHealth(health);
    return NextResponse.json({ success: true, health });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
