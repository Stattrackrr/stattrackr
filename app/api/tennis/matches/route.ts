import { NextRequest, NextResponse } from 'next/server';
import { loadPlayerMatchesCached } from '@/lib/tennis/loadCached';
import { type TennisTour } from '@/lib/tennis/data';

export async function GET(request: NextRequest) {
  const playerId = request.nextUrl.searchParams.get('playerId');
  const playerName = request.nextUrl.searchParams.get('player') || request.nextUrl.searchParams.get('name');
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tourFromParam = tourParam === 'ATP' || tourParam === 'WTA' ? (tourParam as TennisTour) : null;
  const games = await loadPlayerMatchesCached({ playerId, playerName, tour: tourFromParam });
  return NextResponse.json({
    tour: tourFromParam || games[0]?.tour || null,
    year: games.at(-1)?.season ?? null,
    fetchedAt: null,
    games,
  });
}
