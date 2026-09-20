import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
import {
  AFL_USER_NO_ODDS,
  filterAflPropRowsByCommenceTime,
  filterAflPropsEligibleGames,
} from '@/lib/combinedPropsSnapshotTypes';
import { readTennisPlayerPropsListCache } from '@/lib/tennis/playerPropsListCache';
import {
  aggregateTennisPropsForPaint,
  tennisPropsNeedPaintAggregation,
} from '@/lib/tennis/aggregatePropsForPaint';

/** Full combined snapshot (server). Keep in lockstep with the paint key below. */
export const COMBINED_PROPS_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_v6';

/** Browser paint payload — no per-row game logs or other dashboard-only fields. */
export const COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_paint_v6';

const COMBINED_SNAPSHOT_LAST_GOOD_KEY = 'combined_props_snapshot_last_good_v1';
const COMBINED_PAINT_LAST_GOOD_KEY = 'combined_props_snapshot_paint_last_good_v1';
const COMBINED_PROPS_SNAPSHOT_TTL_SECONDS = 8 * 60 * 60;
const COMBINED_PROPS_LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;

const COMBINED_SNAPSHOT_READ_KEYS = [
  COMBINED_PROPS_SNAPSHOT_CACHE_KEY,
  'combined_props_snapshot_v7',
  COMBINED_SNAPSHOT_LAST_GOOD_KEY,
] as const;

const COMBINED_PAINT_READ_KEYS = [
  COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY,
  'combined_props_snapshot_paint_v7',
  COMBINED_PAINT_LAST_GOOD_KEY,
] as const;

export function combinedSnapshotPropCount(snapshot: CombinedPropsSnapshot | null | undefined): number {
  if (!snapshot) return 0;
  return (
    (snapshot.nba?.props?.length || 0) +
    (snapshot.afl?.props?.length || 0) +
    (snapshot.tennis?.props?.length || 0)
  );
}

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
  let empty: CombinedPropsSnapshot | null = null;
  for (const key of keys) {
    const snapshot = await sharedCache.getJSON<CombinedPropsSnapshot>(key);
    if (!snapshot || typeof snapshot !== 'object') continue;
    if (combinedSnapshotPropCount(snapshot) > 0) return snapshot;
    empty ??= snapshot;
  }
  return empty;
}

export async function getCombinedPropsSnapshot(): Promise<CombinedPropsSnapshot | null> {
  return firstCachedSnapshot(COMBINED_SNAPSHOT_READ_KEYS);
}

export async function getCombinedPropsPaintSnapshot(): Promise<CombinedPropsSnapshot | null> {
  return firstCachedSnapshot(COMBINED_PAINT_READ_KEYS);
}

function withAggregatedTennisSlice(snapshot: CombinedPropsSnapshot): CombinedPropsSnapshot {
  const tennis = snapshot.tennis;
  if (!tennis?.props?.length) return snapshot;
  if (!tennisPropsNeedPaintAggregation(tennis.props)) return snapshot;
  return {
    ...snapshot,
    tennis: {
      ...tennis,
      props: aggregateTennisPropsForPaint(tennis.props),
    },
  };
}

export async function attachCachedTennisSlice(
  snapshot: CombinedPropsSnapshot
): Promise<CombinedPropsSnapshot> {
  const current = withAggregatedTennisSlice(snapshot);
  if ((current.tennis?.props?.length || 0) > 0) return current;
  const payload = await readTennisPlayerPropsListCache();
  if (!payload?.data?.length) return current;
  return {
    ...current,
    tennis: {
      ok: true,
      status: 200,
      lastUpdated: payload.lastUpdated ?? null,
      nextUpdate: payload.nextUpdate ?? null,
      ingestMessage: payload.ingestMessage ?? null,
      noTennisOdds: Boolean(payload.noTennisOdds) && payload.data.length === 0,
      games: payload.games || [],
      props: aggregateTennisPropsForPaint(payload.data),
    },
  };
}

function tennisDvpRowKey(row: {
  playerName?: string | null;
  gameId?: string | null;
  statType?: string | null;
  line?: number | null;
  opponent?: string | null;
}): string {
  return `${row.playerName || ''}|${row.gameId || ''}|${row.statType || ''}|${row.line ?? ''}|${row.opponent || ''}`;
}

function preservePopulatedSportSlices(
  next: CombinedPropsSnapshot,
  previous: CombinedPropsSnapshot | null
): CombinedPropsSnapshot {
  if (!previous) return next;
  if (combinedSnapshotPropCount(next) === 0 && combinedSnapshotPropCount(previous) > 0) {
    return previous;
  }
  return {
    ...next,
    nba: next.nba?.props?.length ? next.nba : previous.nba,
    tennis: next.tennis?.props?.length ? next.tennis : previous.tennis,
    afl: next.afl?.props?.length
      ? next.afl
      : next.afl?.noAflOdds
        ? next.afl
        : previous.afl?.props?.length
          ? previous.afl
          : next.afl,
  };
}

