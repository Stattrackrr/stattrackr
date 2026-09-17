/** Abort in-flight AFL dashboard fetches when leaving /afl for /props. */

import { clearInflightJsonByUrlPrefix } from '@/lib/clientFetchDedupe';

let controller: AbortController | null = null;
let leaving = false;

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
