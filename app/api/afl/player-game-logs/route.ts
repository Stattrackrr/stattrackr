import { NextRequest, NextResponse } from 'next/server';
import { toCanonicalAflPlayerName } from '@/lib/aflPlayerNameUtils';
import { fetchFootyInfoPlayerGameLogs } from '@/lib/afl/footyinfoPlayer';
import {
  AFL_PLAYER_LOGS_NEGATIVE_CACHE_TTL_SECONDS,
  buildAflPlayerLogsCacheKey,
  getAflPlayerLogsCache,
  isAflPlayerLogsCacheEnabled,
  setAflPlayerLogsCache,
  type AflPlayerLogsCachePayload,
} from '@/lib/cache/aflPlayerLogsCache';

const SUPPORTED_SEASONS = new Set([2024, 2025, 2026]);
const hasCachedPayload = (value: AflPlayerLogsCachePayload | null): value is AflPlayerLogsCachePayload =>
  value != null && Array.isArray(value.games);

function isAuthorizedCacheWarm(request: NextRequest): boolean {
  const normalize = (value: string) => value.replace(/\r\n|\r|\n/g, '').trim();
  const expected = normalize(process.env.CRON_SECRET || '');
  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : authorization;
  const provided = normalize(bearer || request.headers.get('x-cron-secret') || '');
  if (expected && provided === expected) return true;
  // Local warm script deliberately opts in; this is never accepted in production.
  return process.env.NODE_ENV !== 'production' && request.headers.get('x-afl-cache-warm') === '1';
}

export async function GET(request: NextRequest) {
  const season = Number(request.nextUrl.searchParams.get('season'));
  const playerParam = request.nextUrl.searchParams.get('player_name')?.trim();
  const team = request.nextUrl.searchParams.get('team')?.trim() || '';
  const includeBoth = ['1', 'true'].includes(request.nextUrl.searchParams.get('include_both') || '');
  const forceFetch = ['1', 'true'].includes(request.nextUrl.searchParams.get('force_fetch') || '');
  if (!SUPPORTED_SEASONS.has(season)) return NextResponse.json({ error: 'season query param must be 2024, 2025, or 2026' }, { status: 400 });
  if (!playerParam) return NextResponse.json({ error: 'player_name query param is required' }, { status: 400 });

  const playerName = toCanonicalAflPlayerName(playerParam);
  const cacheEnabled = isAflPlayerLogsCacheEnabled();
  const key = buildAflPlayerLogsCacheKey({ season, playerName, teamForRequest: team || null, includeQuarters: false });
  const quarterKey = buildAflPlayerLogsCacheKey({ season, playerName, teamForRequest: team || null, includeQuarters: true });
  const headers = { 'X-AFL-Cache-Enabled': String(cacheEnabled) };
  const canWarm = isAuthorizedCacheWarm(request);
  if (cacheEnabled && !forceFetch) {
    const [base, quarters] = await Promise.all([getAflPlayerLogsCache(key), getAflPlayerLogsCache(quarterKey)]);
    if (hasCachedPayload(base)) {
      return NextResponse.json(
        includeBoth ? { ...base, gamesWithQuarters: quarters?.games || base.games } : base,
        { headers: { ...headers, 'X-AFL-Player-Logs-Source': 'cache' } }
      );
    }
  }
  if (!canWarm) {
    return NextResponse.json(
      {
        error: 'Player history is not warmed yet',
        season,
        source: 'cache-miss',
        player_name: playerName,
        games: [],
        game_count: 0,
      },
      { status: 503, headers: { ...headers, 'X-AFL-Player-Logs-Source': 'cache-miss' } }
    );
  }

  try {
    const result = await fetchFootyInfoPlayerGameLogs(playerName, season, team);
    const games = result?.games || [];
    const payload: AflPlayerLogsCachePayload = {
      season,
      source: 'footyinfo.com',
      player_name: result?.player_name || playerName,
      games,
      game_count: games.length,
      ...(result?.height ? { height: result.height } : {}),
      ...(result?.guernsey != null ? { guernsey: result.guernsey } : {}),
    };
    if (cacheEnabled) {
      await Promise.all([
        setAflPlayerLogsCache(key, payload, games.length ? undefined : { allowEmpty: true, ttlSeconds: AFL_PLAYER_LOGS_NEGATIVE_CACHE_TTL_SECONDS }),
        setAflPlayerLogsCache(quarterKey, payload, games.length ? undefined : { allowEmpty: true, ttlSeconds: AFL_PLAYER_LOGS_NEGATIVE_CACHE_TTL_SECONDS }),
      ]);
    }
    return NextResponse.json(
      includeBoth ? { ...payload, gamesWithQuarters: games } : payload,
        { headers: { ...headers, 'X-AFL-Player-Logs-Source': games.length ? 'footyinfo-warm' : 'footyinfo-warm-empty' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch FootyInfo player game logs', details: error instanceof Error ? error.message : String(error) },
      { status: 502, headers }
    );
  }
}
