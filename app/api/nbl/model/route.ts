import { NextRequest, NextResponse } from 'next/server';
import { findNblEnginePanel } from '@/lib/nbl/enginePicks';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nbl/model?playerId=&player=&opponent=&stat=
 * Returns the NBL props engine analysis for one player/stat (see lib/nbl/engineShared.ts).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const playerId = String(sp.get('playerId') || '').trim();
  const playerName = String(sp.get('player') || sp.get('playerName') || '').trim();
  const opponent = String(sp.get('opponent') || sp.get('team') || '').trim();
  const stat = String(sp.get('stat') || 'points').trim();

  if (!playerId && !playerName) {
    return NextResponse.json({ error: 'playerId or player is required' }, { status: 400 });
  }

  try {
    const payload = findNblEnginePanel({
      playerId: playerId || null,
      playerName: playerName || null,
      opponent: opponent && opponent !== 'All' ? opponent : null,
      stat,
    });
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load engine analysis';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
