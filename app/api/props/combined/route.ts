import { NextRequest, NextResponse } from 'next/server';
import {
  attachCachedTennisSlice,
  combinedSnapshotAflAssemblyReady,
  filterCombinedSnapshotAflEligibility,
  getCombinedPropsPaintSnapshot,
  getCombinedPropsSnapshot,
  slimCombinedPropsSnapshotForClient,
} from '@/lib/combinedPropsSnapshotPaint';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const COMBINED_CACHE_CONTROL = 'private, no-store';
const COMBINED_CACHE_CONTROL_HIT = 'public, s-maxage=120, stale-while-revalidate=600';

function wantsRebuild(request: NextRequest, cronSecret?: string): boolean {
  return request.nextUrl.searchParams.get('refresh') === '1' || Boolean(cronSecret);
}

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const debugStats = request.nextUrl.searchParams.get('debugStats') === '1';
  const origin = request.nextUrl.origin;
  const cronSecret = request.headers.get('x-cron-secret') ?? undefined;
  const wantsFull =
    refresh ||
    debugStats ||
    request.nextUrl.searchParams.get('full') === '1' ||
    Boolean(cronSecret);

  try {
    if (!wantsRebuild(request, cronSecret) && !debugStats) {
      const paintSnapshot = !wantsFull ? await getCombinedPropsPaintSnapshot() : null;
      const cachedSnapshot =
        paintSnapshot && combinedSnapshotAflAssemblyReady(paintSnapshot)
          ? paintSnapshot
          : await getCombinedPropsSnapshot();
      if (cachedSnapshot && combinedSnapshotAflAssemblyReady(cachedSnapshot)) {
        const painted = wantsFull
          ? filterCombinedSnapshotAflEligibility(cachedSnapshot)
          : filterCombinedSnapshotAflEligibility(
              paintSnapshot && combinedSnapshotAflAssemblyReady(paintSnapshot)
                ? paintSnapshot
                : slimCombinedPropsSnapshotForClient(cachedSnapshot)
            );
        const withTennis = await attachCachedTennisSlice(painted);
        return NextResponse.json(
          {
            ...withTennis,
            cachedSnapshot: true,
            backgroundRefreshStarted: false,
            paintSnapshot: !wantsFull,
          },
          {
            status: withTennis?.success ? 200 : 502,
            headers: {
              'Cache-Control': COMBINED_CACHE_CONTROL_HIT,
            },
          }
        );
      }
    }

    if (!wantsRebuild(request, cronSecret) && !debugStats) {
      const empty = {
        success: true,
        snapshotVersion: 1 as const,
        generatedAt: new Date().toISOString(),
        staleAt: new Date().toISOString(),
        nba: { ok: false, status: 204, cached: true, lastUpdated: null, gameDate: null, props: [] },
        afl: {
          ok: false,
          status: 204,
          lastUpdated: null,
          nextUpdate: null,
          ingestMessage: null,
          noAflOdds: true,
          games: [],
          props: [],
        },
        tennis: {
          ok: false,
          status: 204,
          lastUpdated: null,
          nextUpdate: null,
          ingestMessage: 'No odds available. Come back later.',
          noTennisOdds: true,
          games: [],
          props: [],
        },
      };
      const withTennis = await attachCachedTennisSlice(empty);
      return NextResponse.json(
        {
          ...withTennis,
          cachedSnapshot: true,
          backgroundRefreshStarted: false,
          paintSnapshot: !wantsFull,
        },
        {
          status: 200,
          headers: { 'Cache-Control': COMBINED_CACHE_CONTROL_HIT },
        }
      );
    }

    const { buildCombinedPropsSnapshot, getCombinedPropsSnapshot: getFullSnapshot } =
      await import('@/lib/combinedPropsSnapshot');
    const snapshot = await buildCombinedPropsSnapshot({
      origin,
      refresh,
      debugStats,
      cronSecret,
      writeCache: !debugStats,
    });

    const readySnapshot = combinedSnapshotAflAssemblyReady(snapshot)
      ? snapshot
      : await getFullSnapshot();
    const outgoing =
      readySnapshot && combinedSnapshotAflAssemblyReady(readySnapshot) ? readySnapshot : snapshot;

    const clientSnapshot = wantsFull
      ? filterCombinedSnapshotAflEligibility(outgoing)
      : slimCombinedPropsSnapshotForClient(filterCombinedSnapshotAflEligibility(outgoing));

    return NextResponse.json(
      {
        ...clientSnapshot,
        cachedSnapshot: outgoing !== snapshot,
        backgroundRefreshStarted: false,
        paintSnapshot: !wantsFull,
      },
      {
        status: outgoing.success ? 200 : 502,
        headers: {
          'Cache-Control': COMBINED_CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load combined props payload',
      },
      {
        status: 500,
        headers: {
          'Cache-Control': COMBINED_CACHE_CONTROL,
        },
      }
    );
  }
}
