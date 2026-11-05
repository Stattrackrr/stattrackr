import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { buildTennisWeeklyReport, saveTennisWeeklyReport } from '@/lib/tennis/log/report';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Weekly: tennis coverage, candidate universe, would-be bets, completion, pilot MDE, Pinnacle derivation. */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const report = await buildTennisWeeklyReport();
    await saveTennisWeeklyReport(report);
    return NextResponse.json({ success: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
