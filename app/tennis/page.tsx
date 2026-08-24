'use client';

/**
 * Tennis research dashboard — 1:1 AFL/NBL container layout.
 * Women resolve to WTA, men to ATP; Grand Slam matches stay labeled as slams.
 */

import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import { TennisStatsChart, type NblChartTimeframe } from '@/app/tennis/components/TennisStatsChart';
import {
  TennisSupportingStats,
  defaultSupportingStatForMain,
  type SupportingStatKind,
} from '@/app/tennis/components/TennisSupportingStats';
import {
  DEFAULT_NBL_GAME_FILTERS,
  type NblGameFiltersState,
} from '@/app/tennis/components/TennisGameFilters';
import { TennisBoxScore } from '@/app/tennis/components/TennisBoxScore';
import { TennisShotChart } from '@/app/tennis/components/TennisShotChart';
import TennisDvpCard from '@/app/tennis/components/TennisDvpCard';
import TennisOpponentBreakdownCard from '@/app/tennis/components/TennisOpponentBreakdownCard';
import TennisTeamMatchupCard from '@/app/tennis/components/TennisTeamMatchupCard';
import { TennisTeamSelectionsCard } from '@/app/tennis/components/TennisTeamSelectionsCard';
import { TennisInjuriesCard } from '@/app/tennis/components/TennisInjuriesCard';
import { TennisLadderCard } from '@/app/tennis/components/TennisLadderCard';
import { TennisSimilarPlayersCard } from '@/app/tennis/components/TennisSimilarPlayersCard';
import { TennisPlayerVsTeamPanel } from '@/app/tennis/components/TennisPlayerVsTeamPanel';
import { TENNIS_DASH_CARD_GLOW } from '@/app/tennis/components/tennisDashCardGlow';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchProfileProStatusWithRetries } from '@/lib/profileSubscriptionGate';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { Search } from 'lucide-react';
import { DEFAULT_ODDS_FORMAT, readOddsFormatPreference } from '@/lib/currencyUtils';
import { TENNIS_CURRENT_YEAR, TENNIS_HISTORY_YEARS } from '@/lib/tennis/constants';
import {
  defaultTennisGameStat,
  tennisLastName,
  tennisMatchesPlayed,
  tennisTourLabel,
} from '@/lib/tennis/chartStats';

/** Basketball tipoff LIVE window (~2.5h). */
const NBL_MATCH_DURATION_MS = 2.5 * 60 * 60 * 1000;

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
  tour?: 'ATP' | 'WTA';
};

function resolveNblTeamLogo(teamName: string, logoByTeam: Record<string, string>): string | null {
  if (!teamName) return null;
  if (logoByTeam[teamName]) return logoByTeam[teamName];
  return null;
}

const NBL_TEAM_FILTER_OPTIONS = ['All', 'ATP', 'WTA', 'Grand Slam'];
const TENNIS_TOURS = new Set(['ATP', 'WTA', 'GRAND SLAM']);
const NBL_PAGE_STATE_KEY = 'tennisPageState:v2';
const NBL_PLAYER_LOGS_CACHE_PREFIX = 'tennisPlayerLogsCache:v3';
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
  games: Array<Record<string, unknown>>;
};

function normalizeNblPlayerNameForMatch(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isTennisTourName(value: string | null | undefined): boolean {
  const key = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/_/g, ' ');
  return TENNIS_TOURS.has(key);
}

function isTennisPlayer(
  player: { name?: string | null; team?: string | null; teamCode?: string | null; tour?: string | null } | null
): boolean {
  if (!player || !String(player.name || '').trim()) return false;
  const affiliation = [player.tour, player.team, player.teamCode].find((v) => String(v || '').trim());
  if (!affiliation) return true;
  return isTennisTourName(String(affiliation));
}

function asTennisPlayer(raw: unknown): NblRosterPlayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const player = raw as NblRosterPlayer;
  if (!isTennisPlayer(player)) return null;
  return { ...player, imageUrl: null };
}

