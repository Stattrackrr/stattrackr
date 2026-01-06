'use client';

import { useRef } from 'react';

export function useDashboardRefs() {
  // Track if stat was set from URL to prevent default stat logic from overriding it
  const statFromUrlRef = useRef(false);
  
  // Track if user manually selected a stat (to prevent default logic from overriding)
  const userSelectedStatRef = useRef(false);

  // Track auto-set state for betting lines (shared across handlers)
  const hasManuallySetLineRef = useRef(false);
  const lastAutoSetStatRef = useRef<string | null>(null);
  const lastAutoSetLineRef = useRef<number | null>(null);

  // Search dropdown ref
  const searchRef = useRef<HTMLDivElement>(null);
  
  // Refs to track prefetch status (prevent duplicate prefetches)
  const dvpRanksPrefetchRef = useRef<Set<string>>(new Set());

  // Track current fetch to prevent race conditions
  const teammateFetchAbortControllerRef = useRef<AbortController | null>(null);
  const teammateFetchInProgressRef = useRef<Set<number>>(new Set());

  return {
    statFromUrlRef,
    userSelectedStatRef,
    hasManuallySetLineRef,
    lastAutoSetStatRef,
    lastAutoSetLineRef,
    searchRef,
    dvpRanksPrefetchRef,
    teammateFetchAbortControllerRef,
    teammateFetchInProgressRef,
  };
}

