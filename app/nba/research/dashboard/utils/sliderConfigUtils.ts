/**
 * Slider configuration utilities
 * 
 * This file contains the logic for calculating slider configuration (min/max range)
 * for the second axis filter slider based on the selected filter type.
 */

import { AllGamesSecondAxisDataItem } from './allGamesSecondAxisDataUtils';

export interface SliderConfig {
  min: number;
  max: number;
  values: number[];
}

export interface SliderConfigParams {
  selectedFilterForAxis: string | null;
  allGamesSecondAxisData: AllGamesSecondAxisDataItem[] | null;
}

/**
 * Calculates slider configuration (min/max range) for the second axis filter slider
 */
export function calculateSliderConfig({
  selectedFilterForAxis,
  allGamesSecondAxisData,
}: SliderConfigParams): SliderConfig | null {
  if (!selectedFilterForAxis || !allGamesSecondAxisData) {
    return null;
  }

  const values = allGamesSecondAxisData
    .map(item => item.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  if (values.length === 0) {
    return null;
  }

  let min: number;
  let max: number;

  switch (selectedFilterForAxis) {
    case 'minutes':
      min = 0;
      max = 50;
      break;
    case 'fg_pct':
      min = 0;
      max = 100;
      break;
    case 'pace':
      min = Math.floor(Math.min(...values));
      max = Math.ceil(Math.max(...values));
      break;
    case 'usage_rate':
      min = Math.floor(Math.min(...values));
      max = Math.ceil(Math.max(...values));
      break;
    case 'dvp_rank':
      min = 1;
      max = 30;
      break;
    default:
      return null;
  }

  return { min, max, values };
}





