import { BallDontLieGame } from '../types';
import { cachedFetch } from '@/lib/requestCache';

export interface FetchTodaysGamesOptions {
  silent?: boolean;
  onLoadingChange?: (loading: boolean) => void;
  onGamesChange?: (games: BallDontLieGame[]) => void;
  isFetchInFlight?: () => boolean;
  setFetchInFlight?: (inFlight: boolean) => void;
}

/**
 * Fetch today's games (today ± 7 days) with caching
 */
export async function fetchTodaysGamesCore(options: FetchTodaysGamesOptions = {}): Promise<BallDontLieGame[]> {
  const {
    silent = false,
    onLoadingChange,
    onGamesChange,
    isFetchInFlight,
    setFetchInFlight,
  } = options;

  if (isFetchInFlight?.()) {
    return [];
  }
  
  setFetchInFlight?.(true);

  try {
    if (!silent && onLoadingChange) {
      onLoadingChange(true);
    }
    
    const formatDate = (date: Date) => {
      return date.toISOString().split('T')[0];
    };
    
    // Fetch only a small date range (today ± 7 days) to avoid season paging
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];

    // Check sessionStorage first for instant load (if prefetched)
    if (typeof window !== 'undefined') {
      try {
        const cacheKey = `dashboard-games-${start}-${end}`;
        const cachedData = sessionStorage.getItem(cacheKey);
        const cachedTimestamp = sessionStorage.getItem(`${cacheKey}-timestamp`);
        const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
        
        if (cachedData && cachedTimestamp) {
          const age = Date.now() - parseInt(cachedTimestamp, 10);
          if (age < CACHE_TTL_MS) {
            try {
              const parsed = JSON.parse(cachedData);
              if (Array.isArray(parsed) && parsed.length > 0) {
                // Using cached games from sessionStorage
                if (onGamesChange) {
                  onGamesChange(parsed);
                }
                if (!silent && onLoadingChange) {
                  onLoadingChange(false);
                }
                setFetchInFlight?.(false);
                // Still fetch in background to update if needed (non-blocking)
                cachedFetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`, undefined, 30 * 60 * 1000).then(async (data: any) => {
                  if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
                    if (onGamesChange) {
                      onGamesChange(data.data);
                    }
                    sessionStorage.setItem(cacheKey, JSON.stringify(data.data));
                    sessionStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
                  }
                }).catch(() => {});
                return parsed;
              }
            } catch (e) {
              // Failed to parse cached games data, fetching fresh
            }
          }
        }
      } catch (e) {
        // Ignore sessionStorage errors, continue to fetch
      }
    }

    try {
      const data = await cachedFetch<{ data: BallDontLieGame[] }>(
        `/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`,
        undefined,
        30 * 60 * 1000 // Cache for 30 minutes
      );
      const arr = Array.isArray(data?.data) ? data.data : [];
      if (arr.length > 0) {
        // Fetched games from API
        if (onGamesChange) {
          onGamesChange(arr);
        }
        // Cache for next time
        if (typeof window !== 'undefined') {
          try {
            const cacheKey = `dashboard-games-${start}-${end}`;
            sessionStorage.setItem(cacheKey, JSON.stringify(arr));
            sessionStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
          } catch (e) {
            // Ignore storage errors
          }
        }
        return arr;
      }
    } catch (e) {
      console.error('Error fetching date-range games:', e);
    }

    // No games found in date range
    if (onGamesChange) {
      onGamesChange([]);
    }
    return [];
    
  } catch (error) {
    console.error('Error in fetchTodaysGames:', error);
    if (onGamesChange) {
      onGamesChange([]);
    }
    return [];
  } finally {
    setFetchInFlight?.(false);
    if (!silent && onLoadingChange) {
      onLoadingChange(false);
    }
  }
}

