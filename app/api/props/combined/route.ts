import { NextRequest, NextResponse } from 'next/server';
import {
  buildCombinedPropsSnapshot,
  getCombinedPropsSnapshot,
  isCombinedPropsSnapshotStale,
  warmCombinedPropsSnapshot,
} from '@/lib/combinedPropsSnapshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COMBINED_CACHE_CONTROL = 'private, no-store';

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const debugStats = request.nextUrl.searchParams.get('debugStats') === '1';
  const origin = request.nextUrl.origin;
  const cronSecret = request.headers.get('x-cron-secret') ?? undefined;

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

        return NextResponse.json(
          {
            ...cachedSnapshot,
            cachedSnapshot: true,
            backgroundRefreshStarted: stale,
          },
          {
            status: cachedSnapshot.success ? 200 : 502,
            headers: {
              'Cache-Control': COMBINED_CACHE_CONTROL,
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

    return NextResponse.json(
      {
        ...snapshot,
        cachedSnapshot: false,
        backgroundRefreshStarted: false,
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
