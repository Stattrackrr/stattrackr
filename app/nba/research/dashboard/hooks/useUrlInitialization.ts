import { useEffect, useRef, startTransition } from 'react';
import { BdlSearchResult, SavedSession, SESSION_KEY } from '../types';
import { getSavedSession } from '../utils/storageUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';

export interface UseUrlInitializationParams {
  propsMode: 'player' | 'team';
  setPropsMode: (mode: 'player' | 'team') => void;
  setSelectedStat: (stat: string) => void;
  setSelectedTimeframe: (timeframe: string) => void;
  setBettingLines: (lines: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  setGamePropsTeam: (team: string) => void;
  setSelectedPlayer: (player: any) => void;
  setSelectedTeam: (team: string) => void;
  setOriginalPlayerTeam: (team: string) => void;
  setDepthChartTeam: (team: string) => void;
  setResolvedPlayerId: (id: string) => void;
  setPlayerStats: (stats: any[]) => void;
  setIsLoading: (loading: boolean) => void;
  setApiError: (error: string | null) => void;
  setManualOpponent?: (opponent: string) => void;
  setOpponentTeam?: (team: string) => void;
  playerStats: any[];
  handlePlayerSelectFromSearch: (result: BdlSearchResult) => Promise<void>;
  fetchTodaysGames?: (options?: { silent?: boolean }) => void;
  statFromUrlRef: React.MutableRefObject<boolean>;
}

/**
 * Custom hook to handle URL parameter initialization and session storage restoration
 */
export function useUrlInitialization({
  propsMode,
  setPropsMode,
  setSelectedStat,
  setSelectedTimeframe,
  setBettingLines,
  setGamePropsTeam,
  setSelectedPlayer,
  setSelectedTeam,
  setOriginalPlayerTeam,
  setDepthChartTeam,
  setResolvedPlayerId,
  setPlayerStats,
  setIsLoading,
  setApiError,
  setManualOpponent,
  setOpponentTeam,
  playerStats,
  handlePlayerSelectFromSearch,
  fetchTodaysGames,
  statFromUrlRef,
}: UseUrlInitializationParams) {
  useEffect(() => {
    // OPTIMIZATION: Pre-fetch games immediately if coming from props page
    // This ensures games are available when player is selected, reducing wait time
    if (fetchTodaysGames && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const hasPlayerParam = url.searchParams.has('player') || url.searchParams.has('pid') || url.searchParams.has('name');
      if (hasPlayerParam) {
        fetchTodaysGames({ silent: true }); // Silent to avoid loading state flicker
      }
    }
    let initialPropsMode: 'player' | 'team' = 'player';
    let shouldLoadDefaultPlayer = true;
    

    // First, restore propsMode from session storage
    try {
      const raw = getSavedSession();
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedSession> & { gamePropsTeam?: string };
        if (saved?.propsMode && (saved.propsMode === 'player' || saved.propsMode === 'team')) {
          initialPropsMode = saved.propsMode;
          setPropsMode(saved.propsMode);
          
          // Restore gamePropsTeam if in team mode
          if (saved.propsMode === 'team' && saved.gamePropsTeam && saved.gamePropsTeam !== 'N/A') {
            setGamePropsTeam(saved.gamePropsTeam);
          }
        }
        // Don't restore stat from session storage if there's a stat in the URL (URL takes precedence)
        const urlHasStat = typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('stat') : null;
        if (saved?.selectedStat && !urlHasStat) {
          setSelectedStat(saved.selectedStat);
        }
        // Only restore selectedTimeframe if we have playerStats loaded (prevents race condition)
        // If playerStats is empty, don't restore timeframe yet - wait for stats to load first
        if (saved?.selectedTimeframe && playerStats.length > 0) {
          setSelectedTimeframe(saved.selectedTimeframe);
        }
      }
    } catch {}

    // Then check URL parameters (can override session storage)
    try {
      if (typeof window !== 'undefined') {
        // Capture initial URL IMMEDIATELY to prevent race conditions
        const initialUrl = window.location.href;
        const url = new URL(initialUrl);
        const pid = url.searchParams.get('pid');
        const name = url.searchParams.get('name');
        const player = url.searchParams.get('player'); // Support 'player' param (from player props page)
        const team = url.searchParams.get('team') || undefined;
        const stat = url.searchParams.get('stat');
        const line = url.searchParams.get('line');
        const tf = url.searchParams.get('tf');
        const mode = url.searchParams.get('mode');
        const opponent = url.searchParams.get('opponent');

        // Set opponent from URL (e.g. from "View on dashboard" in daily pick)
        if (opponent && setManualOpponent && setOpponentTeam) {
          const normOpp = normalizeAbbr(opponent.trim());
          if (normOpp) {
            setManualOpponent(normOpp);
            setOpponentTeam(normOpp);
          }
        }

        // Set stat from URL FIRST (before propsMode) to prevent default stat logic from overriding it
        if (stat) {
          // Normalize stat from props page format (uppercase) to dashboard format (lowercase)
          // Also handle special cases like "THREES" -> "fg3m"
          const normalizedStat = (() => {
            const statUpper = stat.toUpperCase();
            // Map special cases first
            if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
              return 'fg3m';
            }
            // Convert uppercase to lowercase for standard stats
            // Props page uses: PTS, REB, AST, STL, BLK, PRA, PA, PR, RA
            // Dashboard expects: pts, reb, ast, stl, blk, pra, pa, pr, ra
            return stat.toLowerCase();
          })();
          
          // Set flag to prevent default stat logic from overriding
          statFromUrlRef.current = true;
          setSelectedStat(normalizedStat);
          
          // Store in session storage to persist across player loading
          const saved = getSavedSession();
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedStat = normalizedStat;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
          
          // If line is provided, set it for this stat (use normalized stat for the key)
          // Only set if the stat in URL matches the normalized stat (prevents wrong stat's line)
          if (line && stat) {
            const urlStatNormalized = (() => {
              const statUpper = stat.toUpperCase();
              if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
                return 'fg3m';
              }
              return stat.toLowerCase();
            })();
            
            // Only use the line if the URL stat matches the normalized stat
            if (urlStatNormalized === normalizedStat) {
              const lineValue = parseFloat(line);
              if (!isNaN(lineValue)) {
                setBettingLines(prev => ({
                  ...prev,
                  [normalizedStat]: Math.abs(lineValue) // Use absolute value (line can be negative for under props)
                }));
              }
            }
          }
        }
        
        // Set propsMode AFTER stat (so default stat logic can see the URL stat)
        if (mode === 'team' || mode === 'player') {
          initialPropsMode = mode;
          setPropsMode(mode);
        }
        
        // Handle 'player' param (from player props page) - use it if 'name' is not provided
        const playerName = name || player;
        // When coming from player props page, default to "thisseason" to show current season data
        // ALWAYS override "thisseason" from URL to use "last10" as default
        // Only use URL timeframe if it's NOT "thisseason"
        if (tf && tf !== 'thisseason') {
          // Set timeframe immediately from URL (don't wait for stats to load)
          // This ensures the correct timeframe is active when stats load
          setSelectedTimeframe(tf);
          // Also store it in session storage for persistence
          const saved = getSavedSession();
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedTimeframe = tf;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
        } else {
          // ALWAYS default to last10 (override "thisseason" from URL or when no URL param)
          setSelectedTimeframe('last10');
          // Update URL to reflect the change
          if (typeof window !== 'undefined') {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('tf', 'last10');
            window.history.replaceState({}, '', newUrl.toString());
          }
          // Store in session storage
          const saved = getSavedSession();
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedTimeframe = 'last10';
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
        }
        
        // Handle player selection - support both 'pid+name' and 'player' params
        if (false) { // Disabled - moved below
          // Coming from player props page without explicit timeframe - default to last10
          setSelectedTimeframe('last10');
          // Store in session storage
          if (typeof window !== 'undefined') {
            const saved = sessionStorage.getItem(SESSION_KEY);
            if (saved !== null) {
              try {
                const parsed = JSON.parse(saved as string);
                parsed.selectedTimeframe = 'last10';
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
              } catch {}
            }
          }
        }
        // Handle player selection - support both 'pid+name' and 'player' params
        if (pid && playerName) {
          const r: BdlSearchResult = { id: Number(pid), full: playerName, team, pos: undefined };
          if (initialPropsMode === 'player') {
            handlePlayerSelectFromSearch(r);
            shouldLoadDefaultPlayer = false;
            return;
          }
        } else if (playerName && !pid) {
          // If only 'player' name is provided (from player props page), search for the player
          if (initialPropsMode === 'player') {
            // OPTIMIZATION: Show player name immediately from URL (optimistic UI)
            // This prevents blank screen while searching
            const urlTeam = team ? normalizeAbbr(team) : '';
            startTransition(() => {
              setSelectedPlayer({
                id: '',
                full: playerName,
                firstName: playerName.split(' ')[0] || playerName,
                lastName: playerName.split(' ').slice(1).join(' ') || '',
                teamAbbr: urlTeam,
                jersey: '',
                heightFeet: null,
                heightInches: null,
                position: '',
              } as any);
              if (urlTeam) {
                setSelectedTeam(urlTeam);
                setOriginalPlayerTeam(urlTeam);
                setDepthChartTeam(urlTeam);
              }
            });
            
            // Set loading state immediately to prevent double render
            setIsLoading(true);
            // Trigger search for the player name
            const searchForPlayer = async () => {
              try {
                // OPTIMIZATION: Try all search variations in parallel instead of sequentially
                // This reduces search time from ~1.8s to ~0.6s (fastest response wins)
                const nameParts = playerName.trim().split(/\s+/);
                const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                
                const searchPromises = [
                  fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}`).catch(() => null),
                  fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}&all=true`).catch(() => null),
                ];
                
                // Only add last name search if we have a last name
                if (lastName && lastName !== playerName) {
                  searchPromises.push(
                    fetch(`/api/bdl/players?q=${encodeURIComponent(lastName)}&all=true`).catch(() => null)
                  );
                }
                
                // Wait for all searches, but use the first one that returns results
                const searchResponses = await Promise.all(searchPromises);
                let rawResults: any[] | null = null;
                let json: any = null;
                
                // Check searchResponses in order of preference (exact match first, then all=true, then last name)
                for (const res of searchResponses) {
                  if (!res || !res.ok) continue;
                  try {
                    json = await res.json();
                    rawResults = json?.results || json?.data;
                    if (Array.isArray(rawResults) && rawResults.length > 0) {
                      break; // Use first successful result
                    }
                  } catch (e) {
                    // Continue to next result
                  }
                }
                
                // Fallback: if no results, try the original sequential approach
                if (!rawResults || !Array.isArray(rawResults) || rawResults.length === 0) {
                  const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}`);
                  if (res.ok) {
                    json = await res.json();
                    rawResults = json?.results || json?.data;
                  }
                }
                
                const results: BdlSearchResult[] = Array.isArray(rawResults) && rawResults.length > 0
                  ? rawResults.map((r: any) => ({ 
                      id: r.id, 
                      full: r.full, 
                      team: r.team, 
                      pos: r.pos, 
                      headshotUrl: r.headshotUrl || null 
                    }))
                  : [];
                if (results && results.length > 0) {
                  // Try to find exact match first, then use first result
                  const playerNameLower = playerName.toLowerCase().trim();
                  let playerResult = results.find(r => r.full.toLowerCase().trim() === playerNameLower);
                  if (!playerResult) {
                    // Try partial match (first name or last name)
                    playerResult = results.find(r => {
                      const fullLower = r.full.toLowerCase().trim();
                      return fullLower.includes(playerNameLower) || playerNameLower.includes(fullLower);
                    });
                  }
                  // Fallback to first result
                  if (!playerResult) {
                    playerResult = results[0];
                  }
                  
                  const r: BdlSearchResult = {
                    id: playerResult.id,
                    full: playerResult.full,
                    team: playerResult.team,
                    pos: playerResult.pos
                  };
                  
                  // OPTIMIZATION: Show player immediately, then load stats in background
                  // This prevents the 5-7 second delay before any UI appears
                  const currentTeam = normalizeAbbr(r.team || '');
                  const pid = String(r.id);
                  
                  // Set player info immediately (optimistic UI)
                  // Don't clear stats here - let handlePlayerSelectFromSearch handle it
                  // This prevents the double render (clear then load)
                  startTransition(() => {
                    setSelectedPlayer({
                      id: pid,
                      full: r.full,
                      firstName: r.full.split(' ')[0] || r.full,
                      lastName: r.full.split(' ').slice(1).join(' ') || '',
                      teamAbbr: currentTeam,
                      jersey: '',
                      heightFeet: null,
                      heightInches: null,
                      position: r.pos || '',
                    } as any);
                    setSelectedTeam(currentTeam);
                    setOriginalPlayerTeam(currentTeam);
                    setDepthChartTeam(currentTeam);
                    setResolvedPlayerId(pid);
                    // Don't clear stats here - handlePlayerSelectFromSearch will handle clearing and loading
                    // This prevents the reset/re-render flicker
                  });
                  
                  // Now load stats in background without blocking
                  handlePlayerSelectFromSearch(r).catch(err => {
                    console.error('[Dashboard] Error loading player stats:', err);
                    setApiError(`Failed to load stats: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    setIsLoading(false);
                  });
                  shouldLoadDefaultPlayer = false;
                } else {
                  setApiError(`Player "${playerName}" not found. Please try searching manually.`);
                  setIsLoading(false); // Clear loading state if no results found
                }
              } catch (error) {
                console.error(`[Dashboard] Error searching for player "${playerName}":`, error);
                setApiError(`Error searching for player: ${error instanceof Error ? error.message : 'Unknown error'}`);
                setIsLoading(false); // Clear loading state on error
              }
            };
            // Await the search to ensure it completes before continuing
            searchForPlayer().catch(err => {
              console.error('[Dashboard] Unhandled error in searchForPlayer:', err);
              setApiError(`Failed to load player: ${err instanceof Error ? err.message : 'Unknown error'}`);
              setIsLoading(false); // Clear loading state on error
            });
            shouldLoadDefaultPlayer = false;
            // Don't return here - let the useEffect continue to set up other things
          }
        }
      }
    } catch (urlError) {
      console.error('[Dashboard] Error processing URL parameters:', urlError);
    }

    // Finally, restore saved player if in player mode
    if (initialPropsMode === 'player') {
      try {
        const raw = getSavedSession();
        if (raw) {
          const saved = JSON.parse(raw) as Partial<SavedSession & { playerCleared?: boolean }>;
          
          // If user deliberately cleared player data by switching modes, don't load default
          if (saved?.playerCleared) {
            shouldLoadDefaultPlayer = false;
            return;
          }
          
          // Only restore player data if the saved mode matches current mode
          if (saved?.propsMode === 'player') {
            const r = saved?.player as BdlSearchResult | undefined;
            if (r && r.id && r.full) {
              handlePlayerSelectFromSearch(r);
              shouldLoadDefaultPlayer = false;
              return;
            }
          }
        }
      } catch {}

      // Never auto-load any default player
      // Players should only be loaded when explicitly searched for or from URL sharing
    }
  }, []); // Only run once on mount
}

