import { NextRequest, NextResponse } from 'next/server';
import { findNbaOddsGame, getNbaOddsCache, nbaPlayerPropsByStat } from '@/lib/nba/dash/odds';
import { nbaPlayerPropMarketForStat } from '@/lib/nba/dash/oddsTypes';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/player-props?player=&stat=points&team=&opponent= — stored prop lines by stat. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const player = sp.get('player')?.trim();
  const stat = sp.get('stat')?.trim() || 'points';
  const team = sp.get('team')?.trim();
  const opponent = sp.get('opponent')?.trim() || null;
  if (!player) {
    return NextResponse.json({ success: false, error: 'Player name required', data: [] }, { status: 400 });
  }
  try {
    const cache = await getNbaOddsCache();
    const game = team ? findNbaOddsGame(cache?.games ?? [], team, opponent) : null;
    const byStat = game ? nbaPlayerPropsByStat(game, player) : {};
    return NextResponse.json({
      success: true,
      data: byStat[stat] ?? [],
      byStat,
      homeTeam: game?.homeTeam ?? '',
      awayTeam: game?.awayTeam ?? '',
      gameId: game?.gameId ?? null,
      market: nbaPlayerPropMarketForStat(stat),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err), data: [] },
      { status: 500 }
    );
  }
}
