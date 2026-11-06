/**
 * Warm Bonus Flipper live odds board every ~15m (~100–120 odds-api credits / run).
 * Find flips then reads Redis instead of waiting on a cold sweep.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { warmBonusLiveBoard } from '@/lib/tools/bonusWarm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;

  try {
    const live = await warmBonusLiveBoard();
    return NextResponse.json({
      success: true,
      requests: live.requests,
      eventsSnapshotted: live.eventsSnapshotted,
      eventsListed: live.eventsListed,
      leaguesTried: live.leaguesTried,
      sports: live.sports,
    });
  } catch (err) {
    console.error('[cron/warm-tools-bonus]', err);
    return NextResponse.json({ success: false, error: 'warm-tools-bonus failed' }, { status: 500 });
  }
}
