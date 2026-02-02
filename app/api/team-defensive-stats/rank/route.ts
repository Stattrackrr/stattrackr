export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';
import { getNBACache } from '@/lib/nbaCache';
import { NBA_TEAMS } from '@/lib/nbaAbbr';

export const runtime = 'nodejs';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const getBdlApiKey = (): string => {
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY environment variable is required');
  }
  return apiKey;
};

const getBdlHeaders = (): Record<string, string> => {
  const apiKey = getBdlApiKey();
  return {
    Accept: 'application/json',
    'User-Agent': 'StatTrackr/1.0',
    Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
  };
};

const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
  ATL: 1, BOS: 2, BKN: 3, CHA: 4, CHI: 5, CLE: 6, DAL: 7, DEN: 8, DET: 9, GSW: 10,
  HOU: 11, IND: 12, LAC: 13, LAL: 14, MEM: 15, MIA: 16, MIL: 17, MIN: 18, NOP: 19, NYK: 20,
  OKC: 21, ORL: 22, PHI: 23, PHX: 24, POR: 25, SAC: 26, SAS: 27, TOR: 28, UTA: 29, WAS: 30,
};

async function bdlFetch(url: string) {
  const headers = getBdlHeaders();
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status}: ${t || url}`);
  }
  return res.json();
}

function currentNbaSeason(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Get defensive stats rankings for all teams
 * Rank 30 = best (most points allowed) for our player
 * Rank 1 = worst (least points allowed) for our player
 * Query params:
 * - games: Number of games (default: 20)
 * - season: Season year (optional, defaults to current)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const games = Math.min(parseInt(searchParams.get('games') || '10', 10) || 10, 20); // Default to 10, max 20 for speed
  const seasonParam = searchParams.get('season');
  const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();

  try {
    const nbaCacheKey = `team_defensive_stats_rankings:${seasonYear}`;
    const bdlCacheKey = `team_defensive_stats_rankings:${seasonYear}:${games}`;

    // 1. Check in-memory cache (same pattern as shot-chart-enhanced)
    let hit = cache.get<any>(nbaCacheKey) ?? cache.get<any>(bdlCacheKey);
    if (hit) {
      console.log(`[team-defensive-stats-rank] Cache hit (in-memory) for season ${seasonYear}`);
      return NextResponse.json(hit);
    }

    // 2. Check Supabase nba_api_cache (populated by /api/cache/nba-league-data cron - no direct NBA API from production)
    try {
      hit = await getNBACache<any>(nbaCacheKey);
      if (hit) {
        cache.set(nbaCacheKey, hit, CACHE_TTL.TRACKING_STATS);
        console.log(`[team-defensive-stats-rank] Cache hit (Supabase) for season ${seasonYear}`);
        return NextResponse.json(hit);
      }
      hit = await getNBACache<any>(bdlCacheKey);
      if (hit) {
        cache.set(bdlCacheKey, hit, CACHE_TTL.ADVANCED_STATS * 2);
        console.log(`[team-defensive-stats-rank] Cache hit (Supabase BDL) for season ${seasonYear}`);
        return NextResponse.json(hit);
      }
      // Stale cache fallback (like shot chart)
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && supabaseServiceKey) {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { autoRefreshToken: false, persistSession: false }
        });
        for (const key of [nbaCacheKey, bdlCacheKey]) {
          const { data: staleData } = await supabaseAdmin
            .from('nba_api_cache')
            .select('data')
            .eq('cache_key', key)
            .maybeSingle();
          if (staleData?.data) {
            hit = staleData.data as any;
            cache.set(key, hit, CACHE_TTL.TRACKING_STATS);
            console.log(`[team-defensive-stats-rank] Stale cache hit for season ${seasonYear}`);
            return NextResponse.json(hit);
          }
        }
      }
    } catch (cacheErr: any) {
      // Ignore cache errors, fall through to BDL
    }

    // 3. Fall back to BallDontLie (cache populated by cron; BDL fallback when cache empty)
    console.log(`[team-defensive-stats-rank] No cache, falling back to BDL (${games} games). Run /api/cache/nba-league-data to populate NBA data.`);
    
    // Fetch defensive stats for all teams in parallel (with rate limiting)
    const teams = Object.keys(NBA_TEAMS);
    const teamStatsMap: Record<string, {
      pts: number;
      reb: number;
      ast: number;
      fg_pct: number;
      fg3_pct: number;
      stl: number;
      blk: number;
      sample_games: number;
    }> = {};

    // Fetch in smaller batches with shorter delays to speed things up
    const batchSize = 10; // Increased batch size for faster processing
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize);
      const batchPromises = batch.map(async (team) => {
        try {
          const teamId = ABBR_TO_TEAM_ID_BDL[team];
          if (!teamId) return null;

          // Fetch games for this team
          const allGames: any[] = [];
          let gamesPage = 1;
          let hasMoreGames = true;
          const MAX_GAMES_PAGES = 5; // Limit for ranking endpoint

          while (hasMoreGames && allGames.length < games * 2 && gamesPage <= MAX_GAMES_PAGES) {
            const gamesUrl = new URL(`${BDL_BASE}/games`);
            gamesUrl.searchParams.set('per_page', '100');
            gamesUrl.searchParams.set('page', String(gamesPage));
            gamesUrl.searchParams.append('seasons[]', String(seasonYear));
            gamesUrl.searchParams.append('team_ids[]', String(teamId));

            const gamesJson = await bdlFetch(gamesUrl.toString());
            const games: any[] = Array.isArray(gamesJson?.data) ? gamesJson.data : [];
            allGames.push(...games);

            const meta = gamesJson?.meta;
            hasMoreGames = meta?.next_page !== null && games.length === 100 && games.length > 0;
            gamesPage++;
            if (games.length === 0) hasMoreGames = false;
          }

          const completedGames = allGames
            .filter((g: any) => String(g?.status || '').toLowerCase().includes('final'))
            .sort((a: any, b: any) => {
              const dateA = new Date(a.date || 0).getTime();
              const dateB = new Date(b.date || 0).getTime();
              return dateB - dateA;
            })
            .slice(0, games);

          if (completedGames.length === 0) return null;

          // Fetch stats for completed games (limit to 10 games for faster ranking)
          const gameIds = completedGames.slice(0, 10).map((g: any) => String(g.id)).filter(Boolean);
          if (gameIds.length === 0) return null;
          
          const statsUrl = new URL(`${BDL_BASE}/stats`);
          gameIds.forEach(id => statsUrl.searchParams.append('game_ids[]', id));
          statsUrl.searchParams.set('per_page', '100');

          const statsJson = await bdlFetch(statsUrl.toString());
          const allStats: any[] = Array.isArray(statsJson?.data) ? statsJson.data : [];

          // Aggregate opponent stats per game
          const gameOpponentStatsMap = new Map<number, {
            pts: number; reb: number; ast: number;
            fgm: number; fga: number; fg3m: number; fg3a: number;
            stl: number; blk: number;
          }>();

          for (const stat of allStats) {
            const gameId = stat?.game?.id;
            const statTeamId = stat?.team?.id;
            if (!gameId) continue;

            const game = completedGames.find((g: any) => g.id === gameId);
            if (!game) continue;

            const homeTeamId = game.home_team?.id;
            const visitorTeamId = game.visitor_team?.id;
            const opponentTeamId = homeTeamId === teamId ? visitorTeamId : homeTeamId;

            if (statTeamId !== opponentTeamId) continue;

            if (!gameOpponentStatsMap.has(gameId)) {
              gameOpponentStatsMap.set(gameId, {
                pts: 0, reb: 0, ast: 0,
                fgm: 0, fga: 0, fg3m: 0, fg3a: 0,
                stl: 0, blk: 0
              });
            }

            const gameStats = gameOpponentStatsMap.get(gameId)!;
            gameStats.pts += Number(stat.pts || 0);
            gameStats.reb += Number(stat.reb || 0);
            gameStats.ast += Number(stat.ast || 0);
            gameStats.fgm += Number(stat.fgm || 0);
            gameStats.fga += Number(stat.fga || 0);
            gameStats.fg3m += Number(stat.fg3m || 0);
            gameStats.fg3a += Number(stat.fg3a || 0);
            gameStats.stl += Number(stat.stl || 0);
            gameStats.blk += Number(stat.blk || 0);
          }

          const gameCount = gameOpponentStatsMap.size;
          if (gameCount === 0) return null;

          let totalPts = 0, totalReb = 0, totalAst = 0;
          let totalFgm = 0, totalFga = 0;
          let totalFg3m = 0, totalFg3a = 0;
          let totalStl = 0, totalBlk = 0;

          for (const gameStats of gameOpponentStatsMap.values()) {
            totalPts += gameStats.pts;
            totalReb += gameStats.reb;
            totalAst += gameStats.ast;
            totalFgm += gameStats.fgm;
            totalFga += gameStats.fga;
            totalFg3m += gameStats.fg3m;
            totalFg3a += gameStats.fg3a;
            totalStl += gameStats.stl;
            totalBlk += gameStats.blk;
          }

          return {
            team,
            stats: {
              pts: gameCount > 0 ? totalPts / gameCount : 0,
              reb: gameCount > 0 ? totalReb / gameCount : 0,
              ast: gameCount > 0 ? totalAst / gameCount : 0,
              fg_pct: totalFga > 0 ? (totalFgm / totalFga) * 100 : 0,
              fg3_pct: totalFg3a > 0 ? (totalFg3m / totalFg3a) * 100 : 0,
              stl: gameCount > 0 ? totalStl / gameCount : 0,
              blk: gameCount > 0 ? totalBlk / gameCount : 0,
              sample_games: gameCount,
            }
          };
        } catch (error: any) {
          console.error(`[team-defensive-stats-rank] Error fetching ${team}:`, error.message);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach((result) => {
        if (result) {
          teamStatsMap[result.team] = result.stats;
        }
      });

      // Smaller delay between batches to speed up (still avoid rate limiting)
      if (i + batchSize < teams.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Calculate rankings (rank 30 = best/most, rank 1 = worst/least)
    const metrics = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'] as const;
    const rankings: Record<string, Record<string, number>> = {};

    for (const metric of metrics) {
      const teamsWithStats = Object.entries(teamStatsMap)
        .filter(([_, stats]) => stats.sample_games > 0)
        .sort(([_, a], [__, b]) => {
          // Sort descending (highest first) - rank 30 is best
          return (b[metric] || 0) - (a[metric] || 0);
        });

      teamsWithStats.forEach(([team], index) => {
        if (!rankings[team]) rankings[team] = {};
        // Rank 30 = best (index 0), Rank 1 = worst (index 29)
        rankings[team][metric] = 30 - index;
      });
    }

    const payload = {
      success: true,
      season: seasonYear,
      games,
      rankings,
      teamStats: teamStatsMap,
    };

    // Cache BDL result (includes games in key since BDL varies by games)
    cache.set(bdlCacheKey, payload, CACHE_TTL.ADVANCED_STATS * 2);

    return NextResponse.json(payload);
  } catch (e: any) {
    console.error('[team-defensive-stats-rank] Error:', e);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json({
      success: false,
      error: isProduction 
        ? 'An error occurred. Please try again later.' 
        : (e?.message || 'Failed to get defensive stats rankings'),
      rankings: {},
      teamStats: {},
    }, { status: 500 });
  }
}

