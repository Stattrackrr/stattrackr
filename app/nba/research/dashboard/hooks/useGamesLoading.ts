import { useEffect } from 'react';

export interface UseGamesLoadingParams {
  fetchTodaysGames: (options?: { silent?: boolean }) => void;
}

/**
 * Custom hook to handle games loading on mount and visibility changes
 */
export function useGamesLoading({
  fetchTodaysGames,
}: UseGamesLoadingParams) {
  // Load games IMMEDIATELY on mount (before any other effects run)
  // This ensures games are available when player is selected from props page
  useEffect(() => {
    // Fetch games immediately (non-blocking, but starts right away)
    fetchTodaysGames();
    
    // Also refresh every minute
    const id = setInterval(() => {
      fetchTodaysGames({ silent: true });
    }, 60 * 1000);
    return () => {
      clearInterval(id);
    };
  }, [fetchTodaysGames]);

  // Refresh games when tab becomes visible
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchTodaysGames({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchTodaysGames]);
}


