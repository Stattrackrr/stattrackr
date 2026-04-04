import { NextRequest, NextResponse } from 'next/server';
import { getAflDisposalsHistory, getAflDisposalsHistoryMeta } from '@/lib/aflDisposalsHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limitRaw = request.nextUrl.searchParams.get('limit')?.trim() ?? '500';
  const limit = Number.parseInt(limitRaw, 10);
  const safeLimit = Number.isFinite(limit) ? limit : 500;
  const rows = getAflDisposalsHistory(safeLimit);
  const meta = getAflDisposalsHistoryMeta();
  return NextResponse.json({
    success: true,
    count: rows.length,
    rows,
    generatedAt: meta.generatedAt,
    totalCount: meta.count,
  });
}

