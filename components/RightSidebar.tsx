"use client";

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useTrackedBets } from "../contexts/TrackedBetsContext";
import { Plus, X, TrendingUp, History, Target, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { formatOdds } from "@/lib/currencyUtils";
import { StatTrackrLogoWithText } from "./StatTrackrLogo";
import { getEspnLogoUrl } from "@/lib/nbaAbbr";

interface JournalBet {
  id: string;
  date: string;
  sport: string;
  market?: string;
  selection: string;
  stake: number;
  odds: number;
  result: 'win' | 'loss' | 'void' | 'pending';
  status?: 'pending' | 'live' | 'completed';
  currency: string;
  opponent?: string;
  team?: string;
}

type TabType = 'tracked' | 'journal';

interface RightSidebarProps {
  oddsFormat?: 'american' | 'decimal';
  isMobileView?: boolean;
  showProfileIcon?: boolean;
  avatarUrl?: string | null;
  username?: string | null;
  userEmail?: string | null;
  isPro?: boolean;
  onProfileMenuClick?: () => void;
  showProfileMenu?: boolean;
  profileMenuRef?: React.RefObject<HTMLDivElement | null>;
  onSubscriptionClick?: () => void;
  onSignOutClick?: () => void;
}

export default function RightSidebar({ 
  oddsFormat = 'decimal', 
  isMobileView = false,
  showProfileIcon = false,
  avatarUrl = null,
  username = null,
  userEmail = null,
  isPro = false,
  onProfileMenuClick,
  showProfileMenu = false,
  profileMenuRef,
  onSubscriptionClick,
  onSignOutClick
}: RightSidebarProps = {}) {
  // Generate a consistent random color based on user's name/email
  const getAvatarColor = (name: string): string => {
    // Use a hash of the name to generate a consistent color
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Generate a vibrant color (avoid too light or too dark)
    const hue = Math.abs(hash) % 360;
    const saturation = 65 + (Math.abs(hash) % 20); // 65-85% saturation
    const lightness = 45 + (Math.abs(hash) % 15); // 45-60% lightness
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };
  
  const displayName = username || userEmail || 'User';
  const fallbackInitial = displayName?.trim().charAt(0)?.toUpperCase() || 'U';
  const avatarColor = !avatarUrl ? getAvatarColor(displayName) : undefined;
  const { isDark } = useTheme();
  const { trackedBets, removeTrackedBet, clearAllTrackedBets, refreshTrackedBets } = useTrackedBets();
  const [activeTab, setActiveTab] = useState<TabType>('tracked');
  const [journalBets, setJournalBets] = useState<JournalBet[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmRemoveJournalId, setConfirmRemoveJournalId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedStat, setSelectedStat] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('all');
  const [selectedBookmaker, setSelectedBookmaker] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [advancedTeamDropdownOpen, setAdvancedTeamDropdownOpen] = useState(false);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const PROPS_PER_PAGE = 15;

  // Handle image loading errors
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>, team: string) => {
    setImageErrors(prev => new Set(prev).add(team));
    // Hide the image if it fails to load
    e.currentTarget.style.display = 'none';
  };

  // Stat options for filtering
  const STAT_OPTIONS = [
    { value: 'all', label: 'All Stats' },
    { value: 'pts', label: 'Points' },
    { value: 'reb', label: 'Rebounds' },
    { value: 'ast', label: 'Assists' },
    { value: 'pr', label: 'Points + Rebounds' },
    { value: 'pra', label: 'Points + Rebounds + Assists' },
    { value: 'ra', label: 'Rebounds + Assists' },
    { value: 'stl', label: 'Steals' },
    { value: 'blk', label: 'Blocks' },
    { value: 'fg3m', label: '3-Pointers Made' },
  ];

  // Timeframe options
  const TIMEFRAME_OPTIONS = [
    { value: 'all', label: 'All Time' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
  ];

  // Bookmaker options
  const BOOKMAKER_OPTIONS = [
    'DraftKings',
    'FanDuel',
    'BetMGM',
    'Caesars',
    'BetRivers',
    'PointsBet',
    'Bet365',
    'Manual Entry'
  ];

  // NBA team abbreviation to full name mapping
  const TEAM_ABBREVIATIONS: Record<string, string> = {
    'ATL': 'Atlanta Hawks',
    'BOS': 'Boston Celtics',
    'BKN': 'Brooklyn Nets',
    'CHA': 'Charlotte Hornets',
    'CHI': 'Chicago Bulls',
    'CLE': 'Cleveland Cavaliers',
    'DAL': 'Dallas Mavericks',
    'DEN': 'Denver Nuggets',
    'DET': 'Detroit Pistons',
    'GSW': 'Golden State Warriors',
    'HOU': 'Houston Rockets',
    'IND': 'Indiana Pacers',
    'LAC': 'LA Clippers',
    'LAL': 'Los Angeles Lakers',
    'MEM': 'Memphis Grizzlies',
    'MIA': 'Miami Heat',
    'MIL': 'Milwaukee Bucks',
    'MIN': 'Minnesota Timberwolves',
    'NOP': 'New Orleans Pelicans',
    'NYK': 'New York Knicks',
    'OKC': 'Oklahoma City Thunder',
    'ORL': 'Orlando Magic',
    'PHI': 'Philadelphia 76ers',
    'PHX': 'Phoenix Suns',
    'POR': 'Portland Trail Blazers',
    'SAC': 'Sacramento Kings',
    'SAS': 'San Antonio Spurs',
    'TOR': 'Toronto Raptors',
    'UTA': 'Utah Jazz',
    'WAS': 'Washington Wizards',
  };

  // All NBA teams (full names)
  const ALL_NBA_TEAMS = Object.values(TEAM_ABBREVIATIONS).sort();

  // Prevent hydration mismatch by waiting for client mount
  useEffect(() => {
    setIsMounted(true);
    // Load saved tab preference
    const savedTab = localStorage.getItem('rightSidebar.activeTab');
    if (savedTab === 'journal' || savedTab === 'tracked') {
      setActiveTab(savedTab);
    }
    // Load tracked bets from Supabase on mount
    handleRefresh();
  }, []);

  // Save tab preference when it changes
  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('rightSidebar.activeTab', activeTab);
    }
  }, [activeTab, isMounted]);

  // Debug: Log when trackedBets changes
  useEffect(() => {
    console.log('RightSidebar: trackedBets updated:', trackedBets);
  }, [trackedBets]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    
    try {
      // First, trigger the check-tracked-bets API to update any completed games
      await fetch('/api/check-tracked-bets');
    } catch (error) {
      console.error('Failed to check tracked bets:', error);
      // Continue anyway to fetch current data
    }
    
    // Fetch tracked bets from Supabase
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsRefreshing(false);
      return;
    }

    const { data: trackedProps, error } = await (supabase
      .from('tracked_props') as any)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch tracked props:', error);
      setIsRefreshing(false);
      return;
    }

    if (trackedProps) {
      // Convert to TrackedBet format
      const bets = (trackedProps as any[]).map((prop: any) => {
        // Format stat type name for display
        const statDisplay = formatStatTypeName(prop.stat_type);
        
        return {
          id: prop.id,
          selection: `${prop.player_name} ${statDisplay} ${prop.over_under === 'over' ? 'Over' : 'Under'} ${prop.line}`,
          stake: 0,
          odds: prop.odds || 0,
          sport: 'NBA',
          playerName: prop.player_name,
          stat: prop.stat_type,
          line: prop.line,
          bookmaker: prop.bookmaker || null,
          isCustom: !prop.bookmaker, // If no bookmaker, it's custom
          gameStatus: prop.status === 'void' ? 'void' as const : prop.status === 'completed' ? 'completed' as const : prop.status === 'live' ? 'live' as const : 'scheduled' as const,
          result: prop.status === 'void' ? 'void' as const : prop.result || 'pending' as const,
          gameDate: prop.game_date,
          team: prop.team,
          opponent: prop.opponent,
          actualValue: prop.actual_value,
          actualPts: prop.actual_pts,
          actualReb: prop.actual_reb,
          actualAst: prop.actual_ast,
          actualStl: prop.actual_stl,
          actualBlk: prop.actual_blk,
          actualFg3m: prop.actual_fg3m,
        };
      });

      // Update context
      localStorage.setItem('trackedBets', JSON.stringify(bets));
      refreshTrackedBets();
    }
    
    setIsRefreshing(false);
  };

  // Fetch journal bets from Supabase
  const fetchJournalBets = async () => {
    setIsRefreshing(true);
    
    try {
      // First, trigger the check-journal-bets API to update any completed games
      await fetch('/api/check-journal-bets');
    } catch (error) {
      console.error('Failed to check journal bets:', error);
      // Continue anyway to fetch current data
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsRefreshing(false);
      return;
    }

    const { data, error } = await supabase
      .from('bets')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(15);

    if (error) {
      console.error('Failed to fetch journal bets:', error);
      setIsRefreshing(false);
      return;
    }

    if (data) {
      setJournalBets(data);
    }
    
    setIsRefreshing(false);
  };

  useEffect(() => {
    if (isMounted) {
      fetchJournalBets();
    }
  }, [isMounted]);

  const removeBet = async (id: string) => {
    // Remove from Supabase
    const { error } = await (supabase
      .from('tracked_props') as any)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete tracked prop:', error);
    }

    // Remove from context/localStorage
    removeTrackedBet(id);
    setConfirmRemoveId(null);
  };

  const removeJournalBet = async (id: string) => {
    // Remove from Supabase
    const { error } = await supabase
      .from('bets')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete journal bet:', error);
      alert('Failed to delete bet');
      return;
    }

    // Update local state
    setJournalBets((prev) => prev.filter((b) => b.id !== id));
    setConfirmRemoveJournalId(null);
  };

  const clearAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Delete all from Supabase
    const { error } = await (supabase
      .from('tracked_props') as any)
      .delete()
      .eq('user_id', user.id);

    if (error) {
      console.error('Failed to clear tracked props:', error);
    }

    // Clear from context/localStorage
    clearAllTrackedBets();
    setConfirmClearAll(false);
  };

  // Helper function to format stat type display name
  const formatStatTypeName = (statType: string) => {
    const type = statType.toLowerCase();
    switch (type) {
      case 'pts': return 'Points';
      case 'reb': return 'Rebounds';
      case 'ast': return 'Assists';
      case 'stl': return 'Steals';
      case 'blk': return 'Blocks';
      case 'fg3m': return '3PM';
      // Keep combined stats as abbreviations
      case 'pra': return 'PRA';
      case 'pr': return 'PR';
      case 'ra': return 'RA';
      case 'pa': return 'PA';
      default: return statType.toUpperCase();
    }
  };

  // Helper function to format stat breakdown for combined stats
  const formatStatBreakdown = (bet: any) => {
    if (!bet.stat || bet.actualValue === undefined) return null;

    const statType = bet.stat.toLowerCase();

    // For combined stats, show the breakdown
    if (statType === 'pra' && bet.actualPts !== undefined && bet.actualReb !== undefined && bet.actualAst !== undefined) {
      return `${bet.actualPts} PTS, ${bet.actualReb} REB, ${bet.actualAst} AST (${bet.actualValue})`;
    }
    if (statType === 'pr' && bet.actualPts !== undefined && bet.actualReb !== undefined) {
      return `${bet.actualPts} PTS, ${bet.actualReb} REB (${bet.actualValue})`;
    }
    if (statType === 'ra' && bet.actualReb !== undefined && bet.actualAst !== undefined) {
      return `${bet.actualReb} REB, ${bet.actualAst} AST (${bet.actualValue})`;
    }

    // For single stats, just show the value and stat type
    return `${bet.actualValue} ${bet.stat.toUpperCase()}`;
  };

  // Filter bets by timeframe
  const timeframeFilteredBets = useMemo(() => {
    if (selectedTimeframe === 'all') return trackedBets;
    
    const now = new Date();
    const daysAgo = selectedTimeframe === '7d' ? 7 : selectedTimeframe === '30d' ? 30 : 90;
    const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    
    return trackedBets.filter(bet => {
      if (!bet.gameDate) return true;
      const betDate = new Date(bet.gameDate);
      return betDate >= cutoffDate;
    });
  }, [trackedBets, selectedTimeframe]);

  // Get prop counts for opponent teams that have props (keep abbreviations)
  const teamPropCounts = useMemo(() => {
    const teamMap = new Map<string, number>();
    timeframeFilteredBets.forEach(bet => {
      if (bet.opponent) {
        teamMap.set(bet.opponent, (teamMap.get(bet.opponent) || 0) + 1);
      }
    });
    return teamMap;
  }, [timeframeFilteredBets]);

  // Get prop counts for bookmakers
  const bookmakerPropCounts = useMemo(() => {
    const bookmakerMap = new Map<string, number>();
    timeframeFilteredBets.forEach(bet => {
      const bookmaker = bet.bookmaker || 'Manual Entry';
      bookmakerMap.set(bookmaker, (bookmakerMap.get(bookmaker) || 0) + 1);
    });
    return bookmakerMap;
  }, [timeframeFilteredBets]);
  
  // All NBA teams with counts (showing count only if > 0)
  // Teams with props first, then remaining NBA teams
  const allTeamsWithCounts = useMemo(() => {
    // Get teams that actually have props (from database - keep abbreviations)
    const teamsWithProps = Array.from(teamPropCounts.keys()).map(team => ({
      team,
      count: teamPropCounts.get(team) || 0,
    })).sort((a, b) => a.team.localeCompare(b.team));
    
    // Get remaining NBA teams that don't have props yet (use abbreviations)
    const teamsWithPropsSet = new Set(teamsWithProps.map(t => t.team));
    const allAbbreviations = Object.keys(TEAM_ABBREVIATIONS).sort();
    const teamsWithoutProps = allAbbreviations
      .filter(abbr => !teamsWithPropsSet.has(abbr))
      .map(abbr => ({ team: abbr, count: 0 }));
    
    // Combine: teams with props first, then teams without props
    return [...teamsWithProps, ...teamsWithoutProps];
  }, [teamPropCounts]);

  // Filter bets by selected stat, opponent team, and timeframe for advanced stats
  const statFilteredBets = useMemo(() => {
    let filtered = timeframeFilteredBets;
    
    // Filter by stat
    if (selectedStat !== 'all') {
      filtered = filtered.filter(bet => bet.stat === selectedStat);
    }
    
    // Filter by opponent team
    if (selectedTeam !== 'all') {
      filtered = filtered.filter(bet => bet.opponent === selectedTeam);
    }
    
    return filtered;
  }, [timeframeFilteredBets, selectedStat, selectedTeam]);
  
  const resultedBets = statFilteredBets.filter(bet => bet.result === 'win' || bet.result === 'loss').length;
  const wins = statFilteredBets.filter(bet => bet.result === 'win').length;
  const losses = statFilteredBets.filter(bet => bet.result === 'loss').length;
  const winRate = resultedBets > 0 ? ((wins / resultedBets) * 100).toFixed(1) : '0.0';
  
  // Over/Under breakdown
  const overBets = statFilteredBets.filter(bet => bet.selection?.toLowerCase().includes('over'));
  const overResulted = overBets.filter(bet => bet.result === 'win' || bet.result === 'loss').length;
  const overWins = overBets.filter(bet => bet.result === 'win').length;
  const overLosses = overBets.filter(bet => bet.result === 'loss').length;
  const overWinRate = overResulted > 0 ? ((overWins / overResulted) * 100).toFixed(1) : '0.0';
  
  const underBets = statFilteredBets.filter(bet => bet.selection?.toLowerCase().includes('under'));
  const underResulted = underBets.filter(bet => bet.result === 'win' || bet.result === 'loss').length;
  const underWins = underBets.filter(bet => bet.result === 'win').length;
  const underLosses = underBets.filter(bet => bet.result === 'loss').length;
  const underWinRate = underResulted > 0 ? ((underWins / underResulted) * 100).toFixed(1) : '0.0';
  
  // Winners by Odds ranges (in decimal odds)
  const oddsRanges = [
    { label: '1.00-1.50', min: 1.0, max: 1.5 },
    { label: '1.51-2.00', min: 1.51, max: 2.0 },
    { label: '2.01-2.50', min: 2.01, max: 2.5 },
    { label: '2.51-3.00', min: 2.51, max: 3.0 },
    { label: '3.01-5.00', min: 3.01, max: 5.0 },
    { label: '5.01-10.00', min: 5.01, max: 10.0 },
    { label: '10.00+', min: 10.01, max: Infinity },
  ];
  
  const getOddsRangeStats = (min: number, max: number) => {
    const betsInRange = statFilteredBets.filter(bet => {
      const odds = bet.odds;
      return odds >= min && odds <= max && (bet.result === 'win' || bet.result === 'loss');
    });
    const wins = betsInRange.filter(bet => bet.result === 'win').length;
    const losses = betsInRange.filter(bet => bet.result === 'loss').length;
    const total = betsInRange.length;
    return { wins, losses, total, winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0' };
  };
  
  // Bookmaker Performance breakdown
  const bookmakerStats = useMemo(() => {
    // List of all bookmakers we're fetching from
    const allBookmakers = [
      'DraftKings',
      'FanDuel', 
      'BetMGM',
      'Caesars',
      'BetRivers',
      'PointsBet',
      'Bet365',
      'Manual Entry'
    ];
    
    const bookmakerMap = new Map<string, { wins: number; losses: number; total: number }>();
    
    // Initialize all bookmakers with 0 stats
    allBookmakers.forEach(bookmaker => {
      bookmakerMap.set(bookmaker, { wins: 0, losses: 0, total: 0 });
    });
    
    // Count actual bets
    for (const bet of statFilteredBets) {
      if (bet.result !== 'win' && bet.result !== 'loss') continue;
      
      const bookmaker = bet.bookmaker || 'Manual Entry';
      const current = bookmakerMap.get(bookmaker) || { wins: 0, losses: 0, total: 0 };
      
      if (bet.result === 'win') current.wins++;
      if (bet.result === 'loss') current.losses++;
      current.total++;
      
      bookmakerMap.set(bookmaker, current);
    }
    
    const result = Array.from(bookmakerMap.entries())
      .map(([bookmaker, stats]) => ({
        bookmaker,
        wins: stats.wins,
        losses: stats.losses,
        total: stats.total,
        hitRate: stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : '0.0'
      }))
      .sort((a, b) => {
        // Manual Entry always last
        if (a.bookmaker === 'Manual Entry') return 1;
        if (b.bookmaker === 'Manual Entry') return -1;
        // Sort others by most used
        return b.total - a.total;
      });
    
    return result;
  }, [statFilteredBets]);
  
  // Filter bets by search query, opponent team, bookmaker, and timeframe
  const filteredBets = useMemo(() => {
    let filtered = timeframeFilteredBets;
    
    // Filter by opponent team
    if (selectedTeam !== 'all') {
      filtered = filtered.filter(bet => bet.opponent === selectedTeam);
    }
    
    // Filter by bookmaker
    if (selectedBookmaker !== 'all') {
      filtered = filtered.filter(bet => {
        const betBookmaker = bet.bookmaker || 'Manual Entry';
        return betBookmaker === selectedBookmaker;
      });
    }
    
    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(bet => 
        bet.playerName?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        bet.selection?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  }, [timeframeFilteredBets, searchQuery, selectedTeam, selectedBookmaker]);
  
  // Pagination calculations
  const totalPages = Math.ceil(filteredBets.length / PROPS_PER_PAGE);
  const startIndex = (currentPage - 1) * PROPS_PER_PAGE;
  const endIndex = startIndex + PROPS_PER_PAGE;
  const paginatedBets = filteredBets.slice(startIndex, endIndex);
  
  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const getResultColor = (result: string) => {
    switch(result) {
      case 'win': return 'text-emerald-600 dark:text-emerald-400';
      case 'loss': return 'text-red-600 dark:text-red-400';
      case 'pending': return 'text-yellow-600 dark:text-yellow-400';
      case 'void': return 'text-gray-600 dark:text-gray-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getResultBadge = (result: string) => {
    switch(result) {
      case 'win': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
      case 'loss': return 'bg-red-500/10 text-red-600 dark:text-red-400';
      case 'pending': return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';
      case 'void': return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
      default: return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
    }
  };

  // Check if any filters are active
  const hasActiveFilters = selectedTeam !== 'all' || selectedBookmaker !== 'all' || selectedTimeframe !== 'all';

  // Clear all filters
  const clearFilters = () => {
    setSelectedTeam('all');
    setSelectedBookmaker('all');
    setSelectedTimeframe('all');
  };

  return (
    <div
      className={isMobileView 
        ? "flex flex-col w-full h-full bg-white dark:bg-slate-900"
        : "hidden lg:flex fixed top-4 h-[calc(100vh-1rem)] bg-gray-300 dark:bg-slate-900 border-l border-gray-200 dark:border-gray-700 flex-col rounded-l-2xl shadow-xl"
      }
      style={isMobileView ? {} : {
        marginRight: '0px',
        width: 'var(--right-panel-width, 360px)',
        right: 'clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px)'
      }}
    >
      {/* Profile Icon - Above Tabs */}
      {showProfileIcon && !isMobileView && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Your Props</h2>
          <div className="relative" ref={profileMenuRef}>
            <button
              data-profile-button
              onClick={onProfileMenuClick}
              className="w-10 h-10 rounded-full hover:opacity-90 transition-opacity border border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden"
              style={avatarColor ? { backgroundColor: avatarColor } : avatarUrl ? {} : { backgroundColor: 'rgb(243, 244, 246)' }}
            >
              {avatarUrl ? (
                <img 
                  src={avatarUrl} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-sm font-semibold text-white">
                  {fallbackInitial}
                </span>
              )}
            </button>
            
            {/* Profile Menu Dropdown */}
            {showProfileMenu && (
              <div data-profile-menu className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                {/* Username display */}
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Logged in as</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{username || userEmail || 'User'}</p>
                </div>
                
                {/* Menu Items */}
                <div className="py-2">
                  <button
                    type="button"
                    onClick={onSubscriptionClick}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    Subscription
                  </button>
                </div>
                
                {/* Logout button */}
                <div className="border-t border-gray-200 dark:border-gray-700 py-2">
                  <button
                    type="button"
                    onClick={onSignOutClick}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Header with Tabs */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 text-black dark:text-white">
        {showAdvanced ? (
          // Advanced Stats Header
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Advanced Stats</h3>
              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-xs px-2 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
                <button
                  onClick={() => setShowAdvanced(false)}
                  className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
                >
                  Back to Tracking
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setActiveTab('journal')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'journal'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <History className="w-4 h-4" />
                Journal
              </button>
              <button
                onClick={() => setActiveTab('tracked')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'tracked'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <Target className="w-4 h-4" />
                Tracking
              </button>
            </div>
            
            {activeTab === 'tracked' && (
          <>
            {/* Stats and Actions */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {isMounted ? trackedBets.length : 0} prop{(isMounted ? trackedBets.length : 0) !== 1 ? 's' : ''} tracked
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {isMounted ? resultedBets : 0} resulted
                </div>
              </div>
              <div className="flex gap-2">
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-xs px-2 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="text-xs px-2 py-1 rounded-lg bg-purple-500/10 text-purple-500 dark:text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center gap-1 disabled:opacity-50"
                  title="Refresh tracked bets"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              {isMounted && trackedBets.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setConfirmClearAll(true)}
                    className="text-xs px-2 py-1 rounded-lg bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    Clear All
                  </button>
                  {confirmClearAll && (
                    <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-50 min-w-[200px]">
                      <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">
                        Remove all {trackedBets.length} bets?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={clearAll}
                          className="flex-1 text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => setConfirmClearAll(false)}
                          className="flex-1 text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>
            </div>
            
            {/* Search Bar */}
            {isMounted && trackedBets.length > 0 && (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search players..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 rounded-lg text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                
                {/* Filters - Horizontal Layout - All 3 in one row */}
                <div className="flex items-start gap-2 mb-3">
                  {/* Team Filter with Counts */}
                  <div className="flex-[1.3] min-w-[100px] relative z-50">
                    <button
                      onClick={() => setTeamDropdownOpen(!teamDropdownOpen)}
                      className="w-full h-[38px] flex items-center justify-between gap-2 px-3 rounded-lg border text-sm bg-gray-100 dark:bg-slate-700 border-gray-200 dark:border-gray-600 text-black dark:text-white"
                    >
                      <span className="flex items-center gap-2">
                        {selectedTeam !== 'all' && !imageErrors.has(selectedTeam) && (
                          <img 
                            src={getEspnLogoUrl(selectedTeam)} 
                            alt={selectedTeam} 
                            className="w-5 h-5 object-contain" 
                            onError={(e) => handleImageError(e, selectedTeam)}
                          />
                        )}
                        <span className="font-semibold">
                          {selectedTeam === 'all' ? `All Opp (${timeframeFilteredBets.length})` : selectedTeam}
                        </span>
                      </span>
                      <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    {teamDropdownOpen && (
                      <>
                        <div className="absolute z-[100] mt-1 left-0 right-0 rounded-md border shadow-lg overflow-hidden bg-gray-100 dark:bg-slate-700 border-gray-200 dark:border-gray-600">
                          <div className="max-h-56 overflow-y-auto custom-scrollbar overscroll-contain">
                            <button
                              onClick={() => { setSelectedTeam('all'); setTeamDropdownOpen(false); }}
                              className="w-full flex items-center gap-2 px-2 py-2 text-sm text-left hover:bg-gray-200 dark:hover:bg-gray-600 text-black dark:text-white"
                            >
                              <span className="font-medium">All Opp ({timeframeFilteredBets.length})</span>
                            </button>
                            {allTeamsWithCounts.map(({ team, count }) => (
                              <button
                                key={team}
                                onClick={() => { setSelectedTeam(team); setTeamDropdownOpen(false); }}
                                className="w-full flex items-center gap-2 px-2 py-2 text-sm text-left hover:bg-gray-200 dark:hover:bg-gray-600 text-black dark:text-white"
                              >
                                {!imageErrors.has(team) && (
                                  <img 
                                    src={getEspnLogoUrl(team)} 
                                    alt={team} 
                                    className="w-5 h-5 object-contain" 
                                    onError={(e) => handleImageError(e, team)}
                                  />
                                )}
                                <span className="font-medium">{count > 0 ? `${team} (${count})` : team}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="fixed inset-0 z-[90]" onClick={() => setTeamDropdownOpen(false)} />
                      </>
                    )}
                  </div>
                  
                  {/* Bookmaker Filter with Counts */}
                  <select
                    value={selectedBookmaker}
                    onChange={(e) => setSelectedBookmaker(e.target.value)}
                    className="flex-[1.35] min-w-[125px] h-[38px] px-3 text-sm bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="all">All Bookmakers ({timeframeFilteredBets.length})</option>
                    {BOOKMAKER_OPTIONS.map(bookmaker => {
                      const count = bookmakerPropCounts.get(bookmaker) || 0;
                      return (
                        <option key={bookmaker} value={bookmaker}>
                          {count > 0 ? `${bookmaker} (${count})` : bookmaker}
                        </option>
                      );
                    })}
                  </select>
                  
                  {/* Timeframe Filter */}
                  <select
                    value={selectedTimeframe}
                    onChange={(e) => setSelectedTimeframe(e.target.value)}
                    className="flex-[0.8] min-w-[90px] h-[38px] px-3 text-sm bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-gray-600 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {TIMEFRAME_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </>
        )}
            
            {activeTab === 'journal' && (
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  Last 15 bets
                </div>
                <button
                  onClick={fetchJournalBets}
                  disabled={isRefreshing}
                  className="text-xs px-2 py-1 rounded-lg bg-purple-500/10 text-purple-500 dark:text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center gap-1 disabled:opacity-50"
                  title="Refresh journal"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {showAdvanced ? (
          // Advanced Stats View
          <div className="p-3 flex flex-col gap-1 h-full">
            {/* Win Rate Progress Bar - At the top */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-black dark:text-white">Overall Win Rate</h4>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {resultedBets} props ({wins}-{losses})
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6 relative">
                <div 
                  className={`h-6 rounded-full transition-all duration-500 flex items-center justify-end pr-2 ${
                    parseFloat(winRate) <= 29 
                      ? 'bg-gradient-to-r from-red-500 to-red-600' 
                      : parseFloat(winRate) <= 49 
                      ? 'bg-gradient-to-r from-orange-500 to-amber-600' 
                      : 'bg-gradient-to-r from-green-500 to-emerald-600'
                  }`}
                  style={{ width: `${Math.max(parseFloat(winRate), 0)}%`, minWidth: winRate !== '0.0' ? 'auto' : '0' }}
                >
                  {parseFloat(winRate) > 5 && (
                    <span className="text-xs font-bold text-white">{winRate}%</span>
                  )}
                </div>
                {parseFloat(winRate) <= 5 && parseFloat(winRate) > 0 && (
                  <span className="absolute left-2 top-1/2 transform -translate-y-1/2 text-xs font-bold text-gray-700 dark:text-gray-300">{winRate}%</span>
                )}
                {parseFloat(winRate) === 0 && (
                  <span className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 text-xs font-bold text-gray-700 dark:text-gray-300">0.0%</span>
                )}
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-gray-600 dark:text-gray-400">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
            
            {/* Over vs Under Performance */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex-shrink-0">
              <h4 className="text-xs font-semibold text-black dark:text-white mb-2 text-center">Over vs Under</h4>
              <div className="flex items-start gap-2">
                {/* Over Side */}
                <div className="flex-1 space-y-2">
                  <div className="text-xs font-medium text-blue-600 dark:text-blue-400 text-center mb-1">Over</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="text-xs font-bold text-black dark:text-white">{overBets.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Record:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-green-600 dark:text-green-400">{overWins}</span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">-</span>
                      <span className="text-xs font-bold text-red-600 dark:text-red-400">{overLosses}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Hit Rate:</span>
                    <span className="text-sm font-bold text-black dark:text-white">{overWinRate}%</span>
                  </div>
                </div>
                
                {/* Divider with VS */}
                <div className="flex-shrink-0 flex items-center justify-center px-2">
                  <div className="relative">
                    <div className="h-20 w-px bg-gray-200 dark:bg-gray-700"></div>
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold">
                      VS
                    </div>
                  </div>
                </div>
                
                {/* Under Side */}
                <div className="flex-1 space-y-2">
                  <div className="text-xs font-medium text-purple-600 dark:text-purple-400 text-center mb-1">Under</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="text-xs font-bold text-black dark:text-white">{underBets.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Record:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-green-600 dark:text-green-400">{underWins}</span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">-</span>
                      <span className="text-xs font-bold text-red-600 dark:text-red-400">{underLosses}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Hit Rate:</span>
                    <span className="text-sm font-bold text-black dark:text-white">{underWinRate}%</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Bookmaker Performance */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700 flex-[1.5] min-h-0 flex flex-col overflow-y-auto custom-scrollbar">
              <h4 className="text-xs font-semibold text-black dark:text-white mb-1.5">Bookmaker Performance</h4>
              <div className="space-y-0.5 flex-1 flex flex-col justify-around">
                {bookmakerStats.map((stat) => (
                  <div key={stat.bookmaker} className="flex items-center gap-14">
                    <span className="text-xs font-medium text-purple-600 dark:text-purple-400 truncate w-[70px] flex-shrink-0">
                      {stat.bookmaker === 'Manual Entry' ? 'Manual' : stat.bookmaker}
                    </span>
                    <div className="flex items-center gap-1 text-xs w-[45px] flex-shrink-0">
                      <span className="font-bold text-green-600 dark:text-green-400">{stat.wins}</span>
                      <span className="text-gray-600 dark:text-gray-400">-</span>
                      <span className="font-bold text-red-600 dark:text-red-400">{stat.losses}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-12 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 flex-shrink-0">
                        <div 
                          className="bg-gradient-to-r from-green-500 to-emerald-600 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${stat.hitRate}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-black dark:text-white w-[38px] text-right flex-shrink-0">
                        {stat.hitRate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Winners by Odds */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700 flex-[1.8] min-h-0 flex flex-col">
              <h4 className="text-xs font-semibold text-black dark:text-white mb-1.5">Winners by Odds</h4>
              <div className="space-y-0.5 flex-1 flex flex-col justify-around">
                {oddsRanges.map((range) => {
                  const stats = getOddsRangeStats(range.min, range.max);
                  return (
                    <div key={range.label} className="flex items-center gap-14">
                      <span className="text-xs text-gray-600 dark:text-gray-400 w-[70px] flex-shrink-0">{range.label}:</span>
                      <div className="flex items-center gap-1 text-xs w-[45px] flex-shrink-0">
                        <span className="font-bold text-green-600 dark:text-green-400">{stats.wins}</span>
                        <span className="text-gray-600 dark:text-gray-400">-</span>
                        <span className="font-bold text-red-600 dark:text-red-400">{stats.losses}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-12 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 flex-shrink-0">
                          <div 
                            className="bg-gradient-to-r from-green-500 to-emerald-600 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${stats.winRate}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-black dark:text-white w-[38px] text-right flex-shrink-0">
                          {stats.winRate}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          activeTab === 'tracked' ? (
            !isMounted || trackedBets.length === 0 ? (
          <div className="p-4 text-center text-black dark:text-white opacity-70">
            <div className="text-sm">No bets tracked yet</div>
            <div className="text-xs mt-2">Add bets from the research pages to track them here</div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {paginatedBets.map((bet) => (
              <div
                key={bet.id}
                className={`bg-white dark:bg-slate-800 rounded-lg p-3 border-2 relative group ${
                  bet.result === 'win' 
                    ? 'border-green-500 dark:border-green-400' 
                    : bet.result === 'loss' 
                    ? 'border-red-500 dark:border-red-400' 
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                
                {/* Player Name + Date */}
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-bold text-black dark:text-white">{bet.playerName}</div>
                  {bet.gameDate && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(bet.gameDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                </div>
                
                {/* Prop Line */}
                <div className="text-xs text-black dark:text-white mb-2">
                  {bet.selection.replace('FG3M', '3PM')}
                </div>
                
                {/* Team vs Opponent */}
                {bet.team && bet.opponent && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                    {bet.team} vs {bet.opponent}
                  </div>
                )}
                
                <div className="flex items-center justify-between text-xs mb-2">
                  <div className="text-gray-600 dark:text-gray-400">
                    {bet.odds > 0 ? (
                      <>Odds: <span className="font-semibold text-black dark:text-white">{bet.odds.toFixed(2)}</span></>
                    ) : (
                      <span>&nbsp;</span>
                    )}
                  </div>
                  <div>
                    {bet.isCustom ? (
                      <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded text-xs font-medium">CUSTOM</span>
                    ) : bet.bookmaker ? (
                      <span className="font-semibold text-purple-600 dark:text-purple-400">{bet.bookmaker}</span>
                    ) : null}
                  </div>
                </div>
                
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs flex items-center justify-between">
                  {bet.gameStatus === 'completed' && !bet.result ? (
                    <span className="px-2 py-1 bg-gray-500/10 text-gray-600 dark:text-gray-400 rounded font-medium">
                      VOID
                    </span>
                  ) : bet.gameStatus === 'scheduled' ? (
                    <span className="px-2 py-1 bg-gray-500/10 text-gray-600 dark:text-gray-400 rounded font-medium">
                      SCHEDULED
                    </span>
                  ) : bet.gameStatus === 'live' && bet.result === 'pending' ? (
                    <span className="px-2 py-1 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded font-medium">
                      TRACKING
                    </span>
                  ) : bet.result === 'win' ? (
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded font-medium">
                        W
                      </span>
                      {formatStatBreakdown(bet) && (
                        <span className="text-black dark:text-white">
                          {formatStatBreakdown(bet)}
                        </span>
                      )}
                    </div>
                  ) : bet.result === 'loss' ? (
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-red-500/10 text-red-600 dark:text-red-400 rounded font-medium">
                        L
                      </span>
                      {formatStatBreakdown(bet) && (
                        <span className="text-black dark:text-white">
                          {formatStatBreakdown(bet)}
                        </span>
                      )}
                    </div>
                  ) : null}
                  
                  <button
                    onClick={() => setConfirmRemoveId(bet.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/10 rounded"
                    title="Remove bet"
                  >
                    <X className="w-4 h-4 text-red-500" />
                  </button>
                  {confirmRemoveId === bet.id && (
                    <div className="absolute bottom-2 right-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 z-50 min-w-[140px]">
                      <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">Remove bet?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => removeBet(bet.id)}
                          className="flex-1 text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmRemoveId(null)}
                          className="flex-1 text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              ))}
            </div>
            
            {/* Pagination Controls */}
            {filteredBets.length > PROPS_PER_PAGE && (
              <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between text-xs">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Prev
                  </button>
                  
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600 dark:text-gray-400">Page</span>
                    <span className="font-bold text-purple-600 dark:text-purple-400">{currentPage}</span>
                    <span className="text-gray-600 dark:text-gray-400">of</span>
                    <span className="font-bold text-purple-600 dark:text-purple-400">{totalPages}</span>
                  </div>
                  
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
                
                <div className="text-center mt-2 text-xs text-gray-600 dark:text-gray-400">
                  Showing {startIndex + 1}-{Math.min(endIndex, filteredBets.length)} of {filteredBets.length} props
                </div>
              </div>
            )}
          </div>
            )
          ) : activeTab === 'journal' ? (
          journalBets.length === 0 ? (
            <div className="p-4 text-center text-black dark:text-white opacity-70">
              <div className="text-sm">No bets in journal yet</div>
              <div className="text-xs mt-2">Add bets from the research pages to track your betting history</div>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {journalBets.slice(0, 15).map((bet) => {
                const profit = bet.result === 'win' ? bet.stake * (bet.odds - 1) : 0;
                const loss = bet.result === 'loss' ? bet.stake : 0;
                const canDelete = bet.status === 'pending' && bet.result === 'pending';
                
                return (
                  <div
                    key={bet.id}
                    className={`bg-white dark:bg-slate-800 rounded-lg p-3 border-2 relative group ${
                      bet.result === 'win' 
                        ? 'border-green-500 dark:border-green-400' 
                        : bet.result === 'loss' 
                        ? 'border-red-500 dark:border-red-400' 
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    
                    {/* Selection + Date */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-bold text-black dark:text-white flex-1 truncate">
                        {bet.selection}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        {new Date(bet.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    
                    {/* Market/Sport + Opponent */}
                    {(bet.market || bet.opponent) && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                        {bet.market}{bet.opponent && ` • vs ${bet.opponent}`}
                      </div>
                    )}
                    
                    {/* Stake, Odds, Currency */}
                    <div className="flex items-center justify-between text-xs mb-2">
                      <div className="text-gray-600 dark:text-gray-400">
                        Stake: <span className="font-semibold text-black dark:text-white">{bet.currency} ${bet.stake.toFixed(2)}</span>
                      </div>
                      <div className="text-gray-600 dark:text-gray-400">
                        Odds: <span className="font-semibold text-black dark:text-white">{bet.odds.toFixed(2)}</span>
                      </div>
                    </div>
                    
                    {/* Result + Return */}
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs">
                      {bet.status === 'pending' && bet.result === 'pending' ? (
                        <span className="px-2 py-1 bg-gray-500/10 text-gray-600 dark:text-gray-400 rounded font-medium">
                          SCHEDULED
                        </span>
                      ) : bet.status === 'live' && bet.result === 'pending' ? (
                        <span className="px-2 py-1 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded font-medium">
                          LIVE
                        </span>
                      ) : (
                        <span className={`px-2 py-1 rounded font-medium ${
                          bet.result === 'win' 
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400' 
                            : bet.result === 'loss' 
                            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                            : 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
                        }`}>
                          {bet.result === 'win' ? 'W' : bet.result === 'loss' ? 'L' : bet.result.toUpperCase()}
                        </span>
                      )}
                      
                      <div className="flex items-center gap-2">
                        {bet.result === 'win' && (
                          <span className="font-semibold text-green-600 dark:text-green-400">
                            +{bet.currency} ${profit.toFixed(2)}
                          </span>
                        )}
                        {bet.result === 'loss' && (
                          <span className="font-semibold text-red-600 dark:text-red-400">
                            -{bet.currency} ${loss.toFixed(2)}
                          </span>
                        )}
                        {bet.result === 'void' && (
                          <span className="font-semibold text-gray-600 dark:text-gray-400">
                            {bet.currency} $0.00
                          </span>
                        )}
                        {bet.result === 'pending' && bet.status !== 'pending' && bet.status !== 'live' && (
                          <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                            Pending
                          </span>
                        )}
                        
                        {canDelete && (
                          <>
                            <button
                              onClick={() => setConfirmRemoveJournalId(bet.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/10 rounded"
                              title="Remove bet"
                            >
                              <X className="w-4 h-4 text-red-500" />
                            </button>
                            {confirmRemoveJournalId === bet.id && (
                              <div className="absolute bottom-2 right-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 z-50 min-w-[140px]">
                                <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">Remove bet?</p>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => removeJournalBet(bet.id)}
                                    className="flex-1 text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    onClick={() => setConfirmRemoveJournalId(null)}
                                    className="flex-1 text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                  >
                                    No
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {journalBets.length > 15 && (
                <div className="text-center pt-2">
                  <a href="/journal" className="text-xs text-purple-600 dark:text-purple-400 hover:underline">
                    View all {journalBets.length} bets →
                  </a>
                </div>
              )}
            </div>
          )
          ) : null
        )}
      </div>
      
      {/* Tracking Record Footer */}
      {!showAdvanced && activeTab === 'tracked' && isMounted && resultedBets > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-slate-800/50">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Tracking Record</span>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="px-2 py-0.5 text-xs bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded hover:bg-purple-500/20 transition-colors"
                >
                  {showAdvanced ? 'Hide' : 'Advanced'}
                </button>
              </div>
              <span className="text-xs font-semibold text-black dark:text-white">{winRate}%</span>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600 dark:text-gray-400">Total Wins:</span>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">{wins}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600 dark:text-gray-400">Total Losses:</span>
                <span className="text-sm font-bold text-red-600 dark:text-red-400">{losses}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
