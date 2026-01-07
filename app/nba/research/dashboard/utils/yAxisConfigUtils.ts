/**
 * Y-axis configuration utilities
 * 
 * This file contains the logic for calculating Y-axis domain, ticks, and configuration
 * for the chart display based on the selected stat and data values.
 */

export interface YAxisConfig {
  domain: [number, number];
  ticks: number[];
  dataMin: number;
  dataMax: number;
}

export interface ChartDataItem {
  value: number;
  stats?: any;
  [key: string]: any;
}

export interface YAxisConfigParams {
  chartData: ChartDataItem[];
  selectedStat: string;
  selectedTimeframe: string;
  propsMode: 'player' | 'team';
}

/**
 * Calculates Y-axis configuration (domain, ticks, min/max) based on chart data and selected stat
 */
export function calculateYAxisConfig({
  chartData,
  selectedStat,
  selectedTimeframe,
  propsMode,
}: YAxisConfigParams): YAxisConfig {
  if (!chartData.length) {
    return { domain: [0, 50], ticks: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50], dataMin: 0, dataMax: 0 };
  }
  
  const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
  const smallIncrementStats = ['reb', 'ast', 'fg3m', 'fg3a', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'turnover', 'pf', 'stl', 'blk'];
  const isSmallIncrementStat = smallIncrementStats.includes(selectedStat);
  
  // Get min and max values from data
  // For spread stat, values will be adjusted later, but we need to account for absolute values
  // to ensure domain covers all possible adjusted values
  const values = chartData.map(d => d.value);
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  
  // For spread stat in team mode, account for sign adjustment
  // Values will be adjusted to all negative (favorite) or all positive (underdog)
  // So we need to ensure domain covers the absolute value range
  if (propsMode === 'team' && selectedStat === 'spread') {
    const absValues = values.map(v => Math.abs(v));
    const maxAbs = Math.max(...absValues);
    // Domain should accommodate: negative values down to -maxAbs, or positive values up to +maxAbs
    // We'll set domain to cover both possibilities with padding
    minValue = -maxAbs;
    maxValue = maxAbs;
  }
  
  let minYAxis: number;
  let maxYAxis: number;
  let increment: number;
  
  if (isPercentageStat) {
    minYAxis = 0;
    maxYAxis = 100;
    increment = 5; // Percentages use 5-increment ticks
  } else if (['moneyline', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat)) {
    // Special handling for moneyline: only 0 (loss) and 1 (win) values
    // Set domain higher than 1 so win bars appear large
    minYAxis = 0;
    maxYAxis = 1.5; // Make 1 appear at about 2/3 height for bigger visual impact
    return { domain: [minYAxis, maxYAxis], ticks: [0, 1], dataMin: minValue, dataMax: maxValue };
  } else if (selectedStat === 'spread') {
    // Special handling for spread: ensure minimum value is positioned higher to prevent bars going below container
    const range = maxValue - minValue;
    const padding = Math.max(5, Math.ceil(range * 0.15)); // At least 5 points padding, or 15% of range
    
    minYAxis = Math.floor((minValue - padding) / 5) * 5; // Round down to nearest 5-increment with padding
    maxYAxis = Math.ceil((maxValue + padding) / 5) * 5; // Round up to nearest 5-increment with padding
    increment = 5;
    
    // Generate ticks only for the visible data range (without showing padding ticks)
    const visibleMinY = Math.floor(minValue / 5) * 5; // Actual data minimum without padding
    const visibleMaxY = Math.ceil(maxValue / 5) * 5; // Actual data maximum without padding
    const ticks = [];
    for (let i = visibleMinY; i <= visibleMaxY; i += increment) {
      ticks.push(i);
    }
    
    return { domain: [minYAxis, maxYAxis], ticks, dataMin: minValue, dataMax: maxValue };
  } else if (isSmallIncrementStat) {
    // For 3PM, use 3PA values for Y-axis calculation to show proper scale
    if (selectedStat === 'fg3m') {
      const maxAttempts = Math.max(...chartData.map(d => d.stats?.fg3a || 0));
      minYAxis = 0;
      maxYAxis = Math.ceil(maxAttempts); // For 3PM, don't add extra increment - top bar should touch Y-axis max
    } else {
      minYAxis = minValue < 0 ? Math.floor(minValue) - 1 : 0;
      // For steals/blocks, ensure domain is at least [0, 2] so betting line at 0.5 is visible
      // This handles cases where all values are 0 but betting line is 0.5
      if ((selectedStat === 'stl' || selectedStat === 'blk') && maxValue === 0) {
        maxYAxis = 2; // Ensure domain shows 0-2 so 0.5 line is visible
      } else {
        maxYAxis = Math.ceil(maxValue) + 1; // Round up to next 1-increment
      }
    }
    increment = 1; // Use 1-increment ticks for smaller stats
  } else {
    // Handle negative values by rounding down to nearest 5-increment
    minYAxis = minValue < 0 ? Math.floor(minValue / 5) * 5 : 0;
    maxYAxis = Math.ceil((maxValue + 1) / 5) * 5; // Round up to next 5-increment
    increment = 5; // Use 5-increment ticks for larger stats like points, minutes
  }

  // Generate ticks based on the increment
  let ticks: number[] = [];
  for (let i = minYAxis; i <= maxYAxis; i += increment) {
    ticks.push(i);
  }
  
  return { domain: [minYAxis, maxYAxis], ticks, dataMin: minValue, dataMax: maxValue };
}




