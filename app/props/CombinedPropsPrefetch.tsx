'use client';

import { kickCombinedPropsEarlyFetch } from '@/lib/propsCombinedEarlyFetch';

kickCombinedPropsEarlyFetch();

/** Kicks off combined props API fetch when the props layout chunk loads. */
export function CombinedPropsPrefetch() {
  return null;
}
