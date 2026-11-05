import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { backfillEspnOfficials, syncAssignments } from '@/lib/nba/refs/sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Hourly: tonight's referee crews (posted ~9am ET), and crews of finished games from ESPN. */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const out: Record<string, unknown> = {};
  try {
    out.assignments = await syncAssignments();
  } catch (err) {
    out.assignmentsError = err instanceof Error ? err.message : String(err);
  }
  try {
    out.backfill = await backfillEspnOfficials();
  } catch (err) {
    out.backfillError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json({ success: !out.assignmentsError && !out.backfillError, ...out });
}
