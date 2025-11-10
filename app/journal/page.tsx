"use client";

import { supabase } from "@/lib/supabaseClient";
import React, { Suspense, useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LeftSidebar from "@/components/LeftSidebar";
import RightSidebar from "@/components/RightSidebar";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { StatTrackrLogoWithText } from "@/components/StatTrackrLogo";
import { useTheme } from "@/contexts/ThemeContext";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from 'recharts';

export default function JournalPage() {
  return (
    <ThemeProvider>
      <Suspense fallback={<div className="min-h-screen bg-white dark:bg-gray-900" />}>
        <JournalContent />
      </Suspense>
    </ThemeProvider>
  );
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
  bookmaker?: string | null;
  created_at: string;
};

function JournalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [bets, setBets] = useState<Bet[]>([]);
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('decimal');
  const [showMobileTracking, setShowMobileTracking] = useState(false);
  const [isWideDesktop, setIsWideDesktop] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'yearly'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('journal-dateRange') as 'all' | 'daily' | 'weekly' | 'monthly' | 'yearly') || 'all';
    }
    return 'all';
  });
  const [currency, setCurrency] = useState<'USD' | 'AUD' | 'GBP' | 'EUR'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('journal-currency') as 'USD' | 'AUD' | 'GBP' | 'EUR') || 'USD';
    }
    return 'USD';
  });
  
  const currencySymbols: Record<typeof currency, string> = {
    USD: '$',
    AUD: 'A$',
    GBP: '£',
    EUR: '€'
  };
  const formatCurrency = (value: number, showSign = false) => {
    const sign = showSign && value !== 0 ? (value > 0 ? '+' : '-') : '';
    return `${sign}${currencySymbols[currency]}${Math.abs(value).toFixed(2)}`;
  };
  const [sport, setSport] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('journal-sport') || 'All';
    }
    return 'All';
  });
  const [bookmaker, setBookmaker] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('journal-bookmaker') || 'All';
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
  
  // Save all filter preferences to localStorage
  useEffect(() => {
    localStorage.setItem('journal-dateRange', dateRange);
  }, [dateRange]);
  
  useEffect(() => {
    localStorage.setItem('journal-currency', currency);
  }, [currency]);
  
  useEffect(() => {
    localStorage.setItem('journal-sport', sport);
  }, [sport]);
  
  useEffect(() => {
    localStorage.setItem('journal-bookmaker', bookmaker);
  }, [bookmaker]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateWidthFlag = () => {
      setIsWideDesktop(window.innerWidth >= 1536);
    };
    updateWidthFlag();
    window.addEventListener('resize', updateWidthFlag);
    return () => window.removeEventListener('resize', updateWidthFlag);
  }, []);
  
  // Check URL params for tab selection
  useEffect(() => {
    if (!searchParams) return;
    const tab = searchParams.get('tab');
    if (tab === 'tracking') {
      setShowMobileTracking(true);
    }
  }, [searchParams]);

  // Fetch bets from Supabase
  useEffect(() => {
    async function loadData() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/");
        return;
      }

      // Fetch bets
      const { data, error } = await supabase
        .from('bets')
        .select('*')
        .order('date', { ascending: false });

      if (error) {
        console.error('Error fetching bets:', error);
      } else {
        setBets(data || []);
      }

      setLoading(false);
    }
    loadData();
  }, [router]);

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
  const filteredBets = useMemo(() => {
    let filtered = bets;

    // Filter by sport
    if (sport !== 'All') {
      filtered = filtered.filter(bet => bet.sport === sport);
    }

    // Filter by selected calendar date
    if (selectedDate && selectedDateType) {
      filtered = filtered.filter(bet => {
        const betDate = new Date(bet.date);
        
        if (selectedDateType === 'day') {
          // Match exact day
          return betDate.toDateString() === selectedDate.toDateString();
        } else if (selectedDateType === 'week') {
          // Match week - use the same calculation as calendar
          const weekStart = new Date(selectedDate);
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
          const betDateTime = betDate.getTime();
          return betDateTime >= weekStart.getTime() && betDateTime <= weekEnd.getTime();
        } else if (selectedDateType === 'month') {
          // Match month and year
          return betDate.getMonth() === selectedDate.getMonth() && 
                 betDate.getFullYear() === selectedDate.getFullYear();
        } else if (selectedDateType === 'year') {
          // Match year
          return betDate.getFullYear() === selectedDate.getFullYear();
        }
        return true;
      });
    } else {
      // Filter by date range when no specific date selected
      const now = new Date();
      if (dateRange !== 'all') {
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
    }

    return filtered;
  }, [bets, sport, dateRange, selectedDate, selectedDateType]);

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
      
      const bookmakerId = bet.bookmaker || 'Unknown';
      bookmakerData[bookmakerId] = (bookmakerData[bookmakerId] || 0) + profit;
    });
    
    let result = Object.entries(bookmakerData)
      .map(([bookmaker, profit]) => ({ bookmaker, profit }))
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
      
      const marketType = bet.market || 'Other';
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

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-slate-900 dark:text-white overflow-x-hidden">
      <style jsx global>{`
        :root {
          --sidebar-width: 360px;
          --right-panel-width: 400px;
          --gap-size: 6px;
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
      
      {/* Left Sidebar - Visible only on wide desktops */}
      {isWideDesktop && (
        <div className="hidden 2xl:block">
          <LeftSidebar oddsFormat={oddsFormat} setOddsFormat={setOddsFormat} />
        </div>
      )}
      
      {/* Center Content - Desktop */}
      <div 
        className="custom-scrollbar hidden lg:block"
        style={{
          position: 'fixed',
          left: isWideDesktop
            ? 'calc(clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px) + var(--sidebar-width) + var(--gap-size))'
            : '16px',
          right: isWideDesktop
            ? 'calc(clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px) + var(--right-panel-width) + var(--gap-size))'
            : '16px',
          top: '16px',
          paddingTop: '0',
          paddingBottom: '2px',
          height: 'calc(100vh - 16px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          zIndex: 0
        }}
      >
            {/* Full-width container spanning from left sidebar to right sidebar */}
            <div className="w-full bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 shadow-md dark:shadow-slate-900/40 flex flex-col p-3 md:p-4 lg:p-5 gap-3">
              {/* Top half - StatTrackr logo and filters */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
                  <div className="flex items-center gap-3 md:gap-4">
                    <StatTrackrLogoWithText 
                      logoSize="w-8 h-8 lg:w-9 lg:h-9" 
                      textSize="text-xl lg:text-2xl" 
                      isDark={isDark}
                      className="shrink-0"
                    />
                    <div className="flex items-center gap-2 md:gap-3">
                      <span className="text-xs md:text-sm font-medium text-slate-600 dark:text-white">Currency</span>
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as typeof currency)}
                        className="h-8 px-2 rounded-lg text-xs md:text-sm bg-emerald-600 text-white border-none focus:ring-2 focus:ring-emerald-400 focus:outline-none font-medium"
                      >
                        <option value="USD">USD</option>
                        <option value="AUD">AUD</option>
                        <option value="GBP">GBP</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                  </div>

                  {/* Filters Section */}
                  <div className="flex flex-wrap items-center gap-2 md:gap-3">
                    <span className="text-xs md:text-sm font-medium text-slate-600 dark:text-white">Filters</span>

                    {/* Sport Dropdown */}
                    <select
                      value={sport}
                      onChange={(e) => setSport(e.target.value)}
                      className="h-8 px-2 rounded-lg text-xs md:text-sm bg-white dark:bg-gray-700 text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    >
                      <option value="All">All Sports</option>
                      <option value="NBA">NBA</option>
                    </select>

                    {/* Bookmaker Dropdown */}
                    <select
                      value={bookmaker}
                      onChange={(e) => setBookmaker(e.target.value)}
                      className="h-8 px-2 rounded-lg text-xs md:text-sm bg-white dark:bg-gray-700 text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    >
                      <option value="All">All Bookmakers</option>
                      <option value="DraftKings">DraftKings</option>
                      <option value="FanDuel">FanDuel</option>
                      <option value="BetMGM">BetMGM</option>
                      <option value="Caesars">Caesars</option>
                      <option value="BetRivers">BetRivers</option>
                      <option value="PointsBet">PointsBet</option>
                      <option value="Bet365">Bet365</option>
                    </select>
                  </div>
                </div>

                {/* Timeframe Controls */}
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                  <span className="text-xs md:text-sm font-medium text-slate-600 dark:text-white">Timeframe</span>
                  <select
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
                    className="w-full sm:hidden h-8 px-2 rounded-lg text-xs bg-white dark:bg-gray-700 text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  >
                    {(['all', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((range) => (
                      <option key={range} value={range}>
                        {range.charAt(0).toUpperCase() + range.slice(1)}
                      </option>
                    ))}
                  </select>
                  <div className="hidden sm:flex flex-wrap gap-1.5 md:gap-2">
                    {(['all', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((range) => (
                      <button
                        key={range}
                        onClick={() => setDateRange(range)}
                        className={`px-2.5 py-1.5 md:px-3 md:py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all ${
                          dateRange === range
                            ? 'bg-purple-600 text-white shadow-md'
                            : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white'
                        }`}
                      >
                        {range.charAt(0).toUpperCase() + range.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {!isWideDesktop && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => setShowMobileTracking(true)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium text-purple-600 bg-white hover:bg-purple-50 border border-purple-200 shadow-sm transition-colors dark:bg-gray-800 dark:text-purple-300 dark:border-purple-500/40 dark:hover:bg-gray-700"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-5-5.917V4a2 2 0 10-4 0v1.083A6 6 0 004 11v3.159c0 .538-.214 1.055-.595 1.436L2 17h5m4 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                      View Tracking
                    </button>
                  </div>
                )}
              </div>
               
               {/* Bottom half - stat summary */}
               <div className="border-t border-slate-200 dark:border-gray-700/50 pt-3">
                 <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 md:gap-3">
                  {/* Total P&L */}
                  <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 p-3 md:p-3.5 flex flex-col gap-2 shadow-sm">
                    <span className="text-xs md:text-sm font-medium text-slate-500 dark:text-white">Total P&L ({currency})</span>
                    <span
                      className={`text-lg md:text-xl font-semibold ${
                        stats.totalPL > 0 ? 'text-green-600 dark:text-green-400' :
                        stats.totalPL < 0 ? 'text-red-600 dark:text-red-400' :
                        'text-slate-900 dark:text-white'
                      }`}
                    >
                      {formatCurrency(stats.totalPL, true)}
                    </span>
                  </div>

                  {/* Total Staked */}
                  <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 p-3 md:p-3.5 flex flex-col gap-2 shadow-sm">
                    <span className="text-xs md:text-sm font-medium text-slate-500 dark:text-white">Total Staked ({currency})</span>
                    <span className="text-lg md:text-xl font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(stats.totalStaked)}
                    </span>
                  </div>

                  {/* Average Stake */}
                  <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 p-3 md:p-3.5 flex flex-col gap-2 shadow-sm">
                    <span className="text-xs md:text-sm font-medium text-slate-500 dark:text-white">Avg Stake ({currency})</span>
                    <span className="text-lg md:text-xl font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(stats.avgStake)}
                    </span>
                  </div>

                  {/* WIN % */}
                  <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 p-3 md:p-3.5 flex flex-col gap-2 shadow-sm">
                    <span className="text-xs md:text-sm font-medium text-slate-500 dark:text-white">WIN %</span>
                    <span className="text-lg md:text-xl font-semibold text-slate-900 dark:text-white">
                      {stats.winRate.toFixed(1)}%
                    </span>
                  </div>

                  {/* ROI */}
                  <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 p-3 md:p-3.5 flex flex-col gap-2 shadow-sm">
                    <span className="text-xs md:text-sm font-medium text-slate-500 dark:text-white">ROI</span>
                    <span
                      className={`text-lg md:text-xl font-semibold ${
                        stats.roi > 0 ? 'text-green-600 dark:text-green-400' :
                        stats.roi < 0 ? 'text-red-600 dark:text-red-400' :
                        'text-slate-900 dark:text-white'
                      }`}
                    >
                      {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
                    </span>
                  </div>

                  {/* Record */}
                  <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 p-3 md:p-3.5 flex flex-col gap-2 shadow-sm">
                    <span className="text-xs md:text-sm font-medium text-slate-500 dark:text-white">Record</span>
                    <div className="text-lg md:text-xl font-semibold flex items-center gap-1.5 text-slate-900 dark:text-white">
                      <span className="text-green-600 dark:text-green-400">{stats.wins}</span>
                      <span className="text-slate-400 dark:text-slate-500">-</span>
                      <span className="text-red-600 dark:text-red-400">{stats.losses}</span>
                      <span className="text-slate-400 dark:text-slate-500">-</span>
                      <span className="text-gray-500 dark:text-gray-400">{stats.voids}</span>
                    </div>
                </div>
              </div>
            </div>
          </div>

            {/* Chart and Bet History Row */}
            <div className="w-full mt-2 flex items-start gap-2">
              {/* Left Column - Chart and Two Containers */}
              <div className="flex-[3] flex flex-col gap-2">
              {/* Profit/Loss Chart */}
                <div className="chart-container-no-focus bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Profit/Loss Over Time</h3>
                <div className="w-full h-80 relative">
                  {/* Faint StatTrackr Logo Watermark */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                    <StatTrackrLogoWithText 
                      logoSize="w-32 h-32" 
                      textSize="text-5xl" 
                      isDark={isDark}
                      className="opacity-[0.02]"
                    />
                  </div>
                  <ResponsiveContainer width="100%" height="100%" className="relative z-10">
                    <LineChart
                      data={chartData}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <XAxis 
                        dataKey="bet" 
                        stroke={isDark ? '#ffffff' : '#000000'}
                        label={{ value: 'Number of Bets', position: 'insideBottom', offset: -5, fill: isDark ? '#ffffff' : '#000000' }}
                        tick={{ fill: isDark ? '#ffffff' : '#000000' }}
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

              {/* Two Containers Below Chart */}
              <div className="flex gap-2" style={{ height: '550px' }}>
                {/* Container 1 - Betting Calendar */}
                <div className="flex-1 bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Betting Calendar</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setCalendarView('day')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                          calendarView === 'day' 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                        }`}
                      >
                        Day
                      </button>
                      <button 
                        onClick={() => setCalendarView('week')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                          calendarView === 'week' 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                        }`}
                      >
                        Week
                      </button>
                      <button 
                        onClick={() => setCalendarView('month')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                          calendarView === 'month' 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                        }`}
                      >
                        Month
                      </button>
                      <button 
                        onClick={() => setCalendarView('year')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
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
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                          weekRange === '1-26' 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600'
                        }`}
                      >
                        Weeks 1-26
                      </button>
                      <button 
                        onClick={() => setWeekRange('27-52')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
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
                    
                    {/* Day headers - only for day view (shows days of month) */}
                    {calendarView === 'day' && (
                      <div className="grid grid-cols-7 gap-2 mb-2">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                          <div key={day} className="text-center text-xs font-medium text-slate-600 dark:text-slate-400">{day}</div>
                        ))}
                      </div>
                    )}
                    
                    {/* Calendar days */}
                    <div className={`grid h-full ${
                      calendarView === 'day' ? 'grid-cols-7 grid-rows-5 gap-2' :
                      calendarView === 'week' ? 'grid-cols-7 grid-rows-4 gap-2' :
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
                          className={`flex flex-col items-center justify-center rounded-lg ${calendarView === 'month' ? 'text-xs' : 'text-xs'} font-medium cursor-pointer transition-all hover:scale-105 ${
                            !item.day ? 'invisible' :
                            item.profit === 0 ? 'bg-slate-200 dark:bg-gray-700 text-slate-600 dark:text-slate-400' :
                            item.profit > 100 ? 'bg-green-600 dark:bg-green-500 text-white' :
                            item.profit > 0 ? 'bg-green-400 dark:bg-green-600 text-white' :
                            item.profit < -50 ? 'bg-red-600 dark:bg-red-500 text-white' :
                            'bg-red-400 dark:bg-red-600 text-white'
                          }`}
                        >
                          <span className={`${
                            calendarView === 'month' ? 'text-base font-bold' :
                            calendarView === 'year' ? 'text-base font-bold' :
                            'text-base'
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
                  <div className="flex items-center justify-center gap-4 text-xs mt-auto pt-2">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded bg-green-600"></div>
                      <span className="text-slate-600 dark:text-slate-400">Profit</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded bg-red-600"></div>
                      <span className="text-slate-600 dark:text-slate-400">Loss</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded bg-slate-200 dark:bg-gray-700"></div>
                      <span className="text-slate-600 dark:text-slate-400">No Bets</span>
                    </div>
                  </div>
                </div>

                {/* Container 2 - Profit by Bookmaker Bar Graph */}
                <div className="chart-container-no-focus flex-1 bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Profit by Bookmaker</h3>
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
                          margin={{ top: 40, right: 20, left: 20, bottom: 5 }}
                        >
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

          </div>

          {/* Bet History */}
          <div className="flex-1 bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-6 flex flex-col" style={{ height: '972px' }}>
                <div className="flex items-center justify-between mb-4 flex-shrink-0">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Bet History</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setBetHistoryPage(prev => Math.max(0, prev - 1))}
                      disabled={betHistoryPage === 0}
                      className="p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                      title="Previous"
                    >
                      <svg className="w-5 h-5 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/>
                      </svg>
                    </button>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {Math.min((betHistoryPage + 1) * 20, filteredBets.length)} of {filteredBets.length} bets
                    </span>
                    <button
                      onClick={() => setBetHistoryPage(prev => prev + 1)}
                      disabled={betHistoryPage >= Math.floor(filteredBets.length / 20)}
                      className="p-1 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                      title="Next"
                    >
                      <svg className="w-5 h-5 text-slate-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="space-y-3 overflow-y-auto flex-1">
                  {filteredBets.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                      <p className="text-lg mb-2">No bets found</p>
                      <p className="text-sm">Add your first bet to get started!</p>
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
                      
                      const betDate = new Date(bet.date);
                      const dateStr = betDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                      return (
                        <div key={bet.id} className={`p-3 rounded-lg border-2 ${
                          bet.result === 'pending' 
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400'
                            : bet.result === 'win' 
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-400'
                            : bet.result === 'void'
                            ? 'bg-gray-50 dark:bg-gray-900/20 border-gray-500 dark:border-gray-400'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400'
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{dateStr}</span>
                            {bet.result !== 'pending' && (
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
                            {bet.result === 'pending' && (
                              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">PENDING</span>
                            )}
                          </div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{bet.selection}</div>
                          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                            <span>Stake: {currency} ${convertedStake.toFixed(2)} {bet.currency !== currency && `(${bet.currency} $${bet.stake.toFixed(2)})`}</span>
                            <span>Odds: {bet.odds.toFixed(2)}</span>
                          </div>
                          {bet.market && (
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                              {bet.sport} • {bet.market}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
          </div>

        </div>

        {/* Full-Width Container Below - Spans entire width */}
        <div className="chart-container-no-focus w-full bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-6 mt-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Profit by Market</h3>
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
          <div className="w-full" style={{ height: '350px' }}>
            {profitByMarket.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                No market data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={profitByMarket}
                  layout="vertical"
                  margin={{ top: 5, right: 150, left: 80, bottom: 7 }}
                >
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
                    width={90}
                    tick={{ fill: isDark ? '#ffffff' : '#000000' }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: isDark ? '#4b5563' : '#9ca3af',
                      border: `1px solid ${isDark ? '#9ca3af' : '#9ca3af'}`,
                      borderRadius: '8px',
                      color: isDark ? '#FFFFFF' : '#000000'
                    }}
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

      {/* Mobile Content - Hidden when tracking is shown */}
      {!showMobileTracking && (
      <div className="lg:hidden w-full px-3 py-4 pb-20 space-y-2 overflow-y-auto">
        {/* 1. Top Stats Container */}
        <div className="w-full bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 flex flex-col">
          {/* Top half - StatTrackr logo and filters */}
          <div className="flex flex-col items-center px-4 pt-4 pb-3 space-y-3">
            <StatTrackrLogoWithText 
              logoSize="w-10 h-10" 
              textSize="text-2xl" 
              isDark={isDark}
            />
            
            {/* Currency Converter Section */}
            <div className="flex items-center gap-2 w-full justify-center">
              <span className="text-sm font-medium text-slate-600 dark:text-white">Currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as typeof currency)}
                className="h-8 px-3 rounded-lg text-sm bg-emerald-600 text-white border-none focus:ring-2 focus:ring-emerald-400 focus:outline-none font-medium"
              >
                <option value="USD">USD</option>
                <option value="AUD">AUD</option>
                <option value="GBP">GBP</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            
            {/* Filters Section */}
            <div className="flex flex-col items-center gap-2 w-full">
              <span className="text-sm font-medium text-slate-600 dark:text-white">Filters</span>
              
              <div className="flex gap-2 w-full">
                {/* Sport Dropdown */}
                <select
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  className="flex-1 h-8 px-3 rounded-lg text-sm bg-white dark:bg-gray-700 text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                >
                  <option value="All">All Sports</option>
                  <option value="NBA">NBA</option>
                </select>
                
                {/* Bookmaker Dropdown */}
                <select
                  value={bookmaker}
                  onChange={(e) => setBookmaker(e.target.value)}
                  className="flex-1 h-8 px-3 rounded-lg text-sm bg-white dark:bg-gray-700 text-slate-700 dark:text-white border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                >
                  <option value="All">All Bookmakers</option>
                  <option value="DraftKings">DraftKings</option>
                  <option value="FanDuel">FanDuel</option>
                  <option value="BetMGM">BetMGM</option>
                  <option value="Caesars">Caesars</option>
                  <option value="BetRivers">BetRivers</option>
                  <option value="PointsBet">PointsBet</option>
                  <option value="Bet365">Bet365</option>
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
                      : 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-gray-600 hover:bg-white hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-white'
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
            {/* Total P&L */}
            <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">Total P&L</span>
              <div className={`text-base font-semibold ${
                stats.totalPL > 0 ? 'text-green-600 dark:text-green-400' :
                stats.totalPL < 0 ? 'text-red-600 dark:text-red-400' :
                'text-slate-900 dark:text-white'
              } flex flex-col items-center leading-tight`}>
                <span>{currency}</span>
                <span className="text-lg">{stats.totalPL >= 0 ? '+' : ''}{currencySymbols[currency]}{Math.abs(stats.totalPL).toFixed(2)}</span>
              </div>
            </div>
            
            {/* Total Staked */}
            <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">Total Staked</span>
              <span className="text-base font-semibold text-slate-900 dark:text-white">{currency} ${stats.totalStaked.toFixed(2)}</span>
            </div>
            
            {/* Average Stake */}
            <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">Avg Stake</span>
              <span className="text-base font-semibold text-slate-900 dark:text-white">{currency} ${stats.avgStake.toFixed(2)}</span>
            </div>
            
            {/* WIN % */}
            <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
              <span className="text-sm font-medium text-slate-500 dark:text-white mb-1">WIN %</span>
              <span className="text-base font-semibold text-slate-900 dark:text-white">{stats.winRate.toFixed(1)}%</span>
            </div>
            
            {/* ROI */}
            <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
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
            <div className="bg-white dark:bg-gray-700 rounded-lg border border-slate-300 dark:border-gray-600 flex flex-col items-center justify-center py-3">
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
        <div className="chart-container-no-focus bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-4">
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
        <div className="bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-4 flex flex-col">
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
                  className={`flex flex-col items-center justify-center rounded-lg text-xs font-medium cursor-pointer transition-all hover:scale-105 ${
                    !item.day ? 'invisible' :
                    item.profit === 0 ? 'bg-slate-200 dark:bg-gray-700 text-slate-600 dark:text-slate-400' :
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
        <div className="chart-container-no-focus bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Profit by Bookmaker</h3>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className="text-xs text-slate-600 dark:text-slate-400">Profitable only</span>
              <button
                onClick={() => setShowProfitableBookmakersOnly(!showProfitableBookmakersOnly)}
                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                  showProfitableBookmakersOnly ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    showProfitableBookmakersOnly ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
          </div>
          <div className="w-full h-80">
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
        <div className="chart-container-no-focus bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-4">
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
        <div className="bg-slate-50 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 p-4 mb-4">
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
                
                const betDate = new Date(bet.date);
                const dateStr = betDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                return (
                  <div key={bet.id} className={`p-2.5 rounded-lg border-2 ${
                    bet.result === 'pending' 
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400'
                      : bet.result === 'win' 
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-400'
                      : bet.result === 'void'
                      ? 'bg-gray-50 dark:bg-gray-900/20 border-gray-500 dark:border-gray-400'
                      : 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{dateStr}</span>
                      {bet.result !== 'pending' && (
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
                      {bet.result === 'pending' && (
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">PENDING</span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{bet.selection}</div>
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>Stake: {currency} ${convertedStake.toFixed(2)} {bet.currency !== currency && `(${bet.currency} $${bet.stake.toFixed(2)})`}</span>
                      <span>Odds: {bet.odds.toFixed(2)}</span>
                    </div>
                    {bet.market && (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                        {bet.sport} • {bet.market}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      )}

      {/* Right Sidebar - Hidden on mobile unless showMobileTracking is true */}
        {showMobileTracking ? (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
           <div className="relative w-full max-w-2xl rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
             <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
               <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tracking</span>
               <button
                 onClick={() => setShowMobileTracking(false)}
                 className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
               >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                 </svg>
                 Close
               </button>
             </div>
             <div className="px-6 md:px-8 lg:px-10 pt-6 pb-8">
               <div className="h-[720px] overflow-y-auto custom-scrollbar rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 px-4 md:px-6 py-5">
                 <RightSidebar oddsFormat={oddsFormat} isMobileView={true} />
               </div>
             </div>
           </div>
         </div>
       ) : (
         <div className="hidden 2xl:block">
          <RightSidebar oddsFormat={oddsFormat} isMobileView={false} />
        </div>
      )}
      
      {/* Mobile Bottom Navigation - Always visible on mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 z-50 safe-bottom">
        <div className="grid grid-cols-3 h-16">
          {/* Dashboard */}
          <button
            onClick={() => router.push('/nba/research/dashboard')}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <circle cx="12" cy="12" r="6" strokeWidth={2} />
              <circle cx="12" cy="12" r="2" strokeWidth={2} />
            </svg>
            <span className="text-xs font-medium">Dashboard</span>
          </button>
          
          {/* Journal */}
          <button
            onClick={() => {
              // Show popup with Journal or Tracking options
              if (window.confirm('Choose:\n\nOK = View Journal\nCancel = View Tracking')) {
                router.push('/journal');
              } else {
                router.push('/journal?tab=tracking');
              }
            }}
            className="flex flex-col items-center justify-center gap-1 text-purple-600 dark:text-purple-400"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span className="text-xs font-medium">Journal</span>
          </button>
          
          {/* Settings */}
          <button
            onClick={() => router.push('/account')}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs font-medium">Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