/** Write live keys and a 7-day last-good copy. Never persist an empty slate over populated props. */
export async function persistCombinedPropsSnapshot(
  snapshot: CombinedPropsSnapshot
): Promise<CombinedPropsSnapshot> {
  const previous =
    (await getCombinedPropsSnapshot()) || (await getCombinedPropsPaintSnapshot());
  const merged = preservePopulatedSportSlices(snapshot, previous);
  if (combinedSnapshotPropCount(merged) === 0 && combinedSnapshotPropCount(previous) > 0) {
    return previous!;
  }
  const paint = slimCombinedPropsSnapshotForClient(merged);
  const entries: Array<{ key: string; value: CombinedPropsSnapshot; ttlSeconds: number }> = [
    { key: COMBINED_PROPS_SNAPSHOT_CACHE_KEY, value: merged, ttlSeconds: COMBINED_PROPS_SNAPSHOT_TTL_SECONDS },
    { key: COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY, value: paint, ttlSeconds: COMBINED_PROPS_SNAPSHOT_TTL_SECONDS },
  ];
  if (combinedSnapshotPropCount(merged) > 0) {
    entries.push(
      { key: COMBINED_SNAPSHOT_LAST_GOOD_KEY, value: merged, ttlSeconds: COMBINED_PROPS_LAST_GOOD_TTL_SECONDS },
      { key: COMBINED_PAINT_LAST_GOOD_KEY, value: paint, ttlSeconds: COMBINED_PROPS_LAST_GOOD_TTL_SECONDS }
    );
  }
  await sharedCache.setJSONMany(entries);
  return merged;
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
      const prevField = Number(prop.dvpFieldSize) || 0;
      const nextField = Number(hit.dvpFieldSize) || 0;
      if (
        typeof prop.dvpRating === 'number' &&
        Number.isFinite(prop.dvpRating) &&
        prop.dvpRating > 0 &&
        prevField > nextField
      ) {
        return prop;
      }
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
  const source = full || paint;
  if (!source) return 0;
  const stored = await persistCombinedPropsSnapshot(source);
  return stored.tennis?.props.filter((prop) => prop.dvpRating != null).length || 0;
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
  // Only treat AFL as "still assembling" when games exist, props are empty, and
  // odds ingest has not marked the slate as having no markets. An off-week /
  // finals game with no player odds must not blank tennis/NBA.
  if (games.length > 0 && props.length === 0 && snapshot.afl?.noAflOdds === false) {
    return false;
  }
  return true;
}

function emptyCombinedSnapshot(now = Date.now()): CombinedPropsSnapshot {
  return {
    success: true,
    snapshotVersion: 1,
    generatedAt: new Date(now).toISOString(),
    staleAt: new Date(now + 15 * 60 * 1000).toISOString(),
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
      ingestMessage: null,
      noTennisOdds: true,
      games: [],
      props: [],
    },
  };
}

/** Cron-only: write the tennis slice onto combined Redis keys without a full rebuild. */
export async function upsertCombinedSnapshotTennisFromList(payload: {
  data?: unknown[];
  games?: CombinedAflGame[];
  lastUpdated?: string | null;
  nextUpdate?: string | null;
  ingestMessage?: string | null;
  noTennisOdds?: boolean;
}): Promise<number> {
  const props = (Array.isArray(payload.data) ? payload.data : []) as CombinedPlayerProp[];
  if (!props.length) {
    const existing = (await getCombinedPropsSnapshot()) || (await getCombinedPropsPaintSnapshot());
    return existing?.tennis?.props?.length || 0;
  }
  const now = Date.now();
  const existing =
    (await getCombinedPropsSnapshot()) ||
    (await getCombinedPropsPaintSnapshot()) ||
    emptyCombinedSnapshot(now);
  const next: CombinedPropsSnapshot = {
    ...existing,
    success: true,
    generatedAt: new Date(now).toISOString(),
    staleAt: new Date(now + 15 * 60 * 1000).toISOString(),
    tennis: {
      ok: true,
      status: 200,
      lastUpdated: payload.lastUpdated ?? null,
      nextUpdate: payload.nextUpdate ?? null,
      ingestMessage: payload.ingestMessage ?? null,
      noTennisOdds: false,
      games: payload.games || [],
      props,
    },
  };
  const stored = await persistCombinedPropsSnapshot(next);
  return stored.tennis?.props?.length || 0;
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
