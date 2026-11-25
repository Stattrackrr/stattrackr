/**
 * Shared NBL game-log cache for props prefetch + dashboard paint.
 */
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { NBL_CHART_HISTORY_YEARS } from '@/lib/nblTeamCanonical';

export const NBL_PLAYER_LOGS_CACHE_PREFIX = 'nblPlayerLogsCache:v4';
export const NBL_PLAYER_LOGS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

export type NblPlayerLogsCacheEntry = {
  createdAt: number;
  years: number[];
  games: NblGameLogRow[];
};

type MemoryStore = {
  entries: Map<string, NblPlayerLogsCacheEntry>;
  inflight: Map<string, Promise<NblGameLogRow[]>>;
};

function store(): MemoryStore {
  const g = globalThis as typeof globalThis & { __nblPlayerLogsClient?: MemoryStore };
  if (!g.__nblPlayerLogsClient) {
    g.__nblPlayerLogsClient = { entries: new Map(), inflight: new Map() };
  }
  return g.__nblPlayerLogsClient;
}

export function nblPlayerLogsCacheKey(playerId: string): string {
  return `${NBL_PLAYER_LOGS_CACHE_PREFIX}:${playerId}:${NBL_CHART_HISTORY_YEARS.join(',')}`;
}

function yearsMatch(years: unknown): boolean {
  return Array.isArray(years) && years.join(',') === NBL_CHART_HISTORY_YEARS.join(',');
}

function isFresh(createdAt: unknown): boolean {
  return Number.isFinite(createdAt) && Date.now() - Number(createdAt) <= NBL_PLAYER_LOGS_CACHE_TTL_MS;
}

function logsUrl(playerId: string): string {
  return `/api/nbl/player-game-logs?playerId=${encodeURIComponent(playerId)}&years=${NBL_CHART_HISTORY_YEARS.join(',')}`;
}

export function readNblPlayerLogsCache(playerId: string): {
  games: NblGameLogRow[];
  fresh: boolean;
} | null {
  const id = String(playerId || '').trim();
  if (!id) return null;
  const key = nblPlayerLogsCacheKey(id);
  const mem = store().entries.get(key);
  if (mem && yearsMatch(mem.years) && Array.isArray(mem.games)) {
    return { games: mem.games, fresh: isFresh(mem.createdAt) };
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NblPlayerLogsCacheEntry;
    if (!yearsMatch(parsed.years) || !Array.isArray(parsed.games)) return null;
    store().entries.set(key, parsed);
    return { games: parsed.games, fresh: isFresh(parsed.createdAt) };
  } catch {
    return null;
  }
}

export function writeNblPlayerLogsCache(playerId: string, games: NblGameLogRow[]): void {
  const id = String(playerId || '').trim();
  if (!id || !Array.isArray(games)) return;
  const key = nblPlayerLogsCacheKey(id);
  const entry: NblPlayerLogsCacheEntry = {
    createdAt: Date.now(),
    years: [...NBL_CHART_HISTORY_YEARS],
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

export function loadNblPlayerLogs(playerId: string): Promise<NblGameLogRow[]> {
  const id = String(playerId || '').trim();
  if (!id) return Promise.resolve([]);
  const key = nblPlayerLogsCacheKey(id);
  const cached = readNblPlayerLogsCache(id);
  if (cached?.fresh) return Promise.resolve(cached.games);

  const existing = store().inflight.get(key);
  if (existing) return existing;

  const pending = fetch(logsUrl(id), { cache: 'default' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`logs ${res.status}`);
      const data = await res.json();
      const games = Array.isArray(data.games) ? (data.games as NblGameLogRow[]) : [];
      writeNblPlayerLogsCache(id, games);
      return games;
    })
    .finally(() => {
      store().inflight.delete(key);
    });

  store().inflight.set(key, pending);
  return pending;
}

export function prefetchNblPlayerLogs(playerId: string): void {
  void loadNblPlayerLogs(playerId).catch(() => {});
}
