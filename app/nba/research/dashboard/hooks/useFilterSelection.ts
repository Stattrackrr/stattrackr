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
    // Reset slider when filter changes
    setSliderRange(null);
  }, [setSelectedFilterForAxis, setSliderRange]);

  return {
    handleSelectFilterForAxis,
  };
}

