import { NextRequest, NextResponse } from 'next/server';
import { buildNbaSimilarPlayers } from '@/lib/nba/dash/leagueCards';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { resolveNbaDataSeason } from '@/lib/nba/dash/season';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/similar-players?playerId=&opponent=&stat= — production peers' latest games vs the opponent. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const playerId = String(sp.get('playerId') || '').trim();
  const opponent = String(sp.get('opponent') || sp.get('team') || '').trim();
  if (!playerId) return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  if (!opponent) return NextResponse.json({ error: 'opponent is required' }, { status: 400 });
  const yearRaw = Number(sp.get('year') || sp.get('season') || '');
  const limitRaw = Number(sp.get('limit') || 8);
  try {
    const year = await resolveNbaDataSeason(Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : null);
    const stat = String(sp.get('stat') || 'points');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 8;
    const payload = await nbaDashCached(
      'similar-players',
      [playerId, opponent.toLowerCase(), stat.toLowerCase(), year, limit],
      NBA_DASH_CACHE.league,
      () => buildNbaSimilarPlayers({ playerId, opponent, stat, years: [year, year - 1], limit })
    );
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to build similar players' }, { status: 500 });
  }
}
