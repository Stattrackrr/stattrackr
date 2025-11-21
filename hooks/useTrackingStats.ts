// hooks/useTrackingStats.ts
import { useState, useEffect } from 'react';
import { TrackingStatsResponse, TrackingStatsError } from '@/lib/types/trackingStats';

interface UseTrackingStatsOptions {
  playerId: string | null;
  season?: number;
  perMode?: 'PerGame' | 'Totals' | 'Per36';
  seasonType?: 'Regular Season' | 'Playoffs';
  enabled?: boolean;
}

interface UseTrackingStatsResult {
  data: TrackingStatsResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTrackingStats({
  playerId,
  season,
  perMode = 'PerGame',
  seasonType = 'Regular Season',
  enabled = true,
}: UseTrackingStatsOptions): UseTrackingStatsResult {
  const [data, setData] = useState<TrackingStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    if (!playerId || !enabled) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        player_id: playerId,
        per_mode: perMode,
        season_type: seasonType,
      });

      if (season) {
        params.set('season', season.toString());
      }

      const response = await fetch(`/api/tracking-stats?${params.toString()}`);
      
      if (!response.ok) {
        let errorMessage = 'Failed to fetch tracking stats';
        try {
          const errorData: TrackingStatsError = await response.json();
          errorMessage = errorData.details || errorData.error || errorMessage;
        } catch {
          // If we can't parse error JSON, use status text
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        
        // Log as warning instead of error for 404 (expected for some players)
        if (response.status === 404) {
          console.warn('[useTrackingStats] No tracking data:', errorMessage);
        } else {
          console.error('[useTrackingStats] Error:', errorMessage);
        }
        
        throw new Error(errorMessage);
      }

      const result: TrackingStatsResponse = await response.json();
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(message);
      // Already logged above, don't log again
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [playerId, season, perMode, seasonType, enabled]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}

