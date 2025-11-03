export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';
import { normalizeAbbr, NBA_TEAMS } from '@/lib/nbaAbbr';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

function getOrigin(req: NextRequest): string {
  try { if ((req as any)?.nextUrl?.origin) return (req as any).nextUrl.origin; } catch {}
  const xfProto = req.headers.get('x-forwarded-proto');
  const xfHost = req.headers.get('x-forwarded-host');
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`;
  const host = req.headers.get('host') || 'localhost:3000';
  const proto = (process.env.NODE_ENV === 'production') ? 'https' : 'http';
  return `${proto}://${host}`;
}

function currentNbaSeason(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

const POS = new Set(['PG','SG','SF','PF','C']);
const METRICS = new Set(['pts','reb','ast','fg3m','fg3a','fga','fgm','fg_pct','fg3_pct','stl','blk']);

function getMetricValue(player: any, metric: string): number {
  switch (metric) {
    case 'pts': return Number(player?.pts || 0);
    case 'reb': return Number(player?.reb || 0);
    case 'ast': return Number(player?.ast || 0);
    case 'fg3m': return Number(player?.fg3m || 0);
    case 'fg3a': return Number(player?.fg3a || 0);
    case 'fga': return Number(player?.fga || 0);
    case 'fgm': return Number(player?.fgm || 0);
    case 'fg_pct': {
      const fgm = Number(player?.fgm || 0);
      const fga = Number(player?.fga || 0);
      return fga > 0 ? (fgm / fga) * 100 : 0;
    }
    case 'fg3_pct': {
      const fg3m = Number(player?.fg3m || 0);
      const fg3a = Number(player?.fg3a || 0);
      return fg3a > 0 ? (fg3m / fg3a) * 100 : 0;
    }
    case 'stl': return Number(player?.stl || 0);
    case 'blk': return Number(player?.blk || 0);
    default: return 0;
  }
}

export async function GET(req: NextRequest){
  try{
    const { searchParams } = new URL(req.url);
    const metric = (searchParams.get('metric') || 'pts').toLowerCase();
    const pos = String(searchParams.get('pos') || '').toUpperCase();
    const games = Math.min(parseInt(searchParams.get('games') || '82',10) || 82, 82);
    const seasonParam = searchParams.get('season');
    const seasonYear = seasonParam ? parseInt(seasonParam,10) : currentNbaSeason();

    if (!METRICS.has(metric)){
      return NextResponse.json({ success:false, error:`unsupported metric: ${metric}` }, { status: 400 });
    }
    if (!POS.has(pos)){
      return NextResponse.json({ success:false, error:`unsupported pos: ${pos}` }, { status: 400 });
    }

    const cacheKey = `dvp_rank:${metric}:${pos}:${seasonYear}:${games}`;
    const hit = cache.get<any>(cacheKey);
    if (hit) return NextResponse.json(hit);

    const teams = Object.keys(NBA_TEAMS);
    const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(seasonYear));

    // Read directly from stored files instead of making API calls
    const results = teams.map((t) => {
      try {
        const teamAbbr = normalizeAbbr(t);
        const filePath = path.join(storeDir, `${teamAbbr}.json`);
        
        if (!fs.existsSync(filePath)) {
          return { team: t, value: null };
        }
        
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Sort by date descending and take requested number of games
        const sorted = [...data].sort((a: any, b: any) => 
          new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
        ).slice(0, games);
        
        // Calculate per-game average for this position
        const isPercentageMetric = metric === 'fg_pct' || metric === 'fg3_pct';
        let total = 0;
        let attempts = 0;
        let count = 0;
        
        for (const game of sorted) {
          const players = game.players || [];
          for (const player of players) {
            if (player.bucket === pos) {
              if (isPercentageMetric) {
                // For percentages, track makes and attempts
                if (metric === 'fg_pct') {
                  total += Number(player?.fgm || 0);
                  attempts += Number(player?.fga || 0);
                } else {
                  total += Number(player?.fg3m || 0);
                  attempts += Number(player?.fg3a || 0);
                }
              } else {
                const value = getMetricValue(player, metric);
                total += value;
              }
            }
          }
          count++;
        }
        
        let avg: number | null;
        if (isPercentageMetric) {
          // For percentages: (total makes / total attempts) * 100
          avg = attempts > 0 ? (total / attempts) * 100 : null;
        } else {
          avg = count > 0 ? total / count : null;
        }
        return { team: t, value: avg };
      } catch {
        return { team: t, value: null };
      }
    });

    // Compute ranks: lower value -> rank 1, higher value -> rank 30
    const valid = results.filter(r => r.value != null) as Array<{team:string, value:number}>;
    valid.sort((a,b)=> (a.value - b.value));
    const ranks: Record<string, number> = {};
    valid.forEach((r, idx) => { ranks[normalizeAbbr(r.team)] = idx + 1; });
    // Include nulls as 0 rank
    results.filter(r => r.value == null).forEach(r => { ranks[normalizeAbbr(r.team)] = 0; });

    const payload = {
      success: true,
      metric,
      pos,
      season: seasonYear,
      games,
      ranks,
      values: results.map(r => ({ team: normalizeAbbr(r.team), value: r.value }))
    };
    cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
    return NextResponse.json(payload);
  }catch(e:any){
    return NextResponse.json({ success:false, error: e?.message || 'rank failed' }, { status: 200 });
  }
}
