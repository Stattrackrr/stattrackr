import { HitRateStats, AverageStatInfo } from '../types';

export interface CalculateHitRateStatsParams {
  chartData: any[];
  bettingLine: number | null;
  selectedStat: string;
  currentStatOptions: any[];
  propsMode: 'player' | 'team';
  baseGameDataLength: number;
  selectedPlayer: any;
  isLoading: boolean;
  resolvedPlayerId: string | null;
}

/**
 * Calculate hit rate statistics for the selected stat
 */
export function calculateHitRateStats({
  chartData,
  bettingLine,
  selectedStat,
  currentStatOptions,
  propsMode,
  baseGameDataLength,
  selectedPlayer,
  isLoading,
  resolvedPlayerId,
}: CalculateHitRateStatsParams): HitRateStats {
  // Debug: log chartData values before filtering
  console.log('[hitRateStats] Processing chartData:', {
    chartDataLength: chartData.length,
    sampleChartData: chartData[0],
    sampleValue: chartData[0]?.value,
    sampleValueType: typeof chartData[0]?.value,
    allValues: chartData.map(d => d.value),
    allValueTypes: chartData.map(d => typeof d.value),
  });
  
  const validValues = chartData
    .map(d => (Number.isFinite(d.value) ? d.value : Number(d.value)))
    .filter((v): v is number => Number.isFinite(v));
  
  // Debug: log filtering results
  console.log('[hitRateStats] Valid values:', {
    validValuesLength: validValues.length,
    validValues,
    chartDataLength: chartData.length,
    filteredOut: chartData.length - validValues.length,
  });
  
  // Check if URL params indicate a player should be loaded (for initial page load detection)
  let hasUrlPlayer = false;
  if (typeof window !== 'undefined' && propsMode === 'player') {
    try {
      const url = new URL(window.location.href);
      const pid = url.searchParams.get('pid');
      const name = url.searchParams.get('name');
      hasUrlPlayer = !!(pid && name);
    } catch {}
  }

  if (validValues.length === 0) {
    // If we have a selectedPlayer or resolvedPlayerId or URL params but no data, we're likely still loading
    // Don't show "0/0" - return empty stats that won't display the pill
    if (propsMode === 'player' && (selectedPlayer || resolvedPlayerId || hasUrlPlayer) && (isLoading || chartData.length === 0)) {
      console.log('[hitRateStats] Loading state - player exists but no data yet');
      // Return empty but with a flag that we're loading (chartData.length === 0 means we're waiting)
      return { overCount: 0, underCount: 0, total: 0, averages: [], totalBeforeFilters: undefined };
    }
    console.warn('[hitRateStats] No valid values found! Returning 0/0');
    return { overCount: 0, underCount: 0, total: 0, averages: [], totalBeforeFilters: propsMode === 'player' ? baseGameDataLength : undefined };
  }

  // Calculate statistical metrics
  const mean = validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
  const variance = validValues.reduce((sum, val) => {
    const diff = val - mean;
    return sum + (diff * diff);
  }, 0) / validValues.length;
  const stdDev = Math.sqrt(variance);
  const adjustedStdDev = Math.max(stdDev, 2); // Minimum stdDev to avoid division issues

  // Calculate actual hit rates by counting games where stat > bettingLine
  // This gives real hit rates, not probability-based estimates
  const total = chartData.length;
  let overCount = 0;
  let underCount = 0;

  if (Number.isFinite(bettingLine)) {
    // Count actual hits: how many games had stat > bettingLine
    validValues.forEach(val => {
      if (val > bettingLine!) {
        overCount++;
      } else {
        underCount++;
      }
    });
  } else {
    // If no betting line, can't calculate hit rates
    overCount = 0;
    underCount = total;
  }

  const safeReduce = (values: number[]): number => {
    if (!values.length) return 0;
    const total = values.reduce((sum, val) => sum + val, 0);
    return total / values.length;
  };

  const primaryValues = chartData
    .map(d => (Number.isFinite(d.value) ? d.value : Number(d.value)))
    .filter((v): v is number => Number.isFinite(v));

  const averages: AverageStatInfo[] = [];
  const statMeta = currentStatOptions.find(s => s.key === selectedStat);
  const baseLabel = statMeta ? statMeta.label : selectedStat.toUpperCase();
  const percentageStats = new Set(['fg3_pct', 'fg_pct', 'ft_pct', 'opp_fg_pct', 'opp_fg3_pct', 'opp_ft_pct']);
  const baseFormat: 'percent' | undefined = percentageStats.has(selectedStat) ? 'percent' : undefined;
  const primaryAverage = safeReduce(primaryValues);
  averages.push({ label: baseLabel, value: primaryAverage, format: baseFormat });

  if (['pra', 'pr', 'ra', 'pa'].includes(selectedStat)) {
    const parts = chartData.map((d: any) => {
      const stats = d && (d as any).stats;
      return stats || {};
    });
    const ptsValues = parts.map(p => Number(p.pts)).filter((v): v is number => Number.isFinite(v));
    const rebValues = parts.map(p => Number(p.reb)).filter((v): v is number => Number.isFinite(v));
    const astValues = parts.map(p => Number(p.ast)).filter((v): v is number => Number.isFinite(v));

    if (selectedStat === 'pra') {
      averages.push({ label: 'PTS', value: safeReduce(ptsValues) });
      averages.push({ label: 'REB', value: safeReduce(rebValues) });
      averages.push({ label: 'AST', value: safeReduce(astValues) });
    } else if (selectedStat === 'pr') {
      averages.push({ label: 'PTS', value: safeReduce(ptsValues) });
      averages.push({ label: 'REB', value: safeReduce(rebValues) });
    } else if (selectedStat === 'ra') {
      averages.push({ label: 'REB', value: safeReduce(rebValues) });
      averages.push({ label: 'AST', value: safeReduce(astValues) });
    } else if (selectedStat === 'pa') {
      averages.push({ label: 'PTS', value: safeReduce(ptsValues) });
      averages.push({ label: 'AST', value: safeReduce(astValues) });
    }
  } else if (selectedStat === 'fg3m') {
    const attempts = chartData
      .map((d: any) => Number((d?.stats as any)?.fg3a))
      .filter((v): v is number => Number.isFinite(v));
    averages.push({ label: '3PA', value: safeReduce(attempts) });
  } else if (selectedStat === 'fg3a') {
    const made = chartData
      .map((d: any) => Number((d?.stats as any)?.fg3m))
      .filter((v): v is number => Number.isFinite(v));
    averages.push({ label: '3PM', value: safeReduce(made) });
  }

  // Track total games before filters for "X/Y games" display (player mode only)
  const totalBeforeFilters = propsMode === 'player' ? baseGameDataLength : undefined;

  return { overCount, underCount, total, averages, totalBeforeFilters };
}

