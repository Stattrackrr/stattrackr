'use client';

import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { LoadingBar } from '@/app/nba/research/dashboard/components/LoadingBar';
import { AflStatsChart, type AflChartTimeframe } from '@/app/afl/components/AflStatsChart';
import { AflInjuriesCard } from '@/app/afl/components/AflInjuriesCard';
import AflOpponentBreakdownCard from '@/app/afl/components/AflOpponentBreakdownCard';
import AflTeamMatchupCard from '@/app/afl/components/AflTeamMatchupCard';
import { DEFAULT_AFL_GAME_FILTERS, type AflGameFiltersState, type AflGameFilterDataItem } from '@/app/afl/components/AflGameFilters';
import { AflTeamSelectionsCard } from '@/app/afl/components/AflTeamSelectionsCard';
import AflDvpCard from '@/app/afl/components/AflDvpCard';
import { AflLadderCard, getTeamAbbrev } from '@/app/afl/components/AflLadderCard';
import { AflBoxScore } from '@/app/afl/components/AflBoxScore';
import { AflSidebarHotPicks } from '@/app/afl/components/AflSidebarHotPicks';
import { AflSupportingStats, type SupportingStatKind } from '@/app/afl/components/AflSupportingStats';
import { type AflBookRow, type AflPropLine, type AflPropOverOnly, type AflPropYesNo, getGoalsMarketLineOver, getGoalsMarketLines } from '@/app/afl/components/AflBestOddsTable';
import { AflLineSelector } from '@/app/afl/components/AflLineSelector';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import { getBookmakerInfo } from '@/lib/bookmakers';
import { ImpliedOddsWheel } from '@/app/nba/research/dashboard/components/odds/ImpliedOddsWheel';

/** Map chart stat to Best Odds player-prop column for the line selector in player mode. Use O/U columns (e.g. Disposals) where available so Over and Under both appear. */
const CHART_STAT_TO_PLAYER_PROP_COLUMN: Partial<Record<string, keyof Pick<AflBookRow, 'Disposals' | 'DisposalsOver' | 'AnytimeGoalScorer' | 'GoalsOver' | 'MarksOver' | 'TacklesOver'>>> = {
  disposals: 'Disposals', // O/U so both Over and Under show; use DisposalsOver only for over-only view
  goals: 'GoalsOver',
  marks: 'MarksOver',
  tackles: 'TacklesOver',
};

import { rosterTeamToInjuryTeam, footywireNicknameToOfficial, opponentToOfficialTeamName, opponentToFootywireTeam, toOfficialAflTeamDisplayName, ROSTER_TEAM_TO_INJURY_TEAM } from '@/lib/aflTeamMapping';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';

const AddToJournalModal = lazy(() => import('@/components/AddToJournalModal').then((mod) => ({ default: mod.default })));
import { supabase } from '@/lib/supabaseClient';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { Search, Loader2 } from 'lucide-react';
import { dfsRoleGroupToShortLabel as dfsRoleGroupToHeaderLabel } from '@/lib/aflDfsRoleLabels';
import { buildAflJournalQuickPreset } from '@/lib/buildAflJournalQuickPreset';
import { playerHasFootywireSlugOverride } from '@/lib/aflFootywireSlugOverrides';

/** Match /props player cards: purple-tint border + soft violet outer glow (light + dark). */
const AFL_DASH_CARD_GLOW =
  'border border-gray-200 dark:border-[#463e6b] bg-white dark:bg-[#0a1929] shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_20px_rgba(124,58,237,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22),0_0_36px_rgba(124,58,237,0.22)]';

type AflPlayerRecord = Record<string, string | number>;
type AflGameLogRecord = Record<string, unknown>;
type TeamRankStatKey =
  | 'disposals'
  | 'kicks'
  | 'handballs'
  | 'goals'
  | 'uncontested_possessions'
  | 'contested_possessions'
  | 'free_kicks_for'
  | 'meters_gained';
type AflLeaguePlayerTeamRankRow = {
  name: string;
  team: string;
  games: number;
  disposals?: number;
  kicks?: number;
  handballs?: number;
  goals?: number;
  uncontested_possessions?: number;
  contested_possessions?: number;
  free_kicks_for?: number;
  meters_gained?: number;
};
type AflHistoricalRankSnapshot = {
  snapshotDate: string;
  ranks: Record<string, number>;
};
type AflTeamRankingRow = {
  rank: number | null;
  team: string;
  stats: Record<string, number | string | null>;
};
type AflDisposalsModelProjection = {
  expectedDisposals: number;
  sigma: number;
  pOver: number;
  pUnder: number;
  modelLine?: number | null;
  marketPOver: number | null;
  edgeVsMarket: number | null;
  edgeVsMarketUnder?: number | null;
  recommendedSide?: 'OVER' | 'UNDER' | null;
  recommendedEdge?: number | null;
  recommendedProb?: number | null;
  isRecommendedPick?: boolean;
  isTop3PickInGame?: boolean;
  recommendedPlayerRankInGame?: number | null;
  gameKey?: string | null;
  modelVersion: string | null;
  scoredAt: string | null;
};
type AflTopGamePick = {
  playerName: string;
  bookmaker: string | null;
  line: number | null;
  expectedDisposals: number | null;
  recommendedSide: 'OVER' | 'UNDER' | null;
  recommendedEdge: number | null;
  recommendedProb: number | null;
  rank: number | null;
};
const MODEL_NEUTRAL_LINE_GAP = 0.5; // Neutral when model is within 0.5 disposals of line
/** When true, the Player vs Team "Prediction Model" tab is disabled (under maintenance). */
const AFL_PREDICTION_MODEL_UNDER_MAINTENANCE = true;
type AflTopPicksGameGroup = {
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
  picks: AflTopGamePick[];
};
type AflDisposalsPastLineRow = {
  snapshotKey?: string;
  gameDate?: string;
  bookmaker?: string;
  line?: number;
  modelExpectedDisposals?: number | null;
  actualDisposals?: number | null;
  actualTog?: number | null;
  differenceLine?: number | null;
  resultColor?: 'green' | 'red' | null;
};
type AflNextGameWeather = {
  temperatureC: number | null;
  precipitationMm: number | null;
  windKmh: number | null;
};
const AFL_PAGE_STATE_KEY = 'aflPageState:v1';

