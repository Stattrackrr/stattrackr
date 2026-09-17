import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { buildTennisAdvancedAverages } from '@/lib/tennis/advancedAverages';
import {
  readTennisComputedCache,
  tennisComputedCacheKey,
  writeTennisComputedCache,
} from '@/lib/tennis/dashboardCache';
import { hydrateTennisOverlayLocal } from '@/lib/tennis/ingest';
import type { TennisTour } from '@/lib/tennis/types';

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
  const bestOf = request.nextUrl.searchParams.get('bestOf');
  const vsRank = request.nextUrl.searchParams.get('vsRank');
  const shortKey = tennisComputedCacheKey('averages', [player, opponent, tour]);
  const cacheKey = tennisComputedCacheKey('averages', [
    player,
    opponent,
    tour,
    String(year),
    String(Number.isFinite(windowRaw) ? windowRaw : 0),
    bestOf,
    vsRank,
  ]);
  const cached =
    (await readTennisComputedCache<Record<string, unknown>>(cacheKey)) ||
    (await readTennisComputedCache<Record<string, unknown>>(shortKey));
  if (cached?.success) return NextResponse.json(cached);

  await hydrateTennisOverlayLocal();
  const payload = buildTennisAdvancedAverages({
    playerName: player,
    opponentName: opponent || null,
    tour,
    window: Number.isFinite(windowRaw) ? windowRaw : 0,
    year,
    bestOf,
    vsRank,
  });
  const body = { success: true, ...payload };
  void writeTennisComputedCache(cacheKey, body);
  void writeTennisComputedCache(shortKey, body);
  return NextResponse.json(body);
}
