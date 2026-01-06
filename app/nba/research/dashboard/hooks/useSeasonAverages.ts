import { useEffect } from 'react';
import { parseMinutes } from '@/lib/nbaPlayers';
import { getTeamPace } from '@/lib/nbaPace';
import { normalizeAbbr } from '@/lib/nbaAbbr';

export interface UseSeasonAveragesParams {
  propsMode: 'player' | 'team';
  playerStats: any[];
  setSeasonFgPct: (pct: number | null) => void;
  setAverageUsageRate: (rate: number | null) => void;
  setAverageMinutes: (minutes: number | null) => void;
  setAverageGamePace: (pace: number | null) => void;
}

/**
 * Custom hook to calculate season averages (FG%, minutes, game pace) from playerStats
 */
export function useSeasonAverages({
  propsMode,
  playerStats,
  setSeasonFgPct,
  setAverageUsageRate,
  setAverageMinutes,
  setAverageGamePace,
}: UseSeasonAveragesParams) {
  useEffect(() => {
    if (!playerStats || playerStats.length === 0 || propsMode !== 'player') {
      setSeasonFgPct(null);
      setAverageUsageRate(null);
      setAverageMinutes(null);
      setAverageGamePace(null);
      return;
    }

    // Calculate average FG% from all games
    const fgPctValues = playerStats
      .map(stats => stats.fg_pct)
      .filter((pct): pct is number => pct !== null && pct !== undefined && !isNaN(pct));

    if (fgPctValues.length === 0) {
      setSeasonFgPct(null);
    } else {
      const averageFgPct = fgPctValues.reduce((sum, pct) => sum + pct, 0) / fgPctValues.length;
      // Convert to percentage (multiply by 100)
      setSeasonFgPct(averageFgPct * 100);
    }

    // Calculate average minutes from all games
    const minutesValues = playerStats
      .map(stats => parseMinutes(stats.min))
      .filter((min): min is number => min !== null && min !== undefined && !isNaN(min) && min > 0);

    if (minutesValues.length === 0) {
      setAverageMinutes(null);
    } else {
      const avgMinutes = minutesValues.reduce((sum, min) => sum + min, 0) / minutesValues.length;
      setAverageMinutes(avgMinutes);
    }

    // Calculate average game pace from all games
    const paceValues: number[] = [];
    for (const stats of playerStats) {
      const game = stats.game;
      if (!game) continue;

      const homeTeam = game.home_team?.abbreviation;
      const awayTeam = game.visitor_team?.abbreviation;
      
      if (!homeTeam || !awayTeam) continue;

      const homePace = getTeamPace(normalizeAbbr(homeTeam));
      const awayPace = getTeamPace(normalizeAbbr(awayTeam));

      if (homePace > 0 && awayPace > 0) {
        const gamePace = (homePace + awayPace) / 2;
        paceValues.push(gamePace);
      }
    }

    if (paceValues.length === 0) {
      setAverageGamePace(null);
    } else {
      const avgPace = paceValues.reduce((sum, pace) => sum + pace, 0) / paceValues.length;
      setAverageGamePace(avgPace);
    }
  }, [playerStats, propsMode, setSeasonFgPct, setAverageUsageRate, setAverageMinutes, setAverageGamePace]);
}

