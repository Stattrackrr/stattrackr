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

const worldCupDashboardClientCache = new Map<string, WorldCupClientCacheEntry<unknown>>();
const worldCupDashboardInFlight = new Map<string, Promise<unknown>>();

export function worldCupDashboardRequestKey(params: URLSearchParams | string): string {
  const source = typeof params === 'string' ? new URLSearchParams(params) : params;
  const normalized = new URLSearchParams();
  for (const [key, value] of [...source.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    normalized.append(key, value);
  }
  return normalized.toString();
}

function dashboardPrefetchIdentityMatches(storedKey: string, requestedKey: string): boolean {
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
  return params;
}

function seedWorldCupDashboardClientCache<T>(url: string, data: T): void {
  worldCupDashboardClientCache.set(url, { data, timestamp: Date.now() });
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
      (!parsed.requestKey || !dashboardPrefetchIdentityMatches(parsed.requestKey, requestKey))
    ) {
      return null;
    }
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
  const now = Date.now();
  if (!skipCache) {
    const cached = worldCupDashboardClientCache.get(url);
    if (cached && now - cached.timestamp < WORLD_CUP_CLIENT_CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  let request = skipCache ? undefined : worldCupDashboardInFlight.get(url);
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
        if (!skipCache) worldCupDashboardInFlight.delete(url);
      });
    if (!skipCache) worldCupDashboardInFlight.set(url, request);
  }

  const data = (await request) as T;
  if (!skipCache) {
    seedWorldCupDashboardClientCache(url, data);
  }
  return data;
}

/** Start a dashboard fetch early (props click) — shares in-flight dedupe with the dashboard page. */
export function prefetchWorldCupDashboard(url: string): void {
  void fetchWorldCupDashboardJson(url)
    .then((data) => {
      const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
      storeWorldCupDashboardPrefetch(worldCupDashboardRequestKey(query), data);
    })
    .catch(() => {
      // Navigation should continue even if prefetch misses.
    });
}

export async function loadWorldCupDashboardWithHandoff<T>(
  url: string,
  requestKey: string,
  init?: RequestInit & { skipCache?: boolean }
): Promise<T> {
  const prefetched = consumeWorldCupDashboardPrefetch<T>(requestKey);
  if (prefetched) {
    seedWorldCupDashboardClientCache(url, prefetched);
    return prefetched;
  }
  if (!init?.skipCache) {
    const inFlight = worldCupDashboardInFlight.get(url);
    if (inFlight) return inFlight as Promise<T>;
  }
  return fetchWorldCupDashboardJson<T>(url, init);
}
