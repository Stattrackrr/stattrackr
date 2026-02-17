'use client';

import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { AflStatsChart, type AflChartTimeframe } from '@/app/afl/components/AflStatsChart';
import { AflInjuriesCard } from '@/app/afl/components/AflInjuriesCard';
import AflOpponentBreakdownCard from '@/app/afl/components/AflOpponentBreakdownCard';
import AflLineupCard from '@/app/afl/components/AflLineupCard';
import { AflSupportingStats, type SupportingStatKind } from '@/app/afl/components/AflSupportingStats';
import { rosterTeamToInjuryTeam, opponentToOfficialTeamName } from '@/lib/aflTeamMapping';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { Search, Loader2 } from 'lucide-react';

type AflPlayerRecord = Record<string, string | number>;
type AflGameLogRecord = Record<string, unknown>;

function normalizeTeamNameForLogo(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const AFL_LOGO_ALIASES: Record<string, string[]> = {
  adelaide: ['adelaide', 'adelaidecrows', 'crows'],
  brisbane: ['brisbane', 'brisbanelions', 'lions'],
  carlton: ['carlton', 'carltonblues', 'blues'],
  collingwood: ['collingwood', 'collingwoodmagpies', 'magpies'],
  essendon: ['essendon', 'essendonbombers', 'bombers'],
  fremantle: ['fremantle', 'fremantledockers', 'dockers'],
  geelong: ['geelong', 'geelongcats', 'cats'],
  goldcoast: ['goldcoast', 'goldcoastsuns', 'suns'],
  gws: ['gws', 'gwsgiants', 'greaterwesternsydney', 'greaterwesternsydneygiants', 'giants'],
  hawthorn: ['hawthorn', 'hawthornhawks', 'hawks'],
  melbourne: ['melbourne', 'melbournedemons', 'demons'],
  northmelbourne: ['northmelbourne', 'northmelbournekangaroos', 'kangaroos', 'north'],
  portadelaide: ['portadelaide', 'portadelaidepower', 'power'],
  richmond: ['richmond', 'richmondtigers', 'tigers'],
  stkilda: ['stkilda', 'stkildasaints', 'saints'],
  sydney: ['sydney', 'sydneyswans', 'swans'],
  westcoast: ['westcoast', 'westcoasteagles', 'eagles'],
  westernbulldogs: ['westernbulldogs', 'bulldogs', 'footscray'],
};

function resolveTeamLogo(teamName: string, logoByTeam: Record<string, string>): string | null {
  const normalized = normalizeTeamNameForLogo(teamName);
  if (!normalized) return null;
  if (logoByTeam[normalized]) return logoByTeam[normalized];
  for (const aliases of Object.values(AFL_LOGO_ALIASES)) {
    if (!aliases.includes(normalized)) continue;
    for (const alias of aliases) {
      if (logoByTeam[alias]) return logoByTeam[alias];
    }
  }
  return null;
}

/** Convert "185 cm" to "6'1"" (feet and inches). */
function heightCmToFeet(cmStr: string): string | null {
  const match = String(cmStr).match(/(\d+)\s*cm/i);
  if (!match || !match[1]) return null;
  const cm = parseInt(match[1], 10);
  if (!Number.isFinite(cm) || cm <= 0) return null;
  const totalInches = cm * 0.393700787;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  if (inches === 12) return `${feet + 1}'0`;
  return `${feet}'${inches}`;
}

export default function AFLPage() {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
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
  const [aflRightTab, setAflRightTab] = useState<'breakdown' | 'injuries' | 'lineup'>('breakdown');
  const [aflPropsMode, setAflPropsMode] = useState<'player' | 'team'>('player');
  const [aflChartTimeframe, setAflChartTimeframe] = useState<AflChartTimeframe>('last10');
  const [mainChartStat, setMainChartStat] = useState<string>('');
  const [supportingStatKind, setSupportingStatKind] = useState<SupportingStatKind>('tog');
  const [teammateFilterName, setTeammateFilterName] = useState<string | null>(null);
  useEffect(() => {
    setSupportingStatKind('tog');
  }, [mainChartStat]);
  const [withWithoutMode, setWithWithoutMode] = useState<'with' | 'without'>('with');
  const [nextGameOpponent, setNextGameOpponent] = useState<string | null>(null);
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  useCountdownTimer({ nextGameTipoff, isGameInProgress, setCountdown });
  const [season] = useState(() => {
    // Use 2026 for AFL fixture (FootyWire ft_match_list?year=2026) and season context
    return 2026;
  });
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [logoByTeam, setLogoByTeam] = useState<Record<string, string>>({});

  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } = useDashboardStyles({ sidebarOpen });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('oddsFormat');
      if (stored === 'american' || stored === 'decimal') {
        setOddsFormat(stored);
      }
    } catch {
      // Ignore localStorage read errors.
    }
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    const loadTeamLogos = async () => {
      try {
        const res = await fetch(`/api/afl/teams?league=1&season=${season}`);
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json?.response) ? json.response : Array.isArray(json) ? json : [];
        const nextMap: Record<string, string> = {};
        for (const row of rows) {
          const team = row?.team ?? row;
          const name = String(team?.name ?? '').trim();
          const logo = String(team?.logo ?? team?.image ?? '').trim();
          if (!name || !logo) continue;
          nextMap[normalizeTeamNameForLogo(name)] = logo;
        }
        if (!cancelled && Object.keys(nextMap).length > 0) setLogoByTeam(nextMap);
      } catch {
        // ignore
      }
    };
    loadTeamLogos();
    return () => { cancelled = true; };
  }, [season]);

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
      setSearchResults(list.map((p: Record<string, unknown>) => ({
        name: String(p.name ?? '-'),
        team: typeof p.team === 'string' ? p.team : undefined,
      })));
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

    const teamForApi = selectedPlayer?.team
      ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || String(selectedPlayer.team))
      : '';
    const teamQuery = teamForApi ? `&team=${encodeURIComponent(teamForApi)}` : '';

    let cancelled = false;
    setStatsLoadingForPlayer(true);
    (async () => {
      try {
        let res = await fetch(
          `/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(String(playerName))}${teamQuery}`
        );
        let data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLastStatsError(String(data?.error ?? 'Failed to load game logs'));
          return;
        }

        let games = Array.isArray(data?.games) ? data.games as Record<string, unknown>[] : [];
        // When using 2026, often no games yet; use 2025 for chart/supporting stats.
        if (games.length === 0 && season === 2026) {
          res = await fetch(
            `/api/afl/player-game-logs?season=2025&player_name=${encodeURIComponent(String(playerName))}${teamQuery}`
          );
          data = await res.json();
          if (cancelled) return;
          if (res.ok && Array.isArray(data?.games)) {
            games = data.games as Record<string, unknown>[];
          }
        }
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
        if (typeof latest.guernsey === 'number' && Number.isFinite(latest.guernsey)) toMerge.guernsey = latest.guernsey;
        if (typeof data?.height === 'string' && data.height.trim()) toMerge.height = data.height.trim();

        playerStatsCacheRef.current.set(cacheKey, toMerge);
        setSelectedPlayer((prev) => (prev ? { ...prev, ...toMerge } : prev));
      } finally {
        if (!cancelled) setStatsLoadingForPlayer(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlayer?.name, selectedPlayer?.team, season]);

  // Last round from game logs (so we can pass to next-game even before merge).
  const lastRoundFromLogs =
    selectedPlayerGameLogs.length > 0
      ? String((selectedPlayerGameLogs[selectedPlayerGameLogs.length - 1] as Record<string, unknown>)?.round ?? '')
      : '';

  // Fetch next game (fixture scrape) when we have a team so we can show Team vs Next Opponent and countdown.
  useEffect(() => {
    const team = selectedPlayer?.team;
    if (!team || typeof team !== 'string' || !team.trim()) {
      setNextGameOpponent(null);
      setNextGameTipoff(null);
      setIsGameInProgress(false);
      return;
    }
    let cancelled = false;
    const lastRound =
      (typeof selectedPlayer?.last_round === 'string' && selectedPlayer.last_round.trim()
        ? selectedPlayer.last_round.trim()
        : lastRoundFromLogs) || '';
    const params = new URLSearchParams({ team: team.trim(), season: String(season) });
    if (lastRound) params.set('last_round', lastRound);
    fetch(`/api/afl/next-game?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setNextGameOpponent(typeof data?.next_opponent === 'string' && data.next_opponent ? data.next_opponent : null);
        const tipoff = data?.next_game_tipoff && typeof data.next_game_tipoff === 'string' ? new Date(data.next_game_tipoff) : null;
        setNextGameTipoff(tipoff && Number.isFinite(tipoff.getTime()) ? tipoff : null);
      })
      .catch(() => {
        if (!cancelled) {
          setNextGameOpponent(null);
          setNextGameTipoff(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedPlayer?.team, selectedPlayer?.last_round, lastRoundFromLogs, season]);

  // Mark game as in progress when tipoff has passed and within ~3.5h (AFL match duration)
  const AFL_MATCH_DURATION_MS = 3.5 * 60 * 60 * 1000;
  useEffect(() => {
    if (!nextGameTipoff) {
      setIsGameInProgress(false);
      return;
    }
    const check = () => {
      const now = Date.now();
      const tip = nextGameTipoff.getTime();
      setIsGameInProgress(now >= tip && now < tip + AFL_MATCH_DURATION_MS);
    };
    check();
    const interval = setInterval(check, 60 * 1000);
    return () => clearInterval(interval);
  }, [nextGameTipoff]);

  const bg = mounted && isDark ? 'bg-[#050d1a]' : '';
  const emptyText = mounted && isDark ? 'text-gray-500' : 'text-gray-400';

  // Single source of truth for opponent: same value for Team vs Team header and Opponent Breakdown.
  const displayOpponent = selectedPlayer?.team
    ? (nextGameOpponent && nextGameOpponent !== '—'
        ? nextGameOpponent
        : typeof selectedPlayer?.last_opponent === 'string' && selectedPlayer.last_opponent
          ? selectedPlayer.last_opponent
          : selectedPlayerGameLogs.length > 0
            ? String((selectedPlayerGameLogs[selectedPlayerGameLogs.length - 1] as Record<string, unknown>)?.opponent ?? '')
            : null)
    : null;

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
                {/* 2. Header - same layout as NBA DashboardHeader: left (player/select), middle (matchup), bottom (Journal) */}
                <div className="relative z-[60] bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 w-full min-w-0 flex-shrink-0 mr-1 sm:mr-2 md:mr-3 overflow-visible" ref={searchDropdownRef}>
                  <div className="flex flex-col gap-2 lg:gap-3">
                    {/* Desktop: one row - player info (left) | team vs opponent (center) | spacer (right) */}
                    <div className="hidden lg:flex items-center flex-1">
                      <div className="flex-1 min-w-0">
                        {selectedPlayer ? (
                          <div>
                            <div className="flex items-baseline gap-3 mb-1">
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white">{String(selectedPlayer.name ?? '—')}</h1>
                              {(() => {
                                const num = selectedPlayer.guernsey != null && selectedPlayer.guernsey !== ''
                                  ? selectedPlayer.guernsey
                                  : selectedPlayerGameLogs.length > 0
                                    ? (selectedPlayerGameLogs[selectedPlayerGameLogs.length - 1] as Record<string, unknown>)?.guernsey
                                    : null;
                                return num != null && num !== '' ? (
                                  <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">#{String(num)}</span>
                                ) : null;
                              })()}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              {selectedPlayer.team
                                ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || String(selectedPlayer.team))
                                : '—'}
                            </div>
                            {selectedPlayer.height ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                Height: {heightCmToFeet(String(selectedPlayer.height)) ?? String(selectedPlayer.height)}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-baseline gap-3 mb-1">
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Select a Player</h1>
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              Search for a player below
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Middle: Team vs Opponent (from last game) - centered with logos like NBA */}
                      <div className="hidden lg:flex flex-shrink-0 items-end mx-4">
                        {selectedPlayer && selectedPlayer.team ? (() => {
                          const teamFull = rosterTeamToInjuryTeam(String(selectedPlayer!.team)) || String(selectedPlayer!.team);
                          const opponentFull = displayOpponent ? (opponentToOfficialTeamName(displayOpponent) || displayOpponent) : '—';
                          const teamLogo = resolveTeamLogo(teamFull, logoByTeam);
                          const opponentLogo = opponentFull !== '—' ? resolveTeamLogo(opponentFull, logoByTeam) : null;
                          return (
                            <div className="flex items-center gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                {teamLogo ? (
                                  <img
                                    src={teamLogo}
                                    alt={teamFull}
                                    className="w-8 h-8 object-contain flex-shrink-0"
                                    style={{
                                      filter: isDark
                                        ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.65))'
                                        : 'drop-shadow(0 0 1px rgba(15,23,42,0.45)) drop-shadow(0 1px 1px rgba(0,0,0,0.2))',
                                    }}
                                  />
                                ) : null}
                                <span className="font-bold text-gray-900 dark:text-white text-sm">{teamFull}</span>
                              </div>
                              {displayOpponent && countdown && !isGameInProgress ? (
                                <div className="flex flex-col items-center min-w-[80px]">
                                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Bounce in</div>
                                  <div className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                                    {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                                  </div>
                                </div>
                              ) : displayOpponent && isGameInProgress ? (
                                <div className="flex flex-col items-center min-w-[80px]">
                                  <div className="text-sm font-semibold text-green-600 dark:text-green-400">LIVE</div>
                                </div>
                              ) : displayOpponent && nextGameTipoff ? (
                                <div className="flex flex-col items-center min-w-[80px]">
                                  <div className="text-[10px] text-gray-500 dark:text-gray-400">Game time passed</div>
                                </div>
                              ) : (
                                <span className="text-gray-500 dark:text-gray-400 font-medium text-xs">VS</span>
                              )}
                              <div className="flex items-center gap-1.5">
                                {displayOpponent && opponentFull !== '—' ? (
                                  <>
                                    {opponentLogo ? (
                                      <img
                                        src={opponentLogo}
                                        alt={opponentFull}
                                        className="w-8 h-8 object-contain flex-shrink-0"
                                        style={{
                                          filter: isDark
                                            ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.65))'
                                            : 'drop-shadow(0 0 1px rgba(15,23,42,0.45)) drop-shadow(0 1px 1px rgba(0,0,0,0.2))',
                                        }}
                                      />
                                    ) : null}
                                    <span className="font-bold text-gray-900 dark:text-white text-sm">{opponentFull}</span>
                                  </>
                                ) : (
                                  <span className="text-gray-400 dark:text-gray-500 text-sm font-medium min-w-[60px]">—</span>
                                )}
                              </div>
                            </div>
                          );
                        })() : (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                            <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0" aria-hidden />
                    </div>
                    {/* Search row - full width on mobile, below title on desktop */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <div className="flex-1 relative min-w-0">
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
                    </div>
                    {/* Journal button - same as NBA */}
                    {selectedPlayer && (selectedPlayer.team || selectedPlayerGameLogs.length > 0) && (
                      <div className="flex gap-2 px-0">
                        <button
                          type="button"
                          onClick={() => isPro && router.push('/journal')}
                          disabled={!isPro}
                          className={`flex-1 px-2 py-1.5 text-white text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                            !isPro ? 'bg-gray-400 cursor-not-allowed opacity-50' : 'bg-purple-600 hover:bg-purple-700'
                          }`}
                          title={!isPro ? 'Journal is a Pro feature' : 'Add to journal'}
                        >
                          {!isPro ? (
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          )}
                          Journal
                        </button>
                      </div>
                    )}
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
                    teammateFilterName={teammateFilterName}
                    withWithoutMode={withWithoutMode}
                    season={season}
                    clearTeammateFilter={() => {
                      setTeammateFilterName(null);
                      setWithWithoutMode('with');
                    }}
                    selectedTimeframe={aflChartTimeframe}
                    onTimeframeChange={setAflChartTimeframe}
                    onSelectedStatChange={setMainChartStat}
                  />
                </div>
                {/* 4. Supporting stats - percent played bars */}
                <div className="w-full min-w-0 flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm pt-3 px-5 pb-5 sm:pt-4 sm:px-6 sm:pb-6 border border-gray-200 dark:border-gray-700 mt-0.5">
                  <h3 className={`text-sm font-semibold mb-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    Supporting stats
                  </h3>
                  <AflSupportingStats
                    gameLogs={selectedPlayerGameLogs}
                    timeframe={aflChartTimeframe}
                    mainChartStat={mainChartStat}
                    supportingStatKind={supportingStatKind}
                    onSupportingStatKindChange={setSupportingStatKind}
                    isDark={!!mounted && isDark}
                  />
                </div>
                {/* 6. Mobile analysis - same as DashboardMobileAnalysis */}
                <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-2 md:p-3 border border-gray-200 dark:border-gray-700 w-full min-w-0 mt-2 sm:mt-3 md:mt-4 lg:mt-2">
                  <div className={`flex items-center justify-center min-h-[100px] ${emptyText} text-sm`}>—</div>
                </div>
                {/* 7. Mobile content - same as DashboardMobileContent */}
                <div className="lg:hidden w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-0 sm:p-4 gap-4 border border-gray-200 dark:border-gray-700 mt-2">
                  <div className={`flex items-center justify-center min-h-[180px] p-4 ${emptyText} text-sm`}>—</div>
                </div>
              </div>
              {/* Right panel - Filter By (Player / Game props) + Opponent Breakdown & Injuries (like NBA) */}
              <div className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-0 sm:px-1 md:px-0 lg:px-0 fade-scrollbar custom-scrollbar min-w-0 ${
                sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
              }`}>
                {/* Filter By - Player Props / Game Props (same as NBA DashboardRightPanel) */}
                <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-3 pt-3 pb-4 border border-gray-200 dark:border-gray-700 relative overflow-visible">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                    <button
                      onClick={() => setAflPropsMode('player')}
                      className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                        aflPropsMode === 'player'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Player Props
                    </button>
                    <button
                      onClick={() => setAflPropsMode('team')}
                      className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                        aflPropsMode === 'team'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Game Props
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                    {aflPropsMode === 'player' ? 'Analyze individual player statistics and props' : 'Analyze game totals, spreads, and game-based props'}
                  </p>
                </div>
                <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 border border-gray-200 dark:border-gray-700 w-full min-w-0">
                  <div className="flex gap-1.5 xl:gap-2 mb-2 xl:mb-3">
                    <button
                      onClick={() => setAflRightTab('breakdown')}
                      className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                        aflRightTab === 'breakdown'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      Opponent Breakdown
                    </button>
                    <button
                      onClick={() => setAflRightTab('injuries')}
                      className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                        aflRightTab === 'injuries'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      Injuries
                    </button>
                    <button
                      onClick={() => setAflRightTab('lineup')}
                      className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                        aflRightTab === 'lineup'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      Team list
                    </button>
                  </div>
                  <div className="relative h-[380px] xl:h-[420px] w-full min-w-0 flex flex-col min-h-0">
                    {aflRightTab === 'breakdown' && (
                      <AflOpponentBreakdownCard
                        key={displayOpponent ?? 'no-opponent'}
                        isDark={!!mounted && isDark}
                        season={season}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        lastOpponent={displayOpponent ?? null}
                      />
                    )}
                    {aflRightTab === 'injuries' && (
                      <AflInjuriesCard
                        isDark={!!mounted && isDark}
                        season={season}
                        playerTeam={typeof selectedPlayer?.team === 'string' ? selectedPlayer.team : null}
                        playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        gameLogs={selectedPlayerGameLogs}
                        teammateFilterName={teammateFilterName}
                        setTeammateFilterName={setTeammateFilterName}
                        withWithoutMode={withWithoutMode}
                        setWithWithoutMode={setWithWithoutMode}
                        clearTeammateFilter={() => {
                          setTeammateFilterName(null);
                          setWithWithoutMode('with');
                        }}
                      />
                    )}
                    {aflRightTab === 'lineup' && (
                      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                        <AflLineupCard
                          isDark={!!mounted && isDark}
                          gameLogs={selectedPlayerGameLogs as Array<{ round?: string; opponent?: string; result?: string; match_url?: string }>}
                          team={
                            typeof selectedPlayer?.team === 'string'
                              ? (rosterTeamToInjuryTeam(selectedPlayer.team) || selectedPlayer.team)
                              : null
                          }
                          season={season}
                          selectedPlayerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                        />
                      </div>
                    )}
                  </div>
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
        setTheme={setTheme}
        setOddsFormat={(fmt) => { setOddsFormat(fmt); try { localStorage.setItem('oddsFormat', fmt); } catch { /* ignore */ } }}
      />
    </div>
  );
}
