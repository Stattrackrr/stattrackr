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
import { OddsSnapshot, deriveOpeningCurrentMovement, filterByMarket } from '@/lib/odds';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import InjuryContainer from '@/components/InjuryContainer';
import DepthChartContainer from './components/DepthChartContainer';
import { cachedFetch } from '@/lib/requestCache';
import StaticBarsChart from './components/charts/StaticBarsChart';
import { RangeSlider } from './components/charts';
import SimpleChart from './components/charts/SimpleChart';
import { CustomChartTooltip } from './components/charts/CustomChartTooltip';
import { useSubscription } from '@/hooks/useSubscription';
import { OfficialOddsCard, BestOddsTable, BestOddsTableDesktop, ProjectedStatsCard } from './components/odds';
import { PositionDefenseCard, OpponentAnalysisCard } from './components/dvp';
import { HomeAwaySelect, OverRatePill } from './components/ui';
import ChartControls from './components/ChartControls';
import ChartContainer from './components/ChartContainer';
import PlayerBoxScore from './components/PlayerBoxScore';
import { CHART_CONFIG, SECOND_AXIS_FILTER_OPTIONS, PLAYER_STAT_OPTIONS, TEAM_STAT_OPTIONS, PLACEHOLDER_BOOK_ROWS, LINE_MOVEMENT_ENABLED } from './constants';
import { updateBettingLinePosition, getUnifiedTooltipStyle } from './utils/chartUtils';
import { createChartLabelFormatter } from './utils/chartFormatters';
import { AltLineItem, partitionAltLineItems, cloneBookRow, mergeBookRowsByBaseName, getBookRowKey, americanToDecimal, normalizeAmerican, fmtOdds as fmtOddsUtil } from './utils/oddsUtils';
import { calculateAvailableBookmakers, calculateSelectedBookmakerData } from './utils/bookmakerUtils';
import { calculateHitRateStats } from './utils/hitRateStatsUtils';
import { calculateSelectedPosition } from './utils/positionUtils';
import { processIntradayMovements } from './utils/intradayMovementsUtils';
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
import { fetchSortedStatsCore } from './utils/playerStatsUtils';
import { fetchTeamGamesData as fetchTeamGamesDataCore, cacheAllTeamsInBackground as cacheAllTeamsInBackgroundCore, fetchGameDataForTeam as fetchGameDataForTeamCore } from './utils/teamGamesUtils';
import { fetchTodaysGamesCore } from './utils/fetchTodaysGamesUtils';
import { fetchBdlPlayerData, parseBdlHeight, resolvePlayerId, parseEspnHeight, fetchEspnPlayerData, fetchEspnPlayerDataCore, fetchAdvancedStatsCore, fetchShotDistanceStatsCore } from './utils/playerDataUtils';
import { fetchTeamDepthChart, resolveTeammateIdFromName } from './utils/depthChartUtils';
import { getEasternOffsetMinutes, parseBallDontLieTipoff } from './utils/dateUtils';
import { processBaseGameData } from './utils/baseGameDataUtils';
import { processFilteredGameData } from './utils/filteredGameDataUtils';
import { processFilteredChartData } from './utils/filteredChartDataUtils';
import { calculateYAxisConfig } from './utils/yAxisConfigUtils';
import { processChartData } from './utils/chartDataUtils';
import { processAllGamesSecondAxisData } from './utils/allGamesSecondAxisDataUtils';
import { processSecondAxisData } from './utils/secondAxisDataUtils';
import { calculateSliderConfig } from './utils/sliderConfigUtils';
import { calculatePrimaryMarketLine } from './utils/primaryMarketLineUtils';
import { calculateBackToBackGameIds } from './utils/backToBackGameIdsUtils';
import { calculateHeaderInfo } from './utils/headerInfoUtils';
import { calculateMatchupInfo } from './utils/matchupInfoUtils';
import { calculateBestLineForStat } from './utils/bestLineForStatUtils';
import { calculateImpliedOdds } from './utils/calculatedImpliedOddsUtils';
import { processIntradayMovementsFinal } from './utils/intradayMovementsFinalUtils';
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
import { useProjectedMinutes } from './hooks/useProjectedMinutes';
import { useSubscriptionSuccess } from './hooks/useSubscriptionSuccess';
import { useProfileMenuClose } from './hooks/useProfileMenuClose';
import { useOddsFormat } from './hooks/useOddsFormat';
import { useCountdownTimer } from './hooks/useCountdownTimer';
import { useSubscriptionCheck } from './hooks/useSubscriptionCheck';
import { useLineMovement } from './hooks/useLineMovement';
import { useStatUrlSync } from './hooks/useStatUrlSync';
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
import serverLogger from '@/lib/serverLogger';
import { clientLogger } from '@/lib/clientLogger';
import Image from 'next/image';

