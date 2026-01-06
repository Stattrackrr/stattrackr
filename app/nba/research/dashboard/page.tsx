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

  // Check for success parameter from checkout
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('success') === 'true') {
      alert('âœ… Subscription successful! Welcome to Pro! Your Player Props features are now unlocked.');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Get user info and subscription status on mount
  // Cache subscription status to avoid frequent checks
  useEffect(() => {
    let isMounted = true;
    let subscriptionCheckInterval: NodeJS.Timeout | null = null;
    let lastSubscriptionStatus: { isActive: boolean; isPro: boolean } | null = null;
    
    const checkSubscription = async (skipCache = false) => {
      // Get session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        if (isMounted) {
          // No session - redirect to login with return path (non-blocking)
          setTimeout(() => {
            router.push('/login?redirect=/nba/research/dashboard');
          }, 0);
        }
        return;
      }

      if (!isMounted) return;

      setUserEmail(session.user.email || null);
      setUsername(session.user.user_metadata?.username || session.user.user_metadata?.full_name || null);
      setAvatarUrl(session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null);
      
      try {
        // Check Pro access - query database directly
        const { data: profile } = await (supabase
          .from('profiles') as any)
          .select('subscription_status, subscription_tier')
          .eq('id', session.user.id)
          .single();
        
        if (!isMounted) return;
        
        let isActive = false;
        let isProTier = false;
        
        if (profile) {
          // Use profiles table if available
          const profileData = profile as any;
          isActive = profileData.subscription_status === 'active' || profileData.subscription_status === 'trialing';
          isProTier = profileData.subscription_tier === 'pro';
        } else {
          // Fallback to user_metadata for dev testing
          const metadata = session.user.user_metadata || {};
          isActive = metadata.subscription_status === 'active';
          isProTier = metadata.subscription_plan === 'pro';
        }
        
        const proStatus = isActive && isProTier;
        
        // Cache active subscription status (to prevent logouts on errors)
        // But always update if subscription expires (isActive becomes false)
        if (isActive) {
          lastSubscriptionStatus = { isActive: true, isPro: proStatus };
        } else {
          // Subscription expired - clear cache and update immediately
          lastSubscriptionStatus = null;
        }
        
        // Always update if status changed, subscription expired, or if this is the first check
        if (!lastSubscriptionStatus || lastSubscriptionStatus.isPro !== proStatus || !isActive || skipCache) {
          clientLogger.debug('ðŸ” Dashboard Pro Status Check:', { isActive, isProTier, proStatus, profile, metadata: session.user.user_metadata });
          
          if (isMounted) {
            setIsPro(proStatus);
          }
          
          if (isActive) {
            lastSubscriptionStatus = { isActive, isPro: proStatus };
          }
        }
      } catch (error) {
        clientLogger.error('Error checking subscription:', error);
        // If we have a cached active subscription, keep it (never log out active subscribers)
        if (lastSubscriptionStatus?.isActive && isMounted) {
          clientLogger.debug('ðŸ” Using cached active subscription status due to error');
          setIsPro(lastSubscriptionStatus.isPro);
        }
      }
    };
    
    // Initial check
    checkSubscription(true);
    
    // Periodic check every 5 minutes (instead of on every token refresh)
    subscriptionCheckInterval = setInterval(() => {
      if (isMounted) {
        checkSubscription();
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Set up listener only for SIGNED_OUT and SIGNED_IN (not TOKEN_REFRESHED)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          lastSubscriptionStatus = null;
          setIsPro(false);
          router.push('/login?redirect=/nba/research/dashboard');
        }
      }
      // Only check on SIGNED_IN (not TOKEN_REFRESHED to avoid frequent checks)
      else if (event === 'SIGNED_IN' && isMounted && session?.user) {
        checkSubscription(true);
      }
    });
    
    return () => {
      isMounted = false;
      if (subscriptionCheckInterval) {
        clearInterval(subscriptionCheckInterval);
      }
      subscription?.unsubscribe();
    };
  }, [router]);

  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        journalDropdownRef.current &&
        !journalDropdownRef.current.contains(target) &&
        !target.closest('[data-journal-button]')
      ) {
        setShowJournalDropdown(false);
      }
      if (
        profileDropdownRef.current &&
        !profileDropdownRef.current.contains(target) &&
        !target.closest('[data-profile-button]')
      ) {
        setShowProfileDropdown(false);
      }
      if (
        settingsDropdownRef.current &&
        !settingsDropdownRef.current.contains(target) &&
        !target.closest('[data-settings-button]')
      ) {
        setShowSettingsDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
  // Store the initial stat from URL immediately on mount (before any navigation)
  const initialStatFromUrlRef = useRef<string | null>(null);
  const hasCapturedInitialStatRef = useRef(false);
  
  // Wrapper for setSelectedStat that marks it as a user selection and updates URL immediately
  const handleStatSelect = useCallback((stat: string) => {
    userSelectedStatRef.current = true; // Mark as user selection
    setSelectedStat(stat);
    clientLogger.debug(`[Dashboard] ðŸ‘¤ User selected stat: "${stat}"`);
    
    // Update URL immediately to prevent race conditions
    if (typeof window !== 'undefined' && router) {
      const url = new URL(window.location.href);
      url.searchParams.set('stat', stat);
      router.replace(url.pathname + url.search, { scroll: false });
      clientLogger.debug(`[Dashboard] ðŸ”„ Immediately updated URL stat parameter to: "${stat}"`);
      
      // Mark that URL was updated by user, so useSearchParams doesn't override it
      statFromUrlRef.current = true;
      
      // Reset the user selection flag after a short delay to allow URL to update
      // This prevents useSearchParams from reading the old URL value
      setTimeout(() => {
        userSelectedStatRef.current = false;
        clientLogger.debug(`[Dashboard] âœ… Reset user selection flag after URL update`);
      }, 100); // 100ms should be enough for router.replace to complete
    }
  }, [router]);
  
  // Use Next.js useSearchParams to read URL parameters
  const searchParams = useSearchParams();
  
  // Capture stat from URL IMMEDIATELY on mount (before any other code runs)
  useEffect(() => {
    if (hasCapturedInitialStatRef.current) return;
    hasCapturedInitialStatRef.current = true;
    
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        const stat = url.searchParams.get('stat');
        if (stat) {
          const normalizedStat = (() => {
            const statUpper = stat.toUpperCase();
            if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
              return 'fg3m';
            }
            return stat.toLowerCase();
          })();
          initialStatFromUrlRef.current = normalizedStat;
          clientLogger.debug(`[Dashboard] ðŸŽ¯ Captured initial stat from URL on mount: "${stat}" -> "${normalizedStat}"`);
          statFromUrlRef.current = true;
          // Set it immediately
          setSelectedStat(normalizedStat);
        }
      } catch (e) {
        clientLogger.error('[Dashboard] Error capturing initial stat from URL:', e);
      }
    }
  }, []); // Run only once on mount
  
  // Track if we've used the initial stat from mount (only use it once)
  const hasUsedInitialStatRef = useRef(false);
  
  // Watch for stat parameter in URL and set it immediately
  useEffect(() => {
    const stat = searchParams.get('stat');
    
    // Only use initial stat from mount on the VERY FIRST render, then always respect URL
    if (!hasUsedInitialStatRef.current && initialStatFromUrlRef.current) {
      hasUsedInitialStatRef.current = true;
      // Clear the initial stat ref so we don't use it again
      const initialStat = initialStatFromUrlRef.current;
      initialStatFromUrlRef.current = null; // Clear it so we don't reset to it later
      console.log(`[Dashboard] ðŸŽ¯ useSearchParams: Using initial stat from mount: "${initialStat}"`);
      statFromUrlRef.current = true;
      setSelectedStat(initialStat);
      
      // Store in session storage
      updateSessionProperty('selectedStat', initialStat);
      return; // Use initial stat on first render only
    }
    
    // After first render, always respect the current URL parameter
    // BUT skip if user just manually selected a stat (to prevent override)
    if (userSelectedStatRef.current) {
      console.log(`[Dashboard] â­ï¸ useSearchParams: Skipping - user just manually selected stat`);
      return;
    }
    
    if (stat) {
      const normalizedStat = (() => {
        const statUpper = stat.toUpperCase();
        if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
          return 'fg3m';
        }
        return stat.toLowerCase();
      })();
      
      // Only update if it's different from current stat to avoid unnecessary re-renders
      if (normalizedStat !== selectedStat) {
        console.log(`[Dashboard] ðŸŽ¯ useSearchParams: Updating stat from URL: "${stat}" -> "${normalizedStat}" (current: "${selectedStat}")`);
        statFromUrlRef.current = true;
        setSelectedStat(normalizedStat);
        
        // Store in session storage
        updateSessionProperty('selectedStat', normalizedStat);
      }
    } else {
      console.log(`[Dashboard] âš ï¸ useSearchParams: No stat parameter found in URL`);
    }
  }, [searchParams, selectedStat]);
  
  // Sync selectedStat to URL when it changes (but don't trigger if it came from URL or user just selected)
  useEffect(() => {
    // Skip if stat was just set from URL (to avoid circular updates)
    if (statFromUrlRef.current) {
      statFromUrlRef.current = false; // Reset flag for next user interaction
      return;
    }
    
    // Skip if user just manually selected a stat (handleStatSelect already updated URL)
    if (userSelectedStatRef.current) {
      userSelectedStatRef.current = false; // Reset after one check
      return;
    }
    
    // Skip if this is the initial mount and we haven't processed URL yet
    if (!hasUsedInitialStatRef.current) {
      return;
    }
    
    // Update URL with current stat (only for non-user-initiated changes)
    if (typeof window !== 'undefined' && router) {
      const url = new URL(window.location.href);
      const currentStat = url.searchParams.get('stat');
      
      // Only update if different to avoid unnecessary navigation
      if (currentStat !== selectedStat) {
        url.searchParams.set('stat', selectedStat);
        // Use replace to avoid adding to history
        router.replace(url.pathname + url.search, { scroll: false });
        console.log(`[Dashboard] ðŸ”„ Updated URL stat parameter to: "${selectedStat}"`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStat]); // router is stable, don't need it in deps
  
  // Ensure correct default stat is set when propsMode changes (but not when user clicks stats)
  useEffect(() => {
    console.log(`[Dashboard] ðŸ”„ Default stat logic running: propsMode="${propsMode}", selectedStat="${selectedStat}", statFromUrlRef=${statFromUrlRef.current}, initialStatFromUrl="${initialStatFromUrlRef.current}", userSelectedStat=${userSelectedStatRef.current}`);
    
    // Skip if user manually selected a stat (don't override user choice)
    if (userSelectedStatRef.current) {
      console.log(`[Dashboard] â­ï¸ Skipping default stat logic - user manually selected stat`);
      userSelectedStatRef.current = false; // Reset after one check
      return;
    }
    
    // Skip if we have an initial stat from URL (don't override it, even if URL was changed)
    // But only if we haven't used it yet - after first use, always respect URL
    if (initialStatFromUrlRef.current && !hasUsedInitialStatRef.current) {
      console.log(`[Dashboard] â­ï¸ Skipping default stat logic - initial stat "${initialStatFromUrlRef.current}" was captured from URL on mount`);
      return;
    }
    
    // Check if there's a stat in the URL - if so, don't override it
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const urlStat = url.searchParams.get('stat');
      if (urlStat) {
        console.log(`[Dashboard] â­ï¸ Skipping default stat logic - stat "${urlStat}" found in URL`);
        return;
      }
    }
    
    // Skip if stat was set from URL (don't override it)
    if (statFromUrlRef.current) {
      console.log(`[Dashboard] â­ï¸ Skipping default stat logic - stat was set from URL (ref flag)`);
      statFromUrlRef.current = false; // Reset flag after skipping once
      return;
    }
    
    if (propsMode === 'player') {
      // Force non-Pro users back to Game Props mode
      if (!isPro) {
        setPropsMode('team');
        setSelectedStat('total_pts');
        return;
      }
      
      // Clear opponent when switching to player mode (player props don't have opponents)
      setOpponentTeam('');
      
      // Set default stat ONLY if current stat is invalid for player mode
      // Don't reset if user has a valid stat selected
      const playerStatExists = PLAYER_STAT_OPTIONS.find(s => s.key === selectedStat);
      if (!playerStatExists && selectedStat !== 'pts') {
        console.log(`[Dashboard] âš ï¸ Stat "${selectedStat}" not found in PLAYER_STAT_OPTIONS, resetting to 'pts'`);
        setSelectedStat('pts');
      }
    } else if (propsMode === 'team') {
      // Only change if current stat is invalid for team mode
      const teamStatExists = TEAM_STAT_OPTIONS.find(s => s.key === selectedStat);
      if (!teamStatExists && selectedStat !== 'total_pts') {
        setSelectedStat('total_pts');
      }
    }
  }, [propsMode, isPro]); // Removed selectedStat from deps - only run when propsMode changes, not on every stat change
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
const lastLineMovementRequestRef = useRef<{ key: string; fetchedAt: number } | null>(null);
const lineMovementInFlightRef = useRef(false);


  // Odds display format
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('oddsFormat') : null;
      if (saved === 'decimal' || saved === 'american') setOddsFormat(saved as any);
    } catch {}
  }, []);

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
  
  // Fetch line movement data when game, player, and stat change
  useEffect(() => {
    if (!LINE_MOVEMENT_ENABLED) {
      // Only update state if it's not already set to these values to prevent infinite loops
      setLineMovementLoading(prev => prev ? false : prev);
      setLineMovementData(prev => prev !== null ? null : prev);
      return;
    }
    const fetchLineMovement = async () => {
      console.log('ðŸ“Š Line Movement Fetch Check:', { propsMode, selectedPlayer: selectedPlayer?.full, selectedTeam, opponentTeam, selectedStat });
      
      // Only fetch for player mode
      if (propsMode !== 'player' || !selectedPlayer || !selectedTeam || !opponentTeam || opponentTeam === '' || opponentTeam === 'N/A') {
        console.log('â¸ï¸ Skipping line movement fetch - missing requirements');
        // Only update if not already null to prevent infinite loops
        setLineMovementData(prev => prev !== null ? null : prev);
        return;
      }
      
      const playerName = selectedPlayer.full || `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
      
      // Get the game date from todaysGames if available
      const teamA = normalizeAbbr(selectedTeam);
      const teamB = normalizeAbbr(opponentTeam);
      const game = todaysGames.find((g: any) => {
        const home = normalizeAbbr(g?.home_team?.abbreviation || '');
        const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
        return (home === teamA && away === teamB) || (home === teamB && away === teamA);
      });
      
      // Extract game date or use today's date
      const gameDate = game?.date ? new Date(game.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      const requestKey = JSON.stringify({
        mode: propsMode,
        playerId: selectedPlayer.id,
        team: selectedTeam,
        opponent: opponentTeam,
        stat: selectedStat,
        gameDate,
      });

      const nowTs = Date.now();
      const TTL_MS = 5 * 60 * 1000; // 5 minutes
      if (
        lastLineMovementRequestRef.current &&
        lastLineMovementRequestRef.current.key === requestKey &&
        nowTs - lastLineMovementRequestRef.current.fetchedAt < TTL_MS
      ) {
        console.log('â© Skipping duplicate line movement fetch', requestKey);
        return;
      }

      if (lineMovementInFlightRef.current) {
        console.log('â³ Line movement fetch already in-flight, skipping new request');
        return;
      }

      lastLineMovementRequestRef.current = { key: requestKey, fetchedAt: nowTs };
      lineMovementInFlightRef.current = true;

      console.log(`ðŸŽ¯ Fetching line movement for: ${playerName} (date: ${gameDate}, stat: ${selectedStat})`);
      
      setLineMovementLoading(true);
      try {
        const url = `/api/odds/line-movement?player=${encodeURIComponent(playerName)}&stat=${encodeURIComponent(selectedStat)}&date=${gameDate}`;
        console.log('ðŸ“¡ Fetching:', url);
        const response = await fetch(url);
        if (!response.ok) {
          console.warn('âŒ Line movement fetch failed:', response.status);
          setLineMovementData(null);
          return;
        }
        const result = await response.json();
        console.log('âœ… Line movement data received:', result);
        // Extract the nested data object from the API response
        setLineMovementData(result.hasOdds ? (result.data as typeof lineMovementData) : null);
      } catch (error) {
        console.error('Error fetching line movement:', error);
        setLineMovementData(null);
        lastLineMovementRequestRef.current = null;
      } finally {
        setLineMovementLoading(false);
        lineMovementInFlightRef.current = false;
        if (lastLineMovementRequestRef.current) {
          lastLineMovementRequestRef.current = {
            key: requestKey,
            fetchedAt: Date.now(),
          };
        }
      }
    };
    
    fetchLineMovement();
  }, [propsMode, selectedPlayer, selectedTeam, opponentTeam, selectedStat, todaysGames]);
  
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
  
  // Debug subscription status
  useEffect(() => {
    console.log('[Dashboard] Subscription status:', {
      hasPremium,
      subscription,
      loading: subscriptionLoading
    });
  }, [hasPremium, subscription, subscriptionLoading]);
  
  // Next game info for tracking (separate from chart filter)
  const [nextGameOpponent, setNextGameOpponent] = useState<string>('');
  const [nextGameDate, setNextGameDate] = useState<string>('');
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  
  // Countdown timer state
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  
  // Update countdown every second
  useEffect(() => {
    if (!nextGameTipoff || isGameInProgress) {
      setCountdown(null);
      if (!nextGameTipoff) {
        console.log('[Countdown] No tipoff time available');
      }
      if (isGameInProgress) {
        console.log('[Countdown] Game in progress, hiding countdown');
      }
      return;
    }
    
    const updateCountdown = () => {
      const now = new Date().getTime();
      const tipoff = nextGameTipoff.getTime();
      const diff = tipoff - now;
      
      if (diff <= 0) {
        setCountdown(null);
        console.log('[Countdown] Game time has passed');
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setCountdown({ hours, minutes, seconds });
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    
    return () => clearInterval(interval);
  }, [nextGameTipoff, isGameInProgress]);


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

  // Prefetch "Last 5 Games" tracking stats when selectedTeam changes (for instant load when user clicks "Last 5 Games")
  useEffect(() => {
    if (!selectedTeam || selectedTeam === 'N/A' || propsMode !== 'player') return;
    
    const prefetchLast5Games = async () => {
      const season = 2025;
      const cacheKeyPassing = `tracking_stats_${selectedTeam}_${season}_passing_last5`;
      const cacheKeyRebounding = `tracking_stats_${selectedTeam}_${season}_rebounding_last5`;
      
      // Check if already cached and fresh (30 minutes TTL)
      try {
        const cachedPassing = sessionStorage.getItem(cacheKeyPassing);
        const cachedRebounding = sessionStorage.getItem(cacheKeyRebounding);
        
        if (cachedPassing && cachedRebounding) {
          try {
            const passingData = JSON.parse(cachedPassing);
            const reboundingData = JSON.parse(cachedRebounding);
            const cacheTimestamp = passingData.__timestamp || 0;
            const cacheAge = Date.now() - cacheTimestamp;
            const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
            
            if (cacheAge < CACHE_TTL_MS) {
              console.log(`[Dashboard] âœ… Last 5 Games data already cached for ${selectedTeam} (${Math.round(cacheAge / 1000)}s old)`);
              return; // Already cached and fresh
            }
          } catch (e) {
            // Invalid cache, continue to prefetch
          }
        }
      } catch (e) {
        // Ignore storage errors
      }
      
      // Prefetch in background (non-blocking)
      console.log(`[Dashboard] ðŸš€ Prefetching Last 5 Games data for ${selectedTeam}...`);
      const baseParams = `team=${encodeURIComponent(selectedTeam)}&season=${season}&lastNGames=5`;
      
      Promise.all([
        fetch(`/api/tracking-stats/team?${baseParams}&category=passing`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tracking-stats/team?${baseParams}&category=rebounding`).then(r => r.ok ? r.json() : null).catch(() => null)
      ]).then(([passingResult, reboundingResult]) => {
        if (passingResult && reboundingResult && !passingResult.error && !reboundingResult.error) {
          try {
            sessionStorage.setItem(cacheKeyPassing, JSON.stringify({
              players: passingResult.players || [],
              __timestamp: Date.now()
            }));
            sessionStorage.setItem(cacheKeyRebounding, JSON.stringify({
              players: reboundingResult.players || [],
              __timestamp: Date.now()
            }));
            console.log(`[Dashboard] âœ… Prefetched Last 5 Games data for ${selectedTeam} (${passingResult.players?.length || 0} passing, ${reboundingResult.players?.length || 0} rebounding)`);
          } catch (e) {
            // Ignore storage errors
          }
        }
      }).catch(err => {
        console.warn(`[Dashboard] âš ï¸ Failed to prefetch Last 5 Games for ${selectedTeam}:`, err);
      });
    };
    
    // Small delay to not block initial render
    const timer = setTimeout(prefetchLast5Games, 1000);
    return () => clearTimeout(timer);
  }, [selectedTeam, propsMode]);

  // Fetch and cache ALL projected minutes once (bulk load)
  useEffect(() => {
    const CACHE_KEY = 'nba_all_projected_minutes';
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // Check sessionStorage cache first
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          const cacheAge = Date.now() - (parsed.timestamp || 0);
          if (cacheAge < CACHE_TTL_MS && parsed.data) {
            console.log(`[Dashboard] âœ… Loaded ${Object.keys(parsed.data).length} projected minutes from cache`);
            setAllProjectedMinutes(parsed.data);
            return; // Use cached data
          }
        }
      } catch (e) {
        console.warn('[Dashboard] Failed to load projected minutes cache:', e);
      }
    }

    // Fetch all projections
    let abort = false;
    const fetchAllProjections = async () => {
      try {
        console.log('[Dashboard] Fetching all projected minutes from SportsLine...');
        const response = await fetch('/api/nba/projections');
        if (!response.ok) {
          throw new Error(`Failed to fetch projections: ${response.status}`);
        }

        const data = await response.json();
        if (abort) return;

        // Normalize player name for matching
        const normalizePlayerName = (name: string): string => {
          return name
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        };

        // Build cache map: key = "normalizedPlayerName|normalizedTeam", value = minutes
        const cache: Record<string, number> = {};
        if (data.playerMinutes && Array.isArray(data.playerMinutes)) {
          for (const proj of data.playerMinutes) {
            const normalizedName = normalizePlayerName(proj.player);
            const normalizedTeam = normalizeAbbr(proj.team);
            const key = `${normalizedName}|${normalizedTeam}`;
            cache[key] = proj.minutes;
          }
        }

        if (!abort) {
          console.log(`[Dashboard] âœ… Cached ${Object.keys(cache).length} projected minutes`);
          setAllProjectedMinutes(cache);

          // Save to sessionStorage
          if (typeof window !== 'undefined') {
            try {
              sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                data: cache,
                timestamp: Date.now()
              }));
            } catch (e) {
              console.warn('[Dashboard] Failed to save projected minutes cache:', e);
            }
          }
        }
      } catch (err: any) {
        if (!abort) {
          console.error('[Dashboard] Error fetching all projected minutes:', err);
        }
      }
    };

    fetchAllProjections();

    return () => {
      abort = true;
    };
  }, []); // Only run once on mount

  // Look up projected minutes from cache when player/team changes
  useEffect(() => {
    if (!selectedPlayer || !selectedTeam || selectedTeam === 'N/A' || !opponentTeam || opponentTeam === 'N/A' || propsMode !== 'player') {
      setProjectedMinutes(null);
      setProjectedMinutesLoading(false);
      return;
    }

    setProjectedMinutesLoading(true);

    // Normalize player name for matching
    const normalizePlayerName = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const getNameVariations = (fullName: string): string[] => {
      const normalized = normalizePlayerName(fullName);
      const parts = normalized.split(' ');
      const variations = [normalized];
      if (parts.length > 1) {
        variations.push(`${parts[1]} ${parts[0]}`);
        variations.push(`${parts[0][0]} ${parts[1]}`);
        variations.push(`${parts[0]} ${parts[1][0]}`);
      }
      return Array.from(new Set(variations));
    };

    // Look up from cache
    const playerFullName = selectedPlayer.full || `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
    const nameVariations = getNameVariations(playerFullName);
    const normalizedCurrentTeam = normalizeAbbr(selectedTeam);

    // Try exact match first
    const normalizedName = normalizePlayerName(playerFullName);
    const exactKey = `${normalizedName}|${normalizedCurrentTeam}`;
    let minutes = allProjectedMinutes[exactKey];

    // If no exact match, try variations
    if (minutes === undefined) {
      for (const variation of nameVariations) {
        const variationKey = `${variation}|${normalizedCurrentTeam}`;
        if (allProjectedMinutes[variationKey] !== undefined) {
          minutes = allProjectedMinutes[variationKey];
          break;
        }
      }

      // If still no match, try fuzzy search (check if any key contains the variation)
      if (minutes === undefined) {
        for (const variation of nameVariations) {
          const matchingKey = Object.keys(allProjectedMinutes).find(key => {
            const [namePart, teamPart] = key.split('|');
            return (namePart.includes(variation) || variation.includes(namePart)) &&
                   teamPart === normalizedCurrentTeam;
          });
          if (matchingKey) {
            minutes = allProjectedMinutes[matchingKey];
            break;
          }
        }
      }
    }

    if (minutes !== undefined) {
      console.log('[Dashboard] Found projected minutes from cache:', minutes);
      setProjectedMinutes(minutes);
    } else {
      console.log('[Dashboard] No projected minutes found in cache for player');
      setProjectedMinutes(null);
    }

    setProjectedMinutesLoading(false);
  }, [selectedPlayer, selectedTeam, opponentTeam, propsMode, allProjectedMinutes]);


  // Update opponent when games or selected team changes
  useEffect(() => {
    console.log(`%cðŸ” === OPPONENT USEEFFECT TRIGGERED ===%c`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
    console.log(`%cDependency changes: propsMode=${propsMode}, manualOpponent="${manualOpponent}"`, 'color: #555', '');
    
    // If manual opponent is set and not ALL, use that instead of automatic detection
    if (manualOpponent && manualOpponent !== '' && manualOpponent !== 'ALL') {
      console.log(`%cðŸŽ¯ MANUAL OPPONENT OVERRIDE: ${manualOpponent}%c`, 'color: #f39c12; font-weight: bold; font-size: 12px', '');
      setOpponentTeam(normalizeAbbr(manualOpponent));
      console.log(`%cðŸ” === OPPONENT USEEFFECT END ===%c\n`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
      return;
    }
    
    // Otherwise, use automatic opponent detection
    const teamToCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    console.log(`%cTeam to check: %c${teamToCheck}%c (mode: ${propsMode})`, 'color: #555', 'color: #e74c3c; font-weight: bold', 'color: #555');
    console.log(`%cGames available: %c${todaysGames.length}`, 'color: #555', 'color: #f39c12; font-weight: bold');
    
    if (teamToCheck && teamToCheck !== 'N/A' && todaysGames.length > 0) {
      const opponent = getOpponentTeam(teamToCheck, todaysGames);
      console.log(`%cðŸŽ¯ SETTING OPPONENT: ${opponent}%c (for ${teamToCheck})`, 'color: #27ae60; font-weight: bold; font-size: 12px', 'color: #555');
      setOpponentTeam(normalizeAbbr(opponent));
    } else {
      console.log(`%câ¸ï¸ SKIPPING OPPONENT UPDATE%c - Insufficient data`, 'color: #f39c12; font-weight: bold', 'color: #555');
      console.log(`  teamToCheck: ${teamToCheck}, todaysGames: ${todaysGames.length}`);
      if (propsMode === 'team' && (!gamePropsTeam || gamePropsTeam === 'N/A')) {
        console.log(`  -> Clearing opponent (team mode with no team selected)`);
        setOpponentTeam('');
      }
    }
    console.log(`%cðŸ” === OPPONENT USEEFFECT END ===%c\n`, 'color: #16a085; font-weight: bold; font-size: 14px', '');
  }, [selectedTeam, gamePropsTeam, todaysGames, propsMode, manualOpponent]);

  // Load games on mount and refresh every 3 hours (reduced churn)
  useEffect(() => {
    fetchTodaysGames();
    const id = setInterval(() => {
      fetchTodaysGames({ silent: true });
    }, 60 * 1000);
    return () => {
      clearInterval(id);
    };
  }, [fetchTodaysGames]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchTodaysGames({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchTodaysGames]);

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

  // Auto-handle opponent selection when switching to H2H

  // Auto-handle opponent selection when switching to H2H
  useEffect(() => {
    if (selectedTimeframe === 'h2h') {
      // When switching to H2H, only clear manual opponent if it's currently ALL
      if (manualOpponent === 'ALL') {
        setManualOpponent('');
      }
      
      // If opponentTeam is not set (empty, N/A, or ALL), use the nextGameOpponent that's already calculated
      if ((!opponentTeam || opponentTeam === 'N/A' || opponentTeam === 'ALL' || opponentTeam === '') && nextGameOpponent && nextGameOpponent !== '') {
        console.log(`ðŸ”„ H2H: Setting opponent to next game opponent: ${nextGameOpponent}`);
        setOpponentTeam(nextGameOpponent);
      }
    }
    // Don't auto-switch away from manual selections when leaving H2H
  }, [selectedTimeframe, manualOpponent, opponentTeam, nextGameOpponent]);

  // Fetch game data when in team mode and team is selected
  useEffect(() => {
    if (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A') {
      console.log(`ðŸ€ Fetching game data for team mode: ${gamePropsTeam}`);
      fetchGameDataForTeam(gamePropsTeam);
    } else if (propsMode === 'player') {
      // Clear game data when switching back to player mode
      setGameStats([]);
    } else if (propsMode === 'team' && gamePropsTeam === 'N/A') {
      // Clear game data when no team selected in Game Props
      setGameStats([]);
    }
  }, [propsMode, gamePropsTeam]);

  // Track if we've already attempted to fetch stats by game_id for this player/timeframe
  const lastSeasonGameIdFetchRef = useRef<{ playerId: string; attempted: boolean }>({ playerId: '', attempted: false });

  // WORKAROUND: When viewing last season and all stats have 0 minutes, fetch stats by game_id
  // for games where the player was on their previous team
  useEffect(() => {
    console.log(`[useEffect lastseason] Triggered:`, {
      selectedTimeframe,
      hasSelectedPlayer: !!selectedPlayer?.id,
      playerStatsLength: playerStats.length,
      refPlayerId: lastSeasonGameIdFetchRef.current.playerId,
      refAttempted: lastSeasonGameIdFetchRef.current.attempted
    });
    
    if (selectedTimeframe !== 'lastseason' || !selectedPlayer?.id || playerStats.length === 0) {
      // Reset ref when not viewing last season
      if (selectedTimeframe !== 'lastseason') {
        lastSeasonGameIdFetchRef.current = { playerId: '', attempted: false };
      }
      return;
    }
    
    const playerId = String(selectedPlayer.id);
    const lastSeason = currentNbaSeason() - 1;
    const getSeasonYear = (stat: any) => {
      if (!stat?.game?.date) return null;
      const d = new Date(stat.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      return m >= 9 ? y : y - 1;
    };
    
    const lastSeasonStats = playerStats.filter(s => getSeasonYear(s) === lastSeason);
    if (lastSeasonStats.length === 0) {
      console.log(`[useEffect lastseason] â­ï¸ No last season stats found, skipping`);
      return;
    }
    
    // Skip if we've already attempted for this player AND we have valid stats
    // But if we still have 0-minute stats, try again (maybe the fetch failed)
    const parseMin = (minStr: string): number => {
      if (!minStr) return 0;
      const str = String(minStr).trim();
      if (!str || str === '0' || str === '00' || str === '0:00') return 0;
      const parts = str.split(':');
      if (parts.length === 2) {
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      }
      const num = parseFloat(str);
      return isNaN(num) ? 0 : num;
    };
    
    const withMinutes = lastSeasonStats.filter(s => {
      const min = parseMin(s.min || '');
      return min > 0;
    });
    
    // Check if we have valid stats (even if minutes are 0)
    const hasValidLastSeasonStats = lastSeasonStats.some(s => {
      const min = parseMin(s.min || '');
      return min > 0 || (s.pts > 0 || s.reb > 0 || s.ast > 0);
    });
    
    // Skip if we've already attempted AND we have valid stats
    if (lastSeasonGameIdFetchRef.current.playerId === playerId && 
        lastSeasonGameIdFetchRef.current.attempted && 
        hasValidLastSeasonStats) {
      console.log(`[useEffect lastseason] â­ï¸ Already attempted for player ${playerId} and have valid stats, skipping`);
      return;
    }
    
    // Reset ref if it's a different player
    if (lastSeasonGameIdFetchRef.current.playerId !== playerId) {
      lastSeasonGameIdFetchRef.current = { playerId, attempted: false };
    }
    
    // If all last season stats have 0 minutes, fetch by game_id
    if (withMinutes.length === 0) {
      // Mark as attempted NOW to prevent duplicate fetches
      lastSeasonGameIdFetchRef.current = { playerId, attempted: true };
      
      console.log(`[useEffect lastseason] ðŸ”§ Detected API data quality issue: all ${lastSeasonStats.length} last season stats have 0 minutes. Fetching by game_id...`);
      
      // Identify ALL games where ATL appears - player was on ATL for those games
      // We know from the logs that there are 4 games where ATL appears
      const atlGames = lastSeasonStats.filter(s => {
        const homeTeam = s.game?.home_team?.abbreviation;
        const visitorTeam = s.game?.visitor_team?.abbreviation;
        return (homeTeam === 'ATL' || visitorTeam === 'ATL') && s.game?.id;
      });
      
      console.log(`[useEffect lastseason] ðŸ” Found ${atlGames.length} games where ATL appears (player was on ATL):`, atlGames.map(s => ({
        gameId: s.game?.id,
        date: s.game?.date,
        homeTeam: s.game?.home_team?.abbreviation,
        visitorTeam: s.game?.visitor_team?.abbreviation,
        statTeam: s.team?.abbreviation
      })));
      
      // Get unique game IDs for games where ATL appears
      const gameIds = Array.from(new Set(
        atlGames
          .map(s => s.game?.id)
          .filter((id): id is number => typeof id === 'number' && !isNaN(id))
      ));
      
      console.log(`[useEffect lastseason] ðŸ” Unique game IDs to fetch: ${gameIds.length}`, gameIds);
      
      if (gameIds.length > 0) {
        console.log(`[useEffect lastseason] ðŸ”§ Found ${gameIds.length} games with player's previous team, fetching stats by game_id...`);
        console.log(`[useEffect lastseason] ðŸ”§ Game IDs to fetch:`, gameIds);
        
        // Fetch stats by game_id in batches (async, don't block)
        const fetchStatsByGameId = async () => {
          const { queuedFetch } = await import('@/lib/requestQueue');
          const batchSize = 50;
          const gameBatches: number[][] = [];
          for (let i = 0; i < gameIds.length; i += batchSize) {
            gameBatches.push(gameIds.slice(i, i + batchSize));
          }
          
          const statsByGameId: BallDontLieStats[] = [];
          for (const batch of gameBatches) {
            try {
              const gameIdsStr = batch.join(',');
              const url = `/api/stats?player_id=${playerId}&game_ids=${gameIdsStr}&per_page=100&max_pages=1`;
              const requestId = `stats-${playerId}-games-${batch[0]}-${Date.now()}`;
              console.log(`[useEffect lastseason] ðŸ”§ Fetching stats for game IDs: ${gameIdsStr}`);
              const r = await queuedFetch(url, {}, requestId);
              const j = await r.json().catch(() => ({}));
              
              console.log(`[useEffect lastseason] ðŸ”§ API response:`, {
                hasData: !!j?.data,
                dataIsArray: Array.isArray(j?.data),
                dataLength: Array.isArray(j?.data) ? j.data.length : 0,
                error: j?.error,
                fullResponse: j
              });
              
              const batchStats = (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
              
              console.log(`[useEffect lastseason] ðŸ”§ Raw batch stats (${batchStats.length}):`, batchStats.slice(0, 3).map(s => ({
                gameId: s.game?.id,
                date: s.game?.date,
                team: s.team?.abbreviation,
                min: s.min,
                pts: s.pts,
                reb: s.reb,
                ast: s.ast
              })));
              
              // WORKAROUND: Even if stats have 0 minutes, if we know from game data that the player
              // was on ATL for these games, include them. The API has data quality issues for players
              // who changed teams, but we can still use the game data to show the player played.
              // We'll include stats if:
              // 1. They have actual minutes/data (normal case), OR
              // 2. The game has ATL as a participant (we know player was on ATL)
              // WORKAROUND: The BallDon'tLie API returns placeholder stats (0 minutes, 0 values) 
              // for players who changed teams, even when querying by game_id.
              // However, we know these are the correct games (we identified them by finding games where ATL appears).
              // So we'll include ALL stats returned from the game_id query, even if they have 0 minutes,
              // because at least we know these are the correct games where the player was on ATL.
              const validStats = batchStats.filter(s => {
                const gameId = s.game?.id;
                const min = parseMin(s.min || '');
                const hasActualData = min > 0 || (s.pts > 0 || s.reb > 0 || s.ast > 0);
                
                // Since we're querying by game_id for games we identified as ATL games,
                // include ALL stats returned, even if they have 0 minutes (API data quality issue)
                const isIdentifiedAtlGame = gameId && gameIds.includes(gameId);
                
                if (isIdentifiedAtlGame) {
                  console.log(`[useEffect lastseason] âœ… Including stat from identified ATL game (even with 0 minutes):`, {
                    gameId,
                    date: s.game?.date,
                    team: s.team?.abbreviation,
                    homeTeam: s.game?.home_team?.abbreviation,
                    visitorTeam: s.game?.visitor_team?.abbreviation,
                    min: s.min,
                    pts: s.pts,
                    reb: s.reb,
                    ast: s.ast
                  });
                  return true; // Always include stats from identified ATL games
                }
                
                // For other games, only include if they have actual data
                if (!hasActualData) {
                  console.log(`[useEffect lastseason] ðŸ” Filtered out stat (not identified ATL game, no data):`, {
                    gameId,
                    min: s.min,
                    parsedMin: min,
                    pts: s.pts
                  });
                }
                return hasActualData;
              });
              
              statsByGameId.push(...validStats);
              console.log(`[useEffect lastseason] ðŸ”§ Fetched ${validStats.length} valid stats from ${batch.length} games (raw: ${batchStats.length})`);
            } catch (error: any) {
              console.warn(`[useEffect lastseason] âš ï¸ Error fetching stats by game_id for batch:`, error?.message || error);
            }
          }
          
          if (statsByGameId.length > 0) {
            console.log(`[useEffect lastseason] âœ… Successfully fetched ${statsByGameId.length} stats by game_id. Updating playerStats...`);
            
            // CORRECT THE TEAM: For stats from identified ATL games, fix the team abbreviation
            // The API returns stat.team=WAS, but we know the player was on ATL for these games
            const correctedStats = statsByGameId.map(stat => {
              const gameId = stat.game?.id;
              if (gameId && gameIds.includes(gameId)) {
                // This is one of our identified ATL games - correct the team to ATL
                const homeTeam = stat.game?.home_team?.abbreviation;
                const visitorTeam = stat.game?.visitor_team?.abbreviation;
                
                // We know the player was on ATL for these games, so set team to ATL
                const correctTeam = 'ATL';
                const correctTeamId = homeTeam === 'ATL' 
                  ? stat.game?.home_team?.id 
                  : (visitorTeam === 'ATL' 
                    ? stat.game?.visitor_team?.id 
                    : stat.team?.id);
                
                // Ensure team.id is always a number (required by BallDontLieStats type)
                // Use the team ID from game data if available, otherwise fall back to original or 0
                const teamId: number = correctTeamId ?? stat.team?.id ?? 0;
                
                console.log(`[useEffect lastseason] ðŸ”§ Correcting team for game ${gameId}: ${stat.team?.abbreviation} â†’ ${correctTeam} (home: ${homeTeam}, visitor: ${visitorTeam}, teamId: ${teamId})`);
                
                return {
                  ...stat,
                  team: {
                    ...(stat.team || {}),
                    abbreviation: correctTeam,
                    id: teamId,
                    full_name: 'Atlanta Hawks',
                    name: 'Hawks'
                  }
                };
              }
              return stat;
            });
            
            // Merge with existing stats
            // Keep all current season stats, and for last season:
            // - Keep all original last season stats (they have game data even if team is wrong)
            // - Add/update with the corrected stats from game_id fetch
            const currentSeasonStats = playerStats.filter(s => getSeasonYear(s) === currentNbaSeason());
            const lastSeasonStatsOriginal = playerStats.filter(s => getSeasonYear(s) === lastSeason);
            
            console.log(`[useEffect lastseason] ðŸ“Š Before merge: current=${currentSeasonStats.length}, lastSeason original=${lastSeasonStatsOriginal.length}, corrected stats=${correctedStats.length}`);
            
            // Create a map of game_id -> corrected stat for quick lookup
            const correctedStatsMap = new Map(correctedStats.map(s => [s.game?.id, s]));
            
            // For each original last season stat, use the corrected version if available, otherwise keep original
            const lastSeasonStatsCorrected = lastSeasonStatsOriginal.map(stat => {
              const gameId = stat.game?.id;
              if (gameId && correctedStatsMap.has(gameId)) {
                console.log(`[useEffect lastseason] ðŸ”„ Replacing stat for game ${gameId} with corrected version`);
                return correctedStatsMap.get(gameId)!;
              }
              return stat;
            });
            
            // Also add any corrected stats that weren't in the original (shouldn't happen, but just in case)
            const correctedGameIds = new Set(correctedStats.map(s => s.game?.id).filter(Boolean));
            const originalGameIds = new Set(lastSeasonStatsOriginal.map(s => s.game?.id).filter(Boolean));
            const newStats = correctedStats.filter(s => {
              const gameId = s.game?.id;
              return gameId && !originalGameIds.has(gameId);
            });
            
            if (newStats.length > 0) {
              console.log(`[useEffect lastseason] âž• Adding ${newStats.length} new stats that weren't in original`);
            }
            
            // Combine: current season + corrected last season stats + any new stats
            const updatedStats = [...currentSeasonStats, ...lastSeasonStatsCorrected, ...newStats];
            
            console.log(`[useEffect lastseason] ðŸ“Š After merge: current=${currentSeasonStats.length}, lastSeason=${lastSeasonStatsCorrected.length}, new=${newStats.length}, total=${updatedStats.length}`);
            
            setPlayerStats(updatedStats);
          } else {
            console.warn(`[useEffect lastseason] âš ï¸ No valid stats found when querying by game_id`);
          }
        };
        
        // Fetch asynchronously (don't block the UI)
        fetchStatsByGameId().catch(err => {
          console.error(`[useEffect lastseason] âŒ Error in fetchStatsByGameId:`, err);
        });
      }
    }
  }, [selectedTimeframe, selectedPlayer?.id, playerStats]);


  // Keep logo URL in sync with selectedTeam/gamePropsTeam and opponentTeam
  useEffect(() => {
    const teamToUse = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    if (teamToUse && teamToUse !== 'N/A') {
      setSelectedTeamLogoAttempt(0);
      setSelectedTeamLogoUrl(getEspnLogoUrl(teamToUse));
    } else {
      setSelectedTeamLogoUrl('');
      setSelectedTeamLogoAttempt(0);
    }
  }, [selectedTeam, gamePropsTeam, propsMode]);

  useEffect(() => {
    if (opponentTeam) {
      setOpponentTeamLogoAttempt(0);
      setOpponentTeamLogoUrl(getEspnLogoUrl(opponentTeam));
    } else {
      setOpponentTeamLogoUrl('');
      setOpponentTeamLogoAttempt(0);
    }
  }, [opponentTeam]);

  // Fetch team matchup stats for pie chart comparison - DEFERRED to not block stats display
  useEffect(() => {
    const fetchTeamMatchupStats = async () => {
      const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
      
      if (!currentTeam || currentTeam === 'N/A' || !opponentTeam || opponentTeam === 'N/A') {
        setTeamMatchupStats({currentTeam: null, opponent: null});
        return;
      }
      
      setTeamMatchupLoading(true);
      try {
        // Fetch stats for both teams
        const [currentTeamResponse, opponentResponse] = await Promise.all([
          fetch(`/api/dvp/team-totals?team=${currentTeam}&games=82`),
          fetch(`/api/dvp/team-totals?team=${opponentTeam}&games=82`)
        ]);
        
        const [currentTeamData, opponentData] = await Promise.all([
          currentTeamResponse.json(),
          opponentResponse.json()
        ]);
        
        setTeamMatchupStats({
          currentTeam: currentTeamData.success ? currentTeamData.perGame : null,
          opponent: opponentData.success ? opponentData.perGame : null
        });
      } catch (error) {
        console.error('Failed to fetch team matchup stats:', error);
        setTeamMatchupStats({currentTeam: null, opponent: null});
      } finally {
        setTeamMatchupLoading(false);
      }
    };
    
    // Defer by 3 seconds to let stats load first
    const timeoutId = setTimeout(fetchTeamMatchupStats, 3000);
    
    return () => clearTimeout(timeoutId);
  }, [propsMode, gamePropsTeam, selectedTeam, opponentTeam]);

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

  // Reset teammate filters whenever the primary context changes (new player/team tab)
  useEffect(() => {
    // Always clear when leaving player mode or switching players
    setTeammateFilterId(null);
    setTeammateFilterName(null);
    setTeammatePlayedGameIds(new Set());
    setWithWithoutMode('with');
    setLoadingTeammateGames(false);
  }, [propsMode, selectedPlayer?.id]);

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
  
  // Restore stats from sessionStorage when player ID is set (for page refresh)
  useEffect(() => {
    if (resolvedPlayerId && hasPremium && typeof window !== 'undefined') {
      // Only restore if stats aren't already loaded
      if (!advancedStats) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${resolvedPlayerId}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
            console.log('âœ… Restored advanced stats from cache for player', resolvedPlayerId);
          }
        } catch (e) {
          console.error('Error restoring advanced stats:', e);
        }
      }
      
      if (!shotDistanceData) {
        try {
          const cachedShotData = sessionStorage.getItem(`shot_distance_${resolvedPlayerId}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
            console.log('âœ… Restored shot chart data from cache for player', resolvedPlayerId);
          }
        } catch (e) {
          console.error('Error restoring shot chart data:', e);
        }
      }
    }
  }, [resolvedPlayerId, hasPremium]); // Restore when player ID or premium status changes
  
  // Close dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside the search container (includes dropdown)
      // The button handlers will close the dropdown themselves
      if (searchRef.current && searchRef.current.contains(target)) {
        return; // Click is inside search container
      }
      // Click is outside - close dropdown
      setShowDropdown(false);
    };
    // Use a slight delay to ensure button onClick handlers fire first
    const handleClick = (e: MouseEvent) => {
      // Use requestAnimationFrame to defer the check until after button handlers
      requestAnimationFrame(() => {
        onClick(e);
      });
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

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



  // Set coreDataReady when stats are loaded; wait for odds (with fallback) to avoid visible refresh
  const lastPlayerStatsLengthRef = useRef(0);
  const coreDataReadySetRef = useRef(false);
  
  useEffect(() => {
    // Reset when loading starts or no stats yet
    if (isLoading || playerStats.length === 0) {
      setCoreDataReady(false);
      coreDataReadySetRef.current = false;
      lastPlayerStatsLengthRef.current = 0;
      return;
    }

    // Only run when playerStats length actually changes (new player selected)
    if (playerStats.length === lastPlayerStatsLengthRef.current && coreDataReadySetRef.current) {
      return;
    }

    // Update ref to track current stats length
    lastPlayerStatsLengthRef.current = playerStats.length;

    // If we've already set coreDataReady for this player, don't re-run
    if (coreDataReadySetRef.current) {
      return;
    }

    // Set coreDataReady immediately - odds will render inline without causing refresh
    setCoreDataReady(true);
    coreDataReadySetRef.current = true;
  }, [playerStats.length, isLoading]);

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

  // Set initial slider range when filter is selected
  useEffect(() => {
    if (selectedFilterForAxis && sliderConfig && sliderRange === null) {
      // Initialize with full range
      setSliderRange({ min: sliderConfig.min, max: sliderConfig.max });
    }
  }, [selectedFilterForAxis, sliderConfig, sliderRange]);

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
  
  // Update bettingLines state when bestLineForStat becomes available
  // This ensures bettingLine (defined earlier) gets updated when odds data loads
  useEffect(() => {
    // Only update if:
    // 1. bestLineForStat is available
    // 2. We don't already have a stored line for this stat
    // 3. The current bettingLine is the default 0.5
    if (bestLineForStat !== null && !(selectedStat in bettingLines)) {
      const currentLine = bettingLine;
      if (Math.abs(currentLine - 0.5) < 0.01) {
        // Only update if it's still at the default
        setBettingLines(prev => ({
          ...prev,
          [selectedStat]: bestLineForStat
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestLineForStat, selectedStat]);
  
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
