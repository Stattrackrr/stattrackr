'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useTheme } from '@/contexts/ThemeContext';
import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { Search } from 'lucide-react';
import type { SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

/** Same card chrome as `app/afl/page.tsx` (AFL dashboard). */
const AFL_DASH_CARD_GLOW =
  'border border-gray-200 dark:border-[#463e6b] bg-white dark:bg-[#0a1929] shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_20px_rgba(124,58,237,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22),0_0_36px_rgba(124,58,237,0.22)]';

type SoccerDashboardPayload = {
  matchSample?: Record<string, unknown> | null;
  teamSample?: Record<string, unknown> | null;
};

type SoccerTeamRow = {
  name: string;
  href: string;
  competitions: Array<{ country: string; competition: string }>;
};

function parseUniqueTeamsFromSample(teamSample: Record<string, unknown> | null | undefined): SoccerTeamRow[] {
  const raw = teamSample?.uniqueTeams;
  if (!Array.isArray(raw)) return [];
  const rows: SoccerTeamRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const href = typeof o.href === 'string' ? o.href.trim() : '';
    if (!name || !href) continue;
    const compsRaw = Array.isArray(o.competitions) ? o.competitions : [];
    const competitions = compsRaw
      .map((c) => {
        if (!c || typeof c !== 'object') return null;
        const x = c as Record<string, unknown>;
        return {
          country: typeof x.country === 'string' ? x.country : '',
          competition: typeof x.competition === 'string' ? x.competition : '',
        };
      })
      .filter((c): c is { country: string; competition: string } => c != null);
    rows.push({ name, href, competitions });
  }
  return rows;
}

function teamMatchesQuery(team: SoccerTeamRow, q: string): boolean {
  const n = team.name.toLowerCase();
  if (n.includes(q)) return true;
  for (const c of team.competitions) {
    if (c.country.toLowerCase().includes(q)) return true;
    if (c.competition.toLowerCase().includes(q)) return true;
  }
  return false;
}

