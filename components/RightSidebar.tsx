"use client";

import { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useTrackedBets } from "../contexts/TrackedBetsContext";
import { Plus, X, TrendingUp, History, Target, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

interface JournalBet {
  id: string;
  date: string;
  sport: string;
  selection: string;
  stake: number;
  odds: number;
  result: 'win' | 'loss' | 'void' | 'pending';
  currency: string;
}

type TabType = 'tracked' | 'journal';

export default function RightSidebar() {
  const { isDark } = useTheme();
  const { trackedBets, removeTrackedBet, clearAllTrackedBets, refreshTrackedBets } = useTrackedBets();
  const [activeTab, setActiveTab] = useState<TabType>('tracked');
  const [journalBets, setJournalBets] = useState<JournalBet[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Prevent hydration mismatch by waiting for client mount
  useEffect(() => {
    setIsMounted(true);
    // Load tracked bets from Supabase on mount
    handleRefresh();
  }, []);

  // Debug: Log when trackedBets changes
  useEffect(() => {
    console.log('RightSidebar: trackedBets updated:', trackedBets);
  }, [trackedBets]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    
    // Fetch tracked bets from Supabase
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsRefreshing(false);
      return;
    }

    const { data: trackedProps, error } = await supabase
      .from('tracked_props')
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
      const bets = trackedProps.map(prop => ({
        id: prop.id,
        selection: `${prop.player_name} ${prop.stat_type.toUpperCase()} ${prop.over_under === 'over' ? 'Over' : 'Under'} ${prop.line}`,
        stake: 0,
        odds: prop.odds || 0,
        sport: 'NBA',
        playerName: prop.player_name,
        stat: prop.stat_type,
        line: prop.line,
        bookmaker: prop.bookmaker || null,
        isCustom: !prop.bookmaker, // If no bookmaker, it's custom
        gameStatus: prop.status === 'completed' ? 'completed' as const : prop.status === 'live' ? 'live' as const : 'scheduled' as const,
        result: prop.result || 'pending' as const,
      }));

      // Update context
      localStorage.setItem('trackedBets', JSON.stringify(bets));
      refreshTrackedBets();
    }
    
    setIsRefreshing(false);
  };

  // Fetch journal bets from localStorage or API
  useEffect(() => {
    // TODO: Replace with actual API call to fetch last 15 bets
    // For now, just check localStorage
    const fetchJournalBets = async () => {
      // This would be replaced with actual supabase query
      // const { data } = await supabase.from('bets').select('*').limit(15).order('date', { ascending: false });
      setJournalBets([]);
    };
    fetchJournalBets();
  }, []);

  const removeBet = async (id: string) => {
    // Remove from Supabase
    const { error } = await supabase
      .from('tracked_props')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete tracked prop:', error);
    }

    // Remove from context/localStorage
    removeTrackedBet(id);
    setConfirmRemoveId(null);
  };

  const clearAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Delete all from Supabase
    const { error } = await supabase
      .from('tracked_props')
      .delete()
      .eq('user_id', user.id);

    if (error) {
      console.error('Failed to clear tracked props:', error);
    }

    // Clear from context/localStorage
    clearAllTrackedBets();
    setConfirmClearAll(false);
  };

  const pendingBets = trackedBets.filter(bet => bet.result === 'pending' || !bet.result).length;
  const resultedBets = trackedBets.filter(bet => bet.result === 'win' || bet.result === 'loss').length;

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

  return (
    <div
      className="hidden lg:flex fixed top-4 h-[calc(100vh-1rem)] bg-gray-300 dark:bg-slate-900 border-l border-gray-200 dark:border-gray-700 flex-col rounded-l-2xl shadow-xl"
      style={{
        marginRight: '0px',
        width: 'var(--right-panel-width, 360px)',
        right: 'clamp(0px, calc((100vw - var(--app-max, 1800px)) / 2), 9999px)'
      }}
    >
      {/* Header with Tabs */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 text-black dark:text-white">
        <div className="flex items-center gap-2 mb-3">
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
        </div>
        
        {activeTab === 'tracked' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">
                {isMounted ? trackedBets.length : 0} bet{(isMounted ? trackedBets.length : 0) !== 1 ? 's' : ''} tracked
              </div>
              <div className="flex gap-2">
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
          </>
        )}
        
        {activeTab === 'journal' && (
          <div className="text-sm font-medium">
            Last 15 bets
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {activeTab === 'tracked' && (
          !isMounted || trackedBets.length === 0 ? (
          <div className="p-4 text-center text-black dark:text-white opacity-70">
            <div className="text-sm">No bets tracked yet</div>
            <div className="text-xs mt-2">Add bets from the research pages to track them here</div>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {trackedBets.map((bet) => (
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
                <div className="absolute top-2 right-2">
                  <button
                    onClick={() => setConfirmRemoveId(bet.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/10 rounded"
                    title="Remove bet"
                  >
                    <X className="w-4 h-4 text-red-500" />
                  </button>
                  {confirmRemoveId === bet.id && (
                    <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 z-50 min-w-[140px]">
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
                
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{bet.sport}</div>
                <div className="text-sm font-semibold text-black dark:text-white mb-2 pr-6">{bet.selection}</div>
                
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
                  {bet.gameStatus === 'scheduled' ? (
                    <span className="px-2 py-1 bg-gray-500/10 text-gray-600 dark:text-gray-400 rounded font-medium">
                      SCHEDULED
                    </span>
                  ) : bet.gameStatus === 'live' && bet.result === 'pending' ? (
                    <span className="px-2 py-1 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded font-medium">
                      TRACKING
                    </span>
                  ) : bet.result === 'win' ? (
                    <span className="px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded font-medium">
                      W
                    </span>
                  ) : bet.result === 'loss' ? (
                    <span className="px-2 py-1 bg-red-500/10 text-red-600 dark:text-red-400 rounded font-medium">
                      L
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ))}
        
        {activeTab === 'journal' && (
          journalBets.length === 0 ? (
            <div className="p-4 text-center text-black dark:text-white opacity-70">
              <div className="text-sm">No bets in journal yet</div>
              <div className="text-xs mt-2">Add bets from the form below to track your betting history</div>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {journalBets.slice(0, 15).map((bet) => (
                <div
                  key={bet.id}
                  className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{bet.sport}</div>
                      <div className="text-sm font-semibold text-black dark:text-white">{bet.selection}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${getResultBadge(bet.result)}`}>
                      {bet.result.toUpperCase()}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <div>
                      <span className="font-semibold text-black dark:text-white">{bet.currency} ${bet.stake}</span> @ {bet.odds.toFixed(2)}
                    </div>
                    <div className="text-xs">{new Date(bet.date).toLocaleDateString()}</div>
                  </div>
                  
                  {bet.result === 'win' && (
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-emerald-600 dark:text-emerald-400">
                      Won: {bet.currency} ${(bet.stake * bet.odds - bet.stake).toFixed(2)}
                    </div>
                  )}
                  {bet.result === 'loss' && (
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-red-600 dark:text-red-400">
                      Lost: {bet.currency} ${bet.stake.toFixed(2)}
                    </div>
                  )}
                </div>
              ))}
              
              {journalBets.length > 15 && (
                <div className="text-center pt-2">
                  <a href="/journal" className="text-xs text-purple-600 dark:text-purple-400 hover:underline">
                    View all {journalBets.length} bets →
                  </a>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Summary Footer - only for tracked bets */}
      {activeTab === 'tracked' && isMounted && trackedBets.length > 0 && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-slate-800/50 space-y-2">
          <div className="flex items-center justify-between text-sm text-black dark:text-white">
            <span className="opacity-70">Total Tracked:</span>
            <span className="font-semibold">{trackedBets.length}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-black dark:text-white">
            <span className="opacity-70">Pending:</span>
            <span className="font-semibold text-yellow-600 dark:text-yellow-400">{pendingBets}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-black dark:text-white">
            <span className="opacity-70">Resulted:</span>
            <span className="font-semibold">{resultedBets}</span>
          </div>
        </div>
      )}
    </div>
  );
}
