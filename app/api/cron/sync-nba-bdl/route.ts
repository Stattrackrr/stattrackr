import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { markNbaDashDataChanged } from '@/lib/nba/dash/responseCache';
import { refreshNbaSeasonSnapshots } from '@/lib/nba/dash/season';
import { runNbaBdlSync } from '@/lib/nba/sync/bdlSync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Play-by-play games per run; a normal night is ~15, so this only bites on a backlog. */
const MAX_PLAY_GAMES = 60;

/**
 * Incremental BallDontLie -> Supabase NBA sync (last 3 days). BDL posts tracking stats (potential
 * rebounds etc.) and season averages hours after box scores, so this polls often. When the data
 * changed, every NBA dashboard cache built before now is treated as stale and the current season
 * snapshot is rebuilt, so the warm cron and the next reads pick the new numbers up.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const summary = await runNbaBdlSync({ maxGames: MAX_PLAY_GAMES });
    let seasonSnapshots: Awaited<ReturnType<typeof refreshNbaSeasonSnapshots>> | string = [];
    if (summary.changed) {
      await markNbaDashDataChanged(Date.parse(summary.finishedAt));
      seasonSnapshots = await refreshNbaSeasonSnapshots(summary.seasons).catch((err) =>
        err instanceof Error ? err.message : String(err)
      );
    }
    return NextResponse.json(
      { success: summary.failures.length === 0, ...summary, seasonSnapshots },
      { status: summary.failures.length ? 502 : 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
