import { NextResponse } from 'next/server';
import { getAflOddsCache, AFL_ODDS_CACHE_KEY } from '@/lib/refreshAflOdds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/cache-status/afl-odds
 * Shows whether AFL odds cache is in use and if Upstash is configured.
 * (Under /api/cache-status/ so it is not caught by /api/afl/[...path].)
 */
export async function GET() {
  const upstashConfigured =
    !!(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());

  const cache = await getAflOddsCache();
  const gamesCount = cache?.games?.length ?? 0;
  const lastUpdated = cache?.lastUpdated ?? null;
  const nextUpdate = cache?.nextUpdate ?? null;

  return NextResponse.json({
    upstashConfigured,
    cacheBackend: upstashConfigured ? 'upstash' : 'memory',
    gameOddsKey: AFL_ODDS_CACHE_KEY,
    gameOdds: cache
      ? {
          hit: true,
          gamesCount,
          lastUpdated,
          nextUpdate,
        }
      : { hit: false, message: 'No game odds in cache. Run /api/afl/odds/refresh first.' },
    playerPropsKeyPattern: 'afl_pp_v3:{eventId}',
    howToCheckUpstash: upstashConfigured
      ? 'In Upstash dashboard → Data Browser, search for key "afl_game_odds_v2" and "afl_pp_v3*" to see cached entries.'
      : 'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel to use Upstash.',
  });
}
