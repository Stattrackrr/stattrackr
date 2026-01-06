'use client';

import { useState } from 'react';

export function useDashboardTeammateState() {
  const [withWithoutMode, setWithWithoutMode] = useState<'with'|'without'>('with');
  const [teammateFilterId, setTeammateFilterId] = useState<number | null>(null);
  const [teammateFilterName, setTeammateFilterName] = useState<string | null>(null); // Store name for display
  const [teammatePlayedGameIds, setTeammatePlayedGameIds] = useState<Set<number>>(new Set());
  const [loadingTeammateGames, setLoadingTeammateGames] = useState<boolean>(false);

  return {
    withWithoutMode,
    setWithWithoutMode,
    teammateFilterId,
    setTeammateFilterId,
    teammateFilterName,
    setTeammateFilterName,
    teammatePlayedGameIds,
    setTeammatePlayedGameIds,
    loadingTeammateGames,
    setLoadingTeammateGames,
  };
}

