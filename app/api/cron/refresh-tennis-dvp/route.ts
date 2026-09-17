import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { clearCombinedPropsSnapshotCaches } from '@/lib/combinedPropsSnapshot';
import { buildTennisDvpLiveStore } from '@/lib/tennis/dvpLiveCache';
import { getHydratedTennisOverlay, hydrateTennisMatchOverlay, refreshTennisStandings } from '@/lib/tennis/ingest';
import { listLiveTennisEventIndex, warmTennisUpcomingFixtures } from '@/lib/tennis/nextGame';
import { getTennisPlayerPropsList, invalidateTennisPlayerPropsList } from '@/lib/tennis/playerPropsList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

/**
 * Refresh ATP/WTA rankings, rebuild per-tournament DVP for live/upcoming events,
 * then refresh the props-page list so ranks show as #12/32 (or up to 128 for slams).
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    await hydrateTennisMatchOverlay();
    let rankings = { atp: 0, wta: 0, fetchedAt: new Date().toISOString() };
    try {
      rankings = await refreshTennisStandings();
    } catch {
      /* keep last overlay standings */
    }
    try {
      await warmTennisUpcomingFixtures({ force: true });
    } catch {
      /* keep whatever upcoming window is already in memory */
    }
    const live = await listLiveTennisEventIndex();
    const store = await buildTennisDvpLiveStore(live);
    await invalidateTennisPlayerPropsList();
    let propsCount = 0;
    try {
      const list = await getTennisPlayerPropsList({ refresh: true });
      propsCount = list.propsCount;
    } catch {
      propsCount = 0;
    }
    let shards = { players: 0, logs: 0, skipped: true };
    try {
      const { publishTennisDashboardCache } = await import('@/lib/tennis/dashboardCache');
      shards = await publishTennisDashboardCache(getHydratedTennisOverlay(), { onlyPriority: true });
    } catch {
      /* props-player logs still republish on the 8h ingest cron */
    }
    await clearCombinedPropsSnapshotCaches().catch(() => undefined);
    return NextResponse.json({
      success: true,
      builtAt: store.builtAt,
      rankings,
      events: store.events.length,
      fieldSizes: store.events.map((event) => ({
        tour: event.tour,
        stage: event.stage,
        tournament: event.tournamentName,
        fieldSize: event.fieldSize,
      })),
      propsCount,
      shards,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
