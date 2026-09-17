import { abortAflPropsStatsBackfill } from '@/lib/aflPropsStatsBackfillControl';
import { propsPathForSport, type PropsSportMode } from '@/lib/nbaConstants';

/** In-tab memory snapshot — survives Next.js client navigations without re-fetching props lists. */
export type PropsPageWarmSnapshot = {
  timestamp: number;
  sportParam: string | null;
  propsSport: PropsSportMode;
  playerProps: unknown[];
  aflProps: unknown[];
  tennisCombinedProps: unknown[];
  aflGames: unknown[];
  todaysGames: unknown[];
  selectedAflGameIds: string[];
  combinedPaintUnlocked: boolean;
  combinedFetchComplete: boolean;
  noAflOdds: boolean;
  scrollY: number;
  currentPage: number;
};

const PROPS_BACK_NAV_WARM_KEY = 'props_back_nav_warm_v1';
const PROPS_RETURN_SPORT_KEY = 'props_return_sport';
const WARM_TTL_MS = 30 * 60 * 1000;

type SnapshotGetter = () => PropsPageWarmSnapshot | null;

let memorySnapshot: PropsPageWarmSnapshot | null = null;
let warmReturnPending = false;
let getter: SnapshotGetter | null = null;

export function normalizePropsSportParam(sportParam: string | null): string {
  if (sportParam === null || sportParam === 'all' || sportParam === 'combined') return 'combined';
  return sportParam;
}

function sportParamsMatch(snapshot: PropsPageWarmSnapshot, sportParam: string | null): boolean {
  return normalizePropsSportParam(snapshot.sportParam) === normalizePropsSportParam(sportParam);
}

export function bindPropsPageSnapshotGetter(fn: SnapshotGetter): () => void {
  getter = fn;
  return () => {
    if (getter === fn) getter = null;
  };
}

function parseStoredPropsSport(raw: string | null | undefined): PropsSportMode | null {
  const value = String(raw || '').trim();
  if (
    value === 'combined' ||
    value === 'nba' ||
    value === 'afl' ||
    value === 'atp' ||
    value === 'wta'
  ) {
    return value;
  }
  if (value === 'all') return 'combined';
  return null;
}

function rememberPropsReturnSport(mode: PropsSportMode): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PROPS_RETURN_SPORT_KEY, mode);
  } catch {
    // ignore
  }
}

/** Dashboard "Back to Player Props" — restores All vs the sport tab you left from. */
export function consumePropsReturnPath(fallback: PropsSportMode): string {
  let mode = fallback;
  if (typeof window !== 'undefined') {
    try {
      const stored = parseStoredPropsSport(sessionStorage.getItem(PROPS_RETURN_SPORT_KEY));
      if (stored) mode = stored;
      sessionStorage.removeItem(PROPS_RETURN_SPORT_KEY);
    } catch {
      // ignore
    }
  }
  return propsPathForSport(mode);
}

/** Drop an unused return-sport token (browser back already landed on /props). */
export function clearPropsReturnSport(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PROPS_RETURN_SPORT_KEY);
  } catch {
    // ignore
  }
}

function markPropsBackNavWarm(): void {
  warmReturnPending = true;
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PROPS_BACK_NAV_WARM_KEY, '1');
  } catch {
    // ignore
  }
}

/** Call immediately before leaving /props for a player dashboard. */
export function snapshotPropsPageBeforeLeave(): void {
  abortAflPropsStatsBackfill();
  const snap = getter?.();
  if (snap) rememberPropsReturnSport(snap.propsSport);
  if (!snap) return;
  if (
    snap.playerProps.length === 0 &&
    snap.aflProps.length === 0 &&
    snap.tennisCombinedProps.length === 0
  ) {
    return;
  }
  memorySnapshot = snap;
  markPropsBackNavWarm();
}

export function peekPropsPageWarmSnapshot(
  sportParam: string | null
): PropsPageWarmSnapshot | null {
  const now = Date.now();
  if (
    memorySnapshot &&
    now - memorySnapshot.timestamp < WARM_TTL_MS &&
    sportParamsMatch(memorySnapshot, sportParam)
  ) {
    return memorySnapshot;
  }
  return null;
}

export function consumePropsBackNavWarm(): boolean {
  let fromSession = false;
  if (typeof window !== 'undefined') {
    try {
      fromSession = sessionStorage.getItem(PROPS_BACK_NAV_WARM_KEY) === '1';
      if (fromSession) sessionStorage.removeItem(PROPS_BACK_NAV_WARM_KEY);
    } catch {
      // ignore
    }
  }
  const pending = warmReturnPending || fromSession;
  warmReturnPending = false;
  return pending;
}

export function takePropsBackNavWarmSnapshot(
  sportParam: string | null
): PropsPageWarmSnapshot | null {
  if (!consumePropsBackNavWarm()) return null;
  const matched = peekPropsPageWarmSnapshot(sportParam);
  if (matched) return matched;
  const snap = memorySnapshot;
  if (!snap) return null;
  if (Date.now() - snap.timestamp >= WARM_TTL_MS) return null;
  return snap;
}

export function clearPropsPageWarmSnapshot(): void {
  memorySnapshot = null;
  warmReturnPending = false;
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PROPS_BACK_NAV_WARM_KEY);
  } catch {
    // ignore
  }
}
