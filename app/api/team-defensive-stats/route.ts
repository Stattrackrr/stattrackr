export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';
import { normalizeAbbr } from '@/lib/nbaAbbr';

export const runtime = 'nodejs';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const BDL_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'StatTrackr/1.0',
};

// Get API key with fallback
const getBdlApiKey = () => {
  return process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd';
};

// Set authorization header dynamically
const getBdlHeaders = (): Record<string, string> => {
  const apiKey = getBdlApiKey();
  return {
    ...BDL_HEADERS,
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
 * Get team-level defensive stats (what opponents score against this team)
 * Uses BallDontLie API to aggregate opponent stats from games
 * Query params:
 * - team: Team abbreviation (e.g., "LAL")
 * - games: Number of games (default: 82)
 * - season: Season year (optional, defaults to current)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawTeam = searchParams.get('team');
  const seasonParam = searchParams.get('season');
  
  try {
    if (!rawTeam) {
      return NextResponse.json({ error: 'Missing team parameter' }, { status: 400 });
    }
    
    const team = normalizeAbbr(rawTeam);
    const games = Math.min(parseInt(searchParams.get('games') || '82', 10) || 82, 82);
    const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();

    const teamId = ABBR_TO_TEAM_ID_BDL[team];
    if (!teamId) {
      return NextResponse.json({ error: `Unknown team: ${team}` }, { status: 400 });
    }

    const cacheKey = `team_defensive_stats_bdl:${team}:${seasonYear}:${games}`;
    const hit = cache.get<any>(cacheKey);
    // Only return cached response if it's successful and has valid per-game data
    // Check that perGame values are reasonable (not totals - should be < 200 for points)
    if (hit && hit.success !== false && hit.perGame) {
      const ptsPerGame = hit.perGame.pts || 0;
      // If points per game is > 200, it's likely totals, not per-game - invalidate cache
      if (ptsPerGame > 0 && ptsPerGame < 200) {
        console.log(`[team-defensive-stats] Cache hit for ${team} ${seasonYear} (pts/game: ${ptsPerGame.toFixed(1)})`);
        return NextResponse.json(hit);
      } else {
        console.log(`[team-defensive-stats] Invalidating cache for ${team} - values look like totals (${ptsPerGame.toFixed(1)})`);
        cache.delete(cacheKey);
      }
    }

    console.log(`[team-defensive-stats] Fetching stats for ${team} (ID: ${teamId}) season ${seasonYear}, max ${games} games`);
    
    // Fetch games for this team in the season (handle pagination)
    const allGames: any[] = [];
    let gamesPage = 1;
    let hasMoreGames = true;
    const MAX_GAMES_PAGES = 10; // Safety limit to prevent infinite loops
    
    while (hasMoreGames && allGames.length < games * 2 && gamesPage <= MAX_GAMES_PAGES) {
      const gamesUrl = new URL(`${BDL_BASE}/games`);
      gamesUrl.searchParams.set('per_page', '100');
      gamesUrl.searchParams.set('page', String(gamesPage));
      gamesUrl.searchParams.append('seasons[]', String(seasonYear));
      gamesUrl.searchParams.append('team_ids[]', String(teamId));

      console.log(`[team-defensive-stats] Fetching games page ${gamesPage}...`);
      const gamesJson = await bdlFetch(gamesUrl.toString());
      const games: any[] = Array.isArray(gamesJson?.data) ? gamesJson.data : [];
      allGames.push(...games);
      
      console.log(`[team-defensive-stats] Got ${games.length} games (total: ${allGames.length})`);
      
      // Check if there are more pages
      const meta = gamesJson?.meta;
      hasMoreGames = meta?.next_page !== null && games.length === 100 && games.length > 0;
      gamesPage++;
      
      // Safety check: if we got no games, stop
      if (games.length === 0) {
        hasMoreGames = false;
      }
    }
    
    console.log(`[team-defensive-stats] Total games fetched: ${allGames.length}`);
    
    // Filter to completed games and sort by date descending
    const completedGames = allGames
      .filter((g: any) => String(g?.status || '').toLowerCase().includes('final'))
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, games);

    console.log(`[team-defensive-stats] Completed games: ${completedGames.length}`);

    if (completedGames.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'No completed games found for this team',
        team,
        season: seasonYear,
        sample_games: 0,
        perGame: {
          pts: 0, reb: 0, ast: 0, fg_pct: 0, fg3_pct: 0, stl: 0, blk: 0
        }
      });
    }

    // Fetch stats for all games
    const gameIds = completedGames.map((g: any) => String(g.id)).filter(Boolean);
    
    // Fetch stats in batches (BDL API limit is 100 per page)
    const allStats: any[] = [];
    const MAX_STATS_PAGES = 20; // Safety limit per batch to prevent infinite loops
    
    console.log(`[team-defensive-stats] Fetching stats for ${gameIds.length} games in batches...`);
    
    for (let i = 0; i < gameIds.length; i += 100) {
      const batch = gameIds.slice(i, i + 100);
      console.log(`[team-defensive-stats] Processing batch ${Math.floor(i / 100) + 1} (${batch.length} games)...`);
      
      // Handle pagination for stats
      let statsPage = 1;
      let hasMoreStats = true;
      
      while (hasMoreStats && statsPage <= MAX_STATS_PAGES) {
        const statsUrl = new URL(`${BDL_BASE}/stats`);
        batch.forEach(id => statsUrl.searchParams.append('game_ids[]', id));
        statsUrl.searchParams.set('per_page', '100');
        statsUrl.searchParams.set('page', String(statsPage));
        
        const statsJson = await bdlFetch(statsUrl.toString());
        const stats: any[] = Array.isArray(statsJson?.data) ? statsJson.data : [];
        allStats.push(...stats);
        
        console.log(`[team-defensive-stats] Batch ${Math.floor(i / 100) + 1}, page ${statsPage}: ${stats.length} stats (total: ${allStats.length})`);
        
        // Check if there are more pages
        const meta = statsJson?.meta;
        hasMoreStats = meta?.next_page !== null && stats.length === 100 && stats.length > 0;
        statsPage++;
        
        // Safety check: if we got no stats, stop
        if (stats.length === 0) {
          hasMoreStats = false;
        }
      }
    }
    
    console.log(`[team-defensive-stats] Total stats fetched: ${allStats.length}`);

    // For each game, identify the opponent and aggregate their stats
    // This gives us what opponents score against this team
    const gameOpponentStatsMap = new Map<number, { 
      pts: number; reb: number; ast: number; 
      fgm: number; fga: number; fg3m: number; fg3a: number; 
      stl: number; blk: number;
    }>();

    // Group stats by game and opponent team
    for (const stat of allStats) {
      const gameId = stat?.game?.id;
      const statTeamId = stat?.team?.id;
      
      if (!gameId) continue;
      
      // Find the game to identify opponent
      const game = completedGames.find((g: any) => g.id === gameId);
      if (!game) continue;
      
      // Determine opponent team ID
      const homeTeamId = game.home_team?.id;
      const visitorTeamId = game.visitor_team?.id;
      
      // Identify which team is our team and which is the opponent
      // Our team is the one we're querying for (teamId)
      const opponentTeamId = homeTeamId === teamId ? visitorTeamId : homeTeamId;
      
      // Only process stats from the opponent (not from our team)
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

    // Sum across all games
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

    const gameCount = gameOpponentStatsMap.size;

    console.log(`[team-defensive-stats] Calculated totals: pts=${totalPts}, reb=${totalReb}, ast=${totalAst}, games=${gameCount}`);
    console.log(`[team-defensive-stats] Completed games: ${completedGames.length}, Games with opponent stats: ${gameCount}`);

    // Ensure we have valid game count
    if (gameCount === 0) {
      console.warn(`[team-defensive-stats] No games with opponent stats found for ${team}`);
      return NextResponse.json({ 
        success: false, 
        error: 'No opponent stats found for this team',
        team,
        season: seasonYear,
        sample_games: 0,
        perGame: {
          pts: 0, reb: 0, ast: 0, fg_pct: 0, fg3_pct: 0, stl: 0, blk: 0
        }
      });
    }

    // Calculate per-game averages (what opponents score against this team)
    // IMPORTANT: Divide totals by gameCount to get per-game values
    const perGame = {
      pts: totalPts / gameCount,
      reb: totalReb / gameCount,
      ast: totalAst / gameCount,
      fg_pct: totalFga > 0 ? (totalFgm / totalFga) * 100 : 0,
      fg3_pct: totalFg3a > 0 ? (totalFg3m / totalFg3a) * 100 : 0,
      stl: totalStl / gameCount,
      blk: totalBlk / gameCount,
    };

    console.log(`[team-defensive-stats] Per-game averages: pts=${perGame.pts.toFixed(1)}, reb=${perGame.reb.toFixed(1)}, ast=${perGame.ast.toFixed(1)}`);
    console.log(`[team-defensive-stats] Verification: ${totalPts} / ${gameCount} = ${perGame.pts.toFixed(1)}`);

    const payload = {
      success: true,
      team,
      season: seasonYear,
      sample_games: gameCount,
      perGame,
    };

    // Only cache successful responses (defensive stats update after games)
    if (gameCount > 0) {
      cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
    }
    
    return NextResponse.json(payload);
  } catch (e: any) {
    console.error(`[team-defensive-stats] Error fetching stats for ${rawTeam}:`, e);
    console.error(`[team-defensive-stats] Error details:`, {
      message: e?.message,
      stack: e?.stack,
      team: rawTeam,
      normalizedTeam: normalizeAbbr(rawTeam || ''),
      season: seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason(),
    });
    // Return 200 with success: false so the component can read the error message
    // Don't cache error responses
    return NextResponse.json({ 
      success: false, 
      error: e?.message || 'Failed to get team defensive stats',
      team: rawTeam || '',
      season: seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason(),
      sample_games: 0,
      perGame: {
        pts: 0, reb: 0, ast: 0, fg_pct: 0, fg3_pct: 0, stl: 0, blk: 0
      }
    });
  }
}
