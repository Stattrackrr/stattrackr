import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nba/dash/line-movement — NBA prop line history is not recorded yet
 * (the NBA odds refresh has line movement switched off), so there is nothing to show.
 */
export async function GET(request: NextRequest) {
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  const team = String(request.nextUrl.searchParams.get('team') || '').trim();
  if (!player || !team) {
    return NextResponse.json({ error: 'player and team are required' }, { status: 400 });
  }
  return NextResponse.json({ movement: null });
}
