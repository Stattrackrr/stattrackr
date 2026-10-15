import { NextRequest, NextResponse } from 'next/server';
import { buildNbaPlayTypeMatchup } from '@/lib/nba/dash/playTypeMatchup';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/play-type-matchup?playerId=&opponent=&year= — Synergy play types vs opponent defence. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const playerId = String(sp.get('playerId') || '').trim();
  if (!playerId) return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  const yearRaw = Number(sp.get('year') || '');
  try {
    const payload = await buildNbaPlayTypeMatchup({
      playerId,
      opponent: String(sp.get('opponent') || '').trim() || null,
      year: Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : null,
    });
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build play type matchup', rows: [] },
      { status: 500 }
    );
  }
}
