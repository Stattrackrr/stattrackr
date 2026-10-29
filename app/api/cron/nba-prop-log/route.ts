import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { gradeNbaPropSnapshots, logNbaPropSnapshots } from '@/lib/nba/propLog/run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/** Every 5 minutes: snapshot due NBA prop lines from the stored board, then grade finished games. */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const summary = await logNbaPropSnapshots();
    summary.graded = await gradeNbaPropSnapshots();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
