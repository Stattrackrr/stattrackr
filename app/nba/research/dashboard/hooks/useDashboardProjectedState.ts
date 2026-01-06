'use client';

import { useState } from 'react';

export function useDashboardProjectedState() {
  const [predictedPace, setPredictedPace] = useState<number | null>(null); // Predicted game pace from betting total
  const [seasonFgPct, setSeasonFgPct] = useState<number | null>(null); // Season average FG%
  const [averageUsageRate, setAverageUsageRate] = useState<number | null>(null); // Season average usage rate
  const [averageMinutes, setAverageMinutes] = useState<number | null>(null); // Season average minutes
  const [averageGamePace, setAverageGamePace] = useState<number | null>(null); // Average game pace from player's games

  return {
    predictedPace,
    setPredictedPace,
    seasonFgPct,
    setSeasonFgPct,
    averageUsageRate,
    setAverageUsageRate,
    averageMinutes,
    setAverageMinutes,
    averageGamePace,
    setAverageGamePace,
  };
}

