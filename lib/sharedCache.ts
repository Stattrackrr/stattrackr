/*
Shared cache wrapper with optional Upstash Redis.
If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, uses Upstash REST API.
Otherwise falls back to an in-memory process cache (per instance).
*/

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const HAS_UPSTASH = !!(REST_URL && REST_TOKEN);

// Simple per-process fallback
const memory = new Map<string, { v: any; exp: number }>();

async function upstash(command: any[]) {
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

export const sharedCache = {
  async getJSON<T = any>(key: string): Promise<T | null> {
    if (HAS_UPSTASH) {
      try {
        const r = await upstash(['GET', key]);
        const val = r && Array.isArray(r) ? r[1] : null;
        if (val == null) return null;
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
};

export default sharedCache;
