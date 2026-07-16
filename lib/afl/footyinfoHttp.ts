/**
 * Shared FootyInfo HTTP client (api.footyinfo.com/api).
 * JSON API — preferred over HTML scrape; works from cloud IPs.
 */

export const FOOTYINFO_API_BASE = 'https://api.footyinfo.com/api';
export const FOOTYINFO_SITE_BASE = 'https://www.footyinfo.com';

export const FOOTYINFO_DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-AU,en;q=0.9',
  Origin: FOOTYINFO_SITE_BASE,
  Referer: `${FOOTYINFO_SITE_BASE}/`,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isFootyinfoUnavailableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 520;
}

export type FootyinfoFetchResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/**
 * GET JSON from FootyInfo API with retries for transient errors.
 * `path` may be `/player/...` or a full URL under the API host.
 */
export async function fetchFootyinfoJson<T = unknown>(
  path: string,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<FootyinfoFetchResult<T>> {
  const attempts = Math.max(1, Number(options.attempts ?? process.env.FOOTYINFO_FETCH_ATTEMPTS ?? 5));
  const baseDelayMs = Math.max(
    300,
    Number(options.baseDelayMs ?? process.env.FOOTYINFO_FETCH_DELAY_MS ?? 800)
  );
  const headers = { ...FOOTYINFO_DEFAULT_HEADERS, ...(options.headers || {}) };
  const url = path.startsWith('http')
    ? path
    : `${FOOTYINFO_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

  let lastStatus = 0;
  let lastError = '';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { headers, signal: options.signal, cache: 'no-store' });
      lastStatus = res.status;
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (res.ok) return { ok: true, status: res.status, data: data as T };
      if (!isFootyinfoUnavailableStatus(res.status)) {
        const msg =
          data && typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message?: unknown }).message)
            : `HTTP ${res.status}`;
        return { ok: false, status: res.status, error: msg };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastStatus = 0;
    }
    if (i < attempts - 1) await sleep(baseDelayMs * (i + 1));
  }
  return { ok: false, status: lastStatus, error: lastError || `HTTP ${lastStatus}` };
}

export async function probeFootyinfo(
  path = '/ladder',
  options: { attempts?: number; baseDelayMs?: number } = {}
): Promise<{ ok: boolean; status: number; attempts: number; error?: string }> {
  const attempts = Math.max(1, Number(options.attempts ?? 3));
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetchFootyinfoJson(path, { attempts: 1, baseDelayMs: options.baseDelayMs });
    if (res.ok) return { ok: true, status: res.status, attempts: i + 1 };
    if (!isFootyinfoUnavailableStatus(res.status) && res.status !== 0) {
      return { ok: false, status: res.status, attempts: i + 1, error: res.error };
    }
  }
  return { ok: false, status: 0, attempts, error: 'unavailable' };
}
