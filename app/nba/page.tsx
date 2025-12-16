'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { useTheme } from "@/contexts/ThemeContext";
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import { getFullTeamName, TEAM_FULL_TO_ABBR } from '@/lib/teamMapping';
import { getPlayerHeadshotUrl } from '@/lib/nbaLogos';
import { getEspnLogoUrl } from '@/lib/nbaAbbr';
import { PLAYER_ID_MAPPINGS, convertBdlToNbaId } from '@/lib/playerIdMapping';
import { currentNbaSeason, TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from '@/lib/nbaConstants';
import { BOOKMAKER_INFO } from '@/lib/bookmakers';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import { parseBallDontLieTipoff } from '@/app/nba/research/dashboard/utils';
import { americanToDecimal, formatOdds } from '@/lib/currencyUtils';

interface Game {
  id: number;
  date: string;
  status: string;
  home_team: { id: number; abbreviation: string };
  visitor_team: { id: number; abbreviation: string };
  home_team_score?: number;
  visitor_team_score?: number;
}

interface PlayerProp {
  playerName: string;
  playerId: string;
  team: string;
  opponent: string;
  statType: string;
  line: number;
  overProb: number;
  underProb: number;
  overOdds: string;
  underOdds: string;
  impliedOverProb: number;
  impliedUnderProb: number;
  bestLine: number;
  bookmaker: string;
  confidence: 'High' | 'Medium' | 'Low';
  expectedValue?: number;
  gameDate: string;
  // New fields for table columns
  last5Avg?: number | null;
  last10Avg?: number | null;
  h2hAvg?: number | null;
  last5HitRate?: { hits: number; total: number } | null;
  last10HitRate?: { hits: number; total: number } | null;
  h2hHitRate?: { hits: number; total: number } | null;
  seasonAvg?: number | null;
  seasonHitRate?: { hits: number; total: number } | null;
  streak?: number | null;
  position?: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null; // Player position (used for DvP calculation)
  dvpRating?: number | null;
  dvpStatValue?: number | null;
  bookmakerLines?: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }>;
}

