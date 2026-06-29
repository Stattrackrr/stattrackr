import { worldCupTeamsMatch } from './worldCupFlags';
import { playerDashboardNeedsShotEventRefresh } from './worldCupPlayerShots';

/**
 * Curated cross-source name aliases for the World Cup dashboard's stat merge.
 *
 * The dashboard combines a selected 2026 World Cup player's stats with their
 * Euros / Nations League / Copa América / AFCON rows *by normalized name*. When
 * a player is stored under a slightly different name across sources (e.g. BDL
 * "Erling Haaland" vs API-Football "Erling Braut Haaland"), the exact-name match
 * misses real stats. This map links those known same-person spellings so no
 * player with data gets left out because of a name difference.
 *
 * KEY   = the World Cup (BDL) player's normalized name
 * VALUE = additional international normalized names that are the SAME person
 *
 * Only include pairs you are confident are the same human. Do NOT add name
 * twins who are different people (e.g. "Joan García" ≠ "Fran García",
 * "Mohamed Alaa" ≠ "Mohamed Salah", "Tim Weah" ≠ "Tim Ream"). Those must stay
 * unmatched so the wrong stats never merge.
 *
 * Names here must already be normalized with `normalizeWorldCupPlayerName`
 * (lowercase, accents/ø/å/ß folded, punctuation → spaces).
 */
export const WORLD_CUP_NAME_ALIASES: Record<string, string[]> = {
  'erling haaland': ['erling braut haaland'],
  'pablo gavi': ['gavi'],
  'ben gannon doak': ['ben doak'],
  'idrissa gana gueye': ['idrissa gueye'],
  'sondre langas': ['sondre klingen langas'],
  'lionel mpasi nzau': ['lionel mpasi'],
  'meschak elia': ['meschack elia'],
  'yeremy pino': ['yeremi pino'],
  'samu costa': ['samuel costa'],

  // Asian name-order aliases: BDL uses Family-Given ("Son Heung-min"), while
  // API Football full-name enrichment produces Given-Family ("Heung-Min Son").
  'son heung min': ['heung min son'],
  'hwang hee chan': ['hee chan hwang'],
  'kim min jae': ['min jae kim'],
  'lee kang in': ['kang in lee'],
  'hwang in beom': ['in beom hwang'],
  'cho gue sung': ['gue sung cho'],
  'oh hyeon gyu': ['hyeon gyu oh'],
  'song bum keun': ['beom keun song'],

  // Nickname → full name
  'tim weah': ['timothy weah'],
  'tino livramento': ['valentino livramento'],
  'tony ralston': ['anthony ralston'],

  // Middle name or prefix differences
  'ar jany martha': ['arjany martha'],
  'amine sbai': ['mohamed amine sbai'],
  'dayne st clair': ['dayne tristan st clair'],
  'derrick etienne': ['derrick etienne junior'],
  'frans putros': ['frans dhia putros'],
  'hossein hosseini': ['seyed hossein hosseini'],
  'meshaal barsham': ['meshaal aissa barsham'],
  'trevor iriving doornbusch': ['trevor doornbusch'],
  'noor al deen al rawabdeh': ['noor al rawabdeh'],

  // Transliteration variants (same name, different romanization)
  'jovo lukic': ['jovan lukic'],
  'mahdi torabi': ['mehdi torabi'],
  'mohammad abu zrayq': ['mohammed abu zrayq'],
  'odiljon khamrobekov': ['odildzhon khamrobekov'],
  'umarbek eshmuradov': ['umar eshmuradov'],
  'yazeed abu laila': ['yazeed abulaila'],
};

/** All international alias names a World Cup normalized name should also match. */
export function getWorldCupNameAliases(worldCupNormalizedName: string): string[] {
  return WORLD_CUP_NAME_ALIASES[worldCupNormalizedName] ?? [];
}

/**
 * Reverse index: international normalized name → World Cup normalized name.
 * Used when attaching international rows to World Cup index entries.
 */
export const INTERNATIONAL_TO_WORLD_CUP_ALIAS: Record<string, string> = Object.entries(
  WORLD_CUP_NAME_ALIASES
).reduce<Record<string, string>>((acc, [wcName, intlNames]) => {
  for (const intlName of intlNames) acc[intlName] = wcName;
  return acc;
}, {});

