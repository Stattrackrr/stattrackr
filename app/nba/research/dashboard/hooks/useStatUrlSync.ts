'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { updateSessionProperty } from '../utils/storageUtils';
import { PLAYER_STAT_OPTIONS, TEAM_STAT_OPTIONS } from '../constants';

export interface UseStatUrlSyncParams {
  selectedStat: string;
  setSelectedStat: (stat: string) => void;
  propsMode: 'player' | 'team';
  isPro: boolean;
  setPropsMode: (mode: 'player' | 'team') => void;
  setOpponentTeam: (team: string) => void;
  statFromUrlRef: React.MutableRefObject<boolean>;
  userSelectedStatRef: React.MutableRefObject<boolean>;
}

export function useStatUrlSync({
  selectedStat,
  setSelectedStat,
  propsMode,
  isPro,
  setPropsMode,
  setOpponentTeam,
  statFromUrlRef,
  userSelectedStatRef,
}: UseStatUrlSyncParams) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Store the initial stat from URL immediately on mount (before any navigation)
  const initialStatFromUrlRef = useRef<string | null>(null);
  const hasCapturedInitialStatRef = useRef(false);
  const hasUsedInitialStatRef = useRef(false);

  // Capture stat from URL IMMEDIATELY on mount (before any other code runs)
  useEffect(() => {
    if (hasCapturedInitialStatRef.current) return;
    hasCapturedInitialStatRef.current = true;
    
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        const stat = url.searchParams.get('stat');
        if (stat) {
          const normalizedStat = (() => {
            const statUpper = stat.toUpperCase();
            if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
              return 'fg3m';
            }
            return stat.toLowerCase();
          })();
          initialStatFromUrlRef.current = normalizedStat;
          // Debug logging removed(`[Dashboard] 🎯 Captured initial stat from URL on mount: "${stat}" -> "${normalizedStat}"`);
          statFromUrlRef.current = true;
          // Set it immediately
          setSelectedStat(normalizedStat);
        }
      } catch (e) {
        console.error('[Dashboard] Error capturing initial stat from URL:', e);
      }
    }
  }, [setSelectedStat, statFromUrlRef]);

  // Watch for stat parameter in URL and set it immediately
  useEffect(() => {
    const stat = searchParams.get('stat');
    
    // Only use initial stat from mount on the VERY FIRST render, then always respect URL
    if (!hasUsedInitialStatRef.current && initialStatFromUrlRef.current) {
      hasUsedInitialStatRef.current = true;
      // Clear the initial stat ref so we don't use it again
      const initialStat = initialStatFromUrlRef.current;
      initialStatFromUrlRef.current = null; // Clear it so we don't reset to it later
      statFromUrlRef.current = true;
      setSelectedStat(initialStat);
      
      // Store in session storage
      updateSessionProperty('selectedStat', initialStat);
      return; // Use initial stat on first render only
    }
    
    // After first render, always respect the current URL parameter
    // BUT skip if user just manually selected a stat (to prevent override)
    if (userSelectedStatRef.current) {
      return;
    }
    
    if (stat) {
      const normalizedStat = (() => {
        const statUpper = stat.toUpperCase();
        if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
          return 'fg3m';
        }
        return stat.toLowerCase();
      })();
      
      // Only update if it's different from current stat to avoid unnecessary re-renders
      if (normalizedStat !== selectedStat) {
        statFromUrlRef.current = true;
        setSelectedStat(normalizedStat);
        
        // Store in session storage
        updateSessionProperty('selectedStat', normalizedStat);
      }
    }
  }, [searchParams, selectedStat, setSelectedStat, statFromUrlRef, userSelectedStatRef]);

  // Sync selectedStat to URL when it changes (but don't trigger if it came from URL or user just selected)
  useEffect(() => {
    // Skip if stat was just set from URL (to avoid circular updates)
    if (statFromUrlRef.current) {
      statFromUrlRef.current = false; // Reset flag for next user interaction
      return;
    }
    
    // Skip if user just manually selected a stat (handleStatSelect already updated URL)
    if (userSelectedStatRef.current) {
      userSelectedStatRef.current = false; // Reset after one check
      return;
    }
    
    // Skip if this is the initial mount and we haven't processed URL yet
    if (!hasUsedInitialStatRef.current) {
      return;
    }
    
    // Update URL with current stat (only for non-user-initiated changes)
    if (typeof window !== 'undefined' && router) {
      const url = new URL(window.location.href);
      const currentStat = url.searchParams.get('stat');
      
      // Only update if different to avoid unnecessary navigation
      if (currentStat !== selectedStat) {
        url.searchParams.set('stat', selectedStat);
        // Use replace to avoid adding to history
        router.replace(url.pathname + url.search, { scroll: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStat]); // router is stable, don't need it in deps

  // Ensure correct default stat is set when propsMode changes (but not when user clicks stats)
  useEffect(() => {
    // Skip if user manually selected a stat (don't override user choice)
    if (userSelectedStatRef.current) {
      userSelectedStatRef.current = false; // Reset after one check
      return;
    }
    
    // Skip if we have an initial stat from URL (don't override it, even if URL was changed)
    // But only if we haven't used it yet - after first use, always respect URL
    if (initialStatFromUrlRef.current && !hasUsedInitialStatRef.current) {
      return;
    }
    
    // Check if there's a stat in the URL - if so, don't override it
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const urlStat = url.searchParams.get('stat');
      if (urlStat) {
        return;
      }
    }
    
    // Skip if stat was set from URL (don't override it)
    if (statFromUrlRef.current) {
      statFromUrlRef.current = false; // Reset flag after skipping once
      return;
    }
    
    if (propsMode === 'player') {
      // Force non-Pro users back to Game Props mode
      if (!isPro) {
        setPropsMode('team');
        setSelectedStat('total_pts');
        return;
      }
      
      // Clear opponent when switching to player mode (player props don't have opponents)
      setOpponentTeam('');
      
      // Set default stat ONLY if current stat is invalid for player mode
      // Don't reset if user has a valid stat selected
      const playerStatExists = PLAYER_STAT_OPTIONS.find(s => s.key === selectedStat);
      if (!playerStatExists && selectedStat !== 'pts') {
        setSelectedStat('pts');
      }
    } else if (propsMode === 'team') {
      // Only change if current stat is invalid for team mode; default to total_pts for Game Props
      const teamStatExists = TEAM_STAT_OPTIONS.find(s => s.key === selectedStat);
      if (!teamStatExists && selectedStat !== 'total_pts') {
        setSelectedStat('total_pts');
      }
    }
  }, [propsMode, isPro, selectedStat, setSelectedStat, setPropsMode, setOpponentTeam, statFromUrlRef, userSelectedStatRef]);

  // Wrapper for setSelectedStat that marks it as a user selection and updates URL immediately
  const handleStatSelect = useCallback((stat: string) => {
    userSelectedStatRef.current = true; // Mark as user selection
    setSelectedStat(stat);
    // Debug logging removed(`[Dashboard] 👤 User selected stat: "${stat}"`);
    
    // Update URL immediately to prevent race conditions
    if (typeof window !== 'undefined' && router) {
      const url = new URL(window.location.href);
      url.searchParams.set('stat', stat);
      router.replace(url.pathname + url.search, { scroll: false });
      // Debug logging removed(`[Dashboard] 🔄 Immediately updated URL stat parameter to: "${stat}"`);
      
      // Mark that URL was updated by user, so useSearchParams doesn't override it
      statFromUrlRef.current = true;
      
      // Reset the user selection flag after a short delay to allow URL to update
      // This prevents useSearchParams from reading the old URL value
      setTimeout(() => {
        userSelectedStatRef.current = false;
        // Debug logging removed(`[Dashboard] ✅ Reset user selection flag after URL update`);
      }, 100); // 100ms should be enough for router.replace to complete
    }
  }, [setSelectedStat, router, statFromUrlRef, userSelectedStatRef]);

  return {
    handleStatSelect,
  };
}

