import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { logRotowireLineups } from '@/lib/nba/rotowireLineups';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Log RotoWire's predicted NBA starters and "may not play" tags (Redis, 21 days) so they can be
 * checked against actual starters. Throttles itself; most runs return without fetching.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const result = await logRotowireLineups();
    if ('warning' in result && result.warning) console.warn('[NBA lineups log]', result.warning);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[NBA lineups log] failed', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
