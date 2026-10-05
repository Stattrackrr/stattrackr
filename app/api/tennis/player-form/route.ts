import { NextRequest, NextResponse } from 'next/server';
import {
  readTennisComputedCache,
  tennisComputedCacheKey,
  writeTennisComputedCache,
} from '@/lib/tennis/dashboardCache';
import { loadPlayerMatchesCached } from '@/lib/tennis/loadCached';
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
  const cacheKey = tennisComputedCacheKey('form_v3', [player, opponent, tour]);
  const cached = await readTennisComputedCache<Record<string, unknown>>(cacheKey);
  if (cached?.success) return NextResponse.json(cached);

  const games = await loadPlayerMatchesCached({
    playerName: player,
    tour,
    opponentName: opponent || null,
  });
  if (!games.length) {
    return NextResponse.json({
      success: true,
      tour: tour || 'ATP',
      player: { id: null, name: player },
      splitWindow: 30,
      baseline: {
        matches: 0,
        wins: 0,
        losses: 0,
        winPct: null,
        aces: null,
        totalGames: null,
        holdPct: null,
        rpw: null,
        over215: null,
        over225: null,
      },
      rankBands: [],
      styleSplits: [],
      insights: [],
      opponent: null,
      recent: [],
    });
  }

  const payload = buildTennisPlayerForm({
    playerName: player,
    opponentName: opponent || null,
    tour,
    rows: games,
  });
  const body = { success: true, ...payload };
  void writeTennisComputedCache(cacheKey, body);
  return NextResponse.json(body);
}
