import { NextRequest, NextResponse } from 'next/server';
import {
  buildCombinedPropsSnapshot,
  getCombinedPropsPaintSnapshot,
  getCombinedPropsSnapshot,
  isCombinedPropsSnapshotStale,
  slimCombinedPropsSnapshotForClient,
  warmCombinedPropsSnapshot,
} from '@/lib/combinedPropsSnapshot';

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

async function resolveClientCombinedSnapshot(
  fullSnapshot: Awaited<ReturnType<typeof getCombinedPropsSnapshot>>,
  wantsFull: boolean
) {
  if (!fullSnapshot) return null;
  if (wantsFull) return fullSnapshot;
  const paintSnapshot = await getCombinedPropsPaintSnapshot();
  return paintSnapshot ?? slimCombinedPropsSnapshotForClient(fullSnapshot);
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
      if (cachedSnapshot) {
        const stale = isCombinedPropsSnapshotStale(cachedSnapshot);
        if (stale) {
          void warmCombinedPropsSnapshot({ origin, cronSecret }).catch((error) => {
            console.warn(
              '[Props Combined] Background snapshot refresh failed:',
              error instanceof Error ? error.message : error
            );
          });
        }

        const clientSnapshot = await resolveClientCombinedSnapshot(cachedSnapshot, wantsFull);
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

    const snapshot = await buildCombinedPropsSnapshot({
      origin,
      refresh,
      debugStats,
      cronSecret,
      writeCache: !debugStats,
    });

    const clientSnapshot = wantsFull ? snapshot : slimCombinedPropsSnapshotForClient(snapshot);

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