/** Resolve an international normalized name to its World Cup name if aliased. */
export function resolveWorldCupAliasName(internationalNormalizedName: string): string {
  return INTERNATIONAL_TO_WORLD_CUP_ALIAS[internationalNormalizedName] ?? internationalNormalizedName;
}

/**
 * Per-World-Cup-player overrides for name COLLISIONS — where one normalized
 * name maps to multiple DIFFERENT real people (e.g. two "Emiliano Martínez").
 * The by-name merge can't tell them apart, so we pin the correct international
 * identities per BDL player id (and exclude the wrong ones).
 *
 * KEY = World Cup (BDL) player id.
 */
export type IntlIdRef = { source: string; id: string };

export const WORLD_CUP_PLAYER_OVERRIDES: Record<
  string,
  { excludeIntlIds?: IntlIdRef[]; includeIntlIds?: IntlIdRef[] }
> = {
  // "Emiliano Martínez" — Argentina GK (Aston Villa) vs a Uruguay player.
  '8891': { excludeIntlIds: [{ source: 'api-football', id: '153083' }] }, // ARG → drop Uruguay's rows
  '30633': { excludeIntlIds: [{ source: 'api-football', id: '19599' }] }, // URY → drop Argentina's rows
  // "Cristian Martínez" — Panama vs Andorra.
  '30267': { excludeIntlIds: [{ source: 'api-football', id: '56053' }] }, // PAN → drop Andorra's rows
};

export function getWorldCupPlayerOverride(
  bdlPlayerId: string | null | undefined
): { excludeIntlIds?: IntlIdRef[]; includeIntlIds?: IntlIdRef[] } | null {
  if (!bdlPlayerId) return null;
  return WORLD_CUP_PLAYER_OVERRIDES[String(bdlPlayerId)] ?? null;
}

/** BDL player ids that have a curated collision override (used by the audit). */
export const OVERRIDDEN_WORLD_CUP_PLAYER_IDS = new Set(Object.keys(WORLD_CUP_PLAYER_OVERRIDES));

const SPECIAL_LETTER_MAP: Record<string, string> = {
  '\u00f8': 'o',
  '\u0153': 'oe',
  '\u00e6': 'ae',
  '\u00e5': 'a',
  '\u00df': 'ss',
  '\u00fe': 'th',
  '\u00f0': 'd',
  '\u0111': 'd',
  '\u0142': 'l',
  '\u0131': 'i',
  '\u014b': 'n',
  '\u0138': 'k',
  '\u02bb': '',
  "'": '',
};

const SPECIAL_LETTER_PATTERN = new RegExp(
  '[\\u00f8\\u0153\\u00e6\\u00e5\\u00df\\u00fe\\u00f0\\u0111\\u0142\\u0131\\u014b\\u0138\\u02bb\']',
  'g'
);

