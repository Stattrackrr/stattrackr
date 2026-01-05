import { BallDontLieGame } from '../types';

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
                console.log(`✅ Using cached games from sessionStorage (${parsed.length} games, ${Math.round(age / 1000)}s old)`);
                if (onGamesChange) {
                  onGamesChange(parsed);
                }
                if (!silent && onLoadingChange) {
                  onLoadingChange(false);
                }
                setFetchInFlight?.(false);
                // Still fetch in background to update if needed (non-blocking)
                fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`, { cache: 'default' }).then(async (response) => {
                  if (response.ok) {
                    const data = await response.json();
                    if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
                      if (onGamesChange) {
                        onGamesChange(data.data);
                      }
                      sessionStorage.setItem(cacheKey, JSON.stringify(data.data));
                      sessionStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
                    }
                  }
                }).catch(() => {});
                return parsed;
              }
            } catch (e) {
              console.warn('Failed to parse cached games data, fetching fresh');
            }
          }
        }
      } catch (e) {
        // Ignore sessionStorage errors, continue to fetch
      }
    }

    try {
      const response = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`);
      const data = await response.json();
      const arr = Array.isArray(data?.data) ? data.data : [];
      if (arr.length > 0) {
        console.log(`✅ Fetched ${arr.length} games from ${start} to ${end}`);
        console.log(`   Games: ${arr.map((g: any) => `${g.home_team?.abbreviation} vs ${g.visitor_team?.abbreviation}`).join(', ')}`);
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

    console.log('❌ No games found in date range');
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

