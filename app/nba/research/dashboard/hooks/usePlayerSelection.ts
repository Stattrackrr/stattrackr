import { useRef, useCallback } from 'react';
import { startTransition } from 'react';
import { NBAPlayer } from '@/lib/nbaPlayers';
import { BdlSearchResult } from '../types';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { getOpponentTeam } from '../utils/teamAnalysisUtils';
import { resolvePlayerId, fetchBdlPlayerData, parseBdlHeight, fetchEspnPlayerData, parseEspnHeight } from '../utils/playerDataUtils';
import { SAMPLE_PLAYERS } from '@/lib/nbaPlayers';
import { DepthChartData } from '../types';
import serverLogger from '@/lib/serverLogger';

export interface UsePlayerSelectionParams {
  // State setters
  setIsLoading: (loading: boolean) => void;
  setApiError: (error: string | null) => void;
  setAdvancedStats: (stats: any) => void;
  setShotDistanceData: (data: any) => void;
  setAdvancedStatsLoading: (loading: boolean) => void;
  setShotDistanceLoading: (loading: boolean) => void;
  setRealOddsData: (data: any[]) => void;
  setOddsSnapshots: (snapshots: any[]) => void;
  setLineMovementData: (data: any) => void;
  setOddsLoading: (loading: boolean) => void;
  setOddsError: (error: string | null) => void;
  setOpponentTeam: (team: string) => void;
  setResolvedPlayerId: (id: string) => void;
  setSelectedTimeframe: (timeframe: string) => void;
  setPlayerStats: (stats: any[]) => void;
  setSelectedTeam: (team: string) => void;
  setOriginalPlayerTeam: (team: string) => void;
  setDepthChartTeam: (team: string) => void;
  setSelectedPlayer: (player: NBAPlayer | null) => void;
  setBettingLines: (lines: (prev: Record<string, number>) => Record<string, number>) => void;
  setShowDropdown: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: BdlSearchResult[]) => void;
  
  // State values
  isLoading: boolean;
  hasPremium: boolean;
  selectedStat: string;
  todaysGames: any[];
  playerTeamRoster: DepthChartData | null;
  
  // Functions
  fetchSortedStats: (playerId: string) => Promise<any[]>;
  fetchAdvancedStats: (playerId: string) => Promise<void>;
  fetchShotDistanceStats: (playerId: string) => Promise<void>;
  
  // Refs
  lastAutoSetStatRef: React.MutableRefObject<string | null>;
  lastAutoSetLineRef: React.MutableRefObject<number | null>;
  hasManuallySetLineRef: React.MutableRefObject<boolean>;
  statFromUrlRef: React.MutableRefObject<boolean>;
}

/**
 * Custom hook for handling player selection from local sample players and search results
 */
