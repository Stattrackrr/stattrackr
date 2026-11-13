/**
 * Process-memory + Redis cache for NBL similar-players payloads.
 * Same shape as nbaDashCached, scoped to this card only.
 */

import { createHash } from 'crypto';
import { after } from 'next/server';
import { sharedCache } from '@/lib/sharedCache';

const PREFIX = 'nbl_similar_resp_v1';
const MEMORY_MAX = 200;
const FRESH_SECONDS = 30 * 60;
const MAX_AGE_SECONDS = 6 * 60 * 60;

type Entry<T> = { at: number; data: T };
type Globals = {
  memory: Map<string, Entry<unknown>>;
  inflight: Map<string, Promise<unknown>>;
};

const globals: Globals = ((globalThis as { __nblSimilarRespCache?: Globals }).__nblSimilarRespCache ??= {
  memory: new Map(),
  inflight: new Map(),
});

function cacheKey(parts: unknown[]): string {
  const hash = createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 20);
  return `${PREFIX}:${hash}`;
}

function remember(key: string, entry: Entry<unknown>) {
  const { memory } = globals;
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

function rebuild<T>(key: string, build: () => Promise<T>): Promise<T> {
  const running = globals.inflight.get(key);
  if (running) return running as Promise<T>;
  const promise = (async () => {
    const data = await build();
    const entry: Entry<T> = { at: Date.now(), data };
    remember(key, entry);
    await sharedCache.setJSON(key, entry, MAX_AGE_SECONDS, { skipMemory: true });
    return data;
  })();
  globals.inflight.set(key, promise);
  promise.then(
    () => globals.inflight.delete(key),
    () => globals.inflight.delete(key)
  );
  return promise;
}

function refreshLater<T>(key: string, build: () => Promise<T>) {
  const run = () => rebuild(key, build).catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

export async function nblSimilarCached<T>(parts: unknown[], build: () => Promise<T>): Promise<T> {
  const key = cacheKey(parts);
  const now = Date.now();
  const age = (e: Entry<unknown>) => (now - e.at) / 1000;

  let entry = globals.memory.get(key) as Entry<T> | undefined;
  if (!entry || age(entry) >= FRESH_SECONDS) {
    const stored = await sharedCache.getJSON<Entry<T>>(key).catch(() => null);
    if (stored && typeof stored.at === 'number' && (!entry || stored.at > entry.at)) {
      entry = stored;
      remember(key, stored);
    }
  }
  if (entry && age(entry) < MAX_AGE_SECONDS) {
    if (age(entry) < FRESH_SECONDS) return entry.data;
    refreshLater(key, build);
    return entry.data;
  }
  return rebuild(key, build);
}
