'use client';

import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { AflStatsChart } from '@/app/afl/components/AflStatsChart';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { Search, Loader2 } from 'lucide-react';

type AflPlayerRecord = Record<string, string | number>;
type AflGameLogRecord = Record<string, unknown>;

export default function AFLPage() {
  const router = useRouter();
  const { theme, oddsFormat, setOddsFormat, isDark } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isPro, setIsPro] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const profileDropdownRef = { current: null as HTMLDivElement | null };
  const journalDropdownRef = { current: null as HTMLDivElement | null };
  const settingsDropdownRef = { current: null as HTMLDivElement | null };

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AflPlayerRecord[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<AflPlayerRecord | null>(null);
  const [selectedPlayerGameLogs, setSelectedPlayerGameLogs] = useState<AflGameLogRecord[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [statsLoadingForPlayer, setStatsLoadingForPlayer] = useState(false);
  const [lastStatsError, setLastStatsError] = useState<string | null>(null);
  const [season] = useState(() => {
    const y = new Date().getFullYear();
    // Use 2025 for AFL (most recent completed season with data)
    // AFL season typically runs March-September, so use previous year if we're before March
    const month = new Date().getMonth();
    if (y >= 2026 || (y === 2025 && month < 2)) {
      return 2025;
    }
    return y;
  });
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } = useDashboardStyles({ sidebarOpen });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const user = session.user;
      setUserEmail(user.email ?? null);
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, username, avatar_url, subscription_status, subscription_tier')
        .eq('id', user.id)
        .single();
      const p = profile as { full_name?: string; username?: string; avatar_url?: string; subscription_status?: string; subscription_tier?: string } | null;
      setUsername(p?.username ?? p?.full_name ?? null);
      setAvatarUrl(p?.avatar_url ?? null);
      setIsPro(p?.subscription_status === 'active' || p?.subscription_status === 'trialing' || p?.subscription_tier === 'pro');
    };
    loadUser();
  }, []);

  const playerStatsCacheRef = useRef<Map<string, AflPlayerRecord>>(new Map());

  const fetchPlayers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setPlayersLoading(true);
    try {
      const res = await fetch(`/api/afl/players?query=${encodeURIComponent(query)}&limit=30`);
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data?.error || 'Failed to load players';
        console.error('[AFL] API error:', errorMsg, data);
        throw new Error(errorMsg);
      }
      const list = Array.isArray(data?.players) ? data.players : [];
      setSearchResults(list.map((p: Record<string, unknown>) => ({ name: String(p.name ?? '-') })));
    } catch (err) {
      console.error('[AFL] Failed to fetch players:', err);
      setSearchResults([]);
    } finally {
      setPlayersLoading(false);
    }
  }, []);

  // Show search dropdown when typing
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setShowSearchDropdown(false);
      setSearchResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPlayers(q);
      setShowSearchDropdown(true);
      debounceRef.current = null;
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, fetchPlayers]);

  const filteredPlayers = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return searchResults.filter((p) => {
      const name = String(
        p?.name ?? p?.player_name ?? p?.full_name ?? ''
      ).toLowerCase();
      return name.includes(q);
    }).slice(0, 12);
  })();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch scraped AFLTables game logs for the selected player.
  useEffect(() => {
    const playerName = selectedPlayer?.name;
    if (!playerName) return;
    setLastStatsError(null);
    const cacheKey = `${season}:${String(playerName).toLowerCase()}`;
    const cachedStats = playerStatsCacheRef.current.get(cacheKey);
    if (cachedStats) {
      setSelectedPlayer((prev) => (prev ? { ...prev, ...cachedStats } : prev));
    }

    let cancelled = false;
    setStatsLoadingForPlayer(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(String(playerName))}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLastStatsError(String(data?.error ?? 'Failed to load game logs'));
          return;
        }

        const games = Array.isArray(data?.games) ? data.games as Record<string, unknown>[] : [];
        setSelectedPlayerGameLogs(games);
        if (games.length === 0) {
          setLastStatsError('No game logs found for this player/season');
          return;
        }
        const latest = games[games.length - 1];
        const numericKeys = new Set<string>();
        const numericMetaKeys = new Set(['season', 'game_number', 'guernsey']);
        for (const g of games) {
          for (const [k, v] of Object.entries(g)) {
            if (typeof v === 'number' && Number.isFinite(v) && !numericMetaKeys.has(k)) {
              numericKeys.add(k);
            }
          }
        }

        const toMerge: AflPlayerRecord = {
          games_played: games.length,
        };

        for (const key of numericKeys) {
          const values = games
            .map((g) => g[key])
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          if (!values.length) continue;

          const total = values.reduce((s, v) => s + v, 0);
          const seasonAvg = Math.round((total / values.length) * 10) / 10;
          const lastGameRaw = latest[key];
          const lastGame = typeof lastGameRaw === 'number' && Number.isFinite(lastGameRaw) ? lastGameRaw : 0;
          const last5Values = values.slice(-5);
          const last5Avg = last5Values.length
            ? Math.round((last5Values.reduce((s, v) => s + v, 0) / last5Values.length) * 10) / 10
            : 0;

          // Keep intuitive keys for charting.
          toMerge[`${key}_season_avg`] = seasonAvg;
          toMerge[`${key}_last_game`] = lastGame;
          toMerge[`${key}_last5_avg`] = last5Avg;
        }

        // Keep core metadata from the most recent game log for context.
        if (typeof latest.opponent === 'string') toMerge.last_opponent = latest.opponent;
        if (typeof latest.round === 'string') toMerge.last_round = latest.round;
        if (typeof latest.result === 'string') toMerge.last_result = latest.result;

        playerStatsCacheRef.current.set(cacheKey, toMerge);
        setSelectedPlayer((prev) => (prev ? { ...prev, ...toMerge } : prev));
      } finally {
        if (!cancelled) setStatsLoadingForPlayer(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlayer?.name, season]);

  const bg = mounted && isDark ? 'bg-[#050d1a]' : '';
  const emptyText = mounted && isDark ? 'text-gray-500' : 'text-gray-400';

  return (
    <div className="min-h-screen lg:h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors lg:overflow-x-auto lg:overflow-y-hidden">
      <DashboardStyles />
      <div className={`px-0 dashboard-container ${bg}`} style={containerStyle}>
        <div className={innerContainerClassName} style={innerContainerStyle}>
          <div className={`pt-4 min-h-0 lg:h-full dashboard-container ${bg}`} style={{ paddingLeft: 0 }}>
            <DashboardLeftSidebarWrapper
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              oddsFormat={oddsFormat}
              setOddsFormat={setOddsFormat}
              hasPremium={isPro}
              avatarUrl={avatarUrl}
              username={username}
              userEmail={userEmail}
              isPro={isPro}
              onSubscriptionClick={() => router.push('/subscription')}
              onSignOutClick={async () => { await supabase.auth.signOut(); router.push('/'); }}
              onProfileUpdated={({ username: u, avatar_url: a }) => { if (u !== undefined) setUsername(u ?? null); if (a !== undefined) setAvatarUrl(a ?? null); }}
            />
            <div className="flex flex-col lg:flex-row gap-0 min-h-0">
              {/* Main content - same containers as NBA dashboard, empty */}
              <div className={`${mainContentClassName} pr-0 sm:pr-0 md:pr-0`} style={mainContentStyle}>
                {/* 1. Filter By (Mode toggle) - same as DashboardModeToggle */}
                <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-3 md:px-4 lg:px-6 pt-3 md:pt-4 pb-4 md:pb-5 border border-gray-200 dark:border-gray-700 relative overflow-visible">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  <div className={`flex items-center gap-2 ${emptyText} text-sm`}>—</div>
                </div>
                {/* 2. Header - AFL search in top container */}
                <div className="relative z-[90] bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 w-full min-w-0 flex-shrink-0 mr-0 sm:mr-0 md:mr-0 overflow-visible" ref={searchDropdownRef}>
                  <div className="flex flex-col gap-2 lg:gap-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onFocus={() => {
                            if (searchQuery.trim().length >= 2) setShowSearchDropdown(true);
                          }}
                          placeholder="Search AFL players..."
                          className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm placeholder-gray-500 dark:placeholder-gray-400 ${
                            isDark
                              ? 'bg-[#0f172a] border-gray-600 text-white focus:ring-purple-500 focus:border-purple-500'
                              : 'bg-gray-50 border-gray-300 text-gray-900 focus:ring-purple-500 focus:border-purple-500'
                          }`}
                          aria-label="Search AFL players"
                        />
                        {playersLoading && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                          </span>
                        )}
                        {showSearchDropdown && searchQuery.trim() && (
                          <div
                            className={`absolute left-0 right-0 top-full mt-1 rounded-lg border shadow-lg z-[120] max-h-64 overflow-y-auto ${
                              isDark ? 'bg-[#0f172a] border-gray-600' : 'bg-white border-gray-200'
                            }`}
                          >
                            {playersLoading && filteredPlayers.length === 0 ? (
                              <div className={`px-3 py-4 text-sm flex items-center gap-2 ${emptyText}`}>
                                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                                Loading players…
                              </div>
                            ) : filteredPlayers.length === 0 ? (
                              <div className={`px-3 py-4 text-sm ${emptyText}`}>
                                {searchQuery.trim().length < 2
                                  ? 'Type at least 2 letters'
                                  : 'No players match'}
                              </div>
                            ) : (
                              filteredPlayers.map((p) => {
                                const playerName = String(p?.name ?? p?.player_name ?? p?.full_name ?? '—');
                                return (
                                  <button
                                    key={String(p.id ?? playerName)}
                                    type="button"
                                    onClick={() => {
                                      setSelectedPlayer(p);
                                      setSelectedPlayerGameLogs([]);
                                      setSearchQuery('');
                                      setShowSearchDropdown(false);
                                    }}
                                    className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-200 dark:border-gray-600 last:border-0 ${
                                      isDark
                                        ? 'hover:bg-[#1e293b] text-gray-100'
                                        : 'hover:bg-gray-100 text-gray-900'
                                    }`}
                                  >
                                    <span className="font-medium">{playerName}</span>
                                    {p.team && (
                                      <span className={`ml-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {String(p.team)}
                                      </span>
                                    )}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                      {selectedPlayer && (
                        <div className={`flex-shrink-0 px-3 py-2 rounded-lg ${isDark ? 'bg-[#1e293b]' : 'bg-gray-100'}`}>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Selected</p>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{String(selectedPlayer.name ?? '—')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* 3. Chart container - AFL stats line (bar chart by stat) */}
                <div
                  className="chart-container-no-focus relative z-10 bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-0 sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0 border border-gray-200 dark:border-gray-700 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden"
                  style={{ outline: 'none', boxShadow: 'none' }}
                >
                  <AflStatsChart
                    stats={selectedPlayer ?? {}}
                    gameLogs={selectedPlayerGameLogs}
                    isDark={!!mounted && isDark}
                    isLoading={(playersLoading && !selectedPlayer) || statsLoadingForPlayer}
                    hasSelectedPlayer={!!selectedPlayer}
                    apiErrorHint={lastStatsError}
                  />
                </div>
                {/* 4. Mobile analysis - same as DashboardMobileAnalysis */}
                <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-2 md:p-3 border border-gray-200 dark:border-gray-700 w-full min-w-0 mt-2 sm:mt-3 md:mt-4 lg:mt-2">
                  <div className={`flex items-center justify-center min-h-[100px] ${emptyText} text-sm`}>—</div>
                </div>
                {/* 5. Mobile content - same as DashboardMobileContent */}
                <div className="lg:hidden w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-0 sm:p-4 gap-4 border border-gray-200 dark:border-gray-700 mt-2">
                  <div className={`flex items-center justify-center min-h-[180px] p-4 ${emptyText} text-sm`}>—</div>
                </div>
              </div>
              {/* Right panel - same structure as DashboardRightPanel */}
              <div className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-0 sm:px-1 md:px-0 lg:px-0 fade-scrollbar custom-scrollbar min-w-0 ${
                sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
              }`}>
                <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-3 pt-3 pb-4 border border-gray-200 dark:border-gray-700 relative overflow-visible">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  <div className={`${emptyText} text-sm`}>—</div>
                </div>
                <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 border border-gray-200 dark:border-gray-700 w-full min-w-0">
                  <div className={`flex items-center justify-center min-h-[200px] ${emptyText} text-sm`}>—</div>
                </div>
                <div className="hidden lg:block w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 gap-4 border border-gray-200 dark:border-gray-700">
                  <div className={`flex items-center justify-center min-h-[200px] ${emptyText} text-sm`}>—</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
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
        setTheme={() => {}}
        setOddsFormat={(fmt) => { setOddsFormat(fmt); try { localStorage.setItem('oddsFormat', fmt); } catch { /* ignore */ } }}
      />
    </div>
  );
}
