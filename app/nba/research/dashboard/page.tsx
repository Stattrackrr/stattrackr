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

      if (lineMovement.length > 0) {
        return lineMovement
          .map((movement) => {
            const dt = new Date(movement.timestamp);
            const timeLabel = dt.toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });
            const direction = movement.change > 0 ? 'up' : movement.change < 0 ? 'down' : 'flat';
            return {
              ts: new Date(movement.timestamp).getTime(),
              timeLabel: `${timeLabel} (${movement.bookmaker})`,
              line: movement.line,
              change: `${movement.change > 0 ? '+' : ''}${movement.change.toFixed(1)}`,
              direction: direction as 'up' | 'down' | 'flat',
            };
          })
          .sort((a, b) => b.ts - a.ts); // Most recent first (descending by timestamp)
      }

      const fallbackRows: { ts: number; timeLabel: string; line: number; change: string; direction: 'up' | 'down' | 'flat' }[] = [];
      const formatLabel = (entry: typeof openingLine, label: string) => {
        if (!entry) return '';
        const dt = new Date(entry.timestamp);
        const time = dt.toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        const suffix = entry.bookmaker ? ` (${entry.bookmaker})` : '';
        return `${time}${suffix}${label ? ` â€” ${label}` : ''}`;
      };

      if (openingLine) {
        fallbackRows.push({
          ts: new Date(openingLine.timestamp).getTime(),
          timeLabel: formatLabel(openingLine, 'Opening'),
          line: openingLine.line,
          change: '',
          direction: 'flat'
        });
      }

      if (currentLine) {
        const delta = openingLine ? currentLine.line - openingLine.line : 0;
        const hasDifferentTimestamp = !openingLine || currentLine.timestamp !== openingLine.timestamp;
        const hasDifferentLine = !openingLine || currentLine.line !== openingLine.line;

        if (hasDifferentTimestamp || hasDifferentLine) {
          fallbackRows.push({
            ts: new Date(currentLine.timestamp).getTime(),
            timeLabel: formatLabel(currentLine, 'Latest'),
            line: currentLine.line,
            change: openingLine ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '',
            direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
          });
        }
      }

      if (fallbackRows.length > 0) {
        return fallbackRows.sort((a, b) => b.ts - a.ts);
      }
    }
    
    // Fallback to old snapshot logic for team mode
    const items = filterByMarket(oddsSnapshots, marketKey)
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp);
    const rows: { ts: number; timeLabel: string; line: number; change: string; direction: 'up' | 'down' | 'flat' }[] = [];
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur = items[i];
      const delta = cur.line - prev.line;
      const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      const dt = new Date(cur.timestamp);
      const timeLabel = dt.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      rows.push({
        ts: cur.timestamp,
        timeLabel,
        line: cur.line,
        change: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`,
        direction: dir,
      });
    }
    return rows.sort((a, b) => b.ts - a.ts); // Most recent first (descending by timestamp)
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
  const isHandlingPlayerSelectRef = useRef<boolean>(false);
  const [playerStats, setPlayerStats] = useState<BallDontLieStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Track when core data (stats + DvP) is ready to show the screen
  const [coreDataReady, setCoreDataReady] = useState(false);
  
  const [apiError, setApiError] = useState<string | null>(null);
  
  // Track the last player ID to detect actual player changes (not just metadata updates)
  const lastPlayerIdRef = useRef<string | null>(null);
  
  // Clear odds data when player ID actually changes (not just metadata updates)
  // Player stats are cleared by handlePlayerSelect functions at the start
  useEffect(() => {
    if (selectedPlayer === null) {
      // Player cleared - reset odds only
      if (lastPlayerIdRef.current !== null) {
        setRealOddsData([]);
        setOddsSnapshots([]);
        setLineMovementData(null);
        setBettingLines({});
        lastPlayerIdRef.current = null;
      }
      return;
    }
    
    // Only clear odds if the player ID actually changed (not just metadata like jersey/height)
    const currentPlayerId = selectedPlayer.id?.toString() || null;
    if (currentPlayerId !== lastPlayerIdRef.current) {
      // Player ID changed - clear odds data
      console.log('[Odds Clear] Player ID changed, clearing odds', {
        oldId: lastPlayerIdRef.current,
        newId: currentPlayerId,
        playerName: selectedPlayer.full,
        currentOddsLength: realOddsData.length
      });
      // Only clear if we actually have odds to clear (prevent unnecessary state updates)
      if (realOddsData.length > 0 || oddsLoading || oddsError) {
        setRealOddsData([]);
        setOddsSnapshots([]);
        setLineMovementData(null);
        setOddsLoading(false);
        setOddsError(null);
        setBettingLines({});
        setBookOpeningLine(null);
        setBookCurrentLine(null);
      }
      lastPlayerIdRef.current = currentPlayerId;
      // Reset odds fetch ref so it will fetch again for the new player
      lastOddsPlayerIdRef.current = null;
    }
    // If player ID is the same, don't clear odds (just metadata update like jersey/height)
  }, [selectedPlayer]);
  
  // Clear player state when player parameter is removed from URL (e.g., browser back button)
  useEffect(() => {
    const player = searchParams.get('player');
    const pid = searchParams.get('pid');
    const name = searchParams.get('name');
    
    // If there's no player parameter in URL but we have a selected player, clear it
    if (!player && !pid && !name && selectedPlayer) {
      console.log('[Dashboard] ðŸ§¹ Clearing selectedPlayer - no player parameter in URL');
      setSelectedPlayer(null);
      setResolvedPlayerId(null);
      setPlayerStats([]);
      setRealOddsData([]);
      setOddsSnapshots([]);
      setLineMovementData(null);
    }
  }, [searchParams, selectedPlayer]);
  
  // Advanced stats state
  const [advancedStats, setAdvancedStats] = useState<AdvancedStats | null>(null);
  const [advancedStatsLoading, setAdvancedStatsLoading] = useState(false);
  const [advancedStatsError, setAdvancedStatsError] = useState<string | null>(null);
  
  // Advanced stats per game (for second axis - pace and usage_rate)
  const [advancedStatsPerGame, setAdvancedStatsPerGame] = useState<Record<number, { pace?: number; usage_percentage?: number }>>({});
  
  // DvP ranks per game (for second axis - dvp_rank)
  const [dvpRanksPerGame, setDvpRanksPerGame] = useState<Record<string, number | null>>({});
  
  // Prefetched advanced stats (pace, usage_rate) - stored by game ID
  const [prefetchedAdvancedStats, setPrefetchedAdvancedStats] = useState<Record<number, { pace?: number; usage_percentage?: number }>>({});
  
  // Prefetched DvP ranks - stored by stat/metric combination
  const [prefetchedDvpRanks, setPrefetchedDvpRanks] = useState<Record<string, Record<string, number | null>>>({});
  
  // Refs to track prefetch status (prevent duplicate prefetches)
  const advancedStatsPrefetchRef = useRef<Set<string>>(new Set());
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

  // When a team's game goes Final, immediately switch VS to next opponent (or ALL if none)
  // Also track next game for prop tracking/journal
  useEffect(() => {
    const teamToCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;
    if (!teamToCheck || teamToCheck === 'N/A' || todaysGames.length === 0) {
      setNextGameOpponent('');
      setNextGameDate('');
      setIsGameInProgress(false);
      return;
    }

    const normTeam = normalizeAbbr(teamToCheck);
    const now = Date.now();

    // Find upcoming games for this team
    const teamGames = todaysGames.filter((g: any) => {
      const home = normalizeAbbr(g?.home_team?.abbreviation || '');
      const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
      return home === normTeam || away === normTeam;
    });

    // Map all games with their info
    const mappedGames = teamGames.map((g: any) => ({ 
      g, 
      t: new Date(g.date || 0).getTime(), 
      status: String(g.status || '').toLowerCase(),
      rawStatus: String(g.status || '')
    }));
    
    // Check if there's a game currently in progress first
    const threeHoursMs = 3 * 60 * 60 * 1000;
    let currentGame = mappedGames.find((game) => {
      const rawStatus = game.rawStatus;
      const gameStatus = game.status;
      
      // Check if game is live by looking at tipoff time (same logic as check-bets endpoints)
      let isLive = false;
      const tipoffTime = Date.parse(rawStatus);
      if (!Number.isNaN(tipoffTime)) {
        const timeSinceTipoff = now - tipoffTime;
        isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
      }
      
      // Also check if game time has passed and game isn't final (fallback if status isn't a timestamp)
      const gameStarted = game.t <= now;
      const timeSinceGameTime = now - game.t;
      const isWithinThreeHours = timeSinceGameTime > 0 && timeSinceGameTime < threeHoursMs;
      
      // API sometimes returns date strings as status - ignore these
      const isDateStatus = rawStatus.includes('T') || rawStatus.includes('+') || rawStatus.match(/\d{4}-\d{2}-\d{2}/);
      
      // Mark as in progress if:
      // 1. Game is live (started within last 3 hours based on status timestamp), OR
      // 2. Game time has passed within last 3 hours and status doesn't indicate final
      return (isLive || (gameStarted && isWithinThreeHours && !isDateStatus)) 
        && gameStatus !== '' 
        && gameStatus !== 'scheduled' 
        && !gameStatus.includes('final') 
        && !gameStatus.includes('completed');
    });
    
    // If no game in progress, find next upcoming game
    const nextGame = currentGame || mappedGames
      .sort((a, b) => a.t - b.t)
      .find(({ status }) => !status.includes('final') && !status.includes('completed'));
    
    if (nextGame) {
      const home = normalizeAbbr(nextGame.g?.home_team?.abbreviation || '');
      const away = normalizeAbbr(nextGame.g?.visitor_team?.abbreviation || '');
      const opponent = normTeam === home ? away : home;
      const gameDate = nextGame.g?.date ? new Date(nextGame.g.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      // Check if game is in progress (same logic as above)
      const rawStatus = nextGame.rawStatus;
      const gameStatus = nextGame.status;
      
      // Check if game is live by looking at tipoff time (same logic as check-bets endpoints)
      let isLive = false;
      const tipoffTime = Date.parse(rawStatus);
      if (!Number.isNaN(tipoffTime)) {
        const timeSinceTipoff = now - tipoffTime;
        isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
      }
      
      // Also check if game time has passed and game isn't final (fallback if status isn't a timestamp)
      const gameStarted = nextGame.t <= now;
      const timeSinceGameTime = now - nextGame.t;
      const isWithinThreeHours = timeSinceGameTime > 0 && timeSinceGameTime < threeHoursMs;
      
      // API sometimes returns date strings as status - ignore these
      const isDateStatus = rawStatus.includes('T') || rawStatus.includes('+') || rawStatus.match(/\d{4}-\d{2}-\d{2}/);
      
      // Mark as in progress if:
      // 1. Game is live (started within last 3 hours based on status timestamp), OR
      // 2. Game time has passed within last 3 hours and status doesn't indicate final
      const inProgress = (isLive || (gameStarted && isWithinThreeHours && !isDateStatus)) 
        && gameStatus !== '' 
        && gameStatus !== 'scheduled' 
        && !gameStatus.includes('final') 
        && !gameStatus.includes('completed');
      
      console.log('Game progress check:', { 
        opponent, 
        gameDate, 
        status: rawStatus, 
        gameStatus,
        isDateStatus,
        tipoffTime: !Number.isNaN(tipoffTime) ? new Date(tipoffTime).toISOString() : 'invalid',
        gameTime: new Date(nextGame.t).toISOString(), 
        now: new Date(now).toISOString(),
        gameStarted,
        timeSinceGameTime: timeSinceGameTime / (60 * 60 * 1000) + ' hours',
        isWithinThreeHours,
        isLive,
        inProgress,
        isCurrentGame: !!currentGame
      });
      
      setNextGameOpponent(opponent || '');
      setNextGameDate(gameDate);
      setIsGameInProgress(inProgress);
      
      // Store tipoff time for countdown
      console.log('[Countdown DEBUG] Raw game data:', {
        game: nextGame.g,
        gameDate: nextGame.g?.date,
        gameStatus: nextGame.g?.status,
        gameDateTime: nextGame.g?.datetime,
        rawStatus: nextGame.rawStatus,
        gameTime: new Date(nextGame.t).toISOString(),
        now: new Date(now).toISOString(),
        gameTimeMs: nextGame.t,
        nowMs: now,
        gameTimeDiff: nextGame.t - now,
        gameTimeDiffHours: (nextGame.t - now) / (1000 * 60 * 60)
      });
      
      let tipoffDate: Date | null = null;
      
      // First, try to use the datetime field from the game object (most reliable)
      if (nextGame.g?.datetime) {
        const gameDateTime = new Date(nextGame.g.datetime);
        if (!Number.isNaN(gameDateTime.getTime()) && gameDateTime.getTime() > now) {
          tipoffDate = gameDateTime;
          console.log('[Countdown DEBUG] Using game.datetime field:', tipoffDate.toISOString());
        }
      }
      
      // If that didn't work, check if rawStatus is a valid ISO timestamp (like "2025-12-07T00:00:00Z")
      if (!tipoffDate) {
        const statusTime = Date.parse(rawStatus);
        if (!Number.isNaN(statusTime)) {
          const parsedStatus = new Date(statusTime);
          // Check if it's at midnight (00:00:00) - if so, it's just a date placeholder, not the actual game time
          const isMidnight = parsedStatus.getUTCHours() === 0 && parsedStatus.getUTCMinutes() === 0 && parsedStatus.getUTCSeconds() === 0;
          console.log('[Countdown DEBUG] Date.parse(rawStatus):', parsedStatus.toISOString(), isMidnight ? '(MIDNIGHT - date placeholder, not actual game time)' : '(has time)');
          
          // Only use if it's in the future and NOT midnight (midnight means it's just a date, not actual game time)
          if (parsedStatus.getTime() > now && !isMidnight && parsedStatus.getTime() < now + (7 * 24 * 60 * 60 * 1000)) {
            tipoffDate = parsedStatus;
            console.log('[Countdown DEBUG] Using rawStatus as ISO timestamp:', tipoffDate.toISOString());
          } else if (isMidnight) {
            // If it's midnight, it's just a date - we'll need to get the actual game time from elsewhere
            console.log('[Countdown DEBUG] rawStatus is midnight (date only), will try other methods');
          }
        }
      }
      
      // Try to parse tipoff from status (this extracts time from status like "7:00 PM")
      if (!tipoffDate) {
        tipoffDate = parseBallDontLieTipoff(nextGame.g);
        console.log('[Countdown DEBUG] parseBallDontLieTipoff result:', tipoffDate?.toISOString() || 'null');
      }
      
      // If still no valid tipoff, use the game date/time from nextGame.t
      // But check if it's actually in the future
      if (!tipoffDate || tipoffDate.getTime() <= now) {
        const gameTime = new Date(nextGame.t);
        console.log('[Countdown DEBUG] Game time check:', {
          gameTime: gameTime.toISOString(),
          gameTimeMs: gameTime.getTime(),
          nowMs: now,
          isFuture: gameTime.getTime() > now,
          diff: gameTime.getTime() - now,
          diffHours: (gameTime.getTime() - now) / (1000 * 60 * 60)
        });
        
        // Only use gameTime if it's in the future
        if (gameTime.getTime() > now) {
          tipoffDate = gameTime;
          console.log('[Countdown DEBUG] Using gameTime (future):', tipoffDate.toISOString());
        } else {
          // If gameTime is in the past, the game might be scheduled for later today
          // Try to extract time from status string
          const timeMatch = rawStatus.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
          console.log('[Countdown DEBUG] Time match from status:', timeMatch);
          
          if (timeMatch) {
            const gameDateStr = nextGame.g?.date || new Date().toISOString().split('T')[0];
            let hour = parseInt(timeMatch[1], 10);
            const minute = parseInt(timeMatch[2], 10);
            const meridiem = timeMatch[3].toUpperCase();
            if (meridiem === 'PM' && hour !== 12) hour += 12;
            else if (meridiem === 'AM' && hour === 12) hour = 0;
            
            // Create date with today's date and the parsed time
            const today = new Date();
            const tipoff = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute, 0);
            
            // If this time has already passed today, assume it's for tomorrow
            if (tipoff.getTime() <= now) {
              tipoff.setDate(tipoff.getDate() + 1);
            }
            
            tipoffDate = tipoff;
            console.log('[Countdown DEBUG] Created tipoff from status time:', tipoffDate.toISOString());
          } else {
            // Last resort: The rawStatus might be a date timestamp (midnight)
            // If so, extract the date and assume a reasonable game time (7:30 PM local)
            const hoursSinceGameTime = (now - gameTime.getTime()) / (1000 * 60 * 60);
            console.log('[Countdown DEBUG] Hours since game time:', hoursSinceGameTime);
            
            // Check if rawStatus is a date timestamp (midnight UTC)
            const statusTime = Date.parse(rawStatus);
            if (!Number.isNaN(statusTime)) {
              const statusDate = new Date(statusTime);
              const isMidnight = statusDate.getUTCHours() === 0 && statusDate.getUTCMinutes() === 0;
              
              if (isMidnight && statusDate.getTime() > now) {
                // It's a date timestamp - extract the date and assume game is at 7:30 PM local time
                const localDate = new Date(statusDate);
                // Convert to local time and set to 7:30 PM
                localDate.setHours(19, 30, 0, 0); // 7:30 PM local
                tipoffDate = localDate;
                console.log('[Countdown DEBUG] Using date from rawStatus with 7:30 PM local time:', tipoffDate.toISOString());
              } else if (hoursSinceGameTime < 24 && hoursSinceGameTime > -12) {
                // Game might be today, but we don't know the time - use a reasonable estimate
                // Most NBA games are between 7 PM and 10 PM local time
                const today = new Date();
                today.setHours(19, 30, 0, 0); // 7:30 PM today
                if (today.getTime() <= now) {
                  // If 7:30 PM has passed, assume it's tomorrow
                  today.setDate(today.getDate() + 1);
                }
                tipoffDate = today;
                console.log('[Countdown DEBUG] Using estimated time (7:30 PM today/tomorrow):', tipoffDate.toISOString());
              } else {
                tipoffDate = gameTime;
                console.log('[Countdown DEBUG] Using gameTime (last resort):', tipoffDate.toISOString());
              }
            } else {
              tipoffDate = gameTime;
              console.log('[Countdown DEBUG] Using gameTime (last resort):', tipoffDate.toISOString());
            }
          }
        }
      }
      
      const finalDiff = tipoffDate.getTime() - now;
      setNextGameTipoff(tipoffDate);
      console.log('[Countdown] Final tipoff calculation:', { 
        tipoffDate: tipoffDate?.toISOString(), 
        gameDate: nextGame.g?.date,
        rawStatus: nextGame.rawStatus,
        gameTime: new Date(nextGame.t).toISOString(),
        now: new Date(now).toISOString(),
        diff: finalDiff,
        diffHours: finalDiff / (1000 * 60 * 60),
        diffMinutes: finalDiff / (1000 * 60),
        willShowCountdown: finalDiff > 0 && !inProgress
      });
    } else {
      setNextGameOpponent('');
      setNextGameDate('');
      setNextGameTipoff(null);
      setIsGameInProgress(false);
    }

    // SMART AUTO-SWITCH: Only switch when the CURRENT opponent's game goes final
    // This prevents unnecessary re-renders when unrelated games finish
    if (opponentTeam && opponentTeam !== '' && opponentTeam !== 'N/A' && opponentTeam !== 'ALL') {
      // Find the game between current team and current opponent
      const currentGame = teamGames.find((g: any) => {
        const home = normalizeAbbr(g?.home_team?.abbreviation || '');
        const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
        return (home === normTeam && away === opponentTeam) || (away === normTeam && home === opponentTeam);
      });
      
      if (currentGame) {
        const status = String(currentGame.status || '').toLowerCase();
        const isCurrentGameFinal = status.includes('final') || status.includes('completed');
        
        console.log(`  Current game (${normTeam} vs ${opponentTeam}): status=${status}, final=${isCurrentGameFinal}`);
        
        if (isCurrentGameFinal) {
          console.log(`  -> Current game is final, finding next opponent...`);
          const nextOpponent = getOpponentTeam(normTeam, todaysGames);
          if (nextOpponent && nextOpponent !== opponentTeam) {
            console.log(`  -> Auto-switching from ${opponentTeam} to ${nextOpponent}`);
            setOpponentTeam(nextOpponent);
          } else {
            console.log(`  -> No next opponent found, keeping current`);
          }
        }
      }
    }
  }, [todaysGames, selectedTeam, gamePropsTeam, propsMode, manualOpponent, opponentTeam]);

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




  // On mount: restore from sessionStorage and URL once
  useEffect(() => {
    console.log(`[Dashboard] ðŸš€ Mount useEffect running - checking URL and session storage`);
    let initialPropsMode: 'player' | 'team' = 'player';
    let shouldLoadDefaultPlayer = true;
    

    // First, restore propsMode from session storage
    try {
      const raw = getSavedSession();
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedSession> & { gamePropsTeam?: string };
        if (saved?.propsMode && (saved.propsMode === 'player' || saved.propsMode === 'team')) {
          initialPropsMode = saved.propsMode;
          setPropsMode(saved.propsMode);
          
          // Restore gamePropsTeam if in team mode
          if (saved.propsMode === 'team' && saved.gamePropsTeam && saved.gamePropsTeam !== 'N/A') {
            setGamePropsTeam(saved.gamePropsTeam);
          }
        }
        // Don't restore stat from session storage if there's a stat in the URL (URL takes precedence)
        const urlHasStat = typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('stat') : null;
        if (saved?.selectedStat && !urlHasStat) {
          console.log(`[Dashboard] ðŸ“¦ Restoring stat from session storage: "${saved.selectedStat}" (no stat in URL)`);
          setSelectedStat(saved.selectedStat);
        } else if (urlHasStat) {
          console.log(`[Dashboard] â­ï¸ Skipping session storage stat restore - stat "${urlHasStat}" found in URL`);
        }
        // Only restore selectedTimeframe if we have playerStats loaded (prevents race condition)
        // If playerStats is empty, don't restore timeframe yet - wait for stats to load first
        if (saved?.selectedTimeframe && playerStats.length > 0) {
          setSelectedTimeframe(saved.selectedTimeframe);
        }
      }
    } catch {}

    // Then check URL parameters (can override session storage)
    try {
      if (typeof window !== 'undefined') {
        // Capture initial URL IMMEDIATELY to prevent race conditions
        const initialUrl = window.location.href;
        console.log(`[Dashboard] ðŸ” Initial URL (captured immediately): ${initialUrl}`);
        const url = new URL(initialUrl);
        const pid = url.searchParams.get('pid');
        const name = url.searchParams.get('name');
        const player = url.searchParams.get('player'); // Support 'player' param (from player props page)
        const team = url.searchParams.get('team') || undefined;
        const stat = url.searchParams.get('stat');
        const line = url.searchParams.get('line');
        const tf = url.searchParams.get('tf');
        const mode = url.searchParams.get('mode');
        
        console.log(`[Dashboard] ðŸ” URL params: stat="${stat}", player="${player}", mode="${mode}", line="${line}"`);
        console.log(`[Dashboard] ðŸ” All URL params:`, Object.fromEntries(url.searchParams.entries()));
        console.log(`[Dashboard] ðŸ” Current window.location.href: ${window.location.href}`);
        
        // Set stat from URL FIRST (before propsMode) to prevent default stat logic from overriding it
        if (stat) {
          console.log(`[Dashboard] âœ… Found stat in URL: "${stat}"`);
          // Normalize stat from props page format (uppercase) to dashboard format (lowercase)
          // Also handle special cases like "THREES" -> "fg3m"
          const normalizedStat = (() => {
            const statUpper = stat.toUpperCase();
            // Map special cases first
            if (statUpper === 'THREES' || statUpper === '3PM' || statUpper === '3PM/A') {
              return 'fg3m';
            }
            // Convert uppercase to lowercase for standard stats
            // Props page uses: PTS, REB, AST, STL, BLK, PRA, PA, PR, RA
            // Dashboard expects: pts, reb, ast, stl, blk, pra, pa, pr, ra
            return stat.toLowerCase();
          })();
          
          console.log(`[Dashboard] ðŸ“Š Setting stat from URL: "${stat}" -> "${normalizedStat}"`);
          
          // Set flag to prevent default stat logic from overriding
          statFromUrlRef.current = true;
          setSelectedStat(normalizedStat);
          
          // Store in session storage to persist across player loading
          const saved = getSavedSession();
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedStat = normalizedStat;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
          
          // If line is provided, set it for this stat (use normalized stat for the key)
          if (line) {
            const lineValue = parseFloat(line);
            if (!isNaN(lineValue)) {
              setBettingLines(prev => ({
                ...prev,
                [normalizedStat]: Math.abs(lineValue) // Use absolute value (line can be negative for under props)
              }));
            }
          }
        } else {
          console.log(`[Dashboard] âš ï¸ No stat parameter found in URL`);
        }
        
        // Set propsMode AFTER stat (so default stat logic can see the URL stat)
        if (mode === 'team' || mode === 'player') {
          console.log(`[Dashboard] ðŸ“ Setting propsMode from URL: "${mode}"`);
          initialPropsMode = mode;
          setPropsMode(mode);
        }
        
        // Handle 'player' param (from player props page) - use it if 'name' is not provided
        const playerName = name || player;
        // When coming from player props page, default to "thisseason" to show current season data
        // ALWAYS override "thisseason" from URL to use "last10" as default
        // Only use URL timeframe if it's NOT "thisseason"
        if (tf && tf !== 'thisseason') {
          // Set timeframe immediately from URL (don't wait for stats to load)
          // This ensures the correct timeframe is active when stats load
          console.log(`[Dashboard] âœ… Setting timeframe from URL: "${tf}"`);
          setSelectedTimeframe(tf);
          // Also store it in session storage for persistence
          const saved = getSavedSession();
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedTimeframe = tf;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
        } else {
          // ALWAYS default to last10 (override "thisseason" from URL or when no URL param)
          console.log(`[Dashboard] ðŸ”„ FORCING timeframe to "last10" (overriding URL tf=${tf || 'none'})`);
          setSelectedTimeframe('last10');
          // Update URL to reflect the change
          if (typeof window !== 'undefined') {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('tf', 'last10');
            window.history.replaceState({}, '', newUrl.toString());
          }
          // Store in session storage
          const saved = getSavedSession();
          if (saved && typeof saved === 'string') {
            try {
              const parsed = JSON.parse(saved);
              parsed.selectedTimeframe = 'last10';
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            } catch {}
          }
        }
        
        // Handle player selection - support both 'pid+name' and 'player' params
        if (false) { // Disabled - moved below
          // Coming from player props page without explicit timeframe - default to last10
          console.log(`[Dashboard] Setting default timeframe to "last10" for player from props page`);
          setSelectedTimeframe('last10');
          // Store in session storage
          if (typeof window !== 'undefined') {
            const saved = sessionStorage.getItem(SESSION_KEY);
            if (saved !== null) {
              try {
                const parsed = JSON.parse(saved as string);
                parsed.selectedTimeframe = 'last10';
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
              } catch {}
            }
          }
        }
        // Handle player selection - support both 'pid+name' and 'player' params
        if (pid && playerName) {
          const r: BdlSearchResult = { id: Number(pid), full: playerName, team, pos: undefined };
          if (initialPropsMode === 'player') {
            handlePlayerSelectFromSearch(r);
            shouldLoadDefaultPlayer = false;
            return;
          }
        } else if (playerName && !pid) {
          // If only 'player' name is provided (from player props page), search for the player
          if (initialPropsMode === 'player') {
            // OPTIMIZATION: Show player name immediately from URL (optimistic UI)
            // This prevents blank screen while searching
            const urlTeam = team ? normalizeAbbr(team) : '';
            startTransition(() => {
              setSelectedPlayer({
                id: '',
                full: playerName,
                firstName: playerName.split(' ')[0] || playerName,
                lastName: playerName.split(' ').slice(1).join(' ') || '',
                teamAbbr: urlTeam,
                jersey: '',
                heightFeet: null,
                heightInches: null,
                position: '',
              } as any);
              if (urlTeam) {
                setSelectedTeam(urlTeam);
                setOriginalPlayerTeam(urlTeam);
                setDepthChartTeam(urlTeam);
              }
            });
            
            // Set loading state immediately to prevent double render
            setIsLoading(true);
            // Trigger search for the player name
            const searchForPlayer = async () => {
              try {
                console.log(`[Dashboard] ðŸ” [Props Page] Searching for player: "${playerName}"`);
                serverLogger.log(`[Dashboard] ðŸ” [Props Page] Searching for player: "${playerName}"`);
                
                // OPTIMIZATION: Try all search variations in parallel instead of sequentially
                // This reduces search time from ~1.8s to ~0.6s (fastest response wins)
                const nameParts = playerName.trim().split(/\s+/);
                const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                
                const searchPromises = [
                  fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}`).catch(() => null),
                  fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}&all=true`).catch(() => null),
                ];
                
                // Only add last name search if we have a last name
                if (lastName && lastName !== playerName) {
                  searchPromises.push(
                    fetch(`/api/bdl/players?q=${encodeURIComponent(lastName)}&all=true`).catch(() => null)
                  );
                }
                
                // Wait for all searches, but use the first one that returns results
                const searchResponses = await Promise.all(searchPromises);
                let rawResults: any[] | null = null;
                let json: any = null;
                
                // Check searchResponses in order of preference (exact match first, then all=true, then last name)
                for (const res of searchResponses) {
                  if (!res || !res.ok) continue;
                  try {
                    json = await res.json();
                    rawResults = json?.results || json?.data;
                    if (Array.isArray(rawResults) && rawResults.length > 0) {
                      console.log(`[Dashboard] âœ… [Props Page] Found results from parallel search`);
                      break; // Use first successful result
                    }
                  } catch (e) {
                    // Continue to next result
                  }
                }
                
                // Fallback: if no results, try the original sequential approach
                if (!rawResults || !Array.isArray(rawResults) || rawResults.length === 0) {
                  console.log(`[Dashboard] âš ï¸ [Props Page] Parallel search found no results, trying sequential fallback...`);
                  const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(playerName)}`);
                  if (res.ok) {
                    json = await res.json();
                    rawResults = json?.results || json?.data;
                  }
                }
                
                const results: BdlSearchResult[] = Array.isArray(rawResults) && rawResults.length > 0
                  ? rawResults.map((r: any) => ({ 
                      id: r.id, 
                      full: r.full, 
                      team: r.team, 
                      pos: r.pos, 
                      headshotUrl: r.headshotUrl || null 
                    }))
                  : [];
                console.log(`[Dashboard] ðŸ“Š [Props Page] Parsed ${results.length} results for "${playerName}"`);
                if (results && results.length > 0) {
                  // Try to find exact match first, then use first result
                  const playerNameLower = playerName.toLowerCase().trim();
                  let playerResult = results.find(r => r.full.toLowerCase().trim() === playerNameLower);
                  if (!playerResult) {
                    // Try partial match (first name or last name)
                    playerResult = results.find(r => {
                      const fullLower = r.full.toLowerCase().trim();
                      return fullLower.includes(playerNameLower) || playerNameLower.includes(fullLower);
                    });
                  }
                  // Fallback to first result
                  if (!playerResult) {
                    playerResult = results[0];
                  }
                  
                  console.log(`[Dashboard] âœ… [Props Page] Found player: ${playerResult.full} (ID: ${playerResult.id}, Team: ${playerResult.team})`);
                  serverLogger.log(`[Dashboard] âœ… [Props Page] Found player: ${playerResult.full}`, { data: { id: playerResult.id, team: playerResult.team } });
                  const r: BdlSearchResult = {
                    id: playerResult.id,
                    full: playerResult.full,
                    team: playerResult.team,
                    pos: playerResult.pos
                  };
                  
                  // OPTIMIZATION: Show player immediately, then load stats in background
                  // This prevents the 5-7 second delay before any UI appears
                  const currentTeam = normalizeAbbr(r.team || '');
                  const pid = String(r.id);
                  
                  // Set player info immediately (optimistic UI)
                  startTransition(() => {
                    setSelectedPlayer({
                      id: pid,
                      full: r.full,
                      firstName: r.full.split(' ')[0] || r.full,
                      lastName: r.full.split(' ').slice(1).join(' ') || '',
                      teamAbbr: currentTeam,
                      jersey: '',
                      heightFeet: null,
                      heightInches: null,
                      position: r.pos || '',
                    } as any);
                    setSelectedTeam(currentTeam);
                    setOriginalPlayerTeam(currentTeam);
                    setDepthChartTeam(currentTeam);
                    setResolvedPlayerId(pid);
                    setPlayerStats([]); // Clear old stats, will load new ones
                  });
                  
                  // Now load stats in background without blocking
                  console.log(`[Dashboard] ðŸš€ [Props Page] Loading stats in background for:`, r);
                  serverLogger.log(`[Dashboard] ðŸš€ [Props Page] Loading stats in background`, { data: r });
                  handlePlayerSelectFromSearch(r).catch(err => {
                    console.error('[Dashboard] âŒ [Props Page] Error loading player stats:', err);
                    setApiError(`Failed to load stats: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    setIsLoading(false);
                  });
                  shouldLoadDefaultPlayer = false;
                } else {
                  console.warn(`[Dashboard] âš ï¸ [Props Page] No results found for player: "${playerName}"`);
                  console.warn(`[Dashboard] âš ï¸ [Props Page] API response was:`, json);
                  setApiError(`Player "${playerName}" not found. Please try searching manually.`);
                  setIsLoading(false); // Clear loading state if no results found
                }
              } catch (error) {
                console.error(`[Dashboard] âŒ [Props Page] Error searching for player "${playerName}":`, error);
                setApiError(`Error searching for player: ${error instanceof Error ? error.message : 'Unknown error'}`);
                setIsLoading(false); // Clear loading state on error
              }
            };
            // Await the search to ensure it completes before continuing
            searchForPlayer().catch(err => {
              console.error('[Dashboard] âŒ [Props Page] Unhandled error in searchForPlayer:', err);
              setApiError(`Failed to load player: ${err instanceof Error ? err.message : 'Unknown error'}`);
              setIsLoading(false); // Clear loading state on error
            });
            shouldLoadDefaultPlayer = false;
            // Don't return here - let the useEffect continue to set up other things
          }
        }
      }
    } catch (urlError) {
      console.error('[Dashboard] Error processing URL parameters:', urlError);
    }

    // Finally, restore saved player if in player mode
    if (initialPropsMode === 'player') {
      try {
        const raw = getSavedSession();
        if (raw) {
          const saved = JSON.parse(raw) as Partial<SavedSession & { playerCleared?: boolean }>;
          
          // If user deliberately cleared player data by switching modes, don't load default
          if (saved?.playerCleared) {
            shouldLoadDefaultPlayer = false;
            return;
          }
          
          // Only restore player data if the saved mode matches current mode
          if (saved?.propsMode === 'player') {
            const r = saved?.player as BdlSearchResult | undefined;
            if (r && r.id && r.full) {
              handlePlayerSelectFromSearch(r);
              shouldLoadDefaultPlayer = false;
              return;
            }
          }
        }
      } catch {}

      // Never auto-load any default player
      // Players should only be loaded when explicitly searched for or from URL sharing
    }
  }, []); // Only run once on mount

  // Restore timeframe from session storage when playerStats loads (fixes race condition)
  // Only run once when playerStats first loads, not on every timeframe change
  // NOTE: This should NOT override URL parameters - URL params are set immediately in initial useEffect
  const hasRestoredTimeframeRef = useRef(false);
  useEffect(() => {
    // Only restore if:
    // 1. Stats are loaded
    // 2. We haven't restored yet
    // 3. We're still on the default timeframe (last10) - meaning no URL param or manual selection happened
    // 4. There's a saved timeframe that's different from the default
    // ALWAYS force "last10" if we see "thisseason" anywhere
    if (playerStats.length > 0 && !hasRestoredTimeframeRef.current) {
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const urlTimeframe = url?.searchParams.get('tf');
      
      // If URL has "thisseason", force it to "last10"
      if (urlTimeframe === 'thisseason' || selectedTimeframe === 'thisseason') {
        console.log('[Dashboard] ðŸ”„ FORCING timeframe from "thisseason" to "last10" in restore logic');
        setSelectedTimeframe('last10');
        if (typeof window !== 'undefined') {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('tf', 'last10');
          window.history.replaceState({}, '', newUrl.toString());
        }
        hasRestoredTimeframeRef.current = true;
        return;
      }
      
      // Check if URL has a timeframe param - respect other values
      if (urlTimeframe && urlTimeframe !== 'thisseason') {
        console.log('[Dashboard] âš ï¸ Skipping timeframe restore - URL has timeframe param:', urlTimeframe);
        hasRestoredTimeframeRef.current = true;
        return;
      }
      
      // Only restore if we're still on default timeframe (last10)
      // This means we haven't manually selected a timeframe yet
      try {
        const saved = getSavedSession();
        if (saved && typeof saved === 'string') {
          const parsed = JSON.parse(saved);
          if (parsed?.selectedTimeframe && parsed.selectedTimeframe !== 'last10') {
            console.log(`[Dashboard] ðŸ”„ Restoring timeframe from session: "${parsed.selectedTimeframe}"`);
            setSelectedTimeframe(parsed.selectedTimeframe);
          }
        }
      } catch {}
      hasRestoredTimeframeRef.current = true;
    }
  }, [playerStats.length, selectedTimeframe]); // Added selectedTimeframe to check current value

  /* --------- Live search (debounced) using /api/bdl/players ---------- */
  useEffect(() => {
    let t: any;
    const run = async () => {
      const q = searchQuery.trim();
      setSearchError(null);
      if (q.length < 2) { setSearchResults([]); return; }
      setSearchBusy(true);
      try {
        // For full name searches (contains space) or short queries, use broader search + client filtering
        const isFullNameSearch = q.includes(' ') || q.length < 3;
        const searchQuery = isFullNameSearch ? q.split(' ')[0] : q; // Use first word for API search
        
        const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(searchQuery)}`);
        const json = await res.json().catch(() => ({}));
        const err = json?.error || null;
        setSearchError(err);
        
        let arr: BdlSearchResult[] = Array.isArray(json?.results)
          ? json.results.map((r: any) => ({ id: r.id, full: r.full, team: r.team, pos: r.pos, headshotUrl: r.headshotUrl || null }))
          : [];
        
        // Client-side fuzzy filtering for full name searches
        if (isFullNameSearch && q.includes(' ')) {
          const queryWords = q.toLowerCase().split(' ').filter(word => word.length > 0);
          arr = arr.filter(player => {
            const playerName = player.full.toLowerCase();
            // Check if all query words are found in the player name
            return queryWords.every(word => 
              playerName.includes(word) || 
              // Also check if any word in player name starts with the query word
              playerName.split(' ').some(nameWord => nameWord.startsWith(word))
            );
          });
        }
        // dedupe & cap (20 results for faster rendering)
        const seen = new Set<string>();
        const dedup = arr.filter(r => {
          if (seen.has(r.full)) return false;
          seen.add(r.full);
          return true;
        }).slice(0, 20);
        setSearchResults(dedup);
      } catch (e: any) {
        setSearchError(e?.message || "Search failed");
        setSearchResults([]);
      } finally {
        setSearchBusy(false);
      }
    };
    t = setTimeout(run, 100);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Persist session when key state changes
  useEffect(() => {
    try {
      // Always save propsMode, selectedStat, and selectedTimeframe
      const baseSave: Partial<SavedSession> = {
        propsMode,
        selectedStat,
        selectedTimeframe,
      };

      // Add player data if in player mode and player is selected
      if (selectedPlayer && selectedTeam && propsMode === 'player') {
        const r: BdlSearchResult = {
          id: Number(resolvedPlayerId || selectedPlayer.id),
          full: selectedPlayer.full,
          team: selectedTeam,
          pos: (selectedPlayer as any).position || undefined,
        };
        (baseSave as SavedSession).player = r;
      }
      
      // Add team data if in team mode and team is selected
      if (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A') {
        (baseSave as any).gamePropsTeam = gamePropsTeam;
      }
      
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(baseSave));
        
        // Check if we're loading from URL params (has 'player' but not 'pid')
        // If so, don't update URL immediately to prevent double reload
        const currentUrl = new URL(window.location.href);
        const hasPlayerParam = currentUrl.searchParams.has('player');
        const hasPidParam = currentUrl.searchParams.has('pid');
        const isLoadingFromUrl = hasPlayerParam && !hasPidParam;
        
        // Update URL for share/save (but skip if we're still loading from URL params)
        if (!isLoadingFromUrl) {
          const url = new URL(window.location.href);
          url.searchParams.set('mode', propsMode);
          
          if (selectedPlayer && selectedTeam && propsMode === 'player') {
            const r = baseSave.player as BdlSearchResult;
            url.searchParams.set('pid', String(r.id));
            url.searchParams.set('name', r.full);
            url.searchParams.set('team', selectedTeam);
            // Remove 'player' param if it exists (we now have pid/name/team)
            url.searchParams.delete('player');
          } else {
            // Remove player-specific params when not in player mode
            url.searchParams.delete('pid');
            url.searchParams.delete('name');
            url.searchParams.delete('team');
            url.searchParams.delete('player');
          }
          
          url.searchParams.set('stat', selectedStat);
          url.searchParams.set('tf', selectedTimeframe);
          window.history.replaceState({}, '', url.toString());
        }
      }
    } catch {}
  }, [selectedPlayer, selectedTeam, selectedStat, selectedTimeframe, resolvedPlayerId, propsMode, gamePropsTeam]);

  // Fetch game stats for a player
  const fetchSortedStats = async (playerId: string) => {
    return await fetchSortedStatsCore(playerId, selectedTimeframe);
  };
  
  // Track current fetch to prevent race conditions
  const advancedStatsFetchRef = useRef<string | null>(null);
  const shotDistanceFetchRef = useRef<string | null>(null);
  
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
  
  // Fetch advanced stats for a player
  const fetchAdvancedStats = async (playerId: string) => {
    // Don't attempt to fetch if user doesn't have premium - just silently return
    // The UI will already be gated by checkFeatureAccess elsewhere
    if (!hasPremium) {
      setAdvancedStats(null);
      setAdvancedStatsLoading(false);
      return;
    }
    
    // Mark this fetch as the current one
    advancedStatsFetchRef.current = playerId;
    
    // Check if we already have cached data - if so, don't clear it (preserve on refresh)
    const hasCachedData = typeof window !== 'undefined' && sessionStorage.getItem(`advanced_stats_${playerId}`);
    
    // Only clear if we don't have cached data (to preserve restored stats on refresh)
    if (!hasCachedData) {
      setAdvancedStats(null);
    }
    setAdvancedStatsLoading(true);
    setAdvancedStatsError(null);
    
    try {
      const stats = await fetchAdvancedStatsCore(playerId);
      
      // Only update if this is still the current fetch (prevent race conditions)
      if (advancedStatsFetchRef.current === playerId) {
        if (stats) {
          setAdvancedStats(stats);
          // Save to sessionStorage for persistence across refreshes
          if (typeof window !== 'undefined') {
            try {
              const storageKey = `advanced_stats_${playerId}`;
              sessionStorage.setItem(storageKey, JSON.stringify(stats));
            } catch (e) {
              // Ignore storage errors
            }
          }
        } else {
          setAdvancedStats(null);
          setAdvancedStatsError('No advanced stats found for this player');
        }
      }
    } catch (error: any) {
      // Only update if this is still the current fetch
      if (advancedStatsFetchRef.current === playerId) {
        setAdvancedStatsError(error.message || 'Failed to fetch advanced stats');
        setAdvancedStats(null);
      }
    } finally {
      // Only update loading state if this is still the current fetch
      if (advancedStatsFetchRef.current === playerId) {
        setAdvancedStatsLoading(false);
      }
    }
  };
  
  // Fetch shot distance stats for a player
  const fetchShotDistanceStats = async (playerId: string) => {
    // Don't attempt to fetch if user doesn't have premium - just silently return
    // The UI will already be gated by checkFeatureAccess elsewhere
    if (!hasPremium) {
      setShotDistanceData(null);
      setShotDistanceLoading(false);
      return;
    }
    
    // Mark this fetch as the current one
    shotDistanceFetchRef.current = playerId;
    
    // Check if we already have cached data - if so, don't clear it (preserve on refresh)
    const hasCachedData = typeof window !== 'undefined' && sessionStorage.getItem(`shot_distance_${playerId}`);
    
    // Only clear if we don't have cached data (to preserve restored stats on refresh)
    if (!hasCachedData) {
      setShotDistanceData(null);
    }
    setShotDistanceLoading(true);
    
    try {
      const shotData = await fetchShotDistanceStatsCore(playerId);
      
      // Only update if this is still the current fetch (prevent race conditions)
      if (shotDistanceFetchRef.current === playerId) {
        if (shotData) {
          setShotDistanceData(shotData);
          // Save to sessionStorage for persistence across refreshes
          if (typeof window !== 'undefined') {
            try {
              const storageKey = `shot_distance_${playerId}`;
              sessionStorage.setItem(storageKey, JSON.stringify(shotData));
            } catch (e) {
              // Ignore storage errors
            }
          }
        } else {
          setShotDistanceData(null);
        }
      }
    } catch (error) {
      // Only update if this is still the current fetch
      if (shotDistanceFetchRef.current === playerId) {
        console.error('Failed to fetch shot distance stats:', error);
        setShotDistanceData(null);
      }
    } finally {
      // Only update loading state if this is still the current fetch
      if (shotDistanceFetchRef.current === playerId) {
        setShotDistanceLoading(false);
      }
    }
  };

  // Select from your local SAMPLE_PLAYERS (default) - but use API for team data
  const handlePlayerSelectFromLocal = async (player: NBAPlayer) => {
    setIsLoading(true); setApiError(null);
    
    // Clear premium stats immediately when switching players
    setAdvancedStats(null);
    setShotDistanceData(null);
    setAdvancedStatsLoading(false);
    setShotDistanceLoading(false);
    
    // Clear all odds data when switching players
    setRealOddsData([]);
    setOddsSnapshots([]);
    setLineMovementData(null);
    setOddsLoading(false);
    setOddsError(null);
    
    // Clear opponent team when switching players to force re-detection
    console.log(`[Player Select] Clearing opponent team for player switch to: ${player.full}`);
    setOpponentTeam('N/A');
    
    try {
      const pid = /^\d+$/.test(String(player.id)) ? String(player.id) : await resolvePlayerId(player.full, player.teamAbbr);
      if (!pid) throw new Error(`Couldn't resolve player id for "${player.full}"`);
      setResolvedPlayerId(pid);
      
      // Restore cached stats from sessionStorage if available
      if (typeof window !== 'undefined' && hasPremium) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${pid}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
          }
          
          const cachedShotData = sessionStorage.getItem(`shot_distance_${pid}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
          }
        } catch (e) {
          // Ignore storage errors, will fetch fresh data
        }
      }
      
      // OPTIMIZATION: Progressive loading for faster initial render
      // 1. Fetch critical path data first (stats) - show UI immediately
      // 2. Load non-critical data (BDL/ESPN metadata) in background
      // 3. Load premium features (advanced stats, shot distance) in background
      
      // Fetch stats first (critical - needed for chart)
      const rows = await fetchSortedStats(pid);
      
      // Use sample data team directly for default players - NO GAME DATA FALLBACK
      const currentTeam = normalizeAbbr(player.teamAbbr);
      
      // Set player stats immediately so UI can render (with basic player info)
      startTransition(() => {
        setSelectedTimeframe('last10');
        setPlayerStats(rows);
        setSelectedTeam(currentTeam);
        setOriginalPlayerTeam(currentTeam);
        setDepthChartTeam(currentTeam);
        setSelectedPlayer(player); // Set basic player first, will update with jersey/height later
      });
      
      // Load non-critical metadata in background (doesn't block UI)
      Promise.all([
        fetchBdlPlayerData(pid),
        fetchEspnPlayerData(player.full, player.teamAbbr).catch(() => null)
      ]).then(([bdlPlayerData, espnData]) => {
        // Parse BDL height data and merge with sample player data
        const heightData = parseBdlHeight(bdlPlayerData?.height);
        
        // Get jersey and height from BDL, with fallbacks to player object
        const bdlJersey = bdlPlayerData?.jersey_number;
        const bdlJerseyNum = (bdlJersey && bdlJersey !== '' && bdlJersey !== 'null' && bdlJersey !== '0') 
          ? Number(bdlJersey) 
          : 0;
        let jerseyNumber = bdlJerseyNum > 0 ? bdlJerseyNum : (player.jersey || 0);
        let heightFeetData: number | undefined = heightData.feet || player.heightFeet || undefined;
        let heightInchesData: number | undefined = heightData.inches || player.heightInches || undefined;
        
        // Fallback to depth chart roster for jersey if still missing
        if (!jerseyNumber && playerTeamRoster) {
          const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
          for (const pos of positions) {
            const posPlayers = playerTeamRoster[pos];
            if (Array.isArray(posPlayers)) {
              const found = posPlayers.find(p => 
                p.name && player.full && 
                (p.name.toLowerCase().includes(player.full.toLowerCase()) || 
                 player.full.toLowerCase().includes(p.name.toLowerCase()))
              );
              if (found && found.jersey && found.jersey !== 'N/A') {
                jerseyNumber = Number(found.jersey);
                break;
              }
            }
          }
        }
        
        // Update player with jersey/height metadata (non-blocking update)
        startTransition(() => {
          setSelectedPlayer({
            ...player,
            jersey: jerseyNumber,
            heightFeet: heightFeetData || undefined,
            heightInches: heightInchesData || undefined,
          });
        });
      }).catch(err => {
        console.warn('Failed to load player metadata (non-critical):', err);
      });
      
      // Start premium fetches in background (don't await)
      if (hasPremium) {
        fetchAdvancedStats(pid).catch(err => console.error('Advanced stats error:', err));
        fetchShotDistanceStats(pid).catch(err => console.error('Shot distance error:', err));
      }
      
      // Debug: log what we're setting as playerStats
      console.log('[Dashboard] Setting playerStats:', {
        playerId: pid,
        playerName: player.full,
        rowsCount: rows.length,
        sampleRow: rows[0],
        hasGame: !!rows[0]?.game,
        hasGameDate: !!rows[0]?.game?.date,
        hasTeam: !!rows[0]?.team,
        hasTeamAbbr: !!rows[0]?.team?.abbreviation,
        sampleRowKeys: rows[0] ? Object.keys(rows[0]) : [],
      });
      
      // Batch remaining state updates in startTransition
      startTransition(() => {
        // Reset betting-line auto-set trackers so odds can re-apply for the new player
        lastAutoSetStatRef.current = null;
        lastAutoSetLineRef.current = null;
        hasManuallySetLineRef.current = false;
        
        // Reset betting lines in transition to prevent visible refresh
        // BUT preserve the line from URL if it exists (important for steals/blocks)
        setBettingLines(prev => {
          // Check URL for line parameter
          if (typeof window !== 'undefined') {
            try {
              const url = new URL(window.location.href);
              const urlLine = url.searchParams.get('line');
              const urlStat = url.searchParams.get('stat');
              if (urlLine && urlStat) {
                const lineValue = parseFloat(urlLine);
                const normalizedStat = urlStat.toLowerCase();
                if (!isNaN(lineValue) && normalizedStat) {
                  // Preserve the URL line for the URL stat
                  return { [normalizedStat]: Math.abs(lineValue) };
                }
              }
            } catch {}
          }
          // Also check if current stat has a line that was set from URL
          const currentStatLine = prev[selectedStat];
          if (currentStatLine !== undefined && statFromUrlRef.current) {
            return { [selectedStat]: currentStatLine };
          }
          return {};
        });
      });
      // Update URL to reflect the change
      if (typeof window !== 'undefined') {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('tf', 'last10');
        window.history.replaceState({}, '', newUrl.toString());
      }
      
      // Set opponent immediately if games are already loaded, otherwise useEffect will handle it
      if (todaysGames.length > 0) {
        const opponent = getOpponentTeam(currentTeam, todaysGames);
        const normalizedOpponent = normalizeAbbr(opponent);
        console.log(`[Player Select] Setting opponent for ${currentTeam}: ${normalizedOpponent} (games already loaded)`);
        setOpponentTeam(normalizedOpponent);
      } else {
        console.log(`[Player Select] Team set to ${currentTeam}, opponent will be set when games load`);
      }
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
    } catch (e: any) {
      setApiError(e?.message || "Failed to load stats."); setPlayerStats([]);
      setOpponentTeam('');
    } finally { setIsLoading(false); }
  };

  // Select from live search results
  const handlePlayerSelectFromSearch = async (r: BdlSearchResult) => {
    // Prevent duplicate calls
    if (isHandlingPlayerSelectRef.current) {
      console.log('ðŸ” [handlePlayerSelectFromSearch] Already handling, skipping duplicate call');
      return;
    }
    
    isHandlingPlayerSelectRef.current = true;
    
    try {
      const callData = {
        player: r.full,
        id: r.id,
        team: r.team,
        pos: r.pos,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      };
      console.log('ðŸ” [handlePlayerSelectFromSearch] Called with:', callData);
      serverLogger.log('ðŸ” [handlePlayerSelectFromSearch] Called with', { data: callData });
      // Only set loading if not already loading (prevents double render when called from URL params)
      if (!isLoading) {
        console.log('ðŸ” [handlePlayerSelectFromSearch] Setting isLoading=true');
        setIsLoading(true);
      } else {
        console.log('ðŸ” [handlePlayerSelectFromSearch] Already loading, skipping setIsLoading');
      }
      setApiError(null);
    
    // Clear premium stats immediately when switching players
    setAdvancedStats(null);
    setShotDistanceData(null);
    setAdvancedStatsLoading(false);
    setShotDistanceLoading(false);
    
    // Clear all odds data when switching players
    setRealOddsData([]);
    setOddsSnapshots([]);
    setLineMovementData(null);
    setOddsLoading(false);
    setOddsError(null);
    
    try {
      const pid = String(r.id);
      setResolvedPlayerId(pid);
      
      // Restore cached stats from sessionStorage if available
      if (typeof window !== 'undefined' && hasPremium) {
        try {
          const cachedAdvancedStats = sessionStorage.getItem(`advanced_stats_${pid}`);
          if (cachedAdvancedStats) {
            const stats = JSON.parse(cachedAdvancedStats);
            setAdvancedStats(stats);
          }
          
          const cachedShotData = sessionStorage.getItem(`shot_distance_${pid}`);
          if (cachedShotData) {
            const shotData = JSON.parse(cachedShotData);
            setShotDistanceData(shotData);
          }
        } catch (e) {
          // Ignore storage errors, will fetch fresh data
        }
      }
      // Create player object from search result
      const tempPlayer = {
        id: pid,
        full: r.full,
        firstName: r.full.split(' ')[0] || r.full,
        lastName: r.full.split(' ').slice(1).join(' ') || '',
        teamAbbr: '', // Will be determined from API game data
        jersey: '',
        heightFeet: null,
        heightInches: null,
        position: r.pos || '',
      } as any;
      
      // OPTIMIZATION: Fetch both current season and last season stats in parallel
      // This prevents multiple refreshes and ensures all data is available at once
      // fetchSortedStatsCore handles parallel fetching for both seasons
      console.log('ðŸ” [handlePlayerSelectFromSearch] Starting stats fetch (both seasons in parallel):', { pid, name: r.full });
      serverLogger.log('ðŸ” [handlePlayerSelectFromSearch] Starting stats fetch', { data: { pid, name: r.full } });
      
      // Fetch both seasons in parallel - prevents multiple refreshes
      const rows = await fetchSortedStats(pid).catch(err => {
        console.error('âŒ [handlePlayerSelectFromSearch] fetchSortedStats failed:', err);
        return [];
      });
      
      // Start BDL and ESPN fetches in background (don't await - they'll update state when ready)
      const bdlPromise = fetchBdlPlayerData(pid).catch(err => {
        console.error('âŒ [handlePlayerSelectFromSearch] fetchBdlPlayerData failed:', err);
        return null;
      });
      
      const espnPromise = fetchEspnPlayerData(r.full, r.team).catch(err => {
        console.warn('âš ï¸ [handlePlayerSelectFromSearch] fetchEspnPlayerData failed (non-critical):', err);
        return null;
      });
      
      // Process BDL/ESPN data when ready (non-blocking)
      Promise.all([bdlPromise, espnPromise]).then(([bdlPlayerData, espnData]) => {
        // Update player with jersey/height data when available
        if (bdlPlayerData || espnData) {
          const heightData = parseBdlHeight(bdlPlayerData?.height);
          const bdlJersey = bdlPlayerData?.jersey_number;
          const bdlJerseyNum = (bdlJersey && bdlJersey !== '' && bdlJersey !== 'null' && bdlJersey !== '0') 
            ? Number(bdlJersey) 
            : 0;
          let jerseyNumber = bdlJerseyNum > 0 ? bdlJerseyNum : 0;
          let heightFeetData: number | undefined = heightData.feet;
          let heightInchesData: number | undefined = heightData.inches;
          
          // Use ESPN as fallback
          if (espnData) {
            if (!jerseyNumber && espnData.jersey) {
              jerseyNumber = Number(espnData.jersey);
            }
            if (!heightFeetData && espnData.height) {
              const espnHeightData = parseEspnHeight(espnData.height);
              if (espnHeightData.feet) {
                heightFeetData = espnHeightData.feet;
                heightInchesData = espnHeightData.inches;
              }
            }
          }
          
          // Update player with new data if we got any
          if (jerseyNumber || heightFeetData) {
            setSelectedPlayer(prev => {
              if (!prev) return prev; // Return null if no previous player
              const currentJersey = typeof prev.jersey === 'number' ? prev.jersey : (typeof prev.jersey === 'string' ? Number(prev.jersey) || 0 : 0);
              return {
                ...prev,
                jersey: jerseyNumber || currentJersey,
                heightFeet: heightFeetData ?? prev.heightFeet ?? undefined,
                heightInches: heightInchesData ?? prev.heightInches ?? undefined,
              };
            });
          }
        }
      }).catch(err => {
        console.warn('âš ï¸ [handlePlayerSelectFromSearch] Error processing BDL/ESPN data:', err);
      });
      
      // Log stats completion
      console.log('ðŸ” [handlePlayerSelectFromSearch] Stats fetch completed:', { statsCount: rows.length });
      serverLogger.log('ðŸ” [handlePlayerSelectFromSearch] Stats fetch completed', { data: { statsCount: rows.length } });
      
      // Start premium fetches in background (don't await)
      if (hasPremium) {
        // Fire and forget - these will update state when ready
        fetchAdvancedStats(pid).catch(err => console.error('Advanced stats error:', err));
        fetchShotDistanceStats(pid).catch(err => console.error('Shot distance error:', err));
      }
      
      // Batch critical state updates together to prevent multiple re-renders
      // Use startTransition for non-urgent updates to keep UI responsive
      // Use the team from search API directly - NO FALLBACK TO GAME DATA
      const currentTeam = normalizeAbbr(r.team || '');
      
      // Get position from search result
      let playerPosition = r.pos || tempPlayer.position || '';
      
      // Try to get jersey/height from sample players or depth chart (synchronous sources)
      let jerseyNumber = 0;
      let heightFeetData: number | undefined = undefined;
      let heightInchesData: number | undefined = undefined;
      
      // Fallback to sample players data if available
      const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const searchName = normalizeName(r.full);
      const samplePlayer = SAMPLE_PLAYERS.find(p => {
        const playerName = normalizeName(p.full);
        return playerName === searchName || 
               playerName.includes(searchName) || 
               searchName.includes(playerName) ||
               (p.firstName && normalizeName(p.firstName + p.lastName) === searchName) ||
               (p.lastName && normalizeName(p.lastName) === normalizeName(r.full.split(' ').pop() || ''));
      });
      if (samplePlayer) {
        if (samplePlayer.jersey) {
          jerseyNumber = samplePlayer.jersey;
          console.log(`âœ… Found jersey #${jerseyNumber} from sample data for ${r.full}`);
        }
        if (samplePlayer.heightFeet) {
          heightFeetData = samplePlayer.heightFeet;
          heightInchesData = samplePlayer.heightInches;
          console.log(`âœ… Found height ${heightFeetData}'${heightInchesData}" from sample data for ${r.full}`);
        }
      }
      
      // Fallback to depth chart roster for jersey and position if still missing
      if (playerTeamRoster) {
        const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
        for (const pos of positions) {
          const posPlayers = playerTeamRoster[pos];
          if (Array.isArray(posPlayers)) {
            const found = posPlayers.find(p => 
              p.name && r.full && 
              (p.name.toLowerCase().includes(r.full.toLowerCase()) || 
               r.full.toLowerCase().includes(p.name.toLowerCase()))
            );
            if (found) {
              if (!jerseyNumber && found.jersey && found.jersey !== 'N/A') {
                jerseyNumber = Number(found.jersey);
                console.log(`âœ… Found jersey #${jerseyNumber} from depth chart for ${r.full}`);
              }
              if (!playerPosition) {
                playerPosition = pos;
                console.log(`âœ… Found position ${playerPosition} from depth chart for ${r.full}`);
              }
              break;
            }
          }
        }
      }
      
      // Batch all state updates together in startTransition to prevent multiple re-renders
      // Set selectedTimeframe FIRST so it's correct when playerStats updates (prevents double baseGameData recalculation)
      console.log('[DEBUG handlePlayerSelectFromSearch] About to batch state updates', {
        rowsCount: rows.length,
        currentTeam,
        timestamp: new Date().toISOString()
      });
      
      startTransition(() => {
        // ALWAYS set timeframe to "last10" when selecting a new player (override URL if needed)
        // Set this FIRST so baseGameData calculates correctly when playerStats updates
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting timeframe to "last10"`);
        setSelectedTimeframe('last10');
        
        // Then set playerStats - this will trigger baseGameData recalculation with correct timeframe
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting playerStats (${rows.length} rows)`);
        setPlayerStats(rows);
        
        console.log(`[DEBUG handlePlayerSelectFromSearch] Setting teams and player`);
        setSelectedTeam(currentTeam);
        setOriginalPlayerTeam(currentTeam);
        setDepthChartTeam(currentTeam);
        
        // Update player with available data (jersey/height from BDL/ESPN will update later)
        setSelectedPlayer({
          ...tempPlayer,
          teamAbbr: currentTeam,
          jersey: jerseyNumber || '',
          heightFeet: heightFeetData || null,
          heightInches: heightInchesData || null,
          position: playerPosition || undefined,
        });

        // Reset betting-line auto-set trackers so odds can re-apply for the new player
        lastAutoSetStatRef.current = null;
        lastAutoSetLineRef.current = null;
        hasManuallySetLineRef.current = false;
        
        // Reset betting lines in transition to prevent visible refresh
        // BUT preserve the line from URL if it exists (important for steals/blocks)
        console.log(`[DEBUG handlePlayerSelectFromSearch] Resetting bettingLines`);
        setBettingLines(prev => {
          // Check URL for line parameter
          if (typeof window !== 'undefined') {
            try {
              const url = new URL(window.location.href);
              const urlLine = url.searchParams.get('line');
              const urlStat = url.searchParams.get('stat');
              if (urlLine && urlStat) {
                const lineValue = parseFloat(urlLine);
                const normalizedStat = urlStat.toLowerCase();
                if (!isNaN(lineValue) && normalizedStat) {
                  // Preserve the URL line for the URL stat
                  return { [normalizedStat]: Math.abs(lineValue) };
                }
              }
            } catch {}
          }
          // Also check if current stat has a line that was set from URL
          const currentStatLine = prev[selectedStat];
          if (currentStatLine !== undefined && statFromUrlRef.current) {
            return { [selectedStat]: currentStatLine };
          }
          return {};
        });
        
        console.log(`[DEBUG handlePlayerSelectFromSearch] All state updates batched in startTransition`);
      });
      
      // Update URL to reflect the timeframe change (outside transition, doesn't affect rendering)
      if (typeof window !== 'undefined') {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('tf', 'last10');
        window.history.replaceState({}, '', newUrl.toString());
      }
      
      // Set opponent immediately if games are already loaded, otherwise useEffect will handle it
      if (todaysGames.length > 0) {
        const opponent = getOpponentTeam(currentTeam, todaysGames);
        const normalizedOpponent = normalizeAbbr(opponent);
        console.log(`[Player Select] Setting opponent for ${currentTeam}: ${normalizedOpponent} (games already loaded)`);
        setOpponentTeam(normalizedOpponent);
      } else {
        console.log(`[Player Select] Team set to ${currentTeam}, opponent will be set when games load`);
      }
      
      if (!rows.length) setApiError("No games found for current/previous season for this player.");
      console.log('âœ… handlePlayerSelectFromSearch completed successfully');
    } catch (e: any) {
      console.error('âŒ handlePlayerSelectFromSearch error:', e);
      setApiError(e?.message || "Failed to load stats."); 
      setPlayerStats([]);
      setOpponentTeam('N/A');
    }
    } finally {
      isHandlingPlayerSelectRef.current = false;
      setIsLoading(false);
      setShowDropdown(false);
      setSearchQuery('');
      setSearchResults([]);
    }
  };

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

  // Calculate predicted pace from betting total line
  useEffect(() => {
    if (!realOddsData || realOddsData.length === 0 || !selectedTeam || selectedTeam === 'N/A' || !opponentTeam || opponentTeam === 'N/A' || propsMode !== 'player') {
      setPredictedPace(null);
      return;
    }

    // Find Total line from odds data
    let totalLine: number | null = null;
    for (const book of realOddsData) {
      const totalData = (book as any)?.Total;
      if (totalData && totalData.line && totalData.line !== 'N/A') {
        const lineValue = parseFloat(totalData.line);
        if (!isNaN(lineValue) && lineValue > 0) {
          // Use the first valid total line found (or could average them)
          totalLine = lineValue;
          break;
        }
      }
    }

    if (totalLine === null) {
      setPredictedPace(null);
      return;
    }

    // Convert total points to predicted pace
    // Formula: Pace â‰ˆ Total / (2 * avg_points_per_possession)
    // Average NBA points per possession is ~1.12
    // So: Pace â‰ˆ Total / 2.24
    // We'll use a more accurate formula based on historical data
    // Typical range: Total 200-240, Pace 95-105
    // Linear relationship: Pace = (Total - 200) * (10/40) + 95 = (Total - 200) * 0.25 + 95
    // Or more accurate: Pace = Total / 2.2 (simpler)
    const calculatedPace = totalLine / 2.2;
    
    // Clamp to reasonable NBA pace range (90-110)
    const clampedPace = Math.max(90, Math.min(110, calculatedPace));
    
    console.log('[Dashboard] Calculated predicted pace from total:', { totalLine, calculatedPace, clampedPace });
    setPredictedPace(clampedPace);
  }, [realOddsData, selectedTeam, opponentTeam, propsMode]);

  // Calculate season averages (FG%, minutes, game pace) from playerStats
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
  }, [playerStats, propsMode]);


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

  // Set initial slider range when filter is selected
  useEffect(() => {
    if (selectedFilterForAxis && sliderConfig && sliderRange === null) {
      // Initialize with full range
      setSliderRange({ min: sliderConfig.min, max: sliderConfig.max });
    }
  }, [selectedFilterForAxis, sliderConfig, sliderRange]);

  // Prefetch advanced stats (pace, usage_rate) in background when player stats are available
  // This runs independently of filter selection to ensure usage rate is always available
  useEffect(() => {
    if (propsMode !== 'player' || !playerStats || playerStats.length === 0) {
      return;
    }

    // Get player ID
    const playerIdRaw = selectedPlayer?.id;
    if (!playerIdRaw) {
      return;
    }
    const playerId = typeof playerIdRaw === 'number' ? playerIdRaw : Number(playerIdRaw);
    if (isNaN(playerId)) {
      return;
    }

    // Clear prefetch ref when player changes to ensure fresh fetch
    const currentPlayerKey = `player_${playerId}`;
    if (!advancedStatsPrefetchRef.current.has(currentPlayerKey)) {
      // New player - clear old prefetch keys
      advancedStatsPrefetchRef.current.clear();
      advancedStatsPrefetchRef.current.add(currentPlayerKey);
    }

    // Extract game IDs from playerStats - include ALL games (don't filter by minutes)
    // This ensures we get usage rate for all games, matching what the chart would show
    const gameIds: number[] = [];
    const seenGameIds = new Set<number>();
    playerStats.forEach((stat: any) => {
      const gameId = stat.game?.id;
      if (gameId && typeof gameId === 'number' && !seenGameIds.has(gameId)) {
        gameIds.push(gameId);
        seenGameIds.add(gameId);
      }
    });

    if (gameIds.length === 0) {
      return;
    }

    // Prefetch in background (don't block UI)
    // Use a ref to track if we've already started prefetching for these game IDs
    const prefetchKey = `advanced_${playerId}_${gameIds.sort().join(',')}`;
    
    if (advancedStatsPrefetchRef.current.has(prefetchKey)) {
      // Already prefetching or prefetched for these games
      console.log('[Usage Rate Prefetch] Already prefetching/prefetched for player', playerId);
      return;
    }

    // Check if we already have prefetched data for all these games
    const missingGameIds = gameIds.filter(id => prefetchedAdvancedStats[id] === undefined);
    if (missingGameIds.length === 0 && gameIds.length > 0) {
      // Already prefetched all games, mark as done
      advancedStatsPrefetchRef.current.add(prefetchKey);
      console.log('[Usage Rate Prefetch] Already have all prefetched data for', gameIds.length, 'games');
      return;
    }
    
    // If we have some but not all, still fetch (will merge with existing)
    if (missingGameIds.length < gameIds.length) {
      console.log('[Usage Rate Prefetch] Have', gameIds.length - missingGameIds.length, 'games, fetching', missingGameIds.length, 'missing');
    }

    // Mark as prefetching
    advancedStatsPrefetchRef.current.add(prefetchKey);
    console.log('[Usage Rate Prefetch] Starting prefetch for player', playerId, 'with', gameIds.length, 'games');
    
    let isMounted = true;
    const prefetchAdvancedStats = async () => {
      try {
        const stats = await BallDontLieAPI.getAdvancedStatsByGames(gameIds, playerId);
        
        if (!isMounted) return;
        
        // Map stats by game ID
        const statsByGame: Record<number, { pace?: number; usage_percentage?: number }> = {};
        stats.forEach((stat: any) => {
          const gameId = stat.game?.id;
          if (gameId && typeof gameId === 'number') {
            statsByGame[gameId] = {
              pace: stat.pace ?? undefined,
              usage_percentage: stat.usage_percentage ?? undefined,
            };
          }
        });
        
        console.log('[Usage Rate Prefetch] Fetched', Object.keys(statsByGame).length, 'games with usage rate data');
        setPrefetchedAdvancedStats(prev => ({ ...prev, ...statsByGame }));
      } catch (error) {
        console.error('[Prefetch] Error prefetching advanced stats:', error);
      }
    };

    prefetchAdvancedStats();
    
    return () => {
      isMounted = false;
    };
  }, [playerStats, propsMode, selectedPlayer?.id]);

  // Use prefetched advanced stats when pace or usage_rate is selected (for chart filtering)
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player') {
      setAdvancedStatsPerGame({});
      return;
    }

    // Only use prefetched data if pace or usage_rate is selected
    if (selectedFilterForAxis === 'pace' || selectedFilterForAxis === 'usage_rate') {
      // Use prefetched data immediately
      setAdvancedStatsPerGame(prefetchedAdvancedStats);
    } else {
      setAdvancedStatsPerGame({});
    }
  }, [selectedFilterForAxis, propsMode, prefetchedAdvancedStats]);

  // Legacy fetch (kept for backward compatibility, but should use prefetched data)
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player' || !adjustedChartData.length) {
      return;
    }

    // Only fetch if pace or usage_rate is selected AND we don't have prefetched data
    if (selectedFilterForAxis !== 'pace' && selectedFilterForAxis !== 'usage_rate') {
      return;
    }

    // Check if we already have prefetched data
    const gameIds: number[] = [];
    adjustedChartData.forEach((game: any) => {
      const gameId = game.game?.id || game.stats?.game?.id;
      if (gameId && typeof gameId === 'number') {
        gameIds.push(gameId);
      }
    });

    const hasAllPrefetched = gameIds.length > 0 && gameIds.every(id => prefetchedAdvancedStats[id] !== undefined);
    if (hasAllPrefetched) {
      // Already have prefetched data, skip fetch
      return;
    }

    // Get player ID (convert to number if string)
    const playerIdRaw = selectedPlayer?.id;
    if (!playerIdRaw) {
      return;
    }
    const playerId = typeof playerIdRaw === 'number' ? playerIdRaw : Number(playerIdRaw);
    if (isNaN(playerId)) {
      return;
    }

    if (gameIds.length === 0) {
      return;
    }

    // Fetch advanced stats for all games
    let isMounted = true;
    const fetchAdvancedStats = async () => {
      try {
        const stats = await BallDontLieAPI.getAdvancedStatsByGames(gameIds, playerId);
        
        if (!isMounted) return;
        
        // Map stats by game ID
        const statsByGame: Record<number, { pace?: number; usage_percentage?: number }> = {};
        stats.forEach((stat: any) => {
          const gameId = stat.game?.id;
          if (gameId && typeof gameId === 'number') {
            statsByGame[gameId] = {
              pace: stat.pace ?? undefined,
              usage_percentage: stat.usage_percentage ?? undefined,
            };
          }
        });
        
        // Populate both advancedStatsPerGame (for filter) and prefetchedAdvancedStats (for usage rate calculation)
        setAdvancedStatsPerGame(statsByGame);
        setPrefetchedAdvancedStats(prev => ({ ...prev, ...statsByGame }));
      } catch (error) {
        console.error('[Second Axis] Error fetching advanced stats:', error);
        if (isMounted) {
          setAdvancedStatsPerGame({});
        }
      }
    };

    fetchAdvancedStats();
    
    return () => {
      isMounted = false;
    };
  }, [selectedFilterForAxis, adjustedChartData, propsMode, selectedPlayer?.id]);

  // Prefetch DvP ranks in background for all possible stat/position combinations
  // Use ALL playerStats (not adjustedChartData) to ensure ranks are available for all games
  useEffect(() => {
    if (propsMode !== 'player' || !playerStats.length || !selectedStat) {
      if (propsMode === 'player' && playerStats.length && !selectedPosition) {
        console.log('[DvP Rank Prefetch] Waiting for selectedPosition to be determined...', {
          playerName: selectedPlayer?.full,
          hasPlayerStats: playerStats.length > 0,
          hasRoster: !!playerTeamRoster
        });
      }
      return;
    }
    
    if (!selectedPosition) {
      console.log('[DvP Rank Prefetch] Skipping - selectedPosition is null', {
        playerName: selectedPlayer?.full,
        hasPlayerStats: playerStats.length > 0
      });
      return;
    }

    // Map selected stat to DvP metric
    const statToDvpMetric: Record<string, string> = {
      'pts': 'pts',
      'reb': 'reb',
      'ast': 'ast',
      'fg3m': 'fg3m',
      'stl': 'stl',
      'blk': 'blk',
      'to': 'to',
      'fg_pct': 'fg_pct',
      'pra': 'pra',
      'pr': 'pr',
      'pa': 'pa',
      'ra': 'ra',
    };
    
    const dvpMetric = statToDvpMetric[selectedStat];
    if (!dvpMetric) {
      return;
    }

    // Use a ref to track if we've already started prefetching for this combination
    const prefetchKey = `${selectedPosition}:${dvpMetric}`;
    
    if (dvpRanksPrefetchRef.current.has(prefetchKey)) {
      // Already prefetching or prefetched for this combination
      return;
    }

    // Check if we already have prefetched data
    if (prefetchedDvpRanks[prefetchKey]) {
      // Already prefetched, mark as done
      dvpRanksPrefetchRef.current.add(prefetchKey);
      return;
    }

    // Mark as prefetching
    dvpRanksPrefetchRef.current.add(prefetchKey);
    
    console.log('[DvP Rank Prefetch] Starting prefetch', {
      prefetchKey,
      selectedPosition,
      selectedStat,
      dvpMetric,
      playerStatsCount: playerStats.length,
      playerName: selectedPlayer?.full
    });

    // Prefetch in background (don't block UI)
    let isMounted = true;
    const prefetchDvpRanks = async () => {
      try {
        // Map ranks to game IDs based on opponent team and game date
        // Use ALL playerStats (not adjustedChartData) to ensure ranks are available for all games
        const ranksByGame: Record<string, number | null> = {};
        
        // Build game data from playerStats (all games, not filtered by timeframe)
        const gamesToProcess = playerStats
          .filter((stats: any) => {
            // Only include games where player played (same filter as baseGameData)
            const minutes = parseMinutes(stats.min);
            return minutes > 0;
          })
          .map((stats: any) => {
            // Extract opponent and game info from stats
            let playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
            const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
            const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
            const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
            const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
            
            const playerTeamNorm = normalizeAbbr(playerTeam);
            const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
            let opponent = "";
            
            if (playerTeamId && homeTeamId && visitorTeamId) {
              if (playerTeamId === homeTeamId && visitorTeamAbbr) {
                opponent = visitorTeamAbbr;
              } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
                opponent = homeTeamAbbr;
              }
            }
            if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
              const homeNorm = normalizeAbbr(homeTeamAbbr);
              const awayNorm = normalizeAbbr(visitorTeamAbbr);
              if (playerTeamNorm && playerTeamNorm === homeNorm) opponent = awayNorm;
              else if (playerTeamNorm && playerTeamNorm === awayNorm) opponent = homeNorm;
            }
            
            const numericGameId = typeof stats?.game?.id === 'number' ? stats.game.id : null;
            const gameIdStr = String(numericGameId || '');
            const gameDate = stats?.game?.date || '';
            
            return { gameIdStr, opponent, gameDate, stats };
          });
        
        // Fetch historical ranks for each game
        const rankPromises = gamesToProcess.map(async ({ gameIdStr, opponent, gameDate }) => {
          if (!opponent || opponent === 'N/A' || opponent === 'ALL' || opponent === '') {
            return { gameIdStr, rank: null };
          }
          
          if (!gameDate) {
            return { gameIdStr, rank: null, useCurrent: true };
          }
          
          // Try to fetch historical rank for this game date
          try {
            const dateStr = new Date(gameDate).toISOString().split('T')[0];
            const historicalResponse = await fetch(
              `/api/dvp/rank/historical?date=${dateStr}&pos=${selectedPosition}&metric=${dvpMetric}`
            );
            
            if (historicalResponse.ok) {
              const historicalData = await historicalResponse.json();
              if (historicalData.success && historicalData.ranks) {
                const normalizedOpp = normalizeAbbr(opponent);
                const rank = historicalData.ranks[normalizedOpp] ?? 
                            historicalData.ranks[normalizedOpp.toUpperCase()] ?? null;
                if (rank && rank > 0) {
                  return { gameIdStr, rank };
                }
                // If historical lookup returned empty, fall through to current ranks
              } else {
                console.log(`[Prefetch] Historical API returned no ranks for ${dateStr} ${selectedPosition}:${dvpMetric}`, {
                  success: historicalData.success,
                  hasRanks: !!historicalData.ranks,
                  note: historicalData.note
                });
              }
            } else {
              console.warn(`[Prefetch] Historical API error for ${dateStr}: ${historicalResponse.status}`);
            }
          } catch (historicalError) {
            console.warn(`[Prefetch] Historical fetch failed for ${gameIdStr}:`, historicalError);
          }
          
          return { gameIdStr, rank: null, useCurrent: true };
        });
        
        const rankResults = await Promise.all(rankPromises);
        
        // Check if we need to fetch current ranks for any games
        // Also check if historical lookups returned any valid ranks
        const needsCurrentRanks = rankResults.some(r => r.useCurrent);
        const hasHistoricalRanks = rankResults.some(r => r.rank !== null);
        let currentRanks: Record<string, number> = {};
        
        // If no historical ranks were found, fetch current ranks for all games as fallback
        const shouldFetchCurrent = needsCurrentRanks || !hasHistoricalRanks;
        
        if (shouldFetchCurrent) {
          try {
            const currentResponse = await fetch(`/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${dvpMetric}&games=82`);
            if (currentResponse.ok) {
              const currentData = await currentResponse.json();
              currentRanks = currentData.metrics?.[dvpMetric] || {};
              console.log(`[Prefetch] Fetched current ranks for ${selectedPosition}:${dvpMetric}:`, {
                rankCount: Object.keys(currentRanks).length,
                sampleTeams: Object.keys(currentRanks).slice(0, 5),
                reason: !hasHistoricalRanks ? 'No historical ranks found, using current as fallback' : 'Some games need current ranks'
              });
            } else {
              console.warn(`[Prefetch] Current ranks API error: ${currentResponse.status}`);
            }
          } catch (error) {
            console.error(`[Prefetch] Failed to fetch current ranks:`, error);
          }
        }
        
        if (!isMounted) return;
        
        // Map ranks to games
        rankResults.forEach((result, index) => {
          if (result.rank !== null) {
            ranksByGame[result.gameIdStr] = result.rank;
              } else {
            // Try to use current ranks as fallback
            const gameData = gamesToProcess[index];
            if (gameData && gameData.opponent && gameData.opponent !== 'N/A' && gameData.opponent !== 'ALL' && gameData.opponent !== '') {
              const normalizedOpp = normalizeAbbr(gameData.opponent);
              // Try multiple variations of the team abbreviation
              let rank = currentRanks[normalizedOpp] ?? 
                        currentRanks[normalizedOpp.toUpperCase()] ?? 
                        currentRanks[normalizedOpp.toLowerCase()] ?? null;
              
              // If still not found, try to find a partial match
              if (rank === null || rank === undefined) {
                const matchingKey = Object.keys(currentRanks).find(key => 
                  key.toUpperCase() === normalizedOpp.toUpperCase() ||
                  normalizedOpp.toUpperCase().includes(key.toUpperCase()) ||
                  key.toUpperCase().includes(normalizedOpp.toUpperCase())
                );
                if (matchingKey) {
                  rank = currentRanks[matchingKey];
                }
              }
              
              ranksByGame[result.gameIdStr] = typeof rank === 'number' && rank > 0 ? rank : null;
          } else {
            ranksByGame[result.gameIdStr] = null;
            }
          }
        });
        
        // Store prefetched data
        const ranksWithValues = Object.entries(ranksByGame).filter(([_, rank]) => rank !== null && rank !== undefined);
        const sampleRanksWithValues = ranksWithValues.slice(0, 5);
        const sampleRanksNull = Object.entries(ranksByGame).filter(([_, rank]) => rank === null).slice(0, 5);
        
        console.log(`[DvP Rank Prefetch] Stored ranks for ${prefetchKey}:`, {
          gameCount: Object.keys(ranksByGame).length,
          ranksWithValues: ranksWithValues.length,
          sampleRanksWithValues,
          sampleRanksNull,
          sampleGameIds: Object.keys(ranksByGame).slice(0, 10)
        });
        setPrefetchedDvpRanks(prev => ({
          ...prev,
          [prefetchKey]: ranksByGame,
        }));
      } catch (error) {
        // Silent fail for prefetch
        console.error('[Prefetch] Error prefetching DvP ranks:', error);
      }
    };

    prefetchDvpRanks();
    
    return () => {
      isMounted = false;
    };
  }, [playerStats, propsMode, selectedPosition, selectedStat, selectedPlayer]);

  // Use prefetched DvP ranks when dvp_rank filter is selected
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player') {
      setDvpRanksPerGame({});
      return;
    }

    if (selectedFilterForAxis === 'dvp_rank') {
      // Need player position and selected stat to get the right prefetched data
      if (!selectedPosition || !selectedStat) {
        console.log('[DvP Rank] Cannot use ranks - missing data:', {
          hasPosition: !!selectedPosition,
          hasStat: !!selectedStat,
          selectedPosition,
          selectedStat,
          playerName: selectedPlayer?.full
        });
        setDvpRanksPerGame({});
        return;
      }

      const statToDvpMetric: Record<string, string> = {
        'pts': 'pts',
        'reb': 'reb',
        'ast': 'ast',
        'fg3m': 'fg3m',
        'stl': 'stl',
        'blk': 'blk',
        'to': 'to',
        'fg_pct': 'fg_pct',
        'pra': 'pra',
        'pr': 'pr',
        'pa': 'pa',
        'ra': 'ra',
      };
      
      const dvpMetric = statToDvpMetric[selectedStat];
      if (!dvpMetric) {
        setDvpRanksPerGame({});
        return;
      }

      const prefetchKey = `${selectedPosition}:${dvpMetric}`;
      const prefetched = prefetchedDvpRanks[prefetchKey];
      
      if (prefetched) {
        // Use prefetched data immediately
        console.log(`[DvP Rank] Using prefetched data for ${prefetchKey}:`, {
          gameCount: Object.keys(prefetched).length,
          sampleRanks: Object.entries(prefetched).slice(0, 5),
          sampleGameIds: Object.keys(prefetched).slice(0, 5),
          ranksWithValues: Object.entries(prefetched).filter(([_, rank]) => rank !== null && rank !== undefined).length
        });
        setDvpRanksPerGame(prefetched);
      } else {
        // Fallback to empty (will trigger legacy fetch if needed)
        console.log(`[DvP Rank] No prefetched data for ${prefetchKey}, waiting for prefetch...`, {
          availableKeys: Object.keys(prefetchedDvpRanks),
          selectedPosition,
          dvpMetric,
          prefetchKey
        });
        setDvpRanksPerGame({});
      }
    } else {
      setDvpRanksPerGame({});
    }
  }, [selectedFilterForAxis, propsMode, selectedPosition, selectedStat, prefetchedDvpRanks]);

  // Legacy fetch DvP ranks (kept for backward compatibility, but should use prefetched data)
  // Use filteredChartData to match what's actually displayed
  useEffect(() => {
    if (selectedFilterForAxis !== 'dvp_rank' || propsMode !== 'player' || !filteredChartData.length) {
      return;
    }

    // Need player position and selected stat to fetch DvP ranks
    if (!selectedPosition || !selectedStat) {
      return;
    }

    // Map selected stat to DvP metric
    const statToDvpMetric: Record<string, string> = {
      'pts': 'pts',
      'reb': 'reb',
      'ast': 'ast',
      'fg3m': 'fg3m',
      'stl': 'stl',
      'blk': 'blk',
      'to': 'to',
      'fg_pct': 'fg_pct',
      'pra': 'pra',
      'pr': 'pr',
      'pa': 'pa',
      'ra': 'ra',
    };
    
    const dvpMetric = statToDvpMetric[selectedStat];
    if (!dvpMetric) {
      return;
    }

    // Check if we already have prefetched data with valid values
    const prefetchKey = `${selectedPosition}:${dvpMetric}`;
    const prefetched = prefetchedDvpRanks[prefetchKey];
    if (prefetched) {
      // Check if prefetched data has any valid (non-null) values
      const hasValidValues = Object.values(prefetched).some(v => v !== null && v !== undefined);
      if (hasValidValues) {
        // Already have prefetched data with valid values, skip fetch
        console.log('[DvP Rank Legacy] Skipping - prefetched data has valid values');
      return;
      }
      // Prefetched data exists but all values are null - still fetch to try to get data
      console.log('[DvP Rank Legacy] Prefetched data exists but all values are null, fetching...');
    }

    let isMounted = true;
    const fetchDvpRanks = async () => {
      try {
        // Map ranks to game IDs based on opponent team and game date
        const ranksByGame: Record<string, number | null> = {};
        
        // Fetch historical ranks for each game - use filteredChartData to match displayed games
        const rankPromises = filteredChartData.map(async (game: any) => {
          const gameIdStr = game.xKey || String(game.game?.id || game.stats?.game?.id || '');
          const opponent = game.opponent || game.tickLabel || '';
          const gameDate = game.date || game.stats?.game?.date || '';
          
          if (!opponent || opponent === 'N/A' || opponent === 'ALL' || opponent === '') {
            return { gameIdStr, rank: null };
          }
          
          if (!gameDate) {
            // If no game date, fallback to current ranks
            return { gameIdStr, rank: null, useCurrent: true };
          }
          
          // Try to fetch historical rank for this game date
          try {
            const dateStr = new Date(gameDate).toISOString().split('T')[0];
            const historicalResponse = await fetch(
              `/api/dvp/rank/historical?date=${dateStr}&pos=${selectedPosition}&metric=${dvpMetric}`
            );
            
            if (historicalResponse.ok) {
              const historicalData = await historicalResponse.json();
              if (historicalData.success && historicalData.ranks && Object.keys(historicalData.ranks).length > 0) {
                const normalizedOpp = normalizeAbbr(opponent);
                const rank = historicalData.ranks[normalizedOpp] ?? 
                            historicalData.ranks[normalizedOpp.toUpperCase()] ?? null;
                // Only return rank if it's not 0 (0 means no data)
                if (rank && rank > 0) {
                  return { gameIdStr, rank };
              }
              }
              // If historical API returned empty ranks or no match, fall through to use current ranks
            }
          } catch (historicalError) {
            console.warn(`[Second Axis] Failed to fetch historical rank for game ${gameIdStr}:`, historicalError);
          }
          
          // Fallback: use current ranks if historical lookup fails
          return { gameIdStr, rank: null, useCurrent: true };
        });
        
        const rankResults = await Promise.all(rankPromises);
        
        // Check if we need to fetch current ranks for any games
        const needsCurrentRanks = rankResults.some(r => r.useCurrent);
        let currentRanks: Record<string, number> = {};
        
        if (needsCurrentRanks) {
          // Fetch current DvP ranks as fallback
          console.log('[DvP Rank Legacy] Fetching current ranks...', { selectedPosition, dvpMetric });
          const currentResponse = await fetch(`/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${dvpMetric}&games=82`);
          
          if (currentResponse.ok) {
            const currentData = await currentResponse.json();
            currentRanks = currentData.metrics?.[dvpMetric] || {};
            console.log('[DvP Rank Legacy] Current ranks response:', {
              hasMetrics: !!currentData.metrics,
              hasDvpMetric: !!currentData.metrics?.[dvpMetric],
              rankCount: Object.keys(currentRanks).length,
              sampleTeams: Object.keys(currentRanks).slice(0, 10),
              sampleRanks: Object.entries(currentRanks).slice(0, 5)
            });
          } else {
            console.warn('[DvP Rank Legacy] Current ranks API error:', currentResponse.status);
          }
        }
        
        if (!isMounted) return;
        
        // Map ranks to games
        rankResults.forEach((result) => {
          if (result.rank !== null) {
            ranksByGame[result.gameIdStr] = result.rank;
          } else if (result.useCurrent) {
            // Use current rank as fallback
            const game = filteredChartData.find((g: any) => {
              const gameIdStr = g.xKey || String(g.game?.id || g.stats?.game?.id || '');
              return gameIdStr === result.gameIdStr;
            });
            
            if (game) {
              const opponent = game.opponent || game.tickLabel || '';
              if (opponent && opponent !== 'N/A' && opponent !== 'ALL' && opponent !== '') {
                const normalizedOpp = normalizeAbbr(opponent);
                // Try multiple variations
                let rank = currentRanks[normalizedOpp] ?? 
                          currentRanks[normalizedOpp.toUpperCase()] ?? 
                          currentRanks[normalizedOpp.toLowerCase()] ?? null;
                
                // If still not found, try partial match
                if (rank === null || rank === undefined) {
                  const matchingKey = Object.keys(currentRanks).find(key => 
                    key.toUpperCase() === normalizedOpp.toUpperCase() ||
                    normalizedOpp.toUpperCase().includes(key.toUpperCase()) ||
                    key.toUpperCase().includes(normalizedOpp.toUpperCase())
                  );
                  if (matchingKey) {
                    rank = currentRanks[matchingKey];
                  }
                }
                
                ranksByGame[result.gameIdStr] = typeof rank === 'number' && rank > 0 ? rank : null;
                
                // Log when we can't find a match
                if (rank === null || rank === undefined) {
                  console.log('[DvP Rank Legacy] No rank found for opponent:', {
                    gameIdStr: result.gameIdStr,
                    opponent,
                    normalizedOpp,
                    availableTeams: Object.keys(currentRanks).slice(0, 10)
                  });
                }
              } else {
                ranksByGame[result.gameIdStr] = null;
              }
            } else {
              ranksByGame[result.gameIdStr] = null;
            }
          } else {
            ranksByGame[result.gameIdStr] = null;
          }
        });
        
        console.log('[DvP Rank Legacy] Fetched ranks:', {
          gameCount: Object.keys(ranksByGame).length,
          ranksWithValues: Object.entries(ranksByGame).filter(([_, rank]) => rank !== null && rank !== undefined).length,
          sampleRanks: Object.entries(ranksByGame).slice(0, 5),
          sampleGamesWithOpponents: filteredChartData.slice(0, 3).map((g: any) => ({
            gameId: g.xKey || String(g.game?.id || g.stats?.game?.id || ''),
            opponent: g.opponent || g.tickLabel || 'N/A'
          }))
        });
        setDvpRanksPerGame(ranksByGame);
      } catch (error) {
        console.error('[Second Axis] Error fetching DvP ranks:', error);
        if (isMounted) {
          setDvpRanksPerGame({});
        }
      }
    };

    fetchDvpRanks();
    
    return () => {
      isMounted = false;
    };
  }, [selectedFilterForAxis, filteredChartData, propsMode, selectedPosition, selectedStat, prefetchedDvpRanks]);
  
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
  
  // Fetch real odds data - fetches player props or team game odds based on mode
  const fetchOddsData = async (retryCount = 0) => {
    setOddsLoading(true);
    setOddsError(null);
    
    try {
      let params;
      
      if (propsMode === 'player') {
        // In player mode, fetch player's props by player name
        const playerName = selectedPlayer?.full || `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
        if (!playerName || !selectedPlayer) {
          // Don't clear odds here - let the player ID tracking useEffect handle clearing
          // This prevents clearing odds when player is temporarily null during state updates
          setOddsLoading(false);
          return;
        }
        params = new URLSearchParams({ player: playerName });
      } else {
        // In team mode, fetch game odds by team
        if (!gamePropsTeam || gamePropsTeam === 'N/A') {
          setRealOddsData([]);
          setOddsLoading(false);
          return;
        }
        params = new URLSearchParams({ team: gamePropsTeam });
        // Add refresh parameter if this is a retry due to missing metadata
        if (retryCount > 0) {
          params.set('refresh', '1');
        }
      }
      
      const response = await fetch(`/api/odds?${params}`);
      const data = await response.json();
      
      console.log('[fetchOddsData] API response:', {
        success: data.success,
        dataLength: data.data?.length || 0,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
        propsMode,
        gamePropsTeam,
        hasLoading: !!data.loading
      });
      
      // Handle background loading state
      if (data.loading) {
        // Data is loading in background - retry with exponential backoff (max 5 retries)
        if (retryCount < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // 1s, 2s, 4s, 8s, 10s max
          setTimeout(() => {
            fetchOddsData(retryCount + 1);
          }, delay);
        } else {
          // Max retries reached - stop loading
          setOddsLoading(false);
          setOddsError('Odds data taking longer than expected to load');
        }
        return;
      }
      
      if (!data.success) {
        // If odds API key is not configured, treat as no-data without error noise
        if (data.error && /odds api key not configured/i.test(data.error)) {
          setRealOddsData([]);
          setOddsError(null);
          return;
        }
        // Also treat 'waiting for refresh' as no error
        if (data.error && /waiting for refresh/i.test(data.error)) {
          setRealOddsData([]);
          setOddsError(null);
          return;
        }
        // Handle rate limit errors gracefully - keep existing data if available
        if (data.error && (/rate limit/i.test(data.error) || /429/i.test(data.error))) {
          // If we have cached data, keep showing it instead of error
          if (realOddsData.length > 0) {
            console.warn('[fetchOddsData] Rate limit hit, but keeping existing cached data');
            setOddsError('Rate limit exceeded - showing cached data');
            setOddsLoading(false);
            return;
          }
          // No cached data - show error but don't clear existing data
          setOddsError(data.error || 'Rate limit exceeded. Please wait a moment.');
          setOddsLoading(false);
          return;
        }
        setOddsError(data.error || 'Failed to fetch odds');
        setRealOddsData([]);
        return;
      }
      
      // If team mode and metadata is missing, trigger a single refresh; otherwise proceed without metadata
      if (propsMode === 'team' && (!data.homeTeam || !data.awayTeam) && data.data && data.data.length > 0) {
        console.log('[fetchOddsData] Missing team metadata - triggering cache refresh...');
        if (!missingTeamMetaRetryRef.current) {
          missingTeamMetaRetryRef.current = true;
          // Trigger a refresh with the refresh parameter
          const refreshParams = new URLSearchParams();
          if (gamePropsTeam) refreshParams.set('team', gamePropsTeam);
          refreshParams.set('refresh', '1');
          
          // Retry after a short delay to allow cache to refresh
          setTimeout(() => {
            fetchOddsData(retryCount + 1);
          }, 2000);
          return;
        } else {
          console.log('[fetchOddsData] Metadata still missing after retry, proceeding without team metadata');
          // Proceed with oddsData even without team metadata
        }
      }
      
      const oddsData = data.data || [];
      
      // Store home/away teams for team mode BEFORE setting state (to avoid multiple updates)
      if (propsMode === 'team' && data.homeTeam && data.awayTeam) {
        // Store these in a way we can access in BestOddsTable
        // We'll add them to each bookmaker as metadata
        if (oddsData.length > 0) {
          console.log('[fetchOddsData] Setting game teams:', {
            homeTeam: data.homeTeam,
            awayTeam: data.awayTeam,
            gamePropsTeam,
            bookCount: oddsData.length
          });
          oddsData.forEach((book: any) => {
            if (!book.meta) book.meta = {};
            book.meta.gameHomeTeam = data.homeTeam;
            book.meta.gameAwayTeam = data.awayTeam;
          });
        } else {
          console.log('[fetchOddsData] No bookmakers in data, cannot set team metadata');
        }
      } else if (propsMode === 'team') {
        console.log('[fetchOddsData] Not setting team metadata:', {
          propsMode,
          hasHomeTeam: !!data.homeTeam,
          hasAwayTeam: !!data.awayTeam
        });
      }
      
      console.log('[fetchOddsData] Setting realOddsData:', {
        length: oddsData.length,
        sampleBook: oddsData[0] ? {
          name: oddsData[0].name,
          hasPRA: !!oddsData[0].PRA,
          PRA: oddsData[0].PRA,
          hasPTS: !!oddsData[0].PTS,
          hasREB: !!oddsData[0].REB,
          hasAST: !!oddsData[0].AST,
        } : null
      });
      
      // Update odds in a transition to prevent visible refresh
      // Only update if data has actually changed (check length and first book name)
      console.log('[DEBUG fetchOddsData] About to set realOddsData', {
        oddsDataLength: oddsData.length,
        timestamp: new Date().toISOString()
      });
      
      startTransition(() => {
        setRealOddsData(prevOdds => {
          // Quick check: if length is same and first book is same, likely no change
          if (prevOdds.length === oddsData.length && 
              prevOdds.length > 0 && oddsData.length > 0 &&
              prevOdds[0]?.name === oddsData[0]?.name &&
              prevOdds[0]?.PTS?.line === oddsData[0]?.PTS?.line) {
            // Likely the same data, but do a full comparison to be sure
            const prevStr = JSON.stringify(prevOdds);
            const newStr = JSON.stringify(oddsData);
            if (prevStr === newStr) {
              console.log('[DEBUG fetchOddsData] Odds data unchanged, skipping update');
              return prevOdds; // No change, return previous to prevent re-render
            }
          }
          console.log('[DEBUG fetchOddsData] Updating realOddsData', {
            prevLength: prevOdds.length,
            newLength: oddsData.length
          });
          return oddsData;
        });
      });
      
      const playerName = selectedPlayer?.full || `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
      const target = propsMode === 'player' ? playerName : gamePropsTeam;
      console.log(`ðŸ“Š Loaded ${data.data?.length || 0} bookmaker odds for ${target}`);
      
      // Debug: Check for PrizePicks in the data
      const allBookmakers = new Set<string>();
      const prizepicksEntries: any[] = [];
      (data.data || []).forEach((book: any) => {
        const bookName = (book?.meta?.baseName || book?.name || '').toLowerCase();
        if (bookName) {
          allBookmakers.add(bookName);
          if (bookName.includes('prizepicks')) {
            prizepicksEntries.push({
              name: book?.meta?.baseName || book?.name,
              stat: book?.meta?.stat,
              variantLabel: book?.meta?.variantLabel,
              isPickem: book?.meta?.isPickem,
              pts: book?.PTS,
            });
          }
        }
      });
      
    } catch (error) {
      console.error('Error fetching odds:', error);
      setOddsError(error instanceof Error ? error.message : 'Failed to load odds');
      setRealOddsData([]);
    } finally {
      setOddsLoading(false);
    }
  };
  
  // Track if odds are currently being fetched to prevent duplicate calls
  const isFetchingOddsRef = useRef(false);
  // Track a single retry for missing team metadata (team mode)
  const missingTeamMetaRetryRef = useRef(false);
  // Track last odds fetch key to avoid refetching when data already present
  const lastOddsFetchKeyRef = useRef<string | null>(null);
  
  // Track the last player ID (or name fallback) to prevent unnecessary odds fetches
  const lastOddsPlayerIdRef = useRef<string | null>(null);
  
  // Track last propsMode to detect mode changes
  const lastPropsModeRef = useRef<'player' | 'team' | null>(null);
  
  // Clear odds and reset fetch refs when propsMode changes
  useEffect(() => {
    if (lastPropsModeRef.current !== null && lastPropsModeRef.current !== propsMode) {
      console.log('[DEBUG propsMode change] Clearing odds and resetting refs', {
        oldMode: lastPropsModeRef.current,
        newMode: propsMode
      });
      setRealOddsData([]);
      setOddsLoading(false);
      setOddsError(null);
      lastOddsFetchKeyRef.current = null;
      lastOddsPlayerIdRef.current = null;
      isFetchingOddsRef.current = false;
      missingTeamMetaRetryRef.current = false;
    }
    lastPropsModeRef.current = propsMode;
  }, [propsMode]);
  
  // Fetch odds when player/team or mode changes - with debouncing to prevent rate limits
  useEffect(() => {
    console.log('[DEBUG fetchOdds useEffect] Triggered', {
      propsMode,
      hasSelectedPlayer: !!selectedPlayer,
      selectedPlayerId: selectedPlayer?.id,
      selectedPlayerName: selectedPlayer?.full,
      gamePropsTeam,
      realOddsDataLength: realOddsData.length,
      lastOddsPlayerId: lastOddsPlayerIdRef.current,
      isFetching: isFetchingOddsRef.current
    });
    
    // Reset missing metadata retry on dependency change
    missingTeamMetaRetryRef.current = false;
    
    // For team mode, add a small delay to ensure gamePropsTeam is set
    if (propsMode === 'team' && !gamePropsTeam) {
      console.log('[DEBUG fetchOdds useEffect] Team mode but no gamePropsTeam, skipping');
      return;
    }
    
    // In player mode, prefer player ID; fall back to name so we still fetch odds.
    if (propsMode === 'player') {
      if (selectedPlayer) {
        const currentPlayerKey =
          selectedPlayer.id?.toString() ||
          (selectedPlayer.full ? selectedPlayer.full.toLowerCase() : null);
        if (currentPlayerKey) {
          // If same player and we already have odds, skip fetching again
          // BUT: if odds were cleared (length is 0), we need to fetch again
          if (
            currentPlayerKey === lastOddsPlayerIdRef.current &&
            realOddsData.length > 0
          ) {
            console.log('[DEBUG fetchOdds useEffect] Same player and odds exist, skipping fetch', {
              currentPlayerKey,
              lastOddsPlayerId: lastOddsPlayerIdRef.current,
              realOddsDataLength: realOddsData.length
            });
            return;
          }
          // If odds were cleared but player is the same, reset the ref to allow fetching
          if (currentPlayerKey === lastOddsPlayerIdRef.current && realOddsData.length === 0) {
            console.log('[DEBUG fetchOdds useEffect] Same player but odds cleared, resetting ref to allow fetch', {
              currentPlayerKey,
              realOddsDataLength: realOddsData.length
            });
            lastOddsPlayerIdRef.current = null; // Reset to allow fetch
          }
          console.log('[DEBUG fetchOdds useEffect] Player key changed or no odds, will fetch', {
            currentPlayerKey,
            lastOddsPlayerId: lastOddsPlayerIdRef.current,
            realOddsDataLength: realOddsData.length
          });
          lastOddsPlayerIdRef.current = currentPlayerKey;
        } else {
          // No usable key; ensure ref resets so next valid player triggers fetch
          console.log('[DEBUG fetchOdds useEffect] No usable player key, resetting ref');
          lastOddsPlayerIdRef.current = null;
        }
      } else {
        console.log('[DEBUG fetchOdds useEffect] No player selected, skipping fetch');
        lastOddsPlayerIdRef.current = null;
        return; // No player selected; skip fetch
      }
    }
    
    // Build fetch key (player or team)
    const fetchKey = propsMode === 'team'
      ? `team:${gamePropsTeam || 'na'}`
      : `player:${selectedPlayer?.id || selectedPlayer?.full || 'na'}`;

    // Skip if already fetching
    if (isFetchingOddsRef.current) {
      console.log('[DEBUG fetchOdds useEffect] Already fetching, skipping');
      return;
    }
    
    // If we already have odds for this key and not loading, skip refetch
    if (fetchKey === lastOddsFetchKeyRef.current && realOddsData.length > 0 && !oddsLoading) {
      console.log('[DEBUG fetchOdds useEffect] Odds already loaded for key, skipping fetch', {
        fetchKey,
        realOddsDataLength: realOddsData.length
      });
      return;
    }
    
    // Debounce: wait 300ms before fetching to avoid rapid successive calls
    console.log('[DEBUG fetchOdds useEffect] Setting timeout to fetch odds in 300ms');
    const timeoutId = setTimeout(() => {
      console.log('[DEBUG fetchOdds useEffect] Timeout fired, starting fetch');
      isFetchingOddsRef.current = true;
      lastOddsFetchKeyRef.current = fetchKey;
      fetchOddsData().finally(() => {
        // Reset flag after a delay to allow for retries
        setTimeout(() => {
          isFetchingOddsRef.current = false;
        }, 1000);
      });
    }, 300);
    
    return () => {
      console.log('[DEBUG fetchOdds useEffect] Cleanup: clearing timeout');
      clearTimeout(timeoutId);
      // Don't reset isFetchingOddsRef here - let it be reset by the finally block
      // This prevents race conditions where cleanup runs before fetch completes
    };
  }, [selectedPlayer, selectedTeam, gamePropsTeam, propsMode]);

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
