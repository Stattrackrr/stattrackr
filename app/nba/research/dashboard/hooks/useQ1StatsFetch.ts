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
 * Merges regular + postseason rows. Note: BDL often has **no** `period=1` row for many games
 * (full-game stats exist); the UI treats those as unknown (—), not 0.
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
    const bust = '&refresh=1';
    const base = `/api/stats?player_id=${resolvedPlayerId}&season=${season}&period=1&per_page=100&max_pages=5&skip_dvp=1${bust}`;

    const controller = new AbortController();
    const urls = [`${base}&postseason=false`, `${base}&postseason=true`];

    const parseGameId = (raw: unknown): number | null => {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string') {
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };

    Promise.all(
      urls.map((url) =>
        fetch(url, { signal: controller.signal }).then((r) => r.json().catch(() => ({})))
      )
    )
      .then((responses: Array<{ data?: BallDontLieStats[] }>) => {
        const map: Q1StatsByGameId = {};
        for (const j of responses) {
          const data = Array.isArray(j?.data) ? j.data : [];
          for (const stat of data) {
            const gameId = parseGameId(stat?.game?.id);
            if (gameId == null) continue;
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
