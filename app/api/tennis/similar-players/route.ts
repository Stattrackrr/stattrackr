import { NextRequest, NextResponse } from 'next/server';
import {
  readTennisComputedCache,
  tennisComputedCacheKey,
  writeTennisComputedCache,
} from '@/lib/tennis/dashboardCache';
import { hydrateTennisOverlayLocal } from '@/lib/tennis/ingest';
import { buildTennisSimilarPlayers } from '@/lib/tennis/similarPlayers';
import type { TennisTour } from '@/lib/tennis/types';

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
  const limitRaw = Number(request.nextUrl.searchParams.get('limit') || 8);
  const stat = request.nextUrl.searchParams.get('stat') || 'moneyline';
  const playerId = request.nextUrl.searchParams.get('playerId');
  const cacheKey = tennisComputedCacheKey('similar', [playerId || player, opponent, stat, tour]);
  const cached = await readTennisComputedCache<Record<string, unknown>>(cacheKey);
  if (cached?.success) return NextResponse.json(cached);

  await hydrateTennisOverlayLocal();
  const payload = buildTennisSimilarPlayers({
    playerName: player,
    opponentName: opponent,
    playerId,
    tour,
    stat,
    limit: Number.isFinite(limitRaw) ? limitRaw : 8,
  });
  const body = { success: true, ...payload };
  if (payload.similar.length) void writeTennisComputedCache(cacheKey, body);
  return NextResponse.json(body);
}
