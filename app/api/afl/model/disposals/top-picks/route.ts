import { NextRequest, NextResponse } from 'next/server';
import { getAflDisposalsTopPicksByGame, getAflDisposalsProjectionPayloadMeta } from '@/lib/aflDisposalsModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limitRaw = request.nextUrl.searchParams.get('limitPerGame')?.trim() ?? '3';
  const limit = Number.parseInt(limitRaw, 10);
  const groups = getAflDisposalsTopPicksByGame(Number.isFinite(limit) ? limit : 3);
  const meta = getAflDisposalsProjectionPayloadMeta();
  return NextResponse.json({
    success: true,
    groups,
    count: groups.length,
    modelVersion: meta.modelVersion,
    generatedAt: meta.generatedAt,
  });
}

