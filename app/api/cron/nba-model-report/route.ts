import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { buildWeeklyReport, saveWeeklyReport } from '@/lib/nba/model/reportData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Weekly: CLV of the frozen shadow policy, calibration, lift, sample size and the stop/reopen rules. */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const report = await buildWeeklyReport();
    await saveWeeklyReport(report);
    return NextResponse.json({ success: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
