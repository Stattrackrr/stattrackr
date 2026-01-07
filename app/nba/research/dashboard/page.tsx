'use client';

import { DashboardLeftSidebarWrapper } from './components/DashboardLeftSidebarWrapper';
import { useTheme } from "@/contexts/ThemeContext";
import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useMemo, useRef, useEffect, memo, useCallback, Suspense, startTransition, useDeferredValue, lazy } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Cell, Tooltip, LabelList,
  PieChart, Pie
} from 'recharts';
import { getPlayerById, formatHeight, NBAPlayer, SAMPLE_PLAYERS } from '@/lib/nbaPlayers';
import { BallDontLieAPI } from './api';
import { 
  AdvancedStats, 
  DepthPos, 
  DepthChartPlayer, 
  DepthChartData, 
  OddsFormat, 
  BookRow,
  DerivedOdds,
  MovementRow,
  MatchupInfo,
  OfficialOddsCardProps,
  BallDontLieGame,
  BallDontLieStats,
  BdlSearchResult,
  EspnPlayerData,
  SavedSession,
  SESSION_KEY,
  AverageStatInfo,
  HitRateStats,
  PredictedOutcomeResult
} from './types';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { getFullTeamName, getTeamAbbr } from '@/lib/teamMapping';
import { OddsSnapshot } from '@/lib/odds';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import InjuryContainer from '@/components/InjuryContainer';
import DepthChartContainer from './components/DepthChartContainer';
import { cachedFetch } from '@/lib/requestCache';
import StaticBarsChart from './components/charts/StaticBarsChart';
import { RangeSlider } from './components/charts';
import SimpleChart from './components/charts/SimpleChart';
import { useSubscription } from '@/hooks/useSubscription';
import { OfficialOddsCard, BestOddsTable, BestOddsTableDesktop } from './components/odds';
import { PositionDefenseCard, OpponentAnalysisCard } from './components/dvp';
import { HomeAwaySelect, OverRatePill } from './components/ui';
import ChartControls from './components/ChartControls';
import ChartContainer from './components/ChartContainer';
import PlayerBoxScore from './components/PlayerBoxScore';
import { CHART_CONFIG, SECOND_AXIS_FILTER_OPTIONS, PLAYER_STAT_OPTIONS, TEAM_STAT_OPTIONS, PLACEHOLDER_BOOK_ROWS, LINE_MOVEMENT_ENABLED } from './constants';
import { updateBettingLinePosition, getUnifiedTooltipStyle } from './utils/chartUtils';
import { AltLineItem, partitionAltLineItems, cloneBookRow, mergeBookRowsByBaseName, getBookRowKey, americanToDecimal, normalizeAmerican } from './utils/oddsUtils';
import { calculateAvailableBookmakers } from './utils/bookmakerUtils';
import { 
  TEAM_ID_TO_ABBR, 
  ABBR_TO_TEAM_ID, 
  TEAM_FULL_NAMES,
  getEspnLogoCandidates,
  getEspnLogoUrl,
  getEspnFallbackLogoUrl
} from './utils/teamUtils';
import {
  opponentDefensiveStats,
  getOpponentDefensiveRank,
  getOpponentDefensiveRankColor,
  teamRatings,
  teamPace,
  teamReboundPct,
  getTeamRating,
  getTeamRank,
  getTeamPace,
  getTeamReboundPct,
  getPaceRank,
  getOrdinalSuffix
} from './utils/teamStats';
import { getStatValue, getGameStatValue } from './utils/statUtils';
import { currentNbaSeason, parseMinutes } from './utils/playerUtils';
import { fetchBdlPlayerData, parseBdlHeight, resolvePlayerId, parseEspnHeight, fetchEspnPlayerData, fetchEspnPlayerDataCore, fetchAdvancedStatsCore, fetchShotDistanceStatsCore } from './utils/playerDataUtils';
import { fetchTeamDepthChart, resolveTeammateIdFromName } from './utils/depthChartUtils';
import { getEasternOffsetMinutes, parseBallDontLieTipoff } from './utils/dateUtils';
import { useTeammateFilterData } from './hooks/useTeammateFilterData';
import { useAverageUsageRate } from './hooks/useAverageUsageRate';
import { useTeammatePrefetch } from './hooks/useTeammatePrefetch';
import { useAuthHandlers } from './hooks/useAuthHandlers';
import { useRosterPreloading } from './hooks/useRosterPreloading';
import { useTeamRosterPrefetch } from './hooks/useTeamRosterPrefetch';
import { useTeamInjuries } from './hooks/useTeamInjuries';
import { usePremiumStats } from './hooks/usePremiumStats';
import { useSeasonAverages } from './hooks/useSeasonAverages';
import { usePredictedPace } from './hooks/usePredictedPace';
import { usePlayerSelection } from './hooks/usePlayerSelection';
import { useOddsFetching } from './hooks/useOddsFetching';
import { useUrlInitialization } from './hooks/useUrlInitialization';
import { useDvpRankPrefetch } from './hooks/useDvpRankPrefetch';
import { useAdvancedStatsPrefetch } from './hooks/useAdvancedStatsPrefetch';
import { useAggressivePrefetch } from './hooks/useAggressivePrefetch';
import { useSearch } from './hooks/useSearch';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { useTimeframeRestoration } from './hooks/useTimeframeRestoration';
import { usePlayerStateManagement } from './hooks/usePlayerStateManagement';
import { useNextGameCalculation } from './hooks/useNextGameCalculation';
import { useLastSeasonStatsFetch } from './hooks/useLastSeasonStatsFetch';
import { useTeamLogos } from './hooks/useTeamLogos';
import { useTeamMatchupStats } from './hooks/useTeamMatchupStats';
import { useOpponentUpdate } from './hooks/useOpponentUpdate';
import { useGamesLoading } from './hooks/useGamesLoading';
import { useH2hOpponentSelection } from './hooks/useH2hOpponentSelection';
import { useTeamModeGameData } from './hooks/useTeamModeGameData';
import { usePremiumStatsRestoration } from './hooks/usePremiumStatsRestoration';
import { useTeammateFilterReset } from './hooks/useTeammateFilterReset';
import { useCoreDataReady } from './hooks/useCoreDataReady';
import { useLast5GamesPrefetch } from './hooks/useLast5GamesPrefetch';
import { useDropdownClose } from './hooks/useDropdownClose';
import { useBestLineUpdate } from './hooks/useBestLineUpdate';
import { useSliderRangeInit } from './hooks/useSliderRangeInit';
import { useSubscriptionSuccess } from './hooks/useSubscriptionSuccess';
import { useProfileMenuClose } from './hooks/useProfileMenuClose';
import { useOddsFormat } from './hooks/useOddsFormat';
import { useCountdownTimer } from './hooks/useCountdownTimer';
import { useSubscriptionCheck } from './hooks/useSubscriptionCheck';
import { useLineMovement } from './hooks/useLineMovement';
import { useStatUrlSync } from './hooks/useStatUrlSync';
import { useOddsCalculations } from './hooks/useOddsCalculations';
import { useTeamGameFetching } from './hooks/useTeamGameFetching';
import { useTodaysGamesFetching } from './hooks/useTodaysGamesFetching';
import { useChartConfig } from './hooks/useChartConfig';
import { useOddsDerivedData } from './hooks/useOddsDerivedData';
import { useGameDataProcessing } from './hooks/useGameDataProcessing';
import { useChartDataProcessing } from './hooks/useChartDataProcessing';
import { useSimpleCalculations } from './hooks/useSimpleCalculations';
import { useDashboardUIState } from './hooks/useDashboardUIState';
import { useDashboardModeState } from './hooks/useDashboardModeState';
import { useDashboardPlayerState } from './hooks/useDashboardPlayerState';
import { useDashboardTeamState } from './hooks/useDashboardTeamState';
import { useDashboardOddsState } from './hooks/useDashboardOddsState';
import { useDashboardProjectedState } from './hooks/useDashboardProjectedState';
import { useDashboardTeammateState } from './hooks/useDashboardTeammateState';
import { useDashboardTeamComparisonState } from './hooks/useDashboardTeamComparisonState';
import { useRosterCalculations } from './hooks/useRosterCalculations';
import { useBettingLine } from './hooks/useBettingLine';
import { useFilterSelection } from './hooks/useFilterSelection';
import { useIntradayMovements } from './hooks/useIntradayMovements';
import { useDashboardUtils } from './hooks/useDashboardUtils';
import { useDashboardRefs } from './hooks/useDashboardRefs';
import { useDashboardStyles } from './hooks/useDashboardStyles';
import { useDashboardComputedProps } from './hooks/useDashboardComputedProps';
import { DashboardStyles } from './components/DashboardStyles';
import { DashboardHeader } from './components/DashboardHeader';
import { DashboardRightPanel } from './components/DashboardRightPanel';
import { DashboardMobileAnalysis } from './components/DashboardMobileAnalysis';
import { DashboardMobileContent } from './components/DashboardMobileContent';
import { DashboardDesktopContent } from './components/DashboardDesktopContent';
import { DashboardModeToggle } from './components/DashboardModeToggle';
import { DashboardJournalModals } from './components/DashboardJournalModals';
import NBADashboardWrapper from './components/NBADashboardWrapper';
import { getReboundRank, getRankColor, createTeamComparisonPieData, getPlayerCurrentTeam, getOpponentTeam } from './utils/teamAnalysisUtils';
import { getSavedSession, saveSession, getLocalStorage, setLocalStorage, updateSessionProperty } from './utils/storageUtils';
import { HeaderNavigation, MobileBottomNavigation } from './components/header';

