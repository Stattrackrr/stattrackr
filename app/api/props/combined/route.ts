import { NextRequest, NextResponse } from 'next/server';
import {
  attachCachedTennisSlice,
  combinedSnapshotPropCount,
  filterCombinedSnapshotAflEligibility,
  getCombinedPropsPaintSnapshot,
  getCombinedPropsSnapshot,
  slimCombinedPropsSnapshotForClient,
} from '@/lib/combinedPropsSnapshotPaint';
import type { CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
import { getNblPlayerPropsList } from '@/lib/nbl/playerPropsList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const COMBINED_CACHE_CONTROL = 'private, no-store';
const COMBINED_CACHE_CONTROL_HIT = 'private, no-store';

function emptyCombinedShell(): CombinedPropsSnapshot {
  const now = new Date().toISOString();
  return {
    success: true,
    snapshotVersion: 1,
    generatedAt: now,
    staleAt: now,
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
    nbl: {
      ok: false,
      status: 204,
      lastUpdated: null,
      nextUpdate: null,
      ingestMessage: 'No odds available. Come back later.',
      noNblOdds: true,
      games: [],
      props: [],
    },
  };
}

async function attachCachedNblList(
  snapshot: CombinedPropsSnapshot
): Promise<CombinedPropsSnapshot> {
  const payload = await getNblPlayerPropsList();
  if (!payload.data.length) return snapshot;
  return {
    ...snapshot,
    nbl: {
      ok: true,
      status: 200,
      lastUpdated: payload.lastUpdated ?? null,
      nextUpdate: payload.nextUpdate ?? null,
      ingestMessage: payload.ingestMessage ?? null,
      noNblOdds: Boolean(payload.noNblOdds) && payload.data.length === 0,
      games: payload.games || [],
      props: payload.data,
    },
  };
}

/**
 * Cache-only. Crons write Redis; this route never rebuilds from Odds/API-Tennis.
 */
export async function GET(request: NextRequest) {
  const wantsFull =
    request.nextUrl.searchParams.get('full') === '1' ||
    request.nextUrl.searchParams.get('debugStats') === '1';

  try {
    const paintSnapshot = !wantsFull ? await getCombinedPropsPaintSnapshot() : null;
    const cachedSnapshot = paintSnapshot || (await getCombinedPropsSnapshot());
    const source = cachedSnapshot || emptyCombinedShell();
    const painted = wantsFull
      ? filterCombinedSnapshotAflEligibility(source)
      : filterCombinedSnapshotAflEligibility(
          paintSnapshot || slimCombinedPropsSnapshotForClient(source)
        );
    const [withTennis, withNbl] = await Promise.all([
      attachCachedTennisSlice(painted),
      attachCachedNblList(painted),
    ]);
    const merged: CombinedPropsSnapshot = {
      ...painted,
      tennis: withTennis.tennis,
      nbl: withNbl.nbl,
    };
    const hasProps = combinedSnapshotPropCount(merged) > 0;
    return NextResponse.json(
      {
        ...merged,
        cachedSnapshot: true,
        backgroundRefreshStarted: false,
        paintSnapshot: !wantsFull,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': hasProps ? COMBINED_CACHE_CONTROL_HIT : COMBINED_CACHE_CONTROL,
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
        headers: { 'Cache-Control': COMBINED_CACHE_CONTROL },
      }
    );
  }
}
