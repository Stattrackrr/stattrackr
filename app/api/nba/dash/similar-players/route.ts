import { NextRequest, NextResponse } from 'next/server';
import { buildNbaSimilarPlayers } from '@/lib/nba/dash/leagueCards';
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
    const payload = await buildNbaSimilarPlayers({
      playerId,
      opponent,
      stat: String(sp.get('stat') || 'points'),
      years: [year, year - 1],
      limit: Number.isFinite(limitRaw) ? limitRaw : 8,
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to build similar players' }, { status: 500 });
  }
}
