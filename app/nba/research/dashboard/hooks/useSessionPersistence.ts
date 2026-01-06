import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { SavedSession, SESSION_KEY } from '../types';
import { BdlSearchResult } from '../types';

export interface UseSessionPersistenceParams {
  propsMode: 'player' | 'team';
  selectedStat: string;
  selectedTimeframe: string;
  selectedPlayer: any;
  selectedTeam: string;
  resolvedPlayerId: string | null;
  gamePropsTeam: string;
}

/**
 * Custom hook to persist session state to sessionStorage and update URL
 */
export function useSessionPersistence({
  propsMode,
  selectedStat,
  selectedTimeframe,
  selectedPlayer,
  selectedTeam,
  resolvedPlayerId,
  gamePropsTeam,
}: UseSessionPersistenceParams) {
  const searchParams = useSearchParams();

  useEffect(() => {
    try {
      // Always save propsMode, selectedStat, and selectedTimeframe
      const baseSave: Partial<SavedSession> = {
        propsMode,
        selectedStat,
        selectedTimeframe,
      };

      // Add player data if in player mode and player is selected
      if (selectedPlayer && selectedTeam && propsMode === 'player') {
        const r: BdlSearchResult = {
          id: Number(resolvedPlayerId || selectedPlayer.id),
          full: selectedPlayer.full,
          team: selectedTeam,
          pos: (selectedPlayer as any).position || undefined,
        };
        (baseSave as SavedSession).player = r;
      }
      
      // Add team data if in team mode and team is selected
      if (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A') {
        (baseSave as any).gamePropsTeam = gamePropsTeam;
      }
      
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(baseSave));
        
        // Check if we're loading from URL params (has 'player' but not 'pid')
        // If so, don't update URL immediately to prevent double reload
        const currentUrl = new URL(window.location.href);
        const hasPlayerParam = currentUrl.searchParams.has('player');
        const hasPidParam = currentUrl.searchParams.has('pid');
        const isLoadingFromUrl = hasPlayerParam && !hasPidParam;
        
        // Update URL for share/save (but skip if we're still loading from URL params)
        if (!isLoadingFromUrl) {
          const url = new URL(window.location.href);
          url.searchParams.set('mode', propsMode);
          
          if (selectedPlayer && selectedTeam && propsMode === 'player') {
            const r = baseSave.player as BdlSearchResult;
            url.searchParams.set('pid', String(r.id));
            url.searchParams.set('name', r.full);
            url.searchParams.set('team', selectedTeam);
            // Remove 'player' param if it exists (we now have pid/name/team)
            url.searchParams.delete('player');
          } else {
            // Remove player-specific params when not in player mode
            url.searchParams.delete('pid');
            url.searchParams.delete('name');
            url.searchParams.delete('team');
            url.searchParams.delete('player');
          }
          
          url.searchParams.set('stat', selectedStat);
          url.searchParams.set('tf', selectedTimeframe);
          window.history.replaceState({}, '', url.toString());
        }
      }
    } catch {}
  }, [selectedPlayer, selectedTeam, selectedStat, selectedTimeframe, resolvedPlayerId, propsMode, gamePropsTeam, searchParams]);
}

