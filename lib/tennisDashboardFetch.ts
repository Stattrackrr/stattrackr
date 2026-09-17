/** Abort in-flight tennis dashboard fetches when leaving /tennis for /props. */

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

export function tennisDashboardSignal(): AbortSignal {
  return currentController().signal;
}

export function beginTennisDashboardSession(): void {
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
  clearInflightJsonByUrlPrefix('/api/tennis');
}

/** Drop in-flight work for a previous player without blocking the next player's fetches. */
export function resetTennisDashboardFetches(): void {
  abortCurrent();
  leaving = false;
}

export function abortTennisDashboardFetches(): void {
  leaving = true;
  abortCurrent();
}

export function isTennisDashboardAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function tennisDashboardFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (leaving) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  const url = String(input);
  let pending = inflight.get(url);
  if (!pending) {
    pending = fetch(input, {
      cache: 'default',
      ...init,
      signal: tennisDashboardSignal(),
    }).finally(() => {
      inflight.delete(url);
    });
    inflight.set(url, pending);
  }
  return pending.then((res) => res.clone());
}
