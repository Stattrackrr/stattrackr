import { useRef } from 'react';
import { AdvancedStats } from '../types';
import { fetchAdvancedStatsCore, fetchShotDistanceStatsCore } from '../utils/playerDataUtils';

export interface UsePremiumStatsParams {
  hasPremium: boolean;
  setAdvancedStats: (stats: AdvancedStats | null) => void;
  setAdvancedStatsLoading: (loading: boolean) => void;
  setAdvancedStatsError: (error: string | null) => void;
  setShotDistanceData: (data: any) => void;
  setShotDistanceLoading: (loading: boolean) => void;
}

/**
 * Custom hook for fetching premium stats (advanced stats and shot distance stats)
 */
export function usePremiumStats({
  hasPremium,
  setAdvancedStats,
  setAdvancedStatsLoading,
  setAdvancedStatsError,
  setShotDistanceData,
  setShotDistanceLoading,
}: UsePremiumStatsParams) {
  const advancedStatsFetchRef = useRef<string | null>(null);
  const shotDistanceFetchRef = useRef<string | null>(null);

  const fetchAdvancedStats = async (playerId: string) => {
    // Don't attempt to fetch if user doesn't have premium - just silently return
    // The UI will already be gated by checkFeatureAccess elsewhere
    if (!hasPremium) {
      setAdvancedStats(null);
      setAdvancedStatsLoading(false);
      return;
    }
    
    // Mark this fetch as the current one
    advancedStatsFetchRef.current = playerId;
    
    // Check if we already have cached data - if so, don't clear it (preserve on refresh)
    const hasCachedData = typeof window !== 'undefined' && sessionStorage.getItem(`advanced_stats_${playerId}`);
    
    // Only clear if we don't have cached data (to preserve restored stats on refresh)
    if (!hasCachedData) {
      setAdvancedStats(null);
    }
    setAdvancedStatsLoading(true);
    setAdvancedStatsError(null);
    
    try {
      const stats = await fetchAdvancedStatsCore(playerId);
      
      // Only update if this is still the current fetch (prevent race conditions)
      if (advancedStatsFetchRef.current === playerId) {
        if (stats) {
          setAdvancedStats(stats);
          // Save to sessionStorage for persistence across refreshes
          if (typeof window !== 'undefined') {
            try {
              const storageKey = `advanced_stats_${playerId}`;
              sessionStorage.setItem(storageKey, JSON.stringify(stats));
            } catch (e) {
              // Ignore storage errors
            }
          }
        } else {
          setAdvancedStats(null);
          setAdvancedStatsError('No advanced stats found for this player');
        }
      }
    } catch (error: any) {
      // Only update if this is still the current fetch
      if (advancedStatsFetchRef.current === playerId) {
        setAdvancedStatsError(error.message || 'Failed to fetch advanced stats');
        setAdvancedStats(null);
      }
    } finally {
      // Only update loading state if this is still the current fetch
      if (advancedStatsFetchRef.current === playerId) {
        setAdvancedStatsLoading(false);
      }
    }
  };
  
  // Fetch shot distance stats for a player
  const fetchShotDistanceStats = async (playerId: string) => {
    // Don't attempt to fetch if user doesn't have premium - just silently return
    // The UI will already be gated by checkFeatureAccess elsewhere
    if (!hasPremium) {
      setShotDistanceData(null);
      setShotDistanceLoading(false);
      return;
    }
    
    // Mark this fetch as the current one
    shotDistanceFetchRef.current = playerId;
    
    // Check if we already have cached data - if so, don't clear it (preserve on refresh)
    const hasCachedData = typeof window !== 'undefined' && sessionStorage.getItem(`shot_distance_${playerId}`);
    
    // Only clear if we don't have cached data (to preserve restored stats on refresh)
    if (!hasCachedData) {
      setShotDistanceData(null);
    }
    setShotDistanceLoading(true);
    
    try {
      const shotData = await fetchShotDistanceStatsCore(playerId);
      
      // Only update if this is still the current fetch (prevent race conditions)
      if (shotDistanceFetchRef.current === playerId) {
        if (shotData) {
          setShotDistanceData(shotData);
          // Save to sessionStorage for persistence across refreshes
          if (typeof window !== 'undefined') {
            try {
              const storageKey = `shot_distance_${playerId}`;
              sessionStorage.setItem(storageKey, JSON.stringify(shotData));
            } catch (e) {
              // Ignore storage errors
            }
          }
        } else {
          setShotDistanceData(null);
        }
      }
    } catch (error) {
      // Only update if this is still the current fetch
      if (shotDistanceFetchRef.current === playerId) {
        console.error('Failed to fetch shot distance stats:', error);
        setShotDistanceData(null);
      }
    } finally {
      // Only update loading state if this is still the current fetch
      if (shotDistanceFetchRef.current === playerId) {
        setShotDistanceLoading(false);
      }
    }
  };

  return {
    fetchAdvancedStats,
    fetchShotDistanceStats,
  };
}

