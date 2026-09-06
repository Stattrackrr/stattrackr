import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { buildTennisAdvancedAverages } from '@/lib/tennis/advancedAverages';
import type { TennisTour } from '@/lib/tennis/sackmann';

export async function GET(request: NextRequest) {
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  if (!player) {
    return NextResponse.json({ success: false, error: 'player is required' }, { status: 400 });
  }
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour | null = tourParam === 'WTA' || tourParam === 'ATP' ? tourParam : null;
  const yearRaw = Number(request.nextUrl.searchParams.get('year'));
  const year = Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : TENNIS_CURRENT_YEAR;
  const windowRaw = Number(request.nextUrl.searchParams.get('window'));
  const payload = buildTennisAdvancedAverages({
    playerName: player,
    opponentName: opponent || null,
    tour,
    window: Number.isFinite(windowRaw) ? windowRaw : 15,
    year,
    bestOf: request.nextUrl.searchParams.get('bestOf'),
    vsRank: request.nextUrl.searchParams.get('vsRank'),
  });
  return NextResponse.json({ success: true, ...payload });
}
