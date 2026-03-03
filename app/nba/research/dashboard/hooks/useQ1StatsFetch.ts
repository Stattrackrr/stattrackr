import { useEffect, useRef } from 'react';
import { BallDontLieStats } from '../types';
import { currentNbaSeason } from '../utils/playerUtils';

export type Q1StatsByGameId = Record<number, { pts: number; reb: number; ast: number }>;

export interface UseQ1StatsFetchParams {
  propsMode: 'player' | 'team';
  resolvedPlayerId: string | null;
  playerStats: BallDontLieStats[];
  setQ1StatsByGameId: (map: Q1StatsByGameId | ((prev: Q1StatsByGameId) => Q1StatsByGameId)) => void;
}

/**
 * Fetches 1st quarter pts/reb/ast from BDL stats API (period=1) when we have player stats.
 * Only for completed games. Builds a map by game_id for the Game Log table.
 */
export function useQ1StatsFetch({
  propsMode,
  resolvedPlayerId,
  playerStats,
  setQ1StatsByGameId,
}: UseQ1StatsFetchParams) {
  const lastPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (propsMode !== 'player' || !resolvedPlayerId || !playerStats.length) {
      if (resolvedPlayerId !== lastPlayerIdRef.current) {
        setQ1StatsByGameId({});
        lastPlayerIdRef.current = resolvedPlayerId;
      }
      return;
    }

    lastPlayerIdRef.current = resolvedPlayerId;
    const season = currentNbaSeason();

    const controller = new AbortController();
    const url = `/api/stats?player_id=${resolvedPlayerId}&season=${season}&period=1&per_page=100&max_pages=5&postseason=false&skip_dvp=1`;

    fetch(url, { signal: controller.signal })
      .then((r) => r.json().catch(() => ({})))
      .then((j: { data?: BallDontLieStats[] }) => {
        const data = Array.isArray(j?.data) ? j.data : [];
        const map: Q1StatsByGameId = {};
        for (const stat of data) {
          const gameId = stat?.game?.id;
          if (typeof gameId === 'number' && !isNaN(gameId)) {
            map[gameId] = {
              pts: stat.pts ?? 0,
              reb: stat.reb ?? 0,
              ast: stat.ast ?? 0,
            };
          }
        }
        setQ1StatsByGameId(() => map);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setQ1StatsByGameId({});
      });

    return () => controller.abort();
  }, [propsMode, resolvedPlayerId, playerStats.length, setQ1StatsByGameId]);
}
