import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { runTennisLog } from '@/lib/tennis/log/poll';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Every 3 minutes: tennis prices for matches in the decision window, arms, would-be bets, results. */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const summary = await runTennisLog();
  return NextResponse.json({ success: summary.errors.length === 0, ...summary });
}
