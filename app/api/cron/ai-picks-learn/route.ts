import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { runAiLearning } from '@/lib/aiPicks/learn/run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Nightly: learn from graded plays and settled picks, storing a new params version when anything moves. */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const summary = await runAiLearning();
  return NextResponse.json({ success: summary.errors.length === 0, summary });
}
