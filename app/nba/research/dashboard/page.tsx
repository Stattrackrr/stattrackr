'use client';

/**
 * NBA research dashboard — AFL layout parity including refresh screen logic:
 * localStorage page state, URL sync, loading shells, and client game-logs cache.
 */

import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import { NbaStatsChart, type NbaChartTimeframe } from '@/app/nba/components/NbaStatsChart';
import {
  NbaSupportingStats,
  defaultSupportingStatForMain,
  type SupportingStatKind,
} from '@/app/nba/components/NbaSupportingStats';
import {
  DEFAULT_NBA_GAME_FILTERS,
  type NbaGameFiltersState,
} from '@/app/nba/components/NbaGameFilters';
import { NbaBoxScore } from '@/app/nba/components/NbaBoxScore';
import { NbaShotChart } from '@/app/nba/components/NbaShotChart';
import NbaPlayTypeMatchupCard from '@/app/nba/components/NbaPlayTypeMatchupCard';
import { PositionDefenseCard } from '@/app/nba/research/dashboard/components/dvp';
import { fetchTeamDepthChart } from '@/app/nba/research/dashboard/utils/depthChartUtils';
import { calculateSelectedPosition } from '@/app/nba/research/dashboard/utils/positionUtils';
import NbaOpponentBreakdownCard from '@/app/nba/components/NbaOpponentBreakdownCard';
import NbaTeamMatchupCard from '@/app/nba/components/NbaTeamMatchupCard';
import { NbaTeamSelectionsCard } from '@/app/nba/components/NbaTeamSelectionsCard';
import { NbaLineSelector } from '@/app/nba/components/NbaLineSelector';
import { NbaInjuriesCard } from '@/app/nba/components/NbaInjuriesCard';
import { NbaLadderCard } from '@/app/nba/components/NbaLadderCard';
import { NbaModelPanel } from '@/app/nba/components/NbaModelPanel';
import { NbaSimilarPlayersCard } from '@/app/nba/components/NbaSimilarPlayersCard';
import { NbaLineMovementCard } from '@/app/nba/components/NbaLineMovementCard';
import { NbaPlayerVsTeamPanel } from '@/app/nba/components/NbaPlayerVsTeamPanel';
import { NBA_DASH_CARD_GLOW } from '@/app/nba/components/nbaDashCardGlow';
import { NbaScoringMixPie } from '@/app/nba/components/NbaScoringMixPie';
import {
  FreePlayerLimitPrompt,
  ProFeatureLock,
  ProLockMark,
  ProUpgradeHost,
  openProUpgrade,
} from '@/components/ProFeatureLock';
import { useFreePlayerLock } from '@/hooks/useFreePlayerLock';
import type { PropsDashboardSport } from '@/lib/propsDashboardLinks';
import type { NbaGameLogRow } from '@/lib/nba/dash/types';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchProfileProStatusWithRetries } from '@/lib/profileSubscriptionGate';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { DEFAULT_ODDS_FORMAT, readOddsFormatPreference } from '@/lib/currencyUtils';
import {
  NBA_CHART_HISTORY_YEARS,
  NBA_CLUBS,
  NBA_CURRENT_SEASON_YEAR,
  NBA_SHOT_CHART_SEASON_YEAR,
  nbaTeamCode,
  normalizeTeamKey,
  resolveNbaClubName,
} from '@/lib/nba/dash/teams';
import { defaultNbaTeamStat, isNbaTeamGameStat } from '@/lib/nba/dash/teamGameLogsShared';
import {
  nbaBestLinePick,
  nbaBookLines,
  nbaExactLineOnBook,
  nbaH2hMeetsMinOdds,
  nbaOddsMarketForStat,
  nbaOuHasOdds,
  parseNbaOddsLine,
  type NbaBookRow,
} from '@/lib/nba/dash/oddsTypes';
import { countPostedOddsLines } from '@/lib/dashboardStatLineCounts';
import { normalizeNbaDashStat as normalizeNbaStat } from '@/lib/nba/dash/stats';
import { consumePropsReturnPath } from '@/lib/propsPageSessionCache';
import { readNbaNextGamePrefetch, writeNbaNextGamePrefetch } from '@/lib/nba/dash/nextGamePrefetch';

/** Basketball tipoff LIVE window (~2.5h). */
const NBA_MATCH_DURATION_MS = 2.5 * 60 * 60 * 1000;
const EMPTY_NBA_ODDS_BOOKS: NbaBookRow[] = [];

type NbaDvpPosition = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

/** BDL lists G / F / C (and hybrids); used until the depth chart resolves an exact slot. */
function dvpPositionFromRoster(position: string | null | undefined): NbaDvpPosition | null {
  const p = String(position || '').toUpperCase().replace(/[^A-Z-]/g, '');
  if (!p) return null;
  if (p === 'PG' || p === 'SG' || p === 'SF' || p === 'PF' || p === 'C') return p;
  const first = p.split('-')[0];
  if (first === 'G') return 'SG';
  if (first === 'F') return p.includes('C') ? 'PF' : 'SF';
  if (first === 'C') return 'C';
  return null;
}

type NbaPropsMode = 'player' | 'team';
type NbaRightTab = 'dvp' | 'breakdown' | 'team_matchup';
type NbaPlayerVsTab = 'model' | 'comparison' | 'similar';

type NbaRosterPlayer = {
  playerId: string | null;
  name: string;
  team: string;
  teamCode: string | null;
  teamId: string | null;
  position: string | null;
  jersey: string | null;
  imageUrl: string | null;
};

function resolveNbaTeamLogo(teamName: string, logoByTeam: Record<string, string>): string | null {
  if (!teamName) return null;
  if (logoByTeam[teamName]) return logoByTeam[teamName];
  const normalized = normalizeTeamKey(teamName);
  if (logoByTeam[normalized]) return logoByTeam[normalized];
  for (const [key, url] of Object.entries(logoByTeam)) {
    if (normalizeTeamKey(key) === normalized) return url;
  }
  const club = resolveNbaClubName(teamName);
  if (club && logoByTeam[club]) return logoByTeam[club];
  return null;
}

function getNbaTeamAbbrev(teamName: string): string {
  const club = NBA_CLUBS.find(
    (c) =>
      c.name === teamName ||
      normalizeTeamKey(c.name) === normalizeTeamKey(teamName) ||
      c.code === teamName.toUpperCase() ||
      normalizeTeamKey(c.shortName) === normalizeTeamKey(teamName)
  );
  return club?.code ?? teamName.slice(0, 3).toUpperCase();
}

