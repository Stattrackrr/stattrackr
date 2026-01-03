/**
 * Chart formatting utilities
 */

/**
 * Creates a label formatter function for chart bars
 */
export function createChartLabelFormatter(selectedStat: string): (value: any) => string {
  const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
  return (value: any): string => {
    // Hide labels for moneyline stats (win/loss is clear from bar presence/absence)
    if (['moneyline', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat)) {
      return '';
    }
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    if (isPercentageStat) {
      return `${numValue.toFixed(1)}%`;
    }
    return numValue.toString();
  };
}

/**
 * Calculate Y-axis domain with appropriate tick increments
 */
export function calculateYAxisConfig(params: {
  chartData: Array<{ value: number }>;
  selectedStat: string;
  propsMode: 'player' | 'team';
}): {
  domain: [number, number];
  ticks: number[];
  dataMin: number;
  dataMax: number;
} {
  const { chartData, selectedStat, propsMode } = params;
  
  if (!chartData.length) {
    return {
      domain: [0, 50],
      ticks: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
      dataMin: 0,
      dataMax: 0
    };
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
    increment = 10;
  } else if (isSmallIncrementStat) {
    // Small increment stats: use smaller increments
    minYAxis = Math.max(0, Math.floor(minValue / 5) * 5 - 5);
    maxYAxis = Math.ceil(maxValue / 5) * 5 + 5;
    increment = 5;
  } else if (selectedStat === 'spread' && propsMode === 'team') {
    // Spread in team mode: use larger increments for absolute values
    const absMax = Math.max(...values.map(v => Math.abs(v)));
    minYAxis = -Math.ceil(absMax / 5) * 5 - 5;
    maxYAxis = Math.ceil(absMax / 5) * 5 + 5;
    increment = 5;
  } else {
    // Default: use larger increments for most stats
    minYAxis = Math.max(0, Math.floor(minValue / 10) * 10 - 10);
    maxYAxis = Math.ceil(maxValue / 10) * 10 + 10;
    increment = 10;
  }
  
  // Generate ticks array
  const ticks: number[] = [];
  for (let i = minYAxis; i <= maxYAxis; i += increment) {
    ticks.push(i);
  }
  
  return {
    domain: [minYAxis, maxYAxis],
    ticks,
    dataMin: minValue,
    dataMax: maxValue
  };
}

