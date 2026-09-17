import { NextRequest, NextResponse } from 'next/server';
import {
  combinedSnapshotAflAssemblyReady,
  filterCombinedSnapshotAflEligibility,
  getCombinedPropsPaintSnapshot,
  getCombinedPropsSnapshot,
  isCombinedPropsSnapshotStale,
  slimCombinedPropsSnapshotForClient,
} from '@/lib/combinedPropsSnapshotPaint';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const COMBINED_CACHE_CONTROL = 'private, no-store';
const COMBINED_CACHE_CONTROL_HIT = 'public, s-maxage=120, stale-while-revalidate=600';

function wantsFullCombinedSnapshot(request: NextRequest, cronSecret?: string): boolean {
  return (
    request.nextUrl.searchParams.get('refresh') === '1' ||
    request.nextUrl.searchParams.get('debugStats') === '1' ||
    request.nextUrl.searchParams.get('full') === '1' ||
    Boolean(cronSecret)
  );
}

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const debugStats = request.nextUrl.searchParams.get('debugStats') === '1';
  const origin = request.nextUrl.origin;
  const cronSecret = request.headers.get('x-cron-secret') ?? undefined;
  const wantsFull = wantsFullCombinedSnapshot(request, cronSecret);

  try {
    if (!refresh && !debugStats) {
      const paintSnapshot = !wantsFull ? await getCombinedPropsPaintSnapshot() : null;
      const cachedSnapshot =
        paintSnapshot && combinedSnapshotAflAssemblyReady(paintSnapshot)
          ? paintSnapshot
          : await getCombinedPropsSnapshot();
      if (cachedSnapshot && combinedSnapshotAflAssemblyReady(cachedSnapshot)) {
        const stale = isCombinedPropsSnapshotStale(cachedSnapshot);
        if (stale) {
          void import('@/lib/combinedPropsSnapshot')
            .then(({ warmCombinedPropsSnapshot }) => warmCombinedPropsSnapshot({ origin, cronSecret }))
            .catch((error) => {
              console.warn(
                '[Props Combined] Background snapshot refresh failed:',
                error instanceof Error ? error.message : error
              );
            });
        }

        const clientSnapshot = wantsFull
          ? filterCombinedSnapshotAflEligibility(cachedSnapshot)
          : filterCombinedSnapshotAflEligibility(paintSnapshot && combinedSnapshotAflAssemblyReady(paintSnapshot)
              ? paintSnapshot
              : slimCombinedPropsSnapshotForClient(cachedSnapshot));
        return NextResponse.json(
          {
            ...clientSnapshot,
            cachedSnapshot: true,
            backgroundRefreshStarted: stale,
            paintSnapshot: !wantsFull,
          },
          {
            status: clientSnapshot?.success ? 200 : 502,
            headers: {
              'Cache-Control': COMBINED_CACHE_CONTROL_HIT,
            },
          }
        );
      }
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