const NBA_TEAM_FILTER_OPTIONS = ['All', ...NBA_CLUBS.map((c) => c.name)];
const NBA_FREE_PLAYER_SPORTS: readonly PropsDashboardSport[] = ['nba'];
const NBA_PAGE_STATE_KEY = 'nbaPageState:v1';
const NBA_PLAYER_LOGS_CACHE_PREFIX = 'nbaPlayerLogsCache:v4';
const NBA_PLAYER_LOGS_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const CHART_DISPLAY_DELAY_MS = 120;
const NBA_CHART_TIMEFRAMES: readonly NbaChartTimeframe[] = [
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

type PersistedNbaPageState = {
  selectedPlayer: NbaRosterPlayer | null;
  selectedTeam: string | null;
  nbaPropsMode: NbaPropsMode;
  nbaTeamFilter?: string;
  nbaRightTab: NbaRightTab;
  chartTimeframe: NbaChartTimeframe;
  mainChartStat?: string;
  nbaGameFilters?: NbaGameFiltersState | null;
};

type CachedNbaPlayerLogs = {
  createdAt: number;
  years: number[];
  games: NbaGameLogRow[];
};

function normalizeNbaPlayerNameForMatch(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function nbaPlayerLogsCacheKey(playerId: string): string {
  return `${NBA_PLAYER_LOGS_CACHE_PREFIX}:${playerId}:${NBA_CHART_HISTORY_YEARS.join(',')}`;
}

function parseIncomingNbaLine(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeNbaBookName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function nbaTeamSpreadIsAway(
  homeTeam: string | null | undefined,
  selectedTeam: string | null | undefined
): boolean {
  const home = resolveNbaClubName(homeTeam || '');
  const sel = resolveNbaClubName(selectedTeam || '');
  return Boolean(home && sel && home !== sel);
}

function nbaBookHasLineValue(book: NbaBookRow | undefined, value: number | null): boolean {
  if (!book || value == null || !Number.isFinite(value)) return false;
  if (
    nbaBookLines(book).some((l) => {
      const n = parseNbaOddsLine(l.line);
      return n != null && Math.abs(n - value) < 0.01;
    })
  ) {
    return true;
  }
  const total = parseNbaOddsLine(book.Total?.line);
  const spread = parseNbaOddsLine(book.Spread?.line);
  return (
    (total != null && Math.abs(total - value) < 0.01) ||
    (spread != null && Math.abs(spread - value) < 0.01)
  );
}

function readPersistedNbaPageState(): Partial<PersistedNbaPageState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(NBA_PAGE_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<PersistedNbaPageState>;
  } catch {
    return null;
  }
}

function readInitialNbaSelection(): {
  selectedPlayer: NbaRosterPlayer | null;
  selectedTeam: string | null;
  nbaPropsMode: NbaPropsMode;
  nbaRightTab: NbaRightTab;
  nbaTeamFilter: string;
  chartTimeframe: NbaChartTimeframe;
  mainChartStat: string;
  nbaGameFilters: NbaGameFiltersState;
  searchQuery: string;
  fromUrl: boolean;
  incomingLine: number | null;
  incomingBookmaker: string | null;
  incomingOpponent: string | null;
  lockedPropsStat: string | null;
} {
  const empty = {
    selectedPlayer: null as NbaRosterPlayer | null,
    selectedTeam: null as string | null,
    nbaPropsMode: 'player' as NbaPropsMode,
    nbaRightTab: 'dvp' as NbaRightTab,
    nbaTeamFilter: 'All',
    chartTimeframe: 'last10' as NbaChartTimeframe,
    mainChartStat: 'points',
    nbaGameFilters: { ...DEFAULT_NBA_GAME_FILTERS },
    searchQuery: '',
    fromUrl: false,
    incomingLine: null as number | null,
    incomingBookmaker: null as string | null,
    incomingOpponent: null as string | null,
    lockedPropsStat: null as string | null,
  };
  if (typeof window === 'undefined') return empty;

  const url = new URL(window.location.href);
  const playerParam = url.searchParams.get('player')?.trim() || '';
  const nameParam = url.searchParams.get('name')?.trim() || '';
  const teamRaw = url.searchParams.get('team')?.trim() || '';
  const teamParam = teamRaw ? resolveNbaClubName(teamRaw) || teamRaw : '';
  const targetName = playerParam || nameParam;
  const persisted = readPersistedNbaPageState();

  // Prefer a full persisted player when URL name matches (keeps playerId).
  if (targetName) {
    const persistedPlayer =
      persisted?.selectedPlayer && typeof persisted.selectedPlayer === 'object'
        ? (persisted.selectedPlayer as NbaRosterPlayer)
        : null;
    const sameName =
      persistedPlayer &&
      normalizeNbaPlayerNameForMatch(persistedPlayer.name) ===
        normalizeNbaPlayerNameForMatch(targetName);
    let player: NbaRosterPlayer = sameName
      ? persistedPlayer!
      : {
          playerId: null,
          name: targetName,
          team: teamParam,
          teamCode: sameName ? persistedPlayer!.teamCode : null,
          teamId: sameName ? persistedPlayer!.teamId : null,
          position: sameName ? persistedPlayer!.position : null,
          jersey: sameName ? persistedPlayer!.jersey : null,
          imageUrl: sameName ? persistedPlayer!.imageUrl : null,
        };
    const tf = url.searchParams.get('tf')?.trim() || '';
    const stat = url.searchParams.get('stat')?.trim() || '';
    const incomingLine = parseIncomingNbaLine(url.searchParams.get('line'));
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
      nbaPropsMode: 'player',
      nbaRightTab: 'dvp',
      searchQuery: player.name,
      mainChartStat: stat ? normalizeNbaStat(stat) : empty.mainChartStat,
      lockedPropsStat: stat ? normalizeNbaStat(stat) : null,
      chartTimeframe:
        tf && (NBA_CHART_TIMEFRAMES as readonly string[]).includes(tf)
          ? (tf as NbaChartTimeframe)
          : empty.chartTimeframe,
      fromUrl: true,
      incomingLine,
      incomingBookmaker,
      incomingOpponent,
    };
  }

  const modeParam = url.searchParams.get('mode')?.trim();
  if ((modeParam === 'team' || !modeParam) && teamParam) {
    const tf = url.searchParams.get('tf')?.trim() || '';
    const stat = url.searchParams.get('stat')?.trim() || '';
    const incomingLine = parseIncomingNbaLine(url.searchParams.get('line'));
    const incomingBookmaker = url.searchParams.get('bookmaker')?.trim() || null;
    const incomingOpponent = url.searchParams.get('opponent')?.trim() || null;
    const persistedPlayer =
      persisted?.selectedPlayer && typeof persisted.selectedPlayer === 'object'
        ? (persisted.selectedPlayer as NbaRosterPlayer)
        : null;
    const officialTeam = resolveNbaClubName(teamParam) || teamParam;
    return {
      ...empty,
      selectedPlayer: persistedPlayer,
      selectedTeam: officialTeam,
      nbaPropsMode: 'team',
      nbaRightTab: 'breakdown',
      searchQuery: officialTeam,
      mainChartStat: defaultNbaTeamStat(stat),
      chartTimeframe:
        tf && (NBA_CHART_TIMEFRAMES as readonly string[]).includes(tf)
          ? (tf as NbaChartTimeframe)
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
      ? (persisted.selectedPlayer as NbaRosterPlayer)
      : null;
  const mode =
    persisted.nbaPropsMode === 'team' || persisted.nbaPropsMode === 'player'
      ? persisted.nbaPropsMode
      : 'player';
  const rightTab =
    persisted.nbaRightTab === 'breakdown' ||
    persisted.nbaRightTab === 'team_matchup' ||
    persisted.nbaRightTab === 'dvp'
      ? persisted.nbaRightTab
      : 'dvp';
  const tf =
    typeof persisted.chartTimeframe === 'string' &&
    (NBA_CHART_TIMEFRAMES as readonly string[]).includes(persisted.chartTimeframe)
      ? (persisted.chartTimeframe as NbaChartTimeframe)
      : 'last10';

  return {
    selectedPlayer: player,
    selectedTeam:
      typeof persisted.selectedTeam === 'string' && persisted.selectedTeam.trim()
        ? persisted.selectedTeam
        : player?.team || null,
    nbaPropsMode: mode,
    nbaRightTab: rightTab,
    nbaTeamFilter:
      typeof persisted.nbaTeamFilter === 'string' &&
      NBA_TEAM_FILTER_OPTIONS.includes(persisted.nbaTeamFilter)
        ? persisted.nbaTeamFilter
        : 'All',
    chartTimeframe: tf,
    mainChartStat:
      mode === 'team'
        ? defaultNbaTeamStat(
            typeof persisted.mainChartStat === 'string' ? persisted.mainChartStat : null
          )
        : typeof persisted.mainChartStat === 'string' && persisted.mainChartStat.trim()
          ? persisted.mainChartStat
          : 'points',
    nbaGameFilters:
      persisted.nbaGameFilters && typeof persisted.nbaGameFilters === 'object'
        ? { ...DEFAULT_NBA_GAME_FILTERS, ...persisted.nbaGameFilters }
        : { ...DEFAULT_NBA_GAME_FILTERS },
    searchQuery: player?.name || (mode === 'team' ? String(persisted.selectedTeam || '') : ''),
    fromUrl: false,
    incomingLine: null,
    incomingBookmaker: null,
    incomingOpponent: null,
    lockedPropsStat: null,
  };
}

export default function NbaDashboardPage() {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [navigatingToProps, setNavigatingToProps] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [oddsFormat, setOddsFormat] = useState(DEFAULT_ODDS_FORMAT);
  const [isPro, setIsPro] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // SSR-safe defaults only — restore from localStorage/URL after mount (avoids hydration mismatch).
  const [nbaPropsMode, setNbaPropsMode] = useState<NbaPropsMode>('player');
  const [nbaRightTab, setNbaRightTab] = useState<NbaRightTab>('dvp');
  const [nbaRightTabsVisited, setNbaRightTabsVisited] = useState<Set<NbaRightTab>>(
    () => new Set(['dvp'])
  );
  const [playerVsContainerTab, setPlayerVsContainerTab] = useState<NbaPlayerVsTab>('model');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [rosterPlayers, setRosterPlayers] = useState<NbaRosterPlayer[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [logoByTeam, setLogoByTeam] = useState<Record<string, string>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<NbaRosterPlayer | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const aiLocked = profileReady && !isPro;
  const { locked: freeTier, freePicks } = useFreePlayerLock({
    freeAccount: aiLocked,
    sports: NBA_FREE_PLAYER_SPORTS,
    player:
      nbaPropsMode === 'player' && selectedPlayer
        ? { name: selectedPlayer.name, id: selectedPlayer.playerId }
        : null,
  });
  const [selectedPlayerGameLogs, setSelectedPlayerGameLogs] = useState<NbaGameLogRow[]>([]);
  const [selectedTeamGameLogs, setSelectedTeamGameLogs] = useState<Array<Record<string, unknown>>>([]);
  const [statsLoadingForPlayer, setStatsLoadingForPlayer] = useState(false);
  const [statsLoadingForTeam, setStatsLoadingForTeam] = useState(false);
  const [loadingPlayerFromUrl, setLoadingPlayerFromUrl] = useState(false);
  const [chartDelayElapsed, setChartDelayElapsed] = useState(false);
  const chartUiResetToken = `${nbaPropsMode}:${String(selectedPlayer?.name ?? '')}:${String(selectedTeam ?? '')}`;
  const [mainChartStat, setMainChartStat] = useState<string>('points');
  const [lockedPropsStat, setLockedPropsStat] = useState<string | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<NbaChartTimeframe>('last10');
  const [supportingStatKind, setSupportingStatKind] = useState<SupportingStatKind>('minutes');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [nbaGameFilters, setNbaGameFilters] = useState<NbaGameFiltersState>(() => ({
    ...DEFAULT_NBA_GAME_FILTERS,
  }));
  const [nbaTeamFilter, setNbaTeamFilter] = useState<string>('All');
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
  const [nbaOddsBooks, setNbaOddsBooks] = useState<NbaBookRow[]>([]);
  const [nbaPlayerOddsByStat, setNbaPlayerOddsByStat] = useState<Record<string, NbaBookRow[]>>({});
  const [nbaOddsLoading, setNbaOddsLoading] = useState(false);
  const [nbaOddsHomeTeam, setNbaOddsHomeTeam] = useState('');
  const [nbaOddsAwayTeam, setNbaOddsAwayTeam] = useState('');
  const [selectedNbaBookIndex, setSelectedNbaBookIndex] = useState(0);
  const [nbaGameLineValue, setNbaGameLineValue] = useState<number | null>(null);
  const nbaOddsBoardKeyRef = useRef('');
  const preferredNbaBookmakerRef = useRef<string | null>(null);
  const hasIncomingNbaBookOrLineRef = useRef(false);
  const ignoreNextTransientLineRef = useRef(false);
  const autoLineStatRef = useRef<string | null>(null);
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
    const restored = readInitialNbaSelection();
    if (restored.selectedPlayer) {
      setSelectedPlayer(restored.selectedPlayer);
      setStatsLoadingForPlayer(Boolean(restored.selectedPlayer.playerId) || restored.fromUrl);
      setLoadingPlayerFromUrl(restored.fromUrl && !restored.selectedPlayer.playerId);
    }
    if (restored.selectedTeam) setSelectedTeam(restored.selectedTeam);
    setNbaPropsMode(restored.nbaPropsMode);
    setNbaRightTab(restored.nbaRightTab);
    setNbaRightTabsVisited(new Set([restored.nbaRightTab]));
    setNbaTeamFilter(restored.nbaTeamFilter);
    setChartTimeframe(restored.chartTimeframe);
    setMainChartStat(restored.mainChartStat);
    setLockedPropsStat(restored.lockedPropsStat);
    setNbaGameFilters(restored.nbaGameFilters);
    if (restored.searchQuery) setSearchQuery(restored.searchQuery);
    if (restored.incomingLine != null) {
      setNbaGameLineValue(restored.incomingLine);
      hasIncomingNbaBookOrLineRef.current = true;
    }
    if (restored.incomingBookmaker) {
      preferredNbaBookmakerRef.current = restored.incomingBookmaker;
      hasIncomingNbaBookOrLineRef.current = true;
    }
    const teamHint = restored.selectedTeam || restored.selectedPlayer?.team || null;
    const prefetch = readNbaNextGamePrefetch(teamHint);
    const instantOpponent =
      (prefetch?.next_opponent && String(prefetch.next_opponent).trim()) ||
      restored.incomingOpponent ||
      null;
    if (instantOpponent) {
      setNextGameOpponent(resolveNbaClubName(instantOpponent) || instantOpponent);
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
        if (!user || cancelled) {
          if (!cancelled) setProfileReady(true);
          return;
        }
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
        setProfileReady(true);
      } catch {
        if (!cancelled) setProfileReady(true);
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
          // Current rosters only; no prior-season players in search.
          fetch(`/api/nba/dash/players?year=${NBA_CURRENT_SEASON_YEAR}&currentOnly=1`),
          fetch(`/api/nba/dash/team-logos?year=${NBA_CURRENT_SEASON_YEAR}`),
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
    if (nbaPropsMode === 'team' && nbaRightTab === 'dvp') {
      setNbaRightTab('breakdown');
      setNbaRightTabsVisited((prev) => new Set(prev).add('breakdown'));
    }
  }, [nbaPropsMode, nbaRightTab]);

  // Reset chart delay when player/mode changes (same as AFL).
  useEffect(() => {
    setChartDelayElapsed(false);
  }, [nbaPropsMode, selectedPlayer?.playerId, selectedPlayer?.name, selectedTeam]);

  // After stats load, brief delay before showing chart content.
  useEffect(() => {
    if (nbaPropsMode === 'team') {
      if (!String(selectedTeam || '').trim() || statsLoadingForTeam) return;
    } else if (!selectedPlayer || statsLoadingForPlayer || loadingPlayerFromUrl) {
      return;
    }
    const t = setTimeout(() => setChartDelayElapsed(true), CHART_DISPLAY_DELAY_MS);
    return () => clearTimeout(t);
  }, [
    nbaPropsMode,
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
    if (selectedPlayer.playerId && selectedPlayer.team && selectedPlayer.teamCode) {
      if (loadingPlayerFromUrl) setLoadingPlayerFromUrl(false);
      return;
    }
    const want = normalizeNbaPlayerNameForMatch(selectedPlayer.name);
    const teamWant = selectedPlayer.team ? normalizeTeamKey(selectedPlayer.team) : '';
    const match =
      (selectedPlayer.playerId
        ? rosterPlayers.find((p) => String(p.playerId) === String(selectedPlayer.playerId))
        : undefined) ||
      rosterPlayers.find((p) => {
        if (normalizeNbaPlayerNameForMatch(p.name) !== want) return false;
        if (!teamWant) return true;
        return normalizeTeamKey(p.team) === teamWant;
      }) ||
      rosterPlayers.find((p) => normalizeNbaPlayerNameForMatch(p.name) === want) ||
      rosterPlayers.find((p) => normalizeNbaPlayerNameForMatch(p.name).includes(want));
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
      const existing = readPersistedNbaPageState();
      if (existing?.selectedPlayer || existing?.selectedTeam) return;
    }
    const payload: PersistedNbaPageState = {
      selectedPlayer,
      selectedTeam,
      nbaPropsMode,
      nbaTeamFilter,
      nbaRightTab,
      chartTimeframe,
      mainChartStat,
      nbaGameFilters,
    };
    try {
      localStorage.setItem(NBA_PAGE_STATE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [
    selectedPlayer,
    selectedTeam,
    nbaPropsMode,
    nbaTeamFilter,
    nbaRightTab,
    chartTimeframe,
    mainChartStat,
    nbaGameFilters,
    selectionHydrated,
  ]);

  const goBackToPlayerProps = useCallback(() => {
    try {
      localStorage.removeItem(NBA_PAGE_STATE_KEY);
    } catch {
      /* ignore */
    }
    setNavigatingToProps(true);
    const returnPath = consumePropsReturnPath('nba');
    router.prefetch(returnPath);
    router.push(returnPath);
  }, [router]);

  const showBackToPlayerProps = Boolean(
    selectedPlayer || (nbaPropsMode === 'team' && selectedTeam)
  );

  // Keep URL in sync with selection (same pattern as AFL/NBA).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectionHydrated) return;
    // Don't strip shareable URL params when nothing is selected.
    if (!selectedPlayer?.name && nbaPropsMode === 'player') return;
    if (!selectedTeam && nbaPropsMode === 'team') return;
    const url = new URL(window.location.href);
    if (nbaPropsMode === 'player' && selectedPlayer?.name) {
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
      if (nbaGameLineValue != null && Number.isFinite(nbaGameLineValue)) {
        url.searchParams.set('line', String(nbaGameLineValue));
      } else url.searchParams.delete('line');
      url.searchParams.delete('player');
    } else if (nbaPropsMode === 'team' && selectedTeam) {
      url.searchParams.set('mode', 'team');
      url.searchParams.set('team', selectedTeam);
      url.searchParams.delete('name');
      url.searchParams.delete('player');
      if (mainChartStat) url.searchParams.set('stat', mainChartStat);
      else url.searchParams.delete('stat');
      url.searchParams.set('tf', chartTimeframe);
      if (nbaGameLineValue != null && Number.isFinite(nbaGameLineValue)) {
        url.searchParams.set('line', String(nbaGameLineValue));
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
    nbaPropsMode,
    selectedPlayer?.name,
    selectedPlayer?.team,
    selectedTeam,
    nextGameOpponent,
    mainChartStat,
    chartTimeframe,
    nbaGameLineValue,
    selectionHydrated,
  ]);

  const visitRightTab = (tab: NbaRightTab) => {
    if (freeTier && tab === 'dvp') return;
    setNbaRightTab(tab);
    setNbaRightTabsVisited((prev) => new Set(prev).add(tab));
  };

  useEffect(() => {
    if (!freeTier) return;
    if (nbaRightTab === 'dvp') {
      setNbaRightTab('breakdown');
      setNbaRightTabsVisited((prev) => new Set(prev).add('breakdown'));
    }
    if (playerVsContainerTab === 'similar' || playerVsContainerTab === 'model') {
      setPlayerVsContainerTab('comparison');
    }
  }, [freeTier, nbaRightTab, playerVsContainerTab]);

  const selectPlayer = (player: NbaRosterPlayer) => {
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
    const cacheKey = nbaPlayerLogsCacheKey(playerId);
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CachedNbaPlayerLogs;
        const fresh =
          Number.isFinite(parsed?.createdAt) &&
          Date.now() - Number(parsed.createdAt) <= NBA_PLAYER_LOGS_CACHE_TTL_MS;
        const yearsMatch =
          Array.isArray(parsed.years) &&
          parsed.years.join(',') === NBA_CHART_HISTORY_YEARS.join(',');
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
          `/api/nba/dash/player-game-logs?playerId=${encodeURIComponent(playerId)}&years=${NBA_CHART_HISTORY_YEARS.join(',')}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`logs ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const games = Array.isArray(data.games) ? (data.games as NbaGameLogRow[]) : [];
        setSelectedPlayerGameLogs(games);
        try {
          const payload: CachedNbaPlayerLogs = {
            createdAt: Date.now(),
            years: [...NBA_CHART_HISTORY_YEARS],
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

  // DvP position: ESPN depth chart slot, else the roster position.
  const [dvpPosition, setDvpPosition] = useState<NbaDvpPosition | null>(null);
  useEffect(() => {
    if (nbaPropsMode !== 'player' || !selectedPlayer?.name) {
      setDvpPosition(null);
      return;
    }
    const playerName = String(selectedPlayer.name);
    setDvpPosition(dvpPositionFromRoster(selectedPlayer.position));
    const team = selectedPlayer.teamCode || nbaTeamCode(selectedPlayer.team);
    if (!team) return;
    let cancelled = false;
    fetchTeamDepthChart(team).then((depth) => {
      if (cancelled || !depth) return;
      const pos = calculateSelectedPosition({
        propsMode: 'player',
        selectedPlayer: { id: selectedPlayer.playerId || playerName, full: playerName },
        playerTeamRoster: depth,
        allTeamRosters: {},
        originalPlayerTeam: '',
      });
      if (pos) setDvpPosition(pos);
    });
    return () => {
      cancelled = true;
    };
  }, [nbaPropsMode, selectedPlayer?.name, selectedPlayer?.position, selectedPlayer?.teamCode, selectedPlayer?.team, selectedPlayer?.playerId]);

  // Game Props: team score logs (schedule + cached quarter scores).
  useEffect(() => {
    if (nbaPropsMode !== 'team') {
      setSelectedTeamGameLogs([]);
      setStatsLoadingForTeam(false);
      return;
    }
    const team = resolveNbaClubName(selectedTeam) || String(selectedTeam || '').trim();
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
          `/api/nba/dash/team-game-logs?team=${encodeURIComponent(team)}&years=${NBA_CHART_HISTORY_YEARS.join(',')}`,
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
  }, [nbaPropsMode, selectedTeam]);

  const logoByTeamRef = useRef(logoByTeam);
  logoByTeamRef.current = logoByTeam;

  const applyNextGameHint = useCallback(
    (hint: {
      opponent?: string | null;
      tipoff?: string | Date | null;
      opponentLogo?: string | null;
    }) => {
      const opponent = hint.opponent ? resolveNbaClubName(hint.opponent) || hint.opponent : null;
      if (opponent) {
        setNextGameOpponent(opponent);
        setNextGameOpponentLogo(
          hint.opponentLogo || resolveNbaTeamLogo(opponent, logoByTeamRef.current)
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
      nbaPropsMode === 'team'
        ? selectedTeam
        : selectedPlayer?.team || selectedTeam;
    if (!team) {
      setNextGameOpponent(null);
      setNextGameTipoff(null);
      setNextGameOpponentLogo(null);
      setIsGameInProgress(false);
      return;
    }
    const teamKey = normalizeTeamKey(resolveNbaClubName(team) || team);
    const teamChanged = Boolean(nextGameTeamKeyRef.current && nextGameTeamKeyRef.current !== teamKey);
    nextGameTeamKeyRef.current = teamKey;
    const prefetch = readNbaNextGamePrefetch(team);
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
          `/api/nba/dash/next-game?team=${encodeURIComponent(team)}&year=${NBA_CURRENT_SEASON_YEAR}`
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
        writeNbaNextGamePrefetch({
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
  }, [nbaPropsMode, selectedPlayer?.team, selectedTeam, applyNextGameHint]);

  useEffect(() => {
    if (!nextGameOpponent || nextGameOpponentLogo) return;
    const logo = resolveNbaTeamLogo(nextGameOpponent, logoByTeam);
    if (logo) setNextGameOpponentLogo(logo);
  }, [logoByTeam, nextGameOpponent, nextGameOpponentLogo]);

  const nbaOddsTeam =
    nbaPropsMode === 'team' ? selectedTeam : selectedPlayer?.team || selectedTeam;
  const nbaOddsOpponent = nextGameOpponent
    ? resolveNbaClubName(nextGameOpponent) || nextGameOpponent
    : null;
  const nbaOddsStat = mainChartStat;
  const nbaOddsMarket = nbaOddsMarketForStat(nbaPropsMode, nbaOddsStat);
  const nbaDisplayOddsBooks =
    nbaPropsMode === 'player' ? nbaPlayerOddsByStat[nbaOddsStat] ?? EMPTY_NBA_ODDS_BOOKS : nbaOddsBooks;
  const nbaStatLineCounts = useMemo(() => {
    const out: Record<string, number> = {};
    if (nbaPropsMode === 'player') {
      for (const [stat, books] of Object.entries(nbaPlayerOddsByStat)) {
        const count = countPostedOddsLines(books.flatMap((book) => nbaBookLines(book).map((row) => row.line)));
        if (count > 0) out[stat] = count;
      }
      return out;
    }
    const ml = nbaOddsBooks.filter((book) => nbaH2hMeetsMinOdds(book.H2H)).length;
    if (ml > 0) out.moneyline = ml;
    const spread = countPostedOddsLines(
      nbaOddsBooks.map((book) => (nbaOuHasOdds(book.Spread) ? book.Spread.line : null))
    );
    if (spread > 0) out.spread = spread;
    const total = countPostedOddsLines(
      nbaOddsBooks.map((book) => (nbaOuHasOdds(book.Total) ? book.Total.line : null))
    );
    if (total > 0) out.total_pts = total;
    return out;
  }, [nbaOddsBooks, nbaPlayerOddsByStat, nbaPropsMode]);

  const setMainChartStatAndResetLine = useCallback((stat: string | ((prev: string) => string)) => {
    const next = typeof stat === 'function' ? stat(mainChartStat) : stat;
    if (next === mainChartStat) return;
    setMainChartStat(next);
    setNbaGameLineValue(null);
    hasIncomingNbaBookOrLineRef.current = false;
    preferredNbaBookmakerRef.current = null;
    autoLineStatRef.current = null;
  }, [mainChartStat]);

  useEffect(() => {
    const key =
      nbaPropsMode === 'player'
        ? String(selectedPlayer?.name || '').trim()
        : String(selectedTeam || '').trim();
    if (!key) return;
    if (incomingAppliedForKeyRef.current == null) {
      incomingAppliedForKeyRef.current = key;
      return;
    }
    if (incomingAppliedForKeyRef.current === key) return;
    incomingAppliedForKeyRef.current = key;
    hasIncomingNbaBookOrLineRef.current = false;
    preferredNbaBookmakerRef.current = null;
    autoLineStatRef.current = null;
  }, [nbaPropsMode, selectedPlayer?.name, selectedTeam]);

  useEffect(() => {
    const team = nbaOddsTeam ? resolveNbaClubName(nbaOddsTeam) || nbaOddsTeam : null;
    const opponent = nbaOddsOpponent;
    const playerName = selectedPlayer?.name?.trim() || '';
    const wantsPlayerProps = nbaPropsMode === 'player' && !!playerName && !!team && !!opponent;
    const wantsGameOdds = nbaPropsMode === 'team' && !!team && !!opponent;
    const boardKey = wantsPlayerProps
      ? `p:${playerName}|${team}|${opponent}`
      : wantsGameOdds
        ? `t:${team}|${opponent}`
        : '';
    if (!wantsPlayerProps && !wantsGameOdds) {
      nbaOddsBoardKeyRef.current = '';
      setNbaOddsBooks([]);
      setNbaPlayerOddsByStat({});
      setNbaOddsHomeTeam('');
      setNbaOddsAwayTeam('');
      setNbaOddsLoading(false);
      return;
    }
    if (nbaOddsBoardKeyRef.current === boardKey) return;
    nbaOddsBoardKeyRef.current = '';
    setNbaOddsBooks([]);
    setNbaPlayerOddsByStat({});
    setNbaOddsHomeTeam('');
    setNbaOddsAwayTeam('');
    if (!hasIncomingNbaBookOrLineRef.current) {
      setSelectedNbaBookIndex(0);
      setNbaGameLineValue(null);
    }
    let cancelled = false;
    setNbaOddsLoading(true);
    (async () => {
      try {
        const url = wantsPlayerProps
          ? `/api/nba/dash/player-props?player=${encodeURIComponent(playerName)}&stat=points&team=${encodeURIComponent(team!)}&opponent=${encodeURIComponent(opponent!)}`
          : `/api/nba/dash/odds?team=${encodeURIComponent(team!)}&opponent=${encodeURIComponent(opponent!)}`;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        const books = Array.isArray(data?.data) ? (data.data as NbaBookRow[]) : [];
        const byStat =
          data?.byStat && typeof data.byStat === 'object'
            ? (data.byStat as Record<string, NbaBookRow[]>)
            : {};
        const home = typeof data?.homeTeam === 'string' ? data.homeTeam : '';
        const away = typeof data?.awayTeam === 'string' ? data.awayTeam : '';
        const homeKey = normalizeTeamKey(resolveNbaClubName(home) || home);
        const awayKey = normalizeTeamKey(resolveNbaClubName(away) || away);
        const teamKey = normalizeTeamKey(team || '');
        const oppKey = normalizeTeamKey(opponent || '');
        const sideHit = (key: string) => key && (key === homeKey || key === awayKey);
        if (!homeKey || !awayKey || !sideHit(teamKey) || !sideHit(oppKey)) {
          nbaOddsBoardKeyRef.current = boardKey;
          setNbaOddsBooks([]);
          setNbaPlayerOddsByStat({});
          setNbaOddsHomeTeam('');
          setNbaOddsAwayTeam('');
          if (!hasIncomingNbaBookOrLineRef.current) setNbaGameLineValue(null);
          return;
        }
        nbaOddsBoardKeyRef.current = boardKey;
        if (wantsPlayerProps) {
          setNbaPlayerOddsByStat(byStat);
          setNbaOddsBooks([]);
        } else {
          setNbaOddsBooks(books);
          setNbaPlayerOddsByStat({});
        }
        setNbaOddsHomeTeam(home);
        setNbaOddsAwayTeam(away);
        if (!hasIncomingNbaBookOrLineRef.current) {
          setSelectedNbaBookIndex(0);
          setNbaGameLineValue(null);
        }
      } catch {
        if (!cancelled) {
          nbaOddsBoardKeyRef.current = '';
          setNbaOddsBooks([]);
          setNbaPlayerOddsByStat({});
          setNbaOddsHomeTeam('');
          setNbaOddsAwayTeam('');
        }
      } finally {
        if (!cancelled) setNbaOddsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nbaOddsTeam, nbaOddsOpponent, nbaPropsMode, selectedPlayer?.name]);

  useEffect(() => {
    if (nbaOddsMarket !== 'spread' && nbaOddsMarket !== 'total') return;
    // The line opened from the props page stays until the user changes stat.
    if (hasIncomingNbaBookOrLineRef.current) {
      autoLineStatRef.current = mainChartStat;
      return;
    }
    if (!nbaDisplayOddsBooks.length) return;
    if (autoLineStatRef.current === mainChartStat) return;
    const pick = nbaBestLinePick(nbaDisplayOddsBooks, nbaOddsMarket);
    if (!pick) return;
    autoLineStatRef.current = mainChartStat;
    setNbaGameLineValue(pick.line);
    setSelectedNbaBookIndex((prev) => (prev === pick.bookIndex ? prev : pick.bookIndex));
  }, [nbaOddsMarket, nbaDisplayOddsBooks, mainChartStat]);

  useEffect(() => {
    if (!nbaDisplayOddsBooks.length) return;
    const preferredBook = preferredNbaBookmakerRef.current;
    if (preferredBook) {
      const preferredNorm = normalizeNbaBookName(preferredBook);
      const preferredIndex = nbaDisplayOddsBooks.findIndex((b) => {
        const bookNorm = normalizeNbaBookName(b.name);
        return (
          bookNorm === preferredNorm ||
          bookNorm.includes(preferredNorm) ||
          preferredNorm.includes(bookNorm)
        );
      });
      if (preferredIndex >= 0) {
        if (preferredIndex !== selectedNbaBookIndex) setSelectedNbaBookIndex(preferredIndex);
        preferredNbaBookmakerRef.current = null;
        return;
      }
    }
    if (!hasIncomingNbaBookOrLineRef.current) return;
    const incoming = nbaGameLineValue;
    if (incoming == null || !Number.isFinite(incoming)) return;
    if (nbaBookHasLineValue(nbaDisplayOddsBooks[selectedNbaBookIndex], incoming)) return;
    const idx = nbaDisplayOddsBooks.findIndex((b) => nbaBookHasLineValue(b, incoming));
    if (idx >= 0 && idx !== selectedNbaBookIndex) setSelectedNbaBookIndex(idx);
  }, [nbaDisplayOddsBooks, selectedNbaBookIndex, nbaGameLineValue]);

  // When the user moves the betting line, keep the stored value and switch to a
  // book that offers that line (AFL). If no book has it, the selector shows a skeleton.
  useEffect(() => {
    const tol = 0.01;
    const onTransientLine = (e: Event) => {
      if (ignoreNextTransientLineRef.current) {
        ignoreNextTransientLineRef.current = false;
        return;
      }
      const value = (e as CustomEvent<{ value: number }>).detail?.value;
      if (value == null || !Number.isFinite(value)) return;
      const stored =
        nbaPropsMode === 'team' &&
        nbaOddsMarket === 'spread' &&
        nbaTeamSpreadIsAway(nbaOddsHomeTeam, selectedTeam)
          ? -value
          : value;
      setNbaGameLineValue((prev) =>
        prev != null && Number.isFinite(prev) && Math.abs(prev - stored) < tol ? prev : stored
      );
      if (nbaOddsMarket !== 'spread' && nbaOddsMarket !== 'total') return;
      if (!nbaDisplayOddsBooks.length) return;
      const idx = nbaDisplayOddsBooks.findIndex((book) => {
        if (nbaOddsMarket === 'spread') {
          const line = parseNbaOddsLine(book.Spread?.line);
          return line != null && Math.abs(line - stored) < tol;
        }
        return nbaExactLineOnBook(book, stored) != null;
      });
      if (idx >= 0 && idx !== selectedNbaBookIndex) setSelectedNbaBookIndex(idx);
    };
    window.addEventListener('transient-line', onTransientLine);
    return () => window.removeEventListener('transient-line', onTransientLine);
  }, [
    nbaPropsMode,
    nbaOddsMarket,
    nbaOddsHomeTeam,
    selectedTeam,
    nbaDisplayOddsBooks,
    selectedNbaBookIndex,
  ]);

  // Mark tipoff LIVE for ~2.5h after start.
  useEffect(() => {
    if (!nextGameTipoff) {
      setIsGameInProgress(false);
      return;
    }
    const tick = () => {
      const now = Date.now();
      const tip = nextGameTipoff.getTime();
      setIsGameInProgress(now >= tip && now - tip < NBA_MATCH_DURATION_MS);
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
      !nbaTeamFilter || nbaTeamFilter === 'All' || nbaTeamFilter.trim() === ''
        ? selectedPlayerGameLogs
        : selectedPlayerGameLogs.filter((g) => {
            const opp = g.opponent;
            if (!opp) return false;
            const resolved = resolveNbaClubName(opp) || opp.trim();
            return resolved === nbaTeamFilter.trim() || opp.trim() === nbaTeamFilter.trim();
          });
    return base.map((g, idx) => ({ ...g, __nbaGameIndex: idx }));
  }, [selectedPlayerGameLogs, nbaTeamFilter]);

  const chartGameLogsForTeam = useMemo(() => {
    const base =
      !nbaTeamFilter || nbaTeamFilter === 'All' || nbaTeamFilter.trim() === ''
        ? selectedTeamGameLogs
        : selectedTeamGameLogs.filter((g) => {
            const opp = String(g.opponent ?? '');
            if (!opp) return false;
            const resolved = resolveNbaClubName(opp) || opp.trim();
            return resolved === nbaTeamFilter.trim() || opp.trim() === nbaTeamFilter.trim();
          });
    return base.map((g, idx) => ({ ...g, __nbaGameIndex: idx }));
  }, [selectedTeamGameLogs, nbaTeamFilter]);

  const chartGameLogs =
    nbaPropsMode === 'team' ? chartGameLogsForTeam : chartGameLogsForPlayer;
  const allChartGameLogs =
    nbaPropsMode === 'team' ? selectedTeamGameLogs : selectedPlayerGameLogs;

  const headerTitle =
    nbaPropsMode === 'team'
      ? selectedTeam || 'Select a Team'
      : selectedPlayer?.name || 'Select a Player';
  const headerSubtitle =
    nbaPropsMode === 'team'
      ? selectedTeam
        ? 'Game props'
        : 'Select a team'
      : selectedPlayer
        ? selectedPlayer.team
        : 'Select a player';
  const matchupLeft = nbaPropsMode === 'team' ? selectedTeam : selectedPlayer?.team || null;
  const matchupLeftLogo = matchupLeft ? resolveNbaTeamLogo(matchupLeft, logoByTeam) : null;
  const displayOpponent = nextGameOpponent
    ? resolveNbaClubName(nextGameOpponent) || nextGameOpponent
    : null;
  const matchupOpponentLogo =
    nextGameOpponentLogo ||
    (displayOpponent ? resolveNbaTeamLogo(displayOpponent, logoByTeam) : null);
  const matchupLeftAbbrev = matchupLeft ? getNbaTeamAbbrev(matchupLeft) : '';
  const displayOpponentAbbrev = displayOpponent ? getNbaTeamAbbrev(displayOpponent) : '—';
  const dvpOpponentCode = nbaTeamCode(
    nbaTeamFilter !== 'All' && nbaTeamFilter ? nbaTeamFilter : displayOpponent
  );
  const matchupLogoFilter = {
    filter: isDark
      ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))'
      : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))',
  } as const;
  const matchupCenterStatus =
    displayOpponent && countdown && !isGameInProgress ? (
      <div className="flex flex-col items-center flex-shrink-0 min-w-[72px] xl:min-w-[80px]">
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
      <div className="flex flex-col items-center flex-shrink-0 min-w-[72px]">
        <div className="text-xs xl:text-sm font-semibold text-green-600 dark:text-green-400 whitespace-nowrap animate-live-pulse-green">
          LIVE
        </div>
      </div>
    ) : displayOpponent && nextGameTipoff ? (
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
          Game time passed
        </div>
      </div>
    ) : (
      <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] xl:text-xs flex-shrink-0">
        VS
      </span>
    );

  const hasTeamModeSelection = !!String(selectedTeam ?? '').trim();
  const nbaAutoLinePick =
    nbaOddsMarket === 'spread' || nbaOddsMarket === 'total'
      ? nbaBestLinePick(nbaDisplayOddsBooks, nbaOddsMarket)
      : null;
  const nbaBookIndex = nbaDisplayOddsBooks.length
    ? Math.min(
        nbaGameLineValue == null && nbaAutoLinePick ? nbaAutoLinePick.bookIndex : selectedNbaBookIndex,
        nbaDisplayOddsBooks.length - 1
      )
    : 0;
  const nbaResolvedLineValue =
    nbaGameLineValue ?? (nbaAutoLinePick ? nbaAutoLinePick.line : null);
  const nbaExternalLineValue = (() => {
    if (nbaOddsMarket !== 'spread' && nbaOddsMarket !== 'total') return null;
    const value = nbaResolvedLineValue;
    if (value == null || !Number.isFinite(value)) return null;
    if (nbaPropsMode === 'team' && nbaOddsMarket === 'spread' && nbaTeamSpreadIsAway(nbaOddsHomeTeam, selectedTeam)) {
      return -value;
    }
    return value;
  })();
  const showNbaOddsChip =
    nbaPropsMode === 'player' ? !!selectedPlayer : hasTeamModeSelection;
  const nbaOddsChipLoading =
    nbaOddsLoading &&
    (nbaPropsMode === 'player' ? Object.keys(nbaPlayerOddsByStat).length === 0 : nbaOddsBooks.length === 0);
  const showEmptyShell =
    nbaPropsMode === 'team'
      ? !hasTeamModeSelection
      : !selectedPlayer && !loadingPlayerFromUrl;
  const showStatsLoadingShell =
    nbaPropsMode === 'team'
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
                  className={`order-1 lg:hidden rounded-lg ${NBA_DASH_CARD_GLOW} px-3 md:px-4 pt-3 md:pt-4 pb-4 md:pb-5 relative overflow-visible`}
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
                        setNbaPropsMode('player');
                        setSearchQuery('');
                        setShowSearchDropdown(false);
                        setMainChartStatAndResetLine((prev) => (isNbaTeamGameStat(prev) ? 'points' : prev));
                      }}
                      className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        nbaPropsMode === 'player'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Player Props
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNbaPropsMode('team');
                        setSearchQuery('');
                        setShowSearchDropdown(false);
                        setMainChartStatAndResetLine((prev) => defaultNbaTeamStat(prev));
                        if (!selectedTeam && selectedPlayer?.team) {
                          setSelectedTeam(selectedPlayer.team);
                        }
                      }}
                      className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        nbaPropsMode === 'team'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Game Props
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                    {nbaPropsMode === 'player'
                      ? 'Analyze individual player statistics and props'
                      : 'Analyze game totals, spreads, and game-based props'}
                  </p>
                </div>

                {/* 2. Header */}
                <div
                  className={`order-2 lg:order-none relative z-[60] rounded-lg ${NBA_DASH_CARD_GLOW} p-3 sm:p-4 md:p-6 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}
                >
                  <div className="flex flex-col gap-1.5 lg:gap-3">
                    {/* Desktop: player info | centered matchup */}
                    <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 w-full min-w-0">
                      <div className="min-w-0">
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
                          {nbaPropsMode === 'player' && selectedPlayer?.imageUrl ? (
                            <img
                              src={selectedPlayer.imageUrl}
                              alt={selectedPlayer.name}
                              className="w-10 h-10 rounded-full object-cover flex-shrink-0 bg-gray-200 dark:bg-gray-700"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-3 mb-1">
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight break-words">
                                {headerTitle}
                              </h1>
                              {nbaPropsMode === 'player' &&
                              selectedPlayer?.jersey != null &&
                              String(selectedPlayer.jersey).trim() !== '' ? (
                                <span className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex-shrink-0">
                                  #{String(selectedPlayer.jersey)}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400 leading-snug break-words">
                              {headerSubtitle}
                            </div>
                            {nbaPropsMode === 'player' && selectedPlayer?.position ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                Position: {selectedPlayer.position}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-center">
                        {matchupLeft ? (
                          <div className="flex items-center gap-2 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1.5 xl:px-3 xl:py-2 flex-nowrap">
                            <div className="flex items-center gap-1 xl:gap-1.5 min-w-0">
                              {matchupLeftLogo ? (
                                <img
                                  src={matchupLeftLogo}
                                  alt={matchupLeft}
                                  className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                  style={matchupLogoFilter}
                                />
                              ) : null}
                              <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm whitespace-nowrap">
                                {matchupLeftAbbrev || matchupLeft}
                              </span>
                            </div>
                            {matchupCenterStatus}
                            <div className="flex items-center gap-1 xl:gap-1.5 min-w-0">
                              {displayOpponent ? (
                                <>
                                  {matchupOpponentLogo ? (
                                    <img
                                      src={matchupOpponentLogo}
                                      alt={displayOpponent}
                                      className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                      style={matchupLogoFilter}
                                    />
                                  ) : null}
                                  <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm whitespace-nowrap">
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
                        ) : (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                            <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">
                              {nbaPropsMode === 'team' ? 'Select Team' : 'Select Player'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div />
                    </div>

                    {/* Mobile: name, then full team/position, then matchup on its own row */}
                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      <div className="w-full min-w-0">
                        <div className="flex-shrink-0 min-w-0">
                          {selectedPlayer || (nbaPropsMode === 'team' && selectedTeam) ? (
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
                                {nbaPropsMode === 'player' && selectedPlayer?.imageUrl ? (
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
                                  {nbaPropsMode === 'player' &&
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
                                {nbaPropsMode === 'team' ? 'Select a Team' : 'Select a Player'}
                              </h1>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 w-full min-w-0">
                        <div className="w-full min-w-0">
                          {selectedPlayer || (nbaPropsMode === 'team' && selectedTeam) ? (
                            <div>
                              {nbaPropsMode === 'player' ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400 leading-snug break-words">
                                  {headerSubtitle || '—'}
                                </div>
                              ) : null}
                              {nbaPropsMode === 'player' && selectedPlayer?.position ? (
                                <div className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
                                  {selectedPlayer.position}
                                </div>
                              ) : null}
                            </div>
                          ) : loadingPlayerFromUrl ? (
                            <div className="space-y-1">
                              <div className="h-3 w-40 rounded animate-pulse bg-gray-200 dark:bg-gray-700" />
                              <div className="h-3 w-16 rounded animate-pulse bg-gray-200 dark:bg-gray-700" />
                            </div>
                          ) : (
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              Search for a player below
                            </div>
                          )}
                        </div>
                        <div className="flex justify-center w-full min-w-0">
                          {matchupLeft ? (
                            <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2.5 py-1.5 w-fit max-w-full">
                              <div className="flex items-center gap-1 min-w-0">
                                {matchupLeftLogo ? (
                                  <img
                                    src={matchupLeftLogo}
                                    alt={matchupLeft}
                                    className="w-6 h-6 object-contain flex-shrink-0"
                                    style={matchupLogoFilter}
                                  />
                                ) : null}
                                <span className="font-bold text-gray-900 dark:text-white text-xs whitespace-nowrap">
                                  {matchupLeftAbbrev || matchupLeft}
                                </span>
                              </div>
                              {matchupCenterStatus}
                              <div className="flex items-center gap-1 min-w-0">
                                {displayOpponent ? (
                                  <>
                                    {matchupOpponentLogo ? (
                                      <img
                                        src={matchupOpponentLogo}
                                        alt={displayOpponent}
                                        className="w-6 h-6 object-contain flex-shrink-0"
                                        style={matchupLogoFilter}
                                      />
                                    ) : null}
                                    <span className="font-bold text-gray-900 dark:text-white text-xs whitespace-nowrap">
                                      {displayOpponentAbbrev}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                                )}
                              </div>
                            </div>
                          ) : loadingPlayerFromUrl ? (
                            <div className="h-9 w-48 rounded-lg animate-pulse bg-gray-200 dark:bg-gray-700" />
                          ) : (
                            <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                              <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">
                                {nbaPropsMode === 'team' ? 'Select Team' : 'Select Player'}
                              </span>
                            </div>
                          )}
                        </div>                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Chart container — AFL heights */}
                <div
                  className={`order-3 lg:order-none chart-container-no-focus relative z-10 rounded-lg p-0 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${NBA_DASH_CARD_GLOW} ${
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
                  <NbaStatsChart
                    stats={
                      nbaPropsMode === 'team'
                        ? { name: selectedTeam || '' }
                        : selectedPlayer
                          ? { name: selectedPlayer.name }
                          : {}
                    }
                    gameLogs={chartGameLogs as unknown as Array<Record<string, unknown>>}
                    allGameLogs={allChartGameLogs as unknown as Array<Record<string, unknown>>}
                    isDark={!!mounted && isDark}
                    logoByTeam={logoByTeam}
                    isLoading={nbaPropsMode === 'team' ? statsLoadingForTeam : statsLoadingForPlayer}
                    hasSelectedPlayer={
                      nbaPropsMode === 'team'
                        ? hasTeamModeSelection
                        : !!selectedPlayer
                    }
                    mode={nbaPropsMode}
                    selectedStat={mainChartStat}
                    onSelectedStatChange={setMainChartStatAndResetLine}
                    lockOtherStats={freeTier && !!lockedPropsStat}
                    selectedTimeframe={chartTimeframe}
                    onTimeframeChange={setChartTimeframe}
                    showAdvancedFilters={nbaPropsMode === 'player' ? showAdvancedFilters : false}
                    setShowAdvancedFilters={nbaPropsMode === 'player' ? setShowAdvancedFilters : undefined}
                    nbaGameFilters={nbaPropsMode === 'player' ? nbaGameFilters : undefined}
                    setNbaGameFilters={nbaPropsMode === 'player' ? setNbaGameFilters : undefined}
                    perGameFilterData={null}
                    nextOpponent={displayOpponent}
                    gamePropsTeam={nbaPropsMode === 'team' ? selectedTeam : null}
                    uiResetToken={chartUiResetToken}
                    season={NBA_SHOT_CHART_SEASON_YEAR}
                    teammateFilterName={nbaPropsMode === 'player' ? teammateFilterName : null}
                    withWithoutMode={withWithoutMode}
                    clearTeammateFilter={clearTeammateFilter}
                    rosterPlayers={rosterPlayers}
                    statLineCounts={nbaStatLineCounts}
                    slotLeftOfLine={
                      showNbaOddsChip ? (
                        nbaOddsChipLoading ? (
                          <div
                            className={`h-8 w-[100px] sm:w-[110px] md:w-[120px] rounded-lg animate-pulse flex-shrink-0 ${
                              isDark ? 'bg-gray-800' : 'bg-gray-200'
                            }`}
                          />
                        ) : (
                          <NbaLineSelector
                            books={nbaDisplayOddsBooks}
                            market={nbaOddsMarket}
                            selectedBookIndex={nbaBookIndex}
                            onSelectBookIndex={setSelectedNbaBookIndex}
                            oddsFormat={oddsFormat}
                            isDark={!!mounted && isDark}
                            homeTeam={nbaOddsHomeTeam ? getNbaTeamAbbrev(nbaOddsHomeTeam) : nbaOddsHomeTeam}
                            awayTeam={nbaOddsAwayTeam ? getNbaTeamAbbrev(nbaOddsAwayTeam) : nbaOddsAwayTeam}
                            disabled={nbaPropsMode === 'team' ? !hasTeamModeSelection : !selectedPlayer}
                            currentLineValue={
                              nbaOddsMarket === 'spread' || nbaOddsMarket === 'total'
                                ? nbaResolvedLineValue
                                : undefined
                            }
                            onSelectLineValue={(lineValue) => {
                              ignoreNextTransientLineRef.current = true;
                              setNbaGameLineValue(lineValue);
                            }}
                          />
                        )
                      ) : null
                    }
                    externalLineValue={nbaExternalLineValue}
                    slotRightOfControls={
                      <div className="flex items-center gap-1.5 relative">
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setTeamFilterDropdownOpen((v) => !v)}
                            className="w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
                          >
                            <span className="flex items-center gap-1 min-w-0">
                              {nbaTeamFilter !== 'All' && resolveNbaTeamLogo(nbaTeamFilter, logoByTeam) ? (
                                <img
                                  src={resolveNbaTeamLogo(nbaTeamFilter, logoByTeam) ?? ''}
                                  alt={nbaTeamFilter}
                                  className="w-4 h-4 object-contain rounded-full bg-gray-900/10 flex-shrink-0"
                                />
                              ) : nbaTeamFilter !== 'All' ? (
                                <span
                                  className={`inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] font-semibold flex-shrink-0 ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}
                                >
                                  {getNbaTeamAbbrev(nbaTeamFilter).slice(0, 1)}
                                </span>
                              ) : null}
                              <span className="truncate text-xs font-medium">
                                {nbaTeamFilter === 'All' ? 'ALL' : getNbaTeamAbbrev(nbaTeamFilter)}
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
                                      setNbaTeamFilter('All');
                                      setTeamFilterDropdownOpen(false);
                                    }}
                                    className={`w-full px-2 py-1.5 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg flex items-center justify-center gap-1 ${
                                      nbaTeamFilter === 'All'
                                        ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                                        : 'text-gray-900 dark:text-white'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1">
                                      <span>ALL</span>
                                    </span>
                                  </button>
                                  {NBA_TEAM_FILTER_OPTIONS.filter((team) => team !== 'All').map((team, index, arr) => (
                                    <button
                                      key={team}
                                      type="button"
                                      onClick={() => {
                                        setNbaTeamFilter(team);
                                        setTeamFilterDropdownOpen(false);
                                      }}
                                      className={`w-full px-2 py-1.5 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-center gap-1 ${
                                        nbaTeamFilter === team
                                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                                          : 'text-gray-900 dark:text-white'
                                      } ${index === arr.length - 1 ? 'rounded-b-lg' : ''}`}
                                    >
                                      {resolveNbaTeamLogo(team, logoByTeam) ? (
                                        <img
                                          src={resolveNbaTeamLogo(team, logoByTeam) ?? ''}
                                          alt={team}
                                          className="w-4 h-4 object-contain rounded-full bg-gray-900/10 flex-shrink-0"
                                        />
                                      ) : (
                                        <span
                                          className={`inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] font-semibold flex-shrink-0 ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}
                                        >
                                          {getNbaTeamAbbrev(team).slice(0, 1)}
                                        </span>
                                      )}
                                      <span>{getNbaTeamAbbrev(team)}</span>
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
                {nbaPropsMode === 'player' && (
                  <div
                    className={`order-4 lg:order-none w-full min-w-0 flex flex-col rounded-lg ${NBA_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 ${
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
                        <NbaSupportingStats
                          gameLogs={chartGameLogsForPlayer as unknown as Array<Record<string, unknown>>}
                          timeframe={chartTimeframe}
                          season={NBA_CURRENT_SEASON_YEAR}
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

                {nbaPropsMode === 'player' && (
                  <div
                    className={`order-6 lg:order-none w-full min-w-0 flex flex-col rounded-lg ${NBA_DASH_CARD_GLOW} pt-4 pb-2 sm:pt-4 sm:pb-2 md:pt-4 md:pb-2 lg:py-4 px-0 ${
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
                        <ProFeatureLock locked={freeTier}>
                        <NbaScoringMixPie
                          team={selectedPlayer?.team}
                          playerId={selectedPlayer?.playerId}
                          playerName={selectedPlayer?.name}
                          timeframe={chartTimeframe}
                          season={NBA_CURRENT_SEASON_YEAR}
                          isDark={!!mounted && isDark}
                          rosterPlayers={rosterPlayers}
                          teammateFilterName={teammateFilterName}
                          setTeammateFilterName={setTeammateFilterName}
                          withWithoutMode={withWithoutMode}
                          setWithWithoutMode={setWithWithoutMode}
                          clearTeammateFilter={clearTeammateFilter}
                          valuesLocked={freeTier}
                        />
                        </ProFeatureLock>
                      </>
                    )}
                  </div>
                )}

                {nbaPropsMode === 'player' && (
                  <div
                    className={`hidden lg:flex w-full min-w-0 flex-col rounded-lg ${NBA_DASH_CARD_GLOW} py-3 sm:py-4 md:py-4 px-0 ${
                      showAdvancedFilters ? 'lg:pl-3 lg:pr-6 xl:pl-4 xl:pr-7' : 'lg:px-3 xl:px-4'
                    }`}
                  >
                    {showEmptyShell || showStatsLoadingShell ? (
                      <div className={`h-[180px] rounded-lg animate-pulse ${pulse}`} />
                    ) : (
                      <NbaTeamSelectionsCard
                        isDark={!!mounted && isDark}
                        playerTeam={matchupLeft}
                        opponentTeam={displayOpponent}
                        selectedPlayerName={selectedPlayer?.name}
                        resolveTeamLogo={(name) => resolveNbaTeamLogo(name, logoByTeam)}
                      />
                    )}
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <NbaBoxScore
                        gameLogs={selectedPlayerGameLogs}
                        selectedPlayer={selectedPlayer}
                        isLoading={statsLoadingForPlayer || showStatsLoadingShell}
                        isDark={!!mounted && isDark}
                        resolveTeamLogo={(name) => resolveNbaTeamLogo(name, logoByTeam)}
                      />
                    </div>
                  </div>
                )}

                {/* 4b. Lineup under chart — Game Props */}
                {nbaPropsMode === 'team' && (
                  <div
                    className={`hidden lg:flex w-full min-w-0 flex-col rounded-lg ${NBA_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}
                  >
                    <NbaTeamSelectionsCard
                      isDark={!!mounted && isDark}
                      playerTeam={matchupLeft}
                      opponentTeam={displayOpponent}
                      selectedPlayerName={selectedPlayer?.name}
                      resolveTeamLogo={(name) => resolveNbaTeamLogo(name, logoByTeam)}
                    />
                  </div>
                )}

                {/* 4.5 DVP | Breakdown | Matchup — mobile */}
                <div
                  className={`order-5 lg:hidden w-full min-w-0 flex flex-col rounded-lg ${NBA_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4 ${
                    nbaRightTab === 'dvp'
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
                    {nbaPropsMode === 'player' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (freeTier) {
                              openProUpgrade();
                              return;
                            }
                            visitRightTab('dvp');
                          }}
                          className={`relative flex-1 overflow-visible px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border inline-flex items-center justify-center gap-1.5 ${
                            nbaRightTab === 'dvp'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          } ${freeTier ? 'cursor-pointer opacity-65' : ''}`}
                        >
                          DvP
                          {freeTier ? <ProLockMark /> : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => visitRightTab('breakdown')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nbaRightTab === 'breakdown'
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
                            nbaRightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team Matchup
                        </button>
                      </>
                    )}
                    {nbaPropsMode === 'team' && (
                      <>
                        <button
                          type="button"
                          onClick={() => visitRightTab('breakdown')}
                          className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nbaRightTab === 'breakdown'
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
                            nbaRightTab === 'team_matchup'
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
                      nbaRightTab === 'dvp'
                        ? 'overflow-visible'
                        : 'overflow-hidden flex-1 min-h-[280px]'
                    }`}
                  >
                    {nbaPropsMode === 'player' && nbaRightTabsVisited.has('dvp') && (
                      <div className={nbaRightTab === 'dvp' ? 'w-full' : 'hidden'}>
                        <PositionDefenseCard
                          isDark={!!mounted && isDark}
                          opponentTeam={dvpOpponentCode}
                          selectedPosition={dvpPosition}
                          currentTeam={selectedPlayer?.teamCode || ''}
                        />
                      </div>
                    )}
                    {nbaRightTabsVisited.has('breakdown') && (
                      <div
                        className={
                          nbaRightTab === 'breakdown' ? 'flex flex-col h-full min-h-0' : 'hidden'
                        }
                      >
                        <NbaOpponentBreakdownCard
                          isDark={!!mounted && isDark}
                          playerName={
                            nbaPropsMode === 'team'
                              ? matchupLeft
                              : selectedPlayer?.name
                                ? String(selectedPlayer.name)
                                : null
                          }
                          lastOpponent={displayOpponent}
                        />
                      </div>
                    )}
                    {nbaRightTabsVisited.has('team_matchup') && (
                      <div
                        className={
                          nbaRightTab === 'team_matchup' ? 'flex flex-col h-full min-h-0' : 'hidden'
                        }
                      >
                        <NbaTeamMatchupCard
                          isDark={!!mounted && isDark}
                          teamName={matchupLeft}
                          opponentName={displayOpponent}
                          resolveTeamLogo={(name) => resolveNbaTeamLogo(name, logoByTeam)}
                        />
                      </div>
                    )}
                  </div>
                  </>
                  )}
                </div>

                {/* 4.52 Player vs Team / Similar Players — mobile (player mode) */}
                {nbaPropsMode === 'player' && (
                  <div
                    className={`order-8 lg:hidden w-full min-w-0 rounded-lg ${NBA_DASH_CARD_GLOW} p-3 sm:p-4`}
                  >
                    <div className="flex gap-1.5 mb-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (aiLocked) {
                            openProUpgrade();
                            return;
                          }
                          setPlayerVsContainerTab('model');
                        }}
                        className={`relative flex-1 px-1.5 py-2 text-[11px] font-medium rounded-lg transition-colors border inline-flex items-center justify-center gap-1 ${
                          playerVsContainerTab === 'model'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        } ${aiLocked ? 'cursor-pointer opacity-65' : ''}`}
                      >
                        Model
                        {aiLocked ? <ProLockMark /> : null}
                      </button>
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
                        onClick={() => {
                          if (freeTier) {
                            openProUpgrade();
                            return;
                          }
                          setPlayerVsContainerTab('similar');
                        }}
                        className={`flex-1 px-1.5 py-2 text-[11px] font-medium rounded-lg transition-colors border inline-flex items-center justify-center gap-1 ${
                          playerVsContainerTab === 'similar'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        } ${freeTier ? 'cursor-pointer opacity-65' : ''}`}
                      >
                        Similar Players
                        {freeTier ? <ProLockMark /> : null}
                      </button>
                    </div>
                    {playerVsContainerTab === 'model' ? (
                      <ProFeatureLock locked={aiLocked}>
                        <NbaModelPanel
                          isDark={!!mounted && isDark}
                          layout="mobile"
                          playerId={selectedPlayer?.playerId || null}
                          playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                          opponentName={
                            nbaTeamFilter !== 'All' && nbaTeamFilter
                              ? nbaTeamFilter
                              : displayOpponent
                          }
                          selectedStat={mainChartStat}
                          selectedLine={nbaGameLineValue}
                          onSelectStat={setMainChartStatAndResetLine}
                          previewLocked={aiLocked}
                        />
                      </ProFeatureLock>
                    ) : playerVsContainerTab === 'similar' ? (
                      <NbaSimilarPlayersCard
                        isDark={!!mounted && isDark}
                        layout="mobile"
                        season={NBA_SHOT_CHART_SEASON_YEAR}
                        playerId={selectedPlayer?.playerId || null}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        opponentName={
                          nbaTeamFilter !== 'All' && nbaTeamFilter
                            ? nbaTeamFilter
                            : displayOpponent
                        }
                        selectedStat={mainChartStat}
                      />
                    ) : (
                      <NbaPlayerVsTeamPanel
                        isDark={!!mounted && isDark}
                        layout="mobile"
                        season={NBA_SHOT_CHART_SEASON_YEAR}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        playerTeam={selectedPlayer?.team || null}
                        opponentName={
                          nbaTeamFilter !== 'All' && nbaTeamFilter
                            ? nbaTeamFilter
                            : displayOpponent
                        }
                        gameLogs={selectedPlayerGameLogs as unknown as Array<Record<string, unknown>>}
                      />
                    )}
                  </div>
                )}

                {/* 4.53 Line movement — mobile (player mode, sits right after the AI container) */}
                {nbaPropsMode === 'player' && (
                  <div className={`order-8 lg:hidden w-full min-w-0 rounded-lg ${NBA_DASH_CARD_GLOW} p-3 sm:p-4`}>
                    <NbaLineMovementCard
                      isDark={!!mounted && isDark}
                      playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                      playerTeam={selectedPlayer?.team || null}
                      opponentName={displayOpponent}
                      stat={mainChartStat}
                    />
                  </div>
                )}

                {/* 4.55 Lineups — mobile */}
                <div
                  className={`order-9 lg:hidden w-full min-w-0 rounded-lg ${NBA_DASH_CARD_GLOW} p-3 sm:p-4`}
                >
                  <NbaTeamSelectionsCard
                    isDark={!!mounted && isDark}
                    playerTeam={matchupLeft}
                    opponentTeam={displayOpponent}
                    selectedPlayerName={selectedPlayer?.name}
                    resolveTeamLogo={(name) => resolveNbaTeamLogo(name, logoByTeam)}
                  />
                </div>

                {/* Game Log — mobile, directly under lineups (NBA parity) */}
                {nbaPropsMode === 'player' && (
                  <div
                    className={`order-11 lg:hidden w-full min-w-0 rounded-lg ${NBA_DASH_CARD_GLOW} overflow-hidden`}
                  >
                    <NbaBoxScore
                      gameLogs={selectedPlayerGameLogs}
                      selectedPlayer={selectedPlayer}
                      isLoading={statsLoadingForPlayer}
                      isDark={!!mounted && isDark}
                      resolveTeamLogo={(name) => resolveNbaTeamLogo(name, logoByTeam)}
                    />
                  </div>
                )}

                {/* 4.6 Injuries — mobile */}
                <div
                  className={`order-10 lg:hidden rounded-lg ${NBA_DASH_CARD_GLOW} p-3 sm:p-4 w-full min-w-0 flex flex-col max-h-[50vh] min-h-0`}
                >
                  {nbaPropsMode === 'player' && !selectedPlayer ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
                      Select a player to view
                    </div>
                  ) : (
                    <NbaInjuriesCard
                      isDark={!!mounted && isDark}
                      season={NBA_SHOT_CHART_SEASON_YEAR}
                      playerTeam={matchupLeft}
                      playerName={
                        nbaPropsMode === 'player'
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
                <div className={`order-12 lg:hidden w-full min-w-0 rounded-lg ${NBA_DASH_CARD_GLOW} p-3 sm:p-4 pb-8 sm:pb-10`}>
                  <NbaLadderCard isDark={!!mounted && isDark} logoByTeam={logoByTeam} />
                </div>

                {/* 5. Shot chart — mobile (desktop lives in right panel, same as NBA) */}
                {nbaPropsMode === 'player' ? (
                  <div className="order-7 lg:hidden w-full min-w-0 flex flex-col gap-2 sm:gap-3">
                    <ProFeatureLock locked={freeTier}>
                    <NbaShotChart
                      isDark={!!mounted && isDark}
                      playerName={selectedPlayer?.name}
                      playerTeam={selectedPlayer?.team}
                      opponentTeam={displayOpponent}
                      valuesLocked={freeTier}
                    />
                    </ProFeatureLock>
                    <div className={`rounded-lg ${NBA_DASH_CARD_GLOW}`}>
                      <ProFeatureLock locked={freeTier}>
                        <NbaPlayTypeMatchupCard
                          isDark={!!mounted && isDark}
                          playerId={selectedPlayer?.playerId ? String(selectedPlayer.playerId) : null}
                          playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                          opponentTeam={displayOpponent}
                        />
                      </ProFeatureLock>
                    </div>
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
                  className={`hidden lg:block rounded-lg ${NBA_DASH_CARD_GLOW} px-3 pt-3 pb-4 relative overflow-visible`}
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
                            setNbaPropsMode('player');
                            setSearchQuery('');
                            setShowSearchDropdown(false);
                            setMainChartStatAndResetLine((prev) => (isNbaTeamGameStat(prev) ? 'points' : prev));
                          }}
                          className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                            nbaPropsMode === 'player'
                              ? 'bg-purple-600 text-white border-purple-500'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                          }`}
                        >
                          Player Props
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNbaPropsMode('team');
                            setSearchQuery('');
                            setShowSearchDropdown(false);
                            setMainChartStatAndResetLine((prev) => defaultNbaTeamStat(prev));
                            if (!selectedTeam && selectedPlayer?.team) {
                              setSelectedTeam(selectedPlayer.team);
                            }
                          }}
                          className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                            nbaPropsMode === 'team'
                              ? 'bg-purple-600 text-white border-purple-500'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                          }`}
                        >
                          Game Props
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                        {nbaPropsMode === 'player'
                          ? 'Analyze individual player statistics and props'
                          : 'Analyze game totals, spreads, and game-based props'}
                      </p>
                    </>
                  )}
                </div>

                {/* DVP | Opponent Breakdown | Team Matchup — desktop */}
                <div className={`hidden lg:block rounded-lg ${NBA_DASH_CARD_GLOW} p-1.5 xl:p-2 w-full min-w-0`}>
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
                        {nbaPropsMode === 'player' && (
                          <button
                            type="button"
                            onClick={() => {
                              if (freeTier) {
                                openProUpgrade();
                                return;
                              }
                              visitRightTab('dvp');
                            }}
                            className={`relative flex-1 overflow-visible px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border inline-flex items-center justify-center gap-1.5 ${
                              nbaRightTab === 'dvp'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            } ${freeTier ? 'cursor-pointer opacity-65' : ''}`}
                          >
                            DvP
                            {freeTier ? <ProLockMark /> : null}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => visitRightTab('breakdown')}
                          className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                            nbaRightTab === 'breakdown'
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
                            nbaRightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team Matchup
                        </button>
                      </div>
                      <div
                        className={`relative w-full min-w-0 flex flex-col min-h-0 ${
                          nbaPropsMode === 'player' && nbaRightTab === 'dvp'
                            ? 'overflow-visible'
                            : 'overflow-hidden h-[380px] xl:h-[420px]'
                        }`}
                      >
                        {((nbaPropsMode === 'team' && nbaRightTab === 'breakdown') ||
                          (nbaPropsMode === 'player' && nbaRightTabsVisited.has('breakdown'))) && (
                          <div
                            className={
                              nbaRightTab === 'breakdown' ? 'flex flex-col h-full min-h-0' : 'hidden'
                            }
                          >
                            <NbaOpponentBreakdownCard
                              isDark={!!mounted && isDark}
                              playerName={
                                nbaPropsMode === 'team'
                                  ? matchupLeft
                                  : selectedPlayer?.name
                                    ? String(selectedPlayer.name)
                                    : null
                              }
                              lastOpponent={displayOpponent}
                            />
                          </div>
                        )}
                        {nbaPropsMode === 'player' && nbaRightTabsVisited.has('dvp') && (
                          <div
                            className={
                              nbaRightTab === 'dvp' ? 'w-full' : 'hidden'
                            }
                          >
                            <PositionDefenseCard
                              isDark={!!mounted && isDark}
                              opponentTeam={dvpOpponentCode}
                              selectedPosition={dvpPosition}
                              currentTeam={selectedPlayer?.teamCode || ''}
                            />
                          </div>
                        )}
                        {((nbaPropsMode === 'team' && nbaRightTab === 'team_matchup') ||
                          (nbaPropsMode === 'player' &&
                            nbaRightTabsVisited.has('team_matchup'))) && (
                          <div
                            className={
                              nbaRightTab === 'team_matchup'
                                ? 'flex flex-col h-full min-h-0'
                                : 'hidden'
                            }
                          >
                            <NbaTeamMatchupCard
                              isDark={!!mounted && isDark}
                              teamName={matchupLeft}
                              opponentName={displayOpponent}
                              resolveTeamLogo={(name) => resolveNbaTeamLogo(name, logoByTeam)}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Shot Chart — desktop (right panel, matches NBA placement) */}
                {nbaPropsMode === 'player' ? (
                  <div className="hidden lg:block w-full min-w-0">
                    {showEmptyShell ? (
                      <div className="h-[380px]" />
                    ) : showStatsLoadingShell ? (
                      <div className={`h-[380px] rounded-lg animate-pulse ${pulse}`} />
                    ) : (
                      <ProFeatureLock locked={freeTier}>
                      <NbaShotChart
                        isDark={!!mounted && isDark}
                        playerName={selectedPlayer?.name}
                        playerTeam={selectedPlayer?.team}
                        opponentTeam={displayOpponent}
                        valuesLocked={freeTier}
                      />
                      </ProFeatureLock>
                    )}
                  </div>
                ) : null}

                {/* Play Type Matchup — desktop (below shot chart) */}
                {nbaPropsMode === 'player' && !showEmptyShell && !showStatsLoadingShell ? (
                  <div className={`hidden lg:block rounded-lg ${NBA_DASH_CARD_GLOW} w-full min-w-0`}>
                    <ProFeatureLock locked={freeTier}>
                      <NbaPlayTypeMatchupCard
                        isDark={!!mounted && isDark}
                        playerId={selectedPlayer?.playerId ? String(selectedPlayer.playerId) : null}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        opponentTeam={displayOpponent}
                      />
                    </ProFeatureLock>
                  </div>
                ) : null}

                {/* Player vs Team / Similar Players — desktop (player mode) */}
                {nbaPropsMode === 'player' && (
                  <div
                    className={`hidden lg:block rounded-lg ${NBA_DASH_CARD_GLOW} px-1.5 xl:px-2 py-1.5 xl:py-2 w-full min-w-0 mt-0`}
                  >
                    <div className="flex gap-1 xl:gap-1.5 mb-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (aiLocked) {
                            openProUpgrade();
                            return;
                          }
                          setPlayerVsContainerTab('model');
                        }}
                        className={`relative flex-1 px-1.5 xl:px-2 py-1.5 xl:py-2 text-[11px] xl:text-xs font-medium rounded-lg transition-colors border inline-flex items-center justify-center gap-1 ${
                          playerVsContainerTab === 'model'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        } ${aiLocked ? 'cursor-pointer opacity-65' : ''}`}
                      >
                        Model
                        {aiLocked ? <ProLockMark /> : null}
                      </button>
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
                        onClick={() => {
                          if (freeTier) {
                            openProUpgrade();
                            return;
                          }
                          setPlayerVsContainerTab('similar');
                        }}
                        className={`flex-1 px-1.5 xl:px-2 py-1.5 xl:py-2 text-[11px] xl:text-xs font-medium rounded-lg transition-colors border inline-flex items-center justify-center gap-1 ${
                          playerVsContainerTab === 'similar'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        } ${freeTier ? 'cursor-pointer opacity-65' : ''}`}
                      >
                        Similar Players
                        {freeTier ? <ProLockMark /> : null}
                      </button>
                    </div>
                    {playerVsContainerTab === 'model' ? (
                      <ProFeatureLock locked={aiLocked}>
                        <NbaModelPanel
                          isDark={!!mounted && isDark}
                          layout="desktop"
                          playerId={selectedPlayer?.playerId || null}
                          playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                          opponentName={
                            nbaTeamFilter !== 'All' && nbaTeamFilter
                              ? nbaTeamFilter
                              : displayOpponent
                          }
                          selectedStat={mainChartStat}
                          selectedLine={nbaGameLineValue}
                          onSelectStat={setMainChartStatAndResetLine}
                          previewLocked={aiLocked}
                        />
                      </ProFeatureLock>
                    ) : playerVsContainerTab === 'similar' ? (
                      <NbaSimilarPlayersCard
                        isDark={!!mounted && isDark}
                        layout="desktop"
                        season={NBA_SHOT_CHART_SEASON_YEAR}
                        playerId={selectedPlayer?.playerId || null}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        opponentName={
                          nbaTeamFilter !== 'All' && nbaTeamFilter
                            ? nbaTeamFilter
                            : displayOpponent
                        }
                        selectedStat={mainChartStat}
                      />
                    ) : (
                      <NbaPlayerVsTeamPanel
                        isDark={!!mounted && isDark}
                        layout="desktop"
                        season={NBA_SHOT_CHART_SEASON_YEAR}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        playerTeam={selectedPlayer?.team || null}
                        opponentName={
                          nbaTeamFilter !== 'All' && nbaTeamFilter
                            ? nbaTeamFilter
                            : displayOpponent
                        }
                        gameLogs={selectedPlayerGameLogs as unknown as Array<Record<string, unknown>>}
                      />
                    )}
                  </div>
                )}

                {/* Line movement — desktop (player mode) */}
                {nbaPropsMode === 'player' && (
                  <div className={`hidden lg:block rounded-lg ${NBA_DASH_CARD_GLOW} p-2 xl:p-3 w-full min-w-0`}>
                    <NbaLineMovementCard
                      isDark={!!mounted && isDark}
                      playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                      playerTeam={selectedPlayer?.team || null}
                      opponentName={displayOpponent}
                      stat={mainChartStat}
                    />
                  </div>
                )}

                {/* Injuries — desktop */}
                <div
                  className={`hidden lg:block rounded-lg ${NBA_DASH_CARD_GLOW} p-2 xl:p-3 pb-12 xl:pb-14 w-full min-w-0`}
                >
                  <div className="relative h-[320px] w-full min-w-0 flex flex-col min-h-0">
                    {showEmptyShell ? (
                      <div className="h-[320px]" />
                    ) : showStatsLoadingShell ? (
                      <div className={`h-[320px] rounded-lg animate-pulse ${pulse}`} />
                    ) : (
                      <NbaInjuriesCard
                        isDark={!!mounted && isDark}
                        season={NBA_SHOT_CHART_SEASON_YEAR}
                        playerTeam={matchupLeft}
                        playerName={
                          nbaPropsMode === 'player'
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
                  className={`hidden lg:block rounded-lg ${NBA_DASH_CARD_GLOW} p-2 xl:p-3 pb-8 xl:pb-10 w-full min-w-0 mt-0`}
                >
                  <NbaLadderCard isDark={!!mounted && isDark} logoByTeam={logoByTeam} />
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
      <ProUpgradeHost />
      <FreePlayerLimitPrompt
        locked={freeTier}
        playerName={selectedPlayer?.name}
        sportLabel="NBA"
        freePicks={freePicks}
        alternateAction={{
          label: 'View game props instead',
          onClick: () => {
            setNbaPropsMode('team');
            setMainChartStatAndResetLine((prev) => defaultNbaTeamStat(prev));
            if (!selectedTeam && selectedPlayer?.team) setSelectedTeam(selectedPlayer.team);
          },
        }}
      />
    </div>
  );
}
