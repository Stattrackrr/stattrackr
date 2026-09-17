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
import TennisDvpCard from '@/app/tennis/components/TennisDvpCard';
import TennisTeamMatchupCard from '@/app/tennis/components/TennisTeamMatchupCard';
import TennisMatchInfoCard from '@/app/tennis/components/TennisMatchInfoCard';
import TennisAdvancedAveragesCard from '@/app/tennis/components/TennisAdvancedAveragesCard';
import { TennisSimilarPlayersCard } from '@/app/tennis/components/TennisSimilarPlayersCard';
import { TennisAskPanel } from '@/app/tennis/components/TennisAskPanel';
import { TennisLineSelector } from '@/app/tennis/components/TennisLineSelector';
import {
  isTennisOuStat,
  tennisBestMoneylinePick,
  tennisBestOuPick,
  tennisLineMatches,
  tennisMainLineForStat,
  tennisOuLinesForStat,
  tennisParseLineNumber,
  type TennisBookRow,
} from '@/lib/tennis/oddsTypes';
import {
  TennisSupportingStats,
  defaultSupportingStatForMain,
  type SupportingStatKind,
} from '@/app/tennis/components/TennisSupportingStats';
import { TennisBoxScore } from '@/app/tennis/components/TennisBoxScore';
import {
  DEFAULT_NBL_GAME_FILTERS,
  type NblGameFiltersState,
} from '@/app/tennis/components/TennisGameFilters';
import { TENNIS_DASH_CARD_GLOW } from '@/app/tennis/components/tennisDashCardGlow';
import { TennisBannerArt } from '@/app/tennis/components/TennisBannerArt';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useViewerProfile } from '@/hooks/useViewerProfile';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { Search } from 'lucide-react';
import { DEFAULT_ODDS_FORMAT, readOddsFormatPreference } from '@/lib/currencyUtils';
import { TENNIS_AI_UNDER_MAINTENANCE, TENNIS_CURRENT_YEAR, TENNIS_HISTORY_YEARS } from '@/lib/tennis/constants';
import {
  defaultTennisGameStat,
  tennisEventPlaceLabel,
  tennisLastName,
  tennisMatchesPlayed,
  tennisRoundLabel,
  tennisTourLabel,
} from '@/lib/tennis/chartStats';
import { tennisFlagUrl, tennisIocToIso2 } from '@/lib/tennis/flags';
import { clientTennisHeadshotUrl, tennisComAvatarImgStyle } from '@/lib/tennis/headshotDisplay';
import { propsSportFromTennisTour } from '@/lib/nbaConstants';
import { consumePropsReturnPath } from '@/lib/propsPageSessionCache';
import {
  abortTennisDashboardFetches,
  beginTennisDashboardSession,
  resetTennisDashboardFetches,
  tennisDashboardFetch,
} from '@/lib/tennisDashboardFetch';
import { isTennisQualifyingLabel } from '@/lib/tennis/dvpShared';

/** Tennis match LIVE window (~5-set length). */
const NBL_MATCH_DURATION_MS = 6 * 60 * 60 * 1000;

type NblPropsMode = 'player' | 'team';
type NblRightTab = 'dvp' | 'team_matchup' | 'match_info';
type TennisFormContainerTab = 'overview' | 'similar';

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
  ioc?: string | null;
  hand?: string | null;
};

const TENNIS_TOURS = new Set(['ATP', 'WTA', 'GRAND SLAM']);
const TENNIS_TOUR_FILTER_LOGOS: Record<string, string> = {
  ATP: '/images/atp-logo.webp',
  WTA: '/images/wta-logo.png',
};

function tennisPlayerTour(
  player: { tour?: string | null; team?: string | null } | null | undefined
): 'ATP' | 'WTA' | null {
  const tour = String(player?.tour || player?.team || '').toUpperCase();
  return tour === 'ATP' || tour === 'WTA' ? tour : null;
}

function TennisAbbrevFlag({
  code,
  ioc,
  rank,
  textClassName,
}: {
  code: string;
  ioc?: string | null;
  rank?: string | number | null;
  textClassName?: string;
}) {
  const flagUrl = tennisFlagUrl(ioc);
  const rankLabel = (() => {
    if (rank == null || rank === '') return null;
    const n = Number(rank);
    if (Number.isFinite(n) && n > 0) return String(Math.round(n));
    const raw = String(rank).replace(/^#/, '').trim();
    return raw || null;
  })();
  return (
    <span className="inline-flex flex-col items-center justify-end min-w-0 flex-shrink">
      <span className="inline-flex items-baseline gap-1 min-w-0 max-w-[11rem] xl:max-w-[15rem]">
        <span className={`truncate ${textClassName ?? ''}`}>{code}</span>
        {rankLabel ? (
          <span className="text-[10px] xl:text-xs font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0">
            #{rankLabel}
          </span>
        ) : null}
      </span>
      {flagUrl ? (
        <img
          src={flagUrl}
          alt=""
          className="mt-0.5 h-[11px] w-4 object-cover rounded-[1px] shadow-sm"
        />
      ) : (
        <span className="mt-0.5 h-[11px]" aria-hidden />
      )}
    </span>
  );
}
const NBL_PAGE_STATE_KEY = 'tennisPageState:v4';
const NBL_PLAYER_LOGS_CACHE_PREFIX = 'tennisPlayerLogsCache:v8';
const NBL_PLAYER_LOGS_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes; network always revalidates
const TENNIS_NEXT_GAME_CLIENT_TTL_MS = 1000 * 90;
const TENNIS_NEXT_GAME_POLL_MS = 60_000;
const tennisNextGameClientCache = new Map<
  string,
  { savedAt: number; payload: TennisNextGameClient }
>();
const tennisNextGameInflight = new Set<string>();

type TennisNextGameClient = {
  opponent: string | null;
  opponentId: string | null;
  opponentIoc: string | null;
  opponentRank: number | null;
  opponentLogo: string | null;
  tipoff: string | null;
  live: boolean;
  isGrandSlam: boolean;
  tournament: string | null;
  tournamentKey: string | null;
  surface: string | null;
  round: string | null;
  playerSeed: number | null;
  opponentSeed: number | null;
  topSeedName: string | null;
};

function parseTennisNextGameClient(data: Record<string, unknown> | null | undefined): TennisNextGameClient {
  const tip = data?.next_game_tipoff ? String(data.next_game_tipoff) : null;
  const rankRaw = Number(data?.next_opponent_rank);
  return {
    opponent: String(data?.next_opponent || '').trim() || null,
    opponentId: String(data?.next_opponent_id || '').trim() || null,
    opponentIoc: data?.next_opponent_ioc ? String(data.next_opponent_ioc) : null,
    opponentRank: Number.isFinite(rankRaw) && rankRaw > 0 ? Math.round(rankRaw) : null,
    opponentLogo: data?.opponent_logo ? String(data.opponent_logo) : null,
    tipoff: tip,
    live: Boolean(data?.live),
    isGrandSlam: Boolean(data?.isGrandSlam),
    tournament: String(data?.tournament || '').trim() || null,
    tournamentKey: String(data?.tournamentKey || '').trim() || null,
    surface: String(data?.surface || '').trim() || null,
    round: String(data?.round || '').trim() || null,
    playerSeed: Number.isFinite(Number(data?.playerSeed)) && Number(data?.playerSeed) > 0 ? Math.round(Number(data?.playerSeed)) : null,
    opponentSeed: Number.isFinite(Number(data?.opponentSeed)) && Number(data?.opponentSeed) > 0 ? Math.round(Number(data?.opponentSeed)) : null,
    topSeedName: String(data?.topSeedName || '').trim() || null,
  };
}

function readTennisNextGameClient(playerId: string | null | undefined): TennisNextGameClient | null {
  const id = String(playerId || '').trim();
  if (!id) return null;
  const hit = tennisNextGameClientCache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > TENNIS_NEXT_GAME_CLIENT_TTL_MS) {
    tennisNextGameClientCache.delete(id);
    return null;
  }
  return hit.payload;
}

function writeTennisNextGameClient(playerId: string, payload: TennisNextGameClient) {
  tennisNextGameClientCache.set(playerId, { savedAt: Date.now(), payload });
}

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
  playerVsContainerTab?: TennisFormContainerTab;
  chartTimeframe: NblChartTimeframe;
  mainChartStat?: string;
  nblGameFilters?: NblGameFiltersState | null;
};

type CachedNblPlayerLogs = {
  createdAt: number;
  fetchedAt?: string | null;
  years: number[];
  games: Array<Record<string, unknown>>;
};

function tennisLogFingerprint(games: Array<Record<string, unknown>>): string {
  return games
    .map((row) => String(row.matchId || row.date || ''))
    .join('|');
}

function normalizeNblPlayerNameForMatch(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tennisUrlOpponentValue(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim();
  if (!value || value === '—' || value === 'NA' || value === 'N/A') return null;
  return value;
}

function tennisUrlIocValue(raw: string | null | undefined): string | null {
  const code = String(raw || '').trim().toUpperCase();
  if (!code || !tennisIocToIso2(code)) return null;
  return code;
}

function useIsDesktopLayout(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return isDesktop;
}

function readTennisUrlOpponent(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return tennisUrlOpponentValue(new URLSearchParams(window.location.search).get('opponent'));
  } catch {
    return null;
  }
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
  return {
    ...player,
    imageUrl: clientTennisHeadshotUrl(player.playerId, player.imageUrl),
  };
}

