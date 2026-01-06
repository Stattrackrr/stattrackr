import { useEffect, useRef } from 'react';

export interface UseCoreDataReadyParams {
  isLoading: boolean;
  playerStats: any[];
  setCoreDataReady: (ready: boolean) => void;
}

/**
 * Custom hook to track when core data (player stats) is ready
 */
export function useCoreDataReady({
  isLoading,
  playerStats,
  setCoreDataReady,
}: UseCoreDataReadyParams) {
  const coreDataReadySetRef = useRef(false);
  const lastPlayerStatsLengthRef = useRef(0);

  useEffect(() => {
    // Reset when loading starts or no stats yet
    if (isLoading || playerStats.length === 0) {
      setCoreDataReady(false);
      coreDataReadySetRef.current = false;
      lastPlayerStatsLengthRef.current = 0;
      return;
    }

    // Only run when playerStats length actually changes (new player selected)
    if (playerStats.length === lastPlayerStatsLengthRef.current && coreDataReadySetRef.current) {
      return;
    }

    // Update ref to track current stats length
    lastPlayerStatsLengthRef.current = playerStats.length;

    // If we've already set coreDataReady for this player, don't re-run
    if (coreDataReadySetRef.current) {
      return;
    }

    // Set coreDataReady immediately - odds will render inline without causing refresh
    setCoreDataReady(true);
    coreDataReadySetRef.current = true;
  }, [playerStats.length, isLoading, setCoreDataReady]);
}


