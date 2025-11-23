// app/api/opponent-playtype-defense/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';
import { currentNbaSeason } from '@/lib/nbaUtils';

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

// Play type categories from NBA Stats API
const PLAY_TYPES = [
  { key: 'Isolation', displayName: 'Isolation (1v1)' },
  { key: 'PRBallHandler', displayName: 'Pick & Roll (Ball Handler)' },
  { key: 'PRRollMan', displayName: 'Pick & Roll (Roll Man)' },
  { key: 'Postup', displayName: 'Post-Up' },
  { key: 'Spotup', displayName: 'Spot-Up' },
  { key: 'Handoff', displayName: 'Hand-Off' },
  { key: 'Cut', displayName: 'Cut' },
  { key: 'OffScreen', displayName: 'Off-Screen' },
  { key: 'Transition', displayName: 'Transition' },
];

async function fetchNBAStats(url: string, timeout = 20000) {
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
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());

    if (!team) {
      return NextResponse.json(
        { error: 'Team abbreviation is required' },
        { status: 400 }
      );
    }

    // Check cache first
    const cacheKey = `playtype_defense_${team}_${season}`;
    const cached = cache.get<any>(cacheKey);
    
    if (cached) {
      console.log(`[Play Type Defense] ✅ Cache hit for ${team}`);
      return NextResponse.json(cached, {
        status: 200,
        headers: { 'X-Cache-Status': 'HIT' }
      });
    }

    console.log(`[Play Type Defense] Fetching data for ${team}, season ${season}`);

    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    const playTypeResults: any[] = [];

    // Fetch synergy play type defense data for all teams
    // This uses the synergyplaytypes endpoint which tracks defensive efficiency by play type
    const params = new URLSearchParams({
      LeagueID: '00',
      PerMode: 'PerGame',
      Season: seasonStr,
      SeasonType: 'Regular Season',
      TypeGrouping: 'defensive', // Defensive play types
    });

    const url = `${NBA_STATS_BASE}/synergyplaytypes?${params.toString()}`;
    
    const data = await fetchNBAStats(url);

    if (!data?.resultSets?.[0]) {
      console.warn(`[Play Type Defense] No data available`);
      
      // Return mock data for development
      const mockData = PLAY_TYPES.map((pt, idx) => ({
        playType: pt.key,
        displayName: pt.displayName,
        ppp: 0.95 + (Math.random() * 0.3),
        fgPct: 42 + (Math.random() * 8),
        rank: Math.floor(Math.random() * 30) + 1,
        frequency: 8 + (Math.random() * 12)
      }));

      const response = {
        team,
        season: seasonStr,
        playTypes: mockData,
        note: 'Using mock data - NBA API data not available'
      };

      cache.set(cacheKey, response, 60); // Cache for 1 hour
      
      return NextResponse.json(response, { 
        status: 200,
        headers: { 'X-Cache-Status': 'MOCK' }
      });
    }

    const resultSet = data.resultSets[0];
    const headers = resultSet.headers || [];
    const rows = resultSet.rowSet || [];

    // Find column indices
    const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
    const playTypeIdx = headers.indexOf('PLAY_TYPE');
    const pppIdx = headers.indexOf('PPP'); // Points Per Possession
    const fgPctIdx = headers.indexOf('FG_PCT');
    const freqIdx = headers.indexOf('POSS_PCT'); // Possession frequency

    if (teamAbbrIdx === -1 || playTypeIdx === -1) {
      throw new Error('Missing required columns in API response');
    }

    // Process data for all teams to calculate rankings
    const teamData: Record<string, any[]> = {};
    
    rows.forEach((row: any[]) => {
      const teamAbbr = row[teamAbbrIdx];
      const playType = row[playTypeIdx];
      const ppp = row[pppIdx] || 0;
      const fgPct = row[fgPctIdx] || 0;
      const freq = row[freqIdx] || 0;

      if (!teamData[teamAbbr]) {
        teamData[teamAbbr] = [];
      }

      teamData[teamAbbr].push({
        playType,
        ppp,
        fgPct: fgPct * 100, // Convert to percentage
        frequency: freq * 100
      });
    });

    // Calculate rankings for each play type
    const playTypeRankings: Record<string, any[]> = {};
    
    PLAY_TYPES.forEach(({ key }) => {
      const allTeamsForPlayType = Object.entries(teamData)
        .map(([teamAbbr, playTypes]) => {
          const pt = playTypes.find(p => p.playType === key);
          return {
            team: teamAbbr,
            ppp: pt?.ppp || 999,
            fgPct: pt?.fgPct || 0,
            frequency: pt?.frequency || 0
          };
        })
        .sort((a, b) => a.ppp - b.ppp); // Sort by PPP (lower is better defense)

      playTypeRankings[key] = allTeamsForPlayType.map((item, idx) => ({
        ...item,
        rank: idx + 1
      }));
    });

    // Get data for requested team
    const teamPlayTypes = PLAY_TYPES.map(({ key, displayName }) => {
      const ranking = playTypeRankings[key]?.find(r => r.team === team);
      
      return {
        playType: key,
        displayName,
        ppp: ranking?.ppp || 1.0,
        fgPct: ranking?.fgPct || 45.0,
        rank: ranking?.rank || 15,
        frequency: ranking?.frequency || 10.0
      };
    }).sort((a, b) => b.frequency - a.frequency); // Sort by frequency (most common first)

    const response = {
      team,
      season: seasonStr,
      playTypes: teamPlayTypes,
      cachedAt: new Date().toISOString()
    };

    // Cache the result
    cache.set(cacheKey, response, CACHE_TTL.TRACKING_STATS);
    console.log(`[Play Type Defense] 💾 Cached ${team} play type defense`);

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Cache-Status': 'MISS' }
    });

  } catch (error: any) {
    console.error('[Play Type Defense] Error:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch play type defense data',
        details: error.message
      },
      { status: 500 }
    );
  }
}