// Tipoff Countdown Component
function TipoffCountdown({ game, isDark }: { game: Game | null; isDark: boolean }) {
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);

  useEffect(() => {
    if (!game) {
      setCountdown(null);
      return;
    }

    const now = Date.now();
    let tipoffDate: Date | null = null;
    
    // First, try to use the datetime field from the game object (most reliable)
    if ((game as any).datetime) {
      const gameDateTime = new Date((game as any).datetime);
      if (!Number.isNaN(gameDateTime.getTime()) && gameDateTime.getTime() > now) {
        tipoffDate = gameDateTime;
      }
    }
    
    // If that didn't work, check if status is a valid ISO timestamp
    if (!tipoffDate && game.status) {
      const statusTime = Date.parse(game.status);
      if (!Number.isNaN(statusTime)) {
        const parsedStatus = new Date(statusTime);
        // Check if it's at midnight (00:00:00) - if so, it's just a date placeholder, not the actual game time
        const isMidnight = parsedStatus.getUTCHours() === 0 && parsedStatus.getUTCMinutes() === 0 && parsedStatus.getUTCSeconds() === 0;
        
        // Only use if it's in the future and NOT midnight (midnight means it's just a date, not actual game time)
        if (parsedStatus.getTime() > now && !isMidnight && parsedStatus.getTime() < now + (7 * 24 * 60 * 60 * 1000)) {
          tipoffDate = parsedStatus;
        }
      }
    }
    
    // Try to parse tipoff from status (this extracts time from status like "7:00 PM")
    if (!tipoffDate) {
      tipoffDate = parseBallDontLieTipoff(game);
      
      // If parseBallDontLieTipoff returned midnight UTC, it's likely just a date - try extracting time from status manually
      if (tipoffDate) {
        const isMidnight = tipoffDate.getUTCHours() === 0 && tipoffDate.getUTCMinutes() === 0 && tipoffDate.getUTCSeconds() === 0;
        if (isMidnight && game.status) {
          // Try to extract time from status string manually
          const timeMatch = game.status.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
          if (timeMatch) {
            const gameDateStr = game.date?.split('T')[0] || new Date().toISOString().split('T')[0];
            let hour = parseInt(timeMatch[1], 10);
            const minute = parseInt(timeMatch[2], 10);
            const meridiem = timeMatch[3].toUpperCase();
            if (meridiem === 'PM' && hour !== 12) hour += 12;
            else if (meridiem === 'AM' && hour === 12) hour = 0;
            
            // Create date with the game date and the parsed time (in local timezone)
            const baseDate = new Date(gameDateStr);
            const tipoff = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0);
            
            // If this time has already passed, assume it's for tomorrow
            if (tipoff.getTime() <= now) {
              tipoff.setDate(tipoff.getDate() + 1);
            }
            
            tipoffDate = tipoff;
          } else {
            // No time in status, use date with 7:30 PM local time
            const dateStr = game.date?.split('T')[0] || '';
            if (dateStr) {
              const localDate = new Date(dateStr);
              localDate.setHours(19, 30, 0, 0); // 7:30 PM local
              if (localDate.getTime() <= now) {
                localDate.setDate(localDate.getDate() + 1);
              }
              tipoffDate = localDate;
            }
          }
        }
      }
    }
    
    // Last resort: use game.date with 7:30 PM local time
    if (!tipoffDate && game.date) {
      const dateStr = game.date.split('T')[0];
      if (dateStr) {
        const localDate = new Date(dateStr);
        localDate.setHours(19, 30, 0, 0); // 7:30 PM local
        if (localDate.getTime() <= now) {
          localDate.setDate(localDate.getDate() + 1);
        }
        tipoffDate = localDate;
      }
    }
    
    if (!tipoffDate || tipoffDate.getTime() <= now) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const now = new Date().getTime();
      const tipoff = tipoffDate.getTime();
      const diff = tipoff - now;
      
      // Check if game is in progress (started within last 3 hours)
      const threeHoursMs = 3 * 60 * 60 * 1000;
      const timeSinceTipoff = now - tipoff;
      const gameIsLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
      
      setIsGameInProgress(gameIsLive);
      
      if (gameIsLive || diff <= 0) {
        setCountdown(null);
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
  }, [game]);

  if (isGameInProgress) {
    return (
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg border"
        style={{
          background: '#22c55e',
          borderColor: '#22c55e',
          borderWidth: '1px',
          boxShadow: '0 0 8px #22c55e60, 0 0 4px #22c55e40',
        }}>
        <span className="text-xs font-semibold text-white">LIVE</span>
      </div>
    );
  }

  if (!countdown) {
    return (
      <div className={`text-sm font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
      style={{
        background: 'linear-gradient(to top, #6366f1, #6366f100)',
        borderColor: '#6366f1',
        borderWidth: '1px',
        boxShadow: '0 0 8px #6366f160, 0 0 4px #6366f140',
      }}>
      <div className="text-[10px] text-white mb-0.5">Tipoff</div>
      <div className="text-xs font-mono font-semibold text-white">
        {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
      </div>
    </div>
  );
}

export default function NBALandingPage() {
  const router = useRouter();
  const { isDark, theme, setTheme } = useTheme();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [todaysGames, setTodaysGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [playerProps, setPlayerProps] = useState<PlayerProp[]>([]);
  const [propsLoading, setPropsLoading] = useState(true);
  const [propsProcessing, setPropsProcessing] = useState(false); // Track if cache is empty but processing is happening
  const [mounted, setMounted] = useState(false);
  const [dropdownContainer, setDropdownContainer] = useState<HTMLElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  // Load filter selections from localStorage on mount
  const loadFiltersFromStorage = () => {
    if (typeof window === 'undefined') {
      return {
        bookmakers: new Set<string>(),
        propTypes: new Set<string>(),
        games: new Set<number>()
      };
    }
    
    try {
      const savedBookmakers = localStorage.getItem('nba_filters_bookmakers');
      const savedPropTypes = localStorage.getItem('nba_filters_propTypes');
      const savedGames = localStorage.getItem('nba_filters_games');
      
      return {
        bookmakers: savedBookmakers ? new Set<string>(JSON.parse(savedBookmakers)) : new Set<string>(),
        propTypes: savedPropTypes ? new Set<string>(JSON.parse(savedPropTypes)) : new Set<string>(),
        games: savedGames ? new Set<number>(JSON.parse(savedGames)) : new Set<number>()
      };
    } catch (e) {
      console.warn('[NBA Landing] Failed to load filters from localStorage:', e);
      return {
        bookmakers: new Set<string>(),
        propTypes: new Set<string>(),
        games: new Set<number>()
      };
    }
  };

  const savedFilters = loadFiltersFromStorage();
  const [selectedBookmakers, setSelectedBookmakers] = useState<Set<string>>(savedFilters.bookmakers);
  const [selectedPropTypes, setSelectedPropTypes] = useState<Set<string>>(savedFilters.propTypes);
  const [selectedGames, setSelectedGames] = useState<Set<number>>(savedFilters.games);
  const [bookmakerDropdownOpen, setBookmakerDropdownOpen] = useState(false);
  const [propTypeDropdownOpen, setPropTypeDropdownOpen] = useState(false);
  const [gamesDropdownOpen, setGamesDropdownOpen] = useState(false);
  const [propLineDropdownOpen, setPropLineDropdownOpen] = useState(false);
  const [propLineSort, setPropLineSort] = useState<'none' | 'high' | 'low'>('none');
  const [currentPage, setCurrentPage] = useState(1);
  const filtersSectionRef = useRef<HTMLDivElement>(null);
  const [filterBottom, setFilterBottom] = useState(120);
  const lockedPositionRef = useRef<number | null>(null);

  // Lock position when dropdown opens - MOBILE ONLY - calculate once and never update
  useEffect(() => {
    if (!isMobile) return; // Desktop uses normal positioning
    
    const anyDropdownOpen = gamesDropdownOpen || bookmakerDropdownOpen || propTypeDropdownOpen;
    if (anyDropdownOpen) {
      if (filtersSectionRef.current && lockedPositionRef.current === null) {
        // Calculate position once when dropdown first opens
        const rect = filtersSectionRef.current.getBoundingClientRect();
        const lockedPosition = rect.bottom + 8;
        lockedPositionRef.current = lockedPosition;
        setFilterBottom(lockedPosition);
      }
    } else {
      // Reset when all dropdowns close
      lockedPositionRef.current = null;
    }
  }, [gamesDropdownOpen, bookmakerDropdownOpen, propTypeDropdownOpen, isMobile]);

  // Lock dropdown position on scroll - MOBILE ONLY - prevent any movement
  useEffect(() => {
    if (!isMobile) return; // Desktop uses normal positioning
    
    if (!gamesDropdownOpen && !bookmakerDropdownOpen && !propTypeDropdownOpen) {
      return;
    }
    
    if (lockedPositionRef.current === null) {
      return;
    }

    const lockPosition = () => {
      const dropdowns = document.querySelectorAll('[data-dropdown-locked]');
      dropdowns.forEach((dropdown) => {
        const el = dropdown as HTMLElement;
        if (lockedPositionRef.current !== null) {
          el.style.setProperty('top', `${lockedPositionRef.current}px`, 'important');
          el.style.setProperty('position', 'fixed', 'important');
        }
      });
    };

    // Lock position immediately
    lockPosition();
    
    // Lock position on scroll
    window.addEventListener('scroll', lockPosition, { passive: true });
    // Lock position on resize
    window.addEventListener('resize', lockPosition, { passive: true });
    
    // Also use requestAnimationFrame to continuously lock it
    let rafId: number;
    const lockLoop = () => {
      lockPosition();
      rafId = requestAnimationFrame(lockLoop);
    };
    rafId = requestAnimationFrame(lockLoop);

    return () => {
      window.removeEventListener('scroll', lockPosition);
      window.removeEventListener('resize', lockPosition);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [gamesDropdownOpen, bookmakerDropdownOpen, propTypeDropdownOpen, isMobile]);

  // Track which popup is open: key is "playerName|statType|lineValue"
  const [openPopup, setOpenPopup] = useState<string | null>(null);
  // Column sorting state: column name -> 'none' | 'asc' | 'desc'
  const [columnSort, setColumnSort] = useState<Record<string, 'none' | 'asc' | 'desc'>>({
    dvp: 'none',
    l5: 'none',
    l10: 'none',
    h2h: 'none',
    season: 'none',
    streak: 'none',
    ip: 'none',
  });
  // Odds format state - load from localStorage or default to 'american'
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');

  useEffect(() => {
    setMounted(true);
    // Set dropdown container to document.body for portal rendering
    if (typeof document !== 'undefined') {
      setDropdownContainer(document.body);
    }
    // Load odds format from localStorage
    const savedFormat = localStorage.getItem('oddsFormat');
    if (savedFormat === 'decimal' || savedFormat === 'american') {
      setOddsFormat(savedFormat);
    }
    
    // Clear any player-related URL parameters when landing on player props page
    // This ensures a clean state when navigating back from dashboard
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const hasPlayerParams = url.searchParams.has('player') || 
                              url.searchParams.has('pid') || 
                              url.searchParams.has('name') ||
                              url.searchParams.has('stat') ||
                              url.searchParams.has('line');
      
      if (hasPlayerParams) {
        // Clear player-related parameters to ensure clean state
        url.searchParams.delete('player');
        url.searchParams.delete('pid');
        url.searchParams.delete('name');
        url.searchParams.delete('stat');
        url.searchParams.delete('line');
        url.searchParams.delete('tf');
        url.searchParams.delete('mode');
        
        // Update URL without page reload
        window.history.replaceState({}, '', url.toString());
        console.log('[NBA Landing] 🧹 Cleared player-related URL parameters');
      }
      
      // Also clear any dashboard session storage to prevent stale state
      try {
        sessionStorage.removeItem('nba_dashboard_session_v1');
        sessionStorage.removeItem('last_prop_click');
        sessionStorage.removeItem('last_prop_url');
      } catch (e) {
        // Ignore errors
      }
    }
  }, []);

  // Reset to first page and close popups whenever filters or sorting change
  useEffect(() => {
    setCurrentPage(1);
    setOpenPopup(null); // Close any open popups
  }, [propLineSort, searchQuery, selectedBookmakers, selectedPropTypes, selectedGames, columnSort]);
  
  // Helper function to cycle column sort: none -> asc -> desc -> none
  // When a column is clicked, clear all other column sorts (only one column sorted at a time)
  const handleColumnSort = (column: string) => {
    setColumnSort(prev => {
      const current = prev[column] || 'none';
      const next = current === 'none' ? 'asc' : current === 'asc' ? 'desc' : 'none';
      // Reset all columns to 'none', then set the clicked column
      const newSort: Record<string, 'none' | 'asc' | 'desc'> = {
        dvp: 'none',
        l5: 'none',
        l10: 'none',
        h2h: 'none',
        season: 'none',
        streak: 'none',
        ip: 'none',
      };
      newSort[column] = next;
      return newSort;
    });
  };
  
  // Close popup on ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenPopup(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  // Helper to render donut chart wheel (hollow, green on left, red on right)
  const renderWheel = (overPercent: number, underPercent: number, label: string, size = 80) => {
    const radius = size / 2 - 10; // Inner radius for donut (hollow center)
    const circumference = 2 * Math.PI * radius;
    const overLength = circumference * (overPercent / 100);
    const underLength = circumference * (underPercent / 100);
    
    return (
      <div className="flex flex-col items-center">
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {/* Background circle (full circle, light gray) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={mounted && isDark ? "#374151" : "#e5e7eb"}
            strokeWidth="12"
          />
          {/* Under (red, right side) - draw first so it's on the right */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#ef4444"
            strokeWidth="12"
            strokeDasharray={`${underLength} ${circumference}`}
            strokeDashoffset={-overLength}
            strokeLinecap="round"
          />
          {/* Over (green, left side) - draw second so it's on the left */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#10b981"
            strokeWidth="12"
            strokeDasharray={`${overLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
          />
          {/* Center text - counter-rotate to keep it upright */}
          <text
            x={size / 2}
            y={size / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(90 ${size / 2} ${size / 2})`}
            className={`text-xs font-semibold ${mounted && isDark ? 'fill-white' : 'fill-gray-900'}`}
          >
            {Math.max(overPercent, underPercent).toFixed(1)}%
          </text>
        </svg>
        <div className={`text-[10px] mt-1 font-medium ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          {label}
        </div>
      </div>
    );
  };

  // Get user info and subscription status
  useEffect(() => {
    let isMounted = true;

    const checkSubscription = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        if (isMounted) {
          setTimeout(() => {
            router.push('/login?redirect=/nba');
          }, 0);
        }
        return;
      }

      if (!isMounted) return;

      setUserEmail(session.user.email || null);
      setUsername(session.user.user_metadata?.username || session.user.user_metadata?.full_name || null);
      setAvatarUrl(session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null);
      
      try {
        const { data: profile } = await (supabase
          .from('profiles') as any)
          .select('subscription_status, subscription_tier')
          .eq('id', session.user.id)
          .single();
        
        if (!isMounted) return;
        
        let isActive = false;
        let isProTier = false;
        
        if (profile) {
          const profileData = profile as any;
          isActive = profileData.subscription_status === 'active' || profileData.subscription_status === 'trialing';
          isProTier = profileData.subscription_tier === 'pro';
        }
        
        const proStatus = isActive && isProTier;
        if (isMounted) {
          setIsPro(proStatus);
        }
      } catch (error) {
        console.error('Error checking subscription:', error);
      }
    };
    
    checkSubscription();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          setIsPro(false);
          router.push('/login?redirect=/nba');
        }
      } else if (event === 'SIGNED_IN' && isMounted && session?.user) {
        checkSubscription();
      }
    });
    
    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [router]);

  // Fetch today's games
  useEffect(() => {
    const fetchTodaysGames = async () => {
      try {
        setGamesLoading(true);
        
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString().split('T')[0];

        const response = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`);
        const data = await response.json();
        const games = Array.isArray(data?.data) ? data.data : [];
        
        // Filter for today's games
        const todayStr = today.toISOString().split('T')[0];
        const todaysGames = games.filter((game: Game) => {
          const gameDate = game.date?.split('T')[0];
          return gameDate === todayStr;
        });
        
        console.log('[NBA Landing] Today\'s games found:', todaysGames.length, todaysGames.slice(0, 3).map((g: any) => ({
          id: g.id,
          date: g.date,
          status: g.status,
          home: g.home_team?.abbreviation,
          away: g.visitor_team?.abbreviation
        })));
        
        setTodaysGames(todaysGames);
      } catch (error) {
        console.error('Error fetching games:', error);
        setTodaysGames([]);
      } finally {
        setGamesLoading(false);
      }
    };

    fetchTodaysGames();
  }, []);

  // Helper to check if a bookmaker is a pick'em/DFS-only bookmaker
  const isPickemBookmaker = (name: string): boolean => {
    const lower = (name || '').toLowerCase();
    const pickemBookmakers = ['draftkings pick6', 'pick6', 'prizepicks', 'prize picks', 'underdog fantasy', 'underdog'];
    return pickemBookmakers.some(key => lower.includes(key));
  };

  // Helper function to get player ID from player name (moved before useEffect for accessibility)
  const getPlayerIdFromName = (playerName: string): string | null => {
    const mapping = PLAYER_ID_MAPPINGS.find(m => 
      m.name.toLowerCase() === playerName.toLowerCase() ||
      m.name.toLowerCase().includes(playerName.toLowerCase()) ||
      playerName.toLowerCase().includes(m.name.toLowerCase())
    );
    // Use bdlId (not nbaId) because /api/stats uses Ball Don't Lie API
    return mapping?.bdlId || null;
  };

  // Fetch player props with good win chances from BDL
  useEffect(() => {
    // Cache keys (defined outside functions so they're accessible to both fetchPlayerProps and checkOddsUpdate)
    const CACHE_KEY = 'nba-player-props-cache';
    const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
    const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache TTL
    
    const fetchPlayerProps = async () => {
      try {
        // Check sessionStorage first for instant load when navigating back
        
        const urlParams = new URLSearchParams(window.location.search);
        const forceRefresh = urlParams.get('refresh') === '1';
        
        // If force refresh, clear sessionStorage to ensure fresh data
        if (forceRefresh && typeof window !== 'undefined') {
          try {
            sessionStorage.removeItem(CACHE_KEY);
            sessionStorage.removeItem(CACHE_TIMESTAMP_KEY);
            console.log('[NBA Landing] 🧹 Cleared sessionStorage for force refresh');
          } catch (e) {
            console.warn('[NBA Landing] Failed to clear sessionStorage:', e);
          }
        }
        
        if (!forceRefresh && typeof window !== 'undefined') {
          const cachedData = sessionStorage.getItem(CACHE_KEY);
          const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
          
          if (cachedData && cachedTimestamp) {
            const age = Date.now() - parseInt(cachedTimestamp, 10);
            if (age < CACHE_TTL_MS) {
              try {
                const parsed = JSON.parse(cachedData);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  console.log(`[NBA Landing] ✅ Using cached player props from sessionStorage (${parsed.length} props, ${Math.round(age / 1000)}s old)`);
                  setPlayerProps(parsed);
                  setPropsLoading(false);
                  return; // Use cached data, skip API call
                }
              } catch (e) {
                console.warn('[NBA Landing] ⚠️ Failed to parse cached data, fetching fresh');
              }
            } else {
              console.log(`[NBA Landing] ⏰ Cache expired (${Math.round(age / 1000)}s old), fetching fresh`);
            }
          }
        }
        
        setPropsLoading(true);
        
        // Only read from cache - no processing on client side
        // Processing is done server-side by cron job
        // Always read from cache - refresh=1 just forces a fresh fetch (no cache headers)
        const cacheUrl = '/api/nba/player-props';
        
        const cacheResponse = await fetch(cacheUrl, {
          cache: forceRefresh ? 'no-store' : 'default'
        });
        console.log(`[NBA Landing] API response status: ${cacheResponse.status}`);
        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();
          console.log(`[NBA Landing] API response data:`, { 
            success: cacheData.success, 
            dataLength: cacheData.data?.length, 
            isArray: Array.isArray(cacheData.data),
            stale: cacheData.stale 
          });
          if (cacheData.success && cacheData.data && Array.isArray(cacheData.data) && cacheData.data.length > 0) {
            console.log(`[NBA Landing] ✅ Using cached player props data (${cacheData.data.length} props)`);
          
          // Debug: Check which stat types are present
          const statTypes = new Set(cacheData.data.map((p: PlayerProp) => p.statType));
          console.log(`[NBA Landing] 📊 Stat types in cache:`, Array.from(statTypes).sort());
          const stlCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'STL').length;
          const blkCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'BLK').length;
          const threesCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'THREES').length;
          console.log(`[NBA Landing] 📊 STL props: ${stlCount}, BLK props: ${blkCount}, THREES props: ${threesCount}`);
          
          // Debug: Check bookmakerLines counts
          const propsWithMultipleBookmakers = cacheData.data.filter((p: PlayerProp) => 
            p.bookmakerLines && Array.isArray(p.bookmakerLines) && p.bookmakerLines.length > 1
          );
          const propsWithOneBookmaker = cacheData.data.filter((p: PlayerProp) => 
            p.bookmakerLines && Array.isArray(p.bookmakerLines) && p.bookmakerLines.length === 1
          );
          console.log(`[NBA Landing] 📊 Bookmakers: ${propsWithMultipleBookmakers.length} props with multiple, ${propsWithOneBookmaker.length} props with single`);
          
          // Sample a prop to see its bookmakerLines
          if (cacheData.data.length > 0) {
            const sampleProp = cacheData.data[0] as PlayerProp;
            console.log(`[NBA Landing] 📊 Sample prop: ${sampleProp.playerName} ${sampleProp.statType} - bookmakerLines:`, 
              sampleProp.bookmakerLines?.length || 0, 
              sampleProp.bookmakerLines?.map(b => b.bookmaker).join(', ') || 'none'
            );
          }
            setPlayerProps(cacheData.data);
            setPropsProcessing(false); // Reset processing state when we have data
            
            // Save to sessionStorage for instant load on back navigation
            if (typeof window !== 'undefined') {
              try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheData.data));
                sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
                console.log(`[NBA Landing] 💾 Cached ${cacheData.data.length} player props to sessionStorage`);
              } catch (e) {
                console.warn('[NBA Landing] ⚠️ Failed to cache to sessionStorage:', e);
              }
            }
            
            setPropsLoading(false);
            return;
          } else {
            console.log(`[NBA Landing] ⚠️ No cached data available - cache is being populated`);
            console.log(`[NBA Landing] Response structure:`, { success: cacheData.success, hasData: !!cacheData.data, dataType: typeof cacheData.data, cached: cacheData.cached, message: cacheData.message });
            setPlayerProps([]);
            setPropsProcessing(!cacheData.cached); // Show processing state if cache is empty
            setPropsLoading(false);
            
            // If cache is empty, trigger processing in the background (non-blocking)
            if (!cacheData.cached) {
              console.log(`[NBA Landing] 🔄 Cache is empty - triggering background processing...`);
              fetch('/api/nba/player-props/process?async=1', { method: 'POST' }).catch(err => {
                console.warn('[NBA Landing] ⚠️ Failed to trigger background processing:', err);
              });
            }
            return;
          }
        } else {
          console.warn(`[NBA Landing] Cache API error: ${cacheResponse.status} ${cacheResponse.statusText}`);
          setPlayerProps([]);
          setPropsLoading(false);
          return;
        }
      } catch (error) {
        console.error('[NBA Landing] Error fetching player props:', error);
        setPlayerProps([]);
        setPropsLoading(false);
      }
    };

    fetchPlayerProps();
    
    // Poll for odds updates and refresh player props when odds change
    // This ensures player props reflect new lines when odds refresh (every 30 mins)
    let lastOddsTimestamp: string | null = null;
    const checkOddsUpdate = async () => {
      try {
        // Check odds cache timestamp
        const oddsResponse = await fetch('/api/odds?check_timestamp=1', { cache: 'no-store' });
        if (oddsResponse.ok) {
          const oddsData = await oddsResponse.json();
          const currentTimestamp = oddsData.lastUpdated;
          
          if (currentTimestamp && currentTimestamp !== lastOddsTimestamp && lastOddsTimestamp !== null) {
            // Odds have been updated - clear sessionStorage and refresh player props
            console.log('[NBA Landing] 🔄 Odds updated, clearing cache and refreshing player props...');
            if (typeof window !== 'undefined') {
              try {
                sessionStorage.removeItem(CACHE_KEY);
                sessionStorage.removeItem(CACHE_TIMESTAMP_KEY);
                console.log('[NBA Landing] 🧹 Cleared player props sessionStorage due to odds update');
              } catch (e) {
                console.warn('[NBA Landing] ⚠️ Failed to clear sessionStorage:', e);
              }
            }
            fetchPlayerProps();
          }
          
          lastOddsTimestamp = currentTimestamp;
        }
      } catch (err) {
        // Ignore errors - this is a background check
      }
    };
    
    // Check every 2 minutes for odds updates
    const oddsCheckInterval = setInterval(checkOddsUpdate, 2 * 60 * 1000);
    
    // Initial check after 30 seconds (give odds refresh time to complete)
    setTimeout(() => {
      checkOddsUpdate();
    }, 30 * 1000);
    
    return () => {
      clearInterval(oddsCheckInterval);
    };
  }, []);

  // Note: getPlayerPosition and getDvpRating are no longer needed on client-side
  // Position and DvP are calculated server-side during processing and stored in cache
  const mapStatTypeToDvpMetric = (statType: string): string | null => {
    const mapping: Record<string, string> = {
      'PTS': 'pts',
      'REB': 'reb',
      'AST': 'ast',
      'STL': 'stl',
      'BLK': 'blk',
      'THREES': 'fg3m',
      'FG3M': 'fg3m',
      'FG_PCT': 'fg_pct',
      'TO': 'to',
      // Combined stats - will be calculated from component stats
      'PRA': 'pra',  // Points + Rebounds + Assists
      'PA': 'pa',    // Points + Assists
      'PR': 'pr',    // Points + Rebounds
      'RA': 'ra',    // Rebounds + Assists
    };
    const upperStat = statType.toUpperCase();
    const metric = mapping[upperStat] || null;
    if (!metric) {
      console.warn(`[mapStatTypeToDvpMetric] No mapping for statType: ${statType} (${upperStat})`);
    }
    return metric;
  };

  // Helper function to fetch DvP rank and stat value
  const getDvpRating = async (
    opponent: string,
    position: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null,
    statType: string
  ): Promise<{ rank: number | null; statValue: number | null }> => {
    if (!opponent) {
      console.warn(`[getDvpRating] No opponent provided for ${statType}`);
      return { rank: null, statValue: null };
    }
    if (!position) {
      console.warn(`[getDvpRating] No position provided for ${opponent} ${statType}`);
      return { rank: null, statValue: null };
    }
    
    const metric = mapStatTypeToDvpMetric(statType);
    if (!metric) {
      console.warn(`[getDvpRating] No metric mapping for statType: ${statType}`);
      return { rank: null, statValue: null };
    }
    
    try {
      // Opponent might already be an abbreviation, but try both
      let teamAbbr = opponent;
      if (TEAM_FULL_TO_ABBR[opponent]) {
        teamAbbr = TEAM_FULL_TO_ABBR[opponent];
      } else {
        // If it's not in the mapping, assume it's already an abbreviation
        teamAbbr = opponent.toUpperCase().trim();
      }
      
      // Fetch rank instead of perGame value (API uses 'pos' parameter)
      const url = `/api/dvp/rank?pos=${position}&metric=${metric}`;
          console.log(`[getDvpRating] Fetching rank: ${url} (opponent: "${opponent}" -> teamAbbr: "${teamAbbr}")`);
      
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn(`[getDvpRating] Rank API not ok: ${response.status} for ${url}`, errorText);
        return { rank: null, statValue: null };
      }
      
      const data = await response.json();
      console.log(`[getDvpRating] Rank response for ${opponent} (${teamAbbr}) ${position} ${statType}:`, data);
      
      if (!data.success) {
        console.warn(`[getDvpRating] Rank API returned success: false`, data);
        return { rank: null, statValue: null };
      }
      
      // Extract rank for this team from the ranks object
      const ranks = data.ranks || {};
      // Try both the teamAbbr and normalized versions
      const normalizedTeamAbbr = teamAbbr.toUpperCase().trim();
      let rank = ranks[normalizedTeamAbbr] ?? ranks[teamAbbr];
      
      // If still not found, try all variations
      if (rank === null || rank === undefined) {
        const allKeys = Object.keys(ranks);
        const matchingKey = allKeys.find(k => k.toUpperCase() === normalizedTeamAbbr || normalizedTeamAbbr.includes(k.toUpperCase()) || k.toUpperCase().includes(normalizedTeamAbbr));
        if (matchingKey) {
          rank = ranks[matchingKey];
        }
      }
      
      // Extract stat value for this team from the values array
      const values = data.values || [];
      const normalizedTeamAbbrLower = normalizedTeamAbbr.toLowerCase();
      let statValue: number | null = null;
      const teamValue = values.find((v: any) => {
        const vTeam = String(v.team || '').toUpperCase().trim();
        return vTeam === normalizedTeamAbbr || normalizedTeamAbbr === vTeam;
      });
      
      if (teamValue && teamValue.value !== null && teamValue.value !== undefined) {
        statValue = typeof teamValue.value === 'number' ? teamValue.value : parseFloat(String(teamValue.value));
        if (statValue !== null && isNaN(statValue)) statValue = null;
      }
      
      if (rank === null || rank === undefined) {
        console.warn(`[getDvpRating] No rank value for ${teamAbbr} in response. Available teams:`, Object.keys(ranks).slice(0, 5));
        return { rank: null, statValue };
      }
      
      const rankValue = typeof rank === 'number' ? rank : parseInt(String(rank), 10);
      if (isNaN(rankValue) || rankValue <= 0) {
        console.warn(`[getDvpRating] Invalid rank value: ${rank} for ${teamAbbr}`);
        return { rank: null, statValue };
      }
      
      console.log(`[getDvpRating] ✅ Extracted rank: ${rankValue}, statValue: ${statValue} for ${opponent} (${teamAbbr}) ${position} ${statType}`);
      return { rank: rankValue, statValue };
    } catch (error) {
      console.error(`[getDvpRating] Error for ${opponent} ${position} ${statType}:`, error);
      return { rank: null, statValue: null };
    }
  };

// Debug helpers
const DEBUG_H2H_PLAYER = (process.env.NEXT_PUBLIC_DEBUG_H2H_PLAYER || '').toLowerCase().trim();

// Simple in-memory cache to reduce duplicate /api/stats calls per player/season/postseason
const playerStatsCache = new Map<string, any[]>();
const playerStatsPromiseCache = new Map<string, Promise<any[]>>();

// Calculate L5, L10, H2H averages and hit rates
  const calculatePlayerAverages = async (
    playerName: string, 
    statType: string, 
    opponent: string, 
    playerTeam?: string,
    line?: number
  ): Promise<{ 
    last5: number | null; 
    last10: number | null; 
    h2h: number | null;
    last5HitRate: { hits: number; total: number } | null;
    last10HitRate: { hits: number; total: number } | null;
    h2hHitRate: { hits: number; total: number } | null;
    seasonAvg: number | null;
    seasonHitRate: { hits: number; total: number } | null;
    streak: number | null;
  }> => {
    try {
      const shouldDebugH2H = !DEBUG_H2H_PLAYER || playerName.toLowerCase() === DEBUG_H2H_PLAYER;
      const playerId = getPlayerIdFromName(playerName);
      if (!playerId) {
        console.warn(`[calculatePlayerAverages] No player ID found for: ${playerName}`);
        return { 
          last5: null, 
          last10: null, 
          h2h: null,
          last5HitRate: null,
          last10HitRate: null,
          h2hHitRate: null,
          seasonAvg: null,
          seasonHitRate: null,
          streak: null
        };
      }

      const currentSeason = currentNbaSeason();
      
      // Fetch stats per season - fetch both regular and playoffs in parallel
      // This reduces from 4 requests to 2 requests per player (2 seasons x 2 parallel fetches each)
      const grabSeason = async (yr: number, retries = 2): Promise<any[]> => {
        const cacheKey = `${playerId}-${yr}-all`;

        // Return cached data if available
        if (playerStatsCache.has(cacheKey)) {
          return playerStatsCache.get(cacheKey)!;
        }
        // If a fetch is already in flight, await it
        if (playerStatsPromiseCache.has(cacheKey)) {
          return playerStatsPromiseCache.get(cacheKey)!;
        }

        const fetchSingle = async (postseason: boolean, suffix: string): Promise<any[]> => {
          // Use queued fetch to prevent rate limiting
          const { queuedFetch } = await import('@/lib/requestQueue');
          const singleCacheKey = `${playerId}-${yr}-${postseason ? 'po' : 'reg'}`;
          
          // Return cached data if available
          if (playerStatsCache.has(singleCacheKey)) {
            return playerStatsCache.get(singleCacheKey)!;
          }
          
          for (let attempt = 0; attempt <= retries; attempt++) {
            try {
              const url = `/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=3&postseason=${postseason}`;
              const requestId = `stats-${playerId}-${yr}-${suffix}`;
              console.log(`[calculatePlayerAverages] Fetching ${suffix}: ${url} (attempt ${attempt + 1}/${retries + 1})`);
              const r = await queuedFetch(url, {}, requestId);
            
              // Try to parse response even on 429 - API might return cached data
              let j: any = {};
              try {
                j = await r.json();
              } catch (e) {
                const text = await r.text().catch(() => '');
                console.warn(`[calculatePlayerAverages] Failed to parse response for ${playerId}, season ${yr}, ${suffix}:`, text);
              }
              
              // Check if we got cached data even on 429
              const data = Array.isArray(j?.data) ? j.data : [];
              if (data.length > 0) {
                console.log(`[calculatePlayerAverages] Got ${data.length} stats (${r.status === 429 ? 'cached' : 'fresh'}) for ${playerName} (${playerId}), season ${yr}, ${suffix}`);
                playerStatsCache.set(singleCacheKey, data);
                return data;
              }
              
              if (r.status === 429) {
                if (attempt < retries) {
                  const waitTime = (attempt + 1) * 2000;
                  console.log(`[calculatePlayerAverages] Rate limited, waiting ${waitTime}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, waitTime));
                  continue;
                }
                console.warn(`[calculatePlayerAverages] Rate limited for ${playerId}, season ${yr}, ${suffix} - no cached data available`);
                return [];
              }
              if (!r.ok) {
                console.warn(`[calculatePlayerAverages] API error ${r.status} for ${playerId}, season ${yr}, ${suffix}`);
                return [];
              }
              
              return data;
            } catch (error: any) {
              // If queuedFetch threw a 429 error, try to extract cached data from error.response
              if (error?.status === 429 && error?.response) {
                try {
                  const j = await error.response.json();
                  const data = Array.isArray(j?.data) ? j.data : [];
                  if (data.length > 0) {
                    console.log(`[calculatePlayerAverages] Got ${data.length} cached stats from 429 error for ${playerName} (${playerId}), season ${yr}, ${suffix}`);
                    playerStatsCache.set(singleCacheKey, data);
                    return data;
                  }
                } catch (parseError) {
                  // Failed to parse error response, continue to retry logic
                }
              }
              
              if (attempt < retries) {
                const waitTime = (attempt + 1) * 1000;
                console.log(`[calculatePlayerAverages] Error on attempt ${attempt + 1}, retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
              }
              console.error(`[calculatePlayerAverages] Error fetching stats for ${playerId}, ${suffix}:`, error);
              return [];
            }
          }
          return [];
        };

        // Fetch regular first, then playoffs sequentially to avoid rate limiting
        // Even with RequestQueue limiting to 1 concurrent, sequential is safer
        const fetchPromise = (async () => {
          const regular = await fetchSingle(false, 'reg');
          // Small delay between regular and postseason to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 300));
          const playoffs = await fetchSingle(true, 'po');
          const combined = [...regular, ...playoffs];
          // Cache the combined result
          playerStatsCache.set(cacheKey, combined);
          return combined;
        })();

        playerStatsPromiseCache.set(cacheKey, fetchPromise);
        try {
          const result = await fetchPromise;
          return result;
        } finally {
          playerStatsPromiseCache.delete(cacheKey);
        }
      };

      // Fetch stats per season - fetch both regular and playoffs in parallel
      // This reduces from 4 requests to 2 requests per player (2 seasons x 2 parallel fetches each)
      const currSeason = await grabSeason(currentSeason);        // current season (2025/2026) - regular + playoffs in parallel
      await new Promise(resolve => setTimeout(resolve, 100));
      const prev1Season = await grabSeason(currentSeason - 1);    // previous season (2024/2025) - regular + playoffs in parallel

      // Merge all data and filter (like dashboard does)
      const allStats = [...currSeason, ...prev1Season];
      console.log(`[calculatePlayerAverages] Merged stats for ${playerName}:`, {
        currSeason: currSeason.length,
        prev1Season: prev1Season.length,
        total: allStats.length,
      });
      
      const validStats = allStats.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
      console.log(`[calculatePlayerAverages] Valid stats after filter: ${validStats.length} out of ${allStats.length}`);
      
      // CRITICAL: Deduplicate by game ID first (regular/postseason might have duplicates)
      const uniqueStatsMap = new Map();
      for (const stat of validStats) {
        const gameId = stat?.game?.id;
        if (gameId) {
          // Keep the first occurrence (or you could keep the one with more data)
          if (!uniqueStatsMap.has(gameId)) {
            uniqueStatsMap.set(gameId, stat);
          }
        } else {
          // If no game ID, keep it (shouldn't happen but just in case)
          uniqueStatsMap.set(`no-id-${uniqueStatsMap.size}`, stat);
        }
      }
      const uniqueStats = Array.from(uniqueStatsMap.values());
      console.log(`[calculatePlayerAverages] Deduplicated: ${validStats.length} → ${uniqueStats.length} unique games`);
      
      // Sort by date (newest first) - same as dashboard
      uniqueStats.sort((a, b) => {
        const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
        const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
        return db - da; // newest first
      });
      
      if (uniqueStats.length === 0) {
        console.warn(`[calculatePlayerAverages] No valid stats for ${playerName} (${playerId})`, {
          allStatsLength: allStats.length,
          sampleStat: allStats[0],
          hasGame: !!allStats[0]?.game,
          hasGameDate: !!allStats[0]?.game?.date,
          hasTeam: !!allStats[0]?.team,
        });
        return { 
          last5: null, 
          last10: null, 
          h2h: null,
          last5HitRate: null,
          last10HitRate: null,
          h2hHitRate: null,
          seasonAvg: null,
          seasonHitRate: null,
          streak: null
        };
      }

      const getStatValue = (game: any, stat: string): number => {
        // Handle combined stats (PRA, PA, PR, RA)
        if (stat === 'PRA') {
          return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.reb || 0) || 0) + (parseFloat(game.ast || 0) || 0);
        }
        if (stat === 'PA') {
          return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.ast || 0) || 0);
        }
        if (stat === 'PR') {
          return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.reb || 0) || 0);
        }
        if (stat === 'RA') {
          return (parseFloat(game.reb || 0) || 0) + (parseFloat(game.ast || 0) || 0);
        }
        
        const statMap: Record<string, string> = {
          'PTS': 'pts',
          'REB': 'reb',
          'AST': 'ast',
          'STL': 'stl',
          'BLK': 'blk',
          'THREES': 'fg3m',
        };
        const key = statMap[stat] || stat.toLowerCase();
        const rawValue = game[key];
        // Handle null, undefined, or empty string explicitly
        if (rawValue === null || rawValue === undefined || rawValue === '') {
          return 0;
        }
        const parsed = parseFloat(rawValue);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      // Helper function to parse minutes (same as dashboard)
      const parseMinutes = (minVal: any): number => {
        if (typeof minVal === 'number') return minVal;
        if (!minVal) return 0;
        const str = String(minVal);
        const match = str.match(/(\d+):(\d+)/);
        if (match) {
          return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
        }
        return parseFloat(str) || 0;
      };

      // CRITICAL: Filter out ALL games with 0 minutes FIRST, then get stat values
      // Then RE-SORT to ensure newest-first order (filtering might affect order)
      const gamesWithMinutes = uniqueStats.filter((stats: any) => {
        const minutes = parseMinutes(stats.min);
        // STRICT: Only include games where player actually played (minutes > 0)
        return minutes > 0;
      });
      
      console.log(`[calculatePlayerAverages] ${playerName} ${statType}: ${gamesWithMinutes.length} games with minutes > 0`);
      
      // Log sample stat structure to debug stat extraction
      if (gamesWithMinutes.length > 0) {
        const sample = gamesWithMinutes[0];
        console.log(`[calculatePlayerAverages] ${playerName} ${statType} sample stat:`, {
          hasPts: sample.pts !== undefined && sample.pts !== null,
          hasReb: sample.reb !== undefined && sample.reb !== null,
          hasAst: sample.ast !== undefined && sample.ast !== null,
          hasStl: sample.stl !== undefined && sample.stl !== null,
          hasBlk: sample.blk !== undefined && sample.blk !== null,
          hasFg3m: sample.fg3m !== undefined && sample.fg3m !== null,
          pts: sample.pts,
          reb: sample.reb,
          ast: sample.ast,
          stl: sample.stl,
          blk: sample.blk,
          fg3m: sample.fg3m,
          statType,
          statMapKey: statType === 'PTS' ? 'pts' : statType === 'REB' ? 'reb' : statType === 'AST' ? 'ast' : statType === 'STL' ? 'stl' : statType === 'BLK' ? 'blk' : statType === 'THREES' ? 'fg3m' : statType.toLowerCase(),
        });
      }
      
      const gamesWithStats = gamesWithMinutes
        .map((stats: any) => {
          const statValue = getStatValue(stats, statType);
          return {
            ...stats,
            statValue,
          };
        })
        .filter((stats: any) => {
          // Only include games with valid (finite) stat values
          // Note: 0 is a valid stat value (player had 0 points/rebounds/etc), so we keep it
          const isValid = Number.isFinite(stats.statValue);
          if (!isValid) {
            console.warn(`[calculatePlayerAverages] Invalid stat value for ${playerName} ${statType}:`, {
              statValue: stats.statValue,
              gameDate: stats?.game?.date,
              rawStat: stats[statType.toLowerCase()] || stats[statType] || 'missing',
              allStatKeys: Object.keys(stats),
            });
          }
          return isValid;
        })
        .sort((a, b) => {
          // RE-SORT by date to ensure newest-first (critical for L5/L10)
          const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
          const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
          return dateB - dateA; // Newest first
        });
      
      console.log(`[calculatePlayerAverages] ${playerName} ${statType}: ${gamesWithStats.length} games with valid stat values (from ${gamesWithMinutes.length} games with minutes)`);

      if (gamesWithStats.length === 0) {
        return { 
          last5: null, 
          last10: null, 
          h2h: null,
          last5HitRate: null,
          last10HitRate: null,
          h2hHitRate: null,
          seasonAvg: null,
          seasonHitRate: null,
          streak: null,
        };
      }

      // Season average: Calculate average from all games in gamesWithStats
      const seasonValues = gamesWithStats.map((g: any) => g.statValue);
      const seasonSum = seasonValues.reduce((sum: number, val: number) => sum + val, 0);
      const seasonAvg = seasonValues.length > 0 ? seasonSum / seasonValues.length : null;
      
      // Calculate season hit rate (how many times hit over the line)
      let seasonHitRate: { hits: number; total: number } | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && seasonValues.length > 0) {
        const hits = seasonValues.filter((val: number) => val > line).length;
        seasonHitRate = { hits, total: seasonValues.length };
      }

      // Last 5 average: Take first 5 games (newest) from gamesWithStats, calculate average
      const last5Games = gamesWithStats.slice(0, 5);
      const last5Values = last5Games.map((g: any) => g.statValue);
      const last5Sum = last5Values.reduce((sum: number, val: number) => sum + val, 0);
      const last5Avg = last5Values.length > 0 ? last5Sum / last5Values.length : null;
      
      // Calculate last 5 hit rate (how many times hit over the line)
      let last5HitRate: { hits: number; total: number } | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && last5Values.length > 0) {
        const hits = last5Values.filter((val: number) => val > line).length;
        last5HitRate = { hits, total: last5Values.length };
      }
      
      console.log(`[calculatePlayerAverages] ${playerName} ${statType} L5:`, {
        totalGames: gamesWithStats.length,
        last5Games: last5Games.length,
        last5Values,
        last5Sum,
        last5Avg: last5Avg?.toFixed(2),
        dates: last5Games.map((g: any) => g.game?.date),
        minutes: last5Games.map((g: any) => g.min),
        opponents: last5Games.map((g: any) => {
          const home = g.game?.home_team?.abbreviation;
          const visitor = g.game?.visitor_team?.abbreviation;
          const playerTeam = g.team?.abbreviation;
          return { home, visitor, playerTeam };
        }),
      });

      // Last 10 average: Take first 10 games (newest) from gamesWithStats, calculate average
      const last10Games = gamesWithStats.slice(0, 10);
      const last10Values = last10Games.map((g: any) => g.statValue);
      const last10Sum = last10Values.reduce((sum: number, val: number) => sum + val, 0);
      const last10Avg = last10Values.length > 0 ? last10Sum / last10Values.length : null;
      
      // Calculate last 10 hit rate (how many times hit over the line)
      let last10HitRate: { hits: number; total: number } | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && last10Values.length > 0) {
        const hits = last10Values.filter((val: number) => val > line).length;
        last10HitRate = { hits, total: last10Values.length };
      }
      
      console.log(`[calculatePlayerAverages] ${playerName} ${statType} L10:`, {
        totalGames: gamesWithStats.length,
        last10Games: last10Games.length,
        last10Values,
        last10Sum,
        last10Avg: last10Avg?.toFixed(2),
        dates: last10Games.map((g: any) => g.game?.date),
        minutes: last10Games.map((g: any) => g.min),
      });

      // H2H average - COPY EXACT LOGIC FROM DASHBOARD (lines 9634-9669)
      let h2hAvg: number | null = null;
      let h2hStats: number[] = [];
      let normalizedOpponent: string | null = null;
      if (opponent && opponent !== 'ALL' && opponent !== 'N/A' && opponent !== '') {
        // Use EXACT same normalizeAbbr function as dashboard
        const normalizeAbbr = (abbr: string): string => {
          if (!abbr) return '';
          return abbr.toUpperCase().trim();
        };
        
        // Determine correct opponent: if player's actual team matches provided opponent, they're swapped
        let correctOpponent = opponent;
        if (gamesWithStats.length > 0 && playerTeam) {
          const playerActualTeam = gamesWithStats[0]?.team?.abbreviation || "";
          const playerActualTeamNorm = normalizeAbbr(playerActualTeam);
          const providedTeamNorm = normalizeAbbr(TEAM_FULL_TO_ABBR[playerTeam] || playerTeam);
          const providedOpponentNorm = normalizeAbbr(TEAM_FULL_TO_ABBR[opponent] || opponent);
          
          // If player's actual team matches the provided opponent, they're swapped
          if (playerActualTeamNorm === providedOpponentNorm) {
            // Player is on the "opponent" team, so the real opponent is the "team"
            correctOpponent = playerTeam;
          }
        }
        
        // Normalize opponent - handle both abbreviations and full names
        // Try TEAM_FULL_TO_ABBR first (if it's a full name), otherwise use as-is (if it's already an abbreviation)
        normalizedOpponent = normalizeAbbr(TEAM_FULL_TO_ABBR[correctOpponent] || correctOpponent);
        
        // Debug: log opponent normalization
        if (shouldDebugH2H && process.env.NODE_ENV !== 'production') {
          console.log(`[calculatePlayerAverages][H2H Normalization] ${playerName} ${statType}:`, {
            originalOpponent: opponent,
            correctOpponent,
            normalizedOpponent,
            playerTeam,
            teamFullToAbbrLookup: TEAM_FULL_TO_ABBR[correctOpponent],
          });
        }
        
        // EXACT COPY FROM DASHBOARD (lines 9638-9669) - just filter, no corrections
        h2hStats = gamesWithStats
          .filter((stats: any) => {
            // EXACT COPY: stats?.team?.abbreviation || selectedPlayer?.teamAbbr || ""
            // Use playerTeam parameter as fallback (like dashboard uses selectedPlayer?.teamAbbr)
            const playerTeamFromStats = stats?.team?.abbreviation || (playerTeam ? (TEAM_FULL_TO_ABBR[playerTeam] || playerTeam) : "") || "";
            const playerTeamNorm = normalizeAbbr(playerTeamFromStats);
            
            // Get opponent from game data (EXACT COPY FROM DASHBOARD)
            const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
            const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
            const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
            const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
            
            // Determine opponent using team IDs/abbrs (EXACT COPY FROM DASHBOARD)
            const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
            let gameOpponent = "";
            
            if (playerTeamId && homeTeamId && visitorTeamId) {
              if (playerTeamId === homeTeamId && visitorTeamAbbr) {
                gameOpponent = normalizeAbbr(visitorTeamAbbr);
              } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
                gameOpponent = normalizeAbbr(homeTeamAbbr);
              }
            }
            
            // Fallback: compare abbreviations directly if IDs missing (EXACT COPY FROM DASHBOARD)
            if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
              const homeNorm = normalizeAbbr(homeTeamAbbr);
              const awayNorm = normalizeAbbr(visitorTeamAbbr);
              if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
              else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
            }
            
            return gameOpponent === normalizedOpponent;
          })
          .slice(0, 6) // Limit to last 6 H2H games (same as dashboard)
          .map((s: any) => s.statValue);

        // Fallback: if no H2H stats found (e.g., team mapping edge cases), include any game where either side matches the opponent abbr
        if (h2hStats.length === 0 && normalizedOpponent) {
          const fallbackStats = gamesWithStats
            .filter((stats: any) => {
              const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
              const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
              const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
              const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
              const homeNorm = normalizeAbbr(homeTeamAbbr || '');
              const awayNorm = normalizeAbbr(visitorTeamAbbr || '');
              return homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
            })
            .slice(0, 6)
            .map((s: any) => s.statValue);
          
          if (fallbackStats.length > 0) {
            h2hStats = fallbackStats;
            console.log('[calculatePlayerAverages][H2H Fallback] Used fallback games', {
              playerName,
              statType,
              line,
              opponent,
              normalizedOpponent,
              fallbackCount: fallbackStats.length,
            });
          }
        }
        
        h2hAvg = h2hStats.length > 0
          ? h2hStats.reduce((sum: number, val: number) => sum + val, 0) / h2hStats.length
          : null;
        
        // Debug: log H2H calculation result
        if (shouldDebugH2H && process.env.NODE_ENV !== 'production') {
          console.log(`[calculatePlayerAverages][H2H Result] ${playerName} ${statType} vs ${opponent}:`, {
            normalizedOpponent,
            playerTeam,
            h2hStatsCount: h2hStats.length,
            h2hAvg: h2hAvg?.toFixed(2),
            totalGamesAvailable: gamesWithStats.length,
            sampleOpponents: gamesWithStats.slice(0, 5).map((g: any) => {
              const homeTeamId = g?.game?.home_team?.id ?? (g?.game as any)?.home_team_id;
              const visitorTeamId = g?.game?.visitor_team?.id ?? (g?.game as any)?.visitor_team_id;
              const homeTeamAbbr = g?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
              const visitorTeamAbbr = g?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
              const pt = g?.team?.abbreviation || (playerTeam ? (TEAM_FULL_TO_ABBR[playerTeam] || playerTeam) : "");
              const ptNorm = normalizeAbbr(pt);
              const ptId = ABBR_TO_TEAM_ID[ptNorm];
              let opp = "";
              if (ptId && homeTeamId && visitorTeamId) {
                if (ptId === homeTeamId && visitorTeamAbbr) opp = normalizeAbbr(visitorTeamAbbr);
                else if (ptId === visitorTeamId && homeTeamAbbr) opp = normalizeAbbr(homeTeamAbbr);
              }
              if (!opp && homeTeamAbbr && visitorTeamAbbr) {
                const hNorm = normalizeAbbr(homeTeamAbbr);
                const vNorm = normalizeAbbr(visitorTeamAbbr);
                if (ptNorm === hNorm) opp = vNorm;
                else if (ptNorm === vNorm) opp = hNorm;
              }
              return { date: g?.game?.date, playerTeam: ptNorm, opponent: opp, home: homeTeamAbbr, visitor: visitorTeamAbbr };
            }),
          });
        }
      }
      
      // Calculate H2H hit rate (how many times hit over the line)
      let h2hHitRate: { hits: number; total: number } | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && h2hStats && h2hStats.length > 0) {
        const hits = h2hStats.filter((val: number) => val > line).length;
        h2hHitRate = { hits, total: h2hStats.length };
      }

      // Debug when H2H is missing
      if (shouldDebugH2H && (!h2hStats || h2hStats.length === 0 || h2hAvg === null) && process.env.NODE_ENV !== 'production') {
        const normalizeAbbrLocal = (abbr: string): string => (abbr || '').toUpperCase().trim();
        const opponentCounts: Record<string, number> = {};
        const fullOpponentCounts: Record<string, number> = {};

        // Build full opponent counts across all gamesWithStats
        for (const g of gamesWithStats) {
          const homeTeamId = g?.game?.home_team?.id ?? (g?.game as any)?.home_team_id;
          const visitorTeamId = g?.game?.visitor_team?.id ?? (g?.game as any)?.visitor_team_id;
          const homeTeamAbbr = g?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = g?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          const homeNorm = normalizeAbbrLocal(homeTeamAbbr || '');
          const awayNorm = normalizeAbbrLocal(visitorTeamAbbr || '');
          const playerTeamFromStats = g?.team?.abbreviation || '';
          const playerTeamNorm = normalizeAbbrLocal(playerTeamFromStats);

          const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
          let gameOpponent = '';
          if (playerTeamId && homeTeamId && visitorTeamId) {
            if (playerTeamId === homeTeamId && visitorTeamAbbr) {
              gameOpponent = normalizeAbbrLocal(visitorTeamAbbr);
            } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
              gameOpponent = normalizeAbbrLocal(homeTeamAbbr);
            }
          }
          if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
            if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
            else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
          }

          const key = gameOpponent || 'unknown';
          fullOpponentCounts[key] = (fullOpponentCounts[key] || 0) + 1;
        }

        const sampleGames = gamesWithStats.slice(0, 6).map((g: any) => {
          const homeTeamId = g?.game?.home_team?.id ?? (g?.game as any)?.home_team_id;
          const visitorTeamId = g?.game?.visitor_team?.id ?? (g?.game as any)?.visitor_team_id;
          const homeTeamAbbr = g?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = g?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          const homeNorm = normalizeAbbrLocal(homeTeamAbbr || '');
          const awayNorm = normalizeAbbrLocal(visitorTeamAbbr || '');
          const playerTeamFromStats = g?.team?.abbreviation || '';
          const playerTeamNorm = normalizeAbbrLocal(playerTeamFromStats);

          // Derive the opponent the player faced in this game (same logic as the main filter)
          const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
          let gameOpponent = '';
          if (playerTeamId && homeTeamId && visitorTeamId) {
            if (playerTeamId === homeTeamId && visitorTeamAbbr) {
              gameOpponent = normalizeAbbrLocal(visitorTeamAbbr);
            } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
              gameOpponent = normalizeAbbrLocal(homeTeamAbbr);
            }
          }
          if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
            if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
            else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
          }

          const key = gameOpponent || 'unknown';
          opponentCounts[key] = (opponentCounts[key] || 0) + 1;

          return {
            date: g?.game?.date,
            home: homeTeamAbbr,
            visitor: visitorTeamAbbr,
            playerTeam: playerTeamFromStats,
            derivedOpponent: gameOpponent || null,
            statValue: g?.statValue,
          };
        });

        console.warn('[calculatePlayerAverages][H2H Missing]', {
          playerName,
          statType,
          opponent,
          playerTeam,
          line,
          normalizedOpponent,
          gamesWithStatsCount: gamesWithStats.length,
          h2hStatsCount: h2hStats?.length || 0,
          sampleGame: gamesWithStats[0]?.game || null,
          opponentCounts,
          fullOpponentCounts,
          sampleGames,
        });
      }

      // Calculate streak: consecutive games over the line (starting from most recent)
      let streak: number | null = null;
      if (line !== undefined && line !== null && Number.isFinite(line) && gamesWithStats.length > 0) {
        streak = 0;
        // Games are already sorted newest first, so iterate from start
        for (const game of gamesWithStats) {
          if (game.statValue > line) {
            streak++;
          } else {
            // Once we hit a game that didn't go over, stop counting
            break;
          }
        }
      }

      const result = {
        last5: last5Avg,
        last10: last10Avg,
        h2h: h2hAvg,
        last5HitRate,
        last10HitRate,
        h2hHitRate,
        seasonAvg,
        seasonHitRate,
        streak,
      };
      
      console.log(`[calculatePlayerAverages] ${playerName} (${statType}):`, {
        totalGames: gamesWithStats.length,
        last5: last5Avg?.toFixed(1),
        last10: last10Avg?.toFixed(1),
        h2h: h2hAvg?.toFixed(1),
        last5HitRate: last5HitRate ? `${last5HitRate.hits}/${last5HitRate.total}` : null,
        last10HitRate: last10HitRate ? `${last10HitRate.hits}/${last10HitRate.total}` : null,
        h2hHitRate: h2hHitRate ? `${h2hHitRate.hits}/${h2hHitRate.total}` : null,
        opponent,
      });
      
      return result;
    } catch (error) {
      console.error(`[calculatePlayerAverages] Error for ${playerName} (${statType}):`, error);
      return { 
        last5: null, 
        last10: null, 
        h2h: null,
        last5HitRate: null,
        last10HitRate: null,
        h2hHitRate: null,
        seasonAvg: null,
        seasonHitRate: null,
        streak: null,
      };
    }
  };


  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/nba/research/dashboard?player=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return 'TBD';
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    } catch {
      return 'TBD';
    }
  };

  const getStatLabel = (statType: string) => {
    const labels: Record<string, string> = {
      'PTS': 'Points',
      'REB': 'Rebounds',
      'AST': 'Assists',
      'STL': 'Steals',
      'BLK': 'Blocks',
      'THREES': '3-Pointers',
      'FG3M': '3-Pointers',
      'PRA': 'Points + Rebounds + Assists',
      'PR': 'Points + Rebounds',
      'RA': 'Rebounds + Assists',
    };
    return labels[statType] || statType;
  };

  // Extract unique bookmakers and prop types from playerProps
  const availableBookmakers = useMemo(() => {
    const bookmakers = new Set<string>();
    playerProps.forEach(prop => {
      if (prop.bookmakerLines && prop.bookmakerLines.length > 0) {
        prop.bookmakerLines.forEach(line => {
          if (line.bookmaker) {
            bookmakers.add(line.bookmaker);
          }
        });
      }
      // Also include the main bookmaker
      if (prop.bookmaker) {
        bookmakers.add(prop.bookmaker);
      }
    });
    return Array.from(bookmakers).sort();
  }, [playerProps]);

  const availablePropTypes = useMemo(() => {
    const types = new Set<string>();
    playerProps.forEach(prop => {
      if (prop.statType) {
        types.add(prop.statType);
      }
    });
    return Array.from(types).sort();
  }, [playerProps]);

  // Save filters to localStorage helper (defined before useEffects)
  const saveFiltersToStorage = (bookmakers: Set<string>, propTypes: Set<string>, games: Set<number>) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('nba_filters_bookmakers', JSON.stringify(Array.from(bookmakers)));
      localStorage.setItem('nba_filters_propTypes', JSON.stringify(Array.from(propTypes)));
      localStorage.setItem('nba_filters_games', JSON.stringify(Array.from(games)));
    } catch (e) {
      console.warn('[NBA Landing] Failed to save filters to localStorage:', e);
    }
  };

  // Initialize selected filters when data loads (only if localStorage is empty)
  useEffect(() => {
    if (availableBookmakers.length > 0 && selectedBookmakers.size === 0) {
      // Only set defaults if localStorage was empty (no saved filters)
      const savedBookmakers = typeof window !== 'undefined' ? localStorage.getItem('nba_filters_bookmakers') : null;
      if (!savedBookmakers) {
        // Exclude Betway from default selection (still fetched, just unchecked by default)
        const defaultBookmakers = availableBookmakers.filter(bm => 
          bm.toLowerCase() !== 'betway'
        );
        const newSet = new Set(defaultBookmakers);
        setSelectedBookmakers(newSet);
        saveFiltersToStorage(newSet, selectedPropTypes, selectedGames);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableBookmakers]);

  useEffect(() => {
    if (availablePropTypes.length > 0 && selectedPropTypes.size === 0) {
      // Only set defaults if localStorage was empty (no saved filters)
      const savedPropTypes = typeof window !== 'undefined' ? localStorage.getItem('nba_filters_propTypes') : null;
      if (!savedPropTypes) {
        const newSet = new Set(availablePropTypes);
        setSelectedPropTypes(newSet);
        saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePropTypes]);

  useEffect(() => {
    if (todaysGames.length > 0 && selectedGames.size === 0) {
      // Only set defaults if localStorage was empty (no saved filters)
      const savedGames = typeof window !== 'undefined' ? localStorage.getItem('nba_filters_games') : null;
      if (!savedGames) {
        const newSet = new Set(todaysGames.map(game => game.id));
        setSelectedGames(newSet);
        saveFiltersToStorage(selectedBookmakers, selectedPropTypes, newSet);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaysGames]);

  // Reset pagination when filtered props change
  useEffect(() => {
    setCurrentPage(1);
  }, [playerProps, searchQuery, selectedBookmakers, selectedPropTypes, selectedGames, propLineSort]);

  // Helper to match a prop to a game based on team/opponent
  const getGameForProp = (prop: PlayerProp): Game | null => {
    if (todaysGames.length === 0) {
      return null;
    }
    
    // Normalize team names to abbreviations - handle both full names and abbreviations
    const normalizeTeam = (team: string): string => {
      if (!team) return '';
      const upper = team.toUpperCase().trim();
      // Check if it's already an abbreviation (3 letters or less)
      if (upper.length <= 3) return upper;
      // Try to find abbreviation from full name
      const abbr = TEAM_FULL_TO_ABBR[upper] || TEAM_FULL_TO_ABBR[team] || null;
      return abbr ? abbr.toUpperCase() : upper;
    };
    
    const propTeam = normalizeTeam(prop.team || '');
    const propOpponent = normalizeTeam(prop.opponent || '');
    
    if (!propTeam || !propOpponent) {
      return null;
    }
    
    const matchedGame = todaysGames.find(game => {
      const homeTeam = game.home_team?.abbreviation?.toUpperCase() || '';
      const awayTeam = game.visitor_team?.abbreviation?.toUpperCase() || '';
      
      if (!homeTeam || !awayTeam) return false;
      
      // Check if prop's team and opponent match this game's teams (either direction)
      const match = (propTeam === homeTeam && propOpponent === awayTeam) ||
             (propTeam === awayTeam && propOpponent === homeTeam);
      
      return match;
    });
    
    if (!matchedGame && propTeam && propOpponent) {
      // Debug: log first few mismatches per unique prop team/opponent combo
      const debugKey = `${propTeam}-${propOpponent}`;
      if (!(window as any).__gameMatchDebug) {
        (window as any).__gameMatchDebug = new Set();
      }
      if (!(window as any).__gameMatchDebug.has(debugKey)) {
        (window as any).__gameMatchDebug.add(debugKey);
        console.log('[getGameForProp] No game match found:', {
          propTeam: prop.team,
          propOpponent: prop.opponent,
          normalizedPropTeam: propTeam,
          normalizedPropOpponent: propOpponent,
          availableGames: todaysGames.slice(0, 3).map(g => ({
            home: g.home_team?.abbreviation,
            away: g.visitor_team?.abbreviation,
            date: g.date,
            status: g.status
          }))
        });
      }
    }
    
    return matchedGame || null;
  };

  // Filter player props based on search query and selected filters
  // Filter props based on search, bookmakers, prop types, and games
  const filteredPlayerProps = useMemo(() => {
    return playerProps.filter(prop => {
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const playerNameMatch = prop.playerName.toLowerCase().includes(query);
        const statTypeMatch = getStatLabel(prop.statType).toLowerCase().includes(query);
        if (!playerNameMatch && !statTypeMatch) {
          return false;
        }
      }

      // Prop type filter
      if (selectedPropTypes.size > 0 && !selectedPropTypes.has(prop.statType)) {
        return false;
      }

      // Bookmaker filter - check if prop has any bookmaker from selected list
      if (selectedBookmakers.size > 0) {
        const propBookmakers = new Set<string>();
        if (prop.bookmakerLines && prop.bookmakerLines.length > 0) {
          prop.bookmakerLines.forEach(line => {
            if (line.bookmaker) {
              propBookmakers.add(line.bookmaker);
            }
          });
        }
        if (prop.bookmaker) {
          propBookmakers.add(prop.bookmaker);
        }
        
        // Check if any of the prop's bookmakers are in the selected set
        const hasSelectedBookmaker = Array.from(propBookmakers).some(bm => selectedBookmakers.has(bm));
        if (!hasSelectedBookmaker) {
          return false;
        }
      }

      // Game filter - check if prop belongs to a selected game
      if (selectedGames.size > 0) {
        const game = getGameForProp(prop);
        if (!game || !selectedGames.has(game.id)) {
          return false;
        }
      }

      return true;
    });
  }, [playerProps, searchQuery, selectedBookmakers, selectedPropTypes, selectedGames, todaysGames, getStatLabel]);

  // Apply prop line sorting (highest/lowest)
  // IMPORTANT: Sort ALL playerProps first (across all pages), then filter
  // This ensures highest/lowest considers all props today, not just filtered ones
  const sortedPlayerProps = useMemo(() => {
    // If prop line sort is active, sort ALL props first, then filter
    if (propLineSort === 'high' || propLineSort === 'low') {
      // First, sort ALL playerProps by line
      let allPropsSorted = [...playerProps];
      if (propLineSort === 'high') {
        allPropsSorted.sort((a, b) => b.line - a.line);
      } else {
        allPropsSorted.sort((a, b) => a.line - b.line);
      }
      
      // Then apply filters to the sorted list
      return allPropsSorted.filter(prop => {
        // Search filter
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          const playerNameMatch = prop.playerName.toLowerCase().includes(query);
          const statTypeMatch = getStatLabel(prop.statType).toLowerCase().includes(query);
          if (!playerNameMatch && !statTypeMatch) {
            return false;
          }
        }

        // Prop type filter
        if (selectedPropTypes.size > 0 && !selectedPropTypes.has(prop.statType)) {
          return false;
        }

        // Bookmaker filter
        if (selectedBookmakers.size > 0) {
          const propBookmakers = new Set<string>();
          if (prop.bookmakerLines && prop.bookmakerLines.length > 0) {
            prop.bookmakerLines.forEach(line => {
              if (line.bookmaker) {
                propBookmakers.add(line.bookmaker);
              }
            });
          }
          if (prop.bookmaker) {
            propBookmakers.add(prop.bookmaker);
          }
          
          const hasSelectedBookmaker = Array.from(propBookmakers).some(bm => selectedBookmakers.has(bm));
          if (!hasSelectedBookmaker) {
            return false;
          }
        }

        // Game filter
        if (selectedGames.size > 0) {
          const game = getGameForProp(prop);
          if (!game || !selectedGames.has(game.id)) {
            return false;
          }
        }

        return true;
      });
    }
    
    // If no prop line sort, just return filtered props (will be sorted by L10% later)
    return filteredPlayerProps;
  }, [playerProps, propLineSort, filteredPlayerProps, searchQuery, selectedBookmakers, selectedPropTypes, selectedGames, todaysGames, getStatLabel, getGameForProp]);

  // Deduplicate: only one prop per player/statType on the main list
  const uniquePlayerProps = useMemo(() => {
    const seen = new Set<string>();
    const result: PlayerProp[] = [];
    for (const prop of sortedPlayerProps) {
      const key = `${prop.playerName}|${prop.statType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(prop);
    }
    return result;
  }, [sortedPlayerProps]);

  // Sort for display
  // - If prop line sort is active, keep the line-based order (already applied)
  // - If column sort is active, sort by that column
  // - Otherwise, sort by L10% (fallback to L5% then overall prob)
  const displaySortedProps = useMemo(() => {
    const percent = (hitRate?: { hits: number; total: number } | null) =>
      hitRate && hitRate.total > 0 ? (hitRate.hits / hitRate.total) * 100 : null;

    // Check if any column sort is active
    const activeColumnSort = Object.entries(columnSort).find(([_, dir]) => dir !== 'none');
    
    if (propLineSort !== 'none') {
      // Prop line sort takes precedence
      return [...uniquePlayerProps];
    }

    if (activeColumnSort) {
      const [column, direction] = activeColumnSort;
      const sorted = [...uniquePlayerProps].sort((a, b) => {
        let aValue: number | null = null;
        let bValue: number | null = null;

        switch (column) {
          case 'dvp':
            // Sort by DvP rank (lower rank = better)
            aValue = a.dvpRating ?? null;
            bValue = b.dvpRating ?? null;
            // Lower rank is better, so for "asc" (best) we want lower numbers first
            // Handle nulls: nulls go to end (treated as rank 31)
            if (aValue === null && bValue === null) return 0;
            if (aValue === null) return 1;
            if (bValue === null) return -1;
            return direction === 'asc' ? aValue - bValue : bValue - aValue;
          
          case 'l5':
            aValue = percent(a.last5HitRate);
            bValue = percent(b.last5HitRate);
            break;
          
          case 'ip':
            // Sort by bookmaker implied over probability (highest = best)
            aValue = a.impliedOverProb ?? null;
            bValue = b.impliedOverProb ?? null;
            break;
          
          case 'l10':
            aValue = percent(a.last10HitRate);
            bValue = percent(b.last10HitRate);
            break;
          
          case 'h2h':
            aValue = percent(a.h2hHitRate);
            bValue = percent(b.h2hHitRate);
            break;
          
          case 'season':
            aValue = percent(a.seasonHitRate);
            bValue = percent(b.seasonHitRate);
            break;
          
          case 'streak':
            aValue = a.streak ?? null;
            bValue = b.streak ?? null;
            break;
        }

        // Handle null values
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1; // nulls go to end
        if (bValue === null) return -1;
        
        // Sort based on direction
        // For hit rates, IP, and streak: "asc" (best) = highest values first (descending sort)
        // DvP is handled separately above
        return direction === 'asc' ? bValue - aValue : aValue - bValue;
      });
      return sorted;
    }

    // Default: sort by L10% (fallback to L5% then overall prob)
    return [...uniquePlayerProps].sort((a, b) => {
      const aL10 = percent(a.last10HitRate);
      const bL10 = percent(b.last10HitRate);
      if (aL10 !== null || bL10 !== null) {
        return (bL10 ?? -1) - (aL10 ?? -1);
      }
      const aL5 = percent(a.last5HitRate);
      const bL5 = percent(b.last5HitRate);
      if (aL5 !== null || bL5 !== null) {
        return (bL5 ?? -1) - (aL5 ?? -1);
      }
      // Use implied probabilities for sorting
      const aProb = Math.max(a.overProb, a.underProb);
      const bProb = Math.max(b.overProb, b.underProb);
      return bProb - aProb;
    });
  }, [uniquePlayerProps, propLineSort, columnSort]);

  // Pagination
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(displaySortedProps.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedPlayerProps = useMemo(() => {
    const start = (currentPageSafe - 1) * pageSize;
    return displaySortedProps.slice(start, start + pageSize);
  }, [displaySortedProps, currentPageSafe]);

  const toggleBookmaker = (bookmaker: string) => {
    setSelectedBookmakers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bookmaker)) {
        newSet.delete(bookmaker);
      } else {
        newSet.add(bookmaker);
      }
      // Save to localStorage
      saveFiltersToStorage(newSet, selectedPropTypes, selectedGames);
      return newSet;
    });
  };

  const togglePropType = (propType: string) => {
    setSelectedPropTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(propType)) {
        newSet.delete(propType);
      } else {
        newSet.add(propType);
      }
      // Save to localStorage
      saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
      return newSet;
    });
  };

  const toggleGame = (gameId: number) => {
    setSelectedGames(prev => {
      const newSet = new Set(prev);
      if (newSet.has(gameId)) {
        newSet.delete(gameId);
      } else {
        newSet.add(gameId);
      }
      // Save to localStorage
      saveFiltersToStorage(selectedBookmakers, selectedPropTypes, newSet);
      return newSet;
    });
  };

  const getConfidenceColor = (confidence: string) => {
    if (confidence === 'High') return mounted && isDark ? 'text-green-400' : 'text-green-600';
    if (confidence === 'Medium') return mounted && isDark ? 'text-yellow-400' : 'text-yellow-600';
    return mounted && isDark ? 'text-gray-400' : 'text-gray-600';
  };

  return (
    <div className="min-h-screen lg:h-screen bg-gray-50 dark:bg-gray-900 transition-colors lg:overflow-x-auto lg:overflow-y-hidden">
      <style jsx global>{`
        .dashboard-container {
          --sidebar-margin: 0px;
          --sidebar-width: 0px;
          --gap: 2px;
          --inner-max: 1550px;
          --app-max: calc(var(--sidebar-width) + var(--gap) + var(--inner-max));
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
        }

        .mobile-filter-scroll::-webkit-scrollbar {
          height: 8px;
        }
        .mobile-filter-scroll::-webkit-scrollbar-track {
          background: #f3f4f6;
          border-radius: 4px;
        }
        .mobile-filter-scroll::-webkit-scrollbar-thumb {
          background: #9ca3af;
          border-radius: 4px;
        }
        .mobile-filter-scroll::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }
        .dark .mobile-filter-scroll::-webkit-scrollbar-track {
          background: #1f2937;
        }
        .dark .mobile-filter-scroll::-webkit-scrollbar-thumb {
          background: #4b5563;
        }
        .dark .mobile-filter-scroll::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }

        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }

        @media (min-width: 1024px) {
          .dashboard-container {
            --sidebar-width: 340px;
            --right-panel-width: 340px;
          }
        }
        
        @media (min-width: 1500px) {
          .dashboard-container {
            --sidebar-margin: 0px;
            --sidebar-width: 400px;
            --right-panel-width: 400px;
            --content-margin-right: 0px;
            --content-padding-left: 0px;
            --content-padding-right: 0px;
          }
        }
        
        @media (min-width: 2200px) {
          .dashboard-container {
            --sidebar-margin: 0px;
            --sidebar-width: 460px;
            --right-panel-width: 460px;
            --content-margin-right: 0px;
            --content-padding-left: 0px;
            --content-padding-right: 0px;
          }
        }
      `}</style>
      
      <div className="px-0 dashboard-container" style={{ 
        marginLeft: 'calc(var(--sidebar-width, 0px) + var(--gap, 2px))',
        width: 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 2px)))',
        paddingLeft: 0,
      }}>
        <div className={`mx-auto w-full max-w-[1550px]`} style={{ paddingLeft: 0, paddingRight: '0px' }}>
          <div className="pt-4 min-h-0 lg:h-full dashboard-container" style={{ paddingLeft: 0 }}>
            {/* Left Sidebar */}
            <LeftSidebar
              oddsFormat={oddsFormat}
              setOddsFormat={(format) => {
                const formatValue = typeof format === 'function' ? format(oddsFormat) : format;
                setOddsFormat(formatValue);
                localStorage.setItem('oddsFormat', formatValue);
              }}
              hasPremium={isPro}
              avatarUrl={avatarUrl}
              username={username}
              userEmail={userEmail}
              isPro={isPro}
              onSubscriptionClick={() => router.push('/subscription')}
              onSignOutClick={async () => {
                await supabase.auth.signOut();
                router.push('/');
              }}
            />

            {/* Main Content Area - Top Player Props */}
            <div 
              className={`relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 overflow-y-auto lg:overflow-x-hidden lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar`}
              style={{
                scrollbarGutter: 'stable',
                paddingLeft: 0,
                paddingRight: 0,
              }}
            >
          <div className="h-full pb-12 lg:pr-0" style={{ paddingLeft: '8px', paddingRight: '8px', paddingTop: 0, boxSizing: 'border-box' }}>
            {/* Search Bar */}
            <div className="mb-2">
              <form onSubmit={handleSearch} style={{ width: '100%', margin: 0, padding: 0, boxSizing: 'border-box' }}>
                <div className="relative" style={{ width: '100%', boxSizing: 'border-box' }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for a player..."
                    className={`px-4 py-3 pl-12 rounded-lg border ${
                      mounted && isDark 
                        ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-400' 
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                    } focus:outline-none focus:ring-2 focus:ring-purple-500`}
                    style={{ boxSizing: 'border-box', width: '100%' }}
                  />
                  <svg
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </form>

              {/* Filters Section */}
              <div 
                ref={filtersSectionRef}
                className="mt-2 flex gap-1.5" 
                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
              >
                {/* Games Dropdown */}
                <div className="relative flex-1">
                  <button
                    onClick={() => {
                      setGamesDropdownOpen(!gamesDropdownOpen);
                      setBookmakerDropdownOpen(false);
                      setPropTypeDropdownOpen(false);
                    }}
                    className={`relative flex items-center justify-between gap-2 px-4 py-3 rounded-lg border transition-all w-full ${
                      gamesDropdownOpen
                        ? mounted && isDark
                          ? 'bg-gray-700 border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-sm font-medium whitespace-nowrap">
                      Games
                    </span>
                    <svg
                      className={`w-4 h-4 transition-transform flex-shrink-0 ${gamesDropdownOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {gamesDropdownOpen && (
                    isMobile && dropdownContainer ? (
                      createPortal(
                        <>
                          <div
                            className="fixed inset-0 z-[100]"
                            onClick={() => setGamesDropdownOpen(false)}
                          />
                          <div 
                            data-dropdown-locked
                            className={`fixed left-1/2 -translate-x-1/2 z-[101] rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-800 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`} 
                            style={{ 
                              position: 'fixed',
                              top: `${lockedPositionRef.current ?? filterBottom}px`, 
                              left: '50%',
                              transform: 'translateX(-50%)',
                              width: 'max-content', 
                              minWidth: '200px', 
                              maxWidth: '90vw',
                              pointerEvents: 'auto'
                            }}
                          >
                          <div className="p-2 space-y-1">
                            {todaysGames.map(game => {
                              const isSelected = selectedGames.has(game.id);
                              const homeTeam = game.home_team?.abbreviation || '';
                              const awayTeam = game.visitor_team?.abbreviation || '';
                              const homeLogoUrl = getEspnLogoUrl(homeTeam);
                              const awayLogoUrl = getEspnLogoUrl(awayTeam);
                              return (
                                <label
                                  key={game.id}
                                  className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
                                    isSelected
                                      ? mounted && isDark
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-900'
                                      : mounted && isDark
                                      ? 'hover:bg-gray-700 text-gray-300'
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleGame(game.id)}
                                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 flex-shrink-0"
                                  />
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {awayLogoUrl && (
                                      <img
                                        src={awayLogoUrl}
                                        alt={awayTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                    <span className="text-sm font-medium flex-shrink-0">{awayTeam}</span>
                                    <span className="text-sm text-gray-500 flex-shrink-0">@</span>
                                    {homeLogoUrl && (
                                      <img
                                        src={homeLogoUrl}
                                        alt={homeTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                    <span className="text-sm font-medium flex-shrink-0">{homeTeam}</span>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        </>,
                        dropdownContainer
                      )
                    ) : (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setGamesDropdownOpen(false)}
                        />
                        <div 
                          className={`absolute top-full left-0 right-0 mt-2 z-20 rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                            mounted && isDark
                              ? 'bg-gray-800 border-gray-700'
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          <div className="p-2 space-y-1">
                            {todaysGames.map(game => {
                              const isSelected = selectedGames.has(game.id);
                              const homeTeam = game.home_team?.abbreviation || '';
                              const awayTeam = game.visitor_team?.abbreviation || '';
                              const homeLogoUrl = getEspnLogoUrl(homeTeam);
                              const awayLogoUrl = getEspnLogoUrl(awayTeam);
                              return (
                                <label
                                  key={game.id}
                                  className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
                                    isSelected
                                      ? mounted && isDark
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-900'
                                      : mounted && isDark
                                      ? 'hover:bg-gray-700 text-gray-300'
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleGame(game.id)}
                                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 flex-shrink-0"
                                  />
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {awayLogoUrl && (
                                      <img
                                        src={awayLogoUrl}
                                        alt={awayTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                    <span className="text-sm font-medium flex-shrink-0">{awayTeam}</span>
                                    <span className="text-sm text-gray-500 flex-shrink-0">@</span>
                                    {homeLogoUrl && (
                                      <img
                                        src={homeLogoUrl}
                                        alt={homeTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                    <span className="text-sm font-medium flex-shrink-0">{homeTeam}</span>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )
                  )}
                </div>

                {/* Prop Types Dropdown */}
                <div className="relative flex-1" style={{ minWidth: 0, maxWidth: '100%' }}>
                  <button
                    onClick={() => {
                      setPropTypeDropdownOpen(!propTypeDropdownOpen);
                      setBookmakerDropdownOpen(false);
                      setGamesDropdownOpen(false);
                    }}
                    className={`relative flex items-center justify-between gap-2 px-4 py-3 rounded-lg border transition-all w-full ${
                      propTypeDropdownOpen
                        ? mounted && isDark
                          ? 'bg-gray-700 border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-sm font-medium whitespace-nowrap">
                      Prop Types
                    </span>
                    <svg
                      className={`w-4 h-4 transition-transform flex-shrink-0 ${propTypeDropdownOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {propTypeDropdownOpen && (
                    isMobile && dropdownContainer ? (
                      createPortal(
                        <>
                          <div
                            className="fixed inset-0 z-[100]"
                            onClick={() => setPropTypeDropdownOpen(false)}
                          />
                          <div 
                            data-dropdown-locked
                            className={`fixed left-1/2 -translate-x-1/2 z-[101] rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-800 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`} 
                            style={{ 
                              position: 'fixed',
                              top: `${lockedPositionRef.current ?? filterBottom}px`, 
                              left: '50%',
                              transform: 'translateX(-50%)',
                              width: 'max-content', 
                              minWidth: '200px', 
                              maxWidth: '90vw',
                              pointerEvents: 'auto'
                            }}
                          >
                          <div className="p-2 space-y-1">
                            {availablePropTypes.map(propType => {
                              const isSelected = selectedPropTypes.has(propType);
                              return (
                                <label
                                  key={propType}
                                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                                    isSelected
                                      ? mounted && isDark
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-900'
                                      : mounted && isDark
                                      ? 'hover:bg-gray-700 text-gray-300'
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => togglePropType(propType)}
                                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                  />
                                  <span className="text-sm font-medium">{getStatLabel(propType)}</span>
                                </label>
                              );
                          })}
                          <button
                            onClick={() => {
                              const newSet = new Set<string>();
                              setSelectedPropTypes(newSet);
                              saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                            }}
                            className={`w-full mt-2 px-3 py-2 rounded text-sm font-medium transition-all ${
                              mounted && isDark
                                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            Clear All
                          </button>
                        </div>
                      </div>
                      </>,
                      dropdownContainer
                    )
                  ) : (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setPropTypeDropdownOpen(false)}
                      />
                      <div 
                        className={`absolute top-full left-0 right-0 mt-2 z-20 rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                          mounted && isDark
                            ? 'bg-gray-800 border-gray-700'
                            : 'bg-white border-gray-300'
                        }`}
                      >
                        <div className="p-2 space-y-1">
                          {availablePropTypes.map(propType => {
                            const isSelected = selectedPropTypes.has(propType);
                            return (
                              <label
                                key={propType}
                                className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                                  isSelected
                                    ? mounted && isDark
                                      ? 'bg-purple-600 text-white'
                                      : 'bg-purple-100 text-purple-900'
                                    : mounted && isDark
                                    ? 'hover:bg-gray-700 text-gray-300'
                                    : 'hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => togglePropType(propType)}
                                  className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                />
                                <span className="text-sm font-medium">{getStatLabel(propType)}</span>
                              </label>
                            );
                          })}
                          <button
                            onClick={() => {
                              const newSet = new Set<string>();
                              setSelectedPropTypes(newSet);
                              saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                            }}
                            className={`w-full mt-2 px-3 py-2 rounded text-sm font-medium transition-all ${
                              mounted && isDark
                                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            Clear All
                          </button>
                        </div>
                      </div>
                    </>
                  )
                )}
                </div>

                {/* Bookmakers Dropdown */}
                <div className="relative flex-1">
                  <button
                    onClick={() => {
                      setBookmakerDropdownOpen(!bookmakerDropdownOpen);
                      setPropTypeDropdownOpen(false);
                      setGamesDropdownOpen(false);
                    }}
                    className={`relative flex items-center justify-between gap-2 px-4 py-3 rounded-lg border transition-all w-full ${
                      bookmakerDropdownOpen
                        ? mounted && isDark
                          ? 'bg-gray-700 border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-sm font-medium whitespace-nowrap">
                      Bookmakers
                    </span>
                    <svg
                      className={`w-4 h-4 transition-transform flex-shrink-0 ${bookmakerDropdownOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {bookmakerDropdownOpen && (
                    isMobile && dropdownContainer ? (
                      createPortal(
                        <>
                          <div
                            className="fixed inset-0 z-[100]"
                            onClick={() => setBookmakerDropdownOpen(false)}
                          />
                          <div 
                            data-dropdown-locked
                            className={`fixed left-1/2 -translate-x-1/2 z-[101] rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-800 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`} 
                            style={{ 
                              position: 'fixed',
                              top: `${lockedPositionRef.current ?? filterBottom}px`, 
                              left: '50%',
                              transform: 'translateX(-50%)',
                              width: 'max-content', 
                              minWidth: '200px', 
                              maxWidth: '90vw',
                              pointerEvents: 'auto'
                            }}
                          >
                            <div className="p-2 space-y-1">
                              {availableBookmakers.map(bookmaker => {
                                const bookmakerKey = bookmaker.toLowerCase();
                                const bookmakerInfo = BOOKMAKER_INFO[bookmakerKey] || BOOKMAKER_INFO[bookmakerKey.replace(/\s+/g, '')] || null;
                                const isSelected = selectedBookmakers.has(bookmaker);
                                return (
                                  <label
                                    key={bookmaker}
                                    className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                                      isSelected
                                        ? mounted && isDark
                                          ? 'bg-purple-600 text-white'
                                          : 'bg-purple-100 text-purple-900'
                                        : mounted && isDark
                                        ? 'hover:bg-gray-700 text-gray-300'
                                        : 'hover:bg-gray-50 text-gray-700'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleBookmaker(bookmaker)}
                                      className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                    />
                                    {bookmakerInfo?.logoUrl && (
                                      <img
                                        src={bookmakerInfo.logoUrl}
                                        alt={bookmakerInfo.name}
                                        className="w-4 h-4 object-contain"
                                      />
                                    )}
                                    <span className="text-sm font-medium">{bookmakerInfo?.name || bookmaker}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </>,
                        dropdownContainer
                      )
                    ) : (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setBookmakerDropdownOpen(false)}
                        />
                        <div 
                          className={`absolute top-full left-0 right-0 mt-2 z-20 rounded-lg border shadow-lg max-h-96 overflow-y-auto ${
                            mounted && isDark
                              ? 'bg-gray-800 border-gray-700'
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          <div className="p-2 space-y-1">
                            {availableBookmakers.map(bookmaker => {
                              const bookmakerKey = bookmaker.toLowerCase();
                              const bookmakerInfo = BOOKMAKER_INFO[bookmakerKey] || BOOKMAKER_INFO[bookmakerKey.replace(/\s+/g, '')] || null;
                              const isSelected = selectedBookmakers.has(bookmaker);
                              return (
                                <label
                                  key={bookmaker}
                                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all ${
                                    isSelected
                                      ? mounted && isDark
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 text-purple-900'
                                      : mounted && isDark
                                      ? 'hover:bg-gray-700 text-gray-300'
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleBookmaker(bookmaker)}
                                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                  />
                                  {bookmakerInfo?.logoUrl && (
                                    <img
                                      src={bookmakerInfo.logoUrl}
                                      alt={bookmakerInfo.name}
                                      className="w-4 h-4 object-contain"
                                    />
                                  )}
                                  <span className="text-sm font-medium">{bookmakerInfo?.name || bookmaker}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Player Props Section */}
            <div className="h-[calc(100%-160px)]" style={{ boxSizing: 'border-box', width: '100%', overflow: 'visible', paddingTop: 0, marginTop: 0 }}>
              <div className={`rounded-lg w-full pr-4 lg:pr-2 ${
                mounted && isDark ? 'bg-gray-800' : 'bg-white'
              } shadow-sm`} style={{ boxSizing: 'border-box', width: '100%', paddingTop: 0, marginTop: 0, paddingLeft: '0.5rem', paddingRight: '0.5rem' }}>
                <h2 className={`text-2xl font-bold mb-2 ${
                  mounted && isDark ? 'text-white' : 'text-gray-900'
                }`} style={{ marginTop: 0, paddingTop: 0 }}>
                  Top Player Props
                </h2>
                
                {propsLoading ? (
                    <div className="text-center py-12">
                      <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Loading player props...
                      </div>
                    </div>
                  ) : filteredPlayerProps.length === 0 ? (
                    <div className="text-center py-12">
                      <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {propsProcessing 
                          ? 'Processing player props... This may take a few minutes. Please check back shortly!'
                          : playerProps.length === 0 
                            ? 'No player props available at this time. Check back later!'
                            : 'No player props match your filters. Try adjusting your search or filters.'}
                      </div>
                      {propsProcessing && (
                        <div className="mt-4 flex justify-center">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500"></div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Desktop Table View - Hidden on mobile */}
                      <div className="hidden lg:block overflow-x-auto">
                        <table className="w-full">
                        <thead>
                          <tr className={`border-b ${mounted && isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                            {/* Prop Line Sorter (replaces Player text) */}
                            <th className="py-3 px-4 text-left">
                              <div className="relative inline-flex">
                                <button
                                  onClick={() => {
                                    setPropLineDropdownOpen(!propLineDropdownOpen);
                                    setBookmakerDropdownOpen(false);
                                    setPropTypeDropdownOpen(false);
                                    setGamesDropdownOpen(false);
                                  }}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold ${
                                    mounted && isDark
                                      ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                  }`}
                                >
                                  <span>Prop Line</span>
                                  <svg
                                    className={`w-4 h-4 transition-transform ${propLineDropdownOpen ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                                {propLineDropdownOpen && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={() => setPropLineDropdownOpen(false)}
                                    />
                                    <div
                                      className={`absolute top-full left-0 mt-2 z-20 rounded-lg border shadow-lg w-44 ${
                                        mounted && isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                                      }`}
                                    >
                                      <button
                                        onClick={() => {
                                          setPropLineSort('high');
                                          setPropLineDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm rounded ${
                                          propLineSort === 'high'
                                            ? mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900'
                                            : mounted && isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                      >
                                        Highest prop line
                                      </button>
                                      <button
                                        onClick={() => {
                                          setPropLineSort('low');
                                          setPropLineDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm rounded ${
                                          propLineSort === 'low'
                                            ? mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900'
                                            : mounted && isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                      >
                                        Lowest prop line
                                      </button>
                                      <button
                                        onClick={() => {
                                          setPropLineSort('none');
                                          setPropLineDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm rounded ${
                                          propLineSort === 'none'
                                            ? mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900'
                                            : mounted && isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                      >
                                        Clear
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </th>
                            <th className={`text-left py-3 px-4 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>Odds</th>
                            <th 
                              className={`text-left py-3 px-4 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`}
                              onClick={() => handleColumnSort('ip')}
                            >
                              <div className="flex items-center gap-1.5">
                                <span>IP</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.ip !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.ip === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.ip === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.ip === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={{ width: '80px' }}
                              onClick={() => handleColumnSort('dvp')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>DvP</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.dvp !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.dvp === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.dvp === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.dvp === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={{ width: '80px' }}
                              onClick={() => handleColumnSort('l5')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>L5</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.l5 !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.l5 === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.l5 === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.l5 === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={{ width: '80px' }}
                              onClick={() => handleColumnSort('l10')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>L10</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.l10 !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.l10 === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.l10 === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.l10 === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={{ width: '80px' }}
                              onClick={() => handleColumnSort('h2h')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>H2H</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.h2h !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.h2h === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.h2h === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.h2h === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={{ width: '80px' }}
                              onClick={() => handleColumnSort('season')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>Season</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.season !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.season === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.season === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.season === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th 
                              className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm cursor-pointer hover:opacity-80 transition-opacity select-none`} 
                              style={{ width: '80px' }}
                              onClick={() => handleColumnSort('streak')}
                            >
                              <div className="flex items-center justify-center gap-1.5">
                                <span>Streak</span>
                                <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                  columnSort.streak !== 'none' 
                                    ? mounted && isDark ? 'bg-purple-600 border-purple-500' : 'bg-purple-100 border-purple-300'
                                    : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                                }`}>
                                  {columnSort.streak === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                  {columnSort.streak === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                  {columnSort.streak === 'none' && (
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </th>
                            <th className={`text-center py-3 px-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>Tipoff</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedPlayerProps.map((prop, idx) => {
                            const bdlId = getPlayerIdFromName(prop.playerName); // BDL ID for stats API
                            const nbaId = bdlId ? convertBdlToNbaId(bdlId) : null; // NBA Stats ID for headshot
                            const headshotUrl = nbaId ? getPlayerHeadshotUrl(nbaId) : null;
                            // Normalize team names to abbreviations for logo lookup
                            // Handle both full names and abbreviations
                            const normalizeTeam = (team: string): string => {
                              if (!team) return '';
                              // Check if it's already an abbreviation (3 letters)
                              if (team.length <= 3) return team.toUpperCase();
                              // Try to find abbreviation from full name
                              return TEAM_FULL_TO_ABBR[team] || team.toUpperCase();
                            };
                            // Normalize stat for dashboard URL so it lands on the right tab (e.g., steals -> stl)
                            const normalizeStatForDashboard = (stat: string): string => {
                              const upper = (stat || '').toUpperCase().trim();
                              if (upper === 'THREES' || upper === '3PM' || upper === '3PM/A' || upper === 'FG3M') return 'fg3m';
                              if (upper === 'PTS' || upper === 'POINTS') return 'pts';
                              if (upper === 'REB' || upper === 'REBOUNDS') return 'reb';
                              if (upper === 'AST' || upper === 'ASSISTS') return 'ast';
                              if (upper === 'PRA') return 'pra';
                              if (upper === 'PR') return 'pr';
                              if (upper === 'PA') return 'pa';
                              if (upper === 'RA') return 'ra';
                              if (upper === 'STL' || upper === 'STEALS') return 'stl';
                              if (upper === 'BLK' || upper === 'BLOCKS') return 'blk';
                              return upper.toLowerCase();
                            };
                            const teamAbbr = normalizeTeam(prop.team);
                            const opponentAbbr = normalizeTeam(prop.opponent);
                            const teamLogoUrl = getEspnLogoUrl(teamAbbr);
                            const opponentLogoUrl = getEspnLogoUrl(opponentAbbr);
                            return (
                              <tr
                                key={idx}
                                className={`border-b ${mounted && isDark ? 'border-gray-700 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'} transition-colors cursor-pointer`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  
                                  // Force immediate log before any async operations
                                  const clickData = {
                                    player: prop.playerName,
                                    statType: prop.statType,
                                    line: prop.line,
                                    timestamp: Date.now(),
                                  };
                                  console.warn('🔵 [PropClick] CLICKED!', clickData);
                                  
                                  // Store in sessionStorage so it persists even if console is cleared
                                  if (typeof window !== 'undefined') {
                                    try {
                                      sessionStorage.setItem('last_prop_click', JSON.stringify(clickData));
                                    } catch {}
                                  }
                                  
                                  const normalizedStat = normalizeStatForDashboard(prop.statType);
                                  // Set timeframe to "thisseason" to show current season data when clicking from player props
                                  const finalUrl = `/nba/research/dashboard?player=${encodeURIComponent(prop.playerName)}&stat=${normalizedStat}&line=${prop.line.toString()}&tf=last10`;
                                  
                                  console.log('[PropClick] Navigating to dashboard', {
                                    ...clickData,
                                    normalizedStat,
                                    finalUrl,
                                    fullProp: prop,
                                  });
                                  
                                  // Store final URL for debugging
                                  if (typeof window !== 'undefined') {
                                    try {
                                      sessionStorage.setItem('last_prop_url', finalUrl);
                                    } catch {}
                                  }
                                  
                                  // Clear saved dashboard session to avoid flashing previous player/stat on navigation
                                  if (typeof window !== 'undefined') {
                                    try {
                                      window.sessionStorage.removeItem('nba_dashboard_session_v1');
                                    } catch (e) {
                                      console.warn('Failed to clear dashboard session storage', e);
                                    }
                                  }
                                  
                                  router.push(finalUrl);
                                }}
                              >
                                {/* Player Column */}
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    {headshotUrl && (
                                      <img
                                        src={headshotUrl}
                                        alt={prop.playerName}
                                        className="w-12 h-12 rounded-full object-cover flex-shrink-0 border-2 border-gray-200 dark:border-gray-700"
                                        style={{ imageRendering: 'auto' }}
                                        loading="lazy"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                    )}
                                    <div>
                                      <div className={`font-semibold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                        {prop.playerName}
                                      </div>
                                      <div className={`text-sm font-medium ${mounted && isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                                        {getStatLabel(prop.statType)} {prop.line > 0 ? 'Over' : 'Under'} {Math.abs(prop.line)}
                                      </div>
                                      <div className="flex items-center gap-2 mt-1">
                                        <img
                                          src={teamLogoUrl}
                                          alt={prop.team}
                                          className="w-5 h-5 object-contain"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                          }}
                                        />
                                        <span className="text-gray-400 dark:text-gray-500 text-xs">vs</span>
                                        <img
                                          src={opponentLogoUrl}
                                          alt={prop.opponent}
                                          className="w-5 h-5 object-contain"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                
                                {/* Odds Column - Show bookmakers grouped by line with expand/collapse */}
                                <td className="py-3 px-4">
                                  <div className="space-y-2">
                                    {prop.bookmakerLines && prop.bookmakerLines.length > 0 ? (
                                      (() => {
                                        // Filter bookmakerLines by selected bookmakers (if any are selected)
                                        let filteredLines = prop.bookmakerLines;
                                        if (selectedBookmakers.size > 0) {
                                          filteredLines = prop.bookmakerLines.filter(line => 
                                            line.bookmaker && selectedBookmakers.has(line.bookmaker)
                                          );
                                        }
                                        
                                        // Group bookmakers by line value
                                        const linesByValue = new Map<number, typeof prop.bookmakerLines>();
                                        filteredLines.forEach(line => {
                                          const lineValue = line.line;
                                          if (!linesByValue.has(lineValue)) {
                                            linesByValue.set(lineValue, []);
                                          }
                                          linesByValue.get(lineValue)!.push(line);
                                        });

                                        // Sort by number of bookmakers (descending) - favor lines with more bookmakers
                                        const sortedLines = Array.from(linesByValue.entries()).sort((a, b) => {
                                          return b[1].length - a[1].length; // More bookmakers first
                                        });

                                        // Render each unique line value
                                        return sortedLines.map(([lineValue, lines]) => {
                                          // Use a stable key: player name + stat type + line value
                                          const expandKey = `${prop.playerName}|${prop.statType}|${lineValue}`;
                                          // Show 2 initially, or all if there are 2 or fewer
                                          const visibleLines = lines.length <= 2 ? lines : lines.slice(0, 2);
                                          const remainingCount = lines.length - visibleLines.length;
                                          const isPopupOpen = openPopup === expandKey;

                                          return (
                                            <div key={lineValue} className="flex items-center gap-1.5">
                                              {/* Show visible bookmakers for this line */}
                                              {visibleLines.map((line, lineIdx) => {
                                                const bookmakerKey = line.bookmaker?.toLowerCase() || '';
                                                const bookmakerInfo = BOOKMAKER_INFO[bookmakerKey] || BOOKMAKER_INFO[bookmakerKey.replace(/\s+/g, '')] || null;
                                                return (
                                                  <div key={lineIdx} className="flex items-center gap-1.5">
                                                    {/* Bookmaker card/button */}
                                                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors ${
                                                      mounted && isDark
                                                        ? 'bg-gray-800 border-gray-600 hover:bg-gray-700'
                                                        : 'bg-white border-gray-300 hover:bg-gray-50'
                                                    }`}>
                                                      {bookmakerInfo?.logoUrl && (
                                                        <img
                                                          src={bookmakerInfo.logoUrl}
                                                          alt={bookmakerInfo.name}
                                                          className="w-6 h-6 object-contain flex-shrink-0 rounded"
                                                          onError={(e) => {
                                                            (e.target as HTMLImageElement).style.display = 'none';
                                                          }}
                                                        />
                                                      )}
                                                      <div className={`text-xs flex flex-col gap-0.5 ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                                        {(() => {
                                                          // Format odds based on user preference
                                                          const formatOddsValue = (oddsStr: string): string => {
                                                            if (oddsFormat === 'decimal') {
                                                              const parsed = parseAmericanOdds(oddsStr);
                                                              if (parsed !== null) {
                                                                const decimal = americanToDecimal(parsed);
                                                                return decimal.toFixed(2);
                                                              }
                                                            }
                                                            return oddsStr; // Return as-is for American format
                                                          };
                                                          return (
                                                            <>
                                                              <span className={mounted && isDark ? 'text-green-400' : 'text-green-600'}>O {formatOddsValue(line.overOdds)}</span>
                                                              <span className={mounted && isDark ? 'text-red-400' : 'text-red-600'}>U {formatOddsValue(line.underOdds)}</span>
                                                            </>
                                                          );
                                                        })()}
                                                      </div>
                                                    </div>
                                                    
                                                    {/* Separator line between bookmakers */}
                                                    {lineIdx < visibleLines.length - 1 && (
                                                      <div className={`w-px h-8 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
                                                    )}
                                                  </div>
                                                );
                                              })}
                                              
                                              {/* Show "+X more" button if there are more bookmakers */}
                                              {remainingCount > 0 && (
                                                <div className="relative">
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation(); // Prevent row click
                                                      setOpenPopup(openPopup === expandKey ? null : expandKey);
                                                    }}
                                                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                                                      mounted && isDark
                                                        ? 'bg-gray-700 border-gray-600 text-white hover:bg-gray-600'
                                                        : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                                                    }`}
                                                  >
                                                    +{remainingCount}
                                                  </button>
                                                  
                                                  {/* Popup modal for expanded view */}
                                                  {isPopupOpen && (
                                                    <>
                                                      {/* Backdrop - click to close */}
                                                      <div
                                                        className="fixed inset-0 z-40"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setOpenPopup(null);
                                                        }}
                                                      />
                                                      {/* Popup content - positioned relative to button */}
                                                      <div
                                                        className={`absolute top-full left-0 mt-2 z-50 rounded-lg border shadow-2xl p-4 max-w-3xl ${
                                                          mounted && isDark
                                                            ? 'bg-gray-800 border-gray-600'
                                                            : 'bg-gray-900 border-gray-500'
                                                        }`}
                                                        style={{
                                                          maxHeight: '70vh',
                                                          overflowY: 'auto',
                                                          minWidth: '400px'
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                      >
                                                        {/* Close button */}
                                                        <div className="flex justify-between items-center mb-3">
                                                          <span className={`text-sm font-medium text-gray-300`}>
                                                            {lines.length} bookmakers
                                                          </span>
                                                          <button
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              setOpenPopup(null);
                                                            }}
                                                            className={`text-gray-400 hover:text-white transition-colors p-1`}
                                                            aria-label="Close"
                                                          >
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                          </button>
                                                        </div>
                                                        
                                                        {/* All bookmakers in grid */}
                                                        <div className="flex flex-wrap gap-2">
                                                          {lines.map((line, lineIdx) => {
                                                            const bookmakerKey = line.bookmaker?.toLowerCase() || '';
                                                            const bookmakerInfo = BOOKMAKER_INFO[bookmakerKey] || BOOKMAKER_INFO[bookmakerKey.replace(/\s+/g, '')] || null;
                                                            return (
                                                              <div
                                                                key={lineIdx}
                                                                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${
                                                                  mounted && isDark
                                                                    ? 'bg-gray-700 border-gray-600'
                                                                    : 'bg-gray-800 border-gray-500'
                                                                }`}
                                                              >
                                                                {bookmakerInfo?.logoUrl && (
                                                                  <img
                                                                    src={bookmakerInfo.logoUrl}
                                                                    alt={bookmakerInfo.name}
                                                                    className="w-6 h-6 object-contain flex-shrink-0 rounded"
                                                                    onError={(e) => {
                                                                      (e.target as HTMLImageElement).style.display = 'none';
                                                                    }}
                                                                  />
                                                                )}
                                                                <div className={`text-xs flex flex-col gap-0.5 text-white`}>
                                                                  {(() => {
                                                                    // Format odds based on user preference
                                                                    const formatOddsValue = (oddsStr: string): string => {
                                                                      if (oddsFormat === 'decimal') {
                                                                        const parsed = parseAmericanOdds(oddsStr);
                                                                        if (parsed !== null) {
                                                                          const decimal = americanToDecimal(parsed);
                                                                          return decimal.toFixed(2);
                                                                        }
                                                                      }
                                                                      return oddsStr; // Return as-is for American format
                                                                    };
                                                                    return (
                                                                      <>
                                                                        <span className="text-green-400 font-medium">O {formatOddsValue(line.overOdds)}</span>
                                                                        <span className="text-red-400 font-medium">U {formatOddsValue(line.underOdds)}</span>
                                                                      </>
                                                                    );
                                                                  })()}
                                                                </div>
                                                              </div>
                                                            );
                                                          })}
                                                        </div>
                                                      </div>
                                                    </>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        });
                                      })()
                                    ) : (
                                      // Fallback to main bookmaker if no bookmakerLines
                                      (() => {
                                        const bookmakerKey = prop.bookmaker?.toLowerCase() || '';
                                        const bookmakerInfo = BOOKMAKER_INFO[bookmakerKey] || BOOKMAKER_INFO[bookmakerKey.replace(/\s+/g, '')] || null;
                                        return (
                                          <div className="flex items-center gap-2">
                                            {bookmakerInfo?.logoUrl && (
                                              <img
                                                src={bookmakerInfo.logoUrl}
                                                alt={bookmakerInfo.name}
                                                className="w-5 h-5 object-contain flex-shrink-0"
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            )}
                                            <div className={`text-sm ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                              <div>Over: {prop.overOdds}</div>
                                              <div>Under: {prop.underOdds}</div>
                                            </div>
                                          </div>
                                        );
                                      })()
                                    )}
                                  </div>
                                </td>
                                
                                {/* IP Column - Implied Odds */}
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-6">
                                    {/* Bookmakers */}
                                    <div className="flex flex-col gap-1">
                                      <div className={`text-[10px] ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Bookmakers
                                      </div>
                                      <div className="flex flex-col gap-0.5">
                                        {(() => {
                                          // Calculate implied probabilities on-the-fly from odds (not from cache)
                                          const implied = calculateImpliedProbabilities(prop.overOdds, prop.underOdds);
                                          const overProb = implied ? implied.overImpliedProb : (prop.impliedOverProb ?? 50);
                                          const underProb = implied ? implied.underImpliedProb : (prop.impliedUnderProb ?? 50);
                                          return (
                                            <>
                                              <div className={`text-sm font-semibold ${overProb >= underProb ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                Over {overProb.toFixed(1)}%
                                              </div>
                                              <div className={`text-sm font-semibold ${underProb >= overProb ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                Under {underProb.toFixed(1)}%
                                              </div>
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                
                                {/* DvP Column */}
                                <td className="py-3 px-2">
                                  {prop.dvpRating !== null && prop.dvpRating !== undefined && typeof prop.dvpRating === 'number' && prop.dvpRating > 0 ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        // Color coding based on rank (same as dashboard)
                                        // Higher rank = worse defense = better for player (green)
                                        if (prop.dvpRating >= 26) {
                                          bgColor = mounted && isDark ? '#166534' : '#dcfce7'; // green-800 / green-100
                                          borderColor = '#22c55e';
                                          glowColor = '#22c55e';
                                        } else if (prop.dvpRating >= 21) {
                                          bgColor = mounted && isDark ? '#166534' : '#dcfce7'; // green-800 / green-100
                                          borderColor = '#22c55e';
                                          glowColor = '#22c55e';
                                        } else if (prop.dvpRating >= 16) {
                                          bgColor = mounted && isDark ? '#9a3412' : '#fed7aa'; // orange-800 / orange-100
                                          borderColor = '#f97316';
                                          glowColor = '#f97316';
                                        } else if (prop.dvpRating >= 11) {
                                          bgColor = mounted && isDark ? '#9a3412' : '#fed7aa'; // orange-900 / orange-200
                                          borderColor = '#f97316';
                                          glowColor = '#f97316';
                                        } else if (prop.dvpRating >= 6) {
                                          bgColor = mounted && isDark ? '#991b1b' : '#fee2e2'; // red-800 / red-100
                                          borderColor = '#ef4444';
                                          glowColor = '#ef4444';
                                        } else {
                                          bgColor = mounted && isDark ? '#991b1b' : '#fee2e2'; // red-900 / red-800
                                          borderColor = '#ef4444';
                                          glowColor = '#ef4444';
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          #{prop.dvpRating}
                                        </div>
                                        {prop.dvpStatValue !== null && prop.dvpStatValue !== undefined && (
                                          <div className="text-xs font-medium text-white leading-tight">
                                            {prop.dvpStatValue.toFixed(1)}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className={`text-sm font-medium ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
                                  )}
                                </td>
                                
                                {/* L5 Column */}
                                <td className="py-3 px-2">
                                  {prop.last5Avg !== null && prop.last5Avg !== undefined ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (prop.last5HitRate) {
                                          const hitRate = (prop.last5HitRate.hits / prop.last5HitRate.total) * 100;
                                          if (hitRate < 30) {
                                            // red - bad: fade out at top
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            // orange - mid: fade out at top
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
                                            // green - good: fade out at top
                                            bgColor = '#22c55e';
                                            borderColor = '#22c55e';
                                            glowColor = '#22c55e';
                                          }
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          {prop.last5Avg.toFixed(1)}
                                        </div>
                                        {prop.last5HitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {prop.last5HitRate.hits}/{prop.last5HitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((prop.last5HitRate.hits / prop.last5HitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className={`text-sm font-medium ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
                                  )}
                                </td>
                                
                                {/* L10 Column */}
                                <td className="py-3 px-2">
                                  {prop.last10Avg !== null && prop.last10Avg !== undefined ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (prop.last10HitRate) {
                                          const hitRate = (prop.last10HitRate.hits / prop.last10HitRate.total) * 100;
                                          if (hitRate < 30) {
                                            // red - bad: fade out at top
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            // orange - mid: fade out at top
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
                                            // green - good: fade out at top
                                            bgColor = '#22c55e';
                                            borderColor = '#22c55e';
                                            glowColor = '#22c55e';
                                          }
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          {prop.last10Avg.toFixed(1)}
                                        </div>
                                        {prop.last10HitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {prop.last10HitRate.hits}/{prop.last10HitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((prop.last10HitRate.hits / prop.last10HitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className={`text-sm font-medium ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
                                  )}
                                </td>
                                
                                {/* H2H Column */}
                                <td className="py-3 px-2">
                                  {prop.h2hAvg !== null && prop.h2hAvg !== undefined ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (prop.h2hHitRate) {
                                          const hitRate = (prop.h2hHitRate.hits / prop.h2hHitRate.total) * 100;
                                          if (hitRate < 30) {
                                            // red - bad: fade out at top
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            // orange - mid: fade out at top
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
                                            // green - good: fade out at top
                                            bgColor = '#22c55e';
                                            borderColor = '#22c55e';
                                            glowColor = '#22c55e';
                                          }
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          {prop.h2hAvg.toFixed(1)}
                                        </div>
                                        {prop.h2hHitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {prop.h2hHitRate.hits}/{prop.h2hHitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((prop.h2hHitRate.hits / prop.h2hHitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className={`text-sm font-medium ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
                                  )}
                                </td>
                                
                                {/* Season Column */}
                                <td className="py-3 px-2">
                                  {prop.seasonAvg !== null && prop.seasonAvg !== undefined ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (prop.seasonHitRate) {
                                          const hitRate = (prop.seasonHitRate.hits / prop.seasonHitRate.total) * 100;
                                          if (hitRate < 30) {
                                            // red - bad: fade out at top
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            // orange - mid: fade out at top
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
                                            // green - good: fade out at top
                                            bgColor = '#22c55e';
                                            borderColor = '#22c55e';
                                            glowColor = '#22c55e';
                                          }
                                        }
                                        
                                        return {
                                          background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb') 
                                            ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)` 
                                            : bgColor,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <div className="h-full w-full flex flex-col items-center justify-center text-center leading-tight gap-0">
                                        <div className="text-sm font-semibold text-white leading-tight">
                                          {prop.seasonAvg.toFixed(1)}
                                        </div>
                                        {prop.seasonHitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {prop.seasonHitRate.hits}/{prop.seasonHitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((prop.seasonHitRate.hits / prop.seasonHitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className={`text-sm font-medium ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
                                  )}
                                </td>
                                
                                {/* Streak Column */}
                                <td className="py-3 px-2">
                                  {prop.streak !== null && prop.streak !== undefined ? (
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = '';
                                        let borderColor = '';
                                        let glowColor = '';
                                        
                                        if (prop.streak >= 2) {
                                          // green - good
                                          bgColor = '#22c55e';
                                          borderColor = '#22c55e';
                                          glowColor = '#22c55e';
                                        } else if (prop.streak === 1) {
                                          // orange - mid
                                          bgColor = '#E88A3B';
                                          borderColor = '#f97316';
                                          glowColor = '#f97316';
                                        } else {
                                          // red - bad
                                          bgColor = '#B03A3A';
                                          borderColor = '#ef4444';
                                          glowColor = '#ef4444';
                                        }
                                        
                                        return {
                                          background: `linear-gradient(to top, ${bgColor}, ${bgColor}00)`,
                                          borderColor: borderColor,
                                          borderWidth: '1px',
                                          boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                                        };
                                      })()}>
                                      <span className="text-sm font-semibold text-white">
                                        {prop.streak === 0 ? '0' : `${prop.streak} 🔥`}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className={`text-sm font-medium ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
                                  )}
                                </td>
                                
                                {/* Tipoff Countdown Column */}
                                <td className="py-3 px-2">
                                  <TipoffCountdown game={getGameForProp(prop)} isDark={mounted && isDark} />
                                </td>
                                
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                      
                      {/* Mobile Column Sort Filters - Scrollable row above player props */}
                      <div className="lg:hidden mb-4 w-full px-0.5">
                        <div 
                          className="overflow-x-auto mobile-filter-scroll"
                          style={{ 
                            scrollbarWidth: 'thin',
                            scrollbarColor: mounted && isDark ? '#4b5563 #1f2937' : '#9ca3af #f3f4f6',
                            paddingLeft: '0.5rem',
                            paddingRight: '1rem'
                          }}
                        >
                          <div className="flex gap-2 min-w-max pb-2" style={{ width: 'max-content' }}>
                            {/* IP Sort */}
                            <button
                              onClick={() => handleColumnSort('ip')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap flex-shrink-0 ${
                                columnSort.ip !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>IP</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.ip !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.ip === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.ip === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.ip === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* DvP Sort */}
                            <button
                              onClick={() => handleColumnSort('dvp')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap flex-shrink-0 ${
                                columnSort.dvp !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>DvP</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.dvp !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.dvp === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.dvp === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.dvp === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* L5 Sort */}
                            <button
                              onClick={() => handleColumnSort('l5')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap flex-shrink-0 ${
                                columnSort.l5 !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>L5</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.l5 !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.l5 === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.l5 === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.l5 === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* L10 Sort */}
                            <button
                              onClick={() => handleColumnSort('l10')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap flex-shrink-0 ${
                                columnSort.l10 !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>L10</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.l10 !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.l10 === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.l10 === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.l10 === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* H2H Sort */}
                            <button
                              onClick={() => handleColumnSort('h2h')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap flex-shrink-0 ${
                                columnSort.h2h !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>H2H</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.h2h !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.h2h === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.h2h === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.h2h === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* Season Sort */}
                            <button
                              onClick={() => handleColumnSort('season')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap flex-shrink-0 ${
                                columnSort.season !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>Season</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.season !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.season === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.season === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.season === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>

                            {/* Streak Sort */}
                            <button
                              onClick={() => handleColumnSort('streak')}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap flex-shrink-0 ${
                                columnSort.streak !== 'none'
                                  ? mounted && isDark
                                    ? 'bg-purple-600 border-purple-500 text-white'
                                    : 'bg-purple-100 border-purple-300 text-purple-900'
                                  : mounted && isDark
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span>Streak</span>
                              <div className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                                columnSort.streak !== 'none'
                                  ? mounted && isDark ? 'bg-purple-500 border-purple-400' : 'bg-purple-200 border-purple-400'
                                  : mounted && isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-300'
                              }`}>
                                {columnSort.streak === 'asc' && <span className="text-[8px] leading-none">↑</span>}
                                {columnSort.streak === 'desc' && <span className="text-[8px] leading-none">↓</span>}
                                {columnSort.streak === 'none' && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                )}
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {/* Mobile Card View - Hidden on desktop */}
                      <div className="lg:hidden space-y-4">
                        {paginatedPlayerProps.map((prop, idx) => {
                          const bdlId = getPlayerIdFromName(prop.playerName);
                          const nbaId = bdlId ? convertBdlToNbaId(bdlId) : null;
                          const headshotUrl = nbaId ? getPlayerHeadshotUrl(nbaId) : null;
                          const normalizeTeam = (team: string): string => {
                            if (!team) return '';
                            if (team.length <= 3) return team.toUpperCase();
                            return TEAM_FULL_TO_ABBR[team] || team.toUpperCase();
                          };
                          const teamAbbr = normalizeTeam(prop.team);
                          const opponentAbbr = normalizeTeam(prop.opponent);
                          const teamLogoUrl = getEspnLogoUrl(teamAbbr);
                          const opponentLogoUrl = getEspnLogoUrl(opponentAbbr);
                          const game = getGameForProp(prop);
                          
                          // Format game date/time
                          const formatGameDateTime = (game: Game | null): string => {
                            if (!game || !game.date) return '';
                            try {
                              const date = new Date(game.date);
                              const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                              const dayName = days[date.getDay()];
                              const hours = date.getHours();
                              const minutes = date.getMinutes();
                              const ampm = hours >= 12 ? 'PM' : 'AM';
                              const displayHours = hours % 12 || 12;
                              const displayMinutes = minutes.toString().padStart(2, '0');
                              return `${dayName} @ ${displayHours}:${displayMinutes}${ampm}`;
                            } catch {
                              return '';
                            }
                          };
                          
                          // Helper to format hit rate percentage
                          const getHitRatePercent = (hitRate: { hits: number; total: number } | null | undefined): string => {
                            if (!hitRate || hitRate.total === 0) return '-';
                            return `${((hitRate.hits / hitRate.total) * 100).toFixed(0)}%`;
                          };
                          
                          // Helper to get stat box color based on hit rate
                          const getStatBoxStyle = (hitRate: { hits: number; total: number } | null | undefined, isStreak = false) => {
                            let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                            let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                            let glowColor: string | null = null;
                            
                            if (isStreak) {
                              const streakValue = prop.streak ?? 0;
                              if (streakValue === 0) {
                                bgColor = '#B03A3A'; // red
                                borderColor = '#ef4444';
                                glowColor = '#ef4444';
                              } else if (streakValue === 1) {
                                bgColor = '#E88A3B'; // orange
                                borderColor = '#f97316';
                                glowColor = '#f97316';
                              } else {
                                bgColor = '#22c55e'; // green
                                borderColor = '#22c55e';
                                glowColor = '#22c55e';
                              }
                            } else if (hitRate) {
                              const percent = (hitRate.hits / hitRate.total) * 100;
                              if (percent < 30) {
                                bgColor = '#B03A3A'; // red
                                borderColor = '#ef4444';
                                glowColor = '#ef4444';
                              } else if (percent < 70) {
                                bgColor = '#E88A3B'; // orange
                                borderColor = '#f97316';
                                glowColor = '#f97316';
                              } else {
                                bgColor = '#22c55e'; // green
                                borderColor = '#22c55e';
                                glowColor = '#22c55e';
                              }
                            }
                            
                            return {
                              background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb')
                                ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)`
                                : bgColor,
                              borderColor: borderColor,
                              borderWidth: '1px',
                              boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                            };
                          };
                          
                          // Format odds helper
                          const formatOddsValue = (oddsStr: string): string => {
                            if (oddsFormat === 'decimal') {
                              const parsed = parseAmericanOdds(oddsStr);
                              if (parsed !== null) {
                                const decimal = americanToDecimal(parsed);
                                return decimal.toFixed(2);
                              }
                            }
                            return oddsStr;
                          };
                          
                          return (
                            <div
                              key={idx}
                              className={`rounded-xl border-2 pl-3 pr-4 py-3.5 ${
                                mounted && isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                              }`}
                              onClick={() => {
                                const params = new URLSearchParams();
                                params.set('player', prop.playerName);
                                params.set('stat', prop.statType);
                                params.set('line', prop.line.toString());
                                router.push(`/nba/research/dashboard?${params.toString()}`);
                              }}
                            >
                              {/* Header Section */}
                              <div className="mb-3">
                                {/* Player Name and Headshot Row */}
                                <div className="flex items-center gap-2.5 mb-2">
                                  {headshotUrl && (
                                    <img
                                      src={headshotUrl}
                                      alt={prop.playerName}
                                      className="w-10 h-10 rounded-full object-cover flex-shrink-0 border-2"
                                      style={{ 
                                        borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb',
                                        imageRendering: 'auto'
                                      }}
                                      loading="lazy"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className={`font-bold text-base truncate ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                      {prop.playerName}
                                    </div>
                                    {/* Team Logos */}
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      {teamLogoUrl && (
                                        <img
                                          src={teamLogoUrl}
                                          alt={prop.team}
                                          className="w-5 h-5 object-contain"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                          }}
                                        />
                                      )}
                                      <span className={`text-xs font-medium ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>vs</span>
                                      {opponentLogoUrl && (
                                        <img
                                          src={opponentLogoUrl}
                                          alt={prop.opponent}
                                          className="w-5 h-5 object-contain"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                          }}
                                        />
                                      )}
                                    </div>
                                  </div>
                                  {/* Bookmaker IP Box */}
                                  <div className="flex-shrink-0">
                                    <div className="flex flex-col items-center justify-center rounded-lg border-2 px-3 py-2" style={getStatBoxStyle(null)}>
                                      <div className={`text-[10px] font-semibold mb-1 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>Books</div>
                                      {(() => {
                                        // Calculate implied probabilities on-the-fly from odds
                                        const implied = calculateImpliedProbabilities(prop.overOdds, prop.underOdds);
                                        const overProb = implied ? implied.overImpliedProb : (prop.impliedOverProb ?? null);
                                        const underProb = implied ? implied.underImpliedProb : (prop.impliedUnderProb ?? null);
                                        return (
                                          <>
                                            <div className={`text-xs font-bold ${mounted && isDark ? 'text-green-400' : 'text-green-600'}`}>
                                              {overProb !== null && overProb !== undefined ? `${overProb.toFixed(0)}%` : '-'}
                                            </div>
                                            <div className={`text-xs font-bold ${mounted && isDark ? 'text-red-400' : 'text-red-600'}`}>
                                              {underProb !== null && underProb !== undefined ? `${underProb.toFixed(0)}%` : '-'}
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </div>
                                {/* Stat Type and Line */}
                                <div className={`text-sm font-semibold ${mounted && isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                                  {getStatLabel(prop.statType)} {prop.line > 0 ? 'Over' : 'Under'} {Math.abs(prop.line)}
                                </div>
                              </div>
                              
                              {/* Statistics Grid */}
                              <div className={`grid grid-cols-7 gap-2 p-2.5 rounded-xl mb-3 w-full ${
                                mounted && isDark ? 'bg-gray-900/50' : 'bg-gray-50'
                              }`}>
                                {/* L5 */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.last5HitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>L5</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {getHitRatePercent(prop.last5HitRate)}
                                  </div>
                                </div>
                                
                                {/* L10 */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.last10HitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>L10</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {getHitRatePercent(prop.last10HitRate)}
                                  </div>
                                </div>
                                
                                {/* H2H */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.h2hHitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>H2H</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {getHitRatePercent(prop.h2hHitRate)}
                                  </div>
                                </div>
                                
                                {/* STRK */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(null, true)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>STRK</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {prop.streak ?? '-'}
                                  </div>
                                </div>
                                
                                {/* AVG */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(null)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>AVG</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {prop.seasonAvg !== null && prop.seasonAvg !== undefined ? prop.seasonAvg.toFixed(1) : '-'}
                                  </div>
                                </div>
                                
                                {/* SZN */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.seasonHitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>SZN</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {getHitRatePercent(prop.seasonHitRate)}
                                  </div>
                                </div>
                                
                                {/* DvP */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={(() => {
                                  if (prop.dvpRating === null || prop.dvpRating === undefined) {
                                    return { background: mounted && isDark ? '#374151' : '#f9fafb', borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb' };
                                  }
                                  let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                  let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                  let glowColor: string | null = null;
                                  if (prop.dvpRating >= 26) {
                                    bgColor = '#22c55e';
                                    borderColor = '#22c55e';
                                    glowColor = '#22c55e';
                                  } else if (prop.dvpRating >= 21) {
                                    bgColor = '#22c55e';
                                    borderColor = '#22c55e';
                                    glowColor = '#22c55e';
                                  } else if (prop.dvpRating >= 16) {
                                    bgColor = '#f97316';
                                    borderColor = '#f97316';
                                    glowColor = '#f97316';
                                  } else if (prop.dvpRating >= 11) {
                                    bgColor = '#f97316';
                                    borderColor = '#f97316';
                                    glowColor = '#f97316';
                                  } else {
                                    bgColor = '#ef4444';
                                    borderColor = '#ef4444';
                                    glowColor = '#ef4444';
                                  }
                            return {
                              background: bgColor !== (mounted && isDark ? '#374151' : '#f9fafb')
                                ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)`
                                : bgColor,
                              borderColor: borderColor,
                              borderWidth: '2px',
                              boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                            };
                                })()}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>DvP</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {prop.dvpRating !== null && prop.dvpRating !== undefined ? `#${prop.dvpRating}` : '-'}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Bookmaker Odds Section - Horizontally Scrollable */}
                              {prop.bookmakerLines && prop.bookmakerLines.length > 0 && (() => {
                                // Group by line value
                                const linesByValue = new Map<number, typeof prop.bookmakerLines>();
                                prop.bookmakerLines.forEach(line => {
                                  const lineValue = line.line;
                                  if (!linesByValue.has(lineValue)) {
                                    linesByValue.set(lineValue, []);
                                  }
                                  // Filter by selected bookmakers
                                  let filteredLines = [line];
                                  if (selectedBookmakers.size > 0) {
                                    filteredLines = [line].filter(l => l.bookmaker && selectedBookmakers.has(l.bookmaker));
                                  }
                                  if (filteredLines.length > 0) {
                                    linesByValue.get(lineValue)!.push(...filteredLines);
                                  }
                                });
                                
                                // Sort by number of bookmakers (descending) - favor lines with more bookmakers
                                const sortedLines = Array.from(linesByValue.entries()).sort((a, b) => {
                                  return b[1].length - a[1].length; // More bookmakers first
                                });
                                
                                // Mobile: Show only first bookmaker + "+ X" button
                                const allBookmakers = Array.from(linesByValue.values()).flat();
                                const firstBookmaker = allBookmakers[0];
                                const remainingCount = allBookmakers.length - 1;
                                const expandKey = `${prop.playerName}|${prop.statType}|mobile-all`;
                                const isPopupOpen = openPopup === expandKey;
                                
                                return (
                                  <div className="flex items-center gap-2.5">
                                    <div className="flex gap-2 flex-1">
                                      {/* First bookmaker */}
                                      {firstBookmaker && (() => {
                                        const bookmakerKey = firstBookmaker.bookmaker?.toLowerCase() || '';
                                        const bookmakerInfo = BOOKMAKER_INFO[bookmakerKey] || BOOKMAKER_INFO[bookmakerKey.replace(/\s+/g, '')] || null;
                                        return (
                                          <div
                                            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 flex-shrink-0 ${
                                              mounted && isDark ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-100 border-gray-300'
                                            }`}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {bookmakerInfo?.logoUrl && (
                                              <img
                                                src={bookmakerInfo.logoUrl}
                                                alt={bookmakerInfo.name}
                                                className="w-6 h-6 object-contain rounded flex-shrink-0"
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            )}
                                            <div className="flex flex-col gap-0.5 min-w-0">
                                              <span className={`text-xs font-bold ${mounted && isDark ? 'text-green-400' : 'text-green-600'}`}>
                                                O {formatOddsValue(firstBookmaker.overOdds)}
                                              </span>
                                              <span className={`text-xs font-bold ${mounted && isDark ? 'text-red-400' : 'text-red-600'}`}>
                                                U {formatOddsValue(firstBookmaker.underOdds)}
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                      
                                      {/* "+ X" button if there are more bookmakers */}
                                      {remainingCount > 0 && (
                                        <div className="relative">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenPopup(openPopup === expandKey ? null : expandKey);
                                            }}
                                            className={`flex items-center gap-2 px-1.5 py-2.5 rounded-lg border-2 flex-shrink-0 relative ${
                                              mounted && isDark ? 'bg-gray-700/50 border-gray-600 hover:bg-gray-700' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                                            }`}
                                          >
                                            {/* Placeholder for logo space to match bookmaker container */}
                                            <div className="w-6 h-6 flex-shrink-0" />
                                            {/* Centered number - positioned absolutely to center in entire button */}
                                            <div className="absolute inset-0 flex items-center justify-center">
                                              <span className={`text-base font-bold ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>
                                                +{remainingCount}
                                              </span>
                                            </div>
                                            {/* Invisible spacer to match bookmaker container height */}
                                            <div className="flex flex-col gap-0.5 min-w-0 opacity-0 pointer-events-none">
                                              <span className="text-xs font-bold">O 2.10</span>
                                              <span className="text-xs font-bold">U 1.68</span>
                                            </div>
                                          </button>
                                          
                                          {/* Popup modal for all bookmakers - Mobile */}
                                          {isPopupOpen && (
                                            <>
                                              {/* Backdrop - click to close */}
                                              <div
                                                className="fixed inset-0 z-[100]"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setOpenPopup(null);
                                                }}
                                              />
                                              {/* Popup content - centered on mobile */}
                                              <div
                                                className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] rounded-lg border shadow-2xl p-4 w-[90vw] max-w-md ${
                                                  mounted && isDark
                                                    ? 'bg-gray-800 border-gray-600'
                                                    : 'bg-white border-gray-300'
                                                }`}
                                                style={{
                                                  maxHeight: '70vh',
                                                  overflowY: 'auto'
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                {/* Close button */}
                                                <div className="flex justify-between items-center mb-3">
                                                  <span className={`text-sm font-medium ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                                    {allBookmakers.length} bookmakers
                                                  </span>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setOpenPopup(null);
                                                    }}
                                                    className={`${mounted && isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'} transition-colors p-1`}
                                                    aria-label="Close"
                                                  >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                  </button>
                                                </div>
                                                
                                                {/* All bookmakers list */}
                                                <div className="space-y-2">
                                                  {allBookmakers.map((line, idx) => {
                                                    const bookmakerKey = line.bookmaker?.toLowerCase() || '';
                                                    const bookmakerInfo = BOOKMAKER_INFO[bookmakerKey] || BOOKMAKER_INFO[bookmakerKey.replace(/\s+/g, '')] || null;
                                                    return (
                                                      <div
                                                        key={idx}
                                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                                                          mounted && isDark ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'
                                                        }`}
                                                      >
                                                        {bookmakerInfo?.logoUrl && (
                                                          <img
                                                            src={bookmakerInfo.logoUrl}
                                                            alt={bookmakerInfo.name}
                                                            className="w-8 h-8 object-contain rounded flex-shrink-0"
                                                            onError={(e) => {
                                                              (e.target as HTMLImageElement).style.display = 'none';
                                                            }}
                                                          />
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                          <div className={`text-sm font-semibold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                                            {bookmakerInfo?.name || line.bookmaker}
                                                          </div>
                                                          <div className="flex items-center gap-3 mt-1">
                                                            <span className={`text-xs font-bold ${mounted && isDark ? 'text-green-400' : 'text-green-600'}`}>
                                                              O {formatOddsValue(line.overOdds)}
                                                            </span>
                                                            <span className={`text-xs font-bold ${mounted && isDark ? 'text-red-400' : 'text-red-600'}`}>
                                                              U {formatOddsValue(line.underOdds)}
                                                            </span>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {/* Tipoff Countdown - Next to bookmakers on the right */}
                                    <div className="flex items-center justify-center flex-shrink-0">
                                      <TipoffCountdown game={game} isDark={mounted && isDark} />
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Tipoff Countdown - Show if no bookmakers */}
                              {(!prop.bookmakerLines || prop.bookmakerLines.length === 0) && (
                                <div className="flex items-center justify-start">
                                  <TipoffCountdown game={game} isDark={mounted && isDark} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Pagination controls - Shared for desktop and mobile */}
                      <div className="flex items-center justify-between mt-6 px-2 pb-4">
                        <div className={`text-sm ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          Showing {(currentPageSafe - 1) * pageSize + 1} - {Math.min(currentPageSafe * pageSize, displaySortedProps.length)} of {displaySortedProps.length}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setCurrentPage(Math.max(1, currentPageSafe - 1))}
                            disabled={currentPageSafe === 1}
                            className={`px-3 py-1 rounded border text-sm ${
                              currentPageSafe === 1
                                ? mounted && isDark ? 'text-gray-500 border-gray-700 cursor-not-allowed' : 'text-gray-400 border-gray-200 cursor-not-allowed'
                                : mounted && isDark ? 'text-gray-200 border-gray-600 hover:bg-gray-700' : 'text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Prev
                          </button>
                          <span className={`text-sm ${mounted && isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                            Page {currentPageSafe} / {totalPages}
                          </span>
                          <button
                            onClick={() => setCurrentPage(Math.min(totalPages, currentPageSafe + 1))}
                            disabled={currentPageSafe === totalPages}
                            className={`px-3 py-1 rounded border text-sm ${
                              currentPageSafe === totalPages
                                ? mounted && isDark ? 'text-gray-500 border-gray-700 cursor-not-allowed' : 'text-gray-400 border-gray-200 cursor-not-allowed'
                                : mounted && isDark ? 'text-gray-200 border-gray-600 hover:bg-gray-700' : 'text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  
                  {/* Mobile Games Section - Hidden */}
                  <div className="hidden mt-6">
                    <h3 className={`text-xl font-bold mb-3 ${
                      mounted && isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      Today's Games
                    </h3>
                    {gamesLoading ? (
                      <div className="text-center py-8">
                        <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          Loading games...
                        </div>
                      </div>
                    ) : todaysGames.length === 0 ? (
                      <div className="text-center py-8">
                        <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          No games scheduled for today
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {todaysGames.map((game) => {
                          const homeTeam = game.home_team?.abbreviation || 'TBD';
                          const awayTeam = game.visitor_team?.abbreviation || 'TBD';
                          const isFinal = game.status?.toLowerCase().includes('final');
                          const homeScore = game.home_team_score;
                          const awayScore = game.visitor_team_score;
                          
                          return (
                            <div
                              key={game.id}
                              className={`p-3 rounded-lg border ${
                                mounted && isDark
                                  ? 'bg-gray-700 border-gray-600'
                                  : 'bg-gray-50 border-gray-200'
                              }`}
                            >
                              <div className="text-center mb-2">
                                <div className={`text-xs ${
                                  mounted && isDark ? 'text-gray-400' : 'text-gray-500'
                                }`}>
                                  {formatTime(game.date)}
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className={`text-sm font-medium ${
                                    mounted && isDark ? 'text-white' : 'text-gray-900'
                                  }`}>
                                    {awayTeam}
                                  </span>
                                  {isFinal && awayScore !== undefined && (
                                    <span className={`text-sm font-bold ${
                                      mounted && isDark ? 'text-white' : 'text-gray-900'
                                    }`}>
                                      {awayScore}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className={`text-sm font-medium ${
                                    mounted && isDark ? 'text-white' : 'text-gray-900'
                                  }`}>
                                    {homeTeam}
                                  </span>
                                  {isFinal && homeScore !== undefined && (
                                    <span className={`text-sm font-bold ${
                                      mounted && isDark ? 'text-white' : 'text-gray-900'
                                    }`}>
                                      {homeScore}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {!isFinal && (
                                <div className="mt-2 text-center">
                                  <button
                                    onClick={() => router.push(`/nba/research/dashboard?team=${homeTeam}`)}
                                    className={`text-xs px-3 py-1 rounded ${
                                      mounted && isDark
                                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                        : 'bg-purple-100 hover:bg-purple-200 text-purple-700'
                                    } transition-colors`}
                                  >
                                    View Props
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper function to parse American odds string to number
function parseAmericanOdds(oddsStr: string): number | null {
  if (!oddsStr || oddsStr === 'N/A') return null;
  
  // Remove any non-numeric characters except + and -
  const cleaned = oddsStr.replace(/[^0-9.+-]/g, '');
  const parsed = parseFloat(cleaned);
  
  if (isNaN(parsed)) return null;
  return parsed;
}

// Helper function to convert American odds to implied probability
function americanToImpliedProb(american: number): number {
  if (american > 0) {
    return (100 / (american + 100)) * 100;
  } else {
    return (Math.abs(american) / (Math.abs(american) + 100)) * 100;
  }
}