export function NBADashboardContent() {
  const router = useRouter();
  const { isDark, theme, setTheme } = useTheme();
  const { handleLogout, handleSidebarSubscription: handleSidebarSubscriptionBase } = useAuthHandlers();
  
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false); // Default to false until verified
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const journalDropdownRef = useRef<HTMLDivElement>(null);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  // Advanced filters (player mode)
  const [minMinutesFilter, setMinMinutesFilter] = useState<number>(0);
  const [maxMinutesFilter, setMaxMinutesFilter] = useState<number>(48);
  const [excludeBlowouts, setExcludeBlowouts] = useState<boolean>(false);
  const [excludeBackToBack, setExcludeBackToBack] = useState<boolean>(false);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState<boolean>(false);
  const [isMinutesFilterOpen, setIsMinutesFilterOpen] = useState<boolean>(false);
  // With/Without filters - states will be defined after roster setup

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

  const handleSidebarSubscription = () => handleSidebarSubscriptionBase(isPro);

  const [propsMode, setPropsMode] = useState<'player' | 'team'>('player');
  const [selectedStat, setSelectedStat] = useState('pts');
  const [selectedFilterForAxis, setSelectedFilterForAxis] = useState<string | null>(null); // Second axis filter: 'minutes', 'dvp_rank', 'pace', 'usage_rate', 'fg_pct', null
  const [dvpProjectedTab, setDvpProjectedTab] = useState<'dvp' | 'projected' | 'opponent' | 'injuries'>('dvp'); // Tab selector for DvP, Projected, Opponent Breakdown, and Injuries
  const [sliderRange, setSliderRange] = useState<{ min: number; max: number } | null>(null); // Slider range for filtering
  const [projectedMinutes, setProjectedMinutes] = useState<number | null>(null); // Cached projected minutes (persists across tab switches)
  const [projectedMinutesLoading, setProjectedMinutesLoading] = useState(false);
  const [allProjectedMinutes, setAllProjectedMinutes] = useState<Record<string, number>>({}); // Bulk cache: key = "playerName|teamAbbr", value = minutes
  const [predictedPace, setPredictedPace] = useState<number | null>(null); // Predicted game pace from betting total
  const [seasonFgPct, setSeasonFgPct] = useState<number | null>(null); // Season average FG%
  const [averageUsageRate, setAverageUsageRate] = useState<number | null>(null); // Season average usage rate
  const [averageMinutes, setAverageMinutes] = useState<number | null>(null); // Season average minutes
  const [averageGamePace, setAverageGamePace] = useState<number | null>(null); // Average game pace from player's games
  
  const handleSelectFilterForAxis = useCallback((filter: string | null) => {
    setSelectedFilterForAxis(filter);
    // Reset slider when filter changes
    setSliderRange(null);
  }, []);
  
  // Track if stat was set from URL to prevent default stat logic from overriding it
  const statFromUrlRef = useRef(false);
  // Track if user manually selected a stat (to prevent default logic from overriding)
  const userSelectedStatRef = useRef(false);
  
  const [selectedTimeframe, setSelectedTimeframe] = useState('last10');
  // Betting lines per stat (independent) - will be populated by odds API
  const [bettingLines, setBettingLines] = useState<Record<string, number>>({});
  // Track auto-set state for betting lines (shared across handlers)
  const hasManuallySetLineRef = useRef(false);
  const lastAutoSetStatRef = useRef<string | null>(null);
  const lastAutoSetLineRef = useRef<number | null>(null);
  
  // Update betting line for current stat
  const setBettingLine = (value: number) => {
    setBettingLines(prev => ({
      ...prev,
      [selectedStat]: value
    }));
  };
  
  // Get current betting line for selected stat (defined early so it can be used in hitRateStats)
  // Use stored line if available, otherwise default to 0.5
  // Note: bestLineForStat will update bettingLines state via useEffect when it becomes available
  const bettingLine = useMemo(() => {
    // First check if we have a stored line for this stat
    if (selectedStat in bettingLines) {
      return bettingLines[selectedStat];
    }
    // Otherwise default to 0.5 (will be updated by useEffect when bestLineForStat is available)
    return 0.5;
  }, [bettingLines, selectedStat]);
  
  // Independent bookmaker lines (not linked to the chart betting line)
  const [bookOpeningLine, setBookOpeningLine] = useState<number | null>(null);
  const [bookCurrentLine, setBookCurrentLine] = useState<number | null>(null);

  // Odds API placeholders (no fetch yet)
  const [oddsSnapshots, setOddsSnapshots] = useState<OddsSnapshot[]>([]);
  const marketKey = 'player_points';
  
  // Line movement data from API
