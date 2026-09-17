import { NextRequest, NextResponse } from 'next/server';
import {
  readTennisComputedCache,
  tennisComputedCacheKey,
  tennisSimilarComputedKey,
  writeTennisComputedCache,
} from '@/lib/tennis/dashboardCache';
import { buildTennisSimilarPlayersAsync } from '@/lib/tennis/similarPlayers';
import type { TennisTour } from '@/lib/tennis/types';

type SimilarCacheBody = Record<string, unknown> & { success?: boolean; similar?: unknown[] };

function cacheHasSimilar(cached: SimilarCacheBody | null): cached is SimilarCacheBody {
  return Boolean(cached?.success && Array.isArray(cached.similar) && cached.similar.length);
}

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
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const opponentId = String(request.nextUrl.searchParams.get('opponentId') || '').trim();
  const stableKey = tennisSimilarComputedKey({
    playerId,
    playerName: player,
    opponentId,
    opponentName: opponent,
    tour,
  });
  const legacyKey = tennisComputedCacheKey('similar', [playerId || player, opponent, stat, tour]);
  for (const key of [stableKey, legacyKey]) {
    const cached = await readTennisComputedCache<SimilarCacheBody>(key);
    if (cacheHasSimilar(cached)) return NextResponse.json(cached);
  }

  const payload = await buildTennisSimilarPlayersAsync({
    playerName: player,
    opponentName: opponent,
    playerId,
    opponentId,
    tour,
    stat,
    limit: Number.isFinite(limitRaw) ? limitRaw : 8,
  });
  const body = { success: true, ...payload };
  if (payload.similar.length) void writeTennisComputedCache(stableKey, body);
  return NextResponse.json(body);
}
