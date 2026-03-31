import { NextResponse } from 'next/server';
import { listAflPlayerPropsFromCache, listAflPlayerPropsFromCacheWithGames, refreshAflPlayerPropsCache, type AflListPropRow } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats, getAflPropStatsCacheKey, type AflPropStatsDebug } from '@/lib/aflPropStatsCache';
import { filterAflPropsEligibleGames, getAflOddsCache, refreshAflOddsData, setAflOddsCache, type AflGameOdds } from '@/lib/refreshAflOdds';
import sharedCache, { getSharedCacheBackend } from '@/lib/sharedCache';
import { getAflPlayerTeamMapFromFiles } from '@/lib/aflPlayerTeamResolver';
import { getAflPlayerPositionMap, getAflPlayerTeamMapFromFantasy } from '@/lib/aflFantasyPositions';
import { loadDvpMapsFromFiles, getDvpLookupTeamTotal, DVP_MATCHUP_SEASON, type DvpMaps } from '@/lib/aflDvpLookup';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';
import { toOfficialAflTeamDisplayName, opponentToFootywireTeam } from '@/lib/aflTeamMapping';
import { getNBACache, setNBACache } from '@/lib/nbaCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** List is always dynamic/no-store; user path is strict cache-read for low latency. */
const AFL_LIST_CACHE_CONTROL = 'private, no-store';
// User-facing list endpoint must never block on live game-log fetches.
// Miss healing is handled by cron/debug-auth paths, not by interactive page loads.
const MISS_COMPUTE_SYNC_LIMIT_NO_CRON = 0;
const MISS_COMPUTE_BG_LIMIT_NO_CRON = 0;
const MISS_COMPUTE_CONCURRENCY = 3;
const AFL_ENRICH_CONTEXT_TTL_MS = 5 * 60 * 1000;
const AFL_LIST_ENRICHED_RESPONSE_CACHE_KEY = 'afl_list_enriched_response_v1';
const AFL_LIST_ENRICHED_SUPABASE_CACHE_KEY = 'afl_props_list_enriched_v1';
// Keep the pre-enriched list warm across cron intervals so user page loads stay instant.
// AFL odds refresh runs about every 3 hours, so this gives overlap instead of dropping cold.
const AFL_LIST_ENRICHED_RESPONSE_CACHE_TTL_SECONDS = 4 * 60 * 60;
const AFL_LIST_ENRICHED_RESPONSE_CACHE_TTL_MINUTES = Math.max(
  1,
  Math.ceil(AFL_LIST_ENRICHED_RESPONSE_CACHE_TTL_SECONDS / 60)
);

/** Shown on the props page when there are no player lines (including games on the board but no markets yet). */
const AFL_USER_NO_ODDS = 'No odds available. Come back later.';

type AflEnrichContext = {
  playerTeamMap: Map<string, string>;
  fantasyTeamMap: Map<string, string>;
  positionMap: Map<string, string>;
  dvpMaps: DvpMaps;
};

let aflEnrichContextCache: { expiresAt: number; value: AflEnrichContext } | null = null;
let aflEnrichContextInFlight: Promise<AflEnrichContext> | null = null;
let aflEnrichedPayloadMemoryCache: { expiresAt: number; payload: Record<string, unknown> } | null = null;
const FANTASY_POSITIONS_API_CACHE_TTL_MS = 5 * 60 * 1000;
let fantasyPositionsApiCache:
  | {
      expiresAt: number;
      byName: Map<string, string>;
      byInitialSurnameTeam: Map<string, string>;
    }
  | null = null;
let fantasyPositionsApiInFlight:
  | Promise<{ byName: Map<string, string>; byInitialSurnameTeam: Map<string, string> }>
  | null = null;

function normalizeTeamKeyForPosition(team: string | null | undefined): string {
  if (!team) return '';
  return toOfficialAflTeamDisplayName(team).trim().toLowerCase();
}

async function loadAflEnrichContext(): Promise<AflEnrichContext> {
  const seasonForTeam = new Date().getFullYear();
  const seasonForPos = new Date().getFullYear();
  const [
    playerTeamMap,
    fantasyTeamMap,
    dvpMaps,
    positionMapCurrent,
    positionMapPrev,
  ] = await Promise.all([
    getAflPlayerTeamMapFromFiles(),
    getAflPlayerTeamMapFromFantasy(seasonForTeam),
    loadDvpMapsFromFiles(DVP_MATCHUP_SEASON),
    getAflPlayerPositionMap(seasonForPos),
    getAflPlayerPositionMap(seasonForPos - 1),
  ]);
  return {
    playerTeamMap,
    fantasyTeamMap,
    positionMap: positionMapCurrent.size > 0 ? positionMapCurrent : positionMapPrev,
    dvpMaps,
  };
}

