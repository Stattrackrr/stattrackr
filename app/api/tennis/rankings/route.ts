import { NextRequest, NextResponse } from 'next/server';
import { loadTennisRankings, type TennisTour } from '@/lib/tennis/data';

export async function GET(request: NextRequest) {
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour = tourParam === 'WTA' ? 'WTA' : 'ATP';
  const limitRaw = Number(request.nextUrl.searchParams.get('limit'));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 50;
  const teams = loadTennisRankings(tour, { limit }).map((row) => ({
    pos: row.pos,
    team: row.name,
    teamCode: row.ioc,
    played: null,
    win: null,
    loss: null,
    points_for: row.points,
    points_against: null,
    points_percentage: null,
    tour: row.tour,
  }));
  return NextResponse.json({
    tour,
    seasonLabel: `${tour} Rankings`,
    teams,
  });
}
