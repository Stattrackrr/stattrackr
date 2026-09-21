import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshNblOddsData } from '@/lib/nbl/refreshNblOdds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/nbl/odds/refresh — pull basketball_nbl odds into cache. */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const result = await refreshNblOddsData();
  return NextResponse.json(
    {
      success: result.success,
      gamesCount: result.gamesCount,
      lastUpdated: result.lastUpdated,
      nextUpdate: result.nextUpdate,
      error: result.error,
    },
    { status: result.success ? 200 : 502 }
  );
}
