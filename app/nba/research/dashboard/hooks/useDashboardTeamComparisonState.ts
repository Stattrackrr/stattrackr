'use client';

import { useState } from 'react';

export function useDashboardTeamComparisonState() {
  // Time filter for opponent breakdown display
  const [selectedTimeFilter] = useState('last10'); // Using existing selectedTimeframe as reference
  
  // Team comparison metric selector
  const [selectedComparison, setSelectedComparison] = useState<'points' | 'rebounds' | 'assists' | 'fg_pct' | 'three_pct'>('points');
  
  // State for team matchup stats (fetched from DVP API)
  const [teamMatchupStats, setTeamMatchupStats] = useState<{currentTeam: any, opponent: any}>({currentTeam: null, opponent: null});
  const [teamMatchupLoading, setTeamMatchupLoading] = useState(false);
  
  // Pie chart display order (only affects visual display, not underlying data)
  const [pieChartSwapped, setPieChartSwapped] = useState(false);

  return {
    selectedTimeFilter,
    selectedComparison,
    setSelectedComparison,
    teamMatchupStats,
    setTeamMatchupStats,
    teamMatchupLoading,
    setTeamMatchupLoading,
    pieChartSwapped,
    setPieChartSwapped,
  };
}