/** Client-safe: normalize name for matching (no fs). "Daicos, Nick" and "Nick Daicos" → same key. */
function normalizePlayerNameForMatch(name: string): string {
  if (name == null || typeof name !== 'string') return '';
  let s = name.trim();
  if (!s) return '';
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim());
    if (parts.length === 2 && parts[0] && parts[1]) s = `${parts[1]} ${parts[0]}`.trim();
  }
  return s
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u201B\u2032\u0060]/g, "'")
    .replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSameAflTeam(a: string, b: string): boolean {
  if (!a || !b) return false;
  const n = (s: string) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  const na = n(a);
  const nb = n(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function normalizeForRankMatch(value: string): string {
  return String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const AFL_PLAYER_LOGS_CACHE_PREFIX = 'aflPlayerLogsCache:v6';
const AFL_PLAYER_LOGS_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

const CHART_STAT_TO_DVP_METRIC: Record<string, string> = {
  disposals: 'disposals',
  kicks: 'kicks',
  marks: 'marks',
  goals: 'goals',
  tackles: 'tackles',
  clearances: 'clearances',
  inside_50s: 'inside_50s',
  uncontested_possessions: 'uncontested_possessions',
  meters_gained: 'meters_gained',
  free_kicks_against: 'free_kicks_against',
};

type PersistedAflPageState = {
  selectedPlayer: AflPlayerRecord | null;
  aflPropsMode: 'player' | 'team';
  aflTeamFilter?: string;
  aflRightTab: 'breakdown' | 'dvp' | 'team_matchup';
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

/** True if player name has apostrophe, hyphen, or Irish-style "D Ambrosio" / "O Meara" — these use AFL Tables only; we must not use stale localStorage. */
function playerNameHasSymbol(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const t = name.trim();
  return /['\u2018\u2019]/.test(t) || /\b[OD]'/i.test(t) || /\b[OD] [A-Z]/.test(t) || /-/.test(t);
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

function classifyWindLabel(windKmh: number | null): 'Light' | 'Moderate' | 'Heavy' | 'N/A' {
  if (windKmh == null || !Number.isFinite(windKmh)) return 'N/A';
  if (windKmh < 12) return 'Light';
  if (windKmh < 24) return 'Moderate';
  return 'Heavy';
}

function classifyRainLabel(precipitationMm: number | null): 'None' | 'Light' | 'Moderate' | 'Heavy' | 'N/A' {
  if (precipitationMm == null || !Number.isFinite(precipitationMm)) return 'N/A';
  if (precipitationMm <= 0.05) return 'None';
  if (precipitationMm < 2) return 'Light';
  if (precipitationMm < 6) return 'Moderate';
  return 'Heavy';
}

function formatPastLineDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  const yy = match[1].slice(-2);
  return `${match[3]}/${match[2]}/${yy}`;
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

function buildAflGameIdentityKey(game: Record<string, unknown>): string {
  const season = Number(game.season);
  const seasonPart = Number.isFinite(season) ? String(season) : '';
  const round = String(game.round ?? '').trim().toUpperCase();
  const opponent = String(game.opponent ?? '').trim().toLowerCase();
  const result = String(game.result ?? '').trim().toLowerCase();
  const date = String(game.date ?? game.game_date ?? '').trim().slice(0, 10);
  return [seasonPart, round, opponent, date, result].join('|');
}

function scoreAflGameRowQuality(game: Record<string, unknown>): number {
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  let score = 0;
  // Prefer rows that contain richer advanced/supporting stats.
  const tog = num(game.percent_played);
  if (tog != null && tog > 0) score += 100;
  const advancedKeys = [
    'meters_gained',
    'intercepts',
    'contested_possessions',
    'effective_disposals',
    'disposal_efficiency',
    'one_percenters',
    'tackles_inside_50',
  ] as const;
  for (const k of advancedKeys) {
    const v = num(game[k]);
    if (v != null && v > 0) score += 20;
  }
  // Use core box-score fields as secondary tie-breakers.
  const coreKeys = ['disposals', 'kicks', 'handballs', 'marks', 'goals', 'tackles'] as const;
  for (const k of coreKeys) {
    const v = num(game[k]);
    if (v != null && v > 0) score += 5;
  }
  if (String(game.date ?? game.game_date ?? '').trim()) score += 2;
  if (String(game.round ?? '').trim()) score += 1;
  return score;
}

function dedupeAflGames<T extends Record<string, unknown>>(games: T[]): T[] {
  if (!Array.isArray(games) || games.length <= 1) return games;
  const deduped: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const game of games) {
    const datePart = String(game.date ?? game.game_date ?? '').trim().slice(0, 10);
    const opponentPart = String(game.opponent ?? '').trim().toLowerCase();
    const roundPart = String(game.round ?? '').trim().toUpperCase();
    const gameNumberPart = String(game.game_number ?? '').trim();
    const seasonPart = String(game.season ?? '').trim();
    const identityKey = buildAflGameIdentityKey(game);
    const dateKey = datePart ? [seasonPart, datePart, opponentPart].join('|') : '';
    const roundOpponentKey = roundPart && opponentPart ? [seasonPart, roundPart, opponentPart].join('|') : '';
    const fallbackKey = [
      seasonPart,
      gameNumberPart,
      roundPart,
      opponentPart,
      datePart,
    ].join('|');
    // Keep seasons isolated: never dedupe across seasons, only within same season.
    const key =
      dateKey ||
      roundOpponentKey ||
      (identityKey !== '||||' ? identityKey : '') ||
      fallbackKey;
    if (!key) {
      deduped.push(game);
      continue;
    }
    const existingIdx = indexByKey.get(key);
    if (existingIdx == null) {
      indexByKey.set(key, deduped.length);
      deduped.push(game);
      continue;
    }
    const existing = deduped[existingIdx];
    if (scoreAflGameRowQuality(game) > scoreAflGameRowQuality(existing)) {
      deduped[existingIdx] = game;
    }
  }
  return deduped;
}

function hasVerifiedSupportingStats(game: Record<string, unknown>): boolean {
  const tog = typeof game.percent_played === 'number'
    ? game.percent_played
    : (typeof game.percent_played === 'string' ? parseFloat(game.percent_played) : NaN);
  return Number.isFinite(tog) && tog > 0;
}

const VALID_AFL_TIMEFRAMES = ['last5', 'last10', 'last15', 'last20', 'last50', 'h2h', 'season2026', 'season2025', 'season2024'] as const;

/** If current+prev seasons already yield this many games, L10 cannot include the third (oldest) season — load oldest in background. */
const AFL_DEFER_OLDEST_SEASON_WHEN_GAME_COUNT_AT_LEAST = 10;

function normalizeAflTimeframe(value: unknown): AflChartTimeframe | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'thisseason') return 'season2026';
  if (raw === 'lastseason') return 'season2025';
  if ((VALID_AFL_TIMEFRAMES as readonly string[]).includes(raw)) return raw as AflChartTimeframe;
  return null;
}

export default function AFLPage() {
  const router = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isPro, setIsPro] = useState(false);
  const [subscriptionChecked, setSubscriptionChecked] = useState(false);
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
  const [selectedPlayerDfsRole, setSelectedPlayerDfsRole] = useState<string | null>(null);
  const [aflRightTab, setAflRightTab] = useState<'breakdown' | 'dvp' | 'team_matchup'>('dvp');
  /** Tracks which right tabs have been opened so we keep their content mounted (no re-render on tab switch). */
  const [aflRightTabsVisited, setAflRightTabsVisited] = useState<Set<'breakdown' | 'dvp' | 'team_matchup'>>(() => new Set(['dvp']));
  const [aflPropsMode, setAflPropsMode] = useState<'player' | 'team'>('player');
  const [aflTeamFilter, setAflTeamFilter] = useState<string>('All');
  const [aflGamePropsVsTeamFilter, setAflGamePropsVsTeamFilter] = useState<string>('All');
  const [aflChartTimeframe, setAflChartTimeframe] = useState<AflChartTimeframe>('last10');
  const [mainChartStat, setMainChartStat] = useState<string>('');
  const [supportingStatKind, setSupportingStatKind] = useState<SupportingStatKind>('tog');
  const [playerVsRankScope, setPlayerVsRankScope] = useState<'team' | 'league'>('team');
  const [playerVsContainerTab, setPlayerVsContainerTab] = useState<'comparison' | 'prediction'>('comparison');
  const showAflPredictionPanel =
    !AFL_PREDICTION_MODEL_UNDER_MAINTENANCE && playerVsContainerTab === 'prediction';
  useEffect(() => {
    if (AFL_PREDICTION_MODEL_UNDER_MAINTENANCE && playerVsContainerTab === 'prediction') {
      setPlayerVsContainerTab('comparison');
    }
  }, [playerVsContainerTab]);
  const [teamFilterDropdownOpen, setTeamFilterDropdownOpen] = useState(false);
  const [teammateFilterName, setTeammateFilterName] = useState<string | null>(null);
  useEffect(() => {
    setSupportingStatKind('tog');
  }, [mainChartStat]);
  useEffect(() => {
    if (aflPropsMode === 'team') {
      setAflRightTab('breakdown');
    }
  }, [aflPropsMode]);
  useEffect(() => {
    setAflRightTabsVisited((prev) => new Set(prev).add(aflRightTab));
  }, [aflRightTab]);
  // Prevent Game Props team swaps from mutating Player Props H2H filter context.
  useEffect(() => {
    const prevMode = prevAflPropsModeRef.current;

    if (aflPropsMode === 'player') {
      if (prevMode === 'team') {
        const restoreFilter = playerModeTeamFilterRef.current || 'All';
        if (aflTeamFilter !== restoreFilter) {
          setAflTeamFilter(restoreFilter);
        }
      } else {
        playerModeTeamFilterRef.current = aflTeamFilter || 'All';
      }
    } else if (aflPropsMode === 'team' && prevMode === 'player') {
      playerModeTeamFilterRef.current = aflTeamFilter || 'All';
    }

    prevAflPropsModeRef.current = aflPropsMode;
  }, [aflPropsMode, aflTeamFilter]);
  const [withWithoutMode, setWithWithoutMode] = useState<'with' | 'without'>('with');
  const [aflGameFilters, setAflGameFilters] = useState<AflGameFiltersState>(() => ({
    ...DEFAULT_AFL_GAME_FILTERS,
    dvpPosition: 'MID',
  }));
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [aflFilterDataDvp, setAflFilterDataDvp] = useState<{
    opponents: string[];
    metrics: Record<
      string,
      {
        teamTotalRanks: Record<string, number>;
        teamTotalValues?: Record<string, number>;
      }
    >;
  } | null>(null);
  const [aflOaRankSnapshots, setAflOaRankSnapshots] = useState<AflHistoricalRankSnapshot[] | null>(null);
  const [aflDvpRankSnapshots, setAflDvpRankSnapshots] = useState<AflHistoricalRankSnapshot[] | null>(null);
  const [nextGameOpponent, setNextGameOpponent] = useState<string | null>(null);
  const [nextGameTipoff, setNextGameTipoff] = useState<Date | null>(null);
  const [nextGameId, setNextGameId] = useState<string | null>(null);
  const [nextGameWeather, setNextGameWeather] = useState<AflNextGameWeather | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [navigatingToProps, setNavigatingToProps] = useState(false);
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  useCountdownTimer({ nextGameTipoff, isGameInProgress, setCountdown });
  const [leaguePlayerStats, setLeaguePlayerStats] = useState<AflLeaguePlayerTeamRankRow[] | null>(null);
  const [aflOpponentTeamAverages, setAflOpponentTeamAverages] = useState<AflTeamRankingRow[] | null>(null);
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
  const chartUiResetToken = `${aflPropsMode}:${String(selectedPlayer?.name ?? '')}`;

  useEffect(() => {
    // Always clear open/active analysis UI when switching mode or changing player.
    setShowAdvancedFilters(false);
    setAflRightTab(aflPropsMode === 'player' ? 'dvp' : 'breakdown');
    setAflChartTimeframe('last10');
    setAflGamePropsVsTeamFilter('All');
    setAflGameFilters((prev) => ({
      ...DEFAULT_AFL_GAME_FILTERS,
      dvpPosition: prev?.dvpPosition || DEFAULT_AFL_GAME_FILTERS.dvpPosition,
    }));
  }, [aflPropsMode, selectedPlayer?.name]);
  const [aflCurrentLineValue, setAflCurrentLineValue] = useState<number | null>(null);
  /** Game props (team mode): current line from chart input; used so line selector hides bookmaker when it doesn't match. */
  const [aflGameLineValue, setAflGameLineValue] = useState<number | null>(null);
  const [aflPlayerPropsBooks, setAflPlayerPropsBooks] = useState<AflBookRow[]>([]);
  const [aflDisposalsModelProjection, setAflDisposalsModelProjection] = useState<AflDisposalsModelProjection | null>(null);
  const [aflDisposalsModelLoading, setAflDisposalsModelLoading] = useState(false);
  const [aflDisposalsModelRefreshLoading, setAflDisposalsModelRefreshLoading] = useState(false);
  const [showAflTopPicksModal, setShowAflTopPicksModal] = useState(false);
  const [aflTopPicksByGame, setAflTopPicksByGame] = useState<AflTopPicksGameGroup[]>([]);
  const [aflTopPicksModalLoading, setAflTopPicksModalLoading] = useState(false);
  const [aflDisposalsPastLines, setAflDisposalsPastLines] = useState<AflDisposalsPastLineRow[]>([]);
  const [aflDisposalsPastLinesLoading, setAflDisposalsPastLinesLoading] = useState(false);
  const aflDisposalsPastLinesCompleted = useMemo(
    () => aflDisposalsPastLines.filter((row) => typeof row.actualDisposals === 'number'),
    [aflDisposalsPastLines]
  );
  const [aflPlayerPropsLoading, setAflPlayerPropsLoading] = useState(false);
  const [aflPlayerPropsRefetchKey, setAflPlayerPropsRefetchKey] = useState(0);
  const [bootReady, setBootReady] = useState(false);
  const [bootDeadlinePassed, setBootDeadlinePassed] = useState(false);
  const lastPlayerPropsKeyRef = useRef<string | null>(null);
  const ignoreNextTransientLineRef = useRef(false);
  const lastAutoLineContextRef = useRef<string | null>(null);
  const preferredAflBookmakerRef = useRef<string | null>(null);
  const hasIncomingAflBookOrLineRef = useRef(false);
  const [teamModeSelectedTeamLogs, setTeamModeSelectedTeamLogs] = useState<AflGameLogRecord[]>([]);
  /** Short delay before showing chart so odds have time to load and auto-select inline with chart. */
  const [chartDelayElapsed, setChartDelayElapsed] = useState(false);
  const CHART_DISPLAY_DELAY_MS = 120;
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedLogsRef = useRef<Map<string, { games: AflGameLogRecord[]; gamesWithQuarters: AflGameLogRecord[]; mergedStats: Partial<AflPlayerRecord> }>>(new Map());
  const matchupPlayerKeyRef = useRef<string>('');
  const prevTeamContextRef = useRef<string>('');
  const prevAflPropsModeRef = useRef<'player' | 'team'>('player');
  const playerModeTeamFilterRef = useRef<string>('All');
  const nextGameFromFetchRef = useRef<{ opponent: string | null; tipoff: Date | null }>({ opponent: null, tipoff: null });
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

  // Load league player stats used for "rank vs team" badges in Player vs Team.
  useEffect(() => {
    let cancelled = false;
    const effectiveSeason = Math.min(season, 2026);
    fetch(`/api/afl/league-player-stats?season=${effectiveSeason}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const players = Array.isArray(json?.players) ? (json.players as AflLeaguePlayerTeamRankRow[]) : [];
        setLeaguePlayerStats(players);
      })
      .catch(() => {
        if (!cancelled) setLeaguePlayerStats(null);
      });
    return () => { cancelled = true; };
  }, [season]);

  // Load opponent averages (OA) used by Player vs Team right column values/ranks.
  useEffect(() => {
    let cancelled = false;
    const effectiveSeason = Math.min(season, 2026);
    fetch(`/api/afl/team-rankings?season=${effectiveSeason}&type=oa`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const teams = Array.isArray(json?.teams) ? (json.teams as AflTeamRankingRow[]) : [];
        setAflOpponentTeamAverages(teams);
      })
      .catch(() => {
        if (!cancelled) setAflOpponentTeamAverages(null);
      });
    return () => { cancelled = true; };
  }, [season]);

  // Resolve incoming URL bookmaker/line preference first; otherwise keep PointsBet as default behavior.
  useEffect(() => {
    if (aflPropsMode !== 'player' || !aflPlayerPropsBooks.length) return;
    const normalizeBook = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
    const preferredBook = preferredAflBookmakerRef.current;
    if (preferredBook) {
      const preferredNorm = normalizeBook(preferredBook);
      const preferredIndex = aflPlayerPropsBooks.findIndex((b) => {
        const bookNorm = normalizeBook(b.name);
        return bookNorm === preferredNorm || bookNorm.includes(preferredNorm) || preferredNorm.includes(bookNorm);
      });
      if (preferredIndex >= 0) {
        if (preferredIndex !== selectedAflBookIndex) {
          setSelectedAflBookIndex(preferredIndex);
        }
        preferredAflBookmakerRef.current = null;
        return;
      }
    }
    if (hasIncomingAflBookOrLineRef.current) return;
    const pointsBetIndex = aflPlayerPropsBooks.findIndex(
      (b) => b.name && String(b.name).toLowerCase().includes('pointsbet')
    );
    if (pointsBetIndex >= 0 && pointsBetIndex !== selectedAflBookIndex) {
      setSelectedAflBookIndex(pointsBetIndex);
    }
  }, [aflPropsMode, aflPlayerPropsBooks, selectedAflBookIndex]);

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
        setAflCurrentLineValue((prev) => (
          prev != null && Number.isFinite(prev) && Math.abs(prev - value) < tol ? prev : value
        ));
        if (mainChartStat === 'disposals') {
          for (let idx = 0; idx < aflPlayerPropsBooks.length; idx++) {
            const book = aflPlayerPropsBooks[idx];
            for (const c of ['Disposals', 'DisposalsOver'] as const) {
              const lineStr = (book[c] as { line?: string } | undefined)?.line;
              if (!lineStr || lineStr === 'N/A') continue;
              const lineNum = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
              if (Number.isFinite(lineNum) && Math.abs(lineNum - value) < tol) {
                if (idx !== selectedAflBookIndex) setSelectedAflBookIndex(idx);
                if (c !== selectedAflDisposalsColumn) setSelectedAflDisposalsColumn(c);
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
              if (idx !== selectedAflBookIndex) setSelectedAflBookIndex(idx);
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
        if (idx >= 0 && idx !== selectedAflBookIndex) setSelectedAflBookIndex(idx);
        return;
      }

      if (aflPropsMode === 'team' && aflOddsBooks.length && (mainChartStat === 'spread' || mainChartStat === 'total_points')) {
        setAflGameLineValue((prev) => (
          prev != null && Number.isFinite(prev) && Math.abs(prev - value) < tol ? prev : value
        ));
        const idx = aflOddsBooks.findIndex((book) => {
          const lineStr = mainChartStat === 'spread' ? book.Spread?.line : book.Total?.line;
          if (!lineStr || lineStr === 'N/A') return false;
          const lineNum = parseFloat(String(lineStr).replace(/[^0-9.-]/g, ''));
          return Number.isFinite(lineNum) && Math.abs(lineNum - value) < tol;
        });
        if (idx >= 0 && idx !== selectedAflBookIndex) setSelectedAflBookIndex(idx);
      }
      // total_goals: bookmaker "Total" is total points, not goals — don't sync line or book
    };
    window.addEventListener('transient-line', onTransientLine);
    return () => window.removeEventListener('transient-line', onTransientLine);
  }, [aflPropsMode, mainChartStat, aflPlayerPropsBooks, aflOddsBooks, selectedAflBookIndex, selectedAflDisposalsColumn]);

  // Effective player-prop column: for disposals use selected O/U vs Over-only; for goals use GoalsOver (with Anytime 0.5); else chart stat mapping
  const effectivePlayerPropColumn = mainChartStat === 'disposals'
    ? selectedAflDisposalsColumn
    : (CHART_STAT_TO_PLAYER_PROP_COLUMN[mainChartStat] ?? null);

  const dashboardImpliedOdds = useMemo(() => {
    const toLineNumber = (line: string | number | null | undefined): number | null => {
      if (line == null) return null;
      const n = parseFloat(String(line).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const isSameLine = (a: number | null, b: number | null, tol = 0.01): boolean => {
      if (a == null || b == null) return false;
      return Math.abs(a - b) < tol;
    };
    const median = (values: number[]): number => {
      const sorted = [...values].sort((x, y) => x - y);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    };

    const validImplied: Array<{ over: number; under: number }> = [];

    if (aflPropsMode === 'player') {
      const selectedBook = aflPlayerPropsBooks[selectedAflBookIndex];
      if (!selectedBook) return null;

      const playerColumn = mainChartStat === 'disposals'
        ? selectedAflDisposalsColumn
        : (CHART_STAT_TO_PLAYER_PROP_COLUMN[mainChartStat] ?? null);
      if (!playerColumn) return null;

      const selectedBookLine =
        playerColumn === 'GoalsOver'
          ? toLineNumber(getGoalsMarketLineOver(selectedBook)?.line)
          : toLineNumber((selectedBook[playerColumn] as { line?: string } | undefined)?.line);
      const targetLine = playerColumn === 'AnytimeGoalScorer'
        ? null
        : (aflCurrentLineValue != null && Number.isFinite(aflCurrentLineValue) ? aflCurrentLineValue : selectedBookLine);

      for (const book of aflPlayerPropsBooks) {
        let overOdds: string | number | null = null;
        let underOdds: string | number | null = null;

        if (playerColumn === 'GoalsOver') {
          const goalsLines = getGoalsMarketLines(book);
          const matchedGoalsLine = targetLine != null
            ? goalsLines.find((x) => isSameLine(toLineNumber(x.line), targetLine))
            : (getGoalsMarketLineOver(book) ?? null);
          if (!matchedGoalsLine) continue;
          overOdds = matchedGoalsLine.over ?? null;
          underOdds = book.AnytimeGoalScorer?.no ?? null;
        } else if (playerColumn === 'AnytimeGoalScorer') {
          overOdds = book.AnytimeGoalScorer?.yes ?? null;
          underOdds = book.AnytimeGoalScorer?.no ?? null;
        } else {
          const market = book[playerColumn] as { line?: string; over?: string; under?: string } | undefined;
          if (!market) continue;
          if (targetLine != null && !isSameLine(toLineNumber(market.line), targetLine)) continue;
          overOdds = market.over ?? null;
          underOdds = market.under ?? null;
        }

        const implied = calculateImpliedProbabilities(overOdds, underOdds);
        if (implied) {
          validImplied.push({
            over: implied.overImpliedProb,
            under: implied.underImpliedProb,
          });
        }
      }
    } else if (aflPropsMode === 'team') {
      const selectedBook = aflOddsBooks[selectedAflBookIndex];
      if (!selectedBook) return null;

      const selectedBookLine =
        mainChartStat === 'spread'
          ? toLineNumber(selectedBook.Spread?.line)
          : mainChartStat === 'total_points'
            ? toLineNumber(selectedBook.Total?.line)
            : null;
      const targetLine =
        mainChartStat === 'spread' || mainChartStat === 'total_points'
          ? (aflGameLineValue != null && Number.isFinite(aflGameLineValue) ? aflGameLineValue : selectedBookLine)
          : null;

      for (const book of aflOddsBooks) {
        let overOdds: string | number | null = null;
        let underOdds: string | number | null = null;

        if (mainChartStat === 'moneyline') {
          overOdds = book.H2H?.home ?? null;
          underOdds = book.H2H?.away ?? null;
        } else if (mainChartStat === 'spread') {
          if (targetLine != null && !isSameLine(toLineNumber(book.Spread?.line), targetLine)) continue;
          overOdds = book.Spread?.over ?? null;
          underOdds = book.Spread?.under ?? null;
        } else if (mainChartStat === 'total_points') {
          if (targetLine != null && !isSameLine(toLineNumber(book.Total?.line), targetLine)) continue;
          overOdds = book.Total?.over ?? null;
          underOdds = book.Total?.under ?? null;
        } else {
          return null;
        }

        const implied = calculateImpliedProbabilities(overOdds, underOdds);
        if (implied) {
          validImplied.push({
            over: implied.overImpliedProb,
            under: implied.underImpliedProb,
          });
        }
      }
    } else {
      return null;
    }

    if (!validImplied.length) return null;
    return {
      overImpliedProb: median(validImplied.map((v) => v.over)),
      underImpliedProb: median(validImplied.map((v) => v.under)),
    };
  }, [
    aflPropsMode,
    aflPlayerPropsBooks,
    aflOddsBooks,
    selectedAflBookIndex,
    mainChartStat,
    selectedAflDisposalsColumn,
    aflCurrentLineValue,
    aflGameLineValue,
  ]);

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
    const currentContext = `${mainChartStat}|${mainChartStat === 'disposals' ? selectedAflDisposalsColumn : baseCol ?? ''}`;
    const contextChanged = lastAutoLineContextRef.current !== currentContext;
    lastAutoLineContextRef.current = currentContext;
    if (Number.isFinite(n)) {
      // Don't overwrite user's manual line when returning from background (refetch): keep custom value e.g. 22 if book has 24.5
      // But when stat context changes (e.g. Disposals -> Goals), always switch to that stat's bookmaker line.
      const tol = 0.01;
      if (
        !contextChanged &&
        aflCurrentLineValue != null &&
        Number.isFinite(aflCurrentLineValue) &&
        Math.abs(aflCurrentLineValue - n) > tol
      ) {
        return; // User has set a different line; keep it
      }
      ignoreNextTransientLineRef.current = true;
      setAflCurrentLineValue(n);
    }
  }, [aflPropsMode, mainChartStat, selectedAflDisposalsColumn, aflPlayerPropsBooks, aflCurrentLineValue]);

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

  // Keep DVP metric in sync with the main chart stat so DVP rank filter matches chart stat context.
  useEffect(() => {
    if (!mainChartStat) return;
    setAflGameFilters((prev) => {
      const nextMetric = CHART_STAT_TO_DVP_METRIC[mainChartStat] ?? prev.dvpMetric ?? 'disposals';
      if (prev.dvpMetric === nextMetric) {
        return prev;
      }
      return {
        ...prev,
        dvpMetric: nextMetric,
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

  // NBA-style URL: ?mode=player&name=...&team=... (and optionally stat, tf, line, opponent). Read on load so /afl?mode=player&name=Andrew+McGrath&team=Essendon+Bombers works like NBA.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const nameParam = url.searchParams.get('name')?.trim();
    if (!nameParam) return;
    if (url.searchParams.get('player')?.trim()) return; // prefer ?player= when both present (e.g. from props)
    const teamParam = url.searchParams.get('team')?.trim();
    const opponentParam = url.searchParams.get('opponent')?.trim();
    const urlFallback: AflPlayerRecord = {
      name: nameParam,
      ...(teamParam ? { team: teamParam } : {}),
      ...(opponentParam ? { last_opponent: opponentParam } : {}),
    };
    setSelectedPlayer(urlFallback);
    setAflPropsMode('player');
    setAflRightTab('dvp');
    setLoadingPlayerFromUrl(false);
    // Team filter stays "All" until the user chooses; don't set from URL opponent so refresh shows full L10 not one opponent.
    const statParam = url.searchParams.get('stat')?.trim();
    const tfParam = url.searchParams.get('tf')?.trim();
    const lineParam = url.searchParams.get('line')?.trim();
    const bookmakerParam = url.searchParams.get('bookmaker')?.trim();
    if (bookmakerParam) preferredAflBookmakerRef.current = bookmakerParam;
    if (statParam && ['disposals', 'goals', 'marks', 'tackles', 'kicks', 'handballs', 'tog', 'inside_50s', 'uncontested', 'uncontested_possessions', 'meters_gained', 'free_kicks_against'].includes(statParam)) {
      setMainChartStat(statParam);
    }
    const normalizedTf = normalizeAflTimeframe(tfParam);
    if (normalizedTf) {
      setAflChartTimeframe(normalizedTf);
    }
    if (lineParam) {
      const n = parseFloat(lineParam);
      if (Number.isFinite(n)) {
        hasIncomingAflBookOrLineRef.current = true;
        setAflCurrentLineValue(n);
      }
    }
    if (bookmakerParam) hasIncomingAflBookOrLineRef.current = true;
  }, []);

  // When landing with ?player=Name (e.g. from props Find player), show name from URL immediately, then merge API record without replacing so game-logs effect doesn't re-run.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const playerParam = url.searchParams.get('player')?.trim();
    if (!playerParam) return;
    const teamParam = url.searchParams.get('team')?.trim();
    const opponentParam = url.searchParams.get('opponent')?.trim();
    const urlFallback: AflPlayerRecord = {
      name: playerParam,
      ...(teamParam ? { team: teamParam } : {}),
      ...(opponentParam ? { last_opponent: opponentParam } : {}),
    };
    setSelectedPlayer(urlFallback);
    setAflPropsMode('player');
    setAflRightTab('dvp');
    setSelectedPlayerGameLogs([]);
    setSelectedPlayerGameLogsWithQuarters([]);
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ query: playerParam, limit: '30', exact: '1' });
        const res = await fetch(`/api/afl/players?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadingPlayerFromUrl(false);
          return;
        }
        const list = Array.isArray(data?.players) ? data.players : [];
        const paramLookup = normalizePlayerNameForMatch(playerParam);
        const match = list.find((p: Record<string, unknown>) => {
          const name = String(p?.name ?? p?.player_name ?? p?.full_name ?? '').trim();
          return name && normalizePlayerNameForMatch(name) === paramLookup;
        }) ?? list.find((p: Record<string, unknown>) => {
          const name = String(p?.name ?? p?.player_name ?? p?.full_name ?? '').trim();
          return name && name.toLowerCase().includes(playerParam.toLowerCase());
        }) ?? list[0];
        if (cancelled) return;
        if (!match) {
          url.searchParams.delete('player');
          url.searchParams.delete('team');
          url.searchParams.delete('opponent');
          window.history.replaceState({}, '', url.toString());
          setLoadingPlayerFromUrl(false);
          return;
        }
        const record: AflPlayerRecord = {
          name: String(match.name ?? match.player_name ?? match.full_name ?? '—'),
          ...(typeof match.team === 'string' && match.team.trim() ? { team: match.team.trim() } : teamParam ? { team: teamParam } : {}),
          ...(typeof match.number === 'number' && Number.isFinite(match.number) ? { guernsey: match.number } : {}),
          ...(match.id != null ? { id: match.id } : {}),
        };
        if (opponentParam) {
          (record as AflPlayerRecord & { last_opponent?: string }).last_opponent = opponentParam;
        }
        if (match.position != null) (record as AflPlayerRecord & { position?: string }).position = String(match.position);
        // Finish URL-player resolution before the logs effect runs so the first request
        // uses the canonical player/team instead of a temporary URL fallback record.
        setSelectedPlayer((prev) => (prev ? { ...prev, ...record } : record));
        setLoadingPlayerFromUrl(false);
        setSearchQuery('');
        // Team filter stays "All" until the user chooses; don't set from URL opponent so refresh shows full L10.
        // NBA-style URL: set mode=player&name=...&team=... so URL is shareable and matches NBA dashboard
        url.searchParams.set('mode', 'player');
        url.searchParams.set('name', String(record.name ?? ''));
        url.searchParams.set('team', String(record.team ?? teamParam ?? '').trim() || '');
        url.searchParams.delete('player');
        if (opponentParam) url.searchParams.set('opponent', opponentParam);
        else url.searchParams.delete('opponent');
        window.history.replaceState({}, '', url.toString());
      } catch {
        if (!cancelled) {
          url.searchParams.delete('player');
          url.searchParams.delete('team');
          url.searchParams.delete('opponent');
          window.history.replaceState({}, '', url.toString());
          setLoadingPlayerFromUrl(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Rehydrate AFL page context on refresh so the selected player/screen is preserved.
  // When URL has ?player= or ?name= (NBA-style) we are coming with a specific player — do not restore old selectedPlayer from localStorage.
  useEffect(() => {
    try {
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const hasPlayerParam = (url?.searchParams.get('player')?.trim() ?? '') !== '';
      const hasNameParam = (url?.searchParams.get('name')?.trim() ?? '') !== '';
      const hasOpponentInUrl = (url?.searchParams.get('opponent')?.trim() ?? '') !== '';
      const hasPlayerInUrl = hasPlayerParam || hasNameParam;
      const raw = localStorage.getItem(AFL_PAGE_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedAflPageState>;
      if (!hasPlayerInUrl && parsed.selectedPlayer && typeof parsed.selectedPlayer === 'object') {
        setSelectedPlayer(parsed.selectedPlayer as AflPlayerRecord);
      }
      if (hasPlayerInUrl) {
        setAflPropsMode('player');
      } else if (parsed.aflPropsMode === 'player' || parsed.aflPropsMode === 'team') {
        setAflPropsMode(parsed.aflPropsMode);
      }
      // Don't restore aflTeamFilter from localStorage when URL has opponent (e.g. from props page) so the URL opponent wins.
      if (!hasOpponentInUrl && typeof parsed.aflTeamFilter === 'string' && parsed.aflTeamFilter.trim() !== '') {
        const validTeams = new Set(['All', ...Object.values(ROSTER_TEAM_TO_INJURY_TEAM)]);
        if (validTeams.has(parsed.aflTeamFilter)) setAflTeamFilter(parsed.aflTeamFilter);
      }
      if (hasPlayerInUrl) {
        setAflRightTab('dvp');
      } else if (parsed.aflRightTab === 'dvp' || parsed.aflRightTab === 'breakdown' || parsed.aflRightTab === 'team_matchup') {
        setAflRightTab(parsed.aflRightTab);
      }
      const normalizedPersistedTf = normalizeAflTimeframe(parsed.aflChartTimeframe);
      if (normalizedPersistedTf) {
        setAflChartTimeframe(normalizedPersistedTf);
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

  // When opening from props page Find player: use same player object as dashboard (sessionStorage) so stats load identically. Run after rehydrate so we overwrite.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('afl_player_from_props');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { name?: string; team?: string };
      const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
      if (!name) {
        sessionStorage.removeItem('afl_player_from_props');
        return;
      }
      const record: AflPlayerRecord = {
        name,
        ...(parsed.team && String(parsed.team).trim() ? { team: String(parsed.team).trim() } : {}),
      };
      sessionStorage.removeItem('afl_player_from_props');
      setSelectedPlayer(record);
      setAflPropsMode('player');
      setAflRightTab('dvp');
      setLoadingPlayerFromUrl(false);
      setSelectedPlayerGameLogs([]);
      setSelectedPlayerGameLogsWithQuarters([]);
      setStatsLoadingForPlayer(true);
    } catch {
      try {
        sessionStorage.removeItem('afl_player_from_props');
      } catch {}
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
      aflChartTimeframe,
      withWithoutMode,
      aflGameFilters,
    };
    try {
      localStorage.setItem(AFL_PAGE_STATE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [selectedPlayer, aflPropsMode, aflTeamFilter, aflRightTab, aflChartTimeframe, withWithoutMode, aflGameFilters]);

  // Keep URL in sync with selection (same pattern as NBA): mode=player&name=...&team=...&opponent= (next opponent, not last game)&stat=...&tf=...&line=...
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (aflPropsMode === 'player' && selectedPlayer?.name) {
      url.searchParams.set('mode', 'player');
      url.searchParams.set('name', String(selectedPlayer.name ?? ''));
      url.searchParams.set('team', String(selectedPlayer.team ?? '').trim());
      const nextOpp = nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== '—' ? nextGameOpponent : null;
      if (nextOpp) url.searchParams.set('opponent', nextOpp);
      else url.searchParams.delete('opponent');
      if (mainChartStat) url.searchParams.set('stat', mainChartStat);
      else url.searchParams.delete('stat');
      url.searchParams.set('tf', aflChartTimeframe);
      if (aflCurrentLineValue != null && Number.isFinite(aflCurrentLineValue)) {
        url.searchParams.set('line', String(aflCurrentLineValue));
      } else url.searchParams.delete('line');
      url.searchParams.delete('player');
    } else {
      url.searchParams.delete('mode');
      url.searchParams.delete('name');
      url.searchParams.delete('team');
      url.searchParams.delete('opponent');
      url.searchParams.delete('player');
      url.searchParams.delete('stat');
      url.searchParams.delete('tf');
      url.searchParams.delete('line');
    }
    const newUrlStr = url.toString();
    if (window.location.href !== newUrlStr) {
      window.history.replaceState({}, '', newUrlStr);
    }
  }, [aflPropsMode, selectedPlayer?.name, selectedPlayer?.team, nextGameOpponent, mainChartStat, aflChartTimeframe, aflCurrentLineValue]);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setSubscriptionChecked(true);
        router.replace('/login?redirect=/afl');
        return;
      }
      const user = session.user;
      setUserEmail(user.email ?? null);
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, username, avatar_url, subscription_status, subscription_tier')
          .eq('id', user.id)
          .single();
        const p = profile as { full_name?: string; username?: string; avatar_url?: string; subscription_status?: string; subscription_tier?: string } | null;
        // Match props/dashboard behavior: prefer full_name, then username
        setUsername(p?.full_name || p?.username || null);
        setAvatarUrl(p?.avatar_url ?? null);
        const active = p?.subscription_status === 'active' || p?.subscription_status === 'trialing';
        const proTier = p?.subscription_tier === 'pro';
        setIsPro(Boolean(active && proTier));
      } catch (e) {
        console.error('Error loading profile:', e);
      } finally {
        setSubscriptionChecked(true);
      }
    };
    loadUser();
  }, [router]);

  useEffect(() => {
    if (subscriptionChecked && !isPro) {
      router.replace('/home#pricing');
    }
  }, [subscriptionChecked, isPro, router]);

  // Prevent stale opponent flicker when switching players:
  // immediately clear prior player's matchup context before next-game resolves.
  useEffect(() => {
    const key = `${String(selectedPlayer?.name ?? '').trim().toLowerCase()}|${String(selectedPlayer?.team ?? '').trim().toLowerCase()}`;
    if (key === matchupPlayerKeyRef.current) return;
    matchupPlayerKeyRef.current = key;
    if (!selectedPlayer) return;
    setNextGameOpponent(null);
    setNextGameTipoff(null);
    setNextGameId(null);
    setIsGameInProgress(false);
    nextGameFromFetchRef.current = { opponent: null, tipoff: null };
  }, [selectedPlayer?.name, selectedPlayer?.team]);

  // Keep the initial full-page loader visible until player data is ready
  // (same "instant once visible" feel as mobile), with a safety timeout.
  useEffect(() => {
    if (!subscriptionChecked || !isPro || bootReady) return;
    const t = setTimeout(() => setBootDeadlinePassed(true), 10000);
    return () => clearTimeout(t);
  }, [subscriptionChecked, isPro, bootReady]);

  useEffect(() => {
    if (!subscriptionChecked || !isPro || bootReady) return;
    const waitingForUrlPlayer = loadingPlayerFromUrl;
    // Keep first paint fast on desktop: block on core player stats only.
    // Player props can continue loading inside the page after initial render.
    const waitingForSelectedPlayerData =
      !!selectedPlayer && aflPropsMode === 'player' && statsLoadingForPlayer;
    if (!waitingForUrlPlayer && !waitingForSelectedPlayerData) {
      setBootReady(true);
    } else if (bootDeadlinePassed) {
      setBootReady(true);
    }
  }, [
    subscriptionChecked,
    isPro,
    bootReady,
    bootDeadlinePassed,
    loadingPlayerFromUrl,
    selectedPlayer,
    aflPropsMode,
    statsLoadingForPlayer,
  ]);

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

  const teamContextTeam =
    aflPropsMode === 'team'
      ? (
          aflTeamFilter && aflTeamFilter !== 'All'
            ? (rosterTeamToInjuryTeam(aflTeamFilter) || footywireNicknameToOfficial(aflTeamFilter) || aflTeamFilter)
            : (selectedPlayer?.team ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || String(selectedPlayer.team)) : '')
        )
      : (selectedPlayer?.team ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || String(selectedPlayer.team)) : '');
  const aflOddsTeam = teamContextTeam;
  const aflOddsOpponent =
    nextGameOpponent && nextGameOpponent !== '—'
      ? (opponentToOfficialTeamName(nextGameOpponent) || nextGameOpponent)
      : '';
  const aflOddsGameDate = nextGameTipoff ? nextGameTipoff.toISOString().split('T')[0] : '';

  // Team mode: when team context changes, clear stale matchup/odds state from the previously loaded team.
  useEffect(() => {
    if (aflPropsMode !== 'team') return;
    const currentTeam = String(teamContextTeam ?? '').trim();
    const prevTeam = prevTeamContextRef.current;
    if (!currentTeam) {
      prevTeamContextRef.current = '';
      return;
    }
    if (prevTeam && prevTeam !== currentTeam) {
      setNextGameId(null);
      setNextGameOpponent(null);
      setNextGameTipoff(null);
      nextGameFromFetchRef.current = { opponent: null, tipoff: null };
      setAflOddsHomeTeam('');
      setAflOddsAwayTeam('');
      setAflOddsBooks([]);
      setSelectedAflBookIndex(0);
    }
    prevTeamContextRef.current = currentTeam;
  }, [aflPropsMode, teamContextTeam]);

  useEffect(() => {
    const hasMatchup = (aflOddsTeam && aflOddsOpponent) || (nextGameId && nextGameOpponent);
    if (!hasMatchup) {
      setAflOddsBooks([]);
      setAflOddsHomeTeam('');
      setAflOddsAwayTeam('');
      setAflOddsError(null);
      return;
    }
    let cancelled = false;
    setAflOddsLoading(true);
    setAflOddsError(null);
    const useGameId = aflPropsMode === 'player' && !!nextGameId;
    const base = useGameId
      ? `/api/afl/odds?game_id=${encodeURIComponent(nextGameId)}`
      : `/api/afl/odds?team=${encodeURIComponent(aflOddsTeam)}&opponent=${encodeURIComponent(aflOddsOpponent)}`;
    const urlWithDate = aflOddsGameDate ? `${base}&game_date=${encodeURIComponent(aflOddsGameDate)}` : base;
    const urlNoDate = base;
    const apply = (data: { success?: boolean; data?: unknown[]; homeTeam?: string; awayTeam?: string; error?: string | null }) => {
      if (data?.success && Array.isArray(data.data) && data.data.length > 0) {
        setAflOddsBooks(data.data as AflBookRow[]);
        if (aflPropsMode === 'team' && teamContextTeam) {
          const ctx = opponentToOfficialTeamName(teamContextTeam) || rosterTeamToInjuryTeam(teamContextTeam) || teamContextTeam;
          const home = data.homeTeam ? (opponentToOfficialTeamName(data.homeTeam) || rosterTeamToInjuryTeam(data.homeTeam) || data.homeTeam) : '';
          const away = data.awayTeam ? (opponentToOfficialTeamName(data.awayTeam) || rosterTeamToInjuryTeam(data.awayTeam) || data.awayTeam) : '';
          const opp = aflOddsOpponent ? (opponentToOfficialTeamName(aflOddsOpponent) || rosterTeamToInjuryTeam(aflOddsOpponent) || aflOddsOpponent) : '';
          if (home === ctx || away === ctx) {
            setAflOddsHomeTeam(data.homeTeam || aflOddsTeam);
            setAflOddsAwayTeam(data.awayTeam || aflOddsOpponent);
          } else if (opp && (home === opp || away === opp)) {
            setAflOddsHomeTeam(ctx);
            setAflOddsAwayTeam(opp);
          } else {
            setAflOddsHomeTeam(ctx);
            setAflOddsAwayTeam(data.awayTeam || aflOddsOpponent || '');
          }
        } else {
          setAflOddsHomeTeam(data.homeTeam || aflOddsTeam);
          setAflOddsAwayTeam(data.awayTeam || aflOddsOpponent);
        }
        setSelectedAflBookIndex((i) => (i >= (data.data?.length ?? 0) ? 0 : i));
        setAflOddsError(null);
        return true;
      }
      return false;
    };
    const fetchJson = (url: string) =>
      fetch(url)
        .then((r) => r.json())
        .catch(() => null);

    const request = aflOddsGameDate
      ? Promise.all([fetchJson(urlWithDate), fetchJson(urlNoDate)]).then(([withDateData, fallbackData]) => {
          if (cancelled) return;
          if (apply(withDateData as { success?: boolean; data?: unknown[]; homeTeam?: string; awayTeam?: string; error?: string | null })) return;
          if (apply(fallbackData as { success?: boolean; data?: unknown[]; homeTeam?: string; awayTeam?: string; error?: string | null })) return;
          setAflOddsBooks([]);
          setAflOddsHomeTeam('');
          setAflOddsAwayTeam('');
          const primaryErr =
            (withDateData as { error?: string | null } | null)?.error ??
            (fallbackData as { error?: string | null } | null)?.error ??
            null;
          setAflOddsError(primaryErr);
        })
      : fetchJson(urlNoDate).then((data) => {
          if (cancelled) return;
          if (apply(data as { success?: boolean; data?: unknown[]; homeTeam?: string; awayTeam?: string; error?: string | null })) return;
          setAflOddsBooks([]);
          setAflOddsHomeTeam('');
          setAflOddsAwayTeam('');
          setAflOddsError((data as { error?: string | null } | null)?.error ?? null);
        });

    request
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
  }, [aflOddsTeam, aflOddsOpponent, aflOddsGameDate, nextGameId, aflPropsMode, teamContextTeam]);

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

    const buildBooksFromAll = (all: Record<string, PropItem[]>): AflBookRow[] => {
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
      return Array.from(bookMap.values());
    };

    // Hydrate instantly from props-page prefetch cache so bookmaker line appears with chart.
    try {
      const raw = sessionStorage.getItem('afl_player_props_prefetch');
      if (raw) {
        const prefetched = JSON.parse(raw) as {
          player?: string;
          team?: string;
          all?: Record<string, PropItem[]>;
          fetchedAt?: number;
        };
        const normalize = (v: unknown) => String(v ?? '').trim().toLowerCase();
        const ageMs = Number.isFinite(prefetched?.fetchedAt) ? Date.now() - Number(prefetched.fetchedAt) : Infinity;
        const playerMatches = normalize(prefetched?.player) === normalize(playerName);
        const teamMatches = (() => {
          const cachedTeam = normalize(prefetched?.team);
          const rawTeam = normalize(teamRaw);
          const mappedTeam = normalize(teamForProps);
          return !!cachedTeam && (cachedTeam === rawTeam || cachedTeam === mappedTeam || rawTeam.includes(cachedTeam) || cachedTeam.includes(rawTeam));
        })();
        if (ageMs < 120000 && playerMatches && teamMatches && prefetched?.all && typeof prefetched.all === 'object') {
          const prefetchedBooks = buildBooksFromAll(prefetched.all);
          if (prefetchedBooks.length > 0) {
            setAflPlayerPropsBooks((prev) => (prev.length ? mergePlayerPropsBooks(prev, prefetchedBooks) : prefetchedBooks));
            lastPlayerPropsKeyRef.current = playerKey;
          }
        }
      }
    } catch {
      // Ignore malformed prefetch cache.
    }

    const opponentFromState = aflOddsOpponent;
    const gameDateFromState = aflOddsGameDate;
    const gameIdFromState = nextGameId ?? '';

    const resolveMatchup = () => {
      if (opponentFromState || gameIdFromState) {
        return Promise.resolve({
          opponent: opponentFromState,
          gameDateForProps: gameDateFromState,
          nextGameIdFromApi: gameIdFromState,
        });
      }
      const params = new URLSearchParams({ team: teamRaw.trim(), season: String(season) });
      if (lastRound) params.set('last_round', lastRound);
      return fetch(`/api/afl/next-game?${params}`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return null;
          const opponent =
            typeof data?.next_opponent === 'string' && data.next_opponent && data.next_opponent !== '—'
              ? (opponentToOfficialTeamName(data.next_opponent) || data.next_opponent)
              : '';
          const tipoff = data?.next_game_tipoff && typeof data.next_game_tipoff === 'string' ? new Date(data.next_game_tipoff) : null;
          const tipoffValid = tipoff && Number.isFinite(tipoff.getTime()) ? tipoff : null;
          const preserveLiveGame = shouldPreserveLiveAflGame(nextGameTipoff, tipoffValid);
          const effectiveTipoff = preserveLiveGame ? nextGameTipoff : tipoffValid;
          const effectiveOpponent = preserveLiveGame ? (nextGameOpponent ?? opponent) : opponent;
          const effectiveGameId = preserveLiveGame ? (nextGameId ?? '') : (typeof data?.next_game_id === 'string' && data.next_game_id ? data.next_game_id : '');
          const gameDateForProps = effectiveTipoff ? effectiveTipoff.toISOString().split('T')[0] : '';
          if (!cancelled) {
            if (!preserveLiveGame && effectiveGameId && effectiveGameId !== nextGameId) setNextGameId(effectiveGameId);
            if (!preserveLiveGame && effectiveOpponent && effectiveOpponent !== nextGameOpponent) setNextGameOpponent(effectiveOpponent);
            if (!preserveLiveGame && effectiveTipoff && effectiveTipoff.getTime() !== nextGameTipoff?.getTime()) setNextGameTipoff(effectiveTipoff);
          }
          return { opponent: effectiveOpponent, gameDateForProps, nextGameIdFromApi: effectiveGameId };
        });
    };

    resolveMatchup()
      .then((matchup) => {
        if (cancelled || !matchup) return null;
        const { opponent, gameDateForProps, nextGameIdFromApi } = matchup;
        if (!opponent && !nextGameIdFromApi) {
          setAflPlayerPropsBooks([]);
          return null;
        }
        const teamOpp = [
          `team=${encodeURIComponent(teamForProps)}`,
          opponent ? `opponent=${encodeURIComponent(opponent)}` : '',
          gameDateForProps ? `game_date=${encodeURIComponent(gameDateForProps)}` : '',
          nextGameIdFromApi ? `event_id=${encodeURIComponent(nextGameIdFromApi)}` : '',
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
        const nextBooks = buildBooksFromAll(all);
        try {
          sessionStorage.setItem('afl_player_props_prefetch', JSON.stringify({
            player: playerName,
            team: teamRaw,
            all,
            fetchedAt: Date.now(),
          }));
        } catch {
          // Ignore sessionStorage write failures.
        }
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
  }, [aflPropsMode, selectedPlayer?.name, selectedPlayer?.team, selectedPlayer?.last_round, season, aflPlayerPropsRefetchKey, aflOddsOpponent, aflOddsGameDate, nextGameId, nextGameOpponent, nextGameTipoff]);

  useEffect(() => {
    if (aflPropsMode !== 'player' || mainChartStat !== 'disposals' || !selectedPlayer?.name || !aflOddsHomeTeam || !aflOddsAwayTeam) {
      setAflDisposalsModelProjection(null);
      setShowAflTopPicksModal(false);
      setAflDisposalsModelLoading(false);
      return;
    }

    const selectedBook = aflPlayerPropsBooks[selectedAflBookIndex];
    const fallbackLine = (() => {
      if (!selectedBook) return null;
      const market = selectedBook[selectedAflDisposalsColumn] as { line?: string } | undefined;
      if (!market?.line || market.line === 'N/A') return null;
      const n = parseFloat(String(market.line).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    })();
    const lineToUse = aflCurrentLineValue != null && Number.isFinite(aflCurrentLineValue) ? aflCurrentLineValue : fallbackLine;
    if (lineToUse == null) {
      setAflDisposalsModelProjection(null);
      setShowAflTopPicksModal(false);
      setAflDisposalsModelLoading(false);
      return;
    }

    let cancelled = false;
    setAflDisposalsModelLoading(true);
    const params = new URLSearchParams({
      playerName: String(selectedPlayer.name),
      homeTeam: aflOddsHomeTeam,
      awayTeam: aflOddsAwayTeam,
      line: String(lineToUse),
    });

    fetch(`/api/afl/model/disposals?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const projection = payload?.projection;
        if (
          projection &&
          typeof projection.expectedDisposals === 'number' &&
          typeof projection.pOver === 'number' &&
          typeof projection.pUnder === 'number'
        ) {
          setAflDisposalsModelProjection(projection as AflDisposalsModelProjection);
        } else {
          setAflDisposalsModelProjection(null);
          setShowAflTopPicksModal(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAflDisposalsModelProjection(null);
          setShowAflTopPicksModal(false);
        }
      })
      .finally(() => {
        if (!cancelled) setAflDisposalsModelLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    aflPropsMode,
    mainChartStat,
    selectedPlayer?.name,
    aflOddsHomeTeam,
    aflOddsAwayTeam,
    aflCurrentLineValue,
    selectedAflBookIndex,
    selectedAflDisposalsColumn,
    aflPlayerPropsBooks,
  ]);

  useEffect(() => {
    setShowAflTopPicksModal(false);
  }, [selectedPlayer?.name, aflDisposalsModelProjection?.gameKey, aflCurrentLineValue]);

  const openAflTopPicksModal = useCallback(() => {
    setShowAflTopPicksModal(true);
    setAflTopPicksModalLoading(true);
    fetch('/api/afl/model/disposals/top-picks?limitPerGame=3', { cache: 'no-store' })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((payload) => {
        const groups = Array.isArray(payload?.groups) ? payload.groups : [];
        setAflTopPicksByGame(groups as AflTopPicksGameGroup[]);
      })
      .catch(() => {
        setAflTopPicksByGame([]);
      })
      .finally(() => {
        setAflTopPicksModalLoading(false);
      });
  }, []);

  const refreshAflDisposalsModelForCurrentLine = useCallback(async () => {
    if (!selectedPlayer?.name || !aflOddsHomeTeam || !aflOddsAwayTeam) return;
    const lineToUse = aflCurrentLineValue;
    if (lineToUse == null || !Number.isFinite(lineToUse)) return;
    setAflDisposalsModelRefreshLoading(true);
    try {
      const res = await fetch('/api/afl/model/disposals/refresh-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: String(selectedPlayer.name),
          homeTeam: aflOddsHomeTeam,
          awayTeam: aflOddsAwayTeam,
          line: lineToUse,
        }),
      });
      if (!res.ok) return;
      const payload = (await res.json().catch(() => null)) as { projection?: AflDisposalsModelProjection } | null;
      if (payload?.projection && typeof payload.projection.expectedDisposals === 'number') {
        setAflDisposalsModelProjection(payload.projection);
      }
    } finally {
      setAflDisposalsModelRefreshLoading(false);
    }
  }, [selectedPlayer?.name, aflOddsHomeTeam, aflOddsAwayTeam, aflCurrentLineValue]);

  useEffect(() => {
    if (aflPropsMode !== 'player' || !selectedPlayer?.name) {
      setAflDisposalsPastLines([]);
      setAflDisposalsPastLinesLoading(false);
      return;
    }
    let cancelled = false;
    setAflDisposalsPastLinesLoading(true);
    const params = new URLSearchParams({
      playerName: String(selectedPlayer.name),
      limit: '20',
    });
    fetch(`/api/afl/model/disposals/history?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        setAflDisposalsPastLines(rows as AflDisposalsPastLineRow[]);
      })
      .catch(() => {
        if (!cancelled) setAflDisposalsPastLines([]);
      })
      .finally(() => {
        if (!cancelled) setAflDisposalsPastLinesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aflPropsMode, selectedPlayer?.name, aflDisposalsModelProjection?.scoredAt]);

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

  // Show search dropdown when typing.
  // Player mode: remote player search.
  // Team mode: local team filter list only (no player fetch).
  useEffect(() => {
    if (aflPropsMode === 'team') {
      if (!searchQuery.trim()) {
        setSearchResults([]);
      }
      return;
    }
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
  }, [searchQuery, aflTeamFilter, fetchPlayers, aflPropsMode]);

  const AFL_TEAM_FILTER_OPTIONS = useMemo(() => ['All', ...Object.values(ROSTER_TEAM_TO_INJURY_TEAM).sort()], []);
  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const teamOptions = AFL_TEAM_FILTER_OPTIONS.filter((t) => t !== 'All');
    if (!q) return teamOptions;
    return teamOptions.filter((t) => t.toLowerCase().includes(q));
  }, [AFL_TEAM_FILTER_OPTIONS, searchQuery]);

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

  // Prefetch game logs for current + previous two seasons (e.g. 2026/2025/2024) and merge.
  const prefetchPlayerLogs = useCallback((player: AflPlayerRecord) => {
    const name = String(player?.name ?? '').trim();
    if (!name) return;
    const teamForApi = player?.team
      ? (rosterTeamToInjuryTeam(String(player.team)) || footywireNicknameToOfficial(String(player.team)) || String(player.team))
      : '';
    const logsCacheKey = getAflPlayerLogsCacheKey(season, name, teamForApi);
    if (playerHasFootywireSlugOverride(name)) {
      prefetchedLogsRef.current.delete(logsCacheKey);
    }
    if (prefetchedLogsRef.current.has(logsCacheKey)) return;
    const teamQuery = teamForApi ? `&team=${encodeURIComponent(teamForApi)}` : '';
    const baseUrl = `/api/afl/player-game-logs?player_name=${encodeURIComponent(name)}${teamQuery}&include_both=1`;
    const currentYear = season;
    const prevYear = currentYear - 1;
    const olderYear = currentYear - 2;
    const fetchOpts = { cache: 'no-store' as RequestCache };
    Promise.all([
      fetch(`${baseUrl}&season=${currentYear}`, fetchOpts).then((r) => r.json()),
      fetch(`${baseUrl}&season=${prevYear}`, fetchOpts).then((r) => r.json()),
      fetch(`${baseUrl}&season=${olderYear}`, fetchOpts).then((r) => r.json()),
    ])
      .then(([dataCurrent, dataPrev, dataOlder]) => {
        let gamesCurrent = Array.isArray(dataCurrent?.games) ? (dataCurrent.games as Record<string, unknown>[]) : [];
        const gamesPrev = Array.isArray(dataPrev?.games) ? (dataPrev.games as Record<string, unknown>[]) : [];
        const gamesOlder = Array.isArray(dataOlder?.games) ? (dataOlder.games as Record<string, unknown>[]) : [];
        const payloadSeasonCurrent = dataCurrent?.season;
        const has2026InCurrent = gamesCurrent.length > 0 && gamesCurrent.some((g: Record<string, unknown>) => (g?.season as number) === 2026 || (typeof (g?.date ?? g?.game_date) === 'string' && String(g.date ?? g.game_date).slice(0, 4) === '2026'));
        const is2026ResponseActually2025 = currentYear === 2026 && !has2026InCurrent && (payloadSeasonCurrent === 2025 || gamesCurrent.length > 0);
        if (is2026ResponseActually2025) gamesCurrent = [];
        let qCurrent = Array.isArray(dataCurrent?.gamesWithQuarters) ? (dataCurrent.gamesWithQuarters as Record<string, unknown>[]) : gamesCurrent;
        if (is2026ResponseActually2025) qCurrent = [];
        const qPrev = Array.isArray(dataPrev?.gamesWithQuarters) ? (dataPrev.gamesWithQuarters as Record<string, unknown>[]) : gamesPrev;
        const qOlder = Array.isArray(dataOlder?.gamesWithQuarters) ? (dataOlder.gamesWithQuarters as Record<string, unknown>[]) : gamesOlder;
        const games = dedupeAflGames([...gamesCurrent, ...gamesPrev, ...gamesOlder]);
        const gamesWithQuarters = dedupeAflGames([...qCurrent, ...qPrev, ...qOlder]);
        if (games.length === 0) return;
        const data = gamesCurrent.length > 0 ? dataCurrent : (gamesPrev.length > 0 ? dataPrev : dataOlder);
        const latest = games[0];
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
          const last5Values = values.slice(0, 5);
          const last10Values = values.slice(0, 10);
          const last5Avg = last5Values.length ? Math.round((last5Values.reduce((s, v) => s + v, 0) / last5Values.length) * 10) / 10 : 0;
          const last10Avg = last10Values.length ? Math.round((last10Values.reduce((s, v) => s + v, 0) / last10Values.length) * 10) / 10 : 0;
          toMerge[`${key}_season_avg`] = seasonAvg;
          toMerge[`${key}_last_game`] = lastGame;
          toMerge[`${key}_last5_avg`] = last5Avg;
          toMerge[`${key}_last10_avg`] = last10Avg;
        }
        if (typeof latest.opponent === 'string') toMerge.last_opponent = latest.opponent;
        if (typeof latest.round === 'string') toMerge.last_round = latest.round;
        if (typeof latest.result === 'string') toMerge.last_result = latest.result;
        if (typeof latest.guernsey === 'number' && Number.isFinite(latest.guernsey)) toMerge.guernsey = latest.guernsey;
        if (typeof data?.height === 'string' && data.height.trim()) toMerge.height = data.height.trim();
        if (typeof data?.team === 'string' && data.team.trim()) toMerge.team = data.team.trim();
        prefetchedLogsRef.current.set(logsCacheKey, {
          games: games as AflGameLogRecord[],
          gamesWithQuarters: gamesWithQuarters as AflGameLogRecord[],
          mergedStats: toMerge as AflPlayerRecord,
        });
      })
      .catch(() => {});
  }, [season]);

  const selectPlayerFromSidebarHotPick = useCallback(
    (player: { name: string; team?: string }) => {
      const name = String(player.name ?? '').trim();
      if (!name) return;
      const record: AflPlayerRecord = {
        name,
        ...(player.team && String(player.team).trim() ? { team: String(player.team).trim() } : {}),
      };
      setSearchQuery('');
      setShowSearchDropdown(false);
      setSelectedPlayer(record);
      setAflPropsMode('player');
      setAflRightTab('dvp');
      setLoadingPlayerFromUrl(false);
      setSelectedPlayerGameLogs([]);
      setSelectedPlayerGameLogsWithQuarters([]);
      setStatsLoadingForPlayer(true);
      prefetchPlayerLogs(record);
    },
    [prefetchPlayerLogs]
  );

  // Fetch FootyWire game logs for the selected player.
  useEffect(() => {
    const playerName = selectedPlayer?.name;
    if (!playerName) return;
    if (loadingPlayerFromUrl) return;
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
    const shouldBypassClientLogsCache = season === new Date().getFullYear();
    const has2026InGames = (g: { season?: unknown }[]) =>
      Array.isArray(g) && g.some((x) => (x?.season as number) === 2026);
    const has2025InGames = (g: { season?: unknown; date?: string; game_date?: string }[]) =>
      Array.isArray(g) && g.some((x) => (x?.season as number) === 2025 || (typeof (x?.date ?? x?.game_date) === 'string' && String(x?.date ?? x?.game_date).slice(0, 4) === '2025'));
    // For 2026 we need both seasons so players who changed teams (e.g. Bailey Smith) get 2025 + 2026. Don't use cache/prefetch that only has 2026.
    const cacheOkFor2026 = (games: { season?: unknown; date?: string; game_date?: string }[]) =>
      season !== 2026 || (has2026InGames(games) && has2025InGames(games));
    // Symbol-name players and FootyWire slug-collision players: never use prefetched or localStorage — always fetch fresh.
    const isSymbolPlayer = playerNameHasSymbol(String(playerName));
    const isFootywireSlugOverridePlayer = playerHasFootywireSlugOverride(String(playerName));
    const needsStaleLogBypass = isSymbolPlayer || isFootywireSlugOverridePlayer;
    if (isFootywireSlugOverridePlayer) {
      prefetchedLogsRef.current.delete(logsCacheKey);
      try {
        localStorage.removeItem(logsCacheKey);
      } catch {
        // Ignore.
      }
    }
    if (!needsStaleLogBypass && !shouldBypassClientLogsCache) {
      const prefetched = prefetchedLogsRef.current.get(logsCacheKey);
      if (prefetched && (season !== 2026 || has2026InGames(prefetched.games)) && cacheOkFor2026(prefetched.games)) {
        prefetchedLogsRef.current.delete(logsCacheKey);
        setSelectedPlayerGameLogs(dedupeAflGames(prefetched.games as Record<string, unknown>[]) as AflGameLogRecord[]);
        setSelectedPlayerGameLogsWithQuarters(
          dedupeAflGames(prefetched.gamesWithQuarters as Record<string, unknown>[]) as AflGameLogRecord[]
        );
        if (Object.keys(prefetched.mergedStats).length) {
          setSelectedPlayer((prev) => (prev ? ({ ...prev, ...prefetched.mergedStats } as AflPlayerRecord) : prev));
          playerStatsCacheRef.current.set(cacheKey, prefetched.mergedStats as AflPlayerRecord);
        }
        setStatsLoadingForPlayer(false);
        return;
      }
      if (prefetched) prefetchedLogsRef.current.delete(logsCacheKey);
    } else {
      prefetchedLogsRef.current.delete(logsCacheKey);
    }
    if (needsStaleLogBypass) {
      try {
        localStorage.removeItem(logsCacheKey);
      } catch {
        // Ignore.
      }
    }
    if (!needsStaleLogBypass && !shouldBypassClientLogsCache) {
      try {
        const raw = localStorage.getItem(logsCacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as CachedAflPlayerLogs;
          const isFresh = Number.isFinite(parsed?.createdAt) && (Date.now() - Number(parsed.createdAt) <= AFL_PLAYER_LOGS_CACHE_TTL_MS);
          const gamesOk = Array.isArray(parsed.games);
          const gamesTyped = parsed.games as { season?: unknown; date?: string; game_date?: string }[];
          const has2026 = season !== 2026 || has2026InGames(gamesTyped);
          const bothSeasonsOk = cacheOkFor2026(gamesTyped);
          if (isFresh && gamesOk && has2026 && bothSeasonsOk) {
            setSelectedPlayerGameLogs(dedupeAflGames(parsed.games as Record<string, unknown>[]) as AflGameLogRecord[]);
            setSelectedPlayerGameLogsWithQuarters(
              dedupeAflGames(
                (Array.isArray(parsed.gamesWithQuarters) ? parsed.gamesWithQuarters : []) as Record<string, unknown>[]
              ) as AflGameLogRecord[]
            );
            if (parsed.mergedStats && typeof parsed.mergedStats === 'object') {
              setSelectedPlayer((prev) => (prev ? { ...prev, ...parsed.mergedStats } : prev));
              playerStatsCacheRef.current.set(cacheKey, parsed.mergedStats);
            }
            setStatsLoadingForPlayer(false);
            return;
          }
          if (gamesOk && season === 2026 && (!has2026InGames(gamesTyped) || !has2025InGames(gamesTyped))) {
            try {
              localStorage.removeItem(logsCacheKey);
            } catch {
              // Ignore.
            }
          }
        }
      } catch {
        // Ignore malformed local cache.
      }
    }
    const teamQuery = teamForApi ? `&team=${encodeURIComponent(teamForApi)}` : '';
    const baseUrl = `/api/afl/player-game-logs?player_name=${encodeURIComponent(String(playerName))}${teamQuery}&include_both=1`;

    let cancelled = false;
    setStatsLoadingForPlayer(true);
    const searchStartedAtMs = Date.now();
    const currentYear = season;
    const prevYear = currentYear - 1;
    const olderYear = currentYear - 2;
    // Do not pass force_fetch from the browser: it bypasses Redis + FootyWire memory cache and
    // blocks ~20s+ per season while scraping live. Freshness is handled by TTL, cron warm, and
    // localStorage invalidation when 2026/2025 mix looks wrong.
    const fetchOpts = { cache: 'no-store' as RequestCache }; // Avoid stale 2025 empty response in production
    type SeasonFetchResult = { ok: boolean; data: Record<string, unknown> };
    const emptyOlderSeason: SeasonFetchResult = { ok: true, data: { games: [], gamesWithQuarters: [] } };
    (async () => {
      const fetchSeason = (year: number, force = '') =>
        fetch(`${baseUrl}&season=${year}${force}`, fetchOpts).then(async (res) => {
          const d = (await res.json()) as Record<string, unknown>;
          return { ok: res.ok, data: d } as SeasonFetchResult;
        });

      const applyMergedSeasonResults = (
        resultCurrent: SeasonFetchResult,
        resultPrev: SeasonFetchResult,
        resultOlder: SeasonFetchResult,
      ) => {
        if (cancelled) return;
        const dataCurrent = resultCurrent.data;
        const dataPrev = resultPrev.data;
        const dataOlder = resultOlder.data;
        let gamesCurrent = resultCurrent.ok && Array.isArray(dataCurrent?.games) ? (dataCurrent.games as Record<string, unknown>[]) : [];
        const gamesPrev = resultPrev.ok && Array.isArray(dataPrev?.games) ? (dataPrev.games as Record<string, unknown>[]) : [];
        const gamesOlder = resultOlder.ok && Array.isArray(dataOlder?.games) ? (dataOlder.games as Record<string, unknown>[]) : [];
        const payloadSeasonCurrent = dataCurrent?.season;
        const has2026InCurrent = gamesCurrent.length > 0 && gamesCurrent.some((g: Record<string, unknown>) => (g?.season as number) === 2026 || (typeof (g?.date ?? g?.game_date) === 'string' && String(g.date ?? g.game_date).slice(0, 4) === '2026'));
        const is2026ResponseActually2025 = currentYear === 2026 && !has2026InCurrent && (payloadSeasonCurrent === 2025 || gamesCurrent.length > 0);
        if (is2026ResponseActually2025) {
          gamesCurrent = [];
        }
        let qCurrent = Array.isArray(dataCurrent?.gamesWithQuarters) ? (dataCurrent.gamesWithQuarters as Record<string, unknown>[]) : gamesCurrent;
        if (is2026ResponseActually2025) qCurrent = [];
        const qPrev = Array.isArray(dataPrev?.gamesWithQuarters) ? (dataPrev.gamesWithQuarters as Record<string, unknown>[]) : gamesPrev;
        const qOlder = Array.isArray(dataOlder?.gamesWithQuarters) ? (dataOlder.gamesWithQuarters as Record<string, unknown>[]) : gamesOlder;
        const games = dedupeAflGames([...gamesCurrent, ...gamesPrev, ...gamesOlder]);
        const gamesWithQuarters = dedupeAflGames([...qCurrent, ...qPrev, ...qOlder]);
        const data = gamesCurrent.length > 0 ? dataCurrent : (gamesPrev.length > 0 ? dataPrev : dataOlder);
        setSelectedPlayerGameLogs(games);
        setSelectedPlayerGameLogsWithQuarters(gamesWithQuarters);
        if (games.length === 0) {
          const elapsedMs = Date.now() - searchStartedAtMs;
          if (elapsedMs >= 7000) {
            setLastStatsError('No game logs found for this player/season');
          } else {
            setLastStatsError(null);
          }
          setStatsLoadingForPlayer(false);
          return;
        }
        const latest = games[0];
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
          const last5Values = values.slice(0, 5);
          const last10Values = values.slice(0, 10);
          const last5Avg = last5Values.length
            ? Math.round((last5Values.reduce((s, v) => s + v, 0) / last5Values.length) * 10) / 10
            : 0;
          const last10Avg = last10Values.length
            ? Math.round((last10Values.reduce((s, v) => s + v, 0) / last10Values.length) * 10) / 10
            : 0;

          toMerge[`${key}_season_avg`] = seasonAvg;
          toMerge[`${key}_last_game`] = lastGame;
          toMerge[`${key}_last5_avg`] = last5Avg;
          toMerge[`${key}_last10_avg`] = last10Avg;
        }

        if (typeof latest.opponent === 'string') toMerge.last_opponent = latest.opponent;
        if (typeof latest.round === 'string') toMerge.last_round = latest.round;
        if (typeof latest.result === 'string') toMerge.last_result = latest.result;
        if (typeof latest.guernsey === 'number' && Number.isFinite(latest.guernsey)) toMerge.guernsey = latest.guernsey;
        if (typeof data?.height === 'string' && data.height.trim()) toMerge.height = data.height.trim();
        if (typeof data?.team === 'string' && data.team.trim()) toMerge.team = data.team.trim();

        playerStatsCacheRef.current.set(cacheKey, toMerge);
        setSelectedPlayer((prev) => (prev ? { ...prev, ...toMerge } : prev));
        const mergedHas2025 = games.some((g: Record<string, unknown>) => (g?.season as number) === 2025 || (typeof (g?.date ?? g?.game_date) === 'string' && String(g?.date ?? g?.game_date ?? '').slice(0, 4) === '2025'));
        const mergedHas2026 = currentYear !== 2026 || games.some((g: Record<string, unknown>) => (g?.season as number) === 2026 || (typeof (g?.date ?? g?.game_date) === 'string' && String(g?.date ?? g?.game_date ?? '').slice(0, 4) === '2026'));
        const persistOk = currentYear !== 2026 || (mergedHas2025 && mergedHas2026);
        if (!isSymbolPlayer && persistOk) {
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
        }
      };

      const countMergedGames = (rc: SeasonFetchResult, rp: SeasonFetchResult, ro: SeasonFetchResult) => {
        const dataCurrent = rc.data;
        const dataPrev = rp.data;
        const dataOlder = ro.data;
        let gamesCurrent = rc.ok && Array.isArray(dataCurrent?.games) ? (dataCurrent.games as Record<string, unknown>[]) : [];
        const gamesPrev = rp.ok && Array.isArray(dataPrev?.games) ? (dataPrev.games as Record<string, unknown>[]) : [];
        const gamesOlder = ro.ok && Array.isArray(dataOlder?.games) ? (dataOlder.games as Record<string, unknown>[]) : [];
        const payloadSeasonCurrent = dataCurrent?.season;
        const has2026InCurrent = gamesCurrent.length > 0 && gamesCurrent.some((g: Record<string, unknown>) => (g?.season as number) === 2026 || (typeof (g?.date ?? g?.game_date) === 'string' && String(g.date ?? g.game_date).slice(0, 4) === '2026'));
        const is2026ResponseActually2025 = currentYear === 2026 && !has2026InCurrent && (payloadSeasonCurrent === 2025 || gamesCurrent.length > 0);
        if (is2026ResponseActually2025) gamesCurrent = [];
        return dedupeAflGames([...gamesCurrent, ...gamesPrev, ...gamesOlder]).length;
      };

      try {
        const p1 = fetchSeason(currentYear, '');
        const p2 = fetchSeason(prevYear);
        const p3 = fetchSeason(olderYear);
        const [resultCurrent, resultPrev] = await Promise.all([p1, p2]);
        if (cancelled) return;

        const mergedCountWithoutOldest = countMergedGames(resultCurrent, resultPrev, emptyOlderSeason);
        if (mergedCountWithoutOldest === 0) {
          const resultOlder = await p3;
          if (cancelled) return;
          applyMergedSeasonResults(resultCurrent, resultPrev, resultOlder);
        } else if (mergedCountWithoutOldest >= AFL_DEFER_OLDEST_SEASON_WHEN_GAME_COUNT_AT_LEAST) {
          applyMergedSeasonResults(resultCurrent, resultPrev, emptyOlderSeason);
          p3.then((resultOlder) => {
            if (cancelled) return;
            applyMergedSeasonResults(resultCurrent, resultPrev, resultOlder);
          });
        } else {
          const resultOlder = await p3;
          if (cancelled) return;
          applyMergedSeasonResults(resultCurrent, resultPrev, resultOlder);
        }
      } catch (e) {
        if (!cancelled) {
          const elapsedMs = Date.now() - searchStartedAtMs;
          if (elapsedMs >= 7000) {
            setLastStatsError(e instanceof Error ? e.message : 'Failed to load game logs');
          } else {
            setLastStatsError(null);
          }
          setSelectedPlayerGameLogs([]);
        }
      } finally {
        if (!cancelled) setStatsLoadingForPlayer(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlayer?.name, selectedPlayer?.team, season, loadingPlayerFromUrl]);

  // Fetch DFS role label for top header context (e.g. MID - INS MID). Pass fantasy DvP so we can
  // still show RUC → RUCK when the DFS role JSON is empty or missing the player.
  useEffect(() => {
    const playerName = selectedPlayer?.name ? String(selectedPlayer.name).trim() : '';
    if (aflPropsMode !== 'player' || !playerName) {
      setSelectedPlayerDfsRole(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dvp = toDvpPositionLabel(selectedPlayer?.position);
        const q = new URLSearchParams();
        q.set('player', playerName);
        if (dvp) q.set('dvp', dvp);
        const res = await fetch(`/api/afl/dfs-role?${q.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const fromApi =
          typeof json?.shortLabel === 'string' && json.shortLabel.trim()
            ? json.shortLabel.trim()
            : null;
        const label =
          fromApi ?? dfsRoleGroupToHeaderLabel(typeof json?.roleGroup === 'string' ? json.roleGroup : null);
        setSelectedPlayerDfsRole(label);

        const rbRaw = json?.roleBucket;
        const rb =
          typeof rbRaw === 'string' && ['DEF', 'MID', 'FWD', 'RUC'].includes(rbRaw.trim().toUpperCase())
            ? (rbRaw.trim().toUpperCase() as 'DEF' | 'MID' | 'FWD' | 'RUC')
            : null;
        if (json?.success === true && rb) {
          setSelectedPlayer((prev) => {
            if (!prev || cancelled) return prev;
            const cur = String(prev.position ?? '')
              .trim()
              .toUpperCase();
            if (cur === 'DEF' || cur === 'MID' || cur === 'FWD' || cur === 'RUC') return prev;
            return { ...prev, position: rb };
          });
        }
      } catch {
        if (!cancelled) setSelectedPlayerDfsRole(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlayer?.name, selectedPlayer?.position, aflPropsMode]);

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

  // Team mode: fetch club-level logs aggregated from multiple players on that club,
  // so the chart reflects team games rather than one player's appearances.
  useEffect(() => {
    if (aflPropsMode !== 'team') {
      setTeamModeSelectedTeamLogs([]);
      return;
    }
    const selectedTeam = String(teamContextTeam ?? '').trim();
    if (!selectedTeam) {
      setTeamModeSelectedTeamLogs([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [curRes, prevRes, olderRes] = await Promise.all([
          fetch(`/api/afl/team-game-logs?season=${season}&team=${encodeURIComponent(selectedTeam)}`, { cache: 'no-store' }),
          fetch(`/api/afl/team-game-logs?season=${season - 1}&team=${encodeURIComponent(selectedTeam)}`, { cache: 'no-store' }),
          fetch(`/api/afl/team-game-logs?season=${season - 2}&team=${encodeURIComponent(selectedTeam)}`, { cache: 'no-store' }),
        ]);
        const [curJson, prevJson, olderJson] = await Promise.all([curRes.json(), prevRes.json(), olderRes.json()]);

        const curLogs = curRes.ok
          ? (Array.isArray(curJson?.gamesWithQuarters) ? (curJson.gamesWithQuarters as AflGameLogRecord[]) : (Array.isArray(curJson?.games) ? (curJson.games as AflGameLogRecord[]) : []))
          : [];
        const prevLogs = prevRes.ok
          ? (Array.isArray(prevJson?.gamesWithQuarters) ? (prevJson.gamesWithQuarters as AflGameLogRecord[]) : (Array.isArray(prevJson?.games) ? (prevJson.games as AflGameLogRecord[]) : []))
          : [];
        const olderLogs = olderRes.ok
          ? (Array.isArray(olderJson?.gamesWithQuarters) ? (olderJson.gamesWithQuarters as AflGameLogRecord[]) : (Array.isArray(olderJson?.games) ? (olderJson.games as AflGameLogRecord[]) : []))
          : [];

        if (!cancelled) {
          setTeamModeSelectedTeamLogs(dedupeAflGames([...curLogs, ...prevLogs, ...olderLogs] as Record<string, unknown>[]) as AflGameLogRecord[]);
        }
      } catch {
        if (!cancelled) setTeamModeSelectedTeamLogs([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [aflPropsMode, aflTeamFilter, teamContextTeam, season]);

  const aflTeamGamePropsLogs = useMemo(() => {
    if (aflPropsMode !== 'team') return [];
    // Team mode must always chart the team's full game log, not the currently selected player's
    // personal log. Using player logs here makes the team chart look like the club has only
    // played as many games as that player has appeared in.
    return teamModeSelectedTeamLogs.map((g, idx) => {
      const result = String(g.result ?? '').trim();
      const scores = parseAflScoresFromResult(result);
      const parsedGoals = parseAflGoalsFromResult(result);
      const teamGoals = toFiniteNumber(g.team_goals) ?? parsedGoals?.team ?? null;
      const opponentGoals = toFiniteNumber(g.opponent_goals) ?? parsedGoals?.opponent ?? null;
      const venue =
        (typeof g.venue === 'string' && g.venue.trim()) ? g.venue.trim()
          : (typeof g.ground === 'string' && g.ground.trim()) ? g.ground.trim()
          : (typeof g.stadium === 'string' && g.stadium.trim()) ? g.stadium.trim()
          : (typeof g.location === 'string' && g.location.trim()) ? g.location.trim()
          : null;
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
        ...(venue ? { venue } : {}),
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
  }, [
    aflPropsMode,
    teamModeSelectedTeamLogs,
  ]);

  // Fetch DVP batch and OA for game filters (player mode only). Use the player's position so DvP matches their role (DEF/MID/FWD/RUC).
  const dvpSeason = Math.min(season, 2026);
  const playerPositionForFilters = useMemo(
    () =>
      aflPropsMode === 'player' && selectedPlayer?.position && ['DEF', 'MID', 'FWD', 'RUC'].includes(String(selectedPlayer.position))
        ? String(selectedPlayer.position)
        : null,
    [aflPropsMode, selectedPlayer?.position]
  );
  useEffect(() => {
    if (aflPropsMode !== 'player' || !selectedPlayer || selectedPlayerGameLogs.length === 0) {
      setAflFilterDataDvp(null);
      return;
    }
    const pos =
      (playerPositionForFilters && ['DEF', 'MID', 'FWD', 'RUC'].includes(playerPositionForFilters)
        ? playerPositionForFilters
        : null) || 'MID';
    let cancelled = false;
    Promise.all([
      fetch(
        `/api/afl/dvp/batch?season=${dvpSeason}&position=${pos}&stats=disposals,kicks,handballs,marks,goals,tackles,clearances,inside_50s,uncontested_possessions,contested_possessions,free_kicks_for,meters_gained,free_kicks_against`
      ).then((r) => (r.ok ? r.json() : null)),
    ]).then(([dvpRes]) => {
      if (cancelled) return;
      if (dvpRes?.success && dvpRes?.metrics) {
        setAflFilterDataDvp({ opponents: dvpRes.opponents || [], metrics: dvpRes.metrics });
      } else {
        setAflFilterDataDvp(null);
      }
    }).catch(() => {
      if (!cancelled) {
        setAflFilterDataDvp(null);
      }
    });
    return () => { cancelled = true; };
  }, [aflPropsMode, selectedPlayer?.id, selectedPlayerGameLogs.length, dvpSeason, playerPositionForFilters]);

  // Advanced pill code -> DvP metric key (single source of truth for all AFL rank filters).
  const ADVANCED_STAT_CODE_TO_DVP_METRIC: Record<string, string> = {
    D: 'disposals',
    K: 'kicks',
    HB: 'handballs',
    UP: 'uncontested_possessions',
    CP: 'contested_possessions',
    FF: 'free_kicks_for',
    M: 'marks',
    G: 'goals',
    T: 'tackles',
    CL: 'clearances',
    I50: 'inside_50s',
    FA: 'free_kicks_against',
    MG: 'meters_gained',
  };
  const selectedAdvancedDvpMetric = CHART_STAT_TO_DVP_METRIC[mainChartStat] ?? aflGameFilters.dvpMetric ?? 'disposals';
  const selectedAdvancedOpponentMetric =
    ADVANCED_STAT_CODE_TO_DVP_METRIC[aflGameFilters.opponentStat ?? 'D'] ?? 'disposals';

  useEffect(() => {
    if (aflPropsMode !== 'player' || !selectedPlayer || selectedPlayerGameLogs.length === 0) {
      setAflOaRankSnapshots(null);
      setAflDvpRankSnapshots(null);
      return;
    }
    const pos =
      (playerPositionForFilters && ['DEF', 'MID', 'FWD', 'RUC'].includes(playerPositionForFilters)
        ? playerPositionForFilters
        : null) || 'MID';
    let cancelled = false;
    // Clear prior snapshots immediately so per-game filter falls back to current selected stat
    // data while the new metric snapshots are loading.
    setAflOaRankSnapshots(null);
    setAflDvpRankSnapshots(null);
    Promise.all([
      fetch(
        `/api/afl/rank-snapshots/history?season=${dvpSeason}&source=dvp&position=${encodeURIComponent(pos)}&metric=${encodeURIComponent(selectedAdvancedOpponentMetric)}`
      ).then((r) => (r.ok ? r.json() : null)),
      fetch(
        `/api/afl/rank-snapshots/history?season=${dvpSeason}&source=dvp&position=${encodeURIComponent(pos)}&metric=${encodeURIComponent(selectedAdvancedDvpMetric)}`
      ).then((r) => (r.ok ? r.json() : null)),
    ]).then(([oppHist, dvpHist]) => {
      if (cancelled) return;
      const oaSnapshots = Array.isArray(oppHist?.snapshots) ? oppHist.snapshots : [];
      const dvpSnapshots = Array.isArray(dvpHist?.snapshots) ? dvpHist.snapshots : [];
      setAflOaRankSnapshots(oaSnapshots);
      setAflDvpRankSnapshots(dvpSnapshots);
    }).catch(() => {
      if (!cancelled) {
        setAflOaRankSnapshots(null);
        setAflDvpRankSnapshots(null);
      }
    });
    return () => { cancelled = true; };
  }, [
    aflPropsMode,
    selectedPlayer?.id,
    selectedPlayerGameLogs.length,
    dvpSeason,
    playerPositionForFilters,
    selectedAdvancedOpponentMetric,
    selectedAdvancedDvpMetric,
  ]);

  // Chart primarily uses selectedPlayerGameLogs; enrich those rows with venue from
  // gamesWithQuarters so Splits > Venue can filter reliably.
  const selectedPlayerGameLogsForChart = useMemo(() => {
    if (!selectedPlayerGameLogs.length) return selectedPlayerGameLogs;
    const dedupedBaseLogs = dedupeAflGames(selectedPlayerGameLogs as Record<string, unknown>[]) as AflGameLogRecord[];
    if (!selectedPlayerGameLogsWithQuarters.length) return dedupedBaseLogs;

    const venueByKey = new Map<string, string>();
    for (const game of selectedPlayerGameLogsWithQuarters) {
      const row = game as Record<string, unknown>;
      const venueRaw = row.venue ?? row.ground ?? row.stadium ?? row.location;
      const venue = typeof venueRaw === 'string' ? venueRaw.trim() : '';
      if (!venue) continue;
      const key = buildAflGameIdentityKey(row);
      if (!key) continue;
      if (!venueByKey.has(key)) venueByKey.set(key, venue);
    }

    return dedupedBaseLogs.map((game) => {
      const row = game as Record<string, unknown>;
      const existingVenueRaw = row.venue ?? row.ground ?? row.stadium ?? row.location;
      const existingVenue = typeof existingVenueRaw === 'string' ? existingVenueRaw.trim() : '';
      if (existingVenue) return game;
      const key = buildAflGameIdentityKey(row);
      const matchedVenue = venueByKey.get(key);
      if (!matchedVenue) return game;
      return { ...row, venue: matchedVenue } as AflGameLogRecord;
    });
  }, [selectedPlayerGameLogs, selectedPlayerGameLogsWithQuarters]);

  // Per-game filter data for the current player's games (DVP rank, opponent rank, TOG).
  // Rank source is DvP only (snapshots first, then latest DvP batch), no OA/stale derived fallbacks.
  const perGameFilterData = useMemo((): AflGameFilterDataItem[] | null => {
    if (!selectedPlayerGameLogsForChart.length) return null;
    const dvp = aflFilterDataDvp;
    const metric = selectedAdvancedDvpMetric;
    const opponentMetric = selectedAdvancedOpponentMetric;

    const buildRanksByOpponent = (rankMapRaw: Record<string, number> | undefined): Record<string, number> => {
      const out: Record<string, number> = {};
      if (!rankMapRaw) return out;
      for (const [teamRaw, rankRaw] of Object.entries(rankMapRaw)) {
        const rank = Number(rankRaw);
        const team = String(teamRaw ?? '').trim();
        if (!team || !Number.isFinite(rank)) continue;
        out[team] = rank;
        out[team.toLowerCase()] = rank;
        const footy = opponentToFootywireTeam(team);
        if (footy) {
          out[footy] = rank;
          out[footy.toLowerCase()] = rank;
        }
        const official = opponentToOfficialTeamName(team) || (footy ? opponentToOfficialTeamName(footy) : null);
        if (official) {
          out[official] = rank;
          out[official.toLowerCase()] = rank;
        }
      }
      return out;
    };

    const dvpRanksByOpp = buildRanksByOpponent(dvp?.metrics?.[metric]?.teamTotalRanks);
    const opponentRanksByOpp = buildRanksByOpponent(dvp?.metrics?.[opponentMetric]?.teamTotalRanks);

    const getSnapshotRank = (
      snapshots: AflHistoricalRankSnapshot[] | null,
      gameDateRaw: string,
      teamKeys: string[]
    ): number | null => {
      if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
      const gameDate =
        gameDateRaw && Number.isFinite(Date.parse(gameDateRaw))
          ? new Date(gameDateRaw).toISOString().slice(0, 10)
          : null;
      let chosen = null as AflHistoricalRankSnapshot | null;
      if (gameDate) {
        for (const snap of snapshots) {
          if (snap.snapshotDate <= gameDate) chosen = snap;
          else break;
        }
      }
      // If game is older than first snapshot, use the latest snapshot we have now.
      if (!chosen) chosen = snapshots[snapshots.length - 1] ?? null;
      if (!chosen) return null;
      for (const key of teamKeys) {
        const rank = Number(chosen.ranks[key]);
        if (Number.isFinite(rank) && rank > 0) return rank;
      }
      return null;
    };

    return selectedPlayerGameLogsForChart.map((g, gameIndex) => {
      const oppRaw = String((g as Record<string, unknown>)?.opponent ?? '').trim();
      const oppFooty = opponentToFootywireTeam(oppRaw) || oppRaw;
      const oppOfficial = opponentToOfficialTeamName(oppRaw) || oppRaw;
      const oppNorm = oppRaw.toLowerCase();
      const gameDateRaw = String((g as Record<string, unknown>)?.date ?? (g as Record<string, unknown>)?.game_date ?? '').trim();
      const teamKeys = [
        oppNorm,
        String(oppFooty || '').toLowerCase(),
        String(oppOfficial || '').toLowerCase(),
      ].filter(Boolean);
      const snapshotDvpRank = getSnapshotRank(aflDvpRankSnapshots, gameDateRaw, teamKeys);
      const snapshotOppRank = getSnapshotRank(aflOaRankSnapshots, gameDateRaw, teamKeys);
      const dvpRank =
        snapshotDvpRank ??
        dvpRanksByOpp[oppRaw] ??
        dvpRanksByOpp[oppNorm] ??
        dvpRanksByOpp[oppFooty] ??
        dvpRanksByOpp[oppFooty.toLowerCase()] ??
        dvpRanksByOpp[oppOfficial] ??
        dvpRanksByOpp[oppOfficial.toLowerCase()] ??
        null;
      const dvpRankSource: 'tipoff' | 'live' | null =
        snapshotDvpRank != null ? 'tipoff' : dvpRank != null ? 'live' : null;
      const opponentRank =
        snapshotOppRank ??
        opponentRanksByOpp[oppRaw] ??
        opponentRanksByOpp[oppNorm] ??
        opponentRanksByOpp[oppFooty] ??
        opponentRanksByOpp[oppFooty.toLowerCase()] ??
        opponentRanksByOpp[oppOfficial] ??
        opponentRanksByOpp[oppOfficial.toLowerCase()] ??
        null;
      const togRaw = (g as Record<string, unknown>)?.percent_played;
      const tog = typeof togRaw === 'number' && Number.isFinite(togRaw) ? togRaw : null;
      return { gameIndex, opponent: oppRaw, dvpRank, dvpRankSource, opponentRank, tog };
    });
  }, [
    selectedPlayerGameLogsForChart,
    aflFilterDataDvp,
    selectedAdvancedDvpMetric,
    selectedAdvancedOpponentMetric,
    aflDvpRankSnapshots,
    aflOaRankSnapshots,
  ]);

  // Apply game filters to get the list of games used for chart and supporting stats.
  const filteredPlayerGameLogs = useMemo(() => {
    const withSourceIndex = (logs: AflGameLogRecord[]) =>
      logs.map((g, i) => ({ ...(g as Record<string, unknown>), __aflGameIndex: i }));

    if (aflPropsMode !== 'player' || !perGameFilterData?.length) return withSourceIndex(selectedPlayerGameLogsForChart);
    const f = aflGameFilters;
    const hasDvp = f.dvpRankMin != null || f.dvpRankMax != null;
    const hasOpp = f.opponentRankMin != null || f.opponentRankMax != null;
    const hasTog = f.togMin != null || f.togMax != null;
    if (!hasDvp && !hasOpp && !hasTog) return withSourceIndex(selectedPlayerGameLogsForChart);

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
    const filtered = selectedPlayerGameLogsForChart
      .map((g, i) => ({ ...(g as Record<string, unknown>), __aflGameIndex: i }))
      .filter((g) => indices.has(Number((g as Record<string, unknown>).__aflGameIndex)));
    return filtered;
  }, [aflPropsMode, selectedPlayerGameLogsForChart, perGameFilterData, aflGameFilters]);

  const getCurrentSeasonAvg = (statKey: string): number | null => {
    if (!selectedPlayerGameLogs.length) return null;
    const effectiveSeason = Math.min(season, 2026);
    const gamesThisSeason = selectedPlayerGameLogs.filter((g) => {
      const s = Number((g as Record<string, unknown>)?.season);
      if (Number.isFinite(s)) return s === effectiveSeason;
      const date = (g as Record<string, unknown>)?.date ?? (g as Record<string, unknown>)?.game_date;
      if (typeof date === 'string' && date.length >= 4) {
        const year = Number(date.slice(0, 4));
        return Number.isFinite(year) && year === effectiveSeason;
      }
      return false;
    });
    if (!gamesThisSeason.length) return null;
    const values = gamesThisSeason
      .map((g) => Number((g as Record<string, unknown>)?.[statKey]))
      .filter((v) => Number.isFinite(v));
    if (!values.length) return null;
    const total = values.reduce((sum, v) => sum + v, 0);
    const avg = total / values.length;
    return Math.round(avg * 10) / 10;
  };

  const playerVsTeamOpponentKey = (): string | null => {
    const raw =
      aflTeamFilter !== 'All' && aflTeamFilter
        ? aflTeamFilter
        : (matchupOpponent || '');
    if (!raw) return null;
    return (
      rosterTeamToInjuryTeam(raw) ||
      opponentToOfficialTeamName(raw) ||
      toOfficialAflTeamDisplayName(raw) ||
      raw
    );
  };

  const getOpponentTeamStatsRow = (): AflTeamRankingRow | null => {
    const key = playerVsTeamOpponentKey();
    const teams = aflOpponentTeamAverages;
    if (!key || !teams?.length) return null;
    const normalize = (v: string) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const targetCandidates = Array.from(
      new Set(
        [
          key,
          normalize(key),
          rosterTeamToInjuryTeam(key),
          opponentToOfficialTeamName(key),
          toOfficialAflTeamDisplayName(key),
          opponentToFootywireTeam(key),
        ]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .flatMap((v) => [v, normalize(v)])
      )
    );
    const targetDisplay = normalize(toOfficialAflTeamDisplayName(key));
    for (const row of teams) {
      const rowCandidates = Array.from(
        new Set(
          [
            row.team,
            normalize(row.team),
            rosterTeamToInjuryTeam(row.team),
            opponentToOfficialTeamName(row.team),
            toOfficialAflTeamDisplayName(row.team),
            opponentToFootywireTeam(row.team),
          ]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .flatMap((v) => [v, normalize(v)])
        )
      );
      if (rowCandidates.some((c) => targetCandidates.includes(c))) return row;
      if (normalize(toOfficialAflTeamDisplayName(row.team)) === targetDisplay) return row;
    }
    return null;
  };

  const ADVANCED_STAT_CODE_TO_TEAM_RANKING_COLUMN: Record<string, string> = {
    D: 'D',
    K: 'K',
    HB: 'HB',
    UP: 'UP',
    CP: 'CP',
    FF: 'FF',
    MG: 'MG',
    G: 'G',
  };

  const getOpponentSeasonAvg = (statCode: string): number | null => {
    const row = getOpponentTeamStatsRow();
    if (!row) return null;
    const col = ADVANCED_STAT_CODE_TO_TEAM_RANKING_COLUMN[statCode];
    if (!col) return null;
    const n = Number(row.stats?.[col]);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
  };

  const getOpponentSeasonRank = (statCode: string): number | null => {
    const row = getOpponentTeamStatsRow();
    const teams = aflOpponentTeamAverages;
    if (!row || !teams?.length) return null;
    const col = ADVANCED_STAT_CODE_TO_TEAM_RANKING_COLUMN[statCode];
    if (!col) return null;
    const rowValue = Number(row.stats?.[col]);
    if (!Number.isFinite(rowValue)) return null;
    const statValues = teams
      .map((t) => Number(t.stats?.[col]))
      .filter((v) => Number.isFinite(v));
    if (!statValues.length) return null;
    // Opponent averages: lower value means tougher matchup, so rank ascending.
    const below = statValues.filter((v) => v < rowValue).length;
    return below + 1;
  };

  const renderOpponentTeamRank = (statCode: string) => {
    const rank = getOpponentSeasonRank(statCode);
    if (rank == null) return null;
    const top6 = rank <= 6;
    const bottom6 = rank >= 13;
    const rankClass = top6
      ? 'text-red-600 dark:text-red-400'
      : bottom6
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-amber-600 dark:text-amber-400';
    return <span className={`inline-block w-[3.5ch] xl:w-[4ch] text-right tabular-nums text-[10px] sm:text-[11px] font-semibold ${rankClass}`}>#{rank}</span>;
  };

  const renderOpponentSeasonRow = (label: string, statCode: string) => (
    <div className="flex items-center justify-between">
      <span className="font-semibold text-gray-900 dark:text-white inline-flex items-center">
        {(() => {
          const v = getOpponentSeasonAvg(statCode);
          return typeof v === 'number' && Number.isFinite(v) ? (
            <>
              {renderOpponentTeamRank(statCode)}
              {v.toFixed(1)}
            </>
          ) : '—';
        })()}
      </span>
      <span className="text-gray-700 dark:text-gray-200 text-right">{label}</span>
    </div>
  );

  const renderPlayerSeasonValue = (playerStatKey: string) => {
    const v = getCurrentSeasonAvg(playerStatKey);
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return v.toFixed(1);
  };

  const renderPlayerSeasonValueWithDisposalShare = (playerStatKey: string) => {
    const formattedValue = renderPlayerSeasonValue(playerStatKey);
    if (!formattedValue) return null;

    const disposalShareStats = new Set([
      'uncontested_possessions',
      'contested_possessions',
      'kicks',
      'handballs',
    ]);

    if (!disposalShareStats.has(playerStatKey)) return formattedValue;

    const playerValue = getCurrentSeasonAvg(playerStatKey);
    const disposalAverage = getCurrentSeasonAvg('disposals');
    if (
      typeof playerValue !== 'number' ||
      !Number.isFinite(playerValue) ||
      typeof disposalAverage !== 'number' ||
      !Number.isFinite(disposalAverage) ||
      disposalAverage <= 0
    ) {
      return formattedValue;
    }

    const disposalPct = Math.round((playerValue / disposalAverage) * 100);
    return `${formattedValue} (${disposalPct}%)`;
  };

  const renderOpponentSeasonValue = (statCode: string) => {
    const v = getOpponentSeasonAvg(statCode);
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return v.toFixed(1);
  };

  const playerVsTeamRows: Array<{
    label: string;
    playerStatKey: string;
    playerRankKey: TeamRankStatKey;
    opponentStatCode: string;
  }> = [
    { label: 'Disposals', playerStatKey: 'disposals', playerRankKey: 'disposals', opponentStatCode: 'D' },
    { label: 'Uncont. poss.', playerStatKey: 'uncontested_possessions', playerRankKey: 'uncontested_possessions', opponentStatCode: 'UP' },
    { label: 'Cont. poss.', playerStatKey: 'contested_possessions', playerRankKey: 'contested_possessions', opponentStatCode: 'CP' },
    { label: 'Handballs', playerStatKey: 'handballs', playerRankKey: 'handballs', opponentStatCode: 'HB' },
    { label: 'Kicks', playerStatKey: 'kicks', playerRankKey: 'kicks', opponentStatCode: 'K' },
    { label: 'Frees for', playerStatKey: 'free_kicks_for', playerRankKey: 'free_kicks_for', opponentStatCode: 'FF' },
    { label: 'Meters gained', playerStatKey: 'meters_gained', playerRankKey: 'meters_gained', opponentStatCode: 'MG' },
    { label: 'Goals', playerStatKey: 'goals', playerRankKey: 'goals', opponentStatCode: 'G' },
  ];

  const playerTeamRanks = useMemo<Record<TeamRankStatKey, { rank: number; total: number } | null>>(() => {
    const empty = {
      disposals: null,
      kicks: null,
      handballs: null,
      goals: null,
      uncontested_possessions: null,
      contested_possessions: null,
      free_kicks_for: null,
      meters_gained: null,
    };
    const playerName = selectedPlayer?.name ? String(selectedPlayer.name) : '';
    const playerTeamRaw = selectedPlayer?.team ? String(selectedPlayer.team) : '';
    if (!playerName || !leaguePlayerStats?.length) return empty;

    let comparePool = leaguePlayerStats;
    if (playerVsRankScope === 'team') {
      if (!playerTeamRaw) return empty;
      const teamCandidates = new Set<string>();
      const pushTeam = (t: string | null | undefined) => {
        if (!t) return;
        const n = normalizeForRankMatch(t);
        if (n) teamCandidates.add(n);
      };
      pushTeam(playerTeamRaw);
      pushTeam(rosterTeamToInjuryTeam(playerTeamRaw));
      pushTeam(footywireNicknameToOfficial(playerTeamRaw));
      const fullTeam = rosterTeamToInjuryTeam(playerTeamRaw) || footywireNicknameToOfficial(playerTeamRaw) || playerTeamRaw;
      pushTeam(fullTeam);
      pushTeam(opponentToFootywireTeam(fullTeam));
      pushTeam(opponentToFootywireTeam(playerTeamRaw));

      const sameTeam = (rowTeamRaw: unknown): boolean => {
        const rowTeam = normalizeForRankMatch(String(rowTeamRaw ?? ''));
        if (!rowTeam) return false;
        for (const candidate of teamCandidates) {
          if (rowTeam === candidate || rowTeam.includes(candidate) || candidate.includes(rowTeam)) return true;
        }
        return false;
      };
      comparePool = leaguePlayerStats.filter((p) => sameTeam(p.team));
      if (!comparePool.length) return empty;
    }

    const playerNameNorm = normalizePlayerNameForMatch(playerName);
    const byName = comparePool.filter((p) => {
      const n = normalizePlayerNameForMatch(String(p.name ?? ''));
      return n === playerNameNorm || n.includes(playerNameNorm) || playerNameNorm.includes(n);
    });
    let playerRow = byName[0];
    if (!playerRow && playerVsRankScope === 'league') {
      const allByName = leaguePlayerStats.filter((p) => {
        const n = normalizePlayerNameForMatch(String(p.name ?? ''));
        return n === playerNameNorm || n.includes(playerNameNorm) || playerNameNorm.includes(n);
      });
      playerRow = allByName[0];
    }
    if (!playerRow) return empty;

    const maxGames = Math.max(...comparePool.map((p) => Number(p.games) || 0), 0);
    const minGames = maxGames >= 5 ? 5 : 1;
    const statKeys: TeamRankStatKey[] = [
      'disposals',
      'kicks',
      'handballs',
      'goals',
      'uncontested_possessions',
      'contested_possessions',
      'free_kicks_for',
      'meters_gained',
    ];

    const result: Record<TeamRankStatKey, { rank: number; total: number } | null> = { ...empty };
    for (const statKey of statKeys) {
      if (playerVsRankScope === 'league' && (Number(playerRow.games) || 0) < minGames) {
        result[statKey] = null;
        continue;
      }
      const playerValue = Number(playerRow[statKey]);
      if (!Number.isFinite(playerValue)) {
        result[statKey] = null;
        continue;
      }
      const eligible = comparePool.filter((p) => (Number(p.games) || 0) >= minGames && Number.isFinite(Number(p[statKey])));
      if (!eligible.length) {
        result[statKey] = null;
        continue;
      }
      const above = eligible.filter((p) => Number(p[statKey]) > playerValue).length;
      result[statKey] = { rank: above + 1, total: eligible.length };
    }
    return result;
  }, [leaguePlayerStats, playerVsRankScope, selectedPlayer?.name, selectedPlayer?.team]);

  const renderPlayerTeamRank = (statKey: TeamRankStatKey) => {
    const rank = playerTeamRanks[statKey];
    if (!rank) return null;
    const isTeamScope = playerVsRankScope === 'team';
    const top5 = rank.rank <= 5;
    const bottom5 = rank.total > 0 && rank.rank >= rank.total - 4;
    const topPct = rank.total > 0 && rank.rank <= Math.ceil(rank.total * 0.1);
    const bottomPct = rank.total > 0 && rank.rank >= rank.total - Math.ceil(rank.total * 0.1);
    const isTop = isTeamScope ? top5 : topPct;
    const isBottom = isTeamScope ? bottom5 : bottomPct;
    const rankClass = isTop
      ? 'text-emerald-600 dark:text-emerald-400'
      : isBottom
        ? 'text-red-600 dark:text-red-400'
        : 'text-amber-600 dark:text-amber-400';
    return <span className={`inline-block w-[3.5ch] xl:w-[4ch] text-left tabular-nums text-[10px] sm:text-[11px] font-semibold ${rankClass}`}>#{rank.rank}</span>;
  };

  // When a team is selected in the Team dropdown, filter the chart to only games vs that opponent (so the dropdown visibly updates the chart).
  const chartGameLogsForPlayer = useMemo(() => {
    if (aflPropsMode !== 'player') return filteredPlayerGameLogs;
    const baseLogs = (!aflTeamFilter || aflTeamFilter === 'All' || aflTeamFilter.trim() === '')
      ? filteredPlayerGameLogs
      : filteredPlayerGameLogs.filter((g) => {
        const opp = (g as Record<string, unknown>)?.opponent;
        if (opp == null || typeof opp !== 'string') return false;
        const resolved = opponentToOfficialTeamName(opp) || rosterTeamToInjuryTeam(opp) || opp.trim();
        return resolved === aflTeamFilter.trim();
      });

    // If mixed-quality rows exist, keep only games that have verified supporting stats
    // so chart bars and supporting-stats bars stay aligned.
    const verified = baseLogs.filter((g) => hasVerifiedSupportingStats(g as Record<string, unknown>));
    if (verified.length > 0 && verified.length < baseLogs.length) return verified;
    return baseLogs;
  }, [aflPropsMode, filteredPlayerGameLogs, aflTeamFilter]);

  // In Game Props mode, optionally filter team logs by selected opponent from Team dropdown.
  const chartGameLogsForTeamMode = useMemo(() => {
    if (aflPropsMode !== 'team') return aflTeamGamePropsLogs;
    if (!aflGamePropsVsTeamFilter || aflGamePropsVsTeamFilter === 'All' || aflGamePropsVsTeamFilter.trim() === '') return aflTeamGamePropsLogs;
    const officialTarget = aflGamePropsVsTeamFilter.trim();
    return aflTeamGamePropsLogs.filter((g) => {
      const opp = (g as Record<string, unknown>)?.opponent;
      if (opp == null || typeof opp !== 'string') return false;
      const resolved = opponentToOfficialTeamName(opp) || rosterTeamToInjuryTeam(opp) || opp.trim();
      return resolved === officialTarget;
    });
  }, [aflPropsMode, aflTeamGamePropsLogs, aflGamePropsVsTeamFilter]);

  const AFL_MATCH_DURATION_MS = 3.5 * 60 * 60 * 1000;
  const shouldPreserveLiveAflGame = (currentTipoff: Date | null, incomingTipoff: Date | null) => {
    if (!currentTipoff || !incomingTipoff) return false;
    const now = Date.now();
    const currentMs = currentTipoff.getTime();
    const incomingMs = incomingTipoff.getTime();
    return now >= currentMs && now < currentMs + AFL_MATCH_DURATION_MS && incomingMs > currentMs;
  };

  // Fetch next game (fixture scrape) for the current context team in Game Props,
  // or the selected player's team in Player Props.
  // Use prefetch from sessionStorage (props page) so opponent shows immediately and no re-render when API returns same data.
  useEffect(() => {
    const name = selectedPlayer?.name;
    const nameTrimmed = typeof name === 'string' ? name.trim() : '';
    const team = teamContextTeam;
    if ((!team || !team.trim()) && !nameTrimmed) {
      setNextGameOpponent(null);
      setNextGameTipoff(null);
      setNextGameId(null);
      setNextGameWeather(null);
      nextGameFromFetchRef.current = { opponent: null, tipoff: null };
      setIsGameInProgress(false);
      return;
    }
    const resolvedTeam = team && typeof team === 'string' && team.trim()
      ? (rosterTeamToInjuryTeam(team.trim()) || footywireNicknameToOfficial(team.trim()) || team.trim())
      : '';
    const teamNorm = (t: string) => String(t ?? '').trim().toLowerCase();
    try {
      const prefetchRaw = typeof window !== 'undefined' ? sessionStorage.getItem('afl_next_game_prefetch') : null;
      if (prefetchRaw && resolvedTeam) {
        const prefetch = JSON.parse(prefetchRaw) as { team?: string; next_opponent?: string; next_game_tipoff?: string; next_game_id?: string; fetchedAt?: number };
        const prefetchTeamNorm = teamNorm(prefetch.team ?? '');
        if (prefetchTeamNorm && (teamNorm(resolvedTeam) === prefetchTeamNorm || teamNorm(resolvedTeam).includes(prefetchTeamNorm) || prefetchTeamNorm.includes(teamNorm(resolvedTeam)))) {
          const age = prefetch.fetchedAt != null ? Date.now() - prefetch.fetchedAt : 99999;
          if (age < 60000) {
            const opp = typeof prefetch.next_opponent === 'string' && prefetch.next_opponent ? prefetch.next_opponent : null;
            const tipoff = prefetch.next_game_tipoff && typeof prefetch.next_game_tipoff === 'string' ? new Date(prefetch.next_game_tipoff) : null;
            const gameId = typeof prefetch.next_game_id === 'string' && prefetch.next_game_id ? prefetch.next_game_id : null;
            setNextGameOpponent(opp);
            setNextGameTipoff(tipoff && Number.isFinite(tipoff.getTime()) ? tipoff : null);
            if (gameId) setNextGameId(gameId);
            nextGameFromFetchRef.current = { opponent: opp, tipoff };
          }
        }
      }
    } catch {
      // ignore prefetch read
    }
    let cancelled = false;
    const lastRound =
      (typeof selectedPlayer?.last_round === 'string' && selectedPlayer.last_round.trim()
        ? selectedPlayer.last_round.trim()
        : lastRoundFromLogs) || '';
    const params = new URLSearchParams({ season: String(season) });
    if (resolvedTeam) {
      params.set('team', resolvedTeam);
    } else {
      params.set('player_name', nameTrimmed);
    }
    if (lastRound) params.set('last_round', lastRound);
    fetch(`/api/afl/next-game?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const opp = typeof data?.next_opponent === 'string' && data.next_opponent ? data.next_opponent : null;
        const tipoff = data?.next_game_tipoff && typeof data.next_game_tipoff === 'string' ? new Date(data.next_game_tipoff) : null;
        const tipoffValid = tipoff && Number.isFinite(tipoff.getTime()) ? tipoff : null;
        const gameId = typeof data?.next_game_id === 'string' && data.next_game_id ? data.next_game_id : null;
        const preserveLiveGame = shouldPreserveLiveAflGame(nextGameTipoff, tipoffValid);
        const weatherRaw = data?.next_game_weather as Record<string, unknown> | null | undefined;
        if (!preserveLiveGame) setNextGameId(gameId);
        setNextGameWeather(
          weatherRaw
            ? {
                temperatureC: toFiniteNumber(weatherRaw.temperatureC),
                precipitationMm: toFiniteNumber(weatherRaw.precipitationMm),
                windKmh: toFiniteNumber(weatherRaw.windKmh),
              }
            : null
        );
        const prev = nextGameFromFetchRef.current;
        if (!preserveLiveGame && (prev.opponent !== opp || (prev.tipoff?.getTime() !== tipoffValid?.getTime()))) {
          setNextGameOpponent(opp);
          setNextGameTipoff(tipoffValid);
          nextGameFromFetchRef.current = { opponent: opp, tipoff: tipoffValid };
        }
        if ((!team || !team.trim()) && typeof data?.team === 'string' && data.team.trim()) {
          setSelectedPlayer((prevPlayer) => (prevPlayer ? { ...prevPlayer, team: data.team.trim() } : prevPlayer));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNextGameOpponent(null);
          setNextGameTipoff(null);
          setNextGameId(null);
          setNextGameWeather(null);
          nextGameFromFetchRef.current = { opponent: null, tipoff: null };
        }
      });
    return () => { cancelled = true; };
  }, [selectedPlayer?.name, selectedPlayer?.last_round, lastRoundFromLogs, season, teamContextTeam]);

  // Mark game as in progress when tipoff has passed and within ~3.5h (AFL match duration)
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

  // Opponent for header: only use next-game opponent so we never show "Essendon vs Essendon" from wrong fallbacks, and only one update when it loads.
  const displayOpponent =
    teamContextTeam && nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== '—'
      ? nextGameOpponent
      : null;
  const selectedHeaderTeamName =
    teamContextTeam && teamContextTeam.trim() !== ''
      ? teamContextTeam
      : null;
  // Matchup opponent for DVP / Opponent Breakdown: use next-game opponent only (avoid stale last-game opponent flashes).
  const matchupOpponent = displayOpponent ?? null;
  const nextGameWeatherSummary = useMemo(() => {
    if (!nextGameWeather) return null;
    const wind = toFiniteNumber(nextGameWeather.windKmh);
    const rain = toFiniteNumber(nextGameWeather.precipitationMm);
    const temp = toFiniteNumber(nextGameWeather.temperatureC);
    return {
      windLabel: classifyWindLabel(wind),
      rainLabel: classifyRainLabel(rain),
      tempLabel: temp == null ? 'N/A' : `${temp.toFixed(1)}C`,
    };
  }, [nextGameWeather]);

  const aflJournalQuickPreset = useMemo(
    () =>
      aflPropsMode === 'player'
        ? buildAflJournalQuickPreset({
            mode: 'player',
            mainChartStat,
            selectedAflDisposalsColumn,
            book: aflPlayerPropsBooks[selectedAflBookIndex],
            aflCurrentLineValue,
            homeTeam: (aflOddsHomeTeam || '').trim() || (teamContextTeam || '').trim(),
            awayTeam: (aflOddsAwayTeam || '').trim() || (nextGameOpponent || '').trim(),
          })
        : null,
    [
      aflPropsMode,
      mainChartStat,
      selectedAflDisposalsColumn,
      aflPlayerPropsBooks,
      selectedAflBookIndex,
      aflCurrentLineValue,
      aflOddsHomeTeam,
      aflOddsAwayTeam,
      teamContextTeam,
      nextGameOpponent,
    ]
  );

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
              onSignOutClick={async () => { await supabase.auth.signOut({ scope: 'local' }); router.push('/'); }}
              onProfileUpdated={({ username: u, avatar_url: a }) => { if (u !== undefined) setUsername(u ?? null); if (a !== undefined) setAvatarUrl(a ?? null); }}
              showDashboardNavLinks={aflPropsMode === 'team'}
              belowNavSlot={
                aflPropsMode === 'player' && selectedPlayer?.name ? (
                  <AflSidebarHotPicks
                    excludePlayerName={String(selectedPlayer.name)}
                    isDark={!!mounted && isDark}
                    onSelectPlayer={selectPlayerFromSidebarHotPick}
                  />
                ) : undefined
              }
            />
            <div className="flex flex-col lg:flex-row gap-0 lg:gap-0 min-h-0">
              {/* Main content - same containers as NBA dashboard */}
              <div className={mainContentClassName} style={mainContentStyle}>
                {/* 1. Filter By (Mode toggle) - mobile only, at top; desktop Filter By is in right panel */}
                <div className={`lg:hidden rounded-lg ${AFL_DASH_CARD_GLOW} px-3 md:px-4 pt-3 md:pt-4 pb-4 md:pb-5 relative overflow-visible`}>
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
                <div
                  className={`relative z-[60] rounded-lg ${AFL_DASH_CARD_GLOW} p-2.5 sm:p-4 md:p-6 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}
                  ref={searchDropdownRef}
                >
                  <div className="flex flex-col gap-1.5 lg:gap-3">
                    {/* Desktop: one row - player info (left) | team vs opponent (center) | spacer (right) */}
                    <div className="hidden lg:flex items-center flex-1">
                      <div className="flex-1 min-w-0">
                        {selectedPlayer ? (
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  localStorage.removeItem(AFL_PAGE_STATE_KEY);
                                  sessionStorage.setItem('afl_back_to_props_clear_search', '1');
                                } catch {}
                                setNavigatingToProps(true);
                                router.push('/props?sport=afl');
                              }}
                              className="flex items-center gap-1.5 mb-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                              </svg>
                              <span>Back to Player Props</span>
                            </button>
                            <div className="flex items-baseline gap-3 mb-1">
                              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                                {aflPropsMode === 'team'
                                  ? (selectedHeaderTeamName || '—')
                                  : String(selectedPlayer.name ?? '—')}
                              </h1>
                              {aflPropsMode === 'player' && (() => {
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
                            {aflPropsMode === 'player' && (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {selectedHeaderTeamName || '—'}
                              </div>
                            )}
                            {aflPropsMode === 'player' && (selectedPlayer.position || selectedPlayerDfsRole) ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                Position:{' '}
                                {(() => {
                                  const f = selectedPlayer.position
                                    ? (toDvpPositionLabel(selectedPlayer.position) ??
                                      String(selectedPlayer.position))
                                    : null;
                                  const d = selectedPlayerDfsRole;
                                  if (f && d) return `${f} - ${d}`;
                                  if (f) return f;
                                  return d ?? '';
                                })()}
                              </div>
                            ) : null}
                            {aflPropsMode === 'player' && selectedPlayer.height ? (
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
                      {/* Middle: Team vs Opponent (from last game) - shrinks with viewport so it doesn't squish the rest */}
                      <div className="hidden lg:flex min-w-0 flex-shrink items-end mx-2 xl:mx-4">
                        {(teamContextTeam && teamContextTeam.trim() !== '') ? (() => {
                          const teamFull = teamContextTeam;
                          let opponentFull = displayOpponent ? (opponentToOfficialTeamName(displayOpponent) || displayOpponent) : '—';
                          if (opponentFull !== '—' && isSameAflTeam(opponentFull, teamFull)) opponentFull = '—';
                          const teamLogo = resolveTeamLogo(teamFull, logoByTeam);
                          const opponentLogo = opponentFull !== '—' ? resolveTeamLogo(opponentFull, logoByTeam) : null;
                          return (
                            <div className="flex flex-col items-center gap-1.5 min-w-0 flex-shrink">
                              <div className="flex items-center gap-1.5 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1.5 xl:px-3 xl:py-2 min-w-0 flex-shrink overflow-hidden">
                                <div className="flex items-center gap-1 xl:gap-1.5 min-w-0 flex-shrink">
                                  {teamLogo ? (
                                    <img
                                      src={teamLogo}
                                      alt={teamFull}
                                      className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                      style={{
                                        filter: isDark
                                          ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.65))'
                                          : 'drop-shadow(0 0 1px rgba(15,23,42,0.45)) drop-shadow(0 1px 1px rgba(0,0,0,0.2))',
                                      }}
                                    />
                                  ) : null}
                                  <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate">{teamFull}</span>
                                </div>
                                {displayOpponent && countdown && !isGameInProgress ? (
                                  <div className="flex flex-col items-center flex-shrink-0 min-w-0 w-14 xl:w-20">
                                    <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">Bounce in</div>
                                    <div className="text-xs xl:text-sm font-mono font-semibold text-gray-900 dark:text-white tabular-nums">
                                      {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                                    </div>
                                  </div>
                                ) : displayOpponent && isGameInProgress ? (
                                  <div className="flex flex-col items-center flex-shrink-0 min-w-0">
                                    <div className="text-xs xl:text-sm font-semibold text-green-600 dark:text-green-400 animate-live-pulse-green">LIVE</div>
                                  </div>
                                ) : displayOpponent && nextGameTipoff ? (
                                  <div className="flex flex-col items-center flex-shrink-0 min-w-0">
                                    <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Game time passed</div>
                                  </div>
                                ) : (
                                  <span className="text-gray-500 dark:text-gray-400 font-medium text-xs flex-shrink-0">VS</span>
                                )}
                                <div className="flex items-center gap-1 xl:gap-1.5 min-w-0 flex-shrink">
                                  {displayOpponent && opponentFull !== '—' ? (
                                    <>
                                      {opponentLogo ? (
                                        <img
                                          src={opponentLogo}
                                          alt={opponentFull}
                                          className="w-6 h-6 xl:w-8 xl:h-8 object-contain flex-shrink-0"
                                          style={{
                                            filter: isDark
                                              ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.65))'
                                              : 'drop-shadow(0 0 1px rgba(15,23,42,0.45)) drop-shadow(0 1px 1px rgba(0,0,0,0.2))',
                                          }}
                                        />
                                      ) : null}
                                      <span className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate">{opponentFull}</span>
                                    </>
                                  ) : (
                                    <span className="text-gray-400 dark:text-gray-500 text-xs xl:text-sm font-medium flex-shrink-0">—</span>
                                  )}
                                </div>
                              </div>
                              {displayOpponent && nextGameWeatherSummary ? (
                                <div className="text-[10px] xl:text-xs text-gray-600 dark:text-gray-300 text-center w-full">
                                  Wind: {nextGameWeatherSummary.windLabel} | Rain: {nextGameWeatherSummary.rainLabel} | Temp: {nextGameWeatherSummary.tempLabel}
                                </div>
                              ) : null}
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
                      <div className="flex-1 min-w-0 flex justify-end">
                        {aflPropsMode === 'player' && dashboardImpliedOdds && (
                          <div className="flex-shrink-0">
                            <ImpliedOddsWheel
                              isDark={!!mounted && isDark}
                              calculatedImpliedOdds={dashboardImpliedOdds}
                              size={100}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Mobile: Row 1 = Back + Player name | Tipoff (top right); Row 2 = Team/position | Team vs Opponent */}
                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      {/* Wheel is position:absolute so this block's height is only back + name — avoids a tall flex row (wheel ~85px) leaving empty space under the name */}
                      <div
                        className={`w-full min-w-0 ${aflPropsMode === 'player' && dashboardImpliedOdds ? 'pr-[5.75rem]' : ''}`}
                      >
                        <div className="flex-shrink-0 min-w-0">
                          {selectedPlayer ? (
                            <div>
                              <button
                                type="button"
                                onClick={() => {
                                  try {
                                    localStorage.removeItem(AFL_PAGE_STATE_KEY);
                                    sessionStorage.setItem('afl_back_to_props_clear_search', '1');
                                  } catch {}
                                  setNavigatingToProps(true);
                                  router.push('/props?sport=afl');
                                }}
                                className="flex items-center gap-1.5 mb-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                              >
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                <span>Back to Player Props</span>
                              </button>
                              <div className="flex items-baseline gap-3">
                                <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                                  {aflPropsMode === 'team'
                                    ? (selectedHeaderTeamName || '—')
                                    : String(selectedPlayer.name ?? '—')}
                                </h1>
                                {aflPropsMode === 'player' && (() => {
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
                      </div>
                      {aflPropsMode === 'player' && dashboardImpliedOdds && (
                        <div className="absolute right-0 -top-3 z-20 flex-shrink-0 pointer-events-auto">
                          <ImpliedOddsWheel
                            isDark={!!mounted && isDark}
                            calculatedImpliedOdds={dashboardImpliedOdds}
                            size={85}
                          />
                        </div>
                      )}
                      <div className="lg:hidden flex flex-col gap-1 w-full min-w-0">
                        <div className="flex items-start justify-between gap-1.5 w-full min-w-0">
                          <div className="flex-shrink-0 min-w-0">
                            {selectedPlayer ? (
                              <div>
                                {aflPropsMode === 'player' && (
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {selectedHeaderTeamName || '—'}
                                  </div>
                                )}
                                {aflPropsMode === 'player' && (selectedPlayer.position || selectedPlayerDfsRole) && (
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {(() => {
                                      const f = selectedPlayer.position
                                        ? (toDvpPositionLabel(selectedPlayer.position) ??
                                          String(selectedPlayer.position))
                                        : null;
                                      const d = selectedPlayerDfsRole;
                                      if (f && d) return `${f} - ${d}`;
                                      if (f) return f;
                                      return d ?? '';
                                    })()}
                                  </div>
                                )}
                                {aflPropsMode === 'player' && selectedPlayer.height && (
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
                          <div
                            className={`flex-shrink-0 min-w-0 ${aflPropsMode === 'player' && dashboardImpliedOdds ? 'pt-5' : ''}`}
                          >
                            {selectedPlayer?.team ? (
                              (() => {
                                const teamFull = rosterTeamToInjuryTeam(String(selectedPlayer!.team)) || String(selectedPlayer!.team);
                                let opponentFull = displayOpponent ? (opponentToOfficialTeamName(displayOpponent) || displayOpponent) : '—';
                                if (opponentFull !== '—' && isSameAflTeam(opponentFull, teamFull)) opponentFull = '—';
                                const teamLogo = resolveTeamLogo(teamFull, logoByTeam);
                                const opponentLogo = opponentFull !== '—' ? resolveTeamLogo(opponentFull, logoByTeam) : null;
                                const teamAbbr = getTeamAbbrev(teamFull);
                                const opponentAbbr = opponentFull !== '—' ? getTeamAbbrev(opponentFull) : '—';
                                return (
                                  <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-3 sm:py-2 min-w-0">
                                    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                      <div className="flex items-center gap-1 min-w-0">
                                        {teamLogo ? (
                                          <img src={teamLogo} alt={teamFull} className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0" style={{ filter: isDark ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))' : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))' }} />
                                        ) : null}
                                        <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{teamAbbr}</span>
                                      </div>
                                      <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                                      <div className="flex items-center gap-1 min-w-0">
                                        {displayOpponent && opponentFull !== '—' ? (
                                          <>
                                            {opponentLogo ? (
                                              <img src={opponentLogo} alt={opponentFull} className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0" style={{ filter: isDark ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95))' : 'drop-shadow(0 0 1px rgba(15,23,42,0.45))' }} />
                                            ) : null}
                                            <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{opponentAbbr}</span>
                                          </>
                                        ) : (
                                          <span className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm truncate">—</span>
                                        )}
                                      </div>
                                    </div>
                                    {displayOpponent && countdown && !isGameInProgress ? (
                                      <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                        <div className="text-[9px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">Bounce in</div>
                                        <div className="text-xs font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                                          {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                                        </div>
                                      </div>
                                    ) : displayOpponent && isGameInProgress ? (
                                      <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                        <div className="text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap animate-live-pulse-green">LIVE</div>
                                      </div>
                                    ) : displayOpponent && nextGameTipoff ? (
                                      <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                                        <div className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Game time passed</div>
                                      </div>
                                    ) : null}
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
                        {selectedPlayer?.team && displayOpponent && nextGameWeatherSummary ? (
                          <div className="text-[10px] text-gray-600 dark:text-gray-300 text-center w-full px-1 leading-tight">
                            Wind: {nextGameWeatherSummary.windLabel} | Rain: {nextGameWeatherSummary.rainLabel} | Temp: {nextGameWeatherSummary.tempLabel}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {aflPropsMode === 'team' && (
                      <>
                        {/* Search row - full width on mobile, below title on desktop */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2 lg:mt-0">
                          <div className="flex-1 relative min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              onFocus={() => {
                                setShowSearchDropdown(true);
                              }}
                              placeholder="Search AFL teams..."
                              className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm placeholder-gray-500 dark:placeholder-gray-400 ${
                                isDark
                                  ? 'bg-[#0f172a] border-gray-600 text-white focus:ring-purple-500 focus:border-purple-500'
                                  : 'bg-gray-50 border-gray-300 text-gray-900 focus:ring-purple-500 focus:border-purple-500'
                              }`}
                              aria-label="Search AFL teams"
                            />
                            {showSearchDropdown && (
                              <div
                                className={`absolute left-0 right-0 top-full mt-1 rounded-lg border shadow-lg z-[120] max-h-64 overflow-y-auto ${
                                  isDark ? 'bg-[#0f172a] border-gray-600' : 'bg-white border-gray-200'
                                }`}
                              >
                                {filteredTeams.length === 0 ? (
                                  <div className={`px-3 py-4 text-sm ${emptyText}`}>No teams match</div>
                                ) : (
                                  <div className="grid grid-cols-2 gap-1 p-1.5">
                                    {filteredTeams.map((team) => (
                                      <button
                                        key={team}
                                        type="button"
                                        onClick={() => {
                                          setAflTeamFilter(team);
                                          setAflGamePropsVsTeamFilter('All');
                                          setSearchQuery(team);
                                          setShowSearchDropdown(false);
                                        }}
                                        className={`w-full text-left px-1.5 py-1 rounded-md text-xs ${
                                          isDark
                                            ? 'hover:bg-[#1e293b] text-gray-100 bg-[#0b2035]'
                                            : 'hover:bg-gray-100 text-gray-900 bg-gray-50'
                                        }`}
                                      >
                                        <span className="flex items-center gap-1.5 min-w-0">
                                          {resolveTeamLogo(team, logoByTeam) ? (
                                            <img
                                              src={resolveTeamLogo(team, logoByTeam) ?? ''}
                                              alt={team}
                                              className="w-4 h-4 object-contain rounded-full bg-gray-900/10 flex-shrink-0"
                                            />
                                          ) : (
                                            <span className={`inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] font-semibold flex-shrink-0 ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}>
                                              {getTeamAbbrev(team).slice(0, 1)}
                                            </span>
                                          )}
                                          <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-600'}`}>
                                            {getTeamAbbrev(team)}
                                          </span>
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                    {aflPropsMode === 'player' &&
                      selectedPlayer &&
                      nextGameOpponent &&
                      nextGameOpponent !== '' &&
                      nextGameOpponent !== '—' &&
                      nextGameTipoff && (
                      <div className="flex gap-2 px-0 pt-0.5">
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
                          className={`flex-1 px-2 py-1 sm:py-1.5 text-white text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                            isGameInProgress || !isPro
                              ? 'bg-gray-400 cursor-not-allowed opacity-50'
                              : 'bg-purple-600 hover:bg-purple-700'
                          }`}
                          title={
                            !isPro
                              ? 'Journal is a Pro feature'
                              : isGameInProgress
                                ? 'Game in progress — journal disabled'
                                : 'Add to journal'
                          }
                        >
                          {!isPro ? (
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                                clipRule="evenodd"
                              />
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
                  className={`chart-container-no-focus relative z-10 rounded-lg p-0 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${AFL_DASH_CARD_GLOW} ${
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
                        gameLogs={aflPropsMode === 'team' ? chartGameLogsForTeamMode : chartGameLogsForPlayer}
                        allGameLogs={aflPropsMode === 'team' ? chartGameLogsForTeamMode : selectedPlayerGameLogsForChart}
                        isDark={!!mounted && isDark}
                        logoByTeam={logoByTeam}
                        isLoading={(playersLoading && !selectedPlayer) || statsLoadingForPlayer}
                        hasSelectedPlayer={!!selectedPlayer}
                        apiErrorHint={lastStatsError}
                        teammateFilterName={aflPropsMode === 'team' ? null : teammateFilterName}
                        nextOpponent={(() => {
                          if (aflPropsMode === 'player' && displayOpponent) {
                            return opponentToOfficialTeamName(displayOpponent) || displayOpponent;
                          }
                          if (aflPropsMode === 'team' && aflOddsHomeTeam && aflOddsAwayTeam) {
                            // In Game Props mode, use the odds matchup so H2H is based on the upcoming game.
                            const selectedOpponent = aflGamePropsVsTeamFilter && aflGamePropsVsTeamFilter !== 'All' ? aflGamePropsVsTeamFilter.trim() : null;
                            if (selectedOpponent) {
                              return opponentToOfficialTeamName(selectedOpponent) || selectedOpponent;
                            }
                            const team = teamContextTeam ? teamContextTeam.trim() : null;
                            if (team) {
                              const teamOfficial = opponentToOfficialTeamName(team) || rosterTeamToInjuryTeam(team) || team;
                              const homeOfficial = opponentToOfficialTeamName(aflOddsHomeTeam) || rosterTeamToInjuryTeam(aflOddsHomeTeam) || aflOddsHomeTeam;
                              const awayOfficial = opponentToOfficialTeamName(aflOddsAwayTeam) || rosterTeamToInjuryTeam(aflOddsAwayTeam) || aflOddsAwayTeam;
                              if (teamOfficial === homeOfficial) return awayOfficial;
                              if (teamOfficial === awayOfficial) return homeOfficial;
                              // If the selected Team filter is outside the current odds matchup,
                              // don't force H2H to the original game opponent.
                              // Let AflStatsChart fall back to this team's own recent opponent instead.
                              return null;
                            }
                            // Fallback: default to away team as opponent for H2H when team dropdown doesn't clearly match.
                            return opponentToOfficialTeamName(aflOddsAwayTeam) || aflOddsAwayTeam;
                          }
                          return null;
                        })()}
                        withWithoutMode={aflPropsMode === 'team' ? 'with' : withWithoutMode}
                        season={season}
                        uiResetToken={chartUiResetToken}
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
                        playerPositionForFilters={playerPositionForFilters}
                        slotRightOfControls={
                          <div className="flex items-center gap-1.5 relative">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setTeamFilterDropdownOpen((v) => !v)}
                                className="w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
                              >
                                <span className="flex items-center gap-1 min-w-0">
                                  {(aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter) !== 'All' && resolveTeamLogo((aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter), logoByTeam) ? (
                                    <img
                                      src={resolveTeamLogo((aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter), logoByTeam) ?? ''}
                                      alt={aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter}
                                      className="w-4 h-4 object-contain rounded-full bg-gray-900/10 flex-shrink-0"
                                    />
                                  ) : (aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter) !== 'All' ? (
                                    <span className={`inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] font-semibold flex-shrink-0 ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}>
                                      {getTeamAbbrev(aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter).slice(0, 1)}
                                    </span>
                                  ) : null}
                                  <span className="truncate text-xs font-medium">
                                    {(aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter) === 'All' ? 'ALL' : getTeamAbbrev(aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter)}
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
                                          if (aflPropsMode === 'team') {
                                            setAflGamePropsVsTeamFilter('All');
                                          } else {
                                            setAflTeamFilter('All');
                                          }
                                          setTeamFilterDropdownOpen(false);
                                        }}
                                        className={`w-full px-2 py-1.5 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg flex items-center justify-center gap-1 ${
                                          (aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter) === 'All'
                                            ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                                            : 'text-gray-900 dark:text-white'
                                        }`}
                                      >
                                        <span className="flex items-center gap-1">
                                          <span>ALL</span>
                                        </span>
                                      </button>
                                      {AFL_TEAM_FILTER_OPTIONS.filter((team) => team !== 'All').map((team, index, arr) => (
                                        <button
                                          key={team}
                                          type="button"
                                          onClick={() => {
                                            if (aflPropsMode === 'team') {
                                              setAflGamePropsVsTeamFilter(team);
                                            } else {
                                              setAflTeamFilter(team);
                                            }
                                            setTeamFilterDropdownOpen(false);
                                          }}
                                          className={`w-full px-2 py-1.5 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-center gap-1 ${
                                            (aflPropsMode === 'team' ? aflGamePropsVsTeamFilter : aflTeamFilter) === team
                                              ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                                              : 'text-gray-900 dark:text-white'
                                          } ${index === arr.length - 1 ? 'rounded-b-lg' : ''}`}
                                        >
                                          {resolveTeamLogo(team, logoByTeam) ? (
                                            <img
                                              src={resolveTeamLogo(team, logoByTeam) ?? ''}
                                              alt={team}
                                              className="w-4 h-4 object-contain rounded-full bg-gray-900/10 flex-shrink-0"
                                            />
                                          ) : (
                                            <span className={`inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] font-semibold flex-shrink-0 ${isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}>
                                              {getTeamAbbrev(team).slice(0, 1)}
                                            </span>
                                          )}
                                          <span>{getTeamAbbrev(team)}</span>
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
                            onSelectLineValue={aflPropsMode === 'player' ? (lineValue: number) => {
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
                            // Use stored line when set (e.g. after clicking a bookmaker line or manual edit) so chart and selector stay in sync
                            if (aflCurrentLineValue != null && Number.isFinite(aflCurrentLineValue)) {
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
                  <div
                    className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 ${
                      showAdvancedFilters ? 'lg:pl-3 lg:pr-6 xl:pl-4 xl:pr-7' : 'lg:px-3 xl:px-4'
                    }`}
                  >
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
                        <h3
                          className={`text-sm font-semibold mb-1 ${
                            showAdvancedFilters ? 'pl-3 pr-4 sm:pl-4 sm:pr-6' : 'px-3 sm:px-4'
                          } ${isDark ? 'text-gray-200' : 'text-gray-800'}`}
                        >
                          Supporting stats
                        </h3>
                        <AflSupportingStats
                          gameLogs={chartGameLogsForPlayer}
                          timeframe={aflChartTimeframe}
                          season={season}
                          nextOpponent={displayOpponent}
                          mainChartStat={mainChartStat}
                          supportingStatKind={supportingStatKind}
                          onSupportingStatKindChange={setSupportingStatKind}
                          isDark={!!mounted && isDark}
                          alignRightTight={showAdvancedFilters}
                        />
                        <div className="hidden lg:block mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                          <AflTeamSelectionsCard
                            isDark={!!mounted && isDark}
                            playerTeam={
                              selectedPlayer?.team
                                ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || String(selectedPlayer.team))
                                : null
                            }
                            selectedPlayerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                            expectedOpponentTeam={displayOpponent}
                            resolveTeamLogo={(teamName) => resolveTeamLogo(teamName, logoByTeam)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
                {/* 4b. Lineup under chart - Game Props only; show lineup for same game as odds (spread/total) */}
                {aflPropsMode === 'team' && (
                  <div className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                    <AflTeamSelectionsCard
                      isDark={!!mounted && isDark}
                      playerTeam={
                        aflOddsHomeTeam?.trim()
                          ? (rosterTeamToInjuryTeam(aflOddsHomeTeam) || aflOddsHomeTeam)
                          : aflTeamFilter && aflTeamFilter !== 'All'
                            ? (rosterTeamToInjuryTeam(aflTeamFilter) || aflTeamFilter)
                            : null
                      }
                      selectedPlayerName={null}
                      expectedOpponentTeam={aflOddsAwayTeam ?? null}
                      resolveTeamLogo={(teamName) => resolveTeamLogo(teamName, logoByTeam)}
                    />
                  </div>
                )}
                {/* 4.5. DVP | Opponent Breakdown - mobile only; same container for Player and Game Props (desktop uses right panel) */}
                {(aflPropsMode === 'player' || aflPropsMode === 'team') && (
                  <div className={`lg:hidden w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4 max-h-[60vh] min-h-0`}>
                    <div className="flex gap-2 sm:gap-2 mb-2 flex-shrink-0">
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
                              setAflRightTab('team_matchup');
                              setAflRightTabsVisited((prev) => new Set(prev).add('team_matchup'));
                            }}
                            className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                              aflRightTab === 'team_matchup'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Team Matchup
                          </button>
                        </>
                      )}
                      {aflPropsMode === 'team' && (
                        <>
                          <button
                            onClick={() => setAflRightTab('breakdown')}
                            className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                              aflRightTab === 'breakdown'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Opponent Breakdown
                          </button>
                          <button
                            onClick={() => setAflRightTab('team_matchup')}
                            className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                              aflRightTab === 'team_matchup'
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            Team Matchup
                          </button>
                        </>
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
                              key={`${selectedHeaderTeamName ?? 'no-team'}-${displayOpponent ?? 'no-opponent'}-mobile`}
                              isDark={!!mounted && isDark}
                              season={season}
                              playerName={
                                aflPropsMode === 'team'
                                  ? (selectedHeaderTeamName || null)
                                  : (selectedPlayer?.name ? String(selectedPlayer.name) : null)
                              }
                              lastOpponent={matchupOpponent}
                            />
                          </div>
                        )}
                        {aflPropsMode === 'player' && aflRightTab === 'dvp' && (
                          <div className="flex flex-col min-h-0 overflow-y-auto">
                            <AflDvpCard
                              isDark={!!mounted && isDark}
                              season={Math.min(season, 2026)}
                              playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                              opponentTeam={aflTeamFilter !== 'All' && aflTeamFilter ? aflTeamFilter : (matchupOpponent || '')}
                              logoByTeam={logoByTeam}
                              playerPosition={
                                selectedPlayer?.position && ['DEF', 'MID', 'FWD', 'RUC'].includes(String(selectedPlayer.position))
                                  ? (selectedPlayer.position as 'DEF' | 'MID' | 'FWD' | 'RUC')
                                  : undefined
                              }
                            />
                          </div>
                        )}
                        {((aflPropsMode === 'team' && aflRightTab === 'team_matchup') || (aflPropsMode === 'player' && aflRightTabsVisited.has('team_matchup'))) && (
                          <div className={aflRightTab === 'team_matchup' ? 'flex flex-col min-h-0' : 'hidden'}>
                            <AflTeamMatchupCard
                              isDark={!!mounted && isDark}
                              season={season}
                              teamName={selectedHeaderTeamName}
                              opponentName={matchupOpponent}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* 4.52. Player vs Team - mobile */}
                {aflPropsMode === 'player' && (
                  <div className={`lg:hidden w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} px-2 sm:px-2.5 py-2.5 sm:py-3`}>
                    <div className="flex gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setPlayerVsContainerTab('comparison')}
                        className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors border ${
                          playerVsContainerTab === 'comparison'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        Player vs Team
                      </button>
                      <button
                        type="button"
                        disabled={AFL_PREDICTION_MODEL_UNDER_MAINTENANCE}
                        title={
                          AFL_PREDICTION_MODEL_UNDER_MAINTENANCE
                            ? 'Prediction model is under maintenance'
                            : undefined
                        }
                        onClick={() => {
                          if (!AFL_PREDICTION_MODEL_UNDER_MAINTENANCE) {
                            setPlayerVsContainerTab('prediction');
                          }
                        }}
                        className={`relative flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors border ${
                          !AFL_PREDICTION_MODEL_UNDER_MAINTENANCE && playerVsContainerTab === 'prediction'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                        } ${
                          AFL_PREDICTION_MODEL_UNDER_MAINTENANCE
                            ? 'cursor-not-allowed opacity-65'
                            : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        Prediction Model
                        <span
                          className={`absolute -top-2 -right-2 inline-flex max-w-[calc(100%-0.5rem)] items-center rounded-md border px-1 py-0.5 text-[8px] font-bold leading-none tracking-wide text-white shadow-sm ${
                            AFL_PREDICTION_MODEL_UNDER_MAINTENANCE
                              ? 'border-amber-600 bg-amber-600 dark:border-amber-500/80 dark:bg-amber-700'
                              : 'border-red-300 bg-red-500 dark:border-red-500/70 dark:bg-red-600'
                          }`}
                        >
                          {AFL_PREDICTION_MODEL_UNDER_MAINTENANCE ? 'MAINTENANCE' : 'BETA'}
                        </span>
                      </button>
                    </div>
                    {!showAflPredictionPanel ? (
                      <>
                        <div className="flex justify-center mb-2">
                          <div className={`inline-flex rounded-lg border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
                            <button
                              type="button"
                              onClick={() => setPlayerVsRankScope('team')}
                              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                playerVsRankScope === 'team'
                                  ? 'bg-purple-600 text-white'
                                  : isDark ? 'bg-transparent text-gray-400 hover:text-gray-200' : 'bg-transparent text-gray-600 hover:text-gray-900'
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
                                  : isDark ? 'bg-transparent text-gray-400 hover:text-gray-200' : 'bg-transparent text-gray-600 hover:text-gray-900'
                              }`}
                            >
                              vs League
                            </button>
                          </div>
                        </div>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {selectedPlayer?.name ? String(selectedPlayer.name) : 'Select a player'}
                          </span>
                          <span className="text-sm font-semibold text-gray-900 dark:text-white text-right">
                            {aflTeamFilter !== 'All' && aflTeamFilter
                              ? aflTeamFilter
                              : (matchupOpponent || 'Select opponent')}
                          </span>
                        </div>
                        <div className="grid grid-cols-[minmax(0,1fr)_12ch_3.5ch_3.5ch_6ch_minmax(0,1fr)] gap-x-1.5 mb-1">
                          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Stat</span>
                          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-right pr-0">Player</span>
                          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400"></span>
                          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400"></span>
                          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-left">Opp</span>
                          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-right">Stat</span>
                        </div>
                        <div className="space-y-0.5 text-sm">
                          {playerVsTeamRows.map((row) => {
                            const playerValue = renderPlayerSeasonValue(row.playerStatKey);
                            const opponentValue = renderOpponentSeasonValue(row.opponentStatCode);
                            const playerRank = playerValue != null ? renderPlayerTeamRank(row.playerRankKey) : null;
                            const opponentRank = opponentValue != null ? renderOpponentTeamRank(row.opponentStatCode) : null;
                            return (
                              <div key={`m-${row.label}`} className="grid grid-cols-[minmax(0,1fr)_12ch_3.5ch_3.5ch_6ch_minmax(0,1fr)] items-center gap-x-1.5 min-w-0">
                                <span className="text-gray-700 dark:text-gray-200 truncate pr-1">{row.label}</span>
                                <span className="font-semibold text-gray-900 dark:text-white justify-self-end text-right tabular-nums whitespace-nowrap text-[11px]">
                                  {renderPlayerSeasonValueWithDisposalShare(row.playerStatKey) ?? '—'}
                                </span>
                                <span className="justify-self-start whitespace-nowrap">
                                  {playerRank ?? <span className="inline-block w-[3.5ch]" />}
                                </span>
                                <span className="justify-self-end whitespace-nowrap">
                                  {opponentRank ?? <span className="inline-block w-[3.5ch]" />}
                                </span>
                                <span className="font-semibold text-gray-900 dark:text-white justify-self-start text-left tabular-nums whitespace-nowrap">
                                  {opponentValue ?? '—'}
                                </span>
                                <span className="text-gray-700 dark:text-gray-200 truncate pl-1 text-right">{row.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className={`rounded-lg border px-1.5 py-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Prediction Model</h4>
                        <div className="text-[11px] text-gray-600 dark:text-gray-300">
                          Best Side:{' '}
                          {(() => {
                            const lineForPrediction =
                              aflDisposalsModelProjection?.modelLine != null
                                ? aflDisposalsModelProjection.modelLine
                                : (aflCurrentLineValue != null ? aflCurrentLineValue : null);
                            const expected = aflDisposalsModelProjection?.expectedDisposals;
                            const isNeutral =
                              lineForPrediction != null &&
                              expected != null &&
                              Math.abs(expected - lineForPrediction) <= MODEL_NEUTRAL_LINE_GAP;
                            if (isNeutral) {
                              return <span className="font-bold text-gray-500 dark:text-gray-300">Neutral</span>;
                            }
                            return (
                          <span className={`font-bold ${
                            aflDisposalsModelProjection?.edgeVsMarket == null
                              ? 'text-gray-900 dark:text-white'
                              : aflDisposalsModelProjection.edgeVsMarket >= 0
                                ? 'text-green-500'
                                : 'text-red-500'
                          }`}>
                            {aflDisposalsModelProjection?.edgeVsMarket == null
                              ? '—'
                              : aflDisposalsModelProjection.edgeVsMarket >= 0
                                ? 'Over'
                                : 'Under'}
                          </span>
                            );
                          })()}
                        </div>
                      </div>
                        {aflDisposalsModelProjection ? (
                        <div className="space-y-2 text-sm text-center">
                            <div className="text-purple-600 dark:text-purple-300">
                              Line for prediction:{' '}
                              <span className="font-bold text-gray-900 dark:text-white">
                                {aflDisposalsModelProjection.modelLine != null
                                  ? aflDisposalsModelProjection.modelLine.toFixed(1)
                                  : (aflCurrentLineValue != null ? aflCurrentLineValue.toFixed(1) : '—')}
                              </span>
                            </div>
                            <div className="text-gray-600 dark:text-gray-300">
                              Expected Disposals: <span className="font-bold text-gray-900 dark:text-white">{aflDisposalsModelProjection.expectedDisposals.toFixed(1)}</span>
                            </div>
                            <div className="text-gray-600 dark:text-gray-300">
                              Edge (Best Side):{' '}
                            <span className={`font-bold ${
                                aflDisposalsModelProjection.edgeVsMarket == null
                                  ? 'text-gray-900 dark:text-white'
                                  : (() => {
                                      const lineForPrediction =
                                        aflDisposalsModelProjection.modelLine != null
                                          ? aflDisposalsModelProjection.modelLine
                                          : (aflCurrentLineValue != null ? aflCurrentLineValue : null);
                                      const expected = aflDisposalsModelProjection.expectedDisposals;
                                      return (
                                        lineForPrediction != null &&
                                        expected != null &&
                                        Math.abs(expected - lineForPrediction) <= MODEL_NEUTRAL_LINE_GAP
                                      );
                                    })()
                                    ? 'text-gray-500 dark:text-gray-300'
                                  : ((aflDisposalsModelProjection.recommendedSide === 'OVER' || (aflDisposalsModelProjection.recommendedSide == null && aflDisposalsModelProjection.edgeVsMarket >= 0))
                                      ? (aflDisposalsModelProjection.edgeVsMarket >= 0)
                                      : (-aflDisposalsModelProjection.edgeVsMarket >= 0))
                                    ? 'text-green-500'
                                    : 'text-red-500'
                              }`}>
                                {aflDisposalsModelProjection.edgeVsMarket == null
                                  ? '—'
                                  : (() => {
                                      const lineForPrediction =
                                        aflDisposalsModelProjection.modelLine != null
                                          ? aflDisposalsModelProjection.modelLine
                                          : (aflCurrentLineValue != null ? aflCurrentLineValue : null);
                                      const expected = aflDisposalsModelProjection.expectedDisposals;
                                      return (
                                        lineForPrediction != null &&
                                        expected != null &&
                                        Math.abs(expected - lineForPrediction) <= MODEL_NEUTRAL_LINE_GAP
                                      );
                                    })()
                                    ? 'No edge'
                                  : (() => {
                                      const bestEdge = (aflDisposalsModelProjection.recommendedSide === 'OVER' || (aflDisposalsModelProjection.recommendedSide == null && aflDisposalsModelProjection.edgeVsMarket >= 0))
                                        ? aflDisposalsModelProjection.edgeVsMarket
                                        : -aflDisposalsModelProjection.edgeVsMarket;
                                      return `${bestEdge >= 0 ? '+' : ''}${(bestEdge * 100).toFixed(1)}%`;
                                    })()}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={refreshAflDisposalsModelForCurrentLine}
                              disabled={aflDisposalsModelRefreshLoading}
                              className="w-full text-xs font-semibold text-purple-600 dark:text-purple-300 hover:underline disabled:opacity-60"
                            >
                              {aflDisposalsModelRefreshLoading ? 'Refreshing model...' : 'Line changed? refresh here'}
                            </button>
                            {aflDisposalsModelProjection.isTop3PickInGame === false && (
                              <div className="text-xs text-amber-500 dark:text-amber-400">
                                Not in top 3 picks for this game.
                              </div>
                            )}
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={openAflTopPicksModal}
                                className="text-xs font-semibold text-purple-600 dark:text-purple-300 hover:underline"
                              >
                                View Top Picks
                              </button>
                            </div>
                          </div>
                        ) : (
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                            No model projection available.
                          </div>
                        )}
                        <div className="mt-3">
                          <div className="text-sm font-semibold uppercase tracking-wide text-gray-900 dark:text-white mb-1.5">
                            From Past Lines
                          </div>
                          {aflDisposalsPastLinesLoading ? (
                            <div className="text-xs text-gray-500 dark:text-gray-400">Loading history...</div>
                          ) : aflDisposalsPastLinesCompleted.length === 0 ? (
                            <div className="text-xs text-gray-500 dark:text-gray-400">No completed games yet.</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-sm">
                                <thead>
                                  <tr className="text-left text-gray-700 dark:text-white border-b border-gray-200 dark:border-gray-700">
                                    <th className="py-1 pr-2 font-semibold">Date</th>
                                    <th className="py-1 pr-2 font-semibold">Book</th>
                                    <th className="py-1 pr-2 font-semibold">Model</th>
                                    <th className="py-1 pr-2 font-semibold">Ended</th>
                                    <th className="py-1 pr-2 font-semibold">Diff</th>
                                    <th className="py-1 font-semibold">TOG</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {aflDisposalsPastLinesCompleted.map((row, idx) => {
                                    const bookmakerInfo = getBookmakerInfo(String(row.bookmaker ?? ''));
                                    const lineValue = typeof row.line === 'number' ? row.line : null;
                                    const modelValue = typeof row.modelExpectedDisposals === 'number' ? row.modelExpectedDisposals : null;
                                    const actualValue = typeof row.actualDisposals === 'number' ? row.actualDisposals : null;
                                    const wonByModel = lineValue != null && modelValue != null && actualValue != null && (
                                      (modelValue > lineValue && actualValue > lineValue) ||
                                      (modelValue < lineValue && actualValue < lineValue)
                                    );
                                    const lostByModel = lineValue != null && modelValue != null && actualValue != null && (
                                      (modelValue > lineValue && actualValue < lineValue) ||
                                      (modelValue < lineValue && actualValue > lineValue)
                                    );
                                    const endedTextClass = wonByModel
                                      ? 'text-green-500'
                                      : lostByModel
                                        ? 'text-red-500'
                                        : 'text-gray-900 dark:text-white';
                                    return (
                                      <tr key={`${row.snapshotKey ?? 'row'}-${idx}`} className="border-b border-gray-100 dark:border-gray-800/60">
                                        <td className="py-1 pr-2 text-gray-700 dark:text-gray-200">{formatPastLineDate(row.gameDate)}</td>
                                        <td className="py-1 pr-2">
                                          <div className="flex items-center gap-1.5">
                                            {bookmakerInfo.logoUrl ? (
                                              <>
                                                <img
                                                  src={bookmakerInfo.logoUrl}
                                                  alt={bookmakerInfo.name}
                                                  className="w-5 h-5 rounded object-contain"
                                                  onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                    const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                                    if (fallback) fallback.style.display = 'flex';
                                                  }}
                                                />
                                                <span
                                                  className="w-5 h-5 rounded hidden items-center justify-center text-[10px] font-semibold text-white"
                                                  style={{ backgroundColor: bookmakerInfo.color }}
                                                >
                                                  {bookmakerInfo.logo}
                                                </span>
                                              </>
                                            ) : (
                                              <span
                                                className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                                                style={{ backgroundColor: bookmakerInfo.color }}
                                              >
                                                {bookmakerInfo.logo}
                                              </span>
                                            )}
                                            <span className="text-xs text-gray-900 dark:text-white tabular-nums">
                                              {typeof row.line === 'number' ? row.line.toFixed(1) : '—'}
                                            </span>
                                          </div>
                                        </td>
                                        <td className="py-1 pr-2 text-gray-900 dark:text-white tabular-nums">
                                          {typeof row.modelExpectedDisposals === 'number' ? row.modelExpectedDisposals.toFixed(1) : '—'}
                                        </td>
                                        <td className={`py-1 pr-2 tabular-nums ${endedTextClass}`}>
                                          {typeof row.actualDisposals === 'number' ? row.actualDisposals.toFixed(1) : '—'}
                                        </td>
                                        <td className="py-1 pr-2 text-gray-900 dark:text-white tabular-nums">
                                          {typeof row.differenceLine === 'number' ? `${row.differenceLine >= 0 ? '+' : ''}${row.differenceLine.toFixed(1)}` : '—'}
                                        </td>
                                        <td className="py-1 text-gray-900 dark:text-white tabular-nums">
                                          {typeof row.actualTog === 'number' ? `${row.actualTog.toFixed(1)}%` : '—'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* 4.55. Lineups - mobile only; same as desktop lineup, under DVP/opp breakdown. Game Props: use odds game so lineup matches. */}
                {(aflPropsMode === 'player' || aflPropsMode === 'team') && (
                  <div className={`lg:hidden w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                    <AflTeamSelectionsCard
                      isDark={!!mounted && isDark}
                      playerTeam={
                        aflPropsMode === 'player' && selectedPlayer?.team
                          ? (rosterTeamToInjuryTeam(String(selectedPlayer.team)) || String(selectedPlayer.team))
                          : aflPropsMode === 'team'
                            ? (aflOddsHomeTeam?.trim()
                                ? (rosterTeamToInjuryTeam(aflOddsHomeTeam) || aflOddsHomeTeam)
                                : aflTeamFilter && aflTeamFilter !== 'All'
                                  ? (rosterTeamToInjuryTeam(aflTeamFilter) || aflTeamFilter)
                                  : null)
                            : null
                      }
                      selectedPlayerName={aflPropsMode === 'player' && selectedPlayer?.name ? String(selectedPlayer.name) : null}
                    />
                  </div>
                )}
                {/* 4.6. Injuries - mobile only; desktop uses right panel */}
                {aflPropsMode === 'player' && (
                  <div
                    className={`lg:hidden rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 w-full min-w-0 flex flex-col max-h-[50vh] min-h-0`}
                  >
                    {showEmptyShell || showStatsLoadingShell ? (
                      <div className="flex-1 min-h-0 flex items-center justify-center">
                        <div className={`text-sm ${emptyText}`}>Select a player to view</div>
                      </div>
                    ) : (
                      <div className="relative flex-1 min-h-0 w-full min-w-0 flex flex-col overflow-y-auto overscroll-contain max-h-[50vh]">
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
                )}
                {/* 4.7. AFL Ladder - mobile only; desktop uses right panel */}
                <div className={`lg:hidden w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4`}>
                  <AflLadderCard isDark={!!mounted && isDark} season={Math.min(season, 2026)} logoByTeam={logoByTeam} />
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
                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} px-3 pt-3 pb-4 relative overflow-visible`}>
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
                {/* DVP | Opponent Breakdown - desktop right panel */}
                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} p-1.5 xl:p-2 w-full min-w-0`}>
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
                      <div className="flex gap-1.5 xl:gap-2 mb-2">
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
                        <button
                          onClick={() => {
                            setAflRightTab('team_matchup');
                            setAflRightTabsVisited((prev) => new Set(prev).add('team_matchup'));
                          }}
                          className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                            aflRightTab === 'team_matchup'
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          Team Matchup
                        </button>
                      </div>
                      <div className="relative h-[380px] xl:h-[420px] w-full min-w-0 flex flex-col min-h-0">
                        {((aflPropsMode === 'team' && aflRightTab === 'breakdown') || (aflPropsMode === 'player' && aflRightTabsVisited.has('breakdown'))) && (
                          <div className={aflRightTab === 'breakdown' ? 'flex flex-col h-full min-h-0' : 'hidden'}>
                            <AflOpponentBreakdownCard
                              key={`${selectedHeaderTeamName ?? 'no-team'}-${displayOpponent ?? 'no-opponent'}-desktop`}
                              isDark={!!mounted && isDark}
                              season={season}
                              playerName={
                                aflPropsMode === 'team'
                                  ? (selectedHeaderTeamName || null)
                                  : (selectedPlayer?.name ? String(selectedPlayer.name) : null)
                              }
                              lastOpponent={matchupOpponent}
                            />
                          </div>
                        )}
                        {aflPropsMode === 'player' && aflRightTabsVisited.has('dvp') && (
                          <div className={aflRightTab === 'dvp' ? 'flex-1 min-h-0 overflow-y-auto flex flex-col' : 'hidden'}>
                            <AflDvpCard
                              isDark={!!mounted && isDark}
                              season={Math.min(season, 2026)}
                              playerName={selectedPlayer?.name ? String(selectedPlayer.name) : null}
                              opponentTeam={aflTeamFilter !== 'All' && aflTeamFilter ? aflTeamFilter : (matchupOpponent || '')}
                              logoByTeam={logoByTeam}
                              playerPosition={
                                selectedPlayer?.position && ['DEF', 'MID', 'FWD', 'RUC'].includes(String(selectedPlayer.position))
                                  ? (selectedPlayer.position as 'DEF' | 'MID' | 'FWD' | 'RUC')
                                  : undefined
                              }
                            />
                          </div>
                        )}
                        {((aflPropsMode === 'team' && aflRightTab === 'team_matchup') || (aflPropsMode === 'player' && aflRightTabsVisited.has('team_matchup'))) && (
                          <div className={aflRightTab === 'team_matchup' ? 'flex flex-col h-full min-h-0' : 'hidden'}>
                            <AflTeamMatchupCard
                              isDark={!!mounted && isDark}
                              season={season}
                              teamName={selectedHeaderTeamName}
                              opponentName={matchupOpponent}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {/* Player vs Team - desktop right panel */}
                {aflPropsMode === 'player' && (
                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} px-1.5 xl:px-2 py-1.5 xl:py-2 w-full min-w-0 mt-0`}>
                  <div className="flex gap-1.5 xl:gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setPlayerVsContainerTab('comparison')}
                      className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                        playerVsContainerTab === 'comparison'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      Player vs Team
                    </button>
                    <button
                      type="button"
                      disabled={AFL_PREDICTION_MODEL_UNDER_MAINTENANCE}
                      title={
                        AFL_PREDICTION_MODEL_UNDER_MAINTENANCE
                          ? 'Prediction model is under maintenance'
                          : undefined
                      }
                      onClick={() => {
                        if (!AFL_PREDICTION_MODEL_UNDER_MAINTENANCE) {
                          setPlayerVsContainerTab('prediction');
                        }
                      }}
                      className={`relative flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                        !AFL_PREDICTION_MODEL_UNDER_MAINTENANCE && playerVsContainerTab === 'prediction'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                      } ${
                        AFL_PREDICTION_MODEL_UNDER_MAINTENANCE
                          ? 'cursor-not-allowed opacity-65'
                          : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      Prediction Model
                      <span
                        className={`absolute -top-2 -right-2 inline-flex max-w-[calc(100%-0.5rem)] items-center rounded-md border px-1 py-0.5 text-[8px] font-bold leading-none tracking-wide text-white shadow-sm ${
                          AFL_PREDICTION_MODEL_UNDER_MAINTENANCE
                            ? 'border-amber-600 bg-amber-600 dark:border-amber-500/80 dark:bg-amber-700'
                            : 'border-red-300 bg-red-500 dark:border-red-500/70 dark:bg-red-600'
                        }`}
                      >
                        {AFL_PREDICTION_MODEL_UNDER_MAINTENANCE ? 'MAINTENANCE' : 'BETA'}
                      </span>
                    </button>
                  </div>
                  {!showAflPredictionPanel ? (
                    <>
                      <div className="flex justify-center mb-2">
                        <div className={`inline-flex rounded-lg border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
                          <button
                            type="button"
                            onClick={() => setPlayerVsRankScope('team')}
                            className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              playerVsRankScope === 'team'
                                ? 'bg-purple-600 text-white'
                                : isDark ? 'bg-transparent text-gray-400 hover:text-gray-200' : 'bg-transparent text-gray-600 hover:text-gray-900'
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
                                : isDark ? 'bg-transparent text-gray-400 hover:text-gray-200' : 'bg-transparent text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            vs League
                          </button>
                        </div>
                      </div>
                      <div className="flex items-start mb-1">
                        <div className="flex-1 flex items-start justify-start pr-3">
                          <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">
                            {selectedPlayer?.name ? String(selectedPlayer.name) : 'Select a player'}
                          </span>
                        </div>
                        <div className="flex-1 flex items-start justify-end pl-3">
                          <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white text-right truncate">
                            {aflTeamFilter !== 'All' && aflTeamFilter
                              ? aflTeamFilter
                              : (matchupOpponent || 'Select opponent')}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs sm:text-sm min-w-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] xl:grid-cols-[minmax(0,1fr)_12ch_auto_auto_auto_minmax(0,1fr)] gap-x-1 xl:gap-x-2 mb-1">
                          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-left">Player season avg</span>
                          <span />
                          <span />
                          <span />
                          <span />
                          <span className="hidden xl:block text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-right">Opponent team avg</span>
                        </div>
                        <div className="space-y-0.5">
                          {playerVsTeamRows.map((row) => {
                            const playerValue = renderPlayerSeasonValue(row.playerStatKey);
                            const opponentValue = renderOpponentSeasonValue(row.opponentStatCode);
                            const playerRank = playerValue != null ? renderPlayerTeamRank(row.playerRankKey) : null;
                            const opponentRank = opponentValue != null ? renderOpponentTeamRank(row.opponentStatCode) : null;
                            return (
                            <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] xl:grid-cols-[minmax(0,1fr)_12ch_auto_auto_auto_minmax(0,1fr)] items-center gap-x-1 xl:gap-x-2 min-w-0">
                              <span className="text-gray-700 dark:text-gray-200 text-left whitespace-nowrap truncate pr-1">{row.label}</span>
                              <span className="font-semibold text-gray-900 dark:text-white justify-self-end w-[5ch] xl:w-[12ch] text-right tabular-nums whitespace-nowrap text-[11px] xl:text-xs">
                                {renderPlayerSeasonValueWithDisposalShare(row.playerStatKey) ?? '—'}
                              </span>
                              <span className="justify-self-start whitespace-nowrap">
                                {playerRank ?? <span className="inline-block w-[3.5ch] xl:w-[4ch]" />}
                              </span>
                              <span className="justify-self-end whitespace-nowrap">
                                {opponentRank ?? <span className="inline-block w-[3.5ch] xl:w-[4ch]" />}
                              </span>
                              <span className="font-semibold text-gray-900 dark:text-white justify-self-start w-[6ch] xl:w-[7ch] text-left tabular-nums whitespace-nowrap">
                                {opponentValue ?? '—'}
                              </span>
                              <span className="hidden xl:block text-gray-700 dark:text-gray-200 text-right whitespace-nowrap truncate pl-1">{row.label}</span>
                            </div>
                          )})}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className={`rounded-lg border px-1.5 py-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Prediction Model</h4>
                        <div className="text-[11px] text-gray-600 dark:text-gray-300">
                          Best Side:{' '}
                          {(() => {
                            const lineForPrediction =
                              aflDisposalsModelProjection?.modelLine != null
                                ? aflDisposalsModelProjection.modelLine
                                : (aflCurrentLineValue != null ? aflCurrentLineValue : null);
                            const expected = aflDisposalsModelProjection?.expectedDisposals;
                            const isNeutral =
                              lineForPrediction != null &&
                              expected != null &&
                              Math.abs(expected - lineForPrediction) <= MODEL_NEUTRAL_LINE_GAP;
                            if (isNeutral) {
                              return <span className="font-bold text-gray-500 dark:text-gray-300">Neutral</span>;
                            }
                            return (
                              <span className={`font-bold ${
                                aflDisposalsModelProjection?.edgeVsMarket == null
                                  ? 'text-gray-900 dark:text-white'
                                  : aflDisposalsModelProjection.edgeVsMarket >= 0
                                    ? 'text-green-500'
                                    : 'text-red-500'
                              }`}>
                                {aflDisposalsModelProjection?.edgeVsMarket == null
                                  ? '—'
                                  : aflDisposalsModelProjection.edgeVsMarket >= 0
                                    ? 'Over'
                                    : 'Under'}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      {aflDisposalsModelProjection ? (
                        <div className="space-y-2 text-sm text-center">
                          <div className="text-purple-600 dark:text-purple-300">
                            Line for prediction:{' '}
                            <span className="font-bold text-gray-900 dark:text-white">
                              {aflDisposalsModelProjection.modelLine != null
                                ? aflDisposalsModelProjection.modelLine.toFixed(1)
                                : (aflCurrentLineValue != null ? aflCurrentLineValue.toFixed(1) : '—')}
                            </span>
                          </div>
                          <div className="text-gray-600 dark:text-gray-300">
                            Expected Disposals: <span className="font-bold text-gray-900 dark:text-white">{aflDisposalsModelProjection.expectedDisposals.toFixed(1)}</span>
                          </div>
                          <div className="text-gray-600 dark:text-gray-300">
                            Edge (Best Side):{' '}
                              <span className={`font-bold ${
                              aflDisposalsModelProjection.edgeVsMarket == null
                                ? 'text-gray-900 dark:text-white'
                                : (() => {
                                    const lineForPrediction =
                                      aflDisposalsModelProjection.modelLine != null
                                        ? aflDisposalsModelProjection.modelLine
                                        : (aflCurrentLineValue != null ? aflCurrentLineValue : null);
                                    const expected = aflDisposalsModelProjection.expectedDisposals;
                                    return (
                                      lineForPrediction != null &&
                                      expected != null &&
                                      Math.abs(expected - lineForPrediction) <= MODEL_NEUTRAL_LINE_GAP
                                    );
                                  })()
                                  ? 'text-gray-500 dark:text-gray-300'
                                : ((aflDisposalsModelProjection.recommendedSide === 'OVER' || (aflDisposalsModelProjection.recommendedSide == null && aflDisposalsModelProjection.edgeVsMarket >= 0))
                                    ? (aflDisposalsModelProjection.edgeVsMarket >= 0)
                                    : (-aflDisposalsModelProjection.edgeVsMarket >= 0))
                                  ? 'text-green-500'
                                  : 'text-red-500'
                            }`}>
                              {aflDisposalsModelProjection.edgeVsMarket == null
                                ? '—'
                                : (() => {
                                    const lineForPrediction =
                                      aflDisposalsModelProjection.modelLine != null
                                        ? aflDisposalsModelProjection.modelLine
                                        : (aflCurrentLineValue != null ? aflCurrentLineValue : null);
                                    const expected = aflDisposalsModelProjection.expectedDisposals;
                                    return (
                                      lineForPrediction != null &&
                                      expected != null &&
                                      Math.abs(expected - lineForPrediction) <= MODEL_NEUTRAL_LINE_GAP
                                    );
                                  })()
                                  ? 'No edge'
                                : (() => {
                                    const bestEdge = (aflDisposalsModelProjection.recommendedSide === 'OVER' || (aflDisposalsModelProjection.recommendedSide == null && aflDisposalsModelProjection.edgeVsMarket >= 0))
                                      ? aflDisposalsModelProjection.edgeVsMarket
                                      : -aflDisposalsModelProjection.edgeVsMarket;
                                    return `${bestEdge >= 0 ? '+' : ''}${(bestEdge * 100).toFixed(1)}%`;
                                  })()}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={refreshAflDisposalsModelForCurrentLine}
                            disabled={aflDisposalsModelRefreshLoading}
                            className="w-full text-xs font-semibold text-purple-600 dark:text-purple-300 hover:underline disabled:opacity-60"
                          >
                            {aflDisposalsModelRefreshLoading ? 'Refreshing model...' : 'Line changed? refresh here'}
                          </button>
                          {aflDisposalsModelProjection.isTop3PickInGame === false && (
                            <div className="text-xs text-amber-500 dark:text-amber-400">
                              Not in top 3 picks for this game.
                            </div>
                          )}
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={openAflTopPicksModal}
                              className="text-xs font-semibold text-purple-600 dark:text-purple-300 hover:underline"
                            >
                              View Top Picks
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          No model projection available.
                        </div>
                      )}
                      <div className="mt-3">
                        <div className="text-sm font-semibold uppercase tracking-wide text-gray-900 dark:text-white mb-1.5">
                          From Past Lines
                        </div>
                        {aflDisposalsPastLinesLoading ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400">Loading history...</div>
                        ) : aflDisposalsPastLinesCompleted.length === 0 ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400">No completed games yet.</div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="text-left text-gray-700 dark:text-white border-b border-gray-200 dark:border-gray-700">
                                  <th className="py-1 pr-2 font-semibold">Date</th>
                                  <th className="py-1 pr-2 font-semibold">Book</th>
                                  <th className="py-1 pr-2 font-semibold">Model</th>
                                  <th className="py-1 pr-2 font-semibold">Ended</th>
                                  <th className="py-1 pr-2 font-semibold">Diff</th>
                                  <th className="py-1 font-semibold">TOG</th>
                                </tr>
                              </thead>
                              <tbody>
                                {aflDisposalsPastLinesCompleted.map((row, idx) => {
                                  const bookmakerInfo = getBookmakerInfo(String(row.bookmaker ?? ''));
                                  const lineValue = typeof row.line === 'number' ? row.line : null;
                                  const modelValue = typeof row.modelExpectedDisposals === 'number' ? row.modelExpectedDisposals : null;
                                  const actualValue = typeof row.actualDisposals === 'number' ? row.actualDisposals : null;
                                  const wonByModel = lineValue != null && modelValue != null && actualValue != null && (
                                    (modelValue > lineValue && actualValue > lineValue) ||
                                    (modelValue < lineValue && actualValue < lineValue)
                                  );
                                  const lostByModel = lineValue != null && modelValue != null && actualValue != null && (
                                    (modelValue > lineValue && actualValue < lineValue) ||
                                    (modelValue < lineValue && actualValue > lineValue)
                                  );
                                  const endedTextClass = wonByModel
                                    ? 'text-green-500'
                                    : lostByModel
                                      ? 'text-red-500'
                                      : 'text-gray-900 dark:text-white';
                                  return (
                                    <tr key={`${row.snapshotKey ?? 'row'}-${idx}`} className="border-b border-gray-100 dark:border-gray-800/60">
                                      <td className="py-1 pr-2 text-gray-700 dark:text-gray-200">{formatPastLineDate(row.gameDate)}</td>
                                      <td className="py-1 pr-2">
                                        <div className="flex items-center gap-1.5">
                                          {bookmakerInfo.logoUrl ? (
                                            <>
                                              <img
                                                src={bookmakerInfo.logoUrl}
                                                alt={bookmakerInfo.name}
                                                className="w-5 h-5 rounded object-contain"
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                  const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                                  if (fallback) fallback.style.display = 'flex';
                                                }}
                                              />
                                              <span
                                                className="w-5 h-5 rounded hidden items-center justify-center text-[10px] font-semibold text-white"
                                                style={{ backgroundColor: bookmakerInfo.color }}
                                              >
                                                {bookmakerInfo.logo}
                                              </span>
                                            </>
                                          ) : (
                                            <span
                                              className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                                              style={{ backgroundColor: bookmakerInfo.color }}
                                            >
                                              {bookmakerInfo.logo}
                                            </span>
                                          )}
                                          <span className="text-xs text-gray-900 dark:text-white tabular-nums">
                                            {typeof row.line === 'number' ? row.line.toFixed(1) : '—'}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="py-1 pr-2 text-gray-900 dark:text-white tabular-nums">
                                        {typeof row.modelExpectedDisposals === 'number' ? row.modelExpectedDisposals.toFixed(1) : '—'}
                                      </td>
                                      <td className={`py-1 pr-2 tabular-nums ${endedTextClass}`}>
                                        {typeof row.actualDisposals === 'number' ? row.actualDisposals.toFixed(1) : '—'}
                                      </td>
                                      <td className="py-1 pr-2 text-gray-900 dark:text-white tabular-nums">
                                        {typeof row.differenceLine === 'number' ? `${row.differenceLine >= 0 ? '+' : ''}${row.differenceLine.toFixed(1)}` : '—'}
                                      </td>
                                      <td className="py-1 text-gray-900 dark:text-white tabular-nums">
                                        {typeof row.actualTog === 'number' ? `${row.actualTog.toFixed(1)}%` : '—'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                )}
                {/* Injuries - desktop right panel */}
                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} p-2 xl:p-3 pb-12 xl:pb-14 w-full min-w-0`}>
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
                    <div className="relative h-[320px] w-full min-w-0 flex flex-col min-h-0">
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
                {/* AFL Ladder - desktop right panel */}
                <div className={`hidden lg:block rounded-lg ${AFL_DASH_CARD_GLOW} p-2 xl:p-3 w-full min-w-0 mt-0`}>
                  <AflLadderCard isDark={!!mounted && isDark} season={Math.min(season, 2026)} logoByTeam={logoByTeam} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showAflTopPicksModal && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowAflTopPicksModal(false)}
        >
          <div
            className={`w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl border p-4 shadow-2xl ${
              isDark ? 'bg-[#0b1a2c] border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Top Picks By Game</h3>
              <button
                type="button"
                onClick={() => setShowAflTopPicksModal(false)}
                className="text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Close
              </button>
            </div>
            {aflTopPicksModalLoading ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading top picks...</div>
            ) : aflTopPicksByGame.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">No ranked top picks available yet.</div>
            ) : (
              <div className={`max-h-[62vh] overflow-auto custom-scrollbar fade-scrollbar rounded-lg border ${
                isDark ? 'border-gray-700' : 'border-gray-200'
              }`}>
                <table className="min-w-full text-xs">
                  <thead className={`sticky top-0 z-10 ${isDark ? 'bg-[#0b1a2c]' : 'bg-white'}`}>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                      <th className="px-2.5 py-2 font-semibold text-gray-700 dark:text-gray-200">Game</th>
                      <th className="px-2.5 py-2 font-semibold text-gray-700 dark:text-gray-200">#</th>
                      <th className="px-2.5 py-2 font-semibold text-gray-700 dark:text-gray-200">Player</th>
                      <th className="px-2.5 py-2 font-semibold text-gray-700 dark:text-gray-200">Side</th>
                      <th className="px-2.5 py-2 font-semibold text-gray-700 dark:text-gray-200">Line</th>
                      <th className="px-2.5 py-2 font-semibold text-gray-700 dark:text-gray-200">Model</th>
                      <th className="px-2.5 py-2 font-semibold text-gray-700 dark:text-gray-200">Book</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aflTopPicksByGame.map((group, groupIdx) => {
                      const homeLogo = resolveTeamLogo(group.homeTeam, logoByTeam);
                      const awayLogo = resolveTeamLogo(group.awayTeam, logoByTeam);
                      const groupStripeClass = groupIdx % 2 === 0
                        ? (isDark ? 'bg-[#0b2138]' : 'bg-white')
                        : (isDark ? 'bg-[#102a44]' : 'bg-gray-50');
                      return group.picks.map((pick, idx) => {
                        const bookmakerInfo = getBookmakerInfo(String(pick.bookmaker ?? ''));
                        return (
                        <tr key={`${group.gameKey}-${pick.rank ?? 0}-${pick.playerName}`} className={`${groupStripeClass} border-b border-gray-100 dark:border-gray-800/60`}>
                          {idx === 0 ? (
                            <td rowSpan={group.picks.length} className="px-2.5 py-2 align-middle">
                              <div className="flex items-center justify-center gap-2">
                                {homeLogo ? (
                                  <img src={homeLogo} alt={group.homeTeam} className="h-6 w-6 rounded object-contain" />
                                ) : (
                                  <span className="h-6 w-6 rounded bg-gray-400/50" />
                                )}
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">vs</span>
                                {awayLogo ? (
                                  <img src={awayLogo} alt={group.awayTeam} className="h-6 w-6 rounded object-contain" />
                                ) : (
                                  <span className="h-6 w-6 rounded bg-gray-400/50" />
                                )}
                              </div>
                              <div className="mt-1.5 text-center text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                                {group.commenceTime ? formatPastLineDate(String(group.commenceTime).slice(0, 10)) : 'Game'}
                              </div>
                            </td>
                          ) : null}
                          <td className="px-2.5 py-2 text-gray-900 dark:text-white tabular-nums">{pick.rank ?? '—'}</td>
                          <td className="px-2.5 py-2 text-gray-900 dark:text-white">{pick.playerName}</td>
                          <td className="px-2.5 py-2 text-gray-700 dark:text-gray-200">{pick.recommendedSide ?? '—'}</td>
                          <td className="px-2.5 py-2 text-gray-900 dark:text-white tabular-nums">
                            {pick.line != null ? pick.line.toFixed(1) : '—'}
                          </td>
                          <td className="px-2.5 py-2 text-gray-900 dark:text-white tabular-nums">
                            {pick.expectedDisposals != null ? pick.expectedDisposals.toFixed(1) : '—'}
                          </td>
                          <td className="px-2.5 py-2">
                            {bookmakerInfo.logoUrl ? (
                              <>
                                <img
                                  src={bookmakerInfo.logoUrl}
                                  alt={bookmakerInfo.name}
                                  className="w-5 h-5 rounded object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                    if (fallback) fallback.style.display = 'flex';
                                  }}
                                />
                                <span
                                  className="w-5 h-5 rounded hidden items-center justify-center text-[10px] font-semibold text-white"
                                  style={{ backgroundColor: bookmakerInfo.color }}
                                >
                                  {bookmakerInfo.logo}
                                </span>
                              </>
                            ) : (
                              <span
                                className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                                style={{ backgroundColor: bookmakerInfo.color }}
                              >
                                {bookmakerInfo.logo}
                              </span>
                            )}
                          </td>
                        </tr>
                      )});
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Journal modal — AFL player props only (quick flow from chart). */}
      {aflPropsMode === 'player' &&
        selectedPlayer &&
        nextGameOpponent &&
        nextGameOpponent !== '' &&
        nextGameOpponent !== '—' &&
        nextGameTipoff && (
          <Suspense fallback={null}>
            <AddToJournalModal
              isOpen={showJournalModal}
              onClose={() => setShowJournalModal(false)}
              playerName={String(selectedPlayer.name ?? '')}
              playerId={String(selectedPlayer.id ?? selectedPlayer.name ?? '')}
              team={rosterTeamToInjuryTeam(String(selectedPlayer.team ?? '')) || String(selectedPlayer.team ?? '')}
              opponent={nextGameOpponent}
              gameDate={nextGameTipoff.toISOString().split('T')[0]}
              oddsFormat={oddsFormat}
              isGameProp={false}
              sport="afl"
              aflQuickJournal
              quickPreset={aflJournalQuickPreset}
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
          await supabase.auth.signOut({ scope: 'local' });
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
