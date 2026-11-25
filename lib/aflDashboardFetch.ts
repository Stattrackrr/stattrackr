/** Abort in-flight AFL dashboard fetches when leaving /afl for /props. */

import { clearInflightJsonByUrlPrefix } from '@/lib/clientFetchDedupe';

let controller: AbortController | null = null;
let leaving = false;
const inflight = new Map<string, Promise<Response>>();

function currentController(): AbortController {
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
  }
  return controller;
}

export function aflDashboardSignal(): AbortSignal {
  return currentController().signal;
}

export function beginAflDashboardSession(): void {
  leaving = false;
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
  }
}

function abortCurrent(): void {
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
  controller = new AbortController();
  inflight.clear();
  clearInflightJsonByUrlPrefix('/api/afl');
}

export function resetAflDashboardFetches(): void {
  abortCurrent();
  leaving = false;
}

export function abortAflDashboardFetches(): void {
  leaving = true;
  abortCurrent();
}

export function isAflDashboardAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function mergedSignal(extra?: AbortSignal | null): AbortSignal {
  const base = aflDashboardSignal();
  if (!extra) return base;
  const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn([base, extra]);
  return base;
}

export function aflDashboardFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (leaving) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  const url = String(input);
  // Props prefetch + dashboard must share one request (esp. 3-season game logs).
  const canDedupe = !init?.method || init.method === 'GET';
  if (canDedupe) {
    let pending = inflight.get(url);
    if (!pending) {
      pending = fetch(input, {
        cache: 'default',
        ...init,
        signal: mergedSignal(init?.signal ?? null),
      }).finally(() => {
        inflight.delete(url);
      });
      inflight.set(url, pending);
    }
    return pending.then((res) => res.clone());
  }
  return fetch(input, {
    cache: 'default',
    ...init,
    signal: mergedSignal(init?.signal ?? null),
  });
}

export async function aflDashboardFetchResult<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; data: T }> {
  try {
    const res = await aflDashboardFetch(url, init);
    if (!res.ok) return { ok: false, data: {} as T };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, data: {} as T };
  }
}
