/**
 * NBL Rosetta HTTP client (prod.rosetta.nbl.com.au).
 * Genius Sports stats fronted by NBL's Redis-cached proxy.
 * Referer-gated — no API key (Origin + Referer required).
 */

export const ROSETTA_API_BASE = 'https://prod.rosetta.nbl.com.au/get';
export const NBL_SITE_ORIGIN = 'https://nbl.com.au';

export const ROSETTA_DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-AU,en;q=0.9',
  Origin: NBL_SITE_ORIGIN,
  Referer: `${NBL_SITE_ORIGIN}/`,
};

const maxConcurrentRequests = Math.max(
  1,
  Number(process.env.NBL_ROSETTA_MAX_CONCURRENT_REQUESTS ?? 6)
);
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

async function withRosettaRequestSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeRequests >= maxConcurrentRequests) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve));
  }
  activeRequests += 1;
  try {
    return await work();
  } finally {
    activeRequests -= 1;
    requestWaiters.shift()?.();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRosettaUnavailableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 520;
}

export type RosettaEnvelope<T> = {
  type?: string;
  fetched?: number;
  ttlRemaining?: number;
  count?: number;
  source?: string;
  data: T;
};

export type RosettaFetchResult<T> =
  | { ok: true; status: number; data: T; envelope: RosettaEnvelope<T> }
  | { ok: false; status: number; error: string };

/**
 * GET JSON from Rosetta. `route` is the path after `/get/` (e.g. `nbl/teams`).
 */
export async function fetchRosettaJson<T = unknown>(
  route: string,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<RosettaFetchResult<T>> {
  const attempts = Math.max(
    1,
    Number(options.attempts ?? process.env.NBL_ROSETTA_FETCH_ATTEMPTS ?? 5)
  );
  const baseDelayMs = Math.max(
    200,
    Number(options.baseDelayMs ?? process.env.NBL_ROSETTA_FETCH_DELAY_MS ?? 400)
  );
  const headers = { ...ROSETTA_DEFAULT_HEADERS, ...(options.headers || {}) };
  const clean = route.replace(/^\//, '');
  const url = clean.startsWith('http') ? clean : `${ROSETTA_API_BASE}/${clean}`;

  let lastStatus = 0;
  let lastError = '';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const { res, text } = await withRosettaRequestSlot(async () => {
        const response = await fetch(url, { headers, signal: options.signal, cache: 'no-store' });
        return { res: response, text: await response.text() };
      });
      lastStatus = res.status;
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (res.ok) {
        // Rosetta wraps payloads as { type, count, data }; news is a raw array.
        if (Array.isArray(parsed)) {
          const data = parsed as T;
          return {
            ok: true,
            status: res.status,
            data,
            envelope: { type: 'array', count: parsed.length, data },
          };
        }
        if (parsed && typeof parsed === 'object' && 'data' in (parsed as object)) {
          const envelope = parsed as RosettaEnvelope<T>;
          return { ok: true, status: res.status, data: envelope.data, envelope };
        }
        return {
          ok: true,
          status: res.status,
          data: parsed as T,
          envelope: { data: parsed as T },
        };
      }
      if (!isRosettaUnavailableStatus(res.status)) {
        const msg =
          parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed
            ? String((parsed as { error?: unknown }).error)
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

export async function probeRosetta(
  route = 'nbl/teams',
  options: { attempts?: number; baseDelayMs?: number } = {}
): Promise<{ ok: boolean; status: number; attempts: number; error?: string }> {
  const attempts = Math.max(1, Number(options.attempts ?? 3));
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetchRosettaJson(route, { attempts: 1, baseDelayMs: options.baseDelayMs });
    if (res.ok) return { ok: true, status: res.status, attempts: i + 1 };
    if (!isRosettaUnavailableStatus(res.status) && res.status !== 0) {
      return { ok: false, status: res.status, attempts: i + 1, error: res.error };
    }
  }
  return { ok: false, status: 0, attempts, error: 'Rosetta unavailable' };
}
