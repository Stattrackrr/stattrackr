import { NextRequest, NextResponse } from 'next/server';
import { getTennisNextGame, warmTennisUpcomingFixtures } from '@/lib/tennis/nextGame';
import type { TennisTour } from '@/lib/tennis/types';

export const dynamic = 'force-dynamic';

function nextGameJson(
  playerId: string | null,
  next: Awaited<ReturnType<typeof getTennisNextGame>>,
  tour: TennisTour | null
) {
  return {
    playerId,
    next_opponent: next?.opponent ?? null,
    next_opponent_id: next?.opponentId ?? null,
    next_opponent_ioc: next?.opponentIoc ?? null,
    opponent_logo: next?.opponentLogo ?? null,
    next_game_tipoff: next?.tipoff ?? null,
    next_game_id: next?.matchId ?? null,
    live: Boolean(next?.live),
    isGrandSlam: Boolean(next?.isGrandSlam),
    tour: next?.tour ?? tour,
    tournament: next?.tournamentName ?? null,
    status: next?.status ?? null,
  };
}

export async function GET(request: NextRequest) {
  const warm = request.nextUrl.searchParams.get('warm') === '1';
  const playerId = request.nextUrl.searchParams.get('playerId');
  const playerName = request.nextUrl.searchParams.get('player') || request.nextUrl.searchParams.get('name');
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour = tourParam === 'ATP' || tourParam === 'WTA' ? (tourParam as TennisTour) : null;
  if (warm && !String(playerId || '').trim()) {
    await warmTennisUpcomingFixtures();
    return NextResponse.json({ success: true, warmed: true });
  }
  if (!String(playerId || '').trim() && !String(playerName || '').trim()) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }
  const next = await getTennisNextGame({ playerId, playerName, tour });
  return NextResponse.json(nextGameJson(playerId || null, next, tour));
}
