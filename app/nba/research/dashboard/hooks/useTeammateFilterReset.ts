import { useEffect } from 'react';

export interface UseTeammateFilterResetParams {
  propsMode: 'player' | 'team';
  selectedPlayer: any;
  setTeammateFilterId: (id: number | null) => void;
  setTeammateFilterName: (name: string | null) => void;
  setTeammatePlayedGameIds: (ids: Set<number>) => void;
  setWithWithoutMode: (mode: 'with' | 'without') => void;
  setLoadingTeammateGames: (loading: boolean) => void;
}

/**
 * Custom hook to reset teammate filters whenever the primary context changes
 */
export function useTeammateFilterReset({
  propsMode,
  selectedPlayer,
  setTeammateFilterId,
  setTeammateFilterName,
  setTeammatePlayedGameIds,
  setWithWithoutMode,
  setLoadingTeammateGames,
}: UseTeammateFilterResetParams) {
  useEffect(() => {
    // Always clear when leaving player mode or switching players
    setTeammateFilterId(null);
    setTeammateFilterName(null);
    setTeammatePlayedGameIds(new Set());
    setWithWithoutMode('with');
    setLoadingTeammateGames(false);
  }, [propsMode, selectedPlayer?.id, setTeammateFilterId, setTeammateFilterName, setTeammatePlayedGameIds, setWithWithoutMode, setLoadingTeammateGames]);
}


