'use client';

import { useMemo, useCallback } from 'react';
import { calculateSelectedPosition } from '../utils/positionUtils';
import { DepthChartData } from '../types';

export interface UseRosterCalculationsParams {
  propsMode: 'player' | 'team';
  playerTeamRoster: DepthChartData | null;
  allTeamRosters: Record<string, DepthChartData>;
  originalPlayerTeam: string;
  selectedPlayer: { id: number; full?: string; firstName?: string; lastName?: string } | null;
  teammateFilterId: number | null;
  setTeammateFilterId: (id: number | null) => void;
  setTeammateFilterName: (name: string | null) => void;
  setTeammatePlayedGameIds: (ids: Set<number>) => void;
  setLoadingTeammateGames: (loading: boolean) => void;
}

export function useRosterCalculations({
  propsMode,
  playerTeamRoster,
  allTeamRosters,
  originalPlayerTeam,
  selectedPlayer,
  teammateFilterId,
  setTeammateFilterId,
  setTeammateFilterName,
  setTeammatePlayedGameIds,
  setLoadingTeammateGames,
}: UseRosterCalculationsParams) {
  const rosterForSelectedTeam = useMemo(() => {
    if (propsMode !== 'player') return null;
    const roster = (playerTeamRoster && Object.keys(playerTeamRoster || {}).length ? playerTeamRoster : allTeamRosters[originalPlayerTeam]) as any;
    return roster || null;
  }, [propsMode, playerTeamRoster, allTeamRosters, originalPlayerTeam]);

  // Resolve selected player's exact position from depth chart (after roster states are ready)
  const selectedPosition = useMemo((): 'PG'|'SG'|'SF'|'PF'|'C' | null => {
    return calculateSelectedPosition({
      propsMode,
      selectedPlayer,
      playerTeamRoster,
      allTeamRosters,
      originalPlayerTeam,
    });
  }, [propsMode, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, playerTeamRoster, allTeamRosters, originalPlayerTeam]);

  const clearTeammateFilter = useCallback(() => {
    setTeammateFilterId(null);
    setTeammateFilterName(null);
    setTeammatePlayedGameIds(new Set());
    setLoadingTeammateGames(false);
  }, [setTeammateFilterId, setTeammateFilterName, setTeammatePlayedGameIds, setLoadingTeammateGames]);

  return {
    rosterForSelectedTeam,
    selectedPosition,
    clearTeammateFilter,
  };
}

