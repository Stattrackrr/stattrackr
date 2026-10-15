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
import { getNbaPlayerPropsList } from '@/lib/nba/dash/playerPropsList';
import { NBA_PUBLIC_ENABLED } from '@/lib/nbaConstants';
import { getNblPlayerPropsList } from '@/lib/nbl/playerPropsList';
import { applyTennisListLiveOverlay, type TennisPlayerPropsListPayload } from '@/lib/tennis/playerPropsList';

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

/** NBA rows come only from the cron-built list (tagged); legacy-pipeline rows are dropped. */
async function attachCachedNbaList(
  snapshot: CombinedPropsSnapshot
): Promise<CombinedPropsSnapshot> {
  const empty: CombinedPropsSnapshot['nba'] = {
    ok: false,
    status: 204,
    cached: true,
    lastUpdated: null,
    gameDate: null,
    props: [],
    noNbaOdds: true,
    games: [],
  };
  if (!NBA_PUBLIC_ENABLED) return { ...snapshot, nba: empty };
  const payload = await getNbaPlayerPropsList();
  if (payload.data.length) {
    return {
      ...snapshot,
      nba: {
        ok: true,
        status: 200,
        cached: true,
        lastUpdated: payload.lastUpdated ?? null,
        gameDate: payload.games[0]?.commenceTime ?? null,
        nextUpdate: payload.nextUpdate ?? null,
        ingestMessage: payload.ingestMessage ?? null,
        noNbaOdds: false,
        games: payload.games,
        props: payload.data,
      },
    };
  }
  const tagged = (snapshot.nba?.props || []).filter((p) => p.sportSource === 'nba');
  return { ...snapshot, nba: tagged.length ? { ...snapshot.nba, props: tagged } : empty };
}

/**
 * The stored slice keeps whatever tournament it was built with. Apply the same read overlay as the
 * tennis list so a player shows their next unplayed match, not an event they already left.
 */
async function withLiveTennisOverlay(snapshot: CombinedPropsSnapshot): Promise<CombinedPropsSnapshot> {
  const tennis = snapshot.tennis;
  if (!tennis?.props?.length) return snapshot;
  try {
    const healed = await applyTennisListLiveOverlay({
      ...(tennis as unknown as TennisPlayerPropsListPayload),
      data: tennis.props as unknown as TennisPlayerPropsListPayload['data'],
      games: (tennis.games || []) as unknown as TennisPlayerPropsListPayload['games'],
    });
    return {
      ...snapshot,
      tennis: {
        ...tennis,
        props: healed.data as unknown as typeof tennis.props,
        games: healed.games as unknown as typeof tennis.games,
        noTennisOdds: healed.data.length === 0 ? true : tennis.noTennisOdds,
      },
    };
  } catch {
    return snapshot;
  }
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
    const [withTennis, withNbl, withNba] = await Promise.all([
      attachCachedTennisSlice(painted).then(withLiveTennisOverlay),
      attachCachedNblList(painted),
      attachCachedNbaList(painted),
    ]);
    const merged: CombinedPropsSnapshot = {
      ...painted,
      nba: withNba.nba,
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
