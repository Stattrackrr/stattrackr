import { NextRequest, NextResponse } from 'next/server';
import { hydrateTennisMatchOverlay } from '@/lib/tennis/ingest';
import { buildTennisPlayerForm } from '@/lib/tennis/playerForm';
import type { TennisTour } from '@/lib/tennis/types';

export async function GET(request: NextRequest) {
  await hydrateTennisMatchOverlay();
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  if (!player) {
    return NextResponse.json({ success: false, error: 'player is required' }, { status: 400 });
  }
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour | null = tourParam === 'WTA' || tourParam === 'ATP' ? tourParam : null;
  const payload = buildTennisPlayerForm({
    playerName: player,
    opponentName: opponent || null,
    tour,
  });
  return NextResponse.json({ success: true, ...payload });
}
