import { NextRequest, NextResponse } from 'next/server';
import {
  attachCachedTennisSlice,
  combinedSnapshotPropCount,
  filterCombinedSnapshotAflEligibility,
  getCombinedPropsPaintSnapshot,
  getCombinedPropsSnapshot,
  slimCombinedPropsSnapshotForClient,
} from '@/lib/combinedPropsSnapshotPaint';
import type { CombinedAflGame, CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
import { getNblPlayerPropsList } from '@/lib/nbl/playerPropsList';
import { applyTennisListLiveOverlay, getTennisPlayerPropsList } from '@/lib/tennis/playerPropsList';

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

async function overlayCombinedTennisDvp(
  snapshot: CombinedPropsSnapshot
): Promise<CombinedPropsSnapshot> {
  const tennis = snapshot.tennis;
  if (!tennis?.props?.length) {
    const fresh = await getTennisPlayerPropsList().catch(() => null);
    if (!fresh?.data?.length) return snapshot;
    return {
      ...snapshot,
      tennis: {
        ok: true,
        status: 200,
        lastUpdated: fresh.lastUpdated ?? null,
        nextUpdate: fresh.nextUpdate ?? null,
        ingestMessage: fresh.ingestMessage ?? null,
        noTennisOdds: Boolean(fresh.noTennisOdds) && fresh.data.length === 0,
        games: (fresh.games || []) as CombinedAflGame[],
        props: fresh.data as unknown as CombinedPlayerProp[],
      },
    };
  }
  try {
    const overlaid = await applyTennisListLiveOverlay({
      success: true,
      data: tennis.props as unknown as Parameters<typeof applyTennisListLiveOverlay>[0]['data'],
      games: tennis.games || [],
      propsCount: tennis.props.length,
      gamesCount: tennis.games?.length || 0,
      lastUpdated: tennis.lastUpdated ?? null,
      nextUpdate: tennis.nextUpdate ?? null,
      noTennisOdds: Boolean(tennis.noTennisOdds),
      noAflOdds: true,
      ingestMessage: tennis.ingestMessage ?? null,
    });
    if (overlaid.data.length) {
      return {
        ...snapshot,
        tennis: {
          ...tennis,
          props: overlaid.data as unknown as CombinedPlayerProp[],
          games: (overlaid.games?.length ? overlaid.games : tennis.games) as CombinedAflGame[],
          noTennisOdds: false,
        },
      };
    }
    const fresh = await getTennisPlayerPropsList().catch(() => null);
    if (!fresh?.data?.length) {
      return { ...snapshot, tennis: { ...tennis, noTennisOdds: true, props: [], games: [] } };
    }
    return {
      ...snapshot,
      tennis: {
        ...tennis,
        ok: true,
        status: 200,
        lastUpdated: fresh.lastUpdated ?? null,
        nextUpdate: fresh.nextUpdate ?? null,
        ingestMessage: fresh.ingestMessage ?? null,
        noTennisOdds: false,
        games: (fresh.games || []) as CombinedAflGame[],
        props: fresh.data as unknown as CombinedPlayerProp[],
      },
    };
  } catch {
    return snapshot;
  }
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
    const withTennis = await overlayCombinedTennisDvp(await attachCachedTennisSlice(painted));
    const withNbl = await attachCachedNblList(withTennis);
    const hasProps = combinedSnapshotPropCount(withNbl) > 0;
    return NextResponse.json(
      {
        ...withNbl,
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
