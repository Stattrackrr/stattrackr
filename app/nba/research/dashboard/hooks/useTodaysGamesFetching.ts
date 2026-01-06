'use client';

import { useState, useRef, useCallback } from 'react';
import { fetchTodaysGamesCore } from '../utils/fetchTodaysGamesUtils';

export function useTodaysGamesFetching() {
  // Games state
  const [todaysGames, setTodaysGames] = useState<any[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const gamesFetchInFlightRef = useRef(false);

  // Fetch games function (today ± 7 days) - now imported from utils
  const fetchTodaysGames = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    return await fetchTodaysGamesCore({
      silent,
      onLoadingChange: setGamesLoading,
      onGamesChange: setTodaysGames,
      isFetchInFlight: () => gamesFetchInFlightRef.current,
      setFetchInFlight: (inFlight) => { gamesFetchInFlightRef.current = inFlight; },
    });
  }, []);

  return {
    todaysGames,
    setTodaysGames,
    gamesLoading,
    setGamesLoading,
    fetchTodaysGames,
  };
}

