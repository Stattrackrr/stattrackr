import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { evaluateMarket } from '@/lib/tennisAi/backtest';
import { currentBacktestReport, publishBacktestReport } from '@/lib/tennisAi/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Re-check the tennis AI approval gate. With no stored closing-line sample the
 * market stays informational, which is the safe result.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const report = publishBacktestReport(currentBacktestReport().n ? currentBacktestReport() : evaluateMarket([]));
  return NextResponse.json({ success: true, report });
}
