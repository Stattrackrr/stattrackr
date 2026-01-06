'use client';

import { useMemo, useCallback } from 'react';

export interface UseDashboardComputedPropsParams {
  propsMode: 'player' | 'team';
  gameStatsLoading: boolean;
  isLoading: boolean;
  oddsLoading: boolean;
  apiError: string | null;
  gamePropsTeam: string;
  selectedTeam: string;
  handleSidebarSubscriptionBase: (isPro: boolean) => void;
  isPro: boolean;
}

export function useDashboardComputedProps({
  propsMode,
  gameStatsLoading,
  isLoading,
  oddsLoading,
  apiError,
  gamePropsTeam,
  selectedTeam,
  handleSidebarSubscriptionBase,
  isPro,
}: UseDashboardComputedPropsParams) {
  // Memoize computed loading states
  const chartLoadingState = useMemo(() => ({
    isLoading: propsMode === 'team' ? gameStatsLoading : isLoading,
    oddsLoading: propsMode === 'player' ? oddsLoading : false,
    apiError: propsMode === 'team' ? null : apiError,
  }), [propsMode, gameStatsLoading, isLoading, oddsLoading, apiError]);

  // Memoize current team calculation
  const currentTeam = useMemo(() => 
    propsMode === 'team' ? gamePropsTeam : selectedTeam,
    [propsMode, gamePropsTeam, selectedTeam]
  );

  // Memoize sidebar subscription handler
  const handleSidebarSubscription = useCallback(() => {
    handleSidebarSubscriptionBase(isPro);
  }, [handleSidebarSubscriptionBase, isPro]);

  return {
    chartLoadingState,
    currentTeam,
    handleSidebarSubscription,
  };
}

