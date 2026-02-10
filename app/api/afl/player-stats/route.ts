/**
 * Player stats (by season) for AFL player props.
 * GET /api/afl/player-stats?season=2025
 * GET /api/afl/player-stats?season=2025&player_id=123
 *
 * Official API-Sports AFL v1 docs: https://api-sports.io/documentation/afl/v1
 * Base URL: https://v1.afl.api-sports.io
 * Auth: x-apisports-key header
 *
 * Endpoints used (verify in docs - param names may vary):
 * - GET /leagues?season=Y  → get league id(s) for season
 * - GET /teams?league=ID&season=Y  OR  /teams?season=Y  → list teams
 * - GET /players?team=ID&season=Y  → list players per team
 * - GET /players/statistics?id=ID&season=Y  → player stats
 */
import { NextRequest, NextResponse } from 'next/server';

const AFL_BASE = 'https://v1.afl.api-sports.io';
// Removed MAX_PLAYERS_STATS limit - now fetching stats for all players in batches

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSemaphore(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    async acquire() {
      if (active < maxConcurrent) {
        active += 1;
        return;
      }
      await new Promise<void>((resolve) => queue.push(resolve));
      active += 1;
    },
    release() {
      active = Math.max(0, active - 1);
      const next = queue.shift();
      if (next) next();
    },
  };
}

function createStartRateLimiter({ minDelayMs, maxConcurrent }: { minDelayMs: number; maxConcurrent: number }) {
  const sem = createSemaphore(Math.max(1, maxConcurrent));
  let nextAllowedAt = 0;

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    await sem.acquire();
    try {
      const now = Date.now();
      const waitMs = Math.max(0, nextAllowedAt - now);
      if (waitMs > 0) await sleep(waitMs);
      nextAllowedAt = Date.now() + Math.max(0, minDelayMs);
      return await fn();
    } finally {
      sem.release();
    }
  };
}

// Keep global within module instance (best-effort across requests)
const RATE_LIMITER = createStartRateLimiter({
  minDelayMs: parseInt(process.env.AFL_MIN_DELAY_MS ?? '350', 10) || 350,
  maxConcurrent: parseInt(process.env.AFL_MAX_CONCURRENT ?? '2', 10) || 2,
});

const SEASON_CACHE_TTL_MS = parseInt(process.env.AFL_SEASON_CACHE_TTL_MS ?? '120000', 10) || 120000;
const SEASON_CACHE = new Map<
  string,
  {
    expiresAt: number;
    payload: {
      season: string;
      players: Record<string, string | number>[];
    };
  }
>();

