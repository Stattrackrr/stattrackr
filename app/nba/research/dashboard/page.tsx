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
import { AltLineItem, partitionAltLineItems, cloneBookRow, mergeBookRowsByBaseName, getBookRowKey } from './utils/oddsUtils';
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleSidebarSubscription = async () => {
    if (!isPro) {
      router.push('/subscription');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/subscription');
        return;
      }

      const response = await fetch('/api/portal-client', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        router.push('/subscription');
      }
    } catch (error) {
      clientLogger.error('Portal error:', error);
      router.push('/subscription');
    }
  };

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
    if (!LINE_MOVEMENT_ENABLED) {
      return [];
    }
    if (lineMovementData) {
      const { lineMovement = [], openingLine, currentLine } = lineMovementData;

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

  // Background cache all teams function
  const cacheAllTeamsInBackground = async () => {
    if (backgroundCacheLoading) return; // Prevent multiple background loads
    
    setBackgroundCacheLoading(true);
    console.log('ðŸ”„ Starting background cache of all team data...');
    
    // List of all NBA teams
    const allTeams = Object.keys(ABBR_TO_TEAM_ID);
    const teamsToCache = allTeams.filter(team => !teamGameCache[team]);
    
    setCacheProgress({ current: 0, total: teamsToCache.length });
    
    for (let i = 0; i < teamsToCache.length; i++) {
      const teamAbbr = teamsToCache[i];
      try {
        // Use a simplified version without UI loading states
        const games = await fetchTeamGamesData(teamAbbr, false); // false = no UI loading
        
        setTeamGameCache(prev => ({
          ...prev,
          [teamAbbr]: games
        }));
        
        // Update progress
        setCacheProgress({ current: i + 1, total: teamsToCache.length });
        
        // Small delay between teams to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.warn(`Background cache failed for ${teamAbbr}:`, error);
      }
    }
    
    console.log('âœ… Background cache completed for all teams');
    setBackgroundCacheLoading(false);
    setCacheProgress({ current: 0, total: 0 });
  };

  // Core function to fetch team games (without UI state updates)
  const fetchTeamGamesData = async (teamAbbr: string, showLoading: boolean = true) => {
    if (!teamAbbr || teamAbbr === 'N/A') return [];
    
    if (showLoading) {
      setGameStatsLoading(true);
    }
    try {
      const season = currentNbaSeason();
      const teamId = ABBR_TO_TEAM_ID[normalizeAbbr(teamAbbr)];
      
      if (!teamId) {
        console.warn(`No team ID found for ${teamAbbr}`);
        return [];
      }
      
      console.log(`ðŸ€ Fetching games for team ${teamAbbr} (ID: ${teamId})`);
      
      // Use aggregated, team-scoped fast path (no cursor), one call per season
      const current = currentNbaSeason();
      const targetSeasons = [String(current), String(current - 1), String(current - 2)];

      const seasonResults = await Promise.all(
        targetSeasons.map(async (s) => {
          try {
            // Fetch all games for this season (API handles pagination internally)
            const url = `/api/bdl/games?seasons[]=${s}&team_ids[]=${teamId}&per_page=100`;
            const res = await fetch(url);
            const js = await res.json();
            const arr = Array.isArray(js?.data) ? js.data : [];
            return arr;
          } catch {
            return [] as any[];
          }
        })
      );

      const seasonData = { data: seasonResults.flat() } as any;

      if (seasonData?.data) {
        console.log(`ðŸ” FILTERING: Starting with ${seasonData.data.length} total games`);
        
        // Filter for games involving our team and only completed games
        let allTeamGames = seasonData.data.filter((game: any) => {
          return game.home_team?.id === teamId || game.visitor_team?.id === teamId;
        });
        
        console.log(`ðŸ” Found ${allTeamGames.length} total games involving ${teamAbbr} (before status filtering)`);
        
        // Check what statuses we have
        const statusCounts = allTeamGames.reduce((acc: any, game: any) => {
          const status = game.status || 'undefined';
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, {});
        
        console.log(`ðŸ” Game statuses for ${teamAbbr}:`, statusCounts);
        
        let games = seasonData.data.filter((game: any) => {
          const isTeamInvolved = game.home_team?.id === teamId || game.visitor_team?.id === teamId;
          const isCompleted = game.status === 'Final';
          const hasScores = game.home_team_score != null && game.visitor_team_score != null;
          
          const passes = isTeamInvolved && isCompleted && hasScores;
          
          // Debug first few games
          if (seasonData.data.indexOf(game) < 5) {
            console.log(`ðŸ”Ž Game filter debug:`, {
              id: game.id,
              date: game.date,
              home: game.home_team?.abbreviation + ` (ID: ${game.home_team?.id})`,
              away: game.visitor_team?.abbreviation + ` (ID: ${game.visitor_team?.id})`,
              status: game.status,
              targetTeamId: teamId,
              isTeamInvolved,
              isCompleted,
              hasScores,
              passes
            });
          }
          
          return passes;
        });
        
        // Sort by date (oldest first for full season display)
        games = games
          .sort((a: any, b: any) => {
            const dateA = new Date(a.date || 0).getTime();
            const dateB = new Date(b.date || 0).getTime();
            return dateA - dateB; // Oldest first (season progression)
          });
          
        console.log(`ðŸ† Full 2024-25 season: ${games.length} games`);
        
        // Break down games by month/type
        const gamesByMonth = games.reduce((acc: any, game: any) => {
          const date = game.date;
          const month = date ? date.substring(0, 7) : 'unknown'; // YYYY-MM
          acc[month] = (acc[month] || 0) + 1;
          return acc;
        }, {});
        
        console.log(`ðŸ“… Games breakdown by month:`, gamesByMonth);
        
        // Check for potential preseason (October before 15th) or playoff games (April after 15th)
        const preseasonGames = games.filter((g: any) => {
          const date = g.date;
          return date && date.startsWith('2024-10') && parseInt(date.split('-')[2]) < 15;
        });
        
        const playoffGames = games.filter((g: any) => {
          const date = g.date;
          return date && (date.startsWith('2025-04') && parseInt(date.split('-')[2]) > 15) || date.startsWith('2025-05') || date.startsWith('2025-06');
        });
        
        console.log(`ðŸ† Potential preseason games: ${preseasonGames.length}`);
        console.log(`ðŸ† Potential playoff games: ${playoffGames.length}`);
        
        console.log(`ðŸ“Š Found ${games.length} games for ${teamAbbr}`);
        if (games.length > 0) {
          const newest = games[0]?.date;
          const oldest = games[games.length - 1]?.date;
          console.log(`ðŸ“… Date range: ${oldest} to ${newest}`);
        }
        
        // Games are already in chronological order (oldest to newest)
        if (showLoading) {
          setGameStats(games);
        }
        return games;
      }
      
      console.warn(`No games found for ${teamAbbr}`);
      return [];
    } catch (error) {
      console.error(`Error fetching game data for ${teamAbbr}:`, error);
      if (showLoading) {
        setGameStats([]);
      }
      return [];
    } finally {
      if (showLoading) {
        setGameStatsLoading(false);
      }
    }
  };
  // Priority fetch: load requested team immediately, then cache others in background
  const fetchGameDataForTeam = async (teamAbbr: string) => {
    if (!teamAbbr || teamAbbr === 'N/A') return [];
    
    // Check cache first
    if (teamGameCache[teamAbbr]) {
      console.log(`âš¡ Using cached data for ${teamAbbr}`);
      
      // Add 20ms delay to make switching visible
      setGameStatsLoading(true);
      await new Promise(resolve => setTimeout(resolve, 20));
      setGameStats(teamGameCache[teamAbbr]);
      setGameStatsLoading(false);
      
      return teamGameCache[teamAbbr];
    }
    
    console.log(`ðŸ€ Priority loading ${teamAbbr}...`);
    
    // Load requested team immediately with UI loading state
    const games = await fetchTeamGamesData(teamAbbr, true);
    
    // Cache the result
    setTeamGameCache(prev => ({
      ...prev,
      [teamAbbr]: games
    }));
    
    // Trigger background caching of all other teams (non-blocking)
    setTimeout(() => {
      cacheAllTeamsInBackground();
    }, 500); // Small delay to let UI update first
    
    return games;
  };

  // Fetch games function (today Â± 7 days)
  const fetchTodaysGames = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (gamesFetchInFlightRef.current) {
      return;
    }
    gamesFetchInFlightRef.current = true;

    try {
      if (!silent) {
        setGamesLoading(true);
      }
      
      const formatDate = (date: Date) => {
        return date.toISOString().split('T')[0];
      };
      
      // Fetch only a small date range (today Â± 7 days) to avoid season paging
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];

      // Check sessionStorage first for instant load (if prefetched)
      if (typeof window !== 'undefined') {
        try {
          const cacheKey = `dashboard-games-${start}-${end}`;
          const cachedData = sessionStorage.getItem(cacheKey);
          const cachedTimestamp = sessionStorage.getItem(`${cacheKey}-timestamp`);
          const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
          
          if (cachedData && cachedTimestamp) {
            const age = Date.now() - parseInt(cachedTimestamp, 10);
            if (age < CACHE_TTL_MS) {
              try {
                const parsed = JSON.parse(cachedData);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  console.log(`âœ… Using cached games from sessionStorage (${parsed.length} games, ${Math.round(age / 1000)}s old)`);
                  setTodaysGames(parsed);
                  setGamesLoading(false);
                  gamesFetchInFlightRef.current = false;
                  // Still fetch in background to update if needed (non-blocking)
                  fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`, { cache: 'default' }).then(async (response) => {
                    if (response.ok) {
                      const data = await response.json();
                      if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
                        setTodaysGames(data.data);
                        sessionStorage.setItem(cacheKey, JSON.stringify(data.data));
                        sessionStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
                      }
                    }
                  }).catch(() => {});
                  return;
                }
              } catch (e) {
                console.warn('Failed to parse cached games data, fetching fresh');
              }
            }
          }
        } catch (e) {
          // Ignore sessionStorage errors, continue to fetch
        }
      }

      try {
        const response = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`);
        const data = await response.json();
        const arr = Array.isArray(data?.data) ? data.data : [];
        if (arr.length > 0) {
          console.log(`âœ… Fetched ${arr.length} games from ${start} to ${end}`);
          console.log(`   Games: ${arr.map((g: any) => `${g.home_team?.abbreviation} vs ${g.visitor_team?.abbreviation}`).join(', ')}`);
          setTodaysGames(arr);
          // Cache for next time
          if (typeof window !== 'undefined') {
            try {
              const cacheKey = `dashboard-games-${start}-${end}`;
              sessionStorage.setItem(cacheKey, JSON.stringify(arr));
              sessionStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
            } catch (e) {
              // Ignore storage errors
            }
          }
          return;
        }
      } catch (e) {
        console.error('Error fetching date-range games:', e);
      }

      console.log('âŒ No games found in date range');
      setTodaysGames([]);
      
    } catch (error) {
      console.error('Error in fetchTodaysGames:', error);
      setTodaysGames([]);
    } finally {
      gamesFetchInFlightRef.current = false;
      if (!silent) {
        setGamesLoading(false);
      }
    }
  }, [gamesFetchInFlightRef]);

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
  const fetchTeamDepthChart = async (team: string): Promise<DepthChartData | null> => {
    try {
      if (!team || team === 'N/A') return null;
      const url = `/api/depth-chart?team=${encodeURIComponent(team)}`;
      // Use cachedFetch to prevent duplicate requests and respect rate limits
      const js = await cachedFetch(url, undefined, 300000); // Cache for 5 minutes
      if (!js || !js.success) return null;
      return js?.depthChart as DepthChartData | null;
    } catch (error) {
      console.warn(`Failed to fetch depth chart for ${team}:`, error);
      return null;
    }
  };

  // Prefetch rosters for current teams (specific to current mode)
  useEffect(() => {
    const prefetchTeamRosters = async () => {
      const playerTeam = propsMode === 'team' ? gamePropsTeam : originalPlayerTeam;
      const oppTeam = opponentTeam;
      
      if (!playerTeam || playerTeam === 'N/A') return;
      
      // Fetch player team roster
      if (playerTeam !== 'N/A') {
        setRostersLoading(prev => ({ ...prev, player: true }));
        const playerRoster = await fetchTeamDepthChart(playerTeam);
        setPlayerTeamRoster(playerRoster);
        setRostersLoading(prev => ({ ...prev, player: false }));
      }
      
      // Fetch opponent team roster if available
      if (oppTeam && oppTeam !== 'N/A' && oppTeam !== playerTeam) {
        setRostersLoading(prev => ({ ...prev, opponent: true }));
        const opponentRoster = await fetchTeamDepthChart(oppTeam);
        setOpponentTeamRoster(opponentRoster);
        setRostersLoading(prev => ({ ...prev, opponent: false }));
      }
    };
    
    prefetchTeamRosters();
  }, [originalPlayerTeam, opponentTeam, propsMode, gamePropsTeam]);


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
  
  // Resolve BDL player id from a name if depth chart item lacks an id
  const resolveTeammateIdFromName = useCallback(async (name: string): Promise<number | null> => {
    try {
      if (!name) return null;
      const q = new URLSearchParams();
      q.set('endpoint', '/players');
      q.set('search', name);
      q.set('per_page', '100');
      const url = `/api/balldontlie?${q.toString()}`;
      const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
      const js = await res?.json().catch(() => ({})) as any;
      const arr = Array.isArray(js?.data) ? js.data : [];
      if (arr.length === 0) return null;
      // Prefer exact full-name match
      const exact = arr.find((p: any) => `${p.first_name} ${p.last_name}`.trim().toLowerCase() === name.trim().toLowerCase());
      const chosen = exact || arr[0];
      return typeof chosen?.id === 'number' ? chosen.id : null;
    } catch {
      return null;
    }
  }, []);
  // Effect moved below where baseGameData is declared

  // Resolve selected player's exact position from depth chart (after roster states are ready)
  // Rules:
  // 1) Starter always wins (depth index 0). If starter at multiple positions, tie-break by PG > SG > SF > PF > C.
  // 2) Otherwise scan by rows (depth index 1..), first appearance wins; within a row tie-break by PG > SG > SF > PF > C.
  // 3) Name matching uses normalized full/constructed names.
  const selectedPosition = useMemo((): 'PG'|'SG'|'SF'|'PF'|'C' | null => {
    try {
      if (propsMode !== 'player' || !selectedPlayer) return null;
      const fullName = selectedPlayer.full || '';
      const constructed = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
      const names = [fullName, constructed].filter(Boolean) as string[];
      const normalize = (s: string) => s
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const normNames = names.map(normalize);
      const roster = (playerTeamRoster && Object.keys(playerTeamRoster || {}).length ? playerTeamRoster : allTeamRosters[originalPlayerTeam]) as any;
      if (!roster) return null;
      const POS: Array<'PG'|'SG'|'SF'|'PF'|'C'> = ['PG','SG','SF','PF','C'];

      const matchAt = (pos: 'PG'|'SG'|'SF'|'PF'|'C', idx: number): boolean => {
        const arr = Array.isArray(roster[pos]) ? roster[pos] : [];
        if (!arr[idx]) return false;
        const pn = normalize(String(arr[idx]?.name || ''));
        if (!pn) return false;
        return normNames.some(cand => pn === cand || pn.endsWith(' ' + cand) || cand.endsWith(' ' + pn));
      };

      // 1) Starters first
      const starterMatches = POS.filter(pos => matchAt(pos, 0));
      if (starterMatches.length > 0) {
        // Tie-break by priority order: PG > SG > SF > PF > C
        for (const pos of POS) { if (starterMatches.includes(pos)) return pos; }
      }

      // 2) Scan by rows (depth index) then by POS order
      const maxDepth = Math.max(
        ...(POS.map(p => (Array.isArray(roster[p]) ? roster[p].length : 0)))
      );
      for (let depth = 1; depth < maxDepth; depth++) {
        for (const pos of POS) {
          if (matchAt(pos, depth)) return pos;
        }
      }

      return null;
    } catch { return null; }
  }, [propsMode, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, playerTeamRoster, allTeamRosters, originalPlayerTeam]);

  // Preload all team rosters when games are loaded (for instant team switching)
  useEffect(() => {
    const preloadAllRosters = async () => {
      if (todaysGames.length === 0) return;
      
      setRosterCacheLoading(true);
      console.log('ðŸš€ Preloading all team rosters for instant switching...');
      
      // Get all unique teams from today's games
      const allTeams = new Set<string>();
      todaysGames.forEach(game => {
        if (game.home_team?.abbreviation) allTeams.add(normalizeAbbr(game.home_team.abbreviation));
        if (game.visitor_team?.abbreviation) allTeams.add(normalizeAbbr(game.visitor_team.abbreviation));
      });
      
      console.log(`ðŸ“‹ Found ${allTeams.size} teams to preload:`, Array.from(allTeams));
      
      // Fetch all rosters with staggered delays to avoid rate limiting
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const results = [];
      const teamArray = Array.from(allTeams);
      
      for (let i = 0; i < teamArray.length; i++) {
        const team = teamArray[i];
        try {
          const roster = await fetchTeamDepthChart(team);
          results.push({ team, roster });
        } catch (error) {
          console.warn(`Failed to preload roster for ${team}:`, error);
          results.push({ team, roster: null });
        }
        // Add 100ms delay between requests to respect rate limits
        if (i < teamArray.length - 1) {
          await delay(100);
        }
      }
      
      // Build roster cache
      const rosterCache: Record<string, DepthChartData> = {};
      results.forEach(({ team, roster }) => {
        if (roster) {
          rosterCache[team] = roster;
        }
      });
      
      setAllTeamRosters(rosterCache);
      setRosterCacheLoading(false);
      
      console.log(`âœ… Preloaded ${Object.keys(rosterCache).length} team rosters for instant switching`);

      // Preload injuries for all teams we just cached so swaps show injury badges instantly
      try {
        const teamsParam = Array.from(allTeams).join(',');
        if (teamsParam) {
          const res = await fetch(`/api/injuries?teams=${teamsParam}`);
          const data = await res.json();
          if (data?.success) {
            setTeamInjuries((prev: any) => ({ ...prev, ...(data.injuriesByTeam || {}) }));
          }
        }
      } catch (err) {
        console.warn('Failed to preload injuries for all teams:', err);
      }
    };
    
    preloadAllRosters();
  }, [todaysGames]);

  // Fetch injuries for depth chart integration (fetch both selected and opponent teams)
  useEffect(() => {
    const fetchTeamInjuries = async () => {
      const teamA = propsMode === 'team' ? gamePropsTeam : selectedTeam;
      const teamB = opponentTeam;
      
      if (!teamA || teamA === 'N/A') {
        setTeamInjuries({});
        return;
      }

      try {
        const teamsParam = [teamA, teamB]
          .filter(Boolean)
          .filter((t, i, arr) => t !== 'N/A' && arr.indexOf(t as string) === i)
          .join(',');
        const url = teamsParam ? `/api/injuries?teams=${teamsParam}` : `/api/injuries?teams=${teamA}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.success) {
          setTeamInjuries(data.injuriesByTeam || {});
        }
      } catch (error) {
        console.warn('Failed to fetch team injuries:', error);
        setTeamInjuries({});
      }
    };

    fetchTeamInjuries();
  }, [selectedTeam, propsMode, gamePropsTeam, opponentTeam]);




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

  // Resolve playerId with best match (if needed)
  const resolvePlayerId = async (fullName: string, teamAbbr?: string): Promise<string | null> => {
    try {
      const params = new URLSearchParams({ q: fullName });
      if (teamAbbr) params.set('team', teamAbbr);
      const res = await fetch(`/api/bdl/players?${params.toString()}`);
      const j = await res.json().catch(() => ({}));
      const best = j?.best;
      return best?.id ? String(best.id) : null;
    } catch {
      return null;
    }
  };

  // Parse ESPN height format (total inches or "6'10") into feet and inches
  const parseEspnHeight = (height: any): { feet?: number; inches?: number } => {
