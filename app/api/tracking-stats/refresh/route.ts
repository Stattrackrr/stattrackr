// app/api/tracking-stats/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { currentNbaSeason } from '@/lib/nbaUtils';

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

async function fetchNBAStats(url: string, timeout = 60000) { // Increased to 60s for LastNGames queries
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
    
    // Fetch league-wide data for "All Games" only (2 API calls)
    // Last 5 Games will be fetched per team below (to avoid league-wide timeout)
    const allData: Record<string, Record<string, any>> = {
      allGames: {}
    };
    
    // Fetch "All Games" data (2 API calls)
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
      console.log(`[Tracking Stats Refresh] Fetching ${category} data (All Games)...`);
      
      const data = await fetchNBAStats(url);
      
      if (!data?.resultSets?.[0]) {
        console.warn(`[Tracking Stats Refresh] No data for ${category} (All Games)`);
        continue;
      }

      const resultSet = data.resultSets[0];
      const headers = resultSet.headers || [];
      const rows = resultSet.rowSet || [];

      allData.allGames[category] = { headers, rows };
      console.log(`[Tracking Stats Refresh] Got ${rows.length} players for ${category} (All Games)`);
    }
    
    // Process and cache "All Games" data by team
    let teamsProcessed = 0;
    const teamAbbrIdxAllGames = allData.allGames.passing?.headers?.indexOf('TEAM_ABBREVIATION') ?? -1;
    
    if (teamAbbrIdxAllGames === -1) {
      throw new Error('Missing TEAM_ABBREVIATION in All Games response');
    }

    // Helper function to process and cache team data
    const processAndCacheTeam = (
      dataSource: Record<string, any>,
      teamAbbrIdx: number,
      filterType: 'allGames' | 'last5Games',
      lastNGames?: string
    ) => {
      for (const team of ALL_NBA_TEAMS) {
        for (const category of categories) {
          const { headers, rows } = dataSource[category] || {};
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

          // Build cache key
          const cacheKey = lastNGames 
            ? `tracking_stats_${team.toUpperCase()}_${season}_${category}_last${lastNGames}`
            : getCacheKey.trackingStats(team, season, category);
          
          const payload = {
            team,
            season: seasonStr,
            category,
            players,
            lastNGames: lastNGames || undefined,
            cachedAt: new Date().toISOString()
          };
          
          // Cache in both Supabase (persistent) and in-memory
          setNBACache(cacheKey, 'team_tracking', payload, CACHE_TTL.TRACKING_STATS).catch(err => {
            console.warn(`[Tracking Stats Refresh] Failed to cache in Supabase: ${err.message}`);
          });
          cache.set(cacheKey, payload, CACHE_TTL.TRACKING_STATS);
        }
      }
    };

    // Process and cache "All Games" data
    if (teamAbbrIdxAllGames !== -1) {
      processAndCacheTeam(allData.allGames, teamAbbrIdxAllGames, 'allGames');
    }
    
    teamsProcessed = ALL_NBA_TEAMS.length;
    
    // Fetch and cache "Last 5 Games" data per team (to avoid league-wide timeout)
    // Fetch each team separately - this is slower but more reliable
    console.log(`[Tracking Stats Refresh] Fetching Last 5 Games data per team (60 API calls: 30 teams × 2 categories)...`);
    let last5GamesCached = 0;
    let last5GamesErrors = 0;
    
    for (const team of ALL_NBA_TEAMS) {
      for (const category of categories) {
        const ptMeasureType = category === 'passing' ? 'Passing' : 'Rebounding';
        const teamId = NBA_TEAM_IDS[team];
        
        if (!teamId) {
          console.warn(`[Tracking Stats Refresh] ⚠️ No team ID for ${team}, skipping Last 5 Games`);
          continue;
        }
        
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
            LastNGames: "5",
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
            TeamID: teamId, // Filter by specific team (faster than league-wide)
            VsConference: "",
            VsDivision: "",
            Weight: "",
          });

          const url = `${NBA_STATS_BASE}/leaguedashptstats?${params.toString()}`;
          
          // Fetch with shorter timeout since it's per-team (should be faster)
          const data = await fetchNBAStats(url, 30000);
          
          if (!data?.resultSets?.[0]) {
            console.warn(`[Tracking Stats Refresh] No Last 5 Games data for ${team} ${category}`);
            last5GamesErrors++;
            continue;
          }

          const resultSet = data.resultSets[0];
          const headers = resultSet.headers || [];
          const rows = resultSet.rowSet || [];
          
          const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
          if (teamAbbrIdx === -1) continue;
          
          // Filter rows for this team (should only be this team since we used TeamID filter)
          const teamRows = rows.filter((row: any[]) => row[teamAbbrIdx] === team);
          
          const playerIdIdx = headers.indexOf('PLAYER_ID');
          const playerNameIdx = headers.indexOf('PLAYER_NAME');
          
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

          // Cache Last 5 Games data
          const cacheKey = `tracking_stats_${team.toUpperCase()}_${season}_${category}_last5`;
          const payload = {
            team,
            season: seasonStr,
            category,
            players,
            lastNGames: '5',
            cachedAt: new Date().toISOString()
          };
          
          await setNBACache(cacheKey, 'team_tracking', payload, CACHE_TTL.TRACKING_STATS).catch(err => {
            console.warn(`[Tracking Stats Refresh] Failed to cache Last 5 Games in Supabase: ${err.message}`);
          });
          cache.set(cacheKey, payload, CACHE_TTL.TRACKING_STATS);
          
          last5GamesCached++;
          
          if (last5GamesCached % 10 === 0) {
            console.log(`[Tracking Stats Refresh] 💾 Cached ${last5GamesCached}/60 Last 5 Games combinations...`);
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error: any) {
          console.error(`[Tracking Stats Refresh] ❌ Error fetching Last 5 Games for ${team} ${category}: ${error.message}`);
          last5GamesErrors++;
          // Continue with next team/category
        }
      }
    }
    
    console.log(`[Tracking Stats Refresh] ✅ Last 5 Games: ${last5GamesCached} cached, ${last5GamesErrors} errors`);

    // Also cache the full league data for quick access (All Games)
    const allCacheKey = getCacheKey.allTrackingStats(season);
    cache.set(allCacheKey, {
      season: seasonStr,
      passing: allData.allGames.passing,
      rebounding: allData.allGames.rebounding,
      cachedAt: new Date().toISOString()
    }, CACHE_TTL.TRACKING_STATS);

    const elapsed = Date.now() - startTime;
    const result = {
      success: true,
      teamsProcessed,
      categoriesProcessed: categories.length, // 2 categories
      season: seasonStr,
      apiCalls: categories.length + (last5GamesCached + last5GamesErrors), // 2 for All Games + Last 5 Games per team
      last5GamesCached,
      last5GamesErrors,
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


