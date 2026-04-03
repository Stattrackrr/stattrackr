import { NextRequest, NextResponse } from 'next/server';
import { getAflDisposalsHistoryForPlayer } from '@/lib/aflDisposalsHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const playerName = request.nextUrl.searchParams.get('playerName')?.trim() ?? '';
  const limitRaw = request.nextUrl.searchParams.get('limit')?.trim() ?? '20';
  const limit = Number.parseInt(limitRaw, 10);

  if (!playerName) {
    return NextResponse.json(
      { success: false, error: 'Missing required query param: playerName' },
      { status: 400 }
    );
  }

  const rows = getAflDisposalsHistoryForPlayer(playerName, Number.isFinite(limit) ? limit : 20);
  return NextResponse.json({
    success: true,
    playerName,
    count: rows.length,
    rows,
  });
}

