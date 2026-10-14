import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { runAiPicks } from '@/lib/aiPicks/run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Redis and Supabase are in Sydney; a scan makes hundreds of round trips, so running in the default US region costs minutes.
export const preferredRegion = 'syd1';

/** Scan stored lines, update the AI watchlist, and post the plays that are ready and pass review. */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const summary = await runAiPicks();
  return NextResponse.json({ success: summary.errors.length === 0, summary });
}
