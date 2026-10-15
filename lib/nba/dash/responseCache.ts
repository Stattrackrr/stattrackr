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

type Entry<T> = { at: number; data: T };
type CacheGlobals = {
  memory: Map<string, Entry<unknown>>;
  inflight: Map<string, Promise<unknown>>;
};

const globals: CacheGlobals = ((globalThis as { __nbaDashRespCache?: CacheGlobals }).__nbaDashRespCache ??= {
  memory: new Map(),
  inflight: new Map(),
});

const warmContext = new AsyncLocalStorage<boolean>();

/** Run `fn` with inline rebuilds: stale or missing entries are rebuilt before returning. */
export function runNbaDashWarm<T>(fn: () => Promise<T>): Promise<T> {
  return warmContext.run(true, fn);
}

export type NbaDashCachePolicy = { freshSeconds: number; maxAgeSeconds: number };

export const NBA_DASH_CACHE = {
  playerLogs: { freshSeconds: 10 * 60, maxAgeSeconds: 6 * 60 * 60 },
  teamLogs: { freshSeconds: 10 * 60, maxAgeSeconds: 6 * 60 * 60 },
  nextGame: { freshSeconds: 5 * 60, maxAgeSeconds: 60 * 60 },
  roster: { freshSeconds: 15 * 60, maxAgeSeconds: 24 * 60 * 60 },
  injuries: { freshSeconds: 5 * 60, maxAgeSeconds: 2 * 60 * 60 },
  lineups: { freshSeconds: 10 * 60, maxAgeSeconds: 12 * 60 * 60 },
  ladder: { freshSeconds: 10 * 60, maxAgeSeconds: 24 * 60 * 60 },
  league: { freshSeconds: 30 * 60, maxAgeSeconds: 24 * 60 * 60 },
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
  const now = Date.now();
  const age = (e: Entry<unknown>) => (now - e.at) / 1000;

  let entry = globals.memory.get(key) as Entry<T> | undefined;
  if (!entry || age(entry) >= policy.freshSeconds) {
    const stored = await sharedCache.getJSON<Entry<T>>(key).catch(() => null);
    if (stored && typeof stored.at === 'number' && (!entry || stored.at > entry.at)) {
      entry = stored;
      remember(key, stored);
    }
  }
  if (entry && age(entry) < policy.maxAgeSeconds) {
    if (age(entry) < policy.freshSeconds) return entry.data;
    if (warming) return rebuild(key, policy, build);
    refreshLater(key, policy, build);
    return entry.data;
  }
  return rebuild(key, policy, build);
}
