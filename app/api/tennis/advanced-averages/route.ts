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

function isDefaultAveragesQuery(opts: {
  year: number;
  windowRaw: number;
  bestOf: string;
  vsRank: string;
}): boolean {
  return (
    opts.year === TENNIS_CURRENT_YEAR &&
    (!Number.isFinite(opts.windowRaw) || opts.windowRaw === 0) &&
    (!opts.bestOf || opts.bestOf === 'all') &&
    (!opts.vsRank || opts.vsRank === 'all')
  );
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
  const useShortKey = isDefaultAveragesQuery({ year, windowRaw, bestOf, vsRank });
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
    (useShortKey ? await readTennisComputedCache<Record<string, unknown>>(shortKey) : null);
  if (cached?.success && averagesPayloadHasRows(cached)) {
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
  });
  const body = { success: true, ...payload };
  if (averagesPayloadHasRows(payload)) {
    void writeTennisComputedCache(cacheKey, body);
    if (useShortKey) void writeTennisComputedCache(shortKey, body);
  }
  return NextResponse.json(body);
}