function nblPlayerLogsCacheKey(playerId: string): string {
  return `${NBL_PLAYER_LOGS_CACHE_PREFIX}:${playerId}:${TENNIS_HISTORY_YEARS.join(',')}`;
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
} {
  const empty = {
    selectedPlayer: null as NblRosterPlayer | null,
    selectedTeam: null as string | null,
    nblPropsMode: 'player' as NblPropsMode,
    nblRightTab: 'dvp' as NblRightTab,
    nblTeamFilter: 'All',
    chartTimeframe: 'last10' as NblChartTimeframe,
    mainChartStat: 'moneyline',
    nblGameFilters: { ...DEFAULT_NBL_GAME_FILTERS },
    searchQuery: '',
    fromUrl: false,
  };
  if (typeof window === 'undefined') return empty;

  const url = new URL(window.location.href);
  const playerParam = url.searchParams.get('player')?.trim() || '';
  const nameParam = url.searchParams.get('name')?.trim() || '';
  const teamParam = url.searchParams.get('team')?.trim() || '';
  const targetName = playerParam || nameParam;
  const persisted = readPersistedNblPageState();
  const tennisTeamParam = isTennisTourName(teamParam) ? teamParam : '';

  // Prefer a full persisted tennis player when URL name matches (keeps playerId).
  if (targetName && (!teamParam || isTennisTourName(teamParam))) {
    const persistedPlayer = asTennisPlayer(persisted?.selectedPlayer);
    const sameName =
      persistedPlayer &&
      normalizeNblPlayerNameForMatch(persistedPlayer.name) ===
        normalizeNblPlayerNameForMatch(targetName);
    const player: NblRosterPlayer = sameName
      ? persistedPlayer!
      : {
          playerId: null,
          name: targetName,
          team: tennisTeamParam,
          teamCode: sameName ? persistedPlayer!.teamCode : tennisTeamParam || null,
          teamId: null,
          position: null,
          jersey: null,
          imageUrl: null,
          tour: tennisTeamParam === 'WTA' || tennisTeamParam === 'ATP' ? (tennisTeamParam as 'ATP' | 'WTA') : undefined,
        };
    if (player.team && !isTennisTourName(player.team) && !isTennisTourName(player.tour)) {
      return empty;
    }
    const tf = url.searchParams.get('tf')?.trim() || '';
    const stat = url.searchParams.get('stat')?.trim() || '';
    return {
      ...empty,
      selectedPlayer: player,
      selectedTeam: player.team || tennisTeamParam || null,
      nblPropsMode: 'player',
      nblRightTab: 'dvp',
      searchQuery: player.name,
      mainChartStat: defaultTennisGameStat(stat || empty.mainChartStat),
      chartTimeframe:
        tf && (NBL_CHART_TIMEFRAMES as readonly string[]).includes(tf)
          ? (tf as NblChartTimeframe)
          : empty.chartTimeframe,
      fromUrl: true,
    };
  }

  const modeParam = url.searchParams.get('mode')?.trim();
  if (modeParam === 'team' && tennisTeamParam) {
    const tf = url.searchParams.get('tf')?.trim() || '';
    const stat = url.searchParams.get('stat')?.trim() || '';
    const persistedPlayer = asTennisPlayer(persisted?.selectedPlayer);
    return {
      ...empty,
      selectedPlayer: persistedPlayer,
      selectedTeam: tennisTeamParam,
      nblPropsMode: 'team',
      nblRightTab: 'breakdown',
      searchQuery: persistedPlayer?.name || tennisTeamParam,
      mainChartStat: defaultTennisGameStat(stat),
      chartTimeframe:
        tf && (NBL_CHART_TIMEFRAMES as readonly string[]).includes(tf)
          ? (tf as NblChartTimeframe)
          : empty.chartTimeframe,
      fromUrl: true,
    };
  }

  if (!persisted) return empty;

  const player = asTennisPlayer(persisted.selectedPlayer);
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
  const persistedTeam =
    typeof persisted.selectedTeam === 'string' && isTennisTourName(persisted.selectedTeam)
      ? persisted.selectedTeam
      : player?.team && isTennisTourName(player.team)
        ? player.team
        : null;

  return {
    selectedPlayer: player,
    selectedTeam: persistedTeam,
    nblPropsMode: mode,
    nblRightTab: rightTab,
    nblTeamFilter:
      typeof persisted.nblTeamFilter === 'string' &&
      NBL_TEAM_FILTER_OPTIONS.includes(persisted.nblTeamFilter)
        ? persisted.nblTeamFilter
        : 'All',
    chartTimeframe: tf,
    mainChartStat: defaultTennisGameStat(
      typeof persisted.mainChartStat === 'string' ? persisted.mainChartStat : null
    ),
    nblGameFilters:
      persisted.nblGameFilters && typeof persisted.nblGameFilters === 'object'
        ? { ...DEFAULT_NBL_GAME_FILTERS, ...persisted.nblGameFilters }
        : { ...DEFAULT_NBL_GAME_FILTERS },
    searchQuery: player?.name || (mode === 'team' ? String(persistedTeam || '') : ''),
    fromUrl: false,
  };
}

