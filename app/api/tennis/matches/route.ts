import { NextRequest, NextResponse } from 'next/server';
import { loadApiTennisCache } from '@/lib/tennis/apiTennis';
import {
  loadPlayerMatches,
  tourForPlayer,
  type TennisTour,
} from '@/lib/tennis/data';
import { hydrateTennisMatchOverlay } from '@/lib/tennis/ingest';

export async function GET(request: NextRequest) {
  await hydrateTennisMatchOverlay();
  const playerId = request.nextUrl.searchParams.get('playerId');
  const playerName = request.nextUrl.searchParams.get('player') || request.nextUrl.searchParams.get('name');
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tourFromParam = tourParam === 'ATP' || tourParam === 'WTA' ? (tourParam as TennisTour) : null;
  const tour = tourFromParam || tourForPlayer(playerId, playerName);
  const games = loadPlayerMatches({ playerId, playerName, tour });
  return NextResponse.json({
    tour: tour || games[0]?.tour || null,
    year: games.at(-1)?.season ?? null,
    fetchedAt: loadApiTennisCache()?.fetchedAt ?? null,
    games,
  });
}
