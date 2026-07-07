import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { buildLeaguePlayerStatsPayload } from '@/lib/afl/footywireLeaguePlayerStats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/afl/cron/league-player-stats?season=2026&mode=minimal
 * Scrapes FootyWire from production (Vercel) when GitHub Actions IPs are blocked.
 * Default mode=minimal refreshes games/disposals from one rankings page (fast, avoids 504).
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;

  const seasonParam = request.nextUrl.searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(season)) {
    return NextResponse.json({ success: false, error: 'Invalid season' }, { status: 400 });
  }

  const modeParam = (request.nextUrl.searchParams.get('mode') || 'minimal').trim().toLowerCase();
  const mode = modeParam === 'full' ? 'full' : 'minimal';

  try {
    const result = await buildLeaguePlayerStatsPayload(season, {
      mode,
      allowStale: true,
      skipStaleProbe: true,
      allowPartialWithoutAdvanced: true,
      statFetchDelayMs: mode === 'minimal' ? 400 : 1200,
      fetchAttempts: mode === 'minimal' ? 4 : 8,
    });
    if (result.stale && result.existing) {
      return NextResponse.json({ success: true, ...result.existing, fromBundledSnapshot: true });
    }
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