export default function SoccerPage() {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
  const [isPro, setIsPro] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const journalDropdownRef = useRef<HTMLDivElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  const [propsMode, setPropsMode] = useState<'player' | 'team'>('player');
  const [rightTab, setRightTab] = useState<'breakdown' | 'dvp' | 'team_matchup'>('dvp');
  const [playerVsTab, setPlayerVsTab] = useState<'comparison' | 'prediction'>('comparison');
  const [playerVsRankScope, setPlayerVsRankScope] = useState<'team' | 'league'>('team');

  const [data, setData] = useState<SoccerDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [teamSearchQuery, setTeamSearchQuery] = useState('');
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<SoccerTeamRow | null>(null);
  const [recentMatches, setRecentMatches] = useState<SoccerwayRecentMatch[]>([]);
  const [recentMatchesLoading, setRecentMatchesLoading] = useState(false);
  const [recentMatchesError, setRecentMatchesError] = useState<string | null>(null);
  const teamSearchWrapRef = useRef<HTMLDivElement>(null);
  const teamResultsRequestId = useRef(0);

  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } =
    useDashboardStyles({ sidebarOpen });

  const emptyText = mounted && isDark ? 'text-gray-500' : 'text-gray-400';

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (propsMode === 'team') {
      setRightTab('breakdown');
    } else {
      setRightTab('dvp');
    }
  }, [propsMode]);

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;
      const user = session.user;
      setUserEmail(user.email ?? null);
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, username, avatar_url, subscription_status, subscription_tier')
          .eq('id', user.id)
          .single();
        const p = profile as {
          full_name?: string;
          username?: string;
          avatar_url?: string;
          subscription_status?: string;
          subscription_tier?: string;
        } | null;
        setUsername(p?.full_name || p?.username || null);
        setAvatarUrl(p?.avatar_url ?? null);
        const active = p?.subscription_status === 'active' || p?.subscription_status === 'trialing';
        const proTier = p?.subscription_tier === 'pro';
        setIsPro(Boolean(active && proTier));
      } catch (e) {
        console.error('Soccer page: profile load failed', e);
      }
    };
    void loadUser();
  }, []);

  const loadSample = useCallback(async (refresh = false) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const params = new URLSearchParams({ includeTeams: '1' });
      if (refresh) params.set('refresh', '1');
      const response = await fetch(`/api/soccer/sample?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((payload as { error?: string })?.error || 'Failed to load soccer sample');
      }
      setData(payload as SoccerDashboardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load soccer sample');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSample(false);
  }, [loadSample]);

  const scrapeNote = useMemo(() => {
    if (loading) return 'Loading Soccerway sample in background…';
    if (error) return `Scrape error: ${error}`;
    const m = data?.matchSample as { generatedAt?: string; match?: { ogTitle?: string } } | null;
    if (m?.match?.ogTitle) return `Last sample: ${m.match.ogTitle}`;
    if (m?.generatedAt) return `Sample updated ${new Date(m.generatedAt).toLocaleString()}`;
    return 'Soccerway sample loaded';
  }, [loading, error, data]);

  const teamUniverse = useMemo(
    () => parseUniqueTeamsFromSample(data?.teamSample as Record<string, unknown> | undefined),
    [data?.teamSample]
  );

  const filteredTeams = useMemo(() => {
    const q = teamSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return teamUniverse.filter((t) => teamMatchesQuery(t, q)).slice(0, 24);
  }, [teamUniverse, teamSearchQuery]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const el = teamSearchWrapRef.current;
      if (!el || !teamSearchOpen) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setTeamSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [teamSearchOpen]);

  useEffect(() => {
    if (!selectedTeam) {
      setRecentMatches([]);
      setRecentMatchesError(null);
      setRecentMatchesLoading(false);
      return;
    }

    const requestId = (teamResultsRequestId.current += 1);
    const ac = new AbortController();
    setRecentMatchesLoading(true);
    setRecentMatchesError(null);

    const href = selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`;
    void fetch(`/api/soccer/team-results?href=${encodeURIComponent(href)}`, { signal: ac.signal, cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          matches?: SoccerwayRecentMatch[];
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load recent matches');
        }
        if (teamResultsRequestId.current !== requestId) return;
        setRecentMatches(Array.isArray(payload?.matches) ? payload.matches : []);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (teamResultsRequestId.current !== requestId) return;
        setRecentMatches([]);
        setRecentMatchesError(err instanceof Error ? err.message : 'Failed to load recent matches');
      })
      .finally(() => {
        if (teamResultsRequestId.current === requestId) {
          setRecentMatchesLoading(false);
        }
      });

    return () => ac.abort();
  }, [selectedTeam]);

  return (
    <div className="min-h-screen h-screen max-h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors overflow-y-auto overflow-x-hidden overscroll-contain lg:max-h-none lg:overflow-y-hidden lg:overflow-x-auto">
      <LoadingBar isLoading={refreshing} isDark={isDark} showImmediately={refreshing} mobileOffset={0} />
      <DashboardStyles />
      <div className="px-0 dashboard-container" style={containerStyle}>
        <div className={innerContainerClassName} style={innerContainerStyle}>
          <div className="pt-4 min-h-0 lg:h-full dashboard-container" style={{ paddingLeft: 0 }}>
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
              onSignOutClick={async () => {
                await supabase.auth.signOut({ scope: 'local' });
                router.push('/');
              }}
              onProfileUpdated={({ username: u, avatar_url: a }) => {
                if (u !== undefined) setUsername(u ?? null);
                if (a !== undefined) setAvatarUrl(a ?? null);
              }}
              showDashboardNavLinks={false}
            />
            <div className="flex flex-col lg:flex-row gap-0 lg:gap-0 min-h-0">
              <div className={mainContentClassName} style={mainContentStyle}>
                {/* 1. Filter By — mobile */}
                <div className={`lg:hidden rounded-lg ${AFL_DASH_CARD_GLOW} px-3 md:px-4 pt-3 md:pt-4 pb-4 md:pb-5 relative overflow-visible`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                    <button
                      type="button"
                      onClick={() => setPropsMode('player')}
                      className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        propsMode === 'player'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Player Props
                    </button>
                    <button
                      type="button"
                      onClick={() => setPropsMode('team')}
                      className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        propsMode === 'team'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Game Props
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{scrapeNote}</p>
                </div>

                {/* 2. Header — AFL shell (blank) */}
                <div
                  className={`relative z-[60] rounded-lg ${AFL_DASH_CARD_GLOW} p-2.5 sm:p-4 md:p-6 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}
                >
                  <div className="flex flex-col gap-1.5 lg:gap-3">
                    <div className="hidden lg:flex items-center flex-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-3 mb-1">
                          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Soccer</h1>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">Dashboard layout preview</div>
                      </div>
                      <div className="hidden lg:flex min-w-0 flex-shrink items-end mx-2 xl:mx-4">
                        <div className="flex flex-col items-center gap-1.5 min-w-0 flex-shrink">
                          <div className="flex items-center gap-1.5 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1.5 xl:px-3 xl:py-2 min-w-0 flex-shrink overflow-hidden">
                            <span className="text-gray-400 dark:text-gray-500 text-xs xl:text-sm font-medium">—</span>
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-xs flex-shrink-0">VS</span>
                            <span className="text-gray-400 dark:text-gray-500 text-xs xl:text-sm font-medium">—</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void loadSample(true)}
                          disabled={refreshing}
                          className="rounded-lg border border-purple-500/40 bg-purple-600/90 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {refreshing ? 'Refreshing…' : 'Refresh scrape'}
                        </button>
                      </div>
                    </div>
                    <div className="lg:hidden flex flex-col gap-0.5">
                      <div className="w-full min-w-0">
                        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Soccer</h1>
                      </div>
                      <div className="flex flex-col gap-1 w-full min-w-0">
                        <div className="flex items-start justify-between gap-1.5 w-full min-w-0">
                          <div className="text-xs text-gray-600 dark:text-gray-400">Dashboard layout preview</div>
                          <button
                            type="button"
                            onClick={() => void loadSample(true)}
                            disabled={refreshing}
                            className="flex-shrink-0 rounded-lg border border-purple-500/40 bg-purple-600/90 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                          >
                            {refreshing ? '…' : 'Refresh'}
                          </button>
                        </div>
                        <div className="flex justify-center">
                          <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-3 sm:py-2 min-w-0">
                            <span className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm font-medium">—</span>
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs">VS</span>
                            <span className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm font-medium">—</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      ref={teamSearchWrapRef}
                      className="w-full min-w-0 border-t border-gray-200 dark:border-gray-700/80 pt-3 mt-2 lg:mt-3 lg:pt-3"
                    >
                      <label htmlFor="soccer-team-search" className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-200">
                        Search team
                      </label>
                      <div className="relative max-w-xl lg:max-w-lg">
                        <Search
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                          aria-hidden
                        />
                        <input
                          id="soccer-team-search"
                          type="search"
                          autoComplete="off"
                          value={teamSearchQuery}
                          onChange={(e) => {
                            setTeamSearchQuery(e.target.value);
                            setTeamSearchOpen(true);
                          }}
                          onFocus={() => setTeamSearchOpen(true)}
                          placeholder={
                            teamUniverse.length
                              ? `Search ${teamUniverse.length} teams by name, league, or country…`
                              : 'Teams load with the sample — refresh if empty…'
                          }
                          className={`w-full rounded-lg border py-2 pl-9 pr-3 text-sm placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 dark:placeholder-gray-400 ${
                            mounted && isDark
                              ? 'border-gray-600 bg-[#0f172a] text-white'
                              : 'border-gray-300 bg-gray-50 text-gray-900'
                          }`}
                        />
                        {teamSearchOpen && teamSearchQuery.trim() ? (
                          <div
                            className={`absolute left-0 right-0 top-full z-[80] mt-1 max-h-64 overflow-y-auto rounded-lg border shadow-lg custom-scrollbar ${
                              mounted && isDark ? 'border-gray-600 bg-[#0f172a]' : 'border-gray-200 bg-white'
                            }`}
                          >
                            {filteredTeams.length === 0 ? (
                              <div className={`px-3 py-3 text-sm ${emptyText}`}>No teams match</div>
                            ) : (
                              <ul className="py-1">
                                {filteredTeams.map((team) => {
                                  const meta =
                                    team.competitions.length > 0
                                      ? team.competitions
                                          .map((c) => [c.country, c.competition].filter(Boolean).join(' · '))
                                          .join(' | ')
                                      : '';
                                  return (
                                    <li key={team.href}>
                                      <button
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                          setSelectedTeam(team);
                                          setTeamSearchQuery(team.name);
                                          setTeamSearchOpen(false);
                                        }}
                                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:hover:bg-[#1e293b] ${
                                          selectedTeam?.href === team.href
                                            ? 'bg-purple-50 dark:bg-purple-950/40'
                                            : ''
                                        }`}
                                      >
                                        <span className="font-medium text-gray-900 dark:text-white">{team.name}</span>
                                        {meta ? (
                                          <span className="text-xs text-gray-500 dark:text-gray-400">{meta}</span>
                                        ) : null}
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        ) : null}
                      </div>
                      {selectedTeam ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                          <span className="font-medium text-gray-800 dark:text-gray-100">Selected:</span>
                          <a
                            href={`https://www.soccerway.com${selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-purple-600 underline decoration-purple-500/40 underline-offset-2 hover:text-purple-700 dark:text-purple-300 dark:hover:text-purple-200"
                          >
                            {selectedTeam.name}
                          </a>
                          <span className="text-gray-400 dark:text-gray-500">(Soccerway)</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTeam(null);
                              setTeamSearchQuery('');
                            }}
                            className="rounded-md border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                          >
                            Clear
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* 3. Chart container */}
                <div
                  className={`chart-container-no-focus relative z-10 rounded-lg p-0 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${AFL_DASH_CARD_GLOW} sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0`}
                  style={{ outline: 'none' }}
                >
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <div
                      className={`flex-shrink-0 border-b px-3 py-2.5 text-sm font-semibold ${
                        mounted && isDark ? 'border-gray-700 text-gray-100' : 'border-gray-200 text-gray-900'
                      }`}
                    >
                      Recent results{selectedTeam ? ` · ${selectedTeam.name}` : ''}
                    </div>
                    <div className="custom-scrollbar fade-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3 sm:py-3">
                      {!selectedTeam ? (
                        <div className={`flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm ${emptyText}`}>
                          Select a team above to load recent results from Soccerway.
                        </div>
                      ) : recentMatchesLoading ? (
                        <div className="space-y-2 p-1">
                          {[...Array(8)].map((_, i) => (
                            <div
                              key={i}
                              className={`h-14 animate-pulse rounded-lg ${mounted && isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
                              style={{ animationDelay: `${i * 0.06}s` }}
                            />
                          ))}
                        </div>
                      ) : recentMatchesError ? (
                        <div className="px-2 py-4 text-sm text-red-600 dark:text-red-400">{recentMatchesError}</div>
                      ) : recentMatches.length === 0 ? (
                        <div className={`px-2 py-6 text-center text-sm ${emptyText}`}>No recent results parsed for this team.</div>
                      ) : (
                        <ul className="space-y-2 pb-2">
                          {recentMatches.map((m) => {
                            const selectedLower = selectedTeam.name.trim().toLowerCase();
                            const homeHighlight = m.homeTeam.trim().toLowerCase() === selectedLower;
                            const awayHighlight = m.awayTeam.trim().toLowerCase() === selectedLower;
                            const dateLabel =
                              m.kickoffUnix != null
                                ? new Date(m.kickoffUnix * 1000).toLocaleString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—';
                            const absUrl = `https://www.soccerway.com${m.summaryPath.startsWith('/') ? m.summaryPath : `/${m.summaryPath}`}`;
                            return (
                              <li key={m.matchId}>
                                <a
                                  href={absUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`block rounded-lg border px-3 py-2.5 transition hover:bg-gray-50 dark:hover:bg-[#132337] ${
                                    mounted && isDark ? 'border-gray-700 bg-black/20' : 'border-gray-200 bg-white'
                                  }`}
                                >
                                  <div className={`mb-1 text-[11px] uppercase tracking-wide ${emptyText}`}>{dateLabel}</div>
                                  <div className="flex items-center justify-between gap-2 text-sm">
                                    <span
                                      className={`min-w-0 flex-1 truncate text-left ${
                                        homeHighlight ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-800 dark:text-gray-200'
                                      }`}
                                    >
                                      {m.homeTeam}
                                    </span>
                                    <span className="flex-shrink-0 font-mono text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                                      {m.homeScore} – {m.awayScore}
                                    </span>
                                    <span
                                      className={`min-w-0 flex-1 truncate text-right ${
                                        awayHighlight ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-800 dark:text-gray-200'
                                      }`}
                                    >
                                      {m.awayTeam}
                                    </span>
                                  </div>
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                {/* 4. Supporting stats — player mode only on AFL */}
                {propsMode === 'player' && (
                  <div
                    className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}
                  >
                    <h3 className={`text-sm font-semibold mb-1 px-3 sm:px-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      Supporting stats
                    </h3>
                    <div className="min-h-[220px]" />
                  </div>
                )}

                {/* 4b. Lineup under chart — team mode */}
                {propsMode === 'team' && (
                  <div className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                    <div className="min-h-[180px]" />
                  </div>
                )}

                {/* 4.5 DVP | Opponent | Team Matchup — mobile */}
                <div className={`lg:hidden w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4 max-h-[60vh] min-h-0`}>
                  <div className="flex gap-2 sm:gap-2 mb-2 flex-shrink-0">
                    {propsMode === 'player' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setRightTab('dvp')}
                          className={`relative flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            rightTab === 'dvp'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          DVP
                        </button>
                        <button
                          type="button"
                          onClick={() => setRightTab('breakdown')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            rightTab === 'breakdown'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Opponent Breakdown
                        </button>
                        <button
                          type="button"
                          onClick={() => setRightTab('team_matchup')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            rightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team Matchup
                        </button>
                      </>
                    )}
                    {propsMode === 'team' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setRightTab('breakdown')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            rightTab === 'breakdown'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Opponent Breakdown
                        </button>
                        <button
                          type="button"
                          onClick={() => setRightTab('team_matchup')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            rightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team Matchup
                        </button>
                      </>
                    )}
                  </div>
                  <div className="relative flex-1 min-h-0 w-full min-w-0 flex flex-col overflow-y-auto">
                    <div className={`min-h-[200px] flex items-center justify-center text-sm ${emptyText}`} />
                  </div>
                </div>

                {/* 4.52 Player vs Team — mobile */}
                {propsMode === 'player' && (
                  <div className={`lg:hidden w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} px-2 sm:px-2.5 py-2.5 sm:py-3`}>
                    <div className="flex gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setPlayerVsTab('comparison')}
                        className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors border ${
                          playerVsTab === 'comparison'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Player vs Team
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerVsTab('prediction')}
                        className={`relative flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors border ${
                          playerVsTab === 'prediction'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Prediction Model
                        <span className="absolute -top-2 -right-2 inline-flex items-center rounded-md border border-red-300 bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wide text-white shadow-sm dark:border-red-500/70 dark:bg-red-600">
                          BETA
                        </span>
                      </button>
                    </div>
                    {playerVsTab === 'comparison' && (
                      <div className="flex justify-center mb-2">
                        <div className={`inline-flex rounded-lg border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
                          <button
                            type="button"
                            onClick={() => setPlayerVsRankScope('team')}
                            className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              playerVsRankScope === 'team'
                                ? 'bg-purple-600 text-white'
                                : isDark
                                  ? 'bg-transparent text-gray-400 hover:text-gray-200'
                                  : 'bg-transparent text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            vs Team
                          </button>
                          <button
                            type="button"
                            onClick={() => setPlayerVsRankScope('league')}
                            className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              playerVsRankScope === 'league'
                                ? 'bg-purple-600 text-white'
                                : isDark
                                  ? 'bg-transparent text-gray-400 hover:text-gray-200'
                                  : 'bg-transparent text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            vs League
                          </button>
                        </div>
                      </div>
                    )}
                    <div className={`min-h-[160px] rounded-lg border border-dashed ${isDark ? 'border-gray-700 bg-black/10' : 'border-gray-200 bg-gray-50'}`} />
                  </div>
                )}

                {/* 4.55 Lineups — mobile */}
                <div className={`lg:hidden w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  <div className="min-h-[140px]" />
                </div>

                {/* 4.6 Injuries — mobile */}
                {propsMode === 'player' && (
                  <div className={`lg:hidden rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 w-full min-w-0 flex flex-col max-h-[50vh] min-h-0`}>
                    <div className="flex-1 min-h-0 flex items-center justify-center">
                      <div className={`text-sm ${emptyText}`} />
                    </div>
                  </div>
                )}

                {/* 4.7 Ladder — mobile */}
                <div className={`lg:hidden w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4`}>
                  <div className="min-h-[200px]" />
                </div>

                {/* 5. Game log / box score area */}
                {propsMode === 'player' && (
                  <div className="w-full min-w-0 pb-6 lg:pb-0">
                    <div className={`min-h-[120px] rounded-lg border border-dashed ${isDark ? 'border-gray-700' : 'border-gray-200'}`} />
                  </div>
                )}
              </div>

              {/* Right panel */}
              <div
                className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 fade-scrollbar custom-scrollbar min-w-0 ${
                  sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
                }`}
              >
                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} px-3 pt-3 pb-4 relative overflow-visible`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                    <button
                      type="button"
                      onClick={() => setPropsMode('player')}
                      className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                        propsMode === 'player'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Player Props
                    </button>
                    <button
                      type="button"
                      onClick={() => setPropsMode('team')}
                      className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                        propsMode === 'team'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Game Props
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{scrapeNote}</p>
                </div>

                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} p-1.5 xl:p-2 w-full min-w-0`}>
                  <div className="flex gap-1.5 xl:gap-2 mb-2">
                    {propsMode === 'player' && (
                      <button
                        type="button"
                        onClick={() => setRightTab('dvp')}
                        className={`relative flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                          rightTab === 'dvp'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        DVP
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRightTab('breakdown')}
                      className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                        rightTab === 'breakdown'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      Opponent Breakdown
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightTab('team_matchup')}
                      className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                        rightTab === 'team_matchup'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      Team Matchup
                    </button>
                  </div>
                  <div className="relative h-[380px] xl:h-[420px] w-full min-w-0 flex flex-col min-h-0">
                    {propsMode === 'player' && (
                      <div className={rightTab === 'dvp' ? 'flex-1 min-h-0 overflow-y-auto flex flex-col' : 'hidden'}>
                        <div className={`flex-1 min-h-0 ${emptyText} flex items-center justify-center text-sm`} />
                      </div>
                    )}
                    <div className={rightTab === 'breakdown' ? 'flex flex-col h-full min-h-0' : 'hidden'}>
                      <div className={`flex-1 min-h-0 ${emptyText} flex items-center justify-center text-sm`} />
                    </div>
                    <div className={rightTab === 'team_matchup' ? 'flex flex-col h-full min-h-0' : 'hidden'}>
                      <div className={`flex-1 min-h-0 ${emptyText} flex items-center justify-center text-sm`} />
                    </div>
                  </div>
                </div>

                {propsMode === 'player' && (
                  <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} px-1.5 xl:px-2 py-1.5 xl:py-2 w-full min-w-0 mt-0`}>
                    <div className="flex gap-1.5 xl:gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => setPlayerVsTab('comparison')}
                        className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                          playerVsTab === 'comparison'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Player vs Team
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerVsTab('prediction')}
                        className={`relative flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                          playerVsTab === 'prediction'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Prediction Model
                        <span className="absolute -top-2 -right-2 inline-flex items-center rounded-md border border-red-300 bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wide text-white shadow-sm dark:border-red-500/70 dark:bg-red-600">
                          BETA
                        </span>
                      </button>
                    </div>
                    <div className={`min-h-[220px] rounded-lg border border-dashed ${isDark ? 'border-gray-700 bg-black/10' : 'border-gray-200 bg-gray-50'}`} />
                  </div>
                )}

                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} p-2 xl:p-3 pb-12 xl:pb-14 w-full min-w-0`}>
                  <div className="relative h-[320px] w-full min-w-0 flex flex-col min-h-0">
                    <div className={`flex-1 ${emptyText} flex items-center justify-center text-sm`} />
                  </div>
                </div>

                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} p-2 xl:p-3 w-full min-w-0 mt-0`}>
                  <div className="min-h-[240px]" />
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
          await supabase.auth.signOut({ scope: 'local' });
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
            /* ignore */
          }
        }}
      />
    </div>
  );
}
