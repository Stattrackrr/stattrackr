import { NextResponse } from 'next/server';
import { getNbaPlayerPropsList, NBA_USER_NO_ODDS } from '@/lib/nba/dash/playerPropsList';
import { NBA_PUBLIC_ENABLED } from '@/lib/nbaConstants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMPTY = {
  success: true,
  data: [],
  games: [],
  propsCount: 0,
  gamesCount: 0,
  noAflOdds: true,
  noNbaOdds: true,
  ingestMessage: NBA_USER_NO_ODDS,
};

/**
 * GET /api/nba/player-props/list
 * Cache-only list built by the NBA odds cron (BallDontLie + odds-api.net board).
 */
export async function GET() {
  if (!NBA_PUBLIC_ENABLED) {
    return NextResponse.json(EMPTY, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  try {
    const payload = await getNbaPlayerPropsList();
    return NextResponse.json(
      { ...payload, noAflOdds: true },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ...EMPTY, success: false, error: message }, { status: 500 });
  }
}