function TennisHeaderEventLine({
  tourLabel,
  place,
  round,
  surface,
  suffix,
}: {
  tourLabel: string;
  place: string;
  round: string;
  surface?: string | null;
  suffix?: string;
}) {
  if (!tourLabel && !place && !round && !surface && !suffix) return null;
  const isFinal = round === 'Final';
  const surfaceLabel = String(surface || '').trim();
  return (
    <span className="block truncate">
      {tourLabel}
      {place ? `${tourLabel ? ' - ' : ''}${place}` : ''}
      {round ? (
        <>
          {tourLabel || place ? ' - ' : ''}
          <span className={isFinal ? 'tennis-final-gold font-semibold' : undefined}>{round}</span>
        </>
      ) : null}
      {surfaceLabel ? `${tourLabel || place || round ? ' - ' : ''}${surfaceLabel}` : ''}
      {suffix ? `${tourLabel || place || round || surfaceLabel ? ' · ' : ''}${suffix}` : ''}
    </span>
  );
}

function TennisAnonymousHeadshot({ sizeClass }: { sizeClass: string }) {
  return (
    <span
      className={`${sizeClass} relative overflow-hidden rounded-full flex-shrink-0 bg-gray-200 dark:bg-gray-700 ring-1 ring-black/10 dark:ring-white/10`}
      aria-hidden
    >
      <svg
        viewBox="0 0 40 40"
        className="absolute inset-0 h-full w-full text-gray-400 dark:text-gray-500"
      >
        <circle cx="20" cy="14.5" r="8" fill="currentColor" />
        <path
          d="M6 38c0-8.5 6.3-13.5 14-13.5S34 29.5 34 38"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

function TennisPlayerAvatar({
  name,
  imageUrl,
  playerId,
  sizeClass,
}: {
  name?: string | null;
  imageUrl?: string | null;
  playerId?: string | null;
  sizeClass: string;
}) {
  const src = clientTennisHeadshotUrl(playerId, imageUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (src && !failed) {
    return (
      <span
        className={`${sizeClass} relative overflow-hidden rounded-full flex-shrink-0 bg-gray-200 dark:bg-gray-700 ring-1 ring-black/10 dark:ring-white/10`}
      >
        <img
          src={src}
          alt={name || ''}
          className="absolute inset-0 h-full w-full object-cover"
          style={tennisComAvatarImgStyle(src)}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return <TennisAnonymousHeadshot sizeClass={sizeClass} />;
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
  const playerIdParam =
    url.searchParams.get('pid')?.trim() || url.searchParams.get('playerId')?.trim() || '';
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
          playerId: playerIdParam || null,
          name: targetName,
          team: tennisTeamParam,
          teamCode: tennisTeamParam || null,
          teamId: null,
          position: null,
          jersey: null,
          imageUrl: clientTennisHeadshotUrl(playerIdParam, null),
          tour: tennisTeamParam === 'WTA' || tennisTeamParam === 'ATP' ? (tennisTeamParam as 'ATP' | 'WTA') : undefined,
        };
    if (sameName && playerIdParam && !player.playerId) {
      player.playerId = playerIdParam;
    }
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
      nblRightTab: 'team_matchup',
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
  const persistedTab = String(persisted.nblRightTab || '');
  const rightTab: NblRightTab =
    persistedTab === 'team_matchup' || persistedTab === 'dvp' || persistedTab === 'match_info'
      ? persistedTab
      : persistedTab === 'breakdown'
        ? 'team_matchup'
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
    nblTeamFilter: 'All',
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
  const [navigatingToProps, setNavigatingToProps] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [oddsFormat, setOddsFormat] = useState(DEFAULT_ODDS_FORMAT);
  const { userEmail, username, avatarUrl, isPro, setUsername, setAvatarUrl } = useViewerProfile({
    loginRedirect: '/login',
    requireAuth: false,
  });
  const isDesktopLayout = useIsDesktopLayout();
  const showMobileDashCards = isDesktopLayout === false;
  const showDesktopDashCards = isDesktopLayout === true;

  // SSR-safe defaults only — restore from localStorage/URL after mount (avoids hydration mismatch).
  const [nblPropsMode, setNblPropsMode] = useState<NblPropsMode>('player');
  const [nblRightTab, setNblRightTab] = useState<NblRightTab>('dvp');
  const [nblRightTabsVisited, setNblRightTabsVisited] = useState<Set<NblRightTab>>(
    () => new Set(['dvp'])
  );
  const [playerVsContainerTab, setPlayerVsContainerTab] = useState<TennisFormContainerTab>(
    TENNIS_AI_UNDER_MAINTENANCE ? 'similar' : 'overview'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [rosterPlayers, setRosterPlayers] = useState<NblRosterPlayer[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [logoByTeam, setLogoByTeam] = useState<Record<string, string>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<NblRosterPlayer | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [propsOpponentFallback, setPropsOpponentFallback] = useState<string | null>(null);
  const [propsOpponentIocFallback, setPropsOpponentIocFallback] = useState<string | null>(null);
  const [propsOpponentIdFallback, setPropsOpponentIdFallback] = useState<string | null>(null);
  const [selectedPlayerGameLogs, setSelectedPlayerGameLogs] = useState<Array<Record<string, unknown>>>([]);
  const [selectedTeamGameLogs, setSelectedTeamGameLogs] = useState<Array<Record<string, unknown>>>([]);
  const [statsLoadingForPlayer, setStatsLoadingForPlayer] = useState(false);
  const [statsLoadingForTeam, setStatsLoadingForTeam] = useState(false);
  const [loadingPlayerFromUrl, setLoadingPlayerFromUrl] = useState(false);
  const [chartDelayElapsed, setChartDelayElapsed] = useState(false);
  const chartUiResetToken = `${nblPropsMode}:${String(selectedPlayer?.name ?? '')}:${String(selectedTeam ?? '')}`;
  const [mainChartStat, setMainChartStat] = useState<string>('moneyline');
  const [chartTimeframe, setChartTimeframe] = useState<NblChartTimeframe>('last10');
  const [supportingStatKind, setSupportingStatKind] = useState<SupportingStatKind>('totalAces');
  const [nblGameFilters, setNblGameFilters] = useState<NblGameFiltersState>(() => ({
    ...DEFAULT_NBL_GAME_FILTERS,
  }));
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [nextGameOpponent, setNextGameOpponent] = useState<string | null>(null);
  const [nextGameOpponentId, setNextGameOpponentId] = useState<string | null>(null);
  const [nextGamePlayerId, setNextGamePlayerId] = useState<string | null>(null);
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [nextGameOpponentLogo, setNextGameOpponentLogo] = useState<string | null>(null);
  const [nextGameOpponentIoc, setNextGameOpponentIoc] = useState<string | null>(null);
  const [nextGameOpponentRank, setNextGameOpponentRank] = useState<number | null>(null);
  const [nextGameIsGrandSlam, setNextGameIsGrandSlam] = useState(false);
  const [nextGameTournament, setNextGameTournament] = useState<string | null>(null);
  const [nextGameTournamentKey, setNextGameTournamentKey] = useState<string | null>(null);
  const [nextGameSurface, setNextGameSurface] = useState<string | null>(null);
  const [nextGameRound, setNextGameRound] = useState<string | null>(null);
  const [nextGameLive, setNextGameLive] = useState(false);
  const [nextGamePlayerSeed, setNextGamePlayerSeed] = useState<number | null>(null);
  const [nextGameOpponentSeed, setNextGameOpponentSeed] = useState<number | null>(null);
  const [nextGameTopSeedName, setNextGameTopSeedName] = useState<string | null>(null);
  const selectedPlayerIdRef = useRef<string | null>(null);
  const [countdown, setCountdown] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  const [tennisOddsBooks, setTennisOddsBooks] = useState<TennisBookRow[]>([]);
  const [selectedTennisBookIndex, setSelectedTennisBookIndex] = useState(0);
  const [tennisOddsHomeTeam, setTennisOddsHomeTeam] = useState('');
  const [tennisOddsAwayTeam, setTennisOddsAwayTeam] = useState('');
  const [tennisOddsLoading, setTennisOddsLoading] = useState(false);
  const [tennisGameLineValue, setTennisGameLineValue] = useState<number | null>(null);
  const ignoreNextTransientLineRef = useRef(false);
  const lastOddsMatchupKeyRef = useRef<string | null>(null);
  const tennisLineFromUrlRef = useRef<number | null>(null);
  const preferredTennisBookmakerRef = useRef<string | null>(null);
  const hasIncomingTennisBookOrLineRef = useRef(false);
  const tennisIncomingStatRef = useRef<string | null>(null);

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

  const applyUpcoming = useCallback((playerId: string, payload: TennisNextGameClient) => {
    writeTennisNextGameClient(playerId, payload);
    setNextGamePlayerId(playerId);
    setNextGameOpponent(payload.opponent);
    setNextGameOpponentId(payload.opponentId);
    setNextGameOpponentIoc(payload.opponentIoc);
    setNextGameOpponentRank(payload.opponentRank);
    setNextGameOpponentLogo(payload.opponentLogo);
    setNextGameIsGrandSlam(payload.isGrandSlam);
    setNextGameTournament(payload.tournament);
    setNextGameTournamentKey(payload.tournamentKey);
    setNextGameSurface(payload.surface);
    setNextGameRound(payload.round);
    setNextGameLive(payload.live);
    setNextGamePlayerSeed(payload.playerSeed);
    setNextGameOpponentSeed(payload.opponentSeed);
    setNextGameTopSeedName(payload.topSeedName);
    const tipRaw = payload.tipoff ? new Date(payload.tipoff) : null;
    setNextGameTipoff(tipRaw && !Number.isNaN(tipRaw.getTime()) ? tipRaw : null);
    setIsGameInProgress(payload.live);
  }, []);

  const prefetchNextGame = useCallback(
    async (playerId: string, tour: 'ATP' | 'WTA' | null, playerName?: string | null) => {
      const id = String(playerId || '').trim();
      if (!id || readTennisNextGameClient(id) || tennisNextGameInflight.has(id)) return;
      tennisNextGameInflight.add(id);
      try {
        const qs = new URLSearchParams({ playerId: id });
        if (tour) qs.set('tour', tour);
        const name = String(playerName || '').trim();
        if (name) qs.set('player', name);
        const res = await tennisDashboardFetch(`/api/tennis/next-game?${qs.toString()}`);
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res.ok || !data) return;
        const payload = parseTennisNextGameClient(data);
        writeTennisNextGameClient(id, payload);
        if (selectedPlayerIdRef.current === id) applyUpcoming(id, payload);
      } catch {
        /* keep waiting for the selected-player fetch */
      } finally {
        tennisNextGameInflight.delete(id);
      }
    },
    [applyUpcoming]
  );

  selectedPlayerIdRef.current = String(selectedPlayer?.playerId || '').trim() || null;

  const propsOpponentFallbackRef = useRef(propsOpponentFallback);
  propsOpponentFallbackRef.current = propsOpponentFallback;

  useEffect(() => {
    if (TENNIS_AI_UNDER_MAINTENANCE && playerVsContainerTab === 'overview') {
      setPlayerVsContainerTab('similar');
    }
  }, [playerVsContainerTab]);

  useEffect(() => {
    beginTennisDashboardSession();
    router.prefetch('/props?sport=all');
    router.prefetch('/props?sport=atp');
    router.prefetch('/props?sport=wta');
    tennisDashboardFetch('/api/tennis/next-game?warm=1').catch(() => undefined);
    return () => {
      abortTennisDashboardFetches();
    };
  }, [router]);

  useEffect(() => {
    setMounted(true);
    try {
      setOddsFormat(readOddsFormatPreference());
    } catch {
      /* ignore */
    }
    return () => {
      abortTennisDashboardFetches();
    };
  }, []);

  const prevDashboardPlayerIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = String(selectedPlayer?.playerId || '').trim() || null;
    const prev = prevDashboardPlayerIdRef.current;
    prevDashboardPlayerIdRef.current = id;
    if (prev && id && prev !== id) {
      resetTennisDashboardFetches();
    }
  }, [selectedPlayer?.playerId]);

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
    const persistedTab = readPersistedNblPageState()?.playerVsContainerTab;
    if (persistedTab === 'overview' || persistedTab === 'similar') {
      setPlayerVsContainerTab(
        TENNIS_AI_UNDER_MAINTENANCE && persistedTab === 'overview' ? 'similar' : persistedTab
      );
    }
    setChartTimeframe(restored.chartTimeframe);
    setMainChartStat(restored.mainChartStat);
    setNblGameFilters(restored.nblGameFilters);
    if (restored.searchQuery) setSearchQuery(restored.searchQuery);
    try {
      const url = new URL(window.location.href);
      const lineRaw = url.searchParams.get('line');
      const line = lineRaw != null ? Number.parseFloat(lineRaw) : NaN;
      const bookmakerParam = url.searchParams.get('bookmaker')?.trim() || '';
      tennisLineFromUrlRef.current = Number.isFinite(line) ? line : null;
      preferredTennisBookmakerRef.current = bookmakerParam || null;
      if (Number.isFinite(line) || bookmakerParam) {
        hasIncomingTennisBookOrLineRef.current = true;
        tennisIncomingStatRef.current = restored.mainChartStat;
      }
      if (Number.isFinite(line)) {
        setTennisGameLineValue(line);
      }
      const urlOpponent = tennisUrlOpponentValue(url.searchParams.get('opponent'));
      if (urlOpponent) setPropsOpponentFallback(urlOpponent);
      const urlOpponentIoc = tennisUrlIocValue(url.searchParams.get('oioc'));
      if (urlOpponentIoc) setPropsOpponentIocFallback(urlOpponentIoc);
      const urlOpponentId = String(url.searchParams.get('oid') || '').trim();
      if (urlOpponentId) setPropsOpponentIdFallback(urlOpponentId);
    } catch {
      tennisLineFromUrlRef.current = null;
    }
    setSelectionHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRosterLoading(true);
      try {
        const [playersRes] = await Promise.all([
          tennisDashboardFetch('/api/tennis/players?currentOnly=1'),
        ]);
        if (cancelled) return;
        if (playersRes.ok) {
          const data = await playersRes.json();
          const next: NblRosterPlayer[] = [];
          for (const row of Array.isArray(data.players) ? data.players : []) {
            const player = asTennisPlayer(row);
            if (player) next.push(player);
          }
          setRosterPlayers(next);
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

  // Game Props has no DVP tab — fall back to Player Matchup.
  useEffect(() => {
    if (nblPropsMode === 'team' && nblRightTab === 'dvp') {
      setNblRightTab('team_matchup');
      setNblRightTabsVisited((prev) => new Set(prev).add('team_matchup'));
    }
  }, [nblPropsMode, nblRightTab]);

  const visitRightTab = (tab: NblRightTab) => {
    setNblRightTab(tab);
    setNblRightTabsVisited((prev) => new Set(prev).add(tab));
  };

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
    const byId = selectedPlayer.playerId
      ? rosterPlayers.find((p) => p.playerId && p.playerId === selectedPlayer.playerId)
      : null;
    const byName =
      rosterPlayers.find((p) => {
        if (normalizeNblPlayerNameForMatch(p.name) !== want) return false;
        if (!teamWant) return true;
        return String(p.team || p.tour || '').toUpperCase() === teamWant;
      }) || rosterPlayers.find((p) => normalizeNblPlayerNameForMatch(p.name) === want);
    const idMatchesName =
      Boolean(byId) &&
      (!want || normalizeNblPlayerNameForMatch(byId!.name) === want);
    const match = (idMatchesName ? byId : null) || byName;
    if (match) {
      const tour = tennisPlayerTour(match);
      setSelectedPlayer(match);
      setSelectedTeam(tour || match.team || null);
      setSearchQuery(match.name);
    } else {
      const tour = tennisPlayerTour(selectedPlayer);
      if (tour && String(selectedPlayer.team || '').toUpperCase() !== tour) {
        setSelectedPlayer({ ...selectedPlayer, tour, team: tour });
        setSelectedTeam(tour);
      }
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
      selectedPlayer: tennisPlayer,
      selectedTeam: tennisTeam,
      nblPropsMode,
      nblRightTab,
      playerVsContainerTab,
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
    nblRightTab,
    playerVsContainerTab,
    chartTimeframe,
    mainChartStat,
    nblGameFilters,
    selectionHydrated,
  ]);

  const goBackToPlayerProps = useCallback(() => {
    abortTennisDashboardFetches();
    try {
      localStorage.removeItem(NBL_PAGE_STATE_KEY);
    } catch {
      /* ignore */
    }
    setNavigatingToProps(true);
    const tennisPlayer = asTennisPlayer(selectedPlayer);
    let tour = tennisPlayer?.tour || tennisPlayer?.team || null;
    if (!tour && typeof window !== 'undefined') {
      tour = new URLSearchParams(window.location.search).get('team');
    }
    const returnPath = consumePropsReturnPath(propsSportFromTennisTour(tour) ?? 'atp');
    router.prefetch(returnPath);
    router.push(returnPath);
  }, [router, selectedPlayer]);

  const tennisUrlSyncKey = [
    nblPropsMode,
    selectedPlayer?.name ?? '',
    selectedPlayer?.team ?? '',
    selectedTeam ?? '',
    nextGameOpponent ?? '',
    nextGameOpponentIoc ?? '',
    nextGameOpponentId ?? '',
    nextGamePlayerId ?? '',
    propsOpponentFallback ?? '',
    propsOpponentIocFallback ?? '',
    propsOpponentIdFallback ?? '',
    selectedPlayer?.playerId ?? '',
    mainChartStat ?? '',
    chartTimeframe ?? '',
    selectionHydrated ? '1' : '0',
  ].join('\0');

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
      const upcomingForPlayer = nextGamePlayerId === String(tennisPlayer.playerId || '').trim();
      const nextOpp = tennisUrlOpponentValue(upcomingForPlayer ? nextGameOpponent : null);
      const existingOpp = tennisUrlOpponentValue(url.searchParams.get('opponent')) || propsOpponentFallback;
      if (nextOpp) url.searchParams.set('opponent', nextOpp);
      else if (existingOpp) url.searchParams.set('opponent', existingOpp);
      else url.searchParams.delete('opponent');
      const nextOppIoc = tennisUrlIocValue(nextGameOpponentIoc) || propsOpponentIocFallback;
      if (nextOppIoc) url.searchParams.set('oioc', nextOppIoc);
      else url.searchParams.delete('oioc');
      const nextOppId = String(nextGameOpponentId || propsOpponentIdFallback || '').trim();
      if (nextOppId) url.searchParams.set('oid', nextOppId);
      else url.searchParams.delete('oid');
      if (mainChartStat) url.searchParams.set('stat', mainChartStat);
      else url.searchParams.delete('stat');
      url.searchParams.set('tf', chartTimeframe);
      if (tennisPlayer.playerId) url.searchParams.set('pid', String(tennisPlayer.playerId));
      else url.searchParams.delete('pid');
      url.searchParams.delete('player');
    } else if (nblPropsMode === 'team' && tennisPlayer?.name) {
      url.searchParams.set('mode', 'team');
      url.searchParams.set('name', String(tennisPlayer.name ?? ''));
      url.searchParams.set(
        'team',
        String(tennisPlayer.team ?? tennisPlayer.tour ?? selectedTeam ?? '').trim()
      );
      if (tennisPlayer.playerId) url.searchParams.set('pid', String(tennisPlayer.playerId));
      else url.searchParams.delete('pid');
      url.searchParams.delete('player');
      if (mainChartStat) url.searchParams.set('stat', mainChartStat);
      else url.searchParams.delete('stat');
      url.searchParams.set('tf', chartTimeframe);
      const upcomingForPlayer = nextGamePlayerId === String(tennisPlayer.playerId || '').trim();
      const nextOpp = tennisUrlOpponentValue(upcomingForPlayer ? nextGameOpponent : null);
      const existingOpp = tennisUrlOpponentValue(url.searchParams.get('opponent')) || propsOpponentFallback;
      if (nextOpp) url.searchParams.set('opponent', nextOpp);
      else if (existingOpp) url.searchParams.set('opponent', existingOpp);
      else url.searchParams.delete('opponent');
    } else if (!url.searchParams.get('name') && !url.searchParams.get('player')) {
      url.searchParams.delete('mode');
      url.searchParams.delete('name');
      url.searchParams.delete('team');
      url.searchParams.delete('opponent');
      url.searchParams.delete('oioc');
      url.searchParams.delete('oid');
      url.searchParams.delete('player');
      url.searchParams.delete('pid');
      url.searchParams.delete('stat');
      url.searchParams.delete('tf');
    }
    const next = url.toString();
    if (window.location.href !== next) {
      window.history.replaceState({}, '', next);
    }
  }, [tennisUrlSyncKey]);

  const filteredPlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const pool = rosterPlayers;
    if (!q) return pool.slice(0, 20);
    return pool
      .filter((p) => {
        const name = String(p.name || '').toLowerCase();
        const last = tennisLastName(p.name).toLowerCase();
        const team = String(p.team || p.tour || '').toLowerCase();
        const code = String(p.teamCode || p.tour || '').toLowerCase();
        return name.includes(q) || last.startsWith(q) || team.includes(q) || code.includes(q);
      })
      .slice(0, 20);
  }, [rosterPlayers, searchQuery]);

  const selectPlayer = (player: NblRosterPlayer) => {
    const tour = tennisPlayerTour(player);
    setSelectedPlayer({ ...player, tour: tour || player.tour, team: tour || player.team });
    setSelectedTeam(tour || player.team || null);
    setSearchQuery(player.name);
    setShowSearchDropdown(false);
    setSelectedPlayerGameLogs([]);
    setStatsLoadingForPlayer(true);
    setLoadingPlayerFromUrl(false);
    setChartDelayElapsed(false);
    setTennisOddsBooks([]);
    setSelectedTennisBookIndex(0);
    setTennisOddsHomeTeam('');
    setTennisOddsAwayTeam('');
    setTennisGameLineValue(null);
    lastOddsMatchupKeyRef.current = null;
    tennisLineFromUrlRef.current = null;
    preferredTennisBookmakerRef.current = null;
    hasIncomingTennisBookOrLineRef.current = false;
    tennisIncomingStatRef.current = null;
    setPropsOpponentFallback(null);
    setPropsOpponentIocFallback(null);
    setPropsOpponentIdFallback(null);
    const playerId = String(player.playerId || '').trim();
    const cached = readTennisNextGameClient(playerId);
    if (playerId && cached) applyUpcoming(playerId, cached);
  };

  useEffect(() => {
    if (!showSearchDropdown) return;
    for (const player of filteredPlayers.slice(0, 12)) {
      const id = String(player.playerId || '').trim();
      if (id) void prefetchNextGame(id, tennisPlayerTour(player), player.name);
    }
  }, [showSearchDropdown, filteredPlayers, prefetchNextGame]);

  // Load game logs whenever a player is selected (cache-first soft remount, then network).
  useEffect(() => {
    const playerId = String(selectedPlayer?.playerId || '').trim();
    const playerName = String(selectedPlayer?.name || '').trim();
    if (!playerId && !playerName) {
      if (!loadingPlayerFromUrl) {
        setSelectedPlayerGameLogs([]);
        setStatsLoadingForPlayer(false);
      }
      return;
    }
    const cacheKey = nblPlayerLogsCacheKey(playerId || `name:${playerName.toLowerCase()}`);
    let cachedLogs: CachedNblPlayerLogs | null = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CachedNblPlayerLogs;
        const yearsMatch =
          Array.isArray(parsed.years) &&
          parsed.years.join(',') === TENNIS_HISTORY_YEARS.join(',');
        if (yearsMatch && Array.isArray(parsed.games)) {
          cachedLogs = parsed;
          setSelectedPlayerGameLogs(tennisMatchesPlayed(parsed.games));
          const fresh =
            Number.isFinite(parsed?.createdAt) &&
            Date.now() - Number(parsed.createdAt) <= NBL_PLAYER_LOGS_CACHE_TTL_MS;
          setStatsLoadingForPlayer(!fresh);
        } else {
          setStatsLoadingForPlayer(true);
        }
      } else {
        setStatsLoadingForPlayer(true);
      }
    } catch {
      setStatsLoadingForPlayer(true);
    }

    let cancelled = false;
    (async () => {
      try {
        const logsQs = new URLSearchParams();
        if (playerId) logsQs.set('playerId', playerId);
        if (playerName) logsQs.set('player', playerName);
        const res = await tennisDashboardFetch(`/api/tennis/matches?${logsQs.toString()}`);
        if (!res.ok) throw new Error(`logs ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const games = tennisMatchesPlayed(
          Array.isArray(data.games) ? (data.games as Array<Record<string, unknown>>) : []
        );
        const fetchedAt = data?.fetchedAt ? String(data.fetchedAt) : null;
        const cacheChanged =
          !cachedLogs ||
          (fetchedAt && cachedLogs.fetchedAt !== fetchedAt) ||
          cachedLogs.games.length !== games.length ||
          tennisLogFingerprint(cachedLogs.games) !== tennisLogFingerprint(games);
        if (cacheChanged) setSelectedPlayerGameLogs(games);
        try {
          const payload: CachedNblPlayerLogs = {
            createdAt: Date.now(),
            fetchedAt,
            years: [...TENNIS_HISTORY_YEARS],
            games,
          };
          localStorage.setItem(cacheKey, JSON.stringify(payload));
        } catch {
          /* ignore quota */
        }
      } catch {
        if (!cancelled) {
          setSelectedPlayerGameLogs((prev) => prev);
        }
      } finally {
        if (!cancelled) setStatsLoadingForPlayer(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer?.playerId, selectedPlayer?.name, loadingPlayerFromUrl]);

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
        const res = await tennisDashboardFetch(
          `/api/tennis/matches?player=${encodeURIComponent(team)}`
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

  // Upcoming fixture from API-Tennis. Apply a client cache immediately; never flash NA.
  useEffect(() => {
    const playerId = String(selectedPlayer?.playerId || '').trim();
    const playerName = String(selectedPlayer?.name || '').trim();
    const cacheKey = playerId || playerName;
    const clearUpcoming = () => {
      setNextGamePlayerId(null);
      setNextGameOpponent(null);
      setNextGameOpponentId(null);
      setNextGameTipoff(null);
      setNextGameOpponentLogo(null);
      setNextGameOpponentIoc(null);
      setNextGameOpponentRank(null);
      setNextGameIsGrandSlam(false);
      setNextGameTournament(null);
      setNextGameTournamentKey(null);
      setNextGameSurface(null);
      setNextGameRound(null);
      setNextGameLive(false);
      setNextGamePlayerSeed(null);
      setNextGameOpponentSeed(null);
      setNextGameTopSeedName(null);
      setIsGameInProgress(false);
    };
    if (!cacheKey) {
      clearUpcoming();
      return;
    }
    const cached = readTennisNextGameClient(cacheKey);
    if (cached?.opponent) applyUpcoming(playerId || cacheKey, cached);
    else clearUpcoming();
    let cancelled = false;
    const loadUpcoming = async () => {
      try {
        const tour = tennisPlayerTour(selectedPlayer);
        const qs = new URLSearchParams();
        if (playerId) qs.set('playerId', playerId);
        if (playerName) qs.set('player', playerName);
        if (tour) qs.set('tour', tour);
        const hintedOpp =
          tennisUrlOpponentValue(propsOpponentFallbackRef.current) || readTennisUrlOpponent();
        if (hintedOpp) qs.set('opponent', hintedOpp);
        const res = await tennisDashboardFetch(`/api/tennis/next-game?${qs.toString()}`);
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (cancelled) return;
        if (!res.ok || !data) return;
        const payload = parseTennisNextGameClient(data);
        applyUpcoming(playerId || cacheKey, payload);
        const resolvedOpp = tennisUrlOpponentValue(payload.opponent);
        if (resolvedOpp) setPropsOpponentFallback(resolvedOpp);
      } catch {
        /* keep cached / previous upcoming rather than flashing NA */
      }
    };
    void loadUpcoming();
    const pollId = window.setInterval(() => {
      void loadUpcoming();
    }, TENNIS_NEXT_GAME_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [
    selectedPlayer?.playerId,
    selectedPlayer?.name,
    selectedPlayer?.tour,
    selectedPlayer?.team,
    applyUpcoming,
  ]);

  // Mark tipoff LIVE for the tennis match window, or when the fixture is already in progress.
  useEffect(() => {
    if (nextGameLive) {
      setIsGameInProgress(true);
      return;
    }
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
  }, [nextGameTipoff, nextGameLive]);

  // Reset supporting to the first context-relevant pill when main chart stat changes.
  useEffect(() => {
    setSupportingStatKind(defaultSupportingStatForMain(mainChartStat));
  }, [mainChartStat]);

  // Load API-Tennis match odds once the upcoming opponent is resolved for this player.
  useEffect(() => {
    const playerId = String(selectedPlayer?.playerId || '').trim();
    const upcomingReady = Boolean(playerId) && nextGamePlayerId === playerId;
    const opponent = upcomingReady ? String(nextGameOpponent || '').trim() : '';
    if (!playerId) {
      setTennisOddsLoading(false);
      return;
    }
    if (!upcomingReady) {
      setTennisOddsLoading(true);
      return;
    }
    if (!opponent) {
      setTennisOddsBooks([]);
      setTennisOddsHomeTeam('');
      setTennisOddsAwayTeam('');
      setTennisOddsLoading(false);
      if (!hasIncomingTennisBookOrLineRef.current) setTennisGameLineValue(null);
      return;
    }
    let cancelled = false;
    setTennisOddsLoading(true);
    const oddsQs = new URLSearchParams({ playerId });
    const playerName = String(selectedPlayer?.name || '').trim();
    if (playerName) oddsQs.set('player', playerName);
    tennisDashboardFetch(`/api/tennis/odds?${oddsQs.toString()}`)
      .then((r) => r.json())
      .then((data: { success?: boolean; data?: TennisBookRow[]; homeTeam?: string; awayTeam?: string }) => {
        if (cancelled) return;
        const books = data?.success && Array.isArray(data.data) ? data.data : [];
        setTennisOddsBooks(books);
        setTennisOddsHomeTeam(data?.homeTeam || selectedPlayer?.name || '');
        setTennisOddsAwayTeam(data?.awayTeam || opponent);
        setSelectedTennisBookIndex((i) => (i >= books.length ? 0 : i));
      })
      .catch(() => {
        if (cancelled) return;
        setTennisOddsBooks([]);
        setTennisOddsHomeTeam('');
        setTennisOddsAwayTeam('');
      })
      .finally(() => {
        if (!cancelled) setTennisOddsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer?.playerId, selectedPlayer?.name, nextGamePlayerId, nextGameOpponent]);

  useEffect(() => {
    if (!tennisOddsBooks.length) return;
    const matchupKey = `${selectedPlayer?.playerId || ''}|${nextGameOpponent || ''}`;
    if (lastOddsMatchupKeyRef.current === matchupKey) return;
    lastOddsMatchupKeyRef.current = matchupKey;
    if (hasIncomingTennisBookOrLineRef.current) return;
    const idx = tennisBestMoneylinePick(tennisOddsBooks);
    setSelectedTennisBookIndex(idx ?? 0);
  }, [tennisOddsBooks, selectedPlayer?.playerId, nextGameOpponent]);

  useEffect(() => {
    const tol = 0.01;
    const onTransientLine = (e: Event) => {
      if (ignoreNextTransientLineRef.current) {
        ignoreNextTransientLineRef.current = false;
        return;
      }
      const value = (e as CustomEvent<{ value: number }>).detail?.value;
      if (value == null || !Number.isFinite(value)) return;
      if (!tennisOddsBooks.length || !isTennisOuStat(mainChartStat)) return;
      setTennisGameLineValue((prev) =>
        prev != null && Number.isFinite(prev) && Math.abs(prev - value) < tol ? prev : value
      );
      const idx = tennisOddsBooks.findIndex((book) =>
        tennisOuLinesForStat(book, mainChartStat).some((row) => tennisLineMatches(row.line, value, tol))
      );
      if (idx >= 0 && idx !== selectedTennisBookIndex) setSelectedTennisBookIndex(idx);
    };
    window.addEventListener('transient-line', onTransientLine);
    return () => window.removeEventListener('transient-line', onTransientLine);
  }, [mainChartStat, tennisOddsBooks, selectedTennisBookIndex]);

  useEffect(() => {
    if (!tennisOddsBooks.length) return;
    if (
      hasIncomingTennisBookOrLineRef.current &&
      tennisIncomingStatRef.current &&
      tennisIncomingStatRef.current !== mainChartStat
    ) {
      hasIncomingTennisBookOrLineRef.current = false;
      tennisIncomingStatRef.current = null;
      tennisLineFromUrlRef.current = null;
    }
    const normalizeBook = (value: unknown) =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
    const preferredBook = preferredTennisBookmakerRef.current;
    if (preferredBook) {
      const preferredNorm = normalizeBook(preferredBook);
      const preferredIndex = tennisOddsBooks.findIndex((book) => {
        const bookNorm = normalizeBook(book.name);
        return bookNorm === preferredNorm || bookNorm.includes(preferredNorm) || preferredNorm.includes(bookNorm);
      });
      if (preferredIndex >= 0) {
        setSelectedTennisBookIndex((prev) => {
          if (prev !== preferredIndex) ignoreNextTransientLineRef.current = true;
          return preferredIndex;
        });
        preferredTennisBookmakerRef.current = null;
      }
    }
    if (!isTennisOuStat(mainChartStat)) return;
    const urlLine = tennisLineFromUrlRef.current;
    if (urlLine != null && Number.isFinite(urlLine)) {
      setTennisGameLineValue(urlLine);
      tennisLineFromUrlRef.current = null;
      return;
    }
    if (hasIncomingTennisBookOrLineRef.current) return;
    const best = tennisBestOuPick(tennisOddsBooks, mainChartStat);
    const n = tennisParseLineNumber(best?.line.line);
    if (best) {
      setSelectedTennisBookIndex((prev) => {
        if (prev !== best.bookIndex) ignoreNextTransientLineRef.current = true;
        return best.bookIndex;
      });
    }
    if (n != null) setTennisGameLineValue(n);
    else setTennisGameLineValue(0.5);
  }, [mainChartStat, tennisOddsBooks]);

  useEffect(() => {
    if (!tennisOddsBooks.length) return;
    if (mainChartStat !== 'moneyline') return;
    if (hasIncomingTennisBookOrLineRef.current) return;
    const idx = tennisBestMoneylinePick(tennisOddsBooks);
    if (idx != null) setSelectedTennisBookIndex(idx);
  }, [mainChartStat, tennisOddsBooks]);

  const chartGameLogsForPlayer = useMemo(() => {
    return selectedPlayerGameLogs.map((g, idx) => ({ ...g, __nblGameIndex: idx }));
  }, [selectedPlayerGameLogs]);

  const chartGameLogs = chartGameLogsForPlayer;
  const allChartGameLogs = chartGameLogsForPlayer;

  const lastLog = selectedPlayerGameLogs.length
    ? (selectedPlayerGameLogs[selectedPlayerGameLogs.length - 1] as {
        tour?: string;
        isGrandSlam?: boolean;
        opponent?: string;
        opponentIoc?: string | null;
        ioc?: string | null;
        tourneyName?: string | null;
        round?: string | null;
      })
    : null;
  const lastCompletedOpponent = lastLog?.opponent ? String(lastLog.opponent).trim() : null;
  const selectedPlayerId = String(selectedPlayer?.playerId || '').trim();
  const upcomingReady = Boolean(selectedPlayerId) && nextGamePlayerId === selectedPlayerId;
  const fromUpcoming = upcomingReady ? tennisUrlOpponentValue(nextGameOpponent) : null;
  const displayOpponent = fromUpcoming || tennisUrlOpponentValue(propsOpponentFallback);
  const showUpcomingNA = Boolean(selectedPlayer) && upcomingReady && !displayOpponent;
  const statsOpponent = displayOpponent || lastCompletedOpponent;
  const upcomingIsGrandSlam = Boolean(displayOpponent && nextGameIsGrandSlam);
  const headerTitle = selectedPlayer?.name || 'Select a Player';
  const headerTourLabel = displayOpponent
    ? tennisTourLabel({
        tour: selectedPlayer?.team || lastLog?.tour,
        isGrandSlam: upcomingIsGrandSlam,
      })
    : '';
  const headerPlace = tennisEventPlaceLabel(displayOpponent ? nextGameTournament : null);
  const headerRound = tennisRoundLabel(displayOpponent ? nextGameRound : null);
  const dvpStage = isTennisQualifyingLabel(nextGameRound, nextGameTournament)
    ? 'qualifying'
    : 'main';
  const headerSurface = displayOpponent ? String(nextGameSurface || '').trim() : '';
  const headerEvent =
    headerPlace && headerRound
      ? `${headerPlace} - ${headerRound}`
      : headerPlace || headerRound;
  const headerEventSuffix = nblPropsMode === 'team' ? 'Game props' : '';
  const headerSubtitle = selectedPlayer
    ? [
        headerEvent && headerTourLabel
          ? `${headerTourLabel} - ${headerEvent}`
          : headerEvent || headerTourLabel,
        headerSurface,
        headerEventSuffix,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Search for a player below';
  const showHeaderEventLine = Boolean(
    selectedPlayer && (headerTourLabel || headerPlace || headerRound || headerSurface || headerEventSuffix)
  );
  const matchupLeft = selectedPlayer?.name ? String(selectedPlayer.name).trim() : null;
  const matchupLeftIoc = selectedPlayer?.ioc || lastLog?.ioc || null;
  const rosterOpponent = displayOpponent
    ? rosterPlayers.find(
        (player) =>
          normalizeNblPlayerNameForMatch(player.name) ===
          normalizeNblPlayerNameForMatch(displayOpponent)
      )
    : null;
  const matchupOpponentIoc = displayOpponent
    ? propsOpponentIocFallback ||
      nextGameOpponentIoc ||
      rosterOpponent?.ioc ||
      null
    : null;
  const rosterOpponentRank = displayOpponent
    ? Number(rosterOpponent?.jersey)
    : NaN;
  const matchupOpponentRank = displayOpponent
    ? nextGameOpponentRank ??
      (Number.isFinite(rosterOpponentRank) && rosterOpponentRank > 0 ? rosterOpponentRank : null)
    : null;
  const playerRankRaw = Number(selectedPlayer?.jersey);
  const matchupPlayerRank =
    Number.isFinite(playerRankRaw) && playerRankRaw > 0 ? playerRankRaw : null;
  const matchupLeftAbbrev = matchupLeft || '';
  const displayOpponentAbbrev = displayOpponent || 'NA';

  const dvpTour = tennisPlayerTour(selectedPlayer) || 'ATP';

  const showEmptyShell = !selectedPlayer && !loadingPlayerFromUrl;
  const showChartEmpty = !selectedPlayer && !loadingPlayerFromUrl;
  const showStatsLoadingShell =
    !!selectedPlayer && (loadingPlayerFromUrl || statsLoadingForPlayer || !chartDelayElapsed);
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
                {/* 1. Tennis design — mobile only */}
                <TennisBannerArt compact className="lg:hidden flex-shrink-0" />

                {/* 2. Header */}
                <div
                  className={`relative z-[60] rounded-lg ${TENNIS_DASH_CARD_GLOW} p-2.5 sm:p-4 md:p-6 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}
                  ref={searchDropdownRef}
                >
                  <div className="flex flex-col gap-1.5 lg:gap-3">
                    {/* Desktop: player info | matchup | spacer */}
                    <div className="hidden lg:flex items-center flex-1">
                      <div className="flex-1 min-w-0">
                        {selectedPlayer ? (
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
                          {nblPropsMode === 'player' && selectedPlayer ? (
                            <TennisPlayerAvatar
                              name={selectedPlayer.name}
                              playerId={selectedPlayer.playerId}
                              imageUrl={selectedPlayer.imageUrl}
                              sizeClass="w-10 h-10"
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
                            {showHeaderEventLine ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                <TennisHeaderEventLine
                                  tourLabel={headerTourLabel}
                                  place={headerPlace}
                                  round={headerRound}
                                  surface={headerSurface}
                                  suffix={headerEventSuffix || undefined}
                                />
                              </div>
                            ) : selectedPlayer ? null : (
                              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                {headerSubtitle}
                              </div>
                            )}
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
                              <TennisAbbrevFlag
                                code={matchupLeft}
                                ioc={matchupLeftIoc}
                                textClassName="font-bold text-gray-900 dark:text-white text-xs xl:text-sm"
                              />
                            </div>
                            {displayOpponent && countdown && !isGameInProgress ? (
                              <div className="flex flex-col items-center flex-shrink-0 min-w-0 w-14 xl:w-20">
                                <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">
                                  Match in
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
                                <TennisAbbrevFlag
                                  code={displayOpponent}
                                  ioc={matchupOpponentIoc}
                                  rank={matchupOpponentRank}
                                  textClassName="font-bold text-gray-900 dark:text-white text-xs xl:text-sm"
                                />
                              ) : (
                                <span
                                  className={`text-gray-400 dark:text-gray-500 text-xs xl:text-sm font-medium flex-shrink-0 ${
                                    showUpcomingNA ? '' : 'invisible'
                                  }`}
                                >
                                  NA
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                            <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">
                              {'Select Player'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex justify-end" />
                    </div>

                    {/* Mobile header */}
                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      <div className="w-full min-w-0">
                        {selectedPlayer ? (
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
                          {nblPropsMode === 'player' && selectedPlayer ? (
                            <TennisPlayerAvatar
                              name={selectedPlayer.name}
                              playerId={selectedPlayer.playerId}
                              imageUrl={selectedPlayer.imageUrl}
                              sizeClass="w-8 h-8"
                            />
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
                            {showHeaderEventLine ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                <TennisHeaderEventLine
                                  tourLabel={headerTourLabel}
                                  place={headerPlace}
                                  round={headerRound}
                                  surface={headerSurface}
                                  suffix={headerEventSuffix || undefined}
                                />
                              </div>
                            ) : selectedPlayer ? null : (
                              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                {headerSubtitle}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-center mt-1">
                        {matchupLeft ? (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-1.5 min-w-0">
                            <TennisAbbrevFlag
                              code={matchupLeftAbbrev || matchupLeft}
                              ioc={matchupLeftIoc}
                              textClassName="text-xs font-semibold text-gray-900 dark:text-white"
                            />
                            {displayOpponent && countdown && !isGameInProgress ? (
                              <div className="flex flex-col items-center flex-shrink-0">
                                <div className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  Match in
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
                              <TennisAbbrevFlag
                                code={displayOpponentAbbrev}
                                ioc={matchupOpponentIoc}
                                rank={matchupOpponentRank}
                                textClassName="text-xs font-semibold text-gray-900 dark:text-white"
                              />
                            ) : (
                              <span className={`text-gray-400 text-xs ${showUpcomingNA ? '' : 'invisible'}`}>
                                NA
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-1.5">
                            <span className="text-gray-400 dark:text-gray-500 text-xs font-medium">
                              {'Select Player'}
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
                                filteredPlayers.map((player) => {
                                  const tour = tennisPlayerTour(player);
                                  const tourLogo = tour ? TENNIS_TOUR_FILTER_LOGOS[tour] : '';
                                  return (
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
                                    <TennisPlayerAvatar
                                      name={player.name}
                                      playerId={player.playerId}
                                      imageUrl={player.imageUrl}
                                      sizeClass="w-8 h-8"
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="font-medium block truncate">{player.name}</span>
                                      <span
                                        className={`text-xs block truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
                                      >
                                        {tour || player.tour || player.team}
                                        {player.jersey ? ` · #${player.jersey}` : ''}
                                      </span>
                                    </span>
                                    {tourLogo ? (
                                      <img
                                        src={tourLogo}
                                        alt=""
                                        className="w-5 h-5 object-contain flex-shrink-0 opacity-80"
                                      />
                                    ) : null}
                                  </button>
                                  );
                                })
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
                              filteredPlayers.map((player) => {
                                const tour = tennisPlayerTour(player);
                                const tourLogo = tour ? TENNIS_TOUR_FILTER_LOGOS[tour] : '';
                                return (
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
                                  <TennisPlayerAvatar
                                    name={player.name}
                                    playerId={player.playerId}
                                    imageUrl={player.imageUrl}
                                    sizeClass="w-8 h-8"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="font-medium block truncate">{player.name}</span>
                                    <span
                                      className={`text-xs block truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
                                    >
                                      {tour || player.team}
                                      {player.jersey ? ` · #${player.jersey}` : ''}
                                    </span>
                                  </span>
                                  {tourLogo ? (
                                    <img
                                      src={tourLogo}
                                      alt=""
                                      className="w-5 h-5 object-contain flex-shrink-0 opacity-80"
                                    />
                                  ) : null}
                                </button>
                                );
                              })
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
                    nextOpponent={statsOpponent}
                    gamePropsTeam={nblPropsMode === 'team' ? selectedTeam : null}
                    uiResetToken={chartUiResetToken}
                    tour={dvpTour}
                    season={TENNIS_CURRENT_YEAR}
                    teammateFilterName={null}
                    withWithoutMode="with"
                    clearTeammateFilter={() => undefined}
                    rosterPlayers={rosterPlayers}
                    slotLeftOfLine={
                      tennisOddsLoading ? (
                        <div className={`h-8 w-[100px] sm:w-[110px] md:w-[120px] rounded-lg animate-pulse flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                      ) : (
                        <TennisLineSelector
                          books={tennisOddsBooks}
                          selectedStat={mainChartStat}
                          selectedBookIndex={selectedTennisBookIndex}
                          onSelectBookIndex={setSelectedTennisBookIndex}
                          oddsFormat={oddsFormat}
                          isDark={!!mounted && isDark}
                          homeTeam={tennisOddsHomeTeam || selectedPlayer?.name || ''}
                          awayTeam={tennisOddsAwayTeam || displayOpponent || ''}
                          disabled={!selectedPlayer}
                          currentLineValue={isTennisOuStat(mainChartStat) ? tennisGameLineValue ?? undefined : undefined}
                          onSelectLineValue={
                            isTennisOuStat(mainChartStat)
                              ? (lineValue: number) => {
                                  ignoreNextTransientLineRef.current = true;
                                  setTennisGameLineValue(lineValue);
                                }
                              : undefined
                          }
                        />
                      )
                    }
                    externalLineValue={(() => {
                      if (isTennisOuStat(mainChartStat)) {
                        if (tennisGameLineValue != null && Number.isFinite(tennisGameLineValue)) {
                          return tennisGameLineValue;
                        }
                        const book = tennisOddsBooks[selectedTennisBookIndex];
                        const n = tennisParseLineNumber(tennisMainLineForStat(book, mainChartStat)?.line);
                        if (n != null) return n;
                      }
                      return 0.5;
                    })()}
                  />
                  )}
                </div>

                {/* 4. Supporting stats */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`w-full min-w-0 flex flex-col flex-shrink-0 rounded-lg ${TENNIS_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}
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
                          nextOpponent={statsOpponent}
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
                        <TennisBoxScore
                          gameLogs={selectedPlayerGameLogs}
                          selectedPlayer={selectedPlayer}
                          isLoading={statsLoadingForPlayer || showStatsLoadingShell}
                          isDark={!!mounted && isDark}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* 4b. Empty shell — Game Props */}
                {nblPropsMode === 'team' && (
                  <div
                    className={`w-full min-w-0 flex flex-col rounded-lg ${TENNIS_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}
                  >
                    <div className="min-h-[180px]" />
                  </div>
                )}

                {/* 4.5 DVP | Breakdown | Matchup — mobile */}
                <div
                  className={`lg:hidden w-full min-w-0 flex flex-col flex-shrink-0 overflow-hidden rounded-lg ${TENNIS_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4 h-[60vh] max-h-[60vh]`}
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
                      <div className={`grid gap-1.5 sm:gap-2 mb-2 flex-shrink-0 ${nblPropsMode === 'player' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        {nblPropsMode === 'player' && (
                          <button
                            type="button"
                            onClick={() => visitRightTab('dvp')}
                            className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
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
                          onClick={() => visitRightTab('team_matchup')}
                          className={`flex-1 px-2 sm:px-2 md:px-3 py-2.5 sm:py-2 text-[11px] sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Player Matchup
                        </button>
                        <button
                          type="button"
                          onClick={() => visitRightTab('match_info')}
                          className={`flex-1 px-2 sm:px-2 md:px-3 py-2.5 sm:py-2 text-[11px] sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'match_info'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Match Info
                        </button>
                      </div>
                      <div className="relative w-full min-w-0 flex flex-col flex-1 min-h-0 overflow-hidden">
                        {showMobileDashCards && nblPropsMode === 'player' && nblRightTabsVisited.has('dvp') && (
                          <div className={nblRightTab === 'dvp' ? 'w-full h-full flex flex-col min-h-0' : 'hidden'}>
                            <TennisDvpCard
                              isDark={!!mounted && isDark}
                              playerName={matchupLeft}
                              playerId={selectedPlayer?.playerId || null}
                              opponentName={statsOpponent}
                              opponentId={displayOpponent ? nextGameOpponentId : null}
                              tournamentName={nextGameTournament}
                              tournamentKey={nextGameTournamentKey}
                              stage={dvpStage}
                              tour={dvpTour}
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
                              teamName={matchupLeft}
                              opponentName={statsOpponent}
                              playerId={selectedPlayer?.playerId || null}
                              opponentId={displayOpponent ? nextGameOpponentId : null}
                              tournamentName={nextGameTournament}
                              tournamentKey={nextGameTournamentKey}
                              stage={dvpStage}
                              tour={dvpTour}
                            />
                          </div>
                        )}
                        {nblRightTabsVisited.has('match_info') && (
                          <div
                            className={
                              nblRightTab === 'match_info' ? 'flex flex-col h-full min-h-0' : 'hidden'
                            }
                          >
                            <TennisMatchInfoCard
                              isDark={!!mounted && isDark}
                              playerName={matchupLeft}
                              playerIoc={matchupLeftIoc}
                              playerRank={matchupPlayerRank}
                              playerSeed={displayOpponent ? nextGamePlayerSeed : null}
                              opponentName={displayOpponent}
                              opponentId={displayOpponent ? nextGameOpponentId : null}
                              opponentIoc={matchupOpponentIoc}
                              opponentRank={matchupOpponentRank}
                              opponentSeed={displayOpponent ? nextGameOpponentSeed : null}
                              tournamentName={nextGameTournament}
                              round={nextGameRound}
                              surface={nextGameSurface}
                              tour={dvpTour}
                              isGrandSlam={upcomingIsGrandSlam}
                              stage={dvpStage}
                              tipoff={nextGameTipoff}
                              live={nextGameLive}
                              isGameInProgress={isGameInProgress}
                              countdown={countdown}
                              topSeedName={displayOpponent ? nextGameTopSeedName : null}
                              gameLogs={selectedPlayerGameLogs}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* AI Overview / Similar Players — mobile */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`lg:hidden w-full min-w-0 flex-shrink-0 rounded-lg ${TENNIS_DASH_CARD_GLOW} p-3 sm:p-4`}
                  >
                    <div className="flex gap-1.5 mb-2">
                      <button
                        type="button"
                        disabled={TENNIS_AI_UNDER_MAINTENANCE}
                        title={
                          TENNIS_AI_UNDER_MAINTENANCE ? 'AI Overview is under maintenance' : undefined
                        }
                        onClick={() => {
                          if (!TENNIS_AI_UNDER_MAINTENANCE) setPlayerVsContainerTab('overview');
                        }}
                        className={`relative flex-1 px-1 py-2 text-[11px] font-medium rounded-lg transition-colors border ${
                          !TENNIS_AI_UNDER_MAINTENANCE && playerVsContainerTab === 'overview'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                        } ${
                          TENNIS_AI_UNDER_MAINTENANCE
                            ? 'cursor-not-allowed opacity-65'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        AI Overview
                        {TENNIS_AI_UNDER_MAINTENANCE ? (
                          <span className="absolute -top-2 -right-2 inline-flex max-w-[calc(100%-0.5rem)] items-center rounded-md border border-amber-600 bg-amber-600 px-1 py-0.5 text-[8px] font-bold leading-none tracking-wide text-white shadow-sm dark:border-amber-500/80 dark:bg-amber-700">
                            MAINTENANCE
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerVsContainerTab('similar')}
                        className={`flex-1 px-1 py-2 text-[11px] font-medium rounded-lg transition-colors border ${
                          playerVsContainerTab === 'similar'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Similar Players
                      </button>
                    </div>
                    <div className={playerVsContainerTab === 'overview' ? '' : 'hidden'}>
                      <TennisAskPanel
                        isDark={!!mounted && isDark}
                        layout="mobile"
                        playerName={matchupLeft}
                        opponentName={displayOpponent}
                        tour={dvpTour}
                        isGrandSlam={nextGameIsGrandSlam}
                        tournamentName={nextGameTournament}
                      />
                    </div>
                    {showMobileDashCards && playerVsContainerTab === 'similar' ? (
                      <TennisSimilarPlayersCard
                        isDark={!!mounted && isDark}
                        layout="mobile"
                        playerId={selectedPlayer?.playerId || null}
                        playerName={matchupLeft}
                        opponentName={statsOpponent}
                        opponentId={displayOpponent ? nextGameOpponentId || propsOpponentIdFallback : null}
                        selectedStat={mainChartStat}
                        tour={dvpTour}
                        players={rosterPlayers}
                      />
                    ) : null}
                  </div>
                )}

                {/* 5. Advanced Averages — mobile */}
                {nblPropsMode === 'player' ? (
                  <div className="lg:hidden w-full min-w-0 flex-shrink-0">
                    <div className={`rounded-lg ${TENNIS_DASH_CARD_GLOW} min-h-[380px] p-2`}>
                      {showEmptyShell ? (
                        <div className="min-h-[360px]" />
                      ) : showStatsLoadingShell || !showMobileDashCards ? (
                        <div className="min-h-[360px]" />
                      ) : (
                        <TennisAdvancedAveragesCard
                          isDark={!!mounted && isDark}
                          playerId={selectedPlayer?.playerId || null}
                          playerName={matchupLeft}
                          opponentId={displayOpponent ? nextGameOpponentId : null}
                          opponentName={statsOpponent}
                          tour={dvpTour}
                        />
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Game Log — mobile */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`lg:hidden w-full min-w-0 flex-shrink-0 rounded-lg ${TENNIS_DASH_CARD_GLOW} overflow-hidden mb-6`}
                  >
                    <TennisBoxScore
                      gameLogs={selectedPlayerGameLogs}
                      selectedPlayer={selectedPlayer}
                      isLoading={statsLoadingForPlayer || showStatsLoadingShell}
                      isDark={!!mounted && isDark}
                    />
                  </div>
                )}
              </div>

              {/* Right panel — desktop */}
              <div
                className={`hidden lg:flex relative z-0 flex-1 flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 pb-8 lg:pb-12 fade-scrollbar custom-scrollbar min-w-0 ${
                  sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
                }`}
              >
                {/* Filter By — desktop */}
                <TennisBannerArt className="hidden lg:block" />

                {/* DVP | Player Matchup — desktop */}
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
                      <div className={`grid gap-1.5 xl:gap-2 mb-2 ${nblPropsMode === 'player' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        {nblPropsMode === 'player' && (
                          <button
                            type="button"
                            onClick={() => visitRightTab('dvp')}
                            className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
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
                          onClick={() => visitRightTab('team_matchup')}
                          className={`flex-1 px-1.5 xl:px-3 py-1.5 xl:py-2 text-[11px] xl:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Player Matchup
                        </button>
                        <button
                          type="button"
                          onClick={() => visitRightTab('match_info')}
                          className={`flex-1 px-1.5 xl:px-3 py-1.5 xl:py-2 text-[11px] xl:text-sm font-medium rounded-lg transition-colors border ${
                            nblRightTab === 'match_info'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Match Info
                        </button>
                      </div>
                      <div
                        className={`relative w-full min-w-0 flex flex-col min-h-0 ${
                          nblPropsMode === 'player' &&
                          (nblRightTab === 'dvp' || nblRightTab === 'team_matchup')
                            ? 'overflow-visible h-[380px] xl:h-[420px]'
                            : 'overflow-hidden h-[380px] xl:h-[420px]'
                        }`}
                      >
                        {showDesktopDashCards && nblPropsMode === 'player' && nblRightTabsVisited.has('dvp') && (
                          <div
                            className={
                              nblRightTab === 'dvp' ? 'w-full h-full flex flex-col min-h-0' : 'hidden'
                            }
                          >
                            <TennisDvpCard
                              isDark={!!mounted && isDark}
                              playerName={matchupLeft}
                              playerId={selectedPlayer?.playerId || null}
                              opponentName={statsOpponent}
                              opponentId={displayOpponent ? nextGameOpponentId : null}
                              tournamentName={nextGameTournament}
                              tournamentKey={nextGameTournamentKey}
                              stage={dvpStage}
                              tour={dvpTour}
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
                              teamName={matchupLeft}
                              opponentName={statsOpponent}
                              playerId={selectedPlayer?.playerId || null}
                              opponentId={displayOpponent ? nextGameOpponentId : null}
                              tournamentName={nextGameTournament}
                              tournamentKey={nextGameTournamentKey}
                              stage={dvpStage}
                              tour={dvpTour}
                            />
                          </div>
                        )}
                        {((nblPropsMode === 'team' && nblRightTab === 'match_info') ||
                          (nblPropsMode === 'player' && nblRightTabsVisited.has('match_info'))) && (
                          <div
                            className={
                              nblRightTab === 'match_info' ? 'flex flex-col h-full min-h-0' : 'hidden'
                            }
                          >
                            <TennisMatchInfoCard
                              isDark={!!mounted && isDark}
                              playerName={matchupLeft}
                              playerIoc={matchupLeftIoc}
                              playerRank={matchupPlayerRank}
                              playerSeed={displayOpponent ? nextGamePlayerSeed : null}
                              opponentName={displayOpponent}
                              opponentId={displayOpponent ? nextGameOpponentId : null}
                              opponentIoc={matchupOpponentIoc}
                              opponentRank={matchupOpponentRank}
                              opponentSeed={displayOpponent ? nextGameOpponentSeed : null}
                              tournamentName={nextGameTournament}
                              round={nextGameRound}
                              surface={nextGameSurface}
                              tour={dvpTour}
                              isGrandSlam={upcomingIsGrandSlam}
                              stage={dvpStage}
                              tipoff={nextGameTipoff}
                              live={nextGameLive}
                              isGameInProgress={isGameInProgress}
                              countdown={countdown}
                              topSeedName={displayOpponent ? nextGameTopSeedName : null}
                              gameLogs={selectedPlayerGameLogs}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Advanced Averages — desktop */}
                {nblPropsMode === 'player' ? (
                  <div className="hidden lg:block w-full min-w-0">
                    <div className={`rounded-lg ${TENNIS_DASH_CARD_GLOW} min-h-[380px] p-1.5 xl:p-2`}>
                      {showEmptyShell ? (
                        <div className="h-[360px]" />
                      ) : showStatsLoadingShell || !showDesktopDashCards ? (
                        <div className="h-[360px]" />
                      ) : (
                        <TennisAdvancedAveragesCard
                          isDark={!!mounted && isDark}
                          playerId={selectedPlayer?.playerId || null}
                          playerName={matchupLeft}
                          opponentId={displayOpponent ? nextGameOpponentId : null}
                          opponentName={statsOpponent}
                          tour={dvpTour}
                        />
                      )}
                    </div>
                  </div>
                ) : null}

                {/* AI Overview / Similar Players — desktop */}
                {nblPropsMode === 'player' && (
                  <div
                    className={`hidden lg:block rounded-lg ${TENNIS_DASH_CARD_GLOW} px-1.5 xl:px-2 py-1.5 xl:py-2 w-full min-w-0 mt-0`}
                  >
                    <div className="flex gap-1 xl:gap-1.5 mb-2">
                      <button
                        type="button"
                        disabled={TENNIS_AI_UNDER_MAINTENANCE}
                        title={
                          TENNIS_AI_UNDER_MAINTENANCE ? 'AI Overview is under maintenance' : undefined
                        }
                        onClick={() => {
                          if (!TENNIS_AI_UNDER_MAINTENANCE) setPlayerVsContainerTab('overview');
                        }}
                        className={`relative flex-1 px-1.5 xl:px-2 py-1.5 xl:py-2 text-[11px] xl:text-xs font-medium rounded-lg transition-colors border ${
                          !TENNIS_AI_UNDER_MAINTENANCE && playerVsContainerTab === 'overview'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                        } ${
                          TENNIS_AI_UNDER_MAINTENANCE
                            ? 'cursor-not-allowed opacity-65'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        AI Overview
                        {TENNIS_AI_UNDER_MAINTENANCE ? (
                          <span className="absolute -top-2 -right-2 inline-flex max-w-[calc(100%-0.5rem)] items-center rounded-md border border-amber-600 bg-amber-600 px-1 py-0.5 text-[8px] font-bold leading-none tracking-wide text-white shadow-sm dark:border-amber-500/80 dark:bg-amber-700">
                            MAINTENANCE
                          </span>
                        ) : null}
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
                    <div className={playerVsContainerTab === 'overview' ? '' : 'hidden'}>
                      <TennisAskPanel
                        isDark={!!mounted && isDark}
                        layout="desktop"
                        playerName={matchupLeft}
                        opponentName={displayOpponent}
                        tour={dvpTour}
                        isGrandSlam={nextGameIsGrandSlam}
                        tournamentName={nextGameTournament}
                      />
                    </div>
                    {showDesktopDashCards && playerVsContainerTab === 'similar' ? (
                      <div className="min-h-0 overflow-hidden">
                        <TennisSimilarPlayersCard
                          isDark={!!mounted && isDark}
                          layout="desktop"
                          playerId={selectedPlayer?.playerId || null}
                          playerName={matchupLeft}
                          opponentName={statsOpponent}
                          opponentId={displayOpponent ? nextGameOpponentId || propsOpponentIdFallback : null}
                          selectedStat={mainChartStat}
                          tour={dvpTour}
                          players={rosterPlayers}
                        />
                      </div>
                    ) : null}
                  </div>
                )}
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
