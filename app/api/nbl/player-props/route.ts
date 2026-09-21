import { NextRequest, NextResponse } from 'next/server';
import { resolveNblPlayerPropBooks } from '@/lib/nbl/playerProps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/nbl/player-props?player=...&stat=points&team=...&opponent=...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const player = searchParams.get('player')?.trim();
    const stat = searchParams.get('stat')?.trim() || 'points';
    const team = searchParams.get('team')?.trim();
    const opponent = searchParams.get('opponent')?.trim();
    if (!player) {
      return NextResponse.json({ success: false, error: 'Player name required', data: [] }, { status: 400 });
    }

    const result = await resolveNblPlayerPropBooks({ player, stat, team, opponent });
    return NextResponse.json({
      success: true,
      data: result.books,
      byStat: result.byStat,
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      gameId: result.gameId,
      market: result.market,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [] }, { status: 500 });
  }
}
