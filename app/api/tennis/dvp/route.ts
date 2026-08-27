import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { tennisDvpProfile, type TennisTour } from '@/lib/tennis/sackmann';

export async function GET(request: NextRequest) {
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour = tourParam === 'WTA' ? 'WTA' : 'ATP';
  const yearRaw = Number(request.nextUrl.searchParams.get('year'));
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : TENNIS_CURRENT_YEAR;
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  const profile = tennisDvpProfile({ tour, year, opponentName: opponent });
  return NextResponse.json({ success: true, ...profile });
}
