import { useEffect } from 'react';

export interface UseSliderRangeInitParams {
  selectedFilterForAxis: string | null;
  sliderConfig: { min: number; max: number } | null;
  sliderRange: { min: number; max: number } | null;
  setSliderRange: (range: { min: number; max: number } | null) => void;
}

/**
 * Custom hook to initialize slider range when filter is selected
 */
export function useSliderRangeInit({
  selectedFilterForAxis,
  sliderConfig,
  sliderRange,
  setSliderRange,
}: UseSliderRangeInitParams) {
  useEffect(() => {
    if (selectedFilterForAxis && sliderConfig && sliderRange === null) {
      // Initialize with full range
      setSliderRange({ min: sliderConfig.min, max: sliderConfig.max });
    }
  }, [selectedFilterForAxis, sliderConfig, sliderRange, setSliderRange]);
}


