import type { CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';

let earlyPayload: CombinedPropsSnapshot | null = null;
let earlyPromise: Promise<CombinedPropsSnapshot | null> | null = null;

/** Start `/api/props/combined` as early as possible (layout or page module load). */
export function kickCombinedPropsEarlyFetch(): void {
  if (typeof window === 'undefined' || earlyPromise) return;
  earlyPromise = fetch('/api/props/combined', { cache: 'default' })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json().catch(() => null)) as CombinedPropsSnapshot | null;
      if (payload?.success) {
        earlyPayload = payload;
        return payload;
      }
      return null;
    })
    .catch(() => null);
}

export function peekCombinedPropsEarlyPayload(): CombinedPropsSnapshot | null {
  return earlyPayload;
}

/** Consume the early fetch result (or await the in-flight request once). */
export async function takeCombinedPropsEarlyPayload(): Promise<CombinedPropsSnapshot | null> {
  if (earlyPayload) {
    const payload = earlyPayload;
    earlyPayload = null;
    earlyPromise = null;
    return payload;
  }
  if (earlyPromise) {
    await earlyPromise;
    const payload = earlyPayload;
    earlyPayload = null;
    earlyPromise = null;
    return payload;
  }
  return null;
}
