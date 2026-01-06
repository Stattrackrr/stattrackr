import { useEffect } from 'react';

export interface UsePremiumStatsRestorationParams {
  resolvedPlayerId: string | null;
  hasPremium: boolean;
  advancedStats: any;
  shotDistanceData: any;
  setAdvancedStats: (stats: any) => void;
  setShotDistanceData: (data: any) => void;
}

/**
 * Custom hook to restore premium stats from sessionStorage when player ID is set
 */
export function usePremiumStatsRestoration({
  resolvedPlayerId,
  hasPremium,
  advancedStats,
  shotDistanceData,
  setAdvancedStats,
  setShotDistanceData,
}: UsePremiumStatsRestorationParams) {
  useEffect(() => {
    if (resolvedPlayerId && hasPremium && typeof window !== 'undefined') {
      // Only restore if stats aren't already loaded
      if (!advancedStats) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${resolvedPlayerId}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
            console.log('✅ Restored advanced stats from cache for player', resolvedPlayerId);
          }
        } catch (e) {
          console.error('Error restoring advanced stats:', e);
        }
      }
      
      if (!shotDistanceData) {
        try {
          const cachedShotData = sessionStorage.getItem(`shot_distance_${resolvedPlayerId}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
            console.log('✅ Restored shot chart data from cache for player', resolvedPlayerId);
          }
        } catch (e) {
          console.error('Error restoring shot chart data:', e);
        }
      }
    }
  }, [resolvedPlayerId, hasPremium, advancedStats, shotDistanceData, setAdvancedStats, setShotDistanceData]);
}


