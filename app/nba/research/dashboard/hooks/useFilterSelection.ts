'use client';

import { useCallback } from 'react';

export interface UseFilterSelectionParams {
  setSelectedFilterForAxis: React.Dispatch<React.SetStateAction<string | null>>;
  setSliderRange: React.Dispatch<React.SetStateAction<{ min: number; max: number } | null>>;
}

export function useFilterSelection({
  setSelectedFilterForAxis,
  setSliderRange,
}: UseFilterSelectionParams) {
  const handleSelectFilterForAxis = useCallback((filter: string | null) => {
    setSelectedFilterForAxis(filter);
    // Set initial range for DvP so we use filtered path immediately (avoids one render with chartData/10 games)
    if (filter === 'dvp_rank') {
      setSliderRange({ min: 1, max: 30 });
    } else {
      setSliderRange(null);
    }
  }, [setSelectedFilterForAxis, setSliderRange]);

  return {
    handleSelectFilterForAxis,
  };
}