function toDisplay(v: unknown): string | number {
  if (v == null) return '-';
  if (typeof v === 'object' && v !== null) {
    const obj = v as Record<string, unknown>;
    if ('for' in obj && 'against' in obj) {
      const left = obj.for != null && typeof obj.for !== 'object' ? obj.for : '-';
      const right = obj.against != null && typeof obj.against !== 'object' ? obj.against : '-';
      return `${left} / ${right}`;
    }
    if ('long' in obj && 'short' in obj) {
      const s = obj.short ?? obj.long;
      return s != null && typeof s !== 'object' ? String(s) : '-';
    }
    return '-';
  }
  return v as string | number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function flattenInto(out: Record<string, string | number>, value: unknown, prefix = ''): void {
  if (value == null) return;

  if (typeof value === 'string' || typeof value === 'number') {
    if (prefix) out[prefix] = value;
    return;
  }

  if (Array.isArray(value)) {
    // Arrays are common in API-Sports responses (e.g., statistics: [ ... ]).
    // We flatten each element under an indexed prefix to avoid dropping data.
    value.forEach((item, idx) => {
      const p = prefix ? `${prefix}_${idx}` : String(idx);
      flattenInto(out, item, p);
    });
    return;
  }

  if (!isPlainObject(value)) return;

  // Special-case common "for/against" and "long/short" objects so we don't lose granularity.
  if ('for' in value && 'against' in value && Object.keys(value).length <= 4) {
    const p = prefix || 'value';
    const left = (value as Record<string, unknown>).for;
    const right = (value as Record<string, unknown>).against;
    if (typeof left === 'number' || typeof left === 'string') out[`${p}_for`] = left as string | number;
    if (typeof right === 'number' || typeof right === 'string') out[`${p}_against`] = right as string | number;
    return;
  }
  if ('long' in value && 'short' in value && Object.keys(value).length <= 4) {
    const p = prefix || 'value';
    const longV = (value as Record<string, unknown>).long;
    const shortV = (value as Record<string, unknown>).short;
    if (typeof shortV === 'number' || typeof shortV === 'string') out[`${p}_short`] = shortV as string | number;
    if (typeof longV === 'number' || typeof longV === 'string') out[`${p}_long`] = longV as string | number;
    return;
  }

  for (const [k, v] of Object.entries(value)) {
    if (v == null) continue;
    const p = prefix ? `${prefix}_${k}` : k;
    flattenInto(out, v, p);
  }
}

function flattenStats(obj: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  flattenInto(out, obj, '');
  return out;
}

/** Keys we treat as "games played" for per-game averages */
const GAMES_KEYS = ['games', 'played', 'Games', 'Played'];

function getGames(stats: Record<string, string | number>): number {
  for (const key of GAMES_KEYS) {
    const v = stats[key];
    if (typeof v === 'number' && v >= 0) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  }
  return 0;
}

/** Add per-game average for every numeric stat; ensure no object values. */
function addPerGameAndSanitize(stats: Record<string, string | number>): Record<string, string | number> {
  const games = getGames(stats);
  const out: Record<string, string | number> = {};
  // Only skip metadata keys, not stat keys - we want ALL stats
  const skipKeysLower = new Set([
    'id',
    'name',
    'team',
    'position',
    'photo',
    'image',
    'nationality',
    'birth',
    'age',
    'height',
    'weight',
    'firstname',
    'lastname',
    'firstname',
    'lastname',
    'firstName'.toLowerCase(),
    'lastName'.toLowerCase(),
  ]);
  for (const [k, v] of Object.entries(stats)) {
    // Always include games/played keys
    if (GAMES_KEYS.includes(k)) {
      out[k] = v;
      continue;
    }
    // Skip metadata but include all stat fields
    if (skipKeysLower.has(k.toLowerCase())) {
      continue;
    }
    if (typeof v === 'object' || v === null || v === undefined) {
      out[k] = '-';
      continue;
    }
    out[k] = v;
    // Don't add _avg suffix if it already has one or is already an average
    if (k.endsWith('_avg') || k.endsWith('_average')) continue;
    const kLower = k.toLowerCase();
    if (kLower === 'average' || kLower === 'avg' || kLower.includes('per game') || kLower.includes('per_game')) continue;
    // Add per-game average for numeric stats
    if (typeof v === 'number' && !Number.isNaN(v) && games > 0 && v > 0) {
      out[`${k}_avg`] = Math.round((v / games) * 10) / 10;
    } else if (typeof v === 'string') {
      const n = parseFloat(v);
      if (!Number.isNaN(n) && games > 0 && n > 0) {
        out[`${k}_avg`] = Math.round((n / games) * 10) / 10;
      }
    }
  }
  return out;
}

function getResponseArray(data: Record<string, unknown>): unknown[] {
  // API-Sports typically returns { response: [...] } or { data: [...] }
  // But check all possible keys
  const raw = data?.response ?? data?.data ?? data?.results ?? data?.players;
  if (Array.isArray(raw)) return raw;
  if (raw != null && typeof raw === 'object') return [raw];
  // If data itself is an array, return it
  if (Array.isArray(data)) return data;
  return [];
}

function pickBestStatsFromArray(arr: unknown[]): unknown {
  let best: unknown = arr[0];
  let bestScore = -1;
  for (const item of arr) {
    const flat = flattenStats(item);
    const score = Object.keys(flat).length;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

function extractStatsPayloadFromApiResponse(data: Record<string, unknown>): unknown {
  const res = getResponseArray(data);
  const first = (res[0] ?? data) as Record<string, unknown>;
  const stats = (first?.statistics ?? first?.stats ?? first) as unknown;
  if (Array.isArray(stats)) return pickBestStatsFromArray(stats);
  return stats;
}

function extractLeagueIds(leaguesData: Record<string, unknown>): number[] {
  const raw = getResponseArray(leaguesData);
  const ids: number[] = [];
  for (const t of raw) {
    const o = t as Record<string, unknown>;
    const id = o?.id ?? o?.league_id;
    if (typeof id === 'number' && !ids.includes(id)) ids.push(id);
    else if (typeof id === 'string') {
      const n = parseInt(id, 10);
      if (!Number.isNaN(n) && !ids.includes(n)) ids.push(n);
    }
  }
  return ids;
}

function extractTeamIds(teamsData: Record<string, unknown>): number[] {
  const raw = getResponseArray(teamsData);
  const ids: number[] = [];
  for (const t of raw) {
    const o = t as Record<string, unknown>;
    const id = o?.id ?? (o?.team as Record<string, unknown>)?.id ?? o?.team_id;
    if (typeof id === 'number' && !ids.includes(id)) ids.push(id);
    else if (typeof id === 'string') {
      const n = parseInt(id, 10);
      if (!Number.isNaN(n) && !ids.includes(n)) ids.push(n);
    }
  }
  return ids;
}

function extractPlayerList(playersData: Record<string, unknown>): Record<string, unknown>[] {
  const raw = getResponseArray(playersData);
  return raw.filter((p) => p != null && typeof p === 'object') as Record<string, unknown>[];
}

function normalizePlayer(
  raw: Record<string, unknown>,
  statsFlat: Record<string, string | number>
): Record<string, string | number> {
  const player = (raw?.player ?? raw) as Record<string, unknown>;
  const firstName = player?.firstName ?? player?.firstname;
  const lastName = player?.lastName ?? player?.lastname;
  const name =
    typeof player?.name === 'string'
      ? player.name
      : typeof player?.name === 'number'
        ? String(player.name)
        : (firstName != null && lastName != null)
          ? `${firstName} ${lastName}`.trim()
          : typeof firstName === 'string' || typeof lastName === 'string'
            ? [firstName, lastName].filter(Boolean).join(' ').trim()
            : '-';
  const id = toDisplay(player?.id ?? raw?.id);
  const teamObj = raw?.team ?? player?.team;
  const teamName =
    typeof teamObj === 'object' && teamObj && teamObj !== null && 'name' in teamObj
      ? String((teamObj as Record<string, unknown>).name ?? '-')
      : toDisplay(teamObj);
  const base: Record<string, string | number> = {
    id: String(id),
    name,
    team: String(teamName),
    position: toDisplay(player?.position ?? raw?.position ?? '-'),
  };
  // Include ALL stats from statsFlat - don't limit to preferred
  // This ensures we capture all available AFL stats from the API
  for (const [k, v] of Object.entries(statsFlat)) {
    // Skip only metadata fields, include all stat fields
    if (k !== 'id' && k !== 'name' && k !== 'team' && k !== 'position') {
      base[k] = v;
    }
  }
  return base;
}

type AflFetchResult = { ok: true; data: Record<string, unknown> } | { ok: false; data?: Record<string, unknown>; message: string };

async function aflFetch(
  apiKey: string,
  path: string,
  params: Record<string, string>
): Promise<AflFetchResult> {
  const q = new URLSearchParams(params).toString();
  const url = `${AFL_BASE}/${path}${q ? `?${q}` : ''}`;
  try {
    const res = await RATE_LIMITER(() =>
      fetch(url, {
        headers: { 'x-apisports-key': apiKey },
        // Reduced cache time to 30 seconds to get fresher data and avoid stale results
        next: { revalidate: 30 },
      })
    );
    const data = (await res.json()) as Record<string, unknown>;
    const errors = data?.errors;
    const hasApiError = errors && typeof errors === 'object' && Object.keys(errors as object).length > 0;
    const errMsg = hasApiError ? JSON.stringify(errors) : (data?.message as string) || res.statusText;
    if (!res.ok) {
      return { ok: false, data, message: errMsg || `HTTP ${res.status}` };
    }
    if (hasApiError) {
      return { ok: false, data, message: errMsg };
    }
    return { ok: true, data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}

async function aflFetchWithRetry(
  apiKey: string,
  path: string,
  params: Record<string, string>,
  opts?: { retries?: number }
): Promise<AflFetchResult> {
  const retries = opts?.retries ?? 4;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await aflFetch(apiKey, path, params);
    if (res.ok) return res;
    const msg = res.message || '';
    const isRateLimit =
      msg.includes('Too many requests') ||
      msg.includes('rateLimit') ||
      (res.data?.errors &&
        typeof res.data.errors === 'object' &&
        'rateLimit' in (res.data.errors as Record<string, unknown>));
    if (!isRateLimit || attempt === retries) return res;

    const backoffMs = Math.min(10_000, 750 * 2 ** attempt);
    await sleep(backoffMs + Math.floor(Math.random() * 250));
  }
  return { ok: false, message: 'Retry loop exhausted' };
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.AFL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AFL_API_KEY not configured' },
      { status: 500 }
    );
  }

  const seasonParam = request.nextUrl.searchParams.get('season');
  // Default to 2025 (most recent completed AFL season with full data)
  // AFL season runs March-September, so 2025 data is most reliable
  let season = seasonParam
    ? String(seasonParam)
    : '2025';
  const playerIdParam = request.nextUrl.searchParams.get('player_id');
  const includeBulkStats = request.nextUrl.searchParams.get('include_stats') === '1';
  const cacheKey = `season:${season}:include:${includeBulkStats ? '1' : '0'}`;

  if (!playerIdParam && !includeBulkStats) {
    const cached = SEASON_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload);
    }
    if (cached && cached.expiresAt <= Date.now()) {
      SEASON_CACHE.delete(cacheKey);
    }
  }

  const FALLBACK_SEASON = '2025';
  const seasonNum = parseInt(season, 10);
  // Use fallback if season is 2026+ or if explicitly requested season has no data
  const useFallbackWhenEmpty = !Number.isNaN(seasonNum) && seasonNum >= 2026;

  try {
    // Single player stats: fetch only this player's statistics (for selected players outside the initial 80)
    if (playerIdParam && playerIdParam.trim()) {
      const idStr = playerIdParam.trim();
      let statsFlat: Record<string, string | number> = {};
      let seasonUsed = season;
      // When 2026+ requested, try 2025 first (season not started so 2025 has data)
      const seasonsToTrySingle = useFallbackWhenEmpty ? [FALLBACK_SEASON, season] : [season];

      const tryParseStatsFromResponse = (data: Record<string, unknown>): boolean => {
        const payload = extractStatsPayloadFromApiResponse(data);
        const flat = addPerGameAndSanitize(flattenStats(payload));
        if (Object.keys(flat).length > 0) {
          Object.assign(statsFlat, flat);
          return true;
        }
        // last-ditch: flatten the entire response object
        const fallback = addPerGameAndSanitize(flattenStats(data));
        if (Object.keys(fallback).length > 0) {
          Object.assign(statsFlat, fallback);
          return true;
        }
        return false;
      };

      let lastRawResponse: unknown = null;
      let lastTriedUrl = '';

      for (const trySeason of seasonsToTrySingle) {
        // 1) Try GET /players/statistics with different parameter names
        // API-Sports AFL might use 'player', 'player_id', or 'id'
        for (const idParam of ['player', 'id'] as const) {
          const statsResult = await aflFetchWithRetry(apiKey, 'players/statistics', {
            [idParam]: idStr,
            season: trySeason,
          });
          lastTriedUrl = `${AFL_BASE}/players/statistics?${idParam}=${idStr}&season=${trySeason}`;
          if (statsResult.ok && statsResult.data) {
            lastRawResponse = statsResult.data;
            if (tryParseStatsFromResponse(statsResult.data as Record<string, unknown>)) {
              console.log(`[AFL] Successfully fetched stats for player ${idStr} using parameter '${idParam}'`);
              seasonUsed = trySeason;
              break;
            }
          } else if (statsResult.data) lastRawResponse = statsResult.data;
        }
        if (Object.keys(statsFlat).length > 0) break;

        // 2) Fallback: GET /players with different parameter names
        for (const idParam of ['player', 'id'] as const) {
          const playerResult = await aflFetchWithRetry(apiKey, 'players', {
            [idParam]: idStr,
            season: trySeason,
          });
          lastTriedUrl = `${AFL_BASE}/players?${idParam}=${idStr}&season=${trySeason}`;
          if (playerResult.ok && playerResult.data) {
            lastRawResponse = playerResult.data;
            if (tryParseStatsFromResponse(playerResult.data as Record<string, unknown>)) {
              console.log(`[AFL] Successfully fetched player ${idStr} using parameter '${idParam}'`);
              seasonUsed = trySeason;
              break;
            }
          } else if (playerResult.data) lastRawResponse = playerResult.data;
        }
        if (Object.keys(statsFlat).length > 0) break;

        // 3) Try REST-style GET /players/{id}?season=Y
        const playerPathResult = await aflFetchWithRetry(apiKey, `players/${idStr}`, { season: trySeason });
        lastTriedUrl = `${AFL_BASE}/players/${idStr}?season=${trySeason}`;
        if (playerPathResult.ok && playerPathResult.data) {
          lastRawResponse = playerPathResult.data;
          if (tryParseStatsFromResponse(playerPathResult.data as Record<string, unknown>)) {
            console.log(`[AFL] Successfully fetched player ${idStr} using REST path`);
            seasonUsed = trySeason;
            break;
          }
        } else if (playerPathResult.data) lastRawResponse = playerPathResult.data;
        if (Object.keys(statsFlat).length > 0) break;
      }

      const statAliases: Record<string, string> = {
        played: 'played', Played: 'played', PLAYED: 'played',
        total: 'total', Total: 'total', TOTAL: 'total',
        total_avg: 'total_avg', average: 'average', Average: 'average',
        G: 'goals', Goals: 'goals', GOALS: 'goals',
        B: 'behinds', Behinds: 'behinds', BEHINDS: 'behinds',
        D: 'disposals', Disposals: 'disposals', DISPOSALS: 'disposals',
        K: 'kicks', Kicks: 'kicks', KICKS: 'kicks',
        H: 'handballs', HB: 'handballs', Handballs: 'handballs', HANDBALLS: 'handballs',
        M: 'marks', Marks: 'marks', MARKS: 'marks',
        T: 'tackles', TACK: 'tackles', Tackles: 'tackles', TACKLES: 'tackles',
        HO: 'hitOuts', HitOuts: 'hitOuts', 'Hit Outs': 'hitOuts', HITOUTS: 'hitOuts',
        CL: 'clearances', Clearances: 'clearances', CLEARANCES: 'clearances',
        GM: 'games', Games: 'games', GAMES: 'games',
      };
      const player: Record<string, string | number> = { id: idStr, name: '-', team: '-', position: '-' };
      const preferred = ['played', 'games', 'total', 'total_avg', 'average', 'goals', 'behinds', 'disposals', 'kicks', 'handballs', 'marks', 'tackles', 'hitOuts', 'clearances'];
      for (const [k, v] of Object.entries(statsFlat)) {
        const canonical = statAliases[k] ?? k;
        if (preferred.includes(canonical)) player[canonical] = v;
        else if (!(k in player)) player[k] = v;
      }
      const hasStats = Object.keys(statsFlat).length > 0;
      const body: Record<string, unknown> = {
        season: seasonUsed,
        players: [player],
      };
      if (!hasStats) {
        body._hint = 'No statistics returned. Verify endpoint at https://api-sports.io/documentation/afl/v1';
        body._debug = {
          player_id: idStr,
          last_tried_url: lastTriedUrl,
          api_response_sample: lastRawResponse != null
            ? JSON.stringify(lastRawResponse).slice(0, 1200)
            : 'no response',
        };
      }
      return NextResponse.json(body);
    }

    // When 2026+ requested, try 2025 first (season not started); else use requested season only
    const seasonsToTry = useFallbackWhenEmpty ? [FALLBACK_SEASON, season] : [season];
    let lastHint = '';
    let lastApiError = '';

    for (const trySeason of seasonsToTry) {
      // 1) Optional: get league id(s) for this season (API-Sports: GET /leagues?season=Y)
      let leagueIds = [1]; // default
      const leaguesResult = await aflFetchWithRetry(apiKey, 'leagues', { season: trySeason });
      if (leaguesResult.ok && leaguesResult.data) {
        const ids = extractLeagueIds(leaguesResult.data as Record<string, unknown>);
        if (ids.length > 0) leagueIds = ids;
      }
      if (!leaguesResult.ok && leaguesResult.message) {
        lastApiError = leaguesResult.message;
      }

      // 2) Get team ids: try teams?league=X&season=Y for each league, then teams?season=Y
      // API-Sports might use 'league_id' instead of 'league'
      let teamIds: number[] = [];
      for (const leagueId of leagueIds) {
        // Try 'league_id' first (common API-Sports pattern)
        let teamsResult = await aflFetchWithRetry(apiKey, 'teams', {
          league_id: String(leagueId),
          season: trySeason,
        });
        
        // Fallback to 'league' if league_id doesn't work
        if (!teamsResult.ok || !teamsResult.data || extractTeamIds(teamsResult.data as Record<string, unknown>).length === 0) {
          teamsResult = await aflFetchWithRetry(apiKey, 'teams', {
            league: String(leagueId),
            season: trySeason,
          });
        }
        
        if (teamsResult.ok && teamsResult.data) {
          teamIds = extractTeamIds(teamsResult.data as Record<string, unknown>);
          if (teamIds.length > 0) {
            console.log(`[AFL] Found ${teamIds.length} teams for league ${leagueId}`);
            break;
          }
        }
        if (!teamsResult.ok && teamsResult.message) lastApiError = teamsResult.message;
      }
      if (teamIds.length === 0) {
        const teamsOnlyResult = await aflFetchWithRetry(apiKey, 'teams', { season: trySeason });
        if (teamsOnlyResult.ok && teamsOnlyResult.data) {
          teamIds = extractTeamIds(teamsOnlyResult.data as Record<string, unknown>);
          console.log(`[AFL] Found ${teamIds.length} teams (no league filter)`);
        }
        if (!teamsOnlyResult.ok && teamsOnlyResult.message) lastApiError = teamsOnlyResult.message;
      }

      if (teamIds.length === 0) {
        lastHint = lastApiError ? `Teams: ${lastApiError}` : 'No teams found for this season.';
        continue;
      }

      // 3) Get players for each team
      // API-Sports AFL might use 'team_id' or 'team' parameter - try both
      const playerMap = new Map<string, Record<string, unknown>>();
      for (const teamId of teamIds) {
        // Try 'team_id' first (common API-Sports pattern)
        let playersResult = await aflFetchWithRetry(apiKey, 'players', {
          team_id: String(teamId),
          season: trySeason,
        });
        
        // Fallback to 'team' if team_id doesn't work
        if (!playersResult.ok || !playersResult.data || getResponseArray(playersResult.data as Record<string, unknown>).length === 0) {
          playersResult = await aflFetchWithRetry(apiKey, 'players', {
            team: String(teamId),
            season: trySeason,
          });
        }
        
        if (playersResult.ok && playersResult.data) {
          const list = extractPlayerList(playersResult.data as Record<string, unknown>);
          console.log(`[AFL] Found ${list.length} players for team ${teamId}`);
          for (const p of list) {
            const id = p?.id ?? (p?.player as Record<string, unknown>)?.id;
            const key = id != null ? String(id) : JSON.stringify(p);
            if (!playerMap.has(key)) playerMap.set(key, p);
          }
        } else if (!playersResult.ok) {
          console.warn(`[AFL] Failed to fetch players for team ${teamId}:`, playersResult.message);
        }
      }

      const players = Array.from(playerMap.values());
      if (players.length === 0) {
        lastHint = lastApiError ? `Players: ${lastApiError}` : 'No players returned for teams in this season.';
        continue;
      }

      // 4) IMPORTANT:
      // Bulk-loading stats for every player (hundreds) via per-player requests will hit API-Sports rate limits.
      // Default behavior: return the player list (and any stats already embedded in the /players response),
      // and let the UI fetch full stats on-demand for the selected player.
      const normalized: Record<string, string | number>[] = [];

      if (!includeBulkStats) {
        for (const p of players) {
          // If /players already includes statistics, keep them; otherwise return metadata only (no stat spam).
          const po = (p?.player ?? p) as Record<string, unknown>;
          const statsMaybe = (po?.statistics ?? (p as Record<string, unknown>)?.statistics ?? (p as Record<string, unknown>)?.stats) as unknown;
          if (statsMaybe == null) {
            normalized.push(normalizePlayer(p, {}));
            continue;
          }
          const payload = Array.isArray(statsMaybe) ? pickBestStatsFromArray(statsMaybe) : statsMaybe;
          const statsFlat = addPerGameAndSanitize(flattenStats(payload));
          normalized.push(normalizePlayer(p, statsFlat));
        }
      } else {
        const maxPlayers = parseInt(process.env.AFL_BULK_STATS_MAX_PLAYERS ?? '200', 10) || 200;
        const limitedPlayers = players.slice(0, Math.max(0, maxPlayers));
        console.log(`[AFL] include_stats=1: fetching per-player stats for ${limitedPlayers.length}/${players.length} players (rate-limited)`);

        for (const p of limitedPlayers) {
          const playerObj = (p?.player ?? p) as Record<string, unknown>;
          const id = playerObj?.id ?? p?.id;
          if (id == null) {
            normalized.push(normalizePlayer(p, {}));
            continue;
          }
          const idStr = String(id);
          let statsFlat: Record<string, string | number> = {};

          // Prefer /players/statistics, but only with known param names (avoid 'player_id' noise).
          let statsResult = await aflFetchWithRetry(apiKey, 'players/statistics', { player: idStr, season: trySeason });
          if (!statsResult.ok || !statsResult.data || getResponseArray(statsResult.data as Record<string, unknown>).length === 0) {
            statsResult = await aflFetchWithRetry(apiKey, 'players/statistics', { id: idStr, season: trySeason });
          }
          if (statsResult.ok) {
            const payload = extractStatsPayloadFromApiResponse(statsResult.data as Record<string, unknown>);
            statsFlat = addPerGameAndSanitize(flattenStats(payload));
          } else {
            console.warn(`[AFL] Failed to fetch stats for player ${idStr}:`, statsResult.message);
          }
          normalized.push(normalizePlayer(p, statsFlat));
        }
      }

      console.log(`[AFL] Returning ${normalized.length} players${includeBulkStats ? ' (bulk stats enabled)' : ''}`);

      if (!includeBulkStats) {
        SEASON_CACHE.set(cacheKey, {
          expiresAt: Date.now() + SEASON_CACHE_TTL_MS,
          payload: {
            season: trySeason,
            players: normalized,
          },
        });
      }

      return NextResponse.json({
        season: trySeason,
        players: normalized,
      });
    }

    return NextResponse.json({
      season,
      players: [],
      _hint: lastHint || 'No data for this season. Try 2025.',
      _apiError: lastApiError || undefined,
    });
  } catch (err) {
    console.error('[AFL player-stats]', err);
    return NextResponse.json(
      {
        error: 'Failed to fetch player stats',
        details: err instanceof Error ? err.message : undefined,
      },
      { status: 502 }
    );
  }
}
