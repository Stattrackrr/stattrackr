// app/api/tracking-stats/refresh-opponents/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { currentNbaSeason } from '@/lib/nbaUtils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max execution

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

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

const ALL_NBA_TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

// NBA Team ID mapping (abbreviation to ID)
const NBA_TEAM_IDS: Record<string, string> = {
  'ATL': '1610612737', 'BOS': '1610612738', 'BKN': '1610612751', 'CHA': '1610612766',
  'CHI': '1610612741', 'CLE': '1610612739', 'DAL': '1610612742', 'DEN': '1610612743',
  'DET': '1610612765', 'GSW': '1610612744', 'HOU': '1610612745', 'IND': '1610612754',
  'LAC': '1610612746', 'LAL': '1610612747', 'MEM': '1610612763', 'MIA': '1610612748',
  'MIL': '1610612749', 'MIN': '1610612750', 'NOP': '1610612740', 'NYK': '1610612752',
  'OKC': '1610612760', 'ORL': '1610612753', 'PHI': '1610612755', 'PHX': '1610612756',
  'POR': '1610612757', 'SAC': '1610612758', 'SAS': '1610612759', 'TOR': '1610612761',
  'UTA': '1610612762', 'WAS': '1610612764'
};

async function fetchNBAStats(url: string, timeout = 45000, retries = 2) {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      if (attempt > 0) {
        // Exponential backoff: wait 2s, 4s, 8s between retries
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 8000);
        console.log(`[Tracking Stats Opponents Refresh] Retry attempt ${attempt}/${retries} after ${delay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const response = await fetch(url, {
        headers: NBA_HEADERS,
        signal: controller.signal,
        cache: 'no-store'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`NBA API ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      lastError = error;
      
      if (error.name === 'AbortError') {
        lastError = new Error('Request timeout');
      }
      
      // If this was the last attempt, throw the error
      if (attempt === retries) {
        throw lastError;
      }
      
      // Otherwise, continue to retry
      console.log(`[Tracking Stats Opponents Refresh] Attempt ${attempt + 1} failed: ${lastError.message}, retrying...`);
    }
  }
  
  throw lastError || new Error('Unknown error');
}

