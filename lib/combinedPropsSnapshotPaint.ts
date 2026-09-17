import sharedCache from '@/lib/sharedCache';
import type { CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
import {
  AFL_USER_NO_ODDS,
  filterAflPropRowsByCommenceTime,
  filterAflPropsEligibleGames,
} from '@/lib/combinedPropsSnapshotTypes';

/** Full combined snapshot (server). Keep in lockstep with the paint key below. */
export const COMBINED_PROPS_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_v6';

/** Browser paint payload — no per-row game logs or other dashboard-only fields. */
export const COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_paint_v6';

/** Strip fields the props list never renders (saves parse/hydrate work in the browser). */
export function slimCombinedPlayerPropForPaint(prop: CombinedPlayerProp): CombinedPlayerProp {
  const {
    expectedValue: _expectedValue,
    overProb: _overProb,
    underProb: _underProb,
    impliedOverProb: _impliedOverProb,
    impliedUnderProb: _impliedUnderProb,
    ...rest
  } = prop;
  return {
    ...rest,
    overProb: 0,
    underProb: 0,
    impliedOverProb: 0,
    impliedUnderProb: 0,
  };
}

export function slimCombinedPropsSnapshotForClient(
  snapshot: CombinedPropsSnapshot
): CombinedPropsSnapshot {
  const mapProps = (props: CombinedPlayerProp[]) => props.map(slimCombinedPlayerPropForPaint);
  return {
    ...snapshot,
    nba: { ...snapshot.nba, props: mapProps(snapshot.nba.props) },
    afl: { ...snapshot.afl, props: mapProps(snapshot.afl.props) },
    tennis: snapshot.tennis
      ? { ...snapshot.tennis, props: mapProps(snapshot.tennis.props) }
      : snapshot.tennis,
  };
}

export async function getCombinedPropsSnapshot(): Promise<CombinedPropsSnapshot | null> {
  const snapshot = await sharedCache.getJSON<CombinedPropsSnapshot>(COMBINED_PROPS_SNAPSHOT_CACHE_KEY);
  return snapshot && typeof snapshot === 'object' ? snapshot : null;
}

export async function getCombinedPropsPaintSnapshot(): Promise<CombinedPropsSnapshot | null> {
  const snapshot = await sharedCache.getJSON<CombinedPropsSnapshot>(COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY);
  return snapshot && typeof snapshot === 'object' ? snapshot : null;
}

export function isCombinedPropsSnapshotStale(snapshot: CombinedPropsSnapshot): boolean {
  const staleAt = Date.parse(snapshot?.staleAt ?? '');
  return !Number.isFinite(staleAt) || staleAt <= Date.now();
}

export function combinedSnapshotAflAssemblyReady(snapshot: CombinedPropsSnapshot): boolean {
  const games = snapshot.afl?.games ?? [];
  const props = snapshot.afl?.props ?? [];
  if (games.length > 0 && props.length === 0) return false;
  return true;
}

export function filterCombinedSnapshotAflEligibility(
  snapshot: CombinedPropsSnapshot,
  nowMs = Date.now()
): CombinedPropsSnapshot {
  const eligibleGames = filterAflPropsEligibleGames(snapshot.afl.games ?? [], nowMs);
  const eligibleGameIds = new Set(eligibleGames.map((g) => g.gameId));
  const filteredProps = filterAflPropRowsByCommenceTime(snapshot.afl.props ?? [], eligibleGameIds, nowMs);

  if (
    filteredProps.length === (snapshot.afl.props?.length ?? 0) &&
    eligibleGames.length === (snapshot.afl.games?.length ?? 0)
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    afl: {
      ...snapshot.afl,
      games: eligibleGames,
      props: filteredProps,
      noAflOdds: filteredProps.length === 0,
      ingestMessage: filteredProps.length === 0 ? AFL_USER_NO_ODDS : snapshot.afl.ingestMessage,
    },
  };
}
