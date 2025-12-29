// app/api/team-defense-rankings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL } from '@/lib/cache';
import { currentNbaSeason } from '@/lib/nbaUtils';
import { getNBACache, setNBACache } from '@/lib/nbaCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro plan allows up to 60s

const NBA_STATS_BASE = 'https://stats.nba.com/stats';
const BDL_BASE = 'https://api.balldontlie.io/v1';

const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
  ATL: 1, BOS: 2, BKN: 3, CHA: 4, CHI: 5, CLE: 6, DAL: 7, DEN: 8, DET: 9, GSW: 10,
  HOU: 11, IND: 12, LAC: 13, LAL: 14, MEM: 15, MIA: 16, MIL: 17, MIN: 18, NOP: 19, NYK: 20,
  OKC: 21, ORL: 22, PHI: 23, PHX: 24, POR: 25, SAC: 26, SAS: 27, TOR: 28, UTA: 29, WAS: 30,
};

async function bdlFetch(url: string) {
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
  const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';
  
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'StatTrackr/1.0',
      ...(authHeader ? { 'Authorization': authHeader } : {}),
    },
    cache: 'no-store'
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status}: ${text || url}`);
  }
  
  return res.json();
}

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/stats/',
  'Origin': 'https://www.nba.com',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not=A?Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const NBA_TEAM_MAP: { [key: string]: string } = {
  'ATL': '1610612737', 'BOS': '1610612738', 'BKN': '1610612751', 'CHA': '1610612766',
  'CHI': '1610612741', 'CLE': '1610612739', 'DAL': '1610612742', 'DEN': '1610612743',
  'DET': '1610612765', 'GSW': '1610612744', 'HOU': '1610612745', 'IND': '1610612754',
  'LAC': '1610612746', 'LAL': '1610612747', 'MEM': '1610612763', 'MIA': '1610612748',
  'MIL': '1610612749', 'MIN': '1610612750', 'NOP': '1610612740', 'NYK': '1610612752',
  'OKC': '1610612760', 'ORL': '1610612753', 'PHI': '1610612755', 'PHX': '1610612756',
  'POR': '1610612757', 'SAC': '1610612758', 'SAS': '1610612759', 'TOR': '1610612761',
  'UTA': '1610612762', 'WAS': '1610612764'
};

async function fetchNBAStats(url: string, timeout = 20000, retries = 2) {
  let lastError: Error | null = null;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Increased timeout to 120s for slow NBA API
  const actualTimeout = Math.max(4000, Math.min(timeout, 120000)); // 120s max
  const actualRetries = Math.max(0, Math.min(retries, 3)); // 3 retries = 4 total attempts
  const maxAttempts = actualRetries + 1;
  
  for (let attempt = 0; attempt <= actualRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

    try {
      const response = await fetch(url, {
        headers: NBA_HEADERS,
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'follow'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        const errorMsg = `NBA API ${response.status}: ${response.statusText}`;
        console.error(`[Team Defense Rankings] NBA API error ${response.status} (attempt ${attempt + 1}/${maxAttempts}):`, text.slice(0, 500));
        
        // Retry on 5xx errors or 429 (rate limit)
        if ((response.status >= 500 || response.status === 429) && attempt < actualRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          lastError = new Error(errorMsg);
          continue;
        }
        
        throw new Error(errorMsg);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error('Request timeout');
        if (attempt < actualRetries) {
          console.log(`[Team Defense Rankings] Timeout on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
        lastError = error;
        if (attempt < actualRetries) {
          console.log(`[Team Defense Rankings] Network error on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }
      
      throw error;
    }
  }
  
  throw lastError || new Error('Failed after retries');
}

// Fetch games played for all teams using BDL API
async function fetchTeamGamesPlayed(seasonYear: number): Promise<Record<string, number>> {
  const gamesPlayed: Record<string, number> = {};
  
  try {
    console.log(`[Team Defense Rankings] Fetching games played from BDL for season ${seasonYear}...`);
    
    // Fetch games for all teams in parallel (but limit concurrency)
    const teamAbbrs = Object.keys(ABBR_TO_TEAM_ID_BDL);
    const batchSize = 5; // Process 5 teams at a time to avoid overwhelming the API
    
    for (let i = 0; i < teamAbbrs.length; i += batchSize) {
      const batch = teamAbbrs.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (teamAbbr) => {
        try {
          const teamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
          if (!teamId) return;
          
          // Fetch all games for this team in the season (handle pagination)
          let allGames: any[] = [];
          let currentPage = 1;
          let hasMorePages = true;
          const perPage = 100;
          
          while (hasMorePages) {
            const gamesUrl = new URL(`${BDL_BASE}/games`);
            gamesUrl.searchParams.set('per_page', String(perPage));
            gamesUrl.searchParams.set('page', String(currentPage));
            gamesUrl.searchParams.append('seasons[]', String(seasonYear));
            gamesUrl.searchParams.append('team_ids[]', String(teamId));
            
            const gamesData = await bdlFetch(gamesUrl.toString());
            const games = Array.isArray(gamesData?.data) ? gamesData.data : [];
            allGames = allGames.concat(games);
            
            // Check if there are more pages
            const meta = gamesData?.meta || {};
            const totalPages = meta.total_pages || 1;
            hasMorePages = currentPage < totalPages && games.length === perPage;
            currentPage++;
            
            // Safety limit
            if (currentPage > 10) break;
          }
          
          // Count completed games (status includes 'Final')
          const completedGames = allGames.filter((g: any) => 
            String(g?.status || '').toLowerCase().includes('final')
          );
          
          gamesPlayed[teamAbbr] = completedGames.length;
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err: any) {
          console.warn(`[Team Defense Rankings] ⚠️ Error fetching games for ${teamAbbr}: ${err.message}`);
          gamesPlayed[teamAbbr] = 0; // Default to 0 if fetch fails
        }
      }));
      
      // Delay between batches
      if (i + batchSize < teamAbbrs.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    const teamsWithGames = Object.entries(gamesPlayed).filter(([_, gp]) => gp > 0);
    console.log(`[Team Defense Rankings] ✅ Fetched games played for ${teamsWithGames.length}/${teamAbbrs.length} teams from BDL`);
    
    // Log sample data
    if (teamsWithGames.length > 0) {
      const sample = teamsWithGames.slice(0, 3).map(([team, gp]) => `${team}: ${gp}`).join(', ');
      console.log(`[Team Defense Rankings] Sample games played: ${sample}`);
    }
    
    return gamesPlayed;
  } catch (err: any) {
    console.warn(`[Team Defense Rankings] ⚠️ Error fetching games played from BDL: ${err.message}`);
    return {};
  }
}

async function fetchTeamDefenseStats(teamAbbr: string, teamId: string, seasonStr: string) {
  try {
    const defenseParams = new URLSearchParams({
      LeagueID: '00',
      Season: seasonStr,
      SeasonType: 'Regular Season',
      TeamID: '0',
      PlayerID: '0',
      Outcome: '',
      Location: '',
      Month: '0',
      SeasonSegment: '',
      DateFrom: '',
      DateTo: '',
      OpponentTeamID: teamId,
      VsConference: '',
      VsDivision: '',
      GameSegment: '',
      Period: '0',
      LastNGames: '0',
      ContextMeasure: 'FGA',
      RookieYear: '',
      Position: '',
    });

    const defenseUrl = `${NBA_STATS_BASE}/shotchartdetail?${defenseParams.toString()}`;
    console.log(`[Team Defense Rankings] Fetching defense for ${teamAbbr}...`);
    // Use longer timeout (120s) for slow NBA API
    const defenseData = await fetchNBAStats(defenseUrl, 120000, 3);

    if (defenseData?.resultSets?.[0]) {
      const resultSet = defenseData.resultSets[0];
      const headers = resultSet.headers || [];
      const rows = resultSet.rowSet || [];

      const shotMadeIdx = headers.indexOf('SHOT_MADE_FLAG');
      const shotZoneBasicIdx = headers.indexOf('SHOT_ZONE_BASIC');

      const zoneStats: {
        [key: string]: { made: number; attempted: number };
      } = {
        restrictedArea: { made: 0, attempted: 0 },
        paint: { made: 0, attempted: 0 },
        midRange: { made: 0, attempted: 0 },
        leftCorner3: { made: 0, attempted: 0 },
        rightCorner3: { made: 0, attempted: 0 },
        aboveBreak3: { made: 0, attempted: 0 },
      };

      for (const row of rows) {
        const made = row[shotMadeIdx] === 1;
        const zone = row[shotZoneBasicIdx];

        if (zone === 'Restricted Area') {
          zoneStats.restrictedArea.attempted++;
          if (made) zoneStats.restrictedArea.made++;
        } else if (zone === 'In The Paint (Non-RA)') {
          zoneStats.paint.attempted++;
          if (made) zoneStats.paint.made++;
        } else if (zone === 'Mid-Range') {
          zoneStats.midRange.attempted++;
          if (made) zoneStats.midRange.made++;
        } else if (zone === 'Left Corner 3') {
          zoneStats.leftCorner3.attempted++;
          if (made) zoneStats.leftCorner3.made++;
        } else if (zone === 'Right Corner 3') {
          zoneStats.rightCorner3.attempted++;
          if (made) zoneStats.rightCorner3.made++;
        } else if (zone === 'Above the Break 3') {
          zoneStats.aboveBreak3.attempted++;
          if (made) zoneStats.aboveBreak3.made++;
        }
      }

      return {
        team: teamAbbr,
        restrictedArea: {
          fgPct: zoneStats.restrictedArea.attempted > 0 ? (zoneStats.restrictedArea.made / zoneStats.restrictedArea.attempted) * 100 : 0,
          fga: zoneStats.restrictedArea.attempted,
          fgm: zoneStats.restrictedArea.made
        },
        paint: {
          fgPct: zoneStats.paint.attempted > 0 ? (zoneStats.paint.made / zoneStats.paint.attempted) * 100 : 0,
          fga: zoneStats.paint.attempted,
          fgm: zoneStats.paint.made
        },
        midRange: {
          fgPct: zoneStats.midRange.attempted > 0 ? (zoneStats.midRange.made / zoneStats.midRange.attempted) * 100 : 0,
          fga: zoneStats.midRange.attempted,
          fgm: zoneStats.midRange.made
        },
        leftCorner3: {
          fgPct: zoneStats.leftCorner3.attempted > 0 ? (zoneStats.leftCorner3.made / zoneStats.leftCorner3.attempted) * 100 : 0,
          fga: zoneStats.leftCorner3.attempted,
          fgm: zoneStats.leftCorner3.made
        },
        rightCorner3: {
          fgPct: zoneStats.rightCorner3.attempted > 0 ? (zoneStats.rightCorner3.made / zoneStats.rightCorner3.attempted) * 100 : 0,
          fga: zoneStats.rightCorner3.attempted,
          fgm: zoneStats.rightCorner3.made
        },
        aboveBreak3: {
          fgPct: zoneStats.aboveBreak3.attempted > 0 ? (zoneStats.aboveBreak3.made / zoneStats.aboveBreak3.attempted) * 100 : 0,
          fga: zoneStats.aboveBreak3.attempted,
          fgm: zoneStats.aboveBreak3.made
        },
      };
    }

    return null;
  } catch (err) {
    console.error(`[Team Defense Rankings] Error fetching defense for ${teamAbbr}:`, err);
    return null;
  }
}

function calculateRankings(allTeamsData: any[], gamesPlayed: Record<string, number>) {
  const zones = ['restrictedArea', 'paint', 'midRange', 'leftCorner3', 'rightCorner3', 'aboveBreak3'];
  const rankings: { [team: string]: any } = {};

  // For each zone, sort teams by per-game FGM allowed (ascending = best defense first)
  zones.forEach(zone => {
    const teamsWithPct = allTeamsData
      .filter(t => t && t[zone] && t[zone].fga > 0) // Only teams with attempts in this zone
      .map(t => {
        const gp = gamesPlayed[t.team] || 1; // Default to 1 to avoid division by zero
        const totalFgm = t[zone].fgm;
        const fgmPerGame = gp > 0 ? totalFgm / gp : totalFgm; // Calculate per-game FGM
        
        return {
          team: t.team,
          fgPct: t[zone].fgPct,
          fga: t[zone].fga,
          fgm: t[zone].fgm, // Keep total for display
          fgmPerGame: fgmPerGame, // Per-game for ranking
          gamesPlayed: gp
        };
      })
      .sort((a, b) => a.fgmPerGame - b.fgmPerGame); // Sort ascending (lowest per-game FGM = best defense)

    // Debug logging for aboveBreak3 zone
    if (zone === 'aboveBreak3') {
      console.log(`[Team Defense Rankings] 🔍 ${zone} rankings by per-game FGM (lowest = best):`);
      const top5 = teamsWithPct.slice(0, 5).map((t, idx) => `#${idx + 1} ${t.team}: ${t.fgmPerGame.toFixed(2)} FGM/G (${t.fgm} total, ${t.gamesPlayed} GP)`);
      console.log(`[Team Defense Rankings] Top 5: ${top5.join(', ')}`);
      const dalRank = teamsWithPct.findIndex(t => t.team === 'DAL');
      if (dalRank >= 0) {
        const dalData = teamsWithPct[dalRank];
        console.log(`[Team Defense Rankings] 🏀 DAL (Dallas): Rank #${dalRank + 1}, Per-Game FGM: ${dalData.fgmPerGame.toFixed(2)}, Total FGM: ${dalData.fgm.toFixed(1)}, GP: ${dalData.gamesPlayed}, FG%: ${dalData.fgPct.toFixed(1)}%`);
      }
    }

    // Assign ranks (1-30)
    teamsWithPct.forEach((t, index) => {
      if (!rankings[t.team]) {
        rankings[t.team] = {};
      }
      rankings[t.team][zone] = {
        rank: index + 1,
        fgPct: t.fgPct,
        fga: t.fga,
        fgm: t.fgm, // Total FGM (for reference)
        fgmPerGame: t.fgmPerGame, // Per-game FGM (used for ranking)
        gamesPlayed: t.gamesPlayed,
        totalTeams: teamsWithPct.length
      };
    });
  });

  return rankings;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    const bypassCache = searchParams.get('bypassCache') === 'true';

    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    const cacheKey = `team_defense_rankings_${season}`;
    const zoneCacheKey = `zone_defensive_rankings_${seasonStr}`;

    // If bypassCache is true, delete old caches first to ensure fresh FGM-based rankings
    if (bypassCache) {
      console.log(`[Team Defense Rankings] 🗑️ Bypassing cache - deleting old cache entries to force FGM-based recalculation...`);
      const { deleteNBACache } = await import('@/lib/nbaCache');
      await deleteNBACache(cacheKey);
      await deleteNBACache(zoneCacheKey);
      cache.delete(cacheKey);
      cache.delete(zoneCacheKey);
      console.log(`[Team Defense Rankings] ✅ Old cache entries deleted`);
    }

    // Check Supabase cache FIRST (persistent, shared across instances) - this is the primary source
    // Use longer timeout for large cache entries (30s to handle slow Supabase)
    let cached = !bypassCache 
      ? await getNBACache<any>(cacheKey, {
          restTimeoutMs: 30000, // 30s for large payloads
          jsTimeoutMs: 30000,
        })
      : null;
    
    if (cached) {
      // Handle both formats: direct rankings object or wrapped in rankings property
      const rankings = cached.rankings || cached;
      
      // Validate that cached data has actual rankings
      const hasValidRankings = rankings && 
                               typeof rankings === 'object' && 
                               Object.keys(rankings).length > 0;
      
      if (hasValidRankings) {
        console.log(`[Team Defense Rankings] ✅ Supabase cache hit for season ${season} (${Object.keys(rankings).length} teams)`);
        
        // Normalize response format
        const response = {
          season: cached.season || seasonStr,
          rankings: rankings,
          cachedAt: cached.cachedAt || new Date().toISOString(),
          teamsProcessed: cached.teamsProcessed || Object.keys(rankings).length,
          source: 'supabase_cache'
        };
        
        // Also cache in-memory for faster subsequent requests
        cache.set(cacheKey, response, 1440);
        
        return NextResponse.json(response, {
          status: 200,
          headers: { 'X-Cache-Status': 'HIT-SUPABASE' }
        });
      } else {
        console.warn(`[Team Defense Rankings] ⚠️ Supabase cache exists but is corrupted (0 teams) - deleting and checking fallbacks`);
        // Delete corrupted cache
        const { deleteNBACache } = await import('@/lib/nbaCache');
        await deleteNBACache(cacheKey);
        cached = null;
      }
    }

    // Check in-memory cache as fallback (unless bypassed)
    if (!cached && !bypassCache) {
      cached = cache.get<any>(cacheKey);
      if (cached) {
        // Validate that cached data has actual rankings
        const rankings = cached.rankings || cached;
        const hasValidRankings = rankings && 
                                 typeof rankings === 'object' && 
                                 Object.keys(rankings).length > 0;
        
        if (hasValidRankings) {
          console.log(`[Team Defense Rankings] ✅ In-memory cache hit for season ${season} (${Object.keys(rankings).length} teams)`);
          return NextResponse.json(cached, {
            status: 200,
            headers: { 'X-Cache-Status': 'HIT-MEMORY' }
          });
        } else {
          console.warn(`[Team Defense Rankings] ⚠️ In-memory cache exists but is corrupted (0 teams) - deleting`);
          cache.delete(cacheKey);
          cached = null;
        }
      }
    }

    // Check Supabase cache for zone rankings (alternative format, populated by background job)
    const zoneRankingsCache = !bypassCache && !cached
      ? await getNBACache<Record<string, Array<{ team: string; fgPct: number }>>>(zoneCacheKey, {
          restTimeoutMs: 20000,
          jsTimeoutMs: 20000,
        })
      : null;
    
    if (zoneRankingsCache) {
      // Filter out metadata keys that get attached by getNBACache
      const { __cache_metadata, ...zoneDataOnly } = zoneRankingsCache as any;
      const availableZones = Object.keys(zoneDataOnly).filter(key => 
        Array.isArray(zoneDataOnly[key]) && zoneDataOnly[key].length > 0
      );
      
      console.log(`[Team Defense Rankings] 🔍 Cache inspection:`);
      console.log(`[Team Defense Rankings] 🔍 Raw cache keys:`, Object.keys(zoneRankingsCache));
      console.log(`[Team Defense Rankings] 🔍 Zone data keys (after filtering metadata):`, Object.keys(zoneDataOnly));
      console.log(`[Team Defense Rankings] 🔍 Available zones (with data):`, availableZones);
      
      if (availableZones.length > 0) {
        console.log(`[Team Defense Rankings] ✅ Using cached zone rankings from Supabase (${availableZones.length} zones: ${availableZones.join(', ')})`);
        console.log(`[Team Defense Rankings] 🔍 All zone keys in cache:`, Object.keys(zoneDataOnly));
        console.log(`[Team Defense Rankings] 🔍 Sample zone data:`, availableZones[0] ? { zone: availableZones[0], sample: zoneDataOnly[availableZones[0]]?.[0] } : 'none');
        
        // Warn if we have partial data
        if (availableZones.length < 6) {
          console.warn(`[Team Defense Rankings] ⚠️ WARNING: Only ${availableZones.length}/6 zones available. Some defensive metrics may be missing.`);
        }
        
        // Convert zone rankings format to the expected format
        const rankings: { [team: string]: any } = {};
        const zones = ['Restricted Area', 'Paint (Non-RA)', 'Mid-Range', 'Left Corner 3', 'Right Corner 3', 'Above the Break 3'];
        const zoneMap: Record<string, string> = {
          'Restricted Area': 'restrictedArea',
          'Paint (Non-RA)': 'paint',
          'Mid-Range': 'midRange',
          'Left Corner 3': 'leftCorner3',
          'Right Corner 3': 'rightCorner3',
          'Above the Break 3': 'aboveBreak3'
        };
        
        // Use the filtered cache (without metadata)
        const filteredCache = zoneDataOnly;

        let zonesMatched = 0;
        zones.forEach(zone => {
          const zoneData = filteredCache[zone];
          if (zoneData && Array.isArray(zoneData)) {
            zonesMatched++;
            console.log(`[Team Defense Rankings] ✅ Processing zone: ${zone} (${zoneData.length} teams)`);
            zoneData.forEach((teamData, index) => {
              // Ensure team abbreviation is uppercase
              const team = (teamData.team || '').toUpperCase();
              if (!team) {
                console.warn(`[Team Defense Rankings] ⚠️ Skipping team data with no team name at index ${index}`);
                return;
              }
              
              if (!rankings[team]) {
                rankings[team] = {};
              }
              const zoneKey = zoneMap[zone];
              if (zoneKey) {
                rankings[team][zoneKey] = {
                  rank: index + 1,
                  fgPct: teamData.fgPct || 0,
                  fga: 0, // Not available from zone rankings cache
                  fgm: 0, // Not available from zone rankings cache
                  totalTeams: zoneData.length
                };
              }
            });
          } else {
            console.warn(`[Team Defense Rankings] ⚠️ Zone "${zone}" not found in cache or not an array`);
          }
        });
        
        console.log(`[Team Defense Rankings] 🔍 Matched ${zonesMatched}/${zones.length} expected zones`);
        console.log(`[Team Defense Rankings] 🔍 Teams in rankings: ${Object.keys(rankings).length}`);

        // If no teams were processed, the cache is corrupted/empty - fall through to fetch fresh
        if (Object.keys(rankings).length === 0) {
          console.warn(`[Team Defense Rankings] ⚠️ Cache exists but produced 0 teams - cache is corrupted or empty`);
          console.warn(`[Team Defense Rankings] ⚠️ Falling through to fetch fresh data from NBA API`);
          // Delete corrupted cache
          const { deleteNBACache } = await import('@/lib/nbaCache');
          await deleteNBACache(zoneCacheKey);
          cache.delete(zoneCacheKey);
          // Fall through to fetch from NBA API
        } else {
          // Log sample of converted rankings for debugging
          const sampleTeam = Object.keys(rankings)[0];
          if (sampleTeam) {
            console.log(`[Team Defense Rankings] Sample rankings for ${sampleTeam}:`, rankings[sampleTeam]);
          }
          console.log(`[Team Defense Rankings] Converted rankings for ${Object.keys(rankings).length} teams`);

        const response = {
            season: seasonStr,
            rankings,
            cachedAt: new Date().toISOString(),
            teamsProcessed: Object.keys(rankings).length,
            source: 'supabase_cache'
          };

        // Also cache in-memory and persist so other environments can reuse
        // Use TRACKING_STATS TTL (365 days) so cache persists until replaced by cron job
        cache.set(cacheKey, response, CACHE_TTL.TRACKING_STATS);
        await setNBACache(cacheKey, 'team_defense_rankings', response, CACHE_TTL.TRACKING_STATS);
          
          return NextResponse.json(response, {
            status: 200,
            headers: { 'X-Cache-Status': 'HIT-SUPABASE' }
          });
        }
      } else {
        console.warn(`[Team Defense Rankings] ⚠️ Cache exists but has no valid zones - cache is corrupted`);
        // Delete corrupted cache
        const { deleteNBACache } = await import('@/lib/nbaCache');
        await deleteNBACache(zoneCacheKey);
        cache.delete(zoneCacheKey);
        // Fall through to fetch from NBA API
      }
    }

    // In production, don't fetch all 30 teams unless explicitly bypassed (will timeout)
    // Instead, return an error asking user to run cache refresh locally
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && !bypassCache) {
      console.warn(`[Team Defense Rankings] ⚠️ No cache found in production. Fetching all 30 teams would timeout.`);
      console.warn(`[Team Defense Rankings] 💡 To populate cache, run locally: Invoke-RestMethod "http://localhost:3000/api/team-defense-rankings?season=${season}&bypassCache=true"`);
      
      return NextResponse.json({
        error: 'Cache not available',
        message: `Team defense rankings cache not found. Please run the cache refresh locally to populate Supabase cache.`,
        instructions: `Run this command locally: Invoke-RestMethod "http://localhost:3000/api/team-defense-rankings?season=${season}&bypassCache=true"`,
        season: seasonStr,
        teamsProcessed: 0
      }, { status: 503 });
    }

    console.log(`[Team Defense Rankings] ⚠️ No cache found, fetching from NBA API (this may timeout - consider running /api/cache/nba-league-data first)`);
    console.log(`[Team Defense Rankings] Fetching defense stats for all 30 teams (season ${seasonStr})...`);

    // Fetch sequentially with delays to avoid overwhelming NBA API
    const validTeams: any[] = [];
    const teams = Object.entries(NBA_TEAM_MAP);
    
    for (let i = 0; i < teams.length; i++) {
      const [abbr, id] = teams[i];
      try {
        const result = await fetchTeamDefenseStats(abbr, id, seasonStr);
        if (result) {
          validTeams.push(result);
        }
      } catch (err) {
        console.error(`[Team Defense Rankings] Failed to fetch ${abbr}:`, err);
      }
      
      // Add longer delay between requests to avoid rate limiting (except for last one)
      if (i < teams.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay to avoid rate limiting
      }
    }

    console.log(`[Team Defense Rankings] Successfully fetched ${validTeams.length}/30 teams`);

    // Require at least 10 teams for meaningful rankings (lowered from 20 due to API unreliability)
    if (validTeams.length < 10) {
      console.warn(`[Team Defense Rankings] ⚠️ Only ${validTeams.length} teams fetched, need at least 10 for rankings`);
      return NextResponse.json({
        error: 'Insufficient data',
        message: `Only ${validTeams.length}/30 teams available, need at least 10 for rankings. Please run /api/cache/nba-league-data to populate cache.`,
        teamsProcessed: validTeams.length
      }, { status: 503 });
    }
    
    if (validTeams.length < 30) {
      console.warn(`[Team Defense Rankings] ⚠️ Only ${validTeams.length}/30 teams fetched - returning partial data`);
    }

    // Fetch games played for all teams to calculate per-game FGM
    console.log(`[Team Defense Rankings] Fetching games played for all teams...`);
    const gamesPlayed = await fetchTeamGamesPlayed(season);
    
    if (Object.keys(gamesPlayed).length === 0) {
      console.warn(`[Team Defense Rankings] ⚠️ Could not fetch games played - using totals instead of per-game`);
    }

    // Calculate rankings using per-game FGM
    const rankings = calculateRankings(validTeams, gamesPlayed);

    const response = {
      season: seasonStr,
      rankings,
      cachedAt: new Date().toISOString(),
      teamsProcessed: validTeams.length,
      source: 'nba_api'
    };

    // Cache with TRACKING_STATS TTL (365 days) so cache persists until replaced by cron job
    // This prevents cache expiration when the 12am cron job doesn't run
    cache.set(cacheKey, response, CACHE_TTL.TRACKING_STATS);
    await setNBACache(cacheKey, 'team_defense_rankings', response, CACHE_TTL.TRACKING_STATS);
    console.log(`[Team Defense Rankings] 💾 Cached rankings for season ${season}`);

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Cache-Status': 'MISS' }
    });

  } catch (error: any) {
    console.error('[Team Defense Rankings] Error:', error);

    // Determine error type and provide helpful message
    let errorMessage = 'Failed to fetch team defense rankings';
    let errorType = error.name || 'UnknownError';
    
    if (error.message?.includes('timeout') || error.name === 'AbortError') {
      errorMessage = 'Request timed out - NBA API is slow to respond. Please try again.';
      errorType = 'TimeoutError';
    } else if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
      errorMessage = 'Network error - Unable to reach NBA API. Please check your connection.';
      errorType = 'NetworkError';
    } else if (error.message?.includes('NBA API 4')) {
      errorMessage = 'NBA API returned an error. The team data may not be available.';
      errorType = 'APIError';
    } else if (error.message?.includes('NBA API 5')) {
      errorMessage = 'NBA API server error. Please try again in a few moments.';
      errorType = 'ServerError';
    } else if (error.message) {
      errorMessage = error.message;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const errorDetails = isProduction 
      ? {
          error: errorMessage,
          type: errorType,
          originalError: error.message?.substring(0, 100) || 'Unknown error',
        }
      : {
          error: errorMessage,
          message: error.message,
          stack: error.stack,
          type: errorType,
        };

    return NextResponse.json(
      errorDetails,
      { status: 500 }
    );
  }
}

