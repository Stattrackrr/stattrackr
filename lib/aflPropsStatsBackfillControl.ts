/** Abort in-flight AFL props-stats batch when leaving /props so it cannot land 50s later. */

let controller: AbortController | null = null;

export function abortAflPropsStatsBackfill(): void {
  controller?.abort();
  controller = null;
}

export function startAflPropsStatsBackfill(): AbortSignal {
  abortAflPropsStatsBackfill();
  controller = new AbortController();
  return controller.signal;
}

export function isOnPropsPage(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/props';
}
