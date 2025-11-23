// app/api/tracking-stats/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';
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

async function fetchNBAStats(url: string, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
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
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    
    console.log(`[Tracking Stats Refresh] Starting bulk refresh for ${season}-${season + 1} season`);
    
    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    const categories = ['passing', 'rebounding'];
    
    // Fetch league-wide data for both categories (2 API calls total)
    const allData: Record<string, any> = {};
    
    for (const category of categories) {
      const ptMeasureType = category === 'passing' ? 'Passing' : 'Rebounding';
      
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
        OpponentTeamID: "0",
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
      console.log(`[Tracking Stats Refresh] Fetching ${category} data...`);
      
      const data = await fetchNBAStats(url);
      
      if (!data?.resultSets?.[0]) {
        console.warn(`[Tracking Stats Refresh] No data for ${category}`);
        continue;
      }

      const resultSet = data.resultSets[0];
      const headers = resultSet.headers || [];
      const rows = resultSet.rowSet || [];

      allData[category] = { headers, rows };
      console.log(`[Tracking Stats Refresh] Got ${rows.length} players for ${category}`);
    }

    // Process and cache data by team
    let teamsProcessed = 0;
    const teamAbbrIdx = allData.passing?.headers?.indexOf('TEAM_ABBREVIATION') ?? -1;
    
    if (teamAbbrIdx === -1) {
      throw new Error('Missing TEAM_ABBREVIATION in response');
    }

    for (const team of ALL_NBA_TEAMS) {
      for (const category of categories) {
        const { headers, rows } = allData[category] || {};
        if (!headers || !rows) continue;

        // Filter rows for this team
        const teamRows = rows.filter((row: any[]) => row[teamAbbrIdx] === team);

        // Find column indices
        const playerIdIdx = headers.indexOf('PLAYER_ID');
        const playerNameIdx = headers.indexOf('PLAYER_NAME');
        const gpIdx = headers.indexOf('GP');

        if (playerIdIdx === -1 || playerNameIdx === -1) continue;

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

        // Cache this team's data for this category
        const cacheKey = getCacheKey.trackingStats(team, season, category);
        const payload = {
          team,
          season: seasonStr,
          category,
          players,
          cachedAt: new Date().toISOString()
        };
        
        cache.set(cacheKey, payload, CACHE_TTL.TRACKING_STATS);
      }
      
      teamsProcessed++;
    }

    // Also cache the full league data for quick access
    const allCacheKey = getCacheKey.allTrackingStats(season);
    cache.set(allCacheKey, {
      season: seasonStr,
      passing: allData.passing,
      rebounding: allData.rebounding,
      cachedAt: new Date().toISOString()
    }, CACHE_TTL.TRACKING_STATS);

    const elapsed = Date.now() - startTime;
    const result = {
      success: true,
      teamsProcessed,
      categoriesProcessed: categories.length,
      season: seasonStr,
      apiCalls: categories.length, // Only 2 API calls total!
      elapsed: `${elapsed}ms`,
      cachedAt: new Date().toISOString(),
      ttl: `${CACHE_TTL.TRACKING_STATS} minutes`
    };

    console.log(`[Tracking Stats Refresh] ✅ Complete:`, result);
    
    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error('[Tracking Stats Refresh] ❌ Error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to refresh tracking stats',
        elapsed: `${elapsed}ms`
      },
      { status: 500 }
    );
  }
}


