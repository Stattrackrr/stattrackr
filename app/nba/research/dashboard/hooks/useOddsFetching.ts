import { useEffect, useRef, startTransition } from 'react';
import { BookRow } from '../types';
import { NBAPlayer } from '@/lib/nbaPlayers';

export interface UseOddsFetchingParams {
  propsMode: 'player' | 'team';
  selectedPlayer: NBAPlayer | null;
  gamePropsTeam: string;
  realOddsData: BookRow[];
  oddsLoading: boolean;
  setRealOddsData: (data: BookRow[] | ((prev: BookRow[]) => BookRow[])) => void;
  setOddsLoading: (loading: boolean) => void;
  setOddsError: (error: string | null) => void;
}

/**
 * Custom hook to manage odds fetching logic
 */
export function useOddsFetching({
  propsMode,
  selectedPlayer,
  gamePropsTeam,
  realOddsData,
  oddsLoading,
  setRealOddsData,
  setOddsLoading,
  setOddsError,
}: UseOddsFetchingParams) {
  // Track if odds are currently being fetched to prevent duplicate calls
  const isFetchingOddsRef = useRef(false);
  // Track a single retry for missing team metadata (team mode)
  const missingTeamMetaRetryRef = useRef(false);
  // Track last odds fetch key to avoid refetching when data already present
  const lastOddsFetchKeyRef = useRef<string | null>(null);
  // Track the last player ID (or name fallback) to prevent unnecessary odds fetches
  const lastOddsPlayerIdRef = useRef<string | null>(null);
  // Track last propsMode to detect mode changes
  const lastPropsModeRef = useRef<'player' | 'team' | null>(null);

  const fetchOddsData = async (retryCount = 0) => {
    setOddsLoading(true);
    setOddsError(null);
    
    try {
      let params;
      
      if (propsMode === 'player') {
        // In player mode, fetch player's props by player name
        const playerName = selectedPlayer?.full || `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
        if (!playerName || !selectedPlayer) {
          // Don't clear odds here - let the player ID tracking useEffect handle clearing
          // This prevents clearing odds when player is temporarily null during state updates
          setOddsLoading(false);
          return;
        }
        params = new URLSearchParams({ player: playerName });
      } else {
        // In team mode, fetch game odds by team
        if (!gamePropsTeam || gamePropsTeam === 'N/A') {
          setRealOddsData([]);
          setOddsLoading(false);
          return;
        }
        params = new URLSearchParams({ team: gamePropsTeam });
        // Add refresh parameter if this is a retry due to missing metadata
        if (retryCount > 0) {
          params.set('refresh', '1');
        }
      }
      
      const response = await fetch(`/api/odds?${params}`);
      const data = await response.json();
      
      console.log('[fetchOddsData] API response:', {
        success: data.success,
        dataLength: data.data?.length || 0,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
        propsMode,
        gamePropsTeam,
        hasLoading: !!data.loading
      });
      
      // Handle background loading state
      if (data.loading) {
        // Data is loading in background - retry with exponential backoff (max 5 retries)
        if (retryCount < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // 1s, 2s, 4s, 8s, 10s max
          setTimeout(() => {
            fetchOddsData(retryCount + 1);
          }, delay);
        } else {
          // Max retries reached - stop loading
          setOddsLoading(false);
          setOddsError('Odds data taking longer than expected to load');
        }
        return;
      }
      
      if (!data.success) {
        // If odds API key is not configured, treat as no-data without error noise
        if (data.error && /odds api key not configured/i.test(data.error)) {
          setRealOddsData([]);
          setOddsError(null);
          return;
        }
        // Also treat 'waiting for refresh' as no error
        if (data.error && /waiting for refresh/i.test(data.error)) {
          setRealOddsData([]);
          setOddsError(null);
          return;
        }
        // Handle rate limit errors gracefully - keep existing data if available
        if (data.error && (/rate limit/i.test(data.error) || /429/i.test(data.error))) {
          // If we have cached data, keep showing it instead of error
          if (realOddsData.length > 0) {
            console.warn('[fetchOddsData] Rate limit hit, but keeping existing cached data');
            setOddsError('Rate limit exceeded - showing cached data');
            setOddsLoading(false);
            return;
          }
          // No cached data - show error but don't clear existing data
          setOddsError(data.error || 'Rate limit exceeded. Please wait a moment.');
          setOddsLoading(false);
          return;
        }
        setOddsError(data.error || 'Failed to fetch odds');
        setRealOddsData([]);
        return;
      }
      
      // If team mode and metadata is missing, trigger a single refresh; otherwise proceed without metadata
      if (propsMode === 'team' && (!data.homeTeam || !data.awayTeam) && data.data && data.data.length > 0) {
        console.log('[fetchOddsData] Missing team metadata - triggering cache refresh...');
        if (!missingTeamMetaRetryRef.current) {
          missingTeamMetaRetryRef.current = true;
          // Trigger a refresh with the refresh parameter
          const refreshParams = new URLSearchParams();
          if (gamePropsTeam) refreshParams.set('team', gamePropsTeam);
          refreshParams.set('refresh', '1');
          
          // Retry after a short delay to allow cache to refresh
          setTimeout(() => {
            fetchOddsData(retryCount + 1);
          }, 2000);
          return;
        } else {
          console.log('[fetchOddsData] Metadata still missing after retry, proceeding without team metadata');
          // Proceed with oddsData even without team metadata
        }
      }
      
      const oddsData = data.data || [];
      
      // Store home/away teams for team mode BEFORE setting state (to avoid multiple updates)
      if (propsMode === 'team' && data.homeTeam && data.awayTeam) {
        // Store these in a way we can access in BestOddsTable
        // We'll add them to each bookmaker as metadata
        if (oddsData.length > 0) {
          console.log('[fetchOddsData] Setting game teams:', {
            homeTeam: data.homeTeam,
            awayTeam: data.awayTeam,
            gamePropsTeam,
            bookCount: oddsData.length
          });
          oddsData.forEach((book: any) => {
            if (!book.meta) book.meta = {};
            book.meta.gameHomeTeam = data.homeTeam;
            book.meta.gameAwayTeam = data.awayTeam;
          });
        } else {
          console.log('[fetchOddsData] No bookmakers in data, cannot set team metadata');
        }
      } else if (propsMode === 'team') {
        console.log('[fetchOddsData] Not setting team metadata:', {
          propsMode,
          hasHomeTeam: !!data.homeTeam,
          hasAwayTeam: !!data.awayTeam
        });
      }
      
      console.log('[fetchOddsData] Setting realOddsData:', {
        length: oddsData.length,
        sampleBook: oddsData[0] ? {
          name: oddsData[0].name,
          hasPRA: !!oddsData[0].PRA,
          PRA: oddsData[0].PRA,
          hasPTS: !!oddsData[0].PTS,
          hasREB: !!oddsData[0].REB,
          hasAST: !!oddsData[0].AST,
        } : null
      });
      
      // Update odds in a transition to prevent visible refresh
      // Only update if data has actually changed (check length and first book name)
      console.log('[DEBUG fetchOddsData] About to set realOddsData', {
        oddsDataLength: oddsData.length,
        timestamp: new Date().toISOString()
      });
      
      startTransition(() => {
        setRealOddsData(prevOdds => {
          // Quick check: if length is same and first book is same, likely no change
          if (prevOdds.length === oddsData.length && 
              prevOdds.length > 0 && oddsData.length > 0 &&
              prevOdds[0]?.name === oddsData[0]?.name &&
              prevOdds[0]?.PTS?.line === oddsData[0]?.PTS?.line) {
            // Likely the same data, but do a full comparison to be sure
            const prevStr = JSON.stringify(prevOdds);
            const newStr = JSON.stringify(oddsData);
            if (prevStr === newStr) {
              console.log('[DEBUG fetchOddsData] Odds data unchanged, skipping update');
              return prevOdds; // No change, return previous to prevent re-render
            }
          }
          console.log('[DEBUG fetchOddsData] Updating realOddsData', {
            prevLength: prevOdds.length,
            newLength: oddsData.length
          });
          return oddsData;
        });
      });
      
      const playerName = selectedPlayer?.full || `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
      const target = propsMode === 'player' ? playerName : gamePropsTeam;
      console.log(`📊 Loaded ${data.data?.length || 0} bookmaker odds for ${target}`);
      
      // Debug: Check for PrizePicks in the data
      const allBookmakers = new Set<string>();
      const prizepicksEntries: any[] = [];
      (data.data || []).forEach((book: any) => {
        const bookName = (book?.meta?.baseName || book?.name || '').toLowerCase();
        if (bookName) {
          allBookmakers.add(bookName);
          if (bookName.includes('prizepicks')) {
            prizepicksEntries.push({
              name: book?.meta?.baseName || book?.name,
              stat: book?.meta?.stat,
              variantLabel: book?.meta?.variantLabel,
              isPickem: book?.meta?.isPickem,
              pts: book?.PTS,
            });
          }
        }
      });
      
    } catch (error) {
      console.error('Error fetching odds:', error);
      setOddsError(error instanceof Error ? error.message : 'Failed to load odds');
      setRealOddsData([]);
    } finally {
      setOddsLoading(false);
    }
  };

  // Clear odds and reset fetch refs when propsMode changes
  useEffect(() => {
    if (lastPropsModeRef.current !== null && lastPropsModeRef.current !== propsMode) {
      console.log('[DEBUG propsMode change] Clearing odds and resetting refs', {
        oldMode: lastPropsModeRef.current,
        newMode: propsMode
      });
      setRealOddsData([]);
      setOddsLoading(false);
      setOddsError(null);
      lastOddsFetchKeyRef.current = null;
      lastOddsPlayerIdRef.current = null;
      isFetchingOddsRef.current = false;
      missingTeamMetaRetryRef.current = false;
    }
    lastPropsModeRef.current = propsMode;
  }, [propsMode, setRealOddsData, setOddsLoading, setOddsError]);

  // Reset fetch refs when player changes (to ensure fresh fetch from props page)
  // Only depend on player ID, not the whole object, to prevent refetch on metadata updates
  const playerId = propsMode === 'player' && selectedPlayer 
    ? (selectedPlayer.id?.toString() || (selectedPlayer.full ? selectedPlayer.full.toLowerCase() : null))
    : null;
  
  useEffect(() => {
    if (propsMode === 'player' && playerId) {
      // If player changed, reset refs to ensure fresh fetch
      if (playerId !== lastOddsPlayerIdRef.current) {
        console.log('[DEBUG player change] Resetting odds fetch refs for new player', {
          currentPlayerKey: playerId,
          lastPlayerKey: lastOddsPlayerIdRef.current
        });
        // Don't clear odds data here - let the fetch happen first
        // But reset the fetch key so it doesn't skip
        lastOddsFetchKeyRef.current = null;
      }
    }
  }, [propsMode, playerId]);

  // Fetch odds when player/team or mode changes - with debouncing to prevent rate limits
  // Use playerId instead of selectedPlayer to prevent refetch on metadata updates
  useEffect(() => {
    console.log('[DEBUG fetchOdds useEffect] Triggered', {
      propsMode,
      playerId,
      gamePropsTeam,
      realOddsDataLength: realOddsData.length,
      lastOddsPlayerId: lastOddsPlayerIdRef.current,
      isFetching: isFetchingOddsRef.current
    });
    
    // Reset missing metadata retry on dependency change
    missingTeamMetaRetryRef.current = false;
    
    // For team mode, add a small delay to ensure gamePropsTeam is set
    if (propsMode === 'team' && !gamePropsTeam) {
      console.log('[DEBUG fetchOdds useEffect] Team mode but no gamePropsTeam, skipping');
      return;
    }
    
    // In player mode, use playerId (extracted from selectedPlayer.id)
    if (propsMode === 'player') {
      if (playerId) {
        // Check if we need to fetch - only skip if same player AND we have odds data
        // This ensures we fetch when coming from props page (odds are empty)
        const hasOddsForPlayer = playerId === lastOddsPlayerIdRef.current && realOddsData.length > 0;
        if (hasOddsForPlayer) {
          console.log('[DEBUG fetchOdds useEffect] Same player and odds exist, skipping fetch', {
            currentPlayerKey: playerId,
            lastOddsPlayerId: lastOddsPlayerIdRef.current,
            realOddsDataLength: realOddsData.length
          });
          return;
        }
        // Player changed or no odds - update ref and fetch
        console.log('[DEBUG fetchOdds useEffect] Player key changed or no odds, will fetch', {
          currentPlayerKey: playerId,
          lastOddsPlayerId: lastOddsPlayerIdRef.current,
          realOddsDataLength: realOddsData.length,
          playerChanged: playerId !== lastOddsPlayerIdRef.current
        });
        lastOddsPlayerIdRef.current = playerId;
      } else {
        // No usable key; ensure ref resets so next valid player triggers fetch
        console.log('[DEBUG fetchOdds useEffect] No usable player key, resetting ref');
        lastOddsPlayerIdRef.current = null;
        return; // No player ID; skip fetch
      }
    }
    
    // Build fetch key (player or team)
    const fetchKey = propsMode === 'team'
      ? `team:${gamePropsTeam || 'na'}`
      : `player:${playerId || 'na'}`;

    // CRITICAL: Always fetch if we have no odds data (e.g., coming from props page)
    // This ensures odds are loaded on initial page load
    if (realOddsData.length === 0) {
      console.log('[DEBUG fetchOdds useEffect] No odds data, will fetch immediately', {
        fetchKey,
        lastFetchKey: lastOddsFetchKeyRef.current
      });
      // Reset fetch key ref to ensure we don't skip
      lastOddsFetchKeyRef.current = null;
    } else {
      // Skip if already fetching
      if (isFetchingOddsRef.current) {
        console.log('[DEBUG fetchOdds useEffect] Already fetching, skipping');
        return;
      }
      
      // If we already have odds for this key and not loading, skip refetch
      if (fetchKey === lastOddsFetchKeyRef.current && !oddsLoading) {
        console.log('[DEBUG fetchOdds useEffect] Odds already loaded for key, skipping fetch', {
          fetchKey,
          realOddsDataLength: realOddsData.length
        });
        return;
      }
      
      // If we're already fetching for this key, skip
      if (fetchKey === lastOddsFetchKeyRef.current && isFetchingOddsRef.current) {
        console.log('[DEBUG fetchOdds useEffect] Already fetching for this key, skipping');
        return;
      }
    }
    
    // For initial load (no odds data), fetch immediately without any delay
    // This ensures odds are fetched instantly when coming from props page
    const isInitialLoad = realOddsData.length === 0;
    const debounceDelay = isInitialLoad ? 0 : 300;
    
    console.log('[DEBUG fetchOdds useEffect] Fetching odds', {
      fetchKey,
      lastFetchKey: lastOddsFetchKeyRef.current,
      realOddsDataLength: realOddsData.length,
      isInitialLoad,
      debounceDelay
    });
    
    // For initial load, fetch immediately without setTimeout
    if (isInitialLoad) {
      console.log('[DEBUG fetchOdds useEffect] Initial load - fetching immediately');
      isFetchingOddsRef.current = true;
      lastOddsFetchKeyRef.current = fetchKey;
      fetchOddsData().finally(() => {
        // Reset flag after a delay to allow for retries
        setTimeout(() => {
          isFetchingOddsRef.current = false;
        }, 1000);
      });
      return;
    }
    
    // For subsequent loads, use debounce
    const timeoutId = setTimeout(() => {
      console.log('[DEBUG fetchOdds useEffect] Timeout fired, starting fetch');
      isFetchingOddsRef.current = true;
      lastOddsFetchKeyRef.current = fetchKey;
      fetchOddsData().finally(() => {
        // Reset flag after a delay to allow for retries
        setTimeout(() => {
          isFetchingOddsRef.current = false;
        }, 1000);
      });
    }, debounceDelay);
    
    return () => {
      console.log('[DEBUG fetchOdds useEffect] Cleanup: clearing timeout');
      clearTimeout(timeoutId);
      // Don't reset isFetchingOddsRef here - let it be reset by the finally block
      // This prevents race conditions where cleanup runs before fetch completes
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, gamePropsTeam, propsMode]);

  return { fetchOddsData };
}

