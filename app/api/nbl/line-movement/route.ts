import { NextRequest, NextResponse } from 'next/server';
import { getNblLineMovement } from '@/lib/nbl/lineMovement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/nbl/line-movement — stored O/U moves only (Redis, written by the odds ingest).
 * player + team, optional opponent. Returns every O/U stat posted for the player.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const player = String(params.get('player') || '').trim();
  const team = String(params.get('team') || '').trim();
  const opponent = String(params.get('opponent') || '').trim() || null;
  if (!player || !team) {
    return NextResponse.json({ error: 'player and team are required' }, { status: 400 });
  }

  try {
    const movement = await getNblLineMovement({ player, team, opponent });
    return NextResponse.json(
      { movement },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load line movement';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
