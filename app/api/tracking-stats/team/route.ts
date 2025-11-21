// app/api/tracking-stats/team/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

async function fetchNBAStats(url: string, timeout = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: NBA_HEADERS,
      signal: controller.signal,
      next: { revalidate: 1800 } // Cache for 30 minutes
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NBA API ${response.status}: ${text.substring(0, 200)}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - NBA API took too long to respond');
    }
    throw error;
  }
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

    const seasonStr = `${season}-${String(parseInt(season) + 1).slice(-2)}`;
    
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
    return NextResponse.json(
      { 
        error: 'Failed to fetch team tracking stats',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

