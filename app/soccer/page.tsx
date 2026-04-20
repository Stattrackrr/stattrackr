'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useTheme } from '@/contexts/ThemeContext';
import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { Search } from 'lucide-react';
import type { SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';
import { SoccerStatsChart, type SoccerStatTeamScope, type SoccerTimeframe } from '@/app/soccer/components/SoccerStatsChart';
import { SoccerSupportingStats } from '@/app/soccer/components/SoccerSupportingStats';

/** Same card chrome as `app/afl/page.tsx` (AFL dashboard). */
const AFL_DASH_CARD_GLOW =
  'border border-gray-200 dark:border-[#463e6b] bg-white dark:bg-[#0a1929] shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_20px_rgba(124,58,237,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22),0_0_36px_rgba(124,58,237,0.22)]';

type SoccerDashboardPayload = {
  matchSample?: Record<string, unknown> | null;
  teamSample?: Record<string, unknown> | null;
};

type SoccerNextFixture = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  opponentName: string;
  isHome: boolean | null;
  teamLogoUrl: string | null;
  opponentLogoUrl: string | null;
  kickoffUnix: number | null;
  summaryPath: string;
  competitionName: string | null;
  competitionCountry: string | null;
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

function normalizeTeamHref(value: string | null | undefined): string {
  const href = String(value || '').trim();
  if (!href) return '';
  return (href.startsWith('/') ? href : `/${href}`).replace(/\/+$/, '');
}

function SoccerPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  const [data, setData] = useState<SoccerDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [teamSearchQuery, setTeamSearchQuery] = useState('');
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<SoccerTeamRow | null>(null);
  const [recentMatches, setRecentMatches] = useState<SoccerwayRecentMatch[]>([]);
  const [recentMatchesLoading, setRecentMatchesLoading] = useState(false);
  const [recentMatchesError, setRecentMatchesError] = useState<string | null>(null);
  const [nextFixture, setNextFixture] = useState<SoccerNextFixture | null>(null);
  const [nextFixtureLoading, setNextFixtureLoading] = useState(false);
  const [nextFixtureError, setNextFixtureError] = useState<string | null>(null);
  const [nextFixtureCountdown, setNextFixtureCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  const [mainChartStat, setMainChartStat] = useState('');
  const [chartTimeframe, setChartTimeframe] = useState<SoccerTimeframe>('last10');
  const [chartTeamScope, setChartTeamScope] = useState<SoccerStatTeamScope>('all');
  const teamSearchWrapRef = useRef<HTMLDivElement>(null);
  const teamResultsRequestId = useRef(0);
  const nextFixtureRequestId = useRef(0);

  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } =
    useDashboardStyles({ sidebarOpen });

  const emptyText = mounted && isDark ? 'text-gray-500' : 'text-gray-400';

  useEffect(() => setMounted(true), []);

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

  const loadSample = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ includeTeams: '1' });
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
    }
  }, []);

  useEffect(() => {
    void loadSample();
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

  const teamHrefFromUrl = normalizeTeamHref(searchParams.get('team'));
  const selectedTeamHref = normalizeTeamHref(selectedTeam?.href);

  const updateTeamUrl = useCallback(
    (teamHref: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      const normalizedHref = normalizeTeamHref(teamHref);
      if (normalizedHref) params.set('team', normalizedHref);
      else params.delete('team');
      const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (teamUniverse.length === 0) return;
    if (!teamHrefFromUrl) return;

    const matchedTeam = teamUniverse.find((team) => normalizeTeamHref(team.href) === teamHrefFromUrl) ?? null;
    if (!matchedTeam) return;
    if (selectedTeamHref === teamHrefFromUrl) return;

    setSelectedTeam(matchedTeam);
    setTeamSearchQuery(matchedTeam.name);
  }, [selectedTeam, selectedTeamHref, teamHrefFromUrl, teamUniverse]);

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

  useEffect(() => {
    if (!selectedTeam) {
      setNextFixture(null);
      setNextFixtureError(null);
      setNextFixtureLoading(false);
      return;
    }

    const requestId = (nextFixtureRequestId.current += 1);
    const ac = new AbortController();
    setNextFixtureLoading(true);
    setNextFixtureError(null);

    const href = selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`;
    void fetch(`/api/soccer/next-game?href=${encodeURIComponent(href)}`, { signal: ac.signal, cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          fixture?: SoccerNextFixture | null;
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load next fixture');
        }
        if (nextFixtureRequestId.current !== requestId) return;
        setNextFixture(payload?.fixture ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (nextFixtureRequestId.current !== requestId) return;
        setNextFixture(null);
        setNextFixtureError(err instanceof Error ? err.message : 'Failed to load next fixture');
      })
      .finally(() => {
        if (nextFixtureRequestId.current === requestId) {
          setNextFixtureLoading(false);
        }
      });

    return () => ac.abort();
  }, [selectedTeam]);

  const nextFixtureKickoff = useMemo(
    () => (nextFixture?.kickoffUnix != null ? new Date(nextFixture.kickoffUnix * 1000) : null),
    [nextFixture?.kickoffUnix]
  );

  useCountdownTimer({
    nextGameTipoff: nextFixtureKickoff,
    isGameInProgress: false,
    setCountdown: setNextFixtureCountdown,
  });

  const selectedHeaderTeamName = selectedTeam?.name ?? null;
  const headerTitle = selectedHeaderTeamName ?? 'Select a team';
  const displayOpponent = nextFixture?.opponentName?.trim() ? nextFixture.opponentName.trim() : null;
  const nextFixtureMeta = useMemo(() => {
    if (!selectedTeam) return null;
    if (nextFixtureLoading) return 'Loading next fixture...';
    if (nextFixtureError) return nextFixtureError;
    if (!nextFixture) return 'No upcoming fixture found on Soccerway.';

    const parts: string[] = [];
    const comp = [nextFixture.competitionCountry, nextFixture.competitionName].filter(Boolean).join(': ');
    if (comp) parts.push(comp);
    if (nextFixture.isHome === true) parts.push('Home');
    else if (nextFixture.isHome === false) parts.push('Away');
    if (nextFixtureKickoff) {
      parts.push(
        nextFixtureKickoff.toLocaleString([], {
          month: 'short',
          day: 'numeric',
        })
      );
    }
    return parts.join(' · ');
  }, [nextFixture, nextFixtureError, nextFixtureKickoff, nextFixtureLoading, selectedTeam]);

  return (
    <div className="min-h-screen h-screen max-h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors overflow-y-auto overflow-x-hidden overscroll-contain lg:max-h-none lg:overflow-y-hidden lg:overflow-x-auto">
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
                  className={`relative z-[60] rounded-lg ${AFL_DASH_CARD_GLOW} px-2.5 py-2 sm:px-4 sm:py-3 md:px-5 md:py-3.5 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}
                >
                  <div className="flex flex-col gap-1.5 lg:gap-2">
                    <div className="hidden lg:flex items-center gap-3 min-w-0">
                      <div className="flex flex-1 min-w-0 items-center">
                        <div className="flex items-center gap-2 min-w-0">
                          {nextFixture?.teamLogoUrl ? (
                            <img
                              src={nextFixture.teamLogoUrl}
                              alt={selectedHeaderTeamName ?? 'Selected team'}
                              className="w-6 h-6 xl:w-7 xl:h-7 object-contain flex-shrink-0"
                            />
                          ) : null}
                          <h1 className="text-base md:text-lg font-bold text-gray-900 dark:text-white truncate">{headerTitle}</h1>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 justify-center">
                        <div className="flex flex-col items-center gap-1.5 min-w-0 flex-shrink">
                          <div className="flex items-center gap-1.5 xl:gap-2.5 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 xl:px-2.5 xl:py-1.5 min-w-0 flex-shrink overflow-hidden">
                            <div className="flex items-center gap-1 xl:gap-1.5 min-w-0 flex-shrink">
                              {nextFixture?.teamLogoUrl ? (
                                <img
                                  src={nextFixture.teamLogoUrl}
                                  alt={selectedHeaderTeamName ?? 'Selected team'}
                                  className="w-5 h-5 xl:w-7 xl:h-7 object-contain flex-shrink-0"
                                />
                              ) : null}
                              <span className={`text-xs xl:text-sm font-medium truncate ${selectedHeaderTeamName ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                {selectedHeaderTeamName ?? '—'}
                              </span>
                            </div>
                            {selectedHeaderTeamName && nextFixtureCountdown ? (
                              <div className="flex flex-col items-center flex-shrink-0 min-w-0 w-14 xl:w-[72px]">
                                <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Kickoff in</div>
                                <div className="text-[11px] xl:text-xs font-mono font-semibold text-gray-900 dark:text-white tabular-nums">
                                  {String(nextFixtureCountdown.hours).padStart(2, '0')}:
                                  {String(nextFixtureCountdown.minutes).padStart(2, '0')}:
                                  {String(nextFixtureCountdown.seconds).padStart(2, '0')}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400 font-medium text-xs flex-shrink-0">VS</span>
                            )}
                            <div className="flex items-center gap-1 xl:gap-1.5 min-w-0 flex-shrink">
                              {nextFixture?.opponentLogoUrl ? (
                                <img
                                  src={nextFixture.opponentLogoUrl}
                                  alt={displayOpponent ?? 'Opponent'}
                                  className="w-5 h-5 xl:w-7 xl:h-7 object-contain flex-shrink-0"
                                />
                              ) : null}
                              <span className={`text-xs xl:text-sm font-medium truncate ${displayOpponent ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                {nextFixtureLoading ? 'Loading...' : displayOpponent ?? '—'}
                              </span>
                            </div>
                          </div>
                          {nextFixtureMeta ? (
                            <div className={`text-[10px] xl:text-[11px] text-center w-full leading-tight ${nextFixtureError ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
                              {nextFixtureMeta}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0" />
                    </div>
                    <div className="lg:hidden flex flex-col gap-0.5">
                      <div className="w-full min-w-0">
                        <h1 className="text-base font-bold text-gray-900 dark:text-white text-center">{headerTitle}</h1>
                      </div>
                      <div className="flex flex-col gap-0.5 w-full min-w-0 items-center">
                        <div className="flex justify-center">
                          <div className="flex items-center gap-2 sm:gap-2.5 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-2.5 sm:py-1.5 min-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                              {nextFixture?.teamLogoUrl ? (
                                <img
                                  src={nextFixture.teamLogoUrl}
                                  alt={selectedHeaderTeamName ?? 'Selected team'}
                                  className="w-5 h-5 sm:w-6 sm:h-6 object-contain flex-shrink-0"
                                />
                              ) : null}
                              <span className={`text-xs sm:text-sm font-medium truncate ${selectedHeaderTeamName ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                {selectedHeaderTeamName ?? '—'}
                              </span>
                            </div>
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs">VS</span>
                            <div className="flex items-center gap-1 min-w-0">
                              {nextFixture?.opponentLogoUrl ? (
                                <img
                                  src={nextFixture.opponentLogoUrl}
                                  alt={displayOpponent ?? 'Opponent'}
                                  className="w-5 h-5 sm:w-6 sm:h-6 object-contain flex-shrink-0"
                                />
                              ) : null}
                              <span className={`text-xs sm:text-sm font-medium truncate ${displayOpponent ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                {nextFixtureLoading ? 'Loading...' : displayOpponent ?? '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                        {nextFixtureMeta ? (
                          <div className={`text-center text-[10px] leading-tight ${nextFixtureError ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                            {nextFixtureMeta}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      ref={teamSearchWrapRef}
                      className="w-full min-w-0 border-t border-gray-200 dark:border-gray-700/80 pt-2 mt-1.5 lg:mt-2 lg:pt-2"
                    >
                      <div className="relative mx-auto max-w-xl lg:max-w-lg">
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
                                          updateTeamUrl(team.href);
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
                      Team stats chart{selectedTeam ? ` · ${selectedTeam.name}` : ''}
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden px-1 py-1 sm:px-2 sm:py-2">
                      {!selectedTeam ? (
                        <div className={`flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm ${emptyText}`}>
                          Select a team above to chart Soccerway match stats.
                        </div>
                      ) : recentMatchesLoading ? (
                        <div className="h-full w-full flex flex-col" style={{ padding: '16px 8px 8px 8px' }}>
                          <div className="flex-1 flex items-end justify-center gap-1 px-2 h-full">
                            {[...Array(20)].map((_, idx) => {
                              const heights = [45, 62, 38, 71, 55, 48, 65, 42, 58, 51, 47, 63, 39, 72, 56, 49, 66, 43, 59, 52];
                              const height = heights[idx] || 48;
                              return (
                                <div
                                  key={idx}
                                  className="flex-1 max-w-[50px] flex flex-col items-center justify-end"
                                  style={{ height: '100%' }}
                                >
                                  <div
                                    className={`w-full rounded-t animate-pulse ${mounted && isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
                                    style={{
                                      height: `${height}%`,
                                      animationDelay: `${idx * 0.08}s`,
                                      minHeight: '30px',
                                      transition: 'height 0.3s ease',
                                      minWidth: '28px',
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : recentMatchesError ? (
                        <div className="px-2 py-4 text-sm text-red-600 dark:text-red-400">{recentMatchesError}</div>
                      ) : recentMatches.length === 0 ? (
                        <div className={`px-2 py-6 text-center text-sm ${emptyText}`}>No Soccerway stat history parsed for this team.</div>
                      ) : (
                        <SoccerStatsChart
                          matches={recentMatches}
                          selectedTeamName={selectedTeam.name}
                          isDark={Boolean(mounted && isDark)}
                          onSelectedStatChange={setMainChartStat}
                          onSelectedTimeframeChange={setChartTimeframe}
                          onSelectedTeamScopeChange={setChartTeamScope}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                  <h3 className={`text-sm font-semibold mb-1 px-3 sm:px-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    Supporting stats
                  </h3>
                  <div className="min-h-[220px] px-0 sm:px-0">
                    {!selectedTeam ? (
                      <div className={`min-h-[120px] flex items-center justify-center px-4 text-center text-sm ${emptyText}`}>
                        Select a team above to load supporting stats.
                      </div>
                    ) : recentMatchesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="space-y-3 w-full max-w-md">
                          <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'} mx-auto`} />
                          <div className="grid grid-cols-2 gap-4">
                            <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                            <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                          </div>
                        </div>
                      </div>
                    ) : recentMatchesError ? (
                      <div className="px-3 py-4 text-sm text-red-600 dark:text-red-400">{recentMatchesError}</div>
                    ) : (
                      <SoccerSupportingStats
                        matches={recentMatches}
                        selectedTeamName={selectedTeam.name}
                        timeframe={chartTimeframe}
                        teamScope={chartTeamScope}
                        mainChartStat={mainChartStat}
                        isDark={Boolean(mounted && isDark)}
                      />
                    )}
                  </div>
                </div>

                {/* 4.5 — mobile placeholder (right-column mirror, empty) */}
                <div className={`lg:hidden w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  <div className="min-h-[200px]" />
                </div>

                {/* 4.52 — mobile placeholder */}
                {propsMode === 'player' && (
                  <div className={`lg:hidden w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} px-2 sm:px-2.5 py-2.5 sm:py-3`}>
                    <div className="min-h-[160px]" />
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

              {/* Right panel — empty shells (layout only) */}
              <div
                className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 fade-scrollbar custom-scrollbar min-w-0 ${
                  sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
                }`}
              >
                <div className={`hidden lg:block min-h-[120px] rounded-lg ${AFL_DASH_CARD_GLOW}`} />
                <div className={`hidden lg:block h-[380px] w-full min-w-0 shrink-0 rounded-lg xl:h-[420px] ${AFL_DASH_CARD_GLOW}`} />
                <div className={`hidden lg:block min-h-[240px] w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW}`} />
                <div className={`hidden lg:block min-h-[320px] w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW}`} />
                <div className={`hidden lg:block min-h-[240px] w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW}`} />
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

export default function SoccerPage() {
  return (
    <Suspense fallback={null}>
      <SoccerPageContent />
    </Suspense>
  );
}
