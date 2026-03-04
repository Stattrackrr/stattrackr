'use client';

import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { AflStatsChart, type AflChartTimeframe } from '@/app/afl/components/AflStatsChart';
import { AflInjuriesCard } from '@/app/afl/components/AflInjuriesCard';
import AflOpponentBreakdownCard from '@/app/afl/components/AflOpponentBreakdownCard';
import AflLeagueRankingCard from '@/app/afl/components/AflLeagueRankingCard';
import { DEFAULT_AFL_GAME_FILTERS, type AflGameFiltersState, type AflGameFilterDataItem } from '@/app/afl/components/AflGameFilters';
import AflLineupCard from '@/app/afl/components/AflLineupCard';
import AflDvpCard from '@/app/afl/components/AflDvpCard';
import { AflLadderCard } from '@/app/afl/components/AflLadderCard';
import { AflBoxScore } from '@/app/afl/components/AflBoxScore';
import { AflSupportingStats, type SupportingStatKind } from '@/app/afl/components/AflSupportingStats';
import { type AflBookRow, type AflPropLine, type AflPropOverOnly, type AflPropYesNo, getGoalsMarketLineOver, getGoalsMarketLines } from '@/app/afl/components/AflBestOddsTable';
import { AflLineSelector } from '@/app/afl/components/AflLineSelector';

/** Map chart stat to Best Odds player-prop column for the line selector in player mode. Use O/U columns (e.g. Disposals) where available so Over and Under both appear. */
const CHART_STAT_TO_PLAYER_PROP_COLUMN: Partial<Record<string, keyof Pick<AflBookRow, 'Disposals' | 'DisposalsOver' | 'AnytimeGoalScorer' | 'GoalsOver' | 'MarksOver' | 'TacklesOver'>>> = {
  disposals: 'Disposals', // O/U so both Over and Under show; use DisposalsOver only for over-only view
  goals: 'GoalsOver',
  marks: 'MarksOver',
  tackles: 'TacklesOver',
};

import { rosterTeamToInjuryTeam, footywireNicknameToOfficial, opponentToOfficialTeamName, opponentToFootywireTeam, ROSTER_TEAM_TO_INJURY_TEAM } from '@/lib/aflTeamMapping';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';

const AddToJournalModal = lazy(() => import('@/components/AddToJournalModal').then((mod) => ({ default: mod.default })));
import { supabase } from '@/lib/supabaseClient';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { Search, Loader2 } from 'lucide-react';

type AflPlayerRecord = Record<string, string | number>;
type AflGameLogRecord = Record<string, unknown>;
const AFL_PAGE_STATE_KEY = 'aflPageState:v1';
const AFL_PLAYER_LOGS_CACHE_PREFIX = 'aflPlayerLogsCache:v1';
const AFL_PLAYER_LOGS_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

const CHART_STAT_TO_DVP_METRIC: Record<string, string> = {
  disposals: 'disposals',
  kicks: 'kicks',
  marks: 'marks',
  goals: 'goals',
  tackles: 'tackles',
  clearances: 'clearances',
  inside_50s: 'inside_50s',
};

const CHART_STAT_TO_OA_CODE: Record<string, string> = {
  disposals: 'D',
  kicks: 'K',
  handballs: 'HB',
  marks: 'M',
  goals: 'G',
  tackles: 'T',
  clearances: 'CL',
  inside_50s: 'I50',
};

type PersistedAflPageState = {
  selectedPlayer: AflPlayerRecord | null;
  aflPropsMode: 'player' | 'team';
  aflTeamFilter?: string;
  aflRightTab: 'breakdown' | 'dvp' | 'rank';
  aflLowerTab: 'lineup' | 'injuries';
  aflChartTimeframe: AflChartTimeframe;
  withWithoutMode: 'with' | 'without';
  aflGameFilters?: AflGameFiltersState | null;
};

type CachedAflPlayerLogs = {
  createdAt: number;
  games: AflGameLogRecord[];
  gamesWithQuarters: AflGameLogRecord[];
  mergedStats: AflPlayerRecord;
};

function getAflPlayerLogsCacheKey(season: number, playerName: string, team: string): string {
  return `${AFL_PLAYER_LOGS_CACHE_PREFIX}:${season}:${playerName.trim().toLowerCase()}:${team.trim().toLowerCase()}`;
}

function normalizeTeamNameForLogo(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeLogoUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  // Production is HTTPS; avoid mixed-content blocking for http logo links.
  return raw.replace(/^http:\/\//i, 'https://');
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

function toDvpPositionLabel(raw: unknown): 'DEF' | 'MID' | 'FWD' | 'RUC' | null {
  const pos = String(raw ?? '').trim().toUpperCase();
  if (!pos) return null;
  if (pos === 'DEF' || pos === 'MID' || pos === 'FWD' || pos === 'RUC') return pos;

  // Handle known short labels used elsewhere in AFL flows.
  if (pos === 'KD' || pos === 'MD') return 'DEF';
  if (pos === 'KF' || pos === 'MF') return 'FWD';
  if (pos === 'M/F') return 'MID';

  // Fallback for verbose labels (e.g. MEDIUM_DEFENDER, MIDFIELDER_FORWARD).
  if (pos.includes('RUC')) return 'RUC';
  if (pos.includes('MID')) return 'MID';
  if (pos.includes('DEF')) return 'DEF';
  if (pos.includes('FWD') || pos.includes('FORWARD')) return 'FWD';
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseAflScoresFromResult(resultRaw: unknown): { team: number; opponent: number } | null {
  const result = String(resultRaw ?? '').trim();
  if (!result) return null;

  // AFL result strings often include points in parentheses, e.g. "... (87) - ... (73)".
  const parenScores = [...result.matchAll(/\((\d{1,3})\)/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n));
  if (parenScores.length >= 2) {
    return { team: parenScores[parenScores.length - 2], opponent: parenScores[parenScores.length - 1] };
  }

  // Fallback for simple score formats like "87-73".
  const simple = result.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})/);
  if (simple) {
    const team = parseInt(simple[1], 10);
    const opponent = parseInt(simple[2], 10);
    if (Number.isFinite(team) && Number.isFinite(opponent)) return { team, opponent };
  }

  return null;
}

