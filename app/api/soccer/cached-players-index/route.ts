import { NextResponse } from 'next/server';
import { listSoccerCachedPlayersIndex } from '@/lib/soccerCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const players = await listSoccerCachedPlayersIndex({ quiet: true });
    return NextResponse.json({
      success: true,
      count: players.length,
      players,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load cached players index';
    return NextResponse.json({ success: false, error: message, players: [] }, { status: 500 });
  }
}
