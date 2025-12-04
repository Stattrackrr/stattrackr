export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import cache, { CACHE_TTL } from "@/lib/cache";
import { normalizeAbbr } from "@/lib/nbaAbbr";
import { TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID, currentNbaSeason } from "@/lib/nbaConstants";
import { checkRateLimit } from "@/lib/rateLimit";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

// Ball Don't Lie base and auth
const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "StatTrackr/1.0",
  };
  if (!API_KEY) {
    throw new Error('BALLDONTLIE_API_KEY environment variable is not configured');
  }
  h["Authorization"] = `Bearer ${API_KEY}`;
  return h;
}

// Team mappings imported from shared constants

// Helper: normalize names similar to depth-chart route (strip suffixes)
function normName(s: string) {
  if (!s) return '';
  const base = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ') // drop punctuation to spaces (.,-', etc.)
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Collapse spaced initials in given names: "a j green" -> "aj green", "c j mccollum" -> "cj mccollum"
  const parts = base.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1);
    let acc = '';
    const out: string[] = [];
    for (const w of first) {
      if (w.length === 1) acc += w; else { if (acc) { out.push(acc); acc = ''; } out.push(w); }
    }
    if (acc) out.push(acc);
    out.push(last);
    return out.join(' ');
  }
  return base;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...(init || {}), headers: { ...(init?.headers || {}), ...authHeaders() }, cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${txt || url}`);
  }
  return res.json();
}

// Fetch depth chart for a team (returns mapping name -> bucket)
async function fetchDepthChartBuckets(teamAbbr: string, host?: string): Promise<Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>> {
  try {
    const t = normalizeAbbr(teamAbbr);
    const base = host ? `http://${host}` : (process.env.NEXT_PUBLIC_BASE_URL || '');
    const url = base ? `${base}/api/depth-chart?team=${encodeURIComponent(t)}` : `/api/depth-chart?team=${encodeURIComponent(t)}`;
    const res = await fetch(url);
    if (!res.ok) return {} as any;
    const js = await res.json().catch(() => ({}));
    const dc = js?.depthChart || {};
    const map: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = {};
    (['PG','SG','SF','PF','C'] as const).forEach((k) => {
      const arr = Array.isArray(dc[k]) ? dc[k] : [];
      arr.forEach((p: any) => { const name = typeof p === 'string' ? p : p?.name; if (name) map[normName(name)] = k; });
    });
    return map;
  } catch {
    return {} as any;
  }
}

