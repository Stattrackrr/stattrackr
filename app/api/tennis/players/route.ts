import { NextRequest, NextResponse } from 'next/server';
import { loadTennisPlayers, type TennisTour } from '@/lib/tennis/sackmann';

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour = tourParam === 'ATP' || tourParam === 'WTA' ? (tourParam as TennisTour) : null;
  const currentOnly = request.nextUrl.searchParams.get('currentOnly') !== '0';
  let players = loadTennisPlayers({ currentOnly });
  if (tour) players = players.filter((p) => p.tour === tour);
  if (q) {
    players = players.filter(
      (p) => p.name.toLowerCase().includes(q) || p.ioc?.toLowerCase() === q
    );
  }
  const limit = q ? 80 : players.length;
  return NextResponse.json({
    currentOnly,
    players: players.slice(0, limit).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      tour: p.tour,
      team: p.tour,
      teamCode: p.tour,
      ioc: p.ioc,
      hand: p.hand,
      rank: p.rank,
      position: null,
      jersey: p.rank != null ? String(p.rank) : null,
      gender: p.tour === 'WTA' ? 'W' : 'M',
      imageUrl: null,
    })),
  });
}