export function normalizeWorldCupPlayerName(name: string): string {
  const folded = String(name || '')
    .toLowerCase()
    .replace(SPECIAL_LETTER_PATTERN, (ch) => SPECIAL_LETTER_MAP[ch] ?? ch);
  return folded
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Client-safe slug for /world-cup/player/[slug] deep links. */
export function worldCupPlayerNameToSlug(name: string): string {
  const normalized = normalizeWorldCupPlayerName(name);
  return normalized ? normalized.replace(/\s+/g, '-') : '';
}

export function worldCupPlayerSlugToSearchHint(slug: string): string {
  return String(slug || '')
    .trim()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalizeWorldCupNamePart(part: string): string {
  if (!part) return part;
  return part
    .split(/([-'])/)
    .map((segment) => {
      if (segment === '-' || segment === "'") return segment;
      if (!segment) return segment;
      const lower = segment.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/** Title-case each name part for dashboard display (e.g. "cody gakpo" → "Cody Gakpo"). */
export function formatWorldCupPlayerDisplayName(name: string): string {
  const sanitized = String(name || '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .trim();
  if (!sanitized) return sanitized;
  return sanitized
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizeWorldCupNamePart)
    .join(' ');
}

// --- World Cup dashboard client prefetch (browser-only) ---

type WorldCupClientCacheEntry<T> = { data: T; timestamp: number };

const WORLD_CUP_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;
const WORLD_CUP_DASHBOARD_PREFETCH_TTL_MS = 120 * 1000;
const WORLD_CUP_DASHBOARD_PREFETCH_KEY = 'wc_dashboard_prefetch';
export const WC_PLAYER_DASHBOARD_LOCAL_CACHE_PREFIX = 'wcPlayerDashboardCache:v3';
export const WC_PLAYER_DASHBOARD_LOCAL_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours — mirrors AFL logs cache
export const WC_PLAYER_ODDS_PREFETCH_KEY = 'wc_player_odds_prefetch';
export const WC_PLAYER_ODDS_PREFETCH_TTL_MS = 120 * 1000;

const worldCupDashboardClientCache = new Map<string, WorldCupClientCacheEntry<unknown>>();
const worldCupDashboardInFlight = new Map<string, Promise<unknown>>();
const worldCupDashboardInFlightByKey = new Map<string, Promise<unknown>>();
const prefetchedDashboardMem = new Map<string, unknown>();

export function readPrefetchedWorldCupDashboardMem<T>(requestKey: string): T | null {
  const value = prefetchedDashboardMem.get(requestKey);
  return value != null ? (value as T) : null;
}

export function isWorldCupDashboardFetchInFlight(requestKey: string): boolean {
  return worldCupDashboardInFlightByKey.has(requestKey);
}

function rememberPrefetchedWorldCupDashboard<T>(requestKey: string, url: string, data: T): T {
  prefetchedDashboardMem.set(requestKey, data);
  seedWorldCupDashboardClientCache(url, data, requestKey);
  storeWorldCupDashboardPrefetch(requestKey, data);
  writeWorldCupDashboardLocalCache(requestKey, data);
  return data;
}

function requestKeyFromDashboardUrl(url: string): string {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return worldCupDashboardRequestKey(query);
}

function clientCacheKeyForRequestKey(requestKey: string): string {
  return `key:${requestKey}`;
}

export function worldCupDashboardRequestKey(params: URLSearchParams | string): string {
  const source = typeof params === 'string' ? new URLSearchParams(params) : params;
  const normalized = new URLSearchParams();
  for (const [key, value] of [...source.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const nextValue =
      key === 'playerName' || key === 'teamName' || key === 'opponentTeamName'
        ? value.trim().toLowerCase()
        : value;
    normalized.append(key, nextValue);
  }
  return normalized.toString();
}

export function worldCupDashboardRequestIdentityMatches(storedKey: string, requestedKey: string): boolean {
  if (storedKey === requestedKey) return true;
  const stored = new URLSearchParams(storedKey);
  const requested = new URLSearchParams(requestedKey);
  const storedPlayerId = stored.get('playerId');
  const requestedPlayerId = requested.get('playerId');
  const storedPlayerName = stored.get('playerName')?.trim().toLowerCase() ?? '';
  const requestedPlayerName = requested.get('playerName')?.trim().toLowerCase() ?? '';
  const storedSeason = stored.get('season') ?? '2026';
  const requestedSeason = requested.get('season') ?? '2026';
  if (storedSeason !== requestedSeason) return false;
  const storedCompetition = stored.get('competition') ?? 'all';
  const requestedCompetition = requested.get('competition') ?? 'all';
  const competitionCompatible =
    storedCompetition === requestedCompetition ||
    (storedCompetition === 'all' && requestedCompetition === 'world-cup') ||
    (storedCompetition === 'world-cup' && requestedCompetition === 'all');
  if (!competitionCompatible) return false;
  if (requestedPlayerId && storedPlayerId && requestedPlayerId === storedPlayerId) return true;
  if (requestedPlayerName && storedPlayerName && requestedPlayerName === storedPlayerName) return true;
  return false;
}

export function buildWorldCupPlayerDashboardParams(input: {
  playerName: string;
  playerId?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  opponentTeamId?: string | null;
  opponentTeamName?: string | null;
  competition?: string;
  season?: string;
  playerChartOnly?: boolean;
}): URLSearchParams {
  const params = new URLSearchParams({
    season: input.season ?? '2026',
    competition: input.competition ?? 'all',
  });
  params.set('playerName', input.playerName);
  if (input.playerId && /^\d+$/.test(input.playerId)) params.set('playerId', input.playerId);
  if (input.teamId && /^\d+$/.test(input.teamId)) params.set('teamId', input.teamId);
  else if (input.teamName?.trim()) params.set('teamName', input.teamName.trim());
  if (input.opponentTeamName?.trim()) params.set('opponentTeamName', input.opponentTeamName.trim());
  if (input.opponentTeamId && /^\d+$/.test(input.opponentTeamId)) {
    params.set('opponentTeamId', input.opponentTeamId);
  }
  if (input.playerChartOnly) params.set('playerChartOnly', '1');
  return params;
}

export function buildWorldCupDashboardRequestKeyFromPage(input: {
  playerId?: string | null;
  playerQuery?: string | null;
  playerSlug?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  opponentTeamId?: string | null;
  opponentName?: string | null;
  competition?: string;
}): string | null {
  const playerName =
    input.playerQuery?.trim() ||
    (input.playerSlug ? worldCupPlayerSlugToSearchHint(input.playerSlug) : '') ||
    '';
  const playerId = input.playerId?.trim() || null;
  if (!playerName && !playerId) return null;
  const params = buildWorldCupPlayerDashboardParams({
    playerName: playerName || 'World Cup Player',
    playerId: /^\d+$/.test(playerId || '') ? playerId : null,
    teamId: input.teamId && /^\d+$/.test(input.teamId) ? input.teamId : null,
    teamName: input.teamId && /^\d+$/.test(input.teamId) ? null : input.teamName?.trim() || null,
    opponentTeamId:
      input.opponentTeamId && /^\d+$/.test(input.opponentTeamId) ? input.opponentTeamId : null,
    opponentTeamName: input.opponentName?.trim() || null,
    competition: input.competition ?? 'all',
  });
  return worldCupDashboardRequestKey(params);
}

function shouldPersistWorldCupDashboardLocalCache(requestKey: string): boolean {
  const params = new URLSearchParams(requestKey);
  if (params.get('playerOdds') === '1') return false;
  if (params.get('teamsOnly') === '1') return false;
  if (params.get('oppBreakdown') === '1') return false;
  if (params.get('playerPropsList') === '1') return false;
  return Boolean(params.get('playerName') || params.get('playerId'));
}

export function getWorldCupDashboardLocalCacheStorageKey(requestKey: string): string {
  return `${WC_PLAYER_DASHBOARD_LOCAL_CACHE_PREFIX}:${requestKey}`;
}

export function readWorldCupDashboardLocalCache<T>(requestKey: string): T | null {
  if (typeof window === 'undefined' || !requestKey) return null;
  if (!shouldPersistWorldCupDashboardLocalCache(requestKey)) return null;
  try {
    const raw = localStorage.getItem(getWorldCupDashboardLocalCacheStorageKey(requestKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: T; createdAt?: number };
    if (!parsed?.data || !Number.isFinite(parsed.createdAt)) return null;
    if (Date.now() - Number(parsed.createdAt) > WC_PLAYER_DASHBOARD_LOCAL_CACHE_TTL_MS) {
      localStorage.removeItem(getWorldCupDashboardLocalCacheStorageKey(requestKey));
      return null;
    }
    const params = new URLSearchParams(requestKey);
    const playerId = params.get('playerId');
    if (playerDashboardNeedsShotEventRefresh(parsed.data as Record<string, unknown>, playerId)) {
      localStorage.removeItem(getWorldCupDashboardLocalCacheStorageKey(requestKey));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeWorldCupDashboardLocalCache<T>(requestKey: string, data: T): void {
  if (typeof window === 'undefined' || !requestKey) return;
  if (!shouldPersistWorldCupDashboardLocalCache(requestKey)) return;
  try {
    localStorage.setItem(
      getWorldCupDashboardLocalCacheStorageKey(requestKey),
      JSON.stringify({ data, createdAt: Date.now() })
    );
  } catch {
    // ignore quota / private mode
  }
}

function seedWorldCupDashboardClientCache<T>(url: string, data: T, requestKey?: string): void {
  const timestamp = Date.now();
  worldCupDashboardClientCache.set(url, { data, timestamp });
  const key = requestKey ?? requestKeyFromDashboardUrl(url);
  worldCupDashboardClientCache.set(clientCacheKeyForRequestKey(key), { data, timestamp });
  writeWorldCupDashboardLocalCache(key, data);
}

export function storeWorldCupDashboardPrefetch(requestKey: string, data: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      WORLD_CUP_DASHBOARD_PREFETCH_KEY,
      JSON.stringify({ requestKey, data, fetchedAt: Date.now() })
    );
  } catch {
    // ignore storage failures
  }
}

function dashboardRequestIsChartOnly(requestKey: string): boolean {
  return new URLSearchParams(requestKey).get('playerChartOnly') === '1';
}

function dashboardPayloadIsChartOnly(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === 'object' &&
      (data as { playerChartOnly?: boolean }).playerChartOnly === true
  );
}

export function consumeWorldCupDashboardPrefetch<T>(requestKey: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(WORLD_CUP_DASHBOARD_PREFETCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { requestKey?: string; data?: T; fetchedAt?: number };
    const ageMs = Date.now() - Number(parsed.fetchedAt ?? 0);
    if (ageMs > WORLD_CUP_DASHBOARD_PREFETCH_TTL_MS) return null;
    if (
      parsed.requestKey !== requestKey &&
      (!parsed.requestKey || !worldCupDashboardRequestIdentityMatches(parsed.requestKey, requestKey))
    ) {
      return null;
    }
    const requestedChart = dashboardRequestIsChartOnly(requestKey);
    const storedChart =
      (parsed.requestKey ? dashboardRequestIsChartOnly(parsed.requestKey) : false) ||
      dashboardPayloadIsChartOnly(parsed.data);
    if (requestedChart !== storedChart) return null;
    if (!parsed.data) return null;
    sessionStorage.removeItem(WORLD_CUP_DASHBOARD_PREFETCH_KEY);
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchWorldCupDashboardJson<T>(
  url: string,
  init?: RequestInit & { skipCache?: boolean }
): Promise<T> {
  const { skipCache, ...requestInit } = init ?? {};
  const requestKey = requestKeyFromDashboardUrl(url);
  const cacheKeyByRequest = clientCacheKeyForRequestKey(requestKey);
  const now = Date.now();
  if (!skipCache) {
    const cached =
      worldCupDashboardClientCache.get(url) ?? worldCupDashboardClientCache.get(cacheKeyByRequest);
    if (cached && now - cached.timestamp < WORLD_CUP_CLIENT_CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  let request =
    worldCupDashboardInFlightByKey.get(requestKey) ??
    (!skipCache ? worldCupDashboardInFlight.get(url) : undefined);
  if (!request) {
    request = fetch(url, { cache: 'no-store', ...requestInit })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
        if (!response.ok) {
          const message =
            (body && typeof body === 'object' && 'error' in body
              ? String((body as { error?: string }).error)
              : null) || `Request failed (${response.status})`;
          throw new Error(message);
        }
        return body as T;
      })
      .finally(() => {
        worldCupDashboardInFlightByKey.delete(requestKey);
        if (!skipCache) worldCupDashboardInFlight.delete(url);
      });
    worldCupDashboardInFlightByKey.set(requestKey, request);
    if (!skipCache) worldCupDashboardInFlight.set(url, request);
  }

  const data = (await request) as T;
  if (!skipCache) {
    seedWorldCupDashboardClientCache(url, data, requestKey);
  }
  return data;
}

/** Start a dashboard fetch early (props click) — shares in-flight dedupe with the dashboard page. */
export function prefetchWorldCupDashboard(url: string): void {
  void prefetchWorldCupDashboardReturning(url).catch(() => {
    // Navigation should continue even if prefetch misses.
  });
}

/** Props click / hover — returns the shared in-flight dashboard fetch. */
export function prefetchWorldCupDashboardReturning<T = unknown>(url: string): Promise<T> {
  const requestKey = requestKeyFromDashboardUrl(url);
  const memHit = readPrefetchedWorldCupDashboardMem<T>(requestKey);
  if (memHit) return Promise.resolve(memHit);

  return fetchWorldCupDashboardJson<T>(url)
    .then((data) => rememberPrefetchedWorldCupDashboard(requestKey, url, data))
    .catch((error) => {
      prefetchedDashboardMem.delete(requestKey);
      throw error;
    });
}

/** Props click — chart history only; dashboard page loads the full payload. */
export function prefetchWorldCupPlayerFromProp(input: {
  playerName: string;
  playerId?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  opponentTeamId?: string | null;
  opponentTeamName?: string | null;
  matchDate?: string | null;
}): { chartUrl: string; chartRequestKey: string } {
  const base = {
    playerName: input.playerName,
    playerId: input.playerId,
    teamId: input.teamId,
    teamName: input.teamName,
    opponentTeamId: input.opponentTeamId,
    opponentTeamName: input.opponentTeamName,
    competition: 'all' as const,
  };
  const chartParams = buildWorldCupPlayerDashboardParams({ ...base, playerChartOnly: true });
  const chartUrl = `/api/world-cup/dashboard?${chartParams.toString()}`;
  prefetchWorldCupDashboard(chartUrl);
  if (input.matchDate && input.teamName && input.opponentTeamName) {
    const oddsParams = new URLSearchParams({
      playerOdds: '1',
      playerName: input.playerName,
      homeTeam: input.teamName,
      awayTeam: input.opponentTeamName,
      matchDate: input.matchDate,
    });
    void fetchWorldCupDashboardJson(`/api/world-cup/dashboard?${oddsParams.toString()}`).catch(() => {});
  }
  return {
    chartUrl,
    chartRequestKey: worldCupDashboardRequestKey(chartParams),
  };
}

export type WorldCupPlayerOddsPrefetch = {
  playerName?: string;
  team?: string;
  opponent?: string;
  matchDate?: string;
  books?: unknown[];
  fetchedAt?: number;
};

function wcOddsPrefetchNameMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return true;
  if (left.toLowerCase() === right.toLowerCase()) return true;
  // Lazy import avoided — duplicate minimal normalize for player names.
  const normalizePlayer = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return normalizePlayer(left) === normalizePlayer(right);
}

function wcOddsPrefetchMatchDateKey(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  const isoPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoPrefix ? isoPrefix[1] : raw.toLowerCase();
}

export function readWorldCupPlayerOddsPrefetch(input: {
  playerName: string;
  team?: string | null;
  opponent?: string | null;
  matchDate?: string | null;
}): WorldCupPlayerOddsPrefetch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(WC_PLAYER_ODDS_PREFETCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorldCupPlayerOddsPrefetch;
    const ageMs = Date.now() - Number(parsed.fetchedAt ?? 0);
    if (ageMs > WC_PLAYER_ODDS_PREFETCH_TTL_MS) return null;
    if (!wcOddsPrefetchNameMatches(parsed.playerName, input.playerName)) return null;
    if (
      input.team &&
      parsed.team &&
      !wcOddsPrefetchTeamMatches(parsed.team, input.team)
    ) {
      return null;
    }
    if (
      input.opponent &&
      parsed.opponent &&
      !wcOddsPrefetchTeamMatches(parsed.opponent, input.opponent)
    ) {
      return null;
    }
    if (
      input.matchDate &&
      parsed.matchDate &&
      wcOddsPrefetchMatchDateKey(parsed.matchDate) !== wcOddsPrefetchMatchDateKey(input.matchDate)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function wcOddsPrefetchTeamMatches(a: string, b: string): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return true;
  if (left.toLowerCase() === right.toLowerCase()) return true;
  return worldCupTeamsMatch(left, right);
}

export function writeWorldCupPlayerOddsPrefetch(payload: WorldCupPlayerOddsPrefetch): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      WC_PLAYER_ODDS_PREFETCH_KEY,
      JSON.stringify({ ...payload, fetchedAt: Date.now() })
    );
  } catch {
    // ignore
  }
}

export async function loadWorldCupDashboardWithHandoff<T>(
  url: string,
  requestKey: string,
  init?: RequestInit & { skipCache?: boolean }
): Promise<T> {
  const prefetched = consumeWorldCupDashboardPrefetch<T>(requestKey);
  if (prefetched) {
    const requestedChart = dashboardRequestIsChartOnly(requestKey);
    const payloadChart = dashboardPayloadIsChartOnly(prefetched);
    if (requestedChart === payloadChart) {
      seedWorldCupDashboardClientCache(url, prefetched, requestKey);
      return prefetched;
    }
  }
  const inFlightByKey = worldCupDashboardInFlightByKey.get(requestKey);
  if (inFlightByKey) return inFlightByKey as Promise<T>;
  if (!init?.skipCache) {
    const inFlight = worldCupDashboardInFlight.get(url);
    if (inFlight) return inFlight as Promise<T>;
    const localCached = readWorldCupDashboardLocalCache<T>(requestKey);
    if (localCached) {
      seedWorldCupDashboardClientCache(url, localCached, requestKey);
      return localCached;
    }
  }
  return fetchWorldCupDashboardJson<T>(url, init);
}