// Lazy load heavy components for better initial bundle size
const TeamTrackingStatsTable = lazy(() => import('@/components/TeamTrackingStatsTable').then(mod => ({ default: mod.TeamTrackingStatsTable })));
import NotificationSystem from '@/components/NotificationSystem';
import { getBookmakerInfo as getBookmakerInfoFromLib } from '@/lib/bookmakers';
import Image from 'next/image';

export function NBADashboardContent() {
  const router = useRouter();
  const { isDark, theme, setTheme } = useTheme();
  const { handleLogout, handleSidebarSubscription: handleSidebarSubscriptionBase } = useAuthHandlers();
  
  // Dashboard UI state - extracted to useDashboardUIState hook
  const {
    userEmail,
    setUserEmail,
    username,
    setUsername,
    avatarUrl,
    setAvatarUrl,
    isPro,
    setIsPro,
    showJournalDropdown,
    setShowJournalDropdown,
    journalDropdownRef,
    showProfileDropdown,
    setShowProfileDropdown,
    profileDropdownRef,
    showSettingsDropdown,
    setShowSettingsDropdown,
    settingsDropdownRef,
    minMinutesFilter,
    setMinMinutesFilter,
    maxMinutesFilter,
    setMaxMinutesFilter,
    excludeBlowouts,
    setExcludeBlowouts,
    excludeBackToBack,
    setExcludeBackToBack,
    isAdvancedFiltersOpen,
    setIsAdvancedFiltersOpen,
    isMinutesFilterOpen,
    setIsMinutesFilterOpen,
    showJournalModal,
    setShowJournalModal,
    sidebarOpen,
    setSidebarOpen,
  } = useDashboardUIState();

  // Subscription success check - extracted to useSubscriptionSuccess hook
  useSubscriptionSuccess();

  // Get user info and subscription status on mount
  // Cache subscription status to avoid frequent checks
  // Subscription check - extracted to useSubscriptionCheck hook
  useSubscriptionCheck({
    setUserEmail,
    setUsername,
    setAvatarUrl,
    setIsPro,
  });

  // Profile menu close - extracted to useProfileMenuClose hook
  useProfileMenuClose({
    journalDropdownRef,
    profileDropdownRef,
    settingsDropdownRef,
    setShowJournalDropdown,
    setShowProfileDropdown,
    setShowSettingsDropdown,
  });

  // Dashboard mode state - extracted to useDashboardModeState hook
  const {
    propsMode,
    setPropsMode,
    selectedStat,
    setSelectedStat,
    selectedFilterForAxis,
    setSelectedFilterForAxis,
    dvpProjectedTab,
    setDvpProjectedTab,
    sliderRange,
    setSliderRange,
    selectedTimeframe,
    setSelectedTimeframe,
  } = useDashboardModeState();

  // Dashboard projected state - extracted to useDashboardProjectedState hook
  const {
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
  } = useDashboardProjectedState();
  
  // Filter selection handler - extracted to useFilterSelection hook
  const { handleSelectFilterForAxis } = useFilterSelection({
    setSelectedFilterForAxis,
    setSliderRange,
  });
  
  // Dashboard refs - extracted to useDashboardRefs hook
  const {
    statFromUrlRef,
    userSelectedStatRef,
    hasManuallySetLineRef,
    lastAutoSetStatRef,
    lastAutoSetLineRef,
    searchRef,
    dvpRanksPrefetchRef,
    teammateFetchAbortControllerRef,
    teammateFetchInProgressRef,
  } = useDashboardRefs();
  
  // Dashboard odds state - extracted to useDashboardOddsState hook
  const {
    bettingLines,
    setBettingLines,
    bookOpeningLine,
    setBookOpeningLine,
    bookCurrentLine,
    setBookCurrentLine,
    oddsSnapshots,
    setOddsSnapshots,
    marketKey,
    lineMovementData,
    setLineMovementData,
    lineMovementLoading,
    setLineMovementLoading,
    oddsFormat,
    setOddsFormat,
    realOddsData,
    setRealOddsData,
    oddsLoading,
    setOddsLoading,
    oddsError,
    setOddsError,
  } = useDashboardOddsState();

  // Odds format from localStorage - extracted to useOddsFormat hook
  useOddsFormat({ setOddsFormat });

  // Intraday movements - extracted to useIntradayMovements hook
  const { intradayMovements } = useIntradayMovements({
    lineMovementData,
    oddsSnapshots,
    marketKey,
  });

  // Betting line logic - extracted to useBettingLine hook
  const { bettingLine, setBettingLine } = useBettingLine({
    bettingLines,
    setBettingLines,
    selectedStat,
  });

  // Dashboard player state - extracted to useDashboardPlayerState hook
  const {
    selectedPlayer,
    setSelectedPlayer,
    resolvedPlayerId,
    setResolvedPlayerId,
    playerStats,
    setPlayerStats,
    isLoading,
    setIsLoading,
    coreDataReady,
    setCoreDataReady,
    apiError,
    setApiError,
    advancedStats,
    setAdvancedStats,
    advancedStatsLoading,
    setAdvancedStatsLoading,
    advancedStatsError,
    setAdvancedStatsError,
    advancedStatsPerGame,
    setAdvancedStatsPerGame,
    dvpRanksPerGame,
    setDvpRanksPerGame,
    shotDistanceData,
    setShotDistanceData,
    shotDistanceLoading,
    setShotDistanceLoading,
    searchQuery,
    setSearchQuery,
    showDropdown,
    setShowDropdown,
    searchBusy,
    setSearchBusy,
    searchResults,
    setSearchResults,
    searchError,
    setSearchError,
    isMobileSearchOpen,
    setIsMobileSearchOpen,
  } = useDashboardPlayerState();
  
  // Dashboard team state - extracted to useDashboardTeamState hook
  const {
    opponentTeam,
    setOpponentTeam,
    manualOpponent,
    setManualOpponent,
    homeAway,
    setHomeAway,
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
    teamInjuries,
    setTeamInjuries,
    playerTeamRoster,
    setPlayerTeamRoster,
    opponentTeamRoster,
    setOpponentTeamRoster,
    rostersLoading,
    setRostersLoading,
    selectedTeamLogoUrl,
    setSelectedTeamLogoUrl,
    opponentTeamLogoUrl,
    setOpponentTeamLogoUrl,
    selectedTeamLogoAttempt,
    setSelectedTeamLogoAttempt,
    opponentTeamLogoAttempt,
    setOpponentTeamLogoAttempt,
    allTeamRosters,
    setAllTeamRosters,
    rosterCacheLoading,
    setRosterCacheLoading,
    nextGameOpponent,
    setNextGameOpponent,
    nextGameDate,
    setNextGameDate,
    nextGameTipoff,
    setNextGameTipoff,
    isGameInProgress,
    setIsGameInProgress,
    countdown,
    setCountdown,
  } = useDashboardTeamState();
  
  // Stat URL synchronization - extracted to useStatUrlSync hook (must be after setOpponentTeam is declared)
  const { handleStatSelect } = useStatUrlSync({
    selectedStat,
    setSelectedStat,
    propsMode,
    isPro,
    setPropsMode,
    setOpponentTeam,
    statFromUrlRef,
    userSelectedStatRef,
  });
  
  // Game stats for team props (separate from player stats)
  const [gameStats, setGameStats] = useState<any[]>([]);
  const [gameStatsLoading, setGameStatsLoading] = useState(false);

  // Today's games fetching - extracted to useTodaysGamesFetching hook
  const {
    todaysGames,
    setTodaysGames,
    gamesLoading,
    setGamesLoading,
    fetchTodaysGames,
  } = useTodaysGamesFetching();

  
  // Line movement fetching - extracted to useLineMovement hook
  useLineMovement({
    propsMode,
    selectedPlayer,
    selectedTeam,
    opponentTeam,
    selectedStat,
    todaysGames,
    setLineMovementData,
    setLineMovementLoading,
  });
  
  // Odds fetching - extracted to useOddsFetching hook
  useOddsFetching({
    propsMode,
    selectedPlayer,
    gamePropsTeam,
    realOddsData,
    oddsLoading,
    setRealOddsData,
    setOddsLoading,
    setOddsError,
  });
  
  // Dashboard team comparison state - extracted to useDashboardTeamComparisonState hook
  const {
    selectedTimeFilter,
    selectedComparison,
    setSelectedComparison,
    teamMatchupStats,
    setTeamMatchupStats,
    teamMatchupLoading,
    setTeamMatchupLoading,
    pieChartSwapped,
    setPieChartSwapped,
  } = useDashboardTeamComparisonState();
  
  // Subscription/paywall state
  const { 
    hasPremium, 
    checkFeatureAccess,
    subscription,
    loading: subscriptionLoading
  } = useSubscription();
  
  // Countdown timer - extracted to useCountdownTimer hook
  useCountdownTimer({
    nextGameTipoff,
    isGameInProgress,
    setCountdown,
  });


  // Team game fetching - extracted to useTeamGameFetching hook
  const {
    fetchTeamGamesData,
    fetchGameDataForTeam,
    cacheAllTeamsInBackground,
    teamGameCache,
    backgroundCacheLoading,
    cacheProgress,
  } = useTeamGameFetching({
    setGameStats,
    setGameStatsLoading,
  });

  // Last 5 games prefetch - extracted to useLast5GamesPrefetch hook
  useLast5GamesPrefetch({
    selectedTeam,
    propsMode,
  });



  // Opponent update logic - extracted to useOpponentUpdate hook
  useOpponentUpdate({
    selectedTeam,
    gamePropsTeam,
    todaysGames,
    propsMode,
    manualOpponent,
    setOpponentTeam,
  });

  // Games loading logic - extracted to useGamesLoading hook
  useGamesLoading({
    fetchTodaysGames,
  });

  // Next game calculation logic - extracted to useNextGameCalculation hook
  useNextGameCalculation({
    todaysGames,
    selectedTeam,
    gamePropsTeam,
    propsMode,
    manualOpponent,
    opponentTeam,
    setNextGameOpponent,
    setNextGameDate,
    setNextGameTipoff,
    setIsGameInProgress,
    setOpponentTeam,
  });

  // Legacy useEffect removed - replaced by useNextGameCalculation hook above
  // Removed ~305 lines of next game calculation logic

  // H2H opponent selection - extracted to useH2hOpponentSelection hook
  useH2hOpponentSelection({
    selectedTimeframe,
    manualOpponent,
    opponentTeam,
    nextGameOpponent,
    setManualOpponent,
    setOpponentTeam,
  });

  // Team mode game data fetching - extracted to useTeamModeGameData hook
  useTeamModeGameData({
    propsMode,
    gamePropsTeam,
    fetchGameDataForTeam,
    setGameStats,
  });

  // Last season stats fetch workaround - extracted to useLastSeasonStatsFetch hook
  useLastSeasonStatsFetch({
    selectedTimeframe,
    selectedPlayer,
    playerStats,
    setPlayerStats,
  });

  // Legacy useEffect removed - replaced by useLastSeasonStatsFetch hook above
  // Removed ~291 lines of last season stats fetch workaround logic

  // Team logo management - extracted to useTeamLogos hook
  useTeamLogos({
    propsMode,
    selectedTeam,
    gamePropsTeam,
    opponentTeam,
    setSelectedTeamLogoUrl,
    setSelectedTeamLogoAttempt,
    setOpponentTeamLogoUrl,
    setOpponentTeamLogoAttempt,
    getEspnLogoUrl,
  });

  // Team matchup stats fetching - extracted to useTeamMatchupStats hook
  useTeamMatchupStats({
    propsMode,
    selectedTeam,
    gamePropsTeam,
    opponentTeam,
    setTeamMatchupStats,
    setTeamMatchupLoading,
  });

  // Function to fetch a single team's depth chart (with caching to prevent rate limits)

  // Prefetch rosters for current teams (specific to current mode)
  useTeamRosterPrefetch({
    propsMode,
    originalPlayerTeam,
    gamePropsTeam,
    opponentTeam,
    setPlayerTeamRoster,
    setOpponentTeamRoster,
    setRostersLoading,
  });


  // Dashboard teammate state - extracted to useDashboardTeammateState hook
  const {
    withWithoutMode,
    setWithWithoutMode,
    teammateFilterId,
    setTeammateFilterId,
    teammateFilterName,
    setTeammateFilterName,
    teammatePlayedGameIds,
    setTeammatePlayedGameIds,
    loadingTeammateGames,
    setLoadingTeammateGames,
  } = useDashboardTeammateState();

  // Teammate filter reset - extracted to useTeammateFilterReset hook
  useTeammateFilterReset({
    propsMode,
    selectedPlayer,
    setTeammateFilterId,
    setTeammateFilterName,
    setTeammatePlayedGameIds,
    setWithWithoutMode,
    setLoadingTeammateGames,
  });

  // Roster calculations - extracted to useRosterCalculations hook
  const {
    rosterForSelectedTeam,
    selectedPosition,
    clearTeammateFilter,
  } = useRosterCalculations({
    propsMode,
    playerTeamRoster,
    allTeamRosters,
    originalPlayerTeam,
    selectedPlayer,
    teammateFilterId,
    setTeammateFilterId,
    setTeammateFilterName,
    setTeammatePlayedGameIds,
    setLoadingTeammateGames,
  });

  // Preload all team rosters when games are loaded (for instant team switching)
  useRosterPreloading({
    todaysGames,
    setAllTeamRosters,
    setRosterCacheLoading,
    setTeamInjuries,
  });

  // Fetch injuries for depth chart integration (fetch both selected and opponent teams)
  useTeamInjuries({
    propsMode,
    selectedTeam,
    gamePropsTeam,
    opponentTeam,
    setTeamInjuries,
  });




  // URL initialization logic - extracted to useUrlInitialization hook (see hook call above)

  // Timeframe restoration logic - extracted to useTimeframeRestoration hook
  useTimeframeRestoration({
    playerStats,
    selectedTimeframe,
    setSelectedTimeframe,
  });

  // Search functionality - extracted to useSearch hook
  useSearch({
    searchQuery,
    setSearchResults,
    setSearchError,
    setSearchBusy,
  });

  // Session persistence logic - extracted to useSessionPersistence hook
  useSessionPersistence({
    propsMode,
    selectedStat,
    selectedTimeframe,
    selectedPlayer,
    selectedTeam,
    resolvedPlayerId,
    gamePropsTeam,
  });

  // Dashboard utilities - extracted to useDashboardUtils hook
  const { fmtOdds, fetchSortedStats } = useDashboardUtils({
    oddsFormat,
    selectedTimeframe,
  });
  
  // Premium stats fetching - extracted to usePremiumStats hook
  const { fetchAdvancedStats, fetchShotDistanceStats } = usePremiumStats({
    hasPremium,
    setAdvancedStats,
    setAdvancedStatsLoading,
    setAdvancedStatsError,
    setShotDistanceData,
    setShotDistanceLoading,
  });
  
  // Premium stats restoration - extracted to usePremiumStatsRestoration hook
  usePremiumStatsRestoration({
    resolvedPlayerId,
    hasPremium,
    advancedStats,
    shotDistanceData,
    setAdvancedStats,
    setShotDistanceData,
  });
  
  // Dropdown close - extracted to useDropdownClose hook
  useDropdownClose({
    searchRef,
    setShowDropdown,
  });

  // Simple calculations - extracted to useSimpleCalculations hook
  const {
    headerInfo,
    playerInfo,
    matchupInfo,
    bestLineForStat,
  } = useSimpleCalculations({
    propsMode,
    gamePropsTeam,
    selectedPlayer,
    selectedTeam,
    opponentTeam,
    todaysGames,
    realOddsData,
    selectedStat,
  });
  
  // Game data processing - extracted to useGameDataProcessing hook
  // Keep this immediate so other hooks (teammate filter, etc.) can use it right away
  const {
    baseGameData,
    allGamesSecondAxisData,
    backToBackGameIds,
    filteredGameData,
  } = useGameDataProcessing({
    playerStats,
    selectedTimeframe,
    selectedPlayer,
    propsMode,
    gameStats,
    selectedTeam,
    opponentTeam,
    manualOpponent,
    homeAway,
    isLoading,
    resolvedPlayerId,
    teammateFilterId,
    gamePropsTeam,
    selectedFilterForAxis,
    advancedStatsPerGame,
    dvpRanksPerGame,
    minMinutesFilter,
    maxMinutesFilter,
    excludeBlowouts,
    excludeBackToBack,
    withWithoutMode,
    teammatePlayedGameIds,
  });
  
  // Prefetch teammate game data in background when roster is available (for faster filtering)
  useTeammatePrefetch({
    rosterForSelectedTeam,
    baseGameData,
    propsMode,
    selectedPlayer,
  });

  // Chart data processing - extracted to useChartDataProcessing hook
  // Process immediately but use startTransition for state updates to keep UI responsive
  const {
    chartData,
    adjustedChartData,
    sliderConfig,
    filteredChartData,
    secondAxisData,
  } = useChartDataProcessing({
    baseGameData,
    filteredGameData,
    selectedStat,
    propsMode,
    gamePropsTeam,
    selectedTeam,
    todaysGames,
    allGamesSecondAxisData: allGamesSecondAxisData || [],
    selectedFilterForAxis,
    sliderRange,
    selectedTimeframe,
    selectedPlayer,
    opponentTeam,
    advancedStatsPerGame,
    dvpRanksPerGame,
  });

  // Load teammate participation for current base games when filter is active
  useTeammateFilterData({
    teammateFilterId,
    baseGameData,
    withWithoutMode,
    setTeammatePlayedGameIds,
    setLoadingTeammateGames,
    teammateFetchAbortControllerRef,
    teammateFetchInProgressRef,
  });

  // Chart configuration - extracted to useChartConfig hook
  const {
    hitRateStats,
    customTooltip,
    formatChartLabel,
    yAxisConfig,
    currentStatOptions,
  } = useChartConfig({
    chartData,
    bettingLine,
    selectedStat,
    propsMode,
    baseGameDataLength: baseGameData.length,
    selectedPlayer,
    isLoading,
    resolvedPlayerId,
    selectedTimeframe,
    isDark,
    gamePropsTeam,
    selectedTeam,
  });

  // Player selection handlers - extracted to usePlayerSelection hook
  const { handlePlayerSelectFromLocal, handlePlayerSelectFromSearch } = usePlayerSelection({
    setIsLoading,
    setApiError,
    setAdvancedStats,
    setShotDistanceData,
    setAdvancedStatsLoading,
    setShotDistanceLoading,
    setRealOddsData,
    setOddsSnapshots,
    setLineMovementData,
    setOddsLoading,
    setOddsError,
    setOpponentTeam,
    setResolvedPlayerId,
    setSelectedTimeframe,
    setPlayerStats,
    setSelectedTeam,
    setOriginalPlayerTeam,
    setDepthChartTeam,
    setSelectedPlayer,
    setBettingLines,
    setShowDropdown,
    setSearchQuery,
    setSearchResults,
    isLoading,
    hasPremium,
    selectedStat,
    todaysGames,
    playerTeamRoster,
    fetchSortedStats,
    fetchAdvancedStats,
    fetchShotDistanceStats,
    lastAutoSetStatRef,
    lastAutoSetLineRef,
    hasManuallySetLineRef,
    statFromUrlRef,
    resolvedPlayerId,
    playerStats,
    selectedPlayer,
  });

  // URL initialization logic - extracted to useUrlInitialization hook
  useUrlInitialization({
    propsMode,
    setPropsMode,
    setSelectedStat,
    setSelectedTimeframe,
    setBettingLines,
    setGamePropsTeam,
    setSelectedPlayer,
    setSelectedTeam,
    setOriginalPlayerTeam,
    setDepthChartTeam,
    setResolvedPlayerId,
    setPlayerStats,
    setIsLoading,
    setApiError,
    playerStats,
    handlePlayerSelectFromSearch,
    fetchTodaysGames, // Pass fetchTodaysGames to pre-fetch games when player param detected
    statFromUrlRef,
  });

  // Calculate predicted pace from betting total line
  // Calculate predicted pace from betting total line
  usePredictedPace({
    propsMode,
    realOddsData,
    selectedTeam,
    opponentTeam,
    setPredictedPace,
  });

  // Calculate season averages (FG%, minutes, game pace) from playerStats
  useSeasonAverages({
    propsMode,
    playerStats,
    setSeasonFgPct,
    setAverageUsageRate,
    setAverageMinutes,
    setAverageGamePace,
  });



  // Core data ready tracking - extracted to useCoreDataReady hook
  useCoreDataReady({
    isLoading,
    playerStats,
    setCoreDataReady,
  });

  // Advanced stats prefetching logic - extracted to useAdvancedStatsPrefetch hook
  const { prefetchedAdvancedStats, setPrefetchedAdvancedStats } = useAdvancedStatsPrefetch({
    propsMode,
    playerStats,
    selectedPlayer,
    selectedFilterForAxis,
    adjustedChartData,
    setAdvancedStatsPerGame,
  });

  // Calculate average usage rate from prefetchedAdvancedStats
  // Use baseGameData (filtered by timeframe) to match what the chart shows - works automatically without clicking filter
  useAverageUsageRate({
    baseGameData,
    propsMode,
    selectedPlayer,
    prefetchedAdvancedStats,
    setAverageUsageRate,
    setPrefetchedAdvancedStats,
  });


  // Aggressive prefetching - prefetch all critical data in parallel when player is selected
  // This makes production feel instant by warming up APIs before they're needed
  useAggressivePrefetch({
    resolvedPlayerId,
    selectedPlayer,
    originalPlayerTeam,
    opponentTeam,
  });

  // DvP rank prefetching logic - extracted to useDvpRankPrefetch hook
  useDvpRankPrefetch({
    propsMode,
    playerStats,
    selectedPosition,
    selectedStat,
    selectedPlayer,
    selectedFilterForAxis,
    filteredChartData,
    playerTeamRoster,
    setDvpRanksPerGame,
  });

  // Slider range initialization - extracted to useSliderRangeInit hook
  useSliderRangeInit({
    selectedFilterForAxis,
    sliderConfig,
    sliderRange,
    setSliderRange,
  });

  // Advanced stats prefetching logic - extracted to useAdvancedStatsPrefetch hook (see hook call above)

  // DvP rank prefetching logic - extracted to useDvpRankPrefetch hook (see hook call above)
  
  
  // Best line update - extracted to useBestLineUpdate hook
  useBestLineUpdate({
    bestLineForStat,
    selectedStat,
    bettingLine,
    bettingLines,
    setBettingLines,
  });
  
  // Odds calculations - extracted to useOddsCalculations hook
  const { mergedLineMovementData, availableBookmakers } = useOddsCalculations({
    lineMovementData,
    realOddsData,
    selectedStat,
  });
  
  // Odds derived data - extracted to useOddsDerivedData hook
  const {
    derivedOdds,
    intradayMovementsFinal,
    selectedBookmakerData,
    selectedBookmakerLine,
    selectedBookmakerName,
    primaryMarketLine,
    calculatedImpliedOdds,
  } = useOddsDerivedData({
    mergedLineMovementData,
    oddsSnapshots,
    marketKey,
    intradayMovements,
    realOddsData,
    selectedStat,
  });

  // Prediction state
  // Hardcode to FanDuel only
  const selectedBookmakerForPrediction = 'fanduel';

  // Dashboard styles - memoized for performance
  const {
    containerStyle,
    innerContainerStyle,
    innerContainerClassName,
    mainContentClassName,
    mainContentStyle,
  } = useDashboardStyles({ sidebarOpen });

  // Dashboard computed props - memoized for performance
  const {
    chartLoadingState,
    currentTeam,
    handleSidebarSubscription,
  } = useDashboardComputedProps({
    propsMode,
    gameStatsLoading,
    isLoading,
    oddsLoading,
    apiError,
    gamePropsTeam,
    selectedTeam,
    handleSidebarSubscriptionBase,
    isPro,
  });

  // Normal distribution CDF (Cumulative Distribution Function) approximation
  // Returns the probability that a value from a standard normal distribution is <= z
  return (
    <div className="min-h-screen lg:h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors lg:overflow-x-auto lg:overflow-y-hidden">
      <DashboardStyles />
      {/* Main layout container with sidebar, chart, and right panel */}
      <div className="px-0 dashboard-container" style={containerStyle}>
        <div className={innerContainerClassName} style={innerContainerStyle}>
          <div 
            className="pt-4 min-h-0 lg:h-full dashboard-container"
            style={{ paddingLeft: 0 }}
          >
        {/* Left Sidebar - Extracted to DashboardLeftSidebarWrapper component */}
        <DashboardLeftSidebarWrapper
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
            oddsFormat={oddsFormat}
            setOddsFormat={setOddsFormat}
            hasPremium={hasPremium}
            avatarUrl={avatarUrl}
            username={username}
            userEmail={userEmail}
            isPro={isPro}
            onSubscriptionClick={handleSidebarSubscription}
            onSignOutClick={handleLogout}
        />
        <div className="flex flex-col lg:flex-row gap-0 lg:gap-1 min-h-0" style={{}}>
          {/* Main content area */}
          <div 
            className={mainContentClassName}
            style={mainContentStyle}
          >
            {/* 1. Filter By Container (Mobile Only) - Extracted to DashboardModeToggle component */}
            <DashboardModeToggle
              propsMode={propsMode}
              isPro={isPro}
              isDark={isDark}
              gamePropsTeam={gamePropsTeam}
              selectedTeam={selectedTeam}
              selectedStat={selectedStat}
              selectedTimeframe={selectedTimeframe}
              setPropsMode={setPropsMode}
              setSelectedStat={setSelectedStat}
              setSelectedTeam={setSelectedTeam}
              setOriginalPlayerTeam={setOriginalPlayerTeam}
              setDepthChartTeam={setDepthChartTeam}
              setGamePropsTeam={setGamePropsTeam}
            />

            {/* Header (with search bar and team display) */}
            <DashboardHeader
              propsMode={propsMode}
              playerInfo={playerInfo}
              selectedPlayer={selectedPlayer}
              gamePropsTeam={gamePropsTeam}
              selectedTeam={selectedTeam}
              opponentTeam={opponentTeam}
              nextGameOpponent={nextGameOpponent}
              nextGameTipoff={nextGameTipoff ? nextGameTipoff.toISOString() : null}
              countdown={countdown}
              isGameInProgress={isGameInProgress}
              setGamePropsTeam={setGamePropsTeam}
              setSelectedStat={setSelectedStat}
              setOpponentTeam={setOpponentTeam}
              selectedTeamLogoUrl={selectedTeamLogoUrl}
              setSelectedTeamLogoUrl={(url: string | null) => setSelectedTeamLogoUrl(url || '')}
              selectedTeamLogoAttempt={selectedTeamLogoAttempt}
              setSelectedTeamLogoAttempt={setSelectedTeamLogoAttempt}
              opponentTeamLogoUrl={opponentTeamLogoUrl}
              setOpponentTeamLogoUrl={(url: string | null) => setOpponentTeamLogoUrl(url || '')}
              opponentTeamLogoAttempt={opponentTeamLogoAttempt}
              setOpponentTeamLogoAttempt={setOpponentTeamLogoAttempt}
              isDark={isDark}
              isPro={isPro}
              hasPremium={hasPremium}
              setShowJournalModal={setShowJournalModal}
              todaysGames={todaysGames}
              calculatedImpliedOdds={calculatedImpliedOdds}
            />

            {/* Chart card (fully isolated) */}
            <ChartContainer
              isDark={isDark}
              currentStatOptions={currentStatOptions}
              selectedStat={selectedStat}
              onSelectStat={handleStatSelect}
              bettingLine={bettingLine}
              onChangeBettingLine={setBettingLine}
              selectedTimeframe={selectedTimeframe}
              onSelectTimeframe={setSelectedTimeframe}
              chartData={selectedFilterForAxis && sliderRange ? filteredChartData : chartData}
              yAxisConfig={yAxisConfig}
              isLoading={chartLoadingState.isLoading}
              oddsLoading={chartLoadingState.oddsLoading}
              apiError={chartLoadingState.apiError}
              selectedPlayer={selectedPlayer}
              propsMode={propsMode}
              gamePropsTeam={gamePropsTeam}
              customTooltip={customTooltip}
              currentOpponent={opponentTeam}
              manualOpponent={manualOpponent}
              onOpponentChange={setManualOpponent}
              currentTeam={currentTeam}
              homeAway={homeAway}
              onChangeHomeAway={setHomeAway}
              realOddsData={realOddsData}
              fmtOdds={fmtOdds}
              minMinutesFilter={minMinutesFilter}
              maxMinutesFilter={maxMinutesFilter}
              onMinMinutesChange={setMinMinutesFilter}
              onMaxMinutesChange={setMaxMinutesFilter}
              excludeBlowouts={excludeBlowouts}
              excludeBackToBack={excludeBackToBack}
              onExcludeBlowoutsChange={setExcludeBlowouts}
              onExcludeBackToBackChange={setExcludeBackToBack}
              rosterForSelectedTeam={rosterForSelectedTeam}
              withWithoutMode={withWithoutMode}
              setWithWithoutMode={setWithWithoutMode}
              teammateFilterId={teammateFilterId}
              teammateFilterName={teammateFilterName}
              setTeammateFilterId={setTeammateFilterId}
              setTeammateFilterName={setTeammateFilterName}
              loadingTeammateGames={loadingTeammateGames}
      clearTeammateFilter={clearTeammateFilter}
      hitRateStats={hitRateStats}
      lineMovementEnabled={LINE_MOVEMENT_ENABLED}
      intradayMovements={intradayMovementsFinal}
      secondAxisData={secondAxisData}
      selectedFilterForAxis={selectedFilterForAxis}
      onSelectFilterForAxis={handleSelectFilterForAxis}
      sliderConfig={sliderConfig}
      sliderRange={sliderRange}
      setSliderRange={setSliderRange}
            />
            <DashboardMobileAnalysis
              propsMode={propsMode}
              dvpProjectedTab={dvpProjectedTab}
              setDvpProjectedTab={setDvpProjectedTab}
                          isDark={isDark}
                          opponentTeam={opponentTeam}
              selectedPosition={selectedPosition}
              selectedTeam={selectedTeam}
              selectedPlayer={selectedPlayer}
                          predictedPace={predictedPace}
                          seasonFgPct={seasonFgPct}
                          averageUsageRate={averageUsageRate}
                          averageMinutes={averageMinutes}
                          averageGamePace={averageGamePace}
                          selectedTimeframe={selectedTimeframe}
              resolvedPlayerId={resolvedPlayerId}
                          selectedStat={selectedStat}
                          playerStats={playerStats}
                          teammateFilterId={teammateFilterId}
                          setTeammateFilterId={setTeammateFilterId}
                          setTeammateFilterName={setTeammateFilterName}
                          withWithoutMode={withWithoutMode}
                          setWithWithoutMode={setWithWithoutMode}
                          clearTeammateFilter={clearTeammateFilter}
              gamePropsTeam={gamePropsTeam}
              selectedComparison={selectedComparison}
              setSelectedComparison={setSelectedComparison}
              teamMatchupLoading={teamMatchupLoading}
              teamMatchupStats={teamMatchupStats}
            />
            {/* 4. Opponent Analysis & Team Matchup Container (Mobile) - Extracted to DashboardMobileAnalysis component */}

            {/* 4.5-10. Remaining Mobile Content - Extracted to DashboardMobileContent component */}
            <DashboardMobileContent
              propsMode={propsMode}
                  isDark={isDark} 
              selectedPlayer={selectedPlayer}
              shotDistanceData={shotDistanceData}
                  opponentTeam={opponentTeam}
              selectedTeam={selectedTeam}
                  derivedOdds={derivedOdds}
              intradayMovementsFinal={intradayMovementsFinal}
              gamePropsTeam={gamePropsTeam}
              selectedTeamLogoUrl={selectedTeamLogoUrl}
              opponentTeamLogoUrl={opponentTeamLogoUrl}
                  matchupInfo={matchupInfo}
                  oddsFormat={oddsFormat}
              realOddsData={realOddsData}
                  fmtOdds={fmtOdds}
              mergedLineMovementData={mergedLineMovementData}
                  selectedStat={selectedStat}
                  calculatedImpliedOdds={calculatedImpliedOdds}
                  selectedBookmakerName={selectedBookmakerName}
                  selectedBookmakerLine={selectedBookmakerLine}
                  primaryMarketLine={primaryMarketLine}
                  bettingLine={bettingLine}
              oddsLoading={oddsLoading}
              oddsError={oddsError}
              resolvedPlayerId={resolvedPlayerId}
              depthChartTeam={depthChartTeam}
              setDepthChartTeam={setDepthChartTeam}
                    teamInjuries={teamInjuries}
              originalPlayerTeam={originalPlayerTeam}
              playerTeamRoster={playerTeamRoster}
              opponentTeamRoster={opponentTeamRoster}
              rostersLoading={rostersLoading}
              allTeamRosters={allTeamRosters}
              rosterCacheLoading={rosterCacheLoading}
                    playerStats={playerStats}
            />

            {/* Desktop Content - Extracted to DashboardDesktopContent component */}
            <DashboardDesktopContent
              propsMode={propsMode}
                      isDark={isDark}
                    selectedTeam={selectedTeam}
              selectedPlayer={selectedPlayer}
              derivedOdds={derivedOdds}
              intradayMovementsFinal={intradayMovementsFinal}
                    opponentTeam={opponentTeam}
              selectedTeamLogoUrl={selectedTeamLogoUrl}
              opponentTeamLogoUrl={opponentTeamLogoUrl}
                    matchupInfo={matchupInfo}
                    oddsFormat={oddsFormat}
              realOddsData={realOddsData}
                    fmtOdds={fmtOdds}
              mergedLineMovementData={mergedLineMovementData}
                    selectedStat={selectedStat}
                    calculatedImpliedOdds={calculatedImpliedOdds}
                    selectedBookmakerName={selectedBookmakerName}
                    selectedBookmakerLine={selectedBookmakerLine}
                  primaryMarketLine={primaryMarketLine}
                  bettingLine={bettingLine}
                oddsLoading={oddsLoading}
                oddsError={oddsError}
                gamePropsTeam={gamePropsTeam}
              resolvedPlayerId={resolvedPlayerId}
              depthChartTeam={depthChartTeam}
              setDepthChartTeam={setDepthChartTeam}
                  teamInjuries={teamInjuries}
              originalPlayerTeam={originalPlayerTeam}
              playerTeamRoster={playerTeamRoster}
              opponentTeamRoster={opponentTeamRoster}
              rostersLoading={rostersLoading}
              allTeamRosters={allTeamRosters}
              rosterCacheLoading={rosterCacheLoading}
                    playerStats={playerStats}
                  />

          </div>

          <DashboardRightPanel
            sidebarOpen={sidebarOpen}
            isDark={isDark}
            hasPremium={hasPremium}
            propsMode={propsMode}
            setPropsMode={setPropsMode}
            setSelectedStat={setSelectedStat}
            gamePropsTeam={gamePropsTeam}
            setSelectedTeam={setSelectedTeam}
            setOriginalPlayerTeam={setOriginalPlayerTeam}
            setDepthChartTeam={setDepthChartTeam}
            selectedTeam={selectedTeam}
            setGamePropsTeam={setGamePropsTeam}
            selectedStat={selectedStat}
            selectedTimeframe={selectedTimeframe}
            dvpProjectedTab={dvpProjectedTab}
            setDvpProjectedTab={setDvpProjectedTab}
            opponentTeam={opponentTeam}
            selectedPosition={selectedPosition}
            selectedPlayer={selectedPlayer}
            predictedPace={predictedPace}
            seasonFgPct={seasonFgPct}
            averageUsageRate={averageUsageRate}
            averageMinutes={averageMinutes}
            averageGamePace={averageGamePace}
            resolvedPlayerId={resolvedPlayerId}
            playerStats={playerStats}
            teammateFilterId={teammateFilterId}
            setTeammateFilterId={setTeammateFilterId}
            setTeammateFilterName={setTeammateFilterName}
            withWithoutMode={withWithoutMode}
            setWithWithoutMode={setWithWithoutMode}
            clearTeammateFilter={clearTeammateFilter}
            selectedComparison={selectedComparison}
            setSelectedComparison={setSelectedComparison}
            teamMatchupLoading={teamMatchupLoading}
            teamMatchupStats={teamMatchupStats}
            realOddsData={realOddsData}
            shotDistanceData={shotDistanceData}
            calculatedImpliedOdds={calculatedImpliedOdds}
          />
          
        </div>
          </div>
        </div>
      </div>
      
      {/* Journal Modals - Extracted to DashboardJournalModals component */}
      <DashboardJournalModals
        propsMode={propsMode}
        selectedPlayer={selectedPlayer}
        opponentTeam={opponentTeam}
        gamePropsTeam={gamePropsTeam}
        selectedTeam={selectedTeam}
        nextGameOpponent={nextGameOpponent}
        nextGameDate={nextGameDate}
            oddsFormat={oddsFormat}
        showJournalModal={showJournalModal}
        setShowJournalModal={setShowJournalModal}
      />
      
      {/* Mobile Bottom Navigation - Only visible on mobile */}
      <MobileBottomNavigation
        hasPremium={hasPremium}
        username={username}
        userEmail={userEmail}
        avatarUrl={avatarUrl}
        showJournalDropdown={showJournalDropdown}
        showProfileDropdown={showProfileDropdown}
        showSettingsDropdown={showSettingsDropdown}
        setShowJournalDropdown={setShowJournalDropdown}
        setShowProfileDropdown={setShowProfileDropdown}
        setShowSettingsDropdown={setShowSettingsDropdown}
        profileDropdownRef={profileDropdownRef}
        journalDropdownRef={journalDropdownRef}
        settingsDropdownRef={settingsDropdownRef}
        onSubscription={handleSidebarSubscription}
        onLogout={handleLogout}
        theme={theme}
        oddsFormat={oddsFormat}
        setTheme={setTheme}
        setOddsFormat={setOddsFormat}
      />
      
      {/* Desktop Navigation */}
      <HeaderNavigation
        variant="desktop"
        hasPremium={hasPremium}
        username={username}
        userEmail={userEmail}
        avatarUrl={avatarUrl}
        showJournalDropdown={showJournalDropdown}
        showProfileDropdown={showProfileDropdown}
        showSettingsDropdown={showSettingsDropdown}
        setShowJournalDropdown={setShowJournalDropdown}
        setShowProfileDropdown={setShowProfileDropdown}
        setShowSettingsDropdown={setShowSettingsDropdown}
      />
    </div>
  );
}

export default function NBADashboard() {
  return <NBADashboardWrapper />;
}
