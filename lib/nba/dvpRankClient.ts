/**
 * Shared client-side DVP rank loader — PositionDefenseCard + upcoming tooltip
 * must hit the same batch URL + cache so ranks never disagree.
 */

import { normalizeAbbr } from '@/lib/nbaAbbr';
import { cachedFetch } from '@/lib/requestCache';
import { nbaTeamCode } from '@/lib/nba/dash/teams';

export const NBA_DVP_METRICS = [
  'pts',
  'reb',
  'ast',
  'fg3m',
  'fg_pct',
  'stl',
  'blk',
  'to',
  'fg3_pct',
] as const;

export type NbaDvpMetric = (typeof NBA_DVP_METRICS)[number];
export type NbaDvpPosition = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

type RankCacheEntry = {
  metrics: Record<string, Record<string, number>>;
  timestamp: number;
};

const rankCache = new Map<string, RankCacheEntry>();
const RANK_TTL_MS = 2 * 60 * 1000;
const GAMES = 82;

function cacheKey(pos: NbaDvpPosition): string {
  return `${pos}:g${GAMES}:v2`;
}

export function normalizeDvpPosition(input: string | null | undefined): NbaDvpPosition | null {
  const raw = String(input || '').toUpperCase().trim();
  if (!raw) return null;
  if ((['PG', 'SG', 'SF', 'PF', 'C'] as const).includes(raw as NbaDvpPosition)) {
    return raw as NbaDvpPosition;
  }
  const first = raw.split(/[\/\-\s,]/)[0]?.trim() || '';
  return (['PG', 'SG', 'SF', 'PF', 'C'] as const).find((p) => p === first) || null;
}

export function normalizeDvpTeamAbbr(team: string | null | undefined): string {
  const raw = String(team || '').trim();
  if (!raw) return '';
  return normalizeAbbr(nbaTeamCode(raw) || raw);
}

/**
 * Season DVP ranks by metric for a position (same payload the DvP card uses).
 * Returns `metrics[metric][teamAbbr] = rank`.
 */
export async function fetchNbaDvpRankBatch(
  pos: NbaDvpPosition,
  opts?: { forceRefresh?: boolean }
): Promise<Record<string, Record<string, number>>> {
  const key = cacheKey(pos);
  const now = Date.now();
  if (!opts?.forceRefresh) {
    const hit = rankCache.get(key);
    if (hit && now - hit.timestamp < RANK_TTL_MS) {
      return hit.metrics;
    }
  }

  const metricsStr = NBA_DVP_METRICS.join(',');
  const url = `/api/dvp/rank/batch?pos=${encodeURIComponent(pos)}&metrics=${encodeURIComponent(
    metricsStr
  )}&games=${GAMES}${opts?.forceRefresh ? '&refresh=1' : ''}`;

  const data = await cachedFetch<any>(url, undefined, RANK_TTL_MS);
  const metrics =
    data?.metrics && typeof data.metrics === 'object'
      ? (data.metrics as Record<string, Record<string, number>>)
      : {};

  rankCache.set(key, { metrics, timestamp: Date.now() });
  return metrics;
}

/** Opponent ranks for the given metrics at a position. */
export async function fetchNbaDvpRanksForOpponent(params: {
  position: string | null | undefined;
  opponent: string | null | undefined;
  metrics?: string[];
}): Promise<Record<string, number | null>> {
  const pos = normalizeDvpPosition(params.position);
  const abbr = normalizeDvpTeamAbbr(params.opponent);
  const out: Record<string, number | null> = {};
  const wanted = params.metrics?.length ? params.metrics : [...NBA_DVP_METRICS];
  for (const m of wanted) out[m] = null;
  if (!pos || !abbr) return out;

  try {
    const batch = await fetchNbaDvpRankBatch(pos);
    for (const m of wanted) {
      const rank = batch?.[m]?.[abbr];
      out[m] = typeof rank === 'number' && Number.isFinite(rank) ? rank : null;
    }
  } catch {
    // leave nulls
  }
  return out;
}

type AllowedCacheEntry = {
  metrics: Record<string, Record<string, number | null>>;
  timestamp: number;
};

const allowedCache = new Map<string, AllowedCacheEntry>();

function allowedCacheKey(team: string): string {
  return `${team}:g${GAMES}:v1`;
}

/**
 * Per-game DVP allowed values for a team (`metrics[metric][pos] = value`).
 * Same `/api/dvp/batch` payload the Defense vs Position card uses.
 */
export async function fetchNbaDvpAllowedBatch(
  team: string,
  opts?: { forceRefresh?: boolean }
): Promise<Record<string, Record<string, number | null>>> {
  const abbr = normalizeDvpTeamAbbr(team);
  if (!abbr) return {};
  const key = allowedCacheKey(abbr);
  const now = Date.now();
  if (!opts?.forceRefresh) {
    const hit = allowedCache.get(key);
    if (hit && now - hit.timestamp < RANK_TTL_MS) return hit.metrics;
  }

  const metricsStr = NBA_DVP_METRICS.join(',');
  const url = `/api/dvp/batch?team=${encodeURIComponent(abbr)}&metrics=${encodeURIComponent(
    metricsStr
  )}&games=${GAMES}${opts?.forceRefresh ? '&refresh=1' : ''}`;
  const data = await cachedFetch<any>(url, undefined, RANK_TTL_MS);
  const metrics =
    data?.metrics && typeof data.metrics === 'object'
      ? (data.metrics as Record<string, Record<string, number | null>>)
      : {};
  allowedCache.set(key, { metrics, timestamp: Date.now() });
  return metrics;
}

/** Opponent allowed-per-game values for the given metrics at a position. */
export async function fetchNbaDvpAllowedForOpponent(params: {
  position: string | null | undefined;
  opponent: string | null | undefined;
  metrics?: string[];
}): Promise<Record<string, number | null>> {
  const pos = normalizeDvpPosition(params.position);
  const out: Record<string, number | null> = {};
  const wanted = params.metrics?.length ? params.metrics : [...NBA_DVP_METRICS];
  for (const m of wanted) out[m] = null;
  if (!pos || !params.opponent) return out;

  try {
    const batch = await fetchNbaDvpAllowedBatch(params.opponent);
    for (const m of wanted) {
      const value = batch?.[m]?.[pos];
      out[m] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
  } catch {
    // leave nulls
  }
  return out;
}

/** Seed / read the shared rank cache (used by PositionDefenseCard). */
export function getCachedNbaDvpRankBatch(pos: NbaDvpPosition): RankCacheEntry | undefined {
  const hit = rankCache.get(cacheKey(pos));
  if (!hit) return undefined;
  if (Date.now() - hit.timestamp > RANK_TTL_MS) {
    rankCache.delete(cacheKey(pos));
    return undefined;
  }
  return hit;
}

export function setCachedNbaDvpRankBatch(
  pos: NbaDvpPosition,
  metrics: Record<string, Record<string, number>>
): void {
  rankCache.set(cacheKey(pos), { metrics, timestamp: Date.now() });
}
