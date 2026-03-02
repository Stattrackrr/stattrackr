import { NextResponse } from 'next/server';
import { refreshAflOddsData } from '@/lib/refreshAflOdds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/odds/refresh
 * Fetches AFL odds from The Odds API and populates the in-memory cache.
 * Call periodically (e.g. cron or on-demand) to keep odds fresh.
 */
export async function GET() {
  try {
    const result = await refreshAflOddsData();
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, gamesCount: 0 },
        { status: result.error?.includes('ODDS_API_KEY') ? 503 : 502 }
      );
    }
    return NextResponse.json({
      success: true,
      gamesCount: result.gamesCount,
      lastUpdated: result.lastUpdated,
      nextUpdate: result.nextUpdate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
