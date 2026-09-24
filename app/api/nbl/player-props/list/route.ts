import { NextResponse } from 'next/server';
import { getNblPlayerPropsList } from '@/lib/nbl/playerPropsList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/nbl/player-props/list
 * Cache-only odds-api.net / snapshot board. Live pull is cron-only.
 */
export async function GET() {
  try {
    const payload = await getNblPlayerPropsList();
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, no-store' },
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
        noAflOdds: true,
        noNblOdds: true,
        ingestMessage: 'No odds available. Come back later.',
      },
      { status: 500 }
    );
  }
}