export default function TennisDashboardPage() {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [mounted, setMounted] = useState(false);
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
  const [selectedPlayerGameLogs, setSelectedPlayerGameLogs] = useState<Array<Record<string, unknown>>>([]);
  const [selectedTeamGameLogs, setSelectedTeamGameLogs] = useState<Array<Record<string, unknown>>>([]);
  const [statsLoadingForPlayer, setStatsLoadingForPlayer] = useState(false);
  const [statsLoadingForTeam, setStatsLoadingForTeam] = useState(false);
  const [loadingPlayerFromUrl, setLoadingPlayerFromUrl] = useState(false);
  const [chartDelayElapsed, setChartDelayElapsed] = useState(false);
  const chartUiResetToken = `${nblPropsMode}:${String(selectedPlayer?.name ?? '')}:${String(selectedTeam ?? '')}`;
  const [mainChartStat, setMainChartStat] = useState<string>('moneyline');
  const [chartTimeframe, setChartTimeframe] = useState<NblChartTimeframe>('last10');
  const [supportingStatKind, setSupportingStatKind] = useState<SupportingStatKind>('aces');
  const [nblGameFilters, setNblGameFilters] = useState<NblGameFiltersState>(() => ({
    ...DEFAULT_NBL_GAME_FILTERS,
  }));
  const [nblTeamFilter, setNblTeamFilter] = useState<string>('All');
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

  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);
  const journalDropdownRef = useRef<HTMLDivElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);
  const searchDropdownRef = useRef<HTMLDivElement | null>(null);

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
        const [playersRes] = await Promise.all([
          fetch('/api/tennis/players?currentOnly=1'),
        ]);
        if (cancelled) return;
        if (playersRes.ok) {
          const data = await playersRes.json();
          setRosterPlayers(Array.isArray(data.players) ? data.players : []);
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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  // Resolve restored/URL player against the tennis roster only.
  useEffect(() => {
    if (rosterLoading) return;
    if (!selectedPlayer?.name) {
      if (loadingPlayerFromUrl) setLoadingPlayerFromUrl(false);
      return;
    }
    if (!isTennisPlayer(selectedPlayer)) {
      setSelectedPlayer(null);
      setSelectedTeam(null);
      setSearchQuery('');
      setLoadingPlayerFromUrl(false);
      setStatsLoadingForPlayer(false);
      return;
    }
    const want = normalizeNblPlayerNameForMatch(selectedPlayer.name);
    const teamWant = isTennisTourName(selectedPlayer.team)
      ? String(selectedPlayer.team).toUpperCase()
      : isTennisTourName(selectedPlayer.tour)
        ? String(selectedPlayer.tour).toUpperCase()
        : '';
    const match =
      (selectedPlayer.playerId
        ? rosterPlayers.find((p) => p.playerId && p.playerId === selectedPlayer.playerId)
        : null) ||
      rosterPlayers.find((p) => {
        if (normalizeNblPlayerNameForMatch(p.name) !== want) return false;
        if (!teamWant) return true;
        return String(p.team || p.tour || '').toUpperCase() === teamWant;
      }) ||
      rosterPlayers.find((p) => normalizeNblPlayerNameForMatch(p.name) === want);
    if (match) {
      setSelectedPlayer(match);
      setSelectedTeam(match.team || null);
      setSearchQuery(match.name);
    } else {
      setSelectedPlayer(null);
      setSelectedTeam(null);
      setSearchQuery('');
      setStatsLoadingForPlayer(false);
    }
    setLoadingPlayerFromUrl(false);
  }, [
    rosterLoading,
    rosterPlayers,
    selectedPlayer?.name,
    selectedPlayer?.playerId,
    selectedPlayer?.team,
    selectedPlayer?.tour,
    loadingPlayerFromUrl,
  ]);

  // Persist tennis-only page context. Never keep NBL (or other sport) selections.
  useEffect(() => {
    if (!selectionHydrated) return;
    const tennisPlayer = asTennisPlayer(selectedPlayer);
    const tennisTeam = isTennisTourName(selectedTeam) ? selectedTeam : tennisPlayer?.team || null;
    const payload: PersistedNblPageState = {
      selectedPlayer: tennisPlayer ? { ...tennisPlayer, imageUrl: null } : tennisPlayer,
      selectedTeam: tennisTeam,
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

  // Keep URL in sync with tennis selection only.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectionHydrated) return;
    const url = new URL(window.location.href);
    const tennisPlayer = asTennisPlayer(selectedPlayer);
    if (nblPropsMode === 'player' && tennisPlayer?.name) {
      url.searchParams.set('mode', 'player');
      url.searchParams.set('name', String(tennisPlayer.name ?? ''));
      url.searchParams.set('team', String(tennisPlayer.team ?? tennisPlayer.tour ?? '').trim());
      const nextOpp =
        nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== '—'
          ? nextGameOpponent
          : null;
      if (nextOpp) url.searchParams.set('opponent', nextOpp);
      else url.searchParams.delete('opponent');
      if (mainChartStat) url.searchParams.set('stat', mainChartStat);
      else url.searchParams.delete('stat');
      url.searchParams.set('tf', chartTimeframe);
      url.searchParams.delete('player');
    } else if (nblPropsMode === 'team' && tennisPlayer?.name) {
      url.searchParams.set('mode', 'team');
      url.searchParams.set('name', String(tennisPlayer.name ?? ''));
      url.searchParams.set(
        'team',
        String(tennisPlayer.team ?? tennisPlayer.tour ?? selectedTeam ?? '').trim()
      );
      url.searchParams.delete('player');
      if (mainChartStat) url.searchParams.set('stat', mainChartStat);
      else url.searchParams.delete('stat');
      url.searchParams.set('tf', chartTimeframe);
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
    selectionHydrated,
  ]);

  const visitRightTab = (tab: NblRightTab) => {
    setNblRightTab(tab);
    setNblRightTabsVisited((prev) => new Set(prev).add(tab));
  };

  const filteredPlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rosterPlayers.slice(0, 20);
    return rosterPlayers
      .filter((p) => {
        const name = String(p.name || '').toLowerCase();
        const last = tennisLastName(p.name).toLowerCase();
        const team = String(p.team || p.tour || '').toLowerCase();
        const code = String(p.teamCode || p.tour || '').toLowerCase();
        return name.includes(q) || last.startsWith(q) || team.includes(q) || code.includes(q);
      })
      .slice(0, 20);
  }, [rosterPlayers, searchQuery]);

  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const tours = ['ATP', 'WTA'];
    if (!q) return tours;
    return tours.filter((name) => name.toLowerCase().includes(q));
  }, [searchQuery]);

  const selectPlayer = (player: NblRosterPlayer) => {
    setSelectedPlayer({ ...player, imageUrl: null });
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
          parsed.years.join(',') === TENNIS_HISTORY_YEARS.join(',');
        if (fresh && yearsMatch && Array.isArray(parsed.games)) {
          setSelectedPlayerGameLogs(tennisMatchesPlayed(parsed.games));
          setStatsLoadingForPlayer(false);
          return;
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
          `/api/tennis/matches?playerId=${encodeURIComponent(playerId)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`logs ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const games = tennisMatchesPlayed(
          Array.isArray(data.games) ? (data.games as Array<Record<string, unknown>>) : []
        );
        setSelectedPlayerGameLogs(games);
        try {
          const payload: CachedNblPlayerLogs = {
            createdAt: Date.now(),
            years: [...TENNIS_HISTORY_YEARS],
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

  // Game Props: team score logs (schedule + cached quarter scores).
  useEffect(() => {
    if (nblPropsMode !== 'team') {
      setSelectedTeamGameLogs([]);
      setStatsLoadingForTeam(false);
      return;
    }
    const team = ((name: string | null | undefined) => name || '')(selectedTeam) || String(selectedTeam || '').trim();
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
          `/api/tennis/matches?player=${encodeURIComponent(team)}`,
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
  }, [nblPropsMode, selectedTeam, selectedPlayer?.playerId, selectedPlayer?.name]);

  // Last completed opponent (Sackmann has no upcoming schedule).
  useEffect(() => {
    const logs =
      nblPropsMode === 'team' ? selectedPlayerGameLogs : selectedPlayerGameLogs;
    const last = logs.length ? (logs[logs.length - 1] as { opponent?: string }) : null;
    const opponent = last?.opponent ? String(last.opponent) : null;
    setNextGameOpponent(opponent);
    setNextGameTipoff(null);
    setNextGameOpponentLogo(null);
    setIsGameInProgress(false);
  }, [nblPropsMode, selectedPlayerGameLogs, selectedTeamGameLogs]);

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
    return selectedPlayerGameLogs.map((g, idx) => ({ ...g, __nblGameIndex: idx }));
  }, [selectedPlayerGameLogs]);

  const chartGameLogsForTeam = useMemo(() => {
    return selectedTeamGameLogs.map((g, idx) => ({ ...g, __nblGameIndex: idx }));
  }, [selectedTeamGameLogs]);

  const chartGameLogs = chartGameLogsForPlayer;
  const allChartGameLogs = selectedPlayerGameLogs;

  const lastLog = selectedPlayerGameLogs.length
    ? (selectedPlayerGameLogs[selectedPlayerGameLogs.length - 1] as {
        tour?: string;
        isGrandSlam?: boolean;
      })
    : null;
  const selectedTour: 'ATP' | 'WTA' =
    selectedPlayer?.tour === 'WTA' || selectedPlayer?.team === 'WTA' ? 'WTA' : 'ATP';
  const headerTitle = selectedPlayer?.name || 'Select a Player';
  const headerSubtitle = selectedPlayer
    ? nblPropsMode === 'team'
      ? `${tennisTourLabel({
          tour: lastLog?.tour || selectedPlayer.team,
          isGrandSlam: Boolean(lastLog?.isGrandSlam),
        })} · Game props`
      : tennisTourLabel({
          tour: lastLog?.tour || selectedPlayer.team,
          isGrandSlam: Boolean(lastLog?.isGrandSlam),
        })
    : nblPropsMode === 'team'
      ? 'Search for a player below'
      : 'Search for a player below';
  const matchupLeft = selectedPlayer?.name ? tennisLastName(selectedPlayer.name) : null;
  const matchupLeftLogo = null;
  const displayOpponent = nextGameOpponent
    ? tennisLastName(nextGameOpponent) || nextGameOpponent
    : null;
  const matchupOpponentLogo = null;
  const matchupLeftAbbrev = matchupLeft || '';
  const displayOpponentAbbrev = displayOpponent || '—';

  const hasTeamModeSelection = !!selectedPlayer;
  const showEmptyShell = true;
  const showChartEmpty = !selectedPlayer && !loadingPlayerFromUrl;
  const showStatsLoadingShell =
    !!selectedPlayer && (loadingPlayerFromUrl || statsLoadingForPlayer || !chartDelayElapsed);
  const pulse = isDark ? 'bg-gray-800' : 'bg-gray-200';

  return (
    <div className="min-h-screen h-screen max-h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors overflow-y-auto overflow-x-hidden overscroll-contain lg:max-h-none lg:overflow-y-hidden lg:overflow-x-auto">
      <LoadingBar isLoading={false} isDark={isDark} showImmediately={false} mobileOffset={0} />
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
                  className={`lg:hidden rounded-lg ${TENNIS_DASH_CARD_GLOW} px-3 md:px-4 pt-3 md:pt-4 pb-4 md:pb-5 relative overflow-visible`}
                >
                  {showEmptyShell ? <div className="min-h-[96px]" /> : (
                  <>
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
                        setMainChartStat((prev) => defaultTennisGameStat(prev));
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
                        setMainChartStat((prev) => defaultTennisGameStat(prev));
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
                  </>
                  )}
                </div>

                {/* 2. Header */}
                <div
                  className={`relative z-[60] rounded-lg ${TENNIS_DASH_CARD_GLOW} p-2.5 sm:p-4 md:p-6 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}
                  ref={searchDropdownRef}
                >
                  <div className="flex flex-col gap-1.5 lg:gap-3">
                    {/* Desktop: player info | matchup | spacer */}
                    <div className="hidden lg:flex items-center flex-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 min-w-0">
                          {nblPropsMode === 'player' && selectedPlayer ? (
                            <span className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
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
                          </div>
                        </div>
                      </div>
                      <div className="hidden lg:flex min-w-0 flex-shrink items-end mx-2 xl:mx-4">
                        {matchupLeft ? (
                          <div className="flex items-center gap-1.5 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1.5 xl:px-3 xl:py-2 min-w-0 flex-shrink overflow-hidden">
                            <div className="flex items-center gap-1 xl:gap-1.5 min-w-0 flex-shrink">
                              {matchupLeftLogo ? (
                                <img
                                  src={matchupLeftLogo}
                                  alt={matchupLeft}
                                  className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                />
                              ) : null}
                              <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate">
                                {matchupLeft}
                              </span>
                            </div>
                            {displayOpponent && countdown && !isGameInProgress ? (
                              <div className="flex flex-col items-center flex-shrink-0 min-w-0 w-14 xl:w-20">
                                <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">
                                  Tipoff in
                                </div>
                                <div className="text-xs xl:text-sm font-mono font-semibold text-gray-900 dark:text-white tabular-nums">
                                  {String(countdown.hours).padStart(2, '0')}:
                                  {String(countdown.minutes).padStart(2, '0')}:
                                  {String(countdown.seconds).padStart(2, '0')}
                                </div>
                              </div>
                            ) : displayOpponent && isGameInProgress ? (
                              <div className="flex flex-col items-center flex-shrink-0 min-w-0">
                                <div className="text-xs xl:text-sm font-semibold text-green-600 dark:text-green-400 animate-live-pulse-green">
                                  LIVE
                                </div>
                              </div>
                            ) : displayOpponent && nextGameTipoff ? (
                              <div className="flex flex-col items-center flex-shrink-0 min-w-0">
                                <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  Game time passed
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400 font-medium text-xs flex-shrink-0">
                                VS
                              </span>
                            )}
                            <div className="flex items-center gap-1 xl:gap-1.5 min-w-0 flex-shrink">
                              {displayOpponent ? (
                                <>
                                  {matchupOpponentLogo ? (
                                    <img
                                      src={matchupOpponentLogo}
                                      alt={displayOpponent}
                                      className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                    />
                                  ) : null}
                                  <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate">
                                    {displayOpponent}
                                  </span>
                                </>
                              ) : (
                                <span className="text-gray-400 dark:text-gray-500 text-xs xl:text-sm font-medium flex-shrink-0">
                                  —
                                </span>
                              )}
                            </div>
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

                    {/* Mobile header */}
                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      <div className="w-full min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {nblPropsMode === 'player' && selectedPlayer ? (
                            <span className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                          ) : null}
                          <div className="flex-shrink-0 min-w-0">
                            <div className="flex items-baseline gap-2 mb-0.5">
                              <h1 className="text-base font-bold text-gray-900 dark:text-white truncate">
                                {headerTitle}
                              </h1>
                              {nblPropsMode === 'player' &&
                              selectedPlayer?.jersey != null &&
                              String(selectedPlayer.jersey).trim() !== '' ? (
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                                  #{String(selectedPlayer.jersey)}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                              {headerSubtitle}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-center mt-1">
                        {matchupLeft ? (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-1.5 min-w-0">
                            {matchupLeftLogo ? (
                              <img
                                src={matchupLeftLogo}
                                alt={matchupLeft}
                                className="w-5 h-5 object-contain flex-shrink-0"
                              />
                            ) : null}
                            <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                              {matchupLeftAbbrev || matchupLeft}
                            </span>
                            {displayOpponent && countdown && !isGameInProgress ? (
                              <div className="flex flex-col items-center flex-shrink-0">
                                <div className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  Tipoff in
                                </div>
                                <div className="text-[10px] font-mono font-semibold text-gray-900 dark:text-white tabular-nums">
                                  {String(countdown.hours).padStart(2, '0')}:
                                  {String(countdown.minutes).padStart(2, '0')}:
                                  {String(countdown.seconds).padStart(2, '0')}
                                </div>
                              </div>
                            ) : displayOpponent && isGameInProgress ? (
                              <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">
                                LIVE
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs">VS</span>
                            )}
                            {displayOpponent ? (
                              <>
                                {matchupOpponentLogo ? (
                                  <img
                                    src={matchupOpponentLogo}
                                    alt={displayOpponent}
                                    className="w-5 h-5 object-contain flex-shrink-0"
                                  />
                                ) : null}
                                <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                                  {displayOpponentAbbrev}
                                </span>
                              </>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-1.5">
                            <span className="text-gray-400 dark:text-gray-500 text-xs font-medium">
                              {nblPropsMode === 'team' ? 'Select Team' : 'Select Player'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Search + dropdown */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2 lg:mt-0">
                      <div className="flex-1 relative min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setShowSearchDropdown(true);
                          }}
                          onFocus={() => setShowSearchDropdown(true)}
                          placeholder="Search current ATP / WTA players..."
                          className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm placeholder-gray-500 dark:placeholder-gray-400 ${
                            isDark
                              ? 'bg-[#0f172a] border-gray-600 text-white focus:ring-purple-500 focus:border-purple-500'
                              : 'bg-gray-50 border-gray-300 text-gray-900 focus:ring-purple-500 focus:border-purple-500'
                          }`}
                          aria-label={
                            nblPropsMode === 'team' ? 'Search tennis tours' : 'Search tennis players'
                          }
                          autoComplete="off"
                        />
                        {showSearchDropdown && (
                          <div
                            className={`absolute left-0 right-0 top-full mt-1 rounded-lg border shadow-lg z-[120] max-h-72 overflow-y-auto ${
                              isDark ? 'bg-[#0f172a] border-gray-600' : 'bg-white border-gray-200'
                            }`}
                          >
                            {nblPropsMode === 'team' ? (
                              rosterLoading ? (
                                <div
                                  className={`px-3 py-4 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                                >
                                  Loading players…
                                </div>
                              ) : filteredPlayers.length === 0 ? (
                                <div
                                  className={`px-3 py-4 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                                >
                                  No players match
                                </div>
                              ) : (
                                filteredPlayers.map((player) => (
                                  <button
                                    key={player.playerId || `${player.name}|${player.team}`}
                                    type="button"
                                    onClick={() => selectPlayer(player)}
                                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 ${
                                      isDark
                                        ? 'hover:bg-[#1e293b] text-gray-100'
                                        : 'hover:bg-gray-50 text-gray-900'
                                    }`}
                                  >
                                    <span className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                                    <span className="min-w-0 flex-1">
                                      <span className="font-medium block truncate">{player.name}</span>
                                      <span
                                        className={`text-xs block truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
                                      >
                                        {player.tour || player.team}
                                        {player.jersey ? ` · #${player.jersey}` : ''}
                                      </span>
                                    </span>
                                  </button>
                                ))
                              )
                            ) : rosterLoading ? (
                              <div
                                className={`px-3 py-4 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                              >
                                Loading players…
                              </div>
                            ) : filteredPlayers.length === 0 ? (
                              <div
                                className={`px-3 py-4 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                              >
                                {rosterPlayers.length === 0
                                  ? 'No current players in cache'
                                  : 'No players match'}
                              </div>
                            ) : (
                              filteredPlayers.map((player) => (
                                <button
                                  key={player.playerId || `${player.name}|${player.team}`}
                                  type="button"
                                  onClick={() => selectPlayer(player)}
                                  className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 ${
                                    isDark
                                      ? 'hover:bg-[#1e293b] text-gray-100'
                                      : 'hover:bg-gray-50 text-gray-900'
                                  }`}
                                >
                                  <span className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                                  <span className="min-w-0 flex-1">
                                    <span className="font-medium block truncate">{player.name}</span>
                                    <span
                                      className={`text-xs block truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
                                    >
                                      {player.team}
                                      {player.position ? ` · ${player.position}` : ''}
                                      {player.jersey ? ` · #${player.jersey}` : ''}
                                    </span>
                                  </span>
                                  {player.team && logoByTeam[player.team] ? (
                                    <img
                                      src={logoByTeam[player.team]}
                                      alt=""
                                      className="w-5 h-5 object-contain flex-shrink-0 opacity-80"
                                    />
                                  ) : null}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Chart container — AFL heights */}
                <div
                  className={`chart-container-no-focus relative z-10 rounded-lg p-0 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${TENNIS_DASH_CARD_GLOW} sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0`}
                  style={{ outline: 'none' }}
                >
                  {showChartEmpty ? (
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
                  <TennisStatsChart
                    stats={
                      selectedPlayer
                        ? { name: selectedPlayer.name }
                        : nblPropsMode === 'team'
                          ? { name: selectedTeam || '' }
                          : {}
                    }
                    gameLogs={chartGameLogs as unknown as Array<Record<string, unknown>>}
                    allGameLogs={allChartGameLogs as unknown as Array<Record<string, unknown>>}
                    isDark={!!mounted && isDark}
                    logoByTeam={logoByTeam}
                    isLoading={statsLoadingForPlayer}
                    hasSelectedPlayer={!!selectedPlayer}
                    mode={nblPropsMode}
                    selectedStat={mainChartStat}
                    onSelectedStatChange={setMainChartStat}
                    selectedTimeframe={chartTimeframe}
                    onTimeframeChange={setChartTimeframe}
                    nblGameFilters={nblPropsMode === 'player' ? nblGameFilters : undefined}
                    setNblGameFilters={nblPropsMode === 'player' ? setNblGameFilters : undefined}
                    perGameFilterData={null}
                    nextOpponent={nextGameOpponent}
                    gamePropsTeam={nblPropsMode === 'team' ? selectedTeam : null}
                    uiResetToken={chartUiResetToken}
                    season={TENNIS_CURRENT_YEAR}
                    teammateFilterName={nblPropsMode === 'player' ? teammateFilterName : null}
                    withWithoutMode={withWithoutMode}
                    clearTeammateFilter={clearTeammateFilter}
                    rosterPlayers={rosterPlayers}
                    slotLeftOfLine={null}
                  />
                  )}
                </div>

                {/* 4. Supporting stats + lineup (player mode) */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`w-full min-w-0 flex flex-col rounded-lg ${TENNIS_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}
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
                          className={`text-sm font-semibold mb-1 px-3 sm:px-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}
                        >
                          Supporting stats
                        </h3>
                        <TennisSupportingStats
                          gameLogs={chartGameLogsForPlayer as unknown as Array<Record<string, unknown>>}
                          timeframe={chartTimeframe}
                          season={TENNIS_CURRENT_YEAR}
                          nextOpponent={nextGameOpponent}
                          mainChartStat={mainChartStat}
                          supportingStatKind={supportingStatKind}
                          onSupportingStatKindChange={setSupportingStatKind}
                          isDark={!!mounted && isDark}
                        />
                      </>
                    )}
                    <div className="hidden lg:block mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      {showEmptyShell || showStatsLoadingShell ? (
                        <div className={`h-[180px] rounded-lg animate-pulse ${pulse}`} />
                      ) : (
                        <TennisTeamSelectionsCard
                          isDark={!!mounted && isDark}
                          playerTeam={matchupLeft}
                          opponentTeam={displayOpponent}
                          selectedPlayerName={selectedPlayer?.name}
                          resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                          gameLogs={selectedPlayerGameLogs}
                        />
                      )}
                    </div>
                    {/* Game Log — desktop, directly under lineups (NBA parity) */}
                    <div className="hidden lg:block mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <TennisBoxScore
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
                    className={`w-full min-w-0 flex flex-col rounded-lg ${TENNIS_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}
                  >
                    {showEmptyShell ? <div className="min-h-[180px]" /> : (
                    <TennisTeamSelectionsCard
                      isDark={!!mounted && isDark}
                      playerTeam={matchupLeft}
                      opponentTeam={displayOpponent}
                      selectedPlayerName={selectedPlayer?.name}
                      resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                      gameLogs={selectedPlayerGameLogs}
                    />
                    )}
                  </div>
                )}

                {/* 4.5 DVP | Breakdown | Matchup — mobile */}
                <div
                  className={`lg:hidden w-full min-w-0 flex flex-col rounded-lg ${TENNIS_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4 max-h-[60vh] min-h-0`}
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
                          className={`relative flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'dvp'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          DVP
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
                  <div className="relative flex-1 min-h-[280px] w-full min-w-0 flex flex-col overflow-hidden">
                    {nblPropsMode === 'player' && nblRightTabsVisited.has('dvp') && (
                      <div className={nblRightTab === 'dvp' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
                        <TennisDvpCard
                          isDark={!!mounted && isDark}
                          season={TENNIS_CURRENT_YEAR}
                          playerId={selectedPlayer?.playerId || null}
                          opponentName={nextGameOpponent}
                          selectedStat={mainChartStat}
                          tour={selectedTour}
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
                        <TennisOpponentBreakdownCard
                          isDark={!!mounted && isDark}
                          playerName={
                            nblPropsMode === 'team'
                              ? matchupLeft
                              : selectedPlayer?.name
                                ? String(selectedPlayer.name)
                                : null
                          }
                          lastOpponent={nextGameOpponent}
                          gameLogs={selectedPlayerGameLogs}
                        />
                      </div>
                    )}
                    {nblRightTabsVisited.has('team_matchup') && (
                      <div
                        className={
                          nblRightTab === 'team_matchup' ? 'flex flex-col h-full min-h-0' : 'hidden'
                        }
                      >
                        <TennisTeamMatchupCard
                          isDark={!!mounted && isDark}
                          teamName={selectedPlayer?.name || null}
                          opponentName={nextGameOpponent}
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
                    className={`lg:hidden w-full min-w-0 rounded-lg ${TENNIS_DASH_CARD_GLOW} p-3 sm:p-4`}
                  >
                    {showEmptyShell ? <div className="min-h-[160px]" /> : (
                    <>
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
                      <TennisSimilarPlayersCard
                        isDark={!!mounted && isDark}
                        layout="mobile"
                        season={TENNIS_CURRENT_YEAR}
                        playerId={selectedPlayer?.playerId || null}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        opponentName={nextGameOpponent}
                        selectedStat={mainChartStat}
                        tour={selectedTour}
                      />
                    ) : (
                      <TennisPlayerVsTeamPanel
                        isDark={!!mounted && isDark}
                        layout="mobile"
                        season={TENNIS_CURRENT_YEAR}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        playerTeam={selectedPlayer?.team || null}
                        opponentName={nextGameOpponent}
                        gameLogs={selectedPlayerGameLogs as unknown as Array<Record<string, unknown>>}
                      />
                    )}
                    </>
                    )}
                  </div>
                )}

                {/* 4.55 Lineups — mobile */}
                <div
                  className={`lg:hidden w-full min-w-0 rounded-lg ${TENNIS_DASH_CARD_GLOW} p-3 sm:p-4`}
                >
                  {showEmptyShell ? <div className="min-h-[180px]" /> : (
                  <TennisTeamSelectionsCard
                    isDark={!!mounted && isDark}
                    playerTeam={matchupLeft}
                    opponentTeam={displayOpponent}
                    selectedPlayerName={selectedPlayer?.name}
                    resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                    gameLogs={selectedPlayerGameLogs}
                  />
                  )}
                </div>

                {/* Game Log — mobile, directly under lineups (NBA parity) */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`lg:hidden w-full min-w-0 rounded-lg ${TENNIS_DASH_CARD_GLOW} overflow-hidden`}
                  >
                    {showEmptyShell ? <div className="min-h-[220px]" /> : (
                    <TennisBoxScore
                      gameLogs={selectedPlayerGameLogs}
                      selectedPlayer={selectedPlayer}
                      isLoading={statsLoadingForPlayer}
                      isDark={!!mounted && isDark}
                      resolveTeamLogo={(name) => resolveNblTeamLogo(name, logoByTeam)}
                    />
                    )}
                  </div>
                )}

                {/* 4.6 Injuries — mobile */}
                <div
                  className={`lg:hidden rounded-lg ${TENNIS_DASH_CARD_GLOW} p-3 sm:p-4 w-full min-w-0 flex flex-col max-h-[50vh] min-h-0`}
                >
                  {showEmptyShell ? (
                    <div className="min-h-[220px]" />
                  ) : nblPropsMode === 'player' && !selectedPlayer ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
                      Select a player to view
                    </div>
                  ) : (
                    <TennisInjuriesCard
                      isDark={!!mounted && isDark}
                      season={TENNIS_CURRENT_YEAR}
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
                <div className={`lg:hidden w-full min-w-0 rounded-lg ${TENNIS_DASH_CARD_GLOW} p-3 sm:p-4 pb-8 sm:pb-10`}>
                  {showEmptyShell ? <div className="min-h-[320px]" /> : (
                  <TennisLadderCard isDark={!!mounted && isDark} tour={selectedTour} />
                  )}
                </div>

                {/* 5. Shot chart — mobile (desktop lives in right panel, same as NBA) */}
                {nblPropsMode === 'player' ? (
                  <div className="lg:hidden w-full min-w-0">
                    {showEmptyShell ? (
                      <div className={`rounded-lg ${TENNIS_DASH_CARD_GLOW} min-h-[380px]`} />
                    ) : (
                    <TennisShotChart
                      isDark={!!mounted && isDark}
                      playerName={selectedPlayer?.name}
                      playerTeam={selectedPlayer?.team}
                      opponentTeam={displayOpponent}
                    />
                    )}
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
                  className={`hidden lg:block rounded-lg ${TENNIS_DASH_CARD_GLOW} px-3 pt-3 pb-4 relative overflow-visible`}
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
                            setMainChartStat((prev) => defaultTennisGameStat(prev));
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
                            setMainChartStat((prev) => defaultTennisGameStat(prev));
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
                <div className={`hidden lg:block rounded-lg ${TENNIS_DASH_CARD_GLOW} p-1.5 xl:p-2 w-full min-w-0`}>
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
                            className={`relative flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                              nblRightTab === 'dvp'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            DVP
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
                      <div className="relative h-[380px] xl:h-[420px] w-full min-w-0 flex flex-col min-h-0">
                        {((nblPropsMode === 'team' && nblRightTab === 'breakdown') ||
                          (nblPropsMode === 'player' && nblRightTabsVisited.has('breakdown'))) && (
                          <div
                            className={
                              nblRightTab === 'breakdown' ? 'flex flex-col h-full min-h-0' : 'hidden'
                            }
                          >
                            <TennisOpponentBreakdownCard
                              isDark={!!mounted && isDark}
                              playerName={
                                nblPropsMode === 'team'
                                  ? matchupLeft
                                  : selectedPlayer?.name
                                    ? String(selectedPlayer.name)
                                    : null
                              }
                              lastOpponent={nextGameOpponent}
                          gameLogs={selectedPlayerGameLogs}
                            />
                          </div>
                        )}
                        {nblPropsMode === 'player' && nblRightTabsVisited.has('dvp') && (
                          <div
                            className={
                              nblRightTab === 'dvp'
                                ? 'flex-1 min-h-0 overflow-y-auto flex flex-col'
                                : 'hidden'
                            }
                          >
                            <TennisDvpCard
                              isDark={!!mounted && isDark}
                              season={TENNIS_CURRENT_YEAR}
                              playerId={selectedPlayer?.playerId || null}
                              opponentName={nextGameOpponent}
                              selectedStat={mainChartStat}
                              tour={selectedTour}
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
                            <TennisTeamMatchupCard
                              isDark={!!mounted && isDark}
                              teamName={selectedPlayer?.name || null}
                              opponentName={nextGameOpponent}
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
                      <div className={`rounded-lg ${TENNIS_DASH_CARD_GLOW} h-[380px]`} />
                    ) : showStatsLoadingShell ? (
                      <div className={`h-[380px] rounded-lg animate-pulse ${pulse}`} />
                    ) : (
                      <TennisShotChart
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
                    className={`hidden lg:block rounded-lg ${TENNIS_DASH_CARD_GLOW} px-1.5 xl:px-2 py-1.5 xl:py-2 w-full min-w-0 mt-0`}
                  >
                    {showEmptyShell ? <div className="min-h-[180px]" /> : (
                    <>
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
                      <TennisSimilarPlayersCard
                        isDark={!!mounted && isDark}
                        layout="desktop"
                        season={TENNIS_CURRENT_YEAR}
                        playerId={selectedPlayer?.playerId || null}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        opponentName={nextGameOpponent}
                        selectedStat={mainChartStat}
                        tour={selectedTour}
                      />
                    ) : (
                      <TennisPlayerVsTeamPanel
                        isDark={!!mounted && isDark}
                        layout="desktop"
                        season={TENNIS_CURRENT_YEAR}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        playerTeam={selectedPlayer?.team || null}
                        opponentName={nextGameOpponent}
                        gameLogs={selectedPlayerGameLogs as unknown as Array<Record<string, unknown>>}
                      />
                    )}
                    </>
                    )}
                  </div>
                )}

                {/* Injuries — desktop */}
                <div
                  className={`hidden lg:block rounded-lg ${TENNIS_DASH_CARD_GLOW} p-2 xl:p-3 pb-12 xl:pb-14 w-full min-w-0`}
                >
                  <div className="relative h-[320px] w-full min-w-0 flex flex-col min-h-0">
                    {showEmptyShell ? (
                      <div className="h-[320px]" />
                    ) : showStatsLoadingShell ? (
                      <div className={`h-[320px] rounded-lg animate-pulse ${pulse}`} />
                    ) : (
                      <TennisInjuriesCard
                        isDark={!!mounted && isDark}
                        season={TENNIS_CURRENT_YEAR}
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
                  className={`hidden lg:block rounded-lg ${TENNIS_DASH_CARD_GLOW} p-2 xl:p-3 pb-8 xl:pb-10 w-full min-w-0 mt-0`}
                >
                  {showEmptyShell ? <div className="min-h-[320px]" /> : (
                  <TennisLadderCard isDark={!!mounted && isDark} tour={selectedTour} />
                  )}
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
