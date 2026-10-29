import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { recordLineupVersions } from '@/lib/nba/propLog/context';
import { logRotowireLineups } from '@/lib/nba/rotowireLineups';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Log RotoWire's predicted NBA starters and "may not play" tags (Redis, 21 days) so they can be
 * checked against actual starters, and every changed team lineup as a version row for the NBA prop
 * log. Throttles itself; most runs return without fetching.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const result = await logRotowireLineups();
    const page = result.fetched ? result.page : undefined;
    if ('warning' in result && result.warning) console.warn('[NBA lineups log]', result.warning);
    let versions: number | string = 0;
    if (page) {
      try {
        versions = await recordLineupVersions(page, Date.now());
      } catch (err) {
        versions = `failed: ${err instanceof Error ? err.message : err}`;
        console.warn('[NBA lineups log] versions', versions);
      }
    }
    return NextResponse.json({ success: true, ...result, page: undefined, versions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[NBA lineups log] failed', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