export function usePlayerSelection(params: UsePlayerSelectionParams) {
  const {
    setIsLoading,
    setApiError,
    setAdvancedStats,
    setShotDistanceData,
    setAdvancedStatsLoading,
    setShotDistanceLoading,
    setRealOddsData,
    setOddsSnapshots,
    setLineMovementData,
    setOddsLoading,
    setOddsError,
    setOpponentTeam,
    setResolvedPlayerId,
    setSelectedTimeframe,
    setPlayerStats,
    setSelectedTeam,
    setOriginalPlayerTeam,
    setDepthChartTeam,
    setSelectedPlayer,
    setBettingLines,
    setShowDropdown,
    setSearchQuery,
    setSearchResults,
    isLoading,
    hasPremium,
    selectedStat,
    todaysGames,
    playerTeamRoster,
    fetchSortedStats,
    fetchAdvancedStats,
    fetchShotDistanceStats,
    lastAutoSetStatRef,
    lastAutoSetLineRef,
    hasManuallySetLineRef,
    statFromUrlRef,
  } = params;

  const isHandlingPlayerSelectRef = useRef(false);

  const handlePlayerSelectFromLocal = useCallback(async (player: NBAPlayer) => {
    setIsLoading(true);
    setApiError(null);
    
    // Clear premium stats immediately when switching players
    setAdvancedStats(null);
    setShotDistanceData(null);
    setAdvancedStatsLoading(false);
    setShotDistanceLoading(false);
    
    // Clear all odds data when switching players
    setRealOddsData([]);
    setOddsSnapshots([]);
    setLineMovementData(null);
    setOddsLoading(false);
    setOddsError(null);
    
    // Clear opponent team when switching players to force re-detection
    console.log(`[Player Select] Clearing opponent team for player switch to: ${player.full}`);
    setOpponentTeam('N/A');
    
    try {
      const pid = /^\d+$/.test(String(player.id)) ? String(player.id) : await resolvePlayerId(player.full, player.teamAbbr);
      if (!pid) throw new Error(`Couldn't resolve player id for "${player.full}"`);
      setResolvedPlayerId(pid);
      
      // Restore cached stats from sessionStorage if available
      if (typeof window !== 'undefined' && hasPremium) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${pid}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
          }
          
          const cachedShotData = sessionStorage.getItem(`shot_distance_${pid}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
          }
        } catch (e) {
          // Ignore storage errors, will fetch fresh data
        }
      }
      
      // OPTIMIZATION: Progressive loading for faster initial render
      // 1. Fetch critical path data first (stats) - show UI immediately
      // 2. Load non-critical data (BDL/ESPN metadata) in background
      // 3. Load premium features (advanced stats, shot distance) in background
      
      // Fetch stats first (critical - needed for chart)
      const rows = await fetchSortedStats(pid);
      
      // Use sample data team directly for default players - NO GAME DATA FALLBACK
      const currentTeam = normalizeAbbr(player.teamAbbr);
      
      // Set player stats immediately so UI can render (with basic player info)
      startTransition(() => {
        setSelectedTimeframe('last10');
        setPlayerStats(rows);
        setSelectedTeam(currentTeam);
        setOriginalPlayerTeam(currentTeam);
        setDepthChartTeam(currentTeam);
        setSelectedPlayer(player); // Set basic player first, will update with jersey/height later
      });
      
      // Load non-critical metadata in background (doesn't block UI)
      Promise.all([
        fetchBdlPlayerData(pid),
        fetchEspnPlayerData(player.full, player.teamAbbr).catch(() => null)
      ]).then(([bdlPlayerData, espnData]) => {
        // Parse BDL height data and merge with sample player data
        const heightData = parseBdlHeight(bdlPlayerData?.height);
        
        // Get jersey and height from BDL, with fallbacks to player object
        const bdlJersey = bdlPlayerData?.jersey_number;
        const bdlJerseyNum = (bdlJersey && bdlJersey !== '' && bdlJersey !== 'null' && bdlJersey !== '0') 
          ? Number(bdlJersey) 
          : 0;
        let jerseyNumber = bdlJerseyNum > 0 ? bdlJerseyNum : (player.jersey || 0);
        let heightFeetData: number | undefined = heightData.feet || player.heightFeet || undefined;
        let heightInchesData: number | undefined = heightData.inches || player.heightInches || undefined;
        
        // Fallback to depth chart roster for jersey if still missing
        if (!jerseyNumber && playerTeamRoster) {
          const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
          for (const pos of positions) {
            const posPlayers = playerTeamRoster[pos];
            if (Array.isArray(posPlayers)) {
              const found = posPlayers.find(p => 
                p.name && player.full && 
                (p.name.toLowerCase().includes(player.full.toLowerCase()) || 
                 player.full.toLowerCase().includes(p.name.toLowerCase()))
              );
              if (found && found.jersey && found.jersey !== 'N/A') {
                jerseyNumber = Number(found.jersey);
                break;
              }
            }
          }
        }
        
        // Update player with jersey/height metadata (non-blocking update)
        startTransition(() => {
          setSelectedPlayer({
            ...player,
            jersey: jerseyNumber,
            heightFeet: heightFeetData || undefined,
            heightInches: heightInchesData || undefined,
          });
        });
      }).catch(err => {
        console.warn('Failed to load player metadata (non-critical):', err);
      });
      
      // Start premium fetches in background (don't await)
      if (hasPremium) {
        fetchAdvancedStats(pid).catch(err => console.error('Advanced stats error:', err));
        fetchShotDistanceStats(pid).catch(err => console.error('Shot distance error:', err));
      }
      
      // Debug: log what we're setting as playerStats
      console.log('[Dashboard] Setting playerStats:', {
        playerId: pid,
        playerName: player.full,
        rowsCount: rows.length,
        sampleRow: rows[0],
        hasGame: !!rows[0]?.game,
        hasGameDate: !!rows[0]?.game?.date,
        hasTeam: !!rows[0]?.team,
        hasTeamAbbr: !!rows[0]?.team?.abbreviation,
        sampleRowKeys: rows[0] ? Object.keys(rows[0]) : [],
      });
      
      // Batch remaining state updates in startTransition
      startTransition(() => {
        // Reset betting-line auto-set trackers so odds can re-apply for the new player
        lastAutoSetStatRef.current = null;
        lastAutoSetLineRef.current = null;
        hasManuallySetLineRef.current = false;
        
        // Reset betting lines in transition to prevent visible refresh
        // BUT preserve the line from URL if it exists (important for steals/blocks)
        setBettingLines(prev => {
          // Check URL for line parameter
          if (typeof window !== 'undefined') {
            try {
              const url = new URL(window.location.href);
              const urlLine = url.searchParams.get('line');
              const urlStat = url.searchParams.get('stat');
              if (urlLine && urlStat) {
                const lineValue = parseFloat(urlLine);
                const normalizedStat = urlStat.toLowerCase();
                if (!isNaN(lineValue) && normalizedStat) {
                  // Preserve the URL line for the URL stat
                  return { [normalizedStat]: Math.abs(lineValue) };
                }
              }
            } catch {}
          }
          // Also check if current stat has a line that was set from URL
          const currentStatLine = prev[selectedStat];
          if (currentStatLine !== undefined && statFromUrlRef.current) {
            return { [selectedStat]: currentStatLine };
          }
          return {};
        });
      });
      // Update URL to reflect the change
      if (typeof window !== 'undefined') {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('tf', 'last10');
        window.history.replaceState({}, '', newUrl.toString());
      }
      
      // Set opponent immediately if games are already loaded, otherwise useEffect will handle it
      if (todaysGames.length > 0) {
        const opponent = getOpponentTeam(currentTeam, todaysGames);
        const normalizedOpponent = normalizeAbbr(opponent);
        console.log(`[Player Select] Setting opponent for ${currentTeam}: ${normalizedOpponent} (games already loaded)`);
        setOpponentTeam(normalizedOpponent);
      } else {
        console.log(`[Player Select] Team set to ${currentTeam}, opponent will be set when games load`);
      }
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
    } catch (e: any) {
      setApiError(e?.message || "Failed to load stats."); setPlayerStats([]);
      setOpponentTeam('');
    } finally { setIsLoading(false); }
  }, [
    setIsLoading, setApiError, setAdvancedStats, setShotDistanceData, setAdvancedStatsLoading,
    setShotDistanceLoading, setRealOddsData, setOddsSnapshots, setLineMovementData, setOddsLoading,
    setOddsError, setOpponentTeam, setResolvedPlayerId, setSelectedTimeframe, setPlayerStats,
    setSelectedTeam, setOriginalPlayerTeam, setDepthChartTeam, setSelectedPlayer, setBettingLines,
    hasPremium, selectedStat, todaysGames, playerTeamRoster, fetchSortedStats, fetchAdvancedStats,
    fetchShotDistanceStats, lastAutoSetStatRef, lastAutoSetLineRef, hasManuallySetLineRef, statFromUrlRef
  ]);

  const handlePlayerSelectFromSearch = useCallback(async (r: BdlSearchResult) => {
    // Prevent duplicate calls
    if (isHandlingPlayerSelectRef.current) {
      console.log('🔍 [handlePlayerSelectFromSearch] Already handling, skipping duplicate call');
      return;
    }
    
    isHandlingPlayerSelectRef.current = true;
    
    try {
      const callData = {
        player: r.full,
        id: r.id,
        team: r.team,
        pos: r.pos,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      };
      console.log('🔍 [handlePlayerSelectFromSearch] Called with:', callData);
      serverLogger.log('🔍 [handlePlayerSelectFromSearch] Called with', { data: callData });
      // Only set loading if not already loading (prevents double render when called from URL params)
      if (!isLoading) {
        console.log('🔍 [handlePlayerSelectFromSearch] Setting isLoading=true');
        setIsLoading(true);
      } else {
        console.log('🔍 [handlePlayerSelectFromSearch] Already loading, skipping setIsLoading');
      }
      setApiError(null);
    
    // Clear premium stats immediately when switching players
    setAdvancedStats(null);
    setShotDistanceData(null);
    setAdvancedStatsLoading(false);
    setShotDistanceLoading(false);
    
    // Clear all odds data when switching players
    setRealOddsData([]);
    setOddsSnapshots([]);
    setLineMovementData(null);
    setOddsLoading(false);
    setOddsError(null);
    
    try {
      const pid = String(r.id);
      setResolvedPlayerId(pid);
      
      // Restore cached stats from sessionStorage if available
      if (typeof window !== 'undefined' && hasPremium) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${pid}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
          }
          
          const cachedShotData = sessionStorage.getItem(`shot_distance_${pid}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
          }
        } catch (e) {
          // Ignore storage errors, will fetch fresh data
        }
      }
      // Create player object from search result
      const tempPlayer = {
        id: pid,
        full: r.full,
        firstName: r.full.split(' ')[0] || r.full,
        lastName: r.full.split(' ').slice(1).join(' ') || '',
        teamAbbr: '', // Will be determined from API game data
        jersey: '',
        heightFeet: null,
        heightInches: null,
        position: r.pos || '',
      } as any;
      
      // OPTIMIZATION: Fetch both current season and last season stats in parallel
      // This prevents multiple refreshes and ensures all data is available at once
      // fetchSortedStatsCore handles parallel fetching for both seasons
      console.log('🔍 [handlePlayerSelectFromSearch] Starting stats fetch (both seasons in parallel):', { pid, name: r.full });
      serverLogger.log('🔍 [handlePlayerSelectFromSearch] Starting stats fetch', { data: { pid, name: r.full } });
      
      // Fetch both seasons in parallel - prevents multiple refreshes
      const rows = await fetchSortedStats(pid).catch(err => {
        console.error('❌ [handlePlayerSelectFromSearch] fetchSortedStats failed:', err);
        return [];
      });
      
      // Start BDL and ESPN fetches in background (don't await - they'll update state when ready)
      const bdlPromise = fetchBdlPlayerData(pid).catch(err => {
        console.error('❌ [handlePlayerSelectFromSearch] fetchBdlPlayerData failed:', err);
        return null;
      });
      
      const espnPromise = fetchEspnPlayerData(r.full, r.team).catch(err => {
        console.warn('⚠️ [handlePlayerSelectFromSearch] fetchEspnPlayerData failed (non-critical):', err);
        return null;
      });
      
      // Process BDL/ESPN data when ready (non-blocking)
      Promise.all([bdlPromise, espnPromise]).then(([bdlPlayerData, espnData]) => {
        // Update player with jersey/height data when available
        if (bdlPlayerData || espnData) {
          const heightData = parseBdlHeight(bdlPlayerData?.height);
          const bdlJersey = bdlPlayerData?.jersey_number;
          const bdlJerseyNum = (bdlJersey && bdlJersey !== '' && bdlJersey !== 'null' && bdlJersey !== '0') 
            ? Number(bdlJersey) 
            : 0;
          let jerseyNumber = bdlJerseyNum > 0 ? bdlJerseyNum : 0;
          let heightFeetData: number | undefined = heightData.feet;
          let heightInchesData: number | undefined = heightData.inches;
          
          // Use ESPN as fallback
          if (espnData) {
            if (!jerseyNumber && espnData.jersey) {
              jerseyNumber = Number(espnData.jersey);
            }
            if (!heightFeetData && espnData.height) {
              const espnHeightData = parseEspnHeight(espnData.height);
              if (espnHeightData.feet) {
                heightFeetData = espnHeightData.feet;
                heightInchesData = espnHeightData.inches;
              }
            }
          }
          
          // Update player with new data if we got any
          if (jerseyNumber || heightFeetData) {
            setSelectedPlayer(prev => {
              if (!prev) return prev; // Return null if no previous player
              const currentJersey = typeof prev.jersey === 'number' ? prev.jersey : (typeof prev.jersey === 'string' ? Number(prev.jersey) || 0 : 0);
              return {
                ...prev,
                jersey: jerseyNumber || currentJersey,
                heightFeet: heightFeetData ?? prev.heightFeet ?? undefined,
                heightInches: heightInchesData ?? prev.heightInches ?? undefined,
              };
            });
          }
        }
      }).catch(err => {
        console.warn('⚠️ [handlePlayerSelectFromSearch] Error processing BDL/ESPN data:', err);
      });
      
      // Log stats completion
      console.log('🔍 [handlePlayerSelectFromSearch] Stats fetch completed:', { statsCount: rows.length });
      serverLogger.log('🔍 [handlePlayerSelectFromSearch] Stats fetch completed', { data: { statsCount: rows.length } });
      
      // Start premium fetches in background (don't await)
      if (hasPremium) {
        // Fire and forget - these will update state when ready
        fetchAdvancedStats(pid).catch(err => console.error('Advanced stats error:', err));
        fetchShotDistanceStats(pid).catch(err => console.error('Shot distance error:', err));
      }
      
      // Batch critical state updates together to prevent multiple re-renders
      // Use startTransition for non-urgent updates to keep UI responsive
      // Use the team from search API directly - NO FALLBACK TO GAME DATA
      const currentTeam = normalizeAbbr(r.team || '');
      
      // Get position from search result
      let playerPosition = r.pos || tempPlayer.position || '';
      
      // Try to get jersey/height from sample players or depth chart (synchronous sources)
      let jerseyNumber = 0;
      let heightFeetData: number | undefined = undefined;
      let heightInchesData: number | undefined = undefined;
      
      // Fallback to sample players data if available
      const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const searchName = normalizeName(r.full);
      const samplePlayer = SAMPLE_PLAYERS.find(p => {
        const playerName = normalizeName(p.full);
        return playerName === searchName || 
               playerName.includes(searchName) || 
               searchName.includes(playerName) ||
               (p.firstName && normalizeName(p.firstName + p.lastName) === searchName) ||
               (p.lastName && normalizeName(p.lastName) === normalizeName(r.full.split(' ').pop() || ''));
      });
      if (samplePlayer) {
        if (samplePlayer.jersey) {
          jerseyNumber = samplePlayer.jersey;
          console.log(`✅ Found jersey #${jerseyNumber} from sample data for ${r.full}`);
        }
        if (samplePlayer.heightFeet) {
          heightFeetData = samplePlayer.heightFeet;
          heightInchesData = samplePlayer.heightInches;
          console.log(`✅ Found height ${heightFeetData}'${heightInchesData}" from sample data for ${r.full}`);
        }
      }
      
      // Fallback to depth chart roster for jersey and position if still missing
      if (playerTeamRoster) {
        const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
        for (const pos of positions) {
          const posPlayers = playerTeamRoster[pos];
          if (Array.isArray(posPlayers)) {
            const found = posPlayers.find(p => 
              p.name && r.full && 
              (p.name.toLowerCase().includes(r.full.toLowerCase()) || 
               r.full.toLowerCase().includes(p.name.toLowerCase()))
            );
            if (found) {
              if (!jerseyNumber && found.jersey && found.jersey !== 'N/A') {
                jerseyNumber = Number(found.jersey);
                console.log(`✅ Found jersey #${jerseyNumber} from depth chart for ${r.full}`);
              }
              if (!playerPosition) {
                playerPosition = pos;
                console.log(`✅ Found position ${playerPosition} from depth chart for ${r.full}`);
              }
              break;
            }
          }
        }
      }
      
      // Batch all state updates together in startTransition to prevent multiple re-renders
      // Set selectedTimeframe FIRST so it's correct when playerStats updates (prevents double baseGameData recalculation)
      console.log('[DEBUG handlePlayerSelectFromSearch] About to batch state updates', {
        rowsCount: rows.length,
        currentTeam,
        timestamp: new Date().toISOString()
      });
      
      startTransition(() => {
        // ALWAYS set timeframe to "last10" when selecting a new player (override URL if needed)
        // Set this FIRST so baseGameData calculates correctly when playerStats updates
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting timeframe to "last10"`);
        setSelectedTimeframe('last10');
        
        // Then set playerStats - this will trigger baseGameData recalculation with correct timeframe
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting playerStats (${rows.length} rows)`);
        setPlayerStats(rows);
        
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting teams and player`);
        setSelectedTeam(currentTeam);
        setOriginalPlayerTeam(currentTeam);
        setDepthChartTeam(currentTeam);
        
        // Update player with available data (jersey/height from BDL/ESPN will update later)
        setSelectedPlayer({
          ...tempPlayer,
          teamAbbr: currentTeam,
          jersey: jerseyNumber || '',
          heightFeet: heightFeetData || null,
          heightInches: heightInchesData || null,
          position: playerPosition || undefined,
        });

        // Reset betting-line auto-set trackers so odds can re-apply for the new player
        lastAutoSetStatRef.current = null;
        lastAutoSetLineRef.current = null;
        hasManuallySetLineRef.current = false;
        
        // Reset betting lines in transition to prevent visible refresh
        // BUT preserve the line from URL if it exists (important for steals/blocks)
        console.log(`[DEBUG handlePlayerSelectFromSearch] Resetting bettingLines`);
        setBettingLines(prev => {
          // Check URL for line parameter
          if (typeof window !== 'undefined') {
            try {
              const url = new URL(window.location.href);
              const urlLine = url.searchParams.get('line');
              const urlStat = url.searchParams.get('stat');
              if (urlLine && urlStat) {
                const lineValue = parseFloat(urlLine);
                const normalizedStat = urlStat.toLowerCase();
                if (!isNaN(lineValue) && normalizedStat) {
                  // Preserve the URL line for the URL stat
                  return { [normalizedStat]: Math.abs(lineValue) };
                }
              }
            } catch {}
          }
          // Also check if current stat has a line that was set from URL
          const currentStatLine = prev[selectedStat];
          if (currentStatLine !== undefined && statFromUrlRef.current) {
            return { [selectedStat]: currentStatLine };
          }
          return {};
        });
        
        console.log(`[DEBUG handlePlayerSelectFromSearch] All state updates batched in startTransition`);
      });
      
      // Update URL to reflect the timeframe change (outside transition, doesn't affect rendering)
      if (typeof window !== 'undefined') {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('tf', 'last10');
        window.history.replaceState({}, '', newUrl.toString());
      }
      
      // Set opponent immediately if games are already loaded, otherwise useEffect will handle it
      if (todaysGames.length > 0) {
        const opponent = getOpponentTeam(currentTeam, todaysGames);
        const normalizedOpponent = normalizeAbbr(opponent);
        console.log(`[Player Select] Setting opponent for ${currentTeam}: ${normalizedOpponent} (games already loaded)`);
        setOpponentTeam(normalizedOpponent);
      } else {
        console.log(`[Player Select] Team set to ${currentTeam}, opponent will be set when games load`);
      }
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
      console.log('✅ handlePlayerSelectFromSearch completed successfully');
    } catch (e: any) {
      console.error('❌ handlePlayerSelectFromSearch error:', e);
      setApiError(e?.message || "Failed to load stats."); 
      setPlayerStats([]);
      setOpponentTeam('N/A');
    }
    } finally {
      isHandlingPlayerSelectRef.current = false;
      setIsLoading(false);
      setShowDropdown(false);
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [
    setIsLoading, setApiError, setAdvancedStats, setShotDistanceData, setAdvancedStatsLoading,
    setShotDistanceLoading, setRealOddsData, setOddsSnapshots, setLineMovementData, setOddsLoading,
    setOddsError, setOpponentTeam, setResolvedPlayerId, setSelectedTimeframe, setPlayerStats,
    setSelectedTeam, setOriginalPlayerTeam, setDepthChartTeam, setSelectedPlayer, setBettingLines,
    setShowDropdown, setSearchQuery, setSearchResults, isLoading, hasPremium, selectedStat,
    todaysGames, playerTeamRoster, fetchSortedStats, fetchAdvancedStats, fetchShotDistanceStats,
    lastAutoSetStatRef, lastAutoSetLineRef, hasManuallySetLineRef, statFromUrlRef
  ]);

  return {
    handlePlayerSelectFromLocal,
    handlePlayerSelectFromSearch,
  };
}