// Compute DvP for a team (group totals per game, then average across games)
// Compute DvP for a team (group totals per game, then average across games)
export async function GET(req: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }
  
  try {
    const { searchParams } = new URL(req.url);
    const rawTeam = searchParams.get('team') || '';
    const team = normalizeAbbr(rawTeam);
    const metric = (searchParams.get('metric') || 'pts').toLowerCase();
    const seasonParam = searchParams.get('season');
    const limitGames = Math.min(parseInt(searchParams.get('games') || '20', 10) || 20, 82);
    const wantDebug = searchParams.get('debug') === '1';
    const forceRefresh = searchParams.get('refresh') === '1';
    const splitParam = searchParams.get('split') || '';
    const wantSplit = splitParam === '1' || splitParam === 'order' || splitParam === 'starters';
    const debug: any[] | undefined = wantDebug ? [] : undefined;

    // Metrics supported by stored dvp_store snapshots (others will be computed live via BDL)
    const STORE_SUPPORTED = new Set(['pts', 'reb', 'ast', 'fg3m', 'fg3a', 'fga', 'fgm', 'fg_pct', 'fg3_pct', 'stl', 'blk']);

    // Hot-load custom positions and aliases on every call
    const CUSTOM = await loadCustomPositions();
    const ALIASES = { ...(CUSTOM.aliases || {}) } as Record<string, string>;
    const CUSTOM_POSITIONS = CUSTOM.positions || {} as Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>;

    if (!team) {
      return NextResponse.json({ success: false, error: 'Missing team' }, { status: 400 });
    }
    const teamId = ABBR_TO_TEAM_ID[team];
    if (!teamId) {
      return NextResponse.json({ success: false, error: `Unknown team: ${team}` }, { status: 400 });
    }

    // Cache key
    const seasonYear = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();

    // Prefer stored per-game buckets if present
    const storeFile = await (async () => {
      const dir = path.resolve(process.cwd(), 'data', 'dvp_store', String(seasonYear));
      const file = path.join(dir, `${team}.json`);
      try {
        await fs.access(file);
        return file;
      } catch {
        return null;
      }
    })();

    // Cache key - note: custom positions are now only used as fallback, so stored game positions take priority
    // Cache is based on stored game data, not custom positions (since we respect per-game positions)
    const cacheKey = `dvp:${team}:${seasonYear}:${metric}:${limitGames}:split=${wantSplit?1:0}`;
    
    // Check cache, but also verify file hasn't been updated recently
    // If file was modified in the last 2 hours, invalidate cache to ensure fresh data
    if (!forceRefresh && storeFile) {
      const hit = cache.get<any>(cacheKey);
      if (hit) {
        try {
          // Check file modification time - if file was modified recently, invalidate cache
          const stats = await fs.stat(storeFile);
          const fileModifiedTime = stats.mtime.getTime();
          const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
          
          // If file was modified in last 2 hours, it likely has new game data
          // Invalidate cache to ensure dashboard shows latest DvP stats
          if (fileModifiedTime > twoHoursAgo) {
            cache.delete(cacheKey);
            if (process.env.NODE_ENV !== 'production') {
              console.log(`[DvP API] Cache invalidated for ${team} - file modified ${Math.round((Date.now() - fileModifiedTime) / 60000)} minutes ago`);
            }
          } else {
            // File hasn't been modified recently, use cached data
            return NextResponse.json(hit);
          }
        } catch (e) {
          // If we can't check file stats, use cached data anyway
          return NextResponse.json(hit);
        }
      }
    } else if (!forceRefresh) {
      const hit = cache.get<any>(cacheKey);
      if (hit) return NextResponse.json(hit);
    }

// Optional name alias map to fix edge cases (populate as needed)
let NAME_ALIASES: Record<string, string> = {
  // 'kenyon martin jr': 'kj martin',
};

// Load custom positions from data/player_positions/master.json if present
async function loadCustomPositions(): Promise<{ positions: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>, aliases: Record<string, string> }> {
  try {
    const dir = path.resolve(process.cwd(), 'data', 'player_positions');
    const masterPath = path.join(dir, 'master.json');
    let positions: Record<string, any> = {};
    let aliases: Record<string, string> = {};
    try {
      const raw = await fs.readFile(masterPath, 'utf8');
      const j = JSON.parse(raw);
      positions = { ...(j?.positions || {}) };
      aliases = { ...(j?.aliases || {}) };
    } catch {}
    const teamsDir = path.join(dir, 'teams');
    try {
      const files = (await fs.readdir(teamsDir)).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const raw = await fs.readFile(path.join(teamsDir, f), 'utf8');
          const j = JSON.parse(raw);
          const teamPos = j?.positions || {};
          for (const [k, v] of Object.entries(teamPos)) {
            const key = normName(k);
            if (['PG','SG','SF','PF','C'].includes(String(v))) {
              (positions as any)[key] = v as any;
            }
          }
          const teamAliases = j?.aliases || {};
          for (const [k, v] of Object.entries(teamAliases)) {
            aliases[normName(k)] = normName(String(v));
          }
        } catch {}
      }
    } catch {}
    return { positions: positions as any, aliases };
  } catch {
    return { positions: {}, aliases: NAME_ALIASES };
  }
}

    if (storeFile && STORE_SUPPORTED.has(metric)) {
      try {
        const arr = JSON.parse(await fs.readFile(storeFile, 'utf8')) as any[];
        // newest first
        const sorted = [...arr].sort((a,b)=> new Date(b.date||0).getTime()-new Date(a.date||0).getTime()).slice(0, limitGames);
        
        // For percentage metrics, track makes and attempts separately
        const isPercentageMetric = metric === 'fg_pct' || metric === 'fg3_pct';
        const totalsAll = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        const totalsStarters = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        const totalsBench = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        const attemptsAll = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        const attemptsStarters = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        const attemptsBench = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        let processedGames = 0;
        const traceOn = searchParams.get('trace') === '1';
        const trace: any[] = [];
        const metricFrom = (p: any) => {
          switch (metric) {
            case 'reb': return Number(p?.reb||0);
            case 'ast': return Number(p?.ast||0);
            case 'fg3m': return Number(p?.fg3m||0);
            case 'fg3a': return Number(p?.fg3a||0);
            case 'fga': return Number(p?.fga||0);
            case 'fgm': return Number(p?.fgm||0);
            case 'stl': return Number(p?.stl||0);
            case 'blk': return Number(p?.blk||0);
            default: return Number(p?.pts||0);
          }
        };
        // Fetch depth chart for the opponent team (for fallback position assignment)
        const opponentAbbr = sorted[0]?.opponent || '';
        const host = req.headers.get('host') || undefined;
        let depthChartMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = {};
        if (opponentAbbr) {
          try {
            depthChartMap = await fetchDepthChartBuckets(opponentAbbr, host).catch(() => ({}));
          } catch {}
        }
        
        for (const g of sorted){
          const players = Array.isArray(g?.players) ? g.players : [];
          const gameAll = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
          const gameStarters = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
          const gameBench = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
          const gameAttAll = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
          const gameAttStarters = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
          const gameAttBench = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
          
          let playersWithoutBucket = 0;
          let totalPlayers = players.length;
          
          for (const p of players){
            // Use stored bucket from game data (respects historical positions per game)
            let b = p?.bucket as 'PG'|'SG'|'SF'|'PF'|'C';
            
            // Only use custom position as fallback if stored bucket is missing/invalid
            // This preserves per-game position changes (e.g., PG in game 1, SG in game 2)
            if (!b || !['PG','SG','SF','PF','C'].includes(b)) {
              if (p?.name) {
                const nameKey = normName(String(p.name));
                const canonicalName = ALIASES[nameKey] || nameKey;
                const lookupKey = ALIASES[canonicalName] || canonicalName;
                
                // Check custom positions (master or team-specific) only as fallback
                if (CUSTOM_POSITIONS[lookupKey] && ['PG','SG','SF','PF','C'].includes(CUSTOM_POSITIONS[lookupKey])) {
                  b = CUSTOM_POSITIONS[lookupKey];
                } else if (CUSTOM_POSITIONS[canonicalName] && ['PG','SG','SF','PF','C'].includes(CUSTOM_POSITIONS[canonicalName])) {
                  b = CUSTOM_POSITIONS[canonicalName];
                } else if (CUSTOM_POSITIONS[nameKey] && ['PG','SG','SF','PF','C'].includes(CUSTOM_POSITIONS[nameKey])) {
                  b = CUSTOM_POSITIONS[nameKey];
                } else if (depthChartMap[nameKey] || depthChartMap[canonicalName] || depthChartMap[lookupKey]) {
                  // Final fallback: use depth chart position
                  b = depthChartMap[nameKey] || depthChartMap[canonicalName] || depthChartMap[lookupKey];
                }
              }
            }
            
            if (!b) {
              playersWithoutBucket++;
              continue;
            }
            
            // Skip players who didn't play (0 minutes) - they shouldn't count in DVP
            const minutesPlayed = String(p?.min || '0:00').trim();
            let totalMinutes = 0;
            if (minutesPlayed.includes(':')) {
              const parts = minutesPlayed.split(':');
              totalMinutes = (Number(parts[0]) || 0) + ((Number(parts[1]) || 0) / 60);
            } else {
              totalMinutes = Number(minutesPlayed) || 0;
            }
            
            if (totalMinutes < 0.01) {
              // Player didn't play - skip them
              continue;
            }
            
            if (isPercentageMetric) {
              // For percentages, track makes and attempts
              const makes = metric === 'fg_pct' ? Number(p?.fgm||0) : Number(p?.fg3m||0);
              const attempts = metric === 'fg_pct' ? Number(p?.fga||0) : Number(p?.fg3a||0);
              gameAll[b] += makes;
              gameAttAll[b] += attempts;
              if (wantSplit && typeof p?.isStarter === 'boolean') {
                if (p.isStarter) { gameStarters[b] += makes; gameAttStarters[b] += attempts; }
                else { gameBench[b] += makes; gameAttBench[b] += attempts; }
              }
            } else {
              const v = metricFrom(p);
              gameAll[b] += v;
              if (wantSplit && typeof p?.isStarter === 'boolean') {
                if (p.isStarter) gameStarters[b] += v; else gameBench[b] += v;
              }
            }
          }
          
          (['PG','SG','SF','PF','C'] as const).forEach(k=> {
            totalsAll[k]+=gameAll[k];
            if (isPercentageMetric) attemptsAll[k]+=gameAttAll[k];
            if (wantSplit) {
              totalsStarters[k]+=gameStarters[k];
              totalsBench[k]+=gameBench[k];
              if (isPercentageMetric) {
                attemptsStarters[k]+=gameAttStarters[k];
                attemptsBench[k]+=gameAttBench[k];
              }
            }
          });
          processedGames++;
          
          // Log warning if too many players are missing buckets (indicates data quality issue)
          if (playersWithoutBucket > totalPlayers * 0.2 && wantDebug) {
            debug?.push(`Game ${g.gameId || g.date} (vs ${g.opponent}): ${playersWithoutBucket}/${totalPlayers} players (${Math.round(playersWithoutBucket/totalPlayers*100)}%) missing position buckets`);
          }
          
          if (traceOn) {
            const playersSorted = [...players].sort((a: any, b: any) => Number(b?.pts||0) - Number(a?.pts||0));
            trace.push({ gameId: g.gameId, date: g.date, opponent: g.opponent, buckets: wantSplit? { all: gameAll, starters: gameStarters, bench: gameBench } : gameAll, players: playersSorted, playersWithoutBucket, totalPlayers });
          }
        }
        
        // Log summary warning if many games have missing buckets
        if (wantDebug && processedGames > 0) {
          const avgMissing = (playersWithoutBucket / totalPlayers) * 100;
          if (avgMissing > 20) {
            debug?.push(`WARNING: ${Math.round(avgMissing)}% of players missing position buckets across ${processedGames} games. DVP numbers may be inaccurate. Consider re-ingesting data.`);
          }
        }
        const perGameAll = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        const perGameStarters = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        const perGameBench = { PG:0, SG:0, SF:0, PF:0, C:0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
        if (processedGames>0){
          (['PG','SG','SF','PF','C'] as const).forEach(k=> {
            if (isPercentageMetric) {
              // For percentages: calculate as (total makes / total attempts) * 100
              perGameAll[k] = attemptsAll[k] > 0 ? (totalsAll[k] / attemptsAll[k]) * 100 : 0;
              if (wantSplit) {
                perGameStarters[k] = attemptsStarters[k] > 0 ? (totalsStarters[k] / attemptsStarters[k]) * 100 : 0;
                perGameBench[k] = attemptsBench[k] > 0 ? (totalsBench[k] / attemptsBench[k]) * 100 : 0;
              }
            } else {
              perGameAll[k]= totalsAll[k]/processedGames;
              if (wantSplit){ perGameStarters[k]= totalsStarters[k]/processedGames; perGameBench[k]= totalsBench[k]/processedGames; }
            }
          });
        }
        const payload: any = wantSplit ? 
          { success:true, team, season: seasonYear, metric, sample_games: processedGames,
            perGame: { all: perGameAll, starters: perGameStarters, bench: perGameBench },
            totals: { all: totalsAll, starters: totalsStarters, bench: totalsBench } }
          : { success:true, team, season: seasonYear, metric, sample_games: processedGames, perGame: perGameAll, totals: totalsAll };
        if (traceOn) payload.trace = trace;
        if (wantDebug && debug) payload.debug = debug;
        cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
        return NextResponse.json(payload, { status: 200 });
      } catch {}
    }

    // 1) Fetch season games for this team
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.append('seasons[]', String(seasonYear));
    gamesUrl.searchParams.append('team_ids[]', String(teamId));

    let gamesJson = await fetchJson(gamesUrl.toString());
    let games: any[] = Array.isArray(gamesJson?.data) ? gamesJson.data : [];
    let completed = games.filter(g => String(g?.status || '').toLowerCase().includes('final'));
    // Fallback: if no completed games yet (early season), try previous season
    if (completed.length === 0) {
      const prevSeason = seasonYear - 1;
      const prevUrl = new URL(`${BDL_BASE}/games`);
      prevUrl.searchParams.set('per_page', '100');
      prevUrl.searchParams.append('seasons[]', String(prevSeason));
      prevUrl.searchParams.append('team_ids[]', String(teamId));
      try {
        const prevJs = await fetchJson(prevUrl.toString());
        const prevGames = Array.isArray(prevJs?.data) ? prevJs.data : [];
        const prevCompleted = prevGames.filter((g: any) => String(g?.status || '').toLowerCase().includes('final'));
        if (prevCompleted.length) completed = prevCompleted;
      } catch {}
    }
    // Sort newest-first by date and limit
    completed.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    const picked = completed.slice(0, limitGames);

    // Group by opponent team to prefetch depth charts
    const uniqueOppIds = new Set<number>();
    const perGameMeta = picked.map(g => {
      const homeId = g?.home_team?.id; const awayId = g?.visitor_team?.id;
      const oppId = homeId === teamId ? awayId : awayId === teamId ? homeId : null;
      if (oppId) uniqueOppIds.add(oppId);
      return { id: g?.id, oppId: oppId as number | null };
    }).filter(x => x.id);

// Depth chart maps for each opponent
    const depthMaps: Record<number, Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>> = {};
    const host = req.headers.get('host') || undefined;
    for (const oppId of uniqueOppIds) {
      const oppAbbr = TEAM_ID_TO_ABBR[oppId];
      if (!oppAbbr) continue;
      depthMaps[oppId] = await fetchDepthChartBuckets(oppAbbr, host).catch(() => ({}));
    }

    // 2) For each game, fetch stats and accumulate opponent players' metric by position (group totals)
    type Buckets = Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
    const totals: Buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    let processedGames = 0;

    for (const g of perGameMeta) {
      const gid = g.id as number;
      const oppId = g.oppId as number | null;
      if (!gid || !oppId) continue;

      const statsUrl = new URL(`${BDL_BASE}/stats`);
      statsUrl.searchParams.append('game_ids[]', String(gid));
      statsUrl.searchParams.set('per_page', '100');

      let rows: any[] = [];
      try {
        const js = await fetchJson(statsUrl.toString());
        rows = Array.isArray(js?.data) ? js.data : [];
      } catch {
        continue;
      }

      if (!rows.length) continue;
      const oppRows = rows.filter(r => r?.team?.id === oppId);
      if (!oppRows.length) continue;

      const depthMap = depthMaps[oppId] || {};
      const customMap = CUSTOM.positions || {};
      const gameBuckets: Buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
      let unknownTotal = 0;
      const unknownPlayers: string[] = wantDebug ? [] : [];

      for (const r of oppRows) {
        const player = r?.player || {};
        const full = `${player?.first_name || ''} ${player?.last_name || ''}`.trim();
        const normFull = normName(full);
        const alias = ALIASES[normFull];
        const lookup = alias || normFull;
        let bucket: ('PG'|'SG'|'SF'|'PF'|'C'|undefined) = undefined;
        const val = safeMetric(r, metric);
        if (!val) continue;

        // 1) Custom fixed mapping overrides
        bucket = customMap[lookup] as any;
        if (!bucket) {
          // Unique last-name resolution within custom map
          const parts = lookup.split(' ').filter(Boolean);
          const last = parts[parts.length - 1];
          if (last) {
            const matches = Object.entries(customMap).filter(([k]) => k.endsWith(` ${last}`) || k === last);
            if (matches.length === 1) bucket = matches[0][1] as any;
          }
        }

        // 2) Team depth chart if still unknown
        if (!bucket) {
          bucket = depthMap[lookup] as any;
          if (!bucket) {
            const parts = lookup.split(' ').filter(Boolean);
            const last = parts[parts.length - 1];
            if (last) {
              const matches = Object.entries(depthMap).filter(([k]) => k.endsWith(` ${last}`) || k === last);
              if (matches.length === 1) bucket = matches[0][1] as any;
            }
          }
        }

        if (bucket) {
          gameBuckets[bucket] += val;
        } else {
          unknownTotal += val;
          if (wantDebug) unknownPlayers.push(full);
        }
      }

      if (wantDebug && (unknownTotal > 0)) {
        debug?.push({ gid, oppId, unknownTotal, unknownPlayers });
      }

      // Add this game's buckets into totals (group totals)
      (['PG','SG','SF','PF','C'] as const).forEach(k => { totals[k] += gameBuckets[k]; });
      processedGames += 1;
    }

    const perGame: Buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    if (processedGames > 0) {
      (['PG','SG','SF','PF','C'] as const).forEach(k => { perGame[k] = totals[k] / processedGames; });
    }

    const payload: any = {
      success: true,
      team,
      season: seasonYear,
      metric,
      sample_games: processedGames,
      perGame,
      totals,
    };
    if (wantDebug && debug) payload.debug = debug;
    cache.set(cacheKey, payload, CACHE_TTL.ADVANCED_STATS);
    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Failed to compute DvP' }, { status: 200 });
  }
}

function safeMetric(r: any, metric: string): number {
  const m = metric.toLowerCase();
  switch (m) {
    case 'pts': return Number(r?.pts) || 0;
    case 'reb': return Number(r?.reb) || 0;
    case 'ast': return Number(r?.ast) || 0;
    case 'fg3m': return Number(r?.fg3m) || 0;
    case 'fg3a': return Number(r?.fg3a) || 0;
    case 'fgm': return Number(r?.fgm) || 0;
    case 'fga': return Number(r?.fga) || 0;
    case 'stl': return Number(r?.stl) || 0;
    case 'blk': return Number(r?.blk) || 0;
    default: return Number(r?.pts) || 0;
  }
}

