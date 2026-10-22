/**
 * Shared NBA dashboard response cache: process memory -> Redis -> build.
 * Fresh entries are served directly; stale ones (up to maxAge) are served immediately and
 * rebuilt after the response. Inside `runNbaDashWarm` (cron) stale/missing entries are rebuilt inline.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';
import { after } from 'next/server';
import { sharedCache } from '@/lib/sharedCache';

const PREFIX = 'nba_dash_resp_v1';
const MEMORY_MAX_ENTRIES = 400;
const DATA_AT_KEY = 'nba_dash_data_at';
const DATA_AT_TTL_SECONDS = 30 * 24 * 60 * 60;
const DATA_AT_CHECK_MS = 60_000;

type Entry<T> = { at: number; data: T };
type CacheGlobals = {
  memory: Map<string, Entry<unknown>>;
  inflight: Map<string, Promise<unknown>>;
  dataAt?: { checkedAt: number; value: number };
};

const globals: CacheGlobals = ((globalThis as { __nbaDashRespCache?: CacheGlobals }).__nbaDashRespCache ??= {
  memory: new Map(),
  inflight: new Map(),
});

/** When the NBA sync last wrote new data (ms). Anything built before it is stale. */
export async function nbaDashDataAt(): Promise<number> {
  const hit = globals.dataAt;
  if (hit && Date.now() - hit.checkedAt < DATA_AT_CHECK_MS) return hit.value;
  const stored = await sharedCache.getJSON<number>(DATA_AT_KEY).catch(() => null);
  const value = Number(stored) || 0;
  globals.dataAt = { checkedAt: Date.now(), value };
  return value;
}

export async function markNbaDashDataChanged(at = Date.now()): Promise<void> {
  await sharedCache.setJSON(DATA_AT_KEY, at, DATA_AT_TTL_SECONDS);
  globals.dataAt = { checkedAt: Date.now(), value: at };
}

const warmContext = new AsyncLocalStorage<boolean>();

/** Run `fn` with inline rebuilds: stale or missing entries are rebuilt before returning. */
export function runNbaDashWarm<T>(fn: () => Promise<T>): Promise<T> {
  return warmContext.run(true, fn);
}

export type NbaDashCachePolicy = { freshSeconds: number; maxAgeSeconds: number };

/**
 * Box scores and shots only change when the NBA sync writes new data, which also marks every
 * entry built before it stale, so logs can stay fresh for two hours otherwise.
 */
export const NBA_DASH_CACHE = {
  playerLogs: { freshSeconds: 2 * 60 * 60, maxAgeSeconds: 6 * 60 * 60 },
  teamLogs: { freshSeconds: 2 * 60 * 60, maxAgeSeconds: 6 * 60 * 60 },
  nextGame: { freshSeconds: 5 * 60, maxAgeSeconds: 60 * 60 },
  roster: { freshSeconds: 15 * 60, maxAgeSeconds: 24 * 60 * 60 },
  injuries: { freshSeconds: 5 * 60, maxAgeSeconds: 2 * 60 * 60 },
  lineups: { freshSeconds: 10 * 60, maxAgeSeconds: 12 * 60 * 60 },
  ladder: { freshSeconds: 10 * 60, maxAgeSeconds: 24 * 60 * 60 },
  league: { freshSeconds: 2 * 60 * 60, maxAgeSeconds: 24 * 60 * 60 },
} satisfies Record<string, NbaDashCachePolicy>;

function cacheKey(name: string, parts: unknown[]): string {
  const hash = createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 20);
  return `${PREFIX}:${name}:${hash}`;
}

function remember(key: string, entry: Entry<unknown>) {
  const { memory } = globals;
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

function rebuild<T>(key: string, policy: NbaDashCachePolicy, build: () => Promise<T>): Promise<T> {
  const running = globals.inflight.get(key);
  if (running) return running as Promise<T>;
  const promise = (async () => {
    const data = await build();
    const entry: Entry<T> = { at: Date.now(), data };
    remember(key, entry);
    await sharedCache.setJSON(key, entry, policy.maxAgeSeconds, { skipMemory: true });
    return data;
  })();
  globals.inflight.set(key, promise);
  promise.then(
    () => globals.inflight.delete(key),
    () => globals.inflight.delete(key)
  );
  return promise;
}

function refreshLater<T>(key: string, policy: NbaDashCachePolicy, build: () => Promise<T>) {
  const run = () => rebuild(key, policy, build).catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

export async function nbaDashCached<T>(
  name: string,
  parts: unknown[],
  policy: NbaDashCachePolicy,
  build: () => Promise<T>
): Promise<T> {
  const key = cacheKey(name, parts);
  const warming = warmContext.getStore() === true;
  const dataAt = await nbaDashDataAt();
  const now = Date.now();
  const age = (e: Entry<unknown>) => (now - e.at) / 1000;
  const fresh = (e: Entry<unknown>) => age(e) < policy.freshSeconds && e.at >= dataAt;

  let entry = globals.memory.get(key) as Entry<T> | undefined;
  if (!entry || !fresh(entry)) {
    const stored = await sharedCache.getJSON<Entry<T>>(key).catch(() => null);
    if (stored && typeof stored.at === 'number' && (!entry || stored.at > entry.at)) {
      entry = stored;
      remember(key, stored);
    }
  }
  if (entry && age(entry) < policy.maxAgeSeconds) {
    if (fresh(entry)) return entry.data;
    if (warming) return rebuild(key, policy, build);
    refreshLater(key, policy, build);
    return entry.data;
  }
  return rebuild(key, policy, build);
}
