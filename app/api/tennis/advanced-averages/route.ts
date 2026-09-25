import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import {
  averagesPayloadHasRows,
  buildTennisAdvancedAveragesCached,
} from '@/lib/tennis/advancedAverages';
import {
  readTennisComputedCache,
  tennisComputedCacheKey,
  writeTennisComputedCache,
} from '@/lib/tennis/dashboardCache';
import type { TennisTour } from '@/lib/tennis/types';

function averagesBoardsKey(opts: {
  player: string;
  opponent: string;
  playerId: string;
  opponentId: string;
  tour: TennisTour | null;
}): string {
  return tennisComputedCacheKey('averages_boards_v2', [
    opts.playerId || opts.player,
    opts.opponentId || opts.opponent,
    opts.tour,
  ]);
}

export async function GET(request: NextRequest) {
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  if (!player) {
    return NextResponse.json({ success: false, error: 'player is required' }, { status: 400 });
  }
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const opponentId = String(request.nextUrl.searchParams.get('opponentId') || '').trim();
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour | null = tourParam === 'WTA' || tourParam === 'ATP' ? tourParam : null;
  const yearRaw = Number(request.nextUrl.searchParams.get('year'));
  const year = Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : TENNIS_CURRENT_YEAR;
  const windowRaw = Number(request.nextUrl.searchParams.get('window'));
  const bestOf = String(request.nextUrl.searchParams.get('bestOf') || '').trim();
  const vsRank = String(request.nextUrl.searchParams.get('vsRank') || '').trim();
  const cacheKey = averagesBoardsKey({ player, opponent, playerId, opponentId, tour });
  const cached = await readTennisComputedCache<Record<string, unknown>>(cacheKey);
  if (cached?.success && (cached.boards || averagesPayloadHasRows(cached))) {
    return NextResponse.json(cached);
  }

  const payload = await buildTennisAdvancedAveragesCached({
    playerName: player,
    opponentName: opponent || null,
    playerId: playerId || null,
    opponentId: opponentId || null,
    tour,
    window: Number.isFinite(windowRaw) ? windowRaw : 0,
    year,
    bestOf,
    vsRank,
    includeBoards: true,
  });
  const body = { success: true, ...payload };
  if (payload.boards || averagesPayloadHasRows(payload)) {
    void writeTennisComputedCache(cacheKey, body);
  }
  return NextResponse.json(body);
}
