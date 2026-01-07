import { useEffect, useRef } from 'react';
import { cachedFetch } from '@/lib/requestCache';
import { normalizeAbbr } from '@/lib/nbaAbbr';

/**
 * Aggressively prefetch all critical data when player is detected in URL
 * This makes production feel instant by warming up all APIs before they're needed
 */
export function useAggressivePrefetch({
  resolvedPlayerId,
  selectedPlayer,
  originalPlayerTeam,
  opponentTeam,
}: {
  resolvedPlayerId: string | null;
  selectedPlayer: any;
  originalPlayerTeam: string;
  opponentTeam: string;
}) {
  const prefetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Only prefetch if we have a player ID and haven't prefetched yet
    if (!resolvedPlayerId || prefetchedRef.current.has(resolvedPlayerId)) {
      return;
    }

    const playerId = resolvedPlayerId;
    const playerTeam = originalPlayerTeam || selectedPlayer?.teamAbbr;
    const oppTeam = opponentTeam;

    // Mark as prefetched to avoid duplicate prefetches
    prefetchedRef.current.add(playerId);

    console.log('[Aggressive Prefetch] 🚀 Starting parallel prefetch for player:', playerId);

    // Prefetch ALL critical data in parallel (non-blocking)
    Promise.allSettled([
      // 1. Prefetch stats (current season, regular season)
      cachedFetch(
        `/api/stats?player_id=${playerId}&season=${new Date().getFullYear()}&per_page=100&max_pages=5&postseason=false&skip_dvp=1`,
        undefined,
        60 * 60 * 1000 // 1 hour
      ).catch(() => null),

      // 2. Prefetch games (today's games)
      cachedFetch(
        `/api/bdl/games?start_date=${new Date().toISOString().split('T')[0]}&end_date=${new Date().toISOString().split('T')[0]}`,
        undefined,
        60 * 60 * 1000 // 1 hour
      ).catch(() => null),

      // 3. Prefetch player team depth chart
      playerTeam && playerTeam !== 'N/A'
        ? cachedFetch(
            `/api/depth-chart?team=${encodeURIComponent(normalizeAbbr(playerTeam))}`,
            undefined,
            300000 // 5 minutes
          ).catch(() => null)
        : Promise.resolve(null),

      // 4. Prefetch opponent team depth chart
      oppTeam && oppTeam !== 'N/A' && oppTeam !== playerTeam
        ? cachedFetch(
            `/api/depth-chart?team=${encodeURIComponent(normalizeAbbr(oppTeam))}`,
            undefined,
            300000 // 5 minutes
          ).catch(() => null)
        : Promise.resolve(null),

      // 5. Prefetch odds (if player has name)
      selectedPlayer?.full
        ? cachedFetch(
            `/api/odds?sport=nba&player=${encodeURIComponent(selectedPlayer.full)}&market=points`,
            undefined,
            30 * 60 * 1000 // 30 minutes
          ).catch(() => null)
        : Promise.resolve(null),
    ]).then((results) => {
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      console.log(`[Aggressive Prefetch] ✅ Completed: ${successCount}/${results.length} prefetches successful`);
    });
  }, [resolvedPlayerId, originalPlayerTeam, opponentTeam, selectedPlayer]);
}

