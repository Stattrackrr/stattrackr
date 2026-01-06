'use client';

import { useState, useEffect } from 'react';

export function useDashboardModeState() {
  const [propsMode, setPropsMode] = useState<'player' | 'team'>('player');
  const [selectedStat, setSelectedStat] = useState('pts');
  const [selectedFilterForAxis, setSelectedFilterForAxis] = useState<string | null>(null); // Second axis filter: 'minutes', 'dvp_rank', 'pace', 'usage_rate', 'fg_pct', null
  const [dvpProjectedTab, setDvpProjectedTab] = useState<'dvp' | 'opponent' | 'injuries'>('dvp'); // Tab selector for DvP, Opponent Breakdown, and Injuries
  const [sliderRange, setSliderRange] = useState<{ min: number; max: number } | null>(null); // Slider range for filtering
  const [selectedTimeframe, setSelectedTimeframe] = useState('last10');

  // Migrate old 'projected' tab value to 'dvp' (projected feature removed)
  useEffect(() => {
    if ((dvpProjectedTab as any) === 'projected') {
      setDvpProjectedTab('dvp');
    }
  }, [dvpProjectedTab]);

  return {
    propsMode,
    setPropsMode,
    selectedStat,
    setSelectedStat,
    selectedFilterForAxis,
    setSelectedFilterForAxis,
    dvpProjectedTab,
    setDvpProjectedTab,
    sliderRange,
    setSliderRange,
    selectedTimeframe,
    setSelectedTimeframe,
  };
}

