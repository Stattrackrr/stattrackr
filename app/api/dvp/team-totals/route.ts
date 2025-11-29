export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';
import { normalizeAbbr } from '@/lib/nbaAbbr';

export const runtime = 'nodejs';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const BDL_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'StatTrackr/1.0',
  Authorization: `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
};

const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
  ATL: 1, BOS: 2, BKN: 3, CHA: 4, CHI: 5, CLE: 6, DAL: 7, DEN: 8, DET: 9, GSW: 10,
  HOU: 11, IND: 12, LAC: 13, LAL: 14, MEM: 15, MIA: 16, MIL: 17, MIN: 18, NOP: 19, NYK: 20,
  OKC: 21, ORL: 22, PHI: 23, PHX: 24, POR: 25, SAC: 26, SAS: 27, TOR: 28, UTA: 29, WAS: 30,
};

async function bdlFetch(url: string) {
  const res = await fetch(url, { headers: BDL_HEADERS, cache: 'no-store' });
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
 * Get team-level offensive stats (total points/reb/ast scored per game)
 * Query params:
 * - team: Team abbreviation (e.g., "LAL")
 * - games: Number of games (default: 82)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawTeam = searchParams.get('team');
    if (!rawTeam) {
      return NextResponse.json({ error: 'Missing team parameter' }, { status: 400 });
    }
    
    const team = normalizeAbbr(rawTeam);
    const games = Math.min(parseInt(searchParams.get('games') || '82', 10) || 82, 82);
    const seasonParam = searchParams.get('season');
    const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();

    const teamId = ABBR_TO_TEAM_ID_BDL[team];
    if (!teamId) {
      return NextResponse.json({ error: `Unknown team: ${team}` }, { status: 400 });
    }

    const cacheKey = `team_offensive_totals:${team}:${seasonYear}:${games}`;
    const hit = cache.get<any>(cacheKey);
    if (hit) return NextResponse.json(hit);

    // Fetch games for this team in the season
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.append('seasons[]', String(seasonYear));
    gamesUrl.searchParams.append('team_ids[]', String(teamId));

    const gamesJson = await bdlFetch(gamesUrl.toString());
    const allGames: any[] = Array.isArray(gamesJson?.data) ? gamesJson.data : [];
    
    // Filter to completed games and sort by date descending
    const completedGames = allGames
      .filter((g: any) => String(g?.status || '').toLowerCase().includes('final'))
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, games);

    if (completedGames.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'No completed games found for this team' 
      }, { status: 404 });
    }

    // Fetch stats for all games
    const gameIds = completedGames.map((g: any) => String(g.id)).filter(Boolean);
    
    // Fetch stats in batches (BDL API limit is 100 per page)
    const allStats: any[] = [];
    for (let i = 0; i < gameIds.length; i += 100) {
      const batch = gameIds.slice(i, i + 100);
      const statsUrl = new URL(`${BDL_BASE}/stats`);
      batch.forEach(id => statsUrl.searchParams.append('game_ids[]', id));
      statsUrl.searchParams.set('per_page', '100');
      
      const statsJson = await bdlFetch(statsUrl.toString());
      const stats: any[] = Array.isArray(statsJson?.data) ? statsJson.data : [];
      allStats.push(...stats);
    }

    // Aggregate stats for this team only (not opponents)
    let totalPts = 0, totalReb = 0, totalAst = 0;
    let totalFgm = 0, totalFga = 0;
    let totalFg3m = 0, totalFg3a = 0;
    let totalStl = 0, totalBlk = 0;
    const gameStatsMap = new Map<number, { pts: number; reb: number; ast: number; fgm: number; fga: number; fg3m: number; fg3a: number; stl: number; blk: number }>();

    // Group stats by game and team
    for (const stat of allStats) {
      const gameId = stat?.game?.id;
      const statTeamId = stat?.team?.id;
      
      if (!gameId || statTeamId !== teamId) continue; // Only include stats for this team
      
      if (!gameStatsMap.has(gameId)) {
        gameStatsMap.set(gameId, { pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, stl: 0, blk: 0 });
      }
      
      const gameStats = gameStatsMap.get(gameId)!;
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
    for (const gameStats of gameStatsMap.values()) {
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

    const gameCount = gameStatsMap.size;

    // Calculate per-game averages
    const perGame = {
      pts: gameCount > 0 ? totalPts / gameCount : 0,
      reb: gameCount > 0 ? totalReb / gameCount : 0,
      ast: gameCount > 0 ? totalAst / gameCount : 0,
      fgm: gameCount > 0 ? totalFgm / gameCount : 0,
      fga: gameCount > 0 ? totalFga / gameCount : 0,
      fg_pct: totalFga > 0 ? (totalFgm / totalFga) * 100 : 0,
      fg3m: gameCount > 0 ? totalFg3m / gameCount : 0,
      fg3a: gameCount > 0 ? totalFg3a / gameCount : 0,
      fg3_pct: totalFg3a > 0 ? (totalFg3m / totalFg3a) * 100 : 0,
      stl: gameCount > 0 ? totalStl / gameCount : 0,
      blk: gameCount > 0 ? totalBlk / gameCount : 0,
    };

    const payload = {
      success: true,
      team,
      season: seasonYear,
      sample_games: gameCount,
      perGame,
      totals: {
        pts: totalPts,
        reb: totalReb,
        ast: totalAst,
        fgm: totalFgm,
        fga: totalFga,
        fg3m: totalFg3m,
        fg3a: totalFg3a,
        stl: totalStl,
        blk: totalBlk,
      }
    };

    cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Failed to get team totals' }, { status: 500 });
  }
}
