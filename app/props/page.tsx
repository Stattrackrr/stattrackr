'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { MobileBottomNavigation } from "@/app/nba/research/dashboard/components/header";
import { useTheme } from "@/contexts/ThemeContext";
import { useRouter } from 'next/navigation';
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { getFullTeamName, TEAM_FULL_TO_ABBR } from '@/lib/teamMapping';
import { getPlayerHeadshotUrl } from '@/lib/nbaLogos';
import { getAflPlayerHeadshotUrl } from '@/lib/aflPlayerHeadshots';
import { AflPropsPlayerAvatar } from '@/components/AflPropsPlayerAvatar';
import { getEspnLogoUrl } from '@/lib/nbaAbbr';
import { PLAYER_ID_MAPPINGS, convertBdlToNbaId } from '@/lib/playerIdMapping';
import { currentNbaSeason, TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from '@/lib/nbaConstants';
import { BOOKMAKER_INFO } from '@/lib/bookmakers';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import { parseBallDontLieTipoff } from '@/app/nba/research/dashboard/utils';
import { americanToDecimal, formatOdds } from '@/lib/currencyUtils';
import { cachedFetch } from '@/lib/requestCache';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import Image from 'next/image';

interface Game {
  id: number;
  date: string;
  status: string;
  home_team: { id: number; abbreviation: string };
  visitor_team: { id: number; abbreviation: string };
  home_team_score?: number;
  visitor_team_score?: number;
  /** ISO datetime for tipoff countdown (e.g. AFL from cache) */
  datetime?: string;
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
  // AFL: link to game for filtering; game matchup for display
  gameId?: string;
  homeTeam?: string;
  awayTeam?: string;
}

/** AFL game from list API (for props page games filter). */
interface AflGameForProps {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}

// Tipoff Countdown Component
function TipoffCountdown({ game, isDark }: { game: Game | null; isDark: boolean }) {
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  const [isBeyond24h, setIsBeyond24h] = useState(false);

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
      setIsBeyond24h(diff > 24 * 60 * 60 * 1000);
      
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

  const tipoffColor = isBeyond24h ? '#ef4444' : '#6366f1';

  return (
    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
      style={{
        background: `linear-gradient(to top, ${tipoffColor}, ${tipoffColor}00)`,
        borderColor: tipoffColor,
        borderWidth: '1px',
        boxShadow: `0 0 8px ${tipoffColor}60, 0 0 4px ${tipoffColor}40`,
      }}>
      <div className="text-[10px] text-white mb-0.5">Tipoff</div>
      <div className="text-xs font-mono font-semibold text-white">
        {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
      </div>
    </div>
  );
}

function SportMark({ sport, isDark, compact = false }: { sport: 'nba' | 'afl'; isDark: boolean; compact?: boolean }) {
  const [imgError, setImgError] = useState(false);
  const isAfl = sport === 'afl';
  const imgClass = compact ? 'w-6 h-6 object-contain' : 'w-8 h-8 object-contain';
  const fallbackClass = compact
    ? `inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold border ${
        isAfl
          ? isDark
            ? 'bg-orange-900/40 text-orange-200 border-orange-700'
            : 'bg-orange-100 text-orange-700 border-orange-300'
          : isDark
            ? 'bg-blue-900/40 text-blue-200 border-blue-700'
            : 'bg-blue-100 text-blue-700 border-blue-300'
      }`
    : `inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border ${
        isAfl
          ? isDark
            ? 'bg-orange-900/40 text-orange-200 border-orange-700'
            : 'bg-orange-100 text-orange-700 border-orange-300'
          : isDark
            ? 'bg-blue-900/40 text-blue-200 border-blue-700'
            : 'bg-blue-100 text-blue-700 border-blue-300'
      }`;
  const src = isAfl ? '/images/afl-logo.png' : '/images/nba-logo.png';

  return (
    <span className="inline-flex items-center justify-center" aria-label={isAfl ? 'AFL' : 'NBA'} title={isAfl ? 'AFL' : 'NBA'}>
      {!imgError ? (
        <img
          src={src}
          alt={isAfl ? 'AFL' : 'NBA'}
          className={imgClass}
          onError={() => setImgError(true)}
        />
      ) : (
        <span className={fallbackClass}>{isAfl ? 'AFL' : 'NBA'}</span>
      )}
    </span>
  );
}

// Constants
const SEARCH_DEBOUNCE_MS = 300;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_STORAGE_MAX_SIZE = 4 * 1024 * 1024; // 4MB (conservative limit, most browsers allow 5-10MB)
const BATCH_DELAY_MS = 500;
const ODDS_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_ODDS_CHECK_DELAY_MS = 30 * 1000; // 30 seconds
const AFL_POPUP_DISMISSED_KEY = 'afl_launch_popup_dismissed_v1';
const NOTIFICATION_STORAGE_KEY = 'stattrackr-notifications';
const NBA_TEAM_ABBR_ALIASES: Record<string, string> = {
  WSH: 'WAS',
  GS: 'GSW',
  NO: 'NOP',
  SA: 'SAS',
  PHO: 'PHX',
  BK: 'BKN',
  BRK: 'BKN',
  NY: 'NYK',
};
const AFL_NOTIFICATION_ID = 'afl-launch-update-2026';
const AFL_PROPS_CACHE_KEY = 'afl_props_list_cache_v1';
const AFL_PROPS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min – show cached list instantly when returning, refresh in background
const AFL_TEAM_LOGOS_CACHE_KEY = 'afl_team_logos_cache_v1';
const AFL_TEAM_LOGOS_CACHE_TS_KEY = 'afl_team_logos_cache_ts_v1';
const AFL_TEAM_LOGOS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export default function NBALandingPage() {
  const router = useRouter();
  const { isDark, theme, setTheme } = useTheme();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [subscriptionChecked, setSubscriptionChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [todaysGames, setTodaysGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);

  // Debounce search query to reduce filtering overhead
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    
    return () => clearTimeout(timer);
  }, [searchQuery]);
  
  // Initialize player props and loading state - always start with loading true to prevent hydration mismatch
  // We'll check sessionStorage in useEffect after mount
  const [playerProps, setPlayerProps] = useState<PlayerProp[]>([]);
  const [propsLoading, setPropsLoading] = useState(true);
  const [propsProcessing, setPropsProcessing] = useState(false); // Track if cache is empty but processing is happening
  const [showNoPropsMessage, setShowNoPropsMessage] = useState(false); // After 8s with no props, show "come back later"
  const [mounted, setMounted] = useState(false);
  const propsLoadedRef = useRef(false); // Track if props are already loaded to prevent redundant fetches
  const initialFetchCompletedRef = useRef(false); // Track if initial fetch has completed
  const playerPropsRef = useRef(playerProps);
  const [dropdownContainer, setDropdownContainer] = useState<HTMLElement | null>(null);
  const [navigatingToPlayer, setNavigatingToPlayer] = useState(false);
  const navigatingRef = useRef(false);
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
  const gamesButtonRef = useRef<HTMLButtonElement>(null);
  const propTypeButtonRef = useRef<HTMLButtonElement>(null);
  const bookmakerButtonRef = useRef<HTMLButtonElement>(null);

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

  // Props page sport: Combined (default) | NBA | AFL — restore explicit mode from URL when provided
  const [propsSport, setPropsSport] = useState<'nba' | 'afl' | 'combined'>('combined');
  const [aflGames, setAflGames] = useState<AflGameForProps[]>([]);
  const [aflProps, setAflProps] = useState<PlayerProp[]>([]);
  const [aflPropsLoading, setAflPropsLoading] = useState(false);
  const aflPropsFetchCompleteRef = useRef(false);
  const aflRetryTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [aflPropsRetryKey, setAflPropsRetryKey] = useState(0); // increment to refetch (e.g. after empty or user Retry)
  const [selectedAflGames, setSelectedAflGames] = useState<Set<string>>(new Set());
  const selectedAflGamesRef = useRef<Set<string>>(new Set());
  // If the user manually checks/unchecks games, don't let the async AFL list fetch overwrite their selection.
  const userModifiedAflGamesRef = useRef(false);

  const syncSelectedAflGames = useCallback((nextGameIds: string[]) => {
    const nextSet = new Set(nextGameIds);
    // If the user hasn't modified yet (or the ref is empty during initial restore),
    // just apply the incoming selection.
    if (!userModifiedAflGamesRef.current || selectedAflGamesRef.current.size === 0) {
      selectedAflGamesRef.current = nextSet;
      setSelectedAflGames(nextSet);
      return;
    }
    // Preserve user's current selection by intersecting with the newly loaded game list.
    const out = new Set<string>();
    for (const id of selectedAflGamesRef.current) {
      if (nextSet.has(id)) out.add(id);
    }
    selectedAflGamesRef.current = out;
    setSelectedAflGames(out);
  }, []);

  const getSelectedAflGameIdsForCache = useCallback((candidateGameIds: string[]) => {
    const candidateSet = new Set(candidateGameIds);
    const current = Array.from(selectedAflGamesRef.current);
    const filtered = current.filter((id) => candidateSet.has(id));
    return filtered.length > 0 ? filtered : candidateGameIds;
  }, []);
  /** When ?debugStats=1, list API returns _meta with debugNa (why L5/L10/Season show N/A). */
  const [aflListDebugMeta, setAflListDebugMeta] = useState<Record<string, unknown> | null>(null);
  /** AFL ingest status from list API (same as NBA: "Fetched X stats for Y season, Z games"). */
  const [aflIngestMessage, setAflIngestMessage] = useState<string | null>(null);
  const [aflLastUpdated, setAflLastUpdated] = useState<string | null>(null);
  // AFL player jumper numbers (name -> number) from league stats, for circle placeholder
  const [aflPlayerNumbers, setAflPlayerNumbers] = useState<Record<string, number>>({});
  // AFL team logos (normalized name -> url) for matchup display
  const [aflLogoByTeam, setAflLogoByTeam] = useState<Record<string, string>>({});

  // Mobile bottom nav dropdown state
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);

  // Reset "user modified" flag when leaving AFL-only filter mode.
  useEffect(() => {
    if (propsSport !== 'afl') userModifiedAflGamesRef.current = false;
  }, [propsSport]);
  const [showAflComingSoonPopup, setShowAflComingSoonPopup] = useState(false);

  // Find player (not in props / no odds) modal: bottom-right on mobile, top-right on desktop
  const [findPlayerOpen, setFindPlayerOpen] = useState(false);
  const [findPlayerQuery, setFindPlayerQuery] = useState('');
  const [findPlayerResults, setFindPlayerResults] = useState<Array<{ name: string; team?: string }>>([]);
  const [findPlayerLoading, setFindPlayerLoading] = useState(false);
  const findPlayerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);
  const journalDropdownRef = useRef<HTMLDivElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);
  const dismissAflComingSoonPopup = useCallback(() => {
    setShowAflComingSoonPopup(false);
    try {
      localStorage.setItem(AFL_POPUP_DISMISSED_KEY, '1');
      const existingRaw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const hasAflNotification = Array.isArray(existing) && existing.some((n: any) => n?.id === AFL_NOTIFICATION_ID);
      if (!hasAflNotification) {
        const aflNotification = {
          id: AFL_NOTIFICATION_ID,
          title: 'AFL Launch Update',
          content: 'AFL is launching soon and will be live before the season begins. We are building the most advanced AFL props and analytics experience on the market.',
          date: new Date().toISOString(),
          read: false,
        };
        const next = Array.isArray(existing) ? [aflNotification, ...existing] : [aflNotification];
        localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    try {
      const dismissed = localStorage.getItem(AFL_POPUP_DISMISSED_KEY) === '1';
      setShowAflComingSoonPopup(!dismissed);
    } catch {
      setShowAflComingSoonPopup(true);
    }
    // Set dropdown container to document.body for portal rendering
    if (typeof document !== 'undefined') {
      setDropdownContainer(document.body);
    }
    
    // Detect mobile viewport
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    // Load odds format from localStorage
    const savedFormat = localStorage.getItem('oddsFormat');
    if (savedFormat === 'decimal' || savedFormat === 'american') {
      setOddsFormat(savedFormat as 'american' | 'decimal');
    }
    
    // Restore sport from URL when explicitly set; default launch stays combined mode.
    // Only set AFL loading true if we don't have cache (useLayoutEffect may have already restored cache and set loading false)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const sportParam = url.searchParams.get('sport');
      if (sportParam === 'nba') {
        setPropsSport('nba');
      } else if (sportParam === 'afl') {
        setPropsSport('afl');
        try {
          const raw = sessionStorage.getItem(AFL_PROPS_CACHE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { timestamp?: number };
            const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
            if (age >= AFL_PROPS_CACHE_TTL_MS) setAflPropsLoading(true);
          } else {
            setAflPropsLoading(true);
          }
        } catch {
          setAflPropsLoading(true);
        }
        // Keep sport=afl in URL so refresh stays on AFL
      } else if (sportParam === 'combined') {
        setPropsSport('combined');
      }
      // When coming back from AFL dashboard "Back to Player Props", clear the search filter
      // and debounced value so the next search (e.g. same player name) runs correctly.
      try {
        if (sessionStorage.getItem('afl_back_to_props_clear_search') === '1') {
          sessionStorage.removeItem('afl_back_to_props_clear_search');
          setSearchQuery('');
          setDebouncedSearchQuery('');
        }
      } catch {}
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
        // Debug logging removed('[NBA Landing] 🧹 Cleared player-related URL parameters');
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
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Run before paint: restore from sessionStorage so first paint shows cache (no loading flash)
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const sportParam = url.searchParams.get('sport');

    // 1) Restore sport from URL when explicitly provided
    if (sportParam === 'nba') {
      setPropsSport('nba');
    } else if (sportParam === 'afl') {
      setPropsSport('afl');
    } else if (sportParam === 'combined') {
      setPropsSport('combined');
    }

    // 2) NBA player props cache
    const CACHE_KEY = 'nba-player-props-cache';
    const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
    const cachedData = sessionStorage.getItem(CACHE_KEY);
    const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (cachedData && cachedTimestamp) {
      const age = Date.now() - parseInt(cachedTimestamp, 10);
      if (age < CACHE_TTL_MS) {
        try {
          const parsed = JSON.parse(cachedData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            let propsWithMergedStats = parsed;
            const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
            try {
              const stored = sessionStorage.getItem(CALCULATED_STATS_KEY);
              if (stored) {
                const calculatedStats = JSON.parse(stored);
                if (Array.isArray(calculatedStats)) {
                  const calculatedMap = new Map<string, PlayerProp>();
                  calculatedStats.forEach((prop: PlayerProp) => {
                    const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                    calculatedMap.set(key, prop);
                  });
                  propsWithMergedStats = parsed.map((prop: PlayerProp) => {
                    const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                    const calculated = calculatedMap.get(key);
                    if (calculated) {
                      return {
                        ...prop,
                        h2hAvg: calculated.h2hAvg ?? prop.h2hAvg,
                        seasonAvg: calculated.seasonAvg ?? prop.seasonAvg,
                        h2hHitRate: calculated.h2hHitRate ?? prop.h2hHitRate,
                        seasonHitRate: calculated.seasonHitRate ?? prop.seasonHitRate,
                      };
                    }
                    return prop;
                  });
                  calculatedStats.forEach((prop: PlayerProp) => {
                    const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                    calculatedKeysRef.current.add(key);
                  });
                  setPropsWithCalculatedStats(calculatedMap);
                }
              }
            } catch {
              // ignore
            }
            setPlayerProps(propsWithMergedStats);
            propsLoadedRef.current = true;
            setPropsLoading(false);
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    // 3) Games cache (same key as fetchTodaysGames)
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];
    const gamesCacheKey = `dashboard-games-${start}-${end}`;
    const gamesCached = sessionStorage.getItem(gamesCacheKey);
    const gamesTs = sessionStorage.getItem(`${gamesCacheKey}-timestamp`);
    if (gamesCached && gamesTs) {
      const age = Date.now() - parseInt(gamesTs, 10);
      if (age < CACHE_TTL_MS) {
        try {
          const parsed = JSON.parse(gamesCached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTodaysGames(parsed);
            setGamesLoading(false);
          }
        } catch {
          // ignore
        }
      }
    }

    // 4) AFL cache when mode includes AFL (AFL/Combined, or default with no sport param)
    if (sportParam === null || sportParam === 'afl' || sportParam === 'combined') {
      try {
        const raw = sessionStorage.getItem(AFL_PROPS_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { props?: PlayerProp[]; games?: AflGameForProps[]; selectedGameIds?: string[]; timestamp?: number };
          const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
          if (age < AFL_PROPS_CACHE_TTL_MS && Array.isArray(parsed?.props)) {
            setAflProps(parsed.props);
            if (Array.isArray(parsed?.games) && parsed.games.length > 0) {
              setAflGames(parsed.games);
              const hasSelectedFromCache =
                Array.isArray(parsed.selectedGameIds) && parsed.selectedGameIds.length > 0;
              if (hasSelectedFromCache) userModifiedAflGamesRef.current = true;
              const selectedIds = hasSelectedFromCache
                ? parsed.selectedGameIds!
                : parsed.games.map((g: { gameId: string }) => g.gameId);
              syncSelectedAflGames(selectedIds);
            }
            aflPropsFetchCompleteRef.current = true;
            setAflPropsLoading(false);
          }
        }
      } catch {
        // ignore
      }
      // 5) AFL team logos cache for instant logo-only matchup rendering
      try {
        const logosRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_KEY);
        const logosTsRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_TS_KEY);
        const logosTs = logosTsRaw ? parseInt(logosTsRaw, 10) : 0;
        const logosAge = Number.isFinite(logosTs) ? Date.now() - logosTs : Infinity;
        if (logosRaw && logosAge < AFL_TEAM_LOGOS_CACHE_TTL_MS) {
          const parsed = JSON.parse(logosRaw);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            setAflLogoByTeam(parsed as Record<string, string>);
          }
        }
      } catch {
        // ignore
      }
    }
  }, []);

  // Keep playerPropsRef in sync for 8-second no-props check
  useEffect(() => {
    playerPropsRef.current = playerProps;
  }, [playerProps]);

  // After 8 seconds of trying with no props, show "no props found come back later"
  useEffect(() => {
    const timer = setTimeout(() => {
      if (playerPropsRef.current.length === 0) {
        setShowNoPropsMessage(true);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  // Reset to first page and close popups whenever filters or sorting change (or sport)
  useEffect(() => {
    setCurrentPage(1);
    setOpenPopup(null); // Close any open popups
  }, [propLineSort, debouncedSearchQuery, selectedBookmakers, selectedPropTypes, selectedGames, columnSort, propsSport]);
  
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
          setSubscriptionChecked(true);
          setTimeout(() => {
            router.push('/login?redirect=/props');
          }, 0);
        }
        return;
      }

      if (!isMounted) return;

      // Don't set email/username/avatar until we have profile — set all together below to avoid flash of email before name

      try {
        const { data: profile } = await (supabase
          .from('profiles') as any)
          .select('subscription_status, subscription_tier, avatar_url, full_name, username')
          .eq('id', session.user.id)
          .single();

        if (!isMounted) return;

        const profileData = profile as { subscription_status?: string; subscription_tier?: string; avatar_url?: string | null; full_name?: string | null; username?: string | null } | null;
        const displayName = profileData?.full_name || profileData?.username || session.user.user_metadata?.username || session.user.user_metadata?.full_name || null;
        const avatarFromProfile = profileData?.avatar_url ?? session.user.user_metadata?.avatar_url ?? session.user.user_metadata?.picture ?? null;
        setUserEmail(session.user.email || null);
        setUsername(displayName);
        setAvatarUrl(avatarFromProfile);
        
        let isActive = false;
        let isProTier = false;
        
        if (profileData) {
          isActive = profileData.subscription_status === 'active' || profileData.subscription_status === 'trialing';
          isProTier = profileData.subscription_tier === 'pro';
        }
        
        const proStatus = isActive && isProTier;
        if (isMounted) {
          setIsPro(proStatus);
          setSubscriptionChecked(true);
          if (!proStatus) {
            // Redirect happens in useEffect when cache has loaded
            return;
          }
        }
      } catch (error) {
        console.error('Error checking subscription:', error);
        if (isMounted) setSubscriptionChecked(true);
      }
    };
    
    checkSubscription();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          setIsPro(false);
          router.push('/login?redirect=/props');
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

  // Kick non-pro users when subscription is checked and games (cache) have loaded
  useEffect(() => {
    if (subscriptionChecked && !isPro && !gamesLoading) {
      router.replace('/home#pricing');
    }
  }, [subscriptionChecked, isPro, gamesLoading, router]);

  // Fetch games (today plus nearby) to keep props-linked games selected across date boundaries
  // OPTIMIZATION: Pre-fetch games immediately and cache them for dashboard
  useEffect(() => {
    const fetchTodaysGames = async () => {
      try {
        setGamesLoading(true);
        
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
        // Include a wider window (next 7 days) to match dashboard cache key format
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];

        // Check sessionStorage first (same cache key format as dashboard for instant load)
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
                    // Debug logging removed(`✅ Using cached games from sessionStorage (${parsed.length} games, ${Math.round(age / 1000)}s old)`);
                    setTodaysGames(parsed);
                    setGamesLoading(false);
                    // Still fetch in background to update if needed (non-blocking)
                    fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`, { cache: 'default' }).then(async (response) => {
                      if (response.ok) {
                        const data = await response.json();
                        if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
                          setTodaysGames(data.data);
                          const dataString = JSON.stringify(data.data);
                          safeSetSessionStorage(cacheKey, dataString);
                          safeSetSessionStorage(`${cacheKey}-timestamp`, Date.now().toString());
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

        const response = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`);
        const data = await response.json();
        const games = Array.isArray(data?.data) ? data.data : [];
        
        setTodaysGames(games);
        
        // Cache games for dashboard (same format as dashboard uses)
        if (typeof window !== 'undefined' && games.length > 0) {
          const cacheKey = `dashboard-games-${start}-${end}`;
          const gamesString = JSON.stringify(games);
          safeSetSessionStorage(cacheKey, gamesString);
          safeSetSessionStorage(`${cacheKey}-timestamp`, Date.now().toString());
          // Debug logging removed(`✅ Cached ${games.length} games for dashboard pre-fetch`);
        }
      } catch (error) {
        console.error('Error fetching games:', error);
        setTodaysGames([]);
      } finally {
        setGamesLoading(false);
      }
    };

    fetchTodaysGames();

    // Preload AFL props in parallel so switching to AFL tab is instant (writes to sessionStorage only).
    // Use force-cache on enriched payload so DvP/L5/L10/H2H render immediately, then refresh for latest lines.
    (async () => {
      try {
        const listRes = await fetch('/api/afl/player-props/list', { cache: 'force-cache' });
        const listData = await listRes.json();
        const games: AflGameForProps[] = Array.isArray(listData.games) ? listData.games : [];
        const rows: any[] = Array.isArray(listData.data) ? listData.data : [];
        const keyToRow = new Map<string, { playerName: string; gameId: string; homeTeam: string; awayTeam: string; playerTeam?: string | null; statType: string; line: number; commenceTime: string; bookmakerLines: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }>; last5Avg?: number | null; last10Avg?: number | null; h2hAvg?: number | null; seasonAvg?: number | null; streak?: number | null; last5HitRate?: { hits: number; total: number } | null; last10HitRate?: { hits: number; total: number } | null; h2hHitRate?: { hits: number; total: number } | null; seasonHitRate?: { hits: number; total: number } | null; dvpRating?: number | null; dvpStatValue?: number | null }>();
        for (const r of rows) {
          const key = `${r.playerName}|${r.gameId}|${r.statType}|${r.line}`;
          const existing = keyToRow.get(key);
          const bl = { bookmaker: r.bookmaker, line: r.line, overOdds: r.overOdds || 'N/A', underOdds: r.underOdds || 'N/A' };
          if (existing) {
            existing.bookmakerLines.push(bl);
          } else {
            keyToRow.set(key, {
              playerName: r.playerName,
              gameId: r.gameId,
              homeTeam: r.homeTeam,
              awayTeam: r.awayTeam,
              playerTeam: r.playerTeam ?? null,
              statType: r.statType,
              line: r.line,
              commenceTime: r.commenceTime || '',
              bookmakerLines: [bl],
              last5Avg: r.last5Avg,
              last10Avg: r.last10Avg,
              h2hAvg: r.h2hAvg,
              seasonAvg: r.seasonAvg,
              streak: r.streak,
              last5HitRate: r.last5HitRate,
              last10HitRate: r.last10HitRate,
              h2hHitRate: r.h2hHitRate,
              seasonHitRate: r.seasonHitRate,
              dvpRating: r.dvpRating,
              dvpStatValue: r.dvpStatValue,
            });
          }
        }
        const aggregated: PlayerProp[] = Array.from(keyToRow.values()).map((a) => {
          const playerTeam = a.playerTeam && String(a.playerTeam).trim() ? a.playerTeam : null;
          const homeNorm = toOfficialAflTeamDisplayName(a.homeTeam || '');
          const awayNorm = toOfficialAflTeamDisplayName(a.awayTeam || '');
          const playerNorm = playerTeam ? toOfficialAflTeamDisplayName(playerTeam) : null;
          const team = playerNorm || homeNorm;
          const opponent = playerNorm
            ? (playerNorm === homeNorm ? awayNorm : playerNorm === awayNorm ? homeNorm : awayNorm)
            : awayNorm;
          return {
          playerName: a.playerName,
          playerId: '',
          team,
          opponent,
          statType: a.statType,
          line: a.line,
          overProb: 0,
          underProb: 0,
          overOdds: a.bookmakerLines[0]?.overOdds ?? 'N/A',
          underOdds: a.bookmakerLines[0]?.underOdds ?? 'N/A',
          impliedOverProb: 0,
          impliedUnderProb: 0,
          bestLine: a.line,
          bookmaker: a.bookmakerLines[0]?.bookmaker ?? '',
          confidence: 'Medium',
          gameDate: a.commenceTime,
          bookmakerLines: a.bookmakerLines,
          gameId: a.gameId,
          homeTeam: a.homeTeam,
          awayTeam: a.awayTeam,
          last5Avg: a.last5Avg,
          last10Avg: a.last10Avg,
          h2hAvg: a.h2hAvg,
          seasonAvg: a.seasonAvg,
          streak: a.streak,
          last5HitRate: a.last5HitRate,
          last10HitRate: a.last10HitRate,
          h2hHitRate: a.h2hHitRate,
          seasonHitRate: a.seasonHitRate,
          dvpRating: a.dvpRating,
          dvpStatValue: a.dvpStatValue,
        };
        });
        if (listData.noAflOdds === true) {
          try {
            sessionStorage.removeItem(AFL_PROPS_CACHE_KEY);
          } catch {
            // Ignore
          }
        } else if (aggregated.length > 0 || games.length > 0) {
          const toCache = {
            props: aggregated,
            games,
            selectedGameIds: getSelectedAflGameIdsForCache(games.length > 0 ? games.map((g) => g.gameId) : []),
            timestamp: Date.now(),
          };
          sessionStorage.setItem(AFL_PROPS_CACHE_KEY, JSON.stringify(toCache));
        }
      } catch {
        // Ignore; AFL tab will fetch when selected
      }
    })();
  }, []);

  // Fetch AFL games + player props list when sport is AFL. Restore from sessionStorage first so returning from dashboard is instant (stale-while-revalidate).
  // Never replace existing props with empty: if we have props (from cache or prior fetch) and the API returns empty, keep showing them.
  // When API returns empty and we had no cache, retry once after 2s (transient/cache expiry) before showing empty state.
  useEffect(() => {
    if (propsSport !== 'afl' && propsSport !== 'combined') return;
    let cancelled = false;
    let hadCache = false;
    let hadCacheWithProps = false;
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem(AFL_PROPS_CACHE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as { props?: PlayerProp[]; games?: AflGameForProps[]; selectedGameIds?: string[]; timestamp?: number };
        const age = parsed?.timestamp != null ? Date.now() - Number(parsed.timestamp) : Infinity;
        if (age < AFL_PROPS_CACHE_TTL_MS && Array.isArray(parsed?.props)) {
          setAflProps(parsed.props);
          if (Array.isArray(parsed?.games) && parsed.games.length > 0) {
            setAflGames(parsed.games);
            const hasSelectedFromCache =
              Array.isArray(parsed.selectedGameIds) && parsed.selectedGameIds.length > 0;
            if (hasSelectedFromCache) userModifiedAflGamesRef.current = true;
            const selectedIds = hasSelectedFromCache
              ? parsed.selectedGameIds!
              : parsed.games.map((g: { gameId: string }) => g.gameId);
            syncSelectedAflGames(selectedIds);
          }
          aflPropsFetchCompleteRef.current = true;
          setAflPropsLoading(false);
          hadCache = true;
          hadCacheWithProps = parsed.props.length > 0;
        }
      }
    } catch {
      // Ignore cache read errors
    }
    if (!hadCache) {
      aflPropsFetchCompleteRef.current = false;
      setAflPropsLoading(true);
    }
    const doFetch = async (
      isRetry: boolean,
      mode: 'quick' | 'fresh' = 'fresh',
    ): Promise<{ games: AflGameForProps[]; aggregated: PlayerProp[]; ingestMessage?: string; lastUpdated?: string; nextUpdate?: string; noAflOdds?: boolean }> => {
      const debugStats = typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('debugStats') === '1';
      // Quick mode: cached enriched payload for instant first click with stats already populated.
      // Fresh mode: cache-busting request so lines update right after cron refreshes.
      const listUrl = mode === 'quick'
        ? '/api/afl/player-props/list'
        : (
          debugStats
            ? `/api/afl/player-props/list?debugStats=1&cb=${Date.now()}`
            : `/api/afl/player-props/list?cb=${Date.now()}`
        );
      const listRes = await fetch(listUrl, { cache: mode === 'quick' ? 'force-cache' : 'no-store' });
      if (cancelled) return { games: [], aggregated: [], noAflOdds: false };
      const listData = await listRes.json();
      if (mode === 'fresh') {
        if (!cancelled && debugStats && listData._meta) setAflListDebugMeta(listData._meta as Record<string, unknown>);
        if (!cancelled && !debugStats) setAflListDebugMeta(null);
      }
      const games: AflGameForProps[] = Array.isArray(listData.games) ? listData.games : [];
      const rows: any[] = Array.isArray(listData.data) ? listData.data : [];
      const keyToRow = new Map<string, { playerName: string; gameId: string; homeTeam: string; awayTeam: string; playerTeam?: string | null; statType: string; line: number; commenceTime: string; bookmakerLines: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }>; last5Avg?: number | null; last10Avg?: number | null; h2hAvg?: number | null; seasonAvg?: number | null; streak?: number | null; last5HitRate?: { hits: number; total: number } | null; last10HitRate?: { hits: number; total: number } | null; h2hHitRate?: { hits: number; total: number } | null; seasonHitRate?: { hits: number; total: number } | null; dvpRating?: number | null; dvpStatValue?: number | null }>();
      for (const r of rows) {
        const key = `${r.playerName}|${r.gameId}|${r.statType}|${r.line}`;
        const existing = keyToRow.get(key);
        const bl = { bookmaker: r.bookmaker, line: r.line, overOdds: r.overOdds || 'N/A', underOdds: r.underOdds || 'N/A' };
        if (existing) {
          existing.bookmakerLines.push(bl);
        } else {
          keyToRow.set(key, {
            playerName: r.playerName,
            gameId: r.gameId,
            homeTeam: r.homeTeam,
            awayTeam: r.awayTeam,
            playerTeam: r.playerTeam ?? null,
            statType: r.statType,
            line: r.line,
            commenceTime: r.commenceTime || '',
            bookmakerLines: [bl],
            last5Avg: r.last5Avg,
            last10Avg: r.last10Avg,
            h2hAvg: r.h2hAvg,
            seasonAvg: r.seasonAvg,
            streak: r.streak,
            last5HitRate: r.last5HitRate,
            last10HitRate: r.last10HitRate,
            h2hHitRate: r.h2hHitRate,
            seasonHitRate: r.seasonHitRate,
            dvpRating: r.dvpRating,
            dvpStatValue: r.dvpStatValue,
          });
        }
      }
      const aggregated: PlayerProp[] = Array.from(keyToRow.values()).map((a) => {
        const playerTeam = a.playerTeam && String(a.playerTeam).trim() ? a.playerTeam : null;
        const homeNorm = toOfficialAflTeamDisplayName(a.homeTeam || '');
        const awayNorm = toOfficialAflTeamDisplayName(a.awayTeam || '');
        const playerNorm = playerTeam ? toOfficialAflTeamDisplayName(playerTeam) : null;
        const team = playerNorm || homeNorm;
        const opponent = playerNorm
          ? (playerNorm === homeNorm ? awayNorm : playerNorm === awayNorm ? homeNorm : awayNorm)
          : awayNorm;
        return {
          playerName: a.playerName,
          playerId: '',
          team,
          opponent,
          statType: a.statType,
          line: a.line,
          overProb: 0,
          underProb: 0,
          overOdds: a.bookmakerLines[0]?.overOdds ?? 'N/A',
          underOdds: a.bookmakerLines[0]?.underOdds ?? 'N/A',
          impliedOverProb: 0,
          impliedUnderProb: 0,
          bestLine: a.line,
          bookmaker: a.bookmakerLines[0]?.bookmaker ?? '',
          confidence: 'Medium',
          gameDate: a.commenceTime,
          bookmakerLines: a.bookmakerLines,
          gameId: a.gameId,
          homeTeam: a.homeTeam,
          awayTeam: a.awayTeam,
          last5Avg: a.last5Avg,
          last10Avg: a.last10Avg,
          h2hAvg: a.h2hAvg,
          seasonAvg: a.seasonAvg,
          streak: a.streak,
          last5HitRate: a.last5HitRate,
          last10HitRate: a.last10HitRate,
          h2hHitRate: a.h2hHitRate,
          seasonHitRate: a.seasonHitRate,
          dvpRating: a.dvpRating,
          dvpStatValue: a.dvpStatValue,
        };
      });
      return {
        games,
        aggregated,
        ingestMessage: typeof listData.ingestMessage === 'string' ? listData.ingestMessage : undefined,
        lastUpdated: typeof listData.lastUpdated === 'string' ? listData.lastUpdated : undefined,
        nextUpdate: typeof listData.nextUpdate === 'string' ? listData.nextUpdate : undefined,
        noAflOdds: listData.noAflOdds === true,
      };
    };
    (async () => {
      try {
        if (!hadCacheWithProps) {
          const quickResult = await doFetch(false, 'quick');
          if (cancelled) return;
          if (quickResult.games.length > 0) {
            setAflGames(quickResult.games);
            syncSelectedAflGames(quickResult.games.map((g) => g.gameId));
          }
          if (quickResult.aggregated.length > 0) {
            setAflProps(quickResult.aggregated);
            setAflIngestMessage(quickResult.ingestMessage ?? null);
            setAflLastUpdated(quickResult.lastUpdated ?? null);
            aflPropsFetchCompleteRef.current = true;
            setAflPropsLoading(false);
            hadCacheWithProps = true;
            try {
              sessionStorage.setItem(AFL_PROPS_CACHE_KEY, JSON.stringify({
                props: quickResult.aggregated,
                games: quickResult.games,
                selectedGameIds: getSelectedAflGameIdsForCache(
                  quickResult.games.length > 0 ? quickResult.games.map((g) => g.gameId) : []
                ),
                timestamp: Date.now(),
              }));
            } catch {
              // Ignore
            }
          }
        }

        let result = await doFetch(false, 'fresh');
        if (cancelled) return;
        if (result.noAflOdds) {
          if (!cancelled) {
            setAflGames([]);
            setAflProps([]);
            setAflIngestMessage(result.ingestMessage ?? null);
            setAflLastUpdated(result.lastUpdated ?? null);
            try {
              sessionStorage.removeItem(AFL_PROPS_CACHE_KEY);
            } catch {
              // Ignore
            }
            userModifiedAflGamesRef.current = false;
            syncSelectedAflGames([]);
            aflPropsFetchCompleteRef.current = true;
            setAflPropsLoading(false);
          }
          return;
        }
        const { games, aggregated } = result;
        setAflGames(games);
        if (!cancelled) {
          setAflIngestMessage(result.ingestMessage ?? null);
          setAflLastUpdated(result.lastUpdated ?? null);
        }
        // Retry once when empty and we had no cache (transient failure or cache expiry)
        if (aggregated.length === 0 && !hadCacheWithProps && !cancelled) {
          await new Promise((r) => setTimeout(r, 2000));
          if (cancelled) return;
          result = await doFetch(true);
          if (cancelled) return;
          const retryGames = result.games;
          const retryAggregated = result.aggregated;
          setAflGames(retryGames);
          if (retryAggregated.length > 0 || !hadCacheWithProps) {
            setAflProps(retryAggregated);
            if (retryGames.length > 0) syncSelectedAflGames(retryGames.map((g) => g.gameId));
            if (!cancelled) {
              setAflIngestMessage(result.ingestMessage ?? null);
              setAflLastUpdated(result.lastUpdated ?? null);
              try {
                sessionStorage.setItem(AFL_PROPS_CACHE_KEY, JSON.stringify({
                  props: retryAggregated,
                  games: retryGames,
                  selectedGameIds: getSelectedAflGameIdsForCache(
                    retryGames.length > 0 ? retryGames.map((g) => g.gameId) : []
                  ),
                  timestamp: Date.now(),
                }));
              } catch {
                // Ignore
              }
            }
          }
          if (!cancelled && retryAggregated.length === 0) {
            // Retry list fetch so we pick up data when cron has run. Do not call /api/afl/odds/refresh from the client:
            // that route runs execSync(build-afl-dvp) and heavy work that blocks the Node process and freezes the dev server.
            const delays = [12000, 27000, 45000];
            const timeouts: ReturnType<typeof setTimeout>[] = [];
            delays.forEach((delay) => {
              const t = setTimeout(async () => {
                if (cancelled) return;
                const res = await doFetch(true);
                if (cancelled) return;
                  if (res.aggregated.length > 0) {
                    setAflGames(res.games);
                    setAflProps(res.aggregated);
                    if (res.games.length > 0) syncSelectedAflGames(res.games.map((g) => g.gameId));
                  if (!cancelled) {
                    setAflIngestMessage(res.ingestMessage ?? null);
                    setAflLastUpdated(res.lastUpdated ?? null);
                  }
                  try {
                    sessionStorage.setItem(AFL_PROPS_CACHE_KEY, JSON.stringify({
                      props: res.aggregated,
                      games: res.games,
                      selectedGameIds: getSelectedAflGameIdsForCache(
                        res.games.length > 0 ? res.games.map((g) => g.gameId) : []
                      ),
                      timestamp: Date.now(),
                    }));
                  } catch {
                    // Ignore
                  }
                  aflRetryTimeoutsRef.current.forEach((id) => clearTimeout(id));
                  aflRetryTimeoutsRef.current = [];
                }
              }, delay);
              timeouts.push(t);
            });
            aflRetryTimeoutsRef.current = timeouts;
          }
          if (!cancelled) {
            aflPropsFetchCompleteRef.current = true;
            setAflPropsLoading(false);
          }
          return;
        }
        // Never replace existing props with empty: if we had props (from cache) and API returned empty, keep showing them
        if (aggregated.length > 0 || !hadCacheWithProps) {
          setAflProps(aggregated);
          if (games.length > 0) {
            syncSelectedAflGames(games.map((g) => g.gameId));
          }
          if (!cancelled) {
            setAflIngestMessage(result.ingestMessage ?? null);
            setAflLastUpdated(result.lastUpdated ?? null);
            try {
              const toCache = {
                props: aggregated,
                games,
              selectedGameIds: getSelectedAflGameIdsForCache(
                games.length > 0 ? games.map((g) => g.gameId) : []
              ),
                timestamp: Date.now(),
              };
              sessionStorage.setItem(AFL_PROPS_CACHE_KEY, JSON.stringify(toCache));
            } catch {
              // Ignore cache write (quota, etc.)
            }
          }
        } else if (games.length > 0) {
          setAflGames(games);
          syncSelectedAflGames(games.map((g) => g.gameId));
        }
      } catch (e) {
        if (!cancelled && !hadCacheWithProps) {
          setAflGames([]);
          setAflProps([]);
        }
      } finally {
        if (!cancelled) {
          aflPropsFetchCompleteRef.current = true;
          setAflPropsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      aflRetryTimeoutsRef.current.forEach((id) => clearTimeout(id));
      aflRetryTimeoutsRef.current = [];
    };
  }, [propsSport, aflPropsRetryKey]);

  // Persist AFL props + game filter to sessionStorage when user changes selection (so returning from dashboard restores filter)
  useEffect(() => {
    if (propsSport !== 'afl' || aflProps.length === 0 || aflGames.length === 0) return;
    try {
      const toCache = {
        props: aflProps,
        games: aflGames,
        selectedGameIds: Array.from(selectedAflGames),
        timestamp: Date.now(),
      };
      sessionStorage.setItem(AFL_PROPS_CACHE_KEY, JSON.stringify(toCache));
    } catch {
      // Ignore quota etc.
    }
  }, [propsSport, aflProps, aflGames, selectedAflGames]);

  // Find-player modal: use exact same search as AFL dashboard (fetchPlayers + client-side filter)
  useEffect(() => {
    if (!findPlayerOpen) return;
    const q = findPlayerQuery.trim();
    if (!q || q.length < 2) {
      setFindPlayerResults([]);
      return;
    }
    if (findPlayerDebounceRef.current) clearTimeout(findPlayerDebounceRef.current);
    findPlayerDebounceRef.current = setTimeout(async () => {
      findPlayerDebounceRef.current = null;
      setFindPlayerLoading(true);
      try {
        if (propsSport === 'afl') {
          // Match dashboard exactly: same API, same mapping, same client filter. Request limit 100 so API returns full set (dashboard gets 60 for single-word via effectiveLimit; we ask 100 to get everything).
          const params = new URLSearchParams({ query: q, limit: '100' });
          const res = await fetch(`/api/afl/players?${params.toString()}`, { cache: 'no-store' });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data?.error || 'Failed to load players');
          }
          const list = Array.isArray(data?.players) ? data.players : [];
          const searchResults = list.map((p: Record<string, unknown>) => ({
            name: String(p?.name ?? '-'),
            team: typeof p?.team === 'string' ? p.team : undefined,
          }));
          // Same client-side filter as dashboard: name.includes(q) — show all matches (dashboard slices to 12 for dropdown; we show all)
          const qLower = q.toLowerCase();
          const filtered = searchResults.filter((p: { name: string; team?: string }) =>
            (p.name ?? '').toLowerCase().includes(qLower)
          );
          setFindPlayerResults(filtered);
        } else {
          const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(q)}&per_page=25`, { cache: 'no-store' });
          const data = await res.json();
          let list = Array.isArray(data?.results) ? data.results : [];
          list = list.map((p: { full?: string; team?: string }) => ({ name: String(p?.full ?? ''), team: p?.team }));
          const qLower = q.toLowerCase();
          list = list.filter((p: { name: string; team?: string }) => (p.name || '').toLowerCase().includes(qLower));
          setFindPlayerResults(list.slice(0, 25));
        }
      } catch {
        setFindPlayerResults([]);
      } finally {
        setFindPlayerLoading(false);
      }
    }, 250);
    return () => {
      if (findPlayerDebounceRef.current) clearTimeout(findPlayerDebounceRef.current);
    };
  }, [findPlayerOpen, findPlayerQuery, propsSport]);

  // Fetch AFL league player stats for jumper numbers (for circle placeholder)
  useEffect(() => {
    if ((propsSport !== 'afl' && propsSport !== 'combined') || aflProps.length === 0) return;
    const season = new Date().getFullYear();
    Promise.all([
      fetch(`/api/afl/league-player-stats?season=${season}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/afl/league-player-stats?season=${season - 1}`).then((r) => r.ok ? r.json() : null),
    ]).then(([curr, prev]) => {
      const map: Record<string, number> = {};
      const add = (data: { players?: Array<{ name?: string; number?: number }> } | null) => {
        if (!data?.players) return;
        for (const p of data.players) {
          const name = (p?.name ?? '').trim();
          const num = typeof p?.number === 'number' && Number.isFinite(p.number) ? p.number : null;
          if (name && num != null) map[name] = num;
        }
      };
      add(prev);
      add(curr);
      setAflPlayerNumbers(map);
    }).catch(() => {});
  }, [propsSport, aflProps.length]);

  // Fetch AFL team logos for matchup display (when on AFL tab)
  useEffect(() => {
    if (propsSport !== 'afl' && propsSport !== 'combined') return;
    let hasFreshCache = false;
    try {
      const cachedRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_KEY);
      const cachedTsRaw = sessionStorage.getItem(AFL_TEAM_LOGOS_CACHE_TS_KEY);
      const cachedTs = cachedTsRaw ? parseInt(cachedTsRaw, 10) : 0;
      const age = Number.isFinite(cachedTs) ? Date.now() - cachedTs : Infinity;
      if (cachedRaw && age < AFL_TEAM_LOGOS_CACHE_TTL_MS) {
        const parsed = JSON.parse(cachedRaw);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          setAflLogoByTeam(parsed as Record<string, string>);
          hasFreshCache = true;
        }
      }
    } catch {
      // ignore cache read errors
    }

    // If we already have fresh cached logos, avoid unnecessary fetch on quick back-nav.
    if (hasFreshCache) return;

    fetch('/api/afl/team-logos', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { logos?: Record<string, string> } | null) => {
        if (data?.logos && typeof data.logos === 'object' && Object.keys(data.logos).length > 0) {
          setAflLogoByTeam(data.logos);
          try {
            sessionStorage.setItem(AFL_TEAM_LOGOS_CACHE_KEY, JSON.stringify(data.logos));
            sessionStorage.setItem(AFL_TEAM_LOGOS_CACHE_TS_KEY, Date.now().toString());
          } catch {
            // ignore cache write errors
          }
        }
      })
      .catch(() => {});
  }, [propsSport]);

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

  // Pre-load team data in background (non-blocking)
  const preloadTeamData = async (teams: string[], season: number) => {
    if (!teams || teams.length === 0) return;
    
    // Debug logging removed(`[NBA Landing] 🚀 Starting background pre-load for ${teams.length} teams...`);
    
    // Pre-load league-wide data first (only need to fetch once)
    const leagueWidePromises = [
      // Team defensive rankings (shot chart) - returns all teams
      fetch(`/api/team-defense-rankings?season=${season}`, { cache: 'default' }).catch(() => {}),
    ];
    await Promise.all(leagueWidePromises);
    
    // Pre-load team-specific data in batches
    const batchSize = 3;
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize);
      
      // Pre-load all team data in parallel for this batch
      const promises = batch.flatMap(team => [
        // Team tracking stats (passing)
        fetch(`/api/tracking-stats/team?team=${team}&season=${season}&category=passing`, { cache: 'default' }).catch(() => {}),
        // Team tracking stats (rebounding)
        fetch(`/api/tracking-stats/team?team=${team}&season=${season}&category=rebounding`, { cache: 'default' }).catch(() => {}),
        // Team tracking stats (last 5 games - passing)
        fetch(`/api/tracking-stats/team?team=${team}&season=${season}&category=passing&lastNGames=5`, { cache: 'default' }).catch(() => {}),
        // Team tracking stats (last 5 games - rebounding)
        fetch(`/api/tracking-stats/team?team=${team}&season=${season}&category=rebounding&lastNGames=5`, { cache: 'default' }).catch(() => {}),
      ]);
      
      await Promise.all(promises);
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < teams.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    
    // Debug logging removed(`[NBA Landing] ✅ Finished pre-loading team data for ${teams.length} teams`);
  };

  // Track if props are loaded (to prevent clearing on refresh)
  // Initialize to false - will be set to true when props are loaded
  // Note: We removed initialState check to prevent hydration mismatch
  
  // Helper function to safely set sessionStorage with size check
  const safeSetSessionStorage = (key: string, value: string): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      // Check size before storing (rough estimate: 1 char ≈ 1 byte for JSON)
      const estimatedSize = value.length;
      if (estimatedSize > SESSION_STORAGE_MAX_SIZE) {
        console.warn(`[NBA Landing] Data too large for sessionStorage (${estimatedSize} bytes):`, key);
        return false;
      }
      sessionStorage.setItem(key, value);
      return true;
    } catch (e: any) {
      // Handle QuotaExceededError specifically
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn(`[NBA Landing] SessionStorage quota exceeded for key:`, key);
      } else {
        console.warn(`[NBA Landing] Failed to set sessionStorage:`, key, e);
      }
      return false;
    }
  };

  // Fetch player props with good win chances from BDL
  useEffect(() => {
    // Cache keys (defined outside functions so they're accessible to both fetchPlayerProps and checkOddsUpdate)
    const CACHE_KEY = 'nba-player-props-cache';
    const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
    
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
            // Debug logging removed('[NBA Landing] 🧹 Cleared sessionStorage for force refresh');
          } catch (e) {
            console.warn('[NBA Landing] Failed to clear sessionStorage:', e);
          }
        }
        
        // Define cacheUrl early so it's available in all code paths
        const cacheUrl = '/api/nba/player-props';
        
        // If we already have props from useLayoutEffect cache or prior load, just refresh in background
        if (propsLoadedRef.current) {
          // Debug logging removed(`[NBA Landing] ✅ Props already loaded from initialization (${playerProps.length} props), refreshing in background...`);
          // Refresh in background without showing loading state
          fetch(cacheUrl, { cache: forceRefresh ? 'no-store' : 'default' }).then(async (response) => {
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
                setPlayerProps(data.data);
                if (typeof window !== 'undefined') {
                  const dataString = JSON.stringify(data.data);
                  safeSetSessionStorage(CACHE_KEY, dataString);
                  safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
                }
              }
            }
          }).catch(() => {});
          return; // Skip the main fetch, props are already displayed
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
                  // Debug logging removed(`[NBA Landing] ✅ Using cached player props from sessionStorage (${parsed.length} props, ${Math.round(age / 1000)}s old)`);
                  
                  // Merge in any calculated stats from sessionStorage
                  let propsWithMergedStats = parsed;
                  try {
                    const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
                    const stored = sessionStorage.getItem(CALCULATED_STATS_KEY);
                    if (stored) {
                      const calculatedStats = JSON.parse(stored);
                      if (Array.isArray(calculatedStats)) {
                        const calculatedMap = new Map<string, PlayerProp>();
                        calculatedStats.forEach((prop: PlayerProp) => {
                          const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                          calculatedMap.set(key, prop);
                        });
                        
                        // Merge calculated stats into props
                        propsWithMergedStats = parsed.map((prop: PlayerProp) => {
                          const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                          const calculated = calculatedMap.get(key);
                          if (calculated) {
                            return {
                              ...prop,
                              h2hAvg: calculated.h2hAvg ?? prop.h2hAvg,
                              seasonAvg: calculated.seasonAvg ?? prop.seasonAvg,
                              h2hHitRate: calculated.h2hHitRate ?? prop.h2hHitRate,
                              seasonHitRate: calculated.seasonHitRate ?? prop.seasonHitRate,
                            };
                          }
                          return prop;
                        });
                        
                        // Also update the calculated stats state
                        setPropsWithCalculatedStats(calculatedMap);
                        calculatedStats.forEach((prop: PlayerProp) => {
                          const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                          calculatedKeysRef.current.add(key);
                        });
                      }
                    }
                  } catch (e) {
                    // Ignore errors
                  }
                  
                  setPlayerProps(propsWithMergedStats);
                  propsLoadedRef.current = true; // Mark as loaded
                  initialFetchCompletedRef.current = true; // Mark initial fetch as completed
                  setPropsLoading(false);
                  // Still fetch in background to update if needed (non-blocking)
                  fetch(cacheUrl, { cache: 'default' }).then(async (response) => {
                    if (response.ok) {
                      const data = await response.json();
                      if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
                        setPlayerProps(data.data);
                        const dataString = JSON.stringify(data.data);
                        safeSetSessionStorage(CACHE_KEY, dataString);
                        safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
                      }
                    }
                  }).catch(() => {});
                  return; // Use cached data immediately, update in background
                }
              } catch (e) {
                console.warn('[NBA Landing] ⚠️ Failed to parse cached data, fetching fresh');
              }
            } else {
              // Debug logging removed(`[NBA Landing] ⏰ Cache expired (${Math.round(age / 1000)}s old), fetching fresh`);
            }
          }
        }
        
        // Only set loading if we don't have props already (don't clear existing props)
        if (!propsLoadedRef.current) {
          setPropsLoading(true);
        }
        
        // Only read from cache - no processing on client side
        // Processing is done server-side by cron job
        // Always read from cache - refresh=1 just forces a fresh fetch (no cache headers)
        const cacheResponse = await fetch(cacheUrl, {
          cache: forceRefresh ? 'no-store' : 'default'
        });
        // Debug logging removed(`[NBA Landing] API response status: ${cacheResponse.status}`);
        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();
          if (cacheData.success && cacheData.data && Array.isArray(cacheData.data) && cacheData.data.length > 0) {
            // Debug logging removed(`[NBA Landing] ✅ Using cached player props data (${cacheData.data.length} props)`);
          
          // Debug: Check which stat types are present
          const statTypes = new Set(cacheData.data.map((p: PlayerProp) => p.statType));
          // Debug logging removed(`[NBA Landing] 📊 Stat types in cache:`, Array.from(statTypes).sort());
          const stlCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'STL').length;
          const blkCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'BLK').length;
          const threesCount = cacheData.data.filter((p: PlayerProp) => p.statType === 'THREES').length;
          // Debug logging removed(`[NBA Landing] 📊 STL props: ${stlCount}, BLK props: ${blkCount}, THREES props: ${threesCount}`);
          
          // Debug: Check bookmakerLines counts
          const propsWithMultipleBookmakers = cacheData.data.filter((p: PlayerProp) => 
            p.bookmakerLines && Array.isArray(p.bookmakerLines) && p.bookmakerLines.length > 1
          );
          const propsWithOneBookmaker = cacheData.data.filter((p: PlayerProp) => 
            p.bookmakerLines && Array.isArray(p.bookmakerLines) && p.bookmakerLines.length === 1
          );
          // Debug logging removed(`[NBA Landing] 📊 Bookmakers: ${propsWithMultipleBookmakers.length} props with multiple, ${propsWithOneBookmaker.length} props with single`);
          
          // Sample a prop to see its bookmakerLines
          if (cacheData.data.length > 0) {
            const sampleProp = cacheData.data[0] as PlayerProp;
          }
          
          // Merge in any calculated stats from sessionStorage
          let propsWithMergedStats = cacheData.data;
          if (typeof window !== 'undefined') {
            try {
              const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
              const stored = sessionStorage.getItem(CALCULATED_STATS_KEY);
              if (stored) {
                const calculatedStats = JSON.parse(stored);
                if (Array.isArray(calculatedStats)) {
                  const calculatedMap = new Map<string, PlayerProp>();
                  calculatedStats.forEach((prop: PlayerProp) => {
                    const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                    calculatedMap.set(key, prop);
                  });
                  
                  // Merge calculated stats into props
                  propsWithMergedStats = cacheData.data.map((prop: PlayerProp) => {
                    const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                    const calculated = calculatedMap.get(key);
                    if (calculated) {
                      return {
                        ...prop,
                        h2hAvg: calculated.h2hAvg ?? prop.h2hAvg,
                        seasonAvg: calculated.seasonAvg ?? prop.seasonAvg,
                        h2hHitRate: calculated.h2hHitRate ?? prop.h2hHitRate,
                        seasonHitRate: calculated.seasonHitRate ?? prop.seasonHitRate,
                      };
                    }
                    return prop;
                  });
                  
                  // Also update the calculated stats state
                  setPropsWithCalculatedStats(calculatedMap);
                  calculatedStats.forEach((prop: PlayerProp) => {
                    const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
                    calculatedKeysRef.current.add(key);
                  });
                }
              }
            } catch (e) {
              // Ignore errors
            }
          }
          
            setPlayerProps(propsWithMergedStats);
            propsLoadedRef.current = true; // Mark as loaded
            initialFetchCompletedRef.current = true; // Mark initial fetch as completed
            setPropsProcessing(false); // Reset processing state when we have data
            
            // Save to sessionStorage for instant load on back navigation
            if (typeof window !== 'undefined') {
              const dataString = JSON.stringify(cacheData.data);
              if (safeSetSessionStorage(CACHE_KEY, dataString)) {
                safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
                // Debug logging removed(`[NBA Landing] 💾 Cached ${cacheData.data.length} player props to sessionStorage`);
              }
            }
            
            // Pre-load team data in background for teams with games today
            const uniqueTeams = new Set<string>();
            cacheData.data.forEach((prop: PlayerProp) => {
              if (prop.team) uniqueTeams.add(prop.team);
              if (prop.opponent) uniqueTeams.add(prop.opponent);
            });
            
            if (uniqueTeams.size > 0) {
              // Debug logging removed(`[NBA Landing] 🚀 Pre-loading team data for ${uniqueTeams.size} teams in background...`);
              preloadTeamData(Array.from(uniqueTeams), currentNbaSeason()).catch(err => {
                console.warn('[NBA Landing] ⚠️ Error pre-loading team data:', err);
              });
            }
            
            setPropsLoading(false);
            return;
          } else {
            console.warn(`[NBA Landing] ⚠️ No cached data available - cache is being populated`);
            // Don't clear existing props - keep them visible
            if (!propsLoadedRef.current) {
              setPlayerProps([]);
            }
            setPropsProcessing(!cacheData.cached); // Show processing state if cache is empty
            initialFetchCompletedRef.current = true; // Mark initial fetch as completed
            setPropsLoading(false);
            
            // Note: Player props processing is handled by GitHub workflow (process-player-props.yml)
            // No need to trigger from frontend - reduces server load and prevents duplicate processing
            return;
          }
        } else {
          console.warn(`[NBA Landing] Cache API error: ${cacheResponse.status} ${cacheResponse.statusText}`);
          // Don't clear existing props on error - keep them visible
          if (!propsLoadedRef.current) {
            setPlayerProps([]);
          }
          initialFetchCompletedRef.current = true; // Mark initial fetch as completed even on error
          setPropsLoading(false);
          return;
        }
      } catch (error) {
        console.error('[NBA Landing] Error fetching player props:', error);
        // Don't clear existing props on error - keep them visible
        if (!propsLoadedRef.current) {
          setPlayerProps([]);
        }
        initialFetchCompletedRef.current = true; // Mark initial fetch as completed even on error
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
            // Odds have been updated - refresh player props in background (don't clear existing)
            // Debug logging removed('[NBA Landing] 🔄 Odds updated, refreshing player props in background...');
            // Fetch new props in background and update when ready
            fetch('/api/nba/player-props', { cache: 'default' }).then(async (response) => {
                  if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
                      setPlayerProps(data.data);
                      if (typeof window !== 'undefined') {
                        const dataString = JSON.stringify(data.data);
                        safeSetSessionStorage(CACHE_KEY, dataString);
                        safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
                      }
                    }
                  }
            }).catch(() => {});
          }
          
          lastOddsTimestamp = currentTimestamp;
        }
      } catch (err) {
        // Ignore errors - this is a background check
      }
    };
    
    // Check every 10 minutes for odds updates (reduced from 2 minutes)
    const oddsCheckInterval = setInterval(checkOddsUpdate, ODDS_CHECK_INTERVAL_MS);
    
    // Initial check after 30 seconds (give odds refresh time to complete)
    const initialCheckTimeout = setTimeout(() => {
      checkOddsUpdate();
    }, INITIAL_ODDS_CHECK_DELAY_MS);
    
    return () => {
      clearInterval(oddsCheckInterval);
      clearTimeout(initialCheckTimeout);
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
          // Debug logging removed(`[getDvpRating] Fetching rank: ${url} (opponent: "${opponent}" -> teamAbbr: "${teamAbbr}")`);
      
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn(`[getDvpRating] Rank API not ok: ${response.status} for ${url}`, errorText);
        return { rank: null, statValue: null };
      }
      
      const data = await response.json();
      // Debug logging removed(`[getDvpRating] Rank response for ${opponent} (${teamAbbr}) ${position} ${statType}:`, data);
      
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
      
      // Debug logging removed(`[getDvpRating] ✅ Extracted rank: ${rankValue}, statValue: ${statValue} for ${opponent} (${teamAbbr}) ${position} ${statType}`);
      return { rank: rankValue, statValue };
    } catch (error) {
      console.error(`[getDvpRating] Error for ${opponent} ${position} ${statType}:`, error);
      return { rank: null, statValue: null };
    }
  };

// Debug helpers
const DEBUG_H2H_PLAYER = (process.env.NEXT_PUBLIC_DEBUG_H2H_PLAYER || '').toLowerCase().trim();

// LRU Cache implementation for player stats
class LRUCache<T> {
  private cache = new Map<string, T>();
  private readonly maxSize: number;
  private accessOrder = new Map<string, number>();

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Update access time for LRU
      this.accessOrder.set(key, Date.now());
    }
    return value;
  }

  set(key: string, value: T): void {
    // If cache is full, evict least recently used
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    this.cache.set(key, value);
    this.accessOrder.set(key, Date.now());
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.accessOrder.delete(key);
  }

  private evictLRU(): void {
    if (this.accessOrder.size === 0) return;
    
    // Find least recently used key
    let lruKey: string | null = null;
    let lruTime = Infinity;
    
    for (const [key, time] of this.accessOrder.entries()) {
      if (time < lruTime) {
        lruTime = time;
        lruKey = key;
      }
    }
    
    if (lruKey) {
      this.cache.delete(lruKey);
      this.accessOrder.delete(lruKey);
    }
  }
}

// LRU caches to reduce duplicate /api/stats calls per player/season/postseason
// Limited to 100 entries each to prevent memory leaks
const playerStatsCache = new LRUCache<any[]>(100);
const playerStatsPromiseCache = new LRUCache<Promise<any[]>>(50);

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
        const cached = playerStatsCache.get(cacheKey);
        if (cached) {
          return cached;
        }
        // If a fetch is already in flight, await it
        const pendingPromise = playerStatsPromiseCache.get(cacheKey);
        if (pendingPromise) {
          return pendingPromise;
        }

        const fetchSingle = async (postseason: boolean, suffix: string): Promise<any[]> => {
          // Use queued fetch to prevent rate limiting
          const { queuedFetch } = await import('@/lib/requestQueue');
          const singleCacheKey = `${playerId}-${yr}-${postseason ? 'po' : 'reg'}`;
          
          // Return cached data if available
          const cachedSingle = playerStatsCache.get(singleCacheKey);
          if (cachedSingle) {
            return cachedSingle;
          }
          
          for (let attempt = 0; attempt <= retries; attempt++) {
            try {
              const url = `/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=3&postseason=${postseason}`;
              const requestId = `stats-${playerId}-${yr}-${suffix}`;
              // Debug logging removed(`[calculatePlayerAverages] Fetching ${suffix}: ${url} (attempt ${attempt + 1}/${retries + 1})`);
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
                // Debug logging removed(`[calculatePlayerAverages] Got ${data.length} stats (${r.status === 429 ? 'cached' : 'fresh'}) for ${playerName} (${playerId}), season ${yr}, ${suffix}`);
                playerStatsCache.set(singleCacheKey, data);
                return data;
              }
              
              if (r.status === 429) {
                if (attempt < retries) {
                  const waitTime = (attempt + 1) * 2000;
                  // Debug logging removed(`[calculatePlayerAverages] Rate limited, waiting ${waitTime}ms before retry...`);
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
                    // Debug logging removed(`[calculatePlayerAverages] Got ${data.length} cached stats from 429 error for ${playerName} (${playerId}), season ${yr}, ${suffix}`);
                    playerStatsCache.set(singleCacheKey, data);
                    return data;
                  }
                } catch (parseError) {
                  // Failed to parse error response, continue to retry logic
                }
              }
              
              if (attempt < retries) {
                const waitTime = (attempt + 1) * 1000;
                // Debug logging removed(`[calculatePlayerAverages] Error on attempt ${attempt + 1}, retrying in ${waitTime}ms...`);
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
      
      const validStats = allStats.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
      // Debug logging removed(`[calculatePlayerAverages] Valid stats after filter: ${validStats.length} out of ${allStats.length}`);
      
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
      // Debug logging removed(`[calculatePlayerAverages] Deduplicated: ${validStats.length} → ${uniqueStats.length} unique games`);
      
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
      
      // Debug logging removed(`[calculatePlayerAverages] ${playerName} ${statType}: ${gamesWithMinutes.length} games with minutes > 0`);
      
      // Log sample stat structure to debug stat extraction
      if (gamesWithMinutes.length > 0) {
        const sample = gamesWithMinutes[0];
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
      
      // Debug logging removed(`[calculatePlayerAverages] ${playerName} ${statType}: ${gamesWithStats.length} games with valid stat values (from ${gamesWithMinutes.length} games with minutes)`);

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

      // Filter to current season games only (same logic as server-side)
      const getSeasonYear = (stats: any) => {
        if (!stats?.game?.date) return null;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        return gameMonth >= 9 ? gameYear : gameYear - 1;
      };

      const currentSeasonGames = gamesWithStats.filter((stats: any) => {
        const gameSeasonYear = getSeasonYear(stats);
        return gameSeasonYear === currentSeason;
      });

      // Season average: Calculate average from current season games only
      const seasonValues = currentSeasonGames.map((g: any) => g.statValue);
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
        }
        
        // FIXED to handle players who changed teams
        // The key insight: if a player has stats for a game, and the opponent we're looking for
        // is one of the teams in that game, then the player played against that opponent
        // (regardless of which team the player was on - this correctly handles team changes)
        h2hStats = gamesWithStats
          .filter((stats: any) => {
            // Get both teams from the game
            const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
            const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
            const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
            const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
            
            if (!homeTeamAbbr || !visitorTeamAbbr) {
              return false;
            }
            
            const homeNorm = normalizeAbbr(homeTeamAbbr);
            const awayNorm = normalizeAbbr(visitorTeamAbbr);
            
            // If the opponent we're looking for is in this game, and the player has stats for it,
            // then the player played against that opponent (regardless of which team they were on)
            // This correctly handles players who changed teams - we don't need to know which team
            // the player was on, we just need to know if the opponent is in the game
            const opponentInGame = homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
            
            // Player has stats for this game (gamesWithStats already filters for minutes > 0),
            // so if the opponent is in the game, this is an H2H match
            return opponentInGame;
          })
          .slice(0, 6) // Limit to last 6 H2H games
          .map((s: any) => s.statValue);
        
        h2hAvg = h2hStats.length > 0
          ? h2hStats.reduce((sum: number, val: number) => sum + val, 0) / h2hStats.length
          : null;
        
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

  // Memoize getStatLabel to prevent recreation on every render
  const getStatLabel = useCallback((statType: string) => {
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
      'PA': 'Points + Assists',
      'RA': 'Rebounds + Assists',
      // AFL
      'disposals': 'Disposals',
      'disposals_over': 'Disposals Over',
      'anytime_goal_scorer': 'Anytime Goal Scorer',
      'goals_over': 'Goals Over',
    };
    return labels[statType] || statType;
  }, []);

  const getAflInitials = (name: string): string => {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0]! + parts[parts.length - 1]![0]).toUpperCase();
    if (parts.length === 1) return (parts[0]!.slice(0, 2) || '?').toUpperCase();
    return '?';
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

    const ordered = Array.from(types);

    // Desired display order for prop types
    const ORDER: string[] = [
      'PTS',   // points
      'REB',   // rebounds
      'AST',   // assists
      'THREES', // 3PM (props page uses THREES)
      'FG3M',  // fallback 3PM key if present
      'PRA',
      'PR',
      'PA',
      'RA',
      'STL',
      'BLK',
    ];

    const orderIndex = (type: string) => {
      const upper = type.toUpperCase();
      const idx = ORDER.indexOf(upper);
      return idx === -1 ? ORDER.length : idx;
    };

    ordered.sort((a, b) => {
      const ia = orderIndex(a);
      const ib = orderIndex(b);
      if (ia !== ib) return ia - ib;
      // For any types not explicitly ordered, fall back to alphabetical
      return a.localeCompare(b);
    });

    return ordered;
  }, [playerProps]);

  // Save filters to localStorage helper (defined before useEffects)
  const saveFiltersToStorage = (bookmakers: Set<string>, propTypes: Set<string>, games: Set<number>) => {
    if (typeof window === 'undefined') return;
    try {
      try {
        localStorage.setItem('nba_filters_bookmakers', JSON.stringify(Array.from(bookmakers)));
        localStorage.setItem('nba_filters_propTypes', JSON.stringify(Array.from(propTypes)));
        localStorage.setItem('nba_filters_games', JSON.stringify(Array.from(games)));
      } catch (e: any) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
          console.warn('[NBA Landing] localStorage quota exceeded when saving filters');
        } else {
          console.warn('[NBA Landing] Failed to save filters to localStorage:', e);
        }
      }
    } catch (e) {
      console.warn('[NBA Landing] Failed to save filters to localStorage:', e);
    }
  };

  // NBA: ensure all bookmakers/prop types selected when none or invalid (e.g. after switching from AFL)
  useEffect(() => {
    if (propsSport !== 'nba' || availableBookmakers.length === 0) return;
    const hasOverlap = Array.from(selectedBookmakers).some((b) => availableBookmakers.includes(b));
    if (selectedBookmakers.size > 0 && hasOverlap) return; // user has a valid selection
    let parsed: string[] = [];
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('nba_filters_bookmakers') : null;
      parsed = saved ? JSON.parse(saved) : [];
    } catch {
      parsed = [];
    }
    const savedOverlap = parsed.length > 0 && parsed.some((b: string) => availableBookmakers.includes(b));
    if (savedOverlap) {
      setSelectedBookmakers(new Set(parsed.filter((b: string) => availableBookmakers.includes(b))));
    } else {
      const defaultBookmakers = availableBookmakers.filter((bm) => bm.toLowerCase() !== 'betway');
      const newSet = new Set(defaultBookmakers);
      setSelectedBookmakers(newSet);
      saveFiltersToStorage(newSet, selectedPropTypes, selectedGames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsSport, availableBookmakers]);

  useEffect(() => {
    if (propsSport !== 'nba' || availablePropTypes.length === 0) return;
    const hasOverlap = Array.from(selectedPropTypes).some((t) => availablePropTypes.includes(t));
    if (selectedPropTypes.size > 0 && hasOverlap) return;
    let parsed: string[] = [];
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('nba_filters_propTypes') : null;
      parsed = saved ? JSON.parse(saved) : [];
    } catch {
      parsed = [];
    }
    const savedOverlap = parsed.length > 0 && parsed.some((t: string) => availablePropTypes.includes(t));
    if (savedOverlap) {
      setSelectedPropTypes(new Set(parsed.filter((t: string) => availablePropTypes.includes(t))));
    } else {
      const newSet = new Set(availablePropTypes);
      setSelectedPropTypes(newSet);
      saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsSport, availablePropTypes]);

  // Helper to match a prop to a game based on team/opponent
  // OPTIMIZATION: useCallback to prevent unnecessary re-creation on every render
  const getGameForProp = useCallback((prop: PlayerProp): Game | null => {
    if (todaysGames.length === 0) {
      return null;
    }
    
    // Normalize team names to abbreviations - handle both full names and abbreviations
    const normalizeTeam = (team: string): string => {
      if (!team) return '';
      const upper = team.toUpperCase().trim().replace(/\./g, '');
      // Check if it's already an abbreviation (3 letters or less)
      if (upper.length <= 3) {
        return NBA_TEAM_ABBR_ALIASES[upper] || upper;
      }
      // Try to find abbreviation from full name
      const abbr = TEAM_FULL_TO_ABBR[upper] || TEAM_FULL_TO_ABBR[team] || null;
      if (!abbr) return upper;
      const normalizedAbbr = abbr.toUpperCase().replace(/\./g, '');
      return NBA_TEAM_ABBR_ALIASES[normalizedAbbr] || normalizedAbbr;
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
        // Debug logging removed
      }
    }
    
    return matchedGame || null;
  }, [todaysGames]); // OPTIMIZATION: Only recreate when todaysGames changes

  const getTipoffGameForRow = useCallback((prop: PlayerProp, rowSport: 'nba' | 'afl'): Game | null => {
    if (prop.gameDate) {
      const parsedGameDate = new Date(prop.gameDate);
      if (!Number.isNaN(parsedGameDate.getTime())) {
        if (rowSport === 'afl') {
          return {
            id: 0,
            date: prop.gameDate.slice(0, 10),
            status: prop.gameDate,
            home_team: { id: 0, abbreviation: '' },
            visitor_team: { id: 0, abbreviation: '' },
            datetime: prop.gameDate
          };
        }
      }
    }

    const matchedGame = getGameForProp(prop);
    if (matchedGame) {
      return matchedGame;
    }

    // Fallback for NBA rows when game matchup lookup fails.
    if (rowSport === 'nba' && prop.gameDate) {
      return {
        id: 0,
        date: prop.gameDate.slice(0, 10),
        status: prop.gameDate,
        home_team: { id: 0, abbreviation: '' },
        visitor_team: { id: 0, abbreviation: '' },
        datetime: prop.gameDate
      };
    }

    return null;
  }, [getGameForProp]);

  // Only show games that have at least one player prop
  const gamesWithProps = useMemo(() => {
    if (playerProps.length === 0 || todaysGames.length === 0) return [];
    const idsWithProps = new Set<number>();
    playerProps.forEach((prop) => {
      const game = getGameForProp(prop);
      if (game?.id) {
        idsWithProps.add(game.id);
      }
    });
    return todaysGames.filter((game) => idsWithProps.has(game.id));
  }, [playerProps, todaysGames, getGameForProp]);

  // AFL: games that have at least one prop, and filtered AFL props
  const aflGamesWithProps = useMemo(() => {
    if (aflProps.length === 0 || aflGames.length === 0) return [];
    const ids = new Set<string>();
    aflProps.forEach((p) => {
      if (p.gameId) ids.add(p.gameId);
    });
    return aflGames.filter((g) => ids.has(g.gameId));
  }, [aflProps, aflGames]);

  const availableAflBookmakers = useMemo(() => {
    const bookmakers = new Set<string>();
    aflProps.forEach((prop) => {
      prop.bookmakerLines?.forEach((l) => l.bookmaker && bookmakers.add(l.bookmaker));
      if (prop.bookmaker) bookmakers.add(prop.bookmaker);
    });
    return Array.from(bookmakers).sort();
  }, [aflProps]);

  const availableAflPropTypes = useMemo(() => {
    const types = new Set<string>();
    aflProps.forEach((p) => p.statType && types.add(p.statType));
    const order = ['disposals', 'disposals_over', 'anytime_goal_scorer', 'goals_over'];
    return Array.from(types).sort((a, b) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b));
  }, [aflProps]);

  const effectiveBookmakers = propsSport === 'afl' ? availableAflBookmakers : availableBookmakers;
  const effectivePropTypes = propsSport === 'afl' ? availableAflPropTypes : availablePropTypes;
  const isCombinedMode = propsSport === 'combined';

  // AFL: ensure all bookmakers and prop types selected when none or invalid (e.g. after switching from NBA)
  useEffect(() => {
    if (propsSport !== 'afl' || aflProps.length === 0 || availableAflBookmakers.length === 0) return;
    const bookmakersOverlap = Array.from(selectedBookmakers).some((b) => availableAflBookmakers.includes(b));
    const propTypesOverlap = Array.from(selectedPropTypes).some((t) => availableAflPropTypes.includes(t));
    if (selectedBookmakers.size > 0 && bookmakersOverlap && selectedPropTypes.size > 0 && propTypesOverlap) return;
    if (selectedBookmakers.size === 0 || !bookmakersOverlap) {
      setSelectedBookmakers(new Set(availableAflBookmakers));
    }
    if (selectedPropTypes.size === 0 || !propTypesOverlap) {
      setSelectedPropTypes(new Set(availableAflPropTypes));
    }
  }, [propsSport, aflProps.length, availableAflBookmakers, availableAflPropTypes, selectedBookmakers, selectedPropTypes]);

  // AFL: ensure all games selected when none or invalid (e.g. after switching from NBA or cache miss)
  useEffect(() => {
    if (propsSport !== 'afl' || aflGamesWithProps.length === 0) return;
    // Don't auto-select all games after the user has manually toggled them.
    if (userModifiedAflGamesRef.current) return;
    const gameIds = new Set(aflGamesWithProps.map((g) => g.gameId));
    const hasOverlap = Array.from(selectedAflGames).some((id) => gameIds.has(id));
    if (selectedAflGames.size > 0 && hasOverlap) return;
    setSelectedAflGames(new Set(gameIds));
  }, [propsSport, aflGamesWithProps, selectedAflGames]);

  const filteredAflProps = useMemo(() => {
    return aflProps.filter((prop) => {
      if (debouncedSearchQuery.trim()) {
        const q = debouncedSearchQuery.toLowerCase();
        if (!prop.playerName.toLowerCase().includes(q) && !getStatLabel(prop.statType).toLowerCase().includes(q)) return false;
      }
      if (selectedPropTypes.size > 0 && !selectedPropTypes.has(prop.statType)) return false;
      if (selectedBookmakers.size > 0) {
        const bms = new Set<string>();
        prop.bookmakerLines?.forEach((l) => l.bookmaker && bms.add(l.bookmaker));
        if (prop.bookmaker) bms.add(prop.bookmaker);
        if (!Array.from(bms).some((bm) => selectedBookmakers.has(bm))) return false;
      }
      if (selectedAflGames.size > 0 && prop.gameId && !selectedAflGames.has(prop.gameId)) return false;
      return true;
    });
  }, [aflProps, debouncedSearchQuery, selectedPropTypes, selectedBookmakers, selectedAflGames, getStatLabel]);

  // Combined mode: minimal filters only (search + sort + pagination).
  const filteredCombinedProps = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    const isExcludedCombinedNbaStat = (statType: string) => {
      const normalized = String(statType || '').trim().toLowerCase();
      return normalized === 'blk' || normalized === 'blocks' || normalized === 'stl' || normalized === 'steals';
    };
    const isBetwayBookmaker = (name: string | undefined) => {
      const normalized = String(name || '').trim().toLowerCase().replace(/\s+/g, '');
      return normalized === 'betway';
    };
    const removeBetwayLines = (prop: PlayerProp): PlayerProp | null => {
      const filteredLines = (prop.bookmakerLines || []).filter((line) => !isBetwayBookmaker(line.bookmaker));
      const fallbackBookmakerIsBetway = isBetwayBookmaker(prop.bookmaker);
      if (filteredLines.length === 0 && fallbackBookmakerIsBetway) return null;

      if (filteredLines.length > 0) {
        const primary = filteredLines[0];
        return {
          ...prop,
          bookmakerLines: filteredLines,
          bookmaker: primary.bookmaker || prop.bookmaker,
          line: Number.isFinite(primary.line) ? primary.line : prop.line,
          bestLine: Number.isFinite(primary.line) ? primary.line : prop.bestLine,
          overOdds: primary.overOdds || prop.overOdds,
          underOdds: primary.underOdds || prop.underOdds,
        };
      }

      return {
        ...prop,
        bookmakerLines: [],
      };
    };
    const mapWithSport = <T extends PlayerProp>(list: T[], sportSource: 'nba' | 'afl') => {
      return list
        .filter((prop) => {
          if (sportSource === 'nba' && isExcludedCombinedNbaStat(prop.statType)) return false;
          if (!q) return true;
          return (
            prop.playerName.toLowerCase().includes(q) ||
            getStatLabel(prop.statType).toLowerCase().includes(q)
          );
        })
        .map((prop) => removeBetwayLines(prop))
        .filter((prop): prop is PlayerProp => prop !== null)
        .map((prop) => ({ ...prop, sportSource }));
    };
    return [
      ...mapWithSport(playerProps, 'nba'),
      ...mapWithSport(aflProps, 'afl'),
    ] as Array<PlayerProp & { sportSource: 'nba' | 'afl' }>;
  }, [playerProps, aflProps, debouncedSearchQuery, getStatLabel]);

  const displaySortedCombinedProps = useMemo(() => {
    const percent = (hitRate?: { hits: number; total: number } | null) =>
      hitRate && hitRate.total > 0 ? (hitRate.hits / hitRate.total) * 100 : null;
    const out = [...filteredCombinedProps];
    const blendBySport = (
      nbaRows: Array<PlayerProp & { sportSource: 'nba' | 'afl' }>,
      aflRows: Array<PlayerProp & { sportSource: 'nba' | 'afl' }>
    ) => {
      const blended: Array<PlayerProp & { sportSource: 'nba' | 'afl' }> = [];
      const startWithNba = nbaRows.length >= aflRows.length;
      let i = 0;
      let j = 0;
      while (i < nbaRows.length || j < aflRows.length) {
        if (startWithNba) {
          if (i < nbaRows.length) blended.push(nbaRows[i]!);
          if (j < aflRows.length) blended.push(aflRows[j]!);
        } else {
          if (j < aflRows.length) blended.push(aflRows[j]!);
          if (i < nbaRows.length) blended.push(nbaRows[i]!);
        }
        i += 1;
        j += 1;
      }
      return blended;
    };

    if (propLineSort === 'high') {
      out.sort((a, b) => b.line - a.line);
      return out;
    }
    if (propLineSort === 'low') {
      out.sort((a, b) => a.line - b.line);
      return out;
    }

    const activeColumnSort = Object.entries(columnSort).find(([_, dir]) => dir !== 'none');
    if (activeColumnSort) {
      const [column, direction] = activeColumnSort;
      const compareByActiveColumn = (
        a: PlayerProp & { sportSource: 'nba' | 'afl' },
        b: PlayerProp & { sportSource: 'nba' | 'afl' }
      ) => {
        let aVal: number | null = null;
        let bVal: number | null = null;
        if (column === 'dvp') {
          aVal = a.dvpRating ?? null;
          bVal = b.dvpRating ?? null;
          if (aVal === null && bVal === null) return 0;
          if (aVal === null) return 1;
          if (bVal === null) return -1;
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        if (column === 'l5') { aVal = percent(a.last5HitRate); bVal = percent(b.last5HitRate); }
        else if (column === 'l10') { aVal = percent(a.last10HitRate); bVal = percent(b.last10HitRate); }
        else if (column === 'h2h') { aVal = percent(a.h2hHitRate); bVal = percent(b.h2hHitRate); }
        else if (column === 'season') { aVal = percent(a.seasonHitRate); bVal = percent(b.seasonHitRate); }
        else if (column === 'streak') { aVal = a.streak ?? null; bVal = b.streak ?? null; }
        else if (column === 'ip') { aVal = a.impliedOverProb ?? null; bVal = b.impliedOverProb ?? null; }
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        return direction === 'asc' ? bVal - aVal : aVal - bVal;
      };

      const nbaSorted = out
        .filter((p) => p.sportSource === 'nba')
        .sort(compareByActiveColumn);
      const aflSorted = out
        .filter((p) => p.sportSource === 'afl')
        .sort(compareByActiveColumn);

      return blendBySport(nbaSorted, aflSorted);
    }

    const compareByDefaultQuality = (a: PlayerProp, b: PlayerProp) => {
      const aL10Total = a.last10HitRate?.total ?? 0;
      const bL10Total = b.last10HitRate?.total ?? 0;
      const aHasFullL10 = aL10Total >= 10;
      const bHasFullL10 = bL10Total >= 10;
      if (aHasFullL10 !== bHasFullL10) return aHasFullL10 ? -1 : 1;
      const aL10 = percent(a.last10HitRate);
      const bL10 = percent(b.last10HitRate);
      if (aL10 !== null || bL10 !== null) return (bL10 ?? -1) - (aL10 ?? -1);
      const aL5 = percent(a.last5HitRate);
      const bL5 = percent(b.last5HitRate);
      if (aL5 !== null || bL5 !== null) return (bL5 ?? -1) - (aL5 ?? -1);
      const aDvp = a.dvpRating != null && a.dvpRating > 0 ? a.dvpRating : null;
      const bDvp = b.dvpRating != null && b.dvpRating > 0 ? b.dvpRating : null;
      if (aDvp !== null || bDvp !== null) {
        const aR = aDvp ?? 999;
        const bR = bDvp ?? 999;
        if (aR !== bR) return aR - bR;
      }
      const aP = Math.max(a.overProb ?? 0, a.underProb ?? 0);
      const bP = Math.max(b.overProb ?? 0, b.underProb ?? 0);
      return bP - aP;
    };

    // Combined default ranking:
    // 1) Rank each sport by quality using the same comparator.
    // 2) Interleave rows so one sport cannot crowd out the first pages.
    const nbaSorted = out
      .filter((p) => p.sportSource === 'nba')
      .sort(compareByDefaultQuality);
    const aflSorted = out
      .filter((p) => p.sportSource === 'afl')
      .sort(compareByDefaultQuality);

    return blendBySport(nbaSorted, aflSorted);
  }, [filteredCombinedProps, propLineSort, columnSort]);

  // AFL: same "best to worst" default sort as NBA (DvP best first, then L10%, L5%, prob); column sort when active
  const displaySortedAflProps = useMemo(() => {
    const percent = (hitRate?: { hits: number; total: number } | null) =>
      hitRate && hitRate.total > 0 ? (hitRate.hits / hitRate.total) * 100 : null;
    const out = [...filteredAflProps];
    if (propLineSort === 'high') {
      out.sort((a, b) => b.line - a.line);
      return out;
    }
    if (propLineSort === 'low') {
      out.sort((a, b) => a.line - b.line);
      return out;
    }
    const activeColumnSort = Object.entries(columnSort).find(([_, dir]) => dir !== 'none');
    if (activeColumnSort) {
      const [column, direction] = activeColumnSort;
      out.sort((a, b) => {
        let aVal: number | null = null;
        let bVal: number | null = null;
        if (column === 'dvp') {
          aVal = a.dvpRating ?? null;
          bVal = b.dvpRating ?? null;
          if (aVal === null && bVal === null) return 0;
          if (aVal === null) return 1;
          if (bVal === null) return -1;
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        if (column === 'l5') { aVal = percent(a.last5HitRate); bVal = percent(b.last5HitRate); }
        else if (column === 'l10') { aVal = percent(a.last10HitRate); bVal = percent(b.last10HitRate); }
        else if (column === 'h2h') { aVal = percent(a.h2hHitRate); bVal = percent(b.h2hHitRate); }
        else if (column === 'season') { aVal = percent(a.seasonHitRate); bVal = percent(b.seasonHitRate); }
        else if (column === 'streak') { aVal = a.streak ?? null; bVal = b.streak ?? null; }
        else if (column === 'ip') { aVal = a.impliedOverProb ?? null; bVal = b.impliedOverProb ?? null; }
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        return direction === 'asc' ? bVal - aVal : aVal - bVal;
      });
      return out;
    }
    // Default (AFL): best from L10 first, then L5, then DvP, then implied prob.
    // This matches the manual "best from last 10" user action.
    out.sort((a, b) => {
      const aL10Total = a.last10HitRate?.total ?? 0;
      const bL10Total = b.last10HitRate?.total ?? 0;
      const aHasFullL10 = aL10Total >= 10;
      const bHasFullL10 = bL10Total >= 10;
      // Prioritize props with a full 10-game sample; smaller samples stay visible but rank later.
      if (aHasFullL10 !== bHasFullL10) return aHasFullL10 ? -1 : 1;

      const aL10 = percent(a.last10HitRate);
      const bL10 = percent(b.last10HitRate);
      if (aL10 !== null || bL10 !== null) return (bL10 ?? -1) - (aL10 ?? -1);

      const aL5 = percent(a.last5HitRate);
      const bL5 = percent(b.last5HitRate);
      if (aL5 !== null || bL5 !== null) return (bL5 ?? -1) - (aL5 ?? -1);

      const aDvp = a.dvpRating != null && a.dvpRating > 0 ? a.dvpRating : null;
      const bDvp = b.dvpRating != null && b.dvpRating > 0 ? b.dvpRating : null;
      if (aDvp !== null || bDvp !== null) {
        const aR = aDvp ?? 999;
        const bR = bDvp ?? 999;
        if (aR !== bR) return aR - bR;
      }
      const aP = Math.max(a.overProb ?? 0, a.underProb ?? 0);
      const bP = Math.max(b.overProb ?? 0, b.underProb ?? 0);
      return bP - aP;
    });
    return out;
  }, [filteredAflProps, propLineSort, columnSort]);

  const ITEMS_PER_PAGE = 20;
  const aflTotalPages = Math.max(1, Math.ceil(displaySortedAflProps.length / ITEMS_PER_PAGE));
  const finalPaginatedAflProps = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return displaySortedAflProps.slice(start, start + ITEMS_PER_PAGE);
  }, [displaySortedAflProps, currentPage, ITEMS_PER_PAGE]);
  const combinedTotalPages = Math.max(1, Math.ceil(displaySortedCombinedProps.length / ITEMS_PER_PAGE));
  const finalPaginatedCombinedProps = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return displaySortedCombinedProps.slice(start, start + ITEMS_PER_PAGE);
  }, [displaySortedCombinedProps, currentPage, ITEMS_PER_PAGE]);

  // Track explicitly deselected games (games user clicked to deselect)
  const [deselectedGames, setDeselectedGames] = useState<Set<number>>(() => {
    if (typeof window === 'undefined') return new Set<number>();
    try {
      const saved = localStorage.getItem('nba_filters_deselected_games');
      return saved ? new Set<number>(JSON.parse(saved)) : new Set<number>();
    } catch {
      return new Set<number>();
    }
  });

  // Save deselected games to localStorage
  const saveDeselectedGames = (deselected: Set<number>) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('nba_filters_deselected_games', JSON.stringify(Array.from(deselected)));
      } catch (e) {
        console.warn('[NBA Landing] Failed to save deselected games:', e);
      }
    }
  };

  // NBA: Select all games with props by default (unless explicitly deselected); also fix when selection has no overlap (e.g. after switching from AFL)
  useEffect(() => {
    if (propsSport !== 'nba' || gamesWithProps.length === 0) return;
    const gameIds = new Set(gamesWithProps.map((game) => game.id));
    const hasOverlap = Array.from(selectedGames).some((id) => gameIds.has(id));
    if (selectedGames.size > 0 && hasOverlap) {
      // Add any new games that appeared (unless they were explicitly deselected)
      const newGames = Array.from(gameIds).filter((id) => !selectedGames.has(id) && !deselectedGames.has(id));
      if (newGames.length > 0) {
        const merged = new Set([...Array.from(selectedGames), ...newGames]);
        setSelectedGames(merged);
        saveFiltersToStorage(selectedBookmakers, selectedPropTypes, merged);
      }
      return;
    }
    // No selection or no overlap: select all games except explicitly deselected
    const newSet = new Set(Array.from(gameIds).filter((id) => !deselectedGames.has(id)));
    setSelectedGames(newSet);
    saveFiltersToStorage(selectedBookmakers, selectedPropTypes, newSet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsSport, gamesWithProps, deselectedGames]);

  // Pagination reset is handled by the effect at ~462 that runs on filter/sort change only.
  // Do not depend on playerProps here — it gets new references often and was resetting
  // the page to 1 when the user clicked to another page.

  // Filter player props based on search query and selected filters
  // Filter props based on search, bookmakers, prop types, and games
  const filteredPlayerProps = useMemo(() => {
    return playerProps.filter(prop => {
      // Search filter (using debounced query)
      if (debouncedSearchQuery.trim()) {
        const query = debouncedSearchQuery.toLowerCase();
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
  }, [playerProps, debouncedSearchQuery, selectedBookmakers, selectedPropTypes, selectedGames, todaysGames, getStatLabel]);

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

  // Deduplicate props: same player + stat + line + opponent should only appear once
  // Keep the one with the most bookmakers or best odds
  // Uses sortedPlayerProps so Prop Line sort (highest/lowest) order is preserved
  const uniquePlayerProps = useMemo(() => {
    const seen = new Map<string, PlayerProp>();
    
    sortedPlayerProps.forEach(prop => {
      // Create unique key: playerName + statType + line + opponent
      const key = `${prop.playerName}|${prop.statType}|${prop.line}|${prop.opponent}`;
      
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, prop);
      } else {
        // If duplicate found, keep the one with more bookmakers or better odds
        const existingBookmakers = (existing.bookmakerLines?.length || 0) + (existing.bookmaker ? 1 : 0);
        const newBookmakers = (prop.bookmakerLines?.length || 0) + (prop.bookmaker ? 1 : 0);
        
        if (newBookmakers > existingBookmakers) {
          seen.set(key, prop);
        } else if (newBookmakers === existingBookmakers && prop.bookmakerLines && existing.bookmakerLines) {
          // If same number of bookmakers, merge them
          const mergedBookmakers = new Map<string, { bookmaker: string; line: number; overOdds: string; underOdds: string }>();
          
          existing.bookmakerLines.forEach(line => {
            mergedBookmakers.set(line.bookmaker, line);
          });
          prop.bookmakerLines.forEach(line => {
            mergedBookmakers.set(line.bookmaker, line);
          });
          
          seen.set(key, {
            ...existing,
            bookmakerLines: Array.from(mergedBookmakers.values())
          });
        }
      }
    });
    
    return Array.from(seen.values());
  }, [sortedPlayerProps]);

  // Sort for display
  // - If prop line sort is active, keep the line-based order (already applied)
  // - If column sort is active, sort by that column
  // - Otherwise, sort by L10% (fallback to L5% then overall prob)
  const displaySortedProps = useMemo(() => {
    const percent = (hitRate?: { hits: number; total: number } | null) =>
      hitRate && hitRate.total > 0 ? (hitRate.hits / hitRate.total) * 100 : null;

    // Use deduplicated props
    const propsToSort = uniquePlayerProps;

    // Check if any column sort is active
    const activeColumnSort = Object.entries(columnSort).find(([_, dir]) => dir !== 'none');
    
    if (propLineSort !== 'none') {
      // Prop line sort takes precedence
      return [...propsToSort];
    }

    if (activeColumnSort) {
      const [column, direction] = activeColumnSort;
      const sorted = [...propsToSort].sort((a, b) => {
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

    // Default: best from true L10 sample first, then L5, then DvP, then implied probability.
    return [...propsToSort].sort((a, b) => {
      const aL10Total = a.last10HitRate?.total ?? 0;
      const bL10Total = b.last10HitRate?.total ?? 0;
      const aHasFullL10 = aL10Total >= 10;
      const bHasFullL10 = bL10Total >= 10;
      // Keep partial samples (e.g. 2/2) visible, but rank them after full 10-game samples.
      if (aHasFullL10 !== bHasFullL10) return aHasFullL10 ? -1 : 1;

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

      const aDvp = a.dvpRating != null && a.dvpRating > 0 ? a.dvpRating : null;
      const bDvp = b.dvpRating != null && b.dvpRating > 0 ? b.dvpRating : null;
      if (aDvp !== null || bDvp !== null) {
        // Lower rank = better; nulls go to end
        const aRank = aDvp ?? 999;
        const bRank = bDvp ?? 999;
        if (aRank !== bRank) return aRank - bRank;
      }
      // Use implied probabilities for sorting
      const aProb = Math.max(a.overProb, a.underProb);
      const bProb = Math.max(b.overProb, b.underProb);
      return bProb - aProb;
    });
  }, [uniquePlayerProps, propLineSort, columnSort]);

  // Pagination
  const pageSize = 20;
  // Total count should use deduplicated props
  const totalPropsCount = uniquePlayerProps.length;
  // Total pages based on the full count
  const totalPages = Math.max(1, Math.ceil(totalPropsCount / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedPlayerProps = useMemo(() => {
    const start = (currentPageSafe - 1) * pageSize;
    return displaySortedProps.slice(start, start + pageSize);
  }, [displaySortedProps, currentPageSafe]);

  // Calculate missing stats for props that don't have seasonAvg or h2hAvg
  // This is a fallback for props that were cached without these stats
  const [propsWithCalculatedStats, setPropsWithCalculatedStats] = useState<Map<string, PlayerProp>>(new Map());
  const calculatedKeysRef = useRef<Set<string>>(new Set());
  const calculatingRef = useRef<Set<string>>(new Set());
  
  // Load calculated stats from sessionStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
      const stored = sessionStorage.getItem(CALCULATED_STATS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const statsMap = new Map<string, PlayerProp>();
          parsed.forEach((prop: PlayerProp) => {
            const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
            statsMap.set(key, prop);
            calculatedKeysRef.current.add(key);
          });
          setPropsWithCalculatedStats(statsMap);
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }, []);
  
  useEffect(() => {
    let isCancelled = false;
    const abortControllers = new Map<string, AbortController>();
    
    const calculateMissingStats = async () => {
      const propsToCalculate = paginatedPlayerProps.filter(prop => {
        const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
        const needsCalculation = (prop.h2hAvg === null || prop.h2hAvg === undefined || prop.seasonAvg === null || prop.seasonAvg === undefined) &&
          prop.playerName && prop.statType && prop.opponent && prop.line !== undefined;
        return needsCalculation && !calculatedKeysRef.current.has(key) && !calculatingRef.current.has(key);
      });
      
      if (propsToCalculate.length === 0 || isCancelled) return;
      
      // Calculate stats for props that are missing them
      const calculations = propsToCalculate.map(async (prop) => {
        if (isCancelled) return;
        
        const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
        const abortController = new AbortController();
        abortControllers.set(key, abortController);
        
        // Mark as calculating
        calculatingRef.current.add(key);
        
        try {
          const stats = await calculatePlayerAverages(
            prop.playerName,
            prop.statType,
            prop.opponent,
            prop.team,
            prop.line
          );
          
          // Check if cancelled before updating state
          if (isCancelled) return;
          
          // Only update if we got valid stats
          if (stats.h2h !== null || stats.seasonAvg !== null) {
            const updatedProp = {
              ...prop,
              h2hAvg: stats.h2h ?? prop.h2hAvg,
              seasonAvg: stats.seasonAvg ?? prop.seasonAvg,
              h2hHitRate: stats.h2hHitRate ?? prop.h2hHitRate,
              seasonHitRate: stats.seasonHitRate ?? prop.seasonHitRate,
            };
            
            // Update local state
            setPropsWithCalculatedStats(prev => {
              const newMap = new Map(prev);
              newMap.set(key, updatedProp);
              
              // Save calculated stats to sessionStorage
              if (typeof window !== 'undefined' && !isCancelled) {
                const CALCULATED_STATS_KEY = 'nba-player-props-calculated-stats';
                const statsArray = Array.from(newMap.values());
                const statsString = JSON.stringify(statsArray);
                safeSetSessionStorage(CALCULATED_STATS_KEY, statsString);
              }
              
              return newMap;
            });
            
            // Update main playerProps state and persist to cache
            setPlayerProps(prev => {
              const updated = prev.map(p => {
                const propKey = `${p.playerName}|${p.statType}|${p.opponent}|${p.line}`;
                if (propKey === key) {
                  return updatedProp;
                }
                return p;
              });
              
              // Save to sessionStorage
              if (typeof window !== 'undefined' && !isCancelled) {
                const CACHE_KEY = 'nba-player-props-cache';
                const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
                const dataString = JSON.stringify(updated);
                safeSetSessionStorage(CACHE_KEY, dataString);
                safeSetSessionStorage(CACHE_TIMESTAMP_KEY, Date.now().toString());
              }
              
              return updated;
            });
            
            calculatedKeysRef.current.add(key);
          }
        } catch (error) {
          console.warn(`[Props Page] Failed to calculate stats for ${prop.playerName} ${prop.statType}:`, error);
        } finally {
          calculatingRef.current.delete(key);
          abortControllers.delete(key);
        }
      });
      
      await Promise.all(calculations);
    };
    
    calculateMissingStats();
    
    // Cleanup function
    return () => {
      isCancelled = true;
      // Cancel all in-flight calculations
      abortControllers.forEach((controller) => {
        controller.abort();
      });
      abortControllers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginatedPlayerProps]);
  
  // Merge calculated stats into paginated props
  const finalPaginatedProps = useMemo(() => {
    return paginatedPlayerProps.map(prop => {
      const key = `${prop.playerName}|${prop.statType}|${prop.opponent}|${prop.line}`;
      const calculated = propsWithCalculatedStats.get(key);
      return calculated || prop;
    });
  }, [paginatedPlayerProps, propsWithCalculatedStats]);

  const activeFilteredCount = propsSport === 'nba'
    ? filteredPlayerProps.length
    : propsSport === 'afl'
      ? filteredAflProps.length
      : filteredCombinedProps.length;
  const activePaginatedProps = propsSport === 'nba'
    ? finalPaginatedProps
    : propsSport === 'afl'
      ? finalPaginatedAflProps
      : finalPaginatedCombinedProps;
  const activeTotalPages = propsSport === 'nba'
    ? totalPages
    : propsSport === 'afl'
      ? aflTotalPages
      : combinedTotalPages;
  const activeCurrentPage = propsSport === 'nba' ? currentPageSafe : currentPage;

  /** Club-site portraits for AFL props; bump version to invalidate client after resolver changes. */
  const [aflPortraitExtras, setAflPortraitExtras] = useState<Record<string, string>>({});
  const aflPortraitFetchedRef = useRef<Set<string>>(new Set());
  /** True while current page has AFL names still awaiting /api/afl/player-portraits (avoids jersey # flash). */
  const [aflPortraitBatchLoading, setAflPortraitBatchLoading] = useState(false);

  useEffect(() => {
    try {
      const k = 'st_afl_portrait_resolver_v';
      const v = '7';
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(k) !== v) {
        sessionStorage.setItem(k, v);
        aflPortraitFetchedRef.current = new Set();
        setAflPortraitExtras({});
      }
    } catch {
      /* ignore */
    }
  }, []);

  const aflPortraitFetchKey = useMemo(() => {
    if (propsSport !== 'afl' && propsSport !== 'combined') return '';
    const parts: string[] = [];
    for (const prop of activePaginatedProps) {
      const rowSport =
        propsSport === 'combined'
          ? ((prop as PlayerProp & { sportSource?: 'nba' | 'afl' }).sportSource ?? 'nba')
          : 'afl';
      if (rowSport !== 'afl') continue;
      parts.push(`${prop.playerName}\0${prop.team ?? ''}`);
    }
    return parts.sort().join('|');
  }, [propsSport, activePaginatedProps]);

  useLayoutEffect(() => {
    if (propsSport !== 'afl' && propsSport !== 'combined') {
      setAflPortraitBatchLoading(false);
      return;
    }
    const pending = new Set<string>();
    for (const prop of activePaginatedProps) {
      const rowSport =
        propsSport === 'combined'
          ? ((prop as PlayerProp & { sportSource?: 'nba' | 'afl' }).sportSource ?? 'nba')
          : 'afl';
      if (rowSport !== 'afl') continue;
      const n = prop.playerName;
      if (!n || pending.has(n)) continue;
      if (aflPortraitFetchedRef.current.has(n)) continue;
      if (getAflPlayerHeadshotUrl(n)) continue;
      pending.add(n);
    }
    setAflPortraitBatchLoading(pending.size > 0);
  }, [propsSport, activePaginatedProps, aflPortraitFetchKey]);

  useEffect(() => {
    if (!aflPortraitFetchKey) return;
    const players: { name: string; team?: string; homeTeam?: string; awayTeam?: string }[] = [];
    const seen = new Set<string>();
    for (const prop of activePaginatedProps) {
      const rowSport =
        propsSport === 'combined'
          ? ((prop as PlayerProp & { sportSource?: 'nba' | 'afl' }).sportSource ?? 'nba')
          : 'afl';
      if (rowSport !== 'afl') continue;
      const n = prop.playerName;
      if (!n || seen.has(n)) continue;
      seen.add(n);
      if (aflPortraitFetchedRef.current.has(n)) continue;
      if (getAflPlayerHeadshotUrl(n)) {
        aflPortraitFetchedRef.current.add(n);
        continue;
      }
      players.push({
        name: n,
        team: prop.team || undefined,
        homeTeam: prop.homeTeam || undefined,
        awayTeam: prop.awayTeam || undefined,
      });
    }
    if (players.length === 0) {
      setAflPortraitBatchLoading(false);
      return;
    }
    let cancelled = false;
    fetch('/api/afl/player-portraits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players }),
    })
      .then((r) => r.json())
      .then((data: { portraits?: Record<string, string | null> }) => {
        if (cancelled) return;
        const portraits = data.portraits ?? {};
        for (const p of players) {
          aflPortraitFetchedRef.current.add(p.name);
        }
        setAflPortraitExtras((prev) => {
          const next = { ...prev };
          for (const [name, url] of Object.entries(portraits)) {
            if (url) next[name] = url;
          }
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        for (const p of players) {
          aflPortraitFetchedRef.current.add(p.name);
        }
      })
      .finally(() => {
        if (!cancelled) setAflPortraitBatchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aflPortraitFetchKey, propsSport, activePaginatedProps]);

  const applySportMode = useCallback((nextMode: 'nba' | 'afl' | 'combined') => {
    setPropsSport(nextMode);
    if (nextMode !== 'nba') {
      setAflPropsLoading(true);
    }
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const testCode = params?.get('test_event_code');
    const basePath =
      nextMode === 'afl'
        ? '/props?sport=afl'
        : nextMode === 'combined'
          ? '/props?sport=combined'
          : '/props?sport=nba';
    const path = basePath + (testCode ? `${basePath.includes('?') ? '&' : '?'}test_event_code=${encodeURIComponent(testCode)}` : '');
    router.replace(path, { scroll: false });
  }, [router]);

  const toggleSportSelection = useCallback((sport: 'nba' | 'afl') => {
    // Combined means "no explicit single-sport filter selected".
    // Clicking an active sport toggles it off back to combined.
    const nextMode: 'nba' | 'afl' | 'combined' = propsSport === sport ? 'combined' : sport;
    applySportMode(nextMode);
  }, [propsSport, applySportMode]);

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
        // User is deselecting this game - mark it as explicitly deselected
        newSet.delete(gameId);
        setDeselectedGames(prevDeselected => {
          const newDeselected = new Set(prevDeselected);
          newDeselected.add(gameId);
          saveDeselectedGames(newDeselected);
          return newDeselected;
        });
      } else {
        // User is selecting this game - remove from deselected list
        newSet.add(gameId);
        setDeselectedGames(prevDeselected => {
          const newDeselected = new Set(prevDeselected);
          newDeselected.delete(gameId);
          saveDeselectedGames(newDeselected);
          return newDeselected;
        });
      }
      // Save to localStorage
      saveFiltersToStorage(selectedBookmakers, selectedPropTypes, newSet);
      return newSet;
    });
  };

  const clearAllGames = () => {
    setSelectedGames(new Set());
    setDeselectedGames(prev => {
      const next = new Set(prev);
      gamesWithProps.forEach(g => next.add(g.id));
      saveDeselectedGames(next);
      return next;
    });
    saveFiltersToStorage(selectedBookmakers, selectedPropTypes, new Set());
  };

  const selectAllGames = () => {
    const allIds = new Set(gamesWithProps.map(g => g.id));
    setSelectedGames(allIds);
    setDeselectedGames(prev => {
      const next = new Set(prev);
      allIds.forEach(id => next.delete(id));
      saveDeselectedGames(next);
      return next;
    });
    saveFiltersToStorage(selectedBookmakers, selectedPropTypes, allIds);
  };

  const toggleAflGame = (gameId: string) => {
    userModifiedAflGamesRef.current = true;
    setSelectedAflGames((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      selectedAflGamesRef.current = next;
      return next;
    });
  };
  const selectAllAflGames = () => {
    userModifiedAflGamesRef.current = true;
    const next = new Set(aflGamesWithProps.map((g) => g.gameId));
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
  };
  const clearAllAflGames = () => {
    userModifiedAflGamesRef.current = true;
    const next = new Set<string>();
    selectedAflGamesRef.current = next;
    setSelectedAflGames(next);
  };

  const getConfidenceColor = (confidence: string) => {
    if (confidence === 'High') return mounted && isDark ? 'text-green-400' : 'text-green-600';
    if (confidence === 'Medium') return mounted && isDark ? 'text-yellow-400' : 'text-yellow-600';
    return mounted && isDark ? 'text-gray-400' : 'text-gray-600';
  };


  // Paywall: show loading until subscription is checked; non-pro users are redirected when cache has loaded
  if (!subscriptionChecked || !isPro) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${mounted && isDark ? 'bg-[#050d1a]' : 'bg-gray-50'}`}>
        <div className="w-10 h-10 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen lg:h-screen ${mounted && isDark ? 'bg-[#050d1a]' : 'bg-gray-50'} transition-colors lg:overflow-x-auto lg:overflow-y-hidden`}>
      {/* Loading bar at top when navigating to dashboard - must be at root level */}
      <LoadingBar isLoading={navigatingToPlayer} isDark={isDark} showImmediately={navigatingToPlayer} mobileOffset={0} />
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
      
      <div className={`px-0 dashboard-container ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ 
        marginLeft: 'calc(var(--sidebar-width, 0px) + var(--gap, 2px))',
        width: 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 2px)))',
        paddingLeft: 0,
      }}>
        <div className={`mx-auto w-full max-w-[1550px] ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingLeft: 0, paddingRight: '0px' }}>
          <div className={`pt-4 min-h-0 lg:h-full dashboard-container ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingLeft: 0 }}>
            {/* Left Sidebar */}
            <LeftSidebar
              oddsFormat={oddsFormat}
              setOddsFormat={(format) => {
                const formatValue = typeof format === 'function' ? format(oddsFormat) : format;
                setOddsFormat(formatValue);
                try {
                  localStorage.setItem('oddsFormat', formatValue);
                } catch (e: any) {
                  if (e.name === 'QuotaExceededError' || e.code === 22) {
                    console.warn('[NBA Landing] localStorage quota exceeded when saving odds format');
                  } else {
                    console.warn('[NBA Landing] Failed to save odds format to localStorage:', e);
                  }
                }
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
              onProfileUpdated={({ username: u, avatar_url: a }) => {
                if (u !== undefined) setUsername(u ?? null);
                if (a !== undefined) setAvatarUrl(a ?? null);
              }}
            />

            {/* Main Content Area - Top Player Props */}
            <div 
              className={`relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 overflow-y-auto lg:overflow-x-hidden lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar ${mounted && isDark ? 'bg-[#050d1a]' : ''}`}
              style={{
                scrollbarGutter: 'stable',
                paddingLeft: 0,
                paddingRight: 0,
              }}
            >
          <div className={`h-full pb-12 lg:pr-0 px-1 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingTop: 0, boxSizing: 'border-box' }}>
            {/* Sport filter: default combined (none selected), select one for single-sport view */}
            <div className={`flex gap-1.5 mb-2 lg:gap-3 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`}>
              <button
                type="button"
                onClick={() => toggleSportSelection('nba')}
                className={`flex-1 sm:flex-none px-4 py-2.5 lg:min-w-[180px] lg:px-8 lg:py-3 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center ${
                  propsSport === 'nba'
                    ? mounted && isDark ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-100 text-purple-800 border-purple-300'
                    : mounted && isDark ? 'bg-[#0a1929] text-gray-400 border-gray-600 hover:bg-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
                aria-label="NBA"
              >
                <img src="/images/nba-logo.png" alt="" className="w-10 h-10 lg:w-12 lg:h-12 object-contain" />
              </button>
              <button
                type="button"
                onClick={() => toggleSportSelection('afl')}
                className={`flex-1 sm:flex-none px-4 py-2.5 lg:min-w-[180px] lg:px-8 lg:py-3 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center ${
                  propsSport === 'afl'
                    ? mounted && isDark ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-100 text-purple-800 border-purple-300'
                    : mounted && isDark ? 'bg-[#0a1929] text-gray-400 border-gray-600 hover:bg-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
                aria-label="AFL"
              >
                <img src="/images/afl-logo.png" alt="" className="w-10 h-10 lg:w-12 lg:h-12 object-contain" />
              </button>
            </div>

            {/* Search Bar */}
            <div className={`mb-2 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`}>
              <form onSubmit={handleSearch} style={{ width: '100%', margin: 0, padding: 0, boxSizing: 'border-box' }}>
                <div className="relative" style={{ width: '100%', boxSizing: 'border-box' }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for a player..."
                    className={`px-4 py-3 pl-12 rounded-lg border ${
                      mounted && isDark 
                        ? 'bg-[#0a1929] border-gray-700 text-white placeholder-gray-400' 
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
              {!isCombinedMode && (
              <div 
                ref={filtersSectionRef}
                className={`mt-2 flex flex-col gap-1.5 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} 
                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
              >
                <div className="flex gap-1.5">
                {/* Games Dropdown */}
                <div className="relative flex-1">
                  <button
                    ref={gamesButtonRef}
                    onClick={() => {
                      setGamesDropdownOpen(!gamesDropdownOpen);
                      setBookmakerDropdownOpen(false);
                      setPropTypeDropdownOpen(false);
                    }}
                    className={`relative flex items-center justify-between gap-2 px-4 py-3 rounded-lg border transition-all w-full ${
                      gamesDropdownOpen
                        ? mounted && isDark
                          ? 'bg-[#0a1929] border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-[#0a1929] border-gray-700 text-gray-300 hover:bg-[#0d1f35]'
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
                            className={`fixed z-[101] rounded-lg border shadow-lg overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-900 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`} 
                            style={{ 
                              position: 'fixed',
                              top: `${lockedPositionRef.current ?? filterBottom}px`, 
                              left: gamesButtonRef.current ? `${gamesButtonRef.current.getBoundingClientRect().left}px` : '1rem',
                              right: gamesButtonRef.current ? 'auto' : '1rem',
                              width: gamesButtonRef.current ? `${gamesButtonRef.current.getBoundingClientRect().width}px` : 'calc(100vw - 2rem)',
                              maxHeight: `calc(100vh - ${(lockedPositionRef.current ?? filterBottom) + 16}px)`,
                              pointerEvents: 'auto',
                              boxSizing: 'border-box'
                            }}
                          >
                          <div className="p-2 space-y-1" style={{ width: '100%', boxSizing: 'border-box' }}>
                            {propsSport === 'afl'
                              ? aflGamesWithProps.map((game) => {
                                  const isSelected = selectedAflGames.has(game.gameId);
                                  return (
                                    <label
                                      key={game.gameId}
                                      className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
                                        isSelected ? (mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900') : (mounted && isDark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-50 text-gray-700')
                                      }`}
                                    >
                                      <input type="checkbox" checked={isSelected} onChange={() => toggleAflGame(game.gameId)} className="hidden" />
                                      {(() => {
                                  const h = toOfficialAflTeamDisplayName(game.homeTeam);
                                  let a = toOfficialAflTeamDisplayName(game.awayTeam);
                                  const same = h && a && h === a;
                                  if (same) a = '';
                                  const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
                                  const tryAflLogo = (name: string): string | null => {
                                    if (!name) return null;
                                    if (aflLogoByTeam[n(name)]) return aflLogoByTeam[n(name)];
                                    for (const w of name.split(/\s+/)) {
                                      if (aflLogoByTeam[n(w)]) return aflLogoByTeam[n(w)];
                                    }
                                    return null;
                                  };
                                  const homeLogoUrl = h ? tryAflLogo(h) : null;
                                  const awayLogoUrl = a ? tryAflLogo(a) : null;
                                  return (
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      {homeLogoUrl ? (
                                        <img src={homeLogoUrl} alt={h} className="w-8 h-8 object-contain flex-shrink-0" />
                                      ) : (
                                        <div className={`w-8 h-8 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                      )}
                                      <span className={`text-xs font-semibold flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
                                      {awayLogoUrl ? (
                                        <img src={awayLogoUrl} alt={a} className="w-8 h-8 object-contain flex-shrink-0" />
                                      ) : (
                                        <div className={`w-8 h-8 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                      )}
                                    </div>
                                  );
                                })()}
                                    </label>
                                  );
                                })
                              : gamesWithProps.map(game => {
                              const isSelected = selectedGames.has(game.id);
                              const homeTeam = game.home_team?.abbreviation || '';
                              const awayTeam = game.visitor_team?.abbreviation || '';
                              const homeLogoUrl = getEspnLogoUrl(homeTeam);
                              const awayLogoUrl = getEspnLogoUrl(awayTeam);
                              return (
                                <label
                                  key={game.id}
                                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
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
                                    className="hidden"
                                  />
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                                    {awayLogoUrl && (
                                      <img
                                        src={awayLogoUrl}
                                        alt={awayTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                    <span className={`text-xs font-semibold flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
                                    {homeLogoUrl && (
                                      <img
                                        src={homeLogoUrl}
                                        alt={homeTeam}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                      />
                                    )}
                                  </div>
                                </label>
                              );
                            })}
                            <div className="flex pt-0.5">
                              <button
                                type="button"
                                onClick={propsSport === 'afl' ? clearAllAflGames : clearAllGames}
                                className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                  mounted && isDark
                                    ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                                }`}
                              >
                                Clear all
                              </button>
                              <div className={`w-px self-stretch flex-shrink-0 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-200'}`} />
                              <button
                                type="button"
                                onClick={propsSport === 'afl' ? selectAllAflGames : selectAllGames}
                                className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                  mounted && isDark
                                    ? 'text-purple-400 hover:bg-gray-700 hover:text-purple-200'
                                    : 'text-purple-600 hover:bg-gray-50 hover:text-purple-800'
                                }`}
                              >
                                Select all
                              </button>
                            </div>
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
                              ? 'bg-gray-900 border-gray-700'
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          <div className="p-2 space-y-1">
                            {propsSport === 'afl'
                              ? aflGamesWithProps.map((game) => {
                                  const isSelected = selectedAflGames.has(game.gameId);
                                  return (
                                    <label
                                      key={game.gameId}
                                      className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
                                        isSelected ? (mounted && isDark ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900') : (mounted && isDark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-50 text-gray-700')
                                      }`}
                                    >
                                      <input type="checkbox" checked={isSelected} onChange={() => toggleAflGame(game.gameId)} className="hidden" />
                                      {(() => {
                                        const h = toOfficialAflTeamDisplayName(game.homeTeam);
                                        let a = toOfficialAflTeamDisplayName(game.awayTeam);
                                        const same = h && a && h === a;
                                        if (same) a = '';
                                        const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
                                        const tryAflLogo = (name: string): string | null => {
                                          if (!name) return null;
                                          if (aflLogoByTeam[n(name)]) return aflLogoByTeam[n(name)];
                                          for (const w of name.split(/\s+/)) {
                                            if (aflLogoByTeam[n(w)]) return aflLogoByTeam[n(w)];
                                          }
                                          return null;
                                        };
                                        const homeLogoUrl = h ? tryAflLogo(h) : null;
                                        const awayLogoUrl = a ? tryAflLogo(a) : null;
                                        return (
                                          <div className="flex items-center gap-2 flex-1 min-w-0">
                                            {homeLogoUrl ? (
                                              <img src={homeLogoUrl} alt={h} className="w-8 h-8 object-contain flex-shrink-0" />
                                            ) : (
                                              <div className={`w-8 h-8 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                            )}
                                            <span className={`text-sm font-semibold flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
                                            {awayLogoUrl ? (
                                              <img src={awayLogoUrl} alt={a} className="w-8 h-8 object-contain flex-shrink-0" />
                                            ) : (
                                              <div className={`w-8 h-8 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </label>
                                  );
                                })
                              : gamesWithProps.map(game => {
                              const isSelected = selectedGames.has(game.id);
                              const homeTeam = game.home_team?.abbreviation || '';
                              const awayTeam = game.visitor_team?.abbreviation || '';
                              const homeLogoUrl = getEspnLogoUrl(homeTeam);
                              const awayLogoUrl = getEspnLogoUrl(awayTeam);
                              return (
                                <label
                                  key={game.id}
                                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all whitespace-nowrap ${
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
                                    className="hidden"
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
                                    <span className={`text-sm flex-shrink-0 ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>vs</span>
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
                            <div className="flex pt-0.5">
                              <button
                                type="button"
                                onClick={propsSport === 'afl' ? clearAllAflGames : clearAllGames}
                                className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                  mounted && isDark
                                    ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                                }`}
                              >
                                Clear all
                              </button>
                              <div className={`w-px self-stretch flex-shrink-0 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-200'}`} />
                              <button
                                type="button"
                                onClick={propsSport === 'afl' ? selectAllAflGames : selectAllGames}
                                className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                  mounted && isDark
                                    ? 'text-purple-400 hover:bg-gray-700 hover:text-purple-200'
                                    : 'text-purple-600 hover:bg-gray-50 hover:text-purple-800'
                                }`}
                              >
                                Select all
                              </button>
                            </div>
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
                          ? 'bg-[#0a1929] border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-[#0a1929] border-gray-700 text-gray-300 hover:bg-[#0d1f35]'
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
                            className={`fixed z-[101] rounded-lg border shadow-lg overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-900 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`} 
                            style={{ 
                              position: 'fixed',
                              top: `${lockedPositionRef.current ?? filterBottom}px`, 
                              left: propTypeButtonRef.current ? `${propTypeButtonRef.current.getBoundingClientRect().left}px` : '1rem',
                              right: propTypeButtonRef.current ? 'auto' : '1rem',
                              width: propTypeButtonRef.current ? `${propTypeButtonRef.current.getBoundingClientRect().width}px` : 'calc(100vw - 2rem)',
                              maxHeight: `calc(100vh - ${(lockedPositionRef.current ?? filterBottom) + 16}px)`,
                              pointerEvents: 'auto',
                              boxSizing: 'border-box'
                            }}
                          >
                          <div className="space-y-1" style={{ width: '100%', boxSizing: 'border-box' }}>
                            {effectivePropTypes.map(propType => {
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
                                    className="hidden"
                                  />
                                  <span className="text-sm font-medium">{getStatLabel(propType)}</span>
                                </label>
                              );
                          })}
                          <div className="flex pt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                const newSet = new Set<string>();
                                setSelectedPropTypes(newSet);
                                saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                              }}
                              className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                mounted && isDark
                                  ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                              }`}
                            >
                              Clear all
                            </button>
                            <div className={`w-px self-stretch flex-shrink-0 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-200'}`} />
                            <button
                              type="button"
                              onClick={() => {
                                const newSet = new Set(availablePropTypes);
                                setSelectedPropTypes(newSet);
                                saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                              }}
                              className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                mounted && isDark
                                  ? 'text-purple-400 hover:bg-gray-700 hover:text-purple-200'
                                  : 'text-purple-600 hover:bg-gray-50 hover:text-purple-800'
                              }`}
                            >
                              Select all
                            </button>
                          </div>
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
                          {effectivePropTypes.map(propType => {
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
                                  className="hidden"
                                />
                                <span className="text-sm font-medium">{getStatLabel(propType)}</span>
                              </label>
                            );
                          })}
                          <div className="flex pt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                const newSet = new Set<string>();
                                setSelectedPropTypes(newSet);
                                saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                              }}
                              className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                mounted && isDark
                                  ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                              }`}
                            >
                              Clear all
                            </button>
                            <div className={`w-px self-stretch flex-shrink-0 ${mounted && isDark ? 'bg-gray-600' : 'bg-gray-200'}`} />
                            <button
                              type="button"
                              onClick={() => {
                                const newSet = new Set(availablePropTypes);
                                setSelectedPropTypes(newSet);
                                saveFiltersToStorage(selectedBookmakers, newSet, selectedGames);
                              }}
                              className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center transition-all ${
                                mounted && isDark
                                  ? 'text-purple-400 hover:bg-gray-700 hover:text-purple-200'
                                  : 'text-purple-600 hover:bg-gray-50 hover:text-purple-800'
                              }`}
                            >
                              Select all
                            </button>
                          </div>
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
                    ref={bookmakerButtonRef}
                    className={`relative flex items-center justify-between gap-2 px-4 py-3 rounded-lg border transition-all w-full ${
                      bookmakerDropdownOpen
                        ? mounted && isDark
                          ? 'bg-[#0a1929] border-gray-600 text-gray-200'
                          : 'bg-gray-50 border-gray-400 text-gray-800'
                        : mounted && isDark
                        ? 'bg-[#0a1929] border-gray-700 text-gray-300 hover:bg-[#0d1f35]'
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
                            className={`fixed z-[101] rounded-lg border shadow-lg overflow-y-auto ${
                              mounted && isDark
                                ? 'bg-gray-900 border-gray-700'
                                : 'bg-white border-gray-300'
                            }`} 
                            style={{ 
                              position: 'fixed',
                              top: `${lockedPositionRef.current ?? filterBottom}px`, 
                              left: bookmakerButtonRef.current ? `${bookmakerButtonRef.current.getBoundingClientRect().left}px` : '1rem',
                              right: bookmakerButtonRef.current ? 'auto' : '1rem',
                              width: bookmakerButtonRef.current ? `${bookmakerButtonRef.current.getBoundingClientRect().width}px` : 'calc(100vw - 2rem)',
                              maxHeight: `calc(100vh - ${(lockedPositionRef.current ?? filterBottom) + 16}px)`,
                              pointerEvents: 'auto',
                              boxSizing: 'border-box'
                            }}
                          >
                            <div className="space-y-1" style={{ width: '100%', boxSizing: 'border-box' }}>
                              {effectiveBookmakers.map(bookmaker => {
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
                                      className="hidden"
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
                              ? 'bg-gray-900 border-gray-700'
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          <div className="p-2 space-y-1">
                            {effectiveBookmakers.map(bookmaker => {
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
                                    className="hidden"
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
              )}
            </div>

            {/* Player Props Section */}
            <div className={`h-[calc(100%-160px)] ${mounted && isDark ? 'bg-[#050d1a]' : ''}`} style={{ boxSizing: 'border-box', width: '100%', overflow: 'visible', paddingTop: 0, marginTop: 0 }}>
              <div className={`rounded-lg w-full pr-4 lg:pr-2 ${
                mounted && isDark ? 'bg-[#050d1a]' : 'bg-white'
              } shadow-sm`} style={{ boxSizing: 'border-box', width: '100%', paddingTop: 0, marginTop: 0, paddingLeft: '0.5rem', paddingRight: '0.5rem' }}>
                <h2 className={`text-2xl font-bold mb-2 ${
                  mounted && isDark ? 'text-white' : 'text-gray-900'
                }`} style={{ marginTop: 0, paddingTop: 0 }}>
                  Top Player Props
                </h2>

                {propsSport === 'afl' && aflListDebugMeta && (
                  <details className={`mb-4 rounded-lg border text-sm ${mounted && isDark ? 'bg-gray-900/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                    <summary className={`cursor-pointer px-3 py-2 font-medium ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      Debug: why L5/L10/Season show N/A ({aflListDebugMeta.rowsNa != null ? String(aflListDebugMeta.rowsNa) : '?'} rows with N/A)
                    </summary>
                    <pre className={`p-3 overflow-auto max-h-80 whitespace-pre-wrap break-words ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                      {JSON.stringify({ cacheBackend: aflListDebugMeta.cacheBackend, cacheHits: aflListDebugMeta.cacheHits, cacheMisses: aflListDebugMeta.cacheMisses, rowsWithStats: aflListDebugMeta.rowsWithStats, rowsNa: aflListDebugMeta.rowsNa, totalRows: aflListDebugMeta.totalRows, hint: aflListDebugMeta.hint, debugNaSample: Array.isArray(aflListDebugMeta.debugNa) ? (aflListDebugMeta.debugNa as unknown[]).slice(0, 25) : aflListDebugMeta.debugNa }, null, 2)}
                    </pre>
                  </details>
                )}
                
                {activeFilteredCount === 0 ? (
                    ((propsSport === 'afl' && (aflPropsLoading || !aflPropsFetchCompleteRef.current)) || (propsSport === 'nba' && !showNoPropsMessage) || (propsSport === 'combined' && (propsLoading || aflPropsLoading))) ? (
                      <>
                      {/* Desktop Skeleton - AFL loading or NBA empty */}
                      <div className="hidden lg:block overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className={`border-b ${isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                              <th className="py-3 px-4 text-left">
                                <div className={`h-8 w-32 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                              </th>
                              <th className={`py-3 px-4 text-left ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>Odds</th>
                              <th className={`py-3 px-4 text-left ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>IP</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>DvP</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>L5</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>L10</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>H2H</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>Season</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>Streak</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>Tipoff</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...Array(10)].map((_, idx) => (
                              <tr key={idx} className={`border-b ${isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                                    <div className="flex-1 space-y-2">
                                      <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                                      <div className={`h-3 w-24 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="space-y-1.5">
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className={`h-4 w-12 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-4 w-16 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className={`lg:hidden space-y-4 ${isDark ? 'bg-[#050d1a]' : ''}`}>
                        {[...Array(5)].map((_, idx) => (
                          <div
                            key={idx}
                            className={`rounded-xl border-2 pl-3 pr-4 py-3.5 ${isDark ? 'bg-[#0a1929] border-gray-900' : 'bg-white border-gray-200'}`}
                          >
                            <div className="mb-1.5">
                              <div className="flex items-center gap-2.5 mb-2">
                                <div className={`w-10 h-10 rounded-full animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                <div className="flex-1 space-y-2">
                                  <div className={`h-5 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  <div className={`h-4 w-24 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-4 gap-2 mb-2">
                              {[...Array(4)].map((_, statIdx) => (
                                <div
                                  key={statIdx}
                                  className={`rounded-lg border p-2 animate-pulse ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-300'}`}
                                  style={{ animationDelay: `${idx * 0.1 + statIdx * 0.05}s` }}
                                >
                                  <div className={`h-3 w-12 mb-1 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                  <div className={`h-4 w-8 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center justify-between">
                              <div className={`h-4 w-20 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                              <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                      </>
                    ) : propsSport === 'afl' && aflPropsFetchCompleteRef.current ? (
                      aflProps.length > 0 ? (
                        <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <p className="text-lg font-medium">No props match your search or filters</p>
                          <p className="text-sm mt-1">Try a different search term or adjust the Games / Prop Types / Bookmakers filters.</p>
                        </div>
                      ) : (
                        <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <p className="text-lg font-medium max-w-lg">
                            {aflIngestMessage ?? 'No odds at the moment'}
                          </p>
                          <p className="text-sm mt-2 max-w-md">
                            {aflIngestMessage
                              ? 'Check back closer to the next round, or use Try again after the next refresh.'
                              : 'If you expected to see odds, try again in a moment.'}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              userModifiedAflGamesRef.current = false;
                              aflPropsFetchCompleteRef.current = false;
                              setAflPropsLoading(true);
                              setAflPropsRetryKey((k) => k + 1);
                            }}
                            className={`mt-4 px-4 py-2 rounded-lg font-medium ${mounted && isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
                          >
                            Try again
                          </button>
                        </div>
                      )
                    ) : propsSport === 'combined' ? (
                      <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        <p className="text-lg font-medium mb-2">No props match your search</p>
                        <p className="text-sm">Try a different player or stat search.</p>
                      </div>
                    ) : propsSport === 'nba' && showNoPropsMessage ? (
                      <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${
                        mounted && isDark ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        <p className="text-lg font-medium mb-2">No props found</p>
                        <p className="text-sm">Come back later</p>
                      </div>
                    ) : (
                    <>
                      {/* Desktop Skeleton - Hidden on mobile */}
                      <div className="hidden lg:block overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className={`border-b ${isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                              <th className="py-3 px-4 text-left">
                                <div className={`h-8 w-32 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                              </th>
                              <th className={`py-3 px-4 text-left ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>Odds</th>
                              <th className={`py-3 px-4 text-left ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>IP</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>DvP</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>L5</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>L10</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>H2H</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>Season</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>Streak</th>
                              <th className={`text-center py-3 px-1 ${isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`} style={{ width: '80px' }}>Tipoff</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...Array(10)].map((_, idx) => (
                              <tr key={idx} className={`border-b ${isDark ? 'border-gray-900' : 'border-gray-200'}`}>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                                    <div className="flex-1 space-y-2">
                                      <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                                      <div className={`h-3 w-24 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="space-y-1.5">
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                    <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <div className={`h-4 w-12 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-6 w-12 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                                <td className="py-3 px-1 text-center">
                                  <div className={`h-4 w-16 mx-auto rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      {/* Mobile Skeleton - Hidden on desktop */}
                      <div className={`lg:hidden space-y-4 ${isDark ? 'bg-[#050d1a]' : ''}`}>
                        {[...Array(5)].map((_, idx) => (
                          <div
                            key={idx}
                            className={`rounded-xl border-2 pl-3 pr-4 py-3.5 ${
                              isDark ? 'bg-[#0a1929] border-gray-900' : 'bg-white border-gray-200'
                            }`}
                          >
                            {/* Header Section */}
                            <div className="mb-1.5">
                              <div className="flex items-center gap-2.5 mb-2">
                                <div className={`w-10 h-10 rounded-full animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                <div className="flex-1 space-y-2">
                                  <div className={`h-5 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  <div className={`h-4 w-24 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                                </div>
                              </div>
                            </div>
                            
                            {/* Stats Grid */}
                            <div className="grid grid-cols-4 gap-2 mb-2">
                              {[...Array(4)].map((_, statIdx) => (
                                <div
                                  key={statIdx}
                                  className={`rounded-lg border p-2 animate-pulse ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-300'}`}
                                  style={{ animationDelay: `${idx * 0.1 + statIdx * 0.05}s` }}
                                >
                                  <div className={`h-3 w-12 mb-1 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                  <div className={`h-4 w-8 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                                </div>
                              ))}
                            </div>
                            
                            {/* Bottom Row */}
                            <div className="flex items-center justify-between">
                              <div className={`h-4 w-20 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                              <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + 0.05}s` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                    )
                  ) : activeFilteredCount > 0 ? (
                    <>
                      {/* Desktop Table View - Hidden on mobile */}
                      <div className="hidden lg:block overflow-x-auto">
                        <table className="w-full">
                        <thead>
                          <tr className={`border-b ${mounted && isDark ? 'border-gray-900' : 'border-gray-200'}`}>
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
                                      ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
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
                            {isCombinedMode && (
                              <th className={`text-left py-3 px-3 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'} font-semibold text-sm`}>
                                Sport
                              </th>
                            )}
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
                          {activePaginatedProps.map((prop, idx) => {
                            const rowSport = propsSport === 'combined'
                              ? ((prop as PlayerProp & { sportSource?: 'nba' | 'afl' }).sportSource ?? 'nba')
                              : propsSport;
                            const bdlId = rowSport === 'nba' ? getPlayerIdFromName(prop.playerName) : null;
                            const nbaId = bdlId ? convertBdlToNbaId(bdlId) : null; // NBA Stats ID for headshot
                            const headshotUrl = nbaId ? getPlayerHeadshotUrl(nbaId) : null;
                            const aflHeadshotUrl =
                              rowSport === 'afl'
                                ? getAflPlayerHeadshotUrl(prop.playerName) ?? aflPortraitExtras[prop.playerName] ?? null
                                : null;
                            const aflAvatarPending =
                              rowSport === 'afl' &&
                              aflPortraitBatchLoading &&
                              !getAflPlayerHeadshotUrl(prop.playerName) &&
                              !aflPortraitExtras[prop.playerName] &&
                              !aflPortraitFetchedRef.current.has(prop.playerName);
                            const displayProp = prop;
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
                                className={`border-b ${mounted && isDark ? 'border-gray-900 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'} transition-colors cursor-pointer`}
                                onMouseEnter={() => {
                                  if (rowSport === 'afl') return;
                                  const playerId = getPlayerIdFromName(prop.playerName);
                                  if (playerId && typeof window !== 'undefined') {
                                    const currentSeason = new Date().getFullYear();
                                    // Prefetch all 4 stat endpoints to warm up server cache
                                    // Use regular fetch (not cachedFetch) to ensure server cache is warmed
                                    const prefetchUrls = [
                                      `/api/stats?player_id=${playerId}&season=${currentSeason}&per_page=100&max_pages=5&postseason=false&skip_dvp=1`,
                                      `/api/stats?player_id=${playerId}&season=${currentSeason - 1}&per_page=100&max_pages=5&postseason=false&skip_dvp=1`,
                                      `/api/stats?player_id=${playerId}&season=${currentSeason}&per_page=100&max_pages=5&postseason=true&skip_dvp=1`,
                                      `/api/stats?player_id=${playerId}&season=${currentSeason - 1}&per_page=100&max_pages=5&postseason=true&skip_dvp=1`,
                                    ];
                                    
                                    // Fire and forget - don't await, just warm up the cache
                                    prefetchUrls.forEach(url => {
                                      fetch(url, { cache: 'default' }).catch(() => {
                                        // Ignore errors - this is just prefetch
                                      });
                                    });
                                  }
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (navigatingRef.current) return;
                                  navigatingRef.current = true;
                                  setNavigatingToPlayer(true);
                                  if (rowSport === 'afl') {
                                    const team = prop.team || '';
                                    if (team) {
                                      fetch(`/api/afl/next-game?team=${encodeURIComponent(team)}&season=2026`)
                                        .then((r) => r.json())
                                        .then((d) => {
                                          try {
                                            sessionStorage.setItem('afl_next_game_prefetch', JSON.stringify({
                                              team,
                                              next_opponent: d?.next_opponent ?? null,
                                              next_game_tipoff: d?.next_game_tipoff ?? null,
                                              fetchedAt: Date.now(),
                                            }));
                                          } catch {}
                                        })
                                        .catch(() => {});
                                    }
                                    const q = new URLSearchParams();
                                    q.set('mode', 'player');
                                    q.set('name', prop.playerName);
                                    if (prop.team) q.set('team', prop.team);
                                    if (prop.opponent) q.set('opponent', prop.opponent);
                                    router.push(`/afl?${q.toString()}`);
                                    setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                                    return;
                                  }
                                  const clickData = {
                                    player: prop.playerName,
                                    statType: prop.statType,
                                    line: prop.line,
                                    timestamp: Date.now(),
                                  };
                                  if (typeof window !== 'undefined') {
                                    safeSetSessionStorage('last_prop_click', JSON.stringify(clickData));
                                  }
                                  const normalizedStat = normalizeStatForDashboard(prop.statType);
                                  const finalUrl = `/nba/research/dashboard?player=${encodeURIComponent(prop.playerName)}&stat=${normalizedStat}&line=${prop.line.toString()}&tf=last10`;
                                  if (typeof window !== 'undefined') {
                                    safeSetSessionStorage('last_prop_url', finalUrl);
                                  }
                                  if (typeof window !== 'undefined') {
                                    try {
                                      window.sessionStorage.removeItem('nba_dashboard_session_v1');
                                    } catch (err) {
                                      console.warn('Failed to clear dashboard session storage', err);
                                    }
                                  }
                                  if (typeof window !== 'undefined') {
                                    try {
                                      sessionStorage.setItem('from_props_page', 'true');
                                    } catch (err) {
                                      // Ignore
                                    }
                                  }
                                  router.push(finalUrl);
                                  setTimeout(() => {
                                    navigatingRef.current = false;
                                    setNavigatingToPlayer(false);
                                  }, 1500);
                                }}
                              >
                                {/* Player Column */}
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    {rowSport === 'nba' && headshotUrl && (
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
                                    {rowSport === 'afl' &&
                                      (aflAvatarPending ? (
                                        <div
                                          className="w-12 h-12 rounded-full flex-shrink-0 border-2 animate-pulse bg-gray-200 dark:bg-gray-600"
                                          style={{
                                            borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb',
                                          }}
                                          aria-hidden
                                        />
                                      ) : (
                                        <AflPropsPlayerAvatar
                                          headshotUrl={aflHeadshotUrl}
                                          jerseyNumber={
                                            aflPlayerNumbers[prop.playerName] != null
                                              ? aflPlayerNumbers[prop.playerName]!
                                              : null
                                          }
                                          initials={getAflInitials(prop.playerName)}
                                          isDark={isDark}
                                          mounted={mounted}
                                          size="md"
                                        />
                                      ))}
                                    <div>
                                      <div className={`font-semibold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                        {prop.playerName}
                                      </div>
                                      <div className={`text-sm font-medium ${mounted && isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                                        {getStatLabel(prop.statType)} {prop.line > 0 ? 'Over' : 'Under'} {Math.abs(prop.line)}
                                      </div>
                                      <div className="flex items-center gap-2 mt-1">
                                        {rowSport === 'afl' ? (() => {
                                          // Use the prop's gameId to get the correct game from aflGames (same source as list API); display that game's matchup.
                                          const game = prop.gameId ? aflGames.find((g) => g.gameId === prop.gameId) ?? null : null;
                                          const gameHome = game ? toOfficialAflTeamDisplayName(game.homeTeam) : toOfficialAflTeamDisplayName(prop.homeTeam || prop.team || '');
                                          const gameAway = game ? toOfficialAflTeamDisplayName(game.awayTeam) : toOfficialAflTeamDisplayName(prop.awayTeam || prop.opponent || '');
                                          const playerTeam = toOfficialAflTeamDisplayName(prop.team || '') || gameHome;
                                          const opponent = playerTeam === gameHome ? gameAway : playerTeam === gameAway ? gameHome : gameAway;
                                          const homeD = playerTeam;
                                          let awayD = opponent;
                                          const same = homeD && awayD && homeD === awayD;
                                          if (same) awayD = '';
                                          const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
                                          const tryAflLogo = (name: string): string | null => {
                                            if (!name) return null;
                                            if (aflLogoByTeam[n(name)]) return aflLogoByTeam[n(name)];
                                            for (const w of name.split(/\s+/)) {
                                              if (aflLogoByTeam[n(w)]) return aflLogoByTeam[n(w)];
                                            }
                                            return null;
                                          };
                                          const homeLogoUrl = homeD ? tryAflLogo(homeD) : null;
                                          const awayLogoUrl = awayD ? tryAflLogo(awayD) : null;
                                          return (
                                            <div className="flex items-center gap-2 flex-wrap">
                                              {homeLogoUrl ? (
                                                <img src={homeLogoUrl} alt={homeD || ''} className="w-8 h-8 object-contain flex-shrink-0" />
                                              ) : (
                                                <div className={`w-8 h-8 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                              <span className={`text-xs flex-shrink-0 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>vs</span>
                                              {awayLogoUrl ? (
                                                <img src={awayLogoUrl} alt={awayD || ''} className="w-8 h-8 object-contain flex-shrink-0" />
                                              ) : (
                                                <div className={`w-8 h-8 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                            </div>
                                          );
                                        })() : (
                                          <>
                                            <img src={teamLogoUrl} alt={prop.team} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                            <img src={opponentLogoUrl} alt={prop.opponent} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>

                                {isCombinedMode && (
                                  <td className="py-3 px-3">
                                    <SportMark sport={rowSport} isDark={mounted && isDark} />
                                  </td>
                                )}
                                
                                {/* Odds Column - Show bookmakers grouped by line with expand/collapse */}
                                <td className="py-3 px-4">
                                  <div className="space-y-2">
                                    {prop.bookmakerLines && prop.bookmakerLines.length > 0 ? (
                                      (() => {
                                        // Filter bookmakerLines by selected bookmakers (if any are selected)
                                        let filteredLines = prop.bookmakerLines;
                                        if (!isCombinedMode && selectedBookmakers.size > 0) {
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
                                                        ? 'bg-[#0a1929] border-gray-700 hover:bg-[#0d1f35]'
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
                                                          // Format odds based on user preference; show — for N/A
                                                          const formatOddsValue = (oddsStr: string): string => {
                                                            if (!oddsStr || oddsStr === 'N/A') return '—';
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
                                                      <div className={`w-px h-8 ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'}`} />
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
                                                        ? 'bg-[#0a1929] border-gray-700 text-white hover:bg-[#0d1f35]'
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
                                                            ? 'bg-[#0a1929] border-gray-700'
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
                                                                    ? 'bg-[#0a1929] border-gray-700'
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
                                                                    // Format odds based on user preference; show — for N/A
                                                                    const formatOddsValue = (oddsStr: string): string => {
                                                                      if (!oddsStr || oddsStr === 'N/A') return '—';
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
                                              <div>Over: {prop.overOdds && prop.overOdds !== 'N/A' ? prop.overOdds : '—'}</div>
                                              <div>Under: {prop.underOdds && prop.underOdds !== 'N/A' ? prop.underOdds : '—'}</div>
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
                                          const implied = calculateImpliedProbabilities(prop.overOdds, prop.underOdds);
                                          const overAmerican = parseAmericanOdds(prop.overOdds);
                                          const underAmerican = parseAmericanOdds(prop.underOdds);
                                          let overProb: number | null = implied ? implied.overImpliedProb : (overAmerican !== null ? americanToImpliedProb(overAmerican) : null);
                                          let underProb: number | null = implied ? implied.underImpliedProb : (underAmerican !== null ? americanToImpliedProb(underAmerican) : null);
                                          if (overProb === null && underProb === null) {
                                            overProb = prop.impliedOverProb ?? null;
                                            underProb = prop.impliedUnderProb ?? null;
                                          }
                                          return (
                                            <>
                                              <div className={`text-sm font-semibold ${overProb != null ? (overProb >= (underProb ?? 0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400') : ''}`}>
                                                Over {overProb != null ? `${overProb.toFixed(1)}%` : '—'}
                                              </div>
                                              <div className={`text-sm font-semibold ${underProb != null ? (underProb >= (overProb ?? 0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400') : ''}`}>
                                                Under {underProb != null ? `${underProb.toFixed(1)}%` : '—'}
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
                                  {displayProp.dvpRating !== null && displayProp.dvpRating !== undefined && typeof displayProp.dvpRating === 'number' && displayProp.dvpRating > 0 ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        // Color coding by league size.
                                        // AFL (18 teams): 1-6 hard (red), 7-12 neutral (orange), 13-18 easy (green)
                                        // NBA (30 teams): 1-10 hard (red), 11-20 neutral (orange), 21-30 easy (green)
                                        const isAflDvp = rowSport === 'afl';
                                        const easyMin = isAflDvp ? 13 : 21;
                                        const hardMax = isAflDvp ? 6 : 10;
                                        if (displayProp.dvpRating! >= easyMin) {
                                          bgColor = mounted && isDark ? '#166534' : '#dcfce7'; // green-800 / green-100
                                          borderColor = '#22c55e';
                                          glowColor = '#22c55e';
                                        } else if (displayProp.dvpRating! > hardMax) {
                                          bgColor = mounted && isDark ? '#9a3412' : '#fed7aa'; // orange-800 / orange-100
                                          borderColor = '#f97316';
                                          glowColor = '#f97316';
                                        } else {
                                          bgColor = mounted && isDark ? '#991b1b' : '#fee2e2'; // red-800 / red-100
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
                                          #{displayProp.dvpRating}
                                        </div>
                                        {displayProp.dvpStatValue !== null && displayProp.dvpStatValue !== undefined && (
                                          <div className="text-xs font-medium text-white leading-tight">
                                            {displayProp.dvpStatValue.toFixed(1)}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                
                                {/* L5 Column */}
                                <td className="py-3 px-2">
                                  {(displayProp.last5Avg !== null && displayProp.last5Avg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (displayProp.last5HitRate) {
                                          const hitRate = (displayProp.last5HitRate.hits / displayProp.last5HitRate.total) * 100;
                                          if (hitRate < 30) {
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
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
                                          {displayProp.last5Avg!.toFixed(1)}
                                        </div>
                                        {displayProp.last5HitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.last5HitRate.hits}/{displayProp.last5HitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.last5HitRate.hits / displayProp.last5HitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                
                                {/* L10 Column */}
                                <td className="py-3 px-2">
                                  {(displayProp.last10Avg !== null && displayProp.last10Avg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (displayProp.last10HitRate) {
                                          const hitRate = (displayProp.last10HitRate.hits / displayProp.last10HitRate.total) * 100;
                                          if (hitRate < 30) {
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
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
                                          {displayProp.last10Avg!.toFixed(1)}
                                        </div>
                                        {displayProp.last10HitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.last10HitRate.hits}/{displayProp.last10HitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.last10HitRate.hits / displayProp.last10HitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                
                                {/* H2H Column */}
                                <td className="py-3 px-2">
                                  {(displayProp.h2hAvg !== null && displayProp.h2hAvg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (displayProp.h2hHitRate) {
                                          const hitRate = (displayProp.h2hHitRate.hits / displayProp.h2hHitRate.total) * 100;
                                          if (hitRate < 30) {
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
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
                                          {displayProp.h2hAvg!.toFixed(1)}
                                        </div>
                                        {displayProp.h2hHitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.h2hHitRate.hits}/{displayProp.h2hHitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.h2hHitRate.hits / displayProp.h2hHitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                
                                {/* Season Column */}
                                <td className="py-3 px-2">
                                  {(displayProp.seasonAvg !== null && displayProp.seasonAvg !== undefined) ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = mounted && isDark ? '#374151' : '#f9fafb';
                                        let borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
                                        let glowColor = '';
                                        
                                        if (displayProp.seasonHitRate) {
                                          const hitRate = (displayProp.seasonHitRate.hits / displayProp.seasonHitRate.total) * 100;
                                          if (hitRate < 30) {
                                            bgColor = '#B03A3A';
                                            borderColor = '#ef4444';
                                            glowColor = '#ef4444';
                                          } else if (hitRate < 70) {
                                            bgColor = '#E88A3B';
                                            borderColor = '#f97316';
                                            glowColor = '#f97316';
                                          } else {
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
                                          {displayProp.seasonAvg!.toFixed(1)}
                                        </div>
                                        {displayProp.seasonHitRate && (
                                          <>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {displayProp.seasonHitRate.hits}/{displayProp.seasonHitRate.total}
                                            </div>
                                            <div className="text-xs font-medium text-white leading-tight">
                                              {((displayProp.seasonHitRate.hits / displayProp.seasonHitRate.total) * 100).toFixed(0)}%
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        N/A
                                      </div>
                                    </div>
                                  )}
                                </td>
                                
                                {/* Streak Column */}
                                <td className="py-3 px-2">
                                  {(displayProp.streak !== null && displayProp.streak !== undefined) ? (
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg border"
                                      style={(() => {
                                        let bgColor = '';
                                        let borderColor = '';
                                        let glowColor = '';
                                        
                                        if (displayProp.streak! >= 2) {
                                          bgColor = '#22c55e';
                                          borderColor = '#22c55e';
                                          glowColor = '#22c55e';
                                        } else if (displayProp.streak === 1) {
                                          bgColor = '#E88A3B';
                                          borderColor = '#f97316';
                                          glowColor = '#f97316';
                                        } else {
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
                                        {displayProp.streak === 0 ? '0' : `${displayProp.streak} 🔥`}
                                      </span>
                                    </div>
                                  ) : propsSport === 'afl' ? (
                                    <div className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border-2"
                                      style={{
                                        background: mounted && isDark ? '#374151' : '#f3f4f6',
                                        borderColor: mounted && isDark ? '#4b5563' : '#d1d5db',
                                        borderWidth: '2px',
                                        boxShadow: 'none',
                                      }}>
                                      <div className={`text-sm font-bold ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>N/A</div>
                                    </div>
                                  ) : (
                                    <div className={`text-sm font-medium ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>-</div>
                                  )}
                                </td>
                                
                                {/* Tipoff Countdown Column */}
                                <td className="py-3 px-2">
                                  <TipoffCountdown
                                    game={getTipoffGameForRow(prop, rowSport)}
                                    isDark={mounted && isDark}
                                  />
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
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
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
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
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
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
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
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
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
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
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
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
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
                                    ? 'bg-gray-800 border-gray-800 text-gray-400 hover:bg-gray-700'
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
                      <div className={`lg:hidden space-y-4 ${mounted && isDark ? 'bg-[#050d1a]' : ''}`}>
                        {activePaginatedProps.map((prop, idx) => {
                          const rowSport = propsSport === 'combined'
                            ? ((prop as PlayerProp & { sportSource?: 'nba' | 'afl' }).sportSource ?? 'nba')
                            : propsSport;
                          const bdlId = rowSport === 'nba' ? getPlayerIdFromName(prop.playerName) : null;
                          const nbaId = bdlId ? convertBdlToNbaId(bdlId) : null;
                          const headshotUrl = nbaId ? getPlayerHeadshotUrl(nbaId) : null;
                          const aflHeadshotUrl =
                            rowSport === 'afl'
                              ? getAflPlayerHeadshotUrl(prop.playerName) ?? aflPortraitExtras[prop.playerName] ?? null
                              : null;
                          const aflAvatarPending =
                            rowSport === 'afl' &&
                            aflPortraitBatchLoading &&
                            !getAflPlayerHeadshotUrl(prop.playerName) &&
                            !aflPortraitExtras[prop.playerName] &&
                            !aflPortraitFetchedRef.current.has(prop.playerName);
                          const normalizeTeam = (team: string): string => {
                            if (!team) return '';
                            if (team.length <= 3) return team.toUpperCase();
                            return TEAM_FULL_TO_ABBR[team] || team.toUpperCase();
                          };
                          const teamAbbr = normalizeTeam(prop.team);
                          const opponentAbbr = normalizeTeam(prop.opponent);
                          const teamLogoUrl = getEspnLogoUrl(teamAbbr);
                          const opponentLogoUrl = getEspnLogoUrl(opponentAbbr);
                          const game = getTipoffGameForRow(prop, rowSport);
                          
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
                            if (!hitRate || hitRate.total === 0) return 'N/A';
                            return `${((hitRate.hits / hitRate.total) * 100).toFixed(0)}%`;
                          };
                          
                          // Helper to get stat box color based on hit rate
                          const getStatBoxStyle = (hitRate: { hits: number; total: number } | null | undefined, isStreak = false) => {
                            // If no hitRate data (null/undefined) or no valid data (total === 0) and not streak, return grey box - darker on mobile/dark mode
                            if (!isStreak && (!hitRate || hitRate.total === 0)) {
                              return {
                                background: mounted && isDark ? '#1f2937' : '#f3f4f6',
                                borderColor: mounted && isDark ? '#374151' : '#d1d5db',
                                borderWidth: '2px',
                                boxShadow: 'none',
                              };
                            }
                            
                            let bgColor = mounted && isDark ? '#1f2937' : '#f9fafb';
                            let borderColor = mounted && isDark ? '#374151' : '#e5e7eb';
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
                              background: bgColor !== (mounted && isDark ? '#1f2937' : '#f9fafb')
                                ? `linear-gradient(to top, ${bgColor}, ${bgColor}00)`
                                : bgColor,
                              borderColor: borderColor,
                              borderWidth: '1px',
                              boxShadow: glowColor ? `0 0 8px ${glowColor}60, 0 0 4px ${glowColor}40` : 'none',
                            };
                          };
                          
                          // Format odds helper; show — for N/A
                          const formatOddsValue = (oddsStr: string): string => {
                            if (!oddsStr || oddsStr === 'N/A') return '—';
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
                              className={`relative rounded-xl border-2 pl-3 pr-4 py-3.5 ${isCombinedMode ? 'pt-8' : ''} ${
                                mounted && isDark ? 'bg-[#0a1929] border-gray-900' : 'bg-white border-gray-200'
                              }`}
                              onClick={() => {
                                if (navigatingRef.current) return;
                                navigatingRef.current = true;
                                setNavigatingToPlayer(true);
                                if (rowSport === 'afl') {
                                  const team = prop.team || '';
                                  if (team) {
                                    fetch(`/api/afl/next-game?team=${encodeURIComponent(team)}&season=2026`)
                                      .then((r) => r.json())
                                      .then((d) => {
                                        try {
                                          sessionStorage.setItem('afl_next_game_prefetch', JSON.stringify({
                                            team,
                                            next_opponent: d?.next_opponent ?? null,
                                            next_game_tipoff: d?.next_game_tipoff ?? null,
                                            fetchedAt: Date.now(),
                                          }));
                                        } catch {}
                                      })
                                      .catch(() => {});
                                  }
                                  const q = new URLSearchParams();
                                  q.set('mode', 'player');
                                  q.set('name', prop.playerName);
                                  if (prop.team) q.set('team', prop.team);
                                  if (prop.opponent) q.set('opponent', prop.opponent);
                                  router.push(`/afl?${q.toString()}`);
                                  setTimeout(() => { navigatingRef.current = false; setNavigatingToPlayer(false); }, 1500);
                                  return;
                                }
                                try {
                                  sessionStorage.removeItem('nba_dashboard_session_v1');
                                  sessionStorage.setItem('from_props_page', 'true');
                                } catch {}
                                const params = new URLSearchParams();
                                params.set('player', prop.playerName);
                                params.set('stat', (prop.statType || '').toLowerCase());
                                params.set('line', prop.line.toString());
                                params.set('tf', 'last10');
                                router.push(`/nba/research/dashboard?${params.toString()}`);
                                setTimeout(() => {
                                  navigatingRef.current = false;
                                  setNavigatingToPlayer(false);
                                }, 1500);
                              }}
                            >
                              {isCombinedMode && (
                                <div className="absolute top-2 left-2 z-10 pointer-events-none">
                                  <SportMark sport={rowSport} isDark={mounted && isDark} />
                                </div>
                              )}
                              {/* Header Section */}
                              <div className="mb-1.5">
                                {/* Player Name and Headshot Row */}
                                <div className="flex items-center gap-2.5 mb-2">
                                  {rowSport === 'afl' ? (
                                    aflAvatarPending ? (
                                      <div
                                        className="w-10 h-10 rounded-full flex-shrink-0 border-2 animate-pulse bg-gray-200 dark:bg-gray-600"
                                        style={{
                                          borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb',
                                        }}
                                        aria-hidden
                                      />
                                    ) : (
                                      <AflPropsPlayerAvatar
                                        headshotUrl={aflHeadshotUrl}
                                        jerseyNumber={
                                          aflPlayerNumbers[prop.playerName] != null
                                            ? aflPlayerNumbers[prop.playerName]!
                                            : null
                                        }
                                        initials={getAflInitials(prop.playerName)}
                                        isDark={isDark}
                                        mounted={mounted}
                                        size="sm"
                                      />
                                    )
                                  ) : headshotUrl ? (
                                    <div className="w-10 h-10 rounded-full object-cover flex-shrink-0 border-2 overflow-hidden relative" style={{ borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb' }}>
                                      <Image
                                        src={headshotUrl}
                                        alt={prop.playerName}
                                        width={40}
                                        height={40}
                                        className="object-cover"
                                        loading="lazy"
                                        unoptimized={false}
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                    </div>
                                  ) : null}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className={`font-bold text-base truncate ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                        {prop.playerName}
                                      </div>
                                      {/* Team Logos */}
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {rowSport === 'afl' ? (() => {
                                          const game = prop.gameId ? aflGames.find((g) => g.gameId === prop.gameId) ?? null : null;
                                          const gameHome = game ? toOfficialAflTeamDisplayName(game.homeTeam) : toOfficialAflTeamDisplayName(prop.homeTeam || prop.team || '');
                                          const gameAway = game ? toOfficialAflTeamDisplayName(game.awayTeam) : toOfficialAflTeamDisplayName(prop.awayTeam || prop.opponent || '');
                                          const playerTeam = toOfficialAflTeamDisplayName(prop.team || '') || gameHome;
                                          const opponent = playerTeam === gameHome ? gameAway : playerTeam === gameAway ? gameHome : gameAway;
                                          const homeD = playerTeam;
                                          let awayD = opponent;
                                          const same = homeD && awayD && homeD === awayD;
                                          if (same) awayD = '';
                                          const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
                                          const tryAflLogo = (name: string): string | null => {
                                            if (!name) return null;
                                            if (aflLogoByTeam[n(name)]) return aflLogoByTeam[n(name)];
                                            for (const w of name.split(/\s+/)) {
                                              if (aflLogoByTeam[n(w)]) return aflLogoByTeam[n(w)];
                                            }
                                            return null;
                                          };
                                          const homeLogoUrl = homeD ? tryAflLogo(homeD) : null;
                                          const awayLogoUrl = awayD ? tryAflLogo(awayD) : null;
                                          return (
                                            <>
                                              {homeLogoUrl ? (
                                                <img src={homeLogoUrl} alt={homeD || ''} className="w-5 h-5 object-contain" />
                                              ) : (
                                                <div className={`w-5 h-5 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                              <span className={`text-[10px] leading-none ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>vs</span>
                                              {awayLogoUrl ? (
                                                <img src={awayLogoUrl} alt={awayD || ''} className="w-5 h-5 object-contain" />
                                              ) : (
                                                <div className={`w-5 h-5 rounded-full border flex-shrink-0 ${mounted && isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`} />
                                              )}
                                            </>
                                          );
                                        })() : (
                                          <>
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
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    {/* Stat Type and Line */}
                                    <div className={`text-sm font-semibold mt-0.5 ${mounted && isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                                      {getStatLabel(prop.statType)} {prop.line > 0 ? 'Over' : 'Under'} {Math.abs(prop.line)}
                                    </div>
                                  </div>
                                  {/* Bookmaker IP Box - darker text on mobile */}
                                  <div className="flex-shrink-0">
                                    <div className="flex flex-col items-center justify-center rounded-lg border-2 px-3 py-2" style={getStatBoxStyle(null)}>
                                      <div className={`text-[10px] font-semibold mb-1 ${mounted && isDark ? 'text-gray-500 sm:text-gray-300' : 'text-gray-600 sm:text-gray-700'}`}>Books</div>
                                      {(() => {
                                        // Calculate implied probabilities on-the-fly from odds
                                        const implied = calculateImpliedProbabilities(prop.overOdds, prop.underOdds);
                                        const overProb = implied ? implied.overImpliedProb : (prop.impliedOverProb ?? null);
                                        const underProb = implied ? implied.underImpliedProb : (prop.impliedUnderProb ?? null);
                                        return (
                                          <>
                                            <div className={`text-xs font-bold ${mounted && isDark ? 'text-green-500 sm:text-green-400' : 'text-green-600'}`}>
                                              {overProb !== null && overProb !== undefined ? `${overProb.toFixed(0)}%` : '-'}
                                            </div>
                                            <div className={`text-xs font-bold ${mounted && isDark ? 'text-red-500 sm:text-red-400' : 'text-red-600'}`}>
                                              {underProb !== null && underProb !== undefined ? `${underProb.toFixed(0)}%` : '-'}
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Statistics Grid */}
                              <div className={`grid grid-cols-6 gap-0.5 px-0 py-2.5 rounded-xl mb-3 w-full ${
                                mounted && isDark ? 'bg-gray-900/80' : 'bg-gray-50'
                              }`}>
                                {/* L5 */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.last5HitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>L5</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.last5HitRate || prop.last5HitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
                                    {getHitRatePercent(prop.last5HitRate)}
                                  </div>
                                </div>
                                
                                {/* L10 */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.last10HitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>L10</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.last10HitRate || prop.last10HitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
                                    {getHitRatePercent(prop.last10HitRate)}
                                  </div>
                                </div>
                                
                                {/* H2H */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.h2hHitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>H2H</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.h2hHitRate || prop.h2hHitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
                                    {getHitRatePercent(prop.h2hHitRate)}
                                  </div>
                                </div>
                                
                                {/* STRK */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(null, true)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>STRK</div>
                                  <div className={`text-sm font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                                    {prop.streak ?? 'N/A'}
                                  </div>
                                </div>
                                
                                {/* SZN */}
                                <div className="flex flex-col items-center justify-center rounded-lg border-2 py-2 w-full" style={getStatBoxStyle(prop.seasonHitRate)}>
                                  <div className={`text-[10px] font-semibold mb-0.5 ${mounted && isDark ? 'text-gray-300' : 'text-gray-700'}`}>SZN</div>
                                  <div className={`text-sm font-bold ${
                                    (!prop.seasonHitRate || prop.seasonHitRate.total === 0)
                                      ? (mounted && isDark ? 'text-gray-400' : 'text-gray-500')
                                      : (mounted && isDark ? 'text-white' : 'text-gray-900')
                                  }`}>
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
                                  const isAflDvp = rowSport === 'afl';
                                  const easyMin = isAflDvp ? 13 : 21;
                                  const hardMax = isAflDvp ? 6 : 10;
                                  if (prop.dvpRating >= easyMin) {
                                    bgColor = '#22c55e';
                                    borderColor = '#22c55e';
                                    glowColor = '#22c55e';
                                  } else if (prop.dvpRating > hardMax) {
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
                                    {prop.dvpRating !== null && prop.dvpRating !== undefined ? `#${prop.dvpRating}` : 'N/A'}
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
                                  if (!isCombinedMode && selectedBookmakers.size > 0) {
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
                                
                                // Mobile: Show first 2 bookmakers + "+ X" button
                                const allBookmakers = Array.from(linesByValue.values()).flat();
                                const firstTwoBookmakers = allBookmakers.slice(0, 2);
                                const remainingCount = allBookmakers.length - 2;
                                const expandKey = `${prop.playerName}|${prop.statType}|mobile-all`;
                                const isPopupOpen = openPopup === expandKey;
                                
                                return (
                                  <div className="flex items-center gap-2.5">
                                    <div className="flex gap-2 flex-1">
                                      {/* First 2 bookmakers */}
                                      {firstTwoBookmakers.map((bookmaker, idx) => {
                                        const bookmakerKey = bookmaker.bookmaker?.toLowerCase() || '';
                                        const bookmakerInfo = BOOKMAKER_INFO[bookmakerKey] || BOOKMAKER_INFO[bookmakerKey.replace(/\s+/g, '')] || null;
                                        return (
                                          <div
                                            key={idx}
                                            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border-2 flex-shrink-0 ${
                                              mounted && isDark ? 'bg-[#0a1929] border-gray-800' : 'bg-gray-100 border-gray-300'
                                            }`}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {bookmakerInfo?.logoUrl && (
                                              <img
                                                src={bookmakerInfo.logoUrl}
                                                alt={bookmakerInfo.name}
                                                className="object-contain rounded flex-shrink-0"
                                                style={{ width: '20px', height: '20px' }}
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            )}
                                            <div className="flex flex-col gap-0.5 min-w-0">
                                              <span className={`font-bold ${mounted && isDark ? 'text-green-400' : 'text-green-600'}`} style={{ fontSize: '11px' }}>
                                                O {formatOddsValue(bookmaker.overOdds)}
                                              </span>
                                              <span className={`font-bold ${mounted && isDark ? 'text-red-400' : 'text-red-600'}`} style={{ fontSize: '11px' }}>
                                                U {formatOddsValue(bookmaker.underOdds)}
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                      
                                      {/* "+ X" button if there are more bookmakers */}
                                      {remainingCount > 0 && (
                                        <div className="relative">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenPopup(openPopup === expandKey ? null : expandKey);
                                            }}
                                            className={`flex items-center justify-center px-1 py-1.5 rounded-lg border-2 flex-shrink-0 relative ${
                                              mounted && isDark ? 'bg-[#0a1929] border-gray-800 hover:bg-[#0d1f35]' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                                            }`}
                                            style={{ minWidth: '40px' }}
                                          >
                                            <span className={`text-xs font-bold ${mounted && isDark ? 'text-white' : 'text-gray-700'}`}>
                                              +{remainingCount}
                                            </span>
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
                                                    ? 'bg-[#0a1929] border-gray-800'
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
                                                          mounted && isDark ? 'bg-[#0a1929] border-gray-800' : 'bg-gray-50 border-gray-200'
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
                      <div className="flex items-center justify-between mt-6 px-2 pb-24 sm:pb-4">
                        <div className={`text-sm ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {propsSport === 'afl'
                            ? `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1} - ${Math.min(currentPage * ITEMS_PER_PAGE, displaySortedAflProps.length)} of ${displaySortedAflProps.length}`
                            : propsSport === 'combined'
                              ? `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1} - ${Math.min(currentPage * ITEMS_PER_PAGE, displaySortedCombinedProps.length)} of ${displaySortedCombinedProps.length}`
                              : `Showing ${(currentPageSafe - 1) * pageSize + 1} - ${Math.min(currentPageSafe * pageSize, displaySortedProps.length)} of ${totalPropsCount}`}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setCurrentPage(Math.max(1, activeCurrentPage - 1))}
                            disabled={activeCurrentPage === 1}
                            className={`px-3 py-1 rounded border text-sm ${
                              (activeCurrentPage === 1)
                                ? mounted && isDark ? 'text-gray-500 border-gray-700 cursor-not-allowed' : 'text-gray-400 border-gray-200 cursor-not-allowed'
                                : mounted && isDark ? 'text-gray-200 border-gray-600 hover:bg-gray-700' : 'text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Prev
                          </button>
                          <span className={`text-sm ${mounted && isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                            Page {activeCurrentPage} / {activeTotalPages}
                          </span>
                          <button
                            onClick={() => setCurrentPage(Math.min(activeTotalPages, activeCurrentPage + 1))}
                            disabled={activeCurrentPage === activeTotalPages}
                            className={`px-3 py-1 rounded border text-sm ${
                              (activeCurrentPage === activeTotalPages)
                                ? mounted && isDark ? 'text-gray-500 border-gray-700 cursor-not-allowed' : 'text-gray-400 border-gray-200 cursor-not-allowed'
                                : mounted && isDark ? 'text-gray-200 border-gray-600 hover:bg-gray-700' : 'text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                  
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

      {/* Find player (not in props / no odds): bottom-right mobile, top-right desktop */}
      <button
        type="button"
        onClick={() => {
          setFindPlayerOpen(true);
          setFindPlayerQuery('');
          setFindPlayerResults([]);
        }}
        className={`fixed z-[70] right-4 bottom-20 lg:bottom-auto lg:top-4 flex items-center justify-center w-12 h-12 rounded-full shadow-lg border transition-transform hover:scale-105 active:scale-95 ${
          mounted && isDark
            ? 'bg-[#0a1929] border-gray-600 text-purple-400 hover:bg-gray-800'
            : 'bg-white border-gray-200 text-purple-600 hover:bg-gray-50'
        }`}
        aria-label="Search players who may not have odds"
        title="Find player (may not have odds)"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>

      {/* Find player modal */}
      {findPlayerOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setFindPlayerOpen(false)}
          role="presentation"
        >
          <div
            className={`w-full max-w-md max-h-[85vh] flex flex-col rounded-xl border shadow-xl ${
              mounted && isDark ? 'bg-[#0a1929] border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="find-player-title"
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 id="find-player-title" className={`text-lg font-semibold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                Find player
              </h2>
              <button
                type="button"
                onClick={() => setFindPlayerOpen(false)}
                className={`rounded p-1.5 transition-colors ${mounted && isDark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100'}`}
                aria-label="Close"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <p className={`text-sm mb-3 ${mounted && isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                Search for players who may not appear or don&apos;t have odds on this page.
              </p>
              <input
                type="text"
                value={findPlayerQuery}
                onChange={(e) => setFindPlayerQuery(e.target.value)}
                placeholder={propsSport === 'afl' ? 'Search AFL players...' : propsSport === 'combined' ? 'Search NBA or AFL players...' : 'Search NBA players...'}
                className={`w-full px-4 py-2.5 rounded-lg border text-sm ${
                  mounted && isDark
                    ? 'bg-[#10243e] border-gray-600 text-white placeholder-gray-500'
                    : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
                }`}
                autoFocus
                autoComplete="off"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              {findPlayerLoading && (
                <p className={`text-sm py-4 ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>Searching...</p>
              )}
              {!findPlayerLoading && findPlayerQuery.trim().length < 2 && (
                <p className={`text-sm py-4 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Type at least 2 characters to search.
                </p>
              )}
              {!findPlayerLoading && findPlayerQuery.trim().length >= 2 && findPlayerResults.length === 0 && (
                <p className={`text-sm py-4 ${mounted && isDark ? 'text-gray-500' : 'text-gray-400'}`}>No players found.</p>
              )}
              {!findPlayerLoading && findPlayerResults.length > 0 && (
                <ul className="space-y-1">
                  {findPlayerResults.map((player, idx) => (
                    <li key={`${player.name}-${player.team ?? ''}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setFindPlayerOpen(false);
                          if (propsSport === 'afl') {
                            const team = player.team ?? '';
                            if (team) {
                              fetch(`/api/afl/next-game?team=${encodeURIComponent(team)}&season=2026`)
                                .then((r) => r.json())
                                .then((d) => {
                                  try {
                                    sessionStorage.setItem('afl_next_game_prefetch', JSON.stringify({
                                      team,
                                      next_opponent: d?.next_opponent ?? null,
                                      next_game_tipoff: d?.next_game_tipoff ?? null,
                                      fetchedAt: Date.now(),
                                    }));
                                  } catch {}
                                })
                                .catch(() => {});
                            }
                            const q = new URLSearchParams();
                            q.set('mode', 'player');
                            q.set('name', player.name);
                            if (player.team) q.set('team', player.team);
                            router.push(`/afl?${q.toString()}`);
                          } else {
                            try {
                              sessionStorage.removeItem('nba_dashboard_session_v1');
                              sessionStorage.setItem('from_props_page', 'true');
                            } catch {}
                            router.push(`/nba/research/dashboard?player=${encodeURIComponent(player.name)}&tf=last10`);
                          }
                        }}
                        className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors ${
                          mounted && isDark
                            ? 'text-gray-200 hover:bg-gray-800'
                            : 'text-gray-800 hover:bg-gray-100'
                        }`}
                      >
                        <span className="font-medium">{player.name}</span>
                        {player.team && (
                          <span className={mounted && isDark ? 'text-gray-500 ml-2' : 'text-gray-400 ml-2'}>{player.team}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation - Only visible on mobile */}
      <MobileBottomNavigation
        hasPremium={isPro}
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
        onProfileClick={() => window.dispatchEvent(new CustomEvent('open-profile-modal'))}
        onSubscription={() => router.push('/subscription')}
        onLogout={async () => {
          await supabase.auth.signOut();
          router.push('/');
        }}
        theme={theme}
        oddsFormat={oddsFormat}
        setTheme={setTheme}
        setOddsFormat={(fmt) => {
          setOddsFormat(fmt);
          try {
            localStorage.setItem('oddsFormat', fmt);
          } catch {
            // ignore
          }
        }}
      />

      {mounted && showAflComingSoonPopup && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/60 px-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${
              isDark ? 'bg-[#0a1929] border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>🏉 AFL Launch Update</h3>
                <p className={`mt-2 text-sm leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  AFL is launching soon and will be live before the season begins. 🚀 We are building the most advanced AFL props and analytics experience on the market. 📊
                </p>
              </div>
              <button
                type="button"
                onClick={dismissAflComingSoonPopup}
                className={`rounded p-1 transition-colors ${
                  isDark ? 'text-gray-400 hover:bg-[#10243e] hover:text-gray-200' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
                aria-label="Close AFL announcement"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              onClick={dismissAflComingSoonPopup}
              className="mt-4 w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
            >
              Got it
            </button>
          </div>
        </div>
      )}
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

