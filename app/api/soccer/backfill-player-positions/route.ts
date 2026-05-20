import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { backfillSoccerPlayerPositionsInCache } from '@/lib/soccerCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const limit = limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10) || 0) : undefined;

  try {
    const result = await backfillSoccerPlayerPositionsInCache({ dryRun, limit, quiet: false });
    return NextResponse.json({ success: true, dryRun, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backfill failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
