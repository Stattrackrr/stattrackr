import { NextRequest, NextResponse } from 'next/server';
import {
  readTennisComputedCache,
  tennisComputedCacheKey,
  writeTennisComputedCache,
} from '@/lib/tennis/dashboardCache';
import { hydrateTennisOverlayLocal } from '@/lib/tennis/ingest';
import { buildTennisPlayerForm } from '@/lib/tennis/playerForm';
import type { TennisTour } from '@/lib/tennis/types';

export async function GET(request: NextRequest) {
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  if (!player) {
    return NextResponse.json({ success: false, error: 'player is required' }, { status: 400 });
  }
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour | null = tourParam === 'WTA' || tourParam === 'ATP' ? tourParam : null;
  const cacheKey = tennisComputedCacheKey('form', [player, opponent, tour]);
  const cached = await readTennisComputedCache<Record<string, unknown>>(cacheKey);
  if (cached?.success) return NextResponse.json(cached);

  await hydrateTennisOverlayLocal();
  const payload = buildTennisPlayerForm({
    playerName: player,
    opponentName: opponent || null,
    tour,
  });
  const body = { success: true, ...payload };
  void writeTennisComputedCache(cacheKey, body);
  return NextResponse.json(body);
}
