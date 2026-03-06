/*
 * Shared cache wrapper with optional Upstash Redis.
 * If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, uses Upstash REST API
 * (same backend in local and production).
 * Otherwise falls back to an in-memory process cache (empty on server start, lost on restart).
 *
 * Local dev – to use the same AFL (and other) cache as production, add to .env.local:
 *   UPSTASH_REDIS_REST_URL=<your Upstash REST URL>
 *   UPSTASH_REDIS_REST_TOKEN=<your Upstash REST token>
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const HAS_UPSTASH = !!(REST_URL && REST_TOKEN);

// One-time dev hint when using in-memory fallback (AFL props etc. will be empty until populated)
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development' && !HAS_UPSTASH) {
  if (!(typeof globalThis !== 'undefined' && (globalThis as any).__sharedCacheDevHintShown)) {
    console.info(
      '[sharedCache] Using in-memory fallback. For same AFL cache as production, set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local'
    );
    try {
      (globalThis as any).__sharedCacheDevHintShown = true;
    } catch {}
  }
}

// Simple per-process fallback
const memory = new Map<string, { v: any; exp: number }>();

async function upstash(command: unknown[]): Promise<unknown> {
  const res = await fetch(`${REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command]),
  });
  if (!res.ok) throw new Error(`Upstash error ${res.status}`);
  const json = await res.json();
  return json?.[0];
}

/** 'redis' when UPSTASH_* are set (shared across processes); 'memory' otherwise (per-process). */
export function getSharedCacheBackend(): 'redis' | 'memory' {
  return HAS_UPSTASH ? 'redis' : 'memory';
}

export const sharedCache = {
  async getJSON<T = any>(key: string): Promise<T | null> {
    if (HAS_UPSTASH) {
      try {
        const r = await upstash(['GET', key]);
        // Upstash REST returns { result: value }; pipeline may also return raw value or [_, value]
        const val =
          r != null && typeof r === 'object' && 'result' in r
            ? (r as { result: string | null }).result
            : Array.isArray(r)
              ? r[1]
              : typeof r === 'string'
                ? r
                : null;
        if (val == null || val === '') return null;
        try { return JSON.parse(val as string) as T; } catch { return null; }
      } catch {
        // fall back to memory on error
      }
    }
    // memory fallback
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.exp && Date.now() > hit.exp) { memory.delete(key); return null; }
    return hit.v as T;
  },
  async setJSON(key: string, value: any, ttlSeconds: number): Promise<void> {
    if (HAS_UPSTASH) {
      try {
        const payload = JSON.stringify(value);
        // SET key value EX ttlSeconds
        await upstash(['SET', key, payload, 'EX', ttlSeconds]);
        return;
      } catch {
        // fall back to memory
      }
    }
    const exp = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;
    memory.set(key, { v: value, exp });
  },
  /** Delete all keys whose string key starts with prefix (e.g. "afl_prop_stats_v1"). */
  async clearKeysByPrefix(prefix: string): Promise<number> {
    const match = prefix.endsWith('*') ? prefix : `${prefix}*`;
    if (HAS_UPSTASH) {
      let cursor: number | string = 0;
      const keys: string[] = [];
      const maxScans = 200;
      let scans = 0;
      do {
        const raw = await upstash(['SCAN', String(cursor), 'MATCH', match, 'COUNT', 500]);
        const res = raw != null && typeof raw === 'object' && 'result' in raw ? (raw as { result: unknown }).result : raw;
        const arr = Array.isArray(res) ? res : [];
        const next = arr[0];
        const keyList = arr[1];
        cursor = typeof next === 'string' ? next : next;
        const nextNum = typeof cursor === 'string' ? parseInt(cursor, 10) : Number(cursor);
        cursor = Number.isFinite(nextNum) ? nextNum : 0;
        if (Array.isArray(keyList)) keys.push(...keyList.filter((k): k is string => typeof k === 'string'));
        if (++scans >= maxScans) break;
      } while (cursor !== 0);
      let deleted = 0;
      for (let i = 0; i < keys.length; i += 100) {
        const batch = keys.slice(i, i + 100);
        if (batch.length === 0) continue;
        await upstash(['DEL', ...batch]);
        deleted += batch.length;
      }
      return deleted;
    }
    let deleted = 0;
    for (const key of memory.keys()) {
      if (key.startsWith(prefix)) {
        memory.delete(key);
        deleted++;
      }
    }
    return deleted;
  },
};

export default sharedCache;
