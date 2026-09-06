import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { buildTennisPlayerMatchup } from '@/lib/tennis/playerMatchup';
import type { TennisTour } from '@/lib/tennis/sackmann';

export async function GET(request: NextRequest) {
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
  const yearRaw = Number(request.nextUrl.searchParams.get('year'));
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : TENNIS_CURRENT_YEAR;
  const windowRaw = Number(request.nextUrl.searchParams.get('window'));
  const windowN = Number.isFinite(windowRaw) ? Math.max(0, windowRaw) : 0;
  const bestOfRaw = Number(request.nextUrl.searchParams.get('bestOf'));
  const bestOf = bestOfRaw >= 5 ? 5 : 3;
  const payload = buildTennisPlayerMatchup({
    playerName: player,
    opponentName: opponent,
    tour,
    window: windowN,
    year,
    bestOf,
  });
  return NextResponse.json({ success: true, ...payload });
}