async function getAflEnrichContext(): Promise<AflEnrichContext> {
  const now = Date.now();
  if (aflEnrichContextCache && aflEnrichContextCache.expiresAt > now) {
    return aflEnrichContextCache.value;
  }
  if (!aflEnrichContextInFlight) {
    aflEnrichContextInFlight = loadAflEnrichContext()
      .then((value) => {
        aflEnrichContextCache = { value, expiresAt: Date.now() + AFL_ENRICH_CONTEXT_TTL_MS };
        return value;
      })
      .finally(() => {
        aflEnrichContextInFlight = null;
      });
  }
  return aflEnrichContextInFlight;
}

async function getFantasyPositionsFromApi(
  baseUrl: string,
  season: number,
  cronSecret?: string
): Promise<{ byName: Map<string, string>; byInitialSurnameTeam: Map<string, string> }> {
  const now = Date.now();
  if (fantasyPositionsApiCache && fantasyPositionsApiCache.expiresAt > now) {
    return {
      byName: fantasyPositionsApiCache.byName,
      byInitialSurnameTeam: fantasyPositionsApiCache.byInitialSurnameTeam,
    };
  }
  if (!fantasyPositionsApiInFlight) {
    fantasyPositionsApiInFlight = (async () => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (cronSecret) {
        headers.Authorization = `Bearer ${cronSecret}`;
        headers['X-Cron-Secret'] = cronSecret;
      }
      const res = await fetch(`${baseUrl}/api/afl/fantasy-positions?season=${season}`, {
        headers,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`fantasy-positions HTTP ${res.status}`);
      const json = (await res.json().catch(() => null)) as
        | { players?: Array<{ name?: string; team?: string; position?: string }> }
        | null;
      const players = Array.isArray(json?.players) ? json.players : [];
      const byName = new Map<string, string>();
      const byInitialSurnameTeam = new Map<string, string>();
      for (const p of players) {
        const nameKey = normalizeAflPlayerNameForMatch(String(p?.name ?? ''));
        const pos = String(p?.position ?? '').trim().toUpperCase();
        const teamNorm = normalizeTeamKeyForPosition(String(p?.team ?? ''));
        if (!nameKey || !pos) continue;
        if (!byName.has(nameKey)) byName.set(nameKey, pos);
        const parts = nameKey.split(' ').filter(Boolean);
        if (parts.length >= 2 && teamNorm) {
          const idx = `${parts[0].charAt(0)}|${parts[parts.length - 1]}|${teamNorm}`;
          if (!byInitialSurnameTeam.has(idx)) byInitialSurnameTeam.set(idx, pos);
        }
      }
      fantasyPositionsApiCache = {
        expiresAt: Date.now() + FANTASY_POSITIONS_API_CACHE_TTL_MS,
        byName,
        byInitialSurnameTeam,
      };
      return { byName, byInitialSurnameTeam };
    })().finally(() => {
      fantasyPositionsApiInFlight = null;
    });
  }
  return fantasyPositionsApiInFlight;
}

function hasOver(o: string) {
  return o != null && String(o).trim() !== '' && String(o) !== 'N/A';
}
function hasUnder(u: string) {
  return u != null && String(u).trim() !== '' && String(u) !== 'N/A';
}

