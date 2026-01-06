'use client';

import { useState } from 'react';
import { DepthChartData } from '../types';

export function useDashboardTeamState() {
  // Opponent team state
  const [opponentTeam, setOpponentTeam] = useState<string>('N/A');
  
  // Manual opponent selector (overrides automatic opponent detection)
  const [manualOpponent, setManualOpponent] = useState<string>('ALL');

  // Home/Away filter
  const [homeAway, setHomeAway] = useState<'ALL' | 'HOME' | 'AWAY'>('ALL');

  // Selected team (player's team - only for Player Props)
  const [selectedTeam, setSelectedTeam] = useState<string>('N/A');

  // Original player team (the team of the searched player - never changes during swaps)
  const [originalPlayerTeam, setOriginalPlayerTeam] = useState<string>('N/A');
  
  // Separate team selection for Game Props mode
  const [gamePropsTeam, setGamePropsTeam] = useState<string>('N/A');
  const [gamePropsOpponent, setGamePropsOpponent] = useState<string>('N/A');

  // Depth chart display team (independent of selectedTeam - only affects depth chart)
  const [depthChartTeam, setDepthChartTeam] = useState<string>('N/A');

  // Injury data state for depth chart integration
  const [teamInjuries, setTeamInjuries] = useState<Record<string, any[]>>({});
  
  // Store both team rosters for instant switching
  const [playerTeamRoster, setPlayerTeamRoster] = useState<DepthChartData | null>(null);
  const [opponentTeamRoster, setOpponentTeamRoster] = useState<DepthChartData | null>(null);
  const [rostersLoading, setRostersLoading] = useState<{player: boolean, opponent: boolean}>({player: false, opponent: false});

  // Logo URLs (stateful to avoid onError flicker loops)
  const [selectedTeamLogoUrl, setSelectedTeamLogoUrl] = useState<string>('');
  const [opponentTeamLogoUrl, setOpponentTeamLogoUrl] = useState<string>('');
  const [selectedTeamLogoAttempt, setSelectedTeamLogoAttempt] = useState<number>(0);
  const [opponentTeamLogoAttempt, setOpponentTeamLogoAttempt] = useState<number>(0);

  // Comprehensive roster cache - preload ALL team rosters for instant switching
  const [allTeamRosters, setAllTeamRosters] = useState<Record<string, DepthChartData>>({});
  const [rosterCacheLoading, setRosterCacheLoading] = useState(false);

  // Next game info for tracking (separate from chart filter)
  const [nextGameOpponent, setNextGameOpponent] = useState<string>('');
  const [nextGameDate, setNextGameDate] = useState<string>('');
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);

  // Countdown timer state
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);

  return {
    // Opponent
    opponentTeam,
    setOpponentTeam,
    manualOpponent,
    setManualOpponent,
    homeAway,
    setHomeAway,
    // Teams
    selectedTeam,
    setSelectedTeam,
    originalPlayerTeam,
    setOriginalPlayerTeam,
    gamePropsTeam,
    setGamePropsTeam,
    gamePropsOpponent,
    setGamePropsOpponent,
    depthChartTeam,
    setDepthChartTeam,
    // Injuries
    teamInjuries,
    setTeamInjuries,
    // Rosters
    playerTeamRoster,
    setPlayerTeamRoster,
    opponentTeamRoster,
    setOpponentTeamRoster,
    rostersLoading,
    setRostersLoading,
    // Logos
    selectedTeamLogoUrl,
    setSelectedTeamLogoUrl,
    opponentTeamLogoUrl,
    setOpponentTeamLogoUrl,
    selectedTeamLogoAttempt,
    setSelectedTeamLogoAttempt,
    opponentTeamLogoAttempt,
    setOpponentTeamLogoAttempt,
    // Roster cache
    allTeamRosters,
    setAllTeamRosters,
    rosterCacheLoading,
    setRosterCacheLoading,
    // Next game
    nextGameOpponent,
    setNextGameOpponent,
    nextGameDate,
    setNextGameDate,
    nextGameTipoff,
    setNextGameTipoff,
    isGameInProgress,
    setIsGameInProgress,
    // Countdown
    countdown,
    setCountdown,
  };
}

