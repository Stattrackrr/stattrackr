import { NextRequest, NextResponse } from 'next/server';
import { hydrateTennisMatchOverlay } from '@/lib/tennis/ingest';
import { buildTennisSimilarPlayers } from '@/lib/tennis/similarPlayers';
import type { TennisTour } from '@/lib/tennis/types';

export async function GET(request: NextRequest) {
  await hydrateTennisMatchOverlay();
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  if (!player || !opponent) {
    return NextResponse.json(
      { success: false, error: 'player and opponent are required' },
      { status: 400 }
    );
  }
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour | null = tourParam === 'WTA' || tourParam === 'ATP' ? tourParam : null;
  const limitRaw = Number(request.nextUrl.searchParams.get('limit') || 8);
  const payload = buildTennisSimilarPlayers({
    playerName: player,
    opponentName: opponent,
    playerId: request.nextUrl.searchParams.get('playerId'),
    tour,
    stat: request.nextUrl.searchParams.get('stat') || 'moneyline',
    limit: Number.isFinite(limitRaw) ? limitRaw : 8,
  });
  return NextResponse.json({ success: true, ...payload });
}
