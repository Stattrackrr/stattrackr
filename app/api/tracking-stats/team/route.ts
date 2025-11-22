// app/api/tracking-stats/team/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro plan allows up to 60s

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

async function fetchNBAStats(url: string, timeout = 20000, retries = 2) {
  let lastError: Error | null = null;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Use 20s max timeout in production (leaving 40s buffer for Vercel overhead and retries)
  // NBA API is slow, so we need to fail fast and rely on cache
  const actualTimeout = isProduction ? Math.min(Math.max(timeout, 20000), 20000) : timeout;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

    try {
      console.log(`[Team Tracking Stats] Fetching NBA API (attempt ${attempt + 1}/${retries + 1}): ${url.substring(0, 100)}...`);
      
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
        console.error(`[Team Tracking Stats] NBA API error ${response.status} (attempt ${attempt + 1}/${retries + 1}):`, text.slice(0, 500));
        
        // Retry on 5xx errors or 429 (rate limit)
        if ((response.status >= 500 || response.status === 429) && attempt < retries) {
          const delay = 1000 * (attempt + 1);
          console.log(`[Team Tracking Stats] Retrying after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = new Error(errorMsg);
          continue;
        }
        
        throw new Error(errorMsg);
      }

      const data = await response.json();
      console.log(`[Team Tracking Stats] ✅ Successfully fetched NBA API data`);
      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${actualTimeout}ms`);
        if (attempt < retries) {
          console.log(`[Team Tracking Stats] Timeout on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNRESET')) {
        lastError = error;
        if (attempt < retries) {
          console.log(`[Team Tracking Stats] Network error on attempt ${attempt + 1}: ${error.message}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }
      
      // Log the error for debugging
      console.error(`[Team Tracking Stats] Fetch error (attempt ${attempt + 1}):`, {
        name: error.name,
        message: error.message,
        isProduction,
      });
      
      throw error;
    }
  }
  
  throw lastError || new Error('Failed after retries');
}

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const season = parseInt(searchParams.get('season') || '2025');
    const category = searchParams.get('category') || 'passing';
    const opponentTeam = searchParams.get('opponentTeam');
    const forceRefresh = searchParams.get('refresh') === '1';

    if (!team) {
      return NextResponse.json(
        { error: 'Team abbreviation is required' },
        { status: 400 }
      );
    }

    // If no opponent filter, try to serve from cache first
    if (!opponentTeam && !forceRefresh) {
      const cacheKey = getCacheKey.trackingStats(team, season, category);
      const cached = cache.get<any>(cacheKey);
      
      if (cached) {
        console.log(`[Team Tracking Stats] ✅ Cache hit for ${team} ${category} (season ${season})`);
        return NextResponse.json(cached, {
          status: 200,
          headers: {
            'X-Cache-Status': 'HIT',
            'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' // 24h cache, 48h stale
          }
        });
      }
      
      console.log(`[Team Tracking Stats] ⚠️ Cache miss for ${team} ${category} - falling back to API`);
    }

    const filterSuffix = opponentTeam ? ` vs ${opponentTeam}` : '';
    console.log(`[Team Tracking Stats] Fetching ${category} stats for ${team}${filterSuffix}, season ${season}`);

    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    
    // Determine which endpoint to use based on category
    const ptMeasureType = category === 'passing' ? 'Passing' : 'Rebounding';
    
    // Get opponent team ID if filtering by opponent
    const opponentTeamId = opponentTeam && NBA_TEAM_IDS[opponentTeam] 
      ? NBA_TEAM_IDS[opponentTeam] 
      : "0";
    
    // Fetch league-wide stats
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
    console.log(`[Team Tracking Stats] Fetching: ${url}`);

    const data = await fetchNBAStats(url);

    if (!data?.resultSets?.[0]) {
      console.warn("[Team Tracking Stats] No resultSets in response");
      return NextResponse.json({ players: [] }, { status: 200 });
    }

    const resultSet = data.resultSets[0];
    const headers = resultSet.headers || [];
    const rows = resultSet.rowSet || [];

    // Find column indices
    const playerIdIdx = headers.indexOf('PLAYER_ID');
    const playerNameIdx = headers.indexOf('PLAYER_NAME');
    const teamIdIdx = headers.indexOf('TEAM_ID');
    const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
    const gpIdx = headers.indexOf('GP');

    if (playerIdIdx === -1 || playerNameIdx === -1) {
      console.warn("[Team Tracking Stats] Missing required columns");
      return NextResponse.json({ players: [] }, { status: 200 });
    }

    // Filter for the specific team and map to our format
    const teamPlayers = rows
      .filter((row: any[]) => {
        const teamAbbr = row[teamAbbrIdx];
        return teamAbbr === team;
      })
      .map((row: any[]) => {
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

    console.log(`[Team Tracking Stats] Found ${teamPlayers.length} players for ${team}`);

    const responsePayload = { 
      team,
      season: seasonStr,
      category,
      players: teamPlayers,
      cachedAt: new Date().toISOString()
    };

    // Cache the result if no opponent filter (so it can be reused)
    if (!opponentTeam) {
      const cacheKey = getCacheKey.trackingStats(team, season, category);
      cache.set(cacheKey, responsePayload, CACHE_TTL.TRACKING_STATS);
      console.log(`[Team Tracking Stats] 💾 Cached ${team} ${category} for ${CACHE_TTL.TRACKING_STATS} minutes`);
    }

    return NextResponse.json(
      responsePayload,
      { 
        status: 200,
        headers: {
          'X-Cache-Status': 'MISS',
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800'
        }
      }
    );

  } catch (error: any) {
    console.error('[Team Tracking Stats] Error:', error);
    
    // Determine error type and provide helpful message
    let errorMessage = 'Failed to fetch team tracking stats';
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

