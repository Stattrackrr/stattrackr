/**
 * Shared NBA game-log cache for props prefetch + dashboard paint.
 * Prefetch and dashboard join the same in-flight request and both write
 * memory + localStorage so the chart never waits on a duplicate cold miss.
 */
import type { NbaGameLogRow } from '@/lib/nba/dash/types';
import { NBA_CHART_HISTORY_YEARS } from '@/lib/nba/dash/teams';

export const NBA_PLAYER_LOGS_CACHE_PREFIX = 'nbaPlayerLogsCache:v4';
export const NBA_PLAYER_LOGS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

export type NbaPlayerLogsCacheEntry = {
  createdAt: number;
  years: number[];
  games: NbaGameLogRow[];
};

type MemoryStore = {
  entries: Map<string, NbaPlayerLogsCacheEntry>;
  inflight: Map<string, Promise<NbaGameLogRow[]>>;
};

function store(): MemoryStore {
  const g = globalThis as typeof globalThis & { __nbaPlayerLogsClient?: MemoryStore };
  if (!g.__nbaPlayerLogsClient) {
    g.__nbaPlayerLogsClient = { entries: new Map(), inflight: new Map() };
  }
  return g.__nbaPlayerLogsClient;
}

export function nbaPlayerLogsCacheKey(playerId: string): string {
  return `${NBA_PLAYER_LOGS_CACHE_PREFIX}:${playerId}:${NBA_CHART_HISTORY_YEARS.join(',')}`;
}

function yearsMatch(years: unknown): boolean {
  return Array.isArray(years) && years.join(',') === NBA_CHART_HISTORY_YEARS.join(',');
}

function isFresh(createdAt: unknown): boolean {
  return Number.isFinite(createdAt) && Date.now() - Number(createdAt) <= NBA_PLAYER_LOGS_CACHE_TTL_MS;
}

function logsUrl(playerId: string): string {
  return `/api/nba/dash/player-game-logs?playerId=${encodeURIComponent(playerId)}&years=${NBA_CHART_HISTORY_YEARS.join(',')}`;
}

/** Soft-read: memory first, then localStorage. Stale entries are still usable for instant paint. */
export function readNbaPlayerLogsCache(playerId: string): {
  games: NbaGameLogRow[];
  fresh: boolean;
} | null {
  const id = String(playerId || '').trim();
  if (!/^\d+$/.test(id)) return null;
  const key = nbaPlayerLogsCacheKey(id);
  const mem = store().entries.get(key);
  if (mem && yearsMatch(mem.years) && Array.isArray(mem.games)) {
    return { games: mem.games, fresh: isFresh(mem.createdAt) };
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NbaPlayerLogsCacheEntry;
    if (!yearsMatch(parsed.years) || !Array.isArray(parsed.games)) return null;
    store().entries.set(key, parsed);
    return { games: parsed.games, fresh: isFresh(parsed.createdAt) };
  } catch {
    return null;
  }
}

export function writeNbaPlayerLogsCache(playerId: string, games: NbaGameLogRow[]): void {
  const id = String(playerId || '').trim();
  if (!/^\d+$/.test(id) || !Array.isArray(games)) return;
  const key = nbaPlayerLogsCacheKey(id);
  const entry: NbaPlayerLogsCacheEntry = {
    createdAt: Date.now(),
    years: [...NBA_CHART_HISTORY_YEARS],
    games,
  };
  store().entries.set(key, entry);
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* quota */
  }
}

/** Network load with in-flight dedupe. Uses cache:'default' so CDN HITs are reused. */
export function loadNbaPlayerLogs(playerId: string): Promise<NbaGameLogRow[]> {
  const id = String(playerId || '').trim();
  if (!/^\d+$/.test(id)) return Promise.resolve([]);
  const key = nbaPlayerLogsCacheKey(id);
  const cached = readNbaPlayerLogsCache(id);
  if (cached?.fresh) return Promise.resolve(cached.games);

  const existing = store().inflight.get(key);
  if (existing) return existing;

  const pending = fetch(logsUrl(id), { cache: 'default' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`logs ${res.status}`);
      const data = await res.json();
      const games = Array.isArray(data.games) ? (data.games as NbaGameLogRow[]) : [];
      writeNbaPlayerLogsCache(id, games);
      return games;
    })
    .finally(() => {
      store().inflight.delete(key);
    });

  store().inflight.set(key, pending);
  return pending;
}

/** Fire-and-forget warm from props click — same promise the dashboard awaits. */
export function prefetchNbaPlayerLogs(playerId: string): void {
  void loadNbaPlayerLogs(playerId).catch(() => {});
}