function parseAflGoalsFromResult(resultRaw: unknown): { team: number; opponent: number } | null {
  const result = String(resultRaw ?? '').trim();
  if (!result) return null;
  const gb = [...result.matchAll(/(\d{1,2})\s*\.\s*(\d{1,2})/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n));
  if (gb.length >= 2) {
    return { team: gb[gb.length - 2], opponent: gb[gb.length - 1] };
  }
  return null;
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
  /** True when we have ?player= in URL and are still fetching — show skeleton so containers are never blank */
  const [loadingPlayerFromUrl, setLoadingPlayerFromUrl] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const u = new URL(window.location.href);
      return !!u.searchParams.get('player')?.trim();
    } catch {
      return false;
    }
  });
  const [selectedPlayerGameLogs, setSelectedPlayerGameLogs] = useState<AflGameLogRecord[]>([]);
  const [selectedPlayerGameLogsWithQuarters, setSelectedPlayerGameLogsWithQuarters] = useState<AflGameLogRecord[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [statsLoadingForPlayer, setStatsLoadingForPlayer] = useState(false);
  const [lastStatsError, setLastStatsError] = useState<string | null>(null);
  const [aflRightTab, setAflRightTab] = useState<'breakdown' | 'dvp' | 'rank'>('dvp');
  /** Tracks which right tabs have been opened so we keep their content mounted (no re-render on tab switch). */
  const [aflRightTabsVisited, setAflRightTabsVisited] = useState<Set<'breakdown' | 'dvp' | 'rank'>>(() => new Set(['dvp']));
  const [aflLowerTab, setAflLowerTab] = useState<'lineup' | 'injuries'>('lineup');
  /** Tracks which lower tabs (Team list / Injuries) have been opened so we keep content mounted and don't re-fetch. */
  const [aflLowerTabsVisited, setAflLowerTabsVisited] = useState<Set<'lineup' | 'injuries'>>(() => new Set(['lineup']));
  const [aflPropsMode, setAflPropsMode] = useState<'player' | 'team'>('player');
  const [aflTeamFilter, setAflTeamFilter] = useState<string>('All');
  const [aflChartTimeframe, setAflChartTimeframe] = useState<AflChartTimeframe>('last10');
  const [mainChartStat, setMainChartStat] = useState<string>('');
  const [supportingStatKind, setSupportingStatKind] = useState<SupportingStatKind>('tog');
  const [teammateFilterName, setTeammateFilterName] = useState<string | null>(null);
  useEffect(() => {
    setSupportingStatKind('tog');
  }, [mainChartStat]);
  useEffect(() => {
    if (aflPropsMode === 'team') {
      setAflRightTab('breakdown');
      setAflLowerTab('lineup');
    }
  }, [aflPropsMode]);
  useEffect(() => {
    setAflRightTabsVisited((prev) => new Set(prev).add(aflRightTab));
  }, [aflRightTab]);
  useEffect(() => {
    setAflLowerTabsVisited((prev) => new Set(prev).add(aflLowerTab));
  }, [aflLowerTab]);
  const [withWithoutMode, setWithWithoutMode] = useState<'with' | 'without'>('with');
  const [aflGameFilters, setAflGameFilters] = useState<AflGameFiltersState>(() => ({
    ...DEFAULT_AFL_GAME_FILTERS,
    dvpPosition: 'MID',
  }));
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [aflFilterDataDvp, setAflFilterDataDvp] = useState<{ opponents: string[]; metrics: Record<string, { teamTotalRanks: Record<string, number> }> } | null>(null);
  const [aflFilterDataOa, setAflFilterDataOa] = useState<{ teams: Array<{ team: string; stats?: Record<string, number | string | null> }> } | null>(null);
  const [nextGameOpponent, setNextGameOpponent] = useState<string | null>(null);
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  useCountdownTimer({ nextGameTipoff, isGameInProgress, setCountdown });
  const [season] = useState(() => {
    // Use 2026 for AFL fixture (FootyWire ft_match_list?year=2026) and season context
    return 2026;
  });
  const [aflOddsBooks, setAflOddsBooks] = useState<AflBookRow[]>([]);
  const [aflOddsLoading, setAflOddsLoading] = useState(false);
  const [aflOddsError, setAflOddsError] = useState<string | null>(null);
  const [aflOddsHomeTeam, setAflOddsHomeTeam] = useState<string>('');
  const [aflOddsAwayTeam, setAflOddsAwayTeam] = useState<string>('');
  const [selectedAflBookIndex, setSelectedAflBookIndex] = useState(0);
  /** When mainChartStat is 'disposals', which column to use: O/U or Over-only (alt lines). */
  const [selectedAflDisposalsColumn, setSelectedAflDisposalsColumn] = useState<'Disposals' | 'DisposalsOver'>('Disposals');
  const [aflCurrentLineValue, setAflCurrentLineValue] = useState<number | null>(null);
  /** Game props (team mode): current line from chart input; used so line selector hides bookmaker when it doesn't match. */
  const [aflGameLineValue, setAflGameLineValue] = useState<number | null>(null);
  const [aflPlayerPropsBooks, setAflPlayerPropsBooks] = useState<AflBookRow[]>([]);
  const [aflPlayerPropsLoading, setAflPlayerPropsLoading] = useState(false);
  const [aflPlayerPropsRefetchKey, setAflPlayerPropsRefetchKey] = useState(0);
  const lastPlayerPropsKeyRef = useRef<string | null>(null);
  const ignoreNextTransientLineRef = useRef(false);
  /** Short delay before showing chart so odds have time to load and auto-select inline with chart. */
  const [chartDelayElapsed, setChartDelayElapsed] = useState(false);
  const CHART_DISPLAY_DELAY_MS = 500;
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedLogsRef = useRef<Map<string, { games: AflGameLogRecord[]; gamesWithQuarters: AflGameLogRecord[]; mergedStats: Partial<AflPlayerRecord> }>>(new Map());
  const [logoByTeam, setLogoByTeam] = useState<Record<string, string>>({});

  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } = useDashboardStyles({ sidebarOpen });

  useEffect(() => setMounted(true), []);

  // Reset chart delay when player changes so we show skeleton then brief delay again (keeps odds in sync with chart)
  useEffect(() => {
    setChartDelayElapsed(false);
  }, [selectedPlayer?.id, selectedPlayer?.name]);

  // After stats load, wait a short moment before showing chart so odds can load and auto-select
  useEffect(() => {
    if (!selectedPlayer || statsLoadingForPlayer) return;
    const t = setTimeout(() => setChartDelayElapsed(true), CHART_DISPLAY_DELAY_MS);
    return () => clearTimeout(t);
  }, [selectedPlayer, statsLoadingForPlayer]);

  // Refetch player props when tab becomes visible so all bookmakers (e.g. PointsBet) show without full page refresh
  useEffect(() => {
    const onVisible = () => setAflPlayerPropsRefetchKey((k) => k + 1);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Prefer PointsBet as the selected book when in player mode so the line selector shows PointsBet + O/U, not Fanatics/other
  useEffect(() => {
    if (aflPropsMode !== 'player' || !aflPlayerPropsBooks.length) return;
    const pointsBetIndex = aflPlayerPropsBooks.findIndex(
      (b) => b.name && String(b.name).toLowerCase().includes('pointsbet')
    );
    if (pointsBetIndex >= 0) {
      setSelectedAflBookIndex(pointsBetIndex);
    }
  }, [aflPropsMode, aflPlayerPropsBooks]);

  // When user changes the line input (transient-line), find a book that has that line and switch to it; skip if we just switched stat. Same logic for player props (disposals/goals/other) and game props (spread/total).
  useEffect(() => {
    const tol = 0.01;
    const onTransientLine = (e: Event) => {
      if (ignoreNextTransientLineRef.current) {
        ignoreNextTransientLineRef.current = false;
        return;
      }
      const value = (e as CustomEvent<{ value: number }>).detail?.value;
      if (value == null || !Number.isFinite(value)) return;

      if (aflPropsMode === 'player' && aflPlayerPropsBooks.length) {
        const col = CHART_STAT_TO_PLAYER_PROP_COLUMN[mainChartStat];
        if (!col) return;
        setAflCurrentLineValue(value);
        if (mainChartStat === 'disposals') {
          for (let idx = 0; idx < aflPlayerPropsBooks.length; idx++) {
            const book = aflPlayerPropsBooks[idx];
            for (const c of ['Disposals', 'DisposalsOver'] as const) {
              const lineStr = (book[c] as { line?: string } | undefined)?.line;
              if (!lineStr || lineStr === 'N/A') continue;
              const lineNum = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
              if (Number.isFinite(lineNum) && Math.abs(lineNum - value) < tol) {
                setSelectedAflBookIndex(idx);
                setSelectedAflDisposalsColumn(c);
                return;
              }
            }
          }
          return;
        }
        if (mainChartStat === 'goals') {
          for (let idx = 0; idx < aflPlayerPropsBooks.length; idx++) {
            const book = aflPlayerPropsBooks[idx];
            const hasLine = getGoalsMarketLines(book).some((x) => {
              const lineNum = parseFloat(String(x.line).replace(/[^0-9.-]/g, ''));
              return Number.isFinite(lineNum) && Math.abs(lineNum - value) < tol;
            });
            if (hasLine) {
              setSelectedAflBookIndex(idx);
              return;
            }
          }
          return;
        }
        const idx = aflPlayerPropsBooks.findIndex((book) => {
          const lineStr = col === 'GoalsOver' ? getGoalsMarketLineOver(book)?.line : (book[col] as { line?: string } | undefined)?.line;
          if (!lineStr || lineStr === 'N/A') return false;
          const lineNum = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
          return Number.isFinite(lineNum) && Math.abs(lineNum - value) < tol;
        });
        if (idx >= 0) setSelectedAflBookIndex(idx);
        return;
      }

      if (aflPropsMode === 'team' && aflOddsBooks.length && (mainChartStat === 'spread' || mainChartStat === 'total_points')) {
        setAflGameLineValue(value);
        const idx = aflOddsBooks.findIndex((book) => {
          const lineStr = mainChartStat === 'spread' ? book.Spread?.line : book.Total?.line;
          if (!lineStr || lineStr === 'N/A') return false;
          const lineNum = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
          return Number.isFinite(lineNum) && Math.abs(lineNum - value) < tol;
        });
        if (idx >= 0) setSelectedAflBookIndex(idx);
      }
      // total_goals: bookmaker "Total" is total points, not goals — don't sync line or book
    };
    window.addEventListener('transient-line', onTransientLine);
    return () => window.removeEventListener('transient-line', onTransientLine);
  }, [aflPropsMode, mainChartStat, aflPlayerPropsBooks, aflOddsBooks]);

  // Effective player-prop column: for disposals use selected O/U vs Over-only; for goals use GoalsOver (with Anytime 0.5); else chart stat mapping
  const effectivePlayerPropColumn = mainChartStat === 'disposals'
    ? selectedAflDisposalsColumn
    : (CHART_STAT_TO_PLAYER_PROP_COLUMN[mainChartStat] ?? null);

  // When stat changes: pick a book that has data for the new stat (switch if current doesn't), set line from that book, and ignore the next transient-line so chart's stat-average emit doesn't overwrite. For disposals, prefer O/U then Over-only.
  useEffect(() => {
    if (aflPropsMode !== 'player' || !aflPlayerPropsBooks.length) return;
    const baseCol = CHART_STAT_TO_PLAYER_PROP_COLUMN[mainChartStat];
    if (!baseCol) return;
    const disposalsCols = baseCol === 'Disposals' ? (['Disposals', 'DisposalsOver'] as const) : null;
    const getLineStr = (book: AflBookRow, col: keyof AflBookRow) =>
      col === 'GoalsOver' ? getGoalsMarketLineOver(book)?.line : (book[col] as { line?: string } | undefined)?.line;
    const col = mainChartStat === 'disposals' ? selectedAflDisposalsColumn : baseCol;
    let book = aflPlayerPropsBooks[selectedAflBookIndex];
    let lineStr = book ? getLineStr(book, col) : undefined;
    let resolvedCol = col;
    if (!lineStr || lineStr === 'N/A') {
      if (disposalsCols) {
        const withData = aflPlayerPropsBooks.findIndex((b) => {
          const s1 = getLineStr(b, 'Disposals');
          const s2 = getLineStr(b, 'DisposalsOver');
          return (s1 && s1 !== 'N/A') || (s2 && s2 !== 'N/A');
        });
        if (withData >= 0) {
          book = aflPlayerPropsBooks[withData];
          const hasOu = getLineStr(book, 'Disposals') && getLineStr(book, 'Disposals') !== 'N/A';
          resolvedCol = hasOu ? 'Disposals' : 'DisposalsOver';
          lineStr = getLineStr(book, resolvedCol) ?? undefined;
          setSelectedAflBookIndex(withData);
          setSelectedAflDisposalsColumn(resolvedCol);
        }
      } else {
        const pointsBetIdx = aflPlayerPropsBooks.findIndex((b) => b.name && String(b.name).toLowerCase().includes('pointsbet'));
        const withData = pointsBetIdx >= 0 && getLineStr(aflPlayerPropsBooks[pointsBetIdx], col)
          ? pointsBetIdx
          : aflPlayerPropsBooks.findIndex((b) => {
              const s = getLineStr(b, col);
              return s && s !== 'N/A';
            });
        if (withData >= 0) {
          setSelectedAflBookIndex(withData);
          book = aflPlayerPropsBooks[withData];
          lineStr = getLineStr(book, col);
        }
      }
    }
    const n = lineStr && lineStr !== 'N/A'
      ? parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''))
      : 0.5;
    if (Number.isFinite(n)) {
      ignoreNextTransientLineRef.current = true;
      setAflCurrentLineValue(n);
    }
  }, [aflPropsMode, mainChartStat, selectedAflDisposalsColumn, aflPlayerPropsBooks]);

  // When game props stat changes (spread / total_points): pick a book that has a line for that stat. For total_goals we don't use book Total (that's points); chart shows goals only, no odds line.
  useEffect(() => {
    if (aflPropsMode !== 'team' || !aflOddsBooks.length) return;
    if (mainChartStat === 'total_goals') return; // no bookmaker line for total goals
    if (mainChartStat !== 'spread' && mainChartStat !== 'total_points') return;
    const getLineStr = (book: AflBookRow) =>
      mainChartStat === 'spread' ? book.Spread?.line : book.Total?.line;
    const book = aflOddsBooks[selectedAflBookIndex];
    const lineStr = book ? getLineStr(book) : undefined;
    if (lineStr && lineStr !== 'N/A') {
      const n = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(n)) setAflGameLineValue(n);
      return;
    }
    const withData = aflOddsBooks.findIndex((b) => {
      const s = getLineStr(b);
      return s && s !== 'N/A';
    });
    if (withData >= 0) {
      setSelectedAflBookIndex(withData);
      const newLineStr = getLineStr(aflOddsBooks[withData]);
      const n = newLineStr && newLineStr !== 'N/A' ? parseFloat(String(newLineStr).replace(/[^0-9.-]/g, '')) : 0.5;
      if (Number.isFinite(n)) setAflGameLineValue(n);
      ignoreNextTransientLineRef.current = true;
    } else {
      setAflGameLineValue(0.5);
    }
  }, [aflPropsMode, mainChartStat, aflOddsBooks, selectedAflBookIndex]);

  // Keep DVP metric / opponentStat in sync with the main chart stat so the filters
  // and right-hand panels reflect the stat the user has actually selected.
  useEffect(() => {
    if (!mainChartStat) return;
    setAflGameFilters((prev) => {
      const nextMetric = CHART_STAT_TO_DVP_METRIC[mainChartStat] ?? prev.dvpMetric ?? 'disposals';
      const nextOpponentStat = CHART_STAT_TO_OA_CODE[mainChartStat] ?? prev.opponentStat ?? 'D';
      if (prev.dvpMetric === nextMetric && prev.opponentStat === nextOpponentStat) {
        return prev;
      }
      return {
        ...prev,
        dvpMetric: nextMetric,
        opponentStat: nextOpponentStat,
      };
    });
  }, [mainChartStat]);

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

  // When landing with ?player=Name (e.g. from AFL props page click), fetch and select that player.
  // Clear current player immediately so we don't flash the previous player's chart before the new one loads.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const playerParam = url.searchParams.get('player')?.trim();
    if (!playerParam) return;
    const teamParam = url.searchParams.get('team')?.trim();
    setLoadingPlayerFromUrl(true);
    setSelectedPlayer(null);
    setSelectedPlayerGameLogs([]);
    setSelectedPlayerGameLogsWithQuarters([]);
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ query: playerParam, limit: '30', exact: '1' });
        if (teamParam) params.set('team', teamParam);
        const res = await fetch(`/api/afl/players?${params.toString()}`);
        const data = await res.json();
        if (cancelled || !res.ok) {
          if (!cancelled) setLoadingPlayerFromUrl(false);
          return;
        }
        const list = Array.isArray(data?.players) ? data.players : [];
        const match = list.find((p: Record<string, unknown>) => {
          const name = String(p?.name ?? p?.player_name ?? p?.full_name ?? '').trim();
          return name.toLowerCase() === playerParam.toLowerCase();
        }) ?? list[0];
        if (cancelled || !match) {
          if (!cancelled) setLoadingPlayerFromUrl(false);
          return;
        }
        const record: AflPlayerRecord = {
          name: String(match.name ?? match.player_name ?? match.full_name ?? '—'),
          ...(typeof match.team === 'string' ? { team: match.team } : {}),
          ...(typeof match.number === 'number' && Number.isFinite(match.number) ? { guernsey: match.number } : {}),
          ...(match.id != null ? { id: match.id } : {}),
        };
        setSelectedPlayer(record);
        setSelectedPlayerGameLogs([]);
        setSelectedPlayerGameLogsWithQuarters([]);
        setStatsLoadingForPlayer(true);
        setSearchQuery('');
        setLoadingPlayerFromUrl(false);
        url.searchParams.delete('player');
        url.searchParams.delete('team');
        window.history.replaceState({}, '', url.toString());
      } catch {
        if (!cancelled) {
          setLoadingPlayerFromUrl(false);
          url.searchParams.delete('player');
          url.searchParams.delete('team');
          window.history.replaceState({}, '', url.toString());
        }
      }
    })();
    return () => {
      cancelled = true;
      setLoadingPlayerFromUrl(false);
    };
  }, []);

  // Rehydrate AFL page context on refresh so the selected player/screen is preserved.
  // When URL has ?player= we are coming from props with a specific player — do not restore old selectedPlayer so we don't flash the previous player's chart.
  useEffect(() => {
    try {
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const hasPlayerParam = url?.searchParams.get('player')?.trim() ?? '';
      const raw = localStorage.getItem(AFL_PAGE_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedAflPageState>;
      if (!hasPlayerParam && parsed.selectedPlayer && typeof parsed.selectedPlayer === 'object') {
        setSelectedPlayer(parsed.selectedPlayer as AflPlayerRecord);
      }
      if (parsed.aflPropsMode === 'player' || parsed.aflPropsMode === 'team') {
        setAflPropsMode(parsed.aflPropsMode);
      }
      if (typeof parsed.aflTeamFilter === 'string' && parsed.aflTeamFilter.trim() !== '') {
        const validTeams = new Set(['All', ...Object.values(ROSTER_TEAM_TO_INJURY_TEAM)]);
        if (validTeams.has(parsed.aflTeamFilter)) setAflTeamFilter(parsed.aflTeamFilter);
      }
      if (parsed.aflRightTab === 'dvp' || parsed.aflRightTab === 'breakdown' || parsed.aflRightTab === 'rank') {
        setAflRightTab(parsed.aflRightTab);
      }
      if (parsed.aflLowerTab === 'lineup' || parsed.aflLowerTab === 'injuries') {
        setAflLowerTab(parsed.aflLowerTab);
      }
      const validTimeframes: AflChartTimeframe[] = ['last5', 'last10', 'last15', 'last20', 'h2h', 'lastseason', 'thisseason'];
      if (parsed.aflChartTimeframe && validTimeframes.includes(parsed.aflChartTimeframe)) {
        setAflChartTimeframe(parsed.aflChartTimeframe);
      }
      if (parsed.withWithoutMode === 'with' || parsed.withWithoutMode === 'without') {
        setWithWithoutMode(parsed.withWithoutMode);
      }
      if (parsed.aflGameFilters && typeof parsed.aflGameFilters === 'object') {
        const g = parsed.aflGameFilters as AflGameFiltersState;
        setAflGameFilters({
          dvpRankMin: g.dvpRankMin ?? null,
          dvpRankMax: g.dvpRankMax ?? null,
          dvpPosition: typeof g.dvpPosition === 'string' ? g.dvpPosition : 'MID',
          dvpMetric: typeof g.dvpMetric === 'string' ? g.dvpMetric : 'disposals',
          opponentRankMin: g.opponentRankMin ?? null,
          opponentRankMax: g.opponentRankMax ?? null,
          opponentStat: typeof g.opponentStat === 'string' ? g.opponentStat : 'D',
          togMin: g.togMin ?? null,
          togMax: g.togMax ?? null,
        });
      }
    } catch {
      // Ignore malformed local state.
    }
  }, []);

  // Sync game filter DVP position to selected player when player changes.
  useEffect(() => {
    if (selectedPlayer?.position && ['DEF', 'MID', 'FWD', 'RUC'].includes(String(selectedPlayer.position))) {
      setAflGameFilters((prev) => ({ ...prev, dvpPosition: String(selectedPlayer!.position) }));
    }
  }, [selectedPlayer?.id]);

  // Persist AFL page context as user navigates tabs/filters/players.
  useEffect(() => {
    const payload: PersistedAflPageState = {
      selectedPlayer,
      aflPropsMode,
      aflTeamFilter,
      aflRightTab,
      aflLowerTab,
      aflChartTimeframe,
      withWithoutMode,
      aflGameFilters,
    };
    try {
      localStorage.setItem(AFL_PAGE_STATE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [selectedPlayer, aflPropsMode, aflTeamFilter, aflRightTab, aflLowerTab, aflChartTimeframe, withWithoutMode, aflGameFilters]);

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
        const res = await fetch('/api/afl/team-logos');
        if (!res.ok) return;
        const json = await res.json();
        const nextMap: Record<string, string> = {};
        const logos = json?.logos && typeof json.logos === 'object' ? json.logos : {};
        for (const [name, rawLogo] of Object.entries(logos as Record<string, unknown>)) {
          const normalizedName = normalizeTeamNameForLogo(String(name));
          const logo = normalizeLogoUrl(String(rawLogo ?? ''));
          if (!normalizedName || !logo) continue;
          nextMap[normalizedName] = logo;
        }
        if (!cancelled && Object.keys(nextMap).length > 0) setLogoByTeam(nextMap);
      } catch {
        // ignore
      }
    };
    loadTeamLogos();
    return () => { cancelled = true; };
  }, [season]);

  const aflOddsTeam = selectedPlayer?.team ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || String(selectedPlayer.team)) : '';
  const aflOddsOpponent =
    nextGameOpponent && nextGameOpponent !== '—'
      ? (opponentToOfficialTeamName(nextGameOpponent) || nextGameOpponent)
      : '';
  const aflOddsGameDate = nextGameTipoff ? nextGameTipoff.toISOString().split('T')[0] : '';

  useEffect(() => {
    if (!aflOddsTeam || !aflOddsOpponent) {
      setAflOddsBooks([]);
      setAflOddsHomeTeam('');
      setAflOddsAwayTeam('');
      setAflOddsError(null);
      return;
    }
    let cancelled = false;
    setAflOddsLoading(true);
    setAflOddsError(null);
    const urlWithDate = `/api/afl/odds?team=${encodeURIComponent(aflOddsTeam)}&opponent=${encodeURIComponent(aflOddsOpponent)}&game_date=${encodeURIComponent(aflOddsGameDate)}`;
    const urlNoDate = `/api/afl/odds?team=${encodeURIComponent(aflOddsTeam)}&opponent=${encodeURIComponent(aflOddsOpponent)}`;
    const apply = (data: { success?: boolean; data?: unknown[]; homeTeam?: string; awayTeam?: string; error?: string | null }) => {
      if (data?.success && Array.isArray(data.data) && data.data.length > 0) {
        setAflOddsBooks(data.data as AflBookRow[]);
        setAflOddsHomeTeam(data.homeTeam || aflOddsTeam);
        setAflOddsAwayTeam(data.awayTeam || aflOddsOpponent);
        setSelectedAflBookIndex((i) => (i >= (data.data?.length ?? 0) ? 0 : i));
        setAflOddsError(null);
        return true;
      }
      return false;
    };
    fetch(urlWithDate)
      .then((r) => r.json())
      .then(async (data) => {
        if (cancelled) return;
        if (apply(data)) {
          setAflOddsLoading(false);
          return;
        }
        if (aflOddsGameDate) {
          const fallback = await fetch(urlNoDate).then((r) => r.json());
          if (!cancelled && apply(fallback)) {
            setAflOddsError(null);
          } else if (!cancelled) {
            setAflOddsBooks([]);
            setAflOddsHomeTeam('');
            setAflOddsAwayTeam('');
            setAflOddsError(fallback?.error || data?.error || null);
          }
        } else if (!cancelled) {
          setAflOddsBooks([]);
          setAflOddsHomeTeam('');
          setAflOddsAwayTeam('');
          setAflOddsError(data?.error || null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAflOddsBooks([]);
          setAflOddsError(err?.message || 'Failed to load odds');
        }
      })
      .finally(() => {
        if (!cancelled) setAflOddsLoading(false);
      });
    return () => { cancelled = true; };
  }, [aflOddsTeam, aflOddsOpponent, aflOddsGameDate]);

  type PlayerPropFetchCol = keyof Pick<AflBookRow, 'Disposals' | 'DisposalsOver' | 'AnytimeGoalScorer' | 'GoalsOver' | 'MarksOver' | 'TacklesOver'>;
  const AFL_PLAYER_PROP_FETCH: { stat: string; column: PlayerPropFetchCol; type: 'ou' | 'over' | 'yesno' }[] = [
    { stat: 'disposals', column: 'Disposals', type: 'ou' },
    { stat: 'disposals_over', column: 'DisposalsOver', type: 'over' },
    { stat: 'anytime_goal_scorer', column: 'AnytimeGoalScorer', type: 'yesno' },
    { stat: 'goals_over', column: 'GoalsOver', type: 'over' },
    { stat: 'marks_over', column: 'MarksOver', type: 'over' },
    { stat: 'tackles_over', column: 'TacklesOver', type: 'over' },
  ];

  const PLAYER_PROP_COLUMNS: PlayerPropFetchCol[] = ['Disposals', 'DisposalsOver', 'AnytimeGoalScorer', 'GoalsOver', 'MarksOver', 'TacklesOver'];

  function hasPropData(val: unknown): boolean {
    if (val == null || typeof val !== 'object') return false;
    const o = val as Record<string, string>;
    return Object.values(o).some((v) => v != null && String(v).trim() !== '' && v !== 'N/A');
  }

  function mergePlayerPropsBooks(prev: AflBookRow[], next: AflBookRow[]): AflBookRow[] {
    const byName = new Map<string, AflBookRow>();
    for (const row of prev) byName.set(row.name, { ...row });
    for (const row of next) {
      const existing = byName.get(row.name);
      if (!existing) {
        byName.set(row.name, { ...row });
        continue;
      }
      for (const col of PLAYER_PROP_COLUMNS) {
        const nextVal = row[col];
        if (hasPropData(nextVal)) (existing as unknown as Record<string, unknown>)[col] = nextVal;
        else if (!hasPropData(existing[col])) (existing as unknown as Record<string, unknown>)[col] = nextVal ?? existing[col];
      }
    }
    return Array.from(byName.values());
  }

  useEffect(() => {
    if (aflPropsMode !== 'player' || !selectedPlayer?.name) {
      setAflPlayerPropsBooks([]);
      return;
    }
    const playerName = String(selectedPlayer.name).trim();
    if (!playerName) {
      setAflPlayerPropsBooks([]);
      return;
    }
    const teamRaw = selectedPlayer?.team;
    if (!teamRaw || typeof teamRaw !== 'string' || !teamRaw.trim()) {
      setAflPlayerPropsBooks([]);
      return;
    }
    const playerKey = `${playerName}-${teamRaw}`;
    // Clear previous player's odds immediately so we never show stale data when switching players
    if (lastPlayerPropsKeyRef.current !== null && lastPlayerPropsKeyRef.current !== playerKey) {
      setAflPlayerPropsBooks([]);
    }
    // Wait for game odds request to finish first when we have an opponent, so player-props API can resolve event ID from the same fresh odds data
    if (aflOddsOpponent && aflOddsLoading) return;
    const teamForProps = rosterTeamToInjuryTeam(String(teamRaw)) || String(teamRaw);
    const lastRound =
      (typeof selectedPlayer?.last_round === 'string' && selectedPlayer.last_round.trim()
        ? selectedPlayer.last_round.trim()
        : '') || '';

    let cancelled = false;
    setAflPlayerPropsLoading(true);

    const toAmerican = (dec: number): string => {
      if (!Number.isFinite(dec) || dec <= 1) return 'N/A';
      if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
      return `-${Math.round(100 / (dec - 1))}`;
    };

    type PropItem = {
      bookmaker: string;
      line?: number | string;
      overPrice?: number;
      underPrice?: number;
      yesPrice?: number;
      noPrice?: number;
    };

    const params = new URLSearchParams({ team: teamRaw.trim(), season: String(season) });
    if (lastRound) params.set('last_round', lastRound);
    fetch(`/api/afl/next-game?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return null;
        const opponent =
          typeof data?.next_opponent === 'string' && data.next_opponent && data.next_opponent !== '—'
            ? (opponentToOfficialTeamName(data.next_opponent) || data.next_opponent)
            : '';
        const tipoff = data?.next_game_tipoff && typeof data.next_game_tipoff === 'string' ? new Date(data.next_game_tipoff) : null;
        const gameDateForProps = tipoff && Number.isFinite(tipoff.getTime()) ? tipoff.toISOString().split('T')[0] : '';
        if (!opponent) {
          setAflPlayerPropsBooks([]);
          return null;
        }
        const teamOpp = [
          `team=${encodeURIComponent(teamForProps)}`,
          `opponent=${encodeURIComponent(opponent)}`,
          gameDateForProps && `game_date=${encodeURIComponent(gameDateForProps)}`,
        ]
          .filter(Boolean)
          .join('&');
        const url = `/api/afl/player-props?player=${encodeURIComponent(playerName)}&all=1&${teamOpp}`;
        return fetch(url)
          .then((r) => r.json().then((data: { all?: Record<string, PropItem[]>; error?: string; message?: string }) => ({ ok: r.ok, data })))
          .catch(() => ({ ok: false, data: { all: {} } }));
      })
      .then((payload) => {
        if (cancelled || !payload) return;
        const { data } = payload as { ok: boolean; data: { all?: Record<string, PropItem[]> } };
        const all = data?.all != null && typeof data.all === 'object' ? data.all : {};
        const bookMap = new Map<string, AflBookRow>();
        AFL_PLAYER_PROP_FETCH.forEach((config) => {
          const props = Array.isArray(all[config.stat]) ? (all[config.stat] as PropItem[]) : [];
          const col = config.column;
          for (const p of props) {
            const name = (p.bookmaker || '').trim() || 'Unknown';
            let row = bookMap.get(name);
            if (!row) {
              row = { name, H2H: { home: 'N/A', away: 'N/A' }, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' }, Total: { line: 'N/A', over: 'N/A', under: 'N/A' } };
              bookMap.set(name, row);
            }
            const lineStr = p.line != null ? String(p.line) : 'N/A';
            if (config.type === 'ou') {
              const over = typeof p.overPrice === 'number' ? toAmerican(p.overPrice) : 'N/A';
              const under = typeof p.underPrice === 'number' ? toAmerican(p.underPrice) : 'N/A';
              (row as unknown as Record<string, AflPropLine>)[col] = { line: lineStr, over, under };
            } else if (config.type === 'over') {
              const over = typeof p.overPrice === 'number' ? toAmerican(p.overPrice) : 'N/A';
              (row as unknown as Record<string, AflPropOverOnly>)[col] = { line: lineStr, over };
            } else if (config.type === 'yesno') {
              const yes = typeof p.yesPrice === 'number' ? toAmerican(p.yesPrice) : 'N/A';
              const no = typeof p.noPrice === 'number' ? toAmerican(p.noPrice) : 'N/A';
              (row as unknown as Record<string, AflPropYesNo>)[col] = { yes, no };
            }
          }
        });
        const nextBooks = Array.from(bookMap.values());
        lastPlayerPropsKeyRef.current = playerKey;
        setAflPlayerPropsBooks(nextBooks);
      })
      .catch(() => {
        if (!cancelled) setAflPlayerPropsBooks([]);
      })
      .finally(() => {
        if (!cancelled) setAflPlayerPropsLoading(false);
      });
    return () => { cancelled = true; };
  }, [aflPropsMode, selectedPlayer?.name, selectedPlayer?.team, selectedPlayer?.last_round, season, aflPlayerPropsRefetchKey, aflOddsOpponent, aflOddsLoading]);

  const playerStatsCacheRef = useRef<Map<string, AflPlayerRecord>>(new Map());

  const fetchPlayers = useCallback(async (query: string, teamFilter?: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setPlayersLoading(true);
    try {
      const params = new URLSearchParams({ query: query.trim(), limit: '30' });
      if (teamFilter && teamFilter !== 'All' && teamFilter.trim() !== '') {
        params.set('team', teamFilter.trim());
      }
      const res = await fetch(`/api/afl/players?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data?.error || 'Failed to load players';
        throw new Error(errorMsg);
      }
      const list = Array.isArray(data?.players) ? data.players : [];
      setSearchResults(list.map((p: Record<string, unknown>) => ({
        name: String(p.name ?? '-'),
        team: typeof p.team === 'string' ? p.team : undefined,
        ...(typeof p.number === 'number' && Number.isFinite(p.number) ? { guernsey: p.number } : {}),
      })));
    } catch {
      setSearchResults([]);
    } finally {
      setPlayersLoading(false);
    }
  }, []);

  // Show search dropdown when typing; re-fetch when team filter changes so results match selected team
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setShowSearchDropdown(false);
      setSearchResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPlayers(q, aflTeamFilter);
      setShowSearchDropdown(true);
      debounceRef.current = null;
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, aflTeamFilter, fetchPlayers]);

  const AFL_TEAM_FILTER_OPTIONS = useMemo(() => ['All', ...Object.values(ROSTER_TEAM_TO_INJURY_TEAM).sort()], []);

  const filteredPlayers = (() => {
    const q = searchQuery.trim().toLowerCase();
    let list = searchResults;
    if (q) {
      list = list.filter((p) => {
        const name = String(
          p?.name ?? p?.player_name ?? p?.full_name ?? ''
        ).toLowerCase();
        return name.includes(q);
      });
    }
    if (aflTeamFilter !== 'All' && aflTeamFilter !== '') {
      list = list.filter((p) => {
        const teamRaw = p?.team;
        if (!teamRaw || typeof teamRaw !== 'string') return false;
        const resolved = rosterTeamToInjuryTeam(teamRaw) || teamRaw.trim();
        return resolved === aflTeamFilter;
      });
    }
    return list.slice(0, 12);
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

  // Prefetch game logs when user hovers over a search result so data is ready on click.
  const prefetchPlayerLogs = useCallback((player: AflPlayerRecord) => {
    const name = String(player?.name ?? '').trim();
    if (!name) return;
    const teamForApi = player?.team
      ? (rosterTeamToInjuryTeam(String(player.team)) || footywireNicknameToOfficial(String(player.team)) || String(player.team))
      : '';
    const logsCacheKey = getAflPlayerLogsCacheKey(season, name, teamForApi);
    if (prefetchedLogsRef.current.has(logsCacheKey)) return;
    const teamQuery = teamForApi ? `&team=${encodeURIComponent(teamForApi)}` : '';
    const url = `/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(name)}${teamQuery}&include_both=1`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const games = Array.isArray(data?.games) ? (data.games as Record<string, unknown>[]) : [];
        const gamesWithQuarters = Array.isArray(data?.gamesWithQuarters) ? (data.gamesWithQuarters as Record<string, unknown>[]) : games;
        if (games.length === 0) return;
        const latest = games[games.length - 1];
        const numericKeys = new Set<string>();
        const numericMetaKeys = new Set(['season', 'game_number', 'guernsey']);
        for (const g of games) {
          for (const [k, v] of Object.entries(g)) {
            if (typeof v === 'number' && Number.isFinite(v) && !numericMetaKeys.has(k)) numericKeys.add(k);
          }
        }
        const toMerge: Partial<AflPlayerRecord> = { games_played: games.length };
        for (const key of numericKeys) {
          const values = games.map((g) => g[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          if (!values.length) continue;
          const total = values.reduce((s, v) => s + v, 0);
          const seasonAvg = Math.round((total / values.length) * 10) / 10;
          const lastGame = typeof latest[key] === 'number' && Number.isFinite(latest[key]) ? (latest[key] as number) : 0;
          const last5Values = values.slice(-5);
          const last5Avg = last5Values.length ? Math.round((last5Values.reduce((s, v) => s + v, 0) / last5Values.length) * 10) / 10 : 0;
          toMerge[`${key}_season_avg`] = seasonAvg;
          toMerge[`${key}_last_game`] = lastGame;
          toMerge[`${key}_last5_avg`] = last5Avg;
        }
        if (typeof latest.opponent === 'string') toMerge.last_opponent = latest.opponent;
        if (typeof latest.round === 'string') toMerge.last_round = latest.round;
        if (typeof latest.result === 'string') toMerge.last_result = latest.result;
        if (typeof latest.guernsey === 'number' && Number.isFinite(latest.guernsey)) toMerge.guernsey = latest.guernsey;
        if (typeof data?.height === 'string' && data.height.trim()) toMerge.height = data.height.trim();
        prefetchedLogsRef.current.set(logsCacheKey, {
          games: games as AflGameLogRecord[],
          gamesWithQuarters: gamesWithQuarters as AflGameLogRecord[],
          mergedStats: toMerge,
        });
      })
      .catch(() => {});
  }, [season]);

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
      ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || footywireNicknameToOfficial(String(selectedPlayer.team)) || String(selectedPlayer.team))
      : '';
    const logsCacheKey = getAflPlayerLogsCacheKey(season, String(playerName), teamForApi);
    const prefetched = prefetchedLogsRef.current.get(logsCacheKey);
    if (prefetched) {
      prefetchedLogsRef.current.delete(logsCacheKey);
      setSelectedPlayerGameLogs(prefetched.games);
      setSelectedPlayerGameLogsWithQuarters(prefetched.gamesWithQuarters);
      if (Object.keys(prefetched.mergedStats).length) {
        setSelectedPlayer((prev) => (prev ? ({ ...prev, ...prefetched.mergedStats } as AflPlayerRecord) : prev));
        playerStatsCacheRef.current.set(cacheKey, prefetched.mergedStats as AflPlayerRecord);
      }
      setStatsLoadingForPlayer(false);
      return;
    }
    try {
      const raw = localStorage.getItem(logsCacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CachedAflPlayerLogs;
        const isFresh = Number.isFinite(parsed?.createdAt) && (Date.now() - Number(parsed.createdAt) <= AFL_PLAYER_LOGS_CACHE_TTL_MS);
        if (isFresh && Array.isArray(parsed.games)) {
          setSelectedPlayerGameLogs(parsed.games);
          setSelectedPlayerGameLogsWithQuarters(Array.isArray(parsed.gamesWithQuarters) ? parsed.gamesWithQuarters : []);
          if (parsed.mergedStats && typeof parsed.mergedStats === 'object') {
            setSelectedPlayer((prev) => (prev ? { ...prev, ...parsed.mergedStats } : prev));
            playerStatsCacheRef.current.set(cacheKey, parsed.mergedStats);
          }
          setStatsLoadingForPlayer(false);
          return;
        }
      }
    } catch {
      // Ignore malformed local cache.
    }
    const teamQuery = teamForApi ? `&team=${encodeURIComponent(teamForApi)}` : '';
    const url = `/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(String(playerName))}${teamQuery}&include_both=1`;

    let cancelled = false;
    setStatsLoadingForPlayer(true);
    (async () => {
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLastStatsError(String(data?.error ?? 'Failed to load game logs'));
          setSelectedPlayerGameLogs([]);
          return;
        }
        const games = Array.isArray(data?.games) ? (data.games as Record<string, unknown>[]) : [];
        const gamesWithQuarters = Array.isArray(data?.gamesWithQuarters) ? (data.gamesWithQuarters as Record<string, unknown>[]) : games;
        setSelectedPlayerGameLogs(games);
        setSelectedPlayerGameLogsWithQuarters(gamesWithQuarters);
        if (games.length === 0) {
          setLastStatsError('No game logs found for this player/season');
          setStatsLoadingForPlayer(false);
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
        try {
          const cachePayload: CachedAflPlayerLogs = {
            createdAt: Date.now(),
            games,
            gamesWithQuarters,
            mergedStats: toMerge,
          };
          localStorage.setItem(logsCacheKey, JSON.stringify(cachePayload));
        } catch {
          // Ignore localStorage write failures.
        }
      } catch (e) {
        if (!cancelled) {
          setLastStatsError(e instanceof Error ? e.message : 'Failed to load game logs');
          setSelectedPlayerGameLogs([]);
        }
      } finally {
        if (!cancelled) setStatsLoadingForPlayer(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlayer?.name, selectedPlayer?.team, season]);

  // Fetch player position from AFL Fantasy positions list for top header context.
  useEffect(() => {
    const playerName = selectedPlayer?.name;
    if (!playerName) return;

    let cancelled = false;
    (async () => {
      try {
        const name = String(playerName).trim();
        const team = selectedPlayer?.team ? String(selectedPlayer.team).trim().toLowerCase() : '';
        const trySeasons = [season, 2025];

        for (const s of trySeasons) {
          const res = await fetch(
            `/api/afl/fantasy-positions?season=${s}&player=${encodeURIComponent(name)}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          const players = Array.isArray(data?.players) ? data.players : [];
          if (!players.length) continue;

          const exact = players.find((p: Record<string, unknown>) => {
            const n = String(p?.name ?? '').trim().toLowerCase();
            return n === name.toLowerCase();
          });
          const byTeam = team
            ? players.find((p: Record<string, unknown>) => String(p?.team ?? '').trim().toLowerCase() === team)
            : null;
          const chosen = exact ?? byTeam ?? players[0];
          const position = toDvpPositionLabel(chosen?.position);
          if (!position) continue;

          if (!cancelled) {
            setSelectedPlayer((prev) => (prev ? { ...prev, position } : prev));
          }
          break;
        }
      } catch {
        // ignore position lookup failures
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPlayer?.name, selectedPlayer?.team, season]);

  // Last round from game logs (so we can pass to next-game even before merge).
  const lastRoundFromLogs =
    selectedPlayerGameLogs.length > 0
      ? String((selectedPlayerGameLogs[selectedPlayerGameLogs.length - 1] as Record<string, unknown>)?.round ?? '')
      : '';

  const aflTeamGamePropsLogs = useMemo(() => {
    if (aflPropsMode !== 'team') return [];
    const source = selectedPlayerGameLogsWithQuarters.length > 0 ? selectedPlayerGameLogsWithQuarters : selectedPlayerGameLogs;
    return source.map((g, idx) => {
      const result = String(g.result ?? '').trim();
      const scores = parseAflScoresFromResult(result);
      const parsedGoals = parseAflGoalsFromResult(result);
      const teamGoals = toFiniteNumber(g.team_goals) ?? parsedGoals?.team ?? null;
      const opponentGoals = toFiniteNumber(g.opponent_goals) ?? parsedGoals?.opponent ?? null;
      const moneyline = result.toLowerCase().startsWith('w')
        ? 1
        : result.toLowerCase().startsWith('l')
          ? 0
          : null;

      const row: Record<string, unknown> = {
        round: g.round ?? '',
        opponent: g.opponent ?? '',
        result: g.result ?? '',
        date: g.date ?? g.game_date ?? '',
        game_number: typeof g.game_number === 'number' ? g.game_number : idx + 1,
        moneyline,
        total_goals: teamGoals != null && opponentGoals != null ? teamGoals + opponentGoals : null,
        spread: scores ? scores.opponent - scores.team : null,
        total_points: scores ? scores.team + scores.opponent : null,
      };

      for (const q of [1, 2, 3, 4] as const) {
        const teamQ =
          toFiniteNumber(g[`team_q${q}`]) ??
          toFiniteNumber(g[`q${q}_for`]) ??
          toFiniteNumber(g[`q${q}_team`]);
        const oppQ =
          toFiniteNumber(g[`opponent_q${q}`]) ??
          toFiniteNumber(g[`opp_q${q}`]) ??
          toFiniteNumber(g[`q${q}_against`]) ??
          toFiniteNumber(g[`q${q}_opp`]);
        const teamGoalQ =
          toFiniteNumber(g[`team_goal_q${q}`]) ??
          toFiniteNumber(g[`q${q}_team_goals`]) ??
          toFiniteNumber(g[`q${q}_goals_for`]);
        const oppGoalQ =
          toFiniteNumber(g[`opponent_goal_q${q}`]) ??
          toFiniteNumber(g[`q${q}_opp_goals`]) ??
          toFiniteNumber(g[`q${q}_goals_against`]);

        if (teamQ != null && oppQ != null) {
          row[`q${q}_total`] = teamQ + oppQ;
          row[`q${q}_spread`] = oppQ - teamQ;
        }
        if (teamGoalQ != null && oppGoalQ != null) {
          row[`q${q}_total_goals`] = teamGoalQ + oppGoalQ;
        }
      }

      return row;
    });
  }, [selectedPlayerGameLogs, selectedPlayerGameLogsWithQuarters, aflPropsMode]);

  // Fetch DVP batch and OA for game filters (player mode only). Use filter's dvpPosition so changing the dropdown refetches.
  const dvpSeason = Math.min(season, 2025);
  useEffect(() => {
    if (aflPropsMode !== 'player' || !selectedPlayer || selectedPlayerGameLogs.length === 0) {
      setAflFilterDataDvp(null);
      setAflFilterDataOa(null);
      return;
    }
    const pos = ['DEF', 'MID', 'FWD', 'RUC'].includes(aflGameFilters.dvpPosition) ? aflGameFilters.dvpPosition : 'MID';
    let cancelled = false;
    Promise.all([
      fetch(`/api/afl/dvp/batch?season=${dvpSeason}&position=${pos}&stats=disposals,kicks,marks,goals,tackles,clearances,inside_50s`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/afl/team-rankings?season=${dvpSeason}&type=oa`).then((r) => r.ok ? r.json() : null),
    ]).then(([dvpRes, oaRes]) => {
      if (cancelled) return;
      if (dvpRes?.success && dvpRes?.metrics) {
        setAflFilterDataDvp({ opponents: dvpRes.opponents || [], metrics: dvpRes.metrics });
      } else {
        setAflFilterDataDvp(null);
      }
      if (oaRes?.teams?.length) {
        setAflFilterDataOa({ teams: oaRes.teams });
      } else {
        setAflFilterDataOa(null);
      }
    }).catch(() => {
      if (!cancelled) {
        setAflFilterDataDvp(null);
        setAflFilterDataOa(null);
      }
    });
    return () => { cancelled = true; };
  }, [aflPropsMode, selectedPlayer?.id, selectedPlayerGameLogs.length, dvpSeason, aflGameFilters.dvpPosition]);

  // OA stat code -> game log key for fallback rankings from player's own games
  const OA_STAT_TO_GAME_KEY: Record<string, string> = {
    D: 'disposals',
    K: 'kicks',
    HB: 'handballs',
    M: 'marks',
    G: 'goals',
    T: 'tackles',
    CL: 'clearances',
    I50: 'inside_50s',
  };

  // Per-game filter data for the current player's games (DVP rank, opponent rank, TOG). Use API when available, else stale rankings from player's game log.
  const perGameFilterData = useMemo((): AflGameFilterDataItem[] | null => {
    if (!selectedPlayerGameLogs.length) return null;
    const dvp = aflFilterDataDvp;
    const oa = aflFilterDataOa;
    const metric = CHART_STAT_TO_DVP_METRIC[mainChartStat] ?? aflGameFilters.dvpMetric ?? 'disposals';
    const oaStat = CHART_STAT_TO_OA_CODE[mainChartStat] ?? aflGameFilters.opponentStat ?? 'D';

    const dvpRanksByOpp: Record<string, number> = {};
    if (dvp?.metrics?.[metric]?.teamTotalRanks) {
      for (const [teamRaw, rankRaw] of Object.entries(dvp.metrics[metric].teamTotalRanks)) {
        const rank = Number(rankRaw);
        const team = String(teamRaw ?? '').trim();
        if (!team || !Number.isFinite(rank)) continue;
        // Store multiple key variants so game-log opponent strings map to API rank keys reliably.
        dvpRanksByOpp[team] = rank;
        dvpRanksByOpp[team.toLowerCase()] = rank;
        const footy = opponentToFootywireTeam(team);
        if (footy) {
          dvpRanksByOpp[footy] = rank;
          dvpRanksByOpp[footy.toLowerCase()] = rank;
        }
        const official = opponentToOfficialTeamName(team) || (footy ? opponentToOfficialTeamName(footy) : null);
        if (official) {
          dvpRanksByOpp[official] = rank;
          dvpRanksByOpp[official.toLowerCase()] = rank;
        }
      }
    }

    const oaRankByTeam: Record<string, number> = {};
    if (oa?.teams?.length && oaStat) {
      const withStat = oa.teams
        .map((t) => ({ team: String(t.team ?? '').toLowerCase(), val: Number(t.stats?.[oaStat] ?? NaN) }))
        .filter((x) => Number.isFinite(x.val));
      withStat.sort((a, b) => a.val - b.val);
      withStat.forEach((x, i) => { oaRankByTeam[x.team] = i + 1; });
    }

    // Stale rankings from player's own game log: rank opponents by average stat in games vs them (lowest avg = rank 1 = toughest).
    const gameKeyForDvp = metric; // disposals, kicks, etc.
    const gameKeyForOa = OA_STAT_TO_GAME_KEY[oaStat] ?? 'disposals';
    const oppToSumCount: Record<string, { sum: number; count: number }> = {};
    for (const g of selectedPlayerGameLogs) {
      const opp = String((g as Record<string, unknown>)?.opponent ?? '').trim();
      if (!opp) continue;
      const norm = opp.toLowerCase();
      const valDvp = Number((g as Record<string, unknown>)?.[gameKeyForDvp]);
      const valOa = Number((g as Record<string, unknown>)?.[gameKeyForOa]);
      if (!oppToSumCount[norm]) oppToSumCount[norm] = { sum: 0, count: 0 };
      if (Number.isFinite(valDvp)) {
        oppToSumCount[norm].sum += valDvp;
        oppToSumCount[norm].count += 1;
      }
    }
    const staleDvpRanks: Record<string, number> = {};
    const entriesDvp = Object.entries(oppToSumCount)
      .map(([opp, { sum, count }]) => ({ opp, avg: count > 0 ? sum / count : NaN }))
      .filter((x) => Number.isFinite(x.avg));
    entriesDvp.sort((a, b) => a.avg - b.avg);
    entriesDvp.forEach(({ opp }, i) => { staleDvpRanks[opp] = i + 1; });

    const oppToSumCountOa: Record<string, { sum: number; count: number }> = {};
    for (const g of selectedPlayerGameLogs) {
      const opp = String((g as Record<string, unknown>)?.opponent ?? '').trim();
      if (!opp) continue;
      const norm = opp.toLowerCase();
      const val = Number((g as Record<string, unknown>)?.[gameKeyForOa]);
      if (!oppToSumCountOa[norm]) oppToSumCountOa[norm] = { sum: 0, count: 0 };
      if (Number.isFinite(val)) {
        oppToSumCountOa[norm].sum += val;
        oppToSumCountOa[norm].count += 1;
      }
    }
    const staleOppRanks: Record<string, number> = {};
    const entriesOa = Object.entries(oppToSumCountOa)
      .map(([opp, { sum, count }]) => ({ opp, avg: count > 0 ? sum / count : NaN }))
      .filter((x) => Number.isFinite(x.avg));
    entriesOa.sort((a, b) => a.avg - b.avg);
    entriesOa.forEach(({ opp }, i) => { staleOppRanks[opp] = i + 1; });

    return selectedPlayerGameLogs.map((g, gameIndex) => {
      const oppRaw = String((g as Record<string, unknown>)?.opponent ?? '').trim();
      const oppFooty = opponentToFootywireTeam(oppRaw) || oppRaw;
      const oppOfficial = opponentToOfficialTeamName(oppRaw) || oppRaw;
      const oppNorm = oppRaw.toLowerCase();
      const dvpRank =
        dvpRanksByOpp[oppRaw] ??
        dvpRanksByOpp[oppNorm] ??
        dvpRanksByOpp[oppFooty] ??
        dvpRanksByOpp[oppFooty.toLowerCase()] ??
        dvpRanksByOpp[oppOfficial] ??
        dvpRanksByOpp[oppOfficial.toLowerCase()] ??
        staleDvpRanks[oppNorm] ??
        null;
      const opponentRank =
        oaRankByTeam[oppNorm] ?? oaRankByTeam[oppFooty?.toLowerCase() ?? ''] ?? staleOppRanks[oppNorm] ?? null;
      const togRaw = (g as Record<string, unknown>)?.percent_played;
      const tog = typeof togRaw === 'number' && Number.isFinite(togRaw) ? togRaw : null;
      return { gameIndex, opponent: oppRaw, dvpRank, opponentRank, tog };
    });
  }, [selectedPlayerGameLogs, aflFilterDataDvp, aflFilterDataOa, mainChartStat, aflGameFilters.dvpMetric, aflGameFilters.opponentStat]);

  // Apply game filters to get the list of games used for chart and supporting stats.
  const filteredPlayerGameLogs = useMemo(() => {
    const withSourceIndex = (logs: AflGameLogRecord[]) =>
      logs.map((g, i) => ({ ...(g as Record<string, unknown>), __aflGameIndex: i }));

    if (aflPropsMode !== 'player' || !perGameFilterData?.length) return withSourceIndex(selectedPlayerGameLogs);
    const f = aflGameFilters;
    const hasDvp = f.dvpRankMin != null || f.dvpRankMax != null;
    const hasOpp = f.opponentRankMin != null || f.opponentRankMax != null;
    const hasTog = f.togMin != null || f.togMax != null;
    if (!hasDvp && !hasOpp && !hasTog) return withSourceIndex(selectedPlayerGameLogs);

    // When a filter is active, only include games that have that filter's data AND are in range. Exclude games missing data so the chart actually updates (e.g. DVP filter only shows games with DVP rank in range).
    const indices = new Set(
      perGameFilterData
        .filter((row) => {
          if (hasDvp) {
            if (row.dvpRank == null) return false;
            if (f.dvpRankMin != null && row.dvpRank < f.dvpRankMin) return false;
            if (f.dvpRankMax != null && row.dvpRank > f.dvpRankMax) return false;
          }
          if (hasOpp) {
            if (row.opponentRank == null) return false;
            if (f.opponentRankMin != null && row.opponentRank < f.opponentRankMin) return false;
            if (f.opponentRankMax != null && row.opponentRank > f.opponentRankMax) return false;
          }
          if (hasTog) {
            if (row.tog == null) return false;
            if (f.togMin != null && row.tog < f.togMin) return false;
            if (f.togMax != null && row.tog > f.togMax) return false;
          }
          return true;
        })
        .map((row) => row.gameIndex)
    );
    const filtered = selectedPlayerGameLogs
      .map((g, i) => ({ ...(g as Record<string, unknown>), __aflGameIndex: i }))
      .filter((g) => indices.has(Number((g as Record<string, unknown>).__aflGameIndex)));
    return filtered;
  }, [aflPropsMode, selectedPlayerGameLogs, perGameFilterData, aflGameFilters]);

  // When a team is selected in the Team dropdown, filter the chart to only games vs that opponent (so the dropdown visibly updates the chart).
  const chartGameLogsForPlayer = useMemo(() => {
    if (aflPropsMode !== 'player') return filteredPlayerGameLogs;
    if (!aflTeamFilter || aflTeamFilter === 'All' || aflTeamFilter.trim() === '') return filteredPlayerGameLogs;
    const officialTarget = aflTeamFilter.trim();
    return filteredPlayerGameLogs.filter((g) => {
      const opp = (g as Record<string, unknown>)?.opponent;
      if (opp == null || typeof opp !== 'string') return false;
      const resolved = opponentToOfficialTeamName(opp) || rosterTeamToInjuryTeam(opp) || opp.trim();
      return resolved === officialTarget;
    });
  }, [aflPropsMode, filteredPlayerGameLogs, aflTeamFilter]);

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

  const emptyText = mounted && isDark ? 'text-gray-500' : 'text-gray-400';
  const showEmptyShell = !selectedPlayer && !loadingPlayerFromUrl;
  const showStatsLoadingShell = loadingPlayerFromUrl || (!!selectedPlayer && (statsLoadingForPlayer || !chartDelayElapsed));

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
              onSignOutClick={async () => { await supabase.auth.signOut(); router.push('/'); }}
              onProfileUpdated={({ username: u, avatar_url: a }) => { if (u !== undefined) setUsername(u ?? null); if (a !== undefined) setAvatarUrl(a ?? null); }}
            />
            <div className="flex flex-col lg:flex-row gap-0 lg:gap-1 min-h-0">
              {/* Main content - same containers as NBA dashboard */}
              <div className={mainContentClassName} style={mainContentStyle}>
                {/* 1. Filter By (Mode toggle) - mobile only, at top; desktop Filter By is in right panel */}
                <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-3 md:px-4 pt-3 md:pt-4 pb-4 md:pb-5 border border-gray-200 dark:border-gray-700 relative overflow-visible">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                    <button
                      onClick={() => setAflPropsMode('player')}
                      className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        aflPropsMode === 'player'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Player Props
                    </button>
                    <button
                      onClick={() => setAflPropsMode('team')}
                      className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
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
                {/* 2. Header - same layout as NBA DashboardHeader: left (player/select), middle (matchup), bottom (Journal) */}
                <div className="relative z-[60] bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 w-full min-w-0 flex-shrink-0 mr-1 sm:mr-2 md:mr-3 overflow-visible" ref={searchDropdownRef}>
                  <div className="flex flex-col gap-2 lg:gap-3">
                    {/* Desktop: one row - player info (left) | team vs opponent (center) | spacer (right) */}
                    <div className="hidden lg:flex items-center flex-1">
                      <div className="flex-1 min-w-0">
                        {selectedPlayer ? (
                          <div>
                            {aflPropsMode === 'player' && (
                              <button
                                type="button"
                                onClick={() => {
                                  try {
                                    localStorage.removeItem(AFL_PAGE_STATE_KEY);
                                    sessionStorage.setItem('afl_back_to_props_clear_search', '1');
                                  } catch {}
                                  router.push('/props?sport=afl');
                                }}
                                className="flex items-center gap-1.5 mb-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                <span>Back to Player Props</span>
                              </button>
                            )}
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
                            {selectedPlayer.position ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                Position: {toDvpPositionLabel(selectedPlayer.position) ?? String(selectedPlayer.position)}
                              </div>
                            ) : null}
                            {selectedPlayer.height ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                Height: {heightCmToFeet(String(selectedPlayer.height)) ?? String(selectedPlayer.height)}
                              </div>
                            ) : null}
                          </div>
                        ) : loadingPlayerFromUrl ? (
                          <div className="min-w-0">
                            <div className="h-6 w-40 rounded animate-pulse bg-gray-300 dark:bg-gray-600 mb-1" />
                            <div className="h-3 w-24 rounded animate-pulse bg-gray-200 dark:bg-gray-700" />
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
                        })() : loadingPlayerFromUrl ? (
                          <div className="h-10 w-48 rounded-lg animate-pulse bg-gray-200 dark:bg-gray-700" />
                        ) : (
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                            <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0" aria-hidden />
                    </div>
                    {/* Mobile: Row 1 = Back + Player name | Tipoff (top right); Row 2 = Team/position | Team vs Opponent */}
                    <div className="lg:hidden flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-2 w-full">
                        <div className="flex-shrink-0 min-w-0">
                          {selectedPlayer ? (
                            <div>
                              {aflPropsMode === 'player' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    try {
                                      localStorage.removeItem(AFL_PAGE_STATE_KEY);
                                      sessionStorage.setItem('afl_back_to_props_clear_search', '1');
                                    } catch {}
                                    router.push('/props?sport=afl');
                                  }}
                                  className="flex items-center gap-1.5 mb-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                                >
                                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                  </svg>
                                  <span>Back to Player Props</span>
                                </button>
                              )}
                              <div className="flex items-baseline gap-3">
                                <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">{String(selectedPlayer.name ?? '—')}</h1>
                                {(() => {
                                  const num = selectedPlayer.guernsey != null && selectedPlayer.guernsey !== ''
                                    ? selectedPlayer.guernsey
                                    : selectedPlayerGameLogs.length > 0
                                      ? (selectedPlayerGameLogs[selectedPlayerGameLogs.length - 1] as Record<string, unknown>)?.guernsey
                                      : null;
                                  return num != null && num !== '' ? (
                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex-shrink-0">#{String(num)}</span>
                                  ) : null;
                                })()}
                              </div>
                            </div>
                          ) : loadingPlayerFromUrl ? (
                            <div className="min-w-0 flex-1">
                              <div className="h-6 w-36 rounded animate-pulse bg-gray-300 dark:bg-gray-600" />
                            </div>
                          ) : (
                            <div>
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Select a Player</h1>
                            </div>
                          )}
                        </div>
                        {/* Mobile: tipoff in top right, faint box, stays inside container */}
                        {selectedPlayer && displayOpponent && (
                          <div className="flex-shrink-0 min-w-0 max-w-[45%] overflow-hidden">
                            <div className={`rounded-lg border px-2 py-1.5 text-right ${
                              isDark
                                ? 'bg-gray-800/40 border-gray-600/60'
                                : 'bg-gray-100/80 border-gray-300/70'
                            }`}>
                              {countdown && !isGameInProgress ? (
                                <div className="flex flex-col items-end">
                                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Bounce in</div>
                                  <div className="text-xs font-mono font-semibold text-gray-900 dark:text-white tabular-nums">
                                    {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                                  </div>
                                </div>
                              ) : isGameInProgress ? (
                                <div className="text-xs font-semibold text-green-600 dark:text-green-400">LIVE</div>
                              ) : nextGameTipoff ? (
                                <div className="text-[10px] text-gray-500 dark:text-gray-400">Game time passed</div>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="lg:hidden flex items-center justify-between gap-2">
                        <div className="flex-shrink-0 min-w-0">
                          {selectedPlayer ? (
                            <div>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {selectedPlayer.team ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || String(selectedPlayer.team)) : '—'}
                              </div>
                              {selectedPlayer.position && (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {toDvpPositionLabel(selectedPlayer.position) ?? String(selectedPlayer.position)}
                                </div>
                              )}
                              {selectedPlayer.height && (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {heightCmToFeet(String(selectedPlayer.height)) ?? String(selectedPlayer.height)}
                                </div>
                              )}
                            </div>
                          ) : loadingPlayerFromUrl ? (
                            <div className="space-y-1">
                              <div className="h-3 w-20 rounded animate-pulse bg-gray-200 dark:bg-gray-700" />
                              <div className="h-3 w-16 rounded animate-pulse bg-gray-200 dark:bg-gray-700" />
                            </div>
                          ) : (
                            <div className="text-xs text-gray-600 dark:text-gray-400">Search for a player below</div>
                          )}
                        </div>
                        <div className="flex-shrink-0 min-w-0">
                          {selectedPlayer?.team ? (
                            (() => {
                              const teamFull = rosterTeamToInjuryTeam(String(selectedPlayer!.team)) || String(selectedPlayer!.team);
                              const opponentFull = displayOpponent ? (opponentToOfficialTeamName(displayOpponent) || displayOpponent) : '—';
                              const teamLogo = resolveTeamLogo(teamFull, logoByTeam);
                              const opponentLogo = opponentFull !== '—' ? resolveTeamLogo(opponentFull, logoByTeam) : null;
                              return (
                                <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-3 sm:py-2 min-w-0">
                                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                    <div className="flex items-center gap-1 min-w-0">
                                      {teamLogo ? (
                                        <img src={teamLogo} alt={teamFull} className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0" style={{ filter: isDark ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))' : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))' }} />
                                      ) : null}
                                      <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{teamFull}</span>
                                    </div>
                                    <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                                    <div className="flex items-center gap-1 min-w-0">
                                      {displayOpponent && opponentFull !== '—' ? (
                                        <>
                                          {opponentLogo ? (
                                            <img src={opponentLogo} alt={opponentFull} className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0" style={{ filter: isDark ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))' : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))' }} />
                                          ) : null}
                                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{opponentFull}</span>
                                        </>
                                      ) : (
                                        <span className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm truncate">—</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()
                          ) : loadingPlayerFromUrl ? (
                            <div className="h-9 w-32 rounded-lg animate-pulse bg-gray-200 dark:bg-gray-700" />
                          ) : (
                            <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                              <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Search row - full width on mobile, below title on desktop */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2 lg:mt-0">
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
                                    onMouseEnter={() => prefetchPlayerLogs(p)}
                                    onClick={() => {
                                      setSelectedPlayer(p);
                                      setSelectedPlayerGameLogs([]);
                                      setSelectedPlayerGameLogsWithQuarters([]);
                                      setStatsLoadingForPlayer(true);
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
                                    {(p.guernsey != null && p.guernsey !== '') && (
                                      <span className={`ml-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        #{String(p.guernsey)}
                                      </span>
                                    )}
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
                    {/* Journal button - same as NBA: open AddToJournalModal, disabled when game in progress */}
                    {selectedPlayer && (selectedPlayer.team || selectedPlayerGameLogs.length > 0) && nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== '—' && nextGameTipoff && (
                      <div className="flex gap-2 px-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isPro) {
                              router.push('/subscription');
                              return;
                            }
                            if (!isGameInProgress) {
                              setShowJournalModal(true);
                            }
                          }}
                          disabled={isGameInProgress || !isPro}
                          className={`flex-1 px-2 py-1.5 text-white text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                            isGameInProgress || !isPro
                              ? 'bg-gray-400 cursor-not-allowed opacity-50'
                              : 'bg-purple-600 hover:bg-purple-700'
                          }`}
                          title={
                            !isPro
                              ? 'Journal is a Pro feature'
                              : isGameInProgress
                                ? 'Game in progress - journal disabled'
                                : 'Add to journal'
                          }
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
                  className={`chart-container-no-focus relative z-10 rounded-lg shadow-sm p-0 sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0 border h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${
                    showEmptyShell
                      ? 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                      : 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                  }`}
                  style={{ outline: 'none', boxShadow: 'none' }}
                >
                  {showEmptyShell ? (
                    <div className="h-full w-full" />
                  ) : showStatsLoadingShell ? (
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
                                className={`w-full rounded-t animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
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
                  ) : (
                    <>
                      <AflStatsChart
                        stats={selectedPlayer ?? {}}
                        gameLogs={aflPropsMode === 'team' ? aflTeamGamePropsLogs : chartGameLogsForPlayer}
                        allGameLogs={aflPropsMode === 'team' ? aflTeamGamePropsLogs : selectedPlayerGameLogs}
                        isDark={!!mounted && isDark}
                        logoByTeam={logoByTeam}
                        isLoading={(playersLoading && !selectedPlayer) || statsLoadingForPlayer}
                        hasSelectedPlayer={!!selectedPlayer}
                        apiErrorHint={lastStatsError}
                        teammateFilterName={aflPropsMode === 'team' ? null : teammateFilterName}
                        nextOpponent={aflPropsMode === 'player' && displayOpponent ? (opponentToOfficialTeamName(displayOpponent) || displayOpponent) : null}
                        withWithoutMode={aflPropsMode === 'team' ? 'with' : withWithoutMode}
                        season={season}
                        clearTeammateFilter={aflPropsMode === 'team' ? undefined : () => {
                          setTeammateFilterName(null);
                          setWithWithoutMode('with');
                        }}
                        selectedStat={mainChartStat}
                        selectedTimeframe={aflChartTimeframe}
                        onTimeframeChange={setAflChartTimeframe}
                        onSelectedStatChange={setMainChartStat}
                        showAdvancedFilters={aflPropsMode === 'player' ? showAdvancedFilters : false}
                        setShowAdvancedFilters={aflPropsMode === 'player' ? setShowAdvancedFilters : undefined}
                        aflGameFilters={aflPropsMode === 'player' ? aflGameFilters : undefined}
                        setAflGameFilters={aflPropsMode === 'player' ? setAflGameFilters : undefined}
                        perGameFilterData={aflPropsMode === 'player' ? perGameFilterData : null}
                        playerPositionForFilters={aflPropsMode === 'player' && selectedPlayer?.position ? String(selectedPlayer.position) : null}
                        slotRightOfControls={
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'} whitespace-nowrap`}>Team</span>
                            <select
                              value={aflTeamFilter}
                              onChange={(e) => setAflTeamFilter(e.target.value)}
                              className={`h-[32px] min-w-[120px] max-w-[160px] rounded-xl border px-2 py-1.5 text-xs font-medium bg-white dark:bg-[#0a1929] border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500`}
                            >
                              {AFL_TEAM_FILTER_OPTIONS.map((team) => (
                                <option key={team} value={team}>{team}</option>
                              ))}
                            </select>
                          </div>
                        }
                        slotLeftOfLine={aflPropsMode === 'player' ? (
                          <AflLineSelector
                            books={aflPlayerPropsBooks}
                            selectedStat="total_goals"
                            selectedBookIndex={selectedAflBookIndex}
                            onSelectBookIndex={setSelectedAflBookIndex}
                            oddsFormat={oddsFormat}
                            isDark={!!mounted && isDark}
                            homeTeam={aflOddsHomeTeam}
                            awayTeam={aflOddsAwayTeam}
                            playerPropColumn={CHART_STAT_TO_PLAYER_PROP_COLUMN[mainChartStat]}
                            selectedDisposalsColumn={mainChartStat === 'disposals' ? selectedAflDisposalsColumn : undefined}
                            onSelectDisposalsOption={mainChartStat === 'disposals' ? (bookIndex: number, column: 'Disposals' | 'DisposalsOver') => {
                              setSelectedAflBookIndex(bookIndex);
                              setSelectedAflDisposalsColumn(column);
                            } : undefined}
                            onSelectGoalsOption={mainChartStat === 'goals' ? (bookIndex: number, lineValue: number) => {
                              setSelectedAflBookIndex(bookIndex);
                              ignoreNextTransientLineRef.current = true;
                              setAflCurrentLineValue(lineValue);
                            } : undefined}
                            currentLineValue={aflCurrentLineValue}
                          />
                        ) : aflPropsMode === 'team' ? (
                          aflOddsLoading ? (
                            <div className={`h-8 w-[100px] sm:w-[110px] md:w-[120px] rounded-lg animate-pulse flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                          ) : (
                            <AflLineSelector
                              books={aflOddsBooks}
                              selectedStat={
                                mainChartStat === 'moneyline' || mainChartStat === 'spread' || mainChartStat === 'total_goals' || mainChartStat === 'total_points' || /^q[1-4]_(total|spread|total_goals)$/.test(mainChartStat)
                                  ? (mainChartStat as 'moneyline' | 'spread' | 'total_goals' | 'total_points' | 'q1_total' | 'q1_spread' | 'q1_total_goals' | 'q2_total' | 'q2_spread' | 'q2_total_goals' | 'q3_total' | 'q3_spread' | 'q3_total_goals' | 'q4_total' | 'q4_spread' | 'q4_total_goals')
                                  : 'moneyline'
                              }
                              selectedBookIndex={selectedAflBookIndex}
                              onSelectBookIndex={setSelectedAflBookIndex}
                              oddsFormat={oddsFormat}
                              isDark={!!mounted && isDark}
                              homeTeam={aflOddsHomeTeam}
                              awayTeam={aflOddsAwayTeam}
                              disabled={!selectedPlayer}
                              currentLineValue={
                                mainChartStat === 'spread' || mainChartStat === 'total_points'
                                  ? aflGameLineValue ?? undefined
                                  : undefined
                              }
                            />
                          )
                        ) : undefined}
                        externalLineValue={(() => {
                          if (aflPropsMode === 'player') {
                            const col = effectivePlayerPropColumn;
                            if (!col) return 0.5;
                            const book = aflPlayerPropsBooks[selectedAflBookIndex];
                            if (mainChartStat === 'goals' && aflCurrentLineValue != null && Number.isFinite(aflCurrentLineValue)) {
                              return aflCurrentLineValue;
                            }
                            const lineStr = col === 'GoalsOver' && book ? getGoalsMarketLineOver(book)?.line : (book?.[col] as { line?: string } | undefined)?.line;
                            if (!lineStr || lineStr === 'N/A') return 0.5;
                            const n = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
                            return Number.isFinite(n) ? n : 0.5;
                          }
                          if (aflPropsMode === 'team') {
                            if (/^q[1-4]_(total|spread|total_goals)$/.test(mainChartStat)) return 0.5;
                            const book = aflOddsBooks[selectedAflBookIndex];
                            if (!book) return 0.5;
                            if (mainChartStat === 'spread') {
                              const lineStr = book.Spread?.line;
                              if (!lineStr || lineStr === 'N/A') return 0.5;
                              const n = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
                              return Number.isFinite(n) ? n : 0.5;
                            }
                            if (mainChartStat === 'total_points') {
                              const lineStr = book.Total?.line;
                              if (!lineStr || lineStr === 'N/A') return 0.5;
                              const n = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
                              return Number.isFinite(n) ? n : 0.5;
                            }
                            if (mainChartStat === 'total_goals') return undefined; // book Total is points, not goals — no odds line
                            return 0.5;
                          }
                          return undefined;
                        })()}
                      />
                    </>
                  )}
                </div>
                {/* 4. Supporting stats - no gap, flush with chart; hidden in Game Props (mobile shows Opponent Breakdown only below) */}
                {aflPropsMode === 'player' && (
                  <div className="w-full min-w-0 flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4 border border-gray-200 dark:border-gray-700">
                    {showEmptyShell ? (
                      <div className="min-h-[220px]" />
                    ) : showStatsLoadingShell ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="space-y-3 w-full max-w-md">
                          <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'} mx-auto`}></div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.1s' }}></div>
                            <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.2s' }}></div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className={`text-sm font-semibold mb-1 px-3 sm:px-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                          Supporting stats
                        </h3>
                        <AflSupportingStats
                          gameLogs={chartGameLogsForPlayer}
                          timeframe={aflChartTimeframe}
                          season={season}
                          mainChartStat={mainChartStat}
                          supportingStatKind={supportingStatKind}
                          onSupportingStatKindChange={setSupportingStatKind}
                          isDark={!!mounted && isDark}
                        />
                      </>
                    )}
                  </div>
                )}
                {/* 4.5. DVP | Opponent Breakdown | Compare - mobile only; same container for Player and Game Props (desktop uses right panel) */}
                {(aflPropsMode === 'player' || aflPropsMode === 'team') && (
                  <div className="lg:hidden w-full min-w-0 flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-4 md:p-4 border border-gray-200 dark:border-gray-700 max-h-[60vh] min-h-0">
                    <div className="flex gap-2 sm:gap-2 mb-3 flex-shrink-0">
                      {aflPropsMode === 'player' && (
                        <>
                          <button
                            onClick={() => {
                              setAflRightTab('dvp');
                              setAflRightTabsVisited((prev) => new Set(prev).add('dvp'));
                            }}
                            className={`relative flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                              aflRightTab === 'dvp'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            DVP
                            <span
                              className={`absolute -top-1.5 -right-1.5 h-5 min-w-[72px] px-1.5 rounded-full border text-[9px] leading-4 font-bold flex items-center justify-center whitespace-nowrap ${
                                isDark ? 'bg-emerald-900 border-emerald-500/60 text-emerald-100' : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                              }`}
                            >
                              90% accuracy
                            </span>
                          </button>
                          <button
                            onClick={() => {
                              setAflRightTab('breakdown');
                              setAflRightTabsVisited((prev) => new Set(prev).add('breakdown'));
                            }}
                            className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                              aflRightTab === 'breakdown'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Opponent Breakdown
                          </button>
                          <button
                            onClick={() => {
                              setAflRightTab('rank');
                              setAflRightTabsVisited((prev) => new Set(prev).add('rank'));
                            }}
                            className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                              aflRightTab === 'rank'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Compare
                          </button>
                        </>
                      )}
                      {aflPropsMode === 'team' && (
                        <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                          Opponent Breakdown
                        </h3>
                      )}
                    </div>
                    {(showEmptyShell || showStatsLoadingShell) && aflPropsMode === 'player' ? (
                      <div className="flex-1 min-h-0 flex items-center justify-center">
                        <div className={`text-sm ${emptyText}`}>Select a player to view</div>
                      </div>
                    ) : (
                      <div className="relative flex-1 min-h-0 w-full min-w-0 flex flex-col overflow-y-auto">
                        {aflRightTab === 'breakdown' && (
                          <div className="flex flex-col min-h-0">
                            <AflOpponentBreakdownCard
                              key={displayOpponent ?? 'no-opponent'}
                              isDark={!!mounted && isDark}
                              season={season}
                              playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                              lastOpponent={displayOpponent ?? null}
                            />
                          </div>
                        )}
                        {aflPropsMode === 'player' && aflRightTab === 'rank' && (
                          <div className="flex flex-col min-h-0">
                            <AflLeagueRankingCard
                              isDark={!!mounted && isDark}
                              season={season}
                              playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                              playerTeam={selectedPlayer?.team ? String(selectedPlayer.team) : null}
                              playerStats={selectedPlayer ?? null}
                            />
                          </div>
                        )}
                        {aflPropsMode === 'player' && aflRightTab === 'dvp' && (
                          <div className="flex flex-col min-h-0 overflow-y-auto">
                            <AflDvpCard
                              isDark={!!mounted && isDark}
                              season={Math.min(season, 2025)}
                              playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                              opponentTeam={displayOpponent || ''}
                              logoByTeam={logoByTeam}
                              playerPosition={
                                selectedPlayer?.position && ['DEF', 'MID', 'FWD', 'RUC'].includes(String(selectedPlayer.position))
                                  ? (selectedPlayer.position as 'DEF' | 'MID' | 'FWD' | 'RUC')
                                  : undefined
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* 4.6. Team list / Injuries - mobile only; desktop uses right panel */}
                {aflPropsMode === 'player' && (
                  <div
                    className={`lg:hidden rounded-lg shadow-sm p-3 sm:p-4 border w-full min-w-0 bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700 flex flex-col max-h-[50vh] min-h-0`}
                  >
                    {showEmptyShell || showStatsLoadingShell ? (
                      <div className="flex-1 min-h-0 flex items-center justify-center">
                        <div className={`text-sm ${emptyText}`}>Select a player to view</div>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-1.5 sm:gap-2 mb-2 sm:mb-3 flex-shrink-0">
                          <button
                            onClick={() => {
                              setAflLowerTab('lineup');
                              setAflLowerTabsVisited((prev) => new Set(prev).add('lineup'));
                            }}
                            className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs font-medium rounded-lg transition-colors border ${
                              aflLowerTab === 'lineup'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Team list
                          </button>
                          <button
                            onClick={() => {
                              setAflLowerTab('injuries');
                              setAflLowerTabsVisited((prev) => new Set(prev).add('injuries'));
                            }}
                            className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs font-medium rounded-lg transition-colors border ${
                              aflLowerTab === 'injuries'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Injuries
                          </button>
                        </div>
                        <div className="relative flex-1 min-h-0 w-full min-w-0 flex flex-col overflow-y-auto overscroll-contain max-h-[calc(50vh-4rem)]">
                          {aflLowerTab === 'lineup' && (
                            <div className="flex flex-col min-w-0">
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
                          {aflLowerTab === 'injuries' && (
                            <div className="flex flex-col min-w-0">
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
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {/* 4.7. AFL Ladder - mobile only; desktop uses right panel */}
                <div className="lg:hidden w-full min-w-0 rounded-lg shadow-sm p-3 sm:p-4 border bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700">
                  <AflLadderCard isDark={!!mounted && isDark} season={Math.min(season, 2025)} logoByTeam={logoByTeam} />
                </div>
                {/* 5. Game Log (Box Score) - same as NBA PlayerBoxScore, player mode only */}
                {aflPropsMode === 'player' && (
                  <div className="w-full min-w-0 pb-6 lg:pb-0">
                    <AflBoxScore
                      gameLogs={selectedPlayerGameLogs}
                      isDark={!!mounted && isDark}
                      selectedPlayer={selectedPlayer}
                      isLoading={statsLoadingForPlayer}
                      resolveTeamLogo={(teamName) => resolveTeamLogo(teamName, logoByTeam)}
                    />
                  </div>
                )}
              </div>
              {/* Right panel - Filter By (Player / Game props) + Opponent Breakdown & Injuries (same as NBA DashboardRightPanel) */}
              <div className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 fade-scrollbar custom-scrollbar min-w-0 ${
                sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
              }`}>
                {/* Filter By - Player Props / Game Props (desktop only; mobile uses the one at top of main content) */}
                <div className={`hidden lg:block rounded-lg shadow-sm px-3 pt-3 pb-4 border relative overflow-visible ${
                  showEmptyShell
                    ? 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                    : 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                }`}>
                  {showEmptyShell ? (
                    <div className="h-[96px]" />
                  ) : showStatsLoadingShell ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="space-y-3 w-full max-w-md">
                        <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'} mx-auto`}></div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className={`h-10 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.1s' }}></div>
                          <div className={`h-10 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.2s' }}></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
                {/* DVP | Opponent Breakdown | Compare - desktop right panel */}
                <div
                  className={`hidden lg:block rounded-lg shadow-sm p-2 xl:p-3 border w-full min-w-0 ${
                    showEmptyShell
                      ? 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                      : 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {showEmptyShell ? (
                    <div className="h-[420px]" />
                  ) : showStatsLoadingShell ? (
                    <div className="flex items-center justify-center h-[420px]">
                      <div className="space-y-3 w-full max-w-md px-2">
                        <div className={`h-4 w-36 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'} mx-auto`}></div>
                        <div className={`h-10 w-full rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.1s' }}></div>
                        <div className={`h-10 w-full rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.2s' }}></div>
                        <div className={`h-10 w-full rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.3s' }}></div>
                        <div className={`h-44 w-full rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.4s' }}></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-1.5 xl:gap-2 mb-2 xl:mb-3">
                        {aflPropsMode === 'player' && (
                          <button
                            onClick={() => {
                              setAflRightTab('dvp');
                              setAflRightTabsVisited((prev) => new Set(prev).add('dvp'));
                            }}
                            className={`relative flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                              aflRightTab === 'dvp'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            DVP
                            <span
                              className={`absolute -top-1.5 -right-1.5 h-5 min-w-[72px] px-1.5 rounded-full border text-[9px] leading-4 font-bold flex items-center justify-center whitespace-nowrap ${
                                isDark
                                  ? 'bg-emerald-900 border-emerald-500/60 text-emerald-100'
                                  : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                              }`}
                            >
                              90% accuracy
                            </span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setAflRightTab('breakdown');
                            setAflRightTabsVisited((prev) => new Set(prev).add('breakdown'));
                          }}
                          className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                            aflRightTab === 'breakdown'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Opponent Breakdown
                        </button>
                        {aflPropsMode === 'player' && (
                          <button
                            onClick={() => {
                              setAflRightTab('rank');
                              setAflRightTabsVisited((prev) => new Set(prev).add('rank'));
                            }}
                            className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                              aflRightTab === 'rank'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Compare
                          </button>
                        )}
                      </div>
                      <div className="relative h-[380px] xl:h-[420px] w-full min-w-0 flex flex-col min-h-0">
                        {((aflPropsMode === 'team' && aflRightTab === 'breakdown') || (aflPropsMode === 'player' && aflRightTabsVisited.has('breakdown'))) && (
                          <div className={aflRightTab === 'breakdown' ? 'flex flex-col h-full min-h-0' : 'hidden'}>
                            <AflOpponentBreakdownCard
                              key={displayOpponent ?? 'no-opponent'}
                              isDark={!!mounted && isDark}
                              season={season}
                              playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                              lastOpponent={displayOpponent ?? null}
                            />
                          </div>
                        )}
                        {aflPropsMode === 'player' && aflRightTabsVisited.has('rank') && (
                          <div className={aflRightTab === 'rank' ? 'flex flex-col h-full min-h-0' : 'hidden'}>
                            <AflLeagueRankingCard
                              isDark={!!mounted && isDark}
                              season={season}
                              playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                              playerTeam={selectedPlayer?.team ? String(selectedPlayer.team) : null}
                              playerStats={selectedPlayer ?? null}
                            />
                          </div>
                        )}
                        {aflPropsMode === 'player' && aflRightTabsVisited.has('dvp') && (
                          <div className={aflRightTab === 'dvp' ? 'flex-1 min-h-0 overflow-y-auto flex flex-col' : 'hidden'}>
                            <AflDvpCard
                              isDark={!!mounted && isDark}
                              season={Math.min(season, 2025)}
                              playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                              opponentTeam={displayOpponent || ''}
                              logoByTeam={logoByTeam}
                              playerPosition={
                                selectedPlayer?.position && ['DEF', 'MID', 'FWD', 'RUC'].includes(String(selectedPlayer.position))
                                  ? (selectedPlayer.position as 'DEF' | 'MID' | 'FWD' | 'RUC')
                                  : undefined
                              }
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {/* Team list / Injuries - desktop right panel */}
                <div
                  className={`hidden lg:block rounded-lg shadow-sm p-2 xl:p-3 pb-12 xl:pb-14 border w-full min-w-0 ${
                    showEmptyShell
                      ? 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                      : 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {showEmptyShell ? (
                    <div className="h-[320px]" />
                  ) : showStatsLoadingShell ? (
                    <div className="flex items-center justify-center h-[320px]">
                      <div className="space-y-3 w-full max-w-md px-2">
                        <div className={`h-4 w-36 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'} mx-auto`}></div>
                        <div className={`h-10 w-full rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.1s' }}></div>
                        <div className={`h-44 w-full rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-1.5 xl:gap-2 mb-2 xl:mb-3">
                        <button
                          onClick={() => {
                            setAflLowerTab('lineup');
                            setAflLowerTabsVisited((prev) => new Set(prev).add('lineup'));
                          }}
                          className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                            aflLowerTab === 'lineup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team list
                        </button>
                        <button
                          onClick={() => {
                            setAflLowerTab('injuries');
                            setAflLowerTabsVisited((prev) => new Set(prev).add('injuries'));
                          }}
                          className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                            aflLowerTab === 'injuries'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Injuries
                        </button>
                      </div>
                      <div className="relative h-[320px] w-full min-w-0 flex flex-col min-h-0">
                        {aflLowerTabsVisited.has('lineup') && (
                          <div className={aflLowerTab === 'lineup' ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : 'hidden'}>
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
                        {aflLowerTabsVisited.has('injuries') && (
                          <div className={aflLowerTab === 'injuries' ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : 'hidden'}>
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
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {/* AFL Ladder - desktop right panel */}
                <div
                  className={`hidden lg:block rounded-lg shadow-sm p-2 xl:p-3 border w-full min-w-0 mt-0 ${
                    showEmptyShell
                      ? 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                      : 'bg-white dark:bg-[#0a1929] border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <AflLadderCard isDark={!!mounted && isDark} season={Math.min(season, 2025)} logoByTeam={logoByTeam} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Journal modal - same as NBA: AddToJournalModal with player/team/opponent/gameDate */}
      {selectedPlayer && nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== '—' && nextGameTipoff && (
        <Suspense fallback={null}>
          <AddToJournalModal
            isOpen={showJournalModal}
            onClose={() => setShowJournalModal(false)}
            playerName={String(selectedPlayer?.name ?? '')}
            playerId={String(selectedPlayer?.id ?? selectedPlayer?.name ?? '')}
            team={rosterTeamToInjuryTeam(String(selectedPlayer?.team ?? '')) || String(selectedPlayer?.team ?? '')}
            opponent={nextGameOpponent}
            gameDate={nextGameTipoff.toISOString().split('T')[0]}
            oddsFormat={oddsFormat}
            isGameProp={aflPropsMode === 'team'}
            sport="afl"
          />
        </Suspense>
      )}
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
