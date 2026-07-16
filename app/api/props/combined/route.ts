import { NextRequest, NextResponse } from 'next/server';
import {
  buildCombinedPropsSnapshot,
  filterCombinedSnapshotAflEligibility,
  getCombinedPropsPaintSnapshot,
  getCombinedPropsSnapshot,
  isCombinedPropsSnapshotStale,
  slimCombinedPropsSnapshotForClient,
  warmCombinedPropsSnapshot,
} from '@/lib/combinedPropsSnapshot';
import { aflEnrichedPayloadHasUsableStats } from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

/** Reject cached combined paint when AFL L5/Season coverage is too low (would show mass N/A). */
function combinedSnapshotAflStatsReady(
  snapshot: NonNullable<Awaited<ReturnType<typeof getCombinedPropsSnapshot>>>
): boolean {
  const props = snapshot.afl?.props ?? [];
  if (props.length === 0) return true;
  return aflEnrichedPayloadHasUsableStats({ data: props });
}

async function resolveClientCombinedSnapshot(
  fullSnapshot: Awaited<ReturnType<typeof getCombinedPropsSnapshot>>,
  wantsFull: boolean
) {
  if (!fullSnapshot) return null;
  if (wantsFull) return fullSnapshot;
  const paintSnapshot = await getCombinedPropsPaintSnapshot();
  if (paintSnapshot && combinedSnapshotAflStatsReady(paintSnapshot)) {
    return paintSnapshot;
  }
  return slimCombinedPropsSnapshotForClient(fullSnapshot);
}

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const debugStats = request.nextUrl.searchParams.get('debugStats') === '1';
  const origin = request.nextUrl.origin;
  const cronSecret = request.headers.get('x-cron-secret') ?? undefined;
  const wantsFull = wantsFullCombinedSnapshot(request, cronSecret);

  try {
    if (!refresh && !debugStats) {
      const cachedSnapshot = await getCombinedPropsSnapshot();
      if (cachedSnapshot && combinedSnapshotAflStatsReady(cachedSnapshot)) {
        const stale = isCombinedPropsSnapshotStale(cachedSnapshot);
        if (stale) {
          void warmCombinedPropsSnapshot({ origin, cronSecret }).catch((error) => {
            console.warn(
              '[Props Combined] Background snapshot refresh failed:',
              error instanceof Error ? error.message : error
            );
          });
        }

        const clientSnapshot = await resolveClientCombinedSnapshot(
          filterCombinedSnapshotAflEligibility(cachedSnapshot),
          wantsFull
        );
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
      if (cachedSnapshot && !combinedSnapshotAflStatsReady(cachedSnapshot)) {
        void warmCombinedPropsSnapshot({ origin, cronSecret }).catch((error) => {
          console.warn(
            '[Props Combined] Background rebuild after low AFL stats coverage failed:',
            error instanceof Error ? error.message : error
          );
        });
      }
    }

    const snapshot = await buildCombinedPropsSnapshot({
      origin,
      refresh,
      debugStats,
      cronSecret,
      writeCache: !debugStats,
    });

    const clientSnapshot = wantsFull
      ? filterCombinedSnapshotAflEligibility(snapshot)
      : slimCombinedPropsSnapshotForClient(filterCombinedSnapshotAflEligibility(snapshot));

    return NextResponse.json(
      {
        ...clientSnapshot,
        cachedSnapshot: false,
        backgroundRefreshStarted: false,
        paintSnapshot: !wantsFull,
      },
      {
        status: snapshot.success ? 200 : 502,
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
