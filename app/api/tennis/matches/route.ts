import { NextRequest, NextResponse } from 'next/server';
import { loadPlayerMatchesCached } from '@/lib/tennis/loadCached';
import { type TennisTour } from '@/lib/tennis/data';
import { getTennisNextGame } from '@/lib/tennis/nextGame';

export async function GET(request: NextRequest) {
  const playerId = request.nextUrl.searchParams.get('playerId');
  const playerName = request.nextUrl.searchParams.get('player') || request.nextUrl.searchParams.get('name');
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tourFromParam = tourParam === 'ATP' || tourParam === 'WTA' ? (tourParam as TennisTour) : null;
  let opponentId = String(request.nextUrl.searchParams.get('opponentId') || '').trim() || null;
  let opponentName = String(request.nextUrl.searchParams.get('opponent') || '').trim() || null;
  if (!opponentId && /^\d+$/.test(String(playerId || ''))) {
    const next = await getTennisNextGame({
      playerId,
      playerName,
      opponentName,
      tour: tourFromParam,
    });
    opponentId = String(next?.opponentId || '').trim() || null;
    opponentName = opponentName || String(next?.opponent || '').trim() || null;
  }
  const games = await loadPlayerMatchesCached({
    playerId,
    playerName,
    tour: tourFromParam,
    opponentId,
    opponentName,
  });
  return NextResponse.json({
    tour: tourFromParam || games[0]?.tour || null,
    year: games.at(-1)?.season ?? null,
    fetchedAt: null,
    games,
  });
}
