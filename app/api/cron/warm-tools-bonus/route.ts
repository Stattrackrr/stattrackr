/**
 * Sole odds-api.net writer for Bonus Flipper (~100-120 credits / run, every 15m).
 * Find flips is cache-only — it never calls odds-api; it only reads this board.
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
    if (live.snapshots.length && !live.persisted) {
      console.error('[cron/warm-tools-bonus] board not persisted to Redis', {
        redisBytes: live.redisBytes,
        events: live.eventsSnapshotted,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'bonus board too large for Redis',
          requests: live.requests,
          eventsSnapshotted: live.eventsSnapshotted,
          redisBytes: live.redisBytes,
          persisted: false,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      requests: live.requests,
      eventsSnapshotted: live.eventsSnapshotted,
      eventsListed: live.eventsListed,
      leaguesTried: live.leaguesTried,
      sports: live.sports,
      redisBytes: live.redisBytes,
      persisted: live.persisted,
    });
  } catch (err) {
    console.error('[cron/warm-tools-bonus]', err);
    return NextResponse.json({ success: false, error: 'warm-tools-bonus failed' }, { status: 500 });
  }
}
