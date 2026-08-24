import { NextRequest, NextResponse } from 'next/server';
import { loadTennisRankings, type TennisTour } from '@/lib/tennis/sackmann';

export async function GET(request: NextRequest) {
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour = tourParam === 'WTA' ? 'WTA' : 'ATP';
  const teams = loadTennisRankings(tour).map((row) => ({
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