/**
 * GET /api/afl/player-props/list
 * Reads from AFL props cache and attaches stats from stats cache. On cache miss, computes stats
 * so we never show 0 stats (L5/L10/Season/DvP etc). Stats cache is filled by the single AFL cron
 * (odds/refresh then props-stats warm). ?enrich=false returns raw rows without stats (for warm to use).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const enrich = searchParams.get('enrich') !== 'false';
    const debugStats = searchParams.get('debugStats') === '1';

    // When list is called with valid cron auth, we compute on cache miss (and pass secret to player-game-logs) so N/A report can populate stats.
    const normalizeSecret = (s: string) => (s ?? '').replace(/\r\n|\r|\n/g, '').trim();
    const envSecret = normalizeSecret(process.env.CRON_SECRET ?? '');
    const authHeader = request.headers.get('authorization');
    const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader ?? '';
    const xCron = request.headers.get('x-cron-secret') ?? '';
    const providedSecret = normalizeSecret(bearerSecret || xCron);
    const hasCronAuth = !!envSecret && envSecret === providedSecret;
    const listCronSecret = hasCronAuth ? envSecret : undefined;
    const cacheOnly = !hasCronAuth;

    if (!hasCronAuth && enrich && !debugStats) {
      const now = Date.now();
      if (aflEnrichedPayloadMemoryCache && aflEnrichedPayloadMemoryCache.expiresAt > now) {
        return NextResponse.json(aflEnrichedPayloadMemoryCache.payload, {
          headers: {
            'Cache-Control': AFL_LIST_CACHE_CONTROL,
          },
        });
      }
      const supabasePayload = await getNBACache<Record<string, unknown>>(AFL_LIST_ENRICHED_SUPABASE_CACHE_KEY, {
        restTimeoutMs: 4000,
        jsTimeoutMs: 4000,
        quiet: true,
      });
      if (supabasePayload && typeof supabasePayload === 'object') {
        aflEnrichedPayloadMemoryCache = {
          payload: supabasePayload,
          expiresAt: now + AFL_LIST_ENRICHED_RESPONSE_CACHE_TTL_SECONDS * 1000,
        };
        return NextResponse.json(supabasePayload, {
          headers: {
            'Cache-Control': AFL_LIST_CACHE_CONTROL,
          },
        });
      }
      const cachedPayload = await sharedCache.getJSON<Record<string, unknown>>(AFL_LIST_ENRICHED_RESPONSE_CACHE_KEY);
      if (cachedPayload && typeof cachedPayload === 'object') {
        aflEnrichedPayloadMemoryCache = {
          payload: cachedPayload,
          expiresAt: now + AFL_LIST_ENRICHED_RESPONSE_CACHE_TTL_SECONDS * 1000,
        };
        return NextResponse.json(cachedPayload, {
          headers: {
            'Cache-Control': AFL_LIST_CACHE_CONTROL,
          },
        });
      }
    }

    // Single source of truth for cron/debug: get games from the Odds API.
    // Normal user requests are fast cache reads only.
    let result: { props: AflListPropRow[]; games: AflGameOdds[] } | null = null;
    let canonicalError: string | undefined;
    let usedCanonicalGames = false;
    if (!hasCronAuth) {
      usedCanonicalGames = false;
      result = await listAflPlayerPropsFromCache();
      if (result?.games?.length) {
        const eligibleGames = filterAflPropsEligibleGames(result.games);
        result = await listAflPlayerPropsFromCacheWithGames(eligibleGames);
      }
      // User path is strictly cache-read only to protect latency.
      // Odds/props refresh is handled by cron and authenticated warm paths.
    } else {
      const canonical = await refreshAflOddsData({ skipWrite: true });
      if (canonical.success) {
        usedCanonicalGames = true;
        canonicalError = undefined;
        const apiGames = canonical.games ?? [];
        if (!apiGames.length) {
          result = { props: [], games: [] };
        } else {
          const eligibleGames = filterAflPropsEligibleGames(apiGames);
          result = await listAflPlayerPropsFromCacheWithGames(eligibleGames);
          if (result.props.length === 0 && result.games.length > 0) {
            void (async () => {
              try {
                const pp = await refreshAflPlayerPropsCache(eligibleGames);
                if (pp.eventsRefreshed > 0 && canonical.cachePayload) await setAflOddsCache(canonical.cachePayload);
              } catch (e) {
                console.warn('[AFL list] background props refresh failed:', e instanceof Error ? e.message : e);
              }
            })();
          }
        }
      } else {
        usedCanonicalGames = false;
        canonicalError = canonical.error ?? 'Odds API request failed';
        result = await listAflPlayerPropsFromCache();
        if (result?.games?.length) {
          const eligibleGames = filterAflPropsEligibleGames(result.games);
          result = await listAflPlayerPropsFromCacheWithGames(eligibleGames);
        }
      }
    }

    if (!result || !result.games.length) {
      if (hasCronAuth) {
        void (async () => {
          try {
            const r = await refreshAflOddsData({ skipWrite: true });
            if (!r.success || !r.games?.length) return;
            const eligibleGames = filterAflPropsEligibleGames(r.games);
            const pp = await refreshAflPlayerPropsCache(eligibleGames);
            if (pp.eventsRefreshed > 0 && r.cachePayload) await setAflOddsCache(r.cachePayload);
          } catch (e) {
            console.warn('[AFL list] background refresh failed:', e instanceof Error ? e.message : e);
          }
        })();
      }
      const emptyCache = await getAflOddsCache();
      const noAflOdds = usedCanonicalGames === true;
      const noOddsCopy = AFL_USER_NO_ODDS;
      const staleOrErrorCopy =
        'No AFL games from Odds API right now. If odds should be live, wait for the next cron refresh or run /api/afl/odds/refresh.';
      const lastUpdated = emptyCache?.lastUpdated;
      const nextUpdate = emptyCache?.nextUpdate;
      return NextResponse.json({
        success: true,
        data: [],
        games: [],
        lastUpdated,
        nextUpdate,
        gamesCount: 0,
        propsCount: 0,
        season: new Date().getFullYear(),
        ingestMessage: noAflOdds ? noOddsCopy : undefined,
        message: noAflOdds ? noOddsCopy : staleOrErrorCopy,
        noAflOdds,
        _meta: { canonicalError },
      }, {
        headers: {
          'Cache-Control': AFL_LIST_CACHE_CONTROL,
        },
      });
    }

    const rows = result.props.filter((r) => hasOver(r.overOdds) && hasUnder(r.underOdds));
    const gamesPayload = result.games.map((g) => ({
      gameId: g.gameId,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      commenceTime: g.commenceTime,
    }));
    const rowsWithCanonical = rows;

    if (!enrich) {
      const oddsCacheEnrich = await getAflOddsCache();
      const seasonEnrich = new Date().getFullYear();
      const gamesCountEnrich = gamesPayload.length;
      const propsCountEnrich = rowsWithCanonical.length;
      return NextResponse.json({
        success: true,
        data: rowsWithCanonical,
        games: gamesPayload,
        lastUpdated: oddsCacheEnrich?.lastUpdated ?? undefined,
        nextUpdate: oddsCacheEnrich?.nextUpdate ?? undefined,
        gamesCount: gamesCountEnrich,
        propsCount: propsCountEnrich,
        season: seasonEnrich,
        ingestMessage:
          propsCountEnrich === 0
            ? AFL_USER_NO_ODDS
            : `Fetched ${propsCountEnrich} stats for ${seasonEnrich} season, ${gamesCountEnrich} games`,
        _meta: {
          rowsFromList: rowsWithCanonical.length,
          enrich: false,
          canonicalUsed: usedCanonicalGames,
          canonicalError: canonicalError ?? undefined,
        },
      }, {
        headers: {
          'Cache-Control': AFL_LIST_CACHE_CONTROL,
        },
      });
    }

    const baseUrl =
      typeof request.url === 'string'
        ? new URL(request.url).origin
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
    const enrichContext = await getAflEnrichContext();
    const playerTeamMap = enrichContext.playerTeamMap;
    const fantasyTeamMap = enrichContext.fantasyTeamMap;
    const seasonForPositions = new Date().getFullYear();
    let fantasyPositionApiByName = new Map<string, string>();
    let fantasyPositionApiByInitialSurnameTeam = new Map<string, string>();
    try {
      const fromApi = await getFantasyPositionsFromApi(baseUrl, seasonForPositions, listCronSecret);
      fantasyPositionApiByName = fromApi.byName;
      fantasyPositionApiByInitialSurnameTeam = fromApi.byInitialSurnameTeam;
    } catch {
      // Ignore API fallback failure; we'll use local enrich context map below.
    }
    const normalizeForCompare = (v: string | null | undefined) =>
      String(v ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
    const normalizeNameLoose = (v: string) =>
      normalizeAflPlayerNameForMatch(v).replace(/[^a-z0-9]/g, '');
    const normalizeTeamForCompare = (team: string | null | undefined) =>
      (team ? toOfficialAflTeamDisplayName(team).trim().toLowerCase() : '');
    const teamByLooseName = new Map<string, string>();
    const teamCandidatesByInitialSurname = new Map<string, string[]>();
    const addTeamCandidate = (nameKey: string, team: string | null | undefined) => {
      const t = String(team ?? '').trim();
      if (!nameKey || !t) return;
      const loose = nameKey.replace(/[^a-z0-9]/g, '');
      if (loose && !teamByLooseName.has(loose)) teamByLooseName.set(loose, t);
      const parts = nameKey.split(' ').filter(Boolean);
      if (parts.length < 2) return;
      const idx = `${parts[0].charAt(0)}|${parts[parts.length - 1]}`;
      const arr = teamCandidatesByInitialSurname.get(idx) ?? [];
      if (!arr.includes(t)) arr.push(t);
      teamCandidatesByInitialSurname.set(idx, arr);
    };
    for (const [nameKey, t] of playerTeamMap.entries()) addTeamCandidate(nameKey, t);
    for (const [nameKey, t] of fantasyTeamMap.entries()) addTeamCandidate(nameKey, t);
    const resolvePlayerTeam = (name: string, homeTeam?: string, awayTeam?: string) => {
      const normalized = normalizeAflPlayerNameForMatch(name);
      const fromExact = playerTeamMap.get(normalized) ?? fantasyTeamMap.get(normalized);
      if (fromExact) return fromExact;
      const loose = normalizeNameLoose(name);
      const fromLoose = teamByLooseName.get(loose);
      if (fromLoose) return fromLoose;
      const parts = normalized.split(' ').filter(Boolean);
      if (parts.length >= 2) {
        const idx = `${parts[0].charAt(0)}|${parts[parts.length - 1]}`;
        const candidates = teamCandidatesByInitialSurname.get(idx) ?? [];
        if (candidates.length === 1) return candidates[0];
        if (candidates.length > 1 && homeTeam && awayTeam) {
          const homeNorm = normalizeTeamForCompare(homeTeam);
          const awayNorm = normalizeTeamForCompare(awayTeam);
          const matched = candidates.find((c) => {
            const n = normalizeTeamForCompare(c);
            return n === homeNorm || n === awayNorm;
          });
          if (matched) return matched;
        }
      }
      return null;
    };
    const positionMapForOverride = enrichContext.positionMap;
    const positionCandidatesByInitialSurname = new Map<string, Array<{ nameKey: string; position: string }>>();
    for (const [nameKey, pos] of positionMapForOverride.entries()) {
      if (!nameKey || !pos) continue;
      const parts = nameKey.split(' ').filter(Boolean);
      if (parts.length < 2) continue;
      const first = parts[0];
      const last = parts[parts.length - 1];
      if (!first || !last) continue;
      const idxKey = `${first.charAt(0)}|${last}`;
      const arr = positionCandidatesByInitialSurname.get(idxKey) ?? [];
      arr.push({ nameKey, position: pos });
      positionCandidatesByInitialSurname.set(idxKey, arr);
    }
    const resolvePositionForPlayer = (rawName: string, resolvedTeam: string | null | undefined): string | undefined => {
      const normalized = normalizeAflPlayerNameForMatch(rawName);
      const teamNorm = normalizeForCompare(String(resolvedTeam ?? ''));
      const exact = fantasyPositionApiByName.get(normalized) ?? positionMapForOverride.get(normalized);
      if (exact) return exact;
      const parts = normalized.split(' ').filter(Boolean);
      if (parts.length < 2) return undefined;
      const first = parts[0];
      const last = parts[parts.length - 1];
      if (!first || !last) return undefined;
      if (teamNorm) {
        const idxWithTeam = `${first.charAt(0)}|${last}|${teamNorm}`;
        const apiTeamPos = fantasyPositionApiByInitialSurnameTeam.get(idxWithTeam);
        if (apiTeamPos) return apiTeamPos;
      }
      const idxKey = `${first.charAt(0)}|${last}`;
      const candidates = positionCandidatesByInitialSurname.get(idxKey) ?? [];
      if (candidates.length === 0) return undefined;
      if (candidates.length === 1) return candidates[0].position;
      const wantedTeam = normalizeTeamForCompare(resolvedTeam);
      if (wantedTeam) {
        for (const candidate of candidates) {
          const teamFromFiles = playerTeamMap.get(candidate.nameKey);
          const teamFromFantasy = fantasyTeamMap.get(candidate.nameKey);
          const candidateTeam = normalizeTeamForCompare(teamFromFiles || teamFromFantasy || '');
          if (candidateTeam && candidateTeam === wantedTeam) return candidate.position;
        }
      }
      return candidates[0].position;
    };
    const uniqueCacheKeys = new Set<string>();
    const paramsByCacheKey = new Map<string, { playerName: string; homeTeam: string; awayTeam: string; statType: string; line: number }>();
    for (const r of rows) {
      const ck = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      uniqueCacheKeys.add(ck);
      if (!paramsByCacheKey.has(ck)) {
        paramsByCacheKey.set(ck, { playerName: r.playerName, homeTeam: r.homeTeam, awayTeam: r.awayTeam, statType: r.statType, line: r.line });
      }
    }
    const statsByKey = new Map<string, Awaited<ReturnType<typeof getAflPropStats>>>();
    const debugByKey = debugStats ? new Map<string, AflPropStatsDebug>() : null;
    // 1) Try cache (and compute on miss when request has cron auth so player-game-logs can hit FootyWire)
    await Promise.all(
      Array.from(uniqueCacheKeys).map(async (cacheKey) => {
        const p = paramsByCacheKey.get(cacheKey);
        if (!p) return;
        const debug = debugByKey ? ({ fromCache: false, gamesCount: 0 } as AflPropStatsDebug) : undefined;
        if (debugByKey) debugByKey.set(cacheKey, debug!);
        const resolvedTeam = resolvePlayerTeam(p.playerName) ?? undefined;
        let stats = await getAflPropStats(p.playerName, p.homeTeam, p.awayTeam, p.statType, p.line, baseUrl, null, cacheOnly, listCronSecret, resolvedTeam, debug);
        if (!stats) {
          stats = await getAflPropStats(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line, baseUrl, null, cacheOnly, listCronSecret, resolvedTeam, debug);
        }
        if (stats) {
          statsByKey.set(cacheKey, stats);
          const keyReverse = getAflPropStatsCacheKey(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line);
          if (keyReverse !== cacheKey) statsByKey.set(keyReverse, stats);
        }
      })
    );
    // Self-heal path: if non-cron request has cache misses (e.g. line moved since last warm),
    // compute only a tiny synchronous subset to protect latency, then continue in background.
    let missComputedSync = 0;
    let missComputeAttempted = 0;
    let missComputeBgScheduled = 0;
    if (!hasCronAuth && (MISS_COMPUTE_SYNC_LIMIT_NO_CRON > 0 || MISS_COMPUTE_BG_LIMIT_NO_CRON > 0)) {
      const missingParams = Array.from(uniqueCacheKeys)
        .filter((k) => !statsByKey.has(k))
        .map((k) => paramsByCacheKey.get(k))
        .filter(
          (v): v is { playerName: string; homeTeam: string; awayTeam: string; statType: string; line: number } =>
            Boolean(v)
        );
      missComputeAttempted = missingParams.length;
      const syncParams = missingParams.slice(0, MISS_COMPUTE_SYNC_LIMIT_NO_CRON);
      const bgParams = missingParams
        .slice(MISS_COMPUTE_SYNC_LIMIT_NO_CRON, MISS_COMPUTE_SYNC_LIMIT_NO_CRON + MISS_COMPUTE_BG_LIMIT_NO_CRON);
      missComputeBgScheduled = bgParams.length;
      const computeOne = async (p: {
        playerName: string;
        homeTeam: string;
        awayTeam: string;
        statType: string;
        line: number;
      }) => {
        const resolvedTeam = resolvePlayerTeam(p.playerName) ?? undefined;
        let stats = await getAflPropStats(
          p.playerName,
          p.homeTeam,
          p.awayTeam,
          p.statType,
          p.line,
          baseUrl,
          null,
          false,
          undefined,
          resolvedTeam
        );
        if (!stats) {
          stats = await getAflPropStats(
            p.playerName,
            p.awayTeam,
            p.homeTeam,
            p.statType,
            p.line,
            baseUrl,
            null,
            false,
            undefined,
            resolvedTeam
          );
        }
        return stats;
      };

      for (let i = 0; i < syncParams.length; i += MISS_COMPUTE_CONCURRENCY) {
        const batch = syncParams.slice(i, i + MISS_COMPUTE_CONCURRENCY);
        await Promise.all(
          batch.map(async (p) => {
            const stats = await computeOne(p);
            if (!stats) return;
            missComputedSync++;
            const key = getAflPropStatsCacheKey(p.playerName, p.homeTeam, p.awayTeam, p.statType, p.line);
            const keyReverse = getAflPropStatsCacheKey(p.playerName, p.awayTeam, p.homeTeam, p.statType, p.line);
            statsByKey.set(key, stats);
            if (keyReverse !== key) statsByKey.set(keyReverse, stats);
          })
        );
      }

      if (bgParams.length > 0) {
        void (async () => {
          for (let i = 0; i < bgParams.length; i += MISS_COMPUTE_CONCURRENCY) {
            const batch = bgParams.slice(i, i + MISS_COMPUTE_CONCURRENCY);
            await Promise.all(batch.map(async (p) => computeOne(p)));
          }
        })();
      }

      if (missComputeAttempted > 0) {
        console.log('[AFL list] miss-compute fallback', {
          attempted: missComputeAttempted,
          computedSync: missComputedSync,
          bgScheduled: missComputeBgScheduled,
        });
      }
    }
    // Without cron auth, list is cache-only; rows without cached stats show N/A. With cron auth we compute on miss (e.g. workflow N/A report).
    // Always override DvP from position-aware lookup so matchup rank matches dashboard.
    const dvpMapsForOverride = enrichContext.dvpMaps;
    type DvpBatchPayload = {
      metrics?: Record<
        string,
        {
          teamTotalRanks?: Record<string, number>;
          teamTotalValues?: Record<string, number>;
        }
      >;
    };
    const dvpBatchByPosition = new Map<string, DvpBatchPayload>();
    const loadDvpBatchForPosition = async (position: string): Promise<DvpBatchPayload | null> => {
      const pos = ['DEF', 'MID', 'FWD', 'RUC'].includes(position) ? position : 'MID';
      if (dvpBatchByPosition.has(pos)) return dvpBatchByPosition.get(pos) ?? null;
      try {
        const res = await fetch(
          `${baseUrl}/api/afl/dvp/batch?season=${DVP_MATCHUP_SEASON}&position=${encodeURIComponent(pos)}&stats=disposals,goals`,
          { cache: 'no-store' }
        );
        if (!res.ok) return null;
        const json = (await res.json().catch(() => null)) as DvpBatchPayload | null;
        if (!json || typeof json !== 'object') return null;
        dvpBatchByPosition.set(pos, json);
        return json;
      } catch {
        return null;
      }
    };
    const getDvpOverride = (opponent: string, statType: string, position?: string | null) => {
      return getDvpLookupTeamTotal(opponent, statType, dvpMapsForOverride, position);
    };
    const findTeamValue = (
      values: Record<string, number> | undefined,
      opponent: string
    ): number | null => {
      if (!values) return null;
      const normalize = (v: string) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      const candidates = Array.from(
        new Set(
          [
            opponent,
            toOfficialAflTeamDisplayName(opponent),
            opponentToFootywireTeam(opponent),
          ]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .flatMap((v) => [v, normalize(v)])
        )
      );
      for (const c of candidates) {
        const raw = values[c];
        if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
      }
      const wantedOfficial = normalize(toOfficialAflTeamDisplayName(opponent));
      for (const [k, v] of Object.entries(values)) {
        if (!Number.isFinite(Number(v))) continue;
        if (normalize(toOfficialAflTeamDisplayName(k)) === wantedOfficial) return Number(v);
      }
      return null;
    };
    const teamMatchesOverride = (a: string, b: string) => {
      const officialA = (a ?? '').trim() ? toOfficialAflTeamDisplayName((a ?? '').trim()) : '';
      const officialB = (b ?? '').trim() ? toOfficialAflTeamDisplayName((b ?? '').trim()) : '';
      return (officialA && officialB) && officialA === officialB;
    };
    const rowContexts = rows.map((r) => {
      const playerTeam = resolvePlayerTeam(r.playerName, r.homeTeam, r.awayTeam);
      const opponent =
        playerTeam && teamMatchesOverride(playerTeam, r.homeTeam)
          ? r.awayTeam
          : playerTeam && teamMatchesOverride(playerTeam, r.awayTeam)
            ? r.homeTeam
            : r.awayTeam;
      const position = resolvePositionForPlayer(r.playerName, playerTeam) ?? 'MID';
      return { r, playerTeam, opponent, position };
    });
    const neededPositions = Array.from(new Set(rowContexts.map((ctx) => ctx.position).filter(Boolean)));
    await Promise.all(neededPositions.map((pos) => loadDvpBatchForPosition(pos)));

    const enrichedRows: (AflListPropRow & Record<string, unknown>)[] = rowContexts.map(({ r, playerTeam, opponent, position }) => {
      const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
      const keyAlt = getAflPropStatsCacheKey(r.playerName, r.awayTeam, r.homeTeam, r.statType, r.line);
      const stats = statsByKey.get(key) ?? statsByKey.get(keyAlt);
      const batch = dvpBatchByPosition.get(position || 'MID');
      const metric = r.statType === 'goals_over' ? 'goals' : 'disposals';
      const rankFromBatch = findTeamValue(batch?.metrics?.[metric]?.teamTotalRanks, opponent);
      const valueFromBatch = findTeamValue(batch?.metrics?.[metric]?.teamTotalValues, opponent);
      const dvpLookupResult = rankFromBatch != null && valueFromBatch != null
        ? { rank: rankFromBatch, value: valueFromBatch }
        : getDvpOverride(opponent, r.statType, position);
      // Always use the live position-aware team-total DvP lookup (dashboard source of truth).
      // Never fall back to cached prop-level DvP values, which can be stale after mapping changes.
      const dvpRating = dvpLookupResult?.rank ?? null;
      const dvpStatValue = dvpLookupResult?.value ?? null;
      const baseRow = {
        ...r,
        playerTeam: playerTeam ?? undefined,
        last5Avg: stats?.last5Avg,
        last10Avg: stats?.last10Avg,
        h2hAvg: stats?.h2hAvg,
        seasonAvg: stats?.seasonAvg,
        streak: stats?.streak,
        last5HitRate: stats?.last5HitRate,
        last10HitRate: stats?.last10HitRate,
        h2hHitRate: stats?.h2hHitRate,
        seasonHitRate: stats?.seasonHitRate,
        dvpRating,
        dvpStatValue,
        ...(debugStats ? { _dvpPosition: position, _dvpOpponent: opponent } : {}),
      };
      return baseRow;
    });
    const rowsWithStats = enrichedRows.filter((r) => r.last5Avg != null || r.seasonAvg != null);
    const rowsNa = enrichedRows.filter((r) => r.last5Avg == null && r.seasonAvg == null);
    const oddsCache = await getAflOddsCache();
    const season = new Date().getFullYear();
    const gamesCount = gamesPayload.length;
    const propsCount = enrichedRows.length;

    const naSummary = {
      totalProps: enrichedRows.length,
      withStats: rowsWithStats.length,
      naCount: rowsNa.length,
      naPct: enrichedRows.length > 0 ? Math.round((rowsNa.length / enrichedRows.length) * 100) : 0,
    };

    const payload: Record<string, unknown> = {
      success: true,
      data: enrichedRows,
      games: gamesPayload,
      lastUpdated: oddsCache?.lastUpdated ?? undefined,
      nextUpdate: oddsCache?.nextUpdate ?? undefined,
      gamesCount,
      propsCount,
      season,
      naSummary,
      ingestMessage:
        propsCount === 0 ? AFL_USER_NO_ODDS : `Fetched ${propsCount} stats for ${season} season, ${gamesCount} games`,
      _meta: {
        canonicalUsed: usedCanonicalGames,
        canonicalError: canonicalError ?? undefined,
      },
    };
    if (debugStats) {
      const missedKeys = Array.from(uniqueCacheKeys).filter((k) => !statsByKey.has(k));
      const cacheHits = uniqueCacheKeys.size - missedKeys.length;
      const cacheMisses = missedKeys.length;
      console.log('[AFL list debugStats]', {
        uniqueCacheKeys: uniqueCacheKeys.size,
        cacheHits,
        cacheMisses,
        rowsWithStats: rowsWithStats.length,
        rowsNa: rowsNa.length,
        totalRows: rows.length,
        cacheBackend: getSharedCacheBackend(),
      });
      const debugNa = debugByKey
        ? rowsNa.slice(0, 80).map((r) => {
            const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
            const d = debugByKey.get(key);
            const reason =
              !d
                ? 'no_debug'
                : d.fromCache && d.gamesCount === -1
                  ? 'cached_but_empty (cache had entry with null stats)'
                  : !d.fromCache && d.gamesCount === 0
                    ? 'computed_0_games (player-game-logs returned empty for both seasons)'
                    : !d.fromCache && d.gamesCount > 0
                      ? 'computed_has_games_but_nulls (bug?)'
                      : `fromCache=${d.fromCache} gamesCount=${d.gamesCount}`;
            return {
              playerName: r.playerName,
              statType: r.statType,
              line: r.line,
              homeTeam: r.homeTeam,
              awayTeam: r.awayTeam,
              fromCache: d?.fromCache ?? null,
              gamesCount: d?.gamesCount ?? null,
              reason,
            };
          })
        : [];
      const naReasons: Record<string, number> = {};
      if (debugByKey) {
        for (const r of rowsNa) {
          const key = getAflPropStatsCacheKey(r.playerName, r.homeTeam, r.awayTeam, r.statType, r.line);
          const d = debugByKey.get(key);
          const reason =
            !d
              ? 'no_debug'
              : d.fromCache && d.gamesCount === -1
                ? 'cached_but_empty'
                : !d.fromCache && d.gamesCount === 0
                  ? 'no_game_logs'
                  : !d.fromCache && d.gamesCount > 0
                    ? 'computed_has_games_but_nulls'
                    : `fromCache=${d.fromCache}_games=${d.gamesCount}`;
          naReasons[reason] = (naReasons[reason] ?? 0) + 1;
        }
      }
      payload._meta = {
        uniqueCacheKeys: uniqueCacheKeys.size,
        cacheHits,
        cacheMisses,
        missComputeAttempted: !hasCronAuth ? missComputeAttempted : undefined,
        missComputedSync: !hasCronAuth ? missComputedSync : undefined,
        missComputeBgScheduled: !hasCronAuth ? missComputeBgScheduled : undefined,
        rowsWithStats: rowsWithStats.length,
        rowsNa: rowsNa.length,
        totalRows: rows.length,
        cacheBackend: getSharedCacheBackend(),
        naSummary,
        naReasons: Object.keys(naReasons).length ? naReasons : undefined,
        debugNaSample: debugNa.slice(0, 50),
        hint:
          getSharedCacheBackend() === 'memory' && cacheMisses > 0
            ? 'Stats cache is in-memory (per process). Warm and list may run in different processes, so only some keys are found. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local to use Redis and share cache across all requests.'
            : !hasCronAuth && rowsNa.length > 0
              ? '"no_game_logs" = no cached stats and list did not compute (cache-only). Call list with Authorization: Bearer CRON_SECRET to compute on miss and fetch from FootyWire; workflow N/A report does this.'
              : undefined,
      };
    }

    if (enrich && !debugStats) {
      aflEnrichedPayloadMemoryCache = {
        payload,
        expiresAt: Date.now() + AFL_LIST_ENRICHED_RESPONSE_CACHE_TTL_SECONDS * 1000,
      };
      await Promise.allSettled([
        sharedCache.setJSON(
          AFL_LIST_ENRICHED_RESPONSE_CACHE_KEY,
          payload,
          AFL_LIST_ENRICHED_RESPONSE_CACHE_TTL_SECONDS
        ),
        setNBACache(
          AFL_LIST_ENRICHED_SUPABASE_CACHE_KEY,
          'afl-player-props-list-enriched',
          payload,
          AFL_LIST_ENRICHED_RESPONSE_CACHE_TTL_MINUTES,
          true
        ),
      ]);
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': AFL_LIST_CACHE_CONTROL,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [], games: [] }, { status: 500 });
  }
}
