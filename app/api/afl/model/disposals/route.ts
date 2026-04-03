import { NextRequest, NextResponse } from 'next/server';
import { getAflDisposalsProjection, getAflDisposalsProjectionPayloadMeta } from '@/lib/aflDisposalsModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const playerName = request.nextUrl.searchParams.get('playerName')?.trim() ?? '';
  const homeTeam = request.nextUrl.searchParams.get('homeTeam')?.trim() ?? '';
  const awayTeam = request.nextUrl.searchParams.get('awayTeam')?.trim() ?? '';
  const lineRaw = request.nextUrl.searchParams.get('line')?.trim() ?? '';
  const line = Number.parseFloat(lineRaw);

  if (!playerName || !homeTeam || !awayTeam || !Number.isFinite(line)) {
    return NextResponse.json(
      { success: false, error: 'Missing required query params: playerName, homeTeam, awayTeam, line' },
      { status: 400 }
    );
  }

  const projection = getAflDisposalsProjection({ playerName, homeTeam, awayTeam, line });
  const meta = getAflDisposalsProjectionPayloadMeta();
  if (!projection) {
    return NextResponse.json({
      success: true,
      projection: null,
      modelVersion: meta.modelVersion,
      generatedAt: meta.generatedAt,
    });
  }

  return NextResponse.json({
    success: true,
    projection,
    modelVersion: meta.modelVersion,
    generatedAt: meta.generatedAt,
  });
}