/**
 * Refresh opponent-specific tracking stats for all teams
 * This endpoint fetches and caches all team × opponent × category combinations
 * Strategy: For each opponent, fetch league-wide data (60 API calls total),
 * then process and cache by team (1800 cache entries total)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    
    console.log(`[Tracking Stats Opponents Refresh] Starting bulk refresh for ${season}-${season + 1} season`);
    
    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    const categories = ['passing', 'rebounding'];
    
    let totalCached = 0;
    let totalApiCalls = 0;
    let totalErrors = 0;
    const errors: string[] = [];
    
    // For each opponent team, fetch league-wide data filtered by that opponent
    for (const opponentTeam of ALL_NBA_TEAMS) {
      const opponentTeamId = NBA_TEAM_IDS[opponentTeam];
      if (!opponentTeamId) {
        console.warn(`[Tracking Stats Opponents Refresh] ⚠️ No team ID found for ${opponentTeam}, skipping`);
        continue;
      }
      
      console.log(`[Tracking Stats Opponents Refresh] Processing opponent: ${opponentTeam} (${opponentTeamId})`);
      
      // Add a small delay between opponents to avoid rate limiting
      // (delay is only added after the first opponent)
      if (opponentTeam !== ALL_NBA_TEAMS[0]) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
      
      // Fetch both categories for this opponent
      for (const category of categories) {
        // Add a small delay between categories to avoid rate limiting
        if (category === 'rebounding') {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between passing and rebounding
        }
        
        const ptMeasureType = category === 'passing' ? 'Passing' : 'Rebounding';
        
        try {
          const params = new URLSearchParams({
            College: "",
            Conference: "",
            Country: "",
            DateFrom: "",
            DateTo: "",
            Division: "",
            DraftPick: "",
            DraftYear: "",
            GameScope: "",
            Height: "",
            LastNGames: "0",
            LeagueID: "00",
            Location: "",
            Month: "0",
            OpponentTeamID: opponentTeamId,
            Outcome: "",
            PORound: "0",
            PerMode: "PerGame",
            PlayerExperience: "",
            PlayerOrTeam: "Player",
            PlayerPosition: "",
            PtMeasureType: ptMeasureType,
            Season: seasonStr,
            SeasonSegment: "",
            SeasonType: "Regular Season",
            StarterBench: "",
            TeamID: "0",
            VsConference: "",
            VsDivision: "",
            Weight: "",
          });

          const url = `${NBA_STATS_BASE}/leaguedashptstats?${params.toString()}`;
          console.log(`[Tracking Stats Opponents Refresh] Fetching ${category} data vs ${opponentTeam}...`);
          
          totalApiCalls++;
          const data = await fetchNBAStats(url, 45000, 2); // 45s timeout, 2 retries
          
          if (!data?.resultSets?.[0]) {
            console.warn(`[Tracking Stats Opponents Refresh] ⚠️ No data for ${category} vs ${opponentTeam}`);
            totalErrors++;
            errors.push(`${opponentTeam} ${category}: No data`);
            continue;
          }

          const resultSet = data.resultSets[0];
          const headers = resultSet.headers || [];
          const rows = resultSet.rowSet || [];
          
          console.log(`[Tracking Stats Opponents Refresh] Got ${rows.length} players for ${category} vs ${opponentTeam}`);

          // Find column indices
          const playerIdIdx = headers.indexOf('PLAYER_ID');
          const playerNameIdx = headers.indexOf('PLAYER_NAME');
          const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
          const gpIdx = headers.indexOf('GP');

          if (playerIdIdx === -1 || playerNameIdx === -1 || teamAbbrIdx === -1) {
            console.warn(`[Tracking Stats Opponents Refresh] ⚠️ Missing required columns for ${category} vs ${opponentTeam}`);
            totalErrors++;
            errors.push(`${opponentTeam} ${category}: Missing columns`);
            continue;
          }

          // Process and cache data for each team
          for (const team of ALL_NBA_TEAMS) {
            // Filter rows for this team
            const teamRows = rows.filter((row: any[]) => row[teamAbbrIdx] === team);
            
            if (teamRows.length === 0) {
              // No players for this team vs this opponent - skip caching
              continue;
            }

            // Map to our format
            const players = teamRows.map((row: any[]) => {
              const stats: any = {};
              headers.forEach((header: string, idx: number) => {
                stats[header] = row[idx];
              });

              const player: any = {
                playerId: String(stats.PLAYER_ID),
                playerName: stats.PLAYER_NAME,
                gp: stats.GP || 0,
              };

              if (category === 'passing') {
                player.potentialAst = stats.POTENTIAL_AST;
                player.ast = stats.AST_ADJ || stats.AST;
                player.astPtsCreated = stats.AST_POINTS_CREATED || stats.AST_PTS_CREATED;
                player.passesMade = stats.PASSES_MADE;
                player.astToPct = stats.AST_TO_PASS_PCT_ADJ || stats.AST_TO_PASS_PCT;
              } else {
                player.rebChances = stats.REB_CHANCES;
                player.reb = stats.REB;
                player.rebChancePct = stats.REB_CHANCE_PCT;
                player.rebContest = stats.REB_CONTEST;
                player.rebUncontest = stats.REB_UNCONTEST;
                player.avgRebDist = stats.AVG_REB_DIST;
                player.drebChances = stats.DREB_CHANCES;
                player.drebChancePct = stats.DREB_CHANCE_PCT;
                player.avgDrebDist = stats.AVG_DREB_DIST;
              }

              return player;
            });

            // Cache this team's data for this category vs this opponent
            const cacheKey = `tracking_stats_${team.toUpperCase()}_${season}_${category}_vs_${opponentTeam.toUpperCase()}`;
            const payload = {
              team,
              season: seasonStr,
              category,
              players,
              opponentTeam,
              cachedAt: new Date().toISOString()
            };
            
            // Cache in both Supabase (persistent) and in-memory
            await setNBACache(cacheKey, 'team_tracking', payload, CACHE_TTL.TRACKING_STATS);
            cache.set(cacheKey, payload, CACHE_TTL.TRACKING_STATS);
            
            totalCached++;
            
            if (totalCached % 100 === 0) {
              console.log(`[Tracking Stats Opponents Refresh] 💾 Cached ${totalCached} combinations so far...`);
            }
          }
        } catch (error: any) {
          console.error(`[Tracking Stats Opponents Refresh] ❌ Error fetching ${category} vs ${opponentTeam}:`, error.message);
          totalErrors++;
          errors.push(`${opponentTeam} ${category}: ${error.message}`);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    const result = {
      success: true,
      totalCached,
      totalApiCalls,
      totalErrors,
      errors: errors.slice(0, 10), // Only return first 10 errors to avoid huge response
      season: seasonStr,
      elapsed: `${elapsed}ms`,
      cachedAt: new Date().toISOString(),
      ttl: `${CACHE_TTL.TRACKING_STATS} minutes`
    };

    console.log(`[Tracking Stats Opponents Refresh] ✅ Complete:`, result);
    
    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error('[Tracking Stats Opponents Refresh] ❌ Error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to refresh opponent-specific tracking stats',
        elapsed: `${elapsed}ms`
      },
      { status: 500 }
    );
  }
}

