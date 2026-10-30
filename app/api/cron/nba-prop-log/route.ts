import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { gradeNbaPropSnapshots, logNbaPropSnapshots } from '@/lib/nba/propLog/run';
import { computeShadowClv } from '@/lib/nba/propLog/shadow';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Every 5 minutes: snapshot due NBA prop lines from the stored board (with the would-be bets of the
 * frozen shadow policies and their price checks), then grade finished games and score the closing
 * line value of would-be bets.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const summary = await logNbaPropSnapshots();
    summary.graded = await gradeNbaPropSnapshots();
    let shadowClv: number | string = 0;
    try {
      shadowClv = await computeShadowClv(Date.now());
    } catch (err) {
      shadowClv = `failed: ${err instanceof Error ? err.message : err}`;
    }
    return NextResponse.json({ success: true, ...summary, shadowClv });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
