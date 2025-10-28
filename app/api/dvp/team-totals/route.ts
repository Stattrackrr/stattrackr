import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import cache, { CACHE_TTL } from '@/lib/cache';

export const runtime = 'nodejs';

function currentNbaSeason(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Get team-level defensive stats (total points/reb/ast allowed per game)
 * Query params:
 * - team: Team abbreviation (e.g., "LAL")
 * - games: Number of games (default: 82)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const team = searchParams.get('team');
    const games = Math.min(parseInt(searchParams.get('games') || '82', 10) || 82, 82);
    const seasonParam = searchParams.get('season');
    const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();

    if (!team) {
      return NextResponse.json({ error: 'Missing team parameter' }, { status: 400 });
    }

    const cacheKey = `dvp_team_totals:${team}:${seasonYear}:${games}`;
    const hit = cache.get<any>(cacheKey);
    if (hit) return NextResponse.json(hit);

    const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(seasonYear));
    const filePath = path.join(storeDir, `${team}.json`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'No data for this team' }, { status: 404 });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Sort by date descending and take requested number of games
    const sorted = [...data].sort((a: any, b: any) => 
      new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    ).slice(0, games);

    // Aggregate stats across all games
    let totalPts = 0, totalReb = 0, totalAst = 0;
    let totalFgm = 0, totalFga = 0;
    let totalFg3m = 0, totalFg3a = 0;
    let totalStl = 0, totalBlk = 0;
    let gameCount = 0;

    for (const game of sorted) {
      const players = game.players || [];
      
      for (const player of players) {
        totalPts += Number(player.pts || 0);
        totalReb += Number(player.reb || 0);
        totalAst += Number(player.ast || 0);
        totalFgm += Number(player.fgm || 0);
        totalFga += Number(player.fga || 0);
        totalFg3m += Number(player.fg3m || 0);
        totalFg3a += Number(player.fg3a || 0);
        totalStl += Number(player.stl || 0);
        totalBlk += Number(player.blk || 0);
      }
      
      gameCount++;
    }

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
