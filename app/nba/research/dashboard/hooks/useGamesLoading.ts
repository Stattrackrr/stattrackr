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
  // Load games on mount and refresh every minute
  useEffect(() => {
    fetchTodaysGames();
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


