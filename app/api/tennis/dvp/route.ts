import { NextRequest, NextResponse } from 'next/server';
import { opponentDefenseRanks, type TennisMatchRow, type TennisTour } from '@/lib/tennis/sackmann';

const STAT_MAP: Record<string, keyof TennisMatchRow> = {
  aces: 'aces',
  doubleFaults: 'doubleFaults',
  pointsWon: 'pointsWon',
  gamesWon: 'gamesWon',
  returnPointsWon: 'returnPointsWon',
  firstServePct: 'firstServePct',
  firstServeWonPct: 'firstServeWonPct',
  secondServeWonPct: 'secondServeWonPct',
  servicePointsWonPct: 'servicePointsWonPct',
  returnPointsWonPct: 'returnPointsWonPct',
  breakPointsConverted: 'breakPointsConverted',
  breakPointsSaved: 'breakPointsSaved',
  serveGames: 'serveGames',
  servePoints: 'servePoints',
  totalGames: 'totalGames',
};

export async function GET(request: NextRequest) {
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour = tourParam === 'WTA' ? 'WTA' : 'ATP';
  const statKey = request.nextUrl.searchParams.get('stat') || 'aces';
  const stat = STAT_MAP[statKey] || 'aces';
  const rows = opponentDefenseRanks(tour, stat);
  return NextResponse.json({
    tour,
    stat,
    rows: rows.slice(0, 40).map((row, idx) => ({
      rank: idx + 1,
      opponent: row.opponent,
      value: Math.round(row.value * 10) / 10,
      matches: row.matches,
    })),
  });
}
