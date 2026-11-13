/**
 * Dedupe identical similar-players fetches (mobile + desktop cards mount together).
 */

const inflight = new Map<string, Promise<unknown>>();
const recent = new Map<string, { at: number; data: unknown }>();
const RECENT_TTL_MS = 60_000;

export function fetchSimilarPlayersJson<T>(url: string): Promise<T> {
  const cached = recent.get(url);
  if (cached && Date.now() - cached.at < RECENT_TTL_MS) {
    return Promise.resolve(cached.data as T);
  }
  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;

  const promise = fetch(url)
    .then(async (r) => {
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error || 'Failed to load');
      recent.set(url, { at: Date.now(), data: json });
      return json as T;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise;
}
