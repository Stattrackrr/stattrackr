import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { gradeAiPicks } from '@/lib/aiPicks/grade';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Grade started AI pick legs from stored results, settle finished picks, capture closing lines. */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const summary = await gradeAiPicks();
  return NextResponse.json({ success: summary.errors.length === 0, summary });
}
