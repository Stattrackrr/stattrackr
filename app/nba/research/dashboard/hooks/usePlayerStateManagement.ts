import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { NBAPlayer } from '../types';

export interface UsePlayerStateManagementParams {
  selectedPlayer: NBAPlayer | null;
  realOddsData: any[];
  oddsLoading: boolean;
  oddsError: string | null;
  setRealOddsData: (data: any[]) => void;
  setOddsSnapshots: (snapshots: any[]) => void;
  setLineMovementData: (data: any) => void;
  setOddsLoading: (loading: boolean) => void;
  setOddsError: (error: string | null) => void;
  setBettingLines: (lines: any) => void;
  setBookOpeningLine: (line: any) => void;
  setBookCurrentLine: (line: any) => void;
  setSelectedPlayer: (player: NBAPlayer | null) => void;
  setResolvedPlayerId: (id: string | null) => void;
  setPlayerStats: (stats: any[]) => void;
}

/**
 * Custom hook to manage player state clearing when player changes or URL changes
 */
export function usePlayerStateManagement({
  selectedPlayer,
  realOddsData,
  oddsLoading,
  oddsError,
  setRealOddsData,
  setOddsSnapshots,
  setLineMovementData,
  setOddsLoading,
  setOddsError,
  setBettingLines,
  setBookOpeningLine,
  setBookCurrentLine,
  setSelectedPlayer,
  setResolvedPlayerId,
  setPlayerStats,
}: UsePlayerStateManagementParams) {
  const searchParams = useSearchParams();
  const lastPlayerIdRef = useRef<string | null>(null);

  // Clear odds data when player ID actually changes (not just metadata updates)
  // Player stats are cleared by handlePlayerSelect functions at the start
  useEffect(() => {
    if (selectedPlayer === null) {
      // Player cleared - reset odds only
      if (lastPlayerIdRef.current !== null) {
        setRealOddsData([]);
        setOddsSnapshots([]);
        setLineMovementData(null);
        setBettingLines({});
        lastPlayerIdRef.current = null;
      }
      return;
    }
    
    // Only clear odds if the player ID actually changed (not just metadata like jersey/height)
    const currentPlayerId = selectedPlayer.id?.toString() || null;
    if (currentPlayerId !== lastPlayerIdRef.current) {
      // Player ID changed - clear odds data
      console.log('[Odds Clear] Player ID changed, clearing odds', {
        oldId: lastPlayerIdRef.current,
        newId: currentPlayerId,
        playerName: selectedPlayer.full,
        currentOddsLength: realOddsData.length
      });
      // Only clear if we actually have odds to clear (prevent unnecessary state updates)
      if (realOddsData.length > 0 || oddsLoading || oddsError) {
        setRealOddsData([]);
        setOddsSnapshots([]);
        setLineMovementData(null);
        setOddsLoading(false);
        setOddsError(null);
        setBettingLines({});
        setBookOpeningLine(null);
        setBookCurrentLine(null);
      }
      lastPlayerIdRef.current = currentPlayerId;
      // Odds fetch ref is now managed by useOddsFetching hook
    }
    // If player ID is the same, don't clear odds (just metadata update like jersey/height)
  }, [selectedPlayer, realOddsData, oddsLoading, oddsError, setRealOddsData, setOddsSnapshots, setLineMovementData, setOddsLoading, setOddsError, setBettingLines, setBookOpeningLine, setBookCurrentLine]);

  // Clear player state when player parameter is removed from URL (e.g., browser back button)
  useEffect(() => {
    const player = searchParams.get('player');
    const pid = searchParams.get('pid');
    const name = searchParams.get('name');
    
    // If there's no player parameter in URL but we have a selected player, clear it
    if (!player && !pid && !name && selectedPlayer) {
      console.log('[Dashboard] 🧹 Clearing selectedPlayer - no player parameter in URL');
      setSelectedPlayer(null);
      setResolvedPlayerId(null);
      setPlayerStats([]);
      setRealOddsData([]);
      setOddsSnapshots([]);
      setLineMovementData(null);
    }
  }, [searchParams, selectedPlayer, setSelectedPlayer, setResolvedPlayerId, setPlayerStats, setRealOddsData, setOddsSnapshots, setLineMovementData]);
}

