import { NextRequest, NextResponse } from 'next/server';
import { buildNblSimilarPlayers } from '@/lib/nbl/similarPlayers';
import { NBL_SHOT_CHART_SEASON_YEAR } from '@/lib/nblTeamCanonical';

export async function GET(request: NextRequest) {
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const opponent = String(
    request.nextUrl.searchParams.get('opponent') ||
      request.nextUrl.searchParams.get('team') ||
      ''
  ).trim();
  const stat = String(request.nextUrl.searchParams.get('stat') || 'points').trim();
  const yearRaw = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_SHOT_CHART_SEASON_YEAR
  );
  const limitRaw = Number(request.nextUrl.searchParams.get('limit') || 8);

  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }
  if (!opponent) {
    return NextResponse.json({ error: 'opponent is required' }, { status: 400 });
  }

  try {
    const payload = buildNblSimilarPlayers({
      playerId,
      opponent,
      stat,
      year: Number.isFinite(yearRaw) ? yearRaw : NBL_SHOT_CHART_SEASON_YEAR,
      limit: Number.isFinite(limitRaw) ? limitRaw : 5,
    });
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build similar players';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
