"use client";

import { supabase } from "@/lib/supabaseClient";
import React, { useEffect, useState, useMemo, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LeftSidebar from "@/components/LeftSidebar";
import RightSidebar from "@/components/RightSidebar";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { StatTrackrLogoWithText } from "@/components/StatTrackrLogo";
import { useTheme } from "@/contexts/ThemeContext";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from 'recharts';
import { getBookmakerInfo } from '@/lib/bookmakers';
import { formatOdds } from '@/lib/currencyUtils';
import { getFullTeamName } from '@/lib/teamMapping';
import { generateInsights, type Insight } from '@/components/RightSidebar';
import type { JournalBet as InsightsJournalBet } from '@/lib/insightsUtils';
import { Lightbulb, ChevronDown, ChevronUp, TrendingUp, TrendingDown, BarChart3, Minus, X } from 'lucide-react';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';

export default function JournalPage() {
  return (
    <ThemeProvider>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
          <div className="text-xl">Loading journal...</div>
        </div>
      }>
        <ErrorBoundary>
          <JournalContent />
        </ErrorBoundary>
      </Suspense>
    </ThemeProvider>
  );
}

// Simple error boundary component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Journal page error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-4">
          <div className="text-center">
            <div className="text-xl font-bold mb-2">Something went wrong</div>
            {/* Don't show error message in production */}
            {process.env.NODE_ENV === 'development' && (
              <div className="text-sm text-gray-400 mb-4">{this.state.error?.message}</div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Bet type from database
type Bet = {
  id: string;
  date: string;
  sport: string;
  market: string | null;
  selection: string;
  stake: number;
  currency: string;
  odds: number;
  result: 'win' | 'loss' | 'void' | 'pending';
  status?: 'pending' | 'live' | 'completed' | null;
  bookmaker?: string | null;
  created_at: string;
  opponent?: string | null;
  actual_value?: number | null;
  stat_type?: string | null;
  player_id?: string | null;
  game_date?: string | null;
  line?: number | null;
  over_under?: 'over' | 'under' | null;
  parlay_legs?: Array<{
    playerName?: string;
    playerId?: string;
    team?: string;
    opponent?: string;
    gameDate?: string;
    overUnder?: 'over' | 'under';
    line?: number;
    statType?: string;
    isGameProp?: boolean;
    won?: boolean | null;
    void?: boolean;
  }> | null;
};

type BookmakerEntry = { key: string; raw: string };

const SPECIAL_BOOKMAKER_LABELS: Record<string, string> = {
  unknown: 'Unknown',
  'multiple bookmakers': 'Multiple Bookmakers',
  'manual entry': 'Manual Entry',
};

function extractBookmakerEntries(bookmaker: string | null | undefined): BookmakerEntry[] {
  if (!bookmaker || bookmaker.trim() === '' || bookmaker === 'Unknown') {
    return [{ key: 'unknown', raw: 'Unknown' }];
  }

  try {
    const parsed = JSON.parse(bookmaker);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const entries = parsed
        .map((value) => (typeof value === 'string' ? value : String(value)))
        .map((value) => value.trim())
        .filter(Boolean)
        .map((raw) => ({ key: raw.toLowerCase(), raw }));
      if (entries.length > 0) {
        return entries;
      }
    }
  } catch {
    // Not JSON, treat as regular string
  }

  const trimmed = bookmaker.trim();
  if (!trimmed) {
    return [{ key: 'unknown', raw: 'Unknown' }];
  }

  return [{ key: trimmed.toLowerCase(), raw: trimmed }];
}

function getBookmakerDisplayName(entry: BookmakerEntry): string {
  const specialLabel = SPECIAL_BOOKMAKER_LABELS[entry.key];
  if (specialLabel) {
    return specialLabel;
  }

  const info = getBookmakerInfo(entry.raw || entry.key);
  return info?.name || entry.raw || 'Unknown';
}

// Helper function to format bookmaker display
function formatBookmakerDisplay(bookmaker: string | null | undefined, isVoid: boolean = false, isParlay: boolean = false): string {
  // For void bets, show N/A instead of Unknown
  if (isVoid) {
    return 'N/A';
  }
  
  const entries = extractBookmakerEntries(bookmaker);
  if (entries.length === 0) {
    // For parlays, show "PARLAY" instead of "Unknown"
    return isParlay ? 'PARLAY' : 'Unknown';
  }

  const displayNames = entries
    .map((entry) => getBookmakerDisplayName(entry))
    .filter((name, index, arr) => name && arr.indexOf(name) === index);

  const result = displayNames.length > 0 ? displayNames.join(', ') : 'Unknown';
  
  // For parlays, if it's "Unknown" or "Manual Entry", show "PARLAY"
  if (isParlay && (result === 'Unknown' || result === 'Manual Entry')) {
    return 'PARLAY';
  }

  return result;
}

// Helper function to capitalize player names properly
function capitalizePlayerName(name: string): string {
  if (!name || name.trim() === '') return name;
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Helper function to parse parlay legs from selection text
function parseParlayLegs(selectionText: string): Array<{
  playerName: string;
  overUnder: 'over' | 'under';
  line: number;
  statName: string;
}> {
  if (!selectionText || !selectionText.startsWith('Parlay:')) {
    return [];
  }
  
  // Remove "Parlay: " prefix
  const legsText = selectionText.replace(/^Parlay:\s*/, '');
  const legs = legsText.split(' + ').map(leg => leg.trim()).filter(leg => leg);
  
  const parsedLegs: Array<{
    playerName: string;
    overUnder: 'over' | 'under';
    line: number;
    statName: string;
  }> = [];
  
  for (const leg of legs) {
    // Pattern: "PlayerName over/under Line StatName"
    // Examples: "Nikola Jokic over 11.5 Rebounds", "Anthony Edwards under 26.5 Points"
    const match = leg.match(/^(.+?)\s+(over|under)\s+([\d.]+)\s+(.+)$/i);
    if (match) {
      const [, playerName, overUnder, lineStr, statName] = match;
      const line = parseFloat(lineStr);
      if (!isNaN(line)) {
        parsedLegs.push({
          playerName: capitalizePlayerName(playerName.trim()),
          overUnder: (overUnder.toLowerCase() as 'over' | 'under'),
          line,
          statName: statName.trim().toLowerCase(),
        });
      }
    }
  }
  
  return parsedLegs;
}

// Helper function to check if a bet was created today (kept for potential future use)
function isBetCreatedToday(createdAt: string): boolean {
  if (!createdAt) return false;
  const betDate = new Date(createdAt);
  const today = new Date();
  return (
    betDate.getDate() === today.getDate() &&
    betDate.getMonth() === today.getMonth() &&
    betDate.getFullYear() === today.getFullYear()
  );
}

// Helper function to format stat type for display
function formatStatType(statType: string | null | undefined): string {
  if (!statType) return '';
  const statMap: Record<string, string> = {
    'pts': 'PTS',
    'reb': 'REB',
    'ast': 'AST',
    'stl': 'STL',
    'blk': 'BLK',
    'fg3m': '3PM',
    'pr': 'PR',
    'pra': 'PRA',
    'ra': 'RA',
  };
  return statMap[statType.toLowerCase()] || statType.toUpperCase();
}

function JournalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [navigatingToJournal, setNavigatingToJournal] = useState(false);
  const [hasProAccess, setHasProAccess] = useState<boolean | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [hasMoreBets, setHasMoreBets] = useState(false);
  const [loadingMoreBets, setLoadingMoreBets] = useState(false);
  
  // Function to load more bets (pagination)
  const loadMoreBets = async () => {
    if (loadingMoreBets || !hasMoreBets) return;
    
    setLoadingMoreBets(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const BATCH_SIZE = 200;
      const { data: moreBets, count } = await supabase
        .from('bets')
        .select('*', { count: 'exact' })
        .eq('user_id', session.user.id)
        .order('date', { ascending: false })
        .range(bets.length, bets.length + BATCH_SIZE - 1);

      if (moreBets && moreBets.length > 0) {
        setBets(prev => [...prev, ...moreBets]);
        setHasMoreBets((count || 0) > bets.length + moreBets.length);
      } else {
        setHasMoreBets(false);
      }
    } catch (error) {
      console.error('Error loading more bets:', error);
    } finally {
      setLoadingMoreBets(false);
    }
  };
  
  // Expose manual trigger function to window for testing
  useEffect(() => {
    (window as any).checkJournalBets = async (recalculate = false) => {
      console.log(`🔄 Manually triggering check-journal-bets${recalculate ? ' (recalculate mode)' : ''}...`);
      try {
        const response = await fetch(`/api/check-journal-bets${recalculate ? '?recalculate=true' : ''}`, {
          credentials: 'include',
        });
        
        if (!response.ok) {
          const text = await response.text();
          console.error('❌ Failed:', response.status, response.statusText);
          console.error('Response:', text);
          return;
        }
        
        const data = await response.json();
        console.log('✅ Response:', data);
        console.log(`📊 Updated ${data.updated || 0} bet(s)`);
        
        // Refresh bets
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const BATCH_SIZE = 200;
          const { data: refreshedBets, count } = await supabase
            .from('bets')
            .select('*', { count: 'exact' })
            .eq('user_id', session.user.id)
            .order('date', { ascending: false })
            .limit(BATCH_SIZE);
          
          if (refreshedBets) {
            setBets(refreshedBets);
            setHasMoreBets((count || 0) > BATCH_SIZE);
            console.log('✅ Bets refreshed');
          }
        }
      } catch (error) {
        console.error('❌ Error:', error);
      }
    };
    
    console.log('💡 To manually check journal bets, run: checkJournalBets() or checkJournalBets(true) for recalculate mode');
    console.log('📝 Server-side logs (with detailed debugging) appear in your terminal where "npm run dev" is running');
  }, []);
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('decimal');
  const [dateRange, setDateRange] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'yearly'>(() => {
    if (typeof window !== 'undefined') {
      try {
        return (localStorage.getItem('journal-dateRange') as 'all' | 'daily' | 'weekly' | 'monthly' | 'yearly') || 'all';
      } catch (e) {
        return 'all';
      }
    }
    return 'all';
  });
  const [currency, setCurrency] = useState<'USD' | 'AUD' | 'GBP' | 'EUR'>(() => {
    if (typeof window !== 'undefined') {
      try {
        return (localStorage.getItem('journal-currency') as 'USD' | 'AUD' | 'GBP' | 'EUR') || 'USD';
      } catch (e) {
        return 'USD';
      }
    }
    return 'USD';
  });
  const [viewMode, setViewMode] = useState<'money' | 'units'>(() => {
    if (typeof window !== 'undefined') {
      try {
        return (localStorage.getItem('journal-viewMode') as 'money' | 'units') || 'money';
      } catch (e) {
        return 'money';
      }
    }
    return 'money';
  });
  const [unitSize, setUnitSize] = useState<number | null>(null);
  const [bankroll, setBankroll] = useState<number | null>(null);
  const [bankrollSetDate, setBankrollSetDate] = useState<string | null>(null);
  
  const currencySymbols: Record<typeof currency, string> = {
    USD: '$',
    AUD: 'A$',
    GBP: '£',
    EUR: '€'
  };
 const formatCurrency = (value: number, options?: { showSign?: boolean }) => {
   const showSign = options?.showSign ?? false;
   const symbol = currencySymbols[currency] || '';
   const signPrefix = showSign
     ? value > 0
       ? '+'
       : value < 0
         ? '-'
         : ''
     : '';
   return `${signPrefix}${symbol}${Math.abs(value).toFixed(2)}`;
 };
 
 // Convert money to units if in units mode
 const convertToUnits = (moneyValue: number): number => {
   if (viewMode === 'money' || !unitSize || unitSize <= 0) {
     return moneyValue;
   }
   return moneyValue / unitSize;
 };
 
 // Format value based on view mode
 const formatValue = (value: number, options?: { showSign?: boolean }) => {
   if (viewMode === 'units') {
     const units = convertToUnits(value);
     const showSign = options?.showSign ?? false;
     const signPrefix = showSign
       ? units > 0
         ? '+'
         : units < 0
           ? '-'
           : ''
       : '';
     return `${signPrefix}${Math.abs(units).toFixed(2)} units`;
   }
   return formatCurrency(value, options);
 };
  const [sport, setSport] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('journal-sport') || 'All';
      } catch (e) {
        return 'All';
      }
    }
    return 'All';
  });
  const [betTypeFilter, setBetTypeFilter] = useState<'All' | 'Straight' | 'Parlay'>(() => {
    if (typeof window !== 'undefined') {
      try {
        return (localStorage.getItem('journal-betType') as 'All' | 'Straight' | 'Parlay') || 'All';
      } catch (e) {
        return 'All';
      }
    }
    return 'All';
  });
  const [bookmaker, setBookmaker] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('journal-bookmaker') || 'All';
        return stored !== 'All' ? stored.toLowerCase() : 'All';
      } catch (e) {
        return 'All';
      }
    }
    return 'All';
  });
  const [calendarView, setCalendarView] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [weekRange, setWeekRange] = useState<'1-26' | '27-52'>('1-26');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDateType, setSelectedDateType] = useState<'day' | 'week' | 'month' | 'year' | null>(null);
  const [betHistoryPage, setBetHistoryPage] = useState(0);
  const [showProfitableBookmakersOnly, setShowProfitableBookmakersOnly] = useState(false);
  const [showProfitableMarketsOnly, setShowProfitableMarketsOnly] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [showTimeframeDropdown, setShowTimeframeDropdown] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const prevModalStateRef = useRef(false);
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  const [showMobileUnitSettingsModal, setShowMobileUnitSettingsModal] = useState(false);
  const [mobileBankroll, setMobileBankroll] = useState<string>('');
  const [mobileBankrollCurrency, setMobileBankrollCurrency] = useState<'USD' | 'AUD' | 'GBP' | 'EUR'>('USD');
  const [mobileUnitSize, setMobileUnitSize] = useState<string>('');
  const [mobileUnitType, setMobileUnitType] = useState<'value' | 'percent'>('value');
  const [mobilePreferredJournalInput, setMobilePreferredJournalInput] = useState<'money' | 'units'>('money');
  const [mobilePreferredCurrency, setMobilePreferredCurrency] = useState<'USD' | 'AUD' | 'GBP' | 'EUR'>('USD');
  const [savingMobileUnitSize, setSavingMobileUnitSize] = useState(false);
  const [showMobileSuccessMessage, setShowMobileSuccessMessage] = useState(false);
  const [showUnitSizeModal, setShowUnitSizeModal] = useState(false);
  const [showMobileInsights, setShowMobileInsights] = useState(false);
  const [expandedMobileInsights, setExpandedMobileInsights] = useState<Set<string>>(new Set());
  const [mobileInsightFilter, setMobileInsightFilter] = useState<'all' | 'red' | 'green' | 'info' | 'yellow' | 'pain'>('all');
  const [mobileInsightBetTypeFilter, setMobileInsightBetTypeFilter] = useState<'all' | 'straight' | 'parlay'>('all');
  const { theme, setTheme } = useTheme();
  
  const handleSubscriptionClick = async () => {
    if (isPro) {
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
        console.error('Portal error:', error);
        router.push('/subscription');
      }
    } else {
      router.push('/subscription');
    }
  };

  const handleSignOutClick = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };
  
  // Sidebar state
  const [sidebarOpen] = useState(true);
  const [isLargeScreen, setIsLargeScreen] = useState(false);
  const [hasDesktopSidebar, setHasDesktopSidebar] = useState(false);
  
  // Save all filter preferences to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('journal-dateRange', dateRange);
    } catch (e: any) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn('[Journal] localStorage quota exceeded when saving dateRange');
      } else {
        console.warn('[Journal] Failed to save dateRange to localStorage:', e);
      }
    }
  }, [dateRange]);
  
  useEffect(() => {
    try {
      localStorage.setItem('journal-currency', currency);
    } catch (e: any) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn('[Journal] localStorage quota exceeded when saving currency');
      } else {
        console.warn('[Journal] Failed to save currency to localStorage:', e);
      }
    }
  }, [currency]);
  
  useEffect(() => {
    try {
      localStorage.setItem('journal-viewMode', viewMode);
    } catch (e: any) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn('[Journal] localStorage quota exceeded when saving viewMode');
      } else {
        console.warn('[Journal] Failed to save viewMode to localStorage:', e);
      }
    }
  }, [viewMode]);
  
  useEffect(() => {
    try {
      localStorage.setItem('journal-sport', sport);
    } catch (e: any) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn('[Journal] localStorage quota exceeded when saving sport');
      } else {
        console.warn('[Journal] Failed to save sport to localStorage:', e);
      }
    }
  }, [sport]);
  
  useEffect(() => {
    try {
      localStorage.setItem('journal-betType', betTypeFilter);
    } catch (e: any) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn('[Journal] localStorage quota exceeded when saving betTypeFilter');
      } else {
        console.warn('[Journal] Failed to save betTypeFilter to localStorage:', e);
      }
    }
  }, [betTypeFilter]);
  
  useEffect(() => {
    try {
      localStorage.setItem('journal-bookmaker', bookmaker);
    } catch (e: any) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn('[Journal] localStorage quota exceeded when saving bookmaker');
      } else {
        console.warn('[Journal] Failed to save bookmaker to localStorage:', e);
      }
    }
  }, [bookmaker]);

  // Check if we're navigating to journal (set by other pages)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isNavigating = sessionStorage.getItem('navigating-to-journal');
      if (isNavigating === 'true') {
        setNavigatingToJournal(true);
        // Clear the flag
        sessionStorage.removeItem('navigating-to-journal');
        // Hide loading bar after page loads
        setTimeout(() => {
          setNavigatingToJournal(false);
        }, 1000);
      }
    }
  }, []);
  
  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (timeframeDropdownRef.current && !timeframeDropdownRef.current.contains(target) &&
          !target.closest('[data-timeframe-button]')) {
        setShowTimeframeDropdown(false);
      }
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(target) &&
          !target.closest('[data-profile-button]')) {
        setShowProfileDropdown(false);
      }
      if (settingsDropdownRef.current && !settingsDropdownRef.current.contains(target) &&
          !target.closest('[data-settings-button]')) {
        setShowSettingsDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Screen size detection and responsive sidebar logic
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const isLarge = width >= 1536; // 2xl breakpoint
      const hasSidebar = width >= 1024; // lg breakpoint
      setIsLargeScreen(isLarge);
      setHasDesktopSidebar(hasSidebar);
    };
    
    // Initial check
    handleResize();
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Left sidebar remains open on desktop for the desktop-focused layout

  // Fetch bets from Supabase and check subscription
  // Cache subscription status to avoid frequent checks
  useEffect(() => {
    let isMounted = true;
    let subscriptionCheckInterval: NodeJS.Timeout | null = null;
    let lastSubscriptionStatus: { isActive: boolean; isPro: boolean } | null = null;
    
    const checkSubscriptionAndLoadBets = async (skipCache = false) => {
      // Get session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        if (isMounted) {
          setHasProAccess(false);
          setLoading(false);
          router.push("/");
        }
        return;
      }

      try {
        // Check Pro access - query database directly (matching dashboard approach)
        const { data: profile } = await (supabase
          .from('profiles') as any)
          .select('subscription_status, subscription_tier, avatar_url, full_name, username')
          .eq('id', session.user.id)
          .single();
        
        if (!isMounted) return;

        const profileData = profile as { subscription_status?: string; subscription_tier?: string; avatar_url?: string | null; full_name?: string | null; username?: string | null } | null;
        // Set email, name, and avatar together from profile (with session fallback) so we never flash email before name
        const displayName = profileData?.full_name || profileData?.username || session.user.user_metadata?.username || session.user.user_metadata?.full_name || null;
        const avatarFromProfile = profileData?.avatar_url ?? session.user.user_metadata?.avatar_url ?? null;
        setUserEmail(session.user.email || null);
        setUsername(displayName);
        setAvatarUrl(avatarFromProfile);

        let isActive = false;
        let isPro = false;
        
        if (profileData) {
          // Use profiles table if available
          isActive = profileData.subscription_status === 'active' || profileData.subscription_status === 'trialing';
          isPro = profileData.subscription_tier === 'pro';
        } else {
          // Fallback to user_metadata for dev testing
          const metadata = session.user.user_metadata || {};
          isActive = metadata.subscription_status === 'active';
          isPro = metadata.subscription_plan === 'pro';
        }
        
        // Fetch unit size, bankroll, and unit type from profile separately (non-blocking)
        try {
          const { data: unitProfile, error: profileError } = await supabase
            .from('profiles')
            .select('unit_size, bankroll, unit_type, bankroll_currency, preferred_journal_input, preferred_currency, bankroll_set_date')
            .eq('id', session.user.id)
            .single();
          
          if (profileError) {
            console.log('[INITIAL LOAD] Profile query error:', profileError);
            // Try without bankroll_set_date in case column doesn't exist yet
            const { data: unitProfileFallback } = await supabase
              .from('profiles')
              .select('unit_size, bankroll, unit_type, bankroll_currency, preferred_journal_input, preferred_currency')
              .eq('id', session.user.id)
              .single();
            
            if (unitProfileFallback) {
              // Debug logging removed('[INITIAL LOAD] Fallback profile data loaded:', unitProfileFallback);
              const fallback = unitProfileFallback as {
                unit_size?: number | null;
                bankroll?: number | null;
                unit_type?: string | null;
                bankroll_currency?: string | null;
                preferred_journal_input?: string | null;
                preferred_currency?: string | null;
              };
              if (fallback.unit_size !== null && fallback.unit_size !== undefined) {
                const unitSizeValue = parseFloat(fallback.unit_size.toString());
                // Debug logging removed('[INITIAL LOAD] Setting unitSize to:', unitSizeValue);
                setUnitSize(unitSizeValue);
                if (!mobileUnitSize) {
                  setMobileUnitSize(unitSizeValue.toString());
                }
              } else {
                // Debug logging removed('[INITIAL LOAD] No unit_size in profile');
              }
              if (fallback.bankroll !== null && fallback.bankroll !== undefined) {
                const bankrollValue = parseFloat(fallback.bankroll.toString());
                // Debug logging removed('[INITIAL LOAD] Setting bankroll to:', bankrollValue);
                setBankroll(bankrollValue);
                if (!mobileBankroll) {
                  setMobileBankroll(fallback.bankroll.toString());
                }
              } else {
                // Debug logging removed('[INITIAL LOAD] No bankroll in profile');
              }
              if (fallback.bankroll_currency) {
                setMobileBankrollCurrency(fallback.bankroll_currency as 'USD' | 'AUD' | 'GBP' | 'EUR');
              }
              if (fallback.unit_type) {
                setMobileUnitType(fallback.unit_type as 'value' | 'percent');
              }
              if (fallback.preferred_journal_input) {
                setMobilePreferredJournalInput(fallback.preferred_journal_input as 'money' | 'units');
              }
              if (fallback.preferred_currency) {
                setMobilePreferredCurrency(fallback.preferred_currency as 'USD' | 'AUD' | 'GBP' | 'EUR');
              }
            }
            return; // Exit early if we used fallback
          }
          
          if (unitProfile) {
            // Debug logging removed('[INITIAL LOAD] Profile data loaded:', unitProfile);
            const profile = unitProfile as {
              unit_size?: number | null;
              bankroll?: number | null;
              unit_type?: string | null;
              bankroll_currency?: string | null;
              preferred_journal_input?: string | null;
              preferred_currency?: string | null;
              bankroll_set_date?: string | null;
            };
            if (profile.unit_size !== null && profile.unit_size !== undefined) {
              const unitSizeValue = parseFloat(profile.unit_size.toString());
              // Debug logging removed('[INITIAL LOAD] Setting unitSize to:', unitSizeValue);
              setUnitSize(unitSizeValue);
              if (!mobileUnitSize) {
                setMobileUnitSize(unitSizeValue.toString());
              }
            } else {
              // Debug logging removed('[INITIAL LOAD] No unit_size found in profile');
            }
            if (profile.bankroll !== null && profile.bankroll !== undefined) {
              const bankrollValue = parseFloat(profile.bankroll.toString());
              // Debug logging removed('[INITIAL LOAD] Setting bankroll to:', bankrollValue);
              setBankroll(bankrollValue);
              if (!mobileBankroll) {
                setMobileBankroll(profile.bankroll.toString());
              }
            } else {
              // Debug logging removed('[INITIAL LOAD] No bankroll found in profile');
            }
            if (profile.bankroll_set_date) {
              setBankrollSetDate(profile.bankroll_set_date);
            }
            if (profile.bankroll_currency) {
              setMobileBankrollCurrency(profile.bankroll_currency as 'USD' | 'AUD' | 'GBP' | 'EUR');
            }
            if (profile.unit_type) {
              setMobileUnitType(profile.unit_type as 'value' | 'percent');
            }
            if (profile.preferred_journal_input) {
              setMobilePreferredJournalInput(profile.preferred_journal_input as 'money' | 'units');
            }
            if (profile.preferred_currency) {
              setMobilePreferredCurrency(profile.preferred_currency as 'USD' | 'AUD' | 'GBP' | 'EUR');
            }
          }
        } catch (unitError) {
          // Silently fail - unit settings are optional and shouldn't block subscription check
          // Debug logging removed('Could not load unit settings (optional):', unitError);
        }
        
        const proStatus = isActive && isPro;
        
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
          // Debug logging removed('🔐 Journal Pro Status Check:', { isActive, isPro, proStatus, profile, metadata: session.user.user_metadata });
          
          if (isMounted) {
            setHasProAccess(proStatus);
            setIsPro(proStatus);
          }
          
          if (isActive) {
            lastSubscriptionStatus = { isActive, isPro: proStatus };
          }
        }
        
        // Fetch bets immediately (don't wait for check-journal-bets)
        // OPTIMIZATION: Explicitly filter by user_id and order by date DESC for better index usage
        // RLS handles security, but explicit filter helps query planner
        // EGRESS OPTIMIZATION: Limit to last 200 bets initially to reduce data transfer
        const BATCH_SIZE = 200;
        const { data, error, count } = await supabase
          .from('bets')
          .select('*', { count: 'exact' })
          .eq('user_id', session.user.id)
          .order('date', { ascending: false })
          .limit(BATCH_SIZE);

        if (!isMounted) return;

        if (error) {
          console.error('Error fetching bets:', error);
          setBets([]);
          setHasMoreBets(false);
        } else {
          setBets(data || []);
          // Check if there are more bets to load
          setHasMoreBets((count || 0) > BATCH_SIZE);
        }

        // Set loading to false immediately so UI shows
        setLoading(false);
        
        // Expose loadMoreBets to window for testing
        (window as any).loadMoreBets = loadMoreBets;

        // Run check-journal-bets in background (non-blocking) to update completed games
        // This will refresh the data after the page loads
        fetch('/api/check-journal-bets', {
          credentials: 'include',
        })
          .then(async (response) => {
            if (!response.ok) {
              // Silently handle 401 (Unauthorized) - expected if user is not logged in
              // Only log other errors in development
              if (response.status !== 401) {
                console.error('[Journal] check-journal-bets failed:', response.status, response.statusText);
              }
              return;
            }
            const data = await response.json();
            console.log('[Journal] ✅ check-journal-bets response:', JSON.stringify(data, null, 2));
            
            // Refresh bets after check completes to show updated results
            if (isMounted) {
              const { data: { session: refreshSession } } = await supabase.auth.getSession();
              if (refreshSession?.user) {
                const BATCH_SIZE = 200;
                const { data: refreshedBets, count } = await supabase
                  .from('bets')
                  .select('*', { count: 'exact' })
                  .eq('user_id', refreshSession.user.id)
                  .order('date', { ascending: false })
                  .limit(BATCH_SIZE);
              
                if (isMounted && refreshedBets) {
                  setBets(refreshedBets);
                  setHasMoreBets((count || 0) > BATCH_SIZE);
                }
              }
            }
          })
          .catch((error) => {
            // Silently handle errors - this is a non-blocking background operation
            // Only log in development for debugging
            console.error('[Journal] check-journal-bets error (non-critical):', error);
          });
      } catch (error) {
        console.error('Error checking subscription:', error);
        // If we have a cached active subscription, keep it (never log out active subscribers)
        if (lastSubscriptionStatus?.isActive && isMounted) {
          // Debug logging removed('🔐 Using cached active subscription status due to error');
          setHasProAccess(lastSubscriptionStatus.isPro);
          setIsPro(lastSubscriptionStatus.isPro);
        }
        if (!isMounted) return;
        setBets([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    // Initial check
    checkSubscriptionAndLoadBets(true);
    
    // Periodic check every 5 minutes for subscription (instead of on every token refresh)
    subscriptionCheckInterval = setInterval(() => {
      if (isMounted) {
        checkSubscriptionAndLoadBets();
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Periodic refresh of bets every 10 minutes to check for completed games
    let betsRefreshInterval: NodeJS.Timeout | null = null;
    betsRefreshInterval = setInterval(async () => {
      if (isMounted) {
        try {
          // Trigger check-journal-bets to update completed games
          // Debug logging removed('[Journal] Periodic refresh: calling /api/check-journal-bets...');
          const response = await fetch('/api/check-journal-bets', {
            credentials: 'include', // Include cookies for authentication
          });
          
          // Silently handle 401 (Unauthorized) - expected if user is not logged in
          if (!response.ok && response.status !== 401) {
            console.warn('[Journal] Periodic refresh failed:', response.status);
            return;
          }
          
          if (response.ok) {
            const data = await response.json();
            // Debug logging removed('[Journal] Periodic refresh response:', data);
          }
          
          // Then refresh bets from database
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user && isMounted) {
            const BATCH_SIZE = 200;
            const { data, error, count } = await supabase
              .from('bets')
              .select('*', { count: 'exact' })
              .eq('user_id', session.user.id)
              .order('date', { ascending: false })
              .limit(BATCH_SIZE);
            
            if (!error && data && isMounted) {
              setBets(data || []);
            }
          }
        } catch (error) {
          // Debug logging removed('Error refreshing bets (non-critical):', error);
        }
      }
    }, 10 * 60 * 1000); // 10 minutes
    
    // Only listen for SIGNED_OUT and SIGNED_IN events (not TOKEN_REFRESHED)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          lastSubscriptionStatus = null;
          setHasProAccess(false);
          setIsPro(false);
          setLoading(false);
          router.push("/");
        }
      }
      // Only check on SIGNED_IN (not TOKEN_REFRESHED to avoid frequent checks)
      else if (event === 'SIGNED_IN' && isMounted && session) {
        checkSubscriptionAndLoadBets(true);
      }
    });
    
    // Cleanup listener on unmount
    return () => {
      isMounted = false;
      if (subscriptionCheckInterval) {
        clearInterval(subscriptionCheckInterval);
      }
      if (betsRefreshInterval) {
        clearInterval(betsRefreshInterval);
      }
      subscription?.unsubscribe();
    };
  }, [router]);

  // Refresh profile data when settings modal closes to ensure state is updated
  useEffect(() => {
    console.log('Settings modal state changed:', showMobileUnitSettingsModal, 'previous:', prevModalStateRef.current);
    // Only refresh if modal just closed (was open, now closed)
    if (prevModalStateRef.current && !showMobileUnitSettingsModal) {
      console.log('Modal just closed, refreshing profile data');
      const refreshProfileData = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const { data: unitProfile } = await supabase
              .from('profiles')
              .select('unit_size, bankroll, bankroll_set_date')
              .eq('id', session.user.id)
              .single();
            
            console.log('Refreshed profile data:', unitProfile);
            if (unitProfile) {
              const profile = unitProfile as {
                unit_size?: number | null;
                bankroll?: number | null;
                bankroll_set_date?: string | null;
              };
              if (profile.unit_size !== null && profile.unit_size !== undefined) {
                const unitSizeValue = parseFloat(profile.unit_size.toString());
                console.log('Refreshing unitSize to:', unitSizeValue);
                setUnitSize(unitSizeValue);
              }
              if (profile.bankroll !== null && profile.bankroll !== undefined) {
                const bankrollValue = parseFloat(profile.bankroll.toString());
                console.log('Refreshing bankroll to:', bankrollValue);
                setBankroll(bankrollValue);
              }
              if (profile.bankroll_set_date) {
                setBankrollSetDate(profile.bankroll_set_date);
              }
            }
          }
        } catch (error) {
          console.error('Could not refresh profile data:', error);
        }
      };
      refreshProfileData();
    }
    prevModalStateRef.current = showMobileUnitSettingsModal;
  }, [showMobileUnitSettingsModal]);

  // Debug: Log state values when they change
  useEffect(() => {
    console.log('[STATE UPDATE] unitSize:', unitSize, 'bankroll:', bankroll, 'showUnitSizeModal:', showUnitSizeModal);
  }, [unitSize, bankroll, showUnitSizeModal]);

  // Currency conversion rates (base: USD)
  const conversionRates: Record<string, Record<string, number>> = {
    USD: { USD: 1, AUD: 1.52, GBP: 0.79, EUR: 0.92 },
    AUD: { USD: 0.66, AUD: 1, GBP: 0.52, EUR: 0.61 },
    GBP: { USD: 1.27, AUD: 1.92, GBP: 1, EUR: 1.17 },
    EUR: { USD: 1.09, AUD: 1.64, GBP: 0.86, EUR: 1 },
  };

  // Convert amount from one currency to another
  const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string): number => {
    if (fromCurrency === toCurrency) return amount;
    return amount * (conversionRates[fromCurrency]?.[toCurrency] || 1);
  };

  // Filter bets based on current filters (no currency filter)
  // Voids bypass all filters but are still included in the result
  // OPTIMIZED: Single pass filtering instead of multiple filter chains
  const filteredBets = useMemo(() => {
    const voidBets: typeof bets = [];
    const filtered: typeof bets = [];
    const now = new Date();

    // Single pass: separate voids and apply all filters to non-voids
    for (const bet of bets) {
      // Voids bypass all filters
      if (bet.result === 'void') {
        voidBets.push(bet);
        continue;
      }

      // Sport filter
      if (sport !== 'All' && bet.sport !== sport) {
        continue;
      }

      // Bet type filter (straight vs parlay)
      if (betTypeFilter !== 'All') {
        const isParlay = Boolean(bet.market && bet.market.toLowerCase().startsWith('parlay'));
        const matchesBetType = betTypeFilter === 'Parlay' ? isParlay : !isParlay;
        if (!matchesBetType) {
          continue;
        }
      }

      // Bookmaker filter
      if (bookmaker !== 'All') {
        const entries = extractBookmakerEntries(bet.bookmaker);
        const hasBookmaker = entries.some(entry => entry.key === bookmaker);
        if (!hasBookmaker) {
          continue;
        }
      }

      // Date filter
      const betDate = new Date(bet.date);
      let matchesDate = true;
      
      if (selectedDate && selectedDateType) {
        // Calendar date filter
        if (selectedDateType === 'day') {
          matchesDate = betDate.toDateString() === selectedDate.toDateString();
        } else if (selectedDateType === 'week') {
          const weekStart = new Date(selectedDate);
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
          const betDateTime = betDate.getTime();
          matchesDate = betDateTime >= weekStart.getTime() && betDateTime <= weekEnd.getTime();
        } else if (selectedDateType === 'month') {
          matchesDate = betDate.getMonth() === selectedDate.getMonth() && 
                        betDate.getFullYear() === selectedDate.getFullYear();
        } else if (selectedDateType === 'year') {
          matchesDate = betDate.getFullYear() === selectedDate.getFullYear();
        }
      } else if (dateRange !== 'all') {
        // Date range filter
        const diffTime = Math.abs(now.getTime() - betDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        switch (dateRange) {
          case 'daily': matchesDate = diffDays <= 1; break;
          case 'weekly': matchesDate = diffDays <= 7; break;
          case 'monthly': matchesDate = diffDays <= 30; break;
          case 'yearly': matchesDate = diffDays <= 365; break;
          default: matchesDate = true;
        }
      }
      
      if (matchesDate) {
        filtered.push(bet);
      }
    }

    // Combine filtered non-voids with all voids
    return [...filtered, ...voidBets];
  }, [bets, sport, betTypeFilter, bookmaker, dateRange, selectedDate, selectedDateType]);

  // Count non-void bets for "All Bookmakers" display
  const nonVoidBetsCount = useMemo(() => {
    return bets.filter(bet => bet.result !== 'void').length;
  }, [bets]);

  const bookmakerOptions = useMemo(() => {
    const counts: Record<string, { count: number; raw: string }> = {};

    // Exclude voids from bookmaker counts
    bets.filter(bet => bet.result !== 'void').forEach(bet => {
      const entries = extractBookmakerEntries(bet.bookmaker);
      entries.forEach(entry => {
        const key = entry.key || 'unknown';
        if (!counts[key]) {
          counts[key] = { count: 0, raw: entry.raw };
        }
        counts[key].count += 1;
      });
    });

    return Object.entries(counts)
      .map(([key, info]) => ({
        value: key,
        label: getBookmakerDisplayName({ key, raw: info.raw }),
        count: info.count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [bets]);

  useEffect(() => {
    if (bookmaker !== 'All') {
      const exists = bookmakerOptions.some(option => option.value === bookmaker);
      if (!exists) {
        setBookmaker('All');
      }
    }
  }, [bookmaker, bookmakerOptions]);

  // Calculate statistics with currency conversion
  const stats = useMemo(() => {
    // Exclude pending and void bets from calculations
    const settledBets = filteredBets.filter(bet => bet.result !== 'pending' && bet.result !== 'void');
    const wins = settledBets.filter(bet => bet.result === 'win');
    const losses = settledBets.filter(bet => bet.result === 'loss');
    const voids = filteredBets.filter(bet => bet.result === 'void');

    const totalStaked = settledBets.reduce((sum, bet) => {
      const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
      return sum + convertedStake;
    }, 0);
    
    const totalProfit = wins.reduce((sum, bet) => {
      const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
      return sum + (convertedStake * (bet.odds - 1));
    }, 0);
    
    const totalLoss = losses.reduce((sum, bet) => {
      const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
      return sum + convertedStake;
    }, 0);
    
    const totalPL = totalProfit - totalLoss;

    const winRate = settledBets.length > 0 ? (wins.length / settledBets.length) * 100 : 0;
    const roi = totalStaked > 0 ? (totalPL / totalStaked) * 100 : 0;
    const avgStake = settledBets.length > 0 ? totalStaked / settledBets.length : 0;

    return {
      totalPL,
      totalStaked,
      avgStake,
      winRate,
      roi,
      wins: wins.length,
      losses: losses.length,
      voids: voids.length,
    };
  }, [filteredBets, currency]);

  // Calculate current bankroll in money (only when in units mode and bankroll is set)
  const currentBankroll = useMemo(() => {
    if (viewMode !== 'units' || !bankroll || !unitSize) {
      return null;
    }
    
    // Convert initial bankroll from bankroll_currency to current currency
    const bankrollCurrency = mobileBankrollCurrency || 'USD';
    let initialBankrollInCurrency = convertCurrency(bankroll, bankrollCurrency, currency);
    
    // If bankroll_set_date is not set, just show the initial bankroll
    if (!bankrollSetDate) {
      return initialBankrollInCurrency;
    }
    
    // Get bets after bankroll_set_date
    const bankrollDate = new Date(bankrollSetDate);
    const betsAfterBankroll = filteredBets.filter(bet => {
      const betDate = new Date(bet.date);
      return betDate >= bankrollDate;
    });
    
    // Calculate P&L from bets after bankroll was set (in current currency)
    const settledBetsAfterBankroll = betsAfterBankroll.filter(bet => bet.result !== 'pending' && bet.result !== 'void');
    
    let totalPLAfterBankroll = 0;
    settledBetsAfterBankroll.forEach(bet => {
      const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
      if (bet.result === 'win') {
        totalPLAfterBankroll += convertedStake * (bet.odds - 1);
      } else if (bet.result === 'loss') {
        totalPLAfterBankroll -= convertedStake;
      }
    });
    
    // Current bankroll = initial bankroll (in current currency) + P&L (in current currency)
    return initialBankrollInCurrency + totalPLAfterBankroll;
  }, [viewMode, bankroll, bankrollSetDate, filteredBets, currency, unitSize, mobileBankrollCurrency, convertCurrency]);

  // Calculate profit by bookmaker with real data
  const profitByBookmaker = useMemo(() => {
    const bookmakerData: Record<string, number> = {};
    
    // Exclude pending and void bets from profit calculations
    const settledBets = filteredBets.filter(bet => bet.result !== 'pending' && bet.result !== 'void');
    
    settledBets.forEach(bet => {
      const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
      const profit = bet.result === 'win' 
        ? convertedStake * (bet.odds - 1) 
        : -convertedStake;
      
      const entries = extractBookmakerEntries(bet.bookmaker);
      
      entries.forEach(entry => {
        const key = entry.key || 'unknown';
        bookmakerData[key] = (bookmakerData[key] || 0) + profit;
      });
    });
    
    // Convert bookmaker IDs to display names
    let result = Object.entries(bookmakerData)
      .map(([bookmakerId, profit]) => {
        const displayName = getBookmakerDisplayName({ key: bookmakerId, raw: bookmakerId });
        return { bookmaker: displayName, profit, bookmakerId };
      })
      .sort((a, b) => b.profit - a.profit);
    
    if (showProfitableBookmakersOnly) {
      result = result.filter(item => item.profit > 0);
    }
    
    return result;
  }, [filteredBets, currency, showProfitableBookmakersOnly]);

  // Calculate profit by market with real data
  const profitByMarket = useMemo(() => {
    const marketData: Record<string, number> = {};
    
    // Exclude pending and void bets from profit calculations
    const settledBets = filteredBets.filter(bet => bet.result !== 'pending' && bet.result !== 'void');
    
    settledBets.forEach(bet => {
      const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
      const profit = bet.result === 'win' 
        ? convertedStake * (bet.odds - 1) 
        : -convertedStake;
      
      let marketType = bet.market || 'Other';
      if (bet.market && bet.market.toLowerCase().startsWith('parlay')) {
        marketType = 'Parlay';
      }
      marketData[marketType] = (marketData[marketType] || 0) + profit;
    });
    
    let result = Object.entries(marketData)
      .map(([market, profit]) => ({ market, profit }))
      .sort((a, b) => b.profit - a.profit);
    
    if (showProfitableMarketsOnly) {
      result = result.filter(item => item.profit > 0);
    }
    
    return result;
  }, [filteredBets, currency, showProfitableMarketsOnly]);

  // Calculate cumulative P&L for chart with currency conversion
  const chartData = useMemo(() => {
    // Exclude pending and void bets from chart
    const settledBets = filteredBets
      .filter(bet => bet.result !== 'pending' && bet.result !== 'void')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let cumulative = 0;
    const data = [{ bet: 0, profit: 0 }];

    settledBets.forEach((bet, index) => {
      const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
      
      if (bet.result === 'win') {
        cumulative += convertedStake * (bet.odds - 1);
      } else if (bet.result === 'loss') {
        cumulative -= convertedStake;
      }
      data.push({ bet: index + 1, profit: cumulative });
    });

    return data;
  }, [filteredBets, currency]);

  // Calculate X-axis ticks for max 10 ticks
  const xAxisTicks = useMemo(() => {
    if (chartData.length <= 10) {
      return chartData.map(d => d.bet);
    }
    const maxBet = chartData[chartData.length - 1]?.bet || 0;
    const tickCount = 10;
    const step = maxBet / (tickCount - 1);
    const ticks: number[] = [];
    for (let i = 0; i < tickCount; i++) {
      ticks.push(Math.round(i * step));
    }
    return ticks;
  }, [chartData]);

  // Navigation functions
  const navigatePrevious = () => {
    const newDate = new Date(calendarDate);
    if (calendarView === 'day' || calendarView === 'week') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else if (calendarView === 'month') {
      newDate.setFullYear(newDate.getFullYear() - 1);
    } else if (calendarView === 'year') {
      newDate.setFullYear(newDate.getFullYear() - 2);
    }
    setCalendarDate(newDate);
  };

  const navigateNext = () => {
    const newDate = new Date(calendarDate);
    if (calendarView === 'day' || calendarView === 'week') {
      newDate.setMonth(newDate.getMonth() + 1);
    } else if (calendarView === 'month') {
      newDate.setFullYear(newDate.getFullYear() + 1);
    } else if (calendarView === 'year') {
      newDate.setFullYear(newDate.getFullYear() + 2);
    }
    setCalendarDate(newDate);
  };

  // Filter bets for calendar (excludes selectedDate filter)
  const calendarBets = useMemo(() => {
    let filtered = bets;

    // Filter by sport
    if (sport !== 'All') {
      filtered = filtered.filter(bet => bet.sport === sport);
    }

    // Filter by date range when no specific date selected
    const now = new Date();
    if (dateRange !== 'all' && !selectedDate) {
      filtered = filtered.filter(bet => {
        const betDate = new Date(bet.date);
        const diffTime = Math.abs(now.getTime() - betDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        switch (dateRange) {
          case 'daily': return diffDays <= 1;
          case 'weekly': return diffDays <= 7;
          case 'monthly': return diffDays <= 30;
          case 'yearly': return diffDays <= 365;
          default: return true;
        }
      });
    }

    return filtered;
  }, [bets, sport, dateRange, selectedDate]);

  // Calculate calendar data based on view
  const calendarData = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    if (calendarView === 'day') {
      // Show current month with individual days
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      
      const dailyPL: Record<string, number> = {};
      
      calendarBets
        .filter(bet => bet.result !== 'pending' && bet.result !== 'void')
        .forEach(bet => {
          const betDate = new Date(bet.date);
          if (betDate.getFullYear() === year && betDate.getMonth() === month) {
            const day = betDate.getDate();
            const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
            const profit = bet.result === 'win' 
              ? convertedStake * (bet.odds - 1) 
              : -convertedStake;
            
            dailyPL[day] = (dailyPL[day] || 0) + profit;
          }
        });
      
      const calendar = [];
      for (let i = 0; i < firstDay; i++) {
        calendar.push({ day: '', profit: 0 });
      }
      for (let day = 1; day <= daysInMonth; day++) {
        calendar.push({ day: day.toString(), profit: dailyPL[day] || 0 });
      }
      while (calendar.length < 42) {
        calendar.push({ day: '', profit: 0 });
      }
      
      return {
        calendar,
        monthName: calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      };
    }
    
    if (calendarView === 'week') {
      // Show 26 weeks at a time based on weekRange
      const startOfYear = new Date(year, 0, 1);
      const weeklyData = [];
      
      const startWeek = weekRange === '1-26' ? 1 : 27;
      const endWeek = weekRange === '1-26' ? 26 : 52;
      
      for (let weekNum = startWeek; weekNum <= endWeek; weekNum++) {
        const weekStart = new Date(startOfYear);
        weekStart.setDate(startOfYear.getDate() + (weekNum - 1) * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        
        const weekPL = calendarBets
          .filter(bet => bet.result !== 'pending' && bet.result !== 'void')
          .filter(bet => {
            const betDate = new Date(bet.date);
            return betDate >= weekStart && betDate <= weekEnd;
          })
          .reduce((sum, bet) => {
            const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
            const profit = bet.result === 'win' 
              ? convertedStake * (bet.odds - 1) 
              : -convertedStake;
            return sum + profit;
          }, 0);
        
        weeklyData.push({ day: weekNum.toString(), profit: weekPL });
      }
      
      // Pad to 42 cells (6 rows x 7 cols)
      while (weeklyData.length < 42) {
        weeklyData.push({ day: '', profit: 0 });
      }
      
      return {
        calendar: weeklyData,
        monthName: `${year} - Weeks ${weekRange}`
      };
    }
    
    if (calendarView === 'month') {
      // Show all 12 months of current year
      const monthlyData = [];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      for (let m = 0; m < 12; m++) {
        const monthPL = calendarBets
          .filter(bet => bet.result !== 'pending' && bet.result !== 'void')
          .filter(bet => {
            const betDate = new Date(bet.date);
            return betDate.getFullYear() === year && betDate.getMonth() === m;
          })
          .reduce((sum, bet) => {
            const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
            const profit = bet.result === 'win' 
              ? convertedStake * (bet.odds - 1) 
              : -convertedStake;
            return sum + profit;
          }, 0);
        
        monthlyData.push({ day: monthNames[m], profit: monthPL });
      }
      
      // Pad to 36 cells (6 rows x 6 cols)
      while (monthlyData.length < 36) {
        monthlyData.push({ day: '', profit: 0 });
      }
      
      return {
        calendar: monthlyData,
        monthName: year.toString()
      };
    }
    
    if (calendarView === 'year') {
      // Show current year and next year
      const yearlyData = [];
      
      for (let y = year; y <= year + 1; y++) {
        const yearPL = calendarBets
          .filter(bet => bet.result !== 'pending' && bet.result !== 'void')
          .filter(bet => {
            const betDate = new Date(bet.date);
            return betDate.getFullYear() === y;
          })
          .reduce((sum, bet) => {
            const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
            const profit = bet.result === 'win' 
              ? convertedStake * (bet.odds - 1) 
              : -convertedStake;
            return sum + profit;
          }, 0);
        
        yearlyData.push({ day: y.toString(), profit: yearPL });
      }
      
      // Pad to 12 cells (6 rows x 2 cols)
      while (yearlyData.length < 12) {
        yearlyData.push({ day: '', profit: 0 });
      }
      
      return {
        calendar: yearlyData,
        monthName: `${year} - ${year + 1}`
      };
    }
    
    return { calendar: [], monthName: '' };
  }, [calendarBets, currency, calendarView, weekRange, calendarDate]);


  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  // Paywall for non-Pro users (only show if explicitly false, not if null/loading)
  if (hasProAccess === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 p-8 text-center">
          <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-3">
            Pro Feature
          </h2>
          
          <p className="text-gray-300 mb-6">
            Upgrade to Pro to access the Journal and track your betting performance with advanced analytics.
          </p>
          
          <div className="space-y-3">
            <button
              onClick={() => router.push('/subscription')}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Upgrade to Pro
            </button>
            
            <button
              onClick={() => router.back()}
              className="w-full px-6 py-3 border border-gray-600 text-gray-300 rounded-lg font-medium hover:bg-gray-800 transition-colors"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#050d1a] text-slate-900 dark:text-white overflow-x-hidden pt-safe pb-safe">
      {/* Loading bar at top when navigating to journal */}
      <LoadingBar isLoading={navigatingToJournal} isDark={isDark} showImmediately={navigatingToJournal} mobileOffset={0} />
      <style jsx global>{`
        :root {
          --sidebar-width: 360px;
          --right-panel-width: 400px;
          --gap-size: 0px;
        }
        /* Hide scrollbars globally except for custom-scrollbar class */
        * {
          scrollbar-width: none; /* Firefox */
          -ms-overflow-style: none; /* IE and Edge */
        }
        *::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Opera */
        }
        
        /* Custom scrollbar for center content */
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: transparent transparent;
        }
        .custom-scrollbar:hover {
          scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
        }
        .custom-scrollbar::-webkit-scrollbar {
          display: block;
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: transparent;
          border-radius: 4px;
        }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.7);
        }
        
        /* Remove focus border from chart container and all children */
        .chart-container-no-focus,
        .chart-container-no-focus *,
        .chart-container-no-focus:focus,
        .chart-container-no-focus *:focus,
        .chart-container-no-focus:focus-visible,
        .chart-container-no-focus *:focus-visible,
        .chart-container-no-focus:active,
        .chart-container-no-focus *:active {
          outline: none !important;
          box-shadow: none !important;
        }
        
        .chart-container-no-focus {
          border-color: rgb(229, 231, 235) !important;
        }
        
        :global(.dark) .chart-container-no-focus {
          border-color: rgb(55, 65, 81) !important;
        }
        
        /* Prevent Recharts elements from getting focus */
        .chart-container-no-focus .recharts-wrapper,
        .chart-container-no-focus .recharts-surface,
        .chart-container-no-focus svg {
          outline: none !important;
        }
      `}</style>
      
      {/* Left Sidebar - Collapsible */}
      {sidebarOpen && hasDesktopSidebar && (
        <div className="hidden lg:block">
          <LeftSidebar
            oddsFormat={oddsFormat}
            setOddsFormat={setOddsFormat}
            hasPremium={hasProAccess ?? true}
            avatarUrl={avatarUrl}
            username={username}
            userEmail={userEmail}
            isPro={isPro}
            onSubscriptionClick={handleSubscriptionClick}
            onSignOutClick={handleSignOutClick}
            onProfileUpdated={({ username: u, avatar_url: a }) => {
            if (u !== undefined) setUsername(u ?? null);
            if (a !== undefined) setAvatarUrl(a ?? null);
          }}
          />
        </div>
      )}
      
      {/* Center Content - Desktop */}
      <div 
        className="custom-scrollbar hidden lg:block min-w-0 overflow-hidden"
        style={{
          position: 'fixed',
          left: sidebarOpen && hasDesktopSidebar
            ? 'calc(clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px) + var(--sidebar-width) + var(--gap-size))'
            : 'calc(clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px) + 16px)',
          right: isLargeScreen
            ? 'calc(clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px) + var(--right-panel-width) + var(--gap-size))'
            : '16px',
          top: '16px',
          paddingTop: '0',
          paddingBottom: '2px',
          height: 'calc(100vh - 16px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          zIndex: 0,
          transition: 'left 0.3s ease, right 0.3s ease'
        }}
      >
            {/* Full-width container spanning from left sidebar to right sidebar */}
            <div className="w-full bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 flex flex-col min-w-0 overflow-hidden relative z-10">
             {/* Top half - StatTrackr logo and filters */}
             <div className="flex-1 px-2 md:px-3 lg:px-4 pt-2 pb-3 md:pb-4">
               <div className="flex flex-wrap items-center gap-2 md:gap-3 lg:gap-4">
                 <div className="flex items-center gap-2 md:gap-3">
                   <StatTrackrLogoWithText 
                     logoSize="w-6 h-6 md:w-7 md:h-7 lg:w-8 lg:h-8" 
                     textSize="text-sm md:text-base lg:text-lg xl:text-xl" 
                     isDark={isDark}
                   />
                 </div>
                 
                 {/* Currency */}
                 <div className="flex items-center gap-1.5 md:gap-2 lg:gap-3 bg-white dark:bg-[#0a1929] border border-slate-300 dark:border-gray-600 rounded-xl px-2 md:px-3 py-1">
                   <span className="text-xs md:text-sm font-medium text-slate-600 dark:text-white">Currency</span>
                   <select
                     value={currency}
                     onChange={(e) => setCurrency(e.target.value as typeof currency)}
                     className="h-7 md:h-8 px-1.5 md:px-2 rounded-lg text-xs md:text-sm bg-emerald-600 text-white border-none focus:ring-2 focus:ring-emerald-400 focus:outline-none font-medium"
                     disabled={viewMode === 'units'}
                   >
                     <option value="USD">USD</option>
                     <option value="AUD">AUD</option>
                     <option value="GBP">GBP</option>
                     <option value="EUR">EUR</option>
                   </select>
                 </div>
                 
                 {/* View Mode Toggle (Money/Units) */}
                 <div className="flex items-center gap-1.5 md:gap-2 lg:gap-3 bg-white dark:bg-[#0a1929] border border-slate-300 dark:border-gray-600 rounded-xl px-2 md:px-3 py-1">
                   <span className="text-xs md:text-sm font-medium text-slate-600 dark:text-white">View</span>
                   <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-gray-600">
                     <button
                       onClick={() => setViewMode('money')}
                       className={`px-2 md:px-3 py-1 text-xs md:text-sm font-medium transition-colors ${
                         viewMode === 'money'
                           ? 'bg-emerald-600 text-white'
                           : 'bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white hover:bg-gray-100 dark:hover:bg-[#0f1f35]'
                       }`}
                     >
                       Money
                     </button>
                     <button
                       onClick={() => {
                         console.log('Units button clicked - unitSize:', unitSize, 'bankroll:', bankroll);
                         if (!unitSize || unitSize <= 0) {
                           console.log('Unit size not set, showing modal');
                           setShowUnitSizeModal(true);
                           return;
                         }
                         console.log('Unit size is set, switching to units mode');
                         setViewMode('units');
                       }}
                       className={`px-2 md:px-3 py-1 text-xs md:text-sm font-medium transition-colors ${
                         viewMode === 'units'
                           ? 'bg-emerald-600 text-white'
                           : 'bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white hover:bg-gray-100 dark:hover:bg-[#0f1f35]'
                       }`}
                     >
                       Units
                     </button>
                   </div>
                 </div>
                 
                 {/* Filters */}
                 <div className="flex items-center gap-1.5 md:gap-2 lg:gap-3 bg-white dark:bg-[#0a1929] border border-slate-300 dark:border-gray-600 rounded-xl px-2 md:px-3 py-1 flex-1 relative z-30">
                   <span className="text-xs md:text-sm font-medium text-slate-600 dark:text-white whitespace-nowrap">Filters</span>
                   <select
                     value={sport}
                     onChange={(e) => setSport(e.target.value)}
                     className="h-7 md:h-8 px-1.5 md:px-2 rounded-lg text-xs md:text-sm bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                   >
                     <option value="All">All Sports</option>
                     <option value="NBA">NBA</option>
                   </select>
                  <select
                    value={betTypeFilter}
                    onChange={(e) => setBetTypeFilter(e.target.value as 'All' | 'Straight' | 'Parlay')}
                    className="h-7 md:h-8 px-1.5 md:px-2 rounded-lg text-xs md:text-sm bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  >
                    <option value="All">All Bet Types</option>
                    <option value="Straight">Straight Bets</option>
                    <option value="Parlay">Parlays</option>
                  </select>
                  <select
                    value={bookmaker}
                    onChange={(e) => setBookmaker(e.target.value)}
                    className="h-7 md:h-8 px-1.5 md:px-2 rounded-lg text-xs md:text-sm bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  >
                    <option value="All">All Bookmakers ({nonVoidBetsCount})</option>
                    {bookmakerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.count})
                      </option>
                    ))}
                  </select>
                  <div className="relative ml-auto z-40" ref={timeframeDropdownRef}>
                     <button
                       data-timeframe-button
                       onClick={() => setShowTimeframeDropdown((prev) => !prev)}
                      className="relative z-40 inline-flex items-center gap-1.5 md:gap-2 rounded-xl border border-slate-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] px-3 md:px-4 py-1.5 text-xs md:text-sm font-medium text-slate-600 dark:text-white hover:bg-slate-50 dark:hover:bg-[#0f1f35] transition-colors"
                     >
                       <span className="hidden sm:inline">Timeframe</span>
                       <span className="capitalize">{dateRange}</span>
                       <svg className={`w-3.5 h-3.5 transition-transform ${showTimeframeDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                       </svg>
                     </button>
                     
                     {showTimeframeDropdown && (
                       <div className="absolute right-0 mt-2 w-40 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-[#0a1929] shadow-lg z-50 overflow-hidden">
                         {(['all', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((range) => (
                           <button
                             key={range}
                             onClick={() => {
                               setDateRange(range);
                               setShowTimeframeDropdown(false);
                             }}
                             className={`w-full text-left px-4 py-2 text-xs md:text-sm capitalize transition-colors ${
                               dateRange === range
                                 ? 'bg-purple-600/10 text-purple-600 dark:text-purple-300'
                                 : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-700'
                             }`}
                           >
                             {range}
                           </button>
                         ))}
                       </div>
                     )}
                   </div>
                 </div>
                 
               </div>
             </div>
              
              {/* Bottom half - 6 stat containers */}
              <div className="h-1/2 flex border-t border-slate-200 dark:border-gray-700/50 gap-1.5 md:gap-2 lg:gap-3 pb-2 md:pb-2.5 lg:pb-3 px-2 md:px-2.5 lg:px-3 py-1">
                {/* Bankroll - Only show in units mode, placed first */}
                {viewMode === 'units' && currentBankroll !== null && (
                  <div className="flex-1 bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-1.5 md:py-2 px-1 md:px-1.5 lg:px-2">
                    <span className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-white">Bankroll</span>
                    <span className="text-sm md:text-base lg:text-lg xl:text-xl 2xl:text-2xl font-semibold text-slate-900 dark:text-white flex-1 flex items-center justify-center break-words text-center">
                      {formatCurrency(currentBankroll)}
                    </span>
                  </div>
                )}
                
                {/* Total P&L */}
                <div className="flex-1 bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-1.5 md:py-2 px-1 md:px-1.5 lg:px-2">
                  <span className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-white">
                    Total P&L {viewMode === 'units' ? '(units)' : `(${currency})`}
                  </span>
                  <span
                    className={`text-sm md:text-base lg:text-lg xl:text-xl 2xl:text-2xl font-semibold flex-1 flex items-center justify-center ${
                      stats.totalPL > 0 ? 'text-green-600 dark:text-green-400' :
                      stats.totalPL < 0 ? 'text-red-600 dark:text-red-400' :
                      'text-slate-900 dark:text-white'
                    }`}
                  >
                    {formatValue(stats.totalPL, { showSign: true })}
                  </span>
                </div>
                
                {/* Total Staked */}
                <div className="flex-1 bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-1.5 md:py-2 px-1 md:px-1.5 lg:px-2">
                  <span className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-white">
                    Total Staked {viewMode === 'units' ? '(units)' : `(${currency})`}
                  </span>
                  <span className="text-sm md:text-base lg:text-lg xl:text-xl 2xl:text-2xl font-semibold text-slate-900 dark:text-white flex-1 flex items-center justify-center break-words text-center">
                    {formatValue(stats.totalStaked)}
                  </span>
                </div>
                
                {/* Average Stake */}
                <div className="flex-1 bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-1.5 md:py-2 px-1 md:px-1.5 lg:px-2">
                  <span className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-white">
                    Avg Stake {viewMode === 'units' ? '(units)' : `(${currency})`}
                  </span>
                  <span className="text-sm md:text-base lg:text-lg xl:text-xl 2xl:text-2xl font-semibold text-slate-900 dark:text-white flex-1 flex items-center justify-center break-words text-center">
                    {formatValue(stats.avgStake)}
                  </span>
                </div>
                
                {/* WIN % */}
                <div className="flex-1 bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-1.5 md:py-2 px-1 md:px-1.5 lg:px-2">
                  <span className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-white">WIN %</span>
                  <span className="text-sm md:text-base lg:text-lg xl:text-xl 2xl:text-2xl font-semibold text-slate-900 dark:text-white flex-1 flex items-center justify-center">{stats.winRate.toFixed(1)}%</span>
                </div>
                
                {/* ROI */}
                <div className="flex-1 bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-1.5 md:py-2 px-1 md:px-1.5 lg:px-2">
                  <span className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-white">ROI</span>
                  <span className={`text-sm md:text-base lg:text-lg xl:text-xl 2xl:text-2xl font-semibold flex-1 flex items-center justify-center ${
                    stats.roi > 0 ? 'text-green-600 dark:text-green-400' :
                    stats.roi < 0 ? 'text-red-600 dark:text-red-400' :
                    'text-slate-900 dark:text-white'
                  }`}>
                    {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
                  </span>
                </div>
                
                {/* Record */}
                <div className="flex-1 bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-1.5 md:py-2 px-1 md:px-1.5 lg:px-2">
                  <span className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-white">Record</span>
                  <div className="text-sm md:text-base lg:text-lg xl:text-xl 2xl:text-2xl font-semibold flex items-center gap-0.5 md:gap-1 flex-1 justify-center">
                    <span className="text-green-600 dark:text-green-400">{stats.wins}</span>
                    <span className="text-slate-400 dark:text-slate-500">-</span>
                    <span className="text-red-600 dark:text-red-400">{stats.losses}</span>
                    <span className="text-slate-400 dark:text-slate-500">-</span>
                    <span className="text-gray-500 dark:text-gray-400">{stats.voids}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="w-full mt-2 flex flex-col lg:flex-row gap-2 min-w-0 overflow-hidden">
              {/* Left Column: Chart, Calendar, Profit sections */}
              <div className="flex flex-col gap-2 min-w-0 overflow-hidden lg:flex-[2.1]">
                {/* Profit/Loss Chart */}
                <div className="chart-container-no-focus bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-3 md:p-4 lg:p-6 overflow-hidden min-w-0">
                  <h3 className="text-sm md:text-base lg:text-lg font-semibold text-slate-900 dark:text-white mb-2 md:mb-3 lg:mb-4">Profit/Loss Over Time</h3>
                  <div className="w-full h-48 md:h-64 lg:h-72 xl:h-80 relative min-w-0">
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                      <StatTrackrLogoWithText 
                        logoSize="w-32 h-32" 
                        textSize="text-5xl" 
                        isDark={isDark}
                        className="opacity-[0.02]"
                      />
                    </div>
                    <ResponsiveContainer width="100%" height="100%" className="relative z-10">
                      <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <XAxis 
                          dataKey="bet" 
                          stroke={isDark ? '#ffffff' : '#000000'}
                          label={{ value: 'Number of Bets', position: 'insideBottom', offset: -5, fill: isDark ? '#ffffff' : '#000000' }}
                          tick={{ fill: isDark ? '#ffffff' : '#000000' }}
                          ticks={xAxisTicks}
                        />
                        <YAxis 
                          stroke={isDark ? '#ffffff' : '#000000'}
                          label={{ value: `Profit/Loss (${currencySymbols[currency]})`, angle: -90, position: 'insideLeft', offset: -10, fill: isDark ? '#ffffff' : '#000000' }}
                          tick={{ fill: isDark ? '#ffffff' : '#000000' }}
                          tickCount={7}
                        />
                        <Tooltip 
                          contentStyle={{
                            backgroundColor: isDark ? '#4b5563' : '#9ca3af',
                            border: `1px solid ${isDark ? '#9ca3af' : '#9ca3af'}`,
                            borderRadius: '8px',
                            color: isDark ? '#FFFFFF' : '#000000'
                          }}
                          labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                          itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                          labelFormatter={(value: number) => `Bet No: ${value}`}
                          formatter={(value: number) => [`$${value.toFixed(2)}`, 'P/L']}
                          cursor={{ stroke: isDark ? '#4b5563' : '#9ca3af', strokeWidth: 1 }}
                        />
                        <ReferenceLine y={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeDasharray="3 3" />
                        <Line 
                          type="linear" 
                          dataKey="profit" 
                          stroke="#8b5cf6" 
                          strokeWidth={3}
                          dot={false}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Calendar + Profit by Bookmaker row */}
                <div className="flex gap-1.5 md:gap-2 min-w-0 overflow-hidden flex-shrink-0" style={{ height: 'clamp(400px, 50vh, 550px)' }}>
                  {/* Betting Calendar */}
                  <div className="flex-1 bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-3 md:p-4 lg:p-6 flex flex-col overflow-hidden min-w-0">
                    <div className="flex items-center justify-between mb-2 md:mb-3 lg:mb-4 gap-2">
                      <h3 className="text-sm md:text-base lg:text-lg font-semibold text-slate-900 dark:text-white">Betting Calendar</h3>
                      <div className="flex items-center gap-1 md:gap-1.5 lg:gap-2">
                        <select
                          value={calendarView}
                          onChange={(e) => setCalendarView(e.target.value as 'day' | 'week' | 'month' | 'year')}
                          className="px-3 py-1.5 text-xs md:text-sm font-medium rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          aria-label="Select calendar timeframe"
                        >
                          <option value="day">Day</option>
                          <option value="week">Week</option>
                          <option value="month">Month</option>
                          <option value="year">Year</option>
                        </select>
                      </div>
                    </div>
                    {calendarView === 'week' && (
                      <div className="flex justify-center gap-2 mb-3">
                        {(['1-26','27-52'] as const).map(range => (
                          <button
                            key={range}
                            onClick={() => setWeekRange(range)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                              weekRange === range
                                ? 'bg-purple-600 text-white'
                                : 'bg-white dark:bg-[#0a1929] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                            }`}
                          >
                            {range === '1-26' ? 'Weeks 1-26' : 'Weeks 27-52'}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mb-2 md:mb-3 flex-1 min-h-0 flex flex-col overflow-hidden">
                      <div className="flex items-center justify-between mb-2 md:mb-3 flex-shrink-0">
                        <button
                          onClick={navigatePrevious}
                          className="p-0.5 md:p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors"
                          title="Previous"
                        >
                          <svg className="w-4 h-4 md:w-5 md:h-5 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div className="text-center text-[10px] md:text-xs font-semibold text-slate-900 dark:text-white">{calendarData.monthName}</div>
                        <button
                          onClick={navigateNext}
                          className="p-0.5 md:p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors"
                          title="Next"
                        >
                          <svg className="w-4 h-4 md:w-5 md:h-5 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                      {calendarView === 'day' && (
                        <div className="grid grid-cols-7 gap-1 md:gap-1.5 lg:gap-2 mb-1 md:mb-2 flex-shrink-0">
                          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => (
                            <div key={day} className="text-center text-[9px] md:text-[10px] font-medium text-slate-600 dark:text-slate-400">{day}</div>
                          ))}
                        </div>
                      )}
                      <div className={`grid flex-1 min-h-0 overflow-hidden ${
                        calendarView === 'day' ? 'grid-cols-7 grid-rows-5 gap-1 md:gap-1.5 lg:gap-2' :
                        calendarView === 'week' ? 'grid-cols-7 grid-rows-4 gap-1 md:gap-1.5 lg:gap-2' :
                        calendarView === 'month' ? 'grid-cols-3 grid-rows-4 gap-0.5 md:gap-1' :
                        'grid-cols-2 grid-rows-1 gap-1 md:gap-2'
                      }`}>
                        {calendarData.calendar.map((item, idx) => {
                          const handleClick = () => {
                            if (!item.day) return;
                            const year = calendarDate.getFullYear();
                            const month = calendarDate.getMonth();
                            if (calendarView === 'day') {
                              setSelectedDate(new Date(year, month, parseInt(item.day)));
                              setSelectedDateType('day');
                            } else if (calendarView === 'week') {
                              const weekNum = parseInt(item.day);
                              const startOfYear = new Date(year, 0, 1);
                              const weekStart = new Date(startOfYear);
                              weekStart.setDate(startOfYear.getDate() + (weekNum - 1) * 7);
                              setSelectedDate(weekStart);
                              setSelectedDateType('week');
                            } else if (calendarView === 'month') {
                              const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                              const monthIndex = monthNames.indexOf(item.day);
                              if (monthIndex !== -1) {
                                setSelectedDate(new Date(year, monthIndex, 1));
                                setSelectedDateType('month');
                              }
                            } else if (calendarView === 'year') {
                              const selectedYear = parseInt(item.day);
                              setSelectedDate(new Date(selectedYear, 0, 1));
                              setSelectedDateType('year');
                            }
                          };

                          return (
                            <div
                              key={idx}
                              onClick={handleClick}
                              className={`flex flex-col items-center justify-center rounded-lg text-[9px] md:text-[10px] font-medium cursor-pointer transition-all hover:scale-105 overflow-hidden p-0.5 min-w-0 w-full h-full border border-slate-300/40 dark:border-gray-600/40 ${
                                !item.day ? 'invisible' :
                                item.profit === 0 ? 'bg-slate-200 dark:bg-[#0a1929] text-slate-600 dark:text-slate-400' :
                                item.profit > 100 ? 'bg-green-600 dark:bg-green-500 text-white' :
                                item.profit > 0 ? 'bg-green-400 dark:bg-green-600 text-white' :
                                item.profit < -50 ? 'bg-red-600 dark:bg-red-500 text-white' :
                                'bg-red-400 dark:bg-red-600 text-white'
                              }`}
                            >
                              <span className={`truncate w-full text-center leading-tight ${
                                calendarView === 'month' ? 'text-[10px] md:text-xs lg:text-sm font-bold' :
                                calendarView === 'year' ? 'text-[10px] md:text-xs lg:text-sm font-bold' :
                                'text-[10px] md:text-xs'
                              }`}>{item.day}</span>
                              {item.day && item.profit !== 0 && (
                                <span className={`truncate w-full text-center leading-tight ${
                                  calendarView === 'month' ? 'text-[9px] md:text-xs lg:text-sm xl:text-base font-bold' :
                                  calendarView === 'year' ? 'text-[9px] md:text-xs lg:text-sm xl:text-base font-bold' :
                                  calendarView === 'week' ? 'text-[7px] md:text-[9px]' :
                                  'text-[7px] md:text-[9px]'
                                } mt-0.5`}>{currencySymbols[currency]}{
                                  (calendarView === 'day' || calendarView === 'week') && Math.abs(item.profit) >= 1000
                                    ? (Math.abs(item.profit) / 1000).toFixed(1) + 'K'
                                    : Math.abs(item.profit).toFixed(0)
                                }</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-2 md:gap-3 lg:gap-4 text-[9px] md:text-[10px] mt-auto pt-1 md:pt-2">
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded bg-green-600" />
                        <span className="text-slate-600 dark:text-slate-400">Profit</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded bg-red-600" />
                        <span className="text-slate-600 dark:text-slate-400">Loss</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded bg-slate-200 dark:bg-[#0a1929]" />
                        <span className="text-slate-600 dark:text-slate-400">No Bets</span>
                      </div>
                    </div>
                  </div>

                  {/* Profit by Bookmaker */}
                  <div className="chart-container-no-focus flex-1 bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-3 md:p-4 lg:p-6 flex flex-col min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-2 md:mb-3 lg:mb-4">
                      <h3 className="text-sm md:text-base lg:text-lg font-semibold text-slate-900 dark:text-white">Profit by Bookmaker</h3>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-xs text-slate-600 dark:text-slate-400">Profitable only</span>
                        <button
                          onClick={() => setShowProfitableBookmakersOnly(!showProfitableBookmakersOnly)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            showProfitableBookmakersOnly ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              showProfitableBookmakersOnly ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </label>
                    </div>
                    <div className="flex-1 w-full">
                      {profitByBookmaker.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                          No bookmaker data available
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={profitByBookmaker} margin={{ top: 40, right: 20, left: 20, bottom: 5 }}>
                            <XAxis 
                              dataKey="bookmaker" 
                              stroke={isDark ? '#ffffff' : '#000000'}
                              angle={-45}
                              textAnchor="end"
                              height={80}
                              tick={{ fontSize: 12, fill: isDark ? '#ffffff' : '#000000' }}
                            />
                            <YAxis 
                              stroke={isDark ? '#ffffff' : '#000000'}
                              label={{ value: `Profit (${currencySymbols[currency]})`, angle: -90, position: 'insideLeft', offset: -10, fill: isDark ? '#ffffff' : '#000000' }}
                              tick={{ fill: isDark ? '#ffffff' : '#000000' }}
                              tickCount={10}
                            />
                            <Tooltip 
                              contentStyle={{
                                backgroundColor: isDark ? '#4b5563' : '#9ca3af',
                                border: `1px solid ${isDark ? '#9ca3af' : '#9ca3af'}`,
                                borderRadius: '8px',
                                color: isDark ? '#FFFFFF' : '#000000'
                              }}
                              labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                              itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                              formatter={(value: number) => [`$${value.toFixed(2)}`, 'Profit']}
                              cursor={{ fill: isDark ? '#4b5563' : '#9ca3af', opacity: 0.3 }}
                            />
                            <ReferenceLine y={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeWidth={2} />
                            <Bar dataKey="profit" radius={[8, 8, 0, 0]}>
                              {profitByBookmaker.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#ef4444'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>

                {/* Profit by Market */}
                <div className="chart-container-no-focus bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-3 md:p-4 lg:p-6 flex flex-col overflow-hidden min-w-0 h-[500px]">
                  <div className="flex items-center justify-between mb-2 md:mb-3 lg:mb-4 flex-shrink-0">
                    <h3 className="text-sm md:text-base lg:text-lg font-semibold text-slate-900 dark:text-white">Profit by Market</h3>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-xs text-slate-600 dark:text-slate-400">Profitable only</span>
                      <button
                        onClick={() => setShowProfitableMarketsOnly(!showProfitableMarketsOnly)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          showProfitableMarketsOnly ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            showProfitableMarketsOnly ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </label>
                  </div>
                  <div className="flex-1 w-full min-h-0">
                    {profitByMarket.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                        No market data available
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={profitByMarket} layout="vertical" margin={{ top: 5, right: 150, left: 20, bottom: 7 }}>
                          <XAxis 
                            type="number"
                            stroke={isDark ? '#ffffff' : '#000000'}
                            label={{ value: `Profit (${currencySymbols[currency]})`, position: 'insideBottom', offset: -5, fill: isDark ? '#ffffff' : '#000000' }}
                            tick={{ fill: isDark ? '#ffffff' : '#000000' }}
                            tickCount={10}
                          />
                          <YAxis 
                            type="category"
                            dataKey="market"
                            stroke={isDark ? '#ffffff' : '#000000'}
                            width={60}
                            tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 11 }}
                          />
                          <Tooltip 
                            contentStyle={{
                              backgroundColor: isDark ? '#4b5563' : '#9ca3af',
                              border: `1px solid ${isDark ? '#9ca3af' : '#9ca3af'}`,
                              borderRadius: '8px',
                              color: isDark ? '#FFFFFF' : '#000000'
                            }}
                            labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                            itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Profit']}
                            cursor={{ fill: isDark ? '#4b5563' : '#9ca3af', opacity: 0.3 }}
                          />
                          <ReferenceLine x={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeWidth={2} />
                          <Bar dataKey="profit" radius={[0, 8, 8, 0]}>
                            {profitByMarket.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#ef4444'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Bet History */}
              <div className="bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-2 md:p-3 lg:p-4 flex flex-col min-w-0 max-w-sm lg:flex-[0.9]">
                <div className="flex items-center justify-between mb-1.5 md:mb-2 flex-shrink-0">
                  <h3 className="text-xs md:text-sm lg:text-base font-semibold text-slate-900 dark:text-white">Bet History</h3>
                  <div className="flex items-center gap-1 md:gap-2">
                    <button
                      onClick={() => setBetHistoryPage(prev => Math.max(0, prev - 1))}
                      disabled={betHistoryPage === 0}
                      className="p-0.5 md:p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                      title="Previous"
                    >
                      <svg className="w-3 h-3 md:w-4 md:h-4 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="text-[10px] md:text-xs text-slate-600 dark:text-slate-400">
                      {Math.min((betHistoryPage + 1) * 20, filteredBets.length)} of {filteredBets.length}
                    </span>
                    <button
                      onClick={() => setBetHistoryPage(prev => prev + 1)}
                      disabled={betHistoryPage >= Math.floor(filteredBets.length / 20)}
                      className="p-0.5 md:p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                      title="Next"
                    >
                      <svg className="w-3 h-3 md:w-4 md:h-4 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 md:space-y-2 overflow-y-auto flex-1 min-h-0 max-h-[1220px]">
                  {filteredBets.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                      <p className="text-sm md:text-base mb-1">No bets found</p>
                      <p className="text-xs">Add your first bet to get started!</p>
                    </div>
                  ) : (
                    filteredBets.slice(betHistoryPage * 20, (betHistoryPage + 1) * 20).map((bet) => {
                      const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
                      const profit = bet.result === 'win' 
                        ? convertedStake * (bet.odds - 1) 
                        : bet.result === 'loss' 
                        ? -convertedStake 
                        : 0;
                      // Calculate return amount: win = stake * odds, loss = 0, void = stake
                      const returnAmount = bet.result === 'win' 
                        ? convertedStake * bet.odds 
                        : bet.result === 'void' 
                        ? convertedStake 
                        : 0;
                      const betDate = new Date(bet.date);
                      const dateStr = betDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      
                      // Check if this is a parlay
                      const isParlay = Boolean(bet.market && bet.market.toLowerCase().startsWith('parlay'));
                      // SPORTSBOOK-STANDARD: Use structured parlay_legs data first (most reliable)
                      // Fallback to parsing selection text, then market string
                      const structuredLegs = bet.parlay_legs && Array.isArray(bet.parlay_legs) ? bet.parlay_legs : [];
                      const parsedLegs = isParlay ? parseParlayLegs(bet.selection) : [];
                      const parlayLegs = structuredLegs.length > 0 ? structuredLegs.map((leg: any) => ({
                        playerName: leg.playerName || '',
                        overUnder: leg.overUnder || 'over',
                        line: leg.line || 0,
                        statName: formatStatType(leg.statType) || '',
                        team: leg.team || '', // Preserve team for moneyline display
                        statType: leg.statType || '', // Preserve statType for moneyline check
                        isGameProp: leg.isGameProp || false, // Preserve isGameProp flag
                      })) : parsedLegs;
                      // Use structured legs count first, then parsed, then market fallback
                      const legCount = structuredLegs.length || parlayLegs.length || (bet.market ? parseInt(bet.market.match(/\d+/)?.[0] || '0') : 0);

                      // Determine bet state: pending (blue), live (orange), or final (green/red)
                      // A bet can be live but already determined (win/loss) if outcome was determined early
                      const isLive = bet.status === 'live';
                      const isDetermined = bet.result === 'win' || bet.result === 'loss';
                      const isPending = !isLive && (bet.result === 'pending' || (bet.status && bet.status !== 'completed'));
                      const isFinal = bet.status === 'completed';
                      const isLiveButDetermined = isLive && isDetermined;
                      
                      return (
                        <div key={bet.id} className={`p-1.5 md:p-2 rounded-lg border-2 ${
                          isLiveButDetermined
                            ? bet.result === 'win'
                              ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-400'
                              : 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400'
                            : isLive
                            ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-500 dark:border-orange-400'
                            : isPending
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400'
                            : bet.result === 'win' 
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-400'
                            : bet.result === 'void'
                            ? 'bg-gray-50 dark:bg-[#050d1a]/20 border-gray-500 dark:border-gray-400'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400'
                        }`}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] md:text-[10px] font-medium text-slate-600 dark:text-slate-400">{dateStr}</span>
                            {(isFinal || isLiveButDetermined) && (
                              <span className={`text-[9px] md:text-[10px] font-bold ${
                                bet.result === 'win' 
                                  ? 'text-green-600 dark:text-green-400'
                                  : bet.result === 'void'
                                  ? 'text-gray-600 dark:text-gray-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}>
                                {bet.result === 'void' ? 'VOID' : `${profit >= 0 ? '+' : ''}${currency} $${Math.abs(profit).toFixed(2)}`}
                              </span>
                            )}
                            {isPending && (
                              <span className="text-[9px] md:text-[10px] font-bold text-blue-600 dark:text-blue-400">PENDING</span>
                            )}
                            {isLive && !isDetermined && (
                              <span className="text-[9px] md:text-[10px] font-bold text-orange-600 dark:text-orange-400 flex items-center gap-1">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                                </span>
                                LIVE
                              </span>
                            )}
                          </div>
                          {isParlay && parlayLegs.length > 0 ? (
                            <>
                              <div className="text-[10px] md:text-xs font-semibold text-slate-900 dark:text-white mb-0.5">
                                {legCount} leg Parlay
                              </div>
                              <div className="text-[9px] md:text-[10px] text-slate-700 dark:text-slate-300 space-y-0.5">
                                {parlayLegs.map((leg, index) => {
                                  // Get individual leg result from parlay_legs if available
                                  const storedLeg = bet.parlay_legs && Array.isArray(bet.parlay_legs) ? bet.parlay_legs[index] : undefined;
                                  const legWon = storedLeg && typeof storedLeg.won === 'boolean' 
                                    ? storedLeg.won 
                                    : (bet.result === 'win' ? true : null); // Fallback to parlay result if no individual data
                                  const legVoid = storedLeg?.void === true;
                                  const showLegIndicators = (isFinal || isLiveButDetermined) && bet.result !== 'void' && !legVoid && legWon !== null;
                                  
                                  return (
                                    <div key={index} className="break-words flex items-center gap-1">
                                      {showLegIndicators && (
                                        <span className={`flex-shrink-0 ${legWon ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                          {legWon ? '✓' : '✗'}
                                        </span>
                                      )}
                                      <span>
                                        {(() => {
                                          // Check if this is a moneyline bet
                                          // Use storedLeg data first (most reliable), then fallback to leg data
                                          const legAny = leg as any;
                                          const statType = storedLeg?.statType || legAny.statType || '';
                                          const team = storedLeg?.team || legAny.team || '';
                                          const isMoneyline = statType === 'moneyline' || 
                                                              leg.statName?.toLowerCase().includes('moneyline');
                                          
                                          if (isMoneyline && team) {
                                            // For moneyline bets, show "X Team to Win"
                                            // Convert abbreviation to full name if needed
                                            const teamName = getFullTeamName(team);
                                            return `${teamName} to win`;
                                          }
                                          
                                          // For non-moneyline bets, use standard format
                                          return `${leg.playerName} ${leg.overUnder} ${leg.line} ${leg.statName}`;
                                        })()}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          ) : (
                            <div className="text-[10px] md:text-xs font-semibold text-slate-900 dark:text-white mb-0.5 break-words">{bet.selection}</div>
                          )}
                          <div className="flex items-center justify-between text-[9px] md:text-[10px] text-slate-600 dark:text-slate-400 flex-wrap gap-1">
                            <span className="break-words">
                              Stake: {viewMode === 'units' 
                                ? `${convertToUnits(convertedStake).toFixed(2)} units ${bet.currency !== currency ? `(${currency} $${convertedStake.toFixed(2)})` : ''}`
                                : `${currency} $${convertedStake.toFixed(2)} ${bet.currency !== currency ? `(${bet.currency} $${bet.stake.toFixed(2)})` : ''}`
                              }
                            </span>
                            <div className="flex flex-col items-end">
                              <span className="whitespace-nowrap">Odds: {formatOdds(bet.odds, oddsFormat)}</span>
                            </div>
                          </div>
                          {(bet.market || bet.opponent) && (
                            <div className="mt-0.5 text-[9px] md:text-[10px] text-slate-500 dark:text-slate-500 break-words">
                              {bet.sport}{bet.market && ` • ${bet.market}`}{bet.opponent && ` • vs ${bet.opponent}`}
                            </div>
                          )}
                          <div className="mt-0.5 text-[9px] md:text-[10px] text-slate-500 dark:text-slate-400">
                            Bookmaker: <span className="font-medium">{formatBookmakerDisplay(bet.bookmaker, bet.result === 'void', isParlay)}</span>
                          </div>
                          {isLive && !isParlay && bet.player_id && bet.game_date && bet.stat_type && bet.line && bet.over_under && (
                            <LiveStatsIndicator
                              playerId={bet.player_id}
                              gameDate={bet.game_date}
                              statType={bet.stat_type}
                              line={bet.line}
                              overUnder={bet.over_under}
                            />
                          )}
                          {!isLive && (isFinal || isLiveButDetermined) && !isParlay && bet.actual_value !== null && bet.actual_value !== undefined && bet.result !== 'void' && bet.stat_type && bet.line && bet.over_under && (
                            <FinalStatsIndicator
                              actualValue={bet.actual_value}
                              line={bet.line}
                              statType={bet.stat_type}
                              overUnder={bet.over_under}
                              result={bet.result}
                            />
                          )}
                          {isPending && (
                            <div className="mt-0.5 flex justify-end">
                              <span className="text-[9px] md:text-[10px] text-white dark:text-white font-semibold">
                                Potential Return: {formatValue(convertedStake * bet.odds)}
                              </span>
                            </div>
                          )}
                          {!isPending && (bet.result === 'win' || bet.result === 'loss' || bet.result === 'void') && (
                            <div className="mt-0.5 flex justify-end">
                              <span className="text-[9px] md:text-[10px] text-white dark:text-white font-semibold">
                                Returned: {formatValue(returnAmount)}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  {/* Load More Button */}
                  {hasMoreBets && (
                    <div className="flex justify-center mt-4 pb-2">
                      <button
                        onClick={loadMoreBets}
                        disabled={loadingMoreBets}
                        className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {loadingMoreBets ? 'Loading...' : 'Load More Bets'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
      </div>
      
      {/* Mobile Content */}
      {(
      <div className="lg:hidden w-full px-1 py-4 pb-20 space-y-2 overflow-y-auto">
        {/* 1. Top Stats Container */}
        <div className="w-full bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 flex flex-col overflow-hidden">
          {/* Top half - StatTrackr logo and filters */}
          <div className="flex flex-col items-center px-4 pt-4 pb-3 space-y-3">
            {/* Logo and Profile Icon Row */}
            <div className="flex items-center justify-center w-full">
              <StatTrackrLogoWithText 
                logoSize="w-10 h-10" 
                textSize="text-2xl" 
                isDark={isDark}
              />
            </div>
            
            {/* Currency Converter Section */}
            <div className="flex items-center gap-2 w-full justify-center">
              <span className="text-sm font-medium text-slate-600 dark:text-white">Currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as typeof currency)}
                className="h-8 px-3 rounded-lg text-sm bg-emerald-600 text-white border-none focus:ring-2 focus:ring-emerald-400 focus:outline-none font-medium"
                disabled={viewMode === 'units'}
              >
                <option value="USD">USD</option>
                <option value="AUD">AUD</option>
                <option value="GBP">GBP</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            
            {/* View Mode Toggle (Money/Units) */}
            <div className="flex items-center gap-2 w-full justify-center">
              <span className="text-sm font-medium text-slate-600 dark:text-white">View</span>
              <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-gray-600">
                <button
                  onClick={() => setViewMode('money')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === 'money'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white hover:bg-gray-100 dark:hover:bg-[#0f1f35]'
                  }`}
                >
                  Money
                </button>
                <button
                  onClick={() => {
                    if (!unitSize || unitSize <= 0) {
                      setShowUnitSizeModal(true);
                      return;
                    }
                    setViewMode('units');
                  }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === 'units'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white hover:bg-gray-100 dark:hover:bg-[#0f1f35]'
                  }`}
                >
                  Units
                </button>
              </div>
            </div>
            
            {/* Mobile Insights Button */}
            <div className="w-full">
              <button
                onClick={() => setShowMobileInsights(true)}
                className="w-full px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-[#0f1f35] flex items-center justify-center gap-2"
              >
                <Lightbulb className="w-4 h-4" />
                <span>Insights</span>
              </button>
            </div>
            
            {/* Filters Section */}
            <div className="flex flex-col items-center gap-2 w-full">
              <span className="text-sm font-medium text-slate-600 dark:text-white">Filters</span>
              
              <div className="flex gap-2 w-full">
                {/* Sport Dropdown */}
                <select
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  className="flex-1 h-8 px-3 rounded-lg text-sm bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                >
                  <option value="All">All Sports</option>
                  <option value="NBA">NBA</option>
                </select>
                
                {/* Bet Type Dropdown */}
                <select
                  value={betTypeFilter}
                  onChange={(e) => setBetTypeFilter(e.target.value as 'All' | 'Straight' | 'Parlay')}
                  className="flex-1 h-8 px-3 rounded-lg text-sm bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                >
                  <option value="All">All Bet Types</option>
                  <option value="Straight">Straight Bets</option>
                  <option value="Parlay">Parlays</option>
                </select>
              </div>

              <div className="flex gap-2 w-full">
                {/* Bookmaker Dropdown */}
                <select
                  value={bookmaker}
                  onChange={(e) => setBookmaker(e.target.value)}
                  className="flex-1 h-8 px-3 rounded-lg text-sm bg-white dark:bg-[#0a1929] text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                >
                  <option value="All">All Bookmakers ({bets.length})</option>
                  {bookmakerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            {/* Date Range Filter Buttons */}
            <div className="flex flex-col items-center gap-2 w-full">
              <span className="text-sm font-medium text-slate-600 dark:text-white">Timeframe</span>
              <div className="flex gap-2 flex-wrap justify-center">
              {(['all', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    dateRange === range
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'bg-white dark:bg-[#0a1929] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600 hover:bg-white hover:text-slate-700 dark:hover:bg-[#0f1f35] dark:hover:text-white'
                  }`}
                >
                  {range.charAt(0).toUpperCase() + range.slice(1)}
                </button>
              ))}
              </div>
            </div>
          </div>
          
          {/* Bottom half - 6 stat containers */}
          <div className="grid grid-cols-2 gap-2 border-t border-slate-200 dark:border-gray-700/50 p-3">
            {/* Bankroll - Only show in units mode, placed first */}
            {viewMode === 'units' && currentBankroll !== null && (
              <div className="bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
                <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">Bankroll</span>
                <span className="text-base font-semibold text-slate-900 dark:text-white">
                  {formatCurrency(currentBankroll)}
                </span>
              </div>
            )}
            
            {/* Total P&L */}
            <div className="bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">Total P&L {viewMode === 'units' ? '(units)' : `(${currency})`}</span>
              <div className={`text-base font-semibold ${
                stats.totalPL > 0 ? 'text-green-600 dark:text-green-400' :
                stats.totalPL < 0 ? 'text-red-600 dark:text-red-400' :
                'text-slate-900 dark:text-white'
              }`}>
                {formatValue(stats.totalPL, { showSign: true })}
              </div>
            </div>
            
            {/* Total Staked */}
            <div className="bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">Total Staked {viewMode === 'units' ? '(units)' : `(${currency})`}</span>
              <span className="text-base font-semibold text-slate-900 dark:text-white">{formatValue(stats.totalStaked)}</span>
            </div>
            
            {/* Average Stake */}
            <div className="bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">Avg Stake {viewMode === 'units' ? '(units)' : `(${currency})`}</span>
              <span className="text-base font-semibold text-slate-900 dark:text-white">{formatValue(stats.avgStake)}</span>
            </div>
            
            {/* WIN % */}
            <div className="bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">WIN %</span>
              <span className="text-base font-semibold text-slate-900 dark:text-white">{stats.winRate.toFixed(1)}%</span>
            </div>
            
            {/* ROI */}
            <div className="bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">ROI</span>
              <span className={`text-base font-semibold ${
                stats.roi > 0 ? 'text-green-600 dark:text-green-400' :
                stats.roi < 0 ? 'text-red-600 dark:text-red-400' :
                'text-slate-900 dark:text-white'
              }`}>
                {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
              </span>
            </div>
            
            {/* Record */}
            <div className="bg-white dark:bg-[#0a1929] rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">Record</span>
              <div className="text-base font-semibold flex items-center gap-1">
                <span className="text-green-600 dark:text-green-400">{stats.wins}</span>
                <span className="text-slate-400 dark:text-slate-500">-</span>
                <span className="text-red-600 dark:text-red-400">{stats.losses}</span>
                <span className="text-slate-400 dark:text-slate-500">-</span>
                <span className="text-gray-500 dark:text-gray-400">{stats.voids}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Profit/Loss Chart */}
        <div className="chart-container-no-focus bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-3">Profit/Loss Over Time</h3>
          <div className="w-full h-64 relative">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
              <StatTrackrLogoWithText 
                logoSize="w-24 h-24" 
                textSize="text-4xl" 
                isDark={isDark}
                className="opacity-[0.02]"
              />
            </div>
            <ResponsiveContainer width="100%" height="100%" className="relative z-10">
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              >
                <XAxis 
                  dataKey="bet" 
                  stroke={isDark ? '#ffffff' : '#000000'}
                  label={{ value: 'Bets', position: 'insideBottom', offset: -5, fill: isDark ? '#ffffff' : '#000000' }}
                  tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 10 }}
                  ticks={xAxisTicks}
                />
                <YAxis 
                  stroke={isDark ? '#ffffff' : '#000000'}
                  label={{ value: `P/L (${currencySymbols[currency]})`, angle: -90, position: 'insideLeft', offset: 5, fill: isDark ? '#ffffff' : '#000000' }}
                  tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 10 }}
                  tickCount={5}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: isDark ? '#4b5563' : '#9ca3af',
                    border: `1px solid ${isDark ? '#9ca3af' : '#9ca3af'}`,
                    borderRadius: '8px',
                    color: isDark ? '#FFFFFF' : '#000000'
                  }}
                  labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                  itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                  labelFormatter={(value: number) => `Bet No: ${value}`}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'P/L']}
                  cursor={{ stroke: isDark ? '#4b5563' : '#9ca3af', strokeWidth: 1 }}
                />
                <ReferenceLine y={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeDasharray="3 3" />
                <Line 
                  type="linear" 
                  dataKey="profit" 
                  stroke="#8b5cf6" 
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. Betting Calendar */}
        <div className="bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Betting Calendar</h3>
            <div className="flex gap-1.5">
              <button 
                onClick={() => setCalendarView('day')}
                className={`px-2 py-1 text-xs font-medium rounded-lg ${
                  calendarView === 'day' 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                }`}
              >
                Day
              </button>
              <button 
                onClick={() => setCalendarView('week')}
                className={`px-2 py-1 text-xs font-medium rounded-lg ${
                  calendarView === 'week' 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                }`}
              >
                Week
              </button>
              <button 
                onClick={() => setCalendarView('month')}
                className={`px-2 py-1 text-xs font-medium rounded-lg ${
                  calendarView === 'month' 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                }`}
              >
                Month
              </button>
              <button 
                onClick={() => setCalendarView('year')}
                className={`px-2 py-1 text-xs font-medium rounded-lg ${
                  calendarView === 'year' 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                }`}
              >
                Year
              </button>
            </div>
          </div>
          
          {/* Week Range Filter - only show when in week view */}
          {calendarView === 'week' && (
            <div className="flex justify-center gap-2 mb-3">
              <button 
                onClick={() => setWeekRange('1-26')}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg ${
                  weekRange === '1-26' 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                }`}
              >
                Weeks 1-26
              </button>
              <button 
                onClick={() => setWeekRange('27-52')}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg ${
                  weekRange === '27-52' 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                }`}
              >
                Weeks 27-52
              </button>
            </div>
          )}
          
          {/* Calendar Grid */}
          <div className="mb-3" style={{ height: '400px', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={navigatePrevious}
                className="p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors"
                title="Previous"
              >
                <svg className="w-5 h-5 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/>
                </svg>
              </button>
              <div className="text-center text-sm font-semibold text-slate-900 dark:text-white">{calendarData.monthName}</div>
              <button
                onClick={navigateNext}
                className="p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors"
                title="Next"
              >
                <svg className="w-5 h-5 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
            
            {/* Day headers - only for day view */}
            {calendarView === 'day' && (
              <div className="grid grid-cols-7 gap-1.5 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="text-center text-xs font-medium text-slate-600 dark:text-slate-400">{day}</div>
                ))}
              </div>
            )}
            
            {/* Calendar days */}
            <div className={`grid h-full ${
              calendarView === 'day' ? 'grid-cols-7 grid-rows-5 gap-1.5' :
              calendarView === 'week' ? 'grid-cols-7 grid-rows-4 gap-1.5' :
              calendarView === 'month' ? 'grid-cols-3 grid-rows-4 gap-1' :
              'grid-cols-2 grid-rows-1 gap-2'
            }`}>
              {calendarData.calendar.map((item, idx) => {
                const handleClick = () => {
                  if (!item.day) return;
                  
                  const year = calendarDate.getFullYear();
                  const month = calendarDate.getMonth();
                  
                  if (calendarView === 'day') {
                    const date = new Date(year, month, parseInt(item.day));
                    setSelectedDate(date);
                    setSelectedDateType('day');
                  } else if (calendarView === 'week') {
                    const weekNum = parseInt(item.day);
                    const startOfYear = new Date(year, 0, 1);
                    const weekStart = new Date(startOfYear);
                    weekStart.setDate(startOfYear.getDate() + (weekNum - 1) * 7);
                    setSelectedDate(weekStart);
                    setSelectedDateType('week');
                  } else if (calendarView === 'month') {
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const monthIndex = monthNames.indexOf(item.day);
                    if (monthIndex !== -1) {
                      const date = new Date(year, monthIndex, 1);
                      setSelectedDate(date);
                      setSelectedDateType('month');
                    }
                  } else if (calendarView === 'year') {
                    const selectedYear = parseInt(item.day);
                    const date = new Date(selectedYear, 0, 1);
                    setSelectedDate(date);
                    setSelectedDateType('year');
                  }
                };
                
                return (
                <div
                  key={idx}
                  onClick={handleClick}
                  className={`flex flex-col items-center justify-center rounded-lg text-xs font-medium cursor-pointer transition-all hover:scale-105 border border-slate-300/40 dark:border-gray-600/40 ${
                    !item.day ? 'invisible' :
                    item.profit === 0 ? 'bg-slate-200 dark:bg-[#0a1929] text-slate-600 dark:text-slate-400' :
                    item.profit > 100 ? 'bg-green-600 dark:bg-green-500 text-white' :
                    item.profit > 0 ? 'bg-green-400 dark:bg-green-600 text-white' :
                    item.profit < -50 ? 'bg-red-600 dark:bg-red-500 text-white' :
                    'bg-red-400 dark:bg-red-600 text-white'
                  }`}
                >
                  <span className={`${
                    calendarView === 'month' ? 'text-base font-bold' :
                    calendarView === 'year' ? 'text-base font-bold' :
                    'text-xs'
                  }`}>{item.day}</span>
                  {item.day && item.profit !== 0 && (
                    <span className={`${
                      calendarView === 'month' ? 'text-xl font-bold' :
                      calendarView === 'year' ? 'text-xl font-bold' :
                      calendarView === 'week' ? 'text-xs' :
                      'text-xs'
                    } mt-0.5`}>{currencySymbols[currency]}{
                      (calendarView === 'day' || calendarView === 'week') && Math.abs(item.profit) >= 1000
                        ? (Math.abs(item.profit) / 1000).toFixed(1) + 'K'
                        : Math.abs(item.profit).toFixed(0)
                    }</span>
                  )}
                </div>
                );
              })}
            </div>
          </div>
          
          {/* Legend */}
          <div className="flex items-center justify-center gap-3 text-xs mt-auto pt-2">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-green-600"></div>
              <span className="text-slate-600 dark:text-slate-400">Profit</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-600"></div>
              <span className="text-slate-600 dark:text-slate-400">Loss</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-slate-200 dark:bg-gray-700"></div>
              <span className="text-slate-600 dark:text-slate-400">No Bets</span>
            </div>
          </div>
        </div>

        {/* 4. Profit by Bookmaker */}
        <div className="chart-container-no-focus bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-4 flex flex-col h-96">
          <div className="flex items-center justify-between mb-2 md:mb-3 lg:mb-4">
            <h3 className="text-sm md:text-base lg:text-lg font-semibold text-slate-900 dark:text-white">Profit by Bookmaker</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-slate-600 dark:text-slate-400">Profitable only</span>
              <button
                onClick={() => setShowProfitableBookmakersOnly(!showProfitableBookmakersOnly)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  showProfitableBookmakersOnly ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    showProfitableBookmakersOnly ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
          </div>
          <div className="flex-1 w-full">
            {profitByBookmaker.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                No bookmaker data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={profitByBookmaker}
                  margin={{ top: 30, right: 10, left: 10, bottom: -20 }}
                >
                  <XAxis 
                    dataKey="bookmaker" 
                    stroke={isDark ? '#ffffff' : '#000000'}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fontSize: 10, fill: isDark ? '#ffffff' : '#000000' }}
                  />
                  <YAxis 
                    stroke={isDark ? '#ffffff' : '#000000'}
                    label={{ value: `Profit (${currencySymbols[currency]})`, angle: -90, position: 'insideLeft', offset: 5, fill: isDark ? '#ffffff' : '#000000' }}
                    tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 10 }}
                    tickCount={7}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: isDark ? '#4b5563' : '#9ca3af',
                      border: `1px solid ${isDark ? '#9ca3af' : '#9ca3af'}`,
                      borderRadius: '8px',
                      color: isDark ? '#FFFFFF' : '#000000'
                    }}
                    labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                    itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Profit']}
                    cursor={{ fill: isDark ? '#4b5563' : '#9ca3af', opacity: 0.3 }}
                  />
                  <ReferenceLine y={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeWidth={2} />
                  <Bar dataKey="profit" radius={[8, 8, 0, 0]}>
                    {profitByBookmaker.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 5. Profit by Market */}
        <div className="chart-container-no-focus bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Profit by Market</h3>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className="text-xs text-slate-600 dark:text-slate-400">Profitable only</span>
              <button
                onClick={() => setShowProfitableMarketsOnly(!showProfitableMarketsOnly)}
                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                  showProfitableMarketsOnly ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    showProfitableMarketsOnly ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
          </div>
          <div className="w-full h-80">
            {profitByMarket.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                No market data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={profitByMarket}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 15, bottom: 7 }}
                >
                  <XAxis 
                    type="number"
                    stroke={isDark ? '#ffffff' : '#000000'}
                    label={{ value: `Profit (${currencySymbols[currency]})`, position: 'insideBottom', offset: -5, fill: isDark ? '#ffffff' : '#000000' }}
                    tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 10 }}
                    tickCount={7}
                  />
                  <YAxis 
                    type="category"
                    dataKey="market"
                    stroke={isDark ? '#ffffff' : '#000000'}
                    width={70}
                    tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 10 }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: isDark ? '#4b5563' : '#9ca3af',
                      border: `1px solid ${isDark ? '#9ca3af' : '#9ca3af'}`,
                      borderRadius: '8px',
                      color: isDark ? '#FFFFFF' : '#000000'
                    }}
                    labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                    itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Profit']}
                    cursor={{ fill: isDark ? '#4b5563' : '#9ca3af', opacity: 0.3 }}
                  />
                  <ReferenceLine x={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeWidth={2} />
                  <Bar dataKey="profit" radius={[0, 8, 8, 0]}>
                    {profitByMarket.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 6. Bet History */}
        <div className="bg-slate-50 dark:bg-[#0a1929] rounded-xl border border-slate-200 dark:border-gray-700 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Bet History</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBetHistoryPage(prev => Math.max(0, prev - 1))}
                disabled={betHistoryPage === 0}
                className="p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                title="Previous"
              >
                <svg className="w-4 h-4 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/>
                </svg>
              </button>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {Math.min((betHistoryPage + 1) * 20, filteredBets.length)} of {filteredBets.length} bets
              </span>
              <button
                onClick={() => setBetHistoryPage(prev => prev + 1)}
                disabled={betHistoryPage >= Math.floor(filteredBets.length / 20)}
                className="p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                title="Next"
              >
                <svg className="w-4 h-4 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredBets.length === 0 ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                <p className="text-sm mb-1">No bets found</p>
                <p className="text-xs">Add your first bet to get started!</p>
              </div>
            ) : (
              filteredBets.slice(betHistoryPage * 20, (betHistoryPage + 1) * 20).map((bet) => {
                // Convert bet amounts to selected currency
                const convertedStake = convertCurrency(bet.stake, bet.currency, currency);
                const profit = bet.result === 'win' 
                  ? convertedStake * (bet.odds - 1) 
                  : bet.result === 'loss' 
                  ? -convertedStake 
                  : 0;
                // Calculate return amount: win = stake * odds, loss = 0, void = stake
                const returnAmount = bet.result === 'win' 
                  ? convertedStake * bet.odds 
                  : bet.result === 'void' 
                  ? convertedStake 
                  : 0;
                
                // Check if this is a parlay
                const isParlay = Boolean(bet.market && bet.market.toLowerCase().startsWith('parlay'));
                // SPORTSBOOK-STANDARD: Use structured parlay_legs data first (most reliable)
                // Fallback to parsing selection text, then market string
                const structuredLegs = bet.parlay_legs && Array.isArray(bet.parlay_legs) ? bet.parlay_legs : [];
                const parsedLegs = isParlay ? parseParlayLegs(bet.selection) : [];
                const parlayLegs = structuredLegs.length > 0 ? structuredLegs.map((leg: any) => ({
                  playerName: leg.playerName || '',
                  overUnder: leg.overUnder || 'over',
                  line: leg.line || 0,
                  statName: formatStatType(leg.statType) || '',
                  team: leg.team || '', // Preserve team for moneyline display
                  statType: leg.statType || '', // Preserve statType for moneyline check
                  isGameProp: leg.isGameProp || false, // Preserve isGameProp flag
                })) : parsedLegs;
                // Use structured legs count first, then parsed, then market fallback
                const legCount = structuredLegs.length || parlayLegs.length || (bet.market ? parseInt(bet.market.match(/\d+/)?.[0] || '0') : 0);
                
                const betDate = new Date(bet.date);
                const dateStr = betDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                // Determine bet state: pending (blue), live (orange), or final (green/red)
                // A bet can be live but already determined (win/loss) if outcome was determined early
                const isLive = bet.status === 'live';
                const isDetermined = bet.result === 'win' || bet.result === 'loss';
                const isPending = !isLive && (bet.result === 'pending' || (bet.status && bet.status !== 'completed'));
                const isFinal = bet.status === 'completed';
                const isLiveButDetermined = isLive && isDetermined;
                
                return (
                  <div key={bet.id} className={`p-2.5 rounded-lg border-2 ${
                    isLiveButDetermined
                      ? bet.result === 'win'
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-400'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400'
                      : isLive
                      ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-500 dark:border-orange-400'
                      : isPending
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400'
                      : bet.result === 'win' 
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-400'
                      : bet.result === 'void'
                      ? 'bg-gray-50 dark:bg-gray-900/20 border-gray-500 dark:border-gray-400'
                      : 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{dateStr}</span>
                      {(isFinal || isLiveButDetermined) && (
                        <span className={`text-xs font-bold ${
                          bet.result === 'win' 
                            ? 'text-green-600 dark:text-green-400'
                            : bet.result === 'void'
                            ? 'text-gray-600 dark:text-gray-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}>
                          {bet.result === 'void' ? 'VOID' : 
                            `${profit >= 0 ? '+' : ''}${currency} $${Math.abs(profit).toFixed(2)}`
                          }
                        </span>
                      )}
                      {isPending && (
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">PENDING</span>
                      )}
                      {isLive && !isDetermined && (
                        <span className="text-xs font-bold text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500"></span>
                          </span>
                          LIVE
                        </span>
                      )}
                    </div>
                    {isParlay && parlayLegs.length > 0 ? (
                      <>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                          {legCount} leg Parlay
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5 mb-1">
                          {parlayLegs.map((leg, index) => {
                            // Get individual leg result from parlay_legs if available
                            const storedLeg = bet.parlay_legs && Array.isArray(bet.parlay_legs) ? bet.parlay_legs[index] : undefined;
                            const legWon = storedLeg && typeof storedLeg.won === 'boolean' 
                              ? storedLeg.won 
                              : (bet.result === 'win' ? true : null); // Fallback to parlay result if no individual data
                            const legVoid = storedLeg?.void === true;
                            const showLegIndicators = (isFinal || isLiveButDetermined) && bet.result !== 'void' && !legVoid && legWon !== null;
                            
                            return (
                              <div key={index} className="break-words flex items-center gap-1.5">
                                {showLegIndicators && (
                                  <span className={`flex-shrink-0 font-bold ${legWon ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {legWon ? '✓' : '✗'}
                                  </span>
                                )}
                                <span>
                                  {(() => {
                                    // Check if this is a moneyline bet
                                    // Use storedLeg data first (most reliable), then fallback to leg data
                                    const legAny = leg as any;
                                    const statType = storedLeg?.statType || legAny.statType || '';
                                    const team = storedLeg?.team || legAny.team || '';
                                    const isMoneyline = statType === 'moneyline' || 
                                                        leg.statName?.toLowerCase().includes('moneyline');
                                    
                                    if (isMoneyline && team) {
                                      // For moneyline bets, show "X Team to Win"
                                      // Convert abbreviation to full name if needed
                                      const teamName = getFullTeamName(team);
                                      return `${teamName} to win`;
                                    }
                                    
                                    // For non-moneyline bets, use standard format
                                    return `${leg.playerName} ${leg.overUnder} ${leg.line} ${leg.statName}`;
                                  })()}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{bet.selection}</div>
                    )}
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>
                        Stake: {viewMode === 'units' 
                          ? `${convertToUnits(convertedStake).toFixed(2)} units ${bet.currency !== currency ? `(${currency} $${convertedStake.toFixed(2)})` : ''}`
                          : `${currency} $${convertedStake.toFixed(2)} ${bet.currency !== currency ? `(${bet.currency} $${bet.stake.toFixed(2)})` : ''}`
                        }
                      </span>
                      <div className="flex flex-col items-end">
                        <span>Odds: {formatOdds(bet.odds, oddsFormat)}</span>
                      </div>
                    </div>
                    {(bet.market || bet.opponent) && (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                        {bet.sport}{bet.market && ` • ${bet.market}`}{bet.opponent && ` • vs ${bet.opponent}`}
                      </div>
                    )}
                    {isLive && !isParlay && bet.player_id && bet.game_date && bet.stat_type && bet.line && bet.over_under && (
                      <LiveStatsIndicator
                        playerId={bet.player_id}
                        gameDate={bet.game_date}
                        statType={bet.stat_type}
                        line={bet.line}
                        overUnder={bet.over_under}
                      />
                    )}
                    {!isLive && (isFinal || isLiveButDetermined) && !isParlay && bet.actual_value !== null && bet.actual_value !== undefined && bet.result !== 'void' && bet.stat_type && bet.line && bet.over_under && (
                      <FinalStatsIndicator
                        actualValue={bet.actual_value}
                        line={bet.line}
                        statType={bet.stat_type}
                        overUnder={bet.over_under}
                        result={bet.result}
                      />
                    )}
                    {isPending && (
                      <div className="mt-1 flex justify-end">
                        <span className="text-xs text-white dark:text-white font-semibold">
                          Potential Return: {formatValue(convertedStake * bet.odds)}
                        </span>
                      </div>
                    )}
                    {!isPending && (bet.result === 'win' || bet.result === 'loss' || bet.result === 'void') && (
                      <div className="mt-1 flex justify-end">
                        <span className="text-xs text-white dark:text-white font-semibold">
                          Returned: {formatValue(returnAmount)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {/* Load More Button (Mobile) */}
            {hasMoreBets && (
              <div className="flex justify-center mt-4 pb-2">
                <button
                  onClick={loadMoreBets}
                  disabled={loadingMoreBets}
                  className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loadingMoreBets ? 'Loading...' : 'Load More Bets'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
      
      {/* Right Sidebar */}
      {isLargeScreen && (
        <div className="hidden 2xl:block">
          <RightSidebar 
            oddsFormat={oddsFormat} 
            isMobileView={false}
           />
        </div>
      )}
      
      {/* Mobile Insights Modal - Full Screen */}
      {showMobileInsights && (
        <div className="lg:hidden fixed inset-0 z-[100] bg-white dark:bg-[#0a1929] flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Insights</h2>
            <button
              onClick={() => setShowMobileInsights(false)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-slate-600 dark:text-slate-400"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {(() => {
              // Convert bets to JournalBet format for insights
              const journalBetsForInsights: InsightsJournalBet[] = bets.map(bet => ({
                id: bet.id,
                date: bet.date,
                sport: bet.sport,
                market: bet.market ?? undefined,
                selection: bet.selection,
                stake: bet.stake,
                odds: bet.odds,
                result: bet.result as 'win' | 'loss' | 'void' | 'pending',
                status: bet.status ?? undefined,
                currency: bet.currency,
                opponent: bet.opponent ?? undefined,
                team: undefined,
                stat_type: bet.stat_type ?? null,
                player_id: bet.player_id ?? null,
                player_name: undefined,
                over_under: bet.over_under ?? null,
                line: bet.line ?? null,
                actual_value: bet.actual_value ?? null,
                game_date: bet.game_date ?? null,
                parlay_legs: bet.parlay_legs ?? null,
              }));
              
              // Calculate settled bets FIRST before generating insights
              const settledBets = journalBetsForInsights.filter(b => b.result === 'win' || b.result === 'loss');
              
              if (journalBetsForInsights.length === 0) {
                return (
                  <div className="p-4 text-center py-8 text-slate-600 dark:text-slate-400">
                    <div className="text-sm">No plays in journal yet</div>
                    <div className="text-xs mt-2">Add plays from the research pages to track your betting history</div>
                  </div>
                );
              }
              
              // Check settled bets count FIRST - this takes priority over everything else
              // Don't even generate insights if we don't have enough settled bets
              if (settledBets.length < 10) {
                return (
                  <div className="flex items-center justify-center h-full min-h-[200px] p-4">
                    <div className="text-center text-slate-600 dark:text-slate-400">
                      <div className="text-sm">You need 10 or more plays in the journal to get insights</div>
                      <div className="text-xs mt-2 text-slate-500 dark:text-slate-500">
                        {settledBets.length}/10 plays
                      </div>
                    </div>
                  </div>
                );
              }
              
              // Only generate insights if we have 10+ settled bets
              const insights = generateInsights(journalBetsForInsights);
              
              // If no insights generated but we have 10+ settled bets, show a message
              if (insights.length === 0) {
                return (
                  <div className="flex items-center justify-center h-full min-h-[200px] p-4">
                    <div className="text-center text-slate-600 dark:text-slate-400">
                      <div className="text-sm">You need 10 or more plays in the journal to get insights</div>
                      <div className="text-xs mt-2 text-slate-500 dark:text-slate-500">
                        {settledBets.length}/10 plays
                      </div>
                    </div>
                  </div>
                );
              }
              
              // Filter insights - same logic as desktop right sidebar
              const filteredInsights = insights.filter(insight => {
                // Exclude pain insights from "all" filter - they only show when "pain" is explicitly selected
                if (mobileInsightFilter === 'all' && insight.type === 'pain') {
                  return false;
                }
                
                if (mobileInsightFilter !== 'all') {
                  if (mobileInsightFilter === 'info') {
                    // Information filter includes both neutral and comparison insights (both use blue color now)
                    if (insight.color !== 'blue' || (insight.type !== 'neutral' && insight.type !== 'comparison')) return false;
                  } else if (mobileInsightFilter === 'pain') {
                    // Pain filter only shows pain type insights
                    if (insight.type !== 'pain') return false;
                  } else {
                    if (insight.color !== mobileInsightFilter) return false;
                  }
                }
                // Filter by bet type (straight vs parlay)
                if (mobileInsightBetTypeFilter !== 'all') {
                  if (mobileInsightBetTypeFilter === 'parlay' && insight.category !== 'parlay') {
                    return false;
                  }
                  if (mobileInsightBetTypeFilter === 'straight' && insight.category === 'parlay') {
                    return false;
                  }
                }
                
                return true;
              });
              
              // Sort insights - when showing "All", interleave by color to ensure mixed display
              // When filtering by specific type, respect user's sort preference
              let sortedFilteredInsights: Insight[];
              
              if (mobileInsightFilter === 'all') {
                // When showing all, interleave insights by color for better mix
                // Combine orange (neutral) and blue (comparison) into 'info' group
                const colorGroups: Record<string, Insight[]> = {
                  'red': [],
                  'green': [],
                  'info': [], // Combined neutral and comparison
                  'yellow': []
                };
                
                // Group by color while maintaining priority within each color
                // Combine neutral and comparison insights (both blue) into 'info' group
                filteredInsights.forEach(insight => {
                  if (insight.color === 'blue' && (insight.type === 'neutral' || insight.type === 'comparison')) {
                    if (!colorGroups['info']) colorGroups['info'] = [];
                    colorGroups['info'].push(insight);
                  } else {
                    if (!colorGroups[insight.color]) colorGroups[insight.color] = [];
                    colorGroups[insight.color].push(insight);
                  }
                });
                
                // Sort each color group by priority
                Object.keys(colorGroups).forEach(color => {
                  colorGroups[color].sort((a, b) => b.priority - a.priority);
                });
                
                // Interleave: take one from each color group in round-robin fashion
                const interleaved: Insight[] = [];
                const maxLength = Math.max(...Object.values(colorGroups).map(g => g.length));
                
                for (let i = 0; i < maxLength; i++) {
                  // Define color order for interleaving (red, green, info, yellow)
                  const colorOrder = ['red', 'green', 'info', 'yellow'];
                  
                  // Shuffle the color order each round for better distribution
                  const shuffledColors = [...colorOrder];
                  if (i > 0) {
                    // Rotate colors each round
                    for (let j = 0; j < i % 4; j++) {
                      shuffledColors.push(shuffledColors.shift()!);
                    }
                  }
                  
                  // Take one insight from each color if available
                  for (const color of shuffledColors) {
                    if (colorGroups[color] && colorGroups[color].length > i) {
                      interleaved.push(colorGroups[color][i]);
                    }
                  }
                }
                
                sortedFilteredInsights = interleaved;
              } else {
                // When filtering by specific type, always sort by priority
                sortedFilteredInsights = [...filteredInsights].sort((a, b) => {
                  return b.priority - a.priority;
                });
              }
              
              return (
                <div>
                  {/* Filters and Sorting */}
                  <div className="p-4 border-b border-slate-200 dark:border-gray-700 space-y-3">
                    <div className="grid grid-cols-5 gap-2">
                      <button
                        onClick={() => setMobileInsightFilter('all')}
                        className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                          mobileInsightFilter === 'all'
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setMobileInsightFilter('green')}
                        className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                          mobileInsightFilter === 'green'
                            ? 'bg-green-500 text-white'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50'
                        }`}
                      >
                        Wins
                      </button>
                      <button
                        onClick={() => setMobileInsightFilter('red')}
                        className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                          mobileInsightFilter === 'red'
                            ? 'bg-red-500 text-white'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50'
                        }`}
                      >
                        Losses
                      </button>
                      <button
                        onClick={() => setMobileInsightFilter('info')}
                        className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                          mobileInsightFilter === 'info'
                            ? 'bg-blue-500 text-white'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                        }`}
                      >
                        Info
                      </button>
                      <button
                        onClick={() => setMobileInsightFilter('pain')}
                        className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                          mobileInsightFilter === 'pain'
                            ? 'bg-orange-500 text-white'
                            : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50'
                        }`}
                      >
                        Pain
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setMobileInsightBetTypeFilter('all')}
                          className={`text-xs px-2 py-1 rounded-lg transition-colors font-medium ${
                            mobileInsightBetTypeFilter === 'all'
                              ? 'bg-purple-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                          }`}
                        >
                          All
                        </button>
                        <button
                          onClick={() => setMobileInsightBetTypeFilter('straight')}
                          className={`text-xs px-2 py-1 rounded-lg transition-colors font-medium ${
                            mobileInsightBetTypeFilter === 'straight'
                              ? 'bg-purple-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                          }`}
                        >
                          Straight
                        </button>
                        <button
                          onClick={() => setMobileInsightBetTypeFilter('parlay')}
                          className={`text-xs px-2 py-1 rounded-lg transition-colors font-medium ${
                            mobileInsightBetTypeFilter === 'parlay'
                              ? 'bg-purple-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                          }`}
                        >
                          Parlays
                        </button>
                      </div>
                    </div>
                    
                    {filteredInsights.length !== insights.length && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Showing {filteredInsights.length} of {insights.length} insights
                      </div>
                    )}
                  </div>
                  
                  {/* Insights List */}
                  <div className="p-4 space-y-3">
                    {sortedFilteredInsights.length === 0 ? (
                      <div className="text-center py-8 text-slate-600 dark:text-slate-400">
                        <div className="text-sm">No insights match your filters</div>
                        <button
                          onClick={() => {
                            setMobileInsightFilter('all');
                            setMobileInsightBetTypeFilter('all');
                          }}
                          className="text-xs mt-2 text-purple-500 dark:text-purple-400 hover:underline"
                        >
                          Clear filters
                        </button>
                      </div>
                    ) : (
                      sortedFilteredInsights.map((insight) => {
                        const getColorClasses = () => {
                      switch (insight.color) {
                        case 'red':
                          return {
                            border: 'border-red-500 dark:border-red-400',
                            text: 'text-slate-900 dark:text-white',
                            iconBg: 'bg-red-50 dark:bg-red-950/20',
                            iconColor: 'text-red-600 dark:text-red-400',
                          };
                        case 'green':
                          return {
                            border: 'border-green-500 dark:border-green-400',
                            text: 'text-slate-900 dark:text-white',
                            iconBg: 'bg-green-50 dark:bg-green-950/20',
                            iconColor: 'text-green-600 dark:text-green-400',
                          };
                        case 'blue':
                          return {
                            border: 'border-blue-500 dark:border-blue-400',
                            text: 'text-slate-900 dark:text-white',
                            iconBg: 'bg-blue-50 dark:bg-blue-950/20',
                            iconColor: 'text-blue-600 dark:text-blue-400',
                          };
                        case 'yellow':
                          return {
                            border: 'border-yellow-500 dark:border-yellow-400',
                            text: 'text-slate-900 dark:text-white',
                            iconBg: 'bg-yellow-50 dark:bg-yellow-950/20',
                            iconColor: 'text-yellow-600 dark:text-yellow-400',
                          };
                        case 'orange':
                          return {
                            border: 'border-orange-500 dark:border-orange-400',
                            text: 'text-slate-900 dark:text-white',
                            iconBg: 'bg-orange-50 dark:bg-orange-950/20',
                            iconColor: 'text-orange-600 dark:text-orange-400',
                          };
                        default:
                          return {
                            border: 'border-gray-500 dark:border-gray-400',
                            text: 'text-slate-900 dark:text-white',
                            iconBg: 'bg-gray-50 dark:bg-gray-800',
                            iconColor: 'text-gray-600 dark:text-gray-400',
                          };
                      }
                    };
                    
                        const getIcon = () => {
                          const colors = getColorClasses();
                          const iconClass = `w-5 h-5 ${colors.iconColor}`;
                          switch (insight.type) {
                            case 'loss':
                              return <TrendingDown className={iconClass} />;
                            case 'win':
                              return <TrendingUp className={iconClass} />;
                            case 'comparison':
                              return <BarChart3 className={iconClass} />;
                            case 'streak':
                              return <TrendingUp className={iconClass} />;
                            case 'neutral':
                              return <Minus className={iconClass} />;
                            case 'pain':
                              return <span className={iconClass} style={{ fontSize: '20px' }}>😢</span>;
                            default:
                              return <Lightbulb className={iconClass} />;
                          }
                            };
                        
                        const colors = getColorClasses();
                        const isExpanded = expandedMobileInsights.has(insight.id);
                        const isPainInsight = insight.type === 'pain';
                        
                        return (
                          <div
                            key={insight.id}
                            className={`rounded-lg bg-slate-50 dark:bg-[#0a1929] border-2 ${colors.border} shadow-sm`}
                          >
                            <div className="p-4">
                              <div className="flex items-start gap-3">
                                <div className={`flex-shrink-0 w-10 h-10 rounded-md ${colors.iconBg} flex items-center justify-center`}>
                                  {getIcon()}
                                </div>
                                <div className="flex-1 min-w-0">
                              {isPainInsight ? (
                                <div className="space-y-1">
                                  <p className={`text-sm font-medium leading-relaxed ${colors.text}`}>
                                    {insight.message}
                                  </p>
                                  {insight.potentialProfit !== undefined && (
                                    <p className="text-xs text-orange-600 dark:text-orange-400">
                                      If they had hit, you would have made {formatValue(insight.potentialProfit, { showSign: true })} more profit.
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-start justify-between gap-2">
                                    <p className={`text-sm font-medium leading-relaxed ${colors.text}`}>
                                      {insight.message}
                                    </p>
                                    {insight.stats && (
                                      <button
                                        onClick={() => {
                                          setExpandedMobileInsights(prev => {
                                            const next = new Set(prev);
                                            if (next.has(insight.id)) {
                                              next.delete(insight.id);
                                            } else {
                                              next.add(insight.id);
                                            }
                                            return next;
                                          });
                                        }}
                                        className="flex-shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="w-4 h-4" />
                                        ) : (
                                          <ChevronDown className="w-4 h-4" />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                  
                                  {isExpanded && insight.stats && (
                                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
                                      {insight.stats.winRate !== undefined && (
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="opacity-75">Win Rate:</span>
                                          <div className="flex items-center gap-2">
                                            <div className="w-20 bg-current/20 rounded-full h-1.5">
                                              <div
                                                className={`h-1.5 rounded-full transition-all ${
                                                  insight.stats.winRate >= 60 ? 'bg-green-500' :
                                                  insight.stats.winRate >= 50 ? 'bg-yellow-500' :
                                                  'bg-red-500'
                                                }`}
                                                style={{ width: `${insight.stats.winRate}%` }}
                                              />
                                            </div>
                                            <span className="font-bold">{insight.stats.winRate}%</span>
                                          </div>
                                        </div>
                                      )}
                                      {insight.stats.profit !== undefined && (
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="opacity-75">Profit:</span>
                                          <span className="font-bold">{formatValue(insight.stats.profit, { showSign: true })}</span>
                                        </div>
                                      )}
                                      {insight.stats.wagered !== undefined && (
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="opacity-75">Wagered:</span>
                                          <span className="font-bold">{formatValue(insight.stats.wagered)}</span>
                                        </div>
                                      )}
                                      {insight.stats.returned !== undefined && (
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="opacity-75">Returned:</span>
                                          <span className="font-bold">{formatValue(insight.stats.returned)}</span>
                                        </div>
                                      )}
                                      {insight.stats.roi !== undefined && (
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="opacity-75">ROI:</span>
                                          <span className={`font-bold ${insight.stats.roi >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {insight.stats.roi >= 0 ? '+' : ''}{insight.stats.roi}%
                                          </span>
                                        </div>
                                      )}
                                      {insight.recommendation && (
                                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                          <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                                            {insight.recommendation}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      );
                    })
                  )}
                </div>
              </div>
              );
            })()}
          </div>
        </div>
      )}
      
      {/* Mobile Bottom Navigation - Always visible on mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#0a1929] border-t border-gray-200 dark:border-gray-700 z-50 safe-bottom">
        {/* Profile Dropdown Menu - Shows above bottom nav */}
        {showProfileDropdown && (
          <div ref={profileDropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowProfileDropdown(false);
                  handleSubscriptionClick();
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Subscription
              </button>
              <div className="border-t border-gray-200 dark:border-gray-700"></div>
              <button
                onClick={() => {
                  setShowProfileDropdown(false);
                  handleSignOutClick();
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
        
        {/* Settings Dropdown Menu - Shows above bottom nav */}
        {showSettingsDropdown && (
          <div ref={settingsDropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowSettingsDropdown(false);
                  setShowMobileSettings(true);
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Open Settings
              </button>
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-4 h-16">
          {/* Props */}
          <button
            data-props-button
            onClick={() => router.push('/nba')}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <circle cx="12" cy="12" r="6" strokeWidth={2} />
              <circle cx="12" cy="12" r="2" strokeWidth={2} />
            </svg>
            <span className="text-xs font-medium">Props</span>
          </button>
          
          {/* Journal */}
          <button
            data-journal-button
            onClick={() => router.push('/journal')}
            className="flex flex-col items-center justify-center gap-1 text-purple-600 dark:text-purple-400"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span className="text-xs font-medium">Journal</span>
          </button>
          
          {/* Settings */}
          <button
            data-settings-button
            onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs font-medium">Settings</span>
          </button>
          
          {/* Profile */}
          <button
            data-profile-button
            onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            {(() => {
              const displayName = username || userEmail || 'Profile';
              const fallbackInitial = displayName?.trim().charAt(0)?.toUpperCase() || 'P';
              const getAvatarColor = (name: string): string => {
                let hash = 0;
                for (let i = 0; i < name.length; i++) {
                  hash = name.charCodeAt(i) + ((hash << 5) - hash);
                }
                const hue = Math.abs(hash) % 360;
                const saturation = 65 + (Math.abs(hash) % 20);
                const lightness = 45 + (Math.abs(hash) % 15);
                return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
              };
              const avatarColor = !avatarUrl ? getAvatarColor(displayName) : undefined;
              return (
                <div 
                  className="w-6 h-6 rounded-full overflow-hidden border border-gray-300 dark:border-gray-600 flex items-center justify-center text-xs font-semibold text-white"
                  style={avatarColor ? { backgroundColor: avatarColor } : { backgroundColor: 'rgb(243, 244, 246)' }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl ?? undefined} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full">{fallbackInitial}</span>
                  )}
                </div>
              );
            })()}
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </div>
      
      {/* Mobile Settings Modal */}
      {showMobileSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div 
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h2>
                <button
                  onClick={() => setShowMobileSettings(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Theme</label>
                  <select 
                    value={theme}
                    onChange={(e) => {
                      setTheme(e.target.value as 'Light' | 'Dark');
                      try {
                        localStorage.setItem('theme', e.target.value);
                      } catch (e: any) {
                        if (e.name === 'QuotaExceededError' || e.code === 22) {
                          console.warn('[Journal] localStorage quota exceeded when saving theme');
                        } else {
                          console.warn('[Journal] Failed to save theme to localStorage:', e);
                        }
                      }
                    }}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="Light">Light</option>
                    <option value="Dark">Dark</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Preferred Odds</label>
                  <select 
                    value={oddsFormat}
                    onChange={(e) => {
                      const newFormat = e.target.value as 'american' | 'decimal';
                      setOddsFormat(newFormat);
                      try {
                        localStorage.setItem('oddsFormat', newFormat);
                      } catch (e: any) {
                        if (e.name === 'QuotaExceededError' || e.code === 22) {
                          console.warn('[Journal] localStorage quota exceeded when saving oddsFormat');
                        } else {
                          console.warn('[Journal] Failed to save oddsFormat to localStorage:', e);
                        }
                      }
                    }}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="american">American</option>
                    <option value="decimal">Decimal</option>
                  </select>
                </div>
                
                {/* Journal Settings Section */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Journal Settings</h3>
                  
                  {/* Preferred Input Method */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Preferred Input</label>
                    <select 
                      value={mobilePreferredJournalInput}
                      onChange={(e) => setMobilePreferredJournalInput(e.target.value as 'money' | 'units')}
                      className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    >
                      <option value="money">Money (Currency)</option>
                      <option value="units">Units</option>
                    </select>
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Choose how to input stakes when adding bets from dashboard</p>
                  </div>
                  
                  {/* Preferred Currency */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Preferred Currency</label>
                    <select 
                      value={mobilePreferredCurrency}
                      onChange={(e) => setMobilePreferredCurrency(e.target.value as 'USD' | 'AUD' | 'GBP' | 'EUR')}
                      className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="AUD">AUD (A$)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="EUR">EUR (€)</option>
                    </select>
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Default currency for journal entries</p>
                  </div>
                  
                  {/* Unit Settings Button - styled like other dropdowns */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Unit Settings</label>
                    <button
                      onClick={() => setShowMobileUnitSettingsModal(true)}
                      className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-left flex items-center justify-between focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    >
                      <span>Configure Unit Size</span>
                      <svg 
                        className="w-4 h-4" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <button 
                  onClick={async () => {
                    try {
                      // Save to localStorage
                      try {
                        localStorage.setItem('theme', theme);
                        localStorage.setItem('oddsFormat', oddsFormat);
                      } catch (e: any) {
                        if (e.name === 'QuotaExceededError' || e.code === 22) {
                          console.warn('[Journal] localStorage quota exceeded when saving settings');
                        } else {
                          console.warn('[Journal] Failed to save settings to localStorage:', e);
                        }
                      }
                      
                      // Save journal preferences to database
                      const { data: { user } } = await supabase.auth.getUser();
                      if (user) {
                        // Try UPDATE first
                        const { error: updateError } = await (supabase
                          .from('profiles') as any)
                          .update({
                            preferred_journal_input: mobilePreferredJournalInput,
                            preferred_currency: mobilePreferredCurrency,
                          })
                          .eq('id', user.id);
                        
                        if (updateError) {
                          // If UPDATE fails, try INSERT (in case profile row doesn't exist)
                          const { error: insertError } = await (supabase
                            .from('profiles') as any)
                            .insert({
                              id: user.id,
                              preferred_journal_input: mobilePreferredJournalInput,
                              preferred_currency: mobilePreferredCurrency,
                            });
                          
                          if (insertError) {
                            console.error('Error saving journal preferences:', {
                              updateError: updateError.message || updateError,
                              insertError: insertError.message || insertError,
                              code: updateError.code || insertError.code,
                              details: updateError.details || insertError.details,
                              hint: updateError.hint || insertError.hint,
                            });
                          }
                        }
                      }
                      
                      setShowMobileSettings(false);
                    } catch (error) {
                      console.error('Error saving settings:', error);
                    }
                  }}
                  className="w-full bg-purple-600 text-white py-3 px-4 rounded-xl hover:bg-purple-700 transition-colors font-medium"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Mobile Unit Settings Modal - Centered */}
      {showMobileUnitSettingsModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div 
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 md:p-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-6 md:mb-8 pb-4 md:pb-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Unit Settings</h2>
                    <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-0.5">Configure your betting units</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMobileUnitSettingsModal(false)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Content */}
              <div className="space-y-5 md:space-y-6">
                {/* Bankroll Section */}
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-700">
                  <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Bankroll
                  </label>
                  <div className="flex gap-2 md:gap-3">
                    <div className="relative flex-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">{currencySymbols[mobileBankrollCurrency]}</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={mobileBankroll}
                        onChange={(e) => setMobileBankroll(e.target.value)}
                        placeholder="10000.00"
                        className="w-full pl-8 pr-4 py-3 md:py-3.5 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium"
                      />
                    </div>
                    <select
                      value={mobileBankrollCurrency}
                      onChange={(e) => setMobileBankrollCurrency(e.target.value as 'USD' | 'AUD' | 'GBP' | 'EUR')}
                      className="px-3 md:px-4 py-3 md:py-3.5 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium cursor-pointer appearance-none bg-no-repeat bg-right pr-10 text-sm md:text-base"
                      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0.75rem center', backgroundSize: '1.5em 1.5em' }}
                    >
                      <option value="USD">USD</option>
                      <option value="AUD">AUD</option>
                      <option value="GBP">GBP</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Your total betting bankroll</p>
                </div>
                
                {/* Unit Size Section */}
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-700">
                  <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                    Unit Size
                  </label>
                  <div className="flex gap-2 md:gap-3">
                    <div className="relative flex-1">
                      {mobileUnitType === 'value' && (
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">{currencySymbols[mobileBankrollCurrency]}</span>
                      )}
                      <input
                        type="number"
                        step={mobileUnitType === 'percent' ? '0.1' : '0.01'}
                        min="0"
                        max={mobileUnitType === 'percent' ? '100' : undefined}
                        value={mobileUnitSize}
                        onChange={(e) => setMobileUnitSize(e.target.value)}
                        placeholder={mobileUnitType === 'percent' ? '1.0' : '100.00'}
                        className={`w-full ${mobileUnitType === 'value' ? 'pl-8' : 'pl-4'} pr-4 py-3 md:py-3.5 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium`}
                      />
                      {mobileUnitType === 'percent' && (
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">%</span>
                      )}
                    </div>
                    <select
                      value={mobileUnitType}
                      onChange={(e) => setMobileUnitType(e.target.value as 'value' | 'percent')}
                      className="px-3 md:px-4 py-3 md:py-3.5 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium cursor-pointer appearance-none bg-no-repeat bg-right pr-10 text-sm md:text-base"
                      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0.75rem center', backgroundSize: '1.5em 1.5em' }}
                    >
                      <option value="value">Unit Value</option>
                      <option value="percent">Unit %</option>
                    </select>
                  </div>
                  <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                      {mobileUnitType === 'percent' 
                        ? '💡 Set your unit size as a percentage of bankroll. For example, 1% means 1 unit equals 1% of your bankroll.'
                        : '💡 Set your unit size as a fixed dollar amount. For example, $100 means 1 unit equals $100.'}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Footer */}
              <div className="mt-6 md:mt-8 pt-5 md:pt-6 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button
                  onClick={() => setShowMobileUnitSettingsModal(false)}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    setSavingMobileUnitSize(true);
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (user) {
                        const updates: any = {};
                        
                        if (mobileBankroll) {
                          const bankrollValue = parseFloat(mobileBankroll);
                          if (isNaN(bankrollValue) || bankrollValue < 0) {
                            alert('Bankroll must be a positive number');
                            setSavingMobileUnitSize(false);
                            return;
                          }
                          updates.bankroll = bankrollValue;
                          updates.bankroll_currency = mobileBankrollCurrency;
                          // Set bankroll_set_date if it's not already set (first time setting bankroll)
                          if (!bankrollSetDate) {
                            const setDate = new Date().toISOString();
                            updates.bankroll_set_date = setDate;
                            setBankrollSetDate(setDate);
                          }
                          setBankroll(bankrollValue);
                        }
                        
                        if (mobileUnitSize) {
                          const unitSizeValue = parseFloat(mobileUnitSize);
                          if (isNaN(unitSizeValue) || unitSizeValue <= 0) {
                            alert('Unit size must be a positive number');
                            setSavingMobileUnitSize(false);
                            return;
                          }
                          if (mobileUnitType === 'percent' && unitSizeValue > 100) {
                            alert('Unit percentage cannot exceed 100%');
                            setSavingMobileUnitSize(false);
                            return;
                          }
                          updates.unit_size = unitSizeValue;
                          updates.unit_type = mobileUnitType;
                        }
                        
                        if (Object.keys(updates).length > 0) {
                          // Try to update first, if profile doesn't exist, insert it
                          const { error: updateError } = await (supabase
                            .from('profiles') as any)
                            .update(updates)
                            .eq('id', user.id);
                          
                          if (updateError) {
                            // If update fails because profile doesn't exist, try to insert
                            if (updateError.code === 'PGRST116' || updateError.message?.includes('No rows')) {
                              const { error: insertError } = await (supabase
                                .from('profiles') as any)
                                .insert({
                                  id: user.id,
                                  ...updates
                                });
                              
                              if (insertError) throw insertError;
                            } else {
                              throw updateError;
                            }
                          }
                          
                          // Refresh profile data to ensure state is up to date
                          console.log('[SAVE] Refreshing profile after save, updates:', updates);
                          const { data: refreshedProfile } = await supabase
                            .from('profiles')
                            .select('unit_size, bankroll, bankroll_set_date')
                            .eq('id', user.id)
                            .single();
                          console.log('[SAVE] Refreshed profile data:', refreshedProfile);
                          if (refreshedProfile) {
                            const profile = refreshedProfile as {
                              unit_size?: number | null;
                              bankroll?: number | null;
                              bankroll_set_date?: string | null;
                            };
                            if (profile.unit_size) {
                              const unitSizeValue = parseFloat(profile.unit_size.toString());
                              console.log('[SAVE] Setting unitSize to:', unitSizeValue);
                              setUnitSize(unitSizeValue);
                            } else {
                              console.log('[SAVE] No unit_size in refreshed profile');
                            }
                            if (profile.bankroll) {
                              const bankrollValue = parseFloat(profile.bankroll.toString());
                              console.log('[SAVE] Setting bankroll to:', bankrollValue);
                              setBankroll(bankrollValue);
                            }
                            if (profile.bankroll_set_date) {
                              setBankrollSetDate(profile.bankroll_set_date);
                            }
                          } else {
                            console.log('[SAVE] No refreshed profile data returned');
                          }
                          
                          // Show success message
                          setSavingMobileUnitSize(false);
                          setShowMobileSuccessMessage(true);
                          setTimeout(() => {
                            setShowMobileSuccessMessage(false);
                            setShowMobileUnitSettingsModal(false);
                          }, 2000);
                        } else {
                          // No updates to save, just close
                          setShowMobileUnitSettingsModal(false);
                        }
                      }
                    } catch (error: any) {
                      console.error('Error saving unit settings:', error);
                      const errorMessage = error?.message || error?.details || 'Unknown error';
                      alert(`Failed to save unit settings: ${errorMessage}. Please try again.`);
                      setSavingMobileUnitSize(false);
                      setShowMobileSuccessMessage(false);
                    }
                  }}
                  disabled={savingMobileUnitSize || showMobileSuccessMessage}
                  className={`flex-1 px-4 py-3 rounded-lg transition-all font-semibold flex items-center justify-center gap-2 ${
                    showMobileSuccessMessage 
                      ? 'bg-green-600 text-white shadow-lg shadow-green-500/30' 
                      : savingMobileUnitSize
                      ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-500/30 opacity-50 cursor-not-allowed'
                      : 'bg-gradient-to-r from-purple-600 to-purple-700 text-white hover:from-purple-700 hover:to-purple-800 shadow-lg shadow-purple-500/30'
                  }`}
                >
                  {showMobileSuccessMessage ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Saved!
                    </>
                  ) : savingMobileUnitSize ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Unit Size Configuration Modal */}
      {showUnitSizeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div 
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Unit Size Not Configured
                </h2>
                <button
                  onClick={() => setShowUnitSizeModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Your unit size is not set up. Please configure it in Settings to view your journal in units.
                </p>
                
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                  <p className="text-sm font-medium text-purple-900 dark:text-purple-200 mb-2">
                    {isLargeScreen ? (
                      <>Configure in Left Sidebar Settings</>
                    ) : (
                      <>Configure in Navigation Settings</>
                    )}
                  </p>
                  <p className="text-xs text-purple-700 dark:text-purple-300">
                    {isLargeScreen ? (
                      <>Open the Settings button in the left sidebar to set your unit size.</>
                    ) : (
                      <>Open Settings from the navigation menu to set your unit size.</>
                    )}
                  </p>
                </div>
                
                <button
                  onClick={() => setShowUnitSizeModal(false)}
                  className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-purple-700 transition-colors"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Live Stats Indicator Component
function LiveStatsIndicator({ 
  playerId, 
  gameDate, 
  statType, 
  line, 
  overUnder 
}: { 
  playerId: string; 
  gameDate: string; 
  statType: string; 
  line: number; 
  overUnder: 'over' | 'under';
}) {
  const [liveStats, setLiveStats] = useState<{ pts: number; reb: number; ast: number; stl: number; blk: number; fg3m: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    const fetchLiveStats = async () => {
      try {
        const response = await fetch(`/api/live-stats?playerId=${playerId}&gameDate=${gameDate}`);
        if (response.ok) {
          const data = await response.json();
          setLiveStats(data);
        }
      } catch (error) {
        console.error('Error fetching live stats:', error);
      } finally {
        setLoading(false);
      }
    };

    // Fetch immediately
    fetchLiveStats();
    
    // Then fetch every 30 seconds
    interval = setInterval(fetchLiveStats, 30000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [playerId, gameDate]);

  if (loading || !liveStats) {
    return (
      <div className="mt-1.5 text-[9px] md:text-[10px] text-slate-400 dark:text-slate-500">
        Loading live stats...
      </div>
    );
  }

  // Calculate current stat value
  let currentValue = 0;
  switch (statType) {
    case 'pts': currentValue = liveStats.pts; break;
    case 'reb': currentValue = liveStats.reb; break;
    case 'ast': currentValue = liveStats.ast; break;
    case 'stl': currentValue = liveStats.stl; break;
    case 'blk': currentValue = liveStats.blk; break;
    case 'fg3m': currentValue = liveStats.fg3m; break;
    case 'pr': currentValue = liveStats.pts + liveStats.reb; break;
    case 'pra': currentValue = liveStats.pts + liveStats.reb + liveStats.ast; break;
    case 'ra': currentValue = liveStats.reb + liveStats.ast; break;
  }

  // For "over" bets: progress bar goes from 0 to line (capped at 100% when current >= line)
  // For "under" bets: progress bar shows how close we are to the line (0% = 0, 100% = line)
  const isWholeNumber = line % 1 === 0;
  
  // Calculate progress percentage
  let progressPercent = 0;
  if (overUnder === 'over') {
    // For over bets: 0% at 0, 100% when current >= line
    progressPercent = Math.min(100, (currentValue / line) * 100);
  } else {
    // For under bets: 0% at 0, 100% when current >= line (shows how close to losing)
    progressPercent = Math.min(100, (currentValue / line) * 100);
  }

  // Determine color based on current status
  const isWinning = overUnder === 'over' 
    ? (isWholeNumber ? currentValue >= line : currentValue > line)
    : (isWholeNumber ? currentValue <= line : currentValue < line);
  
  // For live bets: green if winning, red if losing (no yellow/orange for determined bets)
  // Only show orange/yellow if bet is still undetermined
  const progressColor = isWinning 
    ? 'bg-green-500 dark:bg-green-400' 
    : 'bg-red-500 dark:bg-red-400';

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center justify-between text-[9px] md:text-[10px]">
        <span className="text-slate-600 dark:text-slate-400">
          Live: <span className="font-semibold text-orange-600 dark:text-orange-400">{currentValue.toFixed(1)}</span> / {line} {formatStatType(statType)}
        </span>
        <span className={`font-medium ${isWinning ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
          {overUnder === 'over' ? (currentValue >= line ? '✓' : '→') : (currentValue <= line ? '✓' : '→')}
        </span>
      </div>
      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <div 
          className={`h-full ${progressColor} transition-all duration-500 ease-out`}
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
      </div>
    </div>
  );
}

// Final Stats Indicator Component (for completed bets)
function FinalStatsIndicator({ 
  actualValue, 
  line, 
  statType, 
  overUnder,
  result
}: { 
  actualValue: number; 
  line: number; 
  statType: string; 
  overUnder: 'over' | 'under';
  result: 'win' | 'loss' | 'void' | 'pending';
}) {
  const isWholeNumber = line % 1 === 0;
  const isWinning = overUnder === 'over' 
    ? (isWholeNumber ? actualValue >= line : actualValue > line)
    : (isWholeNumber ? actualValue <= line : actualValue < line);
  
  // Calculate progress percentage (same as live indicator)
  const progressPercent = Math.min(100, (actualValue / line) * 100);
  
  const progressColor = isWinning 
    ? 'bg-green-500 dark:bg-green-400' 
    : 'bg-red-500 dark:bg-red-400';

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center justify-between text-[9px] md:text-[10px]">
        <span className="text-slate-600 dark:text-slate-400">
          Final: <span className={`font-semibold ${isWinning ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{actualValue.toFixed(1)}</span> / {line} {formatStatType(statType)}
        </span>
        <span className={`font-medium ${isWinning ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {isWinning ? '✓' : '✗'}
        </span>
      </div>
      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <div 
          className={`h-full ${progressColor} transition-all duration-500 ease-out`}
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
      </div>
    </div>
  );
}
