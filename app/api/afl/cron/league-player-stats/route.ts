import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { buildLeaguePlayerStatsPayload } from '@/lib/afl/footywireLeaguePlayerStats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * GET /api/afl/cron/league-player-stats?season=2026
 * Scrapes FootyWire from production (Vercel) when GitHub Actions IPs are blocked.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;

  const seasonParam = request.nextUrl.searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(season)) {
    return NextResponse.json({ success: false, error: 'Invalid season' }, { status: 400 });
  }

  try {
    const result = await buildLeaguePlayerStatsPayload(season, {
      allowStale: false,
      skipStaleProbe: true,
    });
    if (result.stale || !result.payload) {
      return NextResponse.json(
        { success: false, error: result.reason || 'FootyWire scrape returned no payload' },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, ...result.payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
