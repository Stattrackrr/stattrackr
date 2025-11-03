export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import cache, { CACHE_TTL } from '@/lib/cache';
import { NBA_TEAMS } from '@/lib/nbaAbbr';

export const runtime = 'nodejs';

function currentNbaSeason(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Get team-level defensive rankings across all teams
 * Query params:
 * - metric: pts, reb, ast, fg_pct, fg3_pct, stl, blk
 * - games: Number of games (default: 82)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const metric = searchParams.get('metric') || 'pts';
    const games = Math.min(parseInt(searchParams.get('games') || '82', 10) || 82, 82);
    const seasonParam = searchParams.get('season');
    const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();

    const validMetrics = ['pts', 'reb', 'ast', 'fg_pct', 'fg3_pct', 'stl', 'blk'];
    if (!validMetrics.includes(metric)) {
      return NextResponse.json({ error: 'Invalid metric' }, { status: 400 });
    }

    const cacheKey = `dvp_team_rank:${metric}:${seasonYear}:${games}`;
    const hit = cache.get<any>(cacheKey);
    if (hit) return NextResponse.json(hit);

    const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(seasonYear));
    const teams = Object.keys(NBA_TEAMS);
    
    const results: Array<{ team: string, value: number | null }> = [];

    for (const team of teams) {
      const filePath = path.join(storeDir, `${team}.json`);
      
      if (!fs.existsSync(filePath)) {
        results.push({ team, value: null });
        continue;
      }

      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const sorted = [...data].sort((a: any, b: any) => 
          new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
        ).slice(0, games);

        let total = 0;
        let totalMakes = 0;
        let totalAttempts = 0;
        let gameCount = 0;

        for (const game of sorted) {
          const players = game.players || [];
          
          for (const player of players) {
            if (metric === 'fg_pct') {
              totalMakes += Number(player.fgm || 0);
              totalAttempts += Number(player.fga || 0);
            } else if (metric === 'fg3_pct') {
              totalMakes += Number(player.fg3m || 0);
              totalAttempts += Number(player.fg3a || 0);
            } else {
              total += Number(player[metric] || 0);
            }
          }
          
          gameCount++;
        }

        let value: number | null;
        if (metric === 'fg_pct' || metric === 'fg3_pct') {
          value = totalAttempts > 0 ? (totalMakes / totalAttempts) * 100 : null;
        } else {
          value = gameCount > 0 ? total / gameCount : null;
        }

        results.push({ team, value });
      } catch {
        results.push({ team, value: null });
      }
    }

    // Sort by value (lower is better for defense)
    const valid = results.filter(r => r.value != null) as Array<{ team: string, value: number }>;
    valid.sort((a, b) => a.value - b.value);

    const ranks: Record<string, number> = {};
    valid.forEach((r, idx) => {
      ranks[r.team] = idx + 1;
    });

    // Include nulls as 0 rank
    results.filter(r => r.value == null).forEach(r => {
      ranks[r.team] = 0;
    });

    const payload = {
      success: true,
      metric,
      season: seasonYear,
      games,
      ranks,
      values: results.map(r => ({ team: r.team, value: r.value }))
    };

    cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Failed to rank teams' }, { status: 500 });
  }
}
