import sharedCache from '@/lib/sharedCache';
import type { CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
import {
  AFL_USER_NO_ODDS,
  filterAflPropRowsByCommenceTime,
  filterAflPropsEligibleGames,
} from '@/lib/combinedPropsSnapshotTypes';
import { readTennisPlayerPropsListCache } from '@/lib/tennis/playerPropsListCache';

/** Full combined snapshot (server). Keep in lockstep with the paint key below. */
export const COMBINED_PROPS_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_v6';

/** Browser paint payload — no per-row game logs or other dashboard-only fields. */
export const COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_paint_v6';

const COMBINED_SNAPSHOT_READ_KEYS = [
  COMBINED_PROPS_SNAPSHOT_CACHE_KEY,
  'combined_props_snapshot_v7',
] as const;

const COMBINED_PAINT_READ_KEYS = [
  COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY,
  'combined_props_snapshot_paint_v7',
] as const;

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

async function firstCachedSnapshot(keys: readonly string[]): Promise<CombinedPropsSnapshot | null> {
  for (const key of keys) {
    const snapshot = await sharedCache.getJSON<CombinedPropsSnapshot>(key);
    if (snapshot && typeof snapshot === 'object') return snapshot;
  }
  return null;
}

export async function getCombinedPropsSnapshot(): Promise<CombinedPropsSnapshot | null> {
  return firstCachedSnapshot(COMBINED_SNAPSHOT_READ_KEYS);
}

export async function getCombinedPropsPaintSnapshot(): Promise<CombinedPropsSnapshot | null> {
  return firstCachedSnapshot(COMBINED_PAINT_READ_KEYS);
}

export async function attachCachedTennisSlice(
  snapshot: CombinedPropsSnapshot
): Promise<CombinedPropsSnapshot> {
  if ((snapshot.tennis?.props?.length || 0) > 0) return snapshot;
  const payload = await readTennisPlayerPropsListCache();
  if (!payload?.data?.length) return snapshot;
  return {
    ...snapshot,
    tennis: {
      ok: true,
      status: 200,
      lastUpdated: payload.lastUpdated ?? null,
      nextUpdate: payload.nextUpdate ?? null,
      ingestMessage: payload.ingestMessage ?? null,
      noTennisOdds: Boolean(payload.noTennisOdds) && payload.data.length === 0,
      games: payload.games || [],
      props: payload.data,
    },
  };
}

const COMBINED_PROPS_SNAPSHOT_TTL_SECONDS = 4 * 60 * 60;

function tennisDvpRowKey(row: {
  playerName?: string | null;
  gameId?: string | null;
  statType?: string | null;
  line?: number | null;
  opponent?: string | null;
}): string {
  return `${row.playerName || ''}|${row.gameId || ''}|${row.statType || ''}|${row.line ?? ''}|${row.opponent || ''}`;
}

export async function patchCombinedSnapshotTennisDvp(
  rows: Array<{
    playerName?: string | null;
    gameId?: string | null;
    statType?: string | null;
    line?: number | null;
    opponent?: string | null;
    dvpRating?: number | null;
    dvpStatValue?: number | null;
    dvpFieldSize?: number | null;
  }>
): Promise<number> {
  if (!rows.length) return 0;
  const byKey = new Map(rows.map((row) => [tennisDvpRowKey(row), row]));
  const patchSnapshot = (snapshot: CombinedPropsSnapshot | null) => {
    if (!snapshot?.tennis?.props?.length) return snapshot;
    const props = snapshot.tennis.props.map((prop) => {
      const hit =
        byKey.get(tennisDvpRowKey(prop)) ||
        byKey.get(`${prop.playerName}|${prop.gameId || ''}|${prop.statType}|${prop.line}|`);
      if (!hit || hit.dvpRating == null) return prop;
      return {
        ...prop,
        dvpRating: hit.dvpRating,
        dvpStatValue: hit.dvpStatValue ?? prop.dvpStatValue ?? null,
        dvpFieldSize: hit.dvpFieldSize ?? prop.dvpFieldSize ?? null,
      };
    });
    return { ...snapshot, tennis: { ...snapshot.tennis, props } };
  };
  const full = patchSnapshot(await getCombinedPropsSnapshot());
  const paint = patchSnapshot(await getCombinedPropsPaintSnapshot());
  const writes: Array<Promise<unknown>> = [];
  if (full) {
    writes.push(
      sharedCache.setJSON(COMBINED_PROPS_SNAPSHOT_CACHE_KEY, full, COMBINED_PROPS_SNAPSHOT_TTL_SECONDS)
    );
  }
  if (paint || full) {
    writes.push(
      sharedCache.setJSON(
        COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY,
        slimCombinedPropsSnapshotForClient(paint || full!),
        COMBINED_PROPS_SNAPSHOT_TTL_SECONDS
      )
    );
  }
  if (writes.length) await Promise.all(writes);
  return (full || paint)?.tennis?.props.filter((prop) => prop.dvpRating != null).length || 0;
}

export function isCombinedPropsSnapshotStale(snapshot: CombinedPropsSnapshot): boolean {
  const staleAt = Date.parse(snapshot?.staleAt ?? '');
  return !Number.isFinite(staleAt) || staleAt <= Date.now();
}

export function combinedTennisHasFormStats(snapshot: CombinedPropsSnapshot): boolean {
  const rows = snapshot.tennis?.props || [];
  if (!rows.length) return snapshot.tennis?.noTennisOdds === true;
  const withStats = rows.filter(
    (row) =>
      row.last10Avg != null ||
      row.last5Avg != null ||
      row.seasonAvg != null ||
      row.h2hAvg != null
  ).length;
  return withStats >= Math.max(1, Math.ceil(rows.length * 0.15));
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
