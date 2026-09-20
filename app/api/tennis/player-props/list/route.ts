import { NextRequest, NextResponse } from 'next/server';
import { getTennisPlayerPropsList } from '@/lib/tennis/playerPropsList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

/**
 * Tennis props-page list. Reads stored Odds API + API-Tennis snapshots; does not
 * hit The Odds API on page load.
 */
export async function GET(request: NextRequest) {
  try {
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';
    const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
    const tour = tourParam === 'WTA' || tourParam === 'ATP' ? tourParam : null;
    const payload = await getTennisPlayerPropsList({
      refresh,
      tour,
    });
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: message,
        data: [],
        games: [],
        propsCount: 0,
        gamesCount: 0,
        noTennisOdds: true,
        noAflOdds: true,
        ingestMessage: 'No odds available. Come back later.',
      },
      { status: 500 }
    );
  }
}
