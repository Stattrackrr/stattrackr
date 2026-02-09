import { useEffect } from 'react';
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
        
        // Don't strip player params while we're still loading from URL
        // (e.g. "View on dashboard" from Today's Best Pick navigates with player=... in URL)
        const currentUrl = new URL(window.location.href);
        const hasPlayerParam = currentUrl.searchParams.has('player');
        const hasPidParam = currentUrl.searchParams.has('pid');
        const hasPlayerInUrl = hasPlayerParam || hasPidParam;
        const isLoadingFromUrl = hasPlayerInUrl && (!selectedPlayer || !selectedTeam);
        
        // Update URL for share/save (but skip if we're still loading player from URL params)
        if (!isLoadingFromUrl) {
          const url = new URL(window.location.href);
          url.searchParams.set('mode', propsMode);
          
          if (selectedPlayer && selectedTeam && propsMode === 'player') {
            const r = baseSave.player as BdlSearchResult;
            url.searchParams.set('pid', String(r.id));
            url.searchParams.set('name', r.full);
            url.searchParams.set('team', selectedTeam);
            url.searchParams.delete('player');
          } else {
            url.searchParams.delete('pid');
            url.searchParams.delete('name');
            url.searchParams.delete('team');
            url.searchParams.delete('player');
          }
          
          const currentStatInUrl = url.searchParams.get('stat');
          url.searchParams.set('stat', selectedStat);
          url.searchParams.set('tf', selectedTimeframe);
          // Remove stale line when stat changed so refresh never applies previous stat's line (e.g. AST 2.5 -> PTS)
          if (currentStatInUrl !== selectedStat) {
            url.searchParams.delete('line');
          }
          const newUrlStr = url.toString();
          if (window.location.href !== newUrlStr) {
            window.history.replaceState({}, '', newUrlStr);
          }
        }
      }
    } catch {}
  }, [selectedPlayer, selectedTeam, selectedStat, selectedTimeframe, resolvedPlayerId, propsMode, gamePropsTeam]);
}

