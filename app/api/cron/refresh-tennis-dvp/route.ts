import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { buildTennisDvpLiveStore } from '@/lib/tennis/dvpLiveCache';
import { listLiveTennisEventIndex, warmTennisUpcomingFixtures } from '@/lib/tennis/nextGame';
import { getTennisPlayerPropsList } from '@/lib/tennis/playerPropsList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

/**
 * Rebuild live/upcoming DVP from Redis player logs (no 14MB overlay hydrate).
 * Rankings stay on the 8h ingest cron. Combined paint has its own ping.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    try {
      await warmTennisUpcomingFixtures({ force: false });
    } catch {
      /* keep whatever upcoming window is already in Redis */
    }
    const live = await listLiveTennisEventIndex();
    const store = await buildTennisDvpLiveStore(live);
    let propsCount = 0;
    try {
      const list = await getTennisPlayerPropsList({ refresh: true });
      propsCount = list.propsCount;
    } catch {
      propsCount = 0;
    }
    return NextResponse.json({
      success: true,
      builtAt: store.builtAt,
      events: store.events.length,
      fieldSizes: store.events.map((event) => ({
        tour: event.tour,
        stage: event.stage,
        tournament: event.tournamentName,
        fieldSize: event.fieldSize,
      })),
      propsCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
