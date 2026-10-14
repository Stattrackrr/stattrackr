import { NextRequest, NextResponse } from 'next/server';
import { buildNbaPlayTypesPayload } from '@/lib/nba/dash/playTypes';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/play-types?stat=&playerId= — play-type tags + type × opponent matrix. */
export async function GET(request: NextRequest) {
  const stat = String(request.nextUrl.searchParams.get('stat') || 'points').trim();
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const year = Number(request.nextUrl.searchParams.get('year') || '');
  try {
    const payload = await buildNbaPlayTypesPayload({
      stat,
      playerId: playerId || null,
      year: Number.isFinite(year) && year > 0 ? year : undefined,
    });
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to build play types' }, { status: 500 });
  }
}
