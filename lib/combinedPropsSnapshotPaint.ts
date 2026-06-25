import type { CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';

/** Browser paint payload — no per-row game logs or other dashboard-only fields. */
export const COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_paint_v2';

/** Strip fields the props list never renders (saves parse/hydrate work in the browser). */
export function slimCombinedPlayerPropForPaint(prop: CombinedPlayerProp): CombinedPlayerProp {
  const {
    wcGameLog: _wcGameLog,
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
    worldCup: { ...snapshot.worldCup, props: mapProps(snapshot.worldCup.props) },
  };
}