const [lineMovementData, setLineMovementData] = useState<{
  openingLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  currentLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  impliedOdds: number | null; // Backward compatibility
  overImpliedProb?: number | null;
  underImpliedProb?: number | null;
  isOverFavorable: boolean | null;
  lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
} | null>(null);
const [lineMovementLoading, setLineMovementLoading] = useState(false);


  // Odds display format
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
  // Odds format from localStorage - extracted to useOddsFormat hook
  useOddsFormat({ setOddsFormat });

  // Build intraday movement rows from line movement data
  const intradayMovements = useMemo(() => {
    return processIntradayMovements(lineMovementData, oddsSnapshots, marketKey);
  }, [lineMovementData, oddsSnapshots, marketKey]);

  // search state
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<BdlSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  // selection + data
  const [selectedPlayer, setSelectedPlayer] = useState<NBAPlayer | null>(null);
  const [resolvedPlayerId, setResolvedPlayerId] = useState<string | null>(null);
  const [playerStats, setPlayerStats] = useState<BallDontLieStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Track when core data (stats + DvP) is ready to show the screen
  const [coreDataReady, setCoreDataReady] = useState(false);
  
  const [apiError, setApiError] = useState<string | null>(null);
  
  // Advanced stats state
  const [advancedStats, setAdvancedStats] = useState<AdvancedStats | null>(null);
  const [advancedStatsLoading, setAdvancedStatsLoading] = useState(false);
  const [advancedStatsError, setAdvancedStatsError] = useState<string | null>(null);
  
  // Advanced stats per game (for second axis - pace and usage_rate)
  const [advancedStatsPerGame, setAdvancedStatsPerGame] = useState<Record<number, { pace?: number; usage_percentage?: number }>>({});
  
  // DvP ranks per game (for second axis - dvp_rank)
  const [dvpRanksPerGame, setDvpRanksPerGame] = useState<Record<string, number | null>>({});
  
  // Prefetched DvP ranks - stored by stat/metric combination (moved to useDvpRankPrefetch hook)
  
  // Refs to track prefetch status (prevent duplicate prefetches) - advancedStatsPrefetchRef moved to useAdvancedStatsPrefetch hook
  const dvpRanksPrefetchRef = useRef<Set<string>>(new Set());
  
  // Shot distance stats state
  const [shotDistanceData, setShotDistanceData] = useState<any | null>(null);
  const [shotDistanceLoading, setShotDistanceLoading] = useState(false);
  
  // Opponent team state
  const [opponentTeam, setOpponentTeam] = useState<string>('N/A');
  
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
  
  // Games state
  const [todaysGames, setTodaysGames] = useState<any[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const gamesFetchInFlightRef = useRef(false);
  
  // Game stats for team props (separate from player stats)
  const [gameStats, setGameStats] = useState<any[]>([]);
  const [gameStatsLoading, setGameStatsLoading] = useState(false);

  // Determine today's matchup and tipoff time (no fetch; uses existing todaysGames)
  const matchupInfo = useMemo(() => {
    return calculateMatchupInfo({
      selectedTeam,
      opponentTeam,
      todaysGames,
    });
  }, [selectedTeam, opponentTeam, todaysGames]);
  
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
  
  // Time filter for opponent breakdown display
  const [selectedTimeFilter] = useState('last10'); // Using existing selectedTimeframe as reference
  
  // Team comparison metric selector
  const [selectedComparison, setSelectedComparison] = useState<'points' | 'rebounds' | 'assists' | 'fg_pct' | 'three_pct'>('points');
  
  // State for team matchup stats (fetched from DVP API)
  const [teamMatchupStats, setTeamMatchupStats] = useState<{currentTeam: any, opponent: any}>({currentTeam: null, opponent: null});
  const [teamMatchupLoading, setTeamMatchupLoading] = useState(false);
  
  // Pie chart display order (only affects visual display, not underlying data)
  const [pieChartSwapped, setPieChartSwapped] = useState(false);
  
  // Journal modal state
  const [showJournalModal, setShowJournalModal] = useState(false);
  
  // Sidebar toggle state for tablets/Macs
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Subscription/paywall state
  const { 
    hasPremium, 
    checkFeatureAccess,
    subscription,
    loading: subscriptionLoading
  } = useSubscription();
  
  // Debug subscription status - removed (debug code)
  
  // Next game info for tracking (separate from chart filter)
  const [nextGameOpponent, setNextGameOpponent] = useState<string>('');
  const [nextGameDate, setNextGameDate] = useState<string>('');
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  
  // Countdown timer state
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  
  // Countdown timer - extracted to useCountdownTimer hook
  useCountdownTimer({
    nextGameTipoff,
    isGameInProgress,
    setCountdown,
  });


  // Team game data cache for instant loading
  const [teamGameCache, setTeamGameCache] = useState<Record<string, any[]>>({});
  const [backgroundCacheLoading, setBackgroundCacheLoading] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ current: 0, total: 0 });

  // Background cache all teams function - now imported from utils
  const cacheAllTeamsInBackground = async () => {
    return await cacheAllTeamsInBackgroundCore({
      backgroundCacheLoading,
      teamGameCache,
      fetchTeamGamesData,
      onBackgroundCacheLoadingChange: setBackgroundCacheLoading,
      onCacheProgressChange: setCacheProgress,
      onTeamGameCacheUpdate: setTeamGameCache,
    });
  };

  // Core function to fetch team games - now imported from utils
  const fetchTeamGamesData = async (teamAbbr: string, showLoading: boolean = true) => {
    return await fetchTeamGamesDataCore(teamAbbr, {
      onLoadingChange: showLoading ? setGameStatsLoading : undefined,
      onGamesChange: showLoading ? setGameStats : undefined,
    });
  };

  // Priority fetch: load requested team immediately, then cache others in background - now imported from utils
  const fetchGameDataForTeam = async (teamAbbr: string) => {
    return await fetchGameDataForTeamCore({
      teamAbbr,
      teamGameCache,
      fetchTeamGamesData,
      onGameStatsLoadingChange: setGameStatsLoading,
      onGameStatsChange: setGameStats,
      onTeamGameCacheUpdate: setTeamGameCache,
      onCacheAllTeams: cacheAllTeamsInBackground,
    });
  };

  // Fetch games function (today ± 7 days) - now imported from utils
  const fetchTodaysGames = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    return await fetchTodaysGamesCore({
      silent,
      onLoadingChange: setGamesLoading,
      onGamesChange: setTodaysGames,
      isFetchInFlight: () => gamesFetchInFlightRef.current,
      setFetchInFlight: (inFlight) => { gamesFetchInFlightRef.current = inFlight; },
    });
  }, []);

  // Last 5 games prefetch - extracted to useLast5GamesPrefetch hook
  useLast5GamesPrefetch({
    selectedTeam,
    propsMode,
  });

  // Projected minutes fetching and lookup - extracted to useProjectedMinutes hook
  useProjectedMinutes({
    selectedPlayer,
    selectedTeam,
    opponentTeam,
    propsMode,
    allProjectedMinutes,
    setAllProjectedMinutes,
    setProjectedMinutes,
    setProjectedMinutesLoading,
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


  // Comprehensive roster cache - preload ALL team rosters for instant switching
  const [allTeamRosters, setAllTeamRosters] = useState<Record<string, DepthChartData>>({});
  const [rosterCacheLoading, setRosterCacheLoading] = useState(false);

  // With/Without filters
  const [withWithoutMode, setWithWithoutMode] = useState<'with'|'without'>('with');
  const [teammateFilterId, setTeammateFilterId] = useState<number | null>(null);
  const [teammateFilterName, setTeammateFilterName] = useState<string | null>(null); // Store name for display
  const [teammatePlayedGameIds, setTeammatePlayedGameIds] = useState<Set<number>>(new Set());
  const [loadingTeammateGames, setLoadingTeammateGames] = useState<boolean>(false);

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

  const clearTeammateFilter = useCallback(() => {
    setTeammateFilterId(null);
    setTeammateFilterName(null);
    setTeammatePlayedGameIds(new Set());
    setLoadingTeammateGames(false);
  }, []);

  const rosterForSelectedTeam = useMemo(() => {
    if (propsMode !== 'player') return null;
    const roster = (playerTeamRoster && Object.keys(playerTeamRoster || {}).length ? playerTeamRoster : allTeamRosters[originalPlayerTeam]) as any;
    return roster || null;
  }, [propsMode, playerTeamRoster, allTeamRosters, originalPlayerTeam]);
  
  // Effect moved below where baseGameData is declared

  // Resolve selected player's exact position from depth chart (after roster states are ready)
  const selectedPosition = useMemo((): 'PG'|'SG'|'SF'|'PF'|'C' | null => {
    return calculateSelectedPosition({
      propsMode,
      selectedPlayer,
      playerTeamRoster,
      allTeamRosters,
      originalPlayerTeam,
    });
  }, [propsMode, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, playerTeamRoster, allTeamRosters, originalPlayerTeam]);

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

  // Fetch game stats for a player
  const fetchSortedStats = async (playerId: string) => {
    return await fetchSortedStatsCore(playerId, selectedTimeframe);
  };
  
  // Track current fetch to prevent race conditions
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

  // header info - dynamic based on props mode
  const headerInfo = useMemo(() => {
    return calculateHeaderInfo({
      propsMode,
      gamePropsTeam,
      selectedPlayer,
      selectedTeam,
    });
  }, [propsMode, gamePropsTeam, selectedPlayer, selectedTeam]);

  // Keep the old variable name for compatibility
  const playerInfo = headerInfo;
  
  // Defer heavy baseGameData computation to prevent UI freeze during player selection
  // This allows the UI to remain responsive while stats are being processed
  // Removed useDeferredValue to prevent double refresh - use playerStats directly
  // const deferredPlayerStats = useDeferredValue(playerStats);
  
  /* -------- Base game data (structure only, no stat values) ----------
     This should only recalculate when player/timeframe changes, NOT when stat changes */
  const baseGameData = useMemo(() => {
    return processBaseGameData({
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
    });
  }, [playerStats, selectedTimeframe, selectedPlayer, propsMode, gameStats, selectedTeam, opponentTeam, manualOpponent, homeAway, isLoading, resolvedPlayerId, teammateFilterId]);
  
  // Calculate allGamesSecondAxisData from playerStats directly (all games, no timeframe filter)
  // This allows us to filter from ALL games, then apply timeframe
  const allGamesSecondAxisData = useMemo(() => {
    return processAllGamesSecondAxisData({
      playerStats,
      selectedFilterForAxis,
      selectedTimeframe,
      advancedStatsPerGame,
      dvpRanksPerGame,
      propsMode,
    });
  }, [playerStats, selectedFilterForAxis, selectedTimeframe, advancedStatsPerGame, dvpRanksPerGame, propsMode]);
  
  // Prefetch teammate game data in background when roster is available (for faster filtering)
  useTeammatePrefetch({
    rosterForSelectedTeam,
    baseGameData,
    propsMode,
    selectedPlayer,
  });
  
  // Precompute back-to-back games (player mode)
  const backToBackGameIds = useMemo(() => {
    return calculateBackToBackGameIds({
      propsMode,
      playerStats,
    });
  }, [propsMode, playerStats]);

  // Apply advanced filters to base data for player mode
  const filteredGameData = useMemo(() => {
    return processFilteredGameData({
      propsMode,
      baseGameData,
      minMinutesFilter,
      maxMinutesFilter,
      excludeBlowouts,
      excludeBackToBack,
      backToBackGameIds,
      withWithoutMode,
      teammateFilterId,
      teammatePlayedGameIds,
      selectedTimeframe,
      playerStats,
      selectedPlayer,
    });
  }, [propsMode, baseGameData, minMinutesFilter, maxMinutesFilter, excludeBlowouts, excludeBackToBack, backToBackGameIds, withWithoutMode, teammateFilterId, teammatePlayedGameIds, selectedTimeframe, playerStats, selectedPlayer]);

  /* -------- Chart data with current stat values ----------
     Only recalculate values when selectedStat changes */
  const chartData = useMemo(() => {
    const source = propsMode === 'player' ? filteredGameData : baseGameData;
    return processChartData({
      source,
      selectedStat,
      propsMode,
      gamePropsTeam,
      todaysGames,
    });
  }, [baseGameData, filteredGameData, selectedStat, propsMode, propsMode === 'team' ? gamePropsTeam : selectedTeam, todaysGames]);

  // Track in-flight requests to prevent duplicates
  const teammateFetchAbortControllerRef = useRef<AbortController | null>(null);
  const teammateFetchInProgressRef = useRef<Set<number>>(new Set());

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

  const currentStatOptions = propsMode === 'player' ? PLAYER_STAT_OPTIONS : TEAM_STAT_OPTIONS;

  // Hit rate calculations - using statistical distribution instead of simple counting
  const hitRateStats = useMemo<HitRateStats>(() => {
    return calculateHitRateStats({
      chartData,
      bettingLine,
      selectedStat,
      currentStatOptions,
      propsMode,
      baseGameDataLength: baseGameData.length,
      selectedPlayer,
      isLoading,
      resolvedPlayerId,
    });
  }, [chartData, bettingLine, selectedStat, currentStatOptions, propsMode, baseGameData.length, selectedPlayer, isLoading, resolvedPlayerId]);

  // Custom tooltip content - completely independent to prevent lag when adjusting betting line
  const customTooltip = useCallback(({ active, payload, label }: any) => {
    return (
      <CustomChartTooltip
        active={active}
        payload={payload}
        label={label}
        propsMode={propsMode}
        selectedStat={selectedStat}
        isDark={isDark}
        gamePropsTeam={gamePropsTeam}
        selectedTeam={selectedTeam}
      />
    );
  }, [propsMode, selectedStat, isDark, gamePropsTeam, selectedTeam]);

  // Memoized label formatter for chart bars
  const formatChartLabel = useMemo(() => createChartLabelFormatter(selectedStat), [selectedStat]);

  // Calculate Y-axis domain with appropriate tick increments
  const yAxisConfig = useMemo(() => {
    return calculateYAxisConfig({
      chartData,
      selectedStat,
      selectedTimeframe,
      propsMode,
    });
  }, [chartData, selectedStat, selectedTimeframe, propsMode]);

  // Real odds data state
  const [realOddsData, setRealOddsData] = useState<BookRow[]>([]);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);

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

  // For spread we now use the signed margin directly (wins down, losses up)
  const adjustedChartData = useMemo(() => chartData, [chartData]);

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

  // Calculate slider min/max based on selected filter (use all games for accurate min/max)
  const sliderConfig = useMemo(() => {
    return calculateSliderConfig({
      selectedFilterForAxis,
      allGamesSecondAxisData,
    });
  }, [selectedFilterForAxis, allGamesSecondAxisData]);

  // Filter chart data based on slider range
  // IMPORTANT: Filter from ALL games first (using allGamesSecondAxisData from playerStats), then apply timeframe
  const filteredChartData = useMemo(() => {
    return processFilteredChartData({
      adjustedChartData,
      selectedFilterForAxis,
      allGamesSecondAxisData,
      sliderRange,
      propsMode,
      selectedStat,
      selectedTimeframe,
      selectedPlayer,
      opponentTeam,
    });
  }, [adjustedChartData, selectedFilterForAxis, allGamesSecondAxisData, sliderRange, propsMode, selectedStat, selectedTimeframe, selectedPlayer, opponentTeam]);

  // Calculate second axis data for display (from filteredChartData to match what's actually displayed)
  const secondAxisData = useMemo(() => {
    return processSecondAxisData({
      filteredChartData,
      selectedFilterForAxis,
      propsMode,
      advancedStatsPerGame,
      dvpRanksPerGame,
    });
  }, [selectedFilterForAxis, filteredChartData, propsMode, advancedStatsPerGame, dvpRanksPerGame]);

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
  
  // Calculate best line for stat (lowest over line) - exclude alternate lines
  // This is used to initialize bettingLine when switching stats
  const bestLineForStat = useMemo(() => {
    return calculateBestLineForStat({
      realOddsData,
      selectedStat,
    });
  }, [realOddsData, selectedStat]);
  
  // Best line update - extracted to useBestLineUpdate hook
  useBestLineUpdate({
    bestLineForStat,
    selectedStat,
    bettingLine,
    bettingLines,
    setBettingLines,
  });
  
  // Merge line movement data with live odds to get accurate current line
  const mergedLineMovementData = useMemo(() => {
    if (!LINE_MOVEMENT_ENABLED || !lineMovementData) return null;
    
    // Map selected stat to bookmaker property
    const statToBookKey: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'fg3m': 'THREES',
      'pra': 'PRA',
      'pr': 'PR',
      'pa': 'PA',
      'ra': 'RA',
    };
    const bookKey = (selectedStat && statToBookKey[selectedStat]) || 'PTS';
    
    // Get current line from live odds (realOddsData) - use first available bookmaker with data
    let currentLineFromLive: { line: number; bookmaker: string; timestamp: string } | null = null;
    if (realOddsData && realOddsData.length > 0) {
      for (const b of realOddsData) {
        const bookData = (b as any)[bookKey];
        if (bookData && bookData.line && bookData.line !== 'N/A') {
          const lineValue = parseFloat(String(bookData.line).replace(/[^0-9.+-]/g, ''));
          if (!Number.isNaN(lineValue)) {
            currentLineFromLive = {
              line: lineValue,
              bookmaker: b.name,
              timestamp: new Date().toISOString(),
            };
            break;
          }
        }
      }
    }
    
    // Merge: use opening from database, current from live odds (if available)
    return {
      ...lineMovementData,
      currentLine: currentLineFromLive || lineMovementData.currentLine,
    };
  }, [lineMovementData, realOddsData, selectedStat]);
  
  const derivedOdds = useMemo(() => {
    if (LINE_MOVEMENT_ENABLED && mergedLineMovementData) {
      return {
        openingLine: mergedLineMovementData.openingLine?.line ?? null,
        currentLine: mergedLineMovementData.currentLine?.line ?? null,
      };
    }
    // Fallback to old snapshot logic for team mode
    const filtered = filterByMarket(oddsSnapshots, marketKey);
    return deriveOpeningCurrentMovement(filtered);
  }, [mergedLineMovementData, oddsSnapshots, marketKey]);


  // Prediction state
  // Hardcode to FanDuel only
  const selectedBookmakerForPrediction = 'fanduel';
  
  // Update intraday movements to use merged data for accurate current line
  const intradayMovementsFinal = useMemo(() => {
    return processIntradayMovementsFinal({
      mergedLineMovementData,
      realOddsData,
      selectedStat,
      intradayMovements,
      LINE_MOVEMENT_ENABLED,
    });
  }, [mergedLineMovementData, intradayMovements, realOddsData, selectedStat]);
  
  // Odds fetching logic - extracted to useOddsFetching hook (see hook call above)

  const fmtOdds = (odds: string | undefined | null): string => {
    return fmtOddsUtil(odds, oddsFormat);
  };

  // Available bookmakers with valid over/under odds for selected stat
  const availableBookmakers = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0 || !selectedStat) return [];
    
    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return [];
    
    const bookmakers = new Map<string, { name: string; displayName: string }>();
    
    for (const book of realOddsData) {
      const statData = (book as any)[bookRowKey];
      if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
        const meta = (book as any)?.meta;
        // Exclude alternate lines (variantLabel indicates alternate)
        if (!meta?.variantLabel) {
          const baseName = (meta?.baseName || book?.name || '').toLowerCase();
          const displayName = meta?.baseName || book?.name || 'Unknown';
          if (!bookmakers.has(baseName)) {
            bookmakers.set(baseName, { name: baseName, displayName });
          }
        }
      }
    }
    
    return Array.from(bookmakers.values());
  }, [realOddsData, selectedStat, getBookRowKey]);

  // Extract FanDuel's line and odds for selected stat
  const selectedBookmakerData = useMemo(() => {
    return calculateSelectedBookmakerData(realOddsData, selectedStat);
  }, [realOddsData, selectedStat]);

  const selectedBookmakerLine = selectedBookmakerData.line;
  const selectedBookmakerName = selectedBookmakerData.name;

  // Calculate implied odds from FanDuel, with fallback to consensus
  // Calculate primary line from real bookmakers (not alt lines) - used for prediction
  // Uses the most common line value (consensus), not the average
  const primaryMarketLine = useMemo(() => {
    return calculatePrimaryMarketLine({
      realOddsData,
      selectedStat,
    });
  }, [realOddsData, selectedStat]);

  const calculatedImpliedOdds = useMemo(() => {
    return calculateImpliedOdds({
      realOddsData,
      selectedStat,
    });
  }, [realOddsData, selectedStat]);

  // Normal distribution CDF (Cumulative Distribution Function) approximation
  // Returns the probability that a value from a standard normal distribution is <= z
  return (
    <div className="min-h-screen lg:h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors lg:overflow-x-auto lg:overflow-y-hidden">
      <DashboardStyles />
      {/* Main layout container with sidebar, chart, and right panel */}
      <div className="px-0 dashboard-container" style={{ 
        marginLeft: sidebarOpen ? 'calc(var(--sidebar-width, 0px) + var(--gap, 8px))' : '0px',
        width: sidebarOpen ? 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 8px)))' : '100%',
        paddingLeft: 0,
        transition: 'margin-left 0.3s ease, width 0.3s ease'
      }}>
        <div className={`mx-auto w-full ${sidebarOpen ? 'max-w-[1550px]' : 'max-w-[1800px]'}`} style={{ paddingLeft: sidebarOpen ? 0 : '2rem', paddingRight: sidebarOpen ? 0 : '1rem' }}>
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
            className={`relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 overflow-y-auto overflow-x-hidden overscroll-contain pl-0 pr-2 sm:pl-0 sm:pr-2 md:px-0 pb-0 lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar ${
              sidebarOpen ? 'lg:flex-[6] xl:flex-[6.2]' : 'lg:flex-[6] xl:flex-[6]'
            }`}
            style={{
              scrollbarGutter: 'stable'
            }}
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
              setSearchQuery={setSearchQuery}
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
              nextGameTipoff={nextGameTipoff}
              countdown={countdown}
              isGameInProgress={isGameInProgress}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchResults={searchResults}
              searchBusy={searchBusy}
              searchError={searchError}
              showDropdown={showDropdown}
              setShowDropdown={setShowDropdown}
              isMobileSearchOpen={isMobileSearchOpen}
              setIsMobileSearchOpen={setIsMobileSearchOpen}
              handlePlayerSelectFromSearch={handlePlayerSelectFromSearch}
              setGamePropsTeam={setGamePropsTeam}
              setSelectedStat={setSelectedStat}
              setOpponentTeam={setOpponentTeam}
              selectedTeamLogoUrl={selectedTeamLogoUrl}
              setSelectedTeamLogoUrl={setSelectedTeamLogoUrl}
              selectedTeamLogoAttempt={selectedTeamLogoAttempt}
              setSelectedTeamLogoAttempt={setSelectedTeamLogoAttempt}
              opponentTeamLogoUrl={opponentTeamLogoUrl}
              setOpponentTeamLogoUrl={setOpponentTeamLogoUrl}
              opponentTeamLogoAttempt={opponentTeamLogoAttempt}
              setOpponentTeamLogoAttempt={setOpponentTeamLogoAttempt}
              isPro={isPro}
              hasPremium={hasPremium}
              setShowJournalModal={setShowJournalModal}
              todaysGames={todaysGames}
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
              chartData={filteredChartData}
              yAxisConfig={yAxisConfig}
              isLoading={propsMode === 'team' ? gameStatsLoading : isLoading}
              oddsLoading={propsMode === 'player' ? oddsLoading : false}
              apiError={propsMode === 'team' ? null : apiError}
              selectedPlayer={selectedPlayer}
              propsMode={propsMode}
              gamePropsTeam={gamePropsTeam}
              customTooltip={customTooltip}
              currentOpponent={opponentTeam}
              manualOpponent={manualOpponent}
              onOpponentChange={setManualOpponent}
              currentTeam={propsMode === 'team' ? gamePropsTeam : selectedTeam}
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
                          projectedMinutes={projectedMinutes}
              projectedMinutesLoading={projectedMinutesLoading}
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
            setSearchQuery={setSearchQuery}
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
            projectedMinutes={projectedMinutes}
            projectedMinutesLoading={projectedMinutesLoading}
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
