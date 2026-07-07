/** Coalesce identical in-flight browser fetches (props prefetch + dashboard load). */
const inflightJson = new Map<string, Promise<unknown>>();

function inflightKey(url: string, init?: RequestInit): string {
  return `${init?.method ?? 'GET'} ${url}`;
}

export async function fetchJsonDeduped<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const key = inflightKey(url, init);
  const existing = inflightJson.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetch(url, { cache: 'no-store', ...init })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    })
    .finally(() => {
      inflightJson.delete(key);
    });

  inflightJson.set(key, promise);
  return promise as Promise<T>;
}

export async function fetchJsonDedupedResult<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; data: T }> {
  try {
    const data = await fetchJsonDeduped<T>(url, init);
    return { ok: true, data };
  } catch {
    return { ok: false, data: {} as T };
  }
}
