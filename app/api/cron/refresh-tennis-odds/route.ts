import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshTennisOddsSnapshots } from '@/lib/tennis/odds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

/**
 * Pull The Odds API once per active tennis sport, merge with API-Tennis get_odds,
 * and store snapshots for upcoming matches. Page/Ask reads never hit The Odds API.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const force = request.nextUrl.searchParams.get('force') === '1';
    const result = await refreshTennisOddsSnapshots({ force });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
