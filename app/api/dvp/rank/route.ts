export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';
import { normalizeAbbr, NBA_TEAMS } from '@/lib/nbaAbbr';
import { fetchBettingProsData, OUR_TO_BP_ABBR, OUR_TO_BP_METRIC } from '@/lib/bettingpros-dvp';

export const runtime = 'nodejs';

function currentNbaSeason(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

const POS = new Set(['PG','SG','SF','PF','C']);
const METRICS = new Set(['pts','reb','ast','fg3m','fg3a','fga','fgm','fg_pct','fg3_pct','stl','blk','to']);
// Combined stats that need to be calculated from component stats
const COMBINED_STATS = {
  'pra': ['pts', 'reb', 'ast'],  // Points + Rebounds + Assists
  'pa': ['pts', 'ast'],          // Points + Assists
  'pr': ['pts', 'reb'],          // Points + Rebounds
  'ra': ['reb', 'ast'],          // Rebounds + Assists
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const metric = (searchParams.get('metric') || 'pts').toLowerCase();
    const pos = String(searchParams.get('pos') || '').toUpperCase();
    const games = Math.min(parseInt(searchParams.get('games') || '82', 10) || 82, 82);
    const seasonParam = searchParams.get('season');
    const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();
    const forceRefresh = searchParams.get('refresh') === '1';

    // Check if it's a combined stat
    const isCombinedStat = COMBINED_STATS[metric as keyof typeof COMBINED_STATS];
    
    if (!METRICS.has(metric) && !isCombinedStat) {
      return NextResponse.json({ success: false, error: `unsupported metric: ${metric}` }, { status: 400 });
    }
    if (!POS.has(pos)) {
      return NextResponse.json({ success: false, error: `unsupported pos: ${pos}` }, { status: 400 });
    }

    const cacheKey = `dvp_rank:${metric}:${pos}:${seasonYear}:${games}`;
    
    // Check cache
    if (!forceRefresh) {
      const hit = cache.get<any>(cacheKey);
      if (hit) {
        return NextResponse.json(hit);
      }
    }

    // Fetch BettingPros data (with caching)
    const bpData = await fetchBettingProsData(forceRefresh);
    
    if (!bpData || !bpData.teamStats) {
      console.error('[DVP Rank API] No BettingPros data available');
      return NextResponse.json({ success: false, error: 'No BettingPros data available' }, { status: 500 });
    }
    
    const teams = Object.keys(NBA_TEAMS);
    
    // Get values for all teams
    let results: Array<{ team: string; value: number | null }>;
    
    if (isCombinedStat) {
      // For combined stats, sum the component stat values
      const componentMetrics = isCombinedStat;
      console.log(`[DVP Rank API] Calculating combined stat ${metric} from components: ${componentMetrics.join(', ')}`);
      
      results = teams.map((t) => {
        try {
          const teamAbbr = normalizeAbbr(t);
          const bpTeamAbbr = OUR_TO_BP_ABBR[teamAbbr] || teamAbbr;
          
          const teamStats = bpData.teamStats?.[bpTeamAbbr];
          if (!teamStats) {
            return { team: t, value: null };
          }

          const positionData = teamStats[pos] || teamStats['ALL'];
          if (!positionData) {
            return { team: t, value: null };
          }

          // Sum the component stat values
          let combinedValue: number | null = null;
          let hasAllComponents = true;
          
          for (const componentMetric of componentMetrics) {
            const bpComponentMetric = OUR_TO_BP_METRIC[componentMetric] || componentMetric;
            const componentValue = positionData[bpComponentMetric];
            
            if (componentValue === undefined || componentValue === null) {
              hasAllComponents = false;
              break;
            }
            
            const numValue = Number(componentValue);
            if (isNaN(numValue)) {
              hasAllComponents = false;
              break;
            }
            
            if (combinedValue === null) {
              combinedValue = numValue;
            } else {
              combinedValue += numValue;
            }
          }
          
          return { team: t, value: hasAllComponents ? combinedValue : null };
        } catch (e: any) {
          console.error(`[DVP Rank API] Error processing team ${t}:`, e);
          return { team: t, value: null };
        }
      });
    } else {
      // For regular stats, use existing logic
      const bpMetric = OUR_TO_BP_METRIC[metric] || metric;
      
      results = teams.map((t) => {
        try {
          const teamAbbr = normalizeAbbr(t);
          const bpTeamAbbr = OUR_TO_BP_ABBR[teamAbbr] || teamAbbr;
          
          const teamStats = bpData.teamStats?.[bpTeamAbbr];
          if (!teamStats) {
            return { team: t, value: null };
          }

          const positionData = teamStats[pos] || teamStats['ALL'];
          if (!positionData) {
            return { team: t, value: null };
          }

          const value = positionData[bpMetric];
          return { team: t, value: value !== undefined ? Number(value) : null };
        } catch (e: any) {
          console.error(`[DVP Rank API] Error processing team ${t}:`, e);
          return { team: t, value: null };
        }
      });
    }

    // Compute ranks: lower value -> rank 1, higher value -> rank 30
    const valid = results.filter(r => r.value != null) as Array<{team: string, value: number}>;
    valid.sort((a, b) => (a.value - b.value));
    const ranks: Record<string, number> = {};
    valid.forEach((r, idx) => { 
      const normalizedTeam = normalizeAbbr(r.team);
      ranks[normalizedTeam] = idx + 1;
    });
    // Include nulls as 0 rank
    results.filter(r => r.value == null).forEach(r => { 
      const normalizedTeam = normalizeAbbr(r.team);
      ranks[normalizedTeam] = 0;
    });
    
    // Debug: log a few ranks to verify they're being created
    console.log(`[DVP Rank] Created ranks for ${metric} vs ${pos}:`, Object.keys(ranks).slice(0, 5).map(k => `${k}:${ranks[k]}`).join(', '), '...');

    const payload = {
      success: true,
      source: 'bettingpros',
      metric,
      pos,
      season: seasonYear,
      games,
      ranks,
      values: results.map(r => ({ team: normalizeAbbr(r.team), value: r.value }))
    };
    cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
    return NextResponse.json(payload);
  } catch (e: any) {
    console.error('[DVP Rank API] Error:', e);
    return NextResponse.json({ success: false, error: e?.message || 'rank failed' }, { status: 500 });
  }
}