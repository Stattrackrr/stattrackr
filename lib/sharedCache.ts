/*
 * Shared cache wrapper with optional Upstash Redis.
 * If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, uses Upstash REST API
 * (same backend in local and production).
 * Otherwise falls back to an in-memory process cache (empty on server start, lost on restart).
 *
 * Local dev – to use the same AFL (and other) cache as production, add to .env.local:
 *   UPSTASH_REDIS_REST_URL=<your Upstash REST URL>
 *   UPSTASH_REDIS_REST_TOKEN=<your Upstash REST token>
 *
 * Upstash Pay As You Go max request size is 10MB. We gzip larger values and skip Redis
 * (memory-only) when the HTTP body would still exceed that cap.
 */

import { gunzipSync, gzipSync } from 'zlib';

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const HAS_UPSTASH = !!(REST_URL && REST_TOKEN);
const fallbackWarnings = new Set<string>();
/** Stay under Upstash PAYG 10MB request limit after JSON wrapping of the SET body. */
const UPSTASH_MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const GZIP_MIN_BYTES = 32 * 1024;
const GET_MANY_CHUNK = 20;

type GzipPacked = { v: 1; encoding: 'gzip-json'; payload: string };

function isGzipPacked(value: unknown): value is GzipPacked {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as GzipPacked).encoding === 'gzip-json' &&
    typeof (value as GzipPacked).payload === 'string'
  );
}

function unpackGzipJson<T>(value: unknown): T | null {
  if (!isGzipPacked(value)) return value as T;
  try {
    const json = gunzipSync(Buffer.from(value.payload, 'base64')).toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function encodeUpstashValue(value: unknown): { body: string; skipped: boolean } {
  if (isGzipPacked(value)) {
    const body = JSON.stringify(value);
    return { body, skipped: body.length > UPSTASH_MAX_REQUEST_BYTES };
  }
  const json = JSON.stringify(value);
  let body = json;
  if (json.length >= GZIP_MIN_BYTES) {
    const packed: GzipPacked = {
      v: 1,
      encoding: 'gzip-json',
      payload: gzipSync(Buffer.from(json), { level: 6 }).toString('base64'),
    };
    const packedJson = JSON.stringify(packed);
    if (packedJson.length < json.length) body = packedJson;
  }
  return { body, skipped: body.length > UPSTASH_MAX_REQUEST_BYTES };
}

function warnSharedCacheFallback(operation: string, error: unknown): void {
  const key = `${operation}:${error instanceof Error ? error.message : String(error)}`;
  if (fallbackWarnings.has(key)) return;
  fallbackWarnings.add(key);
  console.warn(`[sharedCache] Falling back to in-memory cache during ${operation}:`, error);
}

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
        try {
          return unpackGzipJson<T>(JSON.parse(val as string));
        } catch {
          return null;
        }
      } catch (error) {
        warnSharedCacheFallback('redis GET', error);
      }
    }
    // memory fallback
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.exp && Date.now() > hit.exp) { memory.delete(key); return null; }
    return hit.v as T;
  },
  /** Batch GET via chunked Upstash pipeline round-trips (null per missing key). */
  async getJSONMany<T = any>(keys: string[]): Promise<Array<T | null>> {
    if (!keys.length) return [];
    if (HAS_UPSTASH && keys.length > GET_MANY_CHUNK) {
      const out: Array<T | null> = [];
      for (let i = 0; i < keys.length; i += GET_MANY_CHUNK) {
        out.push(...(await sharedCache.getJSONMany<T>(keys.slice(i, i + GET_MANY_CHUNK))));
      }
      return out;
    }
    if (HAS_UPSTASH) {
      try {
        const commands = keys.map((key) => ['GET', key]);
        const res = await fetch(`${REST_URL}/pipeline`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${REST_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(commands),
        });
        if (!res.ok) throw new Error(`Upstash error ${res.status}`);
        const json = (await res.json()) as unknown[];
        return keys.map((_, i) => {
          const r = json?.[i];
          const val =
            r != null && typeof r === 'object' && 'result' in r
              ? (r as { result: string | null }).result
              : Array.isArray(r)
                ? r[1]
                : typeof r === 'string'
                  ? r
                  : null;
          if (val == null || val === '') return null;
          try {
            return unpackGzipJson<T>(JSON.parse(val as string));
          } catch {
            return null;
          }
        });
      } catch (error) {
        warnSharedCacheFallback('redis MGET pipeline', error);
      }
    }
    return keys.map((key) => {
      const hit = memory.get(key);
      if (!hit) return null;
      if (hit.exp && Date.now() > hit.exp) {
        memory.delete(key);
        return null;
      }
      return hit.v as T;
    });
  },
  async deleteJSON(key: string): Promise<void> {
    if (HAS_UPSTASH) {
      try {
        await upstash(['DEL', key]);
      } catch (error) {
        warnSharedCacheFallback('redis DEL', error);
      }
    }
    memory.delete(key);
  },
  async setJSON(key: string, value: any, ttlSeconds: number): Promise<void> {
    const exp = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;
    memory.set(key, { v: value, exp });
    if (!HAS_UPSTASH) return;
    try {
      const { body, skipped } = encodeUpstashValue(value);
      if (skipped) {
        console.warn(
          `[sharedCache] skip Redis SET ${key} (${body.length} bytes > ${UPSTASH_MAX_REQUEST_BYTES}); memory-only`
        );
        return;
      }
      await upstash(['SET', key, body, 'EX', ttlSeconds]);
    } catch (error) {
      warnSharedCacheFallback('redis SET', error);
    }
  },
  /** Delete all keys whose string key starts with prefix (e.g. "afl_prop_stats_v1"). */
  async clearKeysByPrefix(prefix: string): Promise<number> {
    const match = prefix.endsWith('*') ? prefix : `${prefix}*`;
    if (HAS_UPSTASH) {
      try {
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
      } catch (error) {
        warnSharedCacheFallback('redis prefix clear', error);
      }
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
