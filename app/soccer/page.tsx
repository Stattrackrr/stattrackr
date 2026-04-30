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
import type { SoccerwayLineupBundle, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';
import { SoccerStatsChart, type SoccerStatTeamScope, type SoccerTimeframe } from '@/app/soccer/components/SoccerStatsChart';
import { SoccerSupportingStats } from '@/app/soccer/components/SoccerSupportingStats';
import { SoccerPredictedLineup } from '@/app/soccer/components/SoccerPredictedLineup';
import { SoccerOpponentBreakdownPanel } from '@/app/soccer/components/SoccerOpponentBreakdownPanel';
import { SoccerTeamMatchupCard } from '@/app/soccer/components/SoccerTeamMatchupCard';
import { SoccerTeamFormCard } from '@/app/soccer/components/SoccerTeamFormCard';

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
  competitionStage: string | null;
};

type SoccerPredictedLineupResponse = {
  summaryPath: string | null;
  lineupsPath: string | null;
  eventId: string | null;
  lineup: SoccerwayLineupBundle | null;
  lineupFrom?: 'upcoming' | 'previous';
};

type SoccerTeamRow = {
  name: string;
  href: string;
  competitions: Array<{ country: string; competition: string }>;
};

type SoccerDashboardSessionState = {
  team: Pick<SoccerTeamRow, 'name' | 'href'>;
  recentMatches: SoccerwayRecentMatch[];
  cachedAt: number;
};

// Bump the restore cache version when the stored match payload shape/coverage changes.
const SOCCER_DASHBOARD_SESSION_PREFIX = 'soccer-dashboard:v6:';
const EMPTY_STATS_SKELETON_MS = 5000;
const EMPTY_STATS_CACHE_RETRY_DELAY_MS = 750;
const INITIAL_RECENT_MATCHES_LIMIT = 20;

function getSoccerDashboardSessionKey(teamHref: string): string {
  return `${SOCCER_DASHBOARD_SESSION_PREFIX}${normalizeTeamHref(teamHref)}`;
}

