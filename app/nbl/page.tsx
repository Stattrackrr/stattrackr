'use client';

/**
 * NBL research dashboard — AFL layout parity including refresh screen logic:
 * localStorage page state, URL sync, loading shells, and client game-logs cache.
 */

import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import { NblStatsChart, type NblChartTimeframe } from '@/app/nbl/components/NblStatsChart';
import {
  NblSupportingStats,
  defaultSupportingStatForMain,
  type SupportingStatKind,
} from '@/app/nbl/components/NblSupportingStats';
import {
  DEFAULT_NBL_GAME_FILTERS,
  type NblGameFiltersState,
} from '@/app/nbl/components/NblGameFilters';
import { NblBoxScore } from '@/app/nbl/components/NblBoxScore';
import { NblShotChart } from '@/app/nbl/components/NblShotChart';
import NblDvpCard, { PlayTypesInfoButton } from '@/app/nbl/components/NblDvpCard';
import NblOpponentBreakdownCard from '@/app/nbl/components/NblOpponentBreakdownCard';
import NblTeamMatchupCard from '@/app/nbl/components/NblTeamMatchupCard';
import { NblTeamSelectionsCard } from '@/app/nbl/components/NblTeamSelectionsCard';
import { NblLineSelector } from '@/app/nbl/components/NblLineSelector';
import { NblInjuriesCard } from '@/app/nbl/components/NblInjuriesCard';
import { NblLadderCard } from '@/app/nbl/components/NblLadderCard';
import { NblSimilarPlayersCard } from '@/app/nbl/components/NblSimilarPlayersCard';
import { NblPlayerVsTeamPanel } from '@/app/nbl/components/NblPlayerVsTeamPanel';
import { NBL_DASH_CARD_GLOW } from '@/app/nbl/components/nblDashCardGlow';
import { NblScoringMixPie } from '@/app/nbl/components/NblScoringMixPie';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchProfileProStatusWithRetries } from '@/lib/profileSubscriptionGate';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { DEFAULT_ODDS_FORMAT, readOddsFormatPreference } from '@/lib/currencyUtils';
import {
  NBL_CHART_HISTORY_YEARS,
  NBL_CLUBS,
  NBL_CURRENT_SEASON_YEAR,
  NBL_SHOT_CHART_SEASON_YEAR,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';
import { defaultNblTeamStat, isNblTeamGameStat } from '@/lib/nbl/teamGameLogsShared';
import { nblQuarterParentStat } from '@/lib/nbl/pbpShared';
import {
  nblBookLines,
  nblOddsMarketForStat,
  parseNblOddsLine,
  type NblBookRow,
} from '@/lib/nbl/oddsTypes';
import { normalizeNblStat } from '@/lib/propsDashboardLinks';
import { consumePropsReturnPath } from '@/lib/propsPageSessionCache';
import { readNblNextGamePrefetch, writeNblNextGamePrefetch } from '@/lib/nbl/nblNextGamePrefetch';
import {
  NBL_PLAY_TYPE_FULL_LABELS,
  type NblPlayTypeId,
} from '@/lib/nbl/playTypesShared';

/** Basketball tipoff LIVE window (~2.5h). */
const NBL_MATCH_DURATION_MS = 2.5 * 60 * 60 * 1000;
const EMPTY_NBL_ODDS_BOOKS: NblBookRow[] = [];

type NblPropsMode = 'player' | 'team';
type NblRightTab = 'dvp' | 'breakdown' | 'team_matchup';
type NblPlayerVsTab = 'comparison' | 'similar';

type NblRosterPlayer = {
  playerId: string | null;
  name: string;
  team: string;
  teamCode: string | null;
  teamId: string | null;
  position: string | null;
  jersey: string | null;
  imageUrl: string | null;
};

function resolveNblTeamLogo(teamName: string, logoByTeam: Record<string, string>): string | null {
  if (!teamName) return null;
  if (logoByTeam[teamName]) return logoByTeam[teamName];
  const normalized = normalizeTeamKey(teamName);
  if (logoByTeam[normalized]) return logoByTeam[normalized];
  for (const [key, url] of Object.entries(logoByTeam)) {
    if (normalizeTeamKey(key) === normalized) return url;
  }
  const club = resolveNblClubName(teamName);
  if (club && logoByTeam[club]) return logoByTeam[club];
  return null;
}

function getNblTeamAbbrev(teamName: string): string {
  const club = NBL_CLUBS.find(
    (c) =>
      c.name === teamName ||
      normalizeTeamKey(c.name) === normalizeTeamKey(teamName) ||
      c.code === teamName.toUpperCase() ||
      normalizeTeamKey(c.shortName) === normalizeTeamKey(teamName)
  );
  return club?.code ?? teamName.slice(0, 3).toUpperCase();
}

const NBL_TEAM_FILTER_OPTIONS = ['All', ...NBL_CLUBS.map((c) => c.name)];
const NBL_PAGE_STATE_KEY = 'nblPageState:v1';
const NBL_PLAYER_LOGS_CACHE_PREFIX = 'nblPlayerLogsCache:v3';
const NBL_PLAYER_LOGS_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const CHART_DISPLAY_DELAY_MS = 120;
const NBL_CHART_TIMEFRAMES: readonly NblChartTimeframe[] = [
  'last5',
  'last10',
  'last15',
  'last20',
  'last50',
  'h2h',
  'season2026',
  'season2025',
  'season2024',
  'season2023',
];

type PersistedNblPageState = {
  selectedPlayer: NblRosterPlayer | null;
  selectedTeam: string | null;
  nblPropsMode: NblPropsMode;
  nblTeamFilter?: string;
  nblRightTab: NblRightTab;
  chartTimeframe: NblChartTimeframe;
  mainChartStat?: string;
  nblGameFilters?: NblGameFiltersState | null;
};

type CachedNblPlayerLogs = {
  createdAt: number;
  years: number[];
  games: NblGameLogRow[];
};

function normalizeNblPlayerNameForMatch(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function nblPlayerLogsCacheKey(playerId: string): string {
  return `${NBL_PLAYER_LOGS_CACHE_PREFIX}:${playerId}:${NBL_CHART_HISTORY_YEARS.join(',')}`;
}

function parseIncomingNblLine(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeNblBookName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function nblBookHasLineValue(book: NblBookRow | undefined, value: number | null): boolean {
  if (!book || value == null || !Number.isFinite(value)) return false;
  if (
    nblBookLines(book).some((l) => {
      const n = parseNblOddsLine(l.line);
      return n != null && Math.abs(n - value) < 0.01;
    })
  ) {
    return true;
  }
  const total = parseNblOddsLine(book.Total?.line);
  const spread = parseNblOddsLine(book.Spread?.line);
  return (
    (total != null && Math.abs(total - value) < 0.01) ||
    (spread != null && Math.abs(spread - value) < 0.01)
  );
}

function readPersistedNblPageState(): Partial<PersistedNblPageState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(NBL_PAGE_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<PersistedNblPageState>;
  } catch {
    return null;
  }
}

function readInitialNblSelection(): {
  selectedPlayer: NblRosterPlayer | null;
  selectedTeam: string | null;
  nblPropsMode: NblPropsMode;
  nblRightTab: NblRightTab;
  nblTeamFilter: string;
  chartTimeframe: NblChartTimeframe;
  mainChartStat: string;
  nblGameFilters: NblGameFiltersState;
  searchQuery: string;
  fromUrl: boolean;
  incomingLine: number | null;
  incomingBookmaker: string | null;
  incomingOpponent: string | null;
} {
  const empty = {
    selectedPlayer: null as NblRosterPlayer | null,
    selectedTeam: null as string | null,
    nblPropsMode: 'player' as NblPropsMode,
    nblRightTab: 'dvp' as NblRightTab,
    nblTeamFilter: 'All',
    chartTimeframe: 'last10' as NblChartTimeframe,
    mainChartStat: 'points',
    nblGameFilters: { ...DEFAULT_NBL_GAME_FILTERS },
    searchQuery: '',
    fromUrl: false,
    incomingLine: null as number | null,
    incomingBookmaker: null as string | null,
    incomingOpponent: null as string | null,
  };
  if (typeof window === 'undefined') return empty;

  const url = new URL(window.location.href);
  const playerParam = url.searchParams.get('player')?.trim() || '';
  const nameParam = url.searchParams.get('name')?.trim() || '';
  const teamParam = url.searchParams.get('team')?.trim() || '';
  const targetName = playerParam || nameParam;
  const persisted = readPersistedNblPageState();

  // Prefer a full persisted player when URL name matches (keeps playerId).
  if (targetName) {
    const persistedPlayer =
      persisted?.selectedPlayer && typeof persisted.selectedPlayer === 'object'
        ? (persisted.selectedPlayer as NblRosterPlayer)
        : null;
    const sameName =
      persistedPlayer &&
      normalizeNblPlayerNameForMatch(persistedPlayer.name) ===
        normalizeNblPlayerNameForMatch(targetName);
    let player: NblRosterPlayer = sameName
      ? persistedPlayer!
      : {
          playerId: null,
          name: targetName,
          team: teamParam || persistedPlayer?.team || '',
          teamCode: sameName ? persistedPlayer!.teamCode : null,
          teamId: sameName ? persistedPlayer!.teamId : null,
          position: sameName ? persistedPlayer!.position : null,
          jersey: sameName ? persistedPlayer!.jersey : null,
          imageUrl: sameName ? persistedPlayer!.imageUrl : null,
        };
    const tf = url.searchParams.get('tf')?.trim() || '';
    const stat = url.searchParams.get('stat')?.trim() || '';
    const incomingLine = parseIncomingNblLine(url.searchParams.get('line'));
    const incomingBookmaker = url.searchParams.get('bookmaker')?.trim() || null;
    const incomingOpponent = url.searchParams.get('opponent')?.trim() || null;
    const pid = url.searchParams.get('pid')?.trim() || '';
    if (pid && !player.playerId) {
      player = { ...player, playerId: pid };
    }
    return {
      ...empty,
      selectedPlayer: player,
      selectedTeam: player.team || teamParam || null,
      nblPropsMode: 'player',
      nblRightTab: 'dvp',
      searchQuery: player.name,
      mainChartStat: stat ? normalizeNblStat(stat) : empty.mainChartStat,
      chartTimeframe:
        tf && (NBL_CHART_TIMEFRAMES as readonly string[]).includes(tf)
          ? (tf as NblChartTimeframe)
          : empty.chartTimeframe,
      fromUrl: true,
      incomingLine,
      incomingBookmaker,
      incomingOpponent,
    };
  }

  const modeParam = url.searchParams.get('mode')?.trim();
  if (modeParam === 'team' && teamParam) {
    const tf = url.searchParams.get('tf')?.trim() || '';
    const stat = url.searchParams.get('stat')?.trim() || '';
    const incomingLine = parseIncomingNblLine(url.searchParams.get('line'));
    const incomingBookmaker = url.searchParams.get('bookmaker')?.trim() || null;
    const incomingOpponent = url.searchParams.get('opponent')?.trim() || null;
    const persistedPlayer =
      persisted?.selectedPlayer && typeof persisted.selectedPlayer === 'object'
        ? (persisted.selectedPlayer as NblRosterPlayer)
        : null;
    const officialTeam = resolveNblClubName(teamParam) || teamParam;
    return {
      ...empty,
      selectedPlayer: persistedPlayer,
      selectedTeam: officialTeam,
      nblPropsMode: 'team',
      nblRightTab: 'breakdown',
      searchQuery: officialTeam,
      mainChartStat: defaultNblTeamStat(stat),
      chartTimeframe:
        tf && (NBL_CHART_TIMEFRAMES as readonly string[]).includes(tf)
          ? (tf as NblChartTimeframe)
          : empty.chartTimeframe,
      fromUrl: true,
      incomingLine,
      incomingBookmaker,
      incomingOpponent,
    };
  }

  if (!persisted) return empty;

  const player =
    persisted.selectedPlayer && typeof persisted.selectedPlayer === 'object'
      ? (persisted.selectedPlayer as NblRosterPlayer)
      : null;
  const mode =
    persisted.nblPropsMode === 'team' || persisted.nblPropsMode === 'player'
      ? persisted.nblPropsMode
      : 'player';
  const rightTab =
    persisted.nblRightTab === 'breakdown' ||
    persisted.nblRightTab === 'team_matchup' ||
    persisted.nblRightTab === 'dvp'
      ? persisted.nblRightTab
      : 'dvp';
  const tf =
    typeof persisted.chartTimeframe === 'string' &&
    (NBL_CHART_TIMEFRAMES as readonly string[]).includes(persisted.chartTimeframe)
      ? (persisted.chartTimeframe as NblChartTimeframe)
      : 'last10';

  return {
    selectedPlayer: player,
    selectedTeam:
      typeof persisted.selectedTeam === 'string' && persisted.selectedTeam.trim()
        ? persisted.selectedTeam
        : player?.team || null,
    nblPropsMode: mode,
    nblRightTab: rightTab,
    nblTeamFilter:
      typeof persisted.nblTeamFilter === 'string' &&
      NBL_TEAM_FILTER_OPTIONS.includes(persisted.nblTeamFilter)
        ? persisted.nblTeamFilter
        : 'All',
    chartTimeframe: tf,
    mainChartStat:
      mode === 'team'
        ? defaultNblTeamStat(
            typeof persisted.mainChartStat === 'string' ? persisted.mainChartStat : null
          )
        : typeof persisted.mainChartStat === 'string' && persisted.mainChartStat.trim()
          ? persisted.mainChartStat
          : 'points',
    nblGameFilters:
      persisted.nblGameFilters && typeof persisted.nblGameFilters === 'object'
        ? { ...DEFAULT_NBL_GAME_FILTERS, ...persisted.nblGameFilters }
        : { ...DEFAULT_NBL_GAME_FILTERS },
    searchQuery: player?.name || (mode === 'team' ? String(persisted.selectedTeam || '') : ''),
    fromUrl: false,
    incomingLine: null,
    incomingBookmaker: null,
    incomingOpponent: null,
  };
}

export default function NblDashboardPage() {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [navigatingToProps, setNavigatingToProps] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [oddsFormat, setOddsFormat] = useState(DEFAULT_ODDS_FORMAT);
  const [isPro, setIsPro] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // SSR-safe defaults only — restore from localStorage/URL after mount (avoids hydration mismatch).
  const [nblPropsMode, setNblPropsMode] = useState<NblPropsMode>('player');
  const [nblRightTab, setNblRightTab] = useState<NblRightTab>('dvp');
  const [nblRightTabsVisited, setNblRightTabsVisited] = useState<Set<NblRightTab>>(
    () => new Set(['dvp'])
  );
  const [playerVsContainerTab, setPlayerVsContainerTab] = useState<NblPlayerVsTab>('comparison');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [rosterPlayers, setRosterPlayers] = useState<NblRosterPlayer[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [logoByTeam, setLogoByTeam] = useState<Record<string, string>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<NblRosterPlayer | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [selectedPlayerGameLogs, setSelectedPlayerGameLogs] = useState<NblGameLogRow[]>([]);
  const [playerPlayTypeLabel, setPlayerPlayTypeLabel] = useState<string | null>(null);
  const [selectedTeamGameLogs, setSelectedTeamGameLogs] = useState<Array<Record<string, unknown>>>([]);
  const [statsLoadingForPlayer, setStatsLoadingForPlayer] = useState(false);
  const [statsLoadingForTeam, setStatsLoadingForTeam] = useState(false);
  const [loadingPlayerFromUrl, setLoadingPlayerFromUrl] = useState(false);
  const [chartDelayElapsed, setChartDelayElapsed] = useState(false);
  const chartUiResetToken = `${nblPropsMode}:${String(selectedPlayer?.name ?? '')}:${String(selectedTeam ?? '')}`;
  const [mainChartStat, setMainChartStat] = useState<string>('points');
  const [chartTimeframe, setChartTimeframe] = useState<NblChartTimeframe>('last10');
  const [supportingStatKind, setSupportingStatKind] = useState<SupportingStatKind>('minutes');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [nblGameFilters, setNblGameFilters] = useState<NblGameFiltersState>(() => ({
    ...DEFAULT_NBL_GAME_FILTERS,
  }));
  const [nblTeamFilter, setNblTeamFilter] = useState<string>('All');
  const [teamFilterDropdownOpen, setTeamFilterDropdownOpen] = useState(false);
  const [teammateFilterName, setTeammateFilterName] = useState<string | null>(null);
  const [withWithoutMode, setWithWithoutMode] = useState<'with' | 'without'>('with');
  const clearTeammateFilter = () => setTeammateFilterName(null);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [nextGameOpponent, setNextGameOpponent] = useState<string | null>(null);
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [nextGameOpponentLogo, setNextGameOpponentLogo] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  const [nblOddsBooks, setNblOddsBooks] = useState<NblBookRow[]>([]);
  const [nblPlayerOddsByStat, setNblPlayerOddsByStat] = useState<Record<string, NblBookRow[]>>({});
  const [nblOddsLoading, setNblOddsLoading] = useState(false);
  const [nblOddsHomeTeam, setNblOddsHomeTeam] = useState('');
  const [nblOddsAwayTeam, setNblOddsAwayTeam] = useState('');
  const [selectedNblBookIndex, setSelectedNblBookIndex] = useState(0);
  const [nblGameLineValue, setNblGameLineValue] = useState<number | null>(null);
  const nblOddsBoardKeyRef = useRef('');
  const preferredNblBookmakerRef = useRef<string | null>(null);
  const hasIncomingNblBookOrLineRef = useRef(false);
  const incomingAppliedForKeyRef = useRef<string | null>(null);
  const nextGameTeamKeyRef = useRef('');

  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);
  const journalDropdownRef = useRef<HTMLDivElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);

  const {
    containerStyle,
    innerContainerStyle,
    innerContainerClassName,
    mainContentClassName,
    mainContentStyle,
  } = useDashboardStyles({ sidebarOpen });

  useCountdownTimer({ nextGameTipoff, isGameInProgress, setCountdown });

  useEffect(() => {
    setMounted(true);
    try {
      setOddsFormat(readOddsFormatPreference());
    } catch {
      /* ignore */
    }
  }, []);

  // Restore selection after mount only (localStorage / URL) — keeps SSR HTML identical.
  useEffect(() => {
    const restored = readInitialNblSelection();
    if (restored.selectedPlayer) {
      setSelectedPlayer(restored.selectedPlayer);
      setStatsLoadingForPlayer(Boolean(restored.selectedPlayer.playerId) || restored.fromUrl);
      setLoadingPlayerFromUrl(restored.fromUrl && !restored.selectedPlayer.playerId);
    }
    if (restored.selectedTeam) setSelectedTeam(restored.selectedTeam);
    setNblPropsMode(restored.nblPropsMode);
    setNblRightTab(restored.nblRightTab);
    setNblRightTabsVisited(new Set([restored.nblRightTab]));
    setNblTeamFilter(restored.nblTeamFilter);
    setChartTimeframe(restored.chartTimeframe);
    setMainChartStat(restored.mainChartStat);
    setNblGameFilters(restored.nblGameFilters);
    if (restored.searchQuery) setSearchQuery(restored.searchQuery);
    if (restored.incomingLine != null) {
      setNblGameLineValue(restored.incomingLine);
      hasIncomingNblBookOrLineRef.current = true;
    }
    if (restored.incomingBookmaker) {
      preferredNblBookmakerRef.current = restored.incomingBookmaker;
      hasIncomingNblBookOrLineRef.current = true;
    }
    const teamHint = restored.selectedTeam || restored.selectedPlayer?.team || null;
    const prefetch = readNblNextGamePrefetch(teamHint);
    const instantOpponent =
      (prefetch?.next_opponent && String(prefetch.next_opponent).trim()) ||
      restored.incomingOpponent ||
      null;
    if (instantOpponent) {
      setNextGameOpponent(resolveNblClubName(instantOpponent) || instantOpponent);
    }
    if (prefetch?.next_game_tipoff) {
      const tip = new Date(prefetch.next_game_tipoff);
      if (Number.isFinite(tip.getTime())) setNextGameTipoff(tip);
    }
    if (prefetch?.opponent_logo) {
      setNextGameOpponentLogo(prefetch.opponent_logo);
    }
    setSelectionHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user || cancelled) return;
        setUserEmail(user.email ?? null);
        const { profile: p, isPro: pro } = await fetchProfileProStatusWithRetries(supabase, user);
        if (cancelled) return;
        setUsername(
          p?.full_name ||
            p?.username ||
            user.user_metadata?.username ||
            user.user_metadata?.full_name ||
            null
        );
        setAvatarUrl(
          p?.avatar_url ?? user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null
        );
        setIsPro(pro);
      } catch {
        /* ignore — shell still renders for logged-out */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRosterLoading(true);
      try {
        const [playersRes, logosRes] = await Promise.all([
          // NBL27 tracker/current roster only — no prior-season players in search.
          fetch(`/api/nbl/players?year=${NBL_CURRENT_SEASON_YEAR}&currentOnly=1`),
          fetch(`/api/nbl/team-logos?year=${NBL_CURRENT_SEASON_YEAR}`),
        ]);
        if (cancelled) return;
        if (playersRes.ok) {
          const data = await playersRes.json();
          setRosterPlayers(Array.isArray(data.players) ? data.players : []);
        }
        if (logosRes.ok) {
          const data = await logosRes.json();
          setLogoByTeam(
            data?.logoByTeam && typeof data.logoByTeam === 'object' ? data.logoByTeam : {}
          );
        }
      } catch {
        /* ignore — search stays empty */
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Game Props has no DVP tab — fall back to Opponent Breakdown.
  useEffect(() => {
    if (nblPropsMode === 'team' && nblRightTab === 'dvp') {
      setNblRightTab('breakdown');
      setNblRightTabsVisited((prev) => new Set(prev).add('breakdown'));
    }
  }, [nblPropsMode, nblRightTab]);

  // Reset chart delay when player/mode changes (same as AFL).
  useEffect(() => {
    setChartDelayElapsed(false);
  }, [nblPropsMode, selectedPlayer?.playerId, selectedPlayer?.name, selectedTeam]);

  // After stats load, brief delay before showing chart content.
  useEffect(() => {
    if (nblPropsMode === 'team') {
      if (!String(selectedTeam || '').trim() || statsLoadingForTeam) return;
    } else if (!selectedPlayer || statsLoadingForPlayer || loadingPlayerFromUrl) {
      return;
    }
    const t = setTimeout(() => setChartDelayElapsed(true), CHART_DISPLAY_DELAY_MS);
    return () => clearTimeout(t);
  }, [
    nblPropsMode,
    selectedTeam,
    selectedPlayer,
    statsLoadingForPlayer,
    statsLoadingForTeam,
    loadingPlayerFromUrl,
  ]);

  // Resolve restored/URL player against roster once loaded (needs playerId for logs).
  useEffect(() => {
    if (rosterLoading || rosterPlayers.length === 0) return;
    if (!selectedPlayer?.name) {
      if (loadingPlayerFromUrl) setLoadingPlayerFromUrl(false);
      return;
    }
    if (selectedPlayer.playerId) {
      if (loadingPlayerFromUrl) setLoadingPlayerFromUrl(false);
      return;
    }
    const want = normalizeNblPlayerNameForMatch(selectedPlayer.name);
    const teamWant = selectedPlayer.team ? normalizeTeamKey(selectedPlayer.team) : '';
    const match =
      rosterPlayers.find((p) => {
        if (normalizeNblPlayerNameForMatch(p.name) !== want) return false;
        if (!teamWant) return true;
        return normalizeTeamKey(p.team) === teamWant;
      }) ||
      rosterPlayers.find((p) => normalizeNblPlayerNameForMatch(p.name) === want) ||
      rosterPlayers.find((p) => normalizeNblPlayerNameForMatch(p.name).includes(want));
    if (match) {
      setSelectedPlayer(match);
      setSelectedTeam(match.team || null);
      setSearchQuery(match.name);
    }
    setLoadingPlayerFromUrl(false);
  }, [
    rosterLoading,
    rosterPlayers,
    selectedPlayer?.name,
    selectedPlayer?.playerId,
    selectedPlayer?.team,
    loadingPlayerFromUrl,
  ]);

  // Persist page context as user navigates tabs/filters/players.
  useEffect(() => {
    if (!selectionHydrated) return;
    // Never overwrite a saved player with a blank state on the first paint race.
    if (!selectedPlayer && !selectedTeam) {
      const existing = readPersistedNblPageState();
      if (existing?.selectedPlayer || existing?.selectedTeam) return;
    }
    const payload: PersistedNblPageState = {
      selectedPlayer,
      selectedTeam,
      nblPropsMode,
      nblTeamFilter,
      nblRightTab,
      chartTimeframe,
      mainChartStat,
      nblGameFilters,
    };
    try {
      localStorage.setItem(NBL_PAGE_STATE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [
    selectedPlayer,
    selectedTeam,
    nblPropsMode,
    nblTeamFilter,
    nblRightTab,
    chartTimeframe,
    mainChartStat,
    nblGameFilters,
    selectionHydrated,
  ]);

  const goBackToPlayerProps = useCallback(() => {
    try {
      localStorage.removeItem(NBL_PAGE_STATE_KEY);
    } catch {
      /* ignore */
    }
    setNavigatingToProps(true);
    const returnPath = consumePropsReturnPath('nbl');
    router.prefetch(returnPath);
    router.push(returnPath);
  }, [router]);

  const showBackToPlayerProps = Boolean(
    selectedPlayer || (nblPropsMode === 'team' && selectedTeam)
  );

  // Keep URL in sync with selection (same pattern as AFL/NBA).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectionHydrated) return;
    // Don't strip shareable URL params when nothing is selected.
    if (!selectedPlayer?.name && nblPropsMode === 'player') return;
    if (!selectedTeam && nblPropsMode === 'team') return;
    const url = new URL(window.location.href);
    if (nblPropsMode === 'player' && selectedPlayer?.name) {
      url.searchParams.set('mode', 'player');
      url.searchParams.set('name', String(selectedPlayer.name ?? ''));
      url.searchParams.set('team', String(selectedPlayer.team ?? '').trim());
      const nextOpp =
        nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== '—'
          ? nextGameOpponent
          : null;
      if (nextOpp) url.searchParams.set('opponent', nextOpp);
      else url.searchParams.delete('opponent');
      if (mainChartStat) url.searchParams.set('stat', mainChartStat);
      else url.searchParams.delete('stat');
      url.searchParams.set('tf', chartTimeframe);
      if (nblGameLineValue != null && Number.isFinite(nblGameLineValue)) {
        url.searchParams.set('line', String(nblGameLineValue));
      } else url.searchParams.delete('line');
      url.searchParams.delete('player');
    } else if (nblPropsMode === 'team' && selectedTeam) {
      url.searchParams.set('mode', 'team');
      url.searchParams.set('team', selectedTeam);
      url.searchParams.delete('name');
      url.searchParams.delete('player');
      if (mainChartStat) url.searchParams.set('stat', mainChartStat);
      else url.searchParams.delete('stat');
      url.searchParams.set('tf', chartTimeframe);
      if (nblGameLineValue != null && Number.isFinite(nblGameLineValue)) {
        url.searchParams.set('line', String(nblGameLineValue));
      } else url.searchParams.delete('line');
      const nextOpp =
        nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== '—'
          ? nextGameOpponent
          : null;
      if (nextOpp) url.searchParams.set('opponent', nextOpp);
      else url.searchParams.delete('opponent');
    } else {
      url.searchParams.delete('mode');
      url.searchParams.delete('name');
      url.searchParams.delete('team');
      url.searchParams.delete('opponent');
      url.searchParams.delete('player');
      url.searchParams.delete('stat');
      url.searchParams.delete('tf');
      url.searchParams.delete('line');
      url.searchParams.delete('bookmaker');
    }
    const next = url.toString();
    if (window.location.href !== next) {
      window.history.replaceState({}, '', next);
    }
  }, [
    nblPropsMode,
    selectedPlayer?.name,
    selectedPlayer?.team,
    selectedTeam,
    nextGameOpponent,
    mainChartStat,
    chartTimeframe,
    nblGameLineValue,
    selectionHydrated,
  ]);

  const visitRightTab = (tab: NblRightTab) => {
    setNblRightTab(tab);
    setNblRightTabsVisited((prev) => new Set(prev).add(tab));
  };

  const selectPlayer = (player: NblRosterPlayer) => {
    setSelectedPlayer(player);
    setSelectedTeam(player.team || null);
    setSearchQuery(player.name);
    setShowSearchDropdown(false);
    setSelectedPlayerGameLogs([]);
    setStatsLoadingForPlayer(true);
    setLoadingPlayerFromUrl(false);
    setChartDelayElapsed(false);
    setTeammateFilterName(null);
  };

  const selectTeam = (teamName: string) => {
    setSelectedTeam(teamName);
    setSelectedPlayer(null);
    setSelectedPlayerGameLogs([]);
    setStatsLoadingForPlayer(false);
    setTeammateFilterName(null);
    setLoadingPlayerFromUrl(false);
    setSearchQuery(teamName);
    setShowSearchDropdown(false);
  };

  // Load game logs whenever a player is selected (cache-first soft remount, then network).
  useEffect(() => {
    if (!selectedPlayer?.playerId) {
      if (!loadingPlayerFromUrl) {
        setSelectedPlayerGameLogs([]);
        setStatsLoadingForPlayer(false);
      }
      return;
    }
    const playerId = selectedPlayer.playerId;
    const cacheKey = nblPlayerLogsCacheKey(playerId);
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CachedNblPlayerLogs;
        const fresh =
          Number.isFinite(parsed?.createdAt) &&
          Date.now() - Number(parsed.createdAt) <= NBL_PLAYER_LOGS_CACHE_TTL_MS;
        const yearsMatch =
          Array.isArray(parsed.years) &&
          parsed.years.join(',') === NBL_CHART_HISTORY_YEARS.join(',');
        if (fresh && yearsMatch && Array.isArray(parsed.games)) {
          const hasRates = parsed.games.some(
            (g) => g != null && (g.usgPct != null || g.tsPct != null || g.pace != null)
          );
          if (hasRates) {
            setSelectedPlayerGameLogs(parsed.games);
            setStatsLoadingForPlayer(false);
            return;
          }
        }
      }
    } catch {
      /* ignore malformed cache */
    }

    let cancelled = false;
    setStatsLoadingForPlayer(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/nbl/player-game-logs?playerId=${encodeURIComponent(playerId)}&years=${NBL_CHART_HISTORY_YEARS.join(',')}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`logs ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const games = Array.isArray(data.games) ? (data.games as NblGameLogRow[]) : [];
        setSelectedPlayerGameLogs(games);
        try {
          const payload: CachedNblPlayerLogs = {
            createdAt: Date.now(),
            years: [...NBL_CHART_HISTORY_YEARS],
            games,
          };
          localStorage.setItem(cacheKey, JSON.stringify(payload));
        } catch {
          /* ignore quota */
        }
      } catch {
        if (!cancelled) {
          // Keep already-painted logs on error (soft remount / cache path).
          setSelectedPlayerGameLogs((prev) => prev);
        }
      } finally {
        if (!cancelled) setStatsLoadingForPlayer(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer?.playerId, loadingPlayerFromUrl]);

  useEffect(() => {
    if (nblPropsMode !== 'player' || !selectedPlayer?.playerId) {
      setPlayerPlayTypeLabel(null);
      return;
    }
    const playerId = selectedPlayer.playerId;
    let cancelled = false;
    fetch(`/api/nbl/play-types?playerId=${encodeURIComponent(playerId)}&stat=points`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load play type');
        return json;
      })
      .then((data) => {
        if (cancelled) return;
        const type = data?.player?.type as NblPlayTypeId | undefined;
        setPlayerPlayTypeLabel(type ? NBL_PLAY_TYPE_FULL_LABELS[type] ?? null : null);
      })
      .catch(() => {
        if (!cancelled) setPlayerPlayTypeLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [nblPropsMode, selectedPlayer?.playerId]);

  // Game Props: team score logs (schedule + cached quarter scores).
  useEffect(() => {
    if (nblPropsMode !== 'team') {
      setSelectedTeamGameLogs([]);
      setStatsLoadingForTeam(false);
      return;
    }
    const team = resolveNblClubName(selectedTeam) || String(selectedTeam || '').trim();
    if (!team) {
      setSelectedTeamGameLogs([]);
      setStatsLoadingForTeam(false);
      return;
    }
    let cancelled = false;
    setStatsLoadingForTeam(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/nbl/team-game-logs?team=${encodeURIComponent(team)}&years=${NBL_CHART_HISTORY_YEARS.join(',')}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`team logs ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setSelectedTeamGameLogs(Array.isArray(data.games) ? data.games : []);
      } catch {
        if (!cancelled) setSelectedTeamGameLogs([]);
      } finally {
        if (!cancelled) setStatsLoadingForTeam(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nblPropsMode, selectedTeam]);

  const logoByTeamRef = useRef(logoByTeam);
  logoByTeamRef.current = logoByTeam;

  const applyNextGameHint = useCallback(
    (hint: {
      opponent?: string | null;
      tipoff?: string | Date | null;
      opponentLogo?: string | null;
    }) => {
      const opponent = hint.opponent ? resolveNblClubName(hint.opponent) || hint.opponent : null;
      if (opponent) {
        setNextGameOpponent(opponent);
        setNextGameOpponentLogo(
          hint.opponentLogo || resolveNblTeamLogo(opponent, logoByTeamRef.current)
        );
      }
      if (hint.tipoff) {
        const tip = hint.tipoff instanceof Date ? hint.tipoff : new Date(hint.tipoff);
        if (Number.isFinite(tip.getTime())) setNextGameTipoff(tip);
      }
    },
    []
  );

  // Instant matchup from props URL / prefetch; confirm tipoff in the background.
  useEffect(() => {
    const team =
      nblPropsMode === 'team'
        ? selectedTeam
        : selectedPlayer?.team || selectedTeam;
    if (!team) {
      setNextGameOpponent(null);
      setNextGameTipoff(null);
      setNextGameOpponentLogo(null);
      setIsGameInProgress(false);
      return;
    }
    const teamKey = normalizeTeamKey(resolveNblClubName(team) || team);
    const teamChanged = Boolean(nextGameTeamKeyRef.current && nextGameTeamKeyRef.current !== teamKey);
    nextGameTeamKeyRef.current = teamKey;
    const prefetch = readNblNextGamePrefetch(team);
    if (prefetch?.next_opponent || prefetch?.next_game_tipoff) {
      applyNextGameHint({
        opponent: prefetch.next_opponent,
        tipoff: prefetch.next_game_tipoff,
        opponentLogo: prefetch.opponent_logo,
      });
    } else if (teamChanged) {
      setNextGameOpponent(null);
      setNextGameTipoff(null);
      setNextGameOpponentLogo(null);
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/nbl/next-game?team=${encodeURIComponent(team)}&year=${NBL_CURRENT_SEASON_YEAR}`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const opponent = data?.next_opponent ? String(data.next_opponent) : null;
        const tipoffRaw = data?.next_game_tipoff ? String(data.next_game_tipoff) : null;
        const opponentLogo = data?.opponent_logo ? String(data.opponent_logo) : null;
        applyNextGameHint({
          opponent,
          tipoff: tipoffRaw,
          opponentLogo,
        });
        writeNblNextGamePrefetch({
          team,
          next_opponent: opponent,
          next_game_tipoff: tipoffRaw,
          next_game_id: data?.next_game_id ? String(data.next_game_id) : null,
          opponent_logo: opponentLogo,
        });
      } catch {
        /* keep URL / prefetch opponent so the rest of the dashboard does not wait */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nblPropsMode, selectedPlayer?.team, selectedTeam, applyNextGameHint]);

  useEffect(() => {
    if (!nextGameOpponent || nextGameOpponentLogo) return;
    const logo = resolveNblTeamLogo(nextGameOpponent, logoByTeam);
    if (logo) setNextGameOpponentLogo(logo);
  }, [logoByTeam, nextGameOpponent, nextGameOpponentLogo]);

  const nblOddsTeam =
    nblPropsMode === 'team' ? selectedTeam : selectedPlayer?.team || selectedTeam;
  const nblOddsOpponent = nextGameOpponent
    ? resolveNblClubName(nextGameOpponent) || nextGameOpponent
    : null;
  const nblOddsStat = nblQuarterParentStat(mainChartStat) ?? mainChartStat;
  const nblOddsMarket = nblOddsMarketForStat(nblPropsMode, nblOddsStat);
  const nblDisplayOddsBooks =
    nblPropsMode === 'player' ? nblPlayerOddsByStat[nblOddsStat] ?? EMPTY_NBL_ODDS_BOOKS : nblOddsBooks;

  const setMainChartStatAndResetLine = useCallback((stat: string | ((prev: string) => string)) => {
    setMainChartStat(stat);
    setNblGameLineValue(null);
    hasIncomingNblBookOrLineRef.current = false;
    preferredNblBookmakerRef.current = null;
  }, []);

  useEffect(() => {
    const key =
      nblPropsMode === 'player'
        ? String(selectedPlayer?.name || '').trim()
        : String(selectedTeam || '').trim();
    if (!key) return;
    if (incomingAppliedForKeyRef.current == null) {
      incomingAppliedForKeyRef.current = key;
      return;
    }
    if (incomingAppliedForKeyRef.current === key) return;
    incomingAppliedForKeyRef.current = key;
    hasIncomingNblBookOrLineRef.current = false;
    preferredNblBookmakerRef.current = null;
  }, [nblPropsMode, selectedPlayer?.name, selectedTeam]);

  useEffect(() => {
    const team = nblOddsTeam ? resolveNblClubName(nblOddsTeam) || nblOddsTeam : null;
    const opponent = nblOddsOpponent;
    const playerName = selectedPlayer?.name?.trim() || '';
    const wantsPlayerProps = nblPropsMode === 'player' && !!playerName && !!team && !!opponent;
    const wantsGameOdds = nblPropsMode === 'team' && !!team && !!opponent;
    const boardKey = wantsPlayerProps
      ? `p:${playerName}|${team}|${opponent}`
      : wantsGameOdds
        ? `t:${team}|${opponent}`
        : '';
    if (!wantsPlayerProps && !wantsGameOdds) {
      nblOddsBoardKeyRef.current = '';
      setNblOddsBooks([]);
      setNblPlayerOddsByStat({});
      setNblOddsHomeTeam('');
      setNblOddsAwayTeam('');
      setNblOddsLoading(false);
      return;
    }
    if (nblOddsBoardKeyRef.current === boardKey) return;
    let cancelled = false;
    setNblOddsLoading(true);
    (async () => {
      try {
        const url = wantsPlayerProps
          ? `/api/nbl/player-props?player=${encodeURIComponent(playerName)}&stat=points&team=${encodeURIComponent(team!)}&opponent=${encodeURIComponent(opponent!)}`
          : `/api/nbl/odds?team=${encodeURIComponent(team!)}&opponent=${encodeURIComponent(opponent!)}`;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        const books = Array.isArray(data?.data) ? (data.data as NblBookRow[]) : [];
        const byStat =
          data?.byStat && typeof data.byStat === 'object'
            ? (data.byStat as Record<string, NblBookRow[]>)
            : {};
        nblOddsBoardKeyRef.current = boardKey;
        if (wantsPlayerProps) {
          setNblPlayerOddsByStat(byStat);
          setNblOddsBooks([]);
        } else {
          setNblOddsBooks(books);
          setNblPlayerOddsByStat({});
        }
        setNblOddsHomeTeam(typeof data?.homeTeam === 'string' ? data.homeTeam : team!);
        setNblOddsAwayTeam(typeof data?.awayTeam === 'string' ? data.awayTeam : opponent!);
        if (!hasIncomingNblBookOrLineRef.current) {
          setSelectedNblBookIndex(0);
          setNblGameLineValue(null);
        }
      } catch {
        if (!cancelled) {
          nblOddsBoardKeyRef.current = '';
          setNblOddsBooks([]);
          setNblPlayerOddsByStat({});
          setNblOddsHomeTeam('');
          setNblOddsAwayTeam('');
        }
      } finally {
        if (!cancelled) setNblOddsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nblOddsTeam, nblOddsOpponent, nblPropsMode, selectedPlayer?.name]);

  useEffect(() => {
    if (!nblDisplayOddsBooks.length) return;
    if (nblOddsMarket !== 'spread' && nblOddsMarket !== 'total') return;
    const preferredLine = (book: NblBookRow | undefined): number | null => {
      if (!book) return null;
      if (nblPropsMode === 'player') {
        const lines = nblBookLines(book);
        return parseNblOddsLine(
          lines.find((l) => l.kind === 'ou' && l.under !== 'N/A')?.line ??
            book.Total?.line ??
            lines[0]?.line
        );
      }
      return parseNblOddsLine(nblOddsMarket === 'spread' ? book.Spread?.line : book.Total?.line);
    };
    const book = nblDisplayOddsBooks[selectedNblBookIndex] ?? nblDisplayOddsBooks[0];
    setNblGameLineValue((current) => {
      if (current != null && Number.isFinite(current)) return current;
      const parsed = preferredLine(book);
      if (parsed != null) return parsed;
      const withData = nblDisplayOddsBooks.find((b) => preferredLine(b) != null);
      return withData ? preferredLine(withData) : null;
    });
    if (preferredLine(book) == null) {
      const withData = nblDisplayOddsBooks.findIndex((b) => preferredLine(b) != null);
      if (withData >= 0 && withData !== selectedNblBookIndex) setSelectedNblBookIndex(withData);
    }
  }, [nblPropsMode, nblOddsMarket, nblDisplayOddsBooks, selectedNblBookIndex]);

  useEffect(() => {
    if (!nblDisplayOddsBooks.length) return;
    const preferredBook = preferredNblBookmakerRef.current;
    if (preferredBook) {
      const preferredNorm = normalizeNblBookName(preferredBook);
      const preferredIndex = nblDisplayOddsBooks.findIndex((b) => {
        const bookNorm = normalizeNblBookName(b.name);
        return (
          bookNorm === preferredNorm ||
          bookNorm.includes(preferredNorm) ||
          preferredNorm.includes(bookNorm)
        );
      });
      if (preferredIndex >= 0) {
        if (preferredIndex !== selectedNblBookIndex) setSelectedNblBookIndex(preferredIndex);
        preferredNblBookmakerRef.current = null;
        return;
      }
    }
    if (!hasIncomingNblBookOrLineRef.current) return;
    const incoming = nblGameLineValue;
    if (incoming == null || !Number.isFinite(incoming)) return;
    if (nblBookHasLineValue(nblDisplayOddsBooks[selectedNblBookIndex], incoming)) return;
    const idx = nblDisplayOddsBooks.findIndex((b) => nblBookHasLineValue(b, incoming));
    if (idx >= 0 && idx !== selectedNblBookIndex) setSelectedNblBookIndex(idx);
  }, [nblDisplayOddsBooks, selectedNblBookIndex, nblGameLineValue]);

  useEffect(() => {
    const onTransientLine = (e: Event) => {
      const value = (e as CustomEvent<{ value: number }>).detail?.value;
      if (value == null || !Number.isFinite(value)) return;
      setNblGameLineValue((prev) =>
        prev != null && Number.isFinite(prev) && Math.abs(prev - value) < 0.01 ? prev : value
      );
    };
    window.addEventListener('transient-line', onTransientLine);
    return () => window.removeEventListener('transient-line', onTransientLine);
  }, []);

  // Mark tipoff LIVE for ~2.5h after start.
  useEffect(() => {
    if (!nextGameTipoff) {
      setIsGameInProgress(false);
      return;
    }
    const tick = () => {
      const now = Date.now();
      const tip = nextGameTipoff.getTime();
      setIsGameInProgress(now >= tip && now - tip < NBL_MATCH_DURATION_MS);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [nextGameTipoff]);

  // Reset supporting to the first context-relevant pill when main chart stat changes.
  useEffect(() => {
    setSupportingStatKind(defaultSupportingStatForMain(mainChartStat));
  }, [mainChartStat]);

  const chartGameLogsForPlayer = useMemo(() => {
    const base =
      !nblTeamFilter || nblTeamFilter === 'All' || nblTeamFilter.trim() === ''
        ? selectedPlayerGameLogs
        : selectedPlayerGameLogs.filter((g) => {
            const opp = g.opponent;
            if (!opp) return false;
            const resolved = resolveNblClubName(opp) || opp.trim();
            return resolved === nblTeamFilter.trim() || opp.trim() === nblTeamFilter.trim();
          });
    return base.map((g, idx) => ({ ...g, __nblGameIndex: idx }));
  }, [selectedPlayerGameLogs, nblTeamFilter]);

  const chartGameLogsForTeam = useMemo(() => {
    const base =
      !nblTeamFilter || nblTeamFilter === 'All' || nblTeamFilter.trim() === ''
        ? selectedTeamGameLogs
        : selectedTeamGameLogs.filter((g) => {
            const opp = String(g.opponent ?? '');
            if (!opp) return false;
            const resolved = resolveNblClubName(opp) || opp.trim();
            return resolved === nblTeamFilter.trim() || opp.trim() === nblTeamFilter.trim();
          });
    return base.map((g, idx) => ({ ...g, __nblGameIndex: idx }));
  }, [selectedTeamGameLogs, nblTeamFilter]);

  const chartGameLogs =
    nblPropsMode === 'team' ? chartGameLogsForTeam : chartGameLogsForPlayer;
  const allChartGameLogs =
    nblPropsMode === 'team' ? selectedTeamGameLogs : selectedPlayerGameLogs;

  const headerTitle =
    nblPropsMode === 'team'
      ? selectedTeam || 'Select a Team'
      : selectedPlayer?.name || 'Select a Player';
  const headerSubtitle =
    nblPropsMode === 'team'
      ? selectedTeam
        ? 'Game props'
        : 'Select a team'
      : selectedPlayer
        ? selectedPlayer.team
        : 'Select a player';
  const matchupLeft = nblPropsMode === 'team' ? selectedTeam : selectedPlayer?.team || null;
  const matchupLeftLogo = matchupLeft ? resolveNblTeamLogo(matchupLeft, logoByTeam) : null;
  const displayOpponent = nextGameOpponent
    ? resolveNblClubName(nextGameOpponent) || nextGameOpponent
    : null;
  const matchupOpponentLogo =
    nextGameOpponentLogo ||
    (displayOpponent ? resolveNblTeamLogo(displayOpponent, logoByTeam) : null);
  const matchupLeftAbbrev = matchupLeft ? getNblTeamAbbrev(matchupLeft) : '';
  const displayOpponentAbbrev = displayOpponent ? getNblTeamAbbrev(displayOpponent) : '—';

  const hasTeamModeSelection = !!String(selectedTeam ?? '').trim();
  const nblBookIndex = nblDisplayOddsBooks.length
    ? Math.min(selectedNblBookIndex, nblDisplayOddsBooks.length - 1)
    : 0;
  const nblExternalLineValue = (() => {
    if (nblOddsMarket !== 'spread' && nblOddsMarket !== 'total') return null;
    const book = nblDisplayOddsBooks[nblBookIndex] ?? nblDisplayOddsBooks[0];
    let value = nblGameLineValue;
    if (value == null || !Number.isFinite(value)) {
      if (nblPropsMode === 'player') {
        value = parseNblOddsLine(book?.Total?.line);
      } else {
        value = parseNblOddsLine(nblOddsMarket === 'spread' ? book?.Spread?.line : book?.Total?.line);
      }
    }
    if (value == null || !Number.isFinite(value)) return null;
    if (nblPropsMode === 'team' && nblOddsMarket === 'spread') {
      const home = resolveNblClubName(nblOddsHomeTeam);
      const sel = resolveNblClubName(selectedTeam || '');
      if (home && sel && home !== sel) return -value;
    }
    return value;
  })();
  const showNblOddsChip =
    nblPropsMode === 'player' ? !!selectedPlayer : hasTeamModeSelection;
  const nblOddsChipLoading =
    nblOddsLoading &&
    (nblPropsMode === 'player' ? Object.keys(nblPlayerOddsByStat).length === 0 : nblOddsBooks.length === 0);
  const showEmptyShell =
    nblPropsMode === 'team'
      ? !hasTeamModeSelection
      : !selectedPlayer && !loadingPlayerFromUrl;
  const showStatsLoadingShell =
    nblPropsMode === 'team'
      ? hasTeamModeSelection && (statsLoadingForTeam || !chartDelayElapsed)
      : loadingPlayerFromUrl ||
        (!!selectedPlayer && (statsLoadingForPlayer || !chartDelayElapsed));
  const pulse = isDark ? 'bg-gray-800' : 'bg-gray-200';

  return (
    <div className="min-h-screen h-screen max-h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors overflow-y-auto overflow-x-hidden overscroll-contain lg:max-h-none lg:overflow-y-hidden lg:overflow-x-auto">
      <LoadingBar isLoading={navigatingToProps} isDark={isDark} showImmediately={navigatingToProps} mobileOffset={0} />
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
              showDashboardNavLinks
            />
            <div className="flex flex-col lg:flex-row gap-0 lg:gap-0 min-h-0">
              {/* Main content — same containers as AFL / NBA dashboard */}
              <div className={mainContentClassName} style={mainContentStyle}>
                {/* 1. Filter By — mobile only */}
                <div
                  className={`order-1 lg:hidden rounded-lg ${NBL_DASH_CARD_GLOW} px-3 md:px-4 pt-3 md:pt-4 pb-4 md:pb-5 relative overflow-visible`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white">
                      Filter By
                    </h3>
                  </div>
                  <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                    <button
                      type="button"
                      onClick={() => {
                        setNblPropsMode('player');
                        setSearchQuery('');
                        setShowSearchDropdown(false);
                        setMainChartStatAndResetLine((prev) => (isNblTeamGameStat(prev) ? 'points' : prev));
                      }}
                      className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        nblPropsMode === 'player'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Player Props
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNblPropsMode('team');
                        setSearchQuery('');
                        setShowSearchDropdown(false);
                        setMainChartStatAndResetLine((prev) => defaultNblTeamStat(prev));
                        if (!selectedTeam && selectedPlayer?.team) {
                          setSelectedTeam(selectedPlayer.team);
                        }
                      }}
                      className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        nblPropsMode === 'team'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Game Props
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                    {nblPropsMode === 'player'
                      ? 'Analyze individual player statistics and props'
                      : 'Analyze game totals, spreads, and game-based props'}
                  </p>
                </div>

                {/* 2. Header */}
                <div
                  className={`order-2 lg:order-none relative z-[60] rounded-lg ${NBL_DASH_CARD_GLOW} p-2.5 sm:p-4 md:p-6 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}
                >
                  <div className="flex flex-col gap-1.5 lg:gap-3">
                    {/* Desktop: player info | matchup | spacer */}
                    <div className="hidden lg:flex items-center flex-1">
                      <div className="flex-1 min-w-0">
                        {showBackToPlayerProps ? (
                          <button
                            type="button"
                            onClick={goBackToPlayerProps}
                            className="flex items-center gap-1.5 mb-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            <span>Back to Player Props</span>
                          </button>
                        ) : null}
                        <div className="flex items-center gap-3 min-w-0">
                          {nblPropsMode === 'player' && selectedPlayer?.imageUrl ? (
                            <img
                              src={selectedPlayer.imageUrl}
                              alt={selectedPlayer.name}
                              className="w-10 h-10 rounded-full object-cover flex-shrink-0 bg-gray-200 dark:bg-gray-700"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-3 mb-1">
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                                {headerTitle}
                              </h1>
                              {nblPropsMode === 'player' &&
                              selectedPlayer?.jersey != null &&
                              String(selectedPlayer.jersey).trim() !== '' ? (
                                <span className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex-shrink-0">
                                  #{String(selectedPlayer.jersey)}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                              {headerSubtitle}
                            </div>
                            {nblPropsMode === 'player' && selectedPlayer?.position ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                Position: {selectedPlayer.position}
                              </div>
                            ) : null}
                            {nblPropsMode === 'player' && playerPlayTypeLabel ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {playerPlayTypeLabel}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="hidden lg:flex min-w-0 flex-shrink items-end mx-2 xl:mx-4">
                        {matchupLeft ? (
                          <div className="flex items-center gap-2 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1.5 xl:px-3 xl:py-2 min-w-0 flex-nowrap">
                            <div className="flex items-center gap-1.5 xl:gap-2 min-w-0">
                              <div className="flex items-center gap-1 xl:gap-1.5 min-w-0">
                                {matchupLeftLogo ? (
                                  <img
                                    src={matchupLeftLogo}
                                    alt={matchupLeft}
                                    className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                    style={{
                                      filter: isDark
                                        ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))'
                                        : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))',
                                    }}
                                  />
                                ) : null}
                                <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate">
                                  {matchupLeftAbbrev || matchupLeft}
                                </span>
                              </div>
                              <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] xl:text-xs flex-shrink-0">
                                VS
                              </span>
                              <div className="flex items-center gap-1 xl:gap-1.5 min-w-0">
                                {displayOpponent ? (
                                  <>
                                    {matchupOpponentLogo ? (
                                      <img
                                        src={matchupOpponentLogo}
                                        alt={displayOpponent}
                                        className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                        style={{
                                          filter: isDark
                                            ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))'
                                            : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))',
                                        }}
                                      />
                                    ) : null}
                                    <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate">
                                      {displayOpponentAbbrev}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-gray-400 dark:text-gray-500 text-xs xl:text-sm font-medium flex-shrink-0">
                                    —
                                  </span>
                                )}
                              </div>
                            </div>
                            {displayOpponent && countdown && !isGameInProgress ? (
                              <div className="ml-1 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">
                                  Tipoff in
                                </div>
                                <div className="text-xs xl:text-sm font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap tabular-nums">
                                  {String(countdown.hours).padStart(2, '0')}:
                                  {String(countdown.minutes).padStart(2, '0')}:
                                  {String(countdown.seconds).padStart(2, '0')}
                                </div>
                              </div>
                            ) : displayOpponent && isGameInProgress ? (
                              <div className="ml-1 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                <div className="text-xs xl:text-sm font-semibold text-green-600 dark:text-green-400 whitespace-nowrap animate-live-pulse-green">
                                  LIVE
                                </div>
                              </div>
                            ) : displayOpponent && nextGameTipoff ? (
                              <div className="ml-1 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  Game time passed
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                            <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">
                              {nblPropsMode === 'team' ? 'Select Team' : 'Select Player'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex justify-end" />
                    </div>

                    {/* Mobile: Row 1 = Back + name | Row 2 = team/position | Team vs Opponent */}
                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      <div className="w-full min-w-0">
                        <div className="flex-shrink-0 min-w-0">
                          {selectedPlayer || (nblPropsMode === 'team' && selectedTeam) ? (
                            <div>
                              {showBackToPlayerProps ? (
                                <button
                                  type="button"
                                  onClick={goBackToPlayerProps}
                                  className="flex items-center gap-1.5 mb-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                                >
                                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                  </svg>
                                  <span>Back to Player Props</span>
                                </button>
                              ) : null}
                              <div className="flex items-center gap-2 min-w-0">
                                {nblPropsMode === 'player' && selectedPlayer?.imageUrl ? (
                                  <img
                                    src={selectedPlayer.imageUrl}
                                    alt={selectedPlayer.name}
                                    className="w-8 h-8 rounded-full object-cover flex-shrink-0 bg-gray-200 dark:bg-gray-700"
                                  />
                                ) : null}
                                <div className="flex items-baseline gap-2 min-w-0">
                                  <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                                    {headerTitle}
                                  </h1>
                                  {nblPropsMode === 'player' &&
                                  selectedPlayer?.jersey != null &&
                                  String(selectedPlayer.jersey).trim() !== '' ? (
                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex-shrink-0">
                                      #{String(selectedPlayer.jersey)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : loadingPlayerFromUrl ? (
                            <div className="min-w-0 flex-1">
                              <div className="h-6 w-36 rounded animate-pulse bg-gray-300 dark:bg-gray-600" />
                            </div>
                          ) : (
                            <div>
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                                {nblPropsMode === 'team' ? 'Select a Team' : 'Select a Player'}
                              </h1>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-start justify-between gap-1.5 w-full min-w-0">
                        <div className="flex-shrink-0 min-w-0 pr-1">
                          {selectedPlayer || (nblPropsMode === 'team' && selectedTeam) ? (
                            <div>
                              {nblPropsMode === 'player' ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                  {headerSubtitle || '—'}
                                </div>
                              ) : null}
                              {nblPropsMode === 'player' &&
                              (selectedPlayer?.position || playerPlayTypeLabel) ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                  {[selectedPlayer?.position, playerPlayTypeLabel]
                                    .filter(Boolean)
                                    .join(' - ')}
                                </div>
                              ) : null}
                            </div>
                          ) : loadingPlayerFromUrl ? (
                            <div className="space-y-1">
                              <div className="h-3 w-20 rounded animate-pulse bg-gray-200 dark:bg-gray-700" />
                              <div className="h-3 w-16 rounded animate-pulse bg-gray-200 dark:bg-gray-700" />
                            </div>
                          ) : (
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              Search for a player below
                            </div>
                          )}
                        </div>
                        <div className="flex-shrink-0 min-w-0">
                          {matchupLeft ? (
                            <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 min-w-0 flex-nowrap">
                              <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
                                <div className="flex items-center gap-1 min-w-0">
                                  {matchupLeftLogo ? (
                                    <img
                                      src={matchupLeftLogo}
                                      alt={matchupLeft}
                                      className="w-6 h-6 object-contain flex-shrink-0"
                                      style={{
                                        filter: isDark
                                          ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))'
                                          : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))',
                                      }}
                                    />
                                  ) : null}
                                  <span className="font-bold text-gray-900 dark:text-white text-xs truncate">
                                    {matchupLeftAbbrev || matchupLeft}
                                  </span>
                                </div>
                                <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] flex-shrink-0">
                                  VS
                                </span>
                                <div className="flex items-center gap-1 min-w-0">
                                  {displayOpponent ? (
                                    <>
                                      {matchupOpponentLogo ? (
                                        <img
                                          src={matchupOpponentLogo}
                                          alt={displayOpponent}
                                          className="w-6 h-6 object-contain flex-shrink-0"
                                          style={{
                                            filter: isDark
                                              ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))'
                                              : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))',
                                          }}
                                        />
                                      ) : null}
                                      <span className="font-bold text-gray-900 dark:text-white text-xs truncate">
                                        {displayOpponentAbbrev}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-gray-400 dark:text-gray-500 text-xs truncate">—</span>
                                  )}
                                </div>
                              </div>
                              {displayOpponent && countdown && !isGameInProgress ? (
                                <div className="ml-1 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                  <div className="text-[9px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">
                                    Tipoff in
                                  </div>
                                  <div className="text-xs font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap tabular-nums">
                                    {String(countdown.hours).padStart(2, '0')}:
                                    {String(countdown.minutes).padStart(2, '0')}:
                                    {String(countdown.seconds).padStart(2, '0')}
                                  </div>
                                </div>
                              ) : displayOpponent && isGameInProgress ? (
                                <div className="ml-1 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                  <div className="text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                    LIVE
                                  </div>
                                </div>
                              ) : displayOpponent && nextGameTipoff ? (
                                <div className="ml-1 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                  <div className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    Game time passed
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : loadingPlayerFromUrl ? (
                            <div className="h-9 w-32 rounded-lg animate-pulse bg-gray-200 dark:bg-gray-700" />
                          ) : (
                            <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                              <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">
                                {nblPropsMode === 'team' ? 'Select Team' : 'Select Player'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Chart container — AFL heights */}
                <div
                  className={`order-3 lg:order-none chart-container-no-focus relative z-10 rounded-lg p-0 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${NBL_DASH_CARD_GLOW} ${
                    showAdvancedFilters
                      ? 'sm:pt-0 sm:pr-0 sm:pb-0 sm:pl-0 md:pt-1 md:pr-0 md:pb-0 md:pl-0 lg:pt-2 lg:pr-0 lg:pb-0 lg:pl-0'
                      : 'sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0'
                  }`}
                  style={{ outline: 'none' }}
                >
                  {showEmptyShell ? (
                    <div className="h-full w-full" />
                  ) : showStatsLoadingShell ? (
                    <div className="h-full w-full flex flex-col" style={{ padding: '16px 8px 8px 8px' }}>
                      <div className="flex-1 flex items-end justify-center gap-1 px-2 h-full">
                        {[...Array(20)].map((_, idx) => {
                          const heights = [
                            45, 62, 38, 71, 55, 48, 65, 42, 58, 51, 47, 63, 39, 72, 56, 49, 66, 43, 59,
                            52,
                          ];
                          const height = heights[idx] || 48;
                          return (
                            <div
                              key={idx}
                              className="flex-1 max-w-[50px] flex flex-col items-center justify-end"
                              style={{ height: '100%' }}
                            >
                              <div
                                className={`w-full rounded-t animate-pulse ${pulse}`}
                                style={{
                                  height: `${height}%`,
                                  animationDelay: `${idx * 0.08}s`,
                                  minHeight: '30px',
                                  minWidth: '28px',
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                  <NblStatsChart
                    stats={
                      nblPropsMode === 'team'
                        ? { name: selectedTeam || '' }
                        : selectedPlayer
                          ? { name: selectedPlayer.name }
                          : {}
                    }
                    gameLogs={chartGameLogs as unknown as Array<Record<string, unknown>>}
                    allGameLogs={allChartGameLogs as unknown as Array<Record<string, unknown>>}
                    isDark={!!mounted && isDark}
                    logoByTeam={logoByTeam}
                    isLoading={nblPropsMode === 'team' ? statsLoadingForTeam : statsLoadingForPlayer}
                    hasSelectedPlayer={
                      nblPropsMode === 'team'
                        ? hasTeamModeSelection
                        : !!selectedPlayer
                    }
                    mode={nblPropsMode}
                    selectedStat={mainChartStat}
                    onSelectedStatChange={setMainChartStatAndResetLine}
                    selectedTimeframe={chartTimeframe}
                    onTimeframeChange={setChartTimeframe}
                    showAdvancedFilters={nblPropsMode === 'player' ? showAdvancedFilters : false}
                    setShowAdvancedFilters={nblPropsMode === 'player' ? setShowAdvancedFilters : undefined}
                    nblGameFilters={nblPropsMode === 'player' ? nblGameFilters : undefined}
                    setNblGameFilters={nblPropsMode === 'player' ? setNblGameFilters : undefined}
                    perGameFilterData={null}
                    nextOpponent={displayOpponent}
                    gamePropsTeam={nblPropsMode === 'team' ? selectedTeam : null}
                    uiResetToken={chartUiResetToken}
                    season={NBL_SHOT_CHART_SEASON_YEAR}
                    teammateFilterName={nblPropsMode === 'player' ? teammateFilterName : null}
                    withWithoutMode={withWithoutMode}
                    clearTeammateFilter={clearTeammateFilter}
                    rosterPlayers={rosterPlayers}
                    slotLeftOfLine={
                      showNblOddsChip ? (
                        nblOddsChipLoading ? (
                          <div
                            className={`h-8 w-[100px] sm:w-[110px] md:w-[120px] rounded-lg animate-pulse flex-shrink-0 ${
                              isDark ? 'bg-gray-800' : 'bg-gray-200'
                            }`}
                          />
                        ) : (
                          <NblLineSelector
                            books={nblDisplayOddsBooks}
                            market={nblOddsMarket}
                            selectedBookIndex={nblBookIndex}
                            onSelectBookIndex={setSelectedNblBookIndex}
                            oddsFormat={oddsFormat}
                            isDark={!!mounted && isDark}
                            homeTeam={nblOddsHomeTeam ? getNblTeamAbbrev(nblOddsHomeTeam) : nblOddsHomeTeam}
                            awayTeam={nblOddsAwayTeam ? getNblTeamAbbrev(nblOddsAwayTeam) : nblOddsAwayTeam}
                            disabled={nblPropsMode === 'team' ? !hasTeamModeSelection : !selectedPlayer}
                            currentLineValue={
                              nblOddsMarket === 'spread' || nblOddsMarket === 'total'
                                ? nblExternalLineValue
                                : undefined
                            }
                            onSelectLineValue={(lineValue) => setNblGameLineValue(lineValue)}
                          />
                        )
                      ) : null
                    }
                    externalLineValue={nblExternalLineValue}
                    slotRightOfControls={
                      <div className="flex items-center gap-1.5 relative">
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setTeamFilterDropdownOpen((v) => !v)}
                            className="w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
                          >
                            <span className="flex items-center gap-1 min-w-0">
                              {nblTeamFilter !== 'All' && resolveNblTeamLogo(nblTeamFilter, logoByTeam) ? (
                                <img
                                  src={resolveNblTeamLogo(nblTeamFilter, logoByTeam) ?? ''}
                                  alt={nblTeamFilter}
                                  className="w-4 h-4 object-contain rounded-full bg-gray-900/10 flex-shrink-0"
                                />
                              ) : nblTeamFilter !== 'All' ? (
                                <span
                                  className={`inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] font-semibold flex-shrink-0 ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}
                                >
                                  {getNblTeamAbbrev(nblTeamFilter).slice(0, 1)}
                                </span>
                              ) : null}
                              <span className="truncate text-xs font-medium">
                                {nblTeamFilter === 'All' ? 'ALL' : getNblTeamAbbrev(nblTeamFilter)}
                              </span>
                            </span>
                            <svg className="w-3 h-3 opacity-70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {teamFilterDropdownOpen && (
                            <>
                              <div className="absolute top-full left-0 mt-1 w-20 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto custom-scrollbar">
                                <div className="max-h-56 overflow-y-auto">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNblTeamFilter('All');
                                      setTeamFilterDropdownOpen(false);
                                    }}
                                    className={`w-full px-2 py-1.5 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg flex items-center justify-center gap-1 ${
                                      nblTeamFilter === 'All'
                                        ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                                        : 'text-gray-900 dark:text-white'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1">
                                      <span>ALL</span>
                                    </span>
                                  </button>
                                  {NBL_TEAM_FILTER_OPTIONS.filter((team) => team !== 'All').map((team, index, arr) => (
                                    <button
                                      key={team}
                                      type="button"
                                      onClick={() => {
                                        setNblTeamFilter(team);
                                        setTeamFilterDropdownOpen(false);
                                      }}
                                      className={`w-full px-2 py-1.5 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-center gap-1 ${
                                        nblTeamFilter === team
                                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                                          : 'text-gray-900 dark:text-white'
                                      } ${index === arr.length - 1 ? 'rounded-b-lg' : ''}`}
                                    >
                                      {resolveNblTeamLogo(team, logoByTeam) ? (
                                        <img
                                          src={resolveNblTeamLogo(team, logoByTeam) ?? ''}
                                          alt={team}
                                          className="w-4 h-4 object-contain rounded-full bg-gray-900/10 flex-shrink-0"
                                        />
                                      ) : (
                                        <span
                                          className={`inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] font-semibold flex-shrink-0 ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}
                                        >
                                          {getNblTeamAbbrev(team).slice(0, 1)}
                                        </span>
                                      )}
                                      <span>{getNblTeamAbbrev(team)}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="fixed inset-0 z-40" onClick={() => setTeamFilterDropdownOpen(false)} />
                            </>
                          )}
                        </div>
                      </div>
                    }
                  />
                  )}
                </div>

                {/* 4. Supporting stats (player mode) */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`order-4 lg:order-none w-full min-w-0 flex flex-col rounded-lg ${NBL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 ${
                      showAdvancedFilters ? 'lg:pl-3 lg:pr-6 xl:pl-4 xl:pr-7' : 'lg:px-3 xl:px-4'
                    }`}
                  >
                    {showEmptyShell ? (
                      <div className="min-h-[220px]" />
                    ) : showStatsLoadingShell ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="space-y-3 w-full max-w-md">
                          <div className={`h-4 w-32 rounded animate-pulse ${pulse} mx-auto`} />
                          <div className="grid grid-cols-2 gap-4">
                            <div
                              className={`h-20 rounded-lg animate-pulse ${pulse}`}
                              style={{ animationDelay: '0.1s' }}
                            />
                            <div
                              className={`h-20 rounded-lg animate-pulse ${pulse}`}
                              style={{ animationDelay: '0.2s' }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3
                          className={`text-sm font-semibold mb-1 ${
                            showAdvancedFilters ? 'pl-3 pr-4 sm:pl-4 sm:pr-6' : 'px-3 sm:px-4'
                          } ${isDark ? 'text-gray-200' : 'text-gray-800'}`}
                        >
                          Supporting stats
                        </h3>
                        <NblSupportingStats
                          gameLogs={chartGameLogsForPlayer as unknown as Array<Record<string, unknown>>}
                          timeframe={chartTimeframe}
                          season={NBL_CURRENT_SEASON_YEAR}
                          nextOpponent={displayOpponent}
                          mainChartStat={mainChartStat}
                          supportingStatKind={supportingStatKind}
                          onSupportingStatKindChange={setSupportingStatKind}
                          isDark={!!mounted && isDark}
                          alignRightTight={showAdvancedFilters}
                        />
                      </>
                    )}
                  </div>
                )}

                {nblPropsMode === 'player' && (
                  <div
                    className={`order-6 lg:order-none w-full min-w-0 flex flex-col rounded-lg ${NBL_DASH_CARD_GLOW} pt-4 pb-2 sm:pt-4 sm:pb-2 md:pt-4 md:pb-2 lg:py-4 px-0 ${
                      showAdvancedFilters ? 'lg:pl-3 lg:pr-6 xl:pl-4 xl:pr-7' : 'lg:px-3 xl:px-4'
                    }`}
                  >
                    {showEmptyShell ? (
                      <div className="min-h-[240px]" />
                    ) : showStatsLoadingShell ? (
                      <div className="flex items-center justify-center py-8">
                        <div className={`h-[220px] w-full max-w-md rounded-lg animate-pulse ${pulse}`} />
                      </div>
                    ) : (
                      <>
                        <NblScoringMixPie
                          team={selectedPlayer?.team}
                          playerId={selectedPlayer?.playerId}
                          playerName={selectedPlayer?.name}
                          timeframe={chartTimeframe}
                          season={NBL_CURRENT_SEASON_YEAR}
                          isDark={!!mounted && isDark}
                          rosterPlayers={rosterPlayers}
                          teammateFilterName={teammateFilterName}
                          setTeammateFilterName={setTeammateFilterName}
                          withWithoutMode={withWithoutMode}
                          setWithWithoutMode={setWithWithoutMode}
                          clearTeammateFilter={clearTeammateFilter}
                        />
                      </>
                    )}
                  </div>
                )}

                {nblPropsMode === 'player' && (
                  <div
                    className={`hidden lg:flex w-full min-w-0 flex-col rounded-lg ${NBL_DASH_CARD_GLOW} py-3 sm:py-4 md:py-4 px-0 ${
                      showAdvancedFilters ? 'lg:pl-3 lg:pr-6 xl:pl-4 xl:pr-7' : 'lg:px-3 xl:px-4'
                    }`}
                  >
                    {showEmptyShell || showStatsLoadingShell ? (
                      <div className={`h-[180px] rounded-lg animate-pulse ${pulse}`} />
                    ) : (
                      <NblTeamSelectionsCard
                        isDark={!!mounted && isDark}
                        playerTeam={matchupLeft}
                        opponentTeam={displayOpponent}
                        selectedPlayerName={selectedPlayer?.name}
                        resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                      />
                    )}
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <NblBoxScore
                        gameLogs={selectedPlayerGameLogs}
                        selectedPlayer={selectedPlayer}
                        isLoading={statsLoadingForPlayer || showStatsLoadingShell}
                        isDark={!!mounted && isDark}
                        resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                      />
                    </div>
                  </div>
                )}

                {/* 4b. Lineup under chart — Game Props */}
                {nblPropsMode === 'team' && (
                  <div
                    className={`hidden lg:flex w-full min-w-0 flex-col rounded-lg ${NBL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}
                  >
                    <NblTeamSelectionsCard
                      isDark={!!mounted && isDark}
                      playerTeam={matchupLeft}
                      opponentTeam={displayOpponent}
                      selectedPlayerName={selectedPlayer?.name}
                      resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                    />
                  </div>
                )}

                {/* 4.5 DVP | Breakdown | Matchup — mobile */}
                <div
                  className={`order-5 lg:hidden w-full min-w-0 flex flex-col rounded-lg ${NBL_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4 ${
                    nblRightTab === 'dvp'
                      ? 'overflow-visible pb-4'
                      : 'max-h-[60vh] min-h-0 overflow-hidden'
                  }`}
                >
                  {showEmptyShell ? (
                    <div className="min-h-[280px]" />
                  ) : showStatsLoadingShell ? (
                    <div className="flex items-center justify-center min-h-[280px]">
                      <div className="space-y-3 w-full max-w-md px-2">
                        <div className={`h-4 w-36 rounded animate-pulse ${pulse} mx-auto`} />
                        <div className={`h-10 w-full rounded-lg animate-pulse ${pulse}`} />
                        <div className={`h-44 w-full rounded-lg animate-pulse ${pulse}`} />
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className="flex gap-2 sm:gap-2 mb-2 flex-shrink-0">
                    {nblPropsMode === 'player' && (
                      <>
                        <button
                          type="button"
                          onClick={() => visitRightTab('dvp')}
                          className={`relative flex-1 overflow-visible px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border inline-flex items-center justify-center gap-1.5 ${
                            nblRightTab === 'dvp'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Play Types
                          {nblRightTab === 'dvp' && (
                            <PlayTypesInfoButton
                              isDark={!!mounted && isDark}
                              onAccent
                            />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => visitRightTab('breakdown')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'breakdown'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Opponent Breakdown
                        </button>
                        <button
                          type="button"
                          onClick={() => visitRightTab('team_matchup')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team Matchup
                        </button>
                      </>
                    )}
                    {nblPropsMode === 'team' && (
                      <>
                        <button
                          type="button"
                          onClick={() => visitRightTab('breakdown')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'breakdown'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Opponent Breakdown
                        </button>
                        <button
                          type="button"
                          onClick={() => visitRightTab('team_matchup')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team Matchup
                        </button>
                      </>
                    )}
                  </div>
                  <div
                    className={`relative w-full min-w-0 flex flex-col ${
                      nblRightTab === 'dvp'
                        ? 'overflow-visible'
                        : 'overflow-hidden flex-1 min-h-[280px]'
                    }`}
                  >
                    {nblPropsMode === 'player' && nblRightTabsVisited.has('dvp') && (
                      <div className={nblRightTab === 'dvp' ? 'w-full' : 'hidden'}>
                        <NblDvpCard
                          isDark={!!mounted && isDark}
                          season={NBL_SHOT_CHART_SEASON_YEAR}
                          playerId={selectedPlayer?.playerId || null}
                          opponentName={
                            nblTeamFilter !== 'All' && nblTeamFilter
                              ? nblTeamFilter
                              : displayOpponent
                          }
                          selectedStat={mainChartStat}
                          resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                        />
                      </div>
                    )}
                    {nblRightTabsVisited.has('breakdown') && (
                      <div
                        className={
                          nblRightTab === 'breakdown' ? 'flex flex-col h-full min-h-0' : 'hidden'
                        }
                      >
                        <NblOpponentBreakdownCard
                          isDark={!!mounted && isDark}
                          playerName={
                            nblPropsMode === 'team'
                              ? matchupLeft
                              : selectedPlayer?.name
                                ? String(selectedPlayer.name)
                                : null
                          }
                          lastOpponent={displayOpponent}
                        />
                      </div>
                    )}
                    {nblRightTabsVisited.has('team_matchup') && (
                      <div
                        className={
                          nblRightTab === 'team_matchup' ? 'flex flex-col h-full min-h-0' : 'hidden'
                        }
                      >
                        <NblTeamMatchupCard
                          isDark={!!mounted && isDark}
                          teamName={matchupLeft}
                          opponentName={displayOpponent}
                          resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                        />
                      </div>
                    )}
                  </div>
                  </>
                  )}
                </div>

                {/* 4.52 Player vs Team / Similar Players — mobile (player mode) */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`order-8 lg:hidden w-full min-w-0 rounded-lg ${NBL_DASH_CARD_GLOW} p-3 sm:p-4`}
                  >
                    <div className="flex gap-1.5 mb-2">
                      <button
                        type="button"
                        onClick={() => setPlayerVsContainerTab('comparison')}
                        className={`flex-1 px-1.5 py-2 text-[11px] font-medium rounded-lg transition-colors border ${
                          playerVsContainerTab === 'comparison'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Player vs Team
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerVsContainerTab('similar')}
                        className={`flex-1 px-1.5 py-2 text-[11px] font-medium rounded-lg transition-colors border ${
                          playerVsContainerTab === 'similar'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Similar Players
                      </button>
                    </div>
                    {playerVsContainerTab === 'similar' ? (
                      <NblSimilarPlayersCard
                        isDark={!!mounted && isDark}
                        layout="mobile"
                        season={NBL_SHOT_CHART_SEASON_YEAR}
                        playerId={selectedPlayer?.playerId || null}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        opponentName={
                          nblTeamFilter !== 'All' && nblTeamFilter
                            ? nblTeamFilter
                            : displayOpponent
                        }
                        selectedStat={mainChartStat}
                      />
                    ) : (
                      <NblPlayerVsTeamPanel
                        isDark={!!mounted && isDark}
                        layout="mobile"
                        season={NBL_SHOT_CHART_SEASON_YEAR}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        playerTeam={selectedPlayer?.team || null}
                        opponentName={
                          nblTeamFilter !== 'All' && nblTeamFilter
                            ? nblTeamFilter
                            : displayOpponent
                        }
                        gameLogs={selectedPlayerGameLogs as unknown as Array<Record<string, unknown>>}
                      />
                    )}
                  </div>
                )}

                {/* 4.55 Lineups — mobile */}
                <div
                  className={`order-9 lg:hidden w-full min-w-0 rounded-lg ${NBL_DASH_CARD_GLOW} p-3 sm:p-4`}
                >
                  <NblTeamSelectionsCard
                    isDark={!!mounted && isDark}
                    playerTeam={matchupLeft}
                    opponentTeam={displayOpponent}
                    selectedPlayerName={selectedPlayer?.name}
                    resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                  />
                </div>

                {/* Game Log — mobile, directly under lineups (NBA parity) */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`order-11 lg:hidden w-full min-w-0 rounded-lg ${NBL_DASH_CARD_GLOW} overflow-hidden`}
                  >
                    <NblBoxScore
                      gameLogs={selectedPlayerGameLogs}
                      selectedPlayer={selectedPlayer}
                      isLoading={statsLoadingForPlayer}
                      isDark={!!mounted && isDark}
                      resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                    />
                  </div>
                )}

                {/* 4.6 Injuries — mobile */}
                <div
                  className={`order-10 lg:hidden rounded-lg ${NBL_DASH_CARD_GLOW} p-3 sm:p-4 w-full min-w-0 flex flex-col max-h-[50vh] min-h-0`}
                >
                  {nblPropsMode === 'player' && !selectedPlayer ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
                      Select a player to view
                    </div>
                  ) : (
                    <NblInjuriesCard
                      isDark={!!mounted && isDark}
                      season={NBL_SHOT_CHART_SEASON_YEAR}
                      playerTeam={matchupLeft}
                      playerName={
                        nblPropsMode === 'player'
                          ? selectedPlayer?.name
                            ? String(selectedPlayer.name)
                            : null
                          : matchupLeft
                      }
                      gameLogs={selectedPlayerGameLogs as unknown as Array<Record<string, unknown>>}
                      rosterPlayers={rosterPlayers}
                      teammateFilterName={teammateFilterName}
                      setTeammateFilterName={setTeammateFilterName}
                      withWithoutMode={withWithoutMode}
                      setWithWithoutMode={setWithWithoutMode}
                      clearTeammateFilter={clearTeammateFilter}
                    />
                  )}
                </div>

                {/* 4.7 Ladder — mobile */}
                <div className={`order-12 lg:hidden w-full min-w-0 rounded-lg ${NBL_DASH_CARD_GLOW} p-3 sm:p-4 pb-8 sm:pb-10`}>
                  <NblLadderCard isDark={!!mounted && isDark} logoByTeam={logoByTeam} />
                </div>

                {/* 5. Shot chart — mobile (desktop lives in right panel, same as NBA) */}
                {nblPropsMode === 'player' ? (
                  <div className="order-7 lg:hidden w-full min-w-0">
                    <NblShotChart
                      isDark={!!mounted && isDark}
                      playerName={selectedPlayer?.name}
                      playerTeam={selectedPlayer?.team}
                      opponentTeam={displayOpponent}
                    />
                  </div>
                ) : null}
              </div>

              {/* Right panel — desktop */}
              <div
                className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 pb-8 lg:pb-12 fade-scrollbar custom-scrollbar min-w-0 ${
                  sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
                }`}
              >
                {/* Filter By — desktop */}
                <div
                  className={`hidden lg:block rounded-lg ${NBL_DASH_CARD_GLOW} px-3 pt-3 pb-4 relative overflow-visible`}
                >
                  {showEmptyShell ? (
                    <div className="h-[96px]" />
                  ) : showStatsLoadingShell ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="space-y-3 w-full max-w-md">
                        <div className={`h-4 w-32 rounded animate-pulse ${pulse} mx-auto`} />
                        <div className="grid grid-cols-2 gap-4">
                          <div
                            className={`h-10 rounded-lg animate-pulse ${pulse}`}
                            style={{ animationDelay: '0.1s' }}
                          />
                          <div
                            className={`h-10 rounded-lg animate-pulse ${pulse}`}
                            style={{ animationDelay: '0.2s' }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">
                          Filter By
                        </h3>
                      </div>
                      <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                        <button
                          type="button"
                          onClick={() => {
                            setNblPropsMode('player');
                            setSearchQuery('');
                            setShowSearchDropdown(false);
                            setMainChartStatAndResetLine((prev) => (isNblTeamGameStat(prev) ? 'points' : prev));
                          }}
                          className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                            nblPropsMode === 'player'
                              ? 'bg-purple-600 text-white border-purple-500'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                          }`}
                        >
                          Player Props
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNblPropsMode('team');
                            setSearchQuery('');
                            setShowSearchDropdown(false);
                            setMainChartStatAndResetLine((prev) => defaultNblTeamStat(prev));
                            if (!selectedTeam && selectedPlayer?.team) {
                              setSelectedTeam(selectedPlayer.team);
                            }
                          }}
                          className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                            nblPropsMode === 'team'
                              ? 'bg-purple-600 text-white border-purple-500'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                          }`}
                        >
                          Game Props
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                        {nblPropsMode === 'player'
                          ? 'Analyze individual player statistics and props'
                          : 'Analyze game totals, spreads, and game-based props'}
                      </p>
                    </>
                  )}
                </div>

                {/* DVP | Opponent Breakdown | Team Matchup — desktop */}
                <div className={`hidden lg:block rounded-lg ${NBL_DASH_CARD_GLOW} p-1.5 xl:p-2 w-full min-w-0`}>
                  {showEmptyShell ? (
                    <div className="h-[420px]" />
                  ) : showStatsLoadingShell ? (
                    <div className="flex items-center justify-center h-[420px]">
                      <div className="space-y-3 w-full max-w-md px-2">
                        <div className={`h-4 w-36 rounded animate-pulse ${pulse} mx-auto`} />
                        <div
                          className={`h-10 w-full rounded-lg animate-pulse ${pulse}`}
                          style={{ animationDelay: '0.1s' }}
                        />
                        <div
                          className={`h-10 w-full rounded-lg animate-pulse ${pulse}`}
                          style={{ animationDelay: '0.2s' }}
                        />
                        <div
                          className={`h-10 w-full rounded-lg animate-pulse ${pulse}`}
                          style={{ animationDelay: '0.3s' }}
                        />
                        <div
                          className={`h-44 w-full rounded-lg animate-pulse ${pulse}`}
                          style={{ animationDelay: '0.4s' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-1.5 xl:gap-2 mb-2">
                        {nblPropsMode === 'player' && (
                          <button
                            type="button"
                            onClick={() => visitRightTab('dvp')}
                            className={`relative flex-1 overflow-visible px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border inline-flex items-center justify-center gap-1.5 ${
                              nblRightTab === 'dvp'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Play Types
                            {nblRightTab === 'dvp' && (
                              <PlayTypesInfoButton
                                isDark={!!mounted && isDark}
                                onAccent
                              />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => visitRightTab('breakdown')}
                          className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'breakdown'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Opponent Breakdown
                        </button>
                        <button
                          type="button"
                          onClick={() => visitRightTab('team_matchup')}
                          className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team Matchup
                        </button>
                      </div>
                      <div
                        className={`relative w-full min-w-0 flex flex-col min-h-0 ${
                          nblPropsMode === 'player' && nblRightTab === 'dvp'
                            ? 'overflow-visible'
                            : 'overflow-hidden h-[380px] xl:h-[420px]'
                        }`}
                      >
                        {((nblPropsMode === 'team' && nblRightTab === 'breakdown') ||
                          (nblPropsMode === 'player' && nblRightTabsVisited.has('breakdown'))) && (
                          <div
                            className={
                              nblRightTab === 'breakdown' ? 'flex flex-col h-full min-h-0' : 'hidden'
                            }
                          >
                            <NblOpponentBreakdownCard
                              isDark={!!mounted && isDark}
                              playerName={
                                nblPropsMode === 'team'
                                  ? matchupLeft
                                  : selectedPlayer?.name
                                    ? String(selectedPlayer.name)
                                    : null
                              }
                              lastOpponent={displayOpponent}
                            />
                          </div>
                        )}
                        {nblPropsMode === 'player' && nblRightTabsVisited.has('dvp') && (
                          <div
                            className={
                              nblRightTab === 'dvp' ? 'w-full' : 'hidden'
                            }
                          >
                            <NblDvpCard
                              isDark={!!mounted && isDark}
                              season={NBL_SHOT_CHART_SEASON_YEAR}
                              playerId={selectedPlayer?.playerId || null}
                              opponentName={
                                nblTeamFilter !== 'All' && nblTeamFilter
                                  ? nblTeamFilter
                                  : displayOpponent
                              }
                              selectedStat={mainChartStat}
                              resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                            />
                          </div>
                        )}
                        {((nblPropsMode === 'team' && nblRightTab === 'team_matchup') ||
                          (nblPropsMode === 'player' &&
                            nblRightTabsVisited.has('team_matchup'))) && (
                          <div
                            className={
                              nblRightTab === 'team_matchup'
                                ? 'flex flex-col h-full min-h-0'
                                : 'hidden'
                            }
                          >
                            <NblTeamMatchupCard
                              isDark={!!mounted && isDark}
                              teamName={matchupLeft}
                              opponentName={displayOpponent}
                              resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Shot Chart — desktop (right panel, matches NBA placement) */}
                {nblPropsMode === 'player' ? (
                  <div className="hidden lg:block w-full min-w-0">
                    {showEmptyShell ? (
                      <div className="h-[380px]" />
                    ) : showStatsLoadingShell ? (
                      <div className={`h-[380px] rounded-lg animate-pulse ${pulse}`} />
                    ) : (
                      <NblShotChart
                        isDark={!!mounted && isDark}
                        playerName={selectedPlayer?.name}
                        playerTeam={selectedPlayer?.team}
                        opponentTeam={displayOpponent}
                      />
                    )}
                  </div>
                ) : null}

                {/* Player vs Team / Similar Players — desktop (player mode) */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`hidden lg:block rounded-lg ${NBL_DASH_CARD_GLOW} px-1.5 xl:px-2 py-1.5 xl:py-2 w-full min-w-0 mt-0`}
                  >
                    <div className="flex gap-1 xl:gap-1.5 mb-2">
                      <button
                        type="button"
                        onClick={() => setPlayerVsContainerTab('comparison')}
                        className={`flex-1 px-1.5 xl:px-2 py-1.5 xl:py-2 text-[11px] xl:text-xs font-medium rounded-lg transition-colors border ${
                          playerVsContainerTab === 'comparison'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Player vs Team
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerVsContainerTab('similar')}
                        className={`flex-1 px-1.5 xl:px-2 py-1.5 xl:py-2 text-[11px] xl:text-xs font-medium rounded-lg transition-colors border ${
                          playerVsContainerTab === 'similar'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Similar Players
                      </button>
                    </div>
                    {playerVsContainerTab === 'similar' ? (
                      <NblSimilarPlayersCard
                        isDark={!!mounted && isDark}
                        layout="desktop"
                        season={NBL_SHOT_CHART_SEASON_YEAR}
                        playerId={selectedPlayer?.playerId || null}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        opponentName={
                          nblTeamFilter !== 'All' && nblTeamFilter
                            ? nblTeamFilter
                            : displayOpponent
                        }
                        selectedStat={mainChartStat}
                      />
                    ) : (
                      <NblPlayerVsTeamPanel
                        isDark={!!mounted && isDark}
                        layout="desktop"
                        season={NBL_SHOT_CHART_SEASON_YEAR}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        playerTeam={selectedPlayer?.team || null}
                        opponentName={
                          nblTeamFilter !== 'All' && nblTeamFilter
                            ? nblTeamFilter
                            : displayOpponent
                        }
                        gameLogs={selectedPlayerGameLogs as unknown as Array<Record<string, unknown>>}
                      />
                    )}
                  </div>
                )}

                {/* Injuries — desktop */}
                <div
                  className={`hidden lg:block rounded-lg ${NBL_DASH_CARD_GLOW} p-2 xl:p-3 pb-12 xl:pb-14 w-full min-w-0`}
                >
                  <div className="relative h-[320px] w-full min-w-0 flex flex-col min-h-0">
                    {showEmptyShell ? (
                      <div className="h-[320px]" />
                    ) : showStatsLoadingShell ? (
                      <div className={`h-[320px] rounded-lg animate-pulse ${pulse}`} />
                    ) : (
                      <NblInjuriesCard
                        isDark={!!mounted && isDark}
                        season={NBL_SHOT_CHART_SEASON_YEAR}
                        playerTeam={matchupLeft}
                        playerName={
                          nblPropsMode === 'player'
                            ? selectedPlayer?.name
                              ? String(selectedPlayer.name)
                              : null
                            : matchupLeft
                        }
                        gameLogs={selectedPlayerGameLogs as unknown as Array<Record<string, unknown>>}
                        rosterPlayers={rosterPlayers}
                        teammateFilterName={teammateFilterName}
                        setTeammateFilterName={setTeammateFilterName}
                        withWithoutMode={withWithoutMode}
                        setWithWithoutMode={setWithWithoutMode}
                        clearTeammateFilter={clearTeammateFilter}
                      />
                    )}
                  </div>
                </div>

                {/* Ladder — desktop */}
                <div
                  className={`hidden lg:block rounded-lg ${NBL_DASH_CARD_GLOW} p-2 xl:p-3 pb-8 xl:pb-10 w-full min-w-0 mt-0`}
                >
                  <NblLadderCard isDark={!!mounted && isDark} logoByTeam={logoByTeam} />
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