function readSoccerDashboardSessionState(teamHref: string): SoccerDashboardSessionState | null {
  if (typeof window === 'undefined') return null;
  const normalizedHref = normalizeTeamHref(teamHref);
  if (!normalizedHref) return null;
  try {
    const raw = window.sessionStorage.getItem(getSoccerDashboardSessionKey(normalizedHref));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SoccerDashboardSessionState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const teamName = typeof parsed.team?.name === 'string' ? parsed.team.name.trim() : '';
    const teamStoredHref = typeof parsed.team?.href === 'string' ? normalizeTeamHref(parsed.team.href) : '';
    const recentMatches = Array.isArray(parsed.recentMatches) ? (parsed.recentMatches as SoccerwayRecentMatch[]) : [];
    if (!teamName || !teamStoredHref || teamStoredHref !== normalizedHref || recentMatches.length === 0) return null;
    return {
      team: { name: teamName, href: teamStoredHref },
      recentMatches,
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeSoccerDashboardSessionState(team: Pick<SoccerTeamRow, 'name' | 'href'>, recentMatches: SoccerwayRecentMatch[]): void {
  if (typeof window === 'undefined') return;
  const normalizedHref = normalizeTeamHref(team.href);
  if (!normalizedHref || !team.name.trim() || recentMatches.length === 0) return;
  try {
    const payload: SoccerDashboardSessionState = {
      team: { name: team.name.trim(), href: normalizedHref },
      recentMatches,
      cachedAt: Date.now(),
    };
    window.sessionStorage.setItem(getSoccerDashboardSessionKey(normalizedHref), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

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

function splitFixtureNameLines(value: string | null | undefined): [string, string?] {
  const name = String(value || '').trim();
  if (!name) return ['-'];
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [name];
  return [parts[0], parts.slice(1).join(' ')];
}

function sortSoccerMatchesByRecency(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return [...matches].sort((a, b) => {
    const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    if (aKickoff !== bKickoff) return bKickoff - aKickoff;
    return String(b.matchId || '').localeCompare(String(a.matchId || ''));
  });
}

function takeRecentSoccerMatches(matches: SoccerwayRecentMatch[], limit = INITIAL_RECENT_MATCHES_LIMIT): SoccerwayRecentMatch[] {
  if (matches.length <= limit) return matches;
  return sortSoccerMatchesByRecency(matches).slice(0, limit);
}

function formatFixtureStageLabel(value: string | null | undefined): string | null {
  let stage = String(value || '').trim();
  if (!stage) return null;

  if (stage.includes(' - ')) {
    stage = stage.split(' - ').map((part) => part.trim()).filter(Boolean).at(-1) || stage;
  }

  const roundNumber = stage.match(/^round\s+(\d+)$/i);
  if (roundNumber) return `RD ${roundNumber[1]}`;

  const roundOf = stage.match(/^round of\s+(\d+)$/i);
  if (roundOf) return `RD ${roundOf[1]}`;

  if (/semi-finals?/i.test(stage)) return 'Semi Final';
  if (/quarter-finals?/i.test(stage)) return 'Quarter Final';
  if (/finals?/i.test(stage)) return 'Final';

  return stage;
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
  const [subscriptionChecked, setSubscriptionChecked] = useState(false);
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
  const [allRecentMatches, setAllRecentMatches] = useState<SoccerwayRecentMatch[]>([]);
  const [recentMatchesLoading, setRecentMatchesLoading] = useState(false);
  const [recentMatchesError, setRecentMatchesError] = useState<string | null>(null);
  const [recentMatchesCacheMiss, setRecentMatchesCacheMiss] = useState(false);
  const [recentMatchesSettled, setRecentMatchesSettled] = useState(false);
  const [nextFixture, setNextFixture] = useState<SoccerNextFixture | null>(null);
  const [nextFixtureLoading, setNextFixtureLoading] = useState(false);
  const [nextFixtureError, setNextFixtureError] = useState<string | null>(null);
  const [nextFixtureCacheMiss, setNextFixtureCacheMiss] = useState(false);
  const [nextFixtureCountdown, setNextFixtureCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  const [predictedLineup, setPredictedLineup] = useState<SoccerwayLineupBundle | null>(null);
  const [predictedLineupFrom, setPredictedLineupFrom] = useState<'upcoming' | 'previous'>('upcoming');
  const [predictedLineupLoading, setPredictedLineupLoading] = useState(false);
  const [predictedLineupError, setPredictedLineupError] = useState<string | null>(null);
  const [predictedLineupCacheMiss, setPredictedLineupCacheMiss] = useState(false);
  const [mainChartStat, setMainChartStat] = useState('');
  const [chartTimeframe, setChartTimeframe] = useState<SoccerTimeframe>('last10');
  const [chartTeamScope, setChartTeamScope] = useState<SoccerStatTeamScope>('all');
  const [chartCompetition, setChartCompetition] = useState('all');
  const teamSearchWrapRef = useRef<HTMLDivElement>(null);
  const teamResultsRequestId = useRef(0);
  const nextFixtureRequestId = useRef(0);
  const predictedLineupRequestId = useRef(0);

  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } =
    useDashboardStyles({ sidebarOpen });

  const displayedRecentMatches = allRecentMatches.length > 0 ? allRecentMatches : recentMatches;

  const emptyText = mounted && isDark ? 'text-gray-500' : 'text-gray-400';
  const mainChartLoading = recentMatchesLoading || !recentMatchesSettled;
  const syncedStatsLoading = Boolean(selectedTeam) && mainChartLoading;
  const syncedFixtureStatsLoading = Boolean(selectedTeam) && (mainChartLoading || nextFixtureLoading);
  const syncedLineupLoading = Boolean(selectedTeam) && (mainChartLoading || predictedLineupLoading);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let isMounted = true;

    const checkSubscription = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        if (isMounted) {
          setIsPro(false);
          setUsername(null);
          setUserEmail(null);
          setAvatarUrl(null);
          setSubscriptionChecked(true);
          setTimeout(() => {
            router.push('/login?redirect=/soccer');
          }, 0);
        }
        return;
      }

      const user = session.user;
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, username, avatar_url, subscription_status, subscription_tier')
          .eq('id', user.id)
          .single();
        if (!isMounted) return;
        const p = profile as {
          full_name?: string;
          username?: string;
          avatar_url?: string;
          subscription_status?: string;
          subscription_tier?: string;
        } | null;
        setUserEmail(user.email ?? null);
        setUsername(p?.full_name || p?.username || user.user_metadata?.username || user.user_metadata?.full_name || null);
        setAvatarUrl(p?.avatar_url ?? user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null);
        const active = p?.subscription_status === 'active' || p?.subscription_status === 'trialing';
        const proTier = p?.subscription_tier === 'pro';
        setIsPro(Boolean(active && proTier));
        setSubscriptionChecked(true);
      } catch (e) {
        console.error('Soccer page: profile load failed', e);
        if (isMounted) setSubscriptionChecked(true);
      }
    };
    void checkSubscription();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          setIsPro(false);
          setUsername(null);
          setUserEmail(null);
          setAvatarUrl(null);
          setSubscriptionChecked(true);
          router.push('/login?redirect=/soccer');
        }
      } else if (event === 'SIGNED_IN' && isMounted && session?.user) {
        void checkSubscription();
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (subscriptionChecked && !isPro) {
      router.replace('/home#pricing');
    }
  }, [subscriptionChecked, isPro, router]);

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
    if (!subscriptionChecked || !isPro) return;
    void loadSample();
  }, [isPro, loadSample, subscriptionChecked]);

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

  useEffect(() => {
    if (!teamHrefFromUrl) return;
    const cached = readSoccerDashboardSessionState(teamHrefFromUrl);
    if (!cached) return;
    const cachedVisibleMatches = takeRecentSoccerMatches(cached.recentMatches);

    setSelectedTeam((prev) => {
      if (normalizeTeamHref(prev?.href) === cached.team.href) return prev;
      return {
        name: cached.team.name,
        href: cached.team.href,
        competitions: [],
      };
    });
    setTeamSearchQuery((prev) => prev || cached.team.name);
    setRecentMatches((prev) => (prev.length > 0 ? prev : cachedVisibleMatches));
    setAllRecentMatches((prev) => (prev.length > 0 ? prev : cached.recentMatches));
    setRecentMatchesError(null);
    setRecentMatchesCacheMiss(false);
    setRecentMatchesLoading(false);
    setRecentMatchesSettled(true);
  }, [teamHrefFromUrl]);

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
      setAllRecentMatches([]);
      setRecentMatchesError(null);
      setRecentMatchesCacheMiss(false);
      setRecentMatchesLoading(false);
      setRecentMatchesSettled(false);
      return;
    }

    const requestId = (teamResultsRequestId.current += 1);
    const ac = new AbortController();
    const requestStartedAt = Date.now();
    const href = selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`;
    const cached = readSoccerDashboardSessionState(href);
    const cachedMatches = Array.isArray(cached?.recentMatches) ? cached.recentMatches : [];
    const initialCachedMatches = takeRecentSoccerMatches(cachedMatches);
    const hasCachedMatches = cachedMatches.length > 0;
    const hasFullCachedMatches = cachedMatches.length > initialCachedMatches.length;
    const waitWithAbort = async (delayMs: number) => {
      if (delayMs <= 0) return;
      await new Promise<void>((resolve) => {
        const timeoutId = window.setTimeout(() => resolve(), delayMs);
        ac.signal.addEventListener(
          'abort',
          () => {
            window.clearTimeout(timeoutId);
            resolve();
          },
          { once: true }
        );
      });
    };
    const fetchCachedTeamResults = async (options?: { limitMatches?: number }) => {
      const params = new URLSearchParams({ href, cacheOnly: '1' });
      if (options?.limitMatches) params.set('limitMatches', String(options.limitMatches));
      const response = await fetch(`/api/soccer/team-results?${params.toString()}`, {
        signal: ac.signal,
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        matches?: SoccerwayRecentMatch[];
        totalCount?: number;
        hasMore?: boolean;
        cache?: { teamResultsSource?: string };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load recent matches');
      }
      return payload;
    };
    const waitForEmptyStateSkeleton = async () => {
      if (hasCachedMatches) return;
      const remainingMs = Math.max(0, EMPTY_STATS_SKELETON_MS - (Date.now() - requestStartedAt));
      await waitWithAbort(remainingMs);
    };

    if (hasCachedMatches) {
      setRecentMatches(initialCachedMatches);
      setAllRecentMatches(cachedMatches);
      setRecentMatchesCacheMiss(false);
      setRecentMatchesLoading(false);
      setRecentMatchesSettled(true);
    } else {
      setRecentMatchesLoading(true);
      setRecentMatchesSettled(false);
    }
    setRecentMatchesError(null);

    void fetchCachedTeamResults({ limitMatches: INITIAL_RECENT_MATCHES_LIMIT })
      .then(async (response) => {
        let payload = response;
        let matches = Array.isArray(payload?.matches) ? payload.matches : [];
        let totalCount = Number(payload?.totalCount || matches.length);
        let hasMore = Boolean(payload?.hasMore);
        let source = payload?.cache?.teamResultsSource ?? null;

        while (
          !hasCachedMatches &&
          !ac.signal.aborted &&
          (source === 'cache-miss' || matches.length === 0) &&
          Date.now() - requestStartedAt < EMPTY_STATS_SKELETON_MS
        ) {
          await waitWithAbort(EMPTY_STATS_CACHE_RETRY_DELAY_MS);
          if (ac.signal.aborted) break;
          payload = await fetchCachedTeamResults({ limitMatches: INITIAL_RECENT_MATCHES_LIMIT });
          matches = Array.isArray(payload?.matches) ? payload.matches : [];
          totalCount = Number(payload?.totalCount || matches.length);
          hasMore = Boolean(payload?.hasMore);
          source = payload?.cache?.teamResultsSource ?? null;
        }

        const shouldDelayEmptyState = matches.length === 0;

        if (shouldDelayEmptyState && !ac.signal.aborted) {
          await waitForEmptyStateSkeleton();
        }

        if (teamResultsRequestId.current !== requestId) return;
        setRecentMatchesCacheMiss(source === 'cache-miss');
        setRecentMatches(takeRecentSoccerMatches(matches));
        if (matches.length > 0) {
          if (!hasMore || totalCount <= matches.length) {
            setAllRecentMatches(matches);
            writeSoccerDashboardSessionState({ name: selectedTeam.name, href }, matches);
          } else if (!hasCachedMatches) {
            setAllRecentMatches([]);
          }

          if ((hasMore || totalCount > matches.length) && !hasFullCachedMatches) {
            void fetchCachedTeamResults()
              .then((fullPayload) => {
                if (ac.signal.aborted) return;
                if (teamResultsRequestId.current !== requestId) return;
                const fullMatches = Array.isArray(fullPayload?.matches) ? fullPayload.matches : [];
                if (fullMatches.length <= matches.length) return;
                setAllRecentMatches(fullMatches);
                writeSoccerDashboardSessionState({ name: selectedTeam.name, href }, fullMatches);
              })
              .catch(() => undefined);
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (teamResultsRequestId.current !== requestId) return;
        setRecentMatchesCacheMiss(false);
        if (!hasCachedMatches) {
          setRecentMatches([]);
          setAllRecentMatches([]);
          setRecentMatchesError(err instanceof Error ? err.message : 'Failed to load recent matches');
        }
      })
      .finally(() => {
        if (teamResultsRequestId.current === requestId) {
          setRecentMatchesLoading(false);
          setRecentMatchesSettled(true);
        }
      });

    return () => ac.abort();
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedTeam) {
      setNextFixture(null);
      setNextFixtureError(null);
      setNextFixtureCacheMiss(false);
      setNextFixtureLoading(false);
      return;
    }

    const requestId = (nextFixtureRequestId.current += 1);
    const ac = new AbortController();
    setNextFixtureLoading(true);
    setNextFixtureError(null);
    setNextFixtureCacheMiss(false);

    const href = selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`;
    void fetch(`/api/soccer/next-game?href=${encodeURIComponent(href)}&cacheOnly=1`, { signal: ac.signal, cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          fixture?: SoccerNextFixture | null;
          cache?: { source?: string };
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load next fixture');
        }
        if (nextFixtureRequestId.current !== requestId) return;
        setNextFixtureCacheMiss(payload?.cache?.source === 'cache-miss');
        setNextFixture(payload?.fixture ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (nextFixtureRequestId.current !== requestId) return;
        setNextFixture(null);
        setNextFixtureCacheMiss(false);
        setNextFixtureError(err instanceof Error ? err.message : 'Failed to load next fixture');
      })
      .finally(() => {
        if (nextFixtureRequestId.current === requestId) {
          setNextFixtureLoading(false);
        }
      });

    return () => ac.abort();
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedTeam) {
      setPredictedLineup(null);
      setPredictedLineupFrom('upcoming');
      setPredictedLineupError(null);
      setPredictedLineupCacheMiss(false);
      setPredictedLineupLoading(false);
      return;
    }

    const requestId = (predictedLineupRequestId.current += 1);
    const ac = new AbortController();
    setPredictedLineupLoading(true);
    setPredictedLineupError(null);
    setPredictedLineupCacheMiss(false);
    setPredictedLineupFrom('upcoming');

    const href = selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`;
    void fetch(`/api/soccer/predicted-lineup?href=${encodeURIComponent(href)}&cacheOnly=1`, {
      signal: ac.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | (SoccerPredictedLineupResponse & { error?: string; cache?: { source?: string } })
          | null;
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load lineup');
        }

        if (predictedLineupRequestId.current !== requestId) return;
        setPredictedLineupCacheMiss(payload?.cache?.source === 'cache-miss');
        setPredictedLineupFrom(payload?.lineupFrom === 'previous' ? 'previous' : 'upcoming');
        setPredictedLineup(payload?.lineup ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (predictedLineupRequestId.current !== requestId) return;
        setPredictedLineup(null);
        setPredictedLineupCacheMiss(false);
        setPredictedLineupError(err instanceof Error ? err.message : 'Failed to load lineup');
      })
      .finally(() => {
        if (predictedLineupRequestId.current === requestId) {
          setPredictedLineupLoading(false);
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
  const nextOpponentHrefForPanel = useMemo(() => {
    if (!displayOpponent || teamUniverse.length === 0) return null;
    const normalizeToken = (value: string | null | undefined) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s*\([^)]+\)\s*/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const target = displayOpponent
      .toLowerCase()
      .replace(/\s*\([^)]+\)\s*$/g, '')
      .trim();
    const competitionToken = normalizeToken(nextFixture?.competitionName);
    const countryToken = normalizeToken(nextFixture?.competitionCountry);
    const inFixtureLeague = (t: SoccerTeamRow) =>
      t.competitions.some(
        (c) =>
          normalizeToken(c.competition) === competitionToken &&
          (!countryToken || normalizeToken(c.country) === countryToken)
      );
    const exactLeagueMatch = teamUniverse.find((t) => t.name.toLowerCase() === target && inFixtureLeague(t));
    if (exactLeagueMatch) return normalizeTeamHref(exactLeagueMatch.href);
    const fuzzyLeagueMatch = teamUniverse.find(
      (t) =>
        inFixtureLeague(t) &&
        (t.name.toLowerCase().includes(target) || (target.length >= 3 && target.includes(t.name.toLowerCase())))
    );
    if (fuzzyLeagueMatch) return normalizeTeamHref(fuzzyLeagueMatch.href);
    const anyMatch = teamUniverse.find((t) => t.name.toLowerCase() === target);
    return anyMatch ? normalizeTeamHref(anyMatch.href) : null;
  }, [displayOpponent, nextFixture?.competitionCountry, nextFixture?.competitionName, teamUniverse]);
  const fixturePrimaryName = nextFixture?.isHome === false ? displayOpponent : selectedHeaderTeamName;
  const fixtureSecondaryName = nextFixture?.isHome === false ? selectedHeaderTeamName : displayOpponent;
  const fixturePrimaryLogoUrl =
    nextFixture?.isHome === false ? nextFixture?.opponentLogoUrl ?? null : nextFixture?.teamLogoUrl ?? null;
  const fixtureSecondaryLogoUrl =
    nextFixture?.isHome === false ? nextFixture?.teamLogoUrl ?? null : nextFixture?.opponentLogoUrl ?? null;
  const fixturePrimaryAlt = nextFixture?.isHome === false ? displayOpponent ?? 'Home team' : selectedHeaderTeamName ?? 'Selected team';
  const fixtureSecondaryAlt = nextFixture?.isHome === false ? selectedHeaderTeamName ?? 'Selected team' : displayOpponent ?? 'Away team';
  const fixturePrimaryLines = splitFixtureNameLines(fixturePrimaryName);
  const fixtureSecondaryLines = splitFixtureNameLines(fixtureSecondaryName);
  const recentMatchesEmptyMessage = 'No data available come back later';
  const nextFixtureMeta = useMemo(() => {
    if (!selectedTeam) return null;
    if (nextFixtureLoading) return { primary: 'Loading next fixture...', secondary: null, isError: false };
    if (nextFixtureError) return { primary: nextFixtureError, secondary: null, isError: true };
    if (nextFixtureCacheMiss) return { primary: 'No cached upcoming fixture yet.', secondary: null, isError: false };
    if (!nextFixture) return { primary: 'No upcoming fixture found on Soccerway.', secondary: null, isError: false };

    const competition = String(nextFixture.competitionName || '').trim();
    const stage = formatFixtureStageLabel(nextFixture.competitionStage);
    const primary = [competition, stage].filter(Boolean).join(' · ') || null;

    const secondaryParts: string[] = [];
    if (nextFixtureKickoff) {
      secondaryParts.push(
        nextFixtureKickoff.toLocaleString([], {
          month: 'short',
          day: 'numeric',
        })
      );
    }
    if (nextFixture.isHome === true) secondaryParts.push('Home');
    else if (nextFixture.isHome === false) secondaryParts.push('Away');

    return {
      primary,
      secondary: secondaryParts.join(' · ') || null,
      isError: false,
    };
  }, [nextFixture, nextFixtureCacheMiss, nextFixtureError, nextFixtureKickoff, nextFixtureLoading, selectedTeam]);

  if (subscriptionChecked && !isPro) {
    return null;
  }

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
                          <div className="flex items-center gap-2 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 xl:px-2.5 xl:py-1.5 min-w-0 flex-shrink overflow-hidden">
                            <div className="flex flex-col items-center justify-center w-14 xl:w-[72px] min-w-0 flex-shrink-0">
                              <div className="flex items-center justify-center w-6 h-6 xl:w-8 xl:h-8 flex-shrink-0">
                                {fixturePrimaryLogoUrl ? (
                                  <img
                                    src={fixturePrimaryLogoUrl}
                                    alt={fixturePrimaryAlt}
                                    className="w-5 h-5 xl:w-7 xl:h-7 object-contain flex-shrink-0"
                                  />
                                ) : <span className="text-gray-400 dark:text-gray-500 font-medium text-xs">-</span>}
                              </div>
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] xl:text-[11px] font-medium text-gray-900 dark:text-white truncate">{fixturePrimaryLines[0]}</div>
                                {fixturePrimaryLines[1] ? (
                                  <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 truncate">{fixturePrimaryLines[1]}</div>
                                ) : null}
                              </div>
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
                            <div className="flex flex-col items-center justify-center w-14 xl:w-[72px] min-w-0 flex-shrink-0">
                              {fixtureSecondaryLogoUrl ? (
                                <img
                                  src={fixtureSecondaryLogoUrl}
                                  alt={fixtureSecondaryAlt}
                                  className="w-5 h-5 xl:w-7 xl:h-7 object-contain flex-shrink-0"
                                />
                              ) : <span className="text-gray-400 dark:text-gray-500 font-medium text-xs">-</span>}
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] xl:text-[11px] font-medium text-gray-900 dark:text-white truncate">{fixtureSecondaryLines[0]}</div>
                                {fixtureSecondaryLines[1] ? (
                                  <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 truncate">{fixtureSecondaryLines[1]}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          {nextFixtureMeta ? (
                            <div className={`text-[10px] xl:text-[11px] text-center w-full leading-tight ${nextFixtureMeta.isError ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-300'}`}>
                              {nextFixtureMeta.primary ? <div>{nextFixtureMeta.primary}</div> : null}
                              {nextFixtureMeta.secondary ? <div>{nextFixtureMeta.secondary}</div> : null}
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
                            <div className="flex flex-col items-center justify-center w-14 sm:w-[68px] min-w-0 flex-shrink-0">
                              <div className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0">
                                {fixturePrimaryLogoUrl ? (
                                  <img
                                    src={fixturePrimaryLogoUrl}
                                    alt={fixturePrimaryAlt}
                                    className="w-5 h-5 sm:w-6 sm:h-6 object-contain flex-shrink-0"
                                  />
                                ) : <span className="text-gray-400 dark:text-gray-500 font-medium text-xs">-</span>}
                              </div>
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] font-medium text-gray-900 dark:text-white truncate">{fixturePrimaryLines[0]}</div>
                                {fixturePrimaryLines[1] ? (
                                  <div className="text-[9px] text-gray-500 dark:text-gray-400 truncate">{fixturePrimaryLines[1]}</div>
                                ) : null}
                              </div>
                            </div>
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs">VS</span>
                            <div className="flex flex-col items-center justify-center w-14 sm:w-[68px] min-w-0 flex-shrink-0">
                              <div className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0">
                                {fixtureSecondaryLogoUrl ? (
                                  <img
                                    src={fixtureSecondaryLogoUrl}
                                    alt={fixtureSecondaryAlt}
                                    className="w-5 h-5 sm:w-6 sm:h-6 object-contain flex-shrink-0"
                                  />
                                ) : <span className="text-gray-400 dark:text-gray-500 font-medium text-xs">-</span>}
                              </div>
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] font-medium text-gray-900 dark:text-white truncate">{fixtureSecondaryLines[0]}</div>
                                {fixtureSecondaryLines[1] ? (
                                  <div className="text-[9px] text-gray-500 dark:text-gray-400 truncate">{fixtureSecondaryLines[1]}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                        {nextFixtureMeta ? (
                          <div className={`text-center text-[10px] leading-tight ${nextFixtureMeta.isError ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-300'}`}>
                            {nextFixtureMeta.primary ? <div>{nextFixtureMeta.primary}</div> : null}
                            {nextFixtureMeta.secondary ? <div>{nextFixtureMeta.secondary}</div> : null}
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
                      ) : mainChartLoading ? (
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
                      ) : displayedRecentMatches.length === 0 ? (
                        <div className={`px-2 py-6 text-center text-sm ${emptyText}`}>{recentMatchesEmptyMessage}</div>
                      ) : (
                        <SoccerStatsChart
                          matches={displayedRecentMatches}
                          selectedTeamName={selectedTeam.name}
                          nextOpponentName={displayOpponent}
                          isDark={Boolean(mounted && isDark)}
                          onSelectedStatChange={setMainChartStat}
                          onSelectedTimeframeChange={setChartTimeframe}
                          onSelectedTeamScopeChange={setChartTeamScope}
                          onSelectedCompetitionChange={setChartCompetition}
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
                    ) : syncedStatsLoading ? (
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
                    ) : displayedRecentMatches.length === 0 ? (
                      <div className={`px-3 py-4 text-center text-sm ${emptyText}`}>{recentMatchesEmptyMessage}</div>
                    ) : (
                      <SoccerSupportingStats
                        matches={displayedRecentMatches}
                        selectedTeamName={selectedTeam.name}
                        nextOpponentName={displayOpponent}
                        timeframe={chartTimeframe}
                        teamScope={chartTeamScope}
                        competitionFilter={chartCompetition}
                        mainChartStat={mainChartStat}
                        isDark={Boolean(mounted && isDark)}
                      />
                    )}
                  </div>
                </div>

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                  {!selectedTeam ? (
                    <div className={`px-3 sm:px-4 text-sm ${emptyText}`}>Select a team above to load predicted lineups.</div>
                  ) : syncedLineupLoading ? (
                    <div className="px-3 sm:px-4">
                      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {[0, 1].map((idx) => (
                          <div key={idx} className={`rounded-xl border p-4 ${isDark ? 'border-white/10 bg-[#07131f]' : 'border-gray-200 bg-gray-50/80'}`}>
                            <div className={`mb-3 h-4 w-28 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                            <div className={`h-[280px] rounded-2xl animate-pulse ${isDark ? 'bg-emerald-950/70' : 'bg-emerald-100'}`} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : predictedLineupError ? (
                    <div className="px-3 sm:px-4 text-sm text-red-600 dark:text-red-400">{predictedLineupError}</div>
                  ) : predictedLineupCacheMiss ? (
                    <div className={`px-3 sm:px-4 text-sm ${emptyText}`}>No data available come back later</div>
                  ) : (
                    <SoccerPredictedLineup
                      lineup={predictedLineup}
                      isDark={Boolean(mounted && isDark)}
                      lineupFrom={predictedLineupFrom}
                    />
                  )}
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
                <div className={`hidden lg:block min-h-[120px] w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW}`} />
                <div className={`hidden lg:block h-[380px] w-full min-w-0 shrink-0 rounded-lg xl:h-[420px] ${AFL_DASH_CARD_GLOW} overflow-hidden`}>
                  <SoccerOpponentBreakdownPanel
                    isDark={Boolean(mounted && isDark)}
                    nextCompetitionName={nextFixture?.competitionName ?? null}
                    nextCompetitionCountry={nextFixture?.competitionCountry ?? null}
                    opponentName={displayOpponent}
                    opponentHref={nextOpponentHrefForPanel}
                    emptyTextClass={emptyText}
                    showSkeleton={syncedFixtureStatsLoading}
                  />
                </div>
                <div className={`hidden lg:block h-[360px] w-full min-w-0 shrink-0 rounded-lg xl:h-[400px] ${AFL_DASH_CARD_GLOW} overflow-hidden`}>
                  <SoccerTeamMatchupCard
                    isDark={Boolean(mounted && isDark)}
                    teamName={selectedTeam?.name ?? null}
                    teamHref={selectedTeam?.href ?? null}
                    opponentName={displayOpponent}
                    opponentHref={nextOpponentHrefForPanel}
                    nextCompetitionName={nextFixture?.competitionName ?? null}
                    nextCompetitionCountry={nextFixture?.competitionCountry ?? null}
                    emptyTextClass={emptyText}
                    showSkeleton={syncedFixtureStatsLoading}
                  />
                </div>
                <div className={`hidden lg:block h-[420px] w-full min-w-0 shrink-0 rounded-lg xl:h-[460px] ${AFL_DASH_CARD_GLOW} overflow-hidden`}>
                  <SoccerTeamFormCard
                    isDark={Boolean(mounted && isDark)}
                    teamName={selectedTeam?.name ?? null}
                    teamHref={selectedTeam?.href ?? null}
                    opponentName={displayOpponent}
                    opponentHref={nextOpponentHrefForPanel}
                    nextCompetitionName={nextFixture?.competitionName ?? null}
                    nextCompetitionCountry={nextFixture?.competitionCountry ?? null}
                    emptyTextClass={emptyText}
                    showSkeleton={syncedFixtureStatsLoading}
                  />
                </div>
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
